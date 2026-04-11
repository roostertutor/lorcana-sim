# CRD TRACKER
# Disney Lorcana Comprehensive Rules v2.0.1 (Effective Feb 5, 2026)
# Maps every mechanically relevant rule to engine implementation + test status.
#
# Legend:
#   ✅  Implemented and tested
#   ⚠️  Implemented, not tested
#   ❌  Not implemented
#   🐛  Implemented incorrectly (bug)
#   N/A Not applicable to a headless digital engine (physical rules, UI, etc.)

---

## 1. CONCEPTS

### 1.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 1.1.1 | Two or more players | ⚠️ Only 2-player supported |
| 1.1.7 | Reminder text in italics isn't rules text | N/A |

### 1.2 Golden Rules
| Rule | Quote | Status |
|------|-------|--------|
| 1.2.1 | Card text supersedes game rules | ⚠️ Architecture exists (`gameModifiers.ts`) but not all override mechanisms built yet |
| 1.2.2 | Preventing effects supersede allowing effects | ✅ `isActionRestricted` checked before grants in all validator paths. "Can't X" blocks even if a grant says "can X." |
| 1.2.3 | Do as much as possible ("do as much as you can") | ✅ Engine behavior is correct: effects no-op when no valid targets, actions remain legal. Examples: Dragon Fire on empty board, Sudden Chill with one opposing character, The Queen's "each opponent" with one opponent. No formal tracking needed — silent no-op IS the correct behavior |

### 1.5 Costs
| Rule | Quote | Status |
|------|-------|--------|
| 1.5.3 | Cost must be paid in full; can't play if unable | ✅ Validated in `validatePlayCard` / `validateActivateAbility` |
| 1.5.5 | Alternate costs (Shift, Singer, Sing Together, "for free") | ✅ Shift (ink + altShiftCost discard), Singer, Sing Together all implemented. ❌ "For free" (1.5.5.3) not fully modeled. |
| 1.5.5.1 | Singing a song is an alternate cost | ✅ `singerInstanceId` skips ink deduction |
| 1.5.5.2 | Shift is an alternate cost | ✅ |
| 1.5.5.3 | "For free" means ignore all costs | ✅ `play_for_free` effect + `grant_play_for_free_self` static with optional `playCosts`. |

### 1.6 Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 1.6.1 | Abilities apply only when source is in play (with exceptions) | ✅ Trigger fizzle logic in `processTriggerStack`. Exceptions (fire after leaving play): `is_banished`, `leaves_play`, `banished_in_challenge`, `banished_other_in_challenge` (per 4.6.6.2 — simultaneous damage means attacker banished another even if also banished), `is_challenged`, `challenges`. |
| 1.6.1.1 | Triggered abilities | ✅ |
| 1.6.1.2 | Activated abilities | ✅ |
| 1.6.1.3 | Static abilities | ✅ 14 static types: grant_keyword (with value), modify_stat, modify_stat_per_count, modify_stat_per_damage, modify_stat_while_challenged, cant_be_challenged, cost_reduction, action_restriction, extra_ink_play, self_cost_reduction, can_challenge_ready, damage_redirect, grant_activated_ability, challenge_damage_immunity. Conditional statics via `condition` on StaticAbility. Still missing for later sets: modify_win_threshold, ink_from_zone, enter_play_exerted_static, grant_classification, stat_floor, prevent_lore_loss. See CARD_ISSUES.md. |
| 1.6.1.4 | Replacement effects | ⚠️ Damage redirect (CRD 6.5) implemented for Beast - Selfless Protector. General replacement effect system not built. |
| 1.6.1.5 | Keywords | ✅ Most set 1 keywords implemented |

### 1.7 Game Actions, Timing, and Illegal Actions
| Rule | Quote | Status |
|------|-------|--------|
| 1.7.2 | Effects must fully resolve before next can happen | ✅ Each effect fully resolves (or surfaces pendingChoice) before next. Challenge damage is simultaneous per CRD 4.6.6.2. Trigger bag processes one at a time. |
| 1.7.5 | **Drying**: characters can't quest/challenge/exert unless in play since beginning of their player's turn | ✅ `isDrying` boolean; Rush bypasses for challenges only |
| 1.7.6 | Illegal action: undo all steps, payments reversed | ⚠️ We return `success: false` and don't mutate state, but don't log "undo". Open question: would undo help bot learning? See DECISIONS.md Open Questions |

### 1.8 Game State Check
| Rule | Quote | Status |
|------|-------|--------|
| 1.8.1.1 | Player with 20+ lore wins | ✅ `checkWinConditions` / `getLoreThreshold`. Win threshold modification implemented via `modify_win_threshold` StaticEffect (Donald Duck Flustered Sorcerer). |
| 1.8.1.2 | Player who ends turn with empty deck loses | ✅ Checked in `applyPassTurn`; game ends immediately with opponent as winner |
| 1.8.1.4 | Character/location with damage >= willpower is banished | ✅ `banishCard` called from damage resolution |
| 1.8.2 | Triggered abilities from state check added to bag before resolving | ✅ `evaluateCondition()` checks `trigger.ability.condition` before resolving effects in `processTriggerStack()`. Supports `characters_in_play_gte`, `cards_in_hand_eq`, lore conditions. Tested with Stitch - Carefree Surfer, Beast's Mirror |

### 1.9 Damage
| Rule | Quote | Status |
|------|-------|--------|
| 1.9.1 | Damage represented by damage counters; each counter = 1 damage; can be dealt/put/removed/moved/taken | ✅ Damage counters tracked on `CardInstance` as `damage: number` |
| 1.9.1.1 | Deal/Dealt – placing damage counters during a challenge or from an effect that deals damage | ✅ `deal_damage` effect + challenge damage in reducer |
| 1.9.1.2 | Put – placing damage counters from an effect that puts damage on a character/location | ❌ No distinction between "deal" and "put" damage (both use `deal_damage`) |
| 1.9.1.3 | Remove/Removed – taking damage counters off as a result of an effect that removes damage | ✅ `remove_damage` effect (being renamed from "heal" to match CRD terminology) |
| 1.9.1.4 | Move – taking damage counters off one character/location and placing on another | ✅ `move_damage` effect with `from`/`to` CardTargets. 29 uses across sets. |
| 1.9.1.5 | Take – a character/location takes damage whenever damage is dealt to, put on, or moved to it | ⚠️ Implicit — any damage placement triggers "takes damage" but no explicit tracking |
| 1.9.2 | "Is damaged" / "was damaged" / "is dealt damage" / "was dealt damage" all mean "takes damage" for printed text | ⚠️ `hasDamage` filter exists but "was damaged" / "is dealt damage" event tracking not distinct |
| 1.9.3 | When a character/location with damage leaves play, all damage counters cease to exist | ✅ Damage cleared when card leaves play (`moveCard` resets card state) |

### 1.11 Lore
| Rule | Quote | Status |
|------|-------|--------|
| 1.11.1 | Player starts at 0 lore; can't go below 0 | ✅ `gainLore` enforces (no negative lore) |
| 1.11.2 | Quest character gains lore equal to its {L}; no lore if {L} = 0 | ✅ `getEffectiveLore` |
| 1.11.3 | 20+ lore wins | ✅ |

### 1.12 Drawing
| Rule | Quote | Status |
|------|-------|--------|
| 1.12.1 | Draw: top card of deck to hand | ✅ `applyDraw` |
| 1.12.2 | Cards drawn one at a time | ✅ Loop in `applyDraw` |
| 1.12.3 | "Put into hand" is not "drawing" | ⚠️ `return_to_hand` effect exists and is separate from `draw`. Missing: "put into hand from deck" without triggering draw abilities. Example: Mother Knows Best (return card from discard to hand ≠ draw) |

---

## 2. GAMEPLAY

### 2.2 Setup Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.2.1.3 | Each player begins with 0 lore | ✅ `createGame` initializer |
| 2.2.1.4 | Each player draws 7 cards (opening hand) | ✅ Tested: "deals 7 cards to each player" |
| 2.2.2 | Players may alter their opening hand (mulligan) | ✅ Partial Paris mulligan in simulator. Generic `shouldMulligan`/`performMulligan` on BotStrategy. |

### 2.3 In-Game Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.3.3.1 | Win at 20+ lore | ✅ |
| 2.3.3.2 | Lose when turn ends with empty deck | ✅ |
| 2.3.3.4 | Concede at any time | N/A Bots play to completion; concession has no analytical value |

---

## 3. TURN STRUCTURE

### 3.2 Start-of-Turn Phase

#### 3.2.1 Ready step
| Rule | Quote | Status |
|------|-------|--------|
| 3.2.1.1 | Active player readies all cards **in play and in inkwell** | ✅ Both play and inkwell cards readied |
| 3.2.1.2 | "During your turn" effects start applying | ❌ No duration tracking for "during your turn" static effects |
| 3.2.1.3 | "Start of your turn" / "start of your next turn" effects end | ❌ Not implemented (no set 1 cards) |
| 3.2.1.4 | "At the start of your turn" triggered abilities added to bag | ✅ `queueTriggersByEvent("turn_start", opponent, ...)` fires in `applyPassTurn` after readying. Tested with Donald Duck Perfect Gentleman, Christopher Robin (via `readied` trigger). |

#### 3.2.2 Set step
| Rule | Quote | Status |
|------|-------|--------|
| 3.2.2.1 | Active player's characters are no longer drying; can quest/challenge/{E} | ✅ `isDrying` cleared on turn start |
| 3.2.2.2 | Active player gains lore from locations with {L} | ✅ Set step lore gain in `applyPassTurn` after readying. Tested in set3.test.ts. |
| 3.2.2.3 | Resolve triggered abilities from Ready + Set steps | ✅ processTriggerStack called after Ready+Set and before turn_start triggers |

#### 3.2.3 Draw step
| Rule | Quote | Status |
|------|-------|--------|
| 3.2.3.1 | Active player draws a card | ✅ Tested: "draws a card for the new active player at turn start" |
| 3.2.3.1 | **Starting player skips draw on first turn of the game** | ✅ Implicit: `createGame` deals opening hands only; first draw happens in `applyPassTurn` when transitioning to next player |

### 3.3 Main Phase
| Rule | Quote | Status |
|------|-------|--------|
| 3.3.1 | Player can perform turn actions in section 4 | ✅ All main phase actions implemented |
| 3.3.2 | Player can declare end of turn at any time during Main Phase | ✅ `PASS_TURN` action |
| 3.3.2.1 | Can't end turn if currently in a turn action or bag has abilities waiting | ⚠️ Bag must be empty (pendingChoice blocks), but partial turn action check not enforced |

### 3.4 End-of-Turn Phase
| Rule | Quote | Status |
|------|-------|--------|
| 3.4.1.1 | "At the end of the turn" / "at the end of your turn" triggered abilities added and resolved | ✅ `queueTriggersByEvent("turn_end", ...)` fires in applyPassTurn. Floating triggers also checked on turn_end. |
| 3.4.1.2 | Effects that end "this turn" end (Support, temp stat boosts, etc.) | ✅ `tempStrengthModifier`, `tempWillpowerModifier`, `tempLoreModifier`, `grantedKeywords` all cleared |
| 3.4.2 | Final game state check at turn end | ⚠️ `applyWinCheck` runs after every action, but a final explicit check at end-of-turn is not separately called |

---

## 4. TURN ACTIONS

### 4.2 Ink a Card
| Rule | Quote | Status |
|------|-------|--------|
| 4.2.1 | Declare intent, reveal inkable card, put into inkwell ready | ✅ `PLAY_INK` action |
| 4.2.3 | Limited to once per turn | ✅ `inkPlaysThisTurn` counter (replaced boolean to support extra ink plays) |
| 4.2.3.1 | Effects can allow additional cards into inkwell (Belle – Strange But Special) | ✅ `ExtraInkPlayStatic` + `extraInkPlaysGranted` + `inkPlaysThisTurn` counter. Belle supported. |
| 4.2.3.2 | Some effects put cards into inkwell bypassing once-per-turn rule (Fishbone Quill) | ❌ Not implemented. Will use separate action path, not PLAY_INK |

### 4.3 Play a Card
| Rule | Quote | Status |
|------|-------|--------|
| 4.3.1 | Play card from hand, announce and pay cost | ✅ |
| 4.3.2 | Can normally be played only from hand | ✅ Validated. Mufasa exception will use effect system |
| 4.3.3.1 | Characters/items/locations enter Play zone; Shift goes on top of named card | ✅ Characters, items, and locations all enter play zone. Shift implemented with cardsUnder stack. |
| 4.3.3.2 | Actions enter Play zone, effect resolves immediately, then move to discard | ✅ `applyPlayCard` action branch; `pendingActionInstanceId` for deferred choices |
| 4.3.4.1 | "When [Player] play(s) this" triggered conditions met as card enters play | ✅ `queueTrigger("enters_play", ...)` |
| 4.3.5 | Payment modifiers (e.g., Singer) don't change the card's ink cost | ✅ Singer implemented; `singerInstanceId` path |

### 4.4 Use an Activated Ability
| Rule | Quote | Status |
|------|-------|--------|
| 4.4.1 | Activated ability: cost → effect | ✅ |
| 4.4.2 | {E} ability on a character requires character to be dry | ✅ `isDrying` check in `validateActivateAbility` (characters only; CRD 6.3.1.2 items exempt) |
| 4.4.2 | Items and locations: activated ability can be used turn played | ✅ Items and locations can use activated abilities the turn they're played (no drying for non-characters). |

### 4.5 Quest
| Rule | Quote | Status |
|------|-------|--------|
| 4.5.1.1 | Declare questing character | ✅ |
| 4.5.1.2 | Check restrictions (not dry, Reckless, etc.) | ✅ isDrying + Reckless both checked in validateQuest |
| 4.5.1.3 | Exert questing character | ✅ |
| 4.5.1.4 | Gain lore equal to character's {L} | ✅ |
| 4.5.3.1 | If character has negative lore, player gains 0 lore | ✅ `getEffectiveLore` uses `Math.max(0, ...)` |

### 4.6 Challenge
| Rule | Quote | Status |
|------|-------|--------|
| 4.6.4.1 | Challenging character must have been in play since beginning of Set step and be ready | ✅ `isDrying` + `isExerted` checks; Rush bypasses `isDrying` |
| 4.6.4.2 | Choose an **exerted** opposing character to challenge | ✅ `defender.isExerted` check (added this session) |
| 4.6.4.3 | Check challenging restrictions (Evasive, Bodyguard) | ✅ Evasive + Bodyguard checked |
| 4.6.4.4 | Exert the challenging character | ✅ |
| 4.6.5 | "challenges" / "is challenged" triggered abilities added to bag | ✅ `queueTrigger("challenges", ...)` and `queueTrigger("is_challenged", ...)` |
| 4.6.6.1 | Calculate damage: apply {S} increases/decreases first, then damage modifiers | ✅ `getEffectiveStrength` + Challenger bonus + Resist |
| 4.6.6.2 | Damage dealt simultaneously | ✅ Both characters take damage before banish check. Implication: "banishes another in a challenge" triggers (`banished_other_in_challenge`) fire even when the attacker is also banished — see 1.6.1 exceptions. |
| 4.6.6.3 | Game state check after challenge damage | ✅ `applyWinCheck` runs after action |
| 4.6.8 | Characters can challenge **locations** | ✅ `validateChallenge` allows location defenders. Bodyguard/Evasive bypassed for locations. |
| 4.6.8.2 | Locations aren't ready/exerted; can be challenged at any time | ✅ Exerted check bypassed for location defenders. |
| 4.6.8.3 | Locations have no {S}; deal no damage to challenger | ✅ Symmetric damage math (location STR=0 → 0 attacker damage). Challenger +N guarded to character defenders only. |

### 4.7 Move a Character
| Rule | Quote | Status |
|------|-------|--------|
| 4.7 | Move a character to a location (entire section) | ✅ `MOVE_CHARACTER` action. `applyMoveCharacter` deducts ink, sets `atLocationInstanceId`, marks `movedThisTurn`, fires `moves_to_location` trigger. |

---

## 5. CARDS AND CARD TYPES

### 5.1 Card States
| Rule | Quote | Status |
|------|-------|--------|
| 5.1.1.1 | Ready state | ✅ `isExerted = false` |
| 5.1.1.2 | Exerted state; can still use non-{E} abilities | ✅ |
| 5.1.1.3–4 | Damaged / undamaged | ✅ `damage > 0` |
| 5.1.1.5–7 | Under / on top / in a stack (Shift stacks) | ✅ `cardsUnder: string[]` models the stack. Top card is in play; under-cards have `zone: "under"`. CRD 8.10.7: stack leaves play together to same zone. |
| 5.1.1.8 | In Play: faceup in Play zone with no cards on top | ✅ `zone === "play"` |
| 5.1.1.11 | **Drying**: entered play this turn; can't quest/challenge/exert | ✅ `isDrying: true` on play; validator enforces restrictions |
| 5.1.1.12 | **Dry**: been in play since start of their player's turn; can quest/challenge/exert | ✅ `isDrying: false` after turn start |
| 5.1.2.1 | Characters enter play ready, undamaged, faceup, **drying** | ✅ `isDrying: true`; Rush bypasses for challenges only |

### 5.2 Parts of a Card
| Rule | Quote | Status |
|------|-------|--------|
| 5.2.5.1 | Some cards have more than one ink type; count as each ink type | ✅ `inkColors: InkColor[]` on CardDefinition; filter uses array intersection |
| 5.2.8 | Rules Text — abilities, effects, and rules text in text box; story name used for referencing | ✅ `storyName` field on TriggeredAbility, ActivatedAbility, StaticAbility |

### 5.3 Characters
| Rule | Quote | Status |
|------|-------|--------|
| 5.3.4 | Only characters can quest or challenge | ✅ `def.cardType !== "character"` checks |
| 5.3.5 | Character must have been in play at beginning of Set step to quest/challenge/{E} | ✅ `isDrying` check in validator |

### 5.4 Actions
| Rule | Quote | Status |
|------|-------|--------|
| 5.4.1.2 | Actions played from hand; effect resolves immediately; moved to discard | ✅ `applyPlayCard` action branch; action effects resolve inline, not through trigger stack |
| 5.4.3 | Actions have effects, not abilities | ✅ `actionEffects` field on `CardDefinition` |
| 5.4.4.1 | Songs have "Action" and "Song" on classification line | ✅ `isSong()` checks `cardType === "action" && traits.includes("Song")` |
| 5.4.4.2 | Songs: alternate cost = exert character with ink cost ≥ song cost | ✅ `singerInstanceId` on `PlayCardAction`; validated in `validatePlayCard` |

### 5.5 Items
| Rule | Quote | Status |
|------|-------|--------|
| 5.5.4 | Item activated ability can be used turn played | ✅ Tested (Eye of Fates) |

### 5.6 Locations (first appears Set 3, ~87 location cards across sets 3–11)
| Rule | Quote | Status |
|------|-------|--------|
| 5.6.1 | Locations are a card type that enter the Play zone; have willpower and optional lore value | ✅ `applyPlayCard` else-branch handles locations (no drying). `CardDefinition.moveCost` field added. |
| 5.6.2 | Locations gain lore for their controller at the Start-of-turn Set step | ✅ Set step lore gain in `applyPassTurn` (CRD 3.2.2.2). |
| 5.6.3 | Characters can be moved to a location (CRD 4.7 Move action) | ✅ `MOVE_CHARACTER` action + `validateMoveCharacter`. `movedThisTurn` flag prevents double-move. |
| 5.6.4 | Characters at a location: "while here" static/triggered abilities | ✅ `CardFilter.atLocation: "this" \| "any"` + `Condition.this_at_location`. `matchesFilter` accepts optional `sourceInstanceId` for "this" mode. |
| 5.6.5 | Locations can be challenged; have 0 {S}; deal no damage back | ✅ See 4.6.8. Bodyguard/Evasive bypassed. |
| 5.6.6 | Locations are banished when damage ≥ willpower (same rule as characters) | ✅ Reuses `dealDamageToCard`/`banishCard`. On location banish, all characters with `atLocationInstanceId === locId` are cleaned up. |

---

## 6. ABILITIES, EFFECTS, AND RESOLVING

### 6.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 6.1.1 | Abilities apply when source is in play | ✅ |
| 6.1.3 | Choices made as effect resolves | ✅ `pendingChoice` / `RESOLVE_CHOICE` |
| 6.1.3a | Dynamic effect amounts (equal to a stat, count, or cost) | ✅ `DynamicAmount` union supports target_lore, target_strength, target_damage, source_strength, count, last_damage_dealt, unique_ink_types_on_top_of_both_decks, and more. 13 variants in reducer. |
| 6.1.4 | "May" = optional; choosing not to has no effect | ✅ `isMay` flag on effects; `choose_may` PendingChoice; accept/decline flow in processTriggerStack |
| 6.1.5.1 | Sequential effects: [A] to [B] — cost must resolve before reward | ✅ `SequentialEffect` with `costEffects[]` → `rewardEffects[]`; `canPerformCostEffect()` pre-check. `triggeringCardInstanceId` must be forwarded through `applyEffect` and stored on `choose_may` PendingChoice — see CLAUDE.md critical bug patterns |
| 6.1.7 | "For free" = ignore all costs | ✅ Same as 1.5.5.3. |
| 6.1.8 | "For each" — defines single number used in subsequent effect | ✅ `lastEffectResult` on GameState; `amount: "cost_result"` on DrawEffect |
| 6.1.12 | Some abilities apply outside play zone (from hand) | ✅ `SelfCostReductionStatic` checked at play time from hand |
| 6.1.13 | Duration mechanics: "this turn", "end of turn", etc. | ✅ `timedEffects[]` with `expiresAt: end_of_turn / rest_of_turn / end_of_owner_next_turn`. Expiry in applyPassTurn. "Once per turn" supported via `oncePerTurn?: boolean` flag on TriggeredAbility + ActivatedAbility, tracked via `oncePerTurnTriggered` map on CardInstance. "Once during your turn" = `oncePerTurn` + `condition: { type: "is_your_turn" }`. |

### 6.2 Triggered Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.2.1 | Trigger fires once per condition met | ✅ |
| 6.2.3 | Triggered abilities go to bag (our: `triggerStack`) | ✅ |
| 6.2.4 | Secondary "if" condition checked when effect resolves (not when triggered) | ✅ `evaluateCondition()` called in processTriggerStack before resolving effects. 20+ condition types supported including: self_stat_gte, compound_and, songs/actions_played_this_turn_gte, this_has_no_damage, not, played_via_shift, triggering_card_played_via_shift, cards_in_zone_gte (with cardType filter), has_character_with_trait (with excludeSelf). See CARD_ISSUES.md. |
| 6.2.7.1 | Floating triggered abilities (created by resolving effects; last a duration) | ✅ `floatingTriggers[]` on GameState. `CreateFloatingTriggerEffect` creates them; cleared at end of turn. Checked during event dispatch. |
| 6.2.7.2 | Delayed triggered abilities (fire at a specific later moment) | ❌ |

### 6.3 Activated Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.3.1.1 | {E} ability on character requires dry character | ✅ |
| 6.3.1.2 | Item/location activated ability usable turn played | ✅ |

### 6.4 Static Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.4.1 | Active while card in play | ✅ `getGameModifiers()` scans in-play cards |
| 6.4.2.1 | Continuous static from resolved effect affects all matching cards | ❌ |
| 6.4.2.2 | Applied static from resolved effect affects only cards in play at resolution time | ❌ |
| 6.4.2.3 | Continuous static from card in play loses effect when card leaves play | ✅ `getGameModifiers()` recalculates on every call |
| 6.4.3 | Conditional static abilities — apply only when condition met | ✅ `condition` field on StaticAbility; `evaluateCondition()` called in gameModifiers.ts before applying |

### 6.5 Replacement Effects
| Rule | Quote | Status |
|------|-------|--------|
| 6.5 | Replacement effects (entire section) | ⚠️ Partial. `damage_redirect` static implemented for Beast - Selfless Protector (CRD 6.5: "would be dealt damage... instead"). General replacement effect system not built — current implementation is damage-redirect-specific. |

### 6.6 Ability Modifiers
| Rule | Quote | Status |
|------|-------|--------|
| 6.6.1 | Ability modifiers restrict actions for a duration or while source in play | ✅ Unified query `isActionRestricted()` checks both `TimedEffect` (per-card debuffs) and `ActionRestrictionStatic` (board-level rules). `RestrictedAction` type covers quest/challenge/ready/play/sing. |
| 6.6.2 | Negative {S} deals no damage during challenges; counts as having Strength of 0 | ✅ `Math.max(0, ...)` in `getEffectiveStrength` |
| 6.6.3 | Negative Lore value {L} counts as having Lore value of 0 | ✅ `Math.max(0, ...)` in `getEffectiveLore` |

---

## 7. ZONES

### 7.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 7.1.5 | Card exists in only one zone at a time | ✅ Layer 3 invariant test |
| 7.1.6 | When card leaves play, gained effects/damage removed; becomes "new" card | ✅ `zoneTransition` reset block clears: damage, isExerted, isDrying, temp stat modifiers, grantedKeywords, timedEffects, atLocationInstanceId, movedThisTurn, oncePerTurnTriggered, playedViaShift, challengedThisTurn. |

### 7.4 Play
| Rule | Quote | Status |
|------|-------|--------|
| 7.4.1 | Characters/items/locations can be in Play zone | ✅ All three card types can be in play zone. |

### 7.7 Bag
| Rule | Quote | Status |
|------|-------|--------|
| 7.7 | Triggered abilities queue in bag; resolved in order | ✅ `triggerStack` in `GameState` |
| 7.7.4 | Bag resolution order: active player resolves first, then passes to next player in turn order | ✅ triggerStack sorted: active player's triggers first (stable sort preserves within-player order). Interactive mode surfaces choose_trigger for manual ordering. |

---

## 8. KEYWORDS

### 8.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 8.1.2 | Non-+N keywords don't stack; +N keywords stack | ⚠️ Stacking for Challenger/Resist/Singer implemented; non-stacking enforcement not |

### 8.2 Alert (first appears Set 10, affects ~20–30 cards across sets 10–11)
| Rule | Quote | Status |
|------|-------|--------|
| 8.2.1 | Alert: this character can challenge as if they had Evasive (ignores Evasive restriction on defenders) | ✅ `alert` in Keyword union. Validator allows Alert attackers to challenge Evasive defenders. Timed grant supported. |
| 8.2.2 | Alert doesn't grant Evasive | N/A until Alert implemented |

### 8.3 Bodyguard
| Rule | Quote | Status |
|------|-------|--------|
| 8.3.2 | Bodyguard may **enter play exerted** | ✅ Synthesized trigger in `applyPlayCard`; `choose_may` → exert flow |
| 8.3.3 | Opponent must challenge Bodyguard before other characters if able | ✅ Tested |

### 8.4 Boost (first appears Set 6, major in Sets 8–10, ~78 cards affected)
| Rule | Quote | Status |
|------|-------|--------|
| 8.4.1 | Boost N {I}: once per turn, pay N ink to put top card of deck facedown under this character/location | ✅ `boost` Keyword + `BOOST_CARD` action + `boostedThisTurn` per-turn flag. `CardInstance.cardsUnder: string[]`, new `"under"` ZoneName. Cleanup on leave-play (CRD 8.10.5). |
| 8.4.2 | Cards under a character are used by many triggered/static effects ("if there's a card under", "for each card under", "put all cards from under into hand") | ✅ Engine primitives complete: `this_has_cards_under` Condition (Flynn), `modify_stat_per_count.countCardsUnderSelf` for "+N stat per card under" (Wreck-it Ralph POWERED UP), `cards_under_count` DynamicAmount variant, `hasCardUnder` CardFilter ("with a card under them"), `card_put_under` TriggerEvent fires from both Boost keyword cost AND `put_top_of_deck_under` effect (Webby's Diary LATEST ENTRY), `put_cards_under_into_hand` effect (Alice). Long tail of 30+ Set 10/11 card wirings still pending — the grammar supports all of them. |

### 8.5 Challenger
| Rule | Quote | Status |
|------|-------|--------|
| 8.5.1 | Challenger +N: +N {S} while this character is challenging | ✅ Applied in `applyChallenge` |
| 8.5.2 | Challenger doesn't apply when character is being challenged | ✅ Only applied to attacker |

### 8.6 Evasive
| Rule | Quote | Status |
|------|-------|--------|
| 8.6.1 | Evasive: can't be challenged except by Evasive character | ✅ Tested |

### 8.7 Reckless
| Rule | Quote | Status |
|------|-------|--------|
| 8.7.2 | Reckless: character can't quest | ✅ validateQuest fails for Reckless characters. 1 test. |
| 8.7.3 | Reckless: can't declare end of turn if this character is ready and can challenge | ✅ validatePassTurn checks ready Reckless with valid targets. 1 test. |
| 8.7.4 | Reckless character can still exert to sing songs or use abilities | ✅ Implicit: exerted Reckless doesn't block pass. Singing/abilities exert. 2 tests. |

### 8.8 Resist
| Rule | Quote | Status |
|------|-------|--------|
| 8.8.1 | Resist +N: damage dealt to this character/location reduced by N | ✅ `getKeywordValue(_, _, "resist")` in challenge + `dealDamageToCard` |
| 8.8.2 | If damage reduced to 0, no damage is considered dealt | ✅ `Math.max(0, ...)` |
| 8.8.3 | Damage **put or moved** onto character is NOT affected by Resist | ✅ `ignoreResist` parameter added to `dealDamageToCard` |

### 8.9 Rush
| Rule | Quote | Status |
|------|-------|--------|
| 8.9.1 | Rush: character can **challenge** as though in play at beginning of turn (challenge only, NOT quest) | ✅ Validator checks Rush keyword; bypasses isDrying for challenges only |

### 8.10 Shift
| Rule | Quote | Status |
|------|-------|--------|
| 8.10.1 | Shift: pay shift cost, put on top of same-named character | ✅ |
| 8.10.2 | If shifted onto exerted character, enters exerted | ✅ Tested |
| 8.10.4 | If shifted onto **dry** character, enters **dry** (can challenge); if drying, enters drying | ✅ `isDrying: shiftTarget.isDrying` inherits from base |
| 8.10.5 | Shifted character inherits ability to sing if base was dry | ✅ Singing implemented. Shifted char inherits isDrying from base (CRD 8.10.4). |
| 8.10.6 | **Shifted character retains damage from character it's on top of** | ✅ `damage: shiftTarget.damage` |
| 8.10.7 | When shifted card leaves play, all cards in stack go to same zone | ✅ Under-cards follow top card to same destination zone (each to own owner's zone) |
| 8.10.8 | Shift has two variants: [Classification] Shift and Universal Shift | ✅ Both implemented as StaticEffects with activeZones: ["hand"]. |
| 8.10.8.1 | [Classification] Shift — shift onto character matching classification, not just name | ✅ `classification_shift_self` static (Thunderbolt). |
| 8.10.8.2 | Universal Shift — shift onto any character in play | ✅ `universal_shift_self` static (Baymax). |

### 8.11 Singer
| Rule | Quote | Status |
|------|-------|--------|
| 8.11.1 | Singer N: character counts as cost N for singing songs | ✅ `canSingSong()` uses `getKeywordValue` for Singer |
| 8.11.2 | Singer only changes cost for singing, not other purposes | ✅ Tested: actual card cost unchanged |

### 8.12 Sing Together (first appears Set 4, ~26 song cards)
| Rule | Quote | Status |
|------|-------|--------|
| 8.12.1 | Sing Together N: exert any number of your characters with combined cost ≥ N to play this song for free | ✅ `singerInstanceIds: string[]` on PlayCardAction. Validator sums effective costs (including location/timed sing bonuses). Legal action enumerator generates singer combinations. |

### 8.13 Support
| Rule | Quote | Status |
|------|-------|--------|
| 8.13.1 | Support: when questing, may add this character's {S} to another chosen character's {S} this turn | ✅ Synthesized trigger in applyQuest; 7 tests |

### 8.14 Vanish (Set 7+, ~few cards)
| Rule | Quote | Status |
|------|-------|--------|
| 8.14.1 | Vanish: when this character is chosen by an opponent for an action's effect, banish this character instead of applying the effect | ❌ Replacement effect (CRD 6.5). Needs replacement effect system or special-case in target resolution. Low priority — few cards. |

### 8.15 Ward
| Rule | Quote | Status |
|------|-------|--------|
| 8.15.1 | Ward: opponents can't choose this card when resolving an effect | ✅ Tested (choice resolution + targeting) |
| 8.15.2 | Effects that don't require choosing still affect Ward characters | ✅ Challenge works on Ward characters (tested) |

---

## SUMMARY: Bugs Fixed (Session 5)

| # | Bug | CRD Ref | Fix |
|---|-----|---------|-----|
| B1 | Rush allows questing; should only allow challenging | 8.9.1 | ✅ Validator checks Rush keyword; bypasses isDrying for challenges only |
| B2 | Shift sets `damage: 0`; should inherit damage from base | 8.10.6 | ✅ `damage: shiftTarget.damage` |
| B3 | Shift sets `hasActedThisTurn: true` unconditionally; should inherit dry/drying from base | 8.10.4 | ✅ `isDrying: shiftTarget.isDrying` |
| B4 | `applyPassTurn` readies only play zone; inkwell cards not readied | 3.2.1.1 | ✅ Added inkwell loop |
| B5 | `hasActedThisTurn` boolean conflates questing restriction with challenging restriction | 5.1.1.11 | ✅ Renamed to `isDrying`; drying is now a proper CRD concept |
| B6 | Resist applies to "put/moved" damage; should only reduce "dealt" damage | 8.8.3 | ✅ Added `ignoreResist` parameter to `dealDamageToCard` |

## SUMMARY: Missing Features (set 1 scope)

| Feature | CRD Ref | Notes |
|---------|---------|-------|
| ~~Bodyguard enters play exerted~~ | 8.3.2 | ✅ 4 tests |
| ~~Reckless can't quest + can't pass if able to challenge~~ | 8.7.2–3 | ✅ 4 tests (8.7.2, 8.7.3, 8.7.4 × 2) |
| Support (quest to buff another character's {S}) | 8.13.1 | ✅ 7 tests |
| Singer (exert to sing songs) | 8.11 | ✅ Implemented |
| ~~Starting player skips first draw~~ | 3.2.3.1 | ✅ Was already implicit in code structure |
| Actions card type | 5.4.1 | ✅ Implemented with actionEffects; 3 cards have data (Friends, Dragon Fire, Be Prepared) |
| ~~Locations card type~~ | 5.6 | ✅ Locations implemented: play, move characters, moveCost, willpower, lore gain at Set step, atLocationInstanceId tracking. |
| ~~Shift stack: all stack cards leave play together~~ | 8.10.7 | ✅ Under-cards follow top card to same zone |
| Replacement effects | 6.5 | Complex; needed for many later-set cards |
| ~~Floating triggered abilities~~ | 6.2.7.1 | ✅ `floatingTriggers[]`, `CreateFloatingTriggerEffect` |
| Delayed triggered abilities | 6.2.7.2 | Not implemented (split from floating) |
| "For free" play | 1.5.5.3 | ✅ `play_for_free` effect + `grant_play_for_free_self` static. Mufasa, Pride Lands, Belle all wired. |
| ~~Mulligan~~ | 2.2.2 | ✅ Implemented — Partial Paris via BotStrategy |
| ~~Trigger condition evaluation~~ | 1.8.2 / 6.2.4 | ✅ `evaluateCondition()` in processTriggerStack + gameModifiers + validator |
| ~~Split applyPassTurn into end-of-turn / start-of-turn~~ | 3.2 / 3.4 | ✅ Still one function but correctly ordered: end-of-turn triggers → transition → Ready step → Set step → resolve Ready+Set triggers (CRD 3.2.2.3) → turn_start triggers → Draw step. |
| ~~Timed effects system~~ | 3.4.1.2 / 6.4 | ✅ `timedEffects[]` with 3 duration types, expiry in applyPassTurn |

---

---

## New Effect / Type Gaps (Sets 2–11, discovered via card-status analysis)

These are additions to the type system needed before the `needs-new-type` card group
can be implemented. Full details in CARD_ISSUES.md.

### Effect types to add
| Effect | Cards unblocked (approx) | Notes |
|--------|--------------------------|-------|
| ~~`move_damage`~~ | 29 | ✅ CRD 1.9.1.4 implemented |
| `trim_inkwell` | ~2 | Ink Geyser + variants |
| `trim_hand` | ~5 | "discard until you have N" |
| `put_on_bottom` | 15+ | move card to bottom of deck, no shuffle |
| `reveal_hand` | ~10 | reveal + controller-chosen discard |
| `random_discard` | ~15 | discard at random |
| `dynamic_gain_lore` | 20+ | lore equal to stat/cost/count |
| `dynamic_deal_damage` | 10+ | damage equal to stat/count |
| `replay_from_discard` | ~8 | play from discard, put on bottom |

### Static effect types to add
| StaticEffect | Notes |
|-------------|-------|
| `modify_win_threshold` | Donald Duck (set-7); update `getLoreThreshold()` |
| `ink_from_zone` | Moana (set-11); update `PLAY_INK` validation |
| `enter_play_exerted_static` | opposing cards enter exerted |
| `grant_classification` | trait granting |
| `stat_floor` | {S} can't go below printed value |
| `prevent_lore_loss` | during opponents' turns |
| `damage_immunity` | takes no damage |
| `virtual_cost_modifier` | count as having +N cost for singing |

### Cost types to add
| Cost | Notes |
|------|-------|
| `exert_filtered_character` | exert a matching character as cost |
| `exert_filtered_item` | exert a matching item as cost |

### Condition types to add
| Condition | Notes |
|-----------|-------|
| `zone_count_with_filter` | has N+ cards of type X in zone Y |
| `stat_threshold` | character with stat ≥ N in play |
| `compound_and` | two conditions both true |
| `played_via_shift` | this card entered play via Shift |

### Trigger events to add
| TriggerEvent | Notes |
|-------------|-------|
| `exerts` | this character exerts for any reason |
| `deals_damage_in_challenge` | deals damage during a challenge |
| `sings` | this character sings a song |
| `song_played` | any song is played by the controller |

### Keyword to add
| Keyword | CRD | Notes |
|---------|-----|-------|
| `alert` | 8.2 | Add to `Keyword` union; update challenge validator |

### RestrictedAction extension
Add `"be_challenged"` to allow timed "can't be challenged" on specific cards
(currently only the permanent `CantBeChallengedException` StaticEffect exists).

---

*Last updated: Session 22*
*CRD version: 2.0.1, effective Feb 5, 2026*
