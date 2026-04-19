// =============================================================================
// deckRules — small utilities for deck construction rules.
// maxCopies is set by the engine importer from DeckRuleStatic.rule parsing;
// the UI just reads def.maxCopies (default 4 if unset).
// =============================================================================

import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";

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

/** The image URL for a specific entry — respects the entry's variant
 *  selection, falls back to the card definition's default imageUrl. */
export function resolveEntryImageUrl(
  entry: { definitionId: string; variant?: string },
  def: CardDefinition,
): string {
  if (entry.variant) {
    const match = def.variants?.find((v) => v.type === entry.variant);
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
