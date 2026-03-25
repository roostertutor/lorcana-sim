# DECISIONS.md
# Why decisions were made. What was considered and rejected.
# For what to build: SPEC.md
# For standing Claude Code instructions: CLAUDE.md

---

## What This Project Is

Headless Lorcana TCG analytics engine. NOT a human-playable simulator.
Simulates thousands of games to produce deck analytics and win rates.

---

## Why This Direction

### The competition problem
Lorcanito, Duels.ink, and Pixelborn already cover human-playable simulation.
Building a fourth fights for the same small player pool.

### The gap
No Lorcana tool does quantitative deck analysis. MTG has had this for decades
(Frank Karsten, Moxfield, goldfish simulators). Lorcana has nothing.

### Why not pure probability math?
Hypergeometric math treats all cards as identical. A 3-cost Rush character
plays differently from a 3-cost vanilla. The engine knows what each card
does — Monte Carlo is more accurate than math for win rates and card
performance. We use pure math where it's sufficient (ink curve, hand stats)
and simulation where card specifics matter.

---

## What We Considered and Rejected

**Human-playable simulator** — pivoted away. UI complexity (pending choice,
board rendering) doesn't serve the analytics goal. Can revisit as thin
layer later once analytics is solid.

**Rule engine as open source library** — Lorcana developer ecosystem is too
small today. MTG has this after 30 years. Lorcana doesn't yet.

**Pack opening simulation** — already done by other sites. Low value add.

**Set spoiler testing** — a feature of the analytics platform, not a
standalone project. Only useful once simulator works.

---

## Architecture Decisions

### Engine is pure
No side effects. No mutation. GameState is a plain serializable object.
Makes testing trivial, multiplayer straightforward if ever needed,
replay and debugging easy. Same inputs always produce same outputs
(except shuffle randomness).

### Card abilities are data not code
Abilities are structured JSON interpreted by the engine. Adding cards
never requires changing engine code. Also means the future judge tool
can read ability data directly as a source of truth.

### Win conditions are modular
Hardcoding `lore >= 20` is wrong. Donald Duck - Musketeer changes it.
Deck exhaustion is a separate loss condition checked at end of turn.
checkWinConditions() and getLoreThreshold() scan in-play cards for
static effects that modify game rules. More conditions will be
discovered as sets are implemented.

### True invariants vs game rule assertions
The distinction matters for testing. True invariants (total cards = 60,
no card in two zones) are unconditional data integrity checks — no card
can break them. Game rule assertions (inkwell contents, lore direction,
win threshold) CAN be changed by cards and belong in integration tests,
not invariant checks.

### Four packages with strict separation
engine / simulator / analytics / ui — each has exactly one job.
Cross-concern leakage is the primary source of architectural debt.
Bot type separation (algorithm/personal/crowd) is enforced the same way:
aggregateResults() throws if called with mixed types.

### CLI before UI
Validate the entire pipeline with terminal output before building React.
Wrong numbers in the CLI means the UI won't save you.

---

## Bot Strategy Decisions

### Why weights not hardcoded personalities
Personalities are named weight vectors for the position evaluator.
Same algorithm, different priorities. Benefits:
- Tweakable without changing code
- Searchable across weight space via simulation
- Comparable results (same algorithm, different weights)
- Future ML bridge: a neural net discovers these weights via gradient
  descent instead of grid search. The BotWeights interface stays identical.

### Static vs dynamic weights
Static scalars (0-1) capture personality traits that don't change
mid-game. Dynamic functions capture how priorities shift with game state.
Urgency ramping exponentially as lore approaches 20 is closer to how
humans actually think than a fixed urgency value.

### Deck probability as first-class factor
ProbabilityBot knows exactly what's left in its deck at all times.
This improves ink selection, quest vs hold back decisions, mulligan
evaluation, and late-game mode switching. It's "perfect information
about your own deck" — not cheating, it's what skilled players do.

### Weight optimization without ML
Grid/random search over weight space using the simulation infrastructure.
Finds strong weight vectors for specific matchups. Not ML — brute force.
Essentially computational metagame analysis. The architecture is
compatible with future ML if we ever go there.

### PersonalBot / RyanBot
Any player creates a named bot by setting weights that reflect their
playstyle and adding explicit override rules for specific tendencies.
Calibrate by measuring agreement rate against real recorded decisions.
Gap between PersonalBot and OptimalBot is a quantified coaching map.
PersonalBots are type "personal" — never mixed with algorithm results.

---

## Crowdsourcing Decision

Human decision data is valuable but must be strictly separated from
algorithm bot results. They measure different things and cannot be
meaningfully aggregated.

**Why keep it at all:**
Aggregate human judgment can't be produced by any algorithm. Useful as
a benchmark for algorithm correctness and as labeled training data if
we ever go ML. The "puzzle of the day" format (show state, vote, reveal
with analysis) generates this data as a side effect of community
engagement — MTG has done this as content for decades. Making it
interactive and quantified is a genuine improvement.

**Why keep it separate:**
Unknown crowd skill distribution, selection bias, observer effect,
inconsistency across respondents. Mixing crowd data into simulation
would corrupt clean algorithm bot results.

**Guardrail: BotType enum enforced in aggregation.**

---

## Future Projects

### Judge / Rules Oracle Tool
Hybrid architecture: card implementations (engine) + RAG over rules PDF.
Simple card questions → deterministic lookup, no LLM.
Rules questions → RAG with forced citation.
Complex interactions → both sources + LLM with sources shown.
Hallucination mitigations: RAG grounding, forced citation, engine
cross-check, confidence flagging, frame as learning tool not authority.
When to build: after 50+ cards implemented. Gets better automatically
as card pool grows — compounding return on engine work.

### Sealed / Draft Simulation
Accurate pack generation + sealed deck building + analytics.
Needs accurate pull rates (community documented) and full card pool.
Dependency: working analytics engine first.

---

## Open Questions

**GreedyBot ink selection** — ProbabilityBot solves this via deckQuality.
Deferred for GreedyBot specifically.

**Weight search strategy** — grid vs random sampling vs genetic algorithm?
Deferred until optimization phase.

**Crowd skill segmentation** — self-reported vs consistency-derived?
Deferred until crowdsourcing phase.

**Replay encoding format** — JSON action sequences, exact schema TBD.

**IP / Legal** — research before going public. Disney/Ravensburger own Lorcana.

---

## Workflow

Claude.ai — strategy, architecture, tradeoffs, spec refinement.
Claude Code — implementation, tests, file editing.
Neither has memory between sessions. CLAUDE.md, SPEC.md, DECISIONS.md
are the project memory. Update them at the end of every significant session.

---

*Last updated: Session 2*
*Changes: Pivot to headless analytics. Corrected invariants (inkwell,
lore direction, win threshold). Modular win conditions. Card complexity
ladder. Bot progression: RandomBot → GreedyBot → ProbabilityBot →
weight presets → optimization. Weights as tunable vectors with static
+ dynamic components. Deck probability as first-class factor. Weight
  optimization as ML bridge. PersonalBot with calibration. Crowdsourcing
  as strictly separated labeled data track with puzzle format. Added
  CLAUDE.md as per-session standing instructions, stripped duplicates.*