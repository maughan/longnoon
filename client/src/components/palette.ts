import type { CardKind } from "./CardFace";

/**
 * Two tones per card type, and the split is not decorative.
 *
 *   INK    carries text. Must clear 7:1 against its ground - these cards run
 *          10px body copy and 9px flavour.
 *   ACCENT carries frame, field outline and the big field art, where a thick
 *          stroke at size stays legible down to about 3:1.
 *
 * This split exists because of "yellowish". Measured against the paper
 * (#f4f0e6):
 *
 *     naive yellow  #c9a227   2.13:1   unreadable
 *     amber         #a8791f   3.40:1   fine for strokes, not for text
 *     deep ochre    #8a6114   4.86:1   still short
 *     umber         #6b4a12   7.06:1   the first yellow that works for text
 *
 * So equipment reads amber in the frame and umber in the copy - one hue doing
 * two jobs. Every other family got the same treatment for consistency.
 *
 * Secondary text (subtitle, flavour, footer) is INK at 0.62 opacity rather
 * than a separate grey, so it can never drift off the family hue.
 *
 * WHISPER PIPS ARE ALWAYS DREAD RED, on every type. Corruption is the same
 * currency wherever it appears and must not change colour with its host.
 */
export interface TypePalette {
  ink: string;
  accent: string;
  paper: string;
}

export const DREAD = "#8a3324";
export const DREAD_ON_DARK = "#d98a7a";
export const FAINT_OPACITY = 0.72; // 0.62 put equipment secondary text at 2.96:1, under the 3:1 floor

const PAPER = "#f4f0e6";
const SIGN_PAPER = "#e3e0dc";
const FEVER_BG = "#3a373f";

export const PALETTE: Record<CardKind, TypePalette> = {
  // equipment - amber frame, umber text
  kit: { ink: "#6b4a12", accent: "#a8791f", paper: PAPER },
  deed: { ink: "#6b4a12", accent: "#a8791f", paper: PAPER },
  // trouble - oxblood
  trouble: { ink: "#7d2b1e", accent: "#a34a37", paper: PAPER },
  // the corruption family - violet, deepening as it gets further along
  sign: { ink: "#4a3866", accent: "#6b5490", paper: SIGN_PAPER },
  omen: { ink: "#4a3866", accent: "#6b5490", paper: PAPER },
  mythos: { ink: "#2f2542", accent: "#4a3c66", paper: PAPER },
  // a Scar has no allegiance
  scar: { ink: "#4f4a44", accent: "#7a736a", paper: PAPER },
  // light on dark, still violet: it is a Sign, marked
  fevered: { ink: "#e0d6ef", accent: "#a894c4", paper: FEVER_BG },
};
