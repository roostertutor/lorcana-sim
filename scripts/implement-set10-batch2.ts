#!/usr/bin/env node
// Set 10 — Batch 2: more triggers, statics, locations, items, songs.
// Approximations noted inline. Skipped cards (DEFERRED or too complex):
//   - hades-looking-for-a-deal: opponent-chosen-return branch.
//   - nana-canine-caregiver: sequential discard-then-bounce works but multi-cost filter tricky — wired.
//   - gaston-frightful-bully: cant_challenge + must_quest_if_able — partial (cant_action challenge).
//   - lady-tremaine-sinister-socialite: play-from-discard-to-bottom-of-deck — skipped.
//   - ingenious-device activated: skipped (use triggered banish side only).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-010.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── "Your other X characters" Champions & statics ─────────────
  "minnie-mouse-amethyst-champion": {
    abilities: [{
      type: "triggered",
      storyName: "AMETHYST CHAMPION",
      rulesText: "Whenever one of your other Amethyst characters is banished in a challenge, you may draw a card.",
      trigger: { on: "banished_in_challenge", filter: { ...OWN_OTHER_CHARS, inkColor: "amethyst" } },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "goofy-emerald-champion": {
    abilities: [
      {
        type: "triggered",
        storyName: "EMERALD CHAMPION",
        rulesText: "Whenever one of your other Emerald characters is challenged and banished, banish the challenging character.",
        trigger: { on: "banished_in_challenge", filter: { ...OWN_OTHER_CHARS, inkColor: "emerald" } },
        effects: [{ type: "banish", target: { type: "challenger" } }],
      },
      {
        type: "static",
        storyName: "EMERALD WARD",
        rulesText: "Your other Emerald characters gain Ward.",
        effect: {
          type: "grant_keyword", keyword: "ward",
          target: { type: "all", filter: { ...OWN_OTHER_CHARS, inkColor: "emerald" } },
        },
      },
    ],
  },

  "pluto-steel-champion": {
    abilities: [
      {
        type: "triggered",
        storyName: "STEEL CHAMPION",
        rulesText: "During your turn, whenever one of your other Steel characters banishes another character in a challenge, gain 2 lore.",
        trigger: { on: "banished_other_in_challenge", filter: { ...OWN_OTHER_CHARS, inkColor: "steel" } },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 2, target: SELF }],
      },
      {
        type: "triggered",
        storyName: "STEEL SMASH",
        rulesText: "Whenever you play another Steel character, you may banish chosen item.",
        trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, inkColor: "steel" } },
        effects: [{
          type: "banish", isMay: true,
          target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
        }],
      },
    ],
  },

  // ── Quest triggers ────────────────────────────────────────────
  "gaston-frightful-bully": {
    abilities: [{
      type: "triggered",
      storyName: "INTIMIDATION",
      rulesText: "Whenever this character quests, if there's a card under him, chosen opposing character can't challenge during their next turn.",
      // Approximation: drop must-quest-if-able half.
      trigger: { on: "quests" },
      condition: { type: "this_has_cards_under" },
      effects: [{
        type: "cant_action", action: "challenge",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "goofy-galumphing-gumshoe": {
    abilities: [
      {
        type: "triggered",
        storyName: "GALUMPH ETB",
        rulesText: "When you play this character, each opposing character gets -1 {S} until the start of your next turn.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
          target: { type: "all", filter: ALL_OPP_CHARS },
        }],
      },
      {
        type: "triggered",
        storyName: "GALUMPH QUEST",
        rulesText: "Whenever he quests, each opposing character gets -1 {S} until the start of your next turn.",
        trigger: { on: "quests" },
        effects: [{
          type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
          target: { type: "all", filter: ALL_OPP_CHARS },
        }],
      },
    ],
  },

  "gazelle-ballad-singer": {
    abilities: [{
      type: "triggered",
      storyName: "BALLAD",
      rulesText: "When you play this character, you may put a song card from your discard on the top of your deck.",
      // Approximation: return to hand instead of top of deck.
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", hasTrait: "Song" } },
      }],
    }],
  },

  "della-duck-returning-mother": {
    abilities: [{
      type: "triggered",
      storyName: "MOMS RETURN",
      rulesText: "When you play this character, you may ready chosen character with Boost. If you do, they can't quest or challenge for the rest of this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasKeyword: "boost" } },
        followUpEffects: [
          { type: "cant_action", action: "quest", duration: "end_of_turn", target: { type: "this" } },
          { type: "cant_action", action: "challenge", duration: "end_of_turn", target: { type: "this" } },
        ],
      }],
    }],
  },

  "the-horned-king-wicked-ruler": {
    abilities: [{
      type: "triggered",
      storyName: "WICKED RULE",
      rulesText: "Whenever one of your other characters is banished in a challenge, you may return that card to your hand, then choose and discard a card.",
      // Approximation: return triggering card works via banished target.
      trigger: { on: "banished_in_challenge", filter: OWN_OTHER_CHARS },
      effects: [
        {
          type: "return_to_hand", isMay: true,
          target: { type: "triggering_card" },
        },
        { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
      ],
    }],
  },

  "coldstone-reincarnated-cyborg": {
    abilities: [{
      type: "triggered",
      storyName: "GARGOYLE LEGACY",
      rulesText: "When you play this character, if you have 2 or more Gargoyle character cards in your discard, gain 2 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "cards_in_zone_gte", zone: "discard", amount: 2, player: SELF, cardType: ["character"],
      },
      effects: [{ type: "gain_lore", amount: 2, target: SELF }],
    }],
  },

  "nana-canine-caregiver": {
    abilities: [{
      type: "triggered",
      storyName: "CAREGIVER",
      rulesText: "When you play this character, you may choose and discard a card to return chosen character with cost 2 or less to their player's hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" }],
        rewardEffects: [{
          type: "return_to_hand",
          target: { type: "chosen", filter: { ...ANY_CHAR, maxCost: 2 } },
        }],
      }],
    }],
  },

  "magica-de-spell-conniving-sorceress": {
    abilities: [{
      type: "triggered",
      storyName: "SHIFTED DRAW",
      rulesText: "When you play this character, if you used Shift to play her, you may draw 4 cards.",
      trigger: { on: "enters_play" },
      condition: { type: "played_via_shift" },
      effects: [{ type: "draw", amount: 4, isMay: true, target: SELF }],
    }],
  },

  "demona-scourge-of-the-wyvern-clan": {
    abilities: [{
      type: "triggered",
      storyName: "WYVERN SCOURGE",
      rulesText: "When you play this character, exert all opposing characters.",
      // Approximation: drop "draw until 3" half.
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "all", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  // ── Items ─────────────────────────────────────────────────────
  "grimorum-arcanorum": {
    abilities: [
      {
        type: "triggered",
        storyName: "EXERT DRAIN",
        rulesText: "During your turn, whenever an opposing character becomes exerted, gain 1 lore.",
        // Note: we don't have "becomes exerted" trigger; approximation: on opponent's char challenge.
        trigger: { on: "challenge_initiated", filter: ALL_OPP_CHARS },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
      {
        type: "static",
        storyName: "DEMONA RUSH",
        rulesText: "Your characters named Demona gain Rush.",
        effect: {
          type: "grant_keyword", keyword: "rush",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, name: "Demona" } },
        },
      },
    ],
  },

  "potion-of-malice": {
    abilities: [{
      type: "triggered",
      storyName: "MALICE",
      rulesText: "Put 1 damage counter on chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1, asDamageCounter: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "enigmatic-inkcaster": {
    abilities: [{
      type: "triggered",
      storyName: "INKCAST",
      rulesText: "If you've played 2 or more cards this turn, gain 1 lore.",
      // Approximation: no per-turn-play count; drop condition.
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "the-sword-of-hercules": {
    abilities: [
      {
        type: "triggered",
        storyName: "GODSLAYER",
        rulesText: "When you play this item, banish chosen opposing Deity character.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "banish",
          target: { type: "chosen", filter: { ...ALL_OPP_CHARS, hasTrait: "Deity" } },
        }],
      },
      {
        type: "triggered",
        storyName: "HEROIC VICTORY",
        rulesText: "During your turn, whenever one of your characters banishes another character in a challenge, gain 1 lore.",
        trigger: { on: "banished_other_in_challenge", filter: ALL_OWN_CHARS },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
    ],
  },

  "the-robot-queen": {
    abilities: [{
      type: "triggered",
      storyName: "ROBOT STRIKE",
      rulesText: "Whenever you play a character, you may pay 1 {I} and banish this item to deal 2 damage to chosen character.",
      // Approximation: dropped cost; triggers on own-char play.
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF } },
      effects: [{
        type: "deal_damage", amount: 2, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  // ── Locations ─────────────────────────────────────────────────
  "duckburg-funsos-funzone": {
    abilities: [{
      type: "triggered",
      storyName: "FUNZONE",
      rulesText: "Whenever a character quests while here, you pay 2 less for the next character you play this turn.",
      trigger: { on: "quests", filter: { cardType: ["character"], atLocation: "this" } },
      effects: [{
        type: "grant_cost_reduction", amount: 2, filter: { cardType: ["character"] },
      }],
    }],
  },

  "the-great-illuminary-abandoned-laboratory": {
    abilities: [{
      type: "static",
      storyName: "RESEARCH",
      rulesText: "Characters gain \"{E} — Draw a card\" while here.",
      effect: {
        type: "grant_activated_ability",
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
        ability: {
          type: "activated",
          storyName: "RESEARCH",
          rulesText: "{E} — Draw a card.",
          costs: [{ type: "exert" }],
          effects: [{ type: "draw", amount: 1, target: SELF }],
        },
      },
    }],
  },

  "the-bitterwood-underground-forest": {
    abilities: [{
      type: "triggered",
      storyName: "GATHER RESOURCES",
      rulesText: "Once during your turn, whenever you move a character with 5 {S} or more here, you may draw a card.",
      // Approximation: no once-per-turn on triggered; engine fires every move.
      trigger: { on: "moves_to_location", filter: { ...ALL_OWN_CHARS, minStrength: 5, atLocation: "this" } },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "sleepy-hollow-the-bridge": {
    abilities: [{
      type: "triggered",
      storyName: "BRIDGE ESCAPE",
      rulesText: "Whenever a character quests while here, you may banish this location to gain 2 lore and give them Evasive until the start of your next turn.",
      trigger: { on: "quests", filter: { cardType: ["character"], atLocation: "this" } },
      effects: [{
        type: "sequential", isMay: true,
        costEffects: [{ type: "banish", target: { type: "this" } }],
        rewardEffects: [
          { type: "gain_lore", amount: 2, target: SELF },
          {
            type: "grant_keyword", keyword: "evasive",
            duration: "until_caster_next_turn",
            target: { type: "triggering_card" },
          },
        ],
      }],
    }],
  },

  "castle-of-the-horned-king-bastion-of-evil": {
    abilities: [{
      type: "triggered",
      storyName: "INTO THE GLOOM",
      rulesText: "Once during your turn, whenever a character quests while here, you may ready chosen item.",
      trigger: { on: "quests", filter: { cardType: ["character"], atLocation: "this" } },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "zootopia-police-headquarters": {
    abilities: [{
      type: "triggered",
      storyName: "NEW INFORMATION",
      rulesText: "Once during your turn, whenever you move a character here, you may draw a card, then choose and discard a card.",
      trigger: { on: "moves_to_location", filter: { ...ALL_OWN_CHARS, atLocation: "this" } },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
      ],
    }],
  },

  "illuminary-tunnels-linked-caverns": {
    abilities: [
      {
        type: "static",
        storyName: "LINKED LORE",
        rulesText: "While you have a character here, this location gets +1 {L} for each other location you have in play.",
        // Approximation: drop "character here" gate.
        effect: {
          type: "modify_stat_per_count", stat: "lore", perCount: 1,
          countZone: "play", countOwner: SELF, countFilter: { cardType: ["location"] },
          target: { type: "this" },
        },
      },
    ],
  },

  // ── Other character triggers ──────────────────────────────────
  "raksha-fearless-mother": {
    abilities: [{
      type: "static",
      storyName: "ON PATROL",
      rulesText: "Once during your turn, you may pay 1 {I} less to move this character to a location.",
      effect: {
        type: "move_to_self_cost_reduction", amount: 1,
        filter: { type: "this" } as any,
      },
    }],
  },

  "rama-vigilant-father": {
    abilities: [{
      type: "triggered",
      storyName: "VIGILANT",
      rulesText: "Whenever you play another character with 5 {S} or more, you may ready this character. If you do, he can't quest for the rest of this turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, minStrength: 5 } },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "this" },
        followUpEffects: [{
          type: "cant_action", action: "quest", duration: "end_of_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "beast-aggressive-lord": {
    abilities: [{
      type: "triggered",
      storyName: "RAGE",
      rulesText: "Whenever he challenges another character, if there's a card under this character, each opponent loses 1 lore and you gain 1 lore.",
      trigger: { on: "challenge_initiated" },
      condition: { type: "this_has_cards_under" },
      effects: [
        { type: "lose_lore", amount: 1, target: OPP },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  "david-xanatos-charismatic-leader": {
    abilities: [
      {
        type: "triggered",
        storyName: "CHARISMA",
        rulesText: "During your turn, whenever one of your characters is banished, draw a card.",
        trigger: { on: "is_banished", filter: ALL_OWN_CHARS },
        condition: { type: "is_your_turn" },
        effects: [{ type: "draw", amount: 1, target: SELF }],
      },
      {
        type: "triggered",
        storyName: "LEAD CHARGE",
        rulesText: "Whenever this character quests, chosen character gains Rush this turn.",
        trigger: { on: "quests" },
        effects: [{
          type: "grant_keyword", keyword: "rush", duration: "this_turn",
          target: { type: "chosen", filter: ANY_CHAR },
        }],
      },
    ],
  },

  "goliath-guardian-of-castle-wyvern": {
    abilities: [{
      type: "triggered",
      storyName: "GUARD THE CLAN",
      rulesText: "Whenever one of your Gargoyle characters challenges another character, gain 1 lore.",
      trigger: { on: "challenge_initiated", filter: { ...ALL_OWN_CHARS, hasTrait: "Gargoyle" } },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "brom-bones-burly-bully": {
    abilities: [{
      type: "triggered",
      storyName: "BURLY",
      rulesText: "Whenever this character challenges a character with 2 {S} or less, each opponent loses 1 lore.",
      trigger: { on: "challenge_initiated", filter: { ...ANY_CHAR, maxStrength: 2 } },
      effects: [{ type: "lose_lore", amount: 1, target: OPP }],
    }],
  },

  "mother-gothel-underhanded-schemer": {
    abilities: [{
      type: "static",
      storyName: "SOMEBODYS GOT TO USE IT",
      rulesText: "If a character was banished this turn, this character gets +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: { type: "a_character_was_banished_in_challenge_this_turn" },
      },
    }],
  },

  "mulan-standing-her-ground": {
    abilities: [{
      type: "static",
      storyName: "STANDING GROUND",
      rulesText: "During your turn, if you've put a card under one of your characters or locations this turn, this character takes no damage from challenges.",
      // Approximation: always challenge-damage-immune during your turn.
      effect: {
        type: "damage_immunity_static", source: "challenge",
        target: { type: "this" },
      },
    }],
  },

  "aladdin-barreling-through": {
    abilities: [{
      type: "static",
      storyName: "BARRELING",
      rulesText: "While there's a card under this character, your characters with Reckless gain \"{E} — Gain 1 lore.\"",
      effect: {
        type: "grant_activated_ability",
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasKeyword: "reckless" } },
        condition: { type: "this_has_cards_under" },
        ability: {
          type: "activated",
          storyName: "RECKLESS LORE",
          rulesText: "{E} — Gain 1 lore.",
          costs: [{ type: "exert" }],
          effects: [{ type: "gain_lore", amount: 1, target: SELF }],
        },
      },
    }],
  },

  "hans-brazen-manipulator": {
    abilities: [
      {
        type: "static",
        storyName: "JOSTLING FOR POWER",
        rulesText: "King and Queen characters can't quest.",
        effect: {
          type: "action_restriction", restricts: "quest",
          target: { type: "all", filter: { cardType: ["character"], hasTrait: "King" } },
        },
      },
      {
        type: "static",
        storyName: "JOSTLING FOR POWER 2",
        rulesText: "Queen characters can't quest.",
        effect: {
          type: "action_restriction", restricts: "quest",
          target: { type: "all", filter: { cardType: ["character"], hasTrait: "Queen" } },
        },
      },
      {
        type: "triggered",
        storyName: "GROWING INFLUENCE",
        rulesText: "At the start of your turn, if an opponent has 2 or more ready characters in play, gain 2 lore.",
        trigger: { on: "turn_start", player: SELF },
        condition: { type: "characters_in_play_gte", amount: 2, player: OPP },
        effects: [{ type: "gain_lore", amount: 2, target: SELF }],
      },
    ],
  },

  "basil-tenacious-mouse": {
    abilities: [{
      type: "triggered",
      storyName: "TENACIOUS",
      rulesText: "Whenever you play another Detective character, this character gains Resist +1 until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, hasTrait: "Detective" } },
      effects: [{
        type: "grant_keyword", keyword: "resist", value: 1,
        duration: "until_caster_next_turn",
        target: { type: "this" },
      }],
    }],
  },

  "nick-wilde-persistent-investigator": {
    abilities: [{
      type: "triggered",
      storyName: "PERSISTENT",
      rulesText: "During your turn, whenever one of your Detective characters banishes another character in a challenge, draw a card.",
      trigger: {
        on: "banished_other_in_challenge",
        filter: { ...ALL_OWN_CHARS, hasTrait: "Detective" },
      },
      condition: { type: "is_your_turn" },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "judy-hopps-on-the-case": {
    abilities: [{
      type: "triggered",
      storyName: "ON THE CASE",
      rulesText: "When you play this character, if you have another Detective character in play, you may put chosen item into its player's inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...OWN_OTHER_CHARS, hasTrait: "Detective" },
      },
      effects: [{
        type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "play",
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "pluto-clever-cluefinder": {
    abilities: [{
      type: "triggered",
      storyName: "CLUEFINDER",
      rulesText: "If you have a Detective character in play, return an item card from your discard to your hand. Otherwise, put it on the top of your deck.",
      // Approximation: unconditional return-to-hand from discard.
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["item"] } },
      }],
    }],
  },

  "the-twins-lost-boys": {
    abilities: [{
      type: "triggered",
      storyName: "LOST BOY STRIKE",
      rulesText: "When you play this character, if you have a location in play, you may deal 2 damage to chosen character.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { owner: SELF, zone: "play", cardType: ["location"] },
      },
      effects: [{
        type: "deal_damage", amount: 2, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "cri-kee-good-luck-charm": {
    // Alert keyword — already keyword ability, probably already present. Skip.
  },

  "akela-forest-runner": {
    // "gets +1 {S} this turn" appears to be just the second line of a modal. Skip as unknown.
  },

  "shere-khan-fierce-and-furious": {
    // WILD RAGE activated ability
    abilities: [{
      type: "activated",
      storyName: "WILD RAGE",
      rulesText: "1 {I}, Deal 1 damage to this character — Ready this character. He can't quest for the rest of this turn.",
      costs: [
        { type: "ink", amount: 1 },
        // damage-self cost not a standard activated cost; approximation: drop.
      ],
      effects: [{
        type: "ready",
        target: { type: "this" },
        followUpEffects: [{
          type: "cant_action", action: "quest", duration: "end_of_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  // ── Actions ───────────────────────────────────────────────────
  "search-for-clues": {
    actionEffects: [
      { type: "discard_from_hand", amount: 2, target: OPP, chooser: "target_player" },
      // Approximation: drop "player with most cards" targeting + conditional gain.
    ],
  },

  "cant-hold-it-back-anymore": {
    actionEffects: [{
      type: "exert",
      target: { type: "chosen", filter: ALL_OPP_CHARS },
      // Approximation: drop "move all damage" rider.
    }],
  },

  "trust-in-me": {
    // Modal song — approximation: default to discard 2 branch.
    actionEffects: [{
      type: "discard_from_hand", amount: 2, target: OPP, chooser: "target_player",
    }],
  },

  "get-to-safety": {
    actionEffects: [{
      type: "play_for_free", sourceZone: "discard",
      filter: { cardType: ["location"], maxCost: 3 },
    }],
  },

  "time-to-go": {
    actionEffects: [{
      type: "sequential",
      costEffects: [{ type: "banish", target: { type: "chosen", filter: ALL_OWN_CHARS } }],
      rewardEffects: [{ type: "draw", amount: 2, target: SELF }],
    }],
  },

  "promising-lead": {
    actionEffects: [
      {
        type: "gain_stats", lore: 1, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      {
        type: "grant_keyword", keyword: "support", duration: "end_of_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
    ],
  },

  "sudden-scare": {
    actionEffects: [{
      type: "move_to_inkwell", enterExerted: true, fromZone: "play",
      target: { type: "chosen", filter: ALL_OPP_CHARS },
    }],
  },

  "spooky-sight": {
    actionEffects: [{
      type: "move_to_inkwell", enterExerted: true, fromZone: "play",
      target: { type: "all", filter: { ...ANY_CHAR, maxCost: 3 } },
    }],
  },

  "putting-it-all-together": {
    actionEffects: [
      {
        type: "cant_action", action: "challenge", duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "he-hurled-his-thunderbolt": {
    actionEffects: [
      {
        type: "deal_damage", amount: 4,
        target: { type: "chosen", filter: ANY_CHAR },
      },
      {
        type: "grant_keyword", keyword: "challenger", value: 2, duration: "end_of_turn",
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Deity" } },
      },
    ],
  },

  "the-games-afoot": {
    // Move 2 chars — multi-character-move deferred. Approximation: single move + resist grant.
    actionEffects: [{
      type: "move_character",
      character: { type: "chosen", filter: ALL_OWN_CHARS },
      location: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["location"] } },
    }],
  },

  // ── Items ─────────────────────────────────────────────────────
  "junior-woodchuck-guidebook": {
    abilities: [{
      type: "activated",
      storyName: "GUIDEBOOK",
      rulesText: "{E}, 1 {I}, Banish this item — Draw 2 cards.",
      costs: [
        { type: "exert" },
        { type: "ink", amount: 1 },
        { type: "banish_self" },
      ],
      effects: [{ type: "draw", amount: 2, target: SELF }],
    }],
  },

  "detectives-badge": {
    abilities: [{
      type: "triggered",
      storyName: "BADGE",
      rulesText: "Chosen character gains Resist +1 and the Detective classification until the start of your next turn.",
      // Approximation: drop classification-grant (not a primitive).
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "resist", value: 1,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "ink-amplifier": {
    abilities: [{
      type: "triggered",
      storyName: "AMPLIFY",
      rulesText: "Whenever an opponent draws a card during their turn, if it's the second card they've drawn this turn, you may put the top card of your deck into your inkwell facedown and exerted.",
      // Approximation: drop "second card" condition.
      trigger: { on: "card_drawn", filter: { owner: OPP } as any },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  "fairy-godmothers-wand": {
    abilities: [{
      type: "triggered",
      storyName: "BIBBIDI WARD",
      rulesText: "During your turn, whenever you put a card into your inkwell, chosen Princess character of yours gains Ward until the start of your next turn.",
      trigger: { on: "card_put_in_inkwell", filter: { owner: SELF } as any },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "grant_keyword", keyword: "ward",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: { ...ALL_OWN_CHARS, hasTrait: "Princess" } },
      }],
    }],
  },
};

// Drop entries with no content
for (const k of Object.keys(patches)) {
  const p = patches[k];
  if (!p.abilities && !p.actionEffects) delete patches[k];
}

const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
const seen = new Set<string>();
const missing: string[] = [];
for (const id of Object.keys(patches)) {
  if (!cards.find((c: any) => c.id === id)) missing.push(id);
}
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 10.`);
if (missing.length) {
  console.log(`\nMISSING IDs:`);
  missing.forEach(m => console.log(`  - ${m}`));
}
