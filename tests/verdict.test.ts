// Whether YOU won, which is not the same question as which side did.
//
// `winner` is a SIDE — 'posse' | 'oldOne' — and three seats at a losing table
// are on the winning one: the Marked player, the Vessel, and anybody who fell.
// The screen used to print "The long noon" to a traitor who had just pulled it
// off and leave them to work it out.

import { describe, it, expect } from 'vitest';
import { setup, start } from '../engine';
import { playerView, type ClientState } from '../engine/view';
import { wonWith } from '../client/src/verdict';
import type { PlayerId } from '../engine/state';

/** A finished game, with `who` put into `status` and `role`. */
function ended(
  winner: 'posse' | 'oldOne',
  as: { status?: ClientState['you'] extends null ? never : string; marked?: boolean } = {},
): ClientState {
  const s = start(setup({
    seed: 'verdict', players: ['Ada', 'Bo', 'Cy'], markedIndex: null,
  })).state;
  const me = s.turnOrder[0] as PlayerId;
  s.winner = winner;
  s.revealedRoles = [...s.turnOrder];
  if (as.marked) s.players[me].role = 'marked';
  if (as.status) {
    s.players[me].status = as.status as 'revenant';
    if (as.status === 'vessel') s.vessel = me;
  }
  return playerView(s, me);
}

describe('who won, from where you were sitting', () => {
  it('the faithful posse wins with the town', () => {
    expect(wonWith(ended('posse'))).toBe(true);
    expect(wonWith(ended('oldOne'))).toBe(false);
  });

  it('the Marked player wins with the Old One', () => {
    // The one the old screen got backwards, and the one it mattered most for.
    expect(wonWith(ended('oldOne', { marked: true }))).toBe(true);
    expect(wonWith(ended('posse', { marked: true }))).toBe(false);
  });

  it('the Vessel is that side', () => {
    expect(wonWith(ended('oldOne', { status: 'vessel' }))).toBe(true);
    expect(wonWith(ended('posse', { status: 'vessel' }))).toBe(false);
  });

  it('a Revenant wins if and only if the Vessel does', () => {
    expect(wonWith(ended('oldOne', { status: 'revenant' }))).toBe(true);
    expect(wonWith(ended('posse', { status: 'revenant' }))).toBe(false);
  });

  it('and so does a seat that burned out — only a Revenant can', () => {
    expect(wonWith(ended('oldOne', { status: 'gone' }))).toBe(true);
    expect(wonWith(ended('posse', { status: 'gone' }))).toBe(false);
  });

  it('a Marked player who ends up as the Vessel still wins with them', () => {
    // Two reasons to be on that side is not a contradiction.
    expect(wonWith(ended('oldOne', { marked: true, status: 'vessel' }))).toBe(true);
  });
});
