import type { Card, Tuning } from "../engine/state";

// Re-derived from scratch after two simulator bugs were fixed (bots bought only
// 3 of 12 Signs; bots played every Sign they drew). DESIGN.md §2's two named
// tests pass: Balanced 51.7%, Zealot 32.3%, Puritan 28.0%, Turning at 59.6%.
//
// Both of DESIGN.md §2's tests pass, significantly, at n=400 with a Marked
// player: Balanced 47.0%, Greedy 35.5%, Puritan 32.0%, Zealot 18.5%, Turning at
// 59.1% of game length. Sweeping the Sign-buying ratio gives a genuine interior
// optimum — 0.00 (never) 32.4%, 0.15 → 44.0%, 0.50 → 40.8%, 1.00 (always) 19.2%
// — which is the corruption curve the whole project exists to find.
//
// Reproduce with:
//   npm run sim -- sweep --games=120 --whisper=8,10,12,14 --doom=23,26,29 --vessel=18,20,22
export const TUNING: Tuning = {
  // (measured) Paper had 12. At 14 the Turning lands later for Sign-buyers,
  // which gives them an Act I long enough to be worth the corruption.
  whisperThreshold: 26,
  // (measured) Paper had 12, which every policy cleared trivially once card
  // damage could reach the Vessel. 34 is what makes Act II a long attritional
  // duel rather than a two-round scramble: it is vesselClear, not doomTarget,
  // that sets Act II's length, because the game ends when the posse burns the
  // Vessel down. Tuned WITH a Marked player; the traitorless variant wants a
  // lower value (it was worth ~4 points at the old tuning) and needs re-measuring.
  // (re-measured after the Street changes) Was 31, tuned against a Street that
  // supplied one Threat a round. With two to four arriving and everything left
  // standing escalating, Doom climbs faster and Act II is shorter, so the same
  // burial target became unreachable: Balanced won 13.5% at 31 against 54.0%
  // here. Swept vesselClear x doomTarget and vesselClear x startingDeckSize;
  // this is the cell where Balanced beats both extremes by the widest margin
  // and neither extreme is close.
  // (re-measured after the Act II Whisper cycle landed) Was 22. The cycle is a
  // whole second Doom source and Act II got correspondingly shorter, so the
  // same burial target became unreachable again — Balanced 19.2% at 22 against
  // 50.8% at 14, with Zealot 5.0% and Puritan 0.0%. Same lesson as last time:
  // vesselClear is the lever that absorbs a change to Act II's length.
  // (re-measured after the Colt/Dynamite split) Was 14. Both Street-facing
  // Signs got weaker in the same pass — the Colt was briefly damage instead of
  // a destroy, and Dynamite went from "destroy any Threat" to "2 damage to
  // all, or an Omen". Reverting the Colt recovered half of it; Dynamite is the
  // other half and is staying. Swept 10/12/14: Balanced 37.5 / 33.3 / 27.5%,
  // Zealot 10.8 / 7.5 / 2.5%, and the interior optimum holds at every value —
  // Balanced beats both extremes throughout, so this is a pure difficulty dial
  // rather than a change in shape. 12 puts Balanced back near its historical
  // 33% without handing Zealot double figures.
  //
  // FOURTH time this number has absorbed a change to the posse's answer to the
  // Street (Bounties 34->36, the Street changes 31->22, the Whisper cycle
  // 22->14, this 14->12). It is the lever; doomTarget is not.
  vesselClear: 12,
  // (measured) Paper had 20, giving Act II barely two rounds. 50 gives the Old
  // One room to be ground down over ~5 rounds instead. Raising this alone just
  // makes the game easier — it only lengthens Act II paired with vesselClear.
  doomTarget: 50,
  handSize: 5,
  actionsPerTurn: 3,
  revenantActions: 2,
  damagePerHit: 1,
  provisionRowSize: 4,
  // (measured) Back at the paper's 20. 16 was needed only while Omens dealt no
  // Menace; once attrition is real it punishes the zero-Sign deck on its own,
  // and 20 is what keeps Balanced ahead of Zealot. At 20 the cut is a no-op, so
  // there is no random market subset and no added variance (DESIGN.md §9).
  provisionDeckSize: 13,
  // (playtest) Three slots against nine to fifteen actions a round meant the
  // Street was usually empty by the time the last player acted. Five slots and
  // a scaling reveal give the table something to be behind on.
  streetSlots: 4,
  // Threats a Dawn: max(threatsMin, round(living * threatsPerRound) - offset).
  // At 3 players that is 2, at 4 it is 3, at 5 it is 4.
  threatsPerRound: 1,
  threatsMin: 2,
  threatsOffset: 1,
  // Leaving a Threat alive compounds: +1 Clear and +1 Menace per Dusk survived,
  // permanently, per slot. Patience used to be free — the Whisper track only
  // moved when someone bought a Sign, so a cautious table could idle for ever
  // and the temptation engine never fired.
  escalationPerRound: 1,
  // (to be measured) The threshold does NOT move at the Turning — the bar has
  // to look identical or the player relearns it halfway through the game. The
  // RATE moves instead: every Whisper gained in Act II counts double.
  whisperRateMythos: 2.0,
  // (to be measured) Escalating, so Act II accelerates towards collapse rather
  // than ticking along: +2 on the first fill, +3 on the second, +4 on the
  // third. This is Doom's reliable player-driven source now that the Vessel's
  // flat +2 action is gone.
  doomPerFill: 2,
  doomPerFillStep: 1,
  // A gift used in time pays about what one Sign play costs the table.
  offerWhisperReward: 2,
  // (to be measured) How many of each card the Vessel's deck holds. Ten in
  // all, sweepable so the mix can be argued with — `long-noon` is the safe one
  // and its count is the dial on how often the seat has nothing sharp to do.
  vesselDeck: {
    "your-name": 2,
    "up-the-street": 2,
    "not-that-one": 2,
    "freely-given": 2,
    "long-noon": 2,
  },
  // The Vessel's deck shrinks one card per recycle, like a Revenant's, and
  // stops here. A floor rather than zero: an empty-handed Vessel stalls the
  // endgame with nobody able to end it.
  vesselDeckFloor: 1,
  // (measured, chosen) RANDOM. "It Chooses" implies agency, and this is the
  // reading that gives it some: you play the card and find out.
  //
  // Measured over 400 real Act II boards (avg 2.3 live Threats), scoring each
  // mode against the shot a competent player would have taken:
  //
  //     mode          value kept  hits best  post-Turning win  sd across blocks
  //     leftmostSlot       59.5%      32.6%             45.4%              10.6
  //     random             67.4%      50.0%             41.4%               4.7
  //     lowestClear        90.5%      58.4%             48.5%               5.5
  //
  // Two results worth keeping. `lowestClear` is barely a corruption at all —
  // with 4 damage against ~2.3 Threats, finishing the easiest one is usually
  // what you would have done anyway, so it keeps 90% of the best shot and has
  // the HIGHEST win rate. A Fevered face drifting toward an upgrade is the one
  // thing the design cannot allow, so it is out.
  //
  // And `random` does not widen the win distribution the way it was expected
  // to: sd 4.7 against leftmostSlot's 10.6. leftmostSlot is the volatile one,
  // because whether the leftmost slot is the right slot is pure arrival order.
  //
  // Chosen over leftmostSlot as a design call: leftmostSlot keeps less value
  // (59.5%) and preserves a decision you can decline, but random costs the
  // posse the most (41.4%) and reads as a gun with a mind rather than a gun
  // with a default.
  coltFeveredTarget: "random",
  // One round. Long enough to wreck a plan, short enough that a bad guess
  // costs the Vessel a turn rather than the posse a game.
  shutterDuration: 1,
  starterGuns: 2,
  /*
    (measured) The four padding slots, and the one lever that actually moves
    dead hands.

    `startingDeckSize` is 12 but the base list is 8, so FOUR cards are padding
    — and they were all Saddlebags, which is why the deck people reason about
    ("3 of 8 are blank") is not the deck they played ("7 of 12", 58% blank).
    That single edit both diluted the attacks and added the blanks: 31.7% of
    opening hands held no attack at all.

    Swept 200 games an arm. Dead hands in Act I, and Zealot alongside, because
    every Six-Gun in the starting deck is one the Zealot gets for free:

        4 sad / 0 gun   50.3%   Zealot  6.0%   <- was
        3 sad / 1 gun   37.4%   Zealot 11.0%   <- is
        2 sad / 2 gun   28.8%   Zealot 22.5%
        1 sad / 3 gun   20.7%   Zealot 34.0%
        0 sad / 4 gun   17.9%   Zealot 49.0%

    3/1 is the best exchange rate on the curve: 13 points of dead hands for 5
    of Zealot, and runaway escalation 75% -> 62%. Past 2/2 the honest route
    stops losing and DESIGN.md §2's central test goes with it.

    TWO THINGS THIS DOES NOT FIX, both measured:
      - Act II barely moves (43.1% -> 42.8%). Act II dead hands are a
        different problem with a different cause; no opening-deck tuning
        reaches them.
      - Substituting a Canteen instead of a Six-Gun buys almost nothing
        (Act II 45.9%, escalation 70%). It is the ATTACK that matters, not
        "a card with an effect" — the blank-card theory on its own is wrong.
  */
  padMix: ["saddlebag", "saddlebag", "saddlebag", "six-gun"],
  // (measured) Off. An Omen arriving in round 2 would otherwise be dealing 8+
  // Menace by round 9, unanswerably — it cannot be cleared and, now that
  // overflow leaves Threats standing, cannot be pushed out either. Turning this
  // on costs the posse every game it has: 0.0% wins and 71% of games with a
  // death before round 5, against 10.5% and 39% with it off.
  escalateUncleanable: false,
  // (measured, from playtest) The paper deals a flat 1 Trouble a round whatever
  // the table size, so four players clear the Street before the round is out —
  // it sat empty in 16% of Act I decisions, 1.28 of 3 slots filled. At 0.5 per
  // player it is 2.05 of 3 and empty in 2%.
  recycleTrouble: true,
  // Act II draws three or four Threats a round from a ten-card deck. Without
  // recycling the Mythos runs out mid-act; with it, players see repeats. That
  // trade is deliberate — see CLAUDE.md.
  recycleMythos: true,
  omenWhispersPerRound: 1,
  // (measured) The paper gives Omens no Menace, which made deck-as-health dead
  // content: every other Threat can be cleared, so a competent table never took
  // damage and nobody ever fell — not even at 8x damagePerHit. The thing you
  // cannot clear is now the thing that costs you.
  omenMenace: 1,
  // (measured) Omen Menace alone only threatened the zero-Sign deck: Signs are
  // an unlimited supply and therefore unlimited healing, so a Sign-heavy table
  // outgrew attrition (1.5% of Balanced games saw a fall). Scaling the wound
  // with the corruption that drew it lifts that to 24% while leaving the
  // Puritan on flat damage. Raised 0.35 -> 0.45 when the fake "+1 Menace on
  // turned cards" was replaced by real reverses: that stand-in had been doing
  // the work of punishing Sign-heavy decks in Act II, and without it Zealot and
  // Balanced landed within 1pp of each other. Above ~0.5 it crushes everyone.
  menacePerSign: 0.18,
  markedAimDoomBonus: 3,
  beckonGrit: 1,
  revenantDecay: 1,
  // (measured) Raised from 8 once Threats began scaling with the table: more
  // Street pressure pushed round-4 deaths to 9%, and DESIGN.md §10 prescribes
  // exactly this — "fatten the starting deck rather than reducing damage".
  // 12 brings early deaths back to 3.5%.
  startingDeckSize: 12,
  turnOnTroubleExhausted: true,
  // Ruled: Omens no longer gate the Vessel. The paper rule ("while no Omen sits
  // in the Street") deadlocked, because overflow is the only thing that removes
  // an Omen and clearing Threats suppresses overflow — so fighting well locked
  // the posse out of its own win condition. What survives is the other half of
  // the same paper line: damage to the Vessel resets to 0 if an Omen enters.
  // Set true to restore the original gate for comparison.
  omensBlockBurial: false,
};

export const STARTING_DECK: CardId[] = [
  "saddlebag",
  "saddlebag",
  "saddlebag",
  "six-gun",
  "six-gun",
  "canteen",
  "grubstake",
  "bad-nerve",
];
type CardId = string;

const STARTERS: Card[] = [
  {
    id: "saddlebag",
    name: "Saddlebag",
    flavour: "Everything you own, and room for more.",
    type: "kit",
    grit: 1,
    ops: [],
  },
  {
    id: "six-gun",
    name: "Six-Gun",
    flavour: "Six answers. Most questions need one.",
    type: "kit",
    grit: 1,
    ops: [{ op: "damage", n: 1, target: "choose" }],
  },
  {
    id: "canteen",
    name: "Canteen",
    flavour: "Warm, and half sand. Still water.",
    type: "kit",
    grit: 1,
    ops: [{ op: "draw", n: 1, target: "self" }],
  },
  {
    id: "grubstake",
    name: "Grubstake",
    flavour: "Somebody believed in you once, in writing.",
    type: "kit",
    grit: 2,
    ops: [],
  },
  {
    id: "bad-nerve",
    name: "Bad Nerve",
    flavour: "Your hands knew before you did.",
    type: "kit",
    grit: 0,
    ops: [
      { op: "draw", n: 2, target: "self" },
      { op: "trash", n: 1, from: "hand", target: "self" },
    ],
  },
  {
    id: "scar",
    name: "Scar",
    flavour: "It healed. That is all it did.",
    type: "scar",
    grit: 0,
    ops: [],
  },
];

/** id -> copies in the 20-card, never-reshuffled Provision deck. */
export const PROVISION_COUNTS: Record<string, number> = {
  winchester: 3,
  scattergun: 2,
  "hard-tack": 3,
  "docs-bag": 2,
  "sheriffs-star": 1,
  "lantern-oil": 2,
  "good-stuff": 2,
  "good-rope": 2,
  "fresh-horses": 2,
  "bank-draft": 1,
};

const PROVISIONS: Card[] = [
  {
    id: "winchester",
    name: "Winchester",
    flavour: "Reaches further than a man can argue.",
    type: "kit",
    cost: 3,
    grit: 1,
    ops: [{ op: "damage", n: 2, target: "choose" }],
  },
  {
    id: "scattergun",
    name: "Scattergun",
    flavour: "For when the trouble arrives all at once.",
    type: "kit",
    cost: 4,
    grit: 1,
    ops: [{ op: "damage", n: 3, target: "choose" }],
  },
  {
    id: "hard-tack",
    name: "Hard Tack",
    flavour: "Breaks teeth. Keeps men.",
    type: "kit",
    cost: 2,
    grit: 2,
    ops: [],
  },
  {
    id: "docs-bag",
    name: "Doc Mireles' Bag",
    flavour: "Doc Mireles never lost a patient he liked.",
    type: "kit",
    cost: 4,
    grit: 1,
    ops: [{ op: "recover", target: "self" }],
  },
  {
    id: "sheriffs-star",
    name: "The Sheriff's Star",
    flavour: "Tin. It has never stopped anything alone.",
    type: "kit",
    cost: 5,
    grit: 2,
    ops: [{ op: "actions", n: 1 }],
  },
  {
    id: "lantern-oil",
    name: "Lantern Oil",
    flavour: "An hour of light, bought against the dark.",
    type: "deed",
    cost: 2,
    grit: 1,
    ops: [{ op: "damage", n: 2, target: "choose" }],
  },
  {
    id: "good-stuff",
    name: "A Bottle of the Good Stuff",
    flavour: "Courage, decanted. Effect varies.",
    type: "deed",
    cost: 2,
    grit: 1,
    ops: [{ op: "draw", n: 2, target: "self" }],
  },
  {
    id: "good-rope",
    name: "Good Rope",
    flavour: "Forty feet of second chances.",
    type: "kit",
    cost: 3,
    grit: 2,
    ops: [{ op: "draw", n: 1, target: "self" }],
  },
  {
    id: "fresh-horses",
    name: "Fresh Horses",
    flavour: "The country is wide. Be wider.",
    type: "kit",
    cost: 3,
    grit: 1,
    ops: [{ op: "actions", n: 1 }],
  },
  {
    id: "bank-draft",
    name: "Bank Draft",
    flavour: "A promise from men who have never been here.",
    type: "kit",
    cost: 4,
    grit: 3,
    ops: [],
  },
];

// ---------------------------------------------------------------------------
// SIGNS
// The whole schema bet lives here: a Fevered face is the same effect with a
// different target, an appended op, or a constraint. Nothing else. If a twist
// needs real code, it is too clever for the table as well as for the codebase.
// ---------------------------------------------------------------------------

const SIGNS: Card[] = [
  // Some Fevered faces turn on the Vessel: you do not aim them and cannot hold
  // them back — they simply want the thing that woke up. That is what makes a
  // Sign worth buying despite what it costs the table, since the only way to
  // bury the Vessel is with what it gave you.
  //
  // Two rules keep this from making Signs strictly better than Provisions:
  //
  //   1. NO CARD DOES BOTH JOBS. A Sign that clears Threats (Colt, Dynamite)
  //      gets no Vessel damage; the Vessel-facing ones do nothing to the
  //      Street. A Provision has to choose where to aim, so a Sign does too.
  //      Threat-clearing is worth real time in Act II — Doom rises per
  //      unresolved Mythos Threat at Dusk — so getting both was worth double.
  //   2. EACH ONE TAKES A CARD OFF YOUR DECK. Damage trashes Kit and Provisions
  //      before Signs, so firing the corrupted card burns away the honest part
  //      of your deck and leaves you more corrupt. Signs stay powerful and get
  //      more expensive to point — they do not get weaker.
  // DEPTH. The Colt answers one whole Threat; Dynamite answers a crowded
  // Street. They used to BOTH read "destroy a Threat", which wasted a slot in
  // a set of twelve — the split is what fixed that, not the destroy/damage
  // question underneath it.
  //
  // (measured, reverted) It was 4 damage for a while, on the argument that
  // `destroy` sits outside the pace engine: escalation adds +1 Clear every
  // Dusk and an auto-answer never gets worse as the game gets harder. That
  // argument is still true. It was reverted anyway because the price was too
  // high — taking the auto-answers out of the posse's hands moved mixed-table
  // wins from 26.0% to 5.7%, and `vesselClear` was not the lever that wanted
  // to absorb it. Depth vs breadth was worth having; this was not.
  //
  // The Fevered face is a PURE RETARGET — no appended ops, no constraints. It
  // still never misses; what corruption takes is the choosing, which is what
  // the name has always said.
  {
    id: "colt",
    name: "The Colt That Doesn't Miss",
    flavour: "It has never missed. You have never aimed it.",
    type: "sign",
    cost: 4,
    grit: 2,
    whispers: 3,
    ops: [{ op: "destroy", target: "choose" }],
    fevered: { name: "It Chooses", retarget: { 0: "itChooses" } },
  },

  {
    id: "parson",
    name: "Parson Grimm's Blessing",
    flavour: "He blesses whatever asks to be blessed.",
    type: "sign",
    cost: 3,
    grit: 2,
    whispers: 2,
    ops: [{ op: "recover", target: "choose" }],
    fevered: { name: "The Parson Knows Better", retarget: { 0: "mostSigns" } },
  },

  // BREADTH, and the only answer to an Omen in the game.
  //
  // `banishOmen` is written FIRST because taking it clears the rest of the
  // queue — that is the "may instead". Decline and the blast runs; take an
  // Omen and nothing else on the card happens.
  //
  // Both Fevered differences are one ordinary mechanism each, which is the
  // test that this shape is right rather than clever:
  //   retarget 0: self -> all  — every player takes the Scar
  //   appendOps                — every player takes the blast too, and it is
  //                              skipped automatically when an Omen is taken,
  //                              because the queue is already empty by then.
  {
    id: "dynamite",
    name: "Dynamite From the Old Shaft",
    // (measured, chosen) 4. Swept 3/4/5/6 at 200 games per cell with the Colt
    // held at 4 as a control. The headline number is Omen counterplay: games
    // ending with an Omen still in the Street run 97.5% at cost 3, 42.5% at 4,
    // 27.0% at 5. Three is too dear to reach for and Omens stay unanswerable;
    // five makes it a third of every Sign bought.
    //
    // READ THE CAVEAT BEFORE RE-SWEEPING. `Balanced` and `Greedy` buy through
    // `dearest()` — the most expensive affordable Sign — so purchase share in
    // that sweep tracks PRICE RANK, not desirability, and it is non-monotonic
    // for exactly that reason (bought more at 5 than at 3, because at 5 it
    // outranks the Colt). Any future price work wants a value-aware `pick`
    // first, or the table measures the bot.
    flavour: "The shaft gave it up. The shaft wants it back.",
    type: "sign",
    cost: 4,
    grit: 2,
    whispers: 2,
    ops: [
      { op: "banishOmen", target: "self" },
      { op: "damage", n: 2, target: "all" },
    ],
    fevered: {
      name: "The Shaft Remembers",
      retarget: { 0: "all" },
      appendOps: [{ op: "trash", n: 2, from: "deck", target: "all" }],
    },
  },

  {
    id: "debt",
    name: "A Debt Comes Due",
    flavour: "Everything is borrowed. Nothing is forgotten.",
    type: "sign",
    cost: 2,
    grit: 2,
    whispers: 2,
    ops: [{ op: "draw", n: 3, target: "self" }],
    // Discard FIRST, then draw — a wheel, not a bonfire. Appended, the two ops
    // drew three cards and immediately threw them away with everything else,
    // which is a card you would simply never play. Prepended, the debt is
    // called in before the money arrives, which is also what the name says.
    fevered: {
      name: "The Ledger Reads Itself",
      prependOps: [{ op: "discardHand", target: "self" }],
    },
  },

  {
    id: "night-watch",
    name: "Night Watch",
    flavour: "Something keeps watch. It is not you.",
    type: "sign",
    cost: 3,
    grit: 2,
    whispers: 2,
    // "Once per round, cancel one Threat's Menace." Ruled a one-shot: you play
    // it, it cancels, it goes to the discard like anything else.
    ops: [{ op: "cancelMenace", target: "choose" }],
    fevered: {
      name: "Something Else Is Watching",
      retarget: { 0: "leftmostSlot" },
      appendOps: [
        { op: "damage", n: 2, target: "vessel" },
        { op: "trash", n: 1, from: "deck", target: "self" },
      ],
    },
  },

  // "When your deck would empty, keep 2 cards instead of falling." Insurance you
  // hold rather than play — the one Sign whose whole point is never leaving your
  // deck. It briefly carried Vessel-facing Fevered damage, which turned it into
  // a pure battery: never played, so its 3 Whispers were never paid, and it
  // cashed out as free Act II damage. "Buy the dearest card" then won 96%.
  {
    id: "last-words",
    name: "Last Words",
    flavour: "Say them early. They will be said.",
    type: "sign",
    cost: 4,
    grit: 2,
    whispers: 3,
    ops: [],
    passive: "onFall:keepTwo",
    fevered: { name: "He Didn't Stay Down" },
  },

  {
    id: "hymn",
    name: "The Hymn With No Author",
    flavour: "Nobody wrote it. Everybody knows the second verse.",
    type: "sign",
    cost: 3,
    grit: 2,
    whispers: 2,
    ops: [{ op: "actions", n: 2 }],
    fevered: {
      name: "You Know All the Verses",
      constraints: ["mustPlayOnDraw"],
    },
  },

  {
    id: "certainty",
    name: "Prospector's Certainty",
    flavour: "He knew where to dig. He never said how.",
    type: "sign",
    cost: 2,
    grit: 2,
    whispers: 1,
    ops: [{ op: "grit", n: 3 }],
    fevered: {
      name: "He Never Stopped Digging",
      constraints: ["mustBuySignIfAble"],
    },
  },

  {
    id: "stake-claim",
    name: "Stake the Claim",
    flavour: "Drive it deep. Something reads the name.",
    type: "sign",
    cost: 2,
    grit: 2,
    whispers: 1,
    ops: [{ op: "gainCard", filter: { from: "provisionRow" }, target: "self" }],
    fevered: {
      name: "The Claim Stakes You",
      retarget: { 0: "left" },
      appendOps: [{ op: "whisper", n: 1 }],
    },
  },

  {
    id: "coyote",
    name: "What the Coyote Told Me",
    flavour: "She tells the truth. That is the trick.",
    type: "sign",
    cost: 2,
    grit: 2,
    whispers: 1,
    // "Look at the top 3 cards of the Threat deck. Reorder them." Implemented as
    // choosing which of the three comes next — a full reorder cannot be
    // expressed as a legalCommands option without enumerating permutations.
    ops: [{ op: "scry", n: 3, target: "choose" }],
    fevered: {
      name: "The Coyote Asks After You",
      // Needed a new op atom: the twist is an information leak, not a retarget.
      appendOps: [
        { op: "revealHand", target: "self" },
        { op: "damage", n: 1, target: "vessel" },
        { op: "trash", n: 1, from: "deck", target: "self" },
      ],
    },
  },

  {
    id: "salt-line",
    name: "Salt Line at the Door",
    flavour: "Salt remembers where the door was.",
    type: "sign",
    cost: 3,
    grit: 2,
    whispers: 2,
    // "Prevent 2 damage to any player." A buffer that waits to be spent.
    ops: [{ op: "shield", n: 2, target: "choose" }],
    fevered: {
      name: "The Line Has Been Crossed",
      appendOps: [
        { op: "whisper", n: 1 },
        { op: "damage", n: 1, target: "vessel" },
        { op: "trash", n: 1, from: "deck", target: "self" },
      ],
    },
  },

  {
    id: "widow",
    name: "The Widow's Instruction",
    flavour: "She buried three. She knows the ground.",
    type: "sign",
    cost: 3,
    grit: 2,
    whispers: 2,
    ops: [{ op: "trash", n: 1, from: "hand", target: "self" }],
    fevered: {
      name: "She Has Other Instructions",
      appendOps: [
        {
          op: "gainCard",
          filter: { type: "sign", maxCost: 2, from: "signs" },
          target: "self",
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// The Vessel's deck.
//
// These used to be five buttons on a bespoke action menu. Cards instead, for
// two reasons that are both structural rather than cosmetic:
//
//   - one interface. Everyone at the table plays a card, spends for coin, buys
//     where permitted and ends their turn. There is no second UI to build,
//     explain, or keep in step.
//   - the dominant-action problem cannot recur. A safe option that is a
//     permanent button gets pressed every turn; one that has to be drawn
//     cannot be. THE LONG NOON is deliberately the safe card, and the draw is
//     what rations it.
//
// Type `vessel`, not `sign`: `signsHeld` feeds the Marked player's secret aim
// and `menacePerSign`, and a Vessel holding ten Signs would read as the most
// corrupt seat at the table by a mile.
// ---------------------------------------------------------------------------

const VESSEL_CARDS: Card[] = [
  {
    id: "your-name",
    name: "It Remembers Your Name",
    flavour: "It says it the way your mother did.",
    type: "vessel",
    grit: 0,
    ops: [{ op: "callSign", target: "choose" }],
  },
  {
    id: "up-the-street",
    name: "Something Comes Up the Street",
    flavour: "Nobody sees it arrive. Everybody sees it standing there.",
    type: "vessel",
    grit: 0,
    ops: [{ op: "summon" }],
  },
  {
    id: "not-that-one",
    name: "Not That One",
    flavour: "Your hand is heavier than it was.",
    type: "vessel",
    grit: 0,
    ops: [{ op: "shutter" }],
  },
  {
    id: "freely-given",
    name: "A Gift, Freely Given",
    flavour: "Take it. It was always yours.",
    type: "vessel",
    grit: 0,
    ops: [{ op: "gift", target: "choose" }],
  },
  {
    id: "long-noon",
    name: "The Long Noon",
    flavour: "The sun has not moved in some time.",
    type: "vessel",
    grit: 0,
    ops: [{ op: "whisper", n: 3 }],
  },
];

/**
 * The fallen's one card.
 *
 * Granted at the start of every Revenant turn and gone at the end of it — see
 * `CardType['revenant']` for why it cannot simply live in their deck.
 *
 * `grit: 0` matters: `SPEND_GRIT` is offered per hand card with grit above
 * zero, and a Revenant cashing in their own voice for a coin is not a move
 * anybody meant to offer.
 */
const REVENANT_CARDS: Card[] = [
  {
    id: "come-and-see",
    name: "Come and See",
    flavour: "It is warmer over here. That is the first lie.",
    type: "revenant",
    grit: 0,
    ops: [{ op: "beckon", target: "choose" }],
  },
];

/** The card a Revenant is granted each turn. */
export const BECKON_CARD_ID = "come-and-see";

// Act I Trouble. The Bounty line is what makes Act I combat generative —
// "Nothing in Act II pays a Bounty. Ever." (DESIGN.md §7's economy inversion.)
const TROUBLE: Card[] = [
  {
    id: "claim-jumpers",
    name: "Claim Jumpers",
    flavour: "Your name on the stake means little at night.",
    type: "trouble",
    grit: 0,
    clear: 3,
    menace: 1,
    ops: [],
    reverse: "never-miners",
    bounty: [
      { op: "gainCard", filter: { from: "provisionRow" }, target: "self" },
    ],
  },
  {
    id: "rustlers",
    name: "Rustlers at the Draw",
    flavour: "They work the draw, where the ground hides them.",
    type: "trouble",
    grit: 0,
    clear: 2,
    menace: 1,
    ops: [],
    reverse: "herd-back",
    bounty: [{ op: "gritNextTurn", n: 2, target: "self" }],
  },
  {
    id: "barons-men",
    name: "Cattle Baron's Men",
    flavour: "He does not come himself. He never has to.",
    type: "trouble",
    grit: 0,
    clear: 4,
    menace: 2,
    ops: [],
    reverse: "baron-promise",
    bounty: [
      { op: "gainCard", filter: { from: "provisionRow" }, target: "self" },
      { op: "gainCard", filter: { from: "provisionRow" }, target: "self" },
    ],
  },
  {
    id: "prairie-fire",
    name: "Prairie Fire",
    flavour: "The wind decides. It always has.",
    type: "trouble",
    grit: 0,
    clear: 3,
    menace: 2,
    ops: [],
    reverse: "wrong-colour",
    bounty: [
      { op: "trash", n: 1, from: "hand", target: "self" },
      { op: "grit", n: 3 },
    ],
  },
  {
    id: "cardsharp",
    name: "The Cardsharp",
    flavour: "He deals honest. That is the worrying part.",
    type: "trouble",
    grit: 0,
    clear: 2,
    menace: 0,
    ops: [],
    bounty: [{ op: "draw", n: 2, target: "self" }],
  },
  {
    id: "stage-robbery",
    name: "Stagecoach Robbery",
    flavour: "The mail can wait. The strongbox cannot.",
    type: "trouble",
    grit: 0,
    clear: 3,
    menace: 1,
    ops: [],
    bounty: [{ op: "gritNextTurn", n: 3, target: "self" }],
  },
  {
    id: "hanging-tree",
    name: "The Hanging Tree Dispute",
    flavour: "Two families, one rope, no agreement.",
    type: "trouble",
    grit: 0,
    clear: 2,
    menace: 1,
    ops: [],
    bounty: [{ op: "trash", n: 1, from: "hand", target: "self" }],
  },
  {
    id: "silver-bit",
    name: "Brawl at the Silver Bit",
    flavour: "It started over nothing. They usually do.",
    type: "trouble",
    grit: 0,
    clear: 2,
    menace: 1,
    ops: [],
    bounty: [
      { op: "draw", n: 1, target: "self" },
      { op: "gritNextTurn", n: 1, target: "all" },
    ],
  },
  {
    id: "horse-thieves",
    name: "Horse Thieves",
    flavour: "A man afoot out here is a man finished.",
    type: "trouble",
    grit: 0,
    clear: 3,
    menace: 1,
    ops: [],
    bounty: [
      { op: "gainCard", filter: { from: "provisionRow" }, target: "self" },
    ],
  },
  // Omens have no Clear and no Bounty. They only sit there and cost you.
  {
    id: "dead-cattle",
    name: "Dead Cattle, No Wounds",
    flavour: "No wounds. No tracks. No birds.",
    type: "omen",
    grit: 0,
    menace: 0,
    ops: [],
  },
  {
    id: "the-well",
    name: "The Well Tastes Like Pennies",
    flavour: "Pennies, and something under the pennies.",
    type: "omen",
    grit: 0,
    menace: 0,
    ops: [],
  },
  {
    id: "preacher",
    name: "The Preacher Won't Come Out",
    flavour: "The door is bolted from the inside.",
    type: "omen",
    grit: 0,
    menace: 0,
    ops: [],
  },
];

// The four reverse faces. Every Trouble card still in the Street flips to its
// reverse at the Turning — the threats you left standing become the things that
// kill you. They are Act II cards, so none of them pays a Bounty.
const TURNED: Card[] = [
  {
    id: "never-miners",
    name: "They Were Never Miners",
    flavour: "They came up. They did not go down.",
    type: "mythos",
    grit: 0,
    clear: 5,
    menace: 2,
    ops: [],
    menaceTarget: "fewestCards",
  },
  {
    id: "herd-back",
    name: "They Brought the Herd Back",
    flavour: "Every head accounted for. Every one.",
    type: "mythos",
    grit: 0,
    clear: 5,
    menace: 2,
    ops: [],
    noClearWhileOmen: true,
  },
  {
    id: "baron-promise",
    name: "The Baron Kept His Promise",
    flavour: "He said he would come back. He did.",
    type: "mythos",
    grit: 0,
    clear: 6,
    menace: 3,
    ops: [],
    onCleared: [{ op: "whisper", n: 2 }],
  },
  {
    id: "wrong-colour",
    name: "It Burns the Wrong Colour",
    flavour: "Green, and going through the stone.",
    type: "mythos",
    grit: 0,
    clear: 4,
    menace: 2,
    ops: [],
    menaceTarget: "all",
  },
];

const MYTHOS: Card[] = [
  {
    id: "thing-in-well",
    name: "The Thing in the Well",
    flavour: "The rope goes down further than it did.",
    type: "mythos",
    grit: 0,
    clear: 5,
    menace: 2,
    ops: [],
  },
  // The two cards below have no Clear: no amount of damage removes them. They
  // are not permanent any more — they have a PRICE. DESIGN.md §7 gives Act II
  // Threats a Toll where Act I ones have a Bounty, the same third line with the
  // arithmetic inverted, and that is what makes a blocked slot a decision
  // rather than a dead one.
  //   Dry Grass prints its Toll: trash a Sign and take a Scar.
  //   Nothing Comes prints "no Menace resolves, discard at end of round" — so
  //     the quiet-round idea in DESIGN.md §7 is dropped; it is an obstruction.
  {
    id: "dry-grass",
    name: "Choir of the Dry Grass",
    flavour: "The grass sings the parts it remembers.",
    type: "mythos",
    grit: 0,
    menace: 0,
    ops: [],
    // Printed on the card. The model for every Toll: it asks for the thing you
    // least want to give, and leaves a mark that never comes off.
    toll: [
      { op: "trash", n: 1, from: "hand", target: "self", kind: "sign" },
      { op: "scar", n: 1, target: "self" },
    ],
  },
  {
    id: "own-face",
    name: "Your Own Face, Waiting",
    flavour: "It waves. You have not raised your hand.",
    type: "mythos",
    grit: 0,
    clear: 4,
    menace: 3,
    ops: [],
    menaceTarget: "mostSigns",
  },
  {
    id: "nothing-comes",
    name: "Nothing Comes",
    flavour: "Nothing comes. Nothing goes. Nothing ends.",
    type: "mythos",
    grit: 0,
    menace: 0,
    ops: [],
    // Cheaper than the Choir, and payable by a deck that holds no Signs at all
    // — otherwise a Puritan table can never clear it and the slot really is
    // dead for them.
    toll: [{ op: "trash", n: 2, from: "deck", target: "self" }],
  },
  {
    id: "wearing-sheriff",
    name: "Something Wearing the Sheriff",
    flavour: "It has his walk almost right.",
    type: "mythos",
    grit: 0,
    clear: 5,
    menace: 2,
    ops: [],
  },
  {
    id: "seam",
    name: "The Sky Has a Seam in It",
    flavour: "Look up. Then try to stop.",
    type: "mythos",
    grit: 0,
    clear: 6,
    menace: 1,
    ops: [],
  },
  {
    id: "town-beneath",
    name: "The Town Beneath the Town",
    flavour: "The same streets, and older.",
    type: "mythos",
    grit: 0,
    clear: 4,
    menace: 2,
    ops: [],
  },
  {
    id: "doors-inward",
    name: "All the Doors Open Inward",
    flavour: "Every door. Even the ones outside.",
    type: "mythos",
    grit: 0,
    clear: 3,
    menace: 2,
    ops: [],
  },
  {
    id: "coyote-debt",
    name: "Grandmother Coyote's Debt",
    flavour: "She is here to collect. She always was.",
    type: "mythos",
    grit: 0,
    clear: 4,
    menace: 1,
    ops: [],
  },
  {
    id: "long-noon",
    name: "The Long Noon",
    flavour: "The sun has not moved since Tuesday.",
    type: "mythos",
    grit: 0,
    clear: 7,
    menace: 3,
    ops: [],
  },
];

export const ALL_CARDS: Card[] = [
  ...STARTERS,
  ...PROVISIONS,
  ...SIGNS,
  ...TROUBLE,
  ...TURNED,
  ...MYTHOS,
  ...VESSEL_CARDS,
  ...REVENANT_CARDS,
];

const INDEX: Record<string, Card> = Object.fromEntries(
  ALL_CARDS.map((c) => [c.id, c]),
);

export function card(id: string): Card {
  const c = INDEX[id];
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

export const SIGN_IDS = SIGNS.map((s) => s.id);
export const VESSEL_IDS = VESSEL_CARDS.map((v) => v.id);
export const TROUBLE_IDS = TROUBLE.map((t) => t.id);
export const MYTHOS_IDS = MYTHOS.map((m) => m.id);
