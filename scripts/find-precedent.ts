#!/usr/bin/env node
// Find card precedents by substring search across all card-set-*.json files.
// Output: file:line — fullName — matched-line excerpt.
//
// Usage:
//   pnpm find-precedent "<substring>"          # search anywhere in JSON
//   pnpm find-precedent --rules "<substring>"  # match only rulesText lines
//   pnpm find-precedent --story "<storyName>"  # match only storyName lines
//   pnpm find-precedent --type "<discriminator>" # match only `"type": "X"` lines (effects/conditions/abilities)
//
// Card-claim discipline: every card name you cite as a precedent must come
// paired with a `file:line` from this tool's output. No bare card-name
// mentions allowed in proposals — see CLAUDE.md "Card-claim discipline."
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const args = process.argv.slice(2);
let mode: "rules" | "story" | "type" | "any" = "any";
let pattern = "";
let oneHitPerCard = true;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--rules") { mode = "rules"; pattern = args[++i] ?? ""; }
  else if (a === "--story") { mode = "story"; pattern = args[++i] ?? ""; }
  else if (a === "--type") { mode = "type"; pattern = args[++i] ?? ""; }
  else if (a === "--all") { oneHitPerCard = false; }
  else if (!pattern) { pattern = a; }
}
if (!pattern) {
  console.error("Usage:");
  console.error("  pnpm find-precedent <substring>          # search anywhere");
  console.error("  pnpm find-precedent --rules <substring>  # match rulesText only");
  console.error("  pnpm find-precedent --story <substring>  # match storyName only");
  console.error("  pnpm find-precedent --type <discriminator>  # match \"type\": \"X\" only");
  console.error("  pnpm find-precedent --all <substring>    # show every hit, not first-per-card");
  process.exit(1);
}

const lower = pattern.toLowerCase();
const files = readdirSync(CARDS_DIR)
  .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
  .sort();

type Hit = { file: string; line: number; fullName: string; excerpt: string };
const hits: Hit[] = [];

for (const f of files) {
  const fp = join(CARDS_DIR, f);
  const lines = readFileSync(fp, "utf-8").split(/\r?\n/);
  let curFullName = "?";
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const m = L.match(/"fullName":\s*"([^"]+)"/);
    if (m) curFullName = m[1];

    if (!L.toLowerCase().includes(lower)) continue;
    if (mode === "rules" && !L.includes("\"rulesText\"")) continue;
    if (mode === "story" && !L.includes("\"storyName\"")) continue;
    if (mode === "type" && !/"type":\s*"/.test(L)) continue;

    hits.push({
      file: f,
      line: i + 1,
      fullName: curFullName,
      excerpt: L.trim().slice(0, 200),
    });
  }
}

// Dedupe to first hit per (file, fullName) when oneHitPerCard.
const seen = new Set<string>();
let printed = 0;
for (const h of hits) {
  const key = `${h.file}:${h.fullName}`;
  if (oneHitPerCard) {
    if (seen.has(key)) continue;
    seen.add(key);
  }
  console.log(`${h.file}:${h.line} — ${h.fullName}`);
  console.log(`  ${h.excerpt}`);
  printed++;
}

const totalCards = oneHitPerCard ? seen.size : printed;
console.log(
  `\n${totalCards} ${oneHitPerCard ? "unique card" : "hit"}${
    totalCards === 1 ? "" : "s"
  } matched "${pattern}"${mode === "any" ? "" : ` (mode: ${mode})`}.`
);
if (oneHitPerCard && hits.length > seen.size) {
  console.log(`  (suppressed ${hits.length - seen.size} additional hits in matched cards; use --all to see them)`);
}
