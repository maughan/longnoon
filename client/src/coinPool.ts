/**
 * Round-robin coin playback.
 *
 * Do NOT cycle the variants in order. A fixed sequence is itself a pattern,
 * and players hear a-b-c-d-e-f-a-b-c as a loop just as readily as they hear
 * one file repeating. Shuffle-bag instead: play through all six in random
 * order, reshuffle, and never let the same one open a new bag that closed
 * the last one.
 *
 * The files are imported rather than fetched from a path. Vite hashes and
 * bundles them that way, so they cannot go missing in a build the way a
 * hardcoded "/audio/coin-a.mp3" silently does — and the browser has them
 * before the first card is cashed in.
 *
 * Note on `detune`: right now all six files are byte-identical, so the bag has
 * nothing to vary and every coin would sound the same however well it is
 * shuffled. A small random shift in playback rate and volume is doing the real
 * work of making a hundred coins a game bearable. Keep it even after the
 * variants differ — sample variation and pitch variation are not the same
 * thing, and a coin that lands twice at exactly one pitch still reads as a
 * repeat.
 */
import coinA from "./components/audio/coin-a.mp3";
import coinB from "./components/audio/coin-b.mp3";
import coinC from "./components/audio/coin-c.mp3";
import coinD from "./components/audio/coin-d.mp3";
import coinE from "./components/audio/coin-e.mp3";
import coinF from "./components/audio/coin-f.mp3";
import signPurchase from "./components/audio/sign-purchase.mp3";

const VARIANTS = [coinA, coinB, coinC, coinD, coinE, coinF];

export interface CoinPool {
  /** Play one coin. Overlapping calls are fine — each gets its own node. */
  play(volume?: number): void;
  /** Gaining n coins: stagger them so they read as accumulation. */
  playMany(n: number, volume?: number, gapMs?: number): void;
  /**
   * Buying a Sign.
   *
   * It replaces the coin rather than layering over it. Every other purchase in
   * this game is a transaction; taking a Sign is a decision, and the table
   * should be able to tell which one just happened without looking up.
   */
  sign(volume?: number): void;
}

export function createCoinPool(): CoinPool {
  const buffers = VARIANTS.map((src) => {
    const el = new Audio(src);
    el.preload = "auto";
    return el;
  });

  const signEl = new Audio(signPurchase);
  signEl.preload = "auto";

  let bag: number[] = [];
  let last = -1;

  function refill() {
    bag = buffers.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag[0] === last && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
  }

  function play(volume = 0.7) {
    if (!bag.length) refill();
    const i = bag.pop()!;
    last = i;
    const node = buffers[i].cloneNode() as HTMLAudioElement;
    // ±5% either way: enough that two coins in a row are not the same coin,
    // little enough that it still sounds like the same currency.
    node.playbackRate = 0.95 + Math.random() * 0.1;
    node.volume = Math.min(
      1,
      Math.max(0, volume * (0.88 + Math.random() * 0.24)),
    );
    // Autoplay is gated on a page gesture, and a refused coin is not an error
    // worth a console entry — let alone an unhandled rejection.
    void node.play().catch(() => {});
  }

  return {
    play,
    sign(volume = 0.85) {
      const node = signEl.cloneNode() as HTMLAudioElement;
      // No detune here. The coins are detuned because they repeat a hundred
      // times a game and would otherwise grate; this one is meant to sound the
      // same every time, so that hearing it twice means the same thing twice.
      node.volume = Math.min(1, Math.max(0, volume));
      void node.play().catch(() => {});
    },
    playMany(n: number, volume = 0.7, gapMs = 65) {
      for (let k = 0; k < n; k++) {
        // Each coin a little quieter than the last, so a handful reads as one
        // gesture rather than n separate events.
        setTimeout(
          () => play(Math.max(volume * 0.55, volume - k * 0.06)),
          k * gapMs,
        );
      }
    },
  };
}
