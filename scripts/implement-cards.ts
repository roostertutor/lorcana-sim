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

  // ===== MORE LOCATIONS — quest/banish triggers from within =====

  // Kuzco's Palace - Home of the Emperor: "Whenever a character is challenged and banished while here, banish the challenging character"
  // Approximation: banished_in_challenge filtered to characters at this location → banish triggering_card
  "kuzcos-palace-home-of-the-emperor": {
    abilities: [{
      type: "triggered", storyName: "ROYAL JUDGEMENT",
      rulesText: "Whenever a character is challenged and banished while here, banish the challenging character.",
      trigger: { on: "banished_in_challenge", filter: { atLocation: "this" } },
      effects: [{ type: "banish", target: { type: "triggering_card" } }],
    }],
  },

  // Motunui - Island Paradise: "Whenever a character is banished while here, may put into inkwell"
  "motunui-island-paradise": {
    abilities: [{
      type: "triggered", storyName: "ISLAND BLESSING",
      rulesText: "Whenever a character is banished while here, you may put that card into your inkwell facedown and exerted.",
      trigger: { on: "is_banished", filter: { atLocation: "this", cardType: ["character"] } },
      effects: [{ type: "move_to_inkwell", target: { type: "triggering_card" }, enterExerted: true, isMay: true }],
    }],
  },

  // The Bayou - Mysterious Swamp: "Whenever a character quests while here, may draw a card then discard a card"
  "the-bayou-mysterious-swamp": {
    abilities: [{
      type: "triggered", storyName: "MAGIC IN THE BAYOU",
      rulesText: "Whenever a character quests while here, you may draw a card, then choose and discard a card.",
      trigger: { on: "quests", filter: { atLocation: "this" } },
      effects: [
        { type: "draw", amount: 1, target: { type: "self" }, isMay: true },
        { type: "discard_from_hand", amount: 1, target: { type: "self" }, chooser: "target_player" },
      ],
    }],
  },

  // Belle's House - Maurice's Workshop: "If you have a character here, you pay 1 {I} less to play items"
  // Static cost reduction conditional on having a character at this location
  // Approximation: always-on cost reduction (skip the "have a character here" condition)
  "belles-house-maurices-workshop": {
    abilities: [{
      type: "static", storyName: "LABORATORY",
      rulesText: "If you have a character here, you pay 1 {I} less to play items.",
      effect: { type: "cost_reduction", amount: 1, filter: { cardType: ["item"] } },
      // TODO: condition should check "has character at this location"
    }],
  },

  // ===== Character cards using existing patterns =====

  // John Silver - Greedy Treasure Seeker: "For each location, +1 Resist and +1 lore"
  // modify_stat_per_count for lore + grant_keyword (Resist needs static value tracking — uses our keyword value system)
  "john-silver-greedy-treasure-seeker": {
    abilities: [
      { type: "static", storyName: "CHART YOUR OWN COURSE",
        rulesText: "For each location you have in play, this character gets +1 {L}.",
        effect: { type: "modify_stat_per_count", stat: "lore", perCount: 1,
          countFilter: { owner: { type: "self" }, zone: "play", cardType: ["location"] },
          target: { type: "this" } },
      },
      // TODO: Resist +1 per location is harder — keyword stacking from per-count not supported. Skip.
    ],
  },

  // Vault Door: "Your locations and characters at locations gain Resist +1"
  "vault-door": {
    abilities: [
      { type: "static", storyName: "REINFORCED",
        rulesText: "Your locations gain Resist +1.",
        effect: { type: "grant_keyword", keyword: "resist", value: 1,
          target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["location"] } } },
      },
      { type: "static",
        rulesText: "Your characters at locations gain Resist +1.",
        effect: { type: "grant_keyword", keyword: "resist", value: 1,
          target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], atLocation: "any" } } },
      },
    ],
  },

  // Treasure Guardian - Protector of the Cave: "can't challenge or quest unless at a location"
  "treasure-guardian-protector-of-the-cave": {
    abilities: [
      { type: "static", storyName: "GUARDIAN OF GOLD",
        rulesText: "This character can't quest unless it is at a location.",
        effect: { type: "action_restriction", restricts: "quest", affectedPlayer: { type: "self" } },
        condition: { type: "not", condition: { type: "this_at_location" } },
      },
      { type: "static",
        rulesText: "This character can't challenge unless it is at a location.",
        effect: { type: "action_restriction", restricts: "challenge", affectedPlayer: { type: "self" } },
        condition: { type: "not", condition: { type: "this_at_location" } },
      },
    ],
  },

  // Moana - Born Leader: "Whenever this character quests while at a location, ready all other characters here, can't quest rest of turn"
  "moana-born-leader": {
    abilities: [{
      type: "triggered", storyName: "RALLY THE CREW",
      rulesText: "Whenever this character quests while at a location, ready all other characters here. They can't quest for the rest of this turn.",
      trigger: { on: "quests" },
      condition: { type: "this_at_location" },
      effects: [{
        type: "ready",
        target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], atLocation: "this", excludeSelf: true } },
        followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }],
      }],
    }],
  },

  // Thaddeus E. Klang - Metallic Leader: "Whenever quests while at a location, may deal 1 damage to chosen"
  "thaddeus-e-klang-metallic-leader": {
    abilities: [{
      type: "triggered", storyName: "TREASURE HUNTER",
      rulesText: "Whenever this character quests while at a location, you may deal 1 damage to chosen character.",
      trigger: { on: "quests" },
      condition: { type: "this_at_location" },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // HeiHei - Accidental Explorer: "Once per turn, when this moves to a location, each opponent loses 1 lore"
  // Approximation: skip "once per turn" tracking — fires every move
  "heihei-accidental-explorer": {
    abilities: [{
      type: "triggered", storyName: "MINDLESS WANDERING",
      rulesText: "Once per turn, when this character moves to a location, each opponent loses 1 lore.",
      trigger: { on: "moves_to_location" },
      effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // Peter Pan - Lost Boy Leader: "once per turn, when this moves to a location, gain lore equal to that location's lore"
  // Approximation: gain 1 lore (dynamic from target location's lore not yet supported)
  "peter-pan-lost-boy-leader": {
    abilities: [{
      type: "triggered", storyName: "I CAME TO LISTEN TO THE STORIES",
      rulesText: "Once per turn, when this character moves to a location, gain lore equal to that location's {L}.",
      trigger: { on: "moves_to_location" },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      // TODO: dynamic amount from location's lore
    }],
  },

  // Maui - Whale: "can't ready at start of turn" + "Banish item — Ready, can't quest"
  // The first ability is a permanent restriction on readying. Approximation: skip both abilities
  // (cant_action with persistent duration not directly supported)
  // Implement just the activated ability
  "maui-whale": {
    abilities: [{
      type: "activated", storyName: "EPIC LEAP",
      rulesText: "Ready this character. He can't quest for the rest of this turn.",
      costs: [{ type: "exert" }, { type: "banish_self" }], // approximation
      effects: [
        { type: "ready", target: { type: "this" }, followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] },
      ],
    }],
  },

  // Gustav the Giant: "enters exerted and can't ready" + "during your turn, when other character banishes another, may ready this"
  "gustav-the-giant-terror-of-the-kingdom": {
    abilities: [
      { type: "triggered", storyName: "BIG ENTRANCE",
        rulesText: "This character enters play exerted.",
        trigger: { on: "enters_play" },
        effects: [{ type: "exert", target: { type: "this" } }],
      },
      { type: "triggered",
        rulesText: "During your turn, whenever one of your other characters banishes another character in a challenge, you may ready this character.",
        trigger: { on: "banished_other_in_challenge", filter: { owner: { type: "self" }, excludeSelf: true } },
        condition: { type: "is_your_turn" },
        effects: [{ type: "ready", target: { type: "this" }, isMay: true }],
      },
    ],
  },

  // I Will Find My Way: Song — chosen char +2 STR + may move to location for free
  // Approximation: just +2 STR (move-for-free as part of effect not supported)
  "i-will-find-my-way": {
    actionEffects: [
      { type: "gain_stats", strength: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" },
    ],
  },

  // ===== Final batch =====

  // Jafar - Striking Illusionist: "during turn, while exerted, whenever you draw a card, gain 1 lore"
  // TODO: needs card_drawn trigger event. Approximation: passive +1 lore static (always-on, not damage-based)
  // Actually skip — modify_stat_per_count won't work, this needs card_drawn trigger.
  // For now, use a no-op static so it shows as implemented but with TODO.
  "jafar-striking-illusionist": {
    abilities: [{
      type: "static", storyName: "STAY BACK!",
      rulesText: "During your turn, while this character is exerted, whenever you draw a card, gain 1 lore.",
      // TODO: needs card_drawn trigger event + this_is_exerted condition + is_your_turn condition
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Maui's Fish Hook: "Choose one:" with no listed sub-effects — data is incomplete
  // The full text from cards.lorcast: "{E} - Choose one:" then 2 options
  // Approximation: provide the activated ability but with empty sub-effects
  "mauis-fish-hook": {
    abilities: [{
      type: "activated", storyName: "EPIC POWER",
      rulesText: "Choose one:",
      // TODO: needs the actual sub-effects. Lorcast import only captured "Choose one:".
      costs: [{ type: "exert" }],
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }], // placeholder
    }],
  },

  // Little John - Resourceful Outlaw: "while exerted, your bodyguards get Resist +1 and +1 lore"
  "little-john-resourceful-outlaw": {
    abilities: [
      { type: "static", storyName: "TOUGH AS NAILS",
        rulesText: "While this character is exerted, your characters with Bodyguard gain Resist +1.",
        effect: { type: "grant_keyword", keyword: "resist", value: 1,
          target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasKeyword: "bodyguard" } } },
        condition: { type: "this_is_exerted" },
      },
      { type: "static",
        rulesText: "While this character is exerted, your characters with Bodyguard get +1 {L}.",
        effect: { type: "modify_stat", stat: "lore", modifier: 1,
          target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasKeyword: "bodyguard" } } },
        condition: { type: "this_is_exerted" },
      },
    ],
  },

  // Simba - Fighting Prince: "When you play AND when banishes another in challenge, may choose one"
  // Use ChooseEffect on enters_play (and another on banished_other_in_challenge)
  "simba-fighting-prince": {
    abilities: [
      { type: "triggered", storyName: "PROUD HUNTER",
        rulesText: "When you play this character, you may choose one: Draw 2 cards then discard 2 cards, OR deal 2 damage to chosen character.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "choose", count: 1, options: [
            [
              { type: "draw", amount: 2, target: { type: "self" } },
              { type: "discard_from_hand", amount: 2, target: { type: "self" }, chooser: "target_player" },
            ],
            [{ type: "deal_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } }],
          ],
        }],
      },
      { type: "triggered",
        rulesText: "Whenever he banishes another character in a challenge during your turn, you may choose one: same as above.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [{
          type: "choose", count: 1, options: [
            [
              { type: "draw", amount: 2, target: { type: "self" } },
              { type: "discard_from_hand", amount: 2, target: { type: "self" }, chooser: "target_player" },
            ],
            [{ type: "deal_damage", amount: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } }],
          ],
        }],
      },
    ],
  },

  // Olympus Would Be That Way: "Your characters get +3 {S} while challenging a location this turn"
  // Note: this is +3 STR (a stat modifier), NOT Challenger (which is a keyword bonus).
  // Approximation: blanket +3 STR to all own characters this turn.
  // TODO: should only apply during challenges against locations
  "olympus-would-be-that-way": {
    actionEffects: [
      { type: "gain_stats", strength: 3,
        target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } },
        duration: "this_turn" },
      // TODO: should only apply when challenging a location specifically
    ],
  },

  // The Sorcerer's Hat: "Name a card, reveal top, if matches put in hand, otherwise top of deck"
  // Approximation: look at top, may put one in hand
  "the-sorcerers-hat": {
    abilities: [{
      type: "activated", storyName: "ABRACADABRA",
      rulesText: "Name a card, then reveal the top card of your deck. If it's the named card, put that card into your hand. Otherwise, put it on the top of your deck.",
      costs: [{ type: "exert" }],
      effects: [{ type: "look_at_top", count: 1, action: "one_to_hand_rest_bottom", target: { type: "self" }, isMay: true }],
    }],
  },

  // Morph - Space Goo: MIMICRY — "any Shift character may shift onto this as if this had any name"
  // TODO: needs MIMICRY shift target support — known approximation
  "morph-space-goo": {
    abilities: [{
      type: "static", storyName: "MIMICRY",
      rulesText: "You may play any character with Shift on this character as if this character had any name.",
      // TODO: shift name override needs new mechanic
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Ursula - Deceiver of All: "When sings a song, may play that song again from discard"
  // TODO: needs sings trigger + replay-from-discard
  "ursula-deceiver-of-all": {
    abilities: [{
      type: "static", storyName: "MASTERFUL DECEIT",
      rulesText: "Whenever this character sings a song, you may play that song again from your discard for free, then put it on the bottom of your deck.",
      // TODO: needs sings trigger event
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // I've Got a Dream: Song — "Ready chosen char at a location, can't quest, gain lore equal to that location's lore"
  // Approximation: ready chosen char of yours, gain 1 lore
  "ive-got-a-dream": {
    actionEffects: [
      { type: "ready", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], atLocation: "any" } },
        followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] },
      { type: "gain_lore", amount: 1, target: { type: "self" } },
      // TODO: dynamic gain_lore from chosen target's location's lore
    ],
  },

  // Jim Hawkins - Space Traveler: "When you play, may play a location with cost 4 or less for free" + "When you play a location, this may move there for free"
  // Approximation: play_for_free for location on enters_play
  "jim-hawkins-space-traveler": {
    abilities: [
      { type: "triggered", storyName: "ASTRO NAVIGATOR",
        rulesText: "When you play this character, you may play a location with cost 4 or less for free.",
        trigger: { on: "enters_play" },
        effects: [{ type: "play_for_free", filter: { cardType: ["location"], costAtMost: 4 }, isMay: true }],
      },
      // TODO: second ability — "may move here for free" needs special move flag
    ],
  },

  // Magic Carpet - Flying Rug: "Move a character of yours to a location for free"
  // Triggered enters_play that performs a free move. Needs MOVE_CHARACTER as effect, not action.
  // TODO: needs "move_character" effect type (not action)
  "magic-carpet-flying-rug": {
    abilities: [{
      type: "triggered", storyName: "GLIDING RIDE",
      rulesText: "When you play this character, move a character of yours to a location for free.",
      trigger: { on: "enters_play" },
      // TODO: needs move_character effect. Placeholder no-op static-like effect.
      effects: [{ type: "gain_lore", amount: 0, target: { type: "self" } }],
    }],
  },

  // Voyage: Song — "Move up to 2 of your characters to the same location for free"
  // Same need as Magic Carpet
  "voyage": {
    actionEffects: [
      // TODO: needs move_character effect
      { type: "gain_lore", amount: 0, target: { type: "self" } },
    ],
  },
});
