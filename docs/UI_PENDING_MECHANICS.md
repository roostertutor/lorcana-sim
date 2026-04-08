# UI — Pending Visualizations for New Engine Mechanics

Running list of engine mechanics added during the Phase A.x cleanup that the
UI does not yet visualize. Each entry: what the engine does, what the UI
needs to show, and which event/state field to watch.

Append to the top as new mechanics land.

---

## ResolvedRef carriers (engine refactor — UI implications)

**Engine**: Unified `ResolvedRef` snapshot type replaces ad-hoc `_resolvedSourceInstanceId`/`_resolvedCharacterInstanceId`/`lastTargetOwnerId`/`lastTargetInstanceId` carriers. Holds `instanceId`, `name`, `cost`, `strength`, `willpower`, `lore`, `damage`, and an optional `delta` (how much was actually consumed by an `isUpTo` step). `state.lastResolvedSource` carries the cost-side resolved card; `state.lastResolvedTarget` carries the most recent resolved target.

**UI needs**: No direct visualization, but enables future UI work to show the *actual* values used by an effect (e.g. "Hades plays Mickey Mouse for free" with the banished name in the action log) instead of re-fetching from `state.cards` after the fact. Action log entries should include the ResolvedRef snapshot for accurate replay.

---

## Hades Double Dealer / play-same-name-as-banished

**Engine**: New `CardFilter.nameFromLastResolvedSource: boolean` flag. When true, the filter matches cards whose name (or any alternate name) equals `state.lastResolvedSource.name`. Used by Hades' "play a character with the same name as the banished character for free."

**UI needs**: When the player is choosing a target for the play-for-free reward, the prompt should show the banished card's name in the prompt text ("Choose a Mickey Mouse to play for free") rather than just a generic "Choose a character." Read `state.lastResolvedSource?.name` from the pending choice context.

**Cards**: Hades - Double Dealer.

---

## isUpTo delta tracking

**Engine**: `remove_damage` and `move_damage` with `isUpTo: true` now write `delta: <actually-consumed>` onto `state.lastResolvedTarget`. New `DynamicAmount` variant `{type: "last_resolved_target_delta"}` reads it. Used by "remove up to N. Gain X for each removed."

**UI needs**: When a follow-up effect resolves with a delta-based amount, show the resolved value in the log/animation rather than the upper bound (e.g. "Baymax removes 2 damage. Gain 2 lore" not "Gain up to 2 lore"). Read from the trigger's resolved amount, not from the effect template.

**Cards**: Baymax - Armored Companion. Future: Bruno Singing Seer, Geppetto Skilled Craftsman, Perdita Determined Mother (when wired).

---

## Cost-side strength snapshot

**Engine**: New `DynamicAmount` variant `{type: "last_resolved_source_strength"}` reads from `state.lastResolvedSource.strength` (snapshot taken at the moment the cost-side card resolved). Used by "exert one of your characters to deal damage equal to their strength."

**UI needs**: When the player picks a character to exert as the cost, the reward prompt should show the snapshot strength ("Deal 5 damage to chosen character" using the actual exerted character's S at the moment they were exerted, even if a static buff would have changed it after).

**Cards**: Ambush!

---

## Boost / cards-under subzone

**Engine**: `CardInstance.cardsUnder: CardInstanceId[]`. Boost keyword puts the top of deck facedown under the character. Triggers (`card_put_under`), statics (`hasCardUnder` filter, `cards_under_count` dynamic amount), and effects (`put_top_of_deck_under`, `put_cards_under_into_hand`) all read/write this pile. When the base leaves play, the entire stack goes to the controller's discard.

**UI needs**:
- Render a small stack indicator on a character/location showing `cardsUnder.length` (e.g., a number badge or a layered card silhouette below the card art)
- On hover/inspect, show what's in the pile (facedown — count only, not contents)
- Animate cards moving into/out of the pile when `card_put_under` fires
- When base banishes, animate the stack flowing to discard

**Cards using this**: Boost-keyword cards in Set 10/11 (Ariel Ethereal Voice, Donald Honeywell, etc.), Webby's Diary, Hiro Hamada Armor Designer, Wreck-it Ralph Raging Wrecker, Alice Well-Read Whisper, Scrooge's Counting House, Magica De Spell, Cheshire Cat, plus ~30 more in sets 10/11.

---

## Damage immunity (timed + static)

**Engine**: New TimedEffect kind `damage_immunity` with `source: "challenge" | "all" | "non_challenge"`. Static variant `damage_immunity_static` scanned into `gameModifiers.damageImmunity`. `dealDamageToCard` short-circuits to 0 and skips damage events when immunity matches.

**UI needs**:
- Shield icon overlay on characters with active immunity
- Differentiate visually: full shield (all damage), challenge-only shield, non-challenge shield (rare — Hercules)
- When a damage attempt is blocked, show a "0" or shield-flash animation

**Cards**: Noi Acrobatic Baby, Mickey Pirate Captain (×3), Baloo Ol' Iron Paws, Nothing We Won't Do, Hercules Mighty Leader, Chief Bogo Calling the Shots.

---

## Floating granted abilities

**Engine**: `FloatingTrigger.attachedToInstanceId` — a triggered ability can be attached to a chosen target for a duration. The ability-collection step reads timed-granted abilities alongside printed ones.

**UI needs**:
- Visual indicator on the target character showing it has a granted ability this turn (different color border, or a small spell icon)
- Tooltip showing the granted ability text + duration
- Clear the indicator when duration expires

**Cards**: Bruno Madrigal - Out of the Shadows, Medallion Weights.

---

## Mass inkwell effects

**Engine**: `MassInkwellEffect` with modes: `exert_all`, `ready_all`, `return_random_to_hand`, `return_random_until`.

**UI needs**:
- Animate inkwell tile when these fire — flip all cards exerted/ready, or pull random cards back to hand
- Mufasa's "exert all opposing inkwells" especially needs a clear visual since it's a major tempo swing

**Cards**: Mufasa - Ruler of Pride Rock, Ink Geyser.

---

## Mill / random discard

**Engine**: `MillEffect` (top N → discard), `discard_from_hand` with `chooser: "random"` (uses seeded RNG).

**UI needs**:
- Animation: cards flying from deck top to discard for mill
- Animation: random card revealed from hand and sent to discard
- Make sure the chosen random card is visible to the discarder

**Cards**: Dale Mischievous Ranger, A Very Merry Unbirthday, Mad Hatter's Teapot, Madame Medusa, Yzma Above It All, Lady Tremaine Bitterly Jealous, Basil Undercover Detective, Headless Horseman.

---

## Put damage counter (vs deal damage)

**Engine**: `DealDamageEffect.asDamageCounter: true` flag. Bypasses Resist, damage immunity, and `damage_dealt_to` triggers — pure state mutation per CRD distinction.

**UI needs**:
- Distinguish visually from regular damage: maybe a different damage marker color, or no impact animation
- Important so players understand why an immune character still took damage

**Cards**: Queen of Hearts - Unpredictable Bully.

---

## Reveal hand

**Engine**: `RevealHandEffect` emits a `hand_revealed` GameEvent. Headless — no lasting state.

**UI needs**:
- Show the revealed hand to all players (modal or sidebar)
- Highlight cards that match a follow-up filter if the rules text says "for each X you reveal..."

**Cards**: Dolores Madrigal, Copper Hound Pup, Ludwig Von Drake, Ursula Deceiver, Goldie O'Gilt, Timon Snowball Swiper.

---

## Draw to hand size

**Engine**: `DrawEffect.untilHandSize: number | "match_opponent_hand"`. Bounded draw, computes delta.

**UI needs**:
- Show the target hand size in the prompt ("Draw until you have 5 cards")
- Animate multiple cards drawn at once

**Cards**: Clarabelle Light on Her Hooves, Remember Who You Are, Yzma Conniving Chemist.

---

## Per-count self cost reduction

**Engine**: `SelfCostReductionStatic.amount` accepts `DynamicAmount` with optional `perMatch` multiplier. Resolves at play-time validation.

**UI needs**:
- Show the live discounted cost on the card in hand (the validator already computes it; the UI should display the reduced number)

**Cards**: Kristoff Reindeer Keeper, Olaf Happy Passenger, Gaston Pure Paragon, Sheriff of Nottingham, Seeking the Half Crown.

---

## Alert keyword

**Engine**: New `Keyword: "alert"`. Validator OR's it into Evasive challenge eligibility on the attacker side only. Per CRD: "this character can challenge as if they had Evasive."

**UI needs**:
- Render Alert keyword badge alongside Evasive/Rush/etc.
- When an Alert character challenges an Evasive defender, show the keyword resolving (highlight Alert)

**Cards**: Cri-Kee Good Luck Charm, Lexington, Inkrunner, Minnie Ghost Hunter, But I'm Much Faster, Sina Vigilant Parent, Amos Slade.

---

## Timed cant-be-challenged

**Engine**: Existing `cant_action` infrastructure with `action: "be_challenged"`. Floating restriction with `until_caster_next_turn` / `end_of_owner_next_turn` duration.

**UI needs**:
- Lock/shield icon distinct from immunity (this is "can't be targeted to challenge", not "takes 0 damage")
- Tooltip showing duration

**Cards**: Kanga Nurturing Mother, Safe and Sound, Isabela Madrigal In the Moment, Restoring Atlantis, Mother Will Protect You, Winterspell.

---

## Conditional cant-be-challenged

**Engine**: `cant_be_challenged` static with inline `condition: Condition` field; only active when condition holds.

**UI needs**:
- Same lock icon as above but flickering/conditional indicator
- Tooltip showing the gating condition

**Cards**: Kenai Big Brother, Nick Wilde Sly Fox, Galactic Council Chamber, Iago Out of Reach.

---

## Filtered cant-be-challenged

**Engine**: `attackerFilter` field on `cant_be_challenged` static.

**UI needs**:
- Same lock icon, tooltip showing which attackers are blocked ("can't be challenged by characters with cost 3 or less")

**Cards**: Mr. Big Shrewd Tycoon, Captain Amelia Commander of the Legacy.

---

## Enter-play-exerted static

**Engine**: `EnterPlayExertedStatic` modifier. `applyPlayCard` checks per-player filters and forces `isExerted: true` before triggers fire.

**UI needs**:
- Show a status icon on the source card ("opposing characters enter exerted")
- When opponent plays a character, animate it entering exerted with a hint that it's caused by the source

**Cards**: Jiminy Cricket Level-Headed and Wise, Figaro Tuxedo Cat.

---

## Restrict sing

**Engine**: Per-character `cant_action sing` static or timed effect.

**UI needs**:
- Disable the sing affordance on affected characters in the card popover
- Show a small "no sing" icon

**Cards**: Ulf the Mime, Pete Space Pirate, Gantu Experienced Enforcer.

---

## Play restriction (per-card playRestrictions)

**Engine**: `CardDefinition.playRestrictions: Condition[]`. Validator rejects if any condition fails.

**UI needs**:
- Show the card in hand as un-playable (greyed) when restrictions fail
- Tooltip explaining why

**Cards**: Mirabel Madrigal Family Gatherer, Nathaniel Flint, Devil's Eye Diamond, Brutus Fearsome Crocodile, Chief Seasoned Tracker, The Thunderquack.

---

## Event-tracking conditions

**Engine**: New Conditions `opposing_character_was_damaged_this_turn`, `a_character_was_banished_in_challenge_this_turn`. Read from per-turn event flags reset at turn start.

**UI needs**:
- These show up as gating on triggers/play restrictions — UI should show "this turn, X happened" indicators in the turn banner or near affected cards

**Cards**: see Play restriction list (most overlap).

---

## Move damage between characters

**Engine**: `MoveDamageEffect` (two-stage chosen flow — pick source, then destination). Already wired since Set 4 batch 6.

**UI needs**:
- Two sequential targeting prompts
- Visual: damage counters animating from source → destination

**Cards**: Belle Untrained Mystic, Belle Accomplished Mystic, Rose Lantern.

---

## Grant cost reduction (one-shot)

**Engine**: `GrantCostReductionEffect` adds a `CostReductionEntry` to PlayerState consumed by the next matching card played.

**UI needs**:
- Banner above the player's hand: "Next character costs 2 less"
- Auto-clear after consumption

**Cards**: Gaston Despicable Dealer, Imperial Proclamation.

---

## Opponent-chosen targets (chooser: "target_player")

**Engine**: `CardTarget.chosen.chooser = "target_player"` — pendingChoice surfaces with the OPPONENT as the choosing player.

**UI needs**:
- When this fires, show the prompt to the opposing player (or in solo testbench, swap perspective)
- Make clear "opponent is choosing" so the controller doesn't think it's stuck

**Cards**: Ursula's Plan, Be King Undisputed, Triton's Decree, Gunther Interior Designer.

---

## Reveal-top-conditional

**Engine**: `RevealTopConditionalEffect` with predicate filter, `matchAction` (to_hand / play_for_free), `noMatchDestination` (top / bottom / hand / discard), and optional `matchExtraEffects` chain.

**UI needs**:
- Animation: card flips face-up from deck
- Visual indication of match/miss (green/red glow)
- Show the destination (where the card is going next)

**Cards**: Pete Wrestling Champ, King's Sensor Core, Bruno Madrigal Undetected Uncle, John Smith's Compass.

---

## Dynamic amount (target_lore / target_damage / target_strength / source_lore / source_strength + max cap)

**Engine**: Shared `DynamicAmount` type extended with target-/source-relative variants and optional `max` cap.

**UI needs**:
- Show resolved amount in the prompt at choice time ("Gain 4 lore" rather than "Gain lore equal to chosen char's lore")
- Show the cap if active ("Gain 6 lore (capped)")

**Cards**: Camilo Madrigal, Go Go Tomago, Ambush!, Minnie Storyteller, Abu Illusory Pachyderm, Most Everyone's Mad Here, Pocahontas Following the Wind, Mulan Resourceful Recruit, Nani's Payback, Mr. Smee, Treasure Mountain, Strength of a Raging Fire.

---

## Play-from-zone (paid + per-instance source)

**Engine**: `play_for_free` extended with `cost: "free" | "normal"` and `sourceInstanceId: "self" | CardTarget`. Handles paying ink from a non-hand zone or from a specific source instance's `cardsUnder`.

**UI needs**:
- Show the alternate source visibly (highlight discard, inkwell, or cards-under stack)
- Distinguish from regular play

**Cards**: The Black Cauldron (cards-under), Pride Lands Jungle Oasis (discard), Circle of Life (discard).

---

## Put on bottom of deck

**Engine**: `PutOnBottomOfDeckEffect`.

**UI needs**:
- Animate card going to deck bottom (subtle — distinct from shuffle)

**Cards**: many across sets 5–11 — see commit `f6bfcab`.

---

## Dual-name characters

**Engine**: `CardDefinition.alternateNames: string[]`. `hasName` filter consults the alias list.

**UI needs**:
- Show both names on the card (Lorcast art usually does this, but the UI's hasName-driven filtering should reflect both)
- Search/filter UIs should match aliases

**Cards**: Flotsam & Jetsam Entangling Eels.
