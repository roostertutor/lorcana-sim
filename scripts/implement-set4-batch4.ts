#!/usr/bin/env node
// Set 4 — Batch 4 (rest of set 4 fits-grammar). Skips cards needing new
// engine work (move_damage, banish_chosen cost, opponent-chosen, dynamic
// stat gain, virtual cost modifier, etc.) — those will need new effect
// types in a future Phase A session.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ALL_OWN_CHARS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {

  // Miracle Candle — banish-self item, conditional gain lore + remove damage from location
  "miracle-candle": {
    abilities: [
      {
        type: "activated",
        storyName: "ABUELA'S GIFT",
        rulesText: "Banish this item — If you have 3 or more characters in play, gain 2 lore and remove up to 2 damage from chosen location.",
        costs: [{ type: "banish_self" }],
        condition: {
          type: "characters_in_play_gte",
          amount: 3,
          player: { type: "self" },
        },
        effects: [
          { type: "gain_lore", amount: 2, target: { type: "self" } },
          {
            type: "remove_damage",
            amount: 2,
            isUpTo: true,
            target: { type: "chosen", filter: { zone: "play", cardType: ["location"] } },
          },
        ],
      },
    ],
  },

  // Record Player — LOOK AT THIS!: card_played song → -2 strength chosen until your next turn
  "record-player": {
    abilities: [
      {
        type: "triggered",
        storyName: "LOOK AT THIS!",
        rulesText: "Whenever you play a song, chosen character gets -2 {S} until the start of your next turn.",
        trigger: { on: "card_played", filter: { cardType: ["action"], hasTrait: "Song" } },
        effects: [
          {
            type: "gain_stats",
            strength: -2,
            target: { type: "chosen", filter: { ...ANY_CHAR } },
            duration: "until_caster_next_turn",
          },
        ],
      },
    ],
  },

  // Ursula's Lair — SLIPPERY HALLS (banished_in_challenge while here may return) + SEAT OF POWER (Ursula here +1 lore)
  "ursula-s-lair-eye-of-the-storm": {
    abilities: [
      {
        type: "triggered",
        storyName: "SLIPPERY HALLS",
        rulesText: "Whenever a character is banished in a challenge while here, you may return them to your hand.",
        trigger: {
          on: "banished_in_challenge",
          filter: { ...ANY_CHAR, atLocation: "this" },
        },
        effects: [
          {
            type: "return_to_hand",
            isMay: true,
            target: { type: "triggering_card" },
          },
        ],
      },
      {
        type: "static",
        storyName: "SEAT OF POWER",
        rulesText: "Characters named Ursula get +1 {L} while here.",
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: 1,
          target: {
            type: "all",
            filter: { ...ANY_CHAR, hasName: "Ursula", atLocation: "this" },
          },
        },
      },
    ],
  },

  // Lumiere Fiery Friend — your other characters get +1 {S}
  "lumiere-fiery-friend": {
    abilities: [
      {
        type: "static",
        storyName: "FERVENT ADDRESS",
        rulesText: "Your other characters get +1 {S}.",
        effect: {
          type: "modify_stat",
          stat: "strength",
          modifier: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, excludeSelf: true } },
        },
      },
    ],
  },

  // Mulan Enemy of Entanglement — TIME TO SHINE: card_played action → +2 strength self this turn
  "mulan-enemy-of-entanglement": {
    abilities: [
      {
        type: "triggered",
        storyName: "TIME TO SHINE",
        rulesText: "Whenever you play an action, this character gets +2 {S} this turn.",
        trigger: { on: "card_played", filter: { cardType: ["action"] } },
        effects: [
          {
            type: "gain_stats",
            strength: 2,
            target: { type: "this" },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // Mulan Injured Soldier — BATTLE WOUND: enters play with 2 damage
  "mulan-injured-soldier": {
    abilities: [
      {
        type: "triggered",
        storyName: "BATTLE WOUND",
        rulesText: "This character enters play with 2 damage.",
        trigger: { on: "enters_play" },
        effects: [{ type: "deal_damage", amount: 2, target: { type: "this" } }],
      },
    ],
  },

  // Raya Fierce Protector — DON'T CROSS ME: challenges → gain lore per other damaged char in play
  "raya-fierce-protector": {
    abilities: [
      {
        type: "triggered",
        storyName: "DON'T CROSS ME",
        rulesText: "Whenever this character challenges another character, gain 1 lore for each other damaged character you have in play.",
        trigger: { on: "challenges" },
        effects: [
          {
            type: "gain_lore",
            amount: {
              type: "count",
              filter: { ...ALL_OWN_CHARS, hasDamage: true, excludeSelf: true },
            },
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // Sisu Emboldened Warrior — SURGE OF POWER: +1 strength per card in opponents' hands
  "sisu-emboldened-warrior": {
    abilities: [
      {
        type: "static",
        storyName: "SURGE OF POWER",
        rulesText: "This character gets +1 {S} for each card in opponents' hands.",
        effect: {
          type: "modify_stat_per_count",
          stat: "strength",
          perCount: 1,
          countFilter: { owner: { type: "opponent" }, zone: "hand" },
          target: { type: "this" },
        },
      },
    ],
  },

  // The Plank — activated banish_self + 2 ink, choose: banish Hero OR ready Villain + cant quest
  "the-plank": {
    abilities: [
      {
        type: "activated",
        storyName: "WALK!",
        rulesText: "2 {I}, Banish this item — Choose one: banish chosen Hero character; or ready chosen Villain character. They can't quest for the rest of this turn.",
        costs: [
          { type: "pay_ink", amount: 2 },
          { type: "banish_self" },
        ],
        effects: [
          {
            type: "choose",
            options: [
              [
                {
                  type: "banish",
                  target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Hero" } },
                },
              ],
              [
                {
                  type: "ready",
                  target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Villain" } },
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
            ],
          },
        ],
      },
    ],
  },

  // Vitalisphere — activated banish_self + 1 ink → grant Rush + +2 strength chosen this turn
  "vitalisphere": {
    abilities: [
      {
        type: "activated",
        storyName: "EXTRACT OF RUBY",
        rulesText: "1 {I}, Banish this item — Chosen character gains Rush and gets +2 {S} this turn.",
        costs: [
          { type: "pay_ink", amount: 1 },
          { type: "banish_self" },
        ],
        effects: [
          {
            type: "grant_keyword",
            keyword: "rush",
            target: { type: "chosen", filter: { ...ANY_CHAR } },
            duration: "end_of_turn",
            followUpEffects: [
              {
                type: "gain_stats",
                strength: 2,
                target: { type: "this" },
                duration: "this_turn",
              },
            ],
          },
        ],
      },
    ],
  },

  // Training Grounds — STRENGTH OF MIND: activated 1 ink → +1 strength chosen here this turn
  "training-grounds-impossible-pillar": {
    abilities: [
      {
        type: "activated",
        storyName: "STRENGTH OF MIND",
        rulesText: "1 {I} — Chosen character here gets +1 {S} this turn.",
        costs: [{ type: "pay_ink", amount: 1 }],
        effects: [
          {
            type: "gain_stats",
            strength: 1,
            target: { type: "chosen", filter: { ...ANY_CHAR, atLocation: "this" } },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // Iduna Caring Mother — ENDURING LOVE: is_banished + may → put self in inkwell exerted
  "iduna-caring-mother": {
    abilities: [
      {
        type: "triggered",
        storyName: "ENDURING LOVE",
        rulesText: "When this character is banished, you may put this card into your inkwell facedown and exerted.",
        trigger: { on: "is_banished" },
        effects: [
          {
            type: "move_to_inkwell",
            isMay: true,
            enterExerted: true,
            target: { type: "this" },
          },
        ],
      },
    ],
  },

  // Field of Ice — ICY DEFENSE: card_played character → grant Resist +1 until your next turn
  "field-of-ice": {
    abilities: [
      {
        type: "triggered",
        storyName: "ICY DEFENSE",
        rulesText: "Whenever you play a character, they gain Resist +1 until the start of your next turn.",
        trigger: { on: "card_played", filter: { cardType: ["character"] } },
        effects: [
          {
            type: "grant_keyword",
            keyword: "resist",
            value: 1,
            target: { type: "triggering_card" },
            duration: "until_caster_next_turn",
          },
        ],
      },
    ],
  },

  // Ariel's Grotto — TREASURE TROVE: while 3+ items in play, +2 lore self
  "ariel-s-grotto-a-secret-place": {
    abilities: [
      {
        type: "static",
        storyName: "TREASURE TROVE",
        rulesText: "While you have 3 or more items in play, this location gets +2 {L}.",
        condition: {
          type: "cards_in_zone_gte",
          zone: "play",
          amount: 3,
          player: { type: "self" },
          cardType: ["item"],
        },
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: 2,
          target: { type: "this" },
        },
      },
    ],
  },

  // Ariel Determined Mermaid — I WANT MORE: card_played song → may draw + then discard a card
  "ariel-determined-mermaid": {
    abilities: [
      {
        type: "triggered",
        storyName: "I WANT MORE",
        rulesText: "Whenever you play a song, you may draw a card, then choose and discard a card.",
        trigger: { on: "card_played", filter: { cardType: ["action"], hasTrait: "Song" } },
        effects: [
          { type: "draw", amount: 1, isMay: true, target: { type: "self" } },
          {
            type: "discard_from_hand",
            amount: 1,
            target: { type: "self" },
            chooser: "controller",
          },
        ],
      },
    ],
  },

  // Donald Duck Buccaneer — BOARDING PARTY: banished_other_in_challenge during your turn → other chars +1 lore this turn
  "donald-duck-buccaneer": {
    abilities: [
      {
        type: "triggered",
        storyName: "BOARDING PARTY",
        rulesText: "During your turn, whenever this character banishes a character in a challenge, your other characters get +1 {L} this turn.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [
          {
            type: "gain_stats",
            lore: 1,
            target: { type: "all", filter: { ...ALL_OWN_CHARS, excludeSelf: true } },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // Fortisphere — RESOURCEFUL: enters_play, may draw a card
  "fortisphere": {
    abilities: [
      {
        type: "triggered",
        storyName: "RESOURCEFUL",
        rulesText: "When you play this item, you may draw a card.",
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 1, isMay: true, target: { type: "self" } }],
      },
    ],
  },

  // Imperial Bow — WITHIN RANGE: chosen Hero gains Challenger +2 + Evasive this turn
  "imperial-bow": {
    abilities: [
      {
        type: "activated",
        storyName: "WITHIN RANGE",
        rulesText: "Chosen Hero character gains Challenger +2 and Evasive this turn.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "grant_keyword",
            keyword: "challenger",
            value: 2,
            target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Hero" } },
            duration: "end_of_turn",
            followUpEffects: [
              {
                type: "grant_keyword",
                keyword: "evasive",
                target: { type: "this" },
                duration: "end_of_turn",
              },
            ],
          },
        ],
      },
    ],
  },

  // RLS Legacy's Cannon — BA-BOOM!: activated exert + 2 ink + discard → 2 damage to chosen char or location
  "rls-legacys-cannon": {
    abilities: [
      {
        type: "activated",
        storyName: "BA-BOOM!",
        rulesText: "{E}, 2 {I}, Discard a card — Deal 2 damage to chosen character or location.",
        costs: [
          { type: "exert" },
          { type: "pay_ink", amount: 2 },
          { type: "discard", filter: { zone: "hand" }, amount: 1 },
        ],
        effects: [
          {
            type: "deal_damage",
            amount: 2,
            target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } },
          },
        ],
      },
    ],
  },

  // We Don't Talk About Bruno — return chosen character + random discard from that player
  "we-don-t-talk-about-bruno": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { ...ANY_CHAR } },
      },
      {
        // "then that player discards a card at random" — uses target_owner of last chosen
        type: "discard_from_hand",
        amount: 1,
        target: { type: "target_owner" },
        chooser: "random",
      },
    ],
  },

  // (reprint id "we-dont-talk-about-bruno" without the apostrophe)
  "we-dont-talk-about-bruno": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { ...ANY_CHAR } },
      },
      {
        type: "discard_from_hand",
        amount: 1,
        target: { type: "target_owner" },
        chooser: "random",
      },
    ],
  },

  // Hidden Inkcaster — FRESH INK only (UNEXPECTED TREASURE virtual ink color is a new mechanic)
  "hidden-inkcaster": {
    abilities: [
      {
        type: "triggered",
        storyName: "FRESH INK",
        rulesText: "When you play this item, draw a card.",
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // Avalanche — deal 1 damage each opposing character + may banish chosen location
  "avalanche": {
    actionEffects: [
      {
        type: "deal_damage",
        amount: 1,
        target: { type: "all", filter: { ...ALL_OPP_CHARS } },
      },
      {
        type: "banish",
        isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["location"] } },
      },
    ],
  },

  // Snuggly Duckling — quests-while-here trigger, gain 1 lore (skip the conditional 6+ branch)
  "snuggly-duckling-disreputable-pub": {
    abilities: [
      {
        type: "triggered",
        storyName: "ROUTINE RUCKUS",
        rulesText: "Whenever a character with 3 {S} or more challenges another character while here, gain 1 lore.",
        trigger: {
          on: "challenges",
          filter: { ...ANY_CHAR, atLocation: "this", strengthAtLeast: 3 },
        },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
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
