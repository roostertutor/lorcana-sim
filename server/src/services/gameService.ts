import {
  applyAction,
  CARD_DEFINITIONS,
  CORE_ROTATIONS,
  ENGINE_VERSION,
  INFINITY_ROTATIONS,
  createGame,
  type GameConfig,
  type GameAction,
  type GameState,
  type DeckEntry,
  type GameFormatFamily,
  type RotationId,
} from "@lorcana-sim/engine"
import { supabase } from "../db/client.js"

// Card definitions are cached at startup — don't reload per request
const definitions = CARD_DEFINITIONS

// ELO K-factor: how much each game shifts rating
const ELO_K = 32

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

function updatedElo(rating: number, expected: number, actual: number): number {
  return Math.round(rating + ELO_K * (actual - expected))
}

/**
 * Create a game row with the given slot assignment. Callers own the slot
 * decision — do NOT add randomization here:
 *   - Game 1 (from lobbyService.joinLobby): coin-flip winner → player1 slot.
 *   - Bo3 games 2/3 (from handleMatchProgress): previous-game loser → player1
 *     slot (CRD 2.1.3.2 play-draw rule).
 *
 * Engine's `chooserPlayerId` defaults to "player1" — whoever lands in slot 1
 * is prompted via the `choose_play_order` pendingChoice as the first
 * interaction in the game. Passed explicitly here for clarity.
 */
export async function createNewGame(
  lobbyId: string,
  p1Id: string,
  p2Id: string,
  p1Deck: DeckEntry[],
  p2Deck: DeckEntry[],
  gameNumber = 1,
) {
  const config: GameConfig = {
    player1Deck: p1Deck,
    player2Deck: p2Deck,
    interactive: true,
    chooserPlayerId: "player1",
  }
  const initialState = createGame(config, definitions)

  // Snapshot both players' current ELO at game-start. Per-action ELO stamping
  // was redundant (ELO only updates at match-end, so every action in a match
  // had the same value) — the clone-trainer pipeline now reads ELO from this
  // row instead of joining through game_actions. Parallel fetch since it
  // blocks the insert; default 1200 if a profile row is missing (shouldn't
  // happen, but don't crash game creation on a profile lookup miss).
  const [{ data: p1Profile }, { data: p2Profile }] = await Promise.all([
    supabase.from("profiles").select("elo").eq("id", p1Id).single(),
    supabase.from("profiles").select("elo").eq("id", p2Id).single(),
  ])
  const p1EloAtStart = (p1Profile?.elo as number | undefined) ?? 1200
  const p2EloAtStart = (p2Profile?.elo as number | undefined) ?? 1200

  const { data, error } = await supabase
    .from("games")
    .insert({
      lobby_id: lobbyId,
      player1_id: p1Id,
      player2_id: p2Id,
      player1_deck: p1Deck,
      player2_deck: p2Deck,
      state: initialState,
      game_number: gameNumber,
      p1_elo_at_start: p1EloAtStart,
      p2_elo_at_start: p2EloAtStart,
      // Engine version stamp — enables training pipelines to filter actions
      // to the engine that can correctly replay them. See
      // packages/engine/src/version.ts for the bump policy.
      engine_version: ENGINE_VERSION,
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

  // Log action with state snapshots for clone trainer.
  //
  // Shape philosophy: game_actions is STRICTLY per-action data — action,
  // state, turn, who, when. Per-match context (ELO, format, rotation,
  // engine version) lives on the aggregating `games` / `lobbies` /
  // `profiles` rows. Storing ELO per-action was a ~60-180x duplication
  // (ELO only updates at match-end, so every action in a match had the
  // same value). Removed 2026-04-22 — see games.p1_elo_at_start /
  // p2_elo_at_start for the snapshot, games.engine_version for the
  // engine stamp, and profiles.is_bot for bot-vs-human filtering.
  await supabase.from("game_actions").insert({
    game_id: gameId,
    player_id: userId,
    action,
    state_before: stateBefore,
    state_after: newState,
    turn_number: state.turnNumber,
  })

  // Handle match completion (Bo1 or Bo3)
  let nextGameId: string | undefined
  if (isFinished && newState.winner) {
    const lobbyResult = await handleMatchProgress(
      game.lobby_id as string,
      game.player1_id as string,
      game.player2_id as string,
      newState.winner,
      newState,
      gameId,
    )
    nextGameId = lobbyResult.nextGameId

    // Embed nextGameId + match score + ELO delta (if match decided) into the
    // stored state so both players see it via Realtime — the acting player
    // gets it on the HTTP response, but the opponent only sees what's in
    // `games.state` after the Realtime broadcast fires.
    if (nextGameId || lobbyResult.p1Wins !== undefined || lobbyResult.eloUpdate) {
      // _eloDelta keyed by userId so each client can pick its own row out of
      // the filtered state. The trio shape (before/after/delta) matches what
      // the HANDOFF Phase 2 plan specified. Unranked rotations would return
      // delta=0 once the unranked-flag work lands; for now every ranked
      // match returns a real delta.
      const eloDelta = lobbyResult.eloUpdate
        ? {
            [game.player1_id as string]: lobbyResult.eloUpdate.p1,
            [game.player2_id as string]: lobbyResult.eloUpdate.p2,
            _eloKey: lobbyResult.eloUpdate.eloKey,
          }
        : null

      const stateWithMatch = {
        ...newState,
        _matchNextGameId: nextGameId ?? null,
        _matchScore: { p1: lobbyResult.p1Wins ?? 0, p2: lobbyResult.p2Wins ?? 0 },
        ...(eloDelta && { _eloDelta: eloDelta }),
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

/** ELO bucket key: {match}_{family}_{rotation} — per-match-format, per-family,
 *  per-rotation. Shape grows automatically as new rotations are added to the
 *  engine's CORE_ROTATIONS / INFINITY_ROTATIONS registries. Note: rating values
 *  are infra-correct but not migrated from the legacy 4-key shape — pre-migration
 *  history is effectively reset. */
type MatchFormat = "bo1" | "bo3"
type EloKey = `${MatchFormat}_${GameFormatFamily}_${RotationId}`
type EloRatings = Record<EloKey, number>

/** Build the default rating map from the engine registries. Includes every
 *  registered rotation for both families, even those not currently offered for
 *  new decks — stored decks can still end up in matches against legacy rotations. */
function buildDefaultRatings(): EloRatings {
  const out: Partial<Record<EloKey, number>> = {}
  for (const match of ["bo1", "bo3"] as const) {
    for (const [family, registry] of [
      ["core", CORE_ROTATIONS],
      ["infinity", INFINITY_ROTATIONS],
    ] as const) {
      for (const rotation of Object.keys(registry) as RotationId[]) {
        out[`${match}_${family}_${rotation}`] = 1200
      }
    }
  }
  return out as EloRatings
}

const DEFAULT_RATINGS: EloRatings = buildDefaultRatings()

function getEloKey(format: string, cardPool: string, rotation: string): EloKey {
  const f: MatchFormat = format === "bo3" ? "bo3" : "bo1"
  const p: GameFormatFamily = cardPool === "core" ? "core" : "infinity"
  return `${f}_${p}_${rotation as RotationId}` as EloKey
}

/** Fallback key used when a callsite doesn't have rotation context (e.g. a
 *  resignation before the lobby's rotation is looked up). Safe default — lands
 *  ratings in a real bucket rather than a typo-land bucket. */
const FALLBACK_ELO_KEY: EloKey = "bo1_infinity_s11"

/** Per-player rating change returned by {@link updateElo}. The UI renders
 *  "+12 ELO (1247 → 1259)" directly from these values; delta is signed so
 *  the winner gets positive and the loser negative. Before/after are the
 *  two rating values on the SPECIFIC eloKey bucket, not the legacy `elo`
 *  column (which mirrors whichever key last changed). */
export interface EloUpdateResult {
  p1: { before: number; after: number; delta: number }
  p2: { before: number; after: number; delta: number }
  eloKey: EloKey
}

async function updateElo(
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
  eloKey: EloKey = FALLBACK_ELO_KEY,
): Promise<EloUpdateResult | null> {
  const [{ data: p1 }, { data: p2 }] = await Promise.all([
    supabase.from("profiles").select("elo, elo_ratings, games_played").eq("id", player1Id).single(),
    supabase.from("profiles").select("elo, elo_ratings, games_played").eq("id", player2Id).single(),
  ])

  if (!p1 || !p2) return null

  const p1Ratings: EloRatings = { ...DEFAULT_RATINGS, ...(p1.elo_ratings as Partial<EloRatings> | null) }
  const p2Ratings: EloRatings = { ...DEFAULT_RATINGS, ...(p2.elo_ratings as Partial<EloRatings> | null) }

  const p1Before = p1Ratings[eloKey]
  const p2Before = p2Ratings[eloKey]

  const p1Expected = expectedScore(p1Before, p2Before)
  const p1Actual = winner === "player1" ? 1 : 0
  const p2Actual = 1 - p1Actual

  const p1After = updatedElo(p1Before, p1Expected, p1Actual)
  const p2After = updatedElo(p2Before, 1 - p1Expected, p2Actual)

  p1Ratings[eloKey] = p1After
  p2Ratings[eloKey] = p2After

  // Also update the legacy elo column with the rating that just changed
  await Promise.all([
    supabase
      .from("profiles")
      .update({ elo: p1After, elo_ratings: p1Ratings, games_played: (p1.games_played as number) + 1 })
      .eq("id", player1Id),
    supabase
      .from("profiles")
      .update({ elo: p2After, elo_ratings: p2Ratings, games_played: (p2.games_played as number) + 1 })
      .eq("id", player2Id),
  ])

  return {
    p1: { before: p1Before, after: p1After, delta: p1After - p1Before },
    p2: { before: p2Before, after: p2After, delta: p2After - p2Before },
    eloKey,
  }
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

  // Land the resignation's ELO change in the correct per-rotation bucket by
  // reading format+rotation from the parent lobby. Falls back to defaults if
  // the lobby row is missing (shouldn't happen but keeps the update safe).
  const { data: lobby } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", game.lobby_id as string)
    .single()
  const eloKey = getEloKey(
    (lobby?.format as string) ?? "bo1",
    (lobby?.game_format as string) ?? "infinity",
    (lobby?.game_rotation as string) ?? "s11",
  )
  const eloUpdate = await updateElo(game.player1_id as string, game.player2_id as string, winner, eloKey)

  // Save a replay for the resignation — same shape as natural game-end,
  // keyed on game_id (unique) so double-resigns don't insert twice.
  if (lobby) {
    await saveReplayForGame(
      gameId,
      lobby,
      game.player1_id as string,
      game.player2_id as string,
      winner,
      game.state as GameState,
    )
  }

  // Embed ELO delta into the stored state so the resigning player's client
  // (and the opponent via Realtime) can render the rating change in the
  // game-over overlay. Same shape as processAction's eloDelta block.
  const stateWithElo = eloUpdate
    ? {
        ...updatedState,
        _eloDelta: {
          [game.player1_id as string]: eloUpdate.p1,
          [game.player2_id as string]: eloUpdate.p2,
          _eloKey: eloUpdate.eloKey,
        },
      }
    : updatedState

  await supabase
    .from("games")
    .update({ state: stateWithElo, status: "finished", winner_id: winnerId, updated_at: new Date() })
    .eq("id", gameId)

  // NOTE: this function does NOT close the lobby or run Bo3-progression
  // logic, preserving pre-Phase-2 behavior. Resigning a Bo3 game today
  // ends the game + updates ELO once, but doesn't advance the match or
  // close the lobby — that's a pre-existing gap separate from Phase 2
  // scope. Worth revisiting when Bo3 resign semantics get nailed down
  // (does resigning game 1 concede the match, or just that game?).

  return { success: true }
}

/** Insert a replay row for a just-finished game. Idempotent via the
 *  `replays.game_id` UNIQUE constraint — duplicate finish events (rare but
 *  possible under Realtime retries) will hit ON CONFLICT DO NOTHING. */
async function saveReplayForGame(
  gameId: string,
  lobby: Record<string, unknown>,
  p1Id: string,
  p2Id: string,
  winner: "player1" | "player2" | null,
  state: GameState,
) {
  const winnerId = winner === "player1" ? p1Id : winner === "player2" ? p2Id : null

  // Denormalize usernames so share-link reads don't need a profile join.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", [p1Id, p2Id])
  const usernameById = new Map((profiles ?? []).map((p) => [p.id as string, p.username as string]))

  await supabase
    .from("replays")
    .upsert(
      {
        game_id: gameId,
        winner_player_id: winnerId,
        p1_username: usernameById.get(p1Id) ?? null,
        p2_username: usernameById.get(p2Id) ?? null,
        turn_count: state.turnNumber ?? 0,
        format: (lobby.format as string) ?? "bo1",
        game_format: (lobby.game_format as string) ?? "infinity",
        game_rotation: (lobby.game_rotation as string) ?? "s11",
      },
      { onConflict: "game_id", ignoreDuplicates: true },
    )
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
  finalState: GameState,
  gameId: string,
): Promise<{ nextGameId?: string; p1Wins?: number; p2Wins?: number; eloUpdate?: EloUpdateResult | null }> {
  const { data: lobby } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .single()

  if (!lobby) {
    // Fallback: no lobby found, just update ELO
    const eloUpdate = await updateElo(player1Id, player2Id, winner)
    return { eloUpdate }
  }

  // Always save a replay for the game that just finished — Bo1 = 1 replay,
  // Bo3 = up to 3 replays (one per game). Idempotent.
  await saveReplayForGame(gameId, lobby, player1Id, player2Id, winner, finalState)

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
    const gameRotation = (lobby.game_rotation as string) ?? "s11"
    const eloKey = getEloKey(format, gameFormat, gameRotation)
    const eloUpdate = await updateElo(player1Id, player2Id, matchWinner, eloKey)
    await supabase
      .from("lobbies")
      .update({ status: "finished", updated_at: new Date() })
      .eq("id", lobbyId)
    return { p1Wins, p2Wins, eloUpdate }
  }

  // Bo3 not decided — create next game. CRD 2.1.3.2 play-draw rule: the
  // losing player elects go-first-or-second for the next game. We enforce
  // that by slotting the loser into the player1 slot — engine's
  // choose_play_order defaults to prompting player1.
  //
  // Pair each user with their correct deck. The lobby stores decks keyed by
  // host_id / guest_id (not by slot), so the host/guest → slot mapping can
  // flip between games without losing deck identity.
  const gameNumber = p1Wins + p2Wins + 1
  const loserId = winner === "player1" ? player2Id : player1Id
  const opponentId = winner === "player1" ? player1Id : player2Id
  const hostId = lobby.host_id as string
  const hostDeck = lobby.host_deck as DeckEntry[]
  const guestDeck = lobby.guest_deck as DeckEntry[]
  const loserIsHost = loserId === hostId
  const loserDeck = loserIsHost ? hostDeck : guestDeck
  const opponentDeck = loserIsHost ? guestDeck : hostDeck

  const nextGame = await createNewGame(
    lobbyId,
    loserId,
    opponentId,
    loserDeck,
    opponentDeck,
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

/** Replay row shape returned to clients. Merges the `replays` table
 *  metadata with the reconstructible replay data (seed, decks, actions)
 *  from `getGameReplay`. */
export interface ReplayView {
  id: string
  gameId: string
  public: boolean
  winnerUsername: string | null
  p1Username: string | null
  p2Username: string | null
  turnCount: number
  format: string | null
  gameFormat: string | null
  gameRotation: string | null
  createdAt: string
  // Reconstructible payload — seed + decks + actions. Same shape as
  // getGameReplay returns; nested here so a single endpoint call gets
  // everything needed to render a replay viewer.
  replay: {
    seed: number
    p1Deck: unknown
    p2Deck: unknown
    actions: unknown[]
    winner: "player1" | "player2" | null
  } | null
}

/** Look up a replay by its own id (not game id). Returns metadata + the
 *  full replay payload if the caller has access. Access rules:
 *   - public=true  → anyone with the link (no auth check here; the route
 *                    decides whether to call this or the auth'd variant)
 *   - public=false → caller must be a player of the parent game (enforced
 *                    at the route layer via getReplayForUser below) */
export async function getReplayById(replayId: string): Promise<
  | {
      row: {
        id: string
        game_id: string
        public: boolean
        winner_player_id: string | null
        p1_username: string | null
        p2_username: string | null
        turn_count: number
        format: string | null
        game_format: string | null
        game_rotation: string | null
        created_at: string
      }
      p1_id: string
      p2_id: string
    }
  | null
> {
  const { data, error } = await supabase
    .from("replays")
    .select(
      "id, game_id, public, winner_player_id, p1_username, p2_username, turn_count, format, game_format, game_rotation, created_at, games(player1_id, player2_id)",
    )
    .eq("id", replayId)
    .single()

  if (error || !data) return null

  // The `games(...)` join returns an object (single FK) or null.
  const gameRef = Array.isArray(data.games) ? data.games[0] : data.games
  if (!gameRef) return null

  return {
    row: {
      id: data.id as string,
      game_id: data.game_id as string,
      public: data.public as boolean,
      winner_player_id: (data.winner_player_id as string | null) ?? null,
      p1_username: (data.p1_username as string | null) ?? null,
      p2_username: (data.p2_username as string | null) ?? null,
      turn_count: data.turn_count as number,
      format: (data.format as string | null) ?? null,
      game_format: (data.game_format as string | null) ?? null,
      game_rotation: (data.game_rotation as string | null) ?? null,
      created_at: data.created_at as string,
    },
    p1_id: gameRef.player1_id as string,
    p2_id: gameRef.player2_id as string,
  }
}

/** Compose the client-facing ReplayView from the replays row + reconstructible
 *  payload. Separate function so the route layer can call `getReplayById` for
 *  access-control first (cheap) and only hit `getGameReplay` (expensive —
 *  scans all game_actions) after the check passes. */
export async function buildReplayView(
  replayId: string,
  replay: NonNullable<Awaited<ReturnType<typeof getReplayById>>>,
  includePayload: boolean,
): Promise<ReplayView> {
  const winnerUsername =
    replay.row.winner_player_id === replay.p1_id
      ? replay.row.p1_username
      : replay.row.winner_player_id === replay.p2_id
        ? replay.row.p2_username
        : null

  let payload: ReplayView["replay"] = null
  if (includePayload) {
    const r = await getGameReplay(replay.row.game_id)
    if (r) {
      payload = {
        seed: r.seed,
        p1Deck: r.p1Deck,
        p2Deck: r.p2Deck,
        actions: r.actions,
        // getGameReplay types `winner` as `string | null` (Supabase returns
        // loosely-typed row data); narrow to the PlayerID union here.
        winner: r.winner as "player1" | "player2" | null,
      }
    }
  }

  return {
    id: replayId,
    gameId: replay.row.game_id,
    public: replay.row.public,
    winnerUsername,
    p1Username: replay.row.p1_username,
    p2Username: replay.row.p2_username,
    turnCount: replay.row.turn_count,
    format: replay.row.format,
    gameFormat: replay.row.game_format,
    gameRotation: replay.row.game_rotation,
    createdAt: replay.row.created_at,
    replay: payload,
  }
}

/** Flip the `public` flag on a replay. Caller must be one of the two players
 *  of the parent game — checked against the row fetched via getReplayById.
 *  Returns `null` if the replay doesn't exist or the caller isn't authorized. */
export async function setReplayPublic(
  replayId: string,
  userId: string,
  makePublic: boolean,
): Promise<{ ok: true; public: boolean } | { ok: false; status: 404 | 403 | 500; error: string }> {
  const replay = await getReplayById(replayId)
  if (!replay) return { ok: false, status: 404, error: "Replay not found" }
  if (userId !== replay.p1_id && userId !== replay.p2_id) {
    return { ok: false, status: 403, error: "Only players from this game can change its share settings" }
  }

  const { error } = await supabase
    .from("replays")
    .update({ public: makePublic })
    .eq("id", replayId)

  if (error) return { ok: false, status: 500, error: `Failed to update replay: ${error.message}` }
  return { ok: true, public: makePublic }
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
