// Act II mechanics, against the paper rules in docs/the-long-noon-v1.pdf:
//
//   "THE POSSE WINS by burying the Vessel: deal 12 total damage to the Vessel
//    across any number of turns, while no Omen sits in the Street. Damage to
//    the Vessel resets to 0 if an Omen enters."
//   The Vessel: "you keep your own deck, all Fevered, and now you aim them again."
//   Revenant: "play a Fevered card (you choose all targets)."

import { describe, it, expect } from 'vitest';
import { setup as rawSetup, start, apply, legalCommands, isLegal } from '../engine';
import {
  newInstance, opsFor, VESSEL_KEY, deckSize, damagePlayer, drawCards,
  effectiveMenace, signsHeld, pushOps, runQueue, resolveChoice,
} from '../engine/effects';
import { card, SIGN_IDS, TROUBLE_IDS } from '../content/cards';
import type { GameState, PlayerId, Op, Card, GameEvent } from '../engine/state';

/*
  Every `setup` in this file runs with the two board-rewriting rules OFF.

  `refillNoClearable` deals a Threat when the Street holds nothing clearable and
  `rotateStart` moves who begins the round. Both are on by default and both are
  correct — and both rewrite a hand-built board or turn order underneath a test
  that was about something else. A test whose SUBJECT is either rule passes it
  in `tuning`, which wins: the spread below puts the caller's values last.
*/
const STEADY = { refillNoClearable: false, rotateStart: false } as const;
const setup: typeof rawSetup = (opts) =>
  rawSetup({ ...opts, tuning: { ...STEADY, ...opts.tuning } });


const base = (tuning: Partial<GameState['tuning']> = {}) =>
  setup({ seed: 'noon', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1, tuning });

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
    // Through the card, because SUMMON the command is gone.
    const summon = newInstance(s, 'up-the-street');
    s.players[vessel].hand.push(summon);
    const r = apply(s, vessel, { t: 'PLAY_CARD', uid: summon.uid });
    expect(r.state.vesselDamage).toBe(0);
    expect(r.events.some((e) => e.t === 'VESSEL_DAMAGE_RESET')).toBe(true);
  });

  it('a non-Omen Threat entering does not reset damage', () => {
    const { s, vessel } = actII();
    s.vesselDamage = 5;
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    s.supply.mythos.unshift(newInstance(s, 'thing-in-well'));
    const summon = newInstance(s, 'up-the-street');
    s.players[vessel].hand.push(summon);
    const r = apply(s, vessel, { t: 'PLAY_CARD', uid: summon.uid });
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
  /**
   * Can this op put damage on the Vessel — declared OR offered?
   *
   * `target: 'vessel'` is the obvious half. The other half is `'choose'`, which
   * `choiceOptions` SILENTLY adds the Vessel to in Act II — so a Street-clearing
   * Sign written as choosable damage breaks rule 1 while reading as though it
   * does not. That is exactly what happened when the Colt was briefly 4 damage
   * instead of a destroy, and the declared target still said `choose`.
   *
   * Stated as "no Sign may have choosable damage at all" rather than with an
   * opt-out flag on the op. A flag needs a card to set it, and the moment the
   * Colt went back to `destroy` nothing did — an unused escape hatch that only
   * a future author would find, at the moment they were about to need it and
   * least likely to question it.
   */
  const hitsVessel = (o: Op) =>
    o.op === 'damage' && (o.target === 'vessel' || o.target === 'choose');

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
    // ...and the Street-facing Signs really do still answer the Street.
    // `destroy` is no longer how either of them does it: the Colt deals damage
    // so that escalation can degrade it, and Dynamite's only removal is an
    // Omen, which nothing else in the game can touch.
    for (const id of STREET_FACING) {
      const ops = opsFor(card(id), true);
      const answers = ops.some(
        (o) => o.op === 'destroy' || o.op === 'banishOmen'
          || (o.op === 'damage' && !hitsVessel(o)),
      );
      expect(answers, `${id} no longer answers the Street`).toBe(true);
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

  it('the Vessel does not wound itself with its own Fevered Signs', () => {
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

  it('the Fevered Colt lands without asking, and never on the Vessel', () => {
    const { s, posse } = actII();
    s.street[1] = threat(s, 'thing-in-well');
    const inst = newInstance(s, 'colt', true);
    s.players[posse].hand.push(inst);
    const r = apply(s, posse, { t: 'PLAY_CARD', uid: inst.uid });
    expect(r.state.pending, 'the Fevered face asked').toBeNull();
    expect(r.state.street[1], 'the Threat survived').toBeNull();
    // Rule 1: a Sign that answers the Street gets nothing off the Vessel.
    expect(r.state.vesselDamage).toBe(0);
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
  //  Signs. If they do, you begin the Vessel's turn with +3 Doom."
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
    expect(opsFor(colt, true)[0]).toMatchObject({ target: 'itChooses' });
    expect(opsFor(colt, true, true)[0]).toMatchObject({ target: 'choose' });

    const salt = card('salt-line');
    expect(opsFor(salt, true, true).slice(salt.ops.length))
      .toContainEqual({ op: 'whisper', n: 1 });
  });

  it('a clean card is unaffected by aiming', () => {
    const colt = card('colt');
    expect(opsFor(colt, false, true)).toEqual(colt.ops);
  });

  it('the Vessel chooses targets instead of hitting the leftmost slot', () => {
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
    expect(r.state.pending, 'the player was asked').toBeNull();
    // Exactly one Threat took it, and the player did not pick which. Asserted
    // on the event rather than on a slot index so it holds for all three
    // `coltFeveredTarget` modes — the point is that it lands somewhere without
    // being aimed, not where it lands.
    const hits = r.events.filter((e) => e.t === 'THREAT_CLEARED');
    expect(hits).toHaveLength(1);
  });

  it('a card resolved by CALL is not aimed', () => {
    const { s, vessel, posse } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    s.players[posse].deck.unshift(newInstance(s, 'colt', true));


    const read = newInstance(s, 'your-name');
    s.players[vessel].hand.push(read);
    const played = apply(s, vessel, { t: 'PLAY_CARD', uid: read.uid });
    const done = apply(played.state, vessel, {
      t: 'RESOLVE_CHOICE', choiceId: played.state.pending!.id, picks: [posse],
    });
    expect(done.events.filter((e) => e.t === 'THREAT_CLEARED')).toHaveLength(1);
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

  it('the Vessel floors at one card so the endgame cannot stall', () => {
    const { s } = actII();
    const vessel = s.vessel!;
    const p = s.players[vessel];
    p.deck = [];
    p.hand = [];
    p.discard = [newInstance(s, 'colt', true)];
    s.activePlayer = vessel;
    expect(roundTrip(s).state.players[vessel].status).toBe('vessel');
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

  /*
    The granted card, and the two things that must stay true of it.

    It is not in their deck — a Revenant's deck is their health and it shrinks
    to nothing, so a card in it would be both a card of life they never had and
    one their own burn-out takes away. So: given at the start of the turn,
    gone at the end of it, and never in the discard.
  */
  it('a Revenant is granted Come and See, and it never enters their deck', () => {
    const { s, victim } = fallen();
    // A deck deep enough that the opening draw does not burn them out.
    s.players[victim].deck = Array.from({ length: 6 }, () =>
      newInstance(s, 'six-gun', true));
    s.players[victim].hand = [];
    const before = s.turnOrder[2];
    s.activePlayer = before; s.actionsLeft = 1;

    const cur = apply(s, before, { t: 'END_TURN' }).state;
    expect(cur.activePlayer).toBe(victim);
    const hand = cur.players[victim].hand;
    expect(hand.filter((ci) => card(ci.cardId).type === 'revenant')).toHaveLength(1);
    // It rides on top of a full hand rather than eating a card out of it.
    expect(hand).toHaveLength(cur.tuning.handSize + 1);
    // And it is not something they can cash in or spend for a Whisper.
    const uid = hand.find((ci) => card(ci.cardId).type === 'revenant')!.uid;
    const offered = legalCommands(cur, victim);
    expect(offered.some((c) => c.t === 'REVENANT_WHISPER' && c.uid === uid)).toBe(false);
    expect(offered.some((c) => c.t === 'SPEND_GRIT' && c.uids.includes(uid))).toBe(false);
    expect(offered.some((c) => c.t === 'PLAY_CARD' && c.uid === uid)).toBe(true);

    // Swept, not discarded: it goes nowhere at all.
    const ended = apply(cur, victim, { t: 'END_TURN' }).state;
    const seen = [
      ...ended.players[victim].deck,
      ...ended.players[victim].discard,
      ...ended.players[victim].hand,
    ];
    expect(seen.some((ci) => card(ci.cardId).type === 'revenant')).toBe(false);
  });

  it('Come and See pays a living player for buying a Sign', () => {
    const { s, victim } = fallen();
    const target = s.turnOrder[0];
    s.activePlayer = victim; s.actionsLeft = 2;
    // Granted, not drawn — put it in hand the way `startTurn` would. The real
    // grant is driven through a turn in the test below.
    const beckon = newInstance(s, 'come-and-see', false);
    s.players[victim].hand.push(beckon);
    const played = apply(s, victim, { t: 'PLAY_CARD', uid: beckon.uid }).state;
    // A card that asks who, rather than a button per seat.
    expect(played.pending?.op).toBe('beckon');
    let cur = apply(played, victim, {
      t: 'RESOLVE_CHOICE', choiceId: played.pending!.id, picks: [target],
    }).state;
    expect(cur.beckoned).toBe(target);

    cur.activePlayer = target; cur.actionsLeft = 3;
    cur.players[target].gritThisTurn = 10;
    const r = apply(cur, target, { t: 'BUY', cardId: 'certainty' });
    expect(r.state.players[target].gritThisTurn).toBe(10 - 2 + r.state.tuning.beckonGrit);
    expect(r.state.beckoned).toBeNull();
  });
});

/*
  Menace is aimed one point at a time.

  The complaint that produced this: one player having their deck halved in a
  single Dusk while everybody else watched. The rule has not changed — Menace
  still goes to whoever holds most Signs — but it is now applied per point, so
  the moment a hit costs the leader their lead the next point looks again.
*/
describe('Menace is dealt a point at a time', () => {
  /**
   * A table where one seat leads on Signs by exactly one, and both have plenty
   * of cards to lose. One point of damage is enough to level them.
   */
  function nearTied(seed: string) {
    const s = start(setup({ seed, players: ['Ada', 'Bo', 'Cy'], markedIndex: null })).state;
    const [a, b] = s.turnOrder;
    for (const id of [a, b]) {
      s.players[id].hand = [];
      s.players[id].discard = [];
      s.players[id].deck = Array.from({ length: 14 }, () => newInstance(s, 'six-gun'));
    }
    // Signs live in the deck, so they are both the count and the health.
    for (let i = 0; i < 4; i++) s.players[a].deck.push(newInstance(s, 'colt'));
    for (let i = 0; i < 3; i++) s.players[b].deck.push(newInstance(s, 'colt'));
    // Damage eats non-Signs first, so nothing here would ever cost a Sign and
    // the aim could never move. Strip them down to the Signs alone.
    s.players[a].deck = s.players[a].deck.filter((ci) => card(ci.cardId).type === 'sign');
    s.players[b].deck = s.players[b].deck.filter((ci) => card(ci.cardId).type === 'sign');
    /*
      Escalated, so the wound is several points rather than one.

      `damagePerHit` is 0.5 and rounds up, so a freshly-arrived Threat costs a
      single card — and a one-point wound cannot split by definition. Four
      Dusks of escalation is the case this rule exists for anyway: the evening
      that used to take half a deck off one player.
    */
    const sl = threat(s, 'barons-men');
    sl.escalation = 5;
    s.street = [sl, null, null];
    s.activePlayer = s.turnOrder[s.turnOrder.length - 1]!;
    s.actionsLeft = 0;
    return { s, a, b };
  }

  it('moves the wound once the lead is gone', () => {
    /*
      Asserted across seeds, not on one.

      When the leader is levelled the tie breaks at RANDOM — deliberately, so
      that a first-match rule cannot send every point to the same seat all game
      — which means no single game can be expected to split. What must be true
      is that the wound CAN move, and under the old lump rule it never could:
      every point went where the first one did, in every seed.
    */
    let split = 0;
    for (let i = 0; i < 12; i++) {
      const { s, a } = nearTied(`menace-${i}`);
      const r = apply(s, s.activePlayer, { t: 'END_TURN' });
      const hit = new Set(
        r.events.filter((e) => e.t === 'MENACE').map((e) => (e as { player: string }).player),
      );
      expect(hit.has(a), 'the leader was not hit first').toBe(true);
      if (hit.size > 1) split++;
    }
    expect(split, 'no seed ever moved the wound off the leader').toBeGreaterThan(0);
  });

  it('deals the same total, however many people it lands on', () => {
    // Spreading damage must not quietly reduce it. The size is fixed by the
    // seat the Threat was looking at when it moved — `menacePerSign` is "the
    // wound deepens with the corruption that drew it".
    for (let i = 0; i < 12; i++) {
      const { s, a } = nearTied(`menace-total-${i}`);
      const sl = s.street[0]!;
      const expected = Math.ceil(
        effectiveMenace(sl, s.tuning.omenMenace) * s.tuning.damagePerHit,
      ) + Math.floor(signsHeld(s, a) * s.tuning.menacePerSign);

      const r = apply(s, s.activePlayer, { t: 'END_TURN' });
      const dealt = r.events
        .filter((e) => e.t === 'MENACE')
        .reduce((n, e) => n + (e as { amount: number }).amount, 0);
      expect(dealt).toBe(expected);
    }
  });

  it('says it once per person, not once per point', () => {
    // The chronicle and the Dusk report both count these. One event per point
    // would announce the same wound four times.
    const { s } = nearTied('menace-events');
    const r = apply(s, s.activePlayer, { t: 'END_TURN' });
    const hits = r.events.filter((e) => e.t === 'MENACE');
    const seats = new Set(hits.map((e) => (e as { player: string }).player));
    expect(hits).toHaveLength(seats.size);
    // And one wound per person, not one per card taken.
    for (const seat of seats) {
      const damaged = r.events.filter(
        (e) => e.t === 'DAMAGED' && (e as { player: string }).player === seat,
      );
      expect(damaged.length).toBeLessThanOrEqual(1);
    }
  });
});

/*
  `blindDamage` — the switch behind the "Damage vs. Signs" ruling.

  Off (the default) damage eats Provisions first and a wounded player is a MORE
  corrupt player. On, it takes whatever it finds, so corruption is shot off you
  in proportion to how much you are carrying. Measured both ways; see CLAUDE.md.
*/
/*
  Recovering a card is a CHOICE, not the oldest thing in the pile.

  It used to take the first non-Sign in the boneyard — insertion order, which is
  deterministic and reads as a dice roll from the far side of the table. Same
  ruling the `trash` op already carries: a rule you can see is a rule you can
  play around, one you cannot is just a card appearing.
*/
/*
  A card with nothing to point at is not offered.

  Same rule the engine already applies to a card with no ops — a Six-Gun at an
  empty Street spends an action to move a card from your hand to your discard —
  except this one asks about the BOARD rather than about the card.
*/
describe('cards with no target in the Street', () => {
  function withHand(cardId: string, street: (string | null)[] = []) {
    const s = start(setup({ seed: `tgt-${cardId}`, players: ['Ada', 'Bo', 'Cy'] })).state;
    const me = s.activePlayer;
    s.street = [null, null, null];
    street.forEach((id, i) => { if (id) s.street[i] = threat(s, id); });
    s.players[me].hand = [newInstance(s, cardId)];
    s.actionsLeft = 3;
    const uid = s.players[me].hand[0].uid;
    return {
      s, me, uid,
      offered: () => legalCommands(s, me).some((c) => c.t === 'PLAY_CARD' && c.uid === uid),
    };
  }

  it('withholds an attack when the Street is empty', () => {
    expect(withHand('six-gun').offered()).toBe(false);
  });

  it('offers it the moment there is something to shoot', () => {
    expect(withHand('six-gun', ['claim-jumpers']).offered()).toBe(true);
  });

  it('withholds a ward with nothing to ward off', () => {
    // Night Watch cancels one Threat's Menace. No Threat, no Menace.
    expect(withHand('night-watch').offered()).toBe(false);
  });

  it('withholds Dynamite with neither Threat nor Omen', () => {
    expect(withHand('dynamite').offered()).toBe(false);
    // A Street with anything in it gives the blast something to do.
    expect(withHand('dynamite', ['claim-jumpers']).offered()).toBe(true);
  });

  it('still offers an attack in Act II, because the Vessel is a target', () => {
    /*
      The endgame case, and the reason this asks about ops rather than about
      the Street alone: most of Act II ends with nothing to shoot but the thing
      you came for.
    */
    const { s, posse } = actII();
    s.street = [null, null, null];
    s.players[posse].hand = [newInstance(s, 'six-gun', true)];
    s.activePlayer = posse;
    s.actionsLeft = 3;
    const uid = s.players[posse].hand[0].uid;
    expect(legalCommands(s, posse).some((c) => c.t === 'PLAY_CARD' && c.uid === uid))
      .toBe(true);
  });

  it('asks the question without spending any randomness', () => {
    /*
      `resolveSlots` advances `s.rngCursor` for `target: 'random'`, and
      `legalCommands` runs on every render for every card for every seat. A
      question that consumed randomness would put the cursor somewhere a replay
      could not follow — invariant 1, and the one that cannot be bent.
    */
    const { s, me } = withHand('colt', ['claim-jumpers', 'rustlers']);
    const before = s.rngCursor;
    for (let i = 0; i < 5; i++) legalCommands(s, me);
    expect(s.rngCursor).toBe(before);
  });
});

/*
  Rotating the start of the round, and the two questions it raises: what happens
  once the Vessel is at the table, and what happens when most of the table is
  gone.

  The rotation is a poker button — `startSeat` moves one chair each Dawn and
  `turnOrder` never changes, so everybody keeps their neighbours. What moves is
  who acts first and who acts last.
*/
describe('rotateStart', () => {
  /**
   * Play whole rounds, recording who acted in each. COMPLETE rounds only.
   *
   * The driver just ends every turn, so nobody ever clears a Threat and the
   * table is eventually wiped out — which leaves a half-played round at the
   * end, and asserting on that measures where the run stopped rather than the
   * rule. A round is only returned once the next one has begun.
   */
  function rounds(s0: GameState, n: number): PlayerId[][] {
    let s = s0;
    const done: PlayerId[][] = [];
    let here: PlayerId[] = [];
    for (let i = 0; i < 400 && done.length < n && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      if (!s.pending && !here.includes(actor)) here.push(actor);
      const before = s.round;
      s = apply(s, actor, legal.find((c) => c.t === 'END_TURN') ?? legal[0]!).state;
      if (s.round !== before) { done.push(here); here = []; }
    }
    return done;
  }

  /**
   * A table, optionally with some chairs already empty.
   *
   * Emptied BEFORE the deal. Marking a seat gone afterwards leaves it as the
   * active player — the game has already begun on it — which looks like a gone
   * seat taking a turn and is an artefact of the fixture, not of the rule.
   */
  function table(gone: number[] = [], tuning: Record<string, unknown> = {}) {
    const opening = setup({
      seed: 'rotate', players: ['Ada', 'Bo', 'Cy', 'Di'], markedIndex: null,
      tuning: { rotateStart: true, ...tuning },
    });
    for (const i of gone) opening.players[opening.turnOrder[i]!]!.status = 'gone';
    return start(opening).state;
  }

  it('moves one chair a round and keeps everybody in the same order', () => {
    const seen = rounds(table(), 4);
    expect(seen.length, 'not enough complete rounds to judge').toBeGreaterThanOrEqual(3);
    const order = seen[0]!;
    expect(order).toHaveLength(4);
    for (let r = 1; r < seen.length; r++) {
      // A rotation of the first round, not a reshuffle: same cycle, new start.
      const want = [...order.slice(r), ...order.slice(0, r)];
      expect(seen[r], `round ${r + 1}`).toEqual(want);
    }
  });

  it('gives every living seat exactly one turn a round', () => {
    for (const seen of [rounds(table(), 4), rounds(table([], { rotateStart: false }), 4)]) {
      for (const round of seen) expect(new Set(round).size).toBe(round.length);
    }
  });

  /*
    The Vessel takes its place in the rotation like anybody else.

    Worth stating because the seat is special in every other way: it is the only
    one that cannot buy, cannot be Menaced and wins by a different condition.
    Its POSITION is not special, and rotating means the advantage of acting
    after the whole posse — summoning into a Street they can no longer answer —
    stops belonging to whichever seat happened to be named at the Turning.
  */
  it('includes the Vessel, and still ends the round exactly once', () => {
    const { s } = actII();
    s.tuning = { ...s.tuning, rotateStart: true };
    const seen = rounds(s, 3);
    for (const round of seen) {
      expect(round, 'the Vessel was skipped').toContain(s.vessel!);
      expect(new Set(round).size).toBe(round.length);
    }
  });

  /*
    Nobody takes two turns across a Dusk.

    Raised from the table: with the posse down to one player and the Vessel,
    rotating by one means the seat that acted last acts first again — three
    actions, the sun goes down, three more, and nothing in between. It is not
    only a two-player case either: at three seats it happens the moment one of
    them falls, so a rule counting living players would miss it.
  */
  function seatedTurnStream(s0: GameState, steps: number): PlayerId[] {
    let s = s0;
    const order: PlayerId[] = [];
    for (let i = 0; i < steps && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      if (!s.pending && order[order.length - 1] !== actor) order.push(actor);
      s = apply(s, actor, legal.find((c) => c.t === 'END_TURN') ?? legal[0]!).state;
    }
    return order;
  }

  it('never gives the same seat two turns in a row', () => {
    for (const gone of [[], [0], [0, 1], [0, 2]]) {
      const s = table(gone);
      const stream = seatedTurnStream(s, 300);
      expect(stream.length, `${4 - gone.length} seats`).toBeGreaterThan(4);
      for (let i = 1; i < stream.length; i++) {
        expect(stream[i], `${4 - gone.length} seats, turn ${i}`).not.toBe(stream[i - 1]);
      }
    }
  });

  it('stops rotating at two seats, rather than swapping who doubles', () => {
    // With two players there is no rotation that does not double somebody, so
    // the rule resolves to holding the order steady. That falls out of "the
    // round may not begin with whoever ended the last one" — it is not a
    // special case anybody has to remember.
    const s = table([0, 1]);
    const stream = seatedTurnStream(s, 200);
    const pair = [s.turnOrder[2]!, s.turnOrder[3]!];
    expect(stream.length).toBeGreaterThan(3);
    for (let i = 1; i < stream.length; i++) {
      expect(pair).toContain(stream[i]);
      expect(stream[i]).not.toBe(stream[i - 1]);
    }
  });

  it('rounds still turn over with most of the table gone', () => {
    /*
      `startSeat` walks over every chair, including empty ones. A round that
      begins on a seat nobody is in must still reach Dusk — `advance` ends the
      round when the turn comes back to whoever began it, and a gone seat hands
      straight on rather than ending anything.
    */
    const s = table([0, 2]);
    const living = s.turnOrder.filter((id) => s.players[id].status !== 'gone');
    const seen = rounds(s, 3);
    expect(seen.length, 'the rounds stopped turning over').toBeGreaterThanOrEqual(2);
    for (const round of seen) {
      expect(round.every((id) => living.includes(id)), 'a gone seat took a turn').toBe(true);
      expect(round.length, 'a living seat was skipped').toBe(living.length);
    }
  });
});

/*
  The Vessel burns a Sign for a Whisper.

  What the kept Signs were always reaching for and never delivered: a Sign-heavy
  Act I arming the Old One's Act II. Most Signs face the STREET — a Fevered Colt
  in that hand destroys a Threat FOR the posse — and the seat cannot cash a card
  in, so without an outlet they are dead paper on 37% of the deck.
*/
/*
  Omens name a price.

  Dynamite used to be the only answer in the game, and a table that had not
  bought one had no play at all against an Omen — 39.3% of games ended with one
  still standing. Each Omen now carries a Toll, in three different currencies,
  so which one is cheap depends on how you have been playing.
*/
/*
  A Bounty Provision is CHOSEN, not the leftmost card on the shelf.

  Same ruling as `recover` and `trash` before it: a rule you can see is a rule
  you can play around, one you cannot is just a card arriving.
*/
/*
  A prompt that offers cards names them, so the client can draw the face.

  The key cannot carry it: a scried Threat, a card in a boneyard and a Provision
  on the shelf are all keyed by UID, because a pile can hold two of the same
  card. Without `cardId` those three fell through to a column of buttons — the
  one surface in the game that does not show the card, and the worst place for
  it, since scrying is a card you paid a Sign to look at.
*/
describe('choice options name their card', () => {
  it('scry does, and the ids are real', () => {
    const s = start(base()).state;
    const me = s.activePlayer;
    pushOps(s, [{ op: 'scry', n: 3, target: 'self' }], me, 'test');
    const ev: GameEvent[] = [];
    runQueue(s, ev);
    const opts = s.pending!.options;
    expect(opts.length).toBeGreaterThan(1);
    for (const o of opts) {
      expect(o.cardId, o.label).toBeTruthy();
      expect(() => card(o.cardId!)).not.toThrow();
      expect(card(o.cardId!).name).toBe(o.label);
      // Keyed by uid, not by id — the point of carrying both.
      expect(o.key).not.toBe(o.cardId);
    }
  });

  it('so do the other two prompts that offer cards from a pile', () => {
    const s = start(base()).state;
    const me = s.activePlayer;
    s.players[me].boneyard = [newInstance(s, 'six-gun'), newInstance(s, 'winchester')];
    for (const ops of [
      [{ op: 'recover', target: 'self' }] as Op[],
      [{ op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' }] as Op[],
    ]) {
      const cur = structuredClone(s);
      pushOps(cur, ops, me, 'test');
      const ev: GameEvent[] = [];
      runQueue(cur, ev);
      expect(cur.pending, JSON.stringify(ops)).not.toBeNull();
      for (const o of cur.pending!.options) {
        expect(o.cardId, `${ops[0]!.op}: ${o.label}`).toBeTruthy();
        expect(card(o.cardId!).name).toBe(o.label);
      }
    }
  });

  it('a prompt for a PLAYER carries no card id', () => {
    // The flag is what the client switches on, so it has to be absent when the
    // options are people rather than cards.
    const s = start(base()).state;
    const me = s.activePlayer;
    pushOps(s, [{ op: 'beckon', target: 'choose' }], me, 'test');
    const ev: GameEvent[] = [];
    runQueue(s, ev);
    for (const o of s.pending!.options) expect(o.cardId).toBeUndefined();
  });
});

describe('taking a Provision for a Bounty', () => {
  const BOUNTY: Op[] = [{ op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' }];

  function shelf() {
    const s = start(base()).state;
    const me = s.activePlayer;
    s.supply.provisionRow = ['saddlebag', 'winchester', 'good-rope']
      .map((id) => newInstance(s, id));
    s.supply.provisions = [newInstance(s, 'six-gun')];
    s.players[me].discard = [];
    return { s, me };
  }

  it('offers the whole shelf', () => {
    const { s, me } = shelf();
    pushOps(s, BOUNTY, me, 'test');
    const ev: GameEvent[] = [];
    runQueue(s, ev);
    expect(s.pending?.op).toBe('gainCard');
    expect(s.pending!.options.map((o) => o.label).sort())
      .toEqual(['Good Rope', 'Saddlebag', 'Winchester']);
  });

  it('takes the one picked, not the leftmost', () => {
    const { s, me } = shelf();
    pushOps(s, BOUNTY, me, 'test');
    const ev: GameEvent[] = [];
    runQueue(s, ev);
    const want = s.pending!.options.find((o) => o.label === 'Winchester')!;
    resolveChoice(s, [want.key], ev);
    expect(s.players[me].discard.some((ci) => ci.cardId === 'winchester')).toBe(true);
    expect(s.supply.provisionRow.some((ci) => ci.uid === want.key)).toBe(false);
    // And the Saddlebag it would have taken before is still on the shelf.
    expect(s.supply.provisionRow.some((ci) => ci.cardId === 'saddlebag')).toBe(true);
  });

  it('refills the shelf behind it, the way a purchase does', () => {
    /*
      It did not, which meant a Bounty quietly shrank the row for the rest of
      the game. Four Act I Threats pay one, so a table that cleared well ended
      up shopping from a shorter shelf than a table that did not.
    */
    const { s, me } = shelf();
    const before = s.supply.provisionRow.length;
    pushOps(s, BOUNTY, me, 'test');
    const ev: GameEvent[] = [];
    runQueue(s, ev);
    resolveChoice(s, [s.pending!.options[0]!.key], ev);
    expect(s.supply.provisionRow).toHaveLength(before);
  });

  it('does not stop to ask when the shelf is bare', () => {
    const { s, me } = shelf();
    s.supply.provisionRow = [];
    pushOps(s, BOUNTY, me, 'test');
    const ev: GameEvent[] = [];
    runQueue(s, ev);
    expect(s.pending).toBeNull();
  });
});

describe('Omen Tolls', () => {
  const OMENS = ['dead-cattle', 'the-well', 'preacher'] as const;

  function withOmen(id: string) {
    const s = start(base()).state;
    const me = s.activePlayer;
    s.street = [threat(s, id), null, null];
    s.actionsLeft = 3;
    return { s, me };
  }

  it('every Omen has one, and they are not all the same price', () => {
    const prices = OMENS.map((id) => JSON.stringify(card(id).toll));
    for (const p of prices) expect(p).not.toBe(undefined);
    expect(new Set(prices).size, 'the three Omens ask for the same thing').toBe(3);
  });

  it('lifts the Omen when paid', () => {
    const { s, me } = withOmen('dead-cattle');
    s.players[me].gritThisTurn = 5;
    const r = apply(s, me, { t: 'PAY_TOLL', slot: 0 });
    expect(r.state.street[0]).toBeNull();
    expect(r.state.players[me].gritThisTurn).toBe(5 - 3);
  });

  it('is not offered to somebody who cannot pay', () => {
    /*
      The whole point of `canPay`: a button that throws is worse than no button.
      Grit is the case a new op had to be taught — a negative `grit` would have
      been a price the checker could not see.
    */
    const { s, me } = withOmen('dead-cattle');
    s.players[me].gritThisTurn = 2;
    expect(legalCommands(s, me).some((c) => c.t === 'PAY_TOLL')).toBe(false);
    s.players[me].gritThisTurn = 3;
    expect(legalCommands(s, me).some((c) => c.t === 'PAY_TOLL')).toBe(true);
  });

  it('asks a Puritan for something they have', () => {
    // The Sign toll is unpayable without a Sign, by design — but the other two
    // are not, so no way of playing locks you out of every Omen in the game.
    const { s, me } = withOmen('preacher');
    s.players[me].hand = [];
    s.players[me].gritThisTurn = 9;
    expect(legalCommands(s, me).some((c) => c.t === 'PAY_TOLL')).toBe(false);

    const scar = withOmen('the-well');
    scar.s.players[scar.me].hand = [];
    expect(legalCommands(scar.s, scar.me).some((c) => c.t === 'PAY_TOLL')).toBe(true);
  });

  it('charges the price, and the Scar is a real one', () => {
    const { s, me } = withOmen('the-well');
    const before = s.players[me].discard.length;
    const r = apply(s, me, { t: 'PAY_TOLL', slot: 0 });
    expect(r.state.street[0]).toBeNull();
    expect(r.state.players[me].discard.length).toBe(before + 1);
    expect(r.state.players[me].discard.some((ci) => ci.cardId === 'scar')).toBe(true);
  });
});

describe('BURN_SIGN', () => {
  function vesselHolding(cardIds: string[]) {
    const { s, vessel } = actII();
    s.players[vessel].hand = cardIds.map((id) => newInstance(s, id, true));
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    return { s, vessel };
  }

  it('turns a Sign into a Whisper and takes the card out of the game', () => {
    const { s, vessel } = vesselHolding(['colt']);
    const uid = s.players[vessel].hand[0]!.uid;
    const before = s.whispers;
    const r = apply(s, vessel, { t: 'BURN_SIGN', uid });
    // Through `addWhispers`, so the Act II rate multiplies it like every other
    // gain — one Sign is worth more after the Turning than it would have been
    // before, which is the right direction for the thing it represents.
    expect(r.state.whispers).toBe(
      before + r.state.tuning.vesselSignWhispers * r.state.tuning.whisperRateMythos,
    );
    expect(r.state.players[vessel].hand).toHaveLength(0);
    // Burned, not discarded. The Vessel's deck is rebuilt from what is left, so
    // a discard would deal the same brick back round again.
    expect(r.state.players[vessel].boneyard.some((ci) => ci.cardId === 'colt')).toBe(true);
    expect(r.state.players[vessel].discard.some((ci) => ci.cardId === 'colt')).toBe(false);
  });

  it('is offered for Signs and never for the Old One\'s own cards', () => {
    const { s, vessel } = vesselHolding(['colt', 'your-name']);
    const sign = s.players[vessel].hand[0]!;
    const mine = s.players[vessel].hand[1]!;
    const legal = legalCommands(s, vessel);
    expect(legal.some((c) => c.t === 'BURN_SIGN' && c.uid === sign.uid)).toBe(true);
    expect(legal.some((c) => c.t === 'BURN_SIGN' && c.uid === mine.uid)).toBe(false);
    // Whispers the seat prints for itself would not be Whispers the table
    // handed over, so `apply` refuses it too.
    expect(() => apply(s, vessel, { t: 'BURN_SIGN', uid: mine.uid })).toThrow();
  });

  it('belongs to the Vessel alone', () => {
    const { s, posse } = actII();
    s.players[posse].hand = [newInstance(s, 'colt', true)];
    s.activePlayer = posse;
    s.actionsLeft = 3;
    const uid = s.players[posse].hand[0]!.uid;
    expect(legalCommands(s, posse).some((c) => c.t === 'BURN_SIGN')).toBe(false);
    expect(() => apply(s, posse, { t: 'BURN_SIGN', uid })).toThrow();
  });

  it('costs an action, like every other thing that seat does', () => {
    const { s, vessel } = vesselHolding(['colt']);
    s.actionsLeft = 1;
    const uid = s.players[vessel].hand[0]!.uid;
    const r = apply(s, vessel, { t: 'BURN_SIGN', uid });
    expect(r.state.actionsLeft).toBe(0);
  });

  it('fills the bar, and the fill pays Doom like any other', () => {
    // Whispers only ever go up, and in Act II a full bar is Doom. Burning is
    // not a side channel around that.
    const { s, vessel } = vesselHolding(['colt']);
    s.whispers = s.tuning.whisperThreshold - 1;
    const doom = s.doom;
    const r = apply(s, vessel, { t: 'BURN_SIGN', uid: s.players[vessel].hand[0]!.uid });
    expect(r.state.doom).toBeGreaterThan(doom);
    expect(r.state.whispers).toBeLessThan(r.state.tuning.whisperThreshold);
  });
});

describe('recover', () => {
  function withBoneyard(seed: string) {
    const s = start(setup({ seed, players: ['Ada', 'Bo', 'Cy'], markedIndex: null })).state;
    const me = s.activePlayer;
    // Oldest first, so "the first non-Sign" and "the best card" differ.
    s.players[me].boneyard = [
      newInstance(s, 'saddlebag'),
      newInstance(s, 'winchester'),
      newInstance(s, 'colt'),          // a Sign: never recoverable
    ];
    s.players[me].hand = [newInstance(s, 'docs-bag')];
    s.actionsLeft = 3;
    return { s, me };
  }

  it('asks which card, rather than taking the oldest', () => {
    const { s, me } = withBoneyard('rec-1');
    const r = apply(s, me, { t: 'PLAY_CARD', uid: s.players[me].hand[0].uid });
    expect(r.state.pending?.op).toBe('recover');
    // Both non-Signs offered, the Sign not.
    const names = r.state.pending!.options.map((o) => o.label).sort();
    expect(names).toEqual(['Saddlebag', 'Winchester']);
  });

  it('takes the one that was chosen', () => {
    const { s, me } = withBoneyard('rec-2');
    const played = apply(s, me, { t: 'PLAY_CARD', uid: s.players[me].hand[0].uid }).state;
    const want = played.pending!.options.find((o) => o.label === 'Winchester')!;
    const r = apply(played, me, {
      t: 'RESOLVE_CHOICE', choiceId: played.pending!.id, picks: [want.key],
    });
    expect(r.state.players[me].discard.some((ci) => ci.cardId === 'winchester')).toBe(true);
    // And it left the pile, rather than being copied out of it.
    expect(r.state.players[me].boneyard.some((ci) => ci.uid === want.key)).toBe(false);
  });

  it('never hands a Sign back', () => {
    // Signs only reach a boneyard once damage has eaten everything else, or a
    // player has fallen. Recovering one would make this a way of topping up
    // corruption rather than of patching a deck.
    const { s, me } = withBoneyard('rec-3');
    const sign = s.players[me].boneyard.find((ci) => ci.cardId === 'colt')!;
    const played = apply(s, me, { t: 'PLAY_CARD', uid: s.players[me].hand[0].uid }).state;
    expect(played.pending!.options.some((o) => o.key === sign.uid)).toBe(false);
    /*
      And asking for it anyway is refused at the gate.

      `isLegal` is the authority on what was ever offered — `apply` checks a
      command's own preconditions, and this is not one of those: it is a pick
      that was never on the list. The op ignores it as a second line of
      defence, which is why the state below is unchanged rather than corrupt.
    */
    const ask = {
      t: 'RESOLVE_CHOICE' as const, choiceId: played.pending!.id, picks: [sign.uid],
    };
    expect(isLegal(played, me, ask)).toBe(false);
    const forced = apply(played, me, ask).state;
    expect(forced.players[me].discard.some((ci) => ci.cardId === 'colt')).toBe(false);
  });

  it('does not stop to ask when there is nothing to take', () => {
    const { s, me } = withBoneyard('rec-4');
    s.players[me].boneyard = [];
    const r = apply(s, me, { t: 'PLAY_CARD', uid: s.players[me].hand[0].uid });
    expect(r.state.pending).toBeNull();
  });
});

describe('blind damage', () => {
  /** A deck of Provisions and Signs in equal measure, plus a Last Words. */
  function mixedDeck(seed: string, blind: boolean) {
    const s = start(setup({
      seed, players: ['Ada', 'Bo', 'Cy'], markedIndex: null,
      tuning: { blindDamage: blind },
    })).state;
    const me = s.activePlayer;
    s.players[me].hand = [];
    s.players[me].discard = [];
    s.players[me].deck = [
      ...Array.from({ length: 6 }, () => newInstance(s, 'six-gun')),
      ...Array.from({ length: 6 }, () => newInstance(s, 'colt')),
      newInstance(s, 'last-words'),
    ];
    return { s, me };
  }

  it('ordered damage leaves every Sign standing while a Provision remains', () => {
    const { s, me } = mixedDeck('ordered', false);
    const ev: GameEvent[] = [];
    damagePlayer(s, me, 6, ev);
    // Counted as Colts, not as Signs: Last Words is itself a Sign, and it has
    // its own rule below.
    const colts = s.players[me].deck.filter((ci) => ci.cardId === 'colt');
    expect(colts).toHaveLength(6);
  });

  it('blind damage reaches Signs with Provisions still in the deck', () => {
    // Over seeds: one roll could take six Provisions by luck. The claim is that
    // it CAN reach a Sign early, which the ordered rule never does.
    let touched = 0;
    for (let i = 0; i < 12; i++) {
      const { s, me } = mixedDeck(`blind-${i}`, true);
      const ev: GameEvent[] = [];
      damagePlayer(s, me, 4, ev);
      const colts = s.players[me].deck.filter((ci) => ci.cardId === 'colt');
      const kit = s.players[me].deck.filter((ci) => card(ci.cardId).type !== 'sign');
      if (colts.length < 6 && kit.length > 1) touched++;
    }
    expect(touched, 'blind damage never took a Sign early').toBeGreaterThan(0);
  });

  it('spares Last Words either way, while anything else is left', () => {
    for (const blind of [false, true]) {
      const { s, me } = mixedDeck(`lw-${blind}`, blind);
      const ev: GameEvent[] = [];
      damagePlayer(s, me, 11, ev);
      expect(
        s.players[me].deck.some((ci) => ci.cardId === 'last-words'),
        `Last Words taken with blindDamage: ${blind}`,
      ).toBe(true);
    }
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
   * is tested first, so the Old One's side could take a game the posse had already won.
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

  it('gives the Vessel exactly the command set every other player has', () => {
    /*
      The dominant-action problem, closed structurally rather than by tuning.

      CALL, SUMMON, SHUTTER, OFFER and WHISPER were five buttons on a bespoke
      menu, and the safe one got pressed every turn because a permanent button
      always can be. They are cards now, so the seat reaches them through
      PLAY_CARD and cannot spam the safe one — it has to be drawn.

      Asserted as SAMENESS rather than as a list of what is gone: a future
      Vessel-only command would pass a "these five do not exist" test and still
      rebuild the second interface this removed.
    */
    const { s, vessel } = actII();
    s.activePlayer = vessel;
    s.actionsLeft = 3;
    // The helper sets `activePlayer` directly, so `startTurn` never ran and no
    // hand was dealt. In play the Vessel draws like everyone else; here that
    // has to be done by hand or the seat looks empty for the wrong reason.
    drawCards(s, vessel, s.tuning.handSize, []);
    const EVERYONE = new Set([
      'PLAY_CARD', 'SPEND_GRIT', 'BUY', 'PAY_TOLL', 'RESOLVE_CHOICE', 'END_TURN',
    ]);
    const kinds = new Set(legalCommands(s, vessel).map((c) => c.t));
    expect([...kinds].filter((k) => !EVERYONE.has(k)), 'a Vessel-only command')
      .toEqual([]);
    // And the seat is not a spectator: it has its own deck to play from.
    expect(kinds.has('PLAY_CARD')).toBe(true);
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



describe('prependOps does not disturb the rest of the schema', () => {
  const template = (fevered: Card['fevered']): Card => ({
    id: 'x', name: 'x', type: 'sign', grit: 0,
    ops: [
      { op: 'damage', n: 1, target: 'choose' },
      { op: 'draw', n: 1, target: 'self' },
    ],
    fevered,
  });

  it('retarget indices still count the PRINTED ops, not the final array', () => {
    // The trap: `retarget: { 0: ... }` reads as "the first op", and prepending
    // makes those two different things. Resolved before the splice, so they
    // stay the same thing.
    const ops = opsFor(template({
      name: 'x',
      prependOps: [{ op: 'discardHand', target: 'self' }],
      retarget: { 0: 'leftmostSlot' },
    }), true);
    expect(ops.map((o) => o.op)).toEqual(['discardHand', 'damage', 'draw']);
    // The damage moved, and the prepended discard was not retargeted by proxy.
    expect((ops[1] as { target: string }).target).toBe('leftmostSlot');
    expect((ops[0] as { target: string }).target).toBe('self');
  });

  it('an aimed card keeps the prepended cost and loses the retarget', () => {
    // The Vessel and the Revenants aim their Fevered cards. They lose the
    // corruption's TARGETING, never its price.
    const ops = opsFor(template({
      name: 'x',
      prependOps: [{ op: 'discardHand', target: 'self' }],
      retarget: { 0: 'leftmostSlot' },
    }), true, true);
    expect(ops.map((o) => o.op)).toEqual(['discardHand', 'damage', 'draw']);
    expect((ops[1] as { target: string }).target).toBe('choose');
  });

  it('leaves the clean face completely alone', () => {
    const c = template({
      name: 'x', prependOps: [{ op: 'discardHand', target: 'self' }],
    });
    expect(opsFor(c, false).map((o) => o.op)).toEqual(['damage', 'draw']);
  });
});

describe('Menace does not bite the hand that summons it', () => {
  it('never aims at the Vessel, however many Signs it holds', () => {
    /*
      A Threat is the Old One's own force. Menace aims at whoever holds most
      Signs, and the Vessel keeps every Sign it bought — so the targeting rule
      pointed it at itself by default: 25.6% of Act II Menace and 26% of all
      Act II card loss, measured, before this.

      Stacked here rather than left to chance: the Vessel is given far more
      Signs than anybody else, so `mostSigns` would pick it if it could.
    */
    const { s, vessel } = actII();
    for (let i = 0; i < 8; i++) {
      s.players[vessel].deck.push(newInstance(s, 'colt', true));
    }
    s.street[0] = threat(s, 'barons-men');
    s.activePlayer = s.turnOrder[s.turnOrder.length - 1]!;
    s.actionsLeft = 0;

    const r = apply(s, s.activePlayer, { t: 'END_TURN' });
    const hits = r.events.filter((e) => e.t === 'MENACE');
    expect(hits.length, 'no Menace resolved').toBeGreaterThan(0);
    for (const h of hits) {
      expect((h as { player: string }).player, 'Menace hit the Vessel').not.toBe(vessel);
    }
    // And it did land on somebody. Read off the PRE-state, because a hard
    // enough hit turns a posse player into a Revenant on the way through.
    for (const h of hits) {
      expect(s.players[(h as { player: string }).player].status).toBe('posse');
    }
  });

  it('resolves to nothing rather than throwing when only the Vessel is left', () => {
    // `pickExtreme` on an empty list used to be the failure mode here.
    const { s, vessel } = actII();
    for (const id of s.turnOrder) {
      if (id !== vessel) s.players[id].status = 'gone';
    }
    s.street[0] = threat(s, 'barons-men');
    s.activePlayer = vessel;
    s.actionsLeft = 0;
    expect(() => apply(s, vessel, { t: 'END_TURN' })).not.toThrow();
  });
});
