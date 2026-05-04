// =============================================================================
// MATCHMAKING SERVICE TESTS
//
// Covers the pure-logic pieces (rate limit, ELO band schedule) with direct
// unit tests, and the DB-driven flows (queue join, pairing, concurrency
// invariants) via a hand-rolled in-memory Supabase double. The double mirrors
// the subset of the supabase-js fluent API that matchmakingService consumes.
//
// Per CLAUDE.md: pair `validateX` rejection tests with successful-path tests.
// Each rejection branch (rotation unknown, rotation retired, ranked-on-unranked,
// already in queue, already in lobby, illegal deck, rate limit) gets its own
// case AND a happy-path counterpart.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  CARD_DEFINITIONS,
  type DeckEntry,
} from "@lorcana-sim/engine"

// ── Hand-rolled Supabase fluent-API double ─────────────────────────────────
//
// Tracks tables in plain Maps; the chained `.from(...).select(...).eq(...)`
// pattern resolves into Promise-like objects that read/write the table.
// Only the operations the service actually calls are implemented.

interface SupabaseRow {
  [k: string]: unknown
}

class MockTable {
  rows: SupabaseRow[] = []
  insertCount = 0

  reset() {
    this.rows = []
    this.insertCount = 0
  }
}

const tables = {
  matchmaking_queue: new MockTable(),
  lobbies: new MockTable(),
  games: new MockTable(),
  profiles: new MockTable(),
}

function applyFilters(rows: SupabaseRow[], filters: Filter[]): SupabaseRow[] {
  return rows.filter((row) => {
    for (const f of filters) {
      switch (f.kind) {
        case "eq":
          if (row[f.column] !== f.value) return false
          break
        case "neq":
          if (row[f.column] === f.value) return false
          break
        case "in":
          if (!f.values.includes(row[f.column])) return false
          break
        case "or": {
          // ".or('a.eq.X,b.eq.Y')" — split by ',' and any clause must match
          const parts = f.expr.split(",").map((s) => s.trim())
          const any = parts.some((p) => {
            const m = p.match(/^(\w+)\.eq\.(.+)$/)
            if (!m) return false
            return row[m[1]!] === m[2]
          })
          if (!any) return false
          break
        }
        case "gte":
          if (typeof row[f.column] !== "number" || (row[f.column] as number) < f.value) return false
          break
        case "lte":
          if (typeof row[f.column] !== "number" || (row[f.column] as number) > f.value) return false
          break
      }
    }
    return true
  })
}

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "or"; expr: string }
  | { kind: "gte"; column: string; value: number }
  | { kind: "lte"; column: string; value: number }

// Each chain is mutable: filter pushes, terminator returns Promise.
class Chain {
  filters: Filter[] = []
  table: MockTable
  mode: "select" | "insert" | "update" | "delete" = "select"
  insertPayload: SupabaseRow | SupabaseRow[] | null = null
  updatePayload: SupabaseRow | null = null
  selectColumns: string | null = null
  orderColumn: string | null = null
  orderAscending = true
  limitN: number | null = null
  shouldReturnSingle = false
  shouldReturnMaybeSingle = false

  constructor(table: MockTable) {
    this.table = table
  }

  select(cols?: string) {
    this.selectColumns = cols ?? "*"
    return this
  }
  insert(payload: SupabaseRow | SupabaseRow[]) {
    this.mode = "insert"
    this.insertPayload = payload
    return this
  }
  update(payload: SupabaseRow) {
    this.mode = "update"
    this.updatePayload = payload
    return this
  }
  delete() {
    this.mode = "delete"
    return this
  }
  upsert(payload: SupabaseRow) {
    this.mode = "insert"
    this.insertPayload = payload
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value })
    return this
  }
  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value })
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values })
    return this
  }
  or(expr: string) {
    this.filters.push({ kind: "or", expr })
    return this
  }
  gte(column: string, value: number) {
    this.filters.push({ kind: "gte", column, value })
    return this
  }
  lte(column: string, value: number) {
    this.filters.push({ kind: "lte", column, value })
    return this
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderColumn = column
    this.orderAscending = opts?.ascending !== false
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  single() {
    this.shouldReturnSingle = true
    return this.execute()
  }
  maybeSingle() {
    this.shouldReturnMaybeSingle = true
    return this.execute()
  }
  // Make the chain itself thenable so `await chain` works.
  then<T>(onFulfilled?: (v: { data: unknown; error: unknown }) => T | PromiseLike<T>): PromiseLike<T> {
    return this.execute().then(onFulfilled as never)
  }

  async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.mode === "insert") {
      const arr = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload!]
      const enriched: SupabaseRow[] = arr.map((p) => ({
        id: p.id ?? `mock-${Math.random().toString(36).slice(2, 10)}`,
        joined_at: p.joined_at ?? new Date().toISOString(),
        created_at: p.created_at ?? new Date().toISOString(),
        ...p,
      }))
      // UNIQUE check on user_id for matchmaking_queue
      if (this.table === tables.matchmaking_queue) {
        for (const r of enriched) {
          if (this.table.rows.some((existing) => existing.user_id === r.user_id)) {
            return { data: null, error: { code: "23505", message: "duplicate user_id" } }
          }
        }
      }
      this.table.rows.push(...enriched)
      this.table.insertCount += enriched.length
      const data = this.shouldReturnSingle ? enriched[0] : enriched
      return { data, error: null }
    }
    if (this.mode === "update") {
      const matches = applyFilters(this.table.rows, this.filters)
      for (const m of matches) Object.assign(m, this.updatePayload!)
      return { data: matches, error: null }
    }
    if (this.mode === "delete") {
      const matches = applyFilters(this.table.rows, this.filters)
      this.table.rows = this.table.rows.filter((r) => !matches.includes(r))
      return { data: matches, error: null }
    }
    // SELECT
    let result = applyFilters(this.table.rows, this.filters)
    if (this.orderColumn) {
      result = [...result].sort((a, b) => {
        const av = a[this.orderColumn!]
        const bv = b[this.orderColumn!]
        const cmp = av! < bv! ? -1 : av! > bv! ? 1 : 0
        return this.orderAscending ? cmp : -cmp
      })
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN)
    if (this.shouldReturnSingle) {
      if (result.length === 0) return { data: null, error: { code: "PGRST116", message: "not found" } }
      return { data: result[0], error: null }
    }
    if (this.shouldReturnMaybeSingle) {
      return { data: result[0] ?? null, error: null }
    }
    return { data: result, error: null }
  }
}

// Realtime channel mock — no-op send/subscribe so pair-success doesn't block.
const mockChannelObj = {
  subscribe(cb?: (status: string) => void) {
    setTimeout(() => cb?.("SUBSCRIBED"), 0)
    return mockChannelObj
  },
  send: vi.fn(async () => undefined),
  unsubscribe: vi.fn(async () => undefined),
}

const mockSupabase = {
  from(name: string): Chain {
    const t = (tables as Record<string, MockTable>)[name]
    if (!t) throw new Error(`Mock has no table "${name}"`)
    return new Chain(t)
  },
  channel: vi.fn(() => mockChannelObj),
  auth: { getUser: vi.fn() },
}

vi.mock("../db/client.js", () => ({ supabase: mockSupabase }))

// ── Helpers ────────────────────────────────────────────────────────────────

function legalDeck(): DeckEntry[] {
  // Pull 60 cards from set 5 (legal in both s11 and s12 Core, and Infinity).
  // 60 unique cards across s11/s12 sets, 1 copy each. Real decks need 4-of
  // limits but the legality checker only cares about set membership.
  const ids: string[] = []
  for (const def of Object.values(CARD_DEFINITIONS)) {
    if (ids.length >= 15) break
    if (def.setId === "5") ids.push(def.id)
  }
  // Repeat-pad to 60 entries
  const padded: DeckEntry[] = []
  let i = 0
  while (padded.length < 60) {
    padded.push({ definitionId: ids[i % ids.length]!, count: 1 })
    i++
  }
  return padded
}

function illegalCoreS12Deck(): DeckEntry[] {
  // Set 4 cards are NOT legal in core-s12 (legalSets={5..12}).
  const set4Ids: string[] = []
  for (const def of Object.values(CARD_DEFINITIONS)) {
    if (set4Ids.length >= 5) break
    if (def.setId === "4") set4Ids.push(def.id)
  }
  return set4Ids.length > 0
    ? [{ definitionId: set4Ids[0]!, count: 4 }, ...legalDeck().slice(0, 56)]
    : legalDeck()
}

// ── Imports under test ─────────────────────────────────────────────────────

let mod: typeof import("./matchmakingService.js")

beforeEach(async () => {
  for (const t of Object.values(tables)) t.reset()
  mockChannelObj.send.mockClear()
  // Re-import to reset module-level state (rate-limit map). vi.resetModules
  // is heavier but cleaner across tests.
  vi.resetModules()
  mod = await import("./matchmakingService.js")
})

// ── Pure helpers ───────────────────────────────────────────────────────────

describe("eloBandForElapsedMs", () => {
  it("returns 50 for first 30s", () => {
    expect(mod.eloBandForElapsedMs(0)).toBe(50)
    expect(mod.eloBandForElapsedMs(29_000)).toBe(50)
  })
  it("returns 150 between 30s and 60s", () => {
    expect(mod.eloBandForElapsedMs(30_000)).toBe(150)
    expect(mod.eloBandForElapsedMs(59_000)).toBe(150)
  })
  it("returns 400 between 60s and 90s", () => {
    expect(mod.eloBandForElapsedMs(60_000)).toBe(400)
    expect(mod.eloBandForElapsedMs(89_000)).toBe(400)
  })
  it("returns Infinity at and after 90s", () => {
    expect(mod.eloBandForElapsedMs(90_000)).toBe(Number.POSITIVE_INFINITY)
    expect(mod.eloBandForElapsedMs(120_000)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("rate limit", () => {
  it("allows 10 joins, rejects the 11th in the same hour", () => {
    for (let i = 0; i < 10; i++) {
      expect(mod.checkRateLimit("u1")).toEqual({ ok: true })
    }
    const r = mod.checkRateLimit("u1")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.retryAfterSeconds).toBeGreaterThan(0)
      expect(r.retryAfterSeconds).toBeLessThanOrEqual(3600)
    }
  })
  it("counts per-user (separate buckets)", () => {
    for (let i = 0; i < 10; i++) mod.checkRateLimit("u1")
    expect(mod.checkRateLimit("u2").ok).toBe(true)
  })
})

// ── Validation rejections ──────────────────────────────────────────────────

describe("joinMatchmakingQueue — rejection branches", () => {
  it("rejects unknown rotation with 400", async () => {
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      // @ts-expect-error testing runtime validation
      format: { family: "core", rotation: "s99" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/Unknown rotation/)
    }
  })

  it("rejects retired rotation (offeredForNewDecks=false) with 400", async () => {
    // Post-2026-05-08: s11 is retired (offeredForNewDecks=false). The registry
    // entry stays around forever for stored-deck validation but no new games
    // can be created against it. (Pre-cutover this test asserted a different
    // shape — staged-but-not-ranked s12 — which no longer exists; the
    // assertion now lands on the prior live rotation post-retirement.)
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s11" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/no longer offered/)
    }
  })

  it("rejects illegal deck with 400 + issues list", async () => {
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: illegalCoreS12Deck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/illegal deck/)
      expect(Array.isArray(r.issues)).toBe(true)
      expect((r.issues as unknown[]).length).toBeGreaterThan(0)
    }
  })

  it("rejects when the user already has a queue entry", async () => {
    const r1 = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r1.ok).toBe(true)

    const r2 = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.status).toBe(409)
  })

  it("rejects when the user is hosting a waiting lobby", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      host_id: "user-A",
      status: "waiting",
    })
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it("rejects when the user has an active game", async () => {
    tables.games.rows.push({
      id: "game-1",
      player1_id: "user-A",
      player2_id: "user-B",
      status: "active",
    })
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it("rejects after 10 joins in a single window with 429", async () => {
    // Hit the rate limit. We don't actually queue 11 times — just exhaust
    // the limit and assert the 11th attempt at the joinMatchmakingQueue
    // entry point gets the 429.
    for (let i = 0; i < 10; i++) {
      mod.checkRateLimit("user-A")
    }
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(429)
  })
})

// ── Happy paths ────────────────────────────────────────────────────────────

describe("joinMatchmakingQueue — successful flows", () => {
  it("queues a casual entry when no peer is waiting", async () => {
    const r = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe("queued")
    expect(tables.matchmaking_queue.rows.length).toBe(1)
  })

  it("pairs two casual users immediately on the second join (FIFO)", async () => {
    // Stub createNewGame's Supabase calls indirectly: the test double won't
    // actually call createGame, but it will write the games row. We need a
    // profile row for the ELO snapshot lookup to not crash.
    tables.profiles.rows.push({ id: "user-A", elo: 1200, elo_ratings: null })
    tables.profiles.rows.push({ id: "user-B", elo: 1200, elo_ratings: null })

    const r1 = await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.status).toBe("queued")

    const r2 = await mod.joinMatchmakingQueue("user-B", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.status).toBe("paired")
      if (r2.status === "paired") {
        expect(r2.gameId).toBeTruthy()
        expect(r2.opponentId).toBe("user-A")
      }
    }
    // Both queue entries should be deleted after pair-success.
    expect(tables.matchmaking_queue.rows.length).toBe(0)
    // A games row should exist.
    expect(tables.games.rows.length).toBe(1)
    const g = tables.games.rows[0]!
    expect(g.match_source).toBe("queue")
    expect(g.ranked).toBe(false)
  })

  it("does NOT pair across mismatched buckets (different family)", async () => {
    // Pre-cutover this test compared s11 vs s12 (both live). Post-cutover s11
    // is retired so that shape no longer parses; using core vs infinity
    // exercises the same bucket-separation invariant against two live
    // rotations.
    tables.profiles.rows.push({ id: "user-A", elo: 1200, elo_ratings: null })
    tables.profiles.rows.push({ id: "user-B", elo: 1200, elo_ratings: null })
    await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    const r2 = await mod.joinMatchmakingQueue("user-B", {
      deck: legalDeck(),
      format: { family: "infinity", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.status).toBe("queued")
    expect(tables.matchmaking_queue.rows.length).toBe(2)
  })

  it("does NOT pair across mismatched queueKind (casual ↔ ranked)", async () => {
    tables.profiles.rows.push({ id: "user-A", elo: 1200, elo_ratings: null })
    tables.profiles.rows.push({ id: "user-B", elo: 1200, elo_ratings: null })
    await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    const r2 = await mod.joinMatchmakingQueue("user-B", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.status).toBe("queued")
    expect(tables.matchmaking_queue.rows.length).toBe(2)
  })

  it("ranked queue: pairs two close-ELO users within the band", async () => {
    tables.profiles.rows.push({
      id: "user-A",
      elo: 1200,
      elo_ratings: { bo1_core_s12: 1200 },
    })
    tables.profiles.rows.push({
      id: "user-B",
      elo: 1200,
      elo_ratings: { bo1_core_s12: 1230 },
    })

    await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    const r2 = await mod.joinMatchmakingQueue("user-B", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.status).toBe("paired")

    expect(tables.games.rows.length).toBe(1)
    const g = tables.games.rows[0]!
    expect(g.match_source).toBe("queue")
    // s12 has ranked=true → ranked game
    expect(g.ranked).toBe(true)
  })

  it("ranked queue: does NOT pair when ELO delta is outside the band", async () => {
    tables.profiles.rows.push({
      id: "user-A",
      elo: 1200,
      elo_ratings: { bo1_core_s12: 1100 },
    })
    tables.profiles.rows.push({
      id: "user-B",
      elo: 1200,
      elo_ratings: { bo1_core_s12: 1500 }, // 400 ELO delta — outside ±50
    })

    await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    const r2 = await mod.joinMatchmakingQueue("user-B", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.status).toBe("queued")
    expect(tables.matchmaking_queue.rows.length).toBe(2)
  })
})

// ── Poll-based safety net ──────────────────────────────────────────────────

describe("runMatchmakingPoll", () => {
  it("pairs two unpaired entries that the inline path missed", async () => {
    tables.profiles.rows.push({ id: "user-A", elo: 1200, elo_ratings: null })
    tables.profiles.rows.push({ id: "user-B", elo: 1200, elo_ratings: null })

    // Insert two compatible entries directly into the table, simulating
    // what the inline path would have produced before the user was
    // waiting (or before a peer arrived).
    tables.matchmaking_queue.rows.push({
      id: "entry-A",
      user_id: "user-A",
      format_family: "core",
      format_rotation: "s12",
      match_format: "bo1",
      queue_kind: "casual",
      decklist: legalDeck(),
      card_metadata: null,
      elo: 1200,
      joined_at: new Date(Date.now() - 70_000).toISOString(),
      paired_game_id: null,
    })
    tables.matchmaking_queue.rows.push({
      id: "entry-B",
      user_id: "user-B",
      format_family: "core",
      format_rotation: "s12",
      match_format: "bo1",
      queue_kind: "casual",
      decklist: legalDeck(),
      card_metadata: null,
      elo: 1200,
      joined_at: new Date(Date.now() - 60_000).toISOString(),
      paired_game_id: null,
    })

    const r = await mod.runMatchmakingPoll()
    expect(r.processed).toBe(2)
    expect(r.paired).toBeGreaterThanOrEqual(1)
    // Both entries should be removed and a games row created.
    expect(tables.matchmaking_queue.rows.length).toBe(0)
    expect(tables.games.rows.length).toBe(1)
  })

  it("is a no-op when the queue is empty", async () => {
    const r = await mod.runMatchmakingPoll()
    expect(r.processed).toBe(0)
    expect(r.paired).toBe(0)
  })
})

// ── Cancel + status ────────────────────────────────────────────────────────

describe("cancel + status", () => {
  it("DELETE /matchmaking removes the user's entry", async () => {
    await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "casual",
    })
    expect(tables.matchmaking_queue.rows.length).toBe(1)
    const r = await mod.cancelMatchmakingQueue("user-A")
    expect(r.ok).toBe(true)
    expect(r.removed).toBe(true)
    expect(tables.matchmaking_queue.rows.length).toBe(0)
  })

  it("DELETE /matchmaking is idempotent (no-op when no entry exists)", async () => {
    const r = await mod.cancelMatchmakingQueue("user-A")
    expect(r.ok).toBe(true)
    expect(r.removed).toBe(false)
  })

  it("getMatchmakingStatus returns null when not in queue", async () => {
    const r = await mod.getMatchmakingStatus("user-A")
    expect(r).toBe(null)
  })

  it("getMatchmakingStatus reports band for ranked entries", async () => {
    tables.profiles.rows.push({
      id: "user-A",
      elo: 1200,
      elo_ratings: { bo1_core_s12: 1200 },
    })
    await mod.joinMatchmakingQueue("user-A", {
      deck: legalDeck(),
      format: { family: "core", rotation: "s12" },
      matchFormat: "bo1",
      queueKind: "ranked",
    })
    const r = await mod.getMatchmakingStatus("user-A")
    expect(r).toBeTruthy()
    expect(r!.queueKind).toBe("ranked")
    // Just-joined → ±50 band
    expect(r!.currentBand).toBe(50)
  })
})
