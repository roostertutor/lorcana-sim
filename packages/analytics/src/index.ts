// =============================================================================
// ANALYTICS PUBLIC API
// Everything the UI (or CLI) needs, exported from one place.
// Imports from engine and simulator — never directly from ui.
// =============================================================================

// Types
export type {
  DeckStats,
  CardPerformance,
  DeckComposition,
  MatchupStats,
  HandStats,
  RecordedDecision,
  CalibrationReport,
  SensitivityReport,
} from "./types.js";

// Aggregation
export { aggregateResults } from "./aggregator.js";

// Composition (static math)
export { analyzeDeckComposition } from "./composition.js";

// Comparison
export { compareDecks } from "./comparison.js";

// Opening hand analysis
export { analyzeOpeningHands } from "./hands.js";

// PersonalBot calibration
export { calibratePersonalBot } from "./calibration.js";

// Weight sensitivity
export { analyzeWeightSensitivity } from "./sensitivity.js";

// Query system
export { matchesCondition, queryResults } from "./query.js";
export type { GameCondition, QueryResult } from "./query.js";
