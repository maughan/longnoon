// Presence, disconnect timers and the botify vote — docs/tech-spec.md §11.
//
// The lobby never reads a clock. Every entry point takes `now` and `tick(now)`
// drives the state machine, which keeps `server/` under the determinism lint and
// makes every timeout testable without waiting for one. Wall-clock time is the
// transport layer's problem.
//
// Ballots are secret by construction: `voteState` reports the tally and what is
// needed, never who voted. In a hidden-role game, who wants whom replaced by a
// bot is a read on the table.

import type { PlayerId } from '../engine/state';
import { GameRoom, type RoomOptions, type Update } from './room';

export interface LobbyConfig {
  /** How long a seat may be absent before a vote opens. */
  graceMs: number;
  /** How long a vote stays open before it resolves itself. */
  voteMs: number;
  /** How long an empty lobby survives before closing. */
  abandonMs: number;
  /** How many times "keep waiting" may win before the seat is botified anyway. */
  maxExtensions: number;
  /**
   * Grace for the Vessel in Act II. If the Old One drops, the posse cannot
   * proceed at all, so that seat gets a shorter fuse and no vote.
   */
  vesselGraceMs: number;
}

export const DEFAULT_LOBBY: LobbyConfig = {
  graceMs: 60_000,
  voteMs: 45_000,
  abandonMs: 300_000,
  maxExtensions: 2,
  vesselGraceMs: 20_000,
};

export type BotifyReason = 'vote' | 'noQuorum' | 'extensionsSpent' | 'vessel';

export type LobbyEvent =
  | { t: 'VOTE_OPENED'; seat: PlayerId; deadline: number }
  | { t: 'BOTIFIED'; seat: PlayerId; reason: BotifyReason }
  | { t: 'RECLAIMED'; seat: PlayerId }
  | { t: 'CLOSED' };

interface Absence {
  since: number;
  /** When the vote opens, or null once it has. */
  voteOpensAt: number | null;
  voteClosesAt: number | null;
  extensions: number;
  ballots: Map<PlayerId, 'bot' | 'wait'>;
}

export interface VoteState {
  open: boolean;
  deadline: number | null;
  /** Counts only — never who voted. */
  cast: number;
  needed: number;
  extensionsLeft: number;
}

export class Lobby {
  readonly room: GameRoom;
  private readonly cfg: LobbyConfig;
  private readonly absent = new Map<PlayerId, Absence>();
  private closeAt: number | null = null;
  private closedFlag = false;

  constructor(opts: RoomOptions & { config?: Partial<LobbyConfig> }) {
    this.room = new GameRoom(opts);
    this.cfg = { ...DEFAULT_LOBBY, ...opts.config };
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  /** Seats a human is currently driving. */
  private get present(): PlayerId[] {
    return this.room.seats
      .filter((s) => s.kind === 'human' && s.connected)
      .map((s) => s.id);
  }

  // ------------------------------------------------------------- presence

  disconnect(seatId: PlayerId, now: number): LobbyEvent[] {
    const seat = this.room.seat(seatId);
    if (!seat || seat.kind !== 'human' || !seat.connected) return [];
    this.room.setConnected(seatId, false);

    // The Old One dropping stops the game dead — short fuse, and no vote.
    const isVessel = this.room.view('spectator').vessel === seatId;
    const grace = isVessel ? this.cfg.vesselGraceMs : this.cfg.graceMs;

    this.absent.set(seatId, {
      since: now,
      voteOpensAt: now + grace,
      voteClosesAt: null,
      extensions: 0,
      ballots: new Map(),
    });
    return this.tick(now);
  }

  reconnect(seatId: PlayerId, now: number): LobbyEvent[] {
    const seat = this.room.seat(seatId);
    if (!seat) return [];
    this.absent.delete(seatId);
    this.closeAt = null;
    const wasBot = seat.kind === 'bot';
    this.room.reclaim(seatId);
    const out: LobbyEvent[] = wasBot ? [{ t: 'RECLAIMED', seat: seatId }] : [];
    return [...out, ...this.tick(now)];
  }

  // ----------------------------------------------------------------- vote

  /** Tally and requirement only. Deliberately says nothing about who voted. */
  voteState(seatId: PlayerId): VoteState {
    const a = this.absent.get(seatId);
    const open = !!a?.voteClosesAt;
    return {
      open,
      deadline: a?.voteClosesAt ?? null,
      cast: a ? a.ballots.size : 0,
      needed: this.majority(),
      extensionsLeft: a ? Math.max(0, this.cfg.maxExtensions - a.extensions) : 0,
    };
  }

  private majority(): number {
    return Math.floor(this.present.length / 2) + 1;
  }

  vote(voter: PlayerId, seatId: PlayerId, choice: 'bot' | 'wait', now: number): LobbyEvent[] {
    const a = this.absent.get(seatId);
    if (!a?.voteClosesAt) return [];
    if (!this.present.includes(voter)) return []; // only those still here
    a.ballots.set(voter, choice);
    return this.tick(now);
  }

  // ----------------------------------------------------------------- tick

  /** Advance every timer to `now`. Safe to call as often as you like. */
  tick(now: number): LobbyEvent[] {
    if (this.closedFlag) return [];
    const out: LobbyEvent[] = [];

    for (const [seatId, a] of [...this.absent]) {
      if (this.room.over) break;

      // Grace elapsed: either open a vote, or act alone if nobody is left.
      if (a.voteOpensAt !== null && now >= a.voteOpensAt) {
        a.voteOpensAt = null;
        if (this.room.view('spectator').vessel === seatId) {
          out.push(...this.botify(seatId, 'vessel'));
          continue;
        }
        if (this.present.length === 0) {
          // Nobody to ask, and nobody to play it out for. Leave the seat as it
          // is and let the abandon timer close the room — botifying an empty
          // lobby would just have the bots finish a game no one is watching.
          continue;
        }
        a.voteClosesAt = now + this.cfg.voteMs;
        out.push({ t: 'VOTE_OPENED', seat: seatId, deadline: a.voteClosesAt });
      }

      if (a.voteClosesAt === null) continue;

      const forBot = [...a.ballots.values()].filter((v) => v === 'bot').length;
      const forWait = [...a.ballots.values()].filter((v) => v === 'wait').length;
      const need = this.majority();
      const expired = now >= a.voteClosesAt;

      if (forBot >= need) {
        out.push(...this.botify(seatId, 'vote'));
      } else if (forWait >= need || (expired && forWait > forBot)) {
        // "Keep waiting" resets the clock — but not forever, or the vote
        // becomes an unbounded stall.
        a.extensions++;
        a.ballots.clear();
        if (a.extensions > this.cfg.maxExtensions) {
          out.push(...this.botify(seatId, 'extensionsSpent'));
        } else {
          a.voteClosesAt = null;
          a.voteOpensAt = now + this.cfg.graceMs;
        }
      } else if (expired) {
        // Nobody could agree. Waiting forever is the worse failure.
        out.push(...this.botify(seatId, 'noQuorum'));
      }
    }

    // An empty lobby closes, unless somebody comes back first.
    if (this.present.length === 0) {
      if (this.closeAt === null) this.closeAt = now + this.cfg.abandonMs;
      else if (now >= this.closeAt) {
        this.closedFlag = true;
        out.push({ t: 'CLOSED' });
      }
    } else {
      this.closeAt = null;
    }

    return out;
  }

  private botify(seatId: PlayerId, reason: BotifyReason): LobbyEvent[] {
    this.absent.delete(seatId);
    this.room.botify(seatId);
    return [{ t: 'BOTIFIED', seat: seatId, reason }];
  }

  /** Current state for every seat — for a fresh or returning connection. */
  sync(): Update[] {
    return this.room.sync();
  }
}
