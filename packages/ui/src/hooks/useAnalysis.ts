// =============================================================================
// useAnalysis — Position evaluation + win probability estimation
// Runs evaluatePosition immediately on every state change.
// Runs a 200-game simulation async for win probability.
// =============================================================================

import { useState, useEffect, useRef } from "react";
import type { CardDefinition, DeckEntry, GameState } from "@lorcana-sim/engine";
import type { PositionFactors } from "@lorcana-sim/simulator";
import {
  computeDeckProbabilities,
  evaluatePosition,
  runSimulation,
  GreedyBot,
  MidrangeWeights,
} from "@lorcana-sim/simulator";

export interface AnalysisResult {
  winProbability: number | null;
  factors: PositionFactors | null;
  positionScore: number | null;
  isSimulating: boolean;
}

export function useAnalysis(
  gameState: GameState | null,
  definitions: Record<string, CardDefinition>,
  player1Deck: DeckEntry[],
  player2Deck: DeckEntry[],
): AnalysisResult {
  const [winProbability, setWinProbability] = useState<number | null>(null);
  const [factors, setFactors] = useState<PositionFactors | null>(null);
  const [positionScore, setPositionScore] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const simCancelRef = useRef(0); // increments to cancel stale sims

  useEffect(() => {
    if (!gameState || gameState.isGameOver) {
      setFactors(null);
      setPositionScore(null);
      setWinProbability(null);
      setIsSimulating(false);
      return;
    }

    // --- Immediate: position factors ---
    try {
      const probs = computeDeckProbabilities(gameState, "player1", definitions);
      const result = evaluatePosition(gameState, "player1", probs, MidrangeWeights);
      setFactors(result.factors);
      setPositionScore(result.score);
    } catch {
      setFactors(null);
      setPositionScore(null);
    }

    // --- Async: win probability via simulation ---
    if (player1Deck.length === 0 || player2Deck.length === 0) return;

    const simId = ++simCancelRef.current;
    setIsSimulating(true);

    const timer = setTimeout(() => {
      try {
        const results = runSimulation({
          startingState: gameState,
          player1Deck,
          player2Deck,
          player1Strategy: GreedyBot,
          player2Strategy: GreedyBot,
          definitions,
          iterations: 200,
        });
        // Only apply if this sim is still current
        if (simCancelRef.current === simId) {
          const p1Wins = results.filter((r) => r.winner === "player1").length;
          setWinProbability(p1Wins / results.length);
          setIsSimulating(false);
        }
      } catch {
        if (simCancelRef.current === simId) {
          setWinProbability(null);
          setIsSimulating(false);
        }
      }
    }, 10);

    return () => {
      clearTimeout(timer);
      // Cancel stale sim by incrementing
      simCancelRef.current++;
    };
  }, [gameState, definitions, player1Deck, player2Deck]);

  return { winProbability, factors, positionScore, isSimulating };
}
