#!/usr/bin/env node
// =============================================================================
// RAVENSBURGER CARD IMPORTER
// Fetches card data from Ravensburger's official API at
//   https://www.disneylorcana.com/api/getCardApiData?locale=en&filter=setN
// and generates the same per-set JSONs as the old old importer, preserving
// hand-wired abilities via the same merge logic.
//
// Usage:
//   pnpm tsx scripts/import-cards-rav.ts                 import all supported sets
//   pnpm tsx scripts/import-cards-rav.ts --sets set1,set12   specific sets
//   pnpm tsx scripts/import-cards-rav.ts --sets set1 --dry   dry run
//
// Supported filters: set1..set12, quest1, quest2.
// Not exposed by the API: promo1/2/3, cp, d23, dis — use pnpm import-cards for those.
//
// Why switch? Zero-delay data (same day as app release), richer variant info
// (direct foil-mask URL pairing), includes Iconic/Epic cards the old source didn't
// index, and is the authoritative source (Ravensburger publishes the game).
// =============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "packages/engine/src/cards");
const OUT_TS = join(OUT_DIR, "cardDefinitions.ts");

function setJsonPath(setCode: string): string {
  const padded = setCode.padStart(3, "0");
  return join(OUT_DIR, `card-set-${padded}.json`);
}

const API_URL = "https://www.disneylorcana.com/api/getCardApiData";

// =============================================================================
// RAVENSBURGER API TYPES (subset we use)
// =============================================================================

interface RavVariant {
  variant_id: "Regular" | "Foiled" | string;
  detail_image_url: string;
  foil_mask_url?: string;
  foil_top_layer?: string;
  foil_top_layer_mask_url?: string;
  foil_type?: string;
  hot_foil_color?: string;
}

interface RavCard {
  name: string;
  subtitle: string | null;
  card_identifier: string;          // e.g. "2/204 EN 12"
  card_type: string;                // "characters" | "actions" | "items" | "locations"
  culture_invariant_id: number;
  author: string;
  ink_cost: number;
  ink_convertible: boolean;
  magic_ink_colors: string[];       // ["AMBER"] etc.
  subtypes: string[];               // Storyborn, Hero, Ally, etc.
  abilities: string[];              // keyword names (rarely populated)
  strength: number | null;
  willpower: number | null;
  quest_value: number | null;
  move_cost: number | null;
  rarity: string;                   // COMMON | UNCOMMON | RARE | SUPER | LEGENDARY | ENCHANTED | SPECIAL
  rules_text: string;               // with \Name\ markers around stylized ability names
  flavor_text: string;
  thumbnail_url: string;
  variants: RavVariant[];
}

// Response is grouped by ink color
interface RavApiResponse {
  amber?: RavCard[];
  amethyst?: RavCard[];
  emerald?: RavCard[];
  ruby?: RavCard[];
  sapphire?: RavCard[];
  steel?: RavCard[];
}

// =============================================================================
// OUR OUTPUT TYPE (matches packages/engine/src/types/index.ts)
// =============================================================================

interface KeywordAbility {
  type: "keyword";
  keyword: string;
  value?: number;
}

interface AbilityStub {
  storyName: string;
  rulesText: string;
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
  abilities: KeywordAbility[];
  rulesText?: string;
  flavorText?: string;
  setId: string;
  number: number;
  rarity: "common" | "uncommon" | "rare" | "super_rare" | "legendary" | "enchanted" | "special" | "iconic" | "epic";
  imageUrl?: string;
  actionEffects?: object[];
  _namedAbilityStubs?: AbilityStub[];
}

type SingleInkColor = CardDefinitionOut["inkColors"][number];

// =============================================================================
// MAPPERS
// =============================================================================

// Matches the established project slugify exactly — NOT a "better" one.
// We preserve the project's established slug convention (e.g. "te-k-heartless",
// "f-lix-madrigal") so re-imports don't change IDs and break hardcoded slug
// references in tests and ability wiring. Non-ASCII characters (ā, é, etc.)
// are treated as word-separators and become hyphens.
function slugify(name: string, subtitle: string | null): string {
  const raw = subtitle ? `${name} ${subtitle}` : name;
  return raw
    .toLowerCase()
    .replace(/[\u0027\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapCardType(t: string): CardDefinitionOut["cardType"] {
  const singular = t.toLowerCase().replace(/s$/, "");
  if (singular === "character") return "character";
  if (singular === "item") return "item";
  if (singular === "location") return "location";
  return "action";
}

function mapInkColors(colors: string[]): SingleInkColor[] | null {
  const valid: SingleInkColor[] = ["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"];
  const mapped = colors
    .map((c) => c.toLowerCase() as SingleInkColor)
    .filter((c): c is SingleInkColor => valid.includes(c));
  return mapped.length > 0 ? mapped : null;
}

function mapRarity(r: string): CardDefinitionOut["rarity"] {
  const map: Record<string, CardDefinitionOut["rarity"]> = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    super: "super_rare",
    super_rare: "super_rare",
    legendary: "legendary",
    enchanted: "enchanted",
    special: "special",
    iconic: "iconic",
    epic: "epic",
    promo: "common",
  };
  return map[r.toLowerCase()] ?? "common";
}

// Known promo codes that appear as the "total" field in card_identifier.
// When total is one of these, the card belongs to that promo set (not the
// main set indicated by the setNum field). E.g. "5/P2 EN 7" → promo P2,
// card 5, related to main set 7.
const PROMO_TOTAL_CODES = new Set(["P1","P2","P3","C1","C2","C3","D23","CP","DIS"]);

function parseIdentifier(id: string): { number: number; total: string; setNum: string; setId: string } | null {
  const m = id.match(/(\d+)\s*\/\s*(\S+)\s+EN\s+(\S+)/i);
  if (!m) return null;
  const number = parseInt(m[1]!, 10);
  const total = m[2]!.toUpperCase();
  const setNum = m[3]!.toUpperCase();
  // If total is a promo code, the card belongs to that promo set
  const setId = PROMO_TOTAL_CODES.has(total) ? total : setNum;
  return { number, total, setNum, setId };
}

/**
 * Canonicalize a storyName for matching. rulesText stays with curly typography
 * (for display), but storyName is a project-internal label — ASCII apostrophes,
 * no brackets, collapsed spaced dots. Matches existing hand-wired abilities'
 * storyName convention so re-imports don't cause audit drift.
 */
function canonicalizeStoryName(raw: string): string {
  return raw.toUpperCase()
    .replace(/\u2019/g, "'")              // curly → ASCII apostrophe
    .replace(/[\[\]]/g, "")                // strip surrounding brackets
    .replace(/\s*\.\s*\.\s*\.\s*/g, "...") // collapse " . . . " → "..."
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract named abilities from Ravensburger's rules_text.
 *
 * Ravensburger uses backslash markers but INCONSISTENTLY:
 *   - "\Name\ body" — symmetric open+close (Monterey Jack)
 *   - "Name\ body"  — close only (Dopey)
 *
 * Strategy: normalize by stripping any leading `\`, then split on `\`. Each
 * resulting pair is (name, body). If an odd tail remains (no trailing body
 * after a final `\`), it's leading plain text.
 */
function extractNamedAbilities(rawRulesText: string): { rulesText: string; stubs: AbilityStub[] } {
  if (!rawRulesText) return { rulesText: "", stubs: [] };
  const stubs: AbilityStub[] = [];

  // Pre-extract keyword reminder lines (e.g. "<Bodyguard> (This character...)")
  // so they don't get confused with named-ability backslash markers below.
  // Otherwise a card like Donald Duck — Musketeer Soldier gets its bodyguard
  // reminder swallowed into the storyName of the following named ability.
  const keywordLines: string[] = [];
  const remainingLines: string[] = [];
  for (const line of rawRulesText.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^<[A-Za-z]/.test(t)) keywordLines.push(t);
    else remainingLines.push(line);
  }

  let text = remainingLines.join("\n").trim();
  if (text.startsWith("\\")) text = text.slice(1);

  const parts = text.split("\\");
  // Pairing logic — depends on count parity after normalization:
  //   1 part  → plain text, no named abilities
  //   EVEN    → pairs start at 0 (every part is (name, body))
  //              e.g. Dopey: "Odd One Out\ body" → ["Odd One Out", " body"]
  //   ODD     → parts[0] is leading plain text (keyword prefix etc.),
  //              pairs start at 1
  //              e.g. Ariel: "<Singer> 5 (reminder)\MUSICAL DEBUT\ body"
  //                          → [reminder, "MUSICAL DEBUT", " body"]
  let leadingPlain = "";
  const segments: string[] = [];
  let pairStart = 0;

  if (parts.length === 1) {
    leadingPlain = parts[0]!.trim();
  } else {
    if (parts.length % 2 === 1) {
      leadingPlain = parts[0]!.trim();
      pairStart = 1;
    }
    for (let i = pairStart; i < parts.length; i += 2) {
      const name = (parts[i] ?? "").trim();
      const body = (parts[i + 1] ?? "").trim();
      if (!name && !body) continue;
      const storyName = canonicalizeStoryName(name);
      stubs.push({
        storyName,
        rulesText: body,
        raw: `${storyName} ${body}`.trim(),
      });
      segments.push(`${storyName} ${body}`.trim());
    }
  }

  let cleaned = "";
  // Prepend keyword reminder lines that we pre-extracted
  if (keywordLines.length) cleaned += keywordLines.join("\n");
  if (leadingPlain) {
    if (cleaned) cleaned += "\n";
    cleaned += leadingPlain;
  }
  if (segments.length) {
    if (cleaned) cleaned += "\n";
    cleaned += segments.join("\n");
  }

  // rulesText keeps curly apostrophes for display fidelity
  cleaned = cleaned.replace(/'/g, "\u2019");
  for (const s of stubs) {
    s.rulesText = s.rulesText.replace(/'/g, "\u2019");
    s.raw = s.raw.replace(/'/g, "\u2019");
  }

  return { rulesText: cleaned, stubs };
}

/**
 * Parse <Keyword> markup from Ravensburger's rules_text and build keyword
 * abilities array. Only matches keywords at the START of a line (the card's
 * own keyword listing), NOT inline references like "gains <Rush> this turn"
 * inside effect text.
 *
 * Canonical keyword line format:
 *   "<Bodyguard> (This character may enter play exerted...)"
 *   "<Shift> 3 {I} (You may pay...)"
 *   "<Challenger> +2"
 *   "<Resist> +1"
 *   "<Singer> 5"
 * An inline reference like "gains <Rush> this turn" must NOT match.
 */
function parseKeywordAbilities(
  rulesText: string
): { abilities: KeywordAbility[]; shiftCost?: number } {
  const abilities: KeywordAbility[] = [];
  let shiftCost: number | undefined;

  const add = (kw: string, value?: number) => {
    abilities.push(value !== undefined ? { type: "keyword", keyword: kw, value } : { type: "keyword", keyword: kw });
  };

  // Anchor pattern: keyword must appear at text start OR after a newline,
  // followed by a value (digit/+digit), reminder-text paren, or end-of-line.
  // This distinguishes card-own-keywords from inline references.
  const anchor = "(?:^|\\n)\\s*";
  const tail = "\\s*(?:\\(|\\+?\\d|$|\\n|{[IES]})";

  const patterns: [RegExp, (m: RegExpMatchArray) => void][] = [
    [new RegExp(`${anchor}<Bodyguard>${tail}`, "i"), () => add("bodyguard")],
    [new RegExp(`${anchor}<Rush>${tail}`, "i"), () => add("rush")],
    [new RegExp(`${anchor}<Evasive>${tail}`, "i"), () => add("evasive")],
    [new RegExp(`${anchor}<Ward>${tail}`, "i"), () => add("ward")],
    [new RegExp(`${anchor}<Reckless>${tail}`, "i"), () => add("reckless")],
    [new RegExp(`${anchor}<Support>${tail}`, "i"), () => add("support")],
    [new RegExp(`${anchor}<Vanish>${tail}`, "i"), () => add("vanish")],
    [new RegExp(`${anchor}<Alert>${tail}`, "i"), () => add("alert")],
    [new RegExp(`${anchor}<Challenger>\\s*\\+?(\\d+)`, "i"), (m) => add("challenger", parseInt(m[1]!, 10))],
    [new RegExp(`${anchor}<Singer>\\s*(\\d+)`, "i"), (m) => add("singer", parseInt(m[1]!, 10))],
    [new RegExp(`${anchor}<Shift>\\s*(\\d+)`, "i"), (m) => { const v = parseInt(m[1]!, 10); shiftCost = v; add("shift", v); }],
    [new RegExp(`${anchor}<Resist>\\s*\\+?(\\d+)`, "i"), (m) => add("resist", parseInt(m[1]!, 10))],
    [new RegExp(`${anchor}<Boost>\\s*(\\d+)`, "i"), (m) => add("boost", parseInt(m[1]!, 10))],
    [new RegExp(`${anchor}<Sing\\s*Together>\\s*(\\d+)`, "i"), (m) => add("sing_together", parseInt(m[1]!, 10))],
  ];

  for (const [pattern, action] of patterns) {
    const m = rulesText.match(pattern);
    if (m) action(m);
  }

  return { abilities, shiftCost };
}

// Cards where Ravensburger's API data disagrees with the printed card's
// stylized ability name. User-verified against physical cards. Overrides
// the storyName(s) generated by extractNamedAbilities so card-status
// audit matches and re-imports don't re-introduce the bad names.
const STORY_NAME_OVERRIDES: Record<string, string[]> = {
  // Ravensburger has "GONNA TAKE YOU THERE"; printed card is "SHOW ME THE WAY"
  "the-bayou-mysterious-swamp": ["SHOW ME THE WAY"],
  // Ravensburger has "UMBRA'S POWER, UMBRA'S GIFT" as one name; printed card has two abilities
  "half-hexwell-crown": ["AN UNEXPECTED FIND", "A PERILOUS POWER"],
  // Ravensburger has "GOT TO DO EVERYTHING AROUND HERE"; printed card has "I'VE" prefix
  "mama-odie-solitary-sage": ["I'VE GOT TO DO EVERYTHING AROUND HERE"],
};

function applyStoryNameOverride(slug: string, stubs: AbilityStub[]): AbilityStub[] {
  const override = STORY_NAME_OVERRIDES[slug];
  if (!override) return stubs;
  if (override.length === stubs.length) {
    return stubs.map((s, i) => ({ ...s, storyName: override[i]! }));
  }
  // Stub count differs — produce override stubs with empty rulesText (audit only)
  const body = stubs[0]?.rulesText ?? "";
  return override.map((name) => ({ storyName: name, rulesText: body, raw: `${name} ${body}`.trim() }));
}

function mapCard(c: RavCard): CardDefinitionOut | null {
  const id = parseIdentifier(c.card_identifier);
  if (!id) return null;

  const inkColors = mapInkColors(c.magic_ink_colors ?? []);
  if (!inkColors) return null;

  const { rulesText: cleanRulesText, stubs } = extractNamedAbilities(c.rules_text ?? "");
  const { abilities, shiftCost } = parseKeywordAbilities(c.rules_text ?? "");

  const fullName = c.subtitle ? `${c.name} - ${c.subtitle}` : c.name;
  const regular = (c.variants ?? []).find((v) => v.variant_id === "Regular") ?? c.variants?.[0];

  const traits = [...(c.subtypes ?? [])];
  // Songs: if card_type === "actions" and has "Song" in subtypes already, good.
  // Ravensburger seems to include "Song" in subtypes for songs — don't add manually.

  const out: CardDefinitionOut = {
    id: slugify(c.name, c.subtitle),
    name: c.name,
    fullName,
    cardType: mapCardType(c.card_type),
    inkColors,
    cost: c.ink_cost ?? 0,
    inkable: !!c.ink_convertible,
    traits,
    abilities,
    setId: id.setId,
    number: id.number,
    rarity: mapRarity(c.rarity),
  };

  if (c.subtitle) out.subtitle = c.subtitle;
  if (c.strength !== null) out.strength = c.strength;
  if (c.willpower !== null) out.willpower = c.willpower;
  if (c.quest_value !== null) out.lore = c.quest_value;
  if (shiftCost !== undefined) out.shiftCost = shiftCost;
  if (c.move_cost !== null) out.moveCost = c.move_cost;
  if (cleanRulesText) out.rulesText = cleanRulesText;
  if (c.flavor_text) out.flavorText = c.flavor_text;
  if (regular?.detail_image_url) out.imageUrl = regular.detail_image_url;
  const finalStubs = applyStoryNameOverride(out.id, stubs);
  if (finalStubs.length > 0) out._namedAbilityStubs = finalStubs;

  return out;
}

// =============================================================================
// MERGE LOGIC (duplicated from scripts/import-cards-rav.ts — keeps hand-wired
// abilities/keywords/fields safe across re-imports)
// =============================================================================

// Normalize fullName for fallback matching when slugs differ across imports
// (e.g., Te Kā: old data had "te-k-heartless", fixed slugify gives "te-ka-heartless").
function normName(s: string): string {
  return (s ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function mergeWithExisting(setCode: string, newCards: CardDefinitionOut[]): { preserved: number; keywordsRescued: number; reslugged: number } {
  const outPath = setJsonPath(setCode);
  if (!existsSync(outPath)) return { preserved: 0, keywordsRescued: 0, reslugged: 0 };

  const existing: CardDefinitionOut[] = JSON.parse(readFileSync(outPath, "utf-8"));
  const existingById = new Map(existing.map((c) => [c.id, c]));
  // Fallback index: (number, normalized-fullName) → card. Catches cases where
  // a slug has changed across re-imports due to apostrophe/diacritic fixes.
  const existingByNormName = new Map(
    existing.map((c) => [`${c.number}|${normName(c.fullName)}`, c])
  );
  let preserved = 0;
  let keywordsRescued = 0;
  let reslugged = 0;

  for (const card of newCards) {
    let prev = existingById.get(card.id);
    if (!prev) {
      // Slug changed across re-import — match by number + normalized name.
      prev = existingByNormName.get(`${card.number}|${normName(card.fullName)}`);
      if (prev) reslugged++;
    }
    if (!prev) continue;

    // 1. Preserve manually-added abilities (non-keyword: triggered, activated, static)
    const manualAbilities = prev.abilities.filter((a) => a.type !== "keyword");
    if (manualAbilities.length > 0) {
      card.abilities = [...card.abilities, ...manualAbilities] as KeywordAbility[];
      preserved++;
    }

    // 2. UNION keyword abilities with previous data (rescue dropped keywords + backfill values)
    const prevKeywordByName = new Map(
      prev.abilities
        .filter((a) => a.type === "keyword")
        .map((a) => [a.keyword.toLowerCase(), a as KeywordAbility])
    );
    const newKeywords = new Set(
      card.abilities.filter((a) => a.type === "keyword").map((a) => a.keyword.toLowerCase())
    );
    for (const [kw, ability] of prevKeywordByName) {
      if (!newKeywords.has(kw)) {
        card.abilities = [...card.abilities, ability];
        keywordsRescued++;
      }
    }
    card.abilities = card.abilities.map((a) => {
      if (a.type !== "keyword") return a;
      const prevAb = prevKeywordByName.get(a.keyword.toLowerCase());
      if (prevAb && prevAb.value !== undefined && a.value === undefined) {
        keywordsRescued++;
        return { ...a, value: prevAb.value };
      }
      return a;
    });

    // 3. Preserve manually-added actionEffects
    if (prev.actionEffects && prev.actionEffects.length > 0) {
      card.actionEffects = prev.actionEffects;
      preserved++;
    }

    // 4. Preserve scalar fields the importer may not populate
    const passthroughFields = [
      "alternateNames", "playRestrictions", "altPlayCost",
      "selfCostReduction", "shiftCost", "altShiftCost",
      "moveCost", "singTogetherCost",
    ];
    for (const field of passthroughFields) {
      const prevVal = (prev as Record<string, unknown>)[field];
      const newVal = (card as Record<string, unknown>)[field];
      if (newVal === undefined && prevVal !== undefined) {
        (card as Record<string, unknown>)[field] = prevVal;
      }
    }
  }

  return { preserved, keywordsRescued, reslugged };
}

// =============================================================================
// MAIN
// =============================================================================

// Default set list — main sets + Illumineer Quests (all Ravensburger exposes)
const ALL_RAV_FILTERS = [
  "set1","set2","set3","set4","set5","set6","set7","set8","set9","set10","set11","set12",
  // "quest1", "quest2" — skip for now; Quest cards are keyed by original set,
  // which complicates merging. Enable when numbering strategy is decided.
];

// Map Ravensburger filter → project setId (used as JSON filename)
function ravFilterToSetId(filter: string): string {
  const m = filter.match(/^set(\d+)$/i);
  if (m) return m[1]!;
  const q = filter.match(/^quest(\d+)$/i);
  if (q) return "Q" + q[1]!;
  return filter.toUpperCase();
}

async function fetchSet(filter: string): Promise<RavCard[]> {
  const url = `${API_URL}?locale=en&filter=${filter}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`API ${filter} → ${res.status}`);
  const data: RavApiResponse = await res.json();
  const cards: RavCard[] = [];
  for (const ink of ["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"] as const) {
    for (const c of data[ink] ?? []) cards.push(c);
  }
  // Dedup dual-ink (same card under multiple inks). Use the full
  // card_identifier as key so promo reprints (same name+number but
  // different total like P2 vs 204) aren't collapsed.
  const seen = new Map<string, RavCard>();
  for (const c of cards) {
    const key = c.card_identifier || `${c.name}|${c.subtitle ?? ""}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

async function main() {
  const argv = process.argv.slice(2);
  const setsArg = argv.find((a) => a.startsWith("--sets"))?.split("=")[1]
    ?? argv[argv.indexOf("--sets") + 1];
  const isDry = argv.includes("--dry");

  const filters = setsArg && setsArg !== "all"
    ? setsArg.split(",").map((s) => s.trim())
    : ALL_RAV_FILTERS;

  console.log(`Importing from Ravensburger API — ${filters.length} set(s): ${filters.join(", ")}\n`);

  const cardsBySet = new Map<string, CardDefinitionOut[]>();
  let skipped = 0;

  for (const filter of filters) {
    const setId = ravFilterToSetId(filter);
    process.stdout.write(`  ${filter.padEnd(8)} → set ${setId.padEnd(4)} `);
    const ravCards = await fetchSet(filter);
    let mapped = 0;
    for (const c of ravCards) {
      const out = mapCard(c);
      if (!out) { skipped++; continue; }
      if (!cardsBySet.has(out.setId)) cardsBySet.set(out.setId, []);
      cardsBySet.get(out.setId)!.push(out);
      mapped++;
    }
    console.log(`${mapped} cards`);
  }

  // Stats
  const allCards = [...cardsBySet.values()].flat();
  const withStubs = allCards.filter((c) => (c._namedAbilityStubs?.length ?? 0) > 0);
  const totalStubs = withStubs.reduce((s, c) => s + (c._namedAbilityStubs?.length ?? 0), 0);

  console.log(`
──────────────────────────────────────
  Total cards imported:  ${allCards.length}
  Skipped (no ink color): ${skipped}
  Have named stubs:      ${withStubs.length} cards, ${totalStubs} total named abilities
──────────────────────────────────────`);

  if (isDry) {
    console.log("\nDry run — first 3 cards:");
    console.log(JSON.stringify(allCards.slice(0, 3), null, 2));
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  for (const [setCode, setCards] of cardsBySet) {
    const outPath = setJsonPath(setCode);
    const { preserved, keywordsRescued, reslugged } = mergeWithExisting(setCode, setCards);
    if (preserved > 0 || keywordsRescued > 0 || reslugged > 0) {
      console.log(`  Preserved manual abilities on ${preserved} card(s) in set ${setCode}` +
        (keywordsRescued > 0 ? `; rescued ${keywordsRescued} keyword field(s)` : "") +
        (reslugged > 0 ? `; ${reslugged} card(s) matched via renamed slug` : "") + ".");
    }
    // Sort by number for stable diff
    setCards.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    writeFileSync(outPath, JSON.stringify(setCards, null, 2), "utf-8");
    console.log(`  Wrote ${setCards.length} cards → ${outPath}`);
  }

  // Regenerate cardDefinitions.ts with ALL set files present on disk (not just
  // the ones we imported this run — so partial re-imports don't drop other
  // sets or promo files that still come from the old importer).
  const allSetCodes = readdirSync(OUT_DIR)
    .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
    .map((f) => f.replace(/^card-set-/, "").replace(/\.json$/, ""))
    .sort();
  const setImports = allSetCodes.map((padded) =>
    `import set${padded} from "./card-set-${padded}.json" assert { type: "json" };`
  );
  const setSpread = allSetCodes.map((padded) => `  ...loadSet(set${padded}),`);

  const tsModule = `// =============================================================================
// CARD DEFINITIONS — loads per-set JSON files and merges them.
// Card data is auto-generated by scripts/import-cards-rav.ts  or
// scripts/import-cards-rav.ts (Ravensburger). Abilities are manually
// implemented. Add new sets by re-running the import script.
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
export const CARD_DEFINITIONS: Record<string, CardDefinition> =
  cards.reduce<Record<string, CardDefinition>>((map, c) => {
    const existing = map[c.id];
    if (!existing || manualAbilityCount(c) > manualAbilityCount(existing)) {
      map[c.id] = c;
    }
    return map;
  }, {});

export const ALL_CARDS: CardDefinition[] = cards;
`;

  writeFileSync(OUT_TS, tsModule, "utf-8");
  console.log(`  Wrote TS module     → ${OUT_TS}`);

  if (withStubs.length > 0) {
    console.log(`\n  ${withStubs.length} cards have named ability stubs — wire them in abilities[].`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
