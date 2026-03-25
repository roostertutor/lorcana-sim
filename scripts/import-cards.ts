#!/usr/bin/env node
// =============================================================================
// LORCAST CARD IMPORTER
// Fetches card data from https://api.lorcast.com/v0 and generates:
//   packages/engine/src/cards/lorcast-cards.json   — CardDefinition array
//   packages/engine/src/cards/lorcastCards.ts       — TS module that exports it
//
// Usage:
//   pnpm import-cards                  fetch all sets
//   pnpm import-cards --sets 1,2,3     fetch specific sets by code
//   pnpm import-cards --sets 1 --dry   dry run, print output instead of writing
//
// Rate limit: 100ms between requests per Lorcast docs.
// =============================================================================

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "packages/engine/src/cards");
const OUT_JSON = join(OUT_DIR, "lorcast-cards.json");
const OUT_TS = join(OUT_DIR, "lorcastCards.ts");

const API_BASE = "https://api.lorcast.com/v0";
const RATE_LIMIT_MS = 110; // slightly over 100ms to be safe

// =============================================================================
// LORCAST API TYPES (subset we use)
// =============================================================================

interface LorcastCard {
  id: string;
  name: string;
  version: string | null;
  layout: string;
  collector_number: string;
  cost: number;
  inkwell: boolean;
  ink: string | null;
  type: string[];
  classifications: string[] | null;
  text: string | null;
  keywords: string[];
  move_cost: number | null;
  strength: number | null;
  willpower: number | null;
  lore: number | null;
  rarity: string;
  flavor_text: string | null;
  set: { id: string; code: string; name: string };
  image_uris: { digital: { small: string; normal: string; large: string } } | null;
}

interface LorcastSet {
  id: string;
  name: string;
  code: string;
  released_at: string;
}

// =============================================================================
// OUR OUTPUT TYPE (matches packages/engine/src/types/index.ts)
// Using plain objects — no imports needed in this script.
// =============================================================================

interface KeywordAbility {
  type: "keyword";
  keyword: string;
  value?: number;
}

interface CardDefinitionOut {
  id: string;
  name: string;
  subtitle?: string;
  fullName: string;
  cardType: "character" | "action" | "item" | "location";
  inkColor: "amber" | "amethyst" | "emerald" | "ruby" | "sapphire" | "steel";
  cost: number;
  inkable: boolean;
  traits: string[];
  strength?: number;
  willpower?: number;
  lore?: number;
  shiftCost?: number;
  abilities: KeywordAbility[]; // named abilities left as stubs (empty)
  flavorText?: string;
  setId: string;
  number: number;
  rarity: "common" | "uncommon" | "rare" | "super_rare" | "legendary" | "enchanted";
  // Extra field written to JSON, stripped in lorcastCards.ts
  _namedAbilityStubs?: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

function slugify(name: string, version: string | null): string {
  const raw = version ? `${name} ${version}` : name;
  return raw
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapCardType(types: string[]): CardDefinitionOut["cardType"] {
  const first = (types[0] ?? "").toLowerCase();
  if (first === "character") return "character";
  if (first === "item") return "item";
  if (first === "location") return "location";
  return "action"; // Action + Song both → action
}

function mapInkColor(ink: string | null): CardDefinitionOut["inkColor"] | null {
  if (!ink) return null;
  const map: Record<string, CardDefinitionOut["inkColor"]> = {
    amber: "amber",
    amethyst: "amethyst",
    emerald: "emerald",
    ruby: "ruby",
    sapphire: "sapphire",
    steel: "steel",
  };
  return map[ink.toLowerCase()] ?? null;
}

function mapRarity(r: string): CardDefinitionOut["rarity"] {
  const map: Record<string, CardDefinitionOut["rarity"]> = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    super_rare: "super_rare",
    legendary: "legendary",
    enchanted: "enchanted",
    promo: "common",
  };
  return map[r.toLowerCase()] ?? "common";
}

// Keywords whose text line starts with the keyword name (not all-caps ability name)
const KEYWORD_LINE_PREFIXES = [
  "Singer", "Shift", "Challenger", "Bodyguard", "Rush", "Evasive",
  "Ward", "Support", "Reckless", "Resist",
];

function parseKeywordAbilities(
  lorcastKeywords: string[],
  text: string | null
): { abilities: KeywordAbility[]; shiftCost: number | undefined } {
  const abilities: KeywordAbility[] = [];
  let shiftCost: number | undefined;

  for (const kw of lorcastKeywords) {
    const k = kw.toLowerCase();
    switch (k) {
      case "rush":       abilities.push({ type: "keyword", keyword: "rush" }); break;
      case "evasive":    abilities.push({ type: "keyword", keyword: "evasive" }); break;
      case "bodyguard":  abilities.push({ type: "keyword", keyword: "bodyguard" }); break;
      case "ward":       abilities.push({ type: "keyword", keyword: "ward" }); break;
      case "reckless":   abilities.push({ type: "keyword", keyword: "reckless" }); break;
      case "support":    abilities.push({ type: "keyword", keyword: "support" }); break;
      case "challenger": {
        const m = text?.match(/Challenger \+(\d+)/);
        abilities.push({ type: "keyword", keyword: "challenger", value: m ? parseInt(m[1]!) : 1 });
        break;
      }
      case "singer": {
        const m = text?.match(/Singer (\d+)/);
        abilities.push({ type: "keyword", keyword: "singer", value: m ? parseInt(m[1]!) : 5 });
        break;
      }
      case "shift": {
        const m = text?.match(/Shift (\d+)/);
        shiftCost = m ? parseInt(m[1]!) : undefined;
        if (shiftCost !== undefined) {
          abilities.push({ type: "keyword", keyword: "shift", value: shiftCost });
        }
        break;
      }
      case "resist": {
        const m = text?.match(/Resist \+(\d+)/);
        abilities.push({ type: "keyword", keyword: "resist", value: m ? parseInt(m[1]!) : 1 });
        break;
      }
      // Unknown keyword — record as-is for awareness
      default:
        abilities.push({ type: "keyword", keyword: k });
    }
  }

  return { abilities, shiftCost };
}

/** Find lines in the card text that are named abilities (ALL-CAPS ability names). */
function detectNamedAbilityLines(text: string | null): string[] {
  if (!text) return [];
  const stubs: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip keyword reminder lines (start with a known keyword word)
    const isKeywordLine = KEYWORD_LINE_PREFIXES.some((kw) =>
      line.startsWith(kw)
    );
    if (isKeywordLine) continue;

    // Named abilities have an all-caps title (e.g. "I SUMMON THEE", "MIRROR, MIRROR").
    // Take text before the first separator (em-dash, hyphen, or open-paren),
    // trim it, and check that it's entirely uppercase letters/spaces/punctuation.
    // This catches single-word names like "I" that the old ^[A-Z]{2} regex missed.
    const titlePart = line.split(/\s[–—-]\s|\s*\(/)[0]!.trim();
    if (
      titlePart.length > 0 &&
      titlePart === titlePart.toUpperCase() &&
      /[A-Z]/.test(titlePart)
    ) {
      stubs.push(line);
    }
  }

  return stubs;
}

// =============================================================================
// CARD MAPPER
// =============================================================================

function mapCard(c: LorcastCard): CardDefinitionOut | null {
  const inkColor = mapInkColor(c.ink);
  // Skip colorless/future dual-ink cards we can't represent yet
  if (!inkColor) return null;

  const { abilities, shiftCost } = parseKeywordAbilities(c.keywords, c.text);
  const namedStubs = detectNamedAbilityLines(c.text);

  const out: CardDefinitionOut = {
    id: slugify(c.name, c.version),
    name: c.name,
    fullName: c.version ? `${c.name} - ${c.version}` : c.name,
    cardType: mapCardType(c.type),
    inkColor,
    cost: c.cost,
    inkable: c.inkwell,
    traits: c.classifications ?? [],
    abilities,
    setId: c.set.code,
    number: parseInt(c.collector_number, 10) || 0,
    rarity: mapRarity(c.rarity),
  };

  if (c.version) out.subtitle = c.version;
  if (c.strength !== null) out.strength = c.strength;
  if (c.willpower !== null) out.willpower = c.willpower;
  if (c.lore !== null) out.lore = c.lore;
  if (shiftCost !== undefined) out.shiftCost = shiftCost;
  if (c.flavor_text) out.flavorText = c.flavor_text;
  if (namedStubs.length > 0) out._namedAbilityStubs = namedStubs;

  return out;
}

// =============================================================================
// TS MODULE GENERATOR
// =============================================================================

function generateTsModule(): string {
  return `// =============================================================================
// LORCAST CARD DEFINITIONS — auto-generated by scripts/import-cards.ts
// DO NOT EDIT MANUALLY — re-run the script to regenerate.
//
// Cards with named abilities have abilities: [] (vanilla stubs).
// Search for _namedAbilityStubs in lorcast-cards.json to find cards
// that need manual ability implementation.
// =============================================================================

import type { CardDefinition } from "../types/index.js";
import rawCards from "./lorcast-cards.json" assert { type: "json" };

// Strip the _namedAbilityStubs field before exporting (it's not on CardDefinition).
// \`as unknown as\` is intentional — TypeScript's JSON inference includes \`undefined\`
// in optional property types, which conflicts with exactOptionalPropertyTypes.
// The JSON data is correct at runtime; this cast is safe.
type RawCard = CardDefinition & { _namedAbilityStubs?: string[] };
const cards = (rawCards as unknown as RawCard[])
  .map(({ _namedAbilityStubs: _, ...card }) => card as unknown as CardDefinition);

export const LORCAST_CARD_DEFINITIONS: Record<string, CardDefinition> =
  Object.fromEntries(cards.map((c) => [c.id, c]));

export const LORCAST_CARDS: CardDefinition[] = cards;
`;
}

// =============================================================================
// MAIN
// =============================================================================

const argv = process.argv.slice(2);
const setsArg = argv.find((a) => a.startsWith("--sets"))?.split("=")[1]
  ?? argv[argv.indexOf("--sets") + 1];
const isDry = argv.includes("--dry");

async function main() {
  console.log("Fetching sets from Lorcast API...");
  const { results: allSets } = await apiFetch<{ results: LorcastSet[] }>("/sets");
  await sleep(RATE_LIMIT_MS);

  // Determine which sets to import
  const targetCodes = setsArg && setsArg !== "all"
    ? new Set(setsArg.split(",").map((s) => s.trim()))
    : null;

  const sets = targetCodes
    ? allSets.filter((s) => targetCodes.has(s.code))
    : allSets;

  if (sets.length === 0) {
    console.error(`No sets matched. Available: ${allSets.map((s) => s.code).join(", ")}`);
    process.exit(1);
  }

  console.log(`Importing ${sets.length} set(s): ${sets.map((s) => `${s.code} (${s.name})`).join(", ")}\n`);

  const allCards: CardDefinitionOut[] = [];
  let skipped = 0;

  for (const set of sets) {
    process.stdout.write(`  ${set.code.padEnd(6)} ${set.name.padEnd(35)} `);
    const results = await apiFetch<LorcastCard[]>(`/sets/${set.code}/cards`);
    await sleep(RATE_LIMIT_MS);

    let setCount = 0;
    for (const card of results) {
      const mapped = mapCard(card);
      if (!mapped) { skipped++; continue; }
      allCards.push(mapped);
      setCount++;
    }
    console.log(`${setCount} cards`);
  }

  // Stats
  const withStubs = allCards.filter((c) => (c._namedAbilityStubs?.length ?? 0) > 0);
  const vanillaReady = allCards.length - withStubs.length;
  const totalStubs = withStubs.reduce((s, c) => s + (c._namedAbilityStubs?.length ?? 0), 0);

  console.log(`
──────────────────────────────────────
  Total cards imported:  ${allCards.length}
  Skipped (no ink color): ${skipped}
  Keyword-only (ready):  ${vanillaReady} (${((vanillaReady / allCards.length) * 100).toFixed(0)}%)
  Have named stubs:      ${withStubs.length} cards, ${totalStubs} total named abilities
──────────────────────────────────────`);

  if (isDry) {
    console.log("\nDry run — first 3 cards:");
    console.log(JSON.stringify(allCards.slice(0, 3), null, 2));
    return;
  }

  // Write JSON
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(allCards, null, 2);
  writeFileSync(OUT_JSON, json, "utf-8");
  console.log(`\nWrote ${allCards.length} cards → ${OUT_JSON}`);

  // Write TS module
  writeFileSync(OUT_TS, generateTsModule(), "utf-8");
  console.log(`Wrote TS module    → ${OUT_TS}`);

  // Write stub report
  const stubReport = withStubs
    .map((c) => `${c.id}\n${c._namedAbilityStubs!.map((s) => `  ${s}`).join("\n")}`)
    .join("\n\n");
  const stubPath = join(OUT_DIR, "lorcast-stubs.txt");
  writeFileSync(stubPath, stubReport, "utf-8");
  console.log(`Wrote stub report  → ${stubPath}`);
  console.log(`\n  Implement named abilities from lorcast-stubs.txt manually.`);
  console.log(`  Until then, those cards work as vanilla (abilities: []).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
