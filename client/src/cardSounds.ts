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
import shuffleA from './components/audio/shuffle-a.mp3';
import dealA from './components/audio/deal-a.mp3';
import dealB from './components/audio/deal-b.mp3';
import dealC from './components/audio/deal-c.mp3';
import dealD from './components/audio/deal-d.mp3';
import dealHand from './components/audio/deal-hand.mp3';
import discardA from './components/audio/discard-a.mp3';
import discardOneA from './components/audio/discard-one-a.mp3';
import dynamiteBlast from './components/audio/dynamite-blast.mp3';
import dynamiteFevered from './components/audio/dynamite-fevered.mp3';
import lanternC from './components/audio/lantern-c.mp3';
import winchesterA from './components/audio/winchester-a.mp3';
import doomBoom from './components/audio/doom-boom-big.mp3';

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
export const CLIPS: Record<string, Clip> = {
  'six-gun': {
    src: gunshotA,
    gain: 0.85,
    on: ['THREAT_DAMAGED', 'DAMAGED', 'VESSEL_DAMAGED'],
  },
  winchester: {
    src: winchesterA,
    gain: 0.85,
    // Level with the Six-Gun on purpose. They are both firearms in the same
    // room, and a rifle mixed louder than a pistol reads as a different game
    // rather than as a longer barrel — the recordings can carry that.
    on: ['THREAT_DAMAGED', 'DAMAGED', 'VESSEL_DAMAGED'],
  },
  'lantern-oil': {
    src: lanternC,
    gain: 0.8,
    // 2 damage to a target of your choice, so it waits for the aim exactly as
    // the Six-Gun does — the same three landing events, because the choice can
    // be spent on a Threat, on the Vessel, or (Fevered) on a player.
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

/**
 * A deck being picked up and shuffled back under its owner.
 *
 * Not a card sound in the sense the rest of this file means — no card is being
 * played — but it is the same machinery: an event, a clip, and the same
 * near/far rule. Splitting it into its own module would duplicate all of that
 * to say one thing.
 */
const SHUFFLE = { src: shuffleA, gain: 0.55 };

/**
 * One card off the top, and a whole hand at once.
 *
 * Four variants for the single card because it is the most frequent sound in
 * the game — every mid-turn draw, several a round — and one recording repeating
 * that often stops being a card and becomes a click. A full hand has its own
 * longer clip: it is a different action, and it marks the start of a turn,
 * which is worth being able to hear without looking.
 */
const DEAL_ONE = [dealA, dealB, dealC, dealD].map((src) => ({ src, gain: 0.5 }));
const DEAL_HAND = { src: dealHand, gain: 0.55 };

/**
 * Cards going the other way: onto the discard pile.
 *
 * The mirror of DEAL_HAND / DEAL_ONE, and split for the same reason — sweeping
 * a whole hand away at the end of a turn is one gesture with one sound, and a
 * single card put down mid-turn is another. The engine says which
 * (`DISCARDED.hand`) rather than the client guessing from the count: a turn
 * that played four of five cards ends by sweeping exactly one card, and that
 * is still the sweep.
 *
 * Quieter than the deal. A discard is the end of something and nobody is
 * waiting on it; a draw is the thing the player is watching for.
 */
/**
 * Doom climbing.
 *
 * ONCE per batch, however many points arrived and from however many sources.
 * A Dusk with four unresolved Threats emits four DOOM events, and a Whisper
 * fill adds a fifth on top — five booms in a row is a machine gun, not dread.
 * The narrator already sums Doom per beat for the same reason.
 *
 * No near/far: Doom is not anybody's, so there is no "somebody else's Doom" to
 * mix quieter. It is the loudest thing in the game because it is the only one
 * that is happening to everybody.
 */
const DOOM = { src: doomBoom, gain: 0.9 };

const DISCARD_HAND = { src: discardA, gain: 0.45 };
const DISCARD_ONE = { src: discardOneA, gain: 0.4 };

/**
 * How far apart cards land, wherever they came from.
 *
 * One number, exported, and used by BOTH the sound and the animation in
 * App.tsx. They were separate — 190ms for a dealt hand, 90ms for a card that
 * drew one — which made a draw snap where a deal was deliberate, and left two
 * values that had to be kept in step by hand or a card would arrive after its
 * own sound. Taken from deal-hand.mp3, which runs just under a second and has a
 * cue per card.
 */
export const DEAL_STAGGER_MS = 190;

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
  hear(
    events: readonly GameEvent[],
    seat: string | null,
    level: number,
    /** What a full hand is, so a deal can be told from a draw. */
    handSize?: number,
  ): void;
}

export function createCardSounds(): CardSounds {
  // One element per distinct clip, made on first use and cloned per play so two
  // shots in a turn overlap rather than cutting each other off.
  const made = new Map<string, HTMLAudioElement>();
  /**
   * Shuffle-bag over the deal variants: play all four in a random order,
   * reshuffle, and never let the same one open a bag that closed the last.
   * A fixed cycle is a pattern too — a-b-c-d-a-b-c-d is as recognisable as one
   * file repeating, just slower to notice.
   */
  let bag: number[] = [];
  let lastDeal = -1;

  function nextDeal(): { src: string; gain: number } {
    if (!bag.length) {
      bag = DEAL_ONE.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      if (bag[0] === lastDeal && bag.length > 1) [bag[0], bag[1]] = [bag[1]!, bag[0]!];
    }
    lastDeal = bag.pop()!;
    return DEAL_ONE[lastDeal]!;
  }

  /** A card played, waiting on the target it still has to be pointed at. */
  let aimed: { cardId: string; player: string; fevered: boolean } | null = null;

  /** Play one clip. Everything audible in here goes through this. */
  function fireClip(
    clip: { src: string; gain: number }, level: number, near: boolean,
  ) {
      if (level <= 0) return;

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

  function fire(cardId: string, fevered: boolean, level: number, near: boolean) {
    const entry = CLIPS[cardId];
    if (!entry) return;
    fireClip(fevered && entry.fevered ? entry.fevered : entry, level, near);
  }

  return {
    hear(events, seat, level, handSize = 0) {
      let doom = 0;
      for (const e of events) {
        if (e.t === 'DOOM') { doom += e.delta; continue; }
        if (e.t === 'DREW') {
          const near = e.player === seat;
          // Defended, because the failure mode is silence and silence is what
          // success sounds like before the clip loads. A missing hand size or a
          // missing count used to make BOTH branches false — `undefined >=
          // undefined` is false and `Math.min(undefined, 5)` is NaN — so the
          // sound simply never happened and nothing said why.
          const drawn = Number.isFinite(e.n) && e.n > 0 ? Math.floor(e.n) : 1;
          const full = Number.isFinite(handSize) && handSize > 0;
          if (full && drawn >= handSize) {
            // A turn beginning: one gesture, one sound.
            fireClip(DEAL_HAND, level, near);
          } else {
            // Otherwise a card at a time, staggered so two reads as two.
            for (let i = 0; i < Math.min(drawn, 5); i++) {
              const clip = nextDeal();
              setTimeout(() => fireClip(clip, level, near), i * DEAL_STAGGER_MS);
            }
          }
          continue;
        }
        if (e.t === 'DISCARDED') {
          const near = e.player === seat;
          if (e.hand) { fireClip(DISCARD_HAND, level, near); continue; }
          // Cashing in can take several cards at once. Staggered on the same
          // beat as a deal so three reads as three rather than as one thud,
          // and capped for the same reason the deal is.
          const n = Number.isFinite(e.n) && e.n > 0 ? Math.floor(e.n) : 1;
          for (let i = 0; i < Math.min(n, 4); i++) {
            setTimeout(() => fireClip(DISCARD_ONE, level, near), i * DEAL_STAGGER_MS);
          }
          continue;
        }
        if (e.t === 'RESHUFFLED') {
          fireClip(SHUFFLE, level, e.player === seat);
          continue;
        }
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
      /*
        Doom, summed. Fired after the loop rather than inside it so a batch is
        one boom — see the note on DOOM above.

        `> 0` rather than `!== 0`: nothing subtracts from Doom today, but a
        reset would be a different sound rather than a quieter version of this
        one, and firing the boom on a REDUCTION would be actively misleading.
      */
      if (doom > 0) fireClip(DOOM, level, true);

      // Still in the air at the end of the batch? Only a pending choice
      // explains that. Anything else means it fizzled — no legal target, or
      // the damage was prevented — and a shot left armed would go off later on
      // somebody else's card.
      if (aimed && !events.some((e) => e.t === 'CHOICE_REQUIRED')) aimed = null;
    },
  };
}
