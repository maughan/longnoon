import { describe, it, expect } from 'vitest';
import { Lobby, DEFAULT_LOBBY, type LobbyEvent } from '../server/lobby';

const CFG = { graceMs: 100, voteMs: 100, abandonMs: 500, maxExtensions: 2, vesselGraceMs: 30 };

const lobby = (seats = 4) =>
  new Lobby({
    seed: 'lob-1',
    seats: Array.from({ length: seats }, (_, i) => ({ name: `P${i}` })),
    marked: 1,
    config: CFG,
  });

const kinds = (l: Lobby) => l.room.seats.map((s) => s.kind);
const has = (evs: LobbyEvent[], t: LobbyEvent['t']) => evs.some((e) => e.t === t);

describe('disconnects — grace, then a vote', () => {
  it('does nothing while a seat is only briefly away', () => {
    const l = lobby();
    expect(has(l.disconnect('p0', 0), 'VOTE_OPENED')).toBe(false);
    expect(has(l.tick(50), 'VOTE_OPENED')).toBe(false);
    expect(kinds(l)).toEqual(['human', 'human', 'human', 'human']);
  });

  it('opens a vote once the grace period elapses', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    const evs = l.tick(100);
    expect(has(evs, 'VOTE_OPENED')).toBe(true);
    expect(l.voteState('p0').open).toBe(true);
  });

  it('a majority for "bot" replaces the seat immediately', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.tick(100);
    // Three players remain, so two votes carry it.
    expect(l.voteState('p0').needed).toBe(2);
    l.vote('p1', 'p0', 'bot', 100);
    const evs = l.vote('p2', 'p0', 'bot', 100);
    expect(evs).toContainEqual({ t: 'BOTIFIED', seat: 'p0', reason: 'vote' });
    expect(l.room.seat('p0')!.kind).toBe('bot');
  });

  it('a majority for "wait" resets the timer instead', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.tick(100);
    l.vote('p1', 'p0', 'wait', 100);
    l.vote('p2', 'p0', 'wait', 100);
    expect(l.room.seat('p0')!.kind).toBe('human'); // still theirs
    expect(l.voteState('p0').open).toBe(false);    // vote closed, clock reset
    expect(l.voteState('p0').extensionsLeft).toBe(1);
  });

  it('waiting cannot stall forever — extensions run out', () => {
    const l = lobby();
    let now = 0;
    l.disconnect('p0', now);
    for (let i = 0; i < 3; i++) {
      now += 100;
      l.tick(now);                       // vote opens
      l.vote('p1', 'p0', 'wait', now);
      l.vote('p2', 'p0', 'wait', now);   // majority says wait
    }
    expect(l.room.seat('p0')!.kind).toBe('bot');
  });

  it('a deadlocked vote resolves rather than hanging', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.tick(100);
    l.vote('p1', 'p0', 'bot', 100);
    l.vote('p2', 'p0', 'wait', 100);     // 1–1, no majority
    const evs = l.tick(250);             // vote expires
    expect(has(evs, 'BOTIFIED')).toBe(true);
  });

  it('only players still present may vote', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.disconnect('p1', 0);
    l.tick(100);
    // p1 is gone; their ballot must not count toward replacing p0.
    l.vote('p1', 'p0', 'bot', 100);
    expect(l.room.seat('p0')!.kind).toBe('human');
  });

  it('reports the tally but never who voted', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.tick(100);
    l.vote('p1', 'p0', 'bot', 100);
    const v = l.voteState('p0');
    expect(v.cast).toBe(1);
    expect(v.needed).toBe(2);
    expect(Object.keys(v)).toEqual(['open', 'deadline', 'cast', 'needed', 'extensionsLeft']);
    expect(JSON.stringify(v)).not.toContain('p1');
  });

  it('a returning player reclaims the seat and cancels the vote', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.tick(100);
    expect(l.voteState('p0').open).toBe(true);
    l.reconnect('p0', 120);
    expect(l.voteState('p0').open).toBe(false);
    expect(l.room.seat('p0')!.kind).toBe('human');
    expect(l.room.seat('p0')!.connected).toBe(true);
  });

  it('a player who was already botified gets their seat back', () => {
    const l = lobby();
    l.disconnect('p0', 0);
    l.tick(100);
    l.vote('p1', 'p0', 'bot', 100);
    l.vote('p2', 'p0', 'bot', 100);
    expect(l.room.seat('p0')!.kind).toBe('bot');
    expect(has(l.reconnect('p0', 200), 'RECLAIMED')).toBe(true);
    expect(l.room.seat('p0')!.kind).toBe('human');
  });
});

describe('nobody left', () => {
  it('does not botify an empty lobby — there is nobody to play it out for', () => {
    const l = lobby(2);
    l.disconnect('p0', 0);
    l.disconnect('p1', 0);
    const evs = l.tick(100);
    expect(has(evs, 'BOTIFIED')).toBe(false);
    expect(has(evs, 'VOTE_OPENED')).toBe(false);
    expect(kinds(l)).toEqual(['human', 'human']); // seats held, awaiting return
  });

  it('closes an abandoned lobby once the timer runs down', () => {
    const l = lobby(2);
    l.disconnect('p0', 0);
    l.disconnect('p1', 0);
    l.tick(100);
    expect(l.closed).toBe(false);
    expect(has(l.tick(700), 'CLOSED')).toBe(true);
    expect(l.closed).toBe(true);
  });

  it('a reconnection before the deadline saves the lobby', () => {
    const l = lobby(2);
    l.disconnect('p0', 0);
    l.disconnect('p1', 0);
    l.tick(100);
    l.reconnect('p0', 200);
    expect(has(l.tick(700), 'CLOSED')).toBe(false);
    expect(l.closed).toBe(false);
  });
});

describe('the Vessel is a special case', () => {
  it('drops on a short fuse and goes straight to a bot, with no vote', () => {
    // Trip the Turning almost immediately — Trouble now recycles, so the deck
    // no longer runs out to force it.
    const l = new Lobby({
      seed: 'lob-1',
      seats: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
      marked: 1,
      tuning: { whisperThreshold: 1 },
      config: CFG,
    });
    // Force the Turning so there is a Vessel to lose.
    let guard = 0;
    while (!l.room.view('spectator').vessel && guard++ < 400) {
      const actor = l.room.waitingOn;
      if (!actor) break;
      const legal = l.room.legal(actor);
      if (!legal.length) break;
      l.room.submit(actor, legal[0]);
    }
    const vessel = l.room.view('spectator').vessel;
    expect(vessel).toBeTruthy();
    if (!vessel || l.room.over) return;

    l.disconnect(vessel, 0);
    const evs = l.tick(CFG.vesselGraceMs);
    expect(has(evs, 'VOTE_OPENED')).toBe(false);
    expect(evs).toContainEqual({ t: 'BOTIFIED', seat: vessel, reason: 'vessel' });
  });
});

describe('defaults', () => {
  it('ships sane timings', () => {
    expect(DEFAULT_LOBBY.graceMs).toBeGreaterThan(0);
    expect(DEFAULT_LOBBY.vesselGraceMs).toBeLessThan(DEFAULT_LOBBY.graceMs);
    expect(DEFAULT_LOBBY.maxExtensions).toBeGreaterThan(0);
  });
});
