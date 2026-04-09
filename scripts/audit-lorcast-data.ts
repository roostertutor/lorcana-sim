#!/usr/bin/env node
// =============================================================================
// LORCAST DATA AUDIT
// Scans local lorcast-set-*.json files for cards whose rulesText mentions a
// keyword that is NOT present in their abilities array, OR whose numeric
// keyword has no value field. Reports the mismatches so we can:
//   1. Track upstream Lorcast API drift over time.
//   2. Surface importer parsing gaps (Lorcast returns the keyword but our
//      switch doesn't extract its value).
//   3. Decide whether to file an upstream issue or extend our importer.
//
// Run after re-importing or as a periodic check:
//   pnpm tsx scripts/audit-lorcast-data.ts
//   pnpm tsx scripts/audit-lorcast-data.ts --json   (machine-readable)
// =============================================================================

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

interface KeywordAbility {
  type: "keyword";
  keyword: string;
  value?: number;
}

interface CardJSON {
  id: string;
  fullName: string;
  setId: string;
  number: number;
  rarity: string;
  rulesText?: string;
  abilities: ({ type: string } & Record<string, unknown>)[];
  /** Some keywords are tracked as scalar fields rather than as keyword
   *  abilities — Sing Together via singTogetherCost, Shift via shiftCost, etc.
   *  The audit treats these as a satisfied source for the value. */
  shiftCost?: number;
  singTogetherCost?: number;
  moveCost?: number;
}

// Keywords are detected ONLY when they appear as the start of a keyword
// reminder line — i.e. "Keyword (...)" or "Keyword N (...)" — which is the
// CRD format for declaring a keyword on a card. Embedded mentions like "gain
// Resist +1" or "as if they had Evasive" are intentionally NOT flagged
// because those are granted-keyword effects on OTHER cards, not this card.
//
// The check anchors to start-of-line (or after a newline) and requires either
// end-of-string, " (", or "\n" immediately after the keyword/value.

const FLAG_KEYWORDS: Record<string, RegExp> = {
  alert: /(^|\n)Alert(?:\s*\(|\s*$|\n)/,
  evasive: /(^|\n)Evasive(?:\s*\(|\s*$|\n)/,
  ward: /(^|\n)Ward(?:\s*\(|\s*$|\n)/,
  rush: /(^|\n)Rush(?:\s*\(|\s*$|\n)/,
  bodyguard: /(^|\n)Bodyguard(?:\s*\(|\s*$|\n)/,
  reckless: /(^|\n)Reckless(?:\s*\(|\s*$|\n)/,
  support: /(^|\n)Support(?:\s*\(|\s*$|\n)/,
  vanish: /(^|\n)Vanish(?:\s*\(|\s*$|\n)/,
  voiceless: /(^|\n)Voiceless(?:\s*\(|\s*$|\n)/,
};

// Numeric keywords. Same anchoring; the regex captures the value.
const NUMERIC_KEYWORDS: Record<string, RegExp> = {
  challenger: /(?:^|\n)Challenger \+(\d+)(?:\s*\(|\s*$|\n)/,
  resist: /(?:^|\n)Resist \+(\d+)(?:\s*\(|\s*$|\n)/,
  singer: /(?:^|\n)Singer (\d+)(?:\s*\(|\s*$|\n)/,
  shift: /(?:^|\n)Shift (\d+)(?:\s*\(|\s*$|\n)/,
  boost: /(?:^|\n)Boost (\d+)(?:\s*\(|\s*$|\n)/,
  "sing together": /(?:^|\n)Sing Together (\d+)(?:\s*\(|\s*$|\n)/,
};

interface Issue {
  setId: string;
  number: number;
  fullName: string;
  id: string;
  kind: "missing_keyword" | "missing_value";
  keyword: string;
  expectedValue?: number;
  actualValue?: number;
}

function loadCards(): CardJSON[] {
  const out: CardJSON[] = [];
  const files = readdirSync(CARDS_DIR)
    .filter((f) => f.startsWith("lorcast-set-") && f.endsWith(".json"));
  for (const f of files) {
    const cards = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8")) as CardJSON[];
    out.push(...cards);
  }
  return out;
}

function audit(): Issue[] {
  const cards = loadCards();
  const issues: Issue[] = [];

  for (const card of cards) {
    if (!card.rulesText) continue;
    const text = card.rulesText;

    // Skip cards without abilities array (not characters/items/etc).
    if (!Array.isArray(card.abilities)) continue;

    const keywords = new Map<string, KeywordAbility>(
      card.abilities
        .filter((a) => a.type === "keyword")
        .map((a) => [(a as unknown as KeywordAbility).keyword.toLowerCase(), a as unknown as KeywordAbility])
    );

    // Flag-only keywords: only when a keyword reminder line is present.
    for (const [kw, regex] of Object.entries(FLAG_KEYWORDS)) {
      if (!regex.test(text)) continue;
      if (!keywords.has(kw)) {
        issues.push({
          setId: card.setId,
          number: card.number,
          fullName: card.fullName,
          id: card.id,
          kind: "missing_keyword",
          keyword: kw,
        });
      }
    }

    // Numeric keywords: if text has the value, expect the keyword AND its value.
    for (const [kw, regex] of Object.entries(NUMERIC_KEYWORDS)) {
      const m = text.match(regex);
      if (!m) continue;
      const expectedValue = parseInt(m[1]!, 10);
      // Some keywords are tracked as scalar fields on the card definition
      // rather than as a keyword ability. If the scalar field matches the
      // expected value, the card is correctly wired even if the keyword
      // ability is missing.
      const scalarField =
        kw === "sing together" ? card.singTogetherCost
        : kw === "shift" ? card.shiftCost
        : undefined;
      if (scalarField === expectedValue) continue;
      const ability = keywords.get(kw);
      if (!ability) {
        issues.push({
          setId: card.setId,
          number: card.number,
          fullName: card.fullName,
          id: card.id,
          kind: "missing_keyword",
          keyword: kw,
          expectedValue,
        });
      } else if (ability.value === undefined) {
        issues.push({
          setId: card.setId,
          number: card.number,
          fullName: card.fullName,
          id: card.id,
          kind: "missing_value",
          keyword: kw,
          expectedValue,
        });
      } else if (ability.value !== expectedValue) {
        issues.push({
          setId: card.setId,
          number: card.number,
          fullName: card.fullName,
          id: card.id,
          kind: "missing_value",
          keyword: kw,
          expectedValue,
          actualValue: ability.value,
        });
      }
    }
  }
  return issues;
}

function main() {
  const isJson = process.argv.includes("--json");
  const issues = audit();

  if (isJson) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  if (issues.length === 0) {
    console.log("✓ Lorcast data audit clean — no keyword/value mismatches.");
    return;
  }

  // Group by kind, then by keyword
  const byKind = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = `${issue.kind}:${issue.keyword}`;
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key)!.push(issue);
  }

  console.log(`Lorcast data audit — ${issues.length} issue(s) across ${byKind.size} pattern(s):\n`);
  for (const [key, group] of [...byKind.entries()].sort()) {
    console.log(`  ${key}  (${group.length} card${group.length === 1 ? "" : "s"})`);
    for (const i of group.slice(0, 8)) {
      const setLabel = `set-${i.setId.padStart(3, "0")}/${i.number}`.padEnd(14);
      const valHint =
        i.kind === "missing_value"
          ? `expected ${i.expectedValue}${i.actualValue !== undefined ? `, got ${i.actualValue}` : ""}`
          : i.expectedValue !== undefined ? `value ${i.expectedValue}` : "";
      console.log(`    ${setLabel} ${i.fullName}${valHint ? `   (${valHint})` : ""}`);
    }
    if (group.length > 8) console.log(`    ... and ${group.length - 8} more`);
  }
  console.log(`\nReports any keyword mentioned in rulesText that is missing from abilities,`);
  console.log(`or numeric keyword whose value field doesn't match the rules text.`);
  console.log(`The importer's union-merge protects already-correct local data, but new`);
  console.log(`imports of cards we don't have yet still depend on Lorcast being correct.`);
}

main();
