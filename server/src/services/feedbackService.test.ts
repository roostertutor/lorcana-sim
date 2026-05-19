// =============================================================================
// FEEDBACK SERVICE UNIT TESTS
//
// Pure-function coverage for the feedback / bug-report submission backend.
// The validation + ip-prefix + reference-code paths are deterministic and
// don't touch the DB — covered without scaffolding. The full submitFeedback
// path is exercised via a small supabase double (same pattern as
// lobbyService.test.ts / matchmakingService.test.ts) for the rate-limit +
// insert flows.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest"

// gameService and friends import db/client.ts at module init. Stub before
// importing anything that pulls them in. The submitFeedback path needs a
// real-shaped double (insert + count queries); the pure helpers don't.
interface MockTableRow {
  [k: string]: unknown
}

const rateLimitState: {
  rows: MockTableRow[]
  insertedRows: MockTableRow[]
  insertError: { message: string } | null
  rateLimitError: { message: string } | null
  countOverride: number | null
} = {
  rows: [],
  insertedRows: [],
  insertError: null,
  rateLimitError: null,
  countOverride: null,
}

function buildSelectChain() {
  const chain: {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => typeof chain
    gte: (col: string, val: string) => typeof chain
    eq: (col: string, val: unknown) => typeof chain
    then: (resolve: (val: unknown) => unknown) => Promise<unknown>
  } = {
    select(_cols: string, _opts?: { count?: string; head?: boolean }) {
      return chain
    },
    gte(_col: string, _val: string) {
      return chain
    },
    eq(_col: string, _val: unknown) {
      return chain
    },
    then(resolve) {
      const count = rateLimitState.countOverride ?? rateLimitState.rows.length
      const result = rateLimitState.rateLimitError
        ? { count: null, error: rateLimitState.rateLimitError }
        : { count, error: null }
      return Promise.resolve(resolve(result))
    },
  }
  return chain
}

function buildInsertChain(payload: MockTableRow) {
  return {
    select(_cols: string) {
      return {
        single: () => {
          if (rateLimitState.insertError) {
            return Promise.resolve({ data: null, error: rateLimitState.insertError })
          }
          const row = {
            id: "00000000-0000-0000-0000-000000000abc",
            created_at: new Date("2026-05-19T12:00:00Z").toISOString(),
            ...payload,
          }
          rateLimitState.insertedRows.push(row)
          return Promise.resolve({ data: row, error: null })
        },
      }
    },
  }
}

const mockSupabase = {
  from(_table: string) {
    return {
      select: (cols: string, opts?: { count?: string; head?: boolean }) =>
        buildSelectChain().select(cols, opts),
      insert: (payload: MockTableRow) => buildInsertChain(payload),
    }
  },
  auth: { getUser: vi.fn() },
}

vi.mock("../db/client.js", () => ({ supabase: mockSupabase }))

const {
  buildReferenceCode,
  checkRateLimit,
  ipToPrefix,
  submitFeedback,
  validateFeedbackInput,
} = await import("./feedbackService.js")

beforeEach(() => {
  rateLimitState.rows = []
  rateLimitState.insertedRows = []
  rateLimitState.insertError = null
  rateLimitState.rateLimitError = null
  rateLimitState.countOverride = null
})

const validClientMeta = {
  url: "/sandbox",
  userAgent: "test-agent",
  viewport: { width: 1920, height: 1080 },
  appVersion: "test",
}

describe("ipToPrefix", () => {
  it("truncates IPv4 to /24 (last octet zeroed)", () => {
    expect(ipToPrefix("192.168.1.42")).toBe("192.168.1.0")
    expect(ipToPrefix("10.0.0.1")).toBe("10.0.0.0")
  })

  it("truncates IPv6 to /48 (first three groups kept, rest zeroed)", () => {
    expect(ipToPrefix("2001:db8:abcd:1234:5678::1")).toBe("2001:db8:abcd::")
  })

  it("returns the input unchanged for unrecognized formats (defensive default)", () => {
    expect(ipToPrefix("unknown")).toBe("unknown")
    expect(ipToPrefix("not-an-ip-at-all")).toBe("not-an-ip-at-all")
  })

  it("strips whitespace before parsing", () => {
    expect(ipToPrefix("  192.168.1.42  ")).toBe("192.168.1.0")
  })
})

describe("buildReferenceCode", () => {
  it("formats as fb- + first 6 chars of the UUID", () => {
    expect(buildReferenceCode("00000000-0000-0000-0000-000000000abc")).toBe("fb-000000")
    expect(buildReferenceCode("deadbeef-1234-5678-9abc-def012345678")).toBe("fb-deadbe")
  })
})

describe("validateFeedbackInput", () => {
  const valid = {
    type: "bug" as const,
    title: "Card X does nothing when played",
    description: "Steps to reproduce: play Card X. Expected: it banishes a target. Actual: no-op.",
    clientMeta: validClientMeta,
  }

  it("accepts a well-formed bug submission", () => {
    expect(validateFeedbackInput(valid)).toEqual({ ok: true })
  })

  it("accepts all canonical type values", () => {
    for (const t of ["bug", "card_issue", "idea", "general", "ui", "performance", "crash"] as const) {
      expect(validateFeedbackInput({ ...valid, type: t })).toEqual({ ok: true })
    }
  })

  it("rejects bad type with 400", () => {
    // @ts-expect-error — deliberate bad type
    const result = validateFeedbackInput({ ...valid, type: "spam" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toMatch(/type must be one of/)
    }
  })

  it("rejects title shorter than 3 chars", () => {
    const result = validateFeedbackInput({ ...valid, title: "ab" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it("rejects title longer than 200 chars", () => {
    const result = validateFeedbackInput({ ...valid, title: "x".repeat(201) })
    expect(result.ok).toBe(false)
  })

  it("rejects description shorter than 3 chars", () => {
    const result = validateFeedbackInput({ ...valid, description: "ab" })
    expect(result.ok).toBe(false)
  })

  it("rejects description longer than 5000 chars", () => {
    const result = validateFeedbackInput({ ...valid, description: "x".repeat(5001) })
    expect(result.ok).toBe(false)
  })

  it("rejects screenshot attachment (Phase 2 deferred) with 400", () => {
    const result = validateFeedbackInput({ ...valid, screenshot: "data:image/png;base64,..." })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toMatch(/screenshot.*Phase 2/)
    }
  })

  it("rejects missing clientMeta", () => {
    // @ts-expect-error — deliberate missing
    const result = validateFeedbackInput({ ...valid, clientMeta: undefined })
    expect(result.ok).toBe(false)
  })
})

describe("checkRateLimit", () => {
  it("allows authenticated user under 10/hr", async () => {
    rateLimitState.countOverride = 5
    const result = await checkRateLimit({ userId: "u-1", ipPrefix: null })
    expect(result.ok).toBe(true)
  })

  it("rejects authenticated user at 10/hr exactly (limit is exclusive)", async () => {
    rateLimitState.countOverride = 10
    const result = await checkRateLimit({ userId: "u-1", ipPrefix: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryAfterSeconds).toBe(3600)
    }
  })

  it("allows anonymous under 3/hr", async () => {
    rateLimitState.countOverride = 2
    const result = await checkRateLimit({ userId: null, ipPrefix: "192.168.1.0" })
    expect(result.ok).toBe(true)
  })

  it("rejects anonymous at 3/hr (stricter than authenticated)", async () => {
    rateLimitState.countOverride = 3
    const result = await checkRateLimit({ userId: null, ipPrefix: "192.168.1.0" })
    expect(result.ok).toBe(false)
  })

  it("fails open on rate-limit query error (don't reject legitimate bug reports on infra hiccup)", async () => {
    rateLimitState.rateLimitError = { message: "connection reset" }
    const result = await checkRateLimit({ userId: "u-1", ipPrefix: null })
    expect(result.ok).toBe(true)
  })
})

describe("submitFeedback — end-to-end", () => {
  const valid = {
    type: "bug" as const,
    title: "Card X does nothing",
    description: "Played Card X expecting effect Y. Got no-op.",
    clientMeta: validClientMeta,
  }

  it("accepts a well-formed authenticated submission and returns reference code", async () => {
    rateLimitState.countOverride = 0
    const result = await submitFeedback(valid, { userId: "u-1", ipPrefix: "192.168.1.0" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.referenceCode).toMatch(/^fb-[0-9a-f]{6}$/)
      expect(result.id).toBeTruthy()
      expect(result.createdAt).toBeTruthy()
    }
    expect(rateLimitState.insertedRows).toHaveLength(1)
    const row = rateLimitState.insertedRows[0]!
    expect(row["user_id"]).toBe("u-1")
    // Authenticated submission: caller_ip_prefix NOT stored (user_id is the
    // identity key; IP prefix is anonymous-only).
    expect(row["caller_ip_prefix"]).toBeNull()
  })

  it("anonymous submission stores caller_ip_prefix instead of user_id", async () => {
    rateLimitState.countOverride = 0
    const result = await submitFeedback(valid, { userId: null, ipPrefix: "10.0.0.0" })
    expect(result.ok).toBe(true)
    const row = rateLimitState.insertedRows[0]!
    expect(row["user_id"]).toBeNull()
    expect(row["caller_ip_prefix"]).toBe("10.0.0.0")
  })

  it("rejects with 400 on validation failure (short title)", async () => {
    const result = await submitFeedback({ ...valid, title: "ab" }, { userId: "u-1", ipPrefix: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
    }
    expect(rateLimitState.insertedRows).toHaveLength(0)
  })

  it("rejects with 429 when rate limit exceeded, includes retryAfterSeconds", async () => {
    rateLimitState.countOverride = 10
    const result = await submitFeedback(valid, { userId: "u-1", ipPrefix: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(429)
      expect(result.retryAfterSeconds).toBe(3600)
    }
    expect(rateLimitState.insertedRows).toHaveLength(0)
  })

  it("rejects screenshot attempt before checking rate limit (cheap reject first)", async () => {
    rateLimitState.countOverride = 100 // would also fail rate limit if reached
    const result = await submitFeedback(
      { ...valid, screenshot: "data:image/png;base64,..." },
      { userId: "u-1", ipPrefix: null },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toMatch(/screenshot/)
    }
  })

  it("persists context JSONB exactly as provided (replay_id, cardId, etc.)", async () => {
    rateLimitState.countOverride = 0
    const ctx = {
      cardId: "elsa-spirit-of-winter",
      gameSeed: 12345,
      replay_id: "11111111-2222-3333-4444-555555555555",
      turnNumber: 7,
    }
    await submitFeedback({ ...valid, type: "card_issue", context: ctx }, { userId: "u-1", ipPrefix: null })
    const row = rateLimitState.insertedRows[0]!
    expect(row["context"]).toEqual(ctx)
    expect(row["type"]).toBe("card_issue")
  })

  it("returns 400 + error message on insert failure (DB write rejected)", async () => {
    rateLimitState.countOverride = 0
    rateLimitState.insertError = { message: "constraint violation" }
    const result = await submitFeedback(valid, { userId: "u-1", ipPrefix: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toMatch(/Failed to record/)
    }
  })
})
