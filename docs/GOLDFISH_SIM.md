# GOLDFISH_SIM.md
# Spec for short goldfish simulations to analyze mulligan decisions
# and early-game line consistency.
# "The game is decided by turn 5-6 — simulate only that."
#
# STATUS: IMPLEMENTED
# All infrastructure changes are in place and tested.
# - mulliganed field added to GameResult
# - ref + mulliganed condition types added to query system
# - resolveRefs() preprocessing wired through CLI
# - maxTurns passthrough from sim config to runSimulation
#
# Notes:
# - Clarabelle (both versions) and You're Welcome are stubs (correct stats, no abilities)
# - Tipo, Sail the Azurite Sea, Cinderella - Dream Come True have full abilities
# - cinderella-deck.txt is a placeholder — replace with real deck list
# - Run with: pnpm query -- --sim sims/cinderella/sim.json --questions sims/cinderella/questions.json

---

## The Core Idea

The opponent uses the goldfish deck (already exists: goldfish-deck.txt).
The goldfish deck passes every turn and never interacts.
Set maxTurns low (12 = 6 turns each player).
Simulate 50-500 games depending on how fast you need results.
Query the results with named conditions to analyze mulligan decisions.

This reuses 100% of existing infrastructure:
- Same runGame loop
- Same GameResult schema (plus mulliganed field)
- Same query system (plus ref + mulliganed condition)
- Same CLI commands

No new simulation code. Just config + query additions.

---

## Change 1: Record Mulligan Decisions in GameResult

### simulator/types.ts

Add to GameResult:

```typescript
export interface GameResult {
    // ... existing fields ...

    // NEW: which players mulliganed their opening hand
    mulliganed: Record<PlayerID, boolean>;
}
```

### simulator/runGame.ts

The mulligan loop already exists. Just record the outcome:

```typescript
const mulliganed: Record<PlayerID, boolean> = { player1: false, player2: false };

if (!config.startingState) {
    const thresholds = config.mulliganThresholds ?? DEFAULT_MULLIGAN;
    for (const playerId of ["player1", "player2"] as const) {
        const bot = playerId === "player1" ? config.player1Strategy : config.player2Strategy;
        if (bot.type !== "algorithm" || bot.name === "random") continue;
        if (shouldMulligan(state, playerId, config.definitions, thresholds)) {
            state = performMulligan(state, playerId);
            mulliganed[playerId] = true;   // RECORD IT
        }
    }
}

// Include in return:
return {
    // ... existing fields ...
    mulliganed,
};
```

---

## Change 2: Named Condition Definitions (refs)

### questions file format

Add a top-level "definitions" object. Conditions can reference definitions
by name using `{ "type": "ref", "name": "..." }`.

```json
{
  "definitions": {
    "condition_name": { ...GameCondition... },
    "another_condition": { ...GameCondition... }
  },
  "queries": [
    {
      "name": "Human readable question",
      "condition": { "type": "ref", "name": "condition_name" }
    }
  ]
}
```

Refs can reference other refs. Resolution is recursive (with cycle detection).

### analytics/query.ts additions

Add to GameCondition type union:

```typescript
| { type: "ref"; name: string }
| { type: "mulliganed"; player?: PlayerRef }
```

Add ref resolution before matching:

```typescript
/**
 * Resolve all { type: "ref" } nodes in a condition tree.
 * Call this once before passing to matchesCondition.
 */
export function resolveRefs(
    condition: GameCondition,
    definitions: Record<string, GameCondition>,
    depth = 0
): GameCondition {
    if (depth > 20) throw new Error("Circular ref detected in conditions");

    if (condition.type === "ref") {
        const resolved = definitions[condition.name];
        if (!resolved) throw new Error(`Unknown condition ref: "${condition.name}"`);
        return resolveRefs(resolved, definitions, depth + 1);
    }

    // Recursively resolve refs in compound conditions
    if (condition.type === "and") {
        return { type: "and", conditions: condition.conditions.map(c => resolveRefs(c, definitions, depth + 1)) };
    }
    if (condition.type === "or") {
        return { type: "or", conditions: condition.conditions.map(c => resolveRefs(c, definitions, depth + 1)) };
    }
    if (condition.type === "not") {
        return { type: "not", condition: resolveRefs(condition.condition, definitions, depth + 1) };
    }

    return condition;
}
```

Add mulliganed condition to matchesCondition:

```typescript
case "mulliganed": {
    return result.mulliganed?.[pid] === true;
}
```

### cli/commands/query.ts

Load definitions from questions file and resolve refs before evaluating:

```typescript
interface QuestionsFile {
    definitions?: Record<string, GameCondition>;
    queries: { name: string; condition: GameCondition }[];
}

// Before running queries:
const definitions = questionsFile.definitions ?? {};
for (const query of questionsFile.queries) {
    const resolved = resolveRefs(query.condition, definitions);
    const result = queryResults(results, resolved);
    printQueryResult(query.name, result);
}
```

---

## Sim Config for Cinderella/Clarabelle Line

### cinderella-sim.json

```json
{
  "me": "../decks/cinderella-deck.txt",
  "opponent": "../decks/goldfish-deck.txt",
  "bot": "greedy",
  "opponentBot": "random",
  "iterations": 50,
  "maxTurns": 12
}
```

50 iterations to start — runs in seconds, enough to confirm queries work.
Bump to 500 or 5000 once queries are validated.

maxTurns: 12 = 6 turns per player. Game ends regardless of lore.
Winner is whoever has more lore at turn 12 (doesn't matter for goldfish analysis).

### cinderella-deck.txt (placeholder — fill with real cards)

```
# Cinderella / Clarabelle line deck
# Adjust counts to match your actual deck

4 Cinderella - <subtitle>          # 4-cost uninkable
4 Clarabelle Cow - <small version>  # 1-cost
4 Clarabelle Cow - <shift version>  # 7-cost, shift 5
4 You're Welcome                    # 4-cost action-song
4 Sail the Azurite Sea              # 2-cost action, ink ramp
4 Tip                               # 2-cost action, ink ramp
4 Develop Your Brain               # 2-cost action, scry 2

# Fill remaining 36 slots with inkable cards at appropriate curve
# Use real deck cards here
```

---

## Questions File for Cinderella Line Analysis

### The Probability Funnel

The questions are structured as a funnel. Each stage conditions on the
previous one — you can read the dropout rate at each step:

```
P(opening hand has ramp)                              ← M1/M2/M3/M4 mulligan questions
    ↓ how often does ramp availability translate?
P(ramp drawn by turn 2)                               ← F1
    ↓ given ramp, how often does Cinderella follow?
P(Cinderella drawn by turn 3 | had ramp turn 2)       ← F2 + F2a
    ↓ given both, how often do Clarabelles arrive?
P(both Clarabelles drawn by turn 4 | prev steps)      ← F3 + F3a
    ↓ full line availability (bot-independent)
F3: P(all pieces drawn at right times)                ← the honest ceiling
F4: P(bot actually executed the line)                 ← what RampCindyCowBot achieves

Gap between F3 and F4 = bot execution error rate
```

Note on F3 vs F4:
- F3 uses card_drawn_by — "were pieces available" — bot quality irrelevant
- F4 uses card_played_by — "did bot execute the line"
- Use F3 for mulligan decisions. Use F4 to measure bot execution quality.

### cinderella-questions.json

```json
{
  "definitions": {

    "ramp_in_opener": {
      "type": "or",
      "conditions": [
        { "type": "card_drawn_by", "card": "sail-the-azurite-sea", "turn": 1, "player": "me" },
        { "type": "card_drawn_by", "card": "tip",                   "turn": 1, "player": "me" }
      ]
    },

    "ramp_drawn_turn2": {
      "type": "or",
      "conditions": [
        { "type": "card_drawn_by", "card": "sail-the-azurite-sea", "turn": 2, "player": "me" },
        { "type": "card_drawn_by", "card": "tip",                   "turn": 2, "player": "me" }
      ]
    },

    "cinderella_drawn_turn3": {
      "type": "card_drawn_by",
      "card": "cinderella-CARDID",
      "turn": 3,
      "player": "me"
    },

    "small_clarabelle_drawn_turn4": {
      "type": "card_drawn_by",
      "card": "clarabelle-small-CARDID",
      "turn": 4,
      "player": "me"
    },

    "big_clarabelle_drawn_turn4": {
      "type": "card_drawn_by",
      "card": "clarabelle-big-CARDID",
      "turn": 4,
      "player": "me"
    },

    "all_pieces_available": {
      "type": "and",
      "conditions": [
        { "type": "ref", "name": "ramp_drawn_turn2" },
        { "type": "ref", "name": "cinderella_drawn_turn3" },
        { "type": "ref", "name": "small_clarabelle_drawn_turn4" },
        { "type": "ref", "name": "big_clarabelle_drawn_turn4" }
      ]
    },

    "has_ramp_turn2_played": {
      "type": "or",
      "conditions": [
        { "type": "card_played_by", "card": "sail-the-azurite-sea", "turn": 2, "player": "me" },
        { "type": "card_played_by", "card": "tip",                   "turn": 2, "player": "me" }
      ]
    },

    "full_line_executed": {
      "type": "and",
      "conditions": [
        { "type": "ref", "name": "has_ramp_turn2_played" },
        { "type": "card_played_by", "card": "cinderella-CARDID",       "turn": 3, "player": "me" },
        { "type": "card_played_by", "card": "clarabelle-small-CARDID", "turn": 4, "player": "me" },
        { "type": "card_played_by", "card": "clarabelle-big-CARDID",   "turn": 4, "player": "me" }
      ]
    },

    "dyb_turn1": {
      "type": "card_played_by",
      "card": "develop-your-brain",
      "turn": 1,
      "player": "me"
    },

    "dyb_in_opener": {
      "type": "card_drawn_by",
      "card": "develop-your-brain",
      "turn": 1,
      "player": "me"
    }

  },

  "queries": [

    {
      "name": "--- FUNNEL STAGE 1: RAMP AVAILABILITY ---",
      "condition": { "type": "won" }
    },

    {
      "name": "F1. Had ramp drawn by turn 2",
      "condition": { "type": "ref", "name": "ramp_drawn_turn2" }
    },

    {
      "name": "F1a. Had ramp in opening hand (turn 1)",
      "condition": { "type": "ref", "name": "ramp_in_opener" }
    },

    {
      "name": "F1b. No ramp by turn 2 — line dead",
      "condition": {
        "type": "not",
        "condition": { "type": "ref", "name": "ramp_drawn_turn2" }
      }
    },

    {
      "name": "--- FUNNEL STAGE 2: CINDERELLA GIVEN RAMP ---",
      "condition": { "type": "won" }
    },

    {
      "name": "F2. Had ramp turn 2 AND Cinderella drawn by turn 3",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "ref", "name": "ramp_drawn_turn2" },
          { "type": "ref", "name": "cinderella_drawn_turn3" }
        ]
      }
    },

    {
      "name": "F2a. Had ramp turn 2 but missed Cinderella turn 3",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "ref", "name": "ramp_drawn_turn2" },
          { "type": "not", "condition": { "type": "ref", "name": "cinderella_drawn_turn3" } }
        ]
      }
    },

    {
      "name": "--- FUNNEL STAGE 3: CLARABELLES GIVEN RAMP + CINDERELLA ---",
      "condition": { "type": "won" }
    },

    {
      "name": "F3. Ramp T2 + Cinderella T3 + both Clarabelles by T4 (availability ceiling)",
      "condition": { "type": "ref", "name": "all_pieces_available" }
    },

    {
      "name": "F3a. Had pieces but missing small Clarabelle by T4",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "ref", "name": "ramp_drawn_turn2" },
          { "type": "ref", "name": "cinderella_drawn_turn3" },
          { "type": "not", "condition": { "type": "ref", "name": "small_clarabelle_drawn_turn4" } }
        ]
      }
    },

    {
      "name": "F3b. Had pieces but missing big Clarabelle by T4",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "ref", "name": "ramp_drawn_turn2" },
          { "type": "ref", "name": "cinderella_drawn_turn3" },
          { "type": "not", "condition": { "type": "ref", "name": "big_clarabelle_drawn_turn4" } }
        ]
      }
    },

    {
      "name": "--- FUNNEL STAGE 4: BOT EXECUTION ---",
      "condition": { "type": "won" }
    },

    {
      "name": "F4. Full line executed by bot (ramp played T2, Cin played T3, shift played T4)",
      "condition": { "type": "ref", "name": "full_line_executed" }
    },

    {
      "name": "--- MULLIGAN DECISIONS ---",
      "condition": { "type": "won" }
    },

    {
      "name": "M1. Had ramp in opening 7 (no mulligan needed for ramp)",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "not", "condition": { "type": "mulliganed", "player": "me" } },
          { "type": "ref", "name": "ramp_in_opener" }
        ]
      }
    },

    {
      "name": "M2. Mulliganed all 7 (no DYB kept), found ramp turn 2",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "mulliganed", "player": "me" },
          { "type": "not", "condition": { "type": "ref", "name": "dyb_in_opener" } },
          { "type": "ref", "name": "ramp_drawn_turn2" }
        ]
      }
    },

    {
      "name": "M3. Kept DYB, mulliganed 6, found ramp turn 2",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "mulliganed", "player": "me" },
          { "type": "ref", "name": "dyb_in_opener" },
          { "type": "ref", "name": "ramp_drawn_turn2" }
        ]
      }
    },

    {
      "name": "M4. Kept DYB, mulliganed 6, played DYB turn 1, found ramp turn 2",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "mulliganed", "player": "me" },
          { "type": "ref", "name": "dyb_in_opener" },
          { "type": "ref", "name": "dyb_turn1" },
          { "type": "ref", "name": "ramp_drawn_turn2" }
        ]
      }
    },

    {
      "name": "M5. Mulliganed (any strategy) and still no ramp — double miss",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "mulliganed", "player": "me" },
          { "type": "not", "condition": { "type": "ref", "name": "ramp_drawn_turn2" } }
        ]
      }
    },

    {
      "name": "--- DYB VALUE ---",
      "condition": { "type": "won" }
    },

    {
      "name": "D1. DYB played turn 1 AND found ramp turn 2",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "ref", "name": "dyb_turn1" },
          { "type": "ref", "name": "ramp_drawn_turn2" }
        ]
      }
    },

    {
      "name": "D2. DYB played turn 1 AND all pieces available (full funnel with DYB)",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "ref", "name": "dyb_turn1" },
          { "type": "ref", "name": "all_pieces_available" }
        ]
      }
    },

    {
      "name": "D3. No DYB turn 1 AND all pieces still available (full funnel without DYB)",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "not", "condition": { "type": "ref", "name": "dyb_turn1" } },
          { "type": "ref", "name": "all_pieces_available" }
        ]
      }
    }

  ]
}
```

Note: The "---SECTION HEADER---" queries use `{ "type": "won" }` as a dummy
condition just to produce a visual separator in the output. The win rate
number on these rows is meaningless — ignore it. Only the section name matters.
(Alternatively, Claude Code can add a "comment" condition type that always
returns true and prints nothing — but the dummy approach works for now.)

---

## How to Read the Results (for Sunday)

### The Funnel — read top to bottom

```
F1:  P(ramp by turn 2)          — your ceiling. Everything downstream ≤ this.
F2:  P(ramp T2 + Cin T3)        — how much ramp helps find Cinderella
F3:  P(all pieces available)    — the honest line rate
F4:  P(bot executed the line)   — measures bot execution quality
```

If F1 is 60% but F3 is 20%, you're losing 40% between ramp and having all pieces.
That tells you the deck needs more Cinderella or Clarabelle copies, not more ramp.

If F1 is 40%, ramp is the bottleneck. The mulligan questions tell you what to do.

### The Mulligan Decision — read M1 through M5

The decision tree:
```
Do you have ramp in opener?
  YES → M1 fires, keep the hand (assuming other conditions are met)
  NO  → Do you have DYB?
          YES → M3/M4: keep DYB, mulligan 6. Is M3 > M2? Keep DYB.
          NO  → M2: mulligan all 7.
```

**If M3 > M2** — keeping DYB and mulliganing 6 finds ramp more often than
mulliganing all 7. Keep DYB.

**If M2 ≈ M3** — DYB isn't moving the needle on ramp consistency. Mulligan all 7
and take the fresh hand.

**M5** — how often does mulliganing fail completely? If M5 is above 20%,
your deck simply doesn't have enough ramp pieces and no mulligan strategy fixes it.

### The DYB Value — read D1/D2/D3

**D2 vs D3** — this is the key comparison.
D2 = P(full line available | played DYB turn 1)
D3 = P(full line available | did NOT play DYB turn 1)

If D2 > D3 by more than 5% — DYB turn 1 is genuinely improving your full line rate.
If D2 ≈ D3 — DYB turn 1 isn't helping the specific Cinderella line. Maybe DYB
is better held for a different turn, or the deck has enough pieces without it.

---

## Run Commands

```bash
cd packages/cli

# Step 1: run 50 goldfish games (fast)
pnpm query --sim ./cinderella-sim.json --save ./cinderella.sim-results.json

# Step 2: ask all questions
pnpm query --results ./cinderella.sim-results.json --questions ./cinderella-questions.json

# Once queries are validated, bump to 500:
# Update iterations in cinderella-sim.json to 500, re-run step 1
```

---

## What's Left Before Running

All infrastructure is implemented. Remaining:

1. Replace `decks/cinderella-deck.txt` with your real 60-card deck list
2. (Optional) Implement Clarabelle/You're Welcome abilities — stubs work fine for draw probability analysis

---

## Card IDs to Implement (New Set Cards)

These need to be added to the card JSON before the sim runs.
Implement as stubs first (correct stats, abilities as vanilla/empty)
so the deck parses and the sim runs, then fill in abilities properly.

Cards needed:
- cinderella-<subtitle>       cost 4, uninkable, character
- clarabelle-cow-<small>      cost 1, character
- clarabelle-cow-<big>        cost 7, shift 5, character
- you're-welcome              cost 4, action, song, inkable
- sail-the-azurite-sea        cost 2, action, inkable — draws 1, allows extra ink play
- tip                         cost 2, action, inkable — inks a card from hand
  (develop-your-brain already in Set 1)

Sail the Azurite Sea and Tip both interact with the ink system.
Sail the Azurite Sea grants an extra ink play (extra_ink_play effect — already implemented).
Tip puts a card from hand into inkwell directly (move_to_inkwell effect — check if implemented).