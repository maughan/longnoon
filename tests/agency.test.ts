import { test, expect } from 'vitest';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { playerView } from '../engine/view';
import { POLICIES } from '../sim/bots';
import { randAt } from '../engine/rng';

// The number the deletion has to justify.
//
// Removing an unconditional action is only right if what is left still fills a
// turn. Across Act II player-turns, what fraction have at least one legal action
// other than ending the turn? Under about 90% and the deletion went too far —
// Tolls or Vessel targeting would need to be more available.
test('Act II agency', () => {
  const tally = { posse: 0, posseLive: 0, oldOne: 0, oldOneLive: 0, revenant: 0, revenantLive: 0 };
  const kinds = new Map<string, number>();
  let games = 0;

  for (let g = 0; g < 60; g++) {
    const seed = `agency-${g}`;
    let s = start(setup({
      seed, players: ['Ada', 'Bo', 'Cy', 'Dee'], markedIndex: 1,
    })).state;
    const bot = POLICIES.Balanced;
    let cursor = 0;
    for (let step = 0; step < 4000 && !s.winner; step++) {
      const actor = s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      const status = s.players[actor].status;

      if (s.act === 'mythos' && !s.pending && status !== 'gone') {
        const real = legal.filter((c) => c.t !== 'END_TURN');
        const bucket = status === 'oldOne' ? 'oldOne'
          : status === 'revenant' ? 'revenant' : 'posse';
        tally[bucket] += 1;
        if (real.length) tally[`${bucket}Live` as keyof typeof tally] += 1;
        for (const c of real) kinds.set(c.t, (kinds.get(c.t) ?? 0) + 1);
      }

      const cmd = bot({
        view: playerView(s, actor), legal,
        rand: () => randAt(seed, cursor++),
      });
      s = apply(s, actor, cmd).state;
    }
    games += 1;
  }

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : '—');
  console.log(`over ${games} games:`);
  console.log(`  posse Act II turns:    ${tally.posse}  with a real action: ${pct(tally.posseLive, tally.posse)}%`);
  console.log(`  Old One Act II turns:  ${tally.oldOne}  with a real action: ${pct(tally.oldOneLive, tally.oldOne)}%`);
  console.log(`  Revenant Act II turns: ${tally.revenant}  with a real action: ${pct(tally.revenantLive, tally.revenant)}%`);
  const all = tally.posse + tally.oldOne + tally.revenant;
  const live = tally.posseLive + tally.oldOneLive + tally.revenantLive;
  console.log(`  ALL Act II turns:      ${all}  with a real action: ${pct(live, all)}%`);
  console.log('  actions offered:', [...kinds].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`).join(' '));

  expect(all).toBeGreaterThan(500);
  expect(live / all, 'Act II turns with something to do').toBeGreaterThan(0.9);
  // Each seat separately, or a healthy posse could hide a dead Old One.
  expect(tally.posseLive / tally.posse).toBeGreaterThan(0.9);
  expect(tally.oldOneLive / tally.oldOne).toBeGreaterThan(0.9);
  // The replacements are actually reachable, not merely defined.
  for (const t of ['PAY_TOLL', 'SHUTTER', 'OFFER', 'CALL']) {
    expect(kinds.get(t) ?? 0, t).toBeGreaterThan(0);
  }
});
