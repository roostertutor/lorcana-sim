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

## GUI: `choose_from_revealed` now supports multi-pick + mandatory mode

Engine refactor collapsed `one_to_hand_rest_bottom` into `up_to_n_to_hand_rest_bottom`
and added `isMay` / `revealPicks` flags. The `choose_from_revealed` pending choice
for look-at-top effects now has **three new behaviors** the GUI needs to handle:

1. **Multi-pick** — `pendingEffect.maxToHand` can be > 1 (Look at This Family = 2,
   Dig a Little Deeper = 2, Might Solve a Mystery = 2). The player should be able
   to select 0..maxToHand cards from `validTargets` and submit all picks via a
   single `RESOLVE_CHOICE` with `choice: [pick1, pick2, ...]`. Currently the UI
   may only support single-pick.

2. **Mandatory vs optional** — `pendingChoice.optional` now reflects
   `effect.isMay ?? false`. When `false` (Dig a Little Deeper: "Put 2 into your
   hand"), the player MUST pick exactly `min(maxToHand, validTargets.length)`
   cards and cannot dismiss the modal. When `true` (Ariel: "you may reveal..."),
   the player can pick 0..maxToHand. UI should grey out / disable a skip button
   when `optional: false`.

3. **Private vs public picks** — `pendingEffect.revealPicks` controls whether the
   engine fires `card_revealed` events for the picks. DALD and Develop Your Brain
   have `revealPicks: false` — picks should NOT be shown to the opponent (no
   reveal overlay in multiplayer). The engine already handles this (no events
   fired, so `lastRevealedCards` stays unset for those picks). GUI just needs to
   trust the existing `lastRevealedCards` mechanism — no action needed if it
   already drives the overlay off that field. **Verify**: the reveal overlay is
   NOT shown for DALD in multiplayer (it should remain private info).

Affected cards — see oracle text for exact semantics:
- Mandatory + private: Dig a Little Deeper (2), Develop Your Brain (2),
  Hen Wen's Visions, How Far I'll Go (2), Pete Ghost of Christmas Future,
  Vision of the Future
- May + reveal (the majority ~46 cards): Ariel Spectacular Singer, Nani Stage
  Manager, Look at This Family, Jim Hawkins, Judy Hopps Uncovering Clues, etc.
- Mandatory + reveal: Bambi Ethereal Fawn (reveal-all variant),
  Invited to the Ball

