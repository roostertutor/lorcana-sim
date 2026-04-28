import { Hono } from "hono"
import type { DeckEntry, GameFormat } from "@lorcana-sim/engine"
import { requireAuth } from "../middleware/auth.js"
import {
  cancelMatchmakingQueue,
  getMatchmakingStatus,
  joinMatchmakingQueue,
  type MatchFormat,
  type QueueKind,
} from "../services/matchmakingService.js"

interface JoinBody {
  deck?: DeckEntry[]
  decklistText?: string
  cardMetadata?: Record<string, unknown> | null
  format?: GameFormat
  matchFormat?: string
  queueKind?: string
}

const matchmaking = new Hono<{ Variables: { userId: string } }>()

// POST /matchmaking — join the queue
matchmaking.post("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<JoinBody>().catch(() => ({} as JoinBody))

  if (!body.format || !body.format.family || !body.format.rotation) {
    return c.json({ error: "format.family and format.rotation are required" }, 400)
  }
  if (body.matchFormat !== "bo1" && body.matchFormat !== "bo3") {
    return c.json({ error: "matchFormat must be 'bo1' or 'bo3'" }, 400)
  }
  if (body.queueKind !== "casual" && body.queueKind !== "ranked") {
    return c.json({ error: "queueKind must be 'casual' or 'ranked'" }, 400)
  }

  const result = await joinMatchmakingQueue(userId, {
    ...(body.deck ? { deck: body.deck } : {}),
    ...(body.decklistText ? { decklistText: body.decklistText } : {}),
    cardMetadata: body.cardMetadata ?? null,
    format: body.format,
    matchFormat: body.matchFormat as MatchFormat,
    queueKind: body.queueKind as QueueKind,
  })

  if (!result.ok) {
    return c.json(
      result.issues
        ? { error: result.error, issues: result.issues }
        : { error: result.error },
      result.status as 400 | 401 | 403 | 404 | 409 | 429 | 500,
    )
  }

  if (result.status === "paired") {
    return c.json({
      status: "paired",
      queueEntryId: result.entryId,
      gameId: result.gameId,
      opponentId: result.opponentId,
      eloSnapshot: result.eloSnapshot,
    })
  }
  return c.json({
    status: "queued",
    queueEntryId: result.entryId,
    eloSnapshot: result.eloSnapshot,
  })
})

// GET /matchmaking — current user's queue entry status (or null)
matchmaking.get("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const status = await getMatchmakingStatus(userId)
  if (!status) return c.json({ status: null })
  return c.json({
    status: {
      entryId: status.entryId,
      format: status.format,
      matchFormat: status.matchFormat,
      queueKind: status.queueKind,
      joinedAt: status.joinedAt,
      elapsedMs: status.elapsedMs,
      eloSnapshot: status.eloSnapshot,
      // Infinity isn't JSON-serializable; surface as null when unbounded.
      currentBand:
        status.currentBand === null
          ? null
          : Number.isFinite(status.currentBand)
            ? status.currentBand
            : null,
      pairedGameId: status.pairedGameId,
    },
  })
})

// DELETE /matchmaking — cancel queue. Idempotent.
matchmaking.delete("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const result = await cancelMatchmakingQueue(userId)
  return c.json(result)
})

export { matchmaking }
