#!/usr/bin/env node
// Wire Mystical Tree (start-of-turn move damage with at_location filter).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };

const set6Patches: Record<string, any> = {
  "mystical-tree-mama-odies-home": {
    abilities: [
      {
        type: "triggered",
        storyName: "NOT BAD",
        rulesText: "At the start of your turn, you may move 1 damage counter from chosen character here to chosen opposing character.",
        trigger: { on: "turn_start", player: SELF },
        effects: [{
          type: "move_damage",
          amount: 1,
          isMay: true,
          source: { type: "chosen", filter: { ...ANY_CHAR, atLocation: "this" } },
          destination: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      },
      {
        type: "triggered",
        storyName: "HARD-EARNED WISDOM",
        rulesText: "At the start of your turn, if you have a character named Mama Odie here, gain 1 lore.",
        trigger: { on: "turn_start", player: SELF },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Mama Odie", atLocation: "this" },
        },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
    ],
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
      n++;
      console.log(`  OK [${setFile}] ${card.id}`);
    }
  }
  writeFileSync(fp, JSON.stringify(cards, null, 2) + "\n", "utf-8");
  return n;
}

let total = 0;
total += applyTo("006", set6Patches);
console.log(`\nPatched ${total} card entries.`);
