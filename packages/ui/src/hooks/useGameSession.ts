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
import type { BotStrategy } from "@lorcana-sim/simulator";
import { supabase } from "../lib/supabase.js";
import { sendAction } from "../lib/serverApi.js";

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

  startGame: (config: GameSessionConfig) => void;
  dispatch: (action: GameAction) => void;
  selectCard: (instanceId: string | null) => void;
  resolveChoice: (choice: string[] | number | "accept" | "decline") => void;
  reset: () => void;
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export function useGameSession(): GameSession {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store config in a ref so effects don't retrigger on identity changes
  const configRef = useRef<GameSessionConfig | null>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // startGame
  // ---------------------------------------------------------------------------
  const startGame = useCallback((config: GameSessionConfig) => {
    configRef.current = config;
    const state = createGame(
      { player1Deck: config.player1Deck, player2Deck: config.player2Deck },
      config.definitions,
    );
    setGameState(state);
    setSelectedInstanceId(null);
    setError(null);
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
    // Local: apply immediately
    setGameState((prev) => {
      if (!prev || !configRef.current) return prev;
      const result = applyAction(prev, action, configRef.current.definitions);
      if (!result.success) {
        setError(result.error ?? "Unknown error");
        return prev;
      }
      setError(null);
      return result.newState;
    });
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
          setGameState(newState);
          setError(null);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [gameState?.isGameOver]); // re-subscribe only if game ends (cleanup)

  // ---------------------------------------------------------------------------
  // selectCard
  // ---------------------------------------------------------------------------
  const selectCard = useCallback((instanceId: string | null) => {
    setSelectedInstanceId(instanceId);
  }, []);

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------
  const reset = useCallback(() => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    configRef.current = null;
    setGameState(null);
    setSelectedInstanceId(null);
    setError(null);
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
    startGame,
    dispatch,
    selectCard,
    resolveChoice,
    reset,
  };
}
