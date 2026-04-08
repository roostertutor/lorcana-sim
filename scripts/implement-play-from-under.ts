#!/usr/bin/env node
// =============================================================================
// PLAY-FROM-UNDER batch — wires The Black Cauldron RISE AND JOIN ME!
//
// Engine support: `play_for_free` Effect now accepts `cost: "normal"` (paid
// play) and `sourceInstanceId: "self"` so the candidate pool is the source
// item's per-instance `cardsUnder` pile rather than a player-wide zone.
//
// Note: THE CAULDRON CALLS ("put a character card from your discard under
// this item faceup") is a separate, unimplemented effect (no
// put_card_from_discard_under_self primitive yet) and is left as a stub.
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const SET_FILE = "lorcast-set-010.json";
const path = join(CARDS_DIR, SET_FILE);
const cards = JSON.parse(readFileSync(path, "utf-8"));

const cauldronAbilities = [
  {
    type: "activated",
    storyName: "RISE AND JOIN ME!",
    rulesText:
      "{E}, 1 {I} — This turn, you may play characters from under this item.",
    costs: [{ type: "exert" }, { type: "pay_ink", amount: 1 }],
    // Approximation: instead of granting a turn-long permission, the activation
    // surfaces an immediate paid play-from-under choice. Practical equivalent
    // for analytics; one play per activation, isMay so the player can decline.
    effects: [
      {
        type: "play_for_free",
        sourceZone: "under",
        sourceInstanceId: "self",
        cost: "normal",
        filter: { cardType: ["character"] },
        isMay: true,
      },
    ],
  },
];

let patched = 0;
for (const card of cards) {
  if (card.id !== "the-black-cauldron") continue;
  card.abilities = cauldronAbilities;
  patched++;
}

writeFileSync(path, JSON.stringify(cards, null, 2));
console.log(`Patched ${patched} The Black Cauldron printings in ${SET_FILE}`);
