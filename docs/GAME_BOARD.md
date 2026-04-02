# GAME_BOARD.md
# Spec for the interactive game board — test bench first, pretty board second.
# Lives in packages/ui. Uses the existing engine and simulator packages.
# Do not modify engine, simulator, analytics, or cli packages.

---

## Purpose

A way to play and test implemented cards interactively.
Primary use case: verify card interactions work correctly, solo playtesting at 3am.
Secondary use case: real-time analysis overlay while playing.

This is NOT the multiplayer board. That comes later and builds on this.
This is NOT the analytics UI. That already exists in other pages.

---

## Build Order

1. `useGameSession` hook — the permanent logic layer
2. `TestBench.tsx` — ugly but functional, built first, temporary
3. `GameBoard.tsx` — pretty, built second, replaces TestBench visually
4. Analysis overlay — added to GameBoard after basic play works

TestBench.tsx is scaffolding. useGameSession.ts is permanent.
Never write game logic in a component — always in the hook.

---

## Phase 1: useGameSession Hook ✅ IMPLEMENTED

Location: `packages/ui/src/hooks/useGameSession.ts`

This is the most important file. Everything else depends on it.
The hook encapsulates all game logic so components stay dumb.

```typescript
interface GameSessionState {
  // Core game state
  gameState: GameState | null
  isGameOver: boolean
  winner: PlayerID | null

  // What the current player can do
  legalActions: GameAction[]

  // Selection state (what the player has clicked)
  selectedInstanceId: string | null

  // Pending choice state (when engine needs a decision)
  pendingChoice: PendingChoice | null

  // Analysis (computed after every action)
  analysis: PositionAnalysis | null
  isAnalyzing: boolean

  // Log
  actionLog: GameLogEntry[]

  // Error state
  error: string | null
}

interface GameSessionActions {
  // Start a new game
  startGame(config: GameSessionConfig): void

  // Dispatch a game action (play card, quest, challenge, etc.)
  dispatch(action: GameAction): void

  // UI selection helpers
  selectCard(instanceId: string | null): void

  // Resolve a pending choice
  resolveChoice(choice: string[] | number | "accept" | "decline"): void

  // Reset
  reset(): void
}

interface GameSessionConfig {
  player1Deck: DeckEntry[]
  player2Deck: DeckEntry[]
  definitions: Record<string, CardDefinition>
  // Which sides are human-controlled
  player1IsHuman: boolean
  player2IsHuman: boolean
  // Bot strategy for AI-controlled sides
  botStrategy?: BotStrategy
  // Whether to run analysis after each action
  enableAnalysis?: boolean
  // How many sim games for analysis (default 200)
  analysisIterations?: number
}

interface PositionAnalysis {
  // Win probability for current player from this position
  winProbability: number
  // What the bot would play from here
  suggestedAction: GameAction | null
  suggestedActionLabel: string | null
  // How much win% the suggested action gains vs average
  suggestedActionDelta: number
  // Raw position factors from evaluator
  factors: PositionFactors
  // How many simulations this is based on
  simulationCount: number
}
```

### Key behaviors

**Bot turns:** When it's an AI player's turn, the hook automatically
calls `bot.decideAction()` and dispatches it. No human input needed.
Add a small delay (300ms) so the UI doesn't flicker.

**Pending choices:** When `gameState.pendingChoice` is set, `legalActions`
returns only `RESOLVE_CHOICE` variants. The UI shows the choice prompt.

**Analysis:** After every successful `dispatch()`, if `enableAnalysis` is true,
run `analyzePosition()` in the background. Set `isAnalyzing: true` while running.
Use `setTimeout(fn, 0)` to not block the UI render.

**Transport abstraction:** The hook calls `applyAction` locally for solo play.
When multiplayer is added, this is the ONLY place that changes — swap
local `applyAction` for a server API call. Components never change.

```typescript
// Solo play (current)
const result = applyAction(gameState, action, definitions)

// Multiplayer (future, same interface)
const result = await api.postAction(gameId, action)
```

### Analysis implementation

```typescript
async function analyzePosition(
  state: GameState,
  config: GameSessionConfig
): Promise<PositionAnalysis> {
  const iterations = config.analysisIterations ?? 200

  // Run N simulations from current state using GreedyBot
  // (fast enough for real-time, directionally correct)
  const results = runSimulationFromState({
    startingState: state,
    player1Deck: config.player1Deck,
    player2Deck: config.player2Deck,
    player1Strategy: GreedyBot,
    player2Strategy: GreedyBot,
    definitions: config.definitions,
    iterations,
  })

  const currentPlayer = state.currentPlayer
  const wins = results.filter(r => r.winner === currentPlayer).length
  const winProbability = wins / iterations

  // Get bot suggestion
  const probs = computeDeckProbabilities(state, currentPlayer, config.definitions)
  const suggested = GreedyBot.decideAction(
    state, currentPlayer, config.definitions
  )

  // Score the suggested action
  const afterSuggested = applyAction(state, suggested, config.definitions)
  const { factors } = evaluatePosition(
    afterSuggested.newState, currentPlayer, probs, MidrangeWeights
  )

  return {
    winProbability,
    suggestedAction: suggested,
    suggestedActionLabel: actionToLabel(suggested, state, config.definitions),
    suggestedActionDelta: 0, // TODO: compare to average action score
    factors,
    simulationCount: iterations,
  }
}
```

---

## Phase 2: TestBench.tsx ✅ IMPLEMENTED

Location: `packages/ui/src/pages/TestBench.tsx`

Ugly. Functional. Temporary.
Purpose: verify cards work correctly during engine development.
Will be replaced by GameBoard.tsx. Logic stays in useGameSession.

### What it shows

```
[Deck Setup]
P1 Deck: [textarea]   P2 Deck: [textarea]
[Start Game]

────────────────────────────────────────
Turn 3 | Player 1's turn | P1: 8 lore | P2: 6 lore

PLAYER 2 BOARD:
  Gaston - Boastful Hunter (STR 5 WP 5) [EXERTED]
  Stitch - Rock Star (STR 2 WP 2)

PLAYER 1 HAND:
  [Simba - Protective Cub (cost 1)] [Moana - Of Motunui (cost 5)] 
  [Fire the Cannons! (cost 1)] [Elsa - Snow Queen (cost 6)]

PLAYER 1 BOARD:
  Mickey Mouse - True Friend (STR 3 WP 3) [READY]

LEGAL ACTIONS:
  [Quest with Mickey Mouse (+2 lore)]
  [Challenge Gaston with Mickey Mouse]
  [Play Simba - Protective Cub (1 ink)]
  [Ink Moana - Of Motunui]
  [Pass Turn]

GAME LOG:
  [T3 P1] Played Mickey Mouse - True Friend
  [T2 P2] Gaston - Boastful Hunter entered play exerted (Bodyguard)
  [T2 P1] Quested with Simba (+1 lore)
  ...
```

No card art. No drag and drop. Just buttons and text.
Clicking a card selects it. Clicking a legal action dispatches it.

### Pending choice handling

When `pendingChoice` is set, show:

```
CHOOSE A TARGET:
Prompt: "Choose a character to deal 1 damage to"
  [Gaston - Boastful Hunter (5 WP, 0 damage)]
  [Stitch - Rock Star (2 WP, 0 damage)]
  [Cancel / Decline]
```

---

## Phase 3: GameBoard.tsx

Location: `packages/ui/src/pages/GameBoard.tsx`

Pretty version. Same `useGameSession` hook. Different components.
Build this after TestBench confirms everything works correctly.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  ⬡ Lorcana Sim    P1: 8 lore ████░░░░░░ P2: 6 lore  │
│  Turn 3 — Player 1's turn     Win prob: P1 62%       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  [P2 Hand — face down]  ┌──────────────────────────┐│
│  3 cards                │  P2 Board                ││
│                         │  [Gaston exerted]        ││
│                         │  [Stitch ready]          ││
│                         └──────────────────────────┘│
│                         ┌──────────────────────────┐│
│                         │  P1 Board                ││
│                         │  [Mickey ready]          ││
│                         └──────────────────────────┘│
│  [P1 Hand]                                           │
│  [Simba][Moana][Fire!][Elsa]                         │
├─────────────────────────────────────────────────────┤
│  Action Bar (context-sensitive)                      │
│  Selected: Mickey Mouse  [Quest +2] [Challenge Gaston│
│                                                      │
│  Suggested: Quest with Mickey Mouse (+9% win prob)   │
│                                          [Pass Turn] │
├─────────────────────────────────────────────────────┤
│  Log: [T3 P1] Played Mickey... [T2 P2] Gaston...    │
└─────────────────────────────────────────────────────┘
```

### Analysis overlay

Win probability bar updates after every action.
Bot suggestion shown with win% delta.
Position factors available in a collapsible "Analysis" panel.

```
Win Probability
P1 ████████████░░░░ 62%   P2 38%

Bot suggests: Quest with Mickey Mouse
Expected: +9% win probability

▼ Position Breakdown
  Lore advantage:  +0.4
  Board advantage: +0.2
  Hand advantage:  +0.1
  Deck quality:    0.6
  Urgency:         0.3
```

### Card component

Each card shows:
- Name + subtitle
- Cost, STR/WP/Lore (if character)
- Exerted state (rotated 90°)
- Damage counters
- Drying indicator (can't act yet)
- Highlight when selected or is a valid target

No card art for now. Ink color as background tint.
Card art can be added later without changing any logic.

---

## Phase 4: Multiplayer Integration

When multiplayer is ready, `useGameSession` is the ONLY file that changes.

```typescript
// Add to GameSessionConfig:
interface GameSessionConfig {
  // ... existing fields ...
  
  // Multiplayer mode
  mode: "solo" | "multiplayer"
  gameId?: string           // for multiplayer
  localPlayerId?: PlayerID  // which side this client controls
}

// In dispatch():
if (config.mode === "multiplayer") {
  // Send to server, wait for broadcast
  await serverApi.postAction(config.gameId!, action)
  // State update comes via Supabase Realtime subscription
} else {
  // Local applyAction (existing)
  const result = applyAction(gameState, action, definitions)
  setGameState(result.newState)
}
```

Components never know the difference. The board looks identical for solo and multiplayer.

---

## runSimulation needs startingState

One engine change required. Add optional `startingState` to `runGame`:

```typescript
// packages/simulator/src/runGame.ts
export function runGame(config: SimGameConfig): GameResult {
  let state: GameState = config.startingState  // NEW optional field
    ?? createGame(
        { player1Deck: config.player1Deck, player2Deck: config.player2Deck },
        config.definitions
       )
  // rest of function unchanged
}

// Add to SimGameConfig in types.ts:
interface SimGameConfig {
  // ... existing fields ...
  startingState?: GameState  // NEW — for mid-game analysis injection
}
```

This is a 3-line change. It unlocks:
- Real-time analysis from any mid-game position
- "What if I'd played differently?" injection
- Board state import for analysis

---

## Add to App.tsx

Add TestBench (and later GameBoard) as a tab:

```typescript
const TABS = [
  { id: "deck", label: "Deck Input" },
  { id: "composition", label: "Composition", requiresDeck: true },
  { id: "simulate", label: "Simulate", requiresDeck: true },
  { id: "compare", label: "Compare" },
  { id: "weights", label: "Weight Explorer", requiresDeck: true },
  { id: "testbench", label: "Test Bench", requiresDeck: true },  // NEW
  // { id: "board", label: "Play" }  // later replaces testbench
]
```

---

## What NOT to Build Yet

- Drag and drop (click is enough for testing)
- Card art (ink color tint is sufficient)
- Animations (correctness first)
- Mobile layout (desktop only for now)
- Undo/redo (out of scope)
- Chat (multiplayer feature)
- Spectator mode (multiplayer feature)
- Matchmaking (separate server spec)