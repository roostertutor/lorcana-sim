// =============================================================================
// DECK PROBABILITIES
// Hypergeometric calculations over the known remaining deck.
// The bot knows exactly what's left — cards played/inked/discarded are tracked
// in GameState. This is "perfect information about your own deck", not cheating.
// =============================================================================

import type { CardDefinition, GameState, Keyword, PlayerID } from "@lorcana-sim/engine";
import { getZone } from "@lorcana-sim/engine";

export interface DeckProbabilities {
  /** P(drawing at least 1 copy of definitionId in next drawsRemaining draws) */
  probabilityOfDrawing(definitionId: string, drawsRemaining: number): number;
  /** P(drawing at least 1 inkable card in next n draws) */
  probabilityOfInkInNextN(n: number): number;
  /** Average cost of cards remaining in deck */
  avgCostRemaining(): number;
  /** P(opponent has at least 1 card with keyword in hand or deck) */
  opponentThreatProbability(keyword: Keyword): number;
}

/**
 * P(drawing at least 1 of k specific cards in n draws from deck of N).
 * Uses hypergeometric distribution: P(X >= 1) = 1 - P(X = 0).
 * P(X = 0) computed iteratively to avoid integer overflow.
 */
function hypergeometricAtLeastOne(N: number, k: number, n: number): number {
  if (k <= 0 || N <= 0 || n <= 0) return 0;
  if (k >= N) return 1;
  const draws = Math.min(n, N);

  let pZero = 1;
  for (let i = 0; i < draws; i++) {
    const numerator = N - k - i;
    const denominator = N - i;
    if (numerator <= 0) return 1;
    pZero *= numerator / denominator;
  }
  return 1 - pZero;
}

export function computeDeckProbabilities(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): DeckProbabilities {
  const opponentId: PlayerID = playerId === "player1" ? "player2" : "player1";
  const deckIds = getZone(state, playerId, "deck");
  const deckSize = deckIds.length;

  // Count copies of each definition remaining in deck
  const deckCounts: Record<string, number> = {};
  let inkableCount = 0;
  let totalCost = 0;

  for (const id of deckIds) {
    const instance = state.cards[id];
    if (!instance) continue;
    deckCounts[instance.definitionId] = (deckCounts[instance.definitionId] ?? 0) + 1;
    const def = definitions[instance.definitionId];
    if (def?.inkable) inkableCount++;
    totalCost += def?.cost ?? 0;
  }

  const avgCost = deckSize > 0 ? totalCost / deckSize : 0;

  // Opponent's unknown cards: hand + deck (we can't see them)
  const opponentUnknownIds = [
    ...getZone(state, opponentId, "deck"),
    ...getZone(state, opponentId, "hand"),
  ];

  return {
    probabilityOfDrawing(definitionId: string, drawsRemaining: number): number {
      const k = deckCounts[definitionId] ?? 0;
      return hypergeometricAtLeastOne(deckSize, k, drawsRemaining);
    },

    probabilityOfInkInNextN(n: number): number {
      return hypergeometricAtLeastOne(deckSize, inkableCount, n);
    },

    avgCostRemaining(): number {
      return avgCost;
    },

    opponentThreatProbability(keyword: Keyword): number {
      const total = opponentUnknownIds.length;
      if (total === 0) return 0;
      let count = 0;
      for (const id of opponentUnknownIds) {
        const instance = state.cards[id];
        if (!instance) continue;
        const def = definitions[instance.definitionId];
        if (def?.abilities.some((a) => a.type === "keyword" && a.keyword === keyword)) {
          count++;
        }
      }
      return count / total;
    },
  };
}
