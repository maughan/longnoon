// What a card SAYS has to match what the rules DO.
//
// Clear and Menace are printed on the card but lived on the slot: a Threat left
// standing gains a step every Dusk, and that lives in `StreetSlot.escalation`
// because `Card` is a template shared by every copy of it, including the ones
// still face down. The display read the template, so a Threat that had grown
// from Clear 4 to 6 still read 4 — and the wound bar filled against the wrong
// total, showing full while the Threat was still standing.

import { describe, it, expect } from 'vitest';
import { setup, start, apply } from '../engine';
import { newInstance, effectiveClear, effectiveMenace } from '../engine/effects';
import { playerView } from '../engine/view';
import { card } from '../content/cards';
import type { GameState, StreetSlot } from '../engine/state';

const base = () => start(setup({
  seed: 'face', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1,
})).state;

function put(s: GameState, slot: number, cardId: string): StreetSlot {
  const sl: StreetSlot = {
    instance: newInstance(s, cardId),
    damage: 0, turned: false, enteredRound: s.round, escalation: 0,
  };
  s.street[slot] = sl;
  return sl;
}

/** One round with nobody clearing anything. */
function survive(s: GameState): GameState {
  let cur = s;
  for (let i = 0; i < cur.turnOrder.length; i++) {
    cur = apply(cur, cur.activePlayer, { t: 'END_TURN' }).state;
  }
  return cur;
}

describe('what a Threat card shows', () => {
  it('shows the escalated Clear and Menace, not the printed ones', () => {
    const s = base();
    s.supply.trouble = [];
    s.supply.troubleDiscard = [];
    s.tuning = { ...s.tuning, turnOnTroubleExhausted: false };
    s.street = new Array(s.tuning.streetSlots).fill(null);
    const uid = put(s, 0, 'barons-men').instance.uid;   // printed Clear 4, Menace 2
    const printed = card('barons-men');

    const after = survive(survive(s));
    const sl = after.street.find((x) => x?.instance.uid === uid)!;
    const step = after.tuning.escalationPerRound * 2;

    // The rules moved.
    expect(effectiveClear(sl)).toBe(printed.clear! + step);
    expect(effectiveMenace(sl, after.tuning.omenMenace)).toBe(printed.menace! + step);
    // The template did not, and a face reading it would still say 4 and 2.
    expect(card('barons-men').clear).toBe(printed.clear);
    expect(effectiveClear(sl)).not.toBe(card('barons-men').clear);
  });

  it('gives the client the tuning value an Omen’s Menace depends on', () => {
    // An Omen prints Menace 0 and takes its real value from TUNING, so without
    // this the client draws every Omen as harmless.
    const s = base();
    const v = playerView(s, s.activePlayer);
    expect(v.omenMenace).toBe(s.tuning.omenMenace);
    expect(card('dead-cattle').menace).toBe(0);
    expect(v.omenMenace).toBeGreaterThan(0);
  });

  it('keeps two copies of one Threat on their own numbers', () => {
    const s = base();
    s.street = new Array(s.tuning.streetSlots).fill(null);
    const older = put(s, 0, 'rustlers');
    const younger = put(s, 1, 'rustlers');
    older.escalation = 3;
    // Same card id, same template, different lived values — which is the whole
    // reason escalation cannot live on the Card.
    expect(effectiveClear(older)).not.toBe(effectiveClear(younger));
    expect(effectiveClear(younger)).toBe(card('rustlers').clear);
  });
});
