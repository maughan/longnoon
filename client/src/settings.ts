// What the player has decided about the noise this game makes.
//
// One master mute plus two independent levels, because they are two different
// complaints: the bed is too loud to talk over, or the coins are too sharp.
// Folding them into one slider makes the fix for either one wrong for the other.
//
// Everything is stored as an *effective* volume at the point of playback —
// `music()` and `effects()` already fold the mute in, so no caller has to
// remember to check it and none of them can forget.

import { useCallback, useState } from 'react';

export interface Settings {
  muted: boolean;
  /** The Act I bed. 0–1. */
  music: number;
  /** Coins, the sunset, the Turning. 0–1. */
  effects: number;
}

export const DEFAULTS: Settings = { muted: false, music: 0.45, effects: 0.7 };

const KEY = 'long-noon.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const got = JSON.parse(raw) as Partial<Settings>;
    return {
      muted: typeof got.muted === 'boolean' ? got.muted : DEFAULTS.muted,
      music: clamp(got.music, DEFAULTS.music),
      effects: clamp(got.effects, DEFAULTS.effects),
    };
  } catch {
    // A corrupt or unreadable store is not worth a broken game.
    return DEFAULTS;
  }
}

function clamp(v: unknown, fallback: number): number {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback;
}

export interface SoundSettings extends Settings {
  set(patch: Partial<Settings>): void;
  /** Volume to play the bed at, mute already applied. */
  musicLevel: number;
  /** Multiplier for one-shot sounds, mute already applied. */
  effectsLevel: number;
}

export function useSettings(): SoundSettings {
  const [s, setS] = useState<Settings>(load);

  const set = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private browsing, a full quota — the game still plays.
      }
      return next;
    });
  }, []);

  return {
    ...s,
    set,
    musicLevel: s.muted ? 0 : s.music,
    effectsLevel: s.muted ? 0 : s.effects,
  };
}
