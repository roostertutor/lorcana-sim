// =============================================================================
// LOBBY SERVICE TESTS — duels-style middle-screen restructure
//
// Covers the new endpoints landed for the duels-style middle-screen flow
// (2026-05-04, see docs/HANDOFF.md → "duels-style middle-screen lobby
// restructure"):
//   - createLobby (deck arg dropped; format-only commit)
//   - joinLobby (deck arg dropped; flips status to 'lobby', not 'active')
//   - setDeckInLobby (validates against lobby format; rejects illegal decks)
//   - setReadyInLobby (rejects without deck; atomic game-spawn on both ready)
//   - resolveLobbyCode (code → lobbyId lookup for share-link redirect)
//   - getLobbyInfo (privacy-safe; no deck contents in response)
//
// Same hand-rolled in-memory Supabase double pattern as
// matchmakingService.test.ts. Uses the engine for real deck-legality
// validation (no mocks there — the legality check is the load-bearing
// anti-cheat surface for setDeckInLobby).
//
// Per CLAUDE.md: pair `validateX` rejection tests with successful-path
// tests. Each rejection branch (no deck, illegal deck, not in lobby,
// finished lobby, opponent's slot) gets a happy-path counterpart.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  CARD_DEFINITIONS,
  type DeckEntry,
} from "@lorcana-sim/engine"

// ── Hand-rolled Supabase fluent-API double (copied from matchmakingService.test.ts)

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
  lobbies: new MockTable(),
  games: new MockTable(),
  game_actions: new MockTable(),
  profiles: new MockTable(),
  matchmaking_queue: new MockTable(),
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
  then<T>(onFulfilled?: (v: { data: unknown; error: unknown }) => T | PromiseLike<T>): PromiseLike<T> {
    return this.execute().then(onFulfilled as never)
  }
  async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.mode === "insert") {
      const arr = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload!]
      const enriched: SupabaseRow[] = arr.map((p) => ({
        id: p.id ?? `mock-${Math.random().toString(36).slice(2, 10)}`,
        created_at: p.created_at ?? new Date().toISOString(),
        ...p,
      }))
      this.table.rows.push(...enriched)
      this.table.insertCount += enriched.length
      const data = this.shouldReturnSingle ? enriched[0] : enriched
      return { data, error: null }
    }
    if (this.mode === "update") {
      const matches = applyFilters(this.table.rows, this.filters)
      for (const m of matches) Object.assign(m, this.updatePayload!)
      // Mirror Supabase's behavior: chained .select() after update returns the updated rows.
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

// ── Helpers ────────────────────────────────────────────────────────────────

function legalDeck(): DeckEntry[] {
  // Pull cards from set 5 (legal in both s11 and s12 Core, and Infinity).
  const ids: string[] = []
  for (const def of Object.values(CARD_DEFINITIONS)) {
    if (ids.length >= 15) break
    if (def.setId === "5") ids.push(def.id)
  }
  const padded: DeckEntry[] = []
  let i = 0
  while (padded.length < 60) {
    padded.push({ definitionId: ids[i % ids.length]!, count: 1 })
    i++
  }
  return padded
}

function illegalCoreS12Deck(): DeckEntry[] {
  // Set 4 cards aren't legal in core-s12 (legalSets={5..12}).
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

let mod: typeof import("./lobbyService.js")

beforeEach(async () => {
  for (const t of Object.values(tables)) t.reset()
  mockChannelObj.send.mockClear()
  vi.resetModules()
  mod = await import("./lobbyService.js")
})

// ── createLobby ────────────────────────────────────────────────────────────

describe("createLobby — duels-style flow", () => {
  it("creates a lobby with NO deck attached and ready=false", async () => {
    const lobby = await mod.createLobby("user-A", "bo1", { family: "core", rotation: "s12" })
    expect(lobby.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(tables.lobbies.rows.length).toBe(1)
    const row = tables.lobbies.rows[0]!
    // Pre-cutover this would have been the host's deck JSONB; the new
    // contract leaves it null until setDeckInLobby fires.
    expect(row.host_deck).toBeUndefined()
    expect(row.host_id).toBe("user-A")
    expect(row.format).toBe("bo1")
    expect(row.game_format).toBe("core")
    expect(row.game_rotation).toBe("s12")
    // public dropped from the API; UI never sets it now.
    expect(row.public).toBe(false)
  })

  it("rejects an unknown rotation", async () => {
    // Asserting on the throw — route layer catches and surfaces 400.
    await expect(
      // @ts-expect-error testing runtime validation
      mod.createLobby("user-A", "bo1", { family: "core", rotation: "s99" }),
    ).rejects.toThrow(/Unknown rotation/)
  })

  it("rejects when caller has an active game", async () => {
    tables.games.rows.push({ id: "g1", player1_id: "user-A", status: "active" })
    await expect(
      mod.createLobby("user-A", "bo1", { family: "core", rotation: "s12" }),
    ).rejects.toThrow(/active game/)
  })

  it("rejects when caller is in a matchmaking queue", async () => {
    tables.matchmaking_queue.rows.push({ id: "q1", user_id: "user-A" })
    await expect(
      mod.createLobby("user-A", "bo1", { family: "core", rotation: "s12" }),
    ).rejects.toThrow(/QUEUED_ELSEWHERE/)
  })
})

// ── joinLobby ──────────────────────────────────────────────────────────────

describe("joinLobby — duels-style flow", () => {
  it("flips status to 'lobby' (not 'active') and does NOT spawn a game", async () => {
    // Seed a waiting lobby.
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      status: "waiting",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
    })
    const result = await mod.joinLobby("user-B", "ABCDEF")
    expect(result.lobbyId).toBe("lobby-1")
    expect(tables.lobbies.rows[0]!.guest_id).toBe("user-B")
    expect(tables.lobbies.rows[0]!.status).toBe("lobby")
    // No game row spawned at join time — only at both-ready.
    expect(tables.games.rows.length).toBe(0)
  })

  it("rejects joining your own lobby", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      status: "waiting",
    })
    await expect(mod.joinLobby("user-A", "ABCDEF")).rejects.toThrow(/own lobby/)
  })

  it("rejects when the code doesn't exist", async () => {
    await expect(mod.joinLobby("user-A", "NOPE12")).rejects.toThrow(/not found/)
  })
})

// ── setDeckInLobby ─────────────────────────────────────────────────────────

describe("setDeckInLobby", () => {
  function seedLobby(extra: Partial<SupabaseRow> = {}) {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
      host_ready: false,
      guest_ready: false,
      ...extra,
    })
  }

  it("attaches the host's deck and resets host_ready to false on swap", async () => {
    seedLobby({ host_ready: true })
    const r = await mod.setDeckInLobby("user-A", "lobby-1", legalDeck())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.slot).toBe("host")
    expect(tables.lobbies.rows[0]!.host_deck).toBeDefined()
    // Swap implicitly un-readies the player — they must re-acknowledge.
    expect(tables.lobbies.rows[0]!.host_ready).toBe(false)
  })

  it("attaches the guest's deck on the guest_deck column", async () => {
    seedLobby()
    const r = await mod.setDeckInLobby("user-B", "lobby-1", legalDeck())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.slot).toBe("guest")
    expect(tables.lobbies.rows[0]!.guest_deck).toBeDefined()
    expect(tables.lobbies.rows[0]!.host_deck).toBeUndefined()
  })

  it("rejects with 400 when the deck is illegal for the lobby's format", async () => {
    seedLobby()
    const r = await mod.setDeckInLobby("user-A", "lobby-1", illegalCoreS12Deck())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/illegal deck/)
      // Engine returns a structured issues list for the UI to render.
      expect("issues" in r ? r.issues : null).toBeTruthy()
    }
    // Lobby state shouldn't change on rejection.
    expect(tables.lobbies.rows[0]!.host_deck).toBeUndefined()
  })

  it("rejects with 400 when deck is empty", async () => {
    seedLobby()
    const r = await mod.setDeckInLobby("user-A", "lobby-1", [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it("rejects with 403 when caller is not in this lobby", async () => {
    seedLobby()
    const r = await mod.setDeckInLobby("user-C", "lobby-1", legalDeck())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it("rejects with 409 when lobby has already moved to status='active'", async () => {
    seedLobby({ status: "active" })
    const r = await mod.setDeckInLobby("user-A", "lobby-1", legalDeck())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it("rejects with 404 when lobby doesn't exist", async () => {
    const r = await mod.setDeckInLobby("user-A", "nope", legalDeck())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})

// ── setReadyInLobby ────────────────────────────────────────────────────────

describe("setReadyInLobby", () => {
  function seedFullLobby(extra: Partial<SupabaseRow> = {}) {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      host_deck: legalDeck(),
      guest_deck: legalDeck(),
      host_ready: false,
      guest_ready: false,
      status: "lobby",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
      ...extra,
    })
    // Profiles needed for the ELO snapshot call inside createNewGame.
    tables.profiles.rows.push({ id: "user-A", elo: 1200 })
    tables.profiles.rows.push({ id: "user-B", elo: 1200 })
  }

  it("rejects ready=true when caller has no deck attached", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
    })
    const r = await mod.setReadyInLobby("user-A", "lobby-1", true)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/Attach a deck/)
    }
  })

  it("allows ready=false even when no deck attached (un-ready is always legal)", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
    })
    const r = await mod.setReadyInLobby("user-A", "lobby-1", false)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.gameStarted).toBe(false)
  })

  it("toggles ready=true when deck is attached, but does NOT spawn a game alone", async () => {
    seedFullLobby()
    const r = await mod.setReadyInLobby("user-A", "lobby-1", true)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.gameStarted).toBe(false)
    expect(tables.lobbies.rows[0]!.host_ready).toBe(true)
    expect(tables.lobbies.rows[0]!.guest_ready).toBe(false)
    expect(tables.games.rows.length).toBe(0)
    expect(tables.lobbies.rows[0]!.status).toBe("lobby")
  })

  it("atomically spawns the game when both ready + both decks attached", async () => {
    seedFullLobby({ host_ready: true })
    const r = await mod.setReadyInLobby("user-B", "lobby-1", true)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.gameStarted).toBe(true)
      expect(r.gameId).toBeTruthy()
    }
    expect(tables.lobbies.rows[0]!.status).toBe("active")
    expect(tables.games.rows.length).toBe(1)
    const game = tables.games.rows[0]!
    // Anti-collusion: private lobbies are unconditionally unranked.
    expect(game.ranked).toBe(false)
    expect(game.match_source).toBe("private")
  })

  it("rejects with 403 when caller is not in this lobby", async () => {
    seedFullLobby()
    const r = await mod.setReadyInLobby("user-C", "lobby-1", true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it("rejects with 409 when lobby is already active", async () => {
    seedFullLobby({ status: "active" })
    const r = await mod.setReadyInLobby("user-A", "lobby-1", true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })
})

// ── resolveLobbyCode ───────────────────────────────────────────────────────

describe("resolveLobbyCode", () => {
  it("returns the lobbyId for a waiting lobby", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      status: "waiting",
    })
    const r = await mod.resolveLobbyCode("user-stranger", "ABCDEF")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lobbyId).toBe("lobby-1")
  })

  it("returns the lobbyId case-insensitively", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      status: "waiting",
    })
    const r = await mod.resolveLobbyCode("user-stranger", "abcdef")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lobbyId).toBe("lobby-1")
  })

  it("404s on an unknown code", async () => {
    const r = await mod.resolveLobbyCode("user-A", "ZZZZZZ")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it("404s on a finished lobby", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      status: "finished",
    })
    const r = await mod.resolveLobbyCode("user-stranger", "ABCDEF")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it("409s when a stranger tries to resolve a lobby that already has a guest", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
    })
    const r = await mod.resolveLobbyCode("user-stranger", "ABCDEF")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it("allows the existing host to re-resolve their own lobby", async () => {
    // Refresh case: host who navigated away comes back via the share URL.
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
    })
    const r = await mod.resolveLobbyCode("user-A", "ABCDEF")
    expect(r.ok).toBe(true)
  })

  it("allows the existing guest to re-resolve a lobby they're already in", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
    })
    const r = await mod.resolveLobbyCode("user-B", "ABCDEF")
    expect(r.ok).toBe(true)
  })
})

// ── getLobbyInfo ───────────────────────────────────────────────────────────

describe("getLobbyInfo — privacy-safe shape", () => {
  it("returns the lobby snapshot WITHOUT deck contents", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      host_deck: legalDeck(),
      guest_deck: legalDeck(),
      host_ready: true,
      guest_ready: false,
      status: "lobby",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
    })
    tables.profiles.rows.push({ id: "user-A", username: "alice" })
    tables.profiles.rows.push({ id: "user-B", username: "bob" })

    const info = await mod.getLobbyInfo("lobby-1")
    expect(info).not.toBeNull()
    expect(info!.hostHasDeck).toBe(true)
    expect(info!.guestHasDeck).toBe(true)
    expect(info!.hostReady).toBe(true)
    expect(info!.guestReady).toBe(false)
    expect(info!.hostUsername).toBe("alice")
    expect(info!.guestUsername).toBe("bob")
    // Most important assertion — the response shape itself MUST NOT
    // include any deck-content keys. Anti-cheat for the middle screen.
    expect(JSON.stringify(info)).not.toMatch(/host_deck|guest_deck|definitionId/)
  })

  it("reports has-deck=false when slot is empty", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      status: "waiting",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
    })
    tables.profiles.rows.push({ id: "user-A", username: "alice" })
    const info = await mod.getLobbyInfo("lobby-1")
    expect(info).not.toBeNull()
    expect(info!.hostHasDeck).toBe(false)
    expect(info!.guestHasDeck).toBe(false)
    expect(info!.guestId).toBeNull()
    expect(info!.guestUsername).toBeNull()
  })

  it("returns null for a lobby that doesn't exist", async () => {
    const info = await mod.getLobbyInfo("nope")
    expect(info).toBeNull()
  })

  it("includes gameId once status is 'active'", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "active",
      format: "bo1",
      game_format: "core",
      game_rotation: "s12",
    })
    tables.games.rows.push({
      id: "game-1",
      lobby_id: "lobby-1",
      game_number: 1,
    })
    tables.profiles.rows.push({ id: "user-A", username: "alice" })
    tables.profiles.rows.push({ id: "user-B", username: "bob" })

    const info = await mod.getLobbyInfo("lobby-1")
    expect(info).not.toBeNull()
    expect(info!.gameId).toBe("game-1")
    expect(info!.status).toBe("active")
  })
})

// ── cancelLobby ────────────────────────────────────────────────────────────
//
// Permission gate covers both host-cancel and guest-leave on the duels-style
// middle screen — the UI fires the same endpoint for both. Non-members must
// still be rejected with 403.

describe("cancelLobby — host or guest may cancel", () => {
  it("allows the host to cancel and flips status to 'cancelled'", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
    })
    const r = await mod.cancelLobby("user-A", "lobby-1")
    expect(r.ok).toBe(true)
    expect(tables.lobbies.rows[0]!.status).toBe("cancelled")
  })

  it("allows the guest to cancel (Leave lobby on the middle screen)", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
    })
    const r = await mod.cancelLobby("user-B", "lobby-1")
    expect(r.ok).toBe(true)
    expect(tables.lobbies.rows[0]!.status).toBe("cancelled")
  })

  it("rejects a non-member with 403", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "lobby",
    })
    const r = await mod.cancelLobby("user-C", "lobby-1")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(403)
      expect(r.error).toMatch(/host or guest/)
    }
    // Lobby state shouldn't change on rejection.
    expect(tables.lobbies.rows[0]!.status).toBe("lobby")
  })

  it("returns 404 for a lobby that doesn't exist", async () => {
    const r = await mod.cancelLobby("user-A", "nope")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it("rejects with 409 once the lobby is already active", async () => {
    tables.lobbies.rows.push({
      id: "lobby-1",
      code: "ABCDEF",
      host_id: "user-A",
      guest_id: "user-B",
      status: "active",
    })
    const r = await mod.cancelLobby("user-A", "lobby-1")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })
})
