import type { GameState, PlayerId, PlayerState, Tuning, CardInstance } from './state';
import { TUNING, STARTING_DECK, PROVISION_COUNTS, TROUBLE_IDS, MYTHOS_IDS } from '../content/cards';
import { shuffle } from './rng';

export interface SetupOptions {
  seed: string;
  players: string[];
  tuning?: Partial<Tuning>;
  /** Omit to play with no traitor - the recommended first session. */
  markedIndex?: number | null;
}

export function setup(opts: SetupOptions): GameState {
  const tuning: Tuning = { ...TUNING, ...opts.tuning };
  let uid = 0;
  const mk = (cardId: string): CardInstance => ({ uid: `c${uid++}`, cardId, fevered: false });

  let cursor = 0;
  const players: Record<PlayerId, PlayerState> = {};
  const turnOrder: PlayerId[] = [];

  opts.players.forEach((name, i) => {
    const id = `p${i}`;
    turnOrder.push(id);
    // Chaff is armour when the deck is your health (DESIGN.md §5), so the
    // starting deck pads with Saddlebags rather than with anything useful.
    const ids = [...STARTING_DECK];
    while (ids.length < tuning.startingDeckSize) ids.push('saddlebag');
    ids.length = Math.min(ids.length, tuning.startingDeckSize);
    const r = shuffle(ids.map(mk), opts.seed, cursor);
    cursor = r.cursor;
    players[id] = {
      id, name,
      role: opts.markedIndex === i ? 'marked' : 'faithful',
      status: 'posse',
      deck: r.items, hand: [], discard: [], boneyard: [],
      scars: 0, gritThisTurn: 0,
    };
  });

  const provisionIds: string[] = [];
  for (const [id, n] of Object.entries(PROVISION_COUNTS)) {
    for (let i = 0; i < n; i++) provisionIds.push(id);
  }
  const provShuffle = shuffle(provisionIds.map(mk), opts.seed, cursor);
  cursor = provShuffle.cursor;
  // Shuffle first, then cut to size, so a smaller deck is a random subset
  // rather than a reordering of the same cards.
  const provisions = provShuffle.items.slice(0, tuning.provisionDeckSize);
  const provisionRow = provisions.splice(0, tuning.provisionRowSize);

  const troubleShuffle = shuffle(TROUBLE_IDS.map(mk), opts.seed, cursor);
  cursor = troubleShuffle.cursor;
  const mythosShuffle = shuffle(MYTHOS_IDS.map(mk), opts.seed, cursor);
  cursor = mythosShuffle.cursor;

  return {
    seed: opts.seed,
    rngCursor: cursor,
    round: 0,
    act: 'trouble',
    phase: 'dawn',
    turnOrder,
    activePlayer: turnOrder[0],
    actionsLeft: 0,
    whispers: 0,
    whisperFills: 0,
    doom: 0,
    vesselDamage: 0,
    shuttered: null,
    vessel: null,
    revealedRoles: [],
    street: new Array(tuning.streetSlots).fill(null),
    supply: {
      provisions,
      provisionRow,
      trouble: troubleShuffle.items,
      troubleDiscard: [],
      mythos: mythosShuffle.items,
      mythosDiscard: [],
    },
    players,
    handsRevealedTo: {},
    beckoned: null,
    nextTurnGrit: {},
    shields: {},
    pending: null,
    resolution: null,
    winner: null,
    tuning,
    uidCounter: uid,
    log: [],
  };
}
