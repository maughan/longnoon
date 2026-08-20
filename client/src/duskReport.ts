// What the round cost you, gathered into one page.
//
// Dusk is the only moment where a lot happens at once and none of it is yours:
// every unresolved Threat menaces, decks get eaten, new Trouble arrives, and
// everything left standing gets worse. Streamed one sentence at a time it is
// eight seconds of things scrolling past. Read as a list it is a scoreboard,
// and the thing you were going to say next changes.
//
// Built from the same events the narrator uses, so the report and the chronicle
// can never disagree about what happened.

import { card } from '../../content/cards';
import type { GameEvent, PlayerId } from '../../engine/state';
import type { ClientState } from '../../engine/view';
import { nameOf } from './beats';
import type { IconName } from './components/iconsgen';

export interface DuskLine {
  icon: IconName;
  text: string;
  /** Set when the line is about you — the report is read for these first. */
  yours?: boolean;
  /** Set for the outright bad news, so it can be coloured. */
  dire?: boolean;
}

export interface DuskReport {
  round: number;
  menace: DuskLine[];
  arrivals: DuskLine[];
  escalated: DuskLine[];
  tracks: DuskLine[];
  /**
   * Who leads the round that just began.
   *
   * The button moves one chair every Dawn, and the Dusk sheet is the one moment
   * the whole table is looking at the same thing — so it is where the new order
   * gets announced, rather than left for people to work out from whose turn it
   * turned out to be.
   *
   * Read off the view, not the events: the Dusk batch carries the next round's
   * start with it, so by the time this is built `firstPlayer` is already the
   * new one.
   */
  next: DuskLine;
  /** Nothing happened at all — a quiet Dusk is worth saying out loud. */
  quiet: boolean;
}

/** Whether this batch of events is a Dusk at all. */
export function isDusk(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.t === 'PHASE' && e.phase === 'dusk');
}

export function duskReport(
  events: readonly GameEvent[], v: ClientState, seat: PlayerId | null,
): DuskReport {
  const who = (id: PlayerId) => nameOf(v, id, seat);
  const whom = (id: PlayerId) => (id === seat ? 'you' : who(id));

  const menace: DuskLine[] = [];
  const arrivals: DuskLine[] = [];
  const escalated: DuskLine[] = [];
  const tracks: DuskLine[] = [];
  let whispers = 0;
  let cycles = 0;
  let cycleDoom = 0;
  let doom = 0;
  let whisperTotal = 0;
  let doomTotal = 0;

  // A Menace and the damage it did are two events and one sentence. Pairing
  // them by walking in order is safe: the engine emits the wound immediately
  // after the blow that caused it.
  let lastMenace: { victim: PlayerId; at: number } | null = null;

  for (const e of events) {
    switch (e.t) {
      case 'MENACE':
        menace.push({
          icon: 'menace',
          text: `${card(e.cardId).name} menaces ${whom(e.player)} for ${e.amount}`,
          yours: e.player === seat,
          dire: true,
        });
        lastMenace = { victim: e.player, at: menace.length - 1 };
        break;

      case 'DAMAGED': {
        const cards = `${e.amount} card${e.amount === 1 ? '' : 's'}`;
        const lost = e.trashed.length
          ? ` — ${e.trashed.map((id) => card(id).name).join(', ')}`
          : '';
        if (lastMenace && lastMenace.victim === e.player) {
          // Fold it into the blow that caused it.
          menace[lastMenace.at].text += `, costing ${cards}${lost}`;
          lastMenace = null;
        } else {
          menace.push({
            icon: 'scar',
            text: `${who(e.player)} loses ${cards}${lost}`,
            yours: e.player === seat,
            dire: true,
          });
        }
        break;
      }

      case 'SHIELDED':
      case 'PREVENTED':
        menace.push({
          icon: 'clear',
          text: e.t === 'SHIELDED'
            ? `${who(e.player)} warded for ${e.amount}`
            : `${e.amount} damage prevented`,
          yours: e.player === seat,
        });
        break;

      case 'FELL':
        menace.push({
          icon: 'grave',
          text: `${who(e.player)} falls, and does not leave — a ${e.became}`,
          yours: e.player === seat,
          dire: true,
        });
        break;

      case 'BURNED_OUT':
        menace.push({
          icon: 'grave', text: `${who(e.player)} is gone for good`, dire: true,
        });
        break;

      case 'THREAT_ENTERED': {
        const def = card(e.cardId);
        arrivals.push({
          icon: def.type === 'omen' ? 'omen' : 'menace',
          text: def.type === 'omen'
            ? `${def.name} settles in, and cannot be cleared`
            : def.name,
          dire: def.type === 'omen',
        });
        break;
      }

      case 'ESCALATED':
        escalated.push({
          icon: 'menace',
          text: `${card(e.cardId).name} is worse for having been left`
            + ` — Clear ${e.clear ?? '—'}, Menace ${e.menace}`,
        });
        break;

      case 'VESSEL_DAMAGE_RESET':
        tracks.push({
          icon: 'omen',
          text: `An Omen arrives and the burial is undone — ${e.lost} lost`,
          dire: true,
        });
        break;

      case 'WHISPERS':
        whispers += e.delta;
        whisperTotal = e.total;
        break;

      case 'WHISPER_FILL':
        // Its own line, above the running totals. The bar breaking over is the
        // single worst thing a Dusk can contain and it must not be a clause on
        // the end of "Whispers +4".
        cycles += 1;
        cycleDoom += e.doom;
        // The post-reset reading. Without this the summary line below would
        // print the pre-wrap total and say something like "9 of 8".
        whisperTotal = e.total;
        break;

      case 'DOOM':
        doom += e.delta;
        doomTotal = e.total;
        break;

      default:
        break;
    }
  }

  if (cycles) {
    tracks.push({
      icon: 'whisper',
      text: cycles === 1
        ? `The whispering breaks over — Doom +${cycleDoom}`
        : `The whispering breaks over ${cycles} times — Doom +${cycleDoom}`,
      dire: true,
    });
  }
  if (whispers) {
    // Signed, not always "+". The delta used to print with a hardcoded plus,
    // which read as "Whispers +-1" the moment anything took some away.
    const sign = whispers > 0 ? '+' : '';
    tracks.push({
      icon: 'whisper',
      text: `Whispers ${sign}${whispers} — ${whisperTotal} of ${v.whisperThreshold}`,
    });
  }
  if (doom) {
    tracks.push({
      icon: 'doom',
      text: `Doom +${doom} — ${doomTotal} of ${v.doomTarget}`,
      dire: true,
    });
  }

  const leads = v.firstPlayer;
  return {
    round: v.round,
    menace,
    arrivals,
    escalated,
    tracks,
    next: {
      icon: 'street',
      text: leads === seat
        ? `Round ${v.round} — you lead`
        : `Round ${v.round} — ${who(leads)} leads`,
      yours: leads === seat,
    },
    quiet: !menace.length && !arrivals.length && !escalated.length && !tracks.length,
  };
}
