// The rules, at the moment you need them.
//
// Two things live here:
//
//   1. The glossary itself. Every entry says what the thing IS and what it
//      COSTS you, because in this game that is usually the same sentence.
//   2. Automatic keyword detection. Any rules text rendered through <Rules>
//      gets its keywords underlined and explained on hover — so a card that
//      says "Destroy a Threat" explains "Threat" without anyone remembering to
//      wrap it. A term you have to leave the table to look up is a term you
//      will guess at instead.
//
// Tooltips are one shared element positioned at the pointer, not a bubble
// nested in each keyword: keywords live inside scrolling rails and short cards,
// where a nested popover gets clipped by its own container.

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { Icon } from './components/Icon';
import { TERM_ICONS } from './icons';

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
    short: 'A shared track. When it fills, the Turning comes.',
    long: 'Signs carry Whispers that fire when you PLAY them — never when you '
      + 'buy them. They go on one track shared by the whole table, so the cost '
      + 'of your power is paid by everyone at it.',
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
    long: 'Damage trashes cards, taking Kit and Provisions before Signs. A '
      + 'wounded player does not just get weaker, they get more corrupt — and a '
      + 'thin deck is a fragile one. Chaff is armour here.',
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

// ------------------------------------------------------------------ tooltip

interface Hover { entry: Entry; key: string; x: number; y: number }

const TipContext = createContext<{
  show(e: Entry, key: string, at: DOMRect): void;
  hide(): void;
}>({ show: () => {}, hide: () => {} });

/** Wrap the app once. Renders a single tooltip, positioned at the keyword. */
export function Tooltips({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<Hover | null>(null);

  const api = useMemo(() => ({
    show(entry: Entry, key: string, at: DOMRect) {
      setHover({ entry, key, x: at.left + at.width / 2, y: at.top });
    },
    hide() { setHover(null); },
  }), []);

  return (
    <TipContext.Provider value={api}>
      {children}
      {hover && (
        <div className="tip" style={tipPosition(hover)} role="tooltip">
          <strong>
            {TERM_ICONS[hover.key] && <Icon name={TERM_ICONS[hover.key]} size={16} />}
            {hover.entry.term}
          </strong>
          <em>{hover.entry.short}</em>
          <span>{hover.entry.long}</span>
        </div>
      )}
    </TipContext.Provider>
  );
}

/** Keep the bubble on screen — keywords sit inside rails and near edges. */
function tipPosition(h: Hover): React.CSSProperties {
  const width = 300;
  const half = width / 2;
  const x = Math.min(Math.max(h.x, half + 8), window.innerWidth - half - 8);
  const above = h.y > 240;
  return {
    width,
    left: x,
    top: above ? undefined : h.y + 24,
    bottom: above ? window.innerHeight - h.y + 10 : undefined,
    transform: 'translateX(-50%)',
  };
}

/** One keyword: readable in place, explained on hover or focus. */
export function Term({ k, children }: { k: string; children?: ReactNode }) {
  const tip = useContext(TipContext);
  const entry = GLOSSARY[k];
  const enter = useCallback((e: React.SyntheticEvent<HTMLElement>) => {
    if (entry) tip.show(entry, k, e.currentTarget.getBoundingClientRect());
  }, [entry, k, tip]);

  if (!entry) return <>{children}</>;
  return (
    <span
      className="kw" tabIndex={0} role="button" aria-label={`${entry.term}: ${entry.short}`}
      onMouseEnter={enter} onFocus={enter}
      onMouseLeave={tip.hide} onBlur={tip.hide}
    >{children ?? entry.term}</span>
  );
}

// ------------------------------------------------------- automatic keywords

/** Every alias, longest first so "the vessel" wins over "vessel". */
const ALIASES: [string, string][] = Object.entries(GLOSSARY)
  .flatMap(([key, e]) => (e.also ?? [e.term.toLowerCase()]).map((a) => [a, key] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

const PATTERN = new RegExp(
  `\\b(${ALIASES.map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

const KEY_OF = new Map(ALIASES);

/**
 * Rules text with every known keyword made hoverable.
 *
 * Applied to strings the engine generated, so a card explaining itself also
 * explains its own vocabulary — without anyone having to remember to mark it up.
 */
export function Rules({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(PATTERN)) {
      const at = m.index ?? 0;
      if (at > last) out.push(text.slice(last, at));
      const key = KEY_OF.get(m[0].toLowerCase());
      out.push(key ? <Term key={`${at}`} k={key}>{m[0]}</Term> : m[0]);
      last = at + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);
  return <>{parts}</>;
}
