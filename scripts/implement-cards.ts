#!/usr/bin/env node
// =============================================================================
// IMPLEMENT CARDS — Patches card JSON with ability definitions
// Run once per batch, then verify with tests.
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

function patchSet(setCode: string, patches: Record<string, any>) {
  const padded = setCode.padStart(3, "0");
  const path = join(CARDS_DIR, `lorcast-set-${padded}.json`);
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
  console.log(`Patched ${patched} cards in set ${setCode}\n`);
}

// =============================================================================
// SET 2 — Batch 1: Simple, unambiguous cards
// =============================================================================

patchSet("2", {
  // SLEEPY - NODDING OFF: "This character enters play exerted."
  // Triggered: enters_play → exert self (no choice, always happens)
  "sleepy-nodding-off": {
    abilities: [
      {
        type: "triggered",
        storyName: "YAWN!",
        rulesText: "This character enters play exerted.",
        trigger: { on: "enters_play" },
        effects: [{ type: "exert", target: { type: "this" } }],
      },
    ],
  },

  // HOLD STILL: Action — "Remove up to 4 damage from chosen character."
  "hold-still": {
    actionEffects: [
      {
        type: "remove_damage",
        amount: 4,
        target: { type: "chosen", filter: { zone: "play", hasDamage: true } },
        isUpTo: true,
      },
    ],
  },

  // PAWPSICLE: "When you play this item, you may draw a card."
  // (Second ability "THAT'S REDWOOD Banish this item — Remove up to 2 damage"
  //  is in rulesText but was not captured as a stub by the import script.
  //  Implementing what we have; the activated ability can be added later.)
  "pawpsicle": {
    abilities: [
      {
        type: "triggered",
        storyName: "JUMBO POP",
        rulesText: "When you play this item, you may draw a card.",
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
      },
    ],
  },

  // THE SORCERER'S SPELLBOOK: "{E}, 1 {I} — Gain 1 lore."
  "the-sorcerers-spellbook": {
    abilities: [
      {
        type: "activated",
        storyName: "KNOWLEDGE",
        rulesText: "Gain 1 lore.",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 1 }],
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // ROBIN HOOD - CAPABLE FIGHTER: "{E} — Deal 1 damage to chosen character."
  "robin-hood-capable-fighter": {
    abilities: [
      {
        type: "activated",
        storyName: "SKIRMISH",
        rulesText: "Deal 1 damage to chosen character.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "deal_damage",
            amount: 1,
            target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
          },
        ],
      },
    ],
  },

  // BEAST - FORBIDDING RECLUSE: "When you play this character, you may deal 1 damage to chosen character."
  "beast-forbidding-recluse": {
    abilities: [
      {
        type: "triggered",
        storyName: "YOU'RE NOT WELCOME HERE",
        rulesText: "When you play this character, you may deal 1 damage to chosen character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "deal_damage",
            amount: 1,
            target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
            isMay: true,
          },
        ],
      },
    ],
  },

  // KUZCO - WANTED LLAMA: "When this character is banished, you may draw a card."
  "kuzco-wanted-llama": {
    abilities: [
      {
        type: "triggered",
        storyName: "OK, WHERE AM I?",
        rulesText: "When this character is banished, you may draw a card.",
        trigger: { on: "is_banished" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
      },
    ],
  },

  // JASMINE - HEIR OF AGRABAH: "When you play this character, remove up to 1 damage from chosen character of yours."
  "jasmine-heir-of-agrabah": {
    abilities: [
      {
        type: "triggered",
        storyName: "I'M A FAST LEARNER",
        rulesText: "When you play this character, remove up to 1 damage from chosen character of yours.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "remove_damage",
            amount: 1,
            target: {
              type: "chosen",
              filter: { zone: "play", owner: { type: "self" }, hasDamage: true },
            },
            isUpTo: true,
          },
        ],
      },
    ],
  },

  // RAPUNZEL - SUNSHINE: "{E} — Remove up to 2 damage from chosen character."
  "rapunzel-sunshine": {
    abilities: [
      {
        type: "activated",
        storyName: "MAGIC HAIR",
        rulesText: "Remove up to 2 damage from chosen character.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "remove_damage",
            amount: 2,
            target: { type: "chosen", filter: { zone: "play", hasDamage: true } },
            isUpTo: true,
          },
        ],
      },
    ],
  },

  // SNOW WHITE - LOST IN THE FOREST: "When you play this character, you may remove up to 2 damage from chosen character."
  "snow-white-lost-in-the-forest": {
    abilities: [
      {
        type: "triggered",
        storyName: "I WON'T HURT YOU",
        rulesText: "When you play this character, you may remove up to 2 damage from chosen character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "remove_damage",
            amount: 2,
            target: { type: "chosen", filter: { zone: "play", hasDamage: true } },
            isUpTo: true,
            isMay: true,
          },
        ],
      },
    ],
  },
});
