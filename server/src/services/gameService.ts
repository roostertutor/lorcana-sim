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
  gameNumber = 1,
) {
  const config: GameConfig = { player1Deck, player2Deck, interactive: true }
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
      game_number: gameNumber,
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
): Promise<{ success: boolean; newState?: GameState; error?: string; nextGameId?: string }> {
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

  let newState = result.newState

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

  // Handle match completion (Bo1 or Bo3)
  let nextGameId: string | undefined
  if (isFinished && newState.winner) {
    const lobbyResult = await handleMatchProgress(
      game.lobby_id as string,
      game.player1_id as string,
      game.player2_id as string,
      newState.winner,
    )
    nextGameId = lobbyResult.nextGameId

    // Embed nextGameId + match score into the stored state so both
    // players see it via Realtime (only acting player gets the HTTP response)
    if (nextGameId || lobbyResult.p1Wins !== undefined) {
      const stateWithMatch = {
        ...newState,
        _matchNextGameId: nextGameId ?? null,
        _matchScore: { p1: lobbyResult.p1Wins ?? 0, p2: lobbyResult.p2Wins ?? 0 },
      }
      await supabase
        .from("games")
        .update({ state: stateWithMatch, updated_at: new Date() })
        .eq("id", gameId)
      newState = stateWithMatch as typeof newState
    }
  }

  return { success: true, newState, nextGameId }
}

type EloKey = "bo1_core" | "bo1_infinity" | "bo3_core" | "bo3_infinity"
type EloRatings = Record<EloKey, number>

const DEFAULT_RATINGS: EloRatings = { bo1_core: 1200, bo1_infinity: 1200, bo3_core: 1200, bo3_infinity: 1200 }

function getEloKey(format: string, cardPool: string): EloKey {
  const f = format === "bo3" ? "bo3" : "bo1"
  const p = cardPool === "core" ? "core" : "infinity"
  return `${f}_${p}` as EloKey
}

async function updateElo(
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
  eloKey: EloKey = "bo1_infinity",
) {
  const [{ data: p1 }, { data: p2 }] = await Promise.all([
    supabase.from("profiles").select("elo, elo_ratings, games_played").eq("id", player1Id).single(),
    supabase.from("profiles").select("elo, elo_ratings, games_played").eq("id", player2Id).single(),
  ])

  if (!p1 || !p2) return

  const p1Ratings: EloRatings = { ...DEFAULT_RATINGS, ...(p1.elo_ratings as Partial<EloRatings> | null) }
  const p2Ratings: EloRatings = { ...DEFAULT_RATINGS, ...(p2.elo_ratings as Partial<EloRatings> | null) }

  const p1Elo = p1Ratings[eloKey]
  const p2Elo = p2Ratings[eloKey]

  const p1Expected = expectedScore(p1Elo, p2Elo)
  const p1Actual = winner === "player1" ? 1 : 0
  const p2Actual = 1 - p1Actual

  p1Ratings[eloKey] = updatedElo(p1Elo, p1Expected, p1Actual)
  p2Ratings[eloKey] = updatedElo(p2Elo, 1 - p1Expected, p2Actual)

  // Also update the legacy elo column with the rating that just changed
  await Promise.all([
    supabase
      .from("profiles")
      .update({ elo: p1Ratings[eloKey], elo_ratings: p1Ratings, games_played: (p1.games_played as number) + 1 })
      .eq("id", player1Id),
    supabase
      .from("profiles")
      .update({ elo: p2Ratings[eloKey], elo_ratings: p2Ratings, games_played: (p2.games_played as number) + 1 })
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

  // Update the GameState so clients see isGameOver + winner via Realtime
  const updatedState = { ...(game.state as Record<string, unknown>), isGameOver: true, winner }

  await supabase
    .from("games")
    .update({ state: updatedState, status: "finished", winner_id: winnerId, updated_at: new Date() })
    .eq("id", gameId)

  await updateElo(game.player1_id as string, game.player2_id as string, winner)

  return { success: true }
}

/**
 * After a game finishes, update the match score and decide what happens next.
 * Bo1: update ELO immediately, mark lobby finished.
 * Bo3: update score, create next game if match not decided, update ELO when match ends.
 */
async function handleMatchProgress(
  lobbyId: string,
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
): Promise<{ nextGameId?: string; p1Wins?: number; p2Wins?: number }> {
  const { data: lobby } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .single()

  if (!lobby) {
    // Fallback: no lobby found, just update ELO
    await updateElo(player1Id, player2Id, winner)
    return {}
  }

  const format = (lobby.format as string) ?? "bo1"
  const p1Wins = ((lobby.p1_wins as number) ?? 0) + (winner === "player1" ? 1 : 0)
  const p2Wins = ((lobby.p2_wins as number) ?? 0) + (winner === "player2" ? 1 : 0)

  // Update lobby score
  await supabase
    .from("lobbies")
    .update({ p1_wins: p1Wins, p2_wins: p2Wins, updated_at: new Date() })
    .eq("id", lobbyId)

  const winsNeeded = format === "bo3" ? 2 : 1
  const matchDecided = p1Wins >= winsNeeded || p2Wins >= winsNeeded

  if (matchDecided) {
    // Match over — update ELO once per match and close lobby
    const matchWinner = p1Wins >= winsNeeded ? "player1" : "player2"
    const gameFormat = (lobby.game_format as string) ?? "infinity"
    const eloKey = getEloKey(format, gameFormat)
    await updateElo(player1Id, player2Id, matchWinner, eloKey)
    await supabase
      .from("lobbies")
      .update({ status: "finished", updated_at: new Date() })
      .eq("id", lobbyId)
    return { p1Wins, p2Wins }
  }

  // Bo3 not decided — create next game
  const gameNumber = p1Wins + p2Wins + 1
  const nextGame = await createNewGame(
    lobbyId,
    player1Id,
    player2Id,
    lobby.host_deck as DeckEntry[],
    lobby.guest_deck as DeckEntry[],
    gameNumber,
  )

  return { nextGameId: nextGame.id, p1Wins, p2Wins }
}

export async function getGameHistory(userId: string, page: number, limit: number) {
  const { data, error } = await supabase
    .from("games")
    .select(`
      id,
      player1_id,
      player2_id,
      status,
      winner_id,
      created_at,
      updated_at
    `)
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq("status", "finished")
    .order("updated_at", { ascending: false })
    .range(page * limit, (page + 1) * limit - 1)

  if (error || !data) return []

  // Fetch opponent usernames + ELO in one pass
  const opponentIds = data.map((g) =>
    g.player1_id === userId ? g.player2_id : g.player1_id,
  )
  const uniqueIds = [...new Set(opponentIds)]
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, elo")
    .in("id", uniqueIds)

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

  return data.map((g) => {
    const opponentId = g.player1_id === userId ? g.player2_id : g.player1_id
    const opponent = profileMap.get(opponentId as string)
    const won = g.winner_id === userId
    return {
      id: g.id,
      opponentName: (opponent?.username as string | undefined) ?? "Unknown",
      opponentElo: (opponent?.elo as number | undefined) ?? 1200,
      won,
      date: g.updated_at ?? g.created_at,
    }
  })
}

export async function getGameReplay(gameId: string) {
  const { data: game } = await supabase
    .from("games")
    .select("player1_deck, player2_deck, winner_id, player1_id, game_number")
    .eq("id", gameId)
    .single()

  if (!game) return null

  // Get the initial state (state_before of the first action)
  const { data: firstAction } = await supabase
    .from("game_actions")
    .select("state_before")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single()

  // Extract seed from the initial state's rng
  const initialState = firstAction?.state_before as { rng?: { seed?: number }; turnNumber?: number } | null
  const seed = initialState?.rng?.seed ?? Date.now()

  // Get all actions in order
  const { data: actionRows } = await supabase
    .from("game_actions")
    .select("action, state_after")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true })

  const actions = (actionRows ?? []).map((row) => row.action)

  // Determine winner as PlayerID
  const winner = game.winner_id === game.player1_id
    ? "player1"
    : game.winner_id
      ? "player2"
      : null

  // Get turn count from last action's state
  const lastState = actionRows?.length
    ? (actionRows[actionRows.length - 1]!.state_after as { turnNumber?: number })
    : null
  const turnCount = lastState?.turnNumber ?? 0

  return {
    seed,
    p1Deck: game.player1_deck,
    p2Deck: game.player2_deck,
    actions,
    winner,
    turnCount,
  }
}

export async function getGameActions(gameId: string) {
  const { data, error } = await supabase
    .from("game_actions")
    .select("action, turn_number")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true })

  if (error || !data) return []
  return data.map((row) => row.action)
}
