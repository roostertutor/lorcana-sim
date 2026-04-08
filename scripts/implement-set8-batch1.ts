#!/usr/bin/env node
// Set 8 — Batch 1: ETBs, quest triggers, statics, simple actions/items.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-008.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── ETBs ──────────────────────────────────────────────────────
  "tramp-observant-guardian": {
    abilities: [{
      type: "triggered",
      storyName: "WATCHFUL EYE",
      rulesText: "When you play this character, chosen character gains Ward until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "ward",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "march-hare-hare-brained-eccentric": {
    abilities: [{
      type: "triggered",
      storyName: "OFF WITH HIS HEAD",
      rulesText: "When you play this character, you may deal 2 damage to chosen damaged character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 2, isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
      }],
    }],
  },

  "fred-major-science-enthusiast": {
    abilities: [{
      type: "triggered",
      storyName: "I'VE GOT QUESTIONS",
      rulesText: "When you play this character, you may banish chosen item.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "vincenzo-santorini-the-explosives-expert": {
    abilities: [{
      type: "triggered",
      storyName: "BOOM",
      rulesText: "When you play this character, you may deal 3 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 3, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "dumptruck-karnages-second-mate": {
    abilities: [{
      type: "triggered",
      storyName: "READY",
      rulesText: "When you play this character, you may deal 1 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "chip-quick-thinker": {
    abilities: [{
      type: "triggered",
      storyName: "THINK QUICK",
      rulesText: "When you play this character, chosen opponent chooses and discards a card.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "discard_from_hand",
        amount: 1,
        target: OPP,
      }],
    }],
  },

  "dormouse-easily-agitated": {
    abilities: [{
      type: "triggered",
      storyName: "STARTLE",
      rulesText: "When you play this character, you may put 1 damage counter on chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1, asDamageCounter: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "gloyd-orangeboar-fierce-competitor": {
    abilities: [{
      type: "triggered",
      storyName: "PLAY TO WIN",
      rulesText: "When you play this character, each opponent loses 1 lore and you gain 1 lore.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "lose_lore", amount: 1, target: OPP },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  "gyro-gearloose-eccentric-inventor": {
    abilities: [{
      type: "triggered",
      storyName: "EUREKA",
      rulesText: "When you play this character, chosen opposing character gets -3 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -3,
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "olaf-recapping-the-story": {
    abilities: [{
      type: "triggered",
      storyName: "GOTTA REMEMBER",
      rulesText: "When you play this character, chosen opposing character gets -1 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -1,
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "wreck-it-ralph-back-seat-driver": {
    abilities: [{
      type: "triggered",
      storyName: "SAFETY FIRST",
      rulesText: "When you play this character, chosen Racer character gets +4 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 4,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Racer" } },
      }],
    }],
  },

  "alice-courageous-keyholder": {
    abilities: [{
      type: "triggered",
      storyName: "READY UP",
      rulesText: "When you play this character, you may ready chosen damaged character of yours. They can't quest for the rest of this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: { ...ALL_OWN_CHARS, hasDamage: true } },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "anita-radcliffe-dog-lover": {
    abilities: [{
      type: "triggered",
      storyName: "COZY UP",
      rulesText: "When you play this character, you may give chosen Puppy character Resist +1 until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "resist", keywordValue: 1, isMay: true,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Puppy" } },
      }],
    }],
  },

  "jasmine-resourceful-infiltrator": {
    abilities: [{
      type: "triggered",
      storyName: "SLEIGHT OF HAND",
      rulesText: "When you play this character, you may give another chosen character Resist +1 until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "resist", keywordValue: 1, isMay: true,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
      }],
    }],
  },

  "little-sister-responsible-rabbit": {
    abilities: [{
      type: "triggered",
      storyName: "FEEL BETTER",
      rulesText: "When you play this character, you may remove up to 1 damage from chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "jock-attentive-uncle": {
    abilities: [{
      type: "triggered",
      storyName: "WHO'S NEW?",
      rulesText: "When you play this character, if you have 3 or more other characters in play, gain 2 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "cards_in_zone_gte",
        amount: 3,
        zone: "play",
        owner: SELF,
        filter: { cardType: ["character"], excludeSelf: true },
      },
      effects: [{ type: "gain_lore", amount: 2, target: SELF }],
    }],
  },

  "bernard-over-prepared": {
    abilities: [{
      type: "triggered",
      storyName: "EXTRA PREP",
      rulesText: "When you play this character, if you have an Ally character in play, you may draw a card.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, hasTrait: "Ally" },
      },
      effects: [{ type: "draw", amount: 1, target: SELF, isMay: true }],
    }],
  },

  "louis-endearing-alligator": {
    abilities: [{
      type: "triggered",
      storyName: "WHEN YOU'RE HUMAN",
      rulesText: "When you play this character, chosen opposing character gains Reckless during their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "prince-achmed-rival-suitor": {
    abilities: [{
      type: "triggered",
      storyName: "I AM PRINCE",
      rulesText: "When you play this character, you may exert chosen Princess character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Princess" } },
      }],
    }],
  },

  // ── Banished triggers ─────────────────────────────────────────
  "camilo-madrigal-center-stage": {
    abilities: [{
      type: "triggered",
      storyName: "WAS THAT GOOD",
      rulesText: "When this character is banished in a challenge, return this card to your hand.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "return_to_hand", target: { type: "this" } }],
    }],
  },

  "mickey-mouse-giant-mouse": {
    abilities: [{
      type: "triggered",
      storyName: "DOWN THEY GO",
      rulesText: "When this character is banished, deal 5 damage to each opposing character.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "deal_damage", amount: 5,
        target: { type: "all", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "mr-snoops-betrayed-partner": {
    abilities: [{
      type: "triggered",
      storyName: "I'M SO MAD",
      rulesText: "During your turn, when this character is banished, you may draw a card.",
      trigger: { on: "is_banished" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "draw", amount: 1, target: SELF, isMay: true }],
    }],
  },

  // ── Quest triggers ────────────────────────────────────────────
  "alice-clumsy-as-can-be": {
    abilities: [{
      type: "triggered",
      storyName: "WHAT A MESS",
      rulesText: "Whenever this character quests, put 1 damage counter on each other character.",
      trigger: { on: "quests" },
      effects: [{
        type: "deal_damage", amount: 1, asDamageCounter: true,
        target: { type: "all", filter: { ...ANY_CHAR, excludeSelf: true } },
      }],
    }],
  },

  "rapunzel-high-climber": {
    abilities: [{
      type: "triggered",
      storyName: "QUICK PATH",
      rulesText: "Whenever this character quests, chosen opposing character can't quest during their next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "cant_action", action: "quest",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "the-sultan-royal-apparition": {
    abilities: [{
      type: "triggered",
      storyName: "ALL HAIL",
      rulesText: "Whenever one of your Illusion characters quests, exert chosen opposing character.",
      trigger: { on: "quests", filter: { ...ALL_OWN_CHARS, hasTrait: "Illusion" } },
      effects: [{ type: "exert", target: { type: "chosen", filter: ALL_OPP_CHARS } }],
    }],
  },

  "stitch-alien-troublemaker": {
    abilities: [{
      type: "triggered",
      storyName: "TROUBLE",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may draw a card and gain 1 lore.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [
        { type: "draw", amount: 1, target: SELF, isMay: true },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  // ── Statics ───────────────────────────────────────────────────
  "magic-carpet-phantom-rug": {
    abilities: [{
      type: "static",
      storyName: "ETHEREAL TOUCH",
      rulesText: "Your other Illusion characters gain Challenger +1.",
      effect: {
        type: "grant_keyword", keyword: "challenger", keywordValue: 1,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Illusion" } },
      },
    }],
  },

  "cri-kee-part-of-the-team": {
    abilities: [{
      type: "static",
      storyName: "WE ARE READY",
      rulesText: "While you have 2 or more other exerted characters in play, this character gets +2 {L}.",
      effect: {
        type: "gain_stats", lore: 2,
        target: { type: "this" },
        condition: {
          type: "cards_in_zone_gte",
          amount: 2,
          zone: "play",
          owner: SELF,
          filter: { cardType: ["character"], isExerted: true, excludeSelf: true },
        },
      },
    }],
  },

  "the-coachman-greedy-deceiver": {
    abilities: [{
      type: "static",
      storyName: "TIME TO COLLECT",
      rulesText: "While 2 or more characters of yours are exerted, this character gets +2 {S} and gains Evasive.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: {
          type: "cards_in_zone_gte",
          amount: 2,
          zone: "play",
          owner: SELF,
          filter: { cardType: ["character"], isExerted: true },
        },
      },
    }],
  },

  "the-dodo-outlandish-storyteller": {
    abilities: [{
      type: "static",
      storyName: "BLOWHARD",
      rulesText: "This character gets +1 {S} for each 1 damage on him.",
      // Approximation: count 1 per damage on self via modify_stat_per_count requires
      // selfDamageCount; instead we use a simpler "while damaged +N" approximation.
      effect: {
        type: "modify_stat_per_count",
        stat: "strength",
        perCount: 1,
        countSelfDamage: true,
        target: { type: "this" },
      },
    }],
  },

  "queen-of-hearts-haughty-monarch": {
    abilities: [{
      type: "static",
      storyName: "OFF WITH THEIR HEADS",
      rulesText: "While there are 5 or more characters with damage in play, this character gets +3 {L}.",
      effect: {
        type: "gain_stats", lore: 3,
        target: { type: "this" },
        condition: {
          type: "cards_in_zone_gte",
          amount: 5,
          zone: "play",
          filter: { cardType: ["character"], hasDamage: true },
        },
      },
    }],
  },

  "lumiere-nimble-candelabra": {
    abilities: [{
      type: "static",
      storyName: "FLAME ON",
      rulesText: "While you have an item card in your discard, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { owner: SELF, zone: "discard", cardType: ["item"] },
        },
      },
    }],
  },

  "toby-turtle-wary-friend": {
    abilities: [{
      type: "static",
      storyName: "PROTECT",
      rulesText: "While this character is exerted, he gains Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        target: { type: "this" },
        condition: { type: "this_is_exerted" },
      },
    }],
  },

  "genie-satisfied-dragon": {
    abilities: [{
      type: "static",
      storyName: "DODGE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "zipper-flying-ranger": {
    abilities: [{
      type: "static",
      storyName: "DODGE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "bill-the-lizard-chimney-sweep": {
    abilities: [{
      type: "static",
      storyName: "I'M IN",
      rulesText: "While another character in play has damage, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ANY_CHAR, hasDamage: true, excludeSelf: true },
        },
      },
    }],
  },

  "vinnie-green-pigeon": {
    abilities: [{
      type: "triggered",
      storyName: "FOR THE FALLEN",
      rulesText: "During an opponent's turn, whenever one of your other characters is banished, gain 1 lore.",
      trigger: { on: "banished_other", filter: OWN_OTHER_CHARS },
      condition: { type: "compound_not", inner: { type: "is_your_turn" } },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "prince-john-fraidy-cat": {
    abilities: [{
      type: "triggered",
      storyName: "PETRIFIED",
      rulesText: "Whenever an opponent plays a character, deal 1 damage to this character.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: OPP } },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "this" } }],
    }],
  },

  // ── Actions ───────────────────────────────────────────────────
  "they-never-come-back": {
    actionEffects: [
      {
        type: "cant_action", action: "ready",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", count: 2, filter: ANY_CHAR },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "he-who-steals-and-runs-away": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } } },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "get-out": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: ANY_CHAR } },
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["item"] } },
      },
    ],
  },

  "twitterpated": {
    actionEffects: [{
      type: "grant_keyword", keyword: "evasive",
      duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "quick-shot": {
    actionEffects: [
      { type: "deal_damage", amount: 1, target: { type: "chosen", filter: ANY_CHAR } },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "undermine": {
    actionEffects: [
      { type: "discard_from_hand", amount: 1, target: OPP },
      { type: "gain_stats", strength: 2, target: { type: "chosen", filter: ANY_CHAR } },
    ],
  },

  "pouncing-practice": {
    actionEffects: [
      { type: "gain_stats", strength: -2, target: { type: "chosen", filter: ANY_CHAR } },
      {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      },
    ],
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 8.`);
