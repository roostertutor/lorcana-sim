# SPEC.md
# Full specification: what to build and how.
# Read this when starting a new package or major feature.
# For standing instructions Claude Code needs every session, see CLAUDE.md (root).
# For why decisions were made, see docs/DECISIONS.md.

---

## Direction

NOT a human-playable tabletop simulator.
IS a headless game engine + analytics platform.

Simulate thousands of Lorcana games programmatically to produce
deck analytics, win rates, consistency metrics, and card evaluation.

---

## Build Status

| Package | Status | Notes |
|---|---|---|
| `@lorcana-sim/engine` | ✅ Done | CRD audited; run `pnpm test` for current count |
| `@lorcana-sim/simulator` | ✅ Done | Layer 3 invariants (1000 games) |
| `@lorcana-sim/analytics` | ✅ Done | Composition + simulation + comparison |
| `@lorcana-sim/cli` | ✅ Done | analyze, compare, optimize, sweep |
| `@lorcana-sim/ui` | ✅ Done | 5 screens, runs in-browser |
| Card import script | ✅ Done | Per-set JSON files (`lorcast-set-XXX.json`) |
| Set 1 card abilities | ✅ Done | 216 entries, all abilities implemented |
| Additional sets (2–11) | ⬜ Pending | `pnpm import-cards --sets 2,3,...` |
| PersonalBot calibration UI | ⬜ Pending | Analytics function exists, UI screen not built |
| Layer 4 — Known replays | ⬜ Pending | Schema TBD |
| Puzzle of the day / crowd UI | ⬜ Pending | Needs backend |

---

## Package 1: `@lorcana-sim/engine` ✅

### Public API
```typescript
applyAction(state, action, definitions) → ActionResult
createGame(config, definitions) → GameState
parseDecklist(text, definitions) → { entries, errors }
getAllLegalActions(state, playerId, definitions) → GameAction[]
checkWinConditions(state, definitions) → WinResult
getLoreThreshold(state, definitions) → number

// Card definitions
SAMPLE_CARD_DEFINITIONS: Record<string, CardDefinition>   // 20 hand-written cards
LORCAST_CARD_DEFINITIONS: Record<string, CardDefinition>  // imported from Lorcast API
LORCAST_CARDS: CardDefinition[]
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
the threshold. Default 20. Donald Duck - Flustered Sorcerer (Set 7) changes it.
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

## Package 2: `@lorcana-sim/simulator` ✅

### Public API
```typescript
runGame(config: SimGameConfig) → GameResult
runSimulation(config: SimConfig) → GameResult[]

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

computeDeckProbabilities(state, playerId, definitions) → DeckProbabilities
evaluatePosition(state, playerId, probabilities, weights) → { score, factors }
```

### Core Types

```typescript
interface GameResult {
  winner: PlayerID | "draw"
  winReason: "lore_threshold" | "deck_exhausted" | "max_turns_exceeded"
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

### BotWeights

```typescript
interface BotWeights {
  loreAdvantage: number       // static 0-1
  boardAdvantage: number
  handAdvantage: number
  inkAdvantage: number
  deckQuality: number
  urgency: (state: GameState) => number      // dynamic
  threatLevel: (state: GameState) => number  // dynamic
}

// score = Σ(staticFactor × staticWeight) + Σ(dynamicFactor × dynamicWeight(state))
```

### PersonalBot

```typescript
interface PersonalBotConfig {
  name: string
  weights: BotWeights
  overrides?: OverrideRule[]   // checked before weights; explicit play patterns
}

// Calibration workflow:
// 1. Record actual decisions from a real game
// 2. Replay positions through PersonalBot
// 3. Measure agreement rate overall and by phase (early/mid/late)
// 4. Tune weights until agreement improves
// 5. Run PersonalBot vs OptimalBot — gap is a coaching map
```

### Weight Optimization

Weight search strategy: **random search** currently implemented.
Grid and genetic strategies deferred — random is sufficient for
initial analytics and is simplest to validate.
Compatible with future ML: neural net = same BotWeights interface,
gradient descent instead of random search.

---

## Package 3: `@lorcana-sim/analytics` ✅

### Public API
```typescript
aggregateResults(results: GameResult[]) → DeckStats
analyzeDeckComposition(deck, definitions) → DeckComposition
compareDecks(results: GameResult[]) → MatchupStats
analyzeOpeningHands(deck, definitions, iterations) → HandStats
calibratePersonalBot(decisions: RecordedDecision[], bot, definitions) → CalibrationReport
analyzeWeightSensitivity(sweepResults: WeightSweepResult[]) → SensitivityReport
```

`aggregateResults()` throws if called with mixed BotTypes.
All composition math (cost curve, ink curve) uses hypergeometric formula — no simulation needed.

### Analytics Questions This Answers

- "67% win rate vs AggroWeights, 43% vs ControlWeights — weak to slow gameplans"
- "+8% WR delta when drawn vs Control, +1% vs Aggro — cut from aggro builds"
- "71% win rate with AggroWeights, 51% with Control — play this deck aggressively"
- "RyanBot vs OptimalBot gap: 12.4%. deckQuality weight too low: -6.2%"
- "Win rate stable for loreAdvantage 0.5–0.9, drops below 0.4 — commit to racing"

---

## Package 4: `@lorcana-sim/cli` ✅

```bash
pnpm analyze  --deck ./deck.txt --bot greedy     --iterations 1000
pnpm analyze  --deck ./deck.txt --bot aggro      --iterations 1000
pnpm compare  --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000
pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500
pnpm sweep    --deck ./deck.txt --opponent control --iterations 200
```

Bot options: `random`, `greedy`, `probability`, `aggro`, `control`, `midrange`, `rush`

Decklist format: `4 Card Name` or `4x Card Name`, one per line. Lines starting with `#` are comments.
A sample deck is at `packages/cli/sample-deck.txt`.

Runs via `tsx` — no build step needed.

---

## Package 5: `@lorcana-sim/ui` ✅

Charts over analytics. Not a game board.
Stack: React + Vite + Recharts + Tailwind. No Zustand needed.

### Built Screens
- **Deck Input** — paste decklist, validate, load sample deck button
- **Composition** — cost curve, ink color breakdown, keyword counts, ink curve probability
- **Simulate** — bot picker, iterations, win rate + card performance table with WR delta
- **Compare** — two deck inputs, head-to-head win rate bars
- **Weight Explorer** — 5 sliders, A/C/M/R preset buttons, runs vs opponent + preset comparison

### Pending Screens
- **PersonalBot calibration** — record decisions, measure agreement by phase, tune weights
- **Puzzle of the day** — crowd vote, next day reveal (needs backend)

Simulation runs in-browser (pure TS, no Node APIs). Uses `setTimeout(fn, 10)` to yield
before blocking computation so the loading spinner renders first.

---

## Card Data

### Source: Lorcast API
Base URL: `https://api.lorcast.com/v0`
Rate limit: ~10 req/sec (100ms between requests).
No auth required. Cache gameplay data weekly; prices update daily.

### Import Script
```bash
pnpm import-cards                  # fetch all sets
pnpm import-cards --sets 1,2,3     # fetch specific sets by code
pnpm import-cards --sets 1 --dry   # dry run, print without writing
```

Generates per-set files in `packages/engine/src/cards/`:
- `lorcast-set-001.json`, `lorcast-set-002.json`, etc. — CardDefinition arrays per set
- `lorcastCards.ts` — auto-generated loader that imports and merges all set files

Re-running the import script preserves manually-implemented abilities (non-keyword)
on re-import.

### Current Import Status
| Set | Code | File | Cards | Status |
|---|---|---|---|---|
| The First Chapter | 1 | `lorcast-set-001.json` | 216 (204 unique) | ✅ All abilities implemented |
| Rise of the Floodborn | 2 | — | — | Not imported |
| Into the Inklands | 3 | — | — | Not imported |
| Ursula's Return | 4 | — | — | Not imported |
| (sets 5–11) | … | — | — | Not imported |

### Workflow: Adding a New Set

#### Step 1 — Import from Lorcast API
```bash
pnpm import-cards --sets 2
```
This creates `lorcast-set-002.json` with keyword abilities auto-parsed and
`_namedAbilityStubs` on cards that have non-keyword abilities needing implementation.
It also regenerates `lorcastCards.ts` with the new import.

#### Step 2 — Triage new cards
Run the verification script to see what needs work:
```bash
node -e "
const cards = JSON.parse(require('fs').readFileSync('packages/engine/src/cards/lorcast-set-002.json', 'utf8'));
const stubs = cards.filter(c => c._namedAbilityStubs?.length > 0);
console.log(stubs.length + ' cards need ability implementation');
stubs.forEach(c => console.log('  ' + c.id + ': ' + c._namedAbilityStubs.length + ' abilities'));
"
```
Add these to `docs/CARD_ISSUES.md` under a new set heading.

#### Step 3 — Check if new engine primitives are needed
Most abilities use existing effect types. Compare each stub's text to existing
patterns in Set 1. Common patterns already supported:
- Triggered abilities (enters_play, quests, banished_in_challenge, card_played, etc.)
- Static abilities (grant_keyword, modify_stat, modify_stat_per_count, cost_reduction, etc.)
- Activated abilities (exert, pay_ink, banish_self costs)
- Sequential effects ("[A] to [B]" patterns like "pay 1 ink to draw")
- Cost reductions (one-shot, static, self-from-hand)
- Floating triggers (action cards creating turn-scoped triggers)
- Multi-target selection (count on chosen target)
- Challenge/quest restrictions
- heal_and_draw, lose_lore, cant_challenge

If a card needs a new effect type, add it to `types/index.ts` and handle it in
`reducer.ts` before wiring up the card data.

#### Step 4 — Implement abilities
For each card with `_namedAbilityStubs`:
1. Read the stub text and the CRD PDF for the relevant rules
2. Add the ability to the card's `abilities` array in the set JSON file
3. Add `storyName` (CRD 5.2.8 — the bold ability name) and `rulesText`
   (the printed rules text excluding the story name) to each ability
4. Remove `_namedAbilityStubs` from the card once all abilities are implemented
5. For enchanted variants (same `id`, different `number`/`rarity`), apply identical changes

#### Step 5 — Verify
```bash
pnpm test                          # all tests still pass
npx tsc --build packages/engine    # typecheck clean
```
Run the English translation audit to verify implementations match card text:
compare each ability's `rulesText` against what the engine actually does.

#### Step 6 — Update docs
- Update the import status table above
- Update `docs/CARD_ISSUES.md` (remove implemented cards, track remaining)
- Update `CLAUDE.md` status line

---

## Testing Strategy

### Layer 1 — Unit tests (engine)
Every mechanic isolated. `injectCard()` always. Grow per card added.

### Layer 2 — Integration scenarios (engine)
Multi-card interactions. Every non-obvious interaction gets a test.
Examples: two triggers same turn, Ward blocking activated abilities,
Shift damage inheritance, Singer + Song interaction.

### Layer 3 — True engine invariants (simulator) ✅
1000 RandomBot games. Assert after every action.
Invariants: total cards = 60, no card in two zones, availableInk ≥ 0,
lore ≥ 0, currentPlayer valid, phase valid.

### Layer 4 — Known replays (engine) ⬜
3–5 real human-played games encoded as action sequences.
Engine must agree at every step.
Schema TBD — likely JSON array of `{ action: GameAction, expectedState: Partial<GameState> }`.

### Simulation sanity checks (analytics) ✅
Mirror match win rate ~50%, going first win rate 50–65%,
average game length 6–15 turns, draw rate near 0%.

---

## Bot Type Separation — Never Violate

```typescript
type BotType = "algorithm" | "personal" | "crowd"
```

- **algorithm:** RandomBot, GreedyBot, ProbabilityBot, weight presets
- **personal:** PersonalBot / named player bots (e.g. RyanBot)
- **crowd:** CrowdBot, ExpertCrowdBot (future)

Every `GameResult` carries `botLabels` and `botType`.
`aggregateResults()` throws if called with mixed bot types.

---

## Open Questions

See docs/DECISIONS.md §Open Questions for the current list.
