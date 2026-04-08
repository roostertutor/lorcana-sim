#!/usr/bin/env node
// Set 6 — Batch 2: ink_played triggers, more ETBs, more statics, items.
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
const INK_PLAYED_OWN = { on: "ink_played" as const, player: SELF };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Inkwell triggers ───────────────────────────────────────────
  "owl-pirate-lookout": {
    abilities: [{
      type: "triggered",
      storyName: "EYES UP",
      rulesText: "During your turn, whenever a card is put into your inkwell, chosen opposing character gets -1 {S} until the start of your next turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "gain_stats", strength: -1,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "chip-n-dale-recovery-rangers": {
    abilities: [{
      type: "triggered",
      storyName: "RESCUE OPERATION",
      rulesText: "During your turn, whenever a card is put into your inkwell, you may return a character card from your discard to your hand.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      }],
    }],
  },

  "rafiki-ethereal-guide": {
    abilities: [{
      type: "triggered",
      storyName: "WHO ARE YOU?",
      rulesText: "During your turn, whenever a card is put into your inkwell, you may draw a card.",
      trigger: INK_PLAYED_OWN,
      effects: [{ type: "draw", amount: 1, target: SELF, isMay: true }],
    }],
  },

  "peter-pan-shadow-catcher": {
    abilities: [{
      type: "triggered",
      storyName: "GET HIM!",
      rulesText: "During your turn, whenever a card is put into your inkwell, exert chosen opposing character.",
      trigger: INK_PLAYED_OWN,
      effects: [{ type: "exert", target: { type: "chosen", filter: ALL_OPP_CHARS } }],
    }],
  },

  "jafar-power-hungry-vizier": {
    abilities: [{
      type: "triggered",
      storyName: "FROM THE SHADOWS",
      rulesText: "During your turn, whenever a card is put into your inkwell, deal 1 damage to chosen character.",
      trigger: INK_PLAYED_OWN,
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: ANY_CHAR } }],
    }],
  },

  "bellwether-assistant-mayor": {
    abilities: [{
      type: "triggered",
      storyName: "FROM THE SHADOWS",
      rulesText: "During your turn, whenever a card is put into your inkwell, chosen opposing character gains Reckless during their next turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "zipper-astute-decoy": {
    abilities: [{
      type: "triggered",
      storyName: "ASTUTE DECOY",
      rulesText: "During your turn, whenever a card is put into your inkwell, another chosen character gains Resist +1 until the start of your next turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
      }],
    }],
  },

  "raya-kumandran-rider": {
    abilities: [{
      type: "triggered",
      storyName: "COME ON, LET'S DO THIS",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, you may ready another chosen character of yours. They can't quest for the rest of this turn.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: OWN_OTHER_CHARS },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "minnie-mouse-pirate-lookout": {
    abilities: [{
      type: "triggered",
      storyName: "LAND, HO!",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, you may return a location card from your discard to your hand.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["location"] } },
      }],
    }],
  },

  "jim-hawkins-stubborn-cabin-boy": {
    abilities: [{
      type: "triggered",
      storyName: "READY TO RUMBLE",
      rulesText: "During your turn, whenever a card is put into your inkwell, this character gets Challenger +2 this turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "grant_keyword", keyword: "challenger", keywordValue: 2,
        duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  // ── More ETBs ──────────────────────────────────────────────────
  "juju-mama-odies-companion": {
    abilities: [{
      type: "triggered",
      storyName: "MOVE ALONG",
      rulesText: "When you play this character, move 1 damage counter from chosen character to chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage",
        amount: 1,
        source: { type: "chosen", filter: ANY_CHAR },
        destination: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "kakamora-long-range-specialist": {
    abilities: [{
      type: "triggered",
      storyName: "FIRE!",
      rulesText: "When you play this character, if you have another Pirate character in play, you may deal 1 damage to chosen character or location.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...OWN_OTHER_CHARS, hasTrait: "Pirate" },
      },
      effects: [{
        type: "deal_damage", amount: 1, isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } },
      }],
    }],
  },

  "jim-hawkins-rigging-specialist": {
    abilities: [{
      type: "triggered",
      storyName: "FIRE WHEN READY",
      rulesText: "When you play this character, you may deal 1 damage to chosen character or location.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1, isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } },
      }],
    }],
  },

  "john-silver-ships-cook": {
    abilities: [{
      type: "triggered",
      storyName: "EAT UP",
      rulesText: "When you play this character, chosen character can't challenge during their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "cant_action", action: "challenge",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "heihei-not-so-tricky-chicken": {
    abilities: [
      {
        type: "triggered",
        storyName: "WAIT FOR ME!",
        rulesText: "When you play this character, exert chosen opposing item. It can't ready at the start of its next turn.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "exert",
          target: { type: "chosen", filter: { owner: OPP, zone: "play", cardType: ["item"] } },
          followUpEffects: [{
            type: "cant_action", action: "ready",
            duration: "end_of_owner_next_turn",
            target: { type: "this" },
          }],
        }],
      },
      {
        type: "static",
        storyName: "DODGE",
        rulesText: "During your turn, this character gains Evasive.",
        effect: {
          type: "grant_keyword", keyword: "evasive",
          target: { type: "this" },
          condition: { type: "is_your_turn" },
        },
      },
    ],
  },

  "wasabi-methodical-engineer": {
    abilities: [
      {
        type: "triggered",
        storyName: "SCALPEL",
        rulesText: "When you play this character, you may banish chosen item. Its player gains 1 lore.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "banish", isMay: true,
          target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
          followUpEffects: [{
            type: "gain_lore", amount: 1,
            target: { type: "target_owner" },
          }],
        }],
      },
      {
        type: "static",
        storyName: "DODGE",
        rulesText: "During your turn, this character gains Evasive.",
        effect: {
          type: "grant_keyword", keyword: "evasive",
          target: { type: "this" },
          condition: { type: "is_your_turn" },
        },
      },
    ],
  },

  // ── Quest triggers (more) ──────────────────────────────────────
  "tigger-in-the-crows-nest": {
    abilities: [{
      type: "triggered",
      storyName: "FUN UP HERE",
      rulesText: "Whenever you play an action, this character gets +1 {S} and +1 {L} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "gain_stats", strength: 1, lore: 1,
        target: { type: "this" },
      }],
    }],
  },

  "gadget-hackwrench-creative-thinker": {
    abilities: [{
      type: "triggered",
      storyName: "INVENT",
      rulesText: "Whenever you play an item, this character gets +1 {L} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["item"], owner: SELF } },
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "this" },
      }],
    }],
  },

  "genie-wonderful-trickster": {
    abilities: [{
      type: "triggered",
      storyName: "SWITCH UP",
      rulesText: "Whenever you play a card, draw a card.",
      trigger: { on: "card_played", filter: { owner: SELF } },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  // ── Banished triggers ─────────────────────────────────────────
  "billy-bones-space-sailor": {
    abilities: [{
      type: "triggered",
      storyName: "WALK THE PLANK",
      rulesText: "When this character is banished, you may banish chosen item or location.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item", "location"] } },
      }],
    }],
  },

  "hades-lord-of-the-dead": {
    abilities: [{
      type: "triggered",
      storyName: "WHO'S NEXT?",
      rulesText: "Whenever one of your other characters is banished during the opponent's turn, gain 2 lore.",
      trigger: {
        on: "banished_other",
        filter: { ...OWN_OTHER_CHARS },
      },
      condition: { type: "compound_not", inner: { type: "is_your_turn" } },
      effects: [{ type: "gain_lore", amount: 2, target: SELF }],
    }],
  },

  // ── Activated abilities / items ───────────────────────────────
  "madam-mim-truly-marvelous": {
    abilities: [{
      type: "activated",
      storyName: "OH, BAT GIZZARDS",
      rulesText: "2 {I}, Choose and discard a card - Gain 1 lore.",
      costs: [
        { type: "exert" },
      ],
      costEffects: [
        { type: "pay_ink", amount: 2 },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "hades-strong-arm": {
    abilities: [{
      type: "activated",
      storyName: "MY POWER",
      rulesText: "{E}, 3 {I}, Banish one of your characters – Banish chosen character.",
      costs: [{ type: "exert" }],
      costEffects: [
        { type: "pay_ink", amount: 3 },
        {
          type: "banish",
          target: { type: "chosen", filter: ALL_OWN_CHARS },
        },
      ],
      effects: [{
        type: "banish",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "galactic-communicator": {
    abilities: [{
      type: "activated",
      storyName: "RESOURCE ALLOCATION",
      rulesText: "1 {I}, Banish this item - Return chosen character with 2 {S} or less to their player's hand.",
      costs: [],
      costEffects: [
        { type: "pay_ink", amount: 1 },
        { type: "banish", target: { type: "this" } },
      ],
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { ...ANY_CHAR, strengthAtMost: 2 } },
      }],
    }],
  },

  "gold-coin": {
    abilities: [{
      type: "activated",
      storyName: "DIG IN",
      rulesText: "{E}, 1 {I}, Banish this item – Ready chosen character of yours. They can't quest for the rest of this turn.",
      costs: [{ type: "exert" }],
      costEffects: [
        { type: "pay_ink", amount: 1 },
        { type: "banish", target: { type: "this" } },
      ],
      effects: [{
        type: "ready",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "jumbo-pop": {
    abilities: [{
      type: "activated",
      storyName: "HERE YOU GO",
      rulesText: "Banish this item – Remove up to 2 damage from each of your characters. Draw a card.",
      costs: [],
      costEffects: [{ type: "banish", target: { type: "this" } }],
      effects: [
        {
          type: "remove_damage", amount: 2, isUpTo: true,
          target: { type: "all", filter: ALL_OWN_CHARS },
        },
        { type: "draw", amount: 1, target: SELF },
      ],
    }],
  },

  // ── Statics (more) ────────────────────────────────────────────
  "mickey-mouse-night-watch": {
    abilities: [{
      type: "static",
      storyName: "ON GUARD",
      rulesText: "Your Pluto characters get Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasName: "Pluto" } },
      },
    }],
  },

  "mullins-seasoned-shipmate": {
    abilities: [{
      type: "static",
      storyName: "RIGHT HAND MAN",
      rulesText: "While you have a character named Mr. Smee in play, this character gains Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasName: "Mr. Smee" },
        },
      },
    }],
  },

  "moana-self-taught-sailor": {
    abilities: [{
      type: "static",
      storyName: "MAKE WAY",
      rulesText: "This character can't challenge unless you have a Captain character in play.",
      effect: {
        type: "cant_action", action: "challenge",
        target: { type: "this" },
        condition: {
          type: "compound_not",
          inner: {
            type: "you_control_matching",
            filter: { ...ALL_OWN_CHARS, hasTrait: "Captain" },
          },
        },
      },
    }],
  },

  "nick-wilde-soggy-fox": {
    abilities: [{
      type: "static",
      storyName: "NIFTY TRICK",
      rulesText: "While you have another character with Support in play, this character gets +2 {S}.",
      effect: {
        type: "gain_stats", strength: 2,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...OWN_OTHER_CHARS, hasKeyword: "support" },
        },
      },
    }],
  },

  "gadget-hackwrench-brilliant-bosun": {
    selfCostReduction: undefined,
    abilities: [{
      type: "static",
      storyName: "GREAT IDEAS",
      rulesText: "While you have 3 or more items in play, you pay 1 {I} less to play Inventor characters.",
      // Cost reduction applies globally to Inventor characters in hand. We model
      // it as a controller-wide CostReductionEntry via grant_cost_reduction-style
      // static — but global statics like this aren't directly supported. SKIPPED
      // here as a categorizer note. Wire as no-op static for now.
      effect: {
        type: "compound_and_static",
      },
    }],
  },

  // ── Actions ───────────────────────────────────────────────────
  "making-magic": {
    actionEffects: [
      {
        type: "move_damage",
        amount: 1,
        source: { type: "chosen", filter: ANY_CHAR },
        destination: { type: "chosen", filter: ALL_OPP_CHARS },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "prepare-to-board": {
    actionEffects: [{
      type: "conditional_on_target",
      target: { type: "chosen", filter: ANY_CHAR },
      conditionFilter: { hasTrait: "Pirate" },
      ifMatchEffects: [{ type: "gain_stats", strength: 3, target: { type: "this" } }],
      defaultEffects: [{ type: "gain_stats", strength: 2, target: { type: "this" } }],
    }],
  },

  "twin-fire": {
    actionEffects: [{
      type: "deal_damage", amount: 2,
      target: { type: "chosen", filter: ANY_CHAR },
      followUpEffects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF }],
        rewardEffects: [{
          type: "deal_damage", amount: 2,
          target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
        }],
      }],
    }],
  },

  "sunglasses": {
    actionEffects: [
      { type: "draw", amount: 1, target: SELF },
      { type: "discard_from_hand", amount: 1, target: SELF },
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 6.`);
