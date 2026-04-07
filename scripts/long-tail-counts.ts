#!/usr/bin/env node
// Count needs-new-type cards by their categorizer label across all sets.
// Output: ordered list of features by cards-unblocked count.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARDS_DIR = "packages/engine/src/cards";

// Mirror of NEW_TYPE_PATTERNS from card-status.ts (kept loose — only the ones we actually trip)
const NEW_TYPE_PATTERNS: [RegExp, string][] = [
  [/\buniversal shift\b/i, "shift-variant"],
  [/\b[A-Z][a-z]+ shift \d+\b/i, "shift-variant"],
  [/\bcounts as being named (both|any)\b/i, "shift-variant"],
  [/\bcounts as .{0,30}named .{0,30}for shift\b/i, "shift-variant"],
  [/\bMIMICRY\b/i, "shift-variant"],
  [/\bas if this character had any name\b/i, "shift-variant"],
  [/\bif you used shift\b/i, "shift-condition"],
  [/can'?t .{0,30}(exert to )?sing\b/i, "restrict-sing"],
  [/\bif they don'?t\b/i, "inverse-sequential"],
  [/\bif (he|she|it|they) doesn'?t\b/i, "inverse-sequential"],
  [/discards? .{0,20}(at random|randomly)\b/i, "random-discard"],
  [/while .{0,10}(you|they) have .{0,40}in (your|their) (play|hand|discard|inkwell)\b/i, "zone-count-condition"],
  [/\bgain.{0,10}classification\b/i, "grant-classification"],
  [/\blose.{0,10}(the )?[A-Z][a-z]+ (classification|ability)\b/i, "remove-ability"],
  [/\bprinted (strength|value|cost)\b/i, "stat-floor"],
  [/\bcan'?t lose lore\b/i, "prevent-lore-loss"],
  [/count as having .{0,10}cost\b/i, "virtual-cost-modifier"],
  [/\bplay .{0,40}again from your discard\b/i, "replay-from-discard"],
  [/\bcount as having \{I/i, "virtual-ink-color"],
  [/whenever this character exerts\b/i, "new-trigger-exerts"],
  [/whenever this character deals damage\b/i, "new-trigger-deals-damage"],
  [/whenever this character is dealt damage\b/i, "new-trigger-is-dealt-damage"],
  [/whenever (you|this character) (play|sing)s? a song\b/i, "song-trigger"],
  [/if you have a character with \d+ \{S\}/i, "stat-threshold-condition"],
  [/while .{0,20}has? \d+ \{S\} or more\b/i, "self-stat-condition"],
  [/whenever this character sings\b/i, "new-trigger-sings"],
  [/can'?t play (actions|items|actions or items)\b/i, "restricted-play-by-type"],
  [/can'?t play this (character|card) unless\b/i, "play-restriction"],
  [/was damaged this turn\b/i, "event-tracking-condition"],
  [/\bname a card\b/i, "name-a-card"],
  [/\breveal the top card.{0,60}(if it'?s?|put).{0,40}(into (your|their) hand|on the (top|bottom))/i, "reveal-top-conditional"],
  [/during your turn.{0,40}(has|gains?) (evasive|rush|bodyguard|ward|reckless|resist|challenger|support)/i, "conditional-keyword-by-turn"],
  [/can'?t be challenged by .{0,30}(character|pirate|[A-Z])/i, "filtered-cant-be-challenged"],
  [/\beach player (draws?|discards?) .{0,10}(card|\d+|their hand)\b/i, "both-players-effect"],
  [/\bput a damage counter on\b/i, "put-damage-counter"],
  [/cost equal to or less than .{0,30}\{S\}/i, "dynamic-filter"],
  [/character .{0,30}can'?t be challenged until\b/i, "timed-cant-be-challenged"],
  [/can'?t be challenged until the start\b/i, "timed-cant-be-challenged"],
  [/\breveal the top card of your deck\b/i, "reveal-top-conditional"],
  [/\bwhile .{0,30}exerted.{0,30}(if you have|you have)\b/i, "compound-condition"],
  [/\bplay it as if it were in your hand\b/i, "play-from-revealed"],
  [/\blose the .{0,30} ability\b/i, "remove-ability"],
  [/\bput all cards from under\b/i, "cards-under-to-hand"],
  [/gets? \+\{S\} equal to\b/i, "dynamic-stat-gain"],
  [/character of yours can'?t be challenged\b/i, "timed-cant-be-challenged"],
  [/\bchosen character can'?t be challenged\b/i, "timed-cant-be-challenged"],
  [/can'?t (challenge|quest) during their next turn\b/i, "timed-cant-action"],
  [/was banished in a challenge this turn\b/i, "event-tracking-condition"],
];

const counts = new Map<string, { cards: Set<string>; sets: Set<string> }>();

const files = readdirSync(CARDS_DIR).filter(f => f.startsWith("lorcast-set-") && f.endsWith(".json"));
for (const file of files) {
  const setId = file.replace(/^lorcast-set-/, "").replace(/\.json$/, "");
  const cards = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf-8"));
  for (const card of cards) {
    if (card.abilities?.length || card.actionEffects?.length) continue;
    if (!card._namedAbilityStubs?.length) continue;
    const matchedLabels = new Set<string>();
    for (const stub of card._namedAbilityStubs) {
      const text = (stub.rulesText ?? "").replace(/[\u2018\u2019\u2032]/g, "'");
      for (const [pattern, label] of NEW_TYPE_PATTERNS) {
        if (pattern.test(text)) matchedLabels.add(label);
      }
    }
    for (const label of matchedLabels) {
      let entry = counts.get(label);
      if (!entry) {
        entry = { cards: new Set(), sets: new Set() };
        counts.set(label, entry);
      }
      entry.cards.add(card.id);
      entry.sets.add(setId);
    }
  }
}

const sorted = [...counts.entries()].sort((a, b) => b[1].cards.size - a[1].cards.size);
console.log("Long-tail needs-new-type features by cards-unblocked count:\n");
console.log("count  | sets               | label");
console.log("-------+---------------------+----------------------------------");
for (const [label, { cards, sets }] of sorted) {
  const setsStr = [...sets].sort().join(",");
  console.log(`${String(cards.size).padStart(5)} | ${setsStr.padEnd(19)} | ${label}`);
}
