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
// SET 3 — Into the Inklands: Batch 1 (fits-grammar, no engine changes)
// =============================================================================
patchSet("3", {

  // ===== STATIC ABILITIES =====

  // Pluto - Friendly Pooch: "You pay 1 {I} less for the next character you play this turn."
  // (one-shot — applied as triggered when entering play)
  "pluto-friendly-pooch": {
    abilities: [{
      type: "triggered", storyName: "PLAYFUL PUP",
      rulesText: "You pay 1 {I} less for the next character you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "cost_reduction", amount: 1, filter: { cardType: ["character"] } }],
    }],
  },

  // Heart of Atlantis: same one-shot
  "heart-of-atlantis": {
    abilities: [{
      type: "triggered", storyName: "POWER SOURCE",
      rulesText: "You pay 2 {I} less for the next character you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "cost_reduction", amount: 2, filter: { cardType: ["character"] } }],
    }],
  },

  // Map of Treasure Planet: pay 1 less for next location
  "map-of-treasure-planet": {
    abilities: [{
      type: "triggered", storyName: "DISCOVERY",
      rulesText: "You pay 1 {I} less for the next location you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "cost_reduction", amount: 1, filter: { cardType: ["location"] } }],
    }],
  },

  // Scrooge's Top Hat: pay 1 less for next item
  "scrooges-top-hat": {
    abilities: [{
      type: "triggered", storyName: "CLASSY",
      rulesText: "You pay 1 {I} less for the next item you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "cost_reduction", amount: 1, filter: { cardType: ["item"] } }],
    }],
  },

  // Razoul - Palace Guard: "While this character has no damage, he gets +2 {S}."
  "razoul-palace-guard": {
    abilities: [{
      type: "static", storyName: "PROUD GUARD",
      rulesText: "While this character has no damage, he gets +2 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      condition: { type: "this_has_no_damage" },
    }],
  },

  // Piglet - Pooh Pirate Captain: "While you have 2 or more other characters in play, +2 {L}."
  "piglet-pooh-pirate-captain": {
    abilities: [{
      type: "static", storyName: "BRAVE LITTLE PIRATE",
      rulesText: "While you have 2 or more other characters in play, this character gets +2 {L}.",
      effect: { type: "modify_stat", stat: "lore", modifier: 2, target: { type: "this" } },
      condition: { type: "characters_in_play_gte", amount: 2, player: { type: "self" }, excludeSelf: true },
    }],
  },

  // ===== ENTERS_PLAY TRIGGERS =====

  // Patch - Intimidating Pup: action — chosen char -2 STR until next turn
  // (this is actually a character with an enters_play effect)
  "patch-intimidating-pup": {
    abilities: [{
      type: "triggered", storyName: "WHO ME?",
      rulesText: "Chosen character gets -2 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_stats", strength: -2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // Kida - Protector of Atlantis: "When you play, all characters get -3 {S} until next turn."
  "kida-protector-of-atlantis": {
    abilities: [{
      type: "triggered", storyName: "ANCIENT POWER",
      rulesText: "When you play this character, all characters get -3 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_stats", strength: -3, target: { type: "all", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // Maid Marian - Delightful Dreamer: "When you play, chosen character gets -2 {S} this turn."
  "maid-marian-delightful-dreamer": {
    abilities: [{
      type: "triggered", storyName: "GENTLE TOUCH",
      rulesText: "When you play this character, chosen character gets -2 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_stats", strength: -2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" }],
    }],
  },

  // Chernabog - Evildoer: "When you play, shuffle all character cards from your discard into your deck."
  "chernabog-evildoer": {
    abilities: [{
      type: "triggered", storyName: "GATHER MY MINIONS",
      rulesText: "When you play this character, shuffle all character cards from your discard into your deck.",
      trigger: { on: "enters_play" },
      effects: [{ type: "shuffle_into_deck", target: { type: "all", filter: { owner: { type: "self" }, zone: "discard", cardType: ["character"] } } }],
    }],
  },

  // Jafar - Lamp Thief: "look at top 2, put one on top, other on bottom"
  "jafar-lamp-thief": {
    abilities: [{
      type: "triggered", storyName: "BIG STEP UP",
      rulesText: "When you play this character, look at the top 2 cards of your deck. Put one on the top of your deck and the other on the bottom.",
      trigger: { on: "enters_play" },
      effects: [{ type: "look_at_top", count: 2, action: "reorder", target: { type: "self" } }],
    }],
  },

  // Magic Broom - Swift Cleaner: "shuffle all Broom cards from discard into deck"
  "magic-broom-swift-cleaner": {
    abilities: [{
      type: "triggered", storyName: "TIDY UP",
      rulesText: "When you play this character, you may shuffle all Broom cards from your discard into your deck.",
      trigger: { on: "enters_play" },
      effects: [{ type: "shuffle_into_deck", target: { type: "all", filter: { owner: { type: "self" }, zone: "discard", hasName: "Magic Broom" } }, isMay: true }],
    }],
  },

  // Magic Broom - Dancing Duster: "if you have a Sorcerer, may exert chosen opposing char (can't ready)"
  "magic-broom-dancing-duster": {
    abilities: [{
      type: "triggered", storyName: "MUSICAL SWEEPING",
      rulesText: "When you play this character, if you have a Sorcerer character in play, you may exert chosen opposing character. They can't ready at the start of their next turn.",
      trigger: { on: "enters_play" },
      condition: { type: "has_character_with_trait", trait: "Sorcerer", player: { type: "self" }, excludeSelf: true },
      effects: [{ type: "exert", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, isMay: true, followUpEffects: [{ type: "cant_action", action: "ready", target: { type: "this" }, duration: "end_of_owner_next_turn" }] }],
    }],
  },

  // ===== IS_BANISHED TRIGGERS =====

  // Baloo - von Bruinwald XIII: "When banished, gain 2 lore."
  "baloo-von-bruinwald-xiii": {
    abilities: [{
      type: "triggered", storyName: "GENTLEMAN OF LEISURE",
      rulesText: "When this character is banished, gain 2 lore.",
      trigger: { on: "is_banished" },
      effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
    }],
  },

  // Pua - Potbellied Buddy: "When banished, may shuffle this card into deck."
  "pua-potbellied-buddy": {
    abilities: [{
      type: "triggered", storyName: "BACK FOR MORE",
      rulesText: "When this character is banished, you may shuffle this card into your deck.",
      trigger: { on: "is_banished" },
      effects: [{ type: "shuffle_into_deck", target: { type: "this" }, isMay: true }],
    }],
  },

  // Rufus - Orphanage Cat: "When banished, may put into inkwell facedown exerted"
  "rufus-orphanage-cat": {
    abilities: [{
      type: "triggered", storyName: "STILL HAS HIS USES",
      rulesText: "When this character is banished, you may put this card into your inkwell facedown and exerted.",
      trigger: { on: "is_banished" },
      effects: [{ type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, isMay: true }],
    }],
  },

  // ===== QUEST TRIGGERS =====

  // Queen of Hearts - Wonderland Empress: "Whenever quests, your other Villains get +1 {L} this turn"
  "queen-of-hearts-wonderland-empress": {
    abilities: [{
      type: "triggered", storyName: "OFF WITH THEIR HEADS!",
      rulesText: "Whenever this character quests, your other Villain characters get +1 {L} this turn.",
      trigger: { on: "quests" },
      effects: [{ type: "gain_stats", lore: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasTrait: "Villain", excludeSelf: true } }, duration: "this_turn" }],
    }],
  },

  // Ursula - Sea Witch: "quests → chosen opposing can't ready at start of their next turn"
  "ursula-sea-witch": {
    abilities: [{
      type: "triggered", storyName: "PUT ON A SHOW",
      rulesText: "Whenever this character quests, chosen opposing character can't ready at the start of their next turn.",
      trigger: { on: "quests" },
      effects: [{ type: "cant_action", action: "ready", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // The Queen - Mirror Seeker: "look at top 3 and reorder"
  "the-queen-mirror-seeker": {
    abilities: [{
      type: "triggered", storyName: "DIVINATION",
      rulesText: "Whenever this character quests, you may look at the top 3 cards of your deck and put them back in any order.",
      trigger: { on: "quests" },
      effects: [{ type: "look_at_top", count: 3, action: "reorder", target: { type: "self" }, isMay: true }],
    }],
  },

  // Audrey Ramirez: "quests → ready one of your items"
  "audrey-ramirez-the-engineer": {
    abilities: [{
      type: "triggered", storyName: "TINKER",
      rulesText: "Whenever this character quests, ready one of your items.",
      trigger: { on: "quests" },
      effects: [{ type: "ready", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["item"] } } }],
    }],
  },

  // Scrooge McDuck - Uncle Moneybags: "quests → pay 1 less for next item"
  "scrooge-mcduck-uncle-moneybags": {
    abilities: [{
      type: "triggered", storyName: "I OWN THE PLACE",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next item you play this turn.",
      trigger: { on: "quests" },
      effects: [{ type: "cost_reduction", amount: 1, filter: { cardType: ["item"] } }],
    }],
  },

  // Hydros - Ice Titan: enters_play exert chosen
  "hydros-ice-titan": {
    abilities: [{
      type: "triggered", storyName: "FREEZE",
      rulesText: "Exert chosen character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } }],
    }],
  },

  // Lythos - Rock Titan: enters_play grant Resist +2 this turn
  "lythos-rock-titan": {
    abilities: [{
      type: "triggered", storyName: "ROCK SHIELD",
      rulesText: "Chosen character gains Resist +2 this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "grant_keyword", keyword: "resist", value: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" }],
    }],
  },

  // Hades - Hotheaded Ruler: enters_play ready your Titan characters
  "hades-hotheaded-ruler": {
    abilities: [{
      type: "triggered", storyName: "ARISE, MY WARRIORS",
      rulesText: "Ready your Titan characters.",
      trigger: { on: "enters_play" },
      effects: [{ type: "ready", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasTrait: "Titan" } } }],
    }],
  },

  // ===== ACTIVATED ABILITIES =====

  // Cleansing Rainwater: "Banish — Remove up to 2 damage from each of your characters"
  "cleansing-rainwater": {
    abilities: [{
      type: "activated", storyName: "ANCIENT POWER",
      rulesText: "Remove up to 2 damage from each of your characters.",
      costs: [{ type: "banish_self" }],
      effects: [{ type: "remove_damage", amount: 2, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasDamage: true } }, isUpTo: true }],
    }],
  },

  // Wildcat's Wrench: "Remove up to 2 damage from chosen location"
  "wildcats-wrench": {
    abilities: [{
      type: "activated", storyName: "GREASE MONKEY",
      rulesText: "Remove up to 2 damage from chosen location.",
      costs: [{ type: "exert" }],
      effects: [{ type: "remove_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["location"] } }, isUpTo: true }],
    }],
  },

  // Gizmosuit: "Banish — Resist +2 chosen until next turn"
  "gizmosuit": {
    abilities: [{
      type: "activated", storyName: "CYBERNETIC ARMOR",
      rulesText: "Chosen character gains Resist +2 until the start of your next turn.",
      costs: [{ type: "banish_self" }],
      effects: [{ type: "grant_keyword", keyword: "resist", value: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // Gyro Gearloose: enters_play put item from discard on top of deck
  // TODO: not exactly a top-of-deck effect we have, use shuffle as approximation
  "gyro-gearloose-gadget-whiz": {
    abilities: [{
      type: "triggered", storyName: "INVENTOR",
      rulesText: "Put an item card from your discard on the top of your deck.",
      trigger: { on: "enters_play" },
      effects: [{ type: "shuffle_into_deck", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "discard", cardType: ["item"] } } }],
    }],
  },

  // ===== ACTIONS =====

  // Boss's Orders: chosen character gains Support this turn
  "bosss-orders": {
    actionEffects: [{ type: "grant_keyword", keyword: "support", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" }],
  },

  // Heal What Has Been Hurt: remove up to 3 damage + draw a card
  "heal-what-has-been-hurt": {
    actionEffects: [
      { type: "remove_damage", amount: 3, target: { type: "chosen", filter: { zone: "play", hasDamage: true } }, isUpTo: true },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // Quick Patch: remove up to 3 damage from chosen location
  "quick-patch": {
    actionEffects: [
      { type: "remove_damage", amount: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["location"] } }, isUpTo: true },
    ],
  },

  // Distract: -2 STR + draw a card
  "distract": {
    actionEffects: [
      { type: "gain_stats", strength: -2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // Repair: remove up to 3 damage from one of your locations or characters
  "repair": {
    actionEffects: [
      { type: "remove_damage", amount: 3, target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", hasDamage: true } }, isUpTo: true },
    ],
  },

  // Last-Ditch Effort: exert opposing + Challenger +2 this turn
  "last-ditch-effort": {
    actionEffects: [
      { type: "exert", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } } },
      { type: "grant_keyword", keyword: "challenger", value: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" },
    ],
  },

  // The Boss is on a Roll: look at top 5 reorder + gain 1 lore
  "the-boss-is-on-a-roll": {
    actionEffects: [
      { type: "look_at_top", count: 5, action: "reorder", target: { type: "self" } },
      { type: "gain_lore", amount: 1, target: { type: "self" } },
    ],
  },

  // It Calls Me: draw + shuffle up to 3 from opponent's discard into deck
  // TODO: shuffle from opponent's discard to opponent's deck not directly supported. Just draw.
  "it-calls-me": {
    actionEffects: [
      { type: "draw", amount: 1, target: { type: "self" } },
      // Approximation: skip the shuffle-from-opponent-discard portion
    ],
  },

  // How Far I'll Go: look top 2, one to hand + one to inkwell facedown exerted
  // TODO: split-target look_at_top isn't standard. Approximation: just put one in hand.
  "how-far-ill-go": {
    actionEffects: [
      { type: "look_at_top", count: 2, action: "one_to_hand_rest_bottom", target: { type: "self" } },
    ],
  },

  // 99 Puppies: floating trigger — quests this turn → gain 1 lore
  "99-puppies": {
    actionEffects: [
      { type: "create_floating_trigger",
        trigger: { on: "quests", filter: { owner: { type: "self" } } },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // Ba-Boom!: deal 2 to character or location
  "ba-boom": {
    actionEffects: [
      { type: "deal_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } } },
    ],
  },

  // And Then Along Came Zeus: deal 5 to character or location
  "and-then-along-came-zeus": {
    actionEffects: [
      { type: "deal_damage", amount: 5, target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } } },
    ],
  },

  // Rise of the Titans: banish chosen location or item
  "rise-of-the-titans": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["location", "item"] } } },
    ],
  },

  // Olympus Would Be That Way: floating trigger — your characters get +3 STR while challenging a location
  // TODO: "while challenging a location" is challenge-specific damage modifier, not a flat +STR. Skip.

  // ===== MISC TRIGGERS =====

  // Diablo - Faithful Pet: card_played(Maleficent) → look at top
  "diablo-faithful-pet": {
    abilities: [{
      type: "triggered", storyName: "MISTRESS' SPY",
      rulesText: "Whenever you play a character named Maleficent, you may look at the top card of your deck. Put it on either the top or the bottom of your deck.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasName: "Maleficent" } },
      effects: [{ type: "look_at_top", count: 1, action: "top_or_bottom", target: { type: "self" }, isMay: true }],
    }],
  },

  // Minnie Mouse - Musical Artist: "Whenever you play a character with Bodyguard, may remove up to 2 damage from chosen character."
  "minnie-mouse-musical-artist": {
    abilities: [{
      type: "triggered", storyName: "MUSICAL DEBUT",
      rulesText: "Whenever you play a character with Bodyguard, you may remove up to 2 damage from chosen character.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasKeyword: "bodyguard" } },
      effects: [{ type: "remove_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", hasDamage: true } }, isUpTo: true, isMay: true }],
    }],
  },

  // Aurelian Gyrosensor: "Whenever one of your characters quests, may look at top card top/bottom"
  "aurelian-gyrosensor": {
    abilities: [{
      type: "triggered", storyName: "FUTURE SIGHT",
      rulesText: "Whenever one of your characters quests, you may look at the top card of your deck. Put it on either the top or the bottom of your deck.",
      trigger: { on: "quests", filter: { owner: { type: "self" } } },
      effects: [{ type: "look_at_top", count: 1, action: "top_or_bottom", target: { type: "self" }, isMay: true }],
    }],
  },

  // Heart of Te Fiti: enters_play → put top of deck into inkwell exerted
  "heart-of-te-fiti": {
    abilities: [{
      type: "triggered", storyName: "GIFT OF LIFE",
      rulesText: "Put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{ type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, fromZone: "deck" }],
    }],
  },

  // Tinker Bell - Very Clever Fairy: when item banished, may put into inkwell
  "tinker-bell-very-clever-fairy": {
    abilities: [{
      type: "triggered", storyName: "TINKER",
      rulesText: "Whenever one of your items is banished, you may put that card into your inkwell facedown and exerted.",
      trigger: { on: "is_banished", filter: { owner: { type: "self" }, cardType: ["item"] } },
      effects: [{ type: "move_to_inkwell", target: { type: "triggering_card" }, enterExerted: true, isMay: true }],
    }],
  },

  // Sumerian Talisman: "During your turn, when one of your characters is banished in challenge, may draw"
  "sumerian-talisman": {
    abilities: [{
      type: "triggered", storyName: "ANCIENT WISDOM",
      rulesText: "During your turn, whenever one of your characters is banished in a challenge, you may draw a card.",
      trigger: { on: "banished_in_challenge", filter: { owner: { type: "self" } } },
      condition: { type: "is_your_turn" },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // ===== BANISHED_OTHER_IN_CHALLENGE =====

  // Pyros - Lava Titan: "during your turn, when banishes another, may ready chosen"
  "pyros-lava-titan": {
    abilities: [{
      type: "triggered", storyName: "ERUPTION",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may ready chosen character.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "ready", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // Robin Hood - Champion of Sherwood: "during your turn, banishes another → gain 2 lore" + "banished_in_challenge → may draw"
  "robin-hood-champion-of-sherwood": {
    abilities: [
      { type: "triggered", storyName: "WHO'S NEXT?",
        rulesText: "During your turn, whenever this character banishes another character in a challenge, gain 2 lore.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
      },
      { type: "triggered",
        rulesText: "When this character is banished in a challenge, you may draw a card.",
        trigger: { on: "banished_in_challenge" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
      },
    ],
  },

  // Captain Hook - Master Swordsman: "during turn, banishes another → ready, can't quest" + "characters named Peter Pan lose Evasive"
  // TODO: removing Evasive from opposing characters is complex. Implement just the ready part.
  "captain-hook-master-swordsman": {
    abilities: [{
      type: "triggered", storyName: "EN GARDE",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, ready this character. He can't quest for the rest of this turn.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "ready", target: { type: "this" }, followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] }],
    }],
  },

  // ===== STATIC GRANT KEYWORD TO FILTERED =====

  // Captain Hook's Rapier: "Your characters named Captain Hook gain Challenger +1"
  // Plus: "during your turn, when one of your characters banishes another in challenge, may pay 1 ink to draw"
  "captain-hooks-rapier": {
    abilities: [
      { type: "static", storyName: "DUELING WEAPON",
        rulesText: "Your characters named Captain Hook gain Challenger +1.",
        effect: { type: "grant_keyword", keyword: "challenger", value: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasName: "Captain Hook" } } },
      },
      { type: "triggered",
        rulesText: "During your turn, whenever one of your characters banishes another character in a challenge, you may pay 1 {I} to draw a card.",
        trigger: { on: "banished_other_in_challenge", filter: { owner: { type: "self" } } },
        condition: { type: "is_your_turn" },
        effects: [{ type: "sequential", isMay: true,
          costEffects: [{ type: "pay_ink", amount: 1 }],
          rewardEffects: [{ type: "draw", amount: 1, target: { type: "self" } }],
        }],
      },
    ],
  },

  // ===== MORE TRIGGERS =====

  // Genie - Supportive Friend: "quests → may shuffle this card into deck to draw 3"
  "genie-supportive-friend": {
    abilities: [{
      type: "triggered", storyName: "PHENOMENAL COSMIC POWER",
      rulesText: "Whenever this character quests, you may shuffle this card into your deck to draw 3 cards.",
      trigger: { on: "quests" },
      effects: [{ type: "sequential", isMay: true,
        costEffects: [{ type: "shuffle_into_deck", target: { type: "this" } }],
        rewardEffects: [{ type: "draw", amount: 3, target: { type: "self" } }],
      }],
    }],
  },

  // Chernabog's Followers - Creatures of Evil: "quests → may banish them to draw a card"
  "chernabogs-followers-creatures-of-evil": {
    abilities: [{
      type: "triggered", storyName: "DARK SACRIFICE",
      rulesText: "Whenever this character quests, you may banish them to draw a card.",
      trigger: { on: "quests" },
      effects: [{ type: "sequential", isMay: true,
        costEffects: [{ type: "banish", target: { type: "this" } }],
        rewardEffects: [{ type: "draw", amount: 1, target: { type: "self" } }],
      }],
    }],
  },

  // Perdita - Devoted Mother: "When you play and whenever quests, may play character cost 2 or less from discard for free"
  "perdita-devoted-mother": {
    abilities: [
      { type: "triggered", storyName: "PROTECT MY FAMILY",
        rulesText: "When you play this character and whenever she quests, you may play a character with cost 2 or less from your discard for free.",
        trigger: { on: "enters_play" },
        // TODO: play_for_free with fromZone: discard. Approximation: search discard.
        effects: [{ type: "search", filter: { cardType: ["character"], costAtMost: 2 }, target: { type: "self" }, zone: "discard", putInto: "hand" }],
      },
      { type: "triggered",
        trigger: { on: "quests" },
        effects: [{ type: "search", filter: { cardType: ["character"], costAtMost: 2 }, target: { type: "self" }, zone: "discard", putInto: "hand" }],
      },
    ],
  },

  // ===== Additional SET 3 cards =====

  // Mickey Mouse - Trumpeter: enters_play "Play a character for free"
  // TODO: play_for_free for any character — works
  "mickey-mouse-trumpeter": {
    abilities: [{
      type: "triggered", storyName: "TRUMPET CALL",
      rulesText: "Play a character for free.",
      trigger: { on: "enters_play" },
      effects: [{ type: "play_for_free", filter: { cardType: ["character"] } }],
    }],
  },

  // Sheriff of Nottingham - Corrupt Official: "Whenever you discard, may deal 1 damage to chosen opposing"
  "sheriff-of-nottingham-corrupt-official": {
    abilities: [{
      type: "triggered", storyName: "TAX COLLECTOR",
      rulesText: "Whenever you discard a card, you may deal 1 damage to chosen opposing character.",
      trigger: { on: "cards_discarded", player: { type: "self" } },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // Gramma Tala - Spirit of the Ocean: "Whenever a card is put into your inkwell, gain 1 lore"
  // TODO: needs ink_played trigger that also fires for effect-based inkwell additions
  // Approximation: triggers on ink_played only
  "gramma-tala-spirit-of-the-ocean": {
    abilities: [{
      type: "triggered", storyName: "ONE WITH THE OCEAN",
      rulesText: "Whenever a card is put into your inkwell, gain 1 lore.",
      trigger: { on: "ink_played", player: { type: "self" } },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // Huey - Savvy Nephew: "quests → if Dewey + Louie in play, draw 3"
  "huey-savvy-nephew": {
    abilities: [{
      type: "triggered", storyName: "MY DUCKTALES",
      rulesText: "Whenever this character quests, if you have characters named Dewey and Louie in play, you may draw 3 cards.",
      trigger: { on: "quests" },
      condition: { type: "compound_and", conditions: [
        { type: "has_character_named", name: "Dewey", player: { type: "self" } },
        { type: "has_character_named", name: "Louie", player: { type: "self" } },
      ]},
      effects: [{ type: "draw", amount: 3, target: { type: "self" }, isMay: true }],
    }],
  },

  // Bernard - Brand-New Agent: "At end of turn, if exerted, may ready another"
  // TODO: condition this_is_exerted
  "bernard-brand-new-agent": {
    abilities: [{
      type: "triggered", storyName: "I'LL CHECK IT OUT",
      rulesText: "At the end of your turn, if this character is exerted, you may ready another chosen character of yours.",
      trigger: { on: "turn_end", player: { type: "self" } },
      condition: { type: "this_is_exerted" },
      effects: [{ type: "ready", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], excludeSelf: true } }, isMay: true }],
    }],
  },

  // Pluto - Determined Defender: "At start of your turn, remove up to 3 damage from this"
  "pluto-determined-defender": {
    abilities: [{
      type: "triggered", storyName: "GUARD DOG",
      rulesText: "At the start of your turn, remove up to 3 damage from this character.",
      trigger: { on: "turn_start", player: { type: "self" } },
      effects: [{ type: "remove_damage", amount: 3, target: { type: "this" }, isUpTo: true }],
    }],
  },

  // Mr. Smee - Bumbling Mate: "At end of turn, if exerted and no Captain, deal 1 to this"
  "mr-smee-bumbling-mate": {
    abilities: [{
      type: "triggered", storyName: "OH DEAR, DEAR, DEAR",
      rulesText: "At the end of your turn, if this character is exerted and you don't have a Captain character in play, deal 1 damage to this character.",
      trigger: { on: "turn_end", player: { type: "self" } },
      condition: { type: "compound_and", conditions: [
        { type: "this_is_exerted" },
        { type: "not", condition: { type: "has_character_with_trait", trait: "Captain", player: { type: "self" } } },
      ]},
      effects: [{ type: "deal_damage", amount: 1, target: { type: "this" } }],
    }],
  },
});
