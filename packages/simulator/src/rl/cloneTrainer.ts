// =============================================================================
// CLONE TRAINER — Supervised behavioral cloning ("clone bot")
//
// Goal: learn how a *specific player* plays from their (state_before, action)
// game logs. Pure supervised learning — NO reward signal, NO exploration,
// NO critic, NO GAE. Much simpler than the RL trainer (trainer.ts).
//
// Given a labeled sample (stateBefore, action):
//   1. Enumerate all legal actions in stateBefore.
//   2. Featurize each with the SAME (state, action) featurization the RL actor
//      net uses (autoTag.actionToFeatures), score each via the actor network.
//   3. Softmax across the legal-action set → a probability distribution.
//   4. Push the network toward the action the human actually took
//      (cross-entropy / negative-log-likelihood of the chosen action).
//
// The trained network is stored inside an RLPolicy so the output JSON loads
// through the EXACT same path as RL policies (RLPolicy.fromJSON), letting
// slice 5e (play-vs-clone) and 5d (coaching map) consume it unchanged.
//
// Stream 5b of docs/ROADMAP.md.
// =============================================================================

import type {
  CardDefinition,
  DeckEntry,
  GameAction,
  GameState,
} from "@lorcana-sim/engine";
import {
  getAllLegalActions,
  createRng,
  cloneRng,
  rngNextInt,
} from "@lorcana-sim/engine";
import type { BotStrategy } from "../types.js";
import { runGame } from "../runGame.js";
import { RLPolicy } from "./policy.js";
import {
  stateToFeatures,
  actionToFeatures,
  STATE_FEATURE_SIZE,
  NETWORK_INPUT_SIZE,
} from "./autoTag.js";
import { softmax } from "./network.js";

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

/**
 * One supervised training example: "in this state, the player chose this action."
 *
 * Decoupled from the source of the rows — they can come from a Supabase
 * `game_actions` dump, local JSON log files, or simulator self-play. The
 * trainer only ever consumes a `CloneSample[]`.
 *
 * Mirrors the `game_actions` row shape (server/src/db/schema.sql:41-50,
 * written at gameService.ts:401-410):
 *   - `action`            → the GameAction the player chose (supervised LABEL)
 *   - `state_before`      → GameState before the action (supervised INPUT)
 *   - `legal_action_count`→ number of legal actions at decision time; used to
 *                           weight harder decisions more (a forced 1-option turn
 *                           carries no signal; a 12-option turn does).
 */
export interface CloneSample {
  stateBefore: GameState;
  action: GameAction;
  /** Number of legal actions available at decision time, or null if unknown. */
  legalActionCount: number | null;
}

export interface CloneTrainingConfig {
  /** Labeled (state, action) samples for the player being cloned. */
  samples: CloneSample[];
  definitions: Record<string, CardDefinition>;
  /** Name for the saved policy. */
  name?: string;
  /** Full passes over the sample set. Default: 8 */
  epochs?: number;
  /** Learning rate. Default: 0.05 */
  learningRate?: number;
  /**
   * RNG seed. Same seed + same samples → identical training curve.
   * Seeds both the network initialization and the per-epoch sample shuffle.
   * Default: 1.
   */
  seed?: number;
  /**
   * Skip samples whose `legalActionCount` is null or <= 1. A forced single
   * legal action carries no behavioral signal — including it just biases the
   * net toward whatever that forced action happens to be. Default: true.
   */
  skipForced?: boolean;
  /**
   * Down-weight easy decisions and up-weight hard ones. The per-sample loss is
   * scaled by `log2(legalActionCount)` (clamped to >= 1). A 2-option decision
   * weighs 1.0; a 16-option decision weighs 4.0. Default: true.
   */
  difficultyWeighting?: boolean;
  /** Progress callback fired once per epoch. */
  onEpoch?: (epoch: number, avgLogLik: number, top1Acc: number) => void;
}

export interface CloneTrainingResult {
  /** Trained clone, ready to save via `.toJSON()` and load via RLPolicy.fromJSON. */
  policy: RLPolicy;
  /** Mean log-likelihood of the chosen action per epoch (higher = better fit). */
  logLikCurve: number[];
  /** Top-1 action-match accuracy on the *training* set per epoch. */
  trainAccCurve: number[];
  /** Number of samples actually used after filtering. */
  samplesUsed: number;
  epochs: number;
}

// -----------------------------------------------------------------------------
// ACTION MATCHING
// -----------------------------------------------------------------------------

/**
 * Canonical key for a GameAction, used to find which legal action the human
 * actually took. Two actions are "the same decision" iff their keys match.
 * Player-agnostic on the leading fields that always match (playerId is the
 * decider) — we key on the discriminating fields per action type.
 */
export function actionKey(action: GameAction): string {
  switch (action.type) {
    case "PLAY_CARD":
      return `PLAY_CARD:${action.instanceId}:${action.shiftTargetInstanceId ?? ""}:${action.singerInstanceId ?? ""}:${(action.singerInstanceIds ?? []).join(",")}:${action.viaGrantedFreePlay ? "free" : ""}`;
    case "PLAY_INK":
      return `PLAY_INK:${action.instanceId}`;
    case "QUEST":
      return `QUEST:${action.instanceId}`;
    case "CHALLENGE":
      return `CHALLENGE:${action.attackerInstanceId}->${action.defenderInstanceId}`;
    case "ACTIVATE_ABILITY":
      return `ACTIVATE_ABILITY:${action.instanceId}:${action.abilityIndex}`;
    case "BOOST_CARD":
      return `BOOST_CARD:${action.instanceId}`;
    case "MOVE_CHARACTER":
      return `MOVE_CHARACTER:${action.characterInstanceId}->${action.locationInstanceId}`;
    case "PASS_TURN":
      return `PASS_TURN`;
    case "DRAW_CARD":
      return `DRAW_CARD`;
    case "RESOLVE_CHOICE": {
      const c = action.choice;
      const norm = Array.isArray(c) ? [...c].sort().join(",") : String(c);
      return `RESOLVE_CHOICE:${norm}`;
    }
  }
}

// -----------------------------------------------------------------------------
// SUPERVISED TRAINING
// -----------------------------------------------------------------------------

/**
 * Train a clone policy from labeled (state, action) samples via supervised
 * behavioral cloning. Returns an RLPolicy whose actor network has been pushed
 * toward the recorded human choices.
 *
 * Only the actor network (actionNet) is trained — it is the head that scores
 * legal actions and therefore the one that determines play. The mulligan and
 * value heads are left at their seeded initialization (the clone makes a
 * neutral mulligan decision; refining it is future work once mulligan rows are
 * separately labeled).
 */
export function trainClone(config: CloneTrainingConfig): CloneTrainingResult {
  const {
    samples,
    definitions,
    name = "clone",
    epochs = 8,
    learningRate = 0.05,
    seed = 1,
    skipForced = true,
    difficultyWeighting = true,
    onEpoch,
  } = config;

  // Seed everything from one RNG so the same seed reproduces the run exactly.
  const masterRng = createRng(seed);
  const networkRng = cloneRng(masterRng);
  const shuffleRng = cloneRng(masterRng);

  // epsilon=0 — a clone never explores; it imitates.
  const policy = new RLPolicy(name, cloneRng(masterRng), networkRng, 0);
  const actionNet = policy.actionNet;

  // Filter to decision points that carry signal.
  const usable = samples.filter((s) => {
    if (!skipForced) return true;
    return s.legalActionCount !== null && s.legalActionCount > 1;
  });

  const logLikCurve: number[] = [];
  const trainAccCurve: number[] = [];

  // Reusable forward-pass buffer (state features are constant within a sample).
  const inputBuffer = new Float32Array(NETWORK_INPUT_SIZE);

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Deterministic Fisher–Yates shuffle so gradient order is reproducible.
    const order = usable.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rngNextInt(shuffleRng, i + 1);
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }

    let logLikSum = 0;
    let correct = 0;
    let scored = 0;

    for (const idx of order) {
      const sample = usable[idx]!;
      const playerId = sample.action.playerId;
      const legal = getAllLegalActions(sample.stateBefore, playerId, definitions);
      if (legal.length <= 1) continue; // no signal even if recorded otherwise

      // Find which legal action the human took.
      const targetKey = actionKey(sample.action);
      const chosenIdx = legal.findIndex((a: GameAction) => actionKey(a) === targetKey);
      if (chosenIdx < 0) continue; // recorded action not in current legal set — skip

      // Featurize state once, then score each legal action.
      const stateFeats = stateToFeatures(sample.stateBefore, playerId, definitions);
      inputBuffer.set(stateFeats, 0);

      const actionFeats: number[][] = new Array(legal.length);
      const scores: number[] = new Array(legal.length);
      for (let a = 0; a < legal.length; a++) {
        const af = actionToFeatures(sample.stateBefore, legal[a]!, playerId, definitions);
        actionFeats[a] = af;
        inputBuffer.set(af, STATE_FEATURE_SIZE);
        scores[a] = actionNet.forward(inputBuffer)[0]!;
      }

      const probs = softmax(scores);

      // Metrics
      logLikSum += Math.log(Math.max(probs[chosenIdx]!, 1e-12));
      let argmax = 0;
      for (let a = 1; a < probs.length; a++) {
        if (probs[a]! > probs[argmax]!) argmax = a;
      }
      if (argmax === chosenIdx) correct++;
      scored++;

      // Per-sample difficulty weight: harder decisions matter more.
      const weight = difficultyWeighting
        ? Math.max(1, Math.log2(legal.length))
        : 1;

      // Cross-entropy gradient: for each action i, the loss gradient w.r.t. its
      // score is (p_i - y_i). The network does gradient ASCENT on the scalar G
      // passed to update(), so we pass G_i = (y_i - p_i) to descend the loss.
      // Updating per-action (each its own forward input) realizes the full
      // softmax cross-entropy gradient over the legal set.
      for (let a = 0; a < legal.length; a++) {
        const y = a === chosenIdx ? 1 : 0;
        const g = (y - probs[a]!) * weight;
        if (g === 0) continue;
        inputBuffer.set(actionFeats[a]!, STATE_FEATURE_SIZE);
        actionNet.update(inputBuffer, 0, g, learningRate);
      }
    }

    const avgLogLik = scored > 0 ? logLikSum / scored : 0;
    const top1 = scored > 0 ? correct / scored : 0;
    logLikCurve.push(avgLogLik);
    trainAccCurve.push(top1);
    if (onEpoch) onEpoch(epoch + 1, avgLogLik, top1);
  }

  return {
    policy,
    logLikCurve,
    trainAccCurve,
    samplesUsed: usable.length,
    epochs,
  };
}

// -----------------------------------------------------------------------------
// EVALUATION — held-out top-1 action-match accuracy
// -----------------------------------------------------------------------------

export interface CloneEvalResult {
  /** Fraction of held-out samples where the clone's argmax matches the label. */
  top1Accuracy: number;
  /** Mean of (1 / legalActionCount) — the expected accuracy of random-legal
   *  guessing on this same held-out set. The clone must beat this. */
  randomBaseline: number;
  samplesEvaluated: number;
}

/**
 * Top-1 action-match accuracy on a held-out sample set, plus the random-legal
 * baseline for the same positions. A correctly trained clone scores well above
 * the baseline.
 */
export function evaluateClone(
  policy: RLPolicy,
  samples: CloneSample[],
  definitions: Record<string, CardDefinition>,
  opts: { skipForced?: boolean } = {}
): CloneEvalResult {
  const skipForced = opts.skipForced ?? true;
  const actionNet = policy.actionNet;
  const inputBuffer = new Float32Array(NETWORK_INPUT_SIZE);

  let correct = 0;
  let baselineSum = 0;
  let evaluated = 0;

  for (const sample of samples) {
    if (skipForced && (sample.legalActionCount === null || sample.legalActionCount <= 1)) {
      continue;
    }
    const playerId = sample.action.playerId;
    const legal = getAllLegalActions(sample.stateBefore, playerId, definitions);
    if (legal.length <= 1) continue;

    const targetKey = actionKey(sample.action);
    const chosenIdx = legal.findIndex((a: GameAction) => actionKey(a) === targetKey);
    if (chosenIdx < 0) continue;

    const stateFeats = stateToFeatures(sample.stateBefore, playerId, definitions);
    inputBuffer.set(stateFeats, 0);

    let argmax = 0;
    let bestScore = -Infinity;
    for (let a = 0; a < legal.length; a++) {
      const af = actionToFeatures(sample.stateBefore, legal[a]!, playerId, definitions);
      inputBuffer.set(af, STATE_FEATURE_SIZE);
      const score = actionNet.forward(inputBuffer)[0]!;
      if (score > bestScore) {
        bestScore = score;
        argmax = a;
      }
    }

    if (argmax === chosenIdx) correct++;
    baselineSum += 1 / legal.length;
    evaluated++;
  }

  return {
    top1Accuracy: evaluated > 0 ? correct / evaluated : 0,
    randomBaseline: evaluated > 0 ? baselineSum / evaluated : 0,
    samplesEvaluated: evaluated,
  };
}

// -----------------------------------------------------------------------------
// SAMPLE GENERATION — simulator self-play (validation data source)
// -----------------------------------------------------------------------------

/**
 * Wrap any BotStrategy and record every (stateBefore, action, legalActionCount)
 * tuple for the player it controls. The recorded shape is identical to a
 * `game_actions` row, so a clone trained on these samples should reproduce the
 * wrapped bot's choices — that is the correctness test for the trainer.
 *
 * Implemented as a factory (not a class) so the optional BotStrategy mulligan
 * hooks are only attached when `inner` defines them — required under
 * exactOptionalPropertyTypes, which forbids an `undefined`-valued optional.
 */
function makeRecordingBot(
  inner: BotStrategy,
  definitions: Record<string, CardDefinition>
): { bot: BotStrategy; samples: CloneSample[] } {
  const samples: CloneSample[] = [];

  const bot: BotStrategy = {
    name: inner.name,
    type: inner.type,
    decideAction(state, playerId, defs) {
      const action = inner.decideAction(state, playerId, defs);
      // legal_action_count mirrors what a server would log: the size of the
      // legal set this player chose from. Skip pending-choice resolutions (the
      // clone target space for those is choice-specific, handled separately by
      // the RL policy's resolvePendingChoice path).
      if (!state.pendingChoice) {
        const legal = getAllLegalActions(state, playerId, definitions);
        samples.push({ stateBefore: state, action, legalActionCount: legal.length });
      }
      return action;
    },
  };

  if (inner.shouldMulligan) bot.shouldMulligan = inner.shouldMulligan.bind(inner);
  if (inner.performMulligan) bot.performMulligan = inner.performMulligan.bind(inner);

  return { bot, samples };
}

export interface GenerateSamplesConfig {
  /** Bot whose decisions we record as the supervised labels (controls player1). */
  bot: BotStrategy;
  /** Opponent (its decisions are not recorded). */
  opponent: BotStrategy;
  deck: DeckEntry[];
  opponentDeck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  games: number;
  maxTurns?: number;
  /** Seed for the game RNG sequence. Default: 1. */
  seed?: number;
}

/**
 * Run N simulator games and emit CloneSamples from `bot`'s decisions as
 * player1. Independent of any database — gives the CLI and tests a data source
 * that produces the identical row shape to prod game logs.
 *
 * NOTE on determinism: the game RNG is seeded, but RandomBot picks via unseeded
 * Math.random (RandomBot.ts:95). For a byte-reproducible sample dump, use a
 * deterministic opponent (e.g. GreedyBot). The supervised trainer itself is
 * fully deterministic regardless — it consumes a fixed CloneSample[].
 */
export function generateCloneSamples(config: GenerateSamplesConfig): CloneSample[] {
  const {
    bot,
    opponent,
    deck,
    opponentDeck,
    definitions,
    games,
    maxTurns = 30,
    seed = 1,
  } = config;

  const seedRng = createRng(seed);
  const { bot: recorder, samples } = makeRecordingBot(bot, definitions);

  for (let g = 0; g < games; g++) {
    const gameSeed = rngNextInt(seedRng, 0x7fffffff);
    runGame({
      player1Deck: deck,
      player2Deck: opponentDeck,
      player1Strategy: recorder,
      player2Strategy: opponent,
      definitions,
      maxTurns,
      seed: gameSeed,
    });
  }

  return samples;
}
