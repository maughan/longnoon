/**
 * Which family a card belongs to, for colouring purposes.
 *
 * Lives here rather than in `CardFace.tsx` — where it was — because this module
 * is pure data and had no business depending on a component. It also could not
 * be reached from the root project's tests at all: `CardKind` came from a .tsx
 * file and the root tsconfig has no JSX on purpose. `CardFace` re-exports it,
 * so every existing import still resolves.
 */
export type CardKind =
  | "vessel"
  | "kit"
  | "deed"
  | "sign"
  | "fevered"
  | "scar"
  | "trouble"
  | "omen"
  | "mythos";

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
 *
 * MYTHOS IS BLOOD, NOT VIOLET. It used to be a deeper shade of the Sign/Omen
 * violet, on the theory that Act II is the corruption family arriving. At the
 * table that read as "another Omen": measured, the two inks were only dE 14.4
 * apart, which is about the distance between two shades of the same colour and
 * well inside what a player glancing at a Street will merge. Dark blood puts
 * them 38.0 apart.
 *
 * The constraint that makes this awkward is that `trouble` is ALREADY a red,
 * and in Act II both are in the Street at once — turned Trouble reverses beside
 * Mythos arrivals. So the two reds are separated by temperature and weight as
 * well as hue: trouble is a warm brick at L* 29.9, mythos a cold crimson at
 * L* 12.2, dE 30.6 apart. Keep that gap if you retune either.
 *
 * The first attempt at this (#4a0d18) cleared Omen easily but landed dE 23.7
 * from trouble — solving one collision by walking into another. Shifting the
 * ink bluer buys both: 30.6 from trouble AND 32.5 from Omen.
 *
 * Measured against the paper, with the floors this file already sets:
 *
 *     mythos ink     #400c1c   14.33:1   (floor 7:1 for body copy)
 *     mythos accent  #88203a    7.97:1   (floor 3:1 for strokes)
 *
 * `tests/palette.test.ts` holds all of the above to account, because a colour
 * tweak that quietly drops text under the contrast floor looks fine to whoever
 * made it and is unreadable to somebody else.
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
  // trouble - oxblood. Warm and brick-ish; the Act I threat.
  trouble: { ink: "#7d2b1e", accent: "#a34a37", paper: PAPER },
  // the corruption family - violet
  sign: { ink: "#4a3866", accent: "#6b5490", paper: SIGN_PAPER },
  omen: { ink: "#4a3866", accent: "#6b5490", paper: PAPER },
  /*
    The Vessel's own deck. Bone on near-black — it is the only family that is
    not a card you could ever hold, and it should not read as one.

    Measured against its own paper, to the floors this file sets: ink #ece4d6
    is 13.8:1 and accent #b8a488 is 6.9:1. Light-on-dark like `fevered`, which
    is why the "ink out-contrasts accent" test is stated as contrast rather
    than lightness.
  */
  vessel: { ink: '#ece4d6', accent: '#b8a488', paper: '#17141a' },
  // Mythos - dark blood. NOT violet: see the note below.
  mythos: { ink: "#400c1c", accent: "#88203a", paper: PAPER },
  // a Scar has no allegiance
  scar: { ink: "#4f4a44", accent: "#7a736a", paper: PAPER },
  // light on dark, still violet: it is a Sign, marked
  fevered: { ink: "#e0d6ef", accent: "#a894c4", paper: FEVER_BG },
};
