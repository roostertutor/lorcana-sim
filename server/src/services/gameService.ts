import {
  applyAction,
  LORCAST_CARD_DEFINITIONS,
  createGame,
  type GameConfig,
  type GameAction,
  type GameState,
  type DeckEntry,
} from "@lorcana-sim/engine"
import { supabase } from "../db/client.js"

// Card definitions are cached at startup — don't reload per request
const definitions = LORCAST_CARD_DEFINITIONS

// ELO K-factor: how much each game shifts rating
const ELO_K = 32

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

function updatedElo(rating: number, expected: number, actual: number): number {
  return Math.round(rating + ELO_K * (actual - expected))
}

export async function createNewGame(
  lobbyId: string,
  player1Id: string,
  player2Id: string,
  player1Deck: DeckEntry[],
  player2Deck: DeckEntry[],
) {
  const config: GameConfig = { player1Deck, player2Deck }
  const initialState = createGame(config, definitions)

  const { data, error } = await supabase
    .from("games")
    .insert({
      lobby_id: lobbyId,
      player1_id: player1Id,
      player2_id: player2Id,
      player1_deck: player1Deck,
      player2_deck: player2Deck,
      state: initialState,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create game: ${error.message}`)
  return data as { id: string }
}

export async function processAction(
  gameId: string,
  userId: string,
  action: GameAction,
): Promise<{ success: boolean; newState?: GameState; error?: string }> {
  // Load current game state
  const { data: game, error: loadError } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()

  if (loadError || !game) return { success: false, error: "Game not found" }
  if (game.status !== "active") return { success: false, error: "Game is not active" }

  const state = game.state as GameState

  // Map Supabase userId → in-game playerId ("player1" | "player2")
  const playerSide =
    game.player1_id === userId
      ? "player1"
      : game.player2_id === userId
        ? "player2"
        : null

  if (!playerSide) return { success: false, error: "You are not a player in this game" }

  // Verify it's this player's turn
  const activePlayerId = state.pendingChoice
    ? state.pendingChoice.choosingPlayerId
    : state.currentPlayer

  if (activePlayerId !== playerSide) {
    return { success: false, error: "Not your turn" }
  }

  // Ensure action carries the correct playerId
  if (action.playerId !== playerSide) {
    return { success: false, error: "Action playerId mismatch" }
  }

  const stateBefore = state

  // Apply the action — engine validates and produces new state
  const result = applyAction(state, action, definitions)

  if (!result.success) {
    return { success: false, error: result.error ?? "Action failed" }
  }

  const newState = result.newState

  // Get current player ELO for clone trainer annotation
  const { data: playerProfile } = await supabase
    .from("profiles")
    .select("elo")
    .eq("id", userId)
    .single()

  const playerElo = (playerProfile?.elo as number | undefined) ?? 1200

  // Save new state (triggers Supabase Realtime broadcast to both clients)
  const isFinished = newState.isGameOver
  await supabase
    .from("games")
    .update({
      state: newState,
      status: isFinished ? "finished" : "active",
      winner_id:
        newState.winner === "player1"
          ? game.player1_id
          : newState.winner === "player2"
            ? game.player2_id
            : null,
      updated_at: new Date(),
    })
    .eq("id", gameId)

  // Log action with state snapshots for clone trainer
  await supabase.from("game_actions").insert({
    game_id: gameId,
    player_id: userId,
    action,
    state_before: stateBefore,
    state_after: newState,
    turn_number: state.turnNumber,
    player_elo_at_time: playerElo,
  })

  // Update ELO if game is over
  if (isFinished && newState.winner) {
    await updateElo(game.player1_id as string, game.player2_id as string, newState.winner)
  }

  return { success: true, newState }
}

async function updateElo(
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
) {
  const [{ data: p1 }, { data: p2 }] = await Promise.all([
    supabase.from("profiles").select("elo, games_played").eq("id", player1Id).single(),
    supabase.from("profiles").select("elo, games_played").eq("id", player2Id).single(),
  ])

  if (!p1 || !p2) return

  const p1Elo = p1.elo as number
  const p2Elo = p2.elo as number

  const p1Expected = expectedScore(p1Elo, p2Elo)
  const p1Actual = winner === "player1" ? 1 : 0
  const p2Actual = 1 - p1Actual

  const newP1Elo = updatedElo(p1Elo, p1Expected, p1Actual)
  const newP2Elo = updatedElo(p2Elo, 1 - p1Expected, p2Actual)

  await Promise.all([
    supabase
      .from("profiles")
      .update({ elo: newP1Elo, games_played: (p1.games_played as number) + 1 })
      .eq("id", player1Id),
    supabase
      .from("profiles")
      .update({ elo: newP2Elo, games_played: (p2.games_played as number) + 1 })
      .eq("id", player2Id),
  ])
}

export async function getGame(gameId: string) {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()

  if (error) return null
  return data
}

export async function resignGame(gameId: string, userId: string) {
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()

  if (!game || game.status !== "active") return { success: false, error: "Game not found or not active" }

  const playerSide =
    game.player1_id === userId ? "player1" : game.player2_id === userId ? "player2" : null
  if (!playerSide) return { success: false, error: "You are not a player in this game" }

  const winner = playerSide === "player1" ? "player2" : "player1"
  const winnerId = winner === "player1" ? game.player1_id : game.player2_id

  await supabase
    .from("games")
    .update({ status: "finished", winner_id: winnerId, updated_at: new Date() })
    .eq("id", gameId)

  await updateElo(game.player1_id as string, game.player2_id as string, winner)

  return { success: true }
}
