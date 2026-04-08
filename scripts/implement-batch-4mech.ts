#!/usr/bin/env node
// =============================================================================
// Four-mechanic batch — alert-keyword, timed-cant-be-challenged,
// exert-filtered-cost, both-players-effect.
//
// Engine primitives used:
//   - Keyword "alert" (new): added to Keyword union + validator branch.
//     CRD 10.x Alert: "This character can challenge as if they had Evasive."
//     Treated as granting Evasive on the attacker side of the evasive check.
//   - CantBeChallengedTimedEffect (already existed): wired for set 6/7/11 cards
//     with "…can't be challenged until the start of your next turn" wording.
//   - ExertEffect with chosen filter as leading cost-effect (already existed):
//     wired for exert-filtered-cost cards (Scrump, The Glass Slipper, Sword of
//     Shan-Yu). Ambush is skipped (needs dynamic-amount from the exerted
//     card — "damage equal to their {S}", i.e. the exerted character, not a
//     chosen target, which our DynamicAmount shape doesn't model today).
//   - Draw / gain_lore / discard_from_hand with target { type: "both" }
//     (both-players-effect). gain_lore path for `both` added in this commit.
//
// Skipped (and why):
//   - [6] Ambush — "{E} one of your characters to deal damage equal to their
//     {S}" : the damage amount must reference the exerted character (source of
//     the cost), but deal_damage's DynamicAmount has no "cost-exerted-card"
//     variant. Leaving as a gap.
//   - [7] I2I (x2) — Sing Together action that also uses both-players draw and
//     both-players gain_lore AND "if 2+ characters sang this song, ready them".
//     The ready-and-cant-quest rider needs a conditional on sing-together
//     participant count that isn't modeled; leaving as a gap.
//   - [cp] A Whole New World — already wired in set 001; this cp reprint is a
//     mechanical duplicate. Copy wiring directly.
//   - [10] Judy Hopps - Lead Detective — the "your Detective characters gain
//     Alert during your turn" rider is a turn-scoped group keyword grant. Our
//     grant_keyword static path can express "gain alert" for self, but
//     granting to a filtered group with is_your_turn gating combines multiple
//     primitives; skipping to keep this batch focused. The simple Alert cards
//     (Cri-Kee, Lexington, Sina, Amos Slade) cover the core keyword.
//   - [10] But I'm Much Faster — song granting Alert + Challenger +2 this
//     turn: grant_keyword for two keywords requires two effects. Wire both.
//
// Wired:
//   alert-keyword:
//     [10] Cri-Kee - Good Luck Charm (keyword-only)
//     [10] Lexington - Small in Stature (alert + STONE BY DAY rider kept stubbed)
//     [10] Inkrunner (item: draw + activated grant alert to chosen this turn)
//     [10] Minnie Mouse - Ghost Hunter (grant alert to chosen Detective this turn)
//     [10] But I'm Much Faster (action: grant alert + challenger +2 this turn)
//     [11] Sina - Vigilant Parent (keyword-only)
//     [11] Amos Slade - Tenacious Tracker (keyword-only)
//
//   timed-cant-be-challenged:
//     [6]  Kanga - Nurturing Mother (quests trigger)
//     [6]  Safe and Sound (action)
//     [7]  Isabela Madrigal - In the Moment (sings trigger → self)
//     [7]  Restoring Atlantis (action: all your characters)
//     [11] Mother Will Protect You (action)
//     [11] Winterspell (action + draw 1, targets location)
//
//   exert-filtered-cost:
//     [6]  Scrump (activated: exert-chosen → stat debuff)
//     [7]  The Glass Slipper (activated: banish self + exert chosen Prince → search Princess)
//     [8]  The Sword of Shan-Yu (activated: self-exert + exert chosen → ready + can't quest)
//
//   both-players-effect:
//     [7]  Kuzco - Panicked Llama (turn_start choose one: each draw 1 / each discard 1)
//     [7]  Show Me More! (draw 3 each)
//     [cp] A Whole New World (discard hand + draw 7 each)
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type SetKey = "006" | "007" | "008" | "010" | "011" | "0cp";
type Patch = { set: SetKey; id: string; abilities?: any[]; actionEffects?: any[] };

const PATCHES: Patch[] = [
  // ═══════════════════════════ ALERT ═════════════════════════════════════════

  // Keyword-only Alert characters. CRD 10.x: "This character can challenge as
  // if they had Evasive." Engine models this via the keyword "alert" — the
  // validator evasive check treats an Alert attacker as evasive.
  {
    set: "010",
    id: "cri-kee-good-luck-charm",
    abilities: [{ type: "keyword", keyword: "alert" }],
  },
  {
    set: "010",
    id: "lexington-small-in-stature",
    abilities: [{ type: "keyword", keyword: "alert" }],
    // STONE BY DAY rider ("if 3+ cards in hand, can't ready") left unwired —
    // requires action_restriction_static with cards_in_hand_gte condition.
  },
  {
    set: "011",
    id: "sina-vigilant-parent",
    abilities: [{ type: "keyword", keyword: "alert" }],
  },
  {
    set: "011",
    id: "amos-slade-tenacious-tracker",
    abilities: [{ type: "keyword", keyword: "alert" }],
  },

  // [10] Inkrunner — item with "PREFLIGHT CHECK draw on play" + activated
  // "READY TO RIDE {E}, 1 {I} — Chosen character gains Alert this turn."
  {
    set: "010",
    id: "inkrunner",
    abilities: [
      {
        type: "triggered",
        storyName: "PREFLIGHT CHECK",
        rulesText: "When you play this item, draw a card.",
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
      },
      {
        type: "activated",
        storyName: "READY TO RIDE",
        rulesText: "{E}, 1 {I} — Chosen character gains Alert this turn.",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 1 }],
        effects: [
          {
            type: "grant_keyword",
            keyword: "alert",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"] },
            },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // [10] Minnie Mouse - Ghost Hunter — grant alert to chosen Detective this turn
  {
    set: "010",
    id: "minnie-mouse-ghost-hunter",
    abilities: [
      {
        type: "triggered",
        storyName: "SEARCH THE SHADOWS",
        rulesText: "When you play this character, chosen Detective character gains Alert this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "grant_keyword",
            keyword: "alert",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"], hasTrait: "Detective" },
            },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // [10] But I'm Much Faster — song: chosen character gains Alert + Challenger +2 this turn.
  {
    set: "010",
    id: "but-im-much-faster",
    actionEffects: [
      {
        type: "grant_keyword",
        keyword: "alert",
        target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
        duration: "this_turn",
      },
      {
        type: "grant_keyword",
        keyword: "challenger",
        value: 2,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
        duration: "this_turn",
      },
    ],
  },

  // ═══════════════════════ TIMED CANT BE CHALLENGED ══════════════════════════
  // Uses CantBeChallengedTimedEffect. Duration: `until_caster_next_turn` —
  // "your next turn" is caster-anchored, per CLAUDE.md guidance.

  // [6] Kanga - Nurturing Mother: on quests, choose a character of yours.
  {
    set: "006",
    id: "kanga-nurturing-mother",
    abilities: [
      {
        type: "triggered",
        storyName: "SAFE AND SOUND",
        rulesText: "Whenever this character quests, choose a character of yours and that character can't be challenged until the start of your next turn.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "cant_be_challenged_timed",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
            },
            duration: "until_caster_next_turn",
          },
        ],
      },
    ],
  },

  // [6] Safe and Sound (action)
  {
    set: "006",
    id: "safe-and-sound",
    actionEffects: [
      {
        type: "cant_be_challenged_timed",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
        },
        duration: "until_caster_next_turn",
      },
    ],
  },

  // [7] Isabela Madrigal - In the Moment: self-anchored on sings.
  {
    set: "007",
    id: "isabela-madrigal-in-the-moment",
    abilities: [
      {
        type: "triggered",
        storyName: "I'M TIRED OF PERFECT",
        rulesText: "Whenever one of your characters sings a song, this character can't be challenged until the start of your next turn.",
        trigger: { on: "sings", filter: { owner: { type: "self" } } },
        effects: [
          {
            type: "cant_be_challenged_timed",
            target: { type: "this" },
            duration: "until_caster_next_turn",
          },
        ],
      },
    ],
  },

  // [7] Restoring Atlantis — "Your characters can't be challenged until…"
  // Apply via target { type: "all", filter: self characters }. Reducer iterates.
  {
    set: "007",
    id: "restoring-atlantis",
    actionEffects: [
      {
        type: "cant_be_challenged_timed",
        target: {
          type: "all",
          filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
        },
        duration: "until_caster_next_turn",
      },
    ],
  },

  // [11] Mother Will Protect You — song.
  {
    set: "011",
    id: "mother-will-protect-you",
    actionEffects: [
      {
        type: "cant_be_challenged_timed",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character"] },
        },
        duration: "until_caster_next_turn",
      },
    ],
  },

  // [11] Winterspell — chosen location of yours + draw a card.
  {
    set: "011",
    id: "winterspell",
    actionEffects: [
      {
        type: "cant_be_challenged_timed",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["location"], owner: { type: "self" } },
        },
        duration: "until_caster_next_turn",
      },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // ═══════════════════════ EXERT-FILTERED-COST ══════════════════════════════
  // Leading `exert` effect with chosen-filter on a controller-owned character.
  // This is the existing pattern (Aurora - Lore Guardian etc.).

  // [6] Scrump — item activated: exert one of your characters; target gets -2 {S}
  {
    set: "006",
    id: "scrump",
    abilities: [
      {
        type: "activated",
        storyName: "I MADE HER",
        rulesText: "{E} one of your characters - Chosen character gets -2 {S} until the start of your next turn.",
        costs: [],
        effects: [
          {
            type: "exert",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
            },
          },
          {
            type: "gain_stats",
            strength: -2,
            target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
            duration: "until_caster_next_turn",
          },
        ],
      },
    ],
  },

  // [7] The Glass Slipper — banish self + exert Prince → search Princess.
  {
    set: "007",
    id: "the-glass-slipper",
    abilities: [
      {
        type: "activated",
        storyName: "SEARCH THE KINGDOM",
        rulesText: "Banish this item, {E} one of your Prince characters – Search your deck for a Princess character card and reveal it to all players. Put that card into your hand and shuffle your deck.",
        costs: [{ type: "banish_self" }],
        effects: [
          {
            type: "exert",
            target: {
              type: "chosen",
              filter: {
                zone: "play",
                cardType: ["character"],
                owner: { type: "self" },
                hasTrait: "Prince",
              },
            },
          },
          {
            type: "search",
            filter: { cardType: ["character"], hasTrait: "Princess" },
            target: { type: "self" },
            zone: "deck",
            putInto: "hand",
          },
        ],
      },
    ],
  },

  // [8] The Sword of Shan-Yu — {E} self + exert one of your characters →
  // ready chosen character (they can't quest for rest of this turn).
  {
    set: "008",
    id: "the-sword-of-shan-yu",
    abilities: [
      {
        type: "activated",
        storyName: "WORTHY WEAPON",
        rulesText: "{E}, {E} one of your characters — Ready chosen character. They can't quest for the rest of this turn.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "exert",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
            },
          },
          {
            type: "ready",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"] },
            },
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

  // ═══════════════════════ BOTH-PLAYERS-EFFECT ═══════════════════════════════

  // [7] Kuzco - Panicked Llama — At start of your turn, choose one:
  //   • Each player draws a card.
  //   • Each player chooses and discards a card.
  {
    set: "007",
    id: "kuzco-panicked-llama",
    abilities: [
      { type: "keyword", keyword: "evasive" },
      {
        type: "triggered",
        storyName: "WE CAN FIGURE THIS OUT",
        rulesText: "At the start of your turn, choose one:\n• Each player draws a card.\n• Each player chooses and discards a card.",
        trigger: { on: "turn_start", player: { type: "self" } },
        effects: [
          {
            type: "choose",
            count: 1,
            options: [
              [{ type: "draw", amount: 1, target: { type: "both" } }],
              [
                {
                  type: "discard_from_hand",
                  amount: 1,
                  target: { type: "both" },
                  chooser: "target_player",
                },
              ],
            ],
          },
        ],
      },
    ],
  },

  // [7] Show Me More! — "Each player draws 3 cards."
  {
    set: "007",
    id: "show-me-more",
    actionEffects: [
      { type: "draw", amount: 3, target: { type: "both" } },
    ],
  },

  // [cp] A Whole New World — reprint of set 1. Same effect.
  {
    set: "0cp",
    id: "a-whole-new-world",
    actionEffects: [
      {
        type: "discard_from_hand",
        amount: "all",
        target: { type: "both" },
        chooser: "target_player",
      },
      { type: "draw", amount: 7, target: { type: "both" } },
    ],
  },
];

const SET_FILE_BY_KEY: Record<SetKey, string> = {
  "006": "lorcast-set-006.json",
  "007": "lorcast-set-007.json",
  "008": "lorcast-set-008.json",
  "010": "lorcast-set-010.json",
  "011": "lorcast-set-011.json",
  "0cp": "lorcast-set-0cp.json",
};

const setKeys = [...new Set(PATCHES.map((p) => p.set))];
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
