# Lorcana Sim

Headless Disney Lorcana TCG analytics engine. Simulates thousands of games
to produce deck analytics, win rates, and card performance data.

Not a human-playable simulator — built for quantitative deck analysis.

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

All commands run from the repo root. Deck files live in `decks/`, query files in `queries/`.

### Analyze a single deck (mirror match)

```bash
pnpm analyze -- --deck ./decks/set-001-ruby-amethyst-deck.txt --bot greedy --iterations 1000
```

Runs the deck against itself and prints win rate, average game length, and per-card performance stats.

### Compare two decks head-to-head

```bash
pnpm compare -- --deck1 ./decks/set-001-ruby-amethyst-deck.txt --deck2 ./decks/lilo-stitch-deck.txt --bot aggro --iterations 500
```

### Goldfish (solo questing, opponent does nothing)

```bash
pnpm compare -- --deck1 ./decks/set-001-ruby-amethyst-deck.txt --deck2 ./decks/goldfish-deck.txt --bot greedy --iterations 500
```

The goldfish deck is 60 uninkable cards — the opponent can never ink or play anything and just passes every turn.

### Optimize bot weights

```bash
pnpm optimize -- --deck ./decks/set-001-ruby-amethyst-deck.txt --opponent aggro --iterations 500
```

Searches for the best `BotWeights` for a deck against a given opponent style.

### Weight sweep (3x3 grid)

```bash
pnpm sweep -- --deck ./decks/set-001-ruby-amethyst-deck.txt --opponent control --iterations 200
```

### Query (condition-based analysis)

```bash
# One-shot: simulate + query
pnpm query -- --sim queries/aladdin-sim.json --questions queries/aladdin-questions.json

# Save results for later
pnpm query -- --sim queries/aladdin-sim.json --questions queries/aladdin-questions.json --save aladdin.sim-results.json

# Re-query saved results instantly
pnpm query -- --questions queries/aladdin-questions.json --results aladdin.sim-results.json
```

Ask condition-based questions like "how often is Aladdin played on-curve, and what's the win rate when it happens?" See `docs/QUERY_SYSTEM.md` for the full condition language.

### Save simulation results

All commands that run simulations support `--save ./path.json` to persist results for later querying:

```bash
pnpm analyze -- --deck ./decks/set-001-ruby-amethyst-deck.txt --bot greedy --iterations 5000 --save my-results.sim-results.json
pnpm query -- --questions queries/aladdin-questions.json --results my-results.sim-results.json
```

## Bot Strategies

| Name | Style |
|------|-------|
| `random` | Uniformly random legal action (baseline) |
| `greedy` | Fixed priority: quest > favorable challenge > play card > ink > pass |
| `probability` | Weight-based position evaluation (midrange preset) |
| `aggro` | Race to 20 lore, minimal board interaction |
| `control` | Board dominance, slow lore accumulation |
| `midrange` | Balanced lore and board |
| `rush` | Fast cheap cards, high urgency |

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

Opens at `http://localhost:5173`. Five screens:

| Screen | What it does |
|--------|-------------|
| **Deck Input** | Paste a decklist, validate it, load the sample deck |
| **Composition** | Cost curve, ink colors, inkable probability by turn, card types |
| **Simulate** | Mirror match simulation with card performance breakdown |
| **Compare** | Two-deck head-to-head matchup |
| **Weight Explorer** | Tune bot weight sliders, compare against preset strategies |

All simulations run in-browser — no server needed.

## Project Structure

```
packages/
  engine/       Pure game rules. No UI, no bot logic.
  simulator/    Game loop + bots. Imports engine only.
  analytics/    Aggregation + composition. Imports engine + simulator.
  cli/          Terminal commands. Imports analytics only.
  ui/           React + Vite. Imports analytics only.
decks/          Sample decklists (.txt)
queries/        Query sim configs + question files (.json)
```

## Card Coverage

Set 1 (The First Chapter): 216 cards total, 106 fully implemented, 110 stubs.
Stub cards are playable as vanilla characters — their named abilities just don't
trigger yet. Keyword-only cards (Rush, Evasive, Bodyguard, etc.) work correctly.

## Tests

```bash
pnpm test           # all packages (engine: 49 pass + 5 todo, simulator: 3, analytics: 15)
pnpm test:watch     # engine TDD mode
pnpm typecheck      # known errors in cli (missing @types/node) only
```
