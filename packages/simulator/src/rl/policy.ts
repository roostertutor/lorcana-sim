// =============================================================================
// RL POLICY — Per-card scoring bot using REINFORCE policy gradient
// Implements BotStrategy. Scores each legal action individually.
// =============================================================================

import type {
  CardDefinition,
  GameAction,
  GameState,
  PlayerID,
  RngState,
} from "@lorcana-sim/engine";
import {
  getAllLegalActions,
  rngNext,
  rngNextInt,
  cloneRng,
} from "@lorcana-sim/engine";
import type { BotStrategy, BotType } from "../types.js";
import { performMulligan } from "../mulligan.js";
import {
  stateToFeatures,
  actionToFeatures,
  STATE_FEATURE_SIZE,
  ACTION_FEATURE_SIZE,
  NETWORK_INPUT_SIZE,
} from "./autoTag.js";
import { NeuralNetwork, softmax } from "./network.js";
import type { NetworkJSON } from "./network.js";

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface EpisodeStep {
  stateFeatures: number[];
  chosenActionFeatures?: number[];
  logProbChosen: number;
  isAction: boolean;
  mulliganIndex?: number;
}

export interface RLPolicyJSON {
  name: string;
  epsilon: number;
  explorationRng: RngState;
  actionNet: NetworkJSON;
  mulliganNet: NetworkJSON;
}

// -----------------------------------------------------------------------------
// POLICY
// -----------------------------------------------------------------------------

export class RLPolicy implements BotStrategy {
  readonly name: string;
  readonly type: BotType = "algorithm";
  readonly actionNet: NeuralNetwork;
  readonly mulliganNet: NeuralNetwork;
  epsilon: number;
  private explorationRng: RngState;
  private episodeHistory: EpisodeStep[] = [];

  constructor(
    name: string,
    explorationRng: RngState,
    networkRng?: RngState,
    epsilon: number = 1.0
  ) {
    this.name = name;
    this.epsilon = epsilon;
    this.explorationRng = explorationRng;

    // Action network: (state + action features) → single score
    this.actionNet = new NeuralNetwork(
      NETWORK_INPUT_SIZE, 128, 64, 1, networkRng
    );

    // Mulligan network: state features → [mulligan, keep]
    this.mulliganNet = new NeuralNetwork(
      STATE_FEATURE_SIZE, 64, 32, 2, networkRng
    );
  }

  decideAction(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): GameAction {
    // Handle pending choices
    if (state.pendingChoice) {
      return this.resolvePendingChoice(state, playerId, definitions);
    }

    const stateFeats = stateToFeatures(state, playerId, definitions);
    const legal = getAllLegalActions(state, playerId, definitions);

    // No legal actions — pass
    if (legal.length === 0) {
      return { type: "PASS_TURN", playerId };
    }

    // ε-greedy exploration
    let chosenIdx: number;
    let logProb: number;

    if (rngNext(this.explorationRng) < this.epsilon) {
      // Explore: random action
      chosenIdx = rngNextInt(this.explorationRng, legal.length);
      logProb = -Math.log(legal.length); // uniform probability
    } else {
      // Exploit: score each action, softmax, pick argmax
      const scores: number[] = [];
      for (const action of legal) {
        const actionFeats = actionToFeatures(state, action, playerId, definitions);
        const input = [...stateFeats, ...actionFeats];
        scores.push(this.actionNet.forward(input)[0]!);
      }
      const probs = softmax(scores);
      chosenIdx = argmax(probs);
      logProb = Math.log(Math.max(probs[chosenIdx]!, 1e-10));
    }

    const chosenAction = legal[chosenIdx]!;
    const chosenActionFeats = actionToFeatures(state, chosenAction, playerId, definitions);

    // Record step
    this.episodeHistory.push({
      stateFeatures: stateFeats,
      chosenActionFeatures: chosenActionFeats,
      logProbChosen: logProb,
      isAction: true,
    });

    return chosenAction;
  }

  /** Resolve pending choices by scoring each option */
  private resolvePendingChoice(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): GameAction {
    const choice = state.pendingChoice!;
    const stateFeats = stateToFeatures(state, playerId, definitions);

    // Build candidate actions based on choice type
    const candidates: GameAction[] = [];

    switch (choice.type) {
      case "choose_may": {
        candidates.push(
          { type: "RESOLVE_CHOICE", playerId, choice: "accept" },
          { type: "RESOLVE_CHOICE", playerId, choice: "decline" }
        );
        break;
      }
      case "choose_target":
      case "choose_from_revealed": {
        const targets = choice.validTargets ?? [];
        for (const target of targets) {
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: [target] });
        }
        if (choice.optional) {
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: [] });
        }
        break;
      }
      case "choose_discard": {
        // Greedy: pick targets one at a time by score
        const targets = choice.validTargets ?? [];
        const count = choice.count ?? 1;
        if (targets.length <= count) {
          // Must discard all valid targets
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: targets });
        } else {
          // Score each card, pick worst N to discard
          const scored = targets.map((t) => {
            const action: GameAction = { type: "RESOLVE_CHOICE", playerId, choice: [t] };
            const feats = actionToFeatures(state, action, playerId, definitions);
            const input = [...stateFeats, ...feats];
            const score = this.actionNet.forward(input)[0]!;
            return { id: t, score };
          });
          // Sort ascending — discard the least valued cards
          scored.sort((a, b) => a.score - b.score);
          const discardIds = scored.slice(0, count).map((s) => s.id);
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: discardIds });
        }
        break;
      }
      case "choose_option": {
        const options = choice.options ?? [];
        for (let i = 0; i < options.length; i++) {
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: i });
        }
        break;
      }
      case "choose_cards": {
        const targets = choice.validTargets ?? [];
        for (const target of targets) {
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: [target] });
        }
        if (choice.optional || targets.length === 0) {
          candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: [] });
        }
        break;
      }
    }

    // Fallback if no candidates
    if (candidates.length === 0) {
      return { type: "RESOLVE_CHOICE", playerId, choice: [] };
    }

    // ε-greedy over candidates
    let chosenIdx: number;
    let logProb: number;

    if (rngNext(this.explorationRng) < this.epsilon) {
      chosenIdx = rngNextInt(this.explorationRng, candidates.length);
      logProb = -Math.log(candidates.length);
    } else {
      const scores: number[] = [];
      for (const action of candidates) {
        const actionFeats = actionToFeatures(state, action, playerId, definitions);
        const input = [...stateFeats, ...actionFeats];
        scores.push(this.actionNet.forward(input)[0]!);
      }
      const probs = softmax(scores);
      chosenIdx = argmax(probs);
      logProb = Math.log(Math.max(probs[chosenIdx]!, 1e-10));
    }

    const chosenAction = candidates[chosenIdx]!;
    const chosenActionFeats = actionToFeatures(state, chosenAction, playerId, definitions);

    this.episodeHistory.push({
      stateFeatures: stateFeats,
      chosenActionFeatures: chosenActionFeats,
      logProbChosen: logProb,
      isAction: true,
    });

    return chosenAction;
  }

  shouldMulligan(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): boolean {
    const features = stateToFeatures(state, playerId, definitions);

    if (rngNext(this.explorationRng) < this.epsilon) {
      const shouldMull = rngNext(this.explorationRng) < 0.5;
      this.episodeHistory.push({
        stateFeatures: features,
        logProbChosen: -Math.log(2),
        isAction: false,
        mulliganIndex: shouldMull ? 0 : 1,
      });
      return shouldMull;
    }

    const probs = softmax(this.mulliganNet.forward(features));
    const shouldMull = probs[0]! > probs[1]!; // [0]=mulligan, [1]=keep
    const chosenIdx = shouldMull ? 0 : 1;
    const logProb = Math.log(Math.max(probs[chosenIdx]!, 1e-10));

    this.episodeHistory.push({
      stateFeatures: features,
      logProbChosen: logProb,
      isAction: false,
      mulliganIndex: chosenIdx,
    });

    return shouldMull;
  }

  performMulligan(
    state: GameState,
    playerId: PlayerID,
    _definitions: Record<string, CardDefinition>
  ): GameState {
    return performMulligan(state, playerId);
  }

  /** Running average reward baseline for variance reduction */
  private rewardBaseline = 0;
  private baselineAlpha = 0.01;

  /**
   * Update networks from completed episode using REINFORCE with baseline.
   * Walk history backward applying discounted returns.
   * Uses running average baseline to reduce variance.
   */
  updateFromEpisode(G: number, lr: number, gamma: number): void {
    // Update baseline (exponential moving average)
    this.rewardBaseline += this.baselineAlpha * (G - this.rewardBaseline);
    const advantage = G - this.rewardBaseline;

    // Normalize learning rate by episode length to prevent gradient accumulation
    const nSteps = this.episodeHistory.length;
    if (nSteps === 0) return;
    const stepLr = lr / Math.sqrt(nSteps);

    let discountedAdv = advantage;

    for (let i = this.episodeHistory.length - 1; i >= 0; i--) {
      const step = this.episodeHistory[i]!;

      if (step.isAction && step.chosenActionFeatures) {
        const probChosen = Math.exp(step.logProbChosen);
        const dScore = discountedAdv * (1 - probChosen);
        const input = [...step.stateFeatures, ...step.chosenActionFeatures];
        this.actionNet.update(input, 0, dScore, stepLr);
      } else if (!step.isAction && step.mulliganIndex !== undefined) {
        this.mulliganNet.update(
          step.stateFeatures,
          step.mulliganIndex,
          discountedAdv,
          stepLr
        );
      }

      discountedAdv *= gamma;
    }

    this.episodeHistory = [];
  }

  /** Decay epsilon toward a minimum */
  decayEpsilon(minEpsilon: number, decayRate: number): void {
    this.epsilon = Math.max(minEpsilon, this.epsilon * decayRate);
  }

  /** Get episode history length (for testing) */
  get historyLength(): number {
    return this.episodeHistory.length;
  }

  /** Clear episode history without updating */
  clearHistory(): void {
    this.episodeHistory = [];
  }

  /** Serialize to JSON */
  toJSON(): RLPolicyJSON {
    return {
      name: this.name,
      epsilon: this.epsilon,
      explorationRng: { s: [...this.explorationRng.s] as [number, number, number, number] },
      actionNet: this.actionNet.toJSON(),
      mulliganNet: this.mulliganNet.toJSON(),
    };
  }

  /** Reconstruct from JSON */
  static fromJSON(json: RLPolicyJSON): RLPolicy {
    const rng: RngState = { s: [...json.explorationRng.s] as [number, number, number, number] };
    const policy = new RLPolicy(json.name, rng, undefined, json.epsilon);

    // Replace networks with deserialized versions
    (policy as unknown as Record<string, NeuralNetwork>)["actionNet"] =
      NeuralNetwork.fromJSON(json.actionNet);
    (policy as unknown as Record<string, NeuralNetwork>)["mulliganNet"] =
      NeuralNetwork.fromJSON(json.mulliganNet);

    return policy;
  }
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! > arr[best]!) best = i;
  }
  return best;
}
