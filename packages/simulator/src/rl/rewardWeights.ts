// =============================================================================
// REWARD WEIGHTS — Per-card reward weight inference for RL training
//
// Each card contributes a weight vector based on its stats and keywords.
// A deck's RewardWeights = average of all 60 cards' contributions.
// This encodes the deck's archetype as a continuous vector — no discrete labels.
//
// Deck upgrades (new set release, swap 4 cards) auto-update by re-running
// inferRewardWeights(). Works for keyword-only stub cards (sets 2–11).
// =============================================================================

import type { CardDefinition } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import type { GameResult } from "../types.js";
import { cardToFeatures } from "./autoTag.js";

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface RewardWeights {
  /** Importance of binary win/loss/draw signal */
  winWeight: number;
  /** Reward for your own lore progress */
  loreGain: number;
  /** Reward for denying opponent lore */
  loreDenial: number;
  /** Reward for banishing opponent characters (weighted by their lore value) */
  banishValue: number;
  /** Reward for using available ink efficiently */
  inkEfficiency: number;
  /** Reward for favorable challenge trades */
  tradeQuality: number;
}

export interface CardRewardContribution {
  definitionId: string;
  weights: RewardWeights;
}

// -----------------------------------------------------------------------------
// KEYWORD / EFFECT INDEX CONSTANTS
// These must stay in sync with KEYWORD_LIST and EFFECT_TYPE_LIST in autoTag.ts.
// If those arrays are reordered, update these indices to match.
// -----------------------------------------------------------------------------

// Indices into CardFeatures.keywords[] — mirrors KEYWORD_LIST in autoTag.ts
const KW = {
  RUSH:       2,
  RECKLESS:   5,
  CHALLENGER: 6,
  SINGER:     8,
} as const;

// Indices into CardFeatures.effectPresence[] — mirrors EFFECT_TYPE_LIST in autoTag.ts
const EF = {
  DEAL_DAMAGE:    1,
  BANISH:         3,
  RETURN_TO_HAND: 4,
  GAIN_LORE:      5,
} as const;

// -----------------------------------------------------------------------------
// PER-CARD CONTRIBUTION
// -----------------------------------------------------------------------------

/**
 * Compute a card's contribution to the deck's reward weight vector.
 * Uses only static card features — works for keyword-only stubs.
 */
export function cardRewardContribution(
  definitionId: string,
  def: CardDefinition
): CardRewardContribution {
  const f = cardToFeatures(def);

  const isChar   = f.isCharacter === 1;
  const isAction = f.isAction === 1;

  const hasRush       = f.keywords[KW.RUSH] === 1;
  const hasReckless   = f.keywords[KW.RECKLESS] === 1;
  const hasChallenger = f.keywords[KW.CHALLENGER] === 1;
  const hasSinger     = f.keywords[KW.SINGER] === 1;
  const hasRemoval    = f.effectPresence[EF.BANISH] === 1
                     || f.effectPresence[EF.DEAL_DAMAGE] === 1;
  const hasReturnToHand = f.effectPresence[EF.RETURN_TO_HAND] === 1;

  // winWeight — all cards benefit from winning; pure removal actions care slightly less
  const winWeight = (isAction && hasRemoval && !isChar) ? 0.6 : 0.8;

  // loreGain — how much this card wants the "your lore progress" signal
  // Reckless chars can't quest (CRD: must challenge if able) → 0
  // High-lore chars quest frequently → f.loreNorm (lore / 5)
  let loreGain: number;
  if (isChar && hasReckless) {
    loreGain = 0.0;
  } else if (isChar) {
    loreGain = f.loreNorm; // lore=1 → 0.2, lore=2 → 0.4, lore=3 → 0.6
  } else if (f.effectPresence[EF.GAIN_LORE] === 1) {
    loreGain = 0.5; // action cards that grant lore
  } else {
    loreGain = 0.2; // baseline for non-questing cards
  }

  // loreDenial — how much this card cares about stopping opponent's lore
  const loreDenial = hasRemoval    ? 0.7
                   : hasReturnToHand ? 0.5
                   : 0.2;

  // banishValue — how much this card contributes to the "remove their board" signal
  let banishValue = 0.2;
  if (hasRush || hasReckless || hasChallenger) banishValue += 0.3;
  if (hasRemoval) banishValue += 0.3;
  banishValue += f.strengthNorm * 0.3; // strong chars win more challenges
  banishValue = Math.min(banishValue, 1.0);

  // inkEfficiency — Singer saves ink; cheap cards make turn efficiency matter more
  let inkEfficiency = 0.3;
  if (hasSinger) inkEfficiency += 0.4;
  if (f.costNorm <= 0.2) inkEfficiency += 0.3; // cost ≤ 2
  inkEfficiency = Math.min(inkEfficiency, 1.0);

  // tradeQuality — high strength+willpower chars care about challenge trade value
  const tradeQuality = isChar
    ? Math.min((f.strengthNorm + f.willpowerNorm) / 2 + (hasChallenger ? 0.2 : 0), 1.0)
    : 0.1;

  return {
    definitionId,
    weights: { winWeight, loreGain, loreDenial, banishValue, inkEfficiency, tradeQuality },
  };
}

// -----------------------------------------------------------------------------
// DECK INFERENCE
// -----------------------------------------------------------------------------

/**
 * Infer reward weights from a decklist by averaging per-card contributions.
 * Each copy of a card counts separately (4x copies weight 4x in the average).
 * Result is a continuous weight vector — no discrete archetype label needed.
 */
export function inferRewardWeights(
  deck: DeckEntry[],
  definitions: Record<string, CardDefinition>
): RewardWeights {
  const contributions: RewardWeights[] = [];

  for (const entry of deck) {
    const def = definitions[entry.definitionId];
    if (!def) continue;
    const contrib = cardRewardContribution(entry.definitionId, def);
    for (let i = 0; i < entry.count; i++) {
      contributions.push(contrib.weights);
    }
  }

  if (contributions.length === 0) {
    return { winWeight: 0.8, loreGain: 0.5, loreDenial: 0.3,
             banishValue: 0.3, inkEfficiency: 0.3, tradeQuality: 0.3 };
  }

  const n = contributions.length;
  const avg = (field: keyof RewardWeights): number =>
    contributions.reduce((sum, w) => sum + w[field], 0) / n;

  return {
    winWeight:     avg("winWeight"),
    loreGain:      avg("loreGain"),
    loreDenial:    avg("loreDenial"),
    banishValue:   avg("banishValue"),
    inkEfficiency: avg("inkEfficiency"),
    tradeQuality:  avg("tradeQuality"),
  };
}

// -----------------------------------------------------------------------------
// REWARD FUNCTION COMPILER
// -----------------------------------------------------------------------------

/**
 * Compile a RewardWeights vector into a reward function for trainPolicy().
 * All signals are normalized to [0,1]; final reward is their weighted average.
 *
 * Signals available from GameResult:
 *   winSignal         — win=1 / draw=0.5 / loss=0
 *   loreGainSignal    — finalLore.player1 / 20
 *   loreDenialSignal  — 1 - (finalLore.player2 / 20)
 *   banishSignal      — lore-weighted P2 chars banished (proxy: loreContributed+1)
 *   inkEfficiencySignal — lore-per-turn rate (proxy for ink use)
 *   tradeSignal       — net lore-value traded in challenges, shifted to [0,1]
 *
 * Note: banish/trade signals use stat.loreContributed+1 as a proxy for card value
 * (actual printed lore stat not stored in CardGameStats). Characters that never
 * quested count as 1. To use printed lore stats, pass definitions as a second arg.
 */
export function makeWeightedReward(
  weights: RewardWeights
): (result: GameResult) => number {
  return function weightedReward(result: GameResult): number {
    // Win/loss
    const winSignal =
      result.winner === "player1" ? 1.0 :
      result.winner === "draw"    ? 0.5 : 0.0;

    // Lore race
    const loreGainSignal    = Math.min((result.finalLore["player1"] ?? 0) / 20, 1);
    const loreDenialSignal  = 1 - Math.min((result.finalLore["player2"] ?? 0) / 20, 1);

    // Banish value: sum (loreContributed + 1) for each P2 char banished
    let p1BanishedProxy = 0;
    let p2BanishedProxy = 0;
    for (const stat of Object.values(result.cardStats)) {
      if (!stat.wasBanished) continue;
      const proxy = stat.loreContributed + 1; // +1 floor for chars that never quested
      if (stat.ownerId === "player2") p2BanishedProxy += proxy;
      else p1BanishedProxy += proxy;
    }
    const banishSignal = Math.min(p2BanishedProxy / 10, 1);

    // Ink efficiency proxy: lore-per-turn rate (normalized; 3 lore/turn = excellent)
    const turns = Math.max(result.turns, 1);
    const lorePerTurn = (result.finalLore["player1"] ?? 0) / turns;
    const inkEfficiencySignal = Math.min(lorePerTurn / 3, 1);

    // Trade quality: net lore-value traded, shifted from [-10,+10] to [0,1]
    const tradeRaw = (p2BanishedProxy - p1BanishedProxy) / 10;
    const tradeSignal = Math.max(0, Math.min(tradeRaw * 0.5 + 0.5, 1));

    // Weighted average (normalized by sum of weights)
    const totalWeight =
      weights.winWeight + weights.loreGain + weights.loreDenial +
      weights.banishValue + weights.inkEfficiency + weights.tradeQuality;

    if (totalWeight === 0) return winSignal;

    return (
      weights.winWeight     * winSignal +
      weights.loreGain      * loreGainSignal +
      weights.loreDenial    * loreDenialSignal +
      weights.banishValue   * banishSignal +
      weights.inkEfficiency * inkEfficiencySignal +
      weights.tradeQuality  * tradeSignal
    ) / totalWeight;
  };
}
