// One room, one Durable Object. The object IS the room.
//
// This is the point of the port. `server/hub.ts` keeps a Map of rooms in one
// process, which means every socket for a game has to reach that process:
// sticky sessions, instance affinity, and a single point of failure holding all
// the games. Cloudflare routes by object id instead, so every socket for room
// `abc123` lands in the same object wherever it lives, and rooms are isolated
// from each other by construction.
//
// HIBERNATION IS THE THING TO DESIGN AROUND. An idle object is evicted from
// memory and woken by the next message — mid-game, not at a clean restart. So:
//
//   * Game state lives in `ctx.storage`. A class field is a cache at best and a
//     lie at worst. `#room` below is explicitly a cache, rebuilt on miss.
//   * The connection -> seat mapping lives in `connection.setState`, which
//     Cloudflare persists across hibernation. A `Map<connectionId, PlayerId>`
//     in a field would empty silently and players would find themselves
//     unseated with no error anywhere — the worst shape a bug can take.

import {
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import { GameRoom, type Update } from "../server/room";
import { visibleEvents } from "../server/events";
import { beatsIn, hasDusk, hasTurning } from "../server/pace";
import type { Inbound, Outbound, TableSeat } from "../server/protocol";
import type { Command, PlayerId, GameEvent } from "../engine/state";
import { seatConfigs, type LogEntry, type RoomMeta, type Replay } from "./log";

/** DESIGN.md §1: three to five at a table. */
const MIN_SEATS = 3;
const MAX_SEATS = 5;

const BOT_NAMES = ["Ada", "Bell", "Cole", "Dell", "Etta"];

/** Storage keys. Two of them, and neither is a serialised GameState. */
const K_META = "meta";
const K_LOG = "log";

/**
 * What a connection remembers about itself.
 *
 * Held in connection state rather than an object field precisely because it has
 * to survive hibernation. `tokenSeat` is the seat this socket is driving.
 */
interface ConnState {
  seat: PlayerId | null;
  token: string | null;
  /** Sliding window for the rate limit, in ms since epoch. */
  hits: number[];
}

export interface Env {
  ROOM: DurableObjectNamespace;
  /** "1" turns on the act controls. Off anywhere a real game is played. */
  LONG_NOON_DEV?: string;
}

/** A room is a shared object; one bad client must not be able to spin it. */
const MAX_MESSAGE_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MESSAGES = 120;

/** Bot pacing, ported from `Hub`. See CLAUDE.md — paid per sentence, not action. */
const BOT_MIN_GAP_MS = 3400;
const BOT_BASE_MS = 1500;
const BOT_READ_MS = 1100;
const BOT_QUIET_MS = 350;
const BOT_DUSK_MS = 2400;
const BOT_TURNING_MS = 6600;

export class GameRoomObject extends Server<Env> {
  /** Hibernation: the object sleeps when idle and wakes on the next message. */
  static options = { hibernate: true };

  /**
   * A cache, and nothing more.
   *
   * Undefined after every hibernation, and rebuilt from the log on the next
   * touch. Never the source of truth — read `#load()`, never this.
   */
  private room?: GameRoom;
  private meta?: RoomMeta;
  private log?: LogEntry[];

  /**
   * Drop every in-memory cache, exactly as hibernation does.
   *
   * TypeScript-private rather than `#private` so `tests/worker` can call it:
   * the failure mode being tested is "a class field vanished and the seat went
   * with it", and there is no way to prove that against fields nothing can
   * reach. Calling it in production would be a pointless cache miss, not a bug.
   */
  evictForTest(): void {
    this.room = undefined;
    this.meta = undefined;
    this.log = undefined;
  }

  // ----------------------------------------------------------- persistence

  async #load(): Promise<{ meta: RoomMeta | null; log: LogEntry[] }> {
    if (this.meta && this.log) return { meta: this.meta, log: this.log };
    const meta = (await this.ctx.storage.get<RoomMeta>(K_META)) ?? null;
    const log = (await this.ctx.storage.get<LogEntry[]>(K_LOG)) ?? [];
    if (meta) this.meta = meta;
    this.log = log;
    return { meta, log };
  }

  /**
   * The game, rebuilt from seed + commands if it is not already in memory.
   *
   * This is the whole persistence strategy in one function. Rebuild cost is
   * linear in the log; see `worker/README.md` for the measured numbers and why
   * there is no state cache beyond this field.
   */
  async #game(): Promise<GameRoom | null> {
    if (this.room) return this.room;
    const { meta, log } = await this.#load();
    if (!meta?.begun) return null;

    const room = new GameRoom({
      seed: meta.seed,
      seats: seatConfigs(meta),
      marked: meta.marked,
    });
    for (const e of log) {
      if (e.k === "dev") {
        room.devForceTurning();
        continue;
      }
      const r = room.submit(e.seat, e.command);
      // A log that will not replay is a bug worth surfacing loudly rather than
      // a game that quietly diverges from the one people played.
      if (!r.ok)
        throw new Error(
          `replay failed at ${e.seat} ${e.command.t}: ${r.error}`,
        );
    }
    this.room = room;
    return room;
  }

  async #append(entry: LogEntry): Promise<void> {
    const { log } = await this.#load();
    log.push(entry);
    this.log = log;
    await this.ctx.storage.put(K_LOG, log);
  }

  async #putMeta(meta: RoomMeta): Promise<void> {
    this.meta = meta;
    await this.ctx.storage.put(K_META, meta);
  }

  // ------------------------------------------------------------ lifecycle

  onConnect(conn: Connection<ConnState>, _ctx: ConnectionContext): void {
    // A fresh socket holds no seat until it joins or reclaims one. Setting it
    // explicitly means the state shape is never undefined later.
    conn.setState({ seat: null, token: null, hits: [] });
  }

  async onMessage(conn: Connection<ConnState>, raw: WSMessage): Promise<void> {
    const text = typeof raw === "string" ? raw : null;
    if (text === null) return this.#err(conn, "Binary frames are not accepted");
    if (text.length > MAX_MESSAGE_BYTES)
      return this.#err(conn, "Message too large");
    if (!this.#allow(conn)) return this.#err(conn, "Slow down");

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return this.#err(conn, "Malformed message");
    }
    const msg = parse(payload);
    if (!msg) return this.#err(conn, "Malformed message");

    try {
      await this.#route(conn, msg);
    } catch (e) {
      // An unexpected throw is this object's problem, not a game rule. Say so
      // without handing the client a stack trace.
      console.error("room error", e);
      this.#err(conn, "Something went wrong in the room");
    }
  }

  async onClose(conn: Connection<ConnState>): Promise<void> {
    const seat = conn.state?.seat;
    if (!seat) return;
    const { meta } = await this.#load();
    if (!meta) return;

    // Before the deal there is nothing to hold a chair for: closing the tab is
    // leaving the queue. After it, the seat and its token survive so the player
    // can come back — same rule as `server/hub.ts`.
    if (!meta.begun) {
      const chair = meta.seats.find((s) => s.id === seat);
      if (chair && chair.kind === "human") {
        chair.kind = "open";
        chair.name = null;
        chair.token = null;
      }
      await this.#putMeta(meta);
      this.#broadcastTable(meta);
    }
  }

  // --------------------------------------------------------------- routing

  async #route(conn: Connection<ConnState>, msg: Inbound): Promise<void> {
    switch (msg.t) {
      case "create":
        return this.#create(conn, msg.seats, msg.seed);
      case "join":
        return this.#join(conn, msg.name);
      case "rejoin":
        return this.#rejoin(conn, msg.token);
      case "seat":
        return this.#setSeat(conn, msg.index, msg.kind);
      case "begin":
        return this.#begin(conn, msg.marked);
      case "command":
        return this.#command(conn, msg.command);
      case "leave":
        return this.#leave(conn);
      case "dev":
        return this.#dev(conn, msg.action);
      // Presence voting is not ported yet — see worker/README.md. The old
      // server still has it, and answering with an error is honest.
      case "vote":
        return this.#err(conn, "Voting is not available on this server");
      default:
        return this.#err(conn, "Unknown message");
    }
  }

  async #create(
    conn: Connection<ConnState>,
    seats: number,
    seed?: string,
  ): Promise<void> {
    const { meta } = await this.#load();
    if (meta) return this.#err(conn, "This room already exists");
    const count = Math.floor(seats);
    if (!Number.isFinite(count) || count < MIN_SEATS || count > MAX_SEATS) {
      return this.#err(conn, `A table seats ${MIN_SEATS} to ${MAX_SEATS}`);
    }
    const next: RoomMeta = {
      roomId: this.name,
      // A room's seed is made here and never leaves. `markedIndex` is derived
      // from it, so a guessable seed would make the traitor guessable.
      seed: seed ?? crypto.randomUUID(),
      seats: Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        kind: "open" as const,
        name: null,
        token: null,
      })),
      marked: null,
      begun: false,
      createdAt: Date.now(),
    };
    await this.#putMeta(next);
    this.#send(conn, { t: "created", roomId: this.name });
    this.#broadcastTable(next);
  }

  async #join(conn: Connection<ConnState>, name: string): Promise<void> {
    const { meta } = await this.#load();
    if (!meta) return this.#err(conn, "No such room");
    if (conn.state?.seat) return this.#err(conn, "Already seated");

    const free = meta.begun
      ? meta.seats.find(
          (s) => s.kind === "human" && !s.token && !this.#driven(s.id),
        )
      : meta.seats.find((s) => s.kind === "open");
    if (!free) return this.#err(conn, "Room is full");

    const token = crypto.randomUUID();
    free.kind = "human";
    free.name = name;
    free.token = token;
    await this.#putMeta(meta);
    conn.setState({ seat: free.id, token, hits: conn.state?.hits ?? [] });

    this.#send(conn, {
      t: "joined",
      roomId: this.name,
      seat: free.id,
      token,
      dev: this.#devOn(),
    });
    if (meta.begun) await this.#syncAll();
    else this.#broadcastTable(meta);
  }

  async #rejoin(conn: Connection<ConnState>, token: string): Promise<void> {
    const { meta } = await this.#load();
    if (!meta) return this.#err(conn, "No such room");
    const chair = meta.seats.find((s) => s.token === token);
    // A bad token must not say whether the room or the token was wrong.
    if (!chair) return this.#err(conn, "Cannot rejoin");

    conn.setState({ seat: chair.id, token, hits: conn.state?.hits ?? [] });
    this.#send(conn, {
      t: "joined",
      roomId: this.name,
      seat: chair.id,
      token,
      dev: this.#devOn(),
    });
    if (meta.begun) await this.#syncAll();
    else this.#broadcastTable(meta);
  }

  async #leave(conn: Connection<ConnState>): Promise<void> {
    const { meta } = await this.#load();
    const seat = conn.state?.seat;
    if (!meta || !seat) return;
    const chair = meta.seats.find((s) => s.id === seat);
    if (chair) {
      // Burn the token. A disconnect keeps it — the point of a disconnect is
      // that you meant to come back. Leaving is the opposite statement.
      chair.token = null;
      if (!meta.begun) {
        chair.kind = "open";
        chair.name = null;
      }
    }
    await this.#putMeta(meta);
    conn.setState({ seat: null, token: null, hits: [] });
    if (!meta.begun) this.#broadcastTable(meta);
  }

  async #setSeat(
    conn: Connection<ConnState>,
    index: number,
    kind: "bot" | "open",
  ): Promise<void> {
    const { meta } = await this.#load();
    if (!meta) return this.#err(conn, "No such room");
    if (!conn.state?.seat) return this.#err(conn, "Not in a room");
    if (meta.begun) return this.#err(conn, "The game has already begun");
    const chair = meta.seats[index];
    if (!chair) return this.#err(conn, "No such seat");
    if (chair.kind === "human")
      return this.#err(conn, "Someone is sitting there");
    chair.kind = kind;
    chair.name =
      kind === "bot" ? (BOT_NAMES[index] ?? `Bot ${index + 1}`) : null;
    await this.#putMeta(meta);
    this.#broadcastTable(meta);
  }

  async #begin(conn: Connection<ConnState>, marked: boolean): Promise<void> {
    const { meta } = await this.#load();
    if (!meta) return this.#err(conn, "No such room");
    if (!conn.state?.seat) return this.#err(conn, "Not in a room");
    if (meta.begun) return this.#err(conn, "The game has already begun");
    if (meta.seats.some((s) => s.kind === "open")) {
      return this.#err(conn, "Every chair must be filled first");
    }
    meta.begun = true;
    meta.marked = marked ? markedIndex(meta.seed, meta.seats.length) : null;
    await this.#putMeta(meta);
    this.room = undefined; // force a build with the final seats
    const game = await this.#game();
    // The deal, not a resync: the opening hand should arrive as one.
    if (game) this.#deliver(game.deal(), game.botSeats);
    await this.#scheduleBot();
  }

  /**
   * A command from a player.
   *
   * Checked against `legalCommands` for that seat before `apply` sees it —
   * `GameRoom.submit` does that, and it is the reason a hostile client gets a
   * clean rejection rather than a 500 shaped like a game rule.
   */
  async #command(conn: Connection<ConnState>, command: Command): Promise<void> {
    const seat = conn.state?.seat;
    if (!seat) return this.#err(conn, "Not seated");
    const room = await this.#game();
    if (!room) return this.#err(conn, "The game has not begun");

    // The seat comes from the connection, never from the message.
    const res = room.submit(seat, command);
    if (!res.ok) return this.#err(conn, res.error);

    await this.#append({ k: "cmd", seat, command });
    this.#deliver(res.updates, room.botSeats);
    await this.#scheduleBot();
  }

  async #dev(
    conn: Connection<ConnState>,
    action: "turning" | "restart",
  ): Promise<void> {
    if (!this.#devOn()) return this.#err(conn, "Not available");
    const { meta } = await this.#load();
    if (!meta || !conn.state?.seat) return this.#err(conn, "Not in a room");

    if (action === "restart") {
      // A fresh deal is a new seed and an empty log, not a rewind.
      meta.seed = crypto.randomUUID();
      await this.#putMeta(meta);
      this.log = [];
      await this.ctx.storage.put(K_LOG, []);
      this.room = undefined;
      await this.#syncAll();
      return this.#scheduleBot();
    }

    const room = await this.#game();
    if (!room) return this.#err(conn, "The game has not begun");
    const updates = room.devForceTurning();
    await this.#append({ k: "dev", action: "turning" });
    this.#deliver(updates, room.botSeats);
    await this.#scheduleBot();
  }

  // ----------------------------------------------------------------- bots

  /**
   * Bots run on a storage alarm.
   *
   * The old server drove them from a `setInterval` in the transport, which a
   * Durable Object has no equivalent of — a hibernating object is not running
   * any timers. An alarm wakes it, which is exactly the semantics wanted: no
   * bot to move means no alarm means the object stays asleep and free.
   */
  async #scheduleBot(): Promise<void> {
    const room = await this.#game();
    if (!room || !room.awaitingBot) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null)
      await this.ctx.storage.setAlarm(Date.now() + BOT_MIN_GAP_MS);
  }

  async alarm(): Promise<void> {
    const room = await this.#game();
    if (!room || !room.awaitingBot) return;
    const { log } = await this.#load();

    // Picked, then logged, then applied: the log has to say what the bot chose,
    // because a rebuild cannot re-derive it against a half-built state.
    const next = room.botCommand(log.length);
    if (!next) return;
    const res = room.submit(next.seat, next.command);
    if (!res.ok) return;
    await this.#append({ k: "cmd", seat: next.seat, command: next.command });
    this.#deliver(res.updates, room.botSeats);

    if (room.awaitingBot) {
      await this.ctx.storage.setAlarm(Date.now() + pauseAfter(res.updates));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  // -------------------------------------------------------------- sending

  /**
   * One payload per connection, projected for that seat.
   *
   * Never a shared broadcast. `playerView` is the only thing a client may hold
   * (CLAUDE.md invariant 3) and the event stream is the other half — a raw
   * GameEvent[] leaks SCRIED, which names the card a scryer pushed to the top
   * of the Threat deck.
   */
  #deliver(updates: Update[], bots: PlayerId[] = []): void {
    for (const conn of this.getConnections<ConnState>()) {
      const seat = conn.state?.seat;
      if (!seat) continue;
      const mine = updates.find((u) => u.seat === seat);
      if (!mine) continue;
      this.#send(conn, {
        t: "state",
        view: mine.view,
        events: visibleEvents(mine.events, seat),
        legal: mine.legal,
        bots,
      });
    }
  }

  async #syncAll(): Promise<void> {
    const room = await this.#game();
    if (!room) return;
    this.#deliver(room.sync(), room.botSeats);
  }

  #broadcastTable(meta: RoomMeta): void {
    const seats: TableSeat[] = meta.seats.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
    }));
    const msg: Outbound = {
      t: "table",
      roomId: this.name,
      seats,
      canBegin: meta.seats.every((s) => s.kind !== "open"),
    };
    for (const conn of this.getConnections<ConnState>()) this.#send(conn, msg);
  }

  #send(conn: Connection<ConnState>, msg: Outbound): void {
    conn.send(JSON.stringify(msg));
  }

  #err(conn: Connection<ConnState>, message: string): void {
    this.#send(conn, { t: "error", message });
  }

  // --------------------------------------------------------------- guards

  /** Is some live connection already driving this seat? */
  #driven(seat: PlayerId): boolean {
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.seat === seat) return true;
    }
    return false;
  }

  #devOn(): boolean {
    return this.env.LONG_NOON_DEV === "1";
  }

  /** Sliding-window rate limit, per connection, kept in connection state. */
  #allow(conn: Connection<ConnState>): boolean {
    const now = Date.now();
    const state = conn.state ?? { seat: null, token: null, hits: [] };
    const hits = (state.hits ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    hits.push(now);
    conn.setState({ ...state, hits });
    return hits.length <= RATE_MAX_MESSAGES;
  }

  // ---------------------------------------------------------------- replay

  /** Seed and commands, for loading a playtest back into the simulator. */
  async replay(): Promise<Replay | null> {
    const { meta, log } = await this.#load();
    if (!meta) return null;
    return {
      roomId: meta.roomId,
      seed: meta.seed,
      seats: meta.seats.map((s) => ({ id: s.id, kind: s.kind, name: s.name })),
      marked: meta.marked,
      begun: meta.begun,
      createdAt: meta.createdAt,
      entries: log,
    };
  }
}

// ---------------------------------------------------------------- helpers

/**
 * Which chair the Marked player sits in.
 *
 * Ported from `server/hub.ts`, including the reason: a fixed index made the
 * first person to sit down the traitor in every game. Derived from the seed,
 * which is made in the object and never sent to anyone.
 */
function markedIndex(seed: string, seats: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % seats;
}

/** Bot pacing, per sentence rather than per event. See CLAUDE.md. */
function pauseAfter(updates: Update[]): number {
  const events: GameEvent[] = updates[0]?.events ?? [];
  const beats = beatsIn(events, false);
  const paced =
    beats === 0
      ? BOT_QUIET_MS
      : BOT_BASE_MS +
        BOT_READ_MS * Math.min(beats - 1, 8) +
        (hasDusk(events) ? BOT_DUSK_MS : 0) +
        (hasTurning(events) ? BOT_TURNING_MS : 0);
  return Math.max(BOT_MIN_GAP_MS, paced);
}

/**
 * Shape-check every inbound message.
 *
 * Over a socket the message type is a promise the client has not made. Ported
 * whole from `server/hub.ts` — including the lesson recorded there, that
 * `create.seats` changing from an array to a number silently rejected every
 * create until this moved with it.
 */
function parse(raw: unknown): Inbound | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const str = (k: string) => typeof m[k] === "string";
  switch (m.t) {
    case "create":
      return typeof m.seats === "number" ? (m as Inbound) : null;
    case "join":
      return str("name") ? (m as Inbound) : null;
    case "rejoin":
      return str("token") ? (m as Inbound) : null;
    case "command":
      return typeof m.command === "object" &&
        m.command !== null &&
        typeof (m.command as Record<string, unknown>).t === "string"
        ? (m as Inbound)
        : null;
    case "vote":
      return str("seat") && (m.choice === "bot" || m.choice === "wait")
        ? (m as Inbound)
        : null;
    case "leave":
      return m as Inbound;
    case "seat":
      return typeof m.index === "number" &&
        (m.kind === "bot" || m.kind === "open")
        ? (m as Inbound)
        : null;
    case "begin":
      return typeof m.marked === "boolean" ? (m as Inbound) : null;
    case "dev":
      return m.action === "turning" || m.action === "restart"
        ? (m as Inbound)
        : null;
    default:
      return null;
  }
}
