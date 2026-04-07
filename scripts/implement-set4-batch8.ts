#!/usr/bin/env node
// Set 4 — Batch 8: fits-grammar wave (statics, ETB targeted banish/buffs,
// quest/sing/challenge triggers, named-character grants, etc.).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const ALL_OWN_CHARS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {

  // Cinderella - Melody Weaver — whenever this character sings, other Princesses +1 L this turn.
  "cinderella-melody-weaver": {
    abilities: [
      {
        type: "triggered",
        storyName: "MUSICAL DEBUT",
        rulesText: "Whenever this character sings a song, your other Princess characters get +1 {L} this turn.",
        trigger: { on: "sings" },
        effects: [
          {
            type: "gain_stats",
            lore: 1,
            duration: "this_turn",
            target: {
              type: "all",
              filter: { ...ALL_OWN_CHARS, hasTrait: "Princess", excludeSelf: true },
            },
          },
        ],
      },
    ],
  },

  // Donald Duck - Musketeer Soldier — ETB: chosen character +1 L this turn.
  "donald-duck-musketeer-soldier": {
    abilities: [
      {
        type: "triggered",
        storyName: "ALL FOR ONE",
        rulesText: "When you play this character, chosen character gets +1 {L} this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "gain_stats",
            lore: 1,
            duration: "this_turn",
            target: { type: "chosen", filter: { ...ANY_CHAR } },
          },
        ],
      },
    ],
  },

  // Mickey Mouse - Leader of the Band — ETB: chosen char gains Support this turn.
  "mickey-mouse-leader-of-the-band": {
    abilities: [
      {
        type: "triggered",
        storyName: "STRIKE UP THE MUSIC",
        rulesText: "When you play this character, chosen character gains Support this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "grant_keyword",
            keyword: "support",
            duration: "end_of_turn",
            target: { type: "chosen", filter: { ...ANY_CHAR } },
          },
        ],
      },
    ],
  },

  // Minnie Mouse - Musketeer Champion — ETB: banish chosen opposing char with 5+ S.
  "minnie-mouse-musketeer-champion": {
    abilities: [
      {
        type: "triggered",
        storyName: "EN GARDE!",
        rulesText: "When you play this character, banish chosen opposing character with 5 {S} or more.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "banish",
            target: { type: "chosen", filter: { ...ALL_OPP_CHARS, strengthAtLeast: 5 } },
          },
        ],
      },
    ],
  },

  // Mirabel Madrigal - Gift of the Family — quest trigger: other Madrigals +1 L this turn.
  "mirabel-madrigal-gift-of-the-family": {
    abilities: [
      {
        type: "triggered",
        storyName: "GIFT OF THE FAMILY",
        rulesText: "Whenever this character quests, your other Madrigal characters get +1 {L} this turn.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "gain_stats",
            lore: 1,
            duration: "this_turn",
            target: {
              type: "all",
              filter: { ...ALL_OWN_CHARS, hasTrait: "Madrigal", excludeSelf: true },
            },
          },
        ],
      },
    ],
  },

  // Prince Eric - Ursula's Groom — while you have a character named Ursula, Bodyguard + +2 W.
  "prince-eric-ursulas-groom": {
    abilities: [
      {
        type: "static",
        storyName: "I'M A FAST LEARNER",
        rulesText: "While you have a character named Ursula in play, this character gains Bodyguard.",
        condition: { type: "has_character_named", name: "Ursula", player: { type: "self" } },
        effect: {
          type: "grant_keyword",
          keyword: "bodyguard",
          target: { type: "this" },
        },
      },
      {
        type: "static",
        storyName: "I'M A FAST LEARNER",
        rulesText: "While you have a character named Ursula in play, this character gets +2 {W}.",
        condition: { type: "has_character_named", name: "Ursula", player: { type: "self" } },
        effect: {
          type: "modify_stat",
          stat: "willpower",
          modifier: 2,
          target: { type: "this" },
        },
      },
    ],
  },

  // Isabela Madrigal - Golden Child — only ability 2 (others-cant-quest) is unsupported; do ability 1.
  // Ability 1: during your turn, if no other character has quested this turn, +3 L.
  // (No "no_other_character_quested_this_turn" condition exists — skip both abilities.)
  // SKIPPED.

  // Peter Pan - Shadow Finder — your other characters with Evasive gain Rush.
  "peter-pan-shadow-finder": {
    abilities: [
      {
        type: "static",
        storyName: "YOU'RE FLYING!",
        rulesText: "Your other characters with Evasive gain Rush.",
        effect: {
          type: "grant_keyword",
          keyword: "rush",
          target: {
            type: "all",
            filter: { ...ALL_OWN_CHARS, hasKeyword: "evasive", excludeSelf: true },
          },
        },
      },
    ],
  },

  // Ursula - Sea Witch Queen — quest trigger: exert chosen character.
  "ursula-sea-witch-queen": {
    abilities: [
      {
        type: "triggered",
        storyName: "YOU'LL LISTEN TO ME!",
        rulesText: "Whenever this character quests, exert chosen character.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "exert",
            target: { type: "chosen", filter: { ...ANY_CHAR } },
          },
        ],
      },
    ],
  },

  // Hades - Double Dealer — needs play_for_free with name = banished card; SKIPPED (no support).

  // Hera - Queen of the Gods — Zeus chars Ward, Hercules chars Evasive.
  "hera-queen-of-the-gods": {
    abilities: [
      {
        type: "static",
        storyName: "MY HERO",
        rulesText: "Your characters named Zeus gain Ward.",
        effect: {
          type: "grant_keyword",
          keyword: "ward",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasName: "Zeus" } },
        },
      },
      {
        type: "static",
        storyName: "MY HERO",
        rulesText: "Your characters named Hercules gain Evasive.",
        effect: {
          type: "grant_keyword",
          keyword: "evasive",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasName: "Hercules" } },
        },
      },
    ],
  },

  // Megara - Liberated One — whenever you play a character named Hercules, may ready this.
  "megara-liberated-one": {
    abilities: [
      {
        type: "triggered",
        storyName: "HEAD HELD HIGH",
        rulesText: "Whenever you play a character named Hercules, you may ready this character.",
        trigger: {
          on: "card_played",
          filter: { owner: { type: "self" }, cardType: ["character"], hasName: "Hercules" },
        },
        effects: [
          { type: "ready", target: { type: "this" }, isMay: true },
        ],
      },
    ],
  },

  // Pegasus - Cloud Racer — ETB if shifted: own characters gain Evasive until your next turn.
  "pegasus-cloud-racer": {
    abilities: [
      {
        type: "triggered",
        storyName: "FLYING LESSONS",
        rulesText: "When you play this character, if you used Shift to play him, your characters gain Evasive until the start of your next turn.",
        trigger: { on: "enters_play" },
        condition: { type: "played_via_shift" },
        effects: [
          {
            type: "grant_keyword",
            keyword: "evasive",
            duration: "until_caster_next_turn",
            target: { type: "all", filter: { ...ALL_OWN_CHARS } },
          },
        ],
      },
    ],
  },

  // Prince Phillip - Vanquisher of Foes — ETB: banish all opposing damaged characters.
  "prince-phillip-vanquisher-of-foes": {
    abilities: [
      {
        type: "triggered",
        storyName: "DRAGON SLAYER",
        rulesText: "When you play this character, banish all opposing damaged characters.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "banish",
            target: { type: "all", filter: { ...ALL_OPP_CHARS, hasDamage: true } },
          },
        ],
      },
    ],
  },

  // The Muses - Proclaimers of Heroes — whenever you play a song, may return chosen char (S<=2) to hand.
  "the-muses-proclaimers-of-heroes": {
    abilities: [
      {
        type: "triggered",
        storyName: "FROM THE TOP",
        rulesText: "Whenever you play a song, you may return chosen character with 2 {S} or less to their player's hand.",
        trigger: {
          on: "card_played",
          filter: { owner: { type: "self" }, cardType: ["action"], hasTrait: "Song" },
        },
        effects: [
          {
            type: "return_to_hand",
            isMay: true,
            target: { type: "chosen", filter: { ...ANY_CHAR, strengthAtMost: 2 } },
          },
        ],
      },
    ],
  },

  // Ursula's Garden — needs "exerted character here" condition gating an opponent debuff. SKIPPED.

  // Goofy - Super Goof — whenever this challenges another character, gain 2 lore.
  "goofy-super-goof": {
    abilities: [
      {
        type: "triggered",
        storyName: "SUPER PEANUT POWERS",
        rulesText: "Whenever this character challenges another character, gain 2 lore.",
        trigger: { on: "challenges" },
        effects: [
          { type: "gain_lore", amount: 2, target: { type: "self" } },
        ],
      },
    ],
  },

  // Sisu - Daring Visitor — ETB: banish chosen opposing char with S<=1.
  "sisu-daring-visitor": {
    abilities: [
      {
        type: "triggered",
        storyName: "WHO'S NEXT?",
        rulesText: "When you play this character, banish chosen opposing character with 1 {S} or less.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "banish",
            target: { type: "chosen", filter: { ...ALL_OPP_CHARS, strengthAtMost: 1 } },
          },
        ],
      },
    ],
  },

  // Sisu - Empowered Sibling — ETB: banish all opposing characters with S<=2.
  "sisu-empowered-sibling": {
    abilities: [
      {
        type: "triggered",
        storyName: "WE'VE GOT WORK TO DO",
        rulesText: "When you play this character, banish all opposing characters with 2 {S} or less.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "banish",
            target: { type: "all", filter: { ...ALL_OPP_CHARS, strengthAtMost: 2 } },
          },
        ],
      },
    ],
  },

  // Tuk Tuk - Lively Partner — needs simultaneous move-as-effect for two characters. SKIPPED.

  // A Pirate's Life — each opponent -2 lore, you gain 2 lore.
  "a-pirate-s-life": {
    actionEffects: [
      { type: "lose_lore", amount: 2, target: { type: "opponent" } },
      { type: "gain_lore", amount: 2, target: { type: "self" } },
    ],
  },

  // Medallion Weights — needs floating "may draw on challenge" attached to a chosen char. SKIPPED.

  // Prince Phillip - Gallant Defender — needs "chosen for Support" trigger. SKIPPED.

  // Triton - Champion of Atlantica — opp characters get -1 S per location you control.
  "triton-champion-of-atlantica": {
    abilities: [
      {
        type: "static",
        storyName: "RULER OF THE SEAS",
        rulesText: "Opposing characters get -1 {S} for each location you have in play.",
        effect: {
          type: "modify_stat_per_count",
          stat: "strength",
          perCount: -1,
          countFilter: { owner: { type: "self" }, zone: "play", cardType: ["location"] },
          target: { type: "all", filter: { ...ALL_OPP_CHARS } },
        },
      },
    ],
  },

  // Ariel - Sonic Warrior — needs alt-cost ability ("you may pay 2 to deal 3"). SKIPPED.

  // Magic Broom - Brigade Commander — +2 S per other character named Magic Broom.
  "magic-broom-brigade-commander": {
    abilities: [
      {
        type: "static",
        storyName: "WORK TOGETHER",
        rulesText: "This character gets +2 {S} for each other character named Magic Broom you have in play.",
        effect: {
          type: "modify_stat_per_count",
          stat: "strength",
          perCount: 2,
          countFilter: { ...ALL_OWN_CHARS, hasName: "Magic Broom", excludeSelf: true },
          target: { type: "this" },
        },
      },
    ],
  },

  // Raya - Unstoppable Force — during your turn, when this banishes another in challenge, may draw a card.
  "raya-unstoppable-force": {
    abilities: [
      {
        type: "triggered",
        storyName: "MY MOMENT",
        rulesText: "During your turn, whenever this character banishes another character in a challenge, you may draw a card.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [
          { type: "draw", amount: 1, target: { type: "self" }, isMay: true },
        ],
      },
    ],
  },

  // The Mob Song — multi-target deal_damage (up to 3 chars/locs). SKIPPED.

  // Thebes - The Big Olive — needs while-here banish-in-challenge trigger. SKIPPED.
};

// ─── Apply ────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
const seen = new Set<string>();
for (const card of cards) {
  if (patches[card.id]) {
    const patch = patches[card.id];
    if (patch.abilities) card.abilities = patch.abilities;
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    patched++;
    if (!seen.has(card.id)) {
      console.log(`  ✅ ${card.id}`);
      seen.add(card.id);
    }
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 4.`);
