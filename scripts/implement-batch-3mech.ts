#!/usr/bin/env node
// =============================================================================
// Three-mechanic batch — wires cards for reveal-hand, draw-to-n, and
// per-count-cost-reduction in one pass.
//
// Engine primitives used:
//   - `reveal_hand` Effect (new) — pure-reveal cards (Dolores Madrigal,
//     Copper Hound Pup). In the headless engine this is an event-only no-op.
//   - `discard_from_hand` Effect with `chooser: "controller"` + filter —
//     "reveals their hand and discards a song/location/non-character of your
//     choice" cards. The existing filter-aware discard_from_hand is functionally
//     equivalent (player can see the hand because they pick the discarded card
//     from a filtered list); no explicit reveal_hand step needed.
//   - `draw` Effect with `untilHandSize` (new field) — "draw until you have N"
//     and "draw until same as chosen opponent".
//   - `self_cost_reduction` StaticEffect with DynamicAmount + perMatch — "For
//     each X, you pay N less to play this".
//
// Skipped (and why):
//   - [7] The Return of Hercules ×2: "Each player may reveal a character from
//     their hand and play it for free." Combines play-for-free across both
//     players via a single action — needs dual-player surfacing, unlike any
//     existing effect.
//   - [8] Desperate Plan ×2: "If no cards in hand, draw until 3. Otherwise,
//     choose and discard any number then draw that many." The "otherwise"
//     branch needs a discard-any-number + draw-that-many construct.
//   - [5] Namaari - Resolute Daughter: "For each opposing character banished
//     in a challenge this turn" — needs an event-tracking "banished-in-challenge-
//     this-turn" filter that the CardFilter shape doesn't support.
//
// Wired:
//   reveal-hand:
//     [7]  Dolores Madrigal - Within Earshot (sings → reveal opponent hand)
//     [8]  Ludwig Von Drake - All-Around Expert (SUPERIOR MIND)
//     [9]  Ursula - Deceiver (YOU'LL NEVER EVEN MISS IT)
//     [D23] Ursula - Deceiver (same)
//     [10] Goldie O'Gilt - Cunning Prospector (CLAIM JUMPER only; STRIKE GOLD skipped — discard-to-deck chosen-player)
//     [11] Timon - Snowball Swiper (GET RID OF THAT)
//     [P3] Timon - Snowball Swiper (same)
//     [11] Copper - Hound Pup (FOUND YA — pure reveal)
//
//   draw-to-n:
//     [5]  Clarabelle - Light on Her Hooves ×2 (turn_end, may, opponent_has_more → draw to match)
//     [5]  Remember Who You Are (action — same condition, draw to match)
//     [6]  Yzma - Conniving Chemist ×2 (activated {E}: draw to 3)
//
//   per-count-cost-reduction:
//     [5]  Kristoff - Reindeer Keeper (songs in discard)
//     [P2] Kristoff - Reindeer Keeper (same)
//     [5]  Olaf - Happy Passenger ×2 (exerted opposing characters)
//     [5]  Gaston - Pure Paragon (damaged own characters, per 2)
//     [5]  Sheriff of Nottingham - Bushel Britches (own items in play)
//     [6]  Seeking the Half Crown (own Sorcerer characters; action)
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type SetKey = "005" | "006" | "007" | "008" | "009" | "010" | "011" | "0P2" | "0P3" | "D23";

type Patch = {
  set: SetKey;
  id: string;
  abilities?: any[];
  actionEffects?: any[];
};

// ── reveal-hand: "reveals their hand and discards X of your choice" ──────────
// Builds a triggered enters_play ability with a single discard_from_hand effect.
// The filter narrows which card type the controller may pick from opponent's
// hand. A preceding reveal_hand effect is emitted for analytics.
function revealThenDiscard(
  storyName: string,
  rulesText: string,
  filterCardType: string[],
  isAction = false,
): any {
  const effects = [
    { type: "reveal_hand", target: { type: "opponent" } },
    {
      type: "discard_from_hand",
      amount: 1,
      target: { type: "opponent" },
      chooser: "controller",
      filter: { zone: "hand", cardType: filterCardType },
    },
  ];
  if (isAction) return effects;
  return {
    type: "triggered",
    storyName,
    rulesText,
    trigger: { on: "enters_play" },
    effects,
  };
}

// ── per-count-cost-reduction factory ────────────────────────────────────────
function perCountSelfCostReduction(storyName: string, rulesText: string, countFilter: any, perMatch = 1): any {
  return {
    type: "static",
    storyName,
    rulesText,
    effect: {
      type: "self_cost_reduction",
      amount: { type: "count", filter: countFilter },
      perMatch,
    },
  };
}

const PATCHES: Patch[] = [
  // ═══════════════════════════ REVEAL-HAND ═══════════════════════════════════

  // [7] Dolores Madrigal - Within Earshot
  // "I HEAR YOU Whenever one of your characters sings a song, chosen opponent reveals their hand."
  {
    set: "007",
    id: "dolores-madrigal-within-earshot",
    abilities: [
      {
        type: "triggered",
        storyName: "I HEAR YOU",
        rulesText: "Whenever one of your characters sings a song, chosen opponent reveals their hand.",
        trigger: { on: "sings", filter: { owner: { type: "self" } } },
        effects: [{ type: "reveal_hand", target: { type: "opponent" } }],
      },
    ],
  },

  // [11] Copper - Hound Pup: "FOUND YA When you play this character, chosen player reveals their hand."
  // Approximation: resolves as opponent reveal (chosen-player flow isn't worth a prompt here — in 2P
  // "chosen player" in practice is the opponent; self-reveal is never strategically chosen).
  {
    set: "011",
    id: "copper-hound-pup",
    abilities: [
      {
        type: "triggered",
        storyName: "FOUND YA",
        rulesText: "When you play this character, chosen player reveals their hand.",
        trigger: { on: "enters_play" },
        effects: [{ type: "reveal_hand", target: { type: "opponent" } }],
      },
    ],
  },

  // [8] Ludwig Von Drake - All-Around Expert
  // "SUPERIOR MIND When you play this character, chosen opponent reveals their hand and discards a
  //  non-character card of your choice."
  // (LASTING LEGACY rider — "may put this into your inkwell facedown on banish" — skipped; another gap.)
  {
    set: "008",
    id: "ludwig-von-drake-all-around-expert",
    abilities: [
      revealThenDiscard(
        "SUPERIOR MIND",
        "When you play this character, chosen opponent reveals their hand and discards a non-character card of your choice.",
        ["action", "item"],
      ),
    ],
  },

  // [9] Ursula - Deceiver: song variant.
  {
    set: "009",
    id: "ursula-deceiver",
    abilities: [
      revealThenDiscard(
        "YOU'LL NEVER EVEN MISS IT",
        "When you play this character, chosen opponent reveals their hand and discards a song card of your choice.",
        ["action"],
      ),
    ],
  },
  // [D23] Ursula - Deceiver (alternate printing)
  {
    set: "D23",
    id: "ursula-deceiver",
    abilities: [
      revealThenDiscard(
        "YOU'LL NEVER EVEN MISS IT",
        "When you play this card, chosen opponent reveals their hand and discards a song card of your choice.",
        ["action"],
      ),
    ],
  },

  // [10] Goldie O'Gilt - Cunning Prospector — only CLAIM JUMPER (location discard).
  // STRIKE GOLD rider (put a location from chosen player's discard on bottom, gain 1 lore) is an
  // orthogonal mechanic and is left unwired on purpose.
  {
    set: "010",
    id: "goldie-ogilt-cunning-prospector",
    abilities: [
      revealThenDiscard(
        "CLAIM JUMPER",
        "When you play this character, chosen opponent reveals their hand and discards a location card of your choice.",
        ["location"],
      ),
    ],
  },

  // [11] Timon - Snowball Swiper + [P3] Timon - Snowball Swiper
  {
    set: "011",
    id: "timon-snowball-swiper",
    abilities: [
      revealThenDiscard(
        "GET RID OF THAT",
        "When you play this character, chosen opponent reveals their hand and discards a non-character card of your choice.",
        ["action", "item"],
      ),
    ],
  },
  {
    set: "0P3",
    id: "timon-snowball-swiper",
    abilities: [
      revealThenDiscard(
        "GET RID OF THAT",
        "When you play this character, chosen opponent reveals their hand and discards a non-character card of your choice.",
        ["action", "item"],
      ),
    ],
  },

  // Note: [3] Ursula - Deceiver already had a filtered DiscardEffect stub via a prior pass — this
  // batch is limited to the gap list. Verified via mechanic-gaps.ts.

  // ═══════════════════════════ DRAW-TO-N ═════════════════════════════════════

  // [5] Clarabelle - Light on Her Hooves (both copies)
  // "KEEP IN STEP At the end of your turn, if chosen opponent has more cards in their hand than you,
  //  you may draw cards until you have the same number."
  // Approximation: the engine's opponent_has_more_cards_in_hand condition gates the may-draw; the
  // "chosen opponent" wording collapses to "opponent" in 2P.
  {
    set: "005",
    id: "clarabelle-light-on-her-hooves",
    abilities: [
      {
        type: "triggered",
        storyName: "KEEP IN STEP",
        rulesText:
          "At the end of your turn, if chosen opponent has more cards in their hand than you, you may draw cards until you have the same number.",
        trigger: { on: "turn_end", player: { type: "self" } },
        condition: { type: "opponent_has_more_cards_in_hand" },
        effects: [
          {
            type: "draw",
            amount: 0,
            target: { type: "self" },
            untilHandSize: "match_opponent_hand",
            isMay: true,
          },
        ],
      },
    ],
  },

  // [5] Remember Who You Are (action).
  // "If chosen opponent has more cards in their hand than you, draw cards until you have the same number."
  {
    set: "005",
    id: "remember-who-you-are",
    actionEffects: [
      {
        type: "draw",
        amount: 0,
        target: { type: "self" },
        untilHandSize: "match_opponent_hand",
      },
    ],
    // Gate via ability-level condition isn't possible for raw actionEffects; the draw simply no-ops
    // when controller already has >= opponent's hand count (delta ≤ 0). Approximation: the "if
    // opponent has more" guard is implicit because the delta naturally computes to 0 otherwise.
  },

  // [6] Yzma - Conniving Chemist (both copies)
  // "FEEL THE POWER {E} — If you have fewer than 3 cards in your hand, draw until you have 3 cards in your hand."
  // Again the "fewer than 3" guard is implicit in untilHandSize: 3.
  {
    set: "006",
    id: "yzma-conniving-chemist",
    abilities: [
      {
        type: "activated",
        storyName: "FEEL THE POWER",
        rulesText: "{E} — If you have fewer than 3 cards in your hand, draw until you have 3 cards in your hand.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "draw",
            amount: 0,
            target: { type: "self" },
            untilHandSize: 3,
          },
        ],
      },
    ],
  },

  // ═══════════════════════ PER-COUNT-COST-REDUCTION ═══════════════════════════

  // [5] Kristoff - Reindeer Keeper + [P2]
  // "SONG OF THE HERD For each song card in your discard, you pay 1 {I} less to play this character."
  {
    set: "005",
    id: "kristoff-reindeer-keeper",
    abilities: [
      perCountSelfCostReduction(
        "SONG OF THE HERD",
        "For each song card in your discard, you pay 1 {I} less to play this character.",
        { owner: { type: "self" }, zone: "discard", cardType: ["action"], hasTrait: "Song" },
      ),
    ],
  },
  {
    set: "0P2",
    id: "kristoff-reindeer-keeper",
    abilities: [
      perCountSelfCostReduction(
        "SONG OF THE HERD",
        "For each song card in your discard, you pay 1 {I} less to play this character.",
        { owner: { type: "self" }, zone: "discard", cardType: ["action"], hasTrait: "Song" },
      ),
    ],
  },

  // [5] Olaf - Happy Passenger (both copies)
  // "CLEAR THE PATH For each exerted character opponents have in play, you pay 1 {I} less to play this character."
  {
    set: "005",
    id: "olaf-happy-passenger",
    abilities: [
      perCountSelfCostReduction(
        "CLEAR THE PATH",
        "For each exerted character opponents have in play, you pay 1 {I} less to play this character.",
        { owner: { type: "opponent" }, zone: "play", cardType: ["character"], isExerted: true },
      ),
    ],
  },

  // [5] Gaston - Pure Paragon
  // "A MAN AMONG MEN! For each damaged character you have in play, you pay 2 {I} less to play this character."
  {
    set: "005",
    id: "gaston-pure-paragon",
    abilities: [
      perCountSelfCostReduction(
        "A MAN AMONG MEN!",
        "For each damaged character you have in play, you pay 2 {I} less to play this character.",
        { owner: { type: "self" }, zone: "play", cardType: ["character"], hasDamage: true },
        2,
      ),
    ],
  },

  // [5] Sheriff of Nottingham - Bushel Britches
  // "EVERY LITTLE BIT HELPS For each item you have in play, you pay 1 {I} less to play this character."
  {
    set: "005",
    id: "sheriff-of-nottingham-bushel-britches",
    abilities: [
      perCountSelfCostReduction(
        "EVERY LITTLE BIT HELPS",
        "For each item you have in play, you pay 1 {I} less to play this character.",
        { owner: { type: "self" }, zone: "play", cardType: ["item"] },
      ),
    ],
  },

  // [6] Seeking the Half Crown — action with cost reduction + draw 2.
  // "For each Sorcerer character you have in play, you pay 1 {I} less to play this action. Draw 2 cards."
  // Self-cost-reduction statics work for actions too (validator iterates def.abilities regardless of cardType).
  {
    set: "006",
    id: "seeking-the-half-crown",
    abilities: [
      perCountSelfCostReduction(
        "",
        "For each Sorcerer character you have in play, you pay 1 {I} less to play this action.",
        { owner: { type: "self" }, zone: "play", cardType: ["character"], hasTrait: "Sorcerer" },
      ),
    ],
    actionEffects: [
      { type: "draw", amount: 2, target: { type: "self" } },
    ],
  },
];

const SET_FILE_BY_KEY: Record<SetKey, string> = {
  "005": "lorcast-set-005.json",
  "006": "lorcast-set-006.json",
  "007": "lorcast-set-007.json",
  "008": "lorcast-set-008.json",
  "009": "lorcast-set-009.json",
  "010": "lorcast-set-010.json",
  "011": "lorcast-set-011.json",
  "0P2": "lorcast-set-0P2.json",
  "0P3": "lorcast-set-0P3.json",
  "D23": "lorcast-set-D23.json",
};

const setKeys = [...new Set(PATCHES.map(p => p.set))];
let totalPatched = 0;
const missing: string[] = [];

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
      if (patch.abilities) card.abilities = patch.abilities;
      if (patch.actionEffects) card.actionEffects = patch.actionEffects;
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
