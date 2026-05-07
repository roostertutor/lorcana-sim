import { Hono } from "hono"
import { supabase } from "../db/client.js"
import { requireAuth } from "../middleware/auth.js"
import { getOrCreateProfile, updateDisplayName } from "../services/authService.js"

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

// PATCH /auth/profile/display-name — update the caller's mutable display_name.
// Separate from POST /auth/profile (which writes the stable `username` handle
// — username rename is intentionally deferred). See docs/HANDOFF.md →
// "username / display_name split (Discord model)".
auth.patch("/profile/display-name", requireAuth, async (c) => {
  const userId = c.get("userId")
  let body: { display_name?: unknown }
  try {
    body = await c.req.json<{ display_name?: unknown }>()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  const result = await updateDisplayName(userId, body.display_name)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }
  return c.json({ profile: result.profile })
})

export { auth }
