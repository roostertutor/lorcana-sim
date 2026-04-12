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

## GUI: Stat modifier badge shows clamped delta instead of actual modifier

**From:** Engine session (2026-04-12)

**Bug:** GameCard.tsx line ~210 computes `sDelta = strength - (def.strength ?? 0)` where `strength` is from `getEffectiveStrength` (clamped to 0 per CRD 6.6.2). So Elsa (2 {S}) with Tiana's -3 {S} debuff shows "-2" instead of "-3".

**CRD 6.6.2:** "counts as having a Strength of 0 **except for the purpose of applying modifiers**" — the modifier IS -3, the floor is just for combat.

**Fix:** For the badge, sum `timedEffects.filter(te => te.type === "modify_strength").reduce(sum, te.amount)` + `staticBonus?.strength` directly instead of computing delta from the clamped effective value. The badge should show the raw modifier total, not the effective-vs-printed delta.

---

~~## Engine: Set 3 Ursula - Deceiver missing `reveal_hand` effect~~ **DONE**

Fixed 2026-04-12 — `reveal_hand` added before `discard_from_hand`.

---

## Engine: choose_amount re-entry loop — `isUpTo` not cleared on resolve

**From:** GUI session (2026-04-12)

**Bug:** When RESOLVE_CHOICE processes a `choose_amount`, it spreads the pending effect and overrides `amount` but keeps `isUpTo: true`. Then `applyEffectToTarget` sees `isUpTo: true` and creates ANOTHER `choose_amount` with the just-chosen amount as the new max. This loops: pick 3 → new modal 0-3, pick 2 → new modal 0-2, ... until confirm(0).

**One-liner fix** at `reducer.ts` line ~2091:
```js
// Before (bug):
const overridden = { ...pendingEffect, amount } as Effect;
// After (fix):
const overridden = { ...pendingEffect, amount, isUpTo: false } as Effect;
```

Setting `isUpTo: false` prevents re-entry — the overridden effect applies the chosen amount directly.
