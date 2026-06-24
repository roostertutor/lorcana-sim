# Set 13 Leak — New Mechanics & Implementation Notes

> **Source:** `C:\Users\Ryan\Desktop\set 13.txt` (leaked card list, ~15 cards).
> Treat all card names, ability bodies, and especially exact numeric values as
> draft until official reveals confirm them. The leak text is partial / OCR-flavored —
> e.g. one card lists "+1 Willpower" where Lorcana stat is "Willpower" but text-side
> bonuses on locations are usually phrased "characters gain +N {W}." Some lines are
> ambiguous (Heihei "Plant-Born (or 'Created by the Plant')" — subtype name unsettled).
>
> **Goal of this doc:** catalogue every distinct *new* mechanic surfaced by the
> leak and map each to (a) an existing engine primitive we can reuse, (b) an
> extension to an existing primitive, or (c) a brand-new primitive / engine
> rule. Implementation order suggested at the bottom.

## Card-by-card index

| # | Card | New mechanic(s) | Bucket |
|---|------|-----------------|--------|
| 1 | Jean-Christophe — Mellifluous Sage | "Honey" trait + off-color deckbuilding allowance ("Assemble the Team") | NEW (deckbuilder + new trait) |
| 2 | Woody & Buzz — Best Friends | Shift 5; on-play "draw until equal hand size if behind" | REUSE existing `draw` + `until` (`packages/engine/src/types/index.ts:432-439`) |
| 2 | Woody & Buzz — Best Friends | "Grip Beyond!" — on-quest, may play a card cost ≤2 for free | REUSE `play_card` w/ filter + `isMay` (`types/index.ts:1666-1727`) |
| 3 | Rapunzel & Flynn Rider — Unlikely Pair | "Wise Swap" — on **adventure** trigger, draw-then-discard | NEW trigger event (`is_sent_on_adventure`) — depends on adventure mechanic being defined |
| 3 | Rapunzel & Flynn Rider — Unlikely Pair | "Fresh Start" — on-discard-character, may play that character from discard | NEW trigger (`card_discarded` w/ owner+type filter) + REUSE `play_card sourceZone:"discard"` (`types/index.ts:1670`) |
| 4 | The Horned King — Ruthless Master | "Power of the Cauldron" — static while-exerted: may play characters from discard; they enter exerted | NEW static primitive (alt play source under condition) — see notes below |
| 5 | Mushu — Stealthy Dragon | Evasive; "Tip the Balance" — on quest, if opponent has more cards in hand, may draw | REUSE existing `opponent_has_more_cards_in_hand` (`types/index.ts:2986`) as `condition` on the trigger |
| 6 | Pocahontas & Meeko — Adventurous Friends | Shift 2; Evasive | (pure keyword) |
| 6 | Pocahontas & Meeko — Adventurous Friends | "Welcome Return" — on-quest sequential: choose your 1-cost, return to hand → may play a 1-cost for free | REUSE `return_to_hand` + `play_card` w/ filter + conditional `isMay`; see "if you do" pattern below |
| 7 | Dash and Violet Parr — Super Brother and Sister | **Shift Combo 6** — pay 6 to shift onto one named Dash, OR one named Violet, OR one of each (two stacks) | NEW shift variant: multi-name with optional dual-target |
| 7 | Dash and Violet Parr — Super Brother and Sister | Evasive; Resist +1; "Indestructible Tactics" — on quest OR challenge, draw a card for each card underneath | REUSE multi-trigger `anyOf` (`types/index.ts:179`) + `cards_under_count` DynamicAmount (`types/index.ts:703`) |
| 8 | Mickey Mouse & Minnie Mouse — Adventurer Duo | **Shift Duo 0** — pay 0 to shift onto **two** characters, one named Mickey AND one named Minnie | NEW shift variant: required dual-target with name-pair constraint |
| 8 | Mickey Mouse & Minnie Mouse — Adventurer Duo | "Think of Yourself" — if this would be banished, place into inkwell exerted face-down instead | NEW: CRD 6.5-style **replacement effect on banish** + new put-into-inkwell-face-down-exerted action |
| 9 | The Hundred Acre Wood Honey Camp (Location) | At-location flat buff (+1 {W}) + trait-filtered at-location buff (+1 Lore to "Hunny" characters) | REUSE existing `gets_stat_at_location` / location passives — *but* introduces "Honey" / "Hunny" trait |
| 10 | Dash Parr — Dodgeball Dynamo | Evasive (vanilla otherwise per the leak) | (pure keyword) |
| 11 | Kevin — Flightless Bird | "Return to the Nest" — on quest, place this card on top of your deck | NEW effect: `put_self_on_top_of_deck` (or generalize `put_top_cards_into_discard`-shaped placement to "from play → top of deck") |
| 12 | Henry J. Waternoose III | "Bottom Line" — static: while you have more cards in inkwell than **each** opponent, this gets +2 Lore and Ward | REUSE `self_has_more_than_each_opponent` condition (`types/index.ts:3140`) + conditional stat/keyword grant |
| 13 | Peter Pan — Plant-Born | "Clever Trick" — whenever one of your **Floodborn** characters is challenged, challenging player discards | REUSE `is_challenged` trigger w/ owner+filter (`types/index.ts:2888`) + `target_player` discard chooser — Floodborn is an existing rarity tier, not a new trait, so filter syntax already exists |
| 13 | Peter Pan — Plant-Born | New subtype: **Sprout** | NEW subtype string (no engine work; data only) |
| 14 | Heihei — Plant-Born | "Botanical Remedy" — when your Floodborn character quests (other-target trigger), may move 1 damage from your chosen → opposing chosen | REUSE `move_damage` (`types/index.ts:905`) under trigger w/ filter `owner:self + rarity:floodborn + notSelf` |
| 15 | Kronk — Frying Pan Cook | Resist +1; "Order Up!" — once per turn, pay 1 ink to draw then discard | REUSE activated ability w/ ink Cost + `draw` + `discard_from_hand` + `oncePerTurn` |

## New mechanics (grouped by required engine work)

### A. New keywords / deckbuilding rules

#### A1. "Honey" trait + "Assemble the Team" off-color allowance

**Cards:** Jean-Christophe — Mellifluous Sage; Hundred Acre Wood Honey Camp; presumably more Honey-tagged cards in the full set.

**Mechanic:** "You may have other Honey characters in your deck, regardless of their ink color." This is a *deckbuilding* rule, not a gameplay effect. Same shape as Set 7's `subname` Mickey Mouse — Brave Little Tailor reprint mechanics in Infinity format; closest existing precedent is the **rarity/format restriction layer** in the deck validator (`packages/server/`).

**Implementation:**
- Card data: add `"Honey"` to traits on each Honey card. The trait is a new string; engine-side trait matching already accepts arbitrary strings.
- New static ability: when this card is in a deck, the deck validator allows additional cards of the same trait to bypass the 2-color rule. Closest existing pattern is the Cogsworth Majordomo-style "your starting deck may contain…" oracle — but I don't believe any current card grants a deckbuilding override. **Need: a new static effect `deckbuilding_allowance` evaluated only by the deck validator, not the runtime engine.** Engine itself ignores it.
- Decision point: should this also accept "Hunny" (the leak's Location text spells it that way) — i.e. is "Honey" the trait and "Hunny" a typo, or two distinct buckets? Wait for confirmation.

**Risk:** off-color rules interact with format restrictions (Core vs Infinity). The deck validator needs a clean separation between "ink color limit (2)" and "exceptions granted by cards in deck." Worth a `docs/DECISIONS.md` entry once shape is known.

#### A2. Shift variants — Shift Combo and Shift Duo

**Cards:** Dash and Violet Parr — Super Brother and Sister (Shift Combo 6); Mickey Mouse & Minnie Mouse — Adventurer Duo (Shift Duo 0).

**Existing shift variants** (`types/index.ts:139-162`):
- `undefined` — base shift, target must share name (CRD 8.10.1)
- `"universal"` — any of your characters (Baymax — CRD 8.10.8.2)
- `"classification"` — any of your characters with `classifier` trait (Thunderbolt Puppy Shift — CRD 8.10.8.1)

**New variants needed:**
- `"combo"` — target is one of N names OR multiple of them stacked. The Dash/Violet card says "one named Dash, or Violet, or one of each" — i.e. you can shift onto one character matching either name, OR two characters (one of each name) at the same time, stacking the duo card on top of both. **This is the first multi-base shift** in Lorcana, and it changes the shift validator from "one target" to "1..N targets."
- `"duo"` — target is exactly two characters, one matching name A and one matching name B. Required dual-target (no single-target option). Cost is fixed (0 in this case).

**KeywordAbility extension:**
```ts
variant?: "classification" | "universal" | "combo" | "duo";
// new fields:
classifierNames?: string[];   // names accepted (Combo: any subset; Duo: must include all)
targetCount?: 1 | 2;          // Combo: 1 or 2 ("one of each"); Duo: 2 required
```

**Validator (`validator.ts:45-73`) changes:**
- Currently returns boolean for `(shifting, target)`. Needs to return a target-set validity for combos.
- Legal-action enumerator (`types/index.ts:2386-2400` comment) already surfaces shift target variants — extend to enumerate target *pairs* for combo/duo.

**CRD:** No published rule numbers yet. File a `docs/CRD_TRACKER.md` follow-up once official text is out — note that this is structurally a new branch of 8.10.

**Implementation risk:** dual-target shift overlaps with the existing "shifted_onto" trigger (`reducer.ts:7156`). When you stack onto two characters, do both "shifted_onto" triggers fire? Does the duo card inherit cards-under from both? CRD will need to clarify. Wire after official reveal text.

### B. New triggers / events

#### B1. `is_sent_on_adventure` trigger

**Card:** Rapunzel & Flynn Rider — Unlikely Pair (Wise Swap).

**Mechanic:** "Each time this character is sent on an adventure, you can draw a card, then discard a card."

**Open question:** the leak references "adventure" as if it's an existing or co-introduced action, but no card in the leak *defines* what "sending on an adventure" means. Possibilities:
1. New action: exhaust a character to send it on an adventure (analogous to questing for lore but yielding a different reward — maybe drawing, scrying, or interacting with a Quest-type card).
2. Trigger on a *Quest*-type companion card (Quest cards were introduced in Lorcana lore but not yet in the engine; CRD doesn't reference them).
3. Rename / reskin of an existing action (unlikely — would conflict with quest verb usage).

**Block this card until at least one other Set 13 reveal defines "adventure."** Add as a `_namedAbilityStubs` entry with no `abilities[]` entry so `pnpm card-status` flags it.

#### B2. `card_discarded` trigger with owner + card-type filter

**Card:** Rapunzel & Flynn Rider (Fresh Start).

**Mechanic:** "During your turn, each time you discard a character card, you can play that character from your discard pile."

**Existing closest precedent:** I need to grep; the closest active trigger is `is_banished` family (which fires when a card *leaves play* — not the same as discard from hand or from play to discard). For "card moves into discard pile," I'm not aware of a trigger event today — most discard-payoff cards key off the *discarding action itself* (search for "discard" + on:choose).

**Engine extension:**
- New TriggerEvent: `{ on: "card_discarded"; filter?: CardFilter; ownerScope?: "self" | "opponent" | "any" }`
- Fires whenever a card moves zone → "discard", with the moving card and its owner stamped on the trigger context.
- `triggering_card` resolves to the just-discarded card so the `play_card target: triggering_card sourceZone: "discard"` chain works.

**Risk:** discards happen during many paths — hand-size cleanup, forced discard effects, voluntary discard for `discard_until`, discard cost on `Order Up!`. The trigger must fire on *all* of them (CRD: "whenever" without qualification = any source). Verify the discard pipeline emits a single canonical signal we can hook.

#### B3. Quest-OR-Challenge multi-trigger

**Card:** Dash and Violet Parr (Indestructible Tactics).

**Mechanic:** "Whenever this character quests OR challenges, draw one card for each card underneath them."

**Existing primitive:** `TriggeredAbility.trigger` already supports `{ anyOf: TriggerEvent[] }` (`types/index.ts:170-179`). The "quests OR challenges" pattern is a textbook anyOf usage with `[{ on: "quests" }, { on: "challenges" }]`. **Drop-in reuse.**

**DynamicAmount:** `cards_under_count` already exists (`types/index.ts:703`). Combine with `draw` to get "draw N cards" where N is the source's cards-under count. **Drop-in reuse.**

#### B4. "Sub-character" / on-quest from *other* Floodborn characters

**Card:** Heihei — Plant-Born (Botanical Remedy); Peter Pan — Plant-Born (Clever Trick).

**Mechanic:** "Whenever one of your Floodborn characters quests, …" / "Whenever one of your Floodborn characters is challenged, …"

**Existing:** `quests` and `is_challenged` triggers both accept `filter?: CardFilter` (`types/index.ts:2888` and around the quest case in reducer). Floodborn is a rarity/tier, and `CardFilter` has fields for `rarity` (need to verify). If `rarity: "floodborn"` filter doesn't exist yet, this is a one-line filter extension. **Audit `card-status` to confirm `CardFilter.rarity` is whitelisted.**

### C. New replacement / static effects

#### C1. Banish → inkwell replacement (Mickey & Minnie "Think of Yourself")

**Mechanic:** "If this character would be banished, place it in your inkwell instead face down and exerted."

**Engine status:** CRD 6.5 (replacement effects) is the ONLY remaining unimplemented CRD section per `project_crd_gaps.md`. We already have partial 6.5 support — self-replacement on a *single* ability (CRD 6.5.6, see `types/index.ts:1106`) for the "[default]. If you do, [bonus]" idiom, and damage-redirect for Bodyguard-class (`reducer.ts:1545`). What we don't have is **outcome substitution** — "would-be X happens, do Y instead."

**This card is the canary** for a real CRD 6.5 replacement-effect implementation. Two design options:

1. **Narrow special-case:** add a single `replace_banish_with_to_inkwell_self` static effect. Cheap, ships this card, no general 6.5. Pattern matches our historical approach (`grant_play_for_free_self`, `cant_action_self`).
2. **General replacement effect:** implement CRD 6.5 fully — a replacement layer that intercepts ZONE_CHANGE events with predicate + alternative. Costs ~1-2 weeks; unlocks future "would draw, instead reveal" / "would deal N damage, deal N+1" cards.

**Recommendation:** option 1 for ship-Set-13. Then file a CRD 6.5 design doc in `docs/BACKLOG.md` with this card as the trigger condition for revisiting.

**New action:** "place in inkwell face-down and exerted." Today we have `put_into_inkwell` for additive ink. The new variant differs only in: enters exerted (not just face-down), and **doesn't count toward the per-turn ink limit** (since it's a replacement of a banish, not an active inkwell action). Add `enterExerted: true` flag to `put_into_inkwell` (or new effect `put_self_into_inkwell_exerted_on_banish`).

#### C2. "While exerted, play characters from discard" (Horned King "Power of the Cauldron")

**Mechanic:** "While this character is exerted, you can play characters from your discard. If you do, these characters enter play exerted."

**Engine status:** we have `grant_play_for_free_self` (`types/index.ts:2364`) which permits a single specific card to be played for free under condition. What's needed here is a *broader* allowance: while X is true, expand the player's legal play sources from `hand` to `hand + discard`, scoped to one card type (character), with a follow-up replacement (enters exerted).

**Pattern proposal:**
- New static effect: `grant_alt_play_source` — while condition, characters in this player's discard are legal play targets. The validator (`validator.ts`) reads this list when enumerating plays.
- Tied to a condition: `this_is_exerted`. Already exists for "while exerted" gates — verify.
- Played card "enters play exerted" — this is a one-shot replacement at play time. Plumb a `enterExertedIfPlayedFromDiscard: true` flag on the alt-play-source allowance, OR wrap with a `create_floating_trigger` on each "card played from your discard" event that exerts the just-played card.

**Risk:** ink cost still applies (the oracle doesn't say "for free"). Validator needs to charge normal cost when the source is discard via this static. Tests must cover: play character from discard at full ink cost while controller is exerted; cannot play while ready; played character is exerted on enter (can't quest or challenge same turn even without summoning sickness override).

**Decompile renderer:** will need a new clause shape "while ▼ exerted, may play characters from discard."

#### C3. Conditional stat + keyword grant (Waternoose "Bottom Line")

**Mechanic:** "As long as you have more cards in your inkwell than each of your opponents, this character gains +2 Lore and Ward."

**Engine status:** `self_has_more_than_each_opponent` with `metric: "cards_in_inkwell"` already exists (`types/index.ts:3140`). Conditional `modify_stat` (with `condition` field) and conditional `grant_keyword_self` are both established patterns.

**Drop-in reuse.** Structurally:
```json
{
  "type": "static",
  "storyName": "BOTTOM LINE",
  "effect": [
    { "type": "modify_stat", "stat": "lore", "modifier": 2, "target": { "type": "this" },
      "condition": { "type": "self_has_more_than_each_opponent", "metric": "cards_in_inkwell" } },
    { "type": "grant_keyword_self", "keyword": "ward",
      "condition": { "type": "self_has_more_than_each_opponent", "metric": "cards_in_inkwell" } }
  ]
}
```

Verify both `modify_stat` and `grant_keyword_self` accept a `condition` field (they should — used by other "while X" cards). Otherwise a `static_conditional` wrapper.

### D. New effect primitives

#### D1. `put_self_on_top_of_deck` (Kevin "Return to the Nest")

**Mechanic:** "Whenever this character quests, place this card on top of your deck."

**Engine status:** we move cards *to* discard / inkwell / hand / under all the time, but `put_top_cards_into_discard` is the closest "set the top of deck" precedent — it removes from deck to discard. **Self-from-play-to-top-of-deck has no existing primitive.** Closest cousin is `return_to_hand` (which exists for the same source/destination idiom).

**New effect:**
```ts
export interface PutCardOnTopOfDeckEffect {
  type: "put_on_top_of_deck";
  target: CardTarget;          // "this" for Kevin
  from?: ZoneName;             // default "play"
}
```

`return_to_hand` shape is the precedent — same target/source semantics, just different destination zone. Reducer change is one zone-name swap on the move.

**CRD:** placement on top vs. bottom matters for shuffle-respect (CRD 7.2 deck order rules). Confirm the placement *preserves* known order (so subsequent searches see Kevin on top).

#### D2. At-location buff with trait filter (Honey Camp Location)

**Mechanic:** "Characters at this location gain +1 {W}. Hunny characters at this location gain +1 Lore."

**Engine status:** location at-place buffs exist for set 5+ locations. Need to verify if a trait-filtered variant exists already. If yes, drop-in.

### E. Reused without changes

These cards in the leak are 100% existing-primitive reuse:

- Woody & Buzz "Seas of Infinity" — `enters_play` trigger + `choose_player(opponent)` + `condition: opponent_has_more_cards_in_hand` + `draw with until: equal_hand_size`. The chooser variant `target_player` already handles "choose an opponent" cleanly.
- Woody & Buzz "Grip Beyond!" — quest trigger + `play_card filter:{cost_lte:2}` + `isMay:true` + `cost:"free"`.
- Mushu "Tip the Balance" — quest trigger + `condition: opponent_has_more_cards_in_hand` + `draw` + `isMay:true`.
- Pocahontas & Meeko "Welcome Return" — quest trigger + `return_to_hand` + `self_replacement` ("if you do") + `play_card filter:{cost_eq:1} isMay:true cost:"free"`. The "if you do, may play 1-cost" sequencing is the **Widow Tweed pattern** (`card-set-11.json:1667-1730`).
- Dash & Violet "Indestructible Tactics" — multi-trigger `anyOf:[quests, challenges]` + `draw` w/ DynamicAmount `cards_under_count`.
- Heihei "Botanical Remedy" — quest trigger w/ filter `owner:self, rarity:floodborn, notSelf` + `move_damage source:chosen_self dest:chosen_opponent`.
- Peter Pan "Clever Trick" — `is_challenged` trigger w/ filter `owner:self, rarity:floodborn` + `discard_from_hand` w/ chooser `target_player` (the challenging player). Confirm `triggering_card` here resolves to the *challenger* on the discard chooser side — that's the engine's existing semantic.
- Waternoose "Bottom Line" — conditional `modify_stat` + conditional `grant_keyword_self`. See C3.
- Henry's "Bottom Line", Mickey&Minnie shift (apart from variant), Dash Parr vanilla, Kronk "Order Up!", Honey Camp location buffs — all reuse.

## Implementation order

1. **Card data first (no engine work).** Import the leak text as `_namedAbilityStubs` entries with no `abilities[]`. Run `pnpm card-status` — these should show as stubs needing implementation. Set 13 is currently in pre-release; treat all card text as draft.
2. **Easy wins (≤1 day each), as reveals confirm the text:**
   - Woody & Buzz, Mushu, Pocahontas & Meeko, Waternoose, Kronk, Dash Parr (vanilla), Dash & Violet (minus shift variant), Peter Pan, Heihei, Hundred Acre Wood location, Jean-Christophe Magical Invocation (just the search half).
3. **Engine extensions, in dependency order:**
   - `card_discarded` trigger event → unblocks Rapunzel & Flynn "Fresh Start" + any future discard-payoff cards.
   - `put_on_top_of_deck` effect → unblocks Kevin. (NOTE: an earlier draft of
     this doc claimed it would also unblock "WE'LL HAVE TO LOOK INTO THIS" from
     set 6 — that claim was wrong on verification. Mad Hatter — Eccentric Host
     (`card-set-6.json:3632-3668`) is already wired via `look_at_top` and uses a
     different mechanic, top-card-of-chosen-deck manipulation, not self-from-play
     → top. No current in-repo stub is unblocked by `put_on_top_of_deck`.)
   - Shift Combo / Shift Duo variants → unblocks Dash & Violet shift, Mickey & Minnie shift. **Wait for CRD revision text before wiring** — multi-target shift has too many edge cases (shifted_onto trigger fan-out, cards-under merge rules).
   - `grant_alt_play_source` static (Horned King "Power of the Cauldron") — biggest new primitive; defer until after the shift variants land.
   - `replace_banish_with_to_inkwell_self` (Mickey & Minnie "Think of Yourself") — narrow special-case, then file BACKLOG entry for general CRD 6.5.
4. **Pending external info (do not wire yet):**
   - Adventure mechanic (Rapunzel & Flynn "Wise Swap") — need a Set 13 card that *defines* adventure.
   - "Honey" trait / off-color deckbuilding allowance (Jean-Christophe "Assemble the Team") — need confirmation on trait spelling ("Honey" vs "Hunny") and exact deckbuilder rule. Server-side deck validator change, not engine.

## Audits to extend

- **`pnpm card-status`:** add validators for new effect-type discriminators (`put_on_top_of_deck`, `replace_banish_with_to_inkwell_self`, `grant_alt_play_source`) when they're introduced. Each new primitive without a card-status hookup is a Hidden Inkcaster waiting to happen.
- **`pnpm decompile-cards`:** add renderer clauses for the multi-base / duo shift variants ("Shift Combo 6", "Shift Duo 0") and the alt-play-source clause ("while exerted, may play characters from discard"). Otherwise expect 5-10 false-positive low-score flags after Set 13 wires.
- **Shift validator tests:** the existing `mech-gaps-batch.test.ts` shift-variant block (`mech-gaps-batch.test.ts:224`) becomes the precedent for combo/duo regression tests. Mirror its structure.

## Open questions for the user

1. Is "adventure" a Set 13 keyword we expect more clarity on before release, or should we plan as if it's a confirmed new action?
2. Is "Honey" trait deckbuilding allowance scoped to Core, Infinity, or both? Affects which deck validator path needs changes.
3. Do you want me to write the BACKLOG entry for full CRD 6.5 replacement effects, with "Think of Yourself" as the first canary, so we have it documented before the wire-up starts?
