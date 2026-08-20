// Core state types. Everything here must be JSON-serializable:
// no class instances, no functions, no Dates, no Maps/Sets.

export type PlayerId = string;
export type CardId = string;

export type Phase = 'dawn' | 'day' | 'dusk' | 'turning' | 'over';
export type Act = 'trouble' | 'mythos';
/**
 * What a seat IS. Every member of this union is a player at the table.
 *
 * `vessel` is the one the Old One is using. There is deliberately no `oldOne`
 * status: the Old One is not a player and has no seat — see the note on
 * `GameState.vessel`.
 */
export type Status =
  | 'posse'
  | 'revenant'
  | 'vessel'
  | 'gone';

export type Role = 'faithful' | 'marked';

// ---------------------------------------------------------------- cards

export type CardType =
  | 'kit'
  | 'deed'
  | 'sign'
  | 'scar'
  | 'trouble'
  | 'omen'
  | 'mythos'
  /**
   * A card in the Vessel's deck, and nothing else.
   *
   * Its own type rather than a Sign, because `signsHeld` counts Signs and the
   * Marked player's secret aim and `menacePerSign` both read that count — a
   * Vessel holding ten of these would read as the most corrupt seat at the
   * table by a mile. Never in the market, never bought, never shuttered.
   */
  | 'vessel'
  /**
   * The one card a Revenant is granted, and nothing else.
   *
   * Not in their deck. A Revenant's deck is their health — it shrinks by
   * `revenantDecay` a recycle and when it is empty they are gone — so a card
   * living in it would be a card that both extends their life and gets buried
   * by their own burn-out. Granted at the start of each of their turns and
   * gone at the end of it, so it never touches deck, discard or hand size.
   */
  | 'revenant';

export type Target =
  | 'self'
  | 'choose'
  | 'left'
  | 'all'
  | 'mostSigns'
  | 'fewestCards'
  | 'leftmostSlot'
  /**
   * One occupied slot, drawn from the state RNG cursor.
   *
   * Deterministic — `randInt(seed, rngCursor)` and the cursor advances — but
   * OPAQUE to the player, which is the point. A replay picks the same slot; a
   * player cannot know which before they commit.
   */
  | 'random'
  /**
   * The occupied slot with the lowest EFFECTIVE Clear, escalation included.
   *
   * Reliably wrong rather than wrong on average: it spends itself on the
   * easiest thing on the board while the Threat that has been growing since
   * round two keeps growing.
   */
  | 'lowestClear'
  /**
   * Whatever `tuning.coltFeveredTarget` says one of the above is.
   *
   * The card face says "It Chooses"; this is the indirection that lets the
   * simulator ask what choosing should MEAN without editing content. Content
   * declares the fiction, TUNING decides the mechanism.
   */
  | 'itChooses'
  /** Omen slots only — the exact inverse of what `damage` may touch. */
  | 'omen'
  | 'firstTriggered'
  /** The Vessel, hit without a choice. Only meaningful for `damage` in Act II. */
  | 'vessel';

export type Op =
  | { op: 'draw'; n: number; target: Target }
  | { op: 'damage'; n: number; target: Target }
  | { op: 'grit'; n: number }
  | { op: 'actions'; n: number }
  | { op: 'whisper'; n: number }
  /**
   * `kind` narrows what may be taken. Without it, trashing takes anything but a
   * Sign — damage eats your Provisions first, which is what makes a wounded
   * player more corrupt. A Toll that asks for a Sign has to say so.
   */
  | { op: 'trash'; n: number; from: 'hand' | 'deck'; target: Target; kind?: CardType }
  | { op: 'gainCard'; filter: CardFilter; target: Target }
  | { op: 'destroy'; target: Target }
  /**
   * "May instead destroy one Omen; if it does, <target> takes a Scar."
   *
   * The only answer to an Omen in the game, and it is a modal: offered a
   * choice, the player either takes an Omen or declines. Taking one **clears
   * the rest of the resolution queue**, which is what the word "instead"
   * means — everything the card would otherwise have done is skipped.
   *
   * `target` is who pays the Scar, so the Fevered face is an ordinary
   * `retarget` from `self` to `all` rather than a second mechanism.
   */
  | { op: 'banishOmen'; target: Target }
  /**
   * IT REMEMBERS YOUR NAME. Look at the top card of a chosen player's deck; if
   * it is a Sign, it resolves Fevered against them.
   *
   * **Looks at, does not reveal**, and that distinction is load-bearing. A
   * non-Sign goes back on top untouched and is never named in any event, so
   * nothing about that deck escapes. The earlier version discarded the card
   * either way — and `playerView` publishes every discard pile in full, so the
   * card was public the instant it landed there. Keeping it out of the
   * chronicle would have hidden the sentence and not the information.
   */
  | { op: 'callSign'; target: Target }
  /**
   * COME AND SEE. Name a living player; the next Sign they buy pays them Grit.
   *
   * An op on a card rather than the bare `BECKON` command it replaces. The
   * command was a naked button reading "Beckon p1" — no rules text, no card,
   * and a separate row of one button per seat. The card says what beckoning
   * does and asks who through the ordinary `target: 'choose'` prompt.
   */
  | { op: 'beckon'; target: Target }
  /** SOMETHING COMES UP THE STREET. A Mythos card into an empty slot. */
  | { op: 'summon' }
  /** NOT THAT ONE. Name a card type; nobody may play it next round. */
  | { op: 'shutter' }
  /**
   * A GIFT, FREELY GIVEN. A chosen player gains a Fevered Sign on a timer.
   *
   * Not `gainCard`: that hands over a clean card with no string on it. The
   * string — `offeredUntil`, and the Whispers it pays if they take the bait —
   * is the whole card.
   */
  | {
      op: 'gift'; target: Target;
      /**
       * The recipient, once picked. Absent on the printed card.
       *
       * A GIFT, FREELY GIVEN asks twice — who, then which Sign — and this is
       * how one op spans two prompts without new machinery: the first
       * resolution re-queues the op with `to` filled in, and `choiceOptions`
       * offers Signs instead of players the second time round.
       *
       * A field on the op rather than a scratch slot on `GameState`, so the
       * half-made decision travels in the resolution queue and survives being
       * serialised mid-choice like everything else does.
       */
      to?: PlayerId;
    }
  /**
   * DOC MIRELES' BAG / PARSON GRIMM. A card out of the boneyard, chosen.
   *
   * Two prompts, like `gift`, and for the same reason: who, then which. It used
   * to take the FIRST non-Sign in the boneyard — insertion order, so the oldest
   * thing you lost — which is deterministic and looks exactly like a dice roll
   * from the far side of the table. The project already ruled on this shape for
   * `trash`: a rule you can see is a rule you can play around, one you cannot is
   * just a card appearing.
   */
  | {
      op: 'recover'; target: Target;
      /** Whose boneyard, once picked. Absent on the printed card. */
      from?: PlayerId;
    }
  /**
   * Night Watch: cancel one Threat's Menace for this round. Targets a Street
   * slot. Was modelled as a single `prevent` op shared with Salt Line, which
   * conflated two different things — one stops a Threat attacking, the other
   * absorbs damage on a player.
   */
  | { op: 'cancelMenace'; target: Target }
  /** Salt Line: a pool of damage absorbed before cards are trashed. */
  | { op: 'shield'; n: number; target: Target }
  | { op: 'discardHand'; target: Target }
  | { op: 'revealHand'; target: Target }
  | { op: 'scry'; n: number; target: Target }
  /** Grit banked for the holder's next turn — several Act I Bounties pay this. */
  | { op: 'gritNextTurn'; n: number; target: Target }
  /**
   * A permanent dead card. DESIGN.md §8: Grit 0, no effect, untrashable ballast.
   *
   * The price of the things you cannot pay for any other way — a Toll, or
   * burying a Sign on purpose.
   */
  | { op: 'scar'; n: number; target: Target }
  /**
   * Hand over Grit you have earned this turn. A price, not an effect.
   *
   * Its own op because `canPay` has to be able to ask "could you afford this"
   * BEFORE the button is offered — `legalCommands` only shows a Toll the player
   * can actually meet, and a button that throws is worse than no button. A
   * negative `grit` would have been a price the checker could not see.
   */
  | { op: 'payGrit'; n: number };

export interface CardFilter {
  type?: CardType;
  maxCost?: number;
  from?: 'provisionRow' | 'signs';
}

export type Constraint = 'mustPlayOnDraw' | 'mustBuySignIfAble';

export interface FeveredOverride {
  name: string;
  /** op index -> replacement target. The primary corruption mechanism. */
  retarget?: Record<number, Target>;
  /**
   * A price paid AFTER the effect. The common case.
   *
   * The card does what it does, and then something is taken — you fire the
   * Colt and then trash a card off your own deck.
   */
  appendOps?: Op[];
  /**
   * A price paid BEFORE the effect, and the difference is not cosmetic.
   *
   * Paying first means the effect resolves against the world the payment made.
   * "The Ledger Reads Itself" is the case that forced this: as
   * `appendOps: [discardHand]` it drew three cards and then threw the whole
   * hand away, which is not a card anybody plays. Prepended, the same two ops
   * are a wheel — dump the hand you are stuck with, deal three fresh — and the
   * corruption is that you no longer get to keep what you were holding.
   *
   * This is the fourth mechanism in the schema bet and it was added on
   * evidence, not appetite: order is genuinely inexpressible with the other
   * three, and "cost up front" vs "cost after" is a distinction any deck
   * builder makes. If a FIFTH mechanism starts looking necessary, that is the
   * signal CLAUDE.md warns about — reconsider the abstraction rather than
   * extend it again.
   */
  prependOps?: Op[];
  constraints?: Constraint[];
}

export interface Card {
  id: CardId;
  name: string;
  type: CardType;
  cost?: number;
  grit: number;
  whispers?: number;
  ops: Op[];
  constraints?: Constraint[];
  fevered?: FeveredOverride;
  /** Threat fields */
  clear?: number;
  menace?: number;
  /**
   * Act I only: what clearing this Threat pays the player who cleared it.
   * "Nothing in Act II pays a Bounty. Ever." — this is the economy inversion
   * in DESIGN.md §7, and the reason Act I combat is generative.
   */
  /**
   * A line of the world, printed under the rules.
   *
   * DESIGN.md §1: ballad and scripture, invented frontier folklore. It carries
   * no mechanics and the engine never reads it — but it is the only place the
   * tone of the game reaches a player who is only looking at their hand.
   */
  flavour?: string;
  bounty?: Op[];
  /**
   * What it costs to be rid of this, when damage cannot do it.
   *
   * DESIGN.md §7: Bounty in Act I, Toll in Act II — the same third line, the
   * opposite arithmetic. A Threat with a Toll and no Clear is not an
   * obstruction, it is a price.
   */
  toll?: Op[];
  /** Trouble card this flips to at the Turning. "Cards with no reverse stay." */
  reverse?: CardId;
  /** Who this Threat's Menace hits. Defaults to the player holding most Signs. */
  menaceTarget?: Target;
  /** Fires whenever this is cleared, in either Act — unlike `bounty`. */
  onCleared?: Op[];
  /** Cannot be cleared while any Omen occupies the Street. */
  noClearWhileOmen?: boolean;
  /** Effects not yet modelled by the op interpreter (milestone 1 stub). */
  passive?: string;
}

/** A card instance in play: template id plus per-copy state. */
export interface CardInstance {
  uid: string;
  cardId: CardId;
  fevered: boolean;
  /**
   * A gift from the Vessel, and the round the string on it runs out.
   *
   * Set by OFFER. Playing it on or before this round pays the Vessel — which
   * is the trap. Per instance, because the gift is this copy and not every copy
   * of that Sign everywhere.
   */
  offeredUntil?: number;
  /**
   * Round this was bought, when it was bought straight into a hand.
   *
   * Only set under `buyToHand`, and only to stop the loop that rule opens: five
   * cards cost exactly what they cash in for, and neither buying nor cashing
   * spends an action, so buy-and-sell-back is free and unbounded. Beckoned, it
   * is unbounded and PROFITABLE — `beckonGrit` pays for buying a Sign, and
   * three of the five are Signs.
   *
   * So: a card you bought is yours to use this turn, not to sell back.
   */
  boughtRound?: number;
}

// ---------------------------------------------------------------- players

export interface PlayerState {
  id: PlayerId;
  name: string;
  role: Role; // SECRET until revealed
  status: Status;
  deck: CardInstance[]; // SECRET (order)
  hand: CardInstance[]; // SECRET
  discard: CardInstance[]; // public
  boneyard: CardInstance[]; // public - trashed
  scars: number;
  gritThisTurn: number;
}

export interface StreetSlot {
  instance: CardInstance;
  damage: number;
  turned: boolean;
  enteredRound: number;
  /**
   * How far this Threat has grown past its printed values.
   *
   * Per SLOT, never per card. `Card` in content/cards.ts is a shared template:
   * bumping `card.clear` would escalate every copy of that Threat everywhere,
   * including the ones still face down in the deck. Two Rustlers in the Street
   * escalate independently, and a third revealed next round arrives at base.
   *
   * Read it through `effectiveClear` / `effectiveMenace`, never directly.
   */
  escalation: number;
  /** Set by Night Watch; cleared every Dawn. */
  menaceCancelled?: boolean;
}

// ---------------------------------------------------------------- choices

export interface PendingChoice {
  id: string;
  player: PlayerId;
  prompt: string;
  /**
   * `cardId` names the card an option stands for, when it stands for one.
   *
   * The client draws a face instead of a button whenever it is there. The KEY
   * cannot carry this on its own — a scried Threat, a card in a boneyard and a
   * Provision on the shelf are all keyed by uid, because a pile can hold two of
   * the same card and "a Saddlebag" is not an instruction when it does.
   *
   * No leak: `playerView` sends `pending` only to the player it belongs to, and
   * that player is already being told the card's NAME.
   */
  options: { key: string; label: string; cardId?: CardId }[];
  min: number;
  max: number;
  /**
   * Magnitude of the op awaiting a target, when it has one. A chooser needs it
   * to spend damage well — "2 damage: finish the Threat, or feed the Vessel?"
   */
  amount?: number;
  /** Which op is asking. A chooser wants very different things for `damage`
   *  (spend it where it is not wasted) and `cancelMenace` (silence the worst). */
  op?: Op['op'];
}

/** Suspended op queue. Serializable - deliberately not a generator. */
export interface Resolution {
  queue: Op[];
  controller: PlayerId;
  sourceCardId: CardId | null;
}

// ---------------------------------------------------------------- events

export type GameEvent =
  | { t: 'DREW'; player: PlayerId; n: number }
  /**
   * A player's discard has been shuffled back under them.
   *
   * Public — at a real table everyone watches you pick the pile up — and worth
   * announcing: a deck cycling is when your Signs come round again, and for a
   * Revenant it is the moment they shrink.
   */
  | { t: 'RESHUFFLED'; player: PlayerId; n: number }
  /**
   * Cards put onto a discard pile by the player who owned them.
   *
   * Counts only, never card ids: which cards are in a discard pile is public,
   * but this event crosses to every seat and a list here would be a second
   * channel to keep honest. `playerView` already publishes the pile.
   *
   * `hand` distinguishes the two gestures — sweeping a whole hand away at the
   * end of a turn, and putting one card down during it. They sound different
   * and they mean different things, and a count cannot tell them apart: a turn
   * that played four of five cards ends by sweeping exactly one.
   *
   * Deliberately silent in the chronicle. It exists so the client has ONE
   * source of truth for "a card went to a discard pile" rather than inferring
   * it from GRIT here and a turn change there; what actually mattered — the
   * cash-in, the turn ending — is already narrated by the thing that caused it.
   */
  | { t: 'DISCARDED'; player: PlayerId; n: number; hand: boolean }
  | { t: 'PLAYED'; player: PlayerId; cardId: CardId; fevered: boolean }
  | { t: 'BOUGHT'; player: PlayerId; cardId: CardId }
  /**
   * Grit arrived. `cards` names what was cashed in to get it.
   *
   * Absent when the Grit came from a card's effect instead — Lantern Oil hands
   * you some without anything leaving your hand, and a log that said "cashed
   * in" for that would be describing a move nobody made.
   */
  | { t: 'GRIT'; player: PlayerId; amount: number; cards?: CardId[] }
  | { t: 'DAMAGED'; player: PlayerId; amount: number; trashed: CardId[] }
  | { t: 'THREAT_DAMAGED'; slot: number; amount: number }
  | { t: 'THREAT_CLEARED'; slot: number; cardId: CardId }
  | { t: 'BOUNTY'; player: PlayerId; cardId: CardId }
  | { t: 'THREAT_ENTERED'; slot: number; cardId: CardId }
  | { t: 'VESSEL_DAMAGED'; amount: number; total: number; by: PlayerId }
  | { t: 'VESSEL_DAMAGE_RESET'; cardId: CardId; lost: number }
  | { t: 'MENACE'; slot: number; cardId: CardId; player: PlayerId; amount: number }
  | { t: 'MENACE_CANCELLED'; slot: number; by: PlayerId }
  | { t: 'TOLL_PAID'; slot: number; cardId: CardId; player: PlayerId }
  | { t: 'SHUTTERED'; cardType: CardType; untilRound: number }
  /**
   * IT REMEMBERS YOUR NAME looked at somebody's deck.
   *
   * `cardId` is present ONLY when the card resolved — everyone watched that
   * happen, so it is already public. A card that was not a Sign went back on
   * top untouched and is not named here, because the event itself is the leak
   * vector: `visibleEvents` broadcasts it to every seat, so anything in it is
   * public whatever the chronicle chooses to print.
   */
  | { t: 'NAME_READ'; player: PlayerId; resolved: boolean; cardId?: CardId }
  | { t: 'OFFERED'; by: PlayerId; target: PlayerId; cardId: CardId }
  | { t: 'OFFER_TAKEN'; player: PlayerId; cardId: CardId; whispers: number }
  | {
      t: 'ESCALATED'; slot: number; cardId: CardId;
      /** The new effective values, not the increment. */
      clear: number | null; menace: number;
    }
  | { t: 'SHIELDED'; player: PlayerId; amount: number }
  | { t: 'PREVENTED'; player: PlayerId; amount: number }
  | { t: 'SCRIED'; player: PlayerId; cardId: CardId }
  | { t: 'WHISPERS'; delta: number; total: number }
  /**
   * The Whisper track filled and broke over. Act II only.
   *
   * `fill` is which one this is (1-based), because the Doom escalates and the
   * table wants to know it is escalating. `total` is what is LEFT on the bar
   * afterwards — the remainder carries, so a big gain can fill the bar twice
   * and still leave something behind, and each fill reports its own remainder.
   */
  | { t: 'WHISPER_FILL'; fill: number; doom: number; total: number }
  | { t: 'DOOM'; delta: number; total: number }
  | { t: 'FELL'; player: PlayerId; became: Status }
  | { t: 'LAST_WORDS'; player: PlayerId; fevered: boolean; kept: number }
  | { t: 'BURNED_OUT'; player: PlayerId }
  | { t: 'BECKONED'; by: PlayerId; target: PlayerId }
  | { t: 'TURNING'; vessel: PlayerId; marked: PlayerId; aimMet: boolean }
  | { t: 'PHASE'; phase: Phase; round: number }
  | { t: 'CHOICE_REQUIRED'; player: PlayerId; prompt: string }
  | { t: 'GAME_OVER'; winner: 'posse' | 'oldOne' };

// ---------------------------------------------------------------- game

export interface Tuning {
  whisperThreshold: number;
  vesselClear: number;
  doomTarget: number;
  handSize: number;
  actionsPerTurn: number;
  /**
   * Whether a purchase spends one of them.
   *
   * Off, and the turn separates into the two halves a deck builder usually has:
   * actions do things to the board, Grit buys, and the two no longer compete.
   * Grit is then the only limit on buying — which it already was on the turns
   * that mattered, since cashing in has never cost an action either.
   *
   * A switch rather than a deletion, because it moves every number in the game
   * at once and `sweep` takes any numeric TUNING key as an axis.
   */
  buyCostsAction: boolean;
  /**
   * Whether unspent Grit survives the end of your turn.
   *
   * Off, it evaporates: cash a 3-Grit Winchester for a 2-cost card and the
   * spare point is gone, so every turn's money has to be spent the turn it is
   * earned. On, it banks — and the interesting consequence is not the extra
   * Grit, it is that SAVING becomes a move. A player can decline the cheap
   * card in front of them to afford the dear one next turn.
   *
   * Which is also why a simulation of this reads LOW: the bots buy the dearest
   * card they can afford right now and have no concept of holding back. What
   * they measure is the leftover change accumulating, not the strategy.
   */
  gritCarries: boolean;
  /**
   * Whether a purchase lands in your HAND rather than your discard.
   *
   * Off is the deck-builder default: what you buy is a promise about a future
   * shuffle. On, it is a tool you can use this turn — which changes what buying
   * IS, from investment to a second kind of action.
   *
   * Self-limiting in one respect worth remembering when reading the numbers:
   * `startTurn` draws up to `handSize`, so a hand fattened by purchases takes a
   * smaller draw next turn. The cards are not free, only early.
   */
  buyToHand: boolean;
  /**
   * Whether the next hand is drawn at the END of your turn instead of the start.
   *
   * The cards are the same cards. What changes is WHEN you see them: with the
   * hand on the table you can plan your turn while everyone else takes theirs,
   * instead of starting to think when it reaches you. Dominion draws this way
   * for exactly that reason.
   *
   * One real interaction, not a cosmetic one — damage trashes off your DECK, so
   * a deck that has already paid out five cards is five cards nearer to empty
   * when Dusk lands on you.
   */
  drawAtEndOfTurn: boolean;
  /**
   * Whether the Vessel keeps its own Signs at the Turning, or trades them for
   * more of the Old One's own cards.
   *
   * Keeping them is the older idea — "the more corrupt you were, the more of
   * your purchases are in the thing now hunting the table" — and it does not
   * survive contact with the card set. 37% of the Vessel's deck is Signs, and
   * most Signs face the STREET: a Fevered Colt in that hand destroys a Threat
   * for the posse, and the seat cannot cash it in either, so it is a card that
   * either does nothing or helps the enemy.
   *
   * Off, each kept Sign is exchanged for another card from `vesselDeck`. Same
   * count, same "your corruption fed it" arithmetic, no bricks.
   */
  vesselKeepsSigns: boolean;
  /** Whispers the Vessel gets for burning one of the player's Signs. */
  vesselSignWhispers: number;
  /**
   * Whether an empty Street is refilled at the start of a turn.
   *
   * From a playtest: turns where there is nothing to do. Note what the
   * measurement says before reaching for this — the Street is empty at the
   * start of only 0.9% of posse turns, and NO turn in 4,646 offered nothing
   * but END_TURN. The felt problem is a hand with no attack in it (~40%), not
   * a board with nothing on it.
   */
  refillEmptyStreet: boolean;
  /**
   * Whether the round starts with a different seat each time.
   *
   * Turn order is fixed for the whole game, so "last" is a property of where
   * you sat down. Measured over 4,724 posse turns, the last seat finds nothing
   * in the Street it can clear on **30.9%** of its turns against **0.7%** for
   * the first — the table in front of it has already dealt with the round. It
   * is the same seat every round for the whole game.
   *
   * Rotating does not create more to do. It stops one person owning all of it.
   */
  rotateStart: boolean;
  /**
   * Whether a Threat arrives when the Street holds nothing that can be CLEARED.
   *
   * Stronger than `refillEmptyStreet` and aimed at the number that actually
   * hurts: an empty Street is 0.7% of posse turns, a Street with nothing
   * clearable in it is 13.9%. An Omen occupies a slot and can never be removed
   * by damage, so a Street holding only Omens is a full board with nothing to
   * do on it.
   */
  refillNoClearable: boolean;
  /**
   * Whether damage takes a card at random rather than eating Provisions first.
   *
   * The open ruling in CLAUDE.md — "Damage vs. Signs" — asked which way this
   * goes, because it decides whether Sign-heavy play is self-limiting or
   * dominant. Off is the ratchet: your Provisions go, your Signs stay, and a
   * wounded player is a MORE corrupt player. On, corruption is shot off you in
   * proportion to how much of it you are carrying.
   *
   * `last-words` is protected either way. It is trashed last because being
   * taken by the damage it exists to survive would make it useless, and that is
   * a rule about that card rather than about Signs.
   */
  blindDamage: boolean;
  revenantActions: number;
  damagePerHit: number;
  provisionRowSize: number;
  /**
   * Size of the finite, never-reshuffled Provision deck (row included). Buying
   * is the only healing, so this is how quickly healing stops existing — and
   * how long a zero-Sign deck can stay viable.
   */
  provisionDeckSize: number;
  streetSlots: number;
  /**
   * Threats revealed each Dawn:
   *   max(threatsMin, round(living * threatsPerRound) - threatsOffset)
   *
   * Three flat numbers rather than one formula so the simulator can sweep each
   * independently — `sweep` takes any numeric TUNING key as an axis, and a
   * nested object would be invisible to it.
   *
   * The Street used to take one Threat a round whatever the table size, so nine
   * to fifteen actions arrived to meet a single objective: whoever drew well
   * cleared it and everyone after them had nothing to do.
   */
  threatsPerRound: number;
  threatsMin: number;
  threatsOffset: number;
  /**
   * Added to a surviving Threat's Clear and Menace at the end of every Dusk.
   *
   * Patience used to be free. Leaving something alive now compounds.
   */
  escalationPerRound: number;
  /**
   * Multiplier on every Whisper gained after the Turning.
   *
   * The threshold does NOT change at the Turning — the bar has to look
   * identical or players relearn it halfway through the game. What changes is
   * how fast it fills. Same bar, same distance, more pressure.
   */
  whisperRateMythos: number;
  /**
   * Doom awarded by the FIRST Act II fill, and how much each later fill adds.
   *
   * Escalating rather than flat, because Act II should accelerate towards
   * collapse rather than tick along: fill one costs `doomPerFill`, fill two
   * costs `doomPerFill + doomPerFillStep`, and so on. `whisperFills` counts.
   */
  doomPerFill: number;
  doomPerFillStep: number;
  /** Whispers the Vessel gains if a gifted Sign is actually played. */
  offerWhisperReward: number;
  /**
   * What "It Chooses" actually chooses — the Fevered Colt's target.
   *
   * A string rather than a number, so `sweep`'s numeric grid cannot reach it;
   * `sim/colt.ts` compares the three directly. The question it settles is not
   * about one card: it is whether a Fevered face should be PREDICTABLY bad
   * (`leftmostSlot`, `lowestClear`) or merely bad ON AVERAGE (`random`), and
   * the answer applies to all twelve Signs.
   */
  coltFeveredTarget: 'leftmostSlot' | 'random' | 'lowestClear';
  /** How many of each card is in the Vessel's deck. Ten in all. */
  vesselDeck: Record<string, number>;
  /** The Vessel's deck stops shrinking here, so the endgame cannot stall. */
  vesselDeckFloor: number;
  /** How many rounds NOT THAT ONE keeps a card type off the table. */
  shutterDuration: number;
  /**
   * Attacks in the opening deck, and what the padding is made of.
   *
   * Sweep axes for the dead-hand experiment. The base list is 8 cards and
   * `startingDeckSize` is 12, so FOUR of the twelve are padding — which is
   * where most of the Saddlebags come from, and why the deck is 58% blank
   * rather than the 37% the base list suggests.
   */
  starterGuns: number;
  /**
   * What fills the deck out to `startingDeckSize`, cycled.
   *
   * A LIST, not one card: the four padding slots are the lever, and the
   * interesting settings are mixtures. `['saddlebag']` cycles to four
   * Saddlebags, which is what the game shipped with.
   */
  padMix: string[];
  /**
   * Whether a Threat that can never be cleared escalates too.
   *
   * A flag rather than a rule because it is a real design fork, and it is worth
   * a lot: an Omen or a permanent Mythos obstruction can never leave the Street
   * and, since overflow stopped evicting anything, can never be pushed out
   * either. Letting those climb means one arriving in round 2 deals 8+ Menace
   * by round 9 with no answer available. Measured at 5 slots: on, the posse
   * wins 0.0% of games and 71% see a death before round 5; off, 10.5% and 39%.
   */
  escalateUncleanable: boolean;
  /**
   * Whispers each Omen adds at Dusk. At 0 the Whisper track advances only when
   * someone plays a Sign, so the Turning arrives strictly "because someone
   * couldn't resist" (DESIGN.md §3) rather than on an Omen-driven timer.
   */
  /**
   * Threats entering per round, per player at the table.
   *
   * The paper deals a flat 1 Trouble card a round regardless of table size,
   * which means a 4-player posse brings twelve actions to bear on one Clear-3
   * Threat and clears the Street before the round is out. Playtest confirmed it:
   * "I can often clear the street myself before passing my turn." Scaling with
   * the table keeps the pressure the same whether three sit down or five.
   */
  /**
   * Reshuffle a spent threat deck rather than letting the act run out of
   * Threats. See CLAUDE.md — repeats are a deliberate trade.
   */
  recycleMythos: boolean;
  /**
   * Whether cleared Trouble returns to the deck. The paper does not say what
   * happens when the 12-card deck runs out, because at a flat 1 a round it
   * barely does. Once Threats scale with the table it empties by round 6, and
   * `turnOnTroubleExhausted` then ends Act I early — so the Long Season would be
   * governed by deck size rather than by anyone's choices.
   */
  recycleTrouble: boolean;
  omenWhispersPerRound: number;
  /**
   * Menace each Omen deals at Dusk. The paper gives Omens no Menace, which
   * makes deck-as-health unreachable: every other Threat can be cleared, so a
   * competent table never takes damage at all. This is the knob that decides
   * whether attrition is avoidable.
   */
  omenMenace: number;
  /**
   * Extra Menace damage per Sign the victim holds, floored.
   *
   * Flat damage cannot balance attrition: Provisions are capped at 20 but Signs
   * are unlimited, so any flat increase annihilates the zero-Sign deck long
   * before it troubles a Sign-heavy one. Scaling the wound with the corruption
   * that caused it hits the deck that is over-healing, and leaves the Puritan
   * on flat damage. Corruption already draws attention; this makes it cut
   * deeper too.
   */
  menacePerSign: number;
  /**
   * Doom the table starts with on top of the base 3 when the Marked player
   * achieved their secret aim: "at the Turning, two other players must each
   * hold 3 or more Signs." Set 0 to disable the aim.
   */
  markedAimDoomBonus: number;
  /** Grit a Beckoned player gains if they buy a Sign. */
  beckonGrit: number;
  /**
   * Cards a Revenant or the Vessel loses each time their deck recycles.
   *
   * Burial was cut: it cost the posse two actions and a permanent Scar while the
   * Revenant paid one action to undo it, so it was never worth paying. This is
   * the replacement counter — the fallen burn out on their own, and the posse's
   * job is to outlast them rather than to dig a hole. A Revenant who runs out of
   * cards entirely is gone for good; the Vessel floors at one card so the
   * endgame cannot stall.
   */
  revenantDecay: number;
  /**
   * Starting deck size. The base 8 cards are padded with Saddlebags — chaff is
   * armour when the deck is your health (DESIGN.md §5), so this is the dial for
   * how much punishment Act I can absorb before Act II.
   */
  startingDeckSize: number;
  /**
   * Whether the Turning fires when the Trouble deck runs out, even if the
   * Whisper track never reached its threshold. Without it a cautious table
   * never Turns and the game has no ending.
   */
  turnOnTroubleExhausted: boolean;
  /**
   * Whether an Omen in the Street blocks burying the Vessel — the paper rule,
   * now ruled out. Omens can only be removed by Street overflow, and clearing
   * Threats suppresses overflow, so `true` means the better a table fights the
   * more reliably it locks itself out of winning. Defaults `false`; kept as a
   * flag so the original rule can still be measured.
   */
  omensBlockBurial: boolean;
}

export interface GameState {
  seed: string;
  rngCursor: number;
  round: number;
  act: Act;
  phase: Phase;
  turnOrder: PlayerId[];
  activePlayer: PlayerId;
  actionsLeft: number;

  /**
   * The Whisper track. One number, one meaning, in both acts: **when this
   * fills, something bad happens.** It just happens more than once.
   *
   * Same threshold throughout — `tuning.whisperThreshold`, unchanged by the
   * Turning, so the bar the player learned in Act I is the bar they are still
   * reading in Act II. What fills it is what differs: gains are multiplied by
   * `whisperRateMythos` after the Turning.
   *
   * **Never a currency.** It briefly was — a second field the Vessel spent
   * from — and a meter that also serves as a wallet is how it went negative.
   * Nothing subtracts from this.
   *
   * Always in `[0, whisperThreshold)` once a command has finished resolving.
   */
  whispers: number;
  /**
   * How many times the track has filled in Act II.
   *
   * State rather than a derived count, because the Doom each fill costs
   * escalates and there is nothing else to derive it from.
   */
  whisperFills: number;
  doom: number;
  vesselDamage: number;
  /**
   * A card type the Vessel has closed off, and the round it reopens.
   *
   * Enforced in `legalCommands`, never in `apply`: a client has to be able to
   * SHOW a card as unplayable. Discovering it by having a command rejected is
   * the interface telling you the rules after the fact.
   */
  shuttered: { type: CardType; untilRound: number } | null;
  /**
   * Who the Old One is using. Null until the Turning.
   *
   * **The Vessel is the player; the Old One is the fiction.** They are one
   * entity described at two layers, and only the player layer belongs in the
   * interface:
   *
   * - The VESSEL is a status, a seat, a tag in the player list, a thing the
   *   posse can shoot. Every rule, command, label and piece of UI text uses
   *   this word. The posse's win condition says it out loud — they bury the
   *   Vessel, a body. Closing the door is not killing what is behind it.
   * - The OLD ONE is what is using them. Never a player, never a status, never
   *   in the player list. It is what the Doom track counts and what came
   *   through the door at the Turning, and you never interact with it, so it
   *   does not need a seat.
   *
   * This field and `players[vessel].status === 'vessel'` are set together in
   * `checkTurning` and neither is ever reassigned. They used to disagree on
   * naming — the status was `'oldOne'` — which put two tags on one seat with
   * no difference between them.
   */
  vessel: PlayerId | null;
  revealedRoles: PlayerId[];

  street: (StreetSlot | null)[];
  supply: {
    provisions: CardInstance[];
    provisionRow: CardInstance[];
    trouble: CardInstance[];
    /** Cleared and overflowed Trouble, reshuffled when the deck runs dry. */
    troubleDiscard: CardInstance[];
    mythos: CardInstance[];
    /**
     * Cleared and overflowed Mythos, reshuffled when the deck runs dry.
     *
     * Act II needs one because the Street now takes three or four Threats a
     * round against a ten-card deck — without it the Mythos runs out around
     * round three of a five-round act and the Vessel stops arriving.
     */
    mythosDiscard: CardInstance[];
  };

  players: Record<PlayerId, PlayerState>;
  /** playerId -> who may see their hand. Set by revealHand. */
  handsRevealedTo: Record<PlayerId, PlayerId[]>;
  /**
   * Index into `turnOrder` of whoever begins the round.
   *
   * `turnOrder` itself is never rotated, deliberately: a seat's index is its
   * identity in several places — `markedIndex` at setup, and `sim/run.ts` maps
   * a seat index to its policy on every decision — so rotating the array would
   * silently hand a player somebody else's policy halfway through a game.
   */
  startSeat: number;
  /**
   * Who took the last turn of the previous round.
   *
   * Only used to stop the rotation handing somebody two turns in a row across a
   * Dusk. Null before the first round has ended.
   */
  lastRoundActor: PlayerId | null;
  /** Player currently Beckoned: they gain Grit if they buy a Sign. */
  beckoned: PlayerId | null;
  /** Grit banked for a player's next turn, paid by Act I Bounties. */
  nextTurnGrit: Record<PlayerId, number>;
  /** Damage each player will absorb before losing cards. Salt Line. */
  shields: Record<PlayerId, number>;
  pending: PendingChoice | null;
  resolution: Resolution | null;
  /**
   * Which SIDE won, which is not the same question as which seat.
   *
   * `'oldOne'` survives the Vessel rename deliberately: the loser's condition
   * is the thing behind the door getting through, and a Revenant wins with it
   * without ever being the Vessel. It is also never rendered — the client
   * prints "The long noon" — so it is a discriminant, not a label.
   */
  winner: 'posse' | 'oldOne' | null;
  tuning: Tuning;
  uidCounter: number;
  log: GameEvent[];
}

// ---------------------------------------------------------------- commands

export type Command =
  | { t: 'PLAY_CARD'; uid: string }
  | { t: 'SPEND_GRIT'; uids: string[] }
  | { t: 'BUY'; cardId: CardId }
  /**
   * Pay a Threat's Toll to remove it.
   *
   * The Act II answer to a slot nothing can shoot. Costs an action and whatever
   * the card asks — see `Card.toll`.
   */
  | { t: 'PAY_TOLL'; slot: number }
  | { t: 'RESOLVE_CHOICE'; choiceId: string; picks: string[] }
  | { t: 'END_TURN' }
  /*
    The Vessel has NO commands of its own.

    CALL, SUMMON, SHUTTER, OFFER and the Vessel's WHISPER used to live here.
    Their effects survive as ops on cards in the Vessel's deck; only the
    command types are gone, and they are gone rather than unreachable.

    Two things that buys. Everyone at the table now interacts through the same
    four verbs, so there is no second interface to build or explain. And the
    dominant-action problem stops recurring by construction: a safe option that
    is a permanent button gets pressed every turn, and one that has to be drawn
    cannot be.
  */
  // Revenant. BECKON went the same way as the Vessel's five: it is a card in
  // their hand now, played through PLAY_CARD like everything else.
  | { t: 'REVENANT_WHISPER'; uid: string }
  /**
   * The Vessel burns a Sign the player bought, for a Whisper.
   *
   * Its own command rather than a second meaning for `REVENANT_WHISPER` or for
   * `SPEND_GRIT`. The three are the same gesture and three different economies:
   * a Revenant is spending its own life, a posse member is turning a card into
   * money, and this is the Old One burning the corruption that made it. One
   * field doing two jobs is the mistake this project has already made twice
   * with the Whisper track.
   */
  | { t: 'BURN_SIGN'; uid: string };
