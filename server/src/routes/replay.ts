import { Hono } from "hono"
import { requireAuth } from "../middleware/auth.js"
import { supabase } from "../db/client.js"
import {
  buildReplayView,
  getReplayById,
  setReplayPublic,
} from "../services/gameService.js"

const replay = new Hono<{ Variables: { userId: string } }>()

/**
 * GET /replay/:id
 *
 * Returns the full replay (metadata + reconstructible payload) if the caller
 * is authorized. Two auth paths:
 *   - replay.public === true  → anyone with the link, auth optional
 *   - replay.public === false → caller must be one of the two players; 401
 *                               if no auth, 403 if wrong user
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

  // Try to identify the caller from the Authorization header (optional).
  let userId: string | null = null
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    const { data } = await supabase.auth.getUser(token)
    userId = data.user?.id ?? null
  }

  const isPlayer = userId != null && (userId === row.p1_id || userId === row.p2_id)
  const canAccess = row.row.public || isPlayer
  if (!canAccess) {
    // Distinguish "need auth" from "auth'd but wrong user" for clearer UX.
    return c.json(
      { error: userId == null ? "Authentication required" : "This replay is private" },
      userId == null ? 401 : 403,
    )
  }

  const view = await buildReplayView(replayId, row, true)
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
