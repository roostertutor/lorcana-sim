import type { GameAction, GameState, DeckEntry, PlayerID, RotationId, GameFormatFamily } from "@lorcana-sim/engine"
import { supabase } from "./supabase.js"

const SERVER_URL = (import.meta.env["VITE_SERVER_URL"] as string | undefined) ?? "http://localhost:3001"

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string }
    return data.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/** Read the current access token from Supabase — auto-refreshes if expired. */
async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error("Not authenticated")
  return data.session.access_token
}

async function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getToken()}`,
  }
}

export async function getLobbyGame(lobbyId: string) {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { lobby: { status: string }; game: { id: string } | null; hostSide: "player1" | "player2" }
  return data
}

export async function ensureProfile() {
  const res = await fetch(`${SERVER_URL}/auth/me`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error("Failed to initialize profile")
}

/** Spectator-access policy on a lobby. Phase 7 (spectator mode) is the
 *  feature that consumes this; Phase 1 just stores it. Public lobbies
 *  auto-force 'public' server-side, private lobbies expose the full
 *  4-way policy picker. */
export type SpectatorPolicy = "off" | "invite_only" | "friends" | "public"

export interface CreateLobbyOptions {
  /** When true, lobby appears in the public-lobby browser for anyone to
   *  join. Server also forces spectatorPolicy to 'public' in this case. */
  public?: boolean
  /** Phase 1 plumbing — stored for Phase 7 to consume. Defaults to 'off'
   *  on server. Ignored when `public: true` (server uses 'public'). */
  spectatorPolicy?: SpectatorPolicy
}

export async function createLobby(
  deck: DeckEntry[],
  format: "bo1" | "bo3" = "bo1",
  gameFormat: GameFormatFamily = "infinity",
  gameRotation: RotationId = "s12",
  options: CreateLobbyOptions = {},
) {
  const res = await fetch(`${SERVER_URL}/lobby/create`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      deck,
      format,
      gameFormat,
      gameRotation,
      public: options.public ?? false,
      spectatorPolicy: options.spectatorPolicy ?? "off",
    }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{
    lobbyId: string
    code: string
    format: string
    gameFormat: string
    gameRotation: string
    public: boolean
    spectatorPolicy: SpectatorPolicy
  }>
}

/** One entry in the public-lobby browser. Server deliberately omits deck
 *  fields (no scouting). Caller's own lobbies are filtered out server-side. */
export interface PublicLobby {
  id: string
  code: string
  hostUsername: string
  format: "bo1" | "bo3"
  gameFormat: GameFormatFamily
  gameRotation: RotationId
  spectatorPolicy: SpectatorPolicy
  createdAt: string
}

/** List public, waiting lobbies others have opened. Returns empty array
 *  on transport errors — UI shouldn't blow up if the server is blippy. */
export async function listPublicLobbies(): Promise<PublicLobby[]> {
  try {
    const res = await fetch(`${SERVER_URL}/lobby/public`, {
      headers: await authHeaders(),
    })
    if (!res.ok) return []
    const data = await res.json() as { lobbies: PublicLobby[] }
    return data.lobbies
  } catch {
    return []
  }
}

/** Host-only cancel of a waiting lobby. Returns ok=true on success;
 *  otherwise { error, status } with 404 / 403 / 409. A 409 typically
 *  means someone already joined — UI should redirect into the game
 *  rather than surface the error. */
export async function cancelLobby(
  lobbyId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}/cancel`, {
    method: "POST",
    headers: await authHeaders(),
  })
  if (res.ok) return { ok: true }
  const error = await extractError(res)
  return { ok: false, error, status: res.status }
}

/** Errors the rematch endpoint surfaces — see server/src/routes/lobby.ts.
 *  Idempotent on the server side: two players clicking simultaneously
 *  converge on the same new lobby + gameId. The 409 ACTIVE_GAME case is
 *  the only one a user can self-resolve (close the other game/queue). */
export interface RematchError {
  status: number
  message: string
}

/** POST /lobby/rematch — create (or join) a rematch lobby for a finished
 *  match. Server spawns the first game synchronously and returns its id, so
 *  the client navigates straight to /game/${gameId} without a separate
 *  Realtime accept step. Caller responsibility: surface error.message and
 *  re-enable the button on rejection. */
export async function postRematch(previousLobbyId: string): Promise<{
  lobbyId: string
  gameId: string
  code: string
  myPlayerId: "player1" | "player2"
}> {
  const res = await fetch(`${SERVER_URL}/lobby/rematch`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ previousLobbyId }),
  })
  if (!res.ok) {
    const message = await extractError(res)
    const err: RematchError = { status: res.status, message }
    throw err
  }
  return await res.json() as {
    lobbyId: string
    gameId: string
    code: string
    myPlayerId: "player1" | "player2"
  }
}

export async function joinLobby(code: string, deck: DeckEntry[]) {
  const res = await fetch(`${SERVER_URL}/lobby/join`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ code, deck }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string; gameId: string; myPlayerId: "player1" | "player2" }>
}

export async function getGame(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json() as { game: { state: GameState; status?: string }; playerSide?: "player1" | "player2" }
  return data.game.state
}

export async function getGameInfo(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  // Server spreads the full games row into `data.game`, so DB column names
  // come through as snake_case. lobby_id is null for queue-spawned games
  // (no parent lobby — see gameService.ts ~line 588).
  const data = await res.json() as {
    game: { state: GameState; status?: string; lobby_id?: string | null }
    playerSide: "player1" | "player2"
  }
  return {
    state: data.game.state,
    playerSide: data.playerSide,
    status: data.game.status,
    lobbyId: data.game.lobby_id ?? null,
  }
}

export async function sendAction(gameId: string, action: GameAction) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/action`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ success: boolean; newState: GameState; nextGameId?: string }>
}

export async function resignGame(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/resign`, {
    method: "POST",
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
}

/** Per-rotation ELO key — matches the server schema's JSONB shape.
 *  One bucket per (match-format × card-pool × rotation). Mirrors the engine's
 *  registry (CORE_ROTATIONS / INFINITY_ROTATIONS) — when a new rotation lands,
 *  add it to RotationId in the engine and the key union grows automatically. */
export type EloKey = `${"bo1" | "bo3"}_${GameFormatFamily}_${RotationId}`
export type EloRatings = Record<EloKey, number>

export interface Profile {
  username: string
  elo: number
  elo_ratings: EloRatings
  /** Overall games-played counter across all formats. Kept as the single
   *  activity number for the avatar dropdown; for per-format counts that
   *  pair with the ratings table, use `games_played_by_format`. */
  games_played: number
  /** Per-format games-played counter, mirroring the EloRatings shape. Each
   *  bucket increments by 1 per finished game (both ranked and unranked)
   *  in the matching {match × family × rotation} key. Server seeds the
   *  full 8-key shape with zeros so the field is always defined post-
   *  migration; missing keys read as 0 if older clients race a new key. */
  games_played_by_format: Record<EloKey, number>
}

export async function getProfile(): Promise<Profile | null> {
  const res = await fetch(`${SERVER_URL}/auth/me`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { profile: Profile }
  return data.profile
}

export interface GameHistoryEntry {
  id: string
  opponentName: string
  opponentElo: number
  won: boolean
  date: string
}

export async function getGameHistory(page = 0, limit = 20): Promise<GameHistoryEntry[]> {
  const res = await fetch(`${SERVER_URL}/game/history?page=${page}&limit=${limit}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return []
  const data = await res.json() as { games: GameHistoryEntry[] }
  return data.games
}

export async function getGameActionList(gameId: string): Promise<GameAction[]> {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/actions`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return []
  const data = await res.json() as { actions: GameAction[] }
  return data.actions
}

/** Server's per-viewer-filtered replay payload. Matches `ReplayView` in
 *  `server/src/services/gameService.ts` (Phase A, commit 937fbb8). */
export type ReplayPerspective = "p1" | "p2" | "neutral"

export interface ReplayMeta {
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
  /** The viewing perspective `replay.states` was filtered against. */
  perspective: ReplayPerspective
  /** Pre-rendered, per-viewer-filtered state stream + winner. Null if the
   *  underlying game has no actions yet (shouldn't happen for finished MP
   *  games, but the server returns nullable so we mirror it). */
  replay: {
    states: GameState[]
    winner: PlayerID | null
  } | null
}

/** Fetch a replay via `GET /game/:id/replay` (player-only auth path).
 *  PHASE A (commit 937fbb8) anti-cheat fix: server now returns a pre-filtered
 *  state stream instead of raw seed+actions+decks. Pass `perspective` to
 *  request a specific view ('p2' / 'neutral' subject to the access matrix:
 *  see `decideReplayAccess` in gameService.ts).
 *
 *  Returns null on 4xx/5xx — caller can distinguish "no replay yet" (game
 *  not finished) vs "forbidden" by status if needed; today we just collapse. */
export async function getGameReplay(
  gameId: string,
  perspective?: ReplayPerspective,
): Promise<ReplayMeta | null> {
  const url = perspective != null
    ? `${SERVER_URL}/game/${gameId}/replay?perspective=${perspective}`
    : `${SERVER_URL}/game/${gameId}/replay`
  const res = await fetch(url, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { replay: ReplayMeta }
  return data.replay
}

/** Fetch a replay via `GET /replay/:id` (public-or-player auth path). Used
 *  by the share-link flow — readable without a session for public replays.
 *  Auth header is omitted when no session exists; server's optional-auth
 *  handler reads the bearer if present, otherwise treats as anonymous and
 *  returns 200 only when `replays.public=true`. */
export async function getSharedReplay(
  replayId: string,
  perspective?: ReplayPerspective,
): Promise<ReplayMeta | null> {
  const url = perspective != null
    ? `${SERVER_URL}/replay/${replayId}?perspective=${perspective}`
    : `${SERVER_URL}/replay/${replayId}`
  // Auth header is best-effort — public replays work without it. Suppress
  // throws from getToken() (no session) and just send the request anonymously.
  let headers: Record<string, string> = { "Content-Type": "application/json" }
  try {
    headers = await authHeaders()
  } catch { /* anonymous request — server will gate on replay.public */ }
  const res = await fetch(url, { headers })
  if (!res.ok) return null
  const data = await res.json() as { replay: ReplayMeta }
  return data.replay
}

/** Lightweight row in the "My Replays" browse list. Mirrors the server's
 *  `ReplayListItem` shape — no state stream, no decks. Click a row → navigate
 *  to `/replay/:gameId` which hits the per-replay filtered endpoint. */
export interface ReplayListItem {
  id: string
  gameId: string
  p1Username: string | null
  p2Username: string | null
  callerIsP1: boolean
  won: boolean | null
  public: boolean
  format: string | null
  gameFormat: string | null
  gameRotation: string | null
  turnCount: number
  createdAt: string
}

/** Fetch the caller's MP replays (player-only auth). Newest-first, paginated.
 *  Returns `{ replays: [], total: 0 }` on transport error so the UI can
 *  distinguish "no results" from "auth failure" via inspecting `total`. */
export async function getMyReplays(
  limit = 50,
  offset = 0,
): Promise<{ replays: ReplayListItem[]; total: number }> {
  try {
    const res = await fetch(
      `${SERVER_URL}/replay/list?user=me&limit=${limit}&offset=${offset}`,
      { headers: await authHeaders() },
    )
    if (!res.ok) return { replays: [], total: 0 }
    return await res.json() as { replays: ReplayListItem[]; total: number }
  } catch {
    return { replays: [], total: 0 }
  }
}

/** Toggle a replay's `public` flag via `PATCH /replay/:id/share`. Player-only
 *  endpoint — server enforces. Returns the new public state on success or
 *  `null` on failure (network error or auth issue). */
export async function setReplayPublic(replayId: string, makePublic: boolean): Promise<boolean | null> {
  const res = await fetch(`${SERVER_URL}/replay/${replayId}/share`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify({ public: makePublic }),
  })
  if (!res.ok) return null
  const data = await res.json() as { ok: boolean; public: boolean }
  return data.public
}

export interface ReplayPayload {
  seed: number
  p1Deck: DeckEntry[]
  p2Deck: DeckEntry[]
  actions: GameAction[]
  winner: PlayerID | null
  turnCount: number
  shareForTraining: boolean
}

/** Save a completed game replay to the server. Fire-and-forget — errors suppressed. */
export async function saveReplay(replay: ReplayPayload): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/replay`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(replay),
    })
  } catch {
    // Non-critical — replay save failure should not surface to the user
  }
}

// =============================================================================
// MATCHMAKING — POST/GET/DELETE /matchmaking + Realtime pair-found channel.
// Server impl in dd04bb1; spec in docs/HANDOFF.md.
// =============================================================================

export type QueueKind = "casual" | "ranked"

export interface JoinMatchmakingParams {
  deck: DeckEntry[]
  cardMetadata?: Record<string, unknown>
  format: { family: GameFormatFamily; rotation: RotationId }
  matchFormat: "bo1" | "bo3"
  queueKind: QueueKind
}

/** Server response when a queue join either parks the user in the queue OR
 *  finds an immediate pair. The "paired" branch carries the new gameId so
 *  the client can navigate straight into the game without waiting on a
 *  Realtime broadcast. */
export type JoinMatchmakingResponse =
  | { status: "queued"; queueEntryId: string; eloSnapshot: number | null }
  | { status: "paired"; queueEntryId: string; gameId: string; opponentId: string; eloSnapshot: number | null }

/** GET /matchmaking response. Status is null when the user has no queue
 *  entry; otherwise the entry's full state including elapsed time + current
 *  ELO band (ranked only — null for casual or after band-widening reaches
 *  unbounded at 90s). */
export interface MatchmakingStatus {
  entryId: string
  format: { family: GameFormatFamily; rotation: RotationId }
  matchFormat: "bo1" | "bo3"
  queueKind: QueueKind
  joinedAt: string
  elapsedMs: number
  eloSnapshot: number | null
  currentBand: number | null
  pairedGameId: string | null
}

/** Errors the client should special-case (per server spec):
 *  - `ALREADY_QUEUED` (409)         — user has an active queue entry
 *  - `HOSTING_LOBBY` (409)          — user has a waiting lobby
 *  - `ACTIVE_GAME` (409)            — user is already in a game
 *  - `RATE_LIMITED` (429)           — >10 queue joins this hour
 *  - `RANKED_ROTATION_REQUIRED` (400) — picked rotation has ranked=false
 *  - `ROTATION_RETIRED` (400)        — rotation no longer offered for new decks
 *  - `ILLEGAL_DECK` (400)           — deck has cards not legal in chosen rotation
 *  Server also returns the full LegalityResult issues[] for ILLEGAL_DECK so
 *  the UI can surface specific cards.
 */
export interface MatchmakingError {
  status: number
  code: string
  message: string
  issues?: Array<{ definitionId?: string; fullName?: string; reason?: string; message?: string }>
}

export async function joinMatchmaking(params: JoinMatchmakingParams): Promise<JoinMatchmakingResponse> {
  const res = await fetch(`${SERVER_URL}/matchmaking`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string; code?: string; issues?: unknown[] }
    const err: MatchmakingError = {
      status: res.status,
      code: data.code ?? `HTTP_${res.status}`,
      message: data.error ?? `HTTP ${res.status}`,
    }
    if (Array.isArray(data.issues)) err.issues = data.issues as NonNullable<MatchmakingError["issues"]>
    throw err
  }
  return await res.json() as JoinMatchmakingResponse
}

export async function getMatchmakingStatus(): Promise<MatchmakingStatus | null> {
  const res = await fetch(`${SERVER_URL}/matchmaking`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { status: MatchmakingStatus | null }
  return data.status
}

export async function cancelMatchmaking(): Promise<{ ok: boolean; removed: boolean }> {
  const res = await fetch(`${SERVER_URL}/matchmaking`, {
    method: "DELETE",
    headers: await authHeaders(),
  })
  if (!res.ok) return { ok: false, removed: false }
  return await res.json() as { ok: boolean; removed: boolean }
}

/** Subscribe to the per-user matchmaking-results channel for pair-found
 *  events. Server broadcasts `pair_found` with payload { gameId, opponentId }
 *  when the user is paired into a game.
 *
 *  Returns an `async` unsubscribe function so callers can `await` the actual
 *  channel removal before doing follow-up work that creates a new channel
 *  (e.g., the game-channel subscription in `useGameSession`). Without that
 *  await, Supabase Realtime can reject the new channel's subscribe with
 *  CHANNEL_ERROR — symptom: red connection dot on the gameboard for the
 *  newly-paired client until refresh.
 *
 *  Use cases:
 *    - Pair-found handler: `await unsubscribe()` then navigate. (Critical.)
 *    - useEffect cleanup: `void unsubscribe()` is fine. Component unmount
 *      isn't followed by an immediate channel creation in the same paint.
 *
 *  Channel: `matchmaking:user:<userId>` (Supabase Realtime broadcast).
 *  This is the PRIMARY signal — DELETE on the matchmaking_queue row works
 *  as a fallback (REPLICA IDENTITY FULL is set on the table) but the
 *  broadcast is more direct. */
export function subscribeMatchmakingPairFound(
  userId: string,
  onPair: (payload: { gameId: string; opponentId: string }) => void,
): () => Promise<void> {
  const channel = supabase.channel(`matchmaking:user:${userId}`)
  channel.on("broadcast", { event: "pair_found" }, (msg) => {
    const payload = msg.payload as { gameId?: string; opponentId?: string } | undefined
    if (payload?.gameId && payload?.opponentId) {
      onPair({ gameId: payload.gameId, opponentId: payload.opponentId })
    }
  })
  channel.subscribe()
  return async () => {
    await supabase.removeChannel(channel)
  }
}
