#!/usr/bin/env node
// Set 4 — Batch 10: wire remaining cards, leveraging newly-added engine features:
//   - look_at_top "up_to_n_to_hand_rest_bottom"
//   - condition "self_has_more_than_each_opponent"
//   - condition "this_location_has_exerted_character"
//   - trigger "deals_damage_in_challenge"
// Some cards remain approximated or skipped — see comments.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OPP_CHARS = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {
  // ── Inverse-sequential discard songs ──────────────────────────────────
  // Sign the Scroll / Ursula's Trickery: "Each opponent may discard a card.
  // For each opponent who doesn't, <reward>." In 2P this collapses to "opponent
  // may discard; if they don't, <reward>". We approximate with choose_may discard
  // of any hand card OR fallback reward. Since engine's discard_from_hand is
  // forced-choose-card-in-hand, approximate: opponent discards 1 random card.
  // Net effect: strictly worse for the caster than printed (no lore/draw).
  // NOTE: retained as approximation — proper "for each opponent who doesn't discard"
  // requires an inverse-sequential mechanism. Keeping as-is for now.
  // (skipped)

  // ── Flynn Rider - Frenemy — new comparative-strength condition ──────────
  "flynn-rider-frenemy": {
    abilities: [
      {
        type: "triggered",
        storyName: "NARROW ADVANTAGE",
        rulesText: "At the start of your turn, if you have a character in play with more {S} than each opposing character, gain 3 lore.",
        trigger: { on: "turn_start", player: { type: "self" } },
        condition: { type: "self_has_more_than_each_opponent", metric: "strength_in_play" },
        effects: [{ type: "gain_lore", amount: 3, target: { type: "self" } }],
      },
    ],
  },

  // ── Ariel - Treasure Collector — +2 lore while more items than opp ──────
  "ariel-treasure-collector": {
    abilities: [
      {
        type: "static",
        storyName: "THE GIRL WHO HAS EVERYTHING",
        rulesText: "While you have more items in play than each opponent, this character gets +2 {L}.",
        condition: { type: "self_has_more_than_each_opponent", metric: "items_in_play" },
        effect: { type: "modify_stat", stat: "lore", modifier: 2, target: { type: "this" } },
      },
    ],
  },

  // ── HeiHei - Bumbling Rooster — uses "more cards in inkwell than you" ───
  // Text: "if an opponent has more cards in their inkwell than you". In 2P
  // that's `not self_has_more_than_each_opponent(cards_in_inkwell)` — but we
  // also need to exclude the exact-equal case. The new condition checks strict
  // "self > opp"; the card wants "opp > self" which is the reverse. Use a
  // cards_in_zone_gte + reverse check. We can compose with `not`: true when
  // NOT (self >= opp). We don't have self_gte — use explicit wording: we'll
  // accept the approximation where it fires when self does NOT have strictly
  // more inkwell cards than opp (so also fires on ties). Close enough.
  "heihei-bumbling-rooster": {
    abilities: [
      {
        type: "triggered",
        storyName: "FATTEN YOU UP",
        rulesText: "When you play this character, if an opponent has more cards in their inkwell than you, you may put the top card of your deck into your inkwell facedown and exerted. (approximation: triggers when not strictly ahead in inkwell)",
        trigger: { on: "enters_play" },
        condition: {
          type: "not",
          condition: { type: "self_has_more_than_each_opponent", metric: "cards_in_inkwell" },
        },
        effects: [
          {
            type: "reveal_top_conditional",
            filter: {},
            matchAction: "to_inkwell_exerted",
            isMay: true,
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ── Ursula's Garden — while exerted character here, opp chars get -1 lore ──
  "ursula-s-garden-full-of-the-unfortunate": {
    abilities: [
      {
        type: "static",
        storyName: "ABANDON HOPE",
        rulesText: "While you have an exerted character here, opposing characters get -1 {L}.",
        condition: { type: "this_location_has_exerted_character" },
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: -1,
          target: { type: "all", filter: { ...OPP_CHARS } },
        },
      },
    ],
  },

  // ── The Wall - Border Fortress — other locations can't be challenged ──────
  // Uses this_location_has_exerted_character gate + cant_be_challenged on
  // "all matching" (your other locations). Approximation: protect any location.
  "the-wall-border-fortress": {
    abilities: [
      {
        type: "static",
        storyName: "PROTECT THE REALM",
        rulesText: "While you have an exerted character here, your other locations can't be challenged.",
        condition: { type: "this_location_has_exerted_character" },
        effect: {
          type: "cant_be_challenged",
          target: {
            type: "all",
            filter: {
              owner: { type: "self" },
              zone: "play",
              cardType: ["location"],
              excludeSelf: true,
            },
          },
        },
      },
    ],
  },

  // ── Thebes - The Big Olive — banished_other_in_challenge while here ──────
  "thebes-the-big-olive": {
    abilities: [
      {
        type: "triggered",
        storyName: "IF YOU CAN MAKE IT HERE...",
        rulesText: "During your turn, whenever a character banishes another character in a challenge while here, gain 2 lore.",
        trigger: { on: "banished_other_in_challenge", filter: { ...ANY_CHAR, atLocation: "this" } },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
      },
    ],
  },

  // ── Diablo - Devoted Herald — opponent draws while exerted ──────────────
  "diablo-devoted-herald": {
    abilities: [
      {
        type: "triggered",
        storyName: "CIRCLE FAR AND WIDE",
        rulesText: "During each opponent's turn, whenever they draw a card while this character is exerted, you may draw a card.",
        trigger: { on: "card_drawn", player: { type: "opponent" } },
        condition: { type: "this_is_exerted" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
      },
    ],
  },

  // ── Mulan - Elite Archer — deals_damage_in_challenge trigger (approximation: deal 2 damage to 1 target) ──
  "mulan-elite-archer": {
    abilities: [
      {
        type: "triggered",
        storyName: "STRAIGHT SHOOTER",
        rulesText: "When you play this character, if you used Shift to play her, she gets +3 {S} this turn.",
        trigger: { on: "enters_play" },
        condition: { type: "played_via_shift" },
        effects: [
          {
            type: "modify_stat",
            stat: "strength",
            modifier: 3,
            target: { type: "this" },
            duration: "end_of_turn",
          },
        ],
      },
      {
        type: "triggered",
        storyName: "TRIPLE SHOT",
        rulesText: "During your turn, whenever this character deals damage to another character in a challenge, deal the same amount of damage to up to 2 other chosen characters. (approximation: deals 2 damage to 1 chosen character)",
        trigger: { on: "deals_damage_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [
          {
            type: "deal_damage",
            amount: 2,
            target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
          },
        ],
      },
    ],
  },

  // ── Namaari - Heir of Fang — same shape, single damage ──────────────────
  "namaari-heir-of-fang": {
    abilities: [
      {
        type: "triggered",
        storyName: "TWO-WEAPON FIGHTING",
        rulesText: "During your turn, whenever this character deals damage to another character in a challenge, you may deal the same amount of damage to another chosen character. (approximation: deals 3 damage)",
        trigger: { on: "deals_damage_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [
          {
            type: "deal_damage",
            amount: 3,
            target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
          },
        ],
      },
    ],
  },

  // ── Zeus - Mr. Lightning Bolts — +S equal to target's S (approximation: +3) ──
  "zeus-mr-lightning-bolts": {
    abilities: [
      {
        type: "triggered",
        storyName: "TARGET PRACTICE",
        rulesText: "Whenever this character challenges another character, he gets +{S} equal to the {S} of chosen character this turn. (approximation: +3 strength)",
        trigger: { on: "challenges" },
        effects: [
          {
            type: "modify_stat",
            stat: "strength",
            modifier: 3,
            target: { type: "this" },
            duration: "end_of_turn",
          },
        ],
      },
    ],
  },

  // ── Look at This Family — Sing Together song, look at top 5, up to 2 chars to hand ──
  "look-at-this-family": {
    actionEffects: [
      {
        type: "look_at_top",
        count: 5,
        action: "up_to_n_to_hand_rest_bottom",
        maxToHand: 2,
        filter: { cardType: ["character"] },
        target: { type: "self" },
      },
    ],
  },

  // ── Dig a Little Deeper — top 7, put 2 into hand ────────────────────────
  "dig-a-little-deeper": {
    actionEffects: [
      {
        type: "look_at_top",
        count: 7,
        action: "up_to_n_to_hand_rest_bottom",
        maxToHand: 2,
        target: { type: "self" },
      },
    ],
  },

  // ── The Queen - Diviner — activated ability, top 4 look, up to 1 item to hand ──
  // "play it for free if cost ≤ 3" escalation is skipped (approximation).
  "the-queen-diviner": {
    abilities: [
      {
        type: "activated",
        storyName: "CONSULT THE SPELLBOOK",
        rulesText: "{E} — Look at the top 4 cards of your deck. You may reveal an item card and put it into your hand. (approximation: free-play escalation for cost ≤3 items is skipped)",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "look_at_top",
            count: 4,
            action: "up_to_n_to_hand_rest_bottom",
            maxToHand: 1,
            filter: { cardType: ["item"] },
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ── Bruno Madrigal - Undetected Uncle — name-a-card then reveal ─────────
  // Approximation: "gain 3 lore on hit" follow-up is dropped.
  "bruno-madrigal-undetected-uncle": {
    abilities: [
      {
        type: "activated",
        storyName: "YOU JUST HAVE TO SEE IT",
        rulesText: "{E} — Name a card, then reveal the top card of your deck. If it's the named card, put that card into your hand and gain 3 lore. Otherwise, put it on the top of your deck. (approximation: lore gain on hit skipped)",
        costs: [{ type: "exert" }],
        effects: [{ type: "name_a_card_then_reveal", target: { type: "self" } }],
      },
    ],
  },

  // ── LeFou - Opportunistic Flunky — self-cost reduction gated on condition ──
  // base cost 3 → amount: 99 clamped to 0.
  "lefou-opportunistic-flunky": {
    abilities: [
      {
        type: "static",
        storyName: "I LEARNED FROM THE BEST",
        rulesText: "During your turn, you may play this character for free if an opposing character was banished in a challenge this turn.",
        condition: {
          type: "compound_and",
          conditions: [
            { type: "is_your_turn" },
            { type: "opponent_character_was_banished_in_challenge_this_turn" },
          ],
        },
        effect: { type: "self_cost_reduction", amount: 99 },
      },
    ],
  },

  // ── Noi - Acrobatic Baby — action-play grants challenge-damage immunity ──
  // Approximation: skipped because floating challenge-damage immunity duration
  // is not supported. (requires new timed static effect)

  // ── Alma Madrigal - Family Matriarch — search deck for Madrigal to hand ──
  // Printed text: to top of deck + reveal. Approximation: straight tutor to hand.
  "alma-madrigal-family-matriarch": {
    abilities: [
      {
        type: "triggered",
        storyName: "TO THE TABLE",
        rulesText: "When you play this character, you may search your deck for a Madrigal character card and reveal that card to all players. Shuffle your deck and put that card on top of it. (approximation: put into hand instead of top of deck)",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "search",
            filter: { cardType: ["character"], hasTrait: "Madrigal" },
            target: { type: "self" },
            zone: "deck",
            putInto: "hand",
          },
        ],
      },
    ],
  },

  // ── Prince Phillip - Gallant Defender — Support grants Resist +1 ──
  // Skipped: no on_support_chosen trigger type.

  // ── Ariel - Sonic Warrior — song-play pay-trigger ──
  // Complex: requires "pay X as part of trigger" pattern. Skip for now.

  // ── Isabela Madrigal - Golden Child — turn-flag "no other questing" + lockdown ──
  // Needs turn tracking. Skip.

  // ── Hades Double Dealer — complex activated. Skip.

  // ── Tuk Tuk Lively Partner — move two chars to location + buff. Skip.

  // ── Medallion Weights — grant floating ability on activated. Skip.

  // ── Atlantica Concert Hall — virtual sing cost modifier. Skip.

  // ── Flotsam & Jetsam Entangling Eels — dual name. Skip.

  // ── The Mob Song — multi-target deal 3. Approximation: deal 3 to 1 target.
  "the-mob-song": {
    actionEffects: [
      {
        type: "deal_damage",
        amount: 3,
        target: { type: "chosen", filter: { ...ANY_CHAR } },
      },
    ],
  },

  // ── Pepa Madrigal Weather Maker — exert chosen opp + can't ready unless at location.
  // Approximation: exert chosen opp, and apply a plain cant_action: ready with
  // end_of_owner_next_turn. (drops the "unless at location" escape clause)
  "pepa-madrigal-weather-maker": {
    abilities: [
      {
        type: "triggered",
        storyName: "IT LOOKS LIKE RAIN",
        rulesText: "When you play this character, you may exert chosen opposing character. That character can't ready at the start of their next turn unless they're at a location. (approximation: unconditional can't-ready)",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "exert",
            target: { type: "chosen", filter: { ...OPP_CHARS } },
            isMay: true,
            followUpEffects: [
              {
                type: "cant_action",
                action: "ready",
                target: { type: "chosen", filter: { ...OPP_CHARS } },
                duration: "end_of_owner_next_turn",
              },
            ],
          },
        ],
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
    if (patch.abilities) card.abilities = patch.abilities;
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    patched++;
    if (!seen.has(card.id)) {
      console.log(`  OK ${card.id}`);
      seen.add(card.id);
    }
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 4.`);
