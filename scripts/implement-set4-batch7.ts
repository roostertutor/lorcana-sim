#!/usr/bin/env node
// Set 4 — Batch 7: opponent-chosen target cards (chooser: "target_player").
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ALL_OWN_CHARS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {

  // Ursula's Plan — each opponent chooses+exerts one of their characters,
  // those characters can't ready at the start of their next turn.
  "ursula-s-plan": {
    actionEffects: [
      {
        type: "exert",
        target: {
          type: "chosen",
          chooser: "target_player",
          // From the chooser's perspective, "self" means their own characters
          filter: { ...ALL_OWN_CHARS },
        },
        followUpEffects: [
          {
            type: "cant_action",
            action: "ready",
            target: { type: "this" },
            duration: "end_of_owner_next_turn",
          },
        ],
      },
    ],
  },

  // Be King Undisputed — each opponent chooses+banishes one of their characters
  "be-king-undisputed": {
    actionEffects: [
      {
        type: "banish",
        target: {
          type: "chosen",
          chooser: "target_player",
          filter: { ...ALL_OWN_CHARS },
        },
      },
    ],
  },

  // Triton's Decree — each opponent chooses one of their characters and deals 2 damage to it
  "tritons-decree": {
    actionEffects: [
      {
        type: "deal_damage",
        amount: 2,
        target: {
          type: "chosen",
          chooser: "target_player",
          filter: { ...ALL_OWN_CHARS },
        },
      },
    ],
  },

  // Gunther Interior Designer — when banished in challenge, each opponent chooses
  // and returns one of their characters to their hand
  "gunther-interior-designer": {
    abilities: [
      {
        type: "triggered",
        storyName: "SAD-EYED PUPPY",
        rulesText: "When this character is challenged and banished, each opponent chooses one of their characters and returns that card to their hand.",
        trigger: { on: "banished_in_challenge" },
        effects: [
          {
            type: "return_to_hand",
            target: {
              type: "chosen",
              chooser: "target_player",
              filter: { ...ALL_OWN_CHARS },
            },
          },
        ],
      },
    ],
  },
};

// ─── Apply ────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
for (const card of cards) {
  if (patches[card.id]) {
    const patch = patches[card.id];
    if (patch.abilities) card.abilities = patch.abilities;
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    patched++;
    console.log(`  ✅ ${card.id}`);
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} cards in set 4.`);
