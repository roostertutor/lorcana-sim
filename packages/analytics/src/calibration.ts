// =============================================================================
// PERSONAL BOT CALIBRATION
// Measures agreement between a PersonalBot and recorded human decisions.
// Agreement rate + divergence by phase + suggested weight adjustments.
//
// RecordedDecision: game state snapshot + human action (both JSON-serialized).
// The bot re-decides on the same state and we compare.
// =============================================================================

import type { GameState, CardDefinition, PlayerID } from "@lorcana-sim/engine";
import type { BotStrategy, BotWeights } from "@lorcana-sim/simulator";
import type { RecordedDecision, CalibrationReport } from "./types.js";

function actionsMatch(a: string, b: string): boolean {
  try {
    const pa = JSON.parse(a);
    const pb = JSON.parse(b);
    // Compare type + primary keys (instanceId, definitionId, etc.)
    if (pa.type !== pb.type) return false;
    for (const key of Object.keys(pa)) {
      if (JSON.stringify(pa[key]) !== JSON.stringify(pb[key])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function classifyPhase(turn: number): "early" | "mid" | "late" {
  if (turn <= 4) return "early";
  if (turn <= 10) return "mid";
  return "late";
}

export function calibratePersonalBot(
  decisions: RecordedDecision[],
  bot: BotStrategy,
  definitions: Record<string, CardDefinition>
): CalibrationReport {
  if (decisions.length === 0) {
    return {
      agreementRate: 0,
      divergenceByPhase: { early: 0, mid: 0, late: 0 },
      suggestedWeightAdjustments: {},
    };
  }

  let totalMatch = 0;
  const byPhase: Record<"early" | "mid" | "late", { match: number; total: number }> = {
    early: { match: 0, total: 0 },
    mid: { match: 0, total: 0 },
    late: { match: 0, total: 0 },
  };

  for (const decision of decisions) {
    let state: GameState;
    try {
      state = JSON.parse(decision.stateSnapshot) as GameState;
    } catch {
      continue; // Skip malformed snapshots
    }

    const playerId = decision.playerId as PlayerID;
    const botAction = bot.decideAction(state, playerId, definitions);
    const botActionStr = JSON.stringify(botAction);

    const matched = actionsMatch(decision.humanAction, botActionStr);
    if (matched) totalMatch++;

    const phase = classifyPhase(decision.turn);
    byPhase[phase].total++;
    if (matched) byPhase[phase].match++;
  }

  const agreementRate = totalMatch / decisions.length;

  const divergenceByPhase = {
    early: byPhase.early.total > 0 ? 1 - byPhase.early.match / byPhase.early.total : 0,
    mid: byPhase.mid.total > 0 ? 1 - byPhase.mid.match / byPhase.mid.total : 0,
    late: byPhase.late.total > 0 ? 1 - byPhase.late.match / byPhase.late.total : 0,
  };

  // Rough heuristic: if late-game divergence is high, bot may weight urgency too
  // low. If early divergence is high, inkAdvantage or handAdvantage may be off.
  // These are directional hints only — real calibration requires weight sweeps.
  const suggestedWeightAdjustments: Partial<BotWeights> = {};

  const earlyDivergence = divergenceByPhase.early;
  const lateDivergence = divergenceByPhase.late;

  if (earlyDivergence > 0.4) {
    // High early divergence: human likely values ink/hand more than bot
    suggestedWeightAdjustments.inkAdvantage = 0.1;
    suggestedWeightAdjustments.handAdvantage = 0.1;
  }
  if (lateDivergence > 0.4) {
    // High late divergence: human likely plays more urgently than bot
    suggestedWeightAdjustments.loreAdvantage = 0.1;
  }

  return {
    agreementRate,
    divergenceByPhase,
    suggestedWeightAdjustments,
  };
}
