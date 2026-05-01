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
| 1.1.2 | Each player needs a way to track lore + mark damage | N/A Physical-game rule. Engine tracks both as `state.players[id].lore: number` and `CardInstance.damage: number`. |
| 1.1.3 | Tournaments may have additional rules | N/A Physical/competitive-play rule. |
| 1.1.4 | Cards published in multiple languages; English is gameplay-authoritative | N/A The card-data importer pulls only English cards from the Ravensburger API. |
| 1.1.5 | Card text and rules may be updated; current version is authoritative | N/A Reflects the CRD-revision workflow at the top of this doc. |
| 1.1.6 | Games with 3+ players use §9 Multiplayer rules | ⚠️ See 1.1.1 + §9. |
| 1.1.7 | Reminder text in italics isn't rules text | N/A |

### 1.2 Golden Rules
| Rule | Quote | Status |
|------|-------|--------|
| 1.2.1 | Card text supersedes game rules | ⚠️ Architecture exists (`gameModifiers.ts`) but not all override mechanisms built yet |
| 1.2.2 | Preventing effects supersede allowing effects | ✅ `isActionRestricted` checked before grants in all validator paths. "Can't X" blocks even if a grant says "can X." |
| 1.2.3 | Do as much as possible ("do as much as you can") | ✅ Engine behavior is correct: effects no-op when no valid targets, actions remain legal. Examples: Dragon Fire on empty board, Sudden Chill with one opposing character, The Queen's "each opponent" with one opponent. No formal tracking needed — silent no-op IS the correct behavior |

### 1.3 Players
| Rule | Quote | Status |
|------|-------|--------|
| 1.3.1 | Each person playing is a "player"; minimum 2 | ✅ `state.players: Record<PlayerID, PlayerState>` with `PlayerID = "player1" \| "player2"`. |
| 1.3.2 | Each player has designations: active player / opponent / teammate | ✅ Active player tracked as `state.currentPlayer: PlayerID`. Opponent computed via `getOpponent`. Teammates not implemented (out of scope per 1.1.6 / §9). |
| 1.3.3 | "You/your/yours" in card text refers to the player who played that card | ✅ `controllingPlayerId` threaded through every effect resolution; "you/your" filters / targets resolve to that ID. |
| 1.3.4.1 | Only one active player at a time; designation flips on turn transition | ✅ `state.currentPlayer` rotates in `applyPassTurn`. |
| 1.3.4.2 | "Active player" isn't referenced in card text — purely an internal designation | N/A No card filter targets "the active player" by name; the closest is `is_your_turn` condition (which matches when controllingPlayerId === currentPlayer). |
| 1.3.5 | Opponent (parent rule) | ✅ See 1.3.5.1-3. |
| 1.3.5.1 | An opponent is anyone you're playing against; in multiplayer multiple opponents | ✅ 2P assumes single opponent via `getOpponent`. Multi-opponent semantics covered by `each_player scope:"opponents"` for 3+P-aware effects (still 2P-bound today). |
| 1.3.5.2 | "Opponent" in card text refers to any opposing player | ✅ `PlayerTarget.type === "opponent"` resolves to the non-controlling player. |
| 1.3.5.3 | "Opposing player" is the same designation as "opponent" | ✅ Engine treats both phrasings as the same `PlayerTarget` shape. Decompile renderer handles either oracle wording. |
| 1.3.6 | Teammate (parent rule) | ❌ Out of scope (team play). |
| 1.3.6.1 | Some multiplayer formats allow teammates | ❌ Out of scope. |
| 1.3.6.2 | "Teammate" in card text references team members | ❌ No card filter exists. Out of scope. |

### 1.4 Cards
| Rule | Quote | Status |
|------|-------|--------|
| 1.4.1 | A Disney Lorcana deck is comprised entirely of standard Lorcana cards | N/A Card data importer enforces this — only Ravensburger / Lorcast-sourced standard cards in the corpus. |
| 1.4.2 | Cards without the Illuminary icon (or with a different / damaged back) aren't standard Lorcana cards | N/A Physical-card rule; importers reject non-standard cards. |
| 1.4.2.1 | Specific card types have additional criteria (see §5) | ✅ See §5 sections — characters, items, locations, actions each have type-specific validators. |
| 1.4.3 | Cards in your deck are "yours"; you make decisions for them unless an effect specifies otherwise | ✅ `CardInstance.ownerId` is set when the deck is built and never changes. Owner makes decisions per `controllingPlayerId` threading. |
| 1.4.3.1 | "You/your/yours" in card text → the player who played that card (mirror of 1.3.3) | ✅ Same as 1.3.3. |
| 1.4.3.2 | Pronouns ("she", "he", "they", "it") in card text refer to the most-recently-mentioned referent | N/A Renderer handles pronoun substitution at the rendering layer (e.g. "this character" → "they" inside followUp effects). Engine doesn't track grammatical referents — it operates on instance IDs. |

### 1.5 Costs
| Rule | Quote | Status |
|------|-------|--------|
| 1.5.1 | Cost = payment to play a card; represented by the number in the top-left corner | ✅ `CardDefinition.cost: number`. Cost is paid via `payCosts` helper which deducts from `availableInk`. |
| 1.5.3 | Cost must be paid in full; can't play if unable | ✅ Validated in `validatePlayCard` / `validateActivateAbility` |
| 1.5.4 | A cost can't be changed; payment modifiers affect only the amount paid, not the cost itself | ⚠️ Implicit — Singer/cost_reduction modify amount paid, not card.cost. No explicit "cost vs payment" tracking. |
| 1.5.5 | Alternate costs (Shift, Singer, Sing Together, "for free") | ✅ All four alternate cost types implemented. Shift: ink (`shiftCost`) + altShiftCost discard variant (Diablo, Flotsam & Jetsam). Singer: `singerInstanceId` skips ink. Sing Together: `singerInstanceIds[]` aggregate-cost validator (8.12). "For free": `play_for_free` Effect + `grant_play_for_free_self` static (Mufasa, Pride Lands, Belle, etc.). |
| 1.5.5.1 | Singing a song is an alternate cost | ✅ `singerInstanceId` skips ink deduction |
| 1.5.5.2 | Shift is an alternate cost | ✅ |
| 1.5.5.3 | "For free" means ignore all costs | ✅ `play_for_free` effect + `grant_play_for_free_self` static with optional `playCosts`. |
| 1.5.5.4 | "Use an ability for free" is an alternate cost (different from playing a card for free) | ⚠️ No card currently uses "use this ability for free" wording in a way distinct from skipping the ink cost. If/when one prints, it would route through a new `activate_for_free` Effect or extend `ActivatedAbility` with an isFree flag. |

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
| 1.7.1 | Game actions = things a player does as part of a normal turn (draw, exert, challenge, etc.) | ✅ Action union enumerated in `GameAction` type (PLAY_CARD, PLAY_INK, QUEST, CHALLENGE, ACTIVATE_ABILITY, MOVE_CHARACTER, BOOST_CARD, PASS_TURN, RESOLVE_CHOICE, DRAW_CARD). |
| 1.7.2 | Effects must fully resolve before next can happen | ✅ Each effect fully resolves (or surfaces pendingChoice) before next. Challenge damage is simultaneous per CRD 4.6.6.2. Trigger bag processes one at a time. |
| 1.7.3 | "Choose one of" — general semantics for independent modal effects | ✅ Routed through `ChooseEffect` primitive; resolution details at 6.1.3. Distinct from 6.1.5.2 "[A] or [B]" modals where the backup rule can force a specific branch — see that entry for the subset of cards where option-infeasibility matters. |
| 1.7.4 | Triggered abilities wait in a special zone called the "bag" | ✅ See §7.7. `state.triggerStack` is the engine's bag. |
| 1.7.5 | **Drying**: characters can't quest/challenge/exert unless in play since beginning of their player's turn | ✅ `isDrying` boolean; Rush bypasses for challenges only |
| 1.7.6 | Illegal action: undo all steps, payments reversed | ⚠️ We return `success: false` and don't mutate state, but don't log "undo". Open question: would undo help bot learning? See DECISIONS.md Open Questions |
| 1.7.6.1 | Player may attempt to redo what was attempted in the correct way | ✅ `validateAction` rejects illegal actions before mutation, so the player's UI can immediately retry with a corrected input. The bot policies discard rejected actions and re-call `decideAction`. |
| 1.7.6.2 | Can't undo actions that are impossible to fully undo (shuffles, reveals) | ✅ `state.rng` is cloned on entry to `applyAction` (so failed actions don't poison the RNG state); reveals fire `card_revealed` events but the engine doesn't allow undoing the publicity itself. |
| 1.7.7 | If an illegal choice is made resolving an effect, undo back to the choice point | ⚠️ Same as 1.7.6 — failed RESOLVE_CHOICE rejects without mutation, but no explicit "rewind to choice point" log. |

### 1.8 Game State Check
| Rule | Quote | Status |
|------|-------|--------|
| 1.8.1 | The game checks for a set of conditions; results occur when conditions are met | ✅ `runGameStateCheck` (reducer.ts:9244) called after every effect resolution + at end of turn. Loops until no more changes. |
| 1.8.1.1 | Player with 20+ lore wins | ✅ `runGameStateCheck` + `getLoreThreshold`. Win threshold modification via `modify_win_threshold` StaticEffect (Donald Duck Flustered Sorcerer). |
| 1.8.1.3 | In multiplayer, last player remaining wins | ❌ Out of scope (2P only). Engine's win check is binary — would need to track which players have lost and end the game on the last-standing condition for 3+P support. |
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

### 1.10 Materials
| Rule | Quote | Status |
|------|-------|--------|
| 1.10.1 | Each player needs a Disney Lorcana deck | N/A Physical-game requirement; engine assumes a `Deck` is supplied to `createGame`. |
| 1.10.1.1 | Constructed format: ≥60 cards, ≤2 ink types, ≤4 of any non-Dreamborn | N/A Deck-construction validation lives in `applyDeckList` / format-rule layer (rotation rules in `docs/ROTATIONS.md`), not in this engine layer. |
| 1.10.2 | Each player needs to track lore totals | N/A Physical. Engine: `state.players[id].lore: number`. |
| 1.10.3 | Each player needs to track damage counters | N/A Physical. Engine: `CardInstance.damage: number`. |

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
| 2.1.1 | A game has three stages: Setup, In-Game, Cleanup | ✅ `state.phase` enum tracks current stage. `createGame` enters Setup; `applyAction` runs the In-Game loop; the Cleanup stage is a server / match-runner concern (engine has no separate Cleanup phase since each game is its own state). |
| 2.1.2 | Format determines starting-player selection + turn order | ✅ `GameConfig.chooserPlayerId` (default `player1`) controls who picks first/second per CRD 2.1.3.2 (Bo3 play-draw). |
| 2.1.3 | 2P turn order: starting player, then non-starting; multi-player: turn order around the table | ⚠️ 2P implemented (see 2.1.3.2). 3+P would extend `getOpponent` to a "next in turn order" iterator. Same scope as 1.1.1. |
| 2.1.3.1 | In a two-game series, the non-starter for game 1 starts game 2 | N/A Bo3 series ordering lives at the server/match-runner layer (`packages/server/`), not engine. |
| 2.1.3.2 | Best-of-N play-draw rule: losing player chooses to start or not | ✅ `choose_play_order` PendingChoice fired from the `play_order_select` phase at game start. `GameConfig.chooserPlayerId` (default `player1`) controls who chooses. Engine resolves choice → sets `firstPlayerId`/`currentPlayer`, transitions to mulligan with correct starting-player-first order. Tested in `play-draw.test.ts`. Server-side Bo3 loser-slot-swap is the follow-on. |

### 2.2 Setup Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.2.1 | During Setup, players prepare to play | ✅ Setup phase runs `createGame` → deck shuffle → opening hand → mulligan → play-order selection. |
| 2.2.1.2 | Each player shuffles their deck (any reasonable method) | ✅ `shuffleDeck` uses Fisher-Yates with seeded RNG (`state.rng.s`). Deterministic for replay. |
| 2.2.1.3 | Each player begins with 0 lore | ✅ `createGame` initializer |
| 2.2.1.4 | Each player draws 7 cards (opening hand) | ✅ Tested: "deals 7 cards to each player" |
| 2.2.2 | Players may alter their opening hand (mulligan) | ✅ Partial Paris mulligan in simulator. Generic `shouldMulligan`/`performMulligan` on BotStrategy. Mulligan ordering keyed off `firstPlayerId` (CRD 2.2.2: starting player mulligans first) so the play-draw choice feeds through correctly. |
| 2.2.2.1 | Starting player picks any number of cards to put on bottom (without revealing) | ✅ `choose_mulligan` PendingChoice with starting-player-first ordering. Validator allows array-of-cardIds (any length 0..hand.length). |
| 2.2.2.2 | Each non-starting player decides next, in turn order | ✅ Mulligan ordering keyed off `firstPlayerId`. After starting player resolves, the next player's `choose_mulligan` PendingChoice fires. |
| 2.2.2.3 | Each player who altered hand shuffles their deck after mulligan | ✅ `applyMulligan` shuffles after returning the chosen cards. Each player's reshuffle is independent. |
| 2.2.3 | After mulligan, game enters In-Game stage; starting player begins | ✅ Phase transitions from `mulligan` → `main` for the starting player. |

### 2.3 In-Game Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.3.1 | Players play the game | ✅ Self-evident — engine runs the loop. |
| 2.3.2 | Players take turns in turn order | ✅ `applyPassTurn` rotates `currentPlayer`. |
| 2.3.3 | Players continue until game ends — multiple end conditions listed below | ✅ See 2.3.3.1, 2.3.3.2, 2.3.3.3, 2.3.3.4. |
| 2.3.3.3 | Last player in a multiplayer game wins | ❌ Out of scope. See 1.8.1.3 / §9. |

### 2.4 Cleanup Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.4.1 | Players prepare play area for next game (if applicable) | N/A Physical-game step. Engine is one-game-per-state; multi-game series live at the server/match-runner layer. |
| 2.4.1.1 | Each player puts all cards from Hand/Play/Inkwell/Discard back into their deck | N/A Physical. |
| 2.4.1.2 | Each player removes all counters from the play area | N/A Physical. |
| 2.4.2 | After cleanup, the next game can begin | N/A Server-layer concern — start a new `createGame` invocation. |

### 2.3 In-Game Stage
| Rule | Quote | Status |
|------|-------|--------|
| 2.3.3.1 | Win at 20+ lore | ✅ |
| 2.3.3.2 | Lose when turn ends with empty deck | ✅ |
| 2.3.3.4 | Concede at any time | N/A Bots play to completion; concession has no analytical value |

---

## 3. TURN STRUCTURE

### 3.1 Phases
| Rule | Quote | Status |
|------|-------|--------|
| 3.1.1 | A turn has three phases: Start-of-Turn, Main, End-of-Turn | ✅ `state.phase` rotates through these. `applyPassTurn` runs the End-of-Turn → Start-of-Turn transition; the Main Phase is the period during which `PLAY_INK` / `PLAY_CARD` / `QUEST` / `CHALLENGE` / etc. actions are legal. |
| 3.1.2 | Start-of-Turn Phase: reset cards for new turn; effects ending "at start of turn" expire | ✅ See §3.2 sub-rules. |
| 3.1.4 | End-of-Turn Phase: "this turn" effects end; next player becomes active | ✅ See §3.4 sub-rules. |

### 3.2 Start-of-Turn Phase

#### 3.2.1 Ready step
| Rule | Quote | Status |
|------|-------|--------|
| 3.2.1 | Ready (parent rule) | ✅ See sub-rules below. |
| 3.2.1.1 | Active player readies all cards **in play and in inkwell** | ✅ Both play and inkwell cards readied |
| 3.2.1.2 | "During your turn" effects start applying | ✅ Implemented via `is_your_turn` condition on StaticAbility. Dozens of cards use `"condition": { "type": "is_your_turn" }` to gate effects to the controller's turn. |
| 3.2.1.3 | "Start of your turn" / "start of your next turn" effects end | ✅ `until_caster_next_turn` duration expires at start of caster's next turn; `end_of_owner_next_turn` expires at end of affected card's owner's next turn. Both handled in `applyPassTurn` timedEffects expiry. |
| 3.2.1.4 | "At the start of your turn" triggered abilities added to bag | ✅ `queueTriggersByEvent("turn_start", opponent, ...)` fires in `applyPassTurn` after readying. Tested with Donald Duck Perfect Gentleman, Christopher Robin (via `readied` trigger). |

#### 3.2.2 Set step
| Rule | Quote | Status |
|------|-------|--------|
| 3.2.2 | Set (parent rule) | ✅ See sub-rules below. |
| 3.2.2.1 | Active player's characters are no longer drying; can quest/challenge/{E} | ✅ `isDrying` cleared on turn start |
| 3.2.2.2 | Active player gains lore from locations with {L} | ✅ Set step lore gain in `applyPassTurn` after readying. Tested in set3.test.ts. |
| 3.2.2.3 | Resolve triggered abilities from Ready + Set steps | ✅ processTriggerStack called after Ready+Set and before turn_start triggers |

#### 3.2.3 Draw step
| Rule | Quote | Status |
|------|-------|--------|
| 3.2.3 | Draw (parent rule) | ✅ See sub-rules below. |
| 3.2.3.1 | Active player draws a card | ✅ Tested: "draws a card for the new active player at turn start" |
| 3.2.3.1 | **Starting player skips draw on first turn of the game** | ✅ Implicit: `createGame` deals opening hands only; first draw happens in `applyPassTurn` when transitioning to next player |
| 3.2.3.2 | Once effects resolve and bag is empty, game moves into Main Phase | ✅ `applyPassTurn` calls `processTriggerStack` after the draw; once stack drains, phase transitions to `main`. |

### 3.3 Main Phase
| Rule | Quote | Status |
|------|-------|--------|
| 3.3.1 | Player can perform turn actions in section 4 | ✅ All main phase actions implemented |
| 3.3.2 | Player can declare end of turn at any time during Main Phase | ✅ `PASS_TURN` action |
| 3.3.2.1 | Can't end turn if currently in a turn action or bag has abilities waiting | ⚠️ Bag must be empty (pendingChoice blocks), but partial turn action check not enforced |

### 3.4 End-of-Turn Phase
| Rule | Quote | Status |
|------|-------|--------|
| 3.4.1 | Active player declares end of turn; engine runs the End-of-Turn process | ✅ `applyPassTurn` is the entry point. |
| 3.4.1.1 | "At the end of the turn" / "at the end of your turn" triggered abilities added and resolved | ✅ `queueTriggersByEvent("turn_end", ...)` fires in applyPassTurn. Floating triggers also checked on turn_end. |
| 3.4.1.2 | Effects that end "this turn" end (Support, temp stat boosts, etc.) | ✅ `tempStrengthModifier`, `tempWillpowerModifier`, `tempLoreModifier`, `grantedKeywords` all cleared |
| 3.4.2 | Final game state check at turn end | ✅ `runGameStateCheck` is called in `applyPassTurn` (reducer.ts:2143) after the end-of-turn trigger pass, before the turn transitions to the next player. The same GSC also runs after every effect resolution (lines 218 / 1369 / 1567) — the end-of-turn call is the explicit final pass to catch lethal-damage banishes from end-of-turn triggers. |

---

## 4. TURN ACTIONS

### 4.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 4.1.1 | Turn actions are the actions a player can take on their turn (no card needed) | ✅ `GameAction` union enumerates the legal turn actions. |
| 4.1.3 | Active player can: ink, play, use ability, quest, challenge, move, declare end of turn | ✅ All implemented. Each action is validated via the corresponding `validate*` function. |
| 4.1.4 | If any part of a turn action can't be performed, the action is illegal — game returns to pre-action state | ✅ Validate-then-apply pattern: failed actions return `success: false` with no state mutation (effective rollback). |
| 4.1.5 | Triggered abilities during a turn action go to bag but don't resolve until the action completes | ✅ `queueTrigger` adds to `triggerStack` mid-action; `processTriggerStack` runs after action resolves. |

### 4.2 Ink a Card
| Rule | Quote | Status |
|------|-------|--------|
| 4.2.1 | Declare intent, reveal inkable card, put into inkwell ready | ✅ `PLAY_INK` action |
| 4.2.1.1 | First: choose and reveal an inkable card from hand | ✅ `applyPlayInk` reads `card.inkable` flag from CardDefinition. |
| 4.2.1.2 | Second: verify inkwell symbol is present | ✅ Validator checks `def.inkable === true`. |
| 4.2.1.3 | Third: put the card into inkwell facedown and ready | ✅ `zoneTransition` to `inkwell` zone with `isFaceDown: true`, `isExerted: false`. |
| 4.2.2 | Once inking is complete, resolve any triggered abilities in the bag | ✅ `card_put_into_inkwell` trigger queued; `processTriggerStack` runs after action. |
| 4.2.3 | Limited to once per turn | ✅ `inkPlaysThisTurn` counter (replaced boolean to support extra ink plays) |
| 4.2.3.1 | Effects can allow additional cards into inkwell (Belle – Strange But Special) | ✅ `ExtraInkPlayStatic` + `extraInkPlaysGranted` + `inkPlaysThisTurn` counter. Belle supported. |
| 4.2.3.2 | Some effects put cards into inkwell bypassing once-per-turn rule (Fishbone Quill) | ✅ `put_into_inkwell` Effect bypasses the PLAY_INK once-per-turn check entirely. Wired on Fishbone Quill GO AHEAD AND SIGN ({E} — Put any card from your hand into your inkwell facedown), Razoul Wickedly Loyal, etc. The effect routes through `applyEffect` not `applyPlayInk`, so `inkPlaysThisTurn` isn't incremented. |

### 4.3 Play a Card
| Rule | Quote | Status |
|------|-------|--------|
| 4.3.1 | Play card from hand, announce and pay cost | ✅ |
| 4.3.2 | Can normally be played only from hand | ✅ Validated. Mufasa exception will use effect system |
| 4.3.2.1 | First: announce + reveal the card from hand | ✅ `PLAY_CARD` action carries `instanceId`; renderer/state filtering exposes the card identity to opponents at this point. |
| 4.3.2.2 | Second: announce how to pay (ink cost or alternate cost — Shift, Singer, Sing Together, etc.) | ✅ `PlayCardAction` has `shiftTargetInstanceId`, `singerInstanceId(s)`, `viaGrantedFreePlay`, `altShiftCostInstanceIds` discriminator fields. |
| 4.3.2.3 | Third: determine total cost = ink cost (or alt) + modifiers | ✅ `getEffectiveCostWithReductions` sums applicable cost reductions (static + one-shot). |
| 4.3.3 | Once cost paid, card enters play based on type — now considered "played" | ✅ `applyPlayCard` post-cost branch dispatches by `def.cardType`. |
| 4.3.3.1 | Characters/items/locations enter Play zone; Shift goes on top of named card | ✅ Characters, items, and locations all enter play zone. Shift implemented with cardsUnder stack. |
| 4.3.3.2 | Actions enter Play zone, effect resolves immediately, then move to discard | ✅ `applyPlayCard` action branch; `pendingActionInstanceId` for deferred choices |
| 4.3.4 | Once 4.3.2/4.3.3 complete, bagged triggers can resolve | ✅ `processTriggerStack` called after `applyPlayCard` returns. |
| 4.3.4.1 | "When [Player] play(s) this" triggered conditions met as card enters play | ✅ `queueTrigger("enters_play", ...)` |
| 4.3.5 | Payment modifiers (e.g., Singer) don't change the card's ink cost | ✅ Singer implemented; `singerInstanceId` path |
| 4.3.6 | Payment modifiers: "next [Type] you play" applies even if alternate cost used; self-referential modifiers (from hand) vs non-self (from play); classification-specific modifiers skip non-matching plays | ⚠️ Self-referential (`self_cost_reduction`) works from hand. Non-self cost_reduction works from play. Classification filtering implemented. But "next character" one-shot consumption may not skip non-matching types correctly in all cases. |

### 4.4 Use an Activated Ability
| Rule | Quote | Status |
|------|-------|--------|
| 4.4.1 | Activated ability: cost → effect | ✅ |
| 4.4.2 | {E} ability on a character requires character to be dry | ✅ `isDrying` check in `validateActivateAbility` (characters only; CRD 6.3.1.2 items exempt) |
| 4.4.2 | Items and locations: activated ability can be used turn played | ✅ Items and locations can use activated abilities the turn they're played (no drying for non-characters). |
| 4.4.2.1 | {E}-cost activated abilities require dry character | ✅ Validator rejects `ACTIVATE_ABILITY` on a drying character if the cost array contains `{ type: "exert" }`. |
| 4.4.3 | Process for using an activated ability: announce → declare cost → pay → effect | ✅ See 4.4.3.1-.4 sub-rules. |
| 4.4.3.1 | First: announce the ability | ✅ `ACTIVATE_ABILITY` action carries `instanceId` + `abilityIndex` to disambiguate. |
| 4.4.3.3 | Third: determine total cost = ink cost or alt cost + modifiers | ✅ `validateActivateAbility` resolves cost via the ability's `costs[]` array; cost-reduction modifiers apply at validation time. |
| 4.4.3.4 | Fourth: pay total cost. Ink-cost activations exert ready ink cards | ✅ `payCosts` deducts ink + processes other cost types (banish, exert, discard). Inkwell exertion is automatic — no per-card selection. |
| 4.4.4 | Once cost paid, ability resolves immediately (vs played-card with bagged-triggers). End of process | ✅ Activated abilities resolve their effects inline in `applyActivateAbility`; the activation itself doesn't trigger anything (per 7.7.2 — activated abilities don't go in the bag). |
| 4.4.5 | After activation, bagged triggers can resolve | ✅ `processTriggerStack` runs after the activated ability completes. |

### 4.5 Quest
| Rule | Quote | Status |
|------|-------|--------|
| 4.5.1 | Only characters can quest; questing character is the chosen one | ✅ Validator rejects QUEST on non-character cards. `quests` trigger fires on the questing character. |
| 4.5.1.1 | Declare questing character | ✅ |
| 4.5.1.2 | Check restrictions (not dry, Reckless, etc.) | ✅ isDrying + Reckless both checked in validateQuest |
| 4.5.1.3 | Exert questing character | ✅ |
| 4.5.1.4 | Gain lore equal to character's {L} | ✅ |
| 4.5.2 | Once lore is gained, the character has "quested" (triggers can fire) | ✅ `quests` trigger queued after lore gain; abilities like Support's "whenever this character quests" wired off this. |
| 4.5.3 | Once effects resolve, quest action complete | ✅ `processTriggerStack` then control returns to the player. |
| 4.5.3.1 | If character has negative lore, player gains 0 lore | ✅ `getEffectiveLore` uses `Math.max(0, ...)` |

### 4.6 Challenge
| Rule | Quote | Status |
|------|-------|--------|
| 4.6.1 | Only characters can challenge; challenging character is the chosen attacker | ✅ Validator rejects CHALLENGE on non-character attackers. |
| 4.6.2 | Only the attacker and defender are "in" the challenge — abilities referring to "the challenge" target these two | ✅ `state.activeChallengeIds = { attackerId, defenderId }` set during the challenge window; effects with "while challenging"/"while being challenged" gate on this. |
| 4.6.3 | Challenges have two steps: Declaration + Damage | ✅ Engine separates declaration triggers (`challenges` / `is_challenged` queued, then resolved) from damage step (calculated post-resolution). |
| 4.6.4 | Challenge Declaration step (parent) | ✅ See sub-rules. |
| 4.6.4.1 | Challenging character must have been in play since beginning of Set step and be ready | ✅ `isDrying` + `isExerted` checks; Rush bypasses `isDrying` |
| 4.6.4.2 | Choose an **exerted** opposing character to challenge | ✅ `defender.isExerted` check (added this session) |
| 4.6.4.3 | Check challenging restrictions (Evasive, Bodyguard) | ✅ Evasive + Bodyguard checked |
| 4.6.4.4 | Exert the challenging character | ✅ |
| 4.6.4.5 | The challenge occurs; "while challenging" effects begin to apply — end of declaration | ✅ `state.activeChallengeIds` is set, "while challenging" gates start applying. |
| 4.6.5 | "challenges" / "is challenged" triggered abilities added to bag | ✅ `queueTrigger("challenges", ...)` and `queueTrigger("is_challenged", ...)` |
| 4.6.6 | Challenge Damage step (parent) | ✅ See 4.6.6.1-3. |
| 4.6.6.1 | Calculate damage: apply {S} increases/decreases first, then damage modifiers | ✅ `getEffectiveStrength` + Challenger bonus + Resist |
| 4.6.6.2 | Damage dealt simultaneously | ✅ Both characters take damage before banish check. Implication: "banishes another in a challenge" triggers (`banished_other_in_challenge`) fire even when the attacker is also banished — see 1.6.1 exceptions. |
| 4.6.6.3 | Game state check after challenge damage | ✅ `applyWinCheck` runs after action |
| 4.6.7 | After challenge damage + bag resolution: "while challenging"/"while being challenged" effects end; "after the challenge" triggers fire | ✅ (in-challenge banish window) / ⚠️ (after-the-challenge triggers). `state.activeChallengeIds` is set when a challenge begins and cleared once `processTriggerStack` drains the bag, so any banish of the attacker/defender during bag resolution still fires `banished_in_challenge` per CRD Example B (Cheshire LOSE SOMETHING? → Marshmallow's DURABLE returns him to hand). `while_challenging` stat modifiers (Challenger) still applied only during damage calc; "after the challenge" triggers not yet separated from challenge-end. |
| 4.6.9 | Character removed from challenge → challenge ends early; remaining triggers resolve, then "while" effects end | ✅ `applyChallenge` checks both combatants' zones AFTER Declaration triggers resolve (reducer.ts:1378-1382): if either combatant left play during declaration triggers (e.g. Puny Pirate banished the defender), the damage step is skipped. Tested via the Puny Pirate self-banish-on-challenged regression in setN tests. |
| 4.6.9.1 | First: resolve any remaining triggered abilities in the bag | ✅ `processTriggerStack` after damage step drains remaining triggers. |
| 4.6.9.2 | Then: "while challenging"/"while being challenged" effects end; "after the challenge" triggers fire | ⚠️ See 4.6.7 — "while challenging" Challenger +N already only applies during damage calc. "After the challenge" triggers aren't a distinct phase yet; bag drain at challenge end serves the same purpose for current cards. |
| 4.6.8 | Characters can challenge **locations** | ✅ `validateChallenge` allows location defenders. Bodyguard/Evasive bypassed for locations. |
| 4.6.8.1 | When choosing exerted opposing character to challenge, player chooses an opposing one (Bodyguard restricts) | ✅ `validateChallenge` requires `defender.ownerId !== attacker.ownerId`. Bodyguard requirement enforced via `bodyguardCheck`. |
| 4.6.8.2 | Locations aren't ready/exerted; can be challenged at any time | ✅ Exerted check bypassed for location defenders. |
| 4.6.8.3 | Locations have no {S}; deal no damage to challenger | ✅ Symmetric damage math (location STR=0 → 0 attacker damage). Challenger +N guarded to character defenders only. |

### 4.7 Move a Character
| Rule | Quote | Status |
|------|-------|--------|
| 4.7 | Move a character to a location (entire section) | ✅ `MOVE_CHARACTER` action. `applyMoveCharacter` deducts ink, sets `atLocationInstanceId`, marks `movedThisTurn`, fires `moves_to_location` trigger. |
| 4.7.1 | Player can only move their own characters to their own locations | ✅ Validator checks `character.ownerId === playerId === location.ownerId`. |
| 4.7.2 | Can't move from location unless to another location (no "leave location" without destination) | ✅ MOVE_CHARACTER requires a `locationInstanceId` argument. To "leave" a location, the character must move to another location. |
| 4.7.3 | Process: choose char + location, pay move cost, character moves | ✅ See sub-rules. |
| 4.7.3.1 | First: choose character + location; declare the move | ✅ `MOVE_CHARACTER` action carries both `characterInstanceId` and `locationInstanceId`. |
| 4.7.3.2 | Second: pay the location's move cost (or "for free" ignores) | ✅ `applyMoveCharacter` deducts `def.moveCost`; `global_move_cost_reduction` modifies. "Move for free" via `move_to_self_cost_reduction` static (Sailing for Adventure, etc.). |
| 4.7.3.3 | Third: character moves; end of process | ✅ `atLocationInstanceId` set on the character. |
| 4.7.4 | After move, bagged triggers can resolve; then move complete | ✅ `moves_to_location` trigger queued; `processTriggerStack` resolves it. |

---

## 5. CARDS AND CARD TYPES

### 5.1 Card States
| Rule | Quote | Status |
|------|-------|--------|
| 5.1.1 | While in any zone except hand, a card can have one or more specific states | ✅ State fields apply to instances in play, deck, inkwell, discard. Hand-zone instances have minimal state. |
| 5.1.1.1 | Ready state | ✅ `isExerted = false` |
| 5.1.1.2 | Exerted state; can still use non-{E} abilities | ✅ |
| 5.1.1.3 | Damaged: card with 1+ damage counters | ✅ `damage > 0` |
| 5.1.1.4 | Undamaged: card with no damage counters | ✅ `damage === 0`. Filter `hasDamage:false` semantics; statComparisons can also gate on damage thresholds. |
| 5.1.1.5 | Under: card with one or more cards on top | ✅ `zone === "under"`. Source instance's `cardsUnder` array references the under-card by ID. |
| 5.1.1.6 | On Top: card with one or more cards under it; doesn't gain text of cards under it | ✅ Top card stays in `zone === "play"` and is the addressable instance — under-cards are referenced via `cardsUnder` and don't contribute their abilities (no card text inheritance). |
| 5.1.1.7 | In a stack: top + under cards considered a stack only while in play | ✅ Stack semantics enforced by `cardsUnder` array; on top-card leaving play, all under-cards follow per 8.10.7. |
| 5.1.1.8 | In Play: faceup in Play zone with no cards on top | ✅ `zone === "play"` |
| 5.1.1.10 | Facedown: card in play area with back facing up | ✅ `isFaceDown: boolean` field on `CardInstance`. Set when cards are put under another card via Boost or `put_top_card_under`, and when cards enter the inkwell. Facedown cards have no public identity — `filterStateForPlayer` redacts their definitionId for the non-owner. |
| 5.1.1.11 | **Drying**: entered play this turn; can't quest/challenge/exert | ✅ `isDrying: true` on play; validator enforces restrictions |
| 5.1.1.12 | **Dry**: been in play since start of their player's turn; can quest/challenge/exert | ✅ `isDrying: false` after turn start |
| 5.1.2 | A card in any zone except hand can have one or more states (states are stacked: ready+undamaged+faceup, etc.) | ✅ State fields on `CardInstance` (isExerted, damage, isFaceDown, isDrying, cardsUnder) compose freely; only hand-zone instances have minimal state. |
| 5.1.2.1 | Characters enter play ready, undamaged, faceup, **drying** | ✅ `isDrying: true`; Rush bypasses for challenges only |
| 5.1.2.2 | Items enter play ready, in play, faceup; can't be damaged/undamaged/under/facedown | ✅ Items don't have damage tracked separately (no willpower check), aren't valid Shift / put_under targets, don't enter inkwell directly. |
| 5.1.2.3 | Locations enter play undamaged, in play, faceup; can't be ready/exerted/under/facedown | ✅ Locations have no `isExerted` semantics (always considered "open" — characters move TO them; they don't quest/challenge themselves). |
| 5.1.2.4 | A card in inkwell can only have ready / exerted / facedown states | ✅ Inkwell instances track `isExerted` and `isFaceDown`; no damage/drying tracked there. |
| 5.1.2.5 | A card in deck can only have the facedown state | ✅ Deck cards have `isFaceDown: true` and no other state. |
| 5.1.2.6 | A card in discard can only have the faceup state | ✅ Discard zones don't track damage / exerted; cards reset to faceup on entry. |
| 5.1.2.7 | A card in hand has no state | ✅ Hand cards are minimal — `definitionId` + `instanceId` + `ownerId` + `zone`. No state fields apply. |
| 5.1.3 | State changes apply immediately (not batched) | ✅ Each state mutation in the reducer is applied via `updateInstance` / spread into `state.cards` and visible to subsequent reads in the same effect chain — no deferred state batching. |

### 5.2 Parts of a Card
| Rule | Quote | Status |
|------|-------|--------|
| 5.2.1 | Most parts appear on all card types; type-specific differences in the relevant card-type entries | ✅ `CardDefinition` is a discriminated union with `cardType` discriminator; common fields (name, cost, inkColors, traits) apply across all types. |
| 5.2.2 | Card Cost — amount of ink needed to play the card | ✅ `CardDefinition.cost: number`. |
| 5.2.3 | Inkwell Symbol — if present, the card can be put into inkwell | ✅ `CardDefinition.inkable: boolean`. Validator gates PLAY_INK on this flag. |
| 5.2.4 | Art isn't used for gameplay | N/A Cosmetic. |
| 5.2.5 | Ink Type — single or dual; identifies card's color bar | ✅ `CardDefinition.inkColors: InkColor[]` array; deck-construction validates ≤2 ink types. |
| 5.2.5.1 | Some cards have more than one ink type; count as each ink type | ✅ `inkColors: InkColor[]` on CardDefinition; filter uses array intersection |
| 5.2.6 | Name — applies in all zones; effects that look for a card with a name match anywhere | ✅ `CardDefinition.name`. `hasName` filter matches across all zones. |
| 5.2.6.1 | Some characters have two names (&); each name is searchable independently (Flotsam & Jetsam = "Flotsam", "Jetsam", "Flotsam & Jetsam") | ✅ `alternateNames: string[]` on CardDefinition. `matchesFilter` checks both `name` and `alternateNames`. |
| 5.2.6.2 | A character with multiple names is still a single character | ✅ Dual-named characters share one CardInstance — alternateNames don't fork the entity, they just expand its addressable identifiers. |
| 5.2.6.3 | Chip 'n' Dale treated as if it has ampersand | ⚠️ No special case for Chip 'n' Dale — would need `alternateNames: ["Chip", "Dale"]` on that card |
| 5.2.7 | Classifications — categories on the card that may be referenced by card rules | ✅ `CardDefinition.traits: string[]` (formerly "classifications"). `hasTrait` / `hasAnyTrait` / `hasNoTrait` filters consume this. |
| 5.2.8 | Rules Text — abilities, effects, and rules text in text box; story name used for referencing | ✅ `storyName` field on TriggeredAbility, ActivatedAbility, StaticAbility |
| 5.2.9 | Flavor Text isn't used for gameplay | N/A Cosmetic. |
| 5.2.10 | Ancillary Information isn't used for gameplay | N/A All sub-rules below are cosmetic / metadata. |
| 5.2.10.1 | Artist Name | N/A `CardDefinition.artist?: string` is metadata; not used in gameplay. |
| 5.2.10.2 | Collector Number | N/A `CardDefinition.number: number`; metadata only. |
| 5.2.10.3 | Set Number | N/A `CardDefinition.setId: string`; metadata only. |
| 5.2.10.4 | Language | N/A All cards are English (1.1.4). |
| 5.2.10.6 | Rarity Symbol | N/A `CardDefinition.rarity?: string`; metadata only. |

### 5.3 Characters
| Rule | Quote | Status |
|------|-------|--------|
| 5.3.1 | Characters are a card type that can be in play; only "character" while in Play, otherwise "character card" | ✅ `cardType: "character"` on CardDefinition. The "character vs character card" terminology distinction maps to zone (in Play = character; elsewhere = card). |
| 5.3.2 | Characters generally played during Main Phase | ✅ Validator gates PLAY_CARD on main-phase status. |
| 5.3.3 | Characters don't list "Character" on classification line; ID'd via 5.3.3.1/.2 traits | ✅ `cardType: "character"` discriminator + at least one trait. |
| 5.3.3.1 | A character has {S} and {W} values | ✅ `CardDefinition.strength: number` + `willpower: number`. |
| 5.3.3.2 | A character has at least one classification (Alien, Ally, Broom, Captain, ...) | ✅ `traits: string[]` always populated for characters. `hasTrait` filter consumes. |
| 5.3.4 | Only characters can quest or challenge | ✅ `def.cardType !== "character"` checks |
| 5.3.5 | Character must have been in play at beginning of Set step to quest/challenge/{E} | ✅ `isDrying` check in validator |
| 5.3.6 | Characters have additional parts on their cards | ✅ See 5.3.6.1-.4 sub-rules. |
| 5.3.6.1 | Version — differentiates cards with the same name (subtitle); applies in all zones | ✅ `CardDefinition.subtitle: string`. Used in `fullName` ("Mickey Mouse - True Friend"). |
| 5.3.6.2 | Strength {S} — primary damage in challenges | ✅ `getEffectiveStrength` handles base + temporary modifiers + statBonuses. |
| 5.3.6.3 | Willpower {W} — damage threshold for banish (1.8.1.4) | ✅ Game state check banishes when damage ≥ effective willpower. |
| 5.3.6.4 | Lore Value {L} — gained on quest | ✅ `getEffectiveLore` handles base + modifiers. |

### 5.4 Actions
| Rule | Quote | Status |
|------|-------|--------|
| 5.4.1 | Actions are a card type that enters play briefly to generate an immediate effect | ✅ `cardType === "action"`. Brief Play-zone presence enforced by `pendingActionInstanceId` tracking and the cleanup at end of `applyPlayCard` (action moves to discard once `actionEffects` resolve and any pendingChoices drain). |
| 5.4.1.1 | "Action" appears on the classification line | ✅ Reflected via `cardType: "action"` discriminator on the `CardDefinition` union; renderer treats classification as part of the card-type identity. |
| 5.4.1.2 | Actions played from hand; effect resolves immediately; moved to discard | ✅ `applyPlayCard` action branch; action effects resolve inline, not through trigger stack |
| 5.4.2 | Actions are generally played during the player's Main Phase | ✅ Validator enforces main-phase gating on `PLAY_CARD`. Exceptions (out-of-turn play via TROH, etc.) are wired with `revealed: true` per 5.4.5. |
| 5.4.3 | Actions have effects, not abilities | ✅ `actionEffects` field on `CardDefinition` |
| 5.4.4.1 | Songs have "Action" and "Song" on classification line | ✅ `isSong()` checks `cardType === "action" && traits.includes("Song")` |
| 5.4.4 | Songs (parent rule) | ✅ See 5.4.4.1-.3 sub-rules. |
| 5.4.4.2 | Songs: alternate cost = exert character with ink cost ≥ song cost | ✅ `singerInstanceId` on `PlayCardAction`; validated in `validatePlayCard` |
| 5.4.4.3 | Some songs have Sing Together keyword (see 8.12) | ✅ See §8.12. `singTogetherCost: number` on CardDefinition; `singerInstanceIds[]` on PlayCardAction. |
| 5.4.5 | "Reveal" as CRD timing-exception marker — when a card is played from a private zone (hand) outside the controller's normal main-phase action structure (e.g. another player's turn, or mid-trigger resolution), oracle uses "reveal X and play it" wording. The reveal is the controller's public commitment to the chosen card | ✅ `PlayCardEffect.revealed: boolean` shipped 2026-04-30 (commit `1f21813`). When set, the engine emits a `card_revealed` GameEvent for the chosen instance just before the zone transition (hand → play), citing playerId + sourceInstanceId. **The Return of Hercules** is the only card in the corpus with this exact shape (each_player isMay → play_card sourceZone:hand revealed:true). Distinct from `reveal_top_conditional` (Mulan Reflecting, Mufasa Betrayed Leader, Let's Get Dangerous) which handles random-deck-reveal-with-conditional-play and emits its own card_revealed events. Future-proof for any "watches off-timing plays" trigger Lorcana might introduce — TROH already fires the event without needing JSON refactor. |

### 5.5 Items
| Rule | Quote | Status |
|------|-------|--------|
| 5.5.1 | Items are a card type that can be in play; only "item" while in Play, otherwise "item card" | ✅ `cardType: "item"`. |
| 5.5.2 | Items are generally played during Main Phase | ✅ Same gating as characters. |
| 5.5.3 | An item has "Item" on the classification line | ✅ Reflected via `cardType: "item"` discriminator. |
| 5.5.4 | Item activated ability can be used turn played | ✅ Tested (Eye of Fates) |

### 5.6 Locations (first appears Set 3, ~87 location cards across sets 3–11)
| Rule | Quote | Status |
|------|-------|--------|
| 5.6.1 | Locations are a card type that enter the Play zone; have willpower and optional lore value | ✅ `applyPlayCard` else-branch handles locations (no drying). `CardDefinition.moveCost` field added. |
| 5.6.2 | Locations gain lore for their controller at the Start-of-turn Set step | ✅ Set step lore gain in `applyPassTurn` (CRD 3.2.2.2). |
| 5.6.3 | Characters can be moved to a location (CRD 4.7 Move action) | ✅ `MOVE_CHARACTER` action + `validateMoveCharacter`. `movedThisTurn` flag prevents double-move. |
| 5.6.4 | Characters at a location: "while here" static/triggered abilities | ✅ `CardFilter.atLocation: "this" \| "any"` + `Condition.this_at_location`. `matchesFilter` accepts optional `sourceInstanceId` for "this" mode. |
| 5.6.5 | Locations can be challenged; have 0 {S}; deal no damage back | ✅ See 4.6.8. Bodyguard/Evasive bypassed. |
| 5.6.5.1 | Move Cost — ink needed to move a character to this location | ✅ `CardDefinition.moveCost: number` for locations. Validator deducts on MOVE_CHARACTER; `move_to_self_cost_reduction` static modifies. |
| 5.6.5.2 | Willpower {W} — locations have persistent damage; banished at damage ≥ willpower | ✅ Same GSC mechanism as characters. |
| 5.6.5.3 | Lore Value — location's player gains this much at Set step | ✅ `getEffectiveLore` for locations; Set step lore gain in applyPassTurn. |
| 5.6.6 | Locations are banished when damage ≥ willpower (same rule as characters) | ✅ Reuses `dealDamageToCard`/`banishCard`. On location banish, all characters with `atLocationInstanceId === locId` are cleaned up. |

---

## 6. ABILITIES, EFFECTS, AND RESOLVING

### 6.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 6.1.1 | Abilities apply when source is in play | ✅ |
| 6.1.1.2 | Abilities generate effects; action cards don't have abilities — they generate effects as they resolve | ✅ Action cards' `actionEffects` field is structurally distinct from the `abilities` array used by characters/items/locations. The CRD distinction maps to type-system shape. |
| 6.1.2 | Each sentence in rules text is a separate effect; ordered resolution; "do as much as possible" | ✅ Effect-array model: each ability stores `effects: Effect[]` (or `actionEffects`) where each entry is one sentence-equivalent. Resolution order is array order. CRD 1.2.3 ("do as much as possible") covered separately — silent no-op IS the correct behavior when an effect can't fully resolve. |
| 6.1.3 | Choices made as effect resolves — "Choose one: • A • B" with independent options (fizzle-on-resolution OK) | ✅ `pendingChoice` / `RESOLVE_CHOICE`. Interactive mode surfaces `choose_option` PendingChoice; non-interactive auto-picks first feasible option. Cards with this shape: **Pull the Lever!** (set 8 / P2), **Wrong Lever!** (set 8), **Trust In Me** (set 10), **Make the Potion** (set 4 / set 9). Each branch is always choosable — draw-into-empty-deck or target-none scenarios just fizzle mid-resolution; the player can still pick the branch. Distinct from 6.1.5.2 where the backup rule can genuinely force a branch. Regression 2026-04-22 (e1bdb84): `choose_option` RESOLVE path now calls `cleanupPendingAction` so action cards move to discard after the choice resolves. |
| 6.1.3a | Dynamic effect amounts (equal to a stat, count, or cost) | ✅ `DynamicAmount` union — 16+ variants: `cost_result`, `triggering_card_lore`, `triggering_card_damage`, `last_target_location_lore`, `last_resolved_target_delta`, `last_resolved_source_strength`, `song_singer_count`, `last_resolved_target_lore`, `last_resolved_target_strength`, `last_damage_dealt`, `unique_ink_types_on_top_of_both_decks`, `opposing_chars_banished_in_challenge_this_turn`, plus structured `{ type: "count" \| "target_lore" \| "target_damage" \| "target_strength", ... }` |
| 6.1.4 | "May" = optional; choosing not to has no effect | ✅ `isMay` flag on effects; `choose_may` PendingChoice; accept/decline flow in processTriggerStack |
| 6.1.4a | "Choose any number of [players/targets]" — controller selects a subset (including empty) | ✅ Multi-select chooser shipped 2026-04-30 (commit `d16d379`) for the player-subset case. `EachPlayerEffect.scope: "chosen_subset"` surfaces a `choose_players_subset` PendingChoice to the caster with all players selectable; CRD 6.1.4 "any number" allows the empty selection (`optional: true`). Resolver populates `_iterations` with the picked subset and re-applies. **Beyond the Horizon** is the only card in the corpus with this wording. UI branch in `PendingChoiceModal.tsx`. 5 reducer tests in `set5-set8.test.ts`. (For "any number of chosen X" target chooser — Heads Held High, Leviathan, etc. — that uses the existing `count: "any"` field on `chosen` CardTarget, not this new primitive.) |
| 6.1.5 | Sequential effects: a player makes a decision or pays a cost to resolve. Three forms: "[A] to [B]" / "[A] or [B]" / "[A]. If you do, [B]" | ✅ Three primitives cover all three forms: `sequential` Effect for "A to B" (cost-then-reward), `choose` Effect for "A or B" (modal with feasibility gating), and pre-effect `condition` field on the [B] effect for "A. If you do, B" (gates the second effect on the result of the first via `lastEffectResult` / `lastResolvedTarget`). |
| 6.1.5.1 | Sequential effects: [A] to [B] — cost must resolve before reward | ✅ `SequentialEffect` with `costEffects[]` → `rewardEffects[]`; `canPerformCostEffect()` pre-check. `triggeringCardInstanceId` must be forwarded through `applyEffect` and stored on `choose_may` PendingChoice — see CLAUDE.md critical bug patterns |
| 6.1.5.2 | Sequential "[A] or [B]" — player must choose one; if [A] can't be chosen, must choose [B] | ✅ `ChooseEffect` with `options: Effect[][]` — same primitive as 6.1.3, but here `canPerformChooseOption()` can return false when an option has a hard gate (no legal target, cost that can't be paid). The runtime forces the other branch; interactive UI hides the infeasible option. Cards where the backup rule genuinely fires (option can be unchoosable, not just fizzle-on-resolution): **Madam Mim - Snake** (JUST YOU WAIT — "banish her or return another chosen character of yours" forces banish when you control no other characters), **Megara - Captivating Cynic** (SHADY DEAL — "choose and discard a card or banish this character" forces self-banish with an empty hand), **Containment Unit** (POWER SUPPLY — same "discard or banish this item" shape). Contrast with 6.1.3 cards whose options only fizzle-on-resolution. |
| 6.1.6 | "Another" / "other" refers to any card the effect doesn't originate from, OR one not already selected by the ability | ✅ `CardFilter.excludeSelf: boolean` excludes the ability source. Used by 30+ cards (Lyle Tiberius Rourke EXPLOSIVE, Brave Little Tailor, Mickey Musketeer Captain MUSKETEERS UNITED, Robin Hood Eye for Detail, etc.). For "or one already selected" scope, the chooser intrinsically excludes already-picked targets via `validTargets` filtering at PendingChoice surface time. |
| 6.1.7 | "For free" = ignore all costs | ✅ Same as 1.5.5.3. |
| 6.1.7.1 | "For free" applies to using an ability — ignore all costs to use that ability | ⚠️ Same scope as 1.5.5.4 — no current card distinguishes "use ability for free" from "play card for free." Would route through a new flag if printed. |
| 6.1.8.1 | "Until" wording on draw/discard quantity (e.g. "draw until you have N") | ✅ `draw.untilHandSize` field accepts number (Yzma, Clarabelle) or `"match_opponent_hand"` (Remember Who You Are). `discard_until` Effect for the discard side (Goliath Clan Leader DUSK TO DAWN, Prince John's Mirror). |
| 6.1.8 | "For each" — defines single number used in subsequent effect | ✅ `lastEffectResult` on GameState; `amount: "cost_result"` on DrawEffect |
| 6.1.9 | Keywords: bold short names representing one or more abilities (see §8) | ✅ `Keyword` union union with 17 keywords (alert, bodyguard, boost, challenger, evasive, reckless, resist, rush, shift, sing_together, singer, support, vanish, ward, plus classification-shift / universal-shift sub-types). Reminder text rendered by `renderKeywordWithReminder`. |
| 6.1.10 | Loops (combinations of abilities that can repeat indefinitely) — players agree on iteration count or game ends | N/A No card in current corpus creates a loop. The engine doesn't have explicit loop detection — if a future card creates one, infinite recursion would manifest as a stack overflow or `pendingEffectQueue` growth. Loop-detection is a design backlog item if/when needed. |
| 6.1.11 | "That" in card text references specific card mentioned earlier; if "that" card changed zones, effect fails (6.1.11.1) | ✅ `rememberedTargetIds` on CardInstance tracks specific instances (Elsa's Ice Palace, Containment Unit). `lastResolvedTarget` snapshots card for follow-up effects. Zone checks in effect resolution paths naturally fail if card left play. Ursula Deceiver uses `thenPutOnBottomOfDeck` which checks card is still in discard. |
| 6.1.11.1 | If card text references a specific zone for "that" card, only that zone is checked | ✅ `play_card.target.type === "from_last_discarded"` reads from discard zone specifically; `thenPutOnBottomOfDeck` re-checks the card's current zone before moving. Per-effect zone scoping is structural in the type-system. |
| 6.1.12 | Some abilities apply outside play zone (from hand) | ✅ `SelfCostReductionStatic` checked at play time from hand |
| 6.1.13 | Duration mechanics: "this turn", "end of turn", etc. | ✅ `timedEffects[]` with `expiresAt: end_of_turn / rest_of_turn / end_of_owner_next_turn`. Expiry in applyPassTurn. "Once per turn" supported via `oncePerTurn?: boolean` flag on TriggeredAbility + ActivatedAbility, tracked via `oncePerTurnTriggered` map on CardInstance. "Once during your turn" = `oncePerTurn` + `condition: { type: "is_your_turn" }`. |
| 6.1.13.1 | "During" — applies only at the specified moment / period | ✅ `condition: { type: "is_your_turn" }` for "during your turn"; `condition: { type: "not", condition: { type: "is_your_turn" }}` for "during opponents' turns" (Yao Snow Warrior, Koda Talkative Cub). Re-checked on every read via `getGameModifiers`. |
| 6.1.13.2 | "Once" — can happen only a single time within the specified period; checks if already resolved | ✅ `oncePerTurn?: boolean` flag on TriggeredAbility + ActivatedAbility. `CardInstance.oncePerTurnTriggered: Set<string>` tracks per-key resolution; cleared at PASS_TURN. The "two abilities with the same name check independently" sub-rule is honored by per-instance keying. |
| 6.1.13.3 | "Until" — applies up to a defined moment; effect generated immediately | ✅ Duration values `until_caster_next_turn` (start of caster's next turn), `end_of_owner_next_turn` (end of affected card's owner's next turn) — see CLAUDE.md "Critical bug patterns" for the caster-vs-owner distinction. |
| 6.1.13.4 | "This turn" — applies from generation until that player's End-of-Turn Phase | ✅ Duration values `this_turn` / `end_of_turn` / `rest_of_turn` (synonyms — all mapped to PASS_TURN expiry). |
| 6.1.13.5 | "While" — applies only if defined condition is true; "while here" variant for locations | ✅ Static abilities with `condition` field re-evaluated on every `getGameModifiers` call. "While here" supported via `CardFilter.atLocation: "this"` in static-effect targets. |
| 6.1.13.6 | Multiple-duration abilities active only when ALL durations apply | ✅ `condition: { type: "compound_and", conditions: [...] }` AND-chains arbitrary conditions. Per-effect `duration` field also composable with conditional gates. |
| 6.1.14 | Some effects instruct the active player to reveal a card or cards | ✅ `card_revealed` GameEvent emitted from multiple effect paths: `look_at_top` reveal-picks, `reveal_top_conditional`, `peek_and_set_target`, `reveal_hand`, `play_card.revealed: true` (TROH per 5.4.5). UI/log/replay all consume the event. |
| 6.1.14.1 | To reveal: player shows the card face to all other players; can only reveal from the group described in the effect | ✅ Each reveal path narrows its candidate pool: `look_at_top` reveals only from the peeked top-N, `reveal_hand` reveals the entire hand, `reveal_top_conditional` reveals only the top card. The "group described" constraint is structural — no card can reveal from a zone the effect didn't enumerate. |
| 6.1.14.2 | Revealed cards remain revealed only as long as the effect applies; once it ends, they're no longer revealed | ✅ `card_revealed` GameEvents are point-in-time markers; `state.lastRevealedCards` (instance IDs) persists for one action window then clears. Subsequent state-filtering for non-owner players redacts the card identity again. |

### 6.2 Triggered Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.2.1 | Trigger fires once per condition met | ✅ |
| 6.2.2 | Triggered effects start with "When", "Whenever", "The first time", "The next time", "At the start/end of" | ✅ Trigger discriminator wording maps to engine `TriggerEvent.on` values. Ordering modifiers ("first time", "second time") use `oncePerTurn` + per-turn counters. |
| 6.2.3 | Triggered abilities go to bag (our: `triggerStack`) | ✅ |
| 6.2.4 | Secondary "if" condition checked when effect resolves (not when triggered) | ✅ `evaluateCondition()` called in processTriggerStack before resolving effects. 20+ condition types supported including: self_stat_gte, compound_and, songs/actions_played_this_turn_gte, this_has_no_damage, not, played_via_shift, triggering_card_played_via_shift, cards_in_zone_gte (with cardType filter), has_character_with_trait (with excludeSelf). See CARD_ISSUES.md. |
| 6.2.5 | "[Trigger Condition], [Effect]. [Effect]." — both effects linked to the trigger; second effect doesn't re-check trigger | ✅ Multi-effect triggered abilities store `effects: Effect[]` — all effects share the trigger and resolve in array order. The trigger condition is checked once on queueing (and again at resolution time per 6.2.4 if there's an `if` clause). |
| 6.2.6 | "[Trigger Condition] and [Trigger Condition], [Effect]." — functions as two separate triggers sharing one body | ✅ `TriggeredAbility.trigger` allows `anyOf: TriggerEvent[]` (multi-trigger combinator) — Hiram-class abilities. Each TriggerEvent in the array fires the same effects. CLAUDE.md's "structural fidelity" rule cites this as one-printed-ability = one-JSON-ability even when there are multiple trigger conditions. |
| 6.2.7 | Some abilities create a triggered ability that occurs only during a specific duration or condition | ✅ See 6.2.7.1 (floating triggers) and 6.2.7.2 (delayed triggers). |
| 6.2.7.1 | Floating triggered abilities (created by resolving effects; last a duration) | ✅ `floatingTriggers[]` on GameState. `CreateFloatingTriggerEffect` creates them; cleared at end of turn. Checked during event dispatch. |
| 6.2.7.2 | Delayed triggered abilities (fire at a specific later moment) | ✅ `delayedTriggers[]` on GameState. `CreateDelayedTriggerEffect` stores them; resolved at end_of_turn or start_of_next_turn in applyPassTurn. Fizzle if target left play. Candy Drift wired + tested. |

### 6.3 Activated Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.3.1 | Activated abilities are abilities on a card in play that the player chooses to use during Main Phase | ✅ `ActivatedAbility` interface; ACTIVATE_ABILITY action validates card is in play + has the ability index. |
| 6.3.1.1 | {E} ability on character requires dry character | ✅ |
| 6.3.1.2 | Item/location activated ability usable turn played | ✅ |
| 6.3.2 | Player may use an activated ability while no effects are pending and they're not questing/in-challenge | ✅ Validator gates on `state.pendingChoice === null` (or === undefined depending on shape). Engine doesn't have a partial-quest or partial-challenge state — those resolve atomically before control returns. |
| 6.3.3 | Triggered abilities from activating an ability go to bag, resolve after the activated effect | ✅ Same as 4.4.5 — `processTriggerStack` runs after activation completes. |

### 6.4 Static Abilities
| Rule | Quote | Status |
|------|-------|--------|
| 6.4.1 | Active while card in play | ✅ `getGameModifiers()` scans in-play cards |
| 6.4.2 | Static abilities come from two sources: a resolved effect or a card in play (continuous + applied) | ✅ Resolved-effect statics: `globalTimedEffects[]` for continuous (Restoring Atlantis), per-card `timedEffects[]` for applied (default). Card-in-play statics: read from `CardDefinition.abilities` filtered to `type: "static"` and applied via `getGameModifiers`. |
| 6.4.2.1 | Continuous static from resolved effect affects all matching cards (including newly played) | ✅ `globalTimedEffects[]` on GameState. Effects with `continuous: true` store a GlobalTimedEffect; `getGameModifiers` applies to all matching cards. Restoring Atlantis wired + tested. |
| 6.4.2.2 | Applied static from resolved effect affects only cards in play at resolution time | ✅ Default behavior — per-card `timedEffects` only affect the specific card instances they're attached to. |
| 6.4.2.3 | Continuous static from card in play loses effect when card leaves play | ✅ `getGameModifiers()` recalculates on every call |
| 6.4.3 | Conditional static abilities — apply only when condition met | ✅ `condition` field on StaticAbility; `evaluateCondition()` called in gameModifiers.ts before applying |
| 6.4.4 | Conditional statics tie condition+effect with "unless" or "if" (some "if" forms are triggered abilities — see 6.2.4) | ✅ Both wordings route through the same `condition` field. The decompile renderer distinguishes "If X, Y" (ongoing static) from "While X, Y" (alternative phrasing for the same primitive) — Lorcana picks per-card. The triggered-ability "if" form (gating a triggered effect's resolution) is separate and lives on `TriggeredAbility.condition`. |
| 6.4.4.1 | "[Effect] unless [Condition]" — effect doesn't apply while condition is true | ✅ `condition: { type: "not", condition: <inner> }` inverts the gate. Treasure Guardian Protector of the Cave WHO DISTURBS MY SLUMBER? wraps `not(this_at_location)` to render "this character can't challenge or quest unless it is at a location." |
| 6.4.4.2 | "If [Condition], [Effect]" — effect applies while condition is true | ✅ Bare `condition` field; the more common form. Mulan Ready for Battle NOBLE SPIRIT/FIGHTING SPIRIT (`you_control_matching` filters), Bill the Lizard Chimney Sweep NOTHING TO IT, etc. |
| 6.4.4.3 | "[Effect] if [Condition]" — same semantics as 6.4.4.2, just clause-reversed | ✅ Same primitive. Renderer chooses clause order based on oracle wording (decompile-cards detects which form to emit). |
| 6.4.5 | "Skip [Step/Phase]" effects — the skipped step/phase doesn't happen; abilities from it don't fire | ✅ `SkipDrawStepSelfStatic` implemented for Arthur — skips Draw step in applyPassTurn |

### 6.5 Replacement Effects
| Rule | Quote | Status |
|------|-------|--------|
| 6.5.1 | Replacement effects wait for a condition and partially/completely replace the event as it resolves | ✅ Multiple patterns implemented: `damage_redirect` (Beast), `damage_prevention_static` (Baloo, Hercules, Lilo — incl. `chargesPerTurn`), `challenge_damage_prevention` (Raya), `self_replacement` (48 cards). No single unified "general replacement system" — each pattern is a distinct effect/modifier — but every card that needs one is wired. |
| 6.5.1.1 | Abilities with "instead" are the most common type | ✅ `SelfReplacementEffect` handles conditional "do X instead" patterns uniformly: `effect: []` default branch, `instead: []` replacement branch, `condition: CardFilter \| Condition`. Turbo Royal Hack, Hidden Trap BLINDING CLOUD, Consult the Spellbook all wired this way. |
| 6.5.2 | Event = resolution of an effect as a whole; multi-effect events are one event | ✅ Each `applyEffect` call is one event boundary. Multi-effect abilities (multiple sentences in `effects[]`) resolve as separate events — matches CRD's per-sentence-is-an-effect rule (6.1.2). The `_iterations` machinery in `each_player` and similar combinators properly nests events. |
| 6.5.3 | For an event to be replaced, the replacement effect must exist AND be able to apply when the event would happen; can't replace already-happened events | ✅ Replacement primitives are checked at the event-resolution point (e.g. `dealDamageToCard` consults `damage_redirect` modifier; challenge damage step consults `challenge_damage_prevention`). Once damage is applied, no further replacement attempts. |
| 6.5.4 | Replaced events never happen; their triggers don't fire | ❌ Not enforced — `damage_redirect` and `damage_prevention_static` still fire damage-dealt/damage-taken triggers on the redirected path. Works for current cards because no card's trigger is "damage would be dealt" in a way that conflicts. |
| 6.5.5 | A replacement effect has only one chance per event; once applied, can't apply to the same event again even if modified | ✅ Charge counters enforce this for the per-source case: `damage_prevention_static.chargesPerTurn:1` (Lilo Bundled Up) and `damage_prevention_timed.charges:1` (Rapunzel Ready for Adventure) self-decrement on application. For non-charged replacements (Beast `damage_redirect`), the replacement is structural — the redirected damage isn't "the same event," it's a new put-damage on the redirector's source. |
| 6.5.6 | Self-replacement effects (within same ability) always apply first | ✅ `SelfReplacementEffect` — condition evaluated at resolution time, branches are mutually exclusive, always apply before cross-card replacements can see the event. Tested in `dynamic-amount.test.ts`, `set4.test.ts`, `set5-set8.test.ts`, `set12.test.ts`. |
| 6.5.7 | Multiple replacement effects: affected player chooses order | ❌ Not implemented — no current card pair has two replacements competing on the same event. Would matter if, say, two bodyguard-style redirects existed simultaneously. |
| 6.5.7.1 | First, if any self-replacement effects can apply, choose one and proceed to 6.5.7.2 | ❌ Self-replacement (6.5.6) ordering is currently single-source-per-event. If two self_replacement effects could apply on the same event (none do today), no chooser surfaces. |
| 6.5.7.2 | Second, if any other replacement effects can apply, choose one | ❌ Same scope as 6.5.7. |
| 6.5.7.3 | After applied, modified event occurs; repeat process for additional replacements | ❌ Same scope. The "modified event" loop isn't structurally enforced. |
| 6.5.8 | Same replacement effect can't apply twice to same event | ❌ Not implemented — same applicability condition as 6.5.7. `damage_prevention_static` with `chargesPerTurn:1` (Lilo) independently enforces once-per-turn via its own charge counter, not via 6.5.8's general rule. |

### 6.6 Ability Modifiers
| Rule | Quote | Status |
|------|-------|--------|
| 6.6.1 | Ability modifiers restrict actions for a duration or while source in play | ✅ Unified query `isActionRestricted()` checks both `TimedEffect` (per-card debuffs) and `ActionRestrictionStatic` (board-level rules). `RestrictedAction` type covers quest/challenge/ready/play/sing. |
| 6.6.1.1 | Modifier applies continuously, either for fixed duration or while source remains in play | ✅ Two paths: `TimedEffect` (per-card with `expiresAt`) + `getGameModifiers` recomputation (resets when source leaves play). |
| 6.6.1.2 | Multiple modifiers don't apply in a specific order — they all combine into a final value | ✅ `getGameModifiers` sums all stat bonuses across all sources before clamping (Math.max with stat floors). Order-independent because the operations are commutative addition. |
| 6.6.2 | Negative {S} deals no damage during challenges; counts as having Strength of 0 | ✅ `Math.max(0, ...)` in `getEffectiveStrength` |
| 6.6.3 | Negative Lore value {L} counts as having Lore value of 0 | ✅ `Math.max(0, ...)` in `getEffectiveLore` |
| 6.6.4 | "Can't be reduced below" specified value — characteristic floor after all modifiers | ✅ `StatFloorPrintedStatic` |

### 6.7 Resolving Cards and Effects
| Rule | Quote | Status |
|------|-------|--------|
| 6.7.1 | To resolve a played card: take the actions immediately after the card is "played" (4.3.3), dependent on card type | ✅ `applyPlayCard` dispatches by `def.cardType`: characters/items/locations enter Play zone with state setup (isDrying for chars, atLocation for moved characters); actions resolve their `actionEffects` inline then move to discard. Shift onto same-named target handled by the `shiftTargetInstanceId` branch. |
| 6.7.1.1 | Character/item/location enters Play zone; Shift goes on top of indicated card | ✅ `zoneTransition` → `play` for non-action types. Shift uses the `shiftTargetInstanceId` to inherit damage / dryness / atLocationInstanceId from the base, then the under-card moves to `zone: "under"`. |
| 6.7.2 | To resolve an effect: 4-step process | ✅ See sub-rules. |
| 6.7.2.1 | First: if effect uses "for each" to define a number, count it (per 6.1.8) | ✅ `lastEffectResult` snapshots the count value at the moment of effect resolution. DynamicAmount evaluation happens at this step. |
| 6.7.2.2 | Second: check for any replacement effects that would apply | ✅ Replacement check happens at the event-resolution boundary in `dealDamageToCard` / `applyEffectToTarget` for self_replacement / damage_redirect / damage_prevention. |
| 6.7.2.3 | Third: if effect deals damage, calculate total damage (per Resist, +N stat etc.) | ✅ `dealDamageToCard` applies Resist (8.8.1) before placing counters; `ignoreResist` bypasses for "put" damage. |
| 6.7.2.4 | Fourth: perform effect's instructions and choices | ✅ Each Effect handler in `applyEffect` / `applyEffectToTarget` runs the actual mutation. PendingChoice surfaces inline if needed. |
| 6.7.3 | Triggered abilities during resolution go to bag, won't resolve until current effect completes | ✅ `queueTrigger` / `queueTriggersByEvent` add to `triggerStack` mid-resolution; `processTriggerStack` is called after the top-level effect completes. |
| 6.7.4 | A game state check occurs after every effect resolves (1.8.1) | ✅ `runGameStateCheck` called from multiple call sites — after every applyAction, after applyPassTurn end-of-turn triggers, after applyChallenge declaration, after every timed-effect expiry. |
| 6.7.5 | If multiple players act simultaneously, active player goes first | ✅ For 2P: `each_player` iterates active player first per CRD 7.7.4 turn order. For 3+P, multiplayer bag-passing not implemented. |
| 6.7.6 | If ability references card characteristic but card left play → use last known value | ✅ `lastResolvedTarget`/`lastResolvedSource` snapshot card stats (strength, lore, damage, ownerId) at choose-target time. DynamicAmount variants (`last_resolved_target_strength`, `last_resolved_source_strength`, etc.) read these snapshots. Covers all current cards. |
| 6.7.7 | Playing a card during resolution — sub-card's effects wait until parent finishes resolving (6.7.7.1: sub-action's effect resolves after parent but before bag) | ✅ `play_for_free` resolves inline during parent action. Sub-card triggers go to bag. `pendingEffectQueue` resumes remaining parent effects after sub-card's pending choices resolve. Bag processes after all effects complete. |
| 6.7.7.1 | Effect from sub-action resolves AFTER the parent card finished, BEFORE the bag | ✅ Sub-action effects via `play_for_free` resolve inline; their `actionEffects` run after parent's primary effect, before the trigger stack drains. |
| 6.7.8 | Some effects modify how a card enters play; these resolve along with the card being played | ✅ `enterExerted` flag, `grantKeywords` for granted-on-play (Mystical Inkcaster), `banishAtEndOfTurn` (Gruesome and Grim) — all applied during the play resolution, not as separate triggered events. |

---

## 7. ZONES

### 7.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 7.1.1 | All zones are separate from one another (even if physically co-located) | ✅ `state.zones[playerId]` keys: `deck`, `hand`, `play`, `discard`, `inkwell`. Plus the per-instance subzone `under` (cards-under stack — has no zone-array entry, lives in `cardsUnder` on the parent instance). Each zone's contents are tracked separately and ID-disjoint. |
| 7.1.2 | Cards in a public zone are publicly known; players can look at or count any time | ✅ Public zones: `play`, `discard`, `inkwell` (count-only — see 7.5.4 below for the inkwell exception), `bag` (the trigger stack). State filtering for multiplayer / anti-cheat (`filterStateForPlayer`) preserves full identity for public-zone cards. |
| 7.1.2.1 | The public zones are: play, discard, and the bag | ✅ Three public zones recognized in `filterStateForPlayer` as not-redacted. (Inkwell is technically public for COUNT but private for identity — see 7.5.4.) |
| 7.1.3 | Cards in a private zone aren't publicly known unless directed by rule/effect | ✅ Private zones: `hand`, `deck`. `filterStateForPlayer` redacts the `definitionId` of private-zone cards for non-owner players (cards become "facedown" stubs in the filtered state). Server-side anti-cheat enforces this on every state push. |
| 7.1.3.1 | The private zones are: hand, deck, and inkwell | ✅ Three private zones in `filterStateForPlayer` redaction list (inkwell is identity-private, count-public per 7.5.4). |
| 7.1.4 | Private zone search: player may fail to find. Public zone search: must find if able | ⚠️ `search` effect (tutor) allows "up to N" — player can choose 0 from deck (private). Discard search doesn't enforce must-find for public zone. |
| 7.1.5 | Card exists in only one zone at a time | ✅ Layer 3 invariant test |
| 7.1.6 | When card leaves play, gained effects/damage removed; becomes "new" card | ✅ `zoneTransition` reset block clears: damage, isExerted, isDrying, temp stat modifiers, grantedKeywords, timedEffects, atLocationInstanceId, movedThisTurn, oncePerTurnTriggered, playedViaShift, challengedThisTurn. |
| 7.1.6.1 | Effects from played actions resolve BEFORE triggered abilities in the bag | ✅ `applyPlayCard` resolves the action's `actionEffects` inline before `processTriggerStack` runs. Per CRD 6.7.7.1 ordering. |

### 7.2 Deck
| Rule | Quote | Status |
|------|-------|--------|
| 7.2.1 | Player's deck = the set of cards they start with; held during the game; drawn from | ✅ `state.zones[playerId].deck: string[]` ordered top-to-bottom. `applyDraw` pops from index 0. `shuffleDeck` randomizes ordering deterministically via the seeded RNG (`state.rng.s`). |
| 7.2.3 | If cards added to top/bottom "in any order" and any were faceup, the order must be known by all players | ✅ `choose_order` PendingChoice surfaces when reveal+order semantics apply (Vision of the Future, Hypnotic Deduction reveal-then-place). All revealed cards stay in `state.lastRevealedCards` so spectators can verify the chosen order. |
| 7.2.3.1 | If faceup cards are in stacks (or stacks mix faceup/facedown), order must still be known | ✅ Stack-aware reveals follow same `choose_order` semantics — faceup cards in the order pool are publicly identified. Mixed-state stacks (e.g. some faceup, some facedown after a put-under sequence) preserve facedown identity per 5.1.1.10. |

### 7.3 Hand
| Rule | Quote | Status |
|------|-------|--------|
| 7.3.1 | Player's hand holds drawn cards; opening hand is 7 cards (2.2.1.4) | ✅ `state.zones[playerId].hand: string[]`. Opening hand size is 7 dealt by the setup flow. No hand size limit during play (Lorcana doesn't cap hand size — distinct from MTG). |
| 7.3.2 | Hand is private; players can look at their own but not others'; counts are public | ✅ `filterStateForPlayer` redacts non-owner hand identities; counts via `state.zones[opp].hand.length` remain visible. |
| 7.3.3 | No max hand size; min 0 cards | ✅ No hand-size cap enforced. Empty hand is valid game state. |
| 7.3.4 | Discarding from hand: player chooses, puts in discard | ✅ `discard_from_hand` Effect with `chooser: "controller"` (default — player picks) or `"target_player"` (opponent picks for self) or `"random"` (engine picks). |

### 7.4 Play
| Rule | Quote | Status |
|------|-------|--------|
| 7.4.1 | Characters/items/locations can be in Play zone | ✅ All three card types can be in play zone. |
| 7.4.2 | The Play zone is public; players can look/count any time; players can rearrange their Play zones | ✅ Play zone state is fully visible to all players (no `filterStateForPlayer` redaction for `zone: "play"`). The "rearrange in any way" UI affordance is a sandbox concern; the engine doesn't impose ordering on `state.zones[playerId].play[]` beyond insertion order. |
| 7.4.2.1 | Facedown cards in Play are private (e.g. cards-under from Boost) — exception to play-zone-is-public | ✅ Facedown play-zone cards have `isFaceDown: true` and `filterStateForPlayer` redacts their `definitionId` for non-owner players, even within the Play zone. Specifically applies to cards-under (Boost / put_top_card_under) which are physically in play but face-down. |
| 7.4.3 | When 1+ cards leave play, triggered abilities "see" other cards leaving simultaneously (Lyle Rourke: "whenever one of your other characters is banished" fires for each other character banished at the same time) | ✅ `is_banished` triggers fire per-card per CRD 1.6.1 exceptions (fire even after card left play). Lyle Rourke + Be Prepared works: each banish queues its triggers, Lyle's ability fires for each other character banished. Triggers are processed after all banishes complete. |

### 7.5 Inkwell
| Rule | Quote | Status |
|------|-------|--------|
| 7.5.1 | Inkwell holds ink cards; each = 1 {I}; nothing on the front affects ink | ✅ `state.zones[playerId].inkwell: string[]` count = total ink. `state.players[playerId].availableInk` tracks how much is unspent. Ink generation is identity-blind — `Sapphire`/`Ruby`/etc. ink colors only matter for deck construction, not play. |
| 7.5.2 | Cards put into inkwell are facedown and ready; multi-card adds are separate instances | ✅ `put_into_inkwell` Effect sets `isFaceDown: true` and `isExerted: false` on each instance moved into the inkwell zone. Each instance is independently addressable. |
| 7.5.3 | No limit on inkwell size | ✅ No hand-size or inkwell-size cap enforced in any validator. |
| 7.5.4 | Inkwell is private — no looking even at own; count is public | ✅ State filtering: inkwell card identities are redacted to non-owner. Count visibility is preserved (the array length is public information; only the indexed contents are redacted). |
| 7.5.5 | Effects allowing "additional" cards into inkwell follow normal inking steps (4.2.3.1) | ✅ `extra_ink_play` StaticEffect grants additional ink plays via `extraInkPlaysGranted` counter; uses the same PLAY_INK action with `inkPlaysThisTurn` accounting. Belle Strange But Special wired. |
| 7.5.6 | Effects that put cards from another zone into inkwell don't reveal, don't require the inkwell symbol | ✅ `put_into_inkwell` Effect bypasses inkable-symbol validation (Fishbone Quill, Razoul Wickedly Loyal). Cards enter facedown without identity reveal. |

### 7.6 Discard
| Rule | Quote | Status |
|------|-------|--------|
| 7.6.1 | Discard is generally where cards that have left play are held | ✅ `state.zones[playerId].discard: string[]`. Banished cards, discarded cards, exhausted actions all land here. Public zone. |
| 7.6.2 | Discard pile is public; cards remain faceup in a single pile | ✅ Discard zone identity is fully visible to all players; no redaction in `filterStateForPlayer`. |
| 7.6.3 | If multiple cards enter discard simultaneously, owner picks the order | ✅ Implementation order: cards enter discard in the order they're processed by the effect chain. No `choose_order` PendingChoice surfaces for discard ordering — current cards don't reference discard order in any mechanically-relevant way. |

### 7.7 Bag
| Rule | Quote | Status |
|------|-------|--------|
| 7.7 | Triggered abilities queue in bag; resolved in order | ✅ `triggerStack` in `GameState` |
| 7.7.1 | Bag isn't a physical space — only where triggered abilities wait to resolve | ✅ `state.triggerStack: TriggerStackEntry[]` is logical-only; not a CardInstance container, just an ordered queue of (ability, sourceInstanceId, controllingPlayerId) tuples. |
| 7.7.2 | Only triggered abilities go in the bag; activated abilities, resolving actions, and playing cards do NOT | ✅ Only `queueTrigger` / `queueTriggersByEvent` add entries. Activated abilities resolve inline (`applyActivateAbility`); actions resolve their `actionEffects` inline; PLAY_CARD resolves enters_play triggers but the play itself isn't queued. |
| 7.7.3 | Triggered abilities are added by the player whose card generated them | ✅ Each `triggerStack` entry carries `controllingPlayerId` set to the card's owner. The active player's choices during resolution don't change this; if Player B's card triggers during Player A's turn, Player B is the controller of the resolution. |
| 7.7.3.1 | Whenever a trigger condition is met, the ability is added to the bag by the player whose card generated it | ✅ `queueTrigger(state, on, sourceInstanceId, ...)` always sets controllingPlayerId from the source card's owner — even if the active player triggered the condition. |
| 7.7.4 | Bag resolution order: active player resolves first, then passes to next player in turn order | ✅ triggerStack sorted: active player's triggers first (stable sort preserves within-player order). Interactive mode surfaces choose_trigger for manual ordering. |
| 7.7.4.1 | The bag checks which players have abilities in the bag | ✅ `processTriggerStack` partitions the stack by controllingPlayerId on each pass; resolves active-player triggers first, then opponent's. |
| 7.7.4.2 | If active player has any triggered abilities, they choose one of theirs and fully resolve it | ✅ Interactive mode surfaces `choose_trigger` PendingChoice when the active player has multiple bagged triggers (lets them pick resolution order). Non-interactive: stable sort + first-come-first-served. |
| 7.7.4.3 | After resolution + GSC, bag re-checks for more triggered abilities | ✅ `processTriggerStack` is a `while (state.triggerStack.length > 0)` loop that runs GSC after each iteration. |
| 7.7.4.5 | Continues through all players in turn order until no more triggered abilities; then game continues | ✅ Loop terminates when triggerStack is empty AND no new triggers were queued during the last pass. |
| 7.7.5 | Trigger added by currently resolving player → seen by next bag check, can resolve next | ✅ Triggers queued during resolution are appended to triggerStack and processed on next iteration. |
| 7.7.6 | Trigger added by non-resolving player → waits until that player's turn to resolve from bag | ⚠️ 2-player only — active player resolves first (7.7.4), then opponent. New triggers from opponent during active player's resolution do wait. Multiplayer bag-passing not implemented. |
| 7.7.7 | If a player leaves the game while their abilities are in the bag, those abilities cease to exist | N/A No concession / leave-game flow currently. Engine-level: any code path that strips a player would need to filter `triggerStack` by controllingPlayerId. Documented for future when concede / multiplayer leave is implemented. |

---

## 8. KEYWORDS

### 8.1 General
| Rule | Quote | Status |
|------|-------|--------|
| 8.1.1 | Keywords are abilities or combinations of abilities represented by short names + reminder text in parens | ✅ `Keyword` union (17 entries). Reminder text rendered by `renderKeywordWithReminder` for human-readable display; engine evaluates keywords structurally via `hasKeyword` / `getKeywordValue`. |
| 8.1.2 | Non-+N keywords don't stack; +N keywords stack | ✅ +N keywords (Challenger, Resist, Singer) stack via `getKeywordValue` summation. Non-+N keywords (Ward, Evasive, Rush, Bodyguard, etc.) are boolean — `hasKeyword` returns true regardless of count, so no double benefit. |

### 8.2 Alert (first appears Set 10, affects ~20–30 cards across sets 10–11)
| Rule | Quote | Status |
|------|-------|--------|
| 8.2.1 | Alert: this character can challenge as if they had Evasive (ignores Evasive restriction on defenders) | ✅ `alert` in Keyword union. Validator allows Alert attackers to challenge Evasive defenders. Timed grant supported. |
| 8.2.2 | Alert doesn't grant Evasive — character can still gain Evasive from another ability/effect | ✅ Alert only bypasses Evasive restriction; does not add Evasive keyword. Separate Evasive grant still works. |

### 8.3 Bodyguard
| Rule | Quote | Status |
|------|-------|--------|
| 8.3.1 | The Bodyguard keyword represents two abilities | ✅ Modeled as the `bodyguard` keyword on `CardDefinition` + two distinct engine handlers — the may-enter-exerted prompt at play time (8.3.2) AND the must-target-Bodyguard challenge restriction (8.3.3). Single keyword unlocks both behaviors. |
| 8.3.2 | Bodyguard may **enter play exerted** | ✅ Synthesized trigger in `applyPlayCard`; `choose_may` → exert flow |
| 8.3.3 | Opponent must challenge Bodyguard before other characters if able | ✅ Tested |

### 8.4 Boost (first appears Set 6, major in Sets 8–10, ~78 cards affected)
| Rule | Quote | Status |
|------|-------|--------|
| 8.4.1 | Boost N {I}: once per turn, pay N ink to put top card of deck facedown under this character/location | ✅ `boost` Keyword + `BOOST_CARD` action + `boostedThisTurn` per-turn flag. `CardInstance.cardsUnder: string[]`, new `"under"` ZoneName. Cleanup on leave-play (CRD 8.10.5). |
| 8.4.2 | Cards under a character are used by many triggered/static effects ("if there's a card under", "for each card under", "put all cards from under into hand") | ✅ Engine primitives complete: `this_has_cards_under` Condition (Flynn), `modify_stat_per_count.countCardsUnderSelf` for "+N stat per card under" (Wreck-it Ralph POWERED UP), `cards_under_count` DynamicAmount variant, `hasCardUnder` CardFilter ("with a card under them"), `card_put_under` TriggerEvent fires from both Boost keyword cost AND `put_top_of_deck_under` effect (Webby's Diary LATEST ENTRY), `put_cards_under_into_hand` effect (Alice). Long tail of 30+ Set 10/11 card wirings still pending — the grammar supports all of them. |
| 8.4.2a | Player-wide "you've put a card under one of your characters or locations this turn" — tracked separately from the per-instance `cardsPutUnderThisTurn` counter for cards whose ability scope is the whole player, not a specific character | ✅ Shipped 2026-04-30 (commit `d99a70f`). New `PlayerState.youPutCardUnderThisTurn?: boolean` flag — set on the SOURCE owner at both put-under increment sites (`applyBoostCard` and the `put_top_card_under` effect handler), reset on PASS_TURN for both players. New Condition `you_put_card_under_this_turn` reads it. **Mulan - Standing Her Ground** FLOWING BLADE is the only consumer ("if you've put a card under one of your characters or locations this turn, this character takes no damage from challenges"). Pre-fix the wiring used the per-instance `this_had_card_put_under_this_turn` condition which only fired when Mulan herself accumulated a card-under — the player-wide variant fixes the common gameplay case where the put-under target is a different character (Cheshire Cat / Merlin / Bambi). 3 reducer tests in `set9-set11.test.ts`. |
| 8.4.3 | A card under another card is NOT considered to be in play | ✅ Critical filter rule. Under-cards have `zone: "under"` (distinct from `zone: "play"`), so `matchesFilter` with default zone-play scope excludes them. `cardsUnder` array on the parent only stores IDs — the under-card instance is reachable for stat_ref purposes (e.g. `last_resolved_source` after a Boost-banish) but isn't iterated by board-state queries. Putting a card under via Boost doesn't fire `enters_play` triggers since the card never entered the Play zone. |

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
| 8.7.1 | The Reckless keyword represents two static abilities | ✅ Single `reckless` keyword on `CardDefinition` unlocks both the can't-quest static (8.7.2) and the can't-end-turn-if-able-to-challenge static (8.7.3). |
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
| 8.12.2 | Add the ink costs of one or more ready characters together; if total ≥ Sing Together cost, they can sing | ✅ `validatePlayCard` Sing Together branch sums each `singerInstanceId`'s effective cost (printed cost + Singer +N + sing-bonus modifiers) and compares against `singTogetherCost`. Each contributing singer is exerted as part of the play; partial groups fall back to "can't sing." |
| 8.12.3 | "Whenever this character sings a song" trigger fires per-singer in Sing Together | ✅ The `sings` trigger fires once per `singerInstanceId` in the Sing Together cost, not once per song-play. Validates Alma Madrigal Accepting Grandmother THE MIRACLE IS YOU which uses `last_song_singers` PlayerTarget to ready ALL contributing singers (not just one). Tested in `set5-set8.test.ts`. |

### 8.13 Support
| Rule | Quote | Status |
|------|-------|--------|
| 8.13.1 | Support: when questing, may add this character's {S} to another chosen character's {S} this turn | ✅ Synthesized trigger in applyQuest; 7 tests |

### 8.14 Vanish (Set 7+, ~few cards)
| Rule | Quote | Status |
|------|-------|--------|
| 8.14.1 | Vanish: triggered ability — "When this character is chosen by an opponent as part of resolving an action's effect, banish this character." | ✅ RESOLVE_CHOICE handler banishes when chosen target is opposing + has Vanish keyword + `srcDef.cardType === "action"` (2026-04-22 fix: previously fired on ability-sourced choices too, violating CRD's "action's effect" scope). The broader `chosen_by_opponent` trigger keeps firing on BOTH actions and abilities — correct for Archimedes Exceptional Owl ("chosen for an action or ability"). Regression test: `mech-gaps-batch.test.ts` covers both cases. |
| 8.14.2 | Vanish trigger resolves AFTER the action's effect resolves; if character has moved zones first, resolves with no effect | ✅ The Vanish-banish runs in the RESOLVE_CHOICE handler at choice resolution time, AFTER the chosen instance has been pinned but the action's primary effect has already started. If the action banishes the Vanish character first (or otherwise moves it), the Vanish branch checks `inst.zone === "play"` before banishing — fizzles silently if the character is already gone. |

### 8.15 Ward
| Rule | Quote | Status |
|------|-------|--------|
| 8.15.1 | Ward: opponents can't choose this card when resolving an effect | ✅ Tested (choice resolution + targeting) |
| 8.15.2 | Effects that don't require choosing still affect Ward characters | ✅ Challenge works on Ward characters (tested) |

---

## 9. MULTIPLAYER

| Rule | Quote | Status |
|------|-------|--------|
| 9.1 | Multiplayer = 3+ players; team games out of scope of CRD | ❌ Engine and UI hard-code 2-player. `state.players` is a `Record<"player1" \| "player2", PlayerState>` — adding 3+P would require refactoring zones to a `Record<PlayerID, ...>`-style map and adjusting `getOpponent` (which assumes 2P) to a "next player in turn order" helper. Same scope blocker as 1.1.1. |
| 9.2 | Multiplayer follows 2P rules + augmenting rules below | N/A Out of scope. |
| 9.2.1 | Turn passes to player on the LEFT (not back-and-forth) | ❌ Hardcoded `getOpponent(p) = p === "player1" ? "player2" : "player1"`. Multiplayer turn-order would replace this with a circular list. |
| 9.2.2 | If ability requires multi-player simultaneous action, active player goes first, then proceed left | ❌ N/A — only relevant for 3+P where "simultaneous" choices need ordering. |
| 9.2.3 | Player loses → leaves game immediately; cards/effects/triggers removed; static effects with stated duration continue | ❌ No "leave game mid-game" path. Engine ends the game on the win/loss check; doesn't support a third player continuing after another concedes. Documented for future. |
| 9.3 | Some formats use simultaneous turns | ❌ Out of scope. |
| 9.3.1 | Simultaneous-turn teammates progress through phases together; turn actions interleave one-at-a-time | ❌ Out of scope. |
| 9.3.2 | Simultaneous-turn bag: triggered abilities added by team are resolved in order chosen by team | ❌ Out of scope. |

---

## 10. CASUAL GAME VARIANTS

| Rule | Quote | Status |
|------|-------|--------|
| 10.1 | Casual game variants — optional rules; not exhaustive | N/A Out of scope. The engine targets the standard format. Variant rules contradict standard rules in defined ways and aren't applicable to deck-analytics or competitive play simulation. |
| 10.1.1 | Section provides optional rules for casual variants | N/A |
| 10.1.2 | Variants follow normal rules except as defined; variant rules win on contradiction | N/A |
| 10.2 | Pack Rush variant — sealed-style format using booster packs | N/A Out of scope. |
| 10.2.1 | Each player takes 2 unopened booster packs, shuffles them together, plays one game | N/A No sealed-deck construction in the engine; deck-construction expects a pre-built `Deck` object. |
| 10.2.1.1 | No minimum deck size; deck = total cards from the two packs | N/A Pack-Rush-specific. |
| 10.2.2 | Marketing cards set aside before shuffling | N/A No marketing-card identity tracking. |
| 10.2.2.1 | Marketing cards can't be moved from inkwell to other zones | N/A |
| 10.2.2.2 | Marketing cards can't be chosen for effects | N/A |
| 10.2.3 | Pack Rush opening hand size is 5 (not 7) | N/A Engine hardcodes 7 per 2.2.1.4. |
| 10.2.4 | Pack Rush win condition is 15 lore (not 20) | N/A Standard format = 20 lore (1.8.1.1). `modify_win_threshold` static could in principle implement Pack Rush at runtime but no card-data path exists. |
| 10.2.5 | Pack Rush deck-out: shuffle discard back into deck instead of losing | N/A Standard format ends the game on deck-out (1.8.1.2). Pack Rush would need a different game-end path. |

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
| 7.7.7 | Player leaving mid-game → their bag entries cease to exist | N/A | No current concession / leave flow. Would need to filter `triggerStack` by departing player's controllingPlayerId. |
| 8.10.3 | Shifted character with own enter-play exert effect (e.g. Bodyguard) | ⚠️ | Low — Bodyguard exert is a post-play `choose_may` rather than an enter-play state override. Functionally correct (player can choose to exert via Bodyguard's may-prompt after shifting onto a ready character) but CRD says it "becomes exerted as it enters play" — strict timing may differ if a future card observes the difference. |
| §9 (all) | Multiplayer (3+P, team play, simultaneous turns) | ❌ | Low — same scope blocker as 1.1.1. Engine hardcodes 2-player turn order, opponent lookup, and bag resolution order. Refactoring would touch `state.players` shape, `getOpponent`, all `each_player` iteration logic, the multi-player bag pass, and the win-check (currently 2P-binary). No current product need. |
| §10 (all) | Casual game variants (Pack Rush) | N/A | Out of scope. Engine targets standard format; variant-specific rules contradict standard rules and aren't applicable to deck-analytics simulation. |
| 6.1.10 | Loops (combinations of abilities that repeat indefinitely) | N/A | No card in current corpus creates a loop. No explicit loop-detection — if a future card creates one, infinite recursion would manifest as a stack overflow. Backlog if/when needed. |

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

*Last updated: 2026-05-01 (session 23 — completeness pass: every numbered sub-rule in CRD v2.0.1 is now cited at least once. Coverage 458/458 numbered sub-rules = 100%. Section headers (1.1, 2.4, etc. — no third dot) are intentionally aggregated under their sub-rules and not individually tracked.)*
*CRD version: 2.0.1, effective Feb 5, 2026*
*PDF source: `docs/Disney-Lorcana-Comprehensive-Rules-020526-EN-Edited.pdf`*
*Snapshot: `docs/CRD_SNAPSHOT.txt` — see "Diffing a new CRD revision" above.*
