import { Hono } from "hono"
import { supabase } from "../db/client.js"
import {
  ipToPrefix,
  submitFeedback,
  type FeedbackInput,
} from "../services/feedbackService.js"

/**
 * POST /feedback
 *
 * Submits a new feedback / bug-report row. Auth is **optional**:
 *   - With Bearer token → row is linked to the user_id; rate-limited at
 *     10/hour per user.
 *   - Without token → anonymous row; rate-limited at 3/hour per IP /24
 *     prefix.
 *
 * Validation rejects with 400 (length bounds, bad type, Phase 2
 * screenshot attempt). Rate limit returns 429 with `retryAfterSeconds`.
 * Success returns `{ ok: true, id, createdAt, referenceCode }` where
 * `referenceCode = "fb-" + id.slice(0,6)` for user-visible toasts.
 *
 * IP extraction: trusts `x-forwarded-for` first hop (the Railway / proxy
 * convention), falls back to Hono's connection IP. Truncated to /24 v4
 * or /48 v6 prefix before storage so we don't keep visitor-exact IPs.
 *
 * Authenticated path: parse the Bearer token ourselves rather than using
 * `requireAuth` middleware — the endpoint must allow anonymous, and the
 * middleware rejects with 401. If a token is present but invalid, we
 * silently fall back to anonymous rather than rejecting; the user gets
 * a successful submission tagged anonymous instead of a confusing 401.
 */
const feedback = new Hono()

feedback.post("/", async (c) => {
  // Optional auth — best-effort user_id extraction. Invalid tokens fall
  // through to anonymous so a stale session doesn't block bug reports.
  let userId: string | null = null
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    try {
      const { data } = await supabase.auth.getUser(token)
      userId = data.user?.id ?? null
    } catch {
      // Auth lookup failure — treat as anonymous.
      userId = null
    }
  }

  // Extract IP for anonymous rate limiting. Honors `x-forwarded-for` first
  // hop (typical proxy/load-balancer header), falls back to Hono's
  // connection info.
  const xff = c.req.header("x-forwarded-for")
  const rawIp = xff?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"
  const ipPrefix = ipToPrefix(rawIp)

  let body: FeedbackInput
  try {
    body = (await c.req.json()) as FeedbackInput
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400)
  }

  const result = await submitFeedback(body, { userId, ipPrefix })

  if (!result.ok) {
    if (result.status === 429) {
      // Surface retryAfter as both a Retry-After header (HTTP convention)
      // and in the body (UI client may render it inline).
      c.header("Retry-After", String(result.retryAfterSeconds ?? 3600))
      return c.json(
        { ok: false, error: result.error, retryAfterSeconds: result.retryAfterSeconds },
        429,
      )
    }
    return c.json({ ok: false, error: result.error }, result.status)
  }

  return c.json({
    ok: true,
    id: result.id,
    createdAt: result.createdAt,
    referenceCode: result.referenceCode,
  })
})

export { feedback }
