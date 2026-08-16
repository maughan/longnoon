// Why did the posse lose? A win-condition audit.
//
// The headline number is only meaningful if both sides can actually win. This
// command instruments Act II and reports whether the posse's win condition was
// ever reachable, so a degenerate measurement cannot be mistaken for a balanced
// one.

import type { GameState } from '../engine/state';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { playerView } from '../engine/view';
import { randAt } from '../engine/rng';
import { card } from '../content/cards';
import { opsFor } from '../engine/effects';
import { POLICIES } from './bots';
import { table } from './report';

export interface Audit {
  policy: string;
  games: number;
  reachedTurning: number;
  /** Posse decision points in Act II. */
  mythosDecisions: number;
  /** ...of which the bury-the-Vessel action was blocked by a parked Omen. */
  omenBlocked: number;
  /** ...of which the bury action was actually offered by legalCommands. */
  buryOffered: number;
  /** Games where an Omen occupied the Street at the moment of the Turning. */
  omenAtTurning: number;
  /** Games where the posse never once got a legal bury action. */
  neverCouldBury: number;
  /** Act II Threats cleared by the posse, and Threats pushed out by overflow. */
  cleared: number;
  overflowed: number;
  entered: number;
  meanDoomAtEnd: number;
  meanVesselDamage: number;
}

const omenInStreet = (s: GameState): boolean =>
  s.street.some((sl) => sl !== null && card(sl.instance.cardId).type === 'omen');

export function audit(policy: string, games: number, players: number): Audit {
  const a: Audit = {
    policy, games, reachedTurning: 0, mythosDecisions: 0, omenBlocked: 0,
    buryOffered: 0, omenAtTurning: 0, neverCouldBury: 0,
    cleared: 0, overflowed: 0, entered: 0,
    meanDoomAtEnd: 0, meanVesselDamage: 0,
  };
  let doomSum = 0;
  let vesselSum = 0;

  for (let g = 0; g < games; g++) {
    const seed = `diag-${g}`;
    let s = start(
      setup({
        seed,
        players: new Array(players).fill(policy).map((p, i) => `${p}-${i}`),
        markedIndex: null,
      }),
    ).state;

    let cursor = 0;
    const rand = () => randAt(`${seed}:bot`, cursor++);
    let sawTurning = false;
    let everBuried = false;

    for (let i = 0; i < 20_000 && !s.winner && s.round <= 40; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;

      if (s.act === 'mythos' && !sawTurning) {
        sawTurning = true;
        a.reachedTurning++;
        if (omenInStreet(s)) a.omenAtTurning++;
      }
      if (s.act === 'mythos' && !s.pending && s.players[actor].status === 'posse') {
        a.mythosDecisions++;
        if (omenInStreet(s)) a.omenBlocked++;
        // Burying is offered through cards now, not a bare action: the
        // question is whether this player can point anything at the Vessel.
        if (s.vessel !== null && s.players[actor].hand.some((ci) =>
          opsFor(card(ci.cardId), ci.fevered).some(
            (op) => op.op === 'damage' && (op.target === 'choose' || op.target === 'vessel'),
          ))) {
          a.buryOffered++;
          everBuried = true;
        }
      }

      const bot = POLICIES[policy];
      const wasMythos = s.act === 'mythos';
      const before = s.street.map((sl) => (sl ? sl.instance.uid : null));
      const r = apply(s, actor, bot({ view: playerView(s, actor), legal, rand }));

      if (wasMythos) {
        const after = new Set(r.state.street.map((sl) => (sl ? sl.instance.uid : null)));
        const clearedNow = r.events.filter((e) => e.t === 'THREAT_CLEARED').length;
        const goneNow = before.filter((uid) => uid !== null && !after.has(uid)).length;
        a.entered += r.events.filter((e) => e.t === 'THREAT_ENTERED').length;
        a.cleared += clearedNow;
        // Anything that left the Street without being cleared was pushed out
        // by overflow — the only mechanism that removes an Omen.
        a.overflowed += Math.max(0, goneNow - clearedNow);
      }
      s = r.state;
    }

    if (sawTurning && !everBuried) a.neverCouldBury++;
    doomSum += s.doom;
    vesselSum += s.vesselDamage;
  }

  a.meanDoomAtEnd = doomSum / games;
  a.meanVesselDamage = vesselSum / games;
  return a;
}

export function diagnose(games: number, players: number, policies: string[]): void {
  console.log(`\n=== Win-condition audit — ${players} players, ${games} games/policy ===\n`);
  const audits = policies.map((p) => audit(p, games, players));

  const pc = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
  console.log(
    table([
      ['policy', 'turned', 'omen-blocked', 'bury offered', 'never could bury', 'ActII cleared', 'overflowed', 'doom', 'vessel dmg'],
      ...audits.map((a) => [
        a.policy,
        `${a.reachedTurning}/${a.games}`,
        pc(a.omenBlocked, a.mythosDecisions),
        pc(a.buryOffered, a.mythosDecisions),
        pc(a.neverCouldBury, a.reachedTurning),
        String(a.cleared),
        String(a.overflowed),
        a.meanDoomAtEnd.toFixed(1),
        a.meanVesselDamage.toFixed(1),
      ]),
    ]),
  );
  console.log(
    '\n"omen-blocked" is the share of Act II posse decisions where an Omen in the\n' +
      'Street refused the bury action. Omens can never be cleared, so the ONLY way\n' +
      'to remove one is Street overflow — which requires the Street to be full.\n' +
      '\n' +
      'Hence the trap: clearing Threats keeps slots empty, which prevents overflow,\n' +
      'which keeps the Omen parked. Compare "cleared" against "overflowed" — the\n' +
      'policy that fights better locks itself out of its own win condition.\n',
  );
}
