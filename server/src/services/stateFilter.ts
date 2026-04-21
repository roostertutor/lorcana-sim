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

  // Cards referenced by lastRevealedCards are public — don't stub them even if
  // they're in a hidden zone (the whole point of "reveal" is both players see it).
  const revealedSet = new Set(state.lastRevealedCards?.instanceIds ?? [])

  // Cards referenced by lastRevealedHand are visible to the audience the reveal
  // was scoped to: public reveals (privateTo == null — both players see it) and
  // private peeks where the viewer is the one who peeked (privateTo === viewer).
  // Same principle as lastRevealedCards above: reveals preserve info for the
  // audience that was meant to receive it. Without this, set 12's look_at_hand
  // effects (and any future public reveal_hand ability) silently stub out in
  // the peeker's filtered state — they'd see card backs for cards they just
  // revealed.
  const revealedHand = state.lastRevealedHand
  if (revealedHand && (revealedHand.privateTo == null || revealedHand.privateTo === playerId)) {
    for (const id of revealedHand.cardIds) revealedSet.add(id)
  }

  // Hidden zones: opponent's hand and deck
  const hiddenZones: ZoneName[] = ["hand", "deck"]
  for (const zoneName of hiddenZones) {
    const instanceIds = state.zones[opponentId]?.[zoneName] ?? []
    for (const id of instanceIds) {
      if (revealedSet.has(id)) continue
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
