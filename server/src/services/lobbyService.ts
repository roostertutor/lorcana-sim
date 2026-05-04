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
  /** Who can spectate when the game is active. Default "off". */
  spectatorPolicy?: SpectatorPolicy
}

/**
 * Create a new lobby in the duels-style middle-screen flow (2026-05-04).
 *
 * Decoupled from deck choice: the host commits to format + Bo only at create
 * time; deck and ready state fill in post-join via setDeckInLobby +
 * setReadyInLobby. Game spawns when both players are ready with decks
 * attached. See docs/HANDOFF.md → "duels-style middle-screen lobby
 * restructure" for the spec.
 *
 * Pre-cutover the host's deck was passed here and validated up-front; that
 * argument has been dropped. Validation now happens in setDeckInLobby
 * against the format stamped on the lobby row at create time.
 */
export async function createLobby(
  hostId: string,
  format: "bo1" | "bo3" = "bo1",
  gameFormat: GameFormat = { family: "infinity", rotation: "s12" },
  options: CreateLobbyOptions = {},
) {
  assertRotationExists(gameFormat)

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

  // Clean up any abandoned waiting lobbies for this user. Includes the new
  // 'lobby' transitional state (host left without finishing the deck pick).
  await supabase
    .from("lobbies")
    .update({ status: "finished", updated_at: new Date() })
    .eq("host_id", hostId)
    .in("status", ["waiting", "lobby"])

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
      // host_deck stays NULL on create — filled in via setDeckInLobby.
      // host_ready defaults FALSE; flips via setReadyInLobby after deck
      // is attached.
      format,
      game_format: gameFormat.family,
      game_rotation: gameFormat.rotation,
      // public flag dormant — UI dropped the public-browser surface in
      // commit f16f2a3 (Phase 0). Kept on the row for backwards compat with
      // any historical reads that still expect the column.
      public: false,
      spectator_policy: options.spectatorPolicy ?? "off",
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create lobby: ${error.message}`)
  return data as { id: string; code: string }
}

/**
 * Join an existing lobby by 6-char code. Marks the user as the guest and
 * flips status to 'lobby' (the new middle-screen transitional state). Does
 * NOT spawn a game — that happens in setReadyInLobby once both players are
 * ready with decks attached.
 *
 * Pre-cutover the guest's deck was passed here and the game spawned
 * synchronously; that argument has been dropped. Validation now happens
 * in setDeckInLobby against the format stamped on the lobby row.
 */
export async function joinLobby(
  guestId: string,
  code: string,
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

  // Set guest_id + flip status to 'lobby' (middle-screen transitional state).
  // 'lobby' replaces the old 'active' transition that fired at join time —
  // 'active' now only fires when the game actually spawns (in startGameIfReady).
  // Filter on status='waiting' as a race guard against two simultaneous joins.
  const { error: updateError } = await supabase
    .from("lobbies")
    .update({ guest_id: guestId, status: "lobby", updated_at: new Date() })
    .eq("id", lobby.id)
    .eq("status", "waiting")

  if (updateError) throw new Error(`Failed to join lobby: ${updateError.message}`)

  // Broadcast presence + state — UI's middle-screen subscription picks this up
  // immediately. Privacy-safe: never includes deck contents.
  await broadcastLobbyState(lobby.id as string)

  return { lobbyId: lobby.id as string }
}

/**
 * Resolve a 6-char code to a lobbyId — used by the /lobby/{code} share URL
 * to redirect to /game/{lobbyId} without joining. Doesn't mutate state;
 * doesn't validate caller-as-guest. Returns the lobby UUID + format hint
 * so the redirect target can render the correct middle-screen frame.
 *
 * Rejects on:
 *  - code not found (404)
 *  - lobby is finished/cancelled (410-ish; surface as not-found)
 *  - lobby is full and the caller isn't already in it (409 — has a guest)
 */
export async function resolveLobbyCode(
  callerId: string,
  code: string,
): Promise<
  | { ok: true; lobbyId: string }
  | { ok: false; status: 404 | 409; error: string }
> {
  const { data: lobby, error } = await supabase
    .from("lobbies")
    .select("id, host_id, guest_id, status")
    .eq("code", code.toUpperCase())
    .maybeSingle()

  if (error || !lobby) {
    return { ok: false, status: 404, error: "Lobby not found" }
  }
  if (lobby.status === "finished" || lobby.status === "cancelled") {
    return { ok: false, status: 404, error: `Lobby ${lobby.status}` }
  }
  // If the lobby already has a guest who isn't the caller AND the caller
  // isn't the host, it's full — block instead of silently letting them peek
  // (the middle-screen UI then shows them the wrong state).
  if (
    lobby.guest_id != null &&
    lobby.guest_id !== callerId &&
    lobby.host_id !== callerId
  ) {
    return { ok: false, status: 409, error: "Lobby is full" }
  }
  return { ok: true, lobbyId: lobby.id as string }
}

/** Public-facing lobby snapshot for the middle-screen mount call. Excludes
 *  deck contents (privacy — opponent sees only that you have a deck, not
 *  which one); the has-deck flags are derived server-side. */
export interface LobbyInfo {
  lobbyId: string
  code: string
  format: "bo1" | "bo3"
  gameFormat: GameFormatFamily
  gameRotation: RotationId
  hostId: string
  hostUsername: string | null
  guestId: string | null
  guestUsername: string | null
  hostHasDeck: boolean
  guestHasDeck: boolean
  hostReady: boolean
  guestReady: boolean
  status: "waiting" | "lobby" | "active" | "finished" | "cancelled"
  /** When status='active', the games row id for the spawned game. Null
   *  in the pre-spawn states. UI uses this to navigate from middle screen
   *  to the live game board. */
  gameId: string | null
}

/**
 * Peek at a lobby's middle-screen state. Caller must be the host or guest
 * (RLS enforces this for SELECT, but we double-gate at the route layer for
 * stranger access via lobby URL — strangers shouldn't even know whether a
 * lobby exists at that UUID).
 *
 * NEVER returns deck contents. The has-deck flags are the privacy-safe
 * alternative. Used by:
 *  - /game/{uuid} mount (middle screen reads format + presence + ready)
 *  - /lobby/{code} redirect path after resolveLobbyCode
 */
export async function getLobbyInfo(
  lobbyId: string,
): Promise<LobbyInfo | null> {
  const { data: lobby, error } = await supabase
    .from("lobbies")
    .select(
      "id, code, host_id, guest_id, host_deck, guest_deck, host_ready, guest_ready, format, game_format, game_rotation, status",
    )
    .eq("id", lobbyId)
    .maybeSingle()
  if (error || !lobby) return null

  // Pull the latest game on this lobby (if any) so the middle screen knows
  // when to navigate from waiting -> game board. Bo3 may have multiple; the
  // most recent game-number is the active one.
  let gameId: string | null = null
  if (lobby.status === "active") {
    const { data: g } = await supabase
      .from("games")
      .select("id")
      .eq("lobby_id", lobby.id as string)
      .order("game_number", { ascending: false })
      .limit(1)
      .maybeSingle()
    gameId = (g?.id as string | undefined) ?? null
  }

  // Resolve usernames in one round-trip — host always present, guest may
  // be null pre-join. Filter to non-null IDs so the IN list isn't empty.
  const ids = [lobby.host_id, lobby.guest_id].filter((v): v is string => Boolean(v))
  const { data: profiles } = ids.length > 0
    ? await supabase.from("profiles").select("id, username").in("id", ids)
    : { data: [] }
  const usernames = new Map((profiles ?? []).map((p) => [p.id as string, p.username as string]))

  return {
    lobbyId: lobby.id as string,
    code: lobby.code as string,
    format: ((lobby.format as string) ?? "bo1") as "bo1" | "bo3",
    gameFormat: ((lobby.game_format as string) ?? "infinity") as GameFormatFamily,
    gameRotation: ((lobby.game_rotation as string) ?? "s12") as RotationId,
    hostId: lobby.host_id as string,
    hostUsername: usernames.get(lobby.host_id as string) ?? null,
    guestId: (lobby.guest_id as string | null) ?? null,
    guestUsername: lobby.guest_id ? usernames.get(lobby.guest_id as string) ?? null : null,
    hostHasDeck: lobby.host_deck != null,
    guestHasDeck: lobby.guest_deck != null,
    hostReady: Boolean(lobby.host_ready),
    guestReady: Boolean(lobby.guest_ready),
    status: lobby.status as LobbyInfo["status"],
    gameId,
  }
}

/**
 * Attach (or swap) the caller's deck on this lobby. Validates the deck
 * against the lobby's stored format + rotation. Caller must be the host
 * or guest. Toggles host_ready/guest_ready BACK to false on swap (per
 * "you must explicitly re-ready after changing your deck") — server can't
 * trust that the player still wants to play with the new deck without an
 * explicit re-acknowledgment.
 *
 * Doesn't auto-flip ready or auto-start the game. setReadyInLobby is the
 * explicit gate.
 */
export async function setDeckInLobby(
  callerId: string,
  lobbyId: string,
  deck: DeckEntry[],
): Promise<
  | { ok: true; slot: "host" | "guest" }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; issues?: unknown }
> {
  if (!Array.isArray(deck) || deck.length === 0) {
    return { ok: false, status: 400, error: "deck is required" }
  }

  const { data: lobby, error: findErr } = await supabase
    .from("lobbies")
    .select("id, host_id, guest_id, status, game_format, game_rotation")
    .eq("id", lobbyId)
    .maybeSingle()
  if (findErr || !lobby) {
    return { ok: false, status: 404, error: "Lobby not found" }
  }
  if (lobby.status !== "waiting" && lobby.status !== "lobby") {
    return {
      ok: false,
      status: 409,
      error: `Cannot change deck once the game has started (lobby status="${lobby.status}")`,
    }
  }

  let slot: "host" | "guest"
  if (callerId === lobby.host_id) {
    slot = "host"
  } else if (callerId === lobby.guest_id) {
    slot = "guest"
  } else {
    return { ok: false, status: 403, error: "You are not in this lobby" }
  }

  const lobbyFormat: GameFormat = {
    family: lobby.game_format as GameFormatFamily,
    rotation: lobby.game_rotation as RotationId,
  }

  // Validate against the lobby's stamped format. Rejects with the engine's
  // structured issues list so the UI can render the per-card violations.
  try {
    assertRotationExists(lobbyFormat)
    assertDeckLegal(deck, lobbyFormat)
  } catch (err) {
    const e = err as Error & { issues?: unknown }
    if (e.message === "ILLEGAL_DECK") {
      return { ok: false, status: 400, error: "illegal deck for format", issues: e.issues ?? [] }
    }
    return { ok: false, status: 400, error: e.message }
  }

  // Atomic update of (deck, ready). Swapping the deck implicitly clears the
  // ready flag — the player has to explicitly re-acknowledge the new deck.
  // Same column-name pattern as today's host_deck/guest_deck JSONB.
  const update =
    slot === "host"
      ? { host_deck: deck, host_ready: false, updated_at: new Date() }
      : { guest_deck: deck, guest_ready: false, updated_at: new Date() }

  const { error: updErr } = await supabase
    .from("lobbies")
    .update(update)
    .eq("id", lobbyId)
  if (updErr) {
    return { ok: false, status: 400, error: `Failed to update lobby: ${updErr.message}` }
  }

  await broadcastLobbyState(lobbyId)
  return { ok: true, slot }
}

/**
 * Toggle the caller's ready flag. Server checks deck is attached first
 * (can't be ready without a deck). When both players are ready with decks
 * attached, this call atomically transitions the lobby to status='active'
 * and spawns the games row in the same transaction — UI sees one
 * Realtime broadcast carrying both transitions.
 *
 * Returns { gameStarted, gameId? }: gameStarted=true means the games row
 * was just created; the gameId is included for the caller to navigate to.
 * Both players see the gameStarted broadcast via the lobby:{lobbyId}
 * Realtime channel.
 */
export async function setReadyInLobby(
  callerId: string,
  lobbyId: string,
  ready: boolean,
): Promise<
  | { ok: true; gameStarted: boolean; gameId?: string }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }
> {
  const { data: lobby, error: findErr } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .maybeSingle()
  if (findErr || !lobby) {
    return { ok: false, status: 404, error: "Lobby not found" }
  }
  if (lobby.status !== "lobby" && lobby.status !== "waiting") {
    return {
      ok: false,
      status: 409,
      error: `Cannot toggle ready in lobby with status "${lobby.status}"`,
    }
  }

  const isHost = callerId === lobby.host_id
  const isGuest = callerId === lobby.guest_id
  if (!isHost && !isGuest) {
    return { ok: false, status: 403, error: "You are not in this lobby" }
  }

  // Can't ready up without a deck. Toggling ready=false is always allowed.
  if (ready) {
    const myDeck = isHost ? lobby.host_deck : lobby.guest_deck
    if (myDeck == null) {
      return { ok: false, status: 400, error: "Attach a deck before marking ready" }
    }
  }

  // Atomic update of the caller's ready flag, scoped to the current status
  // as a race guard against the parallel readiness flip + game-spawn path.
  const update = isHost
    ? { host_ready: ready, updated_at: new Date() }
    : { guest_ready: ready, updated_at: new Date() }
  const { error: updErr } = await supabase
    .from("lobbies")
    .update(update)
    .eq("id", lobbyId)
  if (updErr) {
    return { ok: false, status: 400, error: `Failed to update ready state: ${updErr.message}` }
  }

  // Re-read the lobby to evaluate the start condition with the just-applied
  // change. Avoids a stale-state read against the row we just wrote.
  const { data: fresh } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .maybeSingle()
  if (!fresh) {
    // Shouldn't happen — we just wrote a row that exists. Defensive.
    await broadcastLobbyState(lobbyId)
    return { ok: true, gameStarted: false }
  }

  const result = await startGameIfReady(fresh)
  await broadcastLobbyState(lobbyId)

  if (result.gameStarted && result.gameId) {
    return { ok: true, gameStarted: true, gameId: result.gameId }
  }
  return { ok: true, gameStarted: false }
}

/**
 * Internal: check if the lobby is ready to spawn the first game. Atomic
 * gate: if both players have decks AND both ready=true AND status is still
 * 'lobby', flip status to 'active' (race-guarded) and create the games row.
 *
 * Idempotent: a second concurrent caller observing the same fresh state
 * will lose the status='lobby' filter race (status is now 'active') and
 * return { gameStarted: false }. The other caller's path is the source
 * of truth.
 */
async function startGameIfReady(
  lobby: Record<string, unknown>,
): Promise<{ gameStarted: boolean; gameId?: string }> {
  const hostDeck = lobby.host_deck as DeckEntry[] | null
  const guestDeck = lobby.guest_deck as DeckEntry[] | null
  const hostReady = Boolean(lobby.host_ready)
  const guestReady = Boolean(lobby.guest_ready)
  if (!hostDeck || !guestDeck || !hostReady || !guestReady) {
    return { gameStarted: false }
  }
  if (lobby.status !== "lobby") {
    return { gameStarted: false }
  }

  // Race-guarded transition lobby → active. If a parallel caller already
  // flipped this row to 'active', the filter doesn't match and we exit
  // without spawning a duplicate game.
  const { data: claimed, error: claimErr } = await supabase
    .from("lobbies")
    .update({ status: "active", updated_at: new Date() })
    .eq("id", lobby.id as string)
    .eq("status", "lobby")
    .select("id")
  if (claimErr || !claimed || claimed.length === 0) {
    return { gameStarted: false }
  }

  // CRD 2.2.1 coin flip: randomize player1 slot. Same logic as pre-cutover
  // joinLobby — host vs guest; the engine's choose_play_order PendingChoice
  // (CRD 2.1.3.2) prompts player1 for the play-draw election.
  const hostId = lobby.host_id as string
  const guestId = lobby.guest_id as string
  const hostGoesFirst = Math.random() < 0.5
  const p1Id = hostGoesFirst ? hostId : guestId
  const p2Id = hostGoesFirst ? guestId : hostId
  const p1Deck = hostGoesFirst ? hostDeck : guestDeck
  const p2Deck = hostGoesFirst ? guestDeck : hostDeck

  const lobbyFormat: GameFormat = {
    family: (lobby.game_format as GameFormatFamily) ?? "infinity",
    rotation: (lobby.game_rotation as RotationId) ?? "s12",
  }

  const game = await createNewGame(
    lobby.id as string,
    p1Id,
    p2Id,
    p1Deck,
    p2Deck,
    1,
    {
      matchSource: "private",
      ranked: false, // Anti-collusion: private lobbies are unconditionally unranked.
      format: lobbyFormat,
    },
  )

  return { gameStarted: true, gameId: game.id }
}

/** Broadcast the current lobby state on the `lobby:{lobbyId}` Realtime
 *  channel so subscribed clients update their middle-screen UI. Privacy-
 *  safe payload — flags only, never deck contents.
 *
 *  Best-effort: a broadcast hiccup doesn't fail the underlying state
 *  transition. UI also has the `lobbies` postgres-changes UPDATE event
 *  as a fallback (REPLICA IDENTITY FULL) — but that fallback leaks
 *  host_deck / guest_deck JSONB. Clients should subscribe to the
 *  broadcast channel as the primary signal and ignore the postgres
 *  payload's deck columns. */
async function broadcastLobbyState(lobbyId: string): Promise<void> {
  try {
    const info = await getLobbyInfo(lobbyId)
    if (!info) return
    const channel = supabase.channel(`lobby:${lobbyId}`, {
      config: { broadcast: { ack: false } },
    })
    await new Promise<void>((resolve) => {
      const sub = channel.subscribe((status) => {
        if (
          status === "SUBSCRIBED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          resolve()
        }
      })
      // Safety timeout — don't block the API response on a flaky Realtime
      // connection. Same pattern as broadcastPairFound in matchmakingService.
      setTimeout(() => resolve(), 2000)
      void sub
    })
    await channel.send({
      type: "broadcast",
      event: "lobby_state",
      payload: info,
    })
    await channel.unsubscribe()
  } catch (err) {
    console.error("[lobby] broadcast failed:", err)
  }
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
    .in("status", ["waiting", "lobby", "active"])
    .order("created_at", { ascending: false })

  if (error) return []
  return data
}

/** Host or guest cancels a waiting/lobby-state lobby (MP UX Phase 1 — cancel
 *  button; duels-style middle-screen "Leave lobby" reuses this same op).
 *  Only valid on `status='waiting'` or `status='lobby'`; active games
 *  should use /game/:id/resign. 'cancelled' is distinct from 'finished' so
 *  the UI can show the right state.
 *
 *  Permission: either party (host OR guest). The lobby is a session for
 *  two specific people — if either leaves, the session ends. The opposing
 *  client picks up `status='cancelled'` via the broadcast at the bottom of
 *  this function and renders the "this lobby was cancelled" middle-screen
 *  state. */
export async function cancelLobby(
  userId: string,
  lobbyId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: lobby, error: findError } = await supabase
    .from("lobbies")
    .select("id, host_id, guest_id, status")
    .eq("id", lobbyId)
    .single()

  if (findError || !lobby) {
    return { ok: false, error: "Lobby not found", status: 404 }
  }
  if (lobby.host_id !== userId && lobby.guest_id !== userId) {
    return { ok: false, error: "Only the host or guest can cancel this lobby", status: 403 }
  }
  if (lobby.status !== "waiting" && lobby.status !== "lobby") {
    return {
      ok: false,
      error: `Cannot cancel a lobby with status "${lobby.status}". Only waiting/lobby lobbies can be cancelled.`,
      status: 409,
    }
  }

  const { error: updateError } = await supabase
    .from("lobbies")
    .update({ status: "cancelled", updated_at: new Date() })
    .eq("id", lobbyId)
    .in("status", ["waiting", "lobby"]) // guard against race with start

  if (updateError) {
    return { ok: false, error: `Failed to cancel lobby: ${updateError.message}`, status: 500 }
  }
  await broadcastLobbyState(lobbyId)
  return { ok: true }
}

/** Create a rematch lobby from a previously-finished lobby. Reuses both
 *  players' original decks (no deckbuilding roundtrip needed) and slots the
 *  loser of the previous match into the new game's `player1` position — the
 *  engine's `choose_play_order` PendingChoice (CRD 2.1.3.2) then surfaces
 *  the play-draw election to the loser as the first interaction, and the
 *  opponent sees the waiting variant of the modal.
 *
 *  Note re: middle-screen restructure (2026-05-04): rematch keeps the legacy
 *  "spawn game synchronously" flow because both decks are already attached
 *  from the previous lobby — no middle-screen step needed. New rematch
 *  lobbies are created with status='active' and host/guest_ready=true so
 *  the row is consistent with post-cutover invariants.
 *
 *  Design choice: one-shot. The first click creates both the lobby AND the
 *  first game; Realtime broadcasts the new gameId to both clients. The
 *  winner doesn't need to separately accept — they're navigated to the game
 *  and the engine shows them "opponent is choosing play order…" via the
 *  existing PendingChoiceModal.
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
  // host_ready/guest_ready=true so the row is consistent with the new
  // post-2026-05-04 invariant (active lobbies have both ready flags set).
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
      host_ready: true,
      guest_ready: true,
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
