// The Whisper track: one number, one direction, two acts.
//
// It means the same thing throughout — when this fills, something bad happens —
// and the only differences after the Turning are how fast it fills and what is
// waiting at the top. Act I fills once, into the Turning. Act II fills over and
// over, into escalating Doom.
//
// This area has shipped two bugs and both were the same mistake wearing
// different clothes: the field was ALSO treated as a currency. First as one
// field doing both jobs (it went negative), then as a second `whisperPool`
// field the client had never heard of (it rendered `/NaN`). Nothing subtracts
// from `whispers` now, and there is no second field. The randomised sweep and
// the two structural tests at the bottom are what would catch a third attempt.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands } from '../engine/legal';
import { randInt } from '../engine/rng';
import { playerView } from '../engine/view';
import { newInstance } from '../engine/effects';
import { card } from '../content/cards';
import type { GameState, Command, Tuning, PlayerId } from '../engine/state';

const base = (tuning: Partial<Tuning> = {}) =>
  start(setup({
    seed: 'whisper', players: ['Ada', 'Bo', 'Cy', 'Dell'], markedIndex: 1, tuning,
  })).state;

/** Jump a fresh game to the Turning through the real code path. */
function turned(tuning: Partial<Tuning> = {}): GameState {
  const s = base(tuning);
  s.whispers = s.tuning.whisperThreshold;
  const after = apply(s, s.activePlayer, { t: 'END_TURN' }).state;
  expect(after.act).toBe('mythos');
  return after;
}

/** A posse seat, holding the turn, with actions to spend. */
function acting(s: GameState): { s: GameState; pid: PlayerId } {
  const pid = s.turnOrder.find((p) => s.players[p].status === 'posse')!;
  s.activePlayer = pid;
  s.actionsLeft = 3;
  return { s, pid };
}

/** Play a Sign out of hand. `stake-claim` is 1 Whisper, `colt` is 3. */
function playWhisperer(s: GameState, pid: PlayerId, cardId = 'stake-claim') {
  const inst = newInstance(s, cardId);
  s.players[pid].hand.push(inst);
  return apply(s, pid, { t: 'PLAY_CARD', uid: inst.uid });
}

const printed = (id: string) => card(id).whispers!;

// --------------------------------------------------------------- invariants

/**
 * Asserted after every command in the sweeps below.
 *
 * `0 <= whispers < threshold` in BOTH acts. The upper bound is the interesting
 * half: at or above the threshold once a command has finished resolving means
 * a fill was missed, or in Act I that the Turning did not fire.
 */
function check(after: GameState, what: string): void {
  expect(after.whispers, `${what}: negative`).toBeGreaterThanOrEqual(0);
  expect(after.whispers, `${what}: left full`)
    .toBeLessThan(after.tuning.whisperThreshold);
}

function playOut(s0: GameState, seed: string, maxSteps = 4000): GameState {
  let s = s0;
  let cursor = 0;
  for (let i = 0; i < maxSteps && !s.winner; i++) {
    const actor = s.pending ? s.pending.player : s.activePlayer;
    const legal = legalCommands(s, actor);
    if (!legal.length) break;
    const pick = legal[randInt(seed, cursor++, legal.length)] as Command;
    s = apply(s, actor, pick).state;
    check(s, `${seed} step ${i} ${pick.t}`);
  }
  return s;
}

describe('the bar stays in range', () => {
  it('holds across forty randomised playthroughs', () => {
    let sawMythos = 0;
    let sawFill = 0;
    for (let g = 0; g < 40; g++) {
      const seed = `sweep-${g}`;
      let s0 = start(setup({
        seed, players: ['Ada', 'Bo', 'Cy', 'Dell'], markedIndex: g % 4,
      })).state;
      // Half start in Act II: random play reaches the Turning about once in
      // twenty games, so a plain sweep would assert the Act II half against
      // almost no Act II.
      if (g % 2 === 0) {
        s0.whispers = s0.tuning.whisperThreshold;
        s0 = apply(s0, s0.activePlayer, { t: 'END_TURN' }).state;
      }
      const end = playOut(s0, seed);
      if (end.act === 'mythos') sawMythos++;
      if (end.log.some((e) => e.t === 'WHISPER_FILL')) sawFill++;
    }
    expect(sawMythos).toBeGreaterThan(15);
    // A coverage floor, not a property: it only exists so a harness that never
    // reaches a fill cannot pass by asserting nothing. Content changes move it.
    expect(sawFill).toBeGreaterThan(2);
  });

  it('never shows a client a bar it cannot render', () => {
    // The `/NaN` bug was in the projection, not the state: the client divided
    // by a field the server had never sent.
    let s = turned();
    let cursor = 0;
    let steps = 0;
    for (let i = 0; i < 2000 && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      s = apply(s, actor, legal[randInt('view', cursor++, legal.length)]).state;
      const v = playerView(s, 'p0');
      for (const [k, n] of Object.entries({
        whispers: v.whispers, threshold: v.whisperThreshold,
        fills: v.whisperFills, next: v.nextFillDoom,
      })) {
        expect(Number.isFinite(n), `step ${i} ${k} = ${n}`).toBe(true);
      }
      expect(v.whispers).toBeLessThan(v.whisperThreshold);
      steps++;
    }
    expect(steps).toBeGreaterThan(20);
  });
});

// ------------------------------------------------------------------ the act

describe('the Turning hands the same bar over', () => {
  it('leaves whispers at 0', () => {
    const s = turned();
    expect(s.whispers).toBe(0);
    expect(s.whisperFills).toBe(0);
  });

  it('does not move the threshold', () => {
    // The bar must look identical or the player relearns it halfway through.
    const before = base();
    const after = turned();
    expect(after.tuning.whisperThreshold).toBe(before.tuning.whisperThreshold);
    expect(playerView(after, 'p0').whisperThreshold)
      .toBe(playerView(before, 'p0').whisperThreshold);
  });
});

describe('Whispers accrue faster after the Turning', () => {
  it('the same gain moves the track by twice what it moved in Act I', () => {
    const { s: a1, pid: p1 } = acting(base());
    const inActI = playWhisperer(a1, p1).state.whispers;

    const { s: a2, pid: p2 } = acting(turned());
    const inActII = playWhisperer(a2, p2).state.whispers;

    expect(inActI).toBe(printed('stake-claim'));
    expect(inActII).toBe(inActI * 2);
  });

  it('scales with whisperRateMythos rather than being hardcoded at 2', () => {
    const { s, pid } = acting(turned({ whisperRateMythos: 3 }));
    expect(playWhisperer(s, pid).state.whispers).toBe(printed('stake-claim') * 3);
  });

  it('never rounds a real gain away to nothing', () => {
    // Under 0.5 the rounding would swallow single Whispers, which is a mechanic
    // silently doing nothing — the failure this project keeps hitting.
    const { s, pid } = acting(turned({ whisperRateMythos: 0.1 }));
    expect(playWhisperer(s, pid).state.whispers).toBeGreaterThanOrEqual(1);
  });
});

describe('filling the track', () => {
  it('resets to 0, counts the fill, and adds Doom', () => {
    const { s, pid } = acting(turned({ whisperRateMythos: 1 }));
    s.whispers = s.tuning.whisperThreshold - printed('stake-claim');
    const doom = s.doom;

    const r = playWhisperer(s, pid);
    expect(r.state.whispers).toBe(0);
    expect(r.state.whisperFills).toBe(1);
    expect(r.state.doom).toBe(doom + r.state.tuning.doomPerFill);
    expect(r.events.some((e) => e.t === 'WHISPER_FILL')).toBe(true);
  });

  it('carries the remainder rather than discarding it', () => {
    // 11 of 12 plus a 3-Whisper Sign leaves 2 behind, not 0.
    const { s, pid } = acting(turned({
      whisperThreshold: 12, whisperRateMythos: 1,
    }));
    s.whispers = 11;
    const r = playWhisperer(s, pid, 'colt');
    expect(r.state.whispers).toBe(2);
    expect(r.state.whisperFills).toBe(1);
  });

  it('carries the remainder through the rate multiplier too', () => {
    // 11 + (3 x 2) = 17 against a threshold of 12: one fill, 5 left.
    const { s, pid } = acting(turned({
      whisperThreshold: 12, whisperRateMythos: 2,
    }));
    s.whispers = 11;
    const r = playWhisperer(s, pid, 'colt');
    expect(r.state.whispers).toBe(5);
    expect(r.state.whisperFills).toBe(1);
  });

  it('escalates: the third fill awards more Doom than the first', () => {
    let s = turned({ whisperThreshold: 4, whisperRateMythos: 1 });
    const awarded: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { s: ready, pid } = acting(s);
      ready.whispers = ready.tuning.whisperThreshold - 1;
      const r = playWhisperer(ready, pid, 'widow');   // 2 Whispers, overshoots
      awarded.push(
        r.events.filter((e) => e.t === 'WHISPER_FILL')
          .reduce((n, e) => n + (e as { doom: number }).doom, 0),
      );
      s = r.state;
    }
    expect(awarded[0]).toBe(s.tuning.doomPerFill);
    expect(awarded[2]).toBe(s.tuning.doomPerFill + 2 * s.tuning.doomPerFillStep);
    expect(awarded[2]!).toBeGreaterThan(awarded[0]!);
    expect(s.whisperFills).toBe(3);
  });

  it('one gain large enough fills the track twice, and pays for both', () => {
    // A loop, not an `if`. A swallowed second fill is a balance bug with no
    // visible symptom.
    const { s, pid } = acting(turned({
      whisperThreshold: 3, whisperRateMythos: 2,
    }));
    const doom = s.doom;

    const r = playWhisperer(s, pid, 'colt');   // 3 x 2 = 6 against a bar of 3
    expect(r.events.filter((e) => e.t === 'WHISPER_FILL')).toHaveLength(2);
    expect(r.state.whisperFills).toBe(2);
    // Both amounts, and they are different amounts.
    const first = r.state.tuning.doomPerFill;
    const second = first + r.state.tuning.doomPerFillStep;
    expect(r.state.doom).toBe(doom + first + second);
    expect(r.state.whispers).toBe(0);
  });

  it('reports the remainder after each fill, not the reading that broke it', () => {
    const { s, pid } = acting(turned({
      whisperThreshold: 12, whisperRateMythos: 1,
    }));
    s.whispers = 11;
    const r = playWhisperer(s, pid, 'colt');
    const fill = r.events.find((e) => e.t === 'WHISPER_FILL') as
      { total: number } | undefined;
    expect(fill!.total).toBe(2);
  });

  it('announces the fill before the Doom it causes', () => {
    // The narrator hangs events after an anchor onto it as clauses, so the
    // other order announces the same Doom twice, once with no cause attached.
    const { s, pid } = acting(turned({ whisperRateMythos: 1 }));
    s.whispers = s.tuning.whisperThreshold - printed('stake-claim');
    const { events } = playWhisperer(s, pid);
    expect(events.findIndex((e) => e.t === 'DOOM'))
      .toBeGreaterThan(events.findIndex((e) => e.t === 'WHISPER_FILL'));
  });

  it('routes every point of fill Doom through a DOOM event', () => {
    // What lets anything counting Doom stay ignorant of fills.
    const { s, pid } = acting(turned({ whisperRateMythos: 1 }));
    s.whispers = s.tuning.whisperThreshold - printed('stake-claim');
    const r = playWhisperer(s, pid);
    const summed = r.events.filter((e) => e.t === 'DOOM')
      .reduce((n, e) => n + (e as { delta: number }).delta, 0);
    expect(summed).toBe(r.state.tuning.doomPerFill);
  });
});

// --------------------------------------------------------------- the Vessel

// -------------------------------------------------------------- no remnants

describe('the currency design is gone, not dormant', () => {
  const ROOTS = ['engine', 'content', 'server', 'sim', 'worker', 'client/src', 'tests'];

  function sources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        // This file names the banned identifiers in order to ban them, so it
        // would flag itself for ever. Named explicitly rather than filtered by
        // a clever pattern: every OTHER test file is still scanned.
        if (full === 'tests/whispers.test.ts') continue;
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
      }
    };
    for (const r of ROOTS) walk(r);
    return out;
  }

  it('leaves no reference to whisperPool anywhere in the source', () => {
    // A half-present abstraction is how the next bug arrives. This walks the
    // real tree rather than trusting a memory of having deleted it.
    const banned = ['whisperPool', 'callWhisperCost', 'spendPool', 'spendWhispers'];
    const offenders: string[] = [];
    for (const f of sources()) {
      const src = readFileSync(f, 'utf8');
      for (const b of banned) if (src.includes(b)) offenders.push(`${f}: ${b}`);
    }
    expect(offenders).toEqual([]);
  });

  it('has no path that subtracts from the track', () => {
    // Structural, not behavioural: the ABSENCE of a spend path is what makes
    // "it went negative" unrepeatable rather than merely fixed. The one
    // permitted subtraction is the fill itself, which is a wrap and not a spend.
    const offenders: string[] = [];
    for (const f of sources()) {
      if (f.startsWith('tests/')) continue;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (/whispers\s*-=/.test(line) && !/-=\s*threshold/.test(line)) {
          offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the Vessel is one entity, not two', () => {
  /**
   * `state.vessel` and `status === 'vessel'` are the same fact.
   *
   * They used to disagree on naming — the status said `oldOne` — and the UI
   * showed both, so one seat carried two tags with no difference between them.
   * The rename removed the second word; this removes the possibility of them
   * ever describing different players.
   */
  function agree(s: GameState, what: string): void {
    const tagged = s.turnOrder.filter((p) => s.players[p].status === 'vessel');
    if (s.vessel === null) {
      expect(tagged, `${what}: a Vessel status with no Vessel`).toEqual([]);
      return;
    }
    expect(tagged, `${what}: not exactly one Vessel`).toEqual([s.vessel]);
  }

  it('holds before the Turning, at it, and all through Act II', () => {
    const before = base();
    expect(before.vessel).toBeNull();
    agree(before, 'fresh deal');
    agree(turned(), 'the Turning');

    let s = turned();
    let cursor = 0;
    let steps = 0;
    for (let i = 0; i < 1500 && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      s = apply(s, actor, legal[randInt('one-entity', cursor++, legal.length)]).state;
      agree(s, `step ${i}`);
      steps++;
    }
    expect(steps).toBeGreaterThan(20);
  });

  it('never puts a second name on the seat in a client payload', () => {
    // The bug was visible, not internal: the player list rendered the raw
    // status beside a separate "the Vessel" chip. Nothing a client receives
    // may carry the old identifier at all.
    const s = turned();
    for (const viewer of [...s.turnOrder, 'spectator']) {
      const wire = JSON.stringify(playerView(s, viewer));
      expect(wire, `${viewer} was sent the old name`).not.toContain('oldOne');
    }
  });

  it('leaves no oldOne status anywhere in the source', () => {
    // `winner: 'oldOne'` is deliberately exempt — that is a SIDE, not a seat,
    // and a Revenant wins with it without ever being the Vessel.
    const offenders: string[] = [];
    for (const f of ['engine/state.ts', 'engine/reducer.ts', 'engine/legal.ts',
      'engine/effects.ts', 'engine/view.ts', 'sim/bots.ts']) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t.includes("'oldOne'")) continue;
        // Comments may name it — two of them explain this very rename, and a
        // test that forbids describing the old name forbids explaining it.
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
        if (/winner|Outcome|outcome/.test(t)) continue;
        offenders.push(`${f}: ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
