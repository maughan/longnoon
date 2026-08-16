# Milestone 2 — what the simulator found

All runs: 4 players. Headline figures are with a Marked player — the game as
actually played — with the traitorless variant alongside (DESIGN.md §10 wants the
first session played that way). Every game is seeded, so the numbers below
reproduce exactly.

> ## ⚠️ Re-derived after two simulator bugs — read this first
>
> Two bugs in the bots invalidated every number that used to be here. Both are
> fixed and the tuning has been re-derived, but the older *specific figures*
> throughout this document are stale. The **mechanisms** described still hold;
> the win rates do not.
>
> **Bug 1 — only 3 of 12 Signs were ever bought.** `dearest()` broke cost ties
> alphabetically, so exactly one Sign per price point was purchased: colt,
> dynamite, certainty. None of the four Vessel-facing Signs ever entered play,
> which means the entire "Fevered Signs turn on the Vessel" design change was
> tuned around cards no game contained. Bots now pick uniformly among affordable
> Signs.
>
> **Bug 2 — bots played every Sign they drew.** `playsSigns: always` dumped 1–3
> Whispers for effects like "draw 3". With all 12 Signs in rotation this became
> catastrophic: the Turning moved to round 4.8 and Sign-buyers speedran the
> track against themselves. Replaced with a per-card rule — Whispers are only a
> cost in Act I, so play a Sign only for an effect you can use *now*. The Turning
> went back to 6.4.
>
> **Lesson worth keeping:** twice now, a "the mechanic does nothing" result was
> the bot failing to exercise it (burial, and these). Before believing any
> "X never matters" finding, check the bots can actually do X.

---

---

## The headline: Puritan vs Zealot

```bash
npm run sim -- headline --games=400 --marked      # the game as actually played
npm run sim -- headline --games=400 --vessel=20   # traitorless first session
```

"Win rate" is the posse win rate of a table where every seat plays that policy —
in a co-op every seat shares the outcome. Stalls are excluded from the
denominator. At n=400 the 95% CI is roughly ±5pp.

**With a Marked player** (default `TUNING`, n=400):

| policy | posse win | vs Balanced | Turning as % of length | any death |
|---|---|---|---|---|
| **Balanced** | **47.0%** | — | **59.1%** | 17.3% |
| Greedy | 35.5% | −11.5pp (z ≈ 3.3) | 58.5% | 14.8% |
| Puritan | 32.0% | −15.0pp (z ≈ 4.4) | 78.0% | 72.8% |
| Zealot | 18.5% | −28.5pp | 58.3% | 79.0% |
| Random | 0.3% | — | 91.4% | 99.8% |

**Both of DESIGN.md §2's tests pass, significantly.** The middle is the best play
by a clear margin, no policy clears 55%, and the Turning lands on its ~60% target.

**And the corruption curve is real.** Sweeping the Sign-buying ratio produces an
interior optimum — not zero Signs, not maximum Signs:

| Sign-buying stance | posse win (n=250) |
|---|---|
| 0.00 — Puritan, never buy | 32.4% |
| **0.15** | **44.0%** |
| 0.30 | 40.4% |
| 0.50 | 40.8% |
| 0.70 | 27.2% |
| 1.00 — Zealot, always | 19.2% |

That curve is what the whole project was built to measure (DESIGN.md §2: "if
Whispers scale super-linearly and Provisions stay genuinely functional, the
optimum lands in the middle. This is the whole game.").

One caveat worth carrying to the table: the winning line is also the *safest*
(17.3% of Balanced games see a fall, against 73–79% for the extremes). The
attritional Act II bites hardest on the players who over- or under-commit.

**Traitorless** — `vesselClear: 37` (DESIGN.md §10's first session). The traitor
is worth about 5 points of `vesselClear`.

**Verdict: HOLDING in both.** Neither extreme exceeds 55%, and the middle is the
best play by a significant margin.

| DESIGN.md §2 test | with a traitor | traitorless |
|---|---|---|
| Would a strong player buy **only** Signs? | **No** — 46.0% vs 59.0% (z ≈ 3.7) | **No** — 29.5% vs 61.5% |
| Would a strong player buy **zero** Signs? | **No** — 11.0% vs 59.0% | **No** — 21.5% vs 61.5% |

**Ruled: the Puritan floor is intentional.** Refusing Signs wins ~5% of the time.
That is not a balance failure but the premise — the power is not optional, and a
posse that will not take it dies to attrition. It serves the theme.

Nobody falls before round 5 in any non-Random game (early-death ≤ 0.3% for
Balanced), which is exactly the shape DESIGN.md §10 asked for. **No stalls
anywhere** — Revenant Whispers now guarantee the Turning arrives even at a table
that buys nothing.

---

## The measured tuning

| value | paper | measured | why |
|---|---|---|---|
| `whisperThreshold` | 12 | **14** | The Turning lands later for Sign-buyers, giving them an Act I long enough to be worth the corruption. |
| `vesselClear` | 12 | **32** | The pacing lever: the game ends when the posse burns the Vessel down, so this sets Act II's length. **37 traitorless** — the traitor is worth ~5 points. See Finding 7. |
| `doomTarget` | 20 | **50** | Gives the Vessel room to be ground down over ~5 rounds. Raising it alone only makes the game easier — it lengthens Act II only paired with `vesselClear`. |
| `omenMenace` | 0 | **1** | At 0, deck-as-health was dead content — nobody fell even at 8× `damagePerHit`. See Finding 4. |
| `menacePerSign` | — | **0.45** | New. Flat attrition only ever threatened the zero-Sign deck; scaling the wound with the corruption that drew it reaches a balanced table too. See Finding 4. |
| `markedAimDoomBonus` | 3 | **3** | Newly implemented, straight from the role card. Was a stub. See Finding 5. |
| `provisionDeckSize` | 20 | **20** | Briefly 16, then back — once Omens deal Menace, attrition punishes the zero-Sign deck on its own. At 20 the cut is a no-op, so no market variance is introduced (DESIGN.md §9). |
| `startingDeckSize` | 8 | **8** | New dial, kept at the paper value. Chaff is armour, but it arms the Sign-buyer more than the Puritan — at 10 the Zealot overtakes Balanced. |
| `revenantDecay` | 1 | **1** | New. The Revenant's own clock, and the replacement for burial. See Finding 6. |

```bash
npm run sim -- sweep --games=200 --prov=16,20 --omenmenace=0,1
npm run sim -- sweep --games=120 --whisper=8,10,12,14 --doom=23,26,29 --vessel=18,20,22
```

The sweep takes any numeric `TUNING` key as an axis and builds the cartesian
product; cells where the middle is the best play are marked `*`.

> ⚠️ A `whisper=14, doom=26, vessel=20` cell showed a 0.0pp Puritan/Zealot gap at
> 120 games per cell; at 500 it was 9.4pp. Treat single-cell gaps under ~10pp at
> n=120 as noise.

**Two engine rules were added alongside the tuning:**

- **The Turning fires when the Trouble deck runs out** (`turnOnTroubleExhausted`).
  Without it a table that buys no Signs never Turns and the game has no ending —
  150 of 150 games stalled. The Long Season ends because someone couldn't resist,
  *or* because it simply ran out.
- **Menace ties break at random.** `reduce` with a strict `>` returns the first
  match, so a table with Signs level — a zero-Sign table, most obviously — sent
  every point of Menace to the same seat all game and cascaded down the table.
  Invisible until Omens started dealing damage. This resolves the "Menace
  targeting" open ruling in CLAUDE.md: it *was* doing too much balancing work,
  and the tie-break alone moved Puritan from 2.7% to 16.7%.

---

## What had to change to get here

**1. Act II mechanics missing from the engine** (specified in the paper
prototype, covered by `tests/actii.test.ts`):

- The Vessel is a damage target — previously a flat 1 per action that no card
  could contribute to, so Act I purchases had no causal path to the result.
- The Vessel and Revenants aim their Fevered cards — the paper's "now you aim
  them again". CALL stays unaimed, as written.
- The Omen reset — `vesselDamage` zeroes when an Omen enters the Street.
- `DEAL_DAMAGE` no longer accepts a client-supplied `amount` (`9999` won
  instantly).

**2. The Omen gate dropped** (`omensBlockBurial: false`) — Finding 1.

**3. Some Fevered Signs turn on the Vessel.** Last Words (2), Night Watch (2),
Salt Line (1) and the Coyote (1) gained a Vessel-facing `damage` op that cannot
be aimed or withheld. Three of those four were previously *inert* in Act II —
Last Words had no ops at all, and `prevent`/`scry` are stubs.

**4. Two rules stop that making Signs strictly better than Provisions:**

- **No card does both jobs.** A Sign that clears the Street (Colt, Dynamite) gets
  no Vessel damage, and vice versa. This was the single biggest lever —
  Finding 2.
- **Each Vessel-facing face trashes a card off your own deck.** Damage eats Kit
  and Provisions before Signs, so firing the corrupted card leaves you more
  corrupt.

---

## Finding 1 — why the Omen gate had to go

An Omen cannot be cleared, and the **only** mechanism that removes one is Street
overflow, which requires the Street to be **full**. Clearing Threats keeps slots
empty, prevents overflow, and keeps the Omen parked. **The better a table fought,
the more reliably it locked itself out of its own win condition.**

Zealot cleared 348 Act II Threats and got 12 overflow evictions; Puritan cleared
117 and got 112. Zealot's Omen count sat at exactly 1.00 for every Act II round
while Puritan's fell 1.00 → 0.23 → 0.03 → 0.00.

| games where burial was **never** legal | with the gate | without |
|---|---|---|
| Puritan | 16% | **0%** |
| Zealot | **91%** | **0%** |

The other half of the same paper line, "damage resets to 0 if an Omen enters",
survives. Set `omensBlockBurial: true` to restore the gate for comparison.

---

## Finding 2 — double-duty was the whole imbalance

When the Vessel-facing damage was first put on the Colt and Dynamite — Signs that
already destroy Threats — Zealot won 90–100% in **every** cell of the grid. Two
things that looked like levers were not:

- **Magnitude did nothing.** Halving the Vessel damage (8 total → 5) moved Zealot
  by roughly nothing.
- **The deck-trash cost did nothing.** Act II is two to three rounds; attrition
  cannot accumulate in that time.

The lever was that a Fevered Colt destroyed a Threat *and* wounded the Vessel,
while a Winchester must choose — and because Doom rises +1 per unresolved Mythos
Threat at Dusk, clearing also buys Act II length, so the double-duty card was
paid twice. Moving the Vessel damage onto Signs that *don't* clear the Street
took Zealot from a flat ~100% to a real curve, which made the grid tunable.

---

## Finding 3 — Provision scarcity, not Omen Whispers

Two levers were proposed for "a zero-Sign deck is still as good as a balanced
one". Both were measured; only one works.

**Lever A — Provision scarcity (adopted).** Buying is the only healing, so the
finite Provision deck is what should make refusing Signs unsustainable. It
wasn't: a Puritan exhausted the 20-card deck by round 3.6 and won anyway.

| `provisionDeckSize` | Puritan | Zealot | Balanced |
|---|---|---|---|
| 10 | 12.0% | 30.0% | 46.0% |
| 13 | 12.7% | 29.3% | 50.7% |
| **16** | **28.4%** | **32.2%** | **42.6%** |
| 20 | 41.6% | 32.2% | 43.6% |

Zealot is almost unaffected — they barely buy Provisions — so this is a targeted
lever that moves Puritan alone. 16 is where both extremes land together, below
Balanced.

**Lever B — Omen Whispers off (rejected).** Setting `omenWhispersPerRound: 0`
makes the Turning fire strictly "because someone couldn't resist", which is
closer to DESIGN.md §3's intent. It took Puritan to 0% — but by **stalling 150 of
150 games**: a table that buys no Signs never Turned, and the game had no other
ending.

That hole is now closed by `turnOnTroubleExhausted`, and with it Lever B runs to
completion with zero stalls. It is still rejected on the numbers — it pushes
Zealot to 62.7%, over the 55% bar — but it is now a live option rather than a
broken one.

---

## Finding 4 — deck-as-health, now live for everyone

**`damagePerHit` was never the lever.** With Omens dealing no Menace, nobody
died at the paper value or at eight times it:

| `damagePerHit` | any death | early death (≤ r4) |
|---|---|---|
| 1 *(paper)* | **0.0%** | 0.0% |
| 2 | **0.0%** | 0.0% |
| 4 | 4.4% | 3.3% |
| 8 | 11.7% | 5.8% |

The structure was the problem: all Menace came from Threats the posse can clear,
and the one Threat it cannot clear — the Omen — was authored `menace: 0` *and*
skipped by `dusk()`. Competent play simply never took damage.

**Giving Omens a Menace fixed that**, and the thing you cannot clear is now the
thing that costs you. Nobody falls before round 5 in any non-Random game, which
is the shape DESIGN.md §10 wanted.

**But flat damage only ever bit the deck that refuses Signs.** Signs are an
**unlimited** card supply and therefore unlimited healing, so a Sign-buying table
outgrew attrition entirely while a Puritan ran out of Provisions and died:

| policy | any death, `menacePerSign: 0` | with `menacePerSign: 0.35` |
|---|---|---|
| Puritan | 50.5% | 50.5% |
| Greedy | 0.5% | 43.5% |
| Zealot | 0.5% | 40.3% |
| **Balanced** | **1.5%** | **24.3%** |

Raising `damagePerHit` could not fix this: at 2 it reached balanced tables (25%
deaths) but annihilated the Puritan (1.0% win rate, 99.7% deaths) and collapsed
Zealot onto Balanced, because Provisions are capped and Signs are not.

**`menacePerSign` fixed it** by scaling the wound with the corruption that drew
it — floored extra damage per Sign the victim holds. Puritan is untouched (they
hold none, so they stay on flat damage) while a Sign-heavy deck finally takes
real losses. Above ~0.4 it starts wiping the Zealot out entirely.

Corruption already drew attention; now it also cuts deeper. Deck-as-health is a
live mechanic for every policy, and the Revenant / Husk / Beckon subsystems are
finally reachable in games people would actually play.

---

## Finding 5 — the traitor is worth about 4 points of `vesselClear`

The Marked player had never been measured, and until now there was nothing to
measure: no bot behaved differently when Marked, and the role's only mechanical
hook — the secret aim — was a stub. Both are now implemented.

**The aim, straight from the role card:** *"at the Turning, two other players
must each hold 3 or more Signs. If they do, you begin the Vessel's turn with +3
Doom."* The Marked player's own Signs do not count.

**The Marked bot.** They cannot make anyone buy, so their only mechanical lever
is *timing*: playing a Sign advances the shared Whisper track and brings the
Turning on. So the Marked bot buys Signs enthusiastically throughout — the
"encourage" half, indistinguishable from playing well — but **holds them back**
until two other players are corrupted, then stops holding back.

The effect is large, and splits cleanly in two:

| Balanced posse win | |
|---|---|
| traitorless | 47.5% |
| Marked bot present, `markedAimDoomBonus: 0` | 32.0% |
| Marked bot present, aim implemented | 18.0% |

The bot's presence costs ~15pp, and the +3 Doom costs another ~14pp. Three Doom
looks small against a target of 26, but Act II runs only ~2.5 rounds at ~9 Doom
per round, so it is a third of a round at a very steep margin.

**Consequence: traitorless tuning does not transfer.** Re-swept with a Marked
player, `vesselClear: 16` restores Balanced to 45.8% with both extremes far
below 55%. So the traitor is worth roughly 4 points of `vesselClear`, and the
committed default is tuned for the game as actually played. **Use `vesselClear:
20` for the traitorless first session** DESIGN.md §10 recommends.

---

## Finding 6 — burial was cut; the Revenant burns out instead

All four Revenant actions were implemented (WHISPER, BECKON, RISE) along with
two-player burial and Grave tokens — and burial measured as a bad trade at any
price. Across 200 games per policy:

**`buried = 501, rose = 501`.** Every burial was undone at once. The posse spent
**two actions and a permanent Scar**; the Revenant spent **one action** to climb
back out. DESIGN.md's proposed remedy — drop burial to one action — still leaves
one action plus a Scar against one action. Removing a Revenant permanently took
four burials: eight posse actions and four Scars, and the last one added +3
Whispers, *accelerating the Turning against the people who just paid for it*.
Balanced tables paid it twice in 200 games; Zealot tables never.

**So burial, Rise and Grave tokens were cut entirely.** What replaced it is the
clock the paper already gave the Revenant: *"You shrink. Strongest the moment you
turn, weaker every round after."* `refill` used to floor them at one card so they
never actually ran out; now a Revenant who exhausts their deck is **gone for
good** (`revenantDecay` per recycle). The posse's answer is to outlast them, not
to dig a hole. The Vessel still floors at one card so the endgame cannot stall.

Two things this exposed:

- **A burn-out deadlock.** A Revenant can burn out on the very draw that starts
  their turn, which left `activePlayer` on a player with no legal commands and
  hung the game (245 of 250 Puritan games). `startTurn` now advances past them,
  and a `gone` active player is always offered `END_TURN` as a safety valve.
- **Husks never happen.** Zero in 600 games — nobody falls before round 3, so
  `huskCutoffRound` is dead content.

## Finding 7 — the Turning target was reachable, but only by abandoning "three rounds"

The ~60% Turning mark and DESIGN.md §3's "Act II, short and violent, roughly
three rounds" are mutually exclusive at any Act I long enough to build a deck:
with Act II at *R* rounds and Act I at *A*, the Turning lands at `A / (A + R)`,
so 60% needs `R = 0.67 × A` — about five rounds against a seven-round Act I.

**Ruled: keep the 60% mark, drop "short and violent."** Act II is now a drawn-out
duel — ~5 rounds, 54–75% of games seeing a death — and the Turning lands at
57.9% for a Balanced table.

Getting there needed both clocks, and the order matters:

- **`doomTarget` alone does nothing for pacing.** From 26 to 50 the Turning moved
  only 80.4% → 77.7% while win rates went 48% → 93%. It is a difficulty lever.
- **`vesselClear` is the pacing lever**, because the game ends when the posse
  burns the Vessel down, not when Doom runs out. Only raising both (50 / 34) both
  lengthens Act II and keeps it hard.
- **`startingDeckSize` is not a lever for this.** Padding the start with chaff
  helps the Sign-buyer far more than the Puritan: at 10 the Zealot overtakes
  Balanced (50.0% vs 49.3%) and DESIGN.md §2's second test fails. Kept at 8.

**The cost:** a zero-Sign deck is no longer viable at all (Puritan 7.3%), and
games run ~12 rounds against a 40-minute target. Both are judgement calls rather
than errors — refusing the power now kills you, which is the premise, but it is
worth checking the clock at a real table.

## Finding 8 — Act I Bounties and the economy inversion

**Bounties are in.** All nine Act I Trouble cards now pay the player who clears
them, straight from the card faces — a free Provision, banked Grit for next turn,
draw 2, and so on. Two needed a new op (`gritNextTurn`) because the paper pays
some Bounties "on your next turn". Omens pay nothing, and *"Nothing in Act II pays
a Bounty. Ever."*

That is DESIGN.md §7's economy inversion, and it is a large effect: at the same
tuning, Balanced went **46.0% → 58.0%** simply because Act I combat started
paying. `vesselClear` was retuned 34 → 36 to absorb it. Act I combat is now
generative and Act II combat is pure defence, exactly as designed.

---

## Finding 9 — the Husk is cut, and a stand-in turned out to be load-bearing

**The Husk is gone.** It could not happen and the cutoff was not why: 88% of falls
land in Act II, where the state does not apply, and even `huskCutoffRound: 12`
produced 6 Husks in 116 falls with no measurable effect on any outcome. It was an
anti-suicide guard for a death that happens late and that no Faithful player
wants. Cut, along with its tuning value.

**Trouble reverses are now real cards.** "Every Trouble card still in the Street
flips to its reverse" — four of the nine have one, and all four faces are printed
in the paper:

| Act I | flips to |
|---|---|
| Claim Jumpers | They Were Never Miners — Menace targets the *fewest cards in deck* |
| Rustlers at the Draw | They Brought the Herd Back — cannot be cleared while an Omen sits |
| Cattle Baron's Men | The Baron Kept His Promise — +2 Whispers when cleared |
| Prairie Fire | It Burns the Wrong Colour — Menace hits *every* player |

That needed three new generic Threat fields — `menaceTarget`, `onCleared`,
`noClearWhileOmen` — all reusable, and `menaceTarget` also lets "Your Own Face,
Waiting" state its targeting explicitly instead of relying on the default.

**And it exposed a stand-in doing real work.** The engine had faked the Turning
flip as "+1 Menace on every turned card". Replacing that with four real reverses
*reduced* Act II Menace sharply, because five of nine Trouble cards have no
reverse at all. The knock-on: Zealot and Balanced converged to **within 1pp** at
every `vesselClear` — DESIGN.md §2's second test started failing. The blanket +1
had been quietly punishing Sign-heavy decks for their Menace magnetism.

Restoring that took `menacePerSign` 0.35 → **0.45** (the dial that punishes
corruption directly) with `vesselClear` 36 → **32** to keep the difficulty. Worth
remembering: an approximation that looks cosmetic can be carrying the balance.

---

## Finding 10 — the Last Words battery, and what closing it left behind

**The exploit.** "Greedy" — buy the dearest affordable card — won **96.5%**, and
held above 80% even at `vesselClear: 40`, so it was not a difficulty problem. It
bought almost nothing but cost-4 Signs (`last-words` ×753, `colt` ×657 over 80
games), because Signs are an unlimited supply while Provisions are a finite row.

**The mechanism generalises:** a Sign's Whispers are charged when it is
**played**, not when it is bought. A Sign you never play therefore costs nothing
— you bank its Grit 2 every reshuffle and collect its Fevered face at the
Turning.

`Last Words` was the perfect vehicle, and this project built it. The paper card
reads *"when your deck would empty, keep 2 cards instead of falling"* — a passive
you are **meant to hoard**, never play. It had been left as a `passive` string
with no implementation, and then given a Vessel-facing Fevered face, which turned
defensive insurance into a battery: never played, 3 Whispers never paid, cashing
out as 2 free Act II damage.

**The fix**, in three parts:

1. The passive is implemented. When you would fall, a held Last Words spends
   itself, pulls 2 cards back out of your boneyard, and you keep standing.
   Fevered, it still saves you but you come back with a Scar.
2. Damage trashes Last Words **last of all** — being destroyed by the damage it
   exists to survive would make it useless.
3. Its Vessel-facing Fevered damage is removed. Three Signs still carry that
   (Salt Line, Night Watch, the Coyote); the insurance card does not.

Greedy fell from **96.5% to ~37%**.

**What that left behind.** Closing the exploit exposed a second, milder
distortion: `Balanced` was buying *uniformly at random* among affordable Signs,
so it bought worse cards than Greedy did — the "is the middle best?" comparison
was measuring buying skill, not corruption strategy. Balanced now buys the
dearest affordable Sign while the track is safe (random tie-break keeps the
coverage).

**And a third distortion, found by checking rather than tuning.** With the
exploit closed, Balanced led Puritan and Greedy by only ~2pp — inside the noise.
Rather than tune, I checked whether Greedy was genuinely competitive. It was not:
`Balanced` crossed its own Sign-buying cutoff at round **5.4** with the Turning at
**7.5**, so it only diverged from Greedy for the last two rounds and bought 53.0
Signs a game against Greedy's 57.5. Its ratio was 0.5 — chosen long before
`whisperThreshold` was tuned from 12 to 26, which quietly moved the brake to the
very end of Act I.

"The middle" is a dial, not a strategy. Sweeping it found the interior optimum at
**0.15**, and with that as the default Balanced beats Greedy by 11.5pp
(z ≈ 3.3) and Puritan by 15.0pp (z ≈ 4.4). The game was not broken; the middle
was mis-specified.

## Finding 11 — corruption is correctly self-punishing

```bash
npm run sim -- mixed --games=300
```

| seat | became the Vessel | fair share |
|---|---|---|
| Puritan | **0.0%** | 25% |
| Zealot | **49.7%** | 25% |
| Greedy | 47.7% | 25% |
| Balanced | 2.7% | 25% |

Buying Signs reliably costs you your character.

---

## What to do next, in order

**Every subsystem in the paper prototype is now modelled**, with three
deliberate exceptions noted below. The remaining work is a short list.

Every subsystem in the paper prototype is now modelled. Two pieces of card text
remain approximated, both blocked on the same design decision:

1. **Close the Last Words battery** (Finding 10). Greedy at 96.5% means the game
   has a dominant strategy. Recommended: give Last Words a real clean face, then
   re-run `headline` — the Greedy row is now in the sweep grid, so it cannot hide
   again.
2. **Then re-check the whole tuning.** Everything here was fitted with that
   exploit live, so closing it will move the numbers.
3. **Then milestone 3** — the online client, with bots able to fill seats. The
   simulator's bots already speak the client interface exactly (`playerView` +
   `legalCommands` in, `Command` out), so seating one online costs nothing.

Deliberately not doing: reaction windows (not needed — the three cards are
turn-based), the Mythos Toll line, and removing the dead Street slots (ruled a
feature).

Still unimplemented: Revenant actions (WHISPER, BECKON, RISE, Grave-token
spending), Act I Bounty rewards, and the Marked player's +3 Doom.

## Caveats on the bots

Puritan and Zealot differ **only** in `pick` (what to buy) and whether they will
play a Sign; threat handling, spending, targeting and the Act II race are shared
code. The Vessel policy is fixed (always Whisper) across every experiment. These
are competent, not optimal, bots — in particular the shared Act II policy spends
damage on the Vessel whenever a Threat cannot be finished outright, which may
under-rate Threat-clearing for policies whose cards must choose. Note that bot
competence is load-bearing for Finding 4: worse bots would fail to clear Threats
and *would* start dying.

Two earlier claims in this document were wrong and have been corrected: the Omen
gate was **not** undocumented (it is in the paper rules — it was dropped on the
evidence in Finding 1, not for being unwritten), and the Vessel **does** have a
PLAY action; what it lacked was the ability to aim.
