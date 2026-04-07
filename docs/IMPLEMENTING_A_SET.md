# Implementing a New Set

End-to-end playbook for taking a Lorcana set from "imported stub" to "fully implemented and tested." Based on the Set 2 implementation session.

## Prerequisites

- Set is already imported via `pnpm import-cards --sets N` (creates `packages/engine/src/cards/lorcast-set-XXX.json`)
- Each card has `_namedAbilityStubs[]` populated with raw rules text
- Set is loaded by `lorcastCards.ts` (check the imports there)

## Step 0 — Baseline

```bash
pnpm card-status --set N
```

You'll see something like:
```
SET   TOTAL  DONE VANILLA  FITS  NEW-TYPE  NEW-MECH  UNKNOWN
  N    225     0      43   113        43        26        0
```

- **Vanilla** = no named abilities (keyword-only). Already work in simulation. Do nothing.
- **Fits-grammar** = maps to existing Effect/Condition/Cost types. Implement first, no engine changes.
- **Needs-new-type** = needs a new Effect/StaticEffect/Cost/Condition/Trigger type added to the engine.
- **Needs-new-mechanic** = needs a whole new game system (Locations, Boost, Sing Together, etc).

If unknowns > 0, add patterns to `scripts/card-status.ts` until they're all categorized. See `docs/CARD_ISSUES.md` for the categorization framework.

## Step 1 — Bulk-implement fits-grammar cards

These need no engine changes. Implement in batches via the patch script.

### List the cards to implement
```bash
pnpm card-status --set N --category fits-grammar --verbose
```

### Patch them
Edit `scripts/implement-cards.ts` (a one-off scratch file — overwrite each session). Add a `patchSet("N", { ... })` block with the cards. Each entry maps `card-id` to either `{ abilities: [...] }` or `{ actionEffects: [...] }`.

Run: `pnpm tsx --tsconfig scripts/tsconfig.scripts.json scripts/implement-cards.ts`

### Tips for patching
- Look at Set 1 / Set 2 cards with similar text for ability shape examples
- Use the existing helpers/types — don't invent new ones in this step
- Reference: `LORCAST_CARD_DEFINITIONS` for stat lookups
- Pattern: 30-40 cards per batch is manageable
- Don't worry about every edge case — if it's close enough and uses existing types, ship it

### Verify
```bash
pnpm --filter engine test
pnpm card-status --set N
```

The DONE column should jump up. Tests should still pass (existing Set 1/2 tests cover the patterns).

## Step 2 — Implement needs-new-type cards (engine work)

Group cards by what engine feature they need:

```bash
pnpm card-status --set N --category needs-new-type --verbose
```

Identify the highest-impact engine additions (the ones that unblock the most cards across all sets, not just this set).

### For each new feature:
1. **Add the type** in `packages/engine/src/types/index.ts` (Effect, StaticEffect, Condition, TriggerEvent, Cost, etc.)
2. **Wire the handler** in `packages/engine/src/engine/reducer.ts` (`applyEffect`, `applyEffectToTarget`, `evaluateCondition`, `queueTriggersByEvent`, etc.)
3. **For statics**: handle in `packages/engine/src/engine/gameModifiers.ts`
4. **Patch the cards** that use it via `implement-cards.ts`
5. **Write a test** for the new feature in `setN.test.ts` (one test per new pattern, not per card)
6. **Run tests**: `pnpm --filter engine test`

### Example: adding a new condition type
```typescript
// types/index.ts — add to Condition union
| { type: "this_has_no_damage" }

// utils/index.ts — add case in evaluateCondition()
case "this_has_no_damage": {
  const inst = state.cards[sourceInstanceId];
  return inst ? inst.damage === 0 : false;
}

// Use in card JSON
{
  type: "static",
  effect: { type: "modify_stat", stat: "strength", modifier: 4, target: { type: "this" } },
  condition: { type: "this_has_no_damage" }
}
```

## Step 3 — Implement needs-new-mechanic cards (big design)

These need the most thought. Examples: Locations, Boost, Sing Together, Replacement Effects.

### Process
1. Read the relevant CRD section in `docs/Disney-Lorcana-Comprehensive-Rules-*.pdf`
2. Update `docs/CRD_TRACKER.md` with the mechanic spec before coding
3. Design the data model — what state changes? what new types?
4. Implement it iteratively — get one card working, then expand
5. Write tests as you go in `setN.test.ts`

Some mechanics (like Locations) need:
- New `cardType: "location"` handling in zones
- New `MOVE_CHARACTER` action
- New "while here" static context
- Lore gain in Set step (CRD 3.2.2.2)
- Challenge interactions (CRD 4.6.8)

Don't try to implement these in one session — each is its own focused effort.

## Step 4 — Cards needing input from the user

For Set 2 we found ~10 cards where the implementation had subtle bugs or edge cases that only sandbox testing caught. The user can give scenarios like:

> "Opponent has 6 cards. I play Sudden Chill. PJ should draw 1. Then I play You Have Forgotten Me. PJ should draw 2 in one trigger."

Walk through the scenario, write a test, find the bug. This caught the `cards_discarded` trigger interrupting mid-action.

## Step 5 — Test coverage

Add tests in `packages/engine/src/engine/setN.test.ts` for:
- Each new engine feature added (one test per pattern, not per card)
- Edge cases the user identified
- Cards with non-trivial state interactions (multi-trigger ordering, conditional statics, etc.)

Don't retest patterns already covered in Set 1/Set 2. The CRD test file (`reducer.test.ts`) covers core mechanics — only add to it if you added a new core mechanic.

### Test file structure
```
packages/engine/src/engine/
├── reducer.test.ts        — CRD rules (core engine)
├── set1.test.ts           — Set 1 unique patterns
├── set2.test.ts           — Set 2 unique patterns
├── setN.test.ts           — NEW
└── test-helpers.ts        — shared helpers
```

## Step 6 — Update docs

When the set is done:
- `docs/CARD_ISSUES.md` — mark set complete, remove from status table
- `docs/CRD_TRACKER.md` — flip ❌ to ✅ for any rules now implemented
- `docs/ROADMAP.md` — add to "Where We Are"
- `CLAUDE.md` — update engine test count + cards line

## Step 7 — Commit cadence

Don't wait until the whole set is done. Commit after each batch:

```bash
git add packages/engine/src/cards/lorcast-set-XXX.json scripts/implement-cards.ts
git commit -m "cards: implement Set N batch X — Y more cards (Z total)"
```

When you add engine features, commit those separately:
```bash
git add packages/engine/src/types/index.ts packages/engine/src/utils/index.ts ...
git commit -m "feat: <feature name> — unblocks <cards>"
```

## Anti-patterns to avoid

❌ **Don't write tests for every card.** One test per new pattern. Patterns that exist in Set 1/2 are already covered.

❌ **Don't fake implementations with no-op statics.** If a card needs an engine feature you haven't built, leave it as a stub or implement the feature properly. No-ops lie to the tracker.

❌ **Don't implement set-by-set in the order they were released.** Implement by demand or by category. If Set 7 has the cards you need to analyze a deck, do those first.

❌ **Don't skip CRD verification.** Read the actual CRD rule for any non-trivial mechanic. Cards often have subtle wording that matters ("another", "may", "until the start of your next turn", etc.).

❌ **Don't process triggers inline mid-action.** Use `queueTriggersByEvent` then let the wrapping `applyAction → processTriggerStack` handle it. Inline `processTriggerStack` calls interrupt the current effect chain (this was a real bug we fixed for `cards_discarded`).

## Final checklist

- [ ] All cards have `abilities` or `actionEffects` populated (no stubs)
- [ ] `pnpm card-status --set N` shows 0 unknowns + 0 fits-grammar/needs-new-type/needs-new-mechanic remaining
- [ ] All tests pass (`pnpm --filter engine test`)
- [ ] Set has its own test file (`setN.test.ts`) with tests for any new patterns
- [ ] Docs updated
- [ ] Committed and pushed
