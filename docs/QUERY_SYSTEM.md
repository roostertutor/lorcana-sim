# QUERY_SYSTEM.md
# Spec for enriched game records and condition-based simulation queries.
# "Tell me something I can't figure out from playing 100 games."
#
# STATUS: IMPLEMENTED (Parts A-D). SQLite deferred.
#
# Parts:
#   Part A — Enrich GameResult with per-card timeline data + win rate stats
#   Part B — GameCondition query language to filter/aggregate over results
#   Part C — CLI interface (pnpm query)
#   Part D — Result storage (StoredResultSet with metadata, JSON files)
#
# CLI usage:
#   pnpm query --sim sim.json --questions questions.json [--save results.json]
#   pnpm query --questions questions.json --results saved.json
#
# File types:
#   *-sim.json        — simulation config (deck, opponent, bot, iterations)
#   *-questions.json  — queries array (reusable across different result sets)
#   *.sim-results.json — saved results (gitignored)
#
# Files changed: simulator/types.ts, simulator/runGame.ts,
#                simulator/storage.ts (new),
#                analytics/query.ts (new), cli/commands/query.ts (new),
#                cli/main.ts (add "query" subcommand)
#
# Implementation notes:
#   - turnNumber is global (both players share it): turn 1 = p1's first,
#     turn 2 = p2's first, turn 3 = p1's second, etc.
#   - Query conditions use global turnNumber, not per-player turn count.
#   - Cards in starting hand get drawnOnTurn = 1.
#   - CardPerformance type unchanged (aggregator updated detection logic only).
#   - player1 always goes first, player2 always goes second. To query from
#     the second player's perspective, set "player": "player2" on conditions.
#   - Part D (result storage): StoredResultSet with metadata implemented.
#     saveResults/loadResults in simulator/storage.ts. Saves stripped
#     GameResult[] as JSON with metadata (deck, opponent, bot, iterations,
#     timestamp, engineVersion). actionLog omitted for size.
#     --save works on analyze, compare, and query commands.
#     Files named *.sim-results.json are gitignored.
#     Proper indexed storage (SQLite, compression) deferred until we know
#     what longitudinal questions we want to ask.

---

## The Mental Model

Each simulated game produces a record. The record answers:
- What happened turn by turn?
- When was each card drawn / played?
- How much ink was available each turn?
- Who won?

A query is a filter + aggregation over those records.

```
Run 5000 games → [GameRecord, GameRecord, ...]
                        ↓
            filter by GameCondition
                        ↓
          { probability, winRate, winRateWithout, delta }
```

The "hard part" is not the query — it's the filter. The filter needs
rich per-game data to work against. That's Part A.

---

## Part A — Enriched Game Records

### Problem with current CardGameStats

Current stats are process-oriented (what happened) and don't track timing:

```typescript
// Current — not enough for queries
interface CardGameStats {
  turnsInPlay: number      // total turns, not which turns
  timesQuested: number
  loreContributed: number
  wasBanished: boolean
  // NO: drawnOnTurn, playedOnTurn, inkAvailableWhenPlayed
}
```

The aggregator tries to infer "was drawn" from `turnsInPlay > 0` — a proxy
that misses cards drawn but inked or kept in hand all game.

### New CardGameStats

Replace entirely in `packages/simulator/src/types.ts`.
Keep definitionId and instanceId. Replace everything else.

```typescript
export interface CardGameStats {
  instanceId: string;
  definitionId: string;
  ownerId: "player1" | "player2";   // NEW — which player owns this card

  // --- Timeline ---
  drawnOnTurn: number | null;        // null = never drawn (stayed in deck)
  playedOnTurn: number | null;       // null = never played (inked, stayed in hand, etc.)
  inkedOnTurn: number | null;        // null = never inked
  inPlayOnTurns: number[];           // [3,4,5,6] = was in play zone these turns

  // --- Context when played ---
  inkAvailableWhenPlayed: number | null;   // ink available on the turn it was played
  wasShifted: boolean;                     // played via shift cost

  // --- Outcome ---
  wasPlayed: boolean;                // shorthand: playedOnTurn !== null
  wasBanished: boolean;

  // --- Contributions (kept for diagnostics, not primary metrics) ---
  loreContributed: number;
  timesQuested: number;
  timesChallenged: number;
}
```

### New GameRecord (rename from GameResult, or extend it)

Keep `GameResult` as-is for backwards compatibility with existing code.
Add `GameRecord` as the enriched version for query purposes.

Actually — don't rename. Just add fields to `GameResult` directly.
The new fields are additive. Existing code ignores them.

Add to `GameResult` in `packages/simulator/src/types.ts`:

```typescript
export interface GameResult {
  // --- Existing fields (unchanged) ---
  winner: PlayerID | "draw";
  winReason: "lore_threshold" | "deck_exhausted" | "max_turns_exceeded";
  turns: number;
  finalLore: Record<PlayerID, number>;
  actionLog: GameLogEntry[];
  botLabels: Record<PlayerID, string>;
  botType: BotType;

  // --- Enriched per-card stats (replacing old CardGameStats) ---
  cardStats: Record<string, CardGameStats>;  // keyed by instanceId

  // --- NEW: Timeline snapshots ---
  // Available ink for each player at the START of each turn (before inking)
  inkByTurn: Record<PlayerID, number[]>;
  // Lore totals at the END of each turn
  loreByTurn: Record<PlayerID, number[]>;
}
```

### Changes to runGame.ts

The statsMap needs to capture the new fields.
Key changes to `updateStatsPreAction` and `updateStatsPostAction`:

```typescript
// In updateStatsPreAction:

// Track ownerId when first seen
function ensureStats(statsMap, instanceId, definitionId, ownerId) {
  if (!statsMap.has(instanceId)) {
    statsMap.set(instanceId, {
      instanceId,
      definitionId,
      ownerId,
      drawnOnTurn: null,
      playedOnTurn: null,
      inkedOnTurn: null,
      inPlayOnTurns: [],
      inkAvailableWhenPlayed: null,
      wasShifted: false,
      wasPlayed: false,
      wasBanished: false,
      loreContributed: 0,
      timesQuested: 0,
      timesChallenged: 0,
    })
  }
  return statsMap.get(instanceId)!
}

// Track when a card is played (PLAY_CARD action)
if (action.type === "PLAY_CARD") {
  const instance = state.cards[action.instanceId]
  if (instance) {
    const stats = ensureStats(statsMap, action.instanceId, instance.definitionId, instance.ownerId)
    stats.playedOnTurn = state.turnNumber
    stats.wasPlayed = true
    stats.inkAvailableWhenPlayed = state.players[instance.ownerId].availableInk
    stats.wasShifted = !!action.shiftTargetInstanceId
  }
}

// Track when a card is inked (PLAY_INK action)
if (action.type === "PLAY_INK") {
  const instance = state.cards[action.instanceId]
  if (instance) {
    const stats = ensureStats(statsMap, action.instanceId, instance.definitionId, instance.ownerId)
    stats.inkedOnTurn = state.turnNumber
  }
}

// Track inPlayOnTurns — for all cards in play at start of each turn
if (action.type === "PASS_TURN") {
  for (const pid of ["player1", "player2"] as const) {
    for (const instanceId of getZone(state, pid, "play")) {
      const inst = state.cards[instanceId]
      if (inst) {
        const stats = ensureStats(statsMap, instanceId, inst.definitionId, inst.ownerId)
        stats.inPlayOnTurns.push(state.turnNumber)
      }
    }
  }
}
```

**Track drawnOnTurn via card_drawn events:**

```typescript
// In updateStatsPostAction:
for (const event of events) {
  if (event.type === "card_drawn") {
    const instance = postState.cards[event.instanceId] ?? preState.cards[event.instanceId]
    if (instance) {
      const stats = ensureStats(statsMap, event.instanceId, instance.definitionId, instance.ownerId)
      if (stats.drawnOnTurn === null) {
        stats.drawnOnTurn = preState.turnNumber  // the turn this draw happened on
      }
    }
  }
  // ... existing banish/damage tracking ...
}
```

**Track inkByTurn and loreByTurn in the game loop:**

```typescript
// In runGame, after each PASS_TURN completes:
const inkByTurn: Record<PlayerID, number[]> = { player1: [], player2: [] }
const loreByTurn: Record<PlayerID, number[]> = { player1: [], player2: [] }

// After each successful applyAction, if the action was PASS_TURN:
if (action.type === "PASS_TURN") {
  for (const pid of ["player1", "player2"] as const) {
    inkByTurn[pid].push(state.players[pid].availableInk)
    loreByTurn[pid].push(state.players[pid].lore)
  }
}

// Include in returned GameResult:
return {
  // ... existing fields ...
  inkByTurn,
  loreByTurn,
}
```

### Update aggregator.ts

The aggregator currently uses `turnsInPlay > 0` to detect "drawn". Replace with
the proper `drawnOnTurn !== null` check. Also add `winRateWhenPlayed` and
`winRateWhenNotPlayed` to `CardPerformance`.

**Updated CardPerformance** in `packages/analytics/src/types.ts`:

```typescript
export interface CardPerformance {
  definitionId: string;

  // --- Draw/play rates ---
  drawRate: number;                  // % of games where card was drawn at all
  playRate: number;                  // % of games where card was played
  inkRate: number;                   // % of games where card was inked

  avgTurnDrawn: number;              // average turn first drawn (when drawn)
  avgTurnPlayed: number;             // average turn played (when played)

  // --- Win rate correlations (the four that matter) ---
  winRateWhenDrawn: number;          // win rate in games where card was drawn
  winRateWhenNotDrawn: number;       // win rate in games where card was never drawn
  winRateWhenPlayed: number;         // win rate in games where card was actually played
  winRateWhenNotPlayed: number;      // win rate in games where card was drawn but not played

  // --- Impact delta (derived, most useful for deck construction) ---
  impactDelta: number;               // winRateWhenDrawn - winRateWhenNotDrawn
  playImpactDelta: number;           // winRateWhenPlayed - winRateWhenNotPlayed

  // --- Diagnostics (secondary, kept for debugging) ---
  avgLoreContributed: number;
  banishRate: number;                // % of plays where card was eventually banished
}
```

The aggregator rewrite to use the new fields is straightforward —
replace the `turnsInPlay > 0` proxy with direct checks on the new boolean fields.

---

## Part B — GameCondition Query Language

### New file: `packages/analytics/src/query.ts`

```typescript
// packages/analytics/src/query.ts

import type { GameResult } from "@lorcana-sim/simulator";
import type { PlayerID } from "@lorcana-sim/engine";

// =============================================================================
// CONDITION TYPES
// Composable filter predicates over a single GameResult.
// Inspired by MongoDB query operators.
// =============================================================================

export type GameCondition =
  // --- Card conditions ---
  | { type: "card_drawn_by";    card: string; turn: number; player?: PlayerID }
  | { type: "card_played_by";   card: string; turn: number; player?: PlayerID }
  | { type: "card_in_play_on";  card: string; turn: number; player?: PlayerID }
  | { type: "card_inked_by";    card: string; turn: number; player?: PlayerID }
  | { type: "card_never_drawn"; card: string; player?: PlayerID }
  | { type: "card_never_played"; card: string; player?: PlayerID }

  // --- Resource conditions ---
  | { type: "ink_gte";          amount: number; on_turn: number; player?: PlayerID }
  | { type: "ink_lte";          amount: number; on_turn: number; player?: PlayerID }
  | { type: "lore_gte";         amount: number; by_turn: number; player?: PlayerID }
  | { type: "lore_lte";         amount: number; by_turn: number; player?: PlayerID }

  // --- Game outcome conditions ---
  | { type: "won";              player?: PlayerID }
  | { type: "lost";             player?: PlayerID }
  | { type: "game_ended_by";    turn: number }         // game finished in ≤ N turns
  | { type: "win_reason";       reason: GameResult["winReason"] }

  // --- Logical operators (MongoDB-style) ---
  | { type: "and"; conditions: GameCondition[] }
  | { type: "or";  conditions: GameCondition[] }
  | { type: "not"; condition: GameCondition }
```

### The matchesCondition function

```typescript
export function matchesCondition(
  result: GameResult,
  condition: GameCondition,
  defaultPlayer: PlayerID = "player1"
): boolean {
  const pid = ("player" in condition && condition.player) ? condition.player : defaultPlayer

  switch (condition.type) {

    case "card_drawn_by": {
      // P(at least one copy drawn by turn N)
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      )
      return copies.some(s => s.drawnOnTurn !== null && s.drawnOnTurn <= condition.turn)
    }

    case "card_played_by": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      )
      return copies.some(s => s.playedOnTurn !== null && s.playedOnTurn <= condition.turn)
    }

    case "card_in_play_on": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      )
      return copies.some(s => s.inPlayOnTurns.includes(condition.turn))
    }

    case "card_inked_by": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      )
      return copies.some(s => s.inkedOnTurn !== null && s.inkedOnTurn <= condition.turn)
    }

    case "card_never_drawn": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      )
      return copies.every(s => s.drawnOnTurn === null)
    }

    case "card_never_played": {
      const copies = Object.values(result.cardStats).filter(
        s => s.definitionId === condition.card && s.ownerId === pid
      )
      // "never played" = was drawn but not played (or never drawn)
      return copies.every(s => !s.wasPlayed)
    }

    case "ink_gte": {
      const inkArr = result.inkByTurn[pid]
      const inkAtTurn = inkArr?.[condition.on_turn - 1] ?? 0
      return inkAtTurn >= condition.amount
    }

    case "ink_lte": {
      const inkArr = result.inkByTurn[pid]
      const inkAtTurn = inkArr?.[condition.on_turn - 1] ?? 0
      return inkAtTurn <= condition.amount
    }

    case "lore_gte": {
      // P(lore >= N at the END of any turn up to by_turn)
      const loreArr = result.loreByTurn[pid]
      if (!loreArr) return false
      const turnsToCheck = loreArr.slice(0, condition.by_turn)
      return turnsToCheck.some(lore => lore >= condition.amount)
    }

    case "lore_lte": {
      const loreArr = result.loreByTurn[pid]
      const loreAtTurn = loreArr?.[condition.by_turn - 1] ?? 0
      return loreAtTurn <= condition.amount
    }

    case "won":
      return result.winner === pid

    case "lost":
      return result.winner !== pid && result.winner !== "draw"

    case "game_ended_by":
      return result.turns <= condition.turn

    case "win_reason":
      return result.winReason === condition.reason

    case "and":
      return condition.conditions.every(c => matchesCondition(result, c, defaultPlayer))

    case "or":
      return condition.conditions.some(c => matchesCondition(result, c, defaultPlayer))

    case "not":
      return !matchesCondition(result, condition.condition, defaultPlayer)
  }
}
```

### The queryResults function

```typescript
export interface QueryResult {
  // How often the condition was met
  matchCount: number;
  probability: number;           // matchCount / totalGames
  probabilityMargin: number;     // ±1/sqrt(n) — statistical margin

  // Win rates
  winRateWhenMet: number;        // win rate in games where condition was met
  winRateWhenNotMet: number;     // win rate in games where condition was NOT met
  delta: number;                 // winRateWhenMet - winRateWhenNotMet

  // Sample sizes (for confidence assessment)
  nMet: number;
  nNotMet: number;

  // How to read this result
  interpretation: string;        // auto-generated plain English summary
}

export function queryResults(
  results: GameResult[],
  condition: GameCondition,
  player: PlayerID = "player1"
): QueryResult {
  const n = results.length

  const matching    = results.filter(r => matchesCondition(r, condition, player))
  const notMatching = results.filter(r => !matchesCondition(r, condition, player))

  const nMet    = matching.length
  const nNotMet = notMatching.length

  const probability      = nMet / n
  const probabilityMargin = 1 / Math.sqrt(n)  // rough 68% CI

  const winsWhenMet    = matching.filter(r => r.winner === player).length
  const winsWhenNotMet = notMatching.filter(r => r.winner === player).length

  const winRateWhenMet    = nMet    > 0 ? winsWhenMet    / nMet    : 0
  const winRateWhenNotMet = nNotMet > 0 ? winsWhenNotMet / nNotMet : 0
  const delta = winRateWhenMet - winRateWhenNotMet

  const interpretation = generateInterpretation(probability, delta, nMet, n)

  return {
    matchCount: nMet,
    probability,
    probabilityMargin,
    winRateWhenMet,
    winRateWhenNotMet,
    delta,
    nMet,
    nNotMet,
    interpretation,
  }
}

function generateInterpretation(
  probability: number,
  delta: number,
  nMet: number,
  total: number
): string {
  const pct = (n: number) => (n * 100).toFixed(1) + "%"

  if (nMet < 20) {
    return `Too few matching games (${nMet}/${total}) for reliable conclusions. Run more iterations.`
  }

  const freq = probability < 0.1 ? "rarely happens" :
               probability < 0.3 ? "happens in some games" :
               probability < 0.6 ? "happens in many games" :
               "happens in most games"

  const impact = Math.abs(delta) < 0.05 ? "little impact on win rate" :
                 Math.abs(delta) < 0.15 ? "moderate impact on win rate" :
                 "strong impact on win rate"

  const direction = delta > 0 ? "improves" : "hurts"

  return `This scenario ${freq} (${pct(probability)}). When it happens, it ${direction} your win rate by ${pct(Math.abs(delta))} — ${impact}.`
}
```

### Export from analytics index

Add to `packages/analytics/src/index.ts`:

```typescript
export { matchesCondition, queryResults } from "./query.js"
export type { GameCondition, QueryResult } from "./query.js"
```

---

## Part C — CLI Interface

### Query file format

Users write a JSON file describing what to ask:

```json
{
  "deck": "./my-deck.txt",
  "opponent": "./goldfish-deck.txt",
  "bot": "greedy",
  "iterations": 5000,
  "queries": [
    {
      "name": "Aladdin on-curve sequence",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "card_played_by", "card": "aladdin-street-rat", "turn": 3 },
          { "type": "card_played_by", "card": "aladdin-heroic-outlaw", "turn": 5 },
          { "type": "ink_gte", "amount": 5, "on_turn": 5 }
        ]
      }
    },
    {
      "name": "Drew Moana by turn 5",
      "condition": {
        "type": "card_drawn_by",
        "card": "moana-of-motunui",
        "turn": 5
      }
    },
    {
      "name": "Won quickly (turn 10 or less)",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "won" },
          { "type": "game_ended_by", "turn": 10 }
        ]
      }
    }
  ]
}
```

### New command: `pnpm query --file ./questions.json`

New file: `packages/cli/src/commands/query.ts`

```typescript
export interface QueryArgs {
  file: string
}

export function runQuery(args: QueryArgs): void {
  const raw = fs.readFileSync(args.file, "utf-8")
  const config = JSON.parse(raw) as QueryFile

  const definitions = LORCAST_CARD_DEFINITIONS
  const deck = loadDeck(config.deck, definitions)
  const opponentDeck = config.opponent
    ? loadDeck(config.opponent, definitions)
    : deck  // mirror match if no opponent specified
  const bot = resolveBot(config.bot ?? "greedy")
  const iterations = config.iterations ?? 1000

  console.log(`\nRunning ${iterations} games to answer ${config.queries.length} question(s)...\n`)

  const results = runSimulation({
    player1Deck: deck,
    player2Deck: opponentDeck,
    player1Strategy: bot,
    player2Strategy: bot,
    definitions,
    iterations,
  })

  console.log("═".repeat(60))
  console.log("  QUERY RESULTS")
  console.log(`  ${iterations} games  |  bot: ${bot.name}`)
  console.log("═".repeat(60))

  for (const q of config.queries) {
    const result = queryResults(results, q.condition)
    printQueryResult(q.name, result)
  }
}

function printQueryResult(name: string, result: QueryResult): void {
  const pct = (n: number) => (n * 100).toFixed(1) + "%"
  const delta = result.delta
  const deltaStr = (delta >= 0 ? "+" : "") + pct(delta)
  const deltaColor = delta >= 0.1 ? "✓" : delta <= -0.1 ? "✗" : "~"

  console.log()
  console.log(`  ${name}`)
  console.log("  " + "─".repeat(56))
  console.log(`  Happens in:        ${pct(result.probability)} of games  (±${pct(result.probabilityMargin)})`)
  console.log(`  Win rate when met: ${pct(result.winRateWhenMet)}  (n=${result.nMet})`)
  console.log(`  Win rate when not: ${pct(result.winRateWhenNotMet)}  (n=${result.nNotMet})`)
  console.log(`  Impact:            ${deltaColor} ${deltaStr}`)
  console.log()
  console.log(`  ${result.interpretation}`)
  console.log()
}
```

Add to `packages/cli/src/main.ts`:

```typescript
case "query": {
  const usage = "Usage: pnpm query --file ./questions.json"
  runQuery({ file: requireArg(args, "file", usage) })
  break
}
```

---

## Example Output

```
════════════════════════════════════════════════════════════
  QUERY RESULTS
  5000 games  |  bot: greedy
════════════════════════════════════════════════════════════

  Aladdin on-curve sequence
  ────────────────────────────────────────────────────────
  Happens in:        23.4% of games  (±1.4%)
  Win rate when met: 78.2%  (n=1170)
  Win rate when not: 51.3%  (n=3830)
  Impact:            ✓ +26.9%

  This scenario happens in some games (23.4%). When it happens,
  it improves your win rate by 26.9% — strong impact on win rate.


  Drew Moana by turn 5
  ────────────────────────────────────────────────────────
  Happens in:        67.3% of games  (±1.4%)
  Win rate when met: 63.1%  (n=3365)
  Win rate when not: 47.2%  (n=1635)
  Impact:            ✓ +15.9%

  This scenario happens in many games (67.3%). When it happens,
  it improves your win rate by 15.9% — moderate impact on win rate.


  Won quickly (turn 10 or less)
  ────────────────────────────────────────────────────────
  Happens in:        31.2% of games  (±1.4%)
  Win rate when met: 100.0%  (n=1560)
  Win rate when not: 33.4%  (n=3440)
  Impact:            ✓ +66.6%

  This scenario happens in some games (31.2%). When it happens,
  it improves your win rate by 66.6% — strong impact on win rate.
```

---

## Files Changed Summary

```
MODIFIED:
  packages/simulator/src/types.ts
    - CardGameStats: replace all fields with new timeline-oriented schema
    - GameResult: add inkByTurn, loreByTurn fields

  packages/simulator/src/runGame.ts
    - ensureStats: add ownerId parameter
    - updateStatsPreAction: track PLAY_CARD (playedOnTurn, inkAvailable, wasShifted)
                                           PLAY_INK (inkedOnTurn)
                                           PASS_TURN (inPlayOnTurns)
    - updateStatsPostAction: track card_drawn events (drawnOnTurn)
    - game loop: track inkByTurn, loreByTurn per turn
    - return: include inkByTurn, loreByTurn in GameResult

  packages/analytics/src/types.ts
    - CardPerformance: add winRateWhenPlayed, winRateWhenNotPlayed,
                           playImpactDelta, impactDelta, drawRate,
                           playRate, inkRate, avgTurnDrawn
    - Remove: avgLoreContributed, banishRate, questRate (move to secondary)

  packages/analytics/src/aggregator.ts
    - Replace turnsInPlay > 0 proxy with drawnOnTurn !== null
    - Add winRateWhenPlayed, winRateWhenNotPlayed computation
    - Compute drawRate, playRate, inkRate directly from new fields

  packages/cli/src/main.ts
    - Add "query" case → runQuery

NEW:
  packages/analytics/src/query.ts
    - GameCondition type union (all condition variants)
    - matchesCondition(result, condition, player) → boolean
    - queryResults(results, condition, player) → QueryResult
    - generateInterpretation(...) → string

  packages/cli/src/commands/query.ts
    - runQuery(args) — reads JSON file, runs sim, prints results
    - printQueryResult(name, result) — formats output

UNTOUCHED:
  packages/engine/*     (no engine changes)
  packages/ui/*         (no UI changes yet — add query UI later)
  packages/simulator/src/bots/*   (no bot changes)
```

---

## Build Order

1. Update `CardGameStats` and `GameResult` types in `simulator/types.ts`
2. Update `runGame.ts` to populate the new fields
3. Run existing tests — should still pass (new fields are additive)
4. Run a test game with `--verbose` flag to verify the new fields are populated
5. Update `aggregator.ts` to use new fields
6. Update `CardPerformance` in `analytics/types.ts`
7. Write `analytics/query.ts` (matchesCondition + queryResults)
8. Write `cli/commands/query.ts`
9. Wire into `cli/main.ts`
10. Test with a real deck and real questions

---

## Part D — Result Storage

### Why Store Results

The whole point of the query system is iterating on questions against the
same simulation run. Without storage, every `pnpm query` reruns the
simulation from scratch. At 5000 games that's a few seconds — tolerable
but annoying when you want to ask 10 questions in a row.

With storage:
```bash
# Run once (takes a few seconds)
pnpm analyze --deck ./deck.txt --bot greedy --iterations 5000 --save ./results/my-deck.json

# Query many times instantly
pnpm query --results ./results/my-deck.json --file ./q1.json
pnpm query --results ./results/my-deck.json --file ./q2.json
pnpm query --results ./results/my-deck.json --file ./q3.json
```

### Storage Format

Local JSON files. No database, no server, no dependencies.

The action log is stripped before saving — it's only needed for `--verbose`
debugging and makes files 10x larger. Without it, 5000 games ≈ 5-10MB.

```typescript
// packages/simulator/src/types.ts — add to exports

/** GameResult with actionLog stripped — used for storage */
export type StoredGameResult = Omit<GameResult, "actionLog">

export interface StoredResultSet {
  metadata: {
    /** Decklist text for reference */
    deck: string
    /** Opponent decklist text (or "mirror" if same deck) */
    opponent: string
    /** Bot name used */
    bot: string
    /** Number of games */
    iterations: number
    /** ISO timestamp of when this was run */
    timestamp: string
    /** Package version for compatibility checking */
    engineVersion: string
  }
  results: StoredGameResult[]
}
```

### Serialization

`GameResult` contains `BotWeights` on the bot strategies, which include
functions (`urgency`, `threatLevel`) that can't be serialized to JSON.
The bot name is already stored in `botLabels` — that's sufficient.
The weights themselves don't need to be stored (they're a property of the
bot strategy, not the game outcome).

Everything else in `StoredGameResult` is plain data — arrays of numbers,
strings, booleans. Standard `JSON.stringify` works without any custom handling.

### New file: `packages/simulator/src/storage.ts`

```typescript
import * as fs from "fs"
import * as path from "path"
import type { GameResult, StoredGameResult, StoredResultSet } from "./types.js"

/** Strip action log and save results to a JSON file */
export function saveResults(
  results: GameResult[],
  filePath: string,
  metadata: StoredResultSet["metadata"]
): void {
  const stored: StoredResultSet = {
    metadata,
    results: results.map(stripActionLog),
  }

  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf-8")
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
  console.log(`  Saved ${results.length} games to ${filePath} (${sizeMB} MB)`)
}

/** Load results from a JSON file */
export function loadResults(filePath: string): StoredResultSet {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Results file not found: ${filePath}`)
  }
  const raw = fs.readFileSync(filePath, "utf-8")
  return JSON.parse(raw) as StoredResultSet
}

function stripActionLog(result: GameResult): StoredGameResult {
  const { actionLog: _, ...rest } = result
  return rest
}
```

### CLI Changes

**Add `--save` flag to `analyze` and `compare` commands:**

```typescript
// packages/cli/src/commands/analyze.ts
export interface AnalyzeArgs {
  deck: string
  bot: string
  iterations: number
  verbose: boolean
  save?: string    // NEW — file path to save results
}

export function runAnalyze(args: AnalyzeArgs): void {
  // ... existing simulation code ...

  if (args.save) {
    saveResults(results, args.save, {
      deck: fs.readFileSync(args.deck, "utf-8"),
      opponent: "mirror",
      bot: bot.name,
      iterations: args.iterations,
      timestamp: new Date().toISOString(),
      engineVersion: getPackageVersion(),
    })
  }

  // ... existing output code ...
}
```

**Update `query` command to accept either `--results` or inline sim:**

```typescript
// packages/cli/src/commands/query.ts
export interface QueryArgs {
  file: string        // the JSON questions file
  results?: string    // path to saved results file
  // If no --results, these are used to run a fresh simulation:
  deck?: string
  opponent?: string
  bot?: string
  iterations?: number
  save?: string       // optionally save the fresh run
}

export function runQuery(args: QueryArgs): void {
  let results: StoredGameResult[]
  let metadata: StoredResultSet["metadata"] | undefined

  if (args.results) {
    // Load from saved file — instant
    console.log(`  Loading results from ${args.results}...`)
    const stored = loadResults(args.results)
    results = stored.results
    metadata = stored.metadata
    console.log(`  Loaded ${results.length} games (${metadata.bot}, ${metadata.timestamp.split("T")[0]})`)
  } else {
    // Run fresh simulation
    if (!args.deck) throw new Error("--deck required when --results not provided")
    // ... run simulation, optionally save ...
  }

  // ... rest of query logic unchanged ...
}
```

**Add `--save` flag to main.ts arg parsing:**

```typescript
// packages/cli/src/main.ts

case "analyze": {
  const usage = "Usage: pnpm analyze --deck ./deck.txt --bot greedy --iterations 1000 [--save ./results/out.json]"
  runAnalyze({
    deck: requireArg(args, "deck", usage),
    bot: args["bot"] ?? "greedy",
    iterations: optionalInt(args, "iterations", 1000),
    verbose: args["verbose"] === "true",
    save: args["save"],          // NEW
  })
  break
}

case "query": {
  const usage = "Usage: pnpm query --file ./q.json [--results ./saved.json] [--deck ./deck.txt --bot greedy --iterations 1000]"
  runQuery({
    file: requireArg(args, "file", usage),
    results: args["results"],    // load from file
    deck: args["deck"],          // or run fresh
    bot: args["bot"],
    iterations: args["iterations"] ? parseInt(args["iterations"]!) : undefined,
    save: args["save"],
  })
  break
}
```

### Storage Decision Summary

| Now | Later |
|-----|-------|
| Local JSON files | SQLite for longitudinal data |
| Strip action log | Keep action log in separate file if needed |
| One file per run | Accumulate runs over time |
| No dependencies | Still no server needed for SQLite |

The JSON format is a natural migration to SQLite — each `StoredGameResult`
becomes a row, `cardStats` entries become rows in a related table.
When you want "how has Moana's win rate delta changed across my last 20
tuning sessions," that's when SQLite earns its place.

**Don't build SQLite now.** The JSON approach is sufficient and avoids
schema design work before you know what questions you actually want to ask.

### Updated Files Changed Summary

```
NEW (additions to previous list):
  packages/simulator/src/storage.ts
    - saveResults(results, filePath, metadata) → void
    - loadResults(filePath) → StoredResultSet
    - stripActionLog(result) → StoredGameResult

  packages/simulator/src/types.ts (additions)
    - StoredGameResult = Omit<GameResult, "actionLog">
    - StoredResultSet interface

  packages/cli/src/commands/analyze.ts
    - Add save?: string to AnalyzeArgs
    - Call saveResults() if --save provided

  packages/cli/src/commands/compare.ts
    - Add save?: string to CompareArgs
    - Call saveResults() if --save provided

  packages/cli/src/commands/query.ts
    - Add results?: string to QueryArgs
    - Load from file if --results provided, else run fresh sim
    - Add save?: string to optionally save fresh sim

  packages/cli/src/main.ts
    - Wire --save flag through to analyze and compare
    - Wire --results flag through to query
```

### Updated Build Order

Insert after step 9 (wire into main.ts):

```
9.  Wire "query" into cli/main.ts
10. Write simulator/storage.ts (saveResults, loadResults, stripActionLog)
11. Add StoredGameResult and StoredResultSet to simulator/types.ts
12. Add --save flag to analyze command
13. Add --results flag to query command (load path)
14. Wire --save and --results through main.ts arg parsing
15. Test: pnpm analyze --deck ./sample-deck.txt --iterations 100 --save /tmp/test.json
16. Test: pnpm query --results /tmp/test.json --file ./test-questions.json
```

---

## What Stays Out of This Spec

- UI for query building (later — condition builder in the game board tab)
- Hypergeometric fast-path for single card_drawn_by conditions (optimization, defer)
- Opponent condition queries (e.g. "when opponent played X") — possible with the
  data model since ownerId is tracked, but not in scope for first version
- Chained/sequential conditions beyond what AND covers (e.g. "played A then B
  in that order") — the data model supports it but the condition type doesn't
  yet. Can add later.
- SQLite storage — defer until you know what longitudinal questions you want to ask
- Compression of JSON files — 5-10MB is fine for now, revisit if files grow large