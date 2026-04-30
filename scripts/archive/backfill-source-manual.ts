#!/usr/bin/env node
// =============================================================================
// BACKFILL _source: "manual" ON EXISTING CARDS
// Tags every card in packages/engine/src/cards/card-set-*.json that lacks a
// `_source` field with `_source: "manual"`. Use case:
//
//   1. pnpm backfill-source-manual          (tag every card "manual")
//   2. git commit -am "backfill _source"    (snapshot pre-rescan state)
//   3. pnpm import-cards                    (rescan Ravensburger → upgrades
//                                            covered cards to "ravensburger")
//   4. pnpm import-cards-lorcast            (fill gaps → upgrades to "lorcast")
//   5. grep cards for cards still tagged "manual" — those are the ones whose
//      provenance can't be traced to either API. Review and fix or accept.
//
// Usage:
//   pnpm backfill-source-manual                   (all sets)
//   pnpm backfill-source-manual --skip-sets 12    (skip specified sets)
//   pnpm backfill-source-manual --only 12         (only specified sets)
//   pnpm backfill-source-manual --dry             (print changes, don't write)
//
// Default is to tag every set — the hierarchy (ravensburger > lorcast > manual)
// handles provenance: a subsequent `pnpm import-cards` upgrades Ravensburger-
// covered cards, then `pnpm import-cards-lorcast` fills the rest. Anything
// still tagged "manual" at the end = untraceable stale data needing review.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "packages", "engine", "src", "cards");

interface CardLike {
  id: string;
  _source?: "ravensburger" | "lorcast" | "manual";
  [key: string]: unknown;
}

const argv = process.argv.slice(2);
function getFlag(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  if (eq) return eq;
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) return argv[idx + 1];
  return undefined;
}
const skipSetsArg = getFlag("skip-sets") ?? "";
const onlyArg = getFlag("only");
const isDry = argv.includes("--dry");

const skipSets = new Set(skipSetsArg.split(",").map((s) => s.trim()).filter(Boolean));
const onlySets = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;

function setCodeFromFile(filename: string): string {
  return filename.replace(/^card-set-/, "").replace(/\.json$/, "");
}

const allFiles = readdirSync(OUT_DIR)
  .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"));

let totalTagged = 0;
let totalAlreadyTagged = 0;
let filesChanged = 0;
const filesSkipped: string[] = [];

for (const file of allFiles) {
  const setCode = setCodeFromFile(file);
  if (onlySets && !onlySets.has(setCode)) {
    filesSkipped.push(`${setCode} (not in --only)`);
    continue;
  }
  if (skipSets.has(setCode)) {
    filesSkipped.push(`${setCode} (--skip-sets)`);
    continue;
  }

  const path = join(OUT_DIR, file);
  const cards: CardLike[] = JSON.parse(readFileSync(path, "utf-8"));
  let tagged = 0;
  let alreadyTagged = 0;
  for (const card of cards) {
    if (card._source) {
      alreadyTagged++;
      continue;
    }
    card._source = "manual";
    tagged++;
  }
  totalTagged += tagged;
  totalAlreadyTagged += alreadyTagged;
  if (tagged === 0) {
    console.log(`  ${setCode.padEnd(4)}  no changes (${alreadyTagged} already tagged)`);
    continue;
  }
  if (!isDry) {
    writeFileSync(path, JSON.stringify(cards, null, 2), "utf-8");
    filesChanged++;
  }
  console.log(`  ${setCode.padEnd(4)}  tagged ${tagged} card(s) as manual` +
    (alreadyTagged > 0 ? ` (skipped ${alreadyTagged} already tagged)` : ""));
}

console.log(`
──────────────────────────────────────
  Tagged:         ${totalTagged}
  Already tagged: ${totalAlreadyTagged}
  Files changed:  ${filesChanged}${isDry ? " (dry-run)" : ""}
  Skipped files:  ${filesSkipped.join(", ") || "(none)"}
──────────────────────────────────────

Next steps:
  1. git add packages/engine/src/cards/card-set-*.json
  2. git commit -m "chore(cards): tag all existing cards as _source: manual"
  3. pnpm import-cards              # upgrades Ravensburger-covered cards
  4. pnpm import-cards-lorcast      # upgrades Lorcast-covered cards
  5. grep '"_source": "manual"' packages/engine/src/cards/*.json  # review remaining
`);
