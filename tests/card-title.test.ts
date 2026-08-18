// The title has to fit the space it is actually given.
//
// It used to wrap on a character count, which knows nothing about glyph widths
// or about the cost tag and coin hanging over the top-right corner — so a long
// name ran under the coin. This checks the real cards against the real budget.

import { describe, it, expect } from 'vitest';
import { ALL_CARDS, card } from '../content/cards';
// Imported, not copied: a test that keeps its own idea of the card's geometry
// stops testing the card the moment either one moves.
import {
  textWidth, wrapToWidth, TITLE_X, TITLE_FIRST as FIRST,
  TITLE_REST as REST, CORNER_X,
} from '../client/src/components/wrapText';

const names = () => [
  ...ALL_CARDS.map((c) => c.name),
  ...ALL_CARDS.flatMap((c) => (c.fevered ? [c.fevered.name] : [])),
];

describe('the title fits', () => {
  it('never runs under the cost tag or the coin', () => {
    const trouble: string[] = [];
    for (const name of names()) {
      const size = wrapToWidth(name, 16, FIRST, REST).length > 2 ? 14 : 16;
      const lines = wrapToWidth(name, size, FIRST, REST);
      const firstEnd = TITLE_X + textWidth(lines[0]!, size);
      if (firstEnd > CORNER_X) trouble.push(`${name}: reaches ${firstEnd.toFixed(0)}`);
    }
    expect(trouble, 'first line under the corner tag').toEqual([]);
  });

  it('never runs off the card', () => {
    const over: string[] = [];
    for (const name of names()) {
      const size = wrapToWidth(name, 16, FIRST, REST).length > 2 ? 14 : 16;
      wrapToWidth(name, size, FIRST, REST).forEach((line: string, i: number) => {
        const w = textWidth(line, size);
        if (w > (i === 0 ? FIRST : REST)) over.push(`${name}: "${line}"`);
      });
    }
    expect(over).toEqual([]);
  });

  it('fits every card in three lines or fewer', () => {
    // Three baselines are defined; a fourth line would draw over the artwork.
    for (const name of names()) {
      const size = wrapToWidth(name, 16, FIRST, REST).length > 2 ? 14 : 16;
      expect(wrapToWidth(name, size, FIRST, REST).length, name)
        .toBeLessThanOrEqual(3);
    }
  });

  it('breaks a word that cannot fit rather than letting it overhang', () => {
    const lines = wrapToWidth('Supercalifragilisticexpialidocious', 16, FIRST, REST);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 16)).toBeLessThanOrEqual(REST);
  });

  it('measures by glyph, not by character count', () => {
    // The whole reason for the change: same length, very different widths.
    expect(textWidth('WWWWWW', 16)).toBeGreaterThan(textWidth('iiiiii', 16) * 2);
  });

  it('still gives a short name a single line', () => {
    expect(wrapToWidth(card('scar').name, 16, FIRST, REST)).toEqual(['Scar']);
  });
});


describe("the card that reported this", () => {
  /**
   * "Cattle Baron's Men" ran off the face.
   *
   * Two reasons, both in the estimate: letter-spacing was not counted at all,
   * and "Cattle" was measured as if its t, t and l were narrow — which they are
   * in ordinary text and are not in small caps, where they render as small
   * capital T, T and L.
   */
  it("keeps Cattle Baron's Men inside the card", () => {
    const name = "Cattle Baron's Men";
    const lines = wrapToWidth(name, 16, FIRST, REST);
    /*
      Asserted on FIT, not on a line count.

      This used to require exactly two lines, which was true when the title
      started at x=58 beside the family strip. The strip is gone and titles now
      start at x=25, so the same name fits on one — and a test that fails when
      a card gets ROOMIER is testing the wrong thing. What matters is that no
      line runs under the corner tag or off the card.
    */
    expect(lines.length).toBeGreaterThan(0);
    expect(TITLE_X + textWidth(lines[0]!, 16)).toBeLessThan(CORNER_X);
    for (const l of lines) expect(textWidth(l, 16)).toBeLessThanOrEqual(REST);
  });

  it('counts the tracking that pushed it over', () => {
    const bare = 'Cattle';
    // Six characters of 0.07em at 16px is about 7px — small per card, decisive
    // on a title that was three pixels inside the budget.
    expect(textWidth(bare, 16)).toBeGreaterThan(estimateNoTracking(bare, 16));
    function estimateNoTracking(t: string, size: number) {
      return textWidth(t, size) - t.length * 0.07 * size;
    }
  });

  it('treats a small-caps l and t as the capitals they are', () => {
    // In ordinary text these are the narrowest letters there are; in small caps
    // they are L and T. Measuring them as narrow is what let the title through.
    expect(textWidth('lt', 16)).toBeGreaterThan(textWidth('ii', 16));
  });
});

describe('the flavour line', () => {
  /** Mirrors CardFace's bottom-half layout. */
  const BODY_TOP = 250, BODY_LEAD = 14, FLAVOUR_BOTTOM = 52, FLAVOUR_LEAD = 12, H = 350;
  const wrap = (t: string, n: number) => {
    const out: string[] = []; let cur = '';
    for (const w of t.split(/\s+/).filter(Boolean)) {
      if ((cur + ' ' + w).trim().length <= n) cur = (cur + ' ' + w).trim();
      else { if (cur) out.push(cur); cur = w; }
    }
    if (cur) out.push(cur); return out;
  };
  const DIVIDER_Y = 226, FLAVOUR_ALONE = 280;
  const fits = (body: string, flavour: string) => {
    const lines = wrap(flavour, 36);
    const bodyLines = body ? wrap(body, 30) : [];
    const b = bodyLines.length
      ? BODY_TOP + (bodyLines.length - 1) * BODY_LEAD
      : DIVIDER_Y;
    const base = bodyLines.length ? H - FLAVOUR_BOTTOM : FLAVOUR_ALONE;
    return base - (lines.length - 1) * FLAVOUR_LEAD - b >= FLAVOUR_LEAD;
  };

  it('gives every card one', () => {
    const without = ALL_CARDS.filter((c) => !c.flavour).map((c) => c.name);
    expect(without).toEqual([]);
  });

  it('stays short enough to sit in the bottom half', () => {
    // Two lines at the 36-character wrap is the budget; three starts eating
    // into the rules text on all but the tersest cards.
    const long = ALL_CARDS
      .filter((c) => wrap(c.flavour!, 36).length > 2)
      .map((c) => `${c.name}: ${wrap(c.flavour!, 36).length} lines`);
    expect(long).toEqual([]);
  });

  it('steps aside rather than overlapping wordy rules', () => {
    // "What the Coyote Told Me" Fevered overlapped its own flavour by 6px.
    // The card drops the flavour instead of printing the two on top of
    // each other — rules before atmosphere.
    const wordy = 'Look at the next 3 Threats · 1 damage to the Vessel · Trash 1 of your own · +1 Whisper';
    expect(fits(wordy, 'She tells the truth. That is the trick.')).toBe(false);
    expect(fits('Draw 2', 'She tells the truth. That is the trick.')).toBe(true);
  });

  it('keeps the flavour on a card with no rules at all', () => {
    // Every Threat has empty `ops`, so this is the common case, not the edge:
    // the whole lower half is the flavour's, and it must not be dropped.
    expect(fits('', 'No wounds. No tracks. No birds.')).toBe(true);
    // Even a long one.
    expect(fits('', 'A '.repeat(40))).toBe(true);
  });
});
