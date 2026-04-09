#!/usr/bin/env node
// =============================================================================
// APPROXIMATION-ANNOTATION AUDIT
// -----------------------------------------------------------------------------
// Scans every card JSON in packages/engine/src/cards/lorcast-set-*.json for
// the parenthetical `(approximation: ...)` annotation that whoever wired the
// card left as a stealth-debt marker. These slip past every other audit:
//   - pnpm card-status counts cards with abilities: [], not stubbed-no-op cards
//   - pnpm audit-lorcast checks Lorcast drift / scalar fields / structural
//     mis-wirings, but has no semantic-correctness check on effect bodies
// so the 57 approximations sat invisibly until the decompiler-diff sweep
// found them by accident in April 2026.
//
// Usage:
//   pnpm audit-approximations              # human-readable, grouped by tier
//   pnpm audit-approximations --json       # machine-readable
//   pnpm audit-approximations --strict     # exit non-zero if any found
//
// CI integration: run with --strict in pre-commit / pre-push to prevent any
// new annotations from landing. The current floor is non-zero so --strict
// will fail until the existing 57 are triaged; use it without --strict as
// a tracker until then.
// =============================================================================

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

interface Annotation {
  setId: string;
  number: number;
  fullName: string;
  id: string;
  /** The annotation text — everything between `approximation:` and the
   *  closing paren. Used for tier classification and the report. */
  note: string;
  /** The full surrounding sentence that contains the annotation, for
   *  context in the report. */
  context: string;
}

function loadAnnotations(): Annotation[] {
  const out: Annotation[] = [];
  const files = readdirSync(CARDS_DIR)
    .filter((f) => f.startsWith("lorcast-set-") && f.endsWith(".json"));
  // Match the parenthetical, capturing the inner note text.
  const re = /\(approximation:\s*([^)]+)\)/i;
  for (const f of files) {
    const cards = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8")) as any[];
    for (const card of cards) {
      // The annotation can hide on any string field — ability rulesText,
      // top-level rulesText, etc. Walk recursively.
      walk(card, card, out, re);
    }
  }
  // Dedupe per (id, note) so reprints don't double-count.
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = a.id + "|" + a.note;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function walk(node: any, card: any, out: Annotation[], re: RegExp): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) walk(x, card, out, re); return; }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === "string") {
      const m = v.match(re);
      if (m) {
        out.push({
          setId: card.setId,
          number: card.number,
          fullName: card.fullName,
          id: card.id,
          note: m[1]!.trim(),
          context: v,
        });
      }
    } else {
      walk(v, card, out, re);
    }
  }
}

// -----------------------------------------------------------------------------
// Tiering — heuristic classification by note text. Used to prioritize the
// fix queue. Tier 1 is the worst (entire effect missing); Tier 2 is usually
// analytics-acceptable (wrong fixed amount); Tier 3 is semantic gating; Tier
// 4 is multiplayer / UX. Cards may match multiple tiers — we pick the first
// hit in priority order.
// -----------------------------------------------------------------------------
type Tier = "T1_HARD_NOOP" | "T2_WRONG_AMOUNT" | "T3_GATING" | "T4_MULTIPLAYER" | "T5_OTHER";

function classify(note: string): Tier {
  const n = note.toLowerCase();
  // Tier 1 — entire effect missing or replaced
  if (/\bno-op\b/.test(n)) return "T1_HARD_NOOP";
  if (/\bnot wired\b/.test(n)) return "T1_HARD_NOOP";
  if (/\bdropped\b/.test(n)) return "T1_HARD_NOOP";
  if (/\bskipped\b/.test(n)) return "T1_HARD_NOOP";
  if (/\bmissing\b/.test(n)) return "T1_HARD_NOOP";
  // Tier 4 — multiplayer / UX
  if (/\b2p\b|\b3\+p\b|\bmultiplayer\b|\bprompted twice\b/.test(n)) return "T4_MULTIPLAYER";
  // Tier 2 — wrong fixed amount / fixed substitution
  if (/\bfixed\b|\bflat\b|always|unconditional/.test(n)) return "T2_WRONG_AMOUNT";
  // Tier 3 — semantic gating / wrong condition
  if (/\bonly\b|conditional|gate|unless/.test(n)) return "T3_GATING";
  return "T5_OTHER";
}

const TIER_LABELS: Record<Tier, string> = {
  T1_HARD_NOOP:    "Tier 1 — hard no-op (effect missing entirely)",
  T2_WRONG_AMOUNT: "Tier 2 — wrong amount (often analytics-acceptable)",
  T3_GATING:       "Tier 3 — wrong gating (semantic correctness)",
  T4_MULTIPLAYER:  "Tier 4 — multiplayer / UX bug",
  T5_OTHER:        "Tier 5 — other / needs triage",
};

const TIER_ORDER: Tier[] = ["T1_HARD_NOOP", "T3_GATING", "T4_MULTIPLAYER", "T5_OTHER", "T2_WRONG_AMOUNT"];

function main() {
  const isJson = process.argv.includes("--json");
  const isStrict = process.argv.includes("--strict");
  const annotations = loadAnnotations();

  if (isJson) {
    const tagged = annotations.map((a) => ({ ...a, tier: classify(a.note) }));
    console.log(JSON.stringify(tagged, null, 2));
    process.exit(isStrict && annotations.length > 0 ? 1 : 0);
  }

  if (annotations.length === 0) {
    console.log("✓ Approximation audit clean — no `(approximation: ...)` annotations found.");
    return;
  }

  // Group by tier.
  const byTier = new Map<Tier, Annotation[]>();
  for (const a of annotations) {
    const t = classify(a.note);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(a);
  }

  console.log(`Approximation audit — ${annotations.length} card(s) carrying \`(approximation: ...)\` annotations:\n`);
  for (const tier of TIER_ORDER) {
    const group = byTier.get(tier);
    if (!group || group.length === 0) continue;
    console.log(`${TIER_LABELS[tier]}  (${group.length} card${group.length === 1 ? "" : "s"})`);
    group.sort((a, b) => (a.setId + a.number).localeCompare(b.setId + b.number));
    for (const a of group) {
      const setLabel = `set-${a.setId.padStart(3, "0")}/${a.number}`.padEnd(14);
      console.log(`  ${setLabel} ${a.fullName}`);
      console.log(`    "${a.note}"`);
    }
    console.log();
  }

  console.log("These annotations are stealth-debt: they slip past `pnpm card-status` and");
  console.log("`pnpm audit-lorcast` because they look like complete wirings. Triage by tier");
  console.log("and fix; do NOT introduce new annotations. See CLAUDE.md \"Critical bug patterns\".");

  if (isStrict) process.exit(1);
}

main();
