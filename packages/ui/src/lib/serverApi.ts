import type { GameAction, GameState, DeckEntry } from "@lorcana-sim/engine"

const SERVER_URL = (import.meta.env["VITE_SERVER_URL"] as string | undefined) ?? "http://localhost:3001"

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string }
    return data.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

async function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

export async function getLobbyGame(token: string, lobbyId: string) {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}`, {
    headers: await authHeaders(token),
  })
  if (!res.ok) return null
  const data = await res.json() as { lobby: { status: string }; game: { id: string } | null }
  return data
}

export async function ensureProfile(token: string) {
  const res = await fetch(`${SERVER_URL}/auth/me`, {
    headers: await authHeaders(token),
  })
  if (!res.ok) throw new Error("Failed to initialize profile")
}

export async function createLobby(token: string, deck: DeckEntry[]) {
  const res = await fetch(`${SERVER_URL}/lobby/create`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify({ deck }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string; code: string }>
}

export async function joinLobby(token: string, code: string, deck: DeckEntry[]) {
  const res = await fetch(`${SERVER_URL}/lobby/join`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify({ code, deck }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string; gameId: string }>
}

export async function getGame(token: string, gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(token),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json() as { game: { state: GameState } }
  return data.game.state
}

export async function sendAction(token: string, gameId: string, action: GameAction) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/action`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ success: boolean; newState: GameState }>
}

export async function resignGame(token: string, gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/resign`, {
    method: "POST",
    headers: await authHeaders(token),
  })
  if (!res.ok) throw new Error(await extractError(res))
}
