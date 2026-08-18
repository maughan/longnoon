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
    short: 'What you buy with. It does not carry over.',
    long: 'There is no money card. To get Grit, cash a card in: drag it to the '
      + 'market and you take its Grit value instead of playing it. The card '
      + 'goes to your discard, so you still own it — you just spent its turn. '
      + 'Any Grit left at the end of your turn is lost, so spend it or do not '
      + 'raise it.',
  },
  cost: {
    term: 'Cost', also: ['cost'],
    short: 'The Grit you need to buy a card.',
    long: 'Cash cards in until you have enough, then buy. Buying costs one of '
      + 'your three actions. Cashing in does not.',
  },
  action: {
    term: 'Action', also: ['action', 'actions'],
    short: 'You get three each turn.',
    long: 'Playing a card costs an action, and so does buying one. Cashing a '
      + 'card in for Grit is free — do as much of that as you like. When your '
      + 'actions run out, end your turn.',
  },
  whispers: {
    term: 'Whispers', also: ['whisper', 'whispers'],
    short: 'One bar, shared by everyone. Filling it is bad.',
    long: 'Signs have Whisper pips. You add them when you PLAY a Sign, never '
      + 'when you buy one — so a Sign in your hand costs the table nothing '
      + 'until you use it. The bar belongs to everybody, so your power is paid '
      + 'for by the whole posse. Fill it before the Turning and the Turning '
      + 'happens. Fill it afterwards and Doom climbs, then the bar empties and '
      + 'starts again.',
  },
  turning: {
    term: 'The Turning', also: ['the turning', 'turning'],
    short: 'The game changes sides halfway through.',
    long: 'When the Whisper bar fills, whoever holds the most Signs becomes the '
      + 'Vessel and starts playing against the rest of you. Every Sign anyone '
      + 'owns flips to its Fevered face at the same moment, and Threats left '
      + 'in the Street turn into something worse.',
  },
  signs: {
    term: 'Signs', also: ['sign', 'signs'],
    short: 'The strong cards. Buying them is how you lose.',
    long: 'Signs are better than Provisions and never run out of stock. They '
      + 'also carry Whispers, they flip to a Fevered face at the Turning, and '
      + 'whoever has the most of them becomes the Vessel. Damage takes your '
      + 'other cards before it takes a Sign, so a corrupt deck is also a hard '
      + 'one to kill. Buying none is a losing line. Buying only Signs is worse.',
  },
  fevered: {
    term: 'Fevered', also: ['fevered'],
    short: 'The same card, aimed by something else.',
    long: 'After the Turning every Sign shows its Fevered face. It is usually '
      + 'just as strong — what you lose is the choice of target. A few of them '
      + 'turn on the Vessel, and those are how you win.',
  },
  provisions: {
    term: 'Provisions', also: ['provision', 'provisions'],
    short: 'The honest cards. There are only so many.',
    long: 'Weaker than Signs, and the market deck is never reshuffled. Once it '
      + 'is empty there is nothing safe left to buy — and since buying is the '
      + 'only way to add cards, it is the only way to heal.',
  },
  threat: {
    term: 'Threat', also: ['threat', 'threats'],
    short: 'Trouble standing in the Street, waiting for Dusk.',
    long: 'Every Threat shows a Clear value — the damage needed to remove it — '
      + 'and a Menace — what it does to somebody at the end of the round. Leave '
      + 'one standing and it gets harder: both numbers grow each Dusk it '
      + 'survives. If the Street is full when another arrives, the oldest one '
      + 'attacks, grows, and stays.',
  },
  clear: {
    term: 'Clear', also: ['clear'],
    short: 'The damage needed to remove a Threat.',
    long: 'Damage adds up across turns, so a Threat you half-shot stays half '
      + 'shot. Clearing one before the Turning pays a Bounty; afterwards it '
      + 'pays nothing.',
  },
  menace: {
    term: 'Menace', also: ['menace'],
    short: 'What a Threat does to you at Dusk.',
    long: 'At the end of every round each Threat still standing wounds one '
      + 'player. It goes for whoever holds the most Signs, and the more they '
      + 'hold the harder it hits. It never touches the Vessel.',
  },
  toll: {
    term: 'Toll', also: ['toll'],
    short: 'A price you pay to remove a Threat you cannot shoot.',
    long: 'Some Threats after the Turning have no Clear value, so no amount of '
      + 'damage will move them. Instead they name a price — an action plus '
      + 'whatever the card asks. You will only be offered it when you can '
      + 'actually pay.',
  },
  bounty: {
    term: 'Bounty', also: ['bounty'],
    short: 'The reward for clearing a Threat, before the Turning only.',
    long: 'Clear a Threat in the first half of the game and it pays you — Grit, '
      + 'a free Provision, something. After the Turning nothing pays anything, '
      + 'and every fight is pure survival.',
  },
  damage: {
    term: 'Damage', also: ['damage'],
    short: 'When you take damage you lose cards. There is no health bar.',
    long: 'Damage takes cards off the top of your deck and trashes them. You do '
      + 'not choose which, and the deck is shuffled, so you cannot know what '
      + 'you are about to lose. It takes your ordinary cards before it takes a '
      + 'Sign. Run out of deck when you need to draw and you fall.',
  },
  trash: {
    term: 'Trash', also: ['trash', 'trashed', 'trashes', 'trashing'],
    short: 'The card is gone for good.',
    long: 'Trashed cards go to the boneyard and never come back. Nothing else '
      + 'removes a card, so your deck only ever grows. When a card says "in '
      + 'hand" it takes your leftmost card that is not a Sign, so you can see '
      + 'which one is going; damage takes off the top of your deck, so you '
      + 'cannot. A Scar can never be trashed.',
  },
  deck: {
    term: 'Your deck', also: ['deck'],
    short: 'Your deck is your life total.',
    long: 'You fall when your deck runs out at the moment you would draw. That '
      + 'is why buying cards keeps you alive, and why cheap useless cards are '
      + 'still worth having — anything that soaks a hit is doing a job.',
  },
  omen: {
    term: 'Omen', also: ['omen', 'omens'],
    short: 'A Threat that cannot be cleared.',
    long: 'An Omen takes a Street slot and keeps it. No amount of damage moves '
      + 'it, it adds a Whisper every round, and if one arrives it undoes any '
      + 'damage already done to the Vessel. Dynamite is the only thing that '
      + 'removes one, and it costs you a Scar.',
  },
  doom: {
    term: 'Doom', also: ['doom'],
    short: 'The clock that runs after the Turning.',
    long: 'Doom starts when the Turning happens and climbs — a point for every '
      + 'Threat you leave standing at Dusk, and a jump every time the Whisper '
      + 'bar fills again. If Doom reaches the top, you have lost. Burying the '
      + 'Vessel before it does is the only way out.',
  },
  vessel: {
    term: 'The Vessel', also: ['the vessel', 'vessel'],
    short: 'The player it woke up inside. Bury them to win.',
    long: 'At the Turning the most corrupt player becomes the Vessel and plays '
      + 'against you, with a deck of their own. You win by dealing enough '
      + 'damage to them, added up over as many turns as it takes. Most cards '
      + 'cannot be aimed at them — the ones that can are mostly your own Signs, '
      + 'now Fevered.',
  },
  revenant: {
    term: 'Revenant', also: ['revenant', 'revenants'],
    short: 'What you become when you fall. You are still playing.',
    long: 'You keep your Signs, Fevered side up, and you now win with the '
      + 'Vessel rather than the posse. You cannot buy anything, and your deck '
      + 'loses a card each time it runs out — so you are at your strongest the '
      + 'moment you fall and weaker every round after.',
  },
  scars: {
    term: 'Scars', also: ['scar', 'scars'],
    short: 'A dead card you are stuck with.',
    long: 'No Grit, no effect, and nothing removes it. It sits in your deck '
      + 'taking up a draw. Some prices are paid in Scars.',
  },
  boneyard: {
    term: 'Boneyard', also: ['boneyard'],
    short: 'Where trashed cards go. They do not come back.',
    long: 'Face up, and everyone can look. It is the running record of what '
      + 'this has cost you.',
  },
  dusk: {
    term: 'Dusk', also: ['dusk'],
    short: 'The end of the round, when the Street collects.',
    long: 'Every Threat still standing wounds somebody and gets harder. Omens '
      + 'add their Whispers. After the Turning, each one left also adds Doom. '
      + 'Then a new round begins and more Trouble arrives.',
  },
  marked: {
    term: 'The Marked', also: ['the marked', 'marked'],
    short: 'One of you is secretly playing for the other side.',
    long: 'At the start, one player is dealt the Marked role and tells nobody. '
      + 'They win only if the posse loses. They cannot attack you — all they '
      + 'can do is encourage, and buying Signs enthusiastically looks exactly '
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

