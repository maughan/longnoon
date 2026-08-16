// The glossary itself: what every term in the game means.
//
// Data and matching, kept apart from the components that draw them, so the
// pure parts can be imported by anything — including tests running under the
// root project, which has no JSX and no DOM.

export interface Entry {
  term: string;
  short: string;
  long: string;
  /** Other words that mean this. Matched case-insensitively, longest first. */
  also?: string[];
}

export const GLOSSARY: Record<string, Entry> = {
  grit: {
    term: 'Grit', also: ['grit'],
    short: 'What you pay with — and it does not keep.',
    long: 'There is no money card. To get Grit you cash a card IN: it goes to '
      + 'your discard and you take its Grit value instead of playing it. So '
      + 'every purchase costs you a card you could have used. Whatever Grit you '
      + 'do not spend is gone at the end of your turn — it does not bank.',
  },
  cost: {
    term: 'Cost', also: ['cost'],
    short: 'Grit needed to buy this.',
    long: 'Raise it by cashing in cards from your hand, then buy. Buying also '
      + 'costs an action, and it is the only healing in the game — so what you '
      + 'spend on is what keeps you standing.',
  },
  action: {
    term: 'Action', also: ['action', 'actions'],
    short: 'You get three a turn.',
    long: 'An action is: play a card, buy a card, or deal damage. Cashing a card '
      + 'in for Grit is free — it is the playing and buying that costs.',
  },
  whispers: {
    term: 'Whispers', also: ['whisper', 'whispers'],
    short: 'A shared bar. Fill it and something bad happens.',
    long: 'Signs carry Whispers that fire when you PLAY them — never when you '
      + 'buy them. They go on one bar shared by the whole table, so the cost '
      + 'of your power is paid by everyone at it. Fill it in the Long Season '
      + 'and the Turning comes, once. Fill it after that and Doom climbs, and '
      + 'the bar starts again — and again. The Vessel can push it too: it '
      + 'names a player, and their next purchase feeds the bar.',
  },
  turning: {
    term: 'The Turning', also: ['the turning', 'turning'],
    short: 'Act I ends. Something wakes up.',
    long: 'The player holding the most Signs becomes the Vessel and takes the '
      + "Old One's side. Every Sign everywhere flips to its Fevered face, and "
      + 'every Threat still standing in the Street flips to its reverse.',
  },
  signs: {
    term: 'Signs', also: ['sign', 'signs'],
    short: 'Stronger than anything honest, and never sold out.',
    long: 'Better per coin than Provisions and always available. They also carry '
      + 'Whispers, cannot be trashed by damage, and flip to a Fevered face at '
      + 'the Turning. Buying none is a losing line; buying only Signs is worse.',
  },
  fevered: {
    term: 'Fevered', also: ['fevered'],
    short: 'Same power. No longer aimed by you.',
    long: 'A Fevered card is not weaker — it usually does the same thing to a '
      + 'target you no longer choose. Some of them turn on the Vessel, which is '
      + 'the only way to bury it.',
  },
  provisions: {
    term: 'Provisions', also: ['provision', 'provisions'],
    short: 'Honest, weaker, and finite.',
    long: 'A market deck that is never reshuffled. When it runs dry, healing '
      + 'stops existing — because buying is healing.',
  },
  threat: {
    term: 'Threat', also: ['threat', 'threats'],
    short: 'Trouble standing in the Street.',
    long: 'Each has a Clear value (damage to remove it) and a Menace (damage it '
      + 'deals at Dusk if you leave it). The Street holds three at a time; a '
      + 'fourth arriving shoves the oldest out, resolving its Menace on the way.',
  },
  clear: {
    term: 'Clear', also: ['clear'],
    short: 'Damage needed to remove a Threat.',
    long: 'In Act I, clearing a Threat pays a Bounty. In Act II nothing pays a '
      + 'Bounty, ever — the same fights, the opposite arithmetic.',
  },
  menace: {
    term: 'Menace', also: ['menace'],
    short: 'What it does to you at Dusk if it is still there.',
    long: 'Menace lands on whoever holds the most Signs — corruption draws '
      + 'attention — and the more Signs they hold, the deeper it cuts.',
  },
  toll: {
    term: 'Toll', also: ['toll'],
    short: 'What it costs to be rid of it, when damage cannot.',
    long: 'Some Act II Threats have no Clear value — no amount of shooting '
      + 'removes them. They have a price instead, paid with an action and '
      + 'whatever the card asks. It is only offered when you can actually meet '
      + 'it.',
  },
  bounty: {
    term: 'Bounty', also: ['bounty'],
    short: 'What clearing a Threat pays, in Act I only.',
    long: 'Act I combat is generative: you fight rustlers and winning pays. '
      + 'After the Turning it pays nothing at all, and the floor drops out '
      + 'without anyone explaining why.',
  },
  damage: {
    term: 'Damage', also: ['damage'],
    short: 'You lose cards off your deck. There is no health bar.',
    long: 'Damage takes cards off the TOP of your deck — you do not choose '
      + 'which, and because the deck is shuffled you cannot know. It takes Kit '
      + 'and Provisions before Signs, so a wounded player does not just get '
      + 'weaker, they get more corrupt. Last Words is taken last of all. A thin '
      + 'deck is a fragile one: chaff is armour here.',
  },
  trash: {
    term: 'Trash', also: ['trash', 'trashed', 'trashes', 'trashing'],
    short: 'The card is gone for good, to the boneyard.',
    long: 'Trashed cards go to the boneyard and never come back — there is no '
      + 'other way to remove a card, which is why decks only ever grow. Where '
      + 'the card comes from depends on the wording. "In hand" takes your '
      + 'leftmost card that is not a Sign, so you can see it coming; damage '
      + 'takes off the top of your shuffled deck, so you cannot. Signs are '
      + 'never trashed while anything else remains, and a Scar cannot be '
      + 'trashed at all.',
  },
  deck: {
    term: 'Your deck', also: ['deck'],
    short: 'Your deck is your health.',
    long: 'When it runs out at the moment you would draw, you fall. That is why '
      + 'buying is healing and why trashing your own cards is a gamble rather '
      + 'than an obvious good.',
  },
  omen: {
    term: 'Omen', also: ['omen', 'omens'],
    short: 'Cannot be cleared. Just sits there.',
    long: 'An Omen holds a Street slot for good, adds a Whisper every round, and '
      + 'wipes out any progress toward burying the Vessel when it arrives. A '
      + 'dead slot is fewer options for the posse, on purpose.',
  },
  doom: {
    term: 'Doom', also: ['doom'],
    short: "The Old One's clock, in Act II.",
    long: 'It starts at the Turning and climbs every round. If it fills, the Old '
      + 'One wins. Burying the Vessel first is the only way out.',
  },
  vessel: {
    term: 'The Vessel', also: ['the vessel', 'vessel'],
    short: 'The player it woke up inside.',
    long: 'Bury them by dealing damage across any number of turns. Most cards '
      + 'cannot be aimed at the Vessel — the ones that can are mostly Signs that '
      + 'have turned.',
  },
  revenant: {
    term: 'Revenant', also: ['revenant', 'revenants'],
    short: 'You fell. You did not leave.',
    long: 'You keep every Sign, Fevered side up, and you win only if the Old One '
      + 'wins. You cannot buy, and your deck loses a card every time it cycles — '
      + 'strongest the moment you turn, weaker every round after.',
  },
  scars: {
    term: 'Scars', also: ['scar', 'scars'],
    short: 'Dead cards you can never remove.',
    long: 'No Grit, no effect, permanent. The only purely bad card in the game.',
  },
  boneyard: {
    term: 'Boneyard', also: ['boneyard'],
    short: 'Trashed cards, face up, gone for good.',
    long: 'Everyone can see it. It is the public record of what this has already '
      + 'taken from you.',
  },
  dusk: {
    term: 'Dusk', also: ['dusk'],
    short: 'End of the round, when the Street collects.',
    long: 'Every unresolved Threat deals its Menace, Omens add their Whispers, '
      + 'and the tracks are checked.',
  },
  marked: {
    term: 'The Marked', also: ['the marked', 'marked'],
    short: 'One of you wins only if the Old One does.',
    long: 'They do not sabotage. They encourage — and encouraging looks exactly '
      + 'like playing well.',
  },
};


// ------------------------------------------------------- automatic keywords

/** Every alias, longest first so "the vessel" wins over "vessel". */
const ALIASES: [string, string][] = Object.entries(GLOSSARY)
  .flatMap(([key, e]) => (e.also ?? [e.term.toLowerCase()]).map((a) => [a, key] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

export const PATTERN = new RegExp(
  `\\b(${ALIASES.map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

export const KEY_OF = new Map(ALIASES);

/**
 * Rules text with every known keyword made hoverable.
 *
 * Applied to strings the engine generated, so a card explaining itself also
 * explains its own vocabulary — without anyone having to remember to mark it up.
 */
/**
 * Which glossary entries a piece of text mentions.
 *
 * The same alias matching `Rules` uses to underline them, returned as keys
 * instead of markup — so a card can be asked what it needs explaining without
 * anyone maintaining a second list of which words matter.
 */
export function keywordsIn(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const key = KEY_OF.get(m[0].toLowerCase());
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
}

