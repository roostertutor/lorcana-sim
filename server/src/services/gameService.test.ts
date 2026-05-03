// =============================================================================
// GAME SERVICE UNIT TESTS
//
// Pure-function coverage for `bumpGamesPlayedByFormat` — the per-format
// games-played counter merge logic that fires from `updateElo` after every
// finished game (both ranked and unranked paths).
//
// The DB-touching paths (updateElo full integration) are out of scope for
// these unit tests — they'd need the full supabase double from
// matchmakingService.test.ts. Instead we cover:
//   1. The starting-from-empty case (fresh profile post-migration)
//   2. The increment-existing-key case (typical ongoing play)
//   3. The default-merge behavior (rows that pre-date the migration's seed)
//   4. Disjoint-bucket isolation (bumping one key doesn't touch others)
//
// Per CLAUDE.md: no module-init DB call, so we don't need to mock the
// supabase client — the function is pure and exported for this purpose.
// =============================================================================

import { describe, expect, it } from "vitest"

// gameService imports db/client.ts at module init, which throws without
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Stub it to a no-op object so
// the module loads cleanly. Same pattern as replayAccess.test.ts.
import { vi } from "vitest"
vi.mock("../db/client.js", () => ({ supabase: {} }))

const { bumpGamesPlayedByFormat } = await import("./gameService.js")

describe("bumpGamesPlayedByFormat", () => {
  it("seeds full 8-key shape from an empty existing map", () => {
    // Simulates a fresh profile row whose JSONB column is `{}` (or null)
    // — we still want every registered key present in the write payload
    // so the row stays in canonical shape.
    const result = bumpGamesPlayedByFormat({}, "bo1_core_s11")
    expect(Object.keys(result).sort()).toEqual([
      "bo1_core_s11",
      "bo1_core_s12",
      "bo1_infinity_s11",
      "bo1_infinity_s12",
      "bo3_core_s11",
      "bo3_core_s12",
      "bo3_infinity_s11",
      "bo3_infinity_s12",
    ])
    expect(result.bo1_core_s11).toBe(1)
    expect(result.bo1_core_s12).toBe(0)
    expect(result.bo3_infinity_s11).toBe(0)
  })

  it("seeds full 8-key shape when existing is null", () => {
    // Defensive — the caller passes `(row.games_played_by_format as ...)`
    // and supabase can return null for missing rows or deleted columns.
    const result = bumpGamesPlayedByFormat(null, "bo3_infinity_s12")
    expect(result.bo3_infinity_s12).toBe(1)
    expect(result.bo1_core_s11).toBe(0)
  })

  it("increments the matching key, leaves siblings untouched", () => {
    const existing = {
      bo1_core_s11: 5,
      bo1_core_s12: 2,
      bo1_infinity_s11: 0,
      bo1_infinity_s12: 0,
      bo3_core_s11: 1,
      bo3_core_s12: 0,
      bo3_infinity_s11: 7,
      bo3_infinity_s12: 0,
    } as const
    const result = bumpGamesPlayedByFormat(existing, "bo3_infinity_s11")
    expect(result.bo3_infinity_s11).toBe(8)
    // Sibling keys must be exactly the input values
    expect(result.bo1_core_s11).toBe(5)
    expect(result.bo1_core_s12).toBe(2)
    expect(result.bo3_core_s11).toBe(1)
  })

  it("merges defaults onto a partial existing map", () => {
    // Pre-migration rows might have `{}` or only some keys. The merge has
    // to fill in zeros for missing keys without clobbering present ones.
    const result = bumpGamesPlayedByFormat({ bo1_core_s11: 3 }, "bo1_core_s12")
    expect(result.bo1_core_s11).toBe(3) // preserved
    expect(result.bo1_core_s12).toBe(1) // newly incremented
    expect(result.bo3_infinity_s12).toBe(0) // filled from default
  })

  it("is referentially safe — does not mutate the input", () => {
    const existing = { bo1_core_s11: 4 }
    const before = { ...existing }
    bumpGamesPlayedByFormat(existing, "bo1_core_s11")
    expect(existing).toEqual(before)
  })

  it("each format key bumps independently across calls", () => {
    // Invariant the write path relies on: bumping bo1_core_s11 then bo3_infinity_s12
    // produces a map where both keys are 1 and others are 0. Caller stages
    // these into successive UPDATEs (one per finished game), so isolation
    // matters.
    let counts: Record<string, number> = {}
    counts = bumpGamesPlayedByFormat(counts, "bo1_core_s11")
    counts = bumpGamesPlayedByFormat(counts, "bo1_core_s11")
    counts = bumpGamesPlayedByFormat(counts, "bo3_infinity_s12")
    expect(counts.bo1_core_s11).toBe(2)
    expect(counts.bo3_infinity_s12).toBe(1)
    expect(counts.bo3_core_s11).toBe(0)
  })
})
