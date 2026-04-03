import { Hono } from "hono"
import { supabase } from "../db/client.js"
import { requireAuth } from "../middleware/auth.js"
import { getOrCreateProfile } from "../services/authService.js"

const auth = new Hono<{ Variables: { userId: string } }>()

// These are thin wrappers — Supabase handles the OAuth flows directly in the client.
// The server endpoints here are for profile management and session validation.

// GET /auth/me — return current user profile
auth.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId")
  const profile = await getOrCreateProfile(userId)
  return c.json({ profile })
})

// POST /auth/profile — set or update username
auth.post("/profile", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ username: string }>()

  if (!body.username || body.username.length < 3 || body.username.length > 20) {
    return c.json({ error: "Username must be 3-20 characters" }, 400)
  }

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, username: body.username })

  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "Username already taken" }, 409)
    }
    return c.json({ error: error.message }, 500)
  }

  return c.json({ success: true })
})

export { auth }
