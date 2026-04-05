// =============================================================================
// ReplayControls — Scrubber + step buttons for replay mode
// Rendered below the game board when reviewing a completed game.
// =============================================================================

import React from "react";
import type { GameState } from "@lorcana-sim/engine";
import type { ReplaySession } from "../hooks/useReplaySession.js";
import { PLAYBACK_SPEEDS } from "../hooks/useReplaySession.js";

interface Props {
  session: ReplaySession;
  /** 3e-ii: Fork the current replay position into a live game */
  onTakeOver?: (state: GameState) => void;
  /** 3e-iii: Sim 200 games from current position, compare win% */
  onBranchAnalysis?: (state: GameState) => void;
}

export default function ReplayControls({ session, onTakeOver, onBranchAnalysis }: Props) {
  const { step, totalSteps, goTo, stepBack, stepForward, isPlaying, togglePlay, playbackSpeed, setPlaybackSpeed, state } = session;

  const atStart = step === 0;
  const atEnd = step === totalSteps;

  const speedLabels = ["1x", "1.5x", "3x"] as const;

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

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={totalSteps}
        value={step}
        onChange={(e) => goTo(Number(e.target.value))}
        className="w-full h-1.5 accent-amber-500 cursor-pointer"
      />

      {/* Playback buttons */}
      <div className="flex items-center justify-center gap-1">
        <button
          onClick={() => goTo(0)}
          disabled={atStart}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Go to start"
        >
          |&lt;
        </button>
        <button
          onClick={stepBack}
          disabled={atStart}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Step back"
        >
          &lt;
        </button>
        <button
          onClick={togglePlay}
          className="px-3 py-1.5 rounded text-xs bg-amber-700/40 hover:bg-amber-700/60 text-amber-300 border border-amber-600/40 transition-colors min-w-[3rem] font-medium"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={stepForward}
          disabled={atEnd}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Step forward"
        >
          &gt;
        </button>
        <button
          onClick={() => goTo(totalSteps)}
          disabled={atEnd}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-gray-700/50 disabled:opacity-30 transition-colors"
          title="Go to end"
        >
          &gt;|
        </button>
      </div>

      {/* Fork / Branch analysis */}
      {(onTakeOver || onBranchAnalysis) && (
        <div className="flex items-center gap-2 pt-0.5 border-t border-gray-800/60">
          {onTakeOver && state && (
            <button
              onClick={() => onTakeOver(state)}
              className="flex-1 px-2 py-1.5 rounded text-[11px] bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-700/40 transition-colors"
              title="Take over from this position — play out the game yourself"
            >
              Take over here
            </button>
          )}
          {onBranchAnalysis && state && (
            <button
              onClick={() => onBranchAnalysis(state)}
              className="flex-1 px-2 py-1.5 rounded text-[11px] bg-indigo-900/30 hover:bg-indigo-900/50 text-indigo-400 border border-indigo-700/40 transition-colors"
              title="Simulate 200 games from this position to estimate win probability"
            >
              ⑂ Branch analysis
            </button>
          )}
        </div>
      )}
    </div>
  );
}
