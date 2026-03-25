// =============================================================================
// ANALYTICS TYPES
// Output types for all analytics functions.
// Imports from engine and simulator — never from ui.
// =============================================================================

import type { InkColor, CardType, Keyword } from "@lorcana-sim/engine";
import type { BotType, BotWeights } from "@lorcana-sim/simulator";

// -----------------------------------------------------------------------------
// DECK STATS — Aggregated from many GameResults
// -----------------------------------------------------------------------------

export interface DeckStats {
  gamesPlayed: number;
  winRate: number;
  avgGameLength: number;
  avgWinTurn: number;
  firstPlayerWinRate: number;
  /** Flag if > 2% — indicates likely engine bug */
  drawRate: number;
  botLabel: string;
  botType: BotType;
  cardPerformance: Record<string, CardPerformance>;
}

export interface CardPerformance {
  definitionId: string;
  avgCopiesDrawnPerGame: number;
  avgTurnsToPlay: number;
  avgLoreContributed: number;
  banishRate: number;
  questRate: number;
  /** Win rate in games where this card was drawn at least once */
  winRateWhenDrawn: number;
  /** Win rate in games where this card was never drawn */
  winRateWhenNotDrawn: number;
}

// -----------------------------------------------------------------------------
// DECK COMPOSITION — Static math, no simulation needed
// -----------------------------------------------------------------------------

export interface DeckComposition {
  totalCards: number;
  inkableCount: number;
  inkablePercent: number;
  costCurve: Record<number, number>;
  avgCost: number;
  colorBreakdown: Record<InkColor, number>;
  cardTypeBreakdown: Record<CardType, number>;
  keywordCounts: Record<Keyword, number>;
  /** P(≥1 inkable card by turn N) using hypergeometric math */
  inkCurveProb: {
    turn1: number;
    turn2: number;
    turn3: number;
    turn4: number;
  };
}

// -----------------------------------------------------------------------------
// MATCHUP STATS — Comparison between two decks
// -----------------------------------------------------------------------------

export interface MatchupStats {
  deck1WinRate: number;
  deck2WinRate: number;
  drawRate: number;
  gamesPlayed: number;
  avgGameLength: number;
  botLabel: string;
  botType: BotType;
}

// -----------------------------------------------------------------------------
// HAND STATS — Opening hand analysis
// -----------------------------------------------------------------------------

export interface HandStats {
  iterations: number;
  avgCost: number;
  avgInkableCount: number;
  /** P(≥1 inkable in opening 7) */
  probabilityOfInkableInOpener: number;
  /** P(at least one card of cost ≤ N in opening hand) */
  probabilityOfPlayableOnTurn: Record<number, number>;
  mostCommonCards: Array<{ definitionId: string; avgCopies: number }>;
}

// -----------------------------------------------------------------------------
// CALIBRATION — PersonalBot vs recorded decisions
// -----------------------------------------------------------------------------

export interface RecordedDecision {
  /** Serialized game state at decision point */
  stateSnapshot: string;
  /** The action the human actually took (JSON-serialized GameAction) */
  humanAction: string;
  /** Which player is the human */
  playerId: "player1" | "player2";
  /** Turn number for phase classification */
  turn: number;
}

export interface CalibrationReport {
  agreementRate: number;
  divergenceByPhase: {
    early: number;   // turns 1-4
    mid: number;     // turns 5-10
    late: number;    // turns 11+
  };
  /** Rough gradient — which weights to nudge and by how much */
  suggestedWeightAdjustments: Partial<BotWeights>;
}

// -----------------------------------------------------------------------------
// SENSITIVITY — Weight sweep analysis
// -----------------------------------------------------------------------------

export interface SensitivityReport {
  /** How much win rate varies when this weight changes — higher = more important */
  weightImportance: Record<string, number>;
  /** Range [lo, hi] where win rate stays within 5% of peak */
  stableRanges: Record<string, [number, number]>;
}
