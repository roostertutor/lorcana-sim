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

---

## UI Architecture Decisions

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

**Additional sets** — import all 11 sets or start with 1–3?
Likely: implement more named abilities in set 1 first, then add set 2.

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

## Planned: Reckless Implementation

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

## Workflow

Claude.ai — strategy, architecture, tradeoffs, spec refinement.
Claude Code — implementation, tests, file editing.
Neither has memory between sessions. CLAUDE.md, docs/SPEC.md, docs/DECISIONS.md
are the project memory. Update them at the end of every significant session.

---

*Last updated: Session 6*
*Changes: Deck exhaustion implemented. Tests restructured by CRD. Card importer*
*fixed (captures all card text, preserves manual abilities). README + goldfish deck*
*added. --verbose CLI flag. sampleCards.ts removed. Timed effects and Reckless*
*designs documented. Max turns bumped to 120.*
