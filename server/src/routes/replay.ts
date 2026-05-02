import { Hono } from "hono"
import { requireAuth } from "../middleware/auth.js"
import { supabase } from "../db/client.js"
import {
  buildReplayView,
  decideReplayAccess,
  getReplayById,
  setReplayPublic,
  type ReplayPerspective,
} from "../services/gameService.js"

const replay = new Hono<{ Variables: { userId: string } }>()

/** Parse `?perspective=p1|p2|neutral`. Returns null if omitted, undefined
 *  if the value is invalid (route should 400 in that case). */
function parsePerspectiveQuery(raw: string | undefined): ReplayPerspective | null | undefined {
  if (raw == null) return null
  if (raw === "p1" || raw === "p2" || raw === "neutral") return raw
  return undefined
}

/**
 * GET /replay/:id
 *
 * Returns the full replay (metadata + per-viewer-filtered state stream) if
 * the caller is authorized.
 *
 * Auth paths:
 *   - replay.public === true  → anyone with the link, auth optional
 *   - replay.public === false → caller must be one of the two players; 401
 *                               if no auth, 403 if wrong user
 *
 * Query: `?perspective=p1|p2|neutral` (optional). Defaults to caller's own
 * slot for players, `neutral` for non-players on a public replay. The full
 * access matrix lives in `decideReplayAccess` — see its docstring.
 *
 * PHASE A (2026-04-29) anti-cheat fix: previously returned the raw seed +
 * decks + actions tuple, letting clients reconstruct locally without
 * applying the per-player filter. Now returns pre-rendered, filtered
 * GameState[] so the client can't bypass the filter.
 *
 * The auth path deliberately doesn't use `requireAuth` middleware — public
 * replays must work without a token. Instead we parse the Authorization
 * header ourselves and gate on the result. This makes shareable links usable
 * without any user-session setup (works in incognito, across devices, etc.).
 */
replay.get("/:id", async (c) => {
  const replayId = c.req.param("id")!
  const row = await getReplayById(replayId)
  if (!row) return c.json({ error: "Replay not found" }, 404)

  // Parse perspective query param (validate before any DB work).
  const requested = parsePerspectiveQuery(c.req.query("perspective"))
  if (requested === undefined) {
    return c.json({ error: "Invalid perspective. Must be p1, p2, or neutral." }, 400)
  }

  // Try to identify the caller from the Authorization header (optional).
  let userId: string | null = null
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    const { data } = await supabase.auth.getUser(token)
    userId = data.user?.id ?? null
  }

  const decision = decideReplayAccess({
    userId,
    p1Id: row.p1_id,
    p2Id: row.p2_id,
    isPublic: row.row.public,
    requested,
  })
  if (!decision.ok) {
    return c.json({ error: decision.error }, decision.status)
  }

  const view = await buildReplayView(replayId, row, true, decision.perspective)
  return c.json({ replay: view })
})

/**
 * PATCH /replay/:id/share — toggle the `public` flag.
 *
 * Body: `{ public: boolean }`. Caller must be one of the two players of the
 * parent game. Returns the new public state on success.
 */
replay.patch("/:id/share", requireAuth, async (c) => {
  const userId = c.get("userId")
  const replayId = c.req.param("id")!
  const body = await c.req.json<{ public?: unknown }>().catch(() => ({} as { public?: unknown }))
  const makePublic = (body as { public?: unknown }).public

  if (typeof makePublic !== "boolean") {
    return c.json({ error: "body.public must be a boolean" }, 400)
  }

  const result = await setReplayPublic(replayId, userId, makePublic)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ ok: true, public: result.public })
})

export { replay }
