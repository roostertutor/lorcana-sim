#!/usr/bin/env node
// =============================================================================
// CARD IMPLEMENTATION STATUS
// Live tracker for named ability stub progress across all sets.
//
// Usage:
//   pnpm card-status                         summary table for all sets
//   pnpm card-status --set 2                 filter to set 2 only
//   pnpm card-status --category unknown      list all unknown-category cards
//   pnpm card-status --category fits-grammar list all implementable cards
//   pnpm card-status --verbose               show rules text for listed cards
//
// Categories:
//   implemented        abilities/actionEffects filled in (named ability done)
//   vanilla            no named abilities to implement (keywords-only or blank)
//   fits-grammar       stubs exist, maps to existing Effect/Condition/Cost types
//   needs-new-type     stubs exist, needs a new Effect/StaticEffect/Cost/Condition type
//   needs-new-mechanic stubs exist, needs a new game system (Locations, Sing Together)
//   unknown            stubs exist, pattern unclear — needs manual review
// =============================================================================

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

// --- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
const filterSet = getArg("--set");
const filterCategory = getArg("--category");
const verbose = args.includes("--verbose");

// --- Types -------------------------------------------------------------------

type StubCategory =
  | "fits-grammar"
  | "needs-new-type"
  | "needs-new-mechanic"
  | "unknown";

type CardCategory = "implemented" | "vanilla" | StubCategory;

interface CardEntry {
  id: string;
  fullName: string;
  cardType: string;
  setId: string;
  category: CardCategory;
  stubs: { storyName: string; rulesText: string; category: StubCategory }[];
}

// --- Pattern matching --------------------------------------------------------

// Each rule: [pattern, category, label]
// Applied in order — first match wins. More specific patterns come first.
const NEW_MECHANIC_PATTERNS: [RegExp, string][] = [
  // (sing-together removed: implemented in Phase A.1 via singTogetherCost on CardDefinition)
  // (move-for-free / play-location-for-free removed: move_character effect implemented in Phase A.3
  //  (Magic Carpet, Jim Hawkins TAKE THE HELM); play_for_free with location filter implemented
  //  (Jim Hawkins ASTRO NAVIGATOR — Set 3).)
  // Win threshold modification (Donald Duck)
  [/\b\d+ lore to win\b/i, "win-threshold"],
  [/\bneed \d+ lore to win\b/i, "win-threshold"],
  // (boost-subzone, card-under-trigger, card-under-static, put-facedown-under-effect,
  //  cards-under-count, cards-under-to-hand removed: boost primitives implemented
  //  (CRD 8.4.2). card_put_under TriggerEvent, hasCardUnder CardFilter,
  //  cards_under_count DynamicAmount, put_top_of_deck_under (this OR chosen),
  //  put_cards_under_into_hand effect, you_control_matching condition all live.
  //  Matched by FITS_GRAMMAR_PATTERNS targeting put_top_of_deck_under,
  //  put_cards_under_into_hand, modify_stat_per_count, condition_this_has_cards_under
  //  capabilities below.)
  // CRD 6.5 Replacement effects — "would ... instead"
  [/\bwould be dealt damage.{0,80}instead\b/i, "replacement-effect"],
  [/\bwould take damage.{0,80}instead\b/i, "replacement-effect"],
  // Skip Draw step — turn structure modification
  [/\bskip .{0,20}draw step\b/i, "turn-structure"],
  // Global challenge limiter
  [/\bonly one character can challenge\b/i, "challenge-limiter"],
  // Super-Bodyguard — must choose this for actions AND abilities
  [/\bmust choose this character for actions and abilities\b/i, "super-bodyguard"],
  // Conditional lore lock — "can't gain lore unless"
  [/\bcan'?t gain lore unless\b/i, "conditional-lore-lock"],
  // Phase B — gaps surfaced by Set 4 wiring (regex used to false-positive into fits-grammar):
  // (for-each-opponent-who-didnt removed: each_opponent_may_discard_then_reward
  //  Effect implemented — Sign the Scroll, Ursula's Trickery. 2P-only;
  //  generalize when 3+P support lands. Matched as fits-grammar below.)
  // "Chosen character gains "<quoted floating triggered ability>" this turn"
  // create_floating_trigger applies to source, not chosen target (Bruno Madrigal).
  [/\bchosen .{0,30}gains? "[^"]+"\s*this turn\b/i, "grant-floating-trigger-to-target"],
  [/\bcharacter gains? \u201C[^\u201D]+\u201D this turn\b/i, "grant-floating-trigger-to-target"],
  // "Whenever they challenge another character this turn" — floating trigger attached to chosen target
  [/\bwhenever they challenge\b/i, "grant-floating-trigger-to-target"],
  // "if no other character has quested this turn" — historical event-count condition
  [/\bif no other character has quested this turn\b/i, "no-other-quested-condition"],
  // "your other characters can't quest for the rest of this turn"
  [/\byour other characters can'?t (quest|challenge)\b/i, "group-cant-action-this-turn"],
  // "Play a character with the same name as the banished character" — dynamic same-name play_for_free
  [/\bplay a .{0,30}with the same name as\b/i, "play-same-name-as-banished"],
  // "Move him and one of your other characters to the same location" — multi-character move
  [/\bmove .{0,20}and one of your other .{0,30}to the same location\b/i, "multi-character-move"],
  // "Whenever one of your characters is chosen for Support" — chosen_for_support trigger event
  [/\bis chosen for support\b/i, "chosen-for-support-trigger"],
  // (pay-extra-cost-mid-effect removed: SequentialEffect with isMay + pay_ink
  //  cost effect already supports the "you may pay N {I} to <effect>" pattern.
  //  Matched by FITS_GRAMMAR_PATTERNS targeting `sequential` capability.)
  // ── Compound false positives surfaced by cherry-pick pass ──
  // Vanish keyword — "when an opponent chooses this character for an action, banish them"
  // Needs a new "opponent-chose-for-action" trigger event.
  [/\bvanish\b.{0,20}\(/i, "vanish-keyword"],
  [/\bwhen an opponent chooses this character for an action, banish\b/i, "vanish-keyword"],
  // "You don't discard" — discard replacement effect (Magica De Spell, Kronk)
  [/\byou don'?t discard\b/i, "discard-replacement"],
  // "If this is your first turn" — Underdog keyword condition (set 11)
  // (underdog-condition removed: your_first_turn_as_underdog Condition implemented.)
  // "Twice during your turn, whenever" — twice-per-turn trigger flag
  [/\btwice during your turn, whenever\b/i, "twice-per-turn-trigger"],
  // Bulk move cards from discard → inkwell (Perdita, Rolly-bulk variants)
  [/\bput all .{0,40}cards? from your discard into your inkwell\b/i, "bulk-discard-to-inkwell"],
  // "Whenever one or more of your characters sings a song" — batched sings trigger
  [/\bwhenever one or more of your characters sings?\b/i, "batched-sings-trigger"],
  // "If none of your characters challenged this turn" — event-tracking condition
  // (no-challenges-this-turn-condition removed: no_challenges_this_turn Condition implemented.)
  // "If you've played a song this turn" — event-tracking condition
  // (song-played-this-turn-condition removed: songs_played_this_turn_gte already supported.)
  // "If you didn't put any cards into your inkwell this turn" — event-tracking condition
  [/\bif you didn'?t put any cards into your inkwell this turn\b/i, "no-ink-put-this-turn-condition"],
  // "If you've put a card under [this] this turn" — per-instance card-under event tracking
  // (card-under-event-condition removed: this_had_card_put_under_this_turn Condition implemented.)
  // "Unless you put a card under [this] this turn" — same gap
  // (above)
  // "For the rest of this turn, whenever" — floating player-scoped trigger
  [/\bfor the rest of this turn, whenever\b/i, "player-floating-trigger"],
  // "If you have a card named X in your discard" — discard-name condition
  [/\bif you have a card named .{0,40}in your discard\b/i, "discard-name-condition"],
  // "If an opponent has more cards in their hand than you" — hand-count compare condition
  [/\b(an? )?opponent has more cards in their hand than you\b/i, "hand-count-compare-condition"],
  // "Play X from [inkwell|there] for free" — Pongo: play from inkwell
  [/\bplay a .{0,40}from there for free\b/i, "play-from-inkwell"],
  [/\bplay .{0,30}character from .{0,20}inkwell\b/i, "play-from-inkwell"],
  // "Put [self] facedown under one of your characters" — put-self-under effect (Roo)
  [/\bput this character facedown under\b/i, "put-self-under-effect"],
  // "Put any number of cards from under [your chars] into your inkwell" (Visiting Christmas Past)
  [/\bcards? from under .{0,40}into your inkwell\b/i, "cards-under-to-inkwell"],
  // "Play an action from your discard for free, then put that action card on the bottom"
  [/\bplay an? .{0,30}from your discard for free,? then put\b/i, "play-from-discard-then-bottom"],
  // "Cost up to N more than the banished character" — dynamic cost filter from banished name
  [/\bcost up to \d+ more than the banished\b/i, "dynamic-cost-from-banished"],
  // "Reveal cards from the top of your deck until you reveal a [X]" — reveal-until effect
  [/\breveal cards? from the top of your deck until you reveal\b/i, "reveal-until-effect"],
  // "Choose N cards from [opponent's] discard" — multi-card choose from opponent discard
  [/\bchoose \d+ cards? from chosen opponent'?s discard\b/i, "choose-from-opponent-discard"],
  // "Return all character cards with that name from your discard" — name-a-card + bulk return-from-discard
  [/\breturn all character cards with that name from your discard\b/i, "name-then-bulk-return-from-discard"],
  // "Whenever [card type] is returned to their hand from play" — return-to-hand trigger (opponent)
  // (trigger-opponent-returned-to-hand removed: returned_to_hand + owner:opponent already supported.)
  // "Whenever you play a [second|third] [card type]" — Nth-card-played counter trigger
  [/\bwhenever you play a (second|third|fourth) (action|character|item|song)\b/i, "nth-card-played-trigger"],
  // "Whenever a character is challenged while here" — location challenged trigger
  [/\bwhenever a character is challenged while here\b/i, "location-challenged-trigger"],
  // "Whenever an opposing character is exerted" — opponent-exerts trigger
  [/\bwhenever an opposing character is exerted\b/i, "opponent-exerts-trigger"],
  // "Whenever an opposing character is damaged" — opponent-damaged trigger (distinct from "dealt damage")
  // (opponent-damaged-trigger removed: damage_dealt_to with owner:opponent filter already supported.)
  // "When this character is banished, choose one" — banished + modal choose sequential
  [/\bwhen this character is banished, choose one\b/i, "banished-modal-choose"],
  // "Whenever an opponent chooses this character for an action or ability" — chosen-by-opponent trigger
  [/\bwhenever an opponent chooses this character for an action\b/i, "chosen-by-opponent-trigger"],
  // Dinner Bell: "Draw cards equal to the damage on chosen character" — draw-with-dynamic-amount-from-target
  [/\bdraw cards? equal to the damage on\b/i, "dynamic-draw-from-target-damage"],
  // "When you put a card into your inkwell, if it's the [second|third|fourth] card" — inkwell-count trigger
  // (inkwell-count-trigger removed: ink_played trigger + ink_plays_this_turn_eq Condition implemented.)
  // "For each opposing character banished in a challenge this turn, you pay N less"
  [/\bfor each opposing character banished in a challenge this turn, you pay\b/i, "event-tracking-cost-reduction"],
  // Other-at-location static ("While one of your X characters is at a location, that character gains")
  [/\bwhile one of your .{0,40}is at a location, that character\b/i, "other-at-location-static"],
  // "If this card is in your discard, you may play her" — self play-from-discard trigger
  // (self-play-from-discard removed: TriggeredAbility activeZones + play_for_free target:this implemented.)
  // Location "whenever a character is banished here" trigger
  // (location-banished-here-trigger removed: is_banished + atLocation:"this" filter already supported.)
  // "Whenever a character is banished in a challenge while here"
  [/\bwhenever a character is banished in a challenge while here\b/i, "location-banished-here-trigger"],
  // Location "when you move a character here from another location"
  // (location-moves-here-trigger removed: moves_to_location + atLocation:"this" filter already supported.)
  // Lore transfer ("all opponents lose 1 lore and you gain lore equal to the lore lost")
  [/\byou gain lore equal to the lore lost\b/i, "lore-transfer"],
  // Grant activated ability to own chars this turn ("Your X characters gain \"{E}...\" this turn")
  // (grant-activated-to-own-timed removed: grant_activated_ability_timed Effect implemented.)
  // Exert one of your X to deal damage equal to their {S}
  [/\{E\} one of your characters to deal damage equal to (their|its|his|her)\b/i, "exert-one-dynamic-damage"],
  // "play characters using their Shift ability" — Shift-scoped cost reduction
  [/\bplay characters using their shift ability\b/i, "shift-scoped-cost-reduction"],
  // "Each player may reveal a character card from their hand and play it for free"
  [/\beach player may reveal a .{0,30}from their hand and play\b/i, "symmetric-reveal-play"],
  // "Banish chosen item of yours to play this character for free" — alternate play cost
  [/\bbanish chosen item of yours to play this character for free\b/i, "alt-play-cost-banish-item"],
  // Kida: "Put one into your ink supply, face down and exerted, and the other on top"
  [/\bput one into your ink supply.{0,40}(and )?(the )?other\b/i, "look-top-split"],
  // Goofy - Groundbreaking Chef: remove damage from each of your others + ready each one
  [/\bremove up to \d+ damage from each of your other characters\. ready each character\b/i, "compound-remove-then-ready"],
  // Singular "whenever one of your characters sings a song"
  [/\bwhenever one of your characters sings a song\b/i, "other-sings-trigger"],
  // Reveal-from-hand as cost ("reveal a X card in your hand to ...")
  [/\breveal a .{0,30}card in your hand to\b/i, "reveal-from-hand-as-cost"],
  // Banish-self OR return-another modal on ETB (Madam Mim - Rhino)
  [/\bbanish (her|him|it|them|this character) or return another chosen character\b/i, "self-banish-or-return-modal"],
  // "Give that character X and \"<quoted trigger>\" this turn" — grant floating trigger to target via "give"
  [/\bgive that character .{0,60}["\u201C][^"\u201D]+["\u201D]\s*this turn\b/i, "grant-floating-trigger-to-target"],
  // Jafar High Sultan: "If an Illusion character card is discarded this way, you may play that character"
  [/\bif a[n]? .{0,30}is discarded this way, you may play\b/i, "play-from-discard-result"],
  // "For each character that sang this song" — per-singer dynamic in Sing Together
  [/\bfor each character that sang this song\b/i, "per-singer-dynamic"],
  // "If you used Shift to play (them|her)" referencing the triggering played card (not self)
  // (shift-condition-on-trigger-source removed: played_via_shift +
  //  triggering_card_played_via_shift Conditions already supported.)
  // Tinker Bell: exert the triggering card (not self)
  [/\bwhenever you play a character .{0,40}you may exert them\b/i, "exert-triggering-card"],
  // Geppetto-style: discard any number of [type] cards to gain N per discarded
  // (discard-any-number-dynamic removed: discard_from_hand amount:"any" + sequential cost_result implemented.)
  // Dusk to Dawn: fill-hand ("they draw until they have N")
  // (fill-hand removed: fill_hand_to Effect implemented.)
  // Reuben: per-damage-removed cost reduction
  [/\bfor each \d+ damage removed this way, you pay\b/i, "dynamic-cost-reduction-from-effect"],
  // "Draw X unless that character's player puts" — inverse unless branch
  [/\bunless that character'?s player puts\b/i, "inverse-unless-opponent-choice"],
  // Cruella: "When this character is challenged and banished" — combo trigger
  [/\bwhen this character is challenged and banished\b/i, "challenged-and-banished-trigger"],
  // Goliath "Stone by Day": "this character can't ready" gated by hand size — static cant_ready
  [/\bif you have \d+ or more cards in your hand, this character can'?t ready\b/i, "conditional-cant-ready-static"],
  // Mr. Litwak: ready self + "can't quest or challenge for the rest of this turn" compound
  // (ready-then-cant-act-compound removed: ready + cant_action timed already supported.)
  // Darkwing Tower: ready-here compound with cant_quest_rest_of_turn
  [/\bready a character here\..{0,40}can'?t quest\b/i, "ready-then-cant-act-compound"],
  // Mulan: "character in play with damage" — damage-existence condition
  [/\bif you have a character in play with damage\b/i, "has-damaged-character-condition"],
  // Fantastical etc.: Sing Together dynamic-per-singer also caught above via per-singer-dynamic
  // "If you played another character this turn" — event-tracking condition (set P3 Travelers)
  // (played-another-this-turn-condition removed: played_another_character_this_turn Condition implemented.)
  // "You may pay N {I} to choose one" on ETB — pay-then-modal sequential
  [/\byou may pay \d+ \{I\} to choose one\b/i, "pay-then-modal"],
  // "Draw a card for each character you have in play" — dynamic draw from count
  [/\bdraw (a |\d+ )cards? for each .{0,40}you have in play\b/i, "dynamic-draw-from-count"],
  // "While this character is being challenged" — static effect gated by being-challenged state
  // (being-challenged-static removed: modify_stat_while_challenged + affects:attacker implemented.)
  // "Reveal up to N X character cards and up to N Y" (Family Madrigal) — multi-filter search/look
  [/\breveal up to \d+ .{0,40}and up to \d+ .{0,30}cards?\b/i, "multi-filter-look-reveal"],
  // "Whenever you play a Floodborn character on this card" — shift-onto-self trigger
  [/\bwhen you play a .{0,20}character on this card\b/i, "shift-onto-self-trigger"],
  // Desperate Plan: "choose and discard any number of cards, then draw that many"
  [/\bdiscard any number of cards,? then draw that many\b/i, "discard-any-number-dynamic"],
  // Akela / Baloo — stubbed modals ("— This character gets +1 {S} this turn.") are modal inner options
  // and render as lone stubs. These are genuinely wireable as part of a choose_one; leave as-is.
];

const NEW_TYPE_PATTERNS: [RegExp, string][] = [
  // (alert-keyword removed: "alert" is in the Keyword union and handled by
  //  the validator — CRD 10.x. Matched by the keyword-grant regex in
  //  FITS_GRAMMAR_PATTERNS.)
  // (dynamic-amount entries moved to FITS_GRAMMAR_PATTERNS — DynamicAmount
  // target_*/source_* variants + max cap implemented in the engine.)
  // (count-based-effect removed: gain_stats gained strengthDynamic +
  //  strengthDynamicNegate fields backed by DynamicAmount count variant.)
  // (per-count-cost-reduction removed: self_cost_reduction.amount accepts
  //  `{ type: "count", filter }` with perMatch multiplier. Matched as
  //  fits-grammar via the "pay .{0,10} less" entry in FITS_GRAMMAR_PATTERNS.)
  [/\bpay .{0,20}equal to the number\b/i, "pay-equal-to-count"],
  // Mass inkwell manipulation
  [/\beach player.{0,60}inkwell/i, "mass-inkwell"],
  [/\ball (the )?cards? in .{0,30}inkwell/i, "mass-inkwell"],
  [/\buntil (you|they|each player) have \d+ cards? in .{0,20}inkwell/i, "trim-inkwell"],
  // Inkwell static that affects entering
  // (inkwell-static removed: inkwell_enters_exerted StaticEffect implemented —
  //  Daisy Duck Paranormal Investigator. Matched as fits-grammar below.)
  // Ink from discard / play from non-hand zone (Moana, Black Cauldron)
  // (play-from-discard removed: play_for_free has `sourceZone` since set 3 — matches
  //  via FITS_GRAMMAR_PATTERNS below. The two remaining patterns are genuinely new.)
  [/\bink .{0,30}from .{0,20}discard/i, "ink-from-discard"],
  // "Enters play exerted" for opposing cards (static)
  // (enter-play-exerted-static removed: EnterPlayExertedStatic implemented;
  //  Jiminy Cricket Level-Headed and Wise + Figaro Tuxedo Cat wired.)
  // (move-damage removed: move_damage Effect already exists — Belle Untrained Mystic,
  //  Belle Accomplished Mystic, Rose Lantern. Regex was over-broad, shunting real
  //  fits-grammar cards into needs-new-type. Fits-grammar patterns below handle it.)
  // (reveal-hand removed: reveal_hand Effect implemented. Matched as
  //  fits-grammar below.)
  // (timed-cant-be-challenged removed: cant_be_challenged_timed Effect already
  //  implemented. Matched as fits-grammar below.)
  // Conditional "can't be challenged" with filter (Nick Wilde, Kenai, Iago)
  [/while .{0,60}can'?t be challenged\b/i, "conditional-cant-be-challenged"],
  // (damage-immunity removed: damage_immunity_timed Effect +
  //  damage_immunity_static StaticEffect implemented. Regex now lives in
  //  FITS_GRAMMAR_PATTERNS and points at the `damage_immunity` capability.)
  [/\bprevent .{0,30}damage\b/i, "damage-prevention"],
  // Damage removal prevention (Vision Slab: "damage counters can't be removed")
  [/\bdamage counters can'?t be removed\b/i, "damage-removal-prevention"],
  // "Discard until they have N" / "draw until you have N" — trim hand
  [/\bdiscard.{0,20}until .{0,20}have \d+ cards?\b/i, "trim-hand"],
  [/\bdiscards? until they have\b/i, "trim-hand"],
  // (draw-to-n removed: DrawEffect.untilHandSize implemented — matched as
  //  fits-grammar via the "draw..until" pattern below.)
  // (mill removed: MillEffect implemented; matched as fits-grammar below.)
  // (put-on-bottom removed: put_on_bottom_of_deck Effect implemented; matched
  //  by FITS_GRAMMAR_PATTERNS below.)
  // Opponent-chosen banish ("each opponent chooses and banishes one of their characters")
  [/\beach opponent chooses and banishes\b/i, "opponent-chosen-banish"],
  // Opponent-chosen return to hand ("each opponent chooses one of their characters and returns")
  [/\beach opponent chooses .{0,40}returns?\b/i, "opponent-chosen-return"],
  // (exert-filtered-cost removed: "{E} one of your X" is modeled as a leading
  //  exert effect on an activated ability — always supported. Matched by the
  //  generic `exert` regex in FITS_GRAMMAR_PATTERNS.)
  // Shift variants — classification shift, universal shift, name aliases
  [/\buniversal shift\b/i, "shift-variant"],
  [/\b[A-Z][a-z]+ shift \d+\b/i, "shift-variant"],
  [/\bcounts as being named (both|any)\b/i, "shift-variant"],
  [/\bcounts as .{0,30}named .{0,30}for shift\b/i, "shift-variant"],
  [/\bMIMICRY\b/i, "shift-variant"],
  [/\bas if this character had any name\b/i, "shift-variant"],
  // Opposing can't sing / exert to sing
  [/can'?t .{0,30}(exert to )?sing\b/i, "restrict-sing"],
  // "If they don't" — inverse sequential (no matching branch in SequentialEffect)
  [/\bif they don'?t\b/i, "inverse-sequential"],
  [/\bif (he|she|it|they) doesn'?t\b/i, "inverse-sequential"],
  // (random-discard removed: discard_from_hand chooser:"random" already handles
  //  this. Cards wired in this batch.)
  // "Gains the [Trait] classification" — trait granting
  [/\bgain.{0,10}classification\b/i, "grant-classification"],
  [/\blose.{0,10}(the )?[A-Z][a-z]+ (classification|ability)\b/i, "remove-ability"],
  // (stat-floor removed: stat_floor_printed StaticEffect implemented — Elisa Maza
  //  Transformed Gargoyle. Matched as fits-grammar below.)
  // "Can't lose lore" (during opponents' turns)
  [/\bcan'?t lose lore\b/i, "prevent-lore-loss"],
  // "Count as having +N cost" (virtual cost for singer threshold)
  // (virtual-cost-modifier removed: sing_cost_bonus_here StaticEffect implemented —
  //  Atlantica Concert Hall. Matched as fits-grammar below.)
  // "Plays X again from discard, put on bottom" — replay from discard
  [/\bplay .{0,40}again from your discard\b/i, "replay-from-discard"],
  // "All cards in your hand count as having [ink color]" — dual ink grant
  [/\bcount as having \{I/i, "virtual-ink-color"],
  // New trigger events: "when this character exerts" / "deals damage in challenge" / "is dealt damage"
  [/whenever this character exerts\b/i, "new-trigger-exerts"],
  [/whenever this character deals damage\b/i, "new-trigger-deals-damage"],
  [/whenever this character is dealt damage\b/i, "new-trigger-is-dealt-damage"],
  // (song-trigger removed: "Whenever you play a song" → card_played with hasTrait Song filter
  //  works today; "Whenever this character sings a song" → sings trigger event implemented in
  //  Phase A.1.)
  // Condition based on character strength threshold ("if you have a character with 5 {S}")
  // (stat-threshold-condition removed: you_control_matching + strengthAtLeast filter already supported.)
  // (self-stat-condition removed: self_stat_gte exists.)
  // (new-trigger-sings removed: sings trigger event implemented in Phase A.1.)
  // "Can't play actions/items" scoped to card type (Pete, Keep the Ancient Ways)
  // (restricted-play-by-type removed: restrict_play Effect implemented — Pete Games
  //  Referee, Keep the Ancient Ways. Matched as fits-grammar below.)
  // "Can't play this character unless" — play restriction condition
  // (play-restriction removed: CardDefinition.playRestrictions implemented +
  //  consulted by validatePlayCard. Mirabel x2 wired; Nathaniel Flint deferred
  //  with event-tracking-condition.)
  // "Was damaged this turn" — event-tracking condition
  [/was damaged this turn\b/i, "event-tracking-condition"],
  // (name-a-card removed: name_a_card_then_reveal effect implemented in Phase A.0.)
  // "Reveal top card... if it's a [type] card... put into hand. Otherwise, top/bottom"
  [/\breveal the top card.{0,60}(if it'?s?|put).{0,40}(into (your|their) hand|on the (top|bottom))/i, "reveal-top-conditional"],
  // (conditional-keyword-by-turn removed: grant_keyword static + is_your_turn condition both exist.)
  // (filtered-cant-be-challenged removed: cant_be_challenged static accepts
  //  attackerFilter with strengthAtLeast/hasTrait. Cards wired this batch.)
  // (both-players-effect removed: target { type: "both" } works for draw,
  //  discard_from_hand, and (as of this batch) gain_lore.)
  // (put-damage-counter removed: deal_damage gained `asDamageCounter: true`
  //  flag — bypasses Resist + immunity + dealt_damage triggers per CRD.)
  // Dynamic filter based on card's own stat ("cost equal to or less than this character's {S}")
  [/cost equal to or less than .{0,30}\{S\}/i, "dynamic-filter"],
  // (broader timed-cant-be-challenged entries also removed — see above.)
  // "Reveal top card, if matching type put in hand, otherwise top/bottom of deck"
  [/\breveal the top card of your deck\b/i, "reveal-top-conditional"],
  // Compound condition (exerted + named character in play, etc.)
  [/\bwhile .{0,30}exerted.{0,30}(if you have|you have)\b/i, "compound-condition"],
  // "play it as if it were in your hand" — play-from-revealed
  [/\bplay it as if it were in your hand\b/i, "play-from-revealed"],
  // "lose the [ability name] ability" — ability removal static
  [/\blose the .{0,30} ability\b/i, "remove-ability"],
  // (cards-under-to-hand removed: put_cards_under_into_hand Effect implemented;
  //  matched by FITS_GRAMMAR_PATTERNS below.)
  // "gets +{S} equal to the {S} of chosen character" — dynamic stat gain from another card
  [/gets? \+\{S\} equal to\b/i, "dynamic-stat-gain"],
  // (final timed-cant-be-challenged entries also removed — see above.)
  // (timed-cant-action removed: cant_action effect with end_of_owner_next_turn duration works today.)
  // "was banished in a challenge this turn" — event tracking condition
  [/was banished in a challenge this turn\b/i, "event-tracking-condition"],
];

// Patterns that strongly suggest the card fits existing grammar.
// Each entry pairs a regex with a capability_id. A regex match only counts as
// fits-grammar if its capability_id is listed in CAPABILITIES below — otherwise
// the card falls through to needs-new-mechanic. This prevents the categorizer
// from lying when a regex matches text whose underlying primitive isn't actually
// implemented (e.g. "chosen char gains \"...\" this turn" matches a return-to-hand
// regex via the inner quoted text, but the engine can't grant a floating trigger
// to a target character).
//
// Capability IDs are derived from the actual Effect/StaticEffect/Condition/
// TriggerEvent/Cost union members in packages/engine/src/types/index.ts. When
// you implement a new primitive, add its capability_id to CAPABILITIES.
const CAPABILITIES = new Set<string>([
  // Effects (Effect union)
  "draw", "deal_damage", "remove_damage", "banish", "return_to_hand",
  "gain_lore", "lose_lore", "gain_stats", "grant_cost_reduction",
  "move_damage", "put_top_of_deck_under", "return_all_to_bottom_in_order",
  "put_cards_under_into_hand", "cant_be_challenged_timed",
  "reveal_top_conditional", "name_a_card_then_reveal", "move_character",
  "gain_conditional_challenge_bonus", "create_card", "search", "choose",
  "exert", "ready", "grant_keyword", "cant_action", "look_at_top",
  "discard_from_hand", "conditional_on_target", "play_for_free", "play-from-under",
  "shuffle_into_deck", "move_to_inkwell", "grant_extra_ink_play",
  "put_on_bottom_of_deck", "pay_ink",
  "sequential", "create_floating_trigger_on_self",
  "mill",
  "mass_inkwell",
  "create_floating_trigger_attached",
  "dynamic-amount",
  "reveal_hand", "draw_until_hand_size", "per_count_self_cost_reduction",
  // Static effects
  "stat_static", "cant_be_challenged_static", "cost_reduction_static",
  "action_restriction_static", "grant_activated_ability_static",
  "damage_immunity", "stat_floor_printed", "restrict_play", "sing_cost_bonus_here",
  "inkwell_enters_exerted", "each_opponent_may_discard_then_reward",
  // Triggers (TriggerEvent.on)
  "trigger_enters_play", "trigger_leaves_play", "trigger_quests",
  "trigger_sings", "trigger_challenges", "trigger_is_challenged",
  "trigger_is_banished", "trigger_banished_in_challenge",
  "trigger_turn_start", "trigger_turn_end", "trigger_card_played",
  "trigger_item_played", "trigger_banished_other_in_challenge",
  "trigger_damage_dealt_to", "trigger_moves_to_location",
  "trigger_damage_removed_from", "trigger_readied",
  "trigger_returned_to_hand", "trigger_cards_discarded",
  "trigger_deals_damage_in_challenge",
  "trigger_card_put_under",
  // Conditions
  "condition_is_your_turn", "condition_self_stat_gte",
  "condition_played_via_shift", "condition_cards_in_zone_gte",
  "condition_has_character_named",
  "condition_this_has_cards_under", "condition_you_control_matching",
  "condition_characters_here_gte",
  "condition_your_first_turn_as_underdog",
  "modify_stat_per_count",
  // Locations / location-related
  "location_at_location_filter",
  // Misc grammars
  "vanilla_reminder_text", "deck_construction_rule",
  "sing_together_reminder",
]);

const FITS_GRAMMAR_PATTERNS: [RegExp, string][] = [
  [/\bwhile here\b/i, "location_at_location_filter"],
  [/\bwhile .{0,20}is at a location\b/i, "location_at_location_filter"],
  [/\bat the start of your turn,? for each character .{0,20}here\b/i, "location_at_location_filter"],
  [/\bwhenever .{0,30}moves to a location\b/i, "trigger_moves_to_location"],
  [/\bdraws? (a|\d+) cards?\b/i, "draw"],
  [/\bdraws? a card\b/i, "draw"],
  [/\bdeal \d+ damage\b/i, "deal_damage"],
  [/\bdeals? \d+ damage\b/i, "deal_damage"],
  [/\bput \d+ damage (counter|on)\b/i, "deal_damage"],
  [/\bremove .{0,15}damage\b/i, "remove_damage"],
  [/\breturn .{0,60}to .{0,25}(their|your|a player'?s?) hand\b/i, "return_to_hand"],
  [/\breturn .{0,30}(character|item|card).{0,30}to .{0,20}hand\b/i, "return_to_hand"],
  [/\bgain \d+ lore\b/i, "gain_lore"],
  [/\bgains? \d+ lore\b/i, "gain_lore"],
  [/\blose[s]? \d+ lore\b/i, "lose_lore"],
  [/\bgets? [+-]\d+ \{[SWL]\}/i, "gain_stats"],
  [/\bgives? .{0,30}[+-]\d+ \{[SWL]\}/i, "gain_stats"],
  [/\bgets? [+-]\d+ (strength|willpower|lore)\b/i, "gain_stats"],
  [/\b[+-]\d+\/[+-]?\d+\b/i, "gain_stats"],
  [/\bgets? \+\d+ this turn\b/i, "gain_stats"],
  [/\bgets? -\d+ this turn\b/i, "gain_stats"],
  [/\bgets? -\d+ until\b/i, "gain_stats"],
  [/\bbanish\b/i, "banish"],
  [/\bready\b/i, "ready"],
  [/\bexert\b/i, "exert"],
  [/\bsearch (your|their|a|chosen) (player'?s? )?deck\b/i, "search"],
  [/\blook at the top \d+/i, "look_at_top"],
  [/\blook at the top (card|of)\b/i, "look_at_top"],
  [/\blook at .{0,20}top card\b/i, "look_at_top"],
  // mill: "puts the top N cards into discard"
  [/\bputs? the top \d+ cards? .{0,30}into .{0,20}discard\b/i, "mill"],
  [/\bputs? the top card .{0,30}into .{0,20}discard\b/i, "mill"],
  [/\bdiscard (a|one|chosen|\d+)/i, "discard_from_hand"],
  [/\bchoose and discard\b/i, "discard_from_hand"],
  [/\bchooses? and discards?\b/i, "discard_from_hand"],
  [/\bdiscard your hand\b/i, "discard_from_hand"],
  [/\bshuffle\b/i, "shuffle_into_deck"],
  [/\bpay .{0,10}less\b/i, "cost_reduction_static"],
  [/\bcosts? .{0,10}less\b/i, "cost_reduction_static"],
  // reveal-hand: pure reveal + reveal-and-discard-X grammars
  [/\breveal.{0,30}(their|opponent'?s?|your) hand\b/i, "reveal_hand"],
  [/\blook at each opponent'?s? hand\b/i, "reveal_hand"],
  // draw-to-n: "draw until you have N" / "draw until you have the same number"
  [/\bdraw (cards? )?until you have\b/i, "draw_until_hand_size"],
  // per-count self cost reduction: "For each X, you pay N {I} less"
  [/for each .{0,60}you pay .{0,10}(\{i\}|less)/i, "per_count_self_cost_reduction"],
  [/\b(gains?|have|get|give) .{0,20}(evasive|rush|bodyguard|ward|reckless|resist|challenger|support|singer|shift|alert)\b/i, "grant_keyword"],
  // Alert keyword reminder text or standalone keyword line.
  [/\balert\b/i, "grant_keyword"],
  // Timed cant-be-challenged — cant_be_challenged_timed Effect already exists.
  [/can'?t be challenged until\b/i, "cant_be_challenged_timed"],
  [/chosen .{0,40}can'?t be challenged until\b/i, "cant_be_challenged_timed"],
  [/\bcan'?t quest\b/i, "cant_action"],
  [/\bcan'?t challenge\b/i, "cant_action"],
  [/\bcan'?t ready\b/i, "cant_action"],
  [/\bthis character can'?t be challenged\b/i, "cant_be_challenged_static"],
  [/\binto .{0,30}inkwell\b/i, "move_to_inkwell"],
  [/\bplay .{0,50}for free\b/i, "play_for_free"],
  [/\bwithout paying .{0,20}(ink )?cost\b/i, "play_for_free"],
  [/\byou may play .{0,40}from under\b/i, "play-from-under"],
  [/\bcreate .{0,30}token\b/i, "create_card"],
  [/\benter[s]? play exerted\b/i, "exert"],
  [/^\(?A character with cost \d+ or more can/i, "vanilla_reminder_text"],
  [/\bput it on (either the )?(top|bottom)/i, "look_at_top"],
  [/if you have a character named .{0,40}(pay|less)\b/i, "condition_has_character_named"],
  [/\bat the (start|end) of (your|each opponent'?s?) turn\b/i, "trigger_turn_start"],
  [/\bgets? \+\d+ \{[SWL]\}/i, "stat_static"],
  [/\benter[s]? play with \d+ damage\b/i, "deal_damage"],
  [/\bdiscards? all (the )?cards? in (their|your|a) hand\b/i, "discard_from_hand"],
  [/\bdiscard all\b/i, "discard_from_hand"],
  [/\bfrom .{0,20}discard on the top of .{0,20}deck\b/i, "shuffle_into_deck"],
  [/\bdeal \d+ damage to each (opposing|opponent'?s?)\b/i, "deal_damage"],
  [/^choose one:$/i, "choose"],
  [/\bchoose one:\s*$/i, "choose"],
  [/\bif .{0,40}(is chosen|character is chosen|is named).{0,40}instead\b/i, "conditional_on_target"],
  [/\bgets? \+\d+ \{S\}.{0,40}instead\b/i, "conditional_on_target"],
  [/\byou may have up to \d+ copies\b/i, "deck_construction_rule"],
  [/\beach opponent chooses one .{0,40}returns?\b/i, "return_to_hand"],
  [/\breturn all opposing characters\b/i, "return_to_hand"],
  [/\bgive .{0,40}(resist|challenger) \+\d+ until\b/i, "grant_keyword"],
  [/\bcan'?t (quest|challenge) during (their|your) next turn\b/i, "cant_action"],
  [/\bchosen opposing character can'?t (quest|challenge)\b/i, "cant_action"],
  [/\bthis character can'?t (challenge|quest)\b/i, "action_restriction_static"],
  [/\btakes? no damage from the challenge\b/i, "stat_static"],
  // damage-immunity family — damage_immunity_timed / damage_immunity_static.
  [/\btakes? no damage from challenges\b/i, "damage_immunity"],
  [/\bcan'?t be dealt damage\b/i, "damage_immunity"],
  // stat-floor — Elisa Maza Transformed Gargoyle "can't be reduced below their printed value".
  [/\bcan'?t be reduced below .{0,20}printed\b/i, "stat_floor_printed"],
  // restricted-play-by-type — Pete Games Referee, Keep the Ancient Ways.
  [/\bcan'?t play (actions|items|actions or items)\b/i, "restrict_play"],
  // virtual-cost-modifier — Atlantica Concert Hall ("count as having +N cost ... while here").
  [/\bcount as having .{0,10}cost .{0,30}while here\b/i, "sing_cost_bonus_here"],
  // inkwell-static — Daisy Duck Paranormal Investigator ("cards enter opponents' inkwells exerted").
  [/\benter.{0,10}opponents'.{0,20}inkwell.{0,20}exerted\b/i, "inkwell_enters_exerted"],
  // for-each-opponent-who-didnt — Sign the Scroll, Ursula's Trickery (2P only for now).
  [/\bfor each opponent who (doesn'?t|does not)\b/i, "each_opponent_may_discard_then_reward"],
  [/\bcan'?t be challenged by .{0,30}characters\b/i, "cant_be_challenged_static"],
  [/\bwhile being challenged\b/i, "trigger_is_challenged"],
  [/during your turn.{0,40}(has|gains?) (evasive|rush|bodyguard|ward|reckless|resist|challenger|support)/i, "grant_keyword"],
  [/\bmove .{0,15}damage counter/i, "move_damage"],
  [/\bmove (a |all |\d+ )?damage from\b/i, "move_damage"],
  [/\bmove up to \d+ damage\b/i, "move_damage"],
  [/\bmove \d+ damage from\b/i, "move_damage"],
  [/\beach opponent chooses .{0,40}(banishes?|exerts?|returns?|deals?)\b/i, "choose"],
  [/gets? \+\{S\} equal to this character'?s? \{S\}/i, "gain_stats"],
  [/\+\d+ \{S\}.{0,20}for each card in your hand/i, "gain_stats"],
  [/\byou pay \d+ \{I\} less for the next\b/i, "grant_cost_reduction"],
  [/banish one of your\b/i, "banish"],
  [/whenever (you|this character) (play|sing)s? a song\b/i, "trigger_card_played"],
  [/while .{0,20}has? \d+ \{S\} or more\b/i, "condition_self_stat_gte"],
  [/\bif you used shift\b/i, "condition_played_via_shift"],
  [/while .{0,10}(you|they) have .{0,40}in (your|their) (play|hand|discard|inkwell)\b/i, "condition_cards_in_zone_gte"],
  [/can'?t (challenge|quest) during their next turn\b/i, "cant_action"],
  [/\bname a card\b/i, "name_a_card_then_reveal"],
  // reveal-top-conditional family (sets 5-11): wired via RevealTopConditionalEffect
  // with noMatchDestination top/bottom/hand/discard + optional matchExtraEffects.
  [/\breveal the top card of your deck\b/i, "reveal_top_conditional"],
  [/^sing together \d/i, "sing_together_reminder"],
  // Put card on bottom of deck (no shuffle — different from shuffle_into_deck)
  [/\bput .{0,40}on the bottom of .{0,20}deck\b/i, "put_on_bottom_of_deck"],
  // "you may pay N {I} to <effect>" — sequential w/ isMay + pay_ink cost effect.
  [/\bmay pay \d+ \{I\} to\b/i, "sequential"],
  // Dynamic amount: damage/lore/draw/lose-lore tied to a stat, count, or cost.
  [/deal .{0,40}damage equal to\b/i, "dynamic-amount"],
  [/\bgain lore equal to\b/i, "dynamic-amount"],
  [/\blose[s]? lore equal to\b/i, "dynamic-amount"],
  [/equal to (their|this character'?s?|chosen|the number|the cost|her \{|his \{|its \{)\b/i, "dynamic-amount"],
  [/\bgain lore equal to (another|a|chosen|her|his)\b/i, "dynamic-amount"],
  // Boost family — CRD 8.4.2 (post-c6aa811 + 975d3f5 wiring).
  [/\bboost \d+ \{I\}/i, "put_top_of_deck_under"],
  [/\bboost ability\b/i, "put_top_of_deck_under"],
  // "Whenever you put a card under [this/them/one of your]" → card_put_under trigger
  [/\bwhenever you put a card .{0,40}under\b/i, "trigger_card_put_under"],
  // "While there's a card under [this/her/him]" → this_has_cards_under condition
  [/\bwhile (there'?s? a card|.{0,30}has.{0,15}card) under\b/i, "condition_this_has_cards_under"],
  // "with a card under (this/them/him/her/one of)" — hasCardUnder filter on chosen target
  [/\bwith a card under (this|them|him|her|one of|a)\b/i, "condition_this_has_cards_under"],
  // "While you have a character or location in play with a card under" → you_control_matching
  [/\bwhile you have .{0,40}with a card under\b/i, "condition_you_control_matching"],
  // "if you have a character or location in play with a card under" → you_control_matching
  [/\bif you have .{0,40}with a card under\b/i, "condition_you_control_matching"],
  // "put the top card of your deck (facedown )?under" → put_top_of_deck_under effect
  [/\bput the top card .{0,30}under\b/i, "put_top_of_deck_under"],
  [/\bput .{0,30}facedown under\b/i, "put_top_of_deck_under"],
  // "for each card under" / "number of cards under" → cards_under_count dynamic amount
  // Engine resolves via modify_stat_per_count.countCardsUnderSelf for statics, or
  // cards_under_count DynamicAmount variant for effects.
  [/\bfor each card under\b/i, "modify_stat_per_count"],
  [/\bnumber of cards under\b/i, "modify_stat_per_count"],
  // "Put all cards from under [this/her] into your hand" → put_cards_under_into_hand
  [/\bput all cards from under\b/i, "put_cards_under_into_hand"],
  [/\bcards from under .{0,20}into .{0,15}hand\b/i, "put_cards_under_into_hand"],
];

function categorizeStub(rulesText: string, cardType: string): StubCategory {
  // Normalize curly quotes/apostrophes to straight — Lorcast data uses both
  const normalized = rulesText.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u2013\u2014]/g, "-");
  for (const [pattern, _label] of NEW_MECHANIC_PATTERNS) {
    if (pattern.test(normalized)) return "needs-new-mechanic";
  }
  for (const [pattern, _label] of NEW_TYPE_PATTERNS) {
    if (pattern.test(normalized)) return "needs-new-type";
  }
  for (const [pattern, capabilityId] of FITS_GRAMMAR_PATTERNS) {
    if (pattern.test(normalized)) {
      // Honest check: regex match alone isn't enough — the underlying engine
      // primitive must actually exist. Otherwise this is a hidden new-mechanic.
      if (CAPABILITIES.has(capabilityId)) return "fits-grammar";
      return "needs-new-mechanic";
    }
  }
  return "unknown";
}

function worstCategory(categories: StubCategory[]): StubCategory {
  if (categories.includes("needs-new-mechanic")) return "needs-new-mechanic";
  if (categories.includes("needs-new-type")) return "needs-new-type";
  if (categories.includes("unknown")) return "unknown";
  return "fits-grammar";
}

// --- Load and categorize cards -----------------------------------------------

function loadSetFile(filename: string): any[] {
  const raw = readFileSync(join(CARDS_DIR, filename), "utf-8");
  return JSON.parse(raw);
}

function isImplemented(card: any): boolean {
  const hasNamedAbility = card.abilities?.some((a: any) =>
    ["triggered", "activated", "static"].includes(a.type)
  );
  const hasActionEffects = card.actionEffects?.length > 0;
  // alternateNames satisfies the only "named ability" of dual-name cards
  // (e.g. Flotsam & Jetsam Entangling Eels — CRD §10.6 reminder text).
  const hasAlternateNames = Array.isArray(card.alternateNames) && card.alternateNames.length > 0;
  const hasPlayRestrictions = Array.isArray(card.playRestrictions) && card.playRestrictions.length > 0;
  return hasNamedAbility || hasActionEffects || hasAlternateNames || hasPlayRestrictions;
}

function hasNamedStubs(card: any): boolean {
  // Filter out stubs whose entire text is just keyword reminder text for a
  // keyword the card already has wired (e.g. Cri-Kee with only "Alert (...)").
  const cardKeywords: string[] = (card.abilities ?? [])
    .filter((a: any) => a.type === "keyword")
    .map((a: any) => String(a.keyword || "").toLowerCase());
  return card._namedAbilityStubs?.some((s: any) => {
    const text = s.rulesText?.trim();
    if (!text) return false;
    // Stub is "just a keyword reminder" if its first word is one of the card's keywords.
    const firstWord = text.split(/[\s(]/)[0]?.toLowerCase() ?? "";
    if (cardKeywords.includes(firstWord)) return false;
    // Pure deckbuild rules (e.g. Dalmatian Puppy "you may have up to 99 copies in your deck")
    // affect deck construction only, not in-play behavior.
    if (/\byou may have up to \d+ copies\b/i.test(text)) return false;
    return true;
  });
}

const SET_FILES = readdirSync(CARDS_DIR)
  .filter((f) => f.startsWith("lorcast-set-") && f.endsWith(".json"))
  .sort();

const allCards: CardEntry[] = [];

for (const filename of SET_FILES) {
  const rawCards = loadSetFile(filename);

  for (const card of rawCards) {
    // Apply set filter
    const setNum = card.setId?.toString();
    if (filterSet && setNum !== filterSet) continue;

    let category: CardCategory;
    const categorizedStubs: CardEntry["stubs"] = [];

    if (isImplemented(card)) {
      category = "implemented";
    } else if (card.cardType === "location") {
      // Unimplemented locations: vanilla locations have no stubs, otherwise stubs use existing categorization
      if (!hasNamedStubs(card)) {
        category = "vanilla";
      } else {
        for (const stub of card._namedAbilityStubs ?? []) {
          if (!stub.rulesText?.trim()) continue;
          const stubCat = categorizeStub(stub.rulesText, card.cardType);
          categorizedStubs.push({
            storyName: stub.storyName ?? "",
            rulesText: stub.rulesText,
            category: stubCat,
          });
        }
        category = worstCategory(categorizedStubs.map((s) => s.category));
      }
    } else if (isImplemented(card)) {
      category = "implemented";
    } else if (!hasNamedStubs(card)) {
      category = "vanilla";
    } else {
      // Categorize each stub individually
      for (const stub of card._namedAbilityStubs ?? []) {
        if (!stub.rulesText?.trim()) continue;
        const stubCat = categorizeStub(stub.rulesText, card.cardType);
        categorizedStubs.push({
          storyName: stub.storyName ?? "",
          rulesText: stub.rulesText,
          category: stubCat,
        });
      }
      category = worstCategory(categorizedStubs.map((s) => s.category));
    }

    allCards.push({
      id: card.id,
      fullName: card.fullName,
      cardType: card.cardType,
      setId: setNum ?? "?",
      category,
      stubs: categorizedStubs,
    });
  }
}

// --- Output ------------------------------------------------------------------

const CATEGORY_ORDER: CardCategory[] = [
  "implemented",
  "vanilla",
  "fits-grammar",
  "needs-new-type",
  "needs-new-mechanic",
  "unknown",
];

const CATEGORY_LABELS: Record<CardCategory, string> = {
  implemented: "done",
  vanilla: "vanilla",
  "fits-grammar": "fits-grammar",
  "needs-new-type": "needs-new-type",
  "needs-new-mechanic": "needs-new-mechanic",
  unknown: "unknown",
};

function count(cards: CardEntry[], cat: CardCategory): number {
  return cards.filter((c) => c.category === cat).length;
}

// Group cards by set for the summary table
const bySet = new Map<string, CardEntry[]>();
for (const card of allCards) {
  const list = bySet.get(card.setId) ?? [];
  list.push(card);
  bySet.set(card.setId, list);
}

// --- Summary table -----------------------------------------------------------

if (!filterCategory) {
  const COL = 7;
  const pad = (s: string | number, w: number) => String(s).padStart(w);
  const padr = (s: string | number, w: number) => String(s).padEnd(w);

  console.log("\n" + padr("SET", 5) + pad("TOTAL", 6) + pad("DONE", 6) +
    pad("VANILLA", 8) + pad("FITS", 6) + pad("NEW-TYPE", 10) +
    pad("NEW-MECH", 10) + pad("UNKNOWN", 9));
  console.log("─".repeat(60));

  const setIds = [...bySet.keys()].sort((a, b) =>
    a.replace(/\D/g, "").padStart(5, "0").localeCompare(b.replace(/\D/g, "").padStart(5, "0"))
  );

  for (const setId of setIds) {
    const cards = bySet.get(setId)!;
    console.log(
      padr("  " + setId, 5) +
        pad(cards.length, 6) +
        pad(count(cards, "implemented"), 6) +
        pad(count(cards, "vanilla"), 8) +
        pad(count(cards, "fits-grammar"), 6) +
        pad(count(cards, "needs-new-type"), 10) +
        pad(count(cards, "needs-new-mechanic"), 10) +
        pad(count(cards, "unknown"), 9)
    );
  }

  console.log("─".repeat(60));
  // Totals
  console.log(
    padr("  ALL", 5) +
      pad(allCards.length, 6) +
      pad(count(allCards, "implemented"), 6) +
      pad(count(allCards, "vanilla"), 8) +
      pad(count(allCards, "fits-grammar"), 6) +
      pad(count(allCards, "needs-new-type"), 10) +
      pad(count(allCards, "needs-new-mechanic"), 10) +
      pad(count(allCards, "unknown"), 9)
  );

  const stubs = allCards.filter((c) =>
    ["fits-grammar", "needs-new-type", "needs-new-mechanic", "unknown"].includes(c.category)
  );
  const pct = stubs.length > 0
    ? Math.round((count(allCards, "implemented") / stubs.length) * 100)
    : 100;
  console.log(`\n  ${count(allCards, "implemented")} implemented / ${stubs.length} stubs remaining (${pct}% of named-ability cards done)\n`);
  console.log("  Run with --category <name> to list cards in a category.");
  console.log("  Categories: implemented | vanilla | fits-grammar | needs-new-type | needs-new-mechanic | unknown\n");
}

// --- Category detail listing -------------------------------------------------

if (filterCategory) {
  const catMap: Record<string, CardCategory> = {
    implemented: "implemented",
    vanilla: "vanilla",
    "fits-grammar": "fits-grammar",
    "needs-new-type": "needs-new-type",
    "needs-new-mechanic": "needs-new-mechanic",
    unknown: "unknown",
  };
  const cat = catMap[filterCategory];
  if (!cat) {
    console.error(`Unknown category "${filterCategory}". Valid: ${Object.keys(catMap).join(", ")}`);
    process.exit(1);
  }

  const matching = allCards.filter((c) => c.category === cat);
  console.log(`\n=== ${cat.toUpperCase()} (${matching.length} cards) ===\n`);

  for (const card of matching) {
    const prefix = `  [set-${card.setId}/${card.cardType}]`;
    console.log(`${prefix} ${card.fullName}`);
    if (verbose && card.stubs.length > 0) {
      for (const stub of card.stubs) {
        const tag = stub.category !== cat ? ` [${stub.category}]` : "";
        console.log(`    → ${stub.rulesText}${tag}`);
      }
    }
  }
  console.log();
}

// --- Auto-show details for high-priority categories when no filter ----------

if (!filterCategory && !filterSet) {
  // Always show new-mechanic and unknown details (these need the most attention)
  for (const cat of ["needs-new-mechanic", "unknown"] as CardCategory[]) {
    const matching = allCards.filter((c) => c.category === cat);
    if (matching.length === 0) continue;
    console.log(`=== ${cat.toUpperCase()} (${matching.length} cards — need design before implementation) ===\n`);
    for (const card of matching.slice(0, 20)) {
      console.log(`  [set-${card.setId}/${card.cardType}] ${card.fullName}`);
      for (const stub of card.stubs.filter((s) => s.category === cat)) {
        console.log(`    → ${stub.rulesText}`);
      }
    }
    if (matching.length > 20) {
      console.log(`  ... and ${matching.length - 20} more. Use --category ${cat} to see all.\n`);
    } else {
      console.log();
    }
  }
}
