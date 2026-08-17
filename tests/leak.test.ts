// The chronicle is shared. The Vessel's hand is not.
//
// Every seat gets its own `playerView` and its own `visibleEvents`, and the
// chronicle is built client-side from exactly those two — `describe(e, view,
// seat)` in `net.ts`, which has no path to `GameState` by construction. This
// test walks a real game and checks the OUTPUT of that pipeline rather than the
// pipeline's shape, because a leak is a sentence somebody can read, not a type.
//
// The specific thing it catches: a chronicle line naming a card the viewing
// player has no way to know about. That is how IT REMEMBERS YOUR NAME would
// leak a deck — it looks at the top card of somebody's deck, and if the card is
// not a Sign nothing happens and nobody may learn what it was.

import { describe, it, expect } from 'vitest';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { playerView } from '../engine/view';
import { visibleEvents } from '../server/events';
import { randInt } from '../engine/rng';
import { describe as narrateLine } from '../client/src/beats';
import { ALL_CARDS, card } from '../content/cards';
import type { ClientState } from '../engine/view';
import type { GameState, Command, PlayerId } from '../engine/state';

/**
 * Every card name this viewer is entitled to read, from their view alone.
 *
 * Deliberately built from `ClientState` and nothing else — if a name is not
 * reachable here, the viewer cannot know it, and a chronicle line that prints
 * it has told them something the game did not.
 *
 * Opponents' discards and boneyards count: they are face up at a real table and
 * `playerView` publishes them. That is also why a card that RESOLVES publicly
 * is fine to name — it lands in a discard on its way past.
 */
function knowable(v: ClientState): Set<string> {
  const names = new Set<string>();
  const add = (id: string) => names.add(card(id).name);

  for (const ci of v.you?.hand ?? []) add(ci.cardId);
  for (const ci of v.you?.deck ?? []) add(ci.cardId);
  for (const ci of v.you?.discard ?? []) add(ci.cardId);
  for (const ci of v.you?.boneyard ?? []) add(ci.cardId);
  for (const o of v.opponents) {
    for (const ci of o.discard) add(ci.cardId);
    for (const ci of o.boneyard) add(ci.cardId);
    // A hand revealed to this viewer by the Coyote is theirs to read.
    for (const ci of o.hand ?? []) add(ci.cardId);
  }
  for (const sl of v.street) if (sl) add(sl.instance.cardId);
  for (const ci of v.provisionRow) add(ci.cardId);
  // The market's Signs are a public shelf, and every Fevered name with them:
  // the client prints "at the Turning this becomes X" on a card you can buy.
  for (const c of ALL_CARDS) {
    if (c.type === 'sign') { names.add(c.name); if (c.fevered) names.add(c.fevered.name); }
  }
  return names;
}

/** Card names that could appear in a line and be a leak if unearned. */
const SECRETABLE = ALL_CARDS
  .flatMap((c) => [c.name, ...(c.fevered ? [c.fevered.name] : [])])
  // Longest first, so "The Colt That Doesn't Miss" is matched before "The Colt".
  .sort((a, b) => b.length - a.length);

function leaks(line: string, allowed: Set<string>): string[] {
  return SECRETABLE.filter((name) => line.includes(name) && !allowed.has(name));
}

describe('no chronicle entry tells a player something their view does not', () => {
  it('holds for every viewer, every event, across randomised games', () => {
    let lines = 0;
    let vesselLines = 0;

    for (let g = 0; g < 12; g++) {
      const seed = `leak-${g}`;
      let s: GameState = start(setup({
        seed, players: ['Ada', 'Bo', 'Cy', 'Dell'], markedIndex: g % 4,
      })).state;
      // Half the games are pushed into Act II, where the Vessel's deck exists
      // and IT REMEMBERS YOUR NAME can actually be drawn.
      if (g % 2 === 0) {
        s.whispers = s.tuning.whisperThreshold;
        s = apply(s, s.activePlayer, { t: 'END_TURN' }).state;
      }

      let cursor = 0;
      for (let i = 0; i < 700 && !s.winner; i++) {
        const actor = s.pending ? s.pending.player : s.activePlayer;
        const legal = legalCommands(s, actor);
        if (!legal.length) break;
        const pick = legal[randInt(seed, cursor++, legal.length)] as Command;
        const out = apply(s, actor, pick);
        s = out.state;

        for (const viewer of [...s.turnOrder, 'spectator'] as (PlayerId | 'spectator')[]) {
          const view = playerView(s, viewer);
          const allowed = knowable(view);
          const seat = viewer === 'spectator' ? null : viewer;
          /*
            Threats are public property. One that CLEARS leaves the Street for
            a discard `playerView` does not publish, so a name everybody just
            watched go would look unknowable a moment later. The board is
            shared: anything the Street says out loud is knowable by everyone
            at it.
          */
          const board = new Set(allowed);
          for (const e of out.events) {
            if ('cardId' in e && typeof e.cardId === 'string'
              && ['THREAT_CLEARED', 'THREAT_ENTERED', 'TOLL_PAID',
                'VESSEL_DAMAGE_RESET'].includes(e.t)) {
              board.add(card(e.cardId).name);
            }
          }
          for (const e of visibleEvents(out.events, viewer)) {
            const line = narrateLine(e, view, seat);
            if (!line) continue;
            lines++;
            if (e.t === 'NAME_READ') vesselLines++;
            expect(
              leaks(line, board),
              `${e.t} told ${viewer}: "${line}"`,
            ).toEqual([]);
          }
        }
      }
    }

    // The sweep is worthless if it narrated nothing, or never reached the card
    // this test exists for.
    expect(lines, 'no chronicle lines produced').toBeGreaterThan(500);
    expect(vesselLines, 'IT REMEMBERS YOUR NAME never fired').toBeGreaterThan(0);
  });

  it('never names the card when the read found no Sign', () => {
    // The trap, directly. A non-Sign stays on top of the deck untouched, so
    // nothing may name it — not the event, and therefore not any line built
    // from the event.
    const s = start(setup({
      seed: 'read-miss', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1,
    })).state;
    s.whispers = s.tuning.whisperThreshold;
    let t = apply(s, s.activePlayer, { t: 'END_TURN' }).state;
    const vessel = t.vessel!;
    const target = t.turnOrder.find((p) => t.players[p].status === 'posse')!;

    // A Saddlebag on top: the read finds nothing it wants.
    t.players[target].deck.unshift({ uid: 'top', cardId: 'saddlebag', fevered: false });
    t.activePlayer = vessel;
    t.actionsLeft = 3;
    const read = { uid: 'r', cardId: 'your-name', fevered: false };
    t.players[vessel].hand.push(read);

    const played = apply(t, vessel, { t: 'PLAY_CARD', uid: 'r' });
    const done = apply(played.state, vessel, {
      t: 'RESOLVE_CHOICE', choiceId: played.state.pending!.id, picks: [target],
    });

    const ev = done.events.find((e) => e.t === 'NAME_READ')!;
    expect(ev).toMatchObject({ resolved: false });
    expect('cardId' in ev, 'the event carried the card').toBe(false);

    // And the card is still where it was, unread by anyone.
    expect(done.state.players[target].deck[0]!.uid).toBe('top');

    for (const viewer of done.state.turnOrder) {
      const line = narrateLine(ev, playerView(done.state, viewer), viewer);
      expect(line).not.toContain('Saddlebag');
    }
  });

  it('does name the card when it resolved, because everyone watched it', () => {
    const s = start(setup({
      seed: 'read-hit', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1,
    })).state;
    s.whispers = s.tuning.whisperThreshold;
    const t = apply(s, s.activePlayer, { t: 'END_TURN' }).state;
    const vessel = t.vessel!;
    const target = t.turnOrder.find((p) => t.players[p].status === 'posse')!;

    t.players[target].deck.unshift({ uid: 'top', cardId: 'colt', fevered: true });
    t.activePlayer = vessel;
    t.actionsLeft = 3;
    t.players[vessel].hand.push({ uid: 'r', cardId: 'your-name', fevered: false });

    const played = apply(t, vessel, { t: 'PLAY_CARD', uid: 'r' });
    const done = apply(played.state, vessel, {
      t: 'RESOLVE_CHOICE', choiceId: played.state.pending!.id, picks: [target],
    });

    const ev = done.events.find((e) => e.t === 'NAME_READ')!;
    expect(ev).toMatchObject({ resolved: true, cardId: 'colt' });
    // It resolved, so it is in a public discard — naming it tells nobody
    // anything they could not already read off the table.
    expect(done.state.players[target].discard.some((ci) => ci.uid === 'top')).toBe(true);
  });
});
