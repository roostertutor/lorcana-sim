#!/usr/bin/env node
// =============================================================================
// One-time migration: populate CardDefinition.maxCopies on cards that carry a
// DeckRuleStatic ability. Mirrors the deriveMaxCopies logic in
// scripts/import-cards-rav.ts so the two stay in sync — any divergence would
// show up as a re-import diff.
//
// Current hits (sets 6/7/8):
//   - Microbots           "any number"      → 99
//   - Dalmatian Puppy     "up to 99 copies" → 99
//   - Glass Slipper (x2)  "only have 2"     → 2
// =============================================================================

import { writeFileSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "..", "packages/engine/src/cards");

type DeckRuleAbility = { type?: string; effect?: { type?: string; rule?: string } };
type Card = {
  id: string;
  fullName: string;
  abilities?: unknown[];
  maxCopies?: number;
  [k: string]: unknown;
};

function deriveMaxCopies(card: Card): number | undefined {
  for (const ab of (card.abilities ?? []) as DeckRuleAbility[]) {
    if (ab?.effect?.type !== "deck_rule") continue;
    const rule = ab.effect.rule ?? "";
    if (/any number/i.test(rule)) return 99;
    const up = rule.match(/up to (\d+) copies/i);
    if (up) return parseInt(up[1]!, 10);
    const only = rule.match(/only have (\d+) copies/i);
    if (only) return parseInt(only[1]!, 10);
  }
  return undefined;
}

function run() {
  const files = readdirSync(CARDS_DIR)
    .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
    .sort();

  let totalChanged = 0;

  for (const file of files) {
    const path = join(CARDS_DIR, file);
    const cards = JSON.parse(readFileSync(path, "utf-8")) as Card[];
    let changed = 0;

    for (const card of cards) {
      const derived = deriveMaxCopies(card);
      if (derived !== undefined && card.maxCopies !== derived) {
        card.maxCopies = derived;
        changed++;
        console.log(`  ${file.padEnd(20)} ${card.fullName.padEnd(45)} maxCopies=${derived}`);
      }
    }

    if (changed > 0) {
      writeFileSync(path, JSON.stringify(cards, null, 2), "utf-8");
      totalChanged += changed;
    }
  }

  console.log(`\nMigrated ${totalChanged} card(s).`);
}

run();
