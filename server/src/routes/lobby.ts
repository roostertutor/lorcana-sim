import { Hono } from "hono"
import type {
  DeckEntry,
  GameFormat,
  GameFormatFamily,
  RotationId,
} from "@lorcana-sim/engine"
import { requireAuth } from "../middleware/auth.js"
import {
  cancelLobby,
  createLobby,
  joinLobby,
  getLobby,
  getLobbyInfo,
  listLobbies,
  rematchLobby,
  resolveLobbyCode,
  setDeckInLobby,
  setReadyInLobby,
  type SpectatorPolicy,
} from "../services/lobbyService.js"
import { supabase } from "../db/client.js"

const SPECTATOR_POLICIES: readonly SpectatorPolicy[] = ["off", "invite_only", "friends", "public"]

/** Default rotation when the client doesn't send one. Matches schema default.
 *  Flipped to "s12" on 2026-05-08 (Set 12 release) alongside the SQL column default. */
const DEFAULT_ROTATION: RotationId = "s12"

const lobby = new Hono<{ Variables: { userId: string } }>()

// POST /lobby/create — duels-style middle-screen flow (2026-05-04).
// Pre-cutover this took a `deck` arg and validated up-front; the new flow
// commits format only at create time, deck attaches via /lobby/:id/deck
// after the guest joins.
lobby.post("/create", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{
    format?: string
    gameFormat?: string
    gameRotation?: string
    spectatorPolicy?: string
  }>()

  const format = body.format === "bo3" ? "bo3" : "bo1"
  const family: GameFormatFamily = body.gameFormat === "core" ? "core" : "infinity"
  const rotation = (body.gameRotation ?? DEFAULT_ROTATION) as RotationId
  const gameFormat: GameFormat = { family, rotation }

  const spectatorPolicy: SpectatorPolicy =
    body.spectatorPolicy && SPECTATOR_POLICIES.includes(body.spectatorPolicy as SpectatorPolicy)
      ? (body.spectatorPolicy as SpectatorPolicy)
      : "off"

  try {
    const result = await createLobby(userId, format, gameFormat, { spectatorPolicy })
    return c.json({
      lobbyId: result.id,
      code: result.code,
      format,
      gameFormat: family,
      gameRotation: rotation,
      spectatorPolicy,
    })
  } catch (err) {
    const e = err as Error & { issues?: unknown }
    if (e.message?.startsWith("Unknown rotation")) {
      return c.json({ error: e.message }, 400)
    }
    if (e.message?.startsWith("QUEUED_ELSEWHERE")) {
      return c.json({ error: e.message.replace(/^QUEUED_ELSEWHERE: ?/, "") }, 409)
    }
    return c.json({ error: String(err) }, 500)
  }
})

// POST /lobby/join — guest joins by 6-char code. Pre-cutover this also
// took a deck arg + spawned the game synchronously; new flow flips status
// to 'lobby' (middle-screen state) and waits for both players to ready up
// via /lobby/:id/ready.
lobby.post("/join", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ code: string }>()

  if (!body.code) return c.json({ error: "code is required" }, 400)

  try {
    const result = await joinLobby(userId, body.code)
    return c.json({ lobbyId: result.lobbyId })
  } catch (err) {
    const e = err as Error & { issues?: unknown }
    if (e.message?.startsWith("QUEUED_ELSEWHERE")) {
      return c.json({ error: e.message.replace(/^QUEUED_ELSEWHERE: ?/, "") }, 409)
    }
    const msg = String(err)
    if (msg.includes("not found")) return c.json({ error: msg }, 404)
    if (msg.includes("own lobby")) return c.json({ error: msg }, 400)
    return c.json({ error: msg }, 500)
  }
})

// GET /lobby/resolve/:code — look up the gameId (lobby UUID) for a 6-char
// code without joining. Used by the /lobby/:code share-link redirect path
// to navigate to /game/{lobbyId} where the middle screen renders. Doesn't
// mutate state, doesn't require the caller to be the host or guest yet.
//
// MUST be registered before /:id so Hono's param route doesn't swallow "resolve".
lobby.get("/resolve/:code", requireAuth, async (c) => {
  const userId = c.get("userId")
  const code = c.req.param("code")!
  const result = await resolveLobbyCode(userId, code)
  if (result.ok) return c.json({ lobbyId: result.lobbyId })
  return c.json({ error: result.error }, result.status)
})

// POST /lobby/rematch — create a rematch lobby from a just-finished match
// (MP UX Phase 2). Idempotent: two players clicking "Rematch" simultaneously
// converge on the same new lobby. Spawns the first game of the rematch with
// the previous-match loser in the player1 slot (CRD 2.1.3.2 play-draw).
lobby.post("/rematch", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ previousLobbyId: string }>().catch(() => ({} as { previousLobbyId?: string }))

  if (!body.previousLobbyId || typeof body.previousLobbyId !== "string") {
    return c.json({ error: "previousLobbyId is required" }, 400)
  }

  try {
    const result = await rematchLobby(userId, body.previousLobbyId)
    return c.json({
      lobbyId: result.lobbyId,
      gameId: result.gameId,
      code: result.code,
      myPlayerId: result.myPlayerId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("not found")) return c.json({ error: msg }, 404)
    if (msg.includes("Only players")) return c.json({ error: msg }, 403)
    if (msg.includes("status") || msg.includes("no recorded winner") || msg.includes("active game")) {
      return c.json({ error: msg }, 409)
    }
    return c.json({ error: msg }, 500)
  }
})

// GET /lobby/list — the caller's own lobbies (hosting or joined)
lobby.get("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbies = await listLobbies(userId)
  return c.json({ lobbies })
})

// POST /lobby/:id/cancel — host cancels their waiting/lobby-state lobby.
// Only valid on status='waiting' or 'lobby'. Sets status='cancelled'.
lobby.post("/:id/cancel", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbyId = c.req.param("id")!
  const result = await cancelLobby(userId, lobbyId)
  if (result.ok) return c.json({ ok: true })
  return c.json({ error: result.error }, result.status as 404 | 403 | 409 | 500)
})

// POST /lobby/:id/deck — attach (or swap) the caller's deck. Validates
// against the lobby's stamped format. Caller must be host or guest. Resets
// caller's ready flag to false (deck swap implicitly un-readies; the player
// re-acknowledges via /lobby/:id/ready).
lobby.post("/:id/deck", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbyId = c.req.param("id")!
  const body = await c.req.json<{ deck: DeckEntry[] }>().catch(() => ({} as { deck?: DeckEntry[] }))
  if (!body.deck) {
    return c.json({ error: "deck is required" }, 400)
  }
  const result = await setDeckInLobby(userId, lobbyId, body.deck)
  if (result.ok) return c.json({ ok: true, slot: result.slot })
  if ("issues" in result) {
    return c.json({ error: result.error, issues: result.issues ?? [] }, result.status)
  }
  return c.json({ error: result.error }, result.status)
})

// POST /lobby/:id/ready — toggle the caller's ready flag. When both players
// are ready with decks attached, server atomically transitions to status='active'
// + spawns the games row in the same call. The acting player gets gameId on
// the response; the opponent observes via the lobby:{id} broadcast channel
// (and the postgres-changes UPDATE event as fallback).
lobby.post("/:id/ready", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbyId = c.req.param("id")!
  const body = await c.req.json<{ ready: boolean }>().catch(() => ({} as { ready?: boolean }))
  if (typeof body.ready !== "boolean") {
    return c.json({ error: "ready (boolean) is required" }, 400)
  }
  const result = await setReadyInLobby(userId, lobbyId, body.ready)
  if (result.ok) {
    return c.json({
      ok: true,
      gameStarted: result.gameStarted,
      ...(result.gameId ? { gameId: result.gameId } : {}),
    })
  }
  return c.json({ error: result.error }, result.status)
})

// GET /lobby/:id/info — privacy-safe middle-screen snapshot. Returns format,
// presence + ready flags, has-deck booleans, and (when game has started)
// the spawned gameId. NEVER returns deck contents. Caller must be the host
// or guest. Used by the middle-screen mount call and the /lobby/:code
// redirect path.
lobby.get("/:id/info", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbyId = c.req.param("id")!
  const info = await getLobbyInfo(lobbyId)
  if (!info) return c.json({ error: "Lobby not found" }, 404)
  if (info.hostId !== userId && info.guestId !== userId) {
    return c.json({ error: "You are not in this lobby" }, 403)
  }
  return c.json({ lobby: info })
})

// GET /lobby/:id — MUST be last so it doesn't shadow /resolve, /:id/info, or
// other fixed routes. Pre-cutover this returned the raw lobby row (incl.
// host_deck/guest_deck). UI consumers should migrate to /:id/info — kept
// for backwards compat with existing callers; RLS still gates deck columns
// to the host+guest, but the /info endpoint is the privacy-safer surface.
lobby.get("/:id", requireAuth, async (c) => {
  const lobbyData = await getLobby(c.req.param("id")!)
  if (!lobbyData) return c.json({ error: "Lobby not found" }, 404)

  // Attach the latest game for this lobby (Bo3 may have multiple)
  let game = null
  let hostSide: "player1" | "player2" = "player1"
  if (lobbyData.status === "active") {
    const { data } = await supabase
      .from("games")
      .select("id, status, game_number, player1_id, player2_id")
      .eq("lobby_id", lobbyData.id)
      .order("game_number", { ascending: false })
      .limit(1)
      .single()
    game = data
    if (data) {
      hostSide = data.player1_id === lobbyData.host_id ? "player1" : "player2"
    }
  }

  return c.json({ lobby: lobbyData, game, hostSide })
})

export { lobby }
