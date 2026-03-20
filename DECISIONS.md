# DECISIONS.md
# Lorcana Simulator — Project Decisions & Strategy Log

This file captures architectural decisions, strategic discussions, and open
questions from planning sessions. Update it as decisions change.
Paste the relevant sections into new Claude.ai or Claude Code sessions for context.

---

## Project Overview

A web-based Disney Lorcana TCG simulator with a working rule engine.
Primary goal for v1: **learn by building**, not to compete with existing tools.

### Existing competition (as of early 2026)
- **Lorcanito** — web-based, open source, well established
- **Duels.ink** — web-based simulator
- **Pixelborn** — desktop app, webcam overlay play (like MTG Spelltable)

### Honest assessment
Building a direct competitor to Lorcanito for player adoption is not the
primary goal. The project has value as a learning exercise and potentially
as a foundation for tools that fill genuine gaps (see Future Projects below).

---

## V1 Scope (Decided — Build This)

Deliberately minimal. The rule engine is the hard part; everything else is
secondary until it works.

- ✅ Rule engine as pure TypeScript library
- ✅ ~20 sample cards covering every mechanic (not all cards)
- ✅ Paste-in decklist parser (no deck builder UI needed yet)
- ✅ Singleplayer vs yourself — both sides in one browser tab
- ✅ No backend, no auth, no networking — pure client-side
- ✅ Basic board UI (functional, not pretty)
- ✅ Vitest test suite for the engine

### What was explicitly cut from v1
- Deck builder UI (paste decklist instead)
- Bot/AI opponent
- Multiplayer
- Auth
- Card images / polished UI
- Full card set data

---

## Architecture Decisions

### Monorepo with pnpm workspaces (Decided)
Single repo, two packages: `engine` and `ui`.

**Why:** Engine and UI share TypeScript types directly via `workspace:*`.
Splitting into two repos would require publishing the engine to npm on every
type change, which is painful during early development.

**Future:** When/if the engine becomes a standalone library, the package
separation is already clean. Migration is straightforward.

### Engine is a pure function (Decided)
```
applyAction(state, action, definitions) → { newState, events, success, error }
```

No classes, no mutation, no side effects. `GameState` is a plain serializable
object. Same inputs always produce same outputs (except shuffle).

**Why:** Makes testing trivial. Makes multiplayer straightforward later —
just run the same function on the server and sync state. Makes replay/undo
possible. Makes bugs traceable.

### Card abilities are data, not code (Decided)
Each `CardDefinition` has an `abilities: Ability[]` array of structured data.
The engine interprets these via `applyEffect()`. Adding a new card never
requires changing the engine — only the card data file.

**Why:** Extensible without engine changes. Cards can be stored as JSON.
Future judge tool can read ability data directly.

**The key types:**
- `TriggeredAbility` — fires when an event occurs (enters play, quests, etc.)
- `ActivatedAbility` — player pays costs to use
- `KeywordAbility` — Evasive, Rush, Bodyguard, Ward, etc.
- `StaticAbility` — ongoing passive effects

### Tech Stack (Decided)

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | TypeScript strict mode | Catches rule logic bugs at compile time |
| Package manager | pnpm | Fast, local installs, monorepo support |
| Frontend | React 18 + Vite | Ecosystem, fast dev server |
| State management | Zustand | Simpler than Redux for game state |
| Styling | Tailwind CSS | Fast iteration |
| Tests | Vitest | TS-native, fast, same syntax as Jest |
| Future DB | Supabase | Postgres + Auth + Realtime in one |
| Future realtime | Liveblocks or Supabase Realtime | Purpose-built for multiplayer |

### Future multiplayer path (Planned, not built)
1. Extract engine to server (it's already pure — no changes needed)
2. Client becomes thin view layer
3. Add Supabase for auth (Google/Discord OAuth)
4. Add Liveblocks or Supabase Realtime for WebSocket state sync
5. Public matchmaking + private lobbies

Auth was explicitly chosen as "third party only" — Google, Discord, or
similar. No custom auth.

---

## What's Currently Built

### Engine (`packages/engine/src/`)

**`types/index.ts`** — Single source of truth for all game concepts.
All other files import from here. Read this first.
Key types: `CardDefinition`, `CardInstance`, `GameState`, `GameAction`,
`Ability`, `Effect`, `PlayerState`, `PendingChoice`

**`engine/validator.ts`** — Checks if an action is legal. Pure function.
Returns `{ valid: true }` or `{ valid: false, reason: string }`.

**`engine/reducer.ts`** — Applies validated actions to produce new state.
Main entry: `applyAction()`. Handles trigger stack processing and win condition.

**`engine/initializer.ts`** — Creates games from decklists. Parses plaintext
decklists (`4 Card Name` format). Shuffles and deals opening hands.

**`cards/sampleCards.ts`** — 20 card definitions covering every mechanic:
vanilla, Evasive, Rush, Bodyguard, Ward, Challenger, Support, Singer, Shift,
Resist, Reckless, triggered abilities (enters play / quests / banished),
activated abilities, actions, items, songs.

**`utils/index.ts`** — Pure helpers: `moveCard`, `updateInstance`,
`getInstance`, `getZone`, `hasKeyword`, `getEffectiveStrength`, etc.

### UI (`packages/ui/src/`)

**`store/gameStore.ts`** — Zustand store. Only place that calls the engine.
Exposes `dispatch(action)` and `gameState` to React components.

**`App.tsx`** — Setup screen (paste decklists) + game board. Currently one
file, intentionally minimal. Renders both players' zones, hands, action bar,
game log.

### Tests
43 tests, all passing. Pattern: inject cards directly into state via
`injectCard()` helper rather than relying on random opening hands.
Tests cover: initialization, playing cards, playing ink, questing,
challenging, keywords, triggered abilities, turn management, win condition.

---

## Known Gaps / Next Steps (Priority Order)

### 1. Pending choice UI (Most Important)
**Problem:** When an effect requires target selection (Merlin's ability,
Fire the Cannons), the engine sets `state.pendingChoice` and the game
freezes. The UI has no way to resolve it.

**What needs building:**
- Detect `pendingChoice` in state
- Highlight valid target cards (`pendingChoice.validTargets`)
- On click, dispatch `RESOLVE_CHOICE` with the chosen instanceId
- Handle the "no valid targets" edge case

### 2. Expand card pool
After pending choice works, add the next 20-30 cards. Strategy: pick cards
that cover mechanics not yet implemented, not just popular cards.

Community card data source: https://github.com/lorcanito/lorcana-data

### 3. Better board UI
Current cards are tiny stat boxes. Need:
- Proper card layout with name, stats, abilities text
- Visual distinction between exerted/ready
- Damage counter display
- Zone labels and card counts

### 4. Full set data ingestion
Pull from community JSON dataset instead of hand-entering cards.
Requires mapping their schema to our `CardDefinition` type.

### 5. Multiplayer (Future)
See multiplayer path above. Don't start until engine is solid and
card pool is meaningful.

---

## Future Projects (Not V1)

### Judge / Rules Oracle Tool
**Concept:** Hybrid of engine data + RAG over comprehensive rules PDF.

**Architecture:**
- Simple card questions ("what does Gaston cost?") → answered directly
  from card definitions, deterministically, no LLM needed
- Rules questions ("what does Bodyguard do?") → RAG over rules PDF with
  strict citation requirement
- Complex interactions → both sources + LLM reasoning, always show sources,
  flag low confidence

**Key insight:** Card implementations in the engine are a first-class data
source for the judge tool. As more cards are implemented, the judge tool
gets more accurate automatically. The two projects reinforce each other.

**Hallucination mitigations:**
1. RAG — model reasons from retrieved text, not memory
2. Forced citation — must cite rule section, can't answer without one
3. Engine validation — LLM claims can be spot-checked against engine
4. Confidence flagging — low confidence answers get visible warnings
5. Community correction layer (later) — users flag wrong answers

**When to build:** After meaningful card pool exists (50+ cards).
Not worth building now with only 20 sample cards.

**Note:** The comprehensive rules PDF covers mechanics abstractly.
Individual card rulings are covered by card implementations in the engine.
Neither source alone is complete — the hybrid approach covers both.

### Sealed/Draft Simulator
**Concept:** Generate accurate booster packs, build a sealed deck, playtest it.
Useful for prerelease practice.

**Why it's interesting:** Less covered than full simulator or pack opening
sites. The sealed deck building + playtesting loop has standalone value.

**Dependency:** Needs the full simulator working underneath it.
Pack generation needs accurate pull rates (documented by community).

**When to build:** After v1 simulator is solid and has real card data.

---

## Workflow Notes

### Claude.ai vs Claude Code
- **Claude.ai** (here) — strategy, architecture, tradeoffs, planning
- **Claude Code** — implementation, running tests, editing files, refactoring

They don't share memory. To maintain context:
1. Keep this file updated with decisions
2. Keep README.md updated with technical details
3. Paste relevant sections at start of new sessions

### Starting a new Claude Code session
Paste this at the start:
```
This is a Lorcana TCG simulator monorepo. Engine in packages/engine 
(pure TypeScript rule engine, no browser deps). UI in packages/ui 
(React + Zustand). All 43 tests passing. Read DECISIONS.md and README.md 
for full context. 
```

Then describe what you want to work on.

### Starting a new Claude.ai session
Paste this at the start:
```
I'm building a Lorcana TCG simulator. Read the attached DECISIONS.md 
for full context on what's been decided and what's next.
```
Then attach or paste the relevant sections of this file.

---

## Open Questions (Unresolved)

- **Card images:** Host them ourselves, link to community sources, or skip
  for now and use text-only cards? Legal/IP implications unclear.
- **IP/Legal:** Fan simulators operate in a grey zone. How Duels.ink handles
  this is worth researching before going public.
- **Mobile:** Desktop-first for now. Touch interactions for a card game UI
  are non-trivial. Revisit after desktop is solid.
- **Spectator mode:** Interesting for multiplayer but significantly
  complicates real-time architecture. Defer.
- **Replay system:** Useful for debugging engine bugs and fun for users.
  GameState is already serializable so technically feasible. Defer.

---

*Last updated: Session 1 — Initial architecture and v1 boilerplate*
