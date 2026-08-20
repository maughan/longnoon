// Wire messages. Shared by the socket server and, eventually, the client.
//
// Note what a `command` message does NOT carry: a seat. The server takes the
// seat from the connection that sent it, never from the payload. Letting a
// client name its own seat would let one player act as another — and in a
// hidden-role game, act as the one whose secrets they want.

import type { Command, GameEvent, PlayerId } from '../engine/state';
import type { ClientState } from '../engine/view';
import type { LobbyEvent, VoteState } from './lobby';

/**
 * How fast the bots play, and nothing else.
 *
 * Only bot pacing — a human's turn takes as long as it takes. The multipliers
 * live in `server/hub.ts`, because the pauses do.
 */
export type Speed = 'normal' | 'fast' | 'fastest';

/** A chair at the table, before there is a game to play at it. */
export interface TableSeat {
  id: PlayerId;
  kind: 'open' | 'human' | 'bot';
  /** The player sitting there, or null for an open or bot seat. */
  name: string | null;
}

export interface ClientMsg {
  /** How many chairs to put out. Who fills them is decided at the table. */
  create: { seats: number; seed?: string };
  /**
   * Take a chair.
   *
   * `player` is a PASSPORT: an unguessable id the client keeps in local
   * storage for good, sent with every join. It is what makes reconnecting
   * survive the loss of a seat token — a room whose chairs are all spoken for
   * answers "Room is full", and without a way to say "one of those chairs is
   * mine" a player who lost their token could never get back in. Checked
   * against the room's own seats BEFORE any search for a free chair.
   *
   * Optional, so a client that has never had one still joins normally.
   *
   * A bearer credential, like the seat token, and handled the same way: never
   * broadcast, never in `TableSeat`, never derived from the game seed. Whoever
   * holds it can take that chair and read its hidden role.
   */
  join: { roomId: string; name: string; player?: string };
  /** Reclaim a seat with the token issued on join. */
  rejoin: { roomId: string; token: string };
  command: { command: Command };
  vote: { seat: PlayerId; choice: 'bot' | 'wait' };
  /**
   * Give up the seat deliberately.
   *
   * Routed through the same path as a dropped socket, so the lobby's timers and
   * botify vote behave identically — the difference between "walked away" and
   * "wifi died" is not one the rules should have to know about. Unlike a
   * disconnect it also burns the token, because someone who has chosen to leave
   * should not silently reclaim the seat on their next page load.
   */
  leave: Record<never, never>;
  /**
   * Fill an empty chair with a bot, or empty it again so a person can take it.
   *
   * Anyone seated may do it. This is a co-operative game being set up by people
   * who are talking to each other; a host with exclusive rights would only add
   * a person to wait for.
   */
  seat: { index: number; kind: 'bot' | 'open' };
  /** Deal. Every chair must be filled first. */
  begin: { marked: boolean };
  /**
   * Shut the room down. **Host only.**
   *
   * Distinct from `leave`, which gives up one seat and leaves the table
   * standing for everybody else. This ends it: every connection is told, the
   * room is forgotten, and the tokens go with it so nobody can rejoin a game
   * that is no longer there.
   */
  close: Record<never, never>;
  /**
   * How fast the bots play. **Host only.**
   *
   * The one setting with an owner, and the exception narrows the ruling above
   * rather than reversing it: chairs and `begin` stay open to everyone. Pacing
   * is table-wide, continuous, and not worth interrupting a game to negotiate
   * — a speed control that needs three people to agree is worse than no speed
   * control.
   *
   * Room state, not a client preference: it has to survive a reconnect and be
   * the same for everyone watching the same bots move.
   */
  speed: { value: Speed };
  /**
   * Development affordances: take any seat, set a status, force the Turning,
   * bring on Dusk, hand out Grit and cards, deal a fresh game.
   *
   * Rejected outright unless the server was started with `devTools: true`, and
   * that is off by default. This is not paranoia about a stray build — forcing
   * the Turning is the single most valuable thing the Marked player could buy,
   * since their secret aim is scored at that exact instant, and `sit` hands
   * over another seat's hand and hidden role outright.
   *
   * One flat shape rather than a union per action, because `parse` has to
   * shape-check whatever arrives off a socket and a flat record is one check
   * with no narrowing to get wrong. Fields not used by an action are ignored.
   */
  dev: {
    action: DevAction;
    /** Who the action is aimed at. Defaults to the sender's own seat. */
    seat?: PlayerId;
    /** `status` only. */
    status?: 'posse' | 'revenant' | 'gone';
    /** `give` only. */
    cardId?: string;
    /** `grit` only. */
    n?: number;
  };
}

/** Every development action. Kept as a list so `parse` can check membership. */
export const DEV_ACTIONS = [
  'turning', 'restart', 'sit', 'status', 'turn', 'dusk', 'grit', 'give',
] as const;

export type DevAction = (typeof DEV_ACTIONS)[number];

export interface ServerMsg {
  /** A room exists. Creating one does not seat you — `join` does. */
  created: { roomId: string };
  /** `dev` tells the client whether to offer the act controls at all. */
  joined: {
    roomId: string; seat: PlayerId; token: string; dev: boolean;
    /** Whether THIS seat is the host, so the client knows to offer the control. */
    host: boolean;
    speed: Speed;
  };
  /**
   * The room before the deal: who is here, which chairs are empty.
   *
   * Sent on every change to anyone in the room. Once the game begins, `state`
   * takes over and this is never sent again.
   */
  table: {
    roomId: string;
    seats: TableSeat[];
    /** False while any chair is still empty. */
    canBegin: boolean;
    /** Who owns the pacing control. Null only in a room with nobody in it. */
    host: PlayerId | null;
    speed: Speed;
  };
  /**
   * The room is gone. Sent to everyone in it, once.
   *
   * Its own message rather than an `error`: being shown the door is not a
   * failure, and a client that treated it as one would show a red box instead
   * of taking you back to the menu.
   */
  closed: { reason: string };
  /**
   * The pacing changed, or the host did.
   *
   * Its own message rather than a re-sent `table`: the client treats a `table`
   * as "we are in the waiting room", so broadcasting one mid-game would eject
   * everybody from the board to the lobby screen. This carries the two fields
   * that actually moved and disturbs nothing else.
   */
  speed: { host: PlayerId | null; speed: Speed; you: boolean };
  /**
   * `legal` is sent because a client cannot derive it: `legalCommands` needs
   * `GameState`, and a client only ever holds `playerView` output. Shipping the
   * list keeps tech-spec.md §4's promise — one function drives both the UI's
   * button state and the bots' action space, with no second implementation to
   * drift. It leaks nothing: the list only ever contains that seat's own moves.
   */
  state: {
    view: ClientState;
    events: GameEvent[];
    legal: Command[];
    /** Which seats are bots. Public, and not something the engine knows. */
    bots: PlayerId[];
  };
  lobby: { event: LobbyEvent };
  vote: { seat: PlayerId; state: VoteState };
  error: { message: string };
}

export type Inbound = {
  [K in keyof ClientMsg]: { t: K } & ClientMsg[K];
}[keyof ClientMsg];

export type Outbound = {
  [K in keyof ServerMsg]: { t: K } & ServerMsg[K];
}[keyof ServerMsg];

/** A message addressed to one connection. */
export interface Envelope {
  conn: string;
  msg: Outbound;
}
