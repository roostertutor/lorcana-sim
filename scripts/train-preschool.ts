// =============================================================================
// Train RL — Stage 1: Preschool (goldfish, per deck archetype)
// Teaches basic deck mechanics: which cards to ink, play, quest.
// Uses lore/20 reward in goldfish (vs RandomBot, no interaction).
//
// Usage: npx tsx scripts/train-preschool.ts --deck decks/set-001-ruby-amethyst-deck.txt
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename } from "path";
import { CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import { trainPolicy, RLPolicy, RandomBot, runGame } from "@lorcana-sim/simulator";
import type { DeckEntry } from "@lorcana-sim/engine";

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
  console.error("Usage: npx tsx scripts/train-preschool.ts --deck <path>");
  process.exit(1);
}

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
  oppDeck: DeckEntry[],
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
      player2Deck: oppDeck,
      player1Strategy: strategy,
      player2Strategy: RandomBot,
      definitions,
      maxTurns: 25,
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

function formatTraceTable(
  cards: Record<string, CardTrace>,
  label: string
): string {
  const lines: string[] = [];
  lines.push(`  Card preferences (${label}):`);
  lines.push("  " + "-".repeat(66));
  lines.push("  " + "Card".padEnd(36) + "Ink  Play  Quest  Chall");
  lines.push("  " + "-".repeat(66));
  const entries = Object.entries(cards).sort(
    (a, b) => b[1].played + b[1].quested - (a[1].played + a[1].quested)
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

// --- Baseline: trace 100 untrained games ---
console.log("\n" + "=".repeat(70));
console.log("BASELINE: 100 untrained (random) games");
console.log("=".repeat(70));

const baseline = traceGames(null, deck, deck, 100, 50000);
console.log(`  Avg lore: ${baseline.avgLore.toFixed(1)}`);
console.log(formatTraceTable(baseline.cards, "untrained baseline"));

// --- Train: goldfish preschool ---
console.log("\n" + "=".repeat(70));
console.log(`PRESCHOOL: Training ${name} (5000 episodes, goldfish lore/20 reward)`);
console.log("=".repeat(70));

const result = trainPolicy({
  deck,
  opponentDeck: deck, // mirror for goldfish
  definitions,
  opponent: RandomBot,
  episodes: 5000,
  seed: 42,
  maxTurns: 25,
  learningRate: 0.001,
  epsilon: 1.0,
  minEpsilon: 0.05,
  decayRate: 0.9994,
  reward: (r) => Math.min((r.finalLore["player1"] ?? 0) / 20, 1),
  onLog: (ep, _r, eps, avg) => {
    console.log(`  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`);
  },
  logInterval: 1000,
});

// --- Trace: 100 trained games ---
console.log("\n" + "=".repeat(70));
console.log("TRAINED: Tracing 100 games after preschool");
console.log("=".repeat(70));

const trained = traceGames(result.policy, deck, deck, 100, 10000);
console.log(`  Avg lore: ${trained.avgLore.toFixed(1)}`);
console.log(formatTraceTable(trained.cards, "after preschool"));

// --- Comparison ---
console.log("\n" + "=".repeat(70));
console.log("COMPARISON: Untrained vs Preschool");
console.log("=".repeat(70));
console.log(`  Avg lore: ${baseline.avgLore.toFixed(1)} → ${trained.avgLore.toFixed(1)} (${trained.avgLore > baseline.avgLore ? "+" : ""}${(trained.avgLore - baseline.avgLore).toFixed(1)})`);

// --- Save ---
mkdirSync("policies", { recursive: true });
const policyPath = `policies/${name}-preschool.json`;
const tracePath = `policies/${name}-preschool-trace.txt`;

result.policy.epsilon = 0;
writeFileSync(policyPath, JSON.stringify(result.policy.toJSON()));
console.log(`\nSaved policy to ${policyPath}`);

const traceOutput = [
  `Preschool training trace for ${name}`,
  `Date: ${new Date().toISOString()}`,
  `Episodes: 5000, Reward: lore/20, maxTurns: 25`,
  "",
  "BASELINE (untrained):",
  `  Avg lore: ${baseline.avgLore.toFixed(1)}`,
  formatTraceTable(baseline.cards, "untrained baseline"),
  "",
  "TRAINED (after preschool):",
  `  Avg lore: ${trained.avgLore.toFixed(1)}`,
  formatTraceTable(trained.cards, "after preschool"),
  "",
  `Improvement: ${baseline.avgLore.toFixed(1)} → ${trained.avgLore.toFixed(1)} avg lore`,
].join("\n");

writeFileSync(tracePath, traceOutput);
console.log(`Saved trace to ${tracePath}`);
