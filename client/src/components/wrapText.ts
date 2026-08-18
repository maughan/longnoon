// Fitting words into a fixed box.
//
// Everything on a card is drawn into a 250x350 SVG, and the wrapping has to be
// decided before any of it is laid out — so there is nothing to ask how wide a
// string is. In a browser there is: a canvas can measure the same font without
// drawing it, and that is used when it exists. The estimate below is the
// fallback, for tests and for anywhere without a DOM.
//
// The estimate has been wrong twice, both times the same way — too narrow, so
// the title fitted on one line and ran off the card:
//
//   1. Letter-spacing was not counted at all. At 0.07em over eighteen
//      characters that is a fifth of the title's width.
//   2. The narrow-glyph list was written for ordinary text. In SMALL CAPS a
//      lowercase "t" is a small capital T and a lowercase "l" is a small
//      capital L — both wide. "Cattle Baron's Men" has three of them and was
//      underestimated by about 10%.
//
// Hence the model below: every letter is a capital, and originally-lowercase
// ones are that capital at 0.8. Widths are Georgia-ish, which is the fallback
// most machines land on.

/** The app's typeface, verbatim from style.css. */
export const SERIF = 'ui-serif, "Iowan Old Style", Palatino, Georgia, serif';

/** Matches the `letterSpacing` on card headings. Counted, now. */
export const TRACKING_EM = 0.07;

/**
 * Where the title may go.
 *
 * `TITLE_FIRST` is short because the cost tag and the coin hang over the
 * top-right corner of the card, from about x=215. The lines below them get the
 * full width back.
 */
export const TITLE_X = 25;
export const TITLE_FIRST = 207 - TITLE_X;
export const TITLE_REST = 236 - TITLE_X;
/** Baselines by line count, so one, two or three lines all sit correctly. */
export const TITLE_TOP: number[][] = [[40], [32, 49], [26, 42, 58]];
/** Where the cost tag and coin begin, in the card's own coordinates. */
export const CORNER_X = 215;

/** Capital advance widths as a fraction of the font size, for a wide serif. */
const CAP: Record<string, number> = {
  A: 0.72,
  B: 0.68,
  C: 0.7,
  D: 0.75,
  E: 0.66,
  F: 0.61,
  G: 0.75,
  H: 0.77,
  I: 0.38,
  J: 0.43,
  K: 0.73,
  L: 0.61,
  M: 0.95,
  N: 0.75,
  O: 0.77,
  P: 0.61,
  Q: 0.77,
  R: 0.7,
  S: 0.6,
  T: 0.64,
  U: 0.75,
  V: 0.72,
  W: 1.02,
  X: 0.72,
  Y: 0.68,
  Z: 0.62,
};
const SMALL_CAP = 0.8;
const DIGIT = 0.55;
const PUNCT: Record<string, number> = {
  " ": 0.25,
  "'": 0.25,
  "’": 0.25,
  "-": 0.33,
  "—": 0.75,
  ".": 0.27,
  ",": 0.27,
  "!": 0.33,
  "?": 0.5,
  ":": 0.27,
  ";": 0.27,
  "·": 0.33,
};

/** The font string a card title is drawn with, for measuring it. */
export const titleFont = (size: number) => `small-caps 600 ${size}px ${SERIF}`;

/**
 * A canvas kept for measuring, made once and never drawn to.
 *
 * `undefined` means "not tried yet", `null` means "no DOM here" — the tests run
 * in Node and fall through to the estimate.
 */
interface Ruler {
  font: string;
  measureText(t: string): { width: number };
}

/**
 * Typed structurally rather than as a CanvasRenderingContext2D.
 *
 * This module is otherwise pure, and the tests reach it from the root project,
 * which has no DOM lib on purpose. Naming the two members actually used keeps
 * it compiling in both places instead of exiling it to the client project.
 */
let ruler: Ruler | null | undefined;

function measured(text: string, size: number, font: string): number | null {
  if (ruler === undefined) {
    const doc = (
      globalThis as {
        document?: {
          createElement(t: string): { getContext(c: string): Ruler | null };
        };
      }
    ).document;
    ruler = doc ? doc.createElement("canvas").getContext("2d") : null;
  }
  if (!ruler) return null;
  ruler.font = font;
  // measureText knows nothing about letter-spacing, so it is added here.
  return ruler.measureText(text).width + text.length * TRACKING_EM * size;
}

/** The estimate. Deliberately a little generous: wrapping early is survivable. */
export function estimateWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    const upper = ch.toUpperCase();
    if (PUNCT[ch] !== undefined) em += PUNCT[ch]!;
    else if (ch >= "0" && ch <= "9") em += DIGIT;
    else if (CAP[upper] !== undefined) {
      // Every letter is a capital in small caps; the lowercase ones are smaller.
      em += CAP[upper]! * (ch === upper ? 1 : SMALL_CAP);
    } else em += 0.6;
    em += TRACKING_EM;
  }
  return em * size;
}

/** Measured if a browser is here, estimated otherwise. */
export function textWidth(text: string, size: number, font?: string): number {
  return (
    (font ? measured(text, size, font) : null) ?? estimateWidth(text, size)
  );
}

/**
 * Wrap to a measured width, with a narrower first line.
 *
 * A word too long for any line is broken rather than allowed to overhang: a
 * card that spills off its own edge is worse than a split without a hyphen.
 */
export function wrapToWidth(
  text: string,
  size: number,
  firstWidth: number,
  restWidth: number,
  font?: string,
): string[] {
  const limit = (i: number) => (i === 0 ? firstWidth : restWidth);
  const w = (t: string) => textWidth(t, size, font);
  const lines: string[] = [];
  let cur = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (w(next) <= limit(lines.length)) {
      cur = next;
      continue;
    }
    if (cur) {
      lines.push(cur);
      cur = "";
    }

    let rest = word;
    while (w(rest) > limit(lines.length)) {
      let cut = rest.length - 1;
      while (cut > 1 && w(rest.slice(0, cut)) > limit(lines.length)) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
