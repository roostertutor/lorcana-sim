# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

---

~~## GUI: `choose_amount` number picker for `isUpTo` effects~~ **DONE**

Already implemented — PendingChoiceModal handles `choose_amount` with +/- buttons and Confirm.

---

~~## GUI: Stat modifier badge shows clamped delta instead of actual modifier~~ **DONE**

Already fixed — GameCard.tsx sums timedEffects + staticBonus directly instead of computing from clamped effective value.

---

~~## Engine: `choose_amount` re-entry loop~~ **DONE**

Fixed — `isUpTo: false` set on overridden effect.

---

~~## Engine: `return_to_hand` missing `count` on pending choice~~ **DONE**

Fixed — `count: effect.target.count ?? 1` added.

---

~~## Engine: Set 3 Ursula - Deceiver missing `reveal_hand`~~ **DONE**

Fixed — `reveal_hand` added before `discard_from_hand`.

---

~~## Engine: `card_revealed` — persist on GameState for multiplayer visibility~~ **DONE**

`lastRevealedCards` added to `GameState` — set at the end of `applyAction` from
`card_revealed` events, cleared on next action if no reveals. Shape:
`{ instanceIds: string[]; sourceInstanceId: string; playerId: PlayerID }`.
GUI can read `gameState.lastRevealedCards` — works in sandbox, multiplayer, and replay.

---

~~## Server: Anti-cheat filter must include `lastRevealedCards` instance data~~ **DONE**

`stateFilter.ts` now whitelists `lastRevealedCards.instanceIds` — skips stubbing
those cards even if they're in the opponent's hand/deck.

---

~~## Engine: `lastRevealedCards` not set for triggered-ability reveals (Ariel Spectacular Singer)~~ **NOT AN ENGINE BUG**

Verified via trace test — engine sets `lastRevealedCards` correctly:
- Action 2 (RESOLVE choose_from_revealed): `lastRevealedCards` IS set with the chosen card
- Action 3 (RESOLVE choose_order): `lastRevealedCards` persists (not cleared)

The engine data is there. The problem is on the GUI side — likely the reveal
overlay is suppressed or not rendered when `pendingChoice` is also present
(`choose_order` is active at the same time as `lastRevealedCards`). The GUI
needs to show the reveal overlay even when a `pendingChoice` modal is queued.

---

~~## Engine: `search` effect auto-picks instead of letting player choose~~ **DONE**

Interactive mode now collects ALL matching cards with `.filter()` and presents a
`choose_from_revealed` pending choice when multiple matches exist (single match
auto-resolves). The `choose_from_revealed` handler detects `pendingEffect.type === "search"`
and moves the chosen card to the search's `putInto` destination without touching
the remaining deck cards.

---

~~## Engine: Discuss auto-resolve UX for forced single-target choices~~ **DONE (option 1)**

In interactive mode, the engine no longer auto-resolves:
- `search`: always shows `choose_from_revealed` even for single match
- `look_at_top` (no-filter, 1 card): shows `choose_from_revealed` instead of
  silently moving to hand

Note: `choose_target` and `choose_discard` already always created pending choices
— they were never auto-resolving. `choose` with 1 feasible option still auto-
resolves because CRD 6.1.5.2 mandates the forced pick (game rules, not UX skip).
Bot/headless mode unchanged.

---

~~## GUI: `choose_from_revealed` now supports multi-pick + mandatory mode~~ **DONE**

PendingChoiceModal.tsx now reads `pendingEffect.maxToHand` for `choose_from_revealed`
backed by `look_at_top` effects and caps picks by `Math.min(maxToHand, validTargets.length)`.

Behavior:
- **Multi-pick**: modal allows selecting 0..targetCount cards; resolves via array.
- **Mandatory vs optional**: driven by `pendingChoice.optional` (set from `effect.isMay`).
  When mandatory, header reads "Select N (X/N)", Confirm disabled unless
  `multiSelectTargets.length === targetCount`, no Skip button. When optional,
  header reads "Select up to N", Confirm enabled at ≥1, Skip button available.
- **Private vs public picks**: already handled by engine — private picks
  (`revealPicks: false`) don't emit `card_revealed` events, so `lastRevealedCards`
  stays unset and the overlay correctly stays hidden in multiplayer. The
  chooser still sees cards via `pendingChoice.revealedCards` (local modal only).

---

~~## GUI: update reveal overlay key to use `lastRevealedCards.sequenceId`~~ **DONE**

Two-part fix landed:
1. `currentRevealCardsKey` prefixes `sequenceId` so back-to-back reveals of
   the same cards produce distinct keys during normal play.
2. `useGameSession` now exposes `actionCount`; GameBoard watches it via a
   ref and resets `dismissedRevealKey` when it decreases (undo detected).
   This handles the quest → dismiss → undo → re-quest case where engine's
   state-derived sequenceId resets to 1.

---

~~## Engine: stamp producing ability/keyword onto TimedEffect for UI attribution~~ **DONE**

`TimedEffect.sourceStoryName?: string` added. Populated at creation time:
- Synthesized Support trigger sets `_sourceStoryName: "Support"` on its
  gain_stats effect.
- Trigger resolver also stamps `trigger.ability.storyName` onto any
  gain_stats effect before applying it, so explicit triggered abilities
  benefit too (preserves explicit attribution via `??`).
- `applyGainStatsToInstance` reads `effect._sourceStoryName` and writes
  `sourceStoryName` onto each modify_strength/willpower/lore TimedEffect
  it creates.

GUI can now read `timedEffect.sourceStoryName` directly instead of
guessing via the effect-type → keyword map.

Test: `set9-set11.test.ts` "The Queen Conceited Ruler: Support's
modify_strength is attributed to 'Support', not ROYAL SUMMONS".

Note: only gain_stats path is wired today. If we discover other TimedEffect
creators (grant_keyword, damage_prevention, etc.) need attribution, follow
the same pattern — add internal `_sourceStoryName` to that effect type and
plumb through the creator function.

---

## Engine + GUI: migrate altShift (Diablo/Flotsam) to pendingChoice pattern

Granted-free-play alt-cost (Belle banish_chosen, Scrooge exert_n_matching) now
uses a pendingChoice chooser after the Play click, via a `_freePlayContinuation`
field on choose_target (commit landed alongside bugs 1/2). The parallel altShift
path (`altShiftCost`, discard or banish to pay Shift) still uses the per-combo
action enumeration with the GUI's custom "alt-shift cost picker mode"
(GameBoard.tsx:513-1355, ~150 LOC of mode state, hand-tap handling, toast).

They're semantic twins ("pay a non-ink cost to play something"). Unifying:
- Engine: mirror the free-play pattern. Collapse altShift enumeration to one
  action per shift target; surface choose_target pendingChoice in
  applyPlayCard's altShiftCost branch with an `_altShiftCostContinuation`
  carrying shift target + cost type + exactCount. Resolver pays the cost using
  chosen IDs, then proceeds with the shift zoneTransition + shifted_onto
  trigger.
- GUI: delete alt-shift picker mode. PendingChoiceModal's generic choose_target
  already handles multi-pick with an exactCount-enforcing validator (added for
  Scrooge).

Requires coordinated engine + GUI change since the GUI's picker mode would
break if engine stops enumerating combos. Deferred until GUI agent available.

---

## Engine / GUI: chosen-target activated abilities with zero valid targets (CRD 1.7.6)

Reported as "Lucky Dime has no activate ability." Verified engine-side: Lucky
Dime's activated ability is wired correctly (conditional_on_target with empty
conditionFilter as a targeter wrapper), surfaces in getAllLegalActions, produces
the choose_target pendingChoice, and gains lore equal to the picked character's
{L}. Test added at `set3.test.ts` "Lucky Dime NUMBER ONE: activate surfaces..."

The gap: when the player has **zero characters of their own in play**, the
validator still reports the activate as legal (it only checks costs), so the
GUI shows the NUMBER ONE button. Clicking it pays the cost and creates a
pendingChoice with `validTargets: []` — a dead state with ink already spent.
Per CRD 1.7.6 the activation should be rejected entirely.

Two fix options:
1. **Engine**: extend validator to walk the ability's effects and reject
   ACTIVATE_ABILITY when any `{target: {type: "chosen", filter}}` or
   `conditional_on_target` with chosen target resolves to zero valid targets.
   ~20 LOC. Benefits all chosen-target activated abilities (Madam Mim - The Fox
   IMITATE, etc.), not just Lucky Dime.
2. **GUI**: when PendingChoiceModal sees `choose_target` with
   `validTargets.length === 0`, auto-dismiss and surface a "no legal target"
   toast so the player at least isn't stuck (cost is already paid — acceptable
   per CRD 1.7.7, just needs UX). Doesn't prevent the wasted ink.

Option 1 is more correct to CRD. Option 2 is a safety net. Ideally both.

---

## Card data: Madam Mim - Snake parsing vs oracle text

User flagged the card as "parsing a little iffy" while acknowledging the
wiring used the original oracle text verbatim. Not prioritized as a bug.

Next step: run `pnpm decompile-cards --set 002 | grep -A1 madam-mim-snake` to
diff the rendered JSON-to-English output against the oracle. If the similarity
tail flags a semantic mismatch, file as a card-data fix; otherwise it's
oracle-text phrasing preference and can be left alone.

---

## Simulator: bot policy enumerator only generates single-pick for multi-pick choices

`packages/simulator/src/rl/policy.ts:232-242` — the `choose_from_revealed`
candidate enumerator emits one candidate per valid target (single pick) plus
an empty-array candidate if optional. For mandatory multi-pick effects
(e.g. Dig a Little Deeper: pick exactly 2), this underfills — the bot will
only put 1 card into hand instead of 2, leaving the other picks on deck.

Fix: for `choose_from_revealed` backed by `look_at_top` with
`pendingEffect.maxToHand > 1`, enumerate multi-pick combinations (or at least
pick the top-K valid targets as a single candidate when mandatory). May need
a similar pass in any other bot that handles this choice type.

