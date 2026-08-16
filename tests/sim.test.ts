import { describe, it, expect } from 'vitest';
import { setup } from '../engine/setup';
import { start, apply } from '../engine/reducer';
import { legalCommands, isLegal } from '../engine/legal';
import { playerView } from '../engine/view';
import { randAt } from '../engine/rng';
import { card } from '../content/cards';
import type { Command } from '../engine/state';
import { runGame, runBatch } from '../sim/run';
import { POLICIES, makeBot, PURITAN, ZEALOT } from '../sim/bots';
import { summarise, toCsv, mean, median } from '../sim/report';

const table = (p: string, n = 4) => new Array(n).fill(p);

describe('simulator determinism', () => {
  it('same config reproduces a byte-identical result', () => {
    const cfg = { seed: 'noon-7', policies: table('Zealot'), marked: 1 };
    expect(JSON.stringify(runGame(cfg))).toBe(JSON.stringify(runGame(cfg)));
  });

  it('the Random policy is reproducible too', () => {
    const cfg = { seed: 'noon-7', policies: table('Random') };
    expect(JSON.stringify(runGame(cfg))).toBe(JSON.stringify(runGame(cfg)));
  });

  it('different seeds produce different games', () => {
    // Step counts can collide by chance, so compare whole games.
    const seeds = ['a', 'b', 'c', 'd', 'e'];
    const games = seeds.map((seed) => JSON.stringify({
      ...runGame({ seed, policies: table('Greedy') }), seed: '',
    }));
    expect(new Set(games).size).toBeGreaterThan(1);
  });

  it('batches are reproducible by seed index', () => {
    const cfg = { games: 5, policies: table('Balanced'), seedPrefix: 'batch' };
    expect(JSON.stringify(runBatch(cfg))).toBe(JSON.stringify(runBatch(cfg)));
  });
});

describe('bots respect the hidden-information boundary', () => {
  it('a bot is never handed GameState', () => {
    const seen: Record<string, unknown>[] = [];
    let s = start(setup({ seed: 'leak', players: ['a', 'b', 'c'], markedIndex: 1 })).state;
    let cursor = 0;

    for (let i = 0; i < 300 && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      const view = playerView(s, actor);
      seen.push(view as unknown as Record<string, unknown>);
      const cmd = POLICIES.Balanced({ view, legal, rand: () => randAt('x', cursor++) });
      s = apply(s, actor, cmd).state;
    }

    expect(seen.length).toBeGreaterThan(10);
    for (const v of seen) {
      // GameState-only keys must never appear on what a bot sees.
      for (const forbidden of ['players', 'seed', 'supply', 'rngCursor', 'turnOrder', 'log']) {
        expect(v[forbidden], `view leaked ${forbidden}`).toBeUndefined();
      }
    }
  });

  it('a bot never sees another seat\'s role or hand', () => {
    const s = start(setup({ seed: 'leak2', players: ['a', 'b', 'c'], markedIndex: 1 })).state;
    const v = playerView(s, 'p0');
    expect(JSON.stringify(v)).not.toContain('marked');
    for (const o of v.opponents) expect(o.hand).toBeUndefined();
  });
});

describe('bots play legally', () => {
  it('every command a bot returns is in the legal set', () => {
    for (const policy of Object.keys(POLICIES)) {
      let s = start(setup({ seed: `legal-${policy}`, players: table('x') })).state;
      let cursor = 0;
      for (let i = 0; i < 600 && !s.winner; i++) {
        const actor = s.pending ? s.pending.player : s.activePlayer;
        const legal = legalCommands(s, actor);
        if (!legal.length) break;
        const cmd = POLICIES[policy]({
          view: playerView(s, actor), legal, rand: () => randAt('r', cursor++),
        });
        expect(
          legal.some((l) => JSON.stringify(l) === JSON.stringify(cmd)),
          `${policy} returned an illegal command: ${JSON.stringify(cmd)}`,
        ).toBe(true);
        s = apply(s, actor, cmd).state;
      }
    }
  });

  it('a full batch completes with no engine errors', () => {
    const rs = runBatch({ games: 12, policies: table('Zealot'), seedPrefix: 'err' });
    const errors = rs.filter((r) => r.outcome === 'error');
    expect(errors.map((e) => e.error)).toEqual([]);
  });
});

describe('policies differ only in what they buy', () => {
  it('Puritan never buys a Sign; Zealot buys many', () => {
    const pur = runBatch({ games: 10, policies: table('Puritan'), seedPrefix: 'p' });
    const zea = runBatch({ games: 10, policies: table('Zealot'), seedPrefix: 'p' });
    expect(pur.every((r) => r.signsBought === 0)).toBe(true);
    expect(mean(zea.map((r) => r.signsBought))!).toBeGreaterThan(10);
  });

  it('Puritan picks no Sign even when only Signs are affordable', () => {
    const s = start(setup({ seed: 'pick', players: table('x') })).state;
    const v = playerView(s, s.activePlayer);
    const r = () => 0;
    expect(PURITAN.pick(v, 4, r)).not.toBeNull();
    expect(card(PURITAN.pick(v, 4, r)!).type).not.toBe('sign');
    expect(card(ZEALOT.pick(v, 4, r)!).type).toBe('sign');
  });

  it('a Sign-buyer spreads across the whole Sign row, not one card', () => {
    // Tie-breaking on id once meant only 3 of 12 Signs were ever bought — and
    // none of the Vessel-facing ones — which silently voided any measurement
    // that depended on them.
    const s = start(setup({ seed: 'spread', players: table('x') })).state;
    const v = playerView(s, s.activePlayer);
    const picked = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = ZEALOT.pick(v, 4, () => randAt('spread', i));
      if (id) picked.add(id);
    }
    expect(picked.size).toBeGreaterThan(6);
  });

  it('a Puritan bot never plays a Sign it was given', () => {
    const s = start(setup({ seed: 'noplay', players: table('x') })).state;
    const pid = s.activePlayer;
    s.players[pid].hand = [{ uid: 'z1', cardId: 'colt', fevered: false }];
    const legal = legalCommands(s, pid);
    const cmd = makeBot(PURITAN)({ view: playerView(s, pid), legal, rand: () => 0 });
    expect(cmd.t).not.toBe('PLAY_CARD');
  });
});

describe('the Omen ruling changes reachability', () => {
  it('blocking on Omens makes burial unreachable far more often', () => {
    const blocked = runBatch({
      games: 25, policies: table('Zealot'), seedPrefix: 'omen',
      tuning: { omensBlockBurial: true },
    });
    const open = runBatch({
      games: 25, policies: table('Zealot'), seedPrefix: 'omen',
      tuning: { omensBlockBurial: false },
    });
    // Direction only. An earlier version asserted a 3x gap, which held only
    // while a bot-buying bug made every Sign-buyer buy `destroy` Signs and
    // clear the Street constantly. The mechanism is real; the magnitude was an
    // artifact — see FINDINGS Finding 1.
    expect(mean(open.map((r) => r.vesselDamage))!).toBeGreaterThan(
      mean(blocked.map((r) => r.vesselDamage))!,
    );
  });

  it('defaults to the dropped gate — Omens no longer wall off the Vessel', () => {
    const s = setup({ seed: 'dflt', players: table('x') });
    expect(s.tuning.omensBlockBurial).toBe(false);
  });
});

describe('report helpers', () => {
  it('mean and median ignore nulls', () => {
    expect(mean([1, null, 3])).toBe(2);
    expect(median([5, null, 1, 3])).toBe(3);
    expect(mean([null])).toBeNull();
  });

  it('win rate excludes stalls from the denominator', () => {
    const s = summarise('t', [
      { outcome: 'posse' }, { outcome: 'oldOne' }, { outcome: 'stall' },
    ] as never);
    expect(s.posseWinRate).toBe(0.5);
    expect(s.stalls).toBe(1);
  });

  it('csv escapes and keeps one row per game', () => {
    const rs = runBatch({ games: 3, policies: table('Greedy'), seedPrefix: 'csv' });
    const lines = toCsv(rs).trim().split('\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('outcome');
    expect(lines[1].split(',').length).toBe(lines[0].split(',').length);
  });
});

describe('isLegal — the server gate for online play', () => {
  const fresh = () => start(setup({ seed: 'gate', players: ['a', 'b', 'c'], markedIndex: 1 })).state;

  it('accepts everything legalCommands offers', () => {
    let s = fresh();
    for (let i = 0; i < 120 && !s.winner; i++) {
      const actor = s.pending ? s.pending.player : s.activePlayer;
      const legal = legalCommands(s, actor);
      if (!legal.length) break;
      for (const c of legal) {
        expect(isLegal(s, actor, c), `rejected a legal ${JSON.stringify(c)}`).toBe(true);
      }
      s = apply(s, actor, legal[i % legal.length]).state;
    }
  });

  it('rejects commands the rules never offered', () => {
    const s = fresh();
    const me = s.activePlayer;
    const other = s.turnOrder.find((id) => id !== me)!;
    const evil: Command[] = [
      { t: 'BUY', cardId: 'colt' },                    // no Grit
      { t: 'PAY_TOLL', slot: 2 },                      // nothing there to pay
      { t: 'SHUTTER', cardType: 'kit' },               // not the Old One
      { t: 'CALL', target: other },                    // not the Old One
      { t: 'BECKON', target: other },                  // not a Revenant
      { t: 'SPEND_GRIT', uids: ['not-a-card'] },
    ];
    for (const c of evil) {
      expect(isLegal(s, me, c), `let through ${JSON.stringify(c)}`).toBe(false);
    }
  });

  it('is not fooled by key order — the client controls its own JSON', () => {
    const s = fresh();
    const me = s.activePlayer;
    const uid = s.players[me].hand[0].uid;
    expect(isLegal(s, me, { uid, t: 'PLAY_CARD' } as Command)).toBe(true);
  });

  it('allows cashing several cards at once, but not duplicates or strangers', () => {
    const s = fresh();
    const me = s.activePlayer;
    const uids = s.players[me].hand.filter((ci) => card(ci.cardId).grit > 0).map((ci) => ci.uid);
    expect(uids.length).toBeGreaterThan(1);
    expect(isLegal(s, me, { t: 'SPEND_GRIT', uids })).toBe(true);
    expect(isLegal(s, me, { t: 'SPEND_GRIT', uids: [uids[0], uids[0]] })).toBe(false);
    expect(isLegal(s, me, { t: 'SPEND_GRIT', uids: [...uids, 'ghost'] })).toBe(false);
  });

  it('rejects another seat acting out of turn', () => {
    const s = fresh();
    const other = s.turnOrder.find((id) => id !== s.activePlayer)!;
    expect(isLegal(s, other, { t: 'END_TURN' })).toBe(false);
  });
});
