import type { GameState, Command, PlayerId } from './state';
import { card, SIGN_IDS } from '../content/cards';
import { canPay, shuttered, opsFor } from './effects';

// `shuttered` lives in effects.ts now, because the `shutter` OP needs it and
// effects.ts cannot import from legal.ts. Re-exported so every existing import
// still resolves.
export { shuttered };

/**
 * The twofer: this drives button-disabling in React AND defines the action
 * space for simulator bots. One function, two consumers, no drift.
 */
export function legalCommands(s: GameState, pid: PlayerId): Command[] {
  if (s.winner) return [];

  if (s.pending) {
    if (s.pending.player !== pid) return [];
    return s.pending.options.map((o) => ({
      t: 'RESOLVE_CHOICE' as const, choiceId: s.pending!.id, picks: [o.key],
    }));
  }

  const out: Command[] = [];
  const p = s.players[pid];

  if (pid !== s.activePlayer) return out;
  // The gone can do nothing but yield — a Revenant may burn out mid-turn, and
  // the game must never be left with no legal move at all.
  if (p.status === 'gone') return [{ t: 'END_TURN' }];

  const hasAction = s.actionsLeft > 0;

  for (const ci of p.hand) {
    /*
      A shuttered type is not offered. Enforced here rather than in `apply` so
      a client can draw the card as unplayable — finding out by having a
      command rejected is the interface explaining the rules after the fact.

      Nor is a card with nothing to do. A Saddlebag played is an action spent
      to move a card from one pile to another, and offering it made the Street
      a legal drop target for a card that cannot affect the Street. Six cards
      are inert this way: saddlebag, grubstake, hard-tack, bank-draft, the
      Scar, and last-words — whose effect fires from the deck when you would
      fall, never from being played.

      Here rather than in the client, because `legalCommands` is the single
      source of truth for what is possible: blocking the drop in React would
      leave `apply` still accepting it, which is the drift tech-spec.md §4
      exists to prevent.
    */
    const does = opsFor(card(ci.cardId), ci.fevered).length > 0;
    if (hasAction && does && !shuttered(s, card(ci.cardId).type)) {
      out.push({ t: 'PLAY_CARD', uid: ci.uid });
    }
    /*
      Cashing in is not playing. A closed door on Signs should not also stop
      you selling one for the Grit to buy something else.

      Not the Vessel, though. Grit buys from the market and the Vessel cannot
      buy, so cashing in would be turning cards into a currency with nothing
      to spend it on — a live button that does nothing, which is worse than no
      button. It also takes the market and the counter off that seat's screen
      entirely: what is left is play a card and end your turn.
    */
    if (p.status !== 'vessel' && card(ci.cardId).grit > 0) {
      out.push({ t: 'SPEND_GRIT', uids: [ci.uid] });
    }
  }

  // A Toll is the answer to a slot nothing can shoot, and is only offered when
  // the player can actually meet it.
  if (hasAction && p.status === 'posse') {
    s.street.forEach((sl, i) => {
      const toll = sl && card(sl.instance.cardId).toll;
      if (toll?.length && canPay(s, pid, toll)) out.push({ t: 'PAY_TOLL', slot: i });
    });
  }

  if (hasAction && p.status === 'posse') {
    for (const ci of s.supply.provisionRow) {
      const def = card(ci.cardId);
      if ((def.cost ?? 99) <= p.gritThisTurn) out.push({ t: 'BUY', cardId: def.id });
    }
    for (const id of SIGN_IDS) {
      if ((card(id).cost ?? 99) <= p.gritThisTurn) out.push({ t: 'BUY', cardId: id });
    }
  }

  // The fallen: Whisper — discard a card off your own dwindling deck for a
  // Whisper. Beckoning is a card in the same hand and goes through PLAY_CARD.
  if (hasAction && p.status === 'revenant') {
    for (const ci of p.hand) {
      // Not the granted card. It is not theirs to spend, and offering it would
      // let a Revenant trade the one thing they are given for a Whisper.
      if (card(ci.cardId).type === 'revenant') continue;
      out.push({ t: 'REVENANT_WHISPER', uid: ci.uid });
    }
  }

  out.push({ t: 'END_TURN' });
  return out;
}

/**
 * Server gate: is this command one the rules actually offer right now?
 *
 * `apply` validates each command's own preconditions, but tech-spec.md §4 is
 * explicit that a server must assume clients send illegal input — and this is a
 * hidden-role game, so the one player most motivated to try is the one you least
 * want succeeding. Check every inbound command through here before `apply`.
 *
 * Two commands are compared structurally rather than by equality, because
 * `legalCommands` enumerates them one option at a time:
 *   SPEND_GRIT    — listed per card; a client may legitimately cash several.
 *   RESOLVE_CHOICE — listed per option; a choice may allow several picks.
 */
export function isLegal(s: GameState, pid: PlayerId, c: Command): boolean {
  const legal = legalCommands(s, pid);

  if (c.t === 'SPEND_GRIT') {
    const allowed = new Set(
      legal.flatMap((l) => (l.t === 'SPEND_GRIT' ? l.uids : [])),
    );
    return (
      c.uids.length > 0 &&
      new Set(c.uids).size === c.uids.length &&
      c.uids.every((u) => allowed.has(u))
    );
  }

  if (c.t === 'RESOLVE_CHOICE') {
    const picks = new Set(
      legal.flatMap((l) => (l.t === 'RESOLVE_CHOICE' ? l.picks : [])),
    );
    const min = s.pending?.min ?? 1;
    const max = s.pending?.max ?? 1;
    return (
      c.choiceId === s.pending?.id &&
      c.picks.length >= min && c.picks.length <= max &&
      new Set(c.picks).size === c.picks.length &&
      c.picks.every((p) => picks.has(p))
    );
  }

  const key = canonical(c);
  return legal.some((l) => canonical(l) === key);
}

/** Key-order-independent comparison — a client controls its own JSON. */
function canonical(c: Command): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : 1))),
  );
}
