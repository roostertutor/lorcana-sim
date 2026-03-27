# PHASE_1_DETAILED.md
# Exact implementation spec for Phase 1 bot improvements.
# Ready to hand directly to Claude Code — no ambiguity, no open questions.
# References: BOT_IMPROVEMENTS.md for context, ROADMAP.md for order.

---

## What Phase 1 Contains

Three changes to the simulator package:

1. Smart choice resolution — replaces random targeting in GreedyBot and ProbabilityBot
2. Mulligan — bots evaluate and optionally redraw opening hands
3. startingState in runGame — 3-line change enabling mid-game injection

Do these in order. Each is independently testable.

---

## Change 1: Smart Choice Resolution

### Background

Three `pendingChoice` types are actually produced by the engine in Set 1:

| type | When set | How to resolve |
|------|----------|----------------|
| `choose_may` | Optional effects (Support, Bodyguard enter exerted, etc.) | accept/decline |
| `choose_target` | Targeted effects (damage, banish, return to hand, exert, heal, etc.) | array of instanceIds |
| `choose_discard` | Forced discard effects (Sudden Chill, You Have Forgotten Me) | array of instanceIds |

`look_at_top` (scry) auto-resolves inside the engine — bots never see it.
`choose_option` and `choose_from_revealed` exist in types but are not produced in Set 1.

### What to build

New file: `packages/simulator/src/bots/choiceResolver.ts`

This replaces `resolveChoiceRandom` in both GreedyBot and ProbabilityBot.
RandomBot keeps its random resolver — it's a stress test tool, not an analytics tool.

```typescript
// packages/simulator/src/bots/choiceResolver.ts

import type {
  CardDefinition,
  GameAction,
  GameState,
  PlayerID,
  ResolveChoiceAction,
} from "@lorcana-sim/engine";
import { applyAction, getZone } from "@lorcana-sim/engine";
import { computeDeckProbabilities } from "../probabilities.js";
import { evaluatePosition } from "../evaluator.js";
import type { BotWeights } from "../types.js";

/**
 * Intelligently resolve a pendingChoice using position evaluation.
 * Used by GreedyBot and ProbabilityBot — not RandomBot.
 *
 * Handles all three choice types produced by the Set 1 engine:
 *   choose_may    → accept (always free benefit)
 *   choose_target → evaluate each valid target, pick best resulting position
 *   choose_discard → discard the lowest-value card(s) from hand
 */
export function resolveChoiceIntelligently(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  weights: BotWeights
): GameAction {
  const choice = state.pendingChoice!;

  // -------------------------------------------------------------------------
  // choose_may: always accept (optional effects are free benefits)
  // CRD 6.1.4: player may decline, but a bot should never decline a free effect
  // Exception: if accepting would hurt us (no current Set 1 cases), decline
  // -------------------------------------------------------------------------
  if (choice.type === "choose_may") {
    return { type: "RESOLVE_CHOICE", playerId, choice: "accept" };
  }

  // -------------------------------------------------------------------------
  // choose_discard: discard the lowest-value card(s) from hand
  // "Lowest value" = lowest cost cards (fewest future options sacrificed)
  // CRD: player chooses which cards to discard
  // -------------------------------------------------------------------------
  if (choice.type === "choose_discard") {
    const hand = getZone(state, playerId, "hand");
    const count = choice.count ?? 1;

    if (hand.length === 0) {
      return { type: "RESOLVE_CHOICE", playerId, choice: [] };
    }

    // Sort hand cards by cost ascending, discard cheapest
    // Rationale: cheap cards are easiest to replace; expensive cards are harder to recover
    const sorted = [...hand].sort((a, b) => {
      const defA = definitions[state.cards[a]?.definitionId ?? ""];
      const defB = definitions[state.cards[b]?.definitionId ?? ""];
      return (defA?.cost ?? 0) - (defB?.cost ?? 0);
    });

    const toDiscard = sorted.slice(0, count);
    return { type: "RESOLVE_CHOICE", playerId, choice: toDiscard };
  }

  // -------------------------------------------------------------------------
  // choose_target: evaluate each valid target, pick the one that produces
  // the best resulting game state for the choosing player
  // -------------------------------------------------------------------------
  const targets = choice.validTargets ?? [];

  // No valid targets — send empty (effect fizzles per CRD 1.2.3)
  if (targets.length === 0) {
    return { type: "RESOLVE_CHOICE", playerId, choice: [] };
  }

  // Single target — no evaluation needed
  if (targets.length === 1) {
    return { type: "RESOLVE_CHOICE", playerId, choice: [targets[0]!] };
  }

  // Optional target with no forced selection — check if we should skip
  if (choice.optional) {
    // First evaluate "skip" (empty choice)
    const skipAction: ResolveChoiceAction = { type: "RESOLVE_CHOICE", playerId, choice: [] };
    const skipResult = applyAction(state, skipAction, definitions);
    if (skipResult.success) {
      const probs = computeDeckProbabilities(state, playerId, definitions);
      const skipScore = evaluatePosition(skipResult.newState, playerId, probs, weights).score;

      // Only skip if it's genuinely better than the best target
      // (rare, but possible for effects that hurt us)
      let bestTargetScore = -Infinity;
      for (const targetId of targets) {
        const tryAction: ResolveChoiceAction = {
          type: "RESOLVE_CHOICE", playerId, choice: [targetId],
        };
        const tryResult = applyAction(state, tryAction, definitions);
        if (!tryResult.success) continue;
        const score = evaluatePosition(tryResult.newState, playerId, probs, weights).score;
        if (score > bestTargetScore) bestTargetScore = score;
      }

      if (skipScore >= bestTargetScore) {
        return skipAction;
      }
    }
  }

  // Evaluate each target — pick the one producing best position for us
  const probs = computeDeckProbabilities(state, playerId, definitions);
  let bestTarget = targets[0]!;
  let bestScore = -Infinity;

  for (const targetId of targets) {
    const tryAction: ResolveChoiceAction = {
      type: "RESOLVE_CHOICE", playerId, choice: [targetId],
    };
    const tryResult = applyAction(state, tryAction, definitions);
    if (!tryResult.success) continue;

    const score = evaluatePosition(tryResult.newState, playerId, probs, weights).score;
    if (score > bestScore) {
      bestScore = score;
      bestTarget = targetId;
    }
  }

  return { type: "RESOLVE_CHOICE", playerId, choice: [bestTarget] };
}
```

### Wiring into GreedyBot

In `packages/simulator/src/bots/GreedyBot.ts`:

1. Import: `import { resolveChoiceIntelligently } from "./choiceResolver.js";`
2. Import weights: `import { MidrangeWeights } from "./presets.js";`
3. Remove the `resolveChoiceRandom` function entirely
4. Replace the choice block at the top of `decideAction`:

```typescript
// BEFORE:
if (state.pendingChoice && state.pendingChoice.choosingPlayerId === playerId) {
  return resolveChoiceRandom(state, playerId);
}

// AFTER:
if (state.pendingChoice && state.pendingChoice.choosingPlayerId === playerId) {
  return resolveChoiceIntelligently(state, playerId, definitions, MidrangeWeights);
}
```

GreedyBot uses MidrangeWeights for choice evaluation — balanced, doesn't require
the user to pass weights into a bot that doesn't otherwise use them.

### Wiring into ProbabilityBot

In `packages/simulator/src/bots/ProbabilityBot.ts`:

1. Import: `import { resolveChoiceIntelligently } from "./choiceResolver.js";`
2. Remove the `resolveChoiceRandom` function entirely
3. Replace the choice block at the top of `decideAction`:

```typescript
// BEFORE:
if (state.pendingChoice && state.pendingChoice.choosingPlayerId === playerId) {
  return resolveChoiceRandom(state, playerId);
}

// AFTER:
if (state.pendingChoice && state.pendingChoice.choosingPlayerId === playerId) {
  return resolveChoiceIntelligently(state, playerId, definitions, weights);
}
```

ProbabilityBot passes its own `weights` — choice evaluation uses the same
personality as the rest of the bot's decision-making.

### RandomBot — do NOT change

RandomBot keeps `resolveChoiceRandom`. It exists for stress testing and
invariant checking, not analytics. Random choices stress-test more code paths.

### Tests to write

Add to `packages/simulator/src/bot.test.ts` (new file):

```typescript
import { describe, it, expect } from "vitest";
import { applyAction, createGame, getZone } from "@lorcana-sim/engine";
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { generateId } from "@lorcana-sim/engine";
import type { CardInstance, GameState } from "@lorcana-sim/engine";
import { GreedyBot } from "./bots/GreedyBot.js";
import { ProbabilityBot } from "./bots/ProbabilityBot.js";
import { MidrangeWeights } from "./bots/presets.js";

// Helpers (same pattern as engine tests)
function injectCard(state, playerId, definitionId, zone, overrides = {}) { ... }
function giveInk(state, playerId, amount) { ... }
function setLore(state, playerId, amount) { ... }

// -----------------------------------------------------------------------
// LAYER 5a: Correctness floor — all non-random bots must pass these
// -----------------------------------------------------------------------

describe("Layer 5a — Bot correctness floor", () => {

  it("quests to win rather than anything else at 19 lore", () => {
    // Setup: player1 at 19 lore, has a character that can quest for 1 lore
    // Also has a character that could challenge
    // Opponent has an exerted character to challenge
    // Correct play: QUEST → win
    let state = createGame(
      { player1Deck: [...], player2Deck: [...] },
      LORCAST_CARD_DEFINITIONS
    );
    state = setLore(state, "player1", 19);
    let questerId: string;
    ({ state, instanceId: questerId } = injectCard(
      state, "player1", "simba-protective-cub", "play"  // lore 1, ready
    ));
    // Add a ready attacker so "challenge" is also a legal option
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(
      state, "player1", "beast-hardheaded", "play"
    ));
    // Add exerted defender so challenge is legal
    injectCard(state, "player2", "simba-protective-cub", "play", { isExerted: true });

    for (const bot of [GreedyBot, ProbabilityBot(MidrangeWeights)]) {
      const action = bot.decideAction(state, "player1", LORCAST_CARD_DEFINITIONS);
      expect(action.type, `${bot.name} should quest to win`).toBe("QUEST");
      expect((action as any).instanceId).toBe(questerId);
    }
  });

  it("does not challenge when attacker dies and defender survives", () => {
    // Attacker STR 1, defender WP 5 — attacker dies, defender lives
    // No favorable challenge exists, bot should NOT challenge
    let state = ...;
    let weakAttackerId: string;
    ({ state, instanceId: weakAttackerId } = injectCard(
      state, "player1", "simba-protective-cub", "play"  // STR 1, WP 2
    ));
    injectCard(state, "player2", "gaston-boastful-hunter", "play", { isExerted: true }); // WP 5

    for (const bot of [GreedyBot, ProbabilityBot(MidrangeWeights)]) {
      const action = bot.decideAction(state, "player1", LORCAST_CARD_DEFINITIONS);
      expect(action.type, `${bot.name} should not make a losing challenge`).not.toBe("CHALLENGE");
    }
  });

  it("targets highest-willpower character with Merlin's damage ability", () => {
    // Merlin activated: deal 1 damage to chosen character
    // Opponent has: low WP character (1 WP) and high WP character (5 WP, 4 damage)
    // Correct: target the 5 WP + 4 damage character (1 more damage kills it)
    // Wrong: target the low WP character (doesn't kill anything)
    // ...
  });

  it("targets opponent character for damage, not own character", () => {
    // When effect targets "any character", bot should pick opponent's
    // unless there's a specific reason to target own (no Set 1 cases)
    // ...
  });

  it("choose_discard discards lowest-cost card", () => {
    // Sudden Chill forces opponent to discard
    // Opponent has: Simba (cost 1), Moana (cost 5), Elsa (cost 6)
    // Bot should discard Simba (cost 1) — cheapest, easiest to replace
    let state = ...;
    // Inject Sudden Chill card and trigger it
    // Bot should choose Simba's instanceId
    const action = GreedyBot.decideAction(discardState, "player2", LORCAST_CARD_DEFINITIONS);
    expect(action.type).toBe("RESOLVE_CHOICE");
    const chosen = (action as any).choice as string[];
    const chosenDef = LORCAST_CARD_DEFINITIONS[state.cards[chosen[0]!]!.definitionId];
    expect(chosenDef?.cost).toBe(1); // discarded cheapest card
  });

});

// -----------------------------------------------------------------------
// LAYER 5b: Personality verification — statistical checks
// -----------------------------------------------------------------------

describe("Layer 5b — Bot personality verification (100 games each)", () => {
  const TEST_DECK = [
    { definitionId: "simba-protective-cub", count: 10 },
    { definitionId: "mickey-mouse-true-friend", count: 10 },
    { definitionId: "moana-of-motunui", count: 10 },
    { definitionId: "gaston-boastful-hunter", count: 10 },
    { definitionId: "beast-hardheaded", count: 10 },
    { definitionId: "elsa-snow-queen", count: 10 },
  ];

  it("GreedyBot always challenges when it kills the defender (never leaves free kills)", () => {
    // Run 100 games, count how often a free kill exists but isn't taken
    // Should be 0% — GreedyBot always takes lethal challenges
    // (Verify by checking game logs for "had lethal, didn't take it" pattern)
    // This is complex to implement — mark as TODO and verify manually first
  });

  it("AggroBot wins faster than ControlBot (shorter average game length)", () => {
    const aggroResults = [];
    const controlResults = [];
    for (let i = 0; i < 100; i++) {
      aggroResults.push(runGame({
        player1Deck: TEST_DECK, player2Deck: TEST_DECK,
        player1Strategy: ProbabilityBot(AggroWeights),
        player2Strategy: ProbabilityBot(AggroWeights),
        definitions: LORCAST_CARD_DEFINITIONS,
      }));
      controlResults.push(runGame({
        player1Deck: TEST_DECK, player2Deck: TEST_DECK,
        player1Strategy: ProbabilityBot(ControlWeights),
        player2Strategy: ProbabilityBot(ControlWeights),
        definitions: LORCAST_CARD_DEFINITIONS,
      }));
    }
    const avgAggroTurns = aggroResults.reduce((s, r) => s + r.turns, 0) / 100;
    const avgControlTurns = controlResults.reduce((s, r) => s + r.turns, 0) / 100;
    expect(avgAggroTurns).toBeLessThan(avgControlTurns);
  });

  it("mirror match win rate is roughly 50/50 after smart choice resolution", () => {
    let p1Wins = 0;
    for (let i = 0; i < 200; i++) {
      const result = runGame({
        player1Deck: TEST_DECK, player2Deck: TEST_DECK,
        player1Strategy: ProbabilityBot(MidrangeWeights),
        player2Strategy: ProbabilityBot(MidrangeWeights),
        definitions: LORCAST_CARD_DEFINITIONS,
      });
      if (result.winner === "player1") p1Wins++;
    }
    // Within 15% of 50/50 — randomness in deck shuffling
    expect(p1Wins).toBeGreaterThan(200 * 0.35);
    expect(p1Wins).toBeLessThan(200 * 0.65);
  });

});
```

---

## Change 2: Mulligan

### Background

CRD 2.2.2: Player may look at their opening hand and choose to redraw once.
Currently flagged ❌ in CRD_TRACKER.md.
Bots always keep their opening hand — this skews every consistency stat.

### What "bad hand" means

A hand is unkeepable if ANY of these are true:
- Fewer than 2 inkable cards (can't ramp ink reliably)
- No cards with cost ≤ 3 (no early plays, stuck waiting)
- Exactly 0 playable cards in the first 3 turns worth of ink

Default thresholds (tunable via config):

```typescript
interface MulliganThresholds {
  minInkable: number      // default 2
  maxCheapestCost: number // default 3  — "must have at least one card costing ≤ this"
  minPlayableBy: number   // default 4  — "must have a card costing ≤ N ink"
}
```

### New file: `packages/simulator/src/mulligan.ts`

```typescript
// packages/simulator/src/mulligan.ts

import type { CardDefinition, GameState, PlayerID } from "@lorcana-sim/engine";
import { getZone } from "@lorcana-sim/engine";

export interface MulliganThresholds {
  minInkable: number;
  maxCheapestCost: number;
  minPlayableBy: number;
}

export const DEFAULT_MULLIGAN: MulliganThresholds = {
  minInkable: 2,
  maxCheapestCost: 3,
  minPlayableBy: 4,
};

/**
 * Returns true if this opening hand should be mulliganed.
 * Called once per player after initial deal, before turn 1.
 */
export function shouldMulligan(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  thresholds: MulliganThresholds = DEFAULT_MULLIGAN
): boolean {
  const hand = getZone(state, playerId, "hand");

  let inkableCount = 0;
  let cheapestCost = Infinity;

  for (const instanceId of hand) {
    const instance = state.cards[instanceId];
    if (!instance) continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    if (def.inkable) inkableCount++;
    if (def.cost < cheapestCost) cheapestCost = def.cost;
  }

  // Not enough inkable cards — can't ramp
  if (inkableCount < thresholds.minInkable) return true;

  // No early plays — stuck waiting
  if (cheapestCost > thresholds.maxCheapestCost) return true;

  // Nothing playable within reasonable ink range
  const hasEarlyPlay = hand.some(id => {
    const def = definitions[state.cards[id]?.definitionId ?? ""];
    return (def?.cost ?? Infinity) <= thresholds.minPlayableBy;
  });
  if (!hasEarlyPlay) return true;

  return false;
}

/**
 * Perform a mulligan for a player: return hand to deck, reshuffle, redraw.
 * CRD 2.2.2: player draws a new hand of the same size.
 * This mutates the state immutably (returns new state).
 */
export function performMulligan(
  state: GameState,
  playerId: PlayerID
): GameState {
  const hand = [...getZone(state, playerId, "hand")];
  const handSize = hand.length;

  // Return all hand cards to deck
  let newState = state;
  for (const instanceId of hand) {
    const instance = newState.cards[instanceId];
    if (!instance) continue;
    newState = {
      ...newState,
      cards: { ...newState.cards, [instanceId]: { ...instance, zone: "deck" } },
      zones: {
        ...newState.zones,
        [playerId]: {
          ...newState.zones[playerId],
          hand: newState.zones[playerId].hand.filter(id => id !== instanceId),
          deck: [...newState.zones[playerId].deck, instanceId],
        },
      },
    };
  }

  // Shuffle the deck
  const deck = [...newState.zones[playerId].deck];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  newState = {
    ...newState,
    zones: {
      ...newState.zones,
      [playerId]: { ...newState.zones[playerId], deck },
    },
  };

  // Draw a new hand of the same size
  for (let i = 0; i < handSize; i++) {
    const currentDeck = newState.zones[playerId].deck;
    const topId = currentDeck[0];
    if (!topId) break;
    newState = {
      ...newState,
      cards: { ...newState.cards, [topId]: { ...newState.cards[topId]!, zone: "hand" } },
      zones: {
        ...newState.zones,
        [playerId]: {
          ...newState.zones[playerId],
          deck: currentDeck.slice(1),
          hand: [...newState.zones[playerId].hand, topId],
        },
      },
    };
  }

  return newState;
}
```

### Wiring into runGame.ts

In `packages/simulator/src/runGame.ts`, add mulligan after `createGame`:

```typescript
import { shouldMulligan, performMulligan, DEFAULT_MULLIGAN } from "./mulligan.js";

export function runGame(config: SimGameConfig): GameResult {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;

  let state: GameState = config.startingState  // (from Change 3 below)
    ?? createGame(
        { player1Deck: config.player1Deck, player2Deck: config.player2Deck },
        config.definitions
       );

  // CRD 2.2.2: Mulligan — each bot evaluates their opening hand once
  // Only applies when starting from the beginning (not from injected state)
  if (!config.startingState) {
    const thresholds = config.mulliganThresholds ?? DEFAULT_MULLIGAN;
    for (const playerId of ["player1", "player2"] as const) {
      // RandomBot always keeps (stress testing) — check bot type
      const bot = playerId === "player1" ? config.player1Strategy : config.player2Strategy;
      if (bot.type !== "algorithm" || bot.name === "random") continue;

      if (shouldMulligan(state, playerId, config.definitions, thresholds)) {
        state = performMulligan(state, playerId);
      }
    }
  }

  // ... rest of game loop unchanged ...
}
```

### Add to SimGameConfig

In `packages/simulator/src/types.ts`:

```typescript
import type { MulliganThresholds } from "./mulligan.js";

export interface SimGameConfig {
  player1Deck: DeckEntry[];
  player2Deck: DeckEntry[];
  player1Strategy: BotStrategy;
  player2Strategy: BotStrategy;
  definitions: Record<string, CardDefinition>;
  maxTurns?: number;
  startingState?: GameState;           // NEW (Change 3)
  mulliganThresholds?: MulliganThresholds;  // NEW — defaults to DEFAULT_MULLIGAN
}
```

### Tests to write

Add to `packages/simulator/src/bot.test.ts`:

```typescript
describe("Mulligan", () => {

  it("shouldMulligan returns true for 0 inkable cards", () => {
    // Build a state where hand has 7 non-inkable cards
    // All Elsa - Spirit of Winter (non-inkable, cost 8)
    const state = createGame(
      { player1Deck: Array(60).fill({ definitionId: "elsa-spirit-of-winter", count: 1 }),
        player2Deck: [...] },
      LORCAST_CARD_DEFINITIONS
    );
    expect(shouldMulligan(state, "player1", LORCAST_CARD_DEFINITIONS)).toBe(true);
  });

  it("shouldMulligan returns true for 1 inkable card (below threshold of 2)", () => {
    // 1 inkable + 6 non-inkable
    // ...
  });

  it("shouldMulligan returns true when cheapest card costs 4+ (no early play)", () => {
    // All cards cost 4 or more
    // ...
  });

  it("shouldMulligan returns false for a keepable hand", () => {
    // 3 inkable cards, cheapest costs 2
    // ...
  });

  it("performMulligan returns all cards to deck and draws new hand", () => {
    const before = createGame(...);
    const handBefore = getZone(before, "player1", "hand");
    const deckBefore = getZone(before, "player1", "deck");
    expect(handBefore).toHaveLength(7);
    expect(deckBefore).toHaveLength(53);

    const after = performMulligan(before, "player1");
    const handAfter = getZone(after, "player1", "hand");
    const deckAfter = getZone(after, "player1", "deck");

    // Hand size unchanged
    expect(handAfter).toHaveLength(7);
    // Deck size unchanged
    expect(deckAfter).toHaveLength(53);
    // Total cards unchanged (invariant)
    expect(handAfter.length + deckAfter.length).toBe(handBefore.length + deckBefore.length);
    // Hand is different (probabilistically — occasionally same but very unlikely)
    // Don't test exact cards — just that the operation completes without errors
  });

  it("runGame with bad deck uses mulligan and has better opening hands", () => {
    // Run 100 games with a deck that often produces bad opening hands
    // Count % of games where kept hand has >= 2 inkable cards
    // Should be > 90% (occasionally mulligan into another bad hand — CRD allows)
    // ...
  });

  it("RandomBot does not mulligan (stress test integrity)", () => {
    // RandomBot.name === "random" — should skip mulligan in runGame
    // Verify by checking that game starts with the same state as createGame produces
    // ...
  });

});
```

---

## Change 3: startingState in runGame

### Why

Unlocks:
- Real-time analysis from any mid-game position
- Board state injection for "what if" analysis
- The game board's analysis overlay

### Exact changes

**File 1: `packages/simulator/src/types.ts`**

Add one field to `SimGameConfig`:

```typescript
export interface SimGameConfig {
  player1Deck: DeckEntry[];
  player2Deck: DeckEntry[];
  player1Strategy: BotStrategy;
  player2Strategy: BotStrategy;
  definitions: Record<string, CardDefinition>;
  maxTurns?: number;
  startingState?: GameState;           // NEW
  mulliganThresholds?: MulliganThresholds;
}
```

**File 2: `packages/simulator/src/runGame.ts`**

Replace the `createGame` call at the top of `runGame`:

```typescript
// BEFORE:
let state: GameState = createGame(
  { player1Deck: config.player1Deck, player2Deck: config.player2Deck },
  config.definitions
);

// AFTER:
let state: GameState = config.startingState
  ?? createGame(
      { player1Deck: config.player1Deck, player2Deck: config.player2Deck },
      config.definitions
     );
```

Then add the mulligan block AFTER this (only when not using startingState):

```typescript
if (!config.startingState) {
  // mulligan logic here (see Change 2)
}
```

**File 3: `packages/simulator/src/index.ts`**

Ensure `SimGameConfig` is exported (it likely already is, just verify).

### Tests

```typescript
it("runGame with startingState uses provided state instead of creating new game", () => {
  const freshState = createGame(
    { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
    LORCAST_CARD_DEFINITIONS
  );

  // Advance state a few turns
  let midGameState = freshState;
  // ... apply some actions ...

  const result = runGame({
    player1Deck: TEST_DECK,
    player2Deck: TEST_DECK,
    startingState: midGameState,  // inject mid-game state
    player1Strategy: GreedyBot,
    player2Strategy: GreedyBot,
    definitions: LORCAST_CARD_DEFINITIONS,
  });

  // Game should complete from the mid-game position
  expect(result.winner).not.toBeNull();
  // Game should not start from turn 1
  expect(result.turns).toBeGreaterThan(midGameState.turnNumber);
});

it("runGame without startingState creates fresh game (existing behavior unchanged)", () => {
  const result = runGame({
    player1Deck: TEST_DECK,
    player2Deck: TEST_DECK,
    player1Strategy: GreedyBot,
    player2Strategy: GreedyBot,
    definitions: LORCAST_CARD_DEFINITIONS,
  });
  expect(result.winner).not.toBeNull();
});
```

---

## Files Changed Summary

```
NEW:
  packages/simulator/src/bots/choiceResolver.ts
  packages/simulator/src/mulligan.ts
  packages/simulator/src/bot.test.ts

MODIFIED:
  packages/simulator/src/bots/GreedyBot.ts
    - Remove resolveChoiceRandom function
    - Import resolveChoiceIntelligently
    - Use it in decideAction

  packages/simulator/src/bots/ProbabilityBot.ts
    - Remove resolveChoiceRandom function
    - Import resolveChoiceIntelligently
    - Use it in decideAction (passing weights)

  packages/simulator/src/types.ts
    - Add startingState?: GameState to SimGameConfig
    - Add mulliganThresholds?: MulliganThresholds to SimGameConfig

  packages/simulator/src/runGame.ts
    - Add startingState support (3-line change to createGame call)
    - Add mulligan block after state initialization

UNTOUCHED:
  packages/simulator/src/bots/RandomBot.ts  (keep resolveChoiceRandom)
  packages/engine/*                          (no engine changes in Phase 1)
  packages/analytics/*                       (no analytics changes in Phase 1)
  packages/cli/*                             (no CLI changes in Phase 1)
  packages/ui/*                              (no UI changes in Phase 1)
```

---

## Validation After Phase 1

Run these to verify everything works:

```bash
# All existing tests still pass
pnpm test

# Simulator invariant tests still pass with smart choices
pnpm --filter simulator test

# Quick sanity check: run 100 games, check for obvious issues
pnpm analyze --deck packages/cli/sample-deck.txt --bot greedy --iterations 100
pnpm analyze --deck packages/cli/sample-deck.txt --bot probability --iterations 100

# Mirror match should still be roughly 50/50
pnpm compare \
  --deck1 packages/cli/sample-deck.txt \
  --deck2 packages/cli/sample-deck.txt \
  --bot greedy --iterations 200
```

Expected outcomes:
- Draw rate stays near 0%
- Mirror match win rate stays 40-60% for each player
- Game length stays 6-20 turns
- No crashes or infinite loops
- New bot.test.ts all pass