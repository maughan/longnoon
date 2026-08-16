// Milestone 2 CLI.
//
//   npm run sim                      the headline experiment
//   npm run sim -- mixed             one table, different policies per seat
//   npm run sim -- sweep             the TUNING grid
//   npm run sim -- all
//
//   --games=N     games per cell (default 200)
//   --players=N   seats (default 4)
//   --marked      include a Marked player (default off — DESIGN.md §10 says
//                 measure the deck builder before the traitor compensates for it)
//   --out=DIR     CSV directory (default sim/out)

import { runBatch, type GameResult } from './run';
import { summarise, summaryTable, table, toCsv, writeCsv, mean } from './report';
import { POLICY_NAMES } from './bots';
import { diagnose } from './diagnose';
import type { Tuning } from '../engine/state';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const GAMES = Number(flag('games', '200'));
const PLAYERS = Number(flag('players', '4'));
const OUT = flag('out', 'sim/out');
const WITH_MARKED = argv.includes('--marked');
const command = argv.find((a) => !a.startsWith('--')) ?? 'headline';

const seats = (policy: string) => new Array(PLAYERS).fill(policy);
const markedSeat = WITH_MARKED ? 0 : null;
// With a traitor in play the Marked seat plays the Marked policy: it holds its
// Signs back until two others are corrupted, then stops holding back.
const markedPolicy = WITH_MARKED ? 'Marked' : undefined;
const pctS = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);

// ---------------------------------------------------------------- headline

/** Only numeric TUNING values can be swept — `omensBlockBurial` is a ruling. */
type NumericTuningKey = {
  [K in keyof Tuning]: Tuning[K] extends number ? K : never;
}[keyof Tuning];

/** Short flag names for the tuning keys that get swept most. */
const AXIS_ALIASES: Record<string, NumericTuningKey> = {
  doom: 'doomTarget',
  vessel: 'vesselClear',
  whisper: 'whisperThreshold',
  prov: 'provisionDeckSize',
  omenwhisper: 'omenWhispersPerRound',
  omenmenace: 'omenMenace',
  persign: 'menacePerSign',
  markedaim: 'markedAimDoomBonus',
  start: 'startingDeckSize',
  decay: 'revenantDecay',
  threats: 'threatsPerRound',
  threatsmin: 'threatsMin',
  escalation: 'escalationPerRound',
  slots: 'streetSlots',
  damage: 'damagePerHit',
  hand: 'handSize',
  actions: 'actionsPerTurn',
};

/** Any known axis flag overrides TUNING for headline and mixed (first value). */
function tuningOverride(): Partial<Tuning> {
  const t: Partial<Tuning> = {};
  for (const arg of argv) {
    const m = /^--([A-Za-z]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const key = AXIS_ALIASES[m[1].toLowerCase()];
    if (key) t[key] = Number(m[2].split(',')[0]);
  }
  return t;
}

const OVERRIDE = tuningOverride();
const overrideLabel = Object.entries(OVERRIDE)
  .map(([k, v]) => `${k}: ${v}`)
  .join(', ');

const RULINGS: { key: string; label: string; tuning: Partial<Tuning> }[] = [
  {
    key: 'open',
    label: 'omensBlockBurial: false (current rule — Omens do not gate the Vessel)',
    tuning: { omensBlockBurial: false },
  },
  {
    key: 'blocked',
    label: 'omensBlockBurial: true  (original paper gate, kept for comparison)',
    tuning: { omensBlockBurial: true },
  },
];

function headline(): void {
  console.log(
    `\n=== Homogeneous tables — ${PLAYERS} players, ${GAMES} games/policy, ` +
      `${WITH_MARKED ? 'one Marked player' : 'no traitor'}` +
      `${overrideLabel ? `, ${overrideLabel}` : ''} ===\n`,
  );
  console.log(
    'In a co-op every seat shares the outcome, so a policy\'s "win rate" is the\n' +
      'posse win rate of a table where everyone plays it. Stalls and errors are\n' +
      'excluded from the denominator and reported separately.\n' +
      'Both Omen rulings are shown: the original paper gate deadlocked, because\n' +
      'clearing Threats suppresses the overflow that is the only way to remove an\n' +
      'Omen. It is kept only as a comparison.\n',
  );

  const all: GameResult[] = [];
  const extra: Record<string, unknown>[] = [];

  for (const ruling of RULINGS) {
    const summaries = POLICY_NAMES.map((p) => {
      const rs = runBatch({
        games: GAMES,
        policies: seats(p),
        marked: markedSeat,
        markedPolicy,
        tuning: { ...ruling.tuning, ...OVERRIDE },
        seedPrefix: `h-${ruling.key}-${p}`,
      });
      all.push(...rs);
      for (let i = 0; i < rs.length; i++) extra.push({ ruling: ruling.key });
      return summarise(p, rs);
    });

    console.log(`\n--- ${ruling.label} ---\n`);
    console.log(summaryTable(summaries));

    const pur = summaries.find((s) => s.label === 'Puritan')!;
    const zea = summaries.find((s) => s.label === 'Zealot')!;
    const gap = Math.abs(pur.posseWinRate - zea.posseWinRate);
    const degenerate = pur.posseWinRate < 0.1 && zea.posseWinRate < 0.1;
    const broken = pur.posseWinRate > 0.55 || zea.posseWinRate > 0.55;

    console.log(`\n  THE NUMBER THAT MATTERS`);
    console.log(`    Puritan (never buys a Sign):   ${pctS(pur.posseWinRate)}  (n=${pur.decided})`);
    console.log(`    Zealot  (buys Signs on sight): ${pctS(zea.posseWinRate)}  (n=${zea.decided})`);
    console.log(`    Gap:                           ${pctS(gap)}`);
    console.log(
      `    Verdict: ${
        degenerate
          ? 'UNINFORMATIVE — the posse almost never wins under either policy, so ' +
            'this comparison is not measuring corruption balance. Run `diagnose`.'
          : broken
            ? 'BROKEN — an extreme strategy clears the ~55% bar.'
            : 'HOLDING — neither extreme clears the ~55% bar.'
      }`,
    );

    console.log('\n  Supporting numbers (DESIGN.md §10 watch list):\n');
    console.log(
      table([
        ['policy', 'signs bought', 'prov dry', 'dry <r5', 'mean rounds', 'mean doom', 'vessel dmg'],
        ...summaries.map((s) => [
          s.label,
          (s.meanSignsBought ?? 0).toFixed(1),
          s.meanProvisionDry === null ? '—' : s.meanProvisionDry.toFixed(1),
          pctS(s.provisionDryEarlyRate),
          (s.meanRounds ?? 0).toFixed(1),
          (s.meanDoom ?? 0).toFixed(1),
          (s.meanVesselDamage ?? 0).toFixed(1),
        ]),
      ]),
    );
  }

  writeCsv(`${OUT}/headline.csv`, toCsv(all, extra));
  console.log(`\nwrote ${OUT}/headline.csv (${all.length} games)`);
}

// ---------------------------------------------------------------- mixed

/**
 * A mixed table is the one place a per-player signal exists: everyone shares
 * the win, but only one seat becomes the Vessel. If corruption is genuinely
 * tempting rather than merely punished, the Zealot seat should absorb the
 * Vessel role far more often than its 1/N share.
 */
function mixed(): void {
  const lineup = ['Puritan', 'Zealot', 'Balanced', 'Greedy'].slice(0, PLAYERS);
  console.log(`\n=== Mixed table — ${lineup.join(' / ')}, ${GAMES} games ===\n`);

  const rs = runBatch({
    games: GAMES,
    policies: lineup,
    marked: markedSeat,
    markedPolicy,
    seedPrefix: 'mixed',
  });

  const turned = rs.filter((r) => r.vesselPolicy !== null);
  const share = lineup.map((p) => ({
    policy: p,
    vessel: turned.filter((r) => r.vesselPolicy === p).length,
    signs: mean(
      rs.map((r) => (r.vesselPolicy === p ? r.signsBoughtByVessel : null)),
    ),
  }));

  console.log(summaryTable([summarise(lineup.join('/'), rs)]));
  console.log('\nWho becomes the Vessel:\n');
  console.log(
    table([
      ['seat policy', 'vessel', 'share', 'fair share', 'signs bought'],
      ...share.map((s) => [
        s.policy,
        String(s.vessel),
        pctS(turned.length ? s.vessel / turned.length : null),
        pctS(1 / lineup.length),
        s.signs === null ? '—' : s.signs.toFixed(1),
      ]),
    ]),
  );

  writeCsv(`${OUT}/mixed.csv`, toCsv(rs));
  console.log(`\nwrote ${OUT}/mixed.csv (${rs.length} games)`);
}

// ---------------------------------------------------------------- sweep

/** Cartesian product of every `--key=v1,v2` axis found on the command line. */
function axisGrid(): { tuning: Partial<Tuning>; label: string[] }[] {
  const axes: { key: NumericTuningKey; values: number[] }[] = [];
  for (const arg of argv) {
    const m = /^--([A-Za-z]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const key = AXIS_ALIASES[m[1].toLowerCase()];
    if (!key) continue;
    axes.push({ key, values: m[2].split(',').map(Number) });
  }
  if (!axes.length) return [];

  let grid: { tuning: Partial<Tuning>; label: string[] }[] = [{ tuning: {}, label: [] }];
  for (const axis of axes) {
    grid = grid.flatMap((cell) =>
      axis.values.map((v) => ({
        tuning: { ...cell.tuning, [axis.key]: v },
        label: [...cell.label, String(v)],
      })),
    );
  }
  return grid;
}

function axisNames(): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    const m = /^--([A-Za-z]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const key = AXIS_ALIASES[m[1].toLowerCase()];
    if (key) out.push(key);
  }
  return out;
}

/**
 * Sweeps the cartesian product of every `--key=v1,v2` axis given, over any
 * TUNING value (see AXIS_ALIASES). Balanced is included because the design test
 * is not just "is either extreme too strong" but "is the middle the best play".
 *
 *   npm run sim -- sweep --doom=23,26 --vessel=18,20
 *   npm run sim -- sweep --prov=12,16,20 --omenwhisper=0,1
 */
function sweep(): void {
  const grid = axisGrid();
  const names = axisNames();
  if (!grid.length) {
    console.error(
      'sweep needs at least one axis, e.g. --vessel=18,20,22\n' +
        `known axes: ${Object.keys(AXIS_ALIASES).join(', ')}`,
    );
    process.exit(1);
  }

  // Greedy is in the grid too: it is not one of DESIGN.md §2's named extremes,
  // but "buy the dearest affordable card" is the obvious naive strategy, and a
  // sweep that cannot see it will happily tune a game it dominates.
  const policies = ['Puritan', 'Zealot', 'Balanced', 'Greedy'];
  console.log(
    `\n=== TUNING sweep — ${names.join(' × ')}, ${GAMES} games/cell ===\n`,
  );
  console.log(
    'Target: neither extreme above ~55%, and Balanced at least as good as both.\n' +
      'Cells where the middle is the best play are marked *.\n',
  );

  const rows: string[][] = [[
    ...names, 'Puritan', 'Zealot', 'Balanced', 'Greedy', 'gap', 'turn %len', 'any death', 'early', 'stalls',
  ]];
  const all: GameResult[] = [];
  const extra: Record<string, unknown>[] = [];

  for (const cell of grid) {
    const cells = policies.map((p) => {
      const rs = runBatch({
        games: GAMES,
        policies: seats(p),
        marked: markedSeat,
        markedPolicy,
        tuning: cell.tuning,
        seedPrefix: `s-${cell.label.join('-')}-${p}`,
      });
      all.push(...rs);
      for (let i = 0; i < rs.length; i++) extra.push({ ...cell.tuning, policy: p });
      return summarise(p, rs);
    });
    const [pur, zea, bal, gre] = cells;
    // The middle wins: neither extreme runs away with it, and Balanced is not
    // beaten by either. Ties count — they are within noise at these n.
    // The middle must actually be the best play — including against the naive
    // dearest-card strategy, not just the two named extremes.
    const ok =
      pur.posseWinRate <= 0.55 && zea.posseWinRate <= 0.55 &&
      gre.posseWinRate <= 0.55 &&
      bal.posseWinRate >= pur.posseWinRate && bal.posseWinRate >= zea.posseWinRate &&
      bal.posseWinRate >= gre.posseWinRate;

    rows.push([
      ...cell.label,
      pctS(pur.posseWinRate),
      pctS(zea.posseWinRate),
      pctS(bal.posseWinRate) + (ok ? ' *' : ''),
      pctS(gre.posseWinRate),
      pctS(Math.abs(pur.posseWinRate - zea.posseWinRate)),
      pctS(mean(cells.map((c) => c.meanTurningPct))),
      pctS(mean(cells.map((c) => c.anyDeathRate))),
      pctS(mean(cells.map((c) => c.earlyDeathRate))),
      String(cells.reduce((n, c) => n + c.stalls, 0)),
    ]);
  }

  console.log(table(rows));
  writeCsv(`${OUT}/sweep.csv`, toCsv(all, extra));
  console.log(`\nwrote ${OUT}/sweep.csv (${all.length} games)`);
}

// ----------------------------------------------------------------

const commands: Record<string, () => void> = {
  headline,
  mixed,
  sweep,
  diagnose: () => diagnose(GAMES, PLAYERS, ['Puritan', 'Zealot', 'Balanced']),
};

if (command === 'all') {
  headline();
  mixed();
  sweep();
} else if (commands[command]) {
  commands[command]();
} else {
  console.error(`Unknown command: ${command}. Try: headline | mixed | sweep | all`);
  process.exit(1);
}
