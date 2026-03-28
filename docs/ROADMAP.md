# ROADMAP.md
# Ties together all the specs. What to build, in what order, and why.
# Cross-references: GAME_BOARD.md, BOT_IMPROVEMENTS.md, SERVER.md, ADVANCED_ANALYTICS.md
# Does NOT replace existing SPEC.md or DECISIONS.md.

---

## Where We Are

```
✅ Rule engine — 216 cards, full Set 1, CRD audited
✅ Simulator — RandomBot, GreedyBot, ProbabilityBot, PersonalBot, optimizer
✅ Analytics — composition, aggregation, comparison, calibration, sensitivity
✅ CLI — analyze, compare, optimize, sweep
✅ Basic UI — deck input, composition, simulation, comparison, weight explorer
✅ Layer 1-3 tests — 162 engine tests + 1000 RandomBot invariant games

❌ Smart choice resolution (bots pick random targets)
✅ Mulligan (Partial Paris — bot-specific strategies via shouldMulligan/performMulligan)
❌ Interactive game board (test bench or pretty)
❌ Real-time analysis overlay
❌ Multiplayer server
❌ Advanced analytics queries
```

---

## The Three Parallel Tracks

These can run in parallel because they touch different parts of the codebase.

```
Track A: Engine/Bots         Track B: Game Board UI       Track C: Server
(you + Claude Code)          (Claude Code)                (separate /server folder)

Bot improvements             useGameSession hook          Supabase setup
  Smart choices              TestBench.tsx                Auth (Google/Discord)
  Mulligan                   GameBoard.tsx (pretty)       Lobby create/join
  Deck profiler              Analysis overlay             Game action endpoint
  2-ply lookahead            Real-time win bar            Supabase Realtime

Advanced analytics           Board state injection UI     Deploy to Railway
  Draw probability           
  Card comparison            
  Slot analysis              
  Line comparison            
  Matchup analysis           
```

Track A is the most important — better bots = better data = the whole
point of the platform. Don't skip to Track C before Track A has at least
smart choice resolution and mulligan.

Track B is independent and can run simultaneously. The game board doesn't
need better bots to be playable — even GreedyBot as an opponent is useful
for testing cards.

Track C should start after Track B has a working TestBench. The multiplayer
integration point is in `useGameSession` — you need that hook to exist
before wiring in the server API.

---

## Phase 1: Foundation Improvements (Do These First)

**Why first:** These make all subsequent simulation data more trustworthy.
Building advanced analytics on top of random-choice bots produces
unreliable results. Fix the bots first.

### 1a. Smart Choice Resolution
File: `packages/simulator/src/bots/GreedyBot.ts` and `ProbabilityBot.ts`
Spec: BOT_IMPROVEMENTS.md → Stage 1
Work: Replace `resolveChoiceRandom` with evaluator-based target selection
Tests: "does Merlin target the most threatening character?"
Impact: Immediately improves all simulation data quality

### 1b. Mulligan
File: `packages/simulator/src/runGame.ts`
Spec: BOT_IMPROVEMENTS.md → Stage 3
Work: Add `shouldMulligan()`, call it in `runGame` before game starts
Also fixes: CRD 2.2.2 (flagged ❌ in CRD_TRACKER.md)
Tests: "do kept hands have >= 2 inkable cards in 95%+ of games?"
Impact: Fixes consistency stat accuracy

### 1c. startingState in runGame
File: `packages/simulator/src/runGame.ts` and `types.ts`
Spec: GAME_BOARD.md → "runSimulation needs startingState"
Work: 3-line change — add optional `startingState?: GameState` to SimGameConfig
Impact: Unlocks real-time analysis and board state injection

---

## Phase 2: Test Bench (Immediate Usability)

**Why next:** Lets you play and verify cards you've implemented.
Useful TODAY for card testing. Independent of bot quality.

### 2a. useGameSession hook
File: `packages/ui/src/hooks/useGameSession.ts`
Spec: GAME_BOARD.md → "Phase 1: useGameSession Hook"
Work: Hook encapsulating game state, legal actions, dispatch, analysis
This is permanent code — written carefully, never thrown away

### 2b. TestBench.tsx
File: `packages/ui/src/pages/TestBench.tsx`
Spec: GAME_BOARD.md → "Phase 2: TestBench.tsx"
Work: Ugly but functional. Text buttons for legal actions. Game log.
Add to App.tsx tabs: `{ id: "testbench", label: "Test Bench", requiresDeck: true }`
This is temporary scaffolding — replaced by GameBoard.tsx later

---

## Phase 3: Bot Improvements (Better Data)

**Why now:** Once you have the test bench, you can visually verify bot
decisions are improving. Run games, watch the bot play, adjust.

### 3a. Deck Profiler
File: `packages/simulator/src/deckProfiler.ts` (new)
Spec: BOT_IMPROVEMENTS.md → Stage 2
Work: Auto-detect synergies from card data. Generate deck-aware weights.
Tests: "does Tamatoa deck prioritize items in play?"

### 3b. 2-Ply Lookahead (optional, after profiler)
File: `packages/simulator/src/bots/ProbabilityBot.ts`
Spec: BOT_IMPROVEMENTS.md → Stage 4
Work: Add depth parameter to evaluateWithLookahead
Note: Slower. Test performance impact before enabling by default.

### 3c. Layer 5 Bot Tests
File: `packages/simulator/src/bot.test.ts` (new)
Spec: BOT_IMPROVEMENTS.md → Stage 5
Work: Layer 5a correctness tests (quest to win, don't challenge into loss)
Layer 5b personality tests (aggro quests more than challenges)

---

## Phase 4: Pretty Game Board

**Why after bot improvements:** You want the analysis overlay to show
meaningful data, not random-choice bot suggestions.

### 4a. GameBoard.tsx
File: `packages/ui/src/pages/GameBoard.tsx`
Spec: GAME_BOARD.md → "Phase 3: GameBoard.tsx"
Work: Pretty card components, proper zone layout, analysis overlay
Uses: same `useGameSession` hook as TestBench — just different visual layer
Replace TestBench tab with GameBoard tab when ready

### 4b. Real-time Analysis Overlay
Part of GameBoard.tsx — win probability bar, bot suggestion, position factors
Runs analysis in background after each action using `analyzePosition()`

---

## Phase 5: Advanced Analytics

**Why after game board:** The board state injection UI makes advanced
analytics much more accessible. Users can play to a position, export
the state, and analyze from there.

### 5a. Draw Probability (easiest, build first)
File: `packages/analytics/src/advanced/drawProbability.ts`
Spec: ADVANCED_ANALYTICS.md → Category 2
Work: Simple draw simulation with scry effects
CLI: `pnpm drawprob --deck ./deck.txt --card "moana" --by-turn 5`

### 5b. Card Comparison
File: `packages/analytics/src/advanced/cardComparison.ts`
Spec: ADVANCED_ANALYTICS.md → Category 1
Work: Run deck with X, run with Y, compare

### 5c. Slot Analysis
File: `packages/analytics/src/advanced/slotAnalysis.ts`
Spec: ADVANCED_ANALYTICS.md → Category 1
Work: Extends card comparison, iterates over candidate pool

### 5d. Line Comparison
File: `packages/analytics/src/advanced/lineComparison.ts`
Spec: ADVANCED_ANALYTICS.md → Category 2
Requires: startingState in runGame (Phase 1c)
Work: Given a state, compare two action sequences

### 5e. Matchup Analysis
File: `packages/analytics/src/advanced/matchupAnalysis.ts`
Spec: ADVANCED_ANALYTICS.md → Category 4
Work: Run deck against multiple opponent archetype decks

---

## Phase 6: Multiplayer

**Why last:** Multiplayer is the most infrastructure-heavy phase.
Build it last so the product is already valuable before it requires
other people to use it.

### 6a. Server setup
Folder: `/server` (separate from monorepo)
Spec: SERVER.md
Work: Hono + Supabase + auth + lobby + game endpoints
Deploy: Railway

### 6b. Multiplayer mode in useGameSession
File: `packages/ui/src/hooks/useGameSession.ts`
Spec: GAME_BOARD.md → "Phase 4: Multiplayer Integration"
Work: Add `mode: "multiplayer"` path that calls server API instead of local engine
The ONLY file that changes for multiplayer — all components stay the same

### 6c. Lobby UI
New page or modal — create lobby (get a code), join lobby (enter a code)
Simple. No matchmaking. Private games only in v1.

---

## What NOT to Build (Explicitly)

- Public matchmaking (Phase 6 followup, not v1)
- Spectator mode (Phase 6 followup)
- Card images (nice to have, not required for any phase)
- Mobile layout (desktop first throughout)
- Deck persistence (paste each session for now)
- Ranked/ELO (needs match history, much later)
- Set 2 support (Phase 3 followup — new cards, new mechanics)
- Web Workers for analytics (deferred, add if performance is actually a problem)

---

## Key Decision: What Makes Data "Good Enough"

The bot quality problem was discussed at length. Here's the resolution:

Phase 1 bots (smart choices + mulligan) produce data that is:
- Valid for: consistency stats, raw power comparison, opening hand quality
- Not valid for: synergy-dependent card evaluation, optimal sequencing

Phase 3 bots (deck profiler) produce data that is:
- Valid for: everything above PLUS deck-specific synergy evaluation
- Not valid for: multi-turn combo sequences, opponent-read decisions

"Good enough" for the 3am playtesting use case is Phase 1 bots.
"Good enough" for serious deck construction advice is Phase 3 bots.
Build Phase 1 first, ship something useful, then improve.

---

## How to Use These Specs with Claude Code

Each spec is designed to be handed to Claude Code for a focused session.

```
# Session: Bot improvements
cd ~/WebstormProjects/lorcana-sim
claude
> Read docs/BOT_IMPROVEMENTS.md. 
> Implement Stage 1 (smart choice resolution) in all bot files.
> Add Layer 5a tests for quest-to-win and don't-challenge-into-loss.

# Session: Test bench
cd ~/WebstormProjects/lorcana-sim  
claude
> Read docs/GAME_BOARD.md.
> Implement Phase 1 (useGameSession hook) and Phase 2 (TestBench.tsx).
> Add startingState to runGame as specified.

# Session: Server
cd ~/WebstormProjects/lorcana-sim/server
claude
> Read SPEC.md (this is SERVER.md placed in /server folder).
> Implement database schema, auth endpoints, and lobby endpoints.
> Do not modify anything in the parent monorepo.
```

Update "Current Status" in each relevant CLAUDE.md at the end of each session.