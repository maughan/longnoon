# The Long Noon — Engine + Simulator (Milestones 1–2)

Pure, deterministic, headless rules engine, plus the bot simulator that exists to
replace the paper prototype's guessed numbers with measurements. No React, no
I/O, no runtime dependencies.

```bash
npm install
npm run check      # typecheck + determinism lint + 99 tests
npm run test:watch

npm run serve                    # the game server on ws://127.0.0.1:8787
npm run client                   # the UI on http://localhost:5173

npm run sim                      # the headline experiment: Puritan vs Zealot
npm run sim -- diagnose          # win-condition audit — why did the posse lose?
npm run sim -- mixed             # one table, a different policy per seat
npm run sim -- sweep             # the TUNING grid
npm run sim -- all --games=300
```

**Read [`sim/FINDINGS.md`](sim/FINDINGS.md) before touching `TUNING` or any Act II
rule.** Several values there are measured, and two card rules are load-bearing
for the balance.

Open the folder in VS Code and install the **Vitest** extension for inline test
running. `strict` is on; there are no `any`s in `engine/`.

## Layout

```
engine/
  state.ts     types - everything JSON-serializable
  rng.ts       seeded mulberry32, cursor stored in state
  setup.ts     game construction
  effects.ts   op interpreter, targeting, the resolution queue
  reducer.ts   apply(), round structure, the Turning, win checks
  legal.ts     legalCommands() - drives UI buttons AND bot action space
  view.ts      playerView() - the only thing a client may receive
  index.ts     the public surface
content/
  cards.ts     all 12 Signs with Fevered overrides, 10 Provisions, threats, TUNING
server/
  room.ts      GameRoom — the authority; transport-agnostic, bots seated in it
  lobby.ts     presence, disconnect timers, the botify vote
  hub.ts       rooms, connections, seat tokens, message routing
  protocol.ts  wire messages, shared with the client
  ws.ts        the WebSocket binding — the ONLY file that reads a clock or does I/O
  serve.ts     entry point
client/
  src/net.ts   the socket, and everything the client knows
  src/App.tsx  lobby and table
  src/style.css
  events.ts    which events a seat may be told about
sim/
  bots.ts      policies — differ ONLY in what they buy
  run.ts       game runner and per-game metrics
  report.ts    aggregation, tables, CSV
  diagnose.ts  win-condition audit
  cli.ts       headline | diagnose | mixed | sweep | all
  FINDINGS.md  milestone 2 results
tests/
  engine.test.ts
  actii.test.ts   Act II rules: the Vessel, Omens, Fevered faces, the Marked aim
  room.test.ts    the server: authority, leaks, bot seats
  lobby.test.ts   disconnect timers and the vote, on a fake clock
  hub.test.ts     joining, seat tokens, and not acting as someone else
  ws.test.ts      end-to-end over a real socket
  sim.test.ts
scripts/
  lint-determinism.mjs
```

## Three invariants the tests enforce

1. **Determinism.** `seed` + command list reconstructs an identical game.
   `Math.random` is banned from `engine/` by a lint script.
2. **`apply` is pure.** It clones, mutates the clone, returns it. A test asserts
   the input state is byte-identical afterwards.
3. **No leaks.** `playerView` output is asserted not to contain the string
   `marked` for a player who shouldn't see it.

## What milestone 1 revealed

**The Coyote needed a new op.** Eleven of the twelve Fevered faces expressed
cleanly as retarget / appendOps / constraints. `The Coyote Asks After You` is an
*information leak*, not an effect change, so `revealHand` was added as an op atom
and `playerView` now conditionally exposes a revealed hand. The schema bet held
at 11/12, which is a good sign — but watch for this: if you find yourself adding
an op per card, the abstraction is failing.

**The paper rules contradict themselves on damage.** One line says damage trashes
"Provisions and Kit before Signs"; another says Signs can never be trashed at all.
Taken literally, the second makes a fully corrupted player immortal — nothing can
touch their deck. Implemented as: non-Signs first, then Signs once nothing else
remains. **This needs a ruling before playtesting**, because it directly governs
whether Sign-heavy play is self-limiting or dominant.

## Stubs and known gaps

- `prevent` and `scry` are no-ops that resolve silently. Both need a reaction
  window, which is a design decision, not a coding one.
- `last-words` uses a `passive` string tag; passives aren't wired to triggers yet.
- Constraints (`mustPlayOnDraw`, `mustBuySignIfAble`) are stored on cards but not
  enforced by `legalCommands`.
- Bounty rewards on Act I Trouble cards aren't modelled — only Clear and Menace.

Resolved since: the Marked player's secret aim now grants its +3 Doom, and Menace
tie-breaking was measured and fixed (it sent every hit to one seat).

## What milestone 2 revealed

Full detail in [`sim/FINDINGS.md`](sim/FINDINGS.md).

Act II was missing three mechanics the paper prototype specifies — the Vessel
was not a damage target, the Vessel and Revenants could not aim their Fevered
cards, and the Omen reset was absent. Those are now implemented and tested, which
made the corruption economy measurable for the first time.

Some Fevered Signs were then given a Vessel-facing damage op so that Signs pay
off in Act II instead of being dead weight, under two rules that keep them from
being strictly better than Provisions: **no card both clears the Street and
wounds the Vessel**, and each Vessel-facing face **trashes a card off your own
deck**. The Omen gate was dropped — it deadlocked, because clearing Threats
suppresses the overflow that is the only way to remove an Omen.

**Both of DESIGN.md §2's design tests pass** (with a Marked player, n=400):

| policy | posse win | Turning at % of length |
|---|---|---|
| **Balanced** | **47.0%** | **59.1%** |
| Greedy (dearest card) | 35.5% | 58.5% |
| Puritan (0 Signs) | 32.0% | 78.0% |
| Zealot (Signs on sight) | 18.5% | 58.3% |

The middle is the best play by a clear margin (z ≈ 3.3 over Greedy, 4.4 over
Puritan), nothing clears 55%, and the Turning lands on its ~60% target. Act II is
a ~5-round attritional duel.

**The corruption curve is real.** Sweeping how freely a policy buys Signs gives a
genuine interior optimum — not zero, not maximum:

| Sign-buying stance | posse win |
|---|---|
| never buy (Puritan) | 32.4% |
| **0.15** | **44.0%** |
| 0.50 | 40.8% |
| always buy (Zealot) | 19.2% |

That curve is the thing the simulator was built to find (DESIGN.md §2: *"the
optimum lands in the middle. This is the whole game."*).

## Milestone 3 — the online client (started)

`server/room.ts` is in: a `GameRoom` that owns `GameState`, seats humans and bots
side by side, gates every inbound command through `isLegal`, and hands each seat
nothing but its own `playerView` plus the events it is allowed to see. It is
**transport-agnostic** — no sockets, no timers — so it is driven directly by
tests. A WebSocket layer wraps it; the UI comes after.

Building it caught one leak the view layer could not: **`SCRIED` names the card
the scryer pushed to the top of the Threat deck.** Broadcasting the raw event log
would have handed the whole table what someone paid a Sign to learn.
`server/events.ts` is the second half of invariant 3.

`server/lobby.ts` implements the disconnect ruling (`docs/tech-spec.md` §11):
grace period, then the remaining players vote to botify or keep waiting, with
"wait" resetting the clock a capped number of times. An empty lobby is *not*
botified — there is nobody to play it out for — it simply runs its timer down and
closes unless someone returns. **The lobby never reads a clock**: every entry
point takes `now`, so it stays under the determinism lint and every timeout is
testable without waiting for one.

`server/hub.ts` holds rooms, connections and seat tokens, and routes messages —
still transport-agnostic, so `handle(conn, msg, now)` returns the envelopes to
send. Two properties it exists to guarantee:

- **A `command` message carries no seat.** The server resolves it from the
  connection, so one player cannot act as another.
- **Seat tokens never derive from the game seed.** They come from
  `randomUUID`, because anyone holding a replay could otherwise compute a token,
  reclaim that seat, and read its hidden role.

`server/ws.ts` is the transport, and the only file in the project permitted to
read a clock or touch I/O — the determinism lint has a one-file exemption for it.
Everything beneath takes `now` as a parameter, which is what makes the disconnect
timers testable instantly rather than by waiting. `tests/ws.test.ts` drives a
real socket end to end.

`client/` is a Vite + React app. It is deliberately dumb: it renders `view` and
enables exactly the buttons in `legal`. **It cannot derive what is possible** —
`legalCommands` needs `GameState` and a client only ever holds `playerView`
output — so the server sends the legal list with every state update. That keeps
tech-spec.md §4's promise: one function drives both the UI's button state and the
bots' action space, with no second implementation to drift.

Run `npm run serve` and `npm run client` together to play.

Milestone 3 is functionally complete, and the first playtest has been folded in:
Threats now scale with table size (the Street was sitting empty 16% of Act I),
cleared Trouble recycles, the starting deck is 12, your deck and discard are
visible, market cards explain themselves, and bot turns play out one action at a
time instead of resolving in a flash.

## Notes on milestone 3

Networked from the start, with bots able to fill empty seats (hotseat was
dropped). The engine is already shaped for it: `playerView` is the only thing a
client ever receives, and the simulator's bots already speak that exact
interface, so one can be seated server-side unchanged. Validate inbound commands
with `isLegal` before `apply`.

Remaining engine work first:

- **A designer's call.** The ~60% Turning target and "Act II, short and violent,
  roughly three rounds" are mutually exclusive at any Act I long enough to build
  a deck. The Turning currently lands at 77%.
Both remaining design questions are now ruled: **disconnects** (timer, then a
vote to botify or wait — `docs/tech-spec.md` §11) and **Revenant turn position**
(original turn order, already implemented).
