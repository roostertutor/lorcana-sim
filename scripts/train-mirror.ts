// =============================================================================
// Train RL — Mirror match (from scratch, high exploration)
// Trains directly against a RandomBot opponent playing the same deck.
// No warm-start — learns inking, playing, questing, AND challenging together.
//
// Usage: npx tsx scripts/train-mirror.ts --deck decks/set-001-ruby-amethyst-deck.txt
//        npx tsx scripts/train-mirror.ts --deck decks/set-001-ruby-amethyst-deck.txt --episodes 10000
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename } from "path";
import { LORCAST_CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import { trainPolicy, RLPolicy, RandomBot, runGame, inferRewardWeights } from "@lorcana-sim/simulator";
import type { GameResult } from "@lorcana-sim/simulator";
import { aggregateResults } from "@lorcana-sim/analytics";
import type { DeckEntry } from "@lorcana-sim/engine";

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
  console.error("Usage: npx tsx scripts/train-mirror.ts --deck <path> [--episodes N]");
  process.exit(1);
}

const episodes = parseInt(getArg("--episodes") ?? "10000", 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDeck(path: string): DeckEntry[] {
  const text = readFileSync(path, "utf-8");
  const { entries, errors } = parseDecklist(text, definitions);
  if (errors.length > 0) {
    console.error(`  Warnings for ${path}:`);
    for (const e of errors) console.error(`    ${e}`);
  }
  return entries;
}

function deckName(path: string): string {
  return basename(path, ".txt")
    .replace(/^set-\d+-/, "")
    .replace(/-deck$/, "");
}

// ---------------------------------------------------------------------------
// Game runner — collects raw results, no inline stat tracking
// ---------------------------------------------------------------------------

function runGames(
  policy: RLPolicy | null,
  deck: DeckEntry[],
  count: number,
  seedStart: number
): GameResult[] {
  const strategy = policy ?? RandomBot;
  const savedEpsilon = policy?.epsilon;
  if (policy) policy.epsilon = 0;

  const results: GameResult[] = [];
  for (let i = 0; i < count; i++) {
    if (policy) policy.clearHistory();
    results.push(runGame({
      player1Deck: deck,
      player2Deck: deck,
      player1Strategy: strategy,
      player2Strategy: RandomBot,
      definitions,
      maxTurns: 80,
      seed: seedStart + i,
    }));
  }

  if (policy) {
    policy.epsilon = savedEpsilon!;
    policy.clearHistory();
  }
  return results;
}

// ---------------------------------------------------------------------------
// Post-hoc queries over GameResult[]
// ---------------------------------------------------------------------------

/** Action-level counts derived from result.actions — things cardStats doesn't track */
interface ActionStats {
  inked: number;
  played: number;   // hard-played (no singerInstanceId)
  sung: number;     // played AS a song
  sungBy: number;   // used as the singer character
  quested: number;
  challenged: number;
  activated: number;
}

function queryActionStats(results: GameResult[]): Record<string, ActionStats> {
  const stats: Record<string, ActionStats> = {};

  function ensure(defId: string): ActionStats {
    if (!stats[defId]) stats[defId] = { inked: 0, played: 0, sung: 0, sungBy: 0, quested: 0, challenged: 0, activated: 0 };
    return stats[defId]!;
  }

  for (const result of results) {
    for (const action of result.actions) {
      if (action.playerId !== "player1") continue;

      if (action.type === "CHALLENGE") {
        const inst = result.cardStats[action.attackerInstanceId];
        if (inst) ensure(inst.definitionId).challenged++;
        continue;
      }
      if (action.type === "ACTIVATE_ABILITY") {
        const inst = result.cardStats[(action as any).instanceId];
        if (inst) ensure(inst.definitionId).activated++;
        continue;
      }

      const inst = "instanceId" in action ? result.cardStats[(action as any).instanceId] : null;
      if (!inst) continue;
      const s = ensure(inst.definitionId);

      if (action.type === "PLAY_INK") s.inked++;
      if (action.type === "PLAY_CARD") {
        const singerInstanceId = (action as any).singerInstanceId;
        if (singerInstanceId) {
          s.sung++;
          const singerInst = result.cardStats[singerInstanceId];
          if (singerInst) ensure(singerInst.definitionId).sungBy++;
        } else {
          s.played++;
        }
      }
      if (action.type === "QUEST") s.quested++;
    }
  }
  return stats;
}

/** End-of-game zone distribution for player1 */
function queryZones(results: GameResult[]) {
  let inkwell = 0, inPlay = 0, banished = 0, handOrDeck = 0;
  for (const result of results) {
    for (const s of Object.values(result.cardStats)) {
      if (s.ownerId !== "player1") continue;
      if (s.inkedOnTurn !== null) inkwell++;
      else if (s.wasPlayed && !s.wasBanished) inPlay++;
      else if (s.wasBanished) banished++;
      else handOrDeck++;
    }
  }
  const n = results.length;
  return { inkwell: inkwell / n, inPlay: inPlay / n, banished: banished / n, handOrDeck: handOrDeck / n };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatZones(zones: ReturnType<typeof queryZones>): string {
  const total = zones.inkwell + zones.inPlay + zones.banished + zones.handOrDeck;
  return [
    `  End-of-game zones (avg per game, player1, total≈${total.toFixed(0)}/60):`,
    `    Inkwell:      ${zones.inkwell.toFixed(1)}`,
    `    In play:      ${zones.inPlay.toFixed(1)}`,
    `    Banished:     ${zones.banished.toFixed(1)}`,
    `    Hand/Deck:    ${zones.handOrDeck.toFixed(1)}`,
  ].join("\n");
}

function formatCardTable(
  actionStats: Record<string, ActionStats>,
  cardPerf: Record<string, { winRateWhenDrawn: number; avgLoreContributed: number }>,
  label: string
): string {
  const SEP = "  " + "-".repeat(88);
  const lines: string[] = [];
  lines.push(`  Card stats (${label}):`);
  lines.push(SEP);
  lines.push(
    "  " + "Card".padEnd(32) +
    "Ink".padStart(4) + "Play".padStart(5) + "Sung".padStart(5) +
    "Quest".padStart(6) + "Chall".padStart(6) + "SungBy".padStart(7) + "Activ".padStart(6) +
    "WR%drawn".padStart(9) + "Lore/g".padStart(7)
  );
  lines.push(SEP);

  // All known defIds from either source
  const allIds = new Set([...Object.keys(actionStats), ...Object.keys(cardPerf)]);
  const entries = [...allIds].sort((a, b) => {
    const sA = actionStats[a];
    const sB = actionStats[b];
    const scoreA = (sA?.played ?? 0) + (sA?.quested ?? 0) + (sA?.challenged ?? 0) + (sA?.sung ?? 0) + (sA?.activated ?? 0);
    const scoreB = (sB?.played ?? 0) + (sB?.quested ?? 0) + (sB?.challenged ?? 0) + (sB?.sung ?? 0) + (sB?.activated ?? 0);
    return scoreB - scoreA;
  });

  for (const defId of entries) {
    const fullName = definitions[defId]?.fullName ?? defId;
    const name = fullName.length > 31 ? fullName.slice(0, 30) + "…" : fullName;
    const s = actionStats[defId] ?? { inked: 0, played: 0, sung: 0, sungBy: 0, quested: 0, challenged: 0, activated: 0 };
    const p = cardPerf[defId];
    const wr = p ? `${(p.winRateWhenDrawn * 100).toFixed(0)}%` : "  —";
    const lore = p ? p.avgLoreContributed.toFixed(1) : " —";
    lines.push(
      "  " + name.padEnd(32) +
      String(s.inked).padStart(4) +
      String(s.played).padStart(5) +
      String(s.sung).padStart(5) +
      String(s.quested).padStart(6) +
      String(s.challenged).padStart(6) +
      String(s.sungBy).padStart(7) +
      String(s.activated).padStart(6) +
      wr.padStart(9) +
      lore.padStart(7)
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const deck = loadDeck(deckPath);
const name = deckName(deckPath);
console.log(`Deck: ${name} (${deck.reduce((s, e) => s + e.count, 0)} cards)`);
console.log(`Episodes: ${episodes}`);

// --- Baseline: 100 random games ---
console.log("\n" + "=".repeat(70));
console.log("BASELINE: 100 random vs random games");
console.log("=".repeat(70));

const baselineResults = runGames(null, deck, 100, 50000);
const baselineStats = aggregateResults(baselineResults);
const baselineActions = queryActionStats(baselineResults);
const baselineZones = queryZones(baselineResults);

console.log(`  Avg lore: ${(baselineResults.reduce((s, r) => s + (r.finalLore["player1"] ?? 0), 0) / baselineResults.length).toFixed(1)}, Win rate: ${(baselineStats.winRate * 100).toFixed(0)}%`);
console.log(formatZones(baselineZones));
console.log(formatCardTable(baselineActions, baselineStats.cardPerformance, "random baseline"));

// --- Infer reward weights from deck ---
const rewardWeights = inferRewardWeights(deck, definitions);
console.log("\nInferred reward weights:");
console.log(`  winWeight:      ${rewardWeights.winWeight.toFixed(3)}`);
console.log(`  loreGain:       ${rewardWeights.loreGain.toFixed(3)}`);
console.log(`  loreDenial:     ${rewardWeights.loreDenial.toFixed(3)}`);
console.log(`  banishValue:    ${rewardWeights.banishValue.toFixed(3)}`);
console.log(`  inkEfficiency:  ${rewardWeights.inkEfficiency.toFixed(3)}`);
console.log(`  tradeQuality:   ${rewardWeights.tradeQuality.toFixed(3)}`);

// --- Train: mirror from scratch ---
console.log("\n" + "=".repeat(70));
console.log(`TRAINING: ${name} mirror (${episodes} episodes, deck-inferred reward, high exploration)`);
console.log("=".repeat(70));

const trainingLog: string[] = [];
const trainingResult = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: RandomBot,
  episodes,
  seed: 42,
  maxTurns: 80,
  learningRate: 0.001,
  epsilon: 1.0,
  minEpsilon: 0.05,
  decayRate: 0.9995,
  // Simple win=1/loss=0 reward — the full range is critical for A2C.
  // Weighted rewards compress win/loss into ~0.3–0.5, collapsing advantages to ~0.
  onLog: (ep, _r, eps, avg) => {
    const line = `  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`;
    console.log(line);
    trainingLog.push(line);
  },
  logInterval: 1000,
});

// --- Evaluate: 200 trained games ---
console.log("\n" + "=".repeat(70));
console.log("TRAINED: 200 games (trained vs random)");
console.log("=".repeat(70));

const trainedResults = runGames(trainingResult.policy, deck, 200, 10000);
const trainedStats = aggregateResults(trainedResults);
const trainedActions = queryActionStats(trainedResults);
const trainedZones = queryZones(trainedResults);

console.log(`  Avg lore: ${(trainedResults.reduce((s, r) => s + (r.finalLore["player1"] ?? 0), 0) / trainedResults.length).toFixed(1)}, Win rate: ${(trainedStats.winRate * 100).toFixed(0)}%`);
console.log(formatZones(trainedZones));
console.log(formatCardTable(trainedActions, trainedStats.cardPerformance, "trained mirror"));

// --- Save ---
mkdirSync("policies", { recursive: true });
const policyPath = `policies/${name}-mirror.json`;
const tracePath  = `policies/${name}-mirror-trace.txt`;

trainingResult.policy.epsilon = 0;
writeFileSync(policyPath, JSON.stringify(trainingResult.policy.toJSON()));
console.log(`\nSaved policy to ${policyPath}`);

const avgLoreBaseline = (baselineResults.reduce((s, r) => s + (r.finalLore["player1"] ?? 0), 0) / baselineResults.length).toFixed(1);
const avgLoreTrained  = (trainedResults.reduce((s, r)  => s + (r.finalLore["player1"] ?? 0), 0) / trainedResults.length).toFixed(1);

const traceOutput = [
  `Mirror training trace: ${name}`,
  `Date: ${new Date().toISOString()}`,
  `Episodes: ${episodes}, maxTurns: 80`,
  `Training: from scratch, high exploration (ε: 1.0 → 0.05)`,
  `Reward weights: win=${rewardWeights.winWeight.toFixed(3)} lore=${rewardWeights.loreGain.toFixed(3)} denial=${rewardWeights.loreDenial.toFixed(3)} banish=${rewardWeights.banishValue.toFixed(3)} ink=${rewardWeights.inkEfficiency.toFixed(3)} trade=${rewardWeights.tradeQuality.toFixed(3)}`,
  "",
  "BASELINE (random vs random):",
  `  Avg lore: ${avgLoreBaseline}, Win rate: ${(baselineStats.winRate * 100).toFixed(0)}%`,
  formatZones(baselineZones),
  formatCardTable(baselineActions, baselineStats.cardPerformance, "random baseline"),
  "",
  "TRAINING CURVE:",
  ...trainingLog,
  "",
  "TRAINED (trained vs random):",
  `  Avg lore: ${avgLoreTrained}, Win rate: ${(trainedStats.winRate * 100).toFixed(0)}%`,
  formatZones(trainedZones),
  formatCardTable(trainedActions, trainedStats.cardPerformance, "trained mirror"),
].join("\n");

writeFileSync(tracePath, traceOutput);
console.log(`Saved trace to ${tracePath}`);

const curvePath = `policies/${name}-mirror-curve.csv`;
writeFileSync(curvePath, "episode,reward\n" + trainingResult.rewardCurve.map((r, i) => `${i + 1},${r}`).join("\n"));
console.log(`Saved reward curve to ${curvePath}`);
