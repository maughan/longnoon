import type {
  GameState, Command, PlayerId, GameEvent, CardInstance, CardId,
} from './state';
import { card } from '../content/cards';
import { shuffle } from './rng';
import {
  opsFor, pushOps, runQueue, resolveChoice, drawCards,
  livingPlayers, addWhispers, assertWhisperInvariants, newInstance, signsHeld,
  canPay, clearThreat, enterStreet, resolveMenace, escalate,
} from './effects';

/**
 * The fallen aim their own Fevered cards. Paper rules, the Vessel: "now you aim
 * them again"; Revenant: "play a Fevered card (you choose all targets)".
 */
/** The Marked player's secret aim, as printed on the role card. */
const AIM_PLAYERS = 2;
const AIM_SIGNS = 3;

const aimsFeveredCards = (status: string): boolean =>
  status === 'vessel' || status === 'revenant';

export { IllegalCommand } from './errors';
import { IllegalCommand } from './errors';

/**
 * Pure: clones, mutates the clone, returns it with the events emitted.
 *
 * A thin shell over `applyInner` so the Whisper invariant is checked at exactly
 * one place. `applyInner` has two exits and will grow more; a rule enforced at
 * every `return` is a rule enforced at every `return` *so far*.
 */
export function apply(
  state: GameState, playerId: PlayerId, c: Command,
): { state: GameState; events: GameEvent[] } {
  const out = applyInner(state, playerId, c);
  assertWhisperInvariants(out.state);
  return out;
}

function applyInner(
  state: GameState, playerId: PlayerId, c: Command,
): { state: GameState; events: GameEvent[] } {
  const s: GameState = structuredClone(state);
  const ev: GameEvent[] = [];

  if (s.winner) throw new IllegalCommand('Game is over');

  if (s.pending) {
    if (c.t !== 'RESOLVE_CHOICE') throw new IllegalCommand('A choice is pending');
    if (s.pending.player !== playerId) throw new IllegalCommand('Not your choice');
    resolveChoice(s, c.picks, ev);
    checkTurning(s, ev);
    // This branch used to return here, and that lost the posse the game.
    //
    // Almost every blow that buries the Vessel arrives through a choice — with
    // any Threat in the Street, a `damage` op offers the slots AND the Vessel,
    // so the player is asked to aim. Skipping the win check meant the burial
    // landed, `vesselDamage` reached `vesselClear`, and nothing happened. The
    // only surviving check ran at Dusk, so a won game either ended a full round
    // late or not at all — Doom is tested first, so the Old One's side could take a
    // game the posse had already won.
    checkWin(s, ev);
    s.log.push(...ev);
    return { state: s, events: ev };
  }

  if (playerId !== s.activePlayer) throw new IllegalCommand('Not your turn');

  const p = s.players[playerId];

  switch (c.t) {
    case 'PLAY_CARD': {
      requireAction(s);
      const idx = p.hand.findIndex((ci) => ci.uid === c.uid);
      if (idx === -1) throw new IllegalCommand('Card not in hand');
      const inst = p.hand.splice(idx, 1)[0];
      const def = card(inst.cardId);
      s.actionsLeft--;
      p.discard.push(inst);
      ev.push({ t: 'PLAYED', player: playerId, cardId: def.id, fevered: inst.fevered });
      // One bar, both acts: in Act I this pushes towards the Turning, in Act II
      // towards the next tranche of Doom. Same gesture, same cost, and the
      // player does not have to learn a second rule at the halfway point.
      if (def.whispers) addWhispers(s, def.whispers, ev);
      // A gift used in time pays the giver. Past its round it is simply a card
      // you own, which is the other half of the decision: hold it and it is
      // free, but a Sign you are holding is a Sign you are not playing.
      if (inst.offeredUntil !== undefined && s.round <= inst.offeredUntil) {
        addWhispers(s, s.tuning.offerWhisperReward, ev);
        ev.push({
          t: 'OFFER_TAKEN', player: playerId, cardId: def.id,
          whispers: s.tuning.offerWhisperReward,
        });
      }
      pushOps(s, opsFor(def, inst.fevered, aimsFeveredCards(p.status)), playerId, def.id);
      runQueue(s, ev);
      break;
    }

    case 'SPEND_GRIT': {
      let total = 0;
      const cashed: CardId[] = [];
      for (const uid of c.uids) {
        const idx = p.hand.findIndex((ci) => ci.uid === uid);
        if (idx === -1) throw new IllegalCommand('Card not in hand');
        const inst = p.hand.splice(idx, 1)[0];
        total += card(inst.cardId).grit;
        cashed.push(inst.cardId);
        p.discard.push(inst);
      }
      p.gritThisTurn += total;
      ev.push({ t: 'DISCARDED', player: playerId, n: cashed.length, hand: false });
      ev.push({ t: 'GRIT', player: playerId, amount: total, cards: cashed });
      break;
    }

    case 'BUY': {
      requireAction(s);
      const def = card(c.cardId);
      if (def.cost === undefined) throw new IllegalCommand('Not purchasable');
      if (p.gritThisTurn < def.cost) throw new IllegalCommand('Not enough Grit');
      if (p.status !== 'posse') throw new IllegalCommand('Only the posse may buy');

      if (def.type === 'sign') {
        p.discard.push(newInstance(s, def.id, s.act === 'mythos'));
        // Act II: Provisions have run dry by design, so Signs are the only
        // thing left to buy — and a Sign bought after the Turning arms the
        // thing across the table. Before it, Whispers are still charged on
        // PLAY and buying is free; that rule is what stops Sign-hoarding being
        // the dominant Act I line and it is untouched here.
        if (s.act === 'mythos' && def.whispers) {
          addWhispers(s, def.whispers, ev);
        }
      } else {
        const idx = s.supply.provisionRow.findIndex((ci) => ci.cardId === def.id);
        if (idx === -1) throw new IllegalCommand('Not in the Provision row');
        p.discard.push(...s.supply.provisionRow.splice(idx, 1));
        const next = s.supply.provisions.shift();
        if (next) s.supply.provisionRow.push(next);
      }
      p.gritThisTurn -= def.cost;
      s.actionsLeft--;
      // A Beckoned player is paid for taking the bait.
      if (def.type === 'sign' && s.beckoned === playerId) {
        p.gritThisTurn += s.tuning.beckonGrit;
        s.beckoned = null;
      }
      ev.push({ t: 'BOUGHT', player: playerId, cardId: def.id });
      break;
    }

    /**
     * Pay a Threat's Toll and be rid of it.
     *
     * The replacement for the bare damage action, and the opposite kind of
     * move: that one always worked, cost nothing but an action, and made a
     * blocked Street into three clicks. This one is only ever available when
     * the card offers a price and the player can meet it, and it hurts.
     */
    case 'PAY_TOLL': {
      requireAction(s);
      const sl = s.street[c.slot];
      if (!sl) throw new IllegalCommand('No Threat there');
      const def = card(sl.instance.cardId);
      if (!def.toll?.length) throw new IllegalCommand('That Threat has no Toll');
      if (!canPay(s, playerId, def.toll)) throw new IllegalCommand('You cannot pay it');
      s.actionsLeft--;
      ev.push({ t: 'TOLL_PAID', slot: c.slot, cardId: def.id, player: playerId });
      // Paid first, then removed: a Toll that clears the slot before charging
      // would let a queued op resolve against a Threat that is already gone.
      pushOps(s, def.toll, playerId, def.id);
      runQueue(s, ev);
      clearThreat(s, c.slot, playerId, ev);
      runQueue(s, ev);
      break;
    }

    /**
     * The Revenant's Whisper: burn a card out of your shrinking hand to arm the
     * Vessel.
     *
     * Repointed at the pool rather than the old track — same number, and in Act
     * II that number is ammunition. This is what stops the Vessel going dry if
     * the posse simply refuses to buy Signs: the fallen keep feeding it.
     */
    case 'REVENANT_WHISPER': {
      if (p.status !== 'revenant') throw new IllegalCommand('Not a Revenant');
      requireAction(s);
      const idx = p.hand.findIndex((ci) => ci.uid === c.uid);
      if (idx === -1) throw new IllegalCommand('Card not in hand');
      s.actionsLeft--;
      p.discard.push(...p.hand.splice(idx, 1));
      ev.push({ t: 'DISCARDED', player: playerId, n: 1, hand: false });
      addWhispers(s, 1, ev);
      break;
    }

    /**
     * Beckon: mark a living player, and pay them if they take the bait.
     *
     * The Revenant doing openly what the Marked player does in secret, which is
     * what muddies the read on both.
     */
    case 'BECKON': {
      if (p.status !== 'revenant') throw new IllegalCommand('Not a Revenant');
      requireAction(s);
      if (s.players[c.target]?.status !== 'posse') {
        throw new IllegalCommand('Not a living member of the posse');
      }
      s.actionsLeft--;
      s.beckoned = c.target;
      ev.push({ t: 'BECKONED', by: playerId, target: c.target });
      break;
    }

    case 'END_TURN':
      endTurn(s, ev);
      break;

    case 'RESOLVE_CHOICE':
      throw new IllegalCommand('No choice pending');
  }

  checkTurning(s, ev);
  checkWin(s, ev);
  s.log.push(...ev);
  return { state: s, events: ev };
}

function requireAction(s: GameState): void {
  if (s.actionsLeft <= 0) throw new IllegalCommand('No actions left');
}
export function addDoom(s: GameState, n: number, ev: GameEvent[]): void {
  s.doom += n;
  ev.push({ t: 'DOOM', delta: n, total: s.doom });
}

// ---------------------------------------------------------------------------
// Round structure
// ---------------------------------------------------------------------------

export function beginRound(s: GameState, ev: GameEvent[]): void {
  s.round++;
  s.phase = 'dawn';
  // A cancelled Menace lasts the round, not the game.
  for (const sl of s.street) if (sl) sl.menaceCancelled = false;
  ev.push({ t: 'PHASE', phase: 'dawn', round: s.round });

  for (let i = 0; i < threatsThisRound(s); i++) {
    const entering = drawThreat(s);
    if (!entering) break;

    // One arrival rule, shared with SOMETHING COMES UP THE STREET. Overflow
    // and all — see `enterStreet`.
    enterStreet(s, entering, ev);
  }

  s.phase = 'day';
  s.activePlayer = s.turnOrder[0];
  startTurn(s, ev);
}

/**
 * How many Threats arrive this Dawn.
 *
 * Scales with the table, because the actions do: at three players the posse
 * brings nine actions to bear on the Street and at five it brings fifteen, and
 * a flat one Threat a round meant the first player to draw well cleared it and
 * everyone after them had nothing to do.
 */
function threatsThisRound(s: GameState): number {
  const living = livingPlayers(s).length || s.turnOrder.length;
  const t = s.tuning;
  return Math.max(
    t.threatsMin,
    Math.round(living * t.threatsPerRound) - t.threatsOffset,
  );
}

/**
 * The next Threat for this act, reshuffling a spent deck if allowed.
 *
 * Returns null when the act has genuinely run out of Threats — which, with
 * recycling on, only happens if every card is somehow in the Street at once.
 */
function drawThreat(s: GameState): CardInstance | null {
  const trouble = s.act === 'trouble';
  const deck = trouble ? s.supply.trouble : s.supply.mythos;
  const discard = trouble ? s.supply.troubleDiscard : s.supply.mythosDiscard;
  const recycle = trouble ? s.tuning.recycleTrouble : s.tuning.recycleMythos;

  if (!deck.length && recycle && discard.length) {
    const r = shuffle(discard, s.seed, s.rngCursor);
    s.rngCursor = r.cursor;
    if (trouble) { s.supply.trouble = r.items; s.supply.troubleDiscard = []; }
    else { s.supply.mythos = r.items; s.supply.mythosDiscard = []; }
  }
  const live = trouble ? s.supply.trouble : s.supply.mythos;
  return live.length ? live.shift()! : null;
}

/**
 * A Threat that survived the day grows.
 *
 * Per slot, never per card — see StreetSlot.escalation. A Threat that cannot be
 * cleared does not escalate at all by default: its Clear is unpayable, so the
 * only thing that could move is its Menace, and nothing on the table can ever
 * make it stop.
 */


function startTurn(s: GameState, ev: GameEvent[]): void {
  const p = s.players[s.activePlayer];
  // Act I Bounties can bank Grit for a player's next turn.
  p.gritThisTurn = s.nextTurnGrit[p.id] ?? 0;
  delete s.nextTurnGrit[p.id];
  if (p.status === 'gone') { advance(s, ev); return; }
  s.actionsLeft =
    p.status === 'revenant' ? s.tuning.revenantActions : s.tuning.actionsPerTurn;
  drawCards(s, p.id, s.tuning.handSize - p.hand.length, ev);
  // A Revenant can burn out on the very draw that starts their turn. Do not
  // leave the turn resting on someone who no longer exists. (Read through the
  // map, not `p` — drawCards mutates the status behind TypeScript's narrowing.)
  if (s.players[s.activePlayer].status === 'gone') { advance(s, ev); return; }
}

function endTurn(s: GameState, ev: GameEvent[]): void {
  const p = s.players[s.activePlayer];
  if (s.beckoned === p.id) s.beckoned = null;
  if (p.hand.length) {
    ev.push({ t: 'DISCARDED', player: p.id, n: p.hand.length, hand: true });
  }
  p.discard.push(...p.hand);
  p.hand = [];
  p.gritThisTurn = 0;
  advance(s, ev);
}

function advance(s: GameState, ev: GameEvent[]): void {
  /*
    Nobody left who can take a turn.

    `startTurn` skips a `gone` seat by calling `advance`, and `advance` walks to
    the next seat or into Dusk, which rolls the round and starts again. With
    every seat gone that is unbounded mutual recursion — Dusk after Dusk with
    nobody to end a turn — and it dies on the stack rather than hanging, which
    is at least loud.

    `checkWin` cannot catch it: it runs after `applyInner` RETURNS, and this
    never returns. So the bail-out has to be here.

    Surfaced by driving the simulator with the real policy rather than random
    legal moves; random play never emptied the table.
  */
  if (!s.turnOrder.some((id) => s.players[id].status !== 'gone')) {
    if (!s.winner) {
      s.winner = 'oldOne';
      ev.push({ t: 'GAME_OVER', winner: 'oldOne' });
    }
    return;
  }
  const i = s.turnOrder.indexOf(s.activePlayer);
  if (i === s.turnOrder.length - 1) { dusk(s, ev); return; }
  s.activePlayer = s.turnOrder[i + 1];
  startTurn(s, ev);
}

function dusk(s: GameState, ev: GameEvent[]): void {
  s.phase = 'dusk';
  ev.push({ t: 'PHASE', phase: 'dusk', round: s.round });

  s.street.forEach((sl, i) => {
    if (!sl) return;
    if (card(sl.instance.cardId).type === 'omen') {
      // Omens drip in both acts: towards the Turning, then towards Doom.
      addWhispers(s, s.tuning.omenWhispersPerRound, ev);
    }
    // Omens resolve Menace through the same path; theirs comes from TUNING.
    resolveMenace(s, i, ev);
    if (s.act === 'mythos') addDoom(s, 1, ev);
  });

  // Everything still standing at the end of Dusk grows. After the Menace has
  // landed, so a Threat never hits on the round it arrived at its new value.
  s.street.forEach((sl, i) => { if (sl) escalate(s, i, ev); });

  checkTurning(s, ev);
  checkWin(s, ev);
  if (!s.winner) beginRound(s, ev);
}


// ---------------------------------------------------------------------------
// The Turning
// ---------------------------------------------------------------------------

export function checkTurning(s: GameState, ev: GameEvent[]): void {
  if (s.act !== 'trouble') return;
  // The Long Season ends either because someone couldn't resist, or because it
  // simply ran out — without the second, a table that buys no Signs never Turns
  // and the game has no ending at all.
  const resisted = s.whispers >= s.tuning.whisperThreshold;
  const seasonOver = s.tuning.turnOnTroubleExhausted
    && s.supply.trouble.length === 0 && s.supply.troubleDiscard.length === 0;
  if (!resisted && !seasonOver) return;

  const living = livingPlayers(s);
  const marked = s.turnOrder.find((id) => s.players[id].role === 'marked') ?? null;
  const candidates = living.length ? living : s.turnOrder;
  let vessel = candidates.reduce((a, b) => {
    const d = signsHeld(s, b) - signsHeld(s, a);
    if (d > 0) return b;
    if (d === 0 && b === marked) return b;
    return a;
  });

  s.vessel = vessel;
  s.players[vessel].status = 'vessel';
  /*
    The Vessel's deck is replaced — but it KEEPS its own Signs.

    That is the one idea worth preserving from the old design: the more corrupt
    a player was, the more of their own purchases are in the thing now hunting
    the table. A Puritan Vessel gets the fixed ten and nothing else, which is a
    real difference in how the seat plays and a real consequence of Act I.

    Everything that is not a Sign is boneyarded. Hand and discard are swept in
    too, so a Sign in hand at the Turning is not quietly lost.
  */
  {
    const v = s.players[vessel];
    const all = [...v.deck, ...v.hand, ...v.discard];
    const kept = all
      .filter((ci) => card(ci.cardId).type === 'sign')
      .map((ci) => ({ ...ci, fevered: true }));
    v.boneyard.push(...all.filter((ci) => card(ci.cardId).type !== 'sign'));
    const fixed: CardInstance[] = [];
    for (const [id, n] of Object.entries(s.tuning.vesselDeck)) {
      for (let i = 0; i < n; i++) fixed.push(newInstance(s, id));
    }
    const r = shuffle([...fixed, ...kept], s.seed, s.rngCursor);
    s.rngCursor = r.cursor;
    v.deck = r.items;
    v.hand = [];
    v.discard = [];
    /*
      Deal them in immediately.

      `checkTurning` runs at the END of the command, by which point `endTurn`
      has already advanced the turn and `startTurn` has dealt a hand — from the
      OLD deck, which is then thrown away three lines above. Without this the
      Vessel spends its very first turn holding nothing, which reads as the new
      deck being broken rather than as a turn-order accident.
    */
    drawCards(s, vessel, s.tuning.handSize, ev);
  }
  if (marked) s.revealedRoles.push(marked);
  if (!s.revealedRoles.includes(vessel)) s.revealedRoles.push(vessel);

  // Every Sign everywhere turns. Permanently.
  for (const pid of s.turnOrder) {
    const p = s.players[pid];
    for (const pile of [p.deck, p.hand, p.discard]) {
      for (const ci of pile) {
        if (card(ci.cardId).type === 'sign') ci.fevered = true;
      }
    }
  }
  // "Every Trouble card still in the Street flips to its reverse. Cards with no
  // reverse stay as they are." The reverses are real cards, not a Menace bonus.
  for (const sl of s.street) {
    if (!sl) continue;
    sl.turned = true;
    const rev = card(sl.instance.cardId).reverse;
    if (rev) sl.instance = { ...sl.instance, cardId: rev };
  }

  s.supply.trouble = [];
  s.act = 'mythos';
  // The bar has done its Act I job. It empties and starts again — same
  // threshold, so it looks identical, but filling faster (whisperRateMythos)
  // and into escalating Doom rather than into the Turning.
  s.whispers = 0;
  s.whisperFills = 0;

  // "Doom begins at 3. If the Marked player achieved their secret aim, it
  // begins at 6." The aim: at the Turning, two OTHER players each hold 3+ Signs.
  const encouraged = marked
    ? s.turnOrder.filter((id) => id !== marked && signsHeld(s, id) >= AIM_SIGNS).length
    : 0;
  const aimMet = marked !== null && encouraged >= AIM_PLAYERS;
  s.doom = 3 + (aimMet ? s.tuning.markedAimDoomBonus : 0);
  ev.push({ t: 'TURNING', vessel, marked: marked ?? vessel, aimMet });
}

export function checkWin(s: GameState, ev: GameEvent[]): void {
  if (s.winner) return;
  if (s.doom >= s.tuning.doomTarget) {
    s.winner = 'oldOne';
  } else if (s.act === 'mythos' && s.vesselDamage >= s.tuning.vesselClear) {
    s.winner = 'posse';
  } else if (s.act === 'mythos' && livingPlayers(s).filter((id) => s.players[id].status === 'posse').length === 0) {
    s.winner = 'oldOne';
  } else if (s.act === 'trouble' && s.supply.trouble.length === 0 && s.round > 0 &&
             livingPlayers(s).length === 0) {
    s.winner = 'oldOne';
  }
  if (s.winner) {
    s.phase = 'over';
    // A choice cannot outlive the game. `apply` refuses everything once there
    // is a winner, so a prompt left standing is one the client would offer and
    // the server would then reject for ever.
    s.pending = null;
    s.resolution = null;
    ev.push({ t: 'GAME_OVER', winner: s.winner });
  }
}

/** Kick off round 1. Call once after setup(). */
export function start(state: GameState): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(state);
  const ev: GameEvent[] = [];
  beginRound(s, ev);
  s.log.push(...ev);
  return { state: s, events: ev };
}
