#!/usr/bin/env node
// Wire batch of cards across mechanics:
//  - event-tracking-condition (Devil's Eye Diamond, Brutus, Nathaniel Flint, Chief Seasoned Tracker, The Thunderquack)
//  - conditional-cant-be-challenged (Kenai, Nick Wilde, Galactic Council Chamber, Iago Out of Reach x2)
//  - restrict-sing (Ulf - Mime, Pete Space Pirate, Gantu Experienced Enforcer)
//  - shift-variant (Flotsam P1, Turbo, Thunderbolt)
//  - opponent-chosen-banish (Be King Undisputed)
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type CardPatch = (card: any) => void;
const PATCHES: Record<string, CardPatch> = {
  // ---- event-tracking-condition --------------------------------------------
  "devils-eye-diamond": (c) => {
    c.abilities = [{
      type: "activated",
      storyName: "THE PRICE OF POWER",
      rulesText: "{E} — If one of your characters was damaged this turn, gain 1 lore.",
      costs: [{ type: "exert" }],
      condition: { type: "your_character_was_damaged_this_turn" },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }];
    c._namedAbilityStubs = [];
  },
  "brutus-fearsome-crocodile": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "triggered",
        storyName: "WHAT A FEAST",
        rulesText: "During your turn, when this character is banished, if one of your characters was damaged this turn, gain 2 lore.",
        trigger: { on: "is_banished", filter: { owner: { type: "self" } } },
        condition: {
          type: "compound_and",
          conditions: [
            { type: "is_your_turn" },
            { type: "your_character_was_damaged_this_turn" },
          ],
        },
        effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
      },
    ];
    c._namedAbilityStubs = [];
  },
  "nathaniel-flint-notorious-pirate": (c) => {
    c.playRestrictions = [{ type: "opposing_character_was_damaged_this_turn" }];
    c._namedAbilityStubs = [];
  },
  "chief-seasoned-tracker": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "triggered",
        storyName: "WHO'S NEXT?",
        rulesText: "When you play this character, if an opposing character was banished in a challenge this turn, draw a card.",
        trigger: { on: "enters_play", filter: { owner: { type: "self" } } },
        condition: { type: "opponent_character_was_banished_in_challenge_this_turn" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
      },
    ];
    c._namedAbilityStubs = [];
  },
  "the-thunderquack": (c) => {
    // Action: gain 1 lore if a character was banished in a challenge this turn (either player).
    // The other "opposing characters gain Villain classification" line is skipped (grant-classification not implemented).
    c.actionEffects = [
      {
        type: "conditional_on_target",
        condition: { type: "a_character_was_banished_in_challenge_this_turn" },
        thenEffects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ];
    // Note: "All opposing characters gain the Villain classification" deferred (grant-classification mechanic).
    c._namedAbilityStubs = [];
  },

  // ---- conditional-cant-be-challenged --------------------------------------
  "kenai-big-brother": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "static",
        storyName: "BROTHERLY LOVE",
        rulesText: "While this character is exerted, your characters named Koda can't be challenged.",
        condition: { type: "this_is_exerted" },
        effect: {
          type: "cant_be_challenged",
          target: {
            type: "all",
            filter: { owner: { type: "self" }, zone: "play", hasName: "Koda" },
          },
        },
      },
    ];
    c._namedAbilityStubs = [];
  },
  "nick-wilde-sly-fox": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "static",
        storyName: "I KNOW EVERYBODY",
        rulesText: "While you have an item in play, this character can't be challenged.",
        condition: {
          type: "you_control_matching",
          filter: { owner: { type: "self" }, zone: "play", cardType: ["item"] },
        },
        effect: { type: "cant_be_challenged", target: { type: "this" } },
      },
    ];
    c._namedAbilityStubs = [];
  },
  "galactic-council-chamber-courtroom": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "static",
        storyName: "ORDER IN THE COURT",
        rulesText: "While you have an Alien or Robot character here, this location can't be challenged.",
        condition: {
          type: "you_control_matching",
          filter: {
            owner: { type: "self" },
            zone: "play",
            cardType: ["character"],
            hasAnyTrait: ["Alien", "Robot"],
            atLocation: "this",
          },
        },
        effect: { type: "cant_be_challenged", target: { type: "this" } },
      },
    ];
    c._namedAbilityStubs = [];
  },
  "iago-out-of-reach": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "static",
        storyName: "OUT OF REACH",
        rulesText: "While you have another exerted character in play, this character can't be challenged.",
        condition: {
          type: "you_control_matching",
          filter: {
            owner: { type: "self" },
            zone: "play",
            cardType: ["character"],
            isExerted: true,
            excludeSelf: true,
          },
        },
        effect: { type: "cant_be_challenged", target: { type: "this" } },
      },
    ];
    c._namedAbilityStubs = [];
  },

  // ---- restrict-sing --------------------------------------------------------
  "ulf-mime": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "static",
        storyName: "SHHH!",
        rulesText: "This character can't {E} to sing songs.",
        effect: { type: "cant_action_self", action: "sing" },
      },
    ];
    c._namedAbilityStubs = [];
  },
  "pete-space-pirate": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "static",
        storyName: "INTIMIDATING",
        rulesText: "While this character is exerted, opposing characters can't exert to sing songs.",
        condition: { type: "this_is_exerted" },
        effect: {
          type: "action_restriction",
          restricts: "sing",
          affectedPlayer: { type: "opponent" },
        },
      },
      {
        type: "static",
        storyName: "MARAUDING CREW",
        rulesText: "Your Pirate characters gain Resist +1.",
        effect: {
          type: "grant_keyword",
          keyword: "resist",
          value: 1,
          target: {
            type: "all",
            filter: {
              owner: { type: "self" },
              zone: "play",
              hasTrait: "Pirate",
            },
          },
        },
      },
    ];
    c._namedAbilityStubs = [];
  },
  "gantu-experienced-enforcer": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "triggered",
        storyName: "STOP RIGHT THERE!",
        rulesText: "When you play this character, characters can't exert to sing songs until the start of your next turn.",
        trigger: { on: "enters_play", filter: { owner: { type: "self" } } },
        // Approximation: model as a global floating action restriction by granting a self-static via grant_floating_trigger? Use a simpler approach: cant_action effect on all chars with action "sing" duration until_caster_next_turn.
        effects: [{
          type: "cant_action",
          action: "sing",
          target: { type: "all", filter: { zone: "play", cardType: ["character"] } },
          duration: "until_caster_next_turn",
        }],
      },
    ];
    c._namedAbilityStubs = [];
  },

  // ---- shift-variant --------------------------------------------------------
  "flotsam-jetsam-entangling-eels": (c) => {
    // Already wired in set 4. P1 variant: add additionalNames + alternateNames.
    if (c.setId === "P1" || !c.additionalNames) {
      c.additionalNames = ["Flotsam", "Jetsam"];
      c.alternateNames = ["Flotsam", "Jetsam"];
    }
    c._namedAbilityStubs = [];
  },
  "turbo-royal-hack": (c) => {
    c.additionalNames = ["King Candy"];
    c.alternateNames = ["King Candy"];
    c._namedAbilityStubs = [];
  },
  "thunderbolt-wonder-dog": (c) => {
    // Puppy Shift 3 — classification_shift_self in hand, plus shift keyword.
    c.shiftCost = 3;
    c.abilities = [
      ...(c.abilities ?? []),
      { type: "keyword", keyword: "shift", value: 3 },
      {
        type: "static",
        storyName: "Puppy Shift",
        rulesText: "Puppy Shift 3 (You may pay 3 {I} to play this on top of one of your Puppy characters.)",
        effect: { type: "classification_shift_self", trait: "Puppy" },
        activeZones: ["hand"],
      },
    ];
    c._namedAbilityStubs = [];
  },

  // ---- mass-inkwell ---------------------------------------------------------
  "mufasa-ruler-of-pride-rock": (c) => {
    c.abilities = [
      ...(c.abilities ?? []),
      {
        type: "triggered",
        storyName: "GREAT KINGS OF THE PAST",
        rulesText: "When you play this character, exert all cards in your inkwell, then return 2 cards at random from your inkwell to your hand.",
        trigger: { on: "enters_play" },
        effects: [
          { type: "mass_inkwell", mode: "exert_all", target: { type: "self" } },
          { type: "mass_inkwell", mode: "return_random_to_hand", target: { type: "self" }, amount: 2 },
        ],
      },
      {
        type: "triggered",
        storyName: "EVERYTHING THE LIGHT TOUCHES",
        rulesText: "Whenever this character quests, ready all cards in your inkwell.",
        trigger: { on: "quests" },
        effects: [
          { type: "mass_inkwell", mode: "ready_all", target: { type: "self" } },
        ],
      },
    ];
    c._namedAbilityStubs = [];
  },
  "ink-geyser": (c) => {
    c.actionEffects = [
      { type: "mass_inkwell", mode: "exert_all", target: { type: "both" } },
      { type: "mass_inkwell", mode: "return_random_until", target: { type: "both" }, untilCount: 3 },
    ];
    c._namedAbilityStubs = [];
  },

  // ---- opponent-chosen-banish ----------------------------------------------
  "be-king-undisputed": (c) => {
    c.actionEffects = [
      {
        type: "banish",
        target: {
          type: "chosen",
          // chooser is the target player (each opponent); from their POV it's "self".
          filter: {
            owner: { type: "self" },
            zone: "play",
            cardType: ["character"],
          },
          chooser: "target_player",
        },
      },
    ];
    c._namedAbilityStubs = [];
  },
};

let totalUpdated = 0;
const SET_FILES = readdirSync(CARDS_DIR).filter(f => f.startsWith("lorcast-set-") && f.endsWith(".json"));
for (const f of SET_FILES) {
  const path = join(CARDS_DIR, f);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let dirty = false;
  for (const card of cards) {
    const patch = PATCHES[card.id];
    if (patch) {
      patch(card);
      dirty = true;
      totalUpdated++;
      console.log(`  ${f} ${card.id}`);
    }
  }
  if (dirty) writeFileSync(path, JSON.stringify(cards, null, 2));
}
console.log(`\nUpdated ${totalUpdated} card entries.`);
