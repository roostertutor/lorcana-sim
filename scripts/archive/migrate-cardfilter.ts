#!/usr/bin/env node
// =============================================================================
// ONE-SHOT MIGRATION — 2026-04-24
// -----------------------------------------------------------------------------
// Collapses all legacy CardFilter numeric fields into the unified
// `statComparisons: StatComparison[]` array introduced in the same PR.
//
// Legacy fields (9 total) → new `statComparisons` entries:
//   costAtMost: N                              → {stat:"cost",      op:"lte", value: N}
//   costAtLeast: N                             → {stat:"cost",      op:"gte", value: N}
//   strengthAtMost: N                          → {stat:"strength",  op:"lte", value: N}
//   strengthAtLeast: N                         → {stat:"strength",  op:"gte", value: N}
//   willpowerAtMost: N                         → {stat:"willpower", op:"lte", value: N}
//   willpowerAtLeast: N                        → {stat:"willpower", op:"gte", value: N}
//   costAtMostFromLastResolvedSourcePlus: N    → {stat:"cost", op:"lte",
//                                                 value:{from:"last_resolved_source", offset:N}}
//   costAtMostFromSourceStrength: true         → {stat:"cost", op:"lte",
//                                                 value:{from:"source", property:"strength"}}
//   strengthAtMostFromBanishedSource: true     → {stat:"strength", op:"lte",
//                                                 value:{from:"last_banished_source"}}
//
// Runs in-place over every card-set-*.json under packages/engine/src/cards/.
// Preserves every other field; only the numeric fields listed above are
// rewritten into a statComparisons array. Idempotent — a card that already
// has statComparisons and no legacy fields is a no-op.
//
// Usage:
//   pnpm migrate-cardfilter           # live — writes JSON in place
//   pnpm migrate-cardfilter --dry-run # prints the diff count only
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

type Json = Record<string, any>;

type StatComparison = {
  stat: "cost" | "strength" | "willpower" | "lore" | "damage";
  op: "lte" | "gte" | "lt" | "gt" | "eq";
  value: number | { from: string; property?: string; offset?: number };
};

/** Returns true if any legacy numeric field or `statComparisons` exists on the object. */
function hasNumericFilter(obj: Json): boolean {
  return obj &&
    (obj.costAtMost !== undefined || obj.costAtLeast !== undefined ||
     obj.strengthAtMost !== undefined || obj.strengthAtLeast !== undefined ||
     obj.willpowerAtMost !== undefined || obj.willpowerAtLeast !== undefined ||
     obj.costAtMostFromLastResolvedSourcePlus !== undefined ||
     obj.costAtMostFromSourceStrength !== undefined ||
     obj.strengthAtMostFromBanishedSource !== undefined ||
     Array.isArray(obj.statComparisons));
}

/** Migrate a single filter-shaped object. Mutates in place. Returns true if
 *  anything changed. */
function migrateFilter(obj: Json): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (!hasNumericFilter(obj)) return false;
  const out: StatComparison[] = Array.isArray(obj.statComparisons) ? [...obj.statComparisons] : [];
  let changed = false;

  if (typeof obj.costAtMost === "number") {
    out.push({ stat: "cost", op: "lte", value: obj.costAtMost });
    delete obj.costAtMost;
    changed = true;
  }
  if (typeof obj.costAtLeast === "number") {
    out.push({ stat: "cost", op: "gte", value: obj.costAtLeast });
    delete obj.costAtLeast;
    changed = true;
  }
  if (typeof obj.strengthAtMost === "number") {
    out.push({ stat: "strength", op: "lte", value: obj.strengthAtMost });
    delete obj.strengthAtMost;
    changed = true;
  }
  if (typeof obj.strengthAtLeast === "number") {
    out.push({ stat: "strength", op: "gte", value: obj.strengthAtLeast });
    delete obj.strengthAtLeast;
    changed = true;
  }
  if (typeof obj.willpowerAtMost === "number") {
    out.push({ stat: "willpower", op: "lte", value: obj.willpowerAtMost });
    delete obj.willpowerAtMost;
    changed = true;
  }
  if (typeof obj.willpowerAtLeast === "number") {
    out.push({ stat: "willpower", op: "gte", value: obj.willpowerAtLeast });
    delete obj.willpowerAtLeast;
    changed = true;
  }
  if (typeof obj.costAtMostFromLastResolvedSourcePlus === "number") {
    const offset = obj.costAtMostFromLastResolvedSourcePlus;
    out.push({
      stat: "cost",
      op: "lte",
      value: offset === 0
        ? { from: "last_resolved_source" }
        : { from: "last_resolved_source", offset },
    });
    delete obj.costAtMostFromLastResolvedSourcePlus;
    changed = true;
  }
  if (obj.costAtMostFromSourceStrength === true) {
    out.push({
      stat: "cost",
      op: "lte",
      value: { from: "source", property: "strength" },
    });
    delete obj.costAtMostFromSourceStrength;
    changed = true;
  }
  if (obj.strengthAtMostFromBanishedSource === true) {
    out.push({
      stat: "strength",
      op: "lte",
      value: { from: "last_banished_source" },
    });
    delete obj.strengthAtMostFromBanishedSource;
    changed = true;
  }

  if (changed && out.length > 0) {
    obj.statComparisons = out;
  }
  return changed;
}

/** Walk an arbitrary JSON structure calling migrateFilter on every object node. */
function walk(node: any): number {
  if (!node || typeof node !== "object") return 0;
  let count = 0;
  if (Array.isArray(node)) {
    for (const item of node) count += walk(item);
    return count;
  }
  // Migrate this object if it looks like a filter (has any legacy numeric field).
  if (migrateFilter(node)) count++;
  // Recurse regardless — filters can be nested in effect trees, anyOf arrays,
  // target.filter, condition.filter, etc.
  for (const key of Object.keys(node)) count += walk(node[key]);
  return count;
}

function main(): void {
  const files = readdirSync(CARDS_DIR).filter(f => f.startsWith("card-set-") && f.endsWith(".json"));
  let totalFilters = 0;
  let totalFiles = 0;
  for (const f of files) {
    const path = join(CARDS_DIR, f);
    const cards = JSON.parse(readFileSync(path, "utf-8"));
    const migrated = walk(cards);
    if (migrated > 0) {
      console.log(`  ${f.padEnd(28)} ${migrated} filter(s) migrated`);
      totalFilters += migrated;
      totalFiles++;
      if (!dryRun) writeFileSync(path, JSON.stringify(cards, null, 2), "utf-8");
    }
  }
  console.log("─".repeat(60));
  console.log(`  ${totalFilters} filter(s) across ${totalFiles} file(s) ${dryRun ? "would be" : "were"} migrated.`);
  if (dryRun) console.log("  (dry run — no files written)");
}

main();
