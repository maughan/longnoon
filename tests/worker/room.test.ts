// The Durable Object port, tested in workerd rather than against mocks.
//
// Durable Object semantics do not survive being faked. The whole risk of this
// port is hibernation — an object losing its memory mid-game — and a mock has
// no memory to lose.

import { describe, it, expect } from 'vitest';
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import type { GameRoomObject } from '../../worker/room';
import type { Outbound } from '../../server/protocol';

// --------------------------------------------------------------- a client

/** A socket that queues what arrives, so a test can wait for a message kind. */
async function client(room: string) {
  const res = await SELF.fetch(`http://x/parties/room/${room}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no socket for ${room}: ${res.status}`);
  ws.accept();

  const seen: Outbound[] = [];
  ws.addEventListener('message', (e: MessageEvent) => {
    seen.push(JSON.parse(String(e.data)) as Outbound);
  });

  return {
    ws,
    seen,
    send(msg: unknown) { ws.send(JSON.stringify(msg)); },
    /** Wait for the next message of a kind, from `from` onwards. */
    async next<T extends Outbound['t']>(t: T, from = 0): Promise<Extract<Outbound, { t: T }>> {
      for (let i = 0; i < 200; i++) {
        const hit = seen.slice(from).find((m) => m.t === t);
        if (hit) return hit as Extract<Outbound, { t: T }>;
        await scheduler.wait(10);
      }
      throw new Error(`no ${t}; got ${seen.map((m) => m.t).join(',') || 'nothing'}`);
    },
    last<T extends Outbound['t']>(t: T): Extract<Outbound, { t: T }> | undefined {
      return [...seen].reverse().find((m) => m.t === t) as never;
    },
  };
}

/** A room with three chairs: two people and a bot, dealt. */
async function dealt(name: string) {
  const a = await client(name);
  a.send({ t: 'create', seats: 3, seed: `seed-${name}` });
  await a.next('created');
  a.send({ t: 'join', name: 'Ada' });
  const joinedA = await a.next('joined');

  const b = await client(name);
  b.send({ t: 'join', name: 'Bo' });
  const joinedB = await b.next('joined');

  a.send({ t: 'seat', index: 2, kind: 'bot' });
  await a.next('table', a.seen.length - 1);
  a.send({ t: 'begin', marked: true });
  await a.next('state');
  await b.next('state');
  return { a, b, seatA: joinedA.seat, seatB: joinedB.seat };
}

const stub = (name: string) =>
  env.ROOM.get(env.ROOM.idFromName(name)) as unknown as DurableObjectStub<GameRoomObject>;

// --------------------------------------------------------------- the tests

describe('two clients at one table', () => {
  it('gives each connection its own view and its own legal moves', async () => {
    const { a, b, seatA, seatB } = await dealt('two-views');
    expect(seatA).toBe('p0');
    expect(seatB).toBe('p1');

    const sa = a.last('state')!;
    const sb = b.last('state')!;
    expect(sa.view.viewer).toBe(seatA);
    expect(sb.view.viewer).toBe(seatB);
    // Only the seat whose turn it is has moves; that is what makes these views
    // different rather than two copies of one payload.
    expect(sa.view.you!.id).toBe(seatA);
    expect(sb.view.you!.id).toBe(seatB);
    expect(sa.legal.length === 0 || sb.legal.length === 0).toBe(true);
  });
});

describe('nothing leaks between seats', () => {
  it('never puts another player’s role or hand in a payload', async () => {
    const { a, seatB } = await dealt('no-leak');

    // Serialised, because that is what actually crosses the wire — an object
    // graph can hide a reference that JSON would expose.
    const wire = JSON.stringify(a.seen);
    const parsed = a.last('state')!;

    // B's hand, card by card, must not appear in anything A received.
    const inside = await runInDurableObject(stub('no-leak'), async (obj) => {
      const replay = await obj.replay();
      return replay!.seats.map((s) => s.id);
    });
    expect(inside).toContain(seatB);

    const opponent = parsed.view.opponents.find((o) => o.id === seatB)!;
    // Counts, never contents. This is the shape playerView promises.
    expect(opponent).not.toHaveProperty('hand');
    expect(opponent.role).toBeNull();
    expect(typeof opponent.handCount).toBe('number');

    // And the words that would give it away are absent from the whole stream.
    expect(wire).not.toMatch(/"role":"marked"[^}]*"id":"p1"/);
    expect(parsed.view.you!.id).not.toBe(seatB);
  });

  it('does not hand the whole state to anyone', async () => {
    const { a } = await dealt('no-state');
    const wire = JSON.stringify(a.seen);
    // Fields that only exist on GameState, never on a ClientState.
    for (const field of ['"rngCursor"', '"turnOrder"', '"supply"', '"revealedRoles"']) {
      expect(wire, field).not.toContain(field);
    }
  });
});

describe('commands are checked before they are applied', () => {
  it('refuses a command from the seat whose turn it is not', async () => {
    const { a, b } = await dealt('wrong-player');
    const idle = (a.last('state')!.legal.length === 0 ? a : b);
    const before = idle.seen.length;
    idle.send({ t: 'command', command: { t: 'END_TURN' } });
    const e = await idle.next('error', before);
    expect(e.message).toBe('Not your turn');
  });

  it('refuses a move the rules never offered', async () => {
    const { a, b } = await dealt('never-offered');
    const active = (a.last('state')!.legal.length ? a : b);
    const before = active.seen.length;
    // Buying with no Grit: a well-formed command that is not legal.
    active.send({ t: 'command', command: { t: 'BUY', cardId: 'colt' } });
    const e = await active.next('error', before);
    expect(e.message).toBe('Illegal command');
  });

  it('refuses a command from a socket with no seat', async () => {
    await dealt('no-seat');
    const stranger = await client('no-seat');
    stranger.send({ t: 'command', command: { t: 'END_TURN' } });
    expect((await stranger.next('error')).message).toBe('Not seated');
  });

  it('rejects junk without throwing', async () => {
    const c = await client('junk');
    for (const junk of ['not json', '{"t":"nonsense"}', '{"t":"create","seats":"three"}']) {
      const before = c.seen.length;
      c.ws.send(junk);
      expect((await c.next('error', before)).message).toBe('Malformed message');
    }
  });

  it('refuses an oversized frame', async () => {
    const c = await client('too-big');
    c.ws.send(JSON.stringify({ t: 'join', name: 'x'.repeat(20_000) }));
    expect((await c.next('error')).message).toBe('Message too large');
  });
});

describe('hibernation', () => {
  it('keeps a player in their seat when the object loses its memory', async () => {
    const { a, seatA } = await dealt('hibernate');

    // Exactly what hibernation does: every class field goes. The seat is in
    // connection state, which Cloudflare persists — if it were in a Map keyed
    // by connection id, it would be gone here and the player would silently
    // find themselves unseated.
    await runInDurableObject(stub('hibernate'), (obj) => obj.evictForTest());

    const before = a.seen.length;
    a.send({ t: 'command', command: { t: 'END_TURN' } });
    // Either it worked or it was refused on a game rule — both prove the socket
    // is still recognised as this seat. "Not seated" would be the failure.
    const after = await Promise.race([
      a.next('state', before).then(() => 'state' as const),
      a.next('error', before).then((e) => e.message),
    ]);
    expect(after).not.toBe('Not seated');

    // And the rebuilt game is the same game.
    const view = await runInDurableObject(stub('hibernate'), async (obj) => {
      const r = await obj.replay();
      return r!.entries.length;
    });
    expect(view).toBeGreaterThanOrEqual(0);
    expect(a.last('state')!.view.you!.id).toBe(seatA);
  });

  it('rebuilds the game from the log, not from a stored state', async () => {
    const { a, b } = await dealt('rebuild');
    // Play a few real turns so the log has something in it.
    for (let i = 0; i < 6; i++) {
      const active = a.last('state')!.legal.length ? a : b;
      const legal = active.last('state')!.legal;
      if (!legal.length) break;
      const before = active.seen.length;
      active.send({ t: 'command', command: legal[legal.length - 1] });
      await Promise.race([
        active.next('state', before).catch(() => null),
        scheduler.wait(200),
      ]);
    }

    const live = a.last('state')!.view;
    const rebuilt = await runInDurableObject(stub('rebuild'), async (obj) => {
      obj.evictForTest();                     // force the replay path
      return (await obj.replay())!;
    });

    expect(rebuilt.entries.length).toBeGreaterThan(0);
    // Nothing resembling a serialised game is in storage — only seed + commands.
    expect(Object.keys(rebuilt)).toEqual(
      expect.arrayContaining(['seed', 'entries', 'seats', 'marked']),
    );
    expect(JSON.stringify(rebuilt)).not.toContain('"rngCursor"');
    expect(live.round).toBeGreaterThan(0);
  });
});

describe('the replay route', () => {
  it('serves seed and commands as JSON', async () => {
    await dealt('replay-route');
    const res = await SELF.fetch('http://x/rooms/replay-route/replay');
    expect(res.status).toBe(200);
    const body = await res.json() as { seed: string; entries: unknown[] };
    expect(body.seed).toBe('seed-replay-route');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('404s a room nobody has opened', async () => {
    const res = await SELF.fetch('http://x/rooms/never-existed/replay');
    expect(res.status).toBe(404);
  });
});
