# HANDOFF.md — open items for non-engine specialists

This file tracks engine-side changes whose downstream work (UI, bot, analytics)
has been deferred. Each entry describes what's in place, what's missing, and
who needs to pick it up.

---

## FROM engine-expert → gameboard-specialist: `cant_action` pill grouping key (follow-up to the Gosalyn double-apply fix)

**Context.** The `ready` + chosen target double-apply bug you reported has been
fixed engine-side (commit forthcoming). Gosalyn's HEROIC INTERVENTION now
produces exactly 2 `cant_action` timedEffects on the target — one for quest,
one for challenge — instead of 4. Regression test added in
`set12.test.ts` (`describe("Set 12 — Gosalyn HEROIC INTERVENTION
followUpEffects single-apply regression", …)`).

**Open UI question you raised.** With the engine now producing 2 entries
(same source, different `action` values), the Active Effects pill's current
grouping key `(type, sourceInstanceId)` collapses both entries into one pill
with stackCount=2. You asked:

> Should `cant_action` timed-effect grouping include the `action` field in
> its key so quest + challenge render as separate pills
> ("can't quest" + "can't challenge"), OR should the grouping dedupe by the
> displayed label (one row, no ×N)?

My read as the engine side: **include `action` in the grouping key for
`cant_action` specifically.** Rationale:

- The two entries are semantically distinct rules — one restricts questing,
  the other restricts challenging. Collapsing them to "×2" loses
  information the player needs (a ×2 pill implies stacking of the same
  restriction, which is wrong — it's two DIFFERENT restrictions).
- This matches how the CRD treats the oracle: "can't quest or challenge"
  is two separate restrictions joined by OR in prose, AND in enforcement.
  Engine-side they're separate TimedEffects for exactly this reason.
- Most `cant_action` cards will surface a single `action` value (e.g. Iago's
  "can't challenge"). Only "ready + follow-ups" cards like Gosalyn produce
  multiples — and in those cases showing both distinct rules is more useful
  than a stack count.

**Implementation hint:** in the pill grouping function, extend the key for
`cant_action` TimedEffects to include `.action`:

```ts
// pseudo — adjust to match your actual grouping shape
const groupKey = (eff: TimedEffect) =>
  eff.type === "cant_action"
    ? `${eff.type}:${eff.sourceInstanceId}:${eff.action}`
    : `${eff.type}:${eff.sourceInstanceId}`;
```

This keeps existing stacking for genuine stackable effects (modify_strength,
grant_keyword ×2, etc.) while separating the quest/challenge pair into two
clearly-labeled pills. No engine changes needed.

---

(no other open items)
