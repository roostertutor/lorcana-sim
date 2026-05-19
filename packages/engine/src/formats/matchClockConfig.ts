// =============================================================================
// MATCH CLOCK CONFIG — per-match-format clock parameters (display-relevant).
//
// Lives in engine/formats (not server) so BOTH the server's chess-clock state
// machine (server/src/services/matchClock.ts) AND the UI (pre-game clock-info
// label on the lobby) can read the same source of truth. Per CLAUDE.md
// package boundaries: ui imports analytics → engine only; server imports
// engine. Shared values therefore live here.
//
// Only the *constants* live here — the runtime state machine
// (initialClockState, applyActionTick, checkTimeout, projectClockForDisplay,
// …) stays in server/src/services/matchClock.ts because its dependencies
// (wall-clock, Supabase row marshalling) are server-side. server's matchClock
// re-exports `MATCH_CLOCK_CONFIG` from here so existing import sites keep
// working unchanged.
// =============================================================================

/** Match formats with distinct clock configurations. Constructed bo1 and bo3
 *  currently share the same per-game config — bo3 just resets the bank
 *  between games (handled by createNewGame, not here). Limited formats will
 *  likely want different values when they ship. */
export type MatchFormat = "bo1" | "bo3"

export interface ClockConfig {
  /** Starting time bank per player per game, in milliseconds. */
  readonly bankMs: number
  /** Fischer-style increment added to a player's bank when their turn begins,
   *  in milliseconds. */
  readonly incrementMs: number
  /** Per-player disconnect grace budget per game, in milliseconds.
   *  Ratcheted across multiple disconnects — reconnect pauses the grace
   *  countdown but does not refill it. */
  readonly graceMs: number
  /** Wall-clock duration (ms) without a heartbeat before a player is treated
   *  as disconnected. Set conservatively higher than the client's ping
   *  interval (10s) to tolerate brief network blips. */
  readonly heartbeatTimeoutMs: number
}

/** Per-match-format clock parameters. Brainstorm-doc-derived defaults:
 *  25-min bank + 75s Fischer increment + 3-min disconnect grace + 30s
 *  heartbeat tolerance. Held in a registry rather than a flat config so a
 *  future Limited format can override without touching the read sites. */
export const MATCH_CLOCK_CONFIG: Readonly<Record<MatchFormat, ClockConfig>> = {
  bo1: {
    bankMs: 25 * 60_000,
    incrementMs: 75_000,
    graceMs: 3 * 60_000,
    heartbeatTimeoutMs: 30_000,
  },
  bo3: {
    bankMs: 25 * 60_000,
    incrementMs: 75_000,
    graceMs: 3 * 60_000,
    heartbeatTimeoutMs: 30_000,
  },
}

/** Render a clock config as a short human-readable label used pre-game
 *  ("25 min bank + 75s per turn"). Subtle competitive-context label — the
 *  shape mirrors chess.com's "{bank}+{increment}" convention but spelled out
 *  for users new to chess-clock games. Both server and ui call this so the
 *  wording stays consistent everywhere. */
export function formatClockConfigLabel(config: ClockConfig): string {
  const bankMin = Math.round(config.bankMs / 60_000)
  const incSec = Math.round(config.incrementMs / 1000)
  return `${bankMin} min bank + ${incSec}s per turn`
}
