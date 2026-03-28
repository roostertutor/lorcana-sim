# ANALYTICS_PHILOSOPHY.md
# The core tension in this analytics platform:
# what we've built vs what we actually need.
# Written after the Cinderella/Clarabelle goldfish simulation session.

---

## What We Built: A Hypothesis Tester

The current simulation pipeline is a **hypothesis tester**.

You form a theory — "I should keep DYB and mulligan 6 cards when I don't
have ramp" — you encode it into a bot or a query, you run the sim, it
confirms or denies the theory.

The Cinderella goldfish analysis is a perfect example:
- We encoded the "correct" mulligan strategy (keep DYB if no ramp)
- We encoded the "correct" line (Sail T2 → Cinderella T3 → shift T4)
- We ran 500 games
- The sim confirmed the line fires ~9% of the time

That's not useless. Confirming your intuition is right is valuable.
But it's not discovery. You already knew the line was hard to hit.
You already knew to keep DYB when you have no ramp. The sim just
put numbers on things you already believed.

**The tester answers: "Am I right?"**
**The generator answers: "What should I be doing?"**

We have the tester. We don't have the generator.

---

## Why the Tester Isn't Enough

When you play 100 games yourself, you develop intuition. You "know"
that keeping DYB is right because you've felt the games where it found
ramp and the games where it didn't. You remember the spectacular plays.
You forget the unremarkable ones.

Human memory is biased toward memorable outcomes and anchored to
the strategies you already play. You can't evaluate strategies you've
never tried because you've never tried them.

The sim running 5000 games should break this bias. But it can't, if
you're the one encoding the strategies. You encode what you know.
The sim validates what you encoded. Nothing new is discovered.

This is the trap we fell into with `RampCindyCowBot`:
- Human decides: keep DYB when no ramp, mulligan 6
- Human encodes this into the bot
- Bot executes this strategy 500 times
- Sim reports: strategy works ~X% of the time
- Human learns: their strategy works ~X% of the time

Compare that to what we actually want:
- Sim tries many strategies without human preconceptions
- Sim finds: strategy Y works better than strategy X
- Human learns: something they didn't already know

---

## The Spectrum: Tester to Generator

```
TESTER ←————————————————————————————→ GENERATOR

Hypothesis   Systematic    Opener      Reinforcement
Validation   Strategy      Profiling   Learning
(built)      Sweep         (next)      (future)
             (buildable)
```

### Stage 1: Hypothesis Validation (BUILT)
What we have now. Encode your strategy, run the sim, get a number.
Useful for confirming intuition. Not useful for discovering new strategies.

### Stage 2: Systematic Strategy Sweep (BUILDABLE NOW)
Define a space of possible strategies. Test all of them. Find the winner.

Instead of encoding "keep DYB if no ramp", define:
```
Strategy A: never mulligan
Strategy B: mulligan all 7 if no ramp
Strategy C: keep DYB, mulligan 6 if no ramp
Strategy D: keep any combo piece, mulligan rest
Strategy E: keep if 2+ inkable, else mulligan all 7
Strategy F: keep Cinderella if present regardless of ramp
```

Run 500 goldfish games for each. Compare F3 (full line availability).
The strategy with the highest F3 wins — and it might not be the one
you assumed.

This is discoverable without ML. It requires no new infrastructure.
Just a `mulliganStrategySweep()` function that iterates over strategies
and compares results.

### Stage 3: Opener Profiling (BUILDABLE NOW)
Instead of asking "does my strategy work," ask "what do winning games
have in common in their opening hands?"

```
Games where full line fired (9.2%):
  P(had ramp in opener):        ?%
  P(had Cinderella in opener):  ?%
  P(had DYB in opener):         ?%
  P(mulliganed):                ?%
  avg inkable cards in opener:  ?

Games where full line did NOT fire (90.8%):
  P(had ramp in opener):        ?%
  P(had Cinderella in opener):  ?%
  P(had DYB in opener):         ?%
  P(mulliganed):                ?%
  avg inkable cards in opener:  ?
```

The difference between these two profiles tells you what a "good hand"
actually looks like — derived from game outcomes, not from your assumptions.

If "had Cinderella in opener" appears in 80% of games where the line
fired but only 30% of games where it didn't, that tells you: when
evaluating a mulligan decision, Cinderella's presence matters more
than you thought.

This might contradict your intuition. That's the point.

### Stage 4: Reinforcement Learning (FUTURE)
The bot plays games, receives a reward signal ("did the line fire?"),
and updates its strategy weights without being told anything.

Over thousands of iterations it discovers which decisions correlate
with the line firing. It might find:
- "Keeping a hand with 3 inkable cards but no ramp is actually correct
  because the draw probability compensates"
- "Mulliganing when you have Cinderella but no ramp is wrong — Cinderella
  is so hard to find that keeping her outweighs the ramp miss"
- "The correct ink target on turn 1 is not the cheapest card but the
  card least likely to be needed in the next 3 turns"

These are things that are non-obvious from intuition and can't be
discovered by encoding your own strategy.

This is a different project. It needs a reward function, a policy
representation, and a training loop. It's weeks of work. But the
architecture is compatible — `GameState` is serializable, `runGame`
is a pure function, reward signals are computable from `GameResult`.

---

## What to Build Next (Ordered by Discovery Value)

### Immediate: Opener Profiling Queries

Add to `cinderella-questions.json`:

```json
{
  "name": "OP1. Full line fired AND had ramp in opener",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "ref", "name": "all_pieces_available" },
      { "type": "ref", "name": "ramp_in_opener" }
    ]
  }
},
{
  "name": "OP2. Full line fired AND had Cinderella in opener",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "ref", "name": "all_pieces_available" },
      { "type": "card_drawn_by", "card": "cinderella-dream-come-true", "turn": 1, "player": "me" }
    ]
  }
},
{
  "name": "OP3. Full line fired AND had DYB in opener",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "ref", "name": "all_pieces_available" },
      { "type": "ref", "name": "dyb_in_opener" }
    ]
  }
},
{
  "name": "OP4. Full line fired AND mulliganed",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "ref", "name": "all_pieces_available" },
      { "type": "mulliganed", "player": "me" }
    ]
  }
},
{
  "name": "OP5. Full line fired AND did NOT mulligan",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "ref", "name": "all_pieces_available" },
      { "type": "not", "condition": { "type": "mulliganed", "player": "me" } }
    ]
  }
},
{
  "name": "OP6. Full line MISSED AND had ramp in opener",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "not", "condition": { "type": "ref", "name": "all_pieces_available" } },
      { "type": "ref", "name": "ramp_in_opener" }
    ]
  }
},
{
  "name": "OP7. Full line MISSED AND had Cinderella in opener",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "not", "condition": { "type": "ref", "name": "all_pieces_available" } },
      { "type": "card_drawn_by", "card": "cinderella-dream-come-true", "turn": 1, "player": "me" }
    ]
  }
}
```

Read OP1 vs OP6 to understand whether ramp in opener predicts line success.
Read OP2 vs OP7 to understand whether Cinderella in opener predicts line success.
The card that most separates "line fired" from "line missed" is the card
you most need in your opener — and therefore the card that drives
mulligan decisions.

### Short term: Strategy Sweep

New CLI command: `pnpm sweep-mulligan --deck ./deck.txt --target full_line`

Defines a set of mulligan strategies, runs each 500 times, reports
F3 (line availability) for each. No encoding of "correct" strategy.
Just measure which strategy produces the best outcome.

```typescript
const STRATEGIES: MulliganStrategyConfig[] = [
  { name: "never",          condition: () => false },
  { name: "all-7-no-ramp",  condition: (hand) => !hasRamp(hand) },
  { name: "keep-dyb",       condition: (hand) => !hasRamp(hand),
                             keep: (hand) => hand.filter(isDYB).slice(0,1) },
  { name: "keep-cinderella", condition: (hand) => !hasRamp(hand),
                             keep: (hand) => hand.filter(isCinderella).slice(0,1) },
  { name: "keep-any-combo", condition: (hand) => !hasRamp(hand),
                             keep: (hand) => hand.filter(isCombo).slice(0,1) },
]
```

Output:
```
MULLIGAN STRATEGY SWEEP — Cinderella/Clarabelle line
500 games each

Strategy              F1 (ramp)   F3 (full line)   F4 (executed)
never                 72.4%       7.1%             4.2%
all-7-no-ramp         88.6%       9.2%             5.8%
keep-dyb              89.1%       9.8%             6.1%
keep-cinderella       88.3%      11.4%             7.2%  ← winner?
keep-any-combo        88.9%      10.6%             6.8%
```

If "keep-cinderella" produces higher F3 than "keep-dyb" — that's a
discovery. You never would have tested this because you assumed DYB
was the correct keep. The sweep finds it without being told.

### Long term: Reinforcement Learning

Deferred. Documented here so the architecture decision is recorded:
the `BotStrategy` interface is already compatible — a RL bot just
implements `decideAction()` using learned weights instead of hand-coded
logic. The training loop is the missing piece.

---

## The Honest Assessment of Current Analytics Value

**What the sim can tell you that you don't know:**
- Exact probability of finding specific card combinations by specific turns
- How deck composition changes affect these probabilities
- Which opener properties correlate with line success (after opener profiling)
- Which mulligan strategy objectively produces the best line rate (after sweep)

**What the sim cannot tell you yet:**
- Whether there's a better strategy than the ones you've defined
- Whether your intuition about which cards to keep is correct
- What the optimal play sequence is for edge cases

**What would require RL to discover:**
- Mulligan strategies you haven't thought of
- Ink sequencing decisions that aren't obvious
- Whether the whole line concept is optimal or if a different approach works better

The gap between "what we can tell you" and "what would require RL" is where
the strategy sweep and opener profiling live. Build those next.

---

## Principle: Discovery Before Confirmation

Going forward, before running any simulation, ask:

**"Am I testing a hypothesis I already believe, or am I looking for
something I don't know?"**

If testing: fine, but label it as confirmation, not discovery.
If looking: design the sim to present options without encoding the answer.

The strategy sweep is designed for discovery. The opener profiling is
designed for discovery. The `RampCindyCowBot` goldfish sim was confirmation.

Both are valuable. But we need more discovery and less confirmation.

---

*This doc should be added to docs/ in the repo alongside DECISIONS.md.*
*The DECISIONS.md update below should be applied by Claude Code.*