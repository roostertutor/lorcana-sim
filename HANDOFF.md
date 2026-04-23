# HANDOFF.md — open items for non-engine specialists

This file tracks engine-side changes whose downstream work (UI, bot, analytics)
has been deferred. Each entry describes what's in place, what's missing, and
who needs to pick it up.

---

## 2026-04-23 — aggregate-sum target chooser needs UI running-total (ui-specialist / gameboard-specialist)

**Context.** PR 3 landed the `totalXAtMost/AtLeast` aggregate-sum primitive on
`CardTarget.chosen` (PR b8a of `feat(engine): Leviathan + aggregate-sum`),
enabling "banish any number of chosen opposing characters with total {S} 10 or
less" (Leviathan IT'S A MACHINE!) and related cards like Royal Tantrum
("any number of your items"). The engine surfaces the new fields on the
`choose_target` PendingChoice so the UI has everything it needs; no UI work
has been done yet.

**What the engine now sends on `pendingChoice` (all optional, forwarded from
the target spec):**

```ts
{
  type: "choose_target",
  choosingPlayerId,
  validTargets: string[],
  count: number,               // resolved cap — "any" maps to validTargets.length
  optional: boolean,           // true for aggregate-cap or count:"any"
  totalStrengthAtMost?: number;
  totalStrengthAtLeast?: number;
  totalWillpowerAtMost?: number;
  totalWillpowerAtLeast?: number;
  totalCostAtMost?: number;
  totalCostAtLeast?: number;
  totalLoreAtMost?: number;
  totalLoreAtLeast?: number;
  totalDamageAtMost?: number;
  totalDamageAtLeast?: number;
  ...existing fields
}
```

Validator (`validateResolveChoice`) enforces all caps server-side. UI math is
purely cosmetic but important for player UX.

**UI work needed.**

1. **Choice modal — running-total indicator.** When any `total*` field is
   present on the pendingChoice, render a counter under the selection list
   showing the current sum vs. cap:

   ```
   Selected {S}: 7 / 10   ← green when ≤ cap, red when > cap
   ```

   Multiple caps can be set simultaneously (e.g. `totalCostAtMost` AND
   `totalStrengthAtLeast`); show each on its own line.

2. **Confirm button gating.** Disable Confirm when any `AtMost` cap is
   exceeded OR any `AtLeast` floor is unmet by the current selection. The
   engine validator will reject, but the UI should prevent the round-trip.

3. **Sum computation.** Use effective values, not printed (per-instance buffs
   count). The existing card UI already shows effective strength/willpower —
   sum those same values for the indicator.

4. **Zero-pick confirm.** When `pendingChoice.optional === true`, allow
   confirming an empty selection. Already supported by the engine — the
   existing "Skip" or "Pass" button should map here.

5. **Cards currently exercising this.** Leviathan IT'S A MACHINE!,
   Ever as Before (migrated from `count: 99` sentinel), Royal Tantrum (fixed
   pre-existing bug). Future cards with "any number with total X ≤ N" wording
   automatically surface these same fields.

**Tests.** Engine-side regression coverage lives in `set12.test.ts`:
`describe("Set 12 — Leviathan IT'S A MACHINE! …")` and
`describe("Set 5 — Royal Tantrum …")`. UI tests should mirror: mount the
choice modal, toggle selections, verify the running total + button state.

**Reference.** Sing Together's choice UI (multi-singer picker with cost
floor) is the closest existing pattern — look at how the lobby/gameboard
handle multi-select with validation for a template.
