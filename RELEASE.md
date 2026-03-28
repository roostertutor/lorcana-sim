# v1.0.0 — Complete Set 1 Engine + Analytics Platform

**Tagged: Session 9 (March 28, 2026)**

---

## What This Is

A headless Lorcana TCG analytics engine that simulates thousands of games
to produce deck analytics and win rates. Not a human-playable simulator.

---

## Engine

- **204 unique cards, 216 entries** — full Set 1, all abilities implemented, 0 stubs
- **Sets 2-11 imported** as keyword-only stubs (2504 total cards incl. dual-ink)
- **CRD v2.0.1 audited** — every implemented rule mapped to CRD rule number
- **193 tests passing** (163 engine + 15 simulator + 15 analytics), 1 todo

### Rules Implemented
- All turn actions: ink, play card, quest, challenge, activate ability, pass turn
- All Set 1 keywords: Bodyguard, Challenger, Evasive, Reckless, Resist, Rush, Shift, Singer, Support, Ward
- Triggered abilities with condition evaluation (12 condition types)
- Activated abilities with exert/ink costs
- Static abilities (8 types): grant_keyword, modify_stat, modify_stat_per_count, cant_be_challenged, cost_reduction, action_restriction, extra_ink_play, self_cost_reduction
- Conditional statics via `evaluateCondition()`
- Floating triggered abilities (created by effects, cleared at end of turn)
- Timed effects with 3 duration types (end_of_turn, rest_of_turn, end_of_owner_next_turn)
- Sequential effects ([A] to [B] cost-before-reward)
- "For each" effects with `lastEffectResult`
- Action restrictions (quest/challenge/ready/play/sing)
- Extra ink plays (Belle - Strange But Special)
- Dual-ink cards (`inkColors: InkColor[]`)
- Shift (inherits exerted/drying/damage state)
- Singing (Singer keyword, alternate cost)
- Mulligan (Partial Paris)

### Not Implemented (Set 1 scope)
- Locations (no Set 1 locations exist)
- Replacement effects (CRD 6.5)
- Delayed triggered abilities (CRD 6.2.7.2)
- "For free" play (CRD 1.5.5.3)
- Shift stack: all cards leave play together (CRD 8.10.7)
- Classification Shift / Universal Shift (no Set 1 cards)

---

## Simulator

- **5 bot strategies**: RandomBot, GreedyBot, ProbabilityBot, PersonalBot, RampCindyCowBot
- **Bot-specific mulligan** via `shouldMulligan()` / `performMulligan()` on BotStrategy
- **Choice resolution** for triggered/activated abilities (random target selection)
- **Evaluator-based** action selection (GreedyBot, ProbabilityBot)
- **Optimizer** for weight tuning across bot parameters
- **Layer 3 invariants** verified across 1000 RandomBot games
- **Layer 5 bot tests** — 12 tests for decision quality

---

## Analytics

- **Composition analysis** — curve, ink ratio, card type distribution
- **Aggregation** — win rate, lore/turn, games played, consistency stats
- **Comparison** — head-to-head deck matchups with confidence intervals
- **Calibration** — verify simulation accuracy against expected distributions
- **Sensitivity analysis** — parameter sweep for weight optimization
- **Query system** — GameCondition language for filtering simulation results

---

## CLI

```bash
pnpm analyze --deck ./deck.txt           # full deck analysis
pnpm compare --deck1 ./a.txt --deck2 ./b.txt  # head-to-head
pnpm optimize --deck ./deck.txt          # weight optimization
pnpm sweep --deck ./deck.txt             # parameter sweep
pnpm import-cards --sets 1-11            # fetch from Lorcast API
```

---

## UI

5 screens, React + Vite at `localhost:5173`:
- Deck input (paste deck list)
- Composition view (curve, ink, types)
- Simulation runner
- Comparison view
- Weight explorer

---

## What's Next (not in this release)

- **Stream 1: RL Bot** — neural network that discovers how to play (docs/RL.md)
- **Stream 3: Game Board** — interactive TestBench for card testing (docs/GAME_BOARD.md)
- **Stream 2: Analytics** — discovery queries powered by RL data
- **Stream 4: Multiplayer** — server for real opponent play
