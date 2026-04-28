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
  gameRotation: RotationId = "s11",
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
  const data = await res.json() as { game: { state: GameState; status?: string }; playerSide: "player1" | "player2" }
  return { state: data.game.state, playerSide: data.playerSide, status: data.game.status }
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
  games_played: number
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

export async function getGameReplay(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/replay`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { replay: { seed: number; p1Deck: DeckEntry[]; p2Deck: DeckEntry[]; actions: GameAction[]; winner: string | null; turnCount: number } }
  return data.replay
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
 *  when the user is paired into a game. Returns an unsubscribe function.
 *
 *  Channel: `matchmaking:user:<userId>` (Supabase Realtime broadcast).
 *  This is the PRIMARY signal — DELETE on the matchmaking_queue row works
 *  as a fallback (REPLICA IDENTITY FULL is set on the table) but the
 *  broadcast is more direct. */
export function subscribeMatchmakingPairFound(
  userId: string,
  onPair: (payload: { gameId: string; opponentId: string }) => void,
): () => void {
  const channel = supabase.channel(`matchmaking:user:${userId}`)
  channel.on("broadcast", { event: "pair_found" }, (msg) => {
    const payload = msg.payload as { gameId?: string; opponentId?: string } | undefined
    if (payload?.gameId && payload?.opponentId) {
      onPair({ gameId: payload.gameId, opponentId: payload.opponentId })
    }
  })
  channel.subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
