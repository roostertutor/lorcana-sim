// =============================================================================
// AUDIT: emit-but-never-read StaticEffect primitives
//
// Catches the Hidden Inkcaster class of bug: gameModifiers.ts has a `case "X":`
// that populates `modifiers.<field>`, but no consumer elsewhere reads that
// field — so the primitive silently no-ops. All four existing audits
// (card-status, audit-cards, audit-approximations, decompile-cards) are
// text-shape checks and miss this runtime-handler class.
//
// How it works:
// 1. Scan `packages/engine/src/engine/gameModifiers.ts` for every case block
//    that writes to `modifiers.<field>.(add|set|push|...)`.
// 2. Scan every other .ts (non-test) file under `packages/engine/src/` for
//    reads of `modifiers.<field>.(has|get|size|forEach|values|entries|...)`.
// 3. Flag every field that is written but never read.
//
// Limitations:
// - Heuristic: a reader that uses destructuring (`const { field } = modifiers`)
//   or passes `modifiers` through a helper wouldn't be counted as a direct
//   read. Fine for today — no code in the engine does either pattern.
// - Excludes gameModifiers.ts itself (writer) and types/index.ts (declares
//   the shape but doesn't consume the runtime values).
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ENGINE_SRC = resolve("packages/engine/src");
const GAME_MODIFIERS = join(ENGINE_SRC, "engine", "gameModifiers.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const s = statSync(path);
    if (s.isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

// ── Collect writes from gameModifiers.ts ────────────────────────────────────
// Match: case "<discriminator>": ... modifiers.<field>.<mutator>
// Tolerate anything between the case label and the mutation (nested branches
// / guard clauses). We only care about the pairing.
const modifiersSrc = readFileSync(GAME_MODIFIERS, "utf8");

// Split by case labels first (so one case's writes don't get attributed to
// the next case's label).
interface CaseBlock {
  discriminator: string;
  body: string;
}
const caseBlocks: CaseBlock[] = [];
const labelRe = /case "(\w+)":/g;
let prevIdx = -1;
let prevLabel = "";
let m: RegExpExecArray | null;
while ((m = labelRe.exec(modifiersSrc)) !== null) {
  if (prevIdx >= 0) {
    caseBlocks.push({
      discriminator: prevLabel,
      body: modifiersSrc.slice(prevIdx, m.index),
    });
  }
  prevIdx = m.index + m[0].length;
  prevLabel = m[1]!;
}
if (prevIdx >= 0) {
  caseBlocks.push({
    discriminator: prevLabel,
    body: modifiersSrc.slice(prevIdx),
  });
}

// field -> { discriminators that populate it }
const writes = new Map<string, Set<string>>();
const mutatorRe = /\bmodifiers\.(\w+)\.(add|set|push|delete|clear)\b/g;
for (const { discriminator, body } of caseBlocks) {
  mutatorRe.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = mutatorRe.exec(body)) !== null) {
    const field = hit[1]!;
    if (!writes.has(field)) writes.set(field, new Set());
    writes.get(field)!.add(discriminator);
  }
}

// Also register assignment-style writes: modifiers.field = something
// (e.g. scalar fields without set/add semantics). Covers scalar counters /
// booleans if any are introduced later.
const assignRe = /\bmodifiers\.(\w+)\s*=/g;
for (const { discriminator, body } of caseBlocks) {
  assignRe.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = assignRe.exec(body)) !== null) {
    const field = hit[1]!;
    if (!writes.has(field)) writes.set(field, new Set());
    writes.get(field)!.add(discriminator);
  }
}

// ── Count reads across engine + simulator + analytics + cli + ui ───────────
// UI-only consumers count (e.g. `topOfDeckVisible` is read by GameBoard.tsx
// to render the opponent's top card — that's a legitimate consumer even
// though it's not engine-side rule enforcement).
const SCAN_ROOTS = [
  resolve("packages/engine/src"),
  resolve("packages/simulator/src"),
  resolve("packages/analytics/src"),
  resolve("packages/cli/src"),
  resolve("packages/ui/src"),
].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});

function walkTsxToo(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const s = statSync(path);
    if (s.isDirectory()) out.push(...walkTsxToo(path));
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

const allFiles = SCAN_ROOTS.flatMap(walkTsxToo).filter(
  (f) =>
    !f.endsWith("gameModifiers.ts") &&
    !f.includes("types" + require("node:path").sep + "index.ts") &&
    !f.includes(require("node:path").sep + "dist" + require("node:path").sep),
);

// field -> number of read sites (collapsed across files)
const readers = new Map<string, { count: number; files: Set<string> }>();
for (const field of writes.keys()) {
  readers.set(field, { count: 0, files: new Set() });
}

// Count any reference to the modifier object's field as a read, EXCEPT
// write-shaped tails (`.add(`, `.set(`, `.push(`, `.delete(`, `.clear(`, ` = `).
// Supports:
//   - `modifiers.field` (canonical)
//   - `mods.field` (abbreviated variable name in reducer.ts)
//   - `modifiers?.field` (optional chain in utils/index.ts)
// and read patterns like `for (const x of modifiers.field)`, `modifiers.field[0]`,
// `modifiers.field.size`, helper-argument passes.
// Type-declaration lines like `field?: Type;` never have the `modifiers.` prefix,
// so they don't match the regex — no dedicated filter needed.
const writeSuffixRe = /^\??\.(add|set|push|delete|clear)\b|^\s*=/;
// Variable aliases: reducer.ts binds narrowly-scoped modifier views as
// `drawModifiers`, `epeMods`, `inkMods`, `discardMods`, etc. — same runtime
// object, different variable name for local clarity. Match any identifier
// ending in `Mods` or `Modifiers`, plus bare `modifiers`/`mods`.
const refRe = (field: string) =>
  new RegExp(`\\b(?:\\w*(?:Modifiers|Mods)|modifiers|mods)\\??\\.${field}\\b`, "g");

for (const file of allFiles) {
  const src = readFileSync(file, "utf8");
  for (const field of writes.keys()) {
    const re = refRe(field);
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(src)) !== null) {
      const tail = src.slice(hit.index + hit[0].length, hit.index + hit[0].length + 12);
      if (writeSuffixRe.test(tail)) continue; // write shape
      const entry = readers.get(field)!;
      entry.count++;
      entry.files.add(file);
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
let deadCount = 0;
const rows: { field: string; discriminators: string[]; reads: number; files: number }[] = [];

for (const [field, discriminators] of writes) {
  const reader = readers.get(field)!;
  rows.push({
    field,
    discriminators: [...discriminators],
    reads: reader.count,
    files: reader.files.size,
  });
  if (reader.count === 0) deadCount++;
}

rows.sort((a, b) => a.reads - b.reads || a.field.localeCompare(b.field));

console.log("\nStaticEffect modifier fields — emit vs. read audit");
console.log("─".repeat(76));
console.log(
  "  ".padStart(4) +
    "FIELD".padEnd(30) +
    "DISCRIMINATOR(S)".padEnd(28) +
    "READS",
);
console.log("─".repeat(76));
for (const row of rows) {
  const flag = row.reads === 0 ? "✗" : " ";
  console.log(
    `  ${flag} ` +
      row.field.padEnd(30) +
      row.discriminators.join(", ").padEnd(28) +
      `${row.reads} ` +
      (row.files ? `(in ${row.files} file${row.files === 1 ? "" : "s"})` : "— DEAD"),
  );
}
console.log("─".repeat(76));

if (deadCount > 0) {
  console.log(
    `\n✗ ${deadCount} dead primitive${deadCount === 1 ? "" : "s"} — emitted by gameModifiers.ts but never consumed.`,
  );
  console.log(`  Fix: add a reader in validator.ts / reducer.ts / …, OR remove the case handler.`);
  process.exit(1);
}

console.log(`\n✓ All ${rows.length} StaticEffect modifier fields have at least one reader.`);
