// Wire messages. Shared by the socket server and, eventually, the client.
//
// Note what a `command` message does NOT carry: a seat. The server takes the
// seat from the connection that sent it, never from the payload. Letting a
// client name its own seat would let one player act as another — and in a
// hidden-role game, act as the one whose secrets they want.

import type { Command, GameEvent, PlayerId } from '../engine/state';
import type { ClientState } from '../engine/view';
import type { LobbyEvent, VoteState } from './lobby';

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
  join: { roomId: string; name: string };
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
   * Development affordances: force the Turning, deal a fresh game.
   *
   * Rejected outright unless the server was started with `devTools: true`, and
   * that is off by default. This is not paranoia about a stray build — forcing
   * the Turning is the single most valuable thing the Marked player could buy,
   * since their secret aim is scored at that exact instant.
   */
  dev: { action: 'turning' | 'restart' };
}

export interface ServerMsg {
  /** A room exists. Creating one does not seat you — `join` does. */
  created: { roomId: string };
  /** `dev` tells the client whether to offer the act controls at all. */
  joined: { roomId: string; seat: PlayerId; token: string; dev: boolean };
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
  };
  /**
   * `legal` is sent because a client cannot derive it: `legalCommands` needs
   * `GameState`, and a client only ever holds `playerView` output. Shipping the
   * list keeps tech-spec.md §4's promise — one function drives both the UI's
   * button state and the bots' action space, with no second implementation to
   * drift. It leaks nothing: the list only ever contains that seat's own moves.
   */
  state: { view: ClientState; events: GameEvent[]; legal: Command[] };
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
