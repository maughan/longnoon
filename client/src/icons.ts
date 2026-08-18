// Which icon stands for what.
//
// Kept apart from the components so the choices can be read in one place and
// argued with. Two rules held throughout:
//
//   1. An icon never appears alone where the number matters. "3" beside a Grit
//      mark is a quantity; three Grit marks in a row is a quantity you have to
//      count. Whispers and Menace are the exceptions — they are small, and
//      counting them is the point.
//   2. Nothing gets an icon just because one exists for it. An icon on every
//      noun is wallpaper, and stops being read.

import type { Card, Status } from '../../engine/state';
// From the NAMES module, not the component: this file is reached from the root
// tsconfig via the narration tests, which compile no JSX and cannot resolve a
// `.png` import. `iconNames.ts` is types only, for exactly that reason.
import type { IconName } from './components/iconNames';

/** A card, by what it is. Trouble and Mythos are known by what they do to you. */
export function iconForCard(def: Card, fevered = false): IconName {
  if (def.type === 'sign') return fevered ? 'fevered' : 'sign';
  /*
    The Vessel's own deck, marked with the same glyph as the Vessel's seat.

    Reused rather than drawn anew, and that is the point rather than a saving:
    the Vessel is one entity, so the tag on the player and the mark on their
    cards should be the same thing. A second glyph would imply a second thing
    to learn, which is what the whole Vessel/Old One rename was about.

    Without this case these fell through to `kit` and printed the PROVISION
    mark — the one family they can never be.
  */
  if (def.type === 'vessel') return 'vessel';
  // Same reasoning for the fallen's granted card: the mark on the seat and the
  // mark on the card are one thing. Without this it falls through to `kit` and
  // prints the Provision mark, which is the one family it can never be.
  if (def.type === 'revenant') return 'revenant';
  if (def.type === 'omen') return 'omen';
  if (def.type === 'trouble' || def.type === 'mythos') return 'menace';
  if (def.type === 'scar') return 'scar';
  if (def.type === 'deed') return 'deed';
  return 'kit';
}

/** What has become of a player. `posse` gets nothing — it is the default. */
export function iconForStatus(status: Status): IconName | null {
  switch (status) {
    case 'revenant': return 'revenant';
    case 'vessel': return 'vessel';
    case 'gone': return 'grave';
    default: return null;
  }
}

/** Glossary terms that have a mark of their own. */
export const TERM_ICONS: Record<string, IconName> = {
  grit: 'grit',
  cost: 'grit',
  whispers: 'whisper',
  turning: 'fevered',
  signs: 'sign',
  fevered: 'fevered',
  provisions: 'kit',
  threat: 'menace',
  clear: 'clear',
  menace: 'menace',
  bounty: 'grit',
  toll: 'scar',
  damage: 'scar',
  deck: 'kit',
  omen: 'omen',
  doom: 'doom',
  vessel: 'vessel',
  revenant: 'revenant',
  scars: 'scar',
  boneyard: 'grave',
  dusk: 'doom',
  marked: 'marked',
};
