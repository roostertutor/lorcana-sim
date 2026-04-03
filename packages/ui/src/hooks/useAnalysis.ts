// =============================================================================
// useAnalysis — Position evaluation + win probability estimation
// Runs evaluatePosition immediately on every state change.
// Runs a 200-game simulation async for win probability.
// =============================================================================

import { useState, useEffect, useRef } from "react";
import type { CardDefinition, DeckEntry, GameState } from "@lorcana-sim/engine";
import type { BotStrategy, PositionFactors } from "@lorcana-sim/simulator";
import {
  computeDeckProbabilities,
  evaluatePosition,
  runSimulation,
  GreedyBot,
} from "@lorcana-sim/simulator";

const EVAL_WEIGHTS = {
  loreAdvantage: 0.6,
  boardAdvantage: 0.6,
  handAdvantage: 0.5,
  inkAdvantage: 0.5,
  deckQuality: 0.4,
  urgency: (state: GameState) => Math.pow(Math.max(state.players.player1.lore, state.players.player2.lore) / 20, 2),
  threatLevel: (_state: GameState) => 0.5,
};

export interface AnalysisResult {
  winProbability: number | null;
  factors: PositionFactors | null;
  positionScore: number | null;
  isSimulating: boolean;
  usingRL: boolean;
}

export function useAnalysis(
  gameState: GameState | null,
  definitions: Record<string, CardDefinition>,
  player1Deck: DeckEntry[],
  player2Deck: DeckEntry[],
  botStrategy: BotStrategy = GreedyBot,
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
      const result = evaluatePosition(gameState, "player1", probs, EVAL_WEIGHTS);
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
          player1Strategy: botStrategy,
          player2Strategy: botStrategy,
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
  }, [gameState, definitions, player1Deck, player2Deck, botStrategy]);

  return { winProbability, factors, positionScore, isSimulating, usingRL: botStrategy !== GreedyBot };
}
