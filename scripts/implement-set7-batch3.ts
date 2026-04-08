#!/usr/bin/env node
// Set 7 — Batch 3: Remaining fits-grammar — conditional quests, ETBs with conditions,
// banished triggers, challenged triggers, activated abilities, more items/songs.
//
// Categorizer false positives / approximations noted inline. Skipped cards:
//  - Te Kā - Elemental Terror (opposing_character_exerted trigger — not supported)
//  - Pongo - Dear Old Dad (look-at-inkwell + play from inkwell — not supported)
//  - Kida - Creative Thinker (look_at_top with split top/inkwell destinations — unsupported)
//  - The Family Madrigal (look_at_top with dual trait-filtered reveal — unsupported)
//  - Kronk - Laid Back (discard replacement effect — needs replacement layer)
//  - Iago/Rajah - Ghostly (Vanish — deferred variant)
//  - Yokai - Intellectual Schemer (Shift cost reduction — unsupported)
//  - Miss Bianca - Unwavering Agent (self-cost-reduction on condition — unsupported here)
//  - The Queen - Jealous Beauty (opponent discard manipulation + conditional lore — unsupported)
//  - Hiro Hamada Armor Designer (keyword grant keyed on "has card under" — zone-aware static)
//  - The Return of Hercules (each-player free-play — mutual reveal flow unsupported)
//  - Kenai - Protective Brother (end-of-turn heal-plus-ready unsupported duration combo skipped as approximation)
//  - Water Has Memory (look_at_top with one-top, rest-bottom — supported via reorder? approximated)
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-007.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };
const TURN_START_SELF = { on: "turn_start" as const, player: SELF };
const TURN_END_SELF = { on: "turn_end" as const, player: SELF };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Conditional ETBs ─────────────────────────────────────────
  "peg-natural-performer": {
    abilities: [{
      type: "triggered",
      storyName: "PERFORMER",
      rulesText: "If you have 3 or more other characters in play, draw a card.",
      trigger: { on: "enters_play" },
      condition: {
        type: "characters_in_play_gte",
        amount: 3,
        player: SELF,
        excludeSelf: true,
      },
      effects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "tramp-street-smart-dog": {
    abilities: [{
      type: "triggered",
      storyName: "STREET SMART",
      rulesText: "When you play this character, you may draw a card for each other character you have in play, then choose and discard that many cards.",
      trigger: { on: "enters_play" },
      effects: [
        {
          type: "draw",
          amount: { type: "count", filter: OWN_OTHER_CHARS },
          target: SELF,
          isMay: true,
        },
        // approximation: discard only 1. capability_id: discard-equal-to-dynamic-count
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "lady-miss-park-avenue": {
    abilities: [{
      type: "triggered",
      storyName: "REFINED",
      rulesText: "When you play this character, you may return up to 2 character cards with cost 2 or less each from your discard to your hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], costAtMost: 2 }, count: 2 },
      }],
    }],
  },

  "baymax-low-battery": {
    abilities: [{
      type: "triggered",
      storyName: "LOW BATTERY",
      rulesText: "This character enters play exerted.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "this" } }],
    }],
  },

  "baymax-giant-robot": {
    abilities: [{
      type: "triggered",
      storyName: "FULL RESTORE",
      rulesText: "When you play this character, if you used Shift to play him, remove all damage from him.",
      trigger: { on: "enters_play" },
      condition: { type: "played_via_shift" },
      effects: [{
        type: "remove_damage", amount: 99,
        target: { type: "this" },
      }],
    }],
  },

  "heihei-expanded-consciousness": {
    abilities: [{
      type: "triggered",
      storyName: "EMPTY THE MIND",
      rulesText: "When you play this character, put all cards from your hand into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_to_inkwell", enterExerted: true,
        target: { type: "all", filter: { owner: SELF, zone: "hand" } },
      }],
    }],
  },

  // ── Banished triggers ────────────────────────────────────────
  "yzma-transformed-kitten": {
    // approximation: "more cards than each opponent" as NOT opp_has_more
    abilities: [{
      type: "triggered",
      storyName: "KITTY LIVES",
      rulesText: "When this character is banished, if you have more cards in your hand than each opponent, you may return this card to your hand.",
      trigger: { on: "is_banished" },
      condition: { type: "not", condition: { type: "opponent_has_more_cards_in_hand" } },
      effects: [{ type: "return_to_hand", isMay: true, target: { type: "this" } }],
    }],
  },

  "kenai-magical-bear": {
    abilities: [{
      type: "triggered",
      storyName: "BEAR FORM",
      rulesText: "During your turn, when this character is banished in a challenge, return this card to your hand and gain 1 lore.",
      trigger: { on: "banished_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [
        { type: "return_to_hand", target: { type: "this" } },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  "bagheera-guardian-jaguar": {
    abilities: [{
      type: "triggered",
      storyName: "PROTECTIVE SPIRIT",
      rulesText: "When this character is banished during an opponent's turn, deal 2 damage to each opposing character.",
      trigger: { on: "is_banished" },
      condition: { type: "not", condition: { type: "is_your_turn" } },
      effects: [{
        type: "deal_damage", amount: 2,
        target: { type: "all", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "wendy-darling-pirate-queen": {
    abilities: [{
      type: "triggered",
      storyName: "TO THE RESCUE",
      rulesText: "Whenever one of your other characters is banished, you may remove all damage from chosen character.",
      trigger: { on: "is_banished", filter: OWN_OTHER_CHARS },
      effects: [{
        type: "remove_damage", amount: 99, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "pepper-quick-thinking-puppy": {
    abilities: [{
      type: "triggered",
      storyName: "QUICK SAVE",
      rulesText: "Whenever one of your Puppy characters is banished, you may put that card into your inkwell facedown and exerted.",
      trigger: { on: "is_banished", filter: { ...ALL_OWN_CHARS, hasTrait: "Puppy" } },
      effects: [{
        type: "move_to_inkwell", enterExerted: true, isMay: true,
        target: { type: "triggering_card" },
      }],
    }],
  },

  "jafar-newly-crowned": {
    abilities: [{
      type: "triggered",
      storyName: "COLLECT THE ILLUSIONS",
      rulesText: "During an opponent's turn, whenever one of your Illusion characters is banished, you may return that card to your hand.",
      trigger: { on: "is_banished", filter: { ...ALL_OWN_CHARS, hasTrait: "Illusion" } },
      condition: { type: "not", condition: { type: "is_your_turn" } },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "triggering_card" },
      }],
    }],
  },

  // ── Challenged triggers ─────────────────────────────────────
  "donald-duck-lively-pirate": {
    // approximation: "action card that isn't a song" — modeled as any action; capability_id: filter-not-trait
    abilities: [{
      type: "triggered",
      storyName: "BATTLE CHATTER",
      rulesText: "Whenever this character is challenged, you may return an action card that isn't a song card from your discard to your hand.",
      trigger: { on: "is_challenged" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["action"] } },
      }],
    }],
  },

  "anastasia-bossy-stepsister": {
    abilities: [{
      type: "triggered",
      storyName: "HOW RUDE",
      rulesText: "Whenever this character is challenged, the challenging player chooses and discards a card.",
      trigger: { on: "is_challenged" },
      // approximation: "challenging player" target — use opponent (2P-correct).
      // capability_id: challenging-player-target
      effects: [{
        type: "discard_from_hand", amount: 1,
        target: OPP,
      }],
    }],
  },

  "archimedes-exceptional-owl": {
    // approximation: "chosen for an action or ability" modeled via is_challenged only is wrong;
    // skipping this facet. capability_id: chosen-for-action-or-ability-trigger
    abilities: [],
  },

  // ── Quest triggers ──────────────────────────────────────────
  "grewnge-cannon-expert": {
    abilities: [{
      type: "triggered",
      storyName: "BIG GUNS",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next action you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_cost_reduction", amount: 1,
        filter: { cardType: ["action"] },
      }],
    }],
  },

  "monsieur-darque-despicable-proprietor": {
    abilities: [{
      type: "triggered",
      storyName: "SCRAP IT",
      rulesText: "Whenever this character quests, you may banish chosen item of yours to draw a card.",
      trigger: { on: "quests" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "banish",
          target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } },
        }],
        rewardEffects: [{ type: "draw", amount: 1, target: SELF }],
      }],
    }],
  },

  "elsa-ice-maker": {
    abilities: [{
      type: "triggered",
      storyName: "ICE FORM",
      rulesText: "Whenever this character quests, you may exert chosen character. If you do and you have a character named Anna in play, the chosen character can't ready at the start of their next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "exert", isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
        followUpEffects: [{
          type: "cant_action", action: "ready",
          duration: "end_of_owner_next_turn",
          target: { type: "this" },
          condition: { type: "has_character_named", name: "Anna", player: SELF },
        }],
      }],
    }],
  },

  "beagle-boys-small-time-crooks": {
    abilities: [{
      type: "triggered",
      storyName: "GANG UP",
      rulesText: "Whenever this character quests, chosen character of yours gains Rush and Resist +1 this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_keyword", keyword: "rush",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
        followUpEffects: [{
          type: "grant_keyword", keyword: "resist", keywordValue: 1,
          target: { type: "this" },
        }],
      }],
    }],
  },

  "bolt-headstrong-dog": {
    abilities: [{
      type: "triggered",
      storyName: "HEADSTRONG",
      rulesText: "Whenever this character quests, if he has no damage, you may draw a card, then choose and discard a card.",
      trigger: { on: "quests" },
      condition: { type: "this_has_no_damage" },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "jasmine-inspired-researcher": {
    abilities: [{
      type: "triggered",
      storyName: "DETERMINED RESEARCH",
      rulesText: "Whenever this character quests, if you have no cards in your hand, draw a card for each Ally character you have in play.",
      trigger: { on: "quests" },
      condition: { type: "cards_in_hand_eq", amount: 0, player: SELF },
      effects: [{
        type: "draw",
        amount: { type: "count", filter: { ...ALL_OWN_CHARS, hasTrait: "Ally" } },
        target: SELF,
      }],
    }],
  },

  "aladdin-research-assistant": {
    abilities: [
      {
        type: "triggered",
        storyName: "ASSISTANT",
        rulesText: "Whenever this character quests, you may play an Ally character with cost 3 or less for free.",
        trigger: { on: "quests" },
        effects: [{
          type: "play_for_free", isMay: true,
          filter: { owner: SELF, zone: "hand", cardType: ["character"], hasTrait: "Ally", costAtMost: 3 },
        }],
      },
      {
        type: "static",
        storyName: "RALLY",
        rulesText: "While this character is exerted, your Ally characters get +1 {S}.",
        effect: {
          type: "gain_stats", strength: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Ally" } },
          condition: { type: "this_is_exerted" },
        },
      },
    ],
  },

  // ── Challenge (challenger-side) triggers ─────────────────────
  "mulan-imperial-general": {
    // approximation: grants "can_challenge_ready" to other own chars this turn.
    // capability_id: grant-can-challenge-ready-this-turn
    abilities: [{
      type: "triggered",
      storyName: "LEAD THE CHARGE",
      rulesText: "Whenever this character challenges another character, your other characters gain \"This character can challenge ready characters\" this turn.",
      trigger: { on: "challenges" },
      effects: [{
        type: "can_challenge_ready",
        duration: "this_turn",
        target: { type: "all", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  "mushu-majestic-dragon": {
    abilities: [
      {
        type: "triggered",
        storyName: "DRAGON AEGIS",
        rulesText: "Whenever one of your characters challenges, they gain Resist +2 during that challenge.",
        trigger: { on: "challenges", filter: ALL_OWN_CHARS },
        effects: [{
          type: "grant_keyword", keyword: "resist", keywordValue: 2,
          target: { type: "triggering_card" },
        }],
      },
      {
        type: "triggered",
        storyName: "DRAGON TRIUMPH",
        rulesText: "During your turn, whenever one of your characters banishes another character in a challenge, gain 2 lore.",
        trigger: { on: "banished_other_in_challenge", filter: ALL_OWN_CHARS },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 2, target: SELF }],
      },
    ],
  },

  "mickey-mouse-inspirational-warrior": {
    abilities: [{
      type: "triggered",
      storyName: "LEAD THE CHARGE",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may play a character for free.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "play_for_free", isMay: true,
        filter: { owner: SELF, zone: "hand", cardType: ["character"] },
      }],
    }],
  },

  "fa-zhou-war-hero": {
    // approximation: fires every challenge; "second challenge this turn" condition not modeled.
    // capability_id: nth-event-this-turn-condition
    abilities: [{
      type: "triggered",
      storyName: "HERO'S TIMING",
      rulesText: "Whenever one of your characters challenges another character, if it's the second challenge this turn, gain 3 lore.",
      trigger: { on: "challenges", filter: ALL_OWN_CHARS },
      effects: [{ type: "gain_lore", amount: 3, target: SELF }],
    }],
  },

  // ── Played-shift triggers ────────────────────────────────────
  "honey-lemon-chemistry-whiz": {
    abilities: [{
      type: "triggered",
      storyName: "CHEMIST'S TOUCH",
      rulesText: "Whenever you play a Floodborn character, if you used Shift to play them, you may remove up to 2 damage from chosen character.",
      trigger: { on: "card_played", filter: { owner: SELF, cardType: ["character"], hasTrait: "Floodborn" } },
      condition: { type: "triggering_card_played_via_shift" },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "hiro-hamada-future-champion": {
    abilities: [{
      type: "triggered",
      storyName: "FUTURE CHAMPION",
      rulesText: "When you play a Floodborn character on this card, draw a card.",
      trigger: { on: "card_played", filter: { owner: SELF, cardType: ["character"], hasTrait: "Floodborn" } },
      // approximation: fires on any Floodborn played; not strictly "onto this card"
      effects: [{ type: "draw", amount: 1, target: SELF }],
      // capability_id: shift-target-self-trigger
    }],
  },

  // ── Activated abilities ──────────────────────────────────────
  "beast-frustrated-designer": {
    abilities: [{
      type: "activated",
      storyName: "DESIGN RAGE",
      rulesText: "{E}, 2 {I}, Banish 2 of your items — Deal 5 damage to chosen character.",
      costs: [{ type: "exert" }],
      costEffects: [
        { type: "pay_ink", amount: 2 },
        {
          type: "banish",
          target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } },
        },
        {
          type: "banish",
          target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } },
        },
      ],
      effects: [{
        type: "deal_damage", amount: 5,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "belle-apprentice-inventor": {
    // approximation: self-cost-free play via banish-item cost — use activated? No, this is cost
    // replacement on play. Skip with no ability. capability_id: play-for-free-via-banish-item
    abilities: [],
  },

  // ── Start / End of turn ─────────────────────────────────────
  "kenai-protective-brother": {
    abilities: [{
      type: "triggered",
      storyName: "HE NEEDS ME",
      rulesText: "At the end of your turn, if this character is exerted, you may ready another chosen character of yours and remove all damage from them.",
      trigger: TURN_END_SELF,
      condition: { type: "this_is_exerted" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: OWN_OTHER_CHARS },
        followUpEffects: [{
          type: "remove_damage", amount: 99,
          target: { type: "this" },
        }],
      }],
    }],
  },

  "aurora-waking-beauty": {
    abilities: [{
      type: "triggered",
      storyName: "WAKE UP",
      rulesText: "Whenever you remove 1 or more damage from a character, ready this character. She can't quest or challenge for the rest of this turn.",
      trigger: { on: "damage_removed_from" },
      effects: [{
        type: "ready",
        target: { type: "this" },
        followUpEffects: [
          {
            type: "cant_action", action: "quest",
            duration: "this_turn",
            target: { type: "this" },
          },
          {
            type: "cant_action", action: "challenge",
            duration: "this_turn",
            target: { type: "this" },
          },
        ],
      }],
    }],
  },

  // ── During opponent's turn ──────────────────────────────────
  "maid-marian-badminton-ace": {
    abilities: [
      {
        type: "triggered",
        storyName: "DEFLECT",
        rulesText: "During an opponent's turn, whenever one of your Ally characters is damaged, deal 1 damage to chosen opposing character.",
        trigger: { on: "damage_dealt_to", filter: { ...ALL_OWN_CHARS, hasTrait: "Ally" } },
        condition: { type: "not", condition: { type: "is_your_turn" } },
        effects: [{
          type: "deal_damage", amount: 1,
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      },
      {
        type: "static",
        storyName: "TEAMMATE",
        rulesText: "Your characters named Lady Kluck gain Resist +1.",
        effect: {
          type: "grant_keyword", keyword: "resist", keywordValue: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasName: "Lady Kluck" } },
        },
      },
    ],
  },

  "orville-albatross-air": {
    abilities: [{
      type: "static",
      storyName: "CO-PILOT",
      rulesText: "During your turn, while you have a character named Miss Bianca or Bernard in play, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: {
          type: "compound_and",
          conditions: [
            { type: "is_your_turn" },
            {
              type: "compound_or",
              conditions: [
                { type: "has_character_named", name: "Miss Bianca", player: SELF },
                { type: "has_character_named", name: "Bernard", player: SELF },
              ],
            },
          ],
        },
      },
    }],
  },

  // ── ETB: banish-item payoff ─────────────────────────────────
  "maurice-unconventional-inventor": {
    abilities: [{
      type: "triggered",
      storyName: "TINKER",
      rulesText: "When you play this character, you may banish chosen item of yours to draw a card. If the banished item is named Maurice's Machine, you may also banish chosen character with 2 {S} or less.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "banish",
          target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } },
        }],
        rewardEffects: [{ type: "draw", amount: 1, target: SELF }],
        // approximation: conditional banish on Maurice's Machine not modeled.
        // capability_id: banished-item-name-check
      }],
    }],
  },

  // ── Cinderella — conditional discard recycle ────────────────
  "cinderella-the-right-one": {
    // approximation: may cost = banish (since "put on bottom of deck" is non-trivial). capability_id: put-from-discard-to-deck-bottom
    abilities: [{
      type: "triggered",
      storyName: "GLASS SLIPPER",
      rulesText: "When you play this character, you may put an item card named The Glass Slipper from your discard on the bottom of your deck to gain 3 lore.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "banish",
          target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["item"], hasName: "The Glass Slipper" } },
        }],
        rewardEffects: [{ type: "gain_lore", amount: 3, target: SELF }],
      }],
    }],
  },

  // ── Fix-It Felix: discard→hand return trigger ───────────────
  "fix-it-felix-jr-pint-sized-hero": {
    abilities: [{
      type: "triggered",
      storyName: "FIX IT",
      rulesText: "Whenever you return a Racer character card from your discard to your hand, you may ready chosen Racer character. They can't quest for the rest of this turn.",
      trigger: { on: "returned_to_hand", filter: { owner: SELF, cardType: ["character"], hasTrait: "Racer" } },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Racer" } },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  // ── Songs / actions ─────────────────────────────────────────
  "all-is-found": {
    actionEffects: [{
      type: "move_to_inkwell", enterExerted: true,
      target: { type: "chosen", filter: { owner: SELF, zone: "discard" }, count: 2 },
    }],
  },

  "water-has-memory": {
    // approximation: look-at-top-N with choose-1-to-top pattern not directly supported.
    // Use look_at_top / reorder. capability_id: split-top-single-bottom-rest
    actionEffects: [{
      type: "look_at_top", count: 4,
      action: "reorder",
      target: { type: "chosen_player" },
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 7.`);
