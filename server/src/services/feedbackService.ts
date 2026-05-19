// =============================================================================
// FEEDBACK SERVICE — in-app bug-report / feature-request submission backend.
//
// Backs the `Report an issue` trigger surfaced across the app (footer link,
// card-inspect modal, gameboard, eventually error boundaries). Each trigger
// auto-injects its context (cardId, gameSeed, replay_id, deck_id, etc.) so
// the user doesn't have to describe what they were doing — load-bearing for
// card_issue triage especially.
//
// Design source: docs/HANDOFF.md "Server agent (first) + GUI agent (follow-up):
// in-app feedback / bug report system" (planned 2026-04-21, shipped 2026-05-19).
//
// Anonymous submissions allowed — removes the "have to make an account to
// report a bug" friction. Rate-limited differently per identity bucket:
//   - Authenticated: 10/hour per user_id (room for spam but not floods)
//   - Anonymous: 3/hour per IP /24 prefix (tighter, since less accountable)
//
// MVP scope (this module):
//   - Validation (type enum, length bounds)
//   - Rate limit (DB window query)
//   - Insert into `feedback` table
//   - Reference code generation (fb-<6-char>)
//   - Optional Discord webhook (env-gated; no-op if DISCORD_FEEDBACK_WEBHOOK unset)
//
// Phase 2+ (not built here):
//   - Screenshot attachment
//   - Error-boundary integration (auto-fire on crash)
//   - "My tickets" user-visible view
//   - Admin dashboard
// =============================================================================

import { supabase } from "../db/client.js"

/** Valid `type` enum values. Mirrors the CHECK constraint on the `feedback`
 *  table. Keep in sync with schema.sql — adding a new type requires dropping
 *  + recreating the constraint, intentional friction so the bucket list
 *  stays small. */
export const FEEDBACK_TYPES = [
  "bug",
  "card_issue",
  "idea",
  "general",
  "ui",
  "performance",
  "crash",
] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

const TITLE_MIN = 3
const TITLE_MAX = 200
const DESCRIPTION_MIN = 3
const DESCRIPTION_MAX = 5000

const RATE_LIMIT_WINDOW_MS = 60 * 60_000 // 1 hour
const RATE_LIMIT_AUTHENTICATED = 10
const RATE_LIMIT_ANONYMOUS = 3

export interface FeedbackInput {
  type: FeedbackType
  title: string
  description: string
  context?: Record<string, unknown>
  clientMeta: {
    url?: string
    userAgent?: string
    viewport?: { width: number; height: number }
    appVersion?: string
  }
  /** Reserved for Phase 2 — base64 data URL. MVP rejects with 400 if present. */
  screenshot?: string
}

export type FeedbackSubmissionResult =
  | { ok: true; id: string; createdAt: string; referenceCode: string }
  | { ok: false; status: 400 | 413 | 429; error: string; retryAfterSeconds?: number }

/** Reduce an IPv4 or IPv6 address to a coarse network prefix so we don't
 *  store the visitor's exact IP. /24 for v4 (last octet stripped), /48 for
 *  v6 (first three groups kept). Rate-limit accuracy is unchanged because
 *  the prefix still uniquely identifies a household-or-ISP-CGNAT bucket.
 *  Returns the input unchanged if it doesn't look like an IP — defensive
 *  default that errs toward stricter rate limiting (whole string as key). */
export function ipToPrefix(rawIp: string): string {
  const ip = rawIp.trim()
  // IPv4: a.b.c.d → a.b.c.0
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`
  // IPv6: first three groups + ::, rest zeroed
  if (ip.includes(":")) {
    const groups = ip.split(":")
    if (groups.length >= 3) return `${groups[0]}:${groups[1]}:${groups[2]}::`
  }
  return ip
}

/** Validation result. Discriminated union so the caller can branch on `ok`
 *  and get a typed error message + HTTP status to surface. */
type ValidationResult = { ok: true } | { ok: false; status: 400 | 413; error: string }

export function validateFeedbackInput(input: FeedbackInput): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, status: 400, error: "Request body must be an object" }
  }
  if (!FEEDBACK_TYPES.includes(input.type)) {
    return {
      ok: false,
      status: 400,
      error: `type must be one of: ${FEEDBACK_TYPES.join(", ")}`,
    }
  }
  if (typeof input.title !== "string" || input.title.length < TITLE_MIN || input.title.length > TITLE_MAX) {
    return {
      ok: false,
      status: 400,
      error: `title must be ${TITLE_MIN}-${TITLE_MAX} characters`,
    }
  }
  if (
    typeof input.description !== "string" ||
    input.description.length < DESCRIPTION_MIN ||
    input.description.length > DESCRIPTION_MAX
  ) {
    return {
      ok: false,
      status: 400,
      error: `description must be ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters`,
    }
  }
  // Phase 2 reserved — surface as 400 not 413 since the right answer is
  // "don't send screenshots yet" not "your screenshot is too big".
  if (input.screenshot !== undefined && input.screenshot !== null) {
    return {
      ok: false,
      status: 400,
      error: "screenshot attachment is reserved for Phase 2 and not yet accepted",
    }
  }
  if (!input.clientMeta || typeof input.clientMeta !== "object") {
    return { ok: false, status: 400, error: "clientMeta is required" }
  }
  return { ok: true }
}

/** Format a `referenceCode` for user-visible toast / email replies.
 *  `fb-` + first 6 chars of the UUID. Stable, short enough to type back
 *  to support, doesn't reveal the full row UUID (which is also fine to
 *  reveal — but the short form is friendlier). */
export function buildReferenceCode(rowId: string): string {
  return `fb-${rowId.slice(0, 6)}`
}

/** Check whether the submitter has exceeded their rate limit in the past
 *  hour. Authenticated users are keyed by user_id; anonymous by IP prefix.
 *  Returns null if under the limit, or a `retryAfterSeconds` value if over.
 *
 *  Exported for direct unit testing. */
export async function checkRateLimit(opts: {
  userId: string | null
  ipPrefix: string | null
  now?: Date
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const now = opts.now ?? new Date()
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)
  const limit = opts.userId ? RATE_LIMIT_AUTHENTICATED : RATE_LIMIT_ANONYMOUS

  const query = supabase
    .from("feedback")
    .select("created_at", { count: "exact", head: true })
    .gte("created_at", windowStart.toISOString())

  const scoped = opts.userId
    ? query.eq("user_id", opts.userId)
    : opts.ipPrefix
      ? query.eq("caller_ip_prefix", opts.ipPrefix)
      : query

  const { count, error } = await scoped

  // Fail-open on rate-limit query failure: we'd rather accept the submission
  // than reject a legitimate bug report because the rate-limit query had a
  // hiccup. Logged for ops visibility.
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[feedback] rate-limit query failed; failing open:", error.message)
    return { ok: true }
  }

  if ((count ?? 0) < limit) return { ok: true }

  // Compute retry-after from the oldest in-window submission's age. Cheap
  // approximation: full window from `now`. Could be tightened by reading
  // the actual oldest row's created_at, but adds a second round-trip for
  // a value the client treats as advisory anyway.
  return { ok: false, retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) }
}

/** Post a redacted summary of a new feedback submission to a Discord
 *  channel. Skips entirely if the `DISCORD_FEEDBACK_WEBHOOK` env var is
 *  unset — env-gated so dev environments don't need the secret.
 *
 *  Sends: type, title, first 200 chars of description, referenceCode,
 *  authenticated vs anonymous flag. Deliberately omits full description,
 *  full context, IP — those live in the DB row for admins, not in Discord. */
export async function postDiscordWebhook(opts: {
  type: FeedbackType
  title: string
  description: string
  referenceCode: string
  isAuthenticated: boolean
}): Promise<void> {
  const webhookUrl = process.env["DISCORD_FEEDBACK_WEBHOOK"]
  if (!webhookUrl) return

  const truncatedDescription =
    opts.description.length > 200 ? opts.description.slice(0, 200) + "…" : opts.description

  const payload = {
    content: null,
    embeds: [
      {
        title: `[${opts.type}] ${opts.title}`,
        description: truncatedDescription,
        color: opts.type === "bug" || opts.type === "crash" ? 0xef4444 : 0x3b82f6,
        footer: {
          text: `${opts.referenceCode} · ${opts.isAuthenticated ? "auth" : "anon"}`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    // Webhook failure is non-fatal — the DB row is already written by the
    // time we get here. Log so ops sees recurring failures.
    // eslint-disable-next-line no-console
    console.warn("[feedback] Discord webhook post failed:", (err as Error).message)
  }
}

/** Main entry point — validates, rate-limits, inserts, fires webhook,
 *  returns reference code. Route handler is a thin wrapper around this. */
export async function submitFeedback(
  input: FeedbackInput,
  identity: { userId: string | null; ipPrefix: string | null },
): Promise<FeedbackSubmissionResult> {
  const validation = validateFeedbackInput(input)
  if (!validation.ok) return validation

  const rate = await checkRateLimit({ userId: identity.userId, ipPrefix: identity.ipPrefix })
  if (!rate.ok) {
    return {
      ok: false,
      status: 429,
      error: "Too many submissions — please wait before reporting again",
      retryAfterSeconds: rate.retryAfterSeconds,
    }
  }

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: identity.userId,
      type: input.type,
      title: input.title,
      description: input.description,
      context: input.context ?? {},
      url: input.clientMeta.url ?? null,
      user_agent: input.clientMeta.userAgent ?? null,
      viewport: input.clientMeta.viewport ?? null,
      app_version: input.clientMeta.appVersion ?? null,
      // Authenticated submissions don't store IP prefix — user_id is the
      // rate-limit + identity key. Anonymous ones store the prefix for
      // rate-limit lookups going forward.
      caller_ip_prefix: identity.userId ? null : identity.ipPrefix,
    })
    .select("id, created_at")
    .single()

  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error("[feedback] insert failed:", error?.message)
    return { ok: false, status: 400, error: "Failed to record feedback — please try again" }
  }

  const rowId = data.id as string
  const createdAt = data.created_at as string
  const referenceCode = buildReferenceCode(rowId)

  // Fire-and-forget Discord webhook — don't await; failures shouldn't slow
  // the user's submission response.
  void postDiscordWebhook({
    type: input.type,
    title: input.title,
    description: input.description,
    referenceCode,
    isAuthenticated: identity.userId !== null,
  })

  return { ok: true, id: rowId, createdAt, referenceCode }
}
