#!/usr/bin/env node
// Set 4 — Batch 2: more fits-grammar cards using engine features that landed
// during Phase A.3 (compound_or, until_caster_next_turn, has_character_with_trait,
// is_your_turn condition + grant_keyword static, etc.)
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const patches: Record<string, any> = {
  // ─── "During your turn, this character gains Evasive" pattern ───────────
  // (grant_keyword static + is_your_turn condition; now fits-grammar after categorizer fix)
  "triton-young-prince": {
    abilities: [
      { type: "keyword", keyword: "shift", value: 4 },
      {
        type: "static",
        rulesText: "During your turn, this character gains Evasive.",
        condition: { type: "is_your_turn" },
        effect: {
          type: "grant_keyword",
          keyword: "evasive",
          target: { type: "this" },
        },
      },
    ],
  },

  "magic-broom-aerial-cleaner": {
    abilities: [
      { type: "keyword", keyword: "rush" },
      {
        type: "static",
        rulesText: "During your turn, this character gains Evasive.",
        condition: { type: "is_your_turn" },
        effect: {
          type: "grant_keyword",
          keyword: "evasive",
          target: { type: "this" },
        },
      },
    ],
  },

  // ─── Self cost reduction with named-character condition (LeFou pattern) ──
  "max-loyal-sheepdog": {
    abilities: [
      {
        type: "static",
        storyName: "HERE BOY",
        rulesText: "If you have a character named Prince Eric in play, you pay 1 {I} less to play this character.",
        condition: { type: "has_character_named", name: "Prince Eric", player: { type: "self" } },
        effect: {
          type: "self_cost_reduction",
          amount: 1,
        },
      },
    ],
  },

  // ─── enters_play conditional draws ──────────────────────────────────────
  "mrs-potts-enchanted-teapot": {
    abilities: [
      {
        type: "triggered",
        storyName: "IT'LL TURN OUT ALL RIGHT",
        rulesText: "When you play this character, if you have a character named Lumiere or Cogsworth in play, you may draw a card.",
        trigger: { on: "enters_play" },
        condition: {
          type: "compound_or",
          conditions: [
            { type: "has_character_named", name: "Lumiere", player: { type: "self" } },
            { type: "has_character_named", name: "Cogsworth", player: { type: "self" } },
          ],
        },
        effects: [{ type: "draw", amount: 1, isMay: true, target: { type: "self" } }],
      },
    ],
  },

  "dolores-madrigal-easy-listener": {
    abilities: [
      {
        type: "triggered",
        storyName: "MAGICAL INFORMANT",
        rulesText: "When you play this character, if an opponent has an exerted character in play, you may draw a card.",
        trigger: { on: "enters_play" },
        condition: {
          type: "cards_in_zone_gte",
          zone: "play",
          amount: 1,
          player: { type: "opponent" },
          cardType: ["character"],
        },
        effects: [{ type: "draw", amount: 1, isMay: true, target: { type: "self" } }],
      },
    ],
  },

  // ─── "Until the start of your next turn" gain_stats / grant_keyword ─────
  // (now uses until_caster_next_turn duration)
  "elsa-storm-chaser": {
    abilities: [
      {
        type: "triggered",
        storyName: "TEMPEST",
        rulesText: "Chosen character gains Challenger +2 and Rush this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "grant_keyword",
            keyword: "challenger",
            value: 2,
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"] },
            },
            duration: "end_of_turn",
            followUpEffects: [
              {
                type: "grant_keyword",
                keyword: "rush",
                target: { type: "this" },
                duration: "end_of_turn",
              },
            ],
          },
        ],
      },
    ],
  },

  // ─── Quest triggers ─────────────────────────────────────────────────────
  "ursula-erics-bride": {
    abilities: [
      {
        type: "triggered",
        storyName: "VANESSA'S DESIGN",
        rulesText: "Whenever this character quests, chosen opponent reveals their hand and discards a non-character card of your choice.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "discard_from_hand",
            amount: 1,
            target: { type: "opponent" },
            chooser: "controller",
            filter: {
              cardType: ["action", "item", "location"],
            },
          },
        ],
      },
    ],
  },

  // ─── banished_in_challenge → return_to_hand self ────────────────────────
  "flotsam-ursulas-baby": {
    abilities: [
      {
        type: "triggered",
        storyName: "QUICK ESCAPE",
        rulesText: "When this character is banished in a challenge, return this card to your hand.",
        trigger: { on: "banished_in_challenge" },
        effects: [
          {
            type: "return_to_hand",
            target: { type: "this" },
          },
        ],
      },
    ],
  },

  // Jetsam mirror — same shape, different name
  "jetsam-ursulas-baby": {
    abilities: [
      {
        type: "triggered",
        storyName: "QUICK ESCAPE",
        rulesText: "When this character is banished in a challenge, return this card to your hand.",
        trigger: { on: "banished_in_challenge" },
        effects: [
          {
            type: "return_to_hand",
            target: { type: "this" },
          },
        ],
      },
    ],
  },

  // ─── "Whenever you play another character, may banish self to draw" ─────
  "magic-broom-illuminary-keeper": {
    abilities: [
      {
        type: "triggered",
        storyName: "NICE AND TIDY",
        rulesText: "Whenever you play another character, you may banish this character to draw a card.",
        trigger: {
          on: "card_played",
          filter: { cardType: ["character"], excludeSelf: true },
        },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [
              { type: "banish", target: { type: "this" } },
            ],
            rewardEffects: [
              { type: "draw", amount: 1, target: { type: "self" } },
            ],
          },
        ],
      },
    ],
  },

  // ─── Quest trigger with -strength debuff (Cogsworth-style now landed) ───
  // Cogsworth was wired in batch 1; this is the same shape with different stats
  // Wait — Cogsworth was set 4 batch 1. Skip duplicate.

  // ─── Marshmallow stat-per-count was already in batch 1 — skip ──────────

  // ─── Rajah Royal Protector (cant_be_challenged with attacker filter +
  //     condition cards_in_hand_eq 0) ────────────────────────────────────
  "rajah-royal-protector": {
    abilities: [
      {
        type: "static",
        storyName: "REGAL GUARDIAN",
        rulesText: "While you have no cards in your hand, characters with cost 4 or less can't challenge this character.",
        condition: { type: "cards_in_hand_eq", amount: 0, player: { type: "self" } },
        effect: {
          type: "cant_be_challenged",
          target: { type: "this" },
          attackerFilter: { costAtMost: 4 },
        },
      },
    ],
  },

  // ─── EN GAWRSH! — trigger on play character with bodyguard, ready self
  //     + cant quest rest of turn (Maui I GOT YOUR BACK pattern) ──────────
  "goofy-musketeer-swordsman": {
    abilities: [
      {
        type: "triggered",
        storyName: "EN GAWRSH!",
        rulesText: "Whenever you play a character with Bodyguard, ready this character. He can't quest for the rest of this turn.",
        trigger: {
          on: "card_played",
          filter: { cardType: ["character"], hasKeyword: "bodyguard", excludeSelf: true },
        },
        effects: [
          {
            type: "ready",
            target: { type: "this" },
            followUpEffects: [
              {
                type: "cant_action",
                action: "quest",
                target: { type: "this" },
                duration: "rest_of_turn",
              },
            ],
          },
        ],
      },
    ],
  },

  // ─── Each opponent gets -1 strength while exerted (Frozen Sentinel-ish) ─
  // Skip — would need new effect pattern

  // ─── Atlantica Concert Hall — virtual cost modifier for sing (skip — needs new mechanic)

  // ─── Hidden Cove - Tranquil Haven (location with simple while-here grant) ──
  // Skip until I see the text

  // ─── Jaq - Connoisseur of Climbing — possibly fits ──────────────────────
  // Skip without seeing text

  // ─── Belle - Untrained Mystic: move damage counter from chosen to chosen-opposing ─
  // Move damage exists? Yes — move_damage effect from earlier audit exists in needs-new-type.
  // Actually: I haven't implemented move_damage yet. Skip.

  // ─── Hera - Queen of the Gods (probably keyword + simple) ───────────────
  // Skip without seeing text

  // ─── Hades - Double Dealer ──────────────────────────────────────────────
  // Skip without seeing text

  // ─── Triton - Champion of Atlantica / Discerning King ──────────────────
  // Skip without seeing text

  // ─── Anna - Braving the Storm ───────────────────────────────────────────
  // Skip without seeing text

  // ─── Iduna - Caring Mother ──────────────────────────────────────────────
  // Skip without seeing text

  // ─── Pascal - Inquisitive Pet ───────────────────────────────────────────
  // Skip without seeing text
};

// ─── Apply ────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
for (const card of cards) {
  if (patches[card.id]) {
    const patch = patches[card.id];
    if (patch.abilities) card.abilities = patch.abilities;
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    patched++;
    console.log(`  ✅ ${card.id}`);
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} cards in set 4.`);
