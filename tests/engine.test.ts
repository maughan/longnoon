import { describe, it, expect } from 'vitest';
import { setup, start, apply, legalCommands, playerView } from '../engine';
import { shuffle, randAt } from '../engine/rng';
import {
  opsFor, signsHeld, newInstance, damagePlayer, effectiveClear, effectiveMenace,
} from '../engine/effects';
import { card } from '../content/cards';
import type { GameState, Command, PlayerId, GameEvent } from '../engine/state';

const base = () => setup({ seed: 'noon', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1 });

function play(s: GameState, cmds: [PlayerId, Command][]): GameState {
  let cur = s;
  for (const [pid, c] of cmds) cur = apply(cur, pid, c).state;
  return cur;
}

/** Drive a whole game with a policy. Returns the final state. */
function autoplay(
  s: GameState,
  pick: (st: GameState, legal: Command[]) => Command,
  maxSteps = 4000,
): GameState {
  let cur = s;
  for (let i = 0; i < maxSteps && !cur.winner; i++) {
    const actor = cur.pending ? cur.pending.player : cur.activePlayer;
    const legal = legalCommands(cur, actor);
    if (!legal.length) break;
    cur = apply(cur, actor, pick(cur, legal)).state;
  }
  return cur;
}

// ---------------------------------------------------------------------------

describe('rng', () => {
  it('is pure: same seed and cursor gives the same value', () => {
    expect(randAt('noon', 7)).toBe(randAt('noon', 7));
    expect(randAt('noon', 7)).not.toBe(randAt('noon', 8));
  });

  it('shuffle advances the cursor and preserves membership', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(items, 'noon', 0);
    const b = shuffle(items, 'noon', 0);
    expect(a.items).toEqual(b.items);
    expect(a.cursor).toBeGreaterThan(0);
    expect([...a.items].sort()).toEqual(items);
  });

  it('different seeds produce different orders', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], 'noon', 0).items;
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], 'dusk', 0).items;
    expect(a).not.toEqual(b);
  });
});

describe('determinism', () => {
  it('seed + command list reconstructs an identical game', () => {
    const pick = (_: GameState, legal: Command[]) => legal[0];
    const a = autoplay(start(base()).state, pick);
    const b = autoplay(start(base()).state, pick);
    expect(a.log.length).toBe(b.log.length);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('state stays serializable throughout', () => {
    const s = autoplay(start(base()).state, (_, l) => l[l.length - 1], 400);
    expect(() => structuredClone(s)).not.toThrow();
    expect(JSON.parse(JSON.stringify(s)).round).toBe(s.round);
  });

  it('apply does not mutate the input state', () => {
    const s = start(base()).state;
    const before = JSON.stringify(s);
    apply(s, s.activePlayer, { t: 'END_TURN' });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('setup and turn structure', () => {
  it('deals identical decks and a 5-card opening hand', () => {
    const s = start(base()).state;
    for (const id of s.turnOrder) {
      const p = s.players[id];
      expect(p.deck.length + p.hand.length).toBe(s.tuning.startingDeckSize);
    }
    expect(s.players[s.activePlayer].hand.length).toBe(5);
    expect(s.actionsLeft).toBe(3);
  });

  it('Threat volume at Dawn scales with the table, not a flat rate', () => {
    // A flat 1 a round meant the table brought nine to fifteen actions to bear
    // on a single objective. See content/cards.ts.
    const three = start(setup({ seed: 'noon', players: ['a', 'b', 'c'] })).state;
    const five = start(setup({ seed: 'noon', players: ['a', 'b', 'c', 'd', 'e'] })).state;
    const at = (s: GameState) => s.street.filter(Boolean).length;
    const t = three.tuning;
    const expected = (n: number) => Math.max(
      t.threatsMin, Math.round(n * t.threatsPerRound) - t.threatsOffset,
    );
    expect(at(three)).toBe(expected(3));
    expect(at(five)).toBe(expected(5));
    expect(at(five)).toBeGreaterThan(at(three));
    expect(three.round).toBe(1);
  });

  it('never reveals fewer than the minimum, however small the table', () => {
    // Two players would otherwise get one Threat between them.
    const two = start(setup({ seed: 'noon', players: ['a', 'b'] })).state;
    expect(two.street.filter(Boolean).length).toBe(two.tuning.threatsMin);
  });

  it('advances through all players then runs Dusk and a new round', () => {
    let s = start(base()).state;
    const r = s.round;
    s = play(s, s.turnOrder.map((id) => [id, { t: 'END_TURN' } as Command]));
    expect(s.round).toBe(r + 1);
  });
});

describe('the corruption economy', () => {
  it('buying a Sign is always available regardless of the Provision row', () => {
    const s = start(base()).state;
    const p = s.players[s.activePlayer];
    p.gritThisTurn = 10;
    const legal = legalCommands(s, s.activePlayer);
    const buys = legal.filter((c) => c.t === 'BUY').map((c: any) => c.cardId);
    expect(buys).toContain('certainty');
    expect(buys).toContain('colt');
  });

  it('playing a Sign adds its Whispers to the shared track', () => {
    let s = start(base()).state;
    const pid = s.activePlayer;
    const inst = newInstance(s, 'colt');
    s.players[pid].hand.push(inst);
    const before = s.whispers;
    s = apply(s, pid, { t: 'PLAY_CARD', uid: inst.uid }).state;
    expect(s.whispers).toBe(before + 3);
  });

  it('damage eats Provisions before Signs', () => {
    const s = start(base()).state;
    const pid = s.activePlayer;
    const p = s.players[pid];
    p.deck = [newInstance(s, 'colt'), newInstance(s, 'saddlebag'), newInstance(s, 'winchester')];
    p.hand = []; p.discard = [];
    const ev: any[] = [];
    damagePlayer(s, pid, 2, ev);
    expect(p.boneyard.map((c) => c.cardId).sort()).toEqual(['saddlebag', 'winchester']);
    expect(p.deck.map((c) => c.cardId)).toEqual(['colt']);
  });

  it('a wounded player gets proportionally more corrupt', () => {
    const s = start(base()).state;
    const pid = s.activePlayer;
    const p = s.players[pid];
    p.deck = [
      newInstance(s, 'colt'), newInstance(s, 'saddlebag'),
      newInstance(s, 'saddlebag'), newInstance(s, 'winchester'),
    ];
    p.hand = []; p.discard = [];
    const ratioBefore = signsHeld(s, pid) / (p.deck.length || 1);
    damagePlayer(s, pid, 2, []);
    const ratioAfter = signsHeld(s, pid) / (p.deck.length || 1);
    expect(ratioAfter).toBeGreaterThan(ratioBefore);
  });

  it('the Provision deck is finite and never reshuffles', () => {
    const s = start(base()).state;
    expect(s.supply.provisions.length + s.supply.provisionRow.length)
      .toBe(s.tuning.provisionDeckSize);
  });

  it('provisionDeckSize cuts the deck to a random subset', () => {
    const s = setup({ seed: 'noon', players: ['a', 'b'], tuning: { provisionDeckSize: 12 } });
    expect(s.supply.provisions.length + s.supply.provisionRow.length).toBe(12);
  });
});

describe('Fevered faces', () => {
  it('retarget rewrites the target, not the magnitude', () => {
    const colt = card('colt');
    expect(opsFor(colt, false)[0]).toMatchObject({ op: 'destroy', target: 'choose' });
    expect(opsFor(colt, true)[0]).toMatchObject({ op: 'destroy', target: 'itChooses' });

    // Retarget on its own never adds or removes an op.
    const parson = card('parson');
    expect(opsFor(parson, true).length).toBe(opsFor(parson, false).length);
    expect(opsFor(parson, true)[0]).toMatchObject({ op: 'recover', target: 'mostSigns' });
  });

  it('appendOps adds to the effect without weakening it', () => {
    const salt = card('salt-line');
    const clean = opsFor(salt, false);
    const fevered = opsFor(salt, true);
    expect(fevered[0]).toEqual(clean[0]);
    expect(fevered.slice(clean.length)).toContainEqual({ op: 'whisper', n: 1 });
  });

  it('every Sign has a Fevered face expressible in the schema', () => {
    for (const id of ['colt', 'parson', 'dynamite', 'debt', 'night-watch',
      'last-words', 'hymn', 'certainty', 'stake-claim', 'coyote', 'salt-line', 'widow']) {
      const c = card(id);
      expect(c.fevered, `${id} has no Fevered face`).toBeDefined();
      const f = c.fevered!;
      const usesSchema =
        !!(f.retarget || f.appendOps || f.prependOps || f.constraints || c.passive);
      expect(usesSchema, `${id} needs bespoke code`).toBe(true);
    }
  });

  it('Fevered Colt hits the leftmost slot with no choice offered', () => {
    let s = start(base()).state;
    const pid = s.activePlayer;
    s.street[1] = { instance: newInstance(s, 'rustlers'), damage: 0, turned: false, enteredRound: 1 , escalation: 0};
    const inst = newInstance(s, 'colt', true);
    s.players[pid].hand.push(inst);
    // Omens are untargetable, so "leftmost" means leftmost damageable slot.
    const occupied = s.street
      .map((sl, i) => (sl && card(sl.instance.cardId).type !== 'omen' ? i : -1))
      .filter((i) => i >= 0);
    s = apply(s, pid, { t: 'PLAY_CARD', uid: inst.uid }).state;
    expect(s.pending).toBeNull();
    expect(s.street[occupied[0]]).toBeNull();
  });
});

describe('the Turning', () => {
  const trip = (st: GameState) => {
    const s = structuredClone(st);
    s.whispers = s.tuning.whisperThreshold;
    return apply(s, s.activePlayer, { t: 'END_TURN' }).state;
  };

  it('fires at the threshold and installs a Vessel', () => {
    const s = trip(start(base()).state);
    expect(s.act).toBe('mythos');
    expect(s.vessel).not.toBeNull();
    expect(s.players[s.vessel!].status).toBe('vessel');
  });

  it('makes the greediest player the Vessel even when they are not Marked', () => {
    const s0 = start(base()).state;
    const greedy = 'p2'; // Cy is Faithful; Bo (p1) is Marked
    s0.players[greedy].discard.push(
      newInstance(s0, 'colt'), newInstance(s0, 'debt'), newInstance(s0, 'widow'));
    const s = trip(s0);
    expect(s.vessel).toBe(greedy);
    expect(s.players[greedy].role).toBe('faithful');
  });

  it('turns every Sign everywhere, permanently', () => {
    const s0 = start(base()).state;
    s0.players.p0.discard.push(newInstance(s0, 'colt'));
    s0.players.p2.deck.push(newInstance(s0, 'salt-line'));
    const s = trip(s0);
    const allSigns = Object.values(s.players).flatMap((p) =>
      [...p.deck, ...p.hand, ...p.discard].filter((ci) => card(ci.cardId).type === 'sign'));
    expect(allSigns.length).toBeGreaterThan(0);
    expect(allSigns.every((ci) => ci.fevered)).toBe(true);
  });

  it('swaps the Trouble deck for the Mythos deck', () => {
    const s = trip(start(base()).state);
    expect(s.supply.trouble.length).toBe(0);
    expect(s.doom).toBe(3);
  });

  it('gives the Vessel a deck of its own', () => {
    const s = trip(start(base()).state);
    // The deck is the point: the Vessel's actions are cards now, so what the
    // Turning hands over is a deck rather than a menu.
    const v = s.players[s.vessel!];
    /*
      Everything the Vessel holds, wherever it currently sits.

      deck + hand + discard rather than the deck alone: the Turning empties the
      hand and `startTurn` may already have dealt a fresh one from the new deck
      by the time this state exists, so a deck-only assertion is really an
      assertion about whose turn came next.

      Scars are excluded — damage adds them afterwards and they are nobody's
      design decision.
    */
    const own = [...v.deck, ...v.hand, ...v.discard]
      .filter((ci) => card(ci.cardId).type !== 'scar');
    expect(own.length).toBeGreaterThan(0);
    const strays = own
      .map((ci) => card(ci.cardId))
      .filter((c) => c.type !== 'vessel' && c.type !== 'sign')
      .map((c) => `${c.id}:${c.type}`);
    expect(strays, 'the old posse deck survived the Turning').toEqual([]);
    if (s.activePlayer === s.vessel) {
      // And the seat is not a spectator: it reaches them through PLAY_CARD,
      // like anybody else at the table.
      const legal = legalCommands(s, s.vessel!);
      expect(legal.some((c) => c.t === 'PLAY_CARD')).toBe(true);
    }
    expect(s.revealedRoles.length).toBeGreaterThan(0);
  });
});

describe('hidden information', () => {
  it('playerView hides other roles, hands, and deck order', () => {
    const s = start(base()).state;
    const v = playerView(s, 'p0');
    expect(v.you!.role).toBe('faithful');
    for (const o of v.opponents) {
      expect(o.role).toBeNull();
      expect((o as any).hand).toBeUndefined();
      expect((o as any).deck).toBeUndefined();
      expect(typeof o.handCount).toBe('number');
    }
    expect(JSON.stringify(v)).not.toContain('marked');
  });

  it('gives you your own deck as contents, carrying no trace of the shuffle', () => {
    // The half this test's name always claimed and never checked. Opponents'
    // decks are absent entirely, which is easy; YOUR deck is sent in full,
    // because a deck builder you cannot review is unplayable — so the order is
    // the thing that has to be scrubbed, and only a permutation can prove it.
    //
    // It matters more now than it did: the client draws this pile as faces in a
    // grid, so anything surviving here is on screen rather than buried in a
    // payload.
    const s = start(base()).state;
    const mine = playerView(s, 'p0').you!.deck;
    expect(mine.length).toBeGreaterThan(4);

    for (let cut = 1; cut < 5; cut++) {
      const rotated = structuredClone(s);
      const d = rotated.players['p0'].deck;
      rotated.players['p0'].deck = [...d.slice(cut), ...d.slice(0, cut)];
      expect(
        JSON.stringify(playerView(rotated, 'p0').you!.deck),
        `a cut of ${cut} showed through`,
      ).toBe(JSON.stringify(mine));
    }

    // Reversal too — a rotation alone would pass a sort that only fixed the
    // first card.
    const flipped = structuredClone(s);
    flipped.players['p0'].deck = [...flipped.players['p0'].deck].reverse();
    expect(JSON.stringify(playerView(flipped, 'p0').you!.deck))
      .toBe(JSON.stringify(mine));
  });

  it('reveals roles only after the Turning', () => {
    const s0 = start(base()).state;
    s0.whispers = s0.tuning.whisperThreshold;
    const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
    const v = playerView(s, 'p0');
    expect(v.opponents.some((o) => o.role !== null)).toBe(true);
  });

  it('does not leak a pending choice belonging to someone else', () => {
    const s = start(base()).state;
    s.pending = { id: 'x', player: 'p1', prompt: 'p', options: [], min: 1, max: 1 };
    expect(playerView(s, 'p0').pending).toBeNull();
    expect(playerView(s, 'p1').pending).not.toBeNull();
  });
});

describe('legality', () => {
  it('rejects commands from the wrong player', () => {
    const s = start(base()).state;
    const other = s.turnOrder.find((id) => id !== s.activePlayer)!;
    expect(() => apply(s, other, { t: 'END_TURN' })).toThrow();
  });

  it('rejects buying without Grit', () => {
    const s = start(base()).state;
    expect(() => apply(s, s.activePlayer, { t: 'BUY', cardId: 'colt' })).toThrow();
  });

  it('every command legalCommands returns is actually applicable', () => {
    let s = start(base()).state;
    for (let i = 0; i < 200 && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      for (const c of legal) {
        expect(() => apply(s, actor, c), `${JSON.stringify(c)}`).not.toThrow();
      }
      s = apply(s, actor, legal[i % legal.length]).state;
    }
  });

  it('runs to a winner without deadlocking', () => {
    const s = autoplay(start(base()).state, (_st, legal) => {
      const buy = legal.find((c) => c.t === 'BUY');
      const grit = legal.find((c) => c.t === 'SPEND_GRIT');
      return buy ?? grit ?? legal.find((c) => c.t === 'PLAY_CARD') ?? legal[legal.length - 1];
    });
    expect(['posse', 'oldOne', null]).toContain(s.winner);
    expect(s.round).toBeGreaterThan(1);
  });
});

describe('reviewing your own deck', () => {
  it('shows you what you built, but never the order you will draw it', () => {
    const s = start(base()).state;
    const me = s.activePlayer;
    const v = playerView(s, me);

    // Same cards...
    expect(v.you!.deck.length).toBe(s.players[me].deck.length);
    expect(v.you!.deck.map((c) => c.cardId).sort())
      .toEqual(s.players[me].deck.map((c) => c.cardId).sort());

    // ...in a canonical order that carries no trace of the real one.
    const ids = v.you!.deck.map((c) => c.cardId);
    expect(ids).toEqual([...ids].sort());
  });

  it('two different shuffles of the same deck look identical', () => {
    const a = start(setup({ seed: 'deck-a', players: ['x', 'y'] })).state;
    const b = start(setup({ seed: 'deck-b', players: ['x', 'y'] })).state;
    const ids = (s: GameState) =>
      playerView(s, 'p1').you!.deck.map((c) => c.cardId);
    // p1 has not drawn yet, so both hold the same starting multiset.
    expect(ids(a)).toEqual(ids(b));
    expect(a.players.p1.deck.map((c) => c.cardId))
      .not.toEqual(b.players.p1.deck.map((c) => c.cardId));
  });

  it('still never shows an opponent their neighbour\'s deck', () => {
    const s = start(base()).state;
    for (const o of playerView(s, 'p0').opponents) {
      expect((o as unknown as { deck?: unknown }).deck).toBeUndefined();
      expect(typeof o.deckCount).toBe('number');
    }
  });
});


describe('the view carries every threshold it displays', () => {
  /**
   * A track needs both halves of its fraction.
   *
   * The Burial track had no `vesselClear` to read, so the client carried a
   * hardcoded 16 against a real value of 31 — a player could fill the bar,
   * read 16/16, and watch the game carry on. A number the UI shows and the
   * engine owns has to travel with the view.
   */
  it('sends the thresholds behind Whispers, Doom and the Burial', () => {
    const s = start(base()).state;
    const v = playerView(s, s.activePlayer);
    expect(v.whisperThreshold).toBe(s.tuning.whisperThreshold);
    expect(v.doomTarget).toBe(s.tuning.doomTarget);
    expect(v.vesselClear).toBe(s.tuning.vesselClear);
  });

  it('reports a burial the engine would call complete', () => {
    const s = start(base()).state;
    s.act = 'mythos';
    s.vesselDamage = s.tuning.vesselClear;
    const v = playerView(s, s.activePlayer);
    // Whatever the client draws, "full" on screen must mean full in the rules.
    expect(v.vesselDamage >= v.vesselClear).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// Escalation: a Threat left standing gets worse

/** Every living player ends their turn; the last one brings on Dusk. */
function roundEnd(s: GameState): { state: GameState; events: GameEvent[] } {
  let cur = s;
  const events: GameEvent[] = [];
  for (let i = 0; i < cur.turnOrder.length; i++) {
    const r = apply(cur, cur.activePlayer, { t: 'END_TURN' });
    cur = r.state;
    events.push(...r.events);
    if (cur.winner) break;
  }
  return { state: cur, events };
}

/** An empty Street, so a test controls exactly what is standing in it. */
function clearStreet(s: GameState): void {
  s.street = new Array(s.tuning.streetSlots).fill(null);
}

/**
 * No Threats arrive at Dawn.
 *
 * A test about escalation should measure escalation. Leave the decks stocked
 * and Dawn keeps dealing, the Street fills, and the Threat under test starts
 * collecting overflow steps as well as Dusk steps — correct behaviour, and
 * useless as a measurement.
 */
function quietDawn(s: GameState): void {
  s.supply.trouble = [];
  s.supply.troubleDiscard = [];
  s.supply.mythos = [];
  s.supply.mythosDiscard = [];
  // An empty Trouble deck IS the Turning — `turnOnTroubleExhausted` treats the
  // Long Season running out as a reason to end it. Without this the Threat
  // under test flips to its reverse mid-measurement and the test is quietly
  // reading a different card. (It cost half an hour; hence the comment.)
  s.tuning = { ...s.tuning, turnOnTroubleExhausted: false };
}

function put(s: GameState, slot: number, cardId: string, enteredRound = s.round) {
  const instance = newInstance(s, cardId);
  s.street[slot] = { instance, damage: 0, turned: false, enteredRound, escalation: 0 };
  return instance.uid;
}

const find = (s: GameState, uid: string) =>
  s.street.find((sl) => sl?.instance.uid === uid) ?? null;

const menaceOf = (s: GameState, uid: string) =>
  effectiveMenace(find(s, uid)!, s.tuning.omenMenace);

describe('unresolved Threats escalate', () => {
  it('gains Clear and Menace for every Dusk it survives', () => {
    const s = start(base()).state;
    clearStreet(s);
    quietDawn(s);
    const uid = put(s, 0, 'barons-men');          // printed Clear 4, Menace 2
    const printed = card('barons-men');
    const step = s.tuning.escalationPerRound;

    const after1 = roundEnd(s).state;
    expect(effectiveClear(find(after1, uid)!)).toBe(printed.clear! + step);
    expect(menaceOf(after1, uid)).toBe(printed.menace! + step);

    const after2 = roundEnd(after1).state;
    expect(effectiveClear(find(after2, uid)!)).toBe(printed.clear! + step * 2);
    expect(menaceOf(after2, uid)).toBe(printed.menace! + step * 2);
  });

  it('announces itself, so the table can be told', () => {
    const s = start(base()).state;
    clearStreet(s);
    quietDawn(s);
    const uid = put(s, 0, 'barons-men');
    const { events } = roundEnd(s);
    const said = events.find((e) => e.t === 'ESCALATED');
    expect(said).toBeDefined();
    // The event carries the new values, not the increment — a UI should never
    // have to add up a card's history to draw it.
    expect(said).toMatchObject({ cardId: 'barons-men', clear: 5, menace: 3 });
    expect(find(roundEnd(s).state, uid)).not.toBeNull();
  });

  it('does not escalate a Threat cleared during the day', () => {
    const s = start(base()).state;
    clearStreet(s);
    put(s, 0, 'rustlers');                        // Clear 2
    // A Winchester takes it off the Street before Dusk can reach it.
    const gun = newInstance(s, 'winchester');     // damage 2, target: choose
    s.players[s.activePlayer].hand.push(gun);
    const killed = apply(s, s.activePlayer, { t: 'PLAY_CARD', uid: gun.uid }).state;
    expect(killed.street[0]).toBeNull();

    const { events } = roundEnd(killed);
    expect(events.some((e) => e.t === 'ESCALATED' && e.cardId === 'rustlers'))
      .toBe(false);
  });
});

describe('escalation belongs to the slot, not the card', () => {
  it('escalates two copies of the same Threat independently', () => {
    const s = start(base()).state;
    clearStreet(s);
    quietDawn(s);
    const older = put(s, 0, 'rustlers', 0);
    const s1 = roundEnd(s).state;

    // A second copy arrives a round later and starts clean.
    const younger = put(s1, 1, 'rustlers');
    const s2 = roundEnd(s1).state;

    expect(find(s2, older)!.escalation).toBe(s.tuning.escalationPerRound * 2);
    expect(find(s2, younger)!.escalation).toBe(s.tuning.escalationPerRound);
    expect(effectiveClear(find(s2, older)!))
      .toBeGreaterThan(effectiveClear(find(s2, younger)!)!);
  });

  it('never touches the shared card template', () => {
    // `card()` returns the one definition every copy shares, including the ones
    // still face down in the deck. Mutating it would escalate the whole game.
    const before = { ...card('rustlers') };
    const s = start(base()).state;
    quietDawn(s);
    clearStreet(s);
    put(s, 0, 'rustlers');
    roundEnd(roundEnd(s).state);
    expect(card('rustlers').clear).toBe(before.clear);
    expect(card('rustlers').menace).toBe(before.menace);
  });

  it('reveals a fresh copy at printed values', () => {
    const s = start(base()).state;
    clearStreet(s);
    put(s, 0, 'rustlers', 0);
    const later = roundEnd(roundEnd(s).state).state;
    // Whatever Dawn dealt in alongside it entered clean.
    const fresh = later.street.filter((sl) => sl && sl.enteredRound === later.round);
    for (const sl of fresh) expect(sl!.escalation).toBe(0);
  });
});

describe('what cannot be cleared cannot gain Clear', () => {
  const omenGame = (escalateUncleanable: boolean) => start(setup({
    seed: 'noon', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1,
    tuning: { escalateUncleanable },
  })).state;

  it('never gives an Omen a Clear value, whichever way the flag is set', () => {
    for (const flag of [false, true]) {
      const s = omenGame(flag);
      clearStreet(s);
      quietDawn(s);
      const uid = put(s, 0, 'dead-cattle');        // an Omen: no Clear, ever
      const after = roundEnd(roundEnd(s).state).state;
      expect(effectiveClear(find(after, uid)!), `flag=${flag}`).toBeUndefined();
    }
  });

  it('leaves an Omen exactly as dangerous as it arrived, by default', () => {
    // Ruled off: an Omen can never be cleared, and since overflow stopped
    // evicting Threats it can never be pushed out either — so a climbing
    // Menace on one is a ratchet with no answer. Measured at 0.0% posse wins.
    const s = omenGame(false);
    clearStreet(s);
    quietDawn(s);
    const uid = put(s, 0, 'dead-cattle');
    const after = roundEnd(roundEnd(s).state).state;
    expect(find(after, uid)!.escalation).toBe(0);
    expect(menaceOf(after, uid)).toBe(s.tuning.omenMenace);
  });

  it('does escalate an Omen when the flag is turned on', () => {
    const s = omenGame(true);
    clearStreet(s);
    quietDawn(s);
    const uid = put(s, 0, 'dead-cattle');
    const after = roundEnd(s).state;
    expect(menaceOf(after, uid))
      .toBe(s.tuning.omenMenace + s.tuning.escalationPerRound);
  });

  it('leaves a permanent Mythos obstruction uncleanable', () => {
    const s = start(base()).state;
    s.act = 'mythos';
    clearStreet(s);
    quietDawn(s);
    const uid = put(s, 0, 'nothing-comes');        // no Clear printed
    const after = roundEnd(s).state;
    expect(effectiveClear(find(after, uid)!)).toBeUndefined();
  });
});

describe('overflow compounds rather than clearing itself', () => {
  it('leaves the oldest Threat in place, worse, instead of discarding it', () => {
    const s = start(base()).state;
    clearStreet(s);
    const ids = ['rustlers', 'claim-jumpers', 'barons-men', 'prairie-fire', 'cardsharp']
      .slice(0, s.tuning.streetSlots);
    const uids = ids.map((id, i) => put(s, i, id, i === 2 ? 0 : s.round));
    const oldest = uids[2];
    const discardBefore = s.supply.troubleDiscard.length;

    const after = roundEnd(s).state;

    // Nothing was thrown away to make room.
    expect(after.street.every((sl) => sl !== null)).toBe(true);
    for (const uid of uids) expect(find(after, uid), uid).not.toBeNull();

    // The oldest took the overflow on top of its Dusk step, so it is strictly
    // worse off than everything beside it.
    const escalations = after.street.map((sl) => sl!.escalation);
    const oldestSlot = after.street.findIndex((sl) => sl!.instance.uid === oldest);
    for (let i = 0; i < escalations.length; i++) {
      if (i !== oldestSlot) {
        expect(escalations[oldestSlot]).toBeGreaterThan(escalations[i]);
      }
    }

    // The Threat that could not fit was retired, not lost, so recycling sees it.
    expect(after.supply.troubleDiscard.length).toBeGreaterThan(discardBefore);
  });
});
