// What "It Chooses" should mean — and whether the answer generalises.
//
// Two questions, measured separately:
//
//   1. HOW WRONG is each mode? Act II Streets are captured from real games and
//      each mode's pick is scored against the pick a competent player would
//      have made. Doing it on captured Streets rather than by instrumenting the
//      reducer keeps the counterfactual honest: all three modes are scored on
//      the SAME boards, so the comparison is not confounded by the games each
//      one happens to produce.
//   2. WHAT DOES IT COST the posse? Full games per mode, post-Turning win rate,
//      and the spread across seed blocks — `random` should widen it, and by how
//      much is the whole question.

import { runBatch, runGame } from './run';
import { makeBot, balanced } from './bots';
import { playerView } from '../engine/view';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { effectiveClear, effectiveMenace, resolveSlots } from '../engine/effects';
import { randInt } from '../engine/rng';
import { card } from '../content/cards';
import type { GameState, Tuning } from '../engine/state';

const GAMES = Number(process.argv[2] ?? 200);
const MODES = ['leftmostSlot', 'random', 'lowestClear'] as const;
const COLT = 4;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const f1 = (n: number) => n.toFixed(1);

// ------------------------------------------------- 1. how wrong is each mode

/**
 * What 4 damage into this slot is worth.
 *
 * Two terms, and the second is the one that matters. Raw damage landed is
 * nearly always 4 — Act II Threats mostly have more Clear than the Colt has
 * damage — so scoring on damage alone made every target identical and all
 * three modes scored 100%. That was the measurement failing, not the modes
 * agreeing.
 *
 * The second term is the FRACTION of the Threat removed, weighted by how much
 * that Threat hurts. Finishing something gives full credit for silencing its
 * Menace; chipping a Clear-10 obstruction for 4 gives four tenths of it. That
 * is the actual difference between a good shot and a wasted one, and it is
 * what a player is choosing between.
 */
function value(s: GameState, slot: number): number {
  const sl = s.street[slot];
  if (!sl) return 0;
  const clear = effectiveClear(sl);
  if (clear === undefined) return 0;
  const remaining = Math.max(1, clear - sl.damage);
  const landed = Math.min(COLT, remaining);
  return landed + effectiveMenace(sl, 0) * (landed / remaining);
}

/**
 * Act II boards with at least two live Threats — the only ones where it matters.
 *
 * EVERY qualifying board in a game, not the first. Stopping at the first gave
 * 60 boards averaging exactly 2.0 Threats, which is not what an Act II Street
 * looks like — it is what the moment Act II BEGINS looks like, sampled once
 * and then abandoned.
 */
function captureStreets(n: number): GameState[] {
  const out: GameState[] = [];
  // Driven by the REAL policy, not by random legal moves. Random play clears
  // the Street haphazardly and produced three usable boards in four hundred
  // games — it was measuring a game nobody plays.
  const bot = makeBot(balanced());
  for (let g = 0; out.length < n && g < 300; g++) {
    const seed = `colt-street-${g}`;
    let s = start(setup({
      seed, players: ['Ada', 'Bo', 'Cy', 'Dell'], markedIndex: g % 4,
    })).state;
    let cursor = 0;
    for (let i = 0; i < 1200 && !s.winner && out.length < n; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      const cmd = bot({
        view: playerView(s, actor), legal,
        rand: () => randInt(seed, cursor++, 1_000_000) / 1_000_000,
      });
      s = apply(s, actor, cmd).state;
      if (s.act !== 'mythos') continue;
      const alive = s.street.filter(
        (sl) => sl && card(sl.instance.cardId).type !== 'omen',
      ).length;
      if (alive >= 2) out.push(structuredClone(s));
    }
  }
  return out;
}

const streets = captureStreets(400);
const live = (s: GameState) => s.street
  .map((sl, i) => (sl && card(sl.instance.cardId).type !== 'omen' ? i : -1))
  .filter((i) => i >= 0);

console.log(`\n=== 1. How wrong is each mode? (${streets.length} real Act II Streets) ===\n`);
console.log('mode          value kept  hits the best  Threats on the board');
console.log('────────────  ─────────  ─────────────  ────────────────────');
const boardSize = mean(streets.map((s) => live(s).length));
for (const mode of MODES) {
  const ratios: number[] = [];
  let best = 0;
  for (const s0 of streets) {
    const s = structuredClone(s0);
    s.tuning = { ...s.tuning, coltFeveredTarget: mode } as Tuning;
    const slots = live(s);
    const ideal = Math.max(...slots.map((i) => value(s, i)));
    const picked = resolveSlots(s, 'itChooses')[0];
    if (picked === undefined || ideal <= 0) continue;
    ratios.push(value(s, picked) / ideal);
    if (value(s, picked) === ideal) best += 1;
  }
  console.log(
    `${mode.padEnd(12)}  ${f1(100 * mean(ratios)).padStart(8)}%  `
    + `${f1((100 * best) / ratios.length).padStart(12)}%  ${f1(boardSize).padStart(20)}`,
  );
}
console.log('\n"value kept" = what the shot was worth as a fraction of the best');
console.log('shot available. The clean face, which chooses, scores 100% by');
console.log('definition — a competent player takes the best target.');

// ------------------------------------------- 2. what does it cost the posse

console.log(`\n=== 2. What does it cost? (${GAMES} games x 4 blocks per mode) ===\n`);
console.log('mode          posse win  per-block spread  sd    turned  Act II rounds');
console.log('────────────  ─────────  ────────────────  ────  ──────  ─────────────');
for (const mode of MODES) {
  const blocks: number[] = [];
  let turned = 0; let games = 0; let actII = 0;
  for (let b = 0; b < 4; b++) {
    const res = runBatch({
      games: Math.round(GAMES / 4),
      policies: new Array(4).fill('Balanced'),
      marked: 1,
      seedPrefix: `colt-${mode}-${b}`,
      tuning: { coltFeveredTarget: mode },
    });
    // Post-Turning only: a Fevered Colt cannot exist before it.
    const t = res.filter((r) => r.turningRound !== null);
    turned += t.length; games += res.length;
    actII += t.reduce((n, r) => n + (r.rounds - r.turningRound!), 0);
    blocks.push((100 * t.filter((r) => r.outcome === 'posse').length) / (t.length || 1));
  }
  console.log(
    `${mode.padEnd(12)}  ${f1(mean(blocks)).padStart(8)}%  `
    + `${`${f1(Math.min(...blocks))}-${f1(Math.max(...blocks))}`.padStart(16)}  `
    + `${f1(sd(blocks)).padStart(4)}  ${f1((100 * turned) / games).padStart(5)}%  `
    + `${f1(actII / (turned || 1)).padStart(13)}`,
  );
}
void runGame;
