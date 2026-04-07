#!/usr/bin/env node
// Set 4 — Batch 6: cards using the new engine features added in Phase A.4
// (move_damage, grant_cost_reduction, strengthPerCardInHand, strengthEqualsSourceStrength).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const ALL_OWN_CHARS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {

  // ─── move_damage ────────────────────────────────────────────────────────
  // Belle Untrained Mystic — HERE NOW, DON'T DO THAT
  "belle-untrained-mystic": {
    abilities: [
      {
        type: "triggered",
        storyName: "HERE NOW, DON'T DO THAT",
        rulesText: "When you play this character, move up to 1 damage counter from chosen character to chosen opposing character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "move_damage",
            amount: 1,
            isUpTo: true,
            source: { type: "chosen", filter: { ...ANY_CHAR } },
            destination: { type: "chosen", filter: { ...ALL_OPP_CHARS } },
          },
        ],
      },
    ],
  },

  // Rose Lantern — MYSTICAL PETALS
  "rose-lantern": {
    abilities: [
      {
        type: "activated",
        storyName: "MYSTICAL PETALS",
        rulesText: "{E} — Move 1 damage counter from chosen character to chosen opposing character.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "move_damage",
            amount: 1,
            source: { type: "chosen", filter: { ...ANY_CHAR } },
            destination: { type: "chosen", filter: { ...ALL_OPP_CHARS } },
          },
        ],
      },
    ],
  },

  // ─── grant_cost_reduction ──────────────────────────────────────────────
  // Gaston Despicable Dealer — DUBIOUS RECRUITMENT
  "gaston-despicable-dealer": {
    abilities: [
      {
        type: "triggered",
        storyName: "DUBIOUS RECRUITMENT",
        rulesText: "When you play this character, you pay 2 {I} less for the next character you play this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "grant_cost_reduction",
            amount: 2,
            filter: { cardType: ["character"] },
          },
        ],
      },
    ],
  },

  // Imperial Proclamation — CALL TO THE FRONT (own character challenges → cost reduction)
  "imperial-proclamation": {
    abilities: [
      {
        type: "triggered",
        storyName: "CALL TO THE FRONT",
        rulesText: "Whenever one of your characters challenges another character, you pay 1 {I} less for the next character you play this turn.",
        trigger: {
          on: "challenges",
          filter: { ...ALL_OWN_CHARS },
        },
        effects: [
          {
            type: "grant_cost_reduction",
            amount: 1,
            filter: { cardType: ["character"] },
          },
        ],
      },
    ],
  },

  // ─── strengthPerCardInHand ──────────────────────────────────────────────
  // Triton's Trident — SYMBOL OF POWER (banish self item, +1 strength per card in hand to chosen)
  "tritons-trident": {
    abilities: [
      {
        type: "activated",
        storyName: "SYMBOL OF POWER",
        rulesText: "Banish this item — Chosen character gets +1 {S} this turn for each card in your hand.",
        costs: [{ type: "banish_self" }],
        effects: [
          {
            type: "gain_stats",
            strengthPerCardInHand: true,
            target: { type: "chosen", filter: { ...ANY_CHAR } },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // ─── strengthEqualsSourceStrength ──────────────────────────────────────
  // Olaf Carrot Enthusiast — CARROTS ALL AROUND!
  "olaf-carrot-enthusiast": {
    abilities: [
      {
        type: "triggered",
        storyName: "CARROTS ALL AROUND!",
        rulesText: "Whenever he quests, each of your other characters gets +{S} equal to this character's {S} this turn.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "gain_stats",
            strengthEqualsSourceStrength: true,
            target: { type: "all", filter: { ...ALL_OWN_CHARS, excludeSelf: true } },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // ─── Triton Discerning King — banish chosen own item as leading effect ──
  "triton-discerning-king": {
    abilities: [
      {
        type: "activated",
        storyName: "CONSIGN TO THE DEPTHS",
        rulesText: "{E}, Banish one of your items — Gain 3 lore.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "banish",
            target: {
              type: "chosen",
              filter: { owner: { type: "self" }, zone: "play", cardType: ["item"] },
            },
          },
          { type: "gain_lore", amount: 3, target: { type: "self" } },
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
