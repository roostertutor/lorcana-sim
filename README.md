# Lorcana Sim

> **⚠️ Sunset 2026-07-18 — active development stopped.** Not broken, just paused at a
> natural stopping point. See [`SUNSET.md`](./SUNSET.md) for why, what's worth keeping
> (the engine + card corpus are the crown jewels), the still-useful solo scouting tools,
> and how to wind down the deployed server/UI. If restarting, begin at `packages/engine/`.

Headless Disney Lorcana TCG analytics engine. Simulates thousands of games
to produce deck analytics, win rates, and card performance data.

Also includes an interactive sandbox for solo play vs bot, and a multiplayer
server for real opponent games.

## Quick Start

```bash
# Prerequisites: Node >=20, pnpm >=9
pnpm install

# Run all tests
pnpm test

# Start the UI
pnpm dev            # http://localhost:5173
```

## CLI Commands

All commands run from the repo root. Deck files live in `decks/`, query files in `sims/`.

### Analyze a single deck (mirror match)

```bash
pnpm analyze -- --deck ./decks/set-001-ruby-amethyst-deck.txt --bot greedy --iterations 1000
```

Runs the deck against itself and prints win rate, average game length, and per-card performance stats.

### Compare two decks head-to-head

```bash
pnpm compare -- --deck1 ./decks/set-001-ruby-amethyst-deck.txt --deck2 ./decks/goldfish-deck.txt --bot greedy --iterations 500
```

### Goldfish (solo questing, opponent does nothing)

```bash
pnpm compare -- --deck1 ./decks/set-001-ruby-amethyst-deck.txt --deck2 ./decks/goldfish-deck.txt --bot greedy --iterations 500
```

The goldfish deck is 60 uninkable cards — the opponent can never ink or play anything and just passes every turn.


### Query (condition-based analysis)

```bash
# One-shot: simulate + query
pnpm query -- --sim sims/set-001-ruby-amethyst/sim.json --questions sims/set-001-ruby-amethyst/turn3-questions.json

# Save results for later
pnpm query -- --sim sims/set-001-ruby-amethyst/sim.json --questions sims/set-001-ruby-amethyst/turn3-questions.json --save results/ruby-amethyst.json

# Re-query saved results instantly
pnpm query -- --questions sims/set-001-ruby-amethyst/turn3-questions.json --results results/ruby-amethyst.json
```

Ask condition-based questions like "how often is Magic Broom played on T2, and what's the win rate when it happens?" See `docs/QUERY_SYSTEM.md` for the full condition language.

### Save simulation results

All commands that run simulations support `--save ./path.json` to persist results for later querying:

```bash
pnpm analyze -- --deck ./decks/set-001-ruby-amethyst-deck.txt --bot greedy --iterations 5000 --save results/ruby-amethyst.json
pnpm query -- --questions sims/set-001-ruby-amethyst/turn3-questions.json --results results/ruby-amethyst.json
```

## Bot Strategies

| Name | Style |
|------|-------|
| `random` | Uniformly random legal action (baseline) |
| `greedy` | Fixed priority: quest > favorable challenge > play card > ink > pass |
| `rl` | Trained neural network policy — requires `--policy <path>` |

## Deck Format

Plain text, one entry per line. Lines starting with `#` or `//` are comments.

```
4 HeiHei - Boat Snack
4 Stitch - New Dog
4 Simba - Protective Cub
# This is a comment
4 Minnie Mouse - Beloved Princess
```

Card names must match the Lorcast card database (case-insensitive). Use the full
`Name - Title` format.

## Web UI

```bash
pnpm dev
```

Opens at `http://localhost:5173`. Seven screens:

| Screen | What it does |
|--------|-------------|
| **Decks** | Saved decks, deckbuilder, composition view |
| **Simulate** | Mirror match simulation with card performance breakdown |
| **Sandbox** | Interactive game board vs bot with replay, undo, DnD, card injector |
| **Multiplayer** | Lobby, matchmaking, ELO ratings, Bo1/Bo3, Core/Infinity formats |
| **Me** | Profile, game history, display name |
| **Replays** | Browse and share multiplayer replays |
| **Solo** | Quick solo game without multiplayer setup |

Simulations run in-browser. Multiplayer requires the Hono server (`server/`).

## Project Structure

```
packages/
  engine/       Pure game rules. No UI, no bot logic.
  simulator/    Game loop + bots. Imports engine only.
  analytics/    Aggregation + composition. Imports engine + simulator.
  cli/          Terminal commands. Imports analytics only.
  ui/           React + Vite. Imports analytics only.
server/         Hono + Supabase multiplayer server.
decks/          Sample decklists (.txt)
sims/           Query sim configs + question files (.json)
```

## Card Coverage

Sets 1–12 + promos (P1, P2, P3, cp, DIS, D23, C1, C2): **2896 cards total, 100% implemented.**
All named abilities wired. 0 stubs, 0 partial, 0 approximations.

## Tests

```bash
pnpm test           # all packages (engine: 662, simulator: 47, analytics: 15)
pnpm test:watch     # engine TDD mode
pnpm typecheck      # known errors from exactOptionalPropertyTypes strictness
```
