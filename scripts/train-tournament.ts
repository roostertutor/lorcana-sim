// =============================================================================
// TRAIN TOURNAMENT — Train multiple "schools of thought" on the same deck,
// then run a round-robin to see which strategy actually wins the mirror.
//
// Usage: npx tsx scripts/train-tournament.ts --deck decks/set-001-ruby-amethyst-deck.txt
//        npx tsx scripts/train-tournament.ts --deck decks/... --episodes 5000
//
// Trains 3 policies with different opponent exposure:
//   aggressor — vs RandomBot       (learns quest-flood baseline)
//   control   — vs GreedyBot       (learns to deal with efficient play)
//   midrange  — vs 50/50 mix       (exposed to both styles)
//
// Then round-robin: each policy vs every other, 300 games per pairing.
// Prints a win matrix + card stat table per policy.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename } from "path";
import {
  LORCAST_CARD_DEFINITIONS,
  parseDecklist,
  createRng,
  cloneRng,
  rngNextInt,
} from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import {
  trainPolicy,
  RLPolicy,
  RandomBot,
  GreedyBot,
  runGame,
} from "@lorcana-sim/simulator";
import type { BotStrategy, GameResult } from "@lorcana-sim/simulator";
import { aggregateResults } from "@lorcana-sim/analytics";

const definitions = LORCAST_CARD_DEFINITIONS;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const deckPath = getArg("--deck");
if (!deckPath) {
  console.error("Usage: npx tsx scripts/train-tournament.ts --deck <path> [--episodes N]");
  process.exit(1);
}

const episodes = parseInt(getArg("--episodes") ?? "5000", 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDeck(path: string): DeckEntry[] {
  const text = readFileSync(path, "utf-8");
  const { entries, errors } = parseDecklist(text, definitions);
  if (errors.length > 0) {
    for (const e of errors) console.error(`  Warning: ${e}`);
  }
  return entries;
}

function deckName(path: string): string {
  return basename(path, ".txt")
    .replace(/^set-\d+-/, "")
    .replace(/-deck$/, "");
}

/** Run N evaluation games, policy at epsilon=0 as player1 vs opponent */
function evalGames(
  policy: RLPolicy,
  opponent: BotStrategy,
  deck: DeckEntry[],
  opponentDeck: DeckEntry[],
  count: number,
  seedStart: number
): GameResult[] {
  const savedEpsilon = policy.epsilon;
  policy.epsilon = 0;

  const results: GameResult[] = [];
  for (let i = 0; i < count; i++) {
    policy.clearHistory();
    results.push(runGame({
      player1Deck: deck,
      player2Deck: opponentDeck,
      player1Strategy: policy,
      player2Strategy: opponent,
      definitions,
      maxTurns: 80,
      seed: seedStart + i,
    }));
  }

  policy.epsilon = savedEpsilon;
  policy.clearHistory();
  return results;
}

/** Win rate of player1 across results */
function winRate(results: GameResult[]): number {
  return results.filter(r => r.winner === "player1").length / results.length;
}

// ---------------------------------------------------------------------------
// Mixed opponent — alternates between two bots per episode using an rng
// ---------------------------------------------------------------------------

/**
 * Create a "mixed" opponent that randomly picks between two bots each game.
 * We handle this at the trainPolicy level by wrapping in a stateful object
 * that the trainer calls decideAction on. Instead, we just use the rng-based
 * approach at training call time by passing a custom opponent wrapper.
 */
function createMixedOpponent(botA: BotStrategy, botB: BotStrategy, mixRng: { s: [number, number, number, number] }): BotStrategy {
  return {
    name: "mixed",
    type: "algorithm",
    decideAction(state, playerId, defs) {
      const useA = (rngNextInt(mixRng, 2) === 0);
      return (useA ? botA : botB).decideAction(state, playerId, defs);
    },
    shouldMulligan(state, playerId, defs) {
      return botA.shouldMulligan?.(state, playerId, defs) ?? false;
    },
    performMulligan(state, playerId, defs) {
      return botA.performMulligan?.(state, playerId, defs) ?? state;
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const deck = loadDeck(deckPath);
const name = deckName(deckPath);
const totalCards = deck.reduce((s, e) => s + e.count, 0);

console.log(`\nDeck: ${name} (${totalCards} cards)`);
console.log(`Episodes per policy: ${episodes}`);
console.log(`\nTraining 3 policies: aggressor (vs random), control (vs greedy), midrange (vs 50/50)`);
console.log("=".repeat(70));

// Seed everything from a single root for reproducibility
const rootRng = createRng(42);

// ---------------------------------------------------------------------------
// Train: Aggressor (vs RandomBot)
// ---------------------------------------------------------------------------

console.log("\n[1/3] Training AGGRESSOR (vs RandomBot)...");
const aggressorResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: RandomBot,
  episodes,
  seed: 100,
  maxTurns: 80,
  learningRate: 0.001,
  epsilon: 1.0,
  minEpsilon: 0.05,
  decayRate: 0.9995,
  logInterval: Math.floor(episodes / 5),
  onLog: (ep, _r, eps, avg) =>
    console.log(`  ep ${ep.toString().padStart(6)}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`),
});
const aggressor = aggressorResult.policy;
aggressor.epsilon = 0;
console.log(`  Final ε=${aggressorResult.finalEpsilon.toFixed(4)}`);

// ---------------------------------------------------------------------------
// Train: Control (vs GreedyBot)
// ---------------------------------------------------------------------------

console.log("\n[2/3] Training CONTROL (vs GreedyBot)...");
const controlResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: GreedyBot,
  episodes,
  seed: 200,
  maxTurns: 80,
  learningRate: 0.001,
  epsilon: 1.0,
  minEpsilon: 0.05,
  decayRate: 0.9995,
  logInterval: Math.floor(episodes / 5),
  onLog: (ep, _r, eps, avg) =>
    console.log(`  ep ${ep.toString().padStart(6)}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`),
});
const control = controlResult.policy;
control.epsilon = 0;
console.log(`  Final ε=${controlResult.finalEpsilon.toFixed(4)}`);

// ---------------------------------------------------------------------------
// Train: Midrange (vs 50/50 mix)
// ---------------------------------------------------------------------------

console.log("\n[3/3] Training MIDRANGE (vs 50/50 random/greedy mix)...");
const mixRng = cloneRng(rootRng);
const mixedOpponent = createMixedOpponent(RandomBot, GreedyBot, mixRng);
const midrangeResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: mixedOpponent,
  episodes,
  seed: 300,
  maxTurns: 80,
  learningRate: 0.001,
  epsilon: 1.0,
  minEpsilon: 0.05,
  decayRate: 0.9995,
  logInterval: Math.floor(episodes / 5),
  onLog: (ep, _r, eps, avg) =>
    console.log(`  ep ${ep.toString().padStart(6)}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`),
});
const midrange = midrangeResult.policy;
midrange.epsilon = 0;
console.log(`  Final ε=${midrangeResult.finalEpsilon.toFixed(4)}`);

// ---------------------------------------------------------------------------
// Round-robin evaluation
// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(70));
console.log("ROUND-ROBIN TOURNAMENT (300 games per pairing)");
console.log("=".repeat(70));

const policies: Array<{ name: string; policy: RLPolicy }> = [
  { name: "aggressor", policy: aggressor },
  { name: "control",   policy: control },
  { name: "midrange",  policy: midrange },
];

// Also include fixed bots as benchmarks
const benchmarks: Array<{ name: string; strategy: BotStrategy }> = [
  { name: "random", strategy: RandomBot },
  { name: "greedy", strategy: GreedyBot },
];

// Win matrix: winMatrix[i][j] = win rate of policy i vs policy j (RL vs RL)
const GAMES = 100;

// RL vs RL pairings
console.log(`\nRL policy head-to-head (win rate as row policy, ${GAMES} games each):`);
const header = "            " + policies.map(p => p.name.padStart(11)).join("");
console.log(header);

for (const { name: rowName, policy: rowPolicy } of policies) {
  let row = rowName.padEnd(12);
  for (const { name: colName, policy: colPolicy } of policies) {
    if (rowName === colName) {
      row += "         —".padStart(11);
    } else {
      process.stdout.write(`  evaluating ${rowName} vs ${colName}...`);
      const results = evalGames(rowPolicy, colPolicy, deck, deck, GAMES, 20000 + rowName.charCodeAt(0) * 1000);
      const wr = winRate(results);
      process.stdout.write(`\r`);
      row += `${(wr * 100).toFixed(1)}%`.padStart(11);
    }
  }
  console.log(row);
}

// RL vs fixed benchmarks
console.log(`\nRL vs fixed benchmarks (win rate of RL policy, ${GAMES} games each):`);
const benchHeader = "            " + benchmarks.map(b => b.name.padStart(9)).join("");
console.log(benchHeader);

for (const { name: rowName, policy: rowPolicy } of policies) {
  let row = rowName.padEnd(12);
  for (const { name: benchName, strategy: colStrat } of benchmarks) {
    process.stdout.write(`  evaluating ${rowName} vs ${benchName}...`);
    const results = evalGames(rowPolicy, colStrat, deck, deck, GAMES, 30000 + rowName.charCodeAt(0) * 1000);
    const wr = winRate(results);
    process.stdout.write(`\r`);
    row += `${(wr * 100).toFixed(1)}%`.padStart(9);
  }
  console.log(row);
}

// ---------------------------------------------------------------------------
// Card stat comparison: what does each policy actually do differently?
// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(70));
console.log("CARD USAGE COMPARISON (300 games each vs RandomBot)");
console.log("=".repeat(70));

// Simple per-card play/quest/challenge counts
function querySimple(results: GameResult[]): Record<string, { played: number; quested: number; challenged: number; inked: number }> {
  const stats: Record<string, { played: number; quested: number; challenged: number; inked: number }> = {};
  function ensure(id: string) {
    if (!stats[id]) stats[id] = { played: 0, quested: 0, challenged: 0, inked: 0 };
    return stats[id]!;
  }
  for (const result of results) {
    for (const action of result.actions) {
      if (action.playerId !== "player1") continue;
      if (action.type === "QUEST") {
        const inst = result.cardStats[(action as any).instanceId];
        if (inst) ensure(inst.definitionId).quested++;
      } else if (action.type === "CHALLENGE") {
        const inst = result.cardStats[(action as any).attackerInstanceId];
        if (inst) ensure(inst.definitionId).challenged++;
      } else if (action.type === "PLAY_CARD") {
        const inst = result.cardStats[(action as any).instanceId];
        if (inst && !(action as any).singerInstanceId) ensure(inst.definitionId).played++;
      } else if (action.type === "PLAY_INK") {
        const inst = result.cardStats[(action as any).instanceId];
        if (inst) ensure(inst.definitionId).inked++;
      }
    }
  }
  return stats;
}

// Cards to spotlight — the strategically interesting ones
const spotlight = [
  "maleficent-monstrous-dragon",
  "mickey-mouse-brave-little-tailor",
  "aladdin-heroic-outlaw",
  "maui-hero-to-all",
  "gaston-arrogant-hunter",
  "elsa-spirit-of-winter",
  "maleficent-sorceress",
  "be-prepared",
];

const policyStats: Record<string, ReturnType<typeof querySimple>> = {};
const policyWinRates: Record<string, number> = {};

for (const { name: pName, policy } of policies) {
  process.stdout.write(`  evaluating ${pName} card stats...`);
  const results = evalGames(policy, RandomBot, deck, deck, GAMES, 40000 + pName.charCodeAt(0) * 1000);
  policyStats[pName] = querySimple(results);
  policyWinRates[pName] = winRate(results);
  process.stdout.write(`\r`);
}

console.log("\n" + "Card".padEnd(36) + policies.map(p => p.name.padStart(22)).join(""));
console.log("-".repeat(36 + policies.length * 22));

for (const defId of spotlight) {
  const def = definitions[defId];
  if (!def) continue;
  const fullName = def.fullName.length > 35 ? def.fullName.slice(0, 34) + "…" : def.fullName;
  let row = fullName.padEnd(36);
  for (const { name: pName } of policies) {
    const s = policyStats[pName]?.[defId] ?? { played: 0, quested: 0, challenged: 0, inked: 0 };
    row += `${s.inked}i/${s.played}p/${s.quested}q/${s.challenged}c`.padStart(22);
  }
  console.log(row);
}

console.log("\nWin rate vs Random:".padEnd(36) +
  policies.map(p => `${(policyWinRates[p.name]! * 100).toFixed(1)}%`.padStart(22)).join(""));

// ---------------------------------------------------------------------------
// Save all three policies
// ---------------------------------------------------------------------------

mkdirSync("policies", { recursive: true });

for (const { name: pName, policy } of policies) {
  const path = `policies/${name}-${pName}.json`;
  writeFileSync(path, JSON.stringify(policy.toJSON()));
}

console.log(`\nPolicies saved to policies/${name}-{aggressor,control,midrange}.json`);
