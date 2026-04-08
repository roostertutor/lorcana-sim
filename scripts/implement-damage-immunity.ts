#!/usr/bin/env node
// =============================================================================
// DAMAGE-IMMUNITY batch — wires cards across sets 4, 6, 7, 8, 10, P2, P3
// that use "takes no damage from challenges" / "can't be dealt damage"
// grammars. Engine primitives:
//
//   - `damage_immunity_timed` Effect — applies a damage_immunity TimedEffect
//     with source "challenge" | "all" | "non_challenge" for a duration.
//   - `damage_immunity_static` StaticEffect — ongoing immunity (Baloo, Hercules,
//     Chief Bogo during-your-turn).
//
// Skipped (and why):
//   - [10] Mulan - Standing Her Ground: requires a "you've put a card under
//     one of your characters or locations this turn" event-tracking condition
//     (different gap — event-tracking-condition). Without the condition the
//     immunity would fire unconditionally.
//   - Chief Bogo DEPUTIZE rider (grant Detective classification to other own
//     characters) is a trait-grant primitive we don't have — only MY
//     JURISDICTION's during-your-turn immunity is wired.
//   - Hercules "EVER VALIANT While this character is exerted, your other Hero
//     characters can't be dealt damage unless they're being challenged" rider
//     — needs while_exerted gating on a filtered static. Only EVER VIGILANT
//     (the self immunity) is wired.
//
// Wired:
//   - [4]  Noi - Acrobatic Baby (FANCY FOOTWORK)
//   - [6]  Mickey Mouse - Pirate Captain (MARINER'S MIGHT)
//   - [7]  Baloo - Ol' Iron Paws (FIGHT LIKE A BEAR, static)
//   - [8]  Nothing We Won't Do (action)
//   - [10] Hercules - Mighty Leader (EVER VIGILANT only)
//   - [10] Chief Bogo - Calling the Shots (MY JURISDICTION only)
//   - [P2] Mickey Mouse - Pirate Captain
//   - [P3] Mickey Mouse - Pirate Captain
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type Patch = {
  set: "004" | "006" | "007" | "008" | "010" | "0P2" | "0P3";
  id: string;
  abilities: any[];
  actionEffects?: any[];
};

const PATCHES: Patch[] = [
  // ────────────────────────── SET 4 ──────────────────────────
  // Noi - Acrobatic Baby: "Whenever you play an action, this character takes
  // no damage from challenges this turn."
  {
    set: "004",
    id: "noi-acrobatic-baby",
    abilities: [
      {
        type: "triggered",
        storyName: "FANCY FOOTWORK",
        rulesText:
          "Whenever you play an action, this character takes no damage from challenges this turn.",
        trigger: { on: "card_played", player: { type: "self" }, cardType: "action" },
        effects: [
          {
            type: "damage_immunity_timed",
            target: { type: "this" },
            source: "challenge",
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // ────────────────────────── SET 6 / P2 / P3 ──────────────────────────
  // Mickey Mouse - Pirate Captain: "Whenever this character quests, chosen
  // Pirate character gets +2 {S} and gains 'takes no damage from challenges'
  // this turn." Sequential: stat buff then timed immunity to the same chosen
  // target. We use targetInherit on the second effect so the same chosen
  // Pirate receives the immunity without a second prompt.
  //
  // Note: the engine's applyEffect "all" branch of damage_immunity_timed picks
  // every matching target, which is wrong here (single chosen). Instead we
  // split into two abilities — one triggered effect: gain_stats {strength:+2}
  // on chosen pirate, and a second trigger that fires together, immune on
  // chosen pirate. Because separate triggers are two pending choices, we
  // prefer a single-ability approach via `sequential`. Since `sequential`'s
  // second step can carry targetInherit-like semantics only by using
  // target:{type:"this"} inside applyEffectToTarget, we instead wire as two
  // back-to-back effects on the same ability. The engine applies them in
  // order; each pending_choice resolves, then the next fires. To share the
  // chosen target across both, we use a `sequential` wrapper. (approximation:
  // player is prompted twice — once for the stat buff, once for the immunity.)
  mickeyMouseCapt("006"),
  mickeyMouseCapt("0P2"),
  mickeyMouseCapt("0P3"),

  // ────────────────────────── SET 7 ──────────────────────────
  // Baloo - Ol' Iron Paws: "Your characters with 7 {S} or more can't be dealt
  // damage." Ongoing static damage immunity (source "all") on matching own
  // characters in play.
  {
    set: "007",
    id: "baloo-ol-iron-paws",
    abilities: [
      {
        type: "static",
        storyName: "FIGHT LIKE A BEAR",
        rulesText: "Your characters with 7 {S} or more can't be dealt damage.",
        effect: {
          type: "damage_immunity_static",
          source: "all",
          target: {
            type: "all",
            filter: {
              zone: "play",
              cardType: ["character"],
              owner: { type: "self" },
              strengthAtLeast: 7,
            },
          },
        },
      },
    ],
  },

  // ────────────────────────── SET 8 ──────────────────────────
  // Nothing We Won't Do: Sing Together 8. Ready all your characters. For the
  // rest of this turn, they take no damage from challenges and they can't
  // quest. Sing Together is a printed cost on the card definition (set at
  // import). We wire actionEffects as a sequence: ready all → immunity
  // (rest_of_turn) → cant_action quest (rest_of_turn) over own characters.
  {
    set: "008",
    id: "nothing-we-wont-do",
    abilities: [],
    actionEffects: [
      {
        type: "ready",
        target: {
          type: "all",
          filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
        },
      },
      {
        type: "damage_immunity_timed",
        target: {
          type: "all",
          filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
        },
        source: "challenge",
        duration: "rest_of_turn",
      },
      {
        type: "cant_action",
        action: "quest",
        target: {
          type: "all",
          filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
        },
        duration: "rest_of_turn",
      },
    ],
  },

  // ────────────────────────── SET 10 ──────────────────────────
  // Hercules - Mighty Leader: EVER VIGILANT "This character can't be dealt
  // damage unless he's being challenged." Ongoing static, source
  // "non_challenge". EVER VALIANT rider (while exerted, other Heroes get same)
  // is skipped — needs while_exerted-gated filtered static.
  {
    set: "010",
    id: "hercules-mighty-leader",
    abilities: [
      {
        type: "static",
        storyName: "EVER VIGILANT",
        rulesText:
          "This character can't be dealt damage unless he's being challenged. (approximation: EVER VALIANT rider — while exerted, other Hero characters gain the same protection — is not wired)",
        effect: {
          type: "damage_immunity_static",
          source: "non_challenge",
          target: { type: "this" },
        },
      },
    ],
  },

  // Chief Bogo - Calling the Shots: MY JURISDICTION "During your turn, this
  // character can't be dealt damage." Static with is_your_turn condition +
  // damage_immunity_static source=all, target=this. DEPUTIZE rider (grant
  // Detective classification) is skipped — no trait-grant primitive.
  {
    set: "010",
    id: "chief-bogo-calling-the-shots",
    abilities: [
      {
        type: "static",
        storyName: "MY JURISDICTION",
        rulesText:
          "During your turn, this character can't be dealt damage. (approximation: DEPUTIZE rider granting Detective classification is not wired)",
        condition: { type: "is_your_turn" },
        effect: {
          type: "damage_immunity_static",
          source: "all",
          target: { type: "this" },
        },
      },
    ],
  },
];

function mickeyMouseCapt(set: "006" | "0P2" | "0P3"): Patch {
  return {
    set,
    id: "mickey-mouse-pirate-captain",
    abilities: [
      {
        type: "triggered",
        storyName: "MARINER'S MIGHT",
        rulesText:
          "Whenever this character quests, chosen Pirate character gets +2 {S} and gains \"This character takes no damage from challenges\" this turn. (approximation: player is prompted twice — once for the stat buff and once for the immunity — rather than once for both.)",
        trigger: { on: "quests", player: { type: "self" } },
        effects: [
          {
            type: "gain_stats",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"], hasAnyTrait: ["Pirate"] },
            },
            strength: 2,
            duration: "this_turn",
          },
          {
            type: "damage_immunity_timed",
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"], hasAnyTrait: ["Pirate"] },
            },
            source: "challenge",
            duration: "this_turn",
          },
        ],
      },
    ],
  };
}

// ─── Apply ────────────────────────────────────────────────────
let totalPatched = 0;
const missing: string[] = [];

const SET_FILE_BY_KEY: Record<Patch["set"], string> = {
  "004": "lorcast-set-004.json",
  "006": "lorcast-set-006.json",
  "007": "lorcast-set-007.json",
  "008": "lorcast-set-008.json",
  "010": "lorcast-set-010.json",
  "0P2": "lorcast-set-0P2.json",
  "0P3": "lorcast-set-0P3.json",
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
