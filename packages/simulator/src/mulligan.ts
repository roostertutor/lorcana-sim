// =============================================================================
// MULLIGAN
// CRD 2.2.2: Pre-game partial mulligan logic.
// Direct state manipulation — mulligan happens before the game loop starts.
// =============================================================================

import type { CardDefinition, GameState, PlayerID } from "@lorcana-sim/engine";
import { getZone, rngNextInt } from "@lorcana-sim/engine";
import type { MulliganThresholds } from "./types.js";

export const DEFAULT_MULLIGAN: MulliganThresholds = {
  minInkable: 2,
  maxCheapestCost: 3,
  maxEarlyPlayCost: 4,
};

/**
 * Determine if the bot should mulligan its opening hand.
 * Returns true (= mulligan) if the hand fails any of:
 * - Fewer than minInkable inkable cards
 * - Cheapest card costs more than maxCheapestCost (no early plays)
 * - No card costing ≤ maxEarlyPlayCost
 */
export function shouldMulligan(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  thresholds?: MulliganThresholds
): boolean {
  const t = thresholds ?? DEFAULT_MULLIGAN;
  const handIds = getZone(state, playerId, "hand");

  let inkableCount = 0;
  let cheapestCost = Infinity;
  let hasEarlyPlay = false;

  for (const id of handIds) {
    const instance = state.cards[id];
    if (!instance) continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    if (def.inkable) inkableCount++;
    if (def.cost < cheapestCost) cheapestCost = def.cost;
    if (def.cost <= t.maxEarlyPlayCost) hasEarlyPlay = true;
  }

  if (inkableCount < t.minInkable) return true;
  if (cheapestCost > t.maxCheapestCost) return true;
  if (!hasEarlyPlay) return true;

  return false;
}

/**
 * CRD 2.2.2: Return hand to deck, shuffle, redraw same count.
 * Direct state manipulation (pre-game, no engine action needed).
 */
export function performMulligan(
  state: GameState,
  playerId: PlayerID
): GameState {
  const handIds = getZone(state, playerId, "hand");
  const deckIds = getZone(state, playerId, "deck");
  const handSize = handIds.length;

  // Return hand to deck
  const combinedDeck = [...deckIds, ...handIds];

  // Fisher-Yates shuffle using seeded RNG
  const rng = state.rng;
  for (let i = combinedDeck.length - 1; i > 0; i--) {
    const j = rngNextInt(rng, i + 1);
    [combinedDeck[i], combinedDeck[j]] = [combinedDeck[j]!, combinedDeck[i]!];
  }

  // Draw new hand from top of shuffled deck
  const newHand = combinedDeck.slice(0, handSize);
  const newDeck = combinedDeck.slice(handSize);

  return {
    ...state,
    zones: {
      ...state.zones,
      [playerId]: {
        ...state.zones[playerId],
        hand: newHand,
        deck: newDeck,
      },
    },
  };
}
