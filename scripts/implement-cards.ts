#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

function patchSet(setCode: string, patches: Record<string, any>) {
  const padded = setCode.padStart(3, "0");
  const path = join(CARDS_DIR, `lorcast-set-${padded}.json`);
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
  console.log(`Patched ${patched} cards in set ${setCode}\n`);
}

// =============================================================================
// SET 2 — Batch 5: cards unlocked by engine additions
// (strengthAtMost/AtLeast, turn_start, canChallengeReady)
// =============================================================================
patchSet("2", {

  // --- Cards using strengthAtMost/AtLeast ---

  // World's Greatest Criminal Mind: "Banish chosen character with 5 {S} or more."
  // Fix: now uses strengthAtLeast instead of costAtLeast
  "worlds-greatest-criminal-mind": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"], strengthAtLeast: 5 } } },
    ],
  },

  // Ratigan: fix strength filter (was costAtMost)
  "ratigan-very-large-mouse": {
    abilities: [{
      type: "triggered", storyName: "THE WORLD'S GREATEST CRIMINAL MIND",
      rulesText: "When you play this character, exert chosen opposing character with 3 {S} or less. Choose one of your characters and ready them. They can't quest for the rest of this turn.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "exert", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"], strengthAtMost: 3 } } },
        { type: "ready", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } },
          followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] },
      ],
    }],
  },

  // Weight Set: fix strength filter (was costAtLeast)
  "weight-set": {
    abilities: [{
      type: "triggered", storyName: "PUMP IRON",
      rulesText: "Whenever you play a character with 4 {S} or more, you may pay 1 {I} to draw a card.",
      trigger: { on: "card_played", filter: { cardType: ["character"], strengthAtLeast: 4 } },
      effects: [{ type: "sequential", isMay: true,
        costEffects: [{ type: "pay_ink", amount: 1 }],
        rewardEffects: [{ type: "draw", amount: 1, target: { type: "self" } }],
      }],
    }],
  },

  // --- turn_start triggers ---

  // Donald Duck - Perfect Gentleman: "At the start of your turn, each player may draw a card."
  "donald-duck-perfect-gentleman": {
    abilities: [{
      type: "triggered", storyName: "ALLOW ME",
      rulesText: "At the start of your turn, each player may draw a card.",
      trigger: { on: "turn_start", player: { type: "self" } },
      effects: [
        { type: "draw", amount: 1, target: { type: "self" }, isMay: true },
        { type: "draw", amount: 1, target: { type: "opponent" }, isMay: true },
      ],
    }],
  },

  // Beast - Tragic Hero: "At the start of your turn, if no damage draw a card. Otherwise +4 {S} this turn."
  // Modeled as turn_start with condition check — needs "this_has_no_damage" condition.
  // Approximation: always draw (the condition branch is complex without proper condition type)
  // TODO: needs a proper "this_has_no_damage" / "this_has_damage" condition type for the branch
  "beast-tragic-hero": {
    abilities: [{
      type: "triggered", storyName: "IT'S BETTER THIS WAY",
      rulesText: "At the start of your turn, if this character has no damage, draw a card. Otherwise, he gets +4 {S} this turn.",
      trigger: { on: "turn_start", player: { type: "self" } },
      // Approximation: draw a card (most common case for an undamaged character)
      effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
    }],
  },

  // --- canChallengeReady ---

  // Namaari - Morning Mist: "This character can challenge ready characters."
  "namaari-morning-mist": {
    abilities: [{
      type: "static", storyName: "WARRIOR INSTINCT",
      rulesText: "This character can challenge ready characters.",
      effect: { type: "can_challenge_ready", target: { type: "this" } },
    }],
  },

  // Pick a Fight: "Chosen character can challenge ready characters this turn."
  // This needs a timed canChallengeReady. For now, model as action that does nothing
  // because timed canChallengeReady isn't supported yet.
  // TODO: needs timed can_challenge_ready effect type

  // --- "During your turn" conditional keyword ---

  // Cruella De Vil - Fashionable Cruiser: "During your turn, this character gains Evasive."
  "cruella-de-vil-fashionable-cruiser": {
    abilities: [{
      type: "static", storyName: "STYLISH ENTRANCE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
      condition: { type: "is_your_turn" },
    }],
  },

  // Jafar - Royal Vizier: same pattern
  "jafar-royal-vizier": {
    abilities: [{
      type: "static", storyName: "CUNNING SCHEME",
      rulesText: "During your turn, this character gains Evasive.",
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
      condition: { type: "is_your_turn" },
    }],
  },

  // --- needs-new-type cards that are now partially implementable ---

  // Gaston Intellectual Powerhouse: look at top 3, may put one into hand, rest bottom
  "gaston-intellectual-powerhouse": {
    abilities: [{
      type: "triggered", storyName: "ROUGHLY THE SIZE OF A BARGE",
      rulesText: "When you play this character, look at the top 3 cards of your deck. You may put one into your hand. Put the rest on the bottom of your deck in any order.",
      trigger: { on: "enters_play" },
      effects: [{ type: "look_at_top", count: 3, action: "one_to_hand_rest_bottom", target: { type: "self" }, isMay: true }],
    }],
  },

  // Sisu - Divine Water Dragon: look at top 2, may put one in hand, rest bottom
  "sisu-divine-water-dragon": {
    abilities: [{
      type: "triggered", storyName: "DIVINE WISDOM",
      rulesText: "Whenever this character quests, look at the top 2 cards of your deck. You may put one into your hand. Put the rest on the bottom of your deck in any order.",
      trigger: { on: "quests" },
      effects: [{ type: "look_at_top", count: 2, action: "one_to_hand_rest_bottom", target: { type: "self" }, isMay: true }],
    }],
  },

  // Dr. Facilier - Fortune Teller: "quests → chosen opposing can't quest during their next turn"
  // This uses cant_action with duration end_of_owner_next_turn
  "dr-facilier-fortune-teller": {
    abilities: [{
      type: "triggered", storyName: "I READ YOUR FUTURE",
      rulesText: "Whenever this character quests, chosen opposing character can't quest during their next turn.",
      trigger: { on: "quests" },
      effects: [{ type: "cant_action", action: "quest", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // Basil - Great Mouse Detective: "If you used Shift, draw 2 cards when he enters play."
  // Approximation: just enters_play draw 2 (shift condition not available yet)
  // TODO: needs played_via_shift condition
  "basil-great-mouse-detective": {
    abilities: [{
      type: "triggered", storyName: "THERE'S ALWAYS A CHANCE",
      rulesText: "If you used Shift to play this character, you may draw 2 cards when he enters play.",
      trigger: { on: "enters_play" },
      // TODO: condition should be played_via_shift. Without it, always triggers.
      effects: [{ type: "draw", amount: 2, target: { type: "self" }, isMay: true }],
    }],
  },

  // Bucky - Squirrel Squeak Tutor: "Whenever you play a Floodborn character, if you used Shift, each opponent discards."
  // Approximation: fires on all Floodborn plays (shift condition not available)
  "bucky-squirrel-squeak-tutor": {
    abilities: [{
      type: "triggered", storyName: "SQUEAK SQUEAK",
      rulesText: "Whenever you play a Floodborn character, if you used Shift to play them, each opponent chooses and discards a card.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Floodborn" } },
      // TODO: condition should check "played via Shift"
      effects: [{ type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "target_player" }],
    }],
  },

  // Lady Tremaine - Imperious Queen: "When you play, each opponent chooses and banishes one of their characters."
  // Approximation: opponent discards (banish-from-play-chosen-by-opponent is not a standard effect)
  // TODO: needs opponent-chosen banish effect
  "lady-tremaine-imperious-queen": {
    abilities: [{
      type: "triggered", storyName: "SINISTER AUTHORITY",
      rulesText: "When you play this character, each opponent chooses and banishes one of their characters.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } } }],
      // NOTE: should be opponent-chosen, not controller-chosen. Approximation.
    }],
  },

  // Falling Down the Rabbit Hole: "Each player chooses one of their characters and puts them into inkwell exerted."
  // Approximation: each player moves a character to inkwell
  "falling-down-the-rabbit-hole": {
    actionEffects: [
      { type: "move_to_inkwell", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } }, enterExerted: true },
      { type: "move_to_inkwell", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, enterExerted: true },
    ],
  },

  // Alice - Growing Girl: "Your other characters gain Support." (static grant keyword)
  // The "while 10+ {S}, +4 {L}" part needs self_stat_gte condition — skip that part.
  "alice-growing-girl": {
    abilities: [{
      type: "static", storyName: "GROWING",
      rulesText: "Your other characters gain Support.",
      effect: { type: "grant_keyword", keyword: "support", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], excludeSelf: true } } },
      // TODO: second ability "While 10+ {S}, +4 {L}" needs self_stat_gte condition
    }],
  },

  // Pete - Bad Guy: "Whenever you play an action, +2 {S} this turn." + "While 7+ {S}, +2 {L}"
  // Implement the triggered part, skip the conditional static
  "pete-bad-guy": {
    abilities: [{
      type: "triggered", storyName: "BULLY",
      rulesText: "Whenever you play an action, this character gets +2 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"] } },
      effects: [{ type: "gain_stats", strength: 2, target: { type: "this" }, duration: "this_turn" }],
      // TODO: second ability "While 7+ {S}, +2 {L}" needs self_stat_gte condition
    }],
  },

  // Nothing to Hide: "Each opponent reveals their hand. Draw a card."
  // Approximation: just draw a card (reveal hand has no mechanical effect in headless sim)
  "nothing-to-hide": {
    actionEffects: [
      // reveal_hand is cosmetic in headless sim — skip
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },
});
