import { describe, it, expect } from 'vitest';
import { GameRoom, type RoomOptions } from '../server/room';
import { visibleEvents } from '../server/events';
import type { Command, GameEvent } from '../engine/state';

const room = (over: Partial<RoomOptions> = {}) =>
  new GameRoom({
    seed: 'room-1',
    seats: [
      { name: 'Ada' },
      { name: 'Bo' },
      { name: 'Cy', kind: 'bot', policy: 'Balanced' },
      { name: 'Di', kind: 'bot', policy: 'Zealot' },
    ],
    marked: 1,
    ...over,
  });

/**
 * Drive a room to completion. Bots no longer act inside `submit` — the caller
 * steps them, which is what lets the UI show a turn happening.
 */
function playOut(r: GameRoom, maxSteps = 6000): void {
  for (let i = 0; i < maxSteps && !r.over; i++) {
    if (r.awaitingBot) { if (!r.stepBot()) break; continue; }
    const actor = r.waitingOn;
    if (!actor) break;
    const legal = r.legal(actor);
    if (!legal.length) break;
    const res = r.submit(actor, legal[0]);
    if (!res.ok) break;
  }
}

describe('GameRoom — the authority', () => {
  it('never hands a seat anything but its own view', () => {
    const r = room();
    for (const update of r.sync()) {
      const v = update.view as unknown as Record<string, unknown>;
      for (const forbidden of ['players', 'seed', 'supply', 'rngCursor', 'turnOrder', 'log']) {
        expect(v[forbidden], `leaked ${forbidden} to ${update.seat}`).toBeUndefined();
      }
      // A seat sees its own role and nobody else's.
      expect(JSON.stringify(update.view.opponents)).not.toContain('marked');
    }
  });

  it('hands bot turns back one action at a time, not in a flash', () => {
    const r = room();
    // Pass both human seats so play reaches the two bots.
    for (let i = 0; i < 8 && !r.awaitingBot && !r.over; i++) {
      const actor = r.waitingOn!;
      r.submit(actor, { t: 'END_TURN' });
    }
    expect(r.awaitingBot).toBe(true);

    // Each step is exactly one action, so a client can show it happening
    // rather than jumping straight to the outcome.
    let steps = 0;
    while (r.awaitingBot && steps < 50) {
      const updates = r.stepBot();
      expect(updates).not.toBeNull();
      expect(updates!.length).toBe(r.seats.length); // everyone hears about it
      steps++;
    }
    expect(steps).toBeGreaterThan(1);
    // It rests on a human again (or the game ended).
    if (r.waitingOn) expect(r.seat(r.waitingOn)!.kind).toBe('human');
  });

  it('stepBot does nothing when a human is up', () => {
    const r = room();
    expect(r.awaitingBot).toBe(false);
    expect(r.stepBot()).toBeNull();
  });

  it('rejects a command from the wrong seat', () => {
    const r = room();
    const waiting = r.waitingOn!;
    const other = r.seats.find((s) => s.id !== waiting && s.kind === 'human')!;
    const res = r.submit(other.id, { t: 'END_TURN' });
    expect(res.ok).toBe(false);
    expect(res).toHaveProperty('error', 'Not your turn');
  });

  it('rejects anything the rules never offered', () => {
    const r = room();
    const me = r.waitingOn!;
    const evil: Command[] = [
      { t: 'BUY', cardId: 'colt' },                 // no Grit
      { t: 'PAY_TOLL', slot: 0 },                   // nothing there to pay for
      { t: 'PLAY_CARD', uid: 'come-and-see' },      // not a Revenant
      { t: 'REVENANT_WHISPER', uid: 'ghost' },      // not a Revenant
      { t: 'SPEND_GRIT', uids: ['ghost'] },
    ];
    for (const c of evil) {
      const res = r.submit(me, c);
      expect(res.ok, `let through ${JSON.stringify(c)}`).toBe(false);
    }
  });

  it('accepts every command it offers', () => {
    const r = room();
    const me = r.waitingOn!;
    for (const c of r.legal(me)) {
      const probe = room();
      expect(probe.submit(probe.waitingOn!, c).ok, JSON.stringify(c)).toBe(true);
    }
  });

  it('is deterministic: same seed and commands, same game', () => {
    const a = room(); const b = room();
    playOut(a); playOut(b);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(a.winner).toBe(b.winner);
  });

  it('plays to a finish with two humans and two bots', () => {
    const r = room();
    playOut(r);
    expect(['posse', 'oldOne']).toContain(r.winner);
  });
});

describe('event visibility — the other half of invariant 3', () => {
  const scried: GameEvent = { t: 'SCRIED', player: 'p0', cardId: 'rustlers' };
  const bought: GameEvent = { t: 'BOUGHT', player: 'p0', cardId: 'colt' };

  it('a scry is told only to the player who looked', () => {
    expect(visibleEvents([scried], 'p0')).toEqual([scried]);
    expect(visibleEvents([scried], 'p1')).toEqual([]);
    expect(visibleEvents([scried], 'spectator')).toEqual([]);
  });

  it('public events reach everyone', () => {
    expect(visibleEvents([bought], 'p1')).toEqual([bought]);
    expect(visibleEvents([bought], 'spectator')).toEqual([bought]);
  });

  it('the room applies the filter when it broadcasts', () => {
    const r = room();
    const me = r.waitingOn!;
    // Whatever happens, no seat is ever told about someone else's scry.
    for (let i = 0; i < 60 && !r.over; i++) {
      const actor = r.waitingOn;
      if (!actor) break;
      const legal = r.legal(actor);
      if (!legal.length) break;
      const res = r.submit(actor, legal[0]);
      if (!res.ok) break;
      for (const u of res.updates) {
        for (const e of u.events) {
          if (e.t === 'SCRIED') expect(e.player).toBe(u.seat);
        }
      }
    }
    expect(me).toBeTruthy();
  });
});

describe('presence and disconnects', () => {
  it('botifying a seat lets play continue without it', () => {
    const r = room();
    const dropped = r.waitingOn!;
    r.setConnected(dropped, false);
    expect(r.seat(dropped)!.connected).toBe(false);

    const res = r.botify(dropped);
    expect(res.ok).toBe(true);
    expect(r.seat(dropped)!.kind).toBe('bot');
    // The seat is now driveable without its player: stepping moves the game on.
    expect(r.awaitingBot).toBe(true);
    expect(r.stepBot()).not.toBeNull();
  });

  it('a bot seat inherits the role — botifying never reveals the Marked', () => {
    const r = room({ marked: 1 });
    r.botify('p1');
    for (const u of r.sync()) {
      if (u.seat === 'p1') continue;
      expect(JSON.stringify(u.view)).not.toContain('marked');
    }
  });

  it('a returning player reclaims their seat from the bot', () => {
    const r = room();
    r.botify('p0');
    expect(r.seat('p0')!.kind).toBe('bot');
    r.reclaim('p0');
    expect(r.seat('p0')!.kind).toBe('human');
    expect(r.seat('p0')!.connected).toBe(true);
  });

  it('knows when nobody is left to play for', () => {
    const r = room();
    expect(r.abandoned).toBe(false);
    r.setConnected('p0', false);
    r.setConnected('p1', false);
    expect(r.abandoned).toBe(true);
  });

  it('refuses commands once the game is over', () => {
    const r = room();
    playOut(r);
    expect(r.over).toBe(true);
    expect(r.submit('p0', { t: 'END_TURN' }).ok).toBe(false);
  });
});
