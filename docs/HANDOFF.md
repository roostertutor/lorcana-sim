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
