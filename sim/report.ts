// Aggregation and output. Every number the design docs asked to watch is
// computed here, so the CLI stays a thin caller.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameResult } from './run';

const nums = (xs: (number | null)[]): number[] =>
  xs.filter((x): x is number => x !== null && Number.isFinite(x));

export const mean = (xs: (number | null)[]): number | null => {
  const v = nums(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export const median = (xs: (number | null)[]): number | null => {
  const v = nums(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const rate = (xs: GameResult[], f: (r: GameResult) => boolean): number =>
  xs.length ? xs.filter(f).length / xs.length : 0;

export interface Summary {
  label: string;
  games: number;
  /** Decided games only — stalls and errors excluded from the denominator. */
  posseWinRate: number;
  decided: number;
  stalls: number;
  errors: number;
  meanRounds: number | null;
  turnedRate: number;
  meanTurningRound: number | null;
  medianTurningRound: number | null;
  meanTurningPct: number | null;
  meanSignsAtTurning: number | null;
  maxSignsAtTurning: number | null;
  meanFirstFall: number | null;
  /** Games where anyone fell at all — is deck-as-health doing anything? */
  anyDeathRate: number;
  earlyDeathRate: number;
  provisionDryEarlyRate: number;
  meanProvisionDry: number | null;
  meanSignsBought: number | null;
  meanDoom: number | null;
  meanVesselDamage: number | null;
}

export function summarise(label: string, rs: GameResult[]): Summary {
  const decided = rs.filter((r) => r.outcome === 'posse' || r.outcome === 'oldOne');
  return {
    label,
    games: rs.length,
    decided: decided.length,
    posseWinRate: decided.length
      ? decided.filter((r) => r.outcome === 'posse').length / decided.length
      : 0,
    stalls: rs.filter((r) => r.outcome === 'stall').length,
    errors: rs.filter((r) => r.outcome === 'error').length,
    meanRounds: mean(rs.map((r) => r.rounds)),
    turnedRate: rate(rs, (r) => r.turningRound !== null),
    meanTurningRound: mean(rs.map((r) => r.turningRound)),
    medianTurningRound: median(rs.map((r) => r.turningRound)),
    meanTurningPct: mean(rs.map((r) => r.turningPct)),
    meanSignsAtTurning: mean(rs.map((r) => r.signsAtTurningAvg)),
    maxSignsAtTurning: mean(rs.map((r) => r.signsAtTurningMax)),
    meanFirstFall: mean(rs.map((r) => r.firstFallRound)),
    anyDeathRate: rate(rs, (r) => r.firstFallRound !== null),
    // Deck-as-health is the riskiest mechanic; round-4 deaths are the alarm.
    earlyDeathRate: rate(rs, (r) => r.firstFallRound !== null && r.firstFallRound <= 4),
    provisionDryEarlyRate: rate(
      rs,
      (r) => r.provisionDryRound !== null && r.provisionDryRound < 5,
    ),
    meanProvisionDry: mean(rs.map((r) => r.provisionDryRound)),
    meanSignsBought: mean(rs.map((r) => r.signsBought)),
    meanDoom: mean(rs.map((r) => r.doom)),
    meanVesselDamage: mean(rs.map((r) => r.vesselDamage)),
  };
}

// ---------------------------------------------------------------- printing

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const fx = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d));

export function table(rows: string[][]): string {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows
    .map((r, ri) => {
      const line = r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
      return ri === 0 ? line + '\n' + w.map((n) => '─'.repeat(n)).join('  ') : line;
    })
    .join('\n');
}

export function summaryTable(ss: Summary[]): string {
  return table([
    ['policy', 'games', 'posse win', 'turn rnd', 'turn %len', 'signs@turn', '1st fall', 'any death', 'early death', 'stall', 'err'],
    ...ss.map((s) => [
      s.label,
      String(s.games),
      pct(s.posseWinRate),
      fx(s.meanTurningRound, 1),
      pct(s.meanTurningPct),
      fx(s.meanSignsAtTurning, 1),
      fx(s.meanFirstFall, 1),
      pct(s.anyDeathRate),
      pct(s.earlyDeathRate),
      String(s.stalls),
      String(s.errors),
    ]),
  ]);
}

// ---------------------------------------------------------------- csv

const CSV_COLUMNS: (keyof GameResult)[] = [
  'seed', 'policies', 'players', 'marked', 'outcome', 'rounds',
  'turningRound', 'turningPct', 'signsAtTurningAvg', 'signsAtTurningMax',
  'firstFallRound', 'provisionDryRound', 'doom', 'vesselDamage',
  'vesselPolicy', 'signsBought', 'signsBoughtByVessel', 'steps', 'error',
];

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rs: GameResult[], extra: Record<string, unknown>[] = []): string {
  const extraKeys = [...new Set(extra.flatMap((e) => Object.keys(e)))];
  const head = [...CSV_COLUMNS, ...extraKeys].join(',');
  const body = rs.map((r, i) =>
    [
      ...CSV_COLUMNS.map((k) => cell(r[k])),
      ...extraKeys.map((k) => cell(extra[i]?.[k])),
    ].join(','),
  );
  return [head, ...body].join('\n') + '\n';
}

export function writeCsv(path: string, csv: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, csv, 'utf8');
}
