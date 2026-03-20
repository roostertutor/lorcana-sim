// =============================================================================
// GAME STORE
// Zustand store that wraps the engine. This is the only place that calls
// applyAction. React components dispatch actions here and read state here.
// =============================================================================

import { create } from "zustand";
import {
  applyAction,
  createGame,
  parseDecklist,
  SAMPLE_CARD_DEFINITIONS,
} from "@lorcana-sim/engine";
import type {
  GameState,
  GameAction,
  CardDefinition,
  GameEvent,
} from "@lorcana-sim/engine";

interface GameStore {
  // State
  gameState: GameState | null;
  definitions: Record<string, CardDefinition>;
  lastEvents: GameEvent[];
  errorMessage: string | null;
  selectedCardId: string | null;

  // Actions
  startGame: (player1Decklist: string, player2Decklist: string) => void;
  dispatch: (action: GameAction) => void;
  selectCard: (instanceId: string | null) => void;
  clearError: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameState: null,
  definitions: SAMPLE_CARD_DEFINITIONS,
  lastEvents: [],
  errorMessage: null,
  selectedCardId: null,

  startGame: (player1Decklist, player2Decklist) => {
    const { definitions } = get();

    const p1Result = parseDecklist(player1Decklist, definitions);
    const p2Result = parseDecklist(player2Decklist, definitions);

    if (p1Result.errors.length > 0) {
      set({ errorMessage: `Player 1 deck errors:\n${p1Result.errors.join("\n")}` });
      return;
    }
    if (p2Result.errors.length > 0) {
      set({ errorMessage: `Player 2 deck errors:\n${p2Result.errors.join("\n")}` });
      return;
    }

    const gameState = createGame(
      {
        player1Deck: p1Result.entries,
        player2Deck: p2Result.entries,
      },
      definitions
    );

    set({ gameState, lastEvents: [], errorMessage: null, selectedCardId: null });
  },

  dispatch: (action) => {
    const { gameState, definitions } = get();
    if (!gameState) return;

    const result = applyAction(gameState, action, definitions);

    if (!result.success) {
      set({ errorMessage: result.error ?? "Unknown error" });
      return;
    }

    set({
      gameState: result.newState,
      lastEvents: result.events,
      errorMessage: null,
    });
  },

  selectCard: (instanceId) => {
    set({ selectedCardId: instanceId });
  },

  clearError: () => {
    set({ errorMessage: null });
  },
}));
