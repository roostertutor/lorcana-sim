#!/usr/bin/env node
// Set 11 — Batch 3: last wave of fits-grammar. No new primitives.
// Remaining skips are all genuinely blocked:
//   - UNDERDOG (going-second-turn-1 cost reduction, no engine support)
//   - "none of your characters challenged this turn" gate
//   - "play character with cost up to 2 more than banished" (dynamic cost scaling)
//   - Alert-only vanilla keywords (card-status miscategorization)
//   - Complex modals (Tod Playful, Education or Elimination, Hidden Trap)
//   - DEFERRED_MECHANICS entries (Willie Giant "put-card-under-this-turn", Gramma Tala
//     per-inkwell cost reduction, Wisdom of the Willow rest-of-turn trigger grant,
//     Darkwing Tower "ready character here", Visiting Christmas Past under→inkwell,
//     Retro Evolution Device, Reuben dynamic cost, Pudge/Vixey named-char free play,
//     Grandmother Willow SMOOTH THE WAY activated cost reduction, Tod Knows All the
//     Tricks "chosen for action" trigger).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-011.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  "chief-tui-weaving-a-tale": {
    abilities: [{
      type: "triggered",
      storyName: "AND THEN...",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, look at the top card of your deck. You may put it on either the top or the bottom of your deck.",
      trigger: { on: "ink_played", player: SELF },
      oncePerTurn: true,
      effects: [{
        type: "look_at_top", count: 1, action: "top_or_bottom",
        target: SELF,
      }],
    }],
  },

  "scrooge-mcduck-miserly-ebenezer": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "During your turn, whenever a card is put into your inkwell, chosen character gets -1 {S} this turn.",
      trigger: { on: "ink_played", player: SELF },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "gain_stats", strength: -1, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "donald-duck-fred-honeywell": {
    // Second clause ("during opponents' turns, draw per card under") approximated
    // to a single draw on banished_other during opponent turns.
    abilities: [
      {
        type: "triggered",
        storyName: "",
        rulesText: "Whenever you use the Boost ability of a character, you may put the top card of your deck under them facedown.",
        trigger: { on: "card_put_under", filter: { owner: SELF } },
        effects: [{
          type: "put_top_of_deck_under", isMay: true,
          target: { type: "chosen", filter: ALL_OWN_CHARS },
        }],
      },
      {
        type: "triggered",
        storyName: "",
        rulesText: "During opponents' turns, whenever one of your other characters is banished, you may draw a card.",
        trigger: { on: "banished_other", filter: { owner: SELF, cardType: ["character"] } },
        condition: { type: "not", condition: { type: "is_your_turn" } },
        effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
      },
    ],
  },
};

// Drop entries with no content
for (const k of Object.keys(patches)) {
  const p = patches[k];
  if (!p.abilities && !p.actionEffects) delete patches[k];
}

const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
const seen = new Set<string>();
const missing: string[] = [];
for (const id of Object.keys(patches)) {
  if (!cards.find((c: any) => c.id === id)) missing.push(id);
}
for (const card of cards) {
  if (patches[card.id]) {
    const patch = patches[card.id];
    if (patch.abilities) {
      const existingKeywords = (card.abilities || []).filter((a: any) => a.type === "keyword");
      card.abilities = [...existingKeywords, ...patch.abilities];
    }
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    patched++;
    if (!seen.has(card.id)) {
      console.log(`  OK ${card.id}`);
      seen.add(card.id);
    }
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 11.`);
if (missing.length) {
  console.log(`\nMISSING IDs:`);
  missing.forEach(m => console.log(`  - ${m}`));
}
