import { Hono } from "hono"
import type { GameAction, GameState, PlayerID } from "@lorcana-sim/engine"
import { filterStateForPlayer } from "@lorcana-sim/engine"
import { requireAuth } from "../middleware/auth.js"
import { supabase } from "../db/client.js"
import {
  processAction,
  getGame,
  resignGame,
  getGameHistory,
  getGameActions,
  getFilteredGameReplay,
  decideReplayAccess,
  recordHeartbeat,
  projectClockForRow,
  type ReplayPerspective,
} from "../services/gameService.js"

/** Parse `?perspective=p1|p2|neutral`. Returns null if omitted, undefined
 *  if the value is invalid (route should 400 in that case). */
function parsePerspectiveQuery(raw: string | undefined): ReplayPerspective | null | undefined {
  if (raw == null) return null
  if (raw === "p1" || raw === "p2" || raw === "neutral") return raw
  return undefined
}

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

// GET /game/:id — reconnect / page refresh.
//
// Side effects: getGame runs the lazy clock check — if the active player's
// bank or grace exhausted since the last interaction, this fetch will trigger
// the timeout/disconnect finalization and return the finished game. Clients
// that poll this endpoint act as the disconnect-detection driver for active
// games (no cron needed).
//
// Response shape: adds a `clock` field with projected-for-display values
// (live countdown for the decision player, frozen for the inactive player;
// disconnect flags per player). Null when the game predates the clock
// rollout (legacy untimed game). Phase 2 UI consumers render from this.
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
  const clock = projectClockForRow(gameData as Record<string, unknown>)

  return c.json({ game: { ...gameData, state: filteredState }, playerSide, clock })
})

// POST /game/:id/heartbeat — client presence ping.
//
// Clients should call every ~10s while the game tab is active and the game
// is still 'active'. Server uses heartbeat timestamps to detect disconnects
// (>30s without ping = treated as disconnected, both clocks pause, grace
// countdown begins). Reconnect within grace clears the disconnect flag AND
// deducts the disconnect duration from grace.
//
// Returns the up-to-date clock for client display. 404 if game doesn't
// exist; 403 if caller isn't a player; 409 if game has already finished or
// pre-dates the clock rollout.
game.post("/:id/heartbeat", requireAuth, async (c) => {
  const userId = c.get("userId")
  const result = await recordHeartbeat(c.req.param("id")!, userId)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  // Return the raw clock state — client renders countdowns from these.
  return c.json({
    ok: true,
    clock: {
      p1TimeRemainingMs: result.clock.p1TimeRemainingMs,
      p2TimeRemainingMs: result.clock.p2TimeRemainingMs,
      p1GraceRemainingMs: result.clock.p1GraceRemainingMs,
      p2GraceRemainingMs: result.clock.p2GraceRemainingMs,
      p1Disconnected: result.clock.p1DisconnectedSince !== null,
      p2Disconnected: result.clock.p2DisconnectedSince !== null,
    },
  })
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

// GET /game/:id/replay — replay viewer payload (per-viewer filtered state stream).
//
// PHASE A (2026-04-29) anti-cheat fix: this endpoint used to return raw
// { seed, p1Deck, p2Deck, actions, ... } and the client reconstructed locally
// without applying the per-player filter — leaking the opponent's full hand
// history. Now returns pre-rendered, filtered GameState[] so the client can't
// bypass the filter. See server/src/services/gameService.ts → getFilteredGameReplay.
//
// Query: ?perspective=p1|p2|neutral (optional). Default = caller's own slot.
// Access matrix enforced by `decideReplayAccess` — see its docstring for the
// full table. This route always requires auth (replays for finished MP games
// the caller participated in); the public-share path lives at GET /replay/:id.
game.get("/:id/replay", requireAuth, async (c) => {
  const gameId = c.req.param("id")!
  const gameData = await getGame(gameId)
  if (!gameData) return c.json({ error: "Game not found" }, 404)

  const userId = c.get("userId")

  // Parse perspective query param.
  const requested = parsePerspectiveQuery(c.req.query("perspective"))
  if (requested === undefined) {
    return c.json({ error: "Invalid perspective. Must be p1, p2, or neutral." }, 400)
  }

  // Read the public flag from the replays row (if it exists) so neutral
  // perspective is allowed iff both players opted in. No replays row → treat
  // as private (the in-progress / never-saved case shouldn't reach this
  // endpoint, but default-deny if it does).
  const { data: replayRow } = await supabase
    .from("replays")
    .select("public")
    .eq("game_id", gameId)
    .maybeSingle()
  const isPublic = (replayRow?.public as boolean | undefined) === true

  const decision = decideReplayAccess({
    userId,
    p1Id: gameData.player1_id as string,
    p2Id: gameData.player2_id as string,
    isPublic,
    requested,
  })
  if (!decision.ok) {
    return c.json({ error: decision.error }, decision.status)
  }

  const replay = await getFilteredGameReplay(gameId, decision.perspective)
  if (!replay) return c.json({ error: "Replay data not available" }, 404)

  return c.json({ replay: { ...replay, perspective: decision.perspective } })
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
