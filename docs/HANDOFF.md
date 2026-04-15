# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

---

## Engine: unify play-cost and move-cost reduction systems (deferred cleanup)

Both follow the same conceptual model — base cost + ordered stack of
reductions, where each reduction has a CardFilter (what's eligible for the
discount), an amount, an optional selfOnly/oncePerTurn gate, and a
sourceInstanceId for the once-per-turn marker. They're implemented as two
independent code paths today:

- **Play**: `gameModifiers.costReductions` Map (statics like Mickey Broom),
  `state.players[pid].costReductions` (one-shot like Lantern), `self_cost
  _reduction` static (LeFou), once-per-turn keys (Grandmother Willow). Stacked
  in `applyPlayCard` ~640-712.
- **Move**: `gameModifiers.moveToSelfCostReductions` Map (location-keyed,
  Jolly Roger), `gameModifiers.globalMoveCostReduction[]` (item-keyed, Map
  of Treasure Planet) with optional `selfOnly` + `oncePerTurnKey` (Raksha,
  added 4c63b82). Stacked in `applyMoveCostReduction`.

Worth unifying once a third "cost reduction" mechanism appears (shift cost
reductions? sing cost reductions?). For now ~6 play cards + ~3 move cards
— not enough to justify the refactor. Cleanup-of-cleanup.

Unified shape if/when:
```ts
{ kind: "play" | "move",
  amount: number,
  cardFilter?: CardFilter,        // card being played/moved
  locationFilter?: CardFilter,    // move only
  playerId: PlayerID,
  selfOnly?: boolean,
  sourceInstanceId?: string,
  oncePerTurnKey?: string }
```

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

---

## GUI: each_player may-prompts route to the iteration player (not the caster)

Phase 1/2 `each_player` primitive (commits 249a0db, 7fa7bca) surfaces a
`choose_may` pendingChoice per player iteration when `isMay: true`, with
`choosingPlayerId` = the iteration player and `acceptControllingPlayerId` =
the caster. Cards: Donald Duck Perfect Gentleman ×2, Amethyst Chromicon,
Return of Hercules ×2.

Concretely for Donald Duck (caster is p2): on p2's turn start, the trigger
fires and immediately surfaces `choose_may` with `choosingPlayerId: "player2"`.
On accept, p2 draws; engine then surfaces the NEXT `choose_may` with
`choosingPlayerId: "player1"`. The pending-choice sequence is active-first.

What the GUI must do:
- Route the choose_may modal to `choosingPlayerId`, not to the source card's
  owner or to the active player. Previously the engine's generic isMay wrapper
  at `processTriggerStack` always used `source.ownerId` as the chooser — that
  path is now bypassed for `each_player`, and the iteration reducer sets the
  choosing player explicitly.
- In single-player sandbox (user + bot), when the bot is the `choosingPlayerId`
  the bot strategy must decide accept/decline for itself. If the bot only
  consults pendingChoice when it matches its own playerId, this should just
  work. Verify on Donald Duck on opponent side.
- The sequence of prompts means the GUI may flash two modals back-to-back.
  Consider keeping the second modal from visually overlapping the first's
  resolution animation (card draw etc).

Accept/reject routing: `acceptControllingPlayerId` is preserved on the
pendingChoice so reward effects (e.g. Return of Hercules' `play_card`) fire
with the correct controller — no change needed GUI-side. The modal just
needs to tell the RESOLVE_CHOICE action that `playerId` matches
`choosingPlayerId`.

---

## GUI: `put_card_on_bottom_of_deck` now supports `position: "top"`

Commit 249a0db extended the primitive with a `position` field. Cards:
- Gyro Gearloose NOW TRY TO KEEP UP (set 3) — item to top of deck
- Stitch Alien Buccaneer READY FOR ACTION (sets 6, 0P2) — action to top
- Gazelle Ballad Singer CROWD FAVORITE (set 10) — song to top

If the GUI has distinct animations for "to bottom of deck" vs "to top of
deck", it should read `effect.position` (or the resolved zone transition
event) to render the correct one. If the GUI just shows "moved to deck"
generically, no change needed.

---

## GUI: each_player rendering in card text / log messages

The decompiler renderer outputs "each opponent with more lore than you: they
lose 1 lore" — third-person rewrite of "you" → "they" inside the wrapper
body. If the GUI uses the engine's ability text or log messages to describe
what's happening at apply time (e.g. "player1 played Tangle → player2 lost
1 lore"), the log is already player-qualified via `appendLog`. No change
expected, but if any UI surfaces rulesText rendered by the decompiler, the
new wording is ready for it.
