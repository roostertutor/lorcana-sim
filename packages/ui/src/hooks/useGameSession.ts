// =============================================================================
// useGameSession — Game session hook for interactive play
// ALL game logic lives here. UI components just render state + call methods.
// =============================================================================

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import type {
  CardDefinition,
  DeckEntry,
  GameAction,
  GameState,
  GameLogEntry,
  PendingChoice,
  PlayerID,
} from "@lorcana-sim/engine";
import { createGame, applyAction, getAllLegalActions } from "@lorcana-sim/engine";

// -----------------------------------------------------------------------------
// ReplayData — self-contained snapshot for replay reconstruction
// Exported so GameBoard and useReplaySession can share the type.
// -----------------------------------------------------------------------------
export interface ReplayData {
  seed: number;
  p1Deck: DeckEntry[];
  p2Deck: DeckEntry[];
  actions: GameAction[];
  winner: PlayerID | null;
  turnCount: number;
}
import type { BotStrategy } from "@lorcana-sim/simulator";
import { supabase } from "../lib/supabase.js";
import { sendAction, getGame } from "../lib/serverApi.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface GameSessionConfig {
  player1Deck: DeckEntry[];
  player2Deck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  botStrategy: BotStrategy;
  player1IsHuman: boolean;
  player2IsHuman: boolean;
  // Multiplayer fields — omit for local mode
  multiplayer?: {
    gameId: string;
    myPlayerId: PlayerID;
    token: string;
  };
}

export interface GameSession {
  gameState: GameState | null;
  legalActions: GameAction[];
  pendingChoice: PendingChoice | null;
  actionLog: GameLogEntry[];
  isGameOver: boolean;
  winner: PlayerID | null;
  selectedInstanceId: string | null;
  error: string | null;
  /** Available in local mode only — null until the game ends */
  completedGame: ReplayData | null;
  /** True when there are actions to undo (local mode, non-game-over only) */
  canUndo: boolean;

  startGame: (config: GameSessionConfig) => void;
  dispatch: (action: GameAction) => void;
  selectCard: (instanceId: string | null) => void;
  resolveChoice: (choice: string[] | number | "accept" | "decline") => void;
  patchState: (updater: (prev: GameState) => GameState) => void;
  /** Replay to N-1 actions. No-op in multiplayer or when canUndo is false. */
  undo: () => void;
  reset: () => void;
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

// Reconstruct state by replaying N actions from an initial state.
function reconstructState(
  initialState: GameState,
  actions: GameAction[],
  n: number,
  definitions: Record<string, CardDefinition>,
): GameState {
  let state = initialState;
  for (let i = 0; i < n && i < actions.length; i++) {
    const result = applyAction(state, actions[i]!, definitions);
    if (result.success) state = result.newState;
  }
  return state;
}

export function useGameSession(): GameSession {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedGame, setCompletedGame] = useState<ReplayData | null>(null);
  // actionCount drives canUndo reactivity — refs alone don't trigger re-renders
  const [actionCount, setActionCount] = useState(0);

  // Store config in a ref so effects don't retrigger on identity changes
  const configRef = useRef<GameSessionConfig | null>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of gameState in a ref — always current, readable in callbacks without triggering re-renders.
  // Needed so dispatch can read current state synchronously without the updater form
  // (React Strict Mode double-invokes updater functions, causing side effects to run twice).
  const gameStateRef = useRef<GameState | null>(null);
  // Replay / undo infra (local mode only)
  const seedRef = useRef<number>(0);
  const initialStateRef = useRef<GameState | null>(null);
  const actionHistoryRef = useRef<GameAction[]>([]);

  // ---------------------------------------------------------------------------
  // startGame
  // ---------------------------------------------------------------------------
  const startGame = useCallback((config: GameSessionConfig) => {
    configRef.current = config;
    setSelectedInstanceId(null);
    setError(null);
    setCompletedGame(null);
    setActionCount(0);
    actionHistoryRef.current = [];
    initialStateRef.current = null;

    if (config.multiplayer) {
      // Multiplayer: fetch current state from server — don't create locally
      getGame(config.multiplayer.token, config.multiplayer.gameId)
        .then((state) => setGameState(state))
        .catch((err: unknown) => setError(String(err)));
      return;
    }

    const seed = Date.now();
    seedRef.current = seed;
    const state = createGame(
      { player1Deck: config.player1Deck, player2Deck: config.player2Deck, interactive: true, seed },
      config.definitions,
    );
    initialStateRef.current = state;
    gameStateRef.current = state;
    setGameState(state);
  }, []);

  // ---------------------------------------------------------------------------
  // dispatch
  // ---------------------------------------------------------------------------
  const dispatch = useCallback((action: GameAction) => {
    const mp = configRef.current?.multiplayer;
    if (mp) {
      // Multiplayer: send to server, state update comes via Realtime
      sendAction(mp.token, mp.gameId, action).catch((err: unknown) => {
        setError(String(err));
      });
      return;
    }
    // Local: read current state from ref (not updater form — React Strict Mode
    // double-invokes updater functions in dev, which would record the action twice).
    const prev = gameStateRef.current;
    if (!prev || !configRef.current) return;
    const result = applyAction(prev, action, configRef.current.definitions);
    if (!result.success) {
      setError(result.error ?? "Unknown error");
      return;
    }
    setError(null);
    // Track action for undo/replay — runs exactly once
    actionHistoryRef.current = [...actionHistoryRef.current, action];
    setActionCount((c) => c + 1);
    gameStateRef.current = result.newState;
    setGameState(result.newState);
    // Assemble completedGame when the game ends
    if (result.newState.isGameOver && configRef.current) {
      setCompletedGame({
        seed: seedRef.current,
        p1Deck: configRef.current.player1Deck,
        p2Deck: configRef.current.player2Deck,
        actions: actionHistoryRef.current,
        winner: result.newState.winner,
        turnCount: result.newState.turnNumber,
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // legalActions (derived)
  // ---------------------------------------------------------------------------
  const legalActions = useMemo(() => {
    if (!gameState || !configRef.current) return [];
    if (gameState.isGameOver) return [];
    if (gameState.pendingChoice) return [];

    const config = configRef.current;
    const activePlayer = gameState.currentPlayer;
    const isHuman =
      (activePlayer === "player1" && config.player1IsHuman) ||
      (activePlayer === "player2" && config.player2IsHuman);

    if (!isHuman) return [];

    return getAllLegalActions(gameState, activePlayer, config.definitions);
  }, [gameState]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const pendingChoice = gameState?.pendingChoice ?? null;
  const actionLog = gameState?.actionLog ?? [];
  const isGameOver = gameState?.isGameOver ?? false;
  const winner = gameState?.winner ?? null;

  // ---------------------------------------------------------------------------
  // resolveChoice
  // ---------------------------------------------------------------------------
  const resolveChoice = useCallback(
    (choice: string[] | number | "accept" | "decline") => {
      if (!gameState?.pendingChoice) return;
      dispatch({
        type: "RESOLVE_CHOICE",
        playerId: gameState.pendingChoice.choosingPlayerId,
        choice,
      });
    },
    [gameState?.pendingChoice, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Bot auto-play
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!gameState || !configRef.current) return;
    if (gameState.isGameOver) return;
    if (configRef.current.multiplayer) return; // both sides are humans in multiplayer

    const config = configRef.current;

    // Determine the active player (pending choice takes priority)
    const activePlayer = gameState.pendingChoice
      ? gameState.pendingChoice.choosingPlayerId
      : gameState.currentPlayer;

    const isHuman =
      (activePlayer === "player1" && config.player1IsHuman) ||
      (activePlayer === "player2" && config.player2IsHuman);

    if (isHuman) return;

    // Bot's turn — decide with a small delay so the human can see what's happening
    botTimerRef.current = setTimeout(() => {
      try {
        const action = config.botStrategy.decideAction(
          gameState,
          activePlayer,
          config.definitions,
        );
        dispatch(action);
      } catch {
        // Fallback: pass turn if bot errors
        dispatch({ type: "PASS_TURN", playerId: activePlayer });
      }
    }, 300);

    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
  }, [gameState, dispatch]);

  // ---------------------------------------------------------------------------
  // Supabase Realtime subscription (multiplayer only)
  // Listens for game state updates broadcast by the server after each action.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const mp = configRef.current?.multiplayer;
    if (!mp) return;

    const channel = supabase
      .channel(`game:${mp.gameId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `id=eq.${mp.gameId}`,
        },
        (payload) => {
          const newState = (payload.new as { state: GameState }).state;
          gameStateRef.current = newState;
          setGameState(newState);
          setError(null);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once; subscription handles its own state updates

  // ---------------------------------------------------------------------------
  // selectCard
  // ---------------------------------------------------------------------------
  const selectCard = useCallback((instanceId: string | null) => {
    setSelectedInstanceId(instanceId);
  }, []);

  // ---------------------------------------------------------------------------
  // patchState — sandbox direct mutation, bypasses engine validation
  // ---------------------------------------------------------------------------
  const patchState = useCallback((updater: (prev: GameState) => GameState) => {
    const prev = gameStateRef.current;
    if (!prev) return;
    const next = updater(prev);
    gameStateRef.current = next;
    setGameState(next);
  }, []);

  // ---------------------------------------------------------------------------
  // undo — replay to N-1 actions from the initial state snapshot
  // ---------------------------------------------------------------------------
  const undo = useCallback(() => {
    const history = actionHistoryRef.current;
    const init = initialStateRef.current;
    if (!init || history.length === 0 || !configRef.current) return;
    if (configRef.current.multiplayer) return; // no undo in multiplayer
    const newHistory = history.slice(0, -1);
    actionHistoryRef.current = newHistory;
    setActionCount((c) => c - 1);
    const reconstructed = reconstructState(init, newHistory, newHistory.length, configRef.current.definitions);
    gameStateRef.current = reconstructed;
    setGameState(reconstructed);
    setError(null);
  }, []);

  const canUndo = actionCount > 0 && !isGameOver && !configRef.current?.multiplayer;

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------
  const reset = useCallback(() => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    configRef.current = null;
    gameStateRef.current = null;
    setGameState(null);
    setSelectedInstanceId(null);
    setError(null);
    setCompletedGame(null);
    setActionCount(0);
    seedRef.current = 0;
    initialStateRef.current = null;
    actionHistoryRef.current = [];
  }, []);

  return {
    gameState,
    legalActions,
    pendingChoice,
    actionLog,
    isGameOver,
    winner,
    selectedInstanceId,
    error,
    completedGame,
    canUndo,
    startGame,
    dispatch,
    selectCard,
    resolveChoice,
    patchState,
    undo,
    reset,
  };
}
