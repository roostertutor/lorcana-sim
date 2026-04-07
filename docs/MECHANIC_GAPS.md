# Mechanic Gaps — Cross-Set Implementation Backlog

Auto-generated from `pnpm card-status` after the categorizer was tied to a
capability allow-list (commit 3a8b50b), then refined by:

- Tightening the Boost regex so Shift cards no longer false-positive as Boost,
  and **decomposing Boost into sub-capabilities** (the keyword itself is
  trivial — the complexity lives in the triggers/statics/effects that read the
  cards-under subzone).
- Removing the over-broad `move-damage` matcher in `scripts/mechanic-gaps.ts`
  and promoting the corresponding cards to `fits-grammar` in
  `scripts/card-status.ts` (the `move_damage` Effect already exists in
  `packages/engine/src/types/index.ts` and is wired for Belle Untrained
  Mystic, Belle Accomplished Mystic, and Rose Lantern).

- **HIGH** — 10+ cards across sets
- **MEDIUM** — 3–9 cards
- **LOW** — 1–2 cards

Totals: **55 missing capabilities** across ~320 stub-instances (some cards
have multiple stubs; boost cards now hit multiple sub-capabilities).

Source script: `scripts/mechanic-gaps.ts` (run via `pnpm tsx scripts/mechanic-gaps.ts`).

---

## Priority table (top 10)

| Capability | Cards | Sets | Priority | Complexity | Notes |
|---|---:|---|---|---|---|
| `put-on-bottom` | 44 | 5–11, cp, D23 | HIGH | SMALL | New `put_on_bottom_of_deck` Effect (no shuffle, no reveal). Quick win. |
| ~~`pay-extra-cost-mid-effect`~~ | done | — | — | — | Implemented via existing `SequentialEffect` (`isMay: true` + `pay_ink` cost effect). No new Effect type needed. Categorizer + 10 cards wired (Ariel Sonic Warrior set 4/9, Merryweather, Scroop, Clarabelle, Mother Gothel, Honey Lemon set 6/P2, Raya, Ursula's Shell Necklace, Max Goof, Finnick). 8 deferred for unrelated gaps (dynamic-amount, shift-variant, new triggers, choose-inside-reward). |
| `dynamic-amount` | 18 | 5–9, 11, D23, P3 | HIGH | MEDIUM | Effect amount as `{ type: "this_character_strength" \| "chosen_lore" \| ... }`; touches draw, deal_damage, gain_lore amount unions |
| `card-under-static` | 15 | 10, 11, P3 | HIGH | MEDIUM | Boost sub-capability. Statics that read "while there's a card under this / with a card under them" — needs the cards-under subzone first |
| `card-under-trigger` | 13 | 10, 11, P3 | HIGH | MEDIUM | Boost sub-capability. "Whenever you put a card under …" trigger event — depends on subzone + placement pipeline |
| `damage-immunity` | 11 | 4, 6, 7, 8, 10, P2, P3 | HIGH | MEDIUM | Timed/conditional "takes no damage from challenges this turn" — `ChallengeDamageImmunityStatic` exists for permanent; needs timed variant |
| `alternate-source-zone` | 11 | 5, 9, 10, 11 | HIGH | LARGE | Play card from discard / from-under-character; touches play pipeline + zone validation |
| `reveal-hand` | 10 | 7, 8, 9, 10, 11, D23, P3 | HIGH | SMALL | New `reveal_hand` Effect; UI surfacing optional |
| `put-facedown-under-effect` | 10 | 10, 11 | HIGH | MEDIUM | Boost sub-capability. Effects that put top-of-deck facedown under a card outside the keyword cost |
| `alert-keyword` | 10 | 10, 11 | HIGH | SMALL | Add `alert` to Keyword union + trigger on quest |

### Rest of the backlog

| Capability | Cards | Sets | Priority | Complexity | Notes |
|---|---:|---|---|---|---|
| `reveal-top-conditional` | 9 | 5–9, 11, D23 | MEDIUM | SMALL | `reveal_top_conditional` Effect already exists. Confirm regex tightening — many should become fits-grammar. |
| `per-count-cost-reduction` | 8 | 5, 6, P2 | MEDIUM | MEDIUM | Self cost = N − count(filter); StaticEffect variant |
| `draw-to-n` | 7 | 5, 6, 8 | MEDIUM | SMALL | New `draw_to_hand_size` Effect |
| `timed-cant-be-challenged` | 7 | 6, 7, 11 | MEDIUM | SMALL | `cant_be_challenged_timed` exists. Likely a regex-tightening / fits-grammar promotion. |
| `cards-under-count` | 7 | 11 | MEDIUM | SMALL | Boost sub-capability. Dynamic amount "for each card under" / "equal to the number of cards under" — dynamic-amount variant over the subzone |
| `both-players-effect` | 6 | 7, 9, cp | MEDIUM | SMALL | "Each player draws/discards" — looped existing Effect over both players |
| `event-tracking-condition` | 6 | 7, 8, 11 | MEDIUM | MEDIUM | "was damaged this turn" / "was banished in a challenge this turn" — turn-scoped event log |
| `boost-subzone` | 6 | 10, 11 | MEDIUM | LARGE | **Foundation** of the whole Boost family. New cards-under subzone + Boost keyword cost wiring (pay N {I}, put top of deck facedown under this). Must land first before the triggers/statics/effects/count sub-capabilities. |
| `conditional-cant-be-challenged` | 5 | 5, 6, 8, D23 | MEDIUM | SMALL | "while X, can't be challenged" — combine existing static with condition |
| `mass-inkwell` | 5 | 5, 7 | MEDIUM | LARGE | "all cards in inkwell" / "each player's inkwell" — touches new ZoneTarget |
| `exert-filtered-cost` | 5 | 6, 7, 8 | MEDIUM | MEDIUM | New `Cost` variant: exert a chosen filtered card |
| `mill` | 4 | 6, 7 | MEDIUM | SMALL | New `mill_top_n` Effect |
| `random-discard` | 4 | 7, 8, 10 | MEDIUM | SMALL | DiscardEffect needs `mode: "random"` variant |
| `grant-floating-trigger-to-target` | 3 | 4, 9 | MEDIUM | MEDIUM | `create_floating_trigger` exists but only attaches to source. Extend to accept a target instanceId. |
| `shift-variant` | 3 | 4, 5, P1 | MEDIUM | LARGE | Universal/classification/named-shift variants; partly noted in card-issues |
| `play-same-name-as-banished` | 3 | 4, 5 | MEDIUM | MEDIUM | `play_for_free` filter referencing a previously-resolved card name |
| `play-restriction` | 3 | 5, 8, P2 | MEDIUM | MEDIUM | "Can't play this card unless X" — pre-play condition gate |
| `restrict-sing` | 3 | 5, 7 | MEDIUM | SMALL | New action restriction value |
| `filtered-cant-be-challenged` | 3 | 6 | MEDIUM | SMALL | `CantBeChallengedException.attackerFilter` already exists; tighten regex |
| `opponent-chosen-banish` | 3 | 7, 9 | MEDIUM | SMALL | `chooser: "target_player"` exists; tighten regex |
| `inkwell-static` | 3 | 10, P3 | MEDIUM | MEDIUM | "Opposing characters enter opponents' inkwell exerted" — global pre-ink replacement |
| `for-each-opponent-who-didnt` | 2 | 4 | LOW | MEDIUM | Per-opponent inverse-sequential branch (Sign the Scroll, Ursula's Trickery) |
| `virtual-cost-modifier` | 2 | 4, 9 | LOW | MEDIUM | "count as having +N cost" for singer threshold |
| `restricted-play-by-type` | 2 | 5, 11 | LOW | SMALL | Pete: "opponents can't play actions/items" |
| `count-based-effect` | 2 | 6, P2 | LOW | MEDIUM | "Count the number of X, then do Y" — count-as-amount source |
| `enter-play-exerted-static` | 2 | 8 | LOW | SMALL | Opposing characters enter exerted — global static |
| `replacement-effect` | 2 | 10, 11 | LOW | LARGE | CRD 6.5 — "would X instead" replacement layer |
| `stat-threshold-condition` | 2 | 10 | LOW | SMALL | "if you have a character with N {S}" — Condition variant |
| `cards-under-to-hand` | 2 | 11 | LOW | SMALL | Tied to Boost system (Alice: "put all cards from under her into your hand") |
| `stat-floor` | 2 | 11, P3 | LOW | MEDIUM | "Can't be reduced below printed strength" — stat clamp layer |
| `no-other-quested-condition` | 1 | 4 | LOW | SMALL | Isabela Madrigal — no_other_character_has_quested condition |
| `group-cant-action-this-turn` | 1 | 4 | LOW | SMALL | "Your other characters can't quest" — filtered cant_action this_turn |
| `multi-character-move` | 1 | 4 | LOW | MEDIUM | Tuk Tuk — single effect moving two characters atomically |
| `chosen-for-support-trigger` | 1 | 4 | LOW | SMALL | New TriggerEvent.on `chosen_for_support` |
| `prevent-lore-loss` | 1 | 5 | LOW | SMALL | "Can't lose lore" — gate `lose_lore` Effect |
| `opponent-chosen-return` | 1 | 5 | LOW | SMALL | Already covered by `chooser: "target_player"` once regex tightens |
| `trim-hand` | 1 | 5 | LOW | SMALL | "Discard until they have N" |
| `conditional-lore-lock` | 1 | 6 | LOW | MEDIUM | Peter Pan: "can't gain lore unless one of their characters has challenged this turn" |
| `put-damage-counter` | 1 | 7 | LOW | SMALL | "Put a damage counter on" without `deal_damage` semantics (no triggers) |
| `inverse-sequential` | 1 | 8 | LOW | SMALL | "If they don't" branch in SequentialEffect |
| `new-trigger-deals-damage` | 1 | 9 | LOW | SMALL | New TriggerEvent.on `deals_damage` (non-challenge variant) |
| `challenge-limiter` | 1 | 10 | LOW | MEDIUM | "Only one character can challenge each turn" — global counter |
| `remove-ability` | 1 | 11 | LOW | MEDIUM | "Lose the X ability" — ability suppression layer |
| `super-bodyguard` | 1 | 11 | LOW | MEDIUM | Forced-target mod for both actions and abilities |
| `virtual-ink-color` | 1 | P1 | LOW | MEDIUM | "All cards in your hand count as having {I} ink" — pseudo-color |

> **Note:** `move-damage` no longer appears in the gap report. The `move_damage`
> Effect already exists and is wired (Belle Untrained Mystic, Belle Accomplished
> Mystic, Rose Lantern). The 23 stubs previously tagged `move-damage` now
> correctly fall into `fits-grammar` and can be wired without new engine work.

---

## Recommended implementation order

Sequence weighted by frequency × low complexity:

1. **`put-on-bottom`** (44 cards, SMALL) — Trivial new Effect, unlocks many sets at once.
2. **`reveal-hand`** (10 cards, SMALL) — One Effect, no new pipeline.
3. **`alert-keyword`** (10 cards, SMALL) — Add to Keyword union, hook quest trigger.
4. **`draw-to-n`** (7 cards, SMALL) — One Effect.
5. **`mill`** (4 cards, SMALL) — One Effect.
6. **`random-discard`** (4 cards, SMALL) — DiscardEffect mode flag.
7. **`move-damage` fits-grammar wiring pass** — now that these 23 cards are
   correctly classified as fits-grammar, they can be wired card-by-card with
   zero new engine work. Biggest cheap cardinality left in the backlog.
8. **Regex tightening sweep** for `reveal-top-conditional`,
   `timed-cant-be-challenged`, `filtered-cant-be-challenged`,
   `opponent-chosen-banish`, `opponent-chosen-return` — these primitives
   already exist; the matchers are over-broad. Cheap reclassification work.
9. **`dynamic-amount`** (18 cards, MEDIUM) — Touches multiple Effect amount unions but is mechanical.
10. **`pay-extra-cost-mid-effect`** (23 cards, MEDIUM) — High frequency, requires choose-then-cost-then-effect plumbing.
11. **`per-count-cost-reduction`** + **`event-tracking-condition`** + **`damage-immunity` (timed)** — moderate-frequency MEDIUM gaps.
12. **`grant-floating-trigger-to-target`** (3 cards, MEDIUM) — Small extension of existing primitive.
13. **Boost family, in dependency order** (40+ cards across 5 sub-capabilities):
    1. `boost-subzone` (6 cards, LARGE) — foundation. Cards-under subzone + keyword cost wiring.
    2. `put-facedown-under-effect` (10 cards, MEDIUM) — effects that place cards into the subzone outside the keyword.
    3. `card-under-trigger` (13 cards, MEDIUM) — "whenever you put a card under" trigger event.
    4. `card-under-static` (15 cards, MEDIUM) — statics that read the subzone.
    5. `cards-under-count` (7 cards, SMALL) — dynamic-amount variant over the subzone.
    6. `cards-under-to-hand` (2 cards, SMALL) — Alice-style retrieval effect.
14. **`alternate-source-zone`** (11 cards, LARGE) — Touches play pipeline; pair with the Boost work if doing a play-pipeline overhaul.
15. **`replacement-effect`** (2 cards, LARGE) — Defer; CRD 6.5 layer is invasive and only 2 cards in the backlog.

---

## Capability descriptions and example rules text

### Boost family (decomposed)

The Boost keyword itself (pay N {I}, put the top card of your deck facedown
under this) is **trivial** — a fixed cost and a fixed placement. All the
interesting variation lives in the triggers, statics, and effects that read
the cards-under subzone. The gap report now tracks those as distinct
sub-capabilities so the work can be sequenced incrementally.

#### `boost-subzone` (6 cards)
Foundation capability. Introduces the cards-under subzone and wires the
Boost keyword cost. Nothing else in the Boost family compiles until this
lands.
- "Boost 3 {I} (You may pay 3 {I} when you play this character to put the top card of your deck facedown under him.)"

#### `put-facedown-under-effect` (10 cards)
Effects (not the keyword cost) that place a card facedown under a character.
- "Put the top card of your deck facedown under this character."

#### `card-under-trigger` (13 cards)
New TriggerEvent: "whenever you put a card under <filter>". Fires both from
the keyword cost and from `put-facedown-under-effect` resolutions.
- "Whenever you put a card under another character, this character gets +1 {L} this turn."

#### `card-under-static` (15 cards)
Statics that read whether a card is under this or another character.
- "While there's a card under this character, he gets +3 {S}."
- "Your Floodborn characters with a card under them gain Evasive and Ward."

#### `cards-under-count` (7 cards)
Dynamic-amount variant that counts cards in the subzone.
- "This character gets +1 {L} for each card under him."
- "Gain lore equal to the number of cards under this character."

#### `cards-under-to-hand` (2 cards)
One-off effect that retrieves all cards from under a character into a hand.
- "Put all cards from under her into your hand." (Alice)

### `put-on-bottom` (44 cards)
Place a card on the bottom of a deck without shuffling. Distinct from `shuffle_into_deck`.
- "Put chosen character on the bottom of their player's deck."

### `pay-extra-cost-mid-effect` (23 cards)
Optional cost embedded in an effect resolution: "you may pay N {I} to do Y".
- "Whenever you play a song, you may pay 2 {I} to deal 3 damage to chosen character." (Ariel — Sonic Warrior)

### `dynamic-amount` (18 cards)
Effect amount derived from a stat or count, e.g. "deal damage equal to chosen character's {S}".
- "Gain lore equal to this character's {L}."
- "Deal damage equal to the cost of chosen character."

### `damage-immunity` (11 cards)
Timed/conditional damage prevention beyond the existing permanent static.
- "Chosen character takes no damage from challenges this turn."

### `alternate-source-zone` (11 cards)
Play a card from a non-hand zone (discard, under-character).
- "You may play a character with cost 5 or less from your discard."

### `reveal-hand` (10 cards)
Look at or reveal an opponent's hand.
- "Reveal your opponent's hand."
- "Look at each opponent's hand."

### `alert-keyword` (10 cards)
Set 10/11 keyword. Trigger when this character quests, do effect.
- "Alert — Whenever this character quests, gain 1 lore."

### `reveal-top-conditional` (9 cards — likely false positives)
Reveal top, branch by type, hand or top/bottom. Effect exists; tighten regex.

### `per-count-cost-reduction` (8 cards)
Self cost = printed − count of filter.
- "This character costs 1 {I} less for each character you have in play."

### `grant-floating-trigger-to-target` (3 cards)
`create_floating_trigger` already exists for source-attached triggers. Extend
the effect to optionally attach the floating trigger to a chosen target instance.
- "Chosen character gains 'When this character is banished in a challenge, you may return this card to your hand' this turn." (Bruno Madrigal)
- "Chosen character gets +2 {S} this turn. Whenever they challenge another character this turn, you may draw a card." (Medallion Weights)

### `for-each-opponent-who-didnt` (2 cards)
Per-opponent inverse-sequential resolution: collect a may-decision from each opponent, then reward based on the count of refusals.
- "Each opponent may choose and discard a card. For each opponent who doesn't, you gain 2 lore." (Sign the Scroll)

### `chosen-for-support-trigger` (1 card)
New TriggerEvent.on entry: fires when one of your characters is chosen as the recipient of the Support keyword.
- "Whenever one of your characters is chosen for Support, they gain Resist +1 this turn." (Prince Phillip — Gallant Defender)

### `play-same-name-as-banished` (3 cards)
`play_for_free` whose filter is dynamically constructed from a card banished earlier in the same effect chain.
- "{E}, Banish one of your other characters — Play a character with the same name as the banished character for free." (Hades — Double Dealer)

### `multi-character-move` (1 card)
Atomic move of two characters in a single effect (not a sequential pair).
- "You may move him and one of your other characters to the same location for free." (Tuk Tuk — Lively Partner)

### `no-other-quested-condition` / `group-cant-action-this-turn` (1 + 1 cards)
Isabela Madrigal — Golden Child: needs (a) a condition checking that no other friendly character has quested this turn and (b) a filtered group `cant_action` valid for the rest of the turn.

### Other LOW-priority capabilities
See the priority table above. Each has 1–2 cards; document inline when implementing rather than designing speculatively.
