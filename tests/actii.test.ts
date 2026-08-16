// Act II mechanics, against the paper rules in docs/the-long-noon-v1.pdf:
//
//   "THE POSSE WINS by burying the Vessel: deal 12 total damage to the Vessel
//    across any number of turns, while no Omen sits in the Street. Damage to
//    the Vessel resets to 0 if an Omen enters."
//   Old One: "you keep your own deck, all Fevered, and now you aim them again."
//   Revenant: "play a Fevered card (you choose all targets)."

import { describe, it, expect } from 'vitest';
import { setup, start, apply, legalCommands } from '../engine';
import { newInstance, opsFor, VESSEL_KEY, deckSize, damagePlayer } from '../engine/effects';
import { card, SIGN_IDS, TROUBLE_IDS } from '../content/cards';
import type { GameState, PlayerId, Op } from '../engine/state';

const base = () => setup({ seed: 'noon', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1 });

/** Trip the Whisper track, then hand the turn to a named posse player. */
function actII(): { s: GameState; posse: PlayerId; vessel: PlayerId } {
  const s0 = start(base()).state;
  s0.whispers = s0.tuning.whisperThreshold;
  const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
  const vessel = s.vessel!;
  const posse = s.turnOrder.find((id) => s.players[id].status === 'posse')!;
  s.street = [null, null, null]; // clear Act I Omens; they are tested separately
  s.activePlayer = posse;
  s.actionsLeft = 3;
  return { s, posse, vessel };
}

const threat = (s: GameState, cardId: string) => ({
  instance: newInstance(s, cardId), damage: 0, turned: false, enteredRound: s.round, escalation: 0,
});

describe('the Vessel is a damage target', () => {
  it('card damage reaches the Vessel', () => {
    const { s, posse } = actII();
    const inst = newInstance(s, 'winchester'); // damage 2, target: choose
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(2);
    expect(r.events.some((e) => e.t === 'VESSEL_DAMAGED')).toBe(true);
  });

  it('offers the Vessel alongside Threats as a choice', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'thing-in-well');
    const inst = newInstance(s, 'winchester');
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    const keys = r.state.pending!.options.map((o) => o.key);
    expect(keys).toContain(VESSEL_KEY);
    expect(keys).toContain('0');
    expect(r.state.pending!.amount).toBe(2);
  });

  it('accumulates across turns and wins at vesselClear', () => {
    const { s, posse } = actII();
    let cur = s;
    cur.vesselDamage = cur.tuning.vesselClear - 2;
    const inst = newInstance(cur, 'winchester');
    cur.players[posse].hand.push(inst);
    cur = apply(cur, posse, { t: 'PLAY_CARD', uid: inst.uid }).state;
    expect(cur.vesselDamage).toBeGreaterThanOrEqual(cur.tuning.vesselClear);
    expect(cur.winner).toBe('posse');
  });

  it('destroy cannot be aimed at the Vessel', () => {
    const { s, posse } = actII();
    const inst = newInstance(s, 'colt'); // destroy, target: choose
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
    expect(r.state.winner).toBeNull();
  });

  it('the Vessel is never offered itself as a target', () => {
    const { s, vessel } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'winchester');
    s.players[vessel].hand.push(inst);
    const r = apply(s, vessel, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
  });

  it('has no bare damage action left to abuse', () => {
    // DEAL_DAMAGE is gone entirely. It was unconditional, repeatable and always
    // worth taking, so a blocked Street turned a whole turn into three clicks —
    // and every situational card had to beat it. Damage reaches the Vessel only
    // from a card that was played.
    const { s, posse } = actII();
    expect(legalCommands(s, posse).some((c) => c.t.startsWith('DEAL'))).toBe(false);
  });
});

describe('Omens and the Vessel', () => {
  it('by default an Omen does NOT block burial', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'dead-cattle');
    expect(s.tuning.omensBlockBurial).toBe(false);

    const inst = newInstance(s, 'winchester');
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(2);
  });

  it('omensBlockBurial: true restores the original gate', () => {
    const { s, posse } = actII();
    s.tuning.omensBlockBurial = true;
    s.street[0] = threat(s, 'dead-cattle'); // Omen — cannot be cleared

    const inst = newInstance(s, 'winchester');
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
  });

  it('an Omen entering resets accumulated damage to zero', () => {
    const { s, vessel } = actII();
    s.vesselDamage = 5;
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    s.supply.mythos.unshift(newInstance(s, 'dead-cattle'));
    const r = apply(s, vessel, { t: 'SUMMON', slot: 0 });
    expect(r.state.vesselDamage).toBe(0);
    expect(r.events.some((e) => e.t === 'VESSEL_DAMAGE_RESET')).toBe(true);
  });

  it('a non-Omen Threat entering does not reset damage', () => {
    const { s, vessel } = actII();
    s.vesselDamage = 5;
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    s.supply.mythos.unshift(newInstance(s, 'thing-in-well'));
    const r = apply(s, vessel, { t: 'SUMMON', slot: 0 });
    expect(r.state.vesselDamage).toBe(5);
  });

  it('the reset survives the dropped gate — it is the other half of the rule', () => {
    const { s, posse } = actII();
    s.vesselDamage = 7;
    s.street[0] = threat(s, 'dead-cattle');
    // The parked Omen no longer blocks, so damage keeps landing...
    const inst = newInstance(s, 'winchester');
    s.players[posse].hand.push(inst);
    expect(apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid }).state.vesselDamage).toBe(9);
  });
});

describe('Fevered Signs turn on the Vessel', () => {
  const VESSEL_FACING = ['salt-line', 'night-watch', 'coyote'];
  /** Signs that clear the Street instead — deliberately no Vessel damage. */
  const STREET_FACING = ['colt', 'dynamite'];
  const hitsVessel = (o: Op) => 'target' in o && o.target === 'vessel';

  /** Derived from card data — these magnitudes are tuning, not behaviour. */
  const vesselDamageOf = (id: string) =>
    opsFor(card(id), true)
      .filter((o) => o.op === 'damage' && hitsVessel(o))
      .reduce((n, o) => n + (o as { n: number }).n, 0);

  it('only some Signs turn on the Vessel, and only when Fevered', () => {
    for (const id of VESSEL_FACING) {
      expect(opsFor(card(id), false).some(hitsVessel), `${id} clean`).toBe(false);
      expect(opsFor(card(id), true).some(hitsVessel), `${id} fevered`).toBe(true);
    }
    // The rest stay as they were — this is a subset, not a blanket rule.
    // last-words is deliberately absent: it is insurance you hold, and giving
    // it Vessel damage made hoarding it a dominant strategy.
    for (const id of ['parson', 'debt', 'hymn', 'certainty', 'stake-claim', 'widow', 'last-words']) {
      expect(opsFor(card(id), true).some(hitsVessel), id).toBe(false);
    }
  });

  it('no card both clears the Street and wounds the Vessel', () => {
    for (const id of SIGN_IDS) {
      const ops = opsFor(card(id), true);
      const clears = ops.some((o) => o.op === 'destroy' || (o.op === 'damage' && !hitsVessel(o)));
      const wounds = ops.some(hitsVessel);
      expect(clears && wounds, `${id} does both jobs at once`).toBe(false);
    }
    // ...and the Street-facing Signs really do still clear.
    for (const id of STREET_FACING) {
      expect(opsFor(card(id), true).some((o) => o.op === 'destroy'), id).toBe(true);
    }
  });

  it('every Vessel-facing face pays for it — power, not a free upgrade', () => {
    for (const id of VESSEL_FACING) {
      const ops = opsFor(card(id), true);
      const costs = ops.some(
        (o) => o.op === 'trash' && (o.target === 'self' || o.target === 'all'),
      );
      expect(costs, `${id} wounds the Vessel with no cost attached`).toBe(true);
    }
  });

  it('the cost is deck-as-health, and it eats Provisions first', () => {
    const { s, posse } = actII();
    const p = s.players[posse];
    p.deck = [newInstance(s, 'winchester'), newInstance(s, 'colt', true)];
    p.discard = [];
    const inst = newInstance(s, 'night-watch', true);
    p.hand = [inst];

    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    const after = r.state.players[posse];
    expect(after.boneyard.map((c) => c.cardId)).toEqual(['winchester']);
    expect(after.deck.map((c) => c.cardId)).toEqual(['colt']);
  });

  it('a posse player playing a Fevered Sign wounds the Vessel', () => {
    const { s, posse } = actII();
    const inst = newInstance(s, 'night-watch', true);
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(vesselDamageOf('night-watch'));
    expect(r.state.vesselDamage).toBeGreaterThan(0);
  });

  it('the same card clean does nothing to the Vessel', () => {
    const { s, posse } = actII();
    const inst = newInstance(s, 'night-watch', false);
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
  });

  it('the Old One does not wound itself with its own Fevered Signs', () => {
    const { s, vessel } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'night-watch', true);
    s.players[vessel].hand.push(inst);
    const r = apply(s, vessel, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
  });

  it('a Revenant does not help bury the Vessel — they win with the Old One', () => {
    const { s, posse } = actII();
    s.players[posse].status = 'revenant';
    const inst = newInstance(s, 'night-watch', true);
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
  });

  it('under the restored gate, an Omen blocks Fevered Sign damage too', () => {
    const { s, posse } = actII();
    s.tuning.omensBlockBurial = true;
    s.street[0] = threat(s, 'dead-cattle');
    const inst = newInstance(s, 'colt', true);
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.vesselDamage).toBe(0);
  });

  it('the Colt still destroys the leftmost Threat as well', () => {
    const { s, posse } = actII();
    s.street[1] = threat(s, 'thing-in-well');
    const inst = newInstance(s, 'colt', true);
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.street[1]).toBeNull();
    expect(r.state.vesselDamage).toBe(vesselDamageOf('colt'));
  });
});

describe('Omens make attrition unavoidable', () => {
  it('an Omen deals its Menace at Dusk', () => {
    const s = start(setup({
      seed: 'omen-menace', players: ['Ada', 'Bo', 'Cy'],
      tuning: { omenMenace: 2 },
    })).state;
    s.street = [null, null, null];
    s.street[0] = threat(s, 'dead-cattle');
    const before = s.turnOrder.map((id) => s.players[id].deck.length + s.players[id].discard.length);

    let cur = s;
    for (const id of cur.turnOrder) cur = apply(cur, id, { t: 'END_TURN' }).state;

    const after = cur.turnOrder.map((id) => cur.players[id].deck.length + cur.players[id].discard.length);
    const lost = before.reduce((a, b) => a + b, 0) - after.reduce((a, b) => a + b, 0);
    expect(lost).toBeGreaterThan(0);
  });

  it('omenMenace: 0 restores the paper rule — Omens cost only Whispers', () => {
    const s = start(setup({
      seed: 'omen-menace', players: ['Ada', 'Bo', 'Cy'],
      tuning: { omenMenace: 0 },
    })).state;
    s.street = [null, null, null];
    s.street[0] = threat(s, 'dead-cattle');

    let cur = s;
    const before = cur.whispers;
    for (const id of cur.turnOrder) cur = apply(cur, id, { t: 'END_TURN' }).state;

    expect(cur.whispers).toBeGreaterThan(before);
    expect(cur.log.some((e) => e.t === 'MENACE')).toBe(false);
  });

  it('Menace ties break at random, not by turn order', () => {
    // Every seat holds zero Signs, so every seat is tied. Over many seeds the
    // victim must vary — a first-match rule would always pick the same one.
    const victims = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const s = start(setup({
        seed: `tie-${i}`, players: ['Ada', 'Bo', 'Cy'],
        tuning: { omenMenace: 2 },
      })).state;
      s.street = [null, null, null];
      s.street[0] = threat(s, 'dead-cattle');
      let cur = s;
      for (const id of cur.turnOrder) cur = apply(cur, id, { t: 'END_TURN' }).state;
      for (const e of cur.log) if (e.t === 'MENACE') victims.add(e.player);
    }
    expect(victims.size).toBeGreaterThan(1);
  });
});

describe("the Marked player's secret aim", () => {
  // "SECRET AIM: at the Turning, two other players must each hold 3 or more
  //  Signs. If they do, you begin the Old One's turn with +3 Doom."
  const atTurning = (signsPerSeat: number[], markedIndex = 1) => {
    const s = start(setup({
      seed: 'aim', players: ['Ada', 'Bo', 'Cy'], markedIndex,
    })).state;
    s.turnOrder.forEach((id, i) => {
      for (let n = 0; n < signsPerSeat[i]; n++) {
        s.players[id].discard.push(newInstance(s, 'certainty'));
      }
    });
    s.whispers = s.tuning.whisperThreshold;
    return apply(s, s.activePlayer, { t: 'END_TURN' });
  };

  it('grants +3 Doom when two other players each hold 3+ Signs', () => {
    const r = atTurning([3, 0, 3]); // Bo is Marked; Ada and Cy are corrupted
    expect(r.state.doom).toBe(6);
    expect(r.events.some((e) => e.t === 'TURNING' && e.aimMet)).toBe(true);
  });

  it('does not grant it when only one other player is corrupted', () => {
    const r = atTurning([3, 0, 2]);
    expect(r.state.doom).toBe(3);
    expect(r.events.some((e) => e.t === 'TURNING' && e.aimMet)).toBe(false);
  });

  it("the Marked player's own Signs do not count toward the aim", () => {
    const r = atTurning([3, 9, 0]);
    expect(r.state.doom).toBe(3);
  });

  it('a traitorless table never grants it', () => {
    const s = start(setup({ seed: 'aim', players: ['Ada', 'Bo', 'Cy'], markedIndex: null })).state;
    for (const id of s.turnOrder) {
      for (let n = 0; n < 5; n++) s.players[id].discard.push(newInstance(s, 'certainty'));
    }
    s.whispers = s.tuning.whisperThreshold;
    expect(apply(s, s.activePlayer, { t: 'END_TURN' }).state.doom).toBe(3);
  });
});

describe('the Long Season has an ending', () => {
  it('the Turning fires when the Trouble deck runs out', () => {
    const s = start(setup({ seed: 'season', players: ['Ada', 'Bo', 'Cy'] })).state;
    s.supply.trouble = [];
    s.whispers = 0; // nobody resisted anything
    const r = apply(s, s.activePlayer, { t: 'END_TURN' });
    expect(r.state.act).toBe('mythos');
    expect(r.state.vessel).not.toBeNull();
  });

  it('turnOnTroubleExhausted: false leaves a cautious table with no ending', () => {
    const s = start(setup({
      seed: 'season', players: ['Ada', 'Bo', 'Cy'],
      tuning: { turnOnTroubleExhausted: false },
    })).state;
    s.supply.trouble = [];
    s.whispers = 0;
    const r = apply(s, s.activePlayer, { t: 'END_TURN' });
    expect(r.state.act).toBe('trouble');
  });
});

describe('the fallen aim their Fevered cards', () => {
  it('opsFor drops the retarget when aimed, but keeps the appended cost', () => {
    const colt = card('colt');
    expect(opsFor(colt, true)[0]).toMatchObject({ target: 'leftmostSlot' });
    expect(opsFor(colt, true, true)[0]).toMatchObject({ target: 'choose' });

    const salt = card('salt-line');
    expect(opsFor(salt, true, true).slice(salt.ops.length))
      .toContainEqual({ op: 'whisper', n: 1 });
  });

  it('a clean card is unaffected by aiming', () => {
    const colt = card('colt');
    expect(opsFor(colt, false, true)).toEqual(colt.ops);
  });

  it('the Old One chooses targets instead of hitting the leftmost slot', () => {
    const { s, vessel } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    const inst = newInstance(s, 'colt', true); // Fevered: "It Chooses"
    s.players[vessel].hand.push(inst);

    const r = apply(s, vessel, { t: 'PLAY_CARD', uid: inst.uid });
    // Aimed, so the engine must ask rather than auto-resolve leftmost.
    expect(r.state.pending).not.toBeNull();
    expect(r.state.pending!.player).toBe(vessel);
    expect(r.state.street[0]).not.toBeNull();
  });

  it('a posse player gets no such choice — the Fevered face still aims itself', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    const inst = newInstance(s, 'colt', true);
    s.players[posse].hand.push(inst);

    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.pending).toBeNull();
    expect(r.state.street[0]).toBeNull(); // leftmost, not chosen
  });

  it('a card resolved by CALL is not aimed', () => {
    const { s, vessel, posse } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    s.players[posse].deck.unshift(newInstance(s, 'colt', true));
    // CALL is paid for out of the Whisper pool now.
    s.whispers = s.tuning.callWhisperCost;

    const r = apply(s, vessel, { t: 'CALL', target: posse });
    expect(r.state.pending).toBeNull();
    expect(r.state.street[0]).toBeNull();
  });
});

describe('the Revenant burns out', () => {
  /** Knock a player down to a Revenant with a small Sign-only deck. */
  function fallen(tuning = {}) {
    const s = start(setup({
      seed: 'rev', players: ['Ada', 'Bo', 'Cy', 'Di'], markedIndex: null, tuning,
    })).state;
    const victim = s.turnOrder[3];
    const p = s.players[victim];
    p.status = 'revenant';
    p.deck = [newInstance(s, 'colt', true), newInstance(s, 'dynamite', true)];
    p.hand = [newInstance(s, 'colt', true)];
    p.discard = [];
    return { s, victim };
  }

  it('burial is gone — there is no way to put a Revenant down by force', () => {
    const { s, victim } = fallen();
    const a = s.turnOrder[0];
    s.activePlayer = a;
    s.actionsLeft = 3;
    const kinds = new Set(legalCommands(s, a).map((c) => c.t));
    expect(kinds.has('BURY_REVENANT' as never)).toBe(false);
    expect(kinds.has('RISE' as never)).toBe(false);
    expect(s.players[victim].status).toBe('revenant');
  });

  /** Play out whole turns until `victim` has taken another one (and drawn). */
  function roundTrip(s0: GameState) {
    let cur = s0;
    const events: { t: string }[] = [];
    for (let i = 0; i < cur.turnOrder.length + 1 && !cur.winner; i++) {
      const r = apply(cur, cur.activePlayer, { t: 'END_TURN' });
      cur = r.state;
      events.push(...r.events);
    }
    return { state: cur, events };
  }

  it('shrinks by revenantDecay on every recycle', () => {
    const { s, victim } = fallen({ revenantDecay: 1 });
    const p = s.players[victim];
    p.deck = [];
    p.hand = [];
    p.discard = [
      newInstance(s, 'colt', true), newInstance(s, 'colt', true), newInstance(s, 'colt', true),
    ];
    s.activePlayer = victim;
    s.actionsLeft = 2;
    // Coming round to their next turn forces a recycle, which costs a card.
    const after = roundTrip(s).state.players[victim];
    expect(after.deck.length + after.hand.length + after.discard.length).toBeLessThan(3);
    expect(after.boneyard.length).toBeGreaterThan(0);
  });

  it('is gone for good once nothing is left to draw', () => {
    const { s, victim } = fallen();
    const p = s.players[victim];
    p.deck = [];
    p.hand = [];
    p.discard = [];
    s.activePlayer = victim;
    const r = roundTrip(s);
    expect(r.state.players[victim].status).toBe('gone');
    expect(r.events.some((e) => e.t === 'BURNED_OUT')).toBe(true);
  });

  it('the Old One floors at one card so the endgame cannot stall', () => {
    const { s } = actII();
    const vessel = s.vessel!;
    const p = s.players[vessel];
    p.deck = [];
    p.hand = [];
    p.discard = [newInstance(s, 'colt', true)];
    s.activePlayer = vessel;
    expect(roundTrip(s).state.players[vessel].status).toBe('oldOne');
  });

  it('Whisper discards a card for +1 Whisper', () => {
    const { s, victim } = fallen();
    s.activePlayer = victim; s.actionsLeft = 2;
    const uid = s.players[victim].hand[0].uid;
    const before = s.whispers;
    const r = apply(s, victim, { t: 'REVENANT_WHISPER', uid });
    expect(r.state.whispers).toBe(before + 1);
    expect(r.state.players[victim].hand).toHaveLength(0);
  });

  it('Beckon pays a living player for buying a Sign', () => {
    const { s, victim } = fallen();
    const target = s.turnOrder[0];
    s.activePlayer = victim; s.actionsLeft = 2;
    let cur = apply(s, victim, { t: 'BECKON', target }).state;
    expect(cur.beckoned).toBe(target);

    cur.activePlayer = target; cur.actionsLeft = 3;
    cur.players[target].gritThisTurn = 10;
    const r = apply(cur, target, { t: 'BUY', cardId: 'certainty' });
    expect(r.state.players[target].gritThisTurn).toBe(10 - 2 + r.state.tuning.beckonGrit);
    expect(r.state.beckoned).toBeNull();
  });
});

describe('Act I Bounties — the economy inversion', () => {
  /** Put a Threat one hit from cleared, with `who` holding a finishing card. */
  function onTheBrink(cardId: string, act: 'trouble' | 'mythos' = 'trouble') {
    const s = start(setup({ seed: 'bounty', players: ['Ada', 'Bo', 'Cy'] })).state;
    s.act = act;
    s.street = [null, null, null];
    const def = card(cardId);
    s.street[0] = {
      escalation: 0,
      instance: newInstance(s, cardId),
      damage: (def.clear ?? 1) - 1,
      turned: false,
      enteredRound: s.round,
    };
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'six-gun'); // damage 1, target: choose
    s.players[who].hand = [inst];
    return { s, who, uid: inst.uid };
  }

  it('every Act I Trouble card pays a Bounty; Omens never do', () => {
    for (const id of TROUBLE_IDS) {
      const def = card(id);
      if (def.type === 'omen') {
        expect(def.bounty, `${id} is an Omen`).toBeUndefined();
      } else {
        expect(def.bounty?.length, `${id} has no Bounty`).toBeGreaterThan(0);
      }
    }
  });

  it('clearing a Trouble card pays its Bounty', () => {
    const { s, who, uid } = onTheBrink('cardsharp'); // BOUNTY: Draw 2
    const before = s.players[who].hand.length - 1; // the Six-Gun leaves the hand
    const r = apply(s, who, { t: 'PLAY_CARD', uid });
    expect(r.events.some((e) => e.t === 'BOUNTY')).toBe(true);
    expect(r.state.players[who].hand.length).toBe(before + 2);
  });

  it('"Nothing in Act II pays a Bounty. Ever."', () => {
    const { s, who, uid } = onTheBrink('cardsharp', 'mythos');
    const r = apply(s, who, { t: 'PLAY_CARD', uid });
    expect(r.events.some((e) => e.t === 'THREAT_CLEARED')).toBe(true);
    expect(r.events.some((e) => e.t === 'BOUNTY')).toBe(false);
  });

  it('banks Grit for the next turn, not this one', () => {
    const { s, who, uid } = onTheBrink('stage-robbery'); // +3 Grit next turn
    const r = apply(s, who, { t: 'PLAY_CARD', uid });
    expect(r.state.players[who].gritThisTurn).toBe(0);
    expect(r.state.nextTurnGrit[who]).toBe(3);

    // ...and it lands when their turn comes round again.
    let cur = r.state;
    for (let i = 0; i < cur.turnOrder.length && cur.activePlayer !== who; i++) {
      cur = apply(cur, cur.activePlayer, { t: 'END_TURN' }).state;
    }
    cur = apply(cur, cur.activePlayer, { t: 'END_TURN' }).state;
    while (cur.activePlayer !== who) {
      cur = apply(cur, cur.activePlayer, { t: 'END_TURN' }).state;
    }
    expect(cur.players[who].gritThisTurn).toBe(3);
    expect(cur.nextTurnGrit[who]).toBeUndefined();
  });

  it('a Bounty that pays the whole table reaches everyone', () => {
    const { s, who, uid } = onTheBrink('silver-bit'); // Draw 1, all +1 Grit next turn
    const r = apply(s, who, { t: 'PLAY_CARD', uid });
    for (const id of r.state.turnOrder) expect(r.state.nextTurnGrit[id]).toBe(1);
  });

  it('destroying a Threat pays the Bounty too', () => {
    const s = start(setup({ seed: 'bounty2', players: ['Ada', 'Bo', 'Cy'] })).state;
    s.street = [null, null, null];
    s.street[0] = {
      instance: newInstance(s, 'cardsharp'), damage: 0, turned: false, enteredRound: s.round, escalation: 0,
    };
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'colt'); // destroy
    s.players[who].hand = [inst];
    const r = apply(s, who, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.events.some((e) => e.t === 'BOUNTY')).toBe(true);
  });
});

describe('Trouble cards flip to their reverses at the Turning', () => {
  function withStreet(ids: (string | null)[], tuning = {}) {
    const s = start(setup({
      seed: 'rev-face', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1, tuning,
    })).state;
    s.street = [null, null, null];
    ids.forEach((id, i) => { if (id) s.street[i] = threat(s, id); });
    return s;
  }

  it('the four Trouble cards with reverses flip; the rest stay', () => {
    const s = withStreet(['claim-jumpers', 'cardsharp', 'prairie-fire']);
    s.whispers = s.tuning.whisperThreshold;
    const r = apply(s, s.activePlayer, { t: 'END_TURN' }).state;
    expect(r.street[0]!.instance.cardId).toBe('never-miners');
    expect(r.street[1]!.instance.cardId).toBe('cardsharp'); // no reverse
    expect(r.street[2]!.instance.cardId).toBe('wrong-colour');
  });

  it('every reverse is a real card, and none of them pays a Bounty', () => {
    for (const id of TROUBLE_IDS) {
      const rev = card(id).reverse;
      if (!rev) continue;
      expect(() => card(rev)).not.toThrow();
      expect(card(rev).bounty).toBeUndefined();
    }
  });

  it('It Burns the Wrong Colour hits every player', () => {
    const s = withStreet(['wrong-colour']);
    s.act = 'mythos';
    s.street[0]!.turned = true;
    const before = s.turnOrder.map((id) => deckSize(s, id));
    let cur = s;
    for (const id of cur.turnOrder) cur = apply(cur, id, { t: 'END_TURN' }).state;
    const hit = s.turnOrder.filter(
      (id, i) => deckSize(cur, id) < before[i] || cur.players[id].status !== 'posse',
    );
    expect(hit.length).toBe(s.turnOrder.length);
  });

  it('The Baron Kept His Promise adds Whispers when cleared', () => {
    const s = withStreet(['baron-promise']);
    s.street[0]!.damage = card('baron-promise').clear! - 1;
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'six-gun');
    s.players[who].hand = [inst];
    const before = s.whispers;
    const r = apply(s, who, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.whispers).toBe(before + 2);
  });

  it('They Brought the Herd Back cannot be cleared while an Omen sits', () => {
    const s = withStreet(['herd-back', 'dead-cattle']);
    s.street[0]!.damage = card('herd-back').clear! - 1;
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'six-gun');
    s.players[who].hand = [inst];
    const r = apply(s, who, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.street[0]).not.toBeNull(); // damage sticks, the card does not die

    // Clear the Omen out of the way and it dies normally.
    const s2 = withStreet(['herd-back']);
    s2.street[0]!.damage = card('herd-back').clear! - 1;
    s2.actionsLeft = 3;
    const inst2 = newInstance(s2, 'six-gun');
    s2.players[s2.activePlayer].hand = [inst2];
    expect(apply(s2, s2.activePlayer, { t: 'PLAY_CARD', uid: inst2.uid }).state.street[0]).toBeNull();
  });
});

describe('the three Signs that used to do nothing', () => {
  it('no op resolves as a silent no-op any more', () => {
    // Every op a Sign can carry must have a real effect behind it.
    const inert = new Set(['prevent']);
    for (const id of SIGN_IDS) {
      for (const face of [false, true]) {
        for (const op of opsFor(card(id), face)) {
          expect(inert.has(op.op), `${id} still carries ${op.op}`).toBe(false);
        }
      }
    }
  });

  it('Night Watch cancels one Threat\'s Menace for the round', () => {
    const s = start(setup({ seed: 'nw', players: ['Ada', 'Bo', 'Cy'] })).state;
    s.street = [null, null, null];
    s.street[0] = threat(s, 'barons-men'); // Menace 2
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'night-watch');
    s.players[who].hand.push(inst); // add, don't replace — a shrunken deck falls

    const r = apply(s, who, { t: 'PLAY_CARD', uid: inst.uid });
    // Only one Threat is in the Street, so the choice resolves itself.
    const played = r.state;
    expect(played.street[0]!.menaceCancelled).toBe(true);

    let cur = played;
    const before = cur.turnOrder.map((id) => deckSize(cur, id));
    for (const id of cur.turnOrder) cur = apply(cur, id, { t: 'END_TURN' }).state;
    // Dusk passed with no Menace dealt by that Threat.
    expect(cur.log.some((e) => e.t === 'MENACE')).toBe(false);
    expect(cur.turnOrder.map((id) => deckSize(cur, id))).toEqual(before);
  });

  it('the cancellation lapses at the next Dawn', () => {
    const s = start(setup({ seed: 'nw2', players: ['Ada', 'Bo', 'Cy'] })).state;
    s.street = [null, null, null];
    s.street[0] = threat(s, 'barons-men');
    s.street[0]!.menaceCancelled = true;
    let cur = s;
    for (const id of cur.turnOrder) cur = apply(cur, id, { t: 'END_TURN' }).state;
    // A new round has begun; whatever is still in slot 0 is unguarded again.
    if (cur.street[0]) expect(cur.street[0]!.menaceCancelled).toBe(false);
  });

  it('Salt Line absorbs damage before any card is lost', () => {
    const s = start(setup({ seed: 'sl', players: ['Ada', 'Bo', 'Cy'] })).state;
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'salt-line');
    s.players[who].hand.push(inst);
    // "any player" is a choice; ward yourself.
    const r = apply(s, who, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.pending).not.toBeNull();
    const cur = apply(r.state, who, {
      t: 'RESOLVE_CHOICE', choiceId: r.state.pending!.id, picks: [who],
    }).state;
    expect(cur.shields[who]).toBe(2);

    const before = deckSize(cur, who);
    const ev: never[] = [];
    damagePlayer(cur, who, 2, ev);
    expect(deckSize(cur, who)).toBe(before);   // fully absorbed
    expect(cur.shields[who]).toBe(0);

    damagePlayer(cur, who, 1, ev);
    expect(deckSize(cur, who)).toBe(before - 1); // shield spent, cards start going
  });

  it('the Coyote reads the Threat deck, not your own', () => {
    const s = start(setup({ seed: 'cy', players: ['Ada', 'Bo', 'Cy'] })).state;
    const who = s.activePlayer;
    s.actionsLeft = 3;
    const inst = newInstance(s, 'coyote');
    s.players[who].hand.push(inst);
    const top3 = s.supply.trouble.slice(0, 3).map((ci) => ci.uid);

    const r = apply(s, who, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.pending).not.toBeNull();
    expect(r.state.pending!.options.map((o) => o.key)).toEqual(top3);

    // Steering the third card to the front changes what arrives next.
    const chosen = top3[2];
    const done = apply(r.state, who, {
      t: 'RESOLVE_CHOICE', choiceId: r.state.pending!.id, picks: [chosen],
    }).state;
    expect(done.supply.trouble[0].uid).toBe(chosen);
  });
});

describe('Last Words — insurance you hold, not a battery', () => {
  /** A posse player one draw away from falling, holding nothing but a boneyard. */
  function onTheBrink(withLastWords: boolean, fevered = false) {
    const s = start(setup({ seed: 'lw', players: ['Ada', 'Bo', 'Cy'] })).state;
    const who = s.turnOrder[2];
    const p = s.players[who];
    p.deck = []; p.hand = []; p.discard = [];
    p.boneyard = [
      newInstance(s, 'saddlebag'), newInstance(s, 'six-gun'), newInstance(s, 'canteen'),
    ];
    if (withLastWords) p.deck.push(newInstance(s, 'last-words', fevered));
    return { s, who };
  }

  it('carries no Vessel damage — that is what made hoarding it dominant', () => {
    for (const face of [false, true]) {
      const ops = opsFor(card('last-words'), face);
      expect(ops.some((o) => 'target' in o && o.target === 'vessel')).toBe(false);
    }
  });

  it('saves you from falling, and is spent doing it', () => {
    const { s, who } = onTheBrink(true);
    const ev: never[] = [];
    damagePlayer(s, who, 5, ev);
    expect(s.players[who].status).toBe('posse'); // still standing
    expect(s.players[who].deck.length).toBe(2);  // left with two cards, not none
    expect(s.players[who].boneyard.some((c) => c.cardId === 'last-words')).toBe(true);
  });

  it('without it you fall as normal', () => {
    const { s, who } = onTheBrink(false);
    damagePlayer(s, who, 5, []);
    expect(s.players[who].status).toBe('revenant');
  });

  it('saves you only once', () => {
    const { s, who } = onTheBrink(true);
    damagePlayer(s, who, 5, []);
    expect(s.players[who].status).toBe('posse');
    damagePlayer(s, who, 5, []);
    expect(s.players[who].status).toBe('revenant');
  });

  it('Fevered it still saves you, but you come back Scarred', () => {
    const { s, who } = onTheBrink(true, true);
    damagePlayer(s, who, 5, []);
    expect(s.players[who].status).toBe('posse');
    expect(s.players[who].scars).toBe(1);
  });
});


describe('the posse can actually win', () => {
  /**
   * The burial blow nearly always arrives through a choice.
   *
   * With any Threat in the Street a `damage` op offers the slots AND the
   * Vessel, so the player is asked to aim — and `apply`'s pending-choice branch
   * returned before the win check. The game then only ended at Dusk, where Doom
   * is tested first, so the Old One could take a game the posse had already won.
   */
  it('wins the instant the Vessel is buried, even through a prompt', () => {
    const { s, posse } = actII();
    s.vesselDamage = s.tuning.vesselClear - 2;
    s.street[0] = threat(s, 'barons-men');           // forces the prompt
    const inst = newInstance(s, 'winchester');       // damage 2, target: choose
    s.players[posse].hand.push(inst);

    const played = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid }).state;
    expect(played.pending, 'a target should be asked for').not.toBeNull();

    const r = apply(played, posse, {
      t: 'RESOLVE_CHOICE', choiceId: played.pending!.id, picks: [VESSEL_KEY],
    });
    expect(r.state.vesselDamage).toBeGreaterThanOrEqual(s.tuning.vesselClear);
    expect(r.state.winner).toBe('posse');
    expect(r.events.some((e) => e.t === 'GAME_OVER')).toBe(true);
  });

  it('still wins when the Vessel is the only target and nothing is asked', () => {
    const { s, posse } = actII();
    s.vesselDamage = s.tuning.vesselClear - 2;
    const inst = newInstance(s, 'winchester');
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.winner).toBe('posse');
  });

  it('leaves no prompt standing once the game is over', () => {
    const { s, posse } = actII();
    s.vesselDamage = s.tuning.vesselClear - 2;
    s.street[0] = threat(s, 'barons-men');
    const inst = newInstance(s, 'winchester');
    s.players[posse].hand.push(inst);
    const played = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid }).state;
    const done = apply(played, posse, {
      t: 'RESOLVE_CHOICE', choiceId: played.pending!.id, picks: [VESSEL_KEY],
    }).state;
    // A prompt outliving the game is one the client offers and the server then
    // refuses for ever.
    expect(done.pending).toBeNull();
    expect(done.resolution).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The Act II interaction pass: two dominant actions deleted, and what replaced
// them. Both were the same bug — unconditional, repeatable, guaranteed value —
// so every test here is really asking "is this move still conditional?"

describe('the dominant actions are gone', () => {
  it('never offers a bare damage action, in any state', () => {
    // It was the posse's whole turn on a blocked Street: click it three times.
    const { s, posse, vessel } = actII();
    for (const st of [s, { ...s, street: [null, null, null, null] } as GameState]) {
      for (const pid of [posse, vessel]) {
        const legal = legalCommands(st as GameState, pid);
        expect(legal.every((c) => c.t !== ('DEAL_DAMAGE' as never))).toBe(true);
      }
    }
  });

  it('never offers the Old One a free +2 Doom', () => {
    const { s, vessel } = actII();
    s.activePlayer = vessel;
    const legal = legalCommands(s, vessel);
    expect(legal.every((c) => c.t !== ('WHISPER' as never))).toBe(true);
    // And the seat is not left empty-handed by the deletion.
    expect(legal.filter((c) => c.t !== 'END_TURN').length).toBeGreaterThan(0);
  });

  it('leaves a player with a blocked Street something to do', () => {
    // The whole point of the deletion: cards in hand still mean decisions.
    const { s, posse } = actII();
    s.street = [threat(s, 'dry-grass'), threat(s, 'nothing-comes'), null, null];
    s.players[posse].hand = [newInstance(s, 'winchester'), newInstance(s, 'colt', true)];
    const legal = legalCommands(s, posse).filter((c) => c.t !== 'END_TURN');
    expect(legal.length).toBeGreaterThan(0);
  });
});

describe('damage aimed at the Vessel', () => {
  it('offers the Vessel alongside the Street in Act II', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'thing-in-well');
    const inst = newInstance(s, 'winchester');       // damage 2, target: choose
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.pending).not.toBeNull();
    expect(r.state.pending!.options.some((o) => o.key === VESSEL_KEY)).toBe(true);
  });

  it('does not offer the Vessel in Act I', () => {
    const s = start(base()).state;                    // still the Long Season
    s.street[0] = threat(s, 'barons-men');
    s.street[1] = threat(s, 'rustlers');
    const pid = s.activePlayer;
    const inst = newInstance(s, 'winchester');
    s.players[pid].hand.push(inst);
    const r = apply(s, pid, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.pending!.options.some((o) => o.key === VESSEL_KEY)).toBe(false);
  });
});

describe('Tolls', () => {
  const dryGrass = (s: GameState, slot = 0) => { s.street[slot] = threat(s, 'dry-grass'); };

  it('is offered only when the player can actually pay', () => {
    const { s, posse } = actII();
    dryGrass(s);
    s.players[posse].hand = [newInstance(s, 'winchester')];   // no Sign to give
    expect(legalCommands(s, posse).some((c) => c.t === 'PAY_TOLL')).toBe(false);

    s.players[posse].hand.push(newInstance(s, 'colt', true)); // now there is one
    expect(legalCommands(s, posse).some((c) => c.t === 'PAY_TOLL')).toBe(true);
  });

  it('removes the Threat and costs exactly what the card says', () => {
    const { s, posse } = actII();
    dryGrass(s);
    const sign = newInstance(s, 'colt', true);
    s.players[posse].hand = [sign, newInstance(s, 'winchester')];
    const scarsBefore = s.players[posse].scars;
    const actions = s.actionsLeft;

    const r = apply(s, posse, { t: 'PAY_TOLL', slot: 0 });
    const p = r.state.players[posse];

    expect(r.state.street[0]).toBeNull();
    expect(r.state.actionsLeft).toBe(actions - 1);
    // Trash a Sign and take a Scar — the printed price, and nothing else.
    expect(p.hand.some((ci) => ci.uid === sign.uid)).toBe(false);
    expect(p.boneyard.some((ci) => ci.uid === sign.uid)).toBe(true);
    expect(p.scars).toBe(scarsBefore + 1);
    expect(p.discard.filter((ci) => ci.cardId === 'scar')).toHaveLength(1);
    expect(p.hand).toHaveLength(1);                  // the Winchester is untouched
    expect(r.events.some((e) => e.t === 'TOLL_PAID')).toBe(true);
  });

  it('cannot be paid for a Threat that prints no Toll', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'thing-in-well');
    expect(() => apply(s, posse, { t: 'PAY_TOLL', slot: 0 })).toThrow();
  });

  it('leaves a Sign-less deck a Toll it can still meet', () => {
    // Nothing Comes asks for cards, not Signs — a Puritan table must not be
    // permanently locked out of its own Street.
    const { s, posse } = actII();
    s.street[0] = threat(s, 'nothing-comes');
    s.players[posse].hand = [];
    expect(legalCommands(s, posse).some((c) => c.t === 'PAY_TOLL')).toBe(true);
  });
});

describe('the Old One rebuilt', () => {
  const asOldOne = () => {
    const { s, vessel, posse } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    return { s, vessel, posse };
  };

  it('SHUTTER takes the named type off every player, and expires', () => {
    const { s, vessel, posse } = asOldOne();
    for (const pid of s.turnOrder) {
      s.players[pid].hand = [newInstance(s, 'winchester'), newInstance(s, 'colt', true)];
    }
    const kitPlayable = (st: GameState, pid: string) =>
      legalCommands(st, pid).some(
        (c) => c.t === 'PLAY_CARD'
          && card(st.players[pid].hand.find((h) => h.uid === c.uid)!.cardId).type === 'kit',
      );

    const shut = apply(s, vessel, { t: 'SHUTTER', cardType: 'kit' }).state;
    for (const pid of shut.turnOrder) {
      if (shut.players[pid].status === 'oldOne') continue;
      shut.activePlayer = pid;
      shut.actionsLeft = 3;
      expect(kitPlayable(shut, pid), pid).toBe(false);
      // A Sign is untouched, and cashing the Kit in for Grit still works.
      expect(legalCommands(shut, pid).some((c) => c.t === 'SPEND_GRIT')).toBe(true);
    }

    // It runs out on schedule.
    const later = { ...shut, round: shut.round + shut.tuning.shutterDuration + 1 };
    later.activePlayer = posse;
    later.actionsLeft = 3;
    expect(kitPlayable(later, posse)).toBe(true);
  });

  it('CALL is unavailable at no Whispers, and spends them when it is', () => {
    const { s, vessel, posse } = asOldOne();
    s.whispers = 0;
    expect(legalCommands(s, vessel).some((c) => c.t === 'CALL')).toBe(false);
    expect(() => apply(s, vessel, { t: 'CALL', target: posse })).toThrow();

    s.whispers = s.tuning.callWhisperCost + 1;
    expect(legalCommands(s, vessel).some((c) => c.t === 'CALL')).toBe(true);
    const r = apply(s, vessel, { t: 'CALL', target: posse });
    expect(r.state.whispers).toBe(1);
  });

  it('OFFER puts the Sign in the target discard, Fevered', () => {
    const { s, vessel, posse } = asOldOne();
    const before = s.players[posse].discard.length;
    const r = apply(s, vessel, { t: 'OFFER', target: posse, cardId: 'colt' });
    const disc = r.state.players[posse].discard;
    expect(disc).toHaveLength(before + 1);
    const gift = disc[disc.length - 1];
    expect(gift.cardId).toBe('colt');
    expect(gift.fevered).toBe(true);
    expect(gift.offeredUntil).toBe(s.round + 1);
  });

  it('a gift played in time pays the Old One, and later does not', () => {
    const { s, vessel, posse } = asOldOne();
    const given = apply(s, vessel, { t: 'OFFER', target: posse, cardId: 'certainty' }).state;
    const gift = given.players[posse].discard.at(-1)!;

    const soon = structuredClone(given);
    soon.players[posse].hand.push(gift);
    soon.activePlayer = posse;
    soon.actionsLeft = 3;
    const paid = apply(soon, posse, { t: 'PLAY_CARD', uid: gift.uid });
    expect(paid.events.some((e) => e.t === 'OFFER_TAKEN')).toBe(true);

    const late = structuredClone(soon);
    late.round = gift.offeredUntil! + 1;
    const free = apply(late, posse, { t: 'PLAY_CARD', uid: gift.uid });
    expect(free.events.some((e) => e.t === 'OFFER_TAKEN')).toBe(false);
  });
});

describe('Whispers are the Old One’s ammunition', () => {
  it('the Turning empties the track it just spent', () => {
    const s0 = start(base()).state;
    s0.whispers = s0.tuning.whisperThreshold + 5;
    const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
    expect(s.act).toBe('mythos');
    expect(s.whispers).toBe(0);
  });

  it('buying a Sign in Act II arms the thing across the table', () => {
    const { s, posse } = actII();
    s.players[posse].gritThisTurn = 10;
    const before = s.whispers;
    const r = apply(s, posse, { t: 'BUY', cardId: 'colt' });
    expect(r.state.whispers).toBe(before + card('colt').whispers!);
  });

  it('buying a Sign in Act I still costs nothing until it is played', () => {
    // The rule that stops Sign-hoarding being the dominant Act I line.
    const s = start(base()).state;
    s.players[s.activePlayer].gritThisTurn = 10;
    const r = apply(s, s.activePlayer, { t: 'BUY', cardId: 'colt' });
    expect(r.state.whispers).toBe(s.whispers);
  });

  it('the fallen keep the pool filled when the posse stops buying', () => {
    // Without this the Old One goes dry the moment the posse refuses to buy,
    // and the seat is back to having nothing to do.
    const { s, posse } = actII();
    s.players[posse].status = 'revenant';
    s.players[posse].hand = [newInstance(s, 'saddlebag')];
    s.activePlayer = posse;
    s.actionsLeft = 2;
    s.whispers = 0;
    const uid = s.players[posse].hand[0].uid;
    const r = apply(s, posse, { t: 'REVENANT_WHISPER', uid });
    expect(r.state.whispers).toBe(1);
  });
});
