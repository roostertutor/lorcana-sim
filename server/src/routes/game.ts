import { Hono } from "hono"
import type { GameAction, GameState, PlayerID } from "@lorcana-sim/engine"
import { requireAuth } from "../middleware/auth.js"
import { processAction, getGame, resignGame, getGameHistory, getGameActions, getGameReplay } from "../services/gameService.js"
import { filterStateForPlayer } from "../services/stateFilter.js"

const game = new Hono<{ Variables: { userId: string } }>()

// Static routes MUST come before parameterized /:id routes

// GET /game/history — list of finished games for the current user
game.get("/history", requireAuth, async (c) => {
  const userId = c.get("userId")
  const page = parseInt(c.req.query("page") ?? "0", 10)
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50)

  const games = await getGameHistory(userId, page, limit)
  return c.json({ games })
})

// GET /game/:id — reconnect / page refresh
game.get("/:id", requireAuth, async (c) => {
  const gameData = await getGame(c.req.param("id")!)
  if (!gameData) return c.json({ error: "Game not found" }, 404)

  const userId = c.get("userId")
  if (gameData.player1_id !== userId && gameData.player2_id !== userId) {
    return c.json({ error: "Forbidden" }, 403)
  }

  // Filter hidden information before sending to client
  const playerSide: PlayerID = gameData.player1_id === userId ? "player1" : "player2"
  const filteredState = filterStateForPlayer(gameData.state as GameState, playerSide)

  return c.json({ game: { ...gameData, state: filteredState } })
})

// GET /game/:id/actions — ordered action list for replay reconstruction
game.get("/:id/actions", requireAuth, async (c) => {
  const gameData = await getGame(c.req.param("id")!)
  if (!gameData) return c.json({ error: "Game not found" }, 404)

  const userId = c.get("userId")
  if (gameData.player1_id !== userId && gameData.player2_id !== userId) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const actions = await getGameActions(c.req.param("id")!)
  return c.json({ actions })
})

// GET /game/:id/replay — full replay data (seed + decks + actions) for replay viewer
game.get("/:id/replay", requireAuth, async (c) => {
  const gameData = await getGame(c.req.param("id")!)
  if (!gameData) return c.json({ error: "Game not found" }, 404)

  const userId = c.get("userId")
  if (gameData.player1_id !== userId && gameData.player2_id !== userId) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const replay = await getGameReplay(c.req.param("id")!)
  if (!replay) return c.json({ error: "Replay data not available" }, 404)

  return c.json({ replay })
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

  // Filter hidden information — don't leak opponent's hand/deck to the acting player
  const gameData = await getGame(c.req.param("id")!)
  const playerSide: PlayerID = gameData?.player1_id === userId ? "player1" : "player2"
  const filteredState = result.newState
    ? filterStateForPlayer(result.newState, playerSide)
    : undefined

  return c.json({ success: true, newState: filteredState, nextGameId: result.nextGameId })
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
