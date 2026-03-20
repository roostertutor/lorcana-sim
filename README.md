# Lorcana Simulator

A web-based Disney Lorcana TCG simulator with a data-driven rule engine.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| pnpm | ≥ 9 | `npm install -g pnpm` |

> **Why pnpm?** It's the Node equivalent of Python's `.venv` — all packages install
> locally into `node_modules` inside the repo. Nothing is installed globally.
> The `pnpm-workspace.yaml` at the root tells pnpm this is a monorepo.

---

## Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd lorcana-sim

# 2. Install all dependencies (installs for all packages at once)
pnpm install

# That's it. node_modules is local to this repo.
```

---

## Running the Project

```bash
# Start the UI dev server (http://localhost:3000)
pnpm dev

# Run the rule engine tests
pnpm test

# Run tests in watch mode (re-runs on file save — great while building the engine)
pnpm test:watch

# Type-check everything
pnpm typecheck
```

---

## Project Structure

```
lorcana-sim/
├── pnpm-workspace.yaml        ← Declares this as a pnpm monorepo
├── tsconfig.base.json         ← Shared TypeScript settings
├── package.json               ← Root scripts (dev, test, build)
│
└── packages/
    ├── engine/                ← The rule engine (pure TypeScript, no UI)
    │   └── src/
    │       ├── types/
    │       │   └── index.ts   ← ALL game concepts as TypeScript types
    │       ├── engine/
    │       │   ├── reducer.ts      ← Applies actions, produces new state
    │       │   ├── validator.ts    ← Checks if actions are legal
    │       │   ├── initializer.ts  ← Creates games, parses decklists
    │       │   └── reducer.test.ts ← Tests (run with `pnpm test`)
    │       ├── cards/
    │       │   └── sampleCards.ts  ← 20 cards covering every mechanic
    │       ├── utils/
    │       │   └── index.ts        ← Pure helper functions
    │       └── index.ts            ← Public API
    │
    └── ui/                    ← React frontend
        └── src/
            ├── store/
            │   └── gameStore.ts    ← Zustand store, connects engine to React
            ├── App.tsx             ← Setup screen + game board
            ├── main.tsx            ← React entry point
            └── index.css           ← Tailwind imports
```

---

## How to Play (Local Singleplayer)

1. Run `pnpm dev` and open http://localhost:3000
2. Paste a decklist for each player (or use the default)
3. Click **Start Game**
4. Click a card to select it, then use the action buttons that appear
5. Click **Pass Turn →** when done

### Decklist Format

```
4 Moana - Of Motunui
4 Simba - Protective Cub
3 Elsa - Snow Queen
...
```

- `4 Card Name` or `4x Card Name` — both work
- Card names are matched case-insensitively against `fullName` or `name` in the definitions
- Lines starting with `//` or `#` are treated as comments

### Available Sample Cards

| Card | Mechanic tested |
|------|----------------|
| Simba - Protective Cub | Vanilla (no abilities) |
| Stitch - Rock Star | Vanilla filler |
| Moana - Of Motunui | Vanilla, high cost |
| Tinker Bell - Tiny Tactician | **Evasive** |
| Beast - Hardheaded | **Rush** |
| Gaston - Boastful Hunter | **Bodyguard** |
| Elsa - Snow Queen | **Ward** |
| Hercules - Hero in Training | **Challenger +2** |
| Pascal - Rapunzel's Companion | **Support** |
| Rapunzel - Letting Down Her Hair | **Triggered** (enters play → draw 1) |
| Merlin - Arthurian Legend | **Activated ability** (↷, 2⬡: deal 1 damage) |
| Ariel - On Human Legs | **Singer 5** |
| Moana - Chosen by the Ocean | **Shift 5**, Ward, triggered (quests → draw 2) |
| Maui - Hero to All | **Resist +2** |
| Hades - Lord of the Underworld | **Reckless** |
| Mickey Mouse - Wayward Sorcerer | **Triggered** (quests → draw 1) |
| Genie - On the Job | **Triggered** (banished → draw 2) |
| Be Our Guest | **Song** (action) |
| Fire the Cannons! | **Action** (deal 2 damage) |
| Fishbone Quill | **Item** with activated ability |

---

## Architecture

### The Core Loop

```
User clicks something
    ↓
UI dispatches a GameAction to the store
    ↓
Store calls applyAction(currentState, action, definitions)
    ↓
Validator checks legality → rejects with error if illegal
    ↓
Reducer applies the action → produces newState + events[]
    ↓
Trigger stack is processed (abilities fire, stack unwinds)
    ↓
Win condition is checked
    ↓
Store updates → React re-renders
```

### Key Design Decisions

#### GameState is a plain object

`GameState` contains no classes, no methods, no functions. It's a serializable JSON snapshot. This means:
- Easy to save/load/replay
- Easy to transmit over WebSockets when you add multiplayer
- Easy to test (just compare objects)

#### Card abilities are data, not code

Each `CardDefinition` has an `abilities: Ability[]` array. Abilities are structured data interpreted by the engine:

```typescript
// This is how a card says "when this enters play, draw a card"
abilities: [{
  type: "triggered",
  trigger: { on: "enters_play" },
  effects: [{ type: "draw", amount: 1, target: { type: "self" } }]
}]
```

The engine's `applyEffect()` function interprets these. Adding a new card **never requires changing the engine** — only the card's data file.

#### Immutable state updates

The reducer never mutates state. Every update produces a new object:

```typescript
// Wrong — mutates
state.players.player1.lore += 1;

// Right — produces new state
return { ...state, players: { ...state.players, player1: { ...state.players.player1, lore: state.players.player1.lore + 1 } } };
```

This is verbose but makes bugs much easier to find (you can always compare old and new state).

---

## Adding a New Card

1. Open `packages/engine/src/cards/sampleCards.ts`
2. Add a new `CardDefinition` to the `SAMPLE_CARDS` array
3. Write a test in `reducer.test.ts` that exercises the new mechanic
4. Run `pnpm test` to confirm it works

Example — a card that draws a card when it challenges:

```typescript
{
  id: "my-new-card",
  name: "My Character",
  subtitle: "Cool Version",
  fullName: "My Character - Cool Version",
  cardType: "character",
  inkColor: "sapphire",
  cost: 3,
  inkable: true,
  traits: ["Hero"],
  strength: 3,
  willpower: 3,
  lore: 1,
  abilities: [
    {
      type: "triggered",
      trigger: { on: "challenges" },
      effects: [
        { type: "draw", amount: 1, target: { type: "self" } }
      ]
    }
  ],
  setId: "TFC",
  number: 999,
  rarity: "common",
}
```

---

## Adding a New Effect Type

If a card needs an effect the engine doesn't handle yet:

1. Add the new type to the `Effect` union in `packages/engine/src/types/index.ts`
2. Handle the new type in `applyEffect()` in `reducer.ts`
3. Write a test for it

---

## Roadmap

### v1 (current)
- [x] Rule engine core (play, ink, quest, challenge, pass turn)
- [x] All major keywords (Evasive, Rush, Bodyguard, Ward, Challenger, Reckless, Support, Resist, Singer, Shift)
- [x] Triggered abilities (enters play, quests, challenges, banished, turn start/end)
- [x] Activated abilities with costs
- [x] Decklist paste + parser
- [x] Singleplayer local (control both sides)
- [x] Basic board UI

### v2
- [ ] Better card UI (actual card art, proper layout)
- [ ] Deck builder
- [ ] Full card search (Scryfall-style)
- [ ] Real card data from community dataset

### v3
- [ ] Auth (Supabase + Google/Discord)
- [ ] Persist decklists per user
- [ ] Real-time multiplayer (Liveblocks or Supabase Realtime)
- [ ] Public matchmaking + private lobbies

### v4
- [ ] Location cards
- [ ] Challenge actions
- [ ] All missing card effects

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript | Type safety critical for game logic |
| Package manager | pnpm | Fast, local installs, monorepo support |
| Monorepo | pnpm workspaces | Engine and UI share types without duplication |
| Frontend | React 18 | Ecosystem, hooks make game state clean |
| State | Zustand | Simpler than Redux, great for game state |
| Styling | Tailwind CSS | Fast iteration on game board layout |
| Build | Vite | Near-instant dev server restarts |
| Tests | Vitest | TS-native, fast, same syntax as Jest |
| Future DB | Supabase | Postgres + Auth + Realtime in one |
| Future realtime | Liveblocks | Purpose-built for multiplayer |

---

## Development Tips

**Test the engine separately from the UI.** The engine is pure TypeScript with no browser dependencies. You can run `pnpm test:watch` in one terminal and `pnpm dev` in another — as you build out card effects, tests verify correctness before you touch the UI.

**The trigger stack can loop.** If you write a card that triggers itself infinitely, the engine has a `safety > 100` guard that throws. Check your trigger conditions.

**Pending choices block the game.** When an effect requires the player to choose a target, `state.pendingChoice` is set and no other actions are legal until `RESOLVE_CHOICE` is dispatched. The UI needs to handle this by showing the choice prompt.
