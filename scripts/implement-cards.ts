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
// SET 3 — Batch 3: needs-new-type cards that fit existing patterns
// =============================================================================
patchSet("3", {

  // ===== look_at_top variants =====

  // Tinker Bell - Generous Fairy: look top 4, may put character to hand
  "tinker-bell-generous-fairy": {
    abilities: [{
      type: "triggered", storyName: "FAIRY GIFTS",
      rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal a character card and put it into your hand. Put the rest on the bottom of your deck in any order.",
      trigger: { on: "enters_play" },
      effects: [{ type: "look_at_top", count: 4, action: "one_to_hand_rest_bottom", filter: { cardType: ["character"] }, target: { type: "self" }, isMay: true }],
    }],
  },

  // Gramma Tala - Keeper of Ancient Stories: look top 2, may put one in hand
  "gramma-tala-keeper-of-ancient-stories": {
    abilities: [{
      type: "triggered", storyName: "I'M HERE",
      rulesText: "When you play this character, look at the top 2 cards of your deck. You may put one into your hand. Put the rest on the bottom of your deck in any order.",
      trigger: { on: "enters_play" },
      effects: [{ type: "look_at_top", count: 2, action: "one_to_hand_rest_bottom", target: { type: "self" }, isMay: true }],
    }],
  },

  // Lucky - The 15th Puppy: reveal top 3, put each character cost 2 or less into hand
  // Approximation: look at top 3, one_to_hand_rest_bottom with filter
  "lucky-the-15th-puppy": {
    abilities: [{
      type: "triggered", storyName: "OOOOH, SHINY!",
      rulesText: "Reveal the top 3 cards of your deck. You may put each character card with cost 2 or less into your hand. Put the rest on the bottom of your deck in any order.",
      trigger: { on: "enters_play" },
      effects: [{ type: "look_at_top", count: 3, action: "one_to_hand_rest_bottom", filter: { cardType: ["character"], costAtMost: 2 }, target: { type: "self" }, isMay: true }],
    }],
  },

  // ===== "During your turn" Evasive (we have this pattern) =====

  // Captain Amelia - First in Command
  "captain-amelia-first-in-command": {
    abilities: [{
      type: "static", storyName: "STORMY SAILING",
      rulesText: "During your turn, this character gains Evasive.",
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
      condition: { type: "is_your_turn" },
    }],
  },

  // Flintheart Glomgold - Lone Cheater
  "flintheart-glomgold-lone-cheater": {
    abilities: [{
      type: "static", storyName: "I DON'T NEED ANYONE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
      condition: { type: "is_your_turn" },
    }],
  },

  // Little John - Robin's Pal
  "little-john-robins-pal": {
    abilities: [{
      type: "static", storyName: "ALWAYS THERE",
      rulesText: "During your turn, this character gains Evasive.",
      effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
      condition: { type: "is_your_turn" },
    }],
  },

  // Scrooge McDuck - Richest Duck in the World
  "scrooge-mcduck-richest-duck-in-the-world": {
    abilities: [
      { type: "static", storyName: "I OWN THIS PLACE",
        rulesText: "During your turn, this character gains Evasive.",
        effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
        condition: { type: "is_your_turn" },
      },
      { type: "triggered",
        rulesText: "During your turn, whenever this character banishes another character in a challenge, you may play an item for free.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [{ type: "play_for_free", filter: { cardType: ["item"] }, isMay: true }],
      },
    ],
  },

  // ===== Other =====

  // Ariel - Adventurous Collector: "Whenever you play a song, chosen char gains Evasive until next turn"
  "ariel-adventurous-collector": {
    abilities: [{
      type: "triggered", storyName: "PART OF YOUR WORLD",
      rulesText: "Whenever you play a song, chosen character of yours gains Evasive until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], hasTrait: "Song" } },
      effects: [{ type: "grant_keyword", keyword: "evasive", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // Mama Odie - Mystical Maven: "Whenever you play a song, may put top of deck into inkwell exerted"
  "mama-odie-mystical-maven": {
    abilities: [{
      type: "triggered", storyName: "DIG DEEPER",
      rulesText: "Whenever you play a song, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "card_played", filter: { cardType: ["action"], hasTrait: "Song" } },
      effects: [{ type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, fromZone: "deck", isMay: true }],
    }],
  },

  // Maleficent - Mistress of All Evil: quests draw + draw → move damage
  // Uses move_damage which exists
  "maleficent-mistress-of-all-evil": {
    abilities: [
      { type: "triggered", storyName: "ROYAL FORM",
        rulesText: "Whenever this character quests, you may draw a card.",
        trigger: { on: "quests" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
      },
      { type: "triggered",
        rulesText: "During your turn, whenever you draw a card, you may move 1 damage counter from chosen character to chosen opposing character.",
        // TODO: needs "card_drawn" trigger event - we don't have it. Skip second ability for now.
        trigger: { on: "quests" }, // placeholder
        condition: { type: "is_your_turn" },
        effects: [],
      },
    ],
  },

  // Mama Odie - Voice of Wisdom: quests → may move up to 2 damage
  // Uses move_damage which we have
  "mama-odie-voice-of-wisdom": {
    abilities: [{
      type: "triggered", storyName: "DEEP CONNECTION",
      rulesText: "Whenever this character quests, you may move up to 2 damage counters from chosen character to chosen opposing character.",
      trigger: { on: "quests" },
      effects: [{
        type: "move_damage",
        amount: 2,
        from: { type: "chosen", filter: { zone: "play", hasDamage: true } },
        to: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } },
      }],
    }],
  },

  // Bestow a Gift: action → move 1 damage
  "bestow-a-gift": {
    actionEffects: [{
      type: "move_damage",
      amount: 1,
      from: { type: "chosen", filter: { zone: "play", hasDamage: true } },
      to: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } },
    }],
  },

  // Hydra - Deadly Serpent: "Whenever dealt damage, deal that much to chosen opposing"
  // Uses damage_dealt_to trigger and dynamic damage_on_target
  "hydra-deadly-serpent": {
    abilities: [{
      type: "triggered", storyName: "MULTI-HEADED MONSTER",
      rulesText: "Whenever this character is dealt damage, deal that much damage to chosen opposing character.",
      trigger: { on: "damage_dealt_to", filter: { excludeSelf: false } },
      // Uses lastEffectResult set by damage application
      effects: [{ type: "deal_damage", amount: "X", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } } }],
      // TODO: actual amount should be set in trigger context, not "X"
    }],
  },

  // Stratos - Tornado Titan: "Gain lore equal to number of Titan characters in play"
  "stratos-tornado-titan": {
    abilities: [{
      type: "triggered", storyName: "WHIRLWIND ENTRANCE",
      rulesText: "Gain lore equal to the number of Titan characters you have in play.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_lore", amount: { type: "count", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasTrait: "Titan" } }, target: { type: "self" } }],
    }],
  },

  // Magica De Spell - The Midas Touch: "quests → gain lore equal to cost of one of your items"
  // TODO: dynamic lore from item cost. Approximation: gain 2 lore.
  "magica-de-spell-the-midas-touch": {
    abilities: [{
      type: "triggered", storyName: "GOLDEN TOUCH",
      rulesText: "Whenever this character quests, gain lore equal to the cost of one of your items in play.",
      trigger: { on: "quests" },
      effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
    }],
  },

  // Ursula - Deceiver: enters_play opponent reveals + discards a song
  // Approximation: opponent discards 1 (no song-targeting yet)
  "ursula-deceiver": {
    abilities: [{
      type: "triggered", storyName: "WICKED PLAN",
      rulesText: "When you play this character, chosen opponent reveals their hand and discards a song card of your choice.",
      trigger: { on: "enters_play" },
      effects: [{ type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "controller" }],
    }],
  },

  // Friend Like Me: Song — each player ink top 3
  "friend-like-me": {
    actionEffects: [
      { type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, fromZone: "deck" },
      { type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, fromZone: "deck" },
      { type: "move_to_inkwell", target: { type: "this" }, enterExerted: true, fromZone: "deck" },
      // TODO: should affect both players. Current is just self.
    ],
  },

  // Lucky Dime: "Choose a character of yours and gain lore equal to their lore"
  // TODO: dynamic from chosen target's lore. Approximation: gain 1 lore.
  "lucky-dime": {
    abilities: [{
      type: "triggered", storyName: "FOR A RAINY DAY",
      rulesText: "Choose a character of yours and gain lore equal to their {L}.",
      trigger: { on: "enters_play" },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // Pongo - Determined Father: "Once per turn, may pay 2 ink to look at top, char to hand"
  // Activated ability
  "pongo-determined-father": {
    abilities: [{
      type: "activated", storyName: "TWILIGHT BARK",
      rulesText: "You may pay 2 {I} to reveal the top card of your deck. If it's a character card, put it into your hand. Otherwise, put it on the bottom of your deck.",
      costs: [{ type: "pay_ink", amount: 2 }],
      effects: [{ type: "look_at_top", count: 1, action: "one_to_hand_rest_bottom", filter: { cardType: ["character"] }, target: { type: "self" } }],
    }],
  },

  // Simba - Rightful King: "during turn, banishes another → chosen opposing can't challenge next turn"
  "simba-rightful-king": {
    abilities: [{
      type: "triggered", storyName: "MUFASA'S LEGACY",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, chosen opposing character can't challenge during their next turn.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{ type: "cant_action", action: "challenge", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
    }],
  },

  // Magica De Spell - Thieving Sorceress: "Return chosen item with cost <= this character's STR"
  // TODO: dynamic strength comparison. Approximation: return any item.
  "magica-de-spell-thieving-sorceress": {
    abilities: [{
      type: "triggered", storyName: "MAGIC THEFT",
      rulesText: "Return chosen item with cost equal to or less than this character's {S} to its player's hand.",
      trigger: { on: "enters_play" },
      effects: [{ type: "return_to_hand", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } } }],
    }],
  },

  // Ursula - Deceiver of All: "Whenever sings a song, may play that song again from discard"
  // TODO: needs "sings" trigger event AND replay from discard. Skip for now.

  // The Bare Necessities: Song — opponent reveals + discards non-character of your choice
  // Approximation: opponent discards 1 (controller chooses)
  "the-bare-necessities": {
    actionEffects: [{ type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "controller" }],
  },
});

// =============================================================================
// SET 3 — Locations (CRD 5.6, 4.7)
// =============================================================================
patchSet("3", {
  // Pride Lands - Pride Rock: characters get +2 WP while here
  "pride-lands-pride-rock": {
    abilities: [{
      type: "static", storyName: "WE ARE ALL CONNECTED",
      rulesText: "Characters get +2 {W} while here.",
      effect: {
        type: "modify_stat", stat: "willpower", modifier: 2,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
      },
    }],
  },

  // Tiana's Palace - Jazz Restaurant: can't be challenged while here
  "tianas-palace-jazz-restaurant": {
    abilities: [{
      type: "static", storyName: "NIGHT OUT",
      rulesText: "Characters can't be challenged while here.",
      effect: {
        type: "cant_be_challenged",
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
      },
    }],
  },

  // The Queen's Castle - Mirror Chamber: turn_start, draw N where N = chars at this location
  "the-queens-castle-mirror-chamber": {
    abilities: [{
      type: "triggered", storyName: "USING THE MIRROR",
      rulesText: "At the start of your turn, for each character you have here, you may draw a card.",
      trigger: { on: "turn_start", player: { type: "self" } },
      effects: [{
        type: "draw",
        amount: { type: "count", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], atLocation: "this" } },
        target: { type: "self" },
      }],
    }],
  },

  // Cubby - Mighty Lost Boy: moves_to_location → +3 STR this turn (self)
  "cubby-mighty-lost-boy": {
    abilities: [{
      type: "triggered", storyName: "FEELING STRONG",
      rulesText: "Whenever this character moves to a location, he gets +3 {S} this turn.",
      trigger: { on: "moves_to_location" },
      effects: [{
        type: "gain_stats", strength: 3,
        target: { type: "this" },
        duration: "this_turn",
      }],
    }],
  },

  // Mickey Mouse - Stalwart Explorer: +1 STR for each location you have
  "mickey-mouse-stalwart-explorer": {
    abilities: [{
      type: "static", storyName: "ADVENTURE AWAITS",
      rulesText: "This character gets +1 {S} for each location you have in play.",
      effect: {
        type: "modify_stat_per_count", stat: "strength", perCount: 1,
        countFilter: { owner: { type: "self" }, zone: "play", cardType: ["location"] },
        target: { type: "this" },
      },
    }],
  },

  // ===== MORE LOCATIONS — "while here" patterns =====

  // Rapunzel's Tower - Secluded Prison: characters get +3 WP while here
  "rapunzels-tower-secluded-prison": {
    abilities: [{
      type: "static", storyName: "SAFE AND SOUND",
      rulesText: "Characters get +3 {W} while here.",
      effect: { type: "modify_stat", stat: "willpower", modifier: 3,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
    }],
  },

  // The Sorcerer's Tower - Wondrous Workspace: characters get +1 lore while here
  "the-sorcerers-tower-wondrous-workspace": {
    abilities: [{
      type: "static", storyName: "MAGICAL WORKSHOP",
      rulesText: "Characters get +1 {L} while here.",
      effect: { type: "modify_stat", stat: "lore", modifier: 1,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
    }],
  },

  // Fang - River City: characters gain Ward and Evasive while here
  "fang-river-city": {
    abilities: [
      { type: "static", storyName: "SAFE HARBOR",
        rulesText: "Characters gain Ward while here.",
        effect: { type: "grant_keyword", keyword: "ward",
          target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
      },
      { type: "static",
        rulesText: "Characters gain Evasive while here.",
        effect: { type: "grant_keyword", keyword: "evasive",
          target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
      },
    ],
  },

  // RLS Legacy - Solar Galleon: characters gain Evasive while here
  "rls-legacy-solar-galleon": {
    abilities: [{
      type: "static", storyName: "FLOATING SHIP",
      rulesText: "Characters gain Evasive while here.",
      effect: { type: "grant_keyword", keyword: "evasive",
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
    }],
  },

  // Maui's Place of Exile - Hidden Island: characters gain Resist +1 while here
  "mauis-place-of-exile-hidden-island": {
    abilities: [{
      type: "static", storyName: "SECLUDED REFUGE",
      rulesText: "Characters gain Resist +1 while here.",
      effect: { type: "grant_keyword", keyword: "resist", value: 1,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
    }],
  },

  // Jolly Roger - Hook's Ship: characters gain Rush while here
  // (also: Pirates may move here for free — defer)
  "jolly-roger-hooks-ship": {
    abilities: [{
      type: "static", storyName: "SET SAIL",
      rulesText: "Characters gain Rush while here.",
      effect: { type: "grant_keyword", keyword: "rush",
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } } },
    }],
  },

  // ===== CHARACTER CARDS — "while at a location" (atLocation: "any") =====

  // Magic Broom - The Big Sweeper: while at a location, +2 STR
  "magic-broom-the-big-sweeper": {
    abilities: [{
      type: "static", storyName: "STEADY GROUND",
      rulesText: "While this character is at a location, it gets +2 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      condition: { type: "this_at_location" },
    }],
  },

  // Shenzi - Hyena Pack Leader: while at location, +3 STR
  "shenzi-hyena-pack-leader": {
    abilities: [{
      type: "static", storyName: "BIG IDEA",
      rulesText: "While this character is at a location, she gets +3 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 3, target: { type: "this" } },
      condition: { type: "this_at_location" },
    }],
  },

  // Stitch - Covert Agent: while at location, gains Ward
  "stitch-covert-agent": {
    abilities: [{
      type: "static", storyName: "STEALTH MODE",
      rulesText: "While this character is at a location, he gains Ward.",
      effect: { type: "grant_keyword", keyword: "ward", target: { type: "this" } },
      condition: { type: "this_at_location" },
    }],
  },

  // Zazu - Steward of the Pride Lands: while at location, +1 lore
  "zazu-steward-of-the-pride-lands": {
    abilities: [{
      type: "static", storyName: "STEWARD",
      rulesText: "While this character is at a location, he gets +1 {L}.",
      effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "this" } },
      condition: { type: "this_at_location" },
    }],
  },

  // Milo Thatch - Spirited Scholar: while at location, +2 STR
  "milo-thatch-spirited-scholar": {
    abilities: [{
      type: "static", storyName: "ATLANTEAN EXPERTISE",
      rulesText: "While this character is at a location, he gets +2 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      condition: { type: "this_at_location" },
    }],
  },

  // Minnie Mouse - Funky Spelunker: while at location, +2 STR
  "minnie-mouse-funky-spelunker": {
    abilities: [{
      type: "static", storyName: "DEEP DIVING",
      rulesText: "While this character is at a location, she gets +2 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      condition: { type: "this_at_location" },
    }],
  },
});
