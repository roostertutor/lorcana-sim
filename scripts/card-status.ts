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
  // Sing Together alternate cost mechanic
  [/sing together/i, "sing-together"],
  // Location interactions (for non-location cards)
  [/\bat a location\b/i, "location-interaction"],
  [/\bwhile here\b/i, "location-interaction"],
  [/\bmove .{0,40}to .{0,30}location/i, "location-interaction"],
  [/\bplay .{0,30}location\b/i, "location-interaction"],
  // Win threshold modification (Donald Duck)
  [/\b\d+ lore to win\b/i, "win-threshold"],
  [/\bneed \d+ lore to win\b/i, "win-threshold"],
  // Boost mechanic — cards placed facedown under characters/locations
  [/\bboost \d+/i, "boost"],
  [/facedown under (this|a|your|them|him|her|one of your)\b/i, "boost"],
  [/\bcard[s]? under (this|a|your|them|him|her|one of your)\b/i, "boost"],
  [/\bif there'?s? (a )?card under\b/i, "boost"],
  [/\bput .{0,30}facedown under\b/i, "boost"],
  [/\bcards? (facedown )?under .{0,30}(character|location)\b/i, "boost"],
  [/\bboost ability\b/i, "boost"],
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
];

const NEW_TYPE_PATTERNS: [RegExp, string][] = [
  // Alert keyword — not in our Keyword type
  [/\balert\b/i, "alert-keyword"],
  // Dynamic damage/lore amounts (equal to a stat, count, or cost)
  [/deal .{0,40}damage equal to\b/i, "dynamic-amount"],
  [/\bgain lore equal to\b/i, "dynamic-amount"],
  [/\blose[s]? lore equal to\b/i, "dynamic-amount"],
  [/equal to (their|this character'?s?|chosen|the number|the cost|her \{|his \{|its \{)\b/i, "dynamic-amount"],
  [/\bgain lore equal to (another|a|chosen|her|his)\b/i, "dynamic-amount"],
  // "Count the number of X, then do Y"
  [/count the number of\b/i, "count-based-effect"],
  // Variable cost reduction based on counts (per damaged/exerted/item count, etc.)
  [/for each (exerted|damaged|[a-z]+ character|item|song) .{0,40}you pay\b/i, "per-count-cost-reduction"],
  [/for each .{0,20}(character|item) you have .{0,20}you pay\b/i, "per-count-cost-reduction"],
  // Per-count self cost reduction (FOR EACH card/character = variable self cost)
  [/\bpay .{0,20}equal to the number\b/i, "per-count-cost-reduction"],
  // Mass inkwell manipulation
  [/\beach player.{0,60}inkwell/i, "mass-inkwell"],
  [/\ball (the )?cards? in .{0,30}inkwell/i, "mass-inkwell"],
  [/\buntil (you|they|each player) have \d+ cards? in .{0,20}inkwell/i, "trim-inkwell"],
  // Inkwell static that affects entering
  [/\benter.{0,10}opponents'.{0,20}inkwell.{0,20}exerted\b/i, "inkwell-static"],
  // Ink from discard / play from non-hand zone (Moana, Black Cauldron)
  [/\bink .{0,30}from .{0,20}discard/i, "alternate-source-zone"],
  [/\byou may play .{0,40}from under\b/i, "alternate-source-zone"],
  [/\bplay .{0,30}from (your|their) discard\b/i, "alternate-source-zone"],
  // "Enters play exerted" for opposing cards (static)
  [/opposing .{0,40}enter.{0,10}play exerted/i, "enter-play-exerted-static"],
  // Move damage counters (CRD 1.9.1.4)
  [/\bmove .{0,20}damage counter/i, "move-damage"],
  [/\bmove .{0,10}damage from\b/i, "move-damage"],
  [/\bmove up to \d+ damage\b/i, "move-damage"],
  // Reveal opponent's hand
  [/\breveal.{0,30}(their|opponent'?s?) hand\b/i, "reveal-hand"],
  [/\blook at each opponent'?s? hand\b/i, "reveal-hand"],
  // "Can't be challenged" as a timed effect (RestrictedAction needs "be_challenged")
  [/can'?t be challenged until\b/i, "timed-cant-be-challenged"],
  [/chosen .{0,40}can'?t be challenged\b/i, "timed-cant-be-challenged"],
  // Conditional "can't be challenged" with filter (Nick Wilde, Kenai, Iago)
  [/while .{0,60}can'?t be challenged\b/i, "conditional-cant-be-challenged"],
  // Damage immunity / damage prevention (non-replacement: "takes no damage from challenges this turn")
  [/\btakes? no damage from challenges\b/i, "damage-immunity"],
  [/\bcan'?t be dealt damage\b/i, "damage-immunity"],
  [/\bprevent .{0,30}damage\b/i, "damage-prevention"],
  // Damage removal prevention (Vision Slab: "damage counters can't be removed")
  [/\bdamage counters can'?t be removed\b/i, "damage-removal-prevention"],
  // "Discard until they have N" / "draw until you have N" — trim hand
  [/\bdiscard.{0,20}until .{0,20}have \d+ cards?\b/i, "trim-hand"],
  [/\bdiscards? until they have\b/i, "trim-hand"],
  [/\bdraw until you have \d+\b/i, "draw-to-n"],
  [/\bdraw cards? until you have\b/i, "draw-to-n"],
  // Mill — top N cards from deck to discard
  [/\bputs? the top \d+ cards? .{0,30}into .{0,20}discard\b/i, "mill"],
  [/\bputs? the top card .{0,30}into .{0,20}discard\b/i, "mill"],
  // Put card on bottom of deck (no shuffle — different from ShuffleIntoDeckEffect)
  [/\bput .{0,40}on the bottom of .{0,20}deck\b/i, "put-on-bottom"],
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
  // "If you used Shift" condition
  [/\bif you used shift\b/i, "shift-condition"],
  // Opposing can't sing / exert to sing
  [/can'?t .{0,30}(exert to )?sing\b/i, "restrict-sing"],
  // "If they don't" — inverse sequential (no matching branch in SequentialEffect)
  [/\bif they don'?t\b/i, "inverse-sequential"],
  [/\bif (he|she|it|they) doesn'?t\b/i, "inverse-sequential"],
  // Random discard
  [/discards? .{0,20}(at random|randomly)\b/i, "random-discard"],
  // Zone-count condition for static ("while you have an item in your discard")
  [/while .{0,10}(you|they) have .{0,40}in (your|their) (play|hand|discard|inkwell)\b/i, "zone-count-condition"],
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
  // "Whenever you play a song" trigger
  [/whenever (you|this character) (play|sing)s? a song\b/i, "song-trigger"],
  // Condition based on character strength threshold ("if you have a character with 5 {S}")
  [/if you have a character with \d+ \{S\}/i, "stat-threshold-condition"],
  // Self stat condition ("while he has 5 {S} or more")
  [/while .{0,20}has? \d+ \{S\} or more\b/i, "self-stat-condition"],
  // "Whenever this character sings" — trigger on sing action
  [/whenever this character sings\b/i, "new-trigger-sings"],
  // "Can't play actions/items" scoped to card type (Pete, Keep the Ancient Ways)
  [/can'?t play (actions|items|actions or items)\b/i, "restricted-play-by-type"],
  // "Can't play this character unless" — play restriction condition
  [/can'?t play this (character|card) unless\b/i, "play-restriction"],
  // "Was damaged this turn" — event-tracking condition
  [/was damaged this turn\b/i, "event-tracking-condition"],
  // Name a card effect (Sorcerer's Hat, Bruno - Undetected Uncle)
  [/\bname a card\b/i, "name-a-card"],
  // "Reveal top card... if it's a [type] card... put into hand. Otherwise, top/bottom"
  [/\breveal the top card.{0,60}(if it'?s?|put).{0,40}(into (your|their) hand|on the (top|bottom))/i, "reveal-top-conditional"],
  // "During your turn, this character has [keyword]" — conditional keyword by turn
  [/during your turn.{0,40}(has|gains?) (evasive|rush|bodyguard|ward|reckless|resist|challenger|support)/i, "conditional-keyword-by-turn"],
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
  // Alice — "put all cards from under her into your hand" (boost related but also a specific effect)
  [/\bput all cards from under\b/i, "cards-under-to-hand"],
  // "gets +{S} equal to the {S} of chosen character" — dynamic stat gain from another card
  [/gets? \+\{S\} equal to\b/i, "dynamic-stat-gain"],
  // "Chosen character of yours can't be challenged until" — timed cant-be-challenged
  [/character of yours can'?t be challenged\b/i, "timed-cant-be-challenged"],
  [/\bchosen character can'?t be challenged\b/i, "timed-cant-be-challenged"],
  // "can't challenge during their next turn" — timed cant_action
  [/can'?t (challenge|quest) during their next turn\b/i, "timed-cant-action"],
  // "was banished in a challenge this turn" — event tracking condition
  [/was banished in a challenge this turn\b/i, "event-tracking-condition"],
];

// Patterns that strongly suggest the card fits existing grammar.
// Each is associated with one or more Effect/Ability types we already have.
const FITS_GRAMMAR_PATTERNS: RegExp[] = [
  // Draw
  /\bdraw (a|\d+) cards?\b/i,
  /\bdraws? a card\b/i,
  // Deal damage (fixed numeric amount)
  /\bdeal \d+ damage\b/i,
  /\bdeals? \d+ damage\b/i,
  /\bput \d+ damage (counter|on)\b/i,
  // Remove damage (fixed, "up to N", or "all")
  /\bremove .{0,15}damage\b/i,
  // Return to hand (all variants: chosen, all, opposing, etc.)
  /\breturn .{0,60}to .{0,25}(their|your|a player'?s?) hand\b/i,
  /\breturn .{0,30}(character|item|card).{0,30}to .{0,20}hand\b/i,
  // Lore — gain/lose fixed amounts
  /\bgain \d+ lore\b/i,
  /\bgains? \d+ lore\b/i,
  /\blose[s]? \d+ lore\b/i,
  // Stat changes with {S}/{W}/{L} symbols or words
  /\bgets? [+-]\d+ \{[SWL]\}/i,
  /\bgives? .{0,30}[+-]\d+ \{[SWL]\}/i,
  /\bgets? [+-]\d+ (strength|willpower|lore)\b/i,
  /\b[+-]\d+\/[+-]?\d+\b/i,
  // Stat changes — "gets +3 this turn" (missing {S}/{W}/{L} in some card text)
  /\bgets? \+\d+ this turn\b/i,
  /\bgets? -\d+ this turn\b/i,
  /\bgets? -\d+ until\b/i,
  // Banish / ready / exert
  /\bbanish\b/i,
  /\bready\b/i,
  /\bexert\b/i,
  // Search
  /\bsearch (your|their|a|chosen) (player'?s? )?deck\b/i,
  // Look at top of deck
  /\blook at the top \d+/i,
  /\blook at the top (card|of)\b/i,
  /\blook at .{0,20}top card\b/i,
  // Discard from hand (all patterns)
  /\bdiscard (a|one|chosen|\d+)/i,
  /\bchoose and discard\b/i,
  /\bchooses? and discards?\b/i,
  /\bdiscard your hand\b/i,
  // Shuffle
  /\bshuffle\b/i,
  // Cost reduction (fixed — handles {I} symbol in rules text)
  /\bpay .{0,10}less\b/i,
  /\bcosts? .{0,10}less\b/i,
  // Grant keywords (existing Keyword type)
  /\b(gains?|have|get|give) .{0,20}(evasive|rush|bodyguard|ward|reckless|resist|challenger|support|singer|shift)\b/i,
  // Can't quest / can't challenge (attacker restriction)
  /\bcan'?t quest\b/i,
  /\bcan'?t challenge\b/i,
  /\bcan'?t ready\b/i,
  // Can't be challenged (permanent static — CantBeChallengedException)
  /\bthis character can'?t be challenged\b/i,
  // Move to inkwell
  /\binto .{0,30}inkwell\b/i,
  // Play for free
  /\bplay .{0,50}for free\b/i,
  /\bwithout paying .{0,20}(ink )?cost\b/i,
  // Create token
  /\bcreate .{0,30}token\b/i,
  // Self enters play exerted (modeled as triggered enters_play + exert self)
  /\benter[s]? play exerted\b/i,
  // Singer keyword reminder text — not a real effect, keyword handles it
  /^\(?A character with cost \d+ or more can/i,
  // Put top card on top or bottom of deck (LookAtTopEffect)
  /\bput it on (either the )?(top|bottom)/i,
  // Self cost reduction with named-character condition
  /if you have a character named .{0,40}(pay|less)\b/i,
  // Triggered at start/end of turn (TriggerEvent exists)
  /\bat the (start|end) of (your|each opponent'?s?) turn\b/i,
  // Stat static while exerted
  /\bgets? \+\d+ \{[SWL]\}/i,
  // "enters play with N damage" — triggered enters_play + deal_damage self
  /\benter[s]? play with \d+ damage\b/i,
  // "discard all cards in their hand" — DiscardEffect amount: "all"
  /\bdiscards? all (the )?cards? in (their|your|a) hand\b/i,
  /\bdiscard all\b/i,
  // "put [card/item] from your discard on the top of your deck" — ShuffleIntoDeckEffect variation
  /\bfrom .{0,20}discard on the top of .{0,20}deck\b/i,
  // "deal damage to each opposing character" — deal_damage all
  /\bdeal \d+ damage to each (opposing|opponent'?s?)\b/i,
  // "Choose one:" — bare ChooseEffect (sub-effects handled separately)
  /^choose one:$/i,
  /\bchoose one:\s*$/i,
  // Conditional upgrade "instead" — ConditionalOnTargetEffect (not replacement)
  /\bif .{0,40}(is chosen|character is chosen|is named).{0,40}instead\b/i,
  /\bgets? \+\d+ \{S\}.{0,40}instead\b/i,
  // "Deck construction" rules — no in-game engine effect (mark as fits-grammar/vanilla)
  /\byou may have up to \d+ copies\b/i,
  // "each opponent chooses one of their characters and returns"
  /\beach opponent chooses one .{0,40}returns?\b/i,
  // "return all opposing characters to their players' hands"
  /\breturn all opposing characters\b/i,
  // "give chosen character Resist/Challenger +N until" — grant_keyword with value
  /\bgive .{0,40}(resist|challenger) \+\d+ until\b/i,
  // "can't quest during their next turn" / "can't challenge during their next turn"
  /\bcan'?t (quest|challenge) during (their|your) next turn\b/i,
  // "chosen opposing character can't quest" — cant_action
  /\bchosen opposing character can'?t (quest|challenge)\b/i,
  // "This character can't challenge" — static action restriction on self
  /\bthis character can'?t (challenge|quest)\b/i,
  // "takes no damage from the challenge" — conditional damage immunity during challenge
  /\btakes? no damage from the challenge\b/i,
  // "This character can't be challenged by [trait] characters" — CantBeChallengedException with attackerFilter
  /\bcan'?t be challenged by .{0,30}characters\b/i,
  // "While being challenged" — existing trigger/static context
  /\bwhile being challenged\b/i,
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
  for (const pattern of FITS_GRAMMAR_PATTERNS) {
    if (pattern.test(normalized)) return "fits-grammar";
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
  return hasNamedAbility || hasActionEffects;
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

    if (card.cardType === "location") {
      // Locations are always new-mechanic regardless of stub content
      category = "needs-new-mechanic";
      for (const stub of card._namedAbilityStubs ?? []) {
        if (stub.rulesText?.trim()) {
          categorizedStubs.push({
            storyName: stub.storyName ?? "",
            rulesText: stub.rulesText,
            category: "needs-new-mechanic",
          });
        }
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
