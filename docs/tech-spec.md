# The Long Noon — Digital Build Spec

**Target stack:** TypeScript everywhere. Pure engine core with zero dependencies, React + Vite for the client, Node for the simulator, and a network layer added last.

**The bet this spec makes:** the engine is a pure, deterministic, headless library. React never touches game logic. Everything below follows from that one constraint.

---

## 0. Why the engine comes first

The PnP left you guessing at three numbers: the Whisper threshold (12), the Vessel's Clear value (12), and Sign costs. A headless engine plus dumb bots lets you run 10,000 games overnight across a parameter grid and answer those empirically before a single human sits down.

That is the actual reason to go digital. Multiplayer is a distant second. Build the simulator before you build a UI.

---

## 1. Project layout

```
/packages
  /engine        pure TS, no deps, no React, no I/O
    state.ts     types
    reducer.ts   apply(state, command) -> {state, events}
    legal.ts     legalCommands(state, playerId)
    effects.ts   op interpreter
    rng.ts       seeded PRNG
    view.ts      playerView(state, viewerId)
  /content       card & tuning data as JSON, validated by zod
    cards.json
    tuning.json
  /sim           node CLI: bots, batch runs, CSV out
  /client        React + Vite
  /server        added at milestone 4
```

`engine` importing anything from `client` is the failure mode to guard against. Add a lint rule for it on day one.

---

## 2. State shape

```ts
type Phase = 'dawn' | 'day' | 'dusk' | 'turning' | 'over';
type Act   = 'trouble' | 'mythos';
type Status = 'posse' | 'husk' | 'revenant' | 'oldOne' | 'buried' | 'gone';

interface GameState {
  seed: string;
  rngCursor: number;          // advanced on every random draw
  round: number;
  act: Act;
  phase: Phase;
  turnOrder: PlayerId[];
  activePlayer: PlayerId;
  actionsLeft: number;

  whispers: number;
  doom: number;
  vesselDamage: number;       // progress toward burying the Vessel
  vessel: PlayerId | null;

  street: (StreetSlot | null)[];   // length 3
  supply: {
    provisions: CardId[];     // never reshuffled
    provisionRow: CardId[];   // 4 face up
    signs: CardId[];          // always available, unlimited
    trouble: CardId[];
    mythos: CardId[];
  };

  players: Record<PlayerId, PlayerState>;
  pending: PendingChoice | null;   // engine is paused when non-null
  log: GameEvent[];
}

interface PlayerState {
  id: PlayerId;
  role: 'faithful' | 'marked';     // SECRET
  status: Status;
  deck: CardId[];                  // SECRET (order)
  hand: CardId[];                  // SECRET
  discard: CardId[];               // public
  boneyard: CardId[];              // public — trashed cards
  scars: number;
  graveTokens: number;
  gritThisTurn: number;
  signsHeld: number;               // derived, cached for targeting
}

interface StreetSlot {
  cardId: CardId;
  damage: number;
  turned: boolean;                 // flipped at the Turning
  enteredRound: number;
}
```

Everything is serializable. No class instances, no functions in state, no Dates.

---

## 3. Determinism

Seeded PRNG (`mulberry32` or `sfc32`), with the cursor stored **in state** rather than in a closure. Every shuffle and reveal advances it.

Consequence: `seed + ordered command list` fully reconstructs any game. That gives you replays, bug repro from a tester's session, and — the important one — the ability to run the same seed against different tuning values and isolate the effect of the change.

Do not use `Math.random()` anywhere in `engine`. Lint for it.

---

## 4. Commands, events, and the legal-move twofer

```ts
type Command =
  | { t: 'PLAY_CARD';   cardId: CardId }
  | { t: 'SPEND_GRIT';  cardIds: CardId[] }
  | { t: 'BUY';         cardId: CardId }
  | { t: 'DEAL_DAMAGE'; slot: number; amount: number }
  | { t: 'BURY_REVENANT'; target: PlayerId }
  | { t: 'RESOLVE_CHOICE'; choiceId: string; picks: string[] }
  | { t: 'END_TURN' }
  // Old One only
  | { t: 'CALL'; target: PlayerId }
  | { t: 'SUMMON'; slot: number }
  | { t: 'WHISPER' };

function apply(s: GameState, playerId: PlayerId, c: Command):
  { state: GameState; events: GameEvent[] };
```

Write `legalCommands(state, playerId): Command[]` and use it for **two** things: disabling buttons in React, and defining the action space for bots. One function, both consumers, no drift between what the UI allows and what the simulator explores.

`apply` throws on an illegal command rather than silently no-oping. The client should never send one; the server must assume it will.

---

## 5. Cards as data — and the Fevered insight

Writing out the twelve Sign pairs by hand surfaced something structural: **almost every Fevered face is the same effect with a different target.** That means you don't author 24 cards. You author 12 with an override.

```ts
type Target =
  | 'self' | 'choose' | 'left' | 'all'
  | 'mostSigns' | 'fewestCards' | 'leftmostSlot' | 'firstTriggered';

type Op =
  | { op: 'draw';      n: number; target: Target }
  | { op: 'damage';    n: number; target: Target }
  | { op: 'grit';      n: number }
  | { op: 'actions';   n: number }
  | { op: 'whisper';   n: number }
  | { op: 'trash';     n: number; from: 'hand' | 'deck'; target: Target }
  | { op: 'gainCard';  filter: CardFilter; target: Target }
  | { op: 'destroy';   target: Target }
  | { op: 'recover';   target: Target }     // boneyard -> discard
  | { op: 'prevent';   n: number; target: Target };

interface Card {
  id: CardId;
  name: string;
  type: 'kit' | 'deed' | 'sign' | 'scar' | 'trouble' | 'omen' | 'mythos';
  cost?: number;
  grit: number;
  whispers?: number;
  ops: Op[];
  constraints?: Constraint[];
  fevered?: {
    name: string;
    retarget?: Partial<Record<number, Target>>;  // op index -> new target
    appendOps?: Op[];
    constraints?: Constraint[];
  };
}
```

Three mechanisms cover all twelve pairs:

- **retarget** — the Colt, the Parson, Stake the Claim, Night Watch, the Coyote
- **appendOps** — Salt Line (`+whisper`), the Ledger (`discard hand`)
- **constraints** — the Hymn (`mustPlayOnDraw`), Prospector's Certainty (`mustBuySignIfAble`)

If a Fevered face needs code rather than one of those three, that's a signal the twist is too clever and will confuse players too.

---

## 6. Choices and the pause

Any op needing player input sets `state.pending` and stops resolution mid-effect:

```ts
interface PendingChoice {
  id: string;
  player: PlayerId;
  prompt: string;
  options: { key: string; label: string }[];
  min: number; max: number;
  resume: ResumeToken;   // serializable continuation
}
```

Ops resolve one at a time off a queue held in state, so a pause can survive serialization. Do **not** use JS generators or promises for this — they don't serialize, and you'll lose replay.

Bots answer `PendingChoice` through the same interface humans do. No special-casing.

---

## 7. Hidden information

```ts
function playerView(s: GameState, viewer: PlayerId | 'spectator'): ClientState;
```

Strips: other players' roles, hands, and deck order; the contents of undrawn supply decks; the Marked player's secret aim. Replaces them with counts.

Two rules that will save you later:

1. The server sends `playerView` output only. Never the full state, not even "temporarily for debugging." Traitor games leak through devtools.
2. Bots run through `playerView` too, not the raw state. Same code path as a human client, so you cannot ship a leak that only exists in one mode — and a bot can fill a seat online without the server special-casing it.

`role` visibility opens up at the Turning. Model that as a derived field (`revealedRoles: PlayerId[]`) rather than mutating `role`, or replays break.

---

## 8. The simulator — the actual deliverable

Node CLI, no UI. Bot policies as pure functions `(view, legal) => Command`:

| Bot | Behaviour |
|---|---|
| `Random` | uniform over legal commands — noise floor |
| `Greedy` | always buys the highest-cost affordable card |
| `Puritan` | never buys a Sign |
| `Zealot` | buys a Sign whenever affordable |
| `Balanced` | buys Signs only below a Whisper threshold |

Run the grid, output CSV, and read off:

- **Turning round distribution** — you want a tight cluster around 60% of game length.
- **`Puritan` vs `Zealot` win rate.** *If either exceeds ~55%, your central tension is broken.* This is the single most important number in the whole project.
- Average Signs held at the Turning
- First-elimination round (deck-as-health is the riskiest mechanic; watch for round-4 deaths)
- Games where the Provision deck dried up before round 5

Everything tunable lives in `tuning.json` — `whisperThreshold`, `vesselClear`, `doomTarget`, `startingDeckSize`, `signCostCurve`, `damagePerHit`. The sim sweeps that file; no code changes to rebalance.

---

## 9. Milestones

1. **Content schema + engine core.** Types, RNG, reducer, `legalCommands`, op interpreter. Vitest throughout — this is the one part of the project where TDD genuinely pays, because the corruption rules are subtle and you'll refactor them constantly.
2. **Simulator + bots.** Tune the numbers. Ship nothing to humans yet.
3. **Online client.** ✅ Built. `server/` (room, lobby, hub, ws) and `client/` (Vite + React). Networked from the start, with or without bots filling seats. Hotseat was dropped: the whole point of a hidden-role game is that each player has their own screen, and the shield-screen dance was solving a problem we no longer have.
4. ~~Networked play~~ — folded into milestone 3.

---

## 10. When you get to multiplayer

Your engine is already authoritative-ready, so a thin server is maybe 300 lines: rooms, `apply` on the server, broadcast `playerView` deltas per socket. Socket.io or plain WebSocket.

Bots come free: `sim/bots.ts` policies are already `(playerView, legalCommands) => Command`, which is exactly a networked client's interface. Seat one server-side and it cannot tell the difference — that is the payoff for never letting a bot touch `GameState`.

**boardgame.io** would give you turn order, secret state, lobby, and MCTS bots for free. Worth an honest look — but it wants to own your state shape, its maintenance has been thin, and you'd be building the simulator anyway. The hand-rolled path costs you a weekend at milestone 4 and keeps the core yours.

**Colyseus** is the middle option: authoritative rooms, TS-native, good state-sync primitives, agnostic about your rules.

Skip peer-to-peer entirely. Hidden roles plus trusted clients is a cheating vector, and the Marked player is precisely the person motivated to exploit it.

---

## 11. Disconnects

**Ruled.** A dropped seat starts a timer.

- **If players remain**, the timer runs, then the rest are prompted to **vote**:
  replace the seat with a bot, or keep waiting. Waiting resets the timer.
- **If nobody remains**, the timer runs down and the lobby closes unless someone
  reconnects.

Five things that fall out of it, and the first three are specific to this being a
hidden-role game:

1. **Show the tally, never the ballots.** Who voted to botify whom is a read on
   the table. Publish the outcome only.
2. **A bot inherits the seat's secret role**, Marked included — it must, or
   replacing a player would reveal one. `sim/bots.ts` already has a `Marked`
   policy that withholds its Signs until the aim is met, so this works today. Be
   aware it plays the role *consistently*, which is itself a tell a distracted
   human would not have given.
3. **A bot is not a handicap.** A Balanced bot wins 47% — quite possibly better
   than the player who dropped. "Replace with a bot" is not obviously a
   punishment, and the Marked player may well want a strong posse seat botified
   for reasons of their own. That is fine; it just is not a neutral option.
4. **Cap the extensions.** "Keep waiting" resets the timer, so an unbounded vote
   is an unbounded stall. Give it a fixed number of rounds, then botify.
5. **Closing a lobby need not lose the game.** `seed` + the ordered command list
   reconstructs any game exactly (invariant 1), so persisting the log makes
   shutdown recoverable and costs almost nothing. Worth doing — a hidden-role
   game that dies to one bad connection is a game people stop starting.

One asymmetry to handle separately: **if the Vessel drops in Act II, the entire
opposition is gone** and the posse cannot proceed at all. That seat probably
wants a shorter timer, or straight to a bot without a vote.

---

## Open questions to resolve in code

- **Simultaneity.** The PnP has players acting in turn order, but Menace resolution at Dusk hits everyone. Decide whether Dusk is a real phase players can respond in, or pure resolution. Pure is simpler and probably right.
- ~~**Revenant turn position.**~~ **Ruled: original turn order** — a Revenant keeps the seat they had. They therefore act on less information than if they moved last, which is the point: they are not owed a better view for having fallen. Already how the engine behaves.
- **Old One deck recycling.** "Shrinks by one card each recycle" needs a floor, or the endgame stalls with an empty-handed Old One.
- **Undo.** Nearly impossible in hidden-role multiplayer, and with hotseat dropped there is no mode where it is cheap. Recommend: no undo. Decide early, because "just add undo later" is how information leaks get built.
- **Reaction windows.** Not needed — see CLAUDE.md. All three cards that looked like interrupts are turn-based effects.
- ~~**Disconnects.**~~ **Ruled** — see §11.
