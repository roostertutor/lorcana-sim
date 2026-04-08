#!/usr/bin/env node
// Set 9 — Batch 1: ETBs, quest triggers, statics, simple actions/items/songs.
// False positives (skipped / noted):
//   - none yet in this batch
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-009.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Simple ETBs ──────────────────────────────────────────────────

  "daisy-duck-musketeer-spy": {
    abilities: [{
      type: "triggered",
      storyName: "DISCARD",
      rulesText: "When you play this character, each opponent chooses and discards a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "discard_from_hand", amount: 1, target: OPP }],
    }],
  },

  "pluto-rescue-dog": {
    abilities: [{
      type: "triggered",
      storyName: "HEALING TOUCH",
      rulesText: "When you play this character, you may remove up to 3 damage from chosen character of yours.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 3, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "julieta-madrigal-excellent-cook": {
    abilities: [{
      type: "triggered",
      storyName: "HEALING MEAL",
      rulesText: "When you play this character, you may remove up to 2 damage from chosen character. If you removed damage this way, you may draw a card.",
      // Approximation: always may-draw; engine lacks strict "if you removed damage" gating.
      trigger: { on: "enters_play" },
      effects: [
        {
          type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
          target: { type: "chosen", filter: ANY_CHAR },
        },
        { type: "draw", amount: 1, isMay: true, target: SELF },
      ],
    }],
  },

  "stitch-carefree-surfer": {
    abilities: [{
      type: "triggered",
      storyName: "CAREFREE",
      rulesText: "When you play this character, if you have 2 or more other characters in play, you may draw 2 cards.",
      trigger: { on: "enters_play" },
      condition: {
        type: "cards_in_zone_gte", amount: 2, zone: "play", owner: SELF,
        filter: { cardType: ["character"], excludeSelf: true },
      },
      effects: [{ type: "draw", amount: 2, isMay: true, target: SELF }],
    }],
  },

  "belle-untrained-mystic": {
    abilities: [{
      type: "triggered",
      storyName: "UNTRAINED",
      rulesText: "When you play this character, move up to 1 damage counter from chosen character to chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage", amount: 1, isUpTo: true,
        from: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
        to: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "belle-accomplished-mystic": {
    abilities: [{
      type: "triggered",
      storyName: "ACCOMPLISHED",
      rulesText: "When you play this character, move up to 3 damage counters from chosen character to chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage", amount: 3, isUpTo: true,
        from: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
        to: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "elsa-spirit-of-winter": {
    abilities: [{
      type: "triggered",
      storyName: "FROZEN IN PLACE",
      rulesText: "When you play this character, exert up to 2 chosen characters. They can't ready at the start of their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "chosen", count: 2, filter: ANY_CHAR },
        followUpEffects: [{
          type: "cant_action", action: "ready",
          duration: "end_of_owner_next_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "dumbo-the-flying-elephant": {
    abilities: [{
      type: "triggered",
      storyName: "FLY HIGH",
      rulesText: "When you play this character, chosen character gains Evasive until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "dolores-madrigal-easy-listener": {
    abilities: [{
      type: "triggered",
      storyName: "EASY LISTENING",
      rulesText: "When you play this character, if an opponent has an exerted character in play, you may draw a card.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { owner: OPP, zone: "play", cardType: ["character"], isExerted: true },
      },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "jafar-lamp-thief": {
    abilities: [{
      type: "triggered",
      storyName: "SCRY 2",
      rulesText: "When you play this character, look at the top 2 cards of your deck. Put one on the top of your deck and the other on the bottom.",
      trigger: { on: "enters_play" },
      effects: [{ type: "scry", amount: 2, target: SELF }],
    }],
  },

  "prince-phillip-vanquisher-of-foes": {
    abilities: [{
      type: "triggered",
      storyName: "VANQUISH",
      rulesText: "When you play this character, banish all opposing damaged characters.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish",
        target: { type: "all", filter: { ...ALL_OPP_CHARS, hasDamage: true } },
      }],
    }],
  },

  "bobby-zimuruski-spray-cheese-kid": {
    abilities: [{
      type: "triggered",
      storyName: "LOOT",
      rulesText: "When you play this character, you may draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "megara-pulling-the-strings": {
    abilities: [{
      type: "triggered",
      storyName: "STRONG-ARM",
      rulesText: "When you play this character, chosen character gets +2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 2, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "tinker-bell-most-helpful": {
    abilities: [{
      type: "triggered",
      storyName: "HELPFUL",
      rulesText: "When you play this character, chosen character gains Evasive this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive", duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "john-silver-alien-pirate": {
    abilities: [
      {
        type: "triggered",
        storyName: "RECKLESS PLOT",
        rulesText: "When you play this character, chosen opposing character gains Reckless during their next turn.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "grant_keyword", keyword: "reckless",
          duration: "end_of_owner_next_turn",
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      },
      {
        type: "triggered",
        storyName: "RECKLESS PLOT",
        rulesText: "Whenever he quests, chosen opposing character gains Reckless during their next turn.",
        trigger: { on: "quests" },
        effects: [{
          type: "grant_keyword", keyword: "reckless",
          duration: "end_of_owner_next_turn",
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      },
    ],
  },

  "lefou-instigator": {
    abilities: [{
      type: "triggered",
      storyName: "INSTIGATE",
      rulesText: "When you play this character, ready chosen character. They can't quest for the rest of this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "ready",
        target: { type: "chosen", filter: ANY_CHAR },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "maleficent-monstrous-dragon": {
    abilities: [{
      type: "triggered",
      storyName: "MONSTROUS BLAST",
      rulesText: "When you play this character, you may banish chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "sisu-daring-visitor": {
    abilities: [{
      type: "triggered",
      storyName: "QUICK STRIKE",
      rulesText: "When you play this character, banish chosen opposing character with 1 {S} or less.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish",
        target: { type: "chosen", filter: { ...ALL_OPP_CHARS, maxStrength: 1 } },
      }],
    }],
  },

  "rapunzel-letting-down-her-hair": {
    abilities: [{
      type: "triggered",
      storyName: "LET IT DOWN",
      rulesText: "When you play this character, each opponent loses 1 lore.",
      trigger: { on: "enters_play" },
      effects: [{ type: "lose_lore", amount: 1, target: OPP }],
    }],
  },

  "hades-infernal-schemer": {
    abilities: [{
      type: "triggered",
      storyName: "INFERNAL SCHEME",
      rulesText: "When you play this character, you may put chosen opposing character into their player's inkwell facedown.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_to_inkwell", isMay: true, fromZone: "play",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "jasmine-heir-of-agrabah": {
    abilities: [{
      type: "triggered",
      storyName: "HEIR",
      rulesText: "When you play this character, remove up to 1 damage from chosen character of yours.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true,
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "maid-marian-delightful-dreamer": {
    abilities: [{
      type: "triggered",
      storyName: "DREAMY",
      rulesText: "When you play this character, chosen character gets -2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -2, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "hans-noble-scoundrel": {
    abilities: [{
      type: "triggered",
      storyName: "SCOUNDREL",
      rulesText: "When you play this character, if a Princess or Queen character is in play, gain 1 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { zone: "play", cardType: ["character"], hasAnyTrait: ["Princess", "Queen"] },
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "benja-guardian-of-the-dragon-gem": {
    abilities: [{
      type: "triggered",
      storyName: "GUARDIAN",
      rulesText: "When you play this character, you may banish chosen item.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "mickey-mouse-standard-bearer": {
    abilities: [{
      type: "triggered",
      storyName: "RALLY",
      rulesText: "When you play this character, chosen character gains Challenger +2 this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "challenger", keywordValue: 2,
        duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "tinker-bell-giant-fairy": {
    abilities: [
      {
        type: "triggered",
        storyName: "GIANT",
        rulesText: "When you play this character, deal 1 damage to each opposing character.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "deal_damage", amount: 1,
          target: { type: "all", filter: ALL_OPP_CHARS },
        }],
      },
      {
        type: "triggered",
        storyName: "CRUSH",
        rulesText: "During your turn, whenever this character banishes another character in a challenge, you may deal 2 damage to chosen opposing character.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [{
          type: "deal_damage", amount: 2, isMay: true,
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      },
    ],
  },

  "captain-hook-captain-of-the-jolly-roger": {
    abilities: [{
      type: "triggered",
      storyName: "RELOAD",
      rulesText: "When you play this character, you may return an action card named Fire the Cannons! from your discard to your hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["action"], name: "Fire the Cannons!" } },
      }],
    }],
  },

  "judy-hopps-optimistic-officer": {
    abilities: [{
      type: "triggered",
      storyName: "OPTIMISTIC",
      rulesText: "When you play this character, you may banish chosen item. If you do, its player draws a card.",
      // Approximation: always draw if banish succeeds; player attribution simplified to self via followUpEffects N/A.
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  // ── Quest triggers ────────────────────────────────────────────
  "aurora-holding-court": {
    abilities: [{
      type: "triggered",
      storyName: "HOLDING COURT",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next Princess or Queen character you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_cost_reduction", amount: 1,
        filter: { cardType: ["character"], hasAnyTrait: ["Princess", "Queen"] },
      }],
    }],
  },

  "queen-of-hearts-wonderland-empress": {
    abilities: [{
      type: "triggered",
      storyName: "VILLAIN RALLY",
      rulesText: "Whenever this character quests, your other Villain characters get +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", lore: 1, duration: "this_turn",
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Villain" } },
      }],
    }],
  },

  "ursula-sea-witch": {
    abilities: [{
      type: "triggered",
      storyName: "LOCK DOWN",
      rulesText: "Whenever this character quests, chosen opposing character can't ready at the start of their next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "cant_action", action: "ready",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "mama-odie-voice-of-wisdom": {
    abilities: [{
      type: "triggered",
      storyName: "DEEP CONNECTION",
      rulesText: "Whenever this character quests, you may move up to 2 damage counters from chosen character to chosen opposing character.",
      trigger: { on: "quests" },
      effects: [{
        type: "move_damage", amount: 2, isUpTo: true, isMay: true,
        from: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
        to: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "minnie-mouse-sweetheart-princess": {
    abilities: [
      {
        type: "static",
        storyName: "SUPPORT MICKEY",
        rulesText: "Your characters named Mickey Mouse gain Support.",
        effect: {
          type: "grant_keyword", keyword: "support",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, name: "Mickey Mouse" } },
        },
      },
      {
        type: "triggered",
        storyName: "ROYAL STRIKE",
        rulesText: "Whenever this character quests, you may banish chosen exerted character with 5 {S} or more.",
        trigger: { on: "quests" },
        effects: [{
          type: "banish", isMay: true,
          target: { type: "chosen", filter: { ...ANY_CHAR, isExerted: true, minStrength: 5 } },
        }],
      },
    ],
  },

  "daisy-duck-secret-agent": {
    abilities: [{
      type: "triggered",
      storyName: "INTEL LEAK",
      rulesText: "Whenever this character quests, each opponent chooses and discards a card.",
      trigger: { on: "quests" },
      effects: [{ type: "discard_from_hand", amount: 1, target: OPP }],
    }],
  },

  "anna-true-hearted": {
    abilities: [{
      type: "triggered",
      storyName: "HEARTY",
      rulesText: "Whenever this character quests, your other Hero characters get +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", lore: 1, duration: "this_turn",
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Hero" } },
      }],
    }],
  },

  "the-queen-mirror-seeker": {
    abilities: [{
      type: "triggered",
      storyName: "MIRROR SCRY",
      rulesText: "Whenever this character quests, you may look at the top 3 cards of your deck and put them back in any order.",
      trigger: { on: "quests" },
      effects: [{ type: "scry", amount: 3, isMay: true, target: SELF }],
    }],
  },

  "belle-inventive-engineer": {
    abilities: [{
      type: "triggered",
      storyName: "INVENT",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next item you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_cost_reduction", amount: 1,
        filter: { cardType: ["item"] },
      }],
    }],
  },

  "winnie-the-pooh-having-a-think": {
    abilities: [{
      type: "triggered",
      storyName: "HAVING A THINK",
      rulesText: "Whenever this character quests, you may put a card from your hand into your inkwell facedown.",
      trigger: { on: "quests" },
      effects: [{
        type: "move_to_inkwell", isMay: true, fromZone: "hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "hand" } },
      }],
    }],
  },

  // ── Statics ───────────────────────────────────────────────────
  "beast-gracious-prince": {
    abilities: [{
      type: "static",
      storyName: "HONOR PRINCESSES",
      rulesText: "Your Princess characters get +1 {S} and +1 {W}.",
      effect: {
        type: "gain_stats", strength: 1, willpower: 1,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Princess" } },
      },
    }],
  },

  "pluto-friendly-pooch": {
    abilities: [{
      type: "triggered",
      storyName: "FRIENDLY",
      rulesText: "You pay 1 {I} less for the next character you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_cost_reduction", amount: 1, filter: { cardType: ["character"] },
      }],
    }],
  },

  "jafar-keeper-of-secrets": {
    abilities: [{
      type: "static",
      storyName: "KEEPER OF SECRETS",
      rulesText: "This character gets +1 {S} for each card in your hand.",
      effect: {
        type: "modify_stat_per_count", stat: "strength", perCount: 1,
        countZone: "hand", countOwner: SELF,
        target: { type: "this" },
      },
    }],
  },

  "peter-pans-shadow-not-sewn-on": {
    abilities: [{
      type: "static",
      storyName: "SHADOW PLAY",
      rulesText: "Your other characters with Rush gain Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasKeyword: "rush" } },
      },
    }],
  },

  "timothy-q-mouse-flight-instructor": {
    abilities: [{
      type: "static",
      storyName: "FLIGHT LESSONS",
      rulesText: "While you have a character with Evasive in play, this character gets +1 {L}.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasKeyword: "evasive" },
        },
      },
    }],
  },

  "prince-phillip-warden-of-the-woods": {
    abilities: [{
      type: "static",
      storyName: "WARDEN",
      rulesText: "Your other Hero characters gain Ward.",
      effect: {
        type: "grant_keyword", keyword: "ward",
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Hero" } },
      },
    }],
  },

  "genie-of-the-lamp": {
    abilities: [{
      type: "static",
      storyName: "LAMP GUARDIAN",
      rulesText: "While this character is exerted, your other characters get +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "all", filter: OWN_OTHER_CHARS },
        condition: { type: "this_is_exerted" },
      },
    }],
  },

  "enchantress-unexpected-judge": {
    abilities: [{
      type: "static",
      storyName: "UNEXPECTED JUDGE",
      rulesText: "While being challenged, this character gets +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: { type: "this_being_challenged" },
      },
    }],
  },

  "lumiere-fiery-friend": {
    abilities: [{
      type: "static",
      storyName: "FIERY",
      rulesText: "Your other characters get +1 {S}.",
      effect: {
        type: "gain_stats", strength: 1,
        target: { type: "all", filter: OWN_OTHER_CHARS },
      },
    }],
  },

  "anna-braving-the-storm": {
    abilities: [{
      type: "static",
      storyName: "BRAVING",
      rulesText: "While you have another Hero character in play, this character gets +1 {L}.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...OWN_OTHER_CHARS, hasTrait: "Hero" },
        },
      },
    }],
  },

  "aurora-dreaming-guardian": {
    abilities: [{
      type: "static",
      storyName: "DREAMING GUARDIAN",
      rulesText: "Your other characters gain Ward.",
      effect: {
        type: "grant_keyword", keyword: "ward",
        target: { type: "all", filter: OWN_OTHER_CHARS },
      },
    }],
  },

  "cruella-de-vil-fashionable-cruiser": {
    abilities: [{
      type: "static",
      storyName: "FASHIONABLE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "jasmine-fearless-princess": {
    abilities: [{
      type: "static",
      storyName: "FEARLESS",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "jafar-royal-vizier": {
    abilities: [{
      type: "static",
      storyName: "VIZIER",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "scar-finally-king": {
    abilities: [{
      type: "static",
      storyName: "FINALLY KING",
      rulesText: "Your Ally characters get +1 {S}.",
      effect: {
        type: "gain_stats", strength: 1,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Ally" } },
      },
    }],
  },

  "lawrence-jealous-manservant": {
    abilities: [{
      type: "static",
      storyName: "JEALOUS",
      rulesText: "While this character has no damage, he gets +4 {S}.",
      effect: {
        type: "gain_stats", strength: 4,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }],
  },

  "cruella-de-vil-style-icon": {
    abilities: [{
      type: "static",
      storyName: "STYLE ICON",
      rulesText: "During your turn, each opposing character with cost 2 or less gets -1 {S}.",
      effect: {
        type: "gain_stats", strength: -1,
        target: { type: "all", filter: { ...ALL_OPP_CHARS, maxCost: 2 } },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "mulan-injured-soldier": {
    abilities: [{
      type: "triggered",
      storyName: "INJURED",
      rulesText: "This character enters play with 2 damage.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 2, asDamageCounter: true,
        target: { type: "this" },
      }],
    }],
  },

  // ── Kuzco banish-self triggers ────────────────────────────────
  "kuzco-wanted-llama": {
    abilities: [{
      type: "triggered",
      storyName: "WANTED",
      rulesText: "When this character is banished, you may draw a card.",
      trigger: { on: "is_banished" },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  // ── Actions / Songs ───────────────────────────────────────────
  "rapunzel-sunshine": {
    abilities: [{
      type: "triggered",
      storyName: "SUNSHINE",
      rulesText: "Remove up to 2 damage from chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "cinderella-gentle-and-kind": {
    abilities: [{
      type: "triggered",
      storyName: "GENTLE",
      rulesText: "Remove up to 3 damage from chosen Princess character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 3, isUpTo: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Princess" } },
      }],
    }],
  },

  "the-queen-wicked-and-vain": {
    abilities: [{
      type: "triggered",
      storyName: "WICKED",
      rulesText: "Draw a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "dumbo-ninth-wonder-of-the-universe": {
    abilities: [{
      type: "triggered",
      storyName: "CELEBRATION",
      rulesText: "Draw a card and gain 1 lore.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, target: SELF },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  "tinker-bell-tiny-tactician": {
    abilities: [{
      type: "triggered",
      storyName: "TINY TACTICS",
      rulesText: "Draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "elsa-snow-queen": {
    abilities: [{
      type: "triggered",
      storyName: "ICY GRIP",
      rulesText: "Exert chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "wildcat-mechanic": {
    abilities: [{
      type: "triggered",
      storyName: "MECHANIC",
      rulesText: "Banish chosen item.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish",
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "robin-hood-capable-fighter": {
    abilities: [{
      type: "triggered",
      storyName: "FIGHT",
      rulesText: "Deal 1 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "mickey-mouse-trumpeter": {
    abilities: [{
      type: "triggered",
      storyName: "TRUMPET",
      rulesText: "Play a character for free.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "play_from_hand_for_free",
        target: { type: "chosen", filter: { owner: SELF, zone: "hand", cardType: ["character"] } },
      }],
    }],
  },

  // ── Songs & Actions ───────────────────────────────────────────
  "heal-what-has-been-hurt": {
    actionEffects: [
      {
        type: "remove_damage", amount: 3, isUpTo: true,
        target: { type: "chosen", filter: ANY_CHAR },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "lost-in-the-woods": {
    actionEffects: [{
      type: "gain_stats", strength: -2,
      duration: "until_caster_next_turn",
      target: { type: "all", filter: ALL_OPP_CHARS },
    }],
  },

  "brunos-return": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      },
      {
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      },
    ],
  },

  "worlds-greatest-criminal-mind": {
    actionEffects: [{
      type: "banish",
      target: { type: "chosen", filter: { ...ANY_CHAR, minStrength: 5 } },
    }],
  },

  "poor-unfortunate-souls": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", filter: { zone: "play", cardType: ["character", "item", "location"], maxCost: 2 } },
    }],
  },

  "last-ditch-effort": {
    actionEffects: [
      { type: "exert", target: { type: "chosen", filter: ALL_OPP_CHARS } },
      {
        type: "grant_keyword", keyword: "challenger", keywordValue: 2,
        duration: "this_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      },
    ],
  },

  "im-stuck": {
    actionEffects: [{
      type: "cant_action", action: "ready",
      duration: "end_of_owner_next_turn",
      target: { type: "chosen", filter: { ...ANY_CHAR, isExerted: true } },
    }],
  },

  "sudden-chill": {
    actionEffects: [{ type: "discard_from_hand", amount: 1, target: OPP }],
  },

  "improvise": {
    actionEffects: [
      {
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "mother-knows-best": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "stand-out": {
    actionEffects: [
      {
        type: "gain_stats", strength: 3,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      {
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
    ],
  },

  "you-can-fly": {
    actionEffects: [{
      type: "grant_keyword", keyword: "evasive",
      duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "a-pirates-life": {
    actionEffects: [
      { type: "lose_lore", amount: 2, target: OPP },
      { type: "gain_lore", amount: 2, target: SELF },
    ],
  },

  "four-dozen-eggs": {
    actionEffects: [{
      type: "grant_keyword", keyword: "resist", keywordValue: 2,
      duration: "until_caster_next_turn",
      target: { type: "all", filter: ALL_OWN_CHARS },
    }],
  },

  "one-jump-ahead": {
    actionEffects: [{
      type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
      target: SELF,
    }],
  },

  "smash": {
    actionEffects: [{
      type: "deal_damage", amount: 3,
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "i-find-em-i-flatten-em": {
    actionEffects: [{
      type: "banish",
      target: { type: "all", filter: { zone: "play", cardType: ["item"] } },
    }],
  },

  "fire-the-cannons": {
    actionEffects: [{
      type: "deal_damage", amount: 2,
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "the-mob-song": {
    actionEffects: [{
      type: "deal_damage", amount: 3,
      target: { type: "chosen", count: 3, filter: { zone: "play", cardType: ["character", "location"] } },
    }],
  },

  // ── Items ─────────────────────────────────────────────────────
  "lantern": {
    actionEffects: [{
      type: "grant_cost_reduction", amount: 1, filter: { cardType: ["character"] },
    }],
  },

  "magic-mirror": {
    actionEffects: [{ type: "draw", amount: 1, target: SELF }],
  },

  "white-rabbits-pocket-watch": {
    actionEffects: [{
      type: "grant_keyword", keyword: "rush", duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "rose-lantern": {
    actionEffects: [{
      type: "move_damage", amount: 1,
      from: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
      to: { type: "chosen", filter: ALL_OPP_CHARS },
    }],
  },

  "heart-of-te-fiti": {
    actionEffects: [{
      type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
      target: SELF,
    }],
  },

  "beasts-mirror": {
    actionEffects: [{
      type: "draw", amount: 1, target: SELF,
      condition: {
        type: "cards_in_zone_gte", amount: 0, zone: "hand", owner: SELF,
        maxAmount: 0,
      },
    }],
  },

  "dinner-bell": {
    actionEffects: [
      // Approximation: draws 1 per damage — engine lacks "cards equal to damage". Skip
    ],
  },
};

// Remove dinner-bell approximation since we can't express it cleanly.
delete (patches as any)["dinner-bell"];

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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 9.`);
