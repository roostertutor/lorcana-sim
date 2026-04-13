import type { GameAction, GameState, DeckEntry, PlayerID } from "@lorcana-sim/engine"
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
  const data = await res.json() as { lobby: { status: string }; game: { id: string } | null }
  return data
}

export async function ensureProfile() {
  const res = await fetch(`${SERVER_URL}/auth/me`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error("Failed to initialize profile")
}

export async function createLobby(deck: DeckEntry[], format: "bo1" | "bo3" = "bo1", gameFormat: "core" | "infinity" = "infinity") {
  const res = await fetch(`${SERVER_URL}/lobby/create`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ deck, format, gameFormat }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string; code: string; format: string; gameFormat: string }>
}

export async function joinLobby(code: string, deck: DeckEntry[]) {
  const res = await fetch(`${SERVER_URL}/lobby/join`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ code, deck }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string; gameId: string }>
}

export async function getGame(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json() as { game: { state: GameState } }
  return data.game.state
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

export interface EloRatings {
  bo1_core: number
  bo1_infinity: number
  bo3_core: number
  bo3_infinity: number
}

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
