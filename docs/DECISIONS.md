# DECISIONS.md
# Why decisions were made. What was considered and rejected.
# For what to build: docs/SPEC.md
# For standing Claude Code instructions: CLAUDE.md (root)

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

### 2-player only — "each opponent" = single opponent
`PlayerID` is `"player1" | "player2"`. `getOpponent()` returns one ID.
Card text like "each opponent loses 1 lore" resolves to the single opponent.
This is correct for 1v1 analytics. Multiplayer (CRD Section 9) would need
`PlayerID` to support N players, variable-length `GameState.players`, turn
order, and team rules — a full redesign, not a tweak.

### Five packages with strict separation
engine / simulator / analytics / cli / ui — each has exactly one job.
The CLI was added between analytics and UI to validate the full pipeline
with terminal output before building React. Cross-concern leakage is the
primary source of architectural debt. Bot type separation
(algorithm/personal/crowd) is enforced the same way: aggregateResults()
throws if called with mixed types.

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

### Weight optimization: random search now, ML later
Random search over weight space is implemented. Grid and genetic
strategies are deferred — random is sufficient for initial analytics
and is the simplest to validate. The architecture is compatible with
future ML: a neural net would implement the same BotWeights interface
via gradient descent instead of random search.

### PersonalBot / RyanBot
Any player creates a named bot by setting weights that reflect their
playstyle and adding explicit override rules for specific tendencies.
Calibrate by measuring agreement rate against real recorded decisions.
Gap between PersonalBot and OptimalBot is a quantified coaching map.
PersonalBots are type "personal" — never mixed with algorithm results.

---

## Card Data Decisions

### Lorcast API as the data source
`https://api.lorcast.com/v0` — real REST API, no auth required,
well-documented, returns clean JSON with all fields we need.
Rate limit ~10 req/sec (100ms between requests), gameplay data
stable enough to cache weekly.

Previous sessions hallucinated a GitHub URL. Lorcast API was the
correct source, identified by navigating to the actual documentation.

**What we considered:**
- Hand-entering cards — rejected immediately, hundreds of cards per set
- Scraping a fan wiki — fragile, no structured schema
- The official Lorcana companion app — no public API
- Lorcast API — chosen: structured, stable, complete

### Named ability stub strategy
Cards with unimplemented named abilities ship as vanilla stubs
(`abilities: []`). They are playable in simulation — they just don't
trigger their effects. This means:
- 49% of set 1 works perfectly right now (keyword-only cards)
- Set 1 is now 100% implemented (all 216 entries have full abilities)
- Track unimplemented abilities in `docs/CARD_ISSUES.md`
- Re-running the importer is safe — it preserves manual abilities on re-import

Rejected alternative: block import until all abilities are implemented.
That would have prevented using the platform at all. Incremental is better.

### Per-set JSON files
The importer outputs `lorcast-set-XXX.json` (one per set) + `lorcastCards.ts`
(auto-generated loader that imports and merges all set files).
Zero-padded filenames (`001`, `002`) for correct sort order beyond set 9.

**Why JSON not TypeScript array:**
- Regeneratable from API without a TS compilation step
- Safe to overwrite — git diff shows only data changes
- Vite bundles JSON imports natively
- TypeScript's `resolveJsonModule` handles it cleanly

**The `exactOptionalPropertyTypes` cast:**
TypeScript's JSON import inference includes `undefined` in optional
property types, which conflicts with our strict `exactOptionalPropertyTypes`
setting. We use `as unknown as CardDefinition[]` to bypass this — the
data is correct at runtime, it's purely a static inference limitation.
This is documented in lorcastCards.ts.

### Dual-ink card support
`CardDefinition.inkColors: InkColor[]` — always an array, even for single-ink
cards (`["amber"]`). Dual-ink cards from Set 7+ have two entries
(`["emerald", "sapphire"]`). The Lorcast API returns `ink: null` +
`inks: ["emerald", "sapphire"]` for dual-ink cards; the importer's
`mapInkColors()` handles both formats.

Filter matching uses array intersection: a card matches if *any* of its
ink colors are in the filter's `inkColors` array. Analytics color breakdown
counts dual-ink cards in both color buckets.

### Reprint dedup in lorcastCards.ts
When multiple sets have the same card ID (reprints), `LORCAST_CARD_DEFINITIONS`
keeps whichever copy has more manually-implemented abilities (non-keyword
abilities + actionEffects). This is done via a `reduce` with
`manualAbilityCount()` comparison, not `Object.fromEntries` (which would be
last-write-wins and order-dependent). Sets load in natural 001–011 order.

### Effect grammar (CRD 6.1)

The engine models card text as a grammar of composable effect primitives.
This maps CRD 6.1 directly so any card text can be decomposed into known forms.

```
ability  := keyword | triggered(trigger, effects) | activated(costs, effects) | static(effect)
effect   := simple | sequential | choose | may(effect)

simple   := draw | deal_damage | heal | banish | return_to_hand | gain_lore
           | gain_stats | exert | ready | grant_keyword | cost_reduction
           | lose_lore | pay_ink | cant_quest | cant_ready | cant_challenge
           | look_at_top | discard_from_hand | discard_hand | move_to_inkwell
           | play_for_free | shuffle_into_deck
           | create_floating_trigger | conditional_on_target

sequential := costEffects[] → rewardEffects[]      // CRD 6.1.5.1: "[A] to [B]", "[A]. If you do, [B]"
choose     := options[][] (pick count)              // CRD 6.1.5.2: "[A] or [B]"
may(X)     := player decides → X or skip            // CRD 6.1.4: "you may"
```

**CRD 6.1.5.1 "[A] to [B]"** — implemented as `SequentialEffect`:
- `costEffects: Effect[]` = [A] (can be multiple parts, can include paying ink)
- `rewardEffects: Effect[]` = [B] (only applied if [A] fully resolves)
- `canPerformCostEffect()` pre-checks [A] affordability before prompting
- `isMay` wraps the whole thing in a player choice (CRD 6.1.4)

**Result passing: "[A]. For each X done this way, [B]":**
- Effects that produce a measurable result (heal, lose_lore) store it in
  `state.lastEffectResult` after resolving
- Subsequent effects can reference this via `amount: "cost_result"` (e.g. on DrawEffect)
- This eliminates compound effect types — Rapunzel (heal → draw per healed) and
  Ursula Power Hungry (lose lore → draw per lost) both use standard effects
  with result passing instead of one-off types

**Ability modifiers (CRD 6.6.1)** — **UNIFIED via query layer**:
- The CRD treats all "can't X" restrictions as one concept with different durations
- Storage remains split (genuinely different purposes): `ActionRestrictionStatic` (board-level,
  recomputed from in-play cards via `getGameModifiers`) vs `CantActionEffect` → `TimedEffect`
  (per-card debuff with expiry, stored on `CardInstance`)
- Query is unified: `isActionRestricted()` in `utils/index.ts` checks both sources
- Validator and reducer call `isActionRestricted()` instead of separate checks
- `RestrictedAction` type (`"quest" | "challenge" | "ready" | "play" | "sing"`) shared
  across `CantActionEffect`, `TimedEffect`, `ActionRestrictionStatic`, and the query

**CRD 6.1.5.2 "[A] or [B]"** — **NOT YET IMPLEMENTED**:
- No Set 1 card uses this form
- `ChooseEffect` exists but doesn't enforce the forced fallback rule:
  "If [A] can't be chosen, then [B] has to be chosen, and vice versa"
- To implement: check each option's affordability via `canPerformCostEffect`,
  filter to performable options, auto-apply if only one remains
- Example: "choose and discard a card or banish this character" — if hand
  is empty, can't discard, must banish (CRD 6.1.5.2 Example C)

When encountering ambiguous card text, decompose it into this grammar:
1. Identify the form: is it "[A] to [B]", "[A] or [B]", or plain sequential?
2. Identify [A] and [B] — each can be multiple effects
3. Check if "may" wraps the whole thing
4. Map to the corresponding type (`SequentialEffect`, `ChooseEffect`, `isMay`)

---

## UI Architecture Decisions

### Drag and drop library: @dnd-kit/core (Session 20)

Chosen over `react-beautiful-dnd` (unmaintained for React 18, poor mobile) and
`react-dnd` (heavier API, older). `@dnd-kit/core` ships its own types, has good
touch/pointer support, and a small API surface.

**Key design:** `PointerSensor` with `activationConstraint: { distance: 8 }` lets
short taps still fire `onClick` normally — drag only activates after 8px of movement.
`TouchSensor` with `delay: 150ms` lets horizontal scroll gestures complete before
DnD activates. Both coexist with the existing click-to-select + action strip pattern.

All drag-to-action dispatch is validated against `legalActions` — if no matching legal
action exists the drop silently no-ops. No separate validation logic needed.

**Components stay dumb:** `DraggableCard` and `DroppableZone` are thin wrappers.
`useBoardDnd` hook handles all state and dispatch. `GameCard` is never modified.

### Choice modal: bottom sheet on mobile, centered panel on desktop (Session 20)

Inline pending choice rendering competed with card zones for vertical space and was
easy to miss on mobile. Modal creates a clear visual interrupt.

**Dismissal contract:**
- `choose_may` → backdrop click auto-declines (always optional by definition)
- choice with `optional: true` → backdrop click skips
- Required choices (mulligan, target selection) → backdrop click no-op

Opponent "thinking..." stays inline — it's status, not a decision.

### Simulation runs in-browser
All engine/simulator/analytics code is pure TypeScript with no Node.js
APIs. Vite bundles it into the frontend. No server needed.

**Tradeoff:** long simulations (1000 games of ProbabilityBot) block the
main thread. Mitigated by:
- `setTimeout(fn, 10)` before running — lets the loading spinner render first
- Default iterations capped at 200 in the UI
- Web Workers deferred — complexity not justified yet

### No React Router
Single-page with tab state in `useState`. Five screens don't need a router.
Adding React Router later is trivial if deep-linking becomes useful.

### No Zustand
Deck state is a small `useState` in App.tsx passed as props.
One layer of prop drilling is fine. Zustand is unnecessary complexity
for the current scope.

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

**Named ability implementation priority** — no formal system yet.
Start with most-played competitive cards from set 1.

**Crowd skill segmentation** — self-reported vs consistency-derived?
Deferred until crowdsourcing phase.

**Replay encoding format** — JSON action sequences, exact schema TBD.

**IP / Legal** — research before going public. Disney/Ravensburger own Lorcana.

**Additional sets** — all 11 sets imported as stubs (2504 cards total,
including 66 dual-ink cards in set 7). Only set 1 has fully implemented
abilities. Implement abilities in other sets as needed.

**Undo for bot learning (CRD 1.7.6)** — Currently illegal actions return
`success: false` without mutating state. Would logging "undo" events or
allowing bots to explore illegal-then-reversed action sequences improve
learning? Probably not for current weight-based bots, but could matter
for future RL/MCTS approaches.

---

## "Up To" Amounts (CRD 6.1.3)

### Decision
Add `isUpTo?: boolean` to effect types (`HealEffect`, `DealDamageEffect`, `DrawEffect`,
`ExertEffect`). Mark it in card data. Engine resolves at maximum value for now.

### Why
CRD 6.1.3: "Up to" includes 0 as a legal choice. "Remove up to 2 damage" means
the player picks 0, 1, or 2. For headless analytics, bots always pick max — but
future sets may have cards where choosing less is strategically optimal (e.g.,
"remove up to N damage, opponent draws a card for each damage removed").

### Extension point
When a card makes sub-max choices relevant: add `choose_amount` to `PendingChoice`
type with `min: 0, max: N`. Route `isUpTo` effects through it. Bot strategy layer
picks optimal amount. Data already has `isUpTo: true` so no card data changes needed.

---

## Done: Timed Effects System

**Implemented in session 6.** Added `timedEffects: TimedEffect[]` to `CardInstance`
alongside legacy temp modifier fields (kept for backward compat). New effect types:
`grant_keyword`, `cant_quest`, `cant_ready` with durations `end_of_turn`,
`rest_of_turn`, `end_of_owner_next_turn`. Duration-aware cleanup in `applyPassTurn`.
`hasKeyword()` and `getEffective*()` check timed effects.

Also added: `followUpEffects` on `ReadyEffect`/`ExertEffect` for compound patterns
("ready chosen character, they can't quest"), `pendingEffectQueue` on `GameState`
for multi-effect action sequencing (draw then discard).

Cards using it: Cut to the Chase, Tinker Bell - Most Helpful, White Rabbit's Pocket Watch,
Scepter of Arendelle, Work Together, Fan the Flames, LeFou - Instigator,
Scar - Shameless Firebrand, Elsa - Spirit of Winter, Jasper - Common Crook.

## Done: Cross-Card Triggers

**Implemented in session 6.** `queueTrigger` now scans ALL in-play cards for
triggered abilities with matching `filter` on the trigger event. New trigger events:
`card_played`, `item_played`, `banished_in_challenge`. `triggering_card` target
type supported in banish/return_to_hand effects.

Cards using it: Coconut Basket, Ariel - Whoseit Collector, Musketeer Tabard,
Cheshire Cat - Not All There, Kuzco - Temperamental Emperor, Cruella De Vil.

## Done: Condition Evaluation

**Implemented in session 6.** `evaluateCondition()` called in `processTriggerStack`
and `applyActivateAbility`. Conditions: `characters_in_play_gte`, `cards_in_hand_eq`,
lore comparisons. Fixed CRD_TRACKER bug B7 (condition field never checked).

## Done: Discard from Hand + Look at Top N

**Implemented in session 6.** `DiscardEffect` with `chooser` field and
`choose_discard` pending choice. `LookAtTopEffect` with bot auto-resolution
for headless analytics. Cards: Sudden Chill, You Have Forgotten Me,
Develop Your Brain, Be Our Guest, Reflection, Yzma - Alchemist, Ursula's Cauldron.

## Done: Zone Transition Abstraction

**Implemented in session 6.** All game-meaningful card moves go through
`zoneTransition(state, instanceId, targetZone, definitions, events, ctx)` which
wraps the pure `moveCard` utility with automatic trigger firing:

- **Leaving play** (`play → *`): fires `leaves_play`, plus `is_banished` and
  `banished_in_challenge` if reason is "banished" with challenge context
- **Entering play** (`* → play`): fires `enters_play`, `card_played`, `item_played`
- **Challenge kills**: fires `banished_other_in_challenge` on the surviving opponent

`TransitionContext` carries `reason`, `fromChallenge`, `challengeOpponentId`, and
`silent` (for suppressing triggers on cleanup moves like action → discard or shift
base removal).

**Why:** Every zone transition was manually orchestrated with scattered `queueTrigger`
calls — easy to forget, impossible to add `leaves_play` consistently. Now Set 2's
"when this character leaves play" triggers will work automatically for any
`play → *` transition (banish, return to hand, shuffle into deck, move to inkwell).

Cards unblocked: Simba - Rightful Heir, Te Kā - Heartless, Mulan - Imperial Soldier,
Prince Phillip - Dragonslayer (all use `banished_other_in_challenge` or
`banished_in_challenge` with `triggering_card` target).

---

## Note: Batch vs Per-Card Trigger Semantics

Card text distinguishes between batch and per-card events:

- **"whenever they draw a card"** (Set 4) → per-card. Drawing 7 = 7 triggers.
  `applyDraw` already loops one card at a time (CRD 1.12.2), so per-card
  triggers will fire naturally when added.

- **"whenever an opponent discards 1 or more cards"** (Set 2) → batch.
  Discarding 7 = 1 trigger with count. `discard_hand` and `discard_from_hand`
  should fire ONE batch event, not per-card events. Current implementation
  doesn't fire any discard triggers (no Set 1 cards listen), so we're not
  locked into the wrong pattern.

When implementing discard triggers for Set 2, fire a single
`{ on: "cards_discarded", count: N }` event, not N individual events.

---

## Done: Reckless Implementation

### Two enforcement points for one keyword

**CRD 8.7.2 — Can't quest**: Validator check, same pattern as isDrying.
Block QUEST action for characters with Reckless keyword.

**CRD 8.7.3 — Must challenge if able**: First "forced action" in the engine.
PASS_TURN becomes conditionally illegal. Validator must check: does the active
player have any ready Reckless character with at least one valid challenge target
(exerted opponent, respecting Bodyguard/Evasive)?

**CRD 8.7.4 — Escape valve**: Player can exert Reckless characters via activated
abilities or singing to satisfy the obligation without challenging. So the check
is "ready AND has valid targets," not just "Reckless exists."

### New concept: mandatory actions
Currently PASS_TURN is always legal. Reckless makes it conditional — the first
keyword to do so. The comment `// PASS_TURN — always legal on your turn` in
`getAllLegalActions()` would need to change.

### Edge case: multiple Reckless characters
If one has targets and one doesn't, you still can't pass until all Reckless
characters with valid targets have been dealt with (challenge or exert).

### Dependency
John Silver - Alien Pirate grants Reckless to opponent's characters, which
requires the timed effects system (see above). Implementing the keyword
enforcement first, then John Silver later.

---

## Session 5: CRD Audit and Bug Fixes

### CRD-to-Engine Mapping (docs/CRD_TRACKER.md)

**Decision:** Systematically audit the engine against Disney Lorcana Comprehensive
Rules v2.0.1 (effective Feb 5, 2026). Every mechanically relevant rule mapped to
implementation status. Result: `docs/CRD_TRACKER.md`.

**Why:** The engine was built from card text and community knowledge, not the official
rules document. The audit found 6 bugs and 12 missing features that wouldn't have
been caught by testing alone.

### `hasActedThisTurn` → `isDrying` Rename

**Decision:** Rename `CardInstance.hasActedThisTurn` (boolean) to `isDrying` to match
CRD terminology (5.1.1.11 "drying" = entered play this turn).

**Why:** The old name conflated two concepts: (1) entered play this turn (drying), and
(2) already used an action. This made Rush (CRD 8.9.1) impossible to implement
correctly — Rush should allow challenging but not questing while drying. After the
rename, drying is a first-class CRD concept and Rush is handled in the validator by
checking the keyword.

**What we considered:** Adding a second boolean (`isDrying` alongside `hasActedThisTurn`).
Rejected because `hasActedThisTurn` was redundant — exerting already prevents re-use.

### Unprotecting Previously Protected Files

**Decision:** Unprotect `types/index.ts`, `sampleCards.ts`, `validator.ts`, `initializer.ts`.

**Why:** The CRD audit revealed bugs in validator.ts (Rush checking) and types/index.ts
(field semantics). Protecting files that contain bugs creates a contradiction.

### Resist `ignoreResist` Parameter (B6)

**Decision:** Add optional `ignoreResist` parameter to `dealDamageToCard()` rather than
creating separate `putDamageOnCard()` function.

**Why:** CRD 8.8.3 distinguishes "dealt" damage (Resist applies) from "put/moved"
damage (Resist doesn't apply). One function with a flag is simpler than two functions
with near-identical logic. No set 1 cards currently "put" damage, so the parameter
defaults to `false` and callers opt in when needed.

---

## Analytics: Tester vs Generator

### The trap we identified (Session 8)

The current simulation pipeline is a **hypothesis tester**, not a
**hypothesis generator**. This distinction matters enormously.

**Tester (what we built):** You form a theory, encode it into a bot or
query, run the sim, get a number confirming or denying the theory.

Example: "I should keep DYB and mulligan 6" → encode into RampCindyCowBot
→ run 500 games → "line fires 9.2% of the time." You already knew the
line was hard to hit. The sim just put a number on it.

**Generator (what we need):** The sim tries strategies without human
preconceptions and reports which ones work best.

Example: run 500 games with 5 different mulligan strategies, compare
line availability for each, report the winner — which might not be the
strategy you assumed was correct.

### The discovery spectrum

```
TESTER ←————————————————————————————→ GENERATOR
Hypothesis   Systematic    Opener      Reinforcement
Validation   Strategy      Profiling   Learning
(built)      Sweep         (next)      (future)
             (buildable)
```

**Hypothesis Validation (built):** Confirms what you already believe.
Valuable but limited — can't discover things you haven't thought of.

**Systematic Strategy Sweep (build next):** Define N mulligan strategies,
run each 500 times, compare F3 (line availability). The winner might
surprise you. No human encoding of "correct" strategy required.

**Opener Profiling (build next):** Instead of testing your strategy,
ask what successful games have in common in their openers. Derive
what a "good hand" looks like from outcomes, not assumptions.

**Reinforcement Learning (future):** Bot discovers strategy from scratch
via reward signals. Genuinely surprising results. Weeks of work.
Architecture is compatible — `BotStrategy.decideAction()` interface
works for RL bots as well as hand-coded ones. See ANALYTICS_PHILOSOPHY.md.

### Decision: build opener profiling and strategy sweep before more bots

Before adding more hand-coded bot logic, build the infrastructure that
can discover strategies we haven't thought of. See ANALYTICS_PHILOSOPHY.md
for the full design and specific queries to add to a deck's questions file.

**Principle:** Before running any simulation, ask: "Am I testing a
hypothesis I already believe, or am I looking for something I don't know?"
Design sims for discovery, not just confirmation.

### Why card-specific fact errors matter

Claude.ai stated DYB costs 2 (incorrect — it costs 1). This propagated
into conversation reasoning before being caught. Card costs, card text,
and rule specifics must always be verified from the card JSON or CRD PDF.
Claude.ai should never state card costs or effects from memory.
Claude Code's CLAUDE.md instruction to read the CRD PDF applies equally
to Claude.ai sessions — verify before designing, not after.

---

## Workflow

Claude.ai — strategy, architecture, tradeoffs, spec refinement.
Claude Code — implementation, tests, file editing.
Neither has memory between sessions. CLAUDE.md, docs/SPEC.md, docs/DECISIONS.md
are the project memory. Update them at the end of every significant session.

---

---

## Replay Design: Seeded RNG + Action Capture, Not State Snapshots

### Decision
Reconstruct game states by replaying `GameAction[]` from a seeded initial
state, rather than storing full `GameState` snapshots at each step.

### Why
- `GameState` snapshot per step: ~20-50 KB × 50 turns = ~1-2.5 MB per game.
  For thousands of RL training games, this is prohibitive.
- `{ seed, actions[] }`: ~5-15 KB per game. 100x more compact.
- Seeded RNG is needed anyway for RL debugging (reproduce exact games).
- Scrubbing backward = replay from seed to step N. Fast enough for <100 actions.

### Rejected
- **Text-only replay** (just re-render actionLog): No board state. Can't show
  card positions, damage, exerted status. Useless for visual understanding.
- **State snapshots**: Too large, especially at RL training volume.

### Three features, not one
1. **Visual replay** — read-only scrubbing through a past game on GameBoard
2. **Human takeover** — fork from any replay point into a live game (SC2-style
   "resume from replay"). `runGame` already supports `startingState`.
3. **Branch analysis** — fork, sim 200 games both ways, compare win%. Already
   works via `useAnalysis` + `runSimulation({ startingState })`.

Replaying one game does NOT train the RL bot. RL needs volume (thousands of
games). Replay is for human interpretability; "what if" is for human exploration.

---

## Seeded RNG — xoshiro128** in GameState

### Why xoshiro128**
Fast (single multiply + shifts), well-tested, 128-bit state (4×32-bit integers),
good distribution. Initialized via splitmix64 (standard seeding practice).
Alternatives considered:
- **Mulberry32** — simpler but only 32-bit state, shorter period.
- **crypto.getRandomValues** — non-deterministic, defeats the purpose.
- **External lib (seedrandom)** — adds dependency for ~30 lines of code.

### Why RNG lives in GameState
The RNG state is part of the immutable game snapshot. This means:
1. **Replay**: same seed → identical game (shuffle, IDs, all random ops).
2. **Serializable**: RngState is `{ s: [n,n,n,n] }` — plain JSON.
3. **Forkable**: `cloneRng()` lets branch analysis diverge from a snapshot.
The RNG mutates in place (perf), but the state *object* is part of GameState's
immutable structure — each reducer spread carries it forward.

### GameAction[] capture
Raw actions stored in `GameResult.actions` alongside `GameResult.seed`.
Together they enable full game reconstruction without replaying bot logic.
Stripped from `StoredGameResult` (storage is for aggregate stats, not replay).

---

## Stream 1: RL Bot Architecture

### Per-card scoring instead of fixed action-type outputs
The RL.md spec uses 8 fixed action-type outputs (play_card, quest, pass, etc.)
so the network can't distinguish *which* card to play. We switched to per-card
scoring: the network takes `[stateFeatures, actionFeatures]` and outputs a single
score. Each legal action is scored independently, then softmax picks the best.

**Why:** In Lorcana, "play Elsa on turn 3" vs "ink Elsa on turn 3" are fundamentally
different decisions. A fixed-output network can only learn "play a card" vs "ink a card"
— it can't learn card-specific preferences. Per-card scoring lets the network learn
individual card valuations in context.

**Trade-off:** N forward passes per decision (N = legal actions, typically 5-50) instead
of 1. Total training is ~50× slower. Acceptable for overnight training; if too slow,
reduce hidden layer sizes.

### Card feature size is 44 (not 43)
Actual breakdown: 4 basic + 4 character stats + 13 keywords + 22 effects + 1 trigger = 44.
The original RL.md spec said 43 but the math didn't add up.

### Separate mulligan network
Mulligan decisions use state features only (no action features), so a separate smaller
network (state → 64 → 32 → 2) handles the binary mulligan/keep decision.

### All randomness seeded
Exploration (ε-greedy), weight initialization, and game seeds all flow from a single
training seed. Same seed → identical reward curve, enabling reproducible experiments.

---

---

## Stream 2: Actor-Critic + GAE (Upgrade from REINFORCE)

### Why REINFORCE was wrong for combo decks

REINFORCE assigns the same episode-level return to every decision in a game.
For a deck where the win condition is "quest repeatedly," this works — the signal
is dense and uniform. For multi-step combos (exert Singer → play Song → use saved
ink for finisher), it fails:

1. **High variance** — a single end-of-game return is a noisy estimate of action
   quality. Every action in a 30-turn game gets the same gradient signal.
2. **No temporal credit** — "I exerted Maui to sing Be Prepared on turn 8" and
   "I played any card on turn 8" get the same update. The gradient can't distinguish.
3. **Exploration is dumb** — ε-greedy picks random individual actions, not
   combinations. Even if it randomly sings a song, nothing connects that to the
   downstream play.

### What we switched to: Actor-Critic + GAE

- **Critic (valueNet)**: A learned V(s) network (STATE_FEATURE_SIZE → 64 → 32 → 1)
  predicts expected future return from any state. Acts as a per-step baseline,
  replacing the EMA scalar (`rewardBaseline`).
- **GAE (λ=0.95)**: Computes per-action advantages via multi-step TD chain:
  `delta_t = r_t + γ·V(s_{t+1}) - V(s_t)`, `A_t = delta_t + γλ·A_{t+1}`.
  Effective ~20-turn horizon — enough to credit "I sang this song" against the
  downstream finisher play.
- **Value loss weight = 0.5**: Standard A2C ratio for critic MSE update.
- **Per-step rewards** (scale 0.05): Lore-gain deltas injected as intermediate
  rewards into the GAE backward pass (assigned to last step of each turn to avoid
  double-counting).

### What was removed (REINFORCE-era code)

`trainWithCurriculum` and `goldfishReward` were a two-phase warm-up workaround:
a "goldfish phase" (no opponent) gave the policy dense reward signal to bootstrap
from sparse win/loss returns. With A2C, the critic learns V(s) from step zero and
bootstraps per-step value estimates without needing a warmup phase. Both were deleted.
The `--curriculum` CLI flag was also removed.

### Results (10k episodes)

Win rate vs random opponent climbed from 44.8% → 67.9% average reward, reaching
96% win rate by ep 10k. The reward curve continued improving after epsilon hit its
floor at ep ~6k — confirming the critic was independently improving the policy via
lower-variance gradient estimates.

### Known open problems

- **Singing combos still rare**: Be Prepared sung 3/116 plays, FOTOS 0/235 at 10k
  episodes. Multi-step combos require self-play or explicit combo reward shaping.
- **Monstrous Dragon**: Inked 319×, played only 22×. Bot hasn't learned high-cost
  cards are worth playing; needs more episodes or reward shaping.

---

## Train-Mirror: Query-Based Analytics

### Decision

Refactored `scripts/train-mirror.ts` to use `GameResult[]` + post-hoc queries
instead of accumulating live stats during game iteration.

### Before (live accumulation)

```typescript
// CardTrace accumulated inside the game loop
for (const action of result.actions) {
  if (action.type === "PLAY_CARD") trace.timesPlayed++;
  // ...
}
```

### After (query-based)

```typescript
const results: GameResult[] = runGames(policy, deck, count, seed);
const cardPerf = aggregateResults(results);          // from @lorcana-sim/analytics
const actionStats = queryActionStats(results);        // post-hoc action aggregation
```

### Why

- **Consistency with the rest of the analytics platform**: `runSimulation()` →
  `aggregateResults()` is the established pattern. The old `traceGames()` was
  a parallel, incompatible accumulator.
- **Flexibility**: New analytics columns can be added without changing game loop code.
  `queryActionStats()` iterates `result.actions` once per query, not per game.
- **Single unified table**: Two old tables (card preferences + mechanic usage) merged
  into one table per card with columns: Ink, Play, Sung, Quest, Chall, SungBy, Activ,
  WR%drawn, Lore/g. Easier to compare baseline vs trained at a glance.

---

---

## RL Ceiling and Strategic Pivot (Session 17, Apr 3 2026)

### The ceiling

A2C + GAE has a hard architectural limit on multi-turn planning. Concrete example from
the amber-steel deck: the optimal T2 play is "Lantern (2 ink, cost reducer) + Stitch New
Dog (free after reduction)" rather than "play New Dog on T1." The reason to wait: the
mirror runs Fire the Cannons (1 ink, kills a 1-drop), so playing New Dog T1 gives the
opponent an on-curve answer. Playing it T2 behind Lantern forces them off-curve.

The RL always plays New Dog T1 because that's locally greedy. The payoff for waiting
(successful T3 shift) is too far from the T1 decision for GAE to propagate credit back
reliably. More episodes, more reward shaping, longer rollouts — none of these fix the
root cause: the credit assignment chain is too long for per-step TD.

**What A2C + GAE can learn:**
- Card value (Rock Star is worth playing, Carefree Surfer is not)
- Basic tempo (quest when ahead, play characters when behind)
- Single-turn cost efficiency (Lantern reduces cost → play more cards this turn)

**What it cannot learn:**
- Multi-turn sequencing (hold New Dog T1 → Lantern T2 → shift T3)
- Opponent modeling (dodge known removal)
- Strategic card holding patterns

**Current results (accepted as baseline, not worth improving further):**
- Ruby-amethyst control: 27.2% vs greedy mirror
- Amber-steel control: 77% vs greedy mirror (better deck for RL — finishers cost 5 not 9)

### Proposed direction: supervised learning from ranked human games

Multiplayer (Stream 4) + ELO ranking → collect high-ranked human game logs → supervised
clone trainer (Stream 5). Humans have already solved credit assignment through
understanding. Recording (state, action) pairs from high-ELO games and training via
cross-entropy bypasses the exploration problem entirely.

**Why this works where RL doesn't:**
A human holding New Dog T1 already knows why (opponent runs removal). That decision gets
recorded as a labeled example. The clone learns "in this position, strong players held
this card" without needing a reward signal propagated back 3 turns.

**The ceiling:** "as good as the best human players in the pool." For an analytics
platform, "plays like a strong human" is the target — not superhuman. You need
interesting, intentional play so query results reflect real strategies, not quest-flood.

**Architecture reuse:** Same `stateToFeatures()`, same `actionToFeatures()`, same
`NeuralNetwork` class — just cross-entropy loss instead of policy gradient. The clone
trainer is a smaller project than the original RL trainer.

**Prerequisites:** Stream 4 (multiplayer server) must exist before human games can be
collected. Stream 4 is the unblocking dependency.

**Pending:** Consulting claude.ai for second opinion on whether ~50 games × ~120
decisions per player is enough signal, and whether any RL architectural changes could
close the gap before multiplayer exists.

---

## Session 17 Changes (Apr 3 2026)

- **Amber-steel deck** added (`decks/set-001-amber-steel-deck.txt`). All 16 unique cards
  fully implemented (confirmed). Sim infrastructure: `sims/set-001-amber-steel/`.
- **Lantern shift cost reduction bug fixed** in `validator.ts`:
  `getEffectiveCostWithReductions()` now accepts optional `baseCost` parameter so shift
  affordability checks apply `costReductions` (e.g. Lantern) against `shiftCost`, not
  `cost`. Was silently broken — Lantern had zero effect on shift plays.
- **Stream 3f done**: RL policy upload in GameBoard + TestBench analysis overlay.
  File picker → `RLPolicy.fromJSON()` → `epsilon=0` → passed to `useAnalysis`.
  Label switches "GreedyBot est." → "RL est." when policy loaded.
- **Amber-steel policies trained** (6.5 hrs, same pipeline as ruby-amethyst):
  control 100% vs random / 81% vs greedy (best performer).
- **Query suite run**: 77.4% win rate for amber-steel control vs greedy.
  Key finding: Stitch shift line (New Dog early + Rock Star) = +20.4% win rate.
  A Whole New World anti-correlates with winning (played when behind). Songs overall
  correlate with losing. Lantern + New Dog T2 line never fired (RL misses multi-turn setup).

---

## Session 18–19 Changes (Apr 3 2026)

### Engine: partial mulligan (CRD 2.2.2)
- **Phases added:** `mulligan_p1` / `mulligan_p2` before `main`. Game now starts in
  `mulligan_p1` with a `choose_mulligan` pendingChoice for player1.
- **Pre-game bypass removed:** `runGame.ts` no longer runs its own mulligan loop.
  All bots (GreedyBot, RandomBot, RLPolicy) handle `choose_mulligan` through the
  normal `decideAction` pendingChoice dispatch path.
- **Partial selection:** player chooses specific cards to return (not "full mulligan or
  keep"). Bot heuristic: sort hand by non-inkable first, then lowest cost; return bottom
  half if `shouldMulligan()` says yes.
- **`pendingEffect` made optional** on `PendingChoice` — mulligan has no underlying effect.

### Engine: bug fixes
- **Items/locations cannot be challenged** (CRD 4.6.2): `validateChallenge` now checks
  `defenderDef.cardType === "character"` before accepting the action.
- **Self-trigger filter bug fixed**: `queueTrigger` was only applying trigger filters to
  cross-card watchers, not to the source card's own triggered abilities. ADORING FANS
  (Stitch - Rock Star) was firing on his own `card_played` event even though the
  `costAtMost: 2` filter excluded him. Fixed by applying `matchesFilter` to self-triggers
  the same way as watcher triggers.

### Engine: effect log messages
- Added `"effect_resolved"` to `GameLogEntryType`.
- `applyEffectToTarget` for `remove_damage`: logs "Removed N damage from [Card]." after
  applying the heal.
- `applyEffect` for `draw`: logs "Drew N card(s)." after the draw.
- Result: triggered abilities now produce a full log sequence — trigger announcement,
  then each resolved effect — instead of a single opaque "triggered" line.

### GameBoard UX (Session 18–19)
- **Card-contextual actions**: flat action list replaced with per-card button rows.
  Play / Ink / Quest / Challenge / Shift / Sing / Activate buttons appear below each card.
- **2-step challenge/shift flows**: clicking Challenge or Shift enters a pending mode
  (orange/purple ring on source card), then clicking a valid target dispatches the action.
- **Rules of Hooks fix**: `challengeAttackerId`/`shiftCardId` useState and all
  dependent `useCallback`/`useMemo` hooks moved above the early return for setup mode.
- **Duplicate card disambiguation**: `buildLabelMap()` numbers identical-named cards
  "(1)"/"(2)" in choice buttons AND overlays the badge on board cards during that choice.
- **"Opponent is thinking..."** (was "Bot is thinking...").

*Last updated: 2026-04-03*
