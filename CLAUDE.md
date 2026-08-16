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

**Damage vs. Signs (blocking).** The paper rules contradict themselves. One line
says damage trashes "Provisions and Kit before Signs"; another says Signs can
never be trashed at all. Taken literally, the second makes a fully corrupted
player immortal. Currently implemented as: non-Signs first, then Signs once
nothing else remains. This decides whether Sign-heavy play is self-limiting or
dominant — resolve before playtesting.

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
- Revenant actions (WHISPER, BECKON, RISE, Grave-token spending) are absent.

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
`isLegal`".** It forces the Turning (`GameRoom.devForceTurning`, which pushes the
Whisper track to its threshold and lets the real `checkTurning` fire, rather than
reimplementing the hinge of the game) and re-deals a fresh Act I. It is:

- **off by default** — `Hub` takes `devTools`, and only `LONG_NOON_DEV=1 npm run
  serve:dev` turns it on;
- **advertised to the client** on `joined`, so the buttons cannot appear against
  a server that would refuse them;
- **tested for being shut** — `tests/hub.test.ts` asserts the closed default,
  the refusal message and the flag on both settings.

Keep it that way. Choosing the moment of the Turning is the single most valuable
thing the Marked player could buy: their secret aim is scored at that exact
instant. There is deliberately no way back from the Turning either — Signs are
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
