// What a card sounds like when it is played.
//
// Keyed by card id, because the sound belongs to the card and not to the op it
// resolves. A Six-Gun and the Colt both deal damage; only one of them is a
// pistol, and `damage` is also what a thrown stick of dynamite does.
//
// Adding a card is one line in CLIPS. Cards with no entry make no sound, which
// is the default and should stay the common case — if every card had a noise,
// none of them would mean anything.

import type { GameEvent } from '../../engine/state';
import gunshotA from './components/audio/gunshot-a.mp3';
import dynamiteBlast from './components/audio/dynamite-blast.mp3';
import dynamiteFevered from './components/audio/dynamite-fevered.mp3';

interface Clip {
  src: string;
  /** Loudness relative to the effects level. */
  gain: number;
  /**
   * What the card sounds like once it has turned.
   *
   * A Fevered card is the same card doing the same thing to a target you no
   * longer choose — so it wants the same sound, changed, rather than a
   * different one. Omit and a turned card keeps its clean face's sound.
   */
  fevered?: { src: string; gain: number };
  /**
   * Events that mean the card has actually gone off.
   *
   * A card that needs a target is PLAYED in one batch and resolves in the next,
   * once the player has picked — so firing on PLAYED puts the shot before the
   * aim, and with bots on a five-second floor that gap is long enough to be
   * plainly wrong. Naming the landing events instead makes the sound wait.
   *
   * Omit for a card that resolves the instant it is played.
   */
  on?: GameEvent['t'][];
}

/** Card id -> what it sounds like. */
const CLIPS: Record<string, Clip> = {
  'six-gun': {
    src: gunshotA,
    gain: 0.85,
    on: ['THREAT_DAMAGED', 'DAMAGED', 'VESSEL_DAMAGED'],
  },
  dynamite: {
    src: dynamiteBlast,
    gain: 0.9,
    fevered: { src: dynamiteFevered, gain: 0.9 },
    // `destroy` clears the Threat outright rather than damaging it, so this
    // lands on THREAT_CLEARED. The Fevered face also makes the whole table
    // trash a card; DAMAGED covers the case where the blast finds no Threat
    // to take but still takes something off everyone.
    on: ['THREAT_CLEARED', 'DAMAGED'],
  },
};

export interface CardSounds {
  /**
   * Feed one batch of events.
   *
   * Stateful across calls on purpose: a card that waits for a target is armed
   * by its PLAYED event and fires from a later batch, so this has to remember
   * what is still in the air.
   *
   * `level` is the effects setting with mute already folded in.
   */
  hear(events: readonly GameEvent[], seat: string | null, level: number): void;
}

export function createCardSounds(): CardSounds {
  // One element per distinct clip, made on first use and cloned per play so two
  // shots in a turn overlap rather than cutting each other off.
  const made = new Map<string, HTMLAudioElement>();
  /** A card played, waiting on the target it still has to be pointed at. */
  let aimed: { cardId: string; player: string; fevered: boolean } | null = null;

  function fire(cardId: string, fevered: boolean, level: number, near: boolean) {
      const entry = CLIPS[cardId];
      if (!entry || level <= 0) return;
      const clip = fevered && entry.fevered ? entry.fevered : entry;

      let el = made.get(clip.src);
      if (!el) {
        el = new Audio(clip.src);
        el.preload = 'auto';
        made.set(clip.src, el);
      }

      const node = el.cloneNode() as HTMLAudioElement;
      // A gunshot fired six times a round is the fastest way to make a player
      // reach for the mute. Detuned like the coins, for the same reason: two in
      // a row must not be audibly the same recording.
      node.playbackRate = 0.94 + Math.random() * 0.12;
      node.volume = Math.min(1, clip.gain * level * (near ? 1 : 0.55));
      // Refused audio is not an error worth a console entry, let alone an
      // unhandled rejection.
      void node.play().catch(() => {});
  }

  return {
    hear(events, seat, level) {
      for (const e of events) {
        if (e.t === 'PLAYED' && CLIPS[e.cardId]) {
          // No landing events named: it happens as it is played.
          if (!CLIPS[e.cardId].on) fire(e.cardId, e.fevered, level, e.player === seat);
          else aimed = { cardId: e.cardId, player: e.player, fevered: e.fevered };
          continue;
        }
        if (aimed && CLIPS[aimed.cardId].on?.includes(e.t)) {
          fire(aimed.cardId, aimed.fevered, level, aimed.player === seat);
          aimed = null;
        }
      }
      // Still in the air at the end of the batch? Only a pending choice
      // explains that. Anything else means it fizzled — no legal target, or
      // the damage was prevented — and a shot left armed would go off later on
      // somebody else's card.
      if (aimed && !events.some((e) => e.t === 'CHOICE_REQUIRED')) aimed = null;
    },
  };
}
