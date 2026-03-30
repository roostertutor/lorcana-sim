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
import { trainPolicy, RLPolicy, RandomBot, runGame } from "@lorcana-sim/simulator";
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
      maxTurns: 30,
      seed: seedStart + i,
    });
    totalLore += result.finalLore["player1"] ?? 0;
    if (result.winner === "player1") wins++;

    for (const action of result.actions) {
      if (action.playerId !== "player1") continue;
      const inst = "instanceId" in action ? result.cardStats[(action as any).instanceId] : null;
      if (!inst) continue;
      const t = ensure(inst.definitionId);
      if (action.type === "PLAY_INK") t.inked++;
      if (action.type === "PLAY_CARD") t.played++;
      if (action.type === "QUEST") t.quested++;
      if (action.type === "CHALLENGE") t.challenged++;
    }
  }

  if (policy) {
    policy.epsilon = savedEpsilon!;
    policy.clearHistory();
  }

  return { cards, avgLore: totalLore / count, winRate: wins / count };
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
console.log(formatTraceTable(baseline.cards, "random baseline"));

// --- Train: mirror from scratch ---
console.log("\n" + "=".repeat(70));
console.log(`TRAINING: ${name} mirror (${episodes} episodes, win/loss reward, high exploration)`);
console.log("=".repeat(70));

const result = trainPolicy({
  deck,
  opponentDeck: deck,
  definitions,
  opponent: RandomBot,
  episodes,
  seed: 42,
  maxTurns: 30,
  learningRate: 0.001,
  epsilon: 1.0,
  minEpsilon: 0.05,
  decayRate: 0.9995,
  reward: (r) => {
    if (r.winner === "player1") return 1;
    if (r.winner === "draw") return 0.1;
    return 0;
  },
  onLog: (ep, _r, eps, avg) => {
    console.log(`  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`);
  },
  logInterval: 1000,
});

// --- Trace: 200 trained games ---
console.log("\n" + "=".repeat(70));
console.log("TRAINED: Tracing 200 games (trained vs random)");
console.log("=".repeat(70));

const trained = traceGames(result.policy, deck, 200, 10000);
console.log(`  Avg lore: ${trained.avgLore.toFixed(1)}, Win rate: ${(trained.winRate * 100).toFixed(0)}%`);
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
  `Episodes: ${episodes}, Reward: win=1/draw=0.1/loss=0, maxTurns: 30`,
  `Training: from scratch, high exploration (ε: 1.0 → 0.05)`,
  "",
  "BASELINE (random vs random):",
  `  Avg lore: ${baseline.avgLore.toFixed(1)}, Win rate: ${(baseline.winRate * 100).toFixed(0)}%`,
  formatTraceTable(baseline.cards, "random baseline"),
  "",
  "TRAINED (trained vs random):",
  `  Avg lore: ${trained.avgLore.toFixed(1)}, Win rate: ${(trained.winRate * 100).toFixed(0)}%`,
  formatTraceTable(trained.cards, "trained mirror"),
].join("\n");

writeFileSync(tracePath, traceOutput);
console.log(`Saved trace to ${tracePath}`);
