# Implementing Cards — Two-Phase Strategy

End-to-end playbook for taking imported stub cards from sets 4–11 to fully
implemented and tested.

**Phase A — Engine work, organized by mechanic, cross-set.** Each addition
unlocks cards across many sets at once.

**Phase B — JSON wiring, organized by set, sequential.** Pure card-by-card,
no engine work.

## Why two phases instead of "do one set end-to-end"

The earlier strategy (do Set N end-to-end before moving on) made sense for
Sets 1–3 because each set had a unique structural feature (Set 1 = engine
bring-up, Set 2 = first card-specific work, Set 3 = Locations). For Sets 4–11
the work doesn't decompose by set:

- **Engine work clusters by mechanic, not set.** Lilo/Baymax/Thunderbolt span
  three sets but share one prerequisite (zone-aware static abilities).
  Implementing per-set means re-touching the same engine code three times.
- **Boost** is the dominant new mechanic across Sets 6–10 (~78 cards). One
  focused design pass beats five smaller ones.
- **Several sets (5, 9) introduce no new mechanic at all** — they're pure
  fits-grammar wiring.
- **Most "needs-new-type" effects appear in 1–2 sets but unlock cards in many.**
  Tackling them by cards-unblocked count beats set order every time.

But **JSON wiring is inherently per-card**. Once the engine has every feature
that any set needs, the wiring is just `{ id: { abilities: [...] } }` patches
in batches. That batches naturally by set — one set per session, predictable
cadence, easy to commit.

The mistake to avoid: interleaving Phase A and Phase B. If you wire a card
during Phase A, then Phase A's later engine work might require revisiting
that card. Two passes per card = wasted work.

## Two-phase strategy

The work splits cleanly into two phases. **Finish all of Phase A before
starting Phase B.** Mixing them is what makes the work feel slow.

### Phase A — Engine / mechanics (cross-set, sequential by mechanic)

Every engine addition unlocks cards across many sets at once. One design
decision, one PR, one test pattern per addition. **Order by
cards-unblocked count, not by set.** Don't wire any fits-grammar cards
during this phase — they'll come later in bulk and the engine work is
faster without them.

#### A.0 — Prerequisites (DONE)
- ✅ Zone-aware static abilities refactor (`StaticAbility.activeZones`,
  scanner iterates all zones, four new self-static effect types defined).
  See `memory/project_zone_aware_abilities.md` for what landed.

#### A.1 — Sing Together (DONE)
- ✅ Alternate-cost path in `validatePlayCard`: exert any number of your
  characters with combined cost ≥ song cost (CRD 8.12). 26 songs across
  Sets 4/8/9 carry `singTogetherCost` and validate via the new path.

#### A.2 — Boost (Set 6 onward, peaks Set 10 with ~55 cards)
- Largest design effort remaining. New `CardInstance.cardsUnder: string[]`
  field, new keyword `Boost N {I}`, new "cards under" counter for various
  effects ("for each card under him", "put all cards from under her into hand").
- Own session — **don't bundle with other work**.
- Touches: `CardInstance` type, `Keyword` enum, multiple new effect/condition
  types referencing the cards-under count, `banishCard`/`zoneTransition`
  cleanup (cards under leave when the parent does).

#### A.3 — Long tail of needs-new-type effects/conditions/triggers
- ~334 cards across all sets need a new Effect/Condition/Trigger/Cost type.
- Tackle by **cards-unblocked count** — implement the new type that unlocks
  the most cards across all sets first. Use
  `pnpm card-status --category needs-new-type --verbose` to enumerate.
- Examples (from `docs/CARD_ISSUES.md`):
  `move_damage`, `trim_inkwell`, `put_on_bottom`, `reveal_hand`,
  `random_discard`, `dynamic_deal_damage`, `gain_stats` with
  `end_of_owner_next_turn` duration, `compound_or` condition, etc.
- Most are small (~10 lines + a card-status update). Batch several per session.

#### A.4 — Wire forward-looking stubs from Phase A.0
- Lilo - Escape Artist (Set 6), Baymax (Set 7), Thunderbolt (Set 8) — the
  zone-aware refactor created the effect types but the cards aren't yet wired.
  Wire them when their sets are reached for testing, or as a one-off batch.

### Phase B — JSON wiring (per-set, after Phase A is done)

Once every engine feature exists, wiring is pure JSON. Inherently per-card,
batches naturally by set. **Do not start Phase B until Phase A is complete.**
Otherwise you'll touch each card twice.

#### Per-set workflow
1. `pnpm card-status --set N --category fits-grammar --verbose` — list cards
2. Write `scripts/implement-setN-batchX.ts` patching ~20–30 cards per batch
3. Run the patch script
4. `pnpm --filter @lorcana-sim/engine test` — confirm nothing broke
5. Commit the batch
6. Repeat for the next batch in the same set
7. Move to the next set

#### Set order in Phase B
No strong preference. Reasonable defaults:
- Sets 5, 9 are mostly fits-grammar (no new mechanics) — they're the
  "easiest" because every card maps cleanly
- Sets 4, 6, 7, 8, 10, 11 are larger / more varied — do them later when
  the patterns are well-established

## Phase A workflow (per-mechanic session)

### Step 0 — Pick a mechanic
Look at `docs/CARD_ISSUES.md` and `pnpm card-status --category needs-new-type --verbose`.
Pick the mechanic that unlocks the most cards (or the one the user asked for).

### Step 1 — Read CRD before coding
- Read the relevant CRD section in
  `docs/Disney-Lorcana-Comprehensive-Rules-*.pdf`
- Update `docs/CRD_TRACKER.md` with the mechanic spec
- Identify all cards across all sets that use this mechanic (not just one set)

### Step 2 — Design the data model
- What new types? (Effect, StaticEffect, Condition, Cost, TriggerEvent)
- What new state? (PlayerState, GameState, GameModifiers slot)
- What pre-existing patterns can it reuse?

### Step 3 — Implement and test
1. Add types in `types/index.ts`
2. Wire handler in `reducer.ts` (`applyEffect`, `applyEffectToTarget`,
   `evaluateCondition`, `queueTriggersByEvent`, etc.)
3. For statics: `gameModifiers.ts`
4. **Wire just ONE card** that uses the new feature (the "canary") to prove
   the engine path works end-to-end. Don't bulk-wire — that's Phase B.
5. Write a test for the new pattern (one test per pattern, not per card)
6. Run `pnpm --filter engine test`

### Step 4 — Update docs and move on
- `docs/CARD_ISSUES.md` — strike resolved entries, list new ones if any
- `docs/CRD_TRACKER.md` — flip ❌ to ✅ for any rules now implemented
- Memory if it's a forward-looking design decision

The remaining cards using this mechanic stay as stubs until Phase B.

## Phase B workflow (per-set wiring session)

Only start Phase B once Phase A is **completely** done. Otherwise you'll
re-touch cards.

### Step 0 — Pick a set
Reasonable defaults: start with Sets 5 or 9 (mostly fits-grammar, easiest).
Or just go in numerical order.

### Step 1 — List the set's stubs
```
pnpm card-status --set N --category fits-grammar --verbose
```

### Step 2 — Write a batch patch
Create `scripts/implement-setN-batchM.ts` with a `patches` map of
`{ card-id: { abilities: [...] } }` or `{ card-id: { actionEffects: [...] } }`.

Aim for ~20–30 cards per batch. Look at Sets 1/2/3 for ability shape examples.

### Step 3 — Run, test, commit
```
pnpm tsx --tsconfig scripts/tsconfig.scripts.json scripts/implement-setN-batchM.ts
pnpm --filter @lorcana-sim/engine test
git commit -m "cards: set N batch M — wire X cards"
```

### Step 4 — Repeat for the next batch
When the set is fully wired, move to the next set.

## Test file organization

Tests are still split per set, but **only for set-specific bug discovery**:

```
packages/engine/src/engine/
├── reducer.test.ts        — CRD rules (core engine)
├── set1.test.ts           — Set 1 unique patterns
├── set2.test.ts           — Set 2 unique patterns
├── set3.test.ts           — Set 3 unique patterns
├── setN.test.ts           — Add when a set has unique patterns to verify
└── test-helpers.ts        — shared helpers
```

When implementing a mechanic, add tests in the file matching the **first set
the mechanic appeared in**. E.g. Sing Together tests live in `set4.test.ts`
even though sets 5–11 also use it.

## Workflow primitives (unchanged from set-by-set)

### `pnpm card-status`
- `--set N` — single-set summary
- `--category fits-grammar --verbose` — list cards in a category
- `--category needs-new-type --verbose` — see what new types are needed
- Without args — full summary across all sets

### `scripts/implement-cards.ts`
- Scratch file for batch JSON patches. Overwrite each session.
- `patchSet("N", { ... })` block per set.
- Run via `pnpm tsx --tsconfig scripts/tsconfig.scripts.json scripts/implement-cards.ts`.
- Pattern: 30–40 cards per batch.

### Tips
- Look at Set 1 / Set 2 / Set 3 cards with similar text for ability shape examples
- Use existing helpers/types — don't invent new ones in fits-grammar work
- Reference: `LORCAST_CARD_DEFINITIONS` for stat lookups
- Don't worry about every edge case — if it's close enough and uses existing types, ship it

## Anti-patterns to avoid

❌ **Don't try to "finish a set" end-to-end.** Implement the mechanic, then
batch-wire every card across every set that uses it.

❌ **Don't write tests for every card.** One test per new pattern. Patterns
already covered in earlier sets are already covered.

❌ **Don't fake implementations with no-op statics.** If a card needs an
engine feature you haven't built, leave it as a stub or implement the
feature properly. No-ops lie to the tracker.

❌ **Don't skip CRD verification.** Read the actual CRD rule for any
non-trivial mechanic. Cards often have subtle wording that matters
("another", "may", "until the start of your next turn", etc.).

❌ **Don't process triggers inline mid-action.** Use `queueTriggersByEvent`
then let the wrapping `applyAction → processTriggerStack` handle it. Inline
`processTriggerStack` calls interrupt the current effect chain (this was a
real bug we fixed for `cards_discarded`).

❌ **Don't bundle Boost work with other mechanics.** It's the largest
design and deserves its own session.

## Commit cadence

Don't wait until a whole mechanic is done. Commit after each meaningful
checkpoint:

```bash
# After adding the engine type and one card
git commit -m "feat: <mechanic> — engine path + first card"

# After batch-wiring cards
git commit -m "cards: wire <N> cards for <mechanic> across sets <X-Y>"
```
