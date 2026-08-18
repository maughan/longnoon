/*
  The development panel: get to any state without playing your way to it.

  Every button here sends a `dev` message, which is the one channel that does
  NOT go through `isLegal` — these are not moves, they are the tester reaching
  into the box. The server refuses the whole channel unless it was started with
  `LONG_NOON_DEV=1`, and it tells the client so on `joined`; this panel is only
  rendered when it said yes, so the buttons cannot appear against a server that
  would refuse them.

  Deliberately ugly. It is styled to look like a tool bolted to the side of the
  game rather than part of it, because the one thing that must never happen is
  somebody using it at a real table without noticing.
*/
import { useState } from 'react';
import type { PlayerId } from '../../../engine/state';
import type { ClientState } from '../../../engine/view';
import { ALL_CARDS } from '../../../content/cards';
import '../components/styles/DevPanel.css';

/** What a dev button sends. Mirrors `ClientMsg['dev']`. */
export interface DevMsg {
  action: 'turning' | 'restart' | 'sit' | 'status' | 'turn' | 'dusk'
    | 'grit' | 'give';
  seat?: PlayerId;
  status?: 'posse' | 'revenant' | 'gone';
  cardId?: string;
  n?: number;
}

/** Cards worth handing out. Threats live in the Street, not in a hand. */
const GIVEABLE = ALL_CARDS
  .filter((c) => !['trouble', 'mythos', 'omen'].includes(c.type))
  .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

const GRIT_STEP = 5;

export function DevPanel({
  v, seat, onDev,
}: {
  v: ClientState;
  seat: PlayerId | null;
  onDev: (msg: DevMsg) => void;
}) {
  const [open, setOpen] = useState(false);
  const [give, setGive] = useState(GIVEABLE[0]!.id);

  /*
    Every seat, from the view rather than from a new payload.

    `playerView` already publishes the seat list, names and statuses to
    everybody — that is what the player rail is drawn from — so the panel needs
    no privileged channel of its own. What it does NOT get is anybody else's
    hand, and it should not: `sit` is how you look at another seat, and going
    through a real seat change means what you see is exactly what that player
    sees, rather than a debug view of them that nothing else in the game agrees
    with.
  */
  const seats = [
    // `you` carries no name — the view never tells you your own, because
    // nothing in the game needs to say it back to you.
    ...(v.you ? [{ id: v.you.id, name: 'You', status: v.you.status }] : []),
    ...v.opponents.map((o) => ({ id: o.id, name: o.name, status: o.status })),
  ].sort((a, b) => a.id.localeCompare(b.id));

  if (!open) {
    return (
      <button className="devtab" onClick={() => setOpen(true)} title="Development tools">
        DEV
      </button>
    );
  }

  return (
    <div className="devpanel">
      <header>
        <b>Development</b>
        <button onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>

      <section>
        <h4>The game</h4>
        <div className="devrow">
          {v.act === 'trouble' ? (
            <span className="devnote">
              Turning names the Vessel — pick a seat below to choose who.
            </span>
          ) : (
            <button onClick={() => onDev({ action: 'restart' })}>
              New deal (back to Act I)
            </button>
          )}
          <button onClick={() => onDev({ action: 'dusk' })}>Bring on Dusk</button>
        </div>
      </section>

      <section>
        <h4>Seats</h4>
        {seats.map((s) => (
          <div className="devseat" key={s.id}>
            <div className="devwho">
              <b>{s.name}</b>
              <small>{s.id} · {s.status}{s.id === seat ? ' · you' : ''}</small>
            </div>
            <div className="devrow">
              <button
                disabled={s.id === seat}
                onClick={() => onDev({ action: 'sit', seat: s.id })}
                title="Take this seat. The one you leave is handed to a bot, so
the game keeps playing while you are elsewhere."
              >
                Sit here
              </button>
              <button
                onClick={() => onDev({ action: 'turn', seat: s.id })}
                title="Give them the turn, through a real end of turn — so hands
are swept and the round rolls if it needs to."
              >
                Their turn
              </button>
              <button onClick={() => onDev({ action: 'grit', seat: s.id, n: GRIT_STEP })}>
                +{GRIT_STEP} Grit
              </button>
            </div>
            <div className="devrow">
              {(['posse', 'revenant', 'gone'] as const).map((st) => (
                <button
                  key={st}
                  disabled={s.status === st || s.status === 'vessel'}
                  onClick={() => onDev({ action: 'status', seat: s.id, status: st })}
                >
                  {st}
                </button>
              ))}
              {v.act === 'trouble' && (
                <button
                  className="warn"
                  onClick={() => onDev({ action: 'turning', seat: s.id })}
                  title="Force the Turning for real and make this seat the
Vessel: every Sign turns, the Street flips, the Marked aim is scored."
                >
                  Turn · Vessel
                </button>
              )}
              <button onClick={() => onDev({ action: 'give', seat: s.id, cardId: give })}>
                Give card
              </button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h4>Card to give</h4>
        <select value={give} onChange={(e) => setGive(e.target.value)}>
          {GIVEABLE.map((c) => (
            <option key={c.id} value={c.id}>{c.type} — {c.name}</option>
          ))}
        </select>
        <p className="devnote">
          Straight into their hand. A Sign given after the Turning arrives
          Fevered, like every other Sign on the table.
        </p>
      </section>
    </div>
  );
}
