// =============================================================================
// SIMULATOR TYPES
// All types for bots, game results, and simulation configuration.
// Imports from engine only — never from analytics or ui.
// =============================================================================

import type {
  CardDefinition,
  DeckEntry,
  GameAction,
  GameLogEntry,
  GameState,
  PlayerID,
} from "@lorcana-sim/engine";

// -----------------------------------------------------------------------------
// BOT TYPES — Never mix in aggregation
// -----------------------------------------------------------------------------

export type BotType = "algorithm" | "personal" | "crowd";

export interface BotStrategy {
  name: string;
  type: BotType;
  decideAction: (
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ) => GameAction;
}

// -----------------------------------------------------------------------------
// BOT WEIGHTS
// Static scalars (0–1) capture personality traits.
// Dynamic functions respond to game state.
// score = Σ(staticFactor × staticWeight) + Σ(dynamicFactor × dynamicWeight(state))
// -----------------------------------------------------------------------------

export interface BotWeights {
  // Static: constant personality traits
  loreAdvantage: number;
  boardAdvantage: number;
  handAdvantage: number;
  inkAdvantage: number;
  deckQuality: number;
  // Dynamic: respond to game state
  urgency: (state: GameState) => number;
  threatLevel: (state: GameState) => number;
}

// -----------------------------------------------------------------------------
// GAME CONFIG + RESULT
// -----------------------------------------------------------------------------

export interface SimGameConfig {
  player1Deck: DeckEntry[];
  player2Deck: DeckEntry[];
  player1Strategy: BotStrategy;
  player2Strategy: BotStrategy;
  definitions: Record<string, CardDefinition>;
  /** Safety limit to prevent infinite games. Default: 50 */
  maxTurns?: number;
}

export interface CardGameStats {
  instanceId: string;
  definitionId: string;
  turnsInPlay: number;
  timesQuested: number;
  timesChallenged: number;
  /** Damage this card dealt to other cards */
  damageDealt: number;
  loreContributed: number;
  wasBanished: boolean;
}

export interface GameResult {
  winner: PlayerID | "draw";
  winReason: "lore_threshold" | "deck_exhausted" | "max_turns_exceeded";
  turns: number;
  finalLore: Record<PlayerID, number>;
  actionLog: GameLogEntry[];
  cardStats: Record<string, CardGameStats>;
  /** Bot name per player */
  botLabels: Record<PlayerID, string>;
  /** Must be uniform across both players — aggregateResults() throws if mixed */
  botType: BotType;
}

// -----------------------------------------------------------------------------
// SIMULATION CONFIG
// -----------------------------------------------------------------------------

export interface SimConfig extends SimGameConfig {
  iterations: number;
}

// -----------------------------------------------------------------------------
// OPTIMIZATION
// -----------------------------------------------------------------------------

export interface WeightSweepResult {
  weights: BotWeights;
  winRate: number;
  gamesPlayed: number;
}

export interface OptimizationConfig {
  deck: DeckEntry[];
  opponentDeck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  opponent: BotStrategy;
  gamesPerEval: number;
  iterations: number;
  searchStrategy: "grid" | "random" | "genetic";
}

export interface SweepConfig {
  deck: DeckEntry[];
  opponentDeck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  opponent: BotStrategy;
  weightSamples: BotWeights[];
  gamesPerSample: number;
}

// -----------------------------------------------------------------------------
// PERSONAL BOT
// -----------------------------------------------------------------------------

export interface OverrideRule {
  description: string;
  condition: (state: GameState, playerId: PlayerID) => boolean;
  action: (
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ) => GameAction;
}

export interface PersonalBotConfig {
  name: string;
  weights: BotWeights;
  overrides?: OverrideRule[];
}
