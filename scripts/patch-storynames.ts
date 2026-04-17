#!/usr/bin/env node
// =============================================================================
// One-time storyName patch for the Ravensburger migration.
//
// User verified 20 cards where the existing abilities[*].storyName was a
// paraphrased storyName (generated heuristically from rules text, not from the
// actual printed card). This script updates those storyName fields to match
// the authoritative printed card names — same values Ravensburger's API
// provides, so card-status audit passes on next import.
// =============================================================================

import { writeFileSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "packages/engine/src/cards");

interface Rename { slug: string; oldName: string; newName: string; note?: string }

const RENAMES: Rename[] = [
  // From the user's verification pass (Apr 2026)
  { slug: "madam-mim-tiny-adversary",            oldName: "ZIM ZABBERIM ZIM",                              newName: "ZIM ZABBERIM BIM" },
  { slug: "jim-hawkins-rigging-specialist",      oldName: "BATTLE STATION",                                newName: "BATTLE STATIONS" },
  { slug: "nick-wilde-sly-fox",                  oldName: "CAN'T TOUCH ME",                                newName: "YOU CAN'T TOUCH ME" },
  { slug: "bagheera-guardian-jaguar",            oldName: "YOU MUST BE BRAVE",                             newName: "YOU'VE GOT TO BE BRAVE" },
  { slug: "flash-records-specialist",            oldName: "HOLD... YOUR HORSES",                           newName: "HOLD...YOUR HORSES" },
  { slug: "scar-heartless-hunter",               oldName: "BARED TEETH",                                   newName: "TEETH AND AMBITIONS" },
  { slug: "sugar-rush-speedway-finish-line",     oldName: "BRING IT HOME, LITTLE ONE!",                    newName: "BRING IT HOME, KID!" },
  { slug: "the-white-rose-jewel-of-the-garden",  oldName: "THE BEAUTY OF THE WORLD",                       newName: "A WEALTH OF HAPPINESS" },
  { slug: "genie-wish-fulfilled",                oldName: "WHAT HAPPENS NOW?",                             newName: "WHAT COMES NEXT?" },
  { slug: "gazelle-angel-with-horns",            oldName: "YOU ARE A REALLY HOT DANCER",                   newName: "YOU CAN REALLY MOVE" },
  { slug: "john-silver-ferocious-friend",        oldName: "YOU HAVE TO CHART YOUR OWN COURSE",             newName: "CHART YOUR OWN COURSE" },
  { slug: "gold-coin",                           oldName: "GLITTERING ACCESS",                             newName: "SPARKLY ACCESS" },
  { slug: "kakamora-pirate-chief",               oldName: "COCONUT LEADER",                                newName: "HEAD COCONUT" },
  { slug: "jim-hawkins-stubborn-cabin-boy",      oldName: "COME HERE, COME HERE, COME HERE!",              newName: "COME ON, COME ON, COME ON!" },
  { slug: "pluto-guard-dog",                     oldName: "BRAVO",                                         newName: "GOOD BOY" },
  { slug: "mickey-mouse-night-watch",            oldName: "SUPPORT",                                       newName: "BACKUP" },
  { slug: "jafar-power-hungry-vizier",           oldName: "YOU WILL BE PAID WHEN THE TIME COMES",          newName: "YOU'LL GET WHAT'S COMING TO YOU" },
  { slug: "chip-quick-thinker",                  oldName: "THINK QUICK",                                   newName: "I'LL HANDLE THIS" },
  { slug: "lumiere-fired-up",                    oldName: "FIRED UP",                                      newName: "SACREBLEU!" },
  { slug: "kristoff-mining-the-ruins",           oldName: "DIG DEEP",                                      newName: "WORTH MINING" },
  // Mama Odie: both sources wrong. Manual canonical form.
  { slug: "mama-odie-solitary-sage",             oldName: "I HAVE TO DO EVERYTHING AROUND HERE",           newName: "I'VE GOT TO DO EVERYTHING AROUND HERE" },
];

let totalPatched = 0;
const missedRenames: Rename[] = [];

for (const file of readdirSync(OUT_DIR).filter((f) => /^card-set-.*\.json$/.test(f))) {
  const path = join(OUT_DIR, file);
  const cards = JSON.parse(readFileSync(path, "utf8")) as Array<{
    id: string;
    abilities?: Array<{ storyName?: string }>;
  }>;
  let patchedInSet = 0;
  for (const card of cards) {
    const renames = RENAMES.filter((r) => r.slug === card.id);
    if (!renames.length) continue;
    for (const ability of card.abilities ?? []) {
      if (!ability.storyName) continue;
      const match = renames.find((r) => r.oldName === ability.storyName);
      if (match) {
        ability.storyName = match.newName;
        patchedInSet++;
      }
    }
  }
  if (patchedInSet > 0) {
    writeFileSync(path, JSON.stringify(cards, null, 2), "utf8");
    console.log(`  ${file.padEnd(24)} patched ${patchedInSet} storyName(s)`);
    totalPatched += patchedInSet;
  }
}

// Report any renames that didn't find their card
const patchedSlugs = new Set<string>();
for (const file of readdirSync(OUT_DIR).filter((f) => /^card-set-.*\.json$/.test(f))) {
  const cards = JSON.parse(readFileSync(join(OUT_DIR, file), "utf8")) as Array<{
    id: string;
    abilities?: Array<{ storyName?: string }>;
  }>;
  for (const card of cards) {
    for (const r of RENAMES) {
      if (r.slug === card.id && (card.abilities ?? []).some((a) => a.storyName === r.newName)) {
        patchedSlugs.add(r.slug + "|" + r.newName);
      }
    }
  }
}
for (const r of RENAMES) {
  if (!patchedSlugs.has(r.slug + "|" + r.newName)) missedRenames.push(r);
}
if (missedRenames.length) {
  console.log(`\n  ${missedRenames.length} rename(s) did NOT find their target (slug or old name mismatch):`);
  for (const r of missedRenames) {
    console.log(`    ${r.slug} : "${r.oldName}"`);
  }
}

console.log(`\nTotal storyName patches applied: ${totalPatched}`);
