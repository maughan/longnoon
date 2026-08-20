# CLAUDE.md — The Long Noon

Project context for Claude Code. Read this before touching anything.

## What this is

A weird-western deck builder about cowboys and cosmic horror, for 3–5 players,
targeting **40 minutes**. It exists as a paper prototype (`docs/the-long-noon-v1.pdf`)
and a TypeScript rules engine (this repo). The engine came first deliberately —
see "Why the engine came first" below.

Design rationale lives in `DESIGN.md`. Architecture lives in `docs/tech-spec.md`.
This file is the operating manual.

## Current status

**Milestones 1–2 complete.** 99 tests passing, `tsc --noEmit` clean.

```bash
npm install
npm run check     # typecheck + determinism lint + tests
npm run test:watch
npm run sim       # headline | diagnose | mixed | sweep | all
```

**The tuning has been re-derived** after two simulator bugs (bots bought only 3
of 12 Signs; bots played every Sign they drew). DESIGN.md §2's two named tests
pass — Balanced 51.7%, Zealot 32.3%, Puritan 28.0%, Turning at 59.6%.

**Watch for Sign-hoarding exploits.** A Sign's Whispers are charged **on play,
not on purchase**, so any Sign you never play is free power — Grit 2 every
reshuffle plus its Fevered face at the Turning. That made "buy the dearest card"
win 96.5% via `Last Words`, whose passive was unimplemented and which had been
given Vessel-facing damage. Fixed, but the rule stands: **never give a
Vessel-facing Fevered face to a Sign with no reason to be played.**

**Both design tests pass** at n=400 with a Marked player: Balanced 47.0%, Greedy
35.5%, Puritan 32.0%, Zealot 18.5%, Turning at 59.1%. Sweeping the Sign-buying
ratio gives an interior optimum (0.00 → 32.4%, **0.15 → 44.0%**, 0.50 → 40.8%,
1.00 → 19.2%) — the corruption curve DESIGN.md §2 asks for.

**`balanced(ratio)`'s default is measured, not chosen.** It sat at 0.5 from
before `whisperThreshold` was tuned 12 → 26, which moved its brake to the last
two rounds of Act I and made it a Greedy clone. If you retune
`whisperThreshold`, **re-sweep the ratio** — it is expressed as a fraction of the
threshold, so it silently follows it.

**When a mechanic "does nothing", suspect the bots first.** That has now been the
answer three times (burial, the Vessel-facing Signs, the defensive Signs).

Milestone 3 is not started: **an online client**, with or without bots filling seats.

## The Vessel is the player. The Old One is the fiction.

One entity, two layers, and **only the player layer is allowed in the
interface.** This was relitigated once because a single seat carried two tags —
`status: 'oldOne'` beside `state.vessel` — and nobody could say what the
difference was, because there is none.

- **VESSEL** — a status, a seat, a tag in the player list, a thing you can
  shoot. The only word in rules text, `legalCommands`, state, or any UI.
- **THE OLD ONE** — what is *using* the Vessel. Never a player, never a status,
  never a tag, never in the player list. It is what the Doom track counts and
  what came through the door at the Turning. You never interact with it, so it
  does not need a seat.

The posse's win condition says it: they **bury the Vessel**, a body. Closing the
door is not killing what is behind it.

**Three deliberate exceptions**, and only three:

1. **The Turning** — the moment the Old One arrives. `Turning.tsx`,
   `turning.css` and the audio are built around that beat. Once, at possession,
   never again in the interface.
2. **`winner: 'posse' | 'oldOne'`** and `sim`'s matching `Outcome` — a SIDE, not
   a seat. A Revenant wins with the Old One's side without ever being the
   Vessel, and it is never rendered (the client prints "The long noon").
3. **Glossary lines about the side or the clock** — "Doom is the Old One's
   clock", "you win only if the Old One wins". The fiction, correctly.

**The verdict screen says whether YOU won**, and that is a different question
from which side did. `winner` is a side, and three seats at a losing table are
on the winning one: the Marked player, the Vessel, and anybody who fell —
including a seat that burned out, since only a Revenant can. The screen used to
print "The long noon" to a traitor who had just pulled it off and leave them to
work out that they had. `client/src/verdict.ts` holds the one function that
decides it, out of the component and JSX-free so `tests/verdict.test.ts` can
reach it from the root project.

`tests/whispers.test.ts` enforces the rest: `state.vessel` and
`status === 'vessel'` must always name the same seat, no client payload may
contain `oldOne`, and no engine file may carry an `'oldOne'` status outside a
comment or a winner.

## The three invariants — do not break these

1. **Determinism.** `seed` + ordered command list must reconstruct an identical
   game. The RNG cursor lives in `GameState`, never in a closure. `Math.random`
   is banned from `engine/` and `content/` by `npm run lint:determinism`.
2. **`apply` is pure.** It `structuredClone`s, mutates the clone, returns it.
   A test asserts the input state is byte-identical afterwards.
3. **No information leaks.** `playerView(state, viewer)` is the *only* thing a
   client may receive. Never send `GameState` to a client, not even temporarily
   for debugging — this is a hidden-role game and devtools are a cheating vector.

Corollaries that follow from these:

- Everything in `GameState` must be JSON-serializable. No class instances, no
  functions, no `Date`, no `Map`/`Set`.
- The op resolution queue is a plain array in state, **not** a generator or
  promise chain. Generators don't serialize, and serializability is what buys
  you replay.
- Role reveal is modelled as `revealedRoles: PlayerId[]`, a derived visibility
  list. Never mutate `player.role` — replays break.

## Conventions

- `engine/` imports nothing from a future `client/`. Enforce with a lint rule if
  you add one.
- `legalCommands(state, playerId)` is the single source of truth for what is
  possible. It drives both UI button state and the simulator's bot action space.
  If you add a command, add it there or bots will never explore it.
- `apply` throws `IllegalCommand` rather than silently no-oping.
- Card behaviour is **data** in `content/cards.ts`, not code. See the schema bet
  below.
- Tuning numbers live in `TUNING` in `content/cards.ts`. Never hardcode a
  threshold in engine logic.

## The schema bet

A Fevered (corrupted) card is the same effect expressed four ways:

- **retarget** — same op, different target (`{ 0: 'leftmostSlot' }`)
- **appendOps** — a price paid *after* the effect (`{ op: 'whisper', n: 1 }`)
- **prependOps** — a price paid *before* it
- **constraints** — a compulsion (`mustPlayOnDraw`)

**`prependOps` is the fourth, and it was added on evidence.** Order is genuinely
inexpressible with the other three, and paying first is not the same move as
paying after: the effect resolves against the world the payment made. "The
Ledger Reads Itself" is the case that forced it. As
`appendOps: [discardHand]` it drew three cards and then threw the whole hand
away — a card nobody plays. Prepended, the same two ops are a wheel: dump the
hand you are stuck with, deal three fresh, and the corruption is that you no
longer choose what to keep.

**`retarget` indices count the PRINTED ops**, resolved before anything is
spliced around them, so `{ 0: ... }` still means the card's first op on a card
that also prepends. Prepended costs also survive `aimed` — the Old One and the
Revenants lose the Fevered *targeting*, never its price. Both are tested.

If a *fifth* mechanism starts looking necessary, that is the signal below —
reconsider the abstraction rather than extend it again.

Eleven of twelve Signs fit cleanly. The twelfth (`coyote`) needed a new op atom,
`revealHand`, because its twist is an information leak rather than an effect
change.

**Watch for this failure mode:** if you find yourself adding one op per card, the
abstraction is failing and should be reconsidered rather than extended. A test
(`every Sign has a Fevered face expressible in the schema`) guards this.

## Open rulings — these are design decisions, not bugs

**Damage vs. Signs — RULED, and the numbers are below** (`blindDamage: false`).
Non-Signs first, then Signs once nothing else remains. See "Blind damage was
tried and rejected".

**Revenant turn position.** Before or after living players? Changes how much
information they act on. Currently: in original turn order.

**Old One deck floor.** "Shrinks by one card per recycle" needs a minimum or the
endgame stalls with an empty-handed Old One. Currently floors at 1 card.

**Undo.** Nearly impossible in hidden-role multiplayer, and with hotseat dropped
there is no mode where it is cheap. Recommend none. Decide early — "add undo
later" is how leaks get built.

## Act II — implemented

The three missing paper-rule mechanics are in (`tests/actii.test.ts`):

- **The Vessel is a damage target.** `damage` ops reach it through the ordinary
  targeting path; `destroy` deliberately cannot. `DEAL_DAMAGE` is the bare
  1-damage action and no longer accepts a client-supplied amount.
- **The fallen aim their Fevered cards.** `opsFor(card, fevered, aimed)` drops
  the Fevered retargets for the Old One and Revenants while keeping appended
  costs. Cards resolved by CALL stay unaimed, as the paper specifies.
- **The Omen reset.** `onThreatEntered` zeroes `vesselDamage` when an Omen
  enters. No Mythos card is an Omen, so it currently only fires via SUMMON.

**Ruled: Omens no longer gate the Vessel** (`omensBlockBurial: false`). The paper
rule deadlocked — an Omen can only be removed by Street overflow, overflow needs
a full Street, and clearing Threats keeps the Street empty, so the better a table
fought the more reliably it locked itself out of winning. Zealot clears 348 Act
II Threats to 12 overflow evictions and never got a legal bury in 91% of games.
Dropping the gate took that to 0%. The other half of the same paper line — damage
resets to 0 if an Omen enters — survives; set `omensBlockBurial: true` to restore
the gate for comparison.

## A prompt that offers cards shows the cards

`PendingChoice.options` carries `cardId` when an option stands for a card, and
the client draws the face instead of a button.

The detection used to be "are the keys card ids", which worked only for prompts
that offer cards BY ID — A GIFT, FREELY GIVEN's Sign list. Everything keyed by
**uid** fell through to a column of buttons: scry, recover, and a Provision off
the shelf. A pile can hold two of the same card, so those have to be keyed by
uid — "a Saddlebag" is not an instruction when four are lying there — which
meant the key could never carry the identity as well.

Scrying was the worst of the three, and it is what got this noticed: a card you
paid a Sign to look at, shown to you as its name in a box.

**No leak.** `playerView` sends `pending` only to the player it belongs to, and
that player is already being told the card's name.

**Slot prompts deliberately still render as buttons.** Those name Threats in the
Street, which is on the board behind the prompt — four more faces would be the
same cards twice.

## A Bounty Provision is chosen, and the shelf refills behind it

`gainCard` from the Provision row did `shift()` — the leftmost card, which is
arrival order and reads as a dice roll. Same ruling as `recover` and `trash`
before it: a rule you can see is a rule you can play around, one you cannot is
just a card arriving. It now asks, keyed by uid because the row can hold two of
the same card.

**And it refills the row afterwards, which it did not.** `BUY` always has; a
Bounty quietly shrank the shelf for the rest of the game. Four Act I Threats pay
one, so a table that cleared well ended up shopping from a SHORTER shelf than a
table that did not — the exact opposite of what a Bounty is for. The Provision
deck is the finite thing (`provisionCount`); the row is a window onto it.

**`chosen` means two different things in that op** and the comment says so: a
row uid for the Provision case, a player id otherwise. They cannot both be in
flight because no card asks for both — one that did would need `gift`'s
two-prompt shape, with the first answer stored on the op.

**Measured: 3.1 prompts a game, and about +3pp.** Balanced 51.8% -> 54.7%,
mixed 34.0% -> 38.2%. Unlike most of today's small results these move the SAME
way, which is what a real effect looks like rather than noise — and it should,
since both halves help the posse: a chosen card beats the leftmost one, and the
refill puts more Provisions on the table over a game.

**Worth a retune if it stands.** Balanced at 54.7% is at the top of the band,
and `vesselClear` 15 -> 16 is the lever — it measured 50.4% earlier under
`buyToHand`, though that was before the Omen Tolls.

**The bot needed the branch.** Row uids match none of `resolvePending`'s cases,
so it would have fallen through to `legal[0]` — the leftmost card, which is the
rule being replaced. Ninth time a mechanic would have gone on measuring its own
predecessor.

## Omens name a price now

Dynamite was the only answer to an Omen in the game, so a table that had not
bought one had no play at all: **39.3% of games ended with an Omen still
standing** (same seeds, measured immediately before this change). An Omen cannot
be cleared, cannot be pushed out since overflow stopped discarding, and does not
even escalate — it just sits in a slot, menacing and dripping Whispers, and it
is most of what "nothing to do on my turn" turns out to mean.

Each Omen now carries a **Toll**, through the machinery Act II Threats already
used — DESIGN.md §7's third line, `Card.toll` and `PAY_TOLL`, and
`legalCommands` only ever offers one the player can actually meet.

**Three Omens, three currencies, deliberately:**

| Omen | price |
|---|---|
| Dead Cattle, No Wounds | **3 Grit** — the plain price, costs only the turn |
| The Well Tastes Like Pennies | **a Scar** — Dynamite's bargain: clear the dread by taking on more |
| The Preacher Won't Come Out | **burn a Sign** — the mirror of what the Vessel does with them |

Which Omen is cheap depends on how you have been playing. A Puritan holds no
Sign to burn and a Zealot always does — and because the prices differ, no way of
playing locks you out of every Omen in the game. There is a test for exactly
that.

**Measured, 150 games: 2.03 Omen Tolls paid per game, and games ending with an
Omen standing fall 39.3% -> 22.0%.** Balance is unmoved — Balanced 55.6% ->
51.8% and mixed 32.0% -> 34.0%, opposite directions again, which is noise and
not an effect. That is the right result: an action plus a real price for each
Omen is counterplay, not a gift.

**`payGrit` is a new op**, and the reason is `canPay`. A Toll is only offered
when it can be met, so the price has to be something the checker can inspect
before the button is drawn — a negative `grit` would have been a price it could
not see.

## The Colt is depth, Dynamite is breadth

They used to both read "destroy a Threat", which wasted a slot in a set of
twelve. The split is what fixed that.

- **THE COLT** — destroy one Threat. Fevered (`It Chooses`) is a **pure
  retarget**: it still never misses, what corruption takes is the choosing. No
  appended ops, no constraints. If it ever needs more than a retarget,
  something has gone wrong.
- **DYNAMITE** — 2 damage to every Threat, or **destroy one Omen and take a
  Scar**. The only Omen counterplay in the game: the only way to clear the
  dread is to take on more corruption.

**`banishOmen` is written FIRST on the card** because taking it clears the
resolution queue — that is what "may instead" means. Both Fevered differences
are then ordinary mechanisms: `retarget {0: 'all'}` spreads the Scar,
`appendOps` spreads the blast, and the appended blast is skipped automatically
on the Omen branch because the queue is already empty. No new Fevered mechanism.

### Ruled: `destroy` stays on the Colt, and the argument against it was right

`destroy` **sits outside the pace engine.** Escalation is what makes the game
harder — an unresolved Threat gains +1 Clear every Dusk — and an auto-answer is
immune to it, where damage degrades as intended. The Colt was 4 damage for
exactly that reason, and it was reverted anyway, because the argument was right
and the price was still too high. Measured, mixed table:

| | posse win |
|---|---|
| before the card work | 26.0% |
| Colt as 4 damage + new Dynamite | **5.7%** |
| Colt back to destroy + new Dynamite | **15.7%** |

So the Colt was worth ~10pp and **Dynamite is the other ~10pp** — going from
"destroy any Threat" to "2 damage to all, or an Omen" is the larger nerf of the
two, and it is still in. Do not re-open the Colt without that in view.

**Watch for this if damage is ever tried again.** `target: 'choose'` SILENTLY
acquires the Vessel in Act II — `choiceOptions` adds it for any damage op — so
the 4-damage Colt was a Sign that both cleared the Street and wounded the
Vessel, which is the combination that made Zealot win 90–100% of every cell.
The declared target still read `choose`. There was briefly a `noVessel` opt-out
flag; it went with the revert, because an escape hatch no card sets is one a
future author finds at the exact moment they are least likely to question it.
The rule is now stated in `tests/actii.test.ts` as **no Sign may have choosable
damage at all**, which needs nothing to be remembered.

### Ruled: `coltFeveredTarget: 'random'`

Measured over 400 real Act II boards, scoring each mode against the shot a
competent player would have taken:

| mode | value kept | hits best | post-Turning win | sd across blocks |
|---|---|---|---|---|
| leftmostSlot | 59.5% | 32.6% | 45.4% | 10.6 |
| **random** | 67.4% | 50.0% | **41.4%** | 4.7 |
| lowestClear | 90.5% | 58.4% | 48.5% | 5.5 |

Two results worth not relearning. **`lowestClear` is barely a corruption** — with
4 damage against ~2.3 Threats, finishing the easiest one is usually what you
would have done anyway, so it keeps 90% of the best shot and has the highest win
rate. A Fevered face drifting toward an upgrade is the one thing the design
cannot allow. And **`random` does not widen the win distribution** the way it was
expected to (sd 4.7 vs leftmostSlot's 10.6) — leftmostSlot is the volatile one,
because whether the leftmost slot is the right slot is pure arrival order.

### Ruled: Dynamite costs 4 — and read this before re-sweeping it

Omen counterplay is the number that decided it. Games ending with an Omen still
in the Street: **97.5% at cost 3, 42.5% at 4, 27.0% at 5.**

**The price sweep measures the BOTS, not the card.** `Balanced` and `Greedy` buy
through `dearest()` — the most expensive affordable Sign — so purchase share
tracks price RANK. It is non-monotonic for exactly that reason: bought more at 5
than at 3, because at 5 it outranks the Colt. The "above 30% is an auto-include"
test is unmeasurable until a value-aware `pick` exists.

### Ruled: `vesselClear` 14 -> 12, and the posse is still short

Same-policy tables, 120 games a cell:

| `vesselClear` | Puritan | Zealot | Balanced | Greedy |
|---|---|---|---|---|
| 10 | 0.0% | 10.8% | 37.5% | 36.7% |
| **12** | 0.0% | 7.5% | **33.3%** | 25.8% |
| 14 | 0.0% | 2.5% | 27.5% | 16.7% |

The interior optimum holds at every value — Balanced beats both extremes
throughout — so this was a pure difficulty dial, not a change in shape.

**Mixed table: 18.3%**, against 26.0% before the card work. The three moves
went 26.0 -> 5.7 (Colt as damage) -> 15.7 (Colt reverted) -> 18.3
(`vesselClear` 12). Still ~8pp short, and the remainder is Dynamite: "destroy
any Threat" -> "2 damage to all, or an Omen" is the single biggest change in
the pass and it is staying, because Omen counterplay is worth more than the
win rate it costs. **If the gap needs closing, Dynamite is the lever, not this
number** — it has now absorbed four consecutive changes and is doing more work
than any one number should.

Watch the other rows while you do: early deaths sit at **72%**, which predates
all of this and is tracked under "Still open: falls are early now".

## Buying costs no action (`buyCostsAction: false`)

The turn separates into the two halves a deck builder usually has: actions do
things to the board, Grit buys. Cashing in never cost an action either, so this
finishes a split that was already half made.

**It is the largest single change in the tuning so far.** 120 games a cell,
same-policy tables with a Marked seat:

| | Balanced | Greedy | Zealot | Puritan | mixed |
|---|---|---|---|---|---|
| buying costs an action | 28.3% | 30.0% | 2.5% | 0.0% | 14.2% |
| **buying is free** | **49.2%** | 43.3% | **26.7%** | 0.0% | **39.2%** |

Signs bought go 19.5 -> 26.1 on a mixed table, the Turning fires in 82.5% of
games against 52.5%, and it lands a round earlier (7.2 -> 6.0). Fewer games
stall in Act I, which is a real gain; the posse also wins nearly three times as
often, which is not obviously one.

**Watch the corruption curve — it flattened.** DESIGN.md §2's central test wants
an interior optimum, and the shape it used to have (0.15 -> 44.0%, 0.50 ->
40.8%, 1.00 -> 19.2%) is most of the argument that the design works. Measured
again with buying free, 120 games an arm:

| Puritan | Bal15 | Bal30 | Bal50 | Bal70 | Greedy | Zealot |
|---|---|---|---|---|---|---|
| 0.0% | 37.5% | 40.0% | 40.0% | 38.3% | **45.0%** | 22.5% |

Greed stopped being punished. **The action cost was part of the brake**: a Sign
bought used to cost tempo as well as Grit, and without that the greedy line no
longer pays for itself — Zealot goes 2.5% -> 26.7% and Greedy now edges every
Balanced arm. At n=120 the noise is about ±4.5pp so the Bal arms are a flat
band rather than four distinct numbers, but the direction is well outside it.

**If this needs rebalancing, `vesselClear` is the lever**, as ever — it is what
decides how long Act II runs. The numbers above are the "before" for whatever
that sweep turns out to be, and none of it has been retuned.

**And re-sweep `balanced(ratio)` if you do.** Its default is measured, not
chosen, and it is expressed as a fraction of `whisperThreshold` — the same
warning that already applies to retuning the threshold applies here, because
this changes what a Sign costs in practice.

**The bot needed the other half of this.** `makeBot` ended the turn the moment
`actionsLeft` hit zero, so the free purchase was legal and no bot ever made one.
The buy step is now `buyStep()` and both callers reach it — the seventh time a
mechanic has "done nothing" because of the bots.

## The starting deck is 12, not 8, and the padding is the lever

`STARTING_DECK` is an 8-card list. `startingDeckSize` is **12**. `setup` fills
the gap — so **four of the twelve cards are padding**, and the deck people
reason about is not the deck they play. This has misled at least one round of
analysis: "three of eight starting cards are blank" is really **seven of
twelve**, 58%, and 31.7% of opening hands held no attack at all against a
predicted 10.7%.

Both halves of the usual complaint come from that one edit: padding with
Saddlebags diluted the attacks AND added the blanks. They are not independent
causes, and testing them separately double-counts.

**Ruled: `padMix: ['saddlebag', 'saddlebag', 'saddlebag', 'six-gun']`** — three
Saddlebags and a Six-Gun. Opening hands with no attack go **31.7% -> 16.0%**.
Swept 200 games an arm, Act I dead hands against Zealot, because every Six-Gun
in the starting deck is one the Zealot gets for free:

| padding | dead Act I | dead Act II | esc>=3 | Zealot | Balanced |
|---|---|---|---|---|---|
| 4 sad / 0 gun (was) | 50.3% | 43.1% | 75.0% | 6.0% | 41.0% |
| **3 sad / 1 gun** | **37.4%** | 42.8% | 61.7% | **11.0%** | 52.0% |
| 2 sad / 2 gun | 28.8% | 40.1% | 58.3% | 22.5% | 67.5% |
| 1 sad / 3 gun | 20.7% | 36.7% | 43.3% | 34.0% | 74.0% |
| 0 sad / 4 gun | 17.9% | 30.3% | 26.7% | **49.0%** | 74.0% |

3/1 is the best exchange rate on the curve. Past 2/2 the honest route stops
losing and DESIGN.md §2's central test goes with it.

**Two things this does NOT fix, and both were measured:**

- **Act II barely moves** (43.1% -> 42.8%, and only 30% at the extreme). Act II
  dead hands are a different problem with a different cause. No opening-deck
  tuning reaches them, so do not aim there again.
- **A card with an effect is not an attack.** The control arm swapped a
  Saddlebag for a Canteen instead of a Six-Gun: nearly identical Act I, but Act
  II *worse* (45.9%) and escalation worse (70%). Twice in one run the same
  answer — the blank-card theory on its own is wrong, it is the missing attack.

Escalation tracks dead hands almost exactly (75 -> 62 -> 58 -> 43 -> 27%). The
pace engine is not independently runaway; it runs away precisely when the posse
cannot shoot.

`starterGuns` and `padMix` are TUNING axes, and `setup` builds the deck from
them rather than from a literal — the Six-Guns are spliced in at their original
position so the default list is byte-identical and old seeds still reproduce.

### Ruled: the Saddlebag stays blank

Tested and rejected. "Look at the top card of your deck, you may discard it",
200 games an arm:

| arm | played% | dead Act I | dead Act II | scars@Turn | buys/game | Balanced |
|---|---|---|---|---|---|---|
| blank, Grit 1 (kept) | 0.0% | 39.3% | 43.5% | 0.3 | 32.5 | 57.0% |
| look 1, Grit 1 | **12.8%** | 35.9% | **48.6%** | 0.3 | 31.5 | 44.0% |
| look 1, Grit 0 | 100% | — | — | — | **6.7** | **0.0%** |
| look 2, Grit 1 | 12.8% | 35.9% | 48.6% | 0.3 | 31.5 | 46.5% |

Played 12.8% of the time — under the 15% bar for "a real choice", so the card
is still functionally blank. It buys 3.4 points of Act I dead hands and gives
back 5.1 in Act II. **Grit 0 is not a trade, it is a collapse**: the Saddlebag
is a third of the deck's money, buys fall 32.5 -> 6.7, almost no game reaches
Act II, and every policy wins 0%. The dashes are empty samples, not good news.

**The `sift` op has been deleted** rather than left inert.

Two things worth keeping from the run:

- **Look-1 and look-2 were byte-identical**, because the bot's policy was
  "discard a Scar, keep anything else" and Scars average 0.3 per player at the
  Turning. Seeing two cards almost never surfaces a second Scar. Any future
  version of this experiment is measuring the POLICY at least as much as the
  card, and those numbers are a floor rather than an estimate.
- **No damage to the corruption economy**, which was the thing to watch: Scars
  at the Turning were 0.3 in every viable arm, identical to control. A one-card
  look cannot dodge a Scar because Scars are too rare to find.

**Third independent confirmation that a card with an effect is not an attack**
(after the Canteen padding arm and the Canteen substitution arm). The
blank-card theory is wrong on its own; dead hands are attack density.

## "Nothing to do on my turn" is a SEAT problem

From a playtest, and the second telling of it is the one that matters: by the
time the round reaches the last player the table in front of them has cleared
the Street, so all they can do is sell cards and pass — **and it is the same
person every round, because turn order is fixed for the whole game.**

Averaged over all posse turns this is invisible. Split by seat it is glaring.
4 players, 150 games:

| seat | turns | nothing clearable in the Street | only sell/buy |
|---|---|---|---|
| p0 (first) | 903 | 0.9% | 0.7% |
| p1 | 1306 | 4.7% | 1.6% |
| p2 | 1330 | 17.7% | 3.9% |
| **p3 (last)** | 1271 | **33.2%** | **6.7%** |

A 37x spread across the table, owned by whoever sat down last, for the whole
game. **The bots are the WEAK instrument here** — they spread damage and
misplay, where a table talking to each other clears the Street more thoroughly,
so a real game is worse than this.

### Ruled: rotate the start of the round (`rotateStart`)

`startSeat` moves one chair each Dawn. Measured, same 150 games:

| seat | p0 | p1 | p2 | p3 |
|---|---|---|---|---|
| nothing clearable, fixed | 0.9% | 4.7% | 17.7% | 33.2% |
| **rotating** | 17.5% | 11.1% | 13.1% | 15.7% |
| only sell/buy, fixed | 0.7% | 1.6% | 3.9% | 6.7% |
| **rotating** | 1.7% | 3.1% | 3.5% | 3.7% |

Flat. The worst seat goes from a third of its turns with nothing to clear to a
sixth, and from 6.7% to 3.7% of turns spent selling and passing.

**Balance cost: none measurable.** Three blocks of 150 games — Balanced 47.8%
both ways, Puritan 0.4% both ways, mixed 41.1% -> 39.1%. Zealot reads 27.1% ->
21.8% (31/25/25 against 19/21/25), which overlaps and is not resolvable at this n.

### Rotation shares the problem out; refilling removes it — measured together

`refillNoClearable` is the stronger version of the refill idea, aimed at the
number that hurts rather than at the empty board: a Threat arrives when the
Street holds nothing that can be CLEARED. 120 games for the seat figures, 300
each for the win rates:

| | nothing clearable | by seat (p0..p3) | worst seat idle | Balanced | mixed |
|---|---|---|---|---|---|
| as-is | 14.1% | 0 / 4 / 15 / **34** | 5.7% | 56.0% | 43.0% |
| rotate | 15.2% | 17 / 12 / 15 / 18 | 4.6% | 52.0% | 40.3% |
| **refill-noclearable** | **2.1%** | 1 / 1 / 2 / 4 | 2.8% | **43.3%** | **29.0%** |
| both | 1.6% | 2 / 1 / 1 / 1 | 2.8% | 37.0% | 27.7% |

**They fix different things and the numbers say so.** Rotation moves the
problem around the table and leaves the total alone (14.1% -> 15.2%). Refilling
takes the total out — 14.1% -> 2.1% — and flattens the seats as a side effect,
because a Street that is never bare is never bare for the last player either.

**Refilling is not free.** Balanced -12.7pp, mixed -14.0pp: every refill is
another Threat menacing at Dusk and, in Act II, another point of Doom. It is a
difficulty change and wants `vesselClear` brought down to pay for it. Rotation
costs somewhere between nothing and 4pp — two separate runs put it at 0.0 and
4.0, which at these block sizes is one number that cannot be resolved.

### Committed: both rules on, `vesselClear` 12 -> 11

Re-measured against the FIXED rotation, three blocks of 150 plus 450 mixed:

| `vesselClear` | Balanced | mixed |
|---|---|---|
| **11** | **51.3%** (52/51/51) | 36.9% |
| 12 | 42.9% (41/45/42) | 32.4% |
| 13 | 38.4% (40/35/40) | 28.7% |

11, against a pre-change baseline of ~48%. Zealot sits at 26.9% and Puritan at
0%, so DESIGN.md §2's test passes with room.

**The earlier sweep of this same grid read 43.6% at 11 and is superseded.** It
ran before the double-turn fix, and free double turns for the Vessel were worth
about 8pp to the Old One. A balance number measured across a rules bug is a
number for a game nobody is playing.

**Turning these on cost 19 test failures**, and that is the honest price of a
rule that rewrites the board at the start of a turn. Most were fixtures built by
hand and then perturbed — `tests/engine.test.ts` and `tests/actii.test.ts` now
shadow `setup` so every fixture in them runs with both rules OFF, and a test
whose SUBJECT is either rule turns it back on in `tuning`. Two were real, and
are the bugs listed above.

**Rotation redistributes; it does not reduce.** If the goal is FEWER such turns
rather than a fair share of them, refilling is the answer and the retune is the
price. The underlying cause is Omen counterplay — an Omen cannot be cleared, so
a Street holding one is a Street with less to do, and Dynamite is the only
answer in the game.

**The Vessel and a thinned table**, both tested in `tests/actii.test.ts`:

- **The Vessel rotates like anybody else.** Worth stating because that seat is
  special in every other way — it cannot buy, cannot be Menaced, wins by a
  different condition — but its POSITION is not special. Rotating means the
  advantage of acting after the whole posse, summoning into a Street they can no
  longer answer, stops belonging permanently to whichever seat was named at the
  Turning.
- **`startSeat` walks over gone seats too**, and a round that begins on an empty
  chair still reaches Dusk: `advance` ends the round when the turn comes back to
  whoever began it, and a gone seat hands straight on rather than ending
  anything. Every living seat still takes exactly one turn a round with half the
  table gone.

### Nobody takes two turns across a Dusk

Raised from the table before it was ever played: with the posse down to one
player and the Vessel, rotating by one hands the seat that acted LAST the next
round's first turn — three actions, the sun goes down, three more, and nothing
in between. Correct, and worse than reported: it also happens at three seats the
moment one of them falls, so a rule counting living players would not catch it.

Stated as the thing that is actually wrong instead: **the round may not begin
with whoever ended the last one.** At two seats that resolves to "do not
rotate", which is right — with two players there is no rotation that does not
double somebody — and it falls out rather than being special-cased.

Two bugs found writing this, both in `rotateStart` and both caught by a trace
rather than by reasoning:

- **Step past the RESOLVED seat, not the raw index.** With two living seats
  either side of a gone one, `startSeat + 1` resolves forward onto the very
  player it was trying to skip. The trace read `p3@r2 p3@r3`.
- **The button passes when the round ENDS.** In `beginRound` it also fired for
  the opening deal, so the first round of the game began on the second chair.

### Saying where the button is

Rotation is invisible unless the table can read it, and a turn order people work
out by watching whose turn it turned out to be reads as a bug rather than a
rule. Two places say it:

- **`ClientState.firstPlayer`** — resolved from `startSeat` in `playerView`, and
  a `first` chip on that seat in the rail. **A word, not a glyph**: every mark in
  this game means something about a ROLE — Marked, the Vessel, a Revenant — and
  a new one on a player would be read as a fourth of those in a game whose whole
  tension is not knowing which people are which. Styled quiet for the same
  reason; it is turn bookkeeping, not a secret coming out.
- **A "Come morning" line on the Dusk sheet**, always shown where every other
  section vanishes when empty — it is the only line on that page about what
  happens NEXT. Read off the view rather than the events, because the Dusk batch
  carries the next round's start with it, so `firstPlayer` is already the new one
  by the time the report is built.

**Two implementation notes worth not rediscovering:**

- **`turnOrder` is never rotated.** A seat's index is its identity in several
  places — `markedIndex` at setup, and `sim/run.ts` maps a seat index to its
  policy on every single decision — so rotating the array would quietly hand a
  player somebody else's policy halfway through a game. `startSeat` is an index
  into a list that never moves.
- **`advance` ends the round when the turn comes back to whoever began it**,
  rather than at the end of the array. With `startSeat` at 0 that is exactly the
  old rule, so rotation needs no second code path.

## The empty Street was not it (`refillEmptyStreet`)

The first proposal for the above: if the Street is empty when a turn begins, deal
a Threat. Implemented as `refillEmptyStreet` (TUNING, **off**) through
`drawThreat` + `enterStreet`, so an arrival this way is an ordinary arrival —
same deck, same recycling, same overflow rule — and it lands BEFORE the draw, or
a card whose only op needs a target is unplayable on the turn it arrives.

**It costs nothing and it changes nothing.** Three blocks of 150 games a cell:

| | Balanced | Zealot | Puritan | mixed |
|---|---|---|---|---|
| off | 48.4% | 26.7% | 0.4% | 44.7% |
| on | 48.4% | 26.7% | 0.4% | 44.0% |

Not "within noise" — the per-block numbers are nearly identical (45/48/52
against 45/49/51). The rule fires too rarely to perturb anything.

### What the turns actually look like, 4,724 posse turns

| | share of turns |
|---|---|
| Street empty at turn start | **0.7%** |
| Street holds nothing CLEARABLE | **13.9%** |
| No attack in hand | **21.3%** |
| No card playable at all | 3.6% |
| Nothing to do but buy or end | 3.5% |

**The empty Street is not the problem — it is 0.7% of turns.** The two that
matter are a hand with no attack in it, and a Street whose Threats cannot be
cleared at all: an Omen, or an Act II card with no Clear value. In that second
case an attack is still LEGAL — damage lands on an Omen, it just achieves
nothing, since an Omen can never be cleared — so `hasLiveTarget` does not
withhold it and the player spends an action learning that.

**That 13.9% is where the feeling comes from, and it is the one worth fixing.**
Two candidate directions, neither measured: exclude Omen-only Streets from
`hasLiveTarget` for `damage` and `destroy` (careful — damage on a
`noClearWhileOmen` Threat is banked, not wasted, so it is only the pure Omen
slot that is dead), or give the posse more answers to an Omen than Dynamite.

`refillEmptyStreet` is left in and off. It is free, and it does guarantee a
board to act against; it just cannot deliver the feeling it was proposed for.

## Buying into your hand: simulated, and it is a different game

`buyToHand` (TUNING, **off**) puts a purchase in your hand instead of your
discard — a tool you can use this turn rather than a promise about a future
shuffle. Simulated, not adopted.

### It opened a loop, and the simulator found it by hanging

**Five cards cash in for exactly what they cost** — hard-tack, debt, certainty,
stake-claim and coyote, all 2 for 2 — and **neither buying nor cashing spends an
action**. Bought straight into hand, buy-and-sell-back is therefore free and
unbounded. Beckoned it is unbounded and *profitable*: `beckonGrit` pays for
buying a Sign, and three of the five are Signs.

The bots oscillated forever and the run never finished. That is the friendliest
possible way to find it — a human would never press it, right up until one did.

The guard is `CardInstance.boughtRound`: a card bought into a hand cannot be
cashed the turn it was bought. Set only under `buyToHand`, so the default rule
is untouched, and it reads as a plain sentence — what you bought is yours to
use, not to sell back.

**This is worth remembering even if `buyToHand` never ships.** Free buying plus
free cashing means any future rule that makes a purchase reachable in the same
turn reopens it.

### Measured, 150 games a cell

| | Balanced | Greedy | Zealot | Puritan | Bal15 | Bal70 | mixed |
|---|---|---|---|---|---|---|---|
| to discard | 48.0% | 44.7% | 33.3% | 0.7% | 53.3% | 44.7% | 45.3% |
| **to hand** | **74.7%** | 64.0% | 34.0% | 0.0% | **70.7%** | 50.7% | **60.0%** |

**Fewer Signs bought, far more games won** — 37.1 -> 28.9 purchases for Balanced,
28.6 -> 23.0 on a mixed table. A Winchester bought is a Threat cleared *now*, so
purchases convert to board impact immediately and the posse needs fewer of them.
Games are shorter (10.1 -> 9.2 rounds) and the Turning comes sooner.

**The corruption curve gets STEEPER, in the right direction.** Bal15 beats Bal70
by 20pp, against 8.6pp today, and **Zealot does not move at all** (33.3 ->
34.0). The extreme corruption line gains nothing from immediacy — it was already
buying every Sign it could — while the disciplined line gains a great deal. That
is DESIGN.md §2's shape improving, which is the opposite of what free buying did
to it.

### Swept: `vesselClear` 15 is where it lands

120 games a cell, `buyToHand: true` throughout. **Nothing committed** — TUNING
still reads `buyToHand: false, vesselClear: 12`.

| `vesselClear` | Balanced | Greedy | Zealot | Puritan | Bal15 | Bal70 | mixed |
|---|---|---|---|---|---|---|---|
| 12 | 74.2% | 58.3% | 37.5% | 0.8% | 71.7% | 62.5% | 55.8% |
| 14 | 57.5% | 45.0% | 19.2% | 0.8% | 60.8% | 50.8% | 36.7% |
| **15** | **51.7%** | 38.3% | 21.7% | 0.0% | 55.8% | 37.5% | 37.5% |
| 16 | 43.3% | 35.8% | 18.3% | 0.0% | 56.7% | 35.0% | 36.7% |

**15**, because it puts Balanced at 51.7% — next to the 48.0% it scores today at
`vesselClear: 12` with purchases going to the discard — and DESIGN.md §2's test
passes with room: neither extreme near 55%, Balanced comfortably above both.

The interior optimum is **wider than it is today**, at every value: Bal15 beats
Bal70 by 18pp at 15 and by 22pp at 16, against 8.6pp on current tuning. That is
the thing worth having from this change; the win rate is just a dial.

**Read the two columns separately.** Balanced points at 15-16 and the mixed
table points at 13 — 14, 15 and 16 all sit at ~37% mixed against 45.3% today.
Mixed tables carry Puritan and Zealot, who gain nothing from immediacy, so the
same change lands differently on them. The same-policy comparison is what
DESIGN.md §2 tests and what has always been the headline here; mixed is the
sanity check, and ~37% is inside the band it has historically occupied.

### CORRECTION: `Balanced` and `Bal15` are the same policy

`balanced(ratio = 0.15)` and `BALANCED = balanced()`, so `POLICIES.Balanced`
and `POLICIES.Bal15` take identical parameters. Every "Bal15 beats the default
ratio" gap reported while sweeping `buyToHand` — 60.8 vs 57.5, 55.8 vs 51.7,
56.7 vs 43.3 — was **two runs of one policy under different seeds**. The last
pair is exactly the kind of outlier the block-variance work below turned up.

The default ratio had already been moved to 0.15 before that sweep. So the
ratio sweep CONFIRMS the shipped default rather than calling for a change, and
the "recommended trio" was really a pair.

**The lesson is the same one as the outlier block:** two cells of a grid that
differ by a few points are not two results. Here they were not even two
configurations.

### Swept: the ratio confirms 0.15, and the second number was re-derived

`balanced(ratio)` was re-swept under the new rule, 150 games a cell at
`vesselClear: 15`:

| ratio | 0.00 (Puritan) | **0.15** | 0.30 | 0.50 | 0.70 | 1.00 (Zealot) |
|---|---|---|---|---|---|---|
| posse win | 0.0% | **58.7%** | 48.0% | 48.0% | 44.0% | 16.0% |

A clean interior optimum at **0.15** — steep off zero, a gentle decline to 0.70,
a cliff at 1.00. Better separated than the current tuning, and the third time
the measured default has turned out not to be the set one.

Then `vesselClear` again against the NEW default, because the two interact:

| `vesselClear` | Bal15 | Zealot | games |
|---|---|---|---|
| 15 | 55.2% | — | 900 |
| **16** | **45.3%** | 15.1% | 450 |
| 17 | 43.8% | 13.1% | 450 |

**16**, as the closest match to the 48.0% Balanced scores today, with Zealot at
15.1% and Puritan at 0% either side of it.

### A methodological note worth more than the numbers

One 150-game cell in the closing grid read **46.7%** for a configuration whose
true value is **55.2%** — a 2.7σ block, and it would have sent `vesselClear`
a full point the wrong way. Six blocks of the same config run 51.3 / 60.0 / 52.7
/ 56.7 / 56.7 / 54.0, so the blocks themselves are well behaved (sd 3.2pp
against a binomial 4.1pp); there is nothing pathological here, just enough cells
in a grid that one of them was always going to be an outlier.

**A single 150-game cell cannot resolve a 5pp difference, and most of this
project's sweeps are 5pp differences.** The fix is what was done here: anchor
the cells that decide something on several blocks, and treat a lone cell as a
direction rather than a value. `sim/FINDINGS.md` already reports sd across
blocks for the Colt targeting work for exactly this reason.

### Committed: `buyToHand: true`, `vesselClear` 11 -> 15

Re-swept against the rules as they now stand — rotation, refill and the
double-turn fix all landed after the first grid, so `vesselClear: 16` from it
was stale. Three blocks of 150 plus 450 mixed:

| | Balanced | Zealot | mixed |
|---|---|---|---|
| before (no `buyToHand`, vc 11) | 49.8% (45/51/53) | 29.1% | 36.2% |
| **`buyToHand`, vc 15** | **53.1%** (53/51/56) | 17.8% | **35.8%** |
| `buyToHand`, vc 16 | 50.4% (49/51/51) | 13.1% | 28.9% |
| `buyToHand`, vc 17 | 40.2% (41/40/39) | 8.9% | 25.6% |

**The two columns disagree and 15 is the call.** 16 matches Balanced almost
exactly (50.4 against 49.8) and costs a mixed table 7pp; 15 keeps the mixed
table where it was (35.8 against 36.2) and lifts Balanced 3.3pp. A mixed table
is the closer model of four people at a table, and Zealot at 17.8% is still a
line somebody could try — at 13.1% it stops being one.

**Zealot falls much harder here than it did in isolation** (29.1% -> 17.8%),
where the first measurement had it flat. Immediacy is worth most to a deck that
buys tools and least to one buying every Sign it can, and against the current
rules that gap is bigger. The corruption curve steepening is the thing worth
having from this change.

## The Vessel's kept Signs are mostly bricks

Raised from the table: the Vessel holds cards reading "destroy a Threat" that do
nothing. Measured over 150 games — the deck it gets at the Turning averages
**15.9 cards of which 37% are Signs**, and Signs are **45% of everything it
plays**.

Most Signs face the STREET. A Fevered Colt in that hand destroys a Threat *for
the posse*; a Salt Line shields somebody it is hunting. The seat cannot cash a
card in either — that rule exists because Grit buys from a market the Vessel has
no access to — so a posse-facing Sign there does nothing, or worse than nothing.

### The bots were playing them, and that is a measurement error

`makeBot`'s Vessel branch said "every card in that deck is worth playing when
drawn", which was true when the deck was only Vessel cards. Measured before the
fix: **95 Threats destroyed BY THE VESSEL across 150 games**, and 182 plays
whose whole effect helps the table it is hunting. The branch now holds back any
card whose ops are entirely posse-facing. Costs the posse about 1pp, so every
number above it in this file is that much generous.

Eighth time a mechanic has behaved wrongly because of the bots.

### `vesselKeepsSigns`, measured

Off, each kept Sign is exchanged for another card from `vesselDeck` — same
count, so "a corrupt Act I makes a fatter Vessel" survives, but every card in
the deck does something to the table rather than for it.

| | Balanced | Zealot | mixed |
|---|---|---|---|
| keeps (current) | 52.7% (52/55/51) | 16.9% | 34.4% |
| trades | 51.6% (52/53/50) | 16.9% | 29.6% |

Free on same-policy tables, -4.8pp for the posse on a mixed one — bigger there
because Greedy and Zealot buy more Signs, so a Vessel drawn from those seats has
more to trade.

### Built: `BURN_SIGN` — the Vessel burns a Sign for a Whisper

The chosen answer, and the one that keeps the flavour: your Last Words really is
in there, and the Old One burns it. A Sign-heavy Act I now literally arms the
Old One's Act II, which is what the kept Signs were always reaching for.

- **Its own command**, not a second meaning for `REVENANT_WHISPER` or
  `SPEND_GRIT`. The three are the same gesture and three different economies — a
  Revenant spending its own life, a posse member turning a card into money, the
  Old One burning the corruption that made it. One field doing two jobs is the
  mistake this project has already made twice with the Whisper track.
- **Signs only.** The Old One's own cards are not corruption to burn, and
  letting the seat feed the track with them would make Whispers something it
  prints rather than something the table handed over.
- **To the boneyard, not the discard.** The Vessel's deck is rebuilt from what
  is left (`refill` — that deck does not run out), so a discard would deal the
  same brick back round.
- **Through `addWhispers`**, so the Act II rate multiplies it and a fill pays
  Doom like any other. Not a side channel around the track.

### What it is worth, and an overstatement corrected

**The bots burn in 21 of 120 games, 0.3 times a game.** The reason is the
correction: 37% of the deck being Signs does NOT mean 37% of turns are blocked.
The Vessel draws five and has three actions, and 63% of that deck is its own
cards — so there is almost always something live to play, and the bricks clog
rather than block. The earlier framing overstated it.

Balance effect is not distinguishable from noise. Across the bot fix and both
versions of the dead-card test, Balanced reads 52.7 -> 55.3 -> 55.6 and mixed
34.4 -> 33.3 -> 32.0 — drifting in OPPOSITE directions, which is what noise
looks like and not what an effect looks like.

**So this is a feel fix, which is what it was asked for.** A human holding a
Fevered Colt they can never point at anything now has something to do with it.

**The bot needed the wider test.** "Helps the posse" missed the second kind of
dead card: a Sign whose damage only reaches the VESSEL, which is this seat —
`choiceOptions` never offers a player itself as a damage target, so the op
cannot resolve, but the appended cost still trashes a card off the deck. Playing
one spends an action to pay a price for nothing. `deadForTheVessel` covers both.

`vesselKeepsSigns` stays ON: with an outlet, kept Signs are fuel rather than
paper, which is the whole point. The trade-in remains as the alternative.

## Drawing at the end of your turn (`drawAtEndOfTurn`)

The next hand is drawn when your turn ENDS rather than when it begins, so it is
on the table while everybody else plays and you can think about it then. The
cards are the same cards; only the moment you see them changes. Dominion draws
this way for the same reason.

**Free, measured.** Three blocks of 150 plus 450 mixed:

| | Balanced | Zealot | mixed | rounds |
|---|---|---|---|---|
| off | 51.8% (50/51/55) | 26.9% | 38.0% | 9.2 |
| on | 54.4% (53/55/56) | 28.0% | 35.3% | 8.8 |

+2.6pp same-policy and -2.7pp mixed, both about one block sd. No change in
wipes either way.

**The interaction to watch was real and did not bite.** Damage trashes off your
DECK, so a deck that has already paid out five cards is five cards nearer empty
when Dusk lands on you — falls and wipes were the thing to look for, and neither
moved.

`startTurn` still tops up to `handSize`, and that is deliberate rather than
redundant: it deals the OPENING hand, and refills one that damage emptied
between turns. Once the end-of-turn draw has run it is a no-op. The draw happens
before `advance`, so a Revenant who burns out on it is already `gone` when the
turn moves on.

## Grit carrying over: measured, and it is close to a no-op

`gritCarries` (TUNING, **off**) makes unspent Grit survive the end of your turn
instead of evaporating. Simulated rather than adopted; the switch is left in.

**The mechanic is nearly inert, and one number says why.** Across 4,566 posse
turns the bots ended a turn holding **0.03 Grit** on average — 3.1% of turns
had any leftover at all, never more than 1, never 3 or more. There is no change
to keep, because a player cashes towards the card they have already chosen and
stops. Every win rate moves accordingly, 200 games a cell:

| | Balanced | Greedy | Zealot | Puritan | Bal15 | Bal70 | mixed |
|---|---|---|---|---|---|---|---|
| evaporates | 52.0% | 43.5% | 36.0% | 0.5% | 45.5% | 41.5% | 41.0% |
| carries | 51.5% | 46.5% | 34.0% | 0.5% | 49.0% | 41.0% | 45.0% |

Signs bought is flat (36.6 -> 36.7; mixed 28.9 -> 29.0), the Turning lands on
the same round, games run the same length. At n=200 a cell (sd ~3.5pp) nothing
here is outside noise.

### The half a simulation cannot answer, and the instrument built for it

Carry-over is not really about change. It is about **saving** — declining the
card in front of you because a dearer one is two turns away — and no policy
could express that, so a naive measurement measures the change and calls it the
strategy. `SAVER` exists for this: it names the dearest Sign in the game whether
or not it can afford it, so `buyStep` cashes towards it and buys nothing until
it can. With carry that is patience; without it, it throws a card away every
turn.

| | Saver | Balanced |
|---|---|---|
| evaporates | 16.5% | 54.0% |
| carries | **6.5%** | 49.5% |

**Saving gets WORSE when saving becomes possible**, and the reason is in the
same row: Saver's Signs go 33.0 -> 43.1. Carry-over lets it execute its plan,
and its plan is to buy the dearest Signs — which is the corruption line the
design punishes. So carry does not unlock a strategy the game was missing; it
makes an existing losing line easier to reach.

Saver is a blunt instrument — it loses heavily in both arms, so it measures a
direction rather than a value — and it only ever saves towards SIGNS. A version
saving for the dearest Provision would be a different experiment, but Provisions
are cheap and finite and the expensive cards in this game are Signs.

**Recommendation: leave it off.** It costs a rule to explain, changes no
measurable outcome, and what it does enable points the wrong way.

## "It cost more Grit than it said" — one press, one command

From a playtest. The engine was not the problem: `BUY` deducts `def.cost` and
nothing else, and `tests/engine.test.ts` now proves it for **every purchasable
card in both acts** — the price on the shelf, on the button and in the reducer
are all the same number.

**The client was sending the same command twice.** `net.play` fired straight
down the socket with no guard, and a card in the market sheet is bought by
clicking the card — so a double-click, which is a natural gesture on a card in a
modal, sent two `BUY` commands before the answer to the first arrived. Two BUYs
are two legal purchases at full price each, and the second card lands in a
discard nobody is looking at. What the player sees is one press and double the
Grit gone.

**It got easier to hit when buying stopped costing an action.** The action count
used to run out and refuse the repeat.

The guard is in `Net.play`: an **identical** command is dropped while one is in
flight, measured by `rev` — the count of states received — so "the board has not
moved since I sent this" is the window. Identical only, because a second and
DIFFERENT action is a real decision and must not be swallowed.

**A refused command frees the guard.** A rejection does not advance `rev`, so
without clearing it on `error` one refused press would stay dead for the rest of
the turn.

Two things that are NOT this bug, and both look like it at the table:

- **Cashing in loses the change.** Cash a 3-Grit Winchester for a 2-cost card
  and the spare point evaporates at end of turn. Working as designed.
- **The Old One's naming charges WHISPERS on your next purchase**, not Grit —
  the bar that jumps is not the one you were watching.

## A card with nothing to point at is not offered

`legalCommands` already withheld a card with no ops — "a Saddlebag played is an
action spent to move a card from one pile to another". The same waste happens
with a full card and an empty board: a Six-Gun at an empty Street. Now
`hasLiveTarget(s, op, controller)` asks whether an op could do anything, and a
card is playable if **any** of its ops is live — a card that draws two and
shoots one Threat is still worth playing with nothing to shoot.

- **The Vessel counts as a target.** A `damage` op is live in Act II whenever
  `vesselTargetable`, which is most of the endgame: nothing to shoot but the
  thing you came for.
- **`banishOmen` is live only with an Omen in the Street.** Declining does
  nothing on its own, and the blast that follows is a separate op judged on its
  own merits — so Dynamite is offered with any Threat present, and withheld on a
  bare Street.
- **It must not touch `resolveSlots`.** `target: 'random'` advances
  `s.rngCursor` to make its pick, and this runs from `legalCommands` — on every
  render, for every card, for every seat. A question that consumed randomness
  would put the cursor where a replay could not follow it. The question is only
  ever "is there anything in the Street", which needs no roll. There is a test
  that calls `legalCommands` five times and asserts the cursor has not moved.

**Measured: no balance change at all** — identical seeds, Balanced 53.5% ->
54.0%, Greedy 44.0% -> 44.0%, Zealot 28.0% -> 28.0%, mixed 44.0% -> 44.0%. The
bots already cashed an attack in rather than firing it at an empty Street, so
this only ever cost a human the action. That is the whole point of it.

**The client says why.** A "nothing to aim at" band, the same shape as the
shuttered one and a lighter grey, because it is the same problem from the
player's side — a card that plainly does something and no way to play it. It is
drawn from the ABSENCE of a `PLAY_CARD` in `legal` plus card data, and
deliberately does NOT reimplement `hasLiveTarget`: the client still never
decides what is legal, only how to explain what it was told.

## Recovering a card is a choice

`recover` took the FIRST non-Sign in the boneyard — insertion order, so the
oldest thing you lost. Deterministic, and indistinguishable from a dice roll
from the far side of the table. It now asks.

Two prompts, like `gift`, and built the same way: the op re-queues itself with
`from` filled in, so the half-made decision travels in the resolution queue and
survives being serialised mid-choice. Doc Mireles' Bag (`target: 'self'`) skips
the first prompt and still gets the second, which is why `needsChoice` names
`recover` explicitly rather than relying on the `target === 'choose'` rule.

- **Keyed by uid**, not card id. A boneyard is mostly duplicates and "a
  Saddlebag" is not an instruction when four of them are lying there.
- **Signs are never offered.** They reach a boneyard only after damage has eaten
  everything else, or a player has fallen; handing one back would make these two
  cards a way of topping corruption up rather than of patching a deck. The op
  re-checks on resolve, so a client that asks anyway gets nothing.
- **The controller picks, even when the card points at somebody else** — the
  same call `gift` makes. A blessing you did not choose is a raffle.
- **The bot needed teaching.** The options are uids, so none of
  `resolvePending`'s branches matched and it fell through to `legal[0]` — the
  oldest card in the pile, which is exactly the rule being replaced. It would
  have gone on measuring the old behaviour under the new one.

Measured at 200 games a cell it is worth about 2pp on a mixed table, which is
inside the noise: Balanced 53.5%, Greedy 44.0%, Zealot 28.0%. This was a
legibility fix, not a power one, and only two cards carry the op.

This is the same ruling `trash` already carries — "a rule you can see is a rule
you can play around; one you cannot is just a card disappearing" — applied to a
gain rather than a loss.

## Two rules that hold the corruption economy together

Some Fevered Signs (Last Words, Night Watch, Salt Line, the Coyote) carry a
Vessel-facing `damage` op — that is what makes a Sign worth buying despite the
Turning. Two rules stop it making Signs strictly better than Provisions. **Do not
break either without re-running the sweep:**

1. **No card both clears the Street and wounds the Vessel.** The Colt and
   Dynamite destroy Threats and get no Vessel damage. Doom rises per unresolved
   Mythos Threat at Dusk, so clearing buys Act II length — a card doing both was
   paid twice, and Zealot won 90–100% of every cell in the grid. A test in
   `tests/actii.test.ts` enforces this.
2. **Each Vessel-facing face trashes a card off your own deck.** Damage eats Kit
   and Provisions before Signs, so firing the corrupted card leaves you more
   corrupt. Signs stay powerful and get more expensive to point.

Neither magnitude nor the trash cost is the load-bearing part — rule 1 is. Both
were measured; see `sim/FINDINGS.md` → Finding 2.

## Ruled: burial is cut, the Revenant burns out

Burial, Rise and Grave tokens were implemented, measured, and removed. The
measurement: `buried = 501, rose = 501` — every burial undone at once, because
the posse paid two actions plus a permanent Scar while the Revenant paid one
action to climb out. Dropping burial to one action would not have fixed it.

The replacement is the clock the paper already gave them — *"You shrink"*. A
Revenant loses `revenantDecay` cards per recycle and, once their deck is empty,
is **gone for good**; the posse's answer is to outlast them. The Old One still
floors at one card so the endgame cannot stall.

### Beckoning is a card, and it is granted rather than owned

"Come and See" is the Revenant's one card: name a living player, and the next
Sign they buy pays them `beckonGrit`. It replaced a bare `BECKON` command, which
rendered as a row of buttons reading "Beckon p1" — no rules text, no card, and a
second interface for one verb. Everyone at the table now plays cards.

**It is granted at the start of each Revenant turn and gone at the end of it**,
and that is the only part with a trap in it. A Revenant's deck is their health:
it shrinks by `revenantDecay` a recycle and empties into `gone`. A card living
in that deck would be both a card of life they never had AND one their own
burn-out eventually takes off them. So it goes nowhere — three guards, all
reading `CardType === 'revenant'`:

- `startTurn` grants it **after** the draw, or it would come out of `handSize`
  and cost a real card every turn;
- `endTurn` sweeps it without discarding it, and before the count, so
  `DISCARDED` does not announce a card that went nowhere;
- `PLAY_CARD` does not push it to the discard.

`legalCommands` also withholds it from `REVENANT_WHISPER`, or a Revenant could
trade the one thing they are given for a Whisper. Its `grit: 0` keeps it out of
`SPEND_GRIT` by the ordinary rule.

**One slot, not a list.** Beckoning twice moves the mark rather than doubling
it, which was true of the command too — so being limited to one card a turn
takes nothing away. The bot finds the card **by type, not by id**.

Watch for this when touching `drawCards`/`startTurn`: a Revenant can burn out on
the very draw that starts their turn, which used to leave `activePlayer` on a
player with no legal commands and hang the game. `startTurn` advances past them,
and a `gone` active player is always offered `END_TURN`.

## Trouble reverses — and a warning about stand-ins

The four Trouble cards with reverses now flip to real Act II cards at the
Turning (`Card.reverse`), using three generic Threat fields: `menaceTarget`,
`onCleared`, `noClearWhileOmen`. Cards with no reverse stay as they are.

**Read this before touching Act II Menace.** The engine used to fake the flip as
"+1 Menace on every turned card". Replacing that with real reverses *reduced*
Act II Menace, because five of nine Trouble cards have no reverse — and that
dropped Zealot and Balanced to within **1pp** of each other at every
`vesselClear`, failing DESIGN.md §2's second test. The blanket +1 had been
quietly punishing Sign-heavy decks for their Menace magnetism. It took
`menacePerSign` 0.35 → 0.45 and `vesselClear` 36 → 32 to restore. An
approximation that looks cosmetic can be carrying the balance.

## The Street: volume, and escalation

Two changes, from playtesting: the Street supplied one objective a round while
the table supplied nine to fifteen actions, so whoever drew well cleared it and
everyone after them had nothing to do. And patience was free — the Whisper track
only moves when someone buys a Sign, so a cautious table could idle indefinitely
and the temptation engine never fired.

- **Threats scale with the table.** `max(threatsMin, round(living *
  threatsPerRound) - threatsOffset)` — 2 at three players, 3 at four, 4 at five.
  Three flat numeric keys rather than a struct, because `sweep` takes any numeric
  TUNING key as an axis and cannot see into an object. `streetSlots` 3 -> 4.
- **A Threat left standing escalates**, +1 Clear and +1 Menace per Dusk survived.
- **Overflow no longer discards.** The oldest Threat resolves its Menace, gains a
  step, and stays; the arriving Threat is retired without entering. A swamped
  Street used to clean itself up, which meant the punishment for falling behind
  was that the problem went away.

**Escalation is per SLOT** (`StreetSlot.escalation`), never per card. `Card` is a
shared template — bumping `card.clear` would escalate every copy of that Threat
everywhere, including the ones still face down. Read it through
`effectiveClear(sl)` / `effectiveMenace(sl, omenBase)` in `engine/effects.ts` and
never touch the printed value directly. Those helpers take a slot rather than a
`GameState` deliberately, so `sim/bots.ts` can call them too — it had been
carrying its own copy of the arithmetic, still adding the "+1 Menace if turned"
stand-in that the engine dropped when real reverses landed, so every policy had
been over-rating turned Threats in Act II.

**Ruled: what cannot be cleared does not escalate** (`escalateUncleanable:
false`). An Omen or a permanent Mythos obstruction can never be cleared and, now
that overflow leaves Threats standing, can never be pushed out either — so a
climbing Menace on one is a ratchet with no answer. Measured at 5 slots: on, the
posse wins **0.0%** of games with 71% seeing a death before round 5; off, 10.5%
and 39%. The flag is kept for comparison.

**Ruled: the Mythos deck recycles** (`recycleMythos`), rather than expanding the
content to ~18 Mythos and ~24 Trouble. Act II now draws three or four Threats a
round from a ten-card deck and would otherwise run dry mid-act. The cost is that
**players see repeats**; the reason is measurement — landing twenty new cards
alongside a structural change makes the result unattributable. If repetition
reads badly at the table, expanding the content is the fix, as a separate step.

### Re-tuning, and what it cost

Both changes together took the posse from ~57% to **0.0%**. The path back, all
measured:

| | Balanced | any death | before r5 |
|---|---|---|---|
| baseline (1 Threat/round, 3 slots) | ~57% | rare | rare |
| + scaling, 3 slots | 32.0% | 59.8% | 5.5% |
| + 5 slots | 9.0% | 61.9% | 5.9% |
| + escalation | **0.0%** | 100% | 70.9% |
| freeze uncleanable, 4 slots | 19.5% | 46.0% | 27.5% |
| `vesselClear` 31 -> 22 | **58.0%** | 43.0% | 27.5% |

`vesselClear` had been tuned against a Street that supplied one Threat a round.
With more arriving and everything left standing escalating, Doom climbs faster,
Act II is shorter, and the same burial target became unreachable. Swept against
`doomTarget` and `startingDeckSize`; 22 is where Balanced beats both extremes by
the widest margin.

**Fattening the starting deck no longer helps.** It was the prescription last
time threats scaled (8 -> 12, DESIGN.md §10). Swept 12/15/18 here and early falls
move 46.6% -> 48.4% — i.e. not at all. Do not reach for it again without measuring.

**Still open: falls are early now.** Balanced sees a fall in 43% of games (within
the old 24-50% band) but **27.5% before round 5**, where it used to be
essentially none, and the mean first fall is round 5.1. That means Revenants
appearing during Act I, a different game shape from the one DESIGN.md §6
describes — and precisely the state the Husk was designed for and cut because
88% of falls landed in Act II. That is now inverted. Worth deciding before the
next session; `threatsMin` and `escalationPerRound` are the levers, not deck size.

## Act II: two deletions, and what replaced them

Playtesting found two dominant actions, and they were the same bug on opposite
sides of the table — **unconditional, repeatable, guaranteed value**. When one
action always works and never runs out it becomes both floor and ceiling, and
every situational card has to beat it.

- **`DEAL_DAMAGE` is gone entirely**, not just its `slot: -1` branch. On a
  blocked Street a posse turn was clicking it three times. Damage reaches the
  Vessel only from a played card now, through the ordinary targeting path —
  `choiceOptions` already offered `VESSEL_KEY` for a `damage` op whenever
  `vesselTargetable`, which is itself gated on `act === 'mythos'`, so the
  targeting half of this needed nothing new.
- **`WHISPER` (+2 Doom) is gone.** Doom already climbs from Omens and unresolved
  Mythos, so it was redundant as well as dominant, and it touched no player —
  the seat was a spectator with a counter.

What replaced them all have conditions:

- **Tolls are real** (`Card.toll`, `PAY_TOLL`). DESIGN.md §7's third line: Bounty
  in Act I, Toll in Act II. A Threat with no Clear is now a *price* rather than
  an obstruction. `legalCommands` offers it only when `canPay` says the player
  can meet it — a button that throws is worse than no button.
- **SHUTTER** closes a card type for `shutterDuration` rounds. Enforced in
  `legalCommands`, never in `apply`, so a client can draw the card as unplayable
  instead of the player discovering it by rejection. Cashing in for Grit still
  works while shuttered — a closed door on Signs should not also stop you selling
  one.
- **OFFER** gifts a Sign into a player's discard, Fevered, tagged
  `offeredUntil`. Played by that round it pays the Old One `offerWhisperReward`.
  Per instance, because the string is on that copy.
- **CALL costs `callWhisperCost`** from the pool.

**Whispers are the Old One's ammunition after the Turning.** One number, read two
ways: before the Turning it counts up to a threshold, after it the threshold has
fired and what accumulates is spendable. `checkTurning` zeroes it, so the pool is
earned in Act II rather than inherited. Buying a Sign in Act II feeds it — Act II
is when Signs are the only thing left to buy, and free Whispers there said
corruption had stopped mattering. **Act I is untouched**: Whispers still charge on
play, not purchase, which is the rule that stops Sign-hoarding dominating Act I.
`REVENANT_WHISPER` feeds the same pool, so the Old One does not go dry if the
posse simply stops buying.

**Measured: 95.2% of Act II turns have a legal action other than END_TURN**
(posse 94.8%, Old One 96.3%, n=7071 turns over 60 games). `tests/agency.test.ts`
asserts it stays above 90% per seat, and that each replacement is actually
reachable — the mechanic-that-does-nothing failure has been the bots four times
now, so the test checks the action was *offered*, not merely defined.

Balance after the pass: Balanced 44.2%, Greedy 26.0%, Zealot 0.0%, Puritan 0.0%,
with the interior optimum intact (Bal15 31.5, Bal30 41.2, Bal50 37.0, Bal70 30.0).

## The Whisper track: one number, one direction

`state.whispers` is the only Whisper resource, it only ever goes **up**, and it
means the same thing in both acts: *when this fills, something bad happens.* It
just happens more than once.

- **Threshold never changes.** `whisperThreshold`, both acts. The bar has to
  look identical or the player relearns it halfway through the game.
- **The rate changes.** Every gain after the Turning is multiplied by
  `whisperRateMythos`. Same bar, same distance, more pressure.
- **Act I fills once**, into the Turning. **Act II fills repeatedly**, into
  Doom: `doomPerFill + (fill - 1) * doomPerFillStep`, counted by
  `state.whisperFills`. Escalating, so Act II accelerates towards collapse
  rather than ticking along.
- **The remainder carries.** 11 of 12 plus a 3-Whisper Sign leaves 2, not 0.
- **A `while`, not an `if`.** One gain can fill the bar twice and must pay for
  both.

Everything goes through `addWhispers`. **Nothing subtracts** — there is no
spend, no clamp, no `Math.min` taking what it can — and `assertWhisperInvariants`
proves `0 <= whispers < threshold` after every command, in both acts. Being at
or above the threshold once a command has resolved means a fill was missed, or
in Act I that the Turning did not fire.

### Two attempts at making this a currency, and why there will not be a third

Both bugs in this area were the same mistake wearing different clothes: the
track was *also* treated as money.

1. **One field, two jobs.** A progress meter that CALL decremented. It went
   negative and rendered negative pips.
2. **Two fields.** `whispers` plus a `whisperPool` the client had never heard
   of, so `Math.max(undefined, 6)` printed `/NaN`.

The fix is not a better spend path, it is **no spend path**. `tests/whispers.test.ts`
ends with two structural tests that read the source tree: no file may mention
`whisperPool`/`callWhisperCost`/`spendPool`/`spendWhispers`, and no file outside
tests may contain `whispers -=` except the wrap itself. Behavioural tests
cannot catch an abstraction being half-restored; these can.

### The Old One ADDS Whispers, and it is their weakest move

`WHISPER` names a living player. They gain `oldOneWhispers` **the next time they
buy anything** — charged through `addWhispers`, so the Act II rate applies and a
naming that tips the bar resolves its fill immediately.

This is *not* the deleted `WHISPER` (a bare +2 Doom button: unconditional,
repeatable, touching nobody). The reused name is a trap for a future reader, so
`tests/actii.test.ts` checks the **shape** rather than the absence: every one of
the seat's five actions must name somebody or something, and none may move Doom
on its own.

- Naming alone changes no number.
- It pays nothing if the target simply does not buy.
- It stacks — named twice before buying, you owe twice.
- It is charged on **any** purchase. Exempting Provisions would make it a Sign
  tax that a wounded player dodges by healing, which is the one purchase they
  were always going to make.

**If playtesting shows the Old One taking it most turns, that is CALL, SUMMON,
SHUTTER and OFFER being too weak, not this being too strong.** The bot ranks it
last for that reason, and aims it at whoever holds most Signs — the threat only
pays if they spend.

### Measured, 300 games per policy, all-same-policy tables with a Marked bot

| policy | Turned | Act II | fills (med / p90) | Doom (med / p90) | reaches 50 | Doom / bury / wipe |
|---|---|---|---|---|---|---|
| Balanced | 284/300 | 3.8 rds | 4 / 7 | 29 / 55 | 28.2% | 26.7 / **51.3** / 22.0 |
| Greedy | 262/300 | 4.4 rds | 5 / 7 | 44 / 56 | 42.7% | **37.3** / 35.3 / 27.3 |
| Zealot | 171/300 | 2.0 rds | 1 / 3 | 17 / 28 | 0.0% | 0 / 4.0 / **96.0** |
| Puritan | 97/300 | 0.1 rds | 0 / 0 | 3 / 6 | 0.0% | 0 / 0 / **100** |

Doom is a live win condition again: it takes 27% of Balanced games and 37% of
Greedy ones, against 12–15% before, and the bury/Doom split is close to even
for the two policies that survive long enough to have the argument. The bottom
two rows still die to attrition before Doom is relevant — **that is not a Doom
problem**, it is Zealot and Puritan losing Act II in two rounds, and adding
Doom pressure would only shorten games they are already losing.

## Act I Bounties and the economy inversion

All nine Act I Trouble cards pay a Bounty to whoever clears them, from the card
faces. Two use a new `gritNextTurn` op because the paper banks some Bounties for
the following turn. Omens pay nothing, and **nothing in Act II pays a Bounty,
ever** — that asymmetry is DESIGN.md §7's economy inversion and it is worth a lot:
turning Bounties on moved Balanced from 46.0% to 58.0% at fixed tuning, and
`vesselClear` was retuned 34 → 36 to absorb it.

## Ruled: Act II is long and attritional, not short and violent

DESIGN.md §3 asks for both a ~60% Turning mark and "Act II, roughly three
rounds". Those are mutually exclusive at any Act I long enough to build a deck.
**The 60% mark won.** Act II is now ~5 rounds, the Turning lands at 57.9%, and
54–75% of games see someone fall.

`vesselClear` is the pacing lever, not `doomTarget` — the game ends when the
posse burns the Vessel down. Raising `doomTarget` alone only makes the game
easier (48% → 93% across 26→50 with the Turning barely moving).

## Two engine rules added on measured evidence

- **The Turning fires when the Trouble deck runs out**
  (`Tuning.turnOnTroubleExhausted`). Without it a zero-Sign table never Turns and
  150 of 150 games stalled — Omen Whispers were the only thing guaranteeing an
  ending. The Long Season ends because someone couldn't resist, *or* because it
  ran out.
- **Menace ties break at random.** `reduce` with a strict `>` returns the first
  match, so whenever Signs were level — a zero-Sign table, most obviously — every
  point of Menace hit the same seat all game and cascaded down the table. This
  settles the "Menace targeting" open ruling: it *was* doing too much balancing
  work. The tie-break alone moved Puritan from 2.7% to 16.7%.

## Deck-as-health, and why `menacePerSign` exists

`omenMenace: 1` made attrition possible at all — it was completely dead before,
nobody falling even at 8× `damagePerHit`, because every Threat that dealt damage
could be cleared and the uncleanable Omen dealt none.

But flat damage only ever threatened the zero-Sign deck: Signs are an
**unlimited** supply and therefore unlimited healing, so a Sign-buying table
outgrew attrition (1.5% of Balanced games saw a fall) while a Puritan ran out of
Provisions and died. Raising `damagePerHit` could not fix it — at 2 it annihilated
the Puritan (1.0% win) before it troubled anyone else.

`menacePerSign: 0.35` scales the wound with the corruption that drew it, which
leaves the Puritan on flat damage and finally reaches a balanced table (24%).
Above ~0.4 it wipes the Zealot out. Falls now happen in 24–50% of games and
essentially never before round 5.

## Menace is dealt one point at a time

From the table: one player having their deck cut in half over a single Dusk
while everybody else watched. Three or four Threats resolve at Dusk, every one
of them aims at whoever holds most Signs, and each used to deal its whole wound
in one lump — so they all landed on the same seat.

**The rule is unchanged. The granularity is.** `resolveMenace` now aims per
point: take one card, look again. The moment a hit costs the leader their lead
they are level with somebody, the tie breaks at random, and the next point goes
elsewhere.

Two things fixed deliberately, and both would be bugs the other way round:

- **The size is set by the FIRST seat aimed at.** `menacePerSign` is "the wound
  deepens with the corruption that drew it", and what drew it is who the Threat
  was looking at when it moved. Recomputing the bonus per point would multiply
  it by the point count.
- **A point never lands on somebody who has already fallen.** The standing posse
  is re-read every point, so a player going down mid-wound passes the rest of it
  on instead of absorbing it into a deck that no longer exists. That makes Dusk
  slightly *more* efficient, not less — it is the one place this change adds
  damage rather than moving it.

`MENACE` is still **one event per person hit**, not one per point, and
`mergeWound` collapses the run of one-card `DAMAGED` events back into the single
event a lump wound used to produce. The chronicle and `duskReport` both count
these, and neither should learn about the implementation.

### Measured — it helps, and it is not the whole fix

200 games, Balanced table with a Marked seat, per Dusk that dealt any damage:

| | worst seat's share | seats hit | worst hit (med / p90 / max) | falls |
|---|---|---|---|---|
| lump (was) | 86.7% | 1.44 | 4 / 10 / 26 | 288 |
| **per point** | **83.4%** | **1.59** | 4 / **9** / 26 | **248** |

Win rate moved 41.5% -> 43.0%, inside the noise at this n.

**Why the effect is modest, and it is worth knowing before reaching for this
again: damage eats non-Signs first.** A leader with a stack of Provisions loses
those, keeps every Sign, and therefore keeps being the target — the re-aim only
fires once their Signs actually start dropping. The concentration that remains
is real and this does not reach it.

If it needs to go further, the lever is **not** finer granularity, it is
**per-Dusk memory**: a Threat preferring a seat that has not already been hit
this evening. That is a new concept in `GameState` (reset at Dusk) rather than a
tuning number, which is why it has not been built on spec.

## Menace costs half its value in cards, rounded up (`damagePerHit: 0.5`)

A card burned per point of Menace was too steep once escalation is in play: a
Threat left standing four Dusks reaches Menace 5 and took five cards off one
deck in an evening. The exchange rate is `damagePerHit`, and it is now **0.5,
rounded UP** — `cardsFor()` in `engine/effects.ts`.

**Rounded up so a Threat is never harmless.** A Menace of 1 still costs a card;
every point after that costs half of one. The `menacePerSign` bonus is NOT run
through the halving — it is already a fraction of a count and floored, and
halving it too rounds most tables straight to zero.

**It is gentler than "half" sounds**, and the reason is the rounding: most
Threats print 1 or 2 Menace, where `ceil` gives back most of what halving took.
Mean damage per Dusk falls 6.58 -> 5.91, about 10%, not 50%.

Measured, 200 games a cell:

| | Balanced | Greedy | Zealot | Puritan | Bal15 | Bal70 | mixed |
|---|---|---|---|---|---|---|---|
| 1.0 (was) | 43.5% | 37.5% | 24.0% | 0.5% | 45.0% | 32.5% | 33.0% |
| **0.5** | **53.5%** | 42.0% | 28.5% | 0.5% | 50.5% | 37.5% | **41.5%** |

**The shape survives** — Balanced > Greedy > Zealot > Puritan throughout, and
Bal15 still beats Bal70 by 13pp. This is a difficulty dial, not a change of
shape, which is what makes it safe to turn.

**What it actually buys is falls, not the worst hit.** Per 200 games:

| | mean Dusk damage | worst hit (med / p90 / max) | falls | before r5 |
|---|---|---|---|---|
| 1.0 | 6.58 | 4 / 10 / 31 | 246 | 46 |
| **0.5** | 5.91 | 4 / **9** / 29 | **171** | **18** |

Early falls drop 61%, which is the "**Still open: falls are early now**" problem
tracked further down — Revenants appearing during Act I, a game shape DESIGN.md
§6 does not describe. The worst single hit barely moves, because escalation and
the corruption bonus still stack on top.

**Cumulative drift is now the thing to watch.** Free buying was +25pp and this
is another +8.5pp on a mixed table. Nothing has been retuned to absorb either.
`vesselClear` is the lever.

## Blind damage was tried and rejected (`blindDamage: false`)

The question, asked after the per-point Menace change did less than hoped:
should damage take a card at RANDOM rather than eating Provisions before Signs?
It looks like it should help twice over — a corrupt deck loses Signs, so the
Menace target moves off the leader, and Sign-heavy play punishes itself.

It does the first and **the opposite of the second.**

Spread, 200 games, per Dusk that dealt damage:

| | worst seat's share | seats hit | worst hit p90 | falls |
|---|---|---|---|---|
| ordered (kept) | 81.7% | 1.64 | 9 | 276 |
| blind | **74.7%** | **1.94** | 9 | 256 |

Seven points of concentration, twice what re-aiming per point bought on its
own. And then the cost, confirmed on fresh seeds at n=250:

| | ordered | blind |
|---|---|---|
| **Zealot** | 24.0% | **35.6%** |
| Bal15 | 39.2% | 44.0% |
| Bal70 | 35.6% | 35.6% |
| Balanced | 45.6% | 44.4% |

**Blind damage rehabilitates the most reckless line in the game.** Zealot buys
every Sign it can and is meant to lose for it; +11.6pp closes the gap to
Balanced from 21.6pp to 8.8pp, and DESIGN.md §2's central test is exactly that
this line must not pay.

The mechanism is worth keeping, because the naive prediction is backwards.
**Signs are not just what draws Menace, they are what SIZES it** —
`menacePerSign` scales the wound with the Signs held. So shooting a Zealot's
Signs off makes every subsequent wound smaller AND moves the aim elsewhere.
Corruption stops being a ratchet and becomes something the game removes for
you, free.

It also deletes rule 2 of "Two rules that hold the corruption economy
together": damage eats Provisions before Signs, so firing a corrupted card
leaves you more corrupt. That rule needs the ordering to exist at all.

**On the first Bal70 measurement blind looked like +13.4pp** (33.3 -> 46.7) and
it was noise — the fresh-seed rerun put both arms at 35.6%. n=120 a cell is
+/-4.5pp; the Zealot result survived rerunning and that one did not.

The flag stays, defaulted off, so it can be tried at a table. **If the
concentration at Dusk still reads badly, the lever is per-Dusk memory** — a
Threat preferring a seat not already hit this evening — which spreads damage
without touching the economy at all.

## The traitor, and why there are two tunings

The Marked player is implemented: the secret aim from the role card (+3 Doom if
two other players each hold 3+ Signs at the Turning) and a `Marked` bot policy
whose only lever is timing — it buys Signs enthusiastically but withholds them
until two others are corrupted, since playing a Sign brings the Turning on.

The traitor is worth roughly **4 points of `vesselClear`**: the bot's presence
costs the posse ~15pp and the +3 Doom another ~14pp. `TUNING` is set for the game
as actually played (`vesselClear: 16`). **Use 20 for the traitorless first
session** DESIGN.md §10 recommends.

## Still open

**Finding 7 is a designer's call.** The ~60% Turning target and DESIGN.md §3's
"Act II, short and violent, roughly three rounds" are mutually exclusive at any
Act I long enough to build a deck — the Turning lands at 77%, and `doomTarget`
moves it barely at all while blowing up win rates.

**Ruled: the Puritan floor is intentional.** Refusing Signs wins ~5%. That is the
premise, not a balance failure — the power is not optional, and a posse that will
not take it dies to attrition. Do not "fix" it.

**Ruled: the Husk is cut.** It could not happen — 88% of falls land in Act II,
where the state did not apply, and even `huskCutoffRound: 12` gave 6 Husks in 116
falls with no measurable effect.

**Still open:** the Mythos Toll line is unmodelled — but that is ruled a feature,
not a gap (see milestone 3 below).

## Known stubs

- The Mythos **Toll** line is unmodelled, deliberately — see milestone 3.
- `last-words` carries a `passive` string tag; passives aren't wired to triggers.
- Trouble-card reverses at the Turning are modelled as +1 Menace, not real
  reverse faces.
- Constraints are stored on cards but not enforced by `legalCommands`.
- Act I Bounty rewards aren't modelled — only Clear and Menace, so Act I combat
  is not yet generative and the Act I → Act II economy inversion is unmeasured.
- Revenant RISE and Grave-token spending are absent — they went with burial.
  Whisper and Beckon are both in.

## The simulator

`sim/` is a Node CLI: `headline` (Puritan vs Zealot), `diagnose` (win-condition
audit), `mixed` (one policy per seat), `sweep` (TUNING grid), `all`. Flags:
`--games`, `--players`, `--marked`, `--out`. `sweep` takes any numeric TUNING key
as an axis and builds the cartesian product — `--doom=`, `--vessel=`, `--prov=`,
`--persign=`, `--omenmenace=` and so on — and marks cells where the middle is the
best play. Every run is seeded and reproducible; CSV lands in `sim/out/`.

Two rules when working in here:

- **Bots receive `playerView` output, never `GameState`.** Asserted in
  `tests/sim.test.ts`. Reading `content/cards` is fine — card faces and costs are
  public at a real table.
- **Policies must differ only in `pick` (what to buy) and `playsSigns`.** Threat
  handling, spending and the Act II race are shared code. If Puritan and Zealot
  differed in combat logic too, the headline number would measure the wrong thing.
  The Old One policy is fixed across all experiments for the same reason.

Determinism extends to the sim: `Math.random`, `Date.now` and `new Date` are
banned in `sim/` as well as `engine/` and `content/`.

## Playtest notes acted on (session 1)

Four things came back from the table. Each is fixed, and the first was a real
design flaw the simulator had never caught:

1. **"Not enough threat — I can clear the Street before passing my turn."**
   The paper deals a flat 1 Trouble a round *whatever the table size*, so four
   players brought twelve actions to bear on one Threat. Measured: the Street sat
   empty in 16% of Act I decisions, 1.28 of 3 slots filled. Threats now scale
   (`troublePerPlayer`), giving ~2.2 of 3 slots and 1–3% empty at 3, 4 and 5
   players alike. Two knock-ons had to be handled: the 12-card Trouble deck now
   runs dry, so cleared Trouble **recycles** (`recycleTrouble`) or Act I would be
   governed by deck size; and the extra pressure pushed round-4 deaths to 9%, so
   `startingDeckSize` went 8 → 12, which is DESIGN.md §10's own prescription
   ("fatten the starting deck rather than reducing damage") and brings it to 3.5%.
2. **"I can see my hand but not my deck."** Deck / discard / boneyard / Scars are
   in the header, and the discard and boneyard open to show their contents.
   Deck-as-health means the pile sizes *are* the vital signs.
3. **"Market cards show costs but not what they do."** Every market card now
   prints its rules text, and a Sign also prints what it becomes at the Turning —
   you cannot weigh corruption you cannot read.
4. **"Bot turns happen instantly."** `GameRoom.stepBot()` now plays exactly ONE
   bot action; `Hub.tick` paces them (`botDelayMs`, default 900ms) and the UI
   highlights whoever is acting. Bots used to resolve inside `submit`, so three
   opponents moved in a single flash.

## Piles open as cards, and the leak that found

Deck, discard and boneyard open a `PileSheet` — a full overlay of card faces,
**alphabetical by the name actually printed on the face** (a Fevered Sign sorts
under its Fevered name, or the grid looks unsorted to the only person reading
it). Every copy is drawn rather than collapsed to `×N`: deck-as-health means
eight Saddlebags is a fact about your position, and eight faces says it the way
the pile would if you spread it on the table.

Alphabetical is a **rule, not a preference** — the deck is in there and its order
is secret, so sorting by anything the game decides would leak the shuffle
through the back door.

**Which is exactly what was happening.** `playerView`'s `sortedForReview` sorted
on `cardId` then `fevered` and stopped. `Array.prototype.sort` is stable, so
every run of identical cards kept its *input* order — and a deck is mostly
duplicates. The array looked perfectly sorted; the shuffle was intact inside it.
Two things let it live:

- the only test naming deck order checked that **opponents'** decks were absent,
  which is the easy half — your own deck is sent in full, because a deck builder
  you cannot review is unplayable, so the order is the part that has to be
  scrubbed;
- nothing rendered it. It took drawing the pile as faces to make it visible.

Fixed with a `uid` tiebreak (a creation counter, so it cannot carry a shuffle),
and `tests/engine.test.ts` now proves it by permutation — rotations and a
reversal must all project byte-identically. **Only a permutation test can see
this class of bug**; reading the output never will.

## The table narrates itself

`client/src/beats.ts` turns each batch of events into one spoken sentence, shown
for a few seconds over the felt. A batch **is** a beat — `stepBot` plays exactly
one action — so an anchor event (PLAYED, BOUGHT, FELL, the Turning, Dusk) becomes
the headline and everything after it becomes the clause underneath. A change of
`activePlayer` adds a turn beat.

Four things were measured against a real game and are worth not undoing:

- **Menace and arrivals anchor their own beats.** Left as clauses, Dusk produced
  a single beat with eleven of them.
- **`MENACE` carries `cardId`** — added to the engine event, because at Dusk a
  Threat can menace and then be shoved out of its slot by the next arrival, so
  neither the post-batch view nor the batch itself can say who did it.
- **Whispers and Doom are summed per beat**, and a beat that is *only* a track
  moving is titled with its running total. Doom climbing alone for three rounds
  otherwise reads as the same sentence three times.
- **No "(Fevered)" gloss.** After the Turning every Sign is Fevered; the beat's
  colour carries it.

`tests/narrate.test.ts` scrapes the `GameEvent` union out of `engine/state.ts`
and fails if a new event has no sentence — the failure mode is otherwise silent,
and announces `threat_damaged` in small caps to a room of people.

**Dusk gets a report, not a stream.** `client/src/duskReport.ts` turns the Dusk
batch into one page — what it cost, what arrived, what got worse, where the
tracks went — shown over the felt with the sun animation at full size. Beats from
a Dusk batch are tagged `fromDusk` and skipped by the ticker, so the same news is
not also scrolling past behind the sheet; they still reach the chronicle.

**It is dismissed locally, by whoever is reading it.** Not an all-players
acknowledgement: see "Reaction windows: not needed" — waiting on the table costs
pace against the 40-minute target, and how long someone spends reading a Dusk is
a tell in a game where one player is hiding something.

**Bots are floored at one action per 1.5s** (`Hub`'s `minGapMs`, overridable
with `LONG_NOON_BOT_GAP`) — the slowest a bot should ever act. A Dusk or the
Turning still costs more; the floor only raises the bottom.

**At 1500 the floor barely binds any more.** `botDelayMs` is also 1500, so an
ordinary one-sentence action costs the same either way and the per-sentence
model underneath is what you actually feel. That is the intended end state: the
floor was a blunt instrument added when the measured pacing alone read too fast,
and it is a backstop now rather than the tempo.

It was 5000 for a long time, and it was expensive. Bot time alone, at the
measured action counts:

| Table | Bot actions | Paced only | At the old 5s floor | **At 1.5s** |
|---|---|---|---|---|
| 1 human + 2 bots | 210 | 6.5 min | 18.8 min | **~6.5 min** |
| 1 human + 3 bots | 264 | 6.9 min | 22.9 min | **~6.9 min** |
| 1 human + 4 bots | 300 | 7.4 min | 26.0 min | **~7.4 min** |

The action counts and the first two columns are measured. The last converges on
"paced only" precisely because the floor has stopped binding — arithmetic rather
than a fresh run, but the mechanism is the reason and not a coincidence. That is
roughly **twelve minutes** given back at three players against DESIGN.md's
40-minute target.

**Watch the animation holds if you touch `SPEED`.** The multiplier scales the
WHOLE computed pause, `duskMs` (2400) and `turningMs` (6600) included — so at
`fastest` a Turning pause is about a second against a 3.1s client animation. The
rule further down is that a client hold longer than the server's pause makes the
lag accumulate all game. Nobody has re-measured that at the new settings.

**Bots are paced per sentence, not per action** (`server/pace.ts`,
`Hub.pauseAfter`). A flat delay was wrong in both directions at once: 72 of 214
bot actions in a measured game say *nothing* (spending Grit, a quiet turn end)
and were costing a full pause each, while a single END_TURN that brings on Dusk
is six sentences and got the same. Now `beatsIn(events, turnChanged)` counts the
sentences and the pause is `botDelayMs + readMs × (beats − 1)`, capped at 8, with
`quietMs` for a silent action.

`beatsIn` deliberately **duplicates** the narrator's anchor/clause lists rather
than importing them — `server/` must not depend on `client/`. A test asserts the
two counts agree on every action of a full game; if they drift the cost is
pacing, never correctness.

The client's hold times in `Announce` are tuned *against* those constants: with a
backlog the hold is shorter than the pause that produced it, so the queue always
drains. Measured, the narration trails by at most ~3s and does not grow across a
game. **Change one side and re-measure the other** — a client hold longer than
the server's pause makes the lag accumulate all game.

## Milestone 3 — the online client

`server/room.ts` holds the authority: a `GameRoom` owning `GameState`, seating
humans and bots together, gating every inbound command through `isLegal`, and
broadcasting only `playerView` output plus permitted events. Deliberately
transport-agnostic — no sockets, no timers — so it is testable directly, and a
socket layer is a thin wrapper over it.

**`server/events.ts` is the second half of invariant 3.** `playerView` guards the
*state* a client receives; the event log is the other channel, and broadcasting
it raw leaked `SCRIED` — the card a scryer pushed to the top of the Threat deck.
Keep that filter list short, but check new events against it.

`server/lobby.ts` holds presence, the disconnect timers and the botify vote.
**It never reads a clock** — every entry point takes `now` and `tick(now)` drives
the state machine, which is what keeps `server/` under the determinism lint and
makes timeouts testable instantly. Wall-clock time is the transport's problem, so
do not reach for `Date.now()` in here.

Two decisions worth not undoing: ballots are secret (`voteState` returns a tally,
never who voted), and an empty lobby is **not** botified — with nobody present
there is no one to play it out for, so it just runs down and closes.

`server/hub.ts` routes messages and owns rooms, connections and seat tokens.
Two invariants live there and are easy to break by accident:

- **A `command` message has no seat field** — the server takes the seat from the
  connection. Adding one would let a player act as another, which in this game
  means acting as the person whose role they want to learn.
- **Seat tokens come from `randomUUID`, never the game seed.** `seed` + command
  list reconstructs any game, so a seed-derived token would let anyone with a
  replay reclaim a seat and read its hidden role.

### The passport: getting back into a chair after losing the token

The report: a player dropped, tried to come back, and was told the room was
**full**. Correctly, on the rules as they were — after the deal a chair is only
joinable if its player left no claim on it, which is what stops a stranger
taking a disconnected player's seat and reading their hidden role. Their seat
token had gone with the tab, so there was nothing left to prove the chair was
theirs.

**`ClientMsg['join'].player` is a passport**: a `randomUUID` the client makes
once and keeps in `localStorage` under `long-noon.player`. Unlike the seat
token it is **never cleared** — not on a failed rejoin, not on leaving, not on
an error — and it is sent with every join.

- **Checked BEFORE the search for a free chair.** A full room is exactly the
  state in which somebody needs to get back into their seat, so the claim
  cannot be something you fall back on after the search fails.
- **A live connection on that seat is not a reason to refuse.** The common case
  is the player's own dead socket that the server has not noticed; refusing
  would make recovery depend on a timeout nobody can see. Last claim wins, and
  the stale session is unseated so it cannot go on acting as that chair.
- **A fresh token is issued and the old one revoked.** One live token per chair,
  or a recovered browser could act as a seat somebody else now holds.
- **One owner per chair, with reverse cleanup.** Seating a passport deletes any
  other pointing at that chair, and leaving releases the claim. Without that, a
  player who walked away keeps a claim and can turn out whoever takes the chair
  next — worse than the bug this fixes. There is a test for it.

**It is a bearer credential and is treated like the token**: unguessable, never
in `TableSeat`, never broadcast, never derived from the game seed. A test
asserts it appears in nothing the table is sent.

**Nothing prunes the seat token any more except leaving on purpose.** The client
used to delete it whenever the server answered `Cannot rejoin` or `No such
room`, which is very likely how the reported player lost theirs: the rejoin is
sent automatically on every socket open, so a reconnect that raced the room into
existence answered `No such room`, the token went, and from then on the room was
simply "full". Both messages are transient by nature — the object may not exist
YET, and a token that is wrong for THIS room is still right for the room it came
from. A failed rejoin is now silent as well as harmless: the player did not ask
for it, so its failure is not news.

Implemented on both servers — `room.passports` on the Node hub,
`TableSeatRecord.player` in worker storage (optional, so rooms written before it
rehydrate). Optional on the wire too, so a client that has never had one still
joins normally.

### The room code lives in the address, and the join box has to move the socket

Two bugs, one cause. The room is part of the ADDRESS — one Durable Object per
room, so Cloudflare has to know which object to route to before the socket
exists — and the server therefore takes the room from the object a message
reached and **ignores the `roomId` field**, which is kept only so the wire
protocol did not have to change shape for the port.

- **A typed room code was ignored.** `join` went down the socket the link had
  already opened, so the player was seated at the table the URL named. Fixed by
  `joinPlan(current, code)` — a pure decision, tested in
  `tests/room-code.test.ts` — plus `Net.queue`, which holds one message for the
  NEXT socket to open. Changing the target tears down the socket and the join
  goes out on the replacement.
- **The box could disagree with the socket.** It read `code || net.roomId`, so
  an empty field silently fell back to whatever the server last called the room
  and clearing it cleared nothing. It holds one value now: what the URL said, or
  what you typed over it. Opening a table adopts the server's name ONCE, in an
  effect — necessary because the old Node hub names a room something other than
  the address the socket used.

Two smaller rules that fall out:

- **`setRoomId(null)` when the address changes.** Otherwise the URL keeps naming
  the room you just left until the new socket answers, and for ever if it
  refuses. The socket effect does not re-run on partysocket's own reconnects,
  only on a real change of address, so this cannot fire mid-session.
- **A queued join beats the remembered rejoin**, rather than both going out and
  the outcome depending on which reply lands first.

The join field is prefilled from `?room=` **only when the URL actually named
one**. With no room param `roomFor` invents a code for a table that does not
exist yet, and offering that as something to join is an invitation to a
`No such room`.

`server/ws.ts` is the transport and `server/serve.ts` the entry point
(`npm run serve`). **These are the only files allowed to read a clock or do I/O**
— `scripts/lint-determinism.mjs` carries a two-file exemption for them, and it
should stay that short. Everything beneath takes `now` as a parameter.

The transport also shape-checks inbound JSON: `hub.handle` takes `unknown` and
answers malformed payloads with an error rather than throwing, because over a
socket the message type is a promise the client has not made.

`client/` is Vite + React, with its own `tsconfig` (it needs DOM and JSX; the
root project deliberately does not). `npm run check` typechecks both.

**The client never derives what is legal.** `legalCommands` needs `GameState`,
which a client must never hold, so the server ships `legal: Command[]` with every
state update and the UI just renders buttons for it. Do not be tempted to
reimplement rules in the client to grey a button out — that is the drift
tech-spec.md §4 exists to prevent.

Run `npm run serve` and `npm run client` together to play.

## Sound, and the one hole deliberately left in the protocol

Audio lives in `client/src/`: `coinPool.ts` (coins, and the Sign purchase),
`components/Ambience.ts` (a looping bed per Act), and one-shot clips inside
`Dusk.tsx` and `Turning.tsx`. `settings.ts` holds the mute and two levels, and
exposes `musicLevel` / `effectsLevel` with the mute **already folded in**, so no
caller can forget to check it.

**`DISCARDED` is an engine event that is deliberately silent in the chronicle.**
It carries `{ player, n, hand }` and exists so the client has one source of
truth for "a card went to a discard pile" instead of inferring it from `GRIT`
here and a turn change there. `hand` distinguishes the two gestures — sweeping a
whole hand away (`discard-a`) from putting one card down mid-turn
(`discard-one-a`) — and **is not derivable from the count**: a turn that played
four of five cards ends by sweeping exactly one. `describe()` returns `''` for
it and `narrate.test.ts` lists it in `silent`, because whatever caused the
discard is already narrated by the thing that caused it. Emitted at four sites:
the end-of-turn sweep, `SPEND_GRIT`, `REVENANT_WHISPER`, and the `discardHand`
op. **Not** on `PLAY_CARD` — playing a card is not discarding it.

Three things learned the hard way, all in comments at the site:

- **React StrictMode disposes and remounts every effect in development.** An
  ambience left in a ref after `dispose()` meant the remount found a truthy
  value, skipped `??=`, and called `start()` on a closed AudioContext — which
  throws inside an async method, so the rejection went unobserved and the music
  simply never played, with nothing in the console. `tests/ambience.test.ts`
  locks this down with a mock context that throws once closed.
- **Never `void` an audio promise.** The failure mode is silence, and silence is
  also what success sounds like during a fade-in.
- **`tests/ambience.test.ts` is typechecked by `client/tsconfig.json`**, not the
  root one — it drives browser APIs and the root project has no DOM lib on
  purpose. Hence the `exclude` in `tsconfig.json`.

**The `dev` message channel is the exception to "everything goes through
`isLegal`".** It is a panel (`client/src/components/DevPanel.tsx`, a tab on the
left edge) with eight actions: **sit** in any seat, set a **status**, force the
**turning** naming any seat as the Vessel, bring on **dusk**, hand a seat the
**turn**, give **grit** or a card (**give**), and **restart** with a fresh deal.
It is:

- **off by default** — `Hub` takes `devTools`, and only `LONG_NOON_DEV=1 npm run
  serve:dev` turns it on;
- **advertised to the client** on `joined`, so the buttons cannot appear against
  a server that would refuse them;
- **tested for being shut** — `tests/hub.test.ts` asserts the closed default,
  the refusal message and the flag on both settings.

Keep it that way. Choosing the moment of the Turning is the single most valuable
thing the Marked player could buy: their secret aim is scored at that exact
instant — and `sit` hands over another seat's hand and hidden role outright.
`tests/hub.test.ts` checks the refusal against **`DEV_ACTIONS`**, not against a
list of action names typed out by hand, because a test naming them individually
passes for ever while somebody adds a ninth.

Four rulings inside the panel, each of which is a state the engine could not
otherwise reach honestly:

- **Every action goes through the real rule.** `turning` pushes the Whisper
  track to its threshold and lets `checkTurning` fire; `dusk` and "their turn"
  apply a real `END_TURN` from the right seat rather than assigning
  `activePlayer`, because the turn boundary is where the hand is swept, the
  Revenant is granted its card and the deck recycles. A second implementation of
  the hinge of the game is the last thing this project needs.
- **`checkTurning` takes an optional `forceVessel`**, and the panel is its only
  caller. Being the Vessel is the state hardest to reach by playing and the one
  most worth testing.
- **`vessel` is not a settable status.** It is the far side of the Turning — a
  replaced deck, every Sign turned, the Street flipped — so assigning the tag
  alone would produce a seat that is the Vessel by name and a posse member by
  contents. `devStatus` refuses it **at runtime**, not only in the type: the
  value arrives off a socket.
- **`sit` is a swap.** The chair you leave is handed to a bot or the game stops
  when the turn comes back to it, and the seat token follows the PERSON — a
  token left pointing at the vacated chair is a live claim on a seat a bot is
  now playing, and a refresh deals the tester somebody else's hand.

**Not ported to the worker.** It rebuilds its game by replaying the command log,
so a dev action that changes state has to be in that log or it evaporates at the
next hibernation — which is why `turning` is logged and the other six are
refused with a sentence rather than faked. Use `npm run serve:dev`. There is deliberately no way back from the Turning either — Signs are
permanently Fevered and the Vessel is named — so "return to Act I" is a new deal,
not an undo.

## Game speed, and the only control with an owner

`Speed` is `'normal' | 'fast' | 'fastest'`, multiplying **all four** of `Hub`'s
pacing knobs by 1 / 0.45 / 0.15 — `botDelayMs`, `readMs`, `quietMs` and
`minGapMs`. One multiplier rather than a table per speed, so the SHAPE of the
pacing survives: a Dusk still costs more than a quiet action. **`minGapMs`
scales too** — 1500ms at `normal`, so 675ms at `fast` and 225ms at `fastest`.

**The animation holds are NOT scaled.** `duskMs` (2400) and `turningMs` (6600)
are added in `holdFor` AFTER the multiplier and never move. Speed is how fast
bots think, not how fast the sun goes down — scaling them left about a second
for a three-second piece at `fastest`, which does not make the game quicker, it
makes the client's own hold outlast the server's pause and the lag accumulate
for the rest of the game.

### Nothing may be committed during a Dusk or the Turning

`Room.lockedUntil`. Both are full-screen animations the whole table watches, and
a move landing behind one is a move nobody saw.

- **Set in `deliver`**, which is the single place events reach the table, so a
  Dusk brought on by a bot and one brought on by a human lock for the same
  length. `command` used to build its envelopes inline — a second copy of
  `deliver` — which meant a human ending their turn into a Dusk skipped the
  lock entirely, and that is the likeliest way to cause one.
- **Both gates on the bot side**: `max(nextBotAt, lockedUntil)`. The pacing
  clock knows nothing about a Dusk somebody else triggered.
- **Refused, not queued.** A move accepted now and applied in three seconds is
  a move made against a board the player could not see, and in a hidden-role
  game the timing of a click is itself a tell.
- `holdFor` feeds the bot pause AND the lock, so the two cannot drift.

It affects **bot pacing only**. A person's turn takes as long as it takes.

**It is room state, not a client preference.** The pauses happen on the server,
so a client could only ever delay what it already has, never speed it up — and
it has to survive a reconnect and be the same for everyone watching the same
bots.

### There is a host now, and it is a narrowing rather than a reversal

`Room.host` is **the first human to take a chair** — not whoever sent `create`,
which opens chairs and seats nobody, so that would hand the room to someone who
might never sit in it.

The ruling that anyone seated may move a chair still stands, and `begin` is
still open to everyone. The host owns **pacing only**: the one setting that is
table-wide, continuous, and not worth interrupting a game to negotiate. A speed
control needing three people to agree is worse than no speed control.

**The role never goes vacant while anybody is still here.** `rehost` hands it to
the next connected human in seat order on disconnect — silently, no vote. A room
whose host has left is a room nobody can change the speed of, which is the
failure mode of every host-with-exclusive-rights design.

**`speed` is its own outbound message, not a re-sent `table`.** The client treats
any `table` as "we are in the waiting room" (`setTable` is what draws the lobby),
so broadcasting one mid-game would eject the whole table from the board. It
carries the two fields that moved and disturbs nothing else. `you: boolean` says
whether THAT seat owns the control, so no client has to compare ids.

The client renders the picker only for the host — **absent rather than disabled**,
because a greyed button invites a conversation about why it is grey.

## The table exists before the game does

`create` opens a room of empty chairs and nothing else — it takes a **count**,
3 to 5, and no seat configuration. Who fills each chair is decided in the room:
`seat` puts a bot in an empty one or opens it back up, and `begin` deals once
every chair is filled.

`Room.lobby` is therefore **null until someone begins**. A `GameRoom` deals cards
the moment it is constructed and fixes the player count, so building one at
create time meant dealing a game nobody had agreed the shape of and re-dealing on
every seat change. Everything that reaches for `room.lobby` has to handle its
absence — commands, votes and ticks are refused, and `tick` skips a room that has
no game to drive.

Three rulings in here:

- **Anyone seated may move an empty chair.** This is a co-operative game being
  set up by people talking to each other; a host with exclusive rights is one
  more person to wait for. A chair with a *person* in it cannot be touched.
- **Leaving before the deal frees the chair and burns the token.** The grace
  timer, vote and botify machinery are about abandoning a game in progress. Before
  that, closing the tab is leaving the queue, and an empty pre-game room closes.
- **The Marked seat comes from the room seed** (`markedIndex`). The client used to
  send `marked: 0`, which made whoever created the room the traitor in *every
  single game* — the one fact in this design that must never be guessable. The
  seed is server-made and never sent to anyone, so it is unpredictable from
  outside and still deterministic for replay.

Watch for this when touching `parse()`: `create.seats` went from an array to a
number and the shape check has to move with it, or every create is rejected as
malformed with no other symptom.

## The Cloudflare port (worker/)

`server/` still runs and is untouched — `npm run serve` works exactly as before,
so a playtest can fall back mid-session. The port lives alongside it in
`worker/`, and `worker/README.md` is the operating manual.

One Durable Object per room. The object IS the room, which is the whole reason
for the move: no shared room map, no sticky sessions, no instance affinity.

Four things it is designed around, all with a failure mode worth remembering:

- **Hibernation.** Game state in `ctx.storage`; the connection -> seat mapping in
  `connection.setState`. A `Map` keyed by connection id would empty silently and
  unseat players with nothing in any log.
- **The command log, not the state.** Storage holds seed + seats + an ordered
  command list, and the game is rebuilt from it. The state shape changes most
  weeks; the log never needs migrating. Measured: **428 commands rebuild in
  213ms**, so there is no state cache and should not be one yet.
- **One payload per connection**, through `playerView` and `visibleEvents`.
- **`legalCommands` before `apply`**, plus a 16KB cap and a per-connection rate
  limit whose window also lives in connection state.

`GameRoom.botCommand(cursor)` was added to `server/room.ts` — the only change to
existing code, and additive. The object has to know *which* command a bot chose
in order to log it, and `stepBot` picks and applies in one breath. The cursor is
a parameter so a bot's choice is a pure function of the log; with the instance
counter, a room rebuilt after hibernation silently restarted its bots' dice.

**Watch for this:** partyserver resolves its own room name from `ctx.id.name`,
which older workerd builds do not expose — the object then throws during session
setup and the socket closes with 1011 before a single message is exchanged.
`worker/index.ts` sets `x-partykit-room` from the URL, which works on every
runtime.

**Not ported:** the disconnect vote and botify machinery in `server/lobby.ts`.
`vote` answers with an error rather than pretending. See worker/README.md.

## Notes on milestone 3

Hotseat is dropped. The client is networked from the start, with bots able to
fill empty seats. Two consequences worth holding onto:

- **The engine is already shaped for this.** Invariant 3 (`playerView` is the
  only thing a client receives) was built for exactly this, and `sim/bots.ts`
  policies are `(playerView, legalCommands) => Command` — the same interface a
  networked client uses. A bot can be seated server-side unchanged.
- **Validate every inbound command with `isLegal(state, playerId, command)`**
  before calling `apply`. `apply` checks each command's own preconditions, but
  `isLegal` is the gate that rejects anything the rules never offered. This
  matters more here than in most games: the player most motivated to poke at the
  protocol is the Marked one.

**The rules have stopped moving.** Every subsystem in the paper prototype is
modelled, with three deliberate exceptions, all ruled rather than pending:

- The Mythos **Toll** line is unimplemented, so "Choir of the Dry Grass" and
  "Nothing Comes" are permanent Street obstructions — *ruled a feature*: a dead
  slot narrows the posse's options and builds tension, and Act II is tuned around
  it.
- **Burial** is cut; Revenants burn out instead.
- The **Husk** is cut; falls happen in Act II where it could never apply.

**Disconnects are ruled** — timer, then the remaining players vote to botify or
keep waiting; empty lobby closes on the timer. Details and the hidden-role
consequences are in `docs/tech-spec.md` §11. The short version: publish the vote
tally but never the ballots, a bot must inherit the seat's secret role, and
capping the "keep waiting" extensions matters or the vote becomes a stall.

**Revenant turn position is ruled:** original turn order, which is what the
engine already does. They act on less information than if they moved last, and
that is the point.

## Reaction windows: not needed

The three cards that looked like they needed an interrupt do not. From the card
faces: Night Watch is *"once per round, cancel one Threat's Menace"*, Salt Line
is *"prevent 2 damage to any player"*, and the Coyote *"look at the top 3 cards
of the Threat deck, reorder them"*. All are played on your own turn.

Night Watch's Fevered face settles it — it retargets to `firstTriggered`, which
only means anything if the ward is standing and fires on whatever trips it
first. These are wards you set, not responses you make.

So: no priority passing, no acknowledgement step. It would cost pace against the
40-minute target and leak timing tells in a hidden-role game, and nothing needs
it.

All three are implemented. `prevent` was one op doing two unrelated jobs and is
now `cancelMenace` (silences a Threat for the round, targets a Street slot) and
`shield` (a damage buffer on a player). `scry` reads the *Threat* deck — it had
been pointed at the player's own — and steers which card arrives next.

## Why the engine came first

The paper prototype left three numbers as pure guesses: the Whisper threshold
(12), the Vessel's Clear value (12), and the Sign cost curve. A headless engine
plus dumb bots answers all three overnight. That — not multiplayer — is the
reason this project is digital. Do not build UI before the simulator.
