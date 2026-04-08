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
  // "For each opponent who doesn't" — per-opponent inverse-sequential branch
  [/\bfor each opponent who (doesn'?t|does not)\b/i, "for-each-opponent-who-didnt"],
  [/\beach opponent (may )?(choose and )?discards? .{0,40}\.\s*for each opponent\b/i, "for-each-opponent-who-didnt"],
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
];

const NEW_TYPE_PATTERNS: [RegExp, string][] = [
  // Alert keyword — not in our Keyword type
  [/\balert\b/i, "alert-keyword"],
  // (dynamic-amount entries moved to FITS_GRAMMAR_PATTERNS — DynamicAmount
  // target_*/source_* variants + max cap implemented in the engine.)
  // "Count the number of X, then do Y"
  [/count the number of\b/i, "count-based-effect"],
  // (per-count-cost-reduction removed: self_cost_reduction.amount accepts
  //  `{ type: "count", filter }` with perMatch multiplier. Matched as
  //  fits-grammar via the "pay .{0,10} less" entry in FITS_GRAMMAR_PATTERNS.)
  [/\bpay .{0,20}equal to the number\b/i, "pay-equal-to-count"],
  // Mass inkwell manipulation
  [/\beach player.{0,60}inkwell/i, "mass-inkwell"],
  [/\ball (the )?cards? in .{0,30}inkwell/i, "mass-inkwell"],
  [/\buntil (you|they|each player) have \d+ cards? in .{0,20}inkwell/i, "trim-inkwell"],
  // Inkwell static that affects entering
  [/\benter.{0,10}opponents'.{0,20}inkwell.{0,20}exerted\b/i, "inkwell-static"],
  // Ink from discard / play from non-hand zone (Moana, Black Cauldron)
  // (play-from-discard removed: play_for_free has `sourceZone` since set 3 — matches
  //  via FITS_GRAMMAR_PATTERNS below. The two remaining patterns are genuinely new.)
  [/\bink .{0,30}from .{0,20}discard/i, "ink-from-discard"],
  [/\byou may play .{0,40}from under\b/i, "play-from-under"],
  // "Enters play exerted" for opposing cards (static)
  [/opposing .{0,40}enter.{0,10}play exerted/i, "enter-play-exerted-static"],
  // (move-damage removed: move_damage Effect already exists — Belle Untrained Mystic,
  //  Belle Accomplished Mystic, Rose Lantern. Regex was over-broad, shunting real
  //  fits-grammar cards into needs-new-type. Fits-grammar patterns below handle it.)
  // (reveal-hand removed: reveal_hand Effect implemented. Matched as
  //  fits-grammar below.)
  // "Can't be challenged" as a timed effect (RestrictedAction needs "be_challenged")
  [/can'?t be challenged until\b/i, "timed-cant-be-challenged"],
  [/chosen .{0,40}can'?t be challenged\b/i, "timed-cant-be-challenged"],
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
  // Mill — top N cards from deck to discard
  [/\bputs? the top \d+ cards? .{0,30}into .{0,20}discard\b/i, "mill"],
  [/\bputs? the top card .{0,30}into .{0,20}discard\b/i, "mill"],
  // (put-on-bottom removed: put_on_bottom_of_deck Effect implemented; matched
  //  by FITS_GRAMMAR_PATTERNS below.)
  // Opponent-chosen banish ("each opponent chooses and banishes one of their characters")
  [/\beach opponent chooses and banishes\b/i, "opponent-chosen-banish"],
  // Opponent-chosen return to hand ("each opponent chooses one of their characters and returns")
  [/\beach opponent chooses .{0,40}returns?\b/i, "opponent-chosen-return"],
  // Exert a chosen filtered character or item as a cost
  [/\{E\} .{0,30}(your|one of your) .{0,40}(character|item|[A-Z][a-z]+ character)/i, "exert-filtered-cost"],
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
  // Random discard
  [/discards? .{0,20}(at random|randomly)\b/i, "random-discard"],
  // "Gains the [Trait] classification" — trait granting
  [/\bgain.{0,10}classification\b/i, "grant-classification"],
  [/\blose.{0,10}(the )?[A-Z][a-z]+ (classification|ability)\b/i, "remove-ability"],
  // Stat floor ("can't be reduced below printed value")
  [/\bprinted (strength|value|cost)\b/i, "stat-floor"],
  // "Can't lose lore" (during opponents' turns)
  [/\bcan'?t lose lore\b/i, "prevent-lore-loss"],
  // "Count as having +N cost" (virtual cost for singer threshold)
  [/count as having .{0,10}cost\b/i, "virtual-cost-modifier"],
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
  [/if you have a character with \d+ \{S\}/i, "stat-threshold-condition"],
  // (self-stat-condition removed: self_stat_gte exists.)
  // (new-trigger-sings removed: sings trigger event implemented in Phase A.1.)
  // "Can't play actions/items" scoped to card type (Pete, Keep the Ancient Ways)
  [/can'?t play (actions|items|actions or items)\b/i, "restricted-play-by-type"],
  // "Can't play this character unless" — play restriction condition
  [/can'?t play this (character|card) unless\b/i, "play-restriction"],
  // "Was damaged this turn" — event-tracking condition
  [/was damaged this turn\b/i, "event-tracking-condition"],
  // (name-a-card removed: name_a_card_then_reveal effect implemented in Phase A.0.)
  // "Reveal top card... if it's a [type] card... put into hand. Otherwise, top/bottom"
  [/\breveal the top card.{0,60}(if it'?s?|put).{0,40}(into (your|their) hand|on the (top|bottom))/i, "reveal-top-conditional"],
  // (conditional-keyword-by-turn removed: grant_keyword static + is_your_turn condition both exist.)
  // "can't be challenged by [filter]" — needs strengthAtLeast/hasTrait on attackerFilter
  [/can'?t be challenged by .{0,30}(character|pirate|[A-Z])/i, "filtered-cant-be-challenged"],
  // "each player draws N" / "each player discards"
  [/\beach player (draws?|discards?) .{0,10}(card|\d+|their hand)\b/i, "both-players-effect"],
  // "put a damage counter on" (1 damage without using "deal")
  [/\bput a damage counter on\b/i, "put-damage-counter"],
  // Dynamic filter based on card's own stat ("cost equal to or less than this character's {S}")
  [/cost equal to or less than .{0,30}\{S\}/i, "dynamic-filter"],
  // "chosen character can't be challenged until" — timed restriction (broader match)
  [/character .{0,30}can'?t be challenged until\b/i, "timed-cant-be-challenged"],
  [/can'?t be challenged until the start\b/i, "timed-cant-be-challenged"],
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
  // "Chosen character of yours can't be challenged until" — timed cant-be-challenged
  [/character of yours can'?t be challenged\b/i, "timed-cant-be-challenged"],
  [/\bchosen character can'?t be challenged\b/i, "timed-cant-be-challenged"],
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
  "discard_from_hand", "conditional_on_target", "play_for_free",
  "shuffle_into_deck", "move_to_inkwell", "grant_extra_ink_play",
  "put_on_bottom_of_deck", "pay_ink",
  "sequential", "create_floating_trigger_on_self",
  "dynamic-amount",
  "reveal_hand", "draw_until_hand_size", "per_count_self_cost_reduction",
  // Static effects
  "stat_static", "cant_be_challenged_static", "cost_reduction_static",
  "action_restriction_static", "grant_activated_ability_static",
  "damage_immunity",
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
  [/\b(gains?|have|get|give) .{0,20}(evasive|rush|bodyguard|ward|reckless|resist|challenger|support|singer|shift)\b/i, "grant_keyword"],
  [/\bcan'?t quest\b/i, "cant_action"],
  [/\bcan'?t challenge\b/i, "cant_action"],
  [/\bcan'?t ready\b/i, "cant_action"],
  [/\bthis character can'?t be challenged\b/i, "cant_be_challenged_static"],
  [/\binto .{0,30}inkwell\b/i, "move_to_inkwell"],
  [/\bplay .{0,50}for free\b/i, "play_for_free"],
  [/\bwithout paying .{0,20}(ink )?cost\b/i, "play_for_free"],
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
  return hasNamedAbility || hasActionEffects || hasAlternateNames;
}

function hasNamedStubs(card: any): boolean {
  return card._namedAbilityStubs?.some((s: any) => s.rulesText?.trim().length > 0);
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
