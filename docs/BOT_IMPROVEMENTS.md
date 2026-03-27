# BOT_IMPROVEMENTS.md
# Spec for improving bot quality beyond the current GreedyBot/ProbabilityBot.
# The current bots produce data a 4-year-old could eyeball.
# The goal is bots that "know how to play the deck" so simulation data
# reflects decisions humans can't replicate at scale.

---

## The Core Problem

The current position evaluator scores:
lore delta + board count + hand size + ink delta + deck quality + urgency + threat

It has no idea that:
- Jafar gets stronger when you have cards in hand
- Tamatoa gets more lore per item in play
- The Queen wants to stay alive to keep drawing cards
- A board with Bodyguard + Evasive is worth more than the raw count suggests
- Develop Your Brain can chain into another copy

A bot that can't see these synergies plays every deck identically.
The data it produces is only valid for raw power comparisons, not strategic evaluation.

---

## The Improvement Ladder

### Stage 1 — Smart Choice Resolution (Highest Impact, Build First)

Currently both GreedyBot and ProbabilityBot resolve pendingChoice randomly.
With 35 action cards and 22 activated abilities in Set 1, this is a lot of
random targeting.

Fix: wire the position evaluator into choice resolution.

```typescript
function resolveChoiceIntelligently(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  weights: BotWeights
): ResolveChoiceAction {
  const choice = state.pendingChoice!

  // May choices — always accept (free benefit)
  if (choice.type === "choose_may") {
    return { type: "RESOLVE_CHOICE", playerId, choice: "accept" }
  }

  // No valid targets — decline
  const targets = choice.validTargets ?? []
  if (targets.length === 0) {
    return { type: "RESOLVE_CHOICE", playerId, choice: [] }
  }

  // Single target — no choice needed
  if (targets.length === 1) {
    return { type: "RESOLVE_CHOICE", playerId, choice: [targets[0]!] }
  }

  // Multiple targets — evaluate each and pick best
  const probs = computeDeckProbabilities(state, playerId, definitions)
  let bestTarget = targets[0]!
  let bestScore = -Infinity

  for (const targetId of targets) {
    const resolveAction: ResolveChoiceAction = {
      type: "RESOLVE_CHOICE",
      playerId,
      choice: [targetId],
    }
    const result = applyAction(state, resolveAction, definitions)
    if (!result.success) continue
    const { score } = evaluatePosition(result.newState, playerId, probs, weights)
    if (score > bestScore) {
      bestScore = score
      bestTarget = targetId
    }
  }

  return { type: "RESOLVE_CHOICE", playerId, choice: [bestTarget] }
}
```

This single change improves both GreedyBot and ProbabilityBot significantly.
Replace all `resolveChoiceRandom` calls with this function.

Impact: High. Every targeted effect now picks the best target instead of random.

---

### Stage 2 — Deck Profiler (Medium Complexity, High Value)

A deck profiler reads a decklist and extracts what the deck is trying to do.
The evaluator then weights board states differently based on deck intent.

```typescript
interface DeckProfile {
  // Primary win condition
  archetype: "aggro" | "control" | "midrange" | "combo"

  // Key synergies detected from card data
  synergies: SynergyTag[]

  // Cards that are "engines" (activated abilities, draw, value generation)
  engineCards: string[]  // definitionIds

  // Cards that are "payoffs" (win condition cards)
  payoffCards: string[]

  // Suggested default weights based on archetype
  suggestedWeights: BotWeights
}

type SynergyTag =
  | "items_matter"       // Tamatoa, Eye of the Fates
  | "hand_size_matters"  // Jafar - Keeper of Secrets
  | "board_width"        // Stitch - Carefree Surfer
  | "character_plays"    // Coconut Basket
  | "lore_racing"        // high lore value characters
  | "removal_heavy"      // lots of damage/banish effects
  | "song_package"       // Singers + Songs
  | "activated_engines"  // The Queen, Eye of the Fates
```

**How synergies are detected automatically from card data:**

```typescript
function profileDeck(
  deck: DeckEntry[],
  definitions: Record<string, CardDefinition>
): DeckProfile {
  const cards = expandDeck(deck, definitions)
  const synergies: SynergyTag[] = []

  // Items matter: deck has cards with modify_stat_per_count counting items
  const hasItemCounter = cards.some(c =>
    c.abilities.some(a =>
      a.type === "static" &&
      a.effect.type === "modify_stat_per_count" &&
      a.effect.countFilter?.cardType?.includes("item")
    )
  )
  if (hasItemCounter) synergies.push("items_matter")

  // Hand size matters: cards that scale with hand size
  const hasHandCounter = cards.some(c =>
    c.abilities.some(a =>
      a.type === "static" &&
      a.effect.type === "modify_stat_per_count" &&
      a.effect.countFilter?.zone === "hand"
    )
  )
  if (hasHandCounter) synergies.push("hand_size_matters")

  // Song package: has both singers and songs
  const singerCount = cards.filter(c =>
    c.abilities.some(a => a.type === "keyword" && a.keyword === "singer")
  ).length
  const songCount = cards.filter(c =>
    c.traits?.includes("Song")
  ).length
  if (singerCount >= 4 && songCount >= 4) synergies.push("song_package")

  // Activated engines: multiple cards with activated abilities
  const activatedCount = cards.filter(c =>
    c.abilities.some(a => a.type === "activated")
  ).length
  if (activatedCount >= 4) synergies.push("activated_engines")

  // Determine archetype from lore curve
  const avgLore = average(cards.filter(c => c.lore).map(c => c.lore!))
  const avgCost = average(cards.map(c => c.cost))
  const archetype = avgCost <= 3 && avgLore >= 1.5 ? "aggro"
    : activatedCount >= 6 ? "control"
    : "midrange"

  return {
    archetype,
    synergies,
    engineCards: cards.filter(c =>
      c.abilities.some(a => a.type === "activated")
    ).map(c => c.id),
    payoffCards: cards.filter(c => (c.lore ?? 0) >= 3).map(c => c.id),
    suggestedWeights: weightsForArchetype(archetype, synergies),
  }
}
```

**Using the profile in the evaluator:**

```typescript
function evaluatePositionWithProfile(
  state: GameState,
  playerId: PlayerID,
  probabilities: DeckProbabilities,
  weights: BotWeights,
  profile: DeckProfile  // NEW
): { score: number; factors: PositionFactors } {
  const base = evaluatePosition(state, playerId, probabilities, weights)

  // Apply synergy bonuses on top of base score
  let synergyBonus = 0

  if (profile.synergies.includes("items_matter")) {
    const itemsInPlay = getZone(state, playerId, "play")
      .filter(id => definitions[state.cards[id]!.definitionId]?.cardType === "item")
      .length
    synergyBonus += itemsInPlay * 0.05  // each item adds small bonus
  }

  if (profile.synergies.includes("hand_size_matters")) {
    const handSize = getZone(state, playerId, "hand").length
    synergyBonus += handSize * 0.03
  }

  if (profile.synergies.includes("activated_engines")) {
    // Value keeping engine cards alive and unexerted
    const enginesReady = getZone(state, playerId, "play")
      .filter(id => {
        const inst = state.cards[id]!
        return profile.engineCards.includes(inst.definitionId) && !inst.isExerted
      }).length
    synergyBonus += enginesReady * 0.04
  }

  return {
    score: base.score + synergyBonus,
    factors: base.factors,
  }
}
```

Impact: High for synergy-dependent decks. Medium complexity. No ML needed.

---

### Stage 3 — Mulligan Strategy (Important for Consistency Stats)

Currently bots always keep their opening hand. Real players mulligan bad hands.
This skews every consistency stat — a hand with 0 inkable cards is unkeepable
but the bot plays it anyway.

```typescript
interface MulliganConfig {
  // Minimum inkable cards to keep
  minInkable: number          // default: 2
  // Maximum cost of cheapest playable card to keep
  maxCheapestCost: number     // default: 3
  // Minimum "playable" cards (cost <= 4) to keep
  minPlayable: number         // default: 2
}

function shouldMulligan(
  hand: CardDefinition[],
  config: MulliganConfig = { minInkable: 2, maxCheapestCost: 3, minPlayable: 2 }
): boolean {
  const inkableCount = hand.filter(c => c.inkable).length
  if (inkableCount < config.minInkable) return true

  const cheapestCost = Math.min(...hand.map(c => c.cost))
  if (cheapestCost > config.maxCheapestCost) return true

  const playableCount = hand.filter(c => c.cost <= 4).length
  if (playableCount < config.minPlayable) return true

  return false
}
```

Add mulligan to `createGame` / `runGame`. Bot evaluates opening hand and
redraws once if `shouldMulligan` returns true.

CRD 2.2.2: player may alter their opening hand. Mulligan is currently
flagged as ❌ in CRD_TRACKER.md. This fixes it.

Impact: High for consistency stats. Medium for win rates.

---

### Stage 4 — 2-Ply Lookahead for ProbabilityBot

Currently ProbabilityBot is 1-ply: evaluates the immediate result of each action.
2-ply: after each action, also considers the opponent's best response.

```typescript
function evaluateWithLookahead(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  weights: BotWeights,
  depth: number = 2
): number {
  if (depth === 0 || state.isGameOver) {
    const probs = computeDeckProbabilities(state, playerId, definitions)
    return evaluatePosition(state, playerId, probs, weights).score
  }

  const legal = getAllLegalActions(state, state.currentPlayer, definitions)
  if (legal.length === 0) return 0

  if (state.currentPlayer === playerId) {
    // Maximizing player — pick best action
    return Math.max(...legal.map(action => {
      const result = applyAction(state, action, definitions)
      if (!result.success) return -Infinity
      return evaluateWithLookahead(result.newState, playerId, definitions, weights, depth - 1)
    }))
  } else {
    // Minimizing player (opponent) — assume they play well too
    return Math.min(...legal.map(action => {
      const result = applyAction(state, action, definitions)
      if (!result.success) return Infinity
      return evaluateWithLookahead(result.newState, playerId, definitions, weights, depth - 1)
    }))
  }
}
```

Lorcana's low branching factor (~5-8 legal actions per turn) makes 2-ply
feasible. 3-ply may be too slow for real-time analysis.

Note: full turn lookahead (all actions in a turn before passing) is more
useful than depth-2 across turns. Consider "simulate full turn" as
an alternative to minimax depth.

Impact: High for decision quality. Medium complexity. Slower per game.

---

### Stage 5 — Bot Decision Tests (Layer 5 Testing)

Tests that verify bot strategic correctness, not just rule correctness.
Two sub-layers:

**Layer 5a — Correctness floor (all bots must pass)**

```typescript
it("quests to win rather than doing anything else", () => {
  let state = startGame()
  state = setLore(state, "player1", 19)
  const { state: s, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play")
  // Also inject a character that could challenge, to make sure quest wins anyway
  const { state: s2, instanceId: attackerId } = injectCard(s, "player1", "beast-hardheaded", "play")
  const { state: s3, instanceId: defenderId } = injectCard(s2, "player2", "simba-protective-cub", "play", { isExerted: true })

  const action = GreedyBot.decideAction(s3, "player1", LORCAST_CARD_DEFINITIONS)
  expect(action.type).toBe("QUEST")
  expect((action as QuestAction).instanceId).toBe(instanceId)
})

it("challenges lethal threat over questing when opponent is at 19 lore", () => {
  // Opponent has a ready character that will quest to 20 next turn
  // Bot should challenge it rather than quest itself
  // ...
})

it("does not challenge into a losing trade with no benefit", () => {
  // Attacker STR 1 vs defender WP 5 — bot should not challenge
  // ...
})
```

**Layer 5b — Personality verification (statistical)**

```typescript
it("AggroBot quests more than it challenges on average", () => {
  const results = runSimulation({ games: 500, bot: ProbabilityBot(AggroWeights), ... })
  const avgQuests = average(results.map(r => totalQuests(r)))
  const avgChallenges = average(results.map(r => totalChallenges(r)))
  expect(avgQuests).toBeGreaterThan(avgChallenges * 1.2)
})
```

---

## Build Order

1. Smart choice resolution — replaces random targeting in all bots
2. Mulligan strategy — fixes a known CRD gap, improves all stats
3. Deck profiler — enables synergy-aware evaluation
4. 2-ply lookahead — better sequencing decisions
5. Layer 5 bot tests — validates improvements are real

Do not skip to later stages before earlier ones are tested.
Each stage should show measurable improvement in mirror match quality.

---

## Validation — How to Know If Bots Are Better

After each improvement, run:

```bash
# Mirror match should be ~50/50
pnpm compare --deck1 sample-deck.txt --deck2 sample-deck.txt --bot greedy --iterations 1000

# Tamatoa deck should outperform when items are in play
pnpm analyze --deck tamatoa-deck.txt --bot probability --iterations 1000

# Check draw rate (should be near 0)
# Check avg game length (should be 6-15 turns)
```

Specific regression tests to add for each improvement:
- Smart choice: "does Merlin target the most threatening character?"
- Mulligan: "do kept hands have >= 2 inkable cards?"
- Deck profiler: "does Tamatoa deck place more items than vanilla deck?"
- 2-ply: "does bot find the quest-to-win before challenge sequence?"