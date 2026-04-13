/**
 * stateFilter — strip hidden information from GameState before sending to a player.
 *
 * The server stores the full authoritative GameState. Before sending it to a client,
 * this filter removes information the player shouldn't see:
 *   - Opponent's hand: keep card count, replace card data with stubs
 *   - Opponent's deck: keep card count, replace card data with stubs
 *   - Face-down cards under opponent's cards: replace with stubs
 *
 * Public zones (play, inkwell, discard) are sent in full.
 */

import type { GameState, PlayerID, CardInstance, ZoneName } from "@lorcana-sim/engine"

/** Minimal stub that lets the UI render a card back without crashing */
function hiddenStub(instanceId: string, zone: ZoneName, ownerId: PlayerID): CardInstance {
  return {
    instanceId,
    definitionId: "hidden",
    ownerId,
    zone,
    isExerted: false,
    damage: 0,
    isDrying: false,
    grantedKeywords: [],
    timedEffects: [],
    cardsUnder: [],
    rememberedTargetIds: [],
  } as CardInstance
}

export function filterStateForPlayer(state: GameState, playerId: PlayerID): GameState {
  const opponentId: PlayerID = playerId === "player1" ? "player2" : "player1"

  // Deep-clone cards map so we can replace entries without mutating the original
  const filteredCards: Record<string, CardInstance> = { ...state.cards }

  // Hidden zones: opponent's hand and deck
  const hiddenZones: ZoneName[] = ["hand", "deck"]
  for (const zoneName of hiddenZones) {
    const instanceIds = state.zones[opponentId]?.[zoneName] ?? []
    for (const id of instanceIds) {
      filteredCards[id] = hiddenStub(id, zoneName, opponentId)
    }
  }

  // Face-down cards under opponent's cards
  const opponentPlay = state.zones[opponentId]?.play ?? []
  for (const id of opponentPlay) {
    const card = state.cards[id]
    if (!card?.cardsUnder) continue
    for (const underId of card.cardsUnder) {
      const underCard = state.cards[underId]
      if (underCard?.isFaceDown) {
        filteredCards[underId] = hiddenStub(underId, "under", opponentId)
      }
    }
  }

  return {
    ...state,
    cards: filteredCards,
  }
}
