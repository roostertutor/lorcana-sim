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

## Diffing a new CRD revision

The CRD is a living document — Ravensburger publishes revisions periodically.
We keep two committed artifacts to make rules-revision review tractable:

  - `docs/Disney-Lorcana-Comprehensive-Rules-<DATE>-EN-Edited.pdf` — the PDF
    Ravensburger ships. Replaced wholesale on each revision.
  - `docs/CRD_SNAPSHOT.txt` — `pdftotext -layout` output of the PDF, with a
    self-documenting header (source PDF name, version, effective date,
    snapshot timestamp). Committed so `git diff` shows every line that
    changed across revisions.

**Workflow when a new CRD drops:**

1. **Drop the new PDF** into `docs/`. Filename pattern:
   `Disney-Lorcana-Comprehensive-Rules-<MMDDYY>-EN-Edited.pdf`. The script
   picks the lexicographically latest by filename, so date-suffixed names
   sort correctly. Optionally delete the old PDF.

2. **Regenerate the snapshot:**
   ```bash
   pnpm snapshot-crd
   ```
   Writes `docs/CRD_SNAPSHOT.txt` with the new version's text. Requires the
   `pdftotext` binary (Poppler / Glyph & Cog — included in mingw64; macOS:
   `brew install poppler`; Linux: `apt install poppler-utils`).

3. **Review the diff:**
   ```bash
   git diff docs/CRD_SNAPSHOT.txt
   ```
   Every changed rule shows up as a line-level diff, with section numbers
   preserved (the `-layout` flag keeps columns/indentation stable across
   revisions). Walk top-to-bottom and categorize each change:
   - **New rule** → Add a row to this tracker under the right section.
   - **Wording revision** → Update the existing row's `Quote` column;
     re-evaluate `Status` if the change might break an existing engine
     implementation.
   - **Status reclassification** (Ravensburger errata changing how a rule
     resolves) → Flip the engine row to `🐛` until the implementation is
     re-aligned, then ship a fix and flip back to `✅`.
   - **Renumbering** → Update rule citations in `packages/engine/src/`
     comments (search-and-replace) and in card-status / decompile docs.

4. **Update the header line** at the top of this file with the new version
   number and effective date. Bump the version cite in `CLAUDE.md` if
   anything in the "Critical bug patterns" section references a specific
   rule number that moved.

5. **Commit both** the new PDF and the regenerated snapshot together so the
   diff history shows the source-of-truth swap atomically.

The snapshot's header lines (prefixed with `#`) document provenance —
they're stable across revisions only when the source PDF actually changes,
so re-running `snapshot-crd` against the same PDF on a new day produces a
single one-line header diff that's easy to ignore (or `git checkout` if
you want to keep the original snapshot timestamp).

---

## How to verify a rule's implementation

When a row in this tracker says ✅, the verification path is:

1. **Read the engine code at the cited file:line.** Each ✅ row cites the
   reducer / utils / types path where the rule is implemented (e.g.
   `runGameStateCheck` for §1.8.1.4, `getEffectiveLore` for §1.11.2). Read
   the handler end-to-end — handler existence is not correctness (see
   CLAUDE.md "Handler existence is not correctness").

2. **Run the tests that exercise it:**
   ```bash
   pnpm test                                # all engine tests (759 currently)
   cd packages/engine && pnpm test setN.test.ts  # set-N specific
   ```
   Rule-level tests live in `reducer.test.ts` (organized by §1, §2, §3,
   etc.). Card-level behavioral tests in `setN.test.ts`. Cross-cutting
   regressions in `mech-gaps-batch.test.ts`.

3. **Audit card data quality** for cards that depend on the rule:
   ```bash
   pnpm card-status                          # JSON field validation; 0 invalid is the bar
   pnpm decompile-cards --top 50             # render JSON ability → English; bottom-of-list = bug list
   pnpm decompile-cards --set 010            # one set
   ```
   `card-status` catches typos in trigger / condition / effect
   discriminators that would silently no-op. `decompile-cards` catches
   wiring bugs by rendering each card's JSON back to oracle-shape English
   and scoring against the printed `rulesText`. The bottom of the sorted
   output is the bug list — see CLAUDE.md "Triage precedence" for the
   distinction (card-status flags are real; decompile flags are noisy).

4. **Inspect the live primitive inventory:**
   ```bash
   pnpm catalog                              # writes docs/ENGINE_PRIMITIVES.md
   ```
   Lists every effect / condition / trigger / cost / static-effect type
   currently in the type unions. If you're trying to wire a card and a
   primitive seems missing, check here first — it's often there under a
   different name.

5. **Find precedents** before claiming a card is wired correctly:
   ```bash
   pnpm find-precedent "<substring>"
   ```
   REQUIRED before citing any card by name in proposals (see CLAUDE.md
   "Card-claim discipline"). Returns `file:line — fullName` results
   suitable for verbatim citation.

For ⚠️ rows: the inline note describes what's partial. For ❌ rows: a
new effect/condition/static type or PendingChoice variant is needed —
search this tracker's bottom sections for the open-ended TODO list.

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
| 1.5.4 | A cost can't be changed; payment modifiers affect only the amount paid, not the cost itself | ⚠️ Implicit — Singer/cost_reduction modify amount paid, not card.cost. No explicit "cost vs payment" tracking. |
| 1.5.5 | Alternate costs (Shift, Singer, Sing Together, "for free") | ✅ All four alternate cost types implemented. Shift: ink (`shiftCost`) + altShiftCost discard variant (Diablo, Flotsam & Jetsam). Singer: `singerInstanceId` skips ink. Sing Together: `singerInstanceIds[]` aggregate-cost validator (8.12). "For free": `play_for_free` Effect + `grant_play_for_free_self` static (Mufasa, Pride Lands, Belle, etc.). |
| 1.5.5.1 | Singing a song is an alternate cost | ✅ `singerInstanceId` skips ink deduction |
| 1.5.5.2 | Shift is an alternate cost | ✅ |
| 1.5.5.3 | "For free" means ignore all costs | ✅ `play_for_free` effect + `grant_play_for_free_self` static with optional `playCosts`. |

### 1.6 Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 1.6.1 | Abilities apply only when source is in play (with exceptions) | ✅ Trigger fizzle logic in `processTriggerStack`. Exceptions (fire after leaving play): `is_banished`, `leaves_play`, `banished_in_challenge`, `banished_other_in_challenge` (per 4.6.6.2 — simultaneous damage means attacker banished another even if also banished), `is_challenged`, `challenges`. |
| 1.6.1.1 | Triggered abilities | ✅ |
| 1.6.1.2 | Activated abilities | ✅ |
| 1.6.1.3 | Static abilities | ✅ 40+ static effect types in `StaticEffect` union: grant_keyword, modify_stat (+ per_count, per_damage, while_challenged), cost_reduction, self_cost_reduction, action_restriction, cant_action_self, extra_ink_play, can_challenge_ready, damage_redirect, damage_prevention, challenge_damage_prevention, grant_activated_ability, grant_triggered_ability, grant_play_for_free_self, grant_shift_self, universal_shift_self, classification_shift_self, mimicry_target_self, playable_from_zone_self, modify_win_threshold, skip_draw_step_self, top_of_deck_visible, move_to_self_cost_reduction, global_move_cost_reduction, enter_play_exerted, stat_floor_printed, sing_cost_bonus_here, sing_cost_bonus_characters, grant_trait, conditional_challenger_self, inkwell_enters_exerted, prevent_lore_loss, prevent_lore_gain, forced_target_priority, remove_named_ability, remove_keyword, prevent_discard_from_hand, one_challenge_per_turn_global, ink_from_discard, deck_rule, all_hand_inkable, prevent_damage_removal, grant_keyword_while_being_challenged, restrict_remembered_target_action, cant_be_challenged_exception. Conditional statics via `condition` field on StaticAbility + `evaluateCondition()`. |
| 1.6.1.4 | Replacement effects | ✅ Multiple patterns shipped — see 6.5 for detailed sub-rule status. `damage_redirect` (Beast), `damage_prevention_static` (Baloo / Hercules / Lilo Bundled Up — incl. `chargesPerTurn:1` for "first time" semantics), `damage_prevention_timed` (Rapunzel Ready for Adventure — `charges:1` for "next time"), `challenge_damage_prevention` (Raya), `self_replacement` (48 cards). Vanish (8.14) is NOT a replacement effect — it's a triggered ability. |
| 1.6.1.5 | Keywords | ✅ Most set 1 keywords implemented |

### 1.7 Game Actions, Timing, and Illegal Actions
| Rule | Quote | Status |
|------|-------|--------|
| 1.7.2 | Effects must fully resolve before next can happen | ✅ Each effect fully resolves (or surfaces pendingChoice) before next. Challenge damage is simultaneous per CRD 4.6.6.2. Trigger bag processes one at a time. |
| 1.7.3 | "Choose one of" — general semantics for independent modal effects | ✅ Routed through `ChooseEffect` primitive; resolution details at 6.1.3. Distinct from 6.1.5.2 "[A] or [B]" modals where the backup rule can force a specific branch — see that entry for the subset of cards where option-infeasibility matters. |
| 1.7.5 | **Drying**: characters can't quest/challenge/exert unless in play since beginning of their player's turn | ✅ `isDrying` boolean; Rush bypasses for challenges only |
| 1.7.6 | Illegal action: undo all steps, payments reversed | ⚠️ We return `success: false` and don't mutate state, but don't log "undo". Open question: would undo help bot learning? See DECISIONS.md Open Questions |

### 1.8 Game State Check
| Rule | Quote | Status |
|------|-------|--------|
| 1.8.1.1 | Player with 20+ lore wins | ✅ `runGameStateCheck` + `getLoreThreshold`. Win threshold modification via `modify_win_threshold` StaticEffect (Donald Duck Flustered Sorcerer). |
| 1.8.1.2 | Player who ends turn with empty deck loses | ✅ Checked in `applyPassTurn`; game ends immediately with opponent as winner |
| 1.8.1.4 | Character/location with damage >= willpower is banished | ✅ `runGameStateCheck` (reducer.ts:7870) scans every card in play each pass; called after every turn action, effect resolution, challenge declaration, and timed-effect expiry |
| 1.8.2 | Triggered abilities from state check added to bag before resolving | ✅ `evaluateCondition()` checks `trigger.ability.condition` before resolving effects in `processTriggerStack()`. Supports `characters_in_play_gte`, `cards_in_hand_eq`, lore conditions. Tested with Stitch - Carefree Surfer, Beast's Mirror |
| 1.8.3 | Game state check cascades — repeats until no new conditions met (e.g., location banish → character loses {W} buff → character banished too) | ✅ `runGameStateCheck` runs an explicit `while (changed)` loop — each pass rescans willpower-vs-damage for all in-play cards, plus lore threshold. Terminates when a pass produces no new banishes. |
| 1.8.4 | Multiple conditions met simultaneously → single check, all results occur simultaneously; multi-player: in turn order | ⚠️ Banishes within a single loop pass happen in object-iteration order, not truly parallel. Matches 2P behavior in practice; a strict simultaneous implementation would matter if a 3+P variant ever ships or if a "leaves play together" trigger (CRD 7.4.3) is sensitive to order within the same pass. No current card exposes this. |

### 1.9 Damage
| Rule | Quote | Status |
|------|-------|--------|
| 1.9.1 | Damage represented by damage counters; each counter = 1 damage; can be dealt/put/removed/moved/taken | ✅ Damage counters tracked on `CardInstance` as `damage: number` |
| 1.9.1.1 | Deal/Dealt – placing damage counters during a challenge or from an effect that deals damage | ✅ `deal_damage` effect + challenge damage in reducer |
| 1.9.1.2 | Put – placing damage counters from an effect that puts damage on a character/location | ✅ `ignoreResist: true` parameter on `dealDamageToCard` bypasses Resist for "put" damage (CRD 8.8.3). Beast damage_redirect uses `ignoreResist` since it "puts" counters. |
| 1.9.1.3 | Remove/Removed – taking damage counters off as a result of an effect that removes damage | ✅ `remove_damage` effect (being renamed from "heal" to match CRD terminology) |
| 1.9.1.4 | Move – taking damage counters off one character/location and placing on another | ✅ `move_damage` effect with `from`/`to` CardTargets. 29 uses across sets. |
| 1.9.1.5 | Take – a character/location takes damage whenever damage is dealt to, put on, or moved to it | ⚠️ Implicit — any damage placement triggers "takes damage" but no explicit tracking |
| 1.9.2 | "Is damaged" / "was damaged" / "is dealt damage" / "was dealt damage" all mean "takes damage" for printed text | ✅ All four phrasings covered by distinct primitives that compose to the same semantic: `hasDamage` filter (state predicate), `damage_dealt_to` trigger (event), `damage_removed_from` trigger (event), `aCharacterWasDamagedThisTurn` PlayerState flag (turn-history condition — Devil's Eye Diamond, Brutus Fearsome Crocodile). The CRD's wording-equivalence claim is enforced by which primitive each card's wiring chooses — no separate "takes damage" abstraction needed. |
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
| 1.12.3 | "Put into hand" is not "drawing" | ✅ `return_to_hand` effect uses zone-transition `reason: "returned"`; `card_drawn` GameEvent + `card_drawn` TriggerEvent fire only on `reason: "drawn"`. Verified at reducer.ts:7501 (event push gate) and 2240 (trigger queue). "Mother Knows Best" / "Pull a Fast One" / look_at_top "may put into your hand" all use put-into-hand semantics that don't fire draw triggers. |

---

## 2. GAMEPLAY

### 2.1 Series / Match Structure
| Rule | Quote | Status |
|------|-------|--------|
| 2.1.3.2 | Best-of-N play-draw rule: losing player chooses to start or not | ✅ `choose_play_order` PendingChoice fired from the `play_order_select` phase at game start. `GameConfig.chooserPlayerId` (default `player1`) controls who chooses. Engine resolves choice → sets `firstPlayerId`/`currentPlayer`, transitions to mulligan with correct starting-player-first order. Tested in `play-draw.test.ts`. Server-side Bo3 loser-slot-swap is the follow-on. |

### 2.2 Setup Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.2.1.3 | Each player begins with 0 lore | ✅ `createGame` initializer |
| 2.2.1.4 | Each player draws 7 cards (opening hand) | ✅ Tested: "deals 7 cards to each player" |
| 2.2.2 | Players may alter their opening hand (mulligan) | ✅ Partial Paris mulligan in simulator. Generic `shouldMulligan`/`performMulligan` on BotStrategy. Mulligan ordering keyed off `firstPlayerId` (CRD 2.2.2: starting player mulligans first) so the play-draw choice feeds through correctly. |

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
| 3.2.1.2 | "During your turn" effects start applying | ✅ Implemented via `is_your_turn` condition on StaticAbility. Dozens of cards use `"condition": { "type": "is_your_turn" }` to gate effects to the controller's turn. |
| 3.2.1.3 | "Start of your turn" / "start of your next turn" effects end | ✅ `until_caster_next_turn` duration expires at start of caster's next turn; `end_of_owner_next_turn` expires at end of affected card's owner's next turn. Both handled in `applyPassTurn` timedEffects expiry. |
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
| 3.4.2 | Final game state check at turn end | ✅ `runGameStateCheck` is called in `applyPassTurn` (reducer.ts:2143) after the end-of-turn trigger pass, before the turn transitions to the next player. The same GSC also runs after every effect resolution (lines 218 / 1369 / 1567) — the end-of-turn call is the explicit final pass to catch lethal-damage banishes from end-of-turn triggers. |

---

## 4. TURN ACTIONS

### 4.2 Ink a Card
| Rule | Quote | Status |
|------|-------|--------|
| 4.2.1 | Declare intent, reveal inkable card, put into inkwell ready | ✅ `PLAY_INK` action |
| 4.2.3 | Limited to once per turn | ✅ `inkPlaysThisTurn` counter (replaced boolean to support extra ink plays) |
| 4.2.3.1 | Effects can allow additional cards into inkwell (Belle – Strange But Special) | ✅ `ExtraInkPlayStatic` + `extraInkPlaysGranted` + `inkPlaysThisTurn` counter. Belle supported. |
| 4.2.3.2 | Some effects put cards into inkwell bypassing once-per-turn rule (Fishbone Quill) | ✅ `put_into_inkwell` Effect bypasses the PLAY_INK once-per-turn check entirely. Wired on Fishbone Quill GO AHEAD AND SIGN ({E} — Put any card from your hand into your inkwell facedown), Razoul Wickedly Loyal, etc. The effect routes through `applyEffect` not `applyPlayInk`, so `inkPlaysThisTurn` isn't incremented. |

### 4.3 Play a Card
| Rule | Quote | Status |
|------|-------|--------|
| 4.3.1 | Play card from hand, announce and pay cost | ✅ |
| 4.3.2 | Can normally be played only from hand | ✅ Validated. Mufasa exception will use effect system |
| 4.3.3.1 | Characters/items/locations enter Play zone; Shift goes on top of named card | ✅ Characters, items, and locations all enter play zone. Shift implemented with cardsUnder stack. |
| 4.3.3.2 | Actions enter Play zone, effect resolves immediately, then move to discard | ✅ `applyPlayCard` action branch; `pendingActionInstanceId` for deferred choices |
| 4.3.4.1 | "When [Player] play(s) this" triggered conditions met as card enters play | ✅ `queueTrigger("enters_play", ...)` |
| 4.3.5 | Payment modifiers (e.g., Singer) don't change the card's ink cost | ✅ Singer implemented; `singerInstanceId` path |
| 4.3.6 | Payment modifiers: "next [Type] you play" applies even if alternate cost used; self-referential modifiers (from hand) vs non-self (from play); classification-specific modifiers skip non-matching plays | ⚠️ Self-referential (`self_cost_reduction`) works from hand. Non-self cost_reduction works from play. Classification filtering implemented. But "next character" one-shot consumption may not skip non-matching types correctly in all cases. |

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
| 4.6.7 | After challenge damage + bag resolution: "while challenging"/"while being challenged" effects end; "after the challenge" triggers fire | ✅ (in-challenge banish window) / ⚠️ (after-the-challenge triggers). `state.activeChallengeIds` is set when a challenge begins and cleared once `processTriggerStack` drains the bag, so any banish of the attacker/defender during bag resolution still fires `banished_in_challenge` per CRD Example B (Cheshire LOSE SOMETHING? → Marshmallow's DURABLE returns him to hand). `while_challenging` stat modifiers (Challenger) still applied only during damage calc; "after the challenge" triggers not yet separated from challenge-end. |
| 4.6.9 | Character removed from challenge → challenge ends early; remaining triggers resolve, then "while" effects end | ✅ `applyChallenge` checks both combatants' zones AFTER Declaration triggers resolve (reducer.ts:1378-1382): if either combatant left play during declaration triggers (e.g. Puny Pirate banished the defender), the damage step is skipped. Tested via the Puny Pirate self-banish-on-challenged regression in setN tests. |
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
| 5.2.6.1 | Some characters have two names (&); each name is searchable independently (Flotsam & Jetsam = "Flotsam", "Jetsam", "Flotsam & Jetsam") | ✅ `alternateNames: string[]` on CardDefinition. `matchesFilter` checks both `name` and `alternateNames`. |
| 5.2.6.3 | Chip 'n' Dale treated as if it has ampersand | ⚠️ No special case for Chip 'n' Dale — would need `alternateNames: ["Chip", "Dale"]` on that card |
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
| 5.4.5 | "Reveal" as CRD timing-exception marker — when a card is played from a private zone (hand) outside the controller's normal main-phase action structure (e.g. another player's turn, or mid-trigger resolution), oracle uses "reveal X and play it" wording. The reveal is the controller's public commitment to the chosen card | ✅ `PlayCardEffect.revealed: boolean` shipped 2026-04-30 (commit `1f21813`). When set, the engine emits a `card_revealed` GameEvent for the chosen instance just before the zone transition (hand → play), citing playerId + sourceInstanceId. **The Return of Hercules** is the only card in the corpus with this exact shape (each_player isMay → play_card sourceZone:hand revealed:true). Distinct from `reveal_top_conditional` (Mulan Reflecting, Mufasa Betrayed Leader, Let's Get Dangerous) which handles random-deck-reveal-with-conditional-play and emits its own card_revealed events. Future-proof for any "watches off-timing plays" trigger Lorcana might introduce — TROH already fires the event without needing JSON refactor. |

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
| 6.1.3 | Choices made as effect resolves — "Choose one: • A • B" with independent options (fizzle-on-resolution OK) | ✅ `pendingChoice` / `RESOLVE_CHOICE`. Interactive mode surfaces `choose_option` PendingChoice; non-interactive auto-picks first feasible option. Cards with this shape: **Pull the Lever!** (set 8 / P2), **Wrong Lever!** (set 8), **Trust In Me** (set 10), **Make the Potion** (set 4 / set 9). Each branch is always choosable — draw-into-empty-deck or target-none scenarios just fizzle mid-resolution; the player can still pick the branch. Distinct from 6.1.5.2 where the backup rule can genuinely force a branch. Regression 2026-04-22 (e1bdb84): `choose_option` RESOLVE path now calls `cleanupPendingAction` so action cards move to discard after the choice resolves. |
| 6.1.3a | Dynamic effect amounts (equal to a stat, count, or cost) | ✅ `DynamicAmount` union — 16+ variants: `cost_result`, `triggering_card_lore`, `triggering_card_damage`, `last_target_location_lore`, `last_resolved_target_delta`, `last_resolved_source_strength`, `song_singer_count`, `last_resolved_target_lore`, `last_resolved_target_strength`, `last_damage_dealt`, `unique_ink_types_on_top_of_both_decks`, `opposing_chars_banished_in_challenge_this_turn`, plus structured `{ type: "count" \| "target_lore" \| "target_damage" \| "target_strength", ... }` |
| 6.1.4 | "May" = optional; choosing not to has no effect | ✅ `isMay` flag on effects; `choose_may` PendingChoice; accept/decline flow in processTriggerStack |
| 6.1.4a | "Choose any number of [players/targets]" — controller selects a subset (including empty) | ✅ Multi-select chooser shipped 2026-04-30 (commit `d16d379`) for the player-subset case. `EachPlayerEffect.scope: "chosen_subset"` surfaces a `choose_players_subset` PendingChoice to the caster with all players selectable; CRD 6.1.4 "any number" allows the empty selection (`optional: true`). Resolver populates `_iterations` with the picked subset and re-applies. **Beyond the Horizon** is the only card in the corpus with this wording. UI branch in `PendingChoiceModal.tsx`. 5 reducer tests in `set5-set8.test.ts`. (For "any number of chosen X" target chooser — Heads Held High, Leviathan, etc. — that uses the existing `count: "any"` field on `chosen` CardTarget, not this new primitive.) |
| 6.1.5.1 | Sequential effects: [A] to [B] — cost must resolve before reward | ✅ `SequentialEffect` with `costEffects[]` → `rewardEffects[]`; `canPerformCostEffect()` pre-check. `triggeringCardInstanceId` must be forwarded through `applyEffect` and stored on `choose_may` PendingChoice — see CLAUDE.md critical bug patterns |
| 6.1.5.2 | Sequential "[A] or [B]" — player must choose one; if [A] can't be chosen, must choose [B] | ✅ `ChooseEffect` with `options: Effect[][]` — same primitive as 6.1.3, but here `canPerformChooseOption()` can return false when an option has a hard gate (no legal target, cost that can't be paid). The runtime forces the other branch; interactive UI hides the infeasible option. Cards where the backup rule genuinely fires (option can be unchoosable, not just fizzle-on-resolution): **Madam Mim - Snake** (JUST YOU WAIT — "banish her or return another chosen character of yours" forces banish when you control no other characters), **Megara - Captivating Cynic** (SHADY DEAL — "choose and discard a card or banish this character" forces self-banish with an empty hand), **Containment Unit** (POWER SUPPLY — same "discard or banish this item" shape). Contrast with 6.1.3 cards whose options only fizzle-on-resolution. |
| 6.1.7 | "For free" = ignore all costs | ✅ Same as 1.5.5.3. |
| 6.1.8 | "For each" — defines single number used in subsequent effect | ✅ `lastEffectResult` on GameState; `amount: "cost_result"` on DrawEffect |
| 6.1.11 | "That" in card text references specific card mentioned earlier; if "that" card changed zones, effect fails (6.1.11.1) | ✅ `rememberedTargetIds` on CardInstance tracks specific instances (Elsa's Ice Palace, Containment Unit). `lastResolvedTarget` snapshots card for follow-up effects. Zone checks in effect resolution paths naturally fail if card left play. Ursula Deceiver uses `thenPutOnBottomOfDeck` which checks card is still in discard. |
| 6.1.12 | Some abilities apply outside play zone (from hand) | ✅ `SelfCostReductionStatic` checked at play time from hand |
| 6.1.13 | Duration mechanics: "this turn", "end of turn", etc. | ✅ `timedEffects[]` with `expiresAt: end_of_turn / rest_of_turn / end_of_owner_next_turn`. Expiry in applyPassTurn. "Once per turn" supported via `oncePerTurn?: boolean` flag on TriggeredAbility + ActivatedAbility, tracked via `oncePerTurnTriggered` map on CardInstance. "Once during your turn" = `oncePerTurn` + `condition: { type: "is_your_turn" }`. |

### 6.2 Triggered Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.2.1 | Trigger fires once per condition met | ✅ |
| 6.2.3 | Triggered abilities go to bag (our: `triggerStack`) | ✅ |
| 6.2.4 | Secondary "if" condition checked when effect resolves (not when triggered) | ✅ `evaluateCondition()` called in processTriggerStack before resolving effects. 20+ condition types supported including: self_stat_gte, compound_and, songs/actions_played_this_turn_gte, this_has_no_damage, not, played_via_shift, triggering_card_played_via_shift, cards_in_zone_gte (with cardType filter), has_character_with_trait (with excludeSelf). See CARD_ISSUES.md. |
| 6.2.7.1 | Floating triggered abilities (created by resolving effects; last a duration) | ✅ `floatingTriggers[]` on GameState. `CreateFloatingTriggerEffect` creates them; cleared at end of turn. Checked during event dispatch. |
| 6.2.7.2 | Delayed triggered abilities (fire at a specific later moment) | ✅ `delayedTriggers[]` on GameState. `CreateDelayedTriggerEffect` stores them; resolved at end_of_turn or start_of_next_turn in applyPassTurn. Fizzle if target left play. Candy Drift wired + tested. |

### 6.3 Activated Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.3.1.1 | {E} ability on character requires dry character | ✅ |
| 6.3.1.2 | Item/location activated ability usable turn played | ✅ |

### 6.4 Static Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.4.1 | Active while card in play | ✅ `getGameModifiers()` scans in-play cards |
| 6.4.2.1 | Continuous static from resolved effect affects all matching cards (including newly played) | ✅ `globalTimedEffects[]` on GameState. Effects with `continuous: true` store a GlobalTimedEffect; `getGameModifiers` applies to all matching cards. Restoring Atlantis wired + tested. |
| 6.4.2.2 | Applied static from resolved effect affects only cards in play at resolution time | ✅ Default behavior — per-card `timedEffects` only affect the specific card instances they're attached to. |
| 6.4.2.3 | Continuous static from card in play loses effect when card leaves play | ✅ `getGameModifiers()` recalculates on every call |
| 6.4.3 | Conditional static abilities — apply only when condition met | ✅ `condition` field on StaticAbility; `evaluateCondition()` called in gameModifiers.ts before applying |
| 6.4.5 | "Skip [Step/Phase]" effects — the skipped step/phase doesn't happen; abilities from it don't fire | ✅ `SkipDrawStepSelfStatic` implemented for Arthur — skips Draw step in applyPassTurn |

### 6.5 Replacement Effects
| Rule | Quote | Status |
|------|-------|--------|
| 6.5.1 | Replacement effects wait for a condition and partially/completely replace the event as it resolves | ✅ Multiple patterns implemented: `damage_redirect` (Beast), `damage_prevention_static` (Baloo, Hercules, Lilo — incl. `chargesPerTurn`), `challenge_damage_prevention` (Raya), `self_replacement` (48 cards). No single unified "general replacement system" — each pattern is a distinct effect/modifier — but every card that needs one is wired. |
| 6.5.1.1 | Abilities with "instead" are the most common type | ✅ `SelfReplacementEffect` handles conditional "do X instead" patterns uniformly: `effect: []` default branch, `instead: []` replacement branch, `condition: CardFilter \| Condition`. Turbo Royal Hack, Hidden Trap BLINDING CLOUD, Consult the Spellbook all wired this way. |
| 6.5.4 | Replaced events never happen; their triggers don't fire | ❌ Not enforced — `damage_redirect` and `damage_prevention_static` still fire damage-dealt/damage-taken triggers on the redirected path. Works for current cards because no card's trigger is "damage would be dealt" in a way that conflicts. |
| 6.5.6 | Self-replacement effects (within same ability) always apply first | ✅ `SelfReplacementEffect` — condition evaluated at resolution time, branches are mutually exclusive, always apply before cross-card replacements can see the event. Tested in `dynamic-amount.test.ts`, `set4.test.ts`, `set5-set8.test.ts`, `set12.test.ts`. |
| 6.5.7 | Multiple replacement effects: affected player chooses order | ❌ Not implemented — no current card pair has two replacements competing on the same event. Would matter if, say, two bodyguard-style redirects existed simultaneously. |
| 6.5.8 | Same replacement effect can't apply twice to same event | ❌ Not implemented — same applicability condition as 6.5.7. `damage_prevention_static` with `chargesPerTurn:1` (Lilo) independently enforces once-per-turn via its own charge counter, not via 6.5.8's general rule. |

### 6.6 Ability Modifiers
| Rule | Quote | Status |
|------|-------|--------|
| 6.6.1 | Ability modifiers restrict actions for a duration or while source in play | ✅ Unified query `isActionRestricted()` checks both `TimedEffect` (per-card debuffs) and `ActionRestrictionStatic` (board-level rules). `RestrictedAction` type covers quest/challenge/ready/play/sing. |
| 6.6.2 | Negative {S} deals no damage during challenges; counts as having Strength of 0 | ✅ `Math.max(0, ...)` in `getEffectiveStrength` |
| 6.6.3 | Negative Lore value {L} counts as having Lore value of 0 | ✅ `Math.max(0, ...)` in `getEffectiveLore` |
| 6.6.4 | "Can't be reduced below" specified value — characteristic floor after all modifiers | ✅ `StatFloorPrintedStatic` |

### 6.7 Resolving Cards and Effects
| Rule | Quote | Status |
|------|-------|--------|
| 6.7.6 | If ability references card characteristic but card left play → use last known value | ✅ `lastResolvedTarget`/`lastResolvedSource` snapshot card stats (strength, lore, damage, ownerId) at choose-target time. DynamicAmount variants (`last_resolved_target_strength`, `last_resolved_source_strength`, etc.) read these snapshots. Covers all current cards. |
| 6.7.7 | Playing a card during resolution — sub-card's effects wait until parent finishes resolving (6.7.7.1: sub-action's effect resolves after parent but before bag) | ✅ `play_for_free` resolves inline during parent action. Sub-card triggers go to bag. `pendingEffectQueue` resumes remaining parent effects after sub-card's pending choices resolve. Bag processes after all effects complete. |

---

## 7. ZONES

### 7.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 7.1.4 | Private zone search: player may fail to find. Public zone search: must find if able | ⚠️ `search` effect (tutor) allows "up to N" — player can choose 0 from deck (private). Discard search doesn't enforce must-find for public zone. |
| 7.1.5 | Card exists in only one zone at a time | ✅ Layer 3 invariant test |
| 7.1.6 | When card leaves play, gained effects/damage removed; becomes "new" card | ✅ `zoneTransition` reset block clears: damage, isExerted, isDrying, temp stat modifiers, grantedKeywords, timedEffects, atLocationInstanceId, movedThisTurn, oncePerTurnTriggered, playedViaShift, challengedThisTurn. |

### 7.4 Play
| Rule | Quote | Status |
|------|-------|--------|
| 7.4.1 | Characters/items/locations can be in Play zone | ✅ All three card types can be in play zone. |
| 7.4.3 | When 1+ cards leave play, triggered abilities "see" other cards leaving simultaneously (Lyle Rourke: "whenever one of your other characters is banished" fires for each other character banished at the same time) | ✅ `is_banished` triggers fire per-card per CRD 1.6.1 exceptions (fire even after card left play). Lyle Rourke + Be Prepared works: each banish queues its triggers, Lyle's ability fires for each other character banished. Triggers are processed after all banishes complete. |

### 7.7 Bag
| Rule | Quote | Status |
|------|-------|--------|
| 7.7 | Triggered abilities queue in bag; resolved in order | ✅ `triggerStack` in `GameState` |
| 7.7.4 | Bag resolution order: active player resolves first, then passes to next player in turn order | ✅ triggerStack sorted: active player's triggers first (stable sort preserves within-player order). Interactive mode surfaces choose_trigger for manual ordering. |
| 7.7.5 | Trigger added by currently resolving player → seen by next bag check, can resolve next | ✅ Triggers queued during resolution are appended to triggerStack and processed on next iteration. |
| 7.7.6 | Trigger added by non-resolving player → waits until that player's turn to resolve from bag | ⚠️ 2-player only — active player resolves first (7.7.4), then opponent. New triggers from opponent during active player's resolution do wait. Multiplayer bag-passing not implemented. |

---

## 8. KEYWORDS

### 8.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 8.1.2 | Non-+N keywords don't stack; +N keywords stack | ✅ +N keywords (Challenger, Resist, Singer) stack via `getKeywordValue` summation. Non-+N keywords (Ward, Evasive, Rush, Bodyguard, etc.) are boolean — `hasKeyword` returns true regardless of count, so no double benefit. |

### 8.2 Alert (first appears Set 10, affects ~20–30 cards across sets 10–11)
| Rule | Quote | Status |
|------|-------|--------|
| 8.2.1 | Alert: this character can challenge as if they had Evasive (ignores Evasive restriction on defenders) | ✅ `alert` in Keyword union. Validator allows Alert attackers to challenge Evasive defenders. Timed grant supported. |
| 8.2.2 | Alert doesn't grant Evasive — character can still gain Evasive from another ability/effect | ✅ Alert only bypasses Evasive restriction; does not add Evasive keyword. Separate Evasive grant still works. |

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
| 8.4.2a | Player-wide "you've put a card under one of your characters or locations this turn" — tracked separately from the per-instance `cardsPutUnderThisTurn` counter for cards whose ability scope is the whole player, not a specific character | ✅ Shipped 2026-04-30 (commit `d99a70f`). New `PlayerState.youPutCardUnderThisTurn?: boolean` flag — set on the SOURCE owner at both put-under increment sites (`applyBoostCard` and the `put_top_card_under` effect handler), reset on PASS_TURN for both players. New Condition `you_put_card_under_this_turn` reads it. **Mulan - Standing Her Ground** FLOWING BLADE is the only consumer ("if you've put a card under one of your characters or locations this turn, this character takes no damage from challenges"). Pre-fix the wiring used the per-instance `this_had_card_put_under_this_turn` condition which only fired when Mulan herself accumulated a card-under — the player-wide variant fixes the common gameplay case where the put-under target is a different character (Cheshire Cat / Merlin / Bambi). 3 reducer tests in `set9-set11.test.ts`. |

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
| 8.10.3 | If shifted character's own effect causes it to enter exerted (e.g., Bodyguard), it enters exerted even if base was ready | ⚠️ Bodyguard exert is a post-play choice (`choose_may`), not an enter-play state override. If player chooses to exert via Bodyguard after shifting onto a ready character, that works. But CRD says it "becomes exerted as it enters play" — timing may differ. |
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
| 8.14.1 | Vanish: triggered ability — "When this character is chosen by an opponent as part of resolving an action's effect, banish this character." | ✅ RESOLVE_CHOICE handler banishes when chosen target is opposing + has Vanish keyword + `srcDef.cardType === "action"` (2026-04-22 fix: previously fired on ability-sourced choices too, violating CRD's "action's effect" scope). The broader `chosen_by_opponent` trigger keeps firing on BOTH actions and abilities — correct for Archimedes Exceptional Owl ("chosen for an action or ability"). Regression test: `mech-gaps-batch.test.ts` covers both cases. |

### 8.15 Ward
| Rule | Quote | Status |
|------|-------|--------|
| 8.15.1 | Ward: opponents can't choose this card when resolving an effect | ✅ Tested (choice resolution + targeting) |
| 8.15.2 | Effects that don't require choosing still affect Ward characters | ✅ Challenge works on Ward characters (tested) |

---

## Open CRD gaps (forward-looking)

Rule citations that remain ❌ or ⚠️ in the row-by-row tables above. Cross-
referenced against CRD v2.0.1 PDF; sorted by impact.

| CRD Rule | Description | Status | Impact / blocker |
|----------|-------------|--------|------------------|
| 1.1.1 | Two or more players | ⚠️ | Low — only 2-player implemented. Bo3 + 3+P would need new turn-order code, choose_player UI for opponent picks, multi-player bag passing (7.7.6). No current product need; deferred. |
| 1.2.1 | Card text supersedes game rules | ⚠️ | Low — `gameModifiers.ts` is the central override mechanism. Most rule-overriding effects route through it. Edge cases (e.g. "the next time X would happen, do Y instead" general replacement) are wired card-by-card rather than via a unified override system; see 6.5.4 / 6.5.7-8 below. |
| 1.5.4 | Cost can't be changed; payment modifies amount only | ⚠️ | None — engine behavior is correct (Singer / cost_reduction modify amount paid, not `card.cost`). The ⚠️ is purely about lacking explicit "cost vs payment" object tracking. No card needs the distinction modeled separately. |
| 1.7.6 | Illegal action: undo all steps, payments reversed | ⚠️ | Low — `validateAction` rejects illegal actions before mutation, so failed actions don't mutate state (effective rollback). We don't `log` an undo event. Open question per DECISIONS.md: would explicit undo logging help bot training? |
| 1.8.4 | Multiple GSC conditions met simultaneously → all happen at once | ⚠️ | Low — banishes within a single GSC pass happen in object-iteration order, not truly parallel. Matches 2P behavior; would matter for 3+P or for a "leaves play together" trigger (CRD 7.4.3) sensitive to within-pass order. No current card exposes this. |
| 1.9.1.5 | "Take damage" — character takes damage when dealt/put/moved | ⚠️ | None — implicit. Any damage placement triggers downstream "takes damage" handling; no explicit "takes damage" event abstraction needed because no card differentiates "took damage" from "was dealt damage" or "had damage put on" (1.9.2 establishes the equivalence). |
| 3.3.2.1 | Can't end turn while in a turn action | ⚠️ | None — `pendingChoice` blocks PASS_TURN globally (validator.ts:92). The ⚠️ is purely about edge-case "turn action started but no pendingChoice surfaced yet" which doesn't occur in practice (engine never has a half-resolved action without a pendingChoice or pendingEffectQueue). |
| 4.3.6 | Payment modifiers: "next [Type] you play" should skip non-matching plays | ⚠️ | Low — self-referential `self_cost_reduction` works from hand. Non-self cost_reduction works from play. Classification filtering implemented. Edge case: "next character" one-shot consumption may not skip non-matching types correctly in all cases. No current card surfaces a behavior bug. |
| 4.6.7 | "After the challenge" triggers fire as a distinct phase | ⚠️ | Low — in-challenge banish window is correct (`activeChallengeIds` set/cleared around `processTriggerStack`), so `banished_in_challenge` triggers fire correctly during bag resolution. "After the challenge" triggers aren't separated from challenge-end timing — would matter if a card needs to fire AFTER all in-challenge triggers drain, but no current card has this requirement. |
| 5.2.6.3 | Chip 'n' Dale treated as if it has ampersand | ⚠️ | None — would need `alternateNames: ["Chip", "Dale"]` on that card if/when it's added. Card doesn't exist in any wired set yet. |
| 6.5.4 | Replaced events don't fire triggers | ❌ | Low — no current card's trigger conflicts with `damage_redirect` or `damage_prevention` paths. Would matter if a card had "whenever this character would be dealt damage, X" alongside a redirect on the same character. |
| 6.5.7 | Multi-replacement ordering: affected player chooses order | ❌ | Low — no current card pair has two replacements competing on the same event. |
| 6.5.8 | Same replacement effect can't apply twice to same event | ❌ | Low — `damage_prevention_static` with `chargesPerTurn:1` (Lilo Bundled Up) and `damage_prevention_timed` with `charges:1` (Rapunzel Ready for Adventure) independently enforce single-application via charge counters, not via 6.5.8's general rule. Matters only if two distinct replacement sources could both fire on the same event. |
| 7.1.4 | Public-zone search must-find vs private-zone may-fail | ⚠️ | Low — `search` Effect supports `zone: "deck" \| "discard"`. Private-zone (deck) search uses "up to N" allowing fail-to-find. Public-zone (discard) search through `choose_target` only offers valid options, but doesn't enforce the "must-find if able" rule explicitly — relies on the player's bot/UI to pick when a match exists. No current card exposes a divergence. |
| 7.7.6 | Multi-player bag-passing | ⚠️ | Low — 2-player only. Active player resolves first (7.7.4), then opponent. Multiplayer bag-passing not implemented. Same scope blocker as 1.1.1. |
| 8.10.3 | Shifted character with own enter-play exert effect (e.g. Bodyguard) | ⚠️ | Low — Bodyguard exert is a post-play `choose_may` rather than an enter-play state override. Functionally correct (player can choose to exert via Bodyguard's may-prompt after shifting onto a ready character) but CRD says it "becomes exerted as it enters play" — strict timing may differ if a future card observes the difference. |

---

## Open engine extension TODOs

Cross-cutting type-system additions that haven't surfaced from any card
yet but would be useful to have. None of these are blockers for any
shipped card — the corpus is fully wired (2353 implemented / 0 partial /
0 invalid / 0 stubs per `pnpm card-status` 2026-04-30).

| Type | What it'd unlock |
|------|------------------|
| Trigger event `exerts` | "Whenever this character exerts for any reason" — Lorcana hasn't printed this wording yet. |
| Cost type `exert_filtered_character` | "Exert a Pirate character — Draw a card." Synthesizable today via `sequential` with `costEffects:[exert chosen-Pirate]`, but a first-class cost type would clean up the JSON shape. |
| Cost type `exert_filtered_item` | Same as above for items. |
| `RestrictedAction` extension `"be_challenged"` | Timed "can't be challenged this turn" on specific cards. Currently only the permanent `CantBeChallengedException` StaticEffect exists; the timed-grant equivalent is `cant_be_challenged_timed` Effect (Kanga Nurturing Mother). Refactor would unify these under one `cant_action`-style mechanism. |

---

*Last updated: 2026-05-01 (session 23)*
*CRD version: 2.0.1, effective Feb 5, 2026*
*PDF source: `docs/Disney-Lorcana-Comprehensive-Rules-020526-EN-Edited.pdf`*
*Snapshot: `docs/CRD_SNAPSHOT.txt` — see "Diffing a new CRD revision" above.*
