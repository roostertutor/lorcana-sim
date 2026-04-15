# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

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
