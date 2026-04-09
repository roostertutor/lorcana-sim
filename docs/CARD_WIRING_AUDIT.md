# Card Wiring Audit — Approximations

All 2652/2652 cards are wired (100%). This file tracks the small set of cards whose engine wiring uses an **approximation** of the strict CRD interpretation. Each entry explains what was simplified, why, and what fidelity gap (if any) it leaves.

When revisiting, the question to ask each entry is: *"would full fidelity meaningfully change deck simulation outcomes?"* If yes, lift the approximation. If no, leave it documented and move on.

| # | Card | Set | Approximation | Why | Audit notes |
|---|---|---|---|---|---|
| ~~1~~ | ~~Moana — Kakamora Leader~~ | ~~6~~ | **RESOLVED**: new `move_character.character: { type: "all"; filter }` variant. Bot heuristic moves every matching own character to the chosen location and records the count on `state.lastEffectResult`; the follow-up `gain_lore amount: cost_result` pays per move. Same audit pass also lifted the "Healing Glow" / set-8 healing-and-debuff song approximations (single-target → all own damaged chars via `target: "all"` + `hasDamage: true`). | — | — |
| ~~2~~ | ~~Kristoff's Lute — MOMENT OF INSPIRATION~~ | ~~11~~ | **RESOLVED** in commit after 68cd5c1: bot now pays normal cost (deducts ink and only plays if affordable; declines → discard). Mirrors The Black Cauldron's `cost: "normal"` precedent. | — | — |
| ~~3~~ | ~~Ariel — Curious Traveler~~ | ~~P3~~ | **RESOLVED**: new `Effect.must_quest_if_able` adds a per-character `TimedEffect` (mirrors `cant_action`'s shape) and the validator's pass-turn check now refuses the pass if any own ready character with the obligation has a valid quest target (parallel to the existing Reckless "must challenge if able" check). Also fixes Gaston Frightful Bully (set 10), which had the same wording. Rapunzel Ethereal Protector turned out to be a non-issue — its actual rules text only says `can't challenge`, no must-quest clause. | — | — |
| ~~4~~ | ~~Jafar — High Sultan of Lorcana~~ | ~~8 / P2~~ | **RESOLVED**: new `target: { type: "from_last_discarded" }` CardTarget on play_for_free reads `state.lastDiscarded[0]` and plays the EXACT discarded instance. No more filter widening. | — | — |
| ~~5~~ | ~~Tuk Tuk — Lively Partner~~ | ~~4~~ | **RESOLVED**: new `move_character.location: { type: "last_resolved_target" }` variant. The first move (chosen char + chosen location) sets `state.lastResolvedTarget` to the location at stage-2 resolution; the second move (this) reads it. Both moves now land on the SAME location. | — | — |
| ~~6~~ | ~~Anna — Soothing Sister UNUSUAL TRANSFORMATION~~ | ~~11~~ | **RESOLVED — matches Pudge / LeFou precedent**: the wiring is a `self_cost_reduction` static gated by a `compound_and(card_left_discard_this_turn, has_character_named:Anna self)` condition. This is the canonical CRD 6.4.4 conditional-static-ability pattern (the "If [condition], [effect]" form), used by Pudge - Controls the Weather ("If you have Lilo, play for free", `amount: 2`) and LeFou - Bumbler ("If Gaston in play, costs 1 less", `amount: 1`). Anna's text uses "Shift 0" as the *flavor* but the mechanical effect is the same — pay 0 to play the card. | — | **Residual fidelity gap (non-blocker)**: strict Shift would also put the previous Anna under the new one (cards-under inheritance and the existing Anna's exerted/damage state transferring). Our wiring plays a fresh Anna without consuming the existing one, so you can have two Annas in play instead of one Anna with another under it. For deck win-rate analytics the lore math is identical; for tracking cards-under counts or damage carryover it diverges by one card. Lifting this would need granted-Shift-from-hand infrastructure (validator + applyPlayCard plumbing). |

## Adding new entries

Future card wirings that take a shortcut should be appended here in the same format. Don't bury approximations in commit messages alone — they get lost.

## When this file becomes empty

If every approximation is lifted, delete this file. The approximation audit task in the task system tracks closure progress.
