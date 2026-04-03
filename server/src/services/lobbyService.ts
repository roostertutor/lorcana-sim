import type { DeckEntry } from "@lorcana-sim/engine"
import { supabase } from "../db/client.js"
import { createNewGame } from "./gameService.js"

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function createLobby(hostId: string, hostDeck: DeckEntry[]) {
  // Generate a unique 6-char code
  let code = generateCode()
  let attempts = 0
  while (attempts < 5) {
    const { data } = await supabase
      .from("lobbies")
      .select("id")
      .eq("code", code)
      .single()
    if (!data) break
    code = generateCode()
    attempts++
  }

  const { data, error } = await supabase
    .from("lobbies")
    .insert({ code, host_id: hostId, host_deck: hostDeck })
    .select()
    .single()

  if (error) throw new Error(`Failed to create lobby: ${error.message}`)
  return data as { id: string; code: string }
}

export async function joinLobby(
  guestId: string,
  code: string,
  guestDeck: DeckEntry[],
) {
  const { data: lobby, error: findError } = await supabase
    .from("lobbies")
    .select("*")
    .eq("code", code.toUpperCase())
    .eq("status", "waiting")
    .single()

  if (findError || !lobby) {
    throw new Error("Lobby not found or already started")
  }

  if (lobby.host_id === guestId) {
    throw new Error("Cannot join your own lobby")
  }

  // Update lobby to active with guest
  const { error: updateError } = await supabase
    .from("lobbies")
    .update({ guest_id: guestId, status: "active", updated_at: new Date() })
    .eq("id", lobby.id)

  if (updateError) throw new Error(`Failed to join lobby: ${updateError.message}`)

  // Create the game
  const game = await createNewGame(
    lobby.id,
    lobby.host_id as string,
    guestId,
    lobby.host_deck as DeckEntry[],
    guestDeck,
  )

  return { lobbyId: lobby.id as string, gameId: game.id as string }
}

export async function getLobby(lobbyId: string) {
  const { data, error } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .single()

  if (error) return null
  return data
}

export async function listLobbies(userId: string) {
  const { data, error } = await supabase
    .from("lobbies")
    .select("*")
    .or(`host_id.eq.${userId},guest_id.eq.${userId}`)
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })

  if (error) return []
  return data
}
