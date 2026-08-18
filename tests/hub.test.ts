import { describe, it, expect } from 'vitest';
import { Hub } from '../server/hub';
import type { Envelope, Outbound } from '../server/protocol';
import { DEV_ACTIONS } from '../server/protocol';

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

  /*
    The gate, checked against the LIST rather than against the two actions that
    happened to exist when this was written.

    `sit` hands over another seat's hand and hidden role; `turning` decides the
    Marked player's aim. Any one of these reaching a real table is the whole
    failure. A test naming actions individually is a test that passes for ever
    while somebody adds a ninth.
  */
  it('are shut off by default — every one of them', () => {
    for (const action of DEV_ACTIONS) {
      const { hub } = seated();
      const out = hub.handle('c0', { t: 'dev', action, seat: 'p1' }, 0);
      expect((out[0].msg as { message: string }).message, action).toBe('Not available');
      expect(msgs(out, 'state'), action).toHaveLength(0);
    }
  });

  it('name the seat you asked for as the Vessel', () => {
    // The whole reason `checkTurning` takes an override: being the Vessel is
    // the state hardest to reach by playing, and the one most worth testing.
    const { hub, seatB } = seated({ devTools: true });
    const out = hub.handle('c0', { t: 'dev', action: 'turning', seat: seatB }, 0);
    const v = (msgs(out, 'state')[0].msg as { view: { vessel: string | null } }).view;
    expect(v.vessel).toBe(seatB);
  });

  it('set a status, but never conjure a Vessel out of one', () => {
    const { hub, seatB } = seated({ devTools: true });
    const status = (out: Envelope[], id: string) => {
      const v = (to(msgs(out, 'state'), 'c0')[0].msg as {
        view: { opponents: { id: string; status: string }[] };
      }).view;
      return v.opponents.find((o) => o.id === id)?.status;
    };
    const fell = hub.handle('c0', { t: 'dev', action: 'status', seat: seatB, status: 'revenant' }, 0);
    expect(status(fell, seatB)).toBe('revenant');

    /*
      A Vessel is the far side of the Turning, not a tag. Setting the tag alone
      would leave a seat that is the Vessel by name and a posse member by
      contents — a state no game can reach, and therefore a bug report about a
      situation nobody can have.
    */
    const asked = hub.handle('c0', {
      t: 'dev', action: 'status', seat: seatB,
      status: 'vessel' as 'posse',
    }, 0);
    expect(msgs(asked, 'state')).toHaveLength(0);
  });

  it('bring on Dusk through a real end of turn', () => {
    const { hub } = seated({ devTools: true });
    const out = hub.handle('c0', { t: 'dev', action: 'dusk' }, 0);
    const events = (msgs(out, 'state')[0].msg as { events: { t: string }[] }).events;
    expect(events.some((e) => e.t === 'PHASE')).toBe(true);
  });

  it('hand out Grit and cards', () => {
    const { hub, seatA } = seated({ devTools: true });
    const mine = (out: Envelope[]) => (to(msgs(out, 'state'), 'c0')[0].msg as {
      view: { you: { grit: number; hand: { cardId: string }[] } };
    }).view.you;
    const before = mine(hub.handle('c0', { t: 'dev', action: 'grit', seat: seatA, n: 0 }, 0));
    const after = mine(hub.handle('c0', { t: 'dev', action: 'grit', seat: seatA, n: 5 }, 0));
    expect(after.grit).toBe(before.grit + 5);

    const given = mine(hub.handle('c0', {
      t: 'dev', action: 'give', seat: seatA, cardId: 'colt',
    }, 0));
    expect(given.hand.some((ci) => ci.cardId === 'colt')).toBe(true);
    // A card id nothing knows is refused rather than thrown.
    expect(hub.handle('c0', {
      t: 'dev', action: 'give', seat: seatA, cardId: 'no-such-card',
    }, 0)).toHaveLength(0);
  });

  /*
    Sitting elsewhere is a SWAP, and the two halves both matter.

    The chair you leave has to be handed to a bot or the game stops the moment
    the turn comes back to it, and the chair you take has to stop being a bot or
    two of you are playing it. The token follows the person: it is the claim on
    "wherever this person is sitting", and one left pointing at the chair just
    vacated would deal a reconnecting tester somebody else's hand.
  */
  describe('sitting in another seat', () => {
    it('swaps the seat, the bot and the token together', () => {
      const { hub, roomId, seatA, seatB } = seated({ devTools: true });
      // B leaves, so their chair is free to take.
      hub.handle('c1', { t: 'leave' }, 0);

      const out = hub.handle('c0', { t: 'dev', action: 'sit', seat: seatB }, 0);
      const joined = msgs(out, 'joined')[0].msg as { seat: string; token: string };
      expect(joined.seat).toBe(seatB);

      const seats = (o: Envelope[]) => (msgs(o, 'state')[0].msg as {
        bots: string[];
      }).bots;
      expect(seats(out)).toContain(seatA);
      expect(seats(out)).not.toContain(seatB);

      // The token now claims the new chair, not the old one.
      const back = hub.handle('c7', { t: 'rejoin', roomId, token: joined.token }, 0);
      expect((msgs(back, 'joined')[0].msg as { seat: string }).seat).toBe(seatB);
    });

    it('refuses a chair somebody is sitting in', () => {
      const { hub, seatB } = seated({ devTools: true });
      const out = hub.handle('c0', { t: 'dev', action: 'sit', seat: seatB }, 0);
      expect((out[0].msg as { message: string }).message)
        .toBe('Somebody is already in that seat');
    });

    it('is a no-op when you are already there', () => {
      const { hub, seatA } = seated({ devTools: true });
      expect(hub.handle('c0', { t: 'dev', action: 'sit', seat: seatA }, 0))
        .toHaveLength(0);
    });
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

describe('game speed, and the one control with an owner', () => {
  /** Two humans at a three-chair table, not yet dealt. */
  function seated() {
    const hub = new Hub({ newId: ids() });
    const made = hub.handle('a', { t: 'create', seats: 3, seed: 'spd' }, 0);
    const roomId = (made[0]!.msg as { roomId: string }).roomId;
    const first = hub.handle('a', { t: 'join', roomId, name: 'Ada' }, 0);
    const second = hub.handle('b', { t: 'join', roomId, name: 'Bo' }, 0);
    return { hub, roomId, first, second };
  }

  const joined = (out: ReturnType<Hub['handle']>) =>
    out.find((e) => e.msg.t === 'joined')!.msg as
      Extract<Outbound, { t: 'joined' }>;

  it('makes the first human to sit down the host', () => {
    // Not whoever sent `create`: that opens chairs and seats nobody, so it
    // would hand the room to someone who might never sit in it.
    const { first, second } = seated();
    expect(joined(first).host).toBe(true);
    expect(joined(second).host).toBe(false);
    expect(joined(first).speed).toBe('normal');
  });

  it('lets the host set it and tells the whole table', () => {
    const { hub } = seated();
    const out = hub.handle('a', { t: 'speed', value: 'fastest' }, 0);
    const msgs = out.filter((e) => e.msg.t === 'speed');
    expect(msgs).toHaveLength(2);
    for (const e of msgs) {
      const m = e.msg as Extract<Outbound, { t: 'speed' }>;
      expect(m.speed).toBe('fastest');
      // Each seat is told whether IT owns the control, not who does.
      expect(m.you).toBe(e.conn === 'a');
    }
  });

  it('refuses anyone else, rather than ignoring them', () => {
    // A control that silently does nothing is worse than one that says no —
    // and the client only renders it for the host, so anybody reaching this
    // is not using the UI.
    const { hub } = seated();
    const out = hub.handle('b', { t: 'speed', value: 'fast' }, 0);
    expect(out.map((e) => e.msg.t)).toEqual(['error']);
    expect((out[0]!.msg as { message: string }).message)
      .toBe('Only the host sets the speed');
  });

  it('rejects a speed that is not one of the three', () => {
    // The value indexes a multiplier table; an unknown key there is
    // `undefined * a number`, which is NaN, which is a pause that never ends.
    const { hub } = seated();
    for (const bad of ['turbo', '', 2, null]) {
      const out = hub.handle('a', { t: 'speed', value: bad } as never, 0);
      expect(out.map((e) => e.msg.t), String(bad)).toEqual(['error']);
    }
  });

  it('hands the role on when the host goes, with no vote', () => {
    // A room whose host has left is a room nobody can change the speed of.
    const { hub } = seated();
    const out = hub.disconnect('a', 1000);
    const told = out.filter((e) => e.msg.t === 'table' || e.msg.t === 'speed');
    expect(told.length).toBeGreaterThan(0);

    // Bo can now set it, and is told so.
    const now = hub.handle('b', { t: 'speed', value: 'fast' }, 2000);
    expect(now.some((e) => e.msg.t === 'error')).toBe(false);
    const m = now.find((e) => e.msg.t === 'speed')!.msg as
      Extract<Outbound, { t: 'speed' }>;
    expect(m.speed).toBe('fast');
    expect(m.you).toBe(true);
  });
});

describe('nothing lands behind an animation', () => {
  /** A three-chair table with one human and two bots, dealt. */
  function dealt(speed?: 'normal' | 'fast' | 'fastest') {
    const hub = new Hub({ newId: ids(), minGapMs: 1500, duskMs: 2400 });
    const made = hub.handle('a', { t: 'create', seats: 3, seed: 'lock' }, 0);
    const roomId = (made[0]!.msg as { roomId: string }).roomId;
    hub.handle('a', { t: 'join', roomId, name: 'Ada' }, 0);
    hub.handle('a', { t: 'seat', index: 1, kind: 'bot' }, 0);
    hub.handle('a', { t: 'seat', index: 2, kind: 'bot' }, 0);
    if (speed) hub.handle('a', { t: 'speed', value: speed }, 0);
    hub.handle('a', { t: 'begin', marked: true }, 0);
    return { hub, roomId };
  }

  const hasDuskIn = (out: Envelope[]) =>
    out.some((e) => e.msg.t === 'state'
      && (e.msg as { events: { t: string; phase?: string }[] }).events
        .some((ev) => ev.t === 'PHASE' && ev.phase === 'dusk'));

  /**
   * Push the table until a Dusk lands, and say when.
   *
   * `tick` only moves bots, so the human seat has to be driven too or the
   * round never finishes and no Dusk ever arrives.
   */
  function untilDusk(hub: Hub, from: number): number {
    for (let t = from; t < from + 600_000; t += 250) {
      if (hasDuskIn(hub.tick(t))) return t;
      // Ends the human's turn whenever it is theirs; refused otherwise, and a
      // refusal is exactly what we want to ignore here.
      if (hasDuskIn(hub.handle('a', { t: 'command', command: { t: 'END_TURN' } }, t))) {
        return t;
      }
    }
    throw new Error('no Dusk');
  }

  it('refuses a human command while the sun is going down', () => {
    const { hub } = dealt();
    const at = untilDusk(hub, 0);

    // Mid-animation: refused, and told why rather than silently dropped.
    const during = hub.handle('a', { t: 'command', command: { t: 'END_TURN' } }, at + 500);
    expect(during.map((e) => e.msg.t)).toEqual(['error']);
    expect((during[0]!.msg as { message: string }).message)
      .toBe('Wait for the light to change');

    // After it, the refusal is gone — whatever the rules then say.
    const after = hub.handle('a', { t: 'command', command: { t: 'END_TURN' } }, at + 3000);
    const msg = after[0]!.msg as { t: string; message?: string };
    expect(msg.message).not.toBe('Wait for the light to change');
  });

  it('holds the bots for the same length, not a different one', () => {
    // One number feeds both, so they cannot drift apart.
    const { hub } = dealt();
    const at = untilDusk(hub, 0);
    expect(hub.tick(at + 500).some((e) => e.msg.t === 'state')).toBe(false);
    expect(hub.tick(at + 1200).some((e) => e.msg.t === 'state')).toBe(false);
  });

  it('does not shorten the hold at fastest', () => {
    // Speed is how fast bots think, not how fast the sun goes down. At 0.15 a
    // scaled hold left about a second for a multi-second animation, which does
    // not make the game quicker — it makes the client outlast the server.
    const { hub } = dealt('fastest');
    const at = untilDusk(hub, 0);
    const during = hub.handle('a', { t: 'command', command: { t: 'END_TURN' } }, at + 900);
    expect((during[0]!.msg as { message?: string }).message)
      .toBe('Wait for the light to change');
  });
});

describe('closing the table', () => {
  function seated2() {
    const hub = new Hub({ newId: ids() });
    const made = hub.handle('a', { t: 'create', seats: 3, seed: 'cls' }, 0);
    const roomId = (made[0]!.msg as { roomId: string }).roomId;
    hub.handle('a', { t: 'join', roomId, name: 'Ada' }, 0);
    hub.handle('b', { t: 'join', roomId, name: 'Bo' }, 0);
    return { hub, roomId };
  }

  it('tells everyone, then forgets the room', () => {
    // Told BEFORE anything is deleted — once the room is gone so is the
    // connection map, and there is nobody left to tell.
    const { hub, roomId } = seated2();
    const out = hub.handle('a', { t: 'close' }, 0);
    expect(out.map((e) => e.conn).sort()).toEqual(['a', 'b']);
    for (const e of out) expect(e.msg.t).toBe('closed');
    expect(hub.room(roomId)).toBeUndefined();
  });

  it('refuses anyone who is not the host', () => {
    const { hub, roomId } = seated2();
    const out = hub.handle('b', { t: 'close' }, 0);
    expect(out.map((e) => e.msg.t)).toEqual(['error']);
    expect((out[0]!.msg as { message: string }).message)
      .toBe('Only the host closes the room');
    expect(hub.room(roomId), 'the table went anyway').toBeDefined();
  });

  it('leaves no seat anybody can reclaim', () => {
    // The tokens go with the room, so a rejoin finds "No such room" rather
    // than an empty chair at a game that has ended.
    const { hub, roomId } = seated2();
    hub.handle('a', { t: 'close' }, 0);
    const back = hub.handle('c', { t: 'rejoin', roomId, token: 'id-0' }, 0);
    expect(back.map((e) => e.msg.t)).toEqual(['error']);
  });

  it('is not what `leave` does — one seat, table stands', () => {
    const { hub, roomId } = seated2();
    hub.handle('a', { t: 'leave' }, 0);
    expect(hub.room(roomId), 'leaving closed the table').toBeDefined();
  });
});
