# SPEC.md
# Full specification: what to build and how.
# Read this when starting a new package or major feature.
# For standing instructions Claude Code needs every session, see CLAUDE.md.
# For why decisions were made, see DECISIONS.md.

---

## Direction

NOT a human-playable tabletop simulator.
IS a headless game engine + analytics platform.

Simulate thousands of Lorcana games programmatically to produce
deck analytics, win rates, consistency metrics, and card evaluation.

---

## What to Keep From the Old Code

### Keep verbatim:
- `packages/engine/src/types/index.ts`
- `packages/engine/src/cards/sampleCards.ts`
- `packages/engine/src/engine/validator.ts`
- `packages/engine/src/engine/initializer.ts`

### Rewrite with fixes:
- `packages/engine/src/utils/index.ts` — moveCard same-player fix
- `packages/engine/src/engine/reducer.ts` — trigger fizzle fix,
  modular win conditions, clean up queueTriggersByEvent

### Discard entirely:
- `packages/ui/` — rebuild later from scratch
- `setup.sh` human-game flow

---

## Package 1: `@lorcana-sim/engine`

### Public API
```typescript
applyAction(state, action, definitions) → ActionResult
createGame(config, definitions) → GameState
parseDecklist(text, definitions) → { entries, errors }
getAllLegalActions(state, playerId, definitions) → GameAction[]
checkWinConditions(state, definitions) → WinResult
getLoreThreshold(state, definitions) → number
```

### getAllLegalActions
Generates every currently legal action without human input.
Uses validateAction internally — no duplicate logic.
Covers: PASS_TURN, PLAY_INK, PLAY_CARD, QUEST, CHALLENGE,
ACTIVATE_ABILITY, RESOLVE_CHOICE (when pendingChoice set)

### Win Conditions

```typescript
interface WinResult {
  isOver: boolean
  winner: PlayerID | "draw" | null
  reason: "lore_threshold" | "deck_exhausted" | "card_effect" | "max_turns_exceeded"
}
```

`getLoreThreshold()` scans in-play cards for static effects that modify
the threshold. Default 20. Donald Duck - Musketeer changes it.
Deck exhaustion triggers at end of a player's turn when they cannot draw.
`max_turns_exceeded` is for simulation safety only, not a real game rule.

### Card Complexity Ladder

**Phase 1 — Vanilla:** Stats only, no abilities.

**Phase 2 — French vanilla:** Single keywords.
Rush, Evasive, Bodyguard, Ward, Challenger, Support, Reckless, Resist,
Singer, Shift. One handler per keyword.

**Phase 3 — Simple named abilities:**
Triggered + activated using existing effect types.
Fits { trigger, effects[] } data model cleanly.

**Phase 4 — Actions and Items:**
Actions resolve immediately then go to discard.
Items stay in play, no character stats.
Both need special handling in applyPlayCard.

**Phase 5 — Complex named abilities:**
Requires new effect types added to engine as encountered:
- countByName: "gains +1 for each copy of X in discard"
- globalKeywordGrant: "all your characters gain Evasive this turn"
- X costs: "deal X damage where X = characters in play"
- Conditional effects: "if you have more lore than opponent..."

**Phase 6 — Rule-modifying cards:**
getLoreThreshold() and checkWinConditions() scan in-play cards.
Genuinely weird cards get custom handlers as absolute last resort.

Realistic distribution per set:
~60% vanilla/french vanilla — zero new code
~30% simple named — existing effect types
~8% complex — new effect types needed
~2% custom handlers

---

## Package 2: `@lorcana-sim/simulator`

### Public API
```typescript
runGame(config: GameConfig) → GameResult
runSimulation(config: SimConfig) → SimResult[]

RandomBot: BotStrategy
GreedyBot: BotStrategy
ProbabilityBot(weights: BotWeights): BotStrategy
createPersonalBot(config: PersonalBotConfig): BotStrategy

AggroWeights: BotWeights
ControlWeights: BotWeights
MidrangeWeights: BotWeights
RushWeights: BotWeights

findOptimalWeights(config: OptimizationConfig): BotWeights
sweepWeightSpace(config: SweepConfig): WeightSweepResult[]
```

### Core Types

```typescript
interface GameConfig {
  player1Deck: DeckEntry[]
  player2Deck: DeckEntry[]
  player1Strategy: BotStrategy
  player2Strategy: BotStrategy
  definitions: Record<string, CardDefinition>
  maxTurns?: number          // default 50
}

interface GameResult {
  winner: PlayerID | "draw"
  winReason: string
  turns: number
  finalLore: Record<PlayerID, number>
  actionLog: GameLogEntry[]
  cardStats: Record<string, CardGameStats>
  botLabels: Record<PlayerID, string>
  botType: BotType
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
```

### DeckProbabilities Module

```typescript
interface DeckProbabilities {
  probabilityOfDrawing(definitionId: string, drawsRemaining: number): number
  probabilityOfInkInNextN(n: number): number
  avgCostRemaining(): number
  opponentThreatProbability(keyword: Keyword): number
}

function computeDeckProbabilities(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): DeckProbabilities
```

The bot knows exactly what's left in its deck (cards played/inked/discarded
are tracked in GameState). Uses hypergeometric formula throughout.

### PositionEvaluator Module

```typescript
interface PositionFactors {
  loreAdvantage: number      // lore delta normalized
  boardAdvantage: number     // character count + stats delta
  handAdvantage: number      // card count delta
  inkAdvantage: number       // available ink delta
  deckQuality: number        // expected value of remaining draws
  threatLevel: number        // opponent P(winning in next N turns)
  urgency: number            // how close either player is to winning
}

function evaluatePosition(
  state: GameState,
  playerId: PlayerID,
  probabilities: DeckProbabilities,
  weights: BotWeights
): { score: number; factors: PositionFactors }
```

### BotWeights

```typescript
interface BotWeights {
  // Static: constant during game (personality traits)
  loreAdvantage: number
  boardAdvantage: number
  handAdvantage: number
  inkAdvantage: number
  deckQuality: number

  // Dynamic: respond to game state
  urgency: (state: GameState) => number
  threatLevel: (state: GameState) => number
}

// score = Σ(staticFactor × staticWeight) + Σ(dynamicFactor × dynamicWeight(state))
```

Example dynamic weight — urgency ramps as game nears end:
```typescript
urgency: (state) => {
  const maxLore = Math.max(state.players.player1.lore, state.players.player2.lore)
  return Math.pow(maxLore / 20, 2)
}
```

Named presets are BotWeights configurations, not separate classes:
```typescript
const AggroWeights: BotWeights = {
  loreAdvantage: 0.9, boardAdvantage: 0.5, handAdvantage: 0.1,
  inkAdvantage: 0.3, deckQuality: 0.1,
  urgency: (_) => 0.8,
  threatLevel: (_) => 0.3,
}

const ControlWeights: BotWeights = {
  loreAdvantage: 0.3, boardAdvantage: 0.9, handAdvantage: 0.8,
  inkAdvantage: 0.6, deckQuality: 0.7,
  urgency: (state) => {
    const maxLore = Math.max(state.players.player1.lore, state.players.player2.lore)
    return Math.pow(maxLore / 20, 2)
  },
  threatLevel: (_) => 0.9,
}
```

### ProbabilityBot

```typescript
ProbabilityBot(weights: BotWeights): BotStrategy = {
  name: `probability-${weightFingerprint(weights)}`,
  type: "algorithm",
  decideAction: (state, playerId, definitions) => {
    if (state.pendingChoice) return resolveChoice(state, playerId, weights)
    const probs = computeDeckProbabilities(state, playerId, definitions)
    const legal = getAllLegalActions(state, playerId, definitions)
    return legal.reduce((best, action) => {
      const { newState } = applyAction(state, action, definitions)
      const { score } = evaluatePosition(newState, playerId, probs, weights)
      return score > best.score ? { action, score } : best
    }, { action: legal[0]!, score: -Infinity }).action
  }
}
```

### PersonalBot

```typescript
interface OverrideRule {
  description: string
  condition: (state: GameState, playerId: PlayerID) => boolean
  action: (state: GameState, playerId: PlayerID, definitions: Record<string, CardDefinition>) => GameAction
}

interface PersonalBotConfig {
  name: string
  weights: BotWeights
  overrides?: OverrideRule[]
}

function createPersonalBot(config: PersonalBotConfig): BotStrategy
// Checks overrides first, falls back to ProbabilityBot(config.weights)
// type is always "personal"
```

**Calibration workflow:**
1. Record actual decisions in a real game (Lorcanito etc)
2. Replay those positions through PersonalBot
3. Measure agreement rate overall and by game phase
4. Tune weights until agreement improves
5. Run PersonalBot vs OptimalBot — gap is a coaching map

### Weight Optimization

```typescript
interface OptimizationConfig {
  deck: DeckEntry[]
  opponentDeck: DeckEntry[]
  opponent: BotStrategy
  gamesPerEval: number
  iterations: number
  searchStrategy: "grid" | "random" | "genetic"
}

function findOptimalWeights(config: OptimizationConfig): BotWeights
function sweepWeightSpace(config: SweepConfig): WeightSweepResult[]
```

Grid/random search over weight space using simulation infrastructure.
No ML. Finds strong strategies for specific matchups.
Compatible with future ML: neural net = same interface, gradient descent
instead of grid search.

---

## Crowdsourcing (Future — UI Phase)

Human decision data is valuable but strictly separated from algorithm bots.

```typescript
type BotType = "algorithm" | "personal" | "crowd"
// aggregateResults() throws if called with mixed BotType in results
```

**Safe uses:**
- Benchmark algorithm bots against crowd decisions
- Build labeled dataset: game state + crowd vote + known outcome
- Segment by skill level (expert vs average vs beginner)
- "Puzzle of the day": show state, community votes, reveal next day with analysis

**Never:**
- Mix crowd results with algorithm bot results in same analysis
- Use crowd data to tune algorithm bots directly

---

## Package 3: `@lorcana-sim/analytics`

### Public API
```typescript
aggregateResults(results: GameResult[]) → DeckStats
analyzeDeckComposition(deck, definitions) → DeckComposition
compareDecks(results: GameResult[]) → MatchupStats
analyzeOpeningHands(deck, definitions, iterations) → HandStats
calibratePersonalBot(decisions: RecordedDecision[], bot: BotStrategy) → CalibrationReport
analyzeWeightSensitivity(sweepResults: WeightSweepResult[]) → SensitivityReport
```

### Key Output Types

```typescript
interface DeckStats {
  gamesPlayed: number
  winRate: number
  avgGameLength: number
  avgWinTurn: number
  firstPlayerWinRate: number
  drawRate: number                // flag if > 2%, indicates engine bug
  botLabel: string                // always present, always shown in UI
  botType: BotType
  cardPerformance: Record<string, CardPerformance>
}

interface CardPerformance {
  definitionId: string
  avgCopiesDrawnPerGame: number
  avgTurnsToPlay: number
  avgLoreContributed: number
  banishRate: number
  questRate: number
  winRateWhenDrawn: number
  winRateWhenNotDrawn: number
  // delta = card's marginal win rate contribution
}

interface DeckComposition {
  totalCards: number
  inkableCount: number
  inkablePercent: number
  costCurve: Record<number, number>
  avgCost: number
  colorBreakdown: Record<InkColor, number>
  cardTypeBreakdown: Record<CardType, number>
  keywordCounts: Record<Keyword, number>
  inkCurveProb: {               // hypergeometric math, no sim needed
    turn1: number
    turn2: number
    turn3: number
    turn4: number
  }
}

interface CalibrationReport {
  agreementRate: number
  divergenceByPhase: { early: number; mid: number; late: number }
  suggestedWeightAdjustments: Partial<BotWeights>
}

interface SensitivityReport {
  weightImportance: Record<keyof BotWeights, number>
  stableRanges: Record<keyof BotWeights, [number, number]>
}
```

### Analytics Questions This Answers

- "67% win rate vs AggroWeights, 43% vs ControlWeights — weak to slow gameplans"
- "+8% card contribution vs Control, +1% vs Aggro — cut from aggro builds"
- "71% win rate with AggroWeights, 51% with Control — play this deck aggressively"
- "RyanBot vs OptimalBot gap: 12.4%. deckQuality weight too low: -6.2%"
- "Win rate stable for loreAdvantage 0.5-0.9, drops below 0.4 — commit to racing"

---

## Package 4: `@lorcana-sim/ui` (Build Last)

Charts over analytics. Not a game board.
Stack: React + Vite + Recharts + Tailwind. No Zustand needed.

Screens:
- Deck input (paste decklist)
- Composition view (curve, ink breakdown, keyword counts)
- Simulation runner (iterations, bot preset or custom weights)
- Results view (win rate, card performance, bot label always visible)
- Comparison view (two decks, multiple bot styles side by side)
- Weight explorer (tune weights, see results update)
- PersonalBot calibration (record decisions, measure agreement, tune)
- Puzzle of the day (crowd vote, next day reveal) — last

---

## Testing Strategy

### Layer 1 — Unit tests (engine)
Every mechanic isolated. injectCard() always. Grow per card added.

### Layer 2 — Integration scenarios (engine)
Multi-card interactions. Every non-obvious interaction gets a test.
Examples: two triggers same turn, Ward blocking activated abilities,
Shift damage inheritance, Singer + Song interaction.

### Layer 3 — True engine invariants (simulator)
Run 1000 RandomBot games. Assert after every action.
See CLAUDE.md for the exact invariant list.

### Layer 4 — Known replays (engine)
3-5 real human-played games encoded as action sequences.
Engine must agree at every step.

### Simulation sanity checks (analytics)
Mirror match win rate ~50%, going first win rate 50-65%,
average game length 6-15 turns, draw rate near 0%.

---

## Card Data

Current: 20 sample cards. Sufficient for engine dev only.
Path to real data: https://github.com/lorcanito/lorcana-data
Write a migration script. Do not hand-enter full sets.

---

## CLI Entry Point (Build Before UI)

```bash
pnpm analyze --deck ./deck.txt --bot greedy --iterations 1000
pnpm analyze --deck ./deck.txt --bot aggro --iterations 1000
pnpm analyze --deck ./deck.txt --bot ryan --iterations 1000
pnpm compare --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000
pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500
pnpm sweep --deck ./deck.txt --opponent control --iterations 200
```

---

## Build Order

1. engine — rewrite utils + reducer, add getAllLegalActions, full tests
2. simulator — DeckProbabilities, PositionEvaluator, BotWeights,
   RandomBot, GreedyBot, ProbabilityBot, PersonalBot,
   runGame, runSimulation, invariant checks
3. analytics — DeckComposition (math first), DeckStats, HandStats,
   CalibrationReport, SensitivityReport
4. CLI
5. Weight optimization (findOptimalWeights, sweepWeightSpace)
6. UI (screens above, puzzle last)

---

## Open Questions

**GreedyBot ink selection** — lowest cost? highest cost? most copies left?
ProbabilityBot solves this via deckQuality. Deferred for GreedyBot.

**Weight search strategy** — grid vs random sampling vs genetic?
Deferred until optimization phase.

**Crowd skill segmentation** — self-reported vs consistency-derived?
Deferred until crowdsourcing phase.

**Replay encoding format** — JSON action sequences, exact schema TBD.

**IP / Legal** — research before going public.