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

/** Resolve the card whose art represents a deck visually.
 *  User-chosen box_card_id wins. Falls back to the first entry in the decklist
 *  (the first card added). Returns null if the deck is empty or the referenced
 *  card id isn't in definitions. */
export function resolveBoxCard(
  entries: DeckEntry[],
  boxCardId: string | null | undefined,
  definitions: Record<string, CardDefinition>,
): CardDefinition | null {
  if (boxCardId && definitions[boxCardId]) return definitions[boxCardId];
  const first = entries[0];
  if (first && definitions[first.definitionId]) return definitions[first.definitionId];
  return null;
}
