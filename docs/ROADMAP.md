# ROADMAP.md
# Sequenced product plan — what to build, in what order, and why.
# Cross-references all docs in docs/ folder.
# Does NOT replace SPEC.md, DECISIONS.md, STRATEGY.md.
#
# Last updated: 2026-04-14 (nav consistency + saved decks).
# Last cross-ref refresh: 2026-04-25 (added BACKLOG.md companion).
#
# Companion docs:
#   docs/STRATEGY.md  — product strategy / positioning / wedge claims
#   docs/HANDOFF.md   — active cross-agent work queue (open items only)
#   docs/BACKLOG.md   — parked design decisions with trigger conditions
#   docs/SPEC.md      — type/API specs
#   docs/DECISIONS.md — locked architecture decisions and rationale

---

## Where We Are

```
✅ Rule engine — Sets 1-11 + promos fully implemented, CRD v2.0.1 audited against PDF
✅ Simulator — RandomBot, GreedyBot, RLPolicy (deprecated bots deleted)
✅ Mulligan — engine-level partial mulligan CRD 2.2.2
✅ Analytics — composition, aggregation, comparison, calibration, sensitivity
✅ Query system — GameCondition language, ref/mulliganed conditions, save/load results
✅ CLI — analyze, compare, query, learn
✅ Basic UI — 5 pages (DeckInput, CompositionView, SimulationView, ComparisonView)
✅ Engine tests — 424+ passing (engine) + 46 simulator + 15 analytics = 485+ total
✅ Layer 3 invariants — 1000 RandomBot games, under-zone counted per CRD 5.1.1.5
✅ Cards — 2652/2652 (100%), 0 stubs, 0 partial, 0 invalid fields, 0 approximations
✅ All keywords — Rush, Evasive, Ward, Resist, Bodyguard, Challenger, Reckless, Singer,
           Sing Together, Support, Alert, Boost, Vanish, Shift (normal + Classification + Universal)
✅ CRD compliance — full PDF cross-reference done. Only CRD 6.5 (general replacement effects) unimplemented.
✅ CRD 1.8 game state check — runGameStateCheck (cascade, damage≥willpower + lore)
✅ CRD 4.6 challenge split — Declaration step (triggers resolve) → Damage step (strength calculated after)
✅ CRD 1.9.1 damage taxonomy — deal/put/move/remove/take all properly distinguished
✅ Floating triggers — CRD 6.2.7.1
✅ Delayed triggers — CRD 6.2.7.2 (Candy Drift pattern)
✅ Global timed effects — CRD 6.4.2.1 (Restoring Atlantis pattern)
✅ choose_amount — isUpTo picker for remove/move damage
✅ choose (A or B) — CRD 6.1.5.2 feasibility filtering
✅ Sandbox — full interactive game board with all mechanic visualizations
✅ Seeded RNG + Replay mode + RL training loop
✅ Codebase consistency audit — field names standardized, duplicate types removed,
           story names verified against Lorcast, importer text-fallback for missing keywords

✅ Multiplayer server — Hono + Supabase, anti-cheat state filtering, ELO, reconnection,
           URL routing, shareable lobby links. See docs/MULTIPLAYER.md.
           Remaining: deployment (Railway), token refresh, OAuth, game history/polish.

❌ Smart choice resolution — bots still pick random targets
❌ CRD 6.5 — general replacement effect system (only damage_redirect exists)
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
    train-ladder.ts    — adversarial fine-tuning + practice games (✅ built, Stage 2 of full pipeline, ~4.5 hrs)
    Note: --curriculum flag in pnpm learn is silently ignored (parseArgs discards it); use train-ladder.ts directly.

❌ 1i. Supervised learning from human replays
    Replays saved to Supabase via Stream 3e (seed + decks + actions + winner)
    Players opt-in: "Share for bot training" checkbox at game end
    Training pipeline: extract (GameState, action) pairs → behavioral cloning pass
    Bootstraps RL policy before self-play fine-tuning
    Prerequisite: Stream 4 replays table (client-side saveReplay() already built in serverApi.ts)
    Human games provide quality signal self-play alone cannot produce

✅ 1h. Trained policies (policies/*.json, all CARD_FEATURE_SIZE=45)
    Full pipeline: ~6.5 hrs total wall time (confirmed Apr 3 2026)
      Stage 1: npx tsx scripts/train-tournament.ts --deck ... --episodes 5000 (~1 hr)
      Stage 2: npx tsx scripts/train-ladder.ts --deck ... --episodes 5000 (~4.5 hrs)
    Network architecture (confirmed from saved JSON):
      actionNet:   inputSize=1282, h1=128, h2=64, out=1
      mulliganNet: inputSize=1184, h1=64,  h2=32, out=2
      valueNet:    inputSize=1184
    Ruby-amethyst policies (Session 16):
      ruby-amethyst-mirror    — self-play mirror (87%+ card win rates, session 15)
      ruby-amethyst-aggressor — ladder R2: 99% vs random, 28% vs greedy
      ruby-amethyst-midrange  — ladder R2: 96% vs random, 37% vs greedy
      ruby-amethyst-control   — ladder R2: 98% vs random, 29% vs greedy; 49% round-robin (1st overall)
    Amber-steel policies (Session 17, Apr 3 2026):
      amber-steel-aggressor   — ladder R2: 97% vs random, 80% vs greedy
      amber-steel-midrange    — ladder R2: 99% vs random, 78% vs greedy
      amber-steel-control     — ladder R2: 100% vs random, 81% vs greedy (best performer)
    Note: card usage display in train-ladder.ts shows ruby-amethyst cards regardless of deck — display bug, doesn't affect training

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

✅ 1i. Validation — amber-steel query suite (Session 17, Apr 3 2026):
    Win rate vs greedy mirror: 77.4% (much better than ruby-amethyst 27.2%)
    Stitch shift line (New Dog early + Rock Star): 12.6% of games, +20.4% win rate — strongest signal
    A Whole New World: anti-correlates with winning (played 29.5% of games, -22.3% win rate)
      → played defensively when losing, not as a proactive finisher
    Lantern + New Dog T2 line: never fired (0/1000 T3 shifts) — RL misses multi-turn setup
    Songs overall: -8.9% win rate — correlate with losing, not winning

❌ 1j. RL multi-turn planning — ARCHITECTURAL CEILING REACHED
    A2C+GAE cannot learn multi-turn sequencing (hold New Dog T1 → Lantern T2 → shift T3).
    Credit assignment chain too long for per-step TD. More episodes/reward shaping won't fix.
    Decision: accept RL as "good enough baseline", pivot to multiplayer + supervised learning.
    See DECISIONS.md "RL Ceiling and Strategic Pivot" for full analysis and proposed direction.

1k. Opponent modeling (future — feature engineering)
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
    sims/set-001-ruby-amethyst/sim.json + sims/set-001-ruby-amethyst/turn3-questions.json
    Key finding: Magic Broom is the most common T3 play (40.7%), not Friends (18.1%).
    Maleficent - Sorceress played T3 = only 2.5% — bot misses the Singer/Song line.
    Friends played T3 = 18.1%, win rate +5.5%. Maleficent T3 = -4.3% (sample too small).

✅ 2b. Mulligan sweep (re-run with RL policy, 1000 games)
    sims/set-001-ruby-amethyst/mulligan-questions.json vs saved results
    Key finding: bot NEVER mulligans (0.3% of games, 3/1000).
    Dead opener (kept hand, no T3 play) = 34.4% of games, -8.5% win rate.
    Getting to 8+ lore by T5 = +51.4% win rate (lore acceleration critical).
    Root cause: RLPolicy uses its own learned mulliganNet (not DEFAULT_MULLIGAN).
    Fix is training, not threshold tuning — mulliganNet needs more episodes
    where keeping bad hands gets punished. DEFAULT_MULLIGAN only affects GreedyBot.

✅ 2c. Slot analysis (re-run with RL policy, 1000 games)
    sims/set-001-ruby-amethyst/slot-questions.json vs saved results
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
    sims/set-001-ruby-amethyst/compare-questions.json vs saved results
    Key findings:
      3-drop ranking by T3 frequency: Broom (40.7%) > Friends (18.1%) > Aladdin (14.7%) > Maleficent (2.5%)
      Singer combo (Maleficent T3 + Friends any turn) = 1.3% of games — almost never fires
      Maleficent on board T4 (can sing) = 10.8%, +6.1% win rate — strongest 3-drop metric
      Finishers almost never played by T7: Dragon 0/1000 games, Be Prepared 11/1000
      In 75% of games, deck wins WITHOUT playing either finisher

✅ 2e. Matchup analysis (1000 games each, RL ruby-amethyst vs greedy opponents)
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

**Note on 2a–2e:** All done. Results are in `sims/set-001-ruby-amethyst/` and `sims/set-001-amber-steel/`. See DECISIONS.md "RL Ceiling and Strategic Pivot (Session 17)" for full analysis of findings and why RL training is now paused.

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

    Phase 2 — DONE ✅ (Stream 3f, Session 17):
      File picker → RLPolicy loaded → win probability uses RL policy
      Label shows "RL est." when policy loaded, "GreedyBot est." otherwise

✅ 3g. GameBoard UX improvements (Session 18–19)
    Card-contextual action buttons — per-card Play/Quest/Challenge/Shift/Ink/Activate
      (replaced flat "Actions" list)
    2-step challenge flow: click Challenge → attacker highlighted → click target
    2-step shift flow: click Shift → hand card highlighted → click play target
    Duplicate card disambiguation: "(1)"/"(2)" badge in choice buttons + board overlay
    Effect log messages: "Removed N damage from X" / "Drew N card(s)" after triggers
    "Opponent is thinking..." (was "Bot is thinking...")
    Engine mulligan (CRD 2.2.2) surfaced as choose_mulligan choice in GameBoard

✅ 3h. GameBoard DnD + choice modal (Session 20)
    Drag & drop via @dnd-kit/core — coexists with click-to-select
      Hand card → play zone = PLAY_CARD
      Hand card → inkwell (header area) = PLAY_INK; blue ring feedback
      Hand card → own character in play = shift (PLAY_CARD + shiftTargetInstanceId)
      Own ready character → exerted opponent = CHALLENGE
      All dispatches validated against legalActions — silent no-op if invalid
      PointerSensor (distance: 8px) + TouchSensor (delay: 150ms) for mobile coexistence
      DragOverlay: floating card copy follows cursor/finger (80% opacity, scale+rotate)
      Drop zones: green pulse when valid drag active, dim when invalid, bright ring on hover
    PendingChoiceModal — replaces inline renderPendingChoice()
      Desktop: centered dark panel (max-w-lg)
      Mobile: bottom sheet with drag handle
      choose_may / optional choices: backdrop click auto-declines/skips
      Required choices (mulligan, target): backdrop click is no-op
      Opponent "thinking..." stays as inline banner, not a modal
    buildLabelMap extracted to utils/buildLabelMap.ts (parameterized getName)
    New files: useBoardDnd.ts, PendingChoiceModal.tsx, utils/buildLabelMap.ts

3c/3d status: functional and reasonably presentable. Missing for a complete UI:
    Animations (play/banish/quest/challenge transitions), sound,
    hover tooltips with rules text, smooth exert/ready animations.

✅ 3e. Replay mode + undo (Session 21)

    ✅ 3e-i. Visual replay (read-only scrubbing)
      ReplayControls component: prev/next/scrub slider, play/pause, 3 speeds
      useReplaySession hook: reconstructs GameState at each step from seed + actions[]
      "Review Game" button in game-over overlay → switches GameBoard to replay state
      Load Replay button: upload .json file → replay instantly

    ✅ 3e-ii. "What if" — human takeover (SC2-style resume from replay)
      "Take over here" button in ReplayControls
      Injects replay state as live game state via patchState()
      Human takes over P1 from that board position

    ✅ 3e-iii. "What if" — automated branch analysis
      "Branch analysis" button in ReplayControls (wired to onBranchAnalysis callback)
      Already works via useAnalysis + runSimulation({ startingState })

    ✅ 3e-iv. Undo (mid-game)
      useGameSession tracks seed + initialState snapshot + actionHistory[]
      undo() replays N-1 actions from initial snapshot
      Undo button in scoreboard — only visible on your turn, live mode only

    ✅ 3e-v. Replay persistence
      Download Replay button → saves replay_TIMESTAMP.json (seed + decks + actions)
      saveReplay() in serverApi.ts — POST /replay when authenticated (Stream 4 wires server end)
      Replays are self-contained: seed + p1Deck + p2Deck + actions[] → deterministic reconstruction

✅ 3f. Wire in RL bot analysis (Session 17, Apr 3 2026)
    File upload button in GameBoard + TestBench → RLPolicy.fromJSON() → epsilon=0
    useAnalysis accepts optional botStrategy param (default GreedyBot)
    AnalysisPanel shows "RL est." vs "GreedyBot est." based on usingRL flag
```

**Claude Code session prompt (3a-3d + 3f done — next is 3e):**
```
For 3e (replay mode):
  Read docs/GAME_BOARD.md replay section.
  Prereqs done: seeded RNG in GameState, GameAction[] in GameResult.
  Build ReplayControls component + loadReplay() in useGameSession.
  Reconstruct GameState at each step by replaying actions[] from seed via applyAction.
  Feed reconstructed states to GameBoard read-only (disable action buttons).
  Show what the bot chose at each step + win probability before/after.
```

---

### Stream 4: Multiplayer Server
*Spec: docs/MULTIPLAYER.md (phased delivery plan), server/SERVER.md (architecture)*
*Goal: play against a real opponent, zero chance of cheating*

```
✅ 4a. Supabase setup
    Database schema (profiles, lobbies, games, game_actions tables)
    Row Level Security policies — players see only their games
    Auth: email/password via Supabase (Google/Discord OAuth optional, not wired yet)
    REPLICA IDENTITY FULL on games table for Realtime broadcasts

✅ 4b. Hono server
    POST /game/:id/action — validates turn, runs applyAction, saves, broadcasts
    POST /game/:id/resign — forfeit, updates ELO
    GET /game/:id — reconnect (returns FILTERED state — anti-cheat)
    POST /lobby/create — generate 6-char code (rejects if user has active game)
    POST /lobby/join — join by code, creates game (rejects if user has active game)
    GET /lobby/:id, GET /lobby/ — lobby status + list
    GET /auth/me, POST /auth/profile — profile management
    ELO: K=32, updated on game completion + resignation

✅ 4c. Supabase Realtime + Anti-Cheat
    Server writes to games table → Supabase Realtime fires postgres_changes
    Client uses fetch-on-notify pattern — ignores raw payload (contains full
    unfiltered state), fetches filtered state from GET /game/:id instead
    stateFilter.ts strips opponent hand, deck, and face-down cards

✅ 4d. Multiplayer mode in useGameSession
    Local-first dispatch: applyAction() locally for instant UI, sendAction() to
    server in background. Error recovery: re-syncs from server on failure.
    Realtime subscription for opponent actions.

✅ 4e. Lobby UI + URL Routing
    MultiplayerLobby.tsx: email/password auth, deck input, create/join lobby
    react-router-dom: /, /simulate, /sandbox, /multiplayer, /lobby/:code,
      /game/:gameId, /solo
    Shareable lobby links: /lobby/ABC123 pre-fills join code
    Reconnection: localStorage persistence, auto-redirect to active game
    Duplicate game guard: server rejects if user has active game

✅ 4f. Token auto-refresh — serverApi reads fresh token from supabase session
✅ 4g. Connection status indicator — green/red dot in scoreboard
✅ 4h. Resign flow — updates GameState, correct Victory/Defeat per player,
      "Back to Lobby" button, lobby cleanup on new create

✅ 4i. ELO display — per-format ratings (bo1/bo3 × core/infinity) in lobby
✅ 4j. Game history — recent games in lobby (W/L, opponent, ELO, date)
✅ 4k. Bo1/Bo3 match format — auto-creates next game, ELO per match
✅ 4l. Core/Infinity game format — separate ELO buckets per format
✅ 4m. Game actions endpoint — GET /game/:id/actions for replay reconstruction

❌ 4n. Deploy to Railway + static host (only remaining blocker for remote play)
❌ 4o. OAuth buttons (Google/Discord — optional, email/password works)
❌ 4p. Replay viewer for multiplayer games (endpoint ready, UI not wired)
❌ 4q. Server integration tests
```

**Full phased spec**: See `docs/MULTIPLAYER.md` for detailed iteration plan,
acceptance criteria, infrastructure costs, and open questions.

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
✅ Stream 4a-4e (multiplayer) — done (server, anti-cheat, lobby, routing, reconnection)
   Remaining: deploy (4f), token refresh (4g), OAuth (4h), polish (4j)

Stream 1 (RL) + Stream 4 (multiplayer) — both prerequisites for
Stream 5 (clone bot + coaching map) — Stream 4 core done, Stream 5 unblocked
  once multiplayer is deployed and generating game logs

Stream 2a-2e — ✅ done (ruby-amethyst + amber-steel queries complete, policies trained)

Everything else — parallel, no blocking dependencies
```

---

### Stream 6: Engine Stewardship + Card Implementation ✅ DONE

*Spec: docs/CRD_TRACKER.md, docs/CARD_ISSUES.md*

#### 6a. Card implementation ✅

**2146/2146 named-ability cards + 506 vanillas = 2652/2652 (100%) complete.**
All sets 1–11 + promos (P1, P2, P3, cp, DIS, D23) fully implemented.
0 stubs, 0 partial, 0 invalid fields, 0 known approximations.
Four audit scripts (`card-status`, `audit-lorcast`, `audit-approximations`,
`decompile-cards`) all report clean.

#### 6b. Engine gaps ✅

All previously listed gaps are implemented:
- ✅ Locations (CRD 5.6, 4.6.8, 4.7) — full support
- ✅ Start-of-turn / end-of-turn triggers
- ✅ Sing Together (CRD 8.12)
- ✅ Shift stack (CRD 8.10.7)
- ✅ Play for free costs (CRD 1.5.5.3, 6.1.7)
- ✅ Alert, Vanish, Boost keywords
- ✅ Floating/delayed triggered abilities
- ✅ Put/Move damage distinction

Only CRD 6.5 (replacement effects) remains unimplemented — no current cards require it.

#### 6c. Engine sustainability ✅

- ✅ Seeded RNG (xoshiro128**)
- ✅ applyPassTurn split — start/end of turn separated
- ✅ Cross-set interaction tests — 424 engine tests across 13 test files
- ✅ `runGameStateCheck` replaces inline banish checks (CRD 1.8)

#### 6d. Ongoing stewardship

Engine is in maintenance mode. New work limited to:
- Bug fixes surfaced by sandbox / multiplayer testing
- Interactive mode improvements (`card_revealed`, pending choice UX)
- Future set imports when released

---

## Decks Page Direction

*Decision revised 2026-04-14: row-based deckbuilder is primary, paste is a bulk-import pathway.*

**Rationale:**
- Structured row view prevents parse errors — every row maps to a real card (no typos)
- Qty as a number with +/- controls is more natural than editing a text prefix
- Visual — each row can show cost/ink/type at a glance
- Still preserves paste workflow from Dreamborn/Inkdecks via an Import action
- Storage format stays the same (`decklist_text` in Supabase) — we just parse on load, serialize on save
- App value prop is analytics + multiplayer, not deckbuilding — so the builder stays focused (no archetype suggestions, no mana curve warnings, no public sharing)

**Current state ✅ (2026-04-14):**
- Saved decks in Supabase (one per user per name), CRUD via `lib/deckApi.ts`
- DecksPage: signed-out paste+analyze; signed-in deck list + textarea editor + composition view
- MultiplayerLobby: deck picker with Saved Decks / Paste toggle

**In progress (2026-04-14):**
- Row-based deckbuilder replacing textarea in DecksPage
  - Each card is a row: name, cost, ink, qty +/-, remove
  - "Add card" search with autocomplete (can only pick real cards)
  - Import from paste (bulk) + Export to paste (share)

**Progression (do on demand, not upfront):**
```
1. Row-based builder with autocomplete add — IN PROGRESS
2. Inline card preview on hover (hover row → show image)
3. Set legality validation (core vs infinity)
4. Card filtering in the add search (by ink, cost, type)
```

**Explicitly NOT building (yet):**
- Ink curve / card type visual breakdowns beyond existing CompositionView
- Deckbuilder-specific tools (mana curve warnings, archetype suggestions)
- Deck sharing via public URL (private-only for now)
- Deck import from external URLs (Dreamborn/Inkdecks API)

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

1. **Stream 1 (RL bot) — DONE. Ceiling reached. Do not retrain.**
   Ruby-amethyst control: 27.2% vs greedy. Amber-steel control: 77.4% vs greedy.
   RL cannot learn multi-turn planning (credit assignment limit). Accepted as baseline.
   Next direction: Stream 4 (multiplayer) → ranked games → supervised clone trainer (Stream 5).
   See DECISIONS.md "RL Ceiling and Strategic Pivot".

2. **Streams 2a-2f are done. ✅ Key findings:**
   Ruby-amethyst: bot never mulligans, high-curve cards largely dead weight,
   Singer/Song combo fires 1.3% of games, loses mirror to GreedyBot 27.2%.
   Amber-steel: Stitch shift line +20.4% win rate, songs anti-correlate with winning,
   Lantern+NewDog T2 line never fired (RL multi-turn ceiling).
   Do NOT retrain — RL ceiling reached, more episodes won't fix multi-turn planning.
   Next: Stream 4 (multiplayer) → human game logs → Stream 5 (supervised clone trainer).
   Or: 2g (slot optimization) if you want decklist advice now from existing policies.

3. **Want to watch RL games or explore "what if" positions?**
   Stream 3e — replay mode (unblocked, prereqs done, UI only remaining).
   Stream 3f — done ✅ (RL policy upload in GameBoard/TestBench, Session 17).

4. **Stream 4 (multiplayer) — CORE DONE. Deploy remaining.**
   Server, anti-cheat, lobby, routing, reconnection all working on localhost.
   Remaining: deploy to Railway (~$5/mo), token refresh, OAuth (optional), polish.
   See docs/MULTIPLAYER.md for the full phased plan.

5. **Need to fix a card bug or add interactive-mode support?**
   Stream 6 (maintenance). All 2652 cards are implemented — work is bug fixes only.