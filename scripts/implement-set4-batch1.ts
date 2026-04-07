#!/usr/bin/env node
// Set 4 — Batch 1: simple fits-grammar cards (actions, items, vanilla enters_play triggers).
// Cards that need engine extensions (gain_stats end_of_owner_next_turn, compound_or condition, etc.)
// are deferred to a later batch.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const patches: Record<string, any> = {
  // ─── Actions ───────────────────────────────────────────────

  "first-aid": {
    actionEffects: [
      {
        type: "remove_damage",
        amount: 1,
        isUpTo: true,
        target: {
          type: "all",
          filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] },
        },
      },
    ],
  },

  "brunos-return": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: {
          type: "chosen",
          filter: { zone: "discard", cardType: ["character"], owner: { type: "self" } },
        },
      },
      {
        type: "remove_damage",
        amount: 2,
        isUpTo: true,
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"] },
        },
      },
    ],
  },

  "brawl": {
    actionEffects: [
      {
        type: "banish",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"], strengthAtMost: 2 },
        },
      },
    ],
  },

  "glean": {
    actionEffects: [
      {
        type: "banish",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["item"] },
        },
      },
      {
        // "Its player gains 2 lore" — last targeted item's owner
        type: "gain_lore",
        amount: 2,
        target: { type: "target_owner" },
      },
    ],
  },

  "seldom-all-they-seem": {
    actionEffects: [
      {
        type: "gain_stats",
        strength: -3,
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"] },
        },
        duration: "this_turn",
      },
    ],
  },

  "swing-into-action": {
    actionEffects: [
      {
        type: "grant_keyword",
        keyword: "rush",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"] },
        },
        duration: "end_of_turn",
      },
    ],
  },

  "dodge": {
    actionEffects: [
      {
        type: "grant_keyword",
        keyword: "ward",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"] },
        },
        duration: "end_of_owner_next_turn",
        followUpEffects: [
          {
            type: "grant_keyword",
            keyword: "evasive",
            target: { type: "this" },
            duration: "end_of_owner_next_turn",
          },
        ],
      },
    ],
  },

  "i-find-em-i-flatten-em": {
    actionEffects: [
      {
        type: "banish",
        target: {
          type: "all",
          filter: { zone: "play", cardType: ["item"] },
        },
      },
    ],
  },

  // ─── Triggered abilities (enters_play / quests) ────────────

  "daisy-duck-musketeer-spy": {
    abilities: [
      {
        type: "triggered",
        storyName: "INFILTRATION",
        rulesText: "When you play this character, each opponent chooses and discards a card.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "discard_from_hand",
            amount: 1,
            target: { type: "opponent" },
            chooser: "target_player",
          },
        ],
      },
    ],
  },

  "pluto-rescue-dog": {
    abilities: [
      {
        type: "triggered",
        storyName: "TO THE RESCUE",
        rulesText: "When you play this character, you may remove up to 3 damage from one of your characters.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "remove_damage",
            amount: 3,
            isUpTo: true,
            isMay: true,
            target: {
              type: "chosen",
              filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] },
            },
          },
        ],
      },
    ],
  },

  "marshmallow-terrifying-snowman": {
    abilities: [
      {
        type: "static",
        storyName: "BEHEMOTH",
        rulesText: "This character gets +1 {S} for each card in your hand.",
        effect: {
          type: "modify_stat_per_count",
          stat: "strength",
          amountPer: 1,
          target: { type: "this" },
          countFilter: { owner: { type: "self" }, zone: "hand" },
        },
      },
    ],
  },

  "yen-sid-powerful-sorcerer": {
    abilities: [
      {
        type: "triggered",
        storyName: "TIMELY INTERVENTION",
        rulesText: "When you play this character, if you have a character named Magic Broom in play, you may draw a card.",
        trigger: { on: "enters_play" },
        condition: { type: "has_character_named", name: "Magic Broom", player: { type: "self" } },
        effects: [
          { type: "draw", amount: 1, isMay: true, target: { type: "self" } },
        ],
      },
      {
        type: "static",
        storyName: "ARCANE STUDY",
        rulesText: "While you have 2 or more Broom characters in play, this character gets +2 {L}.",
        condition: { type: "has_character_with_trait", trait: "Broom", player: { type: "self" }, excludeSelf: true },
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: 2,
          target: { type: "this" },
        },
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
