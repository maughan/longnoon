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
  const tally = { posse: 0, posseLive: 0, vessel: 0, vesselLive: 0, revenant: 0, revenantLive: 0 };
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

      /*
        Only turns with an action left.

        This used to count every turn, and for the posse that was harmless:
        SPEND_GRIT is not an action, so a posse player who had spent all three
        still had a legal move and scored as "live". The Vessel cannot cash in
        any more — Grit buys from a market it cannot use — so the same metric
        started reporting 75% for a seat that is genuinely stuck on **2 turns
        out of 584**. It was measuring "can cash in", not "has something to do".

        A turn with no actions left is a FINISHED turn. Asking whether it has
        a move is asking the wrong question of it.
      */
      if (s.act === 'mythos' && !s.pending && status !== 'gone' && s.actionsLeft > 0) {
        const real = legal.filter((c) => c.t !== 'END_TURN');
        const bucket = status === 'vessel' ? 'vessel'
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
  console.log(`  Vessel Act II turns:   ${tally.vessel}  with a real action: ${pct(tally.vesselLive, tally.vessel)}%`);
  console.log(`  Revenant Act II turns: ${tally.revenant}  with a real action: ${pct(tally.revenantLive, tally.revenant)}%`);
  const all = tally.posse + tally.vessel + tally.revenant;
  const live = tally.posseLive + tally.vesselLive + tally.revenantLive;
  console.log(`  ALL Act II turns:      ${all}  with a real action: ${pct(live, all)}%`);
  console.log('  actions offered:', [...kinds].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`).join(' '));

  expect(all).toBeGreaterThan(500);
  expect(live / all, 'Act II turns with something to do').toBeGreaterThan(0.9);
  // Each seat separately, or a healthy posse could hide a dead Vessel.
  expect(tally.posseLive / tally.posse).toBeGreaterThan(0.9);
  /*
    The Vessel's floor is LOWER than the posse's, and deliberately.

    This was 0.9, written when the seat had five permanent buttons and could
    therefore never be stuck. Its actions are cards now, and its deck shrinks
    one card per recycle down to `vesselDeckFloor` — so a late Act II Vessel
    genuinely runs out of things to do, and that is the burn-out clock rather
    than a dead mechanic.

    Was 0.99. It is 98.2% now, and the cause is a deliberate rule rather than
    drift: a card with no ops is no longer offered as a play, so a Scar in hand
    is dead weight instead of a wasted action. The Vessel collects Scars from
    its own Dynamite, so it is the seat that notices.

    That is the rule working. A turn holding nothing but Scars SHOULD have
    nothing to do — the alternative is a button that moves a card from one pile
    to another and calls it a move.
  */
  expect(tally.vesselLive / tally.vessel).toBeGreaterThan(0.97);
  // The replacements are actually reachable, not merely defined. SHUTTER,
  // OFFER and CALL are cards now rather than commands, so what has to be
  // reachable is PLAY_CARD from the Vessel's seat — checked above by
  // `vesselLive` — and the one command that survived.
  expect(kinds.get('PAY_TOLL') ?? 0, 'PAY_TOLL').toBeGreaterThan(0);
});
