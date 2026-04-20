#!/usr/bin/env node
// =============================================================================
// COMPARE RAVENSBURGER vs LORCAST IMPORT OUTPUT
// One-off diagnostic: for a given set, fetch the Lorcast data, run it through
// the Lorcast importer's normalization logic, and diff the output against the
// stored card-set-N.json (which is Ravensburger-sourced for sets 1-12).
//
// Usage:  pnpm tsx scripts/compare-sources.ts <setNum>   e.g. 1, 2, 12
//
// Verifies that the Lorcast→RB rulesText normalization actually produces the
// same golden-source shape Ravensburger emits. Fields compared:
//   - rulesText (after keyword-line and apostrophe normalization)
//   - abilities keywords
//   - cost / strength / willpower / lore / inkColors / traits / rarity
// Fields skipped (known to diverge by source, not a bug):
//   - _source / imageUrl / foilImageUrl / flavorText / id / _namedAbilityStubs
// =============================================================================

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeRulesText } from "./lib/normalize-rules-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "packages", "engine", "src", "cards");

function lorcastRulesText(c: { text?: string | null }): string | undefined {
  if (!c.text) return undefined;
  const normalized = normalizeRulesText(c.text);
  return normalized || undefined;
}

interface LorcastCard {
  name: string;
  version?: string | null;
  text?: string | null;
  keywords: string[];
  type: string[];
  collector_number: string;
  cost: number;
  strength: number | null;
  willpower: number | null;
  lore: number | null;
  inkwell: boolean;
  ink?: string | null;
  inks?: string[] | null;
  classifications?: string[] | null;
  rarity: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

function normalizeKw(keywords: string[], text: string | null | undefined): string {
  const normalized: string[] = [];
  for (const k of keywords) {
    const name = k.toLowerCase();
    let v: number | undefined;
    if (name === "challenger") { const m = (text ?? "").match(/Challenger \+(\d+)/); v = m ? parseInt(m[1]!, 10) : 1; }
    if (name === "singer") { const m = (text ?? "").match(/Singer (\d+)/); v = m ? parseInt(m[1]!, 10) : 5; }
    if (name === "shift") { const m = (text ?? "").match(/Shift (\d+)/); v = m ? parseInt(m[1]!, 10) : undefined; }
    if (name === "resist") { const m = (text ?? "").match(/Resist \+(\d+)/); v = m ? parseInt(m[1]!, 10) : 1; }
    if (name === "boost") { const m = (text ?? "").match(/Boost (\d+)/); v = m ? parseInt(m[1]!, 10) : 1; }
    normalized.push(name + (v !== undefined ? ":" + v : ""));
  }
  return normalized.sort().join(",");
}

async function main(): Promise<void> {
  const setNum = process.argv[2] ?? "1";
  const allSets = await fetchJson<{ results?: { id: string; code: string }[] } | { id: string; code: string }[]>(
    "https://api.lorcast.com/v0/sets"
  );
  const sets = "results" in allSets ? allSets.results! : allSets;
  const info = sets.find((s) => s.code === setNum);
  if (!info) { console.error(`Lorcast doesn't have set ${setNum}`); process.exit(1); }
  const cardsResp = await fetchJson<{ results?: LorcastCard[] } | LorcastCard[]>(
    `https://api.lorcast.com/v0/sets/${info.id}/cards`
  );
  const lc: LorcastCard[] = "results" in cardsResp ? cardsResp.results! : cardsResp;

  const stored: Record<string, unknown>[] = JSON.parse(
    readFileSync(join(OUT_DIR, `card-set-${setNum}.json`), "utf-8")
  );

  let matches = 0, notInLorcast = 0;
  let rulesTextDiffs = 0, keywordDiffs = 0;
  let rulesTextOnlyApostrophe = 0;
  const sampleDiffs: { name: string; kind: string; stored?: string; lorcast?: string }[] = [];

  for (const s of stored) {
    const num = s["number"] as number;
    const card = lc.find((c) => parseInt(c.collector_number, 10) === num);
    if (!card) { notInLorcast++; continue; }
    matches++;

    const lcText = lorcastRulesText(card);
    const storedText = s["rulesText"] as string | undefined;
    // Also strip trailing whitespace in stored for comparison — matches the
    // Rav importer's post-process (some set-1 songs had trailing spaces).
    const storedNorm = storedText?.replace(/ +\n/g, "\n").replace(/ +$/, "");
    if (lcText !== storedNorm) {
      // Check: is the ONLY difference curly vs straight apostrophe?
      const normalizedStored = storedNorm?.replace(/[\u2018\u2019]/g, "'");
      const normalizedLc = lcText?.replace(/[\u2018\u2019]/g, "'");
      if (normalizedStored === normalizedLc) {
        rulesTextOnlyApostrophe++;
      } else {
        rulesTextDiffs++;
        if (sampleDiffs.filter((d) => d.kind === "rulesText").length < 5) {
          sampleDiffs.push({
            name: s["fullName"] as string,
            kind: "rulesText",
            stored: storedText,
            lorcast: lcText,
          });
        }
      }
    }

    const storedKw = (s["abilities"] as { type: string; keyword?: string; value?: number }[] ?? [])
      .filter((a) => a.type === "keyword")
      .map((a) => a.keyword! + (a.value !== undefined ? ":" + a.value : ""))
      .sort().join(",");
    const lcKw = normalizeKw(card.keywords, card.text);
    if (storedKw !== lcKw) {
      keywordDiffs++;
      if (sampleDiffs.filter((d) => d.kind === "keyword").length < 3) {
        sampleDiffs.push({
          name: s["fullName"] as string,
          kind: "keyword",
          stored: storedKw,
          lorcast: lcKw,
        });
      }
    }
  }

  console.log(`Set ${setNum}: Lorcast-mapped vs stored (Ravensburger-sourced)`);
  console.log(`  Cards in both:                        ${matches}`);
  console.log(`  Stored cards missing from Lorcast:    ${notInLorcast}`);
  console.log(`  rulesText real diffs:                 ${rulesTextDiffs}`);
  console.log(`  rulesText diffs only in apostrophes:  ${rulesTextOnlyApostrophe}  (curly vs straight — cosmetic)`);
  console.log(`  keyword-ability diffs:                ${keywordDiffs}`);
  if (sampleDiffs.length > 0) {
    console.log("\nSample diffs:");
    for (const d of sampleDiffs) {
      console.log(`  [${d.kind}] ${d.name}`);
      console.log(`    stored  : ${JSON.stringify(d.stored)}`);
      console.log(`    lorcast : ${JSON.stringify(d.lorcast)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
