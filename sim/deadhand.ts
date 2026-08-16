// Where do dead hands come from — attack density, or the padding?
//
// Not a feature. Nothing here is committed; the arms mutate TUNING and, for
// the damage arm, the Six-Gun's own op. Card mutation is a harness concern and
// has precedent (the Dynamite price sweep) — no RNG is involved, so replay is
// untouched.

import { runBatch, type GameResult } from './run';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { playerView } from '../engine/view';
import { makeBot, balanced } from './bots';
import { randInt } from '../engine/rng';
import { card, TUNING } from '../content/cards';
import type { Tuning, GameState } from '../engine/state';

const GAMES = Number(process.argv[2] ?? 200);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (n: number) => n.toFixed(1);
const pct = (n: number, d: number) => `${((100 * n) / (d || 1)).toFixed(1)}%`;

interface Arm {
  name: string;
  tuning: Partial<Tuning>;
  gunDamage?: number;
}

/**
 * The four padding slots, as a mixture.
 *
 * Experiment 1 said the padding is the lever and that all four Six-Guns is far
 * too much (Zealot 50%). This is the interpolation between the two ends.
 */
const ARMS: Arm[] = [
  { name: '4 sad / 0 gun (was)', tuning: { padMix: ['saddlebag'] } },
  { name: '3 sad / 1 gun (now)', tuning: { padMix: ['saddlebag', 'saddlebag', 'saddlebag', 'six-gun'] } },
  { name: '2 sad / 2 gun', tuning: { padMix: ['saddlebag', 'six-gun'] } },
  { name: '1 sad / 3 gun', tuning: { padMix: ['saddlebag', 'six-gun', 'six-gun', 'six-gun'] } },
  { name: '0 sad / 4 gun', tuning: { padMix: ['six-gun'] } },
  { name: '2 sad / 1 gun / 1 cant', tuning: { padMix: ['saddlebag', 'saddlebag', 'six-gun', 'canteen'] } },
];

/** Can this player damage anything right now? */
const armed = (s: GameState, pid: string) =>
  s.players[pid]!.hand.some((ci) =>
    card(ci.cardId).ops.some((o) => o.op === 'damage' || o.op === 'destroy'));

/**
 * A dead hand: your turn, actions to spend, and no way to hurt anything.
 *
 * Counted per DECISION POINT with actions remaining, not per turn — a turn
 * that has spent its actions is finished, not stuck.
 */
function deadHands(tuning: Partial<Tuning>, games: number) {
  const bot = makeBot(balanced());
  let act1 = 0; let act1Dead = 0; let act2 = 0; let act2Dead = 0;
  const escAtTurning: number[] = [];
  let firstClear = 0; let cleared = 0; let escaped3 = 0; let counted = 0;

  for (let g = 0; g < games; g++) {
    const seed = `dh-${g}`;
    let s = start(setup({
      seed, players: ['A', 'B', 'C', 'D'], markedIndex: 1, tuning,
    })).state;
    let cursor = 0; let noted = false; let firstAt = 0;
    const maxEsc = new Map<number, number>();

    for (let i = 0; i < 1500 && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;

      if (!s.pending && s.actionsLeft > 0 && s.players[actor]!.status === 'posse') {
        const dead = !armed(s, actor);
        if (s.act === 'trouble') { act1++; if (dead) act1Dead++; }
        else { act2++; if (dead) act2Dead++; }
      }
      for (const sl of s.street) {
        if (sl) maxEsc.set(sl.escalation, (maxEsc.get(sl.escalation) ?? 0) + 1);
      }
      if (!noted && s.act === 'mythos') {
        noted = true;
        const live = s.street.filter(Boolean);
        escAtTurning.push(mean(live.map((sl) => sl!.escalation)));
      }
      const before = s.street.filter(Boolean).length;
      s = apply(s, actor, bot({
        view: playerView(s, actor), legal,
        rand: () => randInt(seed, cursor++, 1e6) / 1e6,
      })).state;
      if (!firstAt && s.street.filter(Boolean).length < before) firstAt = s.round;
    }
    counted++;
    if (firstAt) { firstClear += firstAt; cleared++; }
    if ([...maxEsc.keys()].some((e) => e >= 3)) escaped3++;
  }
  return {
    act1: pct(act1Dead, act1), act2: pct(act2Dead, act2),
    firstClear: cleared ? f1(firstClear / cleared) : '—',
    escaped3: pct(escaped3, counted),
    escAtTurning: f1(mean(escAtTurning)),
  };
}

console.log(`\n=== Dead hands: attack density vs padding (${GAMES} games/arm) ===`);
console.log(`deck ${TUNING.startingDeckSize}, hand ${TUNING.handSize}\n`);
console.log('arm                    dead Act I  dead Act II  1st clear  esc>=3  esc@Turn'
  + '   Puritan  Zealot  Balanced   turn rnd');
console.log('─────────────────────  ──────────  ───────────  ─────────  ──────  ────────'
  + '   ───────  ──────  ────────   ────────');

const gunOp = card('six-gun').ops[0] as { n: number };
const baseDamage = gunOp.n;

for (const arm of ARMS) {
  gunOp.n = arm.gunDamage ?? baseDamage;
  const d = deadHands(arm.tuning, Math.min(GAMES, 60));
  const win: Record<string, string> = {};
  let turn = '';
  for (const policy of ['Puritan', 'Zealot', 'Balanced']) {
    const res: GameResult[] = runBatch({
      games: GAMES, policies: new Array(4).fill(policy), marked: 1,
      seedPrefix: `dh-${arm.name}-${policy}`, tuning: arm.tuning,
    });
    win[policy] = pct(res.filter((r) => r.outcome === 'posse').length, res.length);
    if (policy === 'Balanced') {
      const t = res.filter((r) => r.turningRound !== null).map((r) => r.turningRound!);
      turn = f1(mean(t));
    }
  }
  console.log(
    `${arm.name.padEnd(21)}  ${d.act1.padStart(10)}  ${d.act2.padStart(11)}  `
    + `${d.firstClear.padStart(9)}  ${d.escaped3.padStart(6)}  ${d.escAtTurning.padStart(8)}`
    + `   ${win.Puritan!.padStart(7)}  ${win.Zealot!.padStart(6)}  ${win.Balanced!.padStart(8)}`
    + `   ${turn.padStart(8)}`,
  );
}
gunOp.n = baseDamage;
