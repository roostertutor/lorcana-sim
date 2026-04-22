#!/usr/bin/env node
// =============================================================================
// LORCAST CARD IMPORTER (rescue importer)
// Fetches card data from https://api.lorcast.com/v0 to fill the subset of
// promo/special cards that don't appear as reprints in Ravensburger's main-set
// responses. Ravensburger serves most promos (P1/P2/P3/C1/C2/D23) via the
// main-set piggyback path — see PROMO_TOTAL_CODES in import-cards-rav.ts — but
// some sets have exclusives that never appear as a main-set reprint:
//   - DIS (EPCOT Festival of the Arts)  — exclusives not served by Ravensburger
//   - cp  (Challenge Promo)              — exclusives not served by Ravensburger
//   - D23 (D23 Collection)               — some unique entries
//   - C2  (Lorcana Challenge Year 3)     — exclusives not served by Ravensburger
// Also a fallback for pre-release windows when Lorcast publishes main-set data
// before Ravensburger updates; those entries get upgraded to `ravensburger` on
// the next `pnpm import-cards` once the official API catches up.
//
// Usage:
//   pnpm import-cards-lorcast                 fetch default gap sets (DIS/cp/D23/C2)
//   pnpm import-cards-lorcast --sets DIS,cp   specific sets
//   pnpm import-cards-lorcast --sets 12       main-set fallback (set 12)
//   pnpm import-cards-lorcast --sets all      every Lorcast set (no-op on existing ravensburger data)
//   pnpm import-cards-lorcast --dry           print output, don't write
//
// Set code mapping: Lorcast `cp` → project `C1` (historical project convention;
// previous project importers renamed this when cp was imported). All other set
// codes pass through unchanged.
//
// Hierarchy: ravensburger > lorcast > manual. This importer stamps `_source:
// "lorcast"` and uses the shared merge util, which refuses to downgrade a
// ravensburger-tier entry. So running `--sets all` on a repo that already has
// Ravensburger data is safe — only holes get filled.
//
// Cards with `_sourceLock: true` are never overwritten regardless of tier —
// used for cards where Ravensburger's data is wrong (e.g. The Bayou's ability
// name). Manually set the flag on a card JSON entry after verifying its data.
// =============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeRulesText } from "./lib/normalize-rules-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "packages/engine/src/cards");
const OUT_TS = join(OUT_DIR, "cardDefinitions.ts");

function setJsonPath(setCode: string): string {
  return join(OUT_DIR, `card-set-${setCode}.json`);
}

const API_BASE = "https://api.lorcast.com/v0";
const RATE_LIMIT_MS = 110;

// Sets Lorcast publishes but Ravensburger doesn't — the rescue scope.
// Quest sets (Q1/Q2) don't exist on Lorcast either, so they stay manual-only.
const DEFAULT_GAP_SETS = ["cp", "D23", "DIS", "C2"];

// Lorcast set code → project setId. Anything not listed passes through verbatim.
const SET_CODE_MAP: Record<string, string> = {
  cp: "C1",  // Challenge Promo → project's C1 (historical rename)
};

function projectSetId(lorcastCode: string): string {
  return SET_CODE_MAP[lorcastCode] ?? lorcastCode;
}

// =============================================================================
// LORCAST API TYPES
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
// OUTPUT TYPE (matches Ravensburger importer)
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
  rarity: "common" | "uncommon" | "rare" | "super_rare" | "legendary" | "enchanted" | "special" | "iconic" | "epic";
  imageUrl?: string;
  foilImageUrl?: string;
  actionEffects?: object[];
  _namedAbilityStubs?: AbilityStub[];
  _source?: "ravensburger" | "lorcast" | "manual";
  _sourceLock?: boolean;
}

type SingleInkColor = CardDefinitionOut["inkColors"][number];
type CardSource = NonNullable<CardDefinitionOut["_source"]>;
const SOURCE_TIER: Record<CardSource, number> = { manual: 0, lorcast: 1, ravensburger: 2 };
function sourceTier(s: CardSource | undefined): number {
  // Missing _source means lowest priority (manual) — see import-cards-rav.ts
  // for the full backfill → ravensburger → lorcast → manual flow.
  return SOURCE_TIER[s ?? "manual"];
}

// =============================================================================
// MAPPERS
// =============================================================================

function slugify(name: string, version: string | null): string {
  const raw = version ? `${name} ${version}` : name;
  return raw
    .toLowerCase()
    .replace(/[\u0027\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapCardType(types: string[]): CardDefinitionOut["cardType"] {
  const lower = types.map((t) => t.toLowerCase());
  if (lower.includes("character")) return "character";
  if (lower.includes("item")) return "item";
  if (lower.includes("location")) return "location";
  return "action";
}

function mapSingleInk(ink: string): SingleInkColor | null {
  const valid: SingleInkColor[] = ["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"];
  const l = ink.toLowerCase() as SingleInkColor;
  return valid.includes(l) ? l : null;
}

function mapInkColors(ink: string | null, inks: string[] | null): SingleInkColor[] | null {
  if (inks && inks.length > 0) {
    const mapped = inks.map(mapSingleInk).filter((c): c is SingleInkColor => c !== null);
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

const KEYWORD_LINE_PREFIXES = [
  "Singer", "Shift", "Challenger", "Bodyguard", "Rush", "Evasive",
  "Ward", "Support", "Reckless", "Resist", "Vanish", "Alert", "Boost",
  "Sing Together",
];

// rulesText normalization is in scripts/lib/normalize-rules-text.ts (shared
// with import-cards-rav.ts and the dev card-writer GUI endpoint). See the
// module's header comment for the full golden-shape convention.

function parseKeywordAbilities(
  lorcastKeywords: string[],
  text: string | null
): { abilities: KeywordAbility[]; shiftCost: number | undefined } {
  const abilities: KeywordAbility[] = [];
  let shiftCost: number | undefined;

  for (const kw of lorcastKeywords) {
    const k = kw.toLowerCase();
    switch (k) {
      case "rush":      abilities.push({ type: "keyword", keyword: "rush" }); break;
      case "evasive":   abilities.push({ type: "keyword", keyword: "evasive" }); break;
      case "bodyguard": abilities.push({ type: "keyword", keyword: "bodyguard" }); break;
      case "ward":      abilities.push({ type: "keyword", keyword: "ward" }); break;
      case "reckless":  abilities.push({ type: "keyword", keyword: "reckless" }); break;
      case "support":   abilities.push({ type: "keyword", keyword: "support" }); break;
      case "vanish":    abilities.push({ type: "keyword", keyword: "vanish" }); break;
      case "alert":     abilities.push({ type: "keyword", keyword: "alert" }); break;
      case "challenger": {
        const m = text?.match(/Challenger \+(\d+)/);
        abilities.push({ type: "keyword", keyword: "challenger", value: m ? parseInt(m[1]!, 10) : 1 });
        break;
      }
      case "singer": {
        const m = text?.match(/Singer (\d+)/);
        abilities.push({ type: "keyword", keyword: "singer", value: m ? parseInt(m[1]!, 10) : 5 });
        break;
      }
      case "shift": {
        const m = text?.match(/Shift (\d+)/);
        shiftCost = m ? parseInt(m[1]!, 10) : undefined;
        if (shiftCost !== undefined) abilities.push({ type: "keyword", keyword: "shift", value: shiftCost });
        break;
      }
      case "resist": {
        const m = text?.match(/Resist \+(\d+)/);
        abilities.push({ type: "keyword", keyword: "resist", value: m ? parseInt(m[1]!, 10) : 1 });
        break;
      }
      case "boost": {
        const m = text?.match(/Boost (\d+)/);
        abilities.push({ type: "keyword", keyword: "boost", value: m ? parseInt(m[1]!, 10) : 1 });
        break;
      }
      default:
        abilities.push({ type: "keyword", keyword: k });
    }
  }
  return { abilities, shiftCost };
}

function detectNamedAbilities(text: string | null): AbilityStub[] {
  if (!text) return [];
  const stubs: AbilityStub[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (KEYWORD_LINE_PREFIXES.some((kw) => line.startsWith(kw))) continue;
    const m = line.match(/^([A-Z][A-Z0-9' ,!?.…-]+?)(?:\s*\{E\}|\s*\(|\s+[a-z0-9{(]|\s+[A-Z][a-z])/);
    if (m) {
      const storyName = m[1]!.trim();
      let rulesText = line.slice(storyName.length).trim();
      rulesText = rulesText.replace(/^\{E\}(?:,\s*\d+\s*\{I\})?\s*[–—-]\s*/, "").trim();
      stubs.push({ storyName, rulesText: rulesText || line, raw: line });
    }
  }
  return stubs;
}

function mapCard(c: LorcastCard): CardDefinitionOut | null {
  const inkColors = mapInkColors(c.ink, c.inks);
  if (!inkColors) return null;

  const { abilities, shiftCost } = parseKeywordAbilities(c.keywords, c.text);
  const namedStubs = detectNamedAbilities(c.text);

  const traits = [...(c.classifications ?? [])];
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
    setId: projectSetId(c.set.code),
    number: parseInt(c.collector_number, 10) || 0,
    rarity: mapRarity(c.rarity),
    _source: "lorcast",
  };

  if (c.version) out.subtitle = c.version;
  if (c.strength !== null) out.strength = c.strength;
  if (c.willpower !== null) out.willpower = c.willpower;
  if (c.lore !== null) out.lore = c.lore;
  if (shiftCost !== undefined) out.shiftCost = shiftCost;
  if (c.move_cost !== null) out.moveCost = c.move_cost;
  if (c.text) {
    const normalized = normalizeRulesText(c.text);
    if (normalized) out.rulesText = normalized;
  }
  if (c.flavor_text) out.flavorText = c.flavor_text;
  if (c.image_uris?.digital?.normal) out.imageUrl = c.image_uris.digital.normal;
  if (namedStubs.length > 0) out._namedAbilityStubs = namedStubs;

  return out;
}

// =============================================================================
// MERGE — duplicated from import-cards-rav.ts. Must stay in sync when the
// shape of merge preservation changes. The key behavioral differences here:
// this importer stamps _source: "lorcast", so prev.ravensburger entries get
// skipped by the tier check and survive untouched.
// =============================================================================

function normName(s: string): string {
  return (s ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function mergeWithExisting(setCode: string, newCards: CardDefinitionOut[]): {
  preserved: number; keywordsRescued: number; reslugged: number; carriedOver: number;
  manualReplaced: number; sourceSkipped: number;
} {
  const outPath = setJsonPath(setCode);
  if (!existsSync(outPath)) return { preserved: 0, keywordsRescued: 0, reslugged: 0, carriedOver: 0, manualReplaced: 0, sourceSkipped: 0 };

  const existing: CardDefinitionOut[] = JSON.parse(readFileSync(outPath, "utf-8"));
  // (id, number) composite — same-slug-different-number is a legitimate
  // variant pattern (e.g. Pegasus at #1 and #5 in C2 reprints). See the
  // Ravensburger importer's matching block for the full rationale.
  const existingByIdNum = new Map(existing.map((c) => [`${c.id}|${c.number}`, c]));
  // id-only (last-wins) — for the cross-source drop check below.
  const existingById = new Map(existing.map((c) => [c.id, c]));
  const existingByNormName = new Map(
    existing.map((c) => [`${c.number}|${normName(c.fullName)}`, c])
  );
  const manualByNumber = new Map<number, CardDefinitionOut>();
  for (const c of existing) {
    if (c._source === "manual") manualByNumber.set(c.number, c);
  }
  let preserved = 0, keywordsRescued = 0, reslugged = 0, manualReplaced = 0, sourceSkipped = 0;
  const droppedIndices = new Set<number>();

  for (let i = 0; i < newCards.length; i++) {
    const card = newCards[i]!;

    // Cross-source numbering divergence check: Lorcast's numbering for
    // reprint sets (cp → C1) differs from Ravensburger's (e.g. Dragon
    // Fire at Lorcast #25 vs Ravensburger #1 — same card, different
    // numbering convention). When incoming is lower-tier and a same-slug
    // higher-tier entry exists at ANY number, the incoming is redundant:
    // drop it entirely so it doesn't create a duplicate of a card that's
    // already covered. The existing higher-tier entry gets carried over.
    const idOnlyMatch = existingById.get(card.id);
    if (idOnlyMatch && sourceTier(card._source) < sourceTier(idOnlyMatch._source)) {
      droppedIndices.add(i);
      sourceSkipped++;
      continue;
    }

    let prev = existingByIdNum.get(`${card.id}|${card.number}`);
    if (!prev) {
      prev = existingByNormName.get(`${card.number}|${normName(card.fullName)}`);
      if (prev) reslugged++;
    }
    if (!prev) {
      prev = manualByNumber.get(card.number);
      if (prev) manualReplaced++;
    }
    if (!prev) continue;

    // Lock: untouchable regardless of tier.
    if (prev._sourceLock) {
      newCards[i] = prev;
      sourceSkipped++;
      continue;
    }
    // Hierarchy: don't downgrade. A ravensburger entry survives a lorcast import.
    if (sourceTier(card._source) < sourceTier(prev._source)) {
      newCards[i] = prev;
      sourceSkipped++;
      continue;
    }

    // Preserve manual (non-keyword) abilities across re-imports.
    const manualAbilities = prev.abilities.filter((a) => a.type !== "keyword");
    if (manualAbilities.length > 0) {
      card.abilities = [...card.abilities, ...manualAbilities] as KeywordAbility[];
      preserved++;
    }

    // UNION keyword abilities.
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

    if (prev.actionEffects && prev.actionEffects.length > 0) {
      card.actionEffects = prev.actionEffects;
      preserved++;
    }

    const passthroughFields = [
      "alternateNames", "playRestrictions", "altPlayCost",
      "selfCostReduction", "shiftCost", "altShiftCost",
      "moveCost", "singTogetherCost",
      "foilImageUrl",
      // Image-sync fields — see matching comment in import-cards-rav.ts.
      "_imageSource", "_sourceImageUrl", "_imageSourceLock",
      // Ravensburger stable numeric id. Lorcast-sourced cards don't set
      // this, but if a card was previously ravensburger-sourced and is
      // being upgraded (shouldn't happen — ravensburger > lorcast) or a
      // sibling ravensburger entry is being merged, the id should survive.
      "_ravensburgerId",
    ];
    for (const field of passthroughFields) {
      const prevVal = (prev as Record<string, unknown>)[field];
      const newVal = (card as Record<string, unknown>)[field];
      if (newVal === undefined && prevVal !== undefined) {
        (card as Record<string, unknown>)[field] = prevVal;
      }
    }
  }

  // Remove cards dropped by the cross-source check above. Splice in reverse
  // index order so later indices stay valid. Mutate in-place to preserve the
  // caller's array reference.
  if (droppedIndices.size > 0) {
    const sortedDropped = [...droppedIndices].sort((a, b) => b - a);
    for (const idx of sortedDropped) newCards.splice(idx, 1);
  }

  // Carry over existing cards not in this batch (same logic as rav importer).
  let carriedOver = 0;
  const incomingByIdNum = new Set(newCards.map((c) => `${c.id}|${c.number}`));
  const incomingByKey = new Set(newCards.map((c) => `${c.number}|${normName(c.fullName)}`));
  // Also track ids claimed via the cross-source drop: existing entries with
  // these ids have been "accounted for" by the drop, so they carry over
  // normally (no dedup needed — they were never in newCards).
  for (const prev of existing) {
    if (incomingByIdNum.has(`${prev.id}|${prev.number}`)) continue;
    if (incomingByKey.has(`${prev.number}|${normName(prev.fullName)}`)) continue;
    newCards.push(prev);
    carriedOver++;
  }

  return { preserved, keywordsRescued, reslugged, carriedOver, manualReplaced, sourceSkipped };
}

// =============================================================================
// FETCH
// =============================================================================

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Lorcast ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// =============================================================================
// MAIN
// =============================================================================

const argv = process.argv.slice(2);
function getFlag(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  if (eq) return eq;
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) return argv[idx + 1];
  return undefined;
}
const setsArg = getFlag("sets");
const isDry = argv.includes("--dry");

async function main() {
  console.log("Fetching sets from Lorcast API...");
  const { results: allSets } = await apiFetch<{ results: LorcastSet[] }>("/sets");
  await sleep(RATE_LIMIT_MS);

  const targetCodes = !setsArg
    ? new Set(DEFAULT_GAP_SETS.map((s) => s.toLowerCase()))
    : setsArg === "all"
      ? null
      : new Set(setsArg.split(",").map((s) => s.trim().toLowerCase()));

  const sets = targetCodes === null
    ? allSets
    : allSets.filter((s) => targetCodes.has(s.code.toLowerCase()));

  if (sets.length === 0) {
    console.error(`No sets matched. Available: ${allSets.map((s) => s.code).join(", ")}`);
    process.exit(1);
  }

  const scopeLabel = !setsArg ? "(default gap sets)" : setsArg === "all" ? "(all)" : "(specified)";
  console.log(`Importing from Lorcast API — ${sets.length} set(s) ${scopeLabel}: ${sets.map((s) => s.code).join(", ")}\n`);

  const allCards: CardDefinitionOut[] = [];
  let skipped = 0;

  for (const set of sets) {
    process.stdout.write(`  ${set.code.padEnd(6)} → project ${projectSetId(set.code).padEnd(4)} `);
    const cards = await apiFetch<LorcastCard[]>(`/sets/${set.code}/cards`);
    await sleep(RATE_LIMIT_MS);

    let setCount = 0;
    for (const c of cards) {
      const mapped = mapCard(c);
      if (!mapped) { skipped++; continue; }
      allCards.push(mapped);
      setCount++;
    }
    console.log(`${setCount} cards`);
  }

  const withStubs = allCards.filter((c) => (c._namedAbilityStubs?.length ?? 0) > 0);

  console.log(`
──────────────────────────────────────
  Total cards imported:  ${allCards.length}
  Skipped (no ink color): ${skipped}
  Have named stubs:      ${withStubs.length} cards
──────────────────────────────────────`);

  if (isDry) {
    console.log("\nDry run — first 2 cards:");
    console.log(JSON.stringify(allCards.slice(0, 2), null, 2));
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Group by project setId (post-mapping). Multiple Lorcast codes could in
  // principle collapse into one project setId, though currently only cp → C1.
  const cardsBySet = new Map<string, CardDefinitionOut[]>();
  for (const card of allCards) {
    if (!cardsBySet.has(card.setId)) cardsBySet.set(card.setId, []);
    cardsBySet.get(card.setId)!.push(card);
  }

  for (const [setCode, setCards] of cardsBySet) {
    const outPath = setJsonPath(setCode);
    const stats = mergeWithExisting(setCode, setCards);
    const anyStat = stats.preserved + stats.keywordsRescued + stats.reslugged +
      stats.carriedOver + stats.manualReplaced + stats.sourceSkipped;
    if (anyStat > 0) {
      console.log(`  Set ${setCode}: preserved=${stats.preserved} rescued-keywords=${stats.keywordsRescued} ` +
        `reslugged=${stats.reslugged} carried-over=${stats.carriedOver} ` +
        `manual-replaced=${stats.manualReplaced} source-skipped=${stats.sourceSkipped}`);
    }
    setCards.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    writeFileSync(outPath, JSON.stringify(setCards, null, 2), "utf-8");
    console.log(`  Wrote ${setCards.length} cards → ${outPath}`);
  }

  // Regenerate cardDefinitions.ts to pick up any new set files.
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
// Card data is auto-generated by scripts/import-cards-rav.ts (Ravensburger) or
// scripts/import-cards-lorcast.ts (Lorcast rescue). Abilities are manually
// implemented. Add new sets by re-running an import script.
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
  console.log(`  Wrote TS module → ${OUT_TS}`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
