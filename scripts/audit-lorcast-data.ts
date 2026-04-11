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
  cost: number;
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
  kind:
    | "missing_keyword"
    | "missing_value"
    | "missing_scalar"
    /** self_cost_reduction with amount === def.cost — likely should be
     *  grant_play_for_free_self instead. The Pudge / Anna mistake we made
     *  and corrected: a "you can play for free" wording is an alternative
     *  play mode (opt-in), not a forced cost reduction. */
    | "miswired_full_cost_reduction"
    /** rulesText says "gains Shift N" but no grant_shift_self static is
     *  present (and no printed shiftCost either). Anna - Soothing Sister
     *  precedent. */
    | "missing_grant_shift_self"
    /** rulesText says "you can play" / "you may play" / "you can play this
     *  character for free" but no grant_play_for_free_self static is
     *  present. Pudge - Controls the Weather precedent. */
    | "missing_grant_play_for_free_self";
  keyword: string;
  expectedValue?: number;
  actualValue?: number;
  /** For miswired/missing structural checks — short snippet of the
   *  triggering rules-text fragment to make the report self-explanatory. */
  textHint?: string;
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
      // Sing Together and Shift are tracked as REQUIRED scalar fields
      // (singTogetherCost, shiftCost). The engine reads them directly. If
      // the scalar is missing, the rule fizzles even if the keyword ability
      // is present — flag as missing_scalar.
      if (kw === "sing together" || kw === "shift") {
        const scalarField = kw === "sing together" ? card.singTogetherCost : card.shiftCost;
        if (scalarField === expectedValue) continue;
        if (scalarField !== undefined && scalarField !== expectedValue) {
          issues.push({
            setId: card.setId, number: card.number, fullName: card.fullName, id: card.id,
            kind: "missing_scalar", keyword: kw, expectedValue, actualValue: scalarField,
          });
          continue;
        }
        issues.push({
          setId: card.setId, number: card.number, fullName: card.fullName, id: card.id,
          kind: "missing_scalar", keyword: kw, expectedValue,
        });
        continue;
      }
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

    // ----------------------------------------------------------------------
    // Structural checks for static effect-type mismatches.
    // These detect the architectural mistakes corrected during the audit:
    //   - "you can play for free" should be grant_play_for_free_self, not
    //     a self_cost_reduction whose amount equals the card's full cost.
    //   - "this card gains Shift N" should be grant_shift_self, not a
    //     self_cost_reduction.
    // ----------------------------------------------------------------------
    const statics = card.abilities.filter((a) => a.type === "static") as Array<
      { type: "static"; effect?: { type: string; amount?: unknown; value?: unknown } }
    >;

    // Check 1: self_cost_reduction with amount === card.cost (full cost
    // wiped). Likely should be grant_play_for_free_self if the rules text
    // says "you can play" / "you may play" / "play this character for free".
    for (const s of statics) {
      const eff = s.effect;
      if (!eff || eff.type !== "self_cost_reduction") continue;
      if (typeof eff.amount !== "number") continue;
      if (eff.amount < card.cost) continue; // partial reduction — fine
      // Look for a "for free" / "may play" wording on the card to confirm
      // the alt-play interpretation. LeFou-style "this character costs N
      // less" wording is intentionally fine even when N === cost (rare).
      const looksLikeAltPlay =
        /\b(?:can|may) play\b.*\bfor free\b/i.test(text) ||
        /\bplay this (?:character|card) for free\b/i.test(text) ||
        /\bgains? Shift\b/i.test(text);
      if (!looksLikeAltPlay) continue;
      issues.push({
        setId: card.setId, number: card.number, fullName: card.fullName, id: card.id,
        kind: "miswired_full_cost_reduction",
        keyword: "self_cost_reduction",
        expectedValue: card.cost, actualValue: eff.amount,
        textHint: text.slice(0, 80) + (text.length > 80 ? "…" : ""),
      });
    }

    // Check 2: rulesText mentions "gains Shift N" but no grant_shift_self
    // static is present (and the card has no printed shiftCost either).
    const gainsShiftMatch = text.match(/gains? Shift (\d+)/i);
    if (gainsShiftMatch) {
      const expectedValue = parseInt(gainsShiftMatch[1]!, 10);
      const hasGrantShift = statics.some((s) => s.effect?.type === "grant_shift_self");
      if (!hasGrantShift && card.shiftCost === undefined) {
        issues.push({
          setId: card.setId, number: card.number, fullName: card.fullName, id: card.id,
          kind: "missing_grant_shift_self",
          keyword: "grant_shift_self",
          expectedValue,
          textHint: gainsShiftMatch[0],
        });
      }
    }

    // Check 3: rulesText mentions "play THIS character/card for free" —
    // the subject of the free play must be THIS card (not a chosen other
    // card). Catches Pudge / LeFou Opportunistic Flunky pattern. Skips
    // effects that grant a free play of some OTHER card (e.g. "you may
    // play a character with cost 5 or less for free", "play that song
    // again from your discard for free").
    const playForFreeMatch = text.match(
      /(?:you (?:can|may) play this (?:character|card)[^.]{0,40}for free)/i
    );
    if (playForFreeMatch) {
      const hasGrantFree = statics.some((s) => s.effect?.type === "grant_play_for_free_self");
      // If the card already has a self_cost_reduction we'd flag it via
      // check 1; this check fires only when no static at all matches the
      // wording.
      const hasFullReduction = statics.some(
        (s) => s.effect?.type === "self_cost_reduction" && typeof s.effect.amount === "number" && s.effect.amount >= card.cost
      );
      if (!hasGrantFree && !hasFullReduction) {
        issues.push({
          setId: card.setId, number: card.number, fullName: card.fullName, id: card.id,
          kind: "missing_grant_play_for_free_self",
          keyword: "grant_play_for_free_self",
          textHint: playForFreeMatch[0],
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
        i.kind === "missing_value" || i.kind === "miswired_full_cost_reduction"
          ? `expected ${i.expectedValue}${i.actualValue !== undefined ? `, got ${i.actualValue}` : ""}`
          : i.expectedValue !== undefined ? `value ${i.expectedValue}` : "";
      const tail = i.textHint ? `   "${i.textHint}"` : valHint ? `   (${valHint})` : "";
      console.log(`    ${setLabel} ${i.fullName}${tail}`);
    }
    if (group.length > 8) console.log(`    ... and ${group.length - 8} more`);
  }
  console.log(`\nReports cover three families of drift / mis-wiring:`);
  console.log(`  1. Keyword reminder line in rulesText with no matching ability (Lorcast`);
  console.log(`     API drift — see docs/LORCAST_DATA_ISSUES.md).`);
  console.log(`  2. Numeric keyword whose value field doesn't match the rules text, OR`);
  console.log(`     missing required scalar (singTogetherCost / shiftCost).`);
  console.log(`  3. Static effect-type mismatches: self_cost_reduction wiping the full`);
  console.log(`     cost on a "you can play for free" card (should be`);
  console.log(`     grant_play_for_free_self), or "gains Shift N" wording without a`);
  console.log(`     grant_shift_self static. See docs/CARD_WIRING_AUDIT.md rows 6 and 7.`);
}

main();
