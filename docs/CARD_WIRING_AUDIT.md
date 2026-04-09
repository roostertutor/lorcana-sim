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
| ~~6~~ | ~~Anna — Soothing Sister UNUSUAL TRANSFORMATION~~ | ~~11~~ | **RESOLVED**: new `GrantShiftSelfStatic` (`grant_shift_self { value: number }`). Conditional static with `activeZones: ["hand"]` that adds a granted Shift cost to the in-hand instance via `gameModifiers.grantedShiftSelf: Map<instanceId, number>`. The validator's PLAY_CARD shift branch now reads `def.shiftCost ?? mods.grantedShiftSelf.get(instanceId)` and the legal-action enumerator surfaces shift target variants alongside the normal play. The Shift mechanic itself (cards-under placement / inheritance) flows through the existing CRD 8.10.4 path. | — | — |
| ~~7~~ | ~~Pudge — Controls the Weather GOOD FRIEND~~ | ~~11~~ | **RESOLVED**: new `GrantPlayForFreeSelfStatic` (`grant_play_for_free_self`). Conditional static with `activeZones: ["hand"]` that flags the in-hand instance in `gameModifiers.playForFreeSelf: Set<instanceId>`. The legal-action enumerator surfaces a `PLAY_CARD` variant with `viaGrantedFreePlay: true` alongside the normal-cost play, so the player can choose either. The validator skips ink deduction for that variant; `applyPlayCard` logs the free play. Same shape family as Stone By Day's `cant_action_self` static — both are conditional statics with action-validation hooks, just opposite directions (restriction vs grant). | — | — |

## Adding new entries

Future card wirings that take a shortcut should be appended here in the same format. Don't bury approximations in commit messages alone — they get lost.

## When this file becomes empty

If every approximation is lifted, delete this file. The approximation audit task in the task system tracks closure progress.
