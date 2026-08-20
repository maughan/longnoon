// Bot policies. Pure functions of (view, legal) -> Command.
//
// Two rules this file exists to respect:
//
// 1. Bots receive `ClientState` (the playerView output), never `GameState`.
//    Same interface a human client gets. A bot that peeked at hidden state
//    would make every measurement a lie.
// 2. Bots read `content/cards` freely. Card faces, costs and the Sign supply
//    are public information at a real table — that is not a leak.
//
// The policies differ ONLY in `pick` (what to buy) and `playsSign`. Everything
// else — clearing Threats, racing the Vessel, when to spend for Grit — is
// shared. If Puritan and Zealot differed in their combat logic too, the headline
// number would be measuring the wrong thing.

import type { Command, CardInstance, Op, Target } from '../engine/state';
import type { ClientState } from '../engine/view';
import {
  opsFor, VESSEL_KEY, DECLINE_KEY, effectiveClear, effectiveMenace,
} from '../engine/effects';
import { card, SIGN_IDS } from '../content/cards';

export interface BotContext {
  view: ClientState;
  legal: Command[];
  /** Seeded, cursor-driven. Never Math.random — see scripts/lint-determinism. */
  rand: () => number;
}

export type Bot = (ctx: BotContext) => Command;

export interface BuyPolicy {
  name: string;
  /**
   * Which card id this policy buys with `budget` Grit, or null.
   *
   * `rand` is seeded and must be used for any choice between equals. An earlier
   * version broke cost ties alphabetically, which meant exactly one Sign per
   * price point was ever bought in any measurement — 3 of 12, and none of the
   * four Vessel-facing ones. Never tie-break on id here.
   */
  pick(view: ClientState, budget: number, rand: () => number): string | null;
  /**
   * Whether to play THIS Sign right now, weighing its effect against the
   * Whispers it hands the table. Per-card, because "play every Sign you draw"
   * is not a strategy — it is a bot speedrunning the Turning against itself.
   */
  playsSign: (view: ClientState, ci: CardInstance) => boolean;
}

const never = () => false;

/**
 * Is this Sign worth its Whispers?
 *
 * Whispers are only a cost in Act I — once the Turning has happened the track is
 * spent and there is no reason to hold anything back. Before then, only pay for
 * an effect you can actually use this turn.
 */
function worthTheWhispers(view: ClientState, ci: CardInstance): boolean {
  const def = card(ci.cardId);
  if (view.act === 'mythos') return true;
  if (!def.whispers) return true;

  const ops = opsFor(def, ci.fevered);
  const has = (k: string) => ops.some((op) => op.op === k);
  const ts = threats(view);

  // Economy: Grit, actions, cards and free Provisions are always usable.
  if (has('grit') || has('actions') || has('draw') || has('gainCard')) return true;
  // Removal is worth it only if there is something to remove.
  if ((has('destroy') || has('damage')) && ts.length) return true;
  // Defence is worth it only against something that actually hits.
  if ((has('cancelMenace') || has('shield')) && ts.some((t) => t.menace > 0)) return true;
  // Recovery is worth it only if there is anything to recover.
  if (has('recover') && (view.you?.boneyard.length ?? 0) > 0) return true;
  // Everything else — scry, a bare passive — is not worth Whispers in Act I.
  return false;
}

// ---------------------------------------------------------------- card reads

/** Damage this card can put onto a Street Threat. `destroy` clears anything. */
function damageOf(ci: CardInstance): number {
  let d = 0;
  for (const op of opsFor(card(ci.cardId), ci.fevered)) {
    if (op.op === 'destroy') d += 99;
    else if (op.op === 'damage' && op.target !== 'vessel') d += op.n;
  }
  return d;
}

/**
 * Damage this card can put onto the Vessel: `choose` can be aimed there, and a
 * Fevered face targeting `vessel` goes there whether you like it or not.
 * `destroy` is Street-only by design.
 */
function vesselDamageOf(ci: CardInstance): number {
  let d = 0;
  for (const op of opsFor(card(ci.cardId), ci.fevered)) {
    if (op.op === 'damage' && (op.target === 'vessel' || op.target === 'choose')) d += op.n;
  }
  return d;
}

/** Cards that blunt incoming Menace rather than dealing damage. */
function isDefensive(ci: CardInstance): boolean {
  return opsFor(card(ci.cardId), ci.fevered).some(
    (op) => op.op === 'cancelMenace' || op.op === 'shield',
  );
}

function isUtility(ci: CardInstance): boolean {
  return opsFor(card(ci.cardId), ci.fevered).some(
    (op) => op.op === 'draw' || op.op === 'actions' || op.op === 'gainCard',
  );
}


/**
 * Cards nobody should play: deck-thinning is a trap when the deck is your
 * health (DESIGN.md §5 — thin means fragile). Applied uniformly to every policy
 * so it cannot bias the comparison.
 *
 * A self-trash that comes attached to real aggression is a price, not a trap —
 * a Fevered Sign that wounds the Vessel is worth a card off the deck. Only a
 * self-trash with nothing offensive attached is refused.
 */
function selfHarming(ci: CardInstance): boolean {
  const ops = opsFor(card(ci.cardId), ci.fevered);
  const trashesSelf = ops.some((op) => op.op === 'trash' && op.target === 'self');
  if (!trashesSelf) return false;
  return !ops.some((op) => op.op === 'destroy' || op.op === 'damage');
}

interface ThreatInfo {
  slot: number;
  remaining: number;
  menace: number;
  clearable: boolean;
}

function threats(view: ClientState): ThreatInfo[] {
  const out: ThreatInfo[] = [];
  view.street.forEach((sl, slot) => {
    if (!sl) return;
    const def = card(sl.instance.cardId);
    if (def.type === 'omen') return; // cannot be cleared, ever
    // Through the engine's own helpers, not a second copy of the arithmetic.
    // The line these replaced added +1 Menace for a turned card — a stand-in
    // that was removed from the engine when real reverses landed, and left
    // here, so the bots had been over-rating every turned Threat since. A
    // policy that misprices the Street measures the wrong game.
    //
    // omenBase is unused: Omens are filtered out a line above.
    const clear = effectiveClear(sl);
    out.push({
      slot,
      remaining: (clear ?? Infinity) - sl.damage,
      menace: effectiveMenace(sl, 0),
      clearable: clear !== undefined,
    });
  });
  return out;
}

// ---------------------------------------------------------------- purchasing

interface Buyable { id: string; cost: number; isSign: boolean }

function buyable(view: ClientState, budget: number): Buyable[] {
  const out: Buyable[] = [];
  for (const ci of view.provisionRow) {
    const def = card(ci.cardId);
    if (def.cost !== undefined && def.cost <= budget) {
      out.push({ id: def.id, cost: def.cost, isSign: false });
    }
  }
  for (const id of SIGN_IDS) {
    const def = card(id);
    if (def.cost !== undefined && def.cost <= budget) {
      out.push({ id, cost: def.cost, isSign: true });
    }
  }
  return out.sort((a, b) => b.cost - a.cost);
}

/** Uniform pick — seeded, so runs stay reproducible. */
const anyOf = (xs: Buyable[], rand: () => number): string | null =>
  xs.length ? xs[Math.floor(rand() * xs.length)].id : null;

/** Dearest affordable, choosing at random between equals. */
const dearest = (xs: Buyable[], rand: () => number): string | null =>
  xs.length ? anyOf(xs.filter((x) => x.cost === xs[0].cost), rand) : null;

export const PURITAN: BuyPolicy = {
  name: 'Puritan',
  playsSign: never,
  pick: (v, b, r) => dearest(buyable(v, b).filter((x) => !x.isSign), r),
};

export const ZEALOT: BuyPolicy = {
  name: 'Zealot',
  playsSign: worthTheWhispers,
  // "Buys a Sign whenever affordable" — which Sign is unspecified, so spread
  // across all of them rather than fixating on one.
  pick: (v, b, r) => {
    const all = buyable(v, b);
    return anyOf(all.filter((x) => x.isSign), r) ?? dearest(all, r);
  },
};

/**
 * SAVER — the policy that only makes sense if Grit carries.
 *
 * Exists to answer a question the others cannot. Carry-over is worth almost
 * nothing as leftover CHANGE — measured, the bots end a turn holding 0.03 Grit
 * — because a bot cashes only what it needs for the card it has already picked.
 * What carry-over actually buys is the ability to SAVE: to decline the card in
 * front of you because a dearer one is two turns away. No other policy can
 * express that, so without this one a measurement of `gritCarries` measures
 * the change and calls it the strategy.
 *
 * It names the dearest Sign in the game whether or not it can afford it, so
 * `buyStep` cashes towards it and buys nothing until it can. With carry that is
 * patience; without it, it is throwing a card away every turn — which is the
 * contrast the comparison needs.
 */
export const SAVER: BuyPolicy = {
  name: 'Saver',
  playsSign: worthTheWhispers,
  pick: (v, _b, r) => {
    // Budget deliberately ignored — that is the whole policy.
    const all = SIGN_IDS.map((id) => ({ id, cost: card(id).cost ?? 0, isSign: true }))
      .sort((a, b) => b.cost - a.cost);
    void v;
    return dearest(all, r);
  },
};

export const GREEDY: BuyPolicy = {
  name: 'Greedy',
  playsSign: worthTheWhispers,
  pick: (v, b, r) => dearest(buyable(v, b), r),
};

/**
 * Signs only while the shared track has headroom — the "solve it" strategy, and
 * the one the design needs to be best.
 *
 * The default ratio is measured, not chosen. Sweeping it produces an interior
 * optimum: 0.00 (Puritan) 32.4%, **0.15 → 44.0%**, 0.30 → 40.4%, 0.50 → 40.8%,
 * 0.70 → 27.2%, 1.00 (Zealot) 19.2%. It sat at 0.5 for a long time, which
 * against a threshold of 26 only brakes for the last two rounds of Act I — near
 * enough a Greedy clone, which is why "the middle" looked no better than the
 * extremes.
 */
export function balanced(ratio = 0.15): BuyPolicy {
  return {
    name: 'Balanced',
    playsSign: worthTheWhispers,
    // Balanced stands for skilled play, so it buys the best card it can afford
    // rather than sampling the row — the random tie-break still spreads it
    // across same-cost Signs. Zealot stays uniform: it is an extreme, not a
    // model of good judgement.
    pick: (v, b, r) => {
      const all = buyable(v, b);
      const safe = v.whispers < v.whisperThreshold * ratio;
      return safe
        ? dearest(all.filter((x) => x.isSign), r) ?? dearest(all, r)
        : dearest(all.filter((x) => !x.isSign), r) ?? dearest(all, r);
    },
  };
}

export const BALANCED = balanced();

/**
 * The Marked player. "You do not sabotage. You encourage."
 *
 * Their secret aim is that at the Turning two OTHER players each hold 3+ Signs,
 * which is worth +3 starting Doom against the posse. They cannot make anyone buy,
 * so their only mechanical lever is *timing*: playing a Sign advances the shared
 * Whisper track and brings the Turning on, so a Marked player holds their Signs
 * back until the table has corrupted itself, then stops holding back.
 *
 * They buy Signs enthusiastically throughout — that is the "encourage" half, and
 * at a real table it is indistinguishable from playing well.
 */
export const AIM_SIGNS = 3;
export const AIM_PLAYERS = 2;

export const MARKED: BuyPolicy = {
  name: 'Marked',
  // Withhold until two others are corrupted — then stop holding back, but still
  // only spend Whispers on Signs that do something.
  playsSign: (v, ci) =>
    v.opponents.filter((o) => o.signsHeld >= AIM_SIGNS).length >= AIM_PLAYERS &&
    worthTheWhispers(v, ci),
  pick: (v, b, r) => {
    const all = buyable(v, b);
    return anyOf(all.filter((x) => x.isSign), r) ?? dearest(all, r);
  },
};

// ---------------------------------------------------------------- decisions

const findCmd = (legal: Command[], t: Command['t']) => legal.find((c) => c.t === t);

function endTurn(legal: Command[]): Command {
  return findCmd(legal, 'END_TURN') ?? legal[0];
}

/**
 * Answer a PendingChoice. Slot choices target the Threat we can actually
 * finish; player choices prefer ourselves, since every player-targeted op a
 * posse bot triggers (recover, draw) is a benefit.
 */
function resolvePending(view: ClientState, legal: Command[]): Command {
  const opts = view.pending?.options ?? [];
  const pickKey = (key: string) =>
    legal.find((c) => c.t === 'RESOLVE_CHOICE' && c.picks[0] === key);

  /*
    Dynamite's modal: bring down an Omen, or blast the Street.

    Handled FIRST and explicitly, because the generic slot ranking below
    filters Omens out of `threats()` — so without this the bot fell through to
    `legal[0]` and banished every single time, which would have measured the
    Scar pump at its ceiling rather than at anything a player would do.

    The trade is breadth against permanence. Two damage across N Threats is
    worth roughly 2N now; an Omen is worth a slot for ever, plus its Menace
    and its Whisper drip every Dusk. So: banish when the blast has little to
    hit, or when the Street is jammed and the dead slot is the actual problem.
    Otherwise take the value.

    Shared by every posse policy, like all threat handling — Puritan and Zealot
    differ only in what they BUY and whether they play Signs.
  */
  if (view.pending?.op === 'banishOmen') {
    const blastable = threats(view).length;
    const free = view.street.filter((sl) => sl === null).length;
    const omen = opts.find((o) => /^\d+$/.test(o.key));
    const worthIt = blastable <= 1 || free === 0;
    const cmd = worthIt && omen ? pickKey(omen.key) : pickKey(DECLINE_KEY);
    if (cmd) return cmd;
  }

  // `destroy` carries no magnitude, and clears any Threat outright.
  const amount = view.pending?.amount ?? Infinity;
  const hasVessel = opts.some((o) => o.key === VESSEL_KEY);
  const slotKeys = opts.filter((o) => /^\d+$/.test(o.key));

  if (slotKeys.length || hasVessel) {
    const ts = threats(view).filter((t) => slotKeys.some((o) => o.key === String(t.slot)));

    // Silencing a Threat is worth most against the one that hits hardest —
    // the opposite of where you want to spend damage.
    if (view.pending?.op === 'cancelMenace') {
      const worst = [...ts].sort((a, b) => b.menace - a.menace || b.remaining - a.remaining)[0];
      const cmd = worst && pickKey(String(worst.slot));
      if (cmd) return cmd;
    }

    // Spend damage where it is not wasted: finish a Threat this reaches,
    // removing its Menace and (in Act II) its Doom tick.
    const finishable = ts
      .filter((t) => t.clearable && t.remaining <= amount)
      .sort((a, b) => b.menace - a.menace || b.remaining - a.remaining)[0];
    if (finishable) {
      const cmd = pickKey(String(finishable.slot));
      if (cmd) return cmd;
    }

    // Otherwise the Vessel: it is the only thing that wins the game.
    if (hasVessel) {
      const cmd = pickKey(VESSEL_KEY);
      if (cmd) return cmd;
    }

    const ranked = ts.sort((a, b) => a.remaining - b.remaining || b.menace - a.menace);
    for (const t of ranked) {
      const cmd = pickKey(String(t.slot));
      if (cmd) return cmd;
    }
  }
  /*
    Which card comes back out of a boneyard.

    The options are card UIDs, so none of the branches above match them and
    this used to fall through to `legal[0]` — the oldest thing in the pile,
    which is the very behaviour the choice was added to replace. The bot would
    have gone on measuring the old rule under the new one.

    Ranked the way a player would: something that shoots first, then whatever
    is worth the most Grit.
  */
  /*
    Which Provision to take off the shelf for a Bounty.

    The options are row UIDs, so none of the branches above match them and this
    would fall through to `legal[0]` — the leftmost card, which is exactly the
    rule the choice replaced. Ninth time a mechanic would have gone on
    measuring its own predecessor.

    Ranked the way a player would: something that shoots, then the dearest
    thing on the shelf, since a Bounty is free and the expensive card is the one
    you would not otherwise have bought.
  */
  if (view.pending?.op === 'gainCard') {
    const row = view.provisionRow.filter((ci) => opts.some((o) => o.key === ci.uid));
    const ranked = [...row].sort((a, b) => {
      const da = damageOf(a), db = damageOf(b);
      if (da !== db) return db - da;
      return (card(b.cardId).cost ?? 0) - (card(a.cardId).cost ?? 0);
    });
    for (const ci of ranked) {
      const cmd = pickKey(ci.uid);
      if (cmd) return cmd;
    }
  }

  if (view.pending?.op === 'recover') {
    const byUid = new Map(
      opts.map((o) => [o.key, o.key]),
    );
    const pool = [...(view.you?.boneyard ?? []), ...view.opponents.flatMap((o) => o.boneyard)]
      .filter((ci) => byUid.has(ci.uid));
    const ranked = pool.sort((a, b) => {
      const da = damageOf(a), db = damageOf(b);
      if (da !== db) return db - da;
      return card(b.cardId).grit - card(a.cardId).grit;
    });
    for (const ci of ranked) {
      const cmd = pickKey(ci.uid);
      if (cmd) return cmd;
    }
  }

  /*
    Come and See: the least-corrupted seat.

    The aim is to spread Signs, not to deepen someone already lost — a player
    with five of them is buying more with or without the Grit. This is the
    ranking the deleted `BECKON` command's own branch used; it moved here with
    the mechanic, because the choice is now a prompt rather than a command.
  */
  if (view.pending?.op === 'beckon') {
    const bySigns = new Map(view.opponents.map((o) => [o.id, o.signsHeld]));
    const ranked = [...opts].sort(
      (a, b) => (bySigns.get(a.key) ?? 0) - (bySigns.get(b.key) ?? 0),
    );
    for (const o of ranked) {
      const cmd = pickKey(o.key);
      if (cmd) return cmd;
    }
  }

  const me = view.you?.id;
  if (me) {
    const mine = pickKey(me);
    if (mine) return mine;
  }
  return legal[0];
}

/**
 * A card that is worth nothing in the VESSEL's hand. Two kinds, and the second
 * is the one that is easy to miss.
 *
 *   1. It works for the posse — clears the Street, silences a Threat, shields
 *      somebody. Playing it is doing the enemy's work.
 *   2. It only wounds the VESSEL, which is this seat. `choiceOptions` never
 *      offers a player itself as a damage target, so the op cannot resolve —
 *      but the card's appended cost still does, and those faces trash a card
 *      off the deck by design. Playing one spends an action to pay a price for
 *      nothing.
 *
 * Aimed, because the Vessel aims its own Fevered cards and that is the version
 * it would actually resolve.
 */
function deadForTheVessel(ci: { cardId: string; fevered: boolean }): boolean {
  const ops = opsFor(card(ci.cardId), ci.fevered, true);
  if (!ops.length) return false;
  const inert = (op: Op) =>
    op.op === 'destroy'
    || op.op === 'damage'          // at the Street, or at a Vessel that is us
    || op.op === 'cancelMenace'
    || op.op === 'shield'
    || op.op === 'banishOmen';
  // Not "every op is inert" — a card that also draws or whispers is worth the
  // action. Dead means nothing on it does anything for this seat.
  return ops.every((op) => inert(op) || op.op === 'trash');
}

/**
 * The fallen. "A Revenant wins if and only if the Vessel wins", so their whole
 * job is to push the table toward the Turning and toward corruption — the
 * opposite of what their cards do if played carelessly, since most Fevered faces
 * clear Threats and that helps the posse.
 *
 * Act I: play Come and See toward a Sign, else Whisper. Act II: Whispers and
 * Beckons are spent currency, and playing a card would mostly help the posse,
 * so they sit still and let their deck burn down.
 */
function fallenMove(view: ClientState, legal: Command[]): Command {
  if (view.act === 'trouble') {
    /*
      Come and See, the card the Revenant is granted every turn.

      Found by TYPE, not by id: a bot that hard-codes a card id is a bot that
      silently stops using a mechanic the moment the card is renamed, and
      "suspect the bots first" has been the answer to a dead mechanic four
      times in this project. Who it names is decided in `resolvePending`.
    */
    const beckon = view.you?.hand.find((ci) => card(ci.cardId).type === 'revenant');
    if (beckon) {
      const cmd = legal.find((c) => c.t === 'PLAY_CARD' && c.uid === beckon.uid);
      if (cmd) return cmd;
    }
    const whisper = findCmd(legal, 'REVENANT_WHISPER');
    if (whisper) return whisper;
  }

  // Anything that eats every deck hurts the posse more than the Vessel.
  const spite = view.you?.hand.find((ci) =>
    opsFor(card(ci.cardId), ci.fevered).some(
      (op) => op.op === 'trash' && op.target === 'all',
    ),
  );
  if (spite) {
    const cmd = legal.find((c) => c.t === 'PLAY_CARD' && c.uid === spite.uid);
    if (cmd) return cmd;
  }
  return endTurn(legal);
}

/**
 * The Vessel plays cards now, so there is no Vessel policy left.
 *
 * CALL, SUMMON, SHUTTER, OFFER and WHISPER were five bespoke commands and this
 * was the heuristic that ranked them. Their effects are ops on cards in the
 * Vessel's deck, so the seat reaches them through PLAY_CARD like everybody
 * else — which means the shared play/spend/buy logic below already covers it,
 * and a separate policy would be a second opinion about the same decisions.
 *
 * What used to be "which button is best" is now "which card is in hand", and
 * that is the point of the change rather than a side effect of it.
 */

/**
 * The Marked player, once the mask is off.
 *
 * **They win if and only if the Old One's side does**, and until now they were
 * driven by the shared posse logic — which in Act II hunts the Vessel with
 * every Vessel-facing card in hand. The traitor was playing to lose, in every
 * game the simulator has ever run with one.
 *
 * The cause was a rule that is right for a different reason: CLAUDE.md
 * requires policies to differ only in `pick` and `playsSign`, so that threat
 * handling cannot confound the Puritan-vs-Zealot headline. That rule is about
 * POSSE policies. The traitor is not one, and nothing noticed.
 *
 * What they do here is the mirror of the posse's Act II:
 *
 *   - never aim at the Vessel. Burying it is losing.
 *   - play Signs for the Whispers. The track feeds Doom now, and Doom is how
 *     their side wins — this is the same "encourage" gesture as Act I, and it
 *     still looks like enthusiasm rather than sabotage.
 *   - do NOT clear Threats. A Threat left standing menaces the posse and ticks
 *     Doom at Dusk. Sitting still is a real move for this seat.
 *   - keep buying Signs, which in Act II feeds the track directly.
 *
 * Deliberately not "attack the posse": a traitor who starts shooting allies is
 * a traitor everyone can see, and the design is that encouragement is
 * indistinguishable from playing well.
 */
function markedMove(
  view: ClientState, legal: Command[], policy: BuyPolicy, rand: () => number,
): Command {
  const you = view.you!;
  const play = (uid: string) =>
    legal.find((c) => c.t === 'PLAY_CARD' && c.uid === uid);

  // Anything that would wound the Vessel is off the table, whatever else it does.
  const safe = you.hand.filter((ci) => vesselDamageOf(ci) === 0 && !selfHarming(ci));

  // Whispers first: the track is the clock their side wins on.
  const loud = safe
    .filter((ci) => (card(ci.cardId).whispers ?? 0) > 0)
    .sort((a, b) => (card(b.cardId).whispers ?? 0) - (card(a.cardId).whispers ?? 0))[0];
  if (loud) {
    const cmd = play(loud.uid);
    if (cmd) return cmd;
  }

  // Then buy — Signs bought in Act II feed the track too.
  const spendable = you.hand.filter((ci) => card(ci.cardId).grit > 0);
  const budget = you.grit + spendable.reduce((n, ci) => n + card(ci.cardId).grit, 0);
  const target = policy.pick(view, budget, rand);
  if (target) {
    const buy = legal.find((c) => c.t === 'BUY' && c.cardId === target);
    if (buy) return buy;
    const best = spendable.sort((a, b) => card(b.cardId).grit - card(a.cardId).grit)[0];
    const spend = best && legal.find((c) => c.t === 'SPEND_GRIT' && c.uids[0] === best.uid);
    if (spend) return spend;
  }

  // Otherwise sit on it. Threats left standing are doing their work for them.
  return endTurn(legal);
}

/**
 * Buy something, or cash a card in towards it. The only step that differs
 * between policies — and the reason it is a function of its own.
 *
 * Buying costs no action by default (`buyCostsAction`), so this has to be
 * reachable from a turn with no actions left as well as from the middle of
 * one. It was inline in the turn loop, below a guard that ended the turn the
 * moment `actionsLeft` hit zero, which meant the free purchase was legal and
 * no bot ever made one. That is the seventh time a mechanic has "done nothing"
 * because of the bots; the fix is that there is now exactly one buy step and
 * both callers reach it.
 */
function buyStep(
  view: ClientState, legal: Command[], policy: BuyPolicy, rand: () => number,
): Command | null {
  const you = view.you;
  if (!you || you.status !== 'posse') return null;
  const ts = threats(view);
  const bury = view.act === 'mythos' && view.vessel !== null;
  /*
    What you would cash in rather than play.

    The `opsFor().length === 0` clause is doing more work than it looks:
    it is "this card has no effect worth keeping". Giving a blank card ANY
    effect used to drop it out of this list entirely, and since nothing
    played it either, the card became unspendable and unplayable at once —
    purchases fell by two thirds and every arm of the Saddlebag experiment
    measured identically, because the bot had stopped touching the card in
    both directions.

    There is no such card in the set today — the experiment that produced
    this note concluded against adopting one — but the shape of the trap is
    worth keeping: if a card ever gains an effect that can always WAIT, it
    needs a clause here as well as somewhere that plays it, or it silently
    becomes untouchable in both directions.
  */
  const spendable = you.hand.filter(
    (ci) =>
      card(ci.cardId).grit > 0 &&
      (opsFor(card(ci.cardId), ci.fevered).length === 0 ||
        selfHarming(ci) ||
        (damageOf(ci) > 0 && ts.length === 0 && !bury) ||
        (isDefensive(ci) && !ts.some((t) => t.menace > 0)) ||
        (card(ci.cardId).type === 'sign' && !policy.playsSign(view, ci))),
  );
  const budget = you.grit + spendable.reduce((n, ci) => n + card(ci.cardId).grit, 0);
  const target = policy.pick(view, budget, rand);
  if (!target) return null;
  const buy = legal.find((c) => c.t === 'BUY' && c.cardId === target);
  if (buy) return buy;
  // Not enough Grit in hand yet: cash a card. Spending costs no action.
  const best = spendable.sort((a, b) => card(b.cardId).grit - card(a.cardId).grit)[0];
  return (best && legal.find((c) => c.t === 'SPEND_GRIT' && c.uids[0] === best.uid)) ?? null;
}

// ---------------------------------------------------------------- the bot

export function makeBot(policy: BuyPolicy): Bot {
  return ({ view, legal, rand }) => {
    if (!legal.length) throw new Error('makeBot called with no legal commands');
    if (view.pending) return resolvePending(view, legal);

    const you = view.you;
    if (!you) return endTurn(legal);
    if (you.status === 'revenant') {
      return fallenMove(view, legal);
    }
    // Out of actions is not out of turn: buying is free, so the last thing a
    // posse seat does is spend what it earned.
    if (view.actionsLeft <= 0) {
      return buyStep(view, legal, policy, rand) ?? endTurn(legal);
    }

    /*
      The traitor, after the Turning. Their side is the Old One's, and the
      shared logic below is written for people trying to bury the Vessel.
    */
    if (view.act === 'mythos' && you.role === 'marked' && you.status === 'posse') {
      return markedMove(view, legal, policy, rand);
    }

    /*
      The Vessel: play whatever is in hand.

      It needs its own branch, and the reason is worth keeping. Everything
      below is posse reasoning — finish a Threat, aim at the Vessel, buy — and
      a Vessel card matches none of those, so the seat fell straight through to
      END_TURN and played ZERO cards in 250 games. The measurement said the
      posse won 52.8%, which is what an opponent that does nothing looks like.
      Sixth time a new mechanic has "done nothing" because of the bots.

      No ranking. Every card in that deck is worth playing when drawn, which is
      exactly what rationing by the draw is supposed to mean — and a heuristic
      here would be the bespoke action menu growing back inside the bot.
    */
    if (you.status === 'vessel') {
      /*
        "Every card in that deck is worth playing" stopped being true when the
        deck stopped being only Vessel cards.

        The Vessel keeps its own Signs at the Turning, and 37% of its deck is
        them — Fevered Colts and Dynamite that CLEAR THE STREET. Playing those
        is the Vessel doing the posse's work: measured at 95 Threats destroyed
        by the Vessel across 150 games before this branch existed, and 182 plays
        whose whole effect helps the table it is hunting.

        Held back rather than ranked. The seat cannot cash them in either, so a
        posse-facing Sign in that hand is simply a dead card — which is the
        thing `vesselKeepsSigns` exists to ask about.
      */
      const useful = you.hand.filter((ci) => !deadForTheVessel(ci));
      const mine = useful.find((ci) =>
        legal.some((c) => c.t === 'PLAY_CARD' && c.uid === ci.uid));
      const cmd = mine && legal.find((c) => c.t === 'PLAY_CARD' && c.uid === mine.uid);
      if (cmd) return cmd;
      /*
        Nothing worth playing — burn the corruption instead.

        Posse-facing Signs FIRST, because those are the dead ones: they cannot
        be played without helping the table and cannot be cashed in. A Sign that
        does something to the posse is worth holding for the turn it is worth
        playing, so it is burned only when nothing else is left.
      */
      const burnable = legal.filter((l) => l.t === 'BURN_SIGN');
      if (burnable.length) {
        const dead = burnable.find((l) => {
          const ci = you.hand.find((h) => h.uid === (l as { uid: string }).uid);
          return ci && deadForTheVessel(ci);
        });
        return dead ?? burnable[0]!;
      }
      return endTurn(legal);
    }

    /*
      Everyone else. `playsSign` gates Signs by policy; `selfHarming` keeps a
      card that only hurts you out of the list.
    */
    const playable = you.hand.filter(
      (ci) =>
        !selfHarming(ci) &&
        (card(ci.cardId).type !== 'sign' || policy.playsSign(view, ci)),
    );
    const play = (uid: string) =>
      legal.find((c) => c.t === 'PLAY_CARD' && c.uid === uid);
    const ts = threats(view);

    // A. Finish a Threat outright. Always worth an action — an uncleared
    //    Threat deals its Menace at Dusk.
    for (const ci of playable) {
      const dmg = damageOf(ci);
      if (!dmg) continue;
      if (ts.some((t) => t.clearable && t.remaining <= dmg)) {
        const cmd = play(ci.uid);
        if (cmd) return cmd;
      }
    }

    // Act II with a Vessel standing: burying is the win condition, and the
    // only way there now is a card aimed at it. There is no bare damage action
    // to read this off any more, so ask the state directly.
    const bury = view.act === 'mythos' && view.vessel !== null;

    // B. Act II: aim the deck at the Vessel. Nothing pays a Bounty now, so
    //    clearing Threats is pure defence and burying is the win condition.
    if (bury) {
      for (const ci of playable) {
        if (vesselDamageOf(ci) > 0) {
          const cmd = play(ci.uid);
          if (cmd) return cmd;
        }
      }
    }

    // C. Buy — the only step that differs between policies. Buying is also
    //    healing (DESIGN.md §5), so it stays a high priority.
    {
      const cmd = buyStep(view, legal, policy, rand);
      if (cmd) return cmd;
    }

    // D. Card advantage.
    for (const ci of playable) {
      if (isUtility(ci)) {
        const cmd = play(ci.uid);
        if (cmd) return cmd;
      }
    }

    // D2. Blunt what is coming. A Salt Line keeps until it is spent, and a
    //     Night Watch silences a Threat for the round, so both are worth an
    //     action whenever anything in the Street actually hits.
    if (ts.some((t) => t.menace > 0)) {
      for (const ci of playable) {
        if (isDefensive(ci)) {
          const cmd = play(ci.uid);
          if (cmd) return cmd;
        }
      }
    }

    // E. Nothing worth playing. There is no bare damage action to fall back on
    //    any more — that was the button that made a blocked Street into three
    //    clicks. What is left is a Toll: pay a Sign and a Scar to be rid of
    //    something nothing can shoot. Only when the Street is genuinely stuck,
    //    because paying it while a Threat is still killable is worse than the
    //    blockage.
    const stuck = ts.length === 0 || ts.every((t) => !t.clearable);
    const toll = legal.find((c) => c.t === 'PAY_TOLL');
    if (toll && stuck) return toll;

    // F. Chip the biggest Threat.
    if (ts.length) {
      for (const ci of playable) {
        if (damageOf(ci) > 0) {
          const cmd = play(ci.uid);
          if (cmd) return cmd;
        }
      }
    }

    return endTurn(legal);
  };
}

/** Uniform over legal commands. The noise floor every other policy must beat. */
export const randomBot: Bot = ({ legal, rand }) =>
  legal[Math.floor(rand() * legal.length)] ?? legal[0];

/**
 * Balanced at several Whisper ratios. "The middle" is not one strategy — it is a
 * dial, and which setting is best is a measurement, not an assumption. At 0.5
 * against the tuned threshold the brake only engages for the last two rounds of
 * Act I, which made it a Greedy clone.
 */
export const BALANCED_RATIOS = [0.15, 0.3, 0.5, 0.7];

export const POLICIES: Record<string, Bot> = {
  Random: randomBot,
  Greedy: makeBot(GREEDY),
  Puritan: makeBot(PURITAN),
  Zealot: makeBot(ZEALOT),
  Balanced: makeBot(BALANCED),
  Marked: makeBot(MARKED),
  Saver: makeBot(SAVER),
  ...Object.fromEntries(
    BALANCED_RATIOS.map((r) => [`Bal${Math.round(r * 100)}`, makeBot(balanced(r))]),
  ),
};

export const POLICY_NAMES = Object.keys(POLICIES);

/** Exported for the sim's own tests. */
export const _internals = { threats, damageOf, buyable, selfHarming };

export type { Target };
