# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

---

## GUI: `choose_amount` number picker for `isUpTo` effects

**From:** Engine session (2026-04-12)

Engine now surfaces `choose_amount` pending choice for "up to N" effects in interactive mode. GUI needs a number picker in PendingChoiceModal:

- Read `pendingChoice.min` (usually 0) and `pendingChoice.max`
- Display +/- buttons or clickable number row (0, 1, 2, ..., max)
- Confirm button dispatches `RESOLVE_CHOICE` with `choice: selectedNumber`
- `pendingChoice.prompt` has the text (e.g., "Remove how much damage? (0–3)")

---

## GUI: Stat modifier badge shows clamped delta instead of actual modifier

**From:** Engine session (2026-04-12)

GameCard.tsx line ~210 computes `sDelta = strength - (def.strength ?? 0)` where `strength` is from `getEffectiveStrength` (clamped to 0 per CRD 6.6.2). Elsa (2 {S}) with -3 {S} debuff shows "-2" instead of "-3".

**Fix:** Sum `timedEffects.filter(te => te.type === "modify_strength").reduce(sum, te.amount)` + `staticBonus?.strength` directly for the badge instead of computing delta from the clamped effective value.

---

~~## Engine: `choose_amount` re-entry loop~~ **DONE**

Fixed — `isUpTo: false` set on overridden effect.

---

~~## Engine: `return_to_hand` missing `count` on pending choice~~ **DONE**

Fixed — `count: effect.target.count ?? 1` added.

---

~~## Engine: Set 3 Ursula - Deceiver missing `reveal_hand`~~ **DONE**

Fixed — `reveal_hand` added before `discard_from_hand`.
