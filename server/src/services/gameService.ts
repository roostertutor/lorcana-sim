import {
  applyAction,
  CARD_DEFINITIONS,
  CORE_ROTATIONS,
  ENGINE_VERSION,
  INFINITY_ROTATIONS,
  createGame,
  filterStateForPlayer,
  getAllLegalActions,
  isLegalFor,
  type GameConfig,
  type GameAction,
  type GameState,
  type DeckEntry,
  type GameFormat,
  type GameFormatFamily,
  type PlayerID,
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

/** Match-source taxonomy on the games row. Drives ranked-eligibility +
 *  analytics filters (e.g. "show me only queue games" in history). */
export type MatchSource = "private" | "queue" | "tournament"

export interface CreateGameOptions {
  /** Where the game came from. Default 'private' (host-code or browse lobby). */
  matchSource?: MatchSource
  /** Whether ELO updates are eligible at match-end. Caller resolves this
   *  using both queueKind AND rotation.ranked — `gameService` doesn't
   *  re-derive it. Default false (matches schema default). */
  ranked?: boolean
  /** Optional explicit format. If provided, both decks are validated against
   *  it via the engine's `isLegalFor` BEFORE the games row is inserted —
   *  authoritative gate against any client-side stale-deck race. Lobby
   *  callers also pre-validate; queue callers pre-validate AND defensively
   *  re-check inside `tryPairEntry`. Throws ILLEGAL_DECK_P{1,2} on rejection. */
  format?: GameFormat
}

/**
 * Create a game row with the given slot assignment. Callers own the slot
 * decision — do NOT add randomization here:
 *   - Game 1 (from lobbyService.joinLobby): coin-flip winner → player1 slot.
 *   - Bo3 games 2/3 (from handleMatchProgress): previous-game loser → player1
 *     slot (CRD 2.1.3.2 play-draw rule).
 *   - Queue (from matchmakingService.tryPairEntry): coin-flip; lobbyId=null.
 *
 * Engine's `chooserPlayerId` defaults to "player1" — whoever lands in slot 1
 * is prompted via the `choose_play_order` pendingChoice as the first
 * interaction in the game. Passed explicitly here for clarity.
 */
export async function createNewGame(
  lobbyId: string | null,
  p1Id: string,
  p2Id: string,
  p1Deck: DeckEntry[],
  p2Deck: DeckEntry[],
  gameNumber = 1,
  options: CreateGameOptions = {},
) {
  // Mandatory legality check at game creation. Even though lobby/queue paths
  // pre-validate, this is the authoritative server-side gate — last line
  // of defense against a stale-deck race or a buggy client. Throws a tagged
  // error the route layer surfaces as a 400 with the issue list.
  if (options.format) {
    const r1 = isLegalFor(p1Deck, definitions, options.format)
    if (!r1.ok) {
      const err = new Error("ILLEGAL_DECK_P1") as Error & { issues?: unknown }
      err.issues = r1.issues
      throw err
    }
    const r2 = isLegalFor(p2Deck, definitions, options.format)
    if (!r2.ok) {
      const err = new Error("ILLEGAL_DECK_P2") as Error & { issues?: unknown }
      err.issues = r2.issues
      throw err
    }
  }

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

  const matchSource: MatchSource = options.matchSource ?? "private"
  // Anti-collusion: private lobbies are unconditionally unranked, regardless
  // of rotation. Two friends can no longer farm ELO via host-code lobbies.
  // Queue-spawned games respect the caller's `ranked` flag (which already
  // ANDs queueKind=='ranked' with rotation.ranked=true at the call site).
  const ranked = matchSource === "private" ? false : (options.ranked ?? false)

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
      match_source: matchSource,
      ranked,
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

  // Snapshot decision difficulty BEFORE applying — number of legal actions
  // the player could have chosen at this state. The engine returns [] when
  // a pendingChoice is set (choice-value enumeration is context-dependent),
  // so encode that as NULL on the row instead of 0 to keep "no enumeration
  // available" distinct from "literally zero options". Persisted on
  // game_actions.legal_action_count for the clone trainer (weight hard
  // decisions more heavily) and analytics queries (avg branching factor).
  // Cheap relative to the DB round-trips that bracket it.
  const legalActionCount: number | null = stateBefore.pendingChoice
    ? null
    : getAllLegalActions(stateBefore, playerSide, definitions).length

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
  //
  // `events` carries the ActionResult.events stream — cascade-attributed
  // typed events (card_moved, damage_dealt, lore_gained, ability_triggered,
  // card_revealed, hand_revealed, card_drawn, card_banished, turn_passed)
  // with `cause: "primary" | "trigger" | "replacement"` stamped by the
  // engine. Persisting these gives the trainer cascade attribution +
  // hidden-info reveal audit + effect granularity that a state-diff can't
  // reconstruct. See HANDOFF.md → "persist GameEvent stream + decision
  // metadata" and schema.sql for the column docs.
  await supabase.from("game_actions").insert({
    game_id: gameId,
    player_id: userId,
    action,
    state_before: stateBefore,
    state_after: newState,
    events: result.events,
    legal_action_count: legalActionCount,
    turn_number: state.turnNumber,
  })

  // Handle match completion (Bo1 or Bo3). lobby_id is null for
  // queue-spawned games — handleMatchProgress takes that path with a
  // single ELO update + no follow-up game.
  let nextGameId: string | undefined
  if (isFinished && newState.winner) {
    const lobbyResult = await handleMatchProgress(
      (game.lobby_id as string | null) ?? null,
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
  gameRanked: boolean = false,
): Promise<EloUpdateResult | null> {
  // Unranked match: still bump games_played for activity tracking, but skip
  // the ELO math entirely. Private lobbies are always ranked=false (anti-
  // collusion); casual queue games are always ranked=false; ranked queue
  // games are ranked iff the rotation has ranked=true at game-create time.
  // The flag is read directly off `games.ranked` — no need to re-derive
  // from the rotation registry here, since it's already authoritative.
  if (!gameRanked) {
    const [{ data: p1g }, { data: p2g }] = await Promise.all([
      supabase.from("profiles").select("games_played").eq("id", player1Id).single(),
      supabase.from("profiles").select("games_played").eq("id", player2Id).single(),
    ])
    if (p1g && p2g) {
      await Promise.all([
        supabase.from("profiles").update({ games_played: (p1g.games_played as number) + 1 }).eq("id", player1Id),
        supabase.from("profiles").update({ games_played: (p2g.games_played as number) + 1 }).eq("id", player2Id),
      ])
    }
    return null
  }

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
  const updatedState = { ...(game.state as Record<string, unknown>), isGameOver: true, winner, wonBy: "concede" }

  // Land the resignation's ELO change in the correct per-rotation bucket by
  // reading format+rotation from the parent lobby (queue-spawned games have
  // no parent lobby — fall back to game.match_source for routing). Falls
  // back to defaults if the lobby row is missing.
  const { data: lobby } = game.lobby_id
    ? await supabase.from("lobbies").select("*").eq("id", game.lobby_id as string).single()
    : { data: null }
  const eloKey = getEloKey(
    (lobby?.format as string) ?? "bo1",
    (lobby?.game_format as string) ?? "infinity",
    (lobby?.game_rotation as string) ?? "s11",
  )
  // Queue-spawned games carry their rotation/format on the games row directly
  // (no parent lobby). For now, queue games inherit the FALLBACK_ELO_KEY
  // bucket on resignation — the eloKey on resign for queue games is a known
  // gap; the natural-finish path through handleMatchProgress reads from
  // games.ranked directly. Resign on queue games today is unranked-only
  // (casual queue) by structure, so the bucket choice is moot for ELO math.
  const gameRanked = (game.ranked as boolean | undefined) ?? false
  const eloUpdate = await updateElo(
    game.player1_id as string,
    game.player2_id as string,
    winner,
    eloKey,
    gameRanked,
  )

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
  lobbyId: string | null,
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
  finalState: GameState,
  gameId: string,
): Promise<{ nextGameId?: string; p1Wins?: number; p2Wins?: number; eloUpdate?: EloUpdateResult | null }> {
  // Read the ranked flag off the game row — authoritative for ELO eligibility.
  const { data: gameRow } = await supabase
    .from("games")
    .select("ranked, match_source")
    .eq("id", gameId)
    .single()
  const gameRanked = (gameRow?.ranked as boolean | undefined) ?? false

  // Queue-spawned games have no parent lobby (lobbyId=null). They're
  // currently always Bo1 — no rematch sequence — so the match-progress
  // path collapses to a single ELO update + no follow-up game.
  if (!lobbyId) {
    const eloUpdate = await updateElo(player1Id, player2Id, winner, FALLBACK_ELO_KEY, gameRanked)
    return { eloUpdate }
  }

  const { data: lobby } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .single()

  if (!lobby) {
    // Fallback: no lobby found, just update ELO
    const eloUpdate = await updateElo(player1Id, player2Id, winner, FALLBACK_ELO_KEY, gameRanked)
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
    // Private lobbies are unconditionally unranked (anti-collusion); the
    // games.ranked flag was set to false on game-create regardless of
    // rotation. Queue games never reach this branch (lobbyId=null path
    // handles them). Read gameRanked from the games row to be safe.
    const eloUpdate = await updateElo(player1Id, player2Id, matchWinner, eloKey, gameRanked)
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

  // Format stamp for the Bo3 next-game's mandatory legality check. Read
  // from the lobby row (decks were already validated at create/join time
  // against this same format, so the check is essentially a tautology
  // here — but cheap, and cheap defense-in-depth is worth it).
  const lobbyFormat: GameFormat = {
    family: (lobby.game_format as GameFormatFamily) ?? "infinity",
    rotation: (lobby.game_rotation as RotationId) ?? "s11",
  }

  const nextGame = await createNewGame(
    lobbyId,
    loserId,
    opponentId,
    loserDeck,
    opponentDeck,
    gameNumber,
    {
      matchSource: "private",
      ranked: false, // Anti-collusion: private lobbies are unconditionally unranked.
      format: lobbyFormat,
    },
  )

  return { nextGameId: nextGame.id, p1Wins, p2Wins }
}

/** One row in the "My Replays" browse list. Lightweight metadata only — no
 *  state stream, no decks (those cost a full reconstruction or a heavy fetch).
 *  Caller-perspective fields (`callerIsP1`, `won`) are stamped server-side so
 *  the UI doesn't need to re-derive from raw player IDs. */
export interface ReplayListItem {
  id: string
  gameId: string
  p1Username: string | null
  p2Username: string | null
  /** True if the calling user was player 1 of the parent game. False if they
   *  were player 2. (List is filtered to the caller's own games server-side,
   *  so they're always one of the two.) */
  callerIsP1: boolean
  /** Did the calling user win? Null if the game ended without a recorded winner
   *  (resign-with-no-valid-state is the documented case in the schema). */
  won: boolean | null
  public: boolean
  format: string | null
  gameFormat: string | null
  gameRotation: string | null
  turnCount: number
  createdAt: string
}

/** Paginated list of finished MP replays the caller participated in.
 *  Joins `replays` × `games` to filter by player IDs (RLS would also let
 *  the caller read public replays from non-participants, but we want a
 *  "MINE only" view here — explicit player-id filter ensures that).
 *  Ordered newest-first. Returns `{ replays, total }` so the UI can
 *  render pagination affordances. */
export async function listMyReplays(
  userId: string,
  limit: number,
  offset: number,
): Promise<{ replays: ReplayListItem[]; total: number }> {
  // Fetch the caller's finished games — IDs + winner + slot — first. Replays
  // are 1:1 with games so we can pull replay metadata in a second query keyed
  // by game_id. Doing it as a join via `games(...)` from `replays` would also
  // work but the filter-by-player-id syntax is cleaner from the games side.
  const { data: games, error: gErr, count } = await supabase
    .from("games")
    .select("id, player1_id, player2_id, winner_id, status", { count: "exact" })
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq("status", "finished")
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (gErr || !games || games.length === 0) {
    return { replays: [], total: count ?? 0 }
  }

  const gameIds = games.map((g) => g.id as string)
  const { data: replays, error: rErr } = await supabase
    .from("replays")
    .select(
      "id, game_id, public, p1_username, p2_username, turn_count, format, game_format, game_rotation, created_at",
    )
    .in("game_id", gameIds)

  if (rErr || !replays) {
    return { replays: [], total: count ?? 0 }
  }

  const replayByGame = new Map(replays.map((r) => [r.game_id as string, r]))

  // Preserve the games-order (newest-first) and drop any games that don't
  // have a replay row yet (shouldn't happen post-finish, but defensive).
  const items: ReplayListItem[] = []
  for (const g of games) {
    const r = replayByGame.get(g.id as string)
    if (!r) continue
    const callerIsP1 = (g.player1_id as string) === userId
    const winnerId = g.winner_id as string | null
    const won = winnerId == null ? null : winnerId === userId
    items.push({
      id: r.id as string,
      gameId: g.id as string,
      p1Username: (r.p1_username as string | null) ?? null,
      p2Username: (r.p2_username as string | null) ?? null,
      callerIsP1,
      won,
      public: r.public as boolean,
      format: (r.format as string | null) ?? null,
      gameFormat: (r.game_format as string | null) ?? null,
      gameRotation: (r.game_rotation as string | null) ?? null,
      turnCount: r.turn_count as number,
      createdAt: r.created_at as string,
    })
  }

  return { replays: items, total: count ?? items.length }
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

/** Perspective the caller is asking the replay to be rendered from.
 *  - `p1` / `p2` — filter every state via `filterStateForPlayer` so the
 *                  caller sees only what that player saw at each step
 *                  (their own hand, opponent's hand stubbed, public board).
 *  - `neutral`   — no filter; both hands fully visible. Only legal when
 *                  the replay has been opted-public (`replays.public=true`)
 *                  by both players. */
export type ReplayPerspective = "p1" | "p2" | "neutral"

/** Replay row shape returned to clients. Merges the `replays` table
 *  metadata with the reconstructed, per-viewer-filtered state stream.
 *
 *  PHASE A (2026-04-29): the legacy `{ seed, p1Deck, p2Deck, actions }`
 *  payload was removed to close an anti-cheat leak — when the client
 *  reconstructed locally it had no way to apply the per-player filter
 *  from `filterStateForPlayer`, so a player reviewing their just-finished
 *  MP game could see the opponent's complete hand history (every draw,
 *  every tutor, every private peek). We now reconstruct + filter
 *  server-side and return pre-rendered `GameState[]`. The `perspective`
 *  field echoes which view the client is looking at so the consumer can
 *  render the appropriate label / disable opponent-specific controls. */
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
  /** The viewing perspective the states below were filtered against. */
  perspective: ReplayPerspective
  /** Reconstructed + per-viewer-filtered state stream.
   *  - `states[0]` is the initial state (post-`createGame`, before any action).
   *  - `states[N]` is the state AFTER action N-1 was applied.
   *  - Length = `actions.length + 1`.
   *  Each state has been run through `filterStateForPlayer` for `p1`/`p2`
   *  perspectives; `neutral` returns unfiltered states. */
  replay: {
    states: GameState[]
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

/** Compose the client-facing ReplayView from the replays row + per-viewer
 *  filtered state stream. Separate function so the route layer can call
 *  `getReplayById` for access-control first (cheap) and only hit
 *  `getFilteredGameReplay` (expensive — replays the full action stream) after
 *  the access-matrix check has passed.
 *
 *  Callers MUST resolve `perspective` BEFORE calling this. See
 *  `decideReplayAccess` for the access-matrix logic that maps
 *  (caller, replay-public-flag, requested-perspective) → granted-perspective
 *  | rejection. The route layer rejects with 401/403 on a rejection;
 *  this function never auths. */
export async function buildReplayView(
  replayId: string,
  replay: NonNullable<Awaited<ReturnType<typeof getReplayById>>>,
  includePayload: boolean,
  perspective: ReplayPerspective,
): Promise<ReplayView> {
  const winnerUsername =
    replay.row.winner_player_id === replay.p1_id
      ? replay.row.p1_username
      : replay.row.winner_player_id === replay.p2_id
        ? replay.row.p2_username
        : null

  let payload: ReplayView["replay"] = null
  if (includePayload) {
    const r = await getFilteredGameReplay(replay.row.game_id, perspective)
    if (r) {
      payload = {
        states: r.states,
        winner: r.winner,
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
    perspective,
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

/** Inputs to {@link decideReplayAccess}. Pure data — no DB handles. */
export interface ReplayAccessInput {
  /** Supabase user id of the caller, or null for unauth'd. */
  userId: string | null
  /** Player1 of the parent game (from `getReplayById`). */
  p1Id: string
  /** Player2 of the parent game. */
  p2Id: string
  /** `replays.public` flag. True iff both players opted in to the share link. */
  isPublic: boolean
  /** What the caller asked for via `?perspective=`, or null if omitted. */
  requested: ReplayPerspective | null
}

export type ReplayAccessDecision =
  | { ok: true; perspective: ReplayPerspective }
  | { ok: false; status: 401 | 403; error: string }

/**
 * Pure function: decide whether `userId` may view the replay, and from which
 * perspective. Encodes the Phase A access matrix from
 * docs/HANDOFF.md → "Shareable MP replays — close the anti-cheat leak":
 *
 * | Caller          | Replay state | Requested      | Result                                           |
 * |-----------------|--------------|----------------|--------------------------------------------------|
 * | Player1         | private      | omitted/p1     | 200, perspective=p1                              |
 * | Player1         | private      | p2             | 403                                              |
 * | Player1         | private      | neutral        | 403 (player not entitled to opp's hand on priv)  |
 * | Player1         | public       | omitted/p1     | 200, perspective=p1                              |
 * | Player1         | public       | p2             | 200, perspective=p2 (preview shareable view)     |
 * | Player1         | public       | neutral        | 200, perspective=neutral                         |
 * | Non-player auth | private      | any            | 403                                              |
 * | Non-player auth | public       | omitted/any    | 200, perspective=requested ?? neutral            |
 * | Unauthed        | private      | any            | 401                                              |
 * | Unauthed        | public       | omitted/any    | 200, perspective=requested ?? neutral            |
 *
 * Default-perspective rule: caller-is-player → their own slot. Otherwise →
 * neutral (only reachable when the replay is public; non-players on private
 * are 403'd before defaulting).
 *
 * Pure so the route layer can unit-test the matrix without spinning up a
 * Supabase double or the engine reconstruction loop.
 */
export function decideReplayAccess(input: ReplayAccessInput): ReplayAccessDecision {
  const { userId, p1Id, p2Id, isPublic, requested } = input

  // Identify caller's relationship to the game.
  const callerSlot: "p1" | "p2" | null =
    userId === p1Id ? "p1" : userId === p2Id ? "p2" : null
  const isPlayer = callerSlot != null

  // Gate 1: private + non-player → 401 if unauthed, 403 if authed-as-other.
  if (!isPublic && !isPlayer) {
    return userId == null
      ? { ok: false, status: 401, error: "Authentication required" }
      : { ok: false, status: 403, error: "This replay is private" }
  }

  // Gate 2: private + player + opponent/neutral perspective → 403.
  // The player isn't entitled to see their opponent's hand even on their
  // own game's replay; neutral on a private game would leak both hands.
  if (!isPublic && isPlayer && requested != null) {
    const ownPerspective: ReplayPerspective = callerSlot
    if (requested !== ownPerspective) {
      return { ok: false, status: 403, error: "Cannot view opponent's perspective on a private replay" }
    }
  }

  // Gate 3: default perspective resolution.
  // - Player default → own slot (p1/p2).
  // - Non-player default → neutral (only reachable here when isPublic=true,
  //   because non-player + private was already 403'd above).
  const granted: ReplayPerspective =
    requested ?? (isPlayer ? (callerSlot as "p1" | "p2") : "neutral")

  return { ok: true, perspective: granted }
}

/**
 * Reconstruct the game's full state stream and apply per-viewer filtering.
 *
 * Pulls the same seed + decks + actions data as `getGameReplay`, then runs
 * `createGame + applyAction` server-side (mirroring the loop that used to
 * live in `useReplaySession.ts:40-56`) to produce `GameState[]`. For
 * `p1`/`p2` perspectives, every state is passed through
 * `filterStateForPlayer` so the response payload contains no information
 * the requested viewer wasn't entitled to see at that step (opponent's
 * hand stubbed, opponent's deck stubbed, private peeks redacted, etc.).
 * For `neutral`, states are returned unfiltered — only legal when
 * `replays.public === true`, which the access-matrix gate enforces.
 *
 * Why server-side: the legacy client-side reconstruction at
 * `packages/ui/src/hooks/useReplaySession.ts` had no filter applied, so a
 * player reviewing their just-finished MP game saw the opponent's full
 * private history. Returning pre-filtered states removes any way for the
 * client to bypass the filter.
 *
 * Cost: one full action-stream replay + N filter passes per request. For
 * a typical 20-turn MP game (~150 actions) this is ~150 reducer calls
 * + ~150 filter passes, well under 100ms at engine speeds. No caching for
 * Phase A (recompute on every fetch); `replays.cached_states_jsonb` is
 * the future option if measurable load shows up.
 */
export async function getFilteredGameReplay(
  gameId: string,
  perspective: ReplayPerspective,
): Promise<{ states: GameState[]; winner: PlayerID | null; turnCount: number } | null> {
  const r = await getGameReplay(gameId)
  if (!r) return null

  // Reconstruct: createGame seeded with the original RNG seed, then applyAction
  // for each persisted action. Mirrors useReplaySession.ts:40-56 — keep the
  // shapes in sync if either side changes.
  const initial = createGame(
    {
      player1Deck: r.p1Deck as DeckEntry[],
      player2Deck: r.p2Deck as DeckEntry[],
      seed: r.seed,
      interactive: true,
      chooserPlayerId: "player1",
    },
    definitions,
  )

  const states: GameState[] = [initial]
  let current = initial
  for (const action of r.actions as GameAction[]) {
    const result = applyAction(current, action, definitions)
    if (result.success) current = result.newState
    // Push regardless so step indices align with the source actions array
    // even if some action fails to apply (e.g., engine version skew).
    // Same fallthrough behavior as useReplaySession.ts:48-53.
    states.push(current)
  }

  // Apply per-viewer filter for player perspectives. Neutral returns
  // unfiltered states (only legal when isPublic=true; access-matrix gate
  // ensures we never reach here with neutral on a private replay).
  let filtered: GameState[]
  if (perspective === "neutral") {
    filtered = states
  } else {
    const playerId: PlayerID = perspective === "p1" ? "player1" : "player2"
    filtered = states.map((s) => filterStateForPlayer(s, playerId))
  }

  return {
    states: filtered,
    winner: r.winner as PlayerID | null,
    turnCount: r.turnCount,
  }
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
