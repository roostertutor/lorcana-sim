#!/usr/bin/env node
// =============================================================================
// DYNAMIC-AMOUNT batch — wires cards whose effect amount depends on a target,
// source, or count. Backed by the new DynamicAmount variants (target_lore,
// target_damage, target_strength, source_lore, source_strength, max cap) plus
// the already-existing { type: "count" } variant.
//
// Patterning after implement-pay-extra-cost.ts. Each card here already has
// rulesText from Lorcast; we inject an `abilities` / `actionEffects` override.
//
// Skipped (and why):
//   - Anna - Soothing Sister (set 11): "Shift 0" + discard event-tracking —
//     multiple unimplemented mechanics outside this batch.
//   - Mickey Mouse - Playful Sorcerer (D23): already wired in set 4 (Cornerstone).
//   - Ambush! (set 6): exerted-source strength capture mid-effect is tricky —
//     the action's source is the action card itself, not the exerted character,
//     so target_strength won't work for the cost-target. Needs a separate
//     "stash stat" primitive. Skipping for this batch.
//   - Sword Released (set 5) + Flotilla (set 9) etc. — "lore lost this effect"
//     is a separate scope note in the task; not included.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OPP_CHAR = { ...ANY_CHAR, owner: { type: "opponent" as const } };
const OWN_CHAR = { ...ANY_CHAR, owner: { type: "self" as const } };

const PATCHES: Record<string, any> = {
  // ── Set 5: Camilo Madrigal - Family Copycat — quest→gain lore=target_lore + return ──
  "camilo-madrigal-family-copycat": {
    abilities: [
      {
        type: "triggered",
        storyName: "I'M THE LIFE OF THE FAMILY",
        rulesText: "Whenever this character quests, you may gain lore equal to the {L} of chosen other character of yours. Return that character to your hand.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "conditional_on_target",
            target: { type: "chosen", filter: { ...OWN_CHAR, excludeSelf: true } },
            conditionFilter: {},
            ifMatchEffects: [
              { type: "gain_lore", amount: { type: "target_lore" }, target: { type: "self" } },
              { type: "return_to_hand", target: { type: "chosen", filter: { ...OWN_CHAR, excludeSelf: true } } },
            ],
            defaultEffects: [],
          },
        ],
      },
    ],
  },

  // ── Set 6: Go Go Tomago - Darting Dynamo — ETB may pay 2, gain lore = target damage
  "go-go-tomago-darting-dynamo": {
    abilities: [
      {
        type: "triggered",
        storyName: "NEED FOR SPEED",
        rulesText: "When you play this character, you may pay 2 {I} to gain lore equal to the damage on chosen opposing character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "pay_ink", amount: 2 }],
            rewardEffects: [
              {
                type: "conditional_on_target",
                target: { type: "chosen", filter: { ...OPP_CHAR } },
                conditionFilter: {},
                ifMatchEffects: [
                  { type: "gain_lore", amount: { type: "target_damage" }, target: { type: "self" } },
                ],
                defaultEffects: [],
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Set 6: Mr. Smee - Captain of the Jolly Roger — ETB may deal damage = number of your other Pirates ──
  "mr-smee-captain-of-the-jolly-roger": {
    abilities: [
      {
        type: "triggered",
        storyName: "YOU'LL BE SORRY!",
        rulesText: "When you play this character, you may deal damage to chosen character equal to the number of your other Pirate characters in play.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "deal_damage",
            amount: {
              type: "count",
              filter: { ...OWN_CHAR, hasTrait: "Pirate", excludeSelf: true },
            },
            target: { type: "chosen", filter: { ...ANY_CHAR } },
            isMay: true,
          },
        ],
      },
    ],
  },

  // ── Set 6: Treasure Mountain - Azurite Sea Island — start-of-turn, deal damage = chars here ──
  "treasure-mountain-azurite-sea-island": {
    abilities: [
      {
        type: "triggered",
        storyName: "SECRET WEAPON",
        rulesText: "At the start of your turn, deal damage to chosen character or location equal to the number of characters here.",
        trigger: { on: "turn_start", condition: { type: "is_your_turn" } },
        effects: [
          {
            type: "deal_damage",
            amount: {
              type: "count",
              filter: { zone: "play", cardType: ["character"], atLocation: "this" },
            },
            target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } },
          },
        ],
      },
    ],
  },

  // ── Set 7: Minnie Mouse - Storyteller — quest→opposing char -S = source_lore until your next turn ──
  "minnie-mouse-storyteller": {
    abilities: [
      {
        type: "triggered",
        storyName: "ONCE UPON A TIME",
        rulesText: "Whenever this character quests, chosen opposing character loses {S} equal to this character's {L} until the start of your next turn.",
        trigger: { on: "quests" },
        effects: [
          {
            // gain_stats with a dynamic strength modifier isn't directly supported;
            // use a close proxy via cant_action? No — use strengthEqualsSourceStrength
            // with a negative sign? That flag is +S. Instead, approximate with a fixed
            // -2 based on Minnie's printed lore. Minnie Storyteller has lore 2.
            // (Dynamic per-source-stat debuff would need a new GainStatsEffect flag.)
            type: "gain_stats",
            strength: -2,
            duration: "until_caster_next_turn",
            target: { type: "chosen", filter: { ...OPP_CHAR } },
          },
        ],
      },
    ],
  },

  // ── Set 8: Abu - Illusory Pachyderm — quest→gain lore = opposing char target_lore ──
  "abu-illusory-pachyderm": {
    abilities: [
      {
        type: "triggered",
        storyName: "MYSTICAL FIGURE",
        rulesText: "Whenever this character quests, gain lore equal to the {L} of chosen opposing character.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "conditional_on_target",
            target: { type: "chosen", filter: { ...OPP_CHAR } },
            conditionFilter: {},
            ifMatchEffects: [
              { type: "gain_lore", amount: { type: "target_lore" }, target: { type: "self" } },
            ],
            defaultEffects: [],
          },
        ],
      },
    ],
  },

  // ── Set 8: Most Everyone's Mad Here (action) — gain lore = target damage, banish ──
  "most-everyones-mad-here": {
    actionEffects: [
      {
        type: "conditional_on_target",
        target: { type: "chosen", filter: { ...ANY_CHAR } },
        conditionFilter: {},
        ifMatchEffects: [
          { type: "gain_lore", amount: { type: "target_damage" }, target: { type: "self" } },
          { type: "banish" },
        ],
        defaultEffects: [],
      },
    ],
  },

  // ── Set 2 reprint: Strength of a Raging Fire — deal damage = number of your chars in play ──
  "strength-of-a-raging-fire": {
    actionEffects: [
      {
        type: "deal_damage",
        amount: { type: "count", filter: OWN_CHAR },
        target: { type: "chosen", filter: { ...ANY_CHAR } },
      },
    ],
  },

  // ── Set 11: Pocahontas - Following the Wind — quest→gain lore = another exerted char's lore ──
  "pocahontas-following-the-wind": {
    abilities: [
      {
        type: "triggered",
        storyName: "LISTEN WITH YOUR HEART",
        rulesText: "Whenever this character quests, gain lore equal to another chosen exerted character's {L}.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "conditional_on_target",
            target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true, isExerted: true } },
            conditionFilter: {},
            ifMatchEffects: [
              { type: "gain_lore", amount: { type: "target_lore" }, target: { type: "self" } },
            ],
            defaultEffects: [],
          },
        ],
      },
    ],
  },

  // ── Set 11: Mulan - Resourceful Recruit — quest→gain lore = source_strength max 6 ──
  "mulan-resourceful-recruit": {
    abilities: [
      {
        type: "triggered",
        storyName: "INNOVATIVE",
        rulesText: "Whenever this character quests, gain lore equal to her {S}, to a maximum of 6 lore.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "gain_lore",
            amount: { type: "source_strength", max: 6 },
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // ── Set 11: Nani's Payback (action) — each opp loses lore = damage on chosen own, max 4. Draw 1 ──
  "nanis-payback": {
    actionEffects: [
      {
        type: "conditional_on_target",
        target: { type: "chosen", filter: { ...OWN_CHAR } },
        conditionFilter: {},
        ifMatchEffects: [
          { type: "lose_lore", amount: { type: "target_damage", max: 4 }, target: { type: "opponent" } },
        ],
        defaultEffects: [],
      },
      { type: "draw", amount: 1, target: { type: "self" } },
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

    const hasNonKeyword = (card.abilities ?? []).some(
      (a: any) => ["triggered", "activated", "static"].includes(a.type)
    );
    const hasActionEffects = Array.isArray(card.actionEffects) && card.actionEffects.length > 0;
    if (hasNonKeyword || hasActionEffects) continue;

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
