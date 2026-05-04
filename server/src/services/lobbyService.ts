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

/** Concurrency invariant — a user cannot host a lobby while in a matchmaking
 *  queue. Queue side enforces the mirror in matchmakingService.joinQueue.
 *  See docs/HANDOFF.md → "Concurrency invariant" for the full rationale. */
async function checkForQueueEntry(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("matchmaking_queue")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
  return Boolean(data && data.length > 0)
}

/** Spectator policy governs who can watch an active game from this lobby.
 *  Phase 1 stores the chosen value; Phase 7 consumes it in stateFilter. */
export type SpectatorPolicy = "off" | "invite_only" | "friends" | "public"

export interface CreateLobbyOptions {
  /** Surface this lobby in GET /lobby/public. Default false (private via code). */
  public?: boolean
  /** Who can spectate when the game is active. Default "off". */
  spectatorPolicy?: SpectatorPolicy
}

export async function createLobby(
  hostId: string,
  hostDeck: DeckEntry[],
  format: "bo1" | "bo3" = "bo1",
  gameFormat: GameFormat = { family: "infinity", rotation: "s12" },
  options: CreateLobbyOptions = {},
) {
  assertRotationExists(gameFormat)
  assertDeckLegal(hostDeck, gameFormat)

  const activeGameId = await checkForActiveGame(hostId)
  if (activeGameId) {
    throw new Error(`You already have an active game (${activeGameId}). Finish or resign it first.`)
  }

  // Concurrency invariant — block lobby create when the user is queued.
  // Tagged with QUEUED_ELSEWHERE so the route layer surfaces a 409 (matches
  // the matchmaking-side mirror that rejects queue join during a waiting lobby).
  if (await checkForQueueEntry(hostId)) {
    throw new Error("QUEUED_ELSEWHERE: cancel your matchmaking queue entry before creating a lobby")
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
      public: options.public ?? false,
      spectator_policy: options.spectatorPolicy ?? "off",
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
  if (await checkForQueueEntry(guestId)) {
    throw new Error("QUEUED_ELSEWHERE: cancel your matchmaking queue entry before joining a lobby")
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

  // CRD 2.2.1 coin flip: randomize which user lands in the player1 slot.
  // Engine prompts player1 for the play-draw election via choose_play_order
  // (CRD 2.1.3.2), so slotting the coin-flip winner into player1 routes the
  // election to the right user without any extra plumbing.
  const hostId = lobby.host_id as string
  const hostDeck = lobby.host_deck as DeckEntry[]
  const hostGoesFirst = Math.random() < 0.5
  const p1Id = hostGoesFirst ? hostId : guestId
  const p2Id = hostGoesFirst ? guestId : hostId
  const p1Deck = hostGoesFirst ? hostDeck : guestDeck
  const p2Deck = hostGoesFirst ? guestDeck : hostDeck

  // Pass the lobby's format so createNewGame runs the authoritative
  // server-side legality check before inserting the games row. Defensive —
  // both decks were validated at create/join time, but this is the last
  // line of defense against any race where a deck was edited or the
  // rotation registry shifted between checks.
  const game = await createNewGame(lobby.id, p1Id, p2Id, p1Deck, p2Deck, 1, {
    matchSource: "private",
    ranked: false, // Anti-collusion: private lobbies are unconditionally unranked.
    format: lobbyFormat,
  })

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

/** Host cancels their own waiting lobby (MP UX Phase 1 — cancel button).
 *  Only valid on `status='waiting'`; active games should use /game/:id/resign.
 *  'cancelled' is distinct from 'finished' so the UI can show the right state. */
export async function cancelLobby(
  userId: string,
  lobbyId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: lobby, error: findError } = await supabase
    .from("lobbies")
    .select("id, host_id, status")
    .eq("id", lobbyId)
    .single()

  if (findError || !lobby) {
    return { ok: false, error: "Lobby not found", status: 404 }
  }
  if (lobby.host_id !== userId) {
    return { ok: false, error: "Only the host can cancel this lobby", status: 403 }
  }
  if (lobby.status !== "waiting") {
    return {
      ok: false,
      error: `Cannot cancel a lobby with status "${lobby.status}". Only waiting lobbies can be cancelled.`,
      status: 409,
    }
  }

  const { error: updateError } = await supabase
    .from("lobbies")
    .update({ status: "cancelled", updated_at: new Date() })
    .eq("id", lobbyId)
    .eq("status", "waiting") // guard against race with join

  if (updateError) {
    return { ok: false, error: `Failed to cancel lobby: ${updateError.message}`, status: 500 }
  }
  return { ok: true }
}

/** Create a rematch lobby from a previously-finished lobby. Reuses both
 *  players' original decks (no deckbuilding roundtrip needed) and slots the
 *  loser of the previous match into the new game's `player1` position — the
 *  engine's `choose_play_order` PendingChoice (CRD 2.1.3.2) then surfaces
 *  the play-draw election to the loser as the first interaction, and the
 *  opponent sees the waiting variant of the modal.
 *
 *  Design choice: one-shot. The first click creates both the lobby AND the
 *  first game; Realtime broadcasts the new gameId to both clients. The
 *  winner doesn't need to separately accept — they're navigated to the game
 *  and the engine shows them "opponent is choosing play order…" via the
 *  existing PendingChoiceModal. A future iteration could add an explicit
 *  accept step with `status='waiting_rematch'` if the UX calls for it, but
 *  the one-shot flow matches Bo3 continuation semantics exactly.
 *
 *  Constraints:
 *  - Caller must have been one of the two players in the previous lobby
 *  - Previous lobby must be status='finished' (match actually ended)
 *  - The caller must not already have an active game (same guard as
 *    `joinLobby`) — one MP match at a time per user
 *  - Idempotent via previousLobbyId → rematch_of uniqueness: if a rematch
 *    lobby already exists for this previous lobby, return its id instead
 *    of creating a duplicate
 */
export async function rematchLobby(
  userId: string,
  previousLobbyId: string,
): Promise<{ lobbyId: string; gameId: string; code: string; myPlayerId: "player1" | "player2" }> {
  // Guard: caller must not already be in another active match.
  const activeGameId = await checkForActiveGame(userId)
  if (activeGameId) {
    throw new Error(`You already have an active game (${activeGameId}). Finish or resign it first.`)
  }

  const { data: prev, error: prevErr } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", previousLobbyId)
    .single()

  if (prevErr || !prev) throw new Error("Previous lobby not found")
  if (prev.status !== "finished") {
    throw new Error(`Previous lobby has status "${prev.status}"; only finished lobbies can be rematched`)
  }

  const hostId = prev.host_id as string
  const guestId = prev.guest_id as string
  if (userId !== hostId && userId !== guestId) {
    throw new Error("Only players from the previous lobby can initiate a rematch")
  }
  if (!guestId) {
    throw new Error("Previous lobby never had a guest — nothing to rematch")
  }

  // Idempotency: if a rematch lobby already exists for this previousLobbyId,
  // return it instead of creating another. Race: two players clicking
  // "Rematch" at the same time should converge on one lobby.
  const { data: existing } = await supabase
    .from("lobbies")
    .select("id")
    .eq("rematch_of", previousLobbyId)
    .maybeSingle()
  if (existing?.id) {
    // Look up the (single) game for that rematch lobby and return both ids.
    const { data: game } = await supabase
      .from("games")
      .select("id, player1_id")
      .eq("lobby_id", existing.id as string)
      .order("game_number", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (game?.id) {
      const myPlayerId = game.player1_id === userId ? "player1" : "player2"
      const { data: row } = await supabase
        .from("lobbies")
        .select("code")
        .eq("id", existing.id as string)
        .single()
      return {
        lobbyId: existing.id as string,
        gameId: game.id as string,
        code: (row?.code as string) ?? "",
        myPlayerId,
      }
    }
  }

  // Determine the loser. The last finished game on the previous lobby has
  // winner_id; loser is the other player.
  const { data: lastGame } = await supabase
    .from("games")
    .select("winner_id")
    .eq("lobby_id", previousLobbyId)
    .eq("status", "finished")
    .order("game_number", { ascending: false })
    .limit(1)
    .single()

  if (!lastGame?.winner_id) {
    throw new Error("Previous match has no recorded winner — cannot assign play-draw for rematch")
  }

  const loserId = lastGame.winner_id === hostId ? guestId : hostId
  const opponentId = lastGame.winner_id as string

  // Pair each user with their correct deck (lobby stores decks keyed by
  // host_id / guest_id, not by slot).
  const hostDeck = prev.host_deck as DeckEntry[]
  const guestDeck = prev.guest_deck as DeckEntry[]
  const loserIsHost = loserId === hostId
  const loserDeck = loserIsHost ? hostDeck : guestDeck
  const opponentDeck = loserIsHost ? guestDeck : hostDeck

  // Generate a unique code for the new rematch lobby. Same probe-retry
  // pattern as createLobby.
  let code = generateCode()
  let attempts = 0
  while (attempts < 5) {
    const { data: dup } = await supabase
      .from("lobbies")
      .select("id")
      .eq("code", code)
      .maybeSingle()
    if (!dup) break
    code = generateCode()
    attempts++
  }

  // Create the rematch lobby. Host in the new lobby is the CALLER (whoever
  // clicked Rematch first), guest is the other player — same as original
  // lobby semantics. Decks preserved from the previous lobby so the format
  // legality rules don't need re-validation (decks were legal then, still
  // legal now unless rotation changed mid-match, which we don't handle).
  const newHostId = userId
  const newGuestId = userId === hostId ? guestId : hostId
  const newHostDeck = userId === hostId ? hostDeck : guestDeck
  const newGuestDeck = userId === hostId ? guestDeck : hostDeck

  const { data: newLobby, error: newErr } = await supabase
    .from("lobbies")
    .insert({
      code,
      host_id: newHostId,
      host_deck: newHostDeck,
      guest_id: newGuestId,
      guest_deck: newGuestDeck,
      format: prev.format,
      game_format: prev.game_format,
      game_rotation: prev.game_rotation,
      public: false,            // rematches stay private
      spectator_policy: prev.spectator_policy ?? "off",
      status: "active",          // game spawns immediately below
      rematch_of: previousLobbyId,
    })
    .select()
    .single()

  if (newErr || !newLobby) {
    throw new Error(`Failed to create rematch lobby: ${newErr?.message ?? "unknown error"}`)
  }

  // Spawn the first game of the rematch, loser in player1 slot. Pass the
  // lobby format so createNewGame runs the authoritative legality check.
  const rematchFormat: GameFormat = {
    family: prev.game_format as GameFormatFamily,
    rotation: prev.game_rotation as RotationId,
  }
  const game = await createNewGame(
    newLobby.id as string,
    loserId,
    opponentId,
    loserDeck,
    opponentDeck,
    1,
    {
      matchSource: "private",
      ranked: false, // Anti-collusion: private lobbies are unconditionally unranked.
      format: rematchFormat,
    },
  )

  const myPlayerId: "player1" | "player2" = loserId === userId ? "player1" : "player2"
  return {
    lobbyId: newLobby.id as string,
    gameId: game.id,
    code: newLobby.code as string,
    myPlayerId,
  }
}

/** Shape returned by GET /lobby/public — deliberately minimal so no deck
 *  contents leak (no scouting vector). Host's username + format metadata only. */
export interface PublicLobbyRow {
  id: string
  code: string
  hostUsername: string
  format: "bo1" | "bo3"
  gameFormat: GameFormatFamily
  gameRotation: RotationId
  spectatorPolicy: SpectatorPolicy
  createdAt: string
}

/** List public waiting lobbies for the browser. Excludes the caller's own
 *  lobbies (they'd see them in `listLobbies` instead). No deck fields in the
 *  response — joiners see format+host, never deck composition. */
export async function listPublicLobbies(userId: string): Promise<PublicLobbyRow[]> {
  const { data, error } = await supabase
    .from("lobbies")
    .select(
      "id, code, host_id, format, game_format, game_rotation, spectator_policy, created_at, profiles!host_id(username)",
    )
    .eq("status", "waiting")
    .eq("public", true)
    .neq("host_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error || !data) return []

  return data.map((row) => {
    // The `profiles!host_id(username)` join returns either a single object or
    // an array depending on Supabase version — normalize to object.
    const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      id: row.id as string,
      code: row.code as string,
      hostUsername: (prof?.username as string) ?? "Unknown",
      format: row.format as "bo1" | "bo3",
      gameFormat: row.game_format as GameFormatFamily,
      gameRotation: row.game_rotation as RotationId,
      spectatorPolicy: row.spectator_policy as SpectatorPolicy,
      createdAt: row.created_at as string,
    }
  })
}
