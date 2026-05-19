// =============================================================================
// MATCH CLOCK — server-side chess clock + disconnect-grace state machine.
//
// Architecturally separate from the engine: the engine is pure
// (state, action) → newState with no wall-clock awareness, which is required
// for deterministic replay / undo / RL training. The clock is layered on top
// in the server, decrementing time banks between `applyAction` calls.
//
// Model (Lorcana-adapted Fischer increment + disconnect pause):
//   - Each player starts with a `bankMs` time bank (default 25 min).
//   - Whoever owes the next input (the "decision player") has their bank
//     ticking. Decision player = pendingChoice.choosingPlayerId if set,
//     otherwise state.currentPlayer.
//   - When the decision player changes due to an action, elapsed time since
//     activePlayerSince is subtracted from the OLD decision player's bank.
//   - When `state.currentPlayer` flips (real turn boundary, not just a
//     pendingChoice in the middle of a turn), the player whose turn just
//     STARTED gets `incrementMs` (default 75s) added to their bank. This is
//     the chess.com convention — increment is added at move start so the
//     player can think with the extra time.
//   - If the decision player's bank reaches ≤ 0 mid-turn, they lose on time.
//
// Disconnect grace:
//   - Clients heartbeat every 10s via POST /game/:id/heartbeat. Server tracks
//     pX_last_heartbeat_at. If now - last_heartbeat > heartbeatTimeoutMs
//     (default 30s — 3 missed pings) the player is treated as disconnected
//     and pX_disconnected_since is set.
//   - While EITHER player is disconnected, BOTH clocks pause (otherwise the
//     connected player gains free think time at the disconnected player's
//     expense — the brainstorm doc's explicit intent). Disconnected player's
//     grace bank decrements instead.
//   - Grace is per-player per-game (default 3 min), ratcheted across
//     disconnects (reconnect doesn't reset grace, just stops it from ticking).
//   - Grace ≤ 0 = auto-forfeit with outcome_reason="disconnect".
//
// All functions here are pure: clock state in, clock state out. The
// gameService.ts integration calls these around `applyAction` and on
// `getGame` for the lazy timeout/disconnect check.
//
// CRD relevance: none. The clock is a tournament-procedural concern (CRD
// §11.x reservoir), not a rules-engine concern.
// =============================================================================

import type { GameState, PlayerID } from "@lorcana-sim/engine"
import { MATCH_CLOCK_CONFIG } from "@lorcana-sim/engine"
import type { MatchFormat, ClockConfig } from "@lorcana-sim/engine"

// MatchFormat + ClockConfig + MATCH_CLOCK_CONFIG live in
// packages/engine/src/formats/matchClockConfig.ts so the UI (which can't
// import from server per CLAUDE.md package boundaries) can read the same
// values for the pre-game clock-info label. Re-exported here so existing
// server import sites (`from "./matchClock.js"`) keep working unchanged.
export { MATCH_CLOCK_CONFIG }
export type { MatchFormat, ClockConfig }

/** Snapshot of every clock-related field on the `games` row. Persisted as
 *  individual columns (not a JSONB blob) so SQL queries on staleness /
 *  timeouts can index efficiently. The shape here mirrors the column set
 *  added in schema.sql `ALTER TABLE games ADD COLUMN p1_time_remaining_ms`
 *  etc.
 *
 *  All Date fields use TIMESTAMPTZ on the DB; we treat null on read as "never
 *  set" rather than "epoch" — both `null` and `undefined` come through from
 *  the supabase JS client depending on whether the column was selected. */
export interface ClockState {
  p1TimeRemainingMs: number
  p2TimeRemainingMs: number
  p1GraceRemainingMs: number
  p2GraceRemainingMs: number
  /** Wall-clock instant when the current decision player's bank started
   *  ticking. Reset on every action that changes the decision player. Null
   *  before the first action (clock hasn't started). */
  activePlayerSince: Date | null
  p1DisconnectedSince: Date | null
  p2DisconnectedSince: Date | null
  p1LastHeartbeatAt: Date | null
  p2LastHeartbeatAt: Date | null
}

/** Build the initial clock state at game creation. activePlayerSince is set
 *  to `now` — the clock starts running the moment the game is created, which
 *  matches both players being on the game-board screen by the time the row
 *  exists. */
export function initialClockState(config: ClockConfig, now: Date): ClockState {
  return {
    p1TimeRemainingMs: config.bankMs,
    p2TimeRemainingMs: config.bankMs,
    p1GraceRemainingMs: config.graceMs,
    p2GraceRemainingMs: config.graceMs,
    activePlayerSince: now,
    p1DisconnectedSince: null,
    p2DisconnectedSince: null,
    p1LastHeartbeatAt: now,
    p2LastHeartbeatAt: now,
  }
}

/** Whoever owes the next input. The clock decrements from this player's bank.
 *  A pendingChoice can hand off the active-clock to the opponent mid-turn
 *  (e.g. opponent has to resolve a triggered ability you forced) without the
 *  state.currentPlayer changing. */
export function getDecisionPlayer(state: GameState): PlayerID {
  return state.pendingChoice ? state.pendingChoice.choosingPlayerId : state.currentPlayer
}

/** True iff EITHER player is currently flagged disconnected. While true, the
 *  time bank does not decrement (both clocks pause); the disconnected
 *  player's grace bank decrements instead. */
function isAnyoneDisconnected(clock: ClockState): boolean {
  return clock.p1DisconnectedSince !== null || clock.p2DisconnectedSince !== null
}

/** Compute how many milliseconds of "active clock time" have elapsed between
 *  `clock.activePlayerSince` and `now`, deducting any disconnect-paused
 *  intervals.
 *
 *  Today this assumes at most one disconnect window contained within the
 *  active-player interval. Multiple overlapping disconnects within a single
 *  active-player interval are rare in practice (most actions land within
 *  seconds), and the failure mode is "disconnected player's clock decrements
 *  slightly when it shouldn't" — a small forgivable inaccuracy compared to
 *  the simpler arithmetic. If this becomes a real issue under sustained
 *  flaky connections, switch to an event-log of disconnect/reconnect pairs
 *  inside the active interval. */
function activeClockElapsedMs(clock: ClockState, now: Date): number {
  if (!clock.activePlayerSince) return 0
  const rawMs = now.getTime() - clock.activePlayerSince.getTime()
  if (rawMs <= 0) return 0

  // Subtract any in-progress disconnect that started AFTER activePlayerSince.
  // (Disconnects that started before activePlayerSince were already "paid for"
  // when the previous action was processed.)
  let pausedMs = 0
  for (const since of [clock.p1DisconnectedSince, clock.p2DisconnectedSince]) {
    if (!since) continue
    const disconnectStart = Math.max(since.getTime(), clock.activePlayerSince.getTime())
    if (disconnectStart >= now.getTime()) continue
    pausedMs += now.getTime() - disconnectStart
  }
  return Math.max(0, rawMs - pausedMs)
}

/** Apply an action's clock effects:
 *   - Subtract elapsed time from the OLD decision player's bank.
 *   - If state.currentPlayer flipped (real turn boundary), add increment to
 *     the player whose turn just started.
 *   - Reset activePlayerSince to `now` (the new decision player's clock
 *     starts ticking from this instant).
 *
 *  Returns the updated ClockState; never mutates the input. */
export function applyActionTick(
  clock: ClockState,
  oldDecisionPlayer: PlayerID,
  newDecisionPlayer: PlayerID,
  oldCurrentPlayer: PlayerID,
  newCurrentPlayer: PlayerID,
  config: ClockConfig,
  now: Date,
): ClockState {
  const elapsed = activeClockElapsedMs(clock, now)

  // Decrement old decision player's bank (only if no one is disconnected —
  // when paused, elapsed is already 0 from the activeClockElapsedMs deduction,
  // but check defensively in case of edge cases like both DCed simultaneously).
  let p1Time = clock.p1TimeRemainingMs
  let p2Time = clock.p2TimeRemainingMs
  if (!isAnyoneDisconnected(clock)) {
    if (oldDecisionPlayer === "player1") p1Time -= elapsed
    else p2Time -= elapsed
  }

  // Fischer increment on real turn flips (not pendingChoice flips).
  // Add to whoever's turn just BEGAN — chess.com convention, gives the new
  // active player some time to think with.
  if (oldCurrentPlayer !== newCurrentPlayer) {
    if (newCurrentPlayer === "player1") p1Time += config.incrementMs
    else p2Time += config.incrementMs
  }

  // Always re-anchor activePlayerSince to `now`. We just consumed the elapsed
  // window into the bank deduction above; the next action's elapsed measures
  // from this instant. Keeping the old anchor would double-count.
  //
  // The "don't reset" idea (intra-step actions against the same decision
  // player) is wrong because the bank already got debited for the elapsed
  // span — re-using the same anchor on the next call would charge that span
  // twice. Disconnect-during-no-action is handled separately: the activePlayerSince
  // stays valid through a disconnect/reconnect pair, and activeClockElapsedMs
  // subtracts the paused interval.
  return {
    ...clock,
    p1TimeRemainingMs: p1Time,
    p2TimeRemainingMs: p2Time,
    activePlayerSince: now,
  }
}

/** Lazy timeout check. Returns the player who has lost on time, or null.
 *
 *  Reads the decision player's bank MINUS the elapsed-since-activePlayerSince
 *  (which may not yet be deducted, since deduction only fires on action
 *  application). This is what makes the check lazy — `GET /game/:id` can
 *  call this without writing, and only persist the timeout outcome if it
 *  fires. */
export function checkTimeout(
  clock: ClockState,
  decisionPlayer: PlayerID,
  now: Date,
): PlayerID | null {
  // If anyone is disconnected, clocks are paused — no timeout fires from
  // bank exhaustion alone. The grace-exhaustion check (separate function)
  // handles disconnect-driven forfeits.
  if (isAnyoneDisconnected(clock)) return null

  const elapsed = activeClockElapsedMs(clock, now)
  const remaining =
    decisionPlayer === "player1"
      ? clock.p1TimeRemainingMs - elapsed
      : clock.p2TimeRemainingMs - elapsed

  return remaining <= 0 ? decisionPlayer : null
}

/** Update the heartbeat timestamp for a player. If they were flagged
 *  disconnected, clear that flag AND decrement their grace bank by the
 *  duration they were disconnected. Pure — never mutates input. */
export function applyHeartbeat(
  clock: ClockState,
  player: PlayerID,
  now: Date,
): ClockState {
  const next: ClockState = { ...clock }

  if (player === "player1") {
    next.p1LastHeartbeatAt = now
    if (clock.p1DisconnectedSince) {
      const wasDisconnectedFor = now.getTime() - clock.p1DisconnectedSince.getTime()
      next.p1GraceRemainingMs = Math.max(0, clock.p1GraceRemainingMs - wasDisconnectedFor)
      next.p1DisconnectedSince = null
    }
  } else {
    next.p2LastHeartbeatAt = now
    if (clock.p2DisconnectedSince) {
      const wasDisconnectedFor = now.getTime() - clock.p2DisconnectedSince.getTime()
      next.p2GraceRemainingMs = Math.max(0, clock.p2GraceRemainingMs - wasDisconnectedFor)
      next.p2DisconnectedSince = null
    }
  }

  return next
}

/** Detect new disconnects based on heartbeat staleness. If a player hasn't
 *  pinged in more than `config.heartbeatTimeoutMs` and isn't already flagged
 *  disconnected, mark them disconnected starting from `last_heartbeat_at +
 *  heartbeatTimeoutMs` (the moment they "officially" went stale, not now —
 *  this keeps grace accounting honest by not penalizing the grace window
 *  for the detection lag).
 *
 *  Returns the updated clock state. No-op when both players are heartbeating
 *  fresh or already-disconnected players stay disconnected (their since
 *  timestamp is not re-set). */
export function detectDisconnect(
  clock: ClockState,
  now: Date,
  config: ClockConfig,
): ClockState {
  const next: ClockState = { ...clock }
  const threshold = now.getTime() - config.heartbeatTimeoutMs

  if (
    next.p1DisconnectedSince === null &&
    next.p1LastHeartbeatAt !== null &&
    next.p1LastHeartbeatAt.getTime() <= threshold
  ) {
    next.p1DisconnectedSince = new Date(next.p1LastHeartbeatAt.getTime() + config.heartbeatTimeoutMs)
  }

  if (
    next.p2DisconnectedSince === null &&
    next.p2LastHeartbeatAt !== null &&
    next.p2LastHeartbeatAt.getTime() <= threshold
  ) {
    next.p2DisconnectedSince = new Date(next.p2LastHeartbeatAt.getTime() + config.heartbeatTimeoutMs)
  }

  return next
}

/** Returns the player whose grace has run out (auto-forfeit), or null.
 *  Grace exhausts when the current disconnect duration exceeds the remaining
 *  grace budget. */
export function checkGraceExhausted(clock: ClockState, now: Date): PlayerID | null {
  if (clock.p1DisconnectedSince) {
    const elapsed = now.getTime() - clock.p1DisconnectedSince.getTime()
    if (elapsed >= clock.p1GraceRemainingMs) return "player1"
  }
  if (clock.p2DisconnectedSince) {
    const elapsed = now.getTime() - clock.p2DisconnectedSince.getTime()
    if (elapsed >= clock.p2GraceRemainingMs) return "player2"
  }
  return null
}

/** Project a clock state forward to a wall-clock instant for client display.
 *  Returns the live ms-remaining values without persisting anything. The
 *  decision player's bank is shown as bank - elapsed (live countdown); the
 *  inactive player's bank is shown as bank (frozen). When anyone is
 *  disconnected, both banks are frozen and the disconnected player's grace
 *  countdown is shown instead.
 *
 *  This is for read-only display computation (UI + GET /game responses) —
 *  callers do not write the projected values back to the row. */
export function projectClockForDisplay(
  clock: ClockState,
  decisionPlayer: PlayerID,
  now: Date,
): {
  p1TimeRemainingMs: number
  p2TimeRemainingMs: number
  p1GraceRemainingMs: number
  p2GraceRemainingMs: number
} {
  let p1Time = clock.p1TimeRemainingMs
  let p2Time = clock.p2TimeRemainingMs
  let p1Grace = clock.p1GraceRemainingMs
  let p2Grace = clock.p2GraceRemainingMs

  if (isAnyoneDisconnected(clock)) {
    if (clock.p1DisconnectedSince) {
      const elapsed = now.getTime() - clock.p1DisconnectedSince.getTime()
      p1Grace = Math.max(0, p1Grace - elapsed)
    }
    if (clock.p2DisconnectedSince) {
      const elapsed = now.getTime() - clock.p2DisconnectedSince.getTime()
      p2Grace = Math.max(0, p2Grace - elapsed)
    }
  } else {
    const elapsed = activeClockElapsedMs(clock, now)
    if (decisionPlayer === "player1") p1Time = Math.max(0, p1Time - elapsed)
    else p2Time = Math.max(0, p2Time - elapsed)
  }

  return {
    p1TimeRemainingMs: p1Time,
    p2TimeRemainingMs: p2Time,
    p1GraceRemainingMs: p1Grace,
    p2GraceRemainingMs: p2Grace,
  }
}
