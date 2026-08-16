import type { GameState, PlayerId, CardInstance, Role, Status } from './state';
import { signsHeld, deckSize } from './effects';

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
  whispers: number;
  whisperThreshold: number;
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
        role: revealed.has(id) || p.status === 'oldOne' ? p.role : null,
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
    doom: s.doom, doomTarget: s.tuning.doomTarget,
    vessel: s.vessel, vesselDamage: s.vesselDamage,
    street: s.street,
    provisionRow: s.supply.provisionRow,
    provisionsLeft: s.supply.provisions.length,
    pending: s.pending && s.pending.player === viewer ? s.pending : null,
    winner: s.winner,
    vesselClear: s.tuning.vesselClear,
    you: me ? {
      id: me.id, role: me.role, status: me.status,
      hand: me.hand, deckCount: me.deck.length, deck: sortedForReview(me.deck),
      discard: me.discard, boneyard: me.boneyard,
      scars: me.scars, grit: me.gritThisTurn,
    } : null,
    opponents,
  };
}

/** Canonical order — same multiset in, same array out, whatever the shuffle. */
function sortedForReview(deck: CardInstance[]): CardInstance[] {
  return [...deck].sort((a, b) =>
    a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1
    : Number(a.fevered) - Number(b.fevered));
}

export { deckSize };
