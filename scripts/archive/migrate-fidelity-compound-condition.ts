#!/usr/bin/env node
// =============================================================================
// MIGRATE FIDELITY VIOLATION — compound-condition cleanup (CLAUDE.md
// "Structural fidelity to printed text" rule, degenerate / redundant compound
// subset).
// -----------------------------------------------------------------------------
// Detects malformed `compound_and` / `compound_or` conditions surfaced by
// `pnpm card-status --category fidelity-violation`:
//
//   * degenerate-compound: compound with duplicate (deep-equal) sub-conditions.
//     E.g. Nala: compound_and(this_has_no_damage, this_has_no_damage). Logically
//     X AND X = X; the duplicate is hand-paraphrase residue from encoding
//     "While X, [A] and [B]" as two separate static abilities (each carrying
//     the same X) and then merging them under one storyName by force-wrapping
//     in compound_and.
//   * redundant-compound: compound with ≤1 sub-conditions. 0 means "no
//     constraint" — the condition is meaningless, drop it. 1 means the wrapper
//     is dead weight — unwrap to the bare condition.
//
// Migration: recursively normalize every ability's top-level `condition` field.
// Walks compound_and/compound_or trees bottom-up; dedupes by JSON.stringify;
// unwraps length-1; signals "drop entirely" for length-0.
//
// Behavior is identical pre/post-migration in the current engine:
//   * compound_and(X, X) evaluates to X
//   * compound_and(X) evaluates to X
//   * compound_and() evaluates to true (no constraints) — same as no condition
//
// Usage:
//   pnpm tsx scripts/migrate-fidelity-compound-condition.ts             # all sets, write
//   pnpm tsx scripts/migrate-fidelity-compound-condition.ts --dry       # report only
//   pnpm tsx scripts/migrate-fidelity-compound-condition.ts --sets 7,8  # limit sets
//
// Idempotent: re-running on already-clean data is a no-op.
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type Json = Record<string, any>;

// -----------------------------------------------------------------------------
// Recursive condition normalizer.
//
// Returns:
//   * null               → "drop the condition entirely" (length-0 compound)
//   * a Json object      → the (possibly rewritten) condition
//
// Caller decides whether to delete the `condition` field on the parent (when
// null) or to replace it with the returned object (when not null).
// -----------------------------------------------------------------------------
type NormalizeResult = Json | null;

interface NormalizeStats {
  duplicatesDropped: number;
  unwraps: number;
  emptyDrops: number;
}

function normalizeCondition(cond: any, stats: NormalizeStats): NormalizeResult {
  if (!cond || typeof cond !== "object") return cond;
  // Compound: walk + collapse.
  if ((cond.type === "compound_and" || cond.type === "compound_or") && Array.isArray(cond.conditions)) {
    // Recurse on each sub-condition first (bottom-up), filtering out any that
    // collapsed to null (those represent meaningless empty compounds and
    // contribute nothing to the parent).
    const normalized: Json[] = [];
    for (const sub of cond.conditions) {
      const r = normalizeCondition(sub, stats);
      if (r !== null) normalized.push(r);
    }
    // Dedupe by JSON.stringify of the normalized result.
    const seen = new Set<string>();
    const deduped: Json[] = [];
    for (const c of normalized) {
      const key = JSON.stringify(c);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      } else {
        stats.duplicatesDropped++;
      }
    }
    if (deduped.length === 0) {
      stats.emptyDrops++;
      return null; // caller drops the field
    }
    if (deduped.length === 1) {
      stats.unwraps++;
      return deduped[0]; // unwrap
    }
    return { ...cond, conditions: deduped };
  }
  return cond;
}

interface MigrationResult {
  set: string;
  cardNumber: number;
  cardName: string;
  storyName: string;
  abilityIndex: number;
  before: string;
  after: string;
  fieldDropped: boolean;
}

function migrateCard(card: Json): MigrationResult[] {
  const results: MigrationResult[] = [];
  const abilities: Json[] = Array.isArray(card.abilities) ? card.abilities : [];
  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i];
    if (!a?.condition) continue;
    const stats: NormalizeStats = { duplicatesDropped: 0, unwraps: 0, emptyDrops: 0 };
    const before = JSON.stringify(a.condition);
    const normalized = normalizeCondition(a.condition, stats);
    const after = normalized === null ? "(deleted)" : JSON.stringify(normalized);
    if (before === after) continue; // unchanged
    if (stats.duplicatesDropped === 0 && stats.unwraps === 0 && stats.emptyDrops === 0) continue; // no real change
    results.push({
      set: card.setId,
      cardNumber: card.number,
      cardName: card.fullName,
      storyName: a.storyName ?? "(no storyName)",
      abilityIndex: i,
      before: before.slice(0, 200),
      after: normalized === null ? "(condition field deleted)" : after.slice(0, 200),
      fieldDropped: normalized === null,
    });
    if (normalized === null) {
      delete a.condition;
    } else {
      a.condition = normalized;
    }
  }
  return results;
}

function main(): void {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry");
  const setsFlag = argv.indexOf("--sets");
  const setsFilter = setsFlag >= 0 ? argv[setsFlag + 1].split(",") : null;

  const files = readdirSync(CARDS_DIR)
    .filter((f) => /^card-set-[\w]+\.json$/.test(f))
    .sort();

  const allResults: MigrationResult[] = [];
  let filesWritten = 0;

  for (const filename of files) {
    const setId = filename.match(/^card-set-(\w+)\.json$/)![1];
    if (setsFilter && !setsFilter.includes(setId)) continue;

    const filePath = join(CARDS_DIR, filename);
    const cards: Json[] = JSON.parse(readFileSync(filePath, "utf-8"));

    const fileResults: MigrationResult[] = [];
    for (const card of cards) {
      const r = migrateCard(card);
      fileResults.push(...r);
      allResults.push(...r);
    }

    if (fileResults.length > 0 && !dryRun) {
      writeFileSync(filePath, JSON.stringify(cards, null, 2) + "\n");
      filesWritten++;
    }
  }

  console.log("\n=== Compound-Condition Fidelity Migration ===");
  if (allResults.length === 0) {
    console.log("  No candidates found. (Run with --dry to verify before writing.)");
    return;
  }

  console.log(`  ${allResults.length} ability conditions normalized across ${new Set(allResults.map(r => `${r.set}/${r.cardNumber}`)).size} cards`);
  console.log();
  for (const r of allResults) {
    console.log(`  set-${r.set}/#${r.cardNumber} ${r.cardName} [${r.storyName}] abilities[${r.abilityIndex}]`);
    console.log(`    before: ${r.before}${r.before.length === 200 ? "..." : ""}`);
    console.log(`    after:  ${r.after}${r.fieldDropped ? "" : (r.after.length === 200 ? "..." : "")}`);
  }
  console.log();

  if (dryRun) {
    console.log("  --dry: no files written. Re-run without --dry to apply.");
  } else {
    console.log(`  Wrote ${filesWritten} file(s).`);
    console.log(`  Verify: pnpm card-status --category fidelity-violation --verbose`);
    console.log(`          (the 5 degenerate-compound + 1 redundant-compound cases should be gone)`);
  }
}

main();
