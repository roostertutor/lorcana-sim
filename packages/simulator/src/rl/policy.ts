// =============================================================================
// RL POLICY — Actor-Critic with Generalized Advantage Estimation (GAE)
// Implements BotStrategy. Scores each legal action individually.
//
// Architecture:
//   actionNet  : (state + action features) → score  [policy / actor]
//   mulliganNet: (state features)           → [mulligan, keep]
//   valueNet   : (state features)           → V(s)   [critic]
//
// Update: A2C with GAE (λ=0.95). Per-step advantages replace the old
// episode-level REINFORCE return. Critic is updated with MSE loss.
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
import {
  enumerateMultiPickCombos,
  getMultiPickRange,
  MAX_MULTI_PICK_CANDIDATES,
} from "../bots/multiPick.js";

// GAE discount on the eligibility trace (λ in the literature)
const GAE_LAMBDA = 0.95;

// Weight of value loss relative to policy loss (standard A2C ratio)
const VALUE_LOSS_WEIGHT = 0.5;

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface EpisodeStep {
  stateFeatures: number[];
  chosenActionFeatures?: number[];
  logProbChosen: number;
  isAction: boolean;
  mulliganIndex?: number;
  turnIndex: number;
  reward: number;    // per-step reward — filled in updateFromEpisode
  valuePred: number; // critic's V(s) at this step
}

export interface RLPolicyJSON {
  name: string;
  epsilon: number;
  explorationRng: RngState;
  actionNet: NetworkJSON;
  mulliganNet: NetworkJSON;
  valueNet?: NetworkJSON; // optional for backward compat with old saves
}

// -----------------------------------------------------------------------------
// POLICY
// -----------------------------------------------------------------------------

export class RLPolicy implements BotStrategy {
  readonly name: string;
  readonly type: BotType = "algorithm";
  readonly actionNet: NeuralNetwork;
  readonly mulliganNet: NeuralNetwork;
  readonly valueNet: NeuralNetwork;
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

    // Action network (actor): (state + action features) → single score
    this.actionNet = new NeuralNetwork(
      NETWORK_INPUT_SIZE, 128, 64, 1, networkRng
    );

    // Mulligan network: state features → [mulligan, keep]
    this.mulliganNet = new NeuralNetwork(
      STATE_FEATURE_SIZE, 64, 32, 2, networkRng
    );

    // Value network (critic): state features → V(s)
    this.valueNet = new NeuralNetwork(
      STATE_FEATURE_SIZE, 64, 32, 1, networkRng
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
    const valuePred = this.valueNet.forward(stateFeats)[0]!;
    const legal = getAllLegalActions(state, playerId, definitions);

    // No legal actions — pass
    if (legal.length === 0) {
      return { type: "PASS_TURN", playerId };
    }

    // Pre-allocate input buffer for network forward passes
    const inputBuffer = new Float32Array(NETWORK_INPUT_SIZE);
    inputBuffer.set(stateFeats, 0);

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
        inputBuffer.set(actionFeats, STATE_FEATURE_SIZE);
        scores.push(this.actionNet.forward(inputBuffer)[0]!);
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
      turnIndex: state.turnNumber,
      reward: 0,
      valuePred,
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
    const valuePred = this.valueNet.forward(stateFeats)[0]!;

    // CRD 2.2.2: Mulligan — use mulliganNet to decide keep vs full redraw
    if (choice.type === "choose_mulligan") {
      const hand = choice.validTargets ?? [];

      if (rngNext(this.explorationRng) < this.epsilon) {
        const shouldMull = rngNext(this.explorationRng) < 0.5;
        const mulliganIndex = shouldMull ? 0 : 1;
        const logProb = -Math.log(2);
        this.episodeHistory.push({
          stateFeatures: stateFeats,
          logProbChosen: logProb,
          isAction: false,
          mulliganIndex,
          turnIndex: state.turnNumber,
          reward: 0,
          valuePred,
        });
        return { type: "RESOLVE_CHOICE", playerId, choice: shouldMull ? hand : [] };
      }

      const probs = softmax(this.mulliganNet.forward(stateFeats));
      const shouldMull = probs[0]! > probs[1]!; // [0]=mulligan, [1]=keep
      const chosenIdx = shouldMull ? 0 : 1;
      const logProb = Math.log(Math.max(probs[chosenIdx]!, 1e-10));
      this.episodeHistory.push({
        stateFeatures: stateFeats,
        logProbChosen: logProb,
        isAction: false,
        mulliganIndex: chosenIdx,
        turnIndex: state.turnNumber,
        reward: 0,
        valuePred,
      });
      return { type: "RESOLVE_CHOICE", playerId, choice: shouldMull ? hand : [] };
    }

    // Build candidate actions based on choice type
    const candidates: GameAction[] = [];

    switch (choice.type) {
      case "choose_trigger": {
        // CRD 7.7.4: pick first trigger (order rarely affects outcome; not worth scoring)
        candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: choice.validTargets?.[0] ?? "0" });
        break;
      }
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
        // For choose_target, pendingEffect.maxToHand is undefined → maxSize=1
        // (preserves prior single-pick behavior). For choose_from_revealed
        // backed by look_at_top with maxToHand>1 (Dig a Little Deeper,
        // Look at This Family), we must enumerate multi-pick combinations —
        // single-pick candidates would underfill, leaving the bot taking 1
        // card instead of the required N.
        const { minSize, maxSize } = getMultiPickRange(choice);
        if (maxSize <= 1) {
          for (const target of targets) {
            candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: [target] });
          }
          if (choice.optional) {
            candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: [] });
          }
        } else {
          const combos = enumerateMultiPickCombos(targets, minSize, maxSize);
          for (const combo of combos) {
            candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: combo });
          }
          // Safety net: if the combo enumerator hit the cap (huge reveal
          // pile), guarantee at least one valid mandatory candidate by
          // greedy top-K scoring of individual cards. Without this, a
          // truncated enumeration could miss the highest-scoring picks.
          if (combos.length >= MAX_MULTI_PICK_CANDIDATES) {
            const greedyBuffer = new Float32Array(NETWORK_INPUT_SIZE);
            greedyBuffer.set(stateFeats, 0);
            const scored = targets.map((t) => {
              const a: GameAction = { type: "RESOLVE_CHOICE", playerId, choice: [t] };
              greedyBuffer.set(actionToFeatures(state, a, playerId, definitions), STATE_FEATURE_SIZE);
              return { id: t, score: this.actionNet.forward(greedyBuffer)[0]! };
            });
            scored.sort((a, b) => b.score - a.score);
            candidates.push({
              type: "RESOLVE_CHOICE",
              playerId,
              choice: scored.slice(0, maxSize).map((s) => s.id),
            });
          }
        }
        break;
      }
      case "choose_order": {
        // Bot uses the existing order (no preference on ordering)
        candidates.push({ type: "RESOLVE_CHOICE", playerId, choice: choice.validTargets ?? [] });
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
          const discardBuffer = new Float32Array(NETWORK_INPUT_SIZE);
          discardBuffer.set(stateFeats, 0);
          const scored = targets.map((t) => {
            const action: GameAction = { type: "RESOLVE_CHOICE", playerId, choice: [t] };
            const feats = actionToFeatures(state, action, playerId, definitions);
            discardBuffer.set(feats, STATE_FEATURE_SIZE);
            const score = this.actionNet.forward(discardBuffer)[0]!;
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

    // Pre-allocate input buffer for network forward passes
    const choiceBuffer = new Float32Array(NETWORK_INPUT_SIZE);
    choiceBuffer.set(stateFeats, 0);

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
        choiceBuffer.set(actionFeats, STATE_FEATURE_SIZE);
        scores.push(this.actionNet.forward(choiceBuffer)[0]!);
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
      turnIndex: state.turnNumber,
      reward: 0,
      valuePred,
    });

    return chosenAction;
  }

  shouldMulligan(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): boolean {
    const features = stateToFeatures(state, playerId, definitions);
    const valuePred = this.valueNet.forward(features)[0]!;

    if (rngNext(this.explorationRng) < this.epsilon) {
      const shouldMull = rngNext(this.explorationRng) < 0.5;
      this.episodeHistory.push({
        stateFeatures: features,
        logProbChosen: -Math.log(2),
        isAction: false,
        mulliganIndex: shouldMull ? 0 : 1,
        turnIndex: 0,
        reward: 0,
        valuePred,
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
      turnIndex: 0,
      reward: 0,
      valuePred,
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

  /**
   * Update networks from a completed episode using Actor-Critic with GAE.
   *
   * @param terminalReward  Final episode reward (win/loss/weighted)
   * @param lr              Learning rate
   * @param gamma           Discount factor
   * @param perStepRewards  Optional per-turn intermediate rewards, indexed by turnIndex.
   *                        Each turn's reward is assigned to the last step of that turn.
   */
  updateFromEpisode(
    terminalReward: number,
    lr: number,
    gamma: number,
    perStepRewards?: number[]
  ): void {
    const history = this.episodeHistory;
    const T = history.length;
    if (T === 0) return;

    // Normalize LR by episode length to prevent gradient accumulation
    const stepLr = lr / Math.sqrt(T);

    // --- Assign per-step rewards ---
    // Per-turn rewards go to the LAST step of each turn to avoid double-counting
    // when multiple actions occur in the same turn.
    if (perStepRewards) {
      let lastTurnIdx = -1;
      for (let i = T - 1; i >= 0; i--) {
        const t = history[i]!.turnIndex;
        if (t !== lastTurnIdx) {
          history[i]!.reward = perStepRewards[t] ?? 0;
          lastTurnIdx = t;
        }
      }
    }
    // Terminal reward added to the final step
    history[T - 1]!.reward += terminalReward;

    // --- Compute GAE advantages backward ---
    // delta_t = r_t + γ * V(s_{t+1}) - V(s_t)
    // A_t     = delta_t + (γλ) * A_{t+1}
    // return_t = A_t + V(s_t)   ← target for critic
    const advantages = new Float32Array(T);
    const returns = new Float32Array(T);
    let gae = 0;

    for (let i = T - 1; i >= 0; i--) {
      const step = history[i]!;
      const nextValue = i + 1 < T ? history[i + 1]!.valuePred : 0; // terminal bootstrap = 0
      const delta = step.reward + gamma * nextValue - step.valuePred;
      gae = delta + gamma * GAE_LAMBDA * gae;
      advantages[i] = gae;
      returns[i] = gae + step.valuePred;
    }

    // --- Update networks ---
    const updateBuffer = new Float32Array(NETWORK_INPUT_SIZE);

    for (let i = 0; i < T; i++) {
      const step = history[i]!;
      const adv = advantages[i]!;
      const ret = returns[i]!;

      if (step.isAction && step.chosenActionFeatures) {
        // Policy (actor) update: ∇ log π(a|s) * A
        const probChosen = Math.exp(step.logProbChosen);
        const dScore = adv * (1 - probChosen);
        updateBuffer.set(step.stateFeatures, 0);
        updateBuffer.set(step.chosenActionFeatures, STATE_FEATURE_SIZE);
        this.actionNet.update(updateBuffer, 0, dScore, stepLr);

        // Value (critic) update: MSE loss weighted by VALUE_LOSS_WEIGHT
        const valueDelta = (ret - step.valuePred) * VALUE_LOSS_WEIGHT;
        this.valueNet.update(step.stateFeatures, 0, valueDelta, stepLr);

      } else if (!step.isAction && step.mulliganIndex !== undefined) {
        // Mulligan network update with GAE advantage
        this.mulliganNet.update(
          step.stateFeatures,
          step.mulliganIndex,
          adv,
          stepLr
        );

        // Critic update for mulligan state
        const valueDelta = (ret - step.valuePred) * VALUE_LOSS_WEIGHT;
        this.valueNet.update(step.stateFeatures, 0, valueDelta, stepLr);
      }
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
      valueNet: this.valueNet.toJSON(),
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

    // valueNet: warm-start if present, otherwise leave randomly initialized
    if (json.valueNet) {
      (policy as unknown as Record<string, NeuralNetwork>)["valueNet"] =
        NeuralNetwork.fromJSON(json.valueNet);
    }

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
