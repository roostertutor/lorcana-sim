// =============================================================================
// deckRules — small utilities for deck construction rules.
// maxCopies is set by the engine importer from DeckRuleStatic.rule parsing;
// the UI just reads def.maxCopies (default 4 if unset).
// =============================================================================

import type { CardDefinition } from "@lorcana-sim/engine";

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
