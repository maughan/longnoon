// Which side a seat was on, kept out of the component so it can be tested.
//
// JSX-free on purpose: the root tsconfig compiles the tests and has no DOM.

import type { ClientState } from '../../engine/view';

/**
 * Did YOUR side win?
 *
 * `winner` is a SIDE, not a seat — `'posse' | 'oldOne'` — and which side you
 * were on is not where you were sitting:
 *
 *   - the Marked player wins if and only if the Old One's side does;
 *   - so does the Vessel, which is that side;
 *   - so does a Revenant, and so does a seat that burned out, because only a
 *     Revenant can: "a Revenant wins if and only if the Vessel wins".
 *
 * Everyone else wants the town to hold.
 */
export function wonWith(v: ClientState): boolean {
  const me = v.you!;
  const theirs =
    me.role === "marked"
    || me.status === "vessel"
    || me.status === "revenant"
    || me.status === "gone";
  return theirs ? v.winner === "oldOne" : v.winner === "posse";
}
