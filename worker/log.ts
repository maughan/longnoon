// What a room actually persists: a seed and an ordered list of commands.
//
// Not the GameState. Three reasons, in the order they mattered:
//
//   1. The state shape changes most weeks during balance work — this session
//      alone added `StreetSlot.escalation`, `GameState.shuttered`,
//      `CardInstance.offeredUntil` and three TUNING keys. A stored blob needs a
//      migration for every one of those. A command log needs none, because the
//      engine that reads it is the engine that wrote it.
//   2. It is small. A full game is a few hundred commands of a few dozen bytes.
//   3. It is a replay. Every playtest becomes a file the simulator can load,
//      which is worth more to this project right now than crash safety.
//
// The engine guarantees this works: seed + ordered commands reconstructs an
// identical game (CLAUDE.md invariant 1). That invariant was written for replay
// and determinism testing; this is the first thing to actually depend on it.

import type { Command, PlayerId } from '../engine/state';
import type { SeatConfig } from '../server/room';

/**
 * One entry in the log.
 *
 * Bot commands are recorded exactly like human ones. They have to be: a bot's
 * choice depends on RNG and on the view at the time, and re-deriving it during
 * a rebuild would mean re-running the policy against a state that is only
 * partly built. Writing down what it did removes the question.
 */
export type LogEntry =
  | { k: 'cmd'; seat: PlayerId; command: Command }
  /**
   * A development action, which is not a command and does not pass isLegal.
   * Logged so a replay of a dev-tooled playtest still reconstructs.
   */
  | { k: 'dev'; action: 'turning' };

/** Everything about a room that is not the game itself. */
export interface RoomMeta {
  roomId: string;
  seed: string;
  /** The chairs. Decided before the deal, fixed once it happens. */
  seats: TableSeatRecord[];
  /** Null until someone deals. */
  marked: number | null;
  begun: boolean;
  /** Wall-clock ms, for the replay file only. Never read by the engine. */
  createdAt: number;
}

export interface TableSeatRecord {
  id: PlayerId;
  kind: 'open' | 'human' | 'bot';
  name: string | null;
  /** Issued on join, required to reclaim. Never leaves the object. */
  token: string | null;
  /**
   * The passport of whoever owns this chair — see `ClientMsg['join']`.
   *
   * Survives the token, which is what makes "I dropped and the room says it is
   * full" recoverable. Never leaves the object either: it is the credential for
   * this seat and therefore for its hidden role.
   *
   * Optional on the record, because rooms written before it exists rehydrate
   * without one.
   */
  player?: string | null;
}

/** The seats as `GameRoom` wants them, once every chair is filled. */
export function seatConfigs(meta: RoomMeta): SeatConfig[] {
  return meta.seats.map((s) => ({
    name: s.name ?? s.id,
    kind: s.kind === 'bot' ? ('bot' as const) : ('human' as const),
  }));
}

/**
 * The replay file, as served by GET /rooms/:id/replay.
 *
 * Deliberately contains no player names beyond the seats and no view data —
 * it is the input to a rebuild, and anything else in here would be a second
 * copy of the game to keep in step.
 */
export interface Replay {
  roomId: string;
  seed: string;
  seats: { id: PlayerId; kind: string; name: string | null }[];
  marked: number | null;
  begun: boolean;
  createdAt: number;
  entries: LogEntry[];
}
