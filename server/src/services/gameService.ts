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
import {
  applyActionTick,
  applyHeartbeat,
  checkGraceExhausted,
  checkTimeout,
  detectDisconnect,
  getDecisionPlayer,
  initialClockState,
  MATCH_CLOCK_CONFIG,
  projectClockForDisplay,
  type ClockState,
  type MatchFormat as ClockMatchFormat,
} from "./matchClock.js"

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
  /** Match format ("bo1" | "bo3"). Drives per-game clock parameters
   *  (bank size + Fischer increment) via MATCH_CLOCK_CONFIG. Each game in a
   *  Bo3 gets a fresh bank — Bo3 doesn't share a clock across games. Default
   *  "bo1" matches the column default; queue and lobby paths thread the real
   *  value through. */
  matchFormat?: ClockMatchFormat
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

  // Initialize the match clock from MATCH_CLOCK_CONFIG. Each game (including
  // Bo3 games 2/3) gets a fresh bank — Bo3 doesn't share a clock across
  // games. activePlayerSince=now means the clock starts the moment the
  // games row is created; in practice the chooser_play_order pendingChoice
  // is the first interaction so player1 (the chooser) is on the clock from
  // game-creation. If anyone abandons the game before the first action,
  // they'll timeout via the lazy check on the next GET /game/:id.
  const matchFormat: ClockMatchFormat = options.matchFormat ?? "bo1"
  const clockConfig = MATCH_CLOCK_CONFIG[matchFormat]
  const now = new Date()
  const clock = initialClockState(clockConfig, now)

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
      // Match clock — see server/src/services/matchClock.ts for semantics.
      match_format: matchFormat,
      p1_time_remaining_ms: clock.p1TimeRemainingMs,
      p2_time_remaining_ms: clock.p2TimeRemainingMs,
      active_player_since: clock.activePlayerSince,
      p1_grace_remaining_ms: clock.p1GraceRemainingMs,
      p2_grace_remaining_ms: clock.p2GraceRemainingMs,
      p1_last_heartbeat_at: clock.p1LastHeartbeatAt,
      p2_last_heartbeat_at: clock.p2LastHeartbeatAt,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create game: ${error.message}`)
  return data as { id: string }
}

// =============================================================================
// MATCH CLOCK — DB row ↔ ClockState marshalling
// =============================================================================

/** Read clock fields off a `games` row into a ClockState. Supabase returns
 *  TIMESTAMPTZ as ISO strings (or null); convert to Date. BIGINT comes back
 *  as a JS number (safe for our duration ranges — 25 min = 1.5M ms, well
 *  under Number.MAX_SAFE_INTEGER). */
function readClockFromRow(row: Record<string, unknown>): ClockState | null {
  // Pre-cutover rows have null clock columns. Caller decides whether to
  // backfill (initial-action path) or skip (read-only path).
  if (row["p1_time_remaining_ms"] == null) return null

  const parseTimestamp = (v: unknown): Date | null => {
    if (v == null) return null
    if (v instanceof Date) return v
    return new Date(v as string)
  }

  return {
    p1TimeRemainingMs: Number(row["p1_time_remaining_ms"]),
    p2TimeRemainingMs: Number(row["p2_time_remaining_ms"]),
    p1GraceRemainingMs: Number(row["p1_grace_remaining_ms"]),
    p2GraceRemainingMs: Number(row["p2_grace_remaining_ms"]),
    activePlayerSince: parseTimestamp(row["active_player_since"]),
    p1DisconnectedSince: parseTimestamp(row["p1_disconnected_since"]),
    p2DisconnectedSince: parseTimestamp(row["p2_disconnected_since"]),
    p1LastHeartbeatAt: parseTimestamp(row["p1_last_heartbeat_at"]),
    p2LastHeartbeatAt: parseTimestamp(row["p2_last_heartbeat_at"]),
  }
}

/** Build the partial games-row UPDATE payload from a ClockState. Used by
 *  every callsite that needs to persist clock changes. */
function clockToRowUpdate(clock: ClockState): Record<string, unknown> {
  return {
    p1_time_remaining_ms: clock.p1TimeRemainingMs,
    p2_time_remaining_ms: clock.p2TimeRemainingMs,
    p1_grace_remaining_ms: clock.p1GraceRemainingMs,
    p2_grace_remaining_ms: clock.p2GraceRemainingMs,
    active_player_since: clock.activePlayerSince,
    p1_disconnected_since: clock.p1DisconnectedSince,
    p2_disconnected_since: clock.p2DisconnectedSince,
    p1_last_heartbeat_at: clock.p1LastHeartbeatAt,
    p2_last_heartbeat_at: clock.p2LastHeartbeatAt,
  }
}

/** Read the games row's match_format column with a safe default. Coerces any
 *  unexpected value to "bo1" (the default) — defensive against legacy rows
 *  that pre-date the column or got a non-canonical write. */
function getMatchFormat(row: Record<string, unknown>): ClockMatchFormat {
  const raw = row["match_format"]
  return raw === "bo3" ? "bo3" : "bo1"
}

export async function processAction(
  gameId: string,
  userId: string,
  action: GameAction,
): Promise<{ success: boolean; newState?: GameState; error?: string; nextGameId?: string; timedOut?: PlayerID }> {
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

  // CLOCK CHECK — pre-action. If the active player's bank has run out OR
  // someone's grace has expired, the game ended via the clock before this
  // action was attempted. Finalize the game and reject the action.
  //
  // Read the clock state from the row. Pre-clock-rollout games have null
  // clock columns (readClockFromRow returns null) — skip the check for
  // those; they remain on the legacy untimed path.
  const matchFormat = getMatchFormat(game as Record<string, unknown>)
  const clockConfig = MATCH_CLOCK_CONFIG[matchFormat]
  let clockBefore = readClockFromRow(game as Record<string, unknown>)
  const now = new Date()
  if (clockBefore) {
    // Detect any disconnects that may have crossed the threshold since the
    // last fetch. This populates pX_disconnected_since so the timeout /
    // grace checks below see the correct paused state.
    clockBefore = detectDisconnect(clockBefore, now, clockConfig)

    // Grace exhaustion takes precedence over time-bank exhaustion (a
    // disconnected player's bank is paused, so the only way to lose during
    // a disconnect is via grace running out).
    const graceLoser = checkGraceExhausted(clockBefore, now)
    if (graceLoser) {
      await finalizeClockLoss(gameId, game as Record<string, unknown>, graceLoser, "disconnect", clockBefore)
      return { success: false, error: "Game ended — opponent disconnect grace expired.", timedOut: graceLoser }
    }

    const decisionPlayerBefore = getDecisionPlayer(state)
    const timeLoser = checkTimeout(clockBefore, decisionPlayerBefore, now)
    if (timeLoser) {
      await finalizeClockLoss(gameId, game as Record<string, unknown>, timeLoser, "timeout", clockBefore)
      return { success: false, error: "Game ended — your time bank expired.", timedOut: timeLoser }
    }
  }

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

  // CLOCK TICK — post-action. Decrement the OLD decision player's bank for
  // think time consumed, optionally add Fischer increment if state.currentPlayer
  // flipped, re-anchor activePlayerSince. The Sudden Chill case ("p1 plays,
  // p2 must discard") is handled correctly: decisionPlayer flips p1→p2 with
  // no increment (currentPlayer unchanged), p2's clock starts ticking from
  // this instant. See matchClock.ts → "Sudden Chill round trip" test.
  let clockAfter: ClockState | null = null
  if (clockBefore) {
    const oldDecision = getDecisionPlayer(stateBefore)
    const newDecision = getDecisionPlayer(newState)
    clockAfter = applyActionTick(
      clockBefore,
      oldDecision,
      newDecision,
      stateBefore.currentPlayer,
      newState.currentPlayer,
      clockConfig,
      now,
    )
  }

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
      ...(clockAfter ? clockToRowUpdate(clockAfter) : {}),
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

/** Per-format games-played counter map. Same key shape as EloRatings, but the
 *  zero-default lets us treat missing keys as "no games played in that bucket"
 *  without having to nullcheck on read. Mirrors the schema's JSONB seed. */
type GamesPlayedByFormat = Record<EloKey, number>

function buildDefaultGamesPlayedByFormat(): GamesPlayedByFormat {
  const out: Partial<Record<EloKey, number>> = {}
  for (const match of ["bo1", "bo3"] as const) {
    for (const [family, registry] of [
      ["core", CORE_ROTATIONS],
      ["infinity", INFINITY_ROTATIONS],
    ] as const) {
      for (const rotation of Object.keys(registry) as RotationId[]) {
        out[`${match}_${family}_${rotation}`] = 0
      }
    }
  }
  return out as GamesPlayedByFormat
}

const DEFAULT_GAMES_PLAYED_BY_FORMAT: GamesPlayedByFormat = buildDefaultGamesPlayedByFormat()

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

/** Take an existing per-format counts JSONB (possibly partial / null), merge
 *  it onto the default-zero map, and increment the supplied bucket by 1.
 *  Returns the full 8-key (or larger, when registries grow) map ready to be
 *  written back to the profiles row. The default-merge keeps the JSONB's
 *  full key set populated even if a row still has the old `{}` default.
 *
 *  Exported for direct unit-testing — the function is pure (no DB), so we
 *  can verify the bump logic without spinning up the supabase double. */
export function bumpGamesPlayedByFormat(
  existing: Partial<GamesPlayedByFormat> | null | undefined,
  eloKey: EloKey,
): GamesPlayedByFormat {
  const next: GamesPlayedByFormat = { ...DEFAULT_GAMES_PLAYED_BY_FORMAT, ...(existing ?? {}) }
  next[eloKey] = (next[eloKey] ?? 0) + 1
  return next
}

async function updateElo(
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
  eloKey: EloKey = FALLBACK_ELO_KEY,
  gameRanked: boolean = false,
): Promise<EloUpdateResult | null> {
  // Unranked match: still bump games_played + games_played_by_format for
  // activity tracking, but skip the ELO math entirely. Private lobbies are
  // always ranked=false (anti-collusion); casual queue games are always
  // ranked=false; ranked queue games are ranked iff the rotation has
  // ranked=true at game-create time. The flag is read directly off
  // `games.ranked` — no need to re-derive from the rotation registry here,
  // since it's already authoritative.
  if (!gameRanked) {
    const [{ data: p1g }, { data: p2g }] = await Promise.all([
      supabase
        .from("profiles")
        .select("games_played, games_played_by_format")
        .eq("id", player1Id)
        .single(),
      supabase
        .from("profiles")
        .select("games_played, games_played_by_format")
        .eq("id", player2Id)
        .single(),
    ])
    if (p1g && p2g) {
      const p1Counts = bumpGamesPlayedByFormat(
        p1g.games_played_by_format as Partial<GamesPlayedByFormat> | null,
        eloKey,
      )
      const p2Counts = bumpGamesPlayedByFormat(
        p2g.games_played_by_format as Partial<GamesPlayedByFormat> | null,
        eloKey,
      )
      await Promise.all([
        supabase
          .from("profiles")
          .update({
            games_played: (p1g.games_played as number) + 1,
            games_played_by_format: p1Counts,
          })
          .eq("id", player1Id),
        supabase
          .from("profiles")
          .update({
            games_played: (p2g.games_played as number) + 1,
            games_played_by_format: p2Counts,
          })
          .eq("id", player2Id),
      ])
    }
    return null
  }

  const [{ data: p1 }, { data: p2 }] = await Promise.all([
    supabase
      .from("profiles")
      .select("elo, elo_ratings, games_played, games_played_by_format")
      .eq("id", player1Id)
      .single(),
    supabase
      .from("profiles")
      .select("elo, elo_ratings, games_played, games_played_by_format")
      .eq("id", player2Id)
      .single(),
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

  const p1Counts = bumpGamesPlayedByFormat(
    p1.games_played_by_format as Partial<GamesPlayedByFormat> | null,
    eloKey,
  )
  const p2Counts = bumpGamesPlayedByFormat(
    p2.games_played_by_format as Partial<GamesPlayedByFormat> | null,
    eloKey,
  )

  // Also update the legacy elo column with the rating that just changed
  await Promise.all([
    supabase
      .from("profiles")
      .update({
        elo: p1After,
        elo_ratings: p1Ratings,
        games_played: (p1.games_played as number) + 1,
        games_played_by_format: p1Counts,
      })
      .eq("id", player1Id),
    supabase
      .from("profiles")
      .update({
        elo: p2After,
        elo_ratings: p2Ratings,
        games_played: (p2.games_played as number) + 1,
        games_played_by_format: p2Counts,
      })
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

  // CLOCK CHECK — lazy on read. If the active player's bank or grace has run
  // out since the last action, finalize the game now so the caller sees the
  // finished state. Only fires for clocked games (legacy untimed games skip).
  if (data.status === "active") {
    const clock = readClockFromRow(data as Record<string, unknown>)
    if (clock) {
      const matchFormat = getMatchFormat(data as Record<string, unknown>)
      const config = MATCH_CLOCK_CONFIG[matchFormat]
      const now = new Date()
      const detected = detectDisconnect(clock, now, config)

      const graceLoser = checkGraceExhausted(detected, now)
      if (graceLoser) {
        await finalizeClockLoss(gameId, data as Record<string, unknown>, graceLoser, "disconnect", detected)
        // Re-fetch so the caller sees the finalized state. Cheap — single PK lookup.
        const { data: refreshed } = await supabase.from("games").select("*").eq("id", gameId).single()
        return refreshed ?? data
      }

      const decision = getDecisionPlayer(data.state as GameState)
      const timeLoser = checkTimeout(detected, decision, now)
      if (timeLoser) {
        await finalizeClockLoss(gameId, data as Record<string, unknown>, timeLoser, "timeout", detected)
        const { data: refreshed } = await supabase.from("games").select("*").eq("id", gameId).single()
        return refreshed ?? data
      }

      // Persist any newly-detected disconnect flags (so the next read doesn't
      // re-detect from scratch — keeps grace accounting honest across reads).
      if (
        detected.p1DisconnectedSince !== clock.p1DisconnectedSince ||
        detected.p2DisconnectedSince !== clock.p2DisconnectedSince
      ) {
        await supabase
          .from("games")
          .update(clockToRowUpdate(detected))
          .eq("id", gameId)
        // Reflect the persisted state into the returned row so the caller
        // doesn't see stale disconnect flags.
        Object.assign(data as Record<string, unknown>, clockToRowUpdate(detected))
      }
    }
  }

  return data
}

/** Finalize a game that ended via the clock (timeout or grace exhaustion).
 *  Writes the loser's clock state, the outcome_reason, and the winner_id; sets
 *  status='finished'. Also embeds isGameOver/winner into state.state so
 *  clients see the finished state via Realtime + GET.
 *
 *  Does NOT update ELO or close the parent lobby — those flows (Bo3
 *  progression, ELO settle, replay save) happen via handleMatchProgress
 *  triggered by isGameOver. For now we leave that integration as a TODO
 *  hooked from a separate path; the immediate behavior is "game ends and
 *  both players see the right outcome." */
async function finalizeClockLoss(
  gameId: string,
  game: Record<string, unknown>,
  loser: PlayerID,
  reason: "timeout" | "disconnect",
  clock: ClockState,
): Promise<void> {
  const winner: PlayerID = loser === "player1" ? "player2" : "player1"
  const winnerId = winner === "player1" ? game["player1_id"] : game["player2_id"]
  const existingState = (game["state"] as GameState | undefined) ?? null
  // wonBy carries the clock-loss reason on the engine state so client overlays
  // can render the right copy ("opponent ran out of time" vs "opponent
  // disconnected"). Distinct from the canonical engine `wonBy` of
  // "lore" | "deckout" | "concede" — extending the union here goes
  // through `unknown` because we're stamping a server-only field that the
  // engine doesn't declare. UI consumers branch on the server-side
  // games.outcome_reason column rather than this field for type safety.
  const wonBy = reason === "timeout" ? "timeout" : "disconnect"
  const updatedState = existingState
    ? ({ ...(existingState as unknown as Record<string, unknown>), isGameOver: true, winner, wonBy } as unknown as GameState)
    : null

  await supabase
    .from("games")
    .update({
      status: "finished",
      winner_id: winnerId ?? null,
      outcome_reason: reason,
      updated_at: new Date(),
      ...(updatedState ? { state: updatedState } : {}),
      ...clockToRowUpdate(clock),
    })
    .eq("id", gameId)
}

/** Record a heartbeat from a player. Updates pX_last_heartbeat_at, clears any
 *  pX_disconnected_since flag (deducting the disconnect duration from grace),
 *  persists. Returns the up-to-date clock for caller display, or null if the
 *  game/player combo is invalid.
 *
 *  Called from POST /game/:id/heartbeat. Clients should call this every ~10s
 *  while the game tab is active (config.heartbeatTimeoutMs = 30s, so the
 *  caller has 3 ping intervals of slack before disconnect detection fires). */
export async function recordHeartbeat(
  gameId: string,
  userId: string,
): Promise<{ ok: true; clock: ClockState } | { ok: false; error: string; status: 403 | 404 | 409 }> {
  const { data: game, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()
  if (error || !game) return { ok: false, status: 404, error: "Game not found" }

  const player: PlayerID | null =
    game.player1_id === userId ? "player1" : game.player2_id === userId ? "player2" : null
  if (!player) return { ok: false, status: 403, error: "Not a player in this game" }

  if (game.status !== "active") {
    return { ok: false, status: 409, error: "Game is not active" }
  }

  const existing = readClockFromRow(game as Record<string, unknown>)
  if (!existing) {
    // Legacy untimed game — no clock to update. Treat as a no-op so the
    // client can fail-soft (won't crash on heartbeating into a pre-clock game).
    return { ok: false, status: 409, error: "Game has no clock (pre-clock-rollout legacy row)" }
  }

  const now = new Date()
  // Detect any pending disconnects FIRST so a long-stale player's existing
  // gap is captured into pX_disconnected_since before applyHeartbeat clears
  // it and ratchets grace. Without this, a player who was disconnected for
  // 60s but never had detectDisconnect run against their gap would get
  // their grace ratcheted by 0 instead of 60s.
  const detected = detectDisconnect(existing, now, MATCH_CLOCK_CONFIG[getMatchFormat(game as Record<string, unknown>)])
  const updated = applyHeartbeat(detected, player, now)

  await supabase.from("games").update(clockToRowUpdate(updated)).eq("id", gameId)
  return { ok: true, clock: updated }
}

/** Project the clock state forward to `now` for read-only client display.
 *  Pure read — does not persist anything. Returns null for legacy rows
 *  without a clock. Use in GET /game/:id response shaping so the client
 *  sees the live countdown rather than a stale stored bank. */
export function projectClockForRow(
  game: Record<string, unknown>,
  now: Date = new Date(),
): {
  p1TimeRemainingMs: number
  p2TimeRemainingMs: number
  p1GraceRemainingMs: number
  p2GraceRemainingMs: number
  p1Disconnected: boolean
  p2Disconnected: boolean
  matchFormat: ClockMatchFormat
} | null {
  const clock = readClockFromRow(game)
  if (!clock) return null
  const state = game["state"] as GameState | undefined
  if (!state) return null
  const decision = getDecisionPlayer(state)
  const projection = projectClockForDisplay(clock, decision, now)
  return {
    ...projection,
    p1Disconnected: clock.p1DisconnectedSince !== null,
    p2Disconnected: clock.p2DisconnectedSince !== null,
    matchFormat: getMatchFormat(game),
  }
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
    (lobby?.game_rotation as string) ?? "s12",
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

/** Result of a successful claim-win attempt — same shape as the game-finish
 *  Realtime payload so the route layer can echo straight back. eloDelta is
 *  null when the match wasn't ranked (private lobbies are unconditionally
 *  unranked — see anti-collusion comment in updateElo). */
export interface ClaimWinResult {
  ok: true
  winnerId: string
  eloDelta: EloUpdateResult | null
}

/**
 * Claim a win because the opponent has been disconnected long enough for
 * their grace window to have exhausted. Server-enforced precondition
 * (never trust the client): caller must be a game participant, game must
 * be in_progress, opponent's grace must be exhausted per the chess-clock
 * grace machinery in matchClock.ts.
 *
 * Disconnect threshold: we reuse the chess-clock grace window (per-player
 * per-game, default 3 min from MATCH_CLOCK_CONFIG) rather than introducing
 * a separate CLAIM_WIN_DISCONNECT_THRESHOLD_MS constant. One threshold to
 * reason about; the grace bank is already correctly ratcheted across
 * multiple disconnect/reconnect cycles. If the opponent reconnects and
 * deducts grace partially, the next claim-win attempt fires sooner — same
 * fairness contract as the natural disconnect-forfeit path in
 * processAction's grace check.
 *
 * On success: marks games.status='finished', winner_id=caller, runs the
 * normal updateElo path (claim-win counts as a normal win), writes the
 * replay row via saveReplayForGame, and embeds _eloDelta into the stored
 * state so both players see it via Realtime. The disconnected opponent
 * sees the game as completed on their next reconnect via GET /game/:id.
 *
 * Idempotent: if the game is already finished, returns the existing winner
 * — never errors. Two players hitting claim-win simultaneously converge on
 * the first DB write to land (the second observes status='finished' and
 * returns the same payload).
 */
export async function claimWin(
  gameId: string,
  userId: string,
): Promise<
  | ClaimWinResult
  | { ok: false; error: string; status: 400 | 403 | 404 | 409 }
> {
  const { data: game, error: loadError } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()

  if (loadError || !game) return { ok: false, status: 404, error: "Game not found" }

  const playerSide: PlayerID | null =
    game.player1_id === userId ? "player1" : game.player2_id === userId ? "player2" : null
  if (!playerSide) {
    return { ok: false, status: 403, error: "You are not a player in this game" }
  }

  // Idempotency — if the game is already finished, return the existing
  // winner. Covers the parallel-click race (two players hitting claim-win
  // simultaneously) and the "I already claimed and re-clicked" replay.
  if (game.status === "finished") {
    const winnerId = (game.winner_id as string | undefined) ?? null
    if (!winnerId) {
      // Defensive — game ended without a recorded winner (shouldn't happen
      // for a finalized game). Treat as a 409 so the caller doesn't think
      // they won when no one did.
      return { ok: false, status: 409, error: "Game is finished but has no recorded winner" }
    }
    return { ok: true, winnerId, eloDelta: null }
  }
  if (game.status !== "active") {
    return { ok: false, status: 409, error: `Cannot claim win in game with status "${game.status}"` }
  }

  // PRECONDITION — opponent's grace must be exhausted. Read the clock row,
  // detect any pending disconnect (in case the opponent went stale since the
  // last action without anyone running detectDisconnect against it), then
  // check checkGraceExhausted.
  const clock = readClockFromRow(game as Record<string, unknown>)
  if (!clock) {
    // Legacy untimed game — no grace window to exhaust. Claim-win isn't
    // available on those rows; clients should fall through to /resign.
    return {
      ok: false,
      status: 409,
      error: "Cannot claim win on a legacy untimed game (no clock state to verify disconnect)",
    }
  }

  const matchFormat = getMatchFormat(game as Record<string, unknown>)
  const clockConfig = MATCH_CLOCK_CONFIG[matchFormat]
  const now = new Date()
  const detected = detectDisconnect(clock, now, clockConfig)

  const opponent: PlayerID = playerSide === "player1" ? "player2" : "player1"
  const graceLoser = checkGraceExhausted(detected, now)
  if (graceLoser !== opponent) {
    // Two failure modes: (1) no one is grace-exhausted yet, (2) the CALLER
    // is the grace-exhausted one (their opponent should be claiming, not
    // them). Either way the request is invalid.
    return {
      ok: false,
      status: 409,
      error: "Opponent has not been disconnected long enough — claim-win not yet available",
    }
  }

  // All preconditions met. Finalize game in the disconnected-loss shape —
  // matches the existing finalizeClockLoss path used by the lazy grace
  // check inside processAction so clients see the same {wonBy:"disconnect",
  // outcome_reason:"disconnect"} shape regardless of trigger.
  const winner = playerSide
  const winnerId = winner === "player1" ? (game.player1_id as string) : (game.player2_id as string)

  // ELO + replay routing reads format/rotation off the parent lobby for
  // private games; falls back to FALLBACK_ELO_KEY for queue-spawned games
  // (lobby_id=null). Same shape as resignGame.
  const { data: lobby } = game.lobby_id
    ? await supabase.from("lobbies").select("*").eq("id", game.lobby_id as string).single()
    : { data: null }
  const eloKey = getEloKey(
    (lobby?.format as string) ?? "bo1",
    (lobby?.game_format as string) ?? "infinity",
    (lobby?.game_rotation as string) ?? "s12",
  )
  const gameRanked = (game.ranked as boolean | undefined) ?? false
  const eloUpdate = await updateElo(
    game.player1_id as string,
    game.player2_id as string,
    winner,
    eloKey,
    gameRanked,
  )

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

  // Mirror finalizeClockLoss's wonBy="disconnect" stamp so client overlays
  // render the same "opponent disconnected" copy whether the game ended via
  // the lazy grace check or via this claim-win call. _eloDelta embedded the
  // same way processAction does so the disconnected opponent sees the
  // rating change when they eventually reconnect.
  const existingState = (game.state as GameState | undefined) ?? null
  const stateWithFinish = existingState
    ? ({
        ...(existingState as unknown as Record<string, unknown>),
        isGameOver: true,
        winner,
        wonBy: "disconnect",
        ...(eloUpdate && {
          _eloDelta: {
            [game.player1_id as string]: eloUpdate.p1,
            [game.player2_id as string]: eloUpdate.p2,
            _eloKey: eloUpdate.eloKey,
          },
        }),
      } as unknown as GameState)
    : null

  // Persist the disconnect grace bookkeeping (`detected` may have flagged
  // newly-detected disconnects since the last write) alongside the game
  // finalization. Same write semantics as finalizeClockLoss.
  await supabase
    .from("games")
    .update({
      status: "finished",
      winner_id: winnerId,
      outcome_reason: "disconnect",
      updated_at: new Date(),
      ...(stateWithFinish ? { state: stateWithFinish } : {}),
      ...clockToRowUpdate(detected),
    })
    .eq("id", gameId)

  return { ok: true, winnerId, eloDelta: eloUpdate }
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

  // Denormalize usernames + display_names so share-link reads don't need a
  // profile join. p1_username / p2_username remain the historical handle
  // (stable since handles don't currently change). p1_display_name /
  // p2_display_name capture display_name AT FINISH TIME — replay viewer
  // chrome shows these with a "(now: X)" hover when current differs.
  // List views (listMyReplays) override these with current values via a
  // live profile join so renames flow forward in match history.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .in("id", [p1Id, p2Id])
  const usernameById = new Map((profiles ?? []).map((p) => [p.id as string, p.username as string]))
  const displayNameById = new Map(
    (profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]),
  )

  await supabase
    .from("replays")
    .upsert(
      {
        game_id: gameId,
        winner_player_id: winnerId,
        p1_username: usernameById.get(p1Id) ?? null,
        p2_username: usernameById.get(p2Id) ?? null,
        p1_display_name: displayNameById.get(p1Id) ?? usernameById.get(p1Id) ?? null,
        p2_display_name: displayNameById.get(p2Id) ?? usernameById.get(p2Id) ?? null,
        turn_count: state.turnNumber ?? 0,
        format: (lobby.format as string) ?? "bo1",
        game_format: (lobby.game_format as string) ?? "infinity",
        game_rotation: (lobby.game_rotation as string) ?? "s12",
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
    const gameRotation = (lobby.game_rotation as string) ?? "s12"
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
    rotation: (lobby.game_rotation as RotationId) ?? "s12",
  }

  // Bo3 next-game inherits the lobby's match format for the clock config.
  // Each game in a Bo3 gets a FRESH 25-min bank (tournament convention) —
  // initialClockState resets bank from MATCH_CLOCK_CONFIG[matchFormat] every
  // call, so no shared-clock-across-games risk.
  const bo3MatchFormat = (lobby.format as string) === "bo3" ? "bo3" : "bo1"
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
      matchFormat: bo3MatchFormat,
    },
  )

  return { nextGameId: nextGame.id, p1Wins, p2Wins }
}

/** One row in the "My Replays" browse list. Lightweight metadata only — no
 *  state stream, no decks (those cost a full reconstruction or a heavy fetch).
 *  Caller-perspective fields (`callerIsP1`, `won`) are stamped server-side so
 *  the UI doesn't need to re-derive from raw player IDs.
 *
 *  Discord-style username/display_name split: `p1Username` / `p2Username` are
 *  the stable handles (denormalized at finish, but also stable today since
 *  username rename is deferred). `p1DisplayName` / `p2DisplayName` reflect
 *  the **current** display_name via a live join with the profiles table —
 *  so when a player renames, their match history follows them in this list
 *  view. The replay-viewer endpoint instead surfaces the historical-at-finish
 *  display name from the replays row directly. */
export interface ReplayListItem {
  id: string
  gameId: string
  p1Username: string | null
  p2Username: string | null
  /** Current display_name from a live profile join (renames flow forward). */
  p1DisplayName: string | null
  /** Current display_name from a live profile join (renames flow forward). */
  p2DisplayName: string | null
  /** True if the calling user was player 1 of the parent game. False if they
   *  were player 2. (List is filtered to the caller's own games server-side,
   *  so they're always one of the two.) */
  callerIsP1: boolean
  /** Did the calling user win? Null if the game ended without a recorded winner
   *  (resign-with-no-valid-state is the documented case in the schema). */
  won: boolean | null
  /** Outcome discriminator from `games.outcome_reason` (chess-clock rollout
   *  Phase 2). Null for pre-rollout finished games — UI renders only the
   *  primary W/L badge in that case. */
  outcomeReason: "normal" | "concede" | "timeout" | "disconnect" | null
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
    .select("id, player1_id, player2_id, winner_id, status, outcome_reason", { count: "exact" })
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
      "id, game_id, public, p1_username, p2_username, p1_display_name, p2_display_name, turn_count, format, game_format, game_rotation, created_at",
    )
    .in("game_id", gameIds)

  if (rErr || !replays) {
    return { replays: [], total: count ?? 0 }
  }

  const replayByGame = new Map(replays.map((r) => [r.game_id as string, r]))

  // Live-join profiles for the CURRENT display_name across every distinct
  // player ID in the result set. List view contract (per HANDOFF.md): renames
  // flow forward into match history — so we ignore the historical denormal-
  // ized p1_display_name / p2_display_name and surface the current value.
  // Single IN-query so this is one round-trip regardless of result set size.
  const playerIds = new Set<string>()
  for (const g of games) {
    if (g.player1_id) playerIds.add(g.player1_id as string)
    if (g.player2_id) playerIds.add(g.player2_id as string)
  }
  const displayNameByUserId = new Map<string, string>()
  if (playerIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", [...playerIds])
    for (const p of profiles ?? []) {
      const name = (p.display_name as string | null) ?? (p.username as string | null) ?? null
      if (name) displayNameByUserId.set(p.id as string, name)
    }
  }

  // Preserve the games-order (newest-first) and drop any games that don't
  // have a replay row yet (shouldn't happen post-finish, but defensive).
  const items: ReplayListItem[] = []
  for (const g of games) {
    const r = replayByGame.get(g.id as string)
    if (!r) continue
    const callerIsP1 = (g.player1_id as string) === userId
    const winnerId = g.winner_id as string | null
    const won = winnerId == null ? null : winnerId === userId
    const p1Id = g.player1_id as string | null
    const p2Id = g.player2_id as string | null
    items.push({
      id: r.id as string,
      gameId: g.id as string,
      p1Username: (r.p1_username as string | null) ?? null,
      p2Username: (r.p2_username as string | null) ?? null,
      // Live-current display_name (renames flow forward); fall back to the
      // denormalized historical value, then to handle, then null.
      p1DisplayName:
        (p1Id != null ? displayNameByUserId.get(p1Id) : null) ??
        (r.p1_display_name as string | null) ??
        (r.p1_username as string | null) ??
        null,
      p2DisplayName:
        (p2Id != null ? displayNameByUserId.get(p2Id) : null) ??
        (r.p2_display_name as string | null) ??
        (r.p2_username as string | null) ??
        null,
      callerIsP1,
      won,
      // Pre-rollout finished games carry null in this column; the UI renders
      // no outcome annotation in that case (W/L badge tells the whole story).
      outcomeReason: (g.outcome_reason as ReplayListItem["outcomeReason"] | undefined) ?? null,
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
  /** Display name AT FINISH TIME (denormalized). UI compares against the
   *  live profile to show a "(now: X)" hover when current differs. List
   *  views use the live-current value via listMyReplays instead. */
  p1DisplayName: string | null
  p2DisplayName: string | null
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
        /** Historical display_name at game-finish time. Replay viewer chrome
         *  uses this directly; UI compares against the live profile to show
         *  "(now: X)" hover when the player has since renamed. */
        p1_display_name: string | null
        p2_display_name: string | null
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
      "id, game_id, public, winner_player_id, p1_username, p2_username, p1_display_name, p2_display_name, turn_count, format, game_format, game_rotation, created_at, games(player1_id, player2_id)",
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
      p1_display_name: (data.p1_display_name as string | null) ?? null,
      p2_display_name: (data.p2_display_name as string | null) ?? null,
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
    p1DisplayName: replay.row.p1_display_name ?? replay.row.p1_username,
    p2DisplayName: replay.row.p2_display_name ?? replay.row.p2_username,
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
