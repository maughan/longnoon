import type {
  GameState, Op, PlayerId, GameEvent, CardInstance, Card, Target, StreetSlot,
  CardType,
} from './state';
import { card, SIGN_IDS } from '../content/cards';
import { shuffle, randInt } from './rng';
import { IllegalCommand } from './errors';

// ---------------------------------------------------------------------------
// Fevered resolution. This is the schema bet made concrete: three mechanisms,
// no bespoke code per card.
// ---------------------------------------------------------------------------

/**
 * `aimed` is the Vessel's and the Revenant's privilege: the paper rules say
 * they play Fevered cards "targets of your choosing" — "you keep your own deck,
 * all Fevered, and now you aim them again." So the Fevered face still applies
 * its appended costs, but its retargets are dropped and the card is aimable.
 * Cards resolved *against* a player (CALL) are never aimed.
 */
export function opsFor(c: Card, fevered: boolean, aimed = false): Op[] {
  if (!fevered || !c.fevered) return c.ops;
  const f = c.fevered;
  const base = aimed
    ? c.ops
    : c.ops.map((op, i) => {
        const t = f.retarget?.[i];
        if (!t) return op;
        if (!('target' in op)) return op;
        return { ...op, target: t } as Op;
      });
  /*
    Retargets are resolved against `c.ops` above, BEFORE anything is spliced
    around it, so `retarget: { 0: ... }` still means "the first op printed on
    the card" and not "the first op in this array". Prepending would otherwise
    silently shift every index on any card that used both.

    Prepended ops survive `aimed`, like appended ones: the Vessel and the
    Revenants lose the Fevered RETARGETS, not the Fevered costs.
  */
  return [...(f.prependOps ?? []), ...base, ...(f.appendOps ?? [])];
}

export function displayName(c: Card, fevered: boolean): string {
  return fevered && c.fevered ? c.fevered.name : c.name;
}

// ---------------------------------------------------------------------------
// Deck plumbing
// ---------------------------------------------------------------------------

export function livingPlayers(s: GameState): PlayerId[] {
  return s.turnOrder.filter((id) =>
    ['posse', 'vessel'].includes(s.players[id].status));
}

function refill(s: GameState, pid: PlayerId, ev: GameEvent[]): void {
  const p = s.players[pid];
  /*
    The Vessel's deck does not run out.

    Damage trashes cards to the boneyard with no floor on it, so the posse
    could burn the deck away entirely — and a Vessel with nothing in hand,
    deck or discard sits through its own turns doing nothing, which is the
    least frightening thing it could possibly do. Measured at 10 of 534 Act II
    Vessel turns before this.
    
    Rebuilt rather than floored, because a floor only bounds the DECAY path and
    damage is a second way to the same empty pile. This is the intentions of
    the thing behind the door; it does not run low on those.
  */
  if (p.status === 'vessel' && !p.deck.length && !p.discard.length) {
    for (const [id, n] of Object.entries(s.tuning.vesselDeck)) {
      for (let i = 0; i < n; i++) p.discard.push(newInstance(s, id));
    }
    ev.push({ t: 'RESHUFFLED', player: pid, n: p.discard.length });
  }
  if (p.deck.length || !p.discard.length) return;
  const r = shuffle(p.discard, s.seed, s.rngCursor);
  s.rngCursor = r.cursor;
  p.deck = r.items;
  p.discard = [];
  ev.push({ t: 'RESHUFFLED', player: pid, n: p.deck.length });
  // "You shrink." The Vessel floors at one card so the endgame cannot stall;
  // a Revenant is allowed to run out completely — burning out is what replaced
  // burial as the posse's answer to them.
  /*
    Only the Revenants shrink now.

    The Vessel used to as well, for an Act II clock — but a deck that shrinks
    to a floor and a deck that cannot run out are two rules arguing about the
    same pile, and "the Vessel always has something to do" won. The Act II
    clock is Doom and the burial track; it does not need a third.
  */
  const floor = 0;
  if (p.status === 'revenant') {
    for (let i = 0; i < s.tuning.revenantDecay && p.deck.length > floor; i++) {
      p.boneyard.push(p.deck.pop()!);
    }
  }
}

export function drawCards(
  s: GameState, pid: PlayerId, n: number, ev: GameEvent[],
): void {
  const p = s.players[pid];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    refill(s, pid, ev);
    if (!p.deck.length) {
      // The fallen have nothing left to shrink: they are gone for good.
      if (p.status === 'revenant') {
        p.status = 'gone';
        ev.push({ t: 'BURNED_OUT', player: pid });
      } else {
        fall(s, pid, ev);
      }
      break;
    }
    p.hand.push(p.deck.shift()!);
    drawn++;
  }
  if (drawn) ev.push({ t: 'DREW', player: pid, n: drawn });
}

/** Last Words: "when your deck would empty, keep 2 cards instead of falling." */
function lastWordsSaves(s: GameState, pid: PlayerId, ev: GameEvent[]): boolean {
  const p = s.players[pid];
  const piles = [p.deck, p.hand, p.discard];
  for (const pile of piles) {
    const i = pile.findIndex((ci) => ci.cardId === 'last-words');
    if (i === -1) continue;
    const [spent] = pile.splice(i, 1);
    p.boneyard.push(spent);
    // Two cards clawed back out of the boneyard — you are left with something
    // rather than nothing. One use: the card itself is spent doing it.
    const back = p.boneyard.filter((ci) => ci.uid !== spent.uid).slice(-2);
    for (const ci of back) {
      p.boneyard.splice(p.boneyard.indexOf(ci), 1);
      p.deck.push(ci);
    }
    // Fevered, it still saves you — but you do not come back clean.
    if (spent.fevered) {
      p.scars++;
      p.deck.push(newInstance(s, 'scar'));
    }
    ev.push({ t: 'LAST_WORDS', player: pid, fevered: spent.fevered, kept: back.length });
    return true;
  }
  return false;
}

export function fall(s: GameState, pid: PlayerId, ev: GameEvent[]): void {
  const p = s.players[pid];
  if (p.status !== 'posse') return;
  if (lastWordsSaves(s, pid, ev)) return;
  // Keep every Sign (Fevered), trash everything else.
  const all = [...p.deck, ...p.hand, ...p.discard];
  const signs = all.filter((ci) => card(ci.cardId).type === 'sign');
  p.boneyard.push(...all.filter((ci) => card(ci.cardId).type !== 'sign'));
  const r = shuffle(signs.map((ci) => ({ ...ci, fevered: true })), s.seed, s.rngCursor);
  s.rngCursor = r.cursor;
  p.deck = r.items;
  p.hand = [];
  p.discard = [];
  p.status = 'revenant';
  ev.push({ t: 'FELL', player: pid, became: p.status });
}

/**
 * Damage trashes cards off the deck. Non-Signs go first.
 *
 * NOTE: the paper rules contradict themselves here - one line says "Provisions
 * and Kit before Signs", another says Signs can never be trashed at all. Taken
 * literally, the second makes a fully corrupted player immortal. Implemented
 * as: non-Signs first, then Signs once nothing else remains.
 */
export function damagePlayer(
  s: GameState, pid: PlayerId, n: number, ev: GameEvent[],
): void {
  const p = s.players[pid];
  // A Salt Line absorbs damage before any card is lost.
  const shield = s.shields[pid] ?? 0;
  if (shield > 0) {
    const absorbed = Math.min(shield, n);
    s.shields[pid] = shield - absorbed;
    n -= absorbed;
    ev.push({ t: 'PREVENTED', player: pid, amount: absorbed });
    if (n <= 0) return;
  }
  const trashed: string[] = [];
  for (let i = 0; i < n; i++) {
    refill(s, pid, ev);
    if (!p.deck.length) { fall(s, pid, ev); break; }
    // Blind: anything in the deck, uniformly — so a deck that is mostly Signs
    // mostly loses Signs. Last Words is still spared while there is anything
    // else, which is a rule about that card and not about Signs.
    let idx = s.tuning.blindDamage
      ? pickIndex(s, p.deck.map((ci, i) => (ci.cardId === 'last-words' ? -1 : i))
        .filter((i) => i >= 0))
      : p.deck.findIndex((ci) => card(ci.cardId).type !== 'sign');
    // Non-Signs first, then Signs — and Last Words last of all, because being
    // trashed by the damage it exists to survive would make it useless.
    if (idx === -1) idx = p.deck.findIndex((ci) => ci.cardId !== 'last-words');
    if (idx === -1) {
      // Nothing left but the thing keeping you upright. It spends itself.
      if (lastWordsSaves(s, pid, ev)) break;
      idx = 0;
    }
    const [gone] = p.deck.splice(idx, 1);
    p.boneyard.push(gone);
    trashed.push(gone.cardId);
  }
  if (trashed.length) {
    ev.push({ t: 'DAMAGED', player: pid, amount: trashed.length, trashed });
  }
}

export function signsHeld(s: GameState, pid: PlayerId): number {
  const p = s.players[pid];
  return [...p.deck, ...p.hand, ...p.discard]
    .filter((ci) => card(ci.cardId).type === 'sign').length;
}

export function deckSize(s: GameState, pid: PlayerId): number {
  const p = s.players[pid];
  return p.deck.length + p.hand.length + p.discard.length;
}

export function newInstance(s: GameState, cardId: string, fevered = false): CardInstance {
  return { uid: `c${s.uidCounter++}`, cardId, fevered };
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

const SLOT_OPS = new Set(['damage', 'destroy', 'cancelMenace']);

export function isSlotOp(op: Op): boolean {
  return SLOT_OPS.has(op.op);
}

/**
 * Could this op do anything at all right now?
 *
 * Only asks about the STREET. A card whose every op needs a Threat, played at
 * an empty Street, is an action spent to move a card from your hand to your
 * discard — the same waste `legalCommands` already refuses for a card with no
 * ops at all, and the same reason: finding out by pressing the button is the
 * interface explaining the rules after the fact.
 *
 * **Does not touch `resolveSlots`.** `target: 'random'` advances `s.rngCursor`
 * to make its pick, and this is called from `legalCommands` — which runs on
 * every render, for every card, for every seat. Consuming randomness from a
 * question would put the RNG cursor somewhere replay could not follow it, and
 * invariant 1 is the one that cannot be bent. The question is only ever "is
 * there anything in the Street", which needs no roll.
 */
export function hasLiveTarget(s: GameState, op: Op, controller: PlayerId): boolean {
  // The Omen branch of Dynamite. Declining does nothing on its own — the blast
  // that follows is a separate op and is judged on its own merits.
  if (op.op === 'banishOmen') return omenSlots(s).length > 0;
  if (!isSlotOp(op)) return true;
  // `isSlotOp` does not narrow the union, so read the field defensively rather
  // than teaching the type system a second time in a different place.
  if ('target' in op && op.target === 'omen') return omenSlots(s).length > 0;
  // A card aimed at the Vessel has a target with the Street empty, which is
  // most of Act II's endgame: nothing to shoot but the thing you came for.
  if (op.op === 'damage' && vesselTargetable(s) && s.vessel !== controller) return true;
  return occupiedSlots(s).length > 0;
}

// ---------------------------------------------------------------------------
// The Vessel as a target.
//
// The paper rules: "THE POSSE WINS by burying the Vessel: deal 12 total damage
// to the Vessel across any number of turns, while no Omen sits in the Street."
// That is the game's ordinary damage currency, so a card aimed at the Vessel is
// the posse's win condition — not a separate flat action.
// ---------------------------------------------------------------------------

/** The deck currently feeding the Street. */
export function threatDeck(s: GameState): CardInstance[] {
  return s.act === 'trouble' ? s.supply.trouble : s.supply.mythos;
}

/** Whoever scores highest (or lowest), ties broken at random, never by seat. */
export function pickExtreme(
  s: GameState, ids: PlayerId[], score: (id: PlayerId) => number, wantMax: boolean,
): PlayerId | null {
  if (!ids.length) return null;
  const scores = ids.map(score);
  const best = wantMax ? Math.max(...scores) : Math.min(...scores);
  const tied = ids.filter((_, i) => scores[i] === best);
  return tied.length === 1
    ? tied[0]
    : tied[randInt(s.seed, s.rngCursor++, tied.length)];
}

/**
 * One of these indices, at random. `-1` for an empty list, so it falls through
 * to the same "nothing but Last Words left" branch the ordered rule uses.
 *
 * Through `s.rngCursor` like every other roll in the engine — a closure-held
 * RNG is the one thing invariant 1 cannot survive.
 */
function pickIndex(s: GameState, idx: number[]): number {
  if (!idx.length) return -1;
  return idx[randInt(s.seed, s.rngCursor++, idx.length)]!;
}

/**
 * What may come back out of a boneyard.
 *
 * Not Signs. They reach the boneyard only when damage has eaten everything else
 * or a player has fallen, and handing corruption back would make the two
 * recovery cards a way of topping your Signs up rather than of patching a deck.
 */
function recoverable(ci: CardInstance): boolean {
  return card(ci.cardId).type !== 'sign';
}

/** Choice key standing for the Vessel, distinct from numeric slot keys. */
export const VESSEL_KEY = 'vessel';

/**
 * "No thank you" in a modal choice.
 *
 * Not a slot index, so it cannot collide with one, and not the empty string,
 * which a client could send by accident.
 */
export const DECLINE_KEY = 'decline';

/** Types NOT THAT ONE may close. Threats are in nobody's hand; Scars are dead. */
export const SHUTTERABLE: CardType[] = ['kit', 'deed', 'sign'];

/** Is this type currently closed? */
export function shuttered(s: GameState, type: CardType): boolean {
  return s.shuttered !== null && s.shuttered.type === type
    && s.round <= s.shuttered.untilRound;
}

/** A Threat leaving the Street goes back in the box, or back in the deck. */
export function retire(s: GameState, inst: CardInstance): void {
  const type = card(inst.cardId).type;
  if (s.tuning.recycleTrouble && (type === 'trouble' || type === 'omen')) {
    s.supply.troubleDiscard.push(inst);
  }
  if (s.tuning.recycleMythos && type === 'mythos') {
    s.supply.mythosDiscard.push(inst);
  }
}

export function omenInStreet(s: GameState): boolean {
  return s.street.some((sl) => sl !== null && card(sl.instance.cardId).type === 'omen');
}

/** Omens gate burial. They cannot be cleared, so only overflow opens a window. */
export function burialBlocked(s: GameState): boolean {
  return s.tuning.omensBlockBurial && omenInStreet(s);
}

export function vesselTargetable(s: GameState): boolean {
  return s.act === 'mythos' && s.vessel !== null && !burialBlocked(s);
}

/**
 * Only the living posse can bury the Vessel — "THE POSSE WINS by burying the
 * Vessel". The Vessel will not wound itself, and a Revenant wins only if the
 * Old One's side does, so neither contributes even when holding a card that
 * would.
 */
export function damageVessel(
  s: GameState, n: number, by: PlayerId, ev: GameEvent[],
): void {
  if (!vesselTargetable(s) || n <= 0) return;
  if (s.players[by]?.status !== 'posse') return;
  s.vesselDamage += n;
  ev.push({ t: 'VESSEL_DAMAGED', amount: n, total: s.vesselDamage, by });
}

/**
 * "Damage to the Vessel resets to 0 if an Omen enters." Call on every path that
 * puts a card into the Street.
 */
export function onThreatEntered(s: GameState, cardId: string, ev: GameEvent[]): void {
  if (card(cardId).type !== 'omen' || s.vesselDamage === 0) return;
  ev.push({ t: 'VESSEL_DAMAGE_RESET', cardId, lost: s.vesselDamage });
  s.vesselDamage = 0;
}

function occupiedSlots(s: GameState): number[] {
  return s.street
    .map((sl, i) => (sl ? i : -1))
    .filter((i) => i >= 0 && card(s.street[i]!.instance.cardId).type !== 'omen');
}

/** The exact inverse: Omens only. Nothing but `banishOmen` may touch these. */
export function omenSlots(s: GameState): number[] {
  return s.street
    .map((sl, i) => (sl ? i : -1))
    .filter((i) => i >= 0 && card(s.street[i]!.instance.cardId).type === 'omen');
}

/**
 * Which Street slots an op with this target reaches.
 *
 * One function, because this arithmetic used to be three copies of a ternary
 * chain — in `damage`, in `destroy` and in `cancelMenace` — and each one knew
 * about a different subset of the targets.
 *
 * **Mutates `s.rngCursor` for `random`.** That is deliberate and it is why this
 * takes the whole state: the draw has to come off the state cursor or a replay
 * picks a different slot and the game stops reconstructing. `Math.random` is
 * banned here by `npm run lint:determinism`, but the lint cannot catch a
 * closure-held generator, so the rule is that randomness lives in `GameState`.
 */
export function resolveSlots(s: GameState, target: Target): number[] {
  const open = occupiedSlots(s);
  switch (target) {
    case 'omen': return omenSlots(s);
    case 'all': return open;
    case 'leftmostSlot': return open.slice(0, 1);
    case 'lowestClear': {
      if (!open.length) return [];
      // Effective, not printed. A Threat that has grown from Clear 4 to 6 since
      // it arrived is not the easy one any more, and reading `card.clear` here
      // would send the shot at it anyway.
      return [open.reduce((a, b) =>
        (effectiveClear(s.street[b]!) ?? Infinity) < (effectiveClear(s.street[a]!) ?? Infinity)
          ? b : a)];
    }
    case 'random': {
      if (!open.length) return [];
      const pick = open[randInt(s.seed, s.rngCursor, open.length)]!;
      s.rngCursor += 1;
      return [pick];
    }
    case 'itChooses': return resolveSlots(s, s.tuning.coltFeveredTarget);
    default: return [];
  }
}

export function resolvePlayers(
  s: GameState, target: Target, controller: PlayerId,
): PlayerId[] {
  const living = livingPlayers(s);
  switch (target) {
    case 'self': return [controller];
    case 'all': return living;
    case 'left': {
      const order = s.turnOrder.filter((id) => s.players[id].status !== 'gone');
      const i = order.indexOf(controller);
      return i === -1 || order.length < 2 ? [controller] : [order[(i + 1) % order.length]];
    }
    case 'mostSigns': {
      if (!living.length) return [];
      return [living.reduce((a, b) => (signsHeld(s, b) > signsHeld(s, a) ? b : a))];
    }
    case 'fewestCards': {
      if (!living.length) return [];
      return [living.reduce((a, b) => (deckSize(s, b) < deckSize(s, a) ? b : a))];
    }
    default: return [controller];
  }
}

/**
 * Can this player actually pay these ops right now?
 *
 * A Toll must not be offered when it cannot be met — a button that throws is
 * worse than no button. Only the costs that can fail are checked: taking a Scar
 * or losing Grit always succeeds, but nobody can trash a Sign they do not have.
 */
export function canPay(s: GameState, pid: PlayerId, ops: readonly Op[]): boolean {
  const p = s.players[pid];
  for (const op of ops) {
    if (op.op === 'payGrit') {
      if (p.gritThisTurn < op.n) return false;
      continue;
    }
    if (op.op !== 'trash' || !op.kind) continue;
    const pile = op.from === 'hand' ? p.hand : p.deck;
    if (pile.filter((ci) => card(ci.cardId).type === op.kind).length < op.n) {
      return false;
    }
  }
  return true;
}

export function choiceOptions(
  s: GameState, op: Op, controller: PlayerId,
): { key: string; label: string }[] {
  if (op.op === 'scry') {
    return threatDeck(s).slice(0, op.n).map((ci) => ({
      key: ci.uid, label: card(ci.cardId).name, cardId: ci.cardId,
    }));
  }
  /*
    The one modal in the game: blast the Street, or bring down an Omen.

    Listed Omens FIRST and the decline LAST, so the interesting choice reads
    before the default. If no Omen is in the Street this returns a single
    option and `runQueue` resolves it without prompting — which is exactly the
    rule "offer the Omen branch only when an Omen is actually in play", falling
    out of the existing machinery rather than needing a guard of its own.
  */
  if (op.op === 'shutter') {
    return SHUTTERABLE
      .filter((type) => !shuttered(s, type))
      .map((type) => ({ key: type, label: `No ${type} next round` }));
  }
  if (op.op === 'gift' && op.to !== undefined) {
    // Second prompt: which Sign. The Vessel chooses, because a gift it did not
    // pick is not a temptation — it is a raffle.
    return SIGN_IDS.map((id) => ({ key: id, label: card(id).name, cardId: id }));
  }
  if (op.op === 'gainCard' && op.filter.from === 'provisionRow') {
    // Which Provision off the shelf. By uid, because the row can hold two of
    // the same card and "a Canteen" is not an instruction when it does.
    return s.supply.provisionRow.map((ci) => ({
      key: ci.uid, label: card(ci.cardId).name, cardId: ci.cardId,
    }));
  }
  if (op.op === 'recover' && op.from !== undefined) {
    // The controller picks, even when the card is pointed at somebody else —
    // the same call `gift` makes. A blessing you did not choose is a raffle.
    return (s.players[op.from]?.boneyard ?? [])
      .filter(recoverable)
      .map((ci) => ({ key: ci.uid, label: card(ci.cardId).name, cardId: ci.cardId }));
  }
  if (op.op === 'callSign' || op.op === 'gift' || op.op === 'beckon') {
    return s.turnOrder
      .filter((id) => s.players[id].status === 'posse')
      .map((id) => ({ key: id, label: s.players[id].name }));
  }
  if (op.op === 'banishOmen') {
    const omens = omenSlots(s).map((i) => ({
      key: String(i),
      label: `Bring down ${card(s.street[i]!.instance.cardId).name}`,
    }));
    return [...omens, { key: DECLINE_KEY, label: 'Blast the Street instead' }];
  }
  if (isSlotOp(op)) {
    const slots = occupiedSlots(s).map((i) => ({
      key: String(i),
      label: card(s.street[i]!.instance.cardId).name,
    }));
    // Only `damage` reaches the Vessel — `destroy` would end the game outright.
    // The Vessel is never offered itself as a target.
    if (op.op === 'damage' && vesselTargetable(s) && s.vessel !== controller) {
      slots.push({ key: VESSEL_KEY, label: 'The Vessel' });
    }
    return slots;
  }
  return livingPlayers(s).map((id) => ({ key: id, label: s.players[id].name }));
}

// ---------------------------------------------------------------------------
// Op execution
// ---------------------------------------------------------------------------

/**
 * Remove a Threat and pay its Bounty to whoever cleared it. Act I only —
 * "Nothing in Act II pays a Bounty. Ever." That inversion is what makes Act I
 * combat generative and Act II combat pure defence (DESIGN.md §7).
 */
/**
 * A Threat's Clear, including everything it has grown since it arrived.
 *
 * `undefined` means it cannot be cleared at all — an Omen, or one of the two
 * permanent Mythos obstructions. Those never gain Clear, because a number that
 * cannot be paid down is not a number.
 *
 * Every read of a Threat's Clear goes through here. The printed value on the
 * card is a starting point, not the truth.
 */
export function effectiveClear(sl: StreetSlot): number | undefined {
  const printed = card(sl.instance.cardId).clear;
  return printed === undefined ? undefined : printed + sl.escalation;
}

/**
 * A Threat's Menace, including escalation.
 *
 * `omenBase` is what an Omen menaces for — Omens print 0 and take their value
 * from TUNING, so the caller supplies it rather than this reaching for state.
 * That keeps the helper usable from anywhere holding a slot, including the
 * bots, which is the only way the engine and the bots can be made to agree
 * about how dangerous the Street is.
 */
export function effectiveMenace(sl: StreetSlot, omenBase: number): number {
  const def = card(sl.instance.cardId);
  const printed = def.type === 'omen' ? omenBase : def.menace ?? 0;
  return printed + sl.escalation;
}

export function clearThreat(
  s: GameState, slot: number, by: PlayerId, ev: GameEvent[],
): void {
  const sl = s.street[slot];
  if (!sl) return;
  const c = card(sl.instance.cardId);
  // "Cannot be cleared while any Omen is in the Street." Damage still sticks.
  if (c.noClearWhileOmen && omenInStreet(s)) return;
  ev.push({ t: 'THREAT_CLEARED', slot, cardId: c.id });
  retire(s, sl.instance);
  s.street[slot] = null;
  if (c.onCleared?.length) pushOps(s, c.onCleared, by, c.id);
  if (s.act === 'trouble' && c.bounty?.length && s.players[by]?.status === 'posse') {
    ev.push({ t: 'BOUNTY', player: by, cardId: c.id });
    pushOps(s, c.bounty, by, c.id);
  }
}

function damageThreat(
  s: GameState, slot: number, n: number, by: PlayerId, ev: GameEvent[],
): void {
  const sl = s.street[slot];
  if (!sl) return;
  const clear = effectiveClear(sl);
  if (clear === undefined) return; // Omens and undamageable Mythos
  sl.damage += n;
  ev.push({ t: 'THREAT_DAMAGED', slot, amount: n });
  if (sl.damage >= clear) clearThreat(s, slot, by, ev);
}

// --------------------------------------------------------------- Whispers
//
// One number, one direction: UP.
//
// The track means the same thing in both acts — when it fills, something bad
// happens — and the only difference is what is waiting at the top and how fast
// you get there. Act I fills once, into the Turning. Act II fills over and
// over, into escalating Doom.
//
// **Nothing subtracts from `whispers`.** There is no spend, no clamp, no
// `Math.min` taking what it can. This field was briefly a progress meter AND a
// currency the Vessel drew on, which is exactly how it went negative, and the
// absence of a subtract path is what makes that unrepeatable rather than
// merely fixed. If something needs to be spent, it is not this number.

/**
 * Add to the Whisper track, applying the Act II rate and resolving any fills.
 *
 * The only way the track moves.
 *
 * Act I leaves the bar standing above the threshold for `checkTurning` to find
 * at the end of the command — the Turning is not this function's business.
 * Act II resolves here, because a bar left full would render "26 of 26" on a
 * client for a whole turn and would let two later gains share one fill.
 */
export function addWhispers(s: GameState, n: number, ev: GameEvent[]): void {
  if (n <= 0) return;
  s.whispers += mythosRate(s, n);
  ev.push({ t: 'WHISPERS', delta: mythosRate(s, n), total: s.whispers });
  if (s.act !== 'mythos') return;

  const threshold = s.tuning.whisperThreshold;
  // A threshold of zero would spin here for ever. Nothing sets it, but this is
  // reached from card data and from TUNING sweeps alike.
  if (threshold <= 0) return;

  /*
    A loop, not an `if`, and the remainder CARRIES.

    Both halves matter and both are easy to get wrong in the same direction —
    quietly losing Whispers the player earned. At 11 of 12 a three-Whisper Sign
    must leave the bar at 2, not at 0; and a single large gain must be able to
    fill the bar twice and pay for both, not silently swallow the second.
  */
  while (s.whispers >= threshold) {
    s.whispers -= threshold;
    s.whisperFills += 1;
    const doom = doomForFill(s, s.whisperFills);
    // The fill BEFORE the Doom it causes: the narrator hangs events after an
    // anchor onto it as clauses, so the other order announces the same Doom
    // twice, once with no cause attached.
    ev.push({ t: 'WHISPER_FILL', fill: s.whisperFills, doom, total: s.whispers });
    addDoomFromFill(s, doom, ev);
  }
}

/**
 * What a gain is actually worth, here and now.
 *
 * Rounded, because the track is drawn as pips and a bar at 7.5 is not a thing
 * anyone can read. Floored at 1 for any positive gain: at a rate below 0.5 the
 * rounding would otherwise swallow single Whispers entirely, which is a
 * mechanic silently doing nothing — the failure mode this project keeps
 * hitting.
 */
function mythosRate(s: GameState, n: number): number {
  if (s.act !== 'mythos') return n;
  return Math.max(1, Math.round(n * s.tuning.whisperRateMythos));
}

/** Doom for the nth fill, 1-based. First `doomPerFill`, then a step each time. */
export function doomForFill(s: GameState, fill: number): number {
  return s.tuning.doomPerFill + (fill - 1) * s.tuning.doomPerFillStep;
}

/**
 * Doom from a fill.
 *
 * `addDoom` lives in `reducer.ts` and importing it here would close the cycle
 * `reducer -> effects -> reducer`, so the increment is inlined. It is two lines
 * and the event shape is fixed; `tests/whispers.test.ts` asserts the two agree.
 */
function addDoomFromFill(s: GameState, n: number, ev: GameEvent[]): void {
  if (n <= 0) return;
  s.doom += n;
  ev.push({ t: 'DOOM', delta: n, total: s.doom });
}

/**
 * The invariant, checkable from anywhere. Called by `apply` after every
 * command and by the randomised tests.
 *
 * The upper bound is the interesting half and it is asserted in BOTH acts, not
 * just Act II: a track at or above its threshold once a command has finished
 * resolving means a fill was missed, or in Act I that the Turning did not fire.
 * Either way something that should have happened did not.
 */
export function assertWhisperInvariants(s: GameState): void {
  if (s.whispers < 0) {
    throw new IllegalCommand(
      `Whisper track went negative: ${s.whispers}. Nothing may subtract from it.`,
    );
  }
  if (s.whispers >= s.tuning.whisperThreshold) {
    throw new IllegalCommand(
      `Whisper track left full: ${s.whispers} >= ${s.tuning.whisperThreshold} `
      + '— a fill was missed, or the Turning did not fire',
    );
  }
}


// ---------------------------------------------------------------------------
// The Street: escalation, overflow, and Menace.
//
// These lived in reducer.ts, which meant the `summon` op could not reach them
// and wrote its own, simpler arrival — one that gave up on a full Street. Two
// arrival rules is one too many; they are effects, so they live here.
// ---------------------------------------------------------------------------

export function escalate(s: GameState, slot: number, ev: GameEvent[]): void {
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

export function oldestSlot(s: GameState): number {
  let best = 0, oldest = Infinity;
  s.street.forEach((sl, i) => {
    if (sl && sl.enteredRound < oldest) { oldest = sl.enteredRound; best = i; }
  });
  return best;
}

/**
 * Menace, in cards off a deck. `damagePerHit` is the exchange rate.
 *
 * Rounded UP, so a Threat is never harmless: at 0.5 a Menace of 1 still costs a
 * card, and every point after that costs half of one. Escalation is what makes
 * this matter — a Threat left standing four Dusks reaches Menace 5, and the
 * difference between five cards and three is the difference between a bad
 * evening and a deck cut in half.
 *
 * The corruption bonus is NOT run through here: `menacePerSign` is already a
 * fraction of a count, floored, and halving it too would round most tables
 * straight to zero.
 */
function cardsFor(s: GameState, menace: number): number {
  return Math.ceil(menace * s.tuning.damagePerHit);
}

export function resolveMenace(s: GameState, slot: number, ev: GameEvent[]): void {
  const sl = s.street[slot];
  if (!sl) return;
  const def = card(sl.instance.cardId);
  if (sl.menaceCancelled) return; // Night Watch is standing over this one
  const menace = effectiveMenace(sl, s.tuning.omenMenace);
  if (menace <= 0) return;
  /*
    The posse, and only the posse.

    `livingPlayers` includes the Vessel — correct for turn order and for the
    win check, wrong here: a Threat is the Old One's own force, and Menace is
    it reaching for the table. It has no reason to bite the seat it is using.

    Measured before this: 25.6% of Act II Menace landed on the Vessel and 26%
    of all cards trashed in Act II were the Vessel's own. Not an edge case —
    Menace aims at whoever holds most Signs, and the Vessel keeps every Sign it
    bought (5.7 on average), so the targeting rule pointed it at itself by
    default.
  */
  const targets = livingPlayers(s).filter((id) => s.players[id].status === 'posse');
  if (!targets.length) return;

  // Menace lands on whoever holds the most Signs — corruption draws attention —
  // unless the card names someone else. Ties break at random, never by seat: a
  // first-match rule sends every point of damage to the same player all game
  // whenever Signs are level, and cascades it down the table.
  const aim = def.menaceTarget ?? 'mostSigns';

  if (aim === 'all') {
    for (const victim of targets) {
      // The wound deepens with the corruption that drew it.
      const extra = Math.floor(signsHeld(s, victim) * s.tuning.menacePerSign);
      const total = cardsFor(s, menace) + extra;
      ev.push({ t: 'MENACE', slot, cardId: def.id, player: victim, amount: total });
      damagePlayer(s, victim, total, ev);
    }
    return;
  }

  /*
    ONE POINT AT A TIME, re-aimed after every one.

    The wound used to be a single lump: pick the most corrupt seat, work out
    how big the hit is, and take that many cards off them in one go. At Dusk,
    with three or four Threats resolving and every one of them aiming by the
    same rule, that meant one player having their deck halved in an evening
    while everybody else watched.

    Aimed per point instead. The moment a hit costs the leader a Sign they are
    level with somebody, the tie breaks at random and the next point goes
    elsewhere — the rule is the same rule, applied at the granularity the
    fiction implies. Nothing about how MUCH damage lands changes; only who
    takes it.

    Two consequences worth stating rather than discovering:

      * The size is fixed by the FIRST seat aimed at. `menacePerSign` is "the
        wound deepens with the corruption that drew it", and what drew it is
        who the Threat was looking at when it moved. Recomputing per point
        would multiply the bonus by the point count.
      * A point never lands on somebody who has already fallen. Standing posse
        only, re-read every point — so a player going down mid-wound passes the
        rest of it to the next most corrupt seat rather than absorbing it into
        a deck that no longer exists.
  */
  const standing = () =>
    livingPlayers(s).filter((id) => s.players[id].status === 'posse');
  const nextVictim = (pool: PlayerId[]) => (aim === 'fewestCards'
    ? pickExtreme(s, pool, (id) => deckSize(s, id), false)
    : pickExtreme(s, pool, (id) => signsHeld(s, id), true));

  const first = nextVictim(targets);
  if (!first) return;
  const total = cardsFor(s, menace)
    + Math.floor(signsHeld(s, first) * s.tuning.menacePerSign);

  // Kept per victim and emitted afterwards, so the chronicle still reads as one
  // sentence per person hit rather than as `total` separate one-card wounds.
  const order: PlayerId[] = [];
  const tally = new Map<PlayerId, number>();
  const wounds = new Map<PlayerId, GameEvent[]>();

  for (let i = 0; i < total; i++) {
    const pool = standing();
    if (!pool.length) break;
    const victim = nextVictim(pool);
    if (!victim) break;
    if (!wounds.has(victim)) { order.push(victim); wounds.set(victim, []); }
    tally.set(victim, (tally.get(victim) ?? 0) + 1);
    damagePlayer(s, victim, 1, wounds.get(victim)!);
  }

  for (const victim of order) {
    ev.push({
      t: 'MENACE', slot, cardId: def.id, player: victim, amount: tally.get(victim)!,
    });
    ev.push(...mergeWound(wounds.get(victim)!));
  }
}

/**
 * One point of damage at a time produces one `DAMAGED` event per point. Nobody
 * wants to read "Ada loses a Saddlebag" four times, and the Dusk report counts
 * these — so the run is collapsed back into the single event a lump wound used
 * to produce, in the position the first one held.
 *
 * `FELL` and anything else keep their place. A player can only fall on the last
 * point they take, because falling drops them out of the pool.
 */
function mergeWound(events: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  let damaged: (GameEvent & { t: 'DAMAGED' }) | null = null;
  let prevented: (GameEvent & { t: 'PREVENTED' }) | null = null;
  for (const e of events) {
    if (e.t === 'DAMAGED') {
      if (!damaged) { damaged = { ...e }; out.push(damaged); }
      else {
        damaged.amount += e.amount;
        damaged.trashed = [...damaged.trashed, ...e.trashed];
      }
      continue;
    }
    if (e.t === 'PREVENTED') {
      if (!prevented) { prevented = { ...e }; out.push(prevented); }
      else prevented.amount += e.amount;
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * A Threat arrives. The ONE arrival rule, used by Dawn and by SOMETHING COMES
 * UP THE STREET alike.
 *
 * On a full Street this overflows rather than fizzling: the oldest Threat
 * takes its Menace out on the table and stays, one step worse, and the
 * arriving card is retired. Getting swamped should compound — that is why
 * overflow stopped discarding — and a card that does nothing when the Street
 * is full is a card the Vessel simply holds.
 */
export function enterStreet(
  s: GameState, entering: CardInstance, ev: GameEvent[],
): void {
  const slot = s.street.findIndex((x) => x === null);
  if (slot === -1) {
    const old = oldestSlot(s);
    resolveMenace(s, old, ev);
    escalate(s, old, ev);
    // Retired rather than dropped, so the recycle economy still sees it.
    retire(s, entering);
    return;
  }
  s.street[slot] = {
    instance: entering, damage: 0, turned: false,
    enteredRound: s.round, escalation: 0,
  };
  ev.push({ t: 'THREAT_ENTERED', slot, cardId: entering.cardId });
  onThreatEntered(s, entering.cardId, ev);
}

export function execOp(
  s: GameState, op: Op, controller: PlayerId, ev: GameEvent[], chosen?: string,
): void {
  switch (op.op) {
    case 'grit':
      s.players[controller].gritThisTurn += op.n;
      ev.push({ t: 'GRIT', player: controller, amount: op.n });
      return;
    case 'actions':
      s.actionsLeft += op.n;
      return;
    case 'whisper':
      addWhispers(s, op.n, ev);
      return;
    case 'gritNextTurn': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        s.nextTurnGrit[pid] = (s.nextTurnGrit[pid] ?? 0) + op.n;
      }
      return;
    }
    case 'damage': {
      // Either aimed there by a chooser, or sent there by a Fevered face.
      if (chosen === VESSEL_KEY || op.target === 'vessel') {
        damageVessel(s, op.n, controller, ev);
        return;
      }
      const slots = chosen !== undefined ? [Number(chosen)] : resolveSlots(s, op.target);
      for (const i of slots) damageThreat(s, i, op.n, controller, ev);
      return;
    }
    /**
     * Bring down an Omen, and pay for it.
     *
     * The only counterplay to an Omen in the game. Omens cannot be cleared,
     * cannot be damaged, and (since overflow stopped discarding) cannot be
     * pushed out either — so before this they were pure creeping dread with
     * nothing on the other side of the decision.
     *
     * The Scar is not optional. Free Omen removal is too clean for what an
     * Omen represents, and the point of the card is that the only way to clear
     * the dread is to take on more corruption — the temptation engine firing
     * exactly when the table feels most helpless.
     *
     * `chosen === DECLINE_KEY` means the player kept the card's other mode.
     * Anything else is an Omen slot, and taking it CLEARS THE REST OF THE
     * QUEUE — that is what "may instead" means, and it is why this op is
     * written first on the card.
     */
    case 'banishOmen': {
      if (chosen === undefined || chosen === DECLINE_KEY) return;
      const slot = Number(chosen);
      const sl = s.street[slot];
      // Not an Omen: refuse rather than quietly clearing an ordinary Threat,
      // which would make this the best removal in the game by accident.
      if (!sl || card(sl.instance.cardId).type !== 'omen') return;
      s.street[slot] = null;
      ev.push({ t: 'THREAT_CLEARED', slot, cardId: sl.instance.cardId });
      /*
        "Instead": the rest of the card is skipped, and the Scar replaces it.

        Written as a queue REPLACEMENT rather than as an inline scars++ so the
        Scar goes through the ordinary `scar` op — which increments the counter
        AND puts a dead card in the discard. Doing it by hand here would have
        drifted from that the first time the `scar` op changed.
      */
      const price: Op = { op: 'scar', n: 1, target: op.target };
      if (s.resolution) s.resolution.queue = [price];
      else execOp(s, price, controller, ev);
      return;
    }
    /**
     * IT REMEMBERS YOUR NAME — look at the top of a deck; a Sign resolves.
     *
     * LOOKS AT. A non-Sign goes back untouched and is named in no event, so
     * nothing about that deck escapes. The card only becomes public when it
     * resolves, which everyone watches happen.
     *
     * The version this replaces discarded it either way, and `playerView`
     * publishes every discard pile — so the card was public the moment it
     * landed there, and keeping it out of the chronicle would have hidden the
     * sentence rather than the information.
     */
    case 'callSign': {
      const [pid] = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      if (!pid) return;
      const t = s.players[pid];
      const top = t.deck[0];
      if (!top) return;
      if (card(top.cardId).type !== 'sign') {
        ev.push({ t: 'NAME_READ', player: pid, resolved: false });
        return;
      }
      t.deck.shift();
      t.discard.push(top);
      ev.push({ t: 'NAME_READ', player: pid, resolved: true, cardId: top.cardId });
      // Against them, and unaimed: a card resolved by the Vessel is never
      // aimed, which is what `opsFor(def, true)` without `aimed` means.
      pushOps(s, opsFor(card(top.cardId), true), pid, top.cardId);
      return;
    }
    /**
     * SOMETHING COMES UP THE STREET.
     *
     * Through the ordinary arrival, so a FULL Street overflows rather than
     * doing nothing. This used to `return` on a full Street — a legal play
     * that changed no state, which is the worst kind of card. Overflow is
     * already the game's answer to a Threat with nowhere to stand, and it is
     * a real effect: the oldest Threat menaces the table and grows a step.
     */
    case 'summon': {
      const next = s.supply.mythos.shift();
      if (!next) return;
      enterStreet(s, next, ev);
      return;
    }
    /** NOT THAT ONE. The chosen type is off the table for a round. */
    case 'shutter': {
      const type = (chosen ?? 'kit') as CardType;
      const until = s.round + s.tuning.shutterDuration;
      s.shuttered = { type, untilRound: until };
      ev.push({ t: 'SHUTTERED', cardType: type, untilRound: until });
      return;
    }
    /** A GIFT, FREELY GIVEN. Two prompts: who, then which Sign. */
    case 'gift': {
      if (op.to === undefined) {
        const pid = chosen ?? resolvePlayers(s, op.target, controller)[0];
        if (!pid || s.players[pid]?.status !== 'posse') return;
        // Ask again, this time for the Sign. Unshifted so the second half of
        // one card's decision resolves before anything else on the queue.
        if (s.resolution) s.resolution.queue.unshift({ ...op, to: pid });
        return;
      }
      const t = s.players[op.to];
      if (!t || t.status !== 'posse') return;
      const id = chosen && SIGN_IDS.includes(chosen) ? chosen : SIGN_IDS[0]!;
      const gift = newInstance(s, id, true);
      gift.offeredUntil = s.round + 1;
      t.discard.push(gift);
      // No reward named. The target knowing the exact bounty on their own head
      // changes the decision, so the payoff is logged when it PAYS, not now.
      ev.push({ t: 'OFFERED', by: controller, target: op.to, cardId: id });
      return;
    }
    /**
     * COME AND SEE. Mark a living player; they are paid if they take the bait.
     *
     * The Revenant doing openly what the Marked player does in secret, which is
     * what muddies the read on both.
     *
     * One slot, not a list: beckoning a second player simply moves the mark.
     * That was true of the `BECKON` command too — a Revenant with two actions
     * could press it twice and only the last one counted — so the card being
     * granted one to a turn takes nothing away.
     */
    case 'beckon': {
      const pid = chosen ?? resolvePlayers(s, op.target, controller)[0];
      if (!pid || s.players[pid]?.status !== 'posse') return;
      s.beckoned = pid;
      ev.push({ t: 'BECKONED', by: controller, target: pid });
      return;
    }
    case 'destroy': {
      // `all` is deliberately NOT honoured here: `resolveSlots` would return
      // every slot and one card would empty the Street.
      const slots = chosen !== undefined ? [Number(chosen)]
        : op.target === 'all' ? [] : resolveSlots(s, op.target);
      for (const i of slots) clearThreat(s, i, controller, ev);
      return;
    }
    case 'draw': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) drawCards(s, pid, op.n, ev);
      return;
    }
    case 'trash': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        const p = s.players[pid];
        if (op.from === 'hand') {
          for (let i = 0; i < op.n; i++) {
            // Named kind: take exactly that. Unnamed: anything but a Sign,
            // which is what makes a wounded player progressively more corrupt.
            const idx = op.kind
              ? p.hand.findIndex((ci) => card(ci.cardId).type === op.kind)
              : p.hand.findIndex((ci) => card(ci.cardId).type !== 'sign');
            if (idx === -1) break;
            p.boneyard.push(...p.hand.splice(idx, 1));
          }
        } else if (op.kind) {
          // From the deck, by kind — a Toll reaching past your hand for the
          // thing you were hoping to keep.
          for (let i = 0; i < op.n; i++) {
            const idx = p.deck.findIndex((ci) => card(ci.cardId).type === op.kind);
            if (idx === -1) break;
            p.boneyard.push(...p.deck.splice(idx, 1));
          }
        } else {
          damagePlayer(s, pid, op.n, ev);
        }
      }
      return;
    }

    case 'payGrit': {
      const p = s.players[controller];
      if (p) p.gritThisTurn = Math.max(0, p.gritThisTurn - op.n);
      return;
    }
    case 'scar': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        const p = s.players[pid];
        for (let i = 0; i < op.n; i++) {
          // The counter AND the card: one is the tally the table reads, the
          // other is the dead draw you keep pulling. Both, or the Scar is only
          // bookkeeping. Matches how a Fevered Last Words already scars you.
          p.scars++;
          p.discard.push(newInstance(s, 'scar'));
        }
      }
      return;
    }
    case 'discardHand': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        const p = s.players[pid];
        if (!p.hand.length) continue;
        // The same gesture as ending a turn — a whole hand swept away — even
        // though it is a card doing it to you rather than you doing it.
        ev.push({ t: 'DISCARDED', player: pid, n: p.hand.length, hand: true });
        p.discard.push(...p.hand);
        p.hand = [];
      }
      return;
    }
    case 'recover': {
      /*
        First pass: settle WHOSE boneyard, then ask again for the card.

        Re-queued rather than resolved in one step, exactly as `gift` does it —
        the half-made decision travels in the resolution queue, so it survives
        being serialised mid-choice like everything else.
      */
      if (op.from === undefined) {
        const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
        // Unshifted so one card's second question is answered before anything
        // else on the queue, and in reverse so several targets keep their order.
        for (const pid of [...targets].reverse()) {
          if (s.resolution) s.resolution.queue.unshift({ ...op, from: pid });
        }
        return;
      }
      const p = s.players[op.from];
      if (!p) return;
      // By uid: a boneyard is mostly duplicates, and "a Saddlebag" is not an
      // instruction when four of them are lying there.
      const idx = chosen
        ? p.boneyard.findIndex((ci) => ci.uid === chosen)
        : p.boneyard.findIndex((ci) => recoverable(ci));
      if (idx >= 0 && recoverable(p.boneyard[idx]!)) {
        p.discard.push(...p.boneyard.splice(idx, 1));
      }
      return;
    }
    case 'gainCard': {
      const fromRow = op.filter.from === 'provisionRow';
      /*
        `chosen` means two different things here.

        For a Provision off the shelf it is the UID of the card picked; for
        anything else it is the player the op was pointed at. They cannot both
        be in flight, because no card asks for both — one that did would need
        the two-prompt shape `gift` uses, with the first answer stored on the op.
      */
      const targets = (!fromRow && chosen)
        ? [chosen]
        : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        if (fromRow) {
          // The one you asked for, or the leftmost if nothing was picked.
          const at = chosen ? s.supply.provisionRow.findIndex((ci) => ci.uid === chosen) : 0;
          const inst = s.supply.provisionRow.splice(at >= 0 ? at : 0, 1)[0];
          if (inst) {
            s.players[pid].discard.push(inst);
            ev.push({ t: 'BOUGHT', player: pid, cardId: inst.cardId });
            /*
              And the shelf refills, exactly as it does after a purchase.

              It did not, which meant a Bounty quietly shrank the row for the
              rest of the game — four Act I Threats pay one, so a table that
              cleared well ended up shopping from a shorter shelf than a table
              that did not. The Provision DECK is the finite thing
              (`provisionCount`); the row is a window onto it.
            */
            const next = s.supply.provisions.shift();
            if (next) s.supply.provisionRow.push(next);
          }
        } else if (op.filter.from === 'signs') {
          const pick = op.filter.maxCost;
          const id = ['certainty', 'stake-claim', 'coyote', 'debt']
            .find((sid) => (card(sid).cost ?? 99) <= (pick ?? 99));
          if (id) {
            const inst = newInstance(s, id, s.act === 'mythos');
            s.players[pid].discard.push(inst);
            ev.push({ t: 'BOUGHT', player: pid, cardId: id });
          }
        }
      }
      return;
    }
    case 'revealHand': {
      // Marks the hand as known to the Vessel. Consumed by playerView.
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        if (!s.handsRevealedTo[pid]) s.handsRevealedTo[pid] = [];
        if (!s.handsRevealedTo[pid].includes(controller)) {
          s.handsRevealedTo[pid].push(controller);
        }
      }
      return;
    }
    case 'cancelMenace': {
      // `all` would silence the whole Street off one card; a ward is one slot.
      const slot = chosen !== undefined ? Number(chosen)
        : op.target === 'all' ? undefined
        : resolveSlots(s, op.target)[0];
      if (slot === undefined) return;
      const sl = s.street[slot];
      if (!sl) return;
      sl.menaceCancelled = true;
      ev.push({ t: 'MENACE_CANCELLED', slot, by: controller });
      return;
    }
    case 'shield': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        s.shields[pid] = (s.shields[pid] ?? 0) + op.n;
        ev.push({ t: 'SHIELDED', player: pid, amount: op.n });
      }
      return;
    }
    case 'scry': {
      // Steer what arrives next: the chosen card jumps to the top of the deck.
      if (!chosen) return;
      const deck = threatDeck(s);
      const i = deck.findIndex((ci) => ci.uid === chosen);
      if (i <= 0) return;
      const [picked] = deck.splice(i, 1);
      deck.unshift(picked);
      ev.push({ t: 'SCRIED', player: controller, cardId: picked.cardId });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// The resolution queue. Deliberately not a generator: it must serialize.
// ---------------------------------------------------------------------------

export function pushOps(
  s: GameState, ops: Op[], controller: PlayerId, sourceCardId: string | null,
): void {
  if (!ops.length) return;
  s.resolution = s.resolution
    ? { ...s.resolution, queue: [...s.resolution.queue, ...ops] }
    : { queue: [...ops], controller, sourceCardId };
}

export function runQueue(s: GameState, ev: GameEvent[]): void {
  let guard = 0;
  while (s.resolution && s.resolution.queue.length && !s.pending) {
    if (guard++ > 500) throw new Error('Op queue did not terminate');
    const op = s.resolution.queue[0];
    const ctrl = s.resolution.controller;
    /*
      `banishOmen` always asks, even with no Omen in the Street — it returns a
      single option then, and the branch below resolves it silently. Asking
      unconditionally is what keeps the "only when an Omen is in play" rule in
      ONE place (`choiceOptions`) rather than duplicated as a guard here.
    */
    const needsChoice = op.op === 'scry' || op.op === 'banishOmen'
      || op.op === 'shutter'
      // Second half of a recover: which card, whoever the first half settled
      // on. Not covered by the `choose` rule below, because Doc Mireles' Bag
      // is `target: 'self'` and still has a decision to make.
      || (op.op === 'recover' && op.from !== undefined)
      /*
        Taking a Provision off the shelf is a choice, not the leftmost card.

        Asked whatever the `target`, because every card that does this points at
        `self` — the Bounty is yours — so there is no player prompt to come
        first. A future card wanting to give somebody else a Provision they pick
        would need `gift`'s two-stage shape.
      */
      || (op.op === 'gainCard' && op.filter.from === 'provisionRow')
      || ('target' in op && op.target === 'choose');
    if (needsChoice) {
      const options = choiceOptions(s, op, ctrl);
      if (options.length > 1) {
        s.pending = {
          id: `ch${s.log.length}-${s.resolution.queue.length}`,
          player: ctrl,
          prompt: `Choose a target for ${op.op}`,
          options, min: 1, max: 1, op: op.op,
          ...('n' in op ? { amount: op.n } : {}),
        };
        ev.push({ t: 'CHOICE_REQUIRED', player: ctrl, prompt: s.pending.prompt });
        return;
      }
      s.resolution.queue.shift();
      if (options.length === 1) execOp(s, op, ctrl, ev, options[0].key);
      continue;
    }
    s.resolution.queue.shift();
    execOp(s, op, ctrl, ev);
  }
  if (s.resolution && !s.resolution.queue.length && !s.pending) s.resolution = null;
}

export function resolveChoice(s: GameState, picks: string[], ev: GameEvent[]): void {
  if (!s.resolution) { s.pending = null; return; }
  const op = s.resolution.queue.shift()!;
  const ctrl = s.resolution.controller;
  s.pending = null;
  for (const pick of picks) execOp(s, op, ctrl, ev, pick);
  runQueue(s, ev);
}
