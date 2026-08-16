// The card palette, held to the numbers palette.ts claims for it.
//
// Two failure modes, and both look fine to whoever caused them:
//
//   1. A colour tweak drops body copy under the contrast floor. The person who
//      picked it can read it on their monitor; somebody else cannot.
//   2. Two card families drift close enough to merge at a glance. This one
//      actually happened — Mythos was a deeper shade of the Omen violet, only
//      dE 14.4 apart, and it read at the table as "another Omen".
//
// Neither is caught by anything else, because both produce a screen that
// renders perfectly.

import { describe, it, expect } from 'vitest';
import {
  PALETTE, DREAD, DREAD_ON_DARK, FAINT_OPACITY,
} from '../client/src/components/palette';

// ------------------------------------------------------------------ colour

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** sRGB -> linear, the WCAG transfer function. */
const linear = (c: number) =>
  (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio, 1:1 to 21:1. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * CIE L*a*b*, so "do these two read as different colours" is measured rather
 * than argued about. Contrast ratio cannot answer it: two colours can have
 * identical luminance and be red and green.
 */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const dE = (a: string, b: string) =>
  Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]!));

const lightness = (hex: string) => lab(hex)[0];

// ------------------------------------------------------------------- tests

describe('every family stays readable on its own paper', () => {
  const families = Object.entries(PALETTE);

  it.each(families)('%s ink clears the body-copy floor', (name, pal) => {
    // 7:1. These cards run 10px body and 9px flavour, which is well below the
    // size AA's 4.5:1 was written for.
    expect(contrast(pal.ink, pal.paper), `${name} ink`).toBeGreaterThanOrEqual(7);
  });

  it.each(families)('%s secondary text clears the stroke floor', (name, pal) => {
    // Subtitle, flavour and footer are ink at FAINT_OPACITY rather than a
    // separate grey, so they cannot drift off the family hue — but they also
    // cannot be checked by looking at `ink` alone. Composited against the
    // paper, which is what the eye actually receives.
    const [pr, pg, pb] = channels(pal.paper) as [number, number, number];
    const [ir, ig, ib] = channels(pal.ink) as [number, number, number];
    const mix = (i: number, p: number) => i * FAINT_OPACITY + p * (1 - FAINT_OPACITY);
    const composited = [mix(ir, pr), mix(ig, pg), mix(ib, pb)]
      .map((c) => Math.round(c * 255).toString(16).padStart(2, '0'))
      .join('');
    expect(contrast(`#${composited}`, pal.paper), `${name} faint`)
      .toBeGreaterThanOrEqual(3);
  });

  it.each(families)('%s accent carries a stroke', (name, pal) => {
    expect(contrast(pal.accent, pal.paper), `${name} accent`)
      .toBeGreaterThanOrEqual(3);
  });

  it.each(families)('%s ink out-contrasts its own accent', (name, pal) => {
    // The split is ink-for-text, accent-for-frame, so the ink must be the
    // stronger of the two against the paper — otherwise the frame shouts over
    // the copy.
    //
    // Stated as contrast rather than as "the accent is lighter", which is what
    // this test said first and which `fevered` correctly failed: that card is
    // light-on-dark, so its ink is the LIGHTER value by design. Lightness was
    // a proxy for the real rule and it only held for cards on pale paper.
    expect(contrast(pal.ink, pal.paper), `${name}`)
      .toBeGreaterThan(contrast(pal.accent, pal.paper));
  });
});

describe('families do not merge at a glance', () => {
  /**
   * The threshold.
   *
   * dE 2.3 is "just noticeable" side by side; this is a card across a table,
   * at speed, next to other cards. 25 is roughly where the existing families
   * that nobody has complained about sit apart, and Mythos-vs-Omen was 14.4
   * when it was reported as looking the same.
   */
  const APART = 25;

  it('Mythos is not a shade of Omen', () => {
    expect(dE(PALETTE.mythos.ink, PALETTE.omen.ink)).toBeGreaterThan(APART);
    expect(dE(PALETTE.mythos.accent, PALETTE.omen.accent)).toBeGreaterThan(APART);
  });

  it('the two reds are told apart by weight, not only by hue', () => {
    // Trouble and Mythos share the Street in Act II — turned reverses beside
    // Mythos arrivals — and both are red. Hue alone is not enough at speed, so
    // they are also separated by lightness.
    // The hue gap is covered by the generic threat loop below; the lightness
    // gap is the part that is unique to this pair, and it is what stops two
    // reds in the same Street reading as one family.
    expect(lightness(PALETTE.trouble.ink) - lightness(PALETTE.mythos.ink))
      .toBeGreaterThan(10);
  });

  it('no two threat families share an ink', () => {
    const threats = ['trouble', 'mythos', 'omen'] as const;
    for (const a of threats) {
      for (const b of threats) {
        if (a >= b) continue;
        expect(dE(PALETTE[a].ink, PALETTE[b].ink), `${a} vs ${b}`)
          .toBeGreaterThan(APART);
      }
    }
  });
});

describe('the whisper pip stays its own colour', () => {
  it('is legible on every paper it is drawn on', () => {
    // Corruption is the same currency wherever it appears, so DREAD does not
    // change with its host — which means it has to work against all of them.
    for (const [name, pal] of Object.entries(PALETTE)) {
      // Dark-paper families draw DREAD_ON_DARK instead — `fevered` because a
      // turned Sign is light-on-dark, `vessel` for the same reason. Checking
      // the light-card ink against a near-black ground would be asserting
      // something nothing renders.
      const dark = contrast('#ffffff', pal.paper) > contrast('#000000', pal.paper);
      expect(contrast(dark ? DREAD_ON_DARK : DREAD, pal.paper), `dread on ${name}`)
        .toBeGreaterThanOrEqual(3);
    }
  });
});
