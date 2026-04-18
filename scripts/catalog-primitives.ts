#!/usr/bin/env node
// =============================================================================
// ENGINE PRIMITIVE CATALOG — auto-generated from source
// -----------------------------------------------------------------------------
// Introspects types/index.ts and reducer.ts to produce a live inventory of
// every effect type, static effect type, trigger event, condition, cost,
// CardTarget variant, DynamicAmount variant, and TimedEffect type currently
// supported by the engine.
//
// Output is FACTS ONLY — no overlap analysis, no recommendations. The reader
// decides what to collapse.
//
// Run:
//   pnpm catalog                  # markdown to stdout
//   pnpm catalog > primitives.md  # save to file
// =============================================================================

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_FILE = join(__dirname, "../packages/engine/src/types/index.ts");
const REDUCER_FILE = join(__dirname, "../packages/engine/src/engine/reducer.ts");
const GAME_MODS_FILE = join(__dirname, "../packages/engine/src/engine/gameModifiers.ts");
const UTILS_FILE = join(__dirname, "../packages/engine/src/utils/index.ts");

const types = readFileSync(TYPES_FILE, "utf-8");
const reducer = readFileSync(REDUCER_FILE, "utf-8");
const gameMods = readFileSync(GAME_MODS_FILE, "utf-8");
const utils = readFileSync(UTILS_FILE, "utf-8");

const typesLines = types.split("\n");
const reducerLines = reducer.split("\n");

// Pre-compute usage counts + first-example from card JSONs
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");
const usageCounts: Record<string, number> = {};
const usageExamples: Record<string, string> = {};
{
  const skip = new Set(["keyword","triggered","activated","static","character","item","action",
    "location","self","opponent","both","count","target_lore","target_damage","target_strength",
    "source_lore","source_strength","cards_under_count","chosen","all","random","this",
    "triggering_card","last_resolved_target","from_last_discarded","target_player"]);
  function walk(node: any, card: any) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((x: any) => walk(x, card)); return; }
    const t = node.type ?? node.on;
    if (typeof t === "string" && t.length > 2 && !skip.has(t)) {
      usageCounts[t] = (usageCounts[t] ?? 0) + 1;
      if (!usageExamples[t]) usageExamples[t] = card.fullName;
    }
    for (const k of Object.keys(node)) walk(node[k], card);
  }
  const { readdirSync: readdir, readFileSync: readFile } = require("fs");
  for (const f of readdir(CARDS_DIR).filter((f: string) => f.startsWith("card-set-") && f.endsWith(".json"))) {
    const cards = JSON.parse(readFile(join(CARDS_DIR, f), "utf-8"));
    for (const c of cards) walk(c, c);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the full text of a `type X = ...;` union declaration, handling
 *  multi-line unions with semicolons inside object variants. Reads from the
 *  declaration start until the next `export` keyword or end of file. */
function extractUnionBlock(source: string, unionName: string): string {
  const lines = source.split("\n");
  const startIdx = lines.findIndex(l => l.match(new RegExp(`(?:export )?type ${unionName}\\s*=`)));
  if (startIdx === -1) return "";
  const parts: string[] = [lines[startIdx]!];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    // Stop at the next export/interface declaration (end of this union)
    if (/^export\s|^\/\/\s*={5,}/.test(l)) break;
    parts.push(l);
  }
  return parts.join("\n");
}

/** Find all string literals in a union that look like discriminators.
 *  Handles both bare `| "literal"` and object `| { type: "literal" }` /
 *  `| { on: "literal" }` shapes. */
function extractUnionLiterals(source: string, unionName: string, field = "type"): string[] {
  const block = extractUnionBlock(source, unionName);
  if (!block) return [];
  const literals: string[] = [];
  // Object discriminators: { type: "X" } or { on: "X" }
  for (const m of block.matchAll(new RegExp(`${field}:\\s*"([a-z_]+)"`, "g"))) {
    literals.push(m[1]!);
  }
  // Bare string literals: | "X"
  for (const m of block.matchAll(/\|\s*"([a-z_]+)"/g)) {
    literals.push(m[1]!);
  }
  return [...new Set(literals)];
}

/** Find case "X": or if (amount === "X") lines in a file */
function findCaseLines(source: string, discriminator: string): number[] {
  const lines = source.split("\n");
  const results: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes(`case "${discriminator}"`) ||
        line.includes(`=== "${discriminator}"`) ||
        line.includes(`on: "${discriminator}"`) ||
        line.includes(`on === "${discriminator}"`)) {
      results.push(i + 1);
    }
  }
  return results;
}

/** Extract extra fields from a union variant line like `{ on: "X"; filter?; defenderFilter? }` */
function extractVariantFields(source: string, unionName: string, discriminator: string, field = "type"): string[] {
  const block = extractUnionBlock(source, unionName);
  if (!block) return [];
  for (const line of block.split("\n")) {
    if (line.includes(`${field}: "${discriminator}"`)) {
      const fields: string[] = [];
      for (const fm of line.matchAll(/(\w+)\??:/g)) {
        if (fm[1] !== field) fields.push(fm[1]!);
      }
      return fields;
    }
  }
  return [];
}

/** Find the interface that declares type: "X" and extract its field names */
function findInterfaceFields(source: string, discriminator: string): { name: string; line: number; fields: string[] } | null {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes(`type: "${discriminator}"`) && !line.trim().startsWith("//") && !line.trim().startsWith("|") && !line.trim().startsWith("*")) {
      // Walk backwards to find the interface name
      for (let j = i; j >= Math.max(0, i - 5); j--) {
        const m = lines[j]!.match(/export interface (\w+)/);
        if (m) {
          // Walk forwards to collect fields
          const fields: string[] = [];
          for (let k = j + 1; k < Math.min(lines.length, j + 30); k++) {
            const fl = lines[k]!.trim();
            if (fl === "}") break;
            const fm = fl.match(/^(\w+)\??:/);
            if (fm && fm[1] !== "type") fields.push(fm[1]!);
          }
          return { name: m[1]!, line: j + 1, fields };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

function section(title: string) {
  console.log(`\n## ${title}\n`);
}

function table(headers: string[], rows: string[][]) {
  console.log("| " + headers.join(" | ") + " |");
  console.log("| " + headers.map(() => "---").join(" | ") + " |");
  for (const row of rows) {
    console.log("| " + row.join(" | ") + " |");
  }
}

console.log("# Engine Primitive Catalog");
console.log(`Generated: ${new Date().toISOString().slice(0, 10)}`);
console.log(`Source: types/index.ts, reducer.ts, gameModifiers.ts, utils/index.ts`);

// 1. Effect types — split into two tables: leaves (direct state mutations)
//    and combinators (higher-order effects that take other Effects as params).
//    The combinator set is a closed list of discriminators whose interfaces
//    contain at least one `Effect` or `Effect[]` field. Updated by hand when
//    a new combinator lands.
const COMBINATOR_DISCRIMINATORS = new Set<string>([
  "sequential",                       // cost → reward (CRD 6.1.5)
  "each_player",                      // quantifier: per-player iteration
  "each_target",                      // quantifier: per-instance iteration
  "choose",                           // selection: player picks one branch
  "self_replacement",                 // selection: default vs instead (CRD 6.5.6)
  "create_floating_trigger",          // deferral: fire on future event
  "create_delayed_trigger",           // deferral: fire at future boundary
  "opponent_chooses_yes_or_no",       // selection: opponent binary pick
  "each_opponent_may_discard_then_reward", // selection w/ reward branch
  "opponent_may_pay_to_avoid",        // selection: opponent accept/reject
  "conditional_on_last_discarded",    // (historic — folded into self_replacement)
  "conditional_on_target",            // (historic — folded into self_replacement)
  "conditional_on_player_state",      // (historic — folded into self_replacement)
]);

function emitEffectTable(label: string, note: string, interfaceNames: string[], predicate: (disc: string) => boolean) {
  section(label);
  if (note) console.log(note + "\n");
  const rows: string[][] = [];
  for (const iface of interfaceNames) {
    const lineIdx = typesLines.findIndex(l => l.includes(`export interface ${iface}`));
    if (lineIdx === -1) continue;
    for (let k = lineIdx; k < Math.min(typesLines.length, lineIdx + 5); k++) {
      const tm = typesLines[k]!.match(/type:\s*"([^"]+)"/);
      if (tm) {
        const disc = tm[1]!;
        if (!predicate(disc)) break;
        const info = findInterfaceFields(types, disc);
        const reducerCases = findCaseLines(reducer, disc);
        const count = usageCounts[disc] ?? 0;
        const example = usageExamples[disc] ?? "—";
        rows.push([
          `\`${disc}\``,
          info ? info.fields.join(", ") : "",
          String(count),
          example,
          `types:${lineIdx + 1}`,
          reducerCases.length > 0 ? reducerCases.map(l => `reducer:${l}`).join(", ") : "—",
        ]);
        break;
      }
    }
  }
  table(["Discriminator", "Fields", "Uses", "Example card", "Type def", "Reducer case(s)"], rows);
}

{
  const unionMatch = types.match(/export type Effect\s*=[\s\S]*?;/);
  if (unionMatch) {
    const interfaceNames = [...unionMatch[0].matchAll(/(\w+Effect)\b/g)].map(m => m[1]!);
    emitEffectTable(
      "Effect Types (Leaf)",
      "Direct state mutations — draw, damage, banish, etc. One effect produces one state change. For higher-order effects that wrap other Effects, see the Combinator Effects section.",
      interfaceNames,
      (disc) => !COMBINATOR_DISCRIMINATORS.has(disc)
    );
    emitEffectTable(
      "Combinator Effects",
      "Higher-order effects: they take one or more Effects as parameters and schedule them under a (possibly rebound) context. Four flavors:\n\n- **Sequence** — `sequential` runs cost → reward in order (CRD 6.1.5).\n- **Quantifier / iteration** — `each_player`, `each_target` distribute inner effects over a set; \"each opponent does X\" / \"for each Y, do Z\".\n- **Selection** — `choose`, `self_replacement`, `opponent_chooses_yes_or_no`, `each_opponent_may_discard_then_reward`, `opponent_may_pay_to_avoid` dispatch between branches.\n- **Deferral** — `create_floating_trigger`, `create_delayed_trigger` schedule inner effects to fire later.\n\nUnlike leaf effects, combinators pass their inner effects through `applyEffect` recursively, sometimes with a rebound `controllingPlayerId` (each_player) or `triggeringCardInstanceId` (each_target).",
      interfaceNames,
      (disc) => COMBINATOR_DISCRIMINATORS.has(disc)
    );
  }
}

// 2. Static effect types
section("Static Effect Types");
{
  const unionMatch = types.match(/export type StaticEffect\s*=[\s\S]*?;/);
  if (unionMatch) {
    const interfaceNames = [...unionMatch[0].matchAll(/(\w+(?:Static|Effect))\b/g)].map(m => m[1]!);
    const rows: string[][] = [];
    const seen = new Set<string>();
    for (const iface of interfaceNames) {
      if (seen.has(iface)) continue;
      seen.add(iface);
      const lineIdx = typesLines.findIndex(l => l.includes(`export interface ${iface}`));
      if (lineIdx === -1) continue;
      for (let k = lineIdx; k < Math.min(typesLines.length, lineIdx + 5); k++) {
        const tm = typesLines[k]!.match(/type:\s*"([^"]+)"/);
        if (tm) {
          const disc = tm[1]!;
          const info = findInterfaceFields(types, disc);
          const modCases = findCaseLines(gameMods, disc);
          const count = usageCounts[disc] ?? 0;
          const example = usageExamples[disc] ?? "—";
          rows.push([
            `\`${disc}\``,
            info ? info.fields.join(", ") : "",
            String(count),
            example,
            `types:${lineIdx + 1}`,
            modCases.length > 0 ? modCases.map(l => `gameMods:${l}`).join(", ") : "—",
          ]);
          break;
        }
      }
    }
    table(["Discriminator", "Fields", "Uses", "Example card", "Type def", "gameModifiers case"], rows);
  }
}

// 3. Trigger events
section("Trigger Events");
{
  const events = extractUnionLiterals(types, "TriggerEvent", "on");
  const rows: string[][] = [];
  for (const ev of events) {
    const fields = extractVariantFields(types, "TriggerEvent", ev, "on");
    const queueLines = findCaseLines(reducer, ev);
    const count = usageCounts[ev] ?? 0;
    const example = usageExamples[ev] ?? "—";
    rows.push([
      `\`${ev}\``,
      fields.length > 0 ? fields.join(", ") : "—",
      String(count),
      example,
    ]);
  }
  table(["Event", "Extra fields", "Uses", "Example card"], rows);
}

// 4. Conditions
section("Conditions");
{
  const conditions = extractUnionLiterals(types, "Condition");
  const rows: string[][] = [];
  for (const t of conditions) {
    const fields = extractVariantFields(types, "Condition", t);
    const evalLine = findCaseLines(utils, t);
    const count = usageCounts[t] ?? 0;
    const example = usageExamples[t] ?? "—";
    rows.push([
      `\`${t}\``,
      fields.length > 0 ? fields.join(", ") : "—",
      String(count),
      example,
    ]);
  }
  table(["Condition", "Fields", "Uses", "Example card"], rows);
}

// 5. DynamicAmount
section("DynamicAmount Variants");
{
  const daMatch = types.match(/export type DynamicAmount\s*=[\s\S]*?;/);
  if (daMatch) {
    const rows: string[][] = [];
    // String literals
    for (const m of daMatch[0].matchAll(/\|\s*"([^"]+)"/g)) {
      // findCaseLines now also matches `=== "X"` which is how resolveDynamicAmount reads these
      const resolverLine = findCaseLines(reducer, m[1]!);
      rows.push([`\`"${m[1]}"\``, "string", resolverLine.length > 0 ? `reducer:${resolverLine[0]}` : "—"]);
    }
    // Object types
    for (const m of daMatch[0].matchAll(/\|\s*\{\s*type:\s*"([^"]+)"/g)) {
      const resolverLine = findCaseLines(reducer, m[1]!);
      rows.push([`\`{ type: "${m[1]}" }\``, "object", resolverLine.length > 0 ? `reducer:${resolverLine[0]}` : "—"]);
    }
    table(["Variant", "Shape", "Resolver line"], rows);
  }
}

// 5b. EffectDuration
section("EffectDuration Variants");
{
  const durations = extractUnionLiterals(types, "EffectDuration");
  console.log("Values: " + durations.map(d => `\`${d}\``).join(" | "));
}

// 6. TimedEffect types
section("TimedEffect Type Variants");
{
  // The TimedEffect.type field is a string union inline on the interface
  const teMatch = types.match(/export interface TimedEffect[\s\S]*?^\}/m);
  if (teMatch) {
    // Find the type: "X" | "Y" | ... line(s)
    const typeLineMatch = teMatch[0].match(/type:\s*([\s\S]*?);/);
    if (typeLineMatch) {
      const variants: string[] = [];
      for (const m of typeLineMatch[1]!.matchAll(/"([a-z_]+)"/g)) {
        variants.push(m[1]!);
      }
      console.log("Union: " + [...new Set(variants)].map(v => `\`${v}\``).join(" | "));
    }
  }
}

// 7. Costs
section("Cost Types");
{
  const costs = extractUnionLiterals(types, "Cost");
  const rows: string[][] = [];
  for (const c of costs) {
    const fields = extractVariantFields(types, "Cost", c);
    rows.push([`\`${c}\``, fields.length > 0 ? fields.join(", ") : "—"]);
  }
  table(["Cost type", "Fields"], rows);
}

// 8. CardTarget
section("CardTarget Variants");
{
  const targets = extractUnionLiterals(types, "CardTarget");
  const rows: string[][] = [];
  for (const t of targets) {
    const fields = extractVariantFields(types, "CardTarget", t);
    rows.push([`\`${t}\``, fields.length > 0 ? fields.join(", ") : "—"]);
  }
  table(["Target type", "Fields"], rows);
}

// 9. GameModifiers fields
section("GameModifiers Fields");
{
  const gmMatch = gameMods.match(/export interface GameModifiers[\s\S]*?^\}/m);
  if (gmMatch) {
    const rows: string[][] = [];
    for (const m of gmMatch[0].matchAll(/^\s+(\w+):\s*(.+?);/gm)) {
      rows.push([`\`${m[1]}\``, m[2]!.trim().slice(0, 80)]);
    }
    table(["Field", "Type (truncated)"], rows);
  }
}

console.log("\n---\n*Run `pnpm catalog` to regenerate.*");
