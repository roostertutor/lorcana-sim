# ROADMAP.md
# Ties together all the specs. What to build, in what order, and why.
# Cross-references all docs in docs/ folder.
# Does NOT replace SPEC.md or DECISIONS.md.
#
# Last updated: Session 16 (v2 policies retrained via full pipeline; query suite re-run; Be Prepared usage dramatically improved)

---

## Where We Are

```
✅ Rule engine — Sets 1-11 imported, Set 1 fully implemented, CRD audited
✅ Simulator — RandomBot, GreedyBot, RLPolicy (deprecated bots deleted)
✅ Mulligan — shouldMulligan/performMulligan, bot-specific strategies, mulliganed in GameResult
✅ Analytics — composition, aggregation, comparison, calibration, sensitivity
✅ Query system — GameCondition language, ref/mulliganed conditions, save/load results
✅ CLI — analyze, compare, query (query accepts --policy for RL bot), learn
✅ Basic UI — 5 pages, all aligned with current direction:
           DeckInput: permanent, no changes needed
           CompositionView: permanent, no changes needed (pure math, no bots)
           SimulationView: greedy + random bots only
           ComparisonView: greedy + random bots only
           WeightExplorer: DELETED (ProbabilityBot removed)
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

## The Six Streams

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
    Card features (45d), state features, action features
    Per-card scoring: network scores each legal action individually

✅ 1b. Neural network (network.ts)
    Plain TypeScript, no external dependencies
    Actor net: (state+action → 128 → 64 → 1 score)
    Critic (value) net: (state → 64 → 32 → 1)
    Mulligan net: (state → 64 → 32 → 2)
    A2C + GAE update with gradient clipping

✅ 1c. RLPolicy (policy.ts)
    Per-card scoring: scores each legal action, softmax, pick best
    Handles all pending choice types (may, target, discard, option)
    ε-greedy exploration with seeded RNG

✅ 1d. Training loop (trainer.ts)
    trainPolicy() + trainWithCurriculum() + practice games (anti-forgetting)
    All randomness seeded — same seed → identical reward curve
    OOM fix: opponent RLPolicy history cleared after each episode

✅ 1e. CLI command (learn.ts)
    pnpm learn --deck ./deck.txt --episodes 50000 --save ./policy.json
    pnpm learn --deck ./deck.txt --curriculum --seed 42
    pnpm learn --load ./policy.json --deck ./deck.txt --episodes 10000

✅ 1f. Policy persistence
    toJSON()/fromJSON() for all networks + epsilon + RNG state
    resolveBot("rl") loads saved policy with --policy flag

✅ 1g. Training scripts
    train-mirror.ts    — self-play mirror match (✅ exists, ran successfully)
    train-tournament.ts — multi-policy round-robin (✅ exists)
    train-ladder.ts    — adversarial fine-tuning + curriculum (❌ never built — ROADMAP was wrong)
    Note: --curriculum flag in pnpm learn is silently ignored (parseArgs discards it).
    Curriculum training requires implementing train-ladder.ts or adding the flag to learn.ts.

✅ 1h. Trained policies (policies/*.json, all CARD_FEATURE_SIZE=45)
    Full pipeline retrained (Session 16, Apr 2 2026) with Singer/Song bonus baked in:
      Stage 1: npx tsx scripts/train-tournament.ts --deck ... --episodes 5000 (~1 hr)
      Stage 2: npx tsx scripts/train-ladder.ts --deck ... --episodes 5000 (~4.5 hrs)
    Current policies:
      ruby-amethyst-mirror    — self-play mirror (87%+ card win rates, session 15)
      ruby-amethyst-aggressor — tournament R1: 82% vs random, 28% vs greedy
      ruby-amethyst-midrange  — tournament R1: 96% vs random, 30% vs greedy
      ruby-amethyst-aggr-v2   — ladder R2: 99% vs random, 28% vs greedy
      ruby-amethyst-mid-v2    — ladder R2: 96% vs random, 37% vs greedy (best vs greedy)
      ruby-amethyst-control   — ladder R2: 98% vs random, 29% vs greedy; 49% round-robin (1st overall)
    5-way round-robin ranking: control (49%) > mid-v2 (48.5%) > aggressor (48%) > midrange (45%) > aggr-v2 (43.5%)

✅ 1i. Validation — query suite re-run (Session 16) with new control policy vs v1 baseline:
    Win rate vs greedy mirror: 27.2% (up from v1 24.2%)
    T3 plays: Broom 43% > Aladdin 20.3% > Friends 16.9% > Maleficent 3.4% (Aladdin up from 14.7%)
    Singer combo (Mal T3 + Friends): 1.8% (up from v1 1.3%) — marginal improvement
    Maleficent on board T4 (can sing): 13.3% (up from v1 10.8%)
    Be Prepared usage: played in 19.6% of games (up from ~1% in v1) ← Singer bonus working
    Dragon by T7: 0/1000 games — still the stubborn gap (games end before T7 vs greedy)
    Known remaining gap: Dragon/Be Prepared finishers — need longer games or harder opponent
      computeSingerStepBonuses() in trainer.ts: adds (songCost/12)*0.05 bonus when Singer sings.
      GAE at γ=0.99 propagates signal back to Singer-play turn. Working for songs, not finishers.

1j. Further validation (ongoing)
    Tests passing (autoTag, network, policy, trainer integration)
    Seeded training determinism verified

1j. Opponent modeling (future — feature engineering)
    Current state: stateToFeatures() includes opponent's live board (full card
    features per slot) — bot implicitly reacts to what it can see right now.
    Gap: once a card leaves the board (banished, inkwelled) that signal is lost.
    The bot sees "opponent has a 2/2 on T1" but not "opponent inkwelled Lilo,
    which tells me this is an aggro list."
    Enhancement: add opponent play history to state vector
      - Opponent discard zone (cards already played + removed)
      - Opponent inkwell contents (strongest signal — reveals hand archetype)
    This enables persistent matchup inference: "opponent inkwelled Lilo on T1"
    stays in the vector for the rest of the game, teaching the bot to shift
    strategy (prioritize board control vs. lore racing) based on inferred archetype.
    Cost: significant STATE_FEATURE_SIZE increase → all policies retrained from scratch.
    Prerequisite: decide on a stable feature vector size before training policies
    you want to keep long-term.
```

**Shared prerequisites with Stream 3e — DONE ✅**
```
✅ Seeded RNG — xoshiro128** implemented in GameState, seed stored in GameResult
✅ Raw GameAction[] in GameResult — actions[] stored alongside text actionLog[]
```

**Implementation notes (what was actually built vs spec):**
```
Spec called for: simple REINFORCE policy gradient, 2 networks
Built instead:   A2C + GAE (Advantage Actor-Critic), 3 networks:
                   actor net: (state+action → 128 → 64 → 1 score)
                   critic net: (state → 64 → 32 → 1 value)
                   mulligan net: (state → 64 → 32 → 2)
                 Gradient clipping, practice games (anti-forgetting)
                 RewardWeights: auto-inferred deck archetype from card data
                   (6 scalars: winWeight, loreGain, loreDenial, banishValue,
                    inkEfficiency, tradeQuality — computed before training, fixed)
                 Training scripts: mirror, tournament, ladder
                 CARD_FEATURE_SIZE = 45 (spec said 43)

A2C+GAE was the right call: more stable than REINFORCE for card games
RewardWeights was not in the spec but solves the reward design problem
elegantly — deck archetype inferred automatically, no human labeling
```

---

### Stream 2: Analytics — Generator Not Tester
*Specs: docs/ANALYTICS_PHILOSOPHY.md, docs/ADVANCED_ANALYTICS.md, docs/GOLDFISH_SIM.md*
*Goal: queries that discover things, not just confirm what you believe*

Current query system is a hypothesis tester. Stream 2 adds the infrastructure
for discovery. See ANALYTICS_PHILOSOPHY.md for the full philosophy.

```
✅ 2a. Opener profiling queries (ruby-amethyst deck, 1000 games, RL control policy vs greedy)
    queries/ruby-amethyst-sim.json + queries/ruby-amethyst-turn3-questions.json
    Key finding: Magic Broom is the most common T3 play (40.7%), not Friends (18.1%).
    Maleficent - Sorceress played T3 = only 2.5% — bot misses the Singer/Song line.
    Friends played T3 = 18.1%, win rate +5.5%. Maleficent T3 = -4.3% (sample too small).

✅ 2b. Mulligan sweep (re-run with RL policy, 1000 games)
    queries/ruby-amethyst-2b-mulligan.json vs saved results
    Key finding: bot NEVER mulligans (0.3% of games, 3/1000).
    Dead opener (kept hand, no T3 play) = 34.4% of games, -8.5% win rate.
    Getting to 8+ lore by T5 = +51.4% win rate (lore acceleration critical).
    Root cause: RLPolicy uses its own learned mulliganNet (not DEFAULT_MULLIGAN).
    Fix is training, not threshold tuning — mulliganNet needs more episodes
    where keeping bad hands gets punished. DEFAULT_MULLIGAN only affects GreedyBot.

✅ 2c. Slot analysis (re-run with RL policy, 1000 games)
    queries/ruby-amethyst-2c-slot.json vs saved results
    Key findings:
      Maleficent - Sorceress never played = 41.9% of games (being inked heavily)
      Heroic Outlaw   never played = 87.6% of games (5-drop rarely hits board)
      Monstrous Dragon never played = 97.1% of games (7-drop almost never played)
      Be Prepared      never played = 76.2% of games (7-drop rarely played)
      Dragon Fire: when played, win rate LOWER than when not played — removal
        correlates with being in a losing position, not causing wins
      Maui: same anti-correlation — played when behind, not when winning
    High-curve cards (5+) are largely dead weight in the RL policy's game plan.
    Games end before 7-drops become relevant.

✅ 2d. Card comparison (re-run with RL policy, 1000 games)
    queries/ruby-amethyst-2d-compare.json vs saved results
    Key findings:
      3-drop ranking by T3 frequency: Broom (40.7%) > Friends (18.1%) > Aladdin (14.7%) > Maleficent (2.5%)
      Singer combo (Maleficent T3 + Friends any turn) = 1.3% of games — almost never fires
      Maleficent on board T4 (can sing) = 10.8%, +6.1% win rate — strongest 3-drop metric
      Finishers almost never played by T7: Dragon 0/1000 games, Be Prepared 11/1000
      In 75% of games, deck wins WITHOUT playing either finisher

✅ 2e. Matchup analysis (1000 games each, RL ruby-amethyst vs greedy opponents)
    ruby-amethyst vs cinderella:  64.6% win rate (strong favorite)
    ruby-amethyst vs goldfish:    97.8% win rate (expected — opponent does nothing)
    ruby-amethyst mirror (RL vs greedy, same deck): 24.2% win rate
      Surprising: RL policy loses the mirror badly to GreedyBot. GreedyBot's
      quest-first heuristic is well-matched to this deck. RL policy 52.3% round-robin
      was vs diverse opponents; 1v1 mirror favors the simpler, faster greedy strategy.

✅ 2f. Wire RL bot into query pipeline
    --policy flag added to query CLI and SimFile config
    resolveBot("rl", policyPath) loads policy JSON, sets epsilon=0 (pure exploitation)
    CLI flag overrides sim file policy field; sim file paths resolve relative to sim dir
    pnpm query --sim sim.json --questions q.json --policy ./policies/control.json
    All query results now reflect competent play, not heuristics

2g. Automated slot optimization (after Stream 1 + 2f complete)
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

2h. Query UI tab (packages/ui/src/pages/QueryView.tsx)
    UI wrapper around the CLI query system
    Paste or build a questions JSON in the browser
    Run simulation or load saved results file
    Results rendered as a table — not raw terminal output
    No new backend logic — wraps existing queryResults() function
    Replaces the need to use the CLI for day-to-day query work
```

**Note on 2a:** No code needed — the queries are ready. But first:
1. Train an RL policy for the deck: `pnpm learn --deck ./deck.txt --episodes 50000 --save ./policies/deck.json`
2. Update the sim config to use `"bot": "rl"` + `"policy": "..."` (or use `--policy` CLI flag)
3. Run `pnpm query --sim sim.json --questions questions.json --policy ./policies/deck.json --save results.json`
   Do NOT re-use old RampCindyCowBot or GreedyBot results — those reflect encoded strategy, not discovered play.

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

    Phase 2 — NOW UNBLOCKED (Stream 1 done, implement via 3f below):
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

    Prerequisites — BOTH DONE ✅:
      ✅ Seeded RNG — xoshiro128** in GameState, seed stored in GameResult
      ✅ GameAction[] capture — actions[] stored alongside text actionLog[] in GameResult
      3e is fully unblocked. Remaining work is the UI only.

    NOTE: Replaying one game does NOT help RL learn. RL needs thousands
    of full games — volume produces signal, not single-game analysis.
    Replay is for human understanding; "what if" is for human exploration.
    Neither is a training mechanism.

3f. Wire in RL bot analysis — NOW UNBLOCKED (Stream 1 done)
    Replace GreedyBot analysis with RLPolicy analysis
    Win probability now reflects competent play
    Requires --policy path in useAnalysis / GameBoard bot config
```

**Claude Code session prompt (3a-3d done — next is 3e or 3f):**
```
For 3f (wire RL into analysis overlay):
  Read docs/RL.md policy persistence section.
  Replace GreedyBot in useAnalysis.ts with RLPolicy loaded from --policy path.
  Add policy path config to GameBoard / useGameSession.
  Label win probability as "RL estimate" instead of "GreedyBot estimate".

For 3e (replay mode):
  Read docs/GAME_BOARD.md replay section.
  Prereqs done: seeded RNG in GameState, GameAction[] in GameResult.
  Build ReplayControls component + loadReplay() in useGameSession.
  Reconstruct GameState at each step by replaying actions[] from seed via applyAction.
  Feed reconstructed states to GameBoard read-only (disable action buttons).
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
Stream 1 (RL) ✅ done
  ↓ unlocked
✅ Stream 2f (RL in query pipeline) — done
Stream 3f (RL in analysis overlay) — unblocked, not yet built
Stream 3e (Replay UI) — unblocked (prereqs done), not yet built

Stream 3e-prereqs ✅ both done (seeded RNG + GameAction[] capture)

Stream 3a (useGameSession) ✅ done — prerequisite for
Stream 4d (multiplayer mode in useGameSession)

Stream 1 (RL) + Stream 4 (multiplayer) — both prerequisites for
Stream 5 (clone bot + coaching map)

Stream 2a-2e — unblocked, train an RL policy for the deck first
  Do NOT use old RampCindyCowBot/GreedyBot results — data is biased

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

#### 6c. Engine sustainability (ongoing)

```
✅ Seeded RNG — done (xoshiro128** in GameState)

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

## Pending Cleanup — DONE ✅

```
DELETED:
  RampCindyCowBot.ts   — replaced by RL
  ProbabilityBot.ts    — replaced by RL
  PersonalBot.ts       — replaced by RL
  presets.ts           — weights only used by ProbabilityBot
  WeightExplorer.tsx   — UI for ProbabilityBot weights, no longer useful
  optimizer.ts         — replaced by RL slot optimization (future Stream 2g)
  optimize.ts (CLI)    — removed, pnpm optimize command gone
  sweep.ts (CLI)       — removed, pnpm sweep command gone

UPDATED:
  resolveBot.ts        — random/greedy/rl only
  SimulationView.tsx   — greedy + random bots only
  ComparisonView.tsx   — greedy + random bots only
  TestBench.tsx        — greedy + random bots only
  GameBoard.tsx        — greedy + random bots only
  useAnalysis.ts       — MidrangeWeights inlined as EVAL_WEIGHTS (local const)
  GreedyBot.ts         — MidrangeWeights inlined as GREEDY_WEIGHTS (local const)
  simulator index.ts   — removed all deprecated exports
  App.tsx              — WeightExplorer tab removed
  bot.test.ts          — ProbabilityBot/presets removed, TEST_WEIGHTS inlined

KEPT:
  RandomBot.ts         — RL trainer uses it as goldfish opponent
  GreedyBot.ts         — analysis overlay uses it until 3f ships
```

---

## How to Decide What to Work On Next

Ask in order:

1. **Stream 1 (RL bot) — infrastructure done ✅, v2 policies in training**
   Singer/Song reward shaping added — retrain from scratch:
   pnpm learn --deck ./decks/set-001-ruby-amethyst-deck.txt \
     --curriculum --episodes 50000 --save ./policies/ruby-amethyst-v2.json
   After training, validate with 2d queries (Maleficent T3 rate, Singer combo rate).
   Known remaining gap: finishers (Dragon/Be Prepared) — games end before T7.

2. **Streams 2a-2f are done. ✅ Key findings for ruby-amethyst deck:**
   - Bot never mulligans — RLPolicy mulliganNet is undertrained, fix is more training
   - High-curve cards (5-7 cost) almost never played in RL game plan
   - Singer/Song combo (Maleficent → free Friends) fires in only 1.3% of games
   - RL policy loses the mirror to GreedyBot — quest-first heuristic suits this deck
   - 64.6% win rate vs cinderella, 97.8% vs goldfish
   Next: train a better policy that learns the Singer/Song line (needs harder opponent),
   or move to 2g (slot optimization) to answer "what should I cut?"

3. **Want better analysis overlay on the game board?**
   Stream 3f — wire RL policy into win probability (unblocked, small change).
   Stream 3e — replay mode (unblocked, prereqs done, UI only remaining).

4. **Do I want to play against a real person?**
   If yes — Stream 4 (server). Stream 3's useGameSession already done ✅.

5. **Need to implement a new card for a deck you want to sim?**
   If yes — Stream 6. Check CRD_TRACKER.md for gaps, implement on demand.