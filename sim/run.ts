// The batch runner. Plays whole games headlessly and records the numbers
// DESIGN.md §10 and CLAUDE.md ask for.
//
// The harness holds GameState because it IS the authority — the server role.
// What it hands a bot is `playerView` output and nothing else. That boundary is
// the whole point of invariant 3, and it is asserted in tests/sim.test.ts.

import type { GameState, PlayerId, Tuning, GameEvent } from '../engine/state';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { playerView } from '../engine/view';
import { signsHeld } from '../engine/effects';
import { randAt } from '../engine/rng';
import { card } from '../content/cards';
import { POLICIES } from './bots';

export type Outcome = 'posse' | 'oldOne' | 'stall' | 'error';

export interface RunConfig {
  seed: string;
  /** One policy name per seat. Length sets the player count. */
  policies: string[];
  /** Seat index of the Marked player, or null for a traitorless table. */
  marked?: number | null;
  /** Policy for the Marked seat, if it should differ from its listed policy. */
  markedPolicy?: string;
  tuning?: Partial<Tuning>;
  maxRounds?: number;
  maxSteps?: number;
}

export interface GameResult {
  seed: string;
  policies: string[];
  players: number;
  marked: number | null;
  outcome: Outcome;
  rounds: number;
  /** Round the Whisper track tripped, or null if the game never Turned. */
  turningRound: number | null;
  /** Turning round as a fraction of total game length. Want ≈0.6. */
  turningPct: number | null;
  /** Signs held across the table at the moment of the Turning. */
  signsAtTurningAvg: number | null;
  signsAtTurningMax: number | null;
  /** Round of the first player knocked out. Round-4 deaths are the alarm. */
  firstFallRound: number | null;
  /** Round the finite Provision deck ran out. Should be ≈5. */
  provisionDryRound: number | null;
  doom: number;
  /** How many times the Whisper track filled in Act II. Doom's other source. */
  whisperFills: number;
  vesselDamage: number;
  vesselPolicy: string | null;
  signsBought: number;
  /** Purchases of the two Street-facing Signs, for the depth-vs-breadth read. */
  dynamiteBought: number;
  coltBought: number;
  /** Omens brought down by Dynamite, and Omens still standing at the end. */
  omensBanished: number;
  omensLeft: number;
  /** Scars per player at the Turning — the Omen mode is a Scar pump. */
  scarsAtTurning: number | null;
  /** Sign purchases by the seat that ended up as the Vessel. */
  signsBoughtByVessel: number | null;
  steps: number;
  error?: string;
}

const DEFAULTS = { maxRounds: 40, maxSteps: 20_000 };

export function runGame(cfg: RunConfig): GameResult {
  const maxRounds = cfg.maxRounds ?? DEFAULTS.maxRounds;
  const maxSteps = cfg.maxSteps ?? DEFAULTS.maxSteps;
  const marked = cfg.marked ?? null;

  const result: GameResult = {
    seed: cfg.seed,
    policies: cfg.policies,
    players: cfg.policies.length,
    marked,
    outcome: 'stall',
    rounds: 0,
    turningRound: null,
    turningPct: null,
    signsAtTurningAvg: null,
    signsAtTurningMax: null,
    firstFallRound: null,
    provisionDryRound: null,
    doom: 0,
    whisperFills: 0,
    vesselDamage: 0,
    vesselPolicy: null,
    signsBought: 0,
    dynamiteBought: 0,
    coltBought: 0,
    omensBanished: 0,
    omensLeft: 0,
    scarsAtTurning: null,
    signsBoughtByVessel: null,
    steps: 0,
  };

  const signsBySeat = new Array(cfg.policies.length).fill(0);
  const seatOf = (pid: PlayerId) => Number(pid.slice(1));

  try {
    let s: GameState = start(
      setup({
        seed: cfg.seed,
        players: cfg.policies.map((p, i) => `${p}-${i}`),
        markedIndex: marked,
        tuning: cfg.tuning,
      }),
    ).state;

    // Bot randomness is seeded and cursor-driven, so a rerun of the same
    // config reproduces the game exactly — including the Random policy.
    let cursor = 0;
    const rand = () => randAt(`${cfg.seed}:bot`, cursor++);

    let steps = 0;
    while (!s.winner && steps < maxSteps && s.round <= maxRounds) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break; // nothing to do and nobody can act: deadlock

      const seat = seatOf(actor);
      const name = seat === marked && cfg.markedPolicy
        ? cfg.markedPolicy
        : cfg.policies[seat];
      const bot = POLICIES[name];
      if (!bot) throw new Error(`Unknown policy: ${name}`);

      const cmd = bot({ view: playerView(s, actor), legal, rand });
      const wasAct = s.act;
      const next = apply(s, actor, cmd);
      s = next.state;
      steps++;

      record(s, next.events, wasAct, result, signsBySeat);
    }

    result.steps = steps;
    result.rounds = s.round;
    result.doom = s.doom;
    result.omensLeft = s.street
      .filter((sl) => sl && card(sl.instance.cardId).type === 'omen').length;
    result.whisperFills = s.whisperFills;
    result.vesselDamage = s.vesselDamage;
    result.outcome = s.winner ?? 'stall';
    result.signsBought = signsBySeat.reduce((a, b) => a + b, 0);

    if (s.vessel !== null) {
      const seat = seatOf(s.vessel);
      result.vesselPolicy = cfg.policies[seat] ?? null;
      result.signsBoughtByVessel = signsBySeat[seat] ?? null;
    }
    if (result.turningRound !== null && s.round > 0) {
      result.turningPct = result.turningRound / s.round;
    }
  } catch (err) {
    result.outcome = 'error';
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

function record(
  s: GameState,
  events: GameEvent[],
  wasAct: GameState['act'],
  r: GameResult,
  signsBySeat: number[],
): void {
  if (wasAct === 'trouble' && s.act === 'mythos' && r.turningRound === null) {
    r.turningRound = s.round;
    const held = s.turnOrder.map((id) => signsHeld(s, id));
    r.signsAtTurningAvg = held.reduce((a, b) => a + b, 0) / held.length;
    r.signsAtTurningMax = Math.max(...held);
    const scars = s.turnOrder.map((id) => s.players[id].scars);
    r.scarsAtTurning = scars.reduce((a, b) => a + b, 0) / scars.length;
  }

  for (const ev of events) {
    if (ev.t === 'FELL' && r.firstFallRound === null) r.firstFallRound = s.round;
    if (ev.t === 'BOUGHT' && card(ev.cardId).type === 'sign') {
      const seat = Number(ev.player.slice(1));
      signsBySeat[seat] = (signsBySeat[seat] ?? 0) + 1;
      if (ev.cardId === 'dynamite') r.dynamiteBought += 1;
      if (ev.cardId === 'colt') r.coltBought += 1;
    }
    // An Omen can only leave the Street one way now, so a THREAT_CLEARED on
    // one is unambiguously a banish.
    if (ev.t === 'THREAT_CLEARED' && card(ev.cardId).type === 'omen') {
      r.omensBanished += 1;
    }
  }

  if (r.provisionDryRound === null && s.supply.provisions.length === 0) {
    r.provisionDryRound = s.round;
  }
}

// ---------------------------------------------------------------- batches

export interface BatchConfig extends Omit<RunConfig, 'seed'> {
  games: number;
  /** Seeds are `${seedPrefix}-${i}` so any run is reproducible by index. */
  seedPrefix?: string;
}

export function runBatch(cfg: BatchConfig): GameResult[] {
  const prefix = cfg.seedPrefix ?? 'noon';
  const out: GameResult[] = [];
  for (let i = 0; i < cfg.games; i++) {
    out.push(runGame({ ...cfg, seed: `${prefix}-${i}` }));
  }
  return out;
}
