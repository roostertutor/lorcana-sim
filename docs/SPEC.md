# SPEC.md
# Lorcana Headless Analytics Engine — Full Specification
# Hand this to Claude Code as the starting point for a clean rebuild.

---

## Direction

This is NOT a human-playable tabletop simulator.
This IS a headless game engine + analytics platform.

Primary use case: simulate thousands of Lorcana games programmatically
to produce meaningful deck analytics, win rates, consistency metrics,
and card evaluation data.

A thin UI sits on top to make results accessible. The UI is secondary.
The engine and simulator are the product.

---

## What to Keep From the Old Code

### Keep verbatim (copy these files unchanged):
- `packages/engine/src/types/index.ts` — all game types are correct
- `packages/engine/src/cards/sampleCards.ts` — card definitions are correct
- `packages/engine/src/engine/validator.ts` — rules validation is correct
- `packages/engine/src/engine/initializer.ts` — game creation + decklist parser is correct

### Keep the patterns, rewrite the implementation:
- `packages/engine/src/utils/index.ts`
    - Keep: `getInstance`, `getZone`, `getZoneInstances`, `hasKeyword`,
      `getKeywordValue`, `getEffectiveStrength`, `getEffectiveWillpower`,
      `getEffectiveLore`, `canAfford`, `isMainPhase`, `getOpponent`,
      `matchesFilter`, `findMatchingInstances`, `generateId`, `appendLog`
    - Rewrite: `moveCard` — the same-player zone clobber bug existed here,
      rewrite it cleanly with the fix (use single merged object when
      sourcePlayerId === targetPlayerId)
    - Rewrite: `updateInstance` — fine as-is but rewrite for clarity
- `packages/engine/src/engine/reducer.ts`
    - Keep: the applyAction signature and overall structure
    - Rewrite: `processTriggerStack` — fix the fizzle logic so banishment
      triggers (`is_banished`, `leaves_play`) fire even after card leaves play
    - Rewrite: clean up the overloaded `queueTriggersByEvent` signature
- Test patterns from `reducer.test.ts`
    - Keep: `injectCard()` helper pattern — inject cards directly into zones,
      never rely on random opening hand
    - Keep: `giveInk()`, `setLore()`, `passTurns()` helpers
    - Rewrite: all tests, expanding coverage

### Discard entirely:
- `packages/ui/` — the entire React UI package. Rebuild later and simpler.
- `packages/ui/src/store/gameStore.ts` — Zustand store, not needed yet
- `packages/ui/src/App.tsx` — game board UI, not needed yet
- The `setup.sh` human-game-focused flow

---

## Package Structure

```
lorcana-sim/
├── packages/
│   ├── engine/          ← Pure rules engine. No UI deps. Unchanged API.
│   ├── simulator/       ← Headless game runner + bot strategies
│   ├── analytics/       ← Stats aggregation + deck analysis
│   └── ui/              ← Thin UI (charts + deck input). Build last.
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json
├── DECISIONS.md
├── SPEC.md
└── .gitignore
```

---

## Package 1: `@lorcana-sim/engine`

### Responsibility
Pure game rules. No simulation, no bots, no UI. Just: given a state and
an action, is it legal, and what is the new state?

### Public API (what it exports)
```typescript
// Core game loop
applyAction(state, action, definitions) → ActionResult
createGame(config, definitions) → GameState
parseDecklist(text, definitions) → { entries, errors }

// Action generation (NEW — needed by simulator)
getAllLegalActions(state, playerId, definitions) → GameAction[]

// Types
GameState, GameAction, ActionResult, CardDefinition, CardInstance,
PlayerID, ZoneName, DeckEntry, PendingChoice, GameEvent, GameLogEntry

// Card data
SAMPLE_CARDS, SAMPLE_CARD_DEFINITIONS

// Utilities
getInstance, getZone, getZoneInstances, hasKeyword, getKeywordValue,
getEffectiveStrength, getEffectiveWillpower, getEffectiveLore,
getOpponent, canAfford, generateId
```

### `getAllLegalActions` — new, critical function
This is what makes headless simulation possible. Generates every currently
legal action for a player without human input.

```typescript
function getAllLegalActions(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): GameAction[] {
  // If pending choice, only RESOLVE_CHOICE actions are legal
  if (state.pendingChoice) {
    return generateChoiceResolutions(state.pendingChoice, playerId)
  }

  const actions: GameAction[] = []

  // PASS_TURN always legal on your turn
  // PLAY_INK for each inkable card in hand (if haven't inked this turn)
  // PLAY_CARD for each affordable card in hand
  // QUEST for each unexerted, ready character with lore > 0
  // CHALLENGE for each valid attacker/defender pair
  // ACTIVATE_ABILITY for each usable activated ability

  return actions
}
```

Uses `validateAction` internally to check legality — no duplicate logic.

### Key bug fixes from v1 to carry forward
1. `moveCard` same-player clobber — merge zone changes into single object
   when sourcePlayerId === targetPlayerId
2. Trigger fizzle — `is_banished` and `leaves_play` triggers must fire
   even after card has left play zone. Only fizzle if card doesn't exist.
3. Pending choice resolution — when no valid targets exist, auto-resolve
   with empty choice rather than hanging

---

## Package 2: `@lorcana-sim/simulator`

### Responsibility
Run games headlessly. Implement bot strategies. Produce raw game results.
No stats aggregation here — just run games and return what happened.

### Public API
```typescript
// Run a single game to completion
runGame(config: GameConfig) → GameResult

// Run many games, return raw results
runSimulation(config: SimConfig) → SimResult[]

// Bot strategies (pluggable)
RandomBot: BotStrategy       // picks random legal action
GreedyBot: BotStrategy       // heuristic: ink → play → quest → challenge
```

### Types
```typescript
interface GameConfig {
  player1Deck: DeckEntry[]
  player2Deck: DeckEntry[]
  player1Strategy: BotStrategy
  player2Strategy: BotStrategy
  definitions: Record<string, CardDefinition>
  maxTurns?: number          // safety limit, default 50
}

interface GameResult {
  winner: PlayerID | "draw"  // draw if maxTurns exceeded
  turns: number
  finalLore: Record<PlayerID, number>
  actionLog: GameLogEntry[]
  // Per-card stats for this game
  cardStats: Record<string, CardGameStats>
}

interface CardGameStats {
  instanceId: string
  definitionId: string
  turnsInPlay: number
  timesQuested: number
  timesChallenged: number
  damageDealt: number
  loreContributed: number
  wasBanished: boolean
}

interface SimConfig {
  games: number              // how many games to run
  gameConfig: Omit<GameConfig, 'definitions'>
  definitions: Record<string, CardDefinition>
  seed?: number              // for reproducibility
}

interface BotStrategy {
  name: string
  decideAction: (state: GameState, playerId: PlayerID, definitions: Record<string, CardDefinition>) => GameAction
}
```

### Bot Strategies

**RandomBot** — picks a random legal action every time.
Useful as a baseline and for stress-testing the engine.
```typescript
const RandomBot: BotStrategy = {
  name: "random",
  decideAction: (state, playerId, definitions) => {
    const legal = getAllLegalActions(state, playerId, definitions)
    return legal[Math.floor(Math.random() * legal.length)]
  }
}
```

**GreedyBot** — follows simple priority order every turn:
1. Resolve pending choice (pick first valid target)
2. Play ink (pick least valuable card — lowest cost, already have 4x)
3. Play highest-cost affordable card from hand
4. Challenge if attacker STR > defender WP (favorable trade)
5. Quest with all available characters
6. Pass turn

This approximates a reasonable human pilot well enough for directional
analytics. Not optimal, but consistent and predictable.

### Pending Choice Auto-Resolution
Bots must handle `pendingChoice` before any other action:
```typescript
if (state.pendingChoice) {
  const targets = state.pendingChoice.validTargets ?? []
  // Greedy: pick the target with most damage (kill it faster)
  // Random: pick any valid target
  // If no targets: resolve with empty
  return {
    type: "RESOLVE_CHOICE",
    playerId,
    choice: targets.length > 0 ? [bestTarget(targets)] : []
  }
}
```

### Safety Limits
- `maxTurns` default 50 — prevents infinite loops from buggy cards
- If `maxTurns` exceeded, result is `winner: "draw"` — flag these for
  investigation, they indicate engine bugs or degenerate card interactions

---

## Package 3: `@lorcana-sim/analytics`

### Responsibility
Take raw `GameResult[]` from the simulator and produce meaningful
insights. Pure data transformation — no game logic, no UI.

### Public API
```typescript
// Aggregate many game results into stats
aggregateResults(results: GameResult[]) → DeckStats

// Analyze a single decklist (no simulation needed)
analyzeDeckComposition(deck: DeckEntry[], definitions) → DeckComposition

// Compare two decks head to head
compareDecks(results: GameResult[]) → MatchupStats

// Opening hand analysis (Monte Carlo, no full game needed)
analyzeOpeningHands(deck: DeckEntry[], definitions, iterations: number) → HandStats
```

### Key Stats to Produce

**DeckStats** — from simulated games:
```typescript
interface DeckStats {
  gamesPlayed: number
  winRate: number                    // 0-1
  avgGameLength: number              // turns
  avgWinTurn: number
  firstPlayerWinRate: number         // going first advantage
  
  // Per card
  cardPerformance: Record<string, CardPerformance>
}

interface CardPerformance {
  definitionId: string
  avgCopiesDrawnPerGame: number
  avgTurnsToPlay: number             // how early it hits board
  avgLoreContributed: number         // lore generated when in play
  banishRate: number                 // how often it dies
  questRate: number                  // how often it quests vs sits
  winRateWhenDrawn: number           // team win rate when this card drawn
  winRateWhenNotDrawn: number        // delta = card's impact
}
```

**DeckComposition** — pure math, no simulation:
```typescript
interface DeckComposition {
  totalCards: number
  inkableCount: number
  inkablePercent: number
  
  costCurve: Record<number, number>  // cost → count
  avgCost: number
  
  colorBreakdown: Record<InkColor, number>
  
  cardTypeBreakdown: Record<CardType, number>
  
  keywordCounts: Record<Keyword, number>
  
  // Probability of having N ink on turn N
  // (hypergeometric, no simulation needed)
  inkCurveProb: {
    turn1: number    // P(at least 1 ink by turn 1)
    turn2: number    // P(at least 2 ink by turn 2)
    turn3: number    // P(at least 3 ink by turn 3)
    turn4: number    // P(at least 4 ink by turn 4)
  }
}
```

**HandStats** — from Monte Carlo opening hand simulation:
```typescript
interface HandStats {
  iterations: number
  avgInkableInOpener: number
  pctHandsWithTwoInkable: number     // keepable threshold
  pctHandsWithZeroInkable: number    // unkeepable
  avgCostInOpener: number
  
  // Per card: how often it's in opening hand
  cardInOpenerRate: Record<string, number>
}
```

---

## Package 4: `@lorcana-sim/ui` (Build Last)

### Responsibility
Make analytics results visible and usable. Thin layer over analytics package.

### What it needs (not building yet, just planning):
- Deck input (paste decklist, same format as before)
- Composition view (curve chart, ink breakdown, keyword summary)
- Simulation runner (choose iterations, choose bot strategy, run)
- Results view (win rate, game length distribution, card performance table)
- Comparison view (two decks head to head)

### Stack when we get here:
- React + Vite (same as before)
- Recharts or Victory for charts (lightweight, React-native)
- Tailwind for styling
- No Zustand needed — analytics results are read-only, plain React state is fine

---

## Testing Strategy

### Layer 1 — Unit tests (engine package)
Every card mechanic has isolated tests.
Use `injectCard()` pattern — never rely on random opening hand.
Current 43 tests are a good start, expand per card added.

### Layer 2 — Integration scenarios (engine package)
Multi-card interaction tests:
- Two triggers fire same turn
- Bodyguard + Evasive on same board
- Shift inherits damage correctly
- Ward prevents targeting across all effect types

### Layer 3 — Game invariants (simulator package)
Run 1000 random games with RandomBot.
After every action assert:
- card count per player never changes (60 cards always accounted for)
- lore never goes below 0
- inkwell cards never leave inkwell
- banished cards go to discard, never back to play
- availableInk never exceeds inkwell size
- game ends exactly at 20 lore

### Layer 4 — Known replays (engine package)
Encode 3-5 real human-played games as action sequences.
Assert engine agrees with real game at every step.
These are the highest-confidence tests.

### Layer 5 — Simulation sanity checks (analytics package)
Run 1000 games, assert:
- Win rates are between 40-60% for mirror matches (same deck vs same deck)
- Average game length is reasonable (6-15 turns)
- Going first win rate is between 50-65% (known first-player advantage)
- RandomBot never produces a win rate above 80% (indicates engine bug)

---

## Card Implementation Priority

Implement cards in this order — each group adds a new mechanic:

### Group 1 — Core mechanics (already have these)
Vanilla, Evasive, Rush, Bodyguard, Ward, Challenger, Support,
triggered (enters play, quests, banished), activated ability, item, action, song

### Group 2 — Next mechanics to add
- Shift (partially implemented, needs full testing)
- Singer + Songs (the interaction between them)
- Resist
- Reckless
- Location cards (new zone type needed)

### Group 3 — Full set data
Pull from community dataset: https://github.com/lorcanito/lorcana-data
Map their schema to our CardDefinition type.
Write a one-time migration script, don't hand-enter cards.

---

## CLI Entry Point (Build Early)

Before the UI, build a CLI so you can run analytics from the terminal:

```bash
# Analyze a deck
pnpm analyze --deck ./my-deck.txt --iterations 1000

# Compare two decks
pnpm compare --deck1 ./aggro.txt --deck2 ./control.txt --iterations 5000

# Output
Win rate:        54.2% (p1) / 45.8% (p2)
Avg game length: 11.3 turns
Going first WR:  61.4%
Top performer:   Moana - Chosen by the Ocean (contributed 3.2 lore/game)
Weakest card:    Fire the Cannons! (played in only 23% of games)
```

This validates the analytics pipeline before spending time on UI.

---

## Build Order for Claude Code

1. Rebuild `engine` package — keep types/cards/validator/initializer,
   rewrite utils (fix moveCard) and reducer (fix trigger fizzle),
   ADD getAllLegalActions as new export

2. Full test suite for engine — all 43 existing tests + new ones for
   getAllLegalActions

3. Build `simulator` package — RandomBot first, then GreedyBot,
   then runGame, then runSimulation

4. Invariant tests for simulator — run 1000 games, check all invariants hold

5. Build `analytics` package — DeckComposition (pure math first, no sim),
   then aggregate SimResults into DeckStats

6. CLI entry point — wire analytics to a simple terminal output

7. UI last — charts and deck input once everything above is solid

---

## What NOT to Build (Explicitly Out of Scope)

- Human-playable game board UI (not the goal)
- Multiplayer / networking (not needed for analytics)
- Auth / user accounts (not needed for analytics)
- Deck builder UI (paste decklist is fine)
- Card images (not needed for analytics)
- Mobile support (desktop/CLI first)
- Real-time game (batch simulation is the model)

---

## Prompt for Claude Code

Paste this at the start of each Claude Code session:

```
This is a Lorcana TCG headless analytics engine.
NOT a human-playable simulator — a headless game runner for deck analysis.

Read SPEC.md for the full specification.
Read DECISIONS.md for strategic context.
Read README.md for technical setup.

The goal is: simulate thousands of Lorcana games programmatically
to produce win rates, consistency metrics, and card performance data.

Current status: [update this each session]
- engine package: [done / in progress / not started]
- simulator package: [done / in progress / not started]  
- analytics package: [done / in progress / not started]
- ui package: [done / in progress / not started]
```