// =============================================================================
// deckRules — small utilities for deck construction rules.
// maxCopies is set by the engine importer from DeckRuleStatic.rule parsing;
// the UI just reads def.maxCopies (default 4 if unset).
// =============================================================================

import type { CardDefinition, CardVariant, CardVariantType, DeckEntry, InkColor } from "@lorcana-sim/engine";

/** Standard 4-copy rule unless the card has an exception (Dalmatian Puppy = 99,
 *  Glass Slipper = 2, Microbots = any). */
export function getMaxCopies(def: CardDefinition): number {
  return def.maxCopies ?? 4;
}

/** Number of cards in the deck, per definition id. */
export function countById(
  entries: { definitionId: string; count: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) map.set(e.definitionId, e.count);
  return map;
}

/** Canonical ink color ordering — used wherever we render the ink set
 *  in a stable left-to-right / top-to-bottom sequence (deck tile gems,
 *  filter chips, quick-start empty states). */
export const INK_ORDER: InkColor[] = ["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"];

/** Tailwind bg-* class per ink color — shared by gem dots + filter chip
 *  backgrounds across the UI so the palette stays consistent and matches
 *  the official Lorcana ink colors. Hex values are extracted from the
 *  `.st0` / primary fills of the ink SVGs in assets/icons/ink/ so the
 *  chip/dot and the gem icon visibly match. */
export const INK_COLOR_HEX: Record<InkColor, string> = {
  amber: "#f4b223",
  amethyst: "#7c4182",
  emerald: "#329044",
  ruby: "#d50037",
  sapphire: "#0093c9",
  steel: "#97a3ae",
};

/** Tailwind `bg-[#...]` class form of the ink hex — useful in component
 *  className strings where inline style is awkward. */
export const INK_COLOR_CLASS: Record<InkColor, string> = {
  amber: "bg-[#f4b223]",
  amethyst: "bg-[#7c4182]",
  emerald: "bg-[#329044]",
  ruby: "bg-[#d50037]",
  sapphire: "bg-[#0093c9]",
  steel: "bg-[#97a3ae]",
};
export function deckInkColors(
  entries: DeckEntry[],
  definitions: Record<string, CardDefinition>,
): InkColor[] {
  const present = new Set<InkColor>();
  for (const e of entries) {
    const def = definitions[e.definitionId];
    if (!def) continue;
    for (const c of def.inkColors) present.add(c);
  }
  return INK_ORDER.filter((c) => present.has(c));
}

// ─── Search matching ────────────────────────────────────────────────────
// Both the inline DeckBuilder "Add a card" autocomplete and the
// CardPicker browser feed queries through this matcher so they behave
// consistently. Searches against: fullName, traits[], def.rulesText,
// and each ability's storyName + rulesText. Returns a sortable score
// (higher = better match, -1 = no match) so results rank predictably
// (name-prefix > name-contains > trait > ability name > rules text).

/** Return a match score for `def` against query `q`. -1 = no match.
 *  Higher = better. Use for filter + sort. */
export function cardMatchScore(def: CardDefinition, q: string): number {
  const query = q.trim().toLowerCase();
  if (!query) return 0;
  const name = def.fullName.toLowerCase();
  if (name.startsWith(query)) return 1000 - def.fullName.length;
  if (name.includes(query)) return 500 - def.fullName.length;
  for (const t of def.traits) {
    if (t.toLowerCase().includes(query)) return 300;
  }
  // Abilities: storyName (the BOLD ability name on the card) scores
  // higher than rulesText so "smooth the way" finds Grandmother Willow
  // by the ability name before it surfaces every card that says
  // "smooth" in a rules paragraph.
  for (const a of def.abilities) {
    const storyName = (a as { storyName?: string }).storyName;
    if (storyName && storyName.toLowerCase().includes(query)) return 200;
  }
  const defRules = (def.rulesText ?? "").toLowerCase();
  if (defRules.includes(query)) return 100;
  for (const a of def.abilities) {
    const rulesText = (a as { rulesText?: string }).rulesText;
    if (rulesText && rulesText.toLowerCase().includes(query)) return 100;
  }
  return -1;
}

/** Apply persisted variant choices from a card_metadata map onto parsed
 *  DeckEntry[]. decklist_text is intentionally vanilla for external-tool
 *  interop (Inkable, Dreamborn, etc.), so variants live in the sibling
 *  JSONB column and get joined here. Any surface that renders deck art
 *  from a parsed decklist needs to hydrate first or it'll fall back to
 *  the regular variant. */
export function hydrateVariants<T extends { definitionId: string; variant?: string }>(
  entries: T[],
  metadata: Record<string, { variant?: string }> | null | undefined,
): T[] {
  if (!metadata) return entries;
  return entries.map((e) => {
    const meta = metadata[e.definitionId];
    if (meta?.variant) return { ...e, variant: meta.variant };
    return e;
  });
}

// ─── Variant key parsing ────────────────────────────────────────────────
// The engine's variant-collapse fix surfaces every printing on
// CardDefinition.printings[]. Two printings can share a CardVariantType
// (e.g., Captain Hook - Forceful Duelist has "regular" in both set 1 and
// set 8). DeckEntry.variant is typed as CardVariantType for engine
// type-safety, but runtime strings can carry a disambiguator —
// "<type>:<setId>#<number>" — when the user picks a specific non-default
// printing of a multi-printing type. A bare "enchanted" means "newest
// enchanted printing", keeping legacy stored metadata working.

export interface ParsedVariantKey {
  type: CardVariantType;
  /** Present only when the user picked a specific non-newest printing. */
  setId?: string;
  number?: number;
}

export function parseVariantKey(key: string | undefined | null): ParsedVariantKey | null {
  if (!key) return null;
  const m = key.match(/^([a-z_]+)(?::([^#]+)#(\d+))?$/);
  if (!m) return null;
  const type = m[1] as CardVariantType;
  if (m[2] && m[3]) return { type, setId: m[2], number: parseInt(m[3], 10) };
  return { type };
}

/** Format a specific printing as a variant key. Returns the bare type when
 *  this printing is the newest of its type (the implied default — keeps
 *  stored keys short and lets back-compat with legacy stored values work). */
export function formatVariantKey(
  printing: CardVariant,
  allPrintings: CardVariant[],
): string {
  const newest = newestOfType(allPrintings, printing.type);
  if (newest && newest.setId === printing.setId && newest.number === printing.number) {
    return printing.type;
  }
  return `${printing.type}:${printing.setId}#${printing.number}`;
}

function newestOfType(printings: CardVariant[], type: CardVariantType): CardVariant | undefined {
  // printings[] is ordered by (type-canonical-order, then newest-first
  // within type) — the first match is newest.
  return printings.find((p) => p.type === type);
}

/** Compact label for each printing in the variant dropdown. When a
 *  CardVariantType has only a single printing on this card, show just
 *  the type abbreviation ("Reg" / "Ench"). When multiple printings share
 *  a type (cross-main-set reprints like Captain Hook set 1 + set 8),
 *  disambiguate with the setId ("Reg 1" / "Reg 8"). */
export function printingLabels(
  printings: CardVariant[],
  typeAbbrevs: Record<CardVariantType, string>,
): Map<CardVariant, string> {
  const countByType = new Map<CardVariantType, number>();
  for (const p of printings) countByType.set(p.type, (countByType.get(p.type) ?? 0) + 1);
  const labels = new Map<CardVariant, string>();
  for (const p of printings) {
    const base = typeAbbrevs[p.type] ?? p.type;
    labels.set(p, (countByType.get(p.type) ?? 1) > 1 ? `${base} ${p.setId}` : base);
  }
  return labels;
}

/** Resolve a variant key to a specific CardVariant in the definition's
 *  printings[]. Legacy bare-type keys → newest of that type. Compound
 *  keys → exact (setId, number) match. Returns undefined when the key
 *  refers to a printing not in the data (stale metadata). */
export function resolvePrinting(
  def: CardDefinition,
  variantKey: string | undefined | null,
): CardVariant | undefined {
  const printings = def.printings ?? def.variants;
  if (!printings || printings.length === 0) return undefined;
  const parsed = parseVariantKey(variantKey);
  if (!parsed) return undefined;
  if (parsed.setId != null && parsed.number != null) {
    return printings.find((p) => p.setId === parsed.setId && p.number === parsed.number);
  }
  return newestOfType(printings, parsed.type);
}

/** The image URL for a specific entry — respects the entry's variant
 *  selection (bare type or compound set-qualified key), falls back to
 *  the card definition's default imageUrl. */
export function resolveEntryImageUrl(
  entry: { definitionId: string; variant?: string },
  def: CardDefinition,
): string {
  if (entry.variant) {
    const match = resolvePrinting(def, entry.variant);
    if (match) return match.imageUrl;
  }
  return def.imageUrl ?? "";
}

/** Resolve the card whose art represents a deck visually. Returns the
 *  display-ready { fullName, imageUrl } — imageUrl reflects the resolved
 *  entry's variant choice. User-chosen box_card_id wins; falls back to the
 *  first entry in the decklist. Null when the deck is empty or the
 *  referenced id is missing from definitions. */
export function resolveBoxCard(
  entries: DeckEntry[],
  boxCardId: string | null | undefined,
  definitions: Record<string, CardDefinition>,
): { fullName: string; imageUrl: string } | null {
  // Identify which deck entry the box refers to (user-picked or first).
  const entry = boxCardId
    ? entries.find((e) => e.definitionId === boxCardId)
    : entries[0];
  if (entry) {
    const def = definitions[entry.definitionId];
    if (!def) return null;
    return { fullName: def.fullName, imageUrl: resolveEntryImageUrl(entry, def) };
  }
  // box_card_id set but not in deck anymore — still render its regular art.
  if (boxCardId && definitions[boxCardId]) {
    const def = definitions[boxCardId];
    return { fullName: def.fullName, imageUrl: def.imageUrl ?? "" };
  }
  return null;
}
