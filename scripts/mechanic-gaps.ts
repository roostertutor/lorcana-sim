#!/usr/bin/env node
// One-shot: dump capability_id -> [{set, name, text}] for stubs that fall into
// needs-new-mechanic / needs-new-type. Used to generate docs/MECHANIC_GAPS.md.
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

// Re-import the same pattern arrays via dynamic require would couple us to the
// other script. Easier to literally re-declare a tagged subset here. For the
// gap report we only care about labels (not categorization), so we just walk
// the same patterns from card-status.ts via a CommonJS-style read.

// Cheap approach: import card-status as a side-effect-free module is awkward
// because it auto-runs. Instead, duplicate the pattern arrays here from the
// shared file. Keep this script ad-hoc / regenerated as needed.

const NEW_MECHANIC: [RegExp, string][] = [
  [/\b\d+ lore to win\b/i, "win-threshold"],
  [/\bneed \d+ lore to win\b/i, "win-threshold"],
  // (boost-subzone, card-under-trigger, card-under-static, put-facedown-under-effect,
  //  cards-under-count, cards-under-to-hand removed: boost primitives implemented
  //  (CRD 8.4.2). All six capabilities are now matched as fits-grammar in
  //  card-status.ts. Cards wired in commit 975d3f5.)
  [/\bwould be dealt damage.{0,80}instead\b/i, "replacement-effect"],
  [/\bwould take damage.{0,80}instead\b/i, "replacement-effect"],
  [/\bskip .{0,20}draw step\b/i, "turn-structure"],
  [/\bonly one character can challenge\b/i, "challenge-limiter"],
  [/\bmust choose this character for actions and abilities\b/i, "super-bodyguard"],
  [/\bcan'?t gain lore unless\b/i, "conditional-lore-lock"],
  [/\bfor each opponent who (doesn'?t|does not)\b/i, "for-each-opponent-who-didnt"],
  [/\beach opponent (may )?(choose and )?discards? .{0,40}\.\s*for each opponent\b/i, "for-each-opponent-who-didnt"],
  [/\bchosen .{0,30}gains? "[^"]+"\s*this turn\b/i, "grant-floating-trigger-to-target"],
  [/\bcharacter gains? \u201C[^\u201D]+\u201D this turn\b/i, "grant-floating-trigger-to-target"],
  [/\bwhenever they challenge\b/i, "grant-floating-trigger-to-target"],
  [/\bif no other character has quested this turn\b/i, "no-other-quested-condition"],
  [/\byour other characters can'?t (quest|challenge)\b/i, "group-cant-action-this-turn"],
  [/\bplay a .{0,30}with the same name as\b/i, "play-same-name-as-banished"],
  [/\bmove .{0,20}and one of your other .{0,30}to the same location\b/i, "multi-character-move"],
  [/\bis chosen for support\b/i, "chosen-for-support-trigger"],
  // (pay-extra-cost-mid-effect removed: implemented via SequentialEffect+pay_ink.)
];

const NEW_TYPE: [RegExp, string][] = [
  // (alert-keyword removed: "alert" added to Keyword union + validator treats
  //  Alert attackers as Evasive for challenge purposes. CRD 10.x.)
  // (dynamic-amount removed: DynamicAmount variants implemented in the engine.)
  [/count the number of\b/i, "count-based-effect"],
  // (per-count-cost-reduction removed — self_cost_reduction.amount supports
  //  DynamicAmount `count` + perMatch. Matched as fits-grammar in card-status.ts.)
  [/\beach player.{0,60}inkwell/i, "mass-inkwell"],
  [/\ball (the )?cards? in .{0,30}inkwell/i, "mass-inkwell"],
  [/\buntil (you|they|each player) have \d+ cards? in .{0,20}inkwell/i, "trim-inkwell"],
  [/\benter.{0,10}opponents'.{0,20}inkwell.{0,20}exerted\b/i, "inkwell-static"],
  // (play-from-discard removed: play_for_free supports sourceZone="discard"
  //  since Ursula Deceiver of All (set 3). Wired for Pride Lands Jungle Oasis
  //  and Circle of Life; remaining gap cards (Black Cauldron, Chernabog,
  //  Sinister Socialite, Moana) fall under other mechanic labels below.)
  [/\bink .{0,30}from .{0,20}discard/i, "ink-from-discard"],
  [/\byou may play .{0,40}from under\b/i, "play-from-under"],
  [/opposing .{0,40}enter.{0,10}play exerted/i, "enter-play-exerted-static"],
  // (move-damage removed: move_damage Effect exists; these are fits-grammar.)
  // (reveal-hand removed — reveal_hand Effect implemented.)
  // (timed-cant-be-challenged removed: cant_be_challenged_timed Effect already
  //  existed; cards in sets 6/7/11 wired in this batch.)
  [/while .{0,60}can'?t be challenged\b/i, "conditional-cant-be-challenged"],
  // (damage-immunity removed: implemented via damage_immunity_timed Effect +
  //  damage_immunity_static StaticEffect.)
  [/\bprevent .{0,30}damage\b/i, "damage-prevention"],
  [/\bdamage counters can'?t be removed\b/i, "damage-removal-prevention"],
  [/\bdiscard.{0,20}until .{0,20}have \d+ cards?\b/i, "trim-hand"],
  [/\bdiscards? until they have\b/i, "trim-hand"],
  // (draw-to-n removed — DrawEffect.untilHandSize implemented.)
  [/\bputs? the top \d+ cards? .{0,30}into .{0,20}discard\b/i, "mill"],
  [/\bputs? the top card .{0,30}into .{0,20}discard\b/i, "mill"],
  // (put-on-bottom removed: put_on_bottom_of_deck Effect implemented.)
  [/\beach opponent chooses and banishes\b/i, "opponent-chosen-banish"],
  [/\beach opponent chooses .{0,40}returns?\b/i, "opponent-chosen-return"],
  // (exert-filtered-cost removed: leading `exert` effect with chosen filter
  //  has always worked as a cost — categorizer false positive. Cards wired.)
  [/\buniversal shift\b/i, "shift-variant"],
  [/\b[A-Z][a-z]+ shift \d+\b/i, "shift-variant"],
  [/\bcounts as being named (both|any)\b/i, "shift-variant"],
  [/\bcounts as .{0,30}named .{0,30}for shift\b/i, "shift-variant"],
  [/\bMIMICRY\b/i, "shift-variant"],
  [/\bas if this character had any name\b/i, "shift-variant"],
  [/can'?t .{0,30}(exert to )?sing\b/i, "restrict-sing"],
  [/\bif they don'?t\b/i, "inverse-sequential"],
  [/\bif (he|she|it|they) doesn'?t\b/i, "inverse-sequential"],
  [/discards? .{0,20}(at random|randomly)\b/i, "random-discard"],
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
  [/if you have a character with \d+ \{S\}/i, "stat-threshold-condition"],
  [/can'?t play (actions|items|actions or items)\b/i, "restricted-play-by-type"],
  [/can'?t play this (character|card) unless\b/i, "play-restriction"],
  [/was damaged this turn\b/i, "event-tracking-condition"],
  // reveal-top-conditional landed: RevealTopConditionalEffect extended with
  // noMatchDestination hand/discard + matchExtraEffects (commit ae1bcf6).
  // Categorizer now matches "reveal the top card of your deck" as fits-grammar.
  [/can'?t be challenged by .{0,30}(character|pirate|[A-Z])/i, "filtered-cant-be-challenged"],
  // (both-players-effect removed: draw/discard_from_hand/gain_lore all accept
  //  target { type: "both" }. gain_lore both-branch added this batch.)
  [/\bput a damage counter on\b/i, "put-damage-counter"],
  [/cost equal to or less than .{0,30}\{S\}/i, "dynamic-filter"],
  // (second timed-cant-be-challenged block also removed — see above.)
  // (reveal-top-conditional removed — see note above.)
  [/\bwhile .{0,30}exerted.{0,30}(if you have|you have)\b/i, "compound-condition"],
  [/\bplay it as if it were in your hand\b/i, "play-from-revealed"],
  [/\blose the .{0,30} ability\b/i, "remove-ability"],
  // (cards-under-to-hand removed — see boost block above.)
  [/gets? \+\{S\} equal to\b/i, "dynamic-stat-gain"],
  // (two more timed-cant-be-challenged entries removed — see above.)
  [/was banished in a challenge this turn\b/i, "event-tracking-condition"],
];

interface Hit { setId: string; name: string; text: string; }
const gaps = new Map<string, Hit[]>();

function tag(text: string): string | null {
  const n = text.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u2013\u2014]/g, "-");
  for (const [r, l] of NEW_MECHANIC) if (r.test(n)) return l;
  for (const [r, l] of NEW_TYPE) if (r.test(n)) return l;
  return null;
}

const SET_FILES = readdirSync(CARDS_DIR).filter(f => f.startsWith("lorcast-set-") && f.endsWith(".json")).sort();
for (const f of SET_FILES) {
  const cards = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8"));
  for (const card of cards) {
    const impl = card.abilities?.some((a: any) => ["triggered","activated","static"].includes(a.type)) || card.actionEffects?.length > 0;
    if (impl) continue;
    for (const stub of card._namedAbilityStubs ?? []) {
      const text = stub.rulesText?.trim();
      if (!text) continue;
      const label = tag(text);
      if (!label) continue;
      const arr = gaps.get(label) ?? [];
      arr.push({ setId: card.setId?.toString() ?? "?", name: card.fullName, text });
      gaps.set(label, arr);
    }
  }
}

const sorted = [...gaps.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(JSON.stringify(sorted.map(([l, hits]) => ({
  label: l,
  count: hits.length,
  sets: [...new Set(hits.map(h => h.setId))].sort(),
  examples: hits.slice(0, 3).map(h => ({ set: h.setId, name: h.name, text: h.text })),
  cards: hits.map(h => `[${h.setId}] ${h.name}`),
})), null, 2));
