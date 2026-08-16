// Saying what just happened, out loud.
//
// The event log is a record; it is not a narrator. Reading "p2 played colt" in a
// side rail after the fact is not the same as being told, at the moment it
// lands, that Bot 2 fired the Colt and the Cattle Baron's Men went down. Bots
// move on a 900ms pace, so without this the table appears to rearrange itself.
//
// A "beat" is one batch of events turned into one sentence. Batches arrive one
// action at a time (GameRoom.stepBot plays exactly one), so a batch IS a beat —
// an anchor event supplies the headline and everything after it becomes the
// clause underneath.

import { card } from '../../content/cards';
import type { IconName } from './components/iconsgen';
import { iconForCard } from './icons';
import type { GameEvent, PlayerId } from '../../engine/state';
import type { ClientState } from '../../engine/view';

export interface Beat {
  id: number;
  kind: 'turn' | 'act' | 'dire' | 'omen' | 'dusk';
  title: string;
  detail?: string;
  /** What just happened, as a mark. Absent when nothing fits — most turns. */
  icon?: IconName;
  /**
   * Produced by a Dusk batch.
   *
   * Still narrated, because the chronicle wants every line — but not shown in
   * the ticker, where it would repeat the Dusk report one sentence at a time
   * behind the report itself.
   */
  fromDusk?: boolean;
}

/** Who, from where you are sitting. Subject position, so capitalised. */
export function nameOf(v: ClientState, id: PlayerId, seat: PlayerId | null): string {
  if (id === seat) return 'You';
  return v.opponents.find((o) => o.id === id)?.name ?? id;
}

/** The same person, mid-sentence — "menaces you", not "menaces You". */
const whom = (v: ClientState, id: PlayerId, seat: PlayerId | null) =>
  (id === seat ? 'you' : nameOf(v, id, seat));

const verb = (who: string, third: string, first: string) =>
  (who === 'You' ? first : third);

/**
 * The Threat in a slot, named.
 *
 * The view arrives AFTER the events, so a Threat that was cleared is no longer
 * standing there — the clearing event is the only thing that still knows its
 * name. Look there first.
 */
function threatIn(slot: number, v: ClientState, batch: readonly GameEvent[]): string {
  for (const e of batch) {
    if ((e.t === 'THREAT_CLEARED' || e.t === 'THREAT_ENTERED') && e.slot === slot) {
      return card(e.cardId).name;
    }
  }
  const here = v.street[slot];
  return here ? card(here.instance.cardId).name : 'a Threat';
}

/** Events that start a new sentence rather than extending the last one. */
function anchor(e: GameEvent, v: ClientState, seat: PlayerId | null): Beat | null {
  const who = 'player' in e ? nameOf(v, e.player, seat) : '';
  switch (e.t) {
    case 'PLAYED':
      return {
        id: 0, kind: e.fevered ? 'omen' : 'act', icon: iconForCard(card(e.cardId), e.fevered),
        // No "(Fevered)" gloss: after the Turning every Sign is, so saying it
        // every time is noise. The colour of the beat carries it.
        title: `${who} ${verb(who, 'plays', 'play')} ${card(e.cardId).name}`,
      };
    case 'BOUGHT':
      return { id: 0, kind: 'act', icon: iconForCard(card(e.cardId)),
        title: `${who} ${verb(who, 'buys', 'buy')} ${card(e.cardId).name}` };
    case 'TOLL_PAID':
      return { id: 0, kind: 'omen', icon: 'grave',
        title: `${who} ${verb(who, 'pays', 'pay')} the price of ${card(e.cardId).name}` };
    case 'SHUTTERED':
      return { id: 0, kind: 'omen', icon: 'omen',
        title: `The way to your ${e.cardType} is shut` };
    case 'OFFERED':
      return { id: 0, kind: 'omen', icon: 'sign',
        title: `Something offers ${nameOf(v, e.target, seat)} ${card(e.cardId).name}` };
    case 'BECKONED':
      return {
        id: 0, kind: 'omen', icon: 'revenant',
        title: `${nameOf(v, e.by, seat)} beckons ${nameOf(v, e.target, seat)}`,
      };
    case 'TURNING':
      return {
        id: 0, kind: 'omen', icon: 'fevered',
        title: 'The Turning',
        detail: `${nameOf(v, e.vessel, seat)} ${e.vessel === seat ? 'are' : 'is'} the Vessel`,
      };
    case 'FELL':
      return { id: 0, kind: 'dire', icon: 'grave',
        title: `${who} ${verb(who, 'falls', 'fall')}`,
        detail: `They do not leave — a ${e.became}` };
    case 'BURNED_OUT':
      return { id: 0, kind: 'dire', icon: 'grave',
        title: `${who} ${verb(who, 'is', 'are')} gone for good` };
    case 'VESSEL_DAMAGE_RESET':
      return { id: 0, kind: 'omen', icon: 'omen', title: 'An Omen arrives',
        detail: `${e.lost} of the burial undone` };
    case 'GAME_OVER':
      return { id: 0, kind: 'dire', icon: e.winner === 'posse' ? 'vessel' : 'doom',
        title: e.winner === 'posse' ? 'The town holds' : 'The long noon' };
    case 'PHASE':
      return e.phase === 'dusk'
        // Its own kind, not just a dire one: the sun setting is the animation,
        // and everything Dusk does to the table follows it.
        ? { id: 0, kind: 'dusk', title: 'Dusk', detail: 'the Street collects' }
        : null;
    // At Dusk these arrive in a heap. Each is its own sentence, or the beat
    // becomes a paragraph nobody reads.
    case 'MENACE':
      // The event names its own card: at Dusk a Threat can menace and then be
      // shoved out of its slot by the next arrival, so neither the view nor the
      // batch can be trusted to say who did it.
      return { id: 0, kind: 'dire', icon: 'menace',
        title: `${card(e.cardId).name} menaces ${whom(v, e.player, seat)}` };
    case 'THREAT_ENTERED':
      return { id: 0, kind: card(e.cardId).type === 'omen' ? 'omen' : 'act',
        icon: iconForCard(card(e.cardId)),
        title: `${card(e.cardId).name} enters the Street` };
    // Its own sentence. Left as a clause it would hang off whatever card
    // happened to tip it — and the bar filling is bigger news than the card.
    /*
      NAME_READ carries a cardId ONLY when the Sign resolved. A read that found
      nothing is still announced — the table watched it happen and the tension
      is the point — but it names no card, because there is none to name that
      anybody is entitled to.
    */
    case 'NAME_READ':
      return e.resolved && e.cardId
        ? { id: 0, kind: 'dire', icon: 'vessel',
            title: `It remembers ${whom(v, e.player, seat)}`,
            detail: `${card(e.cardId).name} turns on ${
              seat === e.player ? 'you' : 'them'}` }
        : { id: 0, kind: 'dire', icon: 'vessel',
            title: `It remembers ${whom(v, e.player, seat)}`,
            detail: 'and finds nothing it wants' };
    case 'WHISPER_FILL':
      return { id: 0, kind: 'dire', icon: 'whisper',
        title: `The whispering breaks over — Doom +${e.doom}` };
    default:
      return null;
  }
}

/** Everything else: a clause hung off whatever sentence is open. */
function clause(
  e: GameEvent, v: ClientState, seat: PlayerId | null, batch: readonly GameEvent[],
): string | null {
  const who = 'player' in e ? nameOf(v, e.player, seat) : '';
  const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
  switch (e.t) {
    case 'THREAT_DAMAGED': return `${e.amount} damage to ${threatIn(e.slot, v, batch)}`;
    case 'THREAT_CLEARED': return `${card(e.cardId).name} cleared`;
    case 'VESSEL_DAMAGED': return `${e.amount} into the Vessel — ${e.total} buried`;
    case 'DAMAGED': return `${who} ${verb(who, 'loses', 'lose')} ${cards(e.amount)}`;
    case 'MENACE_CANCELLED': return `${threatIn(e.slot, v, batch)} silenced`;
    case 'SHIELDED': return `${whom(v, e.player, seat)} warded for ${e.amount}`;
    case 'PREVENTED': return `${e.amount} damage prevented`;
    case 'BOUNTY': return `${who} ${verb(who, 'collects', 'collect')} a Bounty`;
    case 'LAST_WORDS': return `Last Words — ${who} ${verb(who, 'keeps', 'keep')} ${e.kept}`;
    case 'SCRIED': return `${card(e.cardId).name} steered to the top`;
    case 'OFFER_TAKEN':
      return `${who} ${verb(who, 'takes', 'take')} the gift — Whispers +${e.whispers}`;
    case 'WHISPERS': case 'DOOM': return null;   // summed per beat, see narrate
    default: return null;   // DREW, GRIT, CHOICE_REQUIRED — not worth a sentence
  }
}

/**
 * One batch of events, and the turn change it may have caused, as beats.
 *
 * `next` is a counter the caller owns, so beats keep stable React keys without
 * a clock or a random id.
 */
export function narrate(
  events: readonly GameEvent[],
  v: ClientState,
  seat: PlayerId | null,
  prevActive: PlayerId | null,
  next: () => number,
): Beat[] {
  const out: Beat[] = [];
  let open: Beat | null = null;
  let clauses: string[] = [];
  let whispers = 0;
  let doom = 0;
  let total = 0;
  /** Set when the only thing that happened was a track moving. */
  let bare: 'Whispers' | 'Doom' | null = null;

  const close = () => {
    if (!open) return;
    if (bare) {
      // Doom climbing on its own happens several rounds running. The delta
      // alone reads as the same sentence repeated; the running total does not.
      const n = bare === 'Doom' ? doom : whispers;
      out.push({ ...open, title: `${bare} ${n > 0 ? '+' : ''}${n}`,
        detail: `${total} in all` });
    } else {
      // A card that whispers twice whispered twice; it did not do two things.
      if (whispers) clauses.push(`Whispers ${whispers > 0 ? '+' : ''}${whispers}`);
      if (doom) clauses.push(`Doom ${doom > 0 ? '+' : ''}${doom}`);
      const extra = [...new Set(clauses.filter(Boolean))].join(' · ');
      out.push({
        ...open,
        detail: [open.detail, extra].filter(Boolean).join(' · ') || undefined,
      });
    }
    open = null;
    clauses = [];
    whispers = 0;
    doom = 0;
    total = 0;
    bare = null;
  };

  for (const e of events) {
    if (e.t === 'WHISPERS' || e.t === 'DOOM') {
      // Track deltas even with no sentence open — a round of pure Doom still
      // needs announcing.
      if (!open) {
        open = { id: next(), kind: 'dire', title: '',
          icon: e.t === 'DOOM' ? 'doom' : 'whisper' };
        bare = e.t === 'DOOM' ? 'Doom' : 'Whispers';
      }
      if (e.t === 'DOOM') doom += e.delta; else whispers += e.delta;
      total = e.total;
      continue;
    }
    const head = anchor(e, v, seat);
    if (head) { close(); open = { ...head, id: next() }; bare = null; continue; }
    const line = clause(e, v, seat, events);
    if (!line) continue;
    // An effect with no action in front of it still deserves saying — a target
    // chosen through a prompt resolves in its own batch, after the card that
    // asked. It is a sentence now, so it starts with a capital.
    if (!open) {
      open = { id: next(), kind: 'act', title: line[0].toUpperCase() + line.slice(1) };
    }
    else { clauses.push(line); bare = null; }
  }
  close();

  if (v.activePlayer !== prevActive && !v.winner) {
    const who = nameOf(v, v.activePlayer, seat);
    out.push({
      id: next(), kind: 'turn',
      title: who === 'You' ? 'Your turn' : `${who}'s turn`,
      detail: who === 'You' ? `${v.actionsLeft} actions` : undefined,
    });
  }
  if (events.some((e) => e.t === 'PHASE' && e.phase === 'dusk')) {
    // Whose turn it is survives: the report says what the night cost, and then
    // the ticker says who is up. Everything else is in the report already.
    for (const b of out) if (b.kind !== 'turn') b.fromDusk = true;
  }
  return out;
}

/**
 * "first", "second", "third"... falling back to "7th" past the point where a
 * word is shorter than the numeral.
 */
function ordinal(n: number): string {
  const words = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  if (words[n]) return words[n]!;
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? 'th'
    : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** One line of table talk per event, for the chronicle. */
export function describe(
  e: GameEvent, v: ClientState | null, seat: PlayerId | null,
): string {
  if (!v) return e.t.toLowerCase().replace(/_/g, ' ');
  // The chronicle keeps every tick of the tracks; only the spoken beat merges
  // them, and only because a card that whispers twice is still one action.
  // Chronicle only, all of these. They happen several times a turn, so a beat
  // apiece would crowd out the moves that actually decide anything — but the
  // log is a record, and a record that says "grit" is not one.
  if (e.t === 'GRIT') {
    const who = nameOf(v, e.player, seat);
    const verb = who === 'You' ? 'cash' : 'cashes';
    if (e.cards?.length) {
      // Named, because which card you gave up is the whole decision: a
      // Saddlebag costs nothing, a Sign costs you the Sign.
      const what = e.cards.length === 1
        ? card(e.cards[0]!).name
        : `${e.cards.length} cards`;
      return `${who} ${verb} in ${what} for ${e.amount} Grit`;
    }
    return `${who} ${who === 'You' ? 'take' : 'takes'} ${e.amount} Grit`;
  }
  if (e.t === 'DREW') {
    const who = nameOf(v, e.player, seat);
    return `${who} ${who === 'You' ? 'draw' : 'draws'} ${e.n} card${
      e.n === 1 ? '' : 's'}`;
  }
  if (e.t === 'RESHUFFLED') {
    return `${nameOf(v, e.player, seat)} shuffles ${e.n} back under`;
  }
  if (e.t === 'ESCALATED') {
    // The Dusk report shows this too, but the chronicle is the only place to
    // look up when a Threat got as bad as it is.
    return `${card(e.cardId).name} is worse for having been left`
      + ` — Clear ${e.clear ?? '—'}, Menace ${e.menace}`;
  }
  if (e.t === 'PHASE') {
    return e.phase === 'dusk'
      ? `Dusk falls on round ${e.round}`
      : `Round ${e.round} begins`;
  }
  // A prompt is not a thing that happened. The client drops empty lines.
  if (e.t === 'CHOICE_REQUIRED') return '';
  // Unspoken on purpose. Whatever caused the discard is already in the log —
  // the cash-in names the card it cost, the turn beat marks the sweep — and
  // this event is here so the sound has one source of truth, not two lines.
  if (e.t === 'DISCARDED') return '';
  if (e.t === 'NAME_READ') {
    const who = nameOf(v, e.player, seat);
    return e.resolved && e.cardId
      ? `It remembers ${who} — ${card(e.cardId).name} turns on them`
      : `It remembers ${who}, and finds nothing it wants`;
  }
  if (e.t === 'WHISPER_FILL') {
    return `The whispering breaks over for the ${ordinal(e.fill)} time — `
      + `Doom +${e.doom}, the bar falls back to ${e.total}`;
  }
  if (e.t === 'WHISPERS') return `Whispers +${e.delta} — ${e.total} in all`;
  if (e.t === 'DOOM') return `Doom +${e.delta} — ${e.total} in all`;
  const head = anchor(e, v, seat);
  if (head) return head.detail ? `${head.title} — ${head.detail}` : head.title;
  return clause(e, v, seat, [e]) ?? e.t.toLowerCase().replace(/_/g, ' ');
}
