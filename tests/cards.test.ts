// The Colt and Dynamite, and one invariant that governs all twelve Signs.
//
// These two used to read the same — "destroy a Threat" on both clean faces —
// which wasted a slot in a set of twelve. The Colt is depth now (4 damage into
// one Threat) and Dynamite is breadth (2 into all of them, or an Omen).
//
// The structural half matters more than the flavour: `destroy` is IMMUNE to
// escalation. Unresolved Threats gain +1 Clear every Dusk, and an auto-answer
// that never gets worse as the game gets harder sits outside the pace engine
// entirely. Damage degrades exactly as intended.

import { describe, it, expect } from 'vitest';
import { setup, start, apply, legalCommands } from '../engine';
import {
  newInstance, opsFor, resolveSlots, DECLINE_KEY, effectiveClear,
} from '../engine/effects';
import { card, SIGN_IDS } from '../content/cards';
import type { GameState, PlayerId, Op, Tuning } from '../engine/state';

const base = (tuning: Partial<Tuning> = {}) =>
  setup({ seed: 'cards', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1, tuning });

function actII(tuning: Partial<Tuning> = {}) {
  const s0 = start(base(tuning)).state;
  s0.whispers = s0.tuning.whisperThreshold;
  const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
  const posse = s.turnOrder.find((id) => s.players[id].status === 'posse')!;
  s.street = new Array(s.tuning.streetSlots).fill(null);
  s.activePlayer = posse;
  s.actionsLeft = 3;
  return { s, posse, vessel: s.vessel! };
}

const threat = (s: GameState, cardId: string, escalation = 0) => ({
  instance: newInstance(s, cardId), damage: 0, turned: false,
  enteredRound: s.round, escalation,
});

/** Answer the pending choice, taking its id off the state rather than guessing. */
const resolve = (s: GameState, pid: PlayerId, pick: string) =>
  apply(s, pid, { t: 'RESOLVE_CHOICE', choiceId: s.pending!.id, picks: [pick] });

const play = (s: GameState, pid: PlayerId, cardId: string, fevered = false) => {
  const inst = newInstance(s, cardId, fevered);
  s.players[pid].hand.push(inst);
  return apply(s, pid, { t: 'PLAY_CARD', uid: inst.uid });
};

// ------------------------------------------------------------------ the Colt

describe('the Colt is precision, on both faces', () => {
  it('is a pure retarget: same op, same magnitude, only the target differs', () => {
    // The whole design of this card. If it ever needs more than a retarget,
    // something has gone wrong.
    const colt = card('colt');
    const clean = opsFor(colt, false);
    const fevered = opsFor(colt, true);

    expect(fevered).toHaveLength(clean.length);
    expect(colt.fevered!.appendOps).toBeUndefined();
    expect(colt.fevered!.prependOps).toBeUndefined();
    expect(colt.fevered!.constraints).toBeUndefined();

    for (let i = 0; i < clean.length; i++) {
      const { target: cleanTarget, ...cleanRest } = clean[i]! as Record<string, unknown>;
      const { target: fevTarget, ...fevRest } = fevered[i]! as Record<string, unknown>;
      expect(fevRest, 'something other than the target changed').toEqual(cleanRest);
      expect(fevTarget).not.toBe(cleanTarget);
    }
  });

  it('destroys, and therefore may never be aimed at the Vessel', () => {
    // The Colt was briefly 4 damage, on the argument that `destroy` sits
    // outside the pace engine — escalation adds +1 Clear a Dusk and an
    // auto-answer never gets worse. True, and reverted anyway: it cost the
    // posse 20pp of win rate. What the episode left behind is the rule below,
    // because choosable damage silently acquires the Vessel as a target.
    const ops = opsFor(card('colt'), false);
    expect(ops[0]).toMatchObject({ op: 'destroy' });
    expect(ops.some((o) => o.op === 'damage')).toBe(false);
  });

  it.each(['leftmostSlot', 'random', 'lowestClear'] as const)(
    'offers no choice under %s', (mode) => {
      const { s, posse } = actII({ coltFeveredTarget: mode });
      s.street[0] = threat(s, 'thing-in-well');
      s.street[1] = threat(s, 'own-face');
      s.street[2] = threat(s, 'barons-men');
      const r = play(s, posse, 'colt', true);
      expect(r.state.pending, `${mode} asked the player`).toBeNull();
      const hits = r.events.filter((e) => e.t === 'THREAT_CLEARED');
      expect(hits, `${mode} did not land`).toHaveLength(1);
    },
  );

  it('the clean face DOES ask, so the difference really is the choosing', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    const r = play(s, posse, 'colt', false);
    expect(r.state.pending).not.toBeNull();
  });
});

describe('random targeting is opaque, not undetermined', () => {
  function shoot(seed: string) {
    const s0 = start(setup({
      seed, players: ['Ada', 'Bo', 'Cy'], markedIndex: 1,
      tuning: { coltFeveredTarget: 'random' },
    })).state;
    s0.whispers = s0.tuning.whisperThreshold;
    const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
    const posse = s.turnOrder.find((id) => s.players[id].status === 'posse')!;
    s.street = new Array(s.tuning.streetSlots).fill(null);
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    s.street[2] = threat(s, 'barons-men');
    s.activePlayer = posse;
    s.actionsLeft = 3;
    const r = play(s, posse, 'colt', true);
    return (r.events.find((e) => e.t === 'THREAT_CLEARED') as { slot: number }).slot;
  }

  it('picks the same slot on a replay of the same seed', () => {
    expect(shoot('replay-me')).toBe(shoot('replay-me'));
  });

  it('picks differently across seeds, so it is actually random', () => {
    const picks = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(shoot));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('draws from the state cursor rather than Math.random', () => {
    // Belt and braces over the determinism lint, which cannot see a closure.
    // If the draw came from anywhere but `s.rngCursor`, stubbing Math.random
    // to a constant would pin the choice — and re-running with the cursor
    // advanced would not change it.
    const s0 = start(setup({
      seed: 'cursor', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1,
      tuning: { coltFeveredTarget: 'random' },
    })).state;
    s0.act = 'mythos';
    s0.street = new Array(s0.tuning.streetSlots).fill(null);
    s0.street[0] = threat(s0, 'thing-in-well');
    s0.street[1] = threat(s0, 'own-face');
    s0.street[2] = threat(s0, 'barons-men');

    const at = (cursor: number) => {
      const s = structuredClone(s0);
      s.rngCursor = cursor;
      return resolveSlots(s, 'random')[0];
    };
    // The same cursor is the same answer; a different cursor is free to differ.
    expect(at(7)).toBe(at(7));
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(at)).size).toBeGreaterThan(1);
  });

  it('advances the cursor, so two shots in a turn are independent draws', () => {
    const s = start(base({ coltFeveredTarget: 'random' })).state;
    s.act = 'mythos';
    s.street = new Array(s.tuning.streetSlots).fill(null);
    s.street[0] = threat(s, 'thing-in-well');
    s.street[1] = threat(s, 'own-face');
    const before = s.rngCursor;
    resolveSlots(s, 'random');
    expect(s.rngCursor).toBe(before + 1);
  });
});

describe('lowestClear reads the slot, not the card', () => {
  it('picks the lowest EFFECTIVE Clear, escalation included', () => {
    const s = start(base({ coltFeveredTarget: 'lowestClear' })).state;
    s.act = 'mythos';
    s.street = new Array(s.tuning.streetSlots).fill(null);
    // `rustlers` is the cheaper card, but it has been standing for four Dusks.
    // Read off the printed value it is still the easy one; read off the slot it
    // is not, and reading the card is the bug this guards.
    s.street[0] = threat(s, 'rustlers', 4);
    s.street[1] = threat(s, 'barons-men', 0);
    expect(card('rustlers').clear!).toBeLessThan(card('barons-men').clear!);
    expect(effectiveClear(s.street[0]!)!).toBeGreaterThan(effectiveClear(s.street[1]!)!);

    expect(resolveSlots(s, 'lowestClear')).toEqual([1]);
  });

  it('is what "itChooses" means when TUNING says so', () => {
    const s = start(base({ coltFeveredTarget: 'lowestClear' })).state;
    s.act = 'mythos';
    s.street = new Array(s.tuning.streetSlots).fill(null);
    s.street[0] = threat(s, 'barons-men');
    s.street[1] = threat(s, 'rustlers');
    expect(resolveSlots(s, 'itChooses')).toEqual(resolveSlots(s, 'lowestClear'));
  });
});

// -------------------------------------------------------------- the Dynamite

describe('Dynamite is breadth', () => {
  it('damages every occupied non-Omen slot', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'barons-men');
    s.street[1] = threat(s, 'dead-cattle');   // an Omen: never damaged
    s.street[2] = threat(s, 'own-face');
    const r = play(s, posse, 'dynamite');
    // No Omen in play would auto-resolve; there IS one, so the modal asks.
    const pick = resolve(r.state, posse, DECLINE_KEY);
    const hit = pick.events.filter((e) => e.t === 'THREAT_DAMAGED')
      .map((e) => (e as { slot: number }).slot);
    expect(hit.sort()).toEqual([0, 2]);
    expect(pick.state.street[1]).not.toBeNull();
  });

  it('offers the Omen branch only when an Omen is in the Street', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'barons-men');
    // No Omen: one option, so `runQueue` resolves it without asking at all.
    const noOmen = play(s, posse, 'dynamite');
    expect(noOmen.state.pending).toBeNull();
    expect(noOmen.state.street[0]!.damage).toBe(2);

    const { s: s2, posse: p2 } = actII();
    s2.street[0] = threat(s2, 'barons-men');
    s2.street[1] = threat(s2, 'dead-cattle');
    const withOmen = play(s2, p2, 'dynamite');
    expect(withOmen.state.pending).not.toBeNull();
    expect(withOmen.state.pending!.options.map((o) => o.key))
      .toEqual(['1', DECLINE_KEY]);
  });

  it('destroying an Omen costs exactly one Scar, and skips the blast', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'barons-men');
    s.street[1] = threat(s, 'dead-cattle');
    const scars = Object.fromEntries(
      s.turnOrder.map((p) => [p, s.players[p].scars]),
    );

    const r = play(s, posse, 'dynamite');
    const done = resolve(r.state, posse, '1');

    expect(done.state.street[1], 'the Omen survived').toBeNull();
    expect(done.state.players[posse].scars).toBe(scars[posse]! + 1);
    for (const p of done.state.turnOrder) {
      if (p === posse) continue;
      expect(done.state.players[p].scars, `${p} paid for someone else`).toBe(scars[p]!);
    }
    // "Instead": the blast did not happen.
    expect(done.state.street[0]!.damage).toBe(0);
  });

  it('the Fevered face scars every player instead of just you', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'dead-cattle');
    const before = Object.fromEntries(
      s.turnOrder.map((p) => [p, s.players[p].scars]),
    );
    const r = play(s, posse, 'dynamite', true);
    const done = resolve(r.state, posse, '0');
    for (const p of done.state.turnOrder) {
      expect(done.state.players[p].scars, p).toBe(before[p]! + 1);
    }
  });

  it('the Fevered face damages every living player as well as the Street', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'barons-men');
    const decks = Object.fromEntries(
      s.turnOrder.map((p) => [p, s.players[p].deck.length + s.players[p].discard.length]),
    );
    const r = play(s, posse, 'dynamite', true);
    expect(r.state.street[0]!.damage).toBe(2);
    for (const p of r.state.turnOrder) {
      if (r.state.players[p].status === 'gone') continue;
      const now = r.state.players[p].deck.length + r.state.players[p].discard.length;
      expect(now, `${p} took nothing`).toBeLessThan(decks[p]!);
    }
  });

  it('is the only thing in the game that can remove an Omen', () => {
    // Not a property of Dynamite so much as of everything else: if a second
    // answer appears, the card stops being the reason to take on corruption.
    const answers = SIGN_IDS.concat(['winchester', 'scattergun', 'six-gun'])
      .filter((id) => opsFor(card(id), false).concat(opsFor(card(id), true))
        .some((o) => o.op === 'banishOmen'));
    expect(answers).toEqual(['dynamite']);
  });
});

// ------------------------------------------------------- the design invariant

describe('a Fevered face is never an upgrade', () => {
  /**
   * The rule the whole temptation system rests on.
   *
   * Signs cost you AGENCY, not power. If a corrupted face is strictly better,
   * players start wanting their Signs to turn and the engine inverts — the
   * Turning becomes a reward and nobody has to resist anything.
   *
   * "Strictly better" is checked structurally rather than by simulation: same
   * or fewer ops of the same magnitudes, no target that is freer than the one
   * it replaced, and no added benefit without an added cost.
   */
  const FREEDOM: Record<string, number> = {
    // How much say the player has. Higher is better for them.
    choose: 3,
    self: 2, vessel: 2, all: 2, left: 2, mostSigns: 2, fewestCards: 2,
    itChooses: 1, random: 1, lowestClear: 1, leftmostSlot: 1, firstTriggered: 1,
    omen: 1,
  };

  /** Ops that only ever hurt the person playing the card. */
  const COSTS = new Set(['trash', 'scar', 'whisper', 'discardHand', 'revealHand']);

  /**
   * Is this added op a cost?
   *
   * `gainCard` of a SIGN counts as one, and that is a design claim rather than
   * a technicality: being handed a Sign you did not choose to buy is precisely
   * what the Vessel's OFFER does as an ATTACK. It arrives Fevered, it carries
   * Whispers when played, damage cannot trash it, and after the Turning those
   * Whispers feed the Doom cycle. The Widow is the only card that leans on
   * this reading, and it is the one place in the set where "not an upgrade" is
   * a judgement rather than arithmetic.
   */
  const isCost = (o: Op): boolean =>
    COSTS.has(o.op)
    || (o.op === 'gainCard' && o.filter.type === 'sign')
    // Vessel-facing damage is the one added BENEFIT the design allows, and it
    // is paid for — enforced by "every Vessel-facing face pays for it".
    || (o.op === 'damage' && o.target === 'vessel');

  it.each(SIGN_IDS)('%s does not improve when it turns', (id) => {
    const def = card(id);
    const clean = opsFor(def, false);
    const fevered = opsFor(def, true);
    // Prepended ops shift every printed op right, so the two faces have to be
    // lined up on the PRINTED ops before they can be compared index by index.
    const lead = def.fevered?.prependOps?.length ?? 0;
    const printed = fevered.slice(lead, lead + clean.length);

    // 1. Magnitude never grows. Same effect, differently aimed.
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]! as { op: string; n?: number };
      const b = printed[i]! as { op: string; n?: number };
      expect(b.op, `${id} op ${i} changed kind`).toBe(a.op);
      if (typeof a.n === 'number' && typeof b.n === 'number') {
        expect(b.n, `${id} op ${i} got bigger`).toBeLessThanOrEqual(a.n);
      }
    }

    // 2. Targeting never gets freer.
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]! as { target?: string };
      const b = printed[i]! as { target?: string };
      if (!a.target || !b.target) continue;
      expect(FREEDOM[b.target] ?? 0, `${id} op ${i} became easier to aim`)
        .toBeLessThanOrEqual(FREEDOM[a.target] ?? 0);
    }

    // 3. Anything ADDED is a cost, never a benefit.
    for (const extra of [...fevered.slice(0, lead), ...fevered.slice(lead + clean.length)]) {
      expect(isCost(extra), `${id} gained "${extra.op}" for free when it turned`)
        .toBe(true);
    }

    // 4. And it never becomes a smaller card either — that would be a nerf
    //    rather than a corruption, and the promise is "no power is lost".
    expect(fevered.length, `${id} lost an op when it turned`)
      .toBeGreaterThanOrEqual(clean.length);
  });
});

describe('no face both destroys and damages', () => {
  it('holds for every card in the set', () => {
    // Dynamite is the interesting case: it declares both a removal
    // (`banishOmen`) and a blast, but they are mutually exclusive at runtime —
    // taking the Omen clears the queue. So the rule is enforced on what can
    // actually HAPPEN, not on what is declared.
    for (const id of SIGN_IDS) {
      for (const fevered of [false, true]) {
        const ops = opsFor(card(id), fevered);
        const destroys = ops.some((o) => o.op === 'destroy');
        const damages = ops.some((o) => o.op === 'damage');
        expect(destroys && damages, `${id} fevered=${fevered}`).toBe(false);
      }
    }
  });

  it('Dynamite never blasts and banishes in the same resolution', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'barons-men');
    s.street[1] = threat(s, 'dead-cattle');
    const r = play(s, posse, 'dynamite');

    const banished = resolve(r.state, posse, '1');
    expect(banished.events.some((e) => e.t === 'THREAT_DAMAGED')).toBe(false);

    const blasted = resolve(r.state, posse, DECLINE_KEY);
    expect(blasted.state.street[1], 'the Omen went anyway').not.toBeNull();
  });
});

describe('the modal is legal before it is offered', () => {
  it('never leaves the player with a pending choice they cannot answer', () => {
    const { s, posse } = actII();
    s.street[0] = threat(s, 'dead-cattle');
    const r = play(s, posse, 'dynamite');
    expect(r.state.pending).not.toBeNull();
    const legal = legalCommands(r.state, posse);
    expect(legal.some((c) => c.t === 'RESOLVE_CHOICE')).toBe(true);
    for (const opt of r.state.pending!.options) {
      expect(() => resolve(r.state, posse, opt.key)).not.toThrow();
    }
  });
});

describe('the turn machinery always terminates', () => {
  it('ends the game rather than recursing when every seat is gone', () => {
    /*
      `startTurn` skips a gone seat by calling `advance`, and `advance` walks
      into Dusk, which rolls the round and starts again — so an empty table was
      unbounded mutual recursion, and it died on the stack.

      Found by driving the simulator with the real bot policy instead of random
      legal moves. Random play never emptied the table, so four hundred games
      of it had said nothing was wrong.
    */
    const s = start(base()).state;
    for (const id of s.turnOrder) s.players[id].status = 'gone';
    s.actionsLeft = 0;

    const r = apply(s, s.activePlayer, { t: 'END_TURN' });
    expect(r.state.winner).toBe('oldOne');
    expect(r.events.some((e) => e.t === 'GAME_OVER')).toBe(true);
  });

  it('still rotates normally while anyone is standing', () => {
    const s = start(base()).state;
    const first = s.activePlayer;
    for (const id of s.turnOrder) {
      if (id !== first) s.players[id].status = 'gone';
    }
    // One seat left: the turn comes back round to them rather than ending.
    const r = apply(s, first, { t: 'END_TURN' });
    expect(r.state.winner).toBeNull();
    expect(r.state.activePlayer).toBe(first);
  });
});
