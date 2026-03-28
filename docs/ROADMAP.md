# ROADMAP.md
# Ties together all the specs. What to build, in what order, and why.
# Cross-references all docs in docs/ folder.
# Does NOT replace SPEC.md or DECISIONS.md.
#
# Last updated: Session 9

---

## Where We Are

```
✅ Rule engine — Sets 1-11 imported, Set 1 fully implemented, CRD audited
✅ Simulator — RandomBot, GreedyBot, ProbabilityBot, PersonalBot, RampCindyCowBot
✅ Mulligan — shouldMulligan/performMulligan, bot-specific strategies, mulliganed in GameResult
✅ Analytics — composition, aggregation, comparison, calibration, sensitivity
✅ Query system — GameCondition language, ref/mulliganed conditions, save/load results
✅ CLI — analyze, compare, optimize, sweep, query
✅ Basic UI — deck input, composition, simulation, comparison, weight explorer
✅ Layer 1-3 tests — 162 engine tests + 1000 RandomBot invariant games
✅ Layer 5 bot tests — 12 tests in bot.test.ts
✅ Set 1 complete — 204 unique cards, 216 entries, all abilities implemented, 0 stubs
✅ Dual-ink support — inkColors is always an array
✅ Reckless keyword — can't quest, can't pass if able to challenge, 4 tests
✅ Floating triggers — floatingTriggers[], CreateFloatingTriggerEffect
✅ Timed effects — timedEffects[] with 3 duration types, expiry in applyPassTurn
✅ Conditional statics — evaluateCondition() in gameModifiers, 12 condition types
✅ Extra ink plays — ExtraInkPlayStatic, inkPlaysThisTurn counter, Belle supported

❌ Smart choice resolution — bots still pick random targets
❌ Interactive game board — TestBench or GameBoard not yet built
❌ Real-time analysis overlay
❌ RL training loop — specced in RL.md, not started
❌ Multiplayer server
```

---

## The Four Streams

These are now the active workstreams. They are largely independent
and can run in parallel. Priority order within each stream is top-down.

---

### Stream 1: RL Bot (highest long-term value)
*Spec: docs/RL.md*
*Goal: a bot that discovers how to play a deck without human encoding*

This is the "go big or go home" investment. Everything in Stream 2
(analytics) becomes more valuable once the RL bot replaces GreedyBot
as the simulation engine — because the data reflects competent play,
not hardcoded heuristics.

```
1a. Auto-tagger (autoTag.ts)
    Read card data → feature vectors
    No card names, no manual labels
    Works for any card in any set automatically

1b. Neural network (network.ts)
    Plain TypeScript, no external dependencies
    Input → Hidden(128) → Hidden(64) → Output
    Forward pass + backprop from scratch

1c. RLPolicy (policy.ts)
    Wraps network, implements BotStrategy interface
    decideAction() + shouldMulligan() + performMulligan()
    Plugs directly into existing runGame() unchanged

1d. Training loop (trainer.ts)
    Single episode: deal → mulligan decision → play game → reward → update
    ε-greedy exploration with decay
    Curriculum: trainWithCurriculum() goldfish → real opponent

1e. CLI command (learn.ts)
    pnpm learn --deck ./deck.txt --opponent ./opponent.txt --curriculum
    pnpm learn --deck ./deck.txt --goldfish-only --episodes 50000
    pnpm learn --load ./policy.json --opponent ./new-opponent.txt

1f. Validation
    After training: inkableFraction should have positive weight trend
    uninkableCount should have negative weight trend
    Reward curve should show improvement over episodes
    Run existing invariant tests with RLPolicy as bot — all must pass
```

**Claude Code session prompt:**
```
Read docs/RL.md in full before writing any code.
Implement in order: autoTag.ts, network.ts, policy.ts, trainer.ts, index.ts, learn.ts.
Do not modify engine, existing bots, runGame, or analytics.
RLPolicy must implement BotStrategy interface exactly — it plugs into runGame as-is.
Run pnpm test after each file to confirm nothing breaks.
```

---

### Stream 2: Analytics — Generator Not Tester
*Specs: docs/ANALYTICS_PHILOSOPHY.md, docs/ADVANCED_ANALYTICS.md, docs/GOLDFISH_SIM.md*
*Goal: queries that discover things, not just confirm what you believe*

Current query system is a hypothesis tester. Stream 2 adds the infrastructure
for discovery. See ANALYTICS_PHILOSOPHY.md for the full philosophy.

```
2a. Opener profiling queries (add to cinderella-questions.json)
    What do games where the line fired have in common in their openers?
    Queries: OP1-OP7 from ANALYTICS_PHILOSOPHY.md
    No code changes — just new queries against existing saved results

2b. Strategy sweep (mulliganSweep.ts + CLI pnpm sweep-mulligan)
    Define N mulligan strategies, run each 500 games, compare F3
    Discovers which strategy actually produces best outcomes
    No human encoding of "correct" strategy

2c. Slot analysis (slotAnalysis.ts)
    Run deck with card X, run without X, compare win rate delta
    Answers: "is this card actually pulling its weight?"

2d. Card comparison (cardComparison.ts)
    Run deck with X, run with Y, compare across matchups
    Answers: "is X better than Y in my deck, and in which matchups?"

2e. Matchup analysis (matchupAnalysis.ts)
    Run deck against multiple opponent archetypes, compare win rates
    Answers: "what's my best and worst matchup?"

2f. Wire RL bot into query pipeline (after Stream 1 complete)
    Replace GreedyBot with trained RLPolicy in simulation configs
    All query results now reflect competent play, not heuristics
    This is when the analytics become genuinely trustworthy
```

**Note on 2a:** No code needed. Just add the opener profiling queries from
ANALYTICS_PHILOSOPHY.md to cinderella-questions.json and rerun the existing
cinderella.sim-results.json. This is the fastest path to discovering something
you don't already know about the Cinderella deck.

---

### Stream 3: Game Board
*Spec: docs/GAME_BOARD.md*
*Goal: interactive board for card testing and solo play at 3am*

Independent of Streams 1 and 2. The game board doesn't need a good bot
to be useful — even GreedyBot as an opponent is enough to test card interactions.

```
3a. useGameSession hook (permanent, never thrown away)
    packages/ui/src/hooks/useGameSession.ts
    Encapsulates: gameState, legalActions, dispatch, analysis, actionLog
    Transport abstraction: local applyAction now, server API later
    This is the most important file — written carefully

3b. TestBench.tsx (temporary scaffolding)
    packages/ui/src/pages/TestBench.tsx
    Ugly but functional — text buttons for legal actions, game log
    Useful immediately for verifying card implementations
    Replaced by GameBoard.tsx later but logic stays in the hook

3c. GameBoard.tsx (pretty version)
    packages/ui/src/pages/GameBoard.tsx
    Proper zone layout, card components, analysis overlay
    Uses same useGameSession hook — only the visual layer changes
    Win probability bar, bot suggestion, position factors

3d. Real-time analysis overlay
    Part of GameBoard.tsx
    Runs 200 GreedyBot games from current position after each action
    Shows: win probability, suggested play, position breakdown
    Uses startingState in runGame (already implemented)

3e. Wire in RL bot analysis (after Stream 1)
    Replace GreedyBot analysis with RLPolicy analysis
    Win probability now reflects competent play
```

**Claude Code session prompt:**
```
Read docs/GAME_BOARD.md in full.
Implement useGameSession hook first — this is permanent code, take care.
Then TestBench.tsx — ugly is fine, functional is required.
Do not touch GameBoard.tsx until TestBench is working and tested.
startingState is already in SimGameConfig — use it for analysis.
```

---

### Stream 4: Multiplayer Server
*Spec: server/SPEC.md (SERVER.md copied to /server folder)*
*Goal: play against a real opponent, zero chance of cheating*

Separate folder (/server), separate Claude Code session, separate CLAUDE.md.
Imports from @lorcana-sim/engine only. Does not touch the monorepo.

Prerequisite: Stream 3's useGameSession hook must exist before wiring in
the server transport layer.

```
4a. Supabase setup
    Database schema (games, lobbies, profiles tables)
    Row Level Security policies
    Auth: Google + Discord OAuth via Supabase

4b. Hono server
    POST /game/:id/action — receives action, runs applyAction, saves, broadcasts
    POST /lobby/create — generate 6-char code
    POST /lobby/join — join by code, creates game
    GET /game/:id — current state (for reconnect)

4c. Supabase Realtime
    Server writes to games table → Supabase broadcasts to both clients
    Client subscribes: channel → onUpdate → setGameState
    No manual WebSocket management

4d. Multiplayer mode in useGameSession
    Add mode: "solo" | "multiplayer" to GameSessionConfig
    Multiplayer dispatch: POST /api/game/:id/action instead of local applyAction
    State update comes via Supabase Realtime subscription
    Components never know the difference — same hook, different transport

4e. Lobby UI
    Create lobby → share 6-char code with friend
    Join lobby → enter code → game starts
    Private games only — no public matchmaking in v1
    Deploy to Railway
```

**Claude Code session prompt (in /server folder):**
```
cd ~/WebstormProjects/lorcana-sim/server
claude
Read SPEC.md (SERVER.md) in full.
Import from @lorcana-sim/engine only.
Do not modify anything in the parent directory.
Implement in order: schema.sql → Supabase client → auth → lobby → game action endpoint.
```

---

## Dependencies Between Streams

```
Stream 1 (RL) — independent, start anytime
  ↓ unlocks
Stream 2f (RL in analytics pipeline)
Stream 3e (RL in analysis overlay)

Stream 3a (useGameSession) — independent, start anytime
  ↓ prerequisite for
Stream 4d (multiplayer mode in useGameSession)

Stream 2a (opener profiling) — no code, start TODAY
  requires only: existing cinderella.sim-results.json

Everything else — parallel, no blocking dependencies
```

---

## What NOT to Build

These are explicitly deferred or cancelled:

```
❌ Deck profiler (replaced by RL auto-tagger)
❌ 2-ply lookahead for ProbabilityBot (replaced by RL)
❌ RampCindyCowBot-style hand-coded bots (replaced by RL)
❌ Opener profiling as a code feature (it's just queries — 2a above)
❌ Public matchmaking (Phase 4 followup)
❌ Spectator mode (Phase 4 followup)
❌ Card images (nice to have)
❌ Mobile layout (desktop first)
❌ SQLite storage (JSON files sufficient until we know what longitudinal questions to ask)
❌ Web Workers (add only if performance is actually a problem)
❌ Ranked/ELO (needs match history, much later)
❌ Set 2+ full ability implementation (do on demand when cards are needed for analysis)
```

---

## How to Decide What to Work On Next

Ask in order:

1. **Does Stream 2a (opener profiling queries) tell me something new?**
   If yes — the query system is working. Proceed to Stream 1 (RL).
   If no — the questions aren't probing deep enough. Redesign queries first.

2. **Do I need to test card implementations?**
   If yes — Stream 3 (TestBench) before anything else.

3. **Is the RL bot training and producing sensible weights?**
   If yes — replace GreedyBot with RLPolicy in cinderella-sim.json, rerun queries.
   If no — debug training loop before proceeding.

4. **Do I want to play against a real person?**
   If yes — Stream 4 (server), but only after Stream 3's useGameSession exists.
