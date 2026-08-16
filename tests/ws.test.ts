// End-to-end over a real socket. Everything below the transport is already
// unit-tested; this proves the wiring — JSON in, per-seat views out, and a seat
// that survives a dropped connection.

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { serve, type Server } from '../server/ws';
import type { Outbound } from '../server/protocol';

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** A client that collects everything the server sends it. */
function client(port: number) {
  const sock = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: Outbound[] = [];
  sock.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as Outbound));
  const open = new Promise<void>((r) => sock.on('open', () => r()));
  return {
    sock,
    inbox,
    open,
    send: (msg: unknown) => sock.send(JSON.stringify(msg)),
    /** Wait for the next message of type `t`, consuming it. */
    async next<T extends Outbound['t']>(t: T, tries = 60): Promise<Extract<Outbound, { t: T }>> {
      for (let i = 0; i < tries; i++) {
        const at = inbox.findIndex((m) => m.t === t);
        if (at >= 0) return inbox.splice(at, 1)[0] as Extract<Outbound, { t: T }>;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${t} message; got ${inbox.map((m) => m.t).join(', ')}`);
    },
  };
}

describe('the socket server', () => {
  it('carries a game between two clients, each seeing only its own view', async () => {
    server = await serve({ port: 0, tickMs: 10_000 });
    const a = client(server.port);
    const b = client(server.port);
    await Promise.all([a.open, b.open]);

    a.send({ t: 'create', seats: 3, seed: 'ws-seed' });
    const { roomId } = await a.next('created');

    a.send({ t: 'join', roomId, name: 'Ada' });
    const joinedA = await a.next('joined');
    b.send({ t: 'join', roomId, name: 'Bo' });
    const joinedB = await b.next('joined');

    expect(joinedA.seat).toBe('p0');
    expect(joinedB.seat).toBe('p1');

    // The last chair takes a bot, and then the table is dealt.
    a.send({ t: 'seat', index: 2, kind: 'bot' });
    await a.next('table');
    a.send({ t: 'begin', marked: true });
    expect(joinedA.token).not.toBe(joinedB.token);

    a.send({ t: 'command', command: { t: 'END_TURN' } });
    const stateA = await a.next('state');
    const stateB = await b.next('state');

    expect(stateA.view.viewer).toBe('p0');
    expect(stateB.view.viewer).toBe('p1');
    // Neither is told anyone else's role.
    expect(JSON.stringify(stateA.view.opponents)).not.toContain('marked');
    expect(JSON.stringify(stateB.view.opponents)).not.toContain('marked');

    a.sock.close();
    b.sock.close();
  });

  it('answers garbage without falling over', async () => {
    server = await serve({ port: 0, tickMs: 10_000 });
    const a = client(server.port);
    await a.open;

    a.sock.send('not json at all');
    expect((await a.next('error')).message).toBe('Malformed message');

    a.send({ t: 'command' });                 // well-formed JSON, bad message
    expect((await a.next('error')).message).toBe('Malformed message');

    // Still alive and able to do real work.
    a.send({ t: 'create', seats: 3, seed: 's' });
    expect(await a.next('created')).toBeTruthy();
    a.sock.close();
  });

  it('a seat survives its connection dropping and is reclaimed by token', async () => {
    server = await serve({ port: 0, tickMs: 10_000 });
    const a = client(server.port);
    await a.open;
    a.send({ t: 'create', seats: 3, seed: 's' });
    const { roomId } = await a.next('created');
    a.send({ t: 'join', roomId, name: 'Ada' });
    const first = await a.next('joined');

    // Deal first. A seat only survives a drop once there is a game to hold it
    // for — before that, closing the tab is leaving the queue.
    a.send({ t: 'seat', index: 1, kind: 'bot' });
    a.send({ t: 'seat', index: 2, kind: 'bot' });
    await a.next('table');
    a.send({ t: 'begin', marked: false });
    await a.next('state');

    a.sock.close();
    await new Promise((r) => setTimeout(r, 50));

    const back = client(server.port);
    await back.open;
    back.send({ t: 'rejoin', roomId, token: first.token });
    const again = await back.next('joined');
    expect(again.seat).toBe(first.seat);
    back.sock.close();
  });
});
