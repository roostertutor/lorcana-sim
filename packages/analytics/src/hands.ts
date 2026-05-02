// =============================================================================
// OPENING HAND ANALYZER
// Simulates N opening hands (no game played) and reports statistics.
// Uses createGame to get a properly shuffled deck, then reads the hand zone.
// =============================================================================

import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
import { applyAction, createGame, getZoneInstances } from "@lorcana-sim/engine";
import type { HandStats } from "./types.js";

export function analyzeOpeningHands(
  deck: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  iterations: number
): HandStats {
  let totalCost = 0;
  let totalInkable = 0;
  let totalInkableGames = 0; // Games with ≥1 inkable

  // P(playable on turn N) — we check cost ≤ N (since you ink each turn)
  const playableOnTurn: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  // Card frequency in opening hands
  const defFrequency: Record<string, number> = {};

  for (let i = 0; i < iterations; i++) {
    // CRD 2.1.3 → 2.2.1: opening hands are dealt by the engine in the
    // `choose_play_order` resolution branch, not by createGame. Resolve the
    // play-order choice with "first" (analytics doesn't care which slot is
    // starting; we just need the deal to happen) before reading the hand.
    let state = createGame({ player1Deck: deck, player2Deck: deck }, definitions);
    state = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      definitions,
    ).newState;
    const hand = getZoneInstances(state, "player1", "hand");

    let handCost = 0;
    let inkableCount = 0;

    for (const instance of hand) {
      const def = definitions[instance.definitionId];
      if (!def) continue;
      handCost += def.cost;
      if (def.inkable) inkableCount++;
      defFrequency[instance.definitionId] = (defFrequency[instance.definitionId] ?? 0) + 1;
    }

    totalCost += handCost / Math.max(hand.length, 1);
    totalInkable += inkableCount;
    if (inkableCount > 0) totalInkableGames++;

    // P(at least one playable card on turn N) — any card with cost <= N
    for (const turn of [1, 2, 3, 4] as const) {
      const hasPlayable = hand.some((inst) => {
        const def = definitions[inst.definitionId];
        return def && def.cost <= turn;
      });
      if (hasPlayable) playableOnTurn[turn]!++;
    }
  }

  const n = iterations;

  // Sort by frequency and compute avg copies per game
  const mostCommonCards = Object.entries(defFrequency)
    .map(([definitionId, count]) => ({ definitionId, avgCopies: count / n }))
    .sort((a, b) => b.avgCopies - a.avgCopies)
    .slice(0, 10);

  const probabilityOfPlayableOnTurn: Record<number, number> = {};
  for (const turn of [1, 2, 3, 4]) {
    probabilityOfPlayableOnTurn[turn] = (playableOnTurn[turn] ?? 0) / n;
  }

  return {
    iterations,
    avgCost: totalCost / n,
    avgInkableCount: totalInkable / n,
    probabilityOfInkableInOpener: totalInkableGames / n,
    probabilityOfPlayableOnTurn,
    mostCommonCards,
  };
}
