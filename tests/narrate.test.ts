// The narrator has to keep up with the engine.
//
// Beats are the client's only running commentary, and the failure mode is
// silent: add a GameEvent, forget the sentence for it, and the table announces
// `threat_damaged` in small caps to a room of people. These tests are cheap
// insurance against that.

import { readFileSync } from 'node:fs';
import { describe as suite, expect, test } from 'vitest';
import { GameRoom } from '../server/room';
import { narrate, describe } from '../client/src/beats';
import { beatsIn } from '../server/pace';
import type { GameEvent } from '../engine/state';

/** Every event kind the engine can emit, one specimen each. */
const SPECIMENS: GameEvent[] = [
  { t: 'DREW', player: 'p0', n: 5 },
  { t: 'PLAYED', player: 'p0', cardId: 'colt', fevered: false },
  { t: 'BOUGHT', player: 'p0', cardId: 'winchester' },
  { t: 'GRIT', player: 'p0', amount: 3 },
  { t: 'DAMAGED', player: 'p1', amount: 2, trashed: ['saddlebag'] },
  { t: 'THREAT_DAMAGED', slot: 0, amount: 2 },
  { t: 'THREAT_CLEARED', slot: 0, cardId: 'barons-men' },
  { t: 'BOUNTY', player: 'p0', cardId: 'barons-men' },
  { t: 'THREAT_ENTERED', slot: 1, cardId: 'barons-men' },
  { t: 'VESSEL_DAMAGED', amount: 2, total: 6, by: 'p0' },
  { t: 'VESSEL_DAMAGE_RESET', cardId: 'barons-men', lost: 6 },
  { t: 'MENACE', slot: 0, cardId: 'barons-men', player: 'p1', amount: 1 },
  { t: 'MENACE_CANCELLED', slot: 0, by: 'p0' },
  { t: 'SHIELDED', player: 'p0', amount: 2 },
  { t: 'PREVENTED', player: 'p0', amount: 2 },
  { t: 'SCRIED', player: 'p0', cardId: 'barons-men' },
  { t: 'WHISPERS', delta: 1, total: 4 },
  { t: 'DOOM', delta: 2, total: 9 },
  { t: 'FELL', player: 'p1', became: 'revenant' },
  { t: 'LAST_WORDS', player: 'p1', fevered: true, kept: 2 },
  { t: 'BURNED_OUT', player: 'p1' },
  { t: 'BECKONED', by: 'p1', target: 'p0' },
  { t: 'TURNING', vessel: 'p1', marked: 'p0', aimMet: false },
  { t: 'PHASE', phase: 'dusk', round: 3 },
  { t: 'CHOICE_REQUIRED', player: 'p0', prompt: 'Choose a target' },
  { t: 'GAME_OVER', winner: 'posse' },
  { t: 'TOLL_PAID', slot: 0, cardId: 'dry-grass', player: 'p0' },
  { t: 'SHUTTERED', cardType: 'sign', untilRound: 5 },
  { t: 'OFFERED', by: 'p1', target: 'p0', cardId: 'colt' },
  { t: 'OFFER_TAKEN', player: 'p0', cardId: 'colt', whispers: 2 },
];

function table() {
  const room = new GameRoom({
    seed: 'narrate',
    seats: [
      { name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
      { name: 'Cole', kind: 'bot' },
    ],
    marked: 0,
  });
  return room;
}

/** A real view to narrate against — card ids and slots must resolve. */
function anyView() {
  const room = table();
  return room.stepBot()!.find((u) => u.seat === 'p0')!.view;
}

suite('the narrator', () => {
  test('every event kind either narrates or is deliberately silent', () => {
    const v = anyView();
    // Book-keeping the table does not need read aloud.
    const silent = new Set(['DREW', 'GRIT', 'CHOICE_REQUIRED']);
    for (const e of SPECIMENS) {
      const line = describe(e, v, 'p0');
      if (silent.has(e.t)) continue;
      expect(line, `no sentence for ${e.t}`).not.toBe(
        e.t.toLowerCase().replace(/_/g, ' '),
      );
      expect(line).not.toMatch(/\bp\d\b/);          // never a raw player id
      expect(line).not.toMatch(/\b(barons-men|colt|winchester|saddlebag)\b/);
    }
  });

  test('the specimen list covers the GameEvent union', () => {
    // If this fails, an event was added to the engine and not to SPECIMENS —
    // which is the whole point of the list.
    const seen = new Set<string>(SPECIMENS.map((e) => e.t));
    // The union is a type, so read it out of the source rather than a value.
    const src = readFileSync('engine/state.ts', 'utf8');
    const block = src.slice(src.indexOf('export type GameEvent ='));
    const union = block.slice(0, block.indexOf('\n\n'));
    const declared = [...new Set([...union.matchAll(/\{ t: '([A-Z_]+)'/g)]
      .map((m) => m[1]))];
    expect(declared.length).toBeGreaterThan(20);
    expect(declared.filter((t) => !seen.has(t))).toEqual([]);
  });

  test('a played card and its effect become one sentence', () => {
    const v = anyView();
    const beats = narrate(
      [
        { t: 'PLAYED', player: 'p1', cardId: 'colt', fevered: false },
        { t: 'THREAT_DAMAGED', slot: 0, amount: 2 },
        { t: 'THREAT_CLEARED', slot: 0, cardId: 'barons-men' },
      ],
      v, 'p0', v.activePlayer, (() => { let n = 0; return () => ++n; })(),
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].title).toBe("Bell plays The Colt That Doesn't Miss");
    expect(beats[0].detail).toMatch(/2 damage to .+ · .+ cleared/);
  });

  test('it speaks to you in the second person', () => {
    const v = anyView();
    const [beat] = narrate(
      [{ t: 'PLAYED', player: 'p0', cardId: 'colt', fevered: false }],
      v, 'p0', v.activePlayer, () => 1,
    );
    expect(beat.title).toBe("You play The Colt That Doesn't Miss");
  });

  test('a change of active player announces the turn', () => {
    const v = anyView();
    const beats = narrate([], v, 'p0', 'p2', () => 1);
    expect(beats.at(-1)!.kind).toBe('turn');
    expect(beats.at(-1)!.title).toMatch(/turn$/);
  });

  test('nothing is announced when the turn has not moved', () => {
    const v = anyView();
    expect(narrate([], v, 'p0', v.activePlayer, () => 1)).toEqual([]);
  });

  test("the server's beat count matches the narrator, all game", () => {
    // The hub paces bots by how many sentences an action is worth. It counts
    // without importing the narrator, so the two can drift — and the symptom
    // would be a Dusk that scrolls past unread, which no other test would see.
    const room = table();
    let prev: string | null = null;
    let n = 0;
    let checked = 0;
    for (let i = 0; i < 400 && room.awaitingBot; i++) {
      for (const u of room.stepBot() ?? []) {
        if (u.seat !== 'p0') continue;
        const changed = u.view.activePlayer !== prev;
        const spoken = narrate(u.events, u.view, 'p0', prev, () => ++n).length;
        expect(beatsIn(u.events, changed), JSON.stringify(u.events)).toBe(spoken);
        checked += 1;
        prev = u.view.activePlayer;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test('a real game narrates end to end without a raw id', () => {
    const room = table();
    let prev: string | null = null;
    let n = 0;
    let said = 0;
    for (let i = 0; i < 400 && room.awaitingBot; i++) {
      for (const u of room.stepBot() ?? []) {
        if (u.seat !== 'p0') continue;
        for (const b of narrate(u.events, u.view, 'p0', prev, () => ++n)) {
          said++;
          expect(`${b.title} ${b.detail ?? ''}`).not.toMatch(/\bp\d\b/);
        }
        prev = u.view.activePlayer;
      }
    }
    expect(said).toBeGreaterThan(20);
  });
});
