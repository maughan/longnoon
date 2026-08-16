import type { GameState, PlayerId, CardInstance, Role, Status } from './state';
import { signsHeld, deckSize, doomForFill } from './effects';

export interface OpponentView {
  id: PlayerId;
  name: string;
  status: Status;
  role: Role | null;
  handCount: number;
  deckCount: number;
  discard: CardInstance[];
  boneyard: CardInstance[];
  scars: number;
  signsHeld: number;
  /** Present only if this opponent's hand was revealed to the viewer. */
  hand?: CardInstance[];
}

export interface ClientState {
  viewer: PlayerId | 'spectator';
  round: number;
  act: GameState['act'];
  phase: GameState['phase'];
  activePlayer: PlayerId;
  actionsLeft: number;
  /** The Whisper bar. Always in `[0, whisperThreshold)`. */
  whispers: number;
  /** Where the bar tops out. The same in both acts, deliberately. */
  whisperThreshold: number;
  /** How many times it has filled in Act II. Zero before the Turning. */
  whisperFills: number;
  /**
   * What the NEXT fill will cost, already worked out.
   *
   * Sent rather than left to the client to derive from `doomPerFill +
   * whisperFills * doomPerFillStep`. A client deriving a rule is the drift
   * tech-spec.md §4 exists to prevent, and the escalation is precisely the
   * thing the bar needs to say out loud.
   */
  nextFillDoom: number;
  doom: number;
  doomTarget: number;
  vessel: PlayerId | null;
  vesselDamage: number;
  /**
   * How much damage buries the Vessel.
   *
   * Public, like every other threshold here — it is printed on the Vessel card
   * at a real table. It is on the view because the client had no way to know it
   * and was showing a hardcoded 16 against a real value of 31: a player could
   * fill the burial track, see 16/16, and watch nothing happen.
   */
  vesselClear: number;
  /**
   * What an Omen menaces for.
   *
   * Omens print 0 and take their real value from TUNING, so a client without
   * this draws every Omen as harmless. Public, like every other threshold here.
   */
  omenMenace: number;
  /**
   * How many cards a full hand is.
   *
   * Public, and needed to tell a whole hand being dealt from a card being
   * drawn mid-turn — a distinction the client would otherwise have to make
   * with a magic 5.
   */
  handSize: number;
  street: GameState['street'];
  provisionRow: CardInstance[];
  provisionsLeft: number;
  pending: GameState['pending'];
  winner: GameState['winner'];
  you: {
    id: PlayerId; role: Role; status: Status;
    hand: CardInstance[]; deckCount: number;
    /**
     * What is in your deck, but never the order.
     *
     * The contents are your own information — you bought those cards, and a
     * deck builder is unplayable if you cannot review what you built. The order
     * is a different matter: it is the shuffle, and knowing your next draw would
     * be an enormous advantage. So this is sorted into a canonical order that
     * carries no trace of the real one.
     */
    deck: CardInstance[];
    discard: CardInstance[]; boneyard: CardInstance[];
    scars: number; grit: number;
  } | null;
  opponents: OpponentView[];
}

/**
 * The server sends THIS, never GameState. Not even temporarily for debugging -
 * hidden-role games leak through devtools.
 */
export function playerView(s: GameState, viewer: PlayerId | 'spectator'): ClientState {
  const revealed = new Set(s.revealedRoles);

  const opponents: OpponentView[] = s.turnOrder
    .filter((id) => id !== viewer)
    .map((id) => {
      const p = s.players[id];
      return {
        id, name: p.name, status: p.status,
        // Role visibility is derived, never a mutation - or replays break.
        role: revealed.has(id) || p.status === 'vessel' ? p.role : null,
        handCount: p.hand.length,
        deckCount: p.deck.length,
        discard: p.discard,
        boneyard: p.boneyard,
        scars: p.scars,
        signsHeld: signsHeld(s, id),
        hand: (s.handsRevealedTo[id] ?? []).includes(viewer as PlayerId)
          ? p.hand : undefined,
      };
    });

  const me = viewer !== 'spectator' ? s.players[viewer] : null;

  return {
    viewer,
    round: s.round, act: s.act, phase: s.phase,
    activePlayer: s.activePlayer, actionsLeft: s.actionsLeft,
    whispers: s.whispers, whisperThreshold: s.tuning.whisperThreshold,
    whisperFills: s.whisperFills,
    nextFillDoom: doomForFill(s, s.whisperFills + 1),
    doom: s.doom, doomTarget: s.tuning.doomTarget,
    vessel: s.vessel, vesselDamage: s.vesselDamage,
    street: s.street,
    provisionRow: s.supply.provisionRow,
    provisionsLeft: s.supply.provisions.length,
    pending: s.pending && s.pending.player === viewer ? s.pending : null,
    winner: s.winner,
    vesselClear: s.tuning.vesselClear,
    omenMenace: s.tuning.omenMenace,
    handSize: s.tuning.handSize,
    you: me ? {
      id: me.id, role: me.role, status: me.status,
      hand: me.hand, deckCount: me.deck.length, deck: sortedForReview(me.deck),
      discard: me.discard, boneyard: me.boneyard,
      scars: me.scars, grit: me.gritThisTurn,
    } : null,
    opponents,
  };
}

/**
 * Canonical order — same multiset in, same array out, whatever the shuffle.
 *
 * The `uid` tiebreak is the load-bearing line, and it was missing.
 *
 * `Array.prototype.sort` is stable, so two cards that compare equal keep their
 * INPUT order — and a deck is mostly duplicates. Sorting on cardId and fevered
 * alone therefore left every run of identical cards sitting in shuffle order,
 * which is a trace of exactly the thing this function exists to destroy. It
 * survived review because the array looks perfectly sorted; only a permutation
 * test can see it, and the test that claimed to cover this only ever checked
 * that OPPONENTS' decks were absent.
 *
 * `uid` is assigned by a counter when the card is created, so it is stable
 * across shuffles and cannot carry one. Compared as a string, which is not
 * creation order once the counter passes 9 — that does not matter, only that
 * it is a total order fixed independently of the deck.
 */
function sortedForReview(deck: CardInstance[]): CardInstance[] {
  return [...deck].sort((a, b) =>
    (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0)
    || Number(a.fevered) - Number(b.fevered)
    || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

export { deckSize };
