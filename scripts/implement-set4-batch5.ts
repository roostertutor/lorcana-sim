#!/usr/bin/env node
// Set 4 — Batch 5: cards I skipped for time, not for engine reasons.
// Each is wireable with existing types but requires more careful structure
// (sequential cost-then-reward, partial implementations, no-op visibility,
// compound conditions).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const ALL_OWN_CHARS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {

  // The Underworld - River Styx — quests-while-here trigger + sequential cost (pay 3 ink) → return char from discard
  "the-underworld-river-styx": {
    abilities: [
      {
        type: "triggered",
        storyName: "SAVE A SOUL",
        rulesText: "Whenever a character quests while here, you may pay 3 {I} to return a character card from your discard to your hand.",
        trigger: {
          on: "quests",
          filter: { ...ANY_CHAR, atLocation: "this" },
        },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 3 }],
            rewardEffects: [
              {
                type: "return_to_hand",
                target: {
                  type: "chosen",
                  filter: { zone: "discard", cardType: ["character"], owner: { type: "self" } },
                },
              },
            ],
          },
        ],
      },
    ],
  },

  // Treasures Untold — return up to 2 item cards from discard. Two chained may-return-to-hand
  // (return_to_hand doesn't have a count field; chaining two with isMay gets us 0/1/2).
  "treasures-untold": {
    actionEffects: [
      {
        type: "return_to_hand",
        isMay: true,
        target: {
          type: "chosen",
          filter: { zone: "discard", cardType: ["item"], owner: { type: "self" } },
        },
      },
      {
        type: "return_to_hand",
        isMay: true,
        target: {
          type: "chosen",
          filter: { zone: "discard", cardType: ["item"], owner: { type: "self" } },
        },
      },
    ],
  },

  // Mystical Rose DISPEL — banish self item, +2 lore chosen Beast (skip the conditional move-damage branch)
  "mystical-rose": {
    abilities: [
      {
        type: "activated",
        storyName: "DISPEL THE ENTANGLEMENT",
        rulesText: "Banish this item — Chosen character named Beast gets +2 {L} this turn.",
        costs: [{ type: "banish_self" }],
        effects: [
          {
            type: "gain_stats",
            lore: 2,
            target: { type: "chosen", filter: { ...ANY_CHAR, hasName: "Beast" } },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // One Last Hope — chosen gains Resist +2 until your next turn (skip the Hero conditional branch)
  "one-last-hope": {
    actionEffects: [
      {
        type: "grant_keyword",
        keyword: "resist",
        value: 2,
        target: { type: "chosen", filter: { ...ANY_CHAR } },
        duration: "until_caster_next_turn",
      },
    ],
  },

  // Winter Camp Medical Tent — quests-while-here remove up to 2 damage from the questing character.
  // Skip the conditional Hero +4 branch.
  "winter-camp-medical-tent": {
    abilities: [
      {
        type: "triggered",
        storyName: "HELP THE WOUNDED",
        rulesText: "Whenever a character quests while here, remove up to 2 damage from them.",
        trigger: {
          on: "quests",
          filter: { ...ANY_CHAR, atLocation: "this" },
        },
        effects: [
          {
            type: "remove_damage",
            amount: 2,
            isUpTo: true,
            target: { type: "this" },
          },
        ],
      },
    ],
  },

  // Great Stone Dragon ASLEEP — enters play exerted. AWAKEN (inkwell-from-discard) skipped.
  "great-stone-dragon": {
    abilities: [
      {
        type: "triggered",
        storyName: "ASLEEP",
        rulesText: "This item enters play exerted.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "exert",
            target: { type: "this" },
          },
        ],
      },
    ],
  },

  // Diablo Maleficent's Spy — SCOUT AHEAD: look at each opponent's hand.
  // Information-only effect: the engine is all-knowing so it's a no-op for state.
  // Wire as a triggered enters_play with empty effects so the categorizer counts it as
  // implemented and the UI can render the "ability fired" log.
  "diablo-maleficents-spy": {
    abilities: [
      {
        type: "triggered",
        storyName: "SCOUT AHEAD",
        rulesText: "When you play this character, you may look at each opponent's hand. (Info-only — engine state unchanged.)",
        trigger: { on: "enters_play" },
        effects: [],
      },
    ],
  },

  // The Fates Only One Eye — ALL WILL BE SEEN: same info-only no-op.
  "the-fates-only-one-eye": {
    abilities: [
      {
        type: "triggered",
        storyName: "ALL WILL BE SEEN",
        rulesText: "When you play this character, look at the top card of each opponent's deck. (Info-only — engine state unchanged.)",
        trigger: { on: "enters_play" },
        effects: [],
      },
    ],
  },

  // Panic Immortal Sidekick — REPORTING FOR DUTY: while exerted AND has Pain, your Villains can't be challenged.
  // Static cant_be_challenged with target type "all", filter your Villains, condition compound_and.
  "panic-immortal-sidekick": {
    abilities: [
      {
        type: "static",
        storyName: "REPORTING FOR DUTY",
        rulesText: "While this character is exerted, if you have a character named Pain in play, your Villain characters can't be challenged.",
        condition: {
          type: "compound_and",
          conditions: [
            { type: "this_is_exerted" },
            { type: "has_character_named", name: "Pain", player: { type: "self" } },
          ],
        },
        effect: {
          type: "cant_be_challenged",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Villain" } },
        },
      },
    ],
  },
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
