# Card Issues

Track unimplemented card abilities here. When importing new sets, cards with
`_namedAbilityStubs` in their JSON need abilities manually implemented and
story names (CRD 5.2.8) added via `storyName` on each ability.

Run `pnpm card-status` for a live view of per-set progress.
Run `pnpm card-status --category <name>` to list cards in a category.
Run `pnpm card-status --set <N>` to filter to one set.

---

## Implementation Strategy — two phases

Implementation approach:

**Phase A — Engine work, by mechanic, cross-set.** Each engine addition
unlocks cards across many sets at once. Order by cards-unblocked count.
Wire only one canary card per mechanic to prove the path; bulk wiring
comes in Phase B.

**Phase B — JSON wiring, by set, sequential.** Once Phase A is done, every
card maps cleanly to existing engine features. Pure JSON edits in batches
of 20–30 cards via a per-batch `scripts/implement-setN-batchM.ts` script.
Inherently per-card, naturally per-set.

**Don't interleave the phases** — wiring during Phase A means re-touching
cards when later mechanics land.

**Phase A status (post Set 3 complete):**

0. ~~Zone-aware static abilities refactor~~ — DONE. Unblocks Lilo (Set 6),
   Baymax (Set 7), Thunderbolt (Set 8). Cards still need wiring (Phase B).
1. ~~Sing Together~~ — DONE. 26 songs across Sets 4/8/9 carry
   `singTogetherCost` and validate via the new alternate-cost path.
2. ~~**Boost** (Set 6 onward, peaks Set 10)~~ — DONE (foundation + long-tail).
   Foundation: `CardInstance.cardsUnder: string[]`, new `"under"` ZoneName,
   `boost` keyword, `BOOST_CARD` action, `boostedThisTurn` per-turn flag (cleared
   at turn end + on leaving play), `this_has_cards_under` Condition. **Fixed
   Shift bug**: base card now goes UNDER the shifted character (CRD 8.10.4)
   instead of being silently discarded; cards under inherit when shifting onto
   a shifted character. When a parent leaves play, all cards under it move to
   discard (CRD 8.10.5). Canary card: Flynn Rider Spectral Scoundrel.
   Long-tail (this session):
   - `ModifyStatPerCountStatic.countCardsUnderSelf` flag — counts `cardsUnder.length`
     instead of a CardFilter for "+1 {S} for each card under him" patterns.
   - `put_cards_under_into_hand` Effect — drains source's cardsUnder to owner's
     hand, used by Alice Well-Read Whisper, Graveyard of Christmas Future, etc.
   - `getAllLegalActions` now enumerates `BOOST_CARD` for in-play boost characters
     so bots can use the mechanic.
   ~70 cards across sets 7/9/10/11 reference cards-under and now have the engine
   plumbing they need; remaining work is JSON wiring (Phase B).
3. **Long tail of needs-new-type cards** (~251 cards across all sets, down
   from 334 after categorizer cleanup) — implement engine additions in
   order of cards-unlocked count. Progress so far:
   - ~~`reveal_top_conditional`~~ (12 cards) — DONE. New effect with
     `to_hand`/`play_for_free`/`to_inkwell_exerted` match actions and
     top/bottom no-match destinations. Canary: Queen's Sensor Core ROYAL SEARCH.
   - ~~`compound_or` Condition~~ — DONE. Mirror of `compound_and`.
   - ~~`random_discard`~~ (4 cards) — DONE. `DiscardEffect.chooser: "random"`
     resolves inline (engine picks uniformly at random, no pendingChoice).
   - ~~`event_tracking_condition`~~ (6 cards) — DONE. New
     `aCharacterWasDamagedThisTurn` and `aCharacterWasBanishedInChallengeThisTurn`
     flags on PlayerState; set in dealDamageToCard, the challenge damage path,
     and the banished_in_challenge zoneTransition; cleared at PASS_TURN.
     Two new conditions: `your_character_was_damaged_this_turn` and
     `opponent_character_was_banished_in_challenge_this_turn`.
   - ~~`timed_cant_be_challenged`~~ (6 cards) — DONE. New
     `cant_be_challenged_timed` Effect that adds a `cant_be_challenged`
     TimedEffect with EffectDuration to a chosen character. validateChallenge
     consults the defender's timedEffects for the new flag.
   - **Categorizer fix**: dropped 82 false-positive needs-new-type tags.
   - Remaining clusters: small singletons (filtered-cant-be-challenged 2,
     both-players-effect 2, restrict-sing 2, play-restriction 2,
     restricted-play-by-type 2, dynamic-stat-gain 2, virtual-cost-modifier 2,
     etc.) plus various one-offs.

**Phase B status:** ~14 cards wired (Set 4 batch 1 — pre-strategy-clarification).
Will resume after Phase A is complete.

### TODO — GUI work for engine modifiers that are visibility-only
- **Merlin's Cottage** (Set 5, KNOWLEDGE IS POWER): engine sets
  `gameModifiers.topOfDeckVisible: Set<PlayerID>`. UI deck-tile component
  should consult this and render the affected players' top-of-deck card
  face-up instead of as a card back. The engine is already all-knowing so
  no engine-side info-hiding work is needed; this is purely a UI render
  conditional. Probably 5-10 lines in the deck tile component.

**unknown: 0** — all stubs categorized.

---

## Set 1 — The First Chapter

216 cards. All abilities implemented. All story names tagged. No open issues.

## Set 2 — Rise of the Floodborn

216 cards. All 162 named-ability cards implemented. Zero approximations. No open issues.

## Set 3 — Into the Inklands

226 cards (178 named-ability + 48 vanilla). Locations (CRD 5.6, 4.7, 4.6.8, 3.2.2.2)
fully implemented. `card_drawn` trigger and `oncePerTurn` ability flag wired this
session. ~7 cards remain with approximations for engine features not yet built:

- ~~**Morph - Space Goo**~~: resolved. New `canShiftOnto(shifting, target)` helper in validator.ts. CardDefinition gained `universalShift` (Baymax, Set 7+), `universalShiftTarget` (Morph MIMICRY), `classificationShift` (Thunderbolt Puppy Shift, Set 8), and `alternateNames` (Turbo, Flotsam & Jetsam). Morph wired with `universalShiftTarget: true`.
- ~~**Ursula - Deceiver of All**~~: resolved. Generalized `play_for_free` (added `sourceZone`, optional direct `target`, `thenPutOnBottomOfDeck`, plus action-effect resolution for songs played for free) + new `sings` trigger event fired from the singer in `applyPlayCard` with the song as `triggeringCardInstanceId`. Ursula's WHAT A DEAL is now a `triggered` ability on `sings` whose effect is `play_for_free` with `sourceZone: "discard"`, `target: { type: "triggering_card" }`, `thenPutOnBottomOfDeck: true`, `isMay: true`. **Bonus:** Max Goof - Chart Topper (Set 9) wired in the same pass — same `play_for_free` shape but on `quests` trigger with a song-cost-≤-4 filter instead of direct target.
- ~~**Maui - Whale**~~: resolved. New `cant_action_self` static effect + `selfActionRestrictions` modifier slot. `isActionRestricted` consults it as Source 3. Differs from `CantActionEffect` (one-shot timed debuff) — this is a permanent self-restriction tied to the source instance. Maui's THIS MISSION IS CURSED now wired as a `static` ability with `cant_action_self` / action `ready`.
- ~~**Belle's House - Maurice's Workshop**~~: resolved. New `this_location_has_character` Condition. Belle's House LABORATORY now wired as static `cost_reduction` with that condition.
- ~~**Peter Pan - Lost Boy Leader / I've Got a Dream**~~: resolved. `GainLoreEffect.amount` extended with two variants: `"triggering_card_lore"` (Peter Pan moves_to_location → location's lore) and `"last_target_location_lore"` (I've Got a Dream → readied target's location's lore). Added `state.lastTargetInstanceId` tracked alongside `lastTargetOwnerId` in choose_target resolution.
- ~~**Magic Carpet / Jim Hawkins**~~: resolved. New `MoveCharacterEffect` (`move_character`) with `character` + `location` target shapes (`this`/`triggering_card`/`chosen`). Extracted shared `performMove` helper used by both the `MOVE_CHARACTER` action (with ink) and the new effect (no ink — effects don't pay costs). Two-stage chained `choose_target` flow for `chosen + chosen` (Magic Carpet) via an internal `_resolvedCharacterInstanceId` carried on the effect clone. Wired GLIDING RIDE (Magic Carpet enters_play), FIND THE WAY (Magic Carpet activated, exert), and TAKE THE HELM (Jim Hawkins `card_played` location filter, character `this`, location `triggering_card`).
- ~~**Olympus Would Be That Way**~~: resolved. New `gain_conditional_challenge_bonus` effect + per-player `turnChallengeBonuses` field. Behaves like the Challenger keyword (only on attack, only against matching defender) but with a defender filter — needed because Challenger by rule (CRD 4.6.8) does not apply against locations, so the keyword can't be reused.
- ~~**The Sorcerer's Hat**~~: resolved. New `name_a_card_then_reveal` effect + `choose_card_name` PendingChoice subtype (string choice). Interactive: surfaces a name-a-card prompt; resolution compares to top of deck and moves to hand on match. Non-interactive (bot/sim): bot is clairvoyant — auto-names the top card and draws it. Cost fixed (was missing the 1 ink).
- ~~**Ursula - Deceiver / The Bare Necessities (set 3) / Mowgli - Man Cub (set 10)**~~:
  Resolved. `DiscardEffect.filter?: CardFilter` added; `discard_from_hand`
  pre-filters the hand and fizzles per CRD 1.7.7 if nothing matches.
  Wired up: Ursula - Deceiver (`{cardType:["action"], hasTrait:"Song"}`, controller),
  The Bare Necessities (`{cardType:["action","item","location"]}`, controller),
  Mowgli - Man Cub (same non-character filter, target_player chooser).

### ~~TODO before Set 6 — zone-aware static abilities~~ — DONE

Lorcana has abilities that function in zones other than play (CRD 6.3-ish:
"abilities function only while the card is in play unless the ability says otherwise,
or unless they define how the card may be played"). Currently `gameModifiers.ts`
only scans `zone === "play"`. Three concrete cards force this:

- **Lilo - Escape Artist (Set 6)** — "you may play this from your discard" (in-discard active)
- **Baymax (Set 7)** — Universal Shift, shifter ignores name (in-hand active)
- **Thunderbolt (Set 8)** — Puppy Shift, target must have Puppy trait (in-hand active on shifter)

Plan: add `activeZones?: ZoneName[]` to `StaticAbility` (default `["play"]`), update
the scanner loop in `gameModifiers.ts` to respect it, then:
- Move MIMICRY (Morph) back to a real `static` ability with `activeZones: ["play"]`
- Wire Universal Shift / Classification Shift / Lilo as static abilities with the right zones
- Drop `universalShift`, `universalShiftTarget`, `classificationShift` from `CardDefinition`
  (keep `alternateNames` — that's a printed-name property, not an ability)

The Morph definition flags added in Set 3 work but are a shortcut: they hide MIMICRY
from `def.abilities` and can't be granted/conditional. Land the refactor before Set 6
so Lilo, Baymax, and Thunderbolt all share one mechanism.

Engine systems built this session:
- Locations (CRD 5.6, 4.7, 4.6.8, 3.2.2.2) — full system
- `card_drawn` trigger event with player filter (Jafar Striking Illusionist)
- `oncePerTurn` ability flag (HeiHei, Peter Pan Lost Boy Leader, Pongo)
- `this_at_location` condition + `atLocation: "this" | "any"` CardFilter (while-here / while-at-a-location)
- Beast Relentless filter fix (cardType: character to avoid firing on locations)

---

## Sets 4–11 Status (as of card-status analysis)

| Set | Total | Done | Vanilla | Fits-Grammar | New-Type | New-Mechanic | Unknown |
|-----|-------|------|---------|--------------|----------|--------------|---------|
| 4   | 225   | 0    | 43      | 113          | 43       | 26           | 0       |
| 5   | 223   | 2    | 40      | 125          | 39       | 17           | 0       |
| 6   | 222   | 1    | 39      | 129          | 32       | 21           | 0       |
| 7   | 222   | 0    | 35      | 142          | 41       | 4            | 0       |
| 8   | 227   | 0    | 30      | 150          | 38       | 9            | 0       |
| 9   | 243   | 0    | 44      | 142          | 34       | 23           | 0       |
| 10  | 242   | 2    | 46      | 114          | 25       | 55           | 0       |
| 11  | 242   | 0    | 37      | 127          | 42       | 36           | 0       |

Note: "Vanilla" = no named abilities (keyword-only or blank) — already work in simulation.

---

## New Mechanics Needed (blocks ~233 cards)

These require design + new game systems before any card in the group can be implemented.
See CRD_TRACKER.md for rule numbers.

### Locations (CRD 5.6 / 4.7) — first appears Set 3, ~87 location cards total
New card type with willpower (health), optional lore, and a Move action.
Characters can be moved to a location and gain "while here" bonuses.
Locations can be challenged (deal 0 damage back; take challenger's strength).
Many character/action cards reference locations ("while at a location", "move for free").
**Scope:** new card type in engine, new MOVE action, "while here" static effect context,
location lore gain in Set step (CRD 3.2.2.2).

### Boost (CRD 8.4) — first appears Set 6, major in Sets 8–10 (~78 cards affected)
Keyword: `Boost N {I}`. Once per turn, pay N ink to put the top card of your deck
facedown under this character/location. Cards under a character are used for various
triggered/static effects ("if there's a card under her", "for each card under him",
"put all cards from under her into your hand"). Counters leave play when the character does.
**Scope:** new keyword, new CardInstance tracking (cards under), new related effects.

### Sing Together (CRD 8.12) — first appears Set 4, ~26 song cards
Alternate cost for songs: exert any number of your characters with total cost ≥ N.
Extends the existing Singer alternate-cost path.
**Scope:** new alternate cost type in PLAY_CARD validation + bot logic.

### Win Threshold Modification (CRD 1.8.1.1 override) — Set 7, ~1–2 cards
Donald Duck - Flustered Sorcerer: "OBFUSCATE! Opponents need 25 lore to win."
Static ability that raises the win threshold for opponents.
**Scope:** new `modify_win_threshold` StaticEffect; update `getLoreThreshold()` to check.

---

## New Engine Types Needed (blocks ~267 cards)

Each item below is a new Effect, StaticEffect, Cost, Condition, or Trigger type.
Implement in order of cards unblocked.

### New Effect types

| Type | Description | Example cards |
|------|-------------|---------------|
| `move_damage` | Move N damage counters from card A to card B (CRD 1.9.1.4) | many sets |
| `trim_inkwell` | Each player returns random inkwell cards until ≤ N remain | Ink Geyser (set-7) |
| `trim_hand` | Target player discards until they have N cards in hand | A Feeling of Power (set-7) |
| `put_on_bottom` | Move a card to the bottom of a player's deck (no shuffle) | multiple sets |
| `reveal_hand` | Reveal target player's hand; controller may choose a card to discard | multiple sets |
| `random_discard` | Target player discards a card at random (chooser: "random") | multiple sets |
| `dynamic_gain_lore` | Gain lore equal to a character's stat/cost/count | multiple sets |
| `dynamic_deal_damage` | Deal damage equal to a stat/count (e.g., character's {S}) | multiple sets |
| `replay_from_discard` | Play a card from discard for free, then put it on the bottom of deck | multiple sets |

### New StaticEffect types

| Type | Description | Example cards |
|------|-------------|---------------|
| `modify_win_threshold` | Change lore needed to win for a PlayerTarget | Donald Duck - Flustered Sorcerer (set-7) |
| `ink_from_zone` | Allow inking cards from an additional zone (e.g., discard) | Moana - Curious Explorer (set-11) |
| `enter_play_exerted_static` | Opposing cards of a type enter play exerted | Set 8 characters |
| `grant_classification` | Grant a trait/classification to matching characters | multiple sets |
| `stat_floor` | Character's stat can't be reduced below printed value | Set 11 |
| `prevent_lore_loss` | Player can't lose lore during opponent's turns | Set 6+ |
| `damage_prevention` | Character takes no damage (conditional or timed) | multiple sets |
| `virtual_cost_modifier` | Characters count as having +N cost for singing purposes | Locations set 4 |

### New Cost types

| Type | Description | Example cards |
|------|-------------|---------------|
| `exert_filtered_character` | Exert a chosen character matching a filter as cost | multiple activated abilities |
| `exert_filtered_item` | Exert a chosen item matching a filter as cost | Search the Kingdom (set-7) |

### New Condition types

| Type | Description | Example cards |
|------|-------------|---------------|
| `zone_count_with_filter` | Has N+ cards of type X in zone Y (e.g., "item in discard") | multiple statics |
| `stat_threshold` | Player has a character with stat ≥ N in play | multiple sets |
| `compound_and` | Two conditions must both be true | Tiana (exerted + no cards in hand), Panic (exerted + named character) |
| `played_via_shift` | This card was played using Shift alternate cost | Set 8 |
| `self_stat_gte` | This character's stat ≥ N | Pete - Born to Cheat (set-4) |
| `event_this_turn` | A specific event happened this turn (e.g., "opponent damaged") | Nathaniel Flint (set-8) |
| `is_opponent_turn` | Inverse of `is_your_turn` | Emerald Chromicon (set-5) |

### New Trigger events

| Event | Description | First set |
|-------|-------------|-----------|
| `exerts` | This character exerts for any reason | Set 7+ |
| `deals_damage_in_challenge` | This character deals damage during a challenge | Set 7+ |
| `is_dealt_damage` | This character is dealt damage (Hydra) | Set 3+ |
| `sings` | This character sings a song | Set 7+ |
| `song_played` | Any song is played | Set 6+ |

### New Keyword

| Keyword | Description | CRD ref | First set |
|---------|-------------|---------|-----------|
| `alert` | Can challenge as if they had Evasive | CRD 8.2 | Set 10 |

### Shift variants (all handled by one `canShiftOnto` validator helper)

| Variant | Description | Example cards |
|---------|-------------|---------------|
| Universal Shift | Shifting card skips name check — shift onto any character | Baymax - Giant Robot (set-7) |
| Classification Shift | Match trait instead of name — e.g., "Puppy Shift 3" | Thunderbolt (set-7) |
| MIMICRY | Target card skips name check — any Shift card can shift onto it | Morph - Space Goo (set-3) |
| Additional names | Card counts as having extra names | Flotsam & Jetsam (set-4), Turbo (set-5) |

### CardFilter extensions

| Field | Description | Example cards |
|-------|-------------|---------------|
| `strengthAtMost` | Character's {S} ≤ N | Kit Cloudkicker, Pete - Born to Cheat |
| `strengthAtLeast` | Character's {S} ≥ N | Mr. Big (set-6) |

### RestrictedAction extension

Add `"be_challenged"` to `RestrictedAction` to support timed "can't be challenged"
effects (e.g., "chosen character can't be challenged until the start of your next turn").
Currently only `CantBeChallengedException` (static, untimed) handles this.

Add card-type scoping to `"play"` restriction (e.g., "opponents can't play actions" vs
"opponents can't play actions or items"). Pete - Games Referee (set-5), Keep the Ancient
Ways (set-11).

---

## Formerly Unknown Cards (all reclassified — Session 22)

All 100 formerly-unknown cards were manually reviewed and reclassified.
Run `pnpm card-status` to confirm 0 unknowns. Key reclassifications:

### Reclassified to fits-grammar
- "Choose one:" bare stubs — regex missed, ChooseEffect handles them
- "return all opposing characters" — return_to_hand with target: all
- "discard your hand" — discard_from_hand amount: "all"
- "each player draws N" — draw with target: both
- Dalmatian Puppy "99 copies" — deck construction only, no engine effect
- Conditional upgrade "instead" cards — ConditionalOnTargetEffect (not CRD 6.5)
- "can't be challenged by [trait]" — existing CantBeChallengedException.attackerFilter

### Reclassified to needs-new-type
- Shift variants (Morph, Turbo, Flotsam & Jetsam, Thunderbolt, Baymax Universal)
- Sorcerer's Hat / Bruno "name a card" — LookAtTopEffect extension
- Vision Slab "damage can't be removed" — damage_removal_prevention static
- Hydra "damage reflection" — is_dealt_damage trigger + dynamic deal_damage (not replacement)
- Black Cauldron "play from under" — alternate_source_zone static (same concept as Moana)
- Moana + Black Cauldron share same concept: expand which zones a player action can source from

### Remaining needs-new-mechanic (genuinely new systems)
- CRD 6.5 replacement effects: Beast (damage redirect), Rapunzel/Lilo (damage prevention)
- Arthur "skip Draw step" — turn structure modification
- Prince Charming "only one character can challenge" — global challenge limiter
- John Smith "DO YOUR WORST" — super-Bodyguard for actions + abilities
- Peter Pan "can't gain lore unless challenged" — conditional lore lock

---

## Decompiler triage — cards under 0.5 similarity (post renderer-fix sweep)

After the renderer improvements (enter_play_exerted_self, array static
effects, Sing Together long-form reminder, missing DynamicAmounts, "each
opponent chooses" framing), 34 cards remain under 0.5 similarity. Triage:

### Confirmed wiring bugs (need fixing)

- **Show Me More!** (set 7) — oracle: "Each player draws 3 cards." JSON
  draws for self only; missing `target: "both"` (or both-player draw). Fix
  is one-line.
- **Marching Off to Battle** (set 11) — missing condition gate "If a
  character was banished this turn"; current draw is unconditional.
- **The Lamp** (set 3) — only "draw 2 cards" wired. Both Jafar/Genie
  conditional branches missing entirely.
- **Ink Geyser** (set 7) — second clause "discard at random down to 3"
  renders as `[empty-effect]`; second action effect is unwired/wrong.
- **Do You Want to Build A Snowman?** (set 11) — choose-one option labels
  ("YES! / NO!") wired but neither option's actual sub-effects (gain 3
  lore / put-on-bottom) are populated.
- **Raksha - Fearless Mother** (set 10) — wired as generic cost-reduction
  on play; oracle is move-cost reduction once per turn for Raksha. Wrong
  effect type entirely.
- **Blast from Your Past** (set 5) — wired as `name + reveal top` but
  oracle is "Return all character cards with that name from discard". Wrong
  mechanic — needs a "return all discard cards with that name" effect.
- **The Bare Necessities** (set 3) — "each opponent discards 1 card"
  wired but oracle is "Chosen opponent reveals their hand and discards a
  non-character of your choice". Missing reveal_hand + chooser-controller.
- **Restoring the Crown** (set 7) — first effect (exert) wired; missing
  the floating trigger "this turn, gain 2 lore on your banishes-in-challenge".
- **Enigmatic Inkcaster** (set 10) — `{E} → gain 1 lore` wired, missing
  condition "If you've played 2 or more cards this turn".
- **Mystical Inkcaster** (set 11) — wired as `enters_play` triggered
  ability ("When you play this character, play character with cost 5 or
  less for free"), but oracle is `{E}, 3 {I}` activated ability with Rush
  + end-of-turn banish. Whole ability is wrong type.
- **Kristoff's Lute** (set 11) — only `look at top 1` wired; missing the
  may-play and put-into-discard branches.
- **Robin Hood - Sharpshooter** (set 5) — only `look at top 4` wired;
  missing the may-reveal-action-and-play-for-free branch.
- **Pluto - Clever Cluefinder** (set 10) — only "return item" branch
  wired; missing "If Detective in play... otherwise put on top of deck".
- **We Know the Way** (set 5) — wired as `shuffle + look at top` but
  oracle is the same-name-reveal pattern (shuffle, reveal top, if same
  name play for free else hand). Mechanic mismatch.
- **Hades - Lord of the Dead** (set 6) — wired with
  `banished_other_in_challenge` trigger but oracle is "Whenever one of
  your other characters is banished during the opponent's turn." Wrong
  trigger event/filter.
- **The Bitterwood - Underground Forest** (set 10) — trigger fires on
  any move-to-this-location; oracle filters to "5 {S} or more" + "Once
  during your turn" gate.

### Renderer cosmetic gaps (wiring is correct, oracle phrases differently)

- **Beast - Snowfield Troublemaker** — wired as static "while at location
  can't be damaged from challenges", oracle is triggered phrasing. Same
  effect.
- **Swooping Strike, Triton's Decree, Unfortunate Situation,
  Lady Tremaine - Imperious Queen, Gwythaint - Savage Hunter** — wired
  correctly with chooser=target_player + owner=opponent. Renderer now says
  "each opponent's chosen X" but oracle says "Each opponent chooses one
  of their X and Ys them" — close enough semantically.
- **Trust In Me** — choose-one with two options; renderer only flattens
  one path into output.
- **Repair, Keep the Ancient Ways** — minor wording (filter expressed
  loosely; missing duration phrase).
- **Yzma - Above It All** — wired as is_challenged_and_banished;
  oracle is "Whenever another character is banished in a challenge" —
  effectively equivalent for this card.
- **John Smith - Undaunted Protector** — DO YOUR WORST is in the known-
  needs-new-mechanic list (super-Bodyguard for actions+abilities).
- **King of Hearts - Picky Ruler** — "all opposing damaged characters
  can't challenge" wired; oracle says "Damaged characters can't challenge
  your characters" (filter target slightly different).
- **I2I** — `[unknown:ready_singers]` is a missing effect type for the
  "if 2+ characters sang this song, ready them" sub-clause.
- **Bad-Anon** — needs the inner ability to reference "this character"
  by name (currently generic).

### Recommended action

Open follow-up issues for each "confirmed wiring bug" entry — these are
the actual bugs that drove the user's "we keep finding bugs" observation.
Renderer cosmetic gaps can stay as-is or be addressed if the renderer
is enhanced.

---

## Rulings TBD

Open ruling questions where the strict CRD reading allows an interaction
that may or may not match designer intent. Engine currently follows the
strict reading; revisit if Ravensburger publishes a clarifying ruling.

### The Queen - Conceited Ruler — ROYAL SUMMONS self-loop

> "At the start of your turn, you may choose and discard a Princess or
> Queen character card to return a character card from your discard to
> your hand."

Sequential cost (discard) → reward (return). The discarded card lands in
discard before the return picks, so per strict reading the player can
discard a Princess/Queen and immediately return that same card — a no-op
loop that triggers no other effects.

Engine behavior: allowed (the just-discarded card is a valid return target).

If a future ruling restricts this, the fix would be to add an
`excludeInstanceId: state.lastResolvedTarget?.instanceId` filter on the
return_to_hand effect (or equivalent "exclude this turn's discards" mechanic).

### Kuzco - Selfish Emperor — BY INVITE ONLY scope (continuous vs snapshot)

> "4 {I} — Your other characters gain Resist +1 until the start of your
> next turn."

Open question: does the buff apply only to characters in play AT THE TIME
of activation (snapshot, CRD 6.4.2.2), or also to characters played
afterwards while the duration is in effect (continuous, CRD 6.4.2.1)?

Engine behavior: continuous (`grant_keyword` with `continuous: true`).
Newly played characters DO gain Resist +1 until Kuzco's next turn.

Typical TCG convention treats activated/triggered "gain X until Y"
effects as snapshots — but Lorcana hasn't published an explicit ruling
either way. Revisit if Ravensburger clarifies.

If snapshot is the correct ruling, the fix is to remove `"continuous":
true` from the JSON; the engine's snapshot path (CRD 6.4.2.2 — line 3450
of reducer.ts) iterates `findValidTargets` once and adds a per-card
`addTimedEffect`, so future cards naturally don't get the buff.

---

*Last updated: Session 22 (post-unknown review)*
*Generated from `pnpm card-status` analysis across sets 2–11*
*All 2003 stubs categorized — 0 unknowns remaining*
