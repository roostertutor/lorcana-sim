#!/usr/bin/env node
// =============================================================================
// LORCAST CARD IMPORTER
// Fetches card data from https://api.lorcast.com/v0 and generates:
//   packages/engine/src/cards/lorcast-set-XXX.json  — CardDefinition array per set
//   packages/engine/src/cards/lorcastCards.ts        — TS module that merges all sets
//
// Usage:
//   pnpm import-cards                  fetch all sets
//   pnpm import-cards --sets 1,2,3     fetch specific sets by code
//   pnpm import-cards --sets 1 --dry   dry run, print output instead of writing
//
// Rate limit: 100ms between requests per Lorcast docs.
// =============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "packages/engine/src/cards");
const OUT_TS = join(OUT_DIR, "lorcastCards.ts");

function setJsonPath(setCode: string): string {
  const padded = setCode.padStart(3, "0");
  return join(OUT_DIR, `lorcast-set-${padded}.json`);
}

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
  inks: string[] | null;
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

interface AbilityStub {
  /** CRD 5.2.8: The bold ability name on the card */
  storyName: string;
  /** CRD 5.2.8: The rules text (everything after the story name) */
  rulesText: string;
  /** Raw line from Lorcast API for reference */
  raw: string;
}

interface CardDefinitionOut {
  id: string;
  name: string;
  subtitle?: string;
  fullName: string;
  cardType: "character" | "action" | "item" | "location";
  inkColors: ("amber" | "amethyst" | "emerald" | "ruby" | "sapphire" | "steel")[];
  cost: number;
  inkable: boolean;
  traits: string[];
  strength?: number;
  willpower?: number;
  lore?: number;
  shiftCost?: number;
  moveCost?: number;
  abilities: KeywordAbility[]; // named abilities left as stubs (empty)
  rulesText?: string;
  flavorText?: string;
  setId: string;
  number: number;
  rarity: "common" | "uncommon" | "rare" | "super_rare" | "legendary" | "enchanted";
  /** Card art URL from Lorcast API (digital.normal) */
  imageUrl?: string;
  // CRD 5.4.3: Action effects (manually added, not from API)
  actionEffects?: object[];
  // Extra field written to JSON, stripped in lorcastCards.ts
  _namedAbilityStubs?: AbilityStub[];
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

type SingleInkColor = CardDefinitionOut["inkColors"][number];

function mapSingleInk(ink: string): SingleInkColor | null {
  const map: Record<string, SingleInkColor> = {
    amber: "amber",
    amethyst: "amethyst",
    emerald: "emerald",
    ruby: "ruby",
    sapphire: "sapphire",
    steel: "steel",
  };
  return map[ink.toLowerCase()] ?? null;
}

function mapInkColors(ink: string | null, inks: string[] | null): SingleInkColor[] | null {
  if (inks && inks.length > 0) {
    const mapped = inks.map(i => mapSingleInk(i)).filter((c): c is SingleInkColor => c !== null);
    return mapped.length > 0 ? mapped : null;
  }
  if (ink) {
    const mapped = mapSingleInk(ink);
    return mapped ? [mapped] : null;
  }
  return null;
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
  "Ward", "Support", "Reckless", "Resist", "Vanish", "Alert",
  "Boost",
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
      case "vanish":    abilities.push({ type: "keyword", keyword: "vanish" }); break;
      case "alert":     abilities.push({ type: "keyword", keyword: "alert" }); break;
      case "boost": {
        const m = text?.match(/Boost (\d+)/);
        abilities.push({ type: "keyword", keyword: "boost", value: m ? parseInt(m[1]!) : 1 });
        break;
      }
      // Unknown keyword — record as-is for awareness
      default:
        abilities.push({ type: "keyword", keyword: k });
    }
  }

  return { abilities, shiftCost };
}

/**
 * Parse named abilities from card text into structured stubs with storyName and rulesText.
 * CRD 5.2.8: Named abilities have an ALL-CAPS story name followed by rules text.
 *
 * Patterns:
 * - Activated: "STORY NAME {E} — Rules text" or "STORY NAME {E}, N {I} — Rules text"
 * - Triggered: "STORY NAME When/Whenever/During rules text"
 * - Static:    "STORY NAME This/While/Your/Opposing/Characters/All rules text"
 */
function detectNamedAbilities(text: string | null): AbilityStub[] {
  if (!text) return [];
  const stubs: AbilityStub[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip keyword reminder lines (start with a known keyword word)
    const isKeywordLine = KEYWORD_LINE_PREFIXES.some((kw) =>
      line.startsWith(kw)
    );
    if (isKeywordLine) continue;

    // Named abilities have an ALL-CAPS story name prefix followed by mixed-case
    // rules text. Match the leading run of uppercase words (may include
    // apostrophes, hyphens, commas, exclamation/question marks, periods).
    // Examples: "GOOD AIM Once during...", "IT'S MAUI TIME! If you...",
    //           "DON'T GET ANY IDEAS Each player..."
    const storyMatch = line.match(/^([A-Z][A-Z0-9' ,!?.…-]+?)(?:\s*\{E\}|\s*\(|\s+[a-z0-9{(]|\s+[A-Z][a-z])/);
    if (storyMatch) {
      const storyName = storyMatch[1]!.trim();
      // Extract rulesText: everything after the story name
      let rulesText = line.slice(storyName.length).trim();
      // Strip leading em-dash or cost prefix for activated abilities: "{E} —", "{E}, N {I} —"
      rulesText = rulesText.replace(/^\{E\}(?:,\s*\d+\s*\{I\})?\s*[–—-]\s*/, "").trim();

      stubs.push({
        storyName,
        rulesText: rulesText || line,
        raw: line,
      });
    }
  }

  return stubs;
}

// =============================================================================
// CARD MAPPER
// =============================================================================

function mapCard(c: LorcastCard): CardDefinitionOut | null {
  const inkColors = mapInkColors(c.ink, c.inks);
  // Skip colorless cards with no ink info
  if (!inkColors) return null;

  const { abilities, shiftCost } = parseKeywordAbilities(c.keywords, c.text);
  let namedStubs = detectNamedAbilities(c.text);

  // For cards with text but no detected named abilities (e.g., action/song cards
  // whose entire text IS the effect without an ALL-CAPS header), preserve the
  // full card text as a stub so it's never silently dropped.
  if (namedStubs.length === 0 && c.text) {
    const textLines = c.text.split("\n").map((l) => l.trim()).filter(Boolean);
    // Exclude lines that are purely keyword lines (already parsed above)
    const nonKeywordLines = textLines.filter(
      (line) => !KEYWORD_LINE_PREFIXES.some((kw) => line.startsWith(kw))
    );
    if (nonKeywordLines.length > 0) {
      namedStubs.push(...nonKeywordLines.map((line) => ({
        storyName: "",
        rulesText: line,
        raw: line,
      })));
    }
  }

  // CRD 5.4.4.1: Songs have "Song" on their type line — add to traits
  const traits = c.classifications ?? [];
  if (c.type.map((t) => t.toLowerCase()).includes("song") && !traits.includes("Song")) {
    traits.push("Song");
  }

  const out: CardDefinitionOut = {
    id: slugify(c.name, c.version),
    name: c.name,
    fullName: c.version ? `${c.name} - ${c.version}` : c.name,
    cardType: mapCardType(c.type),
    inkColors,
    cost: c.cost,
    inkable: c.inkwell,
    traits,
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
  if (c.move_cost !== null) out.moveCost = c.move_cost;
  // CRD 5.2.8: Preserve the full printed rules text (excluding keyword reminder lines)
  if (c.text) {
    const rulesLines = c.text.split("\n").map((l) => l.trim()).filter(Boolean)
      .filter((line) => !KEYWORD_LINE_PREFIXES.some((kw) => line.startsWith(kw)));
    if (rulesLines.length > 0) out.rulesText = rulesLines.join("\n");
  }
  if (c.flavor_text) out.flavorText = c.flavor_text;
  if (c.image_uris?.digital?.normal) out.imageUrl = c.image_uris.digital.normal;
  if (namedStubs.length > 0) out._namedAbilityStubs = namedStubs;

  return out;
}

// generateTsModule is now inline in main() — it dynamically generates imports for all sets.

// =============================================================================
// MAIN
// =============================================================================

const argv = process.argv.slice(2);
const setsArg = argv.find((a) => a.startsWith("--sets"))?.split("=")[1]
  ?? argv[argv.indexOf("--sets") + 1];
const isDry = argv.includes("--dry");
const doCache = argv.includes("--cache");
const RAW_CACHE_DIR = join(OUT_DIR, ".lorcast-raw");

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

  // Create cache directory if --cache flag is set
  if (doCache) {
    if (!existsSync(RAW_CACHE_DIR)) mkdirSync(RAW_CACHE_DIR, { recursive: true });
  }

  for (const set of sets) {
    process.stdout.write(`  ${set.code.padEnd(6)} ${set.name.padEnd(35)} `);
    const results = await apiFetch<LorcastCard[]>(`/sets/${set.code}/cards`);
    await sleep(RATE_LIMIT_MS);

    // Cache raw API response before transformation
    if (doCache) {
      const cachePath = join(RAW_CACHE_DIR, `set-${set.code.padStart(3, "0")}.json`);
      writeFileSync(cachePath, JSON.stringify(results, null, 2), "utf-8");
    }

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

  mkdirSync(OUT_DIR, { recursive: true });

  // Group cards by set
  const cardsBySet = new Map<string, CardDefinitionOut[]>();
  for (const card of allCards) {
    const setCode = card.setId;
    if (!cardsBySet.has(setCode)) cardsBySet.set(setCode, []);
    cardsBySet.get(setCode)!.push(card);
  }

  // Write per-set JSON files, preserving manually-implemented abilities
  for (const [setCode, setCards] of cardsBySet) {
    const outPath = setJsonPath(setCode);

    // Merge: preserve manually-implemented abilities AND any keywords/fields
    // the upstream API might have dropped. The importer should be additive,
    // not destructive — Lorcast occasionally drops keywords (e.g. Cri-Kee
    // losing `alert`) or omits other fields between fetches.
    if (existsSync(outPath)) {
      const existing: CardDefinitionOut[] = JSON.parse(readFileSync(outPath, "utf-8"));
      const existingById = new Map(existing.map((c) => [c.id, c]));
      let preserved = 0;
      let keywordsRescued = 0;

      for (const card of setCards) {
        const prev = existingById.get(card.id);
        if (!prev) continue;

        // 1. Preserve manually-added abilities (non-keyword: triggered, activated, static).
        const manualAbilities = prev.abilities.filter((a) => a.type !== "keyword");
        if (manualAbilities.length > 0) {
          card.abilities = [...card.abilities, ...manualAbilities] as KeywordAbility[];
          preserved++;
        }

        // 2. UNION keyword abilities. Two failure modes to guard against:
        //    (a) Lorcast omits a keyword entirely (Cri-Kee Good Luck Charm
        //        lost `alert` on a re-pull). Rescue by copying the missing
        //        keyword from the previous data.
        //    (b) Lorcast returns a keyword without its value field (Boost,
        //        Resist, Singer, Shift, Sing Together, etc. have a numeric
        //        value the importer parses from text — sometimes missed).
        //        Rescue by backfilling the value from the previous data.
        const prevKeywordByName = new Map(
          prev.abilities
            .filter((a) => a.type === "keyword")
            .map((a) => [a.keyword.toLowerCase(), a as KeywordAbility])
        );
        const newKeywords = new Set(
          card.abilities.filter((a) => a.type === "keyword").map((a) => a.keyword.toLowerCase())
        );
        // (a) Add keywords that were previously present but are now missing.
        for (const [kw, ability] of prevKeywordByName) {
          if (!newKeywords.has(kw)) {
            card.abilities = [...card.abilities, ability];
            keywordsRescued++;
          }
        }
        // (b) Backfill missing value fields on keywords that exist in both.
        card.abilities = card.abilities.map((a) => {
          if (a.type !== "keyword") return a;
          const prevAb = prevKeywordByName.get(a.keyword.toLowerCase());
          if (prevAb && prevAb.value !== undefined && a.value === undefined) {
            keywordsRescued++;
            return { ...a, value: prevAb.value };
          }
          return a;
        });

        // 3. Preserve manually-added actionEffects.
        const prevAny = prev as CardDefinitionOut;
        if (prevAny.actionEffects && prevAny.actionEffects.length > 0) {
          card.actionEffects = prevAny.actionEffects;
          preserved++;
        }

        // 4. Preserve scalar fields the importer doesn't always populate
        //    (alternate names, play restrictions, alt play cost, self cost
        //    reduction, shift cost, move cost). These are manually authored
        //    or derived from text; the importer should not blow them away.
        const passthroughFields: (keyof CardDefinitionOut)[] = [
          "alternateNames" as keyof CardDefinitionOut,
          "playRestrictions" as keyof CardDefinitionOut,
          "altPlayCost" as keyof CardDefinitionOut,
          "selfCostReduction" as keyof CardDefinitionOut,
          "shiftCost" as keyof CardDefinitionOut,
          "altShiftCost" as keyof CardDefinitionOut,
          "moveCost" as keyof CardDefinitionOut,
          "singTogetherCost" as keyof CardDefinitionOut,
          "alternateNames" as keyof CardDefinitionOut,
        ];
        for (const field of passthroughFields) {
          const prevVal = (prev as Record<string, unknown>)[field as string];
          const newVal = (card as Record<string, unknown>)[field as string];
          if (newVal === undefined && prevVal !== undefined) {
            (card as Record<string, unknown>)[field as string] = prevVal;
          }
        }
      }

      if (preserved > 0 || keywordsRescued > 0) {
        console.log(`  Preserved manual abilities on ${preserved} card(s) in set ${setCode}` +
          (keywordsRescued > 0 ? `; rescued ${keywordsRescued} dropped keyword(s).` : "."));
      }
    }

    const json = JSON.stringify(setCards, null, 2);
    writeFileSync(outPath, json, "utf-8");
    console.log(`\nWrote ${setCards.length} cards → ${outPath}`);
  }

  // Update lorcastCards.ts with imports for ALL sets present on disk, not
  // just the ones we re-imported in this run. Scanning the directory keeps
  // partial re-imports (e.g. `pnpm import-cards --sets P3`) from silently
  // dropping every other set from the merged module.
  const allSetCodes = readdirSync(OUT_DIR)
    .filter((f) => f.startsWith("lorcast-set-") && f.endsWith(".json"))
    .map((f) => f.replace(/^lorcast-set-/, "").replace(/\.json$/, ""))
    .sort();
  const setImports = allSetCodes.map((padded) => {
    return `import set${padded} from "./lorcast-set-${padded}.json" assert { type: "json" };`;
  });
  const setSpread = allSetCodes.map((padded) => `  ...loadSet(set${padded}),`);

  const tsModule = `// =============================================================================
// LORCAST CARD DEFINITIONS — loads per-set JSON files and merges them.
// Card data is auto-generated by scripts/import-cards.ts, then abilities
// are manually implemented. Add new sets by re-running the import script.
// =============================================================================

import type { CardDefinition } from "../types/index.js";
${setImports.join("\n")}

type RawCard = CardDefinition & { _namedAbilityStubs?: string[] };

function loadSet(raw: unknown[]): CardDefinition[] {
  return (raw as RawCard[])
    .map(({ _namedAbilityStubs: _, ...card }) => card as unknown as CardDefinition);
}

const cards = [
${setSpread.join("\n")}
];

/** Count manually-implemented abilities (non-keyword) + actionEffects on a card. */
function manualAbilityCount(c: CardDefinition): number {
  const nonKeyword = c.abilities.filter(a => a.type !== "keyword").length;
  const actionFx = c.actionEffects?.length ?? 0;
  return nonKeyword + actionFx;
}

/** For duplicate IDs (reprints), keep the copy with more implemented abilities. */
export const LORCAST_CARD_DEFINITIONS: Record<string, CardDefinition> =
  cards.reduce<Record<string, CardDefinition>>((map, c) => {
    const existing = map[c.id];
    if (!existing || manualAbilityCount(c) > manualAbilityCount(existing)) {
      map[c.id] = c;
    }
    return map;
  }, {});

export const LORCAST_CARDS: CardDefinition[] = cards;
`;

  writeFileSync(OUT_TS, tsModule, "utf-8");
  console.log(`Wrote TS module    → ${OUT_TS}`);

  // Report stubs to CARD_ISSUES.md format
  if (withStubs.length > 0) {
    console.log(`\n  ${withStubs.length} cards have named ability stubs — track in docs/CARD_ISSUES.md`);
  }

  console.log(`\nNext: run \`pnpm tsx scripts/audit-lorcast-data.ts\` to scan for`);
  console.log(`upstream keyword drift (see docs/LORCAST_DATA_ISSUES.md).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
