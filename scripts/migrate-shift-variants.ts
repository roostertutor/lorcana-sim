#!/usr/bin/env node
// =============================================================================
// MIGRATE SHIFT VARIANTS — collapse universal_shift_self / classification_shift_self
// StaticAbilities into the Shift keyword's variant + classifier fields per
// CRD 8.10.8.
// -----------------------------------------------------------------------------
// CRD 8.10.8: Shift has two variants — Universal Shift (8.10.8.2, Baymax) and
// Classification Shift (8.10.8.1, Thunderbolt's [Dog] Shift). Both ARE the
// Shift keyword with extra parameters; they are NOT distinct keywords.
//
// Pre-migration shape (violates structural-fidelity rule — one printed
// keyword should be one JSON ability):
//   {
//     "abilities": [
//       { "type": "keyword", "keyword": "shift", "value": 4 },
//       { "type": "static",
//         "effect": { "type": "universal_shift_self" },
//         "activeZones": ["hand"] }
//     ]
//   }
//
// Post-migration shape (CRD-aligned):
//   {
//     "abilities": [
//       { "type": "keyword", "keyword": "shift", "value": 4, "variant": "universal" }
//     ]
//   }
//
// For Classification Shift, the migration also moves the `trait` field from
// the static effect to the `classifier` field on the keyword:
//   { "type": "static", "effect": { "type": "classification_shift_self", "trait": "Puppy" }, "activeZones": ["hand"] }
//   →
//   { "type": "keyword", "keyword": "shift", "value": 3, "variant": "classification", "classifier": "Puppy" }
//
// Detection criteria:
//   1. abilities[] contains a static with effect.type ===
//      "universal_shift_self" or "classification_shift_self"
//   2. abilities[] also contains a keyword with keyword === "shift" (the cost)
//
// Behavior is identical pre/post-migration in the current engine — Layer 1
// extended canShiftOnto to read variant info from the keyword as well as
// from the legacy modifiers path. After this migration runs, the
// universal_shift_self / classification_shift_self StaticEffect handlers
// in gameModifiers.ts become dead code and should be removed (Layer 4).
//
// Usage:
//   pnpm tsx scripts/migrate-shift-variants.ts             # all sets, write
//   pnpm tsx scripts/migrate-shift-variants.ts --dry       # report only
//   pnpm tsx scripts/migrate-shift-variants.ts --sets 7,8  # limit sets
//
// Idempotent: re-running on already-migrated data is a no-op.
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type Json = Record<string, any>;

interface MigrationResult {
  set: string;
  cardNumber: number;
  cardName: string;
  variant: "universal" | "classification";
  classifier?: string;
  shiftCost: number;
}

function migrateCard(card: Json): MigrationResult | null {
  const abilities: Json[] = Array.isArray(card.abilities) ? card.abilities : [];
  if (abilities.length === 0) return null;

  // Find the variant static and the shift keyword.
  let variantStaticIndex = -1;
  let variantKind: "universal" | "classification" | null = null;
  let classifier: string | undefined;
  let shiftKeywordIndex = -1;
  let shiftCost: number | undefined;

  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i];
    if (a.type === "static") {
      const effType = a.effect?.type;
      if (effType === "universal_shift_self") {
        variantStaticIndex = i;
        variantKind = "universal";
      } else if (effType === "classification_shift_self") {
        variantStaticIndex = i;
        variantKind = "classification";
        classifier = a.effect?.trait;
      }
    }
    if (a.type === "keyword" && a.keyword === "shift") {
      shiftKeywordIndex = i;
      shiftCost = a.value;
    }
  }

  if (variantStaticIndex < 0 || variantKind === null) return null;

  // If there's no shift keyword in abilities[], the engine relies on the
  // top-level shiftCost field — a fallback that's working but structurally
  // incorrect (Shift is a keyword and should be in abilities[]). Synthesize
  // the keyword from card.shiftCost. Baymax Giant Robot is the canonical
  // case in sets 1-12.
  if (shiftKeywordIndex < 0) {
    const fallbackCost = typeof card.shiftCost === "number" ? card.shiftCost : undefined;
    if (fallbackCost === undefined) {
      console.warn(
        `  ⚠ ${card.fullName}: ${variantKind} shift static found but no shift keyword AND no card.shiftCost. Skipping; manual review required.`,
      );
      return null;
    }
    if (variantKind === "classification" && !classifier) {
      console.warn(
        `  ⚠ ${card.fullName}: classification_shift_self static missing trait. Skipping.`,
      );
      return null;
    }
    // Synthesize the keyword in place of the static. Position it where the
    // static was so ability ordering stays roughly stable.
    const synthesizedKeyword: Json = {
      type: "keyword",
      keyword: "shift",
      value: fallbackCost,
      variant: variantKind,
      ...(classifier ? { classifier } : {}),
    };
    abilities[variantStaticIndex] = synthesizedKeyword;

    return {
      set: card.setId,
      cardNumber: card.number,
      cardName: card.fullName,
      variant: variantKind,
      classifier,
      shiftCost: fallbackCost,
    };
  }

  if (shiftCost === undefined) {
    console.warn(
      `  ⚠ ${card.fullName}: shift keyword found but value missing. Skipping.`,
    );
    return null;
  }
  if (variantKind === "classification" && !classifier) {
    console.warn(
      `  ⚠ ${card.fullName}: classification_shift_self static missing trait. Skipping.`,
    );
    return null;
  }

  // Already migrated? — keyword already has variant field set. Idempotency.
  if (abilities[shiftKeywordIndex].variant) return null;

  // Apply the migration: write variant fields onto the keyword, remove the
  // static-effect ability.
  abilities[shiftKeywordIndex] = {
    ...abilities[shiftKeywordIndex],
    variant: variantKind,
    ...(classifier ? { classifier } : {}),
  };
  abilities.splice(variantStaticIndex, 1);

  return {
    set: card.setId,
    cardNumber: card.number,
    cardName: card.fullName,
    variant: variantKind,
    classifier,
    shiftCost,
  };
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

    let modified = false;
    for (const card of cards) {
      const r = migrateCard(card);
      if (r) {
        allResults.push(r);
        modified = true;
      }
    }

    if (modified && !dryRun) {
      writeFileSync(filePath, JSON.stringify(cards, null, 2) + "\n");
      filesWritten++;
    }
  }

  console.log("\n=== Shift-Variant Fidelity Migration (CRD 8.10.8) ===");
  if (allResults.length === 0) {
    console.log("  No candidates found. (Run with --dry to verify before writing.)");
    return;
  }

  console.log(`  ${allResults.length} cards migrated`);
  console.log();
  for (const r of allResults) {
    const tag = r.variant === "universal" ? "Universal Shift" : `[${r.classifier}] Shift`;
    console.log(`  set-${r.set}/#${r.cardNumber} ${r.cardName}`);
    console.log(`     ${tag} ${r.shiftCost} — universal_shift_self/classification_shift_self static removed; keyword now carries variant/${r.classifier ? "classifier" : ""}`);
  }
  console.log();

  if (dryRun) {
    console.log("  --dry: no files written. Re-run without --dry to apply.");
  } else {
    console.log(`  Wrote ${filesWritten} file(s).`);
    console.log();
    console.log("  Next: pnpm test (engine tests must still pass — both Layer-1 paths feed canShiftOnto).");
    console.log("        Once green, Layer 4 removes universal_shift_self / classification_shift_self");
    console.log("        from types/index.ts + gameModifiers.ts (dead code post-migration).");
  }
}

main();
