// A game room. Transport-agnostic on purpose: no sockets, no HTTP, no timers —
// just "a seat submitted a command, here is what every seat should now be told".
// A WebSocket layer wraps this; tests drive it directly.
//
// The room is the authority. It holds `GameState`; a seat only ever receives
// `playerView` output plus the events it is allowed to see.

import type {
  GameState, Command, PlayerId, Tuning, GameEvent,
} from '../engine/state';
import { setup } from '../engine/setup';
import { start, apply, checkTurning, IllegalCommand } from '../engine/reducer';
import { legalCommands, isLegal } from '../engine/legal';
import { playerView, type ClientState } from '../engine/view';
import { randAt } from '../engine/rng';
import { POLICIES } from '../sim/bots';
import { visibleEvents } from './events';

export type SeatKind = 'human' | 'bot';

export interface Seat {
  id: PlayerId;
  name: string;
  kind: SeatKind;
  /** Bot policy name; also retained for a human seat that gets botified. */
  policy: string;
  connected: boolean;
}

export interface SeatConfig {
  name: string;
  kind?: SeatKind;
  policy?: string;
}

export interface RoomOptions {
  seed: string;
  seats: SeatConfig[];
  /** Seat index of the Marked player, or null for a traitorless table. */
  marked?: number | null;
  tuning?: Partial<Tuning>;
  /** Policy a seat plays when nobody is driving it. */
  defaultBotPolicy?: string;
}

/** What one seat should be sent after something happened. */
export interface Update {
  seat: PlayerId;
  view: ClientState;
  events: GameEvent[];
  /** This seat's own legal moves — see protocol.ts. Empty when it is not
   *  their turn, which is exactly what the UI needs to grey everything out. */
  legal: Command[];
}

export type SubmitResult =
  | { ok: true; updates: Update[] }
  | { ok: false; error: string };

export class GameRoom {
  readonly seats: Seat[];
  private state: GameState;
  /** Seeded, so a room replays identically given the same command sequence. */
  private botCursor = 0;
  private readonly seed: string;
  private readonly defaultBotPolicy: string;
  /**
   * The deal, held until somebody is listening.
   *
   * `start()` returns the events that opened the game — the first Threats
   * arriving, the first hand drawn — and they used to be thrown away with the
   * rest of the return value. So the opening hand appeared with no line in the
   * chronicle, no sound and no deal animation: the one hand every player looks
   * at hardest arrived as if it had always been there.
   */
  private opening: GameEvent[] = [];

  /** Kept so a dev restart deals the same shape of game. */
  private readonly markedIndex: number | null;
  private readonly tuning?: Partial<Tuning>;

  constructor(opts: RoomOptions) {
    this.seed = opts.seed;
    this.defaultBotPolicy = opts.defaultBotPolicy ?? 'Balanced';
    this.markedIndex = opts.marked ?? null;
    this.tuning = opts.tuning;
    this.seats = opts.seats.map((s, i) => ({
      id: `p${i}`,
      name: s.name,
      kind: s.kind ?? 'human',
      policy: s.policy ?? this.defaultBotPolicy,
      connected: (s.kind ?? 'human') === 'human',
    }));
    const opening = start(
      setup({
        seed: opts.seed,
        players: this.seats.map((s) => s.name),
        markedIndex: opts.marked ?? null,
        tuning: opts.tuning,
      }),
    );
    this.state = opening.state;
    this.opening = opening.events;
  }

  get winner(): GameState['winner'] {
    return this.state.winner;
  }

  get over(): boolean {
    return this.state.winner !== null;
  }

  /** Whose input the room is currently waiting on, or null if it is over. */
  get waitingOn(): PlayerId | null {
    if (this.state.winner) return null;
    return this.state.pending ? this.state.pending.player : this.state.activePlayer;
  }

  /**
   * The seats nobody is driving.
   *
   * Public information — everyone watched the chairs being filled before the
   * deal — but the engine has no idea: `PlayerState` has a role and a status,
   * not a kind. Bots are a seating arrangement, so this travels with the
   * transport rather than being wedged into `playerView`.
   */
  get botSeats(): PlayerId[] {
    return this.seats.filter((s) => s.kind === 'bot').map((s) => s.id);
  }

  seat(id: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.id === id);
  }

  view(seatId: PlayerId | 'spectator'): ClientState {
    return playerView(this.state, seatId);
  }

  legal(seatId: PlayerId): Command[] {
    return legalCommands(this.state, seatId);
  }

  /**
   * Accept a command from a seat.
   *
   * Every inbound command is checked against `legalCommands` before `apply`
   * touches it — `apply` validates its own preconditions, but only `isLegal`
   * rejects things the rules never offered at all. tech-spec.md §4: the client
   * should never send one, and the server must assume it will. In a hidden-role
   * game the player most motivated to try is the Marked one.
   */
  submit(seatId: PlayerId, command: Command): SubmitResult {
    if (this.over) return { ok: false, error: 'Game is over' };
    if (!this.seat(seatId)) return { ok: false, error: 'No such seat' };
    if (this.waitingOn !== seatId) return { ok: false, error: 'Not your turn' };
    if (!isLegal(this.state, seatId, command)) {
      return { ok: false, error: 'Illegal command' };
    }

    const events: GameEvent[] = [];
    try {
      const r = apply(this.state, seatId, command);
      this.state = r.state;
      events.push(...r.events);
    } catch (err) {
      // isLegal should have caught this; if not, the gate has a hole worth
      // knowing about rather than a 500.
      return {
        ok: false,
        error: err instanceof IllegalCommand ? err.message : String(err),
      };
    }

    return { ok: true, updates: this.broadcast(events) };
  }

  /** True when the room is waiting on a seat nobody is driving. */
  get awaitingBot(): boolean {
    const actor = this.waitingOn;
    return !!actor && this.seat(actor)?.kind === 'bot';
  }

  /**
   * Play exactly ONE bot command.
   *
   * Deliberately one at a time. Resolving a whole bot turn inside `submit` made
   * three opponents act in a single flash — a playtester's words: "other than
   * the event log, I have no clue what is happening." Pacing is the transport's
   * job, so this returns after a single action and lets the caller decide when
   * the next one happens.
   */
  /**
   * What a bot would do, without doing it.
   *
   * Added for the Durable Object port, which persists an ordered command log
   * rather than the state — so it has to know WHICH command a bot chose in
   * order to write it down. `stepBot` picks and applies in one breath and
   * never says what it picked.
   *
   * The RNG cursor is a parameter rather than the instance counter, and the
   * worker passes the log length. That makes a bot's choice a pure function of
   * the log, so a room rebuilt after hibernation carries on making the same
   * decisions a room that never slept would have made. With the counter, a
   * rebuilt room silently restarted its bots' dice.
   */
  botCommand(cursor: number): { seat: PlayerId; command: Command } | null {
    if (this.over) return null;
    const actor = this.waitingOn;
    if (!actor) return null;
    const seat = this.seat(actor);
    if (!seat || seat.kind !== 'bot') return null;

    const legal = legalCommands(this.state, actor);
    if (!legal.length) return null;
    const bot = POLICIES[seat.policy] ?? POLICIES[this.defaultBotPolicy];
    return {
      seat: actor,
      command: bot({
        view: playerView(this.state, actor),
        legal,
        rand: () => randAt(`${this.seed}:room`, cursor++),
      }),
    };
  }

  stepBot(): Update[] | null {
    if (this.over) return null;
    const actor = this.waitingOn;
    if (!actor) return null;
    const seat = this.seat(actor);
    if (!seat || seat.kind !== 'bot') return null;

    const legal = legalCommands(this.state, actor);
    if (!legal.length) return null;
    const bot = POLICIES[seat.policy] ?? POLICIES[this.defaultBotPolicy];
    const cmd = bot({
      view: playerView(this.state, actor),
      legal,
      rand: () => randAt(`${this.seed}:room`, this.botCursor++),
    });
    const r = apply(this.state, actor, cmd);
    this.state = r.state;
    return this.broadcast(r.events);
  }

  /**
   * Development only — see `Hub`'s `devTools` gate, which is off by default.
   *
   * Forcing the Turning goes through `checkTurning` rather than reimplementing
   * it: the Whisper track is pushed to its threshold and the real rule fires,
   * so the Vessel is chosen, every Sign turns, the Street flips its reverses
   * and the Marked player's aim is scored exactly as it would have been. A
   * second implementation of the hinge of the game is the last thing this
   * project needs.
   *
   * This is NOT a command and deliberately does not go through `isLegal` — it
   * is not a move anyone is ever offered. That is also precisely why it must
   * never be reachable in a real game: choosing the moment of the Turning is
   * the single most valuable thing the Marked player could buy.
   */
  devForceTurning(): Update[] {
    if (this.state.act !== 'trouble' || this.over) return [];
    const ev: GameEvent[] = [];
    this.state = structuredClone(this.state);
    this.state.whispers = this.state.tuning.whisperThreshold;
    checkTurning(this.state, ev);
    return this.broadcast(ev);
  }

  /**
   * Development only. Deals a fresh game to the same seats.
   *
   * There is no way back from the Turning: Signs are permanently Fevered, the
   * Vessel has been named, the Trouble deck is gone. Reversing it would mean a
   * second implementation of the rules running backwards. A new deal is the
   * honest way to see Act I again.
   */
  devRestart(seed: string): Update[] {
    const opening = start(setup({
      seed,
      players: this.seats.map((s) => s.name),
      markedIndex: this.markedIndex,
      tuning: this.tuning,
    }));
    this.state = opening.state;
    this.opening = opening.events;
    return this.deal();
  }

  private broadcast(events: GameEvent[]): Update[] {
    return this.seats.map((s) => ({
      seat: s.id,
      view: playerView(this.state, s.id),
      events: visibleEvents(events, s.id),
      legal: legalCommands(this.state, s.id),
    }));
  }

  /** Current state for every seat, with no events — for a fresh connection. */
  sync(): Update[] {
    return this.broadcast([]);
  }

  /**
   * The first broadcast of a game, carrying the deal.
   *
   * Delivered once. A later `sync` — someone rejoining mid-game — sends state
   * with no events, which is right: they are catching up, not being dealt to.
   */
  deal(): Update[] {
    const ev = this.opening;
    this.opening = [];
    return this.broadcast(ev);
  }

  // -------------------------------------------------------------- presence

  setConnected(seatId: PlayerId, connected: boolean): void {
    const s = this.seat(seatId);
    if (s) s.connected = connected;
  }

  /**
   * Hand a seat to a bot. The bot inherits the seat's secret role — it has to,
   * or replacing a player would reveal one — so it plays the Marked policy if
   * that is what the seat is. See docs/tech-spec.md §11.
   */
  botify(seatId: PlayerId, policy?: string): SubmitResult {
    const s = this.seat(seatId);
    if (!s) return { ok: false, error: 'No such seat' };
    s.kind = 'bot';
    if (policy) s.policy = policy;
    return { ok: true, updates: this.sync() };
  }

  /** A human reclaims their seat from the bot that was holding it. */
  reclaim(seatId: PlayerId): SubmitResult {
    const s = this.seat(seatId);
    if (!s) return { ok: false, error: 'No such seat' };
    s.kind = 'human';
    s.connected = true;
    return { ok: true, updates: this.sync() };
  }

  /** Nobody left to play for. */
  get abandoned(): boolean {
    return this.seats.every((s) => s.kind === 'bot' || !s.connected);
  }

  /**
   * `seed` plus the ordered command list reconstructs this game exactly
   * (invariant 1), so closing a room need not lose it.
   */
  get log(): GameEvent[] {
    return this.state.log;
  }
}
