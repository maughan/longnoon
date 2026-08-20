import type {
  GameState, Command, PlayerId, GameEvent, CardInstance, CardId,
} from './state';
import { card, BECKON_CARD_ID } from '../content/cards';
import { shuffle } from './rng';
import {
  opsFor, pushOps, runQueue, resolveChoice, drawCards,
  livingPlayers, addWhispers, assertWhisperInvariants, newInstance, signsHeld,
  canPay, clearThreat, enterStreet, resolveMenace, escalate, effectiveClear,
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
      // A granted card goes nowhere. It was never in the deck, so putting it in
      // the discard would deal the Revenant a card of health they never had —
      // and one that comes round again every recycle, which is the opposite of
      // a clock that shrinks.
      if (def.type !== 'revenant') p.discard.push(inst);
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
      // Grit is the limit, unless the tuning says actions are too.
      if (s.tuning.buyCostsAction) requireAction(s);
      const def = card(c.cardId);
      if (def.cost === undefined) throw new IllegalCommand('Not purchasable');
      if (p.gritThisTurn < def.cost) throw new IllegalCommand('Not enough Grit');
      if (p.status !== 'posse') throw new IllegalCommand('Only the posse may buy');

      // Where a purchase lands. To hand it is usable this turn; to the discard
      // it is a promise about a future shuffle.
      const into = s.tuning.buyToHand ? p.hand : p.discard;
      // Bought into a hand it is stamped, so it cannot be sold back the same
      // turn. See `CardInstance.boughtRound` for the loop that stops.
      const stamp = (ci: CardInstance): CardInstance =>
        (s.tuning.buyToHand ? Object.assign(ci, { boughtRound: s.round }) : ci);
      if (def.type === 'sign') {
        into.push(stamp(newInstance(s, def.id, s.act === 'mythos')));
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
        into.push(...s.supply.provisionRow.splice(idx, 1).map(stamp));
        const next = s.supply.provisions.shift();
        if (next) s.supply.provisionRow.push(next);
      }
      p.gritThisTurn -= def.cost;
      if (s.tuning.buyCostsAction) s.actionsLeft--;
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
     * The Vessel burns a Sign for a Whisper.
     *
     * What the kept Signs were always reaching for and never delivered: a
     * Sign-heavy Act I arming the Old One's Act II. Most of them face the
     * STREET — a Fevered Colt in this hand destroys a Threat for the posse —
     * and the seat cannot cash a card in, so without this they are dead paper
     * on 37% of the deck.
     *
     * Signs only. The Old One's own cards are not corruption to burn, and
     * letting the seat feed the track with them would make Whispers a resource
     * it prints rather than one the table handed over.
     */
    case 'BURN_SIGN': {
      if (p.status !== 'vessel') throw new IllegalCommand('Not the Vessel');
      requireAction(s);
      const idx = p.hand.findIndex((ci) => ci.uid === c.uid);
      if (idx === -1) throw new IllegalCommand('Card not in hand');
      const inst = p.hand[idx]!;
      if (card(inst.cardId).type !== 'sign') throw new IllegalCommand('Not a Sign');
      s.actionsLeft--;
      // To the boneyard, not the discard: it is burned, and the Vessel's deck
      // is rebuilt from what is left, so a discard would deal it back round.
      p.boneyard.push(...p.hand.splice(idx, 1));
      ev.push({ t: 'DISCARDED', player: playerId, n: 1, hand: false });
      addWhispers(s, s.tuning.vesselSignWhispers, ev);
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
  // Whoever is first this round. Fixed at seat 0 unless the table rotates.
  s.activePlayer = s.turnOrder[s.startSeat] ?? s.turnOrder[0];
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
  // Act I Bounties can bank Grit for a player's next turn. Added to whatever
  // survived the end of the last one, rather than replacing it — a banked
  // Bounty and carried change are the same coins.
  p.gritThisTurn = (s.tuning.gritCarries ? p.gritThisTurn : 0)
    + (s.nextTurnGrit[p.id] ?? 0);
  delete s.nextTurnGrit[p.id];
  if (p.status === 'gone') { advance(s, ev); return; }
  s.actionsLeft =
    p.status === 'revenant' ? s.tuning.revenantActions : s.tuning.actionsPerTurn;
  /*
    Nothing on the board to act against — deal one.

    Through `drawThreat` + `enterStreet` like Dawn and SOMETHING COMES UP THE
    STREET, so a Threat arriving this way is an ordinary arrival: same deck,
    same recycling, same events, same overflow rule. A second way of putting a
    card in the Street would be a second set of rules to keep in step.

    Before the draw, so the hand is dealt into a board that already has the
    Threat on it — a card whose only op needs a target is otherwise unplayable
    on the turn it arrives.
  */
  const bare = s.tuning.refillNoClearable
    // Nothing anybody could shoot off the board — an Omen-only Street is a full
    // board with nothing to do on it, and reads worse than an empty one.
    ? !s.street.some((sl) => sl && effectiveClear(sl) !== undefined)
    : s.tuning.refillEmptyStreet && s.street.every((sl) => sl === null);
  if (bare) {
    const entering = drawThreat(s);
    if (entering) enterStreet(s, entering, ev);
  }
  drawCards(s, p.id, s.tuning.handSize - p.hand.length, ev);
  // A Revenant can burn out on the very draw that starts their turn. Do not
  // leave the turn resting on someone who no longer exists. (Read through the
  // map, not `p` — drawCards mutates the status behind TypeScript's narrowing.)
  if (s.players[s.activePlayer].status === 'gone') { advance(s, ev); return; }
  grantRevenantCard(s);
}

/**
 * The fallen's one card, put in their hand for the turn.
 *
 * After the draw, deliberately: counted before it, it would come out of
 * `handSize` and cost the Revenant a real card every turn. Swept unplayed at
 * the end of the turn and granted again at the start of the next, so it can
 * neither be hoarded nor lost.
 */
function grantRevenantCard(s: GameState): void {
  const p = s.players[s.activePlayer];
  if (p.status !== 'revenant') return;
  if (p.hand.some((ci) => ci.cardId === BECKON_CARD_ID)) return;
  p.hand.push(newInstance(s, BECKON_CARD_ID, false));
}

function endTurn(s: GameState, ev: GameEvent[]): void {
  const p = s.players[s.activePlayer];
  if (s.beckoned === p.id) s.beckoned = null;
  // The granted card is not theirs to discard — see `grantRevenantCard`. Taken
  // out before the count, or the sweep would announce a card that went nowhere.
  const swept = p.hand.filter((ci) => card(ci.cardId).type !== 'revenant');
  if (swept.length) {
    ev.push({ t: 'DISCARDED', player: p.id, n: swept.length, hand: true });
  }
  p.discard.push(...swept);
  p.hand = [];
  if (!s.tuning.gritCarries) p.gritThisTurn = 0;
  /*
    Draw now, so the hand is on the table while everybody else plays.

    `startTurn` still tops up to `handSize`, which is a no-op once this has run
    — that is deliberate rather than redundant. It is what deals the opening
    hand, and what refills a hand that damage emptied between turns.

    Before `advance`, so a Revenant who burns out on this draw is already `gone`
    when the turn moves on and is skipped like any other empty chair.
  */
  if (s.tuning.drawAtEndOfTurn && p.status !== 'gone') {
    drawCards(s, p.id, s.tuning.handSize - p.hand.length, ev);
  }
  advance(s, ev);
}

/**
 * Move the button one chair, and never onto the player who just closed the
 * round.
 *
 * The trap, and it is not hypothetical: rotating by one means the seat that
 * acted LAST becomes the seat that acts FIRST as soon as only two are still
 * taking turns — 1 posse and the Vessel is the ordinary end state of Act II —
 * so that player takes three actions, the sun goes down, and they take three
 * more before anybody can answer. It also happens at three seats the moment one
 * of them falls, so a rule counting living players would not catch it.
 *
 * Stated as the thing that is actually wrong instead: the round may not begin
 * with whoever ended the last one. At two players that resolves to "do not
 * rotate", which is correct — with two seats there is no rotation that does not
 * double somebody — and it falls out rather than being special-cased.
 */
function rotateStart(s: GameState): void {
  const n = s.turnOrder.length;
  const acting = (i: number) => s.players[s.turnOrder[i % n]!]!.status !== 'gone';
  const firstFrom = (from: number) => {
    for (let k = 0; k < n; k++) if (acting(from + k)) return (from + k) % n;
    return from % n;
  };
  const living = s.turnOrder.filter((id) => s.players[id].status !== 'gone');
  s.startSeat = (s.startSeat + 1) % n;
  if (living.length < 2) return;
  /*
    Resolve to a seat that is actually playing, THEN check it — and step past
    the RESOLVED seat, not past the raw index.

    Stepping from the raw index was wrong in the exact case this rule exists
    for: with two living seats either side of a gone one, `startSeat + 1` can
    resolve forward onto the very player it was trying to skip, and they take
    the last turn of one round and the first of the next anyway. The simulator
    trace read `p3@r2 p3@r3`.
  */
  let seat = firstFrom(s.startSeat);
  if (s.turnOrder[seat] === s.lastRoundActor) seat = firstFrom(seat + 1);
  s.startSeat = seat;
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
  /*
    The round ends when the turn comes back round to whoever began it.

    Written against `startSeat` rather than against the end of the array, so
    rotation needs no second rule — with `startSeat` at 0 this is exactly the
    old "the last seat in the list ends the round".
  */
  const n = s.turnOrder.length;
  const i = s.turnOrder.indexOf(s.activePlayer);
  const next = (i + 1) % n;
  if (next === (s.startSeat % n)) { dusk(s, ev); return; }
  s.activePlayer = s.turnOrder[next];
  startTurn(s, ev);
}

function dusk(s: GameState, ev: GameEvent[]): void {
  /*
    The button passes when the round ENDS, not when the next one begins.

    In `beginRound` it also fired for the opening deal — `start` runs one — so
    the very first round of the game began on the second chair. The person who
    sat down first should go first; rotation is what happens afterwards.
  */
  s.lastRoundActor = s.activePlayer;
  if (s.tuning.rotateStart) rotateStart(s);
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

/**
 * `forceVessel` is the development tool's seam, and the only caller that ever
 * passes it. Ordinary play never names the Vessel — that is the whole point of
 * the seat — so the parameter exists so the dev panel can say "turn, and make
 * ME the Vessel" through the real Turning rather than through a second,
 * half-right implementation of it. See `GameRoom.devForceTurning`.
 */
export function checkTurning(
  s: GameState, ev: GameEvent[], forceVessel?: PlayerId,
): void {
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
  const chosen = candidates.reduce((a, b) => {
    const d = signsHeld(s, b) - signsHeld(s, a);
    if (d > 0) return b;
    if (d === 0 && b === marked) return b;
    return a;
  });
  const vessel = forceVessel && s.players[forceVessel] ? forceVessel : chosen;

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
    const signs = all.filter((ci) => card(ci.cardId).type === 'sign');
    v.boneyard.push(...all.filter((ci) => card(ci.cardId).type !== 'sign'));
    const fixed: CardInstance[] = [];
    for (const [id, n] of Object.entries(s.tuning.vesselDeck)) {
      for (let i = 0; i < n; i++) fixed.push(newInstance(s, id));
    }
    /*
      Your Signs, or the same number of the Old One's own cards.

      Kept, they are mostly bricks: a Fevered Colt in this hand destroys a
      Threat FOR the posse, and the Vessel cannot cash a card in either. Traded,
      the arithmetic is unchanged — a corrupt Act I still makes a fatter deck —
      but every card in it does something to the table rather than for it.

      Dealt round-robin off `vesselDeck` rather than at random, so a big trade
      spreads across the five rather than piling into one.
    */
    const ids = Object.keys(s.tuning.vesselDeck);
    const kept = s.tuning.vesselKeepsSigns
      ? signs.map((ci) => ({ ...ci, fevered: true }))
      : signs.map((_, i) => newInstance(s, ids[i % ids.length]!));
    if (!s.tuning.vesselKeepsSigns) v.boneyard.push(...signs);
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
