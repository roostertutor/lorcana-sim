// =============================================================================
// useReplaySession — Post-game replay with step scrubbing
//
// Two input shapes:
//   - "local"  — sandbox completed game OR uploaded JSON. Reconstructs the
//                state stream client-side via createGame + applyAction. The
//                data is the viewer's own (no leak risk).
//   - "remote" — MP replay. Server reconstructs and applies
//                `filterStateForPlayer` per-viewer-perspective, returns the
//                pre-rendered state stream. We just index into it. See
//                Phase A anti-cheat fix in commit 937fbb8 + the design at
//                docs/HANDOFF.md → "Shareable MP replays …".
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CardDefinition, GameState, PlayerID } from "@lorcana-sim/engine";
import { createGame, applyAction } from "@lorcana-sim/engine";
import type { ReplayData } from "./useGameSession.js";

/** Server-rendered, per-viewer-filtered MP replay payload. The `states` array
 *  is already filtered against `perspective` — client just scrubs by index. */
export interface RemoteReplay {
  /** Replay row id from the `replays` table. Used by the share toggle and
   *  perspective-change refetches. Distinct from `gameId`. */
  replayId: string;
  /** Parent game id — what `/replay/:id` rows JOIN against, also what client
   *  navigation uses (`/replay/:gameId` route). */
  gameId: string;
  /** Pre-rendered, per-viewer-filtered state stream. `states[0]` = initial,
   *  `states[N]` = after action N-1. */
  states: GameState[];
  winner: PlayerID | null;
  turnCount: number;
  /** Which viewing perspective `states` was filtered against. Drives the
   *  perspective-toggle UI (so we know which button to highlight). */
  perspective: "p1" | "p2" | "neutral";
  /** `replays.public` flag. When true, anyone with the link can view; the
   *  perspective toggle exposes "Spectator (full info)" only in this case. */
  isPublic: boolean;
  /** Whether the caller is one of the two players. Drives whether the
   *  perspective toggle can flip to opponent-view (only allowed when
   *  isPublic=true OR caller isn't a player). */
  callerIsPlayer: boolean;
  /** Caller's player slot if they're a player — used to default-select
   *  their own perspective in the toggle UI. */
  callerSlot: "p1" | "p2" | null;
  p1Username: string | null;
  p2Username: string | null;
}

/** Discriminated union accepted by `useReplaySession`. Local replays
 *  reconstruct from seed+actions; remote replays index into a pre-rendered
 *  state array. The hook's output shape is identical either way — only the
 *  state-cache build path differs. */
export type ReplayInput =
  | { kind: "local"; data: ReplayData }
  | { kind: "remote"; data: RemoteReplay };

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
  input: ReplayInput | null,
  definitions: Record<string, CardDefinition>,
): ReplaySession {
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(800);

  // Build the state cache during render (not in an effect) so the first
  // render with a new `input` already shows the initial state at step 0 —
  // not the stale session.gameState with "Step 0 / 0".
  //
  // For "remote" input the server already reconstructed + filtered; we just
  // pass through `input.data.states`. For "local" input we walk the actions
  // ourselves. Same hook shape downstream.
  const states = useMemo<GameState[]>(() => {
    if (!input) return [];
    if (input.kind === "remote") return input.data.states;
    // Local reconstruction — sandbox or uploaded JSON. The viewer is also
    // the data owner so no privacy concern.
    const data = input.data;
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
  }, [input, definitions]);

  // Reset step + playback whenever a new replay loads. Keyed on the
  // discriminator + the underlying data identity — perspective swaps
  // produce a new RemoteReplay object so this fires correctly.
  useEffect(() => {
    setStep(0);
    setIsPlaying(false);
  }, [input]);

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
