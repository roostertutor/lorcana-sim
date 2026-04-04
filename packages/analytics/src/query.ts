// =============================================================================
// QUERY SYSTEM
// Condition-based filtering and aggregation over GameResult arrays.
// Answers questions like "how often does X happen, and what's the win rate?"
// =============================================================================

import type { GameResult } from "@lorcana-sim/simulator";
import type { PlayerID } from "@lorcana-sim/engine";

// =============================================================================
// CONDITION TYPES
// Composable filter predicates over a single GameResult.
//
// "player" field uses human-readable aliases that match the sim config:
//   "deck"     → player1 (your deck, goes first)
//   "opponent" → player2 (opponent's deck, goes second)
// Also accepts "player1"/"player2" for backwards compatibility.
// Defaults to "deck" (player1) when omitted.
// =============================================================================

/** Player reference in query conditions — matches sim config naming */
export type PlayerRef = "me" | "opponent" | PlayerID;

export type GameCondition =
  // --- Card conditions ---
  | { type: "card_drawn_by";    card: string; turn: number; player?: PlayerRef }
  | { type: "card_played_by";   card: string; turn: number; player?: PlayerRef }
  | { type: "card_in_play_on";  card: string; turn: number; player?: PlayerRef }
  | { type: "card_inked_by";    card: string; turn: number; player?: PlayerRef }
  | { type: "card_never_drawn"; card: string; player?: PlayerRef }
  | { type: "card_never_played"; card: string; player?: PlayerRef }

  // --- Resource conditions ---
  | { type: "ink_gte";          amount: number; on_turn: number; player?: PlayerRef }
  | { type: "ink_lte";          amount: number; on_turn: number; player?: PlayerRef }
  | { type: "lore_gte";         amount: number; by_turn: number; player?: PlayerRef }
  | { type: "lore_lte";         amount: number; by_turn: number; player?: PlayerRef }

  // --- Game outcome conditions ---
  | { type: "won";              player?: PlayerRef }
  | { type: "lost";             player?: PlayerRef }
  | { type: "game_ended_by";    turn: number }
  | { type: "win_reason";       reason: GameResult["winReason"] }

  // --- Logical operators ---
  | { type: "and"; conditions: GameCondition[] }
  | { type: "or";  conditions: GameCondition[] }
  | { type: "not"; condition: GameCondition }

  // --- Reference + mulligan ---
  | { type: "ref"; name: string }
  | { type: "mulliganed"; player?: PlayerRef };

// =============================================================================
// QUERY RESULT
// =============================================================================

export interface QueryResult {
  matchCount: number;
  probability: number;
  probabilityMargin: number;

  winRateWhenMet: number;
  winRateWhenNotMet: number;
  delta: number;

  nMet: number;
  nNotMet: number;

  interpretation: string;
}

// =============================================================================
// TURN CONVERSION
// Query conditions use per-player turn numbers (turn 3 = that player's 3rd turn).
// Internally the engine uses global turn numbers (player1 turn 1 = global 1,
// player2 turn 1 = global 2, player1 turn 2 = global 3, etc.).
// =============================================================================

function resolvePlayer(ref: PlayerRef | undefined, defaultPlayer: PlayerID): PlayerID {
  if (!ref) return defaultPlayer;
  if (ref === "me" || ref === "player1") return "player1";
  if (ref === "opponent" || ref === "player2") return "player2";
  throw new Error(`Unknown PlayerRef: "${ref as string}"`);
}

function toGlobalTurn(playerTurn: number, player: PlayerID): number {
  return player === "player1" ? (2 * playerTurn - 1) : (2 * playerTurn);
}

// =============================================================================
// REF RESOLUTION
// Resolve all { type: "ref" } nodes in a condition tree before matching.
// =============================================================================

export function resolveRefs(
  condition: GameCondition,
  definitions: Record<string, GameCondition>,
  depth = 0
): GameCondition {
  if (depth > 20) throw new Error("Circular ref detected in conditions");

  if (condition.type === "ref") {
    const resolved = definitions[condition.name];
    if (!resolved) throw new Error(`Unknown condition ref: "${condition.name}"`);
    return resolveRefs(resolved, definitions, depth + 1);
  }

  if (condition.type === "and") {
    return { type: "and", conditions: condition.conditions.map(c => resolveRefs(c, definitions, depth + 1)) };
  }
  if (condition.type === "or") {
    return { type: "or", conditions: condition.conditions.map(c => resolveRefs(c, definitions, depth + 1)) };
  }
  if (condition.type === "not") {
    return { type: "not", condition: resolveRefs(condition.condition, definitions, depth + 1) };
  }

  return condition;
}

// =============================================================================
// CONDITION MATCHER
// =============================================================================

export function matchesCondition(
  result: GameResult,
  condition: GameCondition,
  defaultPlayer: PlayerID = "player1"
): boolean {
  const pid: PlayerID = resolvePlayer(
    ("player" in condition ? condition.player : undefined) as PlayerRef | undefined,
    defaultPlayer
  );

  switch (condition.type) {

    case "card_drawn_by": {
      const globalTurn = toGlobalTurn(condition.turn, pid);
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.drawnOnTurn !== null && s.drawnOnTurn <= globalTurn);
    }

    case "card_played_by": {
      const globalTurn = toGlobalTurn(condition.turn, pid);
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.playedOnTurn !== null && s.playedOnTurn <= globalTurn);
    }

    case "card_in_play_on": {
      const globalTurn = toGlobalTurn(condition.turn, pid);
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.inPlayOnTurns.includes(globalTurn));
    }

    case "card_inked_by": {
      const globalTurn = toGlobalTurn(condition.turn, pid);
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.inkedOnTurn !== null && s.inkedOnTurn <= globalTurn);
    }

    case "card_never_drawn": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.every(s => s.drawnOnTurn === null);
    }

    case "card_never_played": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.every(s => !s.wasPlayed);
    }

    case "ink_gte": {
      const globalTurn = toGlobalTurn(condition.on_turn, pid);
      const inkArr = result.inkByTurn[pid];
      const inkAtTurn = inkArr?.[globalTurn - 1] ?? 0;
      return inkAtTurn >= condition.amount;
    }

    case "ink_lte": {
      const globalTurn = toGlobalTurn(condition.on_turn, pid);
      const inkArr = result.inkByTurn[pid];
      const inkAtTurn = inkArr?.[globalTurn - 1] ?? 0;
      return inkAtTurn <= condition.amount;
    }

    case "lore_gte": {
      const globalTurn = toGlobalTurn(condition.by_turn, pid);
      const loreArr = result.loreByTurn[pid];
      if (!loreArr) return false;
      const turnsToCheck = loreArr.slice(0, globalTurn);
      return turnsToCheck.some(lore => lore >= condition.amount);
    }

    case "lore_lte": {
      const globalTurn = toGlobalTurn(condition.by_turn, pid);
      const loreArr = result.loreByTurn[pid];
      const loreAtTurn = loreArr?.[globalTurn - 1] ?? 0;
      return loreAtTurn <= condition.amount;
    }

    case "won":
      return result.winner === pid;

    case "lost":
      return result.winner !== pid && result.winner !== "draw";

    case "game_ended_by":
      return result.turns <= condition.turn;

    case "win_reason":
      return result.winReason === condition.reason;

    case "and":
      return condition.conditions.every(c => matchesCondition(result, c, defaultPlayer));

    case "or":
      return condition.conditions.some(c => matchesCondition(result, c, defaultPlayer));

    case "not":
      return !matchesCondition(result, condition.condition, defaultPlayer);

    case "mulliganed":
      return result.mulliganed?.[pid] === true;

    case "ref":
      throw new Error(`Unresolved ref "${condition.name}" — call resolveRefs() before matchesCondition()`);
  }
}

// =============================================================================
// QUERY RUNNER
// =============================================================================

export function queryResults(
  results: GameResult[],
  condition: GameCondition,
  player: PlayerID = "player1"
): QueryResult {
  const n = results.length;

  const matching    = results.filter(r => matchesCondition(r, condition, player));
  const notMatching = results.filter(r => !matchesCondition(r, condition, player));

  const nMet    = matching.length;
  const nNotMet = notMatching.length;

  const probability       = nMet / n;
  const probabilityMargin = 1 / Math.sqrt(n);

  const winsWhenMet    = matching.filter(r => r.winner === player).length;
  const winsWhenNotMet = notMatching.filter(r => r.winner === player).length;

  const winRateWhenMet    = nMet    > 0 ? winsWhenMet    / nMet    : 0;
  const winRateWhenNotMet = nNotMet > 0 ? winsWhenNotMet / nNotMet : 0;
  const delta = winRateWhenMet - winRateWhenNotMet;

  const interpretation = generateInterpretation(probability, delta, nMet, n);

  return {
    matchCount: nMet,
    probability,
    probabilityMargin,
    winRateWhenMet,
    winRateWhenNotMet,
    delta,
    nMet,
    nNotMet,
    interpretation,
  };
}

function generateInterpretation(
  probability: number,
  delta: number,
  nMet: number,
  total: number
): string {
  const pct = (n: number) => (n * 100).toFixed(1) + "%";

  if (nMet < 20) {
    return `Too few matching games (${nMet}/${total}) for reliable conclusions. Run more iterations.`;
  }

  const freq = probability < 0.1 ? "rarely happens" :
               probability < 0.3 ? "happens in some games" :
               probability < 0.6 ? "happens in many games" :
               "happens in most games";

  const impact = Math.abs(delta) < 0.05 ? "little impact on win rate" :
                 Math.abs(delta) < 0.15 ? "moderate impact on win rate" :
                 "strong impact on win rate";

  const direction = delta > 0 ? "improves" : "hurts";

  return `This scenario ${freq} (${pct(probability)}). When it happens, it ${direction} your win rate by ${pct(Math.abs(delta))} — ${impact}.`;
}
