// The words on a card, and the rules those words assume you know.
//
// Pure and JSX-free so the tests can reach them: every visible string on a card
// is generated here, and this is the code that has quietly lied twice already
// — once about a Threat's Clear value, once about an Omen's Menace.

import type { Card, Op, StreetSlot } from "../../engine/state";
import { opsFor } from "../../engine/effects";
import { GLOSSARY, keywordsIn } from "./glossaryData";

/** Rules text derived from the ops, so a card can never lie about itself. */
export function describeOps(ops: readonly Op[]): string {
  /**
   * Repeats are counted, not repeated.
   *
   * Cattle Baron's Men pays two `gainCard` ops and read "Take a Provision free
   * · Take a Provision free", which is longer, worse and easy to misread as one
   * reward described twice.
   */
  const out: string[] = [];
  for (const text of describeEach(ops)) {
    const last = out.length - 1;
    const bare = out[last]?.replace(/ ×\d+$/, "");
    if (bare === text) {
      const n = Number(out[last]!.match(/ ×(\d+)$/)?.[1] ?? 1) + 1;
      out[last] = `${text} ×${n}`;
    } else out.push(text);
  }
  return out.join(" · ");
}

function describeEach(ops: readonly Op[]): string[] {
  return ops
    .map((op) => {
      switch (op.op) {
        case "draw":
          return `Draw ${op.n}`;
        case "damage":
          return op.target === "vessel"
            ? `${op.n} damage to the Vessel`
            : op.target === "all"
              ? `${op.n} damage to every Threat`
              : `${op.n} damage to a Threat`;
        case "destroy":
          return "Destroy a Threat";
        case "callSign":
          return "Look at the top card of a player's deck; a Sign resolves "
            + "against them";
        case "summon":
          return "A Mythos card enters the Street";
        case "shutter":
          return "Name a card type; nobody may play it next round";
        case "gift":
          return "A player gains a Fevered Sign";
        case "banishOmen":
          return op.target === "all"
            ? "May instead destroy an Omen; every player takes a Scar"
            : "May instead destroy an Omen; you take a Scar";
        case "grit":
          return `+${op.n} Grit`;
        case "gritNextTurn":
          return `+${op.n} Grit next turn`;
        case "actions":
          return `+${op.n} actions`;
        case "whisper":
          return `+${op.n} Whisper`;
        case "trash":
          return op.target === "self"
            ? `Trash ${op.n} of your own`
            : `Everyone trashes ${op.n}`;
        case "scar":
        // Added with Tolls and never given words, so Choir of the Dry Grass
        // printed the literal string "scar" where its price should read.
        return `Take ${op.n} Scar${op.n === 1 ? "" : "s"}`;
      case "gainCard":
          return "Take a Provision free";
        case "recover":
          return "Recover a card";
        case "cancelMenace":
          return "Cancel a Threat's Menace";
        case "shield":
          return `Prevent ${op.n} damage`;
        case "discardHand":
          return "Discard your hand";
        case "revealHand":
          return "Reveal your hand";
        case "scry":
          return `Look at the next ${op.n} Threats`;
        default:
          return (op as { op: string }).op;
      }
    });
}

/**
 * What a button does, from the player's side of the table.
 *
 * "Spend" was wrong on the one command it mattered for. SPEND_GRIT does not
 * spend Grit — it turns the card INTO Grit, which is the only way to get any.
 * Reading it the natural way ("spend Grit on this card") had the trade running
 * backwards, so the label now names the direction and the yield: the card goes,
 * this much Grit arrives.
 */

/**
 * Everything a card actually does, as one block of rules text.
 *
 * A Threat has no `ops` — its whole behaviour is Clear, Menace and the third
 * line DESIGN.md §7 gives it: a Bounty in Act I, a Toll in Act II. That line
 * was never drawn anywhere, so nine Trouble cards sat in the Street paying a
 * reward nobody could see, and the two Tolls advertised no price.
 *
 * Joined rather than chosen between: no card carries both today, and if one
 * ever does, showing half of it is the worse failure.
 */
export function thirdLine(def: Card, fevered: boolean): string {
  return [
    describeOps(opsFor(def, fevered)),
    def.bounty?.length ? `Bounty: ${describeOps(def.bounty)}` : "",
    def.toll?.length ? `Toll: ${describeOps(def.toll)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Everything a card is asking you to already know.
 *
 * A card face is dense with marks — a coin, a cost tag, whisper pips, a Clear
 * value, a family glyph — and every one of them is a rule. The glossary has
 * always known what they mean; this is the one place that asks it on a player's
 * behalf, for the specific card in front of them, rather than making them go
 * and look each one up.
 */
export function cardKeywords(def: Card, fevered: boolean, slot?: StreetSlot): string[] {
  const keys: string[] = [];
  const add = (k: string) => { if (GLOSSARY[k] && !keys.includes(k)) keys.push(k); };

  // The marks actually drawn on this face, in the order they are read.
  if (def.cost !== undefined) add("cost");
  if (def.grit > 0) add("grit");
  if (def.whispers) add("whispers");
  if (def.type === "sign") add(fevered ? "fevered" : "signs");
  if (fevered) add("turning");
  if (def.type === "kit" || def.type === "deed") add("provisions");
  if (def.type === "scar") add("scars");
  if (def.type === "omen") add("omen");
  if (def.type === "trouble" || def.type === "mythos") add("threat");
  if (def.type === "vessel") add("vessel");
  if (def.clear !== undefined || slot) add("clear");
  if (def.menace || def.type === "omen") add("menace");
  if (def.bounty?.length) add("bounty");
  if (def.toll?.length) { add("toll"); add("scars"); }

  // And whatever its own words invoke.
  for (const text of [
    describeOps(opsFor(def, fevered)),
    def.fevered ? describeOps(opsFor(def, true)) : "",
    def.bounty ? describeOps(def.bounty) : "",
    def.toll ? describeOps(def.toll) : "",
  ]) {
    for (const k of keywordsIn(text)) add(k);
  }
  return keys;
}

