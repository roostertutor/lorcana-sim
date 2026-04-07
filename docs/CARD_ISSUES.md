# Card Issues

Track unimplemented card abilities here. When importing new sets, cards with
`_namedAbilityStubs` in their JSON need abilities manually implemented and
story names (CRD 5.2.8) added via `storyName` on each ability.

Run `pnpm card-status` for a live view of per-set progress.
Run `pnpm card-status --category <name>` to list cards in a category.
Run `pnpm card-status --set <N>` to filter to one set.

---

## Implementation Strategy

**Do not implement in set order.** Implement by category:

1. **fits-grammar first** (~1245 cards) — map to existing Effect/Condition/Cost types.
   No engine changes needed. Bulk of the work.
2. **needs-new-type next** (~357 cards) — implement engine additions in order of
   how many cards they unblock, then fill in cards.
3. **needs-new-mechanic last** (~239 cards) — Locations, Boost, Sing Together each
   need design work before any card in that group can be implemented. CRD 6.5
   replacement effects ✅ implemented (Beast Selfless Protector).
4. **unknown: 0** — all stubs categorized.

---

## Set 1 — The First Chapter

216 cards. All abilities implemented. All story names tagged. No open issues.

## Set 2 — Rise of the Floodborn

216 cards. All 162 named-ability cards implemented. Zero approximations. No open issues.

## Set 3 — Into the Inklands

226 cards (178 named-ability + 48 vanilla). Locations (CRD 5.6, 4.7, 4.6.8, 3.2.2.2)
implemented. ~10 cards have approximations for engine features not yet built:
- Jafar Striking Illusionist — needs `card_drawn` trigger event
- Morph Space Goo — MIMICRY shift name override
- Ursula Deceiver of All — `sings` trigger + replay-from-discard
- Magic Carpet, Voyage — `move_character` as an effect (currently only as an action)
- Maui Whale — persistent "can't ready at start of turn" restriction
- Belle's House — cost reduction conditional on "have a character here"
- Peter Pan Lost Boy Leader, I've Got a Dream — dynamic gain_lore from location's lore
- Jim Hawkins — "may move here for free" alt-cost
- Olympus Would Be That Way — Challenger bonus only when challenging a location

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
| `damage_immunity` | Character takes no damage (conditional or timed) | multiple sets |
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

*Last updated: Session 22 (post-unknown review)*
*Generated from `pnpm card-status` analysis across sets 2–11*
*All 2003 stubs categorized — 0 unknowns remaining*
