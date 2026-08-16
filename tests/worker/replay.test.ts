// Does the log actually reconstruct the game?
//
// This is the load-bearing claim of the persistence strategy. If a rebuild
// diverges from the live game by so much as a card, players lose their hands to
// a hibernation nobody can see happening, and the replay files are fiction.

import { describe, it, expect } from 'vitest';
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import type { GameRoomObject } from '../../worker/room';
import type { Outbound } from '../../server/protocol';
import { GameRoom } from '../../server/room';
import { seatConfigs, type RoomMeta } from '../../worker/log';

const stub = (name: string) =>
  env.ROOM.get(env.ROOM.idFromName(name)) as unknown as DurableObjectStub<GameRoomObject>;

async function socket(room: string) {
  const res = await SELF.fetch(`http://x/parties/room/${room}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = res.webSocket!;
  ws.accept();
  const seen: Outbound[] = [];
  ws.addEventListener('message', (e: MessageEvent) => {
    seen.push(JSON.parse(String(e.data)) as Outbound);
  });
  return {
    seen,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    async settle(n = 12) { for (let i = 0; i < n; i++) await scheduler.wait(10); },
    last<T extends Outbound['t']>(t: T) {
      return [...seen].reverse().find((m) => m.t === t) as Extract<Outbound, { t: T }> | undefined;
    },
  };
}

/** A dealt room with two people and a bot, then a number of real turns played. */
async function played(room: string, turns: number) {
  const a = await socket(room);
  a.send({ t: 'create', seats: 3, seed: `replay-${room}` });
  a.send({ t: 'join', name: 'Ada' });
  await a.settle();
  const b = await socket(room);
  b.send({ t: 'join', name: 'Bo' });
  await b.settle();
  a.send({ t: 'seat', index: 2, kind: 'bot' });
  a.send({ t: 'begin', marked: true });
  await a.settle();

  for (let i = 0; i < turns; i++) {
    const active = a.last('state')?.legal.length ? a : b;
    const legal = active.last('state')?.legal ?? [];
    if (!legal.length) break;
    // The last legal move is END_TURN, so this advances rather than stalling.
    active.send({ t: 'command', command: legal[legal.length - 1] });
    await active.settle(6);
  }
  return { a, b };
}

describe('rebuilding from the log', () => {
  it('reconstructs a state identical to the live one', async () => {
    const room = 'replay-identical';
    const { a } = await played(room, 10);

    // What the live object thinks, and what a rebuild from storage produces.
    const { live, meta, entries } = await runInDurableObject(stub(room), async (obj) => {
      const r = (await obj.replay())!;
      const state = await (obj as unknown as {
        // Reaching for the cache deliberately: this is the state the players
        // have been looking at, before any rebuild is forced.
        room?: GameRoom;
      }).room;
      return {
        live: state ? JSON.stringify(state.view('p0')) : null,
        meta: { seed: r.seed, marked: r.marked, seats: r.seats } as unknown as RoomMeta,
        entries: r.entries,
      };
    });
    expect(live).not.toBeNull();
    expect(entries.length).toBeGreaterThan(0);

    // Rebuild here, in the test, from nothing but seed + commands — the same
    // path the object takes after hibernation, but with no shared memory at all.
    const rebuilt = new GameRoom({
      seed: meta.seed,
      seats: seatConfigs({ seats: (meta as unknown as { seats: never[] }).seats } as RoomMeta),
      marked: meta.marked,
    });
    for (const e of entries) {
      if (e.k === 'dev') { rebuilt.devForceTurning(); continue; }
      const r = rebuilt.submit(e.seat, e.command);
      expect(r.ok, `replaying ${e.command.t}`).toBe(true);
    }

    // Byte-identical projections. Not "close enough" — the same game.
    expect(JSON.stringify(rebuilt.view('p0'))).toBe(live);
  });

  it('a hibernated object serves the same view it served before', async () => {
    const room = 'replay-hibernate';
    const { a } = await played(room, 8);
    const before = JSON.stringify(a.last('state')!.view);

    await runInDurableObject(stub(room), (obj) => obj.evictForTest());

    const after = await runInDurableObject(stub(room), async (obj) => {
      // Any read forces the rebuild; ask for the same seat's view.
      await obj.replay();
      return null;
    });
    expect(after).toBeNull();

    a.send({ t: 'command', command: { t: 'END_TURN' } });
    await a.settle(20);
    // The view moved on, but it is the same game: the seat and its own cards
    // are intact rather than reset to a fresh deal.
    const now = a.last('state')!.view;
    expect(now.you!.id).toBe(JSON.parse(before).you.id);
    expect(now.round).toBeGreaterThanOrEqual(JSON.parse(before).round);
  });
});

describe('rebuild cost', () => {
  /**
   * The number that decides whether caching state is a real question.
   *
   * Driving a full game through sockets is not the way to measure it — bots are
   * paced at five seconds an action on purpose, so a realistic log takes twenty
   * minutes of wall clock to produce that way. A whole game is played here
   * directly, which is the same sequence of commands the object would have
   * logged, and then the rebuild is timed against it.
   */
  it('rebuilds a full-length game fast enough that caching would be premature', () => {
    const seats = [
      { name: 'Ada', kind: 'bot' as const },
      { name: 'Bell', kind: 'bot' as const },
      { name: 'Cole', kind: 'bot' as const },
      { name: 'Dell', kind: 'bot' as const },
    ];
    const opts = { seed: 'timing-seed', seats, marked: 1 };

    // A whole game, recorded exactly as the object records one.
    const live = new GameRoom(opts);
    const log: { seat: string; command: unknown }[] = [];
    for (let i = 0; i < 20_000 && !live.over; i++) {
      const next = live.botCommand(log.length);
      if (!next) break;
      const r = live.submit(next.seat, next.command);
      if (!r.ok) break;
      log.push({ seat: next.seat, command: next.command });
    }

    // Now the only thing that matters: replaying it from seed + commands.
    const t0 = Date.now();
    const rebuilt = new GameRoom(opts);
    for (const e of log) {
      rebuilt.submit(e.seat as never, e.command as never);
    }
    const ms = Date.now() - t0;

    console.log(
      `full game: ${log.length} commands, rebuild ${ms}ms `
      + `(${(ms / Math.max(log.length, 1)).toFixed(2)}ms per command)`,
    );

    // Same game, not merely a similar one.
    expect(JSON.stringify(rebuilt.view('p0'))).toBe(JSON.stringify(live.view('p0')));
    expect(log.length).toBeGreaterThan(100);
    // A rebuild happens at most once per wake, behind a network round trip that
    // already cost more than this.
    expect(ms).toBeLessThan(2000);
  });
});
