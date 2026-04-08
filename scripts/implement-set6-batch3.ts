#!/usr/bin/env node
// Set 6 — Batch 3: Remaining fits-grammar — ETBs, statics, activated items,
// start-of-turn triggers, song triggers, quest triggers, simple actions.
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
const TURN_START_SELF = { on: "turn_start" as const, player: SELF };
const TURN_END_SELF = { on: "turn_end" as const, player: SELF };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Start-of-turn triggers ──────────────────────────────────────
  "john-silver-stern-captain": {
    abilities: [{
      type: "triggered",
      storyName: "DON'T JUST SIT THERE!",
      rulesText: "At the start of your turn, deal 1 damage to each opposing ready character.",
      trigger: TURN_START_SELF,
      effects: [{
        type: "deal_damage", amount: 1,
        target: { type: "all", filter: { ...ALL_OPP_CHARS, isExerted: false } },
      }],
    }],
  },

  "vanellope-von-schweetz-gutsy-go-getter": {
    abilities: [{
      type: "triggered",
      storyName: "AS READY AS I'LL EVER BE",
      rulesText: "At the start of your turn, if this character is at a location, draw a card and gain 1 lore.",
      trigger: TURN_START_SELF,
      condition: { type: "this_at_location" },
      effects: [
        { type: "draw", amount: 1, target: SELF },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  // ── End-of-turn triggers ────────────────────────────────────────
  "judy-hopps-resourceful-rabbit": {
    abilities: [{
      type: "triggered",
      storyName: "NEED SOME HELP?",
      rulesText: "At the end of your turn, you may ready another chosen character of yours.",
      trigger: TURN_END_SELF,
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  "simba-pride-protector": {
    abilities: [{
      type: "triggered",
      storyName: "UNDERSTAND THE BALANCE",
      rulesText: "At the end of your turn, if this character is exerted, you may ready your other characters.",
      trigger: TURN_END_SELF,
      condition: { type: "this_is_exerted" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "all", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  // ── ETB ─────────────────────────────────────────────────────────
  "pleakley-scientific-expert": {
    abilities: [{
      type: "triggered",
      storyName: "REPORTING FOR DUTY",
      rulesText: "When you play this character, put chosen character of yours into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_to_inkwell", enterExerted: true,
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "scar-heartless-hunter": {
    abilities: [{
      type: "triggered",
      storyName: "BARED TEETH",
      rulesText: "When you play this character, deal 2 damage to chosen character of yours to deal 2 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        costEffects: [{
          type: "deal_damage", amount: 2,
          target: { type: "chosen", filter: ALL_OWN_CHARS },
        }],
        rewardEffects: [{
          type: "deal_damage", amount: 2,
          target: { type: "chosen", filter: ANY_CHAR },
        }],
      }],
    }],
  },

  "stitch-alien-buccaneer": {
    abilities: [{
      type: "triggered",
      storyName: "READY FOR ACTION",
      rulesText: "When you play this character, if you used Shift to play him, you may put an action card from your discard on the top of your deck.",
      trigger: { on: "enters_play" },
      condition: { type: "played_via_shift" },
      effects: [{
        type: "return_to_hand", isMay: true,
        // approximation: return to hand instead of top of deck
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["action"] } },
      }],
    }],
  },

  "jasmine-royal-commodore": {
    abilities: [{
      type: "triggered",
      storyName: "RULER OF THE SEAS",
      rulesText: "When you play this character, if you used Shift to play her, return all other exerted characters to their players' hands.",
      trigger: { on: "enters_play" },
      condition: { type: "played_via_shift" },
      effects: [{
        type: "return_to_hand",
        target: { type: "all", filter: { ...ANY_CHAR, isExerted: true, excludeSelf: true } },
      }],
    }],
  },

  "moana-kakamora-leader": {
    abilities: [{
      type: "triggered",
      storyName: "GATHERING FORCES",
      // approximation: move-as-effect with any-number multi-target unsupported; single move + lore
      rulesText: "When you play this character, you may move any number of your characters to the same location for free. Gain 1 lore for each character you moved. (approximation: one character moved)",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "move_character",
          character: { type: "chosen", filter: ALL_OWN_CHARS },
          location: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["location"] } },
        }],
        rewardEffects: [{ type: "gain_lore", amount: 1, target: SELF }],
      }],
    }],
  },

  "baymax-armored-companion": {
    abilities: [
      {
        type: "triggered",
        storyName: "THE TREATMENT IS WORKING",
        rulesText: "When you play this character, you may remove up to 2 damage from another chosen character of yours. Gain 1 lore for each 1 damage removed this way. (approximation: fixed 1 lore on heal)",
        trigger: { on: "enters_play" },
        effects: [{
          type: "sequential",
          isMay: true,
          costEffects: [{
            type: "remove_damage", amount: 2, isUpTo: true,
            target: { type: "chosen", filter: OWN_OTHER_CHARS },
          }],
          rewardEffects: [{ type: "gain_lore", amount: 1, target: SELF }],
        }],
      },
      {
        type: "triggered",
        storyName: "THE TREATMENT IS WORKING (quest)",
        rulesText: "Whenever he quests, you may remove up to 2 damage from another chosen character of yours. Gain 1 lore for each 1 damage removed this way. (approximation: fixed 1 lore on heal)",
        trigger: { on: "quests" },
        effects: [{
          type: "sequential",
          isMay: true,
          costEffects: [{
            type: "remove_damage", amount: 2, isUpTo: true,
            target: { type: "chosen", filter: OWN_OTHER_CHARS },
          }],
          rewardEffects: [{ type: "gain_lore", amount: 1, target: SELF }],
        }],
      },
    ],
  },

  // ── Quest triggers ──────────────────────────────────────────────
  "mad-hatter-eccentric-host": {
    abilities: [{
      type: "triggered",
      storyName: "WE'LL HAVE TO LOOK INTO THIS",
      rulesText: "Whenever this character quests, you may look at the top card of chosen player's deck. Put it on top of their deck or into their discard.",
      trigger: { on: "quests" },
      effects: [{
        type: "look_at_top", count: 1,
        action: "up_to_n_to_discard_rest_top",
        maxToHand: 0,
        target: { type: "chosen_player" },
      }],
    }],
  },

  "john-silver-ferocious-friend": {
    abilities: [{
      type: "triggered",
      storyName: "YOU HAVE TO CHART YOUR OWN COURSE",
      rulesText: "Whenever this character quests, you may deal 1 damage to one of your other characters. If you do, ready that character. They cannot quest this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "deal_damage", amount: 1,
          target: { type: "chosen", filter: OWN_OTHER_CHARS },
        }],
        rewardEffects: [{
          type: "ready",
          target: { type: "triggering_card" },
          followUpEffects: [{
            type: "cant_action", action: "quest",
            duration: "this_turn",
            target: { type: "this" },
          }],
        }],
      }],
    }],
  },

  "yokai-scientific-supervillain": {
    abilities: [{
      type: "triggered",
      storyName: "TECHNICAL GAIN",
      rulesText: "Whenever this character quests, draw a card for each opposing character with {S}. (approximation: draw one card)",
      trigger: { on: "quests" },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "yokai-enigmatic-inventor": {
    abilities: [{
      type: "triggered",
      storyName: "TIME TO UPGRADE",
      rulesText: "Whenever this character quests, you may return one of your items to your hand to pay 2 {I} less for the next item you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "return_to_hand",
          target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } },
        }],
        rewardEffects: [{
          type: "grant_cost_reduction", amount: 2,
          filter: { cardType: ["item"] },
        }],
      }],
    }],
  },

  "daisy-duck-pirate-captain": {
    abilities: [{
      type: "triggered",
      storyName: "DISTANT SHORES",
      rulesText: "Whenever one of your Pirate characters quests while at a location, draw a card.",
      trigger: {
        on: "quests",
        filter: { ...ALL_OWN_CHARS, hasTrait: "Pirate", atLocation: "any" },
      },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "maui-half-shark": {
    abilities: [
      {
        type: "triggered",
        storyName: "CHEEEEOHOOOO!",
        rulesText: "Whenever this character challenges another character, you may return an action card from your discard to your hand.",
        trigger: { on: "challenges" },
        effects: [{
          type: "return_to_hand", isMay: true,
          target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["action"] } },
        }],
      },
      {
        type: "triggered",
        storyName: "WAYFINDING",
        rulesText: "Whenever you play an action, gain 1 lore.",
        trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
    ],
  },

  // ── Song triggers ──────────────────────────────────────────────
  "mama-odie-solitary-sage": {
    abilities: [{
      type: "triggered",
      storyName: "I HAVE TO DO EVERYTHING AROUND HERE",
      rulesText: "Whenever you play a song, you may move up to 2 damage counters from chosen character to chosen opposing character.",
      trigger: { on: "card_played", filter: { cardType: ["action"], hasTrait: "Song", owner: SELF } },
      effects: [{
        type: "move_damage", amount: 2, isUpTo: true, isMay: true,
        source: { type: "chosen", filter: ANY_CHAR },
        destination: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  // ── Challenged-while-exerted ───────────────────────────────────
  "tiana-restaurant-owner": {
    abilities: [{
      type: "triggered",
      storyName: "SPECIAL RESERVATION",
      // approximation: unconditional -3 str when challenged while exerted; pay-to-avoid unsupported.
      rulesText: "Whenever a character of yours is challenged while this character is exerted, the challenging character gets -3 {S} this turn unless their player pays 3 {I}. (approximation: unconditional -3 str)",
      trigger: { on: "is_challenged", filter: ALL_OWN_CHARS },
      condition: { type: "this_is_exerted" },
      effects: [{
        type: "gain_stats", strength: -3,
        target: { type: "challenging_character" },
      }],
    }],
  },

  // ── Basil (inkwell) ────────────────────────────────────────────
  "basil-disguised-detective": {
    abilities: [{
      type: "triggered",
      storyName: "TWISTS AND TURNS",
      // approximation: unconditional opponent discards a card
      rulesText: "During your turn, whenever a card is put into your inkwell, you may pay 1 {I} to have chosen opponent choose and discard a card. (approximation: free discard)",
      trigger: { on: "ink_played", player: SELF },
      effects: [{
        type: "discard_from_hand", amount: 1, isMay: true,
        target: OPP,
      }],
    }],
  },

  // ── Banished-other / damage deal triggers ─────────────────────
  "tadashi-hamada-gifted-roboticist": {
    abilities: [{
      type: "triggered",
      storyName: "SOMEONE HAS TO HELP",
      rulesText: "During an opponent's turn, when this character is banished, you may put the top card of your deck into your inkwell facedown. Then, put this card into your inkwell facedown. (approximation: ink top card only)",
      trigger: { on: "is_banished" },
      condition: { type: "compound_not", inner: { type: "is_your_turn" } },
      effects: [{
        type: "look_at_top", count: 1, action: "all_to_inkwell",
        target: SELF, isMay: true,
      }],
    }],
  },

  // ── Statics ────────────────────────────────────────────────────
  "chief-bogo-gazelle-fan": {
    abilities: [{
      type: "static",
      storyName: "YOU LIKE GAZELLE TOO?",
      rulesText: "While you have a character named Gazelle in play, this character gains Singer 6.",
      effect: {
        type: "grant_keyword", keyword: "singer", keywordValue: 6,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Gazelle" },
        },
      },
    }],
  },

  "chip-ranger-leader": {
    abilities: [{
      type: "static",
      storyName: "THE VALUE OF FRIENDSHIP",
      rulesText: "While you have a character named Dale in play, this character gains Support.",
      effect: {
        type: "grant_keyword", keyword: "support",
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Dale" },
        },
      },
    }],
  },

  "mr-smee-steadfast-mate": {
    abilities: [{
      type: "static",
      storyName: "GOOD CATCH",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "dale-friend-in-need": {
    abilities: [{
      type: "triggered",
      storyName: "CHIP'S PARTNER",
      rulesText: "This character enters play exerted unless you have a character named Chip in play.",
      trigger: { on: "enters_play" },
      condition: {
        type: "compound_not",
        inner: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Chip" },
        },
      },
      effects: [{ type: "exert", target: { type: "this" } }],
    }],
  },

  // ── Activated abilities ────────────────────────────────────────
  "nani-caring-sister": {
    abilities: [{
      type: "activated",
      storyName: "I AM SO SORRY",
      rulesText: "2 {I} - Chosen character gets -1 {S} until the start of your next turn.",
      costs: [],
      costEffects: [{ type: "pay_ink", amount: 2 }],
      effects: [{
        type: "gain_stats", strength: -1,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "stitch-little-trickster": {
    abilities: [{
      type: "activated",
      storyName: "NEED A HAND?",
      rulesText: "1 {I} - This character gets +1 {S} this turn.",
      costs: [],
      costEffects: [{ type: "pay_ink", amount: 1 }],
      effects: [{
        type: "gain_stats", strength: 1,
        target: { type: "this" },
      }],
    }],
  },

  "hercules-baby-demigod": {
    abilities: [{
      type: "activated",
      storyName: "STRONG LIKE HIS DAD",
      rulesText: "3 {I} - Deal 1 damage to chosen damaged character.",
      costs: [],
      costEffects: [{ type: "pay_ink", amount: 3 }],
      effects: [{
        type: "deal_damage", amount: 1,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
      }],
    }],
  },

  "cobra-bubbles-former-cia": {
    abilities: [{
      type: "activated",
      storyName: "THINK ABOUT WHAT'S BEST",
      rulesText: "2 {I} - Draw a card, then choose and discard a card.",
      costs: [],
      costEffects: [{ type: "pay_ink", amount: 2 }],
      effects: [
        { type: "draw", amount: 1, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  // ── Items: activated ──────────────────────────────────────────
  "pooh-pirate-ship": {
    abilities: [{
      type: "activated",
      storyName: "MAKE A RESCUE",
      rulesText: "{E}, 3 {I} – Return a Pirate character card from your discard to your hand.",
      costs: [{ type: "exert" }],
      costEffects: [{ type: "pay_ink", amount: 3 }],
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Pirate" } },
      }],
    }],
  },

  "naveens-ukulele": {
    // "+3 cost to sing songs this turn" is a per-target sing-cost modifier, unsupported cleanly.
    // Approximate as no-op activated cost sink that banishes itself.
    abilities: [{
      type: "activated",
      storyName: "MAKE IT SING",
      rulesText: "1 {I}, Banish this item - Chosen character counts as having +3 cost to sing songs this turn. (approximation: no-op; banishes item)",
      costs: [],
      costEffects: [
        { type: "pay_ink", amount: 1 },
        { type: "banish", target: { type: "this" } },
      ],
      effects: [],
    }],
  },

  "pixie-dust": {
    abilities: [{
      type: "activated",
      storyName: "FAITH AND TRUST",
      rulesText: "{E}, 2 {I} - Chosen character gains Challenger +2 and Evasive until the start of your next turn.",
      costs: [{ type: "exert" }],
      costEffects: [{ type: "pay_ink", amount: 2 }],
      effects: [{
        type: "grant_keyword", keyword: "challenger", keywordValue: 2,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
        followUpEffects: [{
          type: "grant_keyword", keyword: "evasive",
          duration: "until_caster_next_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "longboat": {
    abilities: [{
      type: "activated",
      storyName: "TAKE IT FOR A SPIN",
      rulesText: "2 {I} – Chosen character of yours gains Evasive until the start of your next turn.",
      costs: [],
      costEffects: [{ type: "pay_ink", amount: 2 }],
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "hiro-hamada-robotics-prodigy": {
    abilities: [{
      type: "activated",
      storyName: "SWEET TECH",
      rulesText: "2 {I}, {E} - Search your deck for an item card or a Robot character card and reveal it to all players. Shuffle your deck and put that card on top of it. (approximation: put into hand)",
      costs: [{ type: "exert" }],
      costEffects: [{ type: "pay_ink", amount: 2 }],
      effects: [{
        type: "search",
        filter: { cardType: ["item", "character"] },
        target: SELF,
        zone: "deck",
        putInto: "hand",
      }],
    }],
  },

  "baymaxs-healthcare-chip": {
    abilities: [{
      type: "activated",
      storyName: "10,000 MEDICAL PROCEDURES",
      rulesText: "{E} - Choose one: Remove up to 1 damage from chosen character; or if you have a Robot character in play, remove up to 3 damage from chosen character. (approximation: always removes 1)",
      costs: [{ type: "exert" }],
      costEffects: [],
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  // ── Items: triggered / ETB effects ────────────────────────────
  "microbots": {
    abilities: [{
      type: "triggered",
      storyName: "INSPIRED TECH",
      rulesText: "When you play this item, chosen character gets -1 {S} this turn for each item named Microbots you have in play. (approximation: fixed -1 str)",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -1,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "maleficents-staff": {
    // "whenever an opposing card is returned to hand from play" — no return trigger. Approximate as no-op static.
    abilities: [],
  },

  // ── Locations ──────────────────────────────────────────────────
  "transport-pod": {
    abilities: [{
      type: "triggered",
      storyName: "GIVE 'EM A SHOW",
      rulesText: "At the start of your turn, you may move a character of yours to a location for free.",
      trigger: TURN_START_SELF,
      effects: [{
        type: "move_character",
        isMay: true,
        character: { type: "chosen", filter: ALL_OWN_CHARS },
        location: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["location"] } },
      }],
    }],
  },

  "rescue-rangers-submarine-mobile-headquarters": {
    abilities: [{
      type: "triggered",
      storyName: "PLANNING SESSION",
      rulesText: "At the start of your turn, if you have a character here, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: TURN_START_SELF,
      condition: { type: "this_location_has_character" },
      effects: [{
        type: "look_at_top", count: 1, action: "all_to_inkwell",
        target: SELF, isMay: true,
      }],
    }],
  },

  "institute-of-technology-prestigious-university": {
    abilities: [
      {
        type: "triggered",
        storyName: "PUSH THE BOUNDARIES",
        rulesText: "At the start of your turn, if you have a character here, gain 1 lore.",
        trigger: TURN_START_SELF,
        condition: { type: "this_location_has_character" },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
    ],
  },

  // ── Simple actions ─────────────────────────────────────────────
  "hot-potato": {
    actionEffects: [{
      type: "choose",
      choices: [
        {
          name: "Deal 2 damage",
          effects: [{
            type: "deal_damage", amount: 2,
            target: { type: "chosen", filter: ANY_CHAR },
          }],
        },
        {
          name: "Banish chosen item",
          effects: [{
            type: "banish",
            target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
          }],
        },
      ],
    }],
  },

  "unfortunate-situation": {
    actionEffects: [{
      type: "deal_damage", amount: 4,
      target: { type: "all", filter: ALL_OPP_CHARS },
    }],
    // approximation: deals to all; actual: each opp chooses one of theirs. Marking here since
    // categorizer lacks "each opponent chooses their own" pattern → capability_id:
    // each-opponent-chooses-own-target
  },

  "heffalumps-and-woozles": {
    actionEffects: [
      {
        type: "cant_action", action: "quest",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "im-still-here": {
    actionEffects: [
      {
        type: "grant_keyword", keyword: "resist", keywordValue: 2,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "i-wont-give-in": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], costAtMost: 2 } },
    }],
  },

  "we-could-be-immortals": {
    actionEffects: [
      {
        type: "grant_keyword", keyword: "resist", keywordValue: 6,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Inventor" } },
      },
      { type: "move_to_inkwell", enterExerted: true, target: { type: "this" } },
    ],
  },

  "prepare-your-bot": {
    actionEffects: [{
      type: "choose",
      choices: [
        {
          name: "Ready chosen item",
          effects: [{
            type: "ready",
            target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
          }],
        },
        {
          name: "Ready chosen Robot character",
          effects: [{
            type: "ready",
            target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Robot" } },
            followUpEffects: [{
              type: "cant_action", action: "quest",
              duration: "this_turn",
              target: { type: "this" },
            }],
          }],
        },
      ],
    }],
  },

  "the-islands-i-pulled-from-the-sea": {
    actionEffects: [{
      type: "search",
      filter: { cardType: ["location"] },
      target: SELF,
      zone: "deck",
      putInto: "hand",
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
