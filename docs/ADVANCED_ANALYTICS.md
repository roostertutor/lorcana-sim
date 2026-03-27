# ADVANCED_ANALYTICS.md
# Spec for analytics queries that go beyond current aggregate stats.
# These are the questions humans can't answer from 100 games
# but bots can answer from 10,000 games.
# Builds on existing packages/analytics infrastructure.

---

## The Core Value Proposition

Humans playing 100 games get intuition and noise.
Bots playing 10,000 games get signal.

The questions below are ones where human intuition is unreliable
because the sample size is too small, the interactions too complex,
or the sequencing too hard to track manually.

---

## Question Category 1: Deck Construction

### "I'm lacking 4-cost cards — what should I slot in?"

This is a **card replacement analysis**. Run the deck with card X,
run it with card Y, compare the delta.

```typescript
interface SlotAnalysisConfig {
  baseDeck: DeckEntry[]
  slotsToFill: number             // how many cards to evaluate
  candidatePool?: string[]        // definitionIds to consider
                                  // defaults to all set cards matching color
  opponent: BotStrategy
  gamesPerCandidate: number       // default 200
  definitions: Record<string, CardDefinition>
}

interface SlotAnalysisResult {
  candidates: {
    definitionId: string
    winRateDelta: number          // vs base deck without those slots
    avgTurnPlayed: number
    playRate: number              // % of games it gets played
    loreContributed: number
  }[]
  topRecommendations: string[]    // top 3 definitionIds by winRateDelta
}
```

**How it works:**
1. Run base deck (with empty slots replaced by filler) N games → base win rate
2. For each candidate: insert 4 copies, run N games → candidate win rate
3. Sort by winRateDelta
4. Cards that improve win rate AND have high play rate are good slots

---

### "Is card X better than card Y in my deck?"

More targeted version of slot analysis.

```typescript
interface CardComparisonConfig {
  baseDeck: DeckEntry[]           // deck with card X already in it
  cardX: string                   // definitionId of current card
  cardY: string                   // definitionId of candidate replacement
  count: number                   // how many copies (default 4)
  opponents: BotStrategy[]        // test against multiple opponent styles
  gamesPerMatchup: number
}

interface CardComparisonResult {
  cardX: {
    winRates: Record<string, number>  // per opponent style
    avgWinRate: number
    playRate: number
    avgTurnPlayed: number
  }
  cardY: {
    winRates: Record<string, number>
    avgWinRate: number
    playRate: number
    avgTurnPlayed: number
  }
  recommendation: "X" | "Y" | "matchup_dependent"
  matchupDependentInsight?: string  // "X better vs aggro, Y better vs control"
}
```

---

## Question Category 2: Draw and Probability

### "How often do I see Card A given I also play Develop Your Brain?"

Pure hypergeometric can't model this — Develop Your Brain changes
effective card density in a way that depends on sequencing, timing,
and what else you're looking for.

The simulation naturally captures this. Just run games and count.

```typescript
interface DrawProbabilityConfig {
  deck: DeckEntry[]
  targetCard: string              // definitionId of Card A
  byTurn: number                  // "by turn N"
  definitions: Record<string, CardDefinition>
  iterations: number              // default 10000 (pure draw sim, very fast)
}

interface DrawProbabilityResult {
  probabilityByTurn: Record<number, number>  // turn → P(seen at least 1)
  avgCopiesSeen: number
  avgTurnFirstSeen: number
  // Breakdown by how many copies were in deck
  withFullPlayset: number         // P if you have 4 copies
  withPartialPlayset: number      // P if you only have 2-3 copies
}
```

**Implementation note:** This doesn't need a full game simulation.
Just simulate draws with scry effects applied. Much faster than full games.
10,000 iterations takes milliseconds.

---

### "Should I play Friends on the Other Side or Develop Your Brain to find Card X?"

This is a **single-position decision** query. Given this exact board state
and hand, which line produces better outcomes?

```typescript
interface LineComparisonConfig {
  startingState: GameState        // current mid-game state
  lineA: GameAction[]             // sequence of actions for option A
  lineB: GameAction[]             // sequence of actions for option B
  continuationBot: BotStrategy    // how to play out the rest of the game
  deck1: DeckEntry[]
  deck2: DeckEntry[]
  definitions: Record<string, CardDefinition>
  iterations: number              // default 500
}

interface LineComparisonResult {
  lineA: {
    actions: GameAction[]
    winRate: number
    avgLoreAfter: number          // lore after the line resolves
    targetCardFound: boolean      // did you find what you were looking for?
  }
  lineB: {
    actions: GameAction[]
    winRate: number
    avgLoreAfter: number
    targetCardFound: boolean
  }
  recommendation: "A" | "B" | "marginal"  // < 5% delta = marginal
  delta: number                   // win rate difference
}
```

**How Develop Your Brain chaining works in this analysis:**
The engine already plays Develop Your Brain correctly (scry + take 1).
The simulation naturally captures "I found another Develop Your Brain
and played that too" because the bot continues optimally from each scry result.

---

## Question Category 3: Board State Injection

### "Given my board state, run analysis from here"

The most flexible query. Inject any mid-game state and run simulations.

```typescript
interface BoardStateInjectionConfig {
  // Option A: paste full GameState JSON (from game log export)
  state?: GameState

  // Option B: build state from UI inputs
  stateBuilder?: {
    player1: {
      lore: number
      availableInk: number
      hand: string[]              // definitionIds
      play: { id: string; isExerted: boolean; damage: number }[]
      inkwell: number             // count (exact cards don't matter for analysis)
      deckRemaining: DeckEntry[]  // what's left in deck
    }
    player2: {
      // same structure
    }
    turnNumber: number
    currentPlayer: PlayerID
  }

  player1Deck: DeckEntry[]        // full original decklist
  player2Deck: DeckEntry[]
  bot: BotStrategy
  iterations: number
}
```

**UI for state builder:**
Simple form — not a visual game board. Text inputs for lore/ink counts.
Dropdowns to select cards in hand/play. This is different from the
game board where you actually play cards. It's just data entry for analysis.

---

## Question Category 4: Matchup Analysis

### "How does my deck perform against different opponent archetypes?"

```typescript
interface MatchupAnalysisConfig {
  myDeck: DeckEntry[]
  opponentArchetypes: {
    name: string
    deck: DeckEntry[]
    bot: BotStrategy              // use archetype-appropriate weights
  }[]
  gamesPerMatchup: number
}

interface MatchupAnalysisResult {
  overall: {
    avgWinRate: number
  }
  byMatchup: {
    archetypeName: string
    winRate: number
    avgGameLength: number
    firstPlayerWinRate: number
    keyCards: string[]            // cards with highest win rate delta in this matchup
  }[]
  bestMatchup: string
  worstMatchup: string
  consistency: number             // std dev of win rates across matchups — low = consistent
}
```

---

## Question Category 5: Card Performance Deep Dive

### "Is this card actually pulling its weight?"

Beyond basic winRateWhenDrawn. Deeper analysis of how a card contributes.

```typescript
interface CardPerformanceDeepDive {
  definitionId: string
  results: GameResult[]           // from prior simulation

  // When was it most valuable?
  bestTurnToPlay: number          // turn where playing it correlated with wins
  
  // What board state does it need?
  bestConditions: {
    minLoreWhenPlayed: number
    minBoardSizeWhenPlayed: number
    // "This card was 2x more impactful when played with 3+ characters in play"
  }

  // How often does it actually do what it's supposed to?
  effectActivationRate: number    // % of games it triggers its ability
  abilityImpact: number           // win rate delta when ability fires vs doesn't

  // Replacement value
  replacementDelta: number        // win rate change if you remove this card
}
```

---

## Implementation Notes

### What already exists

The existing `packages/analytics` has:
- `aggregateResults()` → DeckStats including CardPerformance
- `analyzeDeckComposition()` → pure math
- `analyzeOpeningHands()` → Monte Carlo
- `calibratePersonalBot()` → comparison
- `sensitivityReport()` → weight analysis

The new queries build on this infrastructure. Don't replace it.

### What needs to be added to simulator

```typescript
// packages/simulator/src/runGame.ts
// Add startingState to SimGameConfig — 3-line change
interface SimGameConfig {
  // ... existing ...
  startingState?: GameState       // for mid-game injection
}
```

### New analytics functions to add

Add to `packages/analytics/src/`:

```
advanced/
  slotAnalysis.ts          → SlotAnalysisConfig → SlotAnalysisResult
  cardComparison.ts        → CardComparisonConfig → CardComparisonResult
  drawProbability.ts       → DrawProbabilityConfig → DrawProbabilityResult
  lineComparison.ts        → LineComparisonConfig → LineComparisonResult
  matchupAnalysis.ts       → MatchupAnalysisConfig → MatchupAnalysisResult
  cardDeepDive.ts          → uses existing GameResult[], returns deeper stats
```

Export from `packages/analytics/src/index.ts`.

### Performance considerations

| Query | Iterations needed | Estimated time (browser) |
|-------|-------------------|--------------------------|
| Slot analysis (1 candidate) | 200 games | < 1 second (GreedyBot) |
| Slot analysis (all set 1 cards) | 200 × 216 = 43,200 games | ~30-60 seconds |
| Card comparison | 200 × 2 = 400 games | < 2 seconds |
| Draw probability | 10,000 draw sims | < 500ms |
| Line comparison | 500 games × 2 | ~5 seconds |
| Matchup analysis (4 archetypes) | 500 × 4 = 2,000 games | ~10 seconds |

Slot analysis for all cards needs a loading indicator and possibly
Web Workers to avoid blocking the UI. Start with targeted analysis
(specific candidate cards) before "analyze all possible slots."

---

## CLI Commands to Add

```bash
# Find best cards to fill cost slots
pnpm slot --deck ./deck.txt --cost 4 --opponent aggro --iterations 200

# Compare two specific cards
pnpm cardcomp --deck ./deck.txt --card1 "simba-protective-cub" --card2 "stitch-rock-star" --iterations 500

# Draw probability for a specific card
pnpm drawprob --deck ./deck.txt --card "moana-of-motunui" --by-turn 5

# Matchup analysis
pnpm matchup --deck ./deck.txt --opponents aggro,control,midrange --iterations 500

# Inject board state from JSON file
pnpm inject --state ./saved-state.json --deck1 ./deck1.txt --deck2 ./deck2.txt --iterations 500
```

---

## Build Order

1. Add `startingState` to `runGame` (3-line change, unlocks everything)
2. Draw probability (pure math + simple simulation, fast to build)
3. Card comparison (simple: two runs, compare results)
4. Slot analysis (extends card comparison)
5. Line comparison (needs startingState)
6. Matchup analysis (needs archetype deck definitions)
7. Card deep dive (post-processing on existing GameResult[])
8. UI for board state injection form
9. Web Workers for long-running analyses