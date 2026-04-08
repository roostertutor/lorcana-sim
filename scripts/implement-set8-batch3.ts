#!/usr/bin/env node
// Set 8 — Batch 3: remaining simple fits-grammar.
// False positives / skipped inline (see batch2 header for full list):
//   - Modals: she's-your-person, pull-the-lever, madam-mim-rhino, maui-stubborn-trickster
//   - Dynamic counts: fantastical-and-magical, bruno-singing-seer, everybody's-got-a-weakness,
//     light-the-fuse, geppetto, faline, namaari, gadget-hackwrench
//   - Shift context: honey-lemon, go-go-tomago-cutting-edge, chem-purse, go-go-tomago-mech-engineer
//   - OncePerTurn special triggers: pinocchio, captain-hook-pirate-king, antonio-madrigal,
//     alma-madrigal, tinker-bell-insistent-fairy
//   - Complex sequential cost: mother-gothel, ratigan-greedy-genius, hades-ruthless-tyrant
//     (wired as approximation), madame-medusa (wired as approximation)
//   - Reveal / deck search: mirabel, yzma, jafar-high-sultan, fred-giant-sized, television-set
//   - End-of-turn self-banish: candy-drift (wired without banish), goofy-groundbreaking-chef
//   - Deck construction: dalmatian-puppy-tail-wagger
//   - Vanish keyword: palace-guard already handled by import
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

  // ── ETBs with named-character conditions ──────────────────
  "chaca-junior-chipmunk": {
    abilities: [{
      type: "triggered",
      storyName: "PARTNER UP",
      rulesText: "When you play this character, if you have a character named Tipo in play, chosen opposing character gains Reckless during their next turn.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, name: "Tipo" },
      },
      effects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "anna-trusting-sister": {
    abilities: [{
      type: "triggered",
      storyName: "TRUSTY SISTER",
      rulesText: "When you play this character, if you have a character named Elsa in play, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, name: "Elsa" },
      },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  "anna-magical-mission": {
    abilities: [{
      type: "triggered",
      storyName: "MAGICAL MISSION",
      rulesText: "Whenever this character quests, if you have a character named Elsa in play, you may draw a card.",
      trigger: { on: "quests" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, name: "Elsa" },
      },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  // ── ETBs, simple ──────────────────────────────────────────
  "lilo-causing-an-uproar": {
    abilities: [{
      type: "triggered",
      storyName: "UPROAR",
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

  "flower-shy-skunk": {
    abilities: [{
      type: "triggered",
      storyName: "PEEK",
      rulesText: "Whenever you play another character, look at the top card of your deck. Put it on either the top or the bottom of your deck.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, excludeSelf: true } },
      effects: [{ type: "scry", amount: 1, target: SELF }],
    }],
  },

  "gaston-arrogant-showoff": {
    abilities: [{
      type: "triggered",
      storyName: "SHOW OFF",
      rulesText: "When you play this character, you may banish one of your items to give chosen character +2 {S} this turn.",
      // Approximation: buff without requiring the item-banish cost.
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 2, duration: "this_turn", isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "madame-medusa-deceiving-partner": {
    abilities: [{
      type: "triggered",
      storyName: "DECEIVE",
      rulesText: "When you play this character, you may deal 2 damage to another chosen character of yours to return chosen character with cost 2 or less to their player's hand.",
      // Approximation: direct return without enforcing the self-damage cost chain.
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, maxCost: 2 } },
      }],
    }],
  },

  "hades-ruthless-tyrant": {
    abilities: [
      {
        type: "triggered",
        storyName: "RUTHLESS",
        rulesText: "When you play this character, you may deal 2 damage to another chosen character of yours to draw 2 cards.",
        // Approximation: may-draw without the self-damage cost gate.
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 2, isMay: true, target: SELF }],
      },
      {
        type: "triggered",
        storyName: "RUTHLESS",
        rulesText: "Whenever he quests, you may deal 2 damage to another chosen character of yours to draw 2 cards.",
        trigger: { on: "quests" },
        effects: [{ type: "draw", amount: 2, isMay: true, target: SELF }],
      },
    ],
  },

  "magica-de-spell-shadow-form": {
    abilities: [{
      type: "triggered",
      storyName: "SHADOWSTEP",
      rulesText: "When you play this character, you may return one of your other characters to your hand to draw a card.",
      // Approximation: skips the return-cost gate; just may-draw.
      trigger: { on: "enters_play" },
      effects: [
        {
          type: "return_to_hand", isMay: true,
          target: { type: "chosen", filter: OWN_OTHER_CHARS },
        },
        { type: "draw", amount: 1, isMay: true, target: SELF },
      ],
    }],
  },

  // ── Actions / Songs ───────────────────────────────────────
  "thumper-young-bunny": {
    actionEffects: [{
      type: "gain_stats", strength: 3, duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "nani-heist-mastermind": {
    actionEffects: [
      {
        type: "grant_keyword", keyword: "resist", keywordValue: 2, duration: "this_turn",
        target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
      },
      {
        type: "grant_keyword", keyword: "support", duration: "this_turn",
        target: { type: "all", filter: { ...ALL_OWN_CHARS, name: "Lilo" } },
      },
    ],
  },

  "candy-drift": {
    actionEffects: [
      { type: "draw", amount: 1, target: SELF },
      {
        type: "gain_stats", strength: 5, duration: "this_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      },
    ],
  },

  "stopped-chaos-in-its-tracks": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", count: 2, filter: { ...ANY_CHAR, maxStrength: 3 } },
    }],
  },

  "heads-held-high": {
    actionEffects: [
      {
        type: "remove_damage", amount: 3, isUpTo: true,
        target: { type: "chosen", filter: ANY_CHAR },
      },
      {
        type: "gain_stats", strength: -3, duration: "this_turn",
        target: { type: "all", filter: ALL_OPP_CHARS },
      },
    ],
  },

  "it-means-no-worries": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", count: 3, filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      },
      {
        type: "grant_cost_reduction", amount: 2, filter: { cardType: ["character"] },
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
