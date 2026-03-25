// =============================================================================
// DECK COMPOSITION ANALYZER
// Pure math — no simulation needed.
// Uses hypergeometric formula for ink curve probability.
// =============================================================================

import type { CardDefinition, DeckEntry, InkColor, CardType, Keyword } from "@lorcana-sim/engine";
import type { DeckComposition } from "./types.js";

/**
 * P(drawing at least 1 inkable card in n draws from a deck of N with k inkable).
 * Uses hypergeometric CDF complement: 1 - P(0 inkable in n draws).
 */
function pAtLeastOneInkable(N: number, k: number, n: number): number {
  if (k === 0 || n === 0) return 0;
  if (k >= N) return 1;
  // P(0 inkable in n draws) = C(N-k, n) / C(N, n)
  // = product_{i=0..n-1} (N-k-i)/(N-i)
  let p = 1;
  for (let i = 0; i < n; i++) {
    const numerator = N - k - i;
    if (numerator <= 0) return 1; // All remaining cards are inkable
    p *= numerator / (N - i);
  }
  return 1 - p;
}

export function analyzeDeckComposition(
  deck: DeckEntry[],
  definitions: Record<string, CardDefinition>
): DeckComposition {
  // Expand deck entries into individual cards
  const cards: CardDefinition[] = [];
  for (const entry of deck) {
    const def = definitions[entry.definitionId];
    if (!def) continue;
    for (let i = 0; i < entry.count; i++) {
      cards.push(def);
    }
  }

  const totalCards = cards.length;
  const inkableCards = cards.filter((c) => c.inkable);
  const inkableCount = inkableCards.length;

  // Cost curve
  const costCurve: Record<number, number> = {};
  let totalCost = 0;
  for (const c of cards) {
    costCurve[c.cost] = (costCurve[c.cost] ?? 0) + 1;
    totalCost += c.cost;
  }

  // Color breakdown
  const colorBreakdown = {} as Record<InkColor, number>;
  for (const c of cards) {
    colorBreakdown[c.inkColor] = (colorBreakdown[c.inkColor] ?? 0) + 1;
  }

  // Card type breakdown
  const cardTypeBreakdown = {} as Record<CardType, number>;
  for (const c of cards) {
    cardTypeBreakdown[c.cardType] = (cardTypeBreakdown[c.cardType] ?? 0) + 1;
  }

  // Keyword counts
  const keywordCounts = {} as Record<Keyword, number>;
  for (const c of cards) {
    for (const ab of c.abilities) {
      if (ab.type === "keyword") {
        keywordCounts[ab.keyword] = (keywordCounts[ab.keyword] ?? 0) + 1;
      }
    }
  }

  // Ink curve probabilities
  // Opening hand = 7 cards. Each subsequent turn draws 1.
  // Turn N total draws = 7 + (N - 1) but capped at deck size.
  // Turn 1: 7 cards drawn. Turn 2: 8. Turn 3: 9. Turn 4: 10.
  const drawsByTurn: Record<number, number> = { 1: 7, 2: 8, 3: 9, 4: 10 };
  const inkCurveProb = {
    turn1: pAtLeastOneInkable(totalCards, inkableCount, drawsByTurn[1]!),
    turn2: pAtLeastOneInkable(totalCards, inkableCount, drawsByTurn[2]!),
    turn3: pAtLeastOneInkable(totalCards, inkableCount, drawsByTurn[3]!),
    turn4: pAtLeastOneInkable(totalCards, inkableCount, drawsByTurn[4]!),
  };

  return {
    totalCards,
    inkableCount,
    inkablePercent: totalCards > 0 ? inkableCount / totalCards : 0,
    costCurve,
    avgCost: totalCards > 0 ? totalCost / totalCards : 0,
    colorBreakdown,
    cardTypeBreakdown,
    keywordCounts,
    inkCurveProb,
  };
}
