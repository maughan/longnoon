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
// From the generated module, not the component: this file is reached from the
// root tsconfig via the narration tests, which do not compile JSX.
import type { IconName } from './components/iconsgen';

/** A card, by what it is. Trouble and Mythos are known by what they do to you. */
export function iconForCard(def: Card, fevered = false): IconName {
  if (def.type === 'sign') return fevered ? 'fevered' : 'sign';
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
    case 'oldOne': return 'vessel';
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
