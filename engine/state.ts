// Core state types. Everything here must be JSON-serializable:
// no class instances, no functions, no Dates, no Maps/Sets.

export type PlayerId = string;
export type CardId = string;

export type Phase = 'dawn' | 'day' | 'dusk' | 'turning' | 'over';
export type Act = 'trouble' | 'mythos';
export type Status =
  | 'posse'
  | 'revenant'
  | 'oldOne'
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
  | 'mythos';

export type Target =
  | 'self'
  | 'choose'
  | 'left'
  | 'all'
  | 'mostSigns'
  | 'fewestCards'
  | 'leftmostSlot'
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
  | { op: 'recover'; target: Target }
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
  | { op: 'scar'; n: number; target: Target };

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
  appendOps?: Op[];
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
   * A gift from the Old One, and the round the string on it runs out.
   *
   * Set by OFFER. Playing it on or before this round pays the Old One — which
   * is the trap. Per instance, because the gift is this copy and not every copy
   * of that Sign everywhere.
   */
  offeredUntil?: number;
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
  options: { key: string; label: string }[];
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
  | { t: 'PLAYED'; player: PlayerId; cardId: CardId; fevered: boolean }
  | { t: 'BOUGHT'; player: PlayerId; cardId: CardId }
  | { t: 'GRIT'; player: PlayerId; amount: number }
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
  /** Whispers the Old One spends to CALL a Sign in a player's deck. */
  callWhisperCost: number;
  /** Whispers the Old One gains if a gifted Sign is actually played. */
  offerWhisperReward: number;
  /** How many rounds a SHUTTER keeps a card type off the table. */
  shutterDuration: number;
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
   * Doom the Old One starts with on top of the base 3 when the Marked player
   * achieved their secret aim: "at the Turning, two other players must each
   * hold 3 or more Signs." Set 0 to disable the aim.
   */
  markedAimDoomBonus: number;
  /** Grit a Beckoned player gains if they buy a Sign. */
  beckonGrit: number;
  /**
   * Cards a Revenant or the Old One loses each time their deck recycles.
   *
   * Burial was cut: it cost the posse two actions and a permanent Scar while the
   * Revenant paid one action to undo it, so it was never worth paying. This is
   * the replacement counter — the fallen burn out on their own, and the posse's
   * job is to outlast them rather than to dig a hole. A Revenant who runs out of
   * cards entirely is gone for good; the Old One floors at one card so the
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

  whispers: number;
  doom: number;
  vesselDamage: number;
  /**
   * A card type the Old One has closed off, and the round it reopens.
   *
   * Enforced in `legalCommands`, never in `apply`: a client has to be able to
   * SHOW a card as unplayable. Discovering it by having a command rejected is
   * the interface telling you the rules after the fact.
   */
  shuttered: { type: CardType; untilRound: number } | null;
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
     * round three of a five-round act and the Old One stops arriving.
     */
    mythosDiscard: CardInstance[];
  };

  players: Record<PlayerId, PlayerState>;
  /** playerId -> who may see their hand. Set by revealHand. */
  handsRevealedTo: Record<PlayerId, PlayerId[]>;
  /** Player currently Beckoned: they gain Grit if they buy a Sign. */
  beckoned: PlayerId | null;
  /** Grit banked for a player's next turn, paid by Act I Bounties. */
  nextTurnGrit: Record<PlayerId, number>;
  /** Damage each player will absorb before losing cards. Salt Line. */
  shields: Record<PlayerId, number>;
  pending: PendingChoice | null;
  resolution: Resolution | null;
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
  | { t: 'CALL'; target: PlayerId }
  // Revenant
  | { t: 'REVENANT_WHISPER'; uid: string }
  | { t: 'BECKON'; target: PlayerId }
  | { t: 'SUMMON'; slot: number }
  /** Old One: no player may play this card type on their next turn. */
  | { t: 'SHUTTER'; cardType: CardType }
  /** Old One: hand a living player a Sign, free, and hope they use it. */
  | { t: 'OFFER'; target: PlayerId; cardId: CardId };
