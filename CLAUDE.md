# CLAUDE.md
# Automatically read by Claude Code every session.
# Keep this file current. Update "Current Status" at the start of each session.
# For full context: docs/SPEC.md (what/how) and docs/DECISIONS.md (why).

---

## What This Project Is

Headless Lorcana TCG analytics engine. NOT a human-playable simulator.
Simulates thousands of games to produce deck analytics and win rates.

## Current Status
(Update at the start of every Claude Code session)
- engine:    done — reducer, utils, getAllLegalActions, checkWinConditions; 43 tests passing
- simulator: done — RandomBot, GreedyBot, ProbabilityBot, PersonalBot, presets, runGame, runSimulation, optimizer; Layer 3 invariants (1000 games) + sanity checks passing
- analytics: done — aggregateResults, analyzeDeckComposition, compareDecks, analyzeOpeningHands, calibratePersonalBot, analyzeWeightSensitivity; 15 tests passing
- ui:        not started

## Known Pre-existing Typecheck Issue

`pnpm typecheck` reports 3 errors in `packages/engine/src/cards/sampleCards.ts` (protected file):
three cards use `subtitle: undefined` instead of omitting the property, which fails
`exactOptionalPropertyTypes`. Cannot fix without modifying a protected file.
All other engine code typechecks clean.

---

## Package Structure and Dependency Rules

```
engine/      ← pure rules only. Zero UI deps. Zero bot logic.
simulator/   ← imports from engine only
analytics/   ← imports from engine and simulator only
ui/          ← imports from analytics only
```

Never cross these boundaries. Each package has exactly one job.
Build order: engine → simulator → analytics → ui

---

## Files That Must Not Be Modified

These four files are correct. Do not touch them:
- packages/engine/src/types/index.ts
- packages/engine/src/cards/sampleCards.ts
- packages/engine/src/engine/validator.ts
- packages/engine/src/engine/initializer.ts

---

## Critical Bug Fixes (Must Carry Forward in All New Code)

**moveCard same-player clobber:**
When sourcePlayerId === targetPlayerId, both zone changes must be merged
into a single object. Using two separate spread keys clobbers the first.
```typescript
// WRONG
zones: { ...state.zones, [playerId]: { ...removeFrom }, [playerId]: { ...addTo } }

// CORRECT
zones: { ...state.zones, [playerId]: { ...removeFrom, ...addTo } }
```

**Trigger fizzle:**
is_banished and leaves_play triggers must fire even after the card has
left play. Only fizzle if the card instance doesn't exist at all.
```typescript
// WRONG
if (!source || source.zone !== "play") continue

// CORRECT
if (!source) continue
const requiresInPlay = !["is_banished", "leaves_play"].includes(trigger.ability.trigger.on)
if (requiresInPlay && source.zone !== "play") continue
```

**Win conditions:**
Never hardcode `lore >= 20`. Always call `getLoreThreshold(state, definitions)`
which scans in-play cards for modifications (e.g. Donald Duck changes it).
Deck exhaustion is a separate loss condition checked at end of turn.

---

## Testing Rules

- Always use `injectCard()` to set up state — never rely on random opening hand
- Layer 3 invariant tests cover data integrity only:
    - total cards per player always 60
    - no card in two zones simultaneously
    - availableInk >= 0, lore >= 0
    - currentPlayer and phase are valid values
- Do NOT write invariants for things cards can change:
    - inkwell contents (Ink Geyser moves them)
    - lore direction (Aladdin - Street Rat reduces it)
    - win threshold (Donald Duck modifies it)

---

## Bot Type Separation (Never Violate)

Three bot types exist. Results across types are never aggregated.

```typescript
type BotType = "algorithm" | "personal" | "crowd"
```

- **algorithm:** RandomBot, GreedyBot, ProbabilityBot, weight presets
- **personal:** PersonalBot / named player bots (e.g. RyanBot)
- **crowd:** CrowdBot, ExpertCrowdBot (future)

Every `GameResult` carries `botLabels` and `botType`.
`aggregateResults()` must throw if called with mixed bot types.

---

## Bot Progression (Build in This Order)

1. RandomBot — random legal action, stress testing only
2. GreedyBot — simple heuristics, baseline analytics
3. DeckProbabilities — hypergeometric calculator (used by ProbabilityBot)
4. PositionEvaluator — scores game state using weighted factors
5. BotWeights — static scalars + dynamic functions of game state
6. ProbabilityBot(weights) — deck-aware, uses evaluator
7. Weight presets — AggroWeights, ControlWeights, MidrangeWeights, RushWeights
8. PersonalBot — weight vector + optional override rules + calibration
9. findOptimalWeights — grid/random search over weight space

---

## Key Types (Quick Reference)

```typescript
// Engine
applyAction(state, action, definitions) → ActionResult
getAllLegalActions(state, playerId, definitions) → GameAction[]
checkWinConditions(state, definitions) → WinResult

// Bot interface
interface BotStrategy {
    name: string
    type: BotType
    decideAction: (state, playerId, definitions) => GameAction
}

// Weights
interface BotWeights {
    loreAdvantage: number        // static 0-1
    boardAdvantage: number
    handAdvantage: number
    inkAdvantage: number
    deckQuality: number
    urgency: (state: GameState) => number      // dynamic
    threatLevel: (state: GameState) => number  // dynamic
}
```

---

## Run Commands

```bash
pnpm test          # run engine tests
pnpm test:watch    # watch mode for TDD
pnpm typecheck     # type check all packages
pnpm -r build      # build all packages
pnpm dev           # start UI dev server (when built)

# CLI (when built)
pnpm analyze --deck ./deck.txt --bot greedy --iterations 1000
pnpm compare --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000
pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500
```

---

## Full Documentation

docs/SPEC.md    — full specification: what to build, how, build order
docs/DECISIONS.md — why decisions were made, what was considered and rejected
README.md  — project setup and local dev instructions