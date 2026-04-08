#!/usr/bin/env node
// =============================================================================
// PAY-EXTRA-COST-MID-EFFECT batch — wires "you may pay N {I} to <effect>"
// triggered/activated abilities. The engine already supports the full pattern
// via SequentialEffect with isMay=true and a pay_ink cost effect (CRD 6.1.5.1
// + 6.1.4 + 6.1.5). The categorizer was shunting these cards into
// needs-new-mechanic because of an old NEW_MECHANIC regex; that regex has
// been moved to FITS_GRAMMAR_PATTERNS targeting the pre-existing `sequential`
// capability. No new Effect type required.
//
// Skipped (and why):
//   - Anna - Diplomatic Queen (set 5): "choose one" inside reward — would
//     compose `choose` inside `sequential` rewardEffects but the inner choose
//     interactive flow inside a sequential reward needs verification; skip
//     for safety.
//   - Go Go Tomago - Darting Dynamo (set 6): "gain lore equal to the damage
//     on chosen opposing character" — dynamic-amount gap.
//   - Basil - Disguised Detective (set 6): "whenever a card is put into your
//     inkwell" — trigger event not implemented.
//   - Thunderbolt - Wonder Dog (set 7): "Puppy Shift 3" classification shift
//     variant.
//   - Pongo - Determined Father (set 9 reprint): already implemented
//     elsewhere via oncePerTurn + reveal_top_conditional.
//   - Anna - Soothing Sister (set 11): "Shift 0" + dynamic-amount + discard
//     event-tracking.
//   - Darkwing Duck - Cool Under Pressure (set 11): "whenever an item is
//     banished" trigger event not implemented; also "challenge ready Villains".
// =============================================================================

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const ANY_ITEM = { zone: "play" as const, cardType: ["item" as const] };
const DAMAGED_CHAR = { zone: "play" as const, cardType: ["character" as const], hasDamage: true };

// Each entry: card id → ability JSON to set on the card.
// All abilities use sequential w/ isMay=true and pay_ink cost.
const PATCHES: Record<string, any> = {
  // ── Set 4 / Set 9 reprint: Ariel - Sonic Warrior — AMPLIFIED VOICE ─────────
  "ariel-sonic-warrior": {
    abilities: [
      { type: "keyword", keyword: "shift", value: 4 }, // preserve existing
      {
        type: "triggered",
        storyName: "AMPLIFIED VOICE",
        rulesText: "Whenever you play a song, you may pay 2 {I} to deal 3 damage to chosen character.",
        trigger: { on: "card_played", filter: { hasTrait: "Song" } },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 2 }],
            rewardEffects: [
              { type: "deal_damage", amount: 3, target: { type: "chosen", filter: { ...ANY_CHAR } } },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 5: Merryweather - Good Fairy — RAY OF HOPE ────────────────────────
  "merryweather-good-fairy": {
    abilities: [
      {
        type: "triggered",
        storyName: "RAY OF HOPE",
        rulesText: "When you play this character, you may pay 1 {I} to give chosen character +2 {S} this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 1 }],
            rewardEffects: [
              {
                type: "gain_stats",
                strength: 2,
                duration: "this_turn",
                target: { type: "chosen", filter: { ...ANY_CHAR } },
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 5: Scroop - Odious Mutineer — DO SAY HELLO TO MR. ARROW ──────────
  "scroop-odious-mutineer": {
    abilities: [
      {
        type: "triggered",
        storyName: "DO SAY HELLO TO MR. ARROW",
        rulesText: "When you play this character, you may pay 3 {I} to banish chosen damaged character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 3 }],
            rewardEffects: [
              { type: "banish", target: { type: "chosen", filter: { ...DAMAGED_CHAR } } },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 5: Clarabelle - Clumsy Guest — BUTTERFINGERS ─────────────────────
  "clarabelle-clumsy-guest": {
    abilities: [
      {
        type: "triggered",
        storyName: "BUTTERFINGERS",
        rulesText: "When you play this character, you may pay 2 {I} to banish chosen item.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 2 }],
            rewardEffects: [
              { type: "banish", target: { type: "chosen", filter: { ...ANY_ITEM } } },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 5: Mother Gothel - Conceited Manipulator — MOTHER KNOWS BEST ──────
  "mother-gothel-conceited-manipulator": {
    abilities: [
      {
        type: "triggered",
        storyName: "MOTHER KNOWS BEST",
        rulesText: "When you play this character, you may pay 3 {I} to return chosen character to their player's hand.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 3 }],
            rewardEffects: [
              { type: "return_to_hand", target: { type: "chosen", filter: { ...ANY_CHAR } } },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 6 / P2 reprint: Honey Lemon - Chemical Genius — HERE'S THE BEST PART
  "honey-lemon-chemical-genius": {
    abilities: [
      {
        type: "triggered",
        storyName: "HERE'S THE BEST PART",
        rulesText: "When you play this character, you may pay 2 {I} to have each opponent choose and discard a card.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 2 }],
            rewardEffects: [
              {
                type: "discard_from_hand",
                amount: 1,
                target: { type: "opponent" },
                chooser: "target_player",
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 8: Raya - Infiltration Expert — UNCONVENTIONAL TACTICS ────────────
  "raya-infiltration-expert": {
    abilities: [
      {
        type: "triggered",
        storyName: "UNCONVENTIONAL TACTICS",
        rulesText: "Whenever this character quests, you may pay 2 {I} to ready another chosen character.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 2 }],
            rewardEffects: [
              {
                type: "ready",
                target: {
                  type: "chosen",
                  filter: { ...ANY_CHAR, excludeSelf: true },
                },
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 9: Ursula's Shell Necklace — NOW, SING! ───────────────────────────
  "ursulas-shell-necklace": {
    abilities: [
      {
        type: "triggered",
        storyName: "NOW, SING!",
        rulesText: "Whenever you play a song, you may pay 1 {I} to draw a card.",
        trigger: { on: "card_played", filter: { hasTrait: "Song" } },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 1 }],
            rewardEffects: [
              { type: "draw", amount: 1, target: { type: "self" } },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 9: Max Goof - Rebellious Teen — PERSONAL SOUNDTRACK ───────────────
  "max-goof-rebellious-teen": {
    abilities: [
      {
        type: "triggered",
        storyName: "PERSONAL SOUNDTRACK",
        rulesText: "When you play this character, you may pay 1 {I} to return a song card with cost 3 or less from your discard to your hand.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 1 }],
            rewardEffects: [
              {
                type: "return_to_hand",
                target: {
                  type: "chosen",
                  filter: {
                    zone: "discard",
                    hasTrait: "Song",
                    maxCost: 3,
                    owner: { type: "self" },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 10: Finnick - Tiny Terror — YOU BETTER RUN ────────────────────────
  "finnick-tiny-terror": {
    abilities: [
      {
        type: "triggered",
        storyName: "YOU BETTER RUN",
        rulesText: "When you play this character, you may pay 2 {I} to return chosen opposing character with 2 {S} or less to their player's hand.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 2 }],
            rewardEffects: [
              {
                type: "return_to_hand",
                target: {
                  type: "chosen",
                  filter: {
                    ...ANY_CHAR,
                    owner: { type: "opponent" },
                    strengthAtMost: 2,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Apply ────────────────────────────────────────────────────────────────────
const SET_FILES = readdirSync(CARDS_DIR).filter(f => f.startsWith("lorcast-set-") && f.endsWith(".json")).sort();
const seen = new Set<string>();
let totalPatched = 0;

for (const f of SET_FILES) {
  const path = join(CARDS_DIR, f);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let dirty = false;

  for (const card of cards) {
    if (!PATCHES[card.id]) continue;

    // Skip if already implemented (any non-keyword ability already present).
    const hasNonKeyword = (card.abilities ?? []).some(
      (a: any) => ["triggered", "activated", "static"].includes(a.type)
    );
    if (hasNonKeyword) continue;

    const patch = PATCHES[card.id];
    if (patch.abilities) card.abilities = patch.abilities;
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    dirty = true;
    totalPatched++;
    seen.add(`${f}:${card.id}`);
  }

  if (dirty) writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
}

for (const id of [...seen].sort()) console.log(`  OK ${id}`);
console.log(`\nPatched ${totalPatched} card entries (${seen.size} unique set:id pairs).`);
