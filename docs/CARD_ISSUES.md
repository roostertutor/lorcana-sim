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

1. **fits-grammar first** (~1400 cards) — map to existing Effect/Condition/Cost types.
   No engine changes needed. Bulk of the work.
2. **needs-new-type next** (~267 cards) — implement engine additions in order of
   how many cards they unblock, then fill in cards.
3. **needs-new-mechanic last** (~233 cards) — Locations, Boost, Sing Together each
   need design work before any card in that group can be implemented.
4. **unknown** (~100 cards) — needs manual review. Use `--category unknown` to inspect.

---

## Set 1 — The First Chapter

216 cards. All abilities implemented. All story names tagged. No open issues.

---

## Sets 2–11 Status (as of card-status analysis)

| Set | Total | Done | Vanilla | Fits-Grammar | New-Type | New-Mechanic | Unknown |
|-----|-------|------|---------|--------------|----------|--------------|---------|
| 2   | 216   | 0    | 54      | 143          | 15       | 0            | 4       |
| 3   | 226   | 0    | 42      | 111          | 22       | 36           | 14      |
| 4   | 225   | 0    | 43      | 114          | 32       | 26           | 10      |
| 5   | 223   | 2    | 40      | 128          | 25       | 17           | 11      |
| 6   | 222   | 1    | 39      | 131          | 15       | 20           | 16      |
| 7   | 222   | 0    | 35      | 145          | 30       | 4            | 8       |
| 8   | 227   | 0    | 30      | 154          | 24       | 8            | 11      |
| 9   | 243   | 0    | 44      | 145          | 28       | 23           | 3       |
| 10  | 242   | 2    | 46      | 110          | 23       | 53           | 8       |
| 11  | 242   | 0    | 37      | 126          | 31       | 34           | 14      |

Note: "Vanilla" = no named abilities (keyword-only or blank) — already work in simulation.
"Done" = named abilities implemented. Set 5 has 2 (tipo-growing-son, vision-of-the-future);
Set 6 has 1 (unnamed); Set 10 has 2 (clarabelle + unnamed).

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
| `compound_and` | Two conditions must both be true | Tiana (exerted + no cards in hand) |
| `played_via_shift` | This card was played using Shift alternate cost | Set 8 |

### New Trigger events

| Event | Description | First set |
|-------|-------------|-----------|
| `exerts` | This character exerts for any reason | Set 7+ |
| `deals_damage_in_challenge` | This character deals damage during a challenge | Set 7+ |
| `sings` | This character sings a song | Set 7+ |
| `song_played` | Any song is played | Set 6+ |

### New Keyword

| Keyword | Description | CRD ref | First set |
|---------|-------------|---------|-----------|
| `alert` | Can challenge as if they had Evasive | CRD 8.2 | Set 10 |

### RestrictedAction extension

Add `"be_challenged"` to `RestrictedAction` to support timed "can't be challenged"
effects (e.g., "chosen character can't be challenged until the start of your next turn").
Currently only `CantBeChallengedException` (static, untimed) handles this.

---

## Unknown Cards (~100 cards — needs manual review)

Run `pnpm card-status --category unknown --verbose` to see the full list.

Notable genuinely-complex cases identified:

- **Damage redirection** (Hydra - Deadly Serpent, set-3): "Whenever this character is dealt
  damage, deal that much damage to chosen opposing character." Needs replacement effect or
  new trigger. See CRD 6.5 (replacement effects, ❌).

- **Shift name override** (Morph - Space Goo, set-3): "MIMICRY — You may play any character
  with Shift on this character as if this character had any name." Niche; needs new
  `universal_shift_target` static or override in shift validation.

- **Dual name identity** (Flotsam & Jetsam, set-4): "This character counts as being named
  both Flotsam and Jetsam." Needs `additionalNames: string[]` on CardDefinition or similar.

- **Deck construction override** (Dalmatian Puppy - Tail Wagger, set-3): "You may have up
  to 99 copies in your deck." Deck-construction rule only; no in-game engine effect needed.
  Mark as vanilla for simulation purposes.

- **Forced targeting** (DO YOUR WORST, set-11): "Opponents must choose this character for
  actions and abilities if able." Similar to Bodyguard but broader. New static type needed.

- **Per-count self-cost reduction** (various): "For each [item/damaged character/exerted
  opponent] you have, pay 1 {I} less to play this character." Extends `SelfCostReductionStatic`
  with a count-based amount. Needs `amount: "per_count"` + `countFilter: CardFilter`.

---

*Last updated: Session 22*
*Generated from `pnpm card-status` analysis across sets 2–11*
