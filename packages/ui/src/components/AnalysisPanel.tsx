// =============================================================================
// AnalysisPanel — Win probability bar + position factor indicators
// Used by both TestBench and GameBoard.
// =============================================================================

import React from "react";
import type { PositionFactors } from "@lorcana-sim/simulator";

interface Props {
  winProbability: number | null;
  factors: PositionFactors | null;
  positionScore: number | null;
  isSimulating: boolean;
  estimateLabel?: string;
}

// Centered bar for values in [-1, 1]: green right, red left
function CenteredBar({ value, label }: { value: number; label: string }) {
  const pct = Math.abs(value) * 50;
  const isPositive = value >= 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-gray-400 text-right shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-gray-800 rounded relative overflow-hidden">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600 z-10" />
        {isPositive ? (
          <div
            className="absolute top-0 bottom-0 bg-green-600 rounded-r"
            style={{ left: "50%", width: `${pct}%` }}
          />
        ) : (
          <div
            className="absolute top-0 bottom-0 bg-red-600 rounded-l"
            style={{ right: "50%", width: `${pct}%` }}
          />
        )}
      </div>
      <span className={`w-10 text-right shrink-0 ${value >= 0 ? "text-green-400" : "text-red-400"}`}>
        {value >= 0 ? "+" : ""}{(value * 100).toFixed(0)}
      </span>
    </div>
  );
}

// Left-to-right bar for values in [0, 1]
function FillBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-gray-400 text-right shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-gray-800 rounded overflow-hidden">
        <div
          className="h-full bg-amber-600 rounded"
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="w-10 text-right text-amber-400 shrink-0">
        {(value * 100).toFixed(0)}
      </span>
    </div>
  );
}

export default function AnalysisPanel({ winProbability, factors, positionScore, isSimulating, estimateLabel = "GreedyBot est." }: Props) {
  return (
    <div className="card space-y-4">
      {/* Win Probability */}
      <div>
        <div className="label flex items-center gap-2">
          Win Probability
          {isSimulating && (
            <span className="text-amber-400 animate-pulse text-[10px] normal-case tracking-normal">
              simulating...
            </span>
          )}
        </div>
        {winProbability != null ? (
          <div className="space-y-1">
            <div className="h-5 bg-gray-800 rounded overflow-hidden flex">
              <div
                className="h-full bg-green-600 transition-all duration-300"
                style={{ width: `${winProbability * 100}%` }}
              />
              <div
                className="h-full bg-red-600 transition-all duration-300"
                style={{ width: `${(1 - winProbability) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-green-400">P1 {(winProbability * 100).toFixed(0)}%</span>
              <span className="text-gray-500 text-[10px]">{estimateLabel}</span>
              <span className="text-red-400">P2 {((1 - winProbability) * 100).toFixed(0)}%</span>
            </div>
          </div>
        ) : (
          <div className="text-gray-600 text-xs">
            {isSimulating ? "Running 200 games..." : "No data"}
          </div>
        )}
      </div>

      {/* Position Factors */}
      {factors && (
        <div>
          <div className="label">
            Position Factors
            {positionScore != null && (
              <span className={`ml-2 normal-case tracking-normal ${positionScore >= 0 ? "text-green-400" : "text-red-400"}`}>
                ({positionScore >= 0 ? "+" : ""}{positionScore.toFixed(2)})
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            <CenteredBar value={factors.loreAdvantage} label="Lore" />
            <CenteredBar value={factors.boardAdvantage} label="Board" />
            <CenteredBar value={factors.handAdvantage} label="Hand" />
            <CenteredBar value={factors.inkAdvantage} label="Ink" />
            <FillBar value={factors.deckQuality} label="Deck Quality" />
            <FillBar value={factors.threatLevel} label="Threat" />
            <FillBar value={factors.urgency} label="Urgency" />
          </div>
        </div>
      )}
    </div>
  );
}
