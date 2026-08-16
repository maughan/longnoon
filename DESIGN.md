# The Long Noon — Design Document

Everything decided during design, and why. Read this before proposing mechanical
changes; most obvious ideas were considered and rejected for reasons recorded here.

---

## 1. Premise and tone

Cowboys and Cthulhu. A frontier town, a posse holding it together, and something
underneath it waking up.

**Register: weird west mythic.** Not pulpy, not gore. The Old One is something
the *land remembers*, not a monster to shoot. Card titles read like ballad verses
and scripture.

Two content rules, both deliberate:

- **Invent the frontier folklore.** Do not borrow real Indigenous cosmology. This
  sidesteps appropriation and also works better mechanically — mythic tone lands
  harder when the audience can't check your homework.
- **Discard Lovecraft's xenophobia entirely.** The horror is knowledge and
  complicity, not the foreign or the outsider.

Win conditions are about **burial, bargain, or witness** — not damage output.

---

## 2. The core engine: temptation

The thematic marriage is: Westerns are about self-reliance and greed; Cthulhu is
about knowledge that costs you.

**Your deck is your sanity.** The cards that make you strong are the cards ruining
you. The Lore you buy to survive tonight damns you by Act III.

Two design tests, both of which must fail for the game to work:

- Would a strong player ever buy **zero** Signs? Must be no.
- Would a strong player ever buy **only** Signs? Must be no.

If Whispers scale super-linearly and Provisions stay genuinely functional, the
optimum lands in the middle. This is the whole game. Everything else is support.

---

## 3. Structure: the mode switch

The game plays as a co-op deck builder until it stops being one.

**Act I — The Long Season.** Posse builds decks against a decaying town. Market
splits into **Provisions** (cheap, honest, weak) and **Signs** (strong,
unremovable, Whisper-bearing). One player is secretly **Marked** — they don't
sabotage, they *encourage*, which is indistinguishable from playing well.

**The Turning.** When the shared Whisper track crosses its threshold, the Marked
reveals and the game becomes 1-vs-many. Crucially the horror arrives *because
someone couldn't resist*, not on a timer.

**Act II.** Short and violent, roughly three rounds. Nothing pays a Bounty.

**Finale.** Burying the Vessel.

### The Vessel is the player. The Old One is the fiction.

They are one entity described at two layers, and **only the player layer is
allowed in the interface.**

- The **VESSEL** is a status, a seat, a tag in the player list, a thing you can
  shoot. This is the only word that appears in rules text, in the player list,
  in the state, or anywhere in the UI.
- The **OLD ONE** is what is *using* the Vessel. It is never a player, never a
  status, never a tag, and never appears in the player list. It is what the
  Doom track counts and what came through the door at the Turning. You never
  interact with it directly, so it does not need a seat.

The posse's win condition already says this out loud: they **bury the Vessel** —
a body. Closing the door is not killing the thing behind it.

The one place the old name belongs is **the Turning**, which is the moment the
Old One arrives. Naming it once, at possession, and never again in the
interface, is the correct amount.

Variant worth testing: run with **no Marked player at all** and don't tell anyone.
The thing wakes on its own, plays worse, but wakes angrier. Players never know
which game they're in.

---

## 4. Corruption in three layers

Each pays a different currency.

**Layer 1 — Whispers (public, immediate, collective).** Each Sign carries 1–3
Whisper icons that fire on play, adding to a shared track. *The cost of your
power is paid by the table.* That's a commons problem, and it gives the Marked
player a job that looks exactly like enthusiasm.

**Layer 2 — Fevering (personal, deferred).** At the Turning, every Sign flips to
its Fevered face: same magnitude, no longer aimed by you.

> **THE COLT THAT DOESN'T MISS** — Destroy any one Threat.
> *(Fevered)* **IT CHOOSES** — Destroy the leftmost Threat.

**Nobody loses power. They lose agency.** That is the actual horror and a far
better table feeling than a stat penalty.

**Layer 3 — Calling (endgame).** The Old One can activate any Fevered Sign in a
player's deck against them. Every Sign bought in Act I is a weapon you handed to
whoever wakes up.

### Why Signs are never strictly worse

The moment corruption reads as "−1 card quality," players do arithmetic and the
temptation dies. Signs must stay strong and become *less yours*.

### Signs cannot be trashed

Deck-thinning is the standard escape hatch. It's removed. Burying a Sign
voluntarily costs a permanent **Scar**. You can't unlearn it, only carry it
differently.

---

## 5. Deck-as-health

No HP track. Damage trashes cards from your deck.

Since Signs resist trashing, **damage eats your Provisions first** — so a wounded
player becomes progressively more corrupt. Smaller deck, higher Sign density,
more Fevered draws, closer to becoming the Vessel. The death spiral has a
*direction*.

Consequences that fall out of this, all intended:

- **Buying is healing.** One resource wearing two hats. When the Provision deck
  runs dry, healing stops existing without needing a rule.
- **Standard deck builder logic inverts.** Thin means fragile. Chaff is armour.
  Trashing becomes a gamble rather than an obvious good.

⚠️ **Unresolved contradiction:** the paper rules say both "Provisions before
Signs" *and* "Signs can never be trashed." Literally read, the second makes a
fully corrupted player immortal. See `CLAUDE.md` → Open rulings.

---

## 6. Falling: the Revenant

If knocked out before the Turning, you return as a corrupted minion of the Old
One. This solves the dead-player problem and gives the Marked player **cover** —
once there's an obvious enemy, nobody scrutinises the helpful guy.

- Keep your deck, which by now is nearly all Signs. You come back **concentrated**:
  small, all teeth, and you aim your Fevered cards again.
- **You win only if the Old One wins.** Cannot be bribed or negotiated with.
- **You still speak.** A corrupted minion telling the truth is more disruptive
  than one lying.
- **You shrink.** Your deck loses one card permanently per recycle, and you can
  never buy. Strongest the moment you turn, weaker every round after — this is
  the anti-suicide guard.
- **Burying you costs.** Two living players, an action each, and a Scar.
  Otherwise the table just removes you and pressure evaporates.
- **Husk mode.** Dying before round 4 gets you a *worse* version: 1 action, no
  Beckon, 1 Grave token, until the Turning wakes you fully. The incentive must
  never point toward dying on purpose.

**Beckon** — a Revenant action that rewards a living player for buying a Sign.
It lets the Revenant do openly what the Marked does secretly, which muddies the
read. It is also the most fiddly action in the game and the **first thing to cut**
if play feels muddy.

---

## 7. Threats and the Street

**No map.** Locations were cut — they did nothing for a 40-minute game. Everything
happens in **the Street**: three slots, everyone can reach everything.

Threat anatomy: **Clear** (damage to remove), **Menace** (damage dealt at Dusk if
unresolved), and a third line that changes by act — **Bounty** in Act I, **Toll**
in Act II.

**The economy inverts across acts.** Act I combat is *generative*: you fight
rustlers, and winning pays. Act II combat pays nothing — you spend to survive.
Same fights, opposite math, and the floor drops without anything being explained.

**Omens** (3 in the Trouble deck) cannot be cleared, occupy a slot forever, and
add +1 Whisper per round. Creeping dread doing real mechanical work.

**Four Trouble cards have reverses.** At the Turning, everything still in the
Street flips. Every threat you left standing becomes the thing that kills you.

**Overflow:** a fourth threat arriving with the Street full resolves the oldest
immediately and unavoidably. Slot pressure is its own clock.

**"Nothing Comes"** sits in the Mythos deck: no Clear, no Menace, nothing happens
this round. Putting the quiet round *in the deck* rather than on a schedule means
it can land anywhere — including right before the end.

---

## 8. Cards

Four types: **Kit** (repeatable, reliable), **Deed** (one-shot, often self-trashing,
deliberately at war with deck-as-health), **Sign**, **Scar** (Grit 0, no effect,
untrashable ballast — the only purely bad card).

**Every card is dual-use.** A Grit value in the corner; each card is either played
for effect or spent for Grit. No dedicated money cards — in an 8-round game you
can't afford dead draws.

Starting deck (8 cards, identical for all players): 3× Saddlebag, 2× Six-Gun,
Canteen, Grubstake, Bad Nerve. Draw 5. Roughly 6 Grit per turn — one cheap buy,
not enough for a Sign every turn.

Character asymmetry is a **v2 problem**. Keep starts identical until the
corruption curve is readable.

---

## 9. Explicitly cut or deferred

**The chamber track (deferred to v2).** Six pips, firing costs one, Reload is an
action. It gives a non-coin resource and a public tell — everyone sees who's dry.
But it's a *fourth* track alongside Whispers, Grit, and deck-as-health, and for
avid players it may be a tax on the obvious action rather than a decision. Test:
is "shoot or save the bullet" ever genuinely hard? If players always shoot, cut it.
Add as a variant in session three; you can always add a track, but it's hard to
notice one quietly deadening play.

Two lighter alternatives if it's revisited: fold it into deck-as-health (guns cost
a card to fire), or make it one shared six-chamber track for the whole posse.

**Locations / a map.** Cut. See §7.

**Randomised market setup.** Cut for now — it's a variance source you don't want
while measuring the corruption curve.

---

## 10. Playtesting protocol

Testers are avid board gamers, which changes the approach:

- **Run the first session with no traitor and don't tell them.** If the deck
  builder isn't tense on its own, the traitor is compensating for a weak core and
  you'll never see it.
- **They will solve the temptation math in two rounds.** Let them, then take the
  number they give you.
- **State the design question out loud before starting.** Experienced testers are
  much better at "watch whether the Fevered flip feels bad or interesting" than
  at "did you have fun?"
- Short and repeatable beats long and grand. Three 35-minute games teaches more
  than one 90-minute game.

### Watch list

- Does anyone buy zero Signs, or only Signs? Both must be no.
- Does the Turning land near the 60% mark? Before round 5 → raise the threshold.
- Is burying a Revenant ever worth two actions and a Scar? Never paid → make it
  one action.
- Does the Fevered flip read as interesting or as bookkeeping? Watch faces at the
  moment of the swap.
- Early elimination: deck-as-health is the riskiest mechanic. If people die at
  round 4, fatten the starting deck to 10 rather than reducing damage — hits
  should still hurt.

---

## 11. Tuning numbers (all currently guesses)

| Value | Current | Notes |
|---|---|---|
| Whisper threshold | 12 | Turning should land ~60% through |
| Vessel Clear | 12 | Endgame length |
| Doom target | 20 | Old One's win condition |
| Starting deck | 8 | Raise to 10 if early deaths |
| Hand size | 5 | |
| Actions/turn | 3 | Revenant 2, Husk 1 |
| Provision deck | 20, never reshuffled | Should dry up ~round 5 |
| Street slots | 3 | |
| Sign costs | 2–4 | Always better per coin than Provisions — the trap |
| Provision costs | 2–5 | |

Every one of these is replaceable by a measurement from the simulator.
