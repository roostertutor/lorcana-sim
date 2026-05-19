// =============================================================================
// MatchClock — per-player chess-clock badge on the active game board.
//
// Renders MM:SS (or MM:SS.t when the displayed bank dips under 60s) for a
// single player. Reads the server-projected snapshot from useGameSession's
// `clock` field as truth, then layers a smooth local prediction at 100ms
// intervals between server syncs so the active player's countdown ticks
// visually without waiting for the next action.
//
// CRITICAL — decision-player highlight:
//   The decision player is who OWES THE NEXT INPUT, which is:
//     - state.pendingChoice?.choosingPlayerId (when set), else
//     - state.currentPlayer
//   This split is load-bearing — the canonical case is Sudden Chill ("Each
//   opponent chooses and discards a card"). I play it; my turn doesn't end;
//   but the opponent owes the discard, so the OPPONENT'S clock should pulse
//   active (their bank is what's ticking down). See
//   `server/src/services/matchClock.test.ts` → "Sudden Chill round trip" for
//   the canonical test of this behaviour.
//
// Low-time states (decision player only):
//   < 60s → red border + soft pulse (cosmetic warning)
//   < 10s → red filled background + faster pulse + larger numerals
//   The opponent sees the same warning chrome so competitive players can
//   pressure-read the opponent's clock state (standard tournament UX). No
//   audio per CLAUDE.md "no audio" policy.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type { PlayerID } from "@lorcana-sim/engine";
import type { ClockSnapshot } from "../lib/serverApi.js";

interface Props {
  /** Server-projected clock snapshot — null in solo/sandbox or for legacy
   *  pre-clock games (component renders nothing in that case). */
  clock: ClockSnapshot | null;
  /** Whose clock this badge represents. */
  player: PlayerID;
  /** Player who currently owes the next input (decision player). When this
   *  matches `player`, the badge gets the active visual (border pulse +
   *  live countdown ticking). Sudden Chill: while my turn is paused on
   *  opponent's discard choice, decisionPlayer = opponent. */
  decisionPlayer: PlayerID;
  /** When true, lays the badge out from the perspective of "your" side
   *  (slightly larger / green accent). When false, opponent side (red
   *  accent). Purely cosmetic chrome; the active highlight overrides. */
  isMe: boolean;
}

/** Format an ms bank as MM:SS, or MM:SS.t with tenths when under 60s for
 *  active-clock urgency. Clamps to 00:00 for negative values (shouldn't
 *  reach the UI — server clamps on projection — but defensive). */
function formatTime(ms: number, showTenths: boolean): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = clamped / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (showTenths) {
    // toFixed(1) on seconds, then pad. 9.5 → "09.5", 12.3 → "12.3".
    const padded = seconds.toFixed(1).padStart(4, "0");
    return `${String(minutes).padStart(2, "0")}:${padded}`;
  }
  const intSec = Math.floor(seconds);
  return `${String(minutes).padStart(2, "0")}:${String(intSec).padStart(2, "0")}`;
}

export default function MatchClock({ clock, player, decisionPlayer, isMe }: Props) {
  // Track server-sync moment so the local-prediction tick can subtract the
  // right amount of elapsed wall-clock since the last update. We re-anchor
  // whenever the server-pushed `clock` reference changes (every action, every
  // heartbeat) so drift stays bounded by the heartbeat cadence (~10s).
  const baseRef = useRef<{ p1: number; p2: number; at: number } | null>(null);
  const [, force] = useState(0);

  // Re-anchor when the server snapshot changes.
  useEffect(() => {
    if (!clock) {
      baseRef.current = null;
      return;
    }
    baseRef.current = {
      p1: clock.p1TimeRemainingMs,
      p2: clock.p2TimeRemainingMs,
      at: Date.now(),
    };
    force((n) => n + 1);
  }, [clock]);

  // Local-prediction tick. Only the decision player's bank ticks; the
  // inactive player's bank stays at the last server snapshot until the next
  // sync. 100ms cadence is smooth enough for sub-second display under 60s.
  useEffect(() => {
    if (!clock) return;
    // When either player is disconnected, both clocks are paused server-side —
    // freeze the local prediction too so the display matches the server's
    // pause semantics. (Disconnect overlay surfaces the grace countdown.)
    if (clock.p1Disconnected || clock.p2Disconnected) return;
    const t = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [clock, decisionPlayer]);

  if (!clock || !baseRef.current) return null;

  const isActive = decisionPlayer === player;
  const isPaused = clock.p1Disconnected || clock.p2Disconnected;
  // Predicted ms-remaining: server snapshot minus wall-clock elapsed since
  // the snapshot, but only for the active player when no one is disconnected.
  const elapsedSinceAnchor = Date.now() - baseRef.current.at;
  const baseMs = player === "player1" ? baseRef.current.p1 : baseRef.current.p2;
  const predicted = !isPaused && isActive
    ? Math.max(0, baseMs - elapsedSinceAnchor)
    : baseMs;

  const underSixty = predicted < 60_000;
  const underTen = predicted < 10_000;
  const showTenths = underSixty && isActive && !isPaused;

  // Visual layers:
  // - Base: dim grey background, monospaced numerals.
  // - Active (decision player, not paused): brighter, thicker border, soft pulse.
  // - Low-time (< 60s, decision player): red border + slow pulse.
  // - Critical (< 10s, decision player): red filled background + fast pulse + larger digits.
  const sideAccent = isMe ? "text-green-300" : "text-red-300";
  const baseClass = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono tabular-nums leading-none text-xs sm:text-sm transition-colors";

  let stateClass = "bg-gray-900/70 border-gray-800 text-gray-400";
  if (isPaused) {
    // Paused state — show the bank but de-emphasize since the clock isn't
    // running. The DisconnectOverlay surfaces what's actually happening.
    stateClass = "bg-gray-900/70 border-gray-700 text-gray-500 italic";
  } else if (isActive && underTen) {
    stateClass = "bg-red-900/70 border-red-500 text-red-100 animate-pulse shadow-md shadow-red-500/40 text-sm sm:text-base";
  } else if (isActive && underSixty) {
    stateClass = "bg-red-950/50 border-red-700 text-red-200 animate-pulse";
  } else if (isActive) {
    stateClass = isMe
      ? "bg-green-900/40 border-green-500/80 text-green-100 shadow-sm shadow-green-500/30"
      : "bg-red-900/40 border-red-500/80 text-red-100 shadow-sm shadow-red-500/30";
  } else if (underTen) {
    // Inactive player under 10s — show their pressure to the viewer (no pulse).
    stateClass = "bg-red-950/30 border-red-800/60 text-red-300";
  } else if (underSixty) {
    stateClass = "bg-red-950/20 border-red-900/40 text-red-400";
  }

  const label = isMe ? "You" : "Opp";
  const title = isActive
    ? (isPaused ? `${label} clock — paused (opponent disconnected)` : `${label} clock — ticking`)
    : `${label} clock — waiting`;

  return (
    <div
      className={`${baseClass} ${stateClass}`}
      title={title}
      aria-label={`${label} time remaining: ${formatTime(predicted, false)}`}
    >
      <span className={`text-[9px] uppercase tracking-wider font-bold ${sideAccent} opacity-80`}>
        {label}
      </span>
      <span className="font-bold">{formatTime(predicted, showTenths)}</span>
    </div>
  );
}
