// =============================================================================
// FEEDBACK API — thin POST wrapper around the server's /feedback endpoint.
//
// Server contract: docs/HANDOFF.md "in-app feedback / bug report system" +
// server/src/services/feedbackService.ts. Auth is OPTIONAL — bearer token is
// attached when a Supabase session exists, omitted otherwise (anonymous
// submissions are intentional, rate-limited differently on the server).
//
// Returns a discriminated union so every caller has a single error code path:
//   - 4xx / 5xx response bodies
//   - JSON parse failures
//   - Network failures (fetch reject)
// All collapse to `{ ok: false, error, retryAfterSeconds? }`.
// =============================================================================
import { supabase } from "./supabase.js"

const SERVER_URL = (import.meta.env["VITE_SERVER_URL"] as string | undefined) ?? "http://localhost:3001"

/** Mirrors the server's `FEEDBACK_TYPES` constant. Keep in sync — adding a
 *  type requires a server schema migration AND updating both ends. */
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

/** User-visible labels for the type dropdown. Order matches FEEDBACK_TYPES so
 *  array index works as a stable sort key in the UI. */
export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  card_issue: "Card issue",
  idea: "Idea / feature request",
  general: "General feedback",
  ui: "UI / UX problem",
  performance: "Performance issue",
  crash: "Crash / freeze",
}

export interface ClientMeta {
  url?: string
  userAgent?: string
  viewport?: { width: number; height: number }
  appVersion?: string
}

export interface FeedbackSubmission {
  type: FeedbackType
  title: string
  description: string
  context?: Record<string, unknown>
  clientMeta: ClientMeta
}

export type FeedbackResult =
  | { ok: true; id: string; createdAt: string; referenceCode: string }
  | { ok: false; error: string; retryAfterSeconds?: number }

/** Read the current access token if a Supabase session exists. Anonymous
 *  submissions are first-class per Decision #1 — we never throw here; the
 *  caller falls back to sending without an Authorization header. */
async function getOptionalToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/** Capture page + viewport + app-version metadata. Always called at submit
 *  time — values are point-in-time so they reflect the URL the user was on
 *  when they clicked Submit, not when the modal opened. Matches the
 *  privacy-forward "what we'll send" preview rendered by FeedbackModal. */
export function captureClientMeta(): ClientMeta {
  const meta: ClientMeta = {}
  if (typeof window !== "undefined") {
    meta.url = window.location.pathname
    meta.viewport = { width: window.innerWidth, height: window.innerHeight }
  }
  if (typeof navigator !== "undefined") {
    meta.userAgent = navigator.userAgent
  }
  const version = import.meta.env["VITE_APP_VERSION"] as string | undefined
  meta.appVersion = version ?? "dev"
  return meta
}

/** POST /feedback. Returns the discriminated union — never throws. Network
 *  errors, parse errors, and HTTP error responses all collapse into
 *  `{ ok: false, error, retryAfterSeconds? }` so the modal renders one
 *  consistent error pathway. */
export async function submitFeedback(input: FeedbackSubmission): Promise<FeedbackResult> {
  const token = await getOptionalToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${SERVER_URL}/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${(err as Error).message ?? "could not reach server"}`,
    }
  }

  // Parse body once. Server always returns JSON for success + validation +
  // rate-limit paths; a non-JSON 5xx response is treated as a generic error.
  type ServerResponse = {
    ok?: boolean
    id?: string
    createdAt?: string
    referenceCode?: string
    error?: string
    retryAfterSeconds?: number
  }
  let data: ServerResponse | null = null
  try {
    data = (await res.json()) as ServerResponse
  } catch {
    /* body wasn't JSON — fall through to error formatting below */
  }

  if (!res.ok || !data?.ok) {
    const error = data?.error ?? `HTTP ${res.status}`
    const result: FeedbackResult = { ok: false, error }
    if (typeof data?.retryAfterSeconds === "number") {
      result.retryAfterSeconds = data.retryAfterSeconds
    }
    return result
  }

  return {
    ok: true,
    id: data.id ?? "",
    createdAt: data.createdAt ?? "",
    referenceCode: data.referenceCode ?? "",
  }
}
