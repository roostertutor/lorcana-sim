#!/usr/bin/env node
// =============================================================================
// REVEAL-TOP-CONDITIONAL family batch — wires cards across sets 5-11 that use
// the "reveal the top card of your deck; if <filter>, <action>; otherwise,
// <destination>" grammar (CRD 6.1.5 / 6.1.4 + CRD 8.9.x for play-for-free).
//
// Engine primitives: RevealTopConditionalEffect with matchAction in
// { to_hand, play_for_free, to_inkwell_exerted }, noMatchDestination in
// { top, bottom, hand, discard }, optional matchExtraEffects[].
// The name-a-card-then-reveal variants use NameACardThenRevealEffect instead
// (matches set 3 Sorcerer's Hat / set 4 Bruno wiring).
//
// Skipped (and why):
//   - [5] We Know the Way: dynamic "same name as chosen card" filter needs a
//     new primitive — filter referencing a chosen-card from the same effect.
//   - [6] Sisu - Uniting Dragon: "repeat this effect" on match is not yet a
//     supported primitive; also "put on top OR bottom" is a player choice not
//     modelled by noMatchDestination.
//   - [6] Oswald / [D23] Oswald: trigger is "whenever a card is put into your
//     inkwell" — no `card_put_into_inkwell` TriggerEvent exists yet.
//   - [7] Merlin - Clever Clairvoyant: name-a-card-then-reveal variant where
//     the match action is "put into your inkwell facedown and exerted", not
//     "to hand". NameACardThenRevealEffect only supports the to-hand action.
//   - [8] Chief Bogo: needs opponent-turn gate (no is_opponent_turn condition)
//     plus is_banished filtered by Bodyguard keyword on own chars. Partially
//     expressible but the opponent-turn gate is load-bearing (on-your-turn the
//     trigger would over-fire); skipping rather than shipping a broken approx.
//   - [11] Kristoff's Lute: "play it as if it were in your hand" is the
//     play-from-revealed capability, not play_for_free (player still pays
//     cost). Distinct gap label.
//
// Wired (11 cards across 8 card ids):
//   - [5] Pete - Wrestling Champ           (reveal_top_conditional)
//   - [6] King's Sensor Core                (reveal_top_conditional)
//   - [9] Bruno Madrigal - Undetected Uncle (name_a_card_then_reveal)
//   - [9] Pongo - Determined Father x2      (look_at_top, mirrors set 3 wiring)
//   - [11] John Smith's Compass             (reveal_top_conditional — approx)
//   - [D23] Bruno Madrigal - Undetected Uncle (name_a_card_then_reveal)
//
// Approximations noted in rulesText strings.
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type Patch = {
  set: "005" | "006" | "007" | "008" | "009" | "011" | "D23";
  id: string;
  abilities: any[];
};

const PATCHES: Patch[] = [
  // ────────────────────────── SET 5 ──────────────────────────

  // Pete - Wrestling Champ RE-PETE: {E} reveal top; if character named Pete,
  // you may play it for free. (No "otherwise" clause — card stays on top.)
  {
    set: "005",
    id: "pete-wrestling-champ",
    abilities: [
      {
        type: "activated",
        storyName: "RE-PETE",
        rulesText:
          "{E} — Reveal the top card of your deck. If it's a character card named Pete, you may play it for free.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "reveal_top_conditional",
            filter: { cardType: ["character"], hasName: "Pete" },
            matchAction: "play_for_free",
            isMay: true,
            noMatchDestination: "top",
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ────────────────────────── SET 6 ──────────────────────────

  // King's Sensor Core ROYAL SEARCH: mirrors Queen's Sensor Core. Also has
  // a static Resist +1 grant to own Prince/King characters.
  {
    set: "006",
    id: "kings-sensor-core",
    abilities: [
      {
        type: "static",
        storyName: "SYMBOL OF ROYALTY",
        rulesText:
          "Your Prince and King characters gain Resist +1. (Damage dealt to them is reduced by 1.)",
        effect: {
          type: "grant_keyword",
          keyword: "resist",
          value: 1,
          target: {
            type: "all",
            filter: {
              zone: "play",
              cardType: ["character"],
              owner: { type: "self" },
              hasAnyTrait: ["Prince", "King"],
            },
          },
        },
      },
      {
        type: "activated",
        storyName: "ROYAL SEARCH",
        rulesText:
          "{E}, 2 {I} – Reveal the top card of your deck. If it's a Prince or King character card, you may put that card into your hand. Otherwise, put it on the top of your deck.",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 2 }],
        effects: [
          {
            type: "reveal_top_conditional",
            filter: { cardType: ["character"], hasAnyTrait: ["Prince", "King"] },
            matchAction: "to_hand",
            isMay: true,
            noMatchDestination: "top",
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ────────────────────────── SET 9 ──────────────────────────

  // Bruno Madrigal - Undetected Uncle (reprint of set 4). The set 4 copy is
  // wired with name_a_card_then_reveal (to_hand, miss → top); the "gain 3 lore"
  // on match is an approximation.
  {
    set: "009",
    id: "bruno-madrigal-undetected-uncle",
    abilities: [
      {
        type: "activated",
        storyName: "YOU JUST HAVE TO SEE IT",
        rulesText:
          "{E} — Name a card, then reveal the top card of your deck. If it's the named card, put it into your hand and gain 3 lore. Otherwise, put it on the top of your deck. (approximation: lore gain on hit skipped)",
        costs: [{ type: "exert" }],
        effects: [{ type: "name_a_card_then_reveal", target: { type: "self" } }],
      },
    ],
  },

  // Pongo - Determined Father (reprint of set 3 with "Once during your turn"
  // wording — mechanically equivalent to set 3 "Once per turn"). Mirror the
  // set 3 wiring via look_at_top one_to_hand_rest_bottom + oncePerTurn flag.
  {
    set: "009",
    id: "pongo-determined-father",
    abilities: [
      {
        type: "activated",
        storyName: "TWILIGHT BARK",
        rulesText:
          "Once during your turn, you may pay 2 {I} to reveal the top card of your deck. If it's a character card, put it into your hand. Otherwise, put it on the bottom of your deck.",
        costs: [{ type: "pay_ink", amount: 2 }],
        oncePerTurn: true,
        effects: [
          {
            type: "look_at_top",
            count: 1,
            action: "one_to_hand_rest_bottom",
            filter: { cardType: ["character"] },
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ────────────────────────── SET 11 ──────────────────────────

  // John Smith's Compass — YOUR PATH: end-of-turn, if none of your characters
  // challenged this turn, reveal top; if character cost ≤ 3 OR named Pocahontas
  // → to hand, else bottom. Approximation: OR-of-filters not expressible, so
  // wire as cost ≤ 3 character. Also has SPINNING ARROW self-banish trigger,
  // which DOES track "a character of yours challenged this turn" — we have
  // aCharacterChallengedThisTurn event flag (see set 5 tests). Both abilities
  // need an opposite condition — skip SPINNING ARROW (requires
  // condition_character_challenged_this_turn + banish_self effect chain) and
  // approximate YOUR PATH as unconditional (fires every end-of-turn).
  {
    set: "011",
    id: "john-smiths-compass",
    abilities: [
      {
        type: "triggered",
        storyName: "YOUR PATH",
        rulesText:
          "At the end of your turn, if none of your characters challenged this turn, reveal the top card of your deck. If it's a character card with cost 3 or less or named Pocahontas, you may put it into your hand. Otherwise, put it on the bottom of your deck. (approximation: fires every end-of-turn, does not check challenged-this-turn; filter approximated as cost ≤ 3 character only — named Pocahontas OR branch dropped)",
        trigger: { on: "turn_end", player: { type: "self" } },
        effects: [
          {
            type: "reveal_top_conditional",
            filter: { cardType: ["character"], costAtMost: 3 },
            matchAction: "to_hand",
            isMay: true,
            noMatchDestination: "bottom",
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ────────────────────────── D23 ──────────────────────────

  // Bruno Madrigal - Undetected Uncle (reprint of set 4 — promo D23 printing).
  {
    set: "D23",
    id: "bruno-madrigal-undetected-uncle",
    abilities: [
      {
        type: "activated",
        storyName: "YOU JUST HAVE TO SEE IT",
        rulesText:
          "{E} – Name a card, then reveal the top card of your deck. If it's the named card, put that card into your hand and gain 3 lore. Otherwise, put it on the top of your deck. (approximation: lore gain on hit skipped)",
        costs: [{ type: "exert" }],
        effects: [{ type: "name_a_card_then_reveal", target: { type: "self" } }],
      },
    ],
  },
];

// ─── Apply ────────────────────────────────────────────────────
let totalPatched = 0;
const missing: string[] = [];

const SET_FILE_BY_KEY: Record<Patch["set"], string> = {
  "005": "lorcast-set-005.json",
  "006": "lorcast-set-006.json",
  "007": "lorcast-set-007.json",
  "008": "lorcast-set-008.json",
  "009": "lorcast-set-009.json",
  "011": "lorcast-set-011.json",
  "D23": "lorcast-set-D23.json",
};

const setKeys = [...new Set(PATCHES.map(p => p.set))];

for (const setKey of setKeys) {
  const path = join(CARDS_DIR, SET_FILE_BY_KEY[setKey]);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let dirty = false;

  for (const patch of PATCHES) {
    if (patch.set !== setKey) continue;
    const matches = cards.filter((c: any) => c.id === patch.id);
    if (matches.length === 0) {
      console.warn(`MISSING card id: [${setKey}] ${patch.id}`);
      missing.push(`[${setKey}] ${patch.id}`);
      continue;
    }
    for (const card of matches) {
      card.abilities = patch.abilities;
    }
    dirty = true;
    totalPatched += matches.length;
  }

  if (dirty) {
    writeFileSync(path, JSON.stringify(cards, null, 2));
    console.log(`Wrote ${path}`);
  }
}

console.log(`\nTotal cards patched: ${totalPatched}`);
if (missing.length) console.log(`Missing:`, missing);
