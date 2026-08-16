// The drag gesture, checked against the server rather than the DOM.
//
// Dropping a card on a Threat is one gesture but two commands — PLAY_CARD, then
// RESOLVE_CHOICE answering the prompt with the slot the player pointed at. The
// client only ever replays a target the server itself offered, so what matters
// here is that the pairing holds against a real room.

import { describe, test, expect } from 'vitest';
import { GameRoom } from '../server/room';
import type { Command } from '../engine/state';

/**
 * What the drop gesture does, driven through the real room: PLAY_CARD, then the
 * remembered slot answered into whatever prompt comes back.
 */
describe('drag to play', () => {
test('dropping a card on a Threat plays it AT that Threat', () => {
  const room = new GameRoom({
    seed: 'drop-1',
    seats: [{ name: 'You' }, { name: 'Bell', kind: 'bot' }, { name: 'Cole', kind: 'bot' }],
    marked: null,
  });
  const seat = 'p0';
  const view = () => room.view(seat);

  // Find a card in hand the server says can be played.
  // A Six-Gun: damage with target 'choose', so the server must ask where.
  const hand = room.view(seat).you!.hand;
  const gun = hand.find((ci) => ci.cardId === 'six-gun');
  expect(gun, 'a Six-Gun in the opening hand').toBeDefined();
  const play = { t: 'PLAY_CARD', uid: gun!.uid } as Command;

  const before = view();
  const occupied = before.street
    .map((sl, i) => (sl ? i : -1)).filter((i) => i >= 0);
  expect(occupied.length, 'the Street has Threats to aim at').toBeGreaterThan(0);
  const target = occupied[occupied.length - 1];

  const r = room.submit(seat, play);
  expect(r.ok).toBe(true);

  const after = view();
  if (after.pending) {
    // The gesture named a slot; it must be one the server actually offered.
    const offered = after.pending.options.some((o) => o.key === String(target));
    if (offered) {
      const done = room.submit(seat, {
        t: 'RESOLVE_CHOICE', choiceId: after.pending.id, picks: [String(target)],
      });
      expect(done.ok, 'the aimed slot resolves').toBe(true);
      const dmg = room.view(seat).street[target];
      console.log(`aimed at slot ${target}: damage now ${dmg?.damage ?? 'cleared'}`);
    }
    expect(offered, 'the aimed slot is one the server offered').toBe(true);
  } else {
    throw new Error('a Six-Gun with Threats standing should ask for a target');
  }
});

test('a slot the server did not offer is never auto-answered', () => {
  const room = new GameRoom({
    seed: 'drop-1',
    seats: [{ name: 'You' }, { name: 'Bell', kind: 'bot' }, { name: 'Cole', kind: 'bot' }],
    marked: null,
  });
  const seat = 'p0';
  const gun = room.view(seat).you!.hand.find((ci) => ci.cardId === 'six-gun')!;
  room.submit(seat, { t: 'PLAY_CARD', uid: gun.uid });
  const pending = room.view(seat).pending!;
  expect(pending).not.toBeNull();

  // An empty slot: the client must fall through to the prompt, not send this.
  const empty = room.view(seat).street.findIndex((sl) => sl === null);
  if (empty >= 0) {
    expect(pending.options.some((o) => o.key === String(empty))).toBe(false);
    // And the server refuses it even if a client tried.
    const bad = room.submit(seat, {
      t: 'RESOLVE_CHOICE', choiceId: pending.id, picks: [String(empty)],
    });
    expect(bad.ok).toBe(false);
  }
});
});
