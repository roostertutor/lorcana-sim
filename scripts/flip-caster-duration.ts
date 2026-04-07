#!/usr/bin/env node
// Flip 12 cards from end_of_owner_next_turn → until_caster_next_turn.
// These were audited by text: cards saying "until the start of YOUR next turn"
// (caster-anchored) had been incorrectly using owner-anchored expiry.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const flips: Record<string, string[]> = {
  "002": [
    "dopey-always-playful",
    "you-can-fly",
    "four-dozen-eggs",
    "magic-broom-industrial-model",
    "mouse-armor",
  ],
  "003": [
    "kida-protector-of-atlantis",
    "patch-intimidating-pup",
    "ariel-adventurous-collector",
    "gizmosuit",
  ],
  "004": [
    "cogsworth-majordomo",
    "lost-in-the-woods",
    "dodge",
  ],
};

let total = 0;
for (const [setId, ids] of Object.entries(flips)) {
  const path = join("packages/engine/src/cards", `lorcast-set-${setId.padStart(3, "0")}.json`);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  for (const card of cards) {
    if (!ids.includes(card.id)) continue;
    const blob = JSON.stringify(card);
    if (!blob.includes("end_of_owner_next_turn")) continue;
    // Walk abilities + actionEffects, replace "end_of_owner_next_turn" → "until_caster_next_turn"
    function walk(node: any): any {
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === "object") {
        if (node.duration === "end_of_owner_next_turn") node.duration = "until_caster_next_turn";
        if (node.expiresAt === "end_of_owner_next_turn") node.expiresAt = "until_caster_next_turn";
        for (const k of Object.keys(node)) node[k] = walk(node[k]);
        return node;
      }
      return node;
    }
    walk(card.abilities);
    walk(card.actionEffects);
    total++;
    console.log(`  ✅ set ${setId}: ${card.id}`);
  }
  writeFileSync(path, JSON.stringify(cards, null, 2) + "\n");
}
console.log(`\nFlipped ${total} cards to until_caster_next_turn.`);
