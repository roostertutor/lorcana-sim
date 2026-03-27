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
// =============================================================================

export type GameCondition =
  // --- Card conditions ---
  | { type: "card_drawn_by";    card: string; turn: number; player?: PlayerID }
  | { type: "card_played_by";   card: string; turn: number; player?: PlayerID }
  | { type: "card_in_play_on";  card: string; turn: number; player?: PlayerID }
  | { type: "card_inked_by";    card: string; turn: number; player?: PlayerID }
  | { type: "card_never_drawn"; card: string; player?: PlayerID }
  | { type: "card_never_played"; card: string; player?: PlayerID }

  // --- Resource conditions ---
  | { type: "ink_gte";          amount: number; on_turn: number; player?: PlayerID }
  | { type: "ink_lte";          amount: number; on_turn: number; player?: PlayerID }
  | { type: "lore_gte";         amount: number; by_turn: number; player?: PlayerID }
  | { type: "lore_lte";         amount: number; by_turn: number; player?: PlayerID }

  // --- Game outcome conditions ---
  | { type: "won";              player?: PlayerID }
  | { type: "lost";             player?: PlayerID }
  | { type: "game_ended_by";    turn: number }
  | { type: "win_reason";       reason: GameResult["winReason"] }

  // --- Logical operators ---
  | { type: "and"; conditions: GameCondition[] }
  | { type: "or";  conditions: GameCondition[] }
  | { type: "not"; condition: GameCondition };

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
// CONDITION MATCHER
// =============================================================================

export function matchesCondition(
  result: GameResult,
  condition: GameCondition,
  defaultPlayer: PlayerID = "player1"
): boolean {
  const pid: PlayerID = ("player" in condition && condition.player) ? condition.player : defaultPlayer;

  switch (condition.type) {

    case "card_drawn_by": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.drawnOnTurn !== null && s.drawnOnTurn <= condition.turn);
    }

    case "card_played_by": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.playedOnTurn !== null && s.playedOnTurn <= condition.turn);
    }

    case "card_in_play_on": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.inPlayOnTurns.includes(condition.turn));
    }

    case "card_inked_by": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      );
      return copies.some(s => s.inkedOnTurn !== null && s.inkedOnTurn <= condition.turn);
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
      const inkArr = result.inkByTurn[pid];
      const inkAtTurn = inkArr?.[condition.on_turn - 1] ?? 0;
      return inkAtTurn >= condition.amount;
    }

    case "ink_lte": {
      const inkArr = result.inkByTurn[pid];
      const inkAtTurn = inkArr?.[condition.on_turn - 1] ?? 0;
      return inkAtTurn <= condition.amount;
    }

    case "lore_gte": {
      const loreArr = result.loreByTurn[pid];
      if (!loreArr) return false;
      const turnsToCheck = loreArr.slice(0, condition.by_turn);
      return turnsToCheck.some(lore => lore >= condition.amount);
    }

    case "lore_lte": {
      const loreArr = result.loreByTurn[pid];
      const loreAtTurn = loreArr?.[condition.by_turn - 1] ?? 0;
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
