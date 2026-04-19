// =============================================================================
// useReplaySession — Post-game replay with step scrubbing
// Reconstructs GameState at each step by replaying GameAction[] from seed.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import { createGame, applyAction } from "@lorcana-sim/engine";
import type { ReplayData } from "./useGameSession.js";

export interface ReplaySession {
  /** GameState at the current step (null if not yet initialized) */
  state: GameState | null;
  /** Current step index: 0 = initial state, N = after action N */
  step: number;
  totalSteps: number;
  goTo: (n: number) => void;
  stepBack: () => void;
  stepForward: () => void;
  isPlaying: boolean;
  togglePlay: () => void;
  playbackSpeed: number;
  setPlaybackSpeed: (ms: number) => void;
}

export const PLAYBACK_SPEEDS = [800, 500, 250] as const;

export function useReplaySession(
  data: ReplayData | null,
  definitions: Record<string, CardDefinition>,
): ReplaySession {
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(800);

  // Build the full state cache during render (not in an effect) so the first
  // render with a new `data` already shows the initial state at step 0 — not
  // the stale session.gameState with "Step 0 / 0". states[0] = initial state,
  // states[N] = state after action N.
  const states = useMemo<GameState[]>(() => {
    if (!data) return [];
    const initial = createGame(
      { player1Deck: data.p1Deck, player2Deck: data.p2Deck, seed: data.seed },
      definitions,
    );
    const built: GameState[] = [initial];
    let current = initial;
    for (const action of data.actions) {
      const result = applyAction(current, action, definitions);
      if (result.success) current = result.newState;
      // Push regardless so step indices align with the source actions array
      // even if some action fails to apply (e.g., engine version skew).
      built.push(current);
    }
    return built;
  }, [data, definitions]);

  // Reset step + playback whenever a new replay loads
  useEffect(() => {
    setStep(0);
    setIsPlaying(false);
  }, [data]);

  const totalSteps = states.length > 0 ? states.length - 1 : 0;
  const state = states[step] ?? null;

  const goTo = useCallback((n: number) => {
    setStep(Math.max(0, Math.min(n, totalSteps)));
  }, [totalSteps]);

  const stepBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const stepForward = useCallback(() => {
    setStep((s) => {
      const next = s + 1;
      if (next > totalSteps) setIsPlaying(false);
      return Math.min(next, totalSteps);
    });
  }, [totalSteps]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      // If paused at the end, restart from the beginning on play.
      if (!p && totalSteps > 0 && step >= totalSteps) setStep(0);
      return !p;
    });
  }, [step, totalSteps]);

  // Auto-advance when playing
  useEffect(() => {
    if (!isPlaying || totalSteps === 0) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= totalSteps) {
          setIsPlaying(false);
          return totalSteps;
        }
        return s + 1;
      });
    }, playbackSpeed);
    return () => clearInterval(id);
  }, [isPlaying, playbackSpeed, totalSteps]);

  return {
    state,
    step,
    totalSteps,
    goTo,
    stepBack,
    stepForward,
    isPlaying,
    togglePlay,
    playbackSpeed,
    setPlaybackSpeed,
  };
}
