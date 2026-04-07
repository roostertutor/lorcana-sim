#!/usr/bin/env node
// Set 4 — Batch 11: Flotsam & Jetsam dual-name (CRD §10.6).
//
// Flotsam & Jetsam - Entangling Eels has the reminder text
//   "(This character counts as being named both Flotsam and Jetsam.)"
// We add `alternateNames` to the CardDefinition (engine type) and the
// hasName filter in utils/index.ts now consults that array, so abilities
// like Ursula's Cauldron's "your characters named Flotsam/Jetsam" target
// this card. CardDefinition.alternateNames is also recognized by the
// card-status categorizer as satisfying the only "named ability" of
// pure-dual-name cards.
//
// Skipped (too complex for this session — would need new engine support):
//   - Bruno Madrigal Out of the Shadows / Medallion Weights
//       → grant_floating_ability (timed triggered-ability grant)
//   - Noi Acrobatic Baby
//       → floating challenge_damage_immunity (timed self-static)
//   - Sign the Scroll / Ursula's Trickery
//       → inverse-sequential discard ("for each opponent who doesn't")
//   - Hades Double Dealer, Tuk Tuk Lively Partner, Atlantica Concert Hall,
//     Isabela Madrigal Golden Child, Ariel Sonic Warrior x2,
//     Prince Phillip Gallant Defender (chosen_for_support trigger)
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const patches: Record<string, any> = {
  "flotsam-jetsam-entangling-eels": {
    alternateNames: ["Flotsam", "Jetsam"],
  },
};

const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
for (const card of cards) {
  if (patches[card.id]) {
    Object.assign(card, patches[card.id]);
    patched++;
    console.log(`  OK ${card.id}`);
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries in set 4.`);
