# ROADMAP.md
# Ties together all the specs. What to build, in what order, and why.
# Cross-references all docs in docs/ folder.
# Does NOT replace SPEC.md or DECISIONS.md.
#
# Last updated: Session 9 (revised again — 3a-3d done, prereqs done, Stream 5+6 added)

---

## Where We Are

```
✅ Rule engine — Sets 1-11 imported, Set 1 fully implemented, CRD audited
✅ Simulator — RandomBot, GreedyBot, ProbabilityBot, PersonalBot, RampCindyCowBot
✅ Mulligan — shouldMulligan/performMulligan, bot-specific strategies, mulliganed in GameResult
✅ Analytics — composition, aggregation, comparison, calibration, sensitivity
✅ Query system — GameCondition language, ref/mulliganed conditions, save/load results
✅ CLI — analyze, compare, optimize, sweep, query
✅ Basic UI — 5 pages exist, not all aligned with new direction:
           DeckInput: permanent, no changes needed
           CompositionView: permanent, no changes needed (pure math, no bots)
           SimulationView: keep, update bot options after Stream 1 ships
           ComparisonView: keep, update bot options after Stream 1 ships
           WeightExplorer: DEPRECATED — delete with ProbabilityBot after Stream 1
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
✅ TestBench — text-based interactive game board (Stream 3a + 3b)
✅ GameBoard — visual game board with card components (Stream 3c)
✅ Analysis overlay — win probability + position factors (Stream 3d)
✅ Seeded RNG — xoshiro128** in GameState (Stream 1/3e prereq)
✅ Raw GameAction[] capture in GameResult (Stream 1/3e prereq)
✅ RL training loop — autoTag, network, policy, trainer, learn CLI (per-card scoring)
❌ Replay mode — seeded RNG + action capture done, UI not yet built
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
✅ 1a. Auto-tagger (autoTag.ts)
    Card features (44d), state features, action features
    Per-card scoring: network scores each legal action individually

✅ 1b. Neural network (network.ts)
    Plain TypeScript, no external dependencies
    Action net: (state+action → 128 → 64 → 1 score)
    Mulligan net: (state → 64 → 32 → 2)
    REINFORCE update with gradient clipping

✅ 1c. RLPolicy (policy.ts)
    Per-card scoring: scores each legal action, softmax, pick best
    Handles all pending choice types (may, target, discard, option)
    ε-greedy exploration with seeded RNG

✅ 1d. Training loop (trainer.ts)
    trainPolicy() + trainWithCurriculum()
    All randomness seeded — same seed → identical reward curve

✅ 1e. CLI command (learn.ts)
    pnpm learn --deck ./deck.txt --episodes 50000 --save ./policy.json
    pnpm learn --deck ./deck.txt --curriculum --seed 42
    pnpm learn --load ./policy.json --deck ./deck.txt --episodes 10000

✅ 1f. Policy persistence
    toJSON()/fromJSON() for both networks + epsilon + RNG state
    resolveBot("rl") loads saved policy with --policy flag

1g. Validation (ongoing)
    27 tests passing (autoTag, network, policy, trainer integration)
    Seeded training determinism verified
    Learning signal test: training produces non-trivial rewards
    Performance note: per-card scoring needs N forward passes per decision
```

**Shared prerequisites with Stream 3e — DONE ✅**
```
✅ Seeded RNG — xoshiro128** implemented in GameState, seed stored in GameResult
✅ Raw GameAction[] in GameResult — actions[] stored alongside text actionLog[]
```

**Claude Code session prompt:**
```
Read docs/RL.md in full before writing any code.
First implement shared prereqs: seeded RNG in initializer/reducer/mulligan,
and GameAction[] capture in runGame + GameResult types.
Then implement in order: autoTag.ts, network.ts, policy.ts, trainer.ts, index.ts, learn.ts.
Do not modify engine existing bots runGame behavior (only add seed + action capture).
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

2h. Automated slot optimization (after Stream 1 + 2f complete)
    For each card in deck: swap it out, fine-tune RLPolicy, compare win rate delta
    Answers: "should I cut card X for card Y?"
    Workflow:
      pnpm optimize-slots --deck ./deck.txt --opponent ./opponent.txt
        --policy ./trained-policy.json --candidates ./set2-cards.txt
    Process per candidate:
      Load trained policy as warm start (don't retrain from scratch)
      Fine-tune 10,000 episodes with swapped deck
      Run query suite, compare win rate deltas to baseline
      Report ranked list of improvements
    Expensive: run overnight, not interactively
    This is the honest answer to "what should I change in my deck?"
    Neither the bot alone nor the queries alone can answer this —
    requires both running together across multiple deck variants

2g. Query UI tab (packages/ui/src/pages/QueryView.tsx)
    UI wrapper around the CLI query system
    Paste or build a questions JSON in the browser
    Run simulation or load saved results file
    Results rendered as a table — not raw terminal output
    No new backend logic — wraps existing queryResults() function
    Replaces the need to use the CLI for day-to-day query work
```

**Note on 2a:** No code needed for the queries themselves. BUT the existing
cinderella.sim-results.json was generated by RampCindyCowBot — a hand-coded
bot executing an encoded strategy. Opener profiling against that data tells
you about your encoded strategy's performance, not about the deck itself.
Run opener profiling AFTER Stream 1 (RL) generates results with an unbiased bot.
The queries are ready; the right results file doesn't exist yet.

---

### Stream 3: Game Board
*Spec: docs/GAME_BOARD.md*
*Goal: interactive board for card testing and solo play at 3am*

Independent of Streams 1 and 2. The game board doesn't need a good bot
to be useful — even GreedyBot as an opponent is enough to test card interactions.

```
3a. ✅ useGameSession hook (permanent, never thrown away)
    packages/ui/src/hooks/useGameSession.ts
    Encapsulates: gameState, legalActions, dispatch, actionLog
    Transport abstraction: local applyAction now, server API later
    This is the most important file — written carefully

3b. ✅ TestBench.tsx (temporary scaffolding)
    packages/ui/src/pages/TestBench.tsx
    Text-based board with action buttons, pending choice UI, game log
    Useful immediately for verifying card implementations
    Replaced by GameBoard.tsx later but logic stays in the hook

3c. ✅ GameBoard.tsx (pretty version)
    packages/ui/src/pages/GameBoard.tsx
    Visual card components (GameCard.tsx) with ink color tints
    Grid layout: game area left, analysis sidebar right
    Uses same useGameSession hook — only the visual layer changes

3d. ✅ Analysis overlay — Phase 1 (now, with GreedyBot)
    Win probability bar (AnalysisPanel.tsx + useAnalysis.ts)
      Runs 200 GreedyBot games from current position after each action
      Labeled as "GreedyBot estimate" — directionally correct, not precise
      Cancels stale sims when state changes before completion
    Position factors panel
      Lore / board / hand / ink advantage from evaluatePosition()
      No simulation needed — pure computation from current GameState
      Valid regardless of bot quality
    Shared across both TestBench and GameBoard via reusable components
    NO bot suggestion yet
      GreedyBot suggestion = "play most expensive card" — you already know that
      Not worth showing until RL is trained

    Phase 2 (after Stream 1, wired in via 3f):
      Swap GreedyBot for RLPolicy in win probability simulation
      Add bot suggestion: "RL bot would play X (+8% win probability)"
      Win probability becomes genuinely trustworthy

3c/3d status: functional but far from presentable. Missing for a real UI:
    Card images, animations (play/banish/quest/challenge transitions),
    drag-and-drop, sound, hover tooltips with rules text, mobile layout,
    hand fan layout, smooth exert/ready animations, legal target highlights,
    opponent card backs, inkwell/discard visualization.
    Good enough for solo bot testing — revisit when multiplayer ships.

3e. Replay mode — three distinct features, not one

    3e-i. Visual replay (read-only scrubbing)
      Same GameBoard component, read-only
      ReplayControls: prev/next/scrub slider, play/pause, speed control
      Reconstructs GameState at each step by replaying GameAction[] from seed
      At each step: show what the bot chose + win probability before/after
      This is the interpretability layer for RL — watch what it learned to do

    3e-ii. "What if" — human takeover (SC2-style resume from replay)
      From any point in replay, fork into a live game session
      Human takes over P1, bot plays P2 from that board state
      useGameSession.startGame() needs to accept injected GameState
      runGame already supports startingState (simulator/runGame.ts:137)

    3e-iii. "What if" — automated branch analysis
      Fork from a position, sim 200 games with action X vs without
      Compare win% delta to evaluate whether a play was correct
      Already works today via useAnalysis + runSimulation({ startingState })
      No new infrastructure needed — just UI to trigger it from replay

    Prerequisites:
      Seeded RNG (3e-prereq, do as part of Stream 1)
        Replace Math.random() in 4 places with seeded PRNG:
        - initializer.ts: deck shuffle
        - reducer.ts: shuffleDeck (mid-game effects)
        - mulligan.ts: mulligan shuffle
        - utils/index.ts: generateId (cosmetic)
        GameConfig.seed field already exists (unused)
        Store seed in GameResult for reproducibility
        RL needs this anyway for debugging reward signals

      GameAction[] capture (3e-prereq, do as part of Stream 1)
        Current GameResult.actionLog is GameLogEntry[] (text summaries)
        Need raw GameAction[] sequence for state reconstruction
        Add to GameResult or new ReplayableGameResult type
        ~5-15 KB per game (40-80 actions), compresses well

    NOTE: Replaying one game does NOT help RL learn. RL needs thousands
    of full games — volume produces signal, not single-game analysis.
    Replay is for human understanding; "what if" is for human exploration.
    Neither is a training mechanism.

3f. Wire in RL bot analysis (after Stream 1)
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

### Stream 5: Player Profiling + Clone Bot (future, after Stream 4)
*Goal: learn how a specific human player plays and create a bot clone of them*

Every multiplayer game produces a (state, action) log for each player.
Clone training is supervised learning — "given this state, this player
chose this action" — not RL. The network learns to imitate, not discover.

```
5a. Save full game logs to database (extend Stream 4e)
    game_actions table already planned in SERVER.md
    Store: gameId, playerId, gameState snapshot, action taken, turnNumber
    50 games × ~120 decisions = ~6,000 labeled (state, action) pairs per player
    That is enough for recognizable tendencies

5b. Clone trainer (packages/simulator/src/rl/cloneTrainer.ts)
    Supervised learning loop — no reward signal, no exploration
    Input: (state, action) pairs from real game logs
    Output: a policy network that predicts what that player would do
    Simpler than RL trainer — just gradient descent toward correct action

5c. CLI command
    pnpm profile-player --logs ./games/*.json --save ./ryan-bot.json
    pnpm profile-player --player ryanfan --from-db --games 50 --save ./ryan-bot.json

5d. Coaching map (comparison output)
    Load clone bot + RL bot
    Run both on same set of positions from real game logs
    Output: ranked list of decisions where clone diverges from RL
            weighted by win% cost of each divergence
    "Turn 3, you played X. RL bot plays Y. Cost: -7% win probability."
    This is a quantified coaching report no human coach could produce

5e. Play against your clone (UI integration)
    Load saved clone policy in GameBoard bot selector
    Play against a bot that mirrors your own tendencies
    Useful for: identifying patterns in your own play you hadn't noticed
```

Prerequisites: Stream 4 (multiplayer) to generate game logs, Stream 1 (RL) for
the RL bot used in coaching map comparison.

---

## Dependencies Between Streams

```
Stream 1 (RL) — independent, start anytime
  ↓ unlocks
Stream 2f (RL in analytics pipeline)
Stream 3e (RL in analysis overlay)

Stream 3e-prereq (seeded RNG + action capture) — do alongside Stream 1
  Both RL and Replay need this. Build once, use in both.

Stream 3a (useGameSession) ✅ done — was prerequisite for
Stream 4d (multiplayer mode in useGameSession)

Stream 1 (RL) + Stream 4 (multiplayer) — both prerequisites for
Stream 5 (clone bot + coaching map)

Stream 2a-2e — run after Stream 1 generates RL results
  RampCindyCowBot results are compromised, do not use them

Everything else — parallel, no blocking dependencies
```

---

### Stream 6: Engine Stewardship + Card Implementation
*Spec: docs/CRD_TRACKER.md, docs/CARD_ISSUES.md*
*Goal: keep the engine correct, sustainable, and able to support real decks*

This stream runs continuously in the background alongside all other streams.
It is not a sprint — it is ongoing maintenance and incremental card work.
The engine is well-architected already. This stream is stewardship, not rewrite.

#### 6a. Card implementation (demand-driven, not set-complete)

Current state across all sets:
```
Set 1:  204/204 unique cards fully implemented ✅
          216 entries in JSON — 12 are enchanted variants (same card, premium art)
          40 cards are legitimately vanilla (no abilities on the physical card)
          176 have named abilities — all implemented and tested

Sets 2-11: keyword-only data imported from Lorcast API
          The card data (cost, inkable, stats, keywords) is correct
          Named abilities (triggered, activated, static, actionEffects) are stubs
          EXCEPTION — 5 cards implemented for RampCindyCowBot testing:
            tipo-growing-son (Set 5) — MEASURE ME AGAIN: inkwell ability
            vision-of-the-future (Set 5) — look_at_top actionEffect
            sail-the-azurite-sea (Set 6) — grant_extra_ink_play + draw
            cinderella-dream-come-true (Set 10) — simplified stub
            clarabelle-light-on-her-hooves (Set 10) — shift keyword only

Approximate stub count: ~1,500 cards across sets 2-11 need named abilities
Numbers per set (keyword-only cards count as implemented for simulation purposes
since keywords work correctly — only named ability stubs are the real gap):
  Set 2: ~154 named ability stubs
  Set 3: ~173 named ability stubs
  Set 4: ~155 named ability stubs
  Sets 5-11: ~140-187 each
```

Strategy: implement cards on demand when needed for a specific deck analysis.
Do NOT implement all cards in set order — you may never need most of them.
When you want to sim a deck containing card X, implement X first.

Important: "keyword-only" cards (Evasive, Rush, Bodyguard, etc.) work correctly
in simulation already — the engine handles all keywords. The stub gap is only
for cards with named abilities (the italicized ability name + effect text).

Process per card:
1. Check lorcast-set-XXX.json for the card's current data
2. Read the actual card text (verify against physical card or official source)
3. Map effects to existing effect grammar (see DECISIONS.md effect grammar section)
4. If a new effect type is needed, add to types/index.ts + reducer.ts + test
5. Add tests in reducer.test.ts citing the CRD rule
6. Update CARD_ISSUES.md

#### 6b. Engine gaps (implement when first card needs it)

Known gaps from CRD_TRACKER.md, in rough priority order:

```
HIGH (multiple cards need these, blocking real deck sims):
  Locations — entire section missing (CRD 5.6, 4.6.8, 4.7)
    Characters in play move to locations for bonuses
    Locations have willpower, take damage, get banished
    Significant architecture addition — new zone or in-play type
  
  Start-of-turn triggers (CRD 3.2.1.4, 3.2.2.3)
    "At the start of your turn" abilities — many cards across sets 2+
    queueTriggersByEvent("turn_start") already scaffolded, no cards use it yet
  
  End-of-turn triggers (CRD 3.4.1.1)
    "At the end of your turn" abilities
    queueTriggersByEvent("turn_end") already scaffolded, no cards use it yet

MEDIUM (needed for specific card interactions):
  Sing Together (CRD 8.12)
    Exert characters with total cost N+ to play a song
    New alternate cost type, similar to Singer implementation
  
  Shift stack: all cards leave play together (CRD 8.10.7)
    Currently only top card moves to discard on banish
    Need to track and move the full shift stack
  
  "For free" costs (CRD 1.5.5.3, 6.1.7)
    play_for_free effect exists but cost bypass not fully implemented

LOW (edge cases, no current cards need):
  Replacement effects (CRD 6.5) — complex, needed for future sets
  Preventing effects supersede allowing effects (CRD 1.2.2)
  Put/Move damage distinction (CRD 1.9.1.2, 1.9.1.4)
  Floating/delayed triggered abilities (CRD 6.2.7.1, 6.2.7.2)
  Alert keyword (CRD 8.2) — not in sets 1-6
  Vanish keyword (CRD 8.14) — not in sets 1-6
  Boost keyword (CRD 8.4) — not in sets 1-6
```

#### 6c. Engine sustainability (do before scaling to thousands of RL games)

```
Seeded RNG (already listed as Stream 1/3e prereq)
  Replace Math.random() with seeded PRNG in 4 places
  Prerequisite for replay AND RL debugging

applyPassTurn split (CRD 3.2 / 3.4)
  Currently one monolithic function handles both end-of-turn and start-of-turn
  Draw is a start-of-turn action but lives in end-of-turn code
  Matters when start-of-turn triggers are implemented (6b above)
  Do alongside start-of-turn trigger implementation

Layer 6 tests: cross-set interaction tests
  As more sets are implemented, cards from different sets interact
  Add tests for specific cross-set interactions as they are implemented
  Pattern: reducer.test.ts, organized by interaction type not card name
```

#### 6d. What NOT to do in this stream

```
❌ Do not implement entire sets in sequence — demand-driven only
❌ Do not add new effect types without a test and CRD reference
❌ Do not change the engine public API without updating all callers
❌ Do not implement Locations until at least one real deck needs them
   (Locations are a significant architecture addition — worth a spec session first)
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

## Pending Cleanup (do after Stream 1 ships)

```
RampCindyCowBot.ts   — delete, explicitly replaced by RL
ProbabilityBot.ts    — delete after Stream 1 ships, RL replaces it
PersonalBot.ts       — delete after Stream 1 ships, RL replaces it
presets.ts           — delete with ProbabilityBot (weights only used by ProbabilityBot)
resolveBot.ts        — remove "ramp-cindy-cow", "probability", "aggro",
                       "control", "midrange", "rush" from bot name map

Keep:
RandomBot.ts         — RL trainer uses it as goldfish opponent
GreedyBot.ts         — analysis overlay uses it until Stream 3f (RL wires in)
```

---

## How to Decide What to Work On Next

Ask in order:

1. **Start Stream 1 (RL bot).**
   This is the prerequisite for meaningful analytics.
   RampCindyCowBot data is compromised — it executed your encoded strategy.
   RL data reflects discovered strategy. All Stream 2 analytics become
   trustworthy only after Stream 1 generates results.

2. **Is the RL bot trained and producing improving reward curves?**
   If yes — run cinderella sim with RLPolicy, save new results,
   then run all Stream 2 queries including opener profiling.
   If no — debug the reward signal before proceeding.

3. **Do I want to play against a real person?**
   If yes — Stream 4 (server). Stream 3's useGameSession already done ✅.

4. **Need to implement a new card for a deck you want to sim?**
   If yes — Stream 6. Check CRD_TRACKER.md for gaps, implement on demand.