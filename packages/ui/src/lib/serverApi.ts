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
