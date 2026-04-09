# Card Wiring Audit — Approximations

All 2652/2652 cards are wired (100%). This file tracks the small set of cards whose engine wiring uses an **approximation** of the strict CRD interpretation. Each entry explains what was simplified, why, and what fidelity gap (if any) it leaves.

When revisiting, the question to ask each entry is: *"would full fidelity meaningfully change deck simulation outcomes?"* If yes, lift the approximation. If no, leave it documented and move on.

| # | Card | Set | Approximation | Why | Audit notes |
|---|---|---|---|---|---|
| ~~1~~ | ~~Moana — Kakamora Leader~~ | ~~6~~ | **RESOLVED**: new `move_character.character: { type: "all"; filter }` variant. Bot heuristic moves every matching own character to the chosen location and records the count on `state.lastEffectResult`; the follow-up `gain_lore amount: cost_result` pays per move. Same audit pass also lifted the "Healing Glow" / set-8 healing-and-debuff song approximations (single-target → all own damaged chars via `target: "all"` + `hasDamage: true`). | — | — |
| ~~2~~ | ~~Kristoff's Lute — MOMENT OF INSPIRATION~~ | ~~11~~ | **RESOLVED** in commit after 68cd5c1: bot now pays normal cost (deducts ink and only plays if affordable; declines → discard). Mirrors The Black Cauldron's `cost: "normal"` precedent. | — | — |
| 3 | Ariel — Curious Traveler | P3 | Drops the "must quest if able" clause; only `cant_action: challenge` is wired | Matches the Gaston Frightful Bully (set 10) and Rapunzel Ethereal Protector (set 11) precedent. | "Must quest if able" needs a per-target action requirement enforced by the validator. Three cards waiting on this primitive. |
| ~~4~~ | ~~Jafar — High Sultan of Lorcana~~ | ~~8 / P2~~ | **RESOLVED**: new `target: { type: "from_last_discarded" }` CardTarget on play_for_free reads `state.lastDiscarded[0]` and plays the EXACT discarded instance. No more filter widening. | — | — |
| ~~5~~ | ~~Tuk Tuk — Lively Partner~~ | ~~4~~ | **RESOLVED**: new `move_character.location: { type: "last_resolved_target" }` variant. The first move (chosen char + chosen location) sets `state.lastResolvedTarget` to the location at stage-2 resolution; the second move (this) reads it. Both moves now land on the SAME location. | — | — |
| 6 | Anna — Soothing Sister UNUSUAL TRANSFORMATION | 11 | "this card gains Shift 0" → `self_cost_reduction` amount 5 from hand, gated on `card_left_discard_this_turn` AND `has_character_named:Anna self` | Engine's Shift path reads `def.shiftCost` directly; granting Shift via a static would require new validator + applyPlayCard plumbing. | Equivalent free-play *cost* in practice, but the cost-reduction approximation does **not** perform the cards-under transfer that real Shift would. For deck win-rate analytics this matches; for tracking carryover damage / cards-under interactions it doesn't. |

## Adding new entries

Future card wirings that take a shortcut should be appended here in the same format. Don't bury approximations in commit messages alone — they get lost.

## When this file becomes empty

If every approximation is lifted, delete this file. The approximation audit task in the task system tracks closure progress.
