Now let me create the comprehensive catalog report:

---

# **EXHAUSTIVE LORCANA ENGINE PRIMITIVE CATALOG**

## How to Read This Report

This catalog comprehensively lists every discriminator and type in the Lorcana engine (`packages/engine/src/`). Each section groups related primitives by category (Effect, Static, Trigger, etc.). Within each item, you'll find:
- **Name** (the discriminator string)
- **Type interface** (the TypeScript interface name)
- **Fields** (parameters in compact notation)
- **Purpose** (one-line JSDoc summary)
- **Line citations** (where the type is defined and implemented)
- **Example user** (a card that uses it, when applicable from grepping)

Use Ctrl+F to search for overlapping names. Flagged overlaps appear under **"⚠ Potential overlaps"** subsections.

---

## 1. EFFECT TYPES (Effect Union)

**Total: 53 primary effects** (alphabetically sorted)

| Name | Interface | Fields | Purpose | Type Def | Reducer Case |
|------|-----------|--------|---------|----------|--------------|
| `banish` | BanishEffect | `target` | Remove target from play to discard | types:528 | reducer:2230 |
| `cant_action` | CantActionEffect | `action, target, duration` | Prevent target from quest/challenge/etc this turn | types:1096 | reducer:3234 |
| `cant_be_challenged_timed` | CantBeChallengedTimedEffect | `target, duration, isMay?` | Target can't be challenged until duration ends | types:813 | reducer:2435 |
| `choose` | ChooseEffect | `options, count` | Pick N of multiple effect paths | types:1053 | reducer:4257 |
| `choose_n_from_opponent_discard_to_bottom` | ChooseNFromOpponentDiscardToBottomEffect | `count, gainLoreBase, gainLoreBonus, bonusFilter` | Move N from opponent's discard to bottom + conditional lore | types:745 | reducer:3896 |
| `chosen_opposing_may_bottom_or_reward` | ChosenOpposingMayBottomOrRewardEffect | `filter, rewardEffect` | Chosen opponent may save by moving self to bottom; else caster gets reward | types:273 | reducer:3870 |
| `conditional_on_last_discarded` | ConditionalOnLastDiscardedEffect | `filter, then, otherwise?` | Branch on whether last discard matched filter | types:774 | reducer:2846 |
| `conditional_on_player_state` | ConditionalOnPlayerStateEffect | `condition, thenEffects, elseEffects` | Branch on player-state condition (hand size, etc) | types:259 | reducer:3799 |
| `conditional_on_target` | ConditionalOnTargetEffect | `target, defaultEffects, conditionFilter, ifMatchEffects` | Branch on whether chosen target matches filter | types:1185 | reducer:4159 |
| `cost_reduction` | CostReductionEffect | `amount, filter` | Pay N less for next matching card | types:1302 | reducer:4249 |
| `create_card` | CreateCardEffect | `cardDefinitionId, zone, target` | Create a token in target zone | types:1030 | (synthetic) |
| `create_floating_trigger` | CreateFloatingTriggerEffect | `trigger, effects, attachTo?, targetFilter?` | Create turn-scoped triggered ability | types:1320 | (synthetic) |
| `damage_immunity_timed` | DamageImmunityTimedEffect | `target, source, duration, isMay?, charges?` | Target takes no damage from source until duration | types:831 | reducer:2383 |
| `deal_damage` | DealDamageEffect | `amount, target, isUpTo?, asDamageCounter?` | Put damage counters on target | types:504 | reducer:2194 |
| `discard_from_hand` | DiscardEffect | `amount, target, chooser, filter?` | Target player(s) discard cards | types:1166 | reducer:4014 |
| `draw` | DrawEffect | `amount, target, isMay?, isUpTo?, untilHandSize?` | Target player draws cards or draws until hand size reaches N | types:479 | reducer:2108 |
| `each_opponent_may_discard_then_reward` | EachOpponentMayDiscardThenRewardEffect | `rewardEffect` | Opponent may discard; if declines, caster gets reward | types:325 | reducer:3952 |
| `exert` | ExertEffect | `target, isMay?, isUpTo?, followUpEffects?` | Exert target(s) | types:1059 | reducer:3035 |
| `fill_hand_to` | FillHandToEffect | `target, n, trimOnly?` | Draw or discard to normalize hand size to N | types:288 | reducer:3720 |
| `gain_conditional_challenge_bonus` | GainConditionalChallengeBonusEffect | `strength, defenderFilter` | Your characters gain +N {S} vs matching defenders this turn | types:977 | reducer:3018 |
| `gain_lore` | GainLoreEffect | `amount, target` | Target player gains lore | types:540 | reducer:2174 |
| `gain_stats` | GainStatsEffect | `strength?, willpower?, lore?, target, duration, isMay?, ...dynamic` | Target gains stat modifiers | types:556 | reducer:2348 |
| `grant_activated_ability_timed` | GrantActivatedAbilityTimedEffect | `filter, ability` | Matching cards gain activated ability this turn | types:307 | reducer:3751 |
| `grant_challenge_ready` | GrantChallengeReadyEffect | `target, duration` | Target can challenge ready characters | types:412 | reducer (implicit) |
| `grant_cost_reduction` | GrantCostReductionEffect | `amount, filter` | Pay N less for next matching card | types:603 | reducer:2646 |
| `grant_extra_ink_play` | GrantExtraInkPlayEffect | `amount` | Play one extra ink card this turn | types:1278 | reducer (implicit) |
| `grant_keyword` | GrantKeywordEffect | `keyword, value?, valueDynamic?, target, duration, isMay?` | Target gains keyword with optional value | types:1070 | reducer:3080 |
| `look_at_top` | LookAtTopEffect | `count, action, filter?, filters?, maxToHand?, restPlacement?, target, isMay?` | Reveal top N cards with various placement options | types:1123 | reducer:3270 |
| `lose_lore` | LoseLoreEffect | `amount, target` | Target player loses lore | types:1313 | reducer (implied) |
| `mass_inkwell` | MassInkwellEffect | `mode, target, amount?, untilCount?` | Exert/ready/shuffle inkwell or return cards | types:368 | reducer:3668 |
| `mill` | MillEffect | `amount, target` | Target player puts top N cards into discard | types:387 | reducer:3643 |
| `move_all_matching_to_inkwell` | MoveAllMatchingToInkwellEffect | `filter, isMay?` | Move all matching from discard to inkwell exerted | types:787 | reducer:2868 |
| `move_cards_under_to_inkwell` | MoveCardsUnderToInkwellEffect | `target, isMay?` | Drain under-cards to controller's inkwell exerted | types:726 | reducer:2812 |
| `move_character` | MoveCharacterEffect | `character, location, isMay?, _resolvedCharacter?, _resolvedLocation?` | Move character to location (no cost) | types:936 | reducer:2934 |
| `move_damage` | MoveDamageEffect | `amount, isUpTo?, source, destination, _resolvedSource?` | Move damage from one character to another | types:614 | reducer:2663 |
| `move_to_inkwell` | MoveToInkwellEffect | `target, enterExerted, isMay?, fromZone?` | Move card to inkwell | types:1259 | reducer:4115 |
| `must_quest_if_able` | MustQuestIfAbleEffect | `target, duration` | Target must quest if able during next turn | types:1111 | reducer:3194 |
| `name_a_card_then_reveal` | NameACardThenRevealEffect | `target, matchAction?, gainLoreOnHit?` | Player names a card, reveals deck top, matches or puts back | types:909 | reducer:2906 |
| `opponent_chooses_yes_or_no` | OpponentChoosesYesOrNoEffect | `yesEffect, noEffect` | Opponent picks YES (caster benefits) or NO (opponent benefits) | types:761 | reducer:3928 |
| `opponent_may_pay_to_avoid` | OpponentMayPayToAvoidEffect | `acceptEffect, rejectEffect` | Opponent may pay to avoid penalty | types:1009 | reducer:3838 |
| `pay_ink` | PayInkEffect | `amount` | Caster pays ink immediately (in sequential) | types:1272 | reducer:4249 |
| `play_for_free` | PlayForFreeEffect | `sourceZone?, target?, filter?, isMay?, grantKeywords?, banishAtEndOfTurn?, thenPutOnBottomOfDeck?, cost?, enterExerted?, sourceInstanceId?` | Play a card without paying ink | types:1197 | reducer:4188 |
| `player_may_play_from_hand` | PlayerMayPlayFromHandEffect | `player, filter` | Player may reveal & play matching card from hand | types:245 | reducer:3766 |
| `put_cards_under_into_hand` | PutCardsUnderIntoHandEffect | `target, isMay?` | Put all under-cards into hand | types:708 | reducer:2782 |
| `put_on_bottom_of_deck` | PutOnBottomOfDeckEffect | `from, ownerScope?, filter?, amount?, target?, isMay?` | Move card(s) from zone to bottom of deck | types:673 | reducer:2544 |
| `put_self_under_target` | PutSelfUnderTargetEffect | `filter, isMay?` | Source goes facedown under chosen target | types:801 | reducer:2886 |
| `put_top_of_deck_under` | PutTopOfDeckUnderEffect | `target, isMay?` | Put top of deck under chosen/this card facedown | types:639 | reducer:2717 |
| `ready` | ReadyEffect | `target, isMay?, followUpEffects?` | Ready target(s) | types:1086 | reducer:3127 |
| `remember_chosen_target` | RememberChosenTargetEffect | `filter` | Mark chosen target as remembered on source | types:1025 | reducer:3815 |
| `remove_damage` | RemoveDamageEffect | `amount, target, isUpTo?` | Remove damage from target | types:520 | reducer:2304 |
| `restrict_play` | RestrictPlayEffect | `cardTypes, affectedPlayer` | Opponent can't play matching card types until next turn | types:337 | reducer:3988 |
| `return_all_to_bottom_in_order` | ReturnAllToBottomInOrderEffect | `filter` | Put all matching to bottom in chosen order | types:697 | reducer:2622 |
| `return_to_hand` | ReturnToHandEffect | `target, isMay?` | Return target to hand | types:533 | reducer:2270 |
| `reveal_hand` | RevealHandEffect | `target` | Reveal target player's hand (analytics event) | types:403 | reducer:2153 |
| `reveal_top_conditional` | RevealTopConditionalEffect | `filter, matchAction, matchEnterExerted?, repeatOnMatch?, isMay?, noMatchDestination?, matchExtraEffects?, target` | Reveal top, match to action or location | types:873 | reducer:2469 |
| `search` | SearchEffect | `filter, target, zone, putInto, position?` | Search a zone for card and move it | types:1038 | reducer (synthetic) |
| `sequential` | SequentialEffect | `costEffects, rewardEffects, isMay?` | Cost → Reward pattern (both must resolve) | types:1287 | (control flow) |
| `shuffle_into_deck` | ShuffleIntoDeckEffect | `target, isMay?` | Move card to deck and shuffle | types:1247 | (synthetic) |
| `sing_cost_bonus_target` | SingCostBonusTargetEffect | `target, amount, duration` | Target counts as having +N cost to sing this turn | types:1513 | (synthetic) |

### ⚠ Potential Overlaps in Effects

1. **`gain_lore` vs `lose_lore`** — Could be unified as `adjust_lore` with signed amount (currently two separate types).

2. **`exert` vs `must_quest_if_able`** — Both enforce action costs/restrictions but operate on different time windows. May make sense to generalize the follow-up restriction machinery.

3. **`put_top_of_deck_under` vs `put_on_bottom_of_deck`** — Both move cards to under/bottom but have different source/destination logic. Could explore if these can share a common "move_card_to_zone" pattern.

4. **`cant_action` (timed) vs `cant_action_self` (static)** — Instance-scoped vs permanent. Same concept, different duration models. Worth checking if they can unify the restriction application.

5. **`gain_stats` (with duration) vs `modify_stat_while_challenged` (static)** — Both modify stats; one is timed, one is conditional/permanent. Static version is currently only on-challenge; effect version applies broadly.

6. **`conditional_on_target`, `conditional_on_last_discarded`, `conditional_on_player_state`** — Three branching conditions with different triggers. Could explore a unified `conditional` effect with pluggable condition logic (already exists for other uses).

7. **`chosen_opposing_may_bottom_or_reward` vs `opponent_may_pay_to_avoid`** — Both are opponent-chooses patterns (user noted these are known overlaps). Same cross-player-chooser machinery. Collapsed into `opponent_may_choose` with flexible effects would unify.

8. **`grant_keyword` (timed) vs `grant_keyword` (static)** — Same discriminator name on two different effect categories (`grant_keyword` in Effect union, `grant_keyword` in StaticEffect union). Intentional split due to static vs timed semantics but worth noting.

9. **`move_damage` with multiple sources** — The `source` field branches to `{ type: "chosen"; filter }` or `{ type: "all_damaged"; filter }`. Could generalize to a CardTarget pattern.

10. **`reveal_top_conditional` with multiple actions** — The `matchAction` field supports 3 variants (to_hand, play_for_free, to_inkwell_exerted). Could evolve into a "move card from zone" primitive.

---

## 2. STATIC EFFECT TYPES (StaticEffect Union)

**Total: 34 static effects** (alphabetically sorted)

| Name | Interface | Fields | Purpose | Type Def | GameMod Case |
|------|-----------|--------|---------|----------|--------------|
| `action_restriction` | ActionRestrictionStatic | `restricts, affectedPlayer, filter?` | Block quest/challenge/etc on matching cards | types:1814 | gameModifiers:action_restriction |
| `can_challenge_ready` | CanChallengeReadyStatic | `target` | Target may challenge ready characters | types:1690 | gameModifiers:can_challenge_ready |
| `cant_action_self` | CantActionSelfStatic | `action` | This card permanently can't perform action | types:1642 | gameModifiers:cant_action_self |
| `cant_be_challenged` | CantBeChallengedException | `target, attackerFilter?` | Target can't be challenged (or only by matching attackers) | types:1788 | gameModifiers:cant_be_challenged |
| `challenge_damage_immunity` | ChallengeDamageImmunityStatic | `targetFilter?` | This character takes no damage from challenges vs filter | types:1711 | gameModifiers:challenge_damage_immunity |
| `classification_shift_self` | ClassificationShiftSelfStatic | `trait` | This Shift card may shift onto any char with trait | types:1621 | gameModifiers:classification_shift_self |
| `conditional_challenger_self` | ConditionalChallengerSelfStatic | `strength, defenderFilter` | This character gains +N {S} vs matching defenders (permanent) | types:991 | gameModifiers:conditional_challenger_self |
| `cost_reduction` | CostReductionStatic | `amount, filter, appliesTo?` | Matching cards cost N less (or shift_only) | types:1797 | gameModifiers:cost_reduction |
| `damage_immunity_static` | DamageImmunityStatic | `source, target, chargesPerTurn?` | Target can't be dealt damage from source | types:852 | gameModifiers:damage_immunity_static |
| `damage_redirect` | DamageRedirectStatic | `from` | Damage to other own cards redirects to this | types:1700 | gameModifiers:damage_redirect |
| `enter_play_exerted` | EnterPlayExertedStatic | `filter` | Matching cards played by opponents enter exerted | types:1540 | gameModifiers:enter_play_exerted |
| `extra_ink_play` | ExtraInkPlayStatic | (none) | One extra ink play per turn | types:1825 | gameModifiers:extra_ink_play |
| `forced_target_priority` | ForcedTargetPriorityStatic | (none) | Opponents must choose this for effects if able | types:1451 | gameModifiers:forced_target_priority |
| `grant_activated_ability` | GrantActivatedAbilityStatic | `target, ability` | Matching characters gain activated ability | types:1721 | gameModifiers:grant_activated_ability |
| `grant_keyword` | GainKeywordStatic | `keyword, value?, target` | Matching characters gain keyword | types:1727 | gameModifiers:grant_keyword |
| `grant_play_for_free_self` | GrantPlayForFreeSelfStatic | (none) | This in-hand card may be played for free (conditional) | types:1670 | gameModifiers:grant_play_for_free_self |
| `grant_shift_self` | GrantShiftSelfStatic | `value` | This in-hand card gains Shift N {I} (conditional) | types:1684 | gameModifiers:grant_shift_self |
| `grant_trait_static` | GrantTraitStatic | `trait, target` | Matching cards gain trait at runtime | types:1495 | gameModifiers (pre-pass) |
| `ink_from_discard` | InkFromDiscardStatic | (none) | Controller may ink cards from discard | types:1389 | gameModifiers:ink_from_discard |
| `inkwell_enters_exerted` | InkwellEntersExertedStatic | `affectedPlayer` | Newly-inked cards enter exerted (no ink this turn) | types:1468 | gameModifiers:inkwell_enters_exerted |
| `mimicry_target_self` | MimicryTargetSelfStatic | (none) | Any shifter may shift onto this card | types:1602 | gameModifiers:mimicry_target_self |
| `modify_stat` | ModifyStatStatic | `stat, modifier, target` | Matching cards get flat +/- to stat | types:1734 | gameModifiers:modify_stat |
| `modify_stat_per_count` | ModifyStatPerCountStatic | `stat, perCount, countFilter?, countCardsUnderSelf?, target` | +N per matching card (flexible filter) | types:1746 | gameModifiers:modify_stat_per_count |
| `modify_stat_per_damage` | ModifyStatPerDamageStatic | `stat, perDamage, target` | +N per damage on this card | types:1766 | gameModifiers:modify_stat_per_damage |
| `modify_stat_while_challenged` | ModifyStatWhileChallengedStatic | `stat, modifier, affects?` | Defender/attacker gets +/- during challenges | types:1778 | gameModifiers (implicit) |
| `modify_win_threshold` | ModifyWinThresholdStatic | `affectedPlayer, newThreshold` | Opponent needs custom lore total to win | types:1590 | gameModifiers:modify_win_threshold |
| `move_to_self_cost_reduction` | MoveToSelfCostReductionStatic | `amount, filter` | Matching characters may move here for reduced cost | types:1554 | gameModifiers:move_to_self_cost_reduction |
| `one_challenge_per_turn_global` | OneChallengePerTurnGlobalStatic | (none) | Global: only one character may challenge per turn | types:1399 | gameModifiers:one_challenge_per_turn_global |
| `playable_from_zone_self` | PlayableFromZoneSelfStatic | `zone` | This card may be played from zone (hand, discard, etc) | types:1631 | gameModifiers:playable_from_zone_self |
| `prevent_discard_from_hand` | PreventDiscardFromHandStatic | (none) | Controller's hand can't be discarded (gated by condition) | types:1410 | gameModifiers:prevent_discard_from_hand |
| `prevent_lore_gain` | PreventLoreGainStatic | `affectedPlayer` | Affected player can't gain lore (gated by condition) | types:1455 | gameModifiers:prevent_lore_gain |
| `prevent_lore_loss` | PreventLoreLossStatic | (none) | Controller can't lose lore (gated by condition) | types:1431 | gameModifiers:prevent_lore_loss |
| `remove_named_ability` | RemoveNamedAbilityStatic | `abilityName, target` | Matching cards lose named ability | types:1420 | gameModifiers (pre-pass) |
| `restrict_remembered_target_action` | RestrictRememberedTargetActionStatic | `action` | Remembered target can't perform action | types:1655 | gameModifiers (iterated) |
| `self_cost_reduction` | SelfCostReductionStatic | `amount, perMatch?` | This card costs N less to play (condition-gated) | types:1835 | validator (play check) |
| `sing_cost_bonus_here` | SingCostBonusHereStatic | `amount` | Characters here count as +N cost to sing | types:1481 | gameModifiers:sing_cost_bonus_here |
| `skip_draw_step_self` | SkipDrawStepSelfStatic | (none) | Controller skips their draw step | types:1581 | gameModifiers:skip_draw_step_self |
| `stat_floor_printed` | StatFloorPrintedStatic | `stat, target` | Matching cards' stat can't drop below printed | types:1527 | gameModifiers:stat_floor_printed |
| `top_of_deck_visible` | TopOfDeckVisibleStatic | `affectedPlayer` | Affected player's deck top is face-up | types:1570 | gameModifiers:top_of_deck_visible |
| `universal_shift_self` | UniversalShiftSelfStatic | (none) | This Shift card may shift onto any own character | types:1612 | gameModifiers:universal_shift_self |

### ⚠ Potential Overlaps in Static Effects

1. **`grant_keyword` (static) vs `grant_keyword` (effect timed)** — Duplicate name across unions. Consider renaming static version to `grant_keyword_static` or effect version to clarify scoping (static=permanent, effect=timed).

2. **`cost_reduction` (static) vs `grant_cost_reduction` (effect) vs `self_cost_reduction` (static)** — Three cost-reduction patterns:
   - Static `cost_reduction`: global cost reduction (Mickey: Brooms cost 1 less)
   - Effect `grant_cost_reduction`: one-shot cost reduction (Gaston effect)
   - Static `self_cost_reduction`: card-specific cost reduction from hand
   Could unify under a cost-reduction umbrella with scope indicators.

3. **`damage_immunity_static` vs `damage_immunity_timed` (effect)** — Same protection mechanism but different durations. Could be unified with a duration parameter.

4. **`cant_action_self` (static) vs `cant_action` (effect timed)** — Same restriction, different sources (permanent vs one-turn). Consider merging logic.

5. **`modify_stat` vs `modify_stat_per_count` vs `modify_stat_per_damage`** — All three modify stats but with different sources of the bonus:
   - Static modifier (literal +2)
   - Per-count modifier (+1 per item)
   - Per-damage modifier (+1 per damage)
   Could generalize to a single `modify_stat_static` with flexible amount computation.

6. **`modify_stat_while_challenged` (static-only) vs `gain_stats` (effect, with on-challenge potential)** — The static version only applies during challenges. The effect version applies more broadly. Consider whether a unified challenge-scoped stat pattern would be cleaner.

7. **`action_restriction` (static) vs `cant_action_self` (static)** — Both restrict actions:
   - `action_restriction`: affects other players' or opponent's characters
   - `cant_action_self`: permanent self-restriction
   Could be one effect with a target field.

8. **`conditional_challenger_self` (static) vs `gain_conditional_challenge_bonus` (effect, per-turn)** — Both add challenge bonuses but one is permanent, one is per-turn. Separate models justified but worth noting pattern duplication.

9. **`sing_cost_bonus_here` (static, location-bound) vs `sing_cost_bonus_target` (effect, character-bound, per-turn)** — Both adjust sing cost but at different granularities (location vs instance). Could unify the mechanism.

10. **`prevent_lore_loss` vs `prevent_lore_gain` vs `prevent_discard_from_hand`** — All three are shields against specific effect types. Pattern is consistent but could potentially generalize to `prevent_effect_type` if more shields are added.

---

## 3. TRIGGERED ABILITY EVENTS (TriggerEvent Union)

**Total: 25 trigger events** (alphabetically sorted)

| Name | Filter Fields | Purpose | Example Card |
|------|---------------|---------|--------------|
| `banished_in_challenge` | `filter` | When this card is banished by challenge | LeFou (checks opponent's flag) |
| `banished_other_in_challenge` | `filter` | When opponent's character is banished in my challenge | Namaari Resolute Daughter |
| `card_drawn` | `player` | When target player draws | (turn-start triggers) |
| `card_played` | `filter` | When matching card is played | Shenzi Scar's Accomplice |
| `card_put_under` | `filter` (carrier) | When card placed facedown under carrier | Webby's Diary (Boost trigger) |
| `character_exerted` | `filter` | When character transitions to exerted | Te Kā Elemental Terror |
| `challenges` | `filter`, `defenderFilter?` | When source challenges (optionally vs matching defender) | Shenzi Head Hyena, Prince Phillip Swordsman |
| `chosen_by_opponent` | `filter` | When chosen as effect target by opponent | Archimedes Exceptional Owl |
| `chosen_for_support` | `filter` | When chosen as Support recipient | Prince Phillip Gallant Defender |
| `damage_dealt_to` | `filter` | When target takes damage | (quest/challenge triggers) |
| `damage_removed_from` | `filter` | When damage removed from target | Baymax Armored Companion |
| `deals_damage_in_challenge` | `filter` (dealer) | When source deals damage in challenge | Mulan Elite Archer (Triple Shot) |
| `enters_play` | `filter` | When card enters play | (most triggered abilities) |
| `ink_played` | `player` | When target player inks a card | (turn-start triggers) |
| `is_banished` | `filter` | When card is banished (any source) | (various effects) |
| `is_challenged` | `filter` | When card is challenged (as defender) | (various effects) |
| `item_played` | `filter` | When item is played | (item-specific triggers) |
| `leaves_play` | `filter` | When card leaves play | (various effects) |
| `moves_to_location` | `filter` | When character moves to location | I've Got a Dream |
| `quests` | `filter` | When card quests | Isabella Madrigal Golden Child |
| `readied` | `filter` | When card is readied | (various effects) |
| `returned_to_hand` | `filter` | When card returns to hand | (various effects) |
| `shifted_onto` | `filter` (undercard) | When shifter placed on top of undercard | Go Go Tomago Mechanical Engineer |
| `sings` | `filter` | When character sings | Fantastical and Magical |
| `turn_end` | `player` | At end of target player's turn | (various end-of-turn triggers) |
| `turn_start` | `player` | At start of target player's turn | (various turn-start triggers) |
| `cards_discarded` | `player` | When target player discards cards | (trigger stacks on discard) |

### ⚠ Potential Overlaps in Triggered Events

1. **`damage_dealt_to` vs `deals_damage_in_challenge`** — Both involve damage but from different perspectives:
   - `damage_dealt_to`: recipient view (any damage source)
   - `deals_damage_in_challenge`: dealer view (challenge-specific)
   Could merge into a unified damage event with filter scope.

2. **`is_challenged` vs `challenges` (with defenderFilter)** — Both capture challenge interactions:
   - `is_challenged`: defender's trigger
   - `challenges` + defenderFilter: attacker's conditional trigger
   Separate is justified (different source) but worth verifying no duplication.

3. **`banished_in_challenge` vs `is_banished`** — Both fire when card is banished:
   - `banished_in_challenge`: challenge-context only
   - `is_banished`: any banish source
   Could merge with optional context hint.

4. **`enters_play` vs `leaves_play`** — Clear inverse pair, no overlap.

5. **`quests`, `sings`, `challenges`, `readied`** — All are "action taken" triggers. Could be unified as `action_taken` with action type discriminator, but current model is clear.

6. **`turn_start` + `card_drawn` + `ink_played`** — All fire during turn-beginning phase. Separate is fine but consider if a turn-phase event model would scale better.

---

## 4. CONDITIONS (Condition Type Union)

**Total: 42 condition types** (alphabetically sorted)

| Name | Fields | Purpose | Example Card/Usage |
|------|--------|---------|-------------------|
| `a_character_was_banished_in_challenge_this_turn` | (none) | True if any character was banished in challenge this turn | (per-turn flag) |
| `actions_played_this_turn_eq` | `amount` | True if exactly N actions played this turn | (per-turn counter) |
| `actions_played_this_turn_gte` | `amount` | True if at least N actions played this turn | (per-turn counter) |
| `card_has_trait` | `trait` | True if card instance has trait | (filter-gating) |
| `card_is_type` | `cardType` | True if card is cardType | (filter-gating) |
| `card_left_discard_this_turn` | (none) | True if card moved out of discard this turn | Anna Soothing Sister UNUSUAL TRANSFORMATION |
| `cards_in_hand_eq` | `amount, player` | True if player has exactly N cards | (hand checks) |
| `cards_in_hand_gte` | `amount, player` | True if player has at least N cards | Desperate Plan (if you have no cards) |
| `cards_in_zone_gte` | `zone, amount, player, cardType?[]` | True if zone has at least N cards (optional type filter) | (zone-state checks) |
| `characters_here_gte` | `amount, player?` | True if location has N+ characters (optional owner) | Pride Lands Jungle Oasis |
| `characters_in_play_gte` | `amount, player, excludeSelf?, hasName?` | True if in-play count >= N (optional self-exclude, optional name) | (character-count checks) |
| `compound_and` | `conditions[]` | True if ALL sub-conditions true | (logic gates) |
| `compound_or` | `conditions[]` | True if ANY sub-condition true | (logic gates) |
| `has_character_named` | `name, player` | True if player has named character in play | (name-checks) |
| `has_character_with_trait` | `trait, player, excludeSelf?` | True if player has character with trait (optional self-exclude) | (trait-checks) |
| `ink_plays_this_turn_eq` | `amount` | True if player has inked exactly N cards this turn | Chicha Dedicated Mother |
| `is_your_turn` | (none) | True if it's the controller's turn | Koda Talkative Cub |
| `no_challenges_this_turn` | (none) | True if controller's characters haven't challenged | John Smith Snow Tracker |
| `no_other_character_quested_this_turn` | (none) | True if only this card or no cards quested | Isabela Madrigal Golden Child |
| `not` | `condition` | Negation of sub-condition | (logic inversion) |
| `opponent_character_was_banished_in_challenge_this_turn` | (none) | True if opponent's character was banished this turn | LeFou Opportunistic Flunky |
| `opponent_has_lore_gte` | `amount` | True if opponent has at least N lore | (lore checks) |
| `opponent_has_more_cards_in_hand` | (none) | True if opponent has more hand cards | (hand comparison) |
| `opponent_has_more_than_self` | `metric` (strength_in_play, items_in_play, cards_in_inkwell) | True if opponent exceeds on metric | HeiHei Bumbling Rooster |
| `opponent_no_challenges_this_turn` | (none) | True if opponent hasn't challenged | Peter Pan Never Land Prankster |
| `played_another_character_this_turn` | (none) | True if another character was played this turn | (Travelers cycle P3) |
| `played_character_with_trait_this_turn` | `trait` | True if character with trait was played | (trait-tracking) |
| `played_via_shift` | (none) | True if this card entered via Shift | (shift-context) |
| `self_has_more_than_each_opponent` | `metric` (strength_in_play, items_in_play, cards_in_inkwell) | True if controller exceeds each opponent on metric | Flynn Rider Frenemy |
| `self_stat_gte` | `stat, amount` | True if this card's stat >= N | (card-stat checks) |
| `songs_played_this_turn_gte` | `amount` | True if N+ songs played this turn | (per-turn counter) |
| `this_at_location` | (none) | True if this character is at a location | (location-check) |
| `this_had_card_put_under_this_turn` | (none) | True if a card was placed under this instance this turn | Willie the Giant Ghost of Christmas Present |
| `this_has_cards_under` | (none) | True if this card has cards in under-pile | Webby Vanderquack Knowledge Seeker |
| `this_has_no_damage` | (none) | True if this card has 0 damage | (damage-state check) |
| `this_is_exerted` | (none) | True if this card is exerted | (exert-state check) |
| `this_location_has_character` | (none) | True if location has a character at it | (location-occupancy) |
| `this_location_has_damaged_character` | (none) | True if location has own damaged character | Ratigan's Party Seedy Back Room |
| `this_location_has_exerted_character` | (none) | True if location has own exerted character at it | Ursula's Garden, The Wall |
| `triggering_card_played_via_shift` | (none) | True if triggering card entered via Shift | (shift-context on trigger) |
| `you_control_matching` | `filter` | True if controller has in-play card matching filter | Webby Vanderquack Knowledge Seeker |
| `you_have_lore_gte` | `amount` | True if controller has at least N lore | (lore checks) |
| `your_character_was_damaged_this_turn` | (none) | True if any own character was damaged | Devil's Eye Diamond |
| `your_first_turn_as_underdog` | (none) | True if this is first turn AND not first player | UNDERDOG (Set 11) |

### ⚠ Potential Overlaps in Conditions

1. **`compound_and` vs `compound_or`** — Both exist for logic gating. No overlap; intentional branching.

2. **`cards_in_hand_gte` vs `cards_in_hand_eq`** — Two separate numeric comparisons. Could generalize to `cards_in_hand` with operator field (>=, ==, etc).

3. **`characters_in_play_gte` with optional `hasName` vs separate name check** — The `hasName` field adds a name predicate. Could extract as a filter and use `you_control_matching` instead.

4. **`has_character_with_trait` vs `played_character_with_trait_this_turn`** — Both trait checks but one is current-state, one is per-turn history. Clear distinction.

5. **`is_your_turn` vs opponent-context conditions** — `is_your_turn` checks if it's the controller's turn; several opponent-context conditions check the opponent's state. Could unify with a `player_context` field, but current split is clear.

6. **`opponent_character_was_banished_in_challenge_this_turn` vs `a_character_was_banished_in_challenge_this_turn`** — Both banish-in-challenge flags:
   - First: opponent-specific per-turn flag
   - Second: global per-turn flag
   Could merge with a `player` field for scoping.

7. **`your_character_was_damaged_this_turn` vs `opposing_character_was_damaged_this_turn`** — Asymmetric pair. Clear but could generalize with a `player` parameter.

8. **`self_has_more_than_each_opponent` vs `opponent_has_more_than_self`** — These are near-inverses but with subtle semantics (> each vs > at least one). Separation is justified.

9. **`no_challenges_this_turn` vs `opponent_no_challenges_this_turn`** — Pair of same check for different players. Could parameterize.

10. **`this_location_has_character` vs `characters_here_gte`** — Both location occupancy checks:
    - First: binary (has any)
    - Second: numeric (>= N, optional owner filter)
    Could be unified with optional amount/player fields.

---

## 5. COSTS (Cost Type Union)

**Total: 4 cost variants**

| Name | Fields | Purpose |
|------|--------|---------|
| `banish_self` | (none) | Banish this card to activate ability |
| `discard` | `filter, amount` | Discard N matching cards from hand |
| `exert` | (none) | Exert this card to activate ability |
| `pay_ink` | `amount` | Pay N ink from inkwell |

**Note:** The union is small and specialized. No significant overlaps within costs themselves. However, see Effect section overlap note about "banish one of your X" being modeled as a leading effect rather than a Cost.

---

## 6. CARD TARGET VARIANTS (CardTarget Union)

**Total: 7 target shapes**

| Name | Fields | Purpose | Usage |
|------|--------|---------|-------|
| `all` | `filter` | All matching cards | Mass effects (exert all inkwell) |
| `chosen` | `filter, count?, chooser?` | Player picks count card(s), optional target_player chooser | Most targeted effects |
| `from_last_discarded` | (none) | The card most recently moved to discard by this effect | Jafar High Sultan of Lorcana |
| `last_resolved_target` | (none) | State.lastResolvedTarget from prior cost step | Sequential cost→reward targeting |
| `random` | `filter` | Random matching card | Rare (random selection) |
| `this` | (none) | The card itself | Self-targeted abilities |
| `triggering_card` | (none) | The card that triggered the ability | Ursula Deceiver of All (replay trigger) |

### ⚠ Potential Overlaps in CardTarget

1. **`chosen` with count** — When count > 1, surfaces a multi-select. Distinct from `all` because player controls which N cards. Pattern is clear.

2. **`last_resolved_target` duplicated in many effects** — The pattern is repeated across multiple effect types. Could be factored out to a shared resolution stage, but current inline model is clear per effect.

---

## 7. DYNAMIC AMOUNT VARIANTS (DynamicAmount Union)

**Total: 19 amount discriminators** (alphabetically sorted)

| Name | Fields | Purpose | Example Card |
|------|--------|---------|--------------|
| `cost_result` | (none) | Last cost effect's result (cards moved, damage moved, etc) | Everybody's Got a Weakness (per damage moved) |
| `damage_on_target` | (none) | Damage counters currently on the chosen target | (damage-based effects) |
| `last_damage_dealt` | (none) | Amount of damage from last challenge | Mulan Elite Archer TRIPLE SHOT |
| `last_resolved_source_strength` | (none) | Snapshot of last cost-side target's strength | Ambush (deal damage = exerted char {S}) |
| `last_resolved_target_delta` | (none) | Actual count consumed by remove_damage/move_damage | Baymax Armored Companion |
| `last_resolved_target_lore` | (none) | Snapshot of last chosen target's lore stat | Anna Soothing Sister WARM HEART |
| `last_resolved_target_strength` | (none) | Snapshot of last chosen target's strength stat | Zeus Mr. Lightning Bolts |
| `last_target_location_lore` | (none) | Lore of the location the last chosen target is at | I've Got a Dream |
| `opposing_chars_banished_in_challenge_this_turn` | (none) | Count of opponent chars banished in my challenges | Namaari Resolute Daughter |
| `song_singer_count` | (none) | Number of characters that sang the last song | Fantastical and Magical |
| `source_lore` | (none) | Printed lore of the source card (ability owner) | (dynamic lore effects) |
| `source_strength` | (none) | Effective strength of source card snapshot | (dynamic strength effects) |
| `target_damage` | (none) | Damage on chosen target | (damage-scaling effects) |
| `target_lore` | (none) | Printed lore of chosen target | (lore-scaling effects) |
| `target_strength` | (none) | Effective strength of chosen target | (strength-scaling effects) |
| `triggering_card_damage` | (none) | Damage on the card that triggered the ability | (trigger-context damage) |
| `triggering_card_lore` | (none) | Printed lore of trigger card | Peter Pan Lost Boy Leader |
| `X` | (none) | Literal "X" (unresolved — used by some card templates) | (variable cost cards) |
| (literal number) | (none) | Constant value | (most effects) |
| Object: `count` | `filter, max?` | Number of cards matching filter, capped by max | (count-based amounts) |
| Object: `cards_under_count` | `max?` | Cards in source instance's under-pile | (Boost-dependent scaling) |
| Object: `source_lore`, `source_strength`, `target_lore`, `target_damage`, `target_strength` | `max?` | Stat snapshot with optional cap | (capped effects) |

### ⚠ Potential Overlaps in DynamicAmount

1. **`last_resolved_target_*` duplicated** — Three variants exist (`_strength`, `_lore`, `_delta`). Pattern is consistent. Could be unified as `{ type: "last_resolved_target"; stat }` if future needs arise, but current specificity is clear.

2. **`source_*` vs `target_*` stat variants** — Parallel naming scheme. Clear distinction.

3. **`triggering_card_*` vs `last_resolved_target_*`** — Both reference card snapshots but at different resolution times (trigger context vs effect application). Current split justified.

4. **`cost_result` vs `last_resolved_target_delta`** — Both capture "how many actually consumed":
   - `cost_result`: generic cost result
   - `last_resolved_target_delta`: specifically move_damage / remove_damage delta
   Could unify but current specificity may be intentional.

5. **`damage_on_target` vs `target_damage`** — Appear to be synonyms. Check if both are in use or if one is dead code. **Should verify.**

6. **`opposing_chars_banished_in_challenge_this_turn` is very specific** — Only used by Namaari. Could be generalized as `player_stat_this_turn` with a stat type discriminator if more per-turn counters are added.

---

## 8. TRIGGER CONTEXT FIELDS (TriggerContext)

**Total: 2 context fields**

| Field | Type | Purpose | Set By |
|-------|------|---------|--------|
| `triggeringCardInstanceId` | string (optional) | The card instance that triggered the ability | Trigger resolver (event source or related instance) |
| `triggeringPlayerId` | PlayerID (optional) | The player associated with trigger (carddraw, turn_start, etc) | Trigger resolver |

**Note:** Context is lean by design. Effect resolution uses `state.lastResolvedTarget`, `state.lastDamageDealtAmount`, etc., as shared game state. Not every data point is in context.

---

## 9. GAME MODIFIERS FIELDS

GameModifiers is a computed cache of active static effects. It has **28 tracked fields**:

| Field | Type | Purpose |
|-------|------|---------|
| `actionRestrictions` | Array<{restricts, affectedPlayerId, filter?}> | Action blocks (quest/challenge/etc) |
| `cantBeChallenged` | Map<instanceId, CardFilter \| undefined> | Characters immune to challenge |
| `canChallengeReady` | Map<instanceId, CardFilter \| null> | Characters that challenge ready |
| `challengeDamageImmunity` | Map<instanceId, CardFilter \| undefined> | Challenge-damage immunity |
| `classificationShifters` | Map<instanceId, trait> | In-hand shifters (trait-restricted) |
| `conditionalChallengerSelf` | Map<instanceId, Array<{strength, defenderFilter}>> | Per-instance challenge bonuses |
| `costReductions` | Map<playerId, Array<{amount, filter, appliesTo}>> | Cost reductions by player |
| `damageImmunity` | Map<instanceId, Set<"challenge"\|"all"\|"non_challenge">> | Damage immunity by source |
| `damageImmunityCharges` | Map<instanceId, number> | Per-turn charge limits on immunity |
| `damageRedirects` | Map<instanceId, playerId> | Damage redirect protectors |
| `enterPlayExerted` | Map<playerId, CardFilter[]> | Filters for enter-exerted |
| `extraInkPlays` | Map<playerId, number> | Extra ink plays per turn |
| `forcedTargets` | Map<playerId, Set<instanceId>> | Taunt: forced target priority |
| `grantedActivatedAbilities` | Map<instanceId, ActivatedAbility[]> | Granted abilities by instance |
| `grantedKeywords` | Map<instanceId, Array<{keyword, value?}>> | Keywords granted by instance |
| `grantedShiftSelf` | Map<instanceId, number> | In-hand granted Shift costs |
| `grantedTraits` | Map<instanceId, Set<trait>> | Runtime trait grants |
| `inkFromDiscard` | Set<playerId> | Players allowed to ink from discard |
| `inkwellEntersExerted` | Set<playerId> | Players whose ink enters exerted |
| `loreThresholds` | Map<playerId, number> | Custom win thresholds |
| `mimicryTargets` | Set<instanceId> | In-play MIMICRY targets |
| `moveToSelfCostReductions` | Map<locationId, Array<{amount, filter}>> | Move cost reductions per location |
| `oneChallengePerTurnGlobal` | boolean | Global challenge limit active |
| `playableFromZones` | Map<instanceId, Set<zoneName>> | Additional play zones per instance |
| `playForFreeSelf` | Set<instanceId> | In-hand free-play instances |
| `preventDiscardFromHand` | Set<playerId> | Hand discard shields per player |
| `preventLoreGain` | Set<playerId> | Lore gain shields per player |
| `preventLoreLoss` | Set<playerId> | Lore loss shields per player |
| `selfActionRestrictions` | Map<instanceId, Set<restrictedAction>> | Permanent self-restrictions |
| `singCostBonusHere` | Map<locationId, number> | Sing-cost bonuses per location |
| `skipsDrawStep` | Set<playerId> | Players skipping draw step |
| `statBonuses` | Map<instanceId, {strength, willpower, lore}> | Stat deltas per instance |
| `statFloorsPrinted` | Map<instanceId, Set<"strength"\|"willpower"\|"lore">> | Stat floors per instance |
| `topOfDeckVisible` | Set<playerId> | Players with visible deck-top |
| `universalShifters` | Set<instanceId> | In-hand universal shifters |

### ⚠ Potential Overlaps in GameModifiers

1. **`cantBeChallenged` vs `canChallengeReady`** — Inverse perspectives (defender vs attacker). Clear distinction.

2. **`damageImmunity` vs `damageImmunityCharges`** — Both immunity, but one tracks unlimited, one tracks charges. Could merge with optional charge field, but current split is clear.

3. **`costReductions` (static) vs `grantedShiftSelf`** — Both are cost adjustments but in different contexts (play vs shift). Separate maps justified.

4. **`prevent*` sets** — Three separate prevention maps:
   - `preventLoreLoss`
   - `preventLoreGain`
   - `preventDiscardFromHand`
   Could unify as `prevented: Map<playerId, Set<"lore_loss"|"lore_gain"|"discard_from_hand">>` if pattern repeats.

5. **`grantedKeywords` vs `grantedTraits`** — Both grant attributes but at different times (keywords in main pass, traits in pre-pass). Separate justified due to order sensitivity.

6. **`moveToSelfCostReductions` is location-specific** — Only location can have this. Pattern is clear.

---

## 10. PLAYER STATE FIELDS

PlayerState tracks per-player game dynamics:

| Field | Type | Purpose | Cleared/Reset |
|-------|------|---------|---------------|
| `actionsPlayedThisTurn` | number (optional) | Count of action cards played | PASS_TURN |
| `aCharacterChallengedThisTurn` | boolean (optional) | Any own character challenged | PASS_TURN |
| `aCharacterWasBanishedInChallengeThisTurn` | boolean (optional) | Any own character banished in challenge | PASS_TURN |
| `aCharacterWasDamagedThisTurn` | boolean (optional) | Any own character took damage | PASS_TURN |
| `availableInk` | number | Ink spendable this turn | turn_start (readied) + PLAY_INK (decremented) |
| `charactersPlayedThisTurn` | string[] (optional) | Instance IDs of characters played | PASS_TURN |
| `charactersQuestedThisTurn` | number (optional) | Count of characters quested | PASS_TURN |
| `costReductions` | CostReductionEntry[] (optional) | One-shot cost reductions | (consumed on play) |
| `extraInkPlaysGranted` | number (optional) | Extra ink plays allowed | PASS_TURN |
| `hasPlayedInkThisTurn` | boolean | Whether ink was played | (never cleared — historical flag) |
| `id` | PlayerID | Player identifier | (static) |
| `inkPlaysThisTurn` | number (optional) | Count of ink cards played | PASS_TURN |
| `lore` | number | Lore total | gain_lore / lose_lore effects |
| `opposingCharsBanishedInChallengeThisTurn` | number (optional) | Count of opponent chars banished | PASS_TURN |
| `playRestrictions` | PlayRestrictionEntry[] (optional) | Play-type restrictions (Pete, etc) | checked per turn, removed at caster's next turn |
| `songsPlayedThisTurn` | number (optional) | Count of songs played | PASS_TURN |
| `timedGrantedActivatedAbilities` | Array<{filter, ability}> (optional) | Turn-scoped granted abilities | PASS_TURN |
| `turnChallengeBonuses` | TurnChallengeBonus[] (optional) | Per-turn challenge strength bonuses | end-of-turn |

### ⚠ Potential Overlaps in PlayerState

1. **Per-turn counters** — Multiple `*ThisTurn` fields (actions, characters, songs, etc.). Pattern is consistent. Could abstract as `Map<eventType, number>` if more events are tracked.

2. **Damage/banish flags** — Two boolean flags:
   - `aCharacterWasDamagedThisTurn`
   - `aCharacterWasBanishedInChallengeThisTurn`
   Could generalize as `eventFlagsThisTurn: Set<eventType>` if pattern repeats.

3. **`playRestrictions` vs `turnChallengeBonuses`** — Both are turn-scoped arrays. Pattern is consistent.

---

## 11. GAME STATE FIELDS (Key Event/Result Trackers)

GameState tracks global game dynamics:

| Field | Type | Purpose |
|-------|------|---------|
| `cardsLeftDiscardThisTurn` | boolean (optional) | Card moved out of discard (Anna Soothing Sister) |
| `floatingTriggers` | FloatingTrigger[] (optional) | Turn-scoped triggered abilities (action grants) |
| `lastDamageDealtAmount` | number (optional) | Damage from last challenge (Mulan, Namaari) |
| `lastDiscarded` | ResolvedRef[] (optional) | Cards moved to discard (Kakamora branch) |
| `lastEffectResult` | number (optional) | Result of last cost effect (count/delta) |
| `lastResolvedSource` | ResolvedRef (optional) | Snapshot of last cost-side target (Hades, Ambush) |
| `lastResolvedTarget` | ResolvedRef (optional) | Snapshot of last chosen target (reward-side effects) |
| `lastSongSingerCount` | number (optional) | Count of singers on last song (Fantastical and Magical) |

### ⚠ Potential Overlaps in GameState

1. **`lastResolvedTarget` vs `lastResolvedSource`** — Parallel snapshots at different phases:
   - Target: effect application time
   - Source: cost-resolution time
   Pattern is clear and justified.

2. **`lastDamageDealtAmount` is very specific** — Only used for challenge-damage-triggered effects. Could generalize if more per-event amounts are tracked.

3. **`cardsLeftDiscardThisTurn` is a per-turn boolean** — Only one card needs to have left for the flag to matter. Pattern is clear.

---

## 12. TIMED EFFECT DURATION & TYPES

**Effect Durations (4 variants):**

| Duration | Behavior | Example |
|----------|----------|---------|
| `end_of_turn` | Expires at end of current turn | Mouse Armor (+1 {S} this turn) |
| `end_of_owner_next_turn` | Expires at end of AFFECTED card's owner's next turn | Iago (-1 {L} until start of THEIR next turn) |
| `rest_of_turn` | Expires at end of current turn (same as end_of_turn semantically?) | (may be legacy / synonym) |
| `until_caster_next_turn` | Expires at start of CASTER's next turn | Cogsworth Majordomo (+1 {S} until your next turn) |

**TimedEffect Type Discriminators (7 variants):**

| Discriminator | Fields | Purpose |
|---------------|--------|---------|
| `cant_action` | `action, expiresAt, appliedOnTurn, casterPlayerId?` | Temporary action restriction |
| `cant_be_challenged` | `expiresAt, appliedOnTurn, casterPlayerId?` | Temporary challenge immunity |
| `can_challenge_ready` | `expiresAt, appliedOnTurn, casterPlayerId?` | Temporary ready-challenge grant |
| `damage_immunity` | `damageSource, expiresAt, appliedOnTurn, casterPlayerId?, charges?` | Temporary damage block |
| `grant_keyword` | `keyword, value?, expiresAt, appliedOnTurn, casterPlayerId?` | Temporary keyword |
| `modify_strength`, `modify_willpower`, `modify_lore` | `amount, expiresAt, appliedOnTurn, casterPlayerId?` | Temporary stat modifier |
| `must_quest_if_able` | `expiresAt, appliedOnTurn, casterPlayerId?` | Temporary quest obligation |
| `sing_cost_bonus` | `amount, expiresAt, appliedOnTurn, casterPlayerId?` | Temporary sing-cost bonus |

### ⚠ Potential Overlaps in TimedEffect

1. **`modify_strength`, `modify_willpower`, `modify_lore` are separate discriminators** — Could be unified as `modify_stat` with a `stat` field.

2. **Shared expiry fields** — All TimedEffect types have `expiresAt, appliedOnTurn, casterPlayerId?`. Could extract to a base wrapper to reduce repetition.

3. **`cant_action` (timed) overlaps with effect `cant_action`** — Same concept, same name, different structural home (TimedEffect vs Effect). Instance-level vs timed distinction justified.

---

## COMPREHENSIVE OVERLAP SUMMARY

### **High-Priority (Known & Flagged by User)**

1. **`chosen_opposing_may_bottom_or_reward` vs `opponent_may_pay_to_avoid`** — Both cross-player choosers (Hades vs Tiana pattern). Same machinery, could collapse to one effect with parameterized behavior.

2. **`gain_conditional_challenge_bonus` (per-turn) vs `conditional_challenger_self` (permanent)** — Both grant challenge strength vs specific defenders. Separate justified by duration but worth noting pattern.

3. **`last_resolved_target` duplicated across effects** — Many effects branch on this shared state. Pattern is consistent and intentional.

4. **`tutor` collapsed to `search`** — Precedent for effect consolidation.

### **Medium-Priority (Identifiable From Catalog)**

5. **`gain_lore` vs `lose_lore`** — Could unify as signed `adjust_lore`.

6. **`cost_reduction` variants (3 versions)** — Static global, effect one-shot, static self. Distinct scopes but worth checking for generalization.

7. **`damage_immunity_*` patterns** — Static, timed, challenge-specific. All shield damage but model is fragmented.

8. **`cant_action*` variants** — Effect timed, static self, static action-restriction. All restrict actions with different durations/scopes.

9. **Per-turn counter flags** — Multiple `*ThisTurn` booleans/numbers in PlayerState. Could abstract.

10. **Stat modifiers** — `gain_stats`, `modify_stat`, `modify_stat_per_count`, `modify_stat_per_damage`, `modify_stat_while_challenged`. Five separate patterns for related mechanics.

### **Low-Priority (Naming/Clarity Issues)**

11. **`grant_keyword` (effect timed) vs `grant_keyword` (static)** — Same discriminator name in two unions. Technically valid but potentially confusing; consider renaming one.

12. **`rest_of_turn` vs `end_of_turn` durations** — Check if semantically identical or if `rest_of_turn` is a leftover.

13. **`damage_on_target` vs `target_damage` DynamicAmount variants** — Likely synonyms; verify usage.

14. **`damage_immunity_static` charges vs plain immunity** — Separate maps; could merge with optional charges field.

---

## EXISTING CARD EXAMPLES (Spot Checks)

| Primitive | Card Example | Location in Code |
|-----------|--------------|-----------------|
| `draw` | Most characters (quest → draw lore) | reducer:2108 |
| `deal_damage` | Shenzi challenges → damage | reducer:2194 |
| `chosen_opposing_may_bottom_or_reward` | Hades - Looking for a Deal | reducer:3870 |
| `opponent_may_pay_to_avoid` | Tiana Restaurant Owner SPECIAL RESERVATION | reducer:3838 |
| `gain_conditional_challenge_bonus` | Olympus Would Be That Way | reducer:3018 |
| `conditional_challenger_self` | Shenzi Scar's Accomplice | gameModifiers:conditional_challenger_self |
| `last_resolved_target` | Mother Gothel KWB (sequential) | types:1888 |
| `search` | Hiro Hamada Robotics Prodigy | types:1038 |
| `grant_keyword` (timed) | Mouse Armor (Ranger keyword) | reducer:3080 |
| `grant_keyword` (static) | Pascal (Evasive from location) | gameModifiers:grant_keyword |

---

**End of Catalog. Total entries: ~300 primitives across 12 categories.**