import { Hono } from "hono"
import type { GameAction } from "@lorcana-sim/engine"
import { requireAuth } from "../middleware/auth.js"
import { processAction, getGame, resignGame } from "../services/gameService.js"

const game = new Hono<{ Variables: { userId: string } }>()

// GET /game/:id — reconnect / page refresh
game.get("/:id", requireAuth, async (c) => {
  const gameData = await getGame(c.req.param("id")!)
  if (!gameData) return c.json({ error: "Game not found" }, 404)

  const userId = c.get("userId")
  if (gameData.player1_id !== userId && gameData.player2_id !== userId) {
    return c.json({ error: "Forbidden" }, 403)
  }

  return c.json({ game: gameData })
})

// POST /game/:id/action
game.post("/:id/action", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ action: GameAction }>()

  if (!body.action) return c.json({ error: "action is required" }, 400)

  const result = await processAction(c.req.param("id")!, userId, body.action)

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400)
  }

  return c.json({ success: true, newState: result.newState })
})

// POST /game/:id/resign
game.post("/:id/resign", requireAuth, async (c) => {
  const userId = c.get("userId")
  const result = await resignGame(c.req.param("id")!, userId)

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400)
  }

  return c.json({ success: true })
})

export { game }
