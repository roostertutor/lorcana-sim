#!/usr/bin/env node
// Wire the last few genuinely-wireable fits-grammar stragglers.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SELF = { type: "self" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };

const set8Patches: Record<string, any> = {
  // Faline - Playful Fawn: While you have a character with more {S} than each
  // opposing character, this character gets +2 {L}.
  "faline-playful-fawn": {
    abilities: [{
      type: "static",
      storyName: "STAND OUT",
      rulesText: "While you have a character in play with more {S} than each opposing character, this character gets +2 {L}.",
      effect: {
        type: "gain_stats",
        lore: 2,
        target: { type: "this" },
        condition: { type: "self_has_more_than_each_opponent", metric: "strength_in_play" },
      },
    }],
  },
};

const set11Patches: Record<string, any> = {
  // Grandmother Willow - Ancient Advisor: SMOOTH THE WAY — Once during your turn,
  // you pay 1 {I} less for the next character you play this turn.
  // Modeled as an oncePerTurn activated ability with no cost that grants the discount.
  "grandmother-willow-ancient-advisor": {
    abilities: [{
      type: "activated",
      storyName: "SMOOTH THE WAY",
      rulesText: "Once during your turn, you pay 1 {I} less for the next character you play this turn.",
      costs: [],
      oncePerTurn: true,
      effects: [{
        type: "grant_cost_reduction",
        amount: 1,
        filter: { cardType: ["character"] },
      }],
    }],
  },
};

function applyTo(setFile: string, patches: Record<string, any>) {
  const fp = join(__dirname, `../packages/engine/src/cards/lorcast-set-${setFile}.json`);
  const cards = JSON.parse(readFileSync(fp, "utf-8"));
  let n = 0;
  for (const card of cards) {
    if (patches[card.id]) {
      const patch = patches[card.id];
      if (patch.abilities) {
        const existingKeywords = (card.abilities || []).filter((a: any) => a.type === "keyword");
        card.abilities = [...existingKeywords, ...patch.abilities];
      }
      if (patch.actionEffects) card.actionEffects = patch.actionEffects;
      n++;
      console.log(`  OK [${setFile}] ${card.id}`);
    }
  }
  writeFileSync(fp, JSON.stringify(cards, null, 2) + "\n", "utf-8");
  return n;
}

let total = 0;
total += applyTo("008", set8Patches);
total += applyTo("011", set11Patches);
console.log(`\nPatched ${total} card entries.`);
