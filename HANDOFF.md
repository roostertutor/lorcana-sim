# HANDOFF.md — open items for non-engine specialists

This file tracks engine-side changes whose downstream work (UI, bot, analytics)
has been deferred. Each entry describes what's in place, what's missing, and
who needs to pick it up.

---

## FROM engine-expert → gameboard-specialist: running-total indicator needs effective-stat fix (Leviathan / Ever as Before / Royal Tantrum)

**Context.** Your implementation in `PendingChoiceModal.tsx` computes the
aggregate-sum running total correctly per the original spec — but the
original spec (HANDOFF v1) said "use the same helpers as the engine
validator." Turns out the engine validator itself was buggy: it called
`getEffectiveStrength(inst, def)` with both optional params defaulting
(`staticBonus=0`, `modifiers=undefined`), silently dropping every
static stat modifier from the sum. Your UI mirrored that call pattern,
so the same bug surfaces in the running-total display.

Shipped engine fix today (`95432e4`): the validator now resolves
`modifiers = getGameModifiers(state, definitions)` once per
RESOLVE_CHOICE and passes both `staticBonus` and `modifiers` into the
effective-stat helpers. Need the UI to do the same.

**The bug in user-facing terms.** Lawrence - Jealous Manservant has
printed {S}=0 and PAYBACK "+4 {S} while no damage." Undamaged Lawrence's
effective {S} is 4. Current UI behavior:

- User selects undamaged Lawrence (effective S=4) toward Leviathan's
  10-budget cap.
- Running total indicator shows `"Selected {S}: 0 / 10"` (WRONG — uses
  printed).
- User adds another 8-S character. Indicator shows `"8 / 10"` (under
  cap, Confirm enabled).
- User clicks Confirm. Engine validator (post-fix) computes true sum
  = 4 + 8 = 12 > 10, REJECTS with "exceeds total {S} cap".
- Player sees a confusing rejection after the UI said it was fine.

Any character whose effective strength differs from printed exhibits
the same mismatch: Belle Strange but Special's +strength, any shift
self-grant, any gain_stats timed effect from another card's ability.

**Fix.** In `PendingChoiceModal.tsx`, change the running-total
computation to match the validator's pattern
(`packages/engine/src/engine/validator.ts` around line 1051 — look for
the comment "Resolve each picked instance"):

```ts
// Currently (UI):
sumStrength += getEffectiveStrength(inst, def);
sumWillpower += getEffectiveWillpower(inst, def);
sumCost += def.cost;
sumLore += getEffectiveLore(inst, def);
sumDamage += inst.damage;

// Should be (matches engine validator):
import { getGameModifiers } from "@lorcana-sim/engine";
// …
const mods = getGameModifiers(state, definitions);  // compute once per render
for (const id of multiSelectTargets) {
  const inst = state.cards[id];
  const def = definitions[inst.definitionId];
  const bonus = mods.statBonuses.get(id);
  sumStrength  += getEffectiveStrength (inst, def, bonus?.strength  ?? 0, mods);
  sumWillpower += getEffectiveWillpower(inst, def, bonus?.willpower ?? 0, mods);
  sumLore      += getEffectiveLore     (inst, def, bonus?.lore      ?? 0, mods);
  sumCost      += def.cost;  // no modifier pipeline for cost — printed is effective
  sumDamage    += inst.damage;
}
```

`getGameModifiers` is already exported from `@lorcana-sim/engine`
(`packages/engine/src/index.ts:59`). It re-runs the full static-effect
collection pass, so call it **once per render cycle** — cheap for
runtime but not free; memoize on `state` identity if the modal
re-renders on every DnD hover.

**Test card for sandbox verification.** Inject Lawrence - Jealous
Manservant (set 2, id `lawrence-jealous-manservant`) into the opponent's
play zone with `damage: 0`. Play Leviathan with 2+ cards already in
your discard that turn. In the picker, undamaged Lawrence should show
his effective {S}=4 (not 0) toward the sum.

**Engine side is complete + regression tested.** Two new tests in
`set12.test.ts` specifically exercise Lawrence's PAYBACK interaction:
one confirms undamaged Lawrence counts as 4 (rejecting over-cap picks),
one confirms damaged Lawrence reverts to 0.

**Reported by**: user QA 2026-04-24 after sandbox play-through of set 12.

---

## FROM engine-expert → gameboard-specialist: `cant_action` pill grouping key (follow-up to the Gosalyn double-apply fix)

(Earlier note still open — `cant_action` grouping key should include
`action` field so quest + challenge render as separate pills. See
Gosalyn HEROIC INTERVENTION fix from `7c299d9`. Details in git log
for that commit.)

---

(no other open items)
