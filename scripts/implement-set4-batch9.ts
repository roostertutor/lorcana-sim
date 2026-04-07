#!/usr/bin/env node
// Set 4 — Batch 9: remaining fits-grammar + a few needs-new-type that turned out
// to already be supported (move_damage, count-based deal_damage, look_at_top).
// Skips the rest with one-line reasons.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };
const OWN_ITEMS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["item" as const] };
const OWN_BODYGUARDS = {
  owner: { type: "self" as const },
  zone: "play" as const,
  cardType: ["character" as const],
  hasKeyword: "bodyguard" as const,
};
const OWN_BROOMS = {
  owner: { type: "self" as const },
  zone: "play" as const,
  cardType: ["character" as const],
  hasName: "Magic Broom",
};

const patches: Record<string, any> = {

  // Julieta Madrigal - Excellent Cook — ETB: remove up to 2 damage from chosen character.
  // The printed "If you removed damage this way, you may draw a card" follow-up has no
  // natural encoding (sequential's cost always "resolves" when isUpTo=0), so we only
  // wire the remove_damage portion. Approximation.
  "julieta-madrigal-excellent-cook": {
    abilities: [
      {
        type: "triggered",
        storyName: "FAMILY RECIPE",
        rulesText: "When you play this character, you may remove up to 2 damage from chosen character. If you removed damage this way, you may draw a card. (draw approximation skipped)",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "remove_damage",
            amount: 2,
            isUpTo: true,
            target: { type: "chosen", filter: { ...ANY_CHAR } },
          },
        ],
      },
    ],
  },

  // Mickey Mouse - Musketeer Captain — ETB, if shifted: draw a card per Bodyguard you have in play.
  "mickey-mouse-musketeer-captain": {
    abilities: [
      {
        type: "triggered",
        storyName: "ALL FOR ONE",
        rulesText: "When you play this character, if you used Shift to play him, you may draw a card for each character with Bodyguard you have in play.",
        trigger: { on: "enters_play" },
        condition: { type: "played_via_shift" },
        effects: [
          {
            type: "draw",
            amount: { type: "count", filter: { ...OWN_BODYGUARDS } },
            target: { type: "self" },
            isMay: true,
          },
        ],
      },
    ],
  },

  // Piglet - Sturdy Swordsman — static, gated by empty hand: can challenge ready characters.
  "piglet-sturdy-swordsman": {
    abilities: [
      {
        type: "static",
        storyName: "SHOW OF COURAGE",
        rulesText: "While you have no cards in your hand, this character can challenge ready characters.",
        condition: {
          type: "cards_in_hand_eq",
          amount: 0,
          player: { type: "self" },
        },
        effect: {
          type: "can_challenge_ready",
          target: { type: "this" },
        },
      },
    ],
  },

  // Flounder - Collector's Companion — self cost reduction if you have a character named Ariel.
  "flounder-collector-s-companion": {
    abilities: [
      {
        type: "static",
        storyName: "BEST FRIENDS",
        rulesText: "If you have a character named Ariel in play, you pay 1 {I} less to play this character.",
        condition: {
          type: "has_character_named",
          name: "Ariel",
          player: { type: "self" },
        },
        effect: {
          type: "self_cost_reduction",
          amount: 1,
        },
      },
    ],
  },

  // Belle - Accomplished Mystic — ETB: move up to 3 damage from chosen character to chosen opposing character.
  "belle-accomplished-mystic": {
    abilities: [
      {
        type: "triggered",
        storyName: "MENDING TOUCH",
        rulesText: "When you play this character, move up to 3 damage counters from chosen character to chosen opposing character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "move_damage",
            amount: 3,
            isUpTo: true,
            source: { type: "chosen", filter: { ...ANY_CHAR } },
            destination: { type: "chosen", filter: { ...ALL_OPP_CHARS } },
          },
        ],
      },
    ],
  },

  // Mickey Mouse - Playful Sorcerer — ETB: deal damage to chosen character equal to # Broom chars you have in play.
  "mickey-mouse-playful-sorcerer": {
    abilities: [
      {
        type: "triggered",
        storyName: "BROOMS EVERYWHERE",
        rulesText: "When you play this character, deal damage to chosen character equal to the number of Broom characters you have in play.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "deal_damage",
            amount: { type: "count", filter: { ...OWN_BROOMS } },
            target: { type: "chosen", filter: { ...ANY_CHAR } },
          },
        ],
      },
    ],
  },

  // Aurora - Lore Guardian — activated: exert chosen item of yours → scry 1 (top or bottom of deck).
  "aurora-lore-guardian": {
    abilities: [
      {
        type: "activated",
        storyName: "GOOD ADVICE",
        rulesText: "{E} one of your items — Look at the top card of your deck. Put it on either the top or the bottom of your deck.",
        costs: [],
        effects: [
          {
            type: "exert",
            target: { type: "chosen", filter: { ...OWN_ITEMS } },
          },
          {
            type: "look_at_top",
            count: 1,
            action: "top_or_bottom",
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ─── Skipped ─────────────────────────────────────────────────────────────
  // Sign the Scroll — inverse-sequential "for each opponent who doesn't discard": no support.
  // Ursula's Trickery — same inverse-sequential: no support.
  // Bruno Madrigal - Out of the Shadows — grants a floating ability on play: no support.
  // Pepa Madrigal - Weather Maker — exert + can't-ready "unless at location" qualifier: no support.
  // Diablo - Devoted Herald — opponent-draw-while-exerted trigger variant: no matching trigger.
  // HeiHei - Bumbling Rooster — comparative inkwell conditional: no such condition.
  // Flynn Rider - Frenemy — "more strength than each opp" comparative static: no support.
  // Ariel - Treasure Collector — "more items than each opp" comparative static: no support.
  // Zeus - Mr. Lightning Bolts — "+S equal to chosen target's S" (target-sourced): no support
  //   (strengthEqualsSourceStrength uses SOURCE card's strength, not a chosen target's).
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
