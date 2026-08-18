// Does a reshuffle actually reach the speaker?
//
// The chain is long — engine emits, server forwards, net stores, hook walks —
// and a break anywhere in it is silent by definition.

import { describe, it, expect, beforeEach } from 'vitest';
import { GameRoom } from '../server/room';
import type { GameEvent } from '../engine/state';
import { CLIPS } from '../client/src/cardSounds';

const played: { src: string; volume: number }[] = [];

class FakeAudio {
  src: string; volume = 1; preload = ''; playbackRate = 1;
  constructor(src: string) { this.src = src; }
  cloneNode() { return new FakeAudio(this.src); }
  play() { played.push({ src: this.src, volume: this.volume }); return Promise.resolve(); }
}

/**
 * Drain, then clear.
 *
 * A multi-card deal is staggered on timers, so a test that ends before its own
 * sounds have played leaves them to land in the next one — which is how this
 * file first reported five deals for a two-card draw. The longest stagger is
 * four gaps of 90ms.
 */
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 420));
  played.length = 0;
});
(globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;

async function sounds() {
  const { createCardSounds } = await import('../client/src/cardSounds');
  return createCardSounds();
}

/** A real game, up to the first batch in which somebody recycles their deck. */
function firstReshuffle(): { events: GameEvent[]; player: string } {
  const room = new GameRoom({
    seed: 'sound-1',
    seats: [{ name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
      { name: 'Cole', kind: 'bot' }],
    marked: 0,
  });
  for (let i = 0; i < 900 && room.awaitingBot; i++) {
    for (const u of room.stepBot() ?? []) {
      if (u.seat !== 'p0') continue;
      const hit = u.events.find((e) => e.t === 'RESHUFFLED');
      if (hit) return { events: u.events, player: (hit as { player: string }).player };
    }
  }
  throw new Error('no deck cycled in a whole game');
}

describe('the shuffle', () => {
  it('plays when a real game recycles a deck', async () => {
    const s = await sounds();
    const { events } = firstReshuffle();
    s.hear(events, 'p0', 0.7);
    expect(played.length, 'nothing played').toBeGreaterThan(0);
    expect(played.some((p) => p.src.includes('shuffle'))).toBe(true);
  });

  it('plays your own louder than someone else’s', async () => {
    const s = await sounds();
    const ev: GameEvent[] = [{ t: 'RESHUFFLED', player: 'p0', n: 9 }];
    s.hear(ev, 'p0', 0.7);
    const mine = played.at(-1)!.volume;
    s.hear([{ t: 'RESHUFFLED', player: 'p1', n: 9 }], 'p0', 0.7);
    expect(played.at(-1)!.volume).toBeLessThan(mine);
  });

  it('says nothing when the table is muted', async () => {
    const s = await sounds();
    s.hear([{ t: 'RESHUFFLED', player: 'p0', n: 9 }], 'p0', 0);
    expect(played).toHaveLength(0);
  });

  it('still fires a card sound in the same batch', async () => {
    // The reshuffle branch `continue`s; it must not swallow the rest.
    const s = await sounds();
    s.hear([
      { t: 'RESHUFFLED', player: 'p0', n: 9 },
      { t: 'PLAYED', player: 'p0', cardId: 'six-gun', fevered: false },
      { t: 'THREAT_DAMAGED', slot: 0, amount: 1 },
    ], 'p0', 0.7);
    expect(played.some((p) => p.src.includes('shuffle'))).toBe(true);
    expect(played.some((p) => p.src.includes('gunshot'))).toBe(true);
  });
});


describe('dealing', () => {
  it('plays the hand clip for a full hand, not five separate cards', async () => {
    const snd = await sounds();
    snd.hear([{ t: 'DREW', player: 'p0', n: 5 }], 'p0', 0.7, 5);
    expect(played).toHaveLength(1);
    expect(played[0]!.src).toContain('deal-hand');
  });

  it('plays one card at a time for a mid-turn draw', async () => {
    const snd = await sounds();
    snd.hear([{ t: 'DREW', player: 'p0', n: 2 }], 'p0', 0.7, 5);
    // Staggered, so the first is immediate and the rest follow.
    await new Promise((r) => setTimeout(r, 250));
    expect(played).toHaveLength(2);
    for (const p of played) expect(p.src).toMatch(/deal-[abcd]/);
  });

  it('varies which card clip it uses', async () => {
    const snd = await sounds();
    for (let i = 0; i < 8; i++) snd.hear([{ t: 'DREW', player: 'p0', n: 1 }], 'p0', 0.7, 5);
    await new Promise((r) => setTimeout(r, 50));
    // A shuffle bag over four files: eight draws must not be one recording.
    expect(new Set(played.map((p) => p.src)).size).toBeGreaterThan(1);
  });

  it('falls back to single cards when the hand size is unknown', async () => {
    const snd = await sounds();
    snd.hear([{ t: 'DREW', player: 'p0', n: 5 }], 'p0', 0.7);
    await new Promise((r) => setTimeout(r, 500));
    expect(played.every((p) => /deal-[abcd]/.test(p.src))).toBe(true);
  });

  it('deals the real hand size the engine is configured with', async () => {
    const { TUNING } = await import('../content/cards');
    const snd = await sounds();
    snd.hear([{ t: 'DREW', player: 'p0', n: TUNING.handSize }], 'p0', 0.7, TUNING.handSize);
    expect(played[0]!.src).toContain('deal-hand');
  });
});


describe('a draw never falls silent', () => {
  /**
   * The bug this guards: `handSize` was undefined because the server had not
   * been restarted, so the preview dealt `n: undefined`. Both branches were
   * false — `undefined >= undefined`, and `Math.min(undefined, 5)` is NaN — and
   * the one button whose job is to tell you whether silence means broken was
   * itself silent.
   */
  it('plays something when the hand size never arrived', async () => {
    const snd = await sounds();
    snd.hear([{ t: 'DREW', player: 'p0', n: 5 }], 'p0', 0.7, undefined as never);
    await new Promise((r) => setTimeout(r, 500));
    expect(played.length).toBeGreaterThan(0);
  });

  it('plays something when the count is missing too', async () => {
    const snd = await sounds();
    snd.hear(
      [{ t: 'DREW', player: 'p0', n: undefined as never }],
      'p0', 0.7, 5,
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(played.length).toBe(1);
  });

  it('ignores a nonsense count rather than looping on it', async () => {
    const snd = await sounds();
    snd.hear([{ t: 'DREW', player: 'p0', n: -4 }], 'p0', 0.7, 5);
    await new Promise((r) => setTimeout(r, 200));
    expect(played.length).toBe(1);
  });
});

describe('the discard', () => {
  /**
   * Reached through a real game, not a hand-built event.
   *
   * The whole point of driving it from `GameRoom` is that the event has to
   * survive the engine, the server's `visibleEvents` filter and the update
   * payload. A specimen fed straight to `hear` would pass with the emit site
   * missing entirely.
   */
  function firstOf(hand: boolean): GameEvent[] {
    const room = new GameRoom({
      seed: 'discard-1',
      seats: [{ name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
        { name: 'Cole', kind: 'bot' }],
      marked: 0,
    });
    for (let i = 0; i < 900 && room.awaitingBot; i++) {
      for (const u of room.stepBot() ?? []) {
        if (u.seat !== 'p0') continue;
        if (u.events.some((e) => e.t === 'DISCARDED' && e.hand === hand)) {
          return u.events;
        }
      }
    }
    throw new Error(`no ${hand ? 'hand sweep' : 'single discard'} in a whole game`);
  }

  it('sweeps a hand away at the end of a turn', async () => {
    const s = await sounds();
    s.hear(firstOf(true), 'p0', 0.7, 5);
    expect(played.some((p) => p.src.includes('discard-a'))).toBe(true);
  });

  it('puts one card down during a turn', async () => {
    const s = await sounds();
    s.hear(firstOf(false), 'p0', 0.7, 5);
    // Staggered like a deal, so even the first lands on a timer.
    await new Promise((r) => setTimeout(r, 200));
    expect(played.some((p) => p.src.includes('discard-one'))).toBe(true);
  });

  it('keeps the two gestures apart when the sweep is a single card', async () => {
    // A turn that played four of five ends by discarding exactly one card, and
    // that is still the sweep. This is why the engine sends `hand` rather than
    // letting the client infer it from the count.
    const s = await sounds();
    s.hear([{ t: 'DISCARDED', player: 'p0', n: 1, hand: true }], 'p0', 0.7, 5);
    expect(played).toHaveLength(1);
    expect(played[0]!.src).toContain('discard-a');
  });

  it('plays your own louder than someone else’s', async () => {
    const s = await sounds();
    s.hear([{ t: 'DISCARDED', player: 'p0', n: 2, hand: true }], 'p0', 0.7, 5);
    const mine = played.at(-1)!.volume;
    s.hear([{ t: 'DISCARDED', player: 'p1', n: 2, hand: true }], 'p0', 0.7, 5);
    expect(played.at(-1)!.volume).toBeLessThan(mine);
  });

  it('staggers a multi-card cash-in and caps it', async () => {
    const s = await sounds();
    s.hear([{ t: 'DISCARDED', player: 'p0', n: 9, hand: false }], 'p0', 0.7, 5);
    await new Promise((r) => setTimeout(r, 900));
    // Nine cards, four sounds: past about four it stops being a count and
    // becomes a rattle, and the coins are already saying "several".
    expect(played).toHaveLength(4);
  });

  it('says nothing when a turn ends on an empty hand', async () => {
    // The engine does not emit at all in that case; this pins the reason down
    // to the emit site rather than to a client guard that could be removed.
    const s = await sounds();
    s.hear([], 'p0', 0.7, 5);
    expect(played).toHaveLength(0);
  });
});

describe('cards that wait for the aim', () => {
  /**
   * Table-driven over CLIPS rather than a block per card.
   *
   * Every card with an `on` list makes the same promise — played in one batch,
   * heard in the next, once the player has aimed — and the interesting thing is
   * the RULE, not any one card. A block per card also means the next card added
   * gets no coverage until somebody remembers to write one.
   */
  const aimed = Object.entries(CLIPS).filter(([, c]) => c.on?.length);

  /** A minimal, well-formed specimen of whichever event a card lands on. */
  function landing(t: string): GameEvent {
    switch (t) {
      case 'THREAT_DAMAGED': return { t, slot: 0, amount: 2 };
      case 'THREAT_CLEARED': return { t, slot: 0, cardId: 'barons-men' };
      case 'VESSEL_DAMAGED': return { t, amount: 2, total: 4, by: 'p0' };
      case 'DAMAGED': return { t, player: 'p1', amount: 1, trashed: ['saddlebag'] };
      default: throw new Error(`no specimen for ${t}`);
    }
  }

  it('has something to test', () => {
    // Guards the filter above: a CLIPS refactor that dropped every `on` list
    // would otherwise make this whole suite pass by testing nothing.
    expect(aimed.length).toBeGreaterThanOrEqual(4);
  });

  it.each(aimed)('%s stays silent until it is aimed, then sounds', async (id, clip) => {
    const s = await sounds();
    // CHOICE_REQUIRED is what a real PLAYED batch carries for an aimed card,
    // and it is what keeps the shot armed across batches — without it the
    // end-of-batch sweep disarms, which is how a fizzled card is stopped from
    // going off later on somebody else's move.
    s.hear([
      { t: 'PLAYED', player: 'p0', cardId: id, fevered: false },
      { t: 'CHOICE_REQUIRED', player: 'p0', prompt: 'Choose a target' },
    ], 'p0', 0.7, 5);
    expect(played, `${id} sounded before the target was chosen`).toHaveLength(0);

    s.hear([landing(clip.on![0]!)], 'p0', 0.7, 5);
    expect(played, `${id} never sounded`).toHaveLength(1);
    // Its own recording, not whichever clip happened to be nearby.
    expect(played[0]!.src).toBe(clip.src);
  });

  it.each(aimed)('%s does not go off later when it fizzles', async (id) => {
    // No legal target: disarmed at the end of the batch rather than left in the
    // air to fire on the next card that happens to deal damage.
    const s = await sounds();
    s.hear([{ t: 'PLAYED', player: 'p0', cardId: id, fevered: false }], 'p0', 0.7, 5);
    s.hear([{ t: 'BOUGHT', player: 'p1', cardId: 'colt' }], 'p0', 0.7, 5);
    s.hear([{ t: 'THREAT_DAMAGED', slot: 0, amount: 1 }], 'p0', 0.7, 5);
    expect(played, `${id} fired on someone else's move`).toHaveLength(0);
  });

  it('gives the two firearms the same level', async () => {
    // A rifle mixed louder than a pistol reads as a different game rather than
    // as a longer barrel. The recordings carry the difference; the mix does not.
    expect(CLIPS['winchester']!.gain).toBe(CLIPS['six-gun']!.gain);
  });
});

describe('Doom', () => {
  it('booms when Doom climbs', async () => {
    const s = await sounds();
    s.hear([{ t: 'DOOM', delta: 1, total: 4 }], 'p0', 0.7, 5);
    expect(played).toHaveLength(1);
    expect(played[0]!.src).toContain('doom-boom');
  });

  it('booms once for a whole Dusk, not once per source', async () => {
    // Four unresolved Threats at Dusk is four DOOM events, and a Whisper fill
    // adds a fifth. Five booms in a row is a machine gun, not dread.
    const s = await sounds();
    s.hear([
      { t: 'PHASE', phase: 'dusk', round: 5 },
      { t: 'DOOM', delta: 1, total: 4 },
      { t: 'DOOM', delta: 1, total: 5 },
      { t: 'DOOM', delta: 1, total: 6 },
      { t: 'WHISPER_FILL', fill: 1, doom: 2, total: 0 },
      { t: 'DOOM', delta: 2, total: 8 },
    ], 'p0', 0.7, 5);
    expect(played.filter((p) => p.src.includes('doom-boom'))).toHaveLength(1);
  });

  it('stays silent when Doom does not move', async () => {
    const s = await sounds();
    s.hear([{ t: 'PHASE', phase: 'dusk', round: 5 }], 'p0', 0.7, 5);
    expect(played.filter((p) => p.src.includes('doom-boom'))).toHaveLength(0);
  });

  it('is the same for everyone, because Doom is nobody’s', async () => {
    // No near/far. There is no "somebody else's Doom" to mix quieter.
    const s = await sounds();
    s.hear([{ t: 'DOOM', delta: 1, total: 4 }], 'p0', 0.7, 5);
    const mine = played.at(-1)!.volume;
    s.hear([{ t: 'DOOM', delta: 1, total: 5 }], 'p3', 0.7, 5);
    expect(played.at(-1)!.volume).toBe(mine);
  });

  it('reaches the speaker from a real game', async () => {
    // The chain is engine -> server -> net -> hook, and a break anywhere in it
    // is silent by definition.
    const room = new GameRoom({
      seed: 'doom-real',
      seats: [{ name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
        { name: 'Cole', kind: 'bot' }],
      marked: 0,
    });
    const s = await sounds();
    for (let i = 0; i < 2000 && room.awaitingBot; i++) {
      for (const u of room.stepBot() ?? []) {
        if (u.seat !== 'p0') continue;
        if (!u.events.some((e) => e.t === 'DOOM')) continue;
        s.hear(u.events, 'p0', 0.7, 5);
        expect(played.some((p) => p.src.includes('doom-boom'))).toBe(true);
        return;
      }
    }
    throw new Error('no Doom in a whole game');
  });
});

describe('the Colt, before and after', () => {
  it('plays the clean shot, and the turned one once it has turned', async () => {
    const s = await sounds();
    s.hear([
      { t: 'PLAYED', player: 'p0', cardId: 'colt', fevered: false },
      { t: 'THREAT_CLEARED', slot: 0, cardId: 'barons-men' },
    ], 'p0', 0.7, 5);
    expect(played.at(-1)!.src).toContain('colt');
    expect(played.at(-1)!.src).not.toContain('fevered');

    s.hear([
      { t: 'PLAYED', player: 'p0', cardId: 'colt', fevered: true },
      { t: 'THREAT_CLEARED', slot: 1, cardId: 'rustlers' },
    ], 'p0', 0.7, 5);
    expect(played.at(-1)!.src).toContain('colt-fevered');
  });

  it('follows the card, not the act', async () => {
    // A Colt handed over by A GIFT, FREELY GIVEN arrives Fevered before the
    // Turning. The sound is keyed on the instance, so it is right there too.
    const s = await sounds();
    s.hear([
      { t: 'PLAYED', player: 'p0', cardId: 'colt', fevered: true },
      { t: 'THREAT_CLEARED', slot: 0, cardId: 'barons-men' },
    ], 'p0', 0.7, 5);
    expect(played.at(-1)!.src).toContain('colt-fevered');
  });
});

describe('Dusk', () => {
  it('calls the sun down when the phase turns', async () => {
    const s = await sounds();
    s.hear([{ t: 'PHASE', phase: 'dusk', round: 4 }], 'p0', 0.7, 5);
    expect(played.some((p) => p.src.includes('dusk-call'))).toBe(true);
  });

  it('says nothing at Dawn', async () => {
    const s = await sounds();
    s.hear([{ t: 'PHASE', phase: 'dawn', round: 5 }], 'p0', 0.7, 5);
    expect(played.filter((p) => p.src.includes('dusk-call'))).toHaveLength(0);
  });

  it('sounds the same for everyone — Dusk is nobody’s', async () => {
    const s = await sounds();
    s.hear([{ t: 'PHASE', phase: 'dusk', round: 4 }], 'p0', 0.7, 5);
    const mine = played.at(-1)!.volume;
    s.hear([{ t: 'PHASE', phase: 'dusk', round: 5 }], 'p3', 0.7, 5);
    expect(played.at(-1)!.volume).toBe(mine);
  });

  it('reaches the speaker from a real game', async () => {
    // The chain is engine -> server -> net -> hook, and it broke once already:
    // the previous Dusk clip lived inside the animation component and went
    // silently when the animation was removed.
    const room = new GameRoom({
      seed: 'dusk-real',
      seats: [{ name: 'Ada', kind: 'bot' }, { name: 'Bell', kind: 'bot' },
        { name: 'Cole', kind: 'bot' }],
      marked: 0,
    });
    const s = await sounds();
    for (let i = 0; i < 3000 && room.awaitingBot; i++) {
      for (const u of room.stepBot() ?? []) {
        if (u.seat !== 'p0') continue;
        if (!u.events.some((e) => e.t === 'PHASE' && e.phase === 'dusk')) continue;
        s.hear(u.events, 'p0', 0.7, 5);
        expect(played.some((p) => p.src.includes('dusk-call'))).toBe(true);
        return;
      }
    }
    throw new Error('no Dusk in a whole game');
  });
});
