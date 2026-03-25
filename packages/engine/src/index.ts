// =============================================================================
// ENGINE PUBLIC API
// Everything the UI (or tests) needs, exported from one place.
// =============================================================================

// Core types
export type {
  GameState,
  GameAction,
  ActionResult,
  GameEvent,
  CardDefinition,
  CardInstance,
  PlayerID,
  ZoneName,
  InkColor,
  CardType,
  Keyword,
  Ability,
  Effect,
  PlayerState,
  GamePhase,
  PendingChoice,
  GameLogEntry,
} from "./types/index.js";

// Engine functions
export { applyAction, getAllLegalActions, checkWinConditions, getLoreThreshold } from "./engine/reducer.js";
export type { WinResult } from "./engine/reducer.js";
export { createGame, parseDecklist } from "./engine/initializer.js";
export type { GameConfig, DeckEntry } from "./engine/initializer.js";

// Utilities
export {
  getInstance,
  getDefinition,
  getZone,
  getZoneInstances,
  getEffectiveStrength,
  getEffectiveWillpower,
  getEffectiveLore,
  hasKeyword,
  getKeywordValue,
  getOpponent,
  canAfford,
  isMainPhase,
  matchesFilter,
  findMatchingInstances,
  generateId,
} from "./utils/index.js";

// Sample data
export { SAMPLE_CARDS, SAMPLE_CARD_DEFINITIONS } from "./cards/sampleCards.js";
