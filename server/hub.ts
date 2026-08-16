// Rooms, connections and session tokens. Still transport-agnostic: `handle`
// takes a message and returns the messages to send, so the socket server is a
// thin adapter and the whole thing is testable without a network.
//
// Two rules this file exists to enforce:
//
// 1. A connection's seat is decided by the server at join time and never read
//    from a message. Otherwise one player could act as another.
// 2. Seat tokens are unguessable. They must not derive from the game seed —
//    anyone holding a replay could otherwise compute a seat token, reclaim it,
//    and read that player's hidden role.

import { randomUUID } from 'node:crypto';
import { randAt } from '../engine/rng';
import type { Command, GameEvent, PlayerId } from '../engine/state';
import { Lobby, type LobbyConfig } from './lobby';
import type { Update } from './room';
import type { Envelope, Inbound, Outbound, TableSeat } from './protocol';
import { beatsIn, hasDusk, hasTurning } from './pace';

interface Session {
  roomId: string;
  seat: PlayerId;
}

/**
 * A room before the deal.
 *
 * The game does not exist yet: `lobby` is null until someone begins, because a
 * GameRoom deals cards the moment it is constructed and the seat count is not
 * settled until every chair is filled. Building it early meant dealing a game
 * nobody had agreed to the shape of, and re-dealing on every seat change.
 */
interface Room {
  id: string;
  seed: string;
  /** The chairs, and who is in them. The truth until the game begins. */
  seats: TableSeat[];
  /** Null until someone begins. See the note above. */
  lobby: Lobby | null;
  /** token -> seat. Issued on join, required to reclaim. */
  tokens: Map<string, PlayerId>;
  /** seat -> the connection currently driving it, if any. */
  conns: Map<PlayerId, string>;
}

export interface HubOptions {
  config?: Partial<LobbyConfig>;
  /** Injected for tests; production uses randomUUID. */
  newId?: () => string;
  /**
   * Pause between one bot action and the next. Bots used to resolve a whole
   * turn inside `submit`, which read as nothing happening at all — this is what
   * turns them back into something you can watch.
   */
  botDelayMs?: number;
  /**
   * Extra pause per additional thing that happened in one action.
   *
   * A bot's END_TURN can bring on Dusk: three Threats menacing, three players
   * losing cards, two arrivals. Waiting the same beat after that as after "buys
   * Hard Tack" leaves nobody time to read any of it.
   */
  readMs?: number;
  /**
   * Pause after an action with nothing to say — spending a card for Grit, or a
   * turn ending quietly. Half of all bot actions are these; pausing on them at
   * full length spends the game's pace on a blank screen.
   */
  quietMs?: number;
  /**
   * Extra time for the Dusk beat, which is the one the client animates and
   * scores rather than simply prints. Cutting the sun off mid-arc, or the sound
   * off mid-note, is worse than the table waiting — so the pause covers the
   * whole fall and the clip that runs slightly past it (`DUSK_HOLD` in
   * client/src/App.tsx).
   */
  duskMs?: number;
  /**
   * Extra time for the Turning, which takes the whole screen and is scored.
   * Covers the piece (5.7s) plus the clip that rings out past it. Once a game.
   */
  turningMs?: number;
  /**
   * Open the `dev` message channel: forcing the Turning and re-dealing.
   *
   * OFF by default and meant to stay off anywhere a real game is played. These
   * are not commands, do not pass through `isLegal`, and are not moves anyone
   * is ever offered — which is the whole point of them and also the whole
   * danger: choosing the moment of the Turning is the most valuable thing the
   * Marked player could buy, since their secret aim is scored at that instant.
   */
  devTools?: boolean;
  /**
   * Floor on the gap between one bot action and the next.
   *
   * A rate limit rather than a pause: whatever the pacing model works out, no
   * bot acts sooner than this. Playtesting said the table rearranged itself
   * faster than it could be read even with the per-sentence pacing, and the
   * cheapest fix for "I cannot see what they did" is time.
   *
   * The model underneath is untouched and still adds time for a busy action, a
   * Dusk or the Turning — this only raises the bottom. It is the obvious knob
   * for a game-speed control later: drop it and the measured pacing takes over
   * again.
   */
  minGapMs?: number;
}


/** DESIGN.md §1: three to five at a table. */
const MIN_SEATS = 3;
const MAX_SEATS = 5;

const BOT_NAMES = ['Ada', 'Bell', 'Cole', 'Dell', 'Etta'];
const botName = (i: number) => BOT_NAMES[i % BOT_NAMES.length] ?? `Bot ${i + 1}`;

/**
 * Which chair the Marked player sits in.
 *
 * Derived from the room seed rather than fixed. The client used to send
 * `marked: 0`, which made the first person to sit down the traitor in every
 * single game — the one fact in this design that must never be guessable. The
 * seed is server-made and never sent to anyone, so this is unpredictable from
 * the outside and still deterministic for replay.
 */
function markedIndex(seed: string, seats: number): number {
  return Math.floor(randAt(seed, 0) * seats) % seats;
}

export class Hub {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Session>();
  private readonly cfg?: Partial<LobbyConfig>;
  private readonly newId: () => string;
  private readonly botDelayMs: number;
  private readonly readMs: number;
  private readonly quietMs: number;
  private readonly duskMs: number;
  private readonly turningMs: number;
  readonly devTools: boolean;
  private readonly minGapMs: number;
  /** Earliest time each room may take its next bot action. */
  private readonly nextBotAt = new Map<string, number>();
  /** Who was up last time a bot acted, so a handover can be paid for. */
  private readonly lastActive = new Map<string, PlayerId>();
  /** Counter behind dev re-deals, so each one is a different game. */
  private dealt = 1;

  constructor(opts: HubOptions = {}) {
    this.cfg = opts.config;
    this.newId = opts.newId ?? (() => randomUUID());
    this.botDelayMs = opts.botDelayMs ?? 1500;
    this.readMs = opts.readMs ?? 1100;
    this.quietMs = opts.quietMs ?? 350;
    this.duskMs = opts.duskMs ?? 2400;
    this.turningMs = opts.turningMs ?? 6600;
    this.devTools = opts.devTools ?? false;
    this.minGapMs = opts.minGapMs ?? 5000;
  }

  room(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  seatOf(conn: string): Session | undefined {
    return this.sessions.get(conn);
  }

  // ---------------------------------------------------------------- routing

  /**
   * `msg` is `unknown` on purpose: over a socket this is arbitrary JSON, and a
   * malformed payload must be an error message rather than a thrown exception
   * that takes the process with it.
   */
  handle(conn: string, raw: unknown, now: number): Envelope[] {
    const msg = parse(raw);
    if (!msg) return [err(conn, 'Malformed message')];
    switch (msg.t) {
      case 'create': return this.create(conn, msg, now);
      case 'join': return this.join(conn, msg.roomId, msg.name, now);
      case 'rejoin': return this.rejoin(conn, msg.roomId, msg.token, now);
      case 'command': return this.command(conn, msg.command);
      case 'vote': return this.vote(conn, msg.seat, msg.choice, now);
      case 'dev': return this.dev(conn, msg.action);
      case 'leave': return this.leave(conn, now);
      case 'seat': return this.setSeat(conn, msg.index, msg.kind);
      case 'begin': return this.begin(conn, msg.marked, now);
      default: return [err(conn, 'Unknown message')];
    }
  }

  private create(
    conn: string, msg: Extract<Inbound, { t: 'create' }>, now: number,
  ): Envelope[] {
    const count = Math.floor(msg.seats);
    if (!Number.isFinite(count) || count < MIN_SEATS || count > MAX_SEATS) {
      return [err(conn, `A table seats ${MIN_SEATS} to ${MAX_SEATS}`)];
    }
    const id = this.newId().slice(0, 8);
    this.rooms.set(id, {
      id,
      seed: msg.seed ?? this.newId(),
      // Every chair starts empty. Who or what fills them is decided at the
      // table, by the people who turn up.
      seats: Array.from({ length: count }, (_, i) => ({
        id: `p${i}`, kind: 'open' as const, name: null,
      })),
      lobby: null,
      tokens: new Map(),
      conns: new Map(),
    });
    void now;
    // Creating does not seat you — `join` does, so the flow is the same for
    // everyone and there is no privileged first player.
    return [{ conn, msg: { t: 'created', roomId: id } }];
  }

  /** The pre-game view, which is the same for everyone in the room. */
  private tableFor(room: Room): Envelope[] {
    const msg: Outbound = {
      t: 'table',
      roomId: room.id,
      seats: room.seats.map((s) => ({ ...s })),
      canBegin: room.seats.every((s) => s.kind !== 'open'),
    };
    return [...room.conns.values()].map((conn) => ({ conn, msg }));
  }

  /** Fill an empty chair with a bot, or empty it again. Pre-game only. */
  private setSeat(
    conn: string, index: number, kind: 'bot' | 'open',
  ): Envelope[] {
    const session = this.sessions.get(conn);
    const room = session && this.rooms.get(session.roomId);
    if (!room) return [err(conn, 'Not in a room')];
    if (room.lobby) return [err(conn, 'The game has already begun')];
    const seat = room.seats[index];
    if (!seat) return [err(conn, 'No such seat')];
    // A person in a chair is not something another player may remove.
    if (seat.kind === 'human') return [err(conn, 'Someone is sitting there')];
    seat.kind = kind;
    seat.name = kind === 'bot' ? botName(index) : null;
    return this.tableFor(room);
  }

  /** Deal. */
  private begin(
    conn: string, marked: boolean, now: number,
  ): Envelope[] {
    const session = this.sessions.get(conn);
    const room = session && this.rooms.get(session.roomId);
    if (!room) return [err(conn, 'Not in a room')];
    if (room.lobby) return [err(conn, 'The game has already begun')];
    if (room.seats.some((s) => s.kind === 'open')) {
      return [err(conn, 'Every chair must be filled first')];
    }

    room.lobby = new Lobby({
      seed: room.seed,
      seats: room.seats.map((s) => ({
        name: s.name ?? s.id,
        kind: s.kind === 'bot' ? ('bot' as const) : ('human' as const),
      })),
      marked: marked ? markedIndex(room.seed, room.seats.length) : null,
      config: this.cfg,
    });
    // Everyone already here is present; the lobby starts assuming otherwise.
    for (const seatId of room.conns.keys()) room.lobby.reconnect(seatId, now);
    return this.deliver(room, room.lobby.room.deal());
  }

  private join(conn: string, roomId: string, name: string, now: number): Envelope[] {
    const room = this.rooms.get(roomId);
    if (!room) return [err(conn, 'No such room')];

    // Before the deal you take an empty chair; after it, only a seat whose
    // player has gone and left no claim on it.
    const free = room.lobby
      ? room.seats.find(
        (s) => s.kind === 'human' && !room.conns.has(s.id) && !hasToken(room, s.id),
      )
      : room.seats.find((s) => s.kind === 'open');
    if (!free) return [err(conn, 'Room is full')];

    free.kind = 'human';
    free.name = name;
    if (room.lobby) room.lobby.room.seat(free.id)!.name = name;
    const token = this.newId();
    room.tokens.set(token, free.id);
    room.conns.set(free.id, conn);
    this.sessions.set(conn, { roomId, seat: free.id });
    room.lobby?.reconnect(free.id, now);

    return [
      { conn, msg: { t: 'joined', roomId, seat: free.id, token, dev: this.devTools } },
      ...(room.lobby ? this.syncAll(room) : this.tableFor(room)),
    ];
  }

  private rejoin(conn: string, roomId: string, token: string, now: number): Envelope[] {
    const room = this.rooms.get(roomId);
    if (!room) return [err(conn, 'No such room')];
    const seat = room.tokens.get(token);
    // A bad token must not say whether the room or the token was wrong.
    if (!seat) return [err(conn, 'Cannot rejoin')];

    room.conns.set(seat, conn);
    this.sessions.set(conn, { roomId, seat });
    const events = room.lobby?.reconnect(seat, now) ?? [];

    return [
      { conn, msg: { t: 'joined', roomId, seat, token, dev: this.devTools } },
      ...(room.lobby ? this.syncAll(room) : this.tableFor(room)),
      ...this.lobbyEvents(room, events),
    ];
  }

  private command(conn: string, command: Command): Envelope[] {
    const session = this.sessions.get(conn);
    if (!session) return [err(conn, 'Not seated')];
    const room = this.rooms.get(session.roomId);
    if (!room) return [err(conn, 'No such room')];

    if (!room.lobby) return [err(conn, 'The game has not begun')];
    // The seat comes from the connection, never from the message.
    const res = room.lobby.room.submit(session.seat, command);
    if (!res.ok) return [err(conn, res.error)];

    return res.updates.flatMap((u) => {
      const target = room.conns.get(u.seat);
      return target
        ? [{ conn: target, msg: {
            t: 'state' as const,
            view: u.view, events: u.events, legal: u.legal,
            bots: room.lobby?.room.botSeats ?? [],
          } }]
        : [];
    });
  }

  private vote(
    conn: string, seat: PlayerId, choice: 'bot' | 'wait', now: number,
  ): Envelope[] {
    const session = this.sessions.get(conn);
    if (!session) return [err(conn, 'Not seated')];
    const room = this.rooms.get(session.roomId);
    if (!room) return [err(conn, 'No such room')];

    if (!room.lobby) return [err(conn, 'The game has not begun')];
    const events = room.lobby.vote(session.seat, seat, choice, now);
    return [
      // Tally only — never who voted.
      ...this.broadcast(room, { t: 'vote', seat, state: room.lobby.voteState(seat) }),
      ...this.lobbyEvents(room, events),
    ];
  }

  // ------------------------------------------------------------- lifecycle

  disconnect(conn: string, now: number): Envelope[] {
    const session = this.sessions.get(conn);
    this.sessions.delete(conn);
    if (!session) return [];
    const room = this.rooms.get(session.roomId);
    if (!room) return [];
    if (room.conns.get(session.seat) === conn) room.conns.delete(session.seat);

    // Before the deal there is nothing to hold a seat for: someone who closes
    // the tab has left the queue, and the chair should go back to whoever is
    // still waiting. The disconnect machinery — grace, vote, botify — is about
    // abandoning a game in progress, which has not started yet.
    if (!room.lobby) {
      const seat = room.seats.find((x) => x.id === session.seat);
      if (seat && seat.kind === 'human') { seat.kind = 'open'; seat.name = null; }
      for (const [token, id] of room.tokens) {
        if (id === session.seat) room.tokens.delete(token);
      }
      // An empty room before the deal is just an empty room.
      if (room.conns.size === 0) this.rooms.delete(room.id);
      return this.tableFor(room);
    }

    // The token survives, so the seat can be reclaimed.
    return this.lobbyEvents(room, room.lobby.disconnect(session.seat, now));
  }

  /**
   * Drive every room's timers, and let bots take one action apiece when their
   * pause has elapsed. The transport calls this on an interval.
   */
  tick(now: number): Envelope[] {
    const out: Envelope[] = [];
    for (const [id, room] of [...this.rooms]) {
      // A room waiting to be dealt has no timers and no bots to drive. It is
      // held open by the people in it, and released when the last one goes.
      if (!room.lobby) continue;
      out.push(...this.lobbyEvents(room, room.lobby.tick(now)));

      const game = room.lobby.room;
      if (game.awaitingBot) {
        const due = this.nextBotAt.get(id) ?? 0;
        if (now >= due) {
          const updates = game.stepBot();
          if (updates) {
            out.push(...this.deliver(room, updates));
            const active = updates[0]?.view.activePlayer;
            const changed = !!active && this.lastActive.get(id) !== active;
            if (active) this.lastActive.set(id, active);
            this.nextBotAt.set(
              id, now + this.pauseAfter(updates[0]?.events ?? [], changed),
            );
          }
        }
      } else {
        // A human is up: the next bot should act promptly, not after a pause
        // left over from last time.
        this.nextBotAt.delete(id);
      }

      if (room.lobby.closed) {
        this.rooms.delete(id);
        this.nextBotAt.delete(id);
        this.lastActive.delete(id);
      }
    }
    return out;
  }

  /**
   * How long to wait before the next bot acts, given what this one just did.
   *
   * Floored by `minGapMs`, then paid per sentence rather than per event,
   * because several events merge into one:
   * "Bell plays Six-Gun — 1 damage to The Cardsharp · cleared · Bell collects a
   * Bounty" is one thing to read, and paying it four pauses makes the game
   * crawl. An action that says nothing gets out of the way instead. Capped,
   * because a bad Dusk should slow the table down, not stop it.
   */
  private pauseAfter(events: readonly GameEvent[], turnChanged: boolean): number {
    const beats = beatsIn(events, turnChanged);
    const paced = beats === 0
      ? this.quietMs
      : this.botDelayMs + this.readMs * Math.min(beats - 1, 8)
        + (hasDusk(events) ? this.duskMs : 0)
        + (hasTurning(events) ? this.turningMs : 0);
    // The floor applies to every action, silent ones included. A bot that
    // spends a card for Grit has still moved a card off the table, and at this
    // pace that is worth a look.
    return Math.max(this.minGapMs, paced);
  }

  /**
   * Leave the seat on purpose.
   *
   * The same release a dropped socket gets, plus the token, so the seat cannot
   * be silently reclaimed by someone who chose to walk away from it.
   */
  private leave(conn: string, now: number): Envelope[] {
    const session = this.sessions.get(conn);
    const out = this.disconnect(conn, now);
    if (session) {
      const room = this.rooms.get(session.roomId);
      // Found by seat: the session does not carry the token, and it should not
      // start to — a token is a credential and the fewer places it sits, the
      // fewer places it leaks from.
      for (const [token, seat] of room?.tokens ?? []) {
        if (seat === session.seat) room!.tokens.delete(token);
      }
    }
    return out;
  }

  /** Development affordances. Refused flat unless `devTools` was asked for. */
  private dev(conn: string, action: 'turning' | 'restart'): Envelope[] {
    if (!this.devTools) return [err(conn, 'Not available')];
    const session = this.sessions.get(conn);
    const room = session && this.rooms.get(session.roomId);
    if (!session || !room?.lobby) return [err(conn, 'Not in a room')];
    const game = room.lobby.room;
    const updates = action === 'turning'
      ? game.devForceTurning()
      // A distinct seed each time, or "deal again" deals the same game again.
      : game.devRestart(`${session.roomId}-${this.dealt++}`);
    // The pacing clock is stale after either of these.
    this.nextBotAt.delete(session.roomId);
    return this.deliver(room, updates);
  }

  // --------------------------------------------------------------- sending

  /** Route per-seat updates to whoever is holding that seat. */
  private deliver(room: Room, updates: Update[]): Envelope[] {
    return updates.flatMap((u) => {
      const target = room.conns.get(u.seat);
      return target
        ? [{ conn: target, msg: {
            t: 'state' as const,
            view: u.view, events: u.events, legal: u.legal,
            bots: room.lobby?.room.botSeats ?? [],
          } }]
        : [];
    });
  }

  private syncAll(room: Room): Envelope[] {
    return (room.lobby?.sync() ?? []).flatMap((u) => {
      const target = room.conns.get(u.seat);
      return target
        ? [{ conn: target, msg: {
            t: 'state' as const,
            view: u.view, events: u.events, legal: u.legal,
            bots: room.lobby?.room.botSeats ?? [],
          } }]
        : [];
    });
  }

  private broadcast(room: Room, msg: Outbound): Envelope[] {
    return [...room.conns.values()].map((conn) => ({ conn, msg }));
  }

  private lobbyEvents(room: Room, events: ReturnType<Lobby['tick']>): Envelope[] {
    return events.flatMap((event) => [
      ...this.broadcast(room, { t: 'lobby', event }),
      // A seat handed to a bot, or handed back, changes what everyone sees.
      ...(event.t === 'BOTIFIED' || event.t === 'RECLAIMED' ? this.syncAll(room) : []),
    ]);
  }
}

/** Shape-check an inbound payload. Types do not survive the wire. */
function parse(raw: unknown): Inbound | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const str = (k: string) => typeof m[k] === 'string';
  switch (m.t) {
    case 'create':
      // A count now, not a list of seats — the shape check has to move with it
      // or every create is rejected as malformed.
      return typeof m.seats === 'number' ? (m as Inbound) : null;
    case 'join':
      return str('roomId') && str('name') ? (m as Inbound) : null;
    case 'rejoin':
      return str('roomId') && str('token') ? (m as Inbound) : null;
    case 'command':
      return typeof m.command === 'object' && m.command !== null
        && typeof (m.command as Record<string, unknown>).t === 'string'
        ? (m as Inbound) : null;
    case 'vote':
      return str('seat') && (m.choice === 'bot' || m.choice === 'wait')
        ? (m as Inbound) : null;
    case 'dev':
      return m.action === 'turning' || m.action === 'restart'
        ? (m as Inbound) : null;
    case 'leave':
      return m as Inbound;
    case 'seat':
      return typeof m.index === 'number'
        && (m.kind === 'bot' || m.kind === 'open') ? (m as Inbound) : null;
    case 'begin':
      return typeof m.marked === 'boolean' ? (m as Inbound) : null;
    default:
      return null;
  }
}

const err = (conn: string, message: string): Envelope => ({
  conn, msg: { t: 'error', message },
});

const hasToken = (room: Room, seat: PlayerId): boolean =>
  [...room.tokens.values()].includes(seat);
