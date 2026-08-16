import type { Card, Tuning } from '../engine/state';

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
  vesselClear: 22,
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
  // The Old One's actions are paid for out of what the table gave away. One
  // Whisper a CALL means a posse that stops buying Signs in Act II starves the
  // seat — which is a real choice, since Signs are all there is left to buy.
  callWhisperCost: 1,
  // A gift used in time pays about what one Sign play costs the table.
  offerWhisperReward: 2,
  // One round. Long enough to wreck a plan, short enough that a bad guess
  // costs the Old One a turn rather than the posse a game.
  shutterDuration: 1,
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
  'saddlebag', 'saddlebag', 'saddlebag',
  'six-gun', 'six-gun',
  'canteen',
  'grubstake',
  'bad-nerve',
];
type CardId = string;

const STARTERS: Card[] = [
  { id: 'saddlebag', name: 'Saddlebag', type: 'kit', grit: 1, ops: [] },
  { id: 'six-gun', name: 'Six-Gun', type: 'kit', grit: 1,
    ops: [{ op: 'damage', n: 1, target: 'choose' }] },
  { id: 'canteen', name: 'Canteen', type: 'kit', grit: 1,
    ops: [{ op: 'draw', n: 1, target: 'self' }] },
  { id: 'grubstake', name: 'Grubstake', type: 'kit', grit: 2, ops: [] },
  { id: 'bad-nerve', name: 'Bad Nerve', type: 'kit', grit: 0,
    ops: [{ op: 'draw', n: 2, target: 'self' }, { op: 'trash', n: 1, from: 'hand', target: 'self' }] },
  { id: 'scar', name: 'Scar', type: 'scar', grit: 0, ops: [] },
];

/** id -> copies in the 20-card, never-reshuffled Provision deck. */
export const PROVISION_COUNTS: Record<string, number> = {
  winchester: 3, scattergun: 2, 'hard-tack': 3, 'docs-bag': 2,
  'sheriffs-star': 1, 'lantern-oil': 2, 'good-stuff': 2,
  'good-rope': 2, 'fresh-horses': 2, 'bank-draft': 1,
};

const PROVISIONS: Card[] = [
  { id: 'winchester', name: 'Winchester', type: 'kit', cost: 3, grit: 1,
    ops: [{ op: 'damage', n: 2, target: 'choose' }] },
  { id: 'scattergun', name: 'Scattergun', type: 'kit', cost: 4, grit: 1,
    ops: [{ op: 'damage', n: 3, target: 'choose' }] },
  { id: 'hard-tack', name: 'Hard Tack', type: 'kit', cost: 2, grit: 2, ops: [] },
  { id: 'docs-bag', name: "Doc Mireles' Bag", type: 'kit', cost: 4, grit: 1,
    ops: [{ op: 'recover', target: 'self' }] },
  { id: 'sheriffs-star', name: "The Sheriff's Star", type: 'kit', cost: 5, grit: 2,
    ops: [{ op: 'actions', n: 1 }] },
  { id: 'lantern-oil', name: 'Lantern Oil', type: 'deed', cost: 2, grit: 1,
    ops: [{ op: 'damage', n: 2, target: 'choose' }] },
  { id: 'good-stuff', name: 'A Bottle of the Good Stuff', type: 'deed', cost: 2, grit: 1,
    ops: [{ op: 'draw', n: 2, target: 'self' }] },
  { id: 'good-rope', name: 'Good Rope', type: 'kit', cost: 3, grit: 2,
    ops: [{ op: 'draw', n: 1, target: 'self' }] },
  { id: 'fresh-horses', name: 'Fresh Horses', type: 'kit', cost: 3, grit: 1,
    ops: [{ op: 'actions', n: 1 }] },
  { id: 'bank-draft', name: 'Bank Draft', type: 'kit', cost: 4, grit: 3, ops: [] },
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
  { id: 'colt', name: "The Colt That Doesn't Miss", type: 'sign', cost: 4, grit: 2, whispers: 3,
    ops: [{ op: 'destroy', target: 'choose' }],
    fevered: { name: 'It Chooses', retarget: { 0: 'leftmostSlot' } } },

  { id: 'parson', name: "Parson Grimm's Blessing", type: 'sign', cost: 3, grit: 2, whispers: 2,
    ops: [{ op: 'recover', target: 'choose' }],
    fevered: { name: 'The Parson Knows Better', retarget: { 0: 'mostSigns' } } },

  { id: 'dynamite', name: 'Dynamite From the Old Shaft', type: 'sign', cost: 3, grit: 2, whispers: 2,
    ops: [{ op: 'destroy', target: 'choose' }],
    fevered: { name: 'The Shaft Remembers',
      appendOps: [{ op: 'trash', n: 1, from: 'deck', target: 'all' }] } },

  { id: 'debt', name: 'A Debt Comes Due', type: 'sign', cost: 2, grit: 2, whispers: 2,
    ops: [{ op: 'draw', n: 3, target: 'self' }],
    fevered: { name: 'The Ledger Reads Itself',
      appendOps: [{ op: 'discardHand', target: 'self' }] } },

  { id: 'night-watch', name: 'Night Watch', type: 'sign', cost: 3, grit: 2, whispers: 2,
    // "Once per round, cancel one Threat's Menace." Ruled a one-shot: you play
    // it, it cancels, it goes to the discard like anything else.
    ops: [{ op: 'cancelMenace', target: 'choose' }],
    fevered: { name: 'Something Else Is Watching', retarget: { 0: 'leftmostSlot' },
      appendOps: [
        { op: 'damage', n: 2, target: 'vessel' },
        { op: 'trash', n: 1, from: 'deck', target: 'self' },
      ] } },

  // "When your deck would empty, keep 2 cards instead of falling." Insurance you
  // hold rather than play — the one Sign whose whole point is never leaving your
  // deck. It briefly carried Vessel-facing Fevered damage, which turned it into
  // a pure battery: never played, so its 3 Whispers were never paid, and it
  // cashed out as free Act II damage. "Buy the dearest card" then won 96%.
  { id: 'last-words', name: 'Last Words', type: 'sign', cost: 4, grit: 2, whispers: 3,
    ops: [], passive: 'onFall:keepTwo',
    fevered: { name: "He Didn't Stay Down" } },

  { id: 'hymn', name: 'The Hymn With No Author', type: 'sign', cost: 3, grit: 2, whispers: 2,
    ops: [{ op: 'actions', n: 2 }],
    fevered: { name: 'You Know All the Verses', constraints: ['mustPlayOnDraw'] } },

  { id: 'certainty', name: "Prospector's Certainty", type: 'sign', cost: 2, grit: 2, whispers: 1,
    ops: [{ op: 'grit', n: 3 }],
    fevered: { name: 'He Never Stopped Digging', constraints: ['mustBuySignIfAble'] } },

  { id: 'stake-claim', name: 'Stake the Claim', type: 'sign', cost: 2, grit: 2, whispers: 1,
    ops: [{ op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' }],
    fevered: { name: 'The Claim Stakes You', retarget: { 0: 'left' },
      appendOps: [{ op: 'whisper', n: 1 }] } },

  { id: 'coyote', name: 'What the Coyote Told Me', type: 'sign', cost: 2, grit: 2, whispers: 1,
    // "Look at the top 3 cards of the Threat deck. Reorder them." Implemented as
    // choosing which of the three comes next — a full reorder cannot be
    // expressed as a legalCommands option without enumerating permutations.
    ops: [{ op: 'scry', n: 3, target: 'choose' }],
    fevered: { name: 'The Coyote Asks After You',
      // Needed a new op atom: the twist is an information leak, not a retarget.
      appendOps: [
        { op: 'revealHand', target: 'self' },
        { op: 'damage', n: 1, target: 'vessel' },
        { op: 'trash', n: 1, from: 'deck', target: 'self' },
      ] } },

  { id: 'salt-line', name: 'Salt Line at the Door', type: 'sign', cost: 3, grit: 2, whispers: 2,
    // "Prevent 2 damage to any player." A buffer that waits to be spent.
    ops: [{ op: 'shield', n: 2, target: 'choose' }],
    fevered: { name: 'The Line Has Been Crossed',
      appendOps: [
        { op: 'whisper', n: 1 },
        { op: 'damage', n: 1, target: 'vessel' },
        { op: 'trash', n: 1, from: 'deck', target: 'self' },
      ] } },

  { id: 'widow', name: "The Widow's Instruction", type: 'sign', cost: 3, grit: 2, whispers: 2,
    ops: [{ op: 'trash', n: 1, from: 'hand', target: 'self' }],
    fevered: { name: 'She Has Other Instructions',
      appendOps: [{ op: 'gainCard', filter: { type: 'sign', maxCost: 2, from: 'signs' }, target: 'self' }] } },
];

// Act I Trouble. The Bounty line is what makes Act I combat generative —
// "Nothing in Act II pays a Bounty. Ever." (DESIGN.md §7's economy inversion.)
const TROUBLE: Card[] = [
  { id: 'claim-jumpers', name: 'Claim Jumpers', type: 'trouble', grit: 0, clear: 3, menace: 1, ops: [],
    reverse: 'never-miners',
    bounty: [{ op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' }] },
  { id: 'rustlers', name: 'Rustlers at the Draw', type: 'trouble', grit: 0, clear: 2, menace: 1, ops: [],
    reverse: 'herd-back',
    bounty: [{ op: 'gritNextTurn', n: 2, target: 'self' }] },
  { id: 'barons-men', name: "Cattle Baron's Men", type: 'trouble', grit: 0, clear: 4, menace: 2, ops: [],
    reverse: 'baron-promise',
    bounty: [
      { op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' },
      { op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' },
    ] },
  { id: 'prairie-fire', name: 'Prairie Fire', type: 'trouble', grit: 0, clear: 3, menace: 2, ops: [],
    reverse: 'wrong-colour',
    bounty: [
      { op: 'trash', n: 1, from: 'hand', target: 'self' },
      { op: 'grit', n: 3 },
    ] },
  { id: 'cardsharp', name: 'The Cardsharp', type: 'trouble', grit: 0, clear: 2, menace: 0, ops: [],
    bounty: [{ op: 'draw', n: 2, target: 'self' }] },
  { id: 'stage-robbery', name: 'Stagecoach Robbery', type: 'trouble', grit: 0, clear: 3, menace: 1, ops: [],
    bounty: [{ op: 'gritNextTurn', n: 3, target: 'self' }] },
  { id: 'hanging-tree', name: 'The Hanging Tree Dispute', type: 'trouble', grit: 0, clear: 2, menace: 1, ops: [],
    bounty: [{ op: 'trash', n: 1, from: 'hand', target: 'self' }] },
  { id: 'silver-bit', name: 'Brawl at the Silver Bit', type: 'trouble', grit: 0, clear: 2, menace: 1, ops: [],
    bounty: [
      { op: 'draw', n: 1, target: 'self' },
      { op: 'gritNextTurn', n: 1, target: 'all' },
    ] },
  { id: 'horse-thieves', name: 'Horse Thieves', type: 'trouble', grit: 0, clear: 3, menace: 1, ops: [],
    bounty: [{ op: 'gainCard', filter: { from: 'provisionRow' }, target: 'self' }] },
  // Omens have no Clear and no Bounty. They only sit there and cost you.
  { id: 'dead-cattle', name: 'Dead Cattle, No Wounds', type: 'omen', grit: 0, menace: 0, ops: [] },
  { id: 'the-well', name: 'The Well Tastes Like Pennies', type: 'omen', grit: 0, menace: 0, ops: [] },
  { id: 'preacher', name: "The Preacher Won't Come Out", type: 'omen', grit: 0, menace: 0, ops: [] },
];

// The four reverse faces. Every Trouble card still in the Street flips to its
// reverse at the Turning — the threats you left standing become the things that
// kill you. They are Act II cards, so none of them pays a Bounty.
const TURNED: Card[] = [
  { id: 'never-miners', name: 'They Were Never Miners', type: 'mythos',
    grit: 0, clear: 5, menace: 2, ops: [], menaceTarget: 'fewestCards' },
  { id: 'herd-back', name: 'They Brought the Herd Back', type: 'mythos',
    grit: 0, clear: 5, menace: 2, ops: [], noClearWhileOmen: true },
  { id: 'baron-promise', name: 'The Baron Kept His Promise', type: 'mythos',
    grit: 0, clear: 6, menace: 3, ops: [],
    onCleared: [{ op: 'whisper', n: 2 }] },
  { id: 'wrong-colour', name: 'It Burns the Wrong Colour', type: 'mythos',
    grit: 0, clear: 4, menace: 2, ops: [], menaceTarget: 'all' },
];

const MYTHOS: Card[] = [
  { id: 'thing-in-well', name: 'The Thing in the Well', type: 'mythos', grit: 0, clear: 5, menace: 2, ops: [] },
  // The two cards below have no Clear: no amount of damage removes them. They
  // are not permanent any more — they have a PRICE. DESIGN.md §7 gives Act II
  // Threats a Toll where Act I ones have a Bounty, the same third line with the
  // arithmetic inverted, and that is what makes a blocked slot a decision
  // rather than a dead one.
  //   Dry Grass prints its Toll: trash a Sign and take a Scar.
  //   Nothing Comes prints "no Menace resolves, discard at end of round" — so
  //     the quiet-round idea in DESIGN.md §7 is dropped; it is an obstruction.
  { id: 'dry-grass', name: 'Choir of the Dry Grass', type: 'mythos', grit: 0, menace: 0, ops: [],
    // Printed on the card. The model for every Toll: it asks for the thing you
    // least want to give, and leaves a mark that never comes off.
    toll: [
      { op: 'trash', n: 1, from: 'hand', target: 'self', kind: 'sign' },
      { op: 'scar', n: 1, target: 'self' },
    ] },
  { id: 'own-face', name: 'Your Own Face, Waiting', type: 'mythos', grit: 0, clear: 4, menace: 3, ops: [],
    menaceTarget: 'mostSigns' },
  { id: 'nothing-comes', name: 'Nothing Comes', type: 'mythos', grit: 0, menace: 0, ops: [],
    // Cheaper than the Choir, and payable by a deck that holds no Signs at all
    // — otherwise a Puritan table can never clear it and the slot really is
    // dead for them.
    toll: [{ op: 'trash', n: 2, from: 'deck', target: 'self' }] },
  { id: 'wearing-sheriff', name: 'Something Wearing the Sheriff', type: 'mythos', grit: 0, clear: 5, menace: 2, ops: [] },
  { id: 'seam', name: 'The Sky Has a Seam in It', type: 'mythos', grit: 0, clear: 6, menace: 1, ops: [] },
  { id: 'town-beneath', name: 'The Town Beneath the Town', type: 'mythos', grit: 0, clear: 4, menace: 2, ops: [] },
  { id: 'doors-inward', name: 'All the Doors Open Inward', type: 'mythos', grit: 0, clear: 3, menace: 2, ops: [] },
  { id: 'coyote-debt', name: "Grandmother Coyote's Debt", type: 'mythos', grit: 0, clear: 4, menace: 1, ops: [] },
  { id: 'long-noon', name: 'The Long Noon', type: 'mythos', grit: 0, clear: 7, menace: 3, ops: [] },
];

export const ALL_CARDS: Card[] = [
  ...STARTERS, ...PROVISIONS, ...SIGNS, ...TROUBLE, ...TURNED, ...MYTHOS,
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
export const TROUBLE_IDS = TROUBLE.map((t) => t.id);
export const MYTHOS_IDS = MYTHOS.map((m) => m.id);
