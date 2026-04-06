#!/usr/bin/env node
// =============================================================================
// IMPLEMENT CARDS — Patches card JSON with ability definitions
// Run once per batch, then verify with tests.
// =============================================================================

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
// SET 2 — Batch 2: Statics, simple triggers, actions, activated abilities
// =============================================================================

patchSet("2", {
  // ---------------------------------------------------------------------------
  // STATIC ABILITIES — modify_stat, grant_keyword, cost_reduction
  // ---------------------------------------------------------------------------

  // Grand Duke - Advisor to the King: "Your Prince, Princess, King, and Queen characters get +1 {S}."
  "grand-duke-advisor-to-the-king": {
    abilities: [{
      type: "static", storyName: "POMP AND CEREMONY",
      rulesText: "Your Prince, Princess, King, and Queen characters get +1 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } } },
      // Note: should filter by trait Prince|Princess|King|Queen but CardFilter only has hasTrait (singular).
      // This is an approximation — applies to all own characters. TODO: multi-trait filter.
    }],
  },

  // Grumpy - Bad-Tempered: "Your other Seven Dwarfs characters get +1 {S}."
  "grumpy-bad-tempered": {
    abilities: [{
      type: "static", storyName: "I'M NOT GRUMPY!",
      rulesText: "Your other Seven Dwarfs characters get +1 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasTrait: "Seven Dwarfs", excludeSelf: true } } },
    }],
  },

  // Peter Pan's Shadow - Not Sewn On: "Your other characters with Rush gain Evasive."
  "peter-pans-shadow-not-sewn-on": {
    abilities: [{
      type: "static", storyName: "UNFETTERED",
      rulesText: "Your other characters with Rush gain Evasive.",
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasKeyword: "rush", excludeSelf: true } } },
    }],
  },

  // Peter Pan's Dagger: "Your characters with Evasive get +1 {S}."
  "peter-pans-dagger": {
    abilities: [{
      type: "static", storyName: "LOST BOYS' BLADE",
      rulesText: "Your characters with Evasive get +1 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasKeyword: "evasive" } } },
    }],
  },

  // Cogsworth - Grandfather Clock: "Your other characters gain Resist +1"
  "cogsworth-grandfather-clock": {
    abilities: [{
      type: "static", storyName: "SET THE PACE",
      rulesText: "Your other characters gain Resist +1.",
      effect: { type: "grant_keyword", keyword: "resist", value: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], excludeSelf: true } } },
    }],
  },

  // Sardine Can: "Your exerted characters gain Ward."
  "sardine-can": {
    abilities: [{
      type: "static", storyName: "PROTECTED PROVISIONS",
      rulesText: "Your exerted characters gain Ward.",
      effect: { type: "grant_keyword", keyword: "ward", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], isExerted: true } } },
    }],
  },

  // Snow White - Unexpected Houseguest: "You pay 1 {I} less to play Seven Dwarfs characters."
  "snow-white-unexpected-houseguest": {
    abilities: [{
      type: "static", storyName: "HOW DO YOU DO?",
      rulesText: "You pay 1 {I} less to play Seven Dwarfs characters.",
      effect: { type: "cost_reduction", amount: 1, filter: { cardType: ["character"], hasTrait: "Seven Dwarfs" } },
    }],
  },

  // Lawrence - Jealous Manservant: "While this character has no damage, he gets +4 {S}."
  "lawrence-jealous-manservant": {
    abilities: [{
      type: "static", storyName: "LOOKING THE PART",
      rulesText: "While this character has no damage, he gets +4 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 4, target: { type: "this" } },
      condition: { type: "card_has_trait", trait: "__no_damage" }, // HACK: no condition for "self has no damage" yet
      // TODO: needs a "this_has_no_damage" condition type. For now, always applies.
    }],
  },

  // Namaari - Morning Mist: "This character can challenge ready characters."
  // This is handled similarly to "Pick a Fight" — needs a static or flag.
  // For now skip — needs engine support for challenging ready characters.

  // ---------------------------------------------------------------------------
  // TRIGGERED: enters_play (no isMay, with target choice)
  // ---------------------------------------------------------------------------

  // Pinocchio - Talkative Puppet: "When you play, you may exert chosen opposing character."
  "pinocchio-talkative-puppet": {
    abilities: [{
      type: "triggered", storyName: "HI THERE!",
      rulesText: "When you play this character, you may exert chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // Pinocchio - On the Run: "When you play, you may return chosen character or item with cost 3 or less to their player's hand."
  "pinocchio-on-the-run": {
    abilities: [{
      type: "triggered", storyName: "I'M FREE!",
      rulesText: "When you play this character, you may return chosen character or item with cost 3 or less to their player's hand.",
      trigger: { on: "enters_play" },
      effects: [{ type: "return_to_hand", target: { type: "chosen", filter: { zone: "play", cardType: ["character", "item"], costAtMost: 3 } }, isMay: true }],
    }],
  },

  // Benja - Guardian of the Dragon Gem: "When you play, you may banish chosen item."
  "benja-guardian-of-the-dragon-gem": {
    abilities: [{
      type: "triggered", storyName: "GUARDIAN'S DUTY",
      rulesText: "When you play this character, you may banish chosen item.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } }, isMay: true }],
    }],
  },

  // Judy Hopps - Optimistic Officer: "When you play, you may banish chosen item. Its player draws a card."
  "judy-hopps-optimistic-officer": {
    abilities: [{
      type: "triggered", storyName: "I'M ON THE CASE!",
      rulesText: "When you play this character, you may banish chosen item. Its player draws a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } }, isMay: true },
        // TODO: "Its player draws a card" — the draw target depends on who owned the banished item.
        // For now, opponent draws (most items banished are opponent's).
        { type: "draw", amount: 1, target: { type: "opponent" } },
      ],
    }],
  },

  // Cinderella - Knight in Training: "When you play, you may draw a card, then choose and discard a card."
  "cinderella-knight-in-training": {
    abilities: [{
      type: "triggered", storyName: "SWORD TRAINING",
      rulesText: "When you play this character, you may draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, target: { type: "self" }, isMay: true },
        { type: "discard_from_hand", amount: 1, target: { type: "self" }, chooser: "target_player" as const },
      ],
    }],
  },

  // Magic Broom - Industrial Model: "When you play, chosen character gains Resist +1 until start of your next turn."
  "magic-broom-industrial-model": {
    abilities: [{
      type: "triggered", storyName: "SWEEP AND MOP",
      rulesText: "When you play this character, chosen character gains Resist +1 until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "grant_keyword", keyword: "resist", value: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" as const }],
    }],
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED: is_banished
  // ---------------------------------------------------------------------------

  // HeiHei - Persistent Presence: "When banished in a challenge, return this card to your hand."
  "heihei-persistent-presence": {
    abilities: [{
      type: "triggered", storyName: "BAWK!",
      rulesText: "When this character is banished in a challenge, return this card to your hand.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "return_to_hand", target: { type: "this" } }],
    }],
  },

  // James - Role Model: "When banished, you may put this card into your inkwell facedown and exerted."
  "james-role-model": {
    abilities: [{
      type: "triggered", storyName: "NEVER GIVE UP",
      rulesText: "When this character is banished, you may put this card into your inkwell facedown and exerted.",
      trigger: { on: "is_banished" },
      effects: [{ type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, isMay: true }],
    }],
  },

  // Dopey - Always Playful: "When banished, your other Seven Dwarfs get +2 {S} until start of your next turn."
  "dopey-always-playful": {
    abilities: [{
      type: "triggered", storyName: "PICK ME UP!",
      rulesText: "When this character is banished, your other Seven Dwarfs characters get +2 {S} until the start of your next turn.",
      trigger: { on: "is_banished" },
      effects: [{ type: "gain_stats", strength: 2, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasTrait: "Seven Dwarfs", excludeSelf: true } }, duration: "end_of_owner_next_turn" as const }],
    }],
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED: quests
  // ---------------------------------------------------------------------------

  // Cruella De Vil - Perfectly Wretched: "Whenever this character quests, chosen opposing character gets -2 {S} this turn."
  "cruella-de-vil-perfectly-wretched": {
    abilities: [{
      type: "triggered", storyName: "CRUEL INTENTIONS",
      rulesText: "Whenever this character quests, chosen opposing character gets -2 {S} this turn.",
      trigger: { on: "quests" },
      effects: [{ type: "gain_stats", strength: -2, target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, duration: "this_turn" as const }],
    }],
  },

  // Daisy Duck - Secret Agent: "Whenever this character quests, each opponent chooses and discards a card."
  "daisy-duck-secret-agent": {
    abilities: [{
      type: "triggered", storyName: "CLASSIFIED INFORMATION",
      rulesText: "Whenever this character quests, each opponent chooses and discards a card.",
      trigger: { on: "quests" },
      effects: [{ type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "target_player" as const }],
    }],
  },

  // The Huntsman - Reluctant Enforcer: "Whenever quests, you may draw a card, then choose and discard a card."
  "the-huntsman-reluctant-enforcer": {
    abilities: [{
      type: "triggered", storyName: "GUILTY CONSCIENCE",
      rulesText: "Whenever this character quests, you may draw a card, then choose and discard a card.",
      trigger: { on: "quests" },
      effects: [
        { type: "draw", amount: 1, target: { type: "self" }, isMay: true },
        { type: "discard_from_hand", amount: 1, target: { type: "self" }, chooser: "target_player" as const },
      ],
    }],
  },

  // Snow White - Well Wisher: "Whenever quests, you may return a character card from your discard to your hand."
  "snow-white-well-wisher": {
    abilities: [{
      type: "triggered", storyName: "A WISHING WELL",
      rulesText: "Whenever this character quests, you may return a character card from your discard to your hand.",
      trigger: { on: "quests" },
      effects: [{ type: "search", filter: { cardType: ["character"] }, target: { type: "self" }, zone: "discard" as const, putInto: "hand" as const }],
    }],
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED: card_played (Floodborn triggers)
  // ---------------------------------------------------------------------------

  // Blue Fairy - Rewarding Good Deeds: "Whenever you play a Floodborn character, you may draw a card."
  "blue-fairy-rewarding-good-deeds": {
    abilities: [{
      type: "triggered", storyName: "GIFTS OF VIRTUE",
      rulesText: "Whenever you play a Floodborn character, you may draw a card.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Floodborn" } },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // Mrs. Judson - Housekeeper: "Whenever you play a Floodborn character, you may put the top card of your deck into your inkwell facedown and exerted."
  "mrs-judson-housekeeper": {
    abilities: [{
      type: "triggered", storyName: "TIDY UP",
      rulesText: "Whenever you play a Floodborn character, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Floodborn" } },
      effects: [{ type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, isMay: true, fromZone: "deck" as const }],
      // Note: target should be top card of deck, not "this". Using move_to_inkwell with fromZone: "deck".
    }],
  },

  // Chief Bogo - Respected Officer: "Whenever you play a Floodborn character, deal 1 damage to each opposing character."
  "chief-bogo-respected-officer": {
    abilities: [{
      type: "triggered", storyName: "LIFE ISN'T SOME CARTOON",
      rulesText: "Whenever you play a Floodborn character, deal 1 damage to each opposing character.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Floodborn" } },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "all", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } } }],
    }],
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED: banished_other_in_challenge (during your turn)
  // ---------------------------------------------------------------------------

  // Jafar - Dreadnought: "During your turn, whenever this character banishes another in a challenge, you may draw a card."
  "jafar-dreadnought": {
    abilities: [{
      type: "triggered", storyName: "POWER SURGE",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may draw a card.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // Kronk - Junior Chipmunk: "During your turn, whenever this character banishes another in a challenge, you may deal 2 damage to chosen character."
  "kronk-junior-chipmunk": {
    abilities: [{
      type: "triggered", storyName: "PULL THE LEVER!",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may deal 2 damage to chosen character.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "deal_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // ---------------------------------------------------------------------------
  // ACTION CARDS
  // ---------------------------------------------------------------------------

  // Let the Storm Rage On: Song — "Deal 2 damage to chosen character. Draw a card."
  "let-the-storm-rage-on": {
    actionEffects: [
      { type: "deal_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // Legend of the Sword in the Stone: Song — "Chosen character gains Challenger +3 this turn."
  "legend-of-the-sword-in-the-stone": {
    actionEffects: [
      { type: "grant_keyword", keyword: "challenger", value: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" as const },
    ],
  },

  // Charge!: "Chosen character gains Challenger +2 and Resist +2 this turn."
  "charge": {
    actionEffects: [
      { type: "grant_keyword", keyword: "challenger", value: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" as const },
      { type: "grant_keyword", keyword: "resist", value: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" as const },
    ],
  },

  // You Can Fly!: Song — "Chosen character gains Evasive until start of your next turn."
  "you-can-fly": {
    actionEffects: [
      { type: "grant_keyword", keyword: "evasive", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" as const },
    ],
  },

  // What Did You Call Me?: "Chosen damaged character gets +3 {S} this turn."
  "what-did-you-call-me": {
    actionEffects: [
      { type: "gain_stats", strength: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasDamage: true } }, duration: "this_turn" as const },
    ],
  },

  // Fang Crossbow: 2 abilities — stat debuff + activated banish Dragon
  "fang-crossbow": {
    abilities: [
      {
        type: "activated", storyName: "TAKE AIM",
        rulesText: "Chosen character gets -2 {S} this turn.",
        costs: [{ type: "exert" }],
        effects: [{ type: "gain_stats", strength: -2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" as const }],
      },
      {
        type: "activated", storyName: "DRAGON SLAYER",
        rulesText: "Banish chosen Dragon character.",
        costs: [{ type: "exert" }, { type: "banish_self" }],
        effects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasTrait: "Dragon" } } }],
      },
    ],
  },

  // Mouse Armor: "Chosen character gains Resist +1 until start of your next turn."
  "mouse-armor": {
    actionEffects: [
      { type: "grant_keyword", keyword: "resist", value: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" as const },
    ],
  },

  // ---------------------------------------------------------------------------
  // ACTIVATED ABILITIES (items)
  // ---------------------------------------------------------------------------

  // Croquet Mallet: "Banish this item — Chosen character gains Rush this turn."
  "croquet-mallet": {
    abilities: [{
      type: "activated", storyName: "HURTLING HEDGEHOG",
      rulesText: "Chosen character gains Rush this turn.",
      costs: [{ type: "banish_self" }],
      effects: [{ type: "grant_keyword", keyword: "rush", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" as const }],
    }],
  },

  // Perplexing Signposts: "Banish this item — Return chosen character of yours to your hand."
  "perplexing-signposts": {
    abilities: [{
      type: "activated", storyName: "TO WONDERLAND",
      rulesText: "Return chosen character of yours to your hand.",
      costs: [{ type: "banish_self" }],
      effects: [{ type: "return_to_hand", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } } }],
    }],
  },

  // Last Cannon: "{E}, 1 {I}, Banish this item — Chosen character gains Challenger +3 this turn."
  "last-cannon": {
    abilities: [{
      type: "activated", storyName: "ARM YOURSELF",
      rulesText: "Chosen character gains Challenger +3 this turn.",
      costs: [{ type: "pay_ink", amount: 1 }, { type: "banish_self" }],
      effects: [{ type: "grant_keyword", keyword: "challenger", value: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" as const }],
    }],
  },

  // Dragon Gem: "Return a character card with Support from your discard to your hand."
  "dragon-gem": {
    abilities: [{
      type: "activated", storyName: "REUNITING POWER",
      rulesText: "Return a character card with Support from your discard to your hand.",
      costs: [{ type: "exert" }],
      effects: [{ type: "search", filter: { cardType: ["character"], hasKeyword: "support" }, target: { type: "self" }, zone: "discard" as const, putInto: "hand" as const }],
    }],
  },

  // Nick Wilde - Wily Fox: "When you play, you may return an item card named Pawpsicle from your discard to your hand."
  "nick-wilde-wily-fox": {
    abilities: [{
      type: "triggered", storyName: "PAWPSICLE BUSINESS",
      rulesText: "When you play this character, you may return an item card named Pawpsicle from your discard to your hand.",
      trigger: { on: "enters_play" },
      effects: [{ type: "search", filter: { cardType: ["item"], hasName: "Pawpsicle" }, target: { type: "self" }, zone: "discard" as const, putInto: "hand" as const }],
    }],
  },

  // Winnie the Pooh - Having a Think: "Whenever quests, you may put a card from your hand into your inkwell facedown."
  "winnie-the-pooh-having-a-think": {
    abilities: [{
      type: "triggered", storyName: "THINK, THINK, THINK",
      rulesText: "Whenever this character quests, you may put a card from your hand into your inkwell facedown.",
      trigger: { on: "quests" },
      effects: [{ type: "move_to_inkwell", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "hand" } }, enterExerted: false, isMay: true, fromZone: "hand" as const }],
    }],
  },
});
