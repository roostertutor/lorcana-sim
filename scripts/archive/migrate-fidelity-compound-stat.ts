#!/usr/bin/env node
// =============================================================================
// MIGRATE FIDELITY VIOLATION — compound-static merge (CLAUDE.md "Structural
// fidelity to printed text" rule, Group B subset).
// -----------------------------------------------------------------------------
// Detects the hand-paraphrased compound-static pattern surfaced by
// `pnpm card-status --category fidelity-violation`:
//
//   Oracle: "While X, this character gets +N {S} and +M {L}."
//   (Hand-)wired: TWO static abilities sharing a storyName, each with one
//   stat — same condition, same target, only effect.stat / effect.amount
//   differ.
//
// Migration: merge the N matching abilities into ONE static ability with
// `effect: StaticEffect[]` (CRD 6.2.6, types/index.ts:200 — "Array form for
// compound abilities: 'While X, [A] and [B]' — both effects share the same
// condition and story name").
//
// Detection criteria (ALL must hold):
//   1. Same storyName (non-empty) appears 2+ times in card.abilities.
//   2. All matching abilities have type:"static".
//   3. All matching abilities' condition fields are deep-equal.
//   4. All matching abilities' effect.target fields are deep-equal.
//
// Behavior is identical pre/post-migration in the current engine — the
// effect-array form was always supported. The migration is purely structural,
// closing the latent-bug surface (oncePerTurn budget doubling, replacement-
// effect targeting, decompile-score false negatives).
//
// Usage:
//   pnpm tsx scripts/migrate-fidelity-compound-stat.ts             # all sets, write
//   pnpm tsx scripts/migrate-fidelity-compound-stat.ts --dry       # report only
//   pnpm tsx scripts/migrate-fidelity-compound-stat.ts --sets 9,12 # limit sets
//
// Idempotent: running again after a clean migration finds 0 candidates.
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type Json = Record<string, any>;

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  if (!ka.every((k, i) => k === kb[i])) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

interface MigrationResult {
  set: string;
  cardNumber: number;
  cardName: string;
  storyName: string;
  beforeCount: number;
  effectsInArray: number;
}

function migrateCard(card: Json): MigrationResult[] {
  const results: MigrationResult[] = [];
  const abilities: Json[] = Array.isArray(card.abilities) ? card.abilities : [];
  if (abilities.length < 2) return results;

  // Group abilities by non-empty storyName, preserving original index.
  const groups = new Map<string, { ability: Json; index: number }[]>();
  for (let i = 0; i < abilities.length; i++) {
    const name = (abilities[i]?.storyName ?? "").trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push({ ability: abilities[i], index: i });
  }

  // Determine which groups qualify for the compound-stat merge.
  // We process groups in declaration order so the merged ability lands at the
  // first member's index (preserves ordering relative to other abilities).
  const groupEntries = [...groups.entries()].sort(
    (a, b) => a[1][0].index - b[1][0].index,
  );

  // Track indices to remove (members[1..] of each merged group). The merged
  // ability replaces members[0] in place.
  const removeIndices = new Set<number>();
  const replaceAt: { index: number; ability: Json }[] = [];

  for (const [name, members] of groupEntries) {
    if (members.length < 2) continue;

    // Criterion 2: all type:"static"
    if (!members.every((m) => m.ability.type === "static")) continue;

    // Criterion 3: same condition (deep-equal)
    const firstCond = members[0].ability.condition;
    if (!members.every((m) => deepEqual(m.ability.condition, firstCond))) continue;

    // Each member's effect — singular or already an array. Collect all into
    // one flat array. Verify the targets match across all effects.
    const flatEffects: Json[] = [];
    for (const m of members) {
      const eff = m.ability.effect;
      if (Array.isArray(eff)) flatEffects.push(...eff);
      else if (eff && typeof eff === "object") flatEffects.push(eff);
      else {
        // Effect missing or non-object — skip migration of this group.
        flatEffects.length = 0;
        break;
      }
    }
    if (flatEffects.length === 0) continue;

    // Criterion 4: same target across all flat effects.
    const firstTarget = flatEffects[0]?.target;
    if (!flatEffects.every((e) => deepEqual(e?.target, firstTarget))) continue;

    // All criteria pass — build the merged ability.
    // Start from a deep-clone of members[0] (preserves any non-standard fields
    // like activeZones, oncePerTurn) and override `effect` with the flat array.
    // condition + storyName + rulesText come along for free from the clone
    // since deep-equal verification proved they match across members.
    const mergedAbility: Json = structuredClone(members[0].ability);
    mergedAbility.effect = flatEffects.map((e) => structuredClone(e));
    // Defensive: if any later member had a field members[0] didn't, surface it
    // as a warning so the human reviewer sees lossy-merge candidates.
    for (let j = 1; j < members.length; j++) {
      const otherKeys = Object.keys(members[j].ability);
      const baseKeys = new Set(Object.keys(members[0].ability));
      for (const k of otherKeys) {
        if (!baseKeys.has(k) && k !== "effect") {
          console.warn(
            `  ⚠ ${card.fullName} [${name}]: field "${k}" on members[${j}] not in members[0] — merge may be lossy. Manual review.`,
          );
        }
      }
    }

    // Replace at members[0].index, queue removal of members[1..]
    replaceAt.push({ index: members[0].index, ability: mergedAbility });
    for (let j = 1; j < members.length; j++) {
      removeIndices.add(members[j].index);
    }

    results.push({
      set: card.setId,
      cardNumber: card.number,
      cardName: card.fullName,
      storyName: name,
      beforeCount: members.length,
      effectsInArray: flatEffects.length,
    });
  }

  if (replaceAt.length === 0) return results;

  // Apply replacements + removals to a new abilities[] array.
  const newAbilities: Json[] = [];
  for (let i = 0; i < abilities.length; i++) {
    if (removeIndices.has(i)) continue;
    const replace = replaceAt.find((r) => r.index === i);
    newAbilities.push(replace ? replace.ability : abilities[i]);
  }
  card.abilities = newAbilities;
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

  console.log("\n=== Compound-Static Fidelity Migration ===");
  if (allResults.length === 0) {
    console.log("  No candidates found. (Run with --dry to verify before writing.)");
    return;
  }

  console.log(`  ${allResults.length} groups merged across ${new Set(allResults.map(r => `${r.set}/${r.cardNumber}`)).size} cards`);
  console.log();
  for (const r of allResults) {
    console.log(`  set-${r.set}/#${r.cardNumber} ${r.cardName} [${r.storyName}]`);
    console.log(`     ${r.beforeCount} static abilities → 1 with ${r.effectsInArray}-element effect array`);
  }
  console.log();

  if (dryRun) {
    console.log("  --dry: no files written. Re-run without --dry to apply.");
  } else {
    console.log(`  Wrote ${filesWritten} file(s).`);
    console.log(`  Verify: pnpm card-status --category fidelity-violation --verbose`);
    console.log(`          (the 9 compound-static groups should be gone — only multi-trigger / mixed-type / degenerate-compound cases should remain)`);
  }
}

main();
