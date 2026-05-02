// =============================================================================
// REPLAY ACCESS-MATRIX TESTS
//
// Phase A anti-cheat fix (2026-04-29): GET /game/:id/replay and GET /replay/:id
// used to return raw { seed, decks, actions } payloads, letting clients
// reconstruct GameState[] locally without applying the per-player filter.
// `decideReplayAccess` is the pure access-control function that gates the new
// per-viewer filtered endpoint. The reconstruction loop + filter are well-
// tested upstream (engine's stateFilter.test.ts has 30+ filter cases); the
// novel logic here is the 4×3 access matrix mapping
//   (caller-relationship × replay-public-flag × requested-perspective) →
// granted-perspective | rejection.
//
// Per CLAUDE.md: "pair validateX rejection tests with successful-path tests."
// Each rejection branch (private + non-player, private + opponent perspective,
// private + neutral perspective) has a happy-path counterpart on the same row.
// =============================================================================

import { describe, expect, it, vi } from "vitest"

// gameService.ts pulls in db/client.ts at module-init, which throws if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing. Stub it for the
// pure-function unit test — same pattern as matchmakingService.test.ts.
// `decideReplayAccess` doesn't touch the DB, but the module-level import chain
// does, so we have to mock to load the module at all.
vi.mock("../db/client.js", () => ({ supabase: {} }))

const { decideReplayAccess } = await import("./gameService.js")
type ReplayAccessInput = Parameters<typeof decideReplayAccess>[0]

const P1_ID = "user-p1-uuid"
const P2_ID = "user-p2-uuid"
const STRANGER_ID = "user-stranger-uuid"

function input(partial: Partial<ReplayAccessInput>): ReplayAccessInput {
  return {
    userId: null,
    p1Id: P1_ID,
    p2Id: P2_ID,
    isPublic: false,
    requested: null,
    ...partial,
  }
}

describe("decideReplayAccess — private replay", () => {
  it("player1 default → own perspective (p1)", () => {
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: false, requested: null }))
    expect(r).toEqual({ ok: true, perspective: "p1" })
  })

  it("player1 explicit p1 → granted", () => {
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: false, requested: "p1" }))
    expect(r).toEqual({ ok: true, perspective: "p1" })
  })

  it("player1 requesting opponent (p2) → 403", () => {
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: false, requested: "p2" }))
    expect(r).toEqual({
      ok: false,
      status: 403,
      error: "Cannot view opponent's perspective on a private replay",
    })
  })

  it("player1 requesting neutral on private → 403", () => {
    // Neutral on a private replay would leak both hands — the player isn't
    // entitled to see their opponent's hand even on their own game.
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: false, requested: "neutral" }))
    expect(r).toEqual({
      ok: false,
      status: 403,
      error: "Cannot view opponent's perspective on a private replay",
    })
  })

  it("player2 default → own perspective (p2)", () => {
    const r = decideReplayAccess(input({ userId: P2_ID, isPublic: false, requested: null }))
    expect(r).toEqual({ ok: true, perspective: "p2" })
  })

  it("player2 requesting p1 → 403", () => {
    const r = decideReplayAccess(input({ userId: P2_ID, isPublic: false, requested: "p1" }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it("non-player authed → 403", () => {
    const r = decideReplayAccess(input({ userId: STRANGER_ID, isPublic: false, requested: null }))
    expect(r).toEqual({ ok: false, status: 403, error: "This replay is private" })
  })

  it("non-player authed requesting p1 → 403 (still private)", () => {
    const r = decideReplayAccess(input({ userId: STRANGER_ID, isPublic: false, requested: "p1" }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it("unauth'd → 401", () => {
    const r = decideReplayAccess(input({ userId: null, isPublic: false, requested: null }))
    expect(r).toEqual({ ok: false, status: 401, error: "Authentication required" })
  })

  it("unauth'd with explicit perspective → 401", () => {
    // Even a non-default request from unauth still needs auth first.
    const r = decideReplayAccess(input({ userId: null, isPublic: false, requested: "neutral" }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })
})

describe("decideReplayAccess — public replay", () => {
  it("player1 default → own perspective", () => {
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: true, requested: null }))
    expect(r).toEqual({ ok: true, perspective: "p1" })
  })

  it("player1 explicit p2 → granted (preview shareable view)", () => {
    // Once the replay is public, BOTH hands are by-design visible to anyone.
    // Letting the owner switch perspectives is just UX, not a leak.
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: true, requested: "p2" }))
    expect(r).toEqual({ ok: true, perspective: "p2" })
  })

  it("player1 explicit neutral → granted", () => {
    const r = decideReplayAccess(input({ userId: P1_ID, isPublic: true, requested: "neutral" }))
    expect(r).toEqual({ ok: true, perspective: "neutral" })
  })

  it("player2 explicit p1 → granted", () => {
    const r = decideReplayAccess(input({ userId: P2_ID, isPublic: true, requested: "p1" }))
    expect(r).toEqual({ ok: true, perspective: "p1" })
  })

  it("non-player authed default → neutral", () => {
    // Non-players have no "own slot" to default to; neutral is the natural
    // default once the replay is public (both hands visible by design).
    const r = decideReplayAccess(input({ userId: STRANGER_ID, isPublic: true, requested: null }))
    expect(r).toEqual({ ok: true, perspective: "neutral" })
  })

  it("non-player authed explicit p1 → granted", () => {
    const r = decideReplayAccess(input({ userId: STRANGER_ID, isPublic: true, requested: "p1" }))
    expect(r).toEqual({ ok: true, perspective: "p1" })
  })

  it("non-player authed explicit p2 → granted", () => {
    const r = decideReplayAccess(input({ userId: STRANGER_ID, isPublic: true, requested: "p2" }))
    expect(r).toEqual({ ok: true, perspective: "p2" })
  })

  it("non-player authed explicit neutral → granted", () => {
    const r = decideReplayAccess(input({ userId: STRANGER_ID, isPublic: true, requested: "neutral" }))
    expect(r).toEqual({ ok: true, perspective: "neutral" })
  })

  it("unauth'd default → neutral", () => {
    // Public replays work in incognito / without a session — the whole point
    // of shareable links. Default to neutral since there's no caller slot.
    const r = decideReplayAccess(input({ userId: null, isPublic: true, requested: null }))
    expect(r).toEqual({ ok: true, perspective: "neutral" })
  })

  it("unauth'd explicit p1 → granted", () => {
    const r = decideReplayAccess(input({ userId: null, isPublic: true, requested: "p1" }))
    expect(r).toEqual({ ok: true, perspective: "p1" })
  })

  it("unauth'd explicit p2 → granted", () => {
    const r = decideReplayAccess(input({ userId: null, isPublic: true, requested: "p2" }))
    expect(r).toEqual({ ok: true, perspective: "p2" })
  })
})
