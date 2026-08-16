// What each seat is allowed to be told.
//
// `playerView` guards the *state* a client receives (invariant 3). Events are
// the other half: a server broadcasting the raw `GameEvent[]` would leak through
// the log even though every view was clean. Most events describe public facts —
// the boneyard is face up, hand counts are visible, roles reveal at the Turning
// — so the list of exceptions is short, and it is meant to stay short.

import type { GameEvent, PlayerId } from '../engine/state';

/**
 * Events only their actor may see.
 *
 * `SCRIED` names the card the scryer pushed to the top of the Threat deck. They
 * paid a Sign to look; telling the table what is coming next hands that away for
 * free — and in a hidden-role game, knowing who knows is worth as much as the
 * card.
 */
function isPrivate(e: GameEvent): boolean {
  return e.t === 'SCRIED';
}

function actorOf(e: GameEvent): PlayerId | null {
  return 'player' in e ? e.player : null;
}

/** The subset of `events` that `viewer` may be told about. */
export function visibleEvents(
  events: readonly GameEvent[], viewer: PlayerId | 'spectator',
): GameEvent[] {
  return events.filter((e) => !isPrivate(e) || actorOf(e) === viewer);
}
