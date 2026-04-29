#!/usr/bin/env node
// =============================================================================
// MIGRATE FIDELITY VIOLATION — multi-trigger merge (CLAUDE.md "Structural
// fidelity to printed text" rule, Group A — the largest cluster).
// -----------------------------------------------------------------------------
// Detects the duplicate-storyName Hiram-class pattern surfaced by
// `pnpm card-status --category fidelity-violation`:
//
//   Oracle: "ARTIFICER When you play this character and whenever he quests,
//            you may banish one of your items to draw 2 cards."
//   Hand-wired: TWO TriggeredAbility entries sharing storyName ARTIFICER —
//     one with trigger.on === "enters_play", one with trigger.on === "quests",
//     each carrying an IDENTICAL effect body (deep-equal).
//
// Migration: merge the N matching abilities into ONE TriggeredAbility with
// `trigger: { anyOf: [trig1, trig2, ...] }` per CRD structural fidelity.
// The engine extension (Phase B-anyOf Layer 1, types/index.ts +
// reducer.ts findMatchingTriggerSpec) accepts this shape; firing semantics
// are identical to the duplicate-ability shape EXCEPT that oncePerTurn now
// shares one budget across triggers (the previous shape silently double-
// counted, which was a latent bug).
//
// Detection criteria (ALL must hold):
//   1. Same storyName (non-empty) appears ≥2 times in card.abilities[].
//   2. All matching abilities have type:"triggered".
//   3. All matching abilities' effect bodies + conditions + oncePerTurn /
//      maxFiresPerTurn / activeZones fields are deep-equal (everything
//      EXCEPT trigger field).
//   4. All matching abilities have a single bare TriggerEvent (not already
//      anyOf form — idempotency guard).
//
// Cards that don't match all criteria are left alone — manual review
// required (Group C / Group D in REPORT-V2.md).
//
// Behavior preservation:
//   * Same storyName before and after — replacement-effect targeting
//     unaffected.
//   * Same effect body — gameplay outcomes identical.
//   * oncePerTurn budget consolidated — pre-migration two abilities each
//     had their own oncePerTurnKey (storyName-keyed, but only one had a
//     storyName, so the second got "anon" or rulesText fallback). Post-
//     migration there's one shared budget. This corrects a latent bug.
//
// Usage:
//   pnpm tsx scripts/migrate-fidelity-multi-trigger.ts             # all sets, write
//   pnpm tsx scripts/migrate-fidelity-multi-trigger.ts --dry       # report only
//   pnpm tsx scripts/migrate-fidelity-multi-trigger.ts --sets 1,2  # limit sets
//
// Idempotent.
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
  triggers: string[];
}

function migrateCard(card: Json): MigrationResult[] {
  const results: MigrationResult[] = [];
  const abilities: Json[] = Array.isArray(card.abilities) ? card.abilities : [];
  if (abilities.length < 2) return results;

  // Group abilities by storyName.
  const groups = new Map<string, { ability: Json; index: number }[]>();
  for (let i = 0; i < abilities.length; i++) {
    const name = (abilities[i]?.storyName ?? "").trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push({ ability: abilities[i], index: i });
  }

  const groupEntries = [...groups.entries()].sort(
    (a, b) => a[1][0].index - b[1][0].index,
  );

  const removeIndices = new Set<number>();
  const replaceAt: { index: number; ability: Json }[] = [];

  for (const [name, members] of groupEntries) {
    if (members.length < 2) continue;

    // Criterion 2: all triggered.
    if (!members.every((m) => m.ability.type === "triggered")) continue;

    // Criterion 4: each has a single bare TriggerEvent (not already anyOf).
    if (
      !members.every(
        (m) =>
          m.ability.trigger &&
          typeof m.ability.trigger === "object" &&
          "on" in m.ability.trigger &&
          !("anyOf" in m.ability.trigger),
      )
    )
      continue;

    // Criterion 3: effect bodies + conditions + flags deep-equal across members.
    // Strip the trigger and storyName/rulesText fields, compare the rest.
    const stripped = members.map((m) => {
      const { trigger, storyName, rulesText, ...rest } = m.ability;
      return rest;
    });
    const allEqual = stripped.every((s) => deepEqual(s, stripped[0]));
    if (!allEqual) continue;

    // All criteria pass — build the merged ability with anyOf trigger.
    const triggers = members.map((m) => m.ability.trigger);
    // Dedupe triggers by JSON equality (defensive — shouldn't happen since the
    // members passed criterion 4 and were grouped by storyName, but if the
    // same trigger appears twice the anyOf would be redundant).
    const seenTrig = new Set<string>();
    const dedupedTriggers: Json[] = [];
    for (const t of triggers) {
      const k = JSON.stringify(t);
      if (!seenTrig.has(k)) {
        seenTrig.add(k);
        dedupedTriggers.push(t);
      }
    }

    // Start from a deep-clone of members[0] (preserves storyName, rulesText,
    // effects, condition, oncePerTurn, activeZones, maxFiresPerTurn, etc.)
    // and replace the trigger field with anyOf.
    const mergedAbility: Json = structuredClone(members[0].ability);
    mergedAbility.trigger =
      dedupedTriggers.length === 1
        ? dedupedTriggers[0] // collapsed to single — emit bare form
        : { anyOf: dedupedTriggers.map((t) => structuredClone(t)) };

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
      triggers: dedupedTriggers.map((t) => (t as Json).on as string),
    });
  }

  if (replaceAt.length === 0) return results;

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

  console.log("\n=== Multi-Trigger Fidelity Migration (Hiram class) ===");
  if (allResults.length === 0) {
    console.log("  No candidates found. (Run with --dry to verify before writing.)");
    return;
  }

  console.log(`  ${allResults.length} groups merged across ${new Set(allResults.map(r => `${r.set}/${r.cardNumber}`)).size} cards`);
  console.log();
  for (const r of allResults) {
    console.log(`  set-${r.set}/#${r.cardNumber} ${r.cardName} [${r.storyName}]`);
    console.log(`     ${r.beforeCount} triggered abilities → 1 with anyOf [${r.triggers.join(", ")}]`);
  }
  console.log();

  if (dryRun) {
    console.log("  --dry: no files written. Re-run without --dry to apply.");
  } else {
    console.log(`  Wrote ${filesWritten} file(s).`);
    console.log(`  Verify: pnpm test  (engine + multi-trigger anyOf path)`);
    console.log(`          pnpm card-status --category fidelity-violation --verbose`);
  }
}

main();
