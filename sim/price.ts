// What Dynamite should cost, and whether depth or breadth is winning.
//
// The Colt is held at 4 throughout as the control. Dynamite's cost is mutated
// on the shared CARDS table rather than being threaded through TUNING: a
// per-card price has no business in TUNING, and this is a measurement harness,
// not production surface. No RNG is involved, so determinism is untouched.

import { runBatch, type GameResult } from './run';
import { card } from '../content/cards';

const GAMES = Number(process.argv[2] ?? 250);
const PRICES = [3, 4, 5, 6];
const POLICIES = ['Puritan', 'Zealot', 'Balanced', 'Greedy'] as const;

const pct = (n: number, d: number) => (100 * n) / (d || 1);
const f1 = (n: number) => n.toFixed(1);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function q(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0;
}

interface Row {
  price: number; policy: string;
  win: number; dynPerGame: number; dynShare: number; coltPerGame: number;
  gamesWithDyn: number; banished: number; omenLeft: number;
  scars: number; turnRound: number; turnP10: number; turnP90: number;
}

const rows: Row[] = [];
const original = card('dynamite').cost;

for (const price of PRICES) {
  card('dynamite').cost = price;
  for (const policy of POLICIES) {
    const res: GameResult[] = runBatch({
      games: GAMES, policies: new Array(4).fill(policy), marked: 1,
      seedPrefix: `price-${price}-${policy}`,
    });
    const signs = res.reduce((n, r) => n + r.signsBought, 0);
    const dyn = res.reduce((n, r) => n + r.dynamiteBought, 0);
    const turns = res.filter((r) => r.turningRound !== null)
      .map((r) => r.turningRound!);
    rows.push({
      price, policy,
      win: pct(res.filter((r) => r.outcome === 'posse').length, res.length),
      dynPerGame: dyn / res.length,
      dynShare: pct(dyn, signs),
      coltPerGame: res.reduce((n, r) => n + r.coltBought, 0) / res.length,
      gamesWithDyn: pct(res.filter((r) => r.dynamiteBought > 0).length, res.length),
      banished: res.reduce((n, r) => n + r.omensBanished, 0) / res.length,
      omenLeft: pct(res.filter((r) => r.omensLeft > 0).length, res.length),
      scars: mean(res.filter((r) => r.scarsAtTurning !== null)
        .map((r) => r.scarsAtTurning!)),
      turnRound: mean(turns), turnP10: q(turns, 0.1), turnP90: q(turns, 0.9),
    });
  }
}
card('dynamite').cost = original;

console.log(`\n=== Dynamite price sweep, ${GAMES} games per cell, Colt fixed at 4 ===\n`);
console.log('cost  policy    posse win  dyn/game  bought in  dyn share  colt/game  '
  + 'omens down  omen left  scars@turn  turn rnd (p10-p90)');
console.log('────  ────────  ─────────  ────────  ─────────  ─────────  ─────────  '
  + '──────────  ─────────  ──────────  ──────────────────');
for (const r of rows) {
  const flagShare = r.dynShare > 30 ? '*' : ' ';
  const flagWin = r.win > 55 ? '!' : ' ';
  console.log(
    `${String(r.price).padStart(4)}  ${r.policy.padEnd(8)}  `
    + `${f1(r.win).padStart(8)}%${flagWin} ${f1(r.dynPerGame).padStart(8)}  `
    + `${f1(r.gamesWithDyn).padStart(8)}%  ${f1(r.dynShare).padStart(8)}%${flagShare} `
    + `${f1(r.coltPerGame).padStart(9)}  ${f1(r.banished).padStart(10)}  `
    + `${f1(r.omenLeft).padStart(8)}%  ${f1(r.scars).padStart(10)}  `
    + `${f1(r.turnRound).padStart(8)} (${r.turnP10}-${r.turnP90})`,
  );
}
console.log('\n* dynamite is over 30% of all Sign purchases (auto-include)');
console.log('! win rate over 55% (central tension broken)');
