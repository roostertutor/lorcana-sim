// =============================================================================
// MATCH CLOCK UNIT TESTS
//
// Pure-function coverage for the server-side chess clock + disconnect grace
// state machine. The functions in matchClock.ts are deterministic (clock +
// time in, clock out) so we exercise every branch without any DB or HTTP
// scaffolding — same philosophy as gameService.test.ts → bumpGamesPlayedByFormat.
//
// Coverage:
//   - initialClockState — sets up bank, grace, activePlayerSince, heartbeats.
//   - applyActionTick — decrement + Fischer increment on turn flip, no
//     increment on pendingChoice-only flip, no decrement during disconnect.
//   - checkTimeout — fires when active bank exhausted, no-op when paused.
//   - applyHeartbeat — resets last_heartbeat, clears disconnect + ratchets
//     grace by disconnect duration.
//   - detectDisconnect — flags disconnect at heartbeat_at + heartbeatTimeoutMs
//     (not at `now`), is idempotent for already-disconnected players.
//   - checkGraceExhausted — fires when disconnect-elapsed ≥ grace remaining.
//   - projectClockForDisplay — read-only countdown for UI; mirrors the live
//     state without mutating.
// =============================================================================

import { describe, expect, it } from "vitest"
import {
  applyActionTick,
  applyHeartbeat,
  checkGraceExhausted,
  checkTimeout,
  detectDisconnect,
  initialClockState,
  MATCH_CLOCK_CONFIG,
  projectClockForDisplay,
  type ClockState,
} from "./matchClock.js"

const cfg = MATCH_CLOCK_CONFIG.bo1
const t0 = new Date("2026-05-18T12:00:00Z")
const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs)

describe("initialClockState", () => {
  it("sets banks to bankMs, grace to graceMs, activePlayerSince+heartbeats to now", () => {
    const s = initialClockState(cfg, t0)
    expect(s.p1TimeRemainingMs).toBe(cfg.bankMs)
    expect(s.p2TimeRemainingMs).toBe(cfg.bankMs)
    expect(s.p1GraceRemainingMs).toBe(cfg.graceMs)
    expect(s.p2GraceRemainingMs).toBe(cfg.graceMs)
    expect(s.activePlayerSince).toEqual(t0)
    expect(s.p1LastHeartbeatAt).toEqual(t0)
    expect(s.p2LastHeartbeatAt).toEqual(t0)
    expect(s.p1DisconnectedSince).toBeNull()
    expect(s.p2DisconnectedSince).toBeNull()
  })
})

describe("applyActionTick — decrement", () => {
  it("subtracts elapsed from old decision player's bank, resets activePlayerSince to now", () => {
    const before = initialClockState(cfg, t0)
    // 10s of thinking time, then p1 acts and turn flips to p2.
    // p1's bank: bankMs - 10s. p2's bank: bankMs + Fischer increment (turn started).
    const after = applyActionTick(before, "player1", "player2", "player1", "player2", cfg, at(10_000))
    expect(after.p1TimeRemainingMs).toBe(cfg.bankMs - 10_000)
    expect(after.p2TimeRemainingMs).toBe(cfg.bankMs + cfg.incrementMs)
    expect(after.activePlayerSince).toEqual(at(10_000))
  })

  it("does NOT add increment when only the pendingChoice flips (Sudden Chill case)", () => {
    // Canonical decision-player-vs-current-player split: p1 plays an effect
    // (e.g. Sudden Chill — "Each opponent chooses and discards a card") that
    // surfaces a pendingChoice for p2 to resolve. Decision player flipped
    // p1→p2 but state.currentPlayer stayed p1 (it's still p1's turn). No
    // Fischer increment — increment is per real turn flip, not per
    // pendingChoice flip. Standard chess-clock convention: whoever owes the
    // next input pays the time, regardless of whose turn it is.
    //
    // Other cards in this class: Sleep of Death, Be Prepared (discard prompts);
    // Cinderella Stouthearted, Wendy Authority on Peter Pan (opponent-reveal
    // chains); any triggered on-play response that needs an opponent choice.
    const before = initialClockState(cfg, t0)
    const after = applyActionTick(before, "player1", "player2", "player1", "player1", cfg, at(5_000))
    expect(after.p1TimeRemainingMs).toBe(cfg.bankMs - 5_000) // p1 billed for time to play Sudden Chill
    expect(after.p2TimeRemainingMs).toBe(cfg.bankMs) // no increment — not a real turn flip
    expect(after.activePlayerSince).toEqual(at(5_000)) // p2's clock starts ticking now
  })

  it("Sudden Chill round trip: p1 plays it (p1 billed), p2 picks discard (p2 billed), back to p1", () => {
    // Full two-action sequence for the Sudden Chill pattern. Verifies both
    // halves of the decision-player handoff bill the correct player without
    // any Fischer increment (no real turn flip throughout).
    let clock = initialClockState(cfg, t0)

    // p1 thinks for 8s, then plays Sudden Chill → surfaces pendingChoice for p2
    clock = applyActionTick(clock, "player1", "player2", "player1", "player1", cfg, at(8_000))
    expect(clock.p1TimeRemainingMs).toBe(cfg.bankMs - 8_000)
    expect(clock.p2TimeRemainingMs).toBe(cfg.bankMs) // p2 has not been on the clock

    // p2 thinks for 12s about which card to discard, then RESOLVE_CHOICE
    clock = applyActionTick(clock, "player2", "player1", "player1", "player1", cfg, at(20_000))
    expect(clock.p1TimeRemainingMs).toBe(cfg.bankMs - 8_000) // p1 untouched during p2's decision
    expect(clock.p2TimeRemainingMs).toBe(cfg.bankMs - 12_000) // p2 billed for the discard pick

    // p1 still has the turn — no Fischer increment fired anywhere in this sequence
    expect(clock.activePlayerSince).toEqual(at(20_000)) // p1's clock resumes
  })

  it("always re-anchors activePlayerSince after deduction (prevents double-counting on next action)", () => {
    // Even when neither decision player nor currentPlayer changes (intra-
    // pendingChoice step), activePlayerSince advances to `now` because we
    // just consumed the elapsed window into the bank deduction. Re-using the
    // old anchor on the next action would charge that span twice.
    const before = initialClockState(cfg, t0)
    const after = applyActionTick(before, "player1", "player1", "player1", "player1", cfg, at(3_000))
    expect(after.p1TimeRemainingMs).toBe(cfg.bankMs - 3_000)
    expect(after.activePlayerSince).toEqual(at(3_000))
    // Second tick at t+5s should only deduct the marginal 2s, not all 5s.
    const after2 = applyActionTick(after, "player1", "player1", "player1", "player1", cfg, at(5_000))
    expect(after2.p1TimeRemainingMs).toBe(cfg.bankMs - 5_000)
  })

  it("Fischer increment on real turn flip — p2→p1 gives p1 the increment", () => {
    const before = initialClockState(cfg, t0)
    const after = applyActionTick(before, "player2", "player1", "player2", "player1", cfg, at(20_000))
    expect(after.p1TimeRemainingMs).toBe(cfg.bankMs + cfg.incrementMs)
    expect(after.p2TimeRemainingMs).toBe(cfg.bankMs - 20_000)
  })
})

describe("applyActionTick — disconnect pauses decrement", () => {
  it("does NOT decrement either bank while either player is disconnected", () => {
    const base = initialClockState(cfg, t0)
    const disconnected: ClockState = { ...base, p2DisconnectedSince: at(1_000) }
    // 10s elapsed total but p2 was DCed for 9s of it. With anyone disconnected,
    // the bank should not decrement at all (paused).
    const after = applyActionTick(disconnected, "player1", "player1", "player1", "player1", cfg, at(10_000))
    expect(after.p1TimeRemainingMs).toBe(cfg.bankMs)
    expect(after.p2TimeRemainingMs).toBe(cfg.bankMs)
  })
})

describe("checkTimeout", () => {
  it("returns null when active bank has time remaining", () => {
    const s = initialClockState(cfg, t0)
    expect(checkTimeout(s, "player1", at(1_000))).toBeNull()
  })

  it("returns the active player when their bank is exhausted", () => {
    const s: ClockState = { ...initialClockState(cfg, t0), p1TimeRemainingMs: 5_000 }
    // 10s elapsed, only 5s in bank → timed out.
    expect(checkTimeout(s, "player1", at(10_000))).toBe("player1")
  })

  it("returns null when paused (anyone disconnected) even if bank looks exhausted", () => {
    const s: ClockState = {
      ...initialClockState(cfg, t0),
      p1TimeRemainingMs: -5_000, // already negative — should still not fire under pause
      p2DisconnectedSince: t0,
    }
    expect(checkTimeout(s, "player1", at(60_000))).toBeNull()
  })

  it("checks the DECISION player (pendingChoice owner), not the action initiator", () => {
    // p1 burned 30s; if we incorrectly checked p2's bank with p1's elapsed,
    // we'd false-positive. Decision player is p2 here.
    const s: ClockState = { ...initialClockState(cfg, t0), p2TimeRemainingMs: 100 }
    expect(checkTimeout(s, "player2", at(30_000))).toBe("player2")
    expect(checkTimeout(s, "player1", at(30_000))).toBeNull() // p1 has plenty
  })
})

describe("applyHeartbeat", () => {
  it("updates lastHeartbeatAt for the heartbeating player only", () => {
    const before = initialClockState(cfg, t0)
    const after = applyHeartbeat(before, "player1", at(10_000))
    expect(after.p1LastHeartbeatAt).toEqual(at(10_000))
    expect(after.p2LastHeartbeatAt).toEqual(t0) // untouched
  })

  it("clears disconnect AND deducts disconnect duration from grace on reconnect", () => {
    const disconnected: ClockState = {
      ...initialClockState(cfg, t0),
      p1DisconnectedSince: at(5_000),
    }
    // p1 was disconnected from t+5s until t+25s (20s); grace should drop by 20s.
    const after = applyHeartbeat(disconnected, "player1", at(25_000))
    expect(after.p1DisconnectedSince).toBeNull()
    expect(after.p1LastHeartbeatAt).toEqual(at(25_000))
    expect(after.p1GraceRemainingMs).toBe(cfg.graceMs - 20_000)
    // p2 untouched
    expect(after.p2GraceRemainingMs).toBe(cfg.graceMs)
  })

  it("grace floor at 0 — long disconnect doesn't push grace negative", () => {
    const disconnected: ClockState = {
      ...initialClockState(cfg, t0),
      p1DisconnectedSince: t0,
      p1GraceRemainingMs: 60_000,
    }
    // Disconnected for 5 minutes — way more than 60s of grace remaining.
    const after = applyHeartbeat(disconnected, "player1", at(5 * 60_000))
    expect(after.p1GraceRemainingMs).toBe(0)
    // (The grace-exhausted check is what would fire forfeit; this just clamps.)
  })
})

describe("detectDisconnect", () => {
  it("flags a player as disconnected when their last heartbeat is older than heartbeatTimeoutMs", () => {
    const before = initialClockState(cfg, t0)
    // Move 31s forward — past the 30s threshold. p1 should be flagged at
    // heartbeat_at + threshold (t+30s), not at `now` (t+31s).
    const after = detectDisconnect(before, at(31_000), cfg)
    expect(after.p1DisconnectedSince).toEqual(at(30_000))
    expect(after.p2DisconnectedSince).toEqual(at(30_000))
  })

  it("does NOT flag a player who heartbeated recently", () => {
    const recent: ClockState = { ...initialClockState(cfg, t0), p1LastHeartbeatAt: at(25_000) }
    const after = detectDisconnect(recent, at(31_000), cfg)
    expect(after.p1DisconnectedSince).toBeNull() // 6s ago — well within 30s
    expect(after.p2DisconnectedSince).toEqual(at(30_000)) // p2 still on t0 heartbeat
  })

  it("idempotent — already-disconnected players keep their original disconnectedSince", () => {
    const longGone: ClockState = {
      ...initialClockState(cfg, t0),
      p1DisconnectedSince: at(30_000),
    }
    const after = detectDisconnect(longGone, at(120_000), cfg)
    expect(after.p1DisconnectedSince).toEqual(at(30_000)) // unchanged
  })
})

describe("checkGraceExhausted", () => {
  it("returns null when no one is disconnected", () => {
    expect(checkGraceExhausted(initialClockState(cfg, t0), at(1_000_000))).toBeNull()
  })

  it("fires when disconnect-elapsed exceeds grace", () => {
    const disconnected: ClockState = {
      ...initialClockState(cfg, t0),
      p1DisconnectedSince: at(1_000),
      p1GraceRemainingMs: 60_000,
    }
    // 60s after disconnect start = grace exhausted exactly
    expect(checkGraceExhausted(disconnected, at(61_000))).toBe("player1")
    expect(checkGraceExhausted(disconnected, at(60_999))).toBeNull() // 999ms short
  })

  it("does not fire when grace is still positive", () => {
    const disconnected: ClockState = {
      ...initialClockState(cfg, t0),
      p1DisconnectedSince: at(1_000),
    }
    // 30s into a 180s grace window — plenty of time left
    expect(checkGraceExhausted(disconnected, at(31_000))).toBeNull()
  })
})

describe("projectClockForDisplay", () => {
  it("shows live countdown for the decision player, frozen value for the inactive player", () => {
    const s = initialClockState(cfg, t0)
    const display = projectClockForDisplay(s, "player1", at(15_000))
    expect(display.p1TimeRemainingMs).toBe(cfg.bankMs - 15_000)
    expect(display.p2TimeRemainingMs).toBe(cfg.bankMs) // frozen
  })

  it("during disconnect: both banks frozen, disconnected player's grace counts down", () => {
    const disconnected: ClockState = {
      ...initialClockState(cfg, t0),
      p1DisconnectedSince: at(5_000),
    }
    const display = projectClockForDisplay(disconnected, "player1", at(35_000))
    expect(display.p1TimeRemainingMs).toBe(cfg.bankMs) // frozen
    expect(display.p2TimeRemainingMs).toBe(cfg.bankMs) // frozen
    expect(display.p1GraceRemainingMs).toBe(cfg.graceMs - 30_000) // counting down
    expect(display.p2GraceRemainingMs).toBe(cfg.graceMs) // untouched
  })

  it("never returns negative — clamps at 0", () => {
    const expired: ClockState = { ...initialClockState(cfg, t0), p1TimeRemainingMs: 5_000 }
    const display = projectClockForDisplay(expired, "player1", at(15_000))
    expect(display.p1TimeRemainingMs).toBe(0) // 5_000 - 15_000 clamped to 0
  })
})

describe("end-to-end clock progression — happy path", () => {
  it("simulates a turn: p1 plays for 30s, passes; p2 plays for 20s, passes", () => {
    let clock = initialClockState(cfg, t0)

    // p1 acts at t+30s (no flip — still p1's turn after first action)
    clock = applyActionTick(clock, "player1", "player1", "player1", "player1", cfg, at(30_000))
    expect(clock.p1TimeRemainingMs).toBe(cfg.bankMs - 30_000)

    // p1 passes turn at t+30s + 0 (instantaneous from prior action — for the test)
    // Actually let's say PASS happens at t+30s+100ms with negligible additional elapsed.
    clock = applyActionTick(clock, "player1", "player2", "player1", "player2", cfg, at(30_100))
    expect(clock.p1TimeRemainingMs).toBe(cfg.bankMs - 30_100)
    expect(clock.p2TimeRemainingMs).toBe(cfg.bankMs + cfg.incrementMs) // got Fischer increment

    // p2 acts at t+50s (20s into their turn) — turn doesn't flip
    clock = applyActionTick(clock, "player2", "player2", "player2", "player2", cfg, at(50_100))
    expect(clock.p2TimeRemainingMs).toBe(cfg.bankMs + cfg.incrementMs - 20_000)

    // p2 passes back to p1
    clock = applyActionTick(clock, "player2", "player1", "player2", "player1", cfg, at(50_200))
    expect(clock.p1TimeRemainingMs).toBe(cfg.bankMs - 30_100 + cfg.incrementMs) // p1 got increment back
  })
})
