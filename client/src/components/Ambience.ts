/**
 * Looping ambience.
 *
 * Use Web Audio, not <audio loop>. An HTMLAudioElement with loop=true has an
 * implementation-dependent gap at the wrap point in several browsers - small,
 * but this file is engineered to be seamless and an element-level gap throws
 * that away. AudioBufferSourceNode.loop is sample-accurate.
 *
 * The bed is imported rather than fetched from a path, so Vite hashes and
 * bundles it and it cannot go missing in a build.
 */
import act1 from "./audio/ambience-act1.mp3";
import act2 from "./audio/ambience-act2.mp3";

/**
 * One bed per Act.
 *
 * Two AudioContexts rather than one context with two buffers: the beds hand
 * over exactly once a game, and keeping them independent means the cross-fade
 * is two gain ramps that cannot interfere with each other.
 */
export const BEDS = { act1, act2 } as const;
export type BedName = keyof typeof BEDS;

export interface Ambience {
  /** Fetch and decode ahead of time. Safe to call more than once. */
  load(): Promise<void>;
  /** Begin, or do nothing if already playing. Ramps up over `fadeSeconds`. */
  start(volume?: number, fadeSeconds?: number): Promise<void>;
  /** Duck out and release the source. Starting again is allowed. */
  fadeOut(seconds?: number): void;
  /**
   * Ramp to a new level. `seconds` because ducking and un-ducking are not the
   * same gesture: get out of the way fast, come back slowly enough that the
   * return is not itself an event.
   */
  setVolume(v: number, seconds?: number): void;
  /** Tear down the AudioContext. The pool is no use after this. */
  dispose(): void;
}

export function createAmbience(url: string = act1): Ambience {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  gain.connect(ctx.destination);

  let src: AudioBufferSourceNode | null = null;
  let buffer: AudioBuffer | null = null;
  let loading: Promise<void> | null = null;
  let volume = 0.5;
  /**
   * A closed AudioContext throws on every method, and `start` is async, so the
   * throw lands in an unobserved promise and the music simply never arrives
   * with nothing in the console. React StrictMode disposes and remounts every
   * effect in development, which makes that the DEFAULT path rather than an
   * edge case. A disposed bed is inert instead.
   */
  let closed = false;

  /**
   * A context created before the page has had a gesture starts suspended, and
   * `resume()` from a non-gesture task is refused. Ambience is the one sound
   * nobody clicks to start, so it waits for the first thing the player does
   * and resumes on the back of that.
   */
  function unlock() {
    if (ctx.state !== "suspended") return;
    const go = () => {
      void ctx.resume().catch(() => {});
      for (const ev of ["pointerdown", "keydown"]) {
        window.removeEventListener(ev, go);
      }
    };
    for (const ev of ["pointerdown", "keydown"]) {
      window.addEventListener(ev, go, { once: true });
    }
  }

  /** One fetch however many callers ask - a second start must not re-download. */
  function load(): Promise<void> {
    loading ??= (async () => {
      const res = await fetch(url);
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    })();
    return loading;
  }

  return {
    load,

    async start(v = volume, fadeSeconds = 3) {
      volume = v;
      if (closed) return;
      // Idempotent on purpose: this is driven by a React effect, and a second
      // source would layer a second copy of the loop over the first, slightly
      // out of phase, which sounds exactly like a broken loop.
      if (src) {
        this.setVolume(v);
        return;
      }
      if (!buffer) await load();
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
        unlock();
      }
      // Awaits happened: a fadeOut may have raced in behind them, or StrictMode
      // may have torn the whole thing down.
      if (src || closed) return;

      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(gain);
      src.start();

      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      // Exponential, because loudness is not linear and a linear fade-in on a
      // quiet bed is inaudible for two seconds and then suddenly there.
      gain.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), now + fadeSeconds);
    },

    fadeOut(seconds = 2) {
      if (!src || closed) return;
      const dying = src;
      src = null;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      dying.stop(now + seconds + 0.05);
    },

    setVolume(v: number, seconds = 0.25) {
      volume = v;
      if (closed) return;
      const now = ctx.currentTime;
      // Cancel first, or the fade-in ramp from start() keeps climbing straight
      // through a volume the player has just turned down.
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.linearRampToValueAtTime(Math.max(v, 0.0001), now + seconds);
    },

    dispose() {
      if (closed) return;
      closed = true;
      try {
        src?.stop();
      } catch {
        // Already stopped. Nothing to do and nothing worth reporting.
      }
      src = null;
      void ctx.close().catch(() => {});
    },
  };
}
