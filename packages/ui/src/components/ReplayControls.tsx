// =============================================================================
// ReplayControls — Scrubber + step buttons for replay mode
// Rendered below the game board when reviewing a completed game.
// =============================================================================

import React, { useState, useCallback, useEffect } from "react";
import type { GameState } from "@lorcana-sim/engine";
import type { ReplaySession } from "../hooks/useReplaySession.js";
import { PLAYBACK_SPEEDS } from "../hooks/useReplaySession.js";
import Icon from "./Icon.js";
import InfoToast from "./InfoToast.js";

interface Props {
  session: ReplaySession;
  /** 3e-ii: Fork the current replay position into a live game */
  onTakeOver?: (state: GameState) => void;
  /** When set, the "Take over here" affordance is replaced by a muted
   *  info line stating the reason. Used to block take-over from a
   *  filtered remote-replay perspective (`p1` / `p2` views have the
   *  opponent's hand redacted to `definitionId: "hidden"`, so the
   *  resulting bot opponent would have no playable hand). See the
   *  Decision #8 Lane B follow-up in HANDOFF for context. */
  takeoverBlockedReason?: string;
}

export default function ReplayControls({ session, onTakeOver, takeoverBlockedReason }: Props) {
  const { step, totalSteps, goTo, stepBack, stepForward, isPlaying, togglePlay, playbackSpeed, setPlaybackSpeed, state, turnBoundaries } = session;

  const atStart = step === 0;
  const atEnd = step === totalSteps;

  const speedLabels = ["1x", "1.5x", "3x"] as const;

  // Lane A3: turn-boundary tick marks above the scrub rail. The current turn
  // (whatever turn `state.turnNumber` is on) gets an accent color so viewers
  // can spot where they are. Clicking a tick jumps to that turn's first step.
  // At very short games (≤2 turns) we render nothing — saves a row of empty
  // space. At narrow widths we keep ticks but drop labels (md: gate).
  const currentTurnNumber = state?.turnNumber ?? null;
  const showTicks = totalSteps > 0 && turnBoundaries.length >= 2;

  // Lane A2 of Decision #8: "Copy link to step" affordance. Builds a URL with
  // `?step=N` capturing the current scrubber position and writes to the
  // clipboard. Toast on success (fades after 2.5s). The URL is a one-shot
  // snapshot at copy time, not a live mirror of scrub position — matches the
  // YouTube `?t=42s` mental model (Sub-decision #2 locked option 1).
  //
  // Reuses the existing `InfoToast` (passive top-pill with pulse) for the
  // success message — no new toast infra. If clipboard write fails (rare:
  // user denied permission, or non-secure context), we show a brief
  // gray-themed error instead.
  const [copyToast, setCopyToast] = useState<{ text: string; theme: "yellow" | "gray" } | null>(null);
  useEffect(() => {
    if (!copyToast) return;
    const id = window.setTimeout(() => setCopyToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [copyToast]);

  const copyLinkToStep = useCallback(async () => {
    // Build URL from current location so it works for `/replay/share/:id`,
    // `/replay/:gameId`, and any other replay-viewer route the app gains
    // later. We rewrite the search component entirely to set `step=N` and
    // strip anything else — the only shareable handle in a replay URL is
    // the step (perspective is implicit in the route + caller identity).
    const url = `${window.location.origin}${window.location.pathname}?step=${step}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyToast({ text: `Link copied to step ${step}`, theme: "yellow" });
    } catch {
      // Fallback for non-secure contexts / permission denial: surface the
      // failure rather than swallow it. User can still copy from address
      // bar if they navigate to the URL manually.
      setCopyToast({ text: "Copy failed — clipboard unavailable", theme: "gray" });
    }
  }, [step]);

  return (
    <div className="shrink-0 rounded-xl bg-gray-900/80 border border-gray-700/50 px-3 py-2.5 space-y-2">
      {/* Step info + speed */}
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>Step <span className="text-gray-300 font-mono">{step}</span> / {totalSteps}</span>
        <div className="flex items-center gap-1">
          <span className="text-gray-600 mr-1">Speed:</span>
          {PLAYBACK_SPEEDS.map((spd, i) => (
            <button
              key={spd}
              onClick={() => setPlaybackSpeed(spd)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                playbackSpeed === spd
                  ? "bg-amber-700/60 text-amber-300 border border-amber-600/50"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300 border border-gray-700/50"
              }`}
            >
              {speedLabels[i]}
            </button>
          ))}
        </div>
      </div>

      {/* Scrubber + turn-boundary ticks (Lane A3 of Decision #8) */}
      <div className="relative">
        {showTicks && (
          <div className="relative h-3 pointer-events-none select-none">
            {turnBoundaries.map((tb) => {
              const pct = totalSteps > 0 ? (tb.step / totalSteps) * 100 : 0;
              const isActive = tb.turnNumber === currentTurnNumber;
              // Anchor edge ticks (within 2% of left/right) so the label
              // doesn't spill off the rail. Middle ticks center over the tick.
              const translateClass =
                pct < 2 ? "translate-x-0" : pct > 98 ? "-translate-x-full" : "-translate-x-1/2";
              return (
                <button
                  key={tb.step}
                  type="button"
                  onClick={() => goTo(tb.step)}
                  title={`Jump to Turn ${tb.turnNumber}`}
                  className={`absolute top-0 ${translateClass} pointer-events-auto flex flex-col items-center group`}
                  style={{ left: `${pct}%` }}
                >
                  <span
                    className={`block w-[2px] h-2 ${
                      isActive ? "bg-amber-500" : "bg-gray-600 group-hover:bg-gray-400"
                    }`}
                  />
                  <span
                    className={`hidden md:block text-[9px] font-mono leading-none mt-px ${
                      isActive ? "text-amber-400" : "text-gray-600 group-hover:text-gray-400"
                    }`}
                  >
                    T{tb.turnNumber}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={totalSteps}
          value={step}
          onChange={(e) => goTo(Number(e.target.value))}
          className="w-full h-1.5 accent-amber-500 cursor-pointer"
        />
      </div>

      {/* Playback buttons */}
      <div className="flex items-center justify-center gap-1">
        <button
          onClick={() => goTo(0)}
          disabled={atStart}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Go to start"
        >
          <Icon name="chevron-double-left" className="w-4 h-4" />
        </button>
        <button
          onClick={stepBack}
          disabled={atStart}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Step back"
        >
          <Icon name="chevron-left" className="w-4 h-4" />
        </button>
        <button
          onClick={togglePlay}
          className="px-2.5 py-1.5 rounded text-xs bg-amber-700/40 hover:bg-amber-700/60 text-amber-300 border border-amber-600/40 transition-colors"
          title={isPlaying ? "Pause" : "Play"}
        >
          <Icon name={isPlaying ? "pause" : "play"} className="w-4 h-4" />
        </button>
        <button
          onClick={stepForward}
          disabled={atEnd}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Step forward"
        >
          <Icon name="chevron-right" className="w-4 h-4" />
        </button>
        <button
          onClick={() => goTo(totalSteps)}
          disabled={atEnd}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Go to end"
        >
          <Icon name="chevron-double-right" className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom row — Fork affordance + Lane A2 share-step button.
          Take-over slot is conditional on `onTakeOver` being wired (sandbox
          + replay-viewer entry path); copy-link is always shown in replay
          mode (every step is shareable, regardless of perspective). */}
      <div className="flex items-center gap-2 pt-0.5 border-t border-gray-800/60">
        {onTakeOver && state && (
          takeoverBlockedReason ? (
            <div
              className="flex-1 px-2 py-1.5 text-[10px] text-gray-500 italic text-center"
              title={takeoverBlockedReason}
            >
              {takeoverBlockedReason}
            </div>
          ) : (
            <button
              onClick={() => onTakeOver(state)}
              className="flex-1 px-2 py-1.5 rounded text-[11px] bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-700/40 transition-colors"
              title="Take over from this position — play out the game yourself"
            >
              Take over here
            </button>
          )
        )}
        <button
          onClick={copyLinkToStep}
          disabled={totalSteps === 0}
          className="flex-1 px-2 py-1.5 rounded text-[11px] bg-gray-800/70 hover:bg-gray-700/70 text-gray-300 border border-gray-600/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          title={`Copy a shareable link to step ${step}`}
        >
          <Icon name="clipboard" className="w-3 h-3" />
          <span>Copy link to step</span>
        </button>
      </div>
      {copyToast && <InfoToast text={copyToast.text} theme={copyToast.theme} />}
    </div>
  );
}
