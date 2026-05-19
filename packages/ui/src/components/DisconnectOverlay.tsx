// =============================================================================
// DisconnectOverlay — passive overlay when either player is disconnected.
//
// Shown when (clock.p1Disconnected || clock.p2Disconnected) and the game is
// still active. Two variants based on who's offline:
//   - Opponent disconnected → "Opponent disconnected — X:XX before forfeit"
//   - YOU disconnected      → "Reconnecting…"  (rare — the server flagged
//     you while you were briefly offline, but you're seeing this means your
//     network came back enough to fetch state again)
//
// Passive by design — no buttons. The server's lazy grace-exhaustion check
// auto-forfeits when the grace bank runs out (recordHeartbeat / GET game
// drive the detection). Both players see the underlying board through the
// overlay so they can still pan / scroll cards while waiting — spec
// requirement (opponents may want to study the position).
//
// The grace countdown ticks locally at 100ms cadence; server pushes refresh
// the base via the clock snapshot on every heartbeat tick (10s cadence) and
// every action. This is the same prediction pattern as MatchClock.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type { PlayerID } from "@lorcana-sim/engine";
import type { ClockSnapshot } from "../lib/serverApi.js";

interface Props {
  clock: ClockSnapshot | null;
  /** Viewer's player slot — determines whether the overlay shows the
   *  "opponent disconnected" message (we want to know how long until the
   *  opponent forfeits) or the "you disconnected — reconnecting" message
   *  (we briefly went offline and the server flagged us, but we just came
   *  back online enough to render this state). */
  myId: PlayerID;
  /** Game-active gating — overlay hides once the game ends (game-over modal
   *  takes over with the disconnect outcome copy). */
  isGameOver: boolean;
}

function formatGrace(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function DisconnectOverlay({ clock, myId, isGameOver }: Props) {
  const baseRef = useRef<{ p1: number; p2: number; at: number } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (!clock) {
      baseRef.current = null;
      return;
    }
    baseRef.current = {
      p1: clock.p1GraceRemainingMs,
      p2: clock.p2GraceRemainingMs,
      at: Date.now(),
    };
    force((n) => n + 1);
  }, [clock]);

  // Only tick while someone is disconnected — otherwise nothing to count down.
  const anyDisconnected = !!clock && (clock.p1Disconnected || clock.p2Disconnected);
  useEffect(() => {
    if (!anyDisconnected) return;
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [anyDisconnected]);

  if (!clock || !anyDisconnected || isGameOver || !baseRef.current) return null;

  const oppId: PlayerID = myId === "player1" ? "player2" : "player1";
  const meDisconnected = myId === "player1" ? clock.p1Disconnected : clock.p2Disconnected;
  const oppDisconnected = oppId === "player1" ? clock.p1Disconnected : clock.p2Disconnected;

  // Local-predicted grace remaining — disconnected player's grace decrements
  // from the moment they went offline. Server clamps at 0; we mirror that.
  const elapsed = Date.now() - baseRef.current.at;
  const myGraceBase = myId === "player1" ? baseRef.current.p1 : baseRef.current.p2;
  const oppGraceBase = oppId === "player1" ? baseRef.current.p1 : baseRef.current.p2;
  const myGrace = meDisconnected ? Math.max(0, myGraceBase - elapsed) : myGraceBase;
  const oppGrace = oppDisconnected ? Math.max(0, oppGraceBase - elapsed) : oppGraceBase;

  // When BOTH are disconnected (rare — both clients lost connection
  // simultaneously), prioritize showing the opponent's status since the
  // overlay is most useful for "is my opponent coming back" decisions. The
  // viewer's own "reconnecting" state is implicit (they wouldn't be reading
  // an overlay otherwise).
  if (oppDisconnected) {
    return (
      <div
        className="absolute inset-x-0 top-1/3 z-30 pointer-events-none flex justify-center px-4"
        aria-live="polite"
      >
        <div className="pointer-events-auto bg-amber-950/95 border-2 border-amber-500/80 rounded-xl px-5 py-3 shadow-2xl backdrop-blur-sm max-w-sm text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-200 text-xs font-bold uppercase tracking-wider">
              Opponent disconnected
            </span>
          </div>
          <div className="text-amber-100 text-sm">
            <span className="font-mono font-bold text-base tabular-nums">{formatGrace(oppGrace)}</span>
            <span className="text-amber-300/80"> remaining before forfeit</span>
          </div>
        </div>
      </div>
    );
  }

  // Viewer themselves is flagged — usually means the server saw us as stale
  // briefly but we're back. Show a subdued reconnecting indicator.
  if (meDisconnected) {
    return (
      <div
        className="absolute inset-x-0 top-1/3 z-30 pointer-events-none flex justify-center px-4"
        aria-live="polite"
      >
        <div className="pointer-events-auto bg-gray-950/95 border-2 border-gray-600 rounded-xl px-5 py-3 shadow-2xl backdrop-blur-sm max-w-sm text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
            <span className="text-gray-200 text-xs font-bold uppercase tracking-wider">
              Reconnecting…
            </span>
          </div>
          <div className="text-gray-400 text-xs">
            <span className="font-mono font-bold tabular-nums">{formatGrace(myGrace)}</span>
            <span> grace remaining</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
