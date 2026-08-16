// The Vessel is a player with a different deck, not a different interface.
//
// Five bespoke commands and a leftover posse deck became ten cards. Two things
// that buys, and both are structural rather than cosmetic: everyone at the
// table interacts the same way, and the dominant-action problem cannot recur —
// a safe option that is a permanent button gets pressed every turn, and one
// that has to be drawn cannot be.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { randInt } from '../engine/rng';
import { newInstance, drawCards } from '../engine/effects';
import { card, VESSEL_IDS } from '../content/cards';
import type { GameState, PlayerId, Tuning } from '../engine/state';

function turned(tuning: Partial<Tuning> = {}, players = ['Ada', 'Bo', 'Cy']) {
  const s0 = start(setup({ seed: 'vess', players, markedIndex: 1, tuning })).state;
  s0.whispers = s0.tuning.whisperThreshold;
  const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
  return { s, vessel: s.vessel!, posse: s.turnOrder.filter((p) => s.players[p].status === 'posse') };
}

/** Everything the Vessel owns, wherever it is sitting. */
const owned = (s: GameState, v: PlayerId) =>
  [...s.players[v].deck, ...s.players[v].hand, ...s.players[v].discard];

const acting = (s: GameState, v: PlayerId) => {
  s.activePlayer = v;
  s.actionsLeft = 3;
  if (!s.players[v].hand.length) drawCards(s, v, s.tuning.handSize, []);
  return s;
};

const playCard = (s: GameState, v: PlayerId, id: string) => {
  const inst = newInstance(s, id);
  s.players[v].hand.push(inst);
  return apply(s, v, { t: 'PLAY_CARD', uid: inst.uid });
};

// ------------------------------------------------------------- the deletion

describe('the bespoke commands are gone', () => {
  it('leaves no trace of them anywhere in the source', () => {
    // Deleted, not left unreachable. A branch nobody can reach is a branch
    // somebody will re-reach.
    const roots = ['engine', 'content', 'server', 'sim', 'worker', 'client/src'];
    const banned = ["'CALL'", "'SUMMON'", "'SHUTTER'", "'OFFER'"];
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          const t = line.trim();
          if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
          for (const b of banned) if (t.includes(b)) found.push(`${full}: ${t}`);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(found).toEqual([]);
  });

  it('gives the Vessel the same command types as anyone else', () => {
    const { s, vessel, posse } = turned();
    acting(s, vessel);
    const mine = new Set(legalCommands(s, vessel).map((c) => c.t));

    const other = { ...s, activePlayer: posse[0]!, actionsLeft: 3 };
    const theirs = new Set(legalCommands(other, posse[0]!).map((c) => c.t));

    // Nothing the Vessel can do is a kind of thing nobody else can do. It is a
    // strict SUBSET now — no cashing in, no buying — which is the interface
    // getting smaller rather than a second one appearing.
    expect([...mine].filter((k) => !theirs.has(k) && k !== 'PLAY_CARD')).toEqual([]);
    expect(mine.has('PLAY_CARD')).toBe(true);
    expect(mine.has('SPEND_GRIT')).toBe(false);
    expect(mine.has('BUY')).toBe(false);
  });
});

// ----------------------------------------------------------------- the deck

describe('the deck the Turning hands over', () => {
  it('is the fixed set plus exactly the Fevered Signs they held', () => {
    const s0 = start(setup({ seed: 'keeps', players: ['Ada', 'Bo', 'Cy'], markedIndex: 1 })).state;
    // Give one seat three Signs and make sure it is the one that turns.
    const willTurn = s0.turnOrder[0]!;
    for (const id of ['colt', 'dynamite', 'hymn']) {
      s0.players[willTurn].deck.push(newInstance(s0, id));
    }
    s0.whispers = s0.tuning.whisperThreshold;
    const s = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
    expect(s.vessel).toBe(willTurn);

    const mine = owned(s, willTurn);
    const signs = mine.filter((ci) => card(ci.cardId).type === 'sign');
    const fixed = mine.filter((ci) => card(ci.cardId).type === 'vessel');

    expect(signs.map((ci) => ci.cardId).sort()).toEqual(['colt', 'dynamite', 'hymn']);
    // The more corrupt a player was, the more of their own purchases are in
    // the thing now hunting the table.
    expect(signs.every((ci) => ci.fevered), 'a Sign came through clean').toBe(true);
    expect(fixed).toHaveLength(10);
    expect(mine).toHaveLength(13);
  });

  it('gives a Vessel who bought no Signs a functional deck anyway', () => {
    const { s, vessel } = turned();
    const mine = owned(s, vessel);
    expect(mine).toHaveLength(10);
    expect(mine.every((ci) => card(ci.cardId).type === 'vessel')).toBe(true);
    // Functional means playable, not merely present.
    acting(s, vessel);
    expect(legalCommands(s, vessel).some((c) => c.t === 'PLAY_CARD')).toBe(true);
  });

  it('holds the mix TUNING asks for', () => {
    const { s, vessel } = turned();
    const counts: Record<string, number> = {};
    for (const ci of owned(s, vessel)) {
      counts[ci.cardId] = (counts[ci.cardId] ?? 0) + 1;
    }
    expect(counts).toEqual(s.tuning.vesselDeck);
    expect(Object.keys(s.tuning.vesselDeck).sort()).toEqual([...VESSEL_IDS].sort());
  });
});

describe('the same rhythm as everybody else', () => {
  it('is dealt a hand the moment it becomes the Vessel', () => {
    // `checkTurning` runs at the END of a command, after `startTurn` has
    // already dealt from the deck that is about to be thrown away — so without
    // an explicit deal the Vessel spends its first turn holding nothing.
    const { s, vessel } = turned();
    expect(s.players[vessel].hand).toHaveLength(s.tuning.handSize);
  });

  it('draws, plays and discards like the posse', () => {
    const { s, vessel } = turned();
    acting(s, vessel);
    const before = s.players[vessel].hand.length;

    const played = apply(s, vessel, {
      t: 'PLAY_CARD', uid: s.players[vessel].hand[0]!.uid,
    }).state;
    expect(played.players[vessel].hand.length).toBe(before - 1);

    // Settle any prompts the card raised. A GIFT asks twice — who, then which
    // Sign — so this is a loop rather than a single answer.
    let settled = played;
    for (let i = 0; i < 4 && settled.pending; i++) {
      settled = apply(settled, vessel, {
        t: 'RESOLVE_CHOICE', choiceId: settled.pending.id,
        picks: [settled.pending.options[0]!.key],
      }).state;
    }
    expect(settled.pending).toBeNull();

    // Ending the turn sweeps the hand, exactly as it does for anyone.
    const ended = apply(settled, vessel, { t: 'END_TURN' }).state;
    expect(ended.players[vessel].hand).toHaveLength(0);
  });

  it('does not shrink, because it cannot run out', () => {
    /*
      The Vessel's deck used to decay one card per recycle, for an Act II
      clock. It does not any more: a deck that shrinks to a floor and a deck
      that cannot run out are two rules arguing about the same pile, and "the
      Vessel always has something to do" won that argument.

      The Act II clock is Doom and the burial track. It did not need a third,
      and the Revenants still burn out — that mechanic is untouched.
    */
    const { s, vessel } = turned({ revenantDecay: 1 });
    const p = s.players[vessel];
    p.discard = [...p.deck, ...p.hand];
    p.deck = [];
    p.hand = [];

    for (let i = 0; i < 12; i++) {
      drawCards(s, vessel, s.tuning.handSize, []);
      p.discard = [...p.discard, ...p.hand, ...p.deck];
      p.hand = [];
      p.deck = [];
    }
    expect(owned(s, vessel)).toHaveLength(10);
  });
});

// ---------------------------------------------------------------- the cards

describe('NOT THAT ONE', () => {
  it('removes the named type from every player and expires on schedule', () => {
    const { s, vessel, posse } = turned();
    acting(s, vessel);
    const r = playCard(s, vessel, 'not-that-one');
    const shut = apply(r.state, vessel, {
      t: 'RESOLVE_CHOICE', choiceId: r.state.pending!.id, picks: ['kit'],
    }).state;
    expect(shut.shuttered).toMatchObject({ type: 'kit' });

    const canPlayKit = (st: GameState, pid: PlayerId) => {
      const t = { ...st, activePlayer: pid, actionsLeft: 3 };
      t.players = { ...t.players, [pid]: { ...t.players[pid]!, hand: [newInstance(t, 'canteen')] } };
      return legalCommands(t, pid).some((c) => c.t === 'PLAY_CARD');
    };

    // Everyone, not just the seat it was aimed at.
    for (const pid of posse) expect(canPlayKit(shut, pid), pid).toBe(false);

    const later = { ...shut, round: shut.round + shut.tuning.shutterDuration + 1 };
    for (const pid of posse) expect(canPlayKit(later, pid), pid).toBe(true);
  });
});

describe('A GIFT, FREELY GIVEN', () => {
  /** Play the gift, choosing recipient then Sign. */
  function give(s: GameState, vessel: PlayerId, to: PlayerId, sign: string) {
    const r = playCard(s, vessel, 'freely-given');
    const who = apply(r.state, vessel, {
      t: 'RESOLVE_CHOICE', choiceId: r.state.pending!.id, picks: [to],
    });
    return apply(who.state, vessel, {
      t: 'RESOLVE_CHOICE', choiceId: who.state.pending!.id, picks: [sign],
    });
  }

  it('lets the Vessel choose both the recipient and the Sign', () => {
    const { s, vessel, posse } = turned();
    acting(s, vessel);
    const done = give(s, vessel, posse[1]!, 'colt');
    const got = done.state.players[posse[1]!]!.discard.at(-1)!;
    expect(got.cardId).toBe('colt');
    expect(got.fevered).toBe(true);
    expect(done.state.players[posse[0]!]!.discard.at(-1)?.cardId).not.toBe('colt');
  });

  it('pays only if the gift is played inside the window', () => {
    const { s, vessel, posse } = turned();
    acting(s, vessel);
    const to = posse[0]!;
    const given = give(s, vessel, to, 'colt').state;
    const gift = given.players[to]!.discard.at(-1)!;

    const inTime = structuredClone(given);
    inTime.players[to]!.hand.push(...inTime.players[to]!.discard.splice(-1));
    inTime.activePlayer = to;
    inTime.actionsLeft = 3;
    const paid = apply(inTime, to, { t: 'PLAY_CARD', uid: gift.uid });
    expect(paid.events.some((e) => e.t === 'OFFER_TAKEN')).toBe(true);

    const late = structuredClone(inTime);
    late.round = gift.offeredUntil! + 1;
    const free = apply(late, to, { t: 'PLAY_CARD', uid: gift.uid });
    expect(free.events.some((e) => e.t === 'OFFER_TAKEN')).toBe(false);
  });

  it('names no reward when the gift is made', () => {
    // The target knowing the exact bounty on their own head changes the
    // decision, so the payoff is logged when it PAYS, not when it is offered.
    const { s, vessel, posse } = turned();
    acting(s, vessel);
    const done = give(s, vessel, posse[0]!, 'colt');
    const offered = done.events.find((e) => e.t === 'OFFERED')!;
    expect('whispers' in offered).toBe(false);
  });
});

describe('the Vessel is never stuck', () => {
  /**
   * The requirement, asserted directly: with actions left, there is always
   * something to play.
   *
   * Stated as "actions remaining" rather than "every turn", because a turn
   * that has spent all three actions correctly offers only END_TURN — that is
   * a finished turn, not a stuck one, and a test that conflated them would be
   * unsatisfiable.
   *
   * It holds WITHOUT refilling the hand mid-turn, and the reason is structural
   * rather than lucky: `handSize` is 5 and `actionsPerTurn` is 3, so a hand
   * cannot be emptied inside one turn. If either number ever moves past the
   * other, this test is what will say so.
   *
   * Before this held, 67 of 534 Act II Vessel turns had no legal move but
   * END_TURN: the deck could be burned to nothing by damage, and a hand played
   * out mid-turn was not refilled.
   */
  it('always has a card to play while it has actions', () => {
    let checked = 0;
    for (let g = 0; g < 24; g++) {
      const seed = `stuck-${g}`;
      let s = start(setup({
        seed, players: ['Ada', 'Bo', 'Cy', 'Dell'], markedIndex: g % 4,
      })).state;
      s.whispers = s.tuning.whisperThreshold;
      s = apply(s, s.activePlayer, { t: 'END_TURN' }).state;

      let cursor = 0;
      for (let i = 0; i < 600 && !s.winner; i++) {
        const actor = s.pending ? s.pending.player : s.activePlayer;
        const legal = legalCommands(s, actor);
        if (!legal.length) break;

        if (actor === s.vessel && !s.pending && s.actionsLeft > 0) {
          checked++;
          expect(
            legal.some((c) => c.t !== 'END_TURN'),
            `stuck with ${s.actionsLeft} actions, hand ${
              s.players[actor].hand.length}, deck ${s.players[actor].deck.length}`,
          ).toBe(true);
        }
        s = apply(s, actor, legal[randInt(seed, cursor++, legal.length)]!).state;
      }
    }
    expect(checked, 'never reached an Act II Vessel turn').toBeGreaterThan(100);
  });

  it('rebuilds the deck rather than running out', () => {
    // Damage trashes to the boneyard with no floor, so the posse could burn
    // the deck away entirely. A Vessel with nothing anywhere sits through its
    // own turns, which is the least frightening thing it could do.
    const { s, vessel } = turned();
    const p = s.players[vessel];
    p.deck = [];
    p.hand = [];
    p.discard = [];

    drawCards(s, vessel, s.tuning.handSize, []);
    expect(p.hand.length).toBe(s.tuning.handSize);
    expect(owned(s, vessel).length).toBe(10);
    expect(owned(s, vessel).every((ci) => card(ci.cardId).type === 'vessel')).toBe(true);
  });

  it('does NOT refill its hand mid-turn', () => {
    // Same rhythm as everyone else: you play the hand you were dealt and wait
    // for the next Dawn. The Vessel briefly redrew on an empty hand, which
    // gave it a different tempo from the rest of the table for no gain — the
    // deck no longer running out is what actually keeps it from being stuck.
    const { s, vessel } = turned();
    acting(s, vessel);
    s.players[vessel].hand = [newInstance(s, 'long-noon')];
    s.actionsLeft = 3;
    const r = apply(s, vessel, {
      t: 'PLAY_CARD', uid: s.players[vessel].hand[0]!.uid,
    });
    expect(r.state.actionsLeft).toBe(2);
    expect(r.state.players[vessel].hand).toHaveLength(0);
  });

  it('cannot cash cards in, because it has nothing to spend Grit on', () => {
    // Grit buys from the market and the Vessel cannot buy. A cash-in button
    // would turn cards into a currency with no use — live, and doing nothing.
    // It also takes the market and the counter off that seat's screen.
    const { s, vessel, posse } = turned();
    acting(s, vessel);
    expect(s.players[vessel].hand.length).toBeGreaterThan(0);
    expect(legalCommands(s, vessel).some((c) => c.t === 'SPEND_GRIT')).toBe(false);
    expect(legalCommands(s, vessel).some((c) => c.t === 'BUY')).toBe(false);

    // Everyone else still can.
    const them = { ...s, activePlayer: posse[0]!, actionsLeft: 3 };
    drawCards(them, posse[0]!, them.tuning.handSize, []);
    expect(legalCommands(them, posse[0]!).some((c) => c.t === 'SPEND_GRIT')).toBe(true);
  });
});

describe('SOMETHING COMES UP THE STREET on a full Street', () => {
  /**
   * It overflows. It does not fizzle.
   *
   * This used to `return` when no slot was free — a legal play that changed no
   * state, which is the worst kind of card: you spend an action to find out it
   * did nothing. Overflow is already the game's answer to a Threat with
   * nowhere to stand, and routing through the same arrival means there is ONE
   * arrival rule rather than two that can drift.
   */
  function fullStreet() {
    const { s, vessel } = turned();
    for (let i = 0; i < s.tuning.streetSlots; i++) {
      s.street[i] = {
        instance: newInstance(s, 'barons-men'), damage: 0, turned: false,
        // Descending, so slot 0 is unambiguously the oldest.
        enteredRound: s.round - (s.tuning.streetSlots - i), escalation: 0,
      };
    }
    acting(s, vessel);
    return { s, vessel };
  }

  it('makes the oldest Threat menace the table and grow', () => {
    const { s, vessel } = fullStreet();
    const before = s.street[0]!.escalation;
    const r = playCard(s, vessel, 'up-the-street');

    expect(r.events.some((e) => e.t === 'MENACE'), 'nothing menaced').toBe(true);
    expect(r.state.street[0]!.escalation, 'the oldest did not grow')
      .toBeGreaterThan(before);
    // And nothing new stood up — there was nowhere to stand.
    expect(r.events.some((e) => e.t === 'THREAT_ENTERED')).toBe(false);
  });

  it('still fills an empty slot when there is one', () => {
    const { s, vessel } = fullStreet();
    s.street[2] = null;
    const r = playCard(s, vessel, 'up-the-street');
    expect(r.events.some((e) => e.t === 'THREAT_ENTERED')).toBe(true);
    expect(r.state.street[2]).not.toBeNull();
  });

});
