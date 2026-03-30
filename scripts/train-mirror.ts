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

interface CardTrace {
  inked: number;
  played: number;
  quested: number;
  challenged: number;
}

function traceGames(
  policy: RLPolicy | null,
  deck: DeckEntry[],
  count: number,
  seedStart: number
) {
  const strategy = policy ?? RandomBot;
  const savedEpsilon = policy?.epsilon;
  if (policy) policy.epsilon = 0;

  const cards: Record<string, CardTrace> = {};
  let totalLore = 0;
  let wins = 0;

  // End-of-game zone accumulators (avg across games, player1 only)
  let totalInkwell = 0;
  let totalInPlay = 0;
  let totalBanished = 0;
  let totalHandOrDeck = 0;

  function ensure(defId: string): CardTrace {
    if (!cards[defId]) cards[defId] = { inked: 0, played: 0, quested: 0, challenged: 0 };
    return cards[defId]!;
  }

  for (let i = 0; i < count; i++) {
    if (policy) policy.clearHistory();
    const result = runGame({
      player1Deck: deck,
      player2Deck: deck,
      player1Strategy: strategy,
      player2Strategy: RandomBot,
      definitions,
      maxTurns: 80,
      seed: seedStart + i,
    });
    totalLore += result.finalLore["player1"] ?? 0;
    if (result.winner === "player1") wins++;

    // Accumulate end-of-game zone distribution for player1
    const p1Stats = Object.values(result.cardStats).filter(s => s.ownerId === "player1");
    for (const s of p1Stats) {
      if (s.inkedOnTurn !== null) totalInkwell++;
      else if (s.wasPlayed && !s.wasBanished) totalInPlay++;
      else if (s.wasBanished) totalBanished++;
      else totalHandOrDeck++;
    }

    for (const action of result.actions) {
      if (action.playerId !== "player1") continue;
      if (action.type === "CHALLENGE") {
        // CHALLENGE uses attackerInstanceId, not instanceId
        const inst = result.cardStats[action.attackerInstanceId];
        if (inst) ensure(inst.definitionId).challenged++;
        continue;
      }
      const inst = "instanceId" in action ? result.cardStats[(action as any).instanceId] : null;
      if (!inst) continue;
      const t = ensure(inst.definitionId);
      if (action.type === "PLAY_INK") t.inked++;
      if (action.type === "PLAY_CARD") t.played++;
      if (action.type === "QUEST") t.quested++;
    }
  }

  if (policy) {
    policy.epsilon = savedEpsilon!;
    policy.clearHistory();
  }

  return {
    cards,
    avgLore: totalLore / count,
    winRate: wins / count,
    avgZones: {
      inkwell: totalInkwell / count,
      inPlay: totalInPlay / count,
      banished: totalBanished / count,
      handOrDeck: totalHandOrDeck / count,
    },
  };
}

function formatZones(zones: { inkwell: number; inPlay: number; banished: number; handOrDeck: number }): string {
  const total = zones.inkwell + zones.inPlay + zones.banished + zones.handOrDeck;
  return [
    `  End-of-game zones (avg per game, player1, total≈${total.toFixed(0)}/60):`,
    `    Inkwell:      ${zones.inkwell.toFixed(1)}`,
    `    In play:      ${zones.inPlay.toFixed(1)}`,
    `    Banished:     ${zones.banished.toFixed(1)}`,
    `    Hand/Deck:    ${zones.handOrDeck.toFixed(1)}`,
  ].join("\n");
}

function formatTraceTable(cards: Record<string, CardTrace>, label: string): string {
  const lines: string[] = [];
  lines.push(`  Card preferences (${label}):`);
  lines.push("  " + "-".repeat(66));
  lines.push("  " + "Card".padEnd(36) + "Ink  Play  Quest  Chall");
  lines.push("  " + "-".repeat(66));
  const entries = Object.entries(cards).sort(
    (a, b) => b[1].played + b[1].quested + b[1].challenged - (a[1].played + a[1].quested + a[1].challenged)
  );
  for (const [defId, t] of entries) {
    const name = definitions[defId]?.fullName ?? defId;
    lines.push(
      `  ${name.padEnd(36)} ${String(t.inked).padStart(3)}  ${String(t.played).padStart(4)}  ${String(t.quested).padStart(5)}  ${String(t.challenged).padStart(5)}`
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

const baseline = traceGames(null, deck, 100, 50000);
console.log(`  Avg lore: ${baseline.avgLore.toFixed(1)}, Win rate: ${(baseline.winRate * 100).toFixed(0)}%`);
console.log(formatZones(baseline.avgZones));
console.log(formatTraceTable(baseline.cards, "random baseline"));

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
const result = trainPolicy({
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
  rewardWeights,
  onLog: (ep, _r, eps, avg) => {
    const line = `  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`;
    console.log(line);
    trainingLog.push(line);
  },
  logInterval: 1000,
});

// --- Trace: 200 trained games ---
console.log("\n" + "=".repeat(70));
console.log("TRAINED: Tracing 200 games (trained vs random)");
console.log("=".repeat(70));

const trained = traceGames(result.policy, deck, 200, 10000);
console.log(`  Avg lore: ${trained.avgLore.toFixed(1)}, Win rate: ${(trained.winRate * 100).toFixed(0)}%`);
console.log(formatZones(trained.avgZones));
console.log(formatTraceTable(trained.cards, "trained mirror"));

// --- Save ---
mkdirSync("policies", { recursive: true });
const policyPath = `policies/${name}-mirror.json`;
const tracePath = `policies/${name}-mirror-trace.txt`;

result.policy.epsilon = 0;
writeFileSync(policyPath, JSON.stringify(result.policy.toJSON()));
console.log(`\nSaved policy to ${policyPath}`);

const traceOutput = [
  `Mirror training trace: ${name}`,
  `Date: ${new Date().toISOString()}`,
  `Episodes: ${episodes}, maxTurns: 80`,
  `Training: from scratch, high exploration (ε: 1.0 → 0.05)`,
  `Reward weights: win=${rewardWeights.winWeight.toFixed(3)} lore=${rewardWeights.loreGain.toFixed(3)} denial=${rewardWeights.loreDenial.toFixed(3)} banish=${rewardWeights.banishValue.toFixed(3)} ink=${rewardWeights.inkEfficiency.toFixed(3)} trade=${rewardWeights.tradeQuality.toFixed(3)}`,
  "",
  "BASELINE (random vs random):",
  `  Avg lore: ${baseline.avgLore.toFixed(1)}, Win rate: ${(baseline.winRate * 100).toFixed(0)}%`,
  formatZones(baseline.avgZones),
  formatTraceTable(baseline.cards, "random baseline"),
  "",
  "TRAINING CURVE:",
  ...trainingLog,
  "",
  "TRAINED (trained vs random):",
  `  Avg lore: ${trained.avgLore.toFixed(1)}, Win rate: ${(trained.winRate * 100).toFixed(0)}%`,
  formatZones(trained.avgZones),
  formatTraceTable(trained.cards, "trained mirror"),
].join("\n");

writeFileSync(tracePath, traceOutput);
console.log(`Saved trace to ${tracePath}`);

const curvePath = `policies/${name}-mirror-curve.csv`;
writeFileSync(curvePath, "episode,reward\n" + result.rewardCurve.map((r, i) => `${i + 1},${r}`).join("\n"));
console.log(`Saved reward curve to ${curvePath}`);
