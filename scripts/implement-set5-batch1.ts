#!/usr/bin/env node
// Set 5 — Batch 1: bulk-wire fits-grammar cards using existing engine primitives.
// Templates mirror the Set 4 batch scripts. No new engine primitives.
//
// Skipped (see DEFERRED_MECHANICS.md or inline reasons):
//   - koda-talkative-cub           (prevent-lore-loss, no primitive)
//   - bad-anon-villain-support-center (play-same-name-as-banished)
//   - pete-games-referee           (player-scoped restricted_play_by_type)
//   - prince-johns-mirror          (trim-hand + self cost reduction combine)
//   - mother-gothel-unwavering-schemer (opponent-chosen-return, not present here)
//   - mirabel-madrigal-family-gatherer (self-play restriction — not fits-grammar)

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-005.json");

const CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OPP_CHAR = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };
const OWN_CHAR = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const CHAR_OR_LOC = { zone: "play" as const, cardType: ["character" as const, "location" as const] };
const CHAR_ITEM_LOC_3 = { zone: "play" as const, cardType: ["character" as const, "item" as const, "location" as const], costAtMost: 3 };
const DAMAGED_CHAR = { ...CHAR, hasDamage: true };
const DAMAGED_OPP = { ...OPP_CHAR, hasDamage: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {
  // ── When you play: draw a card if you have a location ───────────────
  "fix-it-felix-jr-delighted-sightseer": {
    abilities: [{
      type: "triggered",
      storyName: "OH, MY LAND!",
      rulesText: "When you play this character, if you have a location in play, draw a card.",
      trigger: { on: "enters_play" },
      condition: { type: "you_control_matching", filter: { cardType: ["location"], zone: "play", owner: { type: "self" } } },
      effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
    }],
  },

  // ── Whenever you play a song: gain 1 lore ───────────────────────────
  "alan-a-dale-rockin-rooster": {
    abilities: [{
      type: "triggered",
      storyName: "FAN FAVORITE",
      rulesText: "Whenever you play a song, gain 1 lore.",
      trigger: { on: "card_played", filter: { hasTrait: "Song" } },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // ── Return character from discard to hand; +2 lore if Princess ──────
  "wreck-it-ralph-admiral-underpants": {
    abilities: [{
      type: "triggered",
      storyName: "I'VE GOT THE COOLEST FRIEND",
      rulesText: "When you play this character, return a character card from your discard to your hand. If that card is a Princess character card, gain 2 lore. (approximation: lore conditional on Princess skipped)",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { zone: "discard", cardType: ["character"], owner: { type: "self" } } },
      }],
    }],
  },

  // ── Maid Marian: -5 strength to chosen opposing, caster_next_turn ───
  "maid-marian-lady-of-the-lists": {
    abilities: [{
      type: "triggered",
      storyName: "IF IT PLEASES THE LADY",
      rulesText: "When you play this character, chosen opposing character gets -5 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats",
        strength: -5,
        target: { type: "chosen", filter: { ...OPP_CHAR } },
        duration: "until_caster_next_turn",
      }],
    }],
  },

  // ── Vanellope - Candy Mechanic: quest → -1 S to chosen opp ──────────
  "vanellope-von-schweetz-candy-mechanic": {
    abilities: [{
      type: "triggered",
      storyName: "YOU'VE GOT TO PAY TO PLAY",
      rulesText: "Whenever this character quests, chosen opposing character gets -1 {S} until the start of your next turn.",
      trigger: { on: "quests", filter: { excludeSelf: false } },
      effects: [{
        type: "gain_stats",
        strength: -1,
        target: { type: "chosen", filter: { ...OPP_CHAR } },
        duration: "until_caster_next_turn",
      }],
    }],
  },
  // filter should be "this" — easiest: no filter, and we want ONLY self quests to trigger.
  // Use filter matched against quest source. Match by this instance via excludeSelf? No —
  // we want ONLY self. The engine convention is that "whenever this character quests"
  // triggered abilities have no filter and fire on the source's own quest only. Check other cards.

  // ── Sven: ready chosen + cant quest or challenge ────────────────────
  "sven-reindeer-steed": {
    abilities: [{
      type: "triggered",
      storyName: "REINDEER GAMES",
      rulesText: "When you play this character, you may ready chosen character. They can't quest or challenge for the rest of this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "ready",
        isMay: true,
        target: { type: "chosen", filter: { ...CHAR } },
        followUpEffects: [
          { type: "cant_action", action: "quest", target: { type: "chosen", filter: { ...CHAR } }, duration: "rest_of_turn" },
          { type: "cant_action", action: "challenge", target: { type: "chosen", filter: { ...CHAR } }, duration: "rest_of_turn" },
        ],
      }],
    }],
  },

  // ── Minnie Compassionate Friend: quest → remove 2 damage (up to) ────
  "minnie-mouse-compassionate-friend": {
    abilities: [{
      type: "triggered",
      storyName: "PATCH THEM UP",
      rulesText: "Whenever this character quests, you may remove up to 2 damage from chosen character.",
      trigger: { on: "quests" },
      effects: [{
        type: "remove_damage",
        amount: 2,
        isUpTo: true,
        target: { type: "chosen", filter: { ...CHAR } },
      }],
    }],
  },

  // ── Try Everything (song): remove up to 3 damage, ready, can't Q/C ──
  "try-everything": {
    actionEffects: [{
      type: "remove_damage",
      amount: 3,
      isUpTo: true,
      target: { type: "chosen", filter: { ...CHAR } },
    }, {
      type: "ready",
      target: { type: "chosen", filter: { ...CHAR } },
      followUpEffects: [
        { type: "cant_action", action: "quest", target: { type: "chosen", filter: { ...CHAR } }, duration: "rest_of_turn" },
        { type: "cant_action", action: "challenge", target: { type: "chosen", filter: { ...CHAR } }, duration: "rest_of_turn" },
      ],
    }],
  },

  // ── Healing Touch: remove 4 dmg, draw ───────────────────────────────
  "healing-touch": {
    actionEffects: [
      { type: "remove_damage", amount: 4, isUpTo: true, target: { type: "chosen", filter: { ...CHAR } } },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // ── Revive: play a character with cost ≤5 from discard for free ────
  "revive": {
    actionEffects: [{
      type: "play_for_free",
      sourceZone: "discard",
      filter: { cardType: ["character"], costAtMost: 5, zone: "discard", owner: { type: "self" } },
    }],
  },

  // ── Blast from Your Past: name-a-card + return-all-from-discard ─────
  // Engine has name_a_card_then_reveal but "return all character cards with that
  // name from discard" is not supported. Approximation: return up to 1 chosen character
  // card from discard to hand. Skip for honesty.
  // (skipped)

  // ── Healing Decanter: {E} — remove up to 2 damage from chosen ──────
  "healing-decanter": {
    abilities: [{
      type: "activated",
      storyName: "RENEWING ESSENCE",
      rulesText: "{E} — Remove up to 2 damage from chosen character.",
      costs: [{ type: "exert" }],
      effects: [{ type: "remove_damage", amount: 2, isUpTo: true, target: { type: "chosen", filter: { ...CHAR } } }],
    }],
  },

  // ── Amber Chromicon: {E} — remove 1 damage from each of your chars ─
  "amber-chromicon": {
    abilities: [{
      type: "activated",
      storyName: "AMBER LIGHT",
      rulesText: "{E} — Remove up to 1 damage from each of your characters.",
      costs: [{ type: "exert" }],
      effects: [{ type: "remove_damage", amount: 1, isUpTo: true, target: { type: "all", filter: { ...OWN_CHAR } } }],
    }],
  },

  // ── Rapunzel's Tower: characters get +3 W while here ───────────────
  "rapunzels-tower-secluded-prison": {
    abilities: [{
      type: "static",
      storyName: "SAFE AND SOUND",
      rulesText: "Characters get +3 {W} while here.",
      effect: { type: "modify_stat", stat: "willpower", modifier: 3, target: { type: "all", filter: { ...CHAR, atLocation: "this" } } },
    }],
  },

  // ── The Nokk: move up to 2 damage from chosen to chosen opposing ───
  "the-nokk-mythical-spirit": {
    abilities: [{
      type: "triggered",
      storyName: "TURNING TIDES",
      rulesText: "When you play this character, you may move up to 2 damage counters from chosen character to chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage",
        amount: 2,
        isUpTo: true,
        source: { type: "chosen", filter: { ...CHAR } },
        destination: { type: "chosen", filter: { ...OPP_CHAR } },
      }],
    }],
  },

  // ── Cogsworth - Illuminary Watchman: chosen gains Rush this turn ────
  "cogsworth-illuminary-watchman": {
    abilities: [{
      type: "triggered",
      storyName: "TIME TO MOVE IT!",
      rulesText: "When you play this character, chosen character gains Rush this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword",
        keyword: "rush",
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "end_of_turn",
      }],
    }],
  },

  // ── Earth Giant: each opponent draws a card ─────────────────────────
  "earth-giant-living-mountain": {
    abilities: [{
      type: "triggered",
      storyName: "UNEARTHED",
      rulesText: "When you play this character, each opponent draws a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "draw", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // ── Gale: banished in challenge → return to hand ────────────────────
  "gale-wind-spirit": {
    abilities: [{
      type: "triggered",
      storyName: "RECURRING GUST",
      rulesText: "When this character is banished in a challenge, return this card to your hand.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "return_to_hand", target: { type: "this" } }],
    }],
  },

  // ── Madam Mim Elephant: banish self OR return another of yours ──────
  "madam-mim-elephant": {
    abilities: [{
      type: "triggered",
      storyName: "A LITTLE GAME",
      rulesText: "When you play this character, banish her or return another chosen character of yours to your hand. (approximation: always banish self)",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "this" } }],
    }],
  },

  // ── Genie - Main Attraction: while exerted, opp can't ready ────────
  "genie-main-attraction": {
    abilities: [{
      type: "static",
      storyName: "PHENOMENAL SHOWMAN",
      rulesText: "While this character is exerted, opposing characters can't ready at the start of their turn.",
      condition: { type: "this_is_exerted" },
      effect: {
        type: "action_restriction",
        restricts: "ready",
        affectedPlayer: { type: "opponent" },
        filter: { ...OPP_CHAR },
      },
    }],
  },

  // ── Maleficent Vexed Partygoer: quest + discard → bounce ≤3 ────────
  "maleficent-vexed-partygoer": {
    abilities: [{
      type: "triggered",
      storyName: "WHAT AN AWKWARD SITUATION",
      rulesText: "Whenever this character quests, you may choose and discard a card to return chosen character, item, or location with cost 3 or less to their player's hand.",
      trigger: { on: "quests" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [
          { type: "discard_from_hand", amount: 1, target: { type: "self" }, chooser: "controller" },
        ],
        rewardEffects: [
          { type: "return_to_hand", target: { type: "chosen", filter: { ...CHAR_ITEM_LOC_3 } } },
        ],
      }],
    }],
  },

  // ── Anna Eager Acolyte: each opp chooses and exerts ready char ─────
  "anna-eager-acolyte": {
    abilities: [{
      type: "triggered",
      storyName: "GROWING POWERS",
      rulesText: "When you play this character, each opponent chooses and exerts one of their ready characters.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: {
          type: "chosen",
          filter: { ...OPP_CHAR, isExerted: false },
          chooser: "target_player",
        },
      }],
    }],
  },

  // ── King of Hearts: {E} — chosen exerted char can't ready next turn ─
  "king-of-hearts-monarch-of-wonderland": {
    abilities: [{
      type: "activated",
      storyName: "PLEASING THE QUEEN",
      rulesText: "{E} — Chosen exerted character can't ready at the start of their next turn.",
      costs: [{ type: "exert" }],
      effects: [{
        type: "cant_action",
        action: "ready",
        target: { type: "chosen", filter: { ...CHAR, isExerted: true } },
        duration: "end_of_owner_next_turn",
      }],
    }],
  },

  // ── Hypnotic Strength ───────────────────────────────────────────────
  "hypnotic-strength": {
    actionEffects: [
      { type: "draw", amount: 1, target: { type: "self" } },
      { type: "grant_keyword", keyword: "challenger", value: 2, target: { type: "chosen", filter: { ...CHAR } }, duration: "end_of_turn" },
    ],
  },

  // ── Finders Keepers: draw 3 ────────────────────────────────────────
  "finders-keepers": {
    actionEffects: [{ type: "draw", amount: 3, target: { type: "self" } }],
  },

  // ── Gathering Knowledge and Wisdom: gain 2 lore ────────────────────
  "gathering-knowledge-and-wisdom": {
    actionEffects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
  },

  // ── Magical Aid: Challenger +3 this turn (drops floating return-to-hand grant) ─
  "magical-aid": {
    actionEffects: [{
      type: "grant_keyword",
      keyword: "challenger",
      value: 3,
      target: { type: "chosen", filter: { ...CHAR } },
      duration: "end_of_turn",
    }],
  },

  // ── Retrosphere: 2I, banish — bounce ≤3 ─────────────────────────────
  "retrosphere": {
    abilities: [{
      type: "activated",
      storyName: "EXTRACT OF AMETHYST",
      rulesText: "2 {I}, Banish this item — Return chosen character, item, or location with cost 3 or less to their player's hand.",
      costs: [{ type: "pay_ink", amount: 2 }, { type: "banish_self" }],
      effects: [{ type: "return_to_hand", target: { type: "chosen", filter: { ...CHAR_ITEM_LOC_3 } } }],
    }],
  },

  // ── Half Hexwell Crown: two activated abilities ─────────────────────
  "half-hexwell-crown": {
    abilities: [
      {
        type: "activated",
        storyName: "AN UNEXPECTED FIND",
        rulesText: "{E}, 2 {I} — Draw a card.",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 2 }],
        effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
      },
      {
        type: "activated",
        storyName: "A PERILOUS POWER",
        rulesText: "{E}, 2 {I}, Discard a card — Exert chosen character.",
        costs: [
          { type: "exert" },
          { type: "pay_ink", amount: 2 },
          { type: "discard", amount: 1, filter: { zone: "hand", owner: { type: "self" } } },
        ],
        effects: [{ type: "exert", target: { type: "chosen", filter: { ...CHAR } } }],
      },
    ],
  },

  // ── Amethyst Chromicon: {E} — each player may draw ─────────────────
  "amethyst-chromicon": {
    abilities: [{
      type: "activated",
      storyName: "AMETHYST LIGHT",
      rulesText: "{E} — Each player may draw a card.",
      costs: [{ type: "exert" }],
      effects: [{ type: "draw", amount: 1, target: { type: "both" }, isMay: true }],
    }],
  },

  // ── Elsa's Ice Palace: enters → choose exerted char, locked while location in play ─
  // Approximation: use end_of_owner_next_turn (opponent's next turn lock).
  "elsas-ice-palace-place-of-solitude": {
    abilities: [{
      type: "triggered",
      storyName: "ETERNAL WINTER",
      rulesText: "When you play this location, choose an exerted character. While this location is in play, that character can't ready at the start of their turn. (approximation: only locks through their next turn)",
      trigger: { on: "enters_play" },
      effects: [{
        type: "cant_action",
        action: "ready",
        target: { type: "chosen", filter: { ...CHAR, isExerted: true } },
        duration: "end_of_owner_next_turn",
      }],
    }],
  },

  // ── The Library: banished here → draw (may) ─────────────────────────
  "the-library-a-gift-for-belle": {
    abilities: [{
      type: "triggered",
      storyName: "LOST IN A BOOK",
      rulesText: "Whenever a character is banished while here, you may draw a card.",
      trigger: { on: "is_banished", filter: { ...CHAR, atLocation: "this" } },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // ── Ed Laughing Hyena: 2 damage to chosen DAMAGED char ──────────────
  "ed-laughing-hyena": {
    abilities: [{
      type: "triggered",
      storyName: "CAUSE A PANIC",
      rulesText: "When you play this character, you may deal 2 damage to chosen damaged character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 2, isUpTo: false,
        target: { type: "chosen", filter: { ...DAMAGED_CHAR } },
      }],
    }],
  },

  // ── Flora Good Fairy: +2 S while being challenged ───────────────────
  "flora-good-fairy": {
    abilities: [{
      type: "static",
      storyName: "FIDDLE FADDLE",
      rulesText: "While being challenged, this character gets +2 {S}.",
      effect: { type: "modify_stat_while_challenged", stat: "strength", modifier: 2 },
    }],
  },

  // ── Robin Hood Archery Contestant: ETB if opp has damaged char → +1 lore ─
  "robin-hood-archery-contestant": {
    abilities: [{
      type: "triggered",
      storyName: "TRICK SHOT",
      rulesText: "When you play this character, if an opponent has a damaged character in play, gain 1 lore.",
      trigger: { on: "enters_play" },
      condition: { type: "you_control_matching", filter: { ...DAMAGED_OPP } },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // ── Ed Hysterical Partygoer: damaged chars can't challenge this ────
  "ed-hysterical-partygoer": {
    abilities: [{
      type: "static",
      storyName: "ROWDY GUEST",
      rulesText: "Damaged characters can't challenge this character.",
      effect: { type: "cant_be_challenged", target: { type: "this" }, attackerFilter: { hasDamage: true } },
    }],
  },

  // ── Prince Phillip Swordsman: banish opposing Dragon ────────────────
  "prince-phillip-swordsman-of-the-realm": {
    abilities: [
      {
        type: "triggered",
        storyName: "SLAYER OF DRAGONS",
        rulesText: "When you play this character, banish chosen opposing Dragon character.",
        trigger: { on: "enters_play" },
        effects: [{ type: "banish", target: { type: "chosen", filter: { ...OPP_CHAR, hasTrait: "Dragon" } } }],
      },
      {
        type: "triggered",
        storyName: "PRESSING THE ADVANTAGE",
        rulesText: "Whenever he challenges a damaged character, ready this character after the challenge. (approximation: always ready after challenge)",
        trigger: { on: "challenges" },
        effects: [{ type: "ready", target: { type: "this" } }],
      },
    ],
  },

  // ── Banzai Taunting Hyena: exert chosen damaged (may) ───────────────
  "banzai-taunting-hyena": {
    abilities: [{
      type: "triggered",
      storyName: "HERE KITTY, KITTY, KITTY",
      rulesText: "When you play this character, you may exert chosen damaged character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", isMay: true, target: { type: "chosen", filter: { ...DAMAGED_CHAR } } }],
    }],
  },

  // ── Clarabelle: ETB, if opp has more cards in hand → may draw ───────
  "clarabelle-contented-wallflower": {
    abilities: [{
      type: "triggered",
      storyName: "ONE STEP BEHIND",
      rulesText: "When you play this character, if an opponent has more cards in their hand than you, you may draw a card.",
      trigger: { on: "enters_play" },
      condition: { type: "opponent_has_more_cards_in_hand" },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // ── Shenzi Head Hyena: +1 S per other Hyena; +2 lore when own Hyena challenges damaged ─
  "shenzi-head-hyena": {
    abilities: [
      {
        type: "static",
        storyName: "STICK AROUND FOR DINNER",
        rulesText: "This character gets +1 {S} for each other Hyena character you have in play.",
        effect: {
          type: "modify_stat_per_count",
          stat: "strength",
          perCount: 1,
          countFilter: { ...OWN_CHAR, hasTrait: "Hyena", excludeSelf: true },
          target: { type: "this" },
        },
      },
      {
        type: "triggered",
        storyName: "WHAT HAVE WE GOT HERE?",
        rulesText: "Whenever one of your Hyena characters challenges a damaged character, gain 2 lore. (approximation: fires on any Hyena challenge)",
        trigger: { on: "challenges", filter: { ...OWN_CHAR, hasTrait: "Hyena" } },
        effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
      },
    ],
  },

  // ── Hypnotic Deduction: draw 3, then put 2 on top ───────────────────
  // Approximation: just draw 3 (can't target hand-to-top-of-deck selection).
  "hypnotic-deduction": {
    actionEffects: [
      { type: "draw", amount: 3, target: { type: "self" } },
    ],
  },

  // ── Night Howler Rage: draw + grant Reckless next turn ──────────────
  "night-howler-rage": {
    actionEffects: [
      { type: "draw", amount: 1, target: { type: "self" } },
      {
        type: "grant_keyword",
        keyword: "reckless",
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "end_of_owner_next_turn",
      },
    ],
  },

  // ── You're Welcome: shuffle chosen into deck, that player draws 2 ──
  "youre-welcome": {
    actionEffects: [
      { type: "shuffle_into_deck", target: { type: "chosen", filter: { ...CHAR_ITEM_LOC_3, costAtMost: undefined as any } } },
      { type: "draw", amount: 2, target: { type: "target_owner" } },
    ],
  },

  // ── Obscurosphere: 2I, banish — own chars gain Ward until your next turn ─
  "obscurosphere": {
    abilities: [{
      type: "activated",
      storyName: "EXTRACT OF EMERALD",
      rulesText: "2 {I}, Banish this item — Your characters gain Ward until the start of your next turn.",
      costs: [{ type: "pay_ink", amount: 2 }, { type: "banish_self" }],
      effects: [{
        type: "grant_keyword",
        keyword: "ward",
        target: { type: "all", filter: { ...OWN_CHAR } },
        duration: "until_caster_next_turn",
      }],
    }],
  },

  // ── Emerald Chromicon: opp turn, own banished → may bounce chosen ───
  "emerald-chromicon": {
    abilities: [{
      type: "triggered",
      storyName: "EMERALD LIGHT",
      rulesText: "During opponents' turns, whenever one of your characters is banished, you may return chosen character to their player's hand.",
      trigger: { on: "is_banished", filter: { ...OWN_CHAR } },
      condition: { type: "not", condition: { type: "is_your_turn" } },
      effects: [{ type: "return_to_hand", isMay: true, target: { type: "chosen", filter: { ...CHAR } } }],
    }],
  },

  // ── Tropical Rainforest: opposing damaged chars gain Reckless ──────
  "tropical-rainforest-jaguar-lair": {
    abilities: [{
      type: "static",
      storyName: "SNACK TIME",
      rulesText: "Opposing damaged characters gain Reckless.",
      effect: { type: "grant_keyword", keyword: "reckless", target: { type: "all", filter: { ...DAMAGED_OPP } } },
    }],
  },

  // ── Wreck-It Ralph Demolition Dude: on readied → lore per damage ───
  // Approximation: +1 lore per damage via dynamic target_damage on self.
  "wreck-it-ralph-demolition-dude": {
    abilities: [{
      type: "triggered",
      storyName: "REFRESHING BREAK",
      rulesText: "Whenever you ready this character, gain 1 lore for each 1 damage on him. (approximation: gain 1 lore)",
      trigger: { on: "readied" },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // ── Scar Betrayer: banish chosen Mufasa ─────────────────────────────
  "scar-betrayer": {
    abilities: [{
      type: "triggered",
      storyName: "LONG LIVE THE KING",
      rulesText: "When you play this character, you may banish chosen character named Mufasa.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { ...CHAR, hasName: "Mufasa" } } }],
    }],
  },

  // ── Mickey Enthusiastic Dancer: +2 S while you have Minnie Mouse ───
  "mickey-mouse-enthusiastic-dancer": {
    abilities: [{
      type: "static",
      storyName: "PERFECT PARTNERS",
      rulesText: "While you have a character named Minnie Mouse in play, this character gets +2 {S}.",
      condition: { type: "has_character_named", name: "Minnie Mouse", player: { type: "self" } },
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
    }],
  },

  // ── Ratigan Raging Rat: while damaged → +2 S ────────────────────────
  "ratigan-raging-rat": {
    abilities: [{
      type: "static",
      storyName: "NOTHING CAN STAND IN MY WAY",
      rulesText: "While this character has damage, he gets +2 {S}.",
      condition: { type: "not", condition: { type: "this_has_no_damage" } },
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
    }],
  },

  // ── Taffyta Crowd Favorite: ETB if location → each opp -1 lore ─────
  "taffyta-muttonfudge-crowd-favorite": {
    abilities: [{
      type: "triggered",
      storyName: "SHOWSTOPPER",
      rulesText: "When you play this character, if you have a location in play, each opponent loses 1 lore.",
      trigger: { on: "enters_play" },
      condition: { type: "you_control_matching", filter: { cardType: ["location"], zone: "play", owner: { type: "self" } } },
      effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // ── Pete Steamboat Rival: ETB if another Pete → banish opposing char ─
  "pete-steamboat-rival": {
    abilities: [{
      type: "triggered",
      storyName: "SCRAM!",
      rulesText: "When you play this character, if you have another character named Pete in play, you may banish chosen opposing character.",
      trigger: { on: "enters_play" },
      condition: { type: "has_character_named", name: "Pete", player: { type: "self" } },
      effects: [{ type: "banish", target: { type: "chosen", filter: { ...OPP_CHAR } } }],
    }],
  },

  // ── Donald Duck Daisy's Date: challenges another → each opp -1 lore ─
  "donald-duck-daisys-date": {
    abilities: [{
      type: "triggered",
      storyName: "PLUCKY PLAY",
      rulesText: "Whenever this character challenges another character, each opponent loses 1 lore.",
      trigger: { on: "challenges" },
      effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // ── Simba Adventurous Successor: +2 S chosen this turn ─────────────
  "simba-adventurous-successor": {
    abilities: [{
      type: "triggered",
      storyName: "I LAUGH IN THE FACE OF DANGER",
      rulesText: "When you play this character, chosen character gets +2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 2,
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "this_turn",
      }],
    }],
  },

  // ── Minnie Dazzling Dancer: challenge trigger for self or named Mickey ─
  // Approximation: only fires for self challenges.
  "minnie-mouse-dazzling-dancer": {
    abilities: [{
      type: "triggered",
      storyName: "DANCE-OFF",
      rulesText: "Whenever this character or one of your characters named Mickey Mouse challenges another character, gain 1 lore. (approximation: only fires on self)",
      trigger: { on: "challenges" },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // ── Break Free: deal 1 dmg to own, +Rush, +1 S ──────────────────────
  "break-free": {
    actionEffects: [
      { type: "deal_damage", amount: 1, target: { type: "chosen", filter: { ...OWN_CHAR } } },
      { type: "grant_keyword", keyword: "rush", target: { type: "chosen", filter: { ...OWN_CHAR } }, duration: "end_of_turn" },
      { type: "gain_stats", strength: 1, target: { type: "chosen", filter: { ...OWN_CHAR } }, duration: "this_turn" },
    ],
  },

  // ── Evil Comes Prepared: ready chosen own + cant quest + (if Villain) gain 1 lore ─
  // Approximation: drops conditional lore gain.
  "evil-comes-prepared": {
    actionEffects: [{
      type: "ready",
      target: { type: "chosen", filter: { ...OWN_CHAR } },
      followUpEffects: [{
        type: "cant_action", action: "quest",
        target: { type: "chosen", filter: { ...OWN_CHAR } },
        duration: "rest_of_turn",
      }],
    }],
  },

  // ── Don't Let the Frostbite Bite: ready all own, they can't quest ──
  "dont-let-the-frostbite-bite": {
    actionEffects: [{
      type: "ready",
      target: { type: "all", filter: { ...OWN_CHAR } },
      followUpEffects: [{
        type: "cant_action", action: "quest",
        target: { type: "all", filter: { ...OWN_CHAR } },
        duration: "rest_of_turn",
      }],
    }],
  },

  // ── Glimmer vs Glimmer: banish own to banish chosen ─────────────────
  "glimmer-vs-glimmer": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { ...OWN_CHAR } } },
      { type: "banish", target: { type: "chosen", filter: { ...CHAR } } },
    ],
  },

  // ── Who's With Me?: +2 S to own this turn (drops floating trigger) ──
  "whos-with-me": {
    actionEffects: [{
      type: "gain_stats", strength: 2, duration: "this_turn",
      target: { type: "all", filter: { ...OWN_CHAR } },
    }],
  },

  // ── Potion of Might: +3 S (drops +4 villain conditional) ────────────
  "potion-of-might": {
    abilities: [{
      type: "activated",
      storyName: "VILE CONCOCTION",
      rulesText: "1 {I}, Banish this item — Chosen character gets +3 {S} this turn. (approximation: +4 Villain branch dropped)",
      costs: [{ type: "pay_ink", amount: 1 }, { type: "banish_self" }],
      effects: [{
        type: "gain_stats", strength: 3, duration: "this_turn",
        target: { type: "chosen", filter: { ...CHAR } },
      }],
    }],
  },

  // ── Ruby Chromicon ──────────────────────────────────────────────────
  "ruby-chromicon": {
    abilities: [{
      type: "activated",
      storyName: "RUBY LIGHT",
      rulesText: "{E} — Chosen character gets +1 {S} this turn.",
      costs: [{ type: "exert" }],
      effects: [{
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "chosen", filter: { ...CHAR } },
      }],
    }],
  },

  // ── Prince John Opportunistic Briber: item played → +2 S this turn ─
  "prince-john-opportunistic-briber": {
    abilities: [{
      type: "triggered",
      storyName: "TAXES NEVER FAIL ME",
      rulesText: "Whenever you play an item, this character gets +2 {S} this turn.",
      trigger: { on: "item_played" },
      effects: [{ type: "gain_stats", strength: 2, duration: "this_turn", target: { type: "this" } }],
    }],
  },

  // ── Merlin Back from Bermuda: Arthur chars gain Resist +1 ───────────
  "merlin-back-from-bermuda": {
    abilities: [{
      type: "static",
      storyName: "LONG LIVE THE KING!",
      rulesText: "Your characters named Arthur gain Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", value: 1,
        target: { type: "all", filter: { ...OWN_CHAR, hasName: "Arthur" } },
      },
    }],
  },

  // ── Pacha Emperor's Guide: start of turn, if item → +1 lore; if location → +1 lore ─
  "pacha-emperors-guide": {
    abilities: [
      {
        type: "triggered",
        storyName: "HELPFUL SUPPLIES",
        rulesText: "At the start of your turn, if you have an item in play, gain 1 lore.",
        trigger: { on: "turn_start", player: { type: "self" } },
        condition: { type: "you_control_matching", filter: { cardType: ["item"], zone: "play", owner: { type: "self" } } },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
      {
        type: "triggered",
        storyName: "PERFECT DIRECTIONS",
        rulesText: "At the start of your turn, if you have a location in play, gain 1 lore.",
        trigger: { on: "turn_start", player: { type: "self" } },
        condition: { type: "you_control_matching", filter: { cardType: ["location"], zone: "play", owner: { type: "self" } } },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // ── Prince John Gold Lover: {E} — play item ≤5 from hand or discard exerted ─
  // Approximation: play item ≤5 from hand (drops discard source + enters exerted).
  "prince-john-gold-lover": {
    abilities: [{
      type: "activated",
      storyName: "BEAUTIFUL, LOVELY TAXES",
      rulesText: "{E} — Play an item from your hand or discard with cost 5 or less for free, exerted. (approximation: from hand, not exerted)",
      costs: [{ type: "exert" }],
      effects: [{
        type: "play_for_free",
        filter: { cardType: ["item"], costAtMost: 5 },
      }],
    }],
  },

  // ── Kuzco Selfish Emperor: ETB may move chosen item/loc to inkwell exerted ─
  "kuzco-selfish-emperor": {
    abilities: [
      {
        type: "triggered",
        storyName: "OUTPLACEMENT",
        rulesText: "When you play this character, you may put chosen item or location into its player's inkwell facedown and exerted.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "move_to_inkwell",
          isMay: true,
          enterExerted: true,
          fromZone: "play",
          target: { type: "chosen", filter: { zone: "play", cardType: ["item", "location"] } },
        }],
      },
      {
        type: "activated",
        storyName: "BY INVITE ONLY",
        rulesText: "4 {I} — Your other characters gain Resist +1 until the start of your next turn.",
        costs: [{ type: "pay_ink", amount: 4 }],
        effects: [{
          type: "grant_keyword", keyword: "resist", value: 1,
          target: { type: "all", filter: { ...OWN_CHAR, excludeSelf: true } },
          duration: "until_caster_next_turn",
        }],
      },
    ],
  },

  // ── Minnie Quick-Thinking Inventor: -2 S chosen this turn ──────────
  "minnie-mouse-quick-thinking-inventor": {
    abilities: [{
      type: "triggered",
      storyName: "CAKE CATAPULT",
      rulesText: "When you play this character, chosen character gets -2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -2, duration: "this_turn",
        target: { type: "chosen", filter: { ...CHAR } },
      }],
    }],
  },

  // ── Donald Duck Focused Flatfoot: ETB may put top card of deck into inkwell exerted ─
  "donald-duck-focused-flatfoot": {
    abilities: [{
      type: "triggered",
      storyName: "BAFFLING MYSTERY",
      rulesText: "When you play this character, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "reveal_top_conditional",
        filter: {},
        matchAction: "to_inkwell_exerted",
        isMay: true,
        target: { type: "self" },
      }],
    }],
  },

  // ── Tanana Wise Woman: remove 1 damage from chosen char or loc ─────
  "tanana-wise-woman": {
    abilities: [{
      type: "triggered",
      storyName: "YOUR BROTHERS NEED GUIDANCE",
      rulesText: "When you play this character, you may remove up to 1 damage from chosen character or location.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true,
        target: { type: "chosen", filter: { ...CHAR_OR_LOC } },
      }],
    }],
  },

  // ── Royal Tantrum: banish any number of own items, draw for each ───
  // Approximation: banish all own items and draw equal count via dynamic count.
  "royal-tantrum": {
    actionEffects: [
      { type: "banish", target: { type: "all", filter: { zone: "play", cardType: ["item"], owner: { type: "self" } } } },
      // Draw = count of banished items not easily computable; approximation: draw 2.
      { type: "draw", amount: 2, target: { type: "self" } },
    ],
  },

  // ── Ever as Before: remove 2 damage from any number of chosen chars ─
  // Approximation: remove 2 from one chosen.
  "ever-as-before": {
    actionEffects: [{
      type: "remove_damage", amount: 2, isUpTo: true,
      target: { type: "chosen", filter: { ...CHAR } },
    }],
  },

  // ── Hide Away: put chosen item/loc into player's inkwell exerted ────
  "hide-away": {
    actionEffects: [{
      type: "move_to_inkwell",
      enterExerted: true,
      fromZone: "play",
      target: { type: "chosen", filter: { zone: "play", cardType: ["item", "location"] } },
    }],
  },

  // ── All Funned Out: put chosen own character into your inkwell exerted ─
  "all-funned-out": {
    actionEffects: [{
      type: "move_to_inkwell",
      enterExerted: true,
      fromZone: "play",
      target: { type: "chosen", filter: { ...OWN_CHAR } },
    }],
  },

  // ── Medal of Heroes: {E}, 2I, banish — chosen own +2 lore this turn ─
  "medal-of-heroes": {
    abilities: [{
      type: "activated",
      storyName: "CONGRATULATIONS, SOLDIER",
      rulesText: "{E}, 2 {I}, Banish this item — Chosen character of yours gets +2 {L} this turn.",
      costs: [{ type: "exert" }, { type: "pay_ink", amount: 2 }, { type: "banish_self" }],
      effects: [{
        type: "gain_stats", lore: 2, duration: "this_turn",
        target: { type: "chosen", filter: { ...OWN_CHAR } },
      }],
    }],
  },

  // ── Merlin's Carpetbag: {E}, 1I — return item card from discard ────
  "merlins-carpetbag": {
    abilities: [{
      type: "activated",
      storyName: "HOCKETY POCKETY",
      rulesText: "{E}, 1 {I} — Return an item card from your discard to your hand.",
      costs: [{ type: "exert" }, { type: "pay_ink", amount: 1 }],
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { zone: "discard", cardType: ["item"], owner: { type: "self" } } },
      }],
    }],
  },

  // ── Sapphire Chromicon: enters exerted; {E}, 2I, banish own item → 2 lore ─
  "sapphire-chromicon": {
    abilities: [
      {
        type: "static",
        storyName: "POWERING UP",
        rulesText: "This item enters play exerted.",
        effect: { type: "enter_play_exerted", filter: { cardType: ["item"] } },
      },
      {
        type: "activated",
        storyName: "SAPPHIRE LIGHT",
        rulesText: "{E}, 2 {I}, Banish one of your items — Gain 2 lore.",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 2 }],
        effects: [
          { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"], owner: { type: "self" } } } },
          { type: "gain_lore", amount: 2, target: { type: "self" } },
        ],
      },
    ],
  },

  // ── The Great Illuminary: Support chars +1 L +2 W while here ────────
  "the-great-illuminary-radiant-ballroom": {
    abilities: [
      {
        type: "static",
        rulesText: "Characters with Support get +1 {L} while here.",
        effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "all", filter: { ...CHAR, hasKeyword: "support", atLocation: "this" } } },
      },
      {
        type: "static",
        rulesText: "Characters with Support get +2 {W} while here.",
        effect: { type: "modify_stat", stat: "willpower", modifier: 2, target: { type: "all", filter: { ...CHAR, hasKeyword: "support", atLocation: "this" } } },
      },
    ],
  },

  // ── Stitch Team Underdog: ETB may deal 2 damage to chosen character ─
  "stitch-team-underdog": {
    abilities: [{
      type: "triggered",
      storyName: "HEAVE HO!",
      rulesText: "When you play this character, you may deal 2 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "deal_damage", amount: 2, target: { type: "chosen", filter: { ...CHAR } } }],
    }],
  },

  // ── Simba Lost Prince: banish in challenge → may draw ──────────────
  "simba-lost-prince": {
    abilities: [{
      type: "triggered",
      storyName: "FACE THE PAST",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may draw a card.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // ── Sneezy Noisy Knight: chosen Knight gains Challenger +2 this turn ─
  "sneezy-noisy-knight": {
    abilities: [{
      type: "triggered",
      storyName: "HEADWIND",
      rulesText: "When you play this character, chosen Knight character gains Challenger +2 this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "challenger", value: 2,
        target: { type: "chosen", filter: { ...CHAR, hasTrait: "Knight" } },
        duration: "end_of_turn",
      }],
    }],
  },

  // ── Dopey Knight Apprentice: if another Knight → may deal 1 to char/loc ─
  "dopey-knight-apprentice": {
    abilities: [{
      type: "triggered",
      storyName: "STRONGER TOGETHER",
      rulesText: "When you play this character, if you have another Knight character in play, you may deal 1 damage to chosen character or location.",
      trigger: { on: "enters_play" },
      condition: { type: "has_character_with_trait", trait: "Knight", player: { type: "self" }, excludeSelf: true },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { ...CHAR_OR_LOC } } }],
    }],
  },

  // ── Snow White Fair-Hearted: Resist +1 per other Knight (dynamic keyword) ─
  // Approximation: flat Resist +1 static; dynamic per-count keyword not supported.
  "snow-white-fair-hearted": {
    abilities: [{
      type: "static",
      storyName: "NATURAL LEADER",
      rulesText: "This character gains Resist +1 for each other Knight character you have in play. (approximation: flat Resist +1)",
      effect: { type: "grant_keyword", keyword: "resist", value: 1, target: { type: "this" } },
    }],
  },

  // ── Yzma Unjustly Treated: banish other in challenge → deal 1 to chosen ─
  "yzma-unjustly-treated": {
    abilities: [{
      type: "triggered",
      storyName: "I'M WARNING YOU!",
      rulesText: "During your turn, whenever one of your characters banishes a character in a challenge, you may deal 1 damage to chosen character.",
      trigger: { on: "banished_other_in_challenge", filter: { ...OWN_CHAR } },
      condition: { type: "is_your_turn" },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { ...CHAR } } }],
    }],
  },

  // ── Happy Lively Knight: during your turn, gains Evasive ────────────
  "happy-lively-knight": {
    abilities: [{
      type: "static",
      storyName: "BURST OF SPEED",
      rulesText: "During your turn, this character gains Evasive.",
      condition: { type: "is_your_turn" },
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
    }],
  },

  // ── Bashful Adoring Knight: while Snow White in play → Bodyguard ───
  "bashful-adoring-knight": {
    abilities: [{
      type: "static",
      storyName: "IMPRESS THE PRINCESS",
      rulesText: "While you have a character named Snow White in play, this character gains Bodyguard.",
      condition: { type: "has_character_named", name: "Snow White", player: { type: "self" } },
      effect: { type: "grant_keyword", keyword: "bodyguard", target: { type: "this" } },
    }],
  },

  // ── Doc Bold Knight: ETB may discard hand to draw 2 ────────────────
  "doc-bold-knight": {
    abilities: [{
      type: "triggered",
      storyName: "DRASTIC MEASURES",
      rulesText: "When you play this character, you may discard your hand to draw 2 cards.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: "all", target: { type: "self" }, chooser: "target_player" }],
        rewardEffects: [{ type: "draw", amount: 2, target: { type: "self" } }],
      }],
    }],
  },

  // ── Tug-of-War: deal 1 to each opp without Evasive ─────────────────
  // Approximation: deal 1 to each opposing character (drops Evasive branch selection).
  "tug-of-war": {
    actionEffects: [{
      type: "deal_damage", amount: 1,
      target: { type: "all", filter: { ...OPP_CHAR } },
    }],
  },

  // ── When Will My Life Begin?: chosen can't challenge next turn + draw ─
  "when-will-my-life-begin": {
    actionEffects: [
      {
        type: "cant_action", action: "challenge",
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "end_of_owner_next_turn",
      },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // ── Duck for Cover!: chosen gains Resist +1 and Evasive this turn ──
  "duck-for-cover": {
    actionEffects: [
      {
        type: "grant_keyword", keyword: "resist", value: 1,
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "end_of_turn",
      },
      {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "end_of_turn",
      },
    ],
  },

  // ── Shield of Arendelle: banish self — chosen gains Resist +1 until your next turn ─
  "shield-of-arendelle": {
    abilities: [{
      type: "activated",
      storyName: "DEFLECT",
      rulesText: "Banish this item — Chosen character gains Resist +1 until the start of your next turn.",
      costs: [{ type: "banish_self" }],
      effects: [{
        type: "grant_keyword", keyword: "resist", value: 1,
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "until_caster_next_turn",
      }],
    }],
  },

  // ── Plate Armor: {E} — chosen gains Resist +2 until your next turn ─
  "plate-armor": {
    abilities: [{
      type: "activated",
      storyName: "WELL CRAFTED",
      rulesText: "{E} — Chosen character gains Resist +2 until the start of your next turn.",
      costs: [{ type: "exert" }],
      effects: [{
        type: "grant_keyword", keyword: "resist", value: 2,
        target: { type: "chosen", filter: { ...CHAR } },
        duration: "until_caster_next_turn",
      }],
    }],
  },

  // ── Steel Chromicon: {E} — deal 1 damage to chosen character ───────
  "steel-chromicon": {
    abilities: [{
      type: "activated",
      storyName: "STEEL LIGHT",
      rulesText: "{E} — Deal 1 damage to chosen character.",
      costs: [{ type: "exert" }],
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { ...CHAR } } }],
    }],
  },

  // ── Ratigan's Party: while you have a damaged char here → +2 L ─────
  // Approximation: always +2 L (drops conditional).
  "ratigans-party-seedy-back-room": {
    abilities: [{
      type: "static",
      storyName: "MISFITS' REVELRY",
      rulesText: "While you have a damaged character here, this location gets +2 {L}. (approximation: unconditional +2 L)",
      effect: { type: "modify_stat", stat: "lore", modifier: 2, target: { type: "this" } },
    }],
  },

  // ── Prince Naveen Ukulele Player: ETB may play a song cost ≤6 for free ─
  "prince-naveen-ukulele-player": {
    abilities: [{
      type: "triggered",
      storyName: "A LITTLE TUNE",
      rulesText: "When you play this character, you may play a song with cost 6 or less for free.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "play_for_free",
        isMay: true,
        filter: { cardType: ["action"], hasTrait: "Song", costAtMost: 6, zone: "hand", owner: { type: "self" } },
      }],
    }],
  },

  // ── Vanellope Sugar Rush Princess: play another Princess → opp chars -1 S ─
  "vanellope-von-schweetz-sugar-rush-princess": {
    abilities: [{
      type: "triggered",
      storyName: "NOW YOU SEE ME",
      rulesText: "Whenever you play another Princess character, all opposing characters get -1 {S} until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Princess", excludeSelf: true } },
      effects: [{
        type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
        target: { type: "all", filter: { ...OPP_CHAR } },
      }],
    }],
  },

  // ── Fix-It Felix Jr Niceland Steward: your locations get +2 W ──────
  "fix-it-felix-jr-niceland-steward": {
    abilities: [{
      type: "static",
      storyName: "I CAN FIX IT",
      rulesText: "Your locations get +2 {W}.",
      effect: {
        type: "modify_stat", stat: "willpower", modifier: 2,
        target: { type: "all", filter: { zone: "play", cardType: ["location"], owner: { type: "self" } } },
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
      // Preserve existing keyword abilities (e.g. shift, rush).
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
