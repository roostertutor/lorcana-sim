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

## Phase 3: GameBoard.tsx ✅ IMPLEMENTED

Location: `packages/ui/src/pages/GameBoard.tsx`

Pretty version. Same `useGameSession` hook. Different components.

### What's built

**Card component (GameCard.tsx):**
- Name + subtitle, cost, STR/WP/lore (characters), inkable indicator (hand)
- Ink color gradient background + border
- Exerted state (rotated 90° + opacity-80), damage badge, drying badge
- EXR text badge only renders alongside DRY/damage badges (inside shared conditional); 90° rotation is the primary exerted signal
- `isSelected` / `isTarget` (pulse ring) / `isAttacker` (solid ring) props
- Disambiguation badge overlay "(1)"/"(2)" when pending choice has duplicate names

**Card-contextual actions (Session 19):**
- Per-card button row: Play / Ink / Quest / Challenge / Shift / Sing / Activate
- No flat "Actions" bar — actions belong to the card they affect
- 2-step Challenge: click Challenge → attacker highlighted orange → click enemy target
- 2-step Shift: click Shift → hand card highlighted → click play zone target
- "Challenge mode" / "Shift mode" banner + Cancel shown during 2-step flows
- Pass Turn button always visible at bottom

**Pending choice UI (Session 20: PendingChoiceModal):**
- All choice types now render in a modal overlay (not inline in the board scroll area)
- Desktop: centered dark panel `max-w-lg`; Mobile: bottom sheet with drag handle
- Backdrop click hides the modal so the player can peek at the board; "View Choice" pill restores it
- New pending choice auto-restores the modal (useEffect on `session.gameState?.pendingChoice`)
- Mulligan: card buttons to select/deselect; "Keep All" or "Put back N"
- choose_target / choose_cards / choose_discard / choose_from_revealed: labeled buttons
- choose_may: Accept / Decline with "Tap outside to peek" hint
- choose_option: Option 1, 2, ...
- Duplicate-named cards get "(1)"/"(2)" suffix in buttons AND board badge overlay
- "Opponent is thinking..." shown inline (not a modal) when it's the bot's choice

**Effect log (Session 19):**
- Triggered ability fires: "[Card]'s ability 'NAME' triggered."
- After heal effect resolves: "Removed N damage from [Card]."
- After draw effect resolves: "Drew N card(s)."

**Analysis overlay:**
- Win probability bar (P1 vs P2), updates after every action
- AnalysisPanel: position factors (lore/board/hand/ink advantage)
- File picker → upload RLPolicy JSON → label shows "RL est." vs "GreedyBot est."

**Drag and drop (Session 20, @dnd-kit/core):**
- Hand card → play zone: PLAY_CARD
- Hand card → inkwell header: PLAY_INK (blue ring feedback)
- Hand card → own character in play: shift (PLAY_CARD + shiftTargetInstanceId)
- Own ready character → exerted opponent: CHALLENGE
- PointerSensor (distance: 8px) preserves tap-to-select; TouchSensor (delay: 150ms) preserves scroll
- DragOverlay: floating card follows cursor, 80% opacity + slight rotate
- Drop zones pulse green when valid, dim when invalid

**Bug fixes shipped (Session 18–19):**
- Items/locations/actions can no longer be challenged (CRD 4.6.2)
- Self-trigger filter now applied correctly (fixed ADORING FANS firing on own play)
- Engine-level mulligan CRD 2.2.2: choose_mulligan phase before game begins

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

## App.tsx — Current State ✅

Four tabs. GameBoard launches from within the Sandbox tab (full-screen, hides nav).

```typescript
type Tab = "decks" | "simulate" | "testbench" | "multiplayer"

const TABS = [
  { id: "decks",       label: "Decks" },
  { id: "simulate",    label: "Simulate" },
  { id: "testbench",   label: "Sandbox" },    // launches TestBench → GameBoard full-screen
  { id: "multiplayer", label: "Multiplayer" }, // launches MultiplayerLobby
]
```

WeightExplorer tab was deleted. CompositionView, DeckInput, ComparisonView exist as
page components used within DecksPage/SimulationView — not standalone tabs.

---

## Known Limitations

**Undo is per-`GameAction`, not per-card-play.**
Each `RESOLVE_CHOICE` is a separate recorded action. Playing a card with a triggered ability
that requires multiple choices (e.g. Ariel - On Human Legs: look at top 4, pick one, rest go
to bottom) requires one undo click per step to fully reverse — not one click for the whole
play. For example: PLAY_CARD + RESOLVE_CHOICE + RESOLVE_CHOICE = 3 undo clicks.

This is transparent and predictable but can be annoying for complex cards. Two future options
if this becomes a pain:
- **Checkpoint undo**: mark a checkpoint before each card play; one undo reverts to the
  checkpoint (requires tracking which actions belong to the same "play event").
- **Skip-choice undo**: undo automatically steps back past RESOLVE_CHOICE entries to the
  preceding non-choice action.

**Undo is disabled during bot turns.**
The Undo button only appears when it's the human's turn (`canUndo && !pendingChoice && isYourTurn`).
Bot actions are recorded in `actionHistory[]` and undo does step back through them correctly,
but the button is hidden while the bot is playing to avoid confusing mid-bot-turn states.
If you want to undo a bot action, you currently have to wait for the bot to finish its turn,
then undo once (to reverse the bot's last action), then undo again if needed.
Future option: show undo at any time including during bot turns.

**Bot resolves choices randomly.**
When a triggered ability or effect requires a target (e.g. "deal 2 damage to chosen character"),
the bot picks a random valid target rather than the strategically best one. This affects the
quality of games played against GreedyBot and RandomBot. The RL bot has a choice resolver but
it's also not fully optimal. Tracked as ❌ in ROADMAP.md ("Smart choice resolution").

**Branch analysis in replay not wired to the analysis panel.**
The "Branch analysis" button in ReplayControls calls `onBranchAnalysis(state)` in GameBoard,
but the callback doesn't currently trigger the analysis panel to run a simulation from that
position. It needs to be connected to `useAnalysis` with the forked state as `startingState`.

**Simulation blocks the main thread.**
`SimulationView` runs `runSimulation()` synchronously on the main thread. For large run counts
(≥ 1000 games) this freezes the UI for several seconds. Tracked as a TODO in `SimulationView.tsx`.
Fix: move simulation to a Web Worker.

---

## What NOT to Build Yet

- Animations (play/banish/quest/challenge transitions)
- Sound effects
- Hover tooltips with rules text
- Chat (multiplayer feature)
- Spectator mode (multiplayer feature)
- Matchmaking (separate server spec)
- **Display names in game log**: log currently shows "P1"/"P2". When multiplayer has real
  usernames, pass a `displayNames: Record<PlayerID, string>` map into GameBoard and use it
  in `fmtMsg()` (`GameBoard.tsx`) to substitute before rendering. `PlayerID` ("player1"/
  "player2") stays as the internal engine key forever — display names are UI-only.

---

## Desktop vs Mobile Design Directions

> Open questions — not decided yet. Review and pick a direction before building.

### Current state (as of Apr 2026)

| Aspect | Mobile (< md / 768px) | Desktop (md+) |
|--------|-----------------------|---------------|
| Layout | Single column | Main area + 220–280px sidebar |
| Play zones | Horizontal scroll strip | Wrapped grid, chars left / items right |
| Hand | Fixed 80px height, single row | Auto-height, wraps up to 260–355px |
| Opponent hand | 40–64px peeked strip | 64px strip |
| Lore display | Compact inline "8 ♦ vs 12 ♦ /20" | Full 20-pip LoreTracker components |
| Sidebar | Hidden; bottom-sheet overlay on demand | Always visible, vertical scroll |
| Analysis panel | Bottom-sheet (tap button to open) | Sidebar section, always rendered |
| Game log | Bottom-sheet (tap button to open) | Sidebar section, always rendered |
| Card size | 64px (play), 88px (hand) | 104–120px across all zones |
| Pending choice | Full-width bottom sheet | Centered modal (max-w-lg) |

---

### Direction A — Richer information density

Desktop surfaces information that mobile hides due to space constraints.

**What changes:**
- Sidebar gains a **Card Detail panel**: when a card is selected, the sidebar top section
  shows the large card image, full ability text, current STR/WP/lore (including any
  active modifiers from gameModifiers.ts), and action buttons. Replaces the current
  small inline action buttons.
- **Always-visible game log** in sidebar alongside analysis (tabbed or stacked),
  so you never have to open a panel to see what just happened.
- At xl+ (1280px+), sidebar expands to ~360px to fit both analysis and log simultaneously.
- Hover tooltip on card (desktop only): floating panel with card text on hover —
  non-destructive, no click required.

**What stays the same:** All core game interactions work identically on mobile.

**Tradeoffs:**
- More to build and maintain (hover state, card detail panel).
- Sidebar at 360px takes meaningful board real estate on 1280px screens.
- "What NOT to Build Yet" listed hover tooltips — still deferred until card detail panel exists.

---

### Direction B — Layout density (same info, better use of space)

Desktop just arranges the existing information better. No new data surfaces.

**What changes:**
- At lg+ (1024px+), the sidebar shows analysis + log in a two-tab switcher (already close
  to what exists — just make the log tab always-visible rather than a bottom-sheet).
- At xl+ (1280px+), sidebar grows to ~340px. Analysis and sandbox get more room.
- Opponent hand zone grows taller at lg+ to show more card tops (current 64px → 88px).
- Hand zone max-height increases at xl+ to show 3 wrapped rows before scrolling.

**What stays the same:** No new components. No card detail panel. No hover tooltips.

**Tradeoffs:**
- Smallest implementation effort — mostly Tailwind class changes.
- Doesn't add information mobile users don't have, just uses space better.
- May feel like a missed opportunity given desktop screen real estate.

---

### Direction C — Power-user features (desktop-only capabilities)

Desktop unlocks features that are impractical on touch screens.

**What changes:**
- **Keyboard shortcuts**: [I] ink, [Q] quest all eligible, [P] pass, [C] enter challenge mode,
  [S] enter sing mode, [Esc] cancel mode. Shown as small badges on action buttons.
- **Hover card preview**: full card image + text in a floating panel on hover (desktop only).
- **Shortcut reference card** in sidebar (collapsible) showing the key bindings.
- Sidebar log is always expanded at md+ (no bottom sheet needed).

**What stays the same:** Mobile experience unchanged. No two-column layout changes.

**Tradeoffs:**
- Keyboard shortcuts require a `useKeyboardShortcuts` hook + focus management.
- Most useful for people playing many test games (testbench use case), less for casual multiplayer.
- Can be combined with Direction A or B (they're not mutually exclusive).

---

### Open questions before deciding

1. **Who is the primary desktop user?** Someone doing deck testing (testbench/sandbox, rapid
   play against bot) or someone playing a real multiplayer game?
   - If testbench: keyboard shortcuts + always-visible log matter most.
   - If multiplayer: card detail + richer visual state matters most.

2. **Sidebar width ceiling**: At 1440px+ monitors, the board has unused horizontal space.
   Two-column sidebar? Or let the board zone cards grow larger?

3. **Card detail panel vs hover tooltip**: These serve the same need (read card text quickly).
   Hover is faster but requires mouse. Click-to-detail works on touch too, so it's more universal.
   Pick one pattern to avoid building both.

4. **Log visibility**: Should the game log be always-on at md+, or keep it behind a tab
   to save sidebar space for analysis? The analysis panel is more useful during a game;
   the log is more useful for reviewing after.