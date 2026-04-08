#!/usr/bin/env node
// Set 6 — Batch 1: ETBs / quest triggers / statics / simple actions.
// Patterns lifted from Set 5 batches and Set 4 batch10/11. No new engine primitives.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-006.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── ETB chosen target ─────────────────────────────────────────
  "chip-friend-indeed": {
    abilities: [{
      type: "triggered",
      storyName: "TEAMWORK",
      rulesText: "When you play this character, chosen character gets +1 {L} this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_stats", lore: 1, target: { type: "chosen", filter: ANY_CHAR } }],
    }],
  },

  "rabbit-indignant-pirate": {
    abilities: [{
      type: "triggered",
      storyName: "I'M THE CAPTAIN",
      rulesText: "When you play this character, you may remove up to 1 damage from chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "roo-littlest-pirate": {
    abilities: [{
      type: "triggered",
      storyName: "PIRATE GAMES",
      rulesText: "When you play this character, you may give chosen character -2 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -2, isMay: true,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "genie-wish-fulfilled": {
    abilities: [{
      type: "triggered",
      storyName: "YOUR FONDEST WISHES",
      rulesText: "When you play this character, draw a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "the-white-rose-jewel-of-the-garden": {
    abilities: [{
      type: "triggered",
      storyName: "BLOOM",
      rulesText: "When you play this character, gain 1 lore.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "sour-bill-surly-henchman": {
    abilities: [{
      type: "triggered",
      storyName: "WEAR DOWN",
      rulesText: "When you play this character, chosen opposing character gets -2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -2,
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "aladdin-intrepid-commander": {
    abilities: [{
      type: "triggered",
      storyName: "FALL IN LINE",
      rulesText: "When you play this character, your characters get +2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 2,
        target: { type: "all", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "gazelle-angel-with-horns": {
    abilities: [{
      type: "triggered",
      storyName: "I CAN'T HELP MYSELF",
      rulesText: "When you play this character, chosen character gains Evasive until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "kakamora-pirate-pitcher": {
    abilities: [{
      type: "triggered",
      storyName: "FIRE!",
      rulesText: "When you play this character, chosen Pirate character gains Evasive until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Pirate" } },
      }],
    }],
  },

  "alistair-krei-ambitious-entrepreneur": {
    abilities: [{
      type: "triggered",
      storyName: "PRESS RELEASE",
      rulesText: "When you play this character, if an opponent has an item in play, gain 1 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { owner: OPP, zone: "play", cardType: ["item"] },
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  // ── Quest triggers ────────────────────────────────────────────
  "winnie-the-pooh-hunny-pirate": {
    abilities: [{
      type: "triggered",
      storyName: "FRIENDLY HELPER",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next Pirate character you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_cost_reduction", amount: 1,
        filter: { cardType: ["character"], hasTrait: "Pirate" },
      }],
    }],
  },

  "tinker-bell-queen-of-the-azurite-fairies": {
    abilities: [{
      type: "triggered",
      storyName: "GRACE OUR PRESENCE",
      rulesText: "Whenever this character quests, your other Fairy characters get +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Fairy" } },
      }],
    }],
  },

  "grand-councilwoman-federation-leader": {
    abilities: [{
      type: "triggered",
      storyName: "UNDIVIDED ATTENTION",
      rulesText: "Whenever this character quests, your other Alien characters get +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Alien" } },
      }],
    }],
  },

  "aunt-cass-biggest-fan": {
    abilities: [{
      type: "triggered",
      storyName: "PROUD AS A PEACOCK",
      rulesText: "Whenever this character quests, chosen Inventor character gets +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Inventor" } },
      }],
    }],
  },

  "goofy-expert-shipwright": {
    abilities: [{
      type: "triggered",
      storyName: "MASTERFUL CRAFT",
      rulesText: "Whenever this character quests, chosen character gains Ward until the start of your next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_keyword", keyword: "ward",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "jasmine-rebellious-princess": {
    abilities: [{
      type: "triggered",
      storyName: "I CAN HELP",
      rulesText: "Whenever this character quests, each opponent loses 1 lore.",
      trigger: { on: "quests" },
      effects: [{ type: "lose_lore", amount: 1, target: OPP }],
    }],
  },

  "alice-savvy-sailor": {
    abilities: [{
      type: "triggered",
      storyName: "KEEN OBSERVER",
      rulesText: "Whenever this character quests, another chosen character of yours gets +1 {L} and gains Ward until the start of your next turn.",
      trigger: { on: "quests" },
      effects: [
        {
          type: "gain_stats", lore: 1,
          target: { type: "chosen", filter: OWN_OTHER_CHARS },
          followUpEffects: [{
            type: "grant_keyword", keyword: "ward",
            duration: "until_caster_next_turn",
            target: { type: "this" },
          }],
        },
      ],
    }],
  },

  "calhoun-marine-sergeant": {
    abilities: [{
      type: "triggered",
      storyName: "KICK INTO ACTION",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, gain 2 lore.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "gain_lore", amount: 2, target: SELF }],
    }],
  },

  "wreck-it-ralph-ham-hands": {
    abilities: [{
      type: "triggered",
      storyName: "SMASH!",
      rulesText: "Whenever this character quests, you may banish chosen item or location to gain 2 lore.",
      trigger: { on: "quests" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "banish",
          target: { type: "chosen", filter: { zone: "play", cardType: ["item", "location"] } },
        }],
        rewardEffects: [{ type: "gain_lore", amount: 2, target: SELF }],
      }],
    }],
  },

  // ── Statics ─────────────────────────────────────────────────────
  "madam-mim-tiny-adversary": {
    abilities: [{
      type: "static",
      storyName: "I'M A GENIUS",
      rulesText: "Your other characters gain Challenger +1.",
      effect: {
        type: "grant_keyword",
        keyword: "challenger",
        keywordValue: 1,
        target: { type: "all", filter: OWN_OTHER_CHARS },
      },
    }],
  },

  "captain-hook-underhanded": {
    abilities: [
      {
        type: "static",
        storyName: "DASTARDLY PLAN",
        rulesText: "While this character is exerted, opposing Pirate characters can't quest.",
        effect: {
          type: "cant_action",
          action: "quest",
          target: { type: "all", filter: { ...ALL_OPP_CHARS, hasTrait: "Pirate" } },
          condition: { type: "this_is_exerted" },
        },
      },
      {
        type: "triggered",
        storyName: "FANCY A FIGHT?",
        rulesText: "Whenever this character is challenged, draw a card.",
        trigger: { on: "challenged" },
        effects: [{ type: "draw", amount: 1, target: SELF }],
      },
    ],
  },

  "david-impressive-surfer": {
    abilities: [{
      type: "static",
      storyName: "OHANA",
      rulesText: "While you have a character named Nani in play, this character gets +2 {L}.",
      effect: {
        type: "gain_stats", lore: 2,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Nani" },
        },
      },
    }],
  },

  "donald-duck-first-mate": {
    abilities: [{
      type: "static",
      storyName: "GOOD SHOT",
      rulesText: "While you have a Captain character in play, this character gets +2 {L}.",
      effect: {
        type: "gain_stats", lore: 2,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasTrait: "Captain" },
        },
      },
    }],
  },

  "wendy-darling-courageous-captain": {
    abilities: [{
      type: "static",
      storyName: "WE CAN DO IT",
      rulesText: "While you have another Pirate character in play, this character gets +1 {S} and +1 {L}.",
      effect: {
        type: "gain_stats", strength: 1, lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasTrait: "Pirate", excludeSelf: true },
        },
      },
    }],
  },

  "mickey-mouse-courageous-sailor": {
    abilities: [{
      type: "static",
      storyName: "FOR ADVENTURE",
      rulesText: "While this character is at a location, he gets +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: { type: "this_at_location" },
      },
    }],
  },

  "adorabeezle-winterpop-ice-rocket-racer": {
    abilities: [{
      type: "static",
      storyName: "ICY POWER",
      rulesText: "While this character has damage, she gets +1 {L}.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: { type: "this_has_damage" },
      },
    }],
  },

  "pluto-guard-dog": {
    abilities: [{
      type: "static",
      storyName: "FAITHFUL COMPANION",
      rulesText: "While this character has no damage, he gets +4 {S}.",
      effect: {
        type: "gain_stats", strength: 4,
        target: { type: "this" },
        condition: { type: "compound_not", inner: { type: "this_has_damage" } },
      },
    }],
  },

  "card-soldiers-spear": {
    abilities: [{
      type: "static",
      storyName: "OFF WITH THEIR HEADS",
      rulesText: "Your damaged characters get +1 {S}.",
      effect: {
        type: "gain_stats", strength: 1,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasDamage: true } },
      },
    }],
  },

  "tadashi-hamada-baymax-inventor": {
    abilities: [{
      type: "static",
      storyName: "WORK IN PROGRESS",
      rulesText: "This character gets +1 {S} and +1 {W} for each item you have in play.",
      effect: {
        type: "modify_stat_per_count",
        stat: "strength",
        perCount: 1,
        countFilter: { owner: SELF, zone: "play", cardType: ["item"] },
        target: { type: "this" },
      },
    }],
  },

  "hiro-hamada-team-leader": {
    abilities: [{
      type: "static",
      storyName: "WE'RE GONNA HELP",
      rulesText: "Your other Inventor characters gain Resist +1.",
      effect: {
        type: "grant_keyword",
        keyword: "resist",
        keywordValue: 1,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Inventor" } },
      },
    }],
  },

  "fred-mascot-by-day": {
    abilities: [{
      type: "triggered",
      storyName: "MASCOT MOMENT",
      rulesText: "Whenever this character is challenged, gain 2 lore.",
      trigger: { on: "challenged" },
      effects: [{ type: "gain_lore", amount: 2, target: SELF }],
    }],
  },

  "diablo-obedient-raven": {
    abilities: [{
      type: "triggered",
      storyName: "GOOD COMPANION",
      rulesText: "When this character is banished, you may draw a card.",
      trigger: { on: "is_banished" },
      effects: [{ type: "draw", amount: 1, target: SELF, isMay: true }],
    }],
  },

  "the-carpenter-dinner-companion": {
    abilities: [{
      type: "triggered",
      storyName: "OYSTERS, OYSTERS, OYSTERS!",
      rulesText: "When this character is banished, you may exert chosen character.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "exert", isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "iago-reappearing-parrot": {
    abilities: [{
      type: "triggered",
      storyName: "I CAN'T BELIEVE THIS",
      rulesText: "When this character is banished in a challenge, return this card to your hand.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "return_to_hand", target: { type: "this" } }],
    }],
  },

  // ── Items / quick keyword grants ──────────────────────────────
  "training-dummy": {
    actionEffects: [{
      type: "grant_keyword", keyword: "bodyguard",
      duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  // ── Actions ───────────────────────────────────────────────────
  "good-job": {
    actionEffects: [{
      type: "gain_stats", lore: 1,
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "mosquito-bite": {
    actionEffects: [{
      type: "deal_damage", amount: 1, asDamageCounter: true,
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "energy-blast": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: ANY_CHAR } },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "you-came-back": {
    actionEffects: [{
      type: "ready",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "lead-the-way": {
    actionEffects: [{
      type: "gain_stats", strength: 2,
      target: { type: "all", filter: ALL_OWN_CHARS },
    }],
  },

  "thievery": {
    actionEffects: [
      { type: "lose_lore", amount: 1, target: OPP },
      { type: "gain_lore", amount: 1, target: SELF },
    ],
  },

  "bend-to-my-will": {
    actionEffects: [{
      type: "discard_from_hand",
      amount: "all",
      target: OPP,
    }],
  },

  "helping-hand": {
    actionEffects: [
      {
        type: "grant_keyword", keyword: "support",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  // ── Static / location ─────────────────────────────────────────
  "skull-rock-isolated-fortress": {
    abilities: [{
      type: "static",
      storyName: "BUCCANEER'S HIDEAWAY",
      rulesText: "Characters get +1 {S} while here.",
      effect: {
        type: "gain_stats", strength: 1,
        target: { type: "all", filter: { ...ANY_CHAR, atLocation: "this" } },
      },
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 6.`);
