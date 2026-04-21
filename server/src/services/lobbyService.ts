import {
  CARD_DEFINITIONS,
  CORE_ROTATIONS,
  INFINITY_ROTATIONS,
  isLegalFor,
  type DeckEntry,
  type GameFormat,
  type GameFormatFamily,
  type RotationId,
} from "@lorcana-sim/engine"
import { supabase } from "../db/client.js"
import { createNewGame } from "./gameService.js"

/** Validate that a rotation id exists in the registry for the given family.
 *  Rejects typos / forgotten entries at the API boundary. */
function assertRotationExists(format: GameFormat): void {
  const registry = format.family === "core" ? CORE_ROTATIONS : INFINITY_ROTATIONS
  if (!registry[format.rotation]) {
    throw new Error(
      `Unknown rotation "${format.rotation}" in ${format.family}. ` +
        `Known: ${Object.keys(registry).join(", ")}.`,
    )
  }
}

/** Run legality against the engine's rotation registry. Throws a tagged error
 *  that lobby.ts knows how to surface as a 400 with the issues list. */
function assertDeckLegal(deck: DeckEntry[], format: GameFormat): void {
  const result = isLegalFor(deck, CARD_DEFINITIONS, format)
  if (!result.ok) {
    const err = new Error("ILLEGAL_DECK") as Error & { issues?: unknown }
    err.issues = result.issues
    throw err
  }
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

/** Check if a user already has an active game or is hosting a waiting lobby. */
async function checkForActiveGame(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("games")
    .select("id")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq("status", "active")
    .limit(1)

  if (data && data.length > 0) return data[0]!.id as string

  // Also check for waiting lobbies they're hosting
  const { data: lobbies } = await supabase
    .from("lobbies")
    .select("id")
    .eq("host_id", userId)
    .eq("status", "waiting")
    .limit(1)

  if (lobbies && lobbies.length > 0) return null // waiting lobby is fine to abandon

  return null
}

export async function createLobby(
  hostId: string,
  hostDeck: DeckEntry[],
  format: "bo1" | "bo3" = "bo1",
  gameFormat: GameFormat = { family: "infinity", rotation: "s11" },
) {
  assertRotationExists(gameFormat)
  assertDeckLegal(hostDeck, gameFormat)

  const activeGameId = await checkForActiveGame(hostId)
  if (activeGameId) {
    throw new Error(`You already have an active game (${activeGameId}). Finish or resign it first.`)
  }

  // Clean up any abandoned waiting lobbies for this user
  await supabase
    .from("lobbies")
    .update({ status: "finished", updated_at: new Date() })
    .eq("host_id", hostId)
    .eq("status", "waiting")

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
    .insert({
      code,
      host_id: hostId,
      host_deck: hostDeck,
      format,
      game_format: gameFormat.family,
      game_rotation: gameFormat.rotation,
    })
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
  const activeGameId = await checkForActiveGame(guestId)
  if (activeGameId) {
    throw new Error(`You already have an active game (${activeGameId}). Finish or resign it first.`)
  }

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

  // Validate guest deck against the format stamped on the lobby at create time.
  // Host's deck was validated in createLobby; re-validating here prevents a guest
  // bypassing legality by editing their deck after the lobby was made.
  const lobbyFormat: GameFormat = {
    family: lobby.game_format as GameFormatFamily,
    rotation: lobby.game_rotation as RotationId,
  }
  assertRotationExists(lobbyFormat)
  assertDeckLegal(guestDeck, lobbyFormat)

  // Update lobby to active with guest + store guest deck for Bo3 rematches
  const { error: updateError } = await supabase
    .from("lobbies")
    .update({ guest_id: guestId, guest_deck: guestDeck, status: "active", updated_at: new Date() })
    .eq("id", lobby.id)

  if (updateError) throw new Error(`Failed to join lobby: ${updateError.message}`)

  // Create the game (player order randomized inside createNewGame)
  const game = await createNewGame(
    lobby.id,
    lobby.host_id as string,
    guestId,
    lobby.host_deck as DeckEntry[],
    guestDeck,
  )

  // Look up which side the guest got (randomized)
  const { data: gameRow } = await supabase
    .from("games")
    .select("player1_id, player2_id")
    .eq("id", game.id)
    .single()

  const guestSide = gameRow?.player1_id === guestId ? "player1" : "player2"
  const hostSide = guestSide === "player1" ? "player2" : "player1"

  return { lobbyId: lobby.id as string, gameId: game.id as string, guestSide, hostSide }
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
