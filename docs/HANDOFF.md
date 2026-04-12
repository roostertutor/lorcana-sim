# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

---

~~## Engine: `choose_amount` pending choice for `isUpTo` effects~~ **DONE**

**Engine work completed 2026-04-12:**
- Added `choose_amount` to PendingChoice type union with `min`/`max` fields
- `remove_damage` with `isUpTo` in interactive mode surfaces `choose_amount`
- `move_damage` with `isUpTo` in interactive mode surfaces `choose_amount`
- RESOLVE_CHOICE handler: accepts number, overrides effect amount, applies to target
- Bot/non-interactive: unchanged — uses full amount (no choice surfaced)

**GUI work needed:**
Add a number picker to PendingChoiceModal for `choose_amount` type:
- Read `pendingChoice.min` (usually 0) and `pendingChoice.max`
- Display +/- buttons or clickable number row (0, 1, 2, ..., max)
- Confirm button dispatches `RESOLVE_CHOICE` with `choice: selectedNumber`
- `pendingChoice.prompt` has the text (e.g., "Remove how much damage? (0–3)")

---

~~## Engine: Set 3 Ursula - Deceiver missing `reveal_hand` effect~~ **DONE**

Fixed 2026-04-12 — `reveal_hand` added before `discard_from_hand`.
