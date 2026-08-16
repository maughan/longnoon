// What the Vessel's deck actually does once it is cards instead of buttons.
import { runBatch } from './run';
import { VESSEL_IDS } from '../content/cards';

const GAMES = Number(process.argv[2] ?? 250);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (n: number) => n.toFixed(1);

for (const policy of ['Balanced', 'Zealot', 'Puritan', 'Greedy']) {
  const res = runBatch({
    games: GAMES, policies: new Array(4).fill(policy), marked: 1,
    seedPrefix: `vess-${policy}`,
  });
  const turned = res.filter((r) => r.turningRound !== null);
  const plays = Object.fromEntries(VESSEL_IDS.map((id) => [id,
    res.reduce((n, r) => n + (r.vesselPlays[id] ?? 0), 0) / (turned.length || 1)]));
  const total = Object.values(plays).reduce((a, b) => a + b, 0);
  const signs = turned.map((r) => r.vesselSigns ?? 0);

  console.log(`\n${policy}  posse win ${
    f1((100 * res.filter((r) => r.outcome === 'posse').length) / res.length)}%  `
    + `turned ${turned.length}/${GAMES}  Fevered Signs carried: mean ${
      f1(mean(signs))} max ${Math.max(...signs, 0)}`);
  console.log('  plays per Act II: ' + VESSEL_IDS
    .map((id) => `${id} ${f1(plays[id]!)} (${f1((100 * plays[id]!) / (total || 1))}%)`)
    .join('  '));

  // Does carrying Signs swing the act?
  const few = turned.filter((r) => (r.vesselSigns ?? 0) <= 1);
  const many = turned.filter((r) => (r.vesselSigns ?? 0) >= 4);
  const win = (rs: typeof res) =>
    rs.length ? f1((100 * rs.filter((r) => r.outcome === 'posse').length) / rs.length) : '—';
  console.log(`  posse win vs a Vessel with <=1 Sign: ${win(few)}% (n=${few.length})`
    + `   with >=4: ${win(many)}% (n=${many.length})`);
}
