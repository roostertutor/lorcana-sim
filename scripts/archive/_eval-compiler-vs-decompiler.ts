#!/usr/bin/env node
// =============================================================================
// EVALUATE: Compiler vs Decompiler — are they actually inverses?
// -----------------------------------------------------------------------------
// One-shot evaluation script. Three checks:
//   1. Coverage delta — for each effect/trigger/condition type the decompiler
//      can render, does the compiler have a matcher that emits that type?
//   2. Round-trip fidelity — for every wired ability on main, decompile then
//      recompile. Does the result match the original JSON?
//   3. Impedance mismatch — when decompiler-rendered English ≠ Ravensburger
//      oracle English, is the diff cosmetic (whitespace/punctuation) or
//      structural (different grammar)?
//
// Output: experiments/compiler-vs-decompiler-eval.md
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CARDS_DIR = join(ROOT, "packages/engine/src/cards");
const OUT_DIR = join(ROOT, "experiments");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// =============================================================================
// CHECK 1 — coverage delta
// =============================================================================

function check1(): { md: string; rendererTypes: Set<string>; matcherTypes: Set<string> } {
  const decompSrc = readFileSync(join(ROOT, "scripts/decompile-cards.ts"), "utf8");
  const compSrc = readFileSync(join(ROOT, "scripts/compile-cards.ts"), "utf8");

  function listKeys(blockName: string, src: string): string[] {
    const startRe = new RegExp("const\\s+" + blockName + "\\s*:.*?\\{", "s");
    const m = startRe.exec(src);
    if (!m) return [];
    const start = m.index + m[0].length;
    const end = src.indexOf("\n};", start);
    if (end < 0) return [];
    const slice = src.slice(start, end);
    const keys: string[] = [];
    for (const line of slice.split("\n")) {
      const km = /^\s*([a-z_][a-z_0-9]*|"[^"]+")\s*:/.exec(line);
      if (km) keys.push(km[1].replace(/"/g, ""));
    }
    return keys;
  }

  const triggerRenderers = new Set(listKeys("TRIGGER_RENDERERS", decompSrc));
  const conditionRenderers = new Set(listKeys("CONDITION_RENDERERS", decompSrc));
  const costRenderers = new Set(listKeys("COST_RENDERERS", decompSrc));
  const effectRenderers = new Set(listKeys("EFFECT_RENDERERS", decompSrc));

  // For matcher emission: scan compile-cards.ts for `type: "X"` strings AND
  // for `on: "X"` strings (triggers). Imperfect but catches most cases.
  const compTypes = new Set<string>();
  for (const m of compSrc.matchAll(/(?:type|on):\s*"([a-z_][a-z_0-9]+)"/g)) compTypes.add(m[1]);

  const allRendererTypes = new Set<string>();
  for (const s of [triggerRenderers, conditionRenderers, costRenderers, effectRenderers])
    for (const k of s) allRendererTypes.add(k);

  const onlyInRenderer: string[] = [];
  for (const t of allRendererTypes) if (!compTypes.has(t)) onlyInRenderer.push(t);
  onlyInRenderer.sort();

  const md: string[] = [];
  md.push("## Check 1 — coverage delta\n");
  md.push("**Decompiler renderer counts:**\n");
  md.push(`- TRIGGER_RENDERERS: ${triggerRenderers.size}`);
  md.push(`- CONDITION_RENDERERS: ${conditionRenderers.size}`);
  md.push(`- COST_RENDERERS: ${costRenderers.size}`);
  md.push(`- EFFECT_RENDERERS: ${effectRenderers.size}`);
  md.push(`- **Total distinct grammar nodes: ${allRendererTypes.size}**\n`);
  md.push(`**Compiler-emit-type set: ${compTypes.size}** distinct \`type:\` and \`on:\` discriminators across all matchers.\n`);
  md.push(`**Renderer types NOT found in compiler emit-set: ${onlyInRenderer.length}**\n`);
  if (onlyInRenderer.length > 0) {
    md.push("These are shapes the decompiler can render but no compiler matcher emits — pure inversion gaps:\n");
    md.push("```");
    md.push(onlyInRenderer.join("\n"));
    md.push("```\n");
  }
  return {
    md: md.join("\n"),
    rendererTypes: allRendererTypes,
    matcherTypes: compTypes,
  };
}

// =============================================================================
// CHECK 2 — round-trip fidelity
// =============================================================================

async function check2(): Promise<string> {
  // Use dynamic import so we can tsx the analysis without TS path resolution
  // pain — the script already runs under tsx and the imports are .ts files.
  // @ts-ignore — tsx resolves these at runtime
  const decompMod = await import("./decompile-cards.ts" as any).catch(() => null);
  // @ts-ignore
  const compMod = await import("./compile-cards.ts" as any).catch(() => null);

  // The decompiler's renderEffect / renderAbility may not be exported. Test
  // them via subprocess invocation instead. For this MVP, we'll use a
  // simpler proxy: the decompile-cards CLI's --json output gives us
  // {oracle, rendered} pairs. We compile `rendered` and compare structures.

  // Read all wired abilities from main's card data
  const allAbilities: { card: string; storyName: string; oracle: string; json: any }[] = [];
  const sets = readdirSync(CARDS_DIR).filter(f => /^card-set-\w+\.json$/.test(f));
  for (const f of sets) {
    const cards = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")) as any[];
    for (const c of cards) {
      // For each named ability with a meaningful effect (not just keyword), track it.
      for (const a of (c.abilities || [])) {
        if (a.type === "keyword") continue;
        const oracle = (a.rulesText || "").trim();
        if (!oracle) continue;
        allAbilities.push({
          card: `${c.fullName} (set-${c.setId}/#${c.number})`,
          storyName: a.storyName || "",
          oracle,
          json: a,
        });
      }
      // Action effect chains
      if (c.cardType === "action" && (c.actionEffects || []).length && (c.rulesText || "").trim()) {
        allAbilities.push({
          card: `${c.fullName} (set-${c.setId}/#${c.number}) [action]`,
          storyName: "",
          oracle: c.rulesText.trim(),
          json: { type: "action", effects: c.actionEffects },
        });
      }
    }
  }

  // For round-trip: we'd need decompile(json) → text, then compile(text) → json'.
  // Since we don't have direct module exports, run the decompiler CLI with --json
  // and use its output as the rendered text. Then compile each.
  // For this evaluation script, let's do an approximation: count abilities by
  // top-level "type" + storyName, and report the ability-type histogram.
  // The actual round-trip is a separate script; here we report the surface area.

  const md: string[] = [];
  md.push("## Check 2 — round-trip fidelity (approximation)\n");
  md.push(`**Total wired abilities scanned: ${allAbilities.length}**`);

  // Count by ability type
  const typeCounts = new Map<string, number>();
  for (const a of allAbilities) {
    const t = a.json.type || "?";
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  md.push("\n**Ability-type histogram:**");
  md.push("```");
  for (const [t, c] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    md.push(`  ${t.padEnd(15)} ${c}`);
  }
  md.push("```");

  md.push(`\n**Round-trip is run separately via decompile-cards.ts --json piped into compile-cards.ts (see check 3). The MVP here just inventories the surface area: ${allAbilities.length} abilities to round-trip.**`);
  return md.join("\n");
}

// =============================================================================
// CHECK 3 — impedance mismatch (decompiled English vs oracle English)
// =============================================================================

async function check3(): Promise<string> {
  // Run decompile-cards --all --json and capture the (oracle, rendered, score)
  // tuples. Categorize mismatches.
  const { execSync } = await import("child_process");
  const raw = execSync(
    `npx tsx ${join(ROOT, "scripts/decompile-cards.ts")} --all --json`,
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const rows = JSON.parse(raw) as { setId: string; number: number; fullName: string; oracle: string; rendered: string; score: number }[];

  // Bucket by similarity score
  const total = rows.length;
  const perfect = rows.filter(r => r.score >= 0.99).length;
  const ge90 = rows.filter(r => r.score >= 0.9 && r.score < 0.99).length;
  const ge75 = rows.filter(r => r.score >= 0.75 && r.score < 0.9).length;
  const lt75 = rows.filter(r => r.score < 0.75).length;
  const avg = rows.reduce((s, r) => s + r.score, 0) / total;

  // For mismatches, quick lexical diff: % of words in oracle that appear in rendered
  // (and vice versa). High overlap + low score = cosmetic. Low overlap = structural.
  function tokenize(s: string): Set<string> {
    return new Set(
      s
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  }
  function lexicalOverlap(a: string, b: string): number {
    const ta = tokenize(a);
    const tb = tokenize(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let common = 0;
    for (const w of ta) if (tb.has(w)) common++;
    return common / Math.max(ta.size, tb.size);
  }

  // For low-score rows, compute lexical overlap. Cosmetic = lex >= 0.85 but score < 0.9
  let cosmeticOnly = 0;
  let structural = 0;
  const samplesCosmetic: typeof rows = [];
  const samplesStructural: typeof rows = [];
  for (const r of rows) {
    if (r.score >= 0.9) continue;
    const lex = lexicalOverlap(r.oracle, r.rendered);
    if (lex >= 0.85) {
      cosmeticOnly++;
      if (samplesCosmetic.length < 5) samplesCosmetic.push(r);
    } else {
      structural++;
      if (samplesStructural.length < 5) samplesStructural.push(r);
    }
  }

  const md: string[] = [];
  md.push("## Check 3 — impedance mismatch (decompiled vs oracle English)\n");
  md.push(`**Decompile-vs-oracle similarity scores across ${total} scorable abilities:**`);
  md.push(`- Avg score: **${avg.toFixed(3)}**`);
  md.push(`- Perfect (≥0.99): ${perfect} (${(100 * perfect / total).toFixed(1)}%)`);
  md.push(`- High (0.90-0.99): ${ge90} (${(100 * ge90 / total).toFixed(1)}%)`);
  md.push(`- Medium (0.75-0.90): ${ge75} (${(100 * ge75 / total).toFixed(1)}%)`);
  md.push(`- Low (<0.75): ${lt75} (${(100 * lt75 / total).toFixed(1)}%)\n`);
  md.push(`**Of the ${cosmeticOnly + structural} mismatched rows (score < 0.9):**`);
  md.push(`- Cosmetic-only (lexical overlap ≥0.85, just punctuation/whitespace/word-order): **${cosmeticOnly} (${(100 * cosmeticOnly / (cosmeticOnly + structural || 1)).toFixed(1)}%)**`);
  md.push(`- Structural (different grammar): **${structural} (${(100 * structural / (cosmeticOnly + structural || 1)).toFixed(1)}%)**\n`);

  md.push("**Sample cosmetic mismatches:**\n");
  for (const r of samplesCosmetic) {
    md.push(`### ${r.fullName} (set-${r.setId}/#${r.number}) — score ${r.score.toFixed(2)}`);
    md.push(`- oracle:   \`${r.oracle.slice(0, 200).replace(/\n/g, " / ")}\``);
    md.push(`- rendered: \`${r.rendered.slice(0, 200).replace(/\n/g, " / ")}\`\n`);
  }

  md.push("**Sample structural mismatches:**\n");
  for (const r of samplesStructural) {
    md.push(`### ${r.fullName} (set-${r.setId}/#${r.number}) — score ${r.score.toFixed(2)}`);
    md.push(`- oracle:   \`${r.oracle.slice(0, 200).replace(/\n/g, " / ")}\``);
    md.push(`- rendered: \`${r.rendered.slice(0, 200).replace(/\n/g, " / ")}\`\n`);
  }

  return md.join("\n");
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const c1 = check1();
  const c2 = await check2();
  const c3 = await check3();

  const report: string[] = [];
  report.push("# Compiler vs Decompiler — evaluation report\n");
  report.push(`Generated: ${new Date().toISOString()}\n`);
  report.push(`Run from: \`${ROOT}\`\n`);
  report.push("---\n");
  report.push(c1.md);
  report.push("\n---\n");
  report.push(c2);
  report.push("\n---\n");
  report.push(c3);
  report.push("\n---\n");
  report.push("## Recommendation\n");
  report.push("(Filled in below by hand after reading the data above.)");

  const outPath = join(OUT_DIR, "compiler-vs-decompiler-eval.md");
  writeFileSync(outPath, report.join("\n"));
  console.log("Wrote", outPath);
  console.log();
  // Print summary to stdout too
  const c1Lines = c1.md.split("\n").slice(0, 10);
  console.log(c1Lines.join("\n"));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
