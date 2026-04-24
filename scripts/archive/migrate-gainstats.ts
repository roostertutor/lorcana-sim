#!/usr/bin/env node
// =============================================================================
// ONE-SHOT MIGRATION — 2026-04-24
// -----------------------------------------------------------------------------
// Removes 5 locked-per-flag GainStatsEffect shortcuts in favor of the existing
// `strengthDynamic: DynamicAmount` mechanism. Every flag is a dynamic amount
// override that's already expressible via DynamicAmount's own variants — the
// flags were added as per-case shortcuts that accumulated over sets.
//
//   strengthPerDamage: true                → strengthDynamic: {type: "target_damage"}
//   strengthPerCardInHand: true            → strengthDynamic: {type: "count",
//                                             filter: {owner:{type:"self"}, zone:"hand"}}
//   strengthEqualsSourceStrength: true     → strengthDynamic: {type: "source_strength"}
//   strengthEqualsSourceWillpower: true    → strengthDynamic: {type: "source_willpower"}
//   strengthEqualsTargetWillpower: true    → strengthDynamic: {type: "target_willpower"}
//
// Runs in-place over every card-set-*.json. Idempotent — cards that already
// use strengthDynamic (without any of the 5 flags) are untouched.
//
// Usage:
//   pnpm migrate-gainstats              # live
//   pnpm migrate-gainstats --dry-run    # count only
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

type Json = Record<string, any>;

/** Migrate a single gain_stats effect-shaped object. Returns true if anything changed. */
function migrateGainStats(obj: Json): boolean {
  if (!obj || typeof obj !== "object" || obj.type !== "gain_stats") return false;
  let changed = false;

  const migrateFlag = (flag: string, dynamic: any): void => {
    if (obj[flag] === true) {
      // If strengthDynamic is already set to something else, DO NOT overwrite
      // — this situation shouldn't arise in practice (flags were mutually
      // exclusive) but a hand-wiring mistake would surface as a migration
      // warning rather than silent data loss.
      if (obj.strengthDynamic !== undefined && JSON.stringify(obj.strengthDynamic) !== JSON.stringify(dynamic)) {
        console.error(`  [warn] existing strengthDynamic on gain_stats with ${flag}: true — not overwriting`);
        return;
      }
      obj.strengthDynamic = dynamic;
      delete obj[flag];
      changed = true;
    }
  };

  migrateFlag("strengthPerDamage", { type: "target_damage" });
  migrateFlag("strengthPerCardInHand", {
    type: "count",
    filter: { owner: { type: "self" }, zone: "hand" },
  });
  migrateFlag("strengthEqualsSourceStrength", { type: "source_strength" });
  migrateFlag("strengthEqualsSourceWillpower", { type: "source_willpower" });
  migrateFlag("strengthEqualsTargetWillpower", { type: "target_willpower" });

  return changed;
}

/** Walk an arbitrary JSON structure calling migrateGainStats on every object node. */
function walk(node: any): number {
  if (!node || typeof node !== "object") return 0;
  let count = 0;
  if (Array.isArray(node)) {
    for (const item of node) count += walk(item);
    return count;
  }
  if (migrateGainStats(node)) count++;
  for (const key of Object.keys(node)) count += walk(node[key]);
  return count;
}

function main(): void {
  const files = readdirSync(CARDS_DIR).filter(f => f.startsWith("card-set-") && f.endsWith(".json"));
  let totalEffects = 0;
  let totalFiles = 0;
  for (const f of files) {
    const path = join(CARDS_DIR, f);
    const cards = JSON.parse(readFileSync(path, "utf-8"));
    const migrated = walk(cards);
    if (migrated > 0) {
      console.log(`  ${f.padEnd(28)} ${migrated} gain_stats effect(s) migrated`);
      totalEffects += migrated;
      totalFiles++;
      if (!dryRun) writeFileSync(path, JSON.stringify(cards, null, 2), "utf-8");
    }
  }
  console.log("─".repeat(60));
  console.log(`  ${totalEffects} effect(s) across ${totalFiles} file(s) ${dryRun ? "would be" : "were"} migrated.`);
  if (dryRun) console.log("  (dry run — no files written)");
}

main();
