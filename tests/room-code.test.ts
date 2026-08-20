// The room code is now in two places — the address bar and the socket — and the
// bug being guarded against is those two disagreeing.
//
// The report was "the url reads one room code and the room i opened has
// another". The cause was `history.replaceState` inside a `useState`
// initializer: a side effect during render, which StrictMode runs twice, so the
// code was derived independently for the URL and for the socket with nothing
// keeping them equal.

import { describe, it, expect } from 'vitest';
import { roomFor, joinPlan } from '../client/src/net';

describe('choosing a room', () => {
  it('uses the code in the URL when there is one', () => {
    expect(roomFor('?room=abc123')).toEqual({ room: 'abc123', fromUrl: true });
  });

  it('is pure — asking twice never invents a second room', () => {
    // The StrictMode case. Two invocations of the same decision against the
    // same URL must agree, whatever else happens around them.
    const search = '?room=steady';
    expect(roomFor(search).room).toBe(roomFor(search).room);
  });

  it('makes a code only when the URL has none, and never navigates', () => {
    let made = 0;
    const r = roomFor('', () => `made-${++made}`);
    expect(r).toEqual({ room: 'made-1', fromUrl: false });
    // One generation per call, and no side effect to observe: if this function
    // wrote the URL, the second caller would see a different world.
    expect(made).toBe(1);
  });

  it('ignores an empty or whitespace room param rather than joining ""', () => {
    for (const search of ['?room=', '?room=%20%20']) {
      expect(roomFor(search, () => 'fresh').room).toBe('fresh');
    }
  });

  it('survives a URL carrying other params', () => {
    expect(roomFor('?debug=1&room=xyz&x=2').room).toBe('xyz');
  });
});

/*
  Sitting down in a room the socket is not open to.

  The report: "even if a new room id was entered, a player pressing join would
  join the original table from the url". The cause is that the room is part of
  the ADDRESS — one Durable Object per room — so the server takes it from the
  object the message reached and ignores the `roomId` field. A `join` sent down
  the socket the link opened is a join to the link's room, whatever it says.
*/
describe('sitting down', () => {
  it('sends straight away when it is the room you are already in', () => {
    expect(joinPlan('abc', 'abc')).toEqual({ room: 'abc', move: false });
  });

  it('moves the socket first when the code is a different room', () => {
    // `move` is the whole fix: false here would send the join down a socket
    // open to `abc` and seat the player at `abc`, silently.
    expect(joinPlan('abc', 'xyz')).toEqual({ room: 'xyz', move: true });
  });

  it('trims, so a pasted code with a space is not a different room', () => {
    expect(joinPlan('abc', '  abc  ')).toEqual({ room: 'abc', move: false });
  });

  it('does nothing at all with an empty code', () => {
    expect(joinPlan('abc', '')).toBeNull();
    expect(joinPlan('abc', '   ')).toBeNull();
  });
});
