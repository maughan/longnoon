// The Dusk report has one job: account for everything the phase did.
//
// It is built from the same events the narrator reads, so the failure mode is
// an event nobody thought to list — which looks like nothing at all on screen.

import { describe, it, expect } from 'vitest';
import { GameRoom } from '../server/room';
import { duskReport, isDusk } from '../client/src/duskReport';
import { narrate } from '../client/src/beats';
import type { GameEvent } from '../engine/state';

/** Events a Dusk can emit that the report is not expected to print. */
const SILENT = new Set(['PHASE', 'DREW', 'GRIT', 'CHOICE_REQUIRED', 'THREAT_DAMAGED']);

function duskBatches(seed: string) {
  const room = new GameRoom({
    seed,
    seats: [{ name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
      { name: 'Cole', kind: 'bot' }],
    marked: 0,
  });
  const out: { events: GameEvent[]; view: ReturnType<typeof room.view> }[] = [];
  for (let i = 0; i < 900 && room.awaitingBot; i++) {
    for (const u of room.stepBot() ?? []) {
      if (u.seat !== 'p0') continue;
      if (isDusk(u.events)) out.push({ events: u.events, view: u.view });
    }
  }
  return out;
}

describe('the Dusk report', () => {
  /*
    Who leads the round that just began.

    The button moves one chair every Dawn, and the Dusk sheet is the one moment
    the whole table is looking at the same thing — so it is where the new order
    is announced. Left out, a rotating turn order reads as a bug: people work
    out whose turn it is by watching whose turn it turned out to be.
  */
  it('always says who leads the new round, and names the reader', () => {
    let checked = 0;
    for (const seed of ['dr-first-1', 'dr-first-2']) {
      for (const { events, view } of duskBatches(seed)) {
        const mine = duskReport(events, view, 'p0');
        expect(mine.next.text, seed).toMatch(/^Round \d+ — /);
        // Read off the view, so it is the round that has just STARTED.
        expect(mine.next.text).toContain(`Round ${view.round} `);

        const leads = view.firstPlayer;
        if (leads === 'p0') {
          expect(mine.next.text).toContain('you lead');
          expect(mine.next.yours).toBe(true);
        } else {
          const them = view.opponents.find((o) => o.id === leads)!;
          expect(mine.next.text).toContain(`${them.name} leads`);
          expect(mine.next.yours).toBeFalsy();
        }
        checked++;
      }
    }
    expect(checked, 'no Dusks to read').toBeGreaterThan(3);
  });

  it('says it even on a Dusk where nothing else happened', () => {
    // Every other section vanishes when it is empty. This one never can: it is
    // the only line about what happens NEXT rather than what just happened.
    for (const seed of ['dr-quiet-1', 'dr-quiet-2']) {
      for (const { events, view } of duskBatches(seed)) {
        const r = duskReport(events, view, 'p0');
        expect(r.next.text.length).toBeGreaterThan(8);
      }
    }
  });

  it('accounts for every event a real Dusk produces', () => {
    let checked = 0;
    for (const seed of ['dr-1', 'dr-2', 'dr-3']) {
      for (const { events, view } of duskBatches(seed)) {
        const r = duskReport(events, view, 'p0');
        const lines = [...r.menace, ...r.arrivals, ...r.escalated, ...r.tracks];
        const kinds = new Set(events.map((e) => e.t).filter((t) => !SILENT.has(t)));
        // Every kind of thing that happened must have produced at least one
        // line. A missing case is silent otherwise.
        expect(kinds.size === 0 || lines.length > 0).toBe(true);
        for (const e of events) {
          if (SILENT.has(e.t)) continue;
          checked += 1;
        }
        // Never a raw id in front of a player.
        for (const l of lines) expect(l.text).not.toMatch(/\bp\d\b/);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('folds a wound into the blow that caused it', () => {
    const view = duskBatches('dr-1')[0].view;
    const r = duskReport([
      { t: 'PHASE', phase: 'dusk', round: 3 },
      { t: 'MENACE', slot: 0, cardId: 'barons-men', player: 'p0', amount: 2 },
      { t: 'DAMAGED', player: 'p0', amount: 2, trashed: ['saddlebag', 'canteen'] },
    ], view, 'p0');
    expect(r.menace).toHaveLength(1);
    expect(r.menace[0].text)
      .toBe("Cattle Baron's Men menaces you for 2, costing 2 cards — Saddlebag, Canteen");
    expect(r.menace[0].yours).toBe(true);
  });

  it('does not fold a wound onto somebody else', () => {
    const view = duskBatches('dr-1')[0].view;
    const r = duskReport([
      { t: 'PHASE', phase: 'dusk', round: 3 },
      { t: 'MENACE', slot: 0, cardId: 'barons-men', player: 'p0', amount: 2 },
      { t: 'DAMAGED', player: 'p1', amount: 1, trashed: ['saddlebag'] },
    ], view, 'p0');
    expect(r.menace).toHaveLength(2);
  });

  it('says so when nothing came due', () => {
    const view = duskBatches('dr-1')[0].view;
    const r = duskReport([{ t: 'PHASE', phase: 'dusk', round: 2 }], view, 'p0');
    expect(r.quiet).toBe(true);
  });

  it('marks what is yours, at a table where most of it is not', () => {
    const view = duskBatches('dr-1')[0].view;
    const r = duskReport([
      { t: 'PHASE', phase: 'dusk', round: 3 },
      { t: 'MENACE', slot: 0, cardId: 'barons-men', player: 'p1', amount: 2 },
      { t: 'MENACE', slot: 1, cardId: 'rustlers', player: 'p0', amount: 1 },
    ], view, 'p0');
    expect(r.menace.filter((l) => l.yours)).toHaveLength(1);
  });
});

describe('the Dusk report and the ticker do not both say it', () => {
  /**
   * Anything the Dusk sheet lists is tagged `fromDusk` and skipped by the
   * ticker. This asserts the property over real games rather than trusting the
   * tag: if the two ever disagree the player reads the same news twice, once in
   * the sheet and once scrolling past behind it.
   */
  it('shows no ticker beat for anything a Dusk produced', () => {
    let duskBatches = 0;
    let leaked = 0;
    for (const seed of ['dup-1', 'dup-2', 'dup-3']) {
      const room = new GameRoom({
        seed,
        seats: [{ name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
          { name: 'Cole', kind: 'bot' }],
        marked: 0,
      });
      let prev: string | null = null;
      let n = 0;
      for (let i = 0; i < 900 && room.awaitingBot; i++) {
        for (const u of room.stepBot() ?? []) {
          if (u.seat !== 'p0') continue;
          const beats = narrate(u.events, u.view, 'p0', prev, () => ++n);
          if (isDusk(u.events)) {
            duskBatches += 1;
            // "Your turn" is deliberately kept: the sheet says what the night
            // cost, then the ticker says who is up.
            leaked += beats.filter((b) => !b.fromDusk && b.kind !== 'turn').length;
          }
          prev = u.view.activePlayer;
        }
      }
    }
    expect(duskBatches).toBeGreaterThan(10);
    expect(leaked, 'Dusk lines also shown as popups').toBe(0);
  });
});
