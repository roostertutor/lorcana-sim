#!/usr/bin/env node
// Set 11 — Batch 1: low-risk fits-grammar wiring. No new primitives.
// Skipped / deferred (noted inline where relevant):
//   - UNDERDOG cards (needs "going second on turn 1" condition — not yet in engine).
//   - Alert-only reminder cards (vanilla keyword, no real wiring needed).
//   - DEFERRED_MECHANICS entries (Bambi Ethereal Fawn, John Smith Undaunted, Angela, etc.).
//   - Complex modals (Tod - Playful Kit, Hidden Trap, Education or Elimination modal).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-011.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── ETB opponent discard / draw / damage ──────────────────────
  "pumbaa-winter-warthog": {
    abilities: [{
      type: "triggered",
      storyName: "SHAKE THINGS UP",
      rulesText: "When you play this character, each opponent chooses and discards a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "discard_from_hand", amount: 1, target: OPP, chooser: "target_player" }],
    }],
  },

  "pocahontas-finding-the-way": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, chosen character gets +1 {L} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", lore: 1, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "sarabi-protecting-the-pride": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Chosen opposing character gets -4 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -4, duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "chief-powhatan-protective-leader": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "This character can't challenge.",
      effect: {
        type: "action_restriction", restricts: "challenge",
        target: { type: "this" },
      },
    }],
  },

  "cobra-bubbles-dedicated-official": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, chosen opposing character can't challenge and must quest during their next turn if able.",
      // Approximation: drop "must quest" half.
      trigger: { on: "quests" },
      effects: [{
        type: "cant_action", action: "challenge", duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "lilo-rock-star": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, you may play a character with cost 2 or less from your discard for free.",
      trigger: { on: "quests" },
      effects: [{
        type: "play_for_free", isMay: true, sourceZone: "discard",
        filter: { cardType: ["character"], maxCost: 2 },
      }],
    }],
  },

  "pleakley-arctic-naturalist": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, if you have another Alien character in play, draw a card.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...OWN_OTHER_CHARS, hasTrait: "Alien" },
      },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "jumba-jookiba-prolific-inventor": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, you may remove all damage from chosen character.",
      trigger: { on: "quests" },
      effects: [{
        type: "remove_damage", amount: 99, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "simba-playful-pouncer": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, chosen opposing character gets -2 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -2, duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "widow-tweed-kindly-soul": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, return a character card from your discard to your hand. If that character is named Tod, you may play him for free.",
      // Approximation: unconditional return-to-hand; drop Tod free-play branch.
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      }],
    }],
  },

  "percy-pupsicle": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "This character can't challenge.",
      effect: {
        type: "action_restriction", restricts: "challenge",
        target: { type: "this" },
      },
    }],
  },

  "nala-romping-in-the-snow": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, chosen character of yours gains Evasive until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "tigger-bouncing-all-the-way": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may return chosen character, item, or location with cost 2 or less to their player's hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character", "item", "location"], maxCost: 2 } },
      }],
    }],
  },

  "isis-vanderchill-ice-queen-of-st-canard": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, exert chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "flit-reflective-hummingbird": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, move up to 1 damage from chosen character to chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage", amount: 1,
        from: { type: "chosen", filter: ANY_CHAR },
        to: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "heihei-persistent-presence": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When this character is banished in a challenge, return this card from your discard to your hand.",
      trigger: { on: "is_banished_in_challenge" },
      effects: [{
        type: "return_to_hand",
        target: { type: "this" },
      }],
    }],
  },

  "stitch-naughty-experiment": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Chosen opposing character gains Reckless until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "yao-snow-warrior": {
    // "During opponents' turns, this character gains Resist +2."
    // Approximation: grant resist +2 always (overgrants on own turn).
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "During opponents' turns, this character gains Resist +2.",
      effect: {
        type: "grant_keyword", keyword: "resist", value: 2,
        target: { type: "this" },
      },
    }],
  },

  "boomer-has-the-beak": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may exert chosen damaged character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
      }],
    }],
  },

  "mushu-sneaky-dragon": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, deal 2 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 2,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "copper-champion-of-the-forest": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, your characters with Evasive get +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "gain_stats", lore: 1, duration: "this_turn",
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasKeyword: "evasive" } },
      }],
    }],
  },

  "winnie-the-pooh-hungry-bear": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may return an item card from your discard to your hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["item"] } },
      }],
    }],
  },

  "nani-no-worries": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While this character has no damage, she gets +1 {L}.",
      effect: {
        type: "modify_stat", stat: "lore", amount: 1,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }],
  },

  "gigi-best-in-snow": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While this character has no damage, she gets +2 {S}.",
      effect: {
        type: "modify_stat", stat: "strength", amount: 2,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }],
  },

  "gantu-hamsterviels-accomplice": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" }],
    }],
  },

  "donald-duck-along-for-the-ride": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may banish chosen item.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "dr-hamsterviel-infamous-scientist": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, chosen opposing character can't challenge during their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "cant_action", action: "challenge", duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "agnarr-king-of-arendelle": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While you have a Queen character in play, this character gets +2 {S}.",
      effect: {
        type: "modify_stat", stat: "strength", amount: 2,
        target: { type: "this" },
        condition: { type: "has_character_with_trait", trait: "Queen", player: SELF },
      },
    }],
  },

  "negaduck-public-enemy-number-one": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character challenges another character, each opponent loses 1 lore and you gain 1 lore.",
      trigger: { on: "challenge_initiated" },
      effects: [
        { type: "lose_lore", amount: 1, target: OPP },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  "olaf-snowman-of-action": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, each opponent loses 2 lore.",
      trigger: { on: "enters_play" },
      effects: [{ type: "lose_lore", amount: 2, target: OPP }],
    }],
  },

  "elsa-concerned-sister": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you pay 2 {I} less for the next location you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_cost_reduction", amount: 2, filter: { cardType: ["location"] },
      }],
    }],
  },

  "honker-muddlefoot-timid-genius": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "Your characters named Darkwing Duck gain Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", value: 1,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, name: "Darkwing Duck" } },
      },
    }],
  },

  "launchpad-hideout-defender": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "Your locations gain Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", value: 1,
        target: { type: "all", filter: { owner: SELF, zone: "play", cardType: ["location"] } },
      },
    }],
  },

  "mickey-mouse-snowboard-ace": {
    abilities: [
      {
        type: "triggered",
        storyName: "",
        rulesText: "When you play this character, each opponent chooses and discards a card.",
        trigger: { on: "enters_play" },
        effects: [{ type: "discard_from_hand", amount: 1, target: OPP, chooser: "target_player" }],
      },
      {
        type: "triggered",
        storyName: "",
        rulesText: "When he leaves play, each opponent chooses and discards a card.",
        trigger: { on: "leaves_play" },
        effects: [{ type: "discard_from_hand", amount: 1, target: OPP, chooser: "target_player" }],
      },
    ],
  },

  "goofy-marleys-clumsy-spirit": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may ready chosen character. If you do, they can't quest for the rest of this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
        followUpEffects: [{
          type: "cant_action", action: "quest", duration: "end_of_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "goofy-klutzy-skier": {
    abilities: [{
      type: "activated",
      storyName: "",
      rulesText: "{E}, Banish this character — Banish chosen character.",
      costs: [{ type: "exert" }, { type: "banish_self" }],
      effects: [{
        type: "banish",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  // ── Actions ───────────────────────────────────────────────────
  "swordplay": {
    actionEffects: [{
      type: "grant_keyword", keyword: "challenger", value: 3, duration: "end_of_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "ohana-means-family": {
    // Approximation: remove 2 damage + draw 2 cards (can't tie draw count to damage removed).
    actionEffects: [
      {
        type: "remove_damage", amount: 2,
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      },
      { type: "draw", amount: 2, target: SELF },
    ],
  },

  "force-of-a-great-typhoon": {
    actionEffects: [{
      type: "gain_stats", strength: 5, duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "grab-your-bow": {
    actionEffects: [{
      type: "banish",
      target: { type: "chosen", filter: { ...ANY_CHAR, maxStrength: 2 } },
    }],
  },

  "distract": {
    actionEffects: [
      {
        type: "gain_stats", strength: -2, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "nearly-indestructible": {
    actionEffects: [{
      type: "grant_keyword", keyword: "resist", value: 2,
      duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ALL_OWN_CHARS },
    }],
  },

  "the-terror-that-flaps-in-the-night": {
    // Approximation: always deal 2; drop Darkwing bonus branch.
    actionEffects: [{
      type: "deal_damage", amount: 2,
      target: { type: "chosen", filter: ALL_OPP_CHARS },
    }],
  },

  "snowball-fight": {
    actionEffects: [
      { type: "discard_from_hand", amount: 1, target: OPP, chooser: "target_player" },
      {
        type: "gain_lore", amount: 1, target: SELF,
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasKeyword: "evasive" },
        },
      },
    ],
  },

  "freeze-the-vine": {
    actionEffects: [
      { type: "banish", target: { type: "all", filter: { zone: "play", cardType: ["location"] } } },
      { type: "draw", amount: 2, target: SELF },
      { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
    ],
  },

  "raging-storm": {
    actionEffects: [{
      type: "banish",
      target: { type: "all", filter: ANY_CHAR },
    }],
  },

  // ── Items ─────────────────────────────────────────────────────
  "rafikis-bakora-staff": {
    actionEffects: [
      { type: "draw", amount: 1, target: SELF },
      { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
    ],
  },

  "infra-pink-ultra-scan-specs": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this item, draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
      ],
    }],
  },

  "blue-smoke": {
    abilities: [{
      type: "activated",
      storyName: "",
      rulesText: "{E}, 1 {I}, Banish this item – Chosen character gains Ward until the start of your next turn.",
      costs: [{ type: "exert" }, { type: "ink", amount: 1 }, { type: "banish_self" }],
      effects: [{
        type: "grant_keyword", keyword: "ward",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "tiny-tims-crutch": {
    actionEffects: [{
      type: "grant_keyword", keyword: "support", duration: "end_of_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "darkwings-gas-device": {
    // Approximation: always -1 STR; drop Darkwing Duck -2 branch.
    actionEffects: [{
      type: "gain_stats", strength: -1, duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  // ── Statics: Snow Fort ────────────────────────────────────────
  "snow-fort": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "Your characters get +1 {S}.",
      effect: {
        type: "modify_stat", stat: "strength", amount: 1,
        target: { type: "all", filter: ALL_OWN_CHARS },
      },
    }],
  },

  // ── Mulan Ready for Battle (combined noble+fighting spirit approx) ─
  "angel-experiment-624": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While you have no cards in your hand, this character gains Resist +2.",
      effect: {
        type: "grant_keyword", keyword: "resist", value: 2,
        target: { type: "this" },
        condition: { type: "cards_in_hand_eq", amount: 0, player: SELF },
      },
    }],
  },

  "stitch-high-badness-level": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While you have a character named Lilo in play, this character gains Challenger +3.",
      effect: {
        type: "grant_keyword", keyword: "challenger", value: 3,
        target: { type: "this" },
        condition: { type: "has_character_named", name: "Lilo", player: SELF },
      },
    }],
  },

  "lilo-snow-artist": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While you have a character named Stitch in play, this character gets +1 {L}.",
      effect: {
        type: "modify_stat", stat: "lore", amount: 1,
        target: { type: "this" },
        condition: { type: "has_character_named", name: "Stitch", player: SELF },
      },
    }],
  },

  // ── Quest triggers, card quality ──────────────────────────────
  "stitch-carefree-snowboarder": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, if you have 2 or more other characters in play, you may draw a card.",
      trigger: { on: "quests" },
      condition: { type: "characters_in_play_gte", amount: 3, player: SELF },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "aladdin-on-the-edge-of-adventure": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever you play an action, this character gains Evasive until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "this" },
      }],
    }],
  },

  "scrooge-mcduck-ebenezer-scrooge": {
    // Approximation: each opp loses 1 lore; drop "draw per lore lost" since no dynamic draw tied to lost lore.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, each opponent loses 1 lore.",
      trigger: { on: "quests" },
      effects: [{ type: "lose_lore", amount: 1, target: OPP }],
    }],
  },

  "fangmeyer-icy-officer": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may return a Detective character card from your discard to your hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Detective" } },
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 11.`);
if (missing.length) {
  console.log(`\nMISSING IDs:`);
  missing.forEach(m => console.log(`  - ${m}`));
}
