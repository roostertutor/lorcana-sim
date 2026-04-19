// =============================================================================
// buildDefinitions — merges per-printing CardDefinition entries (one per JSON
// row across set files) into the canonical `CARD_DEFINITIONS[slug]` map, and
// populates `variants[]` from matching-slug entries.
//
// Each JSON row represents one printing (e.g. Elsa Spirit of Winter appears
// three times: set-001 regular, set-001 enchanted, set-009 reprint). The
// engine treats them as one gameplay card because they share the slug.
// This helper picks a canonical per slug (most abilities, matching the
// prior behavior) and attaches the distinct visual printings as variants[].
// =============================================================================

import type { CardDefinition, CardVariant, CardVariantType } from "../types/index.js";

/** Classify a raw per-printing entry into one of the 6 variant-picker buckets. */
function classifyVariant(raw: CardDefinition): CardVariantType {
  const sid = raw.setId;
  // Booster promo sets
  if (sid === "P1" || sid === "P2" || sid === "P3") return "promo";
  // Convention / event sets — D23 Expo, Challenge rewards, "Collector Pack", "Disney"
  if (sid === "D23" || sid === "C1" || sid === "C2" || sid === "CP" || sid === "DIS") return "special";
  // Main sets: bucket by this printing's rarity
  if (raw.rarity === "enchanted") return "enchanted";
  if (raw.rarity === "iconic") return "iconic";
  if (raw.rarity === "epic") return "epic";
  return "regular";
}

/** Non-keyword abilities + any actionEffects — the same signal sync-promo-reprints
 *  uses to decide which duplicate to treat as canonical. */
function manualAbilityCount(c: CardDefinition): number {
  const nonKeyword = c.abilities.filter((a) => a.type !== "keyword").length;
  const actionFx = c.actionEffects?.length ?? 0;
  return nonKeyword + actionFx;
}

/** Compare two printings that classify to the same variant bucket. Prefers
 *  the most-recent main-set printing when both are numeric set IDs; falls
 *  back to a lexicographic compare (so P3 > P2 > P1, D23 keeps its slot). */
function isNewerPrinting(a: CardDefinition, b: CardDefinition): boolean {
  const aNum = parseInt(a.setId, 10);
  const bNum = parseInt(b.setId, 10);
  if (!isNaN(aNum) && !isNaN(bNum)) return aNum > bNum;
  if (a.setId !== b.setId) return a.setId.localeCompare(b.setId) > 0;
  // Same setId — prefer higher collector number (e.g. set-001 #207 enchanted
  // over a set-001 #42 regular if both classified to the same bucket, which
  // shouldn't happen under the rarity-based classifier but keeps ties stable).
  return a.number > b.number;
}

function toVariant(raw: CardDefinition): CardVariant {
  const v: CardVariant = {
    type: classifyVariant(raw),
    imageUrl: raw.imageUrl ?? "",
    setId: raw.setId,
    number: raw.number,
    rarity: raw.rarity,
  };
  if (raw.foilImageUrl) v.foilImageUrl = raw.foilImageUrl;
  return v;
}

export interface BuildResult {
  byId: Record<string, CardDefinition>;
  all: CardDefinition[];
}

export function buildCardDefinitions(rawCards: CardDefinition[]): BuildResult {
  // Group all per-printing rows by slug.
  const bySlug = new Map<string, CardDefinition[]>();
  for (const card of rawCards) {
    if (!card.id) continue;
    const list = bySlug.get(card.id);
    if (list) list.push(card);
    else bySlug.set(card.id, [card]);
  }

  const byId: Record<string, CardDefinition> = {};
  for (const [slug, group] of bySlug) {
    // Pick canonical: most manually-wired abilities (same tiebreaker the prior
    // reducer used — ensures the rep has the richest ability data).
    let canonical = group[0]!;
    for (const c of group) {
      if (manualAbilityCount(c) > manualAbilityCount(canonical)) canonical = c;
    }

    // Bucket per variant type. When multiple printings classify the same,
    // the most-recent setId wins.
    const bestByType = new Map<CardVariantType, CardDefinition>();
    for (const c of group) {
      const t = classifyVariant(c);
      const prev = bestByType.get(t);
      if (!prev || isNewerPrinting(c, prev)) bestByType.set(t, c);
    }

    const variants: CardVariant[] = [];
    // Emit in stable picker order so UI chips don't shuffle across builds.
    const ORDER: CardVariantType[] = ["regular", "enchanted", "iconic", "epic", "promo", "special"];
    for (const t of ORDER) {
      const c = bestByType.get(t);
      if (c) variants.push(toVariant(c));
    }

    // Attach variants only when there's an alternative to the base printing.
    // Single-type cards stay lean — UI falls back to CardDefinition.imageUrl.
    const merged: CardDefinition = variants.length >= 2
      ? { ...canonical, variants }
      : { ...canonical };

    // Keep the top-level imageUrl / foilImageUrl in sync with the preferred
    // variant (ORDER defines preference: regular first, then alt-arts).
    // Otherwise `def.imageUrl` could point to an older reprint while
    // `variants[regular]` points to the newest — UI consumers would see a
    // different art depending on which field they read.
    if (variants.length > 0) {
      const preferred = variants[0]!;
      merged.imageUrl = preferred.imageUrl;
      if (preferred.foilImageUrl) merged.foilImageUrl = preferred.foilImageUrl;
      else delete merged.foilImageUrl;
    }

    byId[slug] = merged;
  }

  return { byId, all: rawCards };
}
