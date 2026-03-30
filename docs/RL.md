# RL.md
# Reinforcement learning for Lorcana deck strategy.
# The bot starts knowing nothing and discovers how to play a deck
# by playing thousands of games and measuring outcomes.
#
# Goal: a trained policy that tells you things about your deck
# that you don't already know — discovered from outcomes, not encoded.
#
# This replaces RL_MULLIGAN.md. Scope expanded to cover:
#   - Mulligan policy
#   - In-game action policy
#   - Joint training (both policies learn simultaneously)
#   - Curriculum learning (goldfish → real opponent)
#   - Auto-tagging from card data (no manual role assignment)
#
# Package: packages/simulator/src/rl/
# Does NOT modify engine, existing bots, or existing analytics.

---

## Philosophy: No Human Knowledge Encoded

Every previous bot in this codebase encodes human knowledge:
- GreedyBot: "play the most expensive card you can afford"
- RampCindyCowBot: "play Sail on turn 2, Cinderella on turn 3"
- DEFAULT_MULLIGAN: "keep if >= 2 inkable and cheapest cost <= 3"

These bots validate what you already believe. They cannot discover
what you don't know.

The RL bot starts with zero encoded knowledge. It learns by playing.
Everything it discovers — mulligan criteria, sequencing, ink priorities,
matchup adaptations — comes from game outcomes, not human instructions.

The only human input: a reward signal (win/loss or lore gained).
Everything else is discovered.

---

## Architecture Overview

```
packages/simulator/src/rl/
  autoTag.ts         — derive card features from structured ability data
  network.ts         — neural network: forward pass, backprop, weights
  policy.ts          — wraps network: observe state → action + update
  trainer.ts         — training loop: episodes, exploration, curriculum
  index.ts           — exports
```

Four concepts, each independent:

**AutoTagger** — reads CardDefinition (effects, abilities, keywords, stats)
and produces a feature vector. No card names. No manual labels. Pure data.

**Network** — small neural network. Takes a feature vector, outputs action
probabilities. Learns by gradient descent. Weights start random.

**Policy** — wraps the network. Exposes `decideAction()` (implements
BotStrategy interface) and `update()` (called after each game).

**Trainer** — runs N episodes. Handles exploration (try random things),
exploitation (do what you've learned), and curriculum (start easy).

---

## Part 1: Auto-Tagging From Card Data

### File: packages/simulator/src/rl/autoTag.ts

The feature vector is derived entirely from CardDefinition — the same
structured data the engine uses to resolve effects. No card text parsing.
No hardcoded card names. Works for any card in any set.

The engine already has 22 effect types and 13 keywords as structured data.
We read these directly.

### Card Feature Vector

Each card produces a fixed-length numeric vector. The same vector shape
is used for every card — unimplemented abilities produce zeros, which is
correct (unknown = no signal).

```typescript
import type { CardDefinition, Effect, Ability } from "@lorcana-sim/engine";

/**
 * Fixed-length numeric feature vector for a single card.
 * Derived entirely from CardDefinition structured data.
 * All values normalized to [0, 1].
 *
 * Length: CARD_FEATURE_SIZE = 42
 */
export interface CardFeatureVector {
  // === BASIC PROPERTIES (4) ===
  costNorm: number;          // cost / 10
  inkable: number;           // 0 or 1
  isCharacter: number;       // 0 or 1
  isAction: number;          // 0 or 1
  // isItem = 1 - isCharacter - isAction (derivable, not stored)

  // === CHARACTER STATS (4) ===
  strengthNorm: number;      // strength / 10, 0 if not character
  willpowerNorm: number;     // willpower / 10, 0 if not character
  loreNorm: number;          // lore / 5, 0 if not character
  shiftCostNorm: number;     // shiftCost / 10, 0 if no shift

  // === KEYWORDS (13) ===
  // Each: 0 if absent, normalized value if present (e.g. challenger +2 → 0.2)
  hasShift: number;
  hasEvasive: number;
  hasRush: number;
  hasBodyguard: number;
  hasWard: number;
  hasReckless: number;
  hasChallenger: number;     // value / 10
  hasSupport: number;
  hasSinger: number;         // value / 10 (singer N)
  hasSingTogether: number;
  hasResist: number;         // value / 10
  hasBoost: number;
  hasVanish: number;

  // === EFFECT PRESENCE (22) ===
  // 1 if this card has this effect type anywhere (action, ability, trigger)
  // Order matches engine effect type list for consistency
  hasDraw: number;
  hasDealDamage: number;
  hasRemoveDamage: number;
  hasBanish: number;
  hasReturnToHand: number;
  hasGainLore: number;
  hasGainStats: number;
  hasExert: number;
  hasReady: number;
  hasGrantKeyword: number;
  hasCantAction: number;
  hasLookAtTop: number;      // scry / card selection
  hasDiscardFromHand: number;
  hasMoveToInkwell: number;  // Tipo pattern: put card in inkwell
  hasGrantExtraInkPlay: number; // Sail pattern: extra ink play this turn
  hasPlayForFree: number;
  hasShuffleIntoDeck: number;
  hasCostReduction: number;
  hasLoseLore: number;
  hasGainStatsConditional: number; // conditional_on_target
  hasSequential: number;     // "[A] to [B]" or "[A]. If you do, [B]"
  hasCreateFloatingTrigger: number; // creates ongoing triggers

  // === TRIGGER PRESENCE (1) ===
  hasEntersPlayTrigger: number;  // 0 or 1
  // (other trigger types less common, can add later)
}

export const CARD_FEATURE_SIZE = 43; // count above

/**
 * Extract feature vector from a CardDefinition.
 * Pure function — same input always produces same output.
 */
export function cardToFeatures(def: CardDefinition): CardFeatureVector {
  const allEffects = collectAllEffects(def);
  const allKeywords = collectAllKeywords(def);

  function hasEffect(type: string): number {
    return allEffects.some(e => e.type === type) ? 1 : 0;
  }

  function keywordValue(kw: string): number {
    const k = allKeywords.find(k => k.keyword === kw);
    if (!k) return 0;
    return k.value ? Math.min(k.value / 10, 1) : 1;
  }

  return {
    // Basic
    costNorm: Math.min(def.cost / 10, 1),
    inkable: def.inkable ? 1 : 0,
    isCharacter: def.cardType === "character" ? 1 : 0,
    isAction: def.cardType === "action" ? 1 : 0,

    // Character stats
    strengthNorm: Math.min((def.strength ?? 0) / 10, 1),
    willpowerNorm: Math.min((def.willpower ?? 0) / 10, 1),
    loreNorm: Math.min((def.lore ?? 0) / 5, 1),
    shiftCostNorm: Math.min((def.shiftCost ?? 0) / 10, 1),

    // Keywords
    hasShift:           keywordValue("shift"),
    hasEvasive:         keywordValue("evasive"),
    hasRush:            keywordValue("rush"),
    hasBodyguard:       keywordValue("bodyguard"),
    hasWard:            keywordValue("ward"),
    hasReckless:        keywordValue("reckless"),
    hasChallenger:      keywordValue("challenger"),
    hasSupport:         keywordValue("support"),
    hasSinger:          keywordValue("singer"),
    hasSingTogether:    keywordValue("sing together"),
    hasResist:          keywordValue("resist"),
    hasBoost:           keywordValue("boost"),
    hasVanish:          keywordValue("vanish"),

    // Effects
    hasDraw:                    hasEffect("draw"),
    hasDealDamage:              hasEffect("deal_damage"),
    hasRemoveDamage:            hasEffect("remove_damage"),
    hasBanish:                  hasEffect("banish"),
    hasReturnToHand:            hasEffect("return_to_hand"),
    hasGainLore:                hasEffect("gain_lore"),
    hasGainStats:               hasEffect("gain_stats"),
    hasExert:                   hasEffect("exert"),
    hasReady:                   hasEffect("ready"),
    hasGrantKeyword:            hasEffect("grant_keyword"),
    hasCantAction:              hasEffect("cant_action"),
    hasLookAtTop:               hasEffect("look_at_top"),
    hasDiscardFromHand:         hasEffect("discard_from_hand"),
    hasMoveToInkwell:           hasEffect("move_to_inkwell"),
    hasGrantExtraInkPlay:       hasEffect("grant_extra_ink_play"),
    hasPlayForFree:             hasEffect("play_for_free"),
    hasShuffleIntoDeck:         hasEffect("shuffle_into_deck"),
    hasCostReduction:           hasEffect("cost_reduction"),
    hasLoseLore:                hasEffect("lose_lore"),
    hasGainStatsConditional:    hasEffect("conditional_on_target"),
    hasSequential:              hasEffect("sequential"),
    hasCreateFloatingTrigger:   hasEffect("create_floating_trigger"),

    // Triggers
    hasEntersPlayTrigger: def.abilities.some(a =>
      a.type === "triggered" && a.trigger.on === "enters_play"
    ) ? 1 : 0,
  };
}

/** Flatten CardFeatureVector to number[] in a stable order. */
export function cardFeaturesToArray(f: CardFeatureVector): number[] {
  return [
    f.costNorm, f.inkable, f.isCharacter, f.isAction,
    f.strengthNorm, f.willpowerNorm, f.loreNorm, f.shiftCostNorm,
    f.hasShift, f.hasEvasive, f.hasRush, f.hasBodyguard, f.hasWard,
    f.hasReckless, f.hasChallenger, f.hasSupport, f.hasSinger,
    f.hasSingTogether, f.hasResist, f.hasBoost, f.hasVanish,
    f.hasDraw, f.hasDealDamage, f.hasRemoveDamage, f.hasBanish,
    f.hasReturnToHand, f.hasGainLore, f.hasGainStats, f.hasExert,
    f.hasReady, f.hasGrantKeyword, f.hasCantAction, f.hasLookAtTop,
    f.hasDiscardFromHand, f.hasMoveToInkwell, f.hasGrantExtraInkPlay,
    f.hasPlayForFree, f.hasShuffleIntoDeck, f.hasCostReduction,
    f.hasLoseLore, f.hasGainStatsConditional, f.hasSequential,
    f.hasCreateFloatingTrigger, f.hasEntersPlayTrigger,
  ];
}

// --- Helpers ---

function collectAllEffects(def: CardDefinition): Effect[] {
  const effects: Effect[] = [];

  // Action effects (top-level)
  for (const e of def.actionEffects ?? []) {
    effects.push(e);
    collectNestedEffects(e, effects);
  }

  // Ability effects
  for (const ab of def.abilities) {
    if (ab.type === "triggered" || ab.type === "activated") {
      for (const e of ab.effects ?? []) {
        effects.push(e);
        collectNestedEffects(e, effects);
      }
    }
  }

  return effects;
}

function collectNestedEffects(effect: Effect, out: Effect[]): void {
  // Sequential: costEffects + rewardEffects
  if (effect.type === "sequential") {
    for (const e of [...(effect.costEffects ?? []), ...(effect.rewardEffects ?? [])]) {
      out.push(e);
      collectNestedEffects(e, out);
    }
  }
}

function collectAllKeywords(def: CardDefinition) {
  return def.abilities
    .filter((a): a is import("@lorcana-sim/engine").KeywordAbility => a.type === "keyword")
    .map(a => ({ keyword: a.keyword, value: a.value }));
}
```

### Game State Feature Vector

What the in-game policy observes at each decision point.

```typescript
/**
 * Feature vector for the full game state at a decision point.
 * Represents everything relevant to choosing an action.
 *
 * Hand cards: up to 10 card slots × CARD_FEATURE_SIZE features
 * Board cards: up to 8 my + 8 opponent card slots × CARD_FEATURE_SIZE features
 * Game context: 12 scalar features
 *
 * Total: (10 + 8 + 8) × 43 + 12 = 1118 features
 * (Unused slots are zero-padded)
 */
export const MAX_HAND_SLOTS = 10;
export const MAX_BOARD_SLOTS = 8;
export const CONTEXT_FEATURES = 12;
export const STATE_FEATURE_SIZE =
  (MAX_HAND_SLOTS + MAX_BOARD_SLOTS + MAX_BOARD_SLOTS) * CARD_FEATURE_SIZE
  + CONTEXT_FEATURES;

/**
 * Extract the full game state feature vector.
 * Called before every action decision.
 */
export function stateToFeatures(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): number[] {
  const opponentId = playerId === "player1" ? "player2" : "player1";
  const features: number[] = [];

  // My hand (up to MAX_HAND_SLOTS cards, zero-padded)
  const hand = getZone(state, playerId, "hand");
  for (let i = 0; i < MAX_HAND_SLOTS; i++) {
    const id = hand[i];
    const def = id ? definitions[state.cards[id]?.definitionId ?? ""] : undefined;
    const vec = def ? cardFeaturesToArray(cardToFeatures(def)) : new Array(CARD_FEATURE_SIZE).fill(0);
    features.push(...vec);
  }

  // My board (up to MAX_BOARD_SLOTS, zero-padded)
  const myPlay = getZone(state, playerId, "play");
  for (let i = 0; i < MAX_BOARD_SLOTS; i++) {
    const id = myPlay[i];
    const def = id ? definitions[state.cards[id]?.definitionId ?? ""] : undefined;
    const inst = id ? state.cards[id] : undefined;
    const vec = def && inst ? cardFeaturesToArray({
      ...cardToFeatures(def),
      // Augment with in-play state
      hasEvasive: inst.isExerted ? 0 : (def.abilities.some(a =>
        a.type === "keyword" && a.keyword === "evasive") ? 1 : 0),
    }) : new Array(CARD_FEATURE_SIZE).fill(0);
    features.push(...vec);
  }

  // Opponent board (up to MAX_BOARD_SLOTS, zero-padded)
  const oppPlay = getZone(state, opponentId, "play");
  for (let i = 0; i < MAX_BOARD_SLOTS; i++) {
    const id = oppPlay[i];
    const def = id ? definitions[state.cards[id]?.definitionId ?? ""] : undefined;
    const vec = def ? cardFeaturesToArray(cardToFeatures(def)) : new Array(CARD_FEATURE_SIZE).fill(0);
    features.push(...vec);
  }

  // Game context (12 scalar features, all normalized to [0,1])
  const myPlayer = state.players[playerId];
  const oppPlayer = state.players[opponentId];
  features.push(
    Math.min(state.turnNumber / 30, 1),            // turn progress
    Math.min(myPlayer.lore / 20, 1),               // my lore
    Math.min(oppPlayer.lore / 20, 1),              // opponent lore
    (myPlayer.lore - oppPlayer.lore + 20) / 40,    // lore delta, centered
    Math.min(myPlayer.availableInk / 10, 1),       // my ink
    Math.min(hand.length / 10, 1),                 // my hand size
    Math.min(myPlay.length / 8, 1),                // my board size
    Math.min(oppPlay.length / 8, 1),               // opponent board size
    Math.min(getZone(state, playerId, "deck").length / 60, 1),  // deck remaining
    Math.min(getZone(state, playerId, "inkwell").length / 10, 1), // inkwell size
    myPlayer.hasPlayedInkThisTurn ? 1 : 0,         // already inked this turn
    state.pendingChoice ? 1 : 0,                   // choice pending
  );

  return features;
}
```

---

## Part 2: Neural Network

### File: packages/simulator/src/rl/network.ts

A small feedforward neural network implemented in plain TypeScript.
No external dependencies. Weights are just numbers — serializable to JSON.

**Architecture:**
```
Input (STATE_FEATURE_SIZE ≈ 1118)
  → Hidden layer 1 (128 neurons, ReLU)
  → Hidden layer 2 (64 neurons, ReLU)
  → Output (ACTION_COUNT neurons, softmax)
```

This is small enough to train on CPU in reasonable time. Large enough
to learn non-linear relationships between card properties and outcomes.

```typescript
export class NeuralNetwork {
  // Weight matrices stored as flat arrays (row-major)
  private w1: Float32Array;  // input → hidden1: INPUT × H1
  private b1: Float32Array;  // bias hidden1: H1
  private w2: Float32Array;  // hidden1 → hidden2: H1 × H2
  private b2: Float32Array;  // bias hidden2: H2
  private w3: Float32Array;  // hidden2 → output: H2 × OUTPUT
  private b3: Float32Array;  // bias output: OUTPUT

  constructor(
    readonly inputSize: number,
    readonly h1Size: number,
    readonly h2Size: number,
    readonly outputSize: number,
  ) {
    // Xavier initialization — prevents vanishing/exploding gradients
    const scale1 = Math.sqrt(2 / inputSize);
    const scale2 = Math.sqrt(2 / h1Size);
    const scale3 = Math.sqrt(2 / h2Size);

    this.w1 = randomFloat32(inputSize * h1Size, scale1);
    this.b1 = new Float32Array(h1Size);
    this.w2 = randomFloat32(h1Size * h2Size, scale2);
    this.b2 = new Float32Array(h2Size);
    this.w3 = randomFloat32(h2Size * outputSize, scale3);
    this.b3 = new Float32Array(outputSize);
  }

  /**
   * Forward pass: input features → action probabilities.
   * Returns softmax probabilities over all possible actions.
   */
  forward(input: number[]): number[] {
    // Layer 1: input → h1, ReLU
    const h1 = relu(matmul(input, this.w1, this.inputSize, this.h1Size, this.b1));
    // Layer 2: h1 → h2, ReLU
    const h2 = relu(matmul(h1, this.w2, this.h1Size, this.h2Size, this.b2));
    // Output: h2 → logits
    const logits = matmul(h2, this.w3, this.h2Size, this.outputSize, this.b3);
    // Softmax: logits → probabilities
    return softmax(logits);
  }

  /**
   * Update weights via policy gradient (REINFORCE).
   * Called after each game episode with the observed return.
   *
   * @param input        State features at decision time
   * @param actionIndex  Which action was taken (index into output)
   * @param G            Discounted return (reward × γ^t)
   * @param lr           Learning rate
   */
  update(input: number[], actionIndex: number, G: number, lr: number): void {
    // Forward pass (cache intermediate values for backprop)
    const h1_pre = matmul(input, this.w1, this.inputSize, this.h1Size, this.b1);
    const h1 = relu(h1_pre);
    const h2_pre = matmul(h1, this.w2, this.h1Size, this.h2Size, this.b2);
    const h2 = relu(h2_pre);
    const logits = matmul(h2, this.w3, this.h2Size, this.outputSize, this.b3);
    const probs = softmax(logits);

    // Policy gradient: ∇log π(a|s) × G
    // For softmax: dL/dlogits[i] = G × (1[i==action] - probs[i])
    const dLogits = probs.map((p, i) => G * ((i === actionIndex ? 1 : 0) - p));

    // Backprop through output layer
    // dL/dw3 = h2^T × dLogits
    for (let i = 0; i < this.h2Size; i++) {
      for (let j = 0; j < this.outputSize; j++) {
        this.w3[i * this.outputSize + j] += lr * h2[i]! * dLogits[j]!;
      }
    }
    for (let j = 0; j < this.outputSize; j++) {
      this.b3[j]! += lr * dLogits[j]!;
    }

    // Backprop through hidden layer 2 (ReLU gate)
    const dH2 = new Float32Array(this.h2Size);
    for (let i = 0; i < this.h2Size; i++) {
      for (let j = 0; j < this.outputSize; j++) {
        dH2[i]! += this.w3[i * this.outputSize + j]! * dLogits[j]!;
      }
      dH2[i]! *= h2_pre[i]! > 0 ? 1 : 0; // ReLU derivative
    }

    for (let i = 0; i < this.h1Size; i++) {
      for (let j = 0; j < this.h2Size; j++) {
        this.w2[i * this.h2Size + j] += lr * h1[i]! * dH2[j]!;
      }
    }
    for (let j = 0; j < this.h2Size; j++) {
      this.b2[j]! += lr * dH2[j]!;
    }

    // Backprop through hidden layer 1 (ReLU gate)
    const dH1 = new Float32Array(this.h1Size);
    for (let i = 0; i < this.h1Size; i++) {
      for (let j = 0; j < this.h2Size; j++) {
        dH1[i]! += this.w2[i * this.h2Size + j]! * dH2[j]!;
      }
      dH1[i]! *= h1_pre[i]! > 0 ? 1 : 0; // ReLU derivative
    }

    for (let i = 0; i < this.inputSize; i++) {
      for (let j = 0; j < this.h1Size; j++) {
        this.w1[i * this.h1Size + j] += lr * input[i]! * dH1[j]!;
      }
    }
    for (let j = 0; j < this.h1Size; j++) {
      this.b1[j]! += lr * dH1[j]!;
    }
  }

  /** Serialize weights to JSON for saving/loading. */
  toJSON() {
    return {
      inputSize: this.inputSize,
      h1Size: this.h1Size,
      h2Size: this.h2Size,
      outputSize: this.outputSize,
      w1: Array.from(this.w1),
      b1: Array.from(this.b1),
      w2: Array.from(this.w2),
      b2: Array.from(this.b2),
      w3: Array.from(this.w3),
      b3: Array.from(this.b3),
    };
  }

  static fromJSON(data: ReturnType<NeuralNetwork["toJSON"]>): NeuralNetwork {
    const net = new NeuralNetwork(data.inputSize, data.h1Size, data.h2Size, data.outputSize);
    net.w1 = new Float32Array(data.w1);
    net.b1 = new Float32Array(data.b1);
    net.w2 = new Float32Array(data.w2);
    net.b2 = new Float32Array(data.b2);
    net.w3 = new Float32Array(data.w3);
    net.b3 = new Float32Array(data.b3);
    return net;
  }
}

// --- Math helpers ---

function relu(x: Float32Array | number[]): number[] {
  return Array.from(x).map(v => Math.max(0, v));
}

function softmax(x: number[]): number[] {
  const max = Math.max(...x);
  const exps = x.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

function matmul(
  input: number[] | Float32Array,
  weights: Float32Array,
  inSize: number,
  outSize: number,
  bias: Float32Array
): number[] {
  const out = new Array(outSize).fill(0);
  for (let j = 0; j < outSize; j++) {
    let sum = bias[j]!;
    for (let i = 0; i < inSize; i++) {
      sum += input[i]! * weights[i * outSize + j]!;
    }
    out[j] = sum;
  }
  return out;
}

function randomFloat32(size: number, scale: number): Float32Array {
  const arr = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    arr[i] = (Math.random() * 2 - 1) * scale;
  }
  return arr;
}
```

---

## Part 3: Policy

### File: packages/simulator/src/rl/policy.ts

The policy wraps the neural network and implements `BotStrategy`.
This means it plugs directly into `runGame` as a drop-in bot.

Two policies are trained simultaneously:
- **MulliganPolicy**: binary decision (keep hand / mulligan)
- **ActionPolicy**: action selection from legal actions

```typescript
import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { getAllLegalActions } from "@lorcana-sim/engine";
import type { BotStrategy } from "../types.js";
import { NeuralNetwork } from "./network.js";
import { stateToFeatures } from "./autoTag.js";
import { performMulligan } from "../mulligan.js";

export const MULLIGAN_NET_OUTPUT = 2;  // [mulligan, keep]
// Action network output: one slot per possible action type
// We use a fixed-size output and map legal actions to slots
export const ACTION_NET_OUTPUT = 8;   // [play_card, play_ink, quest, challenge, activate, pass, resolve_choice_accept, resolve_choice_decline]

/**
 * A trained (or training) RL policy for Lorcana.
 * Implements BotStrategy so it plugs directly into runGame.
 *
 * Both the mulligan network and action network start with random weights.
 * They improve via update() calls after each game episode.
 */
export class RLPolicy implements BotStrategy {
  name: string;
  type: "algorithm" = "algorithm";

  readonly mulliganNet: NeuralNetwork;
  readonly actionNet: NeuralNetwork;

  /** Exploration rate ε. 1.0 = fully random, 0.0 = fully greedy. */
  epsilon: number;

  /** Episode history — (state, action, return) tuples for batch update. */
  private episodeHistory: Array<{
    features: number[];
    actionIndex: number;
    isAction: boolean;  // true = actionNet, false = mulliganNet
  }> = [];

  constructor(
    name: string,
    inputSize: number,
    epsilon = 1.0
  ) {
    this.name = name;
    this.epsilon = epsilon;
    this.mulliganNet = new NeuralNetwork(inputSize, 64, 32, MULLIGAN_NET_OUTPUT);
    this.actionNet = new NeuralNetwork(inputSize, 128, 64, ACTION_NET_OUTPUT);
  }

  // --- BotStrategy interface ---

  decideAction(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): GameAction {
    const features = stateToFeatures(state, playerId, definitions);
    const legal = getAllLegalActions(state, playerId, definitions);

    if (legal.length === 0) return { type: "PASS_TURN", playerId };

    // Handle pending choices
    if (state.pendingChoice) {
      return this.resolvePendingChoice(state, playerId, features);
    }

    // ε-greedy action selection
    let actionIndex: number;
    if (Math.random() < this.epsilon) {
      // Explore: pick random legal action
      actionIndex = Math.floor(Math.random() * legal.length);
    } else {
      // Exploit: use network to rank legal actions
      const probs = this.actionNet.forward(features);
      actionIndex = this.selectLegalAction(probs, legal);
    }

    const action = legal[actionIndex]!;

    // Record for training
    this.episodeHistory.push({
      features,
      actionIndex: actionTypeToIndex(action.type),
      isAction: true,
    });

    return action;
  }

  shouldMulligan(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): boolean {
    const features = stateToFeatures(state, playerId, definitions);

    let decision: boolean;
    if (Math.random() < this.epsilon) {
      // Explore: random mulligan decision
      decision = Math.random() < 0.5;
    } else {
      // Exploit: network decides
      const probs = this.mulliganNet.forward(features);
      decision = probs[0]! > probs[1]!;  // [0]=mulligan, [1]=keep
    }

    // Record for training
    this.episodeHistory.push({
      features,
      actionIndex: decision ? 0 : 1,
      isAction: false,
    });

    return decision;
  }

  performMulligan(
    state: GameState,
    playerId: PlayerID,
    _definitions: Record<string, CardDefinition>
  ): GameState {
    // All-or-nothing mulligan — redraw full hand
    // Partial mulligan (keep N cards) is a future extension
    return performMulligan(state, playerId);
  }

  // --- Training ---

  /**
   * Update network weights based on the episode's return.
   * Call this after each game completes.
   *
   * @param G      Total discounted return for this episode (0-1)
   * @param lr     Learning rate
   * @param gamma  Discount factor (0.9 = future rewards worth 90% per turn)
   */
  updateFromEpisode(G: number, lr: number, gamma: number): void {
    // Compute discounted returns backward through episode
    let discountedG = G;
    for (let i = this.episodeHistory.length - 1; i >= 0; i--) {
      const { features, actionIndex, isAction } = this.episodeHistory[i]!;
      const net = isAction ? this.actionNet : this.mulliganNet;
      net.update(features, actionIndex, discountedG, lr);
      discountedG *= gamma;
    }
    this.episodeHistory = [];
  }

  /** Decay exploration rate toward minimum. */
  decayEpsilon(minEpsilon: number, decayRate: number): void {
    this.epsilon = Math.max(minEpsilon, this.epsilon * decayRate);
  }

  /** Serialize for saving. */
  toJSON() {
    return {
      name: this.name,
      epsilon: this.epsilon,
      mulliganNet: this.mulliganNet.toJSON(),
      actionNet: this.actionNet.toJSON(),
    };
  }

  static fromJSON(data: ReturnType<RLPolicy["toJSON"]>, inputSize: number): RLPolicy {
    const policy = new RLPolicy(data.name, inputSize, data.epsilon);
    Object.assign(policy.mulliganNet, NeuralNetwork.fromJSON(data.mulliganNet));
    Object.assign(policy.actionNet, NeuralNetwork.fromJSON(data.actionNet));
    return policy;
  }

  // --- Private helpers ---

  private resolvePendingChoice(
    state: GameState,
    playerId: PlayerID,
    features: number[]
  ): GameAction {
    const choice = state.pendingChoice!;

    if (choice.type === "choose_may") {
      // ε-greedy: random or network
      const idx = Math.random() < this.epsilon
        ? Math.floor(Math.random() * 2)
        : (this.actionNet.forward(features)[6]! > 0.5 ? 0 : 1);
      this.episodeHistory.push({ features, actionIndex: idx === 0 ? 6 : 7, isAction: true });
      return { type: "RESOLVE_CHOICE", playerId, choice: idx === 0 ? "accept" : "decline" };
    }

    const targets = choice.validTargets ?? [];
    if (targets.length === 0) return { type: "RESOLVE_CHOICE", playerId, choice: [] };

    // For target choices: pick randomly during exploration, first target otherwise
    // (Full target evaluation requires more complex action space — future work)
    const targetIdx = Math.random() < this.epsilon
      ? Math.floor(Math.random() * targets.length)
      : 0;
    return { type: "RESOLVE_CHOICE", playerId, choice: [targets[targetIdx]!] };
  }

  private selectLegalAction(probs: number[], legal: GameAction[]): number {
    // Map action types to network outputs, find highest-probability legal action
    const scored = legal.map((action, idx) => ({
      idx,
      score: probs[actionTypeToIndex(action.type)] ?? 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.idx;
  }
}

function actionTypeToIndex(type: string): number {
  const map: Record<string, number> = {
    "PLAY_CARD":       0,
    "PLAY_INK":        1,
    "QUEST":           2,
    "CHALLENGE":       3,
    "ACTIVATE_ABILITY": 4,
    "PASS_TURN":       5,
    "RESOLVE_CHOICE":  6,
  };
  return map[type] ?? 5;
}
```

---

## Part 4: Training Loop

### File: packages/simulator/src/rl/trainer.ts

```typescript
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
import { runGame } from "../runGame.js";
import { RandomBot } from "../bots/RandomBot.js";
import { RLPolicy } from "./policy.js";
import { STATE_FEATURE_SIZE } from "./autoTag.js";
import type { GameResult } from "../types.js";

export interface TrainingConfig {
  /** Deck being trained */
  deck: DeckEntry[];

  /**
   * Opponent deck. Start with goldfish, switch to real deck after curriculum.
   */
  opponentDeck: DeckEntry[];

  definitions: Record<string, CardDefinition>;

  /**
   * Reward function. Maps GameResult → scalar 0-1.
   *
   * Goldfish phase (recommended):
   *   (result) => result.finalLore.player1 / 20
   *
   * Real opponent phase:
   *   (result) => result.winner === "player1" ? 1 : 0
   *
   * The reward function is the ONLY human input to training.
   * Everything else is discovered.
   */
  reward: (result: GameResult) => number;

  /** Total training episodes. Goldfish: 50,000. Real opponent: 200,000. */
  episodes: number;

  /** Learning rate. Default: 0.001 */
  learningRate?: number;

  /**
   * Discount factor γ. How much future rewards are worth.
   * 0.9 = reward 5 turns away is worth 0.9^5 = 59% of immediate reward.
   * Default: 0.95
   */
  gamma?: number;

  /**
   * Exploration: ε starts at 1.0 (fully random), decays toward minEpsilon.
   * Decay rate applied each episode: ε = max(minEpsilon, ε × decayRate)
   * Default: minEpsilon=0.05, decayRate=0.9995
   */
  minEpsilon?: number;
  epsilonDecayRate?: number;

  /** Max turns per game. Default: 30 (full game). Use 12 for goldfish focus. */
  maxTurns?: number;

  /**
   * Warm-start policy. If provided, continue training from these weights
   * instead of starting random. Used for curriculum learning.
   */
  warmStart?: RLPolicy;

  /** Log progress every N episodes. Default: 1000 */
  logInterval?: number;
}

export interface TrainingResult {
  policy: RLPolicy;
  /** Average reward over last 1000 episodes */
  finalAvgReward: number;
  /** Reward history (one point per logInterval episodes, smoothed) */
  rewardCurve: { episode: number; avgReward: number }[];
  episodesRun: number;
}

/**
 * Train an RL policy from scratch (or warm start) on a deck.
 *
 * The policy starts with random weights and zero knowledge.
 * After training, it has discovered how to play the deck — mulligan
 * decisions and action selection — purely from game outcomes.
 */
export function trainPolicy(config: TrainingConfig): TrainingResult {
  const lr = config.learningRate ?? 0.001;
  const gamma = config.gamma ?? 0.95;
  const minEpsilon = config.minEpsilon ?? 0.05;
  const decayRate = config.epsilonDecayRate ?? 0.9995;
  const maxTurns = config.maxTurns ?? 30;
  const logInterval = config.logInterval ?? 1000;

  // Initialize policy (warm start or fresh)
  const policy = config.warmStart
    ?? new RLPolicy("rl-trained", STATE_FEATURE_SIZE, 1.0);

  const rewardCurve: { episode: number; avgReward: number }[] = [];
  let recentRewardSum = 0;

  for (let episode = 0; episode < config.episodes; episode++) {
    // Run one game
    const result = runGame({
      player1Deck: config.deck,
      player2Deck: config.opponentDeck,
      player1Strategy: policy,        // RL policy controls player1
      player2Strategy: RandomBot,     // opponent is random (goldfish) or trained
      definitions: config.definitions,
      maxTurns,
    });

    // Compute reward
    const G = config.reward(result);
    recentRewardSum += G;

    // Update policy weights from this episode
    policy.updateFromEpisode(G, lr, gamma);

    // Decay exploration
    policy.decayEpsilon(minEpsilon, decayRate);

    // Log progress
    if ((episode + 1) % logInterval === 0) {
      const avgReward = recentRewardSum / logInterval;
      rewardCurve.push({ episode: episode + 1, avgReward });
      console.log(
        `  Episode ${(episode + 1).toString().padStart(6)} | ` +
        `ε=${policy.epsilon.toFixed(3)} | ` +
        `avg reward=${avgReward.toFixed(3)}`
      );
      recentRewardSum = 0;
    }
  }

  const lastN = rewardCurve.slice(-10);
  const finalAvgReward = lastN.reduce((a, b) => a + b.avgReward, 0) / lastN.length;

  return {
    policy,
    finalAvgReward,
    rewardCurve,
    episodesRun: config.episodes,
  };
}

/**
 * Curriculum learning: goldfish → real opponent.
 *
 * Phase 1: Train against goldfish (random bot).
 *   Bot learns basic deck mechanics: when to ink, when to quest,
 *   how to sequence plays. Clean signal, fast learning.
 *
 * Phase 2: Continue training against real opponent.
 *   Bot learns matchup-specific adaptations: when to hold removal,
 *   when to race vs stabilize. Warm-starts from Phase 1 weights.
 *
 * This is the recommended training path for any deck.
 */
export function trainWithCurriculum(
  deck: DeckEntry[],
  opponentDeck: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  options?: {
    goldfishEpisodes?: number;
    realOpponentEpisodes?: number;
    goldfish?: DeckEntry[];
    onProgress?: (phase: string, episode: number, avgReward: number) => void;
  }
): TrainingResult {
  const goldfish = options?.goldfish;  // defaults to random bot if not provided
  const goldfishEpisodes = options?.goldfishEpisodes ?? 50000;
  const realEpisodes = options?.realOpponentEpisodes ?? 100000;

  console.log(`\nPhase 1: Goldfish training (${goldfishEpisodes} episodes)`);
  console.log("Bot learns basic deck mechanics...\n");

  const phase1 = trainPolicy({
    deck,
    opponentDeck: goldfish ?? deck,  // random bot plays goldfish deck
    definitions,
    reward: (result) => result.finalLore.player1 / 20,  // lore = progress
    episodes: goldfishEpisodes,
    maxTurns: 20,  // shorter games = faster goldfish learning
  });

  console.log(`\nPhase 2: Real opponent training (${realEpisodes} episodes)`);
  console.log("Bot learns matchup adaptations...\n");

  const phase2 = trainPolicy({
    deck,
    opponentDeck,
    definitions,
    reward: (result) => result.winner === "player1" ? 1 : 0,  // win/loss
    episodes: realEpisodes,
    maxTurns: 50,  // full game length
    warmStart: phase1.policy,  // start from phase 1 weights
  });

  return phase2;
}
```

---

## Part 5: CLI Command

### pnpm learn --deck ./deck.txt --opponent ./opponent.txt [options]

```bash
# Full curriculum training (recommended)
pnpm learn \
  --deck decks/cinderella-deck.txt \
  --opponent decks/lilo-stitch-deck.txt \
  --curriculum \
  --save queries/cinderella-policy.json

# Goldfish only (faster, learns deck mechanics only)
pnpm learn \
  --deck decks/cinderella-deck.txt \
  --goldfish-only \
  --episodes 50000 \
  --save queries/cinderella-goldfish-policy.json

# Continue training from saved policy
pnpm learn \
  --deck decks/cinderella-deck.txt \
  --opponent decks/new-opponent.txt \
  --load queries/cinderella-policy.json \
  --episodes 50000 \
  --save queries/cinderella-updated-policy.json
```

Add to `packages/cli/src/commands/learn.ts` and wire into main.ts.

---

## Training Timeline (Realistic Estimates)

| Phase | Episodes | Estimated Time | What It Learns |
|-------|----------|---------------|----------------|
| Goldfish | 50,000 | ~2-5 min | Basic ink, quest, sequencing |
| vs random | 100,000 | ~10-20 min | Board management basics |
| vs real opp | 100,000 | ~20-40 min | Matchup-specific adaptations |
| vs trained opp | 200,000+ | hours | True Nash equilibrium |

Start with goldfish + vs random. That's enough to tell you something you
don't already know about your deck. The later phases are for deeper insights.

---

## Files Created

```
NEW:
  packages/simulator/src/rl/autoTag.ts    — card + state feature extraction
  packages/simulator/src/rl/network.ts    — neural network (no dependencies)
  packages/simulator/src/rl/policy.ts     — RLPolicy implements BotStrategy
  packages/simulator/src/rl/trainer.ts    — training loop + curriculum
  packages/simulator/src/rl/index.ts      — exports

  packages/cli/src/commands/learn.ts      — CLI command
  
MODIFIED:
  packages/simulator/src/index.ts         — export rl/*
  packages/cli/src/main.ts               — add "learn" command
  packages/cli/src/resolveBot.ts         — add "rl" bot name (loads saved policy)

UNTOUCHED:
  packages/engine/*
  packages/simulator/src/bots/*
  packages/simulator/src/runGame.ts
  packages/analytics/*
```

---

## What the Bot Discovers (Examples)

After goldfish training against its own deck:
- Learns to play ramp pieces early (discovers the sequencing without being told)
- Learns which cards are worth inking (discovers ink fodder without being told)
- Learns turn-appropriate questing vs setting up

After real opponent training:
- Learns matchup-specific keeps (Cinderella deck learns to keep removal against aggro)
- Learns when the combo line is worth pursuing vs abandoning for tempo
- Learns opponent-specific ink priorities

You then ask:
- "What did the bot learn to keep in the mulligan?"
  → Read mulligan network activations on known hands
- "What does the bot prioritize on turn 2?"
  → Run a fixed turn-2 state through the action network, read probabilities
- "Does the bot keep DYB in opener?"
  → Run opener states with/without DYB, compare keep probabilities

These are interrogable — you can ask the trained network what it learned.

---

## What This Is Not

- Not a perfect player. It will make mistakes, especially early in training.
- Not fast on the first run. 50,000 episodes takes minutes, not seconds.
- Not interpretable in the way a linear model is. The neural network
  learns representations you can probe but not directly read.
- Not a replacement for the query system. RL tells you how to play.
  The query system tells you what happens when you do.

They're complementary. Train the RL bot. Use it as the in-game policy.
Run the query system over RL bot game results. Now your analytics data
reflects competent play, not GreedyBot heuristics.

---

## Prerequisites for Replay Integration (do during Stream 1)

RL training needs reproducible games for debugging reward signals.
Visual replay (Stream 3e) needs the same infrastructure. Build both together.

### Seeded RNG

Replace `Math.random()` with a seeded PRNG in 4 locations:
1. `engine/initializer.ts` — initial deck shuffle (GameConfig.seed field exists, unused)
2. `engine/reducer.ts` — shuffleDeck (mid-game card effects)
3. `simulator/mulligan.ts` — mulligan shuffle
4. `engine/utils/index.ts` — generateId (cosmetic, but needed for determinism)

Implementation: small xoshiro128 or similar (~20 lines). Thread through
GameConfig → GameState (store RNG state). All shuffles pull from game RNG.

Store `seed` in `GameResult`. Same seed + same actions = identical game.

### GameAction[] capture

Current `GameResult.actionLog` is `GameLogEntry[]` — text summaries like
"P1 played Elsa". Not enough for state reconstruction.

Add raw `GameAction[]` to `GameResult` (or new `ReplayableGameResult` type).
Every action the engine processes gets recorded in order.

Size: ~5-15 KB per game (40-80 actions). Compresses well with gzip.
Can optimize later with enum action types + short card indices if needed.

### What this enables

- **Visual replay:** Reconstruct `GameState` at any step by replaying
  actions from seed through `applyAction`. Feed to GameBoard read-only.
- **Human takeover:** Fork from any replay point into a live game.
  `useGameSession` accepts the reconstructed `GameState` as `startingState`.
- **Branch analysis:** From any point, sim 200 games with/without an action,
  compare win%. Already works via `runSimulation({ startingState })`.
- **RL debugging:** Reproduce exact game that produced a suspicious reward.
  Same seed = same shuffles = same game (given same policy weights).

NOTE: Replaying one game does NOT train the RL bot. RL needs thousands
of full games. Replay is for human interpretability, not bot learning.

---

## Part 6: Three Kinds of "Weights" — Don't Confuse Them

There are three distinct things called "weights" in this system. They are completely
different objects that operate at different points in the training pipeline.

---

### 1. Neural Network Weights (inside the network)

**What:** The actual learned parameters — the numbers inside `w1`, `w2`, `w3` (and biases)
of the `NeuralNetwork` class.

**Where:** `packages/simulator/src/rl/network.ts`

**Size:** Hundreds of thousands of floats (e.g. 1224 × 128 + 128 × 64 + 64 × 1 ≈ 165k values).

**How initialized:** Xavier initialization — random floats in a small range (roughly ±0.07
for the first layer). Biases start at exactly zero. NOT 0.5. The small random values are
intentional: if all weights were the same value, every neuron would compute the same thing
and learn the same gradient — hidden layers would be useless.

**When they change:** Every episode. After each game, REINFORCE computes a gradient from the
episode return and nudges every weight slightly toward decisions that produced higher reward.

**What they encode:** The bot's learned intuition — "in this type of game state, prefer
this type of action."

---

### 2. Card Feature Vectors (autoTag, 44 dimensions per card)

**What:** A numeric description of what a card *is*, computed from its CardDefinition.

**Where:** `packages/simulator/src/rl/autoTag.ts` — `cardToFeatures(def)`

**Size:** 44 numbers per card:
- 4 basic (cost, inkable, isCharacter, isAction)
- 4 stats (strength, willpower, lore, shiftCost)
- 13 keyword flags (rush, reckless, singer, challenger, evasive...)
- 22 effect type flags (has banish, has draw, has gain_lore...)
- 1 trigger flag (has enters_play trigger)

**How initialized:** Deterministically computed from card data. Not random. Not learned.
Same card always produces the same 44 numbers.

**When they change:** Never. They're derived from the static card definition. A new set
release produces new cards with new vectors; existing cards don't change.

**What they encode:** The card's identity and capabilities, expressed as numbers the
neural network can read. The network's input is a concatenation of these vectors for
everything currently visible: your hand, your board, opponent's board, plus 12 game
context scalars.

**Role in training:** These are the INPUT to the network at each decision point. The
network reads them, runs a forward pass, and produces action scores. They give the
network the *vocabulary* to distinguish situations.

---

### 3. Reward Weights (RewardWeights, 6 values per deck)

**What:** A description of what a good *game outcome* looks like for a specific deck.

**Where:** `packages/simulator/src/rl/rewardWeights.ts` — `inferRewardWeights(deck, defs)`

**Size:** 6 floats, all in [0, 1]:
- `winWeight` — importance of the binary win/loss signal
- `loreGain` — how much your own lore progress matters
- `loreDenial` — how much stopping opponent's lore matters
- `banishValue` — how much removing opponent characters matters
- `inkEfficiency` — how much using your available ink matters
- `tradeQuality` — how much favorable challenge trade ratios matter

**How computed:** Statically derived from the decklist *before any training runs*.
Each card contributes a weight vector based on its stats and keywords — Reckless
characters contribute `loreGain = 0` (they can't quest), Singer characters contribute
high `inkEfficiency`, removal spells contribute high `loreDenial` — and the deck's
weights are the average across all 60 cards.

**Example — ruby-amethyst deck:**
```
winWeight:      0.773   ← slightly below 0.8 baseline (removal cards drag it down)
loreGain:       0.280   ← pulled down by Reckless chars (Gaston, Maui) + removal spells
loreDenial:     0.300   ← pulled up by Dragon Fire + Be Prepared
banishValue:    0.380   ← elevated by Gaston/Maui/Rafiki + removal
inkEfficiency:  0.355   ← moderate (some Singers in deck)
tradeQuality:   0.306   ← moderate (Gaston/Maleficent Dragon have good combat stats)
```

**When they change:** Never during training. They're computed once and fixed.
If you upgrade the deck (swap cards after a new set release), re-run
`inferRewardWeights()` with the new decklist — the per-card architecture means
the update is automatic.

**Role in training:** These are the evaluation function applied to each completed
game. `makeWeightedReward(weights)` compiles them into a `(result: GameResult) => number`
function that produces a single scalar per game. That scalar is what the neural
network is trained to maximize.

---

### How They Fit Together

```
BEFORE TRAINING
  inferRewardWeights(deck, defs)
    → RewardWeights (6 numbers, fixed for this deck)
  makeWeightedReward(RewardWeights)
    → reward function: (GameResult) → scalar

DURING EACH EPISODE
  for each action decision:
    stateToFeatures(state)          ← card feature vectors (44 dims × cards)
      → 1224-dim input vector
    network.forward(input)          ← neural network weights applied
      → action scores
    ε-greedy pick action
    record (features, action) in episode history

  game ends → GameResult
    reward function(GameResult)     ← RewardWeights applied
      → scalar G (0 to 1)

  network.updateFromEpisode(G)      ← neural network weights nudged
    → weights shift slightly toward decisions that produced this G
```

The three kinds of weights:
- **Card feature vectors** = the senses (how the bot perceives each card)
- **RewardWeights** = the values (what the bot is trying to achieve)
- **Neural network weights** = the learned intuition (how to act to achieve those values)

Only the neural network weights change during training. The other two are inputs.

---

### Why Archetypes Are Continuous Vectors, Not Labels

The RewardWeights vector encodes the deck's strategic identity without discretizing
it into "aggro / midrange / control."

Two decks both loosely described as "control" might have:
- Deck A: heavy removal, low lore chars → `loreDenial=0.65, loreGain=0.18`
- Deck B: mid-cost chars + some removal → `loreDenial=0.40, loreGain=0.35`

These produce meaningfully different reward functions and therefore different bots,
without either deck ever needing a label.

The per-card architecture also handles new sets gracefully: `cardToFeatures(def)` uses
only cost, lore, strength, willpower, and keyword/effect flags — all present even on
keyword-only stub cards (sets 2–11). Swapping cards in a deck automatically changes
the weights when you re-run `inferRewardWeights()`. No manual re-labeling needed.