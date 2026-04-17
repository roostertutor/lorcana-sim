// =============================================================================
// TRAIN LADDER — Round 2 adversarial fine-tuning + curriculum control
//
// Loads the 3 policies saved by train-tournament.ts and trains 3 more:
//   aggressor  — warm-start aggressor, fine-tune vs midrange
//   midrange   — warm-start midrange, fine-tune vs aggressor
//   control    — warm-start aggressor, fine-tune vs GreedyBot (curriculum)
//
// Then runs a full 5-way round-robin + benchmarks.
// The goal: does adversarial fine-tuning unlock the deep cards (Dragon, Mickey)?
// Does curriculum control finally learn board-control lines?
//
// Usage: npx tsx scripts/train-ladder.ts --deck decks/set-001-ruby-amethyst-deck.txt
//        npx tsx scripts/train-ladder.ts --deck decks/... --episodes 5000
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename } from "path";
import {
  CARD_DEFINITIONS,
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

const definitions = CARD_DEFINITIONS;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const deckPath = getArg("--deck");
if (!deckPath) {
  console.error("Usage: npx tsx scripts/train-ladder.ts --deck <path> [--episodes N]");
  process.exit(1);
}

const episodes = parseInt(getArg("--episodes") ?? "5000", 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDeck(path: string): DeckEntry[] {
  const text = readFileSync(path, "utf-8");
  const { entries, errors } = parseDecklist(text, definitions);
  if (errors.length > 0) for (const e of errors) console.error(`  Warning: ${e}`);
  return entries;
}

function deckName(path: string): string {
  return basename(path, ".txt").replace(/^set-\d+-/, "").replace(/-deck$/, "");
}

function loadPolicy(path: string, label: string): RLPolicy {
  const json = JSON.parse(readFileSync(path, "utf-8"));
  const policy = RLPolicy.fromJSON(json);
  console.log(`  Loaded ${label} from ${path} (ε=${policy.epsilon.toFixed(4)})`);
  return policy;
}

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

function winRate(results: GameResult[]): number {
  return results.filter(r => r.winner === "player1").length / results.length;
}

function clonePolicy(source: RLPolicy, newName: string, startEpsilon: number): RLPolicy {
  const json = source.toJSON();
  json.name = newName;
  json.epsilon = startEpsilon;
  // Fresh RNG state so the clone explores differently
  const freshRng = createRng(Date.now() ^ newName.charCodeAt(0));
  json.explorationRng = { s: [...freshRng.s] as [number, number, number, number] };
  return RLPolicy.fromJSON(json);
}

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
      } else if (action.type === "PLAY_CARD" && !(action as any).singerInstanceId) {
        const inst = result.cardStats[(action as any).instanceId];
        if (inst) ensure(inst.definitionId).played++;
      } else if (action.type === "PLAY_INK") {
        const inst = result.cardStats[(action as any).instanceId];
        if (inst) ensure(inst.definitionId).inked++;
      }
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const deck = loadDeck(deckPath);
const name = deckName(deckPath);

console.log(`\nDeck: ${name} (${deck.reduce((s, e) => s + e.count, 0)} cards)`);
console.log(`Fine-tune episodes per policy: ${episodes}`);
console.log(`\nLoading Round 1 policies...`);

// Load Round 1 policies saved by train-tournament.ts
const aggressorR1 = loadPolicy(`policies/${name}-aggressor.json`, "aggressor");
const midrangeR1  = loadPolicy(`policies/${name}-midrange.json`,  "midrange");

console.log("\n" + "=".repeat(70));
console.log("ROUND 2 FINE-TUNING");
console.log("=".repeat(70));

// ---------------------------------------------------------------------------
// Fine-tune: aggressor vs midrange
// ---------------------------------------------------------------------------

console.log(`\n[1/3] Fine-tuning AGGRESSOR (warm-start aggressor → train vs midrange)...`);
console.log(`  Hypothesis: facing a board-control opponent teaches Dragon/Mickey value`);

const aggressorLadder = clonePolicy(aggressorR1, "aggressor", 0.4);
// Wrap midrange as a fixed opponent (epsilon=0)
const midrangeOpponent = clonePolicy(midrangeR1, "midrange-opp", 0);

const aggressorResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: midrangeOpponent,
  episodes,
  seed: 400,
  maxTurns: 80,
  learningRate: 0.0005,
  epsilon: 0.4,
  minEpsilon: 0.05,
  decayRate: 0.9994,
  practiceOpponent: RandomBot,   // keep fundamentals while learning vs midrange
  practiceGamesPerEpisode: 2,
  practiceWeight: 0.5,
  logInterval: Math.floor(episodes / 5),
  onLog: (ep, _r, eps, avg) =>
    console.log(`  ep ${ep.toString().padStart(6)}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`),
});
aggressorResult.policy.epsilon = 0;
console.log(`  Final ε=${aggressorResult.finalEpsilon.toFixed(4)}`);

// ---------------------------------------------------------------------------
// Fine-tune: midrange vs aggressor
// ---------------------------------------------------------------------------

console.log(`\n[2/3] Fine-tuning MIDRANGE (warm-start midrange → train vs aggressor)...`);
console.log(`  Hypothesis: facing a quest-flood opponent teaches tempo reads`);

const midrangeLadder = clonePolicy(midrangeR1, "midrange", 0.4);
const aggressorOpponent = clonePolicy(aggressorR1, "aggressor-opp", 0);

const midrangeResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: aggressorOpponent,
  episodes,
  seed: 500,
  maxTurns: 80,
  learningRate: 0.0005,
  epsilon: 0.4,
  minEpsilon: 0.05,
  decayRate: 0.9994,
  practiceOpponent: RandomBot,   // keep fundamentals while learning vs aggressor
  practiceGamesPerEpisode: 2,
  practiceWeight: 0.5,
  logInterval: Math.floor(episodes / 5),
  onLog: (ep, _r, eps, avg) =>
    console.log(`  ep ${ep.toString().padStart(6)}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`),
});
midrangeResult.policy.epsilon = 0;
console.log(`  Final ε=${midrangeResult.finalEpsilon.toFixed(4)}`);

// ---------------------------------------------------------------------------
// Curriculum control: aggressor base → fine-tune vs GreedyBot
// ---------------------------------------------------------------------------

console.log(`\n[3/3] Fine-tuning CONTROL (warm-start aggressor → train vs GreedyBot)...`);
console.log(`  Hypothesis: curriculum bridging solves the cold-start vs greedy problem`);

const control = clonePolicy(aggressorR1, "control", 0.4);

const controlResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: GreedyBot,
  episodes,
  seed: 600,
  maxTurns: 80,
  learningRate: 0.0005,
  epsilon: 0.4,
  minEpsilon: 0.05,
  decayRate: 0.9994,
  practiceOpponent: RandomBot,   // anchor to basics while adapting to greedy
  practiceGamesPerEpisode: 2,
  practiceWeight: 0.5,
  logInterval: Math.floor(episodes / 5),
  onLog: (ep, _r, eps, avg) =>
    console.log(`  ep ${ep.toString().padStart(6)}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`),
});
controlResult.policy.epsilon = 0;
console.log(`  Final ε=${controlResult.finalEpsilon.toFixed(4)}`);

// ---------------------------------------------------------------------------
// 5-way round-robin
// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(70));
console.log("5-WAY ROUND-ROBIN TOURNAMENT (100 games per pairing)");
console.log("=".repeat(70));

const allPolicies: Array<{ label: string; policy: RLPolicy }> = [
  { label: "aggressor-r1", policy: aggressorR1 },
  { label: "midrange-r1",  policy: midrangeR1 },
  { label: "aggressor",    policy: aggressorResult.policy },
  { label: "midrange",     policy: midrangeResult.policy },
  { label: "control",      policy: controlResult.policy },
];

const GAMES = 100;

// Win matrix
console.log(`\nWin rate as row policy (${GAMES} games each):`);
const colWidth = 11;
console.log("".padEnd(13) + allPolicies.map(p => p.label.padStart(colWidth)).join(""));
console.log("".padEnd(13) + "-".repeat(allPolicies.length * colWidth));

const matrix: number[][] = [];

for (let i = 0; i < allPolicies.length; i++) {
  const { label: rowLabel, policy: rowPolicy } = allPolicies[i]!;
  const row: number[] = [];
  let rowStr = rowLabel.padEnd(13);
  for (let j = 0; j < allPolicies.length; j++) {
    if (i === j) {
      row.push(0.5);
      rowStr += "—".padStart(colWidth);
    } else {
      const { label: colLabel, policy: colPolicy } = allPolicies[j]!;
      process.stdout.write(`  ${rowLabel} vs ${colLabel}...`);
      const results = evalGames(rowPolicy, colPolicy, deck, deck, GAMES, 50000 + i * 1000 + j * 100);
      const wr = winRate(results);
      row.push(wr);
      process.stdout.write(`\r`);
      rowStr += `${(wr * 100).toFixed(0)}%`.padStart(colWidth);
    }
  }
  matrix.push(row);
  console.log(rowStr);
}

// Overall score (avg win rate across all opponents)
console.log("\nOverall score (avg win rate vs all others):");
for (let i = 0; i < allPolicies.length; i++) {
  const row = matrix[i]!;
  const others = row.filter((_, j) => j !== i);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  console.log(`  ${allPolicies[i]!.label.padEnd(14)} ${(avg * 100).toFixed(1)}%`);
}

// vs benchmarks
console.log(`\nVs fixed benchmarks (${GAMES} games each):`);
const benchmarks: Array<{ label: string; strategy: BotStrategy }> = [
  { label: "random", strategy: RandomBot },
  { label: "greedy", strategy: GreedyBot },
];
console.log("".padEnd(13) + benchmarks.map(b => b.label.padStart(9)).join(""));

for (const { label, policy } of allPolicies) {
  let row = label.padEnd(13);
  for (const { label: bLabel, strategy } of benchmarks) {
    process.stdout.write(`  ${label} vs ${bLabel}...`);
    const results = evalGames(policy, strategy, deck, deck, GAMES, 60000 + label.charCodeAt(0) * 1000);
    const wr = winRate(results);
    process.stdout.write(`\r`);
    row += `${(wr * 100).toFixed(1)}%`.padStart(9);
  }
  console.log(row);
}

// ---------------------------------------------------------------------------
// Card usage spotlight — what do the ladder policies do differently?
// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(70));
console.log("CARD USAGE: ladder policies vs RandomBot (100 games each)");
console.log("=".repeat(70));

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

const ladderPolicies = allPolicies.slice(2); // aggressor, midrange, control
const ladderStats: Record<string, ReturnType<typeof querySimple>> = {};
const ladderWrs: Record<string, number> = {};

for (const { label, policy } of ladderPolicies) {
  process.stdout.write(`  evaluating ${label}...`);
  const results = evalGames(policy, RandomBot, deck, deck, GAMES, 70000 + label.charCodeAt(0) * 1000);
  ladderStats[label] = querySimple(results);
  ladderWrs[label] = winRate(results);
  process.stdout.write(`\r`);
}

const colW = 22;
console.log("\n" + "Card".padEnd(36) + ladderPolicies.map(p => p.label.padStart(colW)).join(""));
console.log("-".repeat(36 + ladderPolicies.length * colW));

for (const defId of spotlight) {
  const def = definitions[defId];
  if (!def) continue;
  const n = def.fullName.length > 35 ? def.fullName.slice(0, 34) + "…" : def.fullName;
  let row = n.padEnd(36);
  for (const { label } of ladderPolicies) {
    const s = ladderStats[label]?.[defId] ?? { played: 0, quested: 0, challenged: 0, inked: 0 };
    row += `${s.inked}i/${s.played}p/${s.quested}q/${s.challenged}c`.padStart(colW);
  }
  console.log(row);
}

console.log("\nWin rate vs Random:".padEnd(36) +
  ladderPolicies.map(p => `${(ladderWrs[p.label]! * 100).toFixed(1)}%`.padStart(colW)).join(""));

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

mkdirSync("policies", { recursive: true });
for (const { label, policy } of allPolicies.slice(2)) {
  writeFileSync(`policies/${name}-${label}.json`, JSON.stringify(policy.toJSON()));
}
console.log(`\nSaved policies/${name}-{aggressor,midrange,control}.json`);
