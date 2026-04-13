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
