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
  // (grant-floating-trigger-to-target removed: FloatingTrigger gained
  //  attachedToInstanceId; CreateFloatingTriggerEffect.attachTo "chosen"
  //  surfaces a choose_target. Bruno Madrigal + Medallion Weights wired.)
  [/\bif no other character has quested this turn\b/i, "no-other-quested-condition"],
  [/\byour other characters can'?t (quest|challenge)\b/i, "group-cant-action-this-turn"],
  [/\bplay a .{0,30}with the same name as\b/i, "play-same-name-as-banished"],
  [/\bmove .{0,20}and one of your other .{0,30}to the same location\b/i, "multi-character-move"],
  [/\bis chosen for support\b/i, "chosen-for-support-trigger"],
  // (pay-extra-cost-mid-effect removed: implemented via SequentialEffect+pay_ink.)
  // ── Compound false positives (categorizer tightening pass) ──
  [/\bvanish\b.{0,20}\(/i, "vanish-keyword"],
  [/\bwhen an opponent chooses this character for an action, banish\b/i, "vanish-keyword"],
  [/\byou don'?t discard\b/i, "discard-replacement"],
  [/\bif this is your first turn\b/i, "underdog-condition"],
  [/\bif you'?re not the first player\b/i, "underdog-condition"],
  [/\btwice during your turn, whenever\b/i, "twice-per-turn-trigger"],
  [/\bput all .{0,40}cards? from your discard into your inkwell\b/i, "bulk-discard-to-inkwell"],
  [/\bwhenever one or more of your characters sings?\b/i, "batched-sings-trigger"],
  [/\bnone of your characters challenged this turn\b/i, "no-challenges-this-turn-condition"],
  [/\bif you'?ve played a song this turn\b/i, "song-played-this-turn-condition"],
  [/\bif you didn'?t put any cards into your inkwell this turn\b/i, "no-ink-put-this-turn-condition"],
  [/\bif you'?ve put a card under\b/i, "card-under-event-condition"],
  [/\bunless you put a card under\b/i, "card-under-event-condition"],
  [/\bfor the rest of this turn, whenever\b/i, "player-floating-trigger"],
  [/\bif you have a card named .{0,40}in your discard\b/i, "discard-name-condition"],
  [/\b(an? )?opponent has more cards in their hand than you\b/i, "hand-count-compare-condition"],
  [/\bplay a .{0,40}from there for free\b/i, "play-from-inkwell"],
  [/\bplay .{0,30}character from .{0,20}inkwell\b/i, "play-from-inkwell"],
  [/\bput this character facedown under\b/i, "put-self-under-effect"],
  [/\bcards? from under .{0,40}into your inkwell\b/i, "cards-under-to-inkwell"],
  [/\bplay an? .{0,30}from your discard for free,? then put\b/i, "play-from-discard-then-bottom"],
  [/\bcost up to \d+ more than the banished\b/i, "dynamic-cost-from-banished"],
  [/\breveal cards? from the top of your deck until you reveal\b/i, "reveal-until-effect"],
  [/\bchoose \d+ cards? from chosen opponent'?s discard\b/i, "choose-from-opponent-discard"],
  [/\breturn all character cards with that name from your discard\b/i, "name-then-bulk-return-from-discard"],
  [/\bwhenever .{0,60}is returned to their hand from play\b/i, "trigger-opponent-returned-to-hand"],
  [/\bwhenever you play a (second|third|fourth) (action|character|item|song)\b/i, "nth-card-played-trigger"],
  [/\bwhenever a character is challenged while here\b/i, "location-challenged-trigger"],
  [/\bwhenever an opposing character is exerted\b/i, "opponent-exerts-trigger"],
  [/\bwhenever an opposing character is damaged\b/i, "opponent-damaged-trigger"],
  [/\bwhen this character is banished, choose one\b/i, "banished-modal-choose"],
  [/\bwhenever an opponent chooses this character for an action\b/i, "chosen-by-opponent-trigger"],
  [/\bdraw cards? equal to the damage on\b/i, "dynamic-draw-from-target-damage"],
  [/\bif it'?s the (second|third|fourth|fifth) card you'?ve put into your inkwell\b/i, "inkwell-count-trigger"],
  [/\bfor each opposing character banished in a challenge this turn, you pay\b/i, "event-tracking-cost-reduction"],
  [/\bwhile one of your .{0,40}is at a location, that character\b/i, "other-at-location-static"],
  [/\bif this card is in your discard, you may play\b/i, "self-play-from-discard"],
  [/\bwhenever a character is banished here\b/i, "location-banished-here-trigger"],
  [/\bwhenever a character is banished in a challenge while here\b/i, "location-banished-here-trigger"],
  [/\bwhen you move a character here from another location\b/i, "location-moves-here-trigger"],
  [/\byou gain lore equal to the lore lost\b/i, "lore-transfer"],
  [/\byour .{0,30}characters gain ["\u201C]\{E\}/i, "grant-activated-to-own-timed"],
  [/\byour other characters gain ["\u201C]\{E\}/i, "grant-activated-to-own-timed"],
  [/\{E\} one of your characters to deal damage equal to (their|its|his|her)\b/i, "exert-one-dynamic-damage"],
  [/\bplay characters using their shift ability\b/i, "shift-scoped-cost-reduction"],
  [/\beach player may reveal a .{0,30}from their hand and play\b/i, "symmetric-reveal-play"],
  [/\bbanish chosen item of yours to play this character for free\b/i, "alt-play-cost-banish-item"],
  [/\bput one into your ink supply.{0,40}(and )?(the )?other\b/i, "look-top-split"],
  [/\bremove up to \d+ damage from each of your other characters\. ready each character\b/i, "compound-remove-then-ready"],
  [/\bwhenever one of your characters sings a song\b/i, "other-sings-trigger"],
  [/\breveal a .{0,30}card in your hand to\b/i, "reveal-from-hand-as-cost"],
  [/\bbanish (her|him|it|them|this character) or return another chosen character\b/i, "self-banish-or-return-modal"],
  [/\bgive that character .{0,60}["\u201C][^"\u201D]+["\u201D]\s*this turn\b/i, "grant-floating-trigger-to-target"],
  [/\bif a[n]? .{0,30}is discarded this way, you may play\b/i, "play-from-discard-result"],
  [/\bfor each character that sang this song\b/i, "per-singer-dynamic"],
  [/\bif you used shift to play (them|her|him)\b/i, "shift-condition-on-trigger-source"],
  [/\bwhenever you play a character .{0,40}you may exert them\b/i, "exert-triggering-card"],
  [/\bchoose and discard any number of .{0,20}cards? to\b/i, "discard-any-number-dynamic"],
  [/\bthey draw until they have \d+\b/i, "fill-hand"],
  [/\bfor each \d+ damage removed this way, you pay\b/i, "dynamic-cost-reduction-from-effect"],
  [/\bunless that character'?s player puts\b/i, "inverse-unless-opponent-choice"],
  [/\bwhen this character is challenged and banished\b/i, "challenged-and-banished-trigger"],
  [/\bif you have \d+ or more cards in your hand, this character can'?t ready\b/i, "conditional-cant-ready-static"],
  [/\bready this character\..{0,30}can'?t quest or challenge for the rest of this turn\b/i, "ready-then-cant-act-compound"],
  [/\bready a character here\..{0,40}can'?t quest\b/i, "ready-then-cant-act-compound"],
  [/\bif you have a character in play with damage\b/i, "has-damaged-character-condition"],
  [/\bif you played another character this turn\b/i, "played-another-this-turn-condition"],
  [/\byou may pay \d+ \{I\} to choose one\b/i, "pay-then-modal"],
  [/\bdraw (a |\d+ )cards? for each .{0,40}you have in play\b/i, "dynamic-draw-from-count"],
  [/\bwhile this character is being challenged\b/i, "being-challenged-static"],
  [/\breveal up to \d+ .{0,40}and up to \d+ .{0,30}cards?\b/i, "multi-filter-look-reveal"],
  [/\bwhen you play a .{0,20}character on this card\b/i, "shift-onto-self-trigger"],
  [/\bdiscard any number of cards,? then draw that many\b/i, "discard-any-number-dynamic"],
];

const NEW_TYPE: [RegExp, string][] = [
  // (alert-keyword removed: "alert" added to Keyword union + validator treats
  //  Alert attackers as Evasive for challenge purposes. CRD 10.x.)
  // (dynamic-amount removed: DynamicAmount variants implemented in the engine.)
  // (count-based-effect removed: gain_stats strengthDynamic + Negate.)
  // (per-count-cost-reduction removed — self_cost_reduction.amount supports
  //  DynamicAmount `count` + perMatch. Matched as fits-grammar in card-status.ts.)
  // (mass-inkwell removed: MassInkwellEffect implemented with modes
  //  exert_all / ready_all / return_random_to_hand / return_random_until.
  //  Mufasa Ruler of Pride Rock + Ink Geyser wired.)
  [/\buntil (you|they|each player) have \d+ cards? in .{0,20}inkwell/i, "trim-inkwell"],
  [/\benter.{0,10}opponents'.{0,20}inkwell.{0,20}exerted\b/i, "inkwell-static"],
  // (play-from-discard removed: play_for_free supports sourceZone="discard"
  //  since Ursula Deceiver of All (set 3). Wired for Pride Lands Jungle Oasis
  //  and Circle of Life; remaining gap cards (Black Cauldron, Chernabog,
  //  Sinister Socialite, Moana) fall under other mechanic labels below.)
  [/\bink .{0,30}from .{0,20}discard/i, "ink-from-discard"],
  // (play-from-under removed: play_for_free supports sourceZone="under" with
  //  cost: "normal" + sourceInstanceId: "self". The Black Cauldron wired.)
  // (enter-play-exerted-static removed: EnterPlayExertedStatic implemented.)
  // (move-damage removed: move_damage Effect exists; these are fits-grammar.)
  // (reveal-hand removed — reveal_hand Effect implemented.)
  // (timed-cant-be-challenged removed: cant_be_challenged_timed Effect already
  //  existed; cards in sets 6/7/11 wired in this batch.)
  // (conditional-cant-be-challenged removed: cant_be_challenged static already
  //  honors StaticAbility.condition + matchesFilter now checks excludeSelf.
  //  Kenai, Nick Wilde, Galactic Council Chamber, Iago Out of Reach wired.)
  // (damage-immunity removed: implemented via damage_immunity_timed Effect +
  //  damage_immunity_static StaticEffect.)
  [/\bprevent .{0,30}damage\b/i, "damage-prevention"],
  [/\bdamage counters can'?t be removed\b/i, "damage-removal-prevention"],
  [/\bdiscard.{0,20}until .{0,20}have \d+ cards?\b/i, "trim-hand"],
  [/\bdiscards? until they have\b/i, "trim-hand"],
  // (draw-to-n removed — DrawEffect.untilHandSize implemented.)
  // (mill removed: MillEffect implemented; cards wired this batch.)
  // (put-on-bottom removed: put_on_bottom_of_deck Effect implemented.)
  // (opponent-chosen-banish removed: chooser:"target_player" already supported.
  //  Be King Undisputed (set 4 + 9) wired with chooser target_player.)
  [/\beach opponent chooses .{0,40}returns?\b/i, "opponent-chosen-return"],
  // (exert-filtered-cost removed: leading `exert` effect with chosen filter
  //  has always worked as a cost — categorizer false positive. Cards wired.)
  [/\buniversal shift\b/i, "shift-variant"],
  [/\b[A-Z][a-z]+ shift \d+\b/i, "shift-variant"],
  [/\bcounts as being named (both|any)\b/i, "shift-variant"],
  [/\bcounts as .{0,30}named .{0,30}for shift\b/i, "shift-variant"],
  [/\bMIMICRY\b/i, "shift-variant"],
  [/\bas if this character had any name\b/i, "shift-variant"],
  // (restrict-sing removed: cant_action_self / action_restriction static already
  //  support action: "sing" — sing validator already consults isActionRestricted.
  //  Ulf Mime, Pete Space Pirate, Gantu Experienced Enforcer wired.)
  [/\bif they don'?t\b/i, "inverse-sequential"],
  [/\bif (he|she|it|they) doesn'?t\b/i, "inverse-sequential"],
  // (random-discard removed: discard_from_hand chooser:"random" supported;
  //  cards wired this batch.)
  [/\bgain.{0,10}classification\b/i, "grant-classification"],
  [/\blose.{0,10}(the )?[A-Z][a-z]+ (classification|ability)\b/i, "remove-ability"],
  // (stat-floor removed: stat_floor_printed StaticEffect implemented — Elisa Maza.)
  [/\bcan'?t lose lore\b/i, "prevent-lore-loss"],
  [/count as having .{0,10}cost\b/i, "virtual-cost-modifier"],
  [/\bplay .{0,40}again from your discard\b/i, "replay-from-discard"],
  [/\bcount as having \{I/i, "virtual-ink-color"],
  [/whenever this character exerts\b/i, "new-trigger-exerts"],
  [/whenever this character deals damage\b/i, "new-trigger-deals-damage"],
  [/whenever this character is dealt damage\b/i, "new-trigger-is-dealt-damage"],
  [/if you have a character with \d+ \{S\}/i, "stat-threshold-condition"],
  [/can'?t play (actions|items|actions or items)\b/i, "restricted-play-by-type"],
  // (play-restriction removed: CardDefinition.playRestrictions implemented.)
  // (event-tracking-condition (damaged) removed: your_character_was_damaged_this_turn
  //  + opposing_character_was_damaged_this_turn Conditions implemented; per-player
  //  flags reset at PASS_TURN. Devil's Eye Diamond, Brutus, Nathaniel Flint wired.)
  // reveal-top-conditional landed: RevealTopConditionalEffect extended with
  // noMatchDestination hand/discard + matchExtraEffects (commit ae1bcf6).
  // Categorizer now matches "reveal the top card of your deck" as fits-grammar.
  // (filtered-cant-be-challenged removed: attackerFilter on cant_be_challenged
  //  static; cards wired this batch.)
  // (both-players-effect removed: draw/discard_from_hand/gain_lore all accept
  //  target { type: "both" }. gain_lore both-branch added this batch.)
  // (put-damage-counter removed: deal_damage asDamageCounter flag added.)
  [/cost equal to or less than .{0,30}\{S\}/i, "dynamic-filter"],
  // (second timed-cant-be-challenged block also removed — see above.)
  // (reveal-top-conditional removed — see note above.)
  [/\bwhile .{0,30}exerted.{0,30}(if you have|you have)\b/i, "compound-condition"],
  [/\bplay it as if it were in your hand\b/i, "play-from-revealed"],
  [/\blose the .{0,30} ability\b/i, "remove-ability"],
  // (cards-under-to-hand removed — see boost block above.)
  [/gets? \+\{S\} equal to\b/i, "dynamic-stat-gain"],
  // (two more timed-cant-be-challenged entries removed — see above.)
  // (event-tracking-condition (banished_in_challenge) removed: existing
  //  opponent_character_was_banished_in_challenge_this_turn +
  //  a_character_was_banished_in_challenge_this_turn Conditions implemented.
  //  Chief - Seasoned Tracker, The Thunderquack wired.)
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
    const impl = card.abilities?.some((a: any) => ["triggered","activated","static"].includes(a.type)) || card.actionEffects?.length > 0 || card.playRestrictions?.length > 0;
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
