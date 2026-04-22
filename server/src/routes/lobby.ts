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
  listLobbies,
  listPublicLobbies,
  type SpectatorPolicy,
} from "../services/lobbyService.js"
import { supabase } from "../db/client.js"

const SPECTATOR_POLICIES: readonly SpectatorPolicy[] = ["off", "invite_only", "friends", "public"]

/** Default rotation when the client doesn't send one. Matches schema default.
 *  Flip to "s12" on 2026-05-08 (Set 12 release) alongside the SQL column default. */
const DEFAULT_ROTATION: RotationId = "s11"

const lobby = new Hono<{ Variables: { userId: string } }>()

// POST /lobby/create
lobby.post("/create", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{
    deck: DeckEntry[]
    format?: string
    gameFormat?: string
    gameRotation?: string
    public?: boolean
    spectatorPolicy?: string
  }>()

  if (!Array.isArray(body.deck) || body.deck.length === 0) {
    return c.json({ error: "deck is required" }, 400)
  }

  const format = body.format === "bo3" ? "bo3" : "bo1"
  const family: GameFormatFamily = body.gameFormat === "core" ? "core" : "infinity"
  const rotation = (body.gameRotation ?? DEFAULT_ROTATION) as RotationId
  const gameFormat: GameFormat = { family, rotation }

  const isPublic = body.public === true
  const spectatorPolicy: SpectatorPolicy =
    body.spectatorPolicy && SPECTATOR_POLICIES.includes(body.spectatorPolicy as SpectatorPolicy)
      ? (body.spectatorPolicy as SpectatorPolicy)
      : "off"

  try {
    const result = await createLobby(userId, body.deck, format, gameFormat, {
      public: isPublic,
      spectatorPolicy,
    })
    return c.json({
      lobbyId: result.id,
      code: result.code,
      format,
      gameFormat: family,
      gameRotation: rotation,
      public: isPublic,
      spectatorPolicy,
    })
  } catch (err) {
    const e = err as Error & { issues?: unknown }
    if (e.message === "ILLEGAL_DECK") {
      return c.json({ error: "illegal deck for format", issues: e.issues ?? [] }, 400)
    }
    if (e.message?.startsWith("Unknown rotation")) {
      return c.json({ error: e.message }, 400)
    }
    return c.json({ error: String(err) }, 500)
  }
})

// POST /lobby/join
lobby.post("/join", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ code: string; deck: DeckEntry[] }>()

  if (!body.code) return c.json({ error: "code is required" }, 400)
  if (!Array.isArray(body.deck) || body.deck.length === 0) {
    return c.json({ error: "deck is required" }, 400)
  }

  try {
    const result = await joinLobby(userId, body.code, body.deck)
    return c.json({ lobbyId: result.lobbyId, gameId: result.gameId, myPlayerId: result.guestSide })
  } catch (err) {
    const e = err as Error & { issues?: unknown }
    if (e.message === "ILLEGAL_DECK") {
      return c.json({ error: "illegal deck for format", issues: e.issues ?? [] }, 400)
    }
    const msg = String(err)
    if (msg.includes("not found")) return c.json({ error: msg }, 404)
    if (msg.includes("own lobby")) return c.json({ error: msg }, 400)
    return c.json({ error: msg }, 500)
  }
})

// GET /lobby/list — the caller's own lobbies (hosting or joined)
lobby.get("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbies = await listLobbies(userId)
  return c.json({ lobbies })
})

// GET /lobby/public — browser of public waiting lobbies (MP UX Phase 1).
// Excludes caller's own lobbies; no deck fields in response (no scouting).
// MUST be registered before /:id so Hono's param route doesn't swallow "public".
lobby.get("/public", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbies = await listPublicLobbies(userId)
  return c.json({ lobbies })
})

// POST /lobby/:id/cancel — host cancels their waiting lobby (MP UX Phase 1).
// Only valid on status='waiting'. Sets status='cancelled'.
lobby.post("/:id/cancel", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbyId = c.req.param("id")!
  const result = await cancelLobby(userId, lobbyId)
  if (result.ok) return c.json({ ok: true })
  return c.json({ error: result.error }, result.status as 404 | 403 | 409 | 500)
})

// GET /lobby/:id — MUST be last so it doesn't shadow /public or fixed routes.
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
