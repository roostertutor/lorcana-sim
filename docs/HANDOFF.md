# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

---

## Engine: `choose_amount` pending choice for `isUpTo` effects

**From:** GUI session (2026-04-11)

**Problem:** Cards with "up to N" effects (remove damage, move damage, exert) currently give the player no way to choose HOW MANY to apply. The engine treats `isUpTo` as all-or-nothing — either skip entirely (optional: true → resolve with []) or apply the full amount. Lorcana rules say "up to N" means the player chooses a number from 0 to N.

**Affected cards:**
- Cheshire Cat - Inexplicable: "move up to 2 damage counters"
- Rapunzel - Gifted with Healing: "remove up to 3 damage"
- Elsa - Spirit of Winter: "exert up to 2 chosen characters"
- Any other effect with `isUpTo: true` and `amount > 1`

**Proposed change:**

```ts
// New PendingChoice type
interface ChooseAmountChoice {
  type: "choose_amount";
  choosingPlayerId: PlayerID;
  prompt: string;
  min: number;    // usually 0
  max: number;    // effect amount, capped by actual available (e.g. damage on card)
  pendingEffect: Effect;
  sourceInstanceId: string;
  triggeringCardInstanceId?: string;
}
```

**Engine work:**
1. Add `choose_amount` to the PendingChoice union
2. In `remove_damage` chosen path: when `isUpTo` and amount > 1, surface `choose_amount` with max = min(effect.amount, target.damage). On resolve, remove that many.
3. In `move_damage`: after picking source and destination, surface `choose_amount` with max = min(effect.amount, source.damage). On resolve, move that many.
4. In `exert` chosen path with count > 1: already handled via multi-select choose_target (Elsa picks 0-2 targets). This one may be fine as-is since each target is a separate selection.
5. RESOLVE_CHOICE handler: accept a number for `choose_amount`, apply it to the pending effect.

**GUI work (after engine lands):**
Add a number picker to PendingChoiceModal for `choose_amount` — +/- buttons or a row of clickable numbers (0, 1, 2) with a Confirm button.

---

~~## Engine: Set 3 Ursula - Deceiver missing `reveal_hand` effect~~ **DONE**

Fixed 2026-04-12 — `reveal_hand` added before `discard_from_hand`.
