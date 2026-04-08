# Deferred Mechanics

Status: 40 labels / 88 cards remaining in `pnpm tsx scripts/mechanic-gaps.ts`
after Set 1+2+3 completion. This file documents each remaining label, the
cards involved, and why it is deferred along with the design sketch needed
to land it. Order matches the gap report (highest card count first).

These are deferred under the CLAUDE.md rule "for mechanics that need
invasive engine surgery … defer with a clear explanation rather than
producing broken code."

---

## shift-variant (6 cards)

Cards: Flotsam & Jetsam — Entangling Eels (S4, P1), Turbo — Royal Hack (S5),
Thunderbolt — Wonder Dog (S7), Anna — Soothing Sister (S11 x2).

Why deferred: Three distinct sub-mechanics share this label.

1. Name aliasing for shift ("counts as being named X for shift") — engine
   shift validator currently compares against the printed `name` field
   only. Needs an `aliasNames: string[]` on CardDefinition + a helper
   `getShiftNames(def)` that the shift legality check consults.
2. Puppy Shift / Universal Shift — these are typed shift variants. Shift
   currently checks "same name"; Puppy Shift checks subtype `Puppy`,
   Universal Shift checks nothing. Needs a `shiftFilter` field on the
   Shift keyword: `{ kind: 'name' | 'subtype' | 'any', value?: string }`.
3. MIMICRY (Anna) — when shifted, the resulting instance takes on the
   shifted-from card's name for ability resolution. Needs persistent
   alias on the card instance, not just the definition.

Design sketch: extend `Keyword` union with parameterized Shift, plumb
through validator + `playShift` action; for MIMICRY add
`CardInstance.nameOverride?: string` and read it in name-matching helpers.

---

## event-tracking-condition (6 cards)

Cards: Devil's Eye Diamond (S7 x2), Brutus — Fearsome Crocodile (S8 x2),
Chief — Seasoned Tracker (S11), The Thunderquack (S11).

Why deferred: Needs a new `turnEvents` map on GameState recording booleans
that reset at start of each turn:
- `your_character_damaged_this_turn`
- `card_left_discard_this_turn`
- `opponent_discarded_this_turn`
- `banished_in_challenge_this_turn`

Plus a new Condition variant `{ type: 'turn_event', event: ... }` and
hooks in the relevant reducer paths to set the flag. Mechanically simple
but touches many reducer call sites — better as a focused PR.

---

## conditional-cant-be-challenged (5 cards)

Cards: Kenai — Big Brother (S5), Nick Wilde — Sly Fox (S6),
Galactic Council Chamber — Courtroom (S6), Iago — Out of Reach (S8, D23).

Why deferred: Engine has `cant_be_challenged` static modifier but no
"while X" gating. Needs StaticModifier to accept an inline `condition`
that's evaluated at challenge-validation time (not at apply time).
Several other mechanics below would benefit from the same primitive,
so it's worth doing once. Also requires location-scoped variants
("while you have an X here").

---

## mass-inkwell (5 cards)

Cards: Mufasa — Ruler of Pride Rock (S5 x4), Ink Geyser (S7).

Why deferred: Needs three new effects:
- `exert_all_inkwell` (target: self / each player)
- `ready_all_inkwell`
- `return_random_from_inkwell` (count N → hand)

Plus an "each player puts top of deck into inkwell" effect for Ink Geyser.
Inkwell currently models cards as a face-down zone with availableInk
counter; will need to track per-card exerted state in the inkwell zone,
which is a small schema change touching `playInk`/`useInk` paths.

---

## mill (4 cards)

Cards: Dale — Mischievous Ranger (S6), A Very Merry Unbirthday (S6),
Mad Hatter's Teapot (S6), Madame Medusa — Diamond Lover (S7).

Why deferred (small scope): Needs new `mill` effect kind:
`{ kind: 'mill', target: 'self'|'each_opponent'|'chosen_player', count: N }`.
Reducer pulls top N from deck.cards, pushes to discard, fires
`card_milled` events. Good first pickup for next session — ~30 lines + test.

---

## random-discard (4 cards)

Cards: Yzma — Above It All (S7), Lady Tremaine — Bitterly Jealous (S7),
Basil — Undercover Detective (S8), Headless Horseman — Cursed Rider (S10).

Why deferred (small scope): Needs `discard_random` effect using the
seeded RNG already on GameState. Trivial implementation — also good for
next session. Pair with mill in one batch.

---

## grant-floating-trigger-to-target (3 cards)

Cards: Bruno Madrigal — Out of the Shadows (S4), Medallion Weights (S4, S9).

Why deferred: This was identified earlier as needing a new TimedEffect
kind that wraps an Ability definition, plus the ability-collection code
must read timed-granted abilities alongside printed ones. Substantial:
- New `TimedEffect` variant: `{ kind: 'granted_ability', ability: Ability }`
- `getActiveAbilities(instance, state)` helper that merges printed +
  timed-granted
- All trigger-firing code paths must call the helper instead of reading
  `def.abilities` directly

Risk: easy to miss a call site and have triggers silently not fire.

---

## play-same-name-as-banished (3 cards)

Cards: Hades — Double Dealer (S4), Bad-Anon (S5 x2).

Why deferred: Needs a "play card from hand for free, restricted to name X"
PendingChoice variant. The cost/effect ordering matters: banish must
resolve first, then the resulting name becomes the filter for the choose.
Also needs a free-play path that bypasses ink cost but still validates
play timing. Touches `playCard` action's cost path.

---

## play-restriction (3 cards)

Cards: Mirabel Madrigal — Family Gatherer (S5, P2),
Nathaniel Flint — Notorious Pirate (S8).

Why deferred: Needs a `playRestrictions: Condition[]` field on
CardDefinition consulted by `validatePlayCard` and
`getAllLegalActions`. Mechanically small once Conditions are extended
with `characters_in_play_count` and `opposing_character_damaged_this_turn`
(latter overlaps with event-tracking-condition above).

---

## restrict-sing (3 cards)

Cards: Ulf — Mime (S5), Pete — Space Pirate (S7),
Gantu — Experienced Enforcer (S7).

Why deferred: Needs a `cant_sing` static modifier (per-character) plus
a global "characters can't exert to sing songs" timed/static modifier.
Sing-validation path needs to consult both. Pete also needs the
"while exerted" condition gating from conditional-cant-be-challenged.

---

## filtered-cant-be-challenged (3 cards)

Cards: Mr. Big — Shrewd Tycoon (S6), Captain Amelia — Commander of the
Legacy (S6 x2).

Why deferred: Extension of `cant_be_challenged` to accept a challenger
filter (`{ minStrength?, classification?, subtype? }`). Same shape as
existing target filters. Small.

---

## opponent-chosen-banish (3 cards)

Cards: King Candy — Royal Racer (S7), Be King Undisputed (S9 x2).

Why deferred: Needs a PendingChoice resolved on each opponent in turn
order: "choose one of your characters to banish." Multi-player choice
chains aren't currently supported — choices are per-player atomic. Needs
a `MultiPlayerChoiceQueue` on GameState or a chain of single-player
choices spawned by the reducer.

---

## inkwell-static (3 cards)

Cards: Daisy Duck — Paranormal Investigator (S10, P3 x2).

Why deferred: "While exerted, cards enter opponents' inkwells exerted"
needs (a) per-card exerted-state tracking in inkwell (overlaps with
mass-inkwell), and (b) a global modifier consulted by `playInk`. Wait
until mass-inkwell lands.

---

## for-each-opponent-who-didnt (2 cards)

Cards: Sign the Scroll (S4), Ursula's Trickery (S4).

Why deferred: Needs a sequential "may discard" choice per opponent that
records refusals, then a follow-up effect parameterized by the refusal
count. Same multi-player-choice infrastructure as opponent-chosen-banish.

---

## virtual-cost-modifier (2 cards)

Cards: Atlantica — Concert Hall (S4, S9).

Why deferred: "Characters count as having +2 cost to sing songs while
here" — singing currently uses printed cost. Needs a `getVirtualCost`
helper that consults location-scoped modifiers when computing sing
legality. Small once the helper exists.

---

## restricted-play-by-type (2 cards)

Cards: Pete — Games Referee (S5), Keep the Ancient Ways (S11).

Why deferred: Global "opponents can't play actions/items" modifier with
a duration. Modifier slot exists; just needs a new modifier kind
`opponent_cant_play_type` consulted in `validatePlayCard`. Smallish.

---

## count-based-effect (2 cards)

Cards: Rescue Rangers Away! (S6, P2).

Why deferred: Effects with dynamic numeric amounts ("loses {S} equal to
the number of characters you have") need the existing dynamic-amount
expression system extended with `count_characters_in_play`. Engine has
dynamic-amount support (see dynamic-amount.test.ts) — just needs new
expression type. Small.

---

## enter-play-exerted-static (2 cards)

Cards: Jiminy Cricket — Level-Headed and Wise (S8),
Figaro — Tuxedo Cat (S8).

Why deferred: Needs a global modifier consulted in the
`playCharacter` / `playItem` ETB path that forces `exerted: true` on
the new instance based on filter (Rush characters / items). Small.

---

## replacement-effect (2 cards)

Cards: Rapunzel — Ready for Adventure (S10), Lilo — Bundled Up (S11).

Why deferred: True replacement effects ("the next time they would be
dealt damage, they take no damage instead") require an interception
hook in the damage application code, not a post-hoc trigger. Engine
currently fires triggers AFTER state change. Needs:
- `damageReplacements: Replacement[]` on CardInstance
- `applyDamage` consults replacements first, consumes one-shot ones
- New TimedEffect that adds a replacement

Substantial. Defer until at least one more replacement-effect card
appears to validate the design.

---

## play-from-under (2 cards)

Cards: The Black Cauldron (S10).

Why deferred: Cards "under" an item is a sub-zone that doesn't exist
yet. Needs `CardInstance.under: string[]` on items + a new playable
source `'under_item'` in the play action. Niche, defer.

---

## stat-threshold-condition (2 cards)

Cards: Next Stop, Olympus (S10).

Why deferred: Cost reduction conditional on having a character with 5+
strength in play. Needs `getEffectivePlayCost` to consult conditional
modifiers from ALL cards in play. Small extension to existing cost-mod
infrastructure.

---

## stat-floor (2 cards)

Cards: Elisa Maza — Transformed Gargoyle (S11, P3).

Why deferred: Needs `getEffectiveStrength` to clamp to printed value
when an active stat-floor modifier is present. One-line clamp once the
modifier kind exists. Small but waits on one more example before
generalizing.

---

## ink-from-discard (2 cards)

Cards: Moana — Curious Explorer (S11 x2).

Why deferred: Inkwell action currently sources from hand only. Needs
a parameterized inkwell action `{ source: 'hand' | 'discard' }`
gated by an active "can ink from discard" modifier. Touches the
single-ink-per-turn gate too — needs to remain a single global counter.
Smallish.

---

## no-other-quested-condition (1)

Card: Isabela Madrigal — Golden Child (S4).

Why deferred: Needs `quested_this_turn` flag on CardInstance (already
exists for some logic) and a Condition that counts other characters
with the flag. Small.

---

## group-cant-action-this-turn (1)

Card: Isabela Madrigal — Golden Child (S4).

Why deferred: Needs a timed modifier "your other characters can't quest
this turn" with self-exclusion. Quest-action validator must consult
active modifiers. Small. Can land with no-other-quested-condition since
it's the same card.

---

## multi-character-move (1)

Card: Tuk Tuk — Lively Partner (S4).

Why deferred: Move-as-effect is already a documented approximation
(see CLAUDE.md status). Multi-target move waits for that to land.

---

## chosen-for-support-trigger (1)

Card: Prince Phillip — Gallant Defender (S4).

Why deferred: Needs a new trigger `chosen_for_support` fired during
support-keyword resolution. Small — just add the trigger emission point
in the existing support-resolution code.

---

## prevent-lore-loss (1)

Card: Koda — Talkative Cub (S5).

Why deferred: Needs a "can't lose lore" modifier consulted in any
lore-decrement code path. Small. Watch out: must not block the
"lose lore" cost/effect VALIDATION (the action remains legal), only
the actual decrement is suppressed; otherwise opponents can never use
their own discard-lore effects.

---

## opponent-chosen-return (1)

Card: Mother Gothel — Unwavering Schemer (S5).

Why deferred: Same multi-player-choice infrastructure as
opponent-chosen-banish. Bundle.

---

## trim-hand (1)

Card: Prince John's Mirror (S5).

Why deferred: Discard-down-to-N at end of opponent's turn. Needs
end-of-turn hook + a player-choice "discard X cards" sequence. Choice
sequencing infra is the blocker, not the hand-size trim.

---

## conditional-lore-lock (1)

Card: Peter Pan — Never Land Prankster (S6).

Why deferred: "Each opposing player can't gain lore unless one of their
characters has challenged this turn." Needs prevent-lore-gain modifier
+ event-tracking-condition (`opponent_challenged_this_turn`). Bundle
with event-tracking work.

---

## put-damage-counter (1)

Card: Queen of Hearts — Unpredictable Bully (S7).

Why deferred (actually small): Needs an `apply_damage_counter` effect
distinct from "deal damage" (counters bypass Resist). Engine has
`deal_damage`; add `place_damage_counter` that bypasses Resist
recalculation. Small.

---

## inverse-sequential (1)

Card: Flynn Rider — Breaking and Entering (S8).

Why deferred: "May discard. If they don't, you gain 2 lore." Sequential
choose_may currently runs the THEN branch on accept. Needs an ELSE
branch on the choice node. Small schema add to PendingChoice +
reducer.

---

## new-trigger-deals-damage (1)

Card: Mulan — Elite Archer (S9).

Why deferred: Needs `deals_damage_in_challenge` trigger + ability that
captures the damage amount and re-applies to chosen targets. Damage
amount as dynamic value into the resulting deal_damage effect. Small
once the trigger emit point is added.

---

## challenge-limiter (1)

Card: Prince Charming — Protector of the Realm (S10).

Why deferred: "Each turn, only one character can challenge." Needs
per-turn challenge-count tracker on GameState + a play-side check
on challenge-action validation. Static modifier from a card affecting
both players. Small.

---

## new-trigger-exerts (1)

Card: Bambi — Ethereal Fawn (S11).

Why deferred: Needs `character_exerts` trigger emitted from quest,
challenge, sing, ink-pay, ability-cost paths. Easy to miss a call site;
defer until done carefully with audit. Effect side also references
"cards under him" (sub-zone, see play-from-under).

---

## play-from-revealed (1)

Card: Kristoff's Lute (S11).

Why deferred: "Reveal top card. May play it as if from hand." Same
free-play-from-non-hand-zone path as Hades / Bad-Anon. Bundle.

---

## remove-ability (1)

Card: Angela — Night Warrior (S11).

Why deferred: "Your Gargoyle characters lose the Stone by Day ability."
Needs an ability-suppression modifier consulted by
`getActiveAbilities` (see grant-floating-trigger-to-target). Bundle.

---

## super-bodyguard (1)

Card: John Smith — Undaunted Protector (S11).

Why deferred: "Opponents must choose this character for actions and
abilities if able." Generalizes Bodyguard (which is challenge-only) to
all targeted opponent effects. Needs target-validator to filter targets
through "must include super-bodyguard if any present." Touches every
opponent-targeting effect's target validation. Substantial; defer.

---

## virtual-ink-color (1)

Card: Hidden Inkcaster (S P1).

Why deferred: "All cards in your hand count as having {IW}." Inkable
check is part of inkwell action. Needs a hand-wide ink-color override
modifier. Singular card; defer until a real set introduces this rather
than a promo.

---

## Triage summary

Quick-win bundle (next session, ~1 commit each, ~25 cards total):
- mill + random-discard (8 cards) — pure new effects, no infra
- count-based-effect, put-damage-counter, stat-floor (5 cards) — small
- filtered-cant-be-challenged, enter-play-exerted-static (5 cards)
- play-restriction, restricted-play-by-type, virtual-cost-modifier (7 cards)

Medium bundle (needs one piece of infra each):
- event-tracking-condition + conditional-lore-lock + play-restriction
  Nathaniel Flint (8 cards) — turnEvents map
- conditional-cant-be-challenged + restrict-sing + inkwell-static
  (11 cards) — conditional static modifiers

Large bundle (substantial infra):
- shift-variant (6 cards) — keyword parameterization
- mass-inkwell + ink-from-discard + inkwell-static (10 cards) —
  inkwell-zone schema change
- grant-floating-trigger-to-target + remove-ability + new-trigger-exerts
  (5 cards) — getActiveAbilities refactor
- multi-player choices: opponent-chosen-banish + opponent-chosen-return
  + for-each-opponent-who-didnt + trim-hand + inverse-sequential
  (8 cards)
- replacement-effect + super-bodyguard (3 cards) — interception hooks

Niche / 1 card / wait for more examples:
- play-from-under, play-from-revealed, play-same-name-as-banished
- stat-threshold-condition, virtual-ink-color
- multi-character-move (waits on move-as-effect)
- challenge-limiter, new-trigger-deals-damage, chosen-for-support-trigger
- no-other-quested-condition + group-cant-action-this-turn (Isabela)
- prevent-lore-loss

Total: 88 cards across 40 mechanics. Estimated ~60 cards reachable with
~6 focused PRs of bundled infra; remaining ~28 are 1-card niche
mechanics best left until adjacent design pressure appears.
