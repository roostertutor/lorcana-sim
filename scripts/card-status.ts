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
  // Ink from discard (Moana)
  [/\bink .{0,30}from .{0,20}discard/i, "ink-from-zone"],
  // "Enters play exerted" for opposing cards (static)
  [/opposing .{0,40}enter.{0,10}play exerted/i, "enter-play-exerted-static"],
  // Move damage counters (not remove+deal, a distinct effect)
  [/\bmove .{0,20}damage counter/i, "move-damage"],
  // Reveal opponent's hand
  [/\breveal.{0,30}(their|opponent'?s?) hand\b/i, "reveal-hand"],
  // "Can't be challenged" as a timed effect (RestrictedAction needs "be_challenged")
  [/can'?t be challenged until\b/i, "timed-cant-be-challenged"],
  [/chosen .{0,40}can'?t be challenged\b/i, "timed-cant-be-challenged"],
  // Damage immunity / damage prevention
  [/\btakes? no damage\b/i, "damage-immunity"],
  [/\bcan'?t be dealt damage\b/i, "damage-immunity"],
  [/\bprevent .{0,30}damage\b/i, "damage-prevention"],
  // "Discard until they have N" — trim hand
  [/\bdiscard.{0,20}until .{0,20}have \d+ cards?\b/i, "trim-hand"],
  [/\bdiscards? until they have\b/i, "trim-hand"],
  // Put card on bottom of deck (no shuffle — different from ShuffleIntoDeckEffect)
  [/\bput .{0,40}on the bottom of .{0,20}deck\b/i, "put-on-bottom"],
  // Opponent-chosen banish ("each opponent chooses and banishes one of their characters")
  [/\beach opponent chooses and banishes\b/i, "opponent-chosen-banish"],
  // Exert a chosen filtered character or item as a cost
  [/\{E\} .{0,30}(your|one of your) .{0,40}(character|item|[A-Z][a-z]+ character)/i, "exert-filtered-cost"],
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
  // New trigger events: "when this character exerts" / "deals damage in challenge"
  [/whenever this character exerts\b/i, "new-trigger-exerts"],
  [/whenever this character deals damage\b/i, "new-trigger-deals-damage"],
  // "Whenever you play a song" trigger
  [/whenever (you|this character) (play|sing)s? a song\b/i, "song-trigger"],
  // Condition based on character strength threshold ("if you have a character with 5 {S}")
  [/if you have a character with \d+ \{S\}/i, "stat-threshold-condition"],
  // "Whenever this character sings" — trigger on sing action
  [/whenever this character sings\b/i, "new-trigger-sings"],
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
  // Return to hand
  /\breturn .{0,60}to .{0,25}(their|your|a player'?s?) hand\b/i,
  // Lore — gain/lose fixed amounts
  /\bgain \d+ lore\b/i,
  /\bgains? \d+ lore\b/i,
  /\blose[s]? \d+ lore\b/i,
  // Stat changes with {S}/{W}/{L} symbols or words
  /\bgets? [+-]\d+ \{[SWL]\}/i,
  /\bgives? .{0,30}[+-]\d+ \{[SWL]\}/i,
  /\bgets? [+-]\d+ (strength|willpower|lore)\b/i,
  /\b[+-]\d+\/[+-]?\d+\b/i,
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
  // Discard from hand
  /\bdiscard (a|one|chosen|\d+)/i,
  /\bchoose and discard\b/i,
  /\bchooses? and discards?\b/i,
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
];

function categorizeStub(rulesText: string, cardType: string): StubCategory {
  for (const [pattern, _label] of NEW_MECHANIC_PATTERNS) {
    if (pattern.test(rulesText)) return "needs-new-mechanic";
  }
  for (const [pattern, _label] of NEW_TYPE_PATTERNS) {
    if (pattern.test(rulesText)) return "needs-new-type";
  }
  for (const pattern of FITS_GRAMMAR_PATTERNS) {
    if (pattern.test(rulesText)) return "fits-grammar";
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
