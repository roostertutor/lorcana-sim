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
  /** Number of actions applied since game start; decreases on undo. Used by UI
   *  components that need to detect undos to reset transient dismiss state. */
  actionCount: number;
  /** Realtime connection status (multiplayer only) */
  connectionStatus: "connected" | "reconnecting" | null;
  /** Next game ID in a Bo3 match (set when current game ends and match continues) */
  nextGameId: string | null;

  startGame: (config: GameSessionConfig) => void;
  dispatch: (action: GameAction) => void;
  selectCard: (instanceId: string | null) => void;
  resolveChoice: (choice: string | string[] | number) => void;
  patchState: (updater: (prev: GameState) => GameState) => void;
  /** Install `state` as the new live game baseline — used by the replay
   *  take-over fork. Resets undo history, action count, and completedGame
   *  so subsequent undos reconstruct from this state, not the pre-fork one. */
  forkFrom: (state: GameState) => void;
  /** Replay to N-1 actions. No-op in multiplayer or when canUndo is false. */
  undo: () => void;
  reset: () => void;
  /** Restore a game from sessionStorage snapshot (HMR survival). Returns true if restored. */
  restoreFromSnapshot: (definitions: Record<string, CardDefinition>, botStrategy: BotStrategy) => boolean;
  quickSave: () => void;
  quickLoad: () => void;
  hasQuickSave: boolean;
}

/** Read the saved snapshot without consuming it (for checking if one exists). */
export function getSavedSnapshot(): SessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionSnapshot) : null;
  } catch { return null; }
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

// Session storage key for HMR / hot-reload persistence
const SESSION_KEY = "lorcana-session-snapshot";

interface SessionSnapshot {
  seed: number;
  p1Deck: DeckEntry[];
  p2Deck: DeckEntry[];
  actions: GameAction[];
  botId: string;
}

function saveSnapshot(seed: number, config: GameSessionConfig, actions: GameAction[]) {
  try {
    const snap: SessionSnapshot = {
      seed,
      p1Deck: config.player1Deck,
      p2Deck: config.player2Deck,
      actions,
      botId: "greedy", // default — config doesn't carry a serializable bot ID
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch { /* quota exceeded or SSR — ignore */ }
}

export function useGameSession(): GameSession {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedGame, setCompletedGame] = useState<ReplayData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "reconnecting" | null>(null);
  const [nextGameId, setNextGameId] = useState<string | null>(null);
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
  // Track whether we've already attempted HMR restore this mount
  const hmrRestoredRef = useRef(false);
  // Quick save slot
  const quickSaveRef = useRef<GameState | null>(null);
  // Post-fork flag: once the user takes over from a replay, the live state is
  // no longer derivable from seed+actions, so HMR snapshot persistence has to
  // pause until the next reset/startGame.
  const isForkedRef = useRef(false);
  // Realtime channel ref for cleanup
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------------------------------------------------------------------------
  // startGame
  // ---------------------------------------------------------------------------
  const startGame = useCallback((config: GameSessionConfig) => {
    configRef.current = config;
    setSelectedInstanceId(null);
    setError(null);
    setCompletedGame(null);
    setNextGameId(null);
    setActionCount(0);
    actionHistoryRef.current = [];
    initialStateRef.current = null;
    isForkedRef.current = false;

    if (config.multiplayer) {
      // Multiplayer: fetch current state from server — don't create locally
      const mp = config.multiplayer;
      getGame(mp.gameId)
        .then((state) => {
          gameStateRef.current = state;
          setGameState(state);
          // Bump actionCount on initial state arrival — see comment near
          // setActionCount in dispatch's MP branch for why.
          setActionCount((c) => c + 1);
        })
        .catch((err: unknown) => setError(String(err)));

      // Set up Realtime subscription for opponent actions.
      // ANTI-CHEAT: ignore raw payload (contains full unfiltered state),
      // fetch filtered state from GET /game/:id instead.
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }
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
          () => {
            getGame(mp.gameId)
              .then((filtered) => {
                gameStateRef.current = filtered;
                setGameState(filtered);
                setError(null);
                // Bump actionCount when an opponent action arrives via Realtime,
                // so reveal-detection in GameBoard sees `advanced === true`.
                // Without this, the opponent's reveal-bearing actions (e.g. P2
                // plays Diablo) never trigger the reveal modal on P1's view.
                setActionCount((c) => c + 1);
              })
              .catch((err: unknown) => {
                setError(String(err));
              });
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setConnectionStatus("connected");
          } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
            setConnectionStatus("reconnecting");
          }
        });
      channelRef.current = channel;
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
      // Multiplayer: apply locally first for instant feedback, then send to server.
      // Server is authoritative — if the action fails, re-sync from server state.
      // We bump actionCount on every state install (local apply + server echo +
      // error re-sync) so GameBoard's reveal-detection effect — which gates new
      // entries on `actionCount > prevRevealActionCount` — actually fires. There
      // is no undo in MP, so monotonic increment is safe; the absolute value is
      // not meaningful (we just need forward motion to differ from "no change").
      const prev = gameStateRef.current;
      if (prev && configRef.current) {
        const localResult = applyAction(prev, action, configRef.current.definitions);
        if (localResult.success) {
          gameStateRef.current = localResult.newState;
          setGameState(localResult.newState);
          setActionCount((c) => c + 1);
        }
      }
      // Fire-and-forget to server — Realtime will push authoritative state to both players
      sendAction(mp.gameId, action)
        .then((res) => {
          // Server succeeded — apply filtered state from response for immediate consistency
          if (res.newState) {
            gameStateRef.current = res.newState;
            setGameState(res.newState);
            setActionCount((c) => c + 1);
          }
          // Bo3: server created the next game in the match
          if (res.nextGameId) {
            setNextGameId(res.nextGameId);
          }
        })
        .catch((err: unknown) => {
          setError(String(err));
          // Re-sync with server truth on error
          getGame(mp.gameId)
            .then((state) => {
              gameStateRef.current = state;
              setGameState(state);
              setActionCount((c) => c + 1);
            })
            .catch(() => {});
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
    // Persist for HMR survival. Skipped post-fork: the forked state isn't
    // reachable from the original seed+actions, so a rebuilt snapshot would
    // reconstruct the wrong initial state.
    if (configRef.current && !isForkedRef.current) saveSnapshot(seedRef.current, configRef.current, actionHistoryRef.current);
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
    (choice: string | string[] | number) => {
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

  // Clean up Realtime channel on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        setConnectionStatus(null);
      }
    };
  }, []);

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
  // forkFrom — install `state` as a fresh live baseline (replay take-over)
  // ---------------------------------------------------------------------------
  const forkFrom = useCallback((state: GameState) => {
    if (!configRef.current || configRef.current.multiplayer) return;
    gameStateRef.current = state;
    initialStateRef.current = state;
    actionHistoryRef.current = [];
    isForkedRef.current = true;
    setGameState(state);
    setActionCount(0);
    setCompletedGame(null);
    setError(null);
    // Random fresh seed — the forked state is untied from the original game's
    // seed, so any future saveSnapshot would be meaningless. We also suppress
    // saves via isForkedRef and drop any stale persisted snapshot.
    seedRef.current = Date.now();
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, []);

  // ---------------------------------------------------------------------------
  // undo — replay to N-1 actions from the initial state snapshot
  //
  // Granularity: one click pops one entry from `actionHistoryRef`. The user-
  // facing semantic is implicitly "back to the last `pendingChoice`" because
  // `applyAction` splits a multi-step play into multiple actions whenever the
  // engine surfaces a pendingChoice — e.g. PLAY_CARD of a card with
  // `isMay: true` lands as two history entries (PLAY_CARD → may prompt; then
  // RESOLVE_CHOICE accept → effect resolves). One undo from the resolved
  // state returns to the may prompt; two undos return to pre-play.
  //
  // This is an UNDOCUMENTED COUPLING between card-data design and undo UX —
  // dropping `isMay` from a card collapses its undo to one click without
  // warning. There's a P2.20 regression test in the audit tracker
  // (`docs/AUDIT_2026-04-28_action_items.md`) that pins the invariant for at
  // least one card per may-style ability shape.
  //
  // MP undo is disabled (server is authoritative; takebacks design lives in
  // `docs/audit/2026-04-28_mp_takebacks_design.md`).
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
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setConnectionStatus(null);
    }
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
    isForkedRef.current = false;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, []);

  // ---------------------------------------------------------------------------
  // quickSave / quickLoad — snapshot the full GameState to sessionStorage
  // ---------------------------------------------------------------------------
  const QUICKSAVE_KEY = "lorcana-quicksave";

  const quickSave = useCallback(() => {
    if (!gameStateRef.current) return;
    try { sessionStorage.setItem(QUICKSAVE_KEY, JSON.stringify(gameStateRef.current)); } catch { /* ignore */ }
    quickSaveRef.current = gameStateRef.current; // keep ref for hasQuickSave reactivity
  }, []);

  const quickLoad = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(QUICKSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as GameState;
      gameStateRef.current = saved;
      quickSaveRef.current = saved;
      setGameState(saved);
      // Treat the loaded state as a fresh undo baseline — otherwise undo
      // would replay actions from the pre-quickload initialStateRef using
      // the old history, producing a state unrelated to what was loaded
      // (appears as "the whole game clears").
      initialStateRef.current = saved;
      actionHistoryRef.current = [];
      setActionCount(0);
      setError(null);
    } catch { /* ignore */ }
  }, []);

  const hasQuickSave = quickSaveRef.current !== null || (() => { try { return !!sessionStorage.getItem(QUICKSAVE_KEY); } catch { return false; } })();

  // ---------------------------------------------------------------------------
  // restoreFromSnapshot — rebuild game state from sessionStorage (HMR survival)
  // ---------------------------------------------------------------------------
  const restoreFromSnapshot = useCallback((definitions: Record<string, CardDefinition>, botStrategy: BotStrategy): boolean => {
    if (hmrRestoredRef.current) return false;
    hmrRestoredRef.current = true;
    const snap = getSavedSnapshot();
    if (!snap) return false;
    try {
      const config: GameSessionConfig = {
        player1Deck: snap.p1Deck,
        player2Deck: snap.p2Deck,
        definitions,
        botStrategy,
        player1IsHuman: true,
        player2IsHuman: false,
      };
      configRef.current = config;
      const initial = createGame(
        { player1Deck: snap.p1Deck, player2Deck: snap.p2Deck, interactive: true, seed: snap.seed },
        definitions,
      );
      initialStateRef.current = initial;
      seedRef.current = snap.seed;
      const state = reconstructState(initial, snap.actions, snap.actions.length, definitions);
      actionHistoryRef.current = snap.actions;
      setActionCount(snap.actions.length);
      gameStateRef.current = state;
      setGameState(state);
      return true;
    } catch { return false; }
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
    actionCount,
    connectionStatus,
    nextGameId,
    startGame,
    dispatch,
    selectCard,
    resolveChoice,
    patchState,
    forkFrom,
    undo,
    reset,
    restoreFromSnapshot,
    quickSave,
    quickLoad,
    hasQuickSave,
  };
}
