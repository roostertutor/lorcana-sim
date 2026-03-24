# DECISIONS.md
# Lorcana Analytics Engine — Project Decisions & Strategy Log
#
# This file captures the "why" behind decisions.
# SPEC.md captures the "what" and "how".
# Keep both updated as decisions evolve.
# Paste into new Claude.ai or Claude Code sessions for context.

---

## What This Project Is

A headless Lorcana TCG game engine and deck analytics platform.

**Not** a human-playable tabletop simulator.
**Not** competing with Lorcanito, Duels.ink, or Pixelborn.

The engine simulates thousands of games programmatically to answer
questions like:
- How consistent is this deck at hitting ink on curve?
- What is the win rate of deck A vs deck B?
- Which cards in this deck are underperforming?
- How first-player dependent is this matchup?

---

## Why This Direction

### The competition problem
The human simulator space already has:
- **Lorcanito** — web-based, open source, well established
- **Duels.ink** — web-based simulator
- **Pixelborn** — desktop app, webcam overlay (like MTG Spelltable)

Building a fourth option competes for the same small pool of Lorcana
players who want to play online. Not worth it.

### The gap we fill
No Lorcana tool does quantitative deck analysis. Every competitive card
game needs this — MTG has had it for decades (Frank Karsten, Moxfield
hand analysis, goldfish simulators). Lorcana has nothing.

### Why not just do probability math?
Pure hypergeometric math treats all cards as identical. In Lorcana they
are not — a 3-cost card with Rush plays very differently from a 3-cost
vanilla. The engine knows what each card actually does, so simulation
results are more accurate than pure math.

We use pure math where it's sufficient (ink curve probability, opening
hand statistics) and Monte Carlo simulation where card specifics matter
(win rates, card performance, matchup analysis).

---

## What We Considered and Rejected

### Human-playable simulator
Started here, pivoted away. The UI complexity (pending choice resolution,
board rendering, turn flow) is significant work that does not serve the
analytics goal. Can revisit as a thin layer later once analytics works.

### Rule engine as open source library
The overlap of "Lorcana players" and "developers who would use a rules
library" is too small. MTG has this ecosystem after 30 years. Lorcana
does not yet.

### Pack opening simulation
Already done by other sites. Low value add.

### Set spoiler testing tool
Only useful once you have a working simulator underneath it. It is a
feature of the analytics platform, not a standalone project.

---

## Judge / Rules Oracle Tool (Future)

**Concept:** Answer rules questions in natural language.

**Architecture decision: hybrid engine + RAG**
Two sources of truth that complement each other:
1. The comprehensive rules PDF — covers mechanics abstractly
2. Our card implementations — covers exactly what each card does

The rules PDF does not mention individual cards. Our engine does not
have prose explanations of rule interactions. Together they cover
almost everything.

**Question routing:**
- "What does Gaston cost?" -> card definition lookup, deterministic, no LLM
- "What does Bodyguard do?" -> RAG over rules PDF, cite the rule section
- "Can Gaston be challenged while Elsa is in play?" -> both sources + LLM
  reasoning, always show sources

**Hallucination mitigations:**
1. RAG — model reasons from retrieved text, not memory
2. Forced citation — must cite rule section or card implementation
3. Engine cross-check — LLM claims can be verified against card data
4. Confidence flagging — low confidence answers get visible warnings
5. Frame as learning tool, not tournament authority

**When to build:** After meaningful card pool exists (50+ cards properly
implemented). Not worth building now.

---

## Sealed / Draft Simulation (Future)

**Concept:** Generate accurate booster packs, build sealed deck,
playtest against the analytics engine.

**Key requirement:** Accurate pull rates per set. Community has documented
these. Do not guess.

**Dependency:** Needs meaningful card pool and working analytics engine.

---

## Architecture Decisions

### Four packages, clear separation of concerns

```
engine/      <- pure rules, no UI, no simulation strategy
simulator/   <- headless runner, bot strategies, game loop
analytics/   <- stats aggregation, deck analysis, pure math
ui/          <- thin layer over analytics, build last
```

Each package has one job. Engine does not know about bots. Simulator
does not know about charts. Analytics does not know about React.

### Engine stays pure (Decided, firm)
applyAction(state, action, definitions) -> ActionResult

No side effects. No mutation. Same inputs = same outputs (except shuffle).
GameState is a plain serializable object — no classes, no methods.

### Card abilities are data not code (Decided, firm)
Abilities are structured JSON interpreted by the engine. Adding a new
card never requires changing the engine. The judge tool can also read
ability data directly as a source of truth.

### getAllLegalActions is a first-class engine export (Decided)
Makes headless simulation possible. The engine generates all legal moves
for a player — the bot just picks one. Reuses the existing validator
internally so no logic is duplicated.

### Bot strategies are pluggable (Decided)
```typescript
interface BotStrategy {
  name: string
  decideAction: (state, playerId, definitions) => GameAction
}
```

RandomBot and GreedyBot to start. Interface allows future strategies
without touching engine or simulator infrastructure.

RandomBot: useful for stress testing and invariant checks.
GreedyBot: useful for directional analytics, approximates a reasonable pilot.

### CLI before UI (Decided)
Build a terminal CLI that outputs analytics before any React UI.
Validates the entire pipeline cheaply. Wrong numbers in the CLI
means the UI will not save you.

### UI is charts over analytics, not a game board (Decided)
When we build UI it shows deck composition, simulation results, and
deck comparison. It does NOT show a game board or interactive game play.

---

## Testing Philosophy

### The core problem
Subtle rule bugs silently corrupt all simulation output. 10,000 games
with a wrong Bodyguard implementation produce confident but wrong stats.
Accuracy must be solved before scale.

### Four layers of confidence

**Layer 1 — Unit tests** (fast, many)
Every mechanic isolated. Use injectCard() pattern — never rely on random
opening hand. Grow with every new card implemented.

**Layer 2 — Integration scenarios** (medium, targeted)
Multi-card interactions. Two triggers same turn. Ward blocking abilities.
Shift damage inheritance. Every non-obvious interaction gets a test.

**Layer 3 — Game invariants** (automated, run during sim)
After every action assert:
- 60 cards always accounted for per player
- Lore never decreases
- Inkwell cards never leave inkwell
- Banished cards go to discard only
- availableInk never exceeds inkwell size
- Game ends exactly at 20 lore

Run 1000 RandomBot games. Any invariant failure = engine bug.

**Layer 4 — Known replays** (slow, high confidence)
3-5 real human-played games encoded as action sequences.
Engine must agree at every step. Most expensive but highest confidence.

### Simulation sanity checks
- Mirror match win rate should be ~50%
- Going first win rate should be 50-65%
- Average game length should be 6-15 turns

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | TypeScript strict mode | Catches rule bugs at compile time |
| Package manager | pnpm workspaces | Fast, local, monorepo support |
| Tests | Vitest | TS-native, fast, watch mode for TDD |
| Frontend (later) | React + Vite | Ecosystem, fast dev |
| Charts (later) | Recharts | Lightweight, React-native |
| Styling (later) | Tailwind | Fast iteration |
| Future DB | Supabase | If persistence ever needed |
| Future auth | Supabase (Google/Discord) | Third party only, no custom auth |

---

## Card Data

### Current state
20 hand-crafted sample cards covering every mechanic.
Sufficient for engine development and testing.
Not sufficient for meaningful analytics.

### Path to real data
Community dataset: https://github.com/lorcanito/lorcana-data
Write a one-time migration script. Do not hand-enter full sets.

### Implementation priority
Group 1 (done): Vanilla, Evasive, Rush, Bodyguard, Ward, Challenger,
Support, triggered abilities, activated abilities, items, actions, songs

Group 2 (next): Shift (full testing), Singer + Song interaction,
Resist, Reckless, Location cards

Group 3 (later): Full set data via community dataset migration

---

## Explicitly Out of Scope

- Human-playable game board UI
- Multiplayer / networking
- Auth / user accounts
- Deck builder UI (paste decklist is sufficient)
- Card images
- Mobile support
- Real-time game play
- Bot AI beyond GreedyBot heuristics

---

## Open Questions

**IP / Legal**
Fan simulators operate in a grey zone (Disney/Ravensburger own Lorcana).
Research before going public. Affects distribution approach.

**Card images**
Not needed for analytics. Decision deferred until UI phase.

**Replay encoding format**
For Layer 4 tests, need a format to encode real games as action sequences.
JSON seems right but exact schema TBD.

**GreedyBot ink selection heuristic**
When inking a card, which should GreedyBot choose?
Options: lowest cost, highest cost, most copies in deck.
Deferred until GreedyBot implementation.

---

## Workflow

### Claude.ai
Strategy, architecture, tradeoffs, spec refinement.
Use for: thinking through problems before coding them.

### Claude Code
Implementation, running tests, editing files, refactoring.
Use for: building what was decided here.

Neither tool has memory between sessions.

### Maintaining context
1. Keep SPEC.md updated — what to build
2. Keep DECISIONS.md updated — why decisions were made
3. Keep README.md updated — how to set things up
4. Update "Current status" in SPEC.md Claude Code prompt each session

### Starting a new Claude Code session
```
Read SPEC.md, DECISIONS.md, and README.md.

Current status:
- engine package: [done / in progress / not started]
- simulator package: [done / in progress / not started]
- analytics package: [done / in progress / not started]
- ui package: [done / in progress / not started]

[Describe what you want to work on this session]
```

### Starting a new Claude.ai session
```
I am building a Lorcana TCG headless analytics engine.
Read DECISIONS.md and SPEC.md for full context.
[Describe what you want to discuss]
```

---

*Last updated: Session 2 — Pivot to headless analytics direction*