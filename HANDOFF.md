# HANDOFF.md — open items for non-engine specialists

This file tracks engine-side changes whose downstream work (UI, bot, analytics)
has been deferred. Each entry describes what's in place, what's missing, and
who needs to pick it up.

---

## FROM gameboard-specialist → engine-expert: `ready` + chosen target double-applies followUpEffects

**Bug**: Gosalyn Mallard - The Quiverwing Quack (set 12 #1) HEROIC INTERVENTION
produces 4 `cant_action` timed effects on the readied target instead of 2.
UI Active Effects pill shows "×4" because its grouping key
`(type, sourceInstanceId)` collapses the 4 entries (2× quest, 2× challenge,
all from Gosalyn) into one pill. Label is correct — just the stackCount is
wrong at the engine level.

**Repro**: play Gosalyn → HEROIC INTERVENTION fires → say "yes" to isMay →
pick any cost-≤2 character → inspect that character's `timedEffects`. You
see 4 entries, not 2.

**Root cause** (reducer.ts):

1. `case "ready"` in `applyEffect` (≈ line 3875-3887) sets up choose_target
   with BOTH `pendingEffect: effect` (which carries `effect.followUpEffects`)
   AND `followUpEffects: effect.followUpEffects` (copied out onto the
   pendingChoice).
2. RESOLVE_CHOICE for choose_target (line 2562) calls
   `applyEffectToTarget(pendingEffect, targetId, …)`.
3. `case "ready"` in `applyEffectToTarget` (line 7459-7463) reads
   `effect.followUpEffects` and applies each to the target → 2 timed
   effects added.
4. The resolve loop at line 2564-2568 then iterates
   `pendingChoice.followUpEffects` (the same array) and applies them AGAIN
   to the same target → 2 more timed effects added.

Result: 4 entries instead of 2.

**Same pattern likely affects other self-applying handlers**: `cant_action`
(line 7480-7484), and anything else that reads `effect.followUpEffects` in
`applyEffectToTarget` while its `applyEffect` "chosen" branch also stores
them on `pendingChoice.followUpEffects`. Worth a grep for
`effect.followUpEffects` inside `applyEffectToTarget` cases against
`pendingChoice: { … followUpEffects: effect.followUpEffects }` call sites in
`applyEffect`.

**Two candidate fixes**:

A. **Drop `followUpEffects` from the pendingChoice** in `applyEffect`'s
   "chosen" branches (line 3886 and equivalents). The inner `applyEffectToTarget`
   already handles them via `effect.followUpEffects` on the carried
   pendingEffect. Outer loop at 2564 becomes a no-op.
   Risk: other effect types may depend on the outer loop running followUps
   (i.e. effects that don't self-handle in `applyEffectToTarget`). Audit
   each effect-type branch in `applyEffectToTarget` for followUpEffects
   processing before pulling them from pendingChoice wholesale.

B. **Remove followUpEffects handling from `applyEffectToTarget` self-handlers**
   (lines 7459-7463 for ready, 7480-7484 for cant_action). Let the outer
   resolve loop be the single source of followUp application.
   Risk: `applyEffectToTarget` is also called directly (not via
   pendingChoice) in some paths — those would lose followUps. Check the
   non-choose-target callers of this function for each affected effect
   type. E.g. the `ready` case at line 3942-3946 (`last_resolved_target`
   branch in `applyEffect`) calls `applyEffectToTarget` directly — without
   the outer resolve loop.

Fix B probably safer after audit since direct callers of `applyEffectToTarget`
are rarer than choose_target pathways.

**Regression test** to add (per the "bug-fix workflow" memory):

```ts
test("ready + chosen target applies followUpEffects exactly once", () => {
  // Play Gosalyn, pick a target, assert target.timedEffects.length === 2
  // and one cant_action per action value (quest, challenge), not two each.
});
```

**Downstream UI note**: after the engine fix, Gosalyn will show "×2" on the
pill (one entry per action value, same source). That's still slightly
misleading — oracle text reads "can't quest or challenge" as one rule.
Open question for UI: should `cant_action` timed-effect grouping include
the `action` field in its key so quest + challenge render as separate pills
("can't quest" + "can't challenge"), OR should the grouping dedupe by the
displayed label (one row, no ×N)? Decide after engine fix lands.

**Reported from**: Sandbox/installed PWA, testing set 12 early-reveal card.
Filed 2026-04-23.
