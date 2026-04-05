// =============================================================================
// useReplaySession — Post-game replay with step scrubbing
// Reconstructs GameState at each step by replaying GameAction[] from seed.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
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

  // Cache: states[i] = GameState after action i (states[0] = initial)
  const statesRef = useRef<GameState[]>([]);
  const dataRef = useRef<ReplayData | null>(null);

  // Rebuild cache when data changes
  useEffect(() => {
    if (!data) {
      statesRef.current = [];
      dataRef.current = null;
      setStep(0);
      setIsPlaying(false);
      return;
    }

    dataRef.current = data;
    setStep(0);
    setIsPlaying(false);

    // Build initial state from seed
    const initial = createGame(
      { player1Deck: data.p1Deck, player2Deck: data.p2Deck, seed: data.seed },
      definitions,
    );
    // Build states array: [initial, after_action_0, after_action_1, ...]
    const states: GameState[] = [initial];
    let current = initial;
    for (const action of data.actions) {
      const result = applyAction(current, action, definitions);
      if (result.success) {
        current = result.newState;
      }
      // Push regardless — if action failed (shouldn't happen in valid replay),
      // the previous state is repeated so the step count stays correct.
      states.push(current);
    }
    statesRef.current = states;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const totalSteps = statesRef.current.length > 0 ? statesRef.current.length - 1 : 0;
  const state = statesRef.current[step] ?? null;

  const goTo = useCallback((n: number) => {
    const max = statesRef.current.length - 1;
    setStep(Math.max(0, Math.min(n, max)));
  }, []);

  const stepBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const stepForward = useCallback(() => {
    setStep((s) => {
      const max = statesRef.current.length - 1;
      const next = s + 1;
      if (next > max) setIsPlaying(false);
      return Math.min(next, max);
    });
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      // If at end, restart from beginning when pressing play
      if (!p && statesRef.current.length > 0) {
        setStep((s) => {
          if (s >= statesRef.current.length - 1) {
            setStep(0);
          }
          return s;
        });
      }
      return !p;
    });
  }, []);

  // Auto-advance when playing
  useEffect(() => {
    if (!isPlaying || statesRef.current.length === 0) return;
    const id = setInterval(() => {
      setStep((s) => {
        const max = statesRef.current.length - 1;
        if (s >= max) {
          setIsPlaying(false);
          return max;
        }
        return s + 1;
      });
    }, playbackSpeed);
    return () => clearInterval(id);
  }, [isPlaying, playbackSpeed]);

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
