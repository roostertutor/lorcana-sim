#!/usr/bin/env node
/**
 * One-off fix (2026-04-22): rewrite `static.effect.type: "gain_stats"` misuse
 * to the correct `modify_stat` shape.
 *
 * Why: `gain_stats` is an Effect type, used in triggered/activated ability
 * effect arrays. As a STATIC ability's root `effect`, it has no handler in
 * `gameModifiers.ts` — every one of the 47 cards matching this pattern
 * silently no-ops. `modify_stat` is the correct StaticEffect type (Static
 * union in types/index.ts).
 *
 * Transform:
 *   { type: "gain_stats", strength: N, target: ..., ...rest }
 *   → { type: "modify_stat", stat: "strength", amount: N, target: ..., ...rest }
 * Same for lore / willpower.
 *
 * Run: pnpm tsx scripts/fix-static-gain-stats.ts
 * Idempotent — safe to re-run.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

let cardsFixed = 0;
let abilitiesFixed = 0;

function buildModifyStat(stat: "strength" | "willpower" | "lore", amount: number, target: any): any {
  return { type: "modify_stat", stat, amount, target };
}

function walkCard(card: any): boolean {
  let changed = false;
  const newAbilities: any[] = [];
  for (const ab of card.abilities ?? []) {
    if (ab?.type === "static" && ab.effect?.type === "gain_stats") {
      const eff = ab.effect;
      const statsPresent = (["strength", "willpower", "lore"] as const).filter(
        (k) => typeof eff[k] === "number"
      );
      if (statsPresent.length === 0) {
        newAbilities.push(ab);
        continue;
      }
      // Emit one static ability per stat. Duplicate storyName, rulesText,
      // condition, isMay. This is how historical multi-stat statics are
      // structured in the codebase.
      for (const stat of statsPresent) {
        const split = { ...ab };
        split.effect = buildModifyStat(stat, eff[stat], eff.target);
        newAbilities.push(split);
      }
      changed = true;
      abilitiesFixed += statsPresent.length;
    } else {
      newAbilities.push(ab);
    }
  }
  if (changed) card.abilities = newAbilities;
  return changed;
}

const setFiles = readdirSync(CARDS_DIR)
  .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
  .sort();

for (const filename of setFiles) {
  const path = join(CARDS_DIR, filename);
  const raw = readFileSync(path, "utf-8");
  const cards = JSON.parse(raw);
  let fileChanged = false;
  for (const card of cards) {
    if (walkCard(card)) {
      fileChanged = true;
      cardsFixed++;
    }
  }
  if (fileChanged) {
    writeFileSync(path, JSON.stringify(cards, null, 2));
    console.log(`✓ ${filename} (${cardsFixed} cards, ${abilitiesFixed} abilities so far)`);
  }
}

console.log(`\nDone. Fixed ${abilitiesFixed} static abilities on ${cardsFixed} cards.`);
