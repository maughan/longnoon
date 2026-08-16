import type {
  GameState, Op, PlayerId, GameEvent, CardInstance, Card, Target, StreetSlot,
} from './state';
import { card } from '../content/cards';
import { shuffle, randInt } from './rng';

// ---------------------------------------------------------------------------
// Fevered resolution. This is the schema bet made concrete: three mechanisms,
// no bespoke code per card.
// ---------------------------------------------------------------------------

/**
 * `aimed` is the Old One's and the Revenant's privilege: the paper rules say
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
  return [...base, ...(f.appendOps ?? [])];
}

export function displayName(c: Card, fevered: boolean): string {
  return fevered && c.fevered ? c.fevered.name : c.name;
}

// ---------------------------------------------------------------------------
// Deck plumbing
// ---------------------------------------------------------------------------

export function livingPlayers(s: GameState): PlayerId[] {
  return s.turnOrder.filter((id) =>
    ['posse', 'oldOne'].includes(s.players[id].status));
}

function refill(s: GameState, pid: PlayerId): void {
  const p = s.players[pid];
  if (p.deck.length || !p.discard.length) return;
  const r = shuffle(p.discard, s.seed, s.rngCursor);
  s.rngCursor = r.cursor;
  p.deck = r.items;
  p.discard = [];
  // "You shrink." The Old One floors at one card so the endgame cannot stall;
  // a Revenant is allowed to run out completely — burning out is what replaced
  // burial as the posse's answer to them.
  const floor = p.status === 'oldOne' ? 1 : 0;
  if (p.status === 'revenant' || p.status === 'oldOne') {
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
    refill(s, pid);
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
    refill(s, pid);
    if (!p.deck.length) { fall(s, pid, ev); break; }
    let idx = p.deck.findIndex((ci) => card(ci.cardId).type !== 'sign');
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

/** Choice key standing for the Vessel, distinct from numeric slot keys. */
export const VESSEL_KEY = 'vessel';

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
 * Vessel". The Old One will not wound itself, and a Revenant wins only if the
 * Old One wins, so neither contributes even when holding a card that would.
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
      key: ci.uid, label: card(ci.cardId).name,
    }));
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

/**
 * Spend from the Whisper pool.
 *
 * The same number as the Act I track, read the other way round. Before the
 * Turning it is a clock counting up to a threshold; after it, the threshold has
 * fired and what accumulates is the Old One's ammunition. One number, because
 * they are the same substance — what the table gave away.
 */
export function spendWhispers(s: GameState, n: number, ev: GameEvent[]): void {
  const paid = Math.min(n, s.whispers);
  if (paid <= 0) return;
  s.whispers -= paid;
  ev.push({ t: 'WHISPERS', delta: -paid, total: s.whispers });
}

export function addWhispers(s: GameState, n: number, ev: GameEvent[]): void {
  s.whispers += n;
  ev.push({ t: 'WHISPERS', delta: n, total: s.whispers });
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
      const slots = chosen !== undefined ? [Number(chosen)]
        : op.target === 'leftmostSlot' ? occupiedSlots(s).slice(0, 1)
        : occupiedSlots(s);
      for (const i of slots) damageThreat(s, i, op.n, controller, ev);
      return;
    }
    case 'destroy': {
      const slots = chosen !== undefined ? [Number(chosen)]
        : op.target === 'leftmostSlot' ? occupiedSlots(s).slice(0, 1) : [];
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
        p.discard.push(...p.hand);
        p.hand = [];
      }
      return;
    }
    case 'recover': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        const p = s.players[pid];
        const idx = p.boneyard.findIndex((ci) => card(ci.cardId).type !== 'sign');
        if (idx >= 0) p.discard.push(...p.boneyard.splice(idx, 1));
      }
      return;
    }
    case 'gainCard': {
      const targets = chosen ? [chosen] : resolvePlayers(s, op.target, controller);
      for (const pid of targets) {
        if (op.filter.from === 'provisionRow') {
          const inst = s.supply.provisionRow.shift();
          if (inst) {
            s.players[pid].discard.push(inst);
            ev.push({ t: 'BOUGHT', player: pid, cardId: inst.cardId });
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
      // Marks the hand as known to the Old One. Consumed by playerView.
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
      const slot = chosen !== undefined ? Number(chosen)
        : op.target === 'leftmostSlot' ? occupiedSlots(s)[0]
        : undefined;
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
    const needsChoice = op.op === 'scry' || ('target' in op && op.target === 'choose');
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
