// =============================================================================
// claimWin TESTS — MP UX Phase 4 (server side of opponent-disconnect win flow)
//
// Covers gameService.claimWin's precondition gate (server-enforced — never
// trust the client) and the full happy-path side effects: outcome_reason=
// "disconnect", winner_id, games.status='finished', state.wonBy='disconnect',
// ELO update routed through the existing updateElo path, and idempotency
// against double-claims / parallel-click races.
//
// Uses the same hand-rolled in-memory Supabase double as lobbyService.test.ts.
// Precondition logic itself (detectDisconnect + checkGraceExhausted) is
// pure-function unit-tested in matchClock.test.ts; this file verifies the
// composition + DB effects.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest"

interface SupabaseRow {
  [k: string]: unknown
}

class MockTable {
  rows: SupabaseRow[] = []
  reset() {
    this.rows = []
  }
}

const tables = {
  lobbies: new MockTable(),
  games: new MockTable(),
  game_actions: new MockTable(),
  profiles: new MockTable(),
  matchmaking_queue: new MockTable(),
  replays: new MockTable(),
}

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "or"; expr: string }

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
          const parts = f.expr.split(",").map((s) => s.trim())
          const any = parts.some((p) => {
            const m = p.match(/^(\w+)\.eq\.(.+)$/)
            if (!m) return false
            return row[m[1]!] === m[2]
          })
          if (!any) return false
          break
        }
      }
    }
    return true
  })
}

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
  upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } | null = null

  constructor(table: MockTable) {
    this.table = table
  }
  select(cols?: string, _opts?: { count?: string }) {
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
  upsert(
    payload: SupabaseRow,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.mode = "insert"
    this.insertPayload = payload
    this.upsertOptions = opts ?? null
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
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderColumn = column
    this.orderAscending = opts?.ascending !== false
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  range(_from: number, _to: number) {
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
  then<T>(onFulfilled?: (v: { data: unknown; error: unknown }) => T | PromiseLike<T>): PromiseLike<T> {
    return this.execute().then(onFulfilled as never)
  }
  async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.mode === "insert") {
      const arr = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload!]
      // Upsert with onConflict — silently skip if a row already exists matching
      // the conflict column. Matches replays.game_id UNIQUE behavior used by
      // saveReplayForGame.
      if (this.upsertOptions?.onConflict && this.upsertOptions?.ignoreDuplicates) {
        const col = this.upsertOptions.onConflict
        const inserted: SupabaseRow[] = []
        for (const p of arr) {
          const existing = this.table.rows.find((r) => r[col] === p[col])
          if (existing) continue
          const row = { id: p.id ?? `mock-${Math.random().toString(36).slice(2, 10)}`, ...p }
          this.table.rows.push(row)
          inserted.push(row)
        }
        return { data: this.shouldReturnSingle ? inserted[0] ?? null : inserted, error: null }
      }
      const enriched: SupabaseRow[] = arr.map((p) => ({
        id: p.id ?? `mock-${Math.random().toString(36).slice(2, 10)}`,
        created_at: p.created_at ?? new Date().toISOString(),
        ...p,
      }))
      this.table.rows.push(...enriched)
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

let mod: typeof import("./gameService.js")

beforeEach(async () => {
  for (const t of Object.values(tables)) t.reset()
  mockChannelObj.send.mockClear()
  vi.resetModules()
  mod = await import("./gameService.js")
})

// ── Helpers ────────────────────────────────────────────────────────────────

/** Seed an in-progress game row + a matching parent lobby + both profiles.
 *  `clockOverrides` lets each test set the disconnect / heartbeat fields
 *  without restating the full chess-clock shape. */
function seedActiveGame(
  clockOverrides: Partial<{
    p1_disconnected_since: Date | null
    p2_disconnected_since: Date | null
    p1_last_heartbeat_at: Date | null
    p2_last_heartbeat_at: Date | null
    p1_grace_remaining_ms: number
    p2_grace_remaining_ms: number
  }> = {},
  extra: Partial<SupabaseRow> = {},
) {
  const now = new Date()
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000)
  tables.lobbies.rows.push({
    id: "lobby-1",
    host_id: "user-A",
    guest_id: "user-B",
    status: "active",
    format: "bo1",
    game_format: "infinity",
    game_rotation: "s12",
  })
  tables.games.rows.push({
    id: "game-1",
    lobby_id: "lobby-1",
    player1_id: "user-A",
    player2_id: "user-B",
    status: "active",
    state: {
      currentPlayer: "player1",
      turnNumber: 3,
      isGameOver: false,
      // minimal viable GameState — claimWin only needs the spread + a few
      // keys, not the full engine init shape.
    },
    match_format: "bo1",
    ranked: false,
    p1_time_remaining_ms: 25 * 60_000,
    p2_time_remaining_ms: 25 * 60_000,
    p1_grace_remaining_ms: 3 * 60_000,
    p2_grace_remaining_ms: 3 * 60_000,
    active_player_since: now,
    p1_last_heartbeat_at: now,
    p2_last_heartbeat_at: fiveMinAgo, // p2 stale by default — most tests want this
    p1_disconnected_since: null,
    p2_disconnected_since: null,
    ...clockOverrides,
    ...extra,
  })
  tables.profiles.rows.push({ id: "user-A", elo: 1200, games_played: 0, games_played_by_format: {} })
  tables.profiles.rows.push({ id: "user-B", elo: 1200, games_played: 0, games_played_by_format: {} })
}

// ── claimWin ───────────────────────────────────────────────────────────────

describe("claimWin — precondition: opponent grace must be exhausted", () => {
  it("rejects with 409 when no one is disconnected", async () => {
    const now = new Date()
    seedActiveGame({
      p1_last_heartbeat_at: now,
      p2_last_heartbeat_at: now, // both fresh — neither disconnected
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(409)
      expect(r.error).toMatch(/disconnected long enough/)
    }
    // Game must remain active — server is the only source of truth.
    expect(tables.games.rows[0]!.status).toBe("active")
    expect(tables.games.rows[0]!.winner_id).toBeUndefined()
  })

  it("rejects with 409 when opponent disconnected but grace not yet exhausted", async () => {
    const now = new Date()
    // p2 disconnected 30s ago — well within the 3-min grace window.
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 30_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(tables.games.rows[0]!.status).toBe("active")
  })

  it("rejects with 409 when the CALLER (not opponent) is the grace-exhausted player", async () => {
    // user-A's heartbeat is ancient AND already disconnected long enough —
    // they shouldn't be able to claim the win on their own disconnect.
    const now = new Date()
    seedActiveGame({
      p1_disconnected_since: new Date(now.getTime() - 5 * 60_000), // 5 min ago > 3 min grace
      p2_disconnected_since: null,
      p1_last_heartbeat_at: new Date(now.getTime() - 5 * 60_000),
      p2_last_heartbeat_at: now,
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    // Game still active — caller doesn't get to forfeit themselves.
    expect(tables.games.rows[0]!.status).toBe("active")
  })

  it("allows when opponent's grace IS exhausted", async () => {
    const now = new Date()
    // p2 disconnected 4 min ago — well past the 3-min grace.
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.winnerId).toBe("user-A")
    }
  })

  it("detects late disconnects: opponent went stale > heartbeat timeout, never had detectDisconnect run", async () => {
    // p2 hasn't pinged for 5 minutes but pX_disconnected_since is still null
    // because no GET /game ran in that window. claimWin should still flip
    // them to disconnected (via detectDisconnect) and then check grace.
    const now = new Date()
    seedActiveGame({
      p2_disconnected_since: null,
      p2_last_heartbeat_at: new Date(now.getTime() - 5 * 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.winnerId).toBe("user-A")
  })
})

describe("claimWin — server-enforced auth + status gates", () => {
  it("rejects with 404 when game doesn't exist", async () => {
    const r = await mod.claimWin("nope", "user-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it("rejects with 403 when caller is not a player in this game", async () => {
    seedActiveGame()
    const r = await mod.claimWin("game-1", "user-C")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it("rejects on a legacy untimed game (null clock columns)", async () => {
    // Legacy rows pre-date the chess-clock rollout — readClockFromRow returns
    // null when p1_time_remaining_ms is null. claim-win isn't available there.
    seedActiveGame({}, { p1_time_remaining_ms: null })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(409)
      expect(r.error).toMatch(/legacy/)
    }
  })
})

describe("claimWin — happy path side effects", () => {
  it("sets games.status='finished', winner_id=caller, outcome_reason='disconnect'", async () => {
    const now = new Date()
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    const game = tables.games.rows[0]!
    expect(game.status).toBe("finished")
    expect(game.winner_id).toBe("user-A")
    expect(game.outcome_reason).toBe("disconnect")
  })

  it("stamps state.wonBy='disconnect' + isGameOver/winner for the Realtime payload", async () => {
    const now = new Date()
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    const state = tables.games.rows[0]!.state as Record<string, unknown>
    expect(state.isGameOver).toBe(true)
    expect(state.winner).toBe("player1")
    expect(state.wonBy).toBe("disconnect")
  })

  it("writes a replay row via saveReplayForGame", async () => {
    const now = new Date()
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    expect(tables.replays.rows.length).toBe(1)
    expect(tables.replays.rows[0]!.game_id).toBe("game-1")
    expect(tables.replays.rows[0]!.winner_player_id).toBe("user-A")
  })

  it("increments games_played for both players (unranked path) without changing ELO", async () => {
    const now = new Date()
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Private lobbies are unconditionally unranked — eloDelta is null.
      expect(r.eloDelta).toBeNull()
    }
    // games_played still bumps for activity tracking even on unranked games.
    const p1 = tables.profiles.rows.find((r) => r.id === "user-A")!
    const p2 = tables.profiles.rows.find((r) => r.id === "user-B")!
    expect(p1.games_played).toBe(1)
    expect(p2.games_played).toBe(1)
  })

  it("runs ELO update + returns eloDelta for ranked games", async () => {
    const now = new Date()
    seedActiveGame(
      {
        p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
        p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
      },
      { ranked: true },
    )
    // Add starting ELO ratings so updateElo has values to read.
    const p1 = tables.profiles.rows.find((r) => r.id === "user-A")!
    const p2 = tables.profiles.rows.find((r) => r.id === "user-B")!
    p1.elo_ratings = { bo1_infinity_s12: 1200 }
    p2.elo_ratings = { bo1_infinity_s12: 1200 }
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(true)
    if (r.ok && r.eloDelta) {
      // Winner gets +K*expected; equal starting ratings means +16 / -16 with K=32.
      expect(r.eloDelta.p1.delta).toBeGreaterThan(0)
      expect(r.eloDelta.p2.delta).toBeLessThan(0)
      expect(r.eloDelta.eloKey).toBe("bo1_infinity_s12")
    }
  })
})

describe("claimWin — idempotency", () => {
  it("returns the existing winner on a re-claim against an already-finished game", async () => {
    const now = new Date()
    seedActiveGame({
      p2_disconnected_since: new Date(now.getTime() - 4 * 60_000),
      p2_last_heartbeat_at: new Date(now.getTime() - 4 * 60_000),
    })
    // First call wins.
    const r1 = await mod.claimWin("game-1", "user-A")
    expect(r1.ok).toBe(true)
    // Second call sees status='finished' and returns the existing winner —
    // no error, no second ELO update.
    const profileBefore = JSON.stringify(tables.profiles.rows.find((r) => r.id === "user-A"))
    const r2 = await mod.claimWin("game-1", "user-A")
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.winnerId).toBe("user-A")
      // eloDelta is null on idempotent re-claim — the original call already
      // wrote the delta; we don't double-apply.
      expect(r2.eloDelta).toBeNull()
    }
    const profileAfter = JSON.stringify(tables.profiles.rows.find((r) => r.id === "user-A"))
    expect(profileAfter).toBe(profileBefore)
  })

  it("rejects with 409 on a finished game that somehow has no winner_id (defensive)", async () => {
    // Defensive corner case — finished row without a winner_id (shouldn't
    // happen for a properly finalized game). Caller shouldn't think they
    // won when no one did.
    tables.games.rows.push({
      id: "game-1",
      player1_id: "user-A",
      player2_id: "user-B",
      status: "finished",
      winner_id: null,
    })
    const r = await mod.claimWin("game-1", "user-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })
})
