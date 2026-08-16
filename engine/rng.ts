// Deterministic RNG. The cursor lives in GameState, never in a closure,
// so that seed + command list fully reconstructs any game.
//
// RULE: Math.random() must never appear anywhere in engine/. See the lint
// script in package.json.

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** mulberry32, advanced deterministically to `cursor`. */
export function randAt(seed: string, cursor: number): number {
  let a = (hashSeed(seed) + Math.imul(cursor, 0x6d2b79f5)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(seed: string, cursor: number, maxExclusive: number): number {
  return Math.floor(randAt(seed, cursor) * maxExclusive);
}

/** Fisher-Yates. Returns a new array and the advanced cursor. */
export function shuffle<T>(
  items: readonly T[],
  seed: string,
  cursor: number,
): { items: T[]; cursor: number } {
  const out = items.slice();
  let c = cursor;
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(seed, c++, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return { items: out, cursor: c };
}
