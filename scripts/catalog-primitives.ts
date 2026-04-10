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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find all string literals in a union that look like discriminators */
function extractUnionLiterals(source: string, unionName: string): string[] {
  // Match: export type UnionName =\n  | "literal"\n  | "literal"\n...
  const re = new RegExp(`(?:export )?type ${unionName}[\\s\\S]*?;`, "m");
  const match = source.match(re);
  if (!match) return [];
  const literals: string[] = [];
  for (const m of match[0].matchAll(/"([a-z_]+)"/g)) {
    literals.push(m[1]!);
  }
  return [...new Set(literals)];
}

/** Find case "X": lines in a file and return line numbers */
function findCaseLines(source: string, discriminator: string): number[] {
  const lines = source.split("\n");
  const results: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(`case "${discriminator}"`)) {
      results.push(i + 1);
    }
  }
  return results;
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

// 1. Effect types
section("Effect Types");
{
  // Find the Effect union
  const unionMatch = types.match(/export type Effect\s*=[\s\S]*?;/);
  if (unionMatch) {
    const interfaceNames = [...unionMatch[0].matchAll(/(\w+Effect)\b/g)].map(m => m[1]!);
    const rows: string[][] = [];
    for (const iface of interfaceNames) {
      // Find the interface
      const lineIdx = typesLines.findIndex(l => l.includes(`export interface ${iface}`));
      if (lineIdx === -1) continue;
      // Find the type discriminator
      for (let k = lineIdx; k < Math.min(typesLines.length, lineIdx + 5); k++) {
        const tm = typesLines[k]!.match(/type:\s*"([^"]+)"/);
        if (tm) {
          const disc = tm[1]!;
          const info = findInterfaceFields(types, disc);
          const reducerCases = findCaseLines(reducer, disc);
          rows.push([
            `\`${disc}\``,
            info ? info.fields.join(", ") : "",
            `types:${lineIdx + 1}`,
            reducerCases.length > 0 ? reducerCases.map(l => `reducer:${l}`).join(", ") : "—",
          ]);
          break;
        }
      }
    }
    table(["Discriminator", "Fields", "Type def", "Reducer case(s)"], rows);
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
          rows.push([
            `\`${disc}\``,
            info ? info.fields.join(", ") : "",
            `types:${lineIdx + 1}`,
            modCases.length > 0 ? modCases.map(l => `gameMods:${l}`).join(", ") : "—",
          ]);
          break;
        }
      }
    }
    table(["Discriminator", "Fields", "Type def", "gameModifiers case"], rows);
  }
}

// 3. Trigger events
section("Trigger Events");
{
  const triggers = types.match(/export type TriggerEvent\s*=[\s\S]*?;/);
  if (triggers) {
    const rows: string[][] = [];
    for (const m of triggers[0].matchAll(/on:\s*"([^"]+)"(?:;?\s*filter\?)?(?:.*?defenderFilter)?/g)) {
      const ev = m[1]!;
      const hasFilter = m[0].includes("filter");
      const hasDefFilter = m[0].includes("defenderFilter");
      const extras = [hasFilter ? "filter" : "", hasDefFilter ? "defenderFilter" : ""].filter(Boolean);
      rows.push([`\`${ev}\``, extras.join(", ") || "—"]);
    }
    table(["Event", "Optional fields"], rows);
  }
}

// 4. Conditions
section("Conditions");
{
  const condMatch = types.match(/export type Condition\s*=[\s\S]*?;/);
  if (condMatch) {
    const rows: string[][] = [];
    for (const m of condMatch[0].matchAll(/type:\s*"([^"]+)"/g)) {
      const t = m[1]!;
      const evalLine = findCaseLines(utils, t);
      rows.push([`\`${t}\``, evalLine.length > 0 ? `utils:${evalLine[0]}` : "—"]);
    }
    table(["Condition", "evaluateCondition line"], rows);
  }
}

// 5. DynamicAmount
section("DynamicAmount Variants");
{
  const daMatch = types.match(/export type DynamicAmount\s*=[\s\S]*?;/);
  if (daMatch) {
    const rows: string[][] = [];
    // String literals
    for (const m of daMatch[0].matchAll(/\|\s*"([^"]+)"/g)) {
      const resolverLine = findCaseLines(reducer, m[1]!);
      rows.push([`\`"${m[1]}"\``, "string literal", resolverLine.length > 0 ? `reducer:${resolverLine[0]}` : "—"]);
    }
    // Object types
    for (const m of daMatch[0].matchAll(/\|\s*\{\s*type:\s*"([^"]+)"/g)) {
      rows.push([`\`{ type: "${m[1]}" }\``, "object", "—"]);
    }
    table(["Variant", "Shape", "Resolver line"], rows);
  }
}

// 6. TimedEffect types
section("TimedEffect Type Variants");
{
  const teMatch = types.match(/export interface TimedEffect[\s\S]*?^\}/m);
  if (teMatch) {
    const variants: string[] = [];
    for (const m of teMatch[0].matchAll(/"([a-z_]+)"/g)) {
      variants.push(m[1]!);
    }
    console.log("Union: " + [...new Set(variants)].map(v => `\`${v}\``).join(" | "));
  }
}

// 7. Costs
section("Cost Types");
{
  const costMatch = types.match(/export type Cost\s*=[\s\S]*?;/);
  if (costMatch) {
    const rows: string[][] = [];
    for (const m of costMatch[0].matchAll(/type:\s*"([^"]+)"/g)) {
      rows.push([`\`${m[1]}\``]);
    }
    table(["Cost type"], rows);
  }
}

// 8. CardTarget
section("CardTarget Variants");
{
  const ctMatch = types.match(/export type CardTarget\s*=[\s\S]*?;/);
  if (ctMatch) {
    const rows: string[][] = [];
    for (const m of ctMatch[0].matchAll(/type:\s*"([^"]+)"/g)) {
      rows.push([`\`${m[1]}\``]);
    }
    table(["Target type"], rows);
  }
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
