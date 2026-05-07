// =============================================================================
// AUTH SERVICE TESTS — username / display_name split (Discord model)
//
// Covers the 2026-05-05 Discord-style split landing the new mutable
// `display_name` column alongside the stable `username` handle.
// See docs/HANDOFF.md → "username / display_name split (Discord model)".
//
// Coverage:
//   - getOrCreateProfile seeds display_name = username on creation
//   - getOrCreateProfile returns the existing row unchanged on subsequent calls
//   - updateDisplayName: accepts valid input, trims whitespace, persists,
//     returns the updated row
//   - updateDisplayName rejection paths: non-string, empty, all-whitespace,
//     too-long (>32 post-trim)
//
// Same hand-rolled in-memory Supabase double pattern as
// lobbyService.test.ts / matchmakingService.test.ts.
// =============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest"

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
  profiles: new MockTable(),
}

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }

function applyFilters(rows: SupabaseRow[], filters: Filter[]): SupabaseRow[] {
  return rows.filter((row) => {
    for (const f of filters) {
      switch (f.kind) {
        case "eq":
          if (row[f.column] !== f.value) return false
          break
        case "in":
          if (!f.values.includes(row[f.column])) return false
          break
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
  shouldReturnSingle = false

  constructor(table: MockTable) {
    this.table = table
  }
  select(_cols?: string) {
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
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value })
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values })
    return this
  }
  single() {
    this.shouldReturnSingle = true
    return this.execute()
  }
  then<T>(onFulfilled?: (v: { data: unknown; error: unknown }) => T | PromiseLike<T>): PromiseLike<T> {
    return this.execute().then(onFulfilled as never)
  }
  async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.mode === "insert") {
      const arr = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload!]
      const enriched: SupabaseRow[] = arr.map((p) => ({
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
      if (this.shouldReturnSingle) {
        if (matches.length === 0) return { data: null, error: { code: "PGRST116", message: "not found" } }
        return { data: matches[0], error: null }
      }
      return { data: matches, error: null }
    }
    const result = applyFilters(this.table.rows, this.filters)
    if (this.shouldReturnSingle) {
      if (result.length === 0) return { data: null, error: { code: "PGRST116", message: "not found" } }
      return { data: result[0], error: null }
    }
    return { data: result, error: null }
  }
}

const mockSupabase = {
  from(name: string): Chain {
    const t = (tables as Record<string, MockTable>)[name]
    if (!t) throw new Error(`Mock has no table "${name}"`)
    return new Chain(t)
  },
}

vi.mock("../db/client.js", () => ({ supabase: mockSupabase }))

let mod: typeof import("./authService.js")

beforeEach(async () => {
  for (const t of Object.values(tables)) t.reset()
  vi.resetModules()
  mod = await import("./authService.js")
})

// ── getOrCreateProfile ─────────────────────────────────────────────────────

describe("getOrCreateProfile — display_name seeding", () => {
  it("seeds display_name equal to username on first creation", async () => {
    const profile = await mod.getOrCreateProfile("user-uuid-1", "alice")
    expect(profile.username).toBe("alice")
    expect(profile.display_name).toBe("alice")
    expect(tables.profiles.rows.length).toBe(1)
    expect(tables.profiles.rows[0]!.display_name).toBe("alice")
  })

  it("seeds display_name from the generated fallback name when no username provided", async () => {
    const profile = await mod.getOrCreateProfile("abcdef0123456789-uuid")
    // Generated as `player_${userId.slice(0, 8)}`
    const expected = "player_abcdef01"
    expect(profile.username).toBe(expected)
    expect(profile.display_name).toBe(expected)
  })

  it("returns the existing row unchanged on subsequent calls (no display_name overwrite)", async () => {
    // Pre-seed an existing profile with a customized display_name.
    tables.profiles.rows.push({
      id: "user-uuid-1",
      username: "alice",
      display_name: "Alice the Magnificent",
    })
    const profile = await mod.getOrCreateProfile("user-uuid-1", "alice")
    expect(profile.display_name).toBe("Alice the Magnificent")
    // Insertion did not happen — only the one pre-seeded row remains.
    expect(tables.profiles.rows.length).toBe(1)
  })
})

// ── updateDisplayName ──────────────────────────────────────────────────────

describe("updateDisplayName — validation", () => {
  beforeEach(() => {
    tables.profiles.rows.push({
      id: "user-uuid-1",
      username: "alice",
      display_name: "alice",
    })
  })

  it("accepts a valid display name and persists trimmed value", async () => {
    const r = await mod.updateDisplayName("user-uuid-1", "  Alice the Magnificent  ")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.profile.display_name).toBe("Alice the Magnificent")
    expect(tables.profiles.rows[0]!.display_name).toBe("Alice the Magnificent")
  })

  it("accepts a 32-char display name (boundary)", async () => {
    const longName = "x".repeat(32)
    const r = await mod.updateDisplayName("user-uuid-1", longName)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.profile.display_name).toBe(longName)
  })

  it("accepts a 1-char display name (boundary)", async () => {
    const r = await mod.updateDisplayName("user-uuid-1", "z")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.profile.display_name).toBe("z")
  })

  it("rejects non-string input with 400", async () => {
    const r = await mod.updateDisplayName("user-uuid-1", 42)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/string/i)
    }
    // No mutation on rejection.
    expect(tables.profiles.rows[0]!.display_name).toBe("alice")
  })

  it("rejects null input with 400", async () => {
    const r = await mod.updateDisplayName("user-uuid-1", null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it("rejects empty string with 400", async () => {
    const r = await mod.updateDisplayName("user-uuid-1", "")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/empty|whitespace/i)
    }
  })

  it("rejects all-whitespace input with 400 (post-trim length 0)", async () => {
    const r = await mod.updateDisplayName("user-uuid-1", "   \t  \n  ")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/empty|whitespace/i)
    }
    // No mutation on rejection.
    expect(tables.profiles.rows[0]!.display_name).toBe("alice")
  })

  it("rejects strings longer than 32 chars post-trim with 400", async () => {
    const tooLong = "x".repeat(33)
    const r = await mod.updateDisplayName("user-uuid-1", tooLong)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/32/)
    }
  })

  it("counts length AFTER trim — 30 chars + leading/trailing spaces is fine", async () => {
    const value = `  ${"x".repeat(30)}  `
    const r = await mod.updateDisplayName("user-uuid-1", value)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.profile.display_name).toBe("x".repeat(30))
  })

  it("uniqueness is NOT enforced — collisions are allowed (Discord model)", async () => {
    // Pre-seed a second profile with the same display_name.
    tables.profiles.rows.push({
      id: "user-uuid-2",
      username: "bob",
      display_name: "Alice the Magnificent",
    })
    const r = await mod.updateDisplayName("user-uuid-1", "Alice the Magnificent")
    expect(r.ok).toBe(true)
    // Both profiles now share the same display_name.
    const both = tables.profiles.rows.filter((p) => p.display_name === "Alice the Magnificent")
    expect(both.length).toBe(2)
  })
})
