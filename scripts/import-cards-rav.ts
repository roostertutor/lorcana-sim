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
// Supported filters: set1..set12.
// Promos are NOT separate filters — `?filter=promo1` returns empty — but promo
// cards (P1/P2/P3/C1/C2/D23, and reprints with `DIS` total codes) piggyback on
// main-set responses. E.g. `?filter=set7` includes cards whose card_identifier
// is "5/P2 EN 7" (a P2 promo related to set 7). parseIdentifier() detects these
// via PROMO_TOTAL_CODES and routes them to the correct promo JSON file with
// _source: "ravensburger". So Ravensburger IS the source for promos — for the
// subset that appears as reprints. Cards exclusive to DIS / C2 / cp / D23 that
// never appear as a main-set reprint come from Lorcast instead (see
// import-cards-lorcast.ts).
// quest1/quest2 exist as filters but return the same cards as the main-set
// filters (alt-arts tagged card_sets: ["questN","setN"]), so we skip them.
//
// Why switch? Zero-delay data (same day as app release), richer variant info
// (direct foil-mask URL pairing), includes Iconic/Epic cards the old source didn't
// index, and is the authoritative source (Ravensburger publishes the game).
// =============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  normalizeApostrophes,
  normalizeDashes,
  normalizeDoubleQuotes,
  stripTrailingWhitespace,
  normalizeKeywordLine,
  stripStraySeparators,
  stripAbilityNameMarkers,
} from "./lib/normalize-rules-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "packages/engine/src/cards");
const OUT_TS = join(OUT_DIR, "cardDefinitions.ts");

function setJsonPath(setCode: string): string {
  return join(OUT_DIR, `card-set-${setCode}.json`);
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
  special_rarity_id?: string;       // PROMO | CHALLENGE | D23 | D100 — only present when rarity == SPECIAL
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
  maxCopies?: number;
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
  rarity:
    | "common" | "uncommon" | "rare" | "super_rare"
    | "legendary" | "enchanted" | "iconic" | "epic"
    | "promo" | "challenge" | "D23" | "D100";
  imageUrl?: string;
  foilImageUrl?: string;
  actionEffects?: object[];
  _namedAbilityStubs?: AbilityStub[];
  _source?: "ravensburger" | "lorcast" | "manual";
  _sourceLock?: boolean;
  /** Ravensburger's stable numeric card ID (culture_invariant_id). Persisted so
   *  external consumers (e.g. the collection-tracker app) can join on the
   *  `rav_{id}` convention without having to re-pull the Ravensburger API
   *  themselves. Carried across re-imports via passthroughFields. */
  _ravensburgerId?: number;

  // Foil treatment metadata — snake_case normalizations of Ravensburger's
  // variants[] fields. See CardDefinition for full field docs. Extracted in
  // mapCard() below from the Foiled variant (falling back to Regular —
  // Enchanteds carry foil data on Regular because they're foil-only).
  foilType?:
    | "silver" | "lava" | "tempest" | "satin"
    | "freeform_1" | "freeform_2" | "vertical_wave" | "glitter"
    | "magma" | "lore" | "rainbow_pillars"
    | "calendar_wave" | "sea_wave";
  foilMaskUrl?: string;
  foilTopLayerMaskUrl?: string;
  foilTopLayer?:
    | "high_gloss" | "metallic_hot_foil" | "snow_hot_foil"
    | "rainbow_hot_foil" | "matte_hot_foil";
  hotFoilColor?: string;

  // Mask provenance — mirrors _imageSource / _sourceImageUrl but for the
  // two foil-mask URLs. Populated by sync-foil-masks.ts.
  _foilMaskSource?: "ravensburger" | "lorcast" | "manual";
  _foilMaskSourceUrl?: string;
  _foilTopMaskSourceUrl?: string;
  _foilMaskSourceLock?: boolean;
}

type CardSource = NonNullable<CardDefinitionOut["_source"]>;
const SOURCE_TIER: Record<CardSource, number> = { manual: 0, lorcast: 1, ravensburger: 2 };
function sourceTier(s: CardSource | undefined): number {
  // Missing _source means lowest priority (manual). The full provenance flow is:
  //   1. pnpm backfill-source-manual  — tag anything untagged as "manual"
  //   2. pnpm import-cards             — upgrade to "ravensburger" where covered
  //   3. pnpm import-cards-lorcast     — upgrade to "lorcast" for remaining gaps
  //   4. anything still "manual"       — no upstream provenance; bespoke or stale
  // So an untagged card is treated as manual and any incoming importer upgrades
  // it. Current data has explicit _source on every card (verified), so this
  // default only matters for newly hand-added entries.
  return SOURCE_TIER[s ?? "manual"];
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

// Ravensburger's top-level rarity is the standard one (COMMON … ENCHANTED).
// SPECIAL is an umbrella for "non-standard printings" with a `special_rarity_id`
// sub-discriminator (PROMO / CHALLENGE / D23 / D100). We flatten both into a
// single rarity value so each card has one canonical rarity, matching the
// Lorcana app's distinct rarity badges. Acronyms (D23/D100) keep their case
// since that's how they're referenced everywhere (sprite filenames, set ids,
// player conversation); word-style values are lowercased to match our other
// type-union conventions ("super_rare", "common").
let _warnedSpecialRarities = new Set<string>();
function mapRarity(r: string, specialRarityId?: string): CardDefinitionOut["rarity"] {
  const top = r.toLowerCase();
  if (top === "special") {
    if (!specialRarityId) {
      // Untagged SPECIAL — shouldn't happen with current Ravensburger data
      // (every SPECIAL ships with special_rarity_id) but defensive: default
      // to promo as the most generic special bucket. Logs once per run.
      if (!_warnedSpecialRarities.has("(missing)")) {
        console.warn(`  ⚠ Card with rarity SPECIAL but no special_rarity_id — defaulting to "promo".`);
        _warnedSpecialRarities.add("(missing)");
      }
      return "promo";
    }
    const subMap: Record<string, CardDefinitionOut["rarity"]> = {
      promo: "promo",
      challenge: "challenge",
      d23: "D23",
      d100: "D100",
    };
    const mapped = subMap[specialRarityId.toLowerCase()];
    if (!mapped) {
      if (!_warnedSpecialRarities.has(specialRarityId)) {
        console.warn(`  ⚠ Unknown special_rarity_id "${specialRarityId}" — defaulting to "promo". Add to mapRarity in import-cards-rav.ts.`);
        _warnedSpecialRarities.add(specialRarityId);
      }
      return "promo";
    }
    return mapped;
  }
  const map: Record<string, CardDefinitionOut["rarity"]> = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    super: "super_rare",
    super_rare: "super_rare",
    legendary: "legendary",
    enchanted: "enchanted",
    iconic: "iconic",
    epic: "epic",
    promo: "promo",
  };
  return map[top] ?? "common";
}

// ── Foil type normalization ────────────────────────────────────────────
// Ravensburger emits PascalCase strings ("FreeForm1", "RainbowPillars",
// "VerticalWave"). We normalize to snake_case so the enum matches the rest
// of lorcana-sim's conventions (cardType: "character", inkColors: "amber",
// rarity: "super_rare"). Unknown values are logged and returned undefined —
// preferable to silently emitting a string that doesn't match the enum
// because that would let a typo slip past the type system.

const FOIL_TYPE_MAP: Record<string, NonNullable<CardDefinitionOut["foilType"]>> = {
  Silver:         "silver",
  Lava:           "lava",
  Tempest:        "tempest",
  Satin:          "satin",
  FreeForm1:      "freeform_1",
  FreeForm2:      "freeform_2",
  VerticalWave:   "vertical_wave",
  Glitter:        "glitter",
  Magma:          "magma",
  Lore:           "lore",
  RainbowPillars: "rainbow_pillars",
  CalendarWave:   "calendar_wave",
  SeaWave:        "sea_wave",
};

const FOIL_TOP_LAYER_MAP: Record<string, NonNullable<CardDefinitionOut["foilTopLayer"]>> = {
  HighGloss:       "high_gloss",
  MetallicHotFoil: "metallic_hot_foil",
  SnowHotFoil:     "snow_hot_foil",
  RainbowHotFoil:  "rainbow_hot_foil",
  MatteHotFoil:    "matte_hot_foil",
};

let _warnedFoilTypes = new Set<string>();
let _warnedFoilTopLayers = new Set<string>();

function normalizeFoilType(raw: string | undefined): CardDefinitionOut["foilType"] {
  if (!raw || raw === "None") return undefined;
  const mapped = FOIL_TYPE_MAP[raw];
  if (!mapped && !_warnedFoilTypes.has(raw)) {
    console.warn(`  ⚠ Unknown foil_type "${raw}" — field skipped. Add to FOIL_TYPE_MAP in import-cards-rav.ts.`);
    _warnedFoilTypes.add(raw);
  }
  return mapped;
}

function normalizeFoilTopLayer(raw: string | undefined): CardDefinitionOut["foilTopLayer"] {
  if (!raw) return undefined;
  const mapped = FOIL_TOP_LAYER_MAP[raw];
  if (!mapped && !_warnedFoilTopLayers.has(raw)) {
    console.warn(`  ⚠ Unknown foil_top_layer "${raw}" — field skipped. Add to FOIL_TOP_LAYER_MAP in import-cards-rav.ts.`);
    _warnedFoilTopLayers.add(raw);
  }
  return mapped;
}

/** Validate + normalize a hot_foil_color hex string. Accepts `#RRGGBB` only
 *  (Ravensburger's convention). Returns undefined on invalid input rather
 *  than letting a malformed hex pass through. */
function normalizeHotFoilColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  return /^#[0-9a-f]{6}$/.test(lower) ? lower : undefined;
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
// Post-process normalization helpers come from scripts/lib/normalize-rules-text.ts
// and are shared with import-cards-lorcast.ts + the dev card-writer GUI endpoint.

function extractNamedAbilities(rawRulesText: string): { rulesText: string; stubs: AbilityStub[] } {
  if (!rawRulesText) return { rulesText: "", stubs: [] };
  // Scrub stray `%` section separators FIRST — Ravensburger's API encoding
  // sprinkles them before `\n`, before `\\name\\` markers, and before flavor
  // dashes. They corrupt downstream parsing (the backslash split below would
  // eat ") %" into a "name" segment) and they're never semantic percentages
  // (only "100%" passes the digit guard, which is in flavor text only).
  rawRulesText = stripStraySeparators(rawRulesText);
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

  // Post-process to canonicalize Ravensburger's own data inconsistencies so
  // the stored golden shape is self-consistent across cards and matches the
  // Lorcast importer + manual GUI entries. See scripts/lib/normalize-rules-text.ts
  // for the full convention.
  //   (1) Curly apostrophes (U+2019)
  //   (2) En-dash stat modifiers (Rav is inconsistent between `-2` and `–2`)
  //   (3) Curly double quotes around granted-ability text
  //   (4) Strip trailing whitespace before newlines
  //   (5) Wrap inline keyword refs — Rav wraps `<Challenger> +1` but leaves
  //       `gain Rush` unwrapped; we pick the uniform rule (always wrap outside
  //       reminder parens) so the GUI keyword highlighter can match every token.
  // Defense-in-depth: rewrite any surviving `\Name\` markers into the
  // `\nNAME ` golden shape BEFORE the rest of the line-level normalizations.
  // Triggers when Ravensburger returns a single-line rulesText that the
  // keyword-line filter swallowed whole (43 set-4/P1/P3 cards as of
  // 2026-04-27). No-op when the structured extraction path already cleaned
  // the markers. Runs before normalizeApostrophes so the canonicalized
  // story-name apostrophes get their curly treatment along with everything else.
  cleaned = stripAbilityNameMarkers(cleaned);
  cleaned = cleaned.split("\n").map(normalizeKeywordLine).join("\n");
  cleaned = normalizeApostrophes(cleaned);
  cleaned = normalizeDashes(cleaned);
  cleaned = normalizeDoubleQuotes(cleaned);
  cleaned = stripTrailingWhitespace(cleaned);
  for (const s of stubs) {
    s.rulesText = normalizeApostrophes(s.rulesText);
    s.raw = normalizeApostrophes(s.raw);
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
  const foiled = (c.variants ?? []).find((v) => v.variant_id === "Foiled");

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
    rarity: mapRarity(c.rarity, c.special_rarity_id),
    _source: "ravensburger",
    _ravensburgerId: c.culture_invariant_id,
  };

  if (c.subtitle) out.subtitle = c.subtitle;
  if (c.strength !== null) out.strength = c.strength;
  if (c.willpower !== null) out.willpower = c.willpower;
  if (c.quest_value !== null) out.lore = c.quest_value;
  if (shiftCost !== undefined) out.shiftCost = shiftCost;
  if (c.move_cost !== null) out.moveCost = c.move_cost;
  if (cleanRulesText) out.rulesText = cleanRulesText;
  if (c.flavor_text) out.flavorText = stripStraySeparators(c.flavor_text);
  if (regular?.detail_image_url) out.imageUrl = regular.detail_image_url;
  if (foiled?.detail_image_url) out.foilImageUrl = foiled.detail_image_url;

  // Foil metadata — prefer the Foiled variant, fall back to Regular. Some
  // Enchanteds and other foil-only rarities carry the mask + type on the
  // Regular entry because Ravensburger doesn't emit a distinct Foiled
  // variant for cards that ship foil-only. Matches collectbook's proven
  // extraction logic.
  const foilSrc = foiled ?? regular;
  const foilType = normalizeFoilType(foilSrc?.foil_type);
  if (foilType !== undefined) out.foilType = foilType;
  if (foilSrc?.foil_mask_url) out.foilMaskUrl = foilSrc.foil_mask_url;
  if (foilSrc?.foil_top_layer_mask_url) out.foilTopLayerMaskUrl = foilSrc.foil_top_layer_mask_url;
  const topLayer = normalizeFoilTopLayer(foilSrc?.foil_top_layer);
  if (topLayer !== undefined) out.foilTopLayer = topLayer;
  const hotColor = normalizeHotFoilColor(foilSrc?.hot_foil_color);
  if (hotColor !== undefined) out.hotFoilColor = hotColor;

  const finalStubs = applyStoryNameOverride(out.id, stubs);
  if (finalStubs.length > 0) out._namedAbilityStubs = finalStubs;

  return out;
}

// Derive maxCopies from a DeckRuleStatic ability's rule prose. Returns
// undefined if the card has no deck_rule ability (→ standard 4-copy cap).
//   Microbots:        "any number"      → 99 (treated as practical unlimited)
//   Dalmatian Puppy:  "up to 99 copies" → 99
//   Glass Slipper:    "only have 2"     → 2
function deriveMaxCopies(card: CardDefinitionOut): number | undefined {
  type DeckRuleAbility = { type?: string; effect?: { type?: string; rule?: string } };
  for (const ab of card.abilities as unknown as DeckRuleAbility[]) {
    if (ab?.effect?.type !== "deck_rule") continue;
    const rule = ab.effect.rule ?? "";
    if (/any number/i.test(rule)) return 99;
    const up = rule.match(/up to (\d+) copies/i);
    if (up) return parseInt(up[1]!, 10);
    const only = rule.match(/only have (\d+) copies/i);
    if (only) return parseInt(only[1]!, 10);
  }
  return undefined;
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

function mergeWithExisting(setCode: string, newCards: CardDefinitionOut[]): { preserved: number; keywordsRescued: number; reslugged: number; carriedOver: number; manualReplaced: number; sourceSkipped: number; lockedUpgradesAvailable: { slug: string; number: number; prevSource: string }[] } {
  const outPath = setJsonPath(setCode);
  if (!existsSync(outPath)) return { preserved: 0, keywordsRescued: 0, reslugged: 0, carriedOver: 0, manualReplaced: 0, sourceSkipped: 0, lockedUpgradesAvailable: [] };

  const existing: CardDefinitionOut[] = JSON.parse(readFileSync(outPath, "utf-8"));
  // Primary index: (id, number) composite. Same-slug-different-number is a
  // legitimate variant pattern (C2 reprints like Pegasus at #1 and #5 share
  // slug but are distinct printings), so an id-only Map collapses variants
  // under last-wins semantics. When the merge swaps prev in (hierarchy /
  // lock), multiple incoming same-slug cards all resolve to the same Map
  // entry and collapse to duplicates. Composite key avoids that.
  const existingByIdNum = new Map(
    existing.map((c) => [`${c.id}|${c.number}`, c])
  );
  // Fallback index: (number, normalized-fullName) → card. Catches cases where
  // a slug has changed across re-imports due to apostrophe/diacritic fixes.
  const existingByNormName = new Map(
    existing.map((c) => [`${c.number}|${normName(c.fullName)}`, c])
  );
  // Last-resort fallback for manual entries ONLY: number alone within the set.
  // Manual entries may have a totally-wrong guessed name/subtitle (the user
  // added a card pre-reveal); when Ravensburger publishes, we want to replace
  // the manual guess even though the slug + fullName don't match. Restricted
  // to _source:"manual" so a legitimate slug rename on a ravensburger entry
  // doesn't incorrectly collide with another card at the same number.
  const manualByNumber = new Map<number, CardDefinitionOut>();
  for (const c of existing) {
    if (c._source === "manual") manualByNumber.set(c.number, c);
  }
  let preserved = 0;
  let keywordsRescued = 0;
  let reslugged = 0;
  let manualReplaced = 0;
  let sourceSkipped = 0;
  // Cards where a `_sourceLock: true` prevented a tier upgrade — i.e. we're
  // holding a lorcast/manual entry while Ravensburger now publishes the
  // same card. Surfaced at the end of the import so the user can decide
  // whether to unlock + re-run (Lorcast's transcription may have been
  // corrected upstream, Ravensburger may now supply authoritative data, etc).
  const lockedUpgradesAvailable: { slug: string; number: number; prevSource: string }[] = [];

  for (let i = 0; i < newCards.length; i++) {
    const card = newCards[i]!;
    let prev = existingByIdNum.get(`${card.id}|${card.number}`);
    if (!prev) {
      // Slug changed across re-import — match by number + normalized name.
      prev = existingByNormName.get(`${card.number}|${normName(card.fullName)}`);
      if (prev) reslugged++;
    }
    if (!prev) {
      // Last resort: match a pre-reveal manual entry by number alone.
      prev = manualByNumber.get(card.number);
      if (prev) manualReplaced++;
    }
    if (!prev) continue;

    // Hard lock: if the existing entry is _sourceLock: true, NO importer
    // overwrites it regardless of tier. Used for cards where Ravensburger's
    // data is wrong (e.g. The Bayou's ability name). Swap prev into newCards
    // so the written JSON keeps the locked data.
    if (prev._sourceLock) {
      newCards[i] = prev;
      sourceSkipped++;
      // Reaching this branch means Ravensburger IS now publishing this card
      // (we're iterating over mapped Rav API results). If the locked entry
      // is lower-tier, that's an upgrade opportunity the user may want — we
      // surface it at the end so they can remove the lock and re-run.
      if (prev._source !== "ravensburger") {
        lockedUpgradesAvailable.push({ slug: prev.id, number: prev.number, prevSource: prev._source });
      }
      continue;
    }
    // Hierarchy check: ravensburger > lorcast > manual. Never downgrade.
    // (Irrelevant here since mapCard always stamps ravensburger, but the
    // Lorcast importer shares this merge util and must honor the tier.)
    if (sourceTier(card._source) < sourceTier(prev._source)) {
      newCards[i] = prev;
      sourceSkipped++;
      continue;
    }

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
      "foilImageUrl",
      // Image-sync fields — carried over so sync-images-rav's idempotency
      // check survives re-imports. The importer DOES overwrite `imageUrl`
      // (with the current Rav URL), but we preserve the source markers so
      // sync-images-rav can compare the fresh Rav URL against the stored
      // `_sourceImageUrl` and only re-sync when Ravensburger rotates
      // content. See docs/HANDOFF.md → self-host card images on R2.
      "_imageSource", "_sourceImageUrl", "_imageSourceLock",
      // Ravensburger stable numeric id — the importer DOES set this on
      // Ravensburger-sourced cards, but carrying it through the merge
      // step protects against the case where a re-import pulls a card
      // from a different ink-color filter that lacks the field (it won't,
      // but defensive parity with other passthroughs).
      "_ravensburgerId",
      // Foil treatment metadata — same defensive passthrough as the
      // Ravensburger id. The importer sets these on Ravensburger-sourced
      // cards; the passthrough ensures the foil data survives a sibling
      // set re-import that happens to omit a card, or a future importer
      // that doesn't yet know about these fields.
      //
      // Note: the importer DOES overwrite foilMaskUrl/foilTopLayerMaskUrl
      // with the fresh upstream URL on every re-import — same way it does
      // for imageUrl. The `_foilMaskSourceUrl` / `_foilTopMaskSourceUrl`
      // passthroughs survive so sync-foil-masks can detect whether upstream
      // has rotated (different URL) vs just-reimported (same URL) and
      // skip the re-fetch accordingly.
      "foilType", "foilMaskUrl", "foilTopLayerMaskUrl", "foilTopLayer", "hotFoilColor",
      "_foilMaskSource", "_foilMaskSourceUrl", "_foilTopMaskSourceUrl", "_foilMaskSourceLock",
    ];
    for (const field of passthroughFields) {
      const prevVal = (prev as Record<string, unknown>)[field];
      const newVal = (card as Record<string, unknown>)[field];
      if (newVal === undefined && prevVal !== undefined) {
        (card as Record<string, unknown>)[field] = prevVal;
      }
    }
  }

  // Carry over existing cards NOT present in the incoming batch. Partial
  // imports (e.g. `--sets set12`) only fetch cards for the specified filter;
  // any promo/shared file (P1/P2/P3/C1/C2/D23) also receives a slice in the
  // same run. Without this carry-over, those files get truncated to just the
  // slice (42-card P3 wipe bug from 2026-04-18). Matches on id, with a
  // (number, normName) fallback to survive slug renames.
  let carriedOver = 0;
  const incomingByIdNum = new Set(newCards.map((c) => `${c.id}|${c.number}`));
  const incomingByKey = new Set(newCards.map((c) => `${c.number}|${normName(c.fullName)}`));
  for (const prev of existing) {
    if (incomingByIdNum.has(`${prev.id}|${prev.number}`)) continue;
    if (incomingByKey.has(`${prev.number}|${normName(prev.fullName)}`)) continue;
    newCards.push(prev);
    carriedOver++;
  }

  return { preserved, keywordsRescued, reslugged, carriedOver, manualReplaced, sourceSkipped, lockedUpgradesAvailable };
}

// =============================================================================
// MAIN
// =============================================================================

// Default set list — main sets only. `quest1` / `quest2` filters exist in
// Ravensburger's API but return the same cards as the main-set filters: the
// Illumineer's Quest product re-uses main-set cards (e.g. Piglet Pooh Pirate
// Captain 223/204 EN 3 is a set 3 alt-art, tagged `card_sets: ["quest1",
// "set3"]`). Importing via quest* filters duplicates data the main-set filters
// already deliver. Truly PvE-exclusive cards (Anna — Ensnared Sister type)
// aren't in Ravensburger's API at all — would need a separate source if ever
// needed. See HANDOFF.md.
const ALL_RAV_FILTERS = [
  "set1","set2","set3","set4","set5","set6","set7","set8","set9","set10","set11","set12",
];

// Map Ravensburger filter → project setId (used as JSON filename)
function ravFilterToSetId(filter: string): string {
  const m = filter.match(/^set(\d+)$/i);
  if (m) return m[1]!;
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
    const { preserved, keywordsRescued, reslugged, carriedOver, manualReplaced, sourceSkipped, lockedUpgradesAvailable } = mergeWithExisting(setCode, setCards);
    if (preserved > 0 || keywordsRescued > 0 || reslugged > 0 || carriedOver > 0 || manualReplaced > 0 || sourceSkipped > 0) {
      console.log(`  Preserved manual abilities on ${preserved} card(s) in set ${setCode}` +
        (keywordsRescued > 0 ? `; rescued ${keywordsRescued} keyword field(s)` : "") +
        (reslugged > 0 ? `; ${reslugged} card(s) matched via renamed slug` : "") +
        (carriedOver > 0 ? `; carried over ${carriedOver} card(s) not in this batch` : "") +
        (manualReplaced > 0 ? `; replaced ${manualReplaced} manual pre-reveal entry/entries` : "") +
        (sourceSkipped > 0 ? `; skipped ${sourceSkipped} card(s) (lower-tier source would downgrade existing data)` : "") + ".");
    }
    // Flag _sourceLock cards where Ravensburger NOW publishes the same card —
    // the lock is preventing a potential tier upgrade. User can remove the
    // lock and re-run if the upstream correction matches our locked value.
    if (lockedUpgradesAvailable.length > 0) {
      console.log(`  ⚠ ${lockedUpgradesAvailable.length} locked card(s) in set ${setCode} could be upgraded — Ravensburger now publishes this data:`);
      for (const c of lockedUpgradesAvailable) {
        console.log(`      - ${c.slug} #${c.number} (currently _source: "${c.prevSource}", _sourceLock: true)`);
      }
      console.log(`    If the upstream transcription is now correct, remove _sourceLock: true and re-run.`);
    }
    // Derive maxCopies from any deck_rule abilities now that manually-wired
    // abilities have been merged back in. Cards without a deck_rule ability
    // get undefined (UI falls back to the standard 4-copy cap).
    for (const card of setCards) {
      const mc = deriveMaxCopies(card);
      if (mc !== undefined) card.maxCopies = mc;
      else delete card.maxCopies;
    }
    // Sort by number for stable diff
    setCards.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    writeFileSync(outPath, JSON.stringify(setCards, null, 2), "utf-8");
    console.log(`  Wrote ${setCards.length} cards → ${outPath}`);
  }

  // Regenerate cardDefinitions.ts with ALL set files present on disk (not just
  // the ones we imported this run — so partial re-imports don't drop other
  // sets or promo files that still come from the old importer).
  // Sort: numeric main sets first (in numeric order), then alphanumeric codes
  // (promo P1/P2/P3, challenge C1/C2, convention D23) in lex order. Plain
  // .sort() would produce "1, 10, 11, 12, 2, 3, ..." — natural-ish order is
  // friendlier to humans reading the diff.
  const allSetCodes = readdirSync(OUT_DIR)
    .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"))
    .map((f) => f.replace(/^card-set-/, "").replace(/\.json$/, ""))
    .sort((a, b) => {
      const aNum = /^\d+$/.test(a);
      const bNum = /^\d+$/.test(b);
      if (aNum && bNum) return parseInt(a, 10) - parseInt(b, 10);
      if (aNum) return -1;
      if (bNum) return 1;
      return a.localeCompare(b);
    });
  const setImports = allSetCodes.map((code) =>
    `import set${code} from "./card-set-${code}.json" assert { type: "json" };`
  );
  const setSpread = allSetCodes.map((code) => `  ...loadSet(set${code}),`);

  const tsModule = `// =============================================================================
// CARD DEFINITIONS — loads per-set JSON files and merges them.
// Card data is auto-generated by scripts/import-cards-rav.ts  or
// scripts/import-cards-rav.ts (Ravensburger). Abilities are manually
// implemented. Add new sets by re-running the import script.
// =============================================================================

import type { CardDefinition } from "../types/index.js";
import { buildCardDefinitions } from "./buildDefinitions.js";
${setImports.join("\n")}

type RawCard = CardDefinition & { _namedAbilityStubs?: string[] };

function loadSet(raw: unknown[]): CardDefinition[] {
  return (raw as RawCard[])
    .map(({ _namedAbilityStubs: _, ...card }) => card as unknown as CardDefinition);
}

const cards = [
${setSpread.join("\n")}
];

const built = buildCardDefinitions(cards);

/** Canonical definition per slug. Duplicates across sets (reprints, enchanted
 *  alt-arts, promos) collapse into one entry with \`variants[]\` listing the
 *  distinct visual printings. */
export const CARD_DEFINITIONS: Record<string, CardDefinition> = built.byId;

export const ALL_CARDS: CardDefinition[] = built.all;
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
