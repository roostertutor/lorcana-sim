#!/usr/bin/env node
// Set 7 — Batch 1: Statics, ETBs, simple quest triggers, simple actions.
// Patterns lifted from Set 5/6 batches. No new engine primitives.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-007.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Simple static buffs ────────────────────────────────────────
  "rhino-motivational-speaker": {
    abilities: [{
      type: "static",
      storyName: "DESTINY CALLING",
      rulesText: "Your other characters get +2 {W}.",
      effect: {
        type: "gain_stats", willpower: 2,
        target: { type: "all", filter: OWN_OTHER_CHARS },
      },
    }],
  },

  "kanine-krunchies": {
    abilities: [{
      type: "static",
      storyName: "GOOD DOG",
      rulesText: "Your Puppy characters get +1 {W}.",
      effect: {
        type: "gain_stats", willpower: 1,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Puppy" } },
      },
    }],
  },

  "clarabelle-news-reporter": {
    abilities: [{
      type: "static",
      storyName: "BREAKING NEWS",
      rulesText: "Your other characters with Support get +1 {S}.",
      effect: {
        type: "gain_stats", strength: 1,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasKeyword: "support" } },
      },
    }],
  },

  "perdita-playful-mother": {
    abilities: [
      {
        type: "triggered",
        storyName: "ON MY WAY",
        rulesText: "Whenever this character quests, you pay 2 {I} less for the next Puppy character you play this turn.",
        trigger: { on: "quests" },
        effects: [{
          type: "grant_cost_reduction", amount: 2,
          filter: { cardType: ["character"], hasTrait: "Puppy" },
        }],
      },
      {
        type: "static",
        storyName: "BE PREPARED",
        rulesText: "Your Puppy characters gain Ward.",
        effect: {
          type: "grant_keyword", keyword: "ward",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Puppy" } },
        },
      },
    ],
  },

  "mattias-arendelle-general": {
    abilities: [{
      type: "static",
      storyName: "PROTECTIVE COMMANDER",
      rulesText: "Your Queen characters gain Ward.",
      effect: {
        type: "grant_keyword", keyword: "ward",
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Queen" } },
      },
    }],
  },

  "snow-white-fairest-in-the-land": {
    abilities: [{
      type: "static",
      storyName: "UNTOUCHABLE",
      rulesText: "This character can't be challenged.",
      effect: {
        type: "cant_be_challenged",
        target: { type: "this" },
      },
    }],
  },

  "gizmoduck-suited-up": {
    // approximation: "can challenge ready damaged characters" — can_challenge_ready grants
    // the ability to challenge any ready character (broader than printed text).
    // capability_id: can-challenge-ready-damaged-only
    abilities: [{
      type: "static",
      storyName: "BLATHERING BLATHERSKITE",
      rulesText: "This character can challenge ready damaged characters. (approximation: any ready character)",
      effect: {
        type: "can_challenge_ready",
        target: { type: "this" },
      },
    }],
  },

  "li-shang-newly-promoted": {
    abilities: [
      {
        type: "static",
        storyName: "LEAD BY EXAMPLE",
        rulesText: "This character can challenge ready characters.",
        effect: {
          type: "can_challenge_ready",
          target: { type: "this" },
        },
      },
      {
        type: "static",
        storyName: "BATTLE HARDENED",
        rulesText: "While this character is damaged, he gets +2 {S}.",
        effect: {
          type: "gain_stats", strength: 2,
          target: { type: "this" },
          condition: { type: "this_has_damage" },
        },
      },
    ],
  },

  "queen-of-hearts-losing-her-temper": {
    abilities: [{
      type: "static",
      storyName: "OFF WITH HIS HEAD",
      rulesText: "While this character has damage, she gets +3 {S}.",
      effect: {
        type: "gain_stats", strength: 3,
        target: { type: "this" },
        condition: { type: "this_has_damage" },
      },
    }],
  },

  "dr-calico-green-eyed-man": {
    abilities: [{
      type: "static",
      storyName: "UNHARMED",
      rulesText: "While this character has no damage, he gains Resist +2.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 2,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }],
  },

  "helga-sinclair-tough-as-nails": {
    abilities: [{
      type: "static",
      storyName: "ON THE MOVE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "cy-bug-invasive-enemy": {
    abilities: [{
      type: "static",
      storyName: "SWARMING",
      rulesText: "This character gets +1 {S} for each other character you have in play.",
      effect: {
        type: "modify_stat_per_count",
        stat: "strength",
        perCount: 1,
        countFilter: OWN_OTHER_CHARS,
        target: { type: "this" },
      },
    }],
  },

  "card-soldiers-royal-troops": {
    abilities: [{
      type: "static",
      storyName: "BATTLE ORDERS",
      rulesText: "While a damaged character is in play, this character gets +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ANY_CHAR, hasDamage: true },
        },
      },
    }],
  },

  "cogsworth-climbing-clock": {
    abilities: [{
      type: "static",
      storyName: "CLIMB",
      rulesText: "While you have an item card in your discard, this character gets +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { owner: SELF, zone: "discard", cardType: ["item"] },
        },
      },
    }],
  },

  "mariano-guzman-handsome-suitor": {
    abilities: [{
      type: "static",
      storyName: "CHARMING SUITOR",
      rulesText: "While you have a character named Dolores Madrigal in play, this character gets +1 {L}.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Dolores Madrigal" },
        },
      },
    }],
  },

  "lady-elegant-spaniel": {
    abilities: [{
      type: "static",
      storyName: "BEAUTIFUL COMPANION",
      rulesText: "While you have a character named Tramp in play, this character gets +1 {L}.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Tramp" },
        },
      },
    }],
  },

  "penny-the-orphan-clever-child": {
    abilities: [{
      type: "static",
      storyName: "MY HERO",
      rulesText: "While you have a Hero character in play, this character gains Ward.",
      effect: {
        type: "grant_keyword", keyword: "ward",
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasTrait: "Hero" },
        },
      },
    }],
  },

  "pacha-trekmate": {
    // approximation: "more cards than each opponent" modeled as NOT opponent_has_more_cards_in_hand.
    // Equal-count case is wrong (printed = false, modeled = true). capability_id: strictly-more-cards-than-opponent
    abilities: [{
      type: "static",
      storyName: "MORE CARDS",
      rulesText: "While you have more cards in your hand than each opponent, this character gets +2 {L}.",
      effect: {
        type: "gain_stats", lore: 2,
        target: { type: "this" },
        condition: { type: "not", condition: { type: "opponent_has_more_cards_in_hand" } },
      },
    }],
  },

  "tick-tock-relentless-crocodile": {
    abilities: [{
      type: "static",
      storyName: "TICK TOCK",
      rulesText: "During your turn, this character gains Evasive while a Pirate character is in play.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: {
          type: "compound_and",
          conditions: [
            { type: "is_your_turn" },
            { type: "you_control_matching", filter: { ...ANY_CHAR, hasTrait: "Pirate" } },
          ],
        },
      },
    }],
  },

  "kakamora-band-of-pirates": {
    abilities: [{
      type: "static",
      storyName: "STRENGTH IN NUMBERS",
      rulesText: "While you have another Pirate character in play, this character gains Challenger +3.",
      effect: {
        type: "grant_keyword", keyword: "challenger", keywordValue: 3,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...OWN_OTHER_CHARS, hasTrait: "Pirate" },
        },
      },
    }],
  },

  "king-of-hearts-picky-ruler": {
    abilities: [{
      type: "static",
      storyName: "OBJECTIONABLE STATE",
      rulesText: "Damaged characters can't challenge your characters.",
      // approximation: damaged opposing characters can't challenge at all.
      // capability_id: cant-challenge-your-characters-only
      effect: {
        type: "cant_action", action: "challenge",
        target: { type: "all", filter: { ...ALL_OPP_CHARS, hasDamage: true } },
      },
    }],
  },

  // ── Simple ETBs ────────────────────────────────────────────────
  "sven-keen-eyed-reindeer": {
    abilities: [{
      type: "triggered",
      storyName: "SHARP EYES",
      rulesText: "When you play this character, chosen character gets -3 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -3,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "anna-ice-breaker": {
    abilities: [{
      type: "triggered",
      storyName: "BREAKING THE ICE",
      rulesText: "When you play this character, chosen opposing character can't ready at the start of their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "cant_action", action: "ready",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "freckles-good-boy": {
    abilities: [{
      type: "triggered",
      storyName: "YAP",
      rulesText: "When you play this character, chosen opposing character gets -1 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -1,
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "stabbington-brother-with-a-patch": {
    abilities: [{
      type: "triggered",
      storyName: "INTIMIDATE",
      rulesText: "When you play this character, chosen opponent loses 1 lore.",
      trigger: { on: "enters_play" },
      effects: [{ type: "lose_lore", amount: 1, target: OPP }],
    }],
  },

  "honeymaren-northuldra-guide": {
    abilities: [{
      type: "triggered",
      storyName: "EXPOSED",
      rulesText: "When you play this character, if an opponent has an exerted character in play, gain 1 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OPP_CHARS, isExerted: true },
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "treasure-guardian-foreboding-sentry": {
    abilities: [{
      type: "triggered",
      storyName: "WATCHFUL EYE",
      rulesText: "When you play this character, if you have an Illusion character in play, you may draw a card.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, hasTrait: "Illusion" },
      },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "candlehead-dedicated-racer": {
    abilities: [{
      type: "triggered",
      storyName: "FINAL LAP",
      rulesText: "When this character is banished, you may remove up to 2 damage from chosen character.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "bucky-nutty-rascal": {
    abilities: [{
      type: "triggered",
      storyName: "NUTS ABOUT IT",
      rulesText: "When this character is banished in a challenge, you may draw a card.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  // ── Simple quest triggers ──────────────────────────────────────
  "madam-mim-cheating-spellcaster": {
    abilities: [{
      type: "triggered",
      storyName: "PAYBACK",
      rulesText: "Whenever this character quests, exert chosen opposing character.",
      trigger: { on: "quests" },
      effects: [{ type: "exert", target: { type: "chosen", filter: ALL_OPP_CHARS } }],
    }],
  },

  "marie-favored-kitten": {
    abilities: [{
      type: "triggered",
      storyName: "I'M A LADY",
      rulesText: "Whenever this character quests, you may give chosen character -2 {S} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", strength: -2, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "grandmother-fa-spirited-elder": {
    abilities: [{
      type: "triggered",
      storyName: "FINE ADVICE",
      rulesText: "Whenever this character quests, you may give chosen character of yours +2 {S} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", strength: 2, isMay: true,
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "fidget-sneaky-bat": {
    abilities: [{
      type: "triggered",
      storyName: "DIVERSION",
      rulesText: "Whenever this character quests, another chosen character of yours gains Evasive until the start of your next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  "elsa-trusted-sister": {
    abilities: [{
      type: "triggered",
      storyName: "HAND IN HAND",
      rulesText: "Whenever this character quests, if you have a character named Anna in play, gain 1 lore.",
      trigger: { on: "quests" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, hasName: "Anna" },
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "pepa-madrigal-sensitive-sister": {
    abilities: [{
      type: "triggered",
      storyName: "WEATHERED",
      rulesText: "Whenever one or more of your characters sings a song, gain 1 lore.",
      trigger: { on: "sings", filter: { owner: SELF } },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  // ── Simple actions ─────────────────────────────────────────────
  "out-of-order": {
    actionEffects: [{
      type: "banish", target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "double-trouble": {
    actionEffects: [{
      type: "deal_damage", amount: 1,
      target: { type: "chosen", filter: ANY_CHAR, count: 2 },
    }],
  },

  "wake-up-alice": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
    }],
  },

  "this-is-my-family": {
    actionEffects: [
      { type: "gain_lore", amount: 1, target: SELF },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "magical-maneuvers": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      },
      {
        type: "exert",
        target: { type: "chosen", filter: ANY_CHAR },
      },
    ],
  },

  "so-much-to-give": {
    actionEffects: [
      { type: "draw", amount: 1, target: SELF },
      {
        type: "grant_keyword", keyword: "bodyguard",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
    ],
  },

  "restoring-the-heart": {
    actionEffects: [
      {
        type: "remove_damage", amount: 3, isUpTo: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "hes-a-tramp": {
    actionEffects: [{
      type: "gain_stats",
      strengthDynamic: { type: "count", filter: ALL_OWN_CHARS },
      duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  // ── Items ──────────────────────────────────────────────────────
  "spaghetti-dinner": {
    abilities: [{
      type: "triggered",
      storyName: "FAMILY MEAL",
      rulesText: "If you have 2 or more characters in play, gain 1 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "characters_in_play_gte",
        amount: 2,
        player: SELF,
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "training-staff": {
    actionEffects: [{
      type: "grant_keyword", keyword: "challenger", keywordValue: 2,
      duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 7.`);
