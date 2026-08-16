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

A Fevered (corrupted) card is the same effect expressed three ways:

- **retarget** — same op, different target (`{ 0: 'leftmostSlot' }`)
- **appendOps** — an extra cost bolted on (`{ op: 'whisper', n: 1 }`)
- **constraints** — a compulsion (`mustPlayOnDraw`)

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

**Bots are floored at one action per 5s** (`Hub`'s `minGapMs`, overridable with
`LONG_NOON_BOT_GAP`). This is a rate limit sitting on top of the pacing model
below, not a replacement for it — a Dusk or the Turning still costs more. It is
the obvious lever for a game-speed control.

It is not free. Measured over full games, bot time alone:

| Table | Bot actions | Paced only | With the 5s floor |
|---|---|---|---|
| 1 human + 2 bots | 210 | 6.5 min | **18.8 min** |
| 1 human + 3 bots | 264 | 6.9 min | 22.9 min |
| 1 human + 4 bots | 300 | 7.4 min | 26.0 min |

Against DESIGN.md's 40-minute target that is most of the session at four or five
players, before anyone human has thought about anything. If table time starts
mattering again, this number is the first place to look, and the measurements
above are the baseline to compare against.

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
