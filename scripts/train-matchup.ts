// =============================================================================
// Train RL — Stage 2: Fine-tune (per matchup)
// Warm-starts from preschool policy. Trains with win/loss reward against
// a specific opponent deck.
//
// Usage: npx tsx scripts/train-matchup.ts \
//   --preschool policies/ruby-amethyst-preschool.json \
//   --deck decks/set-001-ruby-amethyst-deck.txt \
//   --opponent-deck decks/set-001-ruby-amethyst-deck.txt
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

const preschoolPath = getArg("--preschool");
const deckPath = getArg("--deck");
const oppDeckPath = getArg("--opponent-deck");

if (!preschoolPath || !deckPath || !oppDeckPath) {
  console.error(
    "Usage: npx tsx scripts/train-matchup.ts --preschool <policy> --deck <path> --opponent-deck <path>"
  );
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
  policy: RLPolicy,
  deck: DeckEntry[],
  oppDeck: DeckEntry[],
  count: number,
  seedStart: number
) {
  const savedEpsilon = policy.epsilon;
  policy.epsilon = 0;

  const cards: Record<string, CardTrace> = {};
  let totalLore = 0;
  let wins = 0;

  function ensure(defId: string): CardTrace {
    if (!cards[defId]) cards[defId] = { inked: 0, played: 0, quested: 0, challenged: 0 };
    return cards[defId]!;
  }

  for (let i = 0; i < count; i++) {
    policy.clearHistory();
    const result = runGame({
      player1Deck: deck,
      player2Deck: oppDeck,
      player1Strategy: policy,
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

  policy.epsilon = savedEpsilon;
  policy.clearHistory();

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
const oppDeck = loadDeck(oppDeckPath);
const name = deckName(deckPath);
const oppName = deckName(oppDeckPath);

console.log(`Deck:     ${name} (${deck.reduce((s, e) => s + e.count, 0)} cards)`);
console.log(`Opponent: ${oppName} (${oppDeck.reduce((s, e) => s + e.count, 0)} cards)`);

// Load preschool policy
console.log(`\nLoading preschool policy from ${preschoolPath}...`);
const preschoolJSON = JSON.parse(readFileSync(preschoolPath, "utf-8"));
const preschoolPolicy = RLPolicy.fromJSON(preschoolJSON);
console.log("  Loaded.");

// --- Train: fine-tune for matchup ---
console.log("\n" + "=".repeat(70));
console.log(`FINE-TUNE: ${name} vs ${oppName} (5000 episodes, win/loss reward)`);
console.log("=".repeat(70));

// Reset epsilon for exploration during fine-tuning
preschoolPolicy.epsilon = 0.3;

const result = trainPolicy({
  deck,
  opponentDeck: oppDeck,
  definitions,
  opponent: RandomBot,
  episodes: 5000,
  seed: 77,
  maxTurns: 25,
  learningRate: 0.0005, // lower LR for fine-tuning
  epsilon: 0.3, // less exploration since we have a base
  minEpsilon: 0.05,
  decayRate: 0.9994,
  warmStart: preschoolPolicy,
  reward: (r) => {
    if (r.winner === "player1") return 1;
    if (r.winner === "draw") return 0.3;
    return 0;
  },
  onLog: (ep, _r, eps, avg) => {
    console.log(`  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`);
  },
  logInterval: 1000,
});

// --- Trace: 100 games after fine-tuning ---
console.log("\n" + "=".repeat(70));
console.log(`RESULTS: Tracing 100 games (${name} vs ${oppName})`);
console.log("=".repeat(70));

const trace = traceGames(result.policy, deck, oppDeck, 100, 30000);
console.log(`  Avg lore: ${trace.avgLore.toFixed(1)}, Win rate: ${(trace.winRate * 100).toFixed(0)}%`);
console.log(formatTraceTable(trace.cards, `${name} vs ${oppName}`));

// --- Save ---
mkdirSync("policies", { recursive: true });
const policyPath = `policies/${name}-vs-${oppName}.json`;
const tracePath = `policies/${name}-vs-${oppName}-trace.txt`;

result.policy.epsilon = 0;
writeFileSync(policyPath, JSON.stringify(result.policy.toJSON()));
console.log(`\nSaved policy to ${policyPath}`);

const traceOutput = [
  `Matchup fine-tune trace: ${name} vs ${oppName}`,
  `Date: ${new Date().toISOString()}`,
  `Preschool: ${preschoolPath}`,
  `Episodes: 5000, Reward: win=1/draw=0.3/loss=0, maxTurns: 25`,
  "",
  `RESULTS (${name} vs ${oppName}):`,
  `  Avg lore: ${trace.avgLore.toFixed(1)}`,
  `  Win rate: ${(trace.winRate * 100).toFixed(0)}%`,
  formatTraceTable(trace.cards, `${name} vs ${oppName}`),
].join("\n");

writeFileSync(tracePath, traceOutput);
console.log(`Saved trace to ${tracePath}`);
