import type { Context, Next } from "hono"
import { supabase } from "../db/client.js"

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization header" }, 401)
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return c.json({ error: "Invalid or expired token" }, 401)
  }

  c.set("userId", data.user.id)
  await next()
}
