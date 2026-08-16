import { describe, it, expect } from 'vitest';
import { Hub } from '../server/hub';
import type { Envelope, Outbound } from '../server/protocol';

/** Deterministic ids, so tests can name tokens. */
const ids = () => {
  let n = 0;
  return () => `id-${n++}`;
};

const msgs = <T extends Outbound['t']>(out: Envelope[], t: T) =>
  out.filter((e) => e.msg.t === t);

const to = (out: Envelope[], conn: string) => out.filter((e) => e.conn === conn);

/** A room with three chairs, nobody in them yet. */
function opened(opts: { devTools?: boolean; seats?: number } = {}) {
  const hub = new Hub({
    newId: ids(),
    devTools: opts.devTools,
    config: { graceMs: 10, voteMs: 10, abandonMs: 50, maxExtensions: 1, vesselGraceMs: 5 },
  });
  const made = hub.handle('c0', {
    t: 'create', seats: opts.seats ?? 3, seed: 'hub-seed',
  }, 0);
  expect(made[0].msg.t).toBe('created');
  return { hub, roomId: (made[0].msg as { roomId: string }).roomId };
}

const table = (out: Envelope[]) =>
  msgs(out, 'table')[0]?.msg as
    { seats: { kind: string; name: string | null }[]; canBegin: boolean } | undefined;

/** A hub with a game under way: two players, one bot, dealt. */
function seated(opts: { devTools?: boolean } = {}) {
  const { hub, roomId } = opened(opts);
  const a = hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
  const b = hub.handle('c1', { t: 'join', roomId, name: 'Bo' }, 0);
  hub.handle('c0', { t: 'seat', index: 2, kind: 'bot' }, 0);
  hub.handle('c0', { t: 'begin', marked: true }, 0);
  const tokenA = (msgs(a, 'joined')[0].msg as { token: string }).token;
  const dev = (msgs(a, 'joined')[0].msg as { dev: boolean }).dev;
  const seatA = (msgs(a, 'joined')[0].msg as { seat: string }).seat;
  const seatB = (msgs(b, 'joined')[0].msg as { seat: string }).seat;
  return { hub, roomId, tokenA, seatA, seatB, dev };
}

describe('joining', () => {
  it('assigns distinct seats and hands back a token', () => {
    const { seatA, seatB, tokenA } = seated();
    expect(seatA).toBe('p0');
    expect(seatB).toBe('p1');
    expect(tokenA).toBeTruthy();
  });

  it('refuses once every human seat is taken', () => {
    const { hub, roomId } = seated();
    const out = hub.handle('c2', { t: 'join', roomId, name: 'Cy' }, 0);
    expect(msgs(out, 'error')).toHaveLength(1);
  });

  it('refuses an unknown room', () => {
    const { hub } = seated();
    const out = hub.handle('c9', { t: 'join', roomId: 'nope', name: 'X' }, 0);
    expect((out[0].msg as { message: string }).message).toBe('No such room');
  });
});

describe('a connection cannot act as another seat', () => {
  it('takes the seat from the connection, never the message', () => {
    const { hub } = seated();
    // c1 sends a command while it is c0's turn. There is no seat field to
    // forge, so the server resolves it to c1 and rejects it.
    const out = hub.handle('c1', { t: 'command', command: { t: 'END_TURN' } }, 0);
    expect((out[0].msg as { message: string }).message).toBe('Not your turn');
  });

  it('refuses commands from a connection with no seat', () => {
    const { hub } = seated();
    const out = hub.handle('c9', { t: 'command', command: { t: 'END_TURN' } }, 0);
    expect((out[0].msg as { message: string }).message).toBe('Not seated');
  });

  it('still rejects illegal commands from the right seat', () => {
    const { hub } = seated();
    const out = hub.handle('c0', {
      t: 'command', command: { t: 'DEAL_DAMAGE', slot: -1, amount: 9999 },
    }, 0);
    expect(msgs(out, 'error')).toHaveLength(1);
  });
});

describe('state goes only to the seat it belongs to', () => {
  it('each connection receives its own view', () => {
    const { hub } = seated();
    const out = hub.handle('c0', { t: 'command', command: { t: 'END_TURN' } }, 0);
    const states = msgs(out, 'state');
    expect(states.length).toBeGreaterThan(0);
    for (const e of states) {
      const view = (e.msg as { view: { viewer: string; opponents: unknown } }).view;
      const expectSeat = e.conn === 'c0' ? 'p0' : 'p1';
      expect(view.viewer).toBe(expectSeat);
      // You may see your own role — p1 IS the Marked player here — but never
      // anyone else's.
      expect(JSON.stringify(view.opponents)).not.toContain('marked');
    }
  });
});

describe('tokens and reclaiming', () => {
  it('a dropped player reclaims their seat with their token', () => {
    const { hub, roomId, tokenA, seatA } = seated();
    hub.disconnect('c0', 0);
    const out = hub.handle('c2', { t: 'rejoin', roomId, token: tokenA }, 5);
    const joined = msgs(out, 'joined')[0].msg as { seat: string };
    expect(joined.seat).toBe(seatA);
  });

  it('a wrong token is refused, and says nothing useful', () => {
    const { hub, roomId } = seated();
    const out = hub.handle('c2', { t: 'rejoin', roomId, token: 'guess' }, 0);
    expect((out[0].msg as { message: string }).message).toBe('Cannot rejoin');
  });

  it('tokens are not derived from the game seed', () => {
    // Two rooms on the same seed must not produce the same token, or anyone
    // with a replay could reclaim a seat and read its hidden role.
    const mk = () => {
      const hub = new Hub();
      const made = hub.handle('c0', {
        t: 'create', seats: 3, seed: 'same-seed',
      }, 0);
      const roomId = (made[0].msg as { roomId: string }).roomId;
      const j = hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
      return (msgs(j, 'joined')[0].msg as { token: string }).token;
    };
    expect(mk()).not.toBe(mk());
  });
});

describe('disconnects drive the lobby', () => {
  it('a drop eventually opens a vote, and the tally is broadcast', () => {
    const { hub } = seated();
    hub.disconnect('c0', 0);
    const out = hub.tick(20);
    expect(msgs(out, 'lobby').some(
      (e) => (e.msg as { event: { t: string } }).event.t === 'VOTE_OPENED',
    )).toBe(true);
  });

  it('a vote message reports counts, never who voted', () => {
    const { hub, seatA } = seated();
    hub.disconnect('c0', 0);
    hub.tick(20);
    const out = hub.handle('c1', { t: 'vote', seat: seatA, choice: 'bot' }, 20);
    const voteMsg = msgs(out, 'vote')[0].msg as unknown as { state: Record<string, unknown> };
    expect(Object.keys(voteMsg.state).sort())
      .toEqual(['cast', 'deadline', 'extensionsLeft', 'needed', 'open']);
    expect(JSON.stringify(voteMsg)).not.toContain('c1');
  });

  it('an abandoned room is dropped once it closes', () => {
    const { hub, roomId } = seated();
    hub.disconnect('c0', 0);
    hub.disconnect('c1', 0);
    hub.tick(20);
    expect(hub.room(roomId)).toBeTruthy();
    hub.tick(200);
    expect(hub.room(roomId)).toBeUndefined();
  });

  it('nothing is sent to a connection that has gone', () => {
    const { hub } = seated();
    hub.disconnect('c1', 0);
    const out = hub.handle('c0', { t: 'command', command: { t: 'END_TURN' } }, 0);
    expect(to(out, 'c1')).toHaveLength(0);
  });
});

describe('the wire is untrusted', () => {
  const junk: unknown[] = [
    null, 42, 'hello', [],
    {},                                   // no discriminator
    { t: 'nonsense' },
    { t: 'command' },                     // missing command
    { t: 'command', command: 'END_TURN' },// command is not an object
    { t: 'command', command: {} },        // command has no type
    { t: 'join', roomId: 5, name: 'x' },  // wrong types
    { t: 'vote', seat: 'p0', choice: 'maybe' },
    { t: 'create', seats: 'three' },      // a seat count that is not a number
    { t: 'seat', index: 'two', kind: 'bot' },
    { t: 'begin', marked: 'yes' },
  ];

  it('answers malformed payloads with an error, never a throw', () => {
    const { hub } = seated();
    for (const bad of junk) {
      const out = hub.handle('c0', bad, 0);
      expect(out, JSON.stringify(bad)).toHaveLength(1);
      expect(out[0].msg.t, JSON.stringify(bad)).toBe('error');
    }
  });
});


describe('development tools', () => {
  const view = (out: Envelope[], conn: string) =>
    (to(msgs(out, 'state'), conn)[0]?.msg as { view: { act: string } } | undefined)?.view;

  it('are shut off by default', () => {
    const { hub } = seated();
    const out = hub.handle('c0', { t: 'dev', action: 'turning' }, 0);
    expect((out[0].msg as { message: string }).message).toBe('Not available');
    expect(msgs(out, 'state')).toHaveLength(0);
  });

  it('are not advertised to a client that cannot use them', () => {
    // The client shows the act controls only if this says so, so a false
    // positive here puts a Turning button in front of a real table.
    expect(seated().dev).toBe(false);
    expect(seated({ devTools: true }).dev).toBe(true);
  });

  it('force the Turning through the real rule, not a shortcut', () => {
    const { hub } = seated({ devTools: true });
    expect(view(hub.handle('c0', { t: 'dev', action: 'turning' }, 0), 'c0')?.act)
      .toBe('mythos');
  });

  it('name a Vessel and turn every Sign, as the rule would', () => {
    const { hub } = seated({ devTools: true });
    const out = hub.handle('c0', { t: 'dev', action: 'turning' }, 0);
    const state = (msgs(out, 'state')[0].msg as {
      view: { vessel: string | null; you: { deck: { fevered: boolean }[] } | null };
      events: { t: string }[];
    });
    expect(state.view.vessel).not.toBeNull();
    // The client hangs its whole Turning sequence off this event.
    expect(state.events.some((e) => e.t === 'TURNING')).toBe(true);
  });

  it('refuse to Turn twice', () => {
    const { hub } = seated({ devTools: true });
    hub.handle('c0', { t: 'dev', action: 'turning' }, 0);
    expect(hub.handle('c0', { t: 'dev', action: 'turning' }, 0)).toHaveLength(0);
  });

  it('deal a fresh Act I on restart, and a different one each time', () => {
    const { hub } = seated({ devTools: true });
    hub.handle('c0', { t: 'dev', action: 'turning' }, 0);
    const first = hub.handle('c0', { t: 'dev', action: 'restart' }, 0);
    expect(view(first, 'c0')?.act).toBe('trouble');
    const hands = (out: Envelope[]) => JSON.stringify(
      (to(msgs(out, 'state'), 'c0')[0].msg as {
        view: { you: { hand: unknown[] } | null };
      }).view.you?.hand,
    );
    const second = hub.handle('c0', { t: 'dev', action: 'restart' }, 0);
    expect(hands(second)).not.toBe(hands(first));
  });

  it('refuse a connection that is not in a room', () => {
    const { hub } = seated({ devTools: true });
    const out = hub.handle('c9', { t: 'dev', action: 'turning' }, 0);
    expect((out[0].msg as { message: string }).message).toBe('Not in a room');
  });
});


describe('leaving a game', () => {
  it('releases the seat, like a dropped socket would', () => {
    const { hub, roomId, seatA } = seated();
    hub.handle('c0', { t: 'leave' }, 0);
    // The seat is free again, so someone else can sit in it.
    const out = hub.handle('c2', { t: 'join', roomId, name: 'Cy' }, 0);
    expect((msgs(out, 'joined')[0].msg as { seat: string }).seat).toBe(seatA);
  });

  it('burns the token, so the seat cannot be silently reclaimed', () => {
    // A disconnect keeps the token — the point of a disconnect is that you
    // meant to come back. Leaving is the opposite statement.
    const { hub, roomId, tokenA } = seated();
    hub.handle('c0', { t: 'leave' }, 0);
    const back = hub.handle('c3', { t: 'rejoin', roomId, token: tokenA }, 0);
    expect(msgs(back, 'joined')).toHaveLength(0);
    expect(msgs(back, 'error')).toHaveLength(1);
  });

  it('still lets a merely disconnected player back in', () => {
    const { hub, roomId, tokenA, seatA } = seated();
    hub.disconnect('c0', 0);
    const back = hub.handle('c3', { t: 'rejoin', roomId, token: tokenA }, 0);
    expect((msgs(back, 'joined')[0].msg as { seat: string }).seat).toBe(seatA);
  });

  it('shrugs at a leave from a connection with no seat', () => {
    const { hub } = seated();
    expect(() => hub.handle('c9', { t: 'leave' }, 0)).not.toThrow();
  });
});


describe('the table, before the deal', () => {
  it('opens a room of empty chairs and nothing else', () => {
    const { hub, roomId } = opened({ seats: 4 });
    const out = hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    const t = table(out)!;
    expect(t.seats).toHaveLength(4);
    expect(t.seats[0]).toMatchObject({ kind: 'human', name: 'Ada' });
    expect(t.seats.slice(1).every((x) => x.kind === 'open')).toBe(true);
    // No game exists yet, so no state has been sent.
    expect(msgs(out, 'state')).toHaveLength(0);
    expect(t.canBegin).toBe(false);
  });

  it('refuses a table that is too small or too large for the game', () => {
    const hub = new Hub({ newId: ids() });
    for (const seats of [2, 6]) {
      const out = hub.handle('c0', { t: 'create', seats }, 0);
      expect(out[0].msg.t, `${seats} seats`).toBe('error');
    }
  });

  it('fills an empty chair with a bot, and empties it again', () => {
    const { hub, roomId } = opened();
    hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    const filled = table(hub.handle('c0', { t: 'seat', index: 2, kind: 'bot' }, 0))!;
    expect(filled.seats[2].kind).toBe('bot');
    expect(filled.seats[2].name).toBeTruthy();

    const emptied = table(hub.handle('c0', { t: 'seat', index: 2, kind: 'open' }, 0))!;
    expect(emptied.seats[2]).toMatchObject({ kind: 'open', name: null });
  });

  it('will not let one player remove another from their chair', () => {
    const { hub, roomId } = opened();
    hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    hub.handle('c1', { t: 'join', roomId, name: 'Bo' }, 0);
    // Bo is in seat 1. Ada tries to turn them into a bot.
    const out = hub.handle('c0', { t: 'seat', index: 1, kind: 'bot' }, 0);
    expect((out[0].msg as { message: string }).message).toBe('Someone is sitting there');
  });

  it('refuses to deal while a chair is empty', () => {
    const { hub, roomId } = opened();
    hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    const out = hub.handle('c0', { t: 'begin', marked: false }, 0);
    expect((out[0].msg as { message: string }).message)
      .toBe('Every chair must be filled first');
    expect(msgs(out, 'state')).toHaveLength(0);
  });

  it('deals once every chair is filled, and only once', () => {
    const { hub, roomId } = opened();
    hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    hub.handle('c0', { t: 'seat', index: 1, kind: 'bot' }, 0);
    const ready = table(hub.handle('c0', { t: 'seat', index: 2, kind: 'bot' }, 0))!;
    expect(ready.canBegin).toBe(true);

    const dealt = hub.handle('c0', { t: 'begin', marked: false }, 0);
    expect(msgs(dealt, 'state')).toHaveLength(1);

    const again = hub.handle('c0', { t: 'begin', marked: false }, 0);
    expect((again[0].msg as { message: string }).message)
      .toBe('The game has already begun');
  });

  it('refuses to move a seat once the game is under way', () => {
    const { hub } = seated();
    const out = hub.handle('c0', { t: 'seat', index: 2, kind: 'open' }, 0);
    expect((out[0].msg as { message: string }).message)
      .toBe('The game has already begun');
  });

  it('frees the chair when someone leaves before the deal', () => {
    const { hub, roomId } = opened();
    hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    const out = hub.handle('c1', { t: 'join', roomId, name: 'Bo' }, 0);
    expect(table(out)!.seats[1].kind).toBe('human');

    // Ada closes the tab. There is no game to hold her chair for.
    const left = hub.disconnect('c0', 0);
    expect(table(left)!.seats[0]).toMatchObject({ kind: 'open', name: null });

    // And the chair is genuinely available again.
    const cy = hub.handle('c2', { t: 'join', roomId, name: 'Cy' }, 0);
    expect((msgs(cy, 'joined')[0].msg as { seat: string }).seat).toBe('p0');
  });

  it('refuses commands before there is a game to play', () => {
    const { hub, roomId } = opened();
    hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
    const out = hub.handle('c0', { t: 'command', command: { t: 'END_TURN' } }, 0);
    expect((out[0].msg as { message: string }).message).toBe('The game has not begun');
  });

  it('does not always make the first chair the traitor', () => {
    // The client used to send `marked: 0`, so whoever created the room was the
    // Marked player in every game ever played. The seed decides now.
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const hub = new Hub({ newId: ids() });
      const made = hub.handle('c0', { t: 'create', seats: 3, seed }, 0);
      const roomId = (made[0].msg as { roomId: string }).roomId;
      hub.handle('c0', { t: 'join', roomId, name: 'Ada' }, 0);
      hub.handle('c0', { t: 'seat', index: 1, kind: 'bot' }, 0);
      hub.handle('c0', { t: 'seat', index: 2, kind: 'bot' }, 0);
      const out = hub.handle('c0', { t: 'begin', marked: true }, 0);
      const view = (msgs(out, 'state')[0].msg as {
        view: { you: { role: string } | null };
      }).view;
      seen.add(view.you!.role);
    }
    expect(seen.has('faithful'), 'the creator is not always Marked').toBe(true);
  });
});
