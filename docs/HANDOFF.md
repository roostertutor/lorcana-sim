# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

---

## GUI: alt-shift cost picker — PendingChoiceModal routing for hand-card pick

Reported as "I can PLAY Diablo Devoted Herald for free (with a shift target in
play and an action card in hand)." Verified engine-side: engine is correct —
confirmed by `set4.test.ts` "alt-shift: trace — Diablo Devoted Herald..."

Engine flow:
1. getAllLegalActions surfaces two PLAY_CARD actions for the in-hand Diablo:
   normal (cost 3 ink) + shift (shiftTargetInstanceId, no altShiftCostInstanceIds).
2. Dispatching the shift action creates a `choose_target` pendingChoice with
   `count: 1`, `validTargets: [<action-card-id>]`, `_altShiftCostContinuation`
   carrying the shift target + costType=discard + exactCount=1.
3. Ink is NOT spent; card stays in hand.
4. Validator rejects resolve with empty choice (exactCount=1 enforced).
5. Resolve with the action card → discard + shift completes, 0 ink spent.

If the user sees Diablo enter play without being prompted to pick an action
to discard, the GUI is either:
- bypassing the pendingChoice (dispatching the shift then silently consuming
  the pendingChoice without showing the modal), or
- showing a modal but letting the player confirm with no selection (validator
  would reject but the GUI may interpret the rejection as "succeeded"), or
- not surfacing the PendingChoiceModal at all for the new `_altShiftCostContinuation`
  hand-card picker (it was previously handled by GameBoard's alt-shift picker
  mode, which is now dead code after the altShift migration in 677acd1).

Verify path: drag Diablo onto the base → useBoardDnd.ts:67 finds PLAY_CARD
with shiftTargetInstanceId but no altShiftCostInstanceIds → dispatches directly
(line 77). Engine creates pendingChoice. PendingChoiceModal should render the
hand card as a tappable thumb (`validTargets` grid at PendingChoiceModal.tsx:169
or the main single/multi-select path at 520+). If the hand card doesn't appear
as a target in the modal, CardThumb rendering may not support hand-zone cards
in the choose_target grid.

Quickest sanity check: log `session.pendingChoice` right after dispatching a
Diablo shift — it should have `_altShiftCostContinuation` set and validTargets
containing the action's instance ID. If it does, the modal's rendering is the
gap. If it doesn't, something in the engine isn't creating the pendingChoice
for that code path.

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
