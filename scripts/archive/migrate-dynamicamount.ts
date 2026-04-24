#!/usr/bin/env node
// =============================================================================
// ONE-SHOT MIGRATION — 2026-04-24
// -----------------------------------------------------------------------------
// Collapses 14 per-stat DynamicAmount variants (7 string + 7 object) into the
// unified {type: "stat_ref", from, property} shape.
//
// String variants:
//   "triggering_card_lore"           → {type:"stat_ref", from:"triggering_card",      property:"lore"}
//   "triggering_card_damage"         → {type:"stat_ref", from:"triggering_card",      property:"damage"}
//   "last_target_location_lore"      → {type:"stat_ref", from:"last_target_location", property:"lore"}
//   "last_resolved_target_delta"     → {type:"stat_ref", from:"last_resolved_target", property:"delta"}
//   "last_resolved_source_strength"  → {type:"stat_ref", from:"last_resolved_source", property:"strength"}
//   "last_resolved_target_lore"      → {type:"stat_ref", from:"last_resolved_target", property:"lore"}
//   "last_resolved_target_strength"  → {type:"stat_ref", from:"last_resolved_target", property:"strength"}
//
// Object variants ({type: "xxx"} forms — `max` preserved):
//   target_lore       → {from:"target",            property:"lore"}
//   target_damage     → {from:"target",            property:"damage"}
//   target_strength   → {from:"target",            property:"strength"}
//   target_willpower  → {from:"target",            property:"willpower"}
//   source_lore       → {from:"source",            property:"lore"}
//   source_strength   → {from:"source",            property:"strength"}
//   source_willpower  → {from:"source",            property:"willpower"}
//
// DynamicAmount can appear as any field value in the card JSON tree. The walk
// inspects every string value and every object {type: X, ...} and rewrites
// matches. Idempotent — already-migrated {type: "stat_ref"} values untouched.
//
// Usage:
//   pnpm migrate-dynamicamount            # live
//   pnpm migrate-dynamicamount --dry-run  # count only
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const STRING_MAP: Record<string, { from: string; property: string }> = {
  triggering_card_lore:          { from: "triggering_card",      property: "lore" },
  triggering_card_damage:        { from: "triggering_card",      property: "damage" },
  last_target_location_lore:     { from: "last_target_location", property: "lore" },
  last_resolved_target_delta:    { from: "last_resolved_target", property: "delta" },
  last_resolved_source_strength: { from: "last_resolved_source", property: "strength" },
  last_resolved_target_lore:     { from: "last_resolved_target", property: "lore" },
  last_resolved_target_strength: { from: "last_resolved_target", property: "strength" },
};

const OBJECT_MAP: Record<string, { from: string; property: string }> = {
  target_lore:       { from: "target", property: "lore" },
  target_damage:     { from: "target", property: "damage" },
  target_strength:   { from: "target", property: "strength" },
  target_willpower:  { from: "target", property: "willpower" },
  source_lore:       { from: "source", property: "lore" },
  source_strength:   { from: "source", property: "strength" },
  source_willpower:  { from: "source", property: "willpower" },
};

let count = 0;

/** Walk the JSON tree rewriting DynamicAmount values in place.
 *  Returns the transformed value (may be identical reference). */
function walk(node: any): any {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = walk(node[i]);
    }
    return node;
  }
  if (typeof node === "object") {
    // First: if this object is an object-form DynamicAmount we migrate, rewrite it.
    if (typeof node.type === "string" && OBJECT_MAP[node.type]) {
      const { from, property } = OBJECT_MAP[node.type]!;
      const next: any = { type: "stat_ref", from, property };
      if (typeof node.max === "number") next.max = node.max;
      count++;
      return next;
    }
    // Otherwise walk children. Mutate in place so parent references stay valid.
    for (const key of Object.keys(node)) {
      const v = node[key];
      // String-form migration: rewrite string values that match STRING_MAP.
      // We only rewrite when the key NAME is one of the known DynamicAmount-
      // carrying keys — otherwise ordinary strings in unrelated fields
      // (rulesText, id, etc.) could be collateral damage. Known keys that
      // accept DynamicAmount:
      if (typeof v === "string" && STRING_MAP[v]
          && (key === "amount" || key === "count" || key === "loreDynamic"
              || key === "strengthDynamic" || key === "willpowerDynamic"
              || key === "perCount" || key === "perDamage")) {
        const { from, property } = STRING_MAP[v]!;
        node[key] = { type: "stat_ref", from, property };
        count++;
        continue;
      }
      node[key] = walk(v);
    }
  }
  return node;
}

function main(): void {
  const files = readdirSync(CARDS_DIR).filter(f => f.startsWith("card-set-") && f.endsWith(".json"));
  let totalFiles = 0;
  for (const f of files) {
    const path = join(CARDS_DIR, f);
    const cards = JSON.parse(readFileSync(path, "utf-8"));
    const before = count;
    walk(cards);
    const migrated = count - before;
    if (migrated > 0) {
      console.log(`  ${f.padEnd(28)} ${migrated} usage(s) migrated`);
      totalFiles++;
      if (!dryRun) writeFileSync(path, JSON.stringify(cards, null, 2), "utf-8");
    }
  }
  console.log("─".repeat(60));
  console.log(`  ${count} DynamicAmount usage(s) across ${totalFiles} file(s) ${dryRun ? "would be" : "were"} migrated.`);
  if (dryRun) console.log("  (dry run — no files written)");
}

main();
