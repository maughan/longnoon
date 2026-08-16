import type {
  GameState, Command, PlayerId, GameEvent, CardInstance,
} from './state';
import { card } from '../content/cards';
import { shuffle } from './rng';
import {
  opsFor, pushOps, runQueue, resolveChoice, drawCards, damagePlayer,
  livingPlayers, addWhispers, spendWhispers, newInstance, signsHeld,
  onThreatEntered, pickExtreme, deckSize, retire,
  effectiveClear, effectiveMenace, canPay, clearThreat,
} from './effects';

/**
 * The fallen aim their own Fevered cards. Paper rules, Old One: "now you aim
 * them again"; Revenant: "play a Fevered card (you choose all targets)".
 */
/** The Marked player's secret aim, as printed on the role card. */
const AIM_PLAYERS = 2;
const AIM_SIGNS = 3;

const aimsFeveredCards = (status: string): boolean =>
  status === 'oldOne' || status === 'revenant';

export class IllegalCommand extends Error {}

/** Pure: clones, mutates the clone, returns it with the events emitted. */
export function apply(
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
    // late or not at all — Doom is tested first, so the Old One could take a
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
      for (const uid of c.uids) {
        const idx = p.hand.findIndex((ci) => ci.uid === uid);
        if (idx === -1) throw new IllegalCommand('Card not in hand');
        const inst = p.hand.splice(idx, 1)[0];
        total += card(inst.cardId).grit;
        p.discard.push(inst);
      }
      p.gritThisTurn += total;
      ev.push({ t: 'GRIT', player: playerId, amount: total });
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
     * Old One.
     *
     * Repointed at the pool rather than the old track — same number, and in Act
     * II that number is ammunition. This is what stops the Old One going dry if
     * the posse simply refuses to buy Signs: the fallen keep feeding it.
     */
    case 'REVENANT_WHISPER': {
      if (p.status !== 'revenant') throw new IllegalCommand('Not a Revenant');
      requireAction(s);
      const idx = p.hand.findIndex((ci) => ci.uid === c.uid);
      if (idx === -1) throw new IllegalCommand('Card not in hand');
      s.actionsLeft--;
      p.discard.push(...p.hand.splice(idx, 1));
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

    case 'SUMMON': {
      requireOldOne(s, playerId);
      requireAction(s);
      s.actionsLeft--;
      const next = s.supply.mythos.shift();
      if (next && s.street[c.slot] === null) {
        s.street[c.slot] = {
          instance: next, damage: 0, turned: false,
          enteredRound: s.round, escalation: 0,
        };
        ev.push({ t: 'THREAT_ENTERED', slot: c.slot, cardId: next.cardId });
        onThreatEntered(s, next.cardId, ev);
      }
      break;
    }

    /**
     * Close off a card type for a round.
     *
     * Replaces WHISPER as the Old One's every-turn move, and the difference is
     * the point: WHISPER moved a number nobody could argue with and touched no
     * player. This changes what four people can do with their hands.
     */
    case 'SHUTTER': {
      requireOldOne(s, playerId);
      requireAction(s);
      s.actionsLeft--;
      const until = s.round + s.tuning.shutterDuration;
      s.shuttered = { type: c.cardType, untilRound: until };
      ev.push({ t: 'SHUTTERED', cardType: c.cardType, untilRound: until });
      break;
    }

    /**
     * A gift, with a string on it.
     *
     * Free power to a player who needs it, and the Old One is paid if they use
     * it soon. Refusing costs them the card; taking it costs everyone else.
     */
    case 'OFFER': {
      requireOldOne(s, playerId);
      requireAction(s);
      const target = s.players[c.target];
      if (!target || target.status !== 'posse') {
        throw new IllegalCommand('Not a living member of the posse');
      }
      if (card(c.cardId).type !== 'sign') throw new IllegalCommand('Signs only');
      s.actionsLeft--;
      const gift = newInstance(s, c.cardId);
      // Act II: every Sign everywhere is already Fevered, and a gift from this
      // quarter would hardly arrive clean.
      gift.fevered = true;
      gift.offeredUntil = s.round + 1;
      target.discard.push(gift);
      ev.push({ t: 'OFFERED', by: playerId, target: c.target, cardId: c.cardId });
      break;
    }

    case 'CALL': {
      requireOldOne(s, playerId);
      requireAction(s);
      // Whispers are the ammunition now. In Act II the track has already
      // fired, so what accumulates after it is a pool this seat spends.
      if (s.whispers < s.tuning.callWhisperCost) {
        throw new IllegalCommand('Not enough Whispers');
      }
      spendWhispers(s, s.tuning.callWhisperCost, ev);
      s.actionsLeft--;
      const t = s.players[c.target];
      const top = t.deck.shift();
      if (top) {
        t.discard.push(top);
        const def = card(top.cardId);
        if (def.type === 'sign') {
          pushOps(s, opsFor(def, true), playerId, def.id);
          runQueue(s, ev);
        }
      }
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
function requireOldOne(s: GameState, pid: PlayerId): void {
  if (s.players[pid].status !== 'oldOne') throw new IllegalCommand('Not the Old One');
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

    const slot = s.street.findIndex((x) => x === null);
    if (slot === -1) {
      // Overflow. The oldest Threat takes its Menace out on the table and then
      // STAYS, one step worse. It used to be discarded, which meant a swamped
      // Street cleaned itself up — the punishment for falling behind was that
      // the problem went away. Getting swamped should compound.
      const oldest = oldestSlot(s);
      resolveMenace(s, oldest, ev);
      escalate(s, oldest, ev);
      // The arriving Threat has nowhere to stand, so it never enters. Retired
      // rather than dropped, so the recycle economy still sees it.
      retire(s, entering);
      continue;
    }

    s.street[slot] = {
      instance: entering, damage: 0, turned: false,
      enteredRound: s.round, escalation: 0,
    };
    ev.push({ t: 'THREAT_ENTERED', slot, cardId: entering.cardId });
    onThreatEntered(s, entering.cardId, ev);
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
function escalate(s: GameState, slot: number, ev: GameEvent[]): void {
  const sl = s.street[slot];
  if (!sl || s.tuning.escalationPerRound <= 0) return;
  // Something that cannot be cleared cannot be answered, so growing it is a
  // one-way ratchet on the table. See Tuning.escalateUncleanable.
  if (!s.tuning.escalateUncleanable && effectiveClear(sl) === undefined) return;
  sl.escalation += s.tuning.escalationPerRound;
  ev.push({
    t: 'ESCALATED',
    slot,
    cardId: sl.instance.cardId,
    clear: effectiveClear(sl) ?? null,
    menace: effectiveMenace(sl, s.tuning.omenMenace),
  });
}

function oldestSlot(s: GameState): number {
  let best = 0, oldest = Infinity;
  s.street.forEach((sl, i) => {
    if (sl && sl.enteredRound < oldest) { oldest = sl.enteredRound; best = i; }
  });
  return best;
}

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
  p.discard.push(...p.hand);
  p.hand = [];
  p.gritThisTurn = 0;
  advance(s, ev);
}

function advance(s: GameState, ev: GameEvent[]): void {
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

function resolveMenace(s: GameState, slot: number, ev: GameEvent[]): void {
  const sl = s.street[slot];
  if (!sl) return;
  const def = card(sl.instance.cardId);
  if (sl.menaceCancelled) return; // Night Watch is standing over this one
  const menace = effectiveMenace(sl, s.tuning.omenMenace);
  if (menace <= 0) return;
  const targets = livingPlayers(s);
  if (!targets.length) return;

  // Menace lands on whoever holds the most Signs — corruption draws attention —
  // unless the card names someone else. Ties break at random, never by seat: a
  // first-match rule sends every point of damage to the same player all game
  // whenever Signs are level, and cascades it down the table.
  const aim = def.menaceTarget ?? 'mostSigns';
  const victims =
    aim === 'all' ? targets
    : aim === 'fewestCards'
      ? [pickExtreme(s, targets, (id) => deckSize(s, id), false)!]
      : [pickExtreme(s, targets, (id) => signsHeld(s, id), true)!];

  for (const victim of victims) {
    // The wound deepens with the corruption that drew it.
    const extra = Math.floor(signsHeld(s, victim) * s.tuning.menacePerSign);
    const total = menace * s.tuning.damagePerHit + extra;
    ev.push({ t: 'MENACE', slot, cardId: def.id, player: victim, amount: total });
    damagePlayer(s, victim, total, ev);
  }
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
  s.players[vessel].status = 'oldOne';
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
  // The track has fired; what it held is spent on the door opening. What
  // accumulates from here is a pool the Old One draws on, and it starts empty
  // so the posse's Act II choices are what fills it.
  s.whispers = 0;
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
