import { Hono } from "hono"
import type { DeckEntry } from "@lorcana-sim/engine"
import { requireAuth } from "../middleware/auth.js"
import {
  createLobby,
  joinLobby,
  getLobby,
  listLobbies,
} from "../services/lobbyService.js"
import { supabase } from "../db/client.js"

const lobby = new Hono<{ Variables: { userId: string } }>()

// POST /lobby/create
lobby.post("/create", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ deck: DeckEntry[] }>()

  if (!Array.isArray(body.deck) || body.deck.length === 0) {
    return c.json({ error: "deck is required" }, 400)
  }

  try {
    const result = await createLobby(userId, body.deck)
    return c.json({ lobbyId: result.id, code: result.code })
  } catch (err) {
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
    return c.json(result)
  } catch (err) {
    const msg = String(err)
    if (msg.includes("not found")) return c.json({ error: msg }, 404)
    if (msg.includes("own lobby")) return c.json({ error: msg }, 400)
    return c.json({ error: msg }, 500)
  }
})

// GET /lobby/:id
lobby.get("/:id", requireAuth, async (c) => {
  const lobbyData = await getLobby(c.req.param("id")!)
  if (!lobbyData) return c.json({ error: "Lobby not found" }, 404)

  // Attach game if active
  let game = null
  if (lobbyData.status === "active") {
    const { data } = await supabase
      .from("games")
      .select("id, status")
      .eq("lobby_id", lobbyData.id)
      .single()
    game = data
  }

  return c.json({ lobby: lobbyData, game })
})

// GET /lobby/list
lobby.get("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const lobbies = await listLobbies(userId)
  return c.json({ lobbies })
})

export { lobby }
