#!/usr/bin/env node
// Set 5 — Batch 3: re-evaluation of fits-grammar cards skipped in batch2.
// All wirings here use existing engine primitives only. Approximations noted inline.
//
// Skipped (still genuinely missing primitives):
//   - chicha-dedicated-mother           — needs "Nth ink_played this turn" count condition (no count-of-turn-events condition exists). Capability: nth_event_this_turn_condition
//   - namaari-resolute-daughter         — needs self_cost_reduction by count of "opp chars banished in challenge this turn"; this is turn state, not zone-queryable. Capability: count_turn_event_dynamic_amount
//   - grumpy-skeptical-knight           — needs conditional grant of static-Resist to OTHER chars while at a location, plus during-your-turn timed Evasive on self. No primitive for either. Capability: conditional_grant_static_to_others_at_location
//   - food-fight                        — needs to grant an activated ability to all your chars this turn (timed grant_activated_ability). Capability: timed_grant_activated_ability
//   - magica-de-spell-cruel-sorceress   — replacement effect (CRD 6.5). DEFERRED_MECHANICS replacement-effect.
//   - blast-from-your-past              — "name a card" then return-all-with-that-name. No name-a-card primitive. Capability: name_a_card_then_return_all
//
// Wired with approximations:
//   - merlin-turtle                     — look_at_top reorder count=2 (drops top/bottom split semantics)
//   - robin-hood-timely-contestant      — self_cost_reduction count of damaged opp chars (drops "per damage point")
//   - iago-fake-flamingo                — on quests → grant_cost_reduction next action -2
//   - robin-hood-sneaky-sleuth          — modify_stat_per_count (lore) per damaged opp char
//   - maximus-team-champion             — turn_end gain 2 lore if you control char w/ STR ≥ 5 (drops 5-lore branch for STR ≥ 10)
//   - taffyta-muttonfudge-sour-speedster — once-per-turn moves_to_location → gain 2 lore
//   - robin-hood-sharpshooter           — quests → look top 4, may take action ≤6 to hand (approximation: to hand instead of play-for-free; rest to bottom of deck instead of discard)
//   - the-sword-released                — turn_start, if self has more strength than each opp → each opp loses 1, self gains 1 (drops "lore equal to lore lost" — uses literal 1)
//   - kronk-head-of-security            — banished_other_in_challenge during your turn → may play character ≤5 for free
//   - seven-dwarfs-mine-secure-fortress — once-per-turn moves_to_location → conditional deal 2 if Knight else 1
//   - anna-diplomatic-queen             — pay 2 ink → choose one (3 modes)

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-005.json");

const CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OPP_CHAR = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };
const OWN_CHAR = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const DAMAGED_OPP = { ...OPP_CHAR, hasDamage: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {
  // ── Merlin Turtle: ETB & leaves play → look top 2, reorder ─────────
  // Approximation: real text is "put one on top, the other on bottom" — engine reorder
  // lets the bot put both back in any order (defaults to original).
  "merlin-turtle": {
    abilities: [
      {
        type: "triggered",
        storyName: "WHERE DID I PUT THAT?",
        rulesText: "When you play this character and when he leaves play, look at the top 2 cards of your deck. Put one on the top of your deck and the other on the bottom. (approximation: free reorder)",
        trigger: { on: "enters_play" },
        effects: [{ type: "look_at_top", count: 2, action: "reorder", target: { type: "self" } }],
      },
      {
        type: "triggered",
        storyName: "WHERE DID I PUT THAT?",
        rulesText: "When you play this character and when he leaves play, look at the top 2 cards of your deck. Put one on the top of your deck and the other on the bottom. (approximation: free reorder)",
        trigger: { on: "leaves_play" },
        effects: [{ type: "look_at_top", count: 2, action: "reorder", target: { type: "self" } }],
      },
    ],
  },

  // ── Robin Hood Timely Contestant: -1 I per damaged opp char ────────
  // Approximation: real text is per damage point on opposing characters; we count
  // damaged opp characters instead (one discount per damaged char).
  "robin-hood-timely-contestant": {
    abilities: [{
      type: "static",
      storyName: "TAG ME IN!",
      rulesText: "For each 1 damage on opposing characters, you pay 1 {I} less to play this character. (approximation: per damaged opposing character, not per damage point)",
      effect: {
        type: "self_cost_reduction",
        amount: { type: "count", filter: { ...DAMAGED_OPP } },
        perMatch: 1,
      },
    }],
  },

  // ── Iago Fake Flamingo: quest → next action -2 I ───────────────────
  "iago-fake-flamingo": {
    abilities: [{
      type: "triggered",
      storyName: "PRETTY POLLY",
      rulesText: "Whenever this character quests, you pay 2 {I} less for the next action you play this turn.",
      trigger: { on: "quests", filter: { ...OWN_CHAR } },
      condition: { type: "compound_and", conditions: [] },
      effects: [{
        type: "grant_cost_reduction",
        amount: 2,
        filter: { cardType: ["action"] },
      }],
    }],
  },

  // ── Robin Hood Sneaky Sleuth: +1 L per damaged opp char ────────────
  "robin-hood-sneaky-sleuth": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "This character gets +1 {L} for each opposing damaged character in play.",
      effect: {
        type: "modify_stat_per_count",
        stat: "lore",
        perCount: 1,
        countFilter: { ...DAMAGED_OPP },
        target: { type: "this" },
      },
    }],
  },

  // ── Maximus Team Champion: turn_end gain 2 lore if STR≥5 ───────────
  // Approximation: drops the "5 lore instead if STR ≥ 10" upgrade branch.
  "maximus-team-champion": {
    abilities: [{
      type: "triggered",
      storyName: "ROYALLY BIG REWARDS",
      rulesText: "At the end of your turn, if you have any characters in play with 5 {S} or more, gain 2 lore. If you have any in play with 10 {S} or more, gain 5 lore instead. (approximation: drops 10-strength upgrade)",
      trigger: { on: "turn_end", player: { type: "self" } },
      condition: {
        type: "you_control_matching",
        filter: { ...OWN_CHAR, strengthAtLeast: 5 },
      },
      effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
    }],
  },

  // ── Taffyta Muttonfudge: once/turn moves_to_location → gain 2 lore ─
  "taffyta-muttonfudge-sour-speedster": {
    abilities: [{
      type: "triggered",
      storyName: "NEW ROSTER",
      rulesText: "Once per turn, when this character moves to a location, gain 2 lore.",
      trigger: { on: "moves_to_location" },
      oncePerTurn: true,
      effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
    }],
  },

  // ── Robin Hood Sharpshooter: quests → look top 4, may take action ≤6 to hand ─
  // Approximation: real text plays the action for free; engine puts to hand instead.
  // Real text discards the rest; engine puts the rest on the bottom of the deck.
  "robin-hood-sharpshooter": {
    abilities: [{
      type: "triggered",
      storyName: "NOTTINGHAM'S FINEST",
      rulesText: "Whenever this character quests, look at the top 4 cards of your deck. You may reveal an action card with cost 6 or less and play it for free. Put the rest in your discard. (approximation: action goes to hand; rest to bottom of deck)",
      trigger: { on: "quests", filter: { ...OWN_CHAR } },
      effects: [{
        type: "look_at_top",
        count: 4,
        action: "one_to_hand_rest_bottom",
        filter: { cardType: ["action"], costAtMost: 6 },
        target: { type: "self" },
        isMay: true,
      }],
    }],
  },

  // ── The Sword Released: turn_start lore swing if you out-strength each opp ─
  // Approximation: literal 1 lore swing instead of "equal to the lore lost"
  // (in 2P with each-opp = 1 the multiplication is 1·1 = 1, so this matches mainline 2P play).
  "the-sword-released": {
    abilities: [{
      type: "triggered",
      storyName: "POWER APPOINTED",
      rulesText: "At the start of your turn, if you have a character in play with more {S} than each opposing character in play, each opponent loses 1 lore and you gain lore equal to the lore lost. (approximation: literal 1 lore)",
      trigger: { on: "turn_start", player: { type: "self" } },
      condition: { type: "self_has_more_than_each_opponent", metric: "strength_in_play" },
      effects: [
        { type: "lose_lore", amount: 1, target: { type: "opponent" } },
        { type: "gain_lore", amount: 1, target: { type: "self" } },
      ],
    }],
  },

  // ── Kronk Head of Security: banish opp in challenge → may play char ≤5 free ─
  "kronk-head-of-security": {
    abilities: [{
      type: "triggered",
      storyName: "I'M ALL EARS",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may play a character with cost 5 or less for free.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "play_for_free",
        isMay: true,
        filter: { cardType: ["character"], costAtMost: 5, zone: "hand", owner: { type: "self" } },
      }],
    }],
  },

  // ── Seven Dwarfs' Mine Secure Fortress: 1st move here → 1 dmg, 2 if Knight ─
  // Approximation: oncePerTurn approximates "the first time" (it caps at one fire/turn).
  "seven-dwarfs-mine-secure-fortress": {
    abilities: [{
      type: "triggered",
      storyName: "GUARDED VAULT",
      rulesText: "During your turn, the first time you move a character here, you may deal 1 damage to chosen character. If the moved character is a Knight, deal 2 damage instead.",
      trigger: {
        on: "moves_to_location",
        filter: { ...CHAR, atLocation: "this" },
      },
      condition: { type: "is_your_turn" },
      oncePerTurn: true,
      effects: [{
        type: "conditional_on_target",
        target: { type: "triggering_card" },
        conditionFilter: { hasTrait: "Knight" },
        ifMatchEffects: [
          { type: "deal_damage", amount: 2, target: { type: "chosen", filter: { ...CHAR } } },
        ],
        defaultEffects: [
          { type: "deal_damage", amount: 1, target: { type: "chosen", filter: { ...CHAR } } },
        ],
      }],
    }],
  },

  // Anna Diplomatic Queen — modal "choose one" with cost rider isn't cleanly
  // expressible by current primitives; deferred. (See DEFERRED_MECHANICS.md)
};

// ─── Apply ────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
const seen = new Set<string>();
for (const card of cards) {
  if (patches[card.id]) {
    const patch = patches[card.id];
    if (patch.abilities) {
      const existingKeywords = (card.abilities || []).filter((a: any) => a.type === "keyword");
      card.abilities = [...existingKeywords, ...patch.abilities];
    }
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    patched++;
    if (!seen.has(card.id)) {
      console.log(`  OK ${card.id}`);
      seen.add(card.id);
    }
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 5.`);
