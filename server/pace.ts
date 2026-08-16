// How long the table needs to read what just happened.
//
// Bots act on a timer, and the timer has to be paid to whatever is worth
// watching. A bot spending a card for Grit says nothing; the same bot's END_TURN
// can bring on Dusk — three Threats menacing, three players losing cards, two
// arrivals — and pausing the same length after both is what makes a game feel
// simultaneously slow and unreadable.
//
// The client turns an event batch into sentences (`client/src/beats.ts`). This
// counts how many sentences that will be, without the server importing client
// code or knowing how any of them are worded. The two lists must agree, and
// `tests/narrate.test.ts` fails if they drift — the cost of drift is pacing, not
// correctness, which is why an approximation here is acceptable and a shared
// import would not be worth the coupling.

import type { GameEvent } from '../engine/state';

/** Events that begin a new sentence. */
const ANCHOR = new Set<GameEvent['t']>([
  'PLAYED', 'BOUGHT', 'BECKONED', 'TURNING', 'FELL', 'BURNED_OUT',
  'VESSEL_DAMAGE_RESET', 'GAME_OVER', 'MENACE', 'THREAT_ENTERED',
  'TOLL_PAID', 'SHUTTERED', 'OFFERED', 'WHISPER_FILL', 'NAME_READ',
]);

/** Events that extend the open sentence, or start one if none is open. */
const CLAUSE = new Set<GameEvent['t']>([
  'THREAT_DAMAGED', 'THREAT_CLEARED', 'VESSEL_DAMAGED', 'DAMAGED',
  'MENACE_CANCELLED', 'SHIELDED', 'PREVENTED', 'BOUNTY', 'LAST_WORDS',
  'SCRIED', 'WHISPERS', 'DOOM', 'OFFER_TAKEN',
]);

/** Whether the sun sets in this batch — one of two beats the client animates. */
export function hasDusk(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.t === 'PHASE' && e.phase === 'dusk');
}

/**
 * Whether Act I ends in this batch.
 *
 * The client gives this the whole screen for about three seconds. It happens
 * once a game, which is the only reason a pause that long is affordable.
 */
export function hasTurning(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.t === 'TURNING');
}

/**
 * How many sentences this batch is worth.
 *
 * `turnChanged` covers the one beat with no event behind it: whose turn it is
 * now.
 */
export function beatsIn(events: readonly GameEvent[], turnChanged: boolean): number {
  let n = 0;
  let open = false;
  for (const e of events) {
    if (ANCHOR.has(e.t)) { n += 1; open = true; continue; }
    if (e.t === 'PHASE') {
      if (e.phase === 'dusk') { n += 1; open = true; }
      continue;
    }
    if (CLAUSE.has(e.t) && !open) { n += 1; open = true; }
  }
  // Nobody's turn is announced after the game ends, so a batch that finishes it
  // does not get the extra beat however the active player moved.
  const over = events.some((e) => e.t === 'GAME_OVER');
  return n + (turnChanged && !over ? 1 : 0);
}
