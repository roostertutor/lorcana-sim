#!/usr/bin/env node
// Cherry-pick: wire fits-grammar cards across all sets where every clause maps
// to an existing engine primitive. No new primitives. Skips are tracked in
// DEFERRED_MECHANICS.md.
//
// Skipped (compound / missing primitive):
//   - mystical-tree-mama-odies-home: location-centric start-of-turn + named-here cond
//   - kakamora-pirate-chief: branch depends on DISCARDED card type
//   - dalmatian-puppy-tail-wagger: deckbuilding rule only, no gameplay effect
//   - everybodys-got-a-weakness: dynamic draw = counters moved
//   - faline-playful-fawn: "more S than each opposing" comparison condition
//   - namaari-single-minded-rival: static strengthDynamic not supported
//   - powerline: play-from-revealed deferred
//   - alice-growing-girl: self-strength-gte condition
//   - grandmother-willow: 0-cost activated "once during your turn" ambiguity
//   - cri-kee/sina/amos-slade: vanilla Alert (already keyword-only)
//   - hiro-hamada set-P2 duplicates are dual-ink and the set-7 primary gets
//     patched via main set file; P2 file is separate — patched there too.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARD_DIR = join(__dirname, "../packages/engine/src/cards");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const BOTH = { type: "both" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

type Patch = { abilities?: any[]; actionEffects?: any[] };
type SetPatches = Record<string, Patch>;

// ─── set-006 ─────────────────────────────────────────────────────
const SET_006: SetPatches = {
  "lose-the-way": {
    // Exert chosen character. Then, you may choose and discard a card. If you
    // do, the exerted character can't ready at the start of their next turn.
    actionEffects: [{
      type: "exert",
      target: { type: "chosen", filter: ANY_CHAR },
      followUpEffects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" }],
        rewardEffects: [{
          type: "cant_action", action: "ready",
          duration: "end_of_owner_next_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "jasmine-royal-seafarer": {
    // BY ORDER OF THE PRINCESS — choose one on ETB.
    abilities: [{
      type: "triggered",
      storyName: "BY ORDER OF THE PRINCESS",
      rulesText: "When you play this character, choose one: Exert chosen damaged character. Chosen opposing character gains Reckless during their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "choose",
        count: 1,
        options: [
          [{ type: "exert", target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } } }],
          [{
            type: "grant_keyword", keyword: "reckless",
            duration: "end_of_owner_next_turn",
            target: { type: "chosen", filter: ALL_OPP_CHARS },
          }],
        ],
      }],
    }],
  },

  "megabot": {
    abilities: [
      {
        type: "triggered",
        storyName: "HAPPY FACE",
        rulesText: "This item enters play exerted.",
        trigger: { on: "enters_play" },
        effects: [{ type: "exert", target: { type: "this" } }],
      },
      {
        type: "activated",
        storyName: "DESTROY!",
        rulesText: "{E}, Banish this item — Choose one: Banish chosen item. Banish chosen damaged character.",
        costs: [{ type: "exert" }, { type: "banish_self" }],
        effects: [{
          type: "choose",
          count: 1,
          options: [
            [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } } }],
            [{ type: "banish", target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } } }],
          ],
        }],
      },
    ],
  },

  "baymax-personal-healthcare-companion": {
    abilities: [
      {
        type: "static",
        storyName: "FULLY CHARGED",
        rulesText: "If you have an Inventor character in play, you pay 1 {I} less to play this character.",
        condition: { type: "has_character_with_trait", trait: "Inventor", player: SELF },
        effect: { type: "self_cost_reduction", amount: 1 },
      },
      {
        type: "activated",
        storyName: "YOU SAID 'OW'",
        rulesText: "2 {I} — Remove up to 1 damage from another chosen character.",
        costs: [{ type: "ink", amount: 2 }],
        effects: [{
          type: "remove_damage", amount: 1, isUpTo: true,
          target: { type: "chosen", filter: { ...ANY_CHAR, excludeSelf: true } },
        }],
      },
    ],
  },
};

// ─── set-007 ─────────────────────────────────────────────────────
const SET_007: SetPatches = {
  "hiro-hamada-armor-designer": {
    // Your Floodborn chars with a card under them gain Evasive and Ward.
    abilities: [
      {
        type: "static",
        storyName: "YOU CAN BE WAY MORE (Evasive)",
        rulesText: "Your Floodborn characters that have a card under them gain Evasive.",
        effect: {
          type: "grant_keyword", keyword: "evasive",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Floodborn", hasCardUnder: true } },
        },
      },
      {
        type: "static",
        storyName: "YOU CAN BE WAY MORE (Ward)",
        rulesText: "Your Floodborn characters that have a card under them gain Ward.",
        effect: {
          type: "grant_keyword", keyword: "ward",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Floodborn", hasCardUnder: true } },
        },
      },
    ],
  },

  "miss-bianca-unwavering-agent": {
    abilities: [{
      type: "static",
      storyName: "HAVE A LITTLE FAITH",
      rulesText: "If you have an Ally character in play, you pay 2 {I} less to play this character.",
      condition: { type: "has_character_with_trait", trait: "Ally", player: SELF },
      effect: { type: "self_cost_reduction", amount: 2 },
    }],
  },
};

// ─── set-008 ─────────────────────────────────────────────────────
const SET_008: SetPatches = {
  "lady-family-dog": {
    abilities: [{
      type: "triggered",
      storyName: "SOMEONE TO CARE FOR",
      rulesText: "When you play this character, you may play a character with cost 2 or less for free.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "play_for_free", isMay: true, sourceZone: "hand",
        filter: { cardType: ["character"], maxCost: 2 },
      }],
    }],
  },

  "rolly-chubby-puppy": {
    abilities: [{
      type: "triggered",
      storyName: "ADORABLE ANTICS",
      rulesText: "When you play this character, you may put a character card from your discard into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "discard",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      }],
    }],
  },

  "shes-your-person": {
    actionEffects: [{
      type: "choose",
      count: 1,
      options: [
        [{
          type: "remove_damage", amount: 3, isUpTo: true,
          target: { type: "chosen", filter: ANY_CHAR },
        }],
        [{
          type: "remove_damage", amount: 3, isUpTo: true,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasKeyword: "bodyguard" } },
        }],
      ],
    }],
  },

  "pinocchio-strings-attached": {
    abilities: [{
      type: "triggered",
      storyName: "GOT TO KEEP REAL QUIET",
      rulesText: "Once during your turn, whenever you ready this character, you may draw a card.",
      trigger: { on: "readied" },
      condition: { type: "is_your_turn" },
      oncePerTurn: true,
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "kuzco-impulsive-llama": {
    abilities: [{
      type: "triggered",
      storyName: "WHAT DOES THIS DO?",
      rulesText: "When you play this character, each opponent chooses one of their characters and puts that card on the bottom of their deck. Then, each opponent may draw a card.",
      trigger: { on: "enters_play" },
      effects: [
        {
          type: "put_on_bottom_of_deck",
          from: "play",
          target: { type: "chosen", filter: ALL_OPP_CHARS, chooser: "target_player" },
        },
        { type: "draw", amount: 1, isMay: true, target: OPP },
      ],
    }],
  },

  "pull-the-lever": {
    actionEffects: [{
      type: "choose",
      count: 1,
      options: [
        [{ type: "draw", amount: 2, target: SELF }],
        [{ type: "discard_from_hand", amount: 1, target: OPP, chooser: "target_player" }],
      ],
    }],
  },

  "mad-dog-karnages-first-mate": {
    abilities: [{
      type: "static",
      storyName: "ARE YOU SURE THIS IS SAFE, CAPTAIN?",
      rulesText: "If you have a character named Don Karnage in play, you pay 1 {I} less to play this character.",
      condition: { type: "has_character_named", name: "Don Karnage", player: SELF },
      effect: { type: "self_cost_reduction", amount: 1 },
    }],
  },

  "light-the-fuse": {
    actionEffects: [{
      type: "deal_damage",
      amount: { type: "count", filter: { ...ALL_OWN_CHARS, isExerted: true } },
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "television-set": {
    abilities: [{
      type: "activated",
      storyName: "IS IT ON YET?",
      rulesText: "{E}, 1 {I} — Look at the top card of your deck. If it's a Puppy character card, you may reveal it and put it into your hand. Otherwise, put it on the bottom of your deck.",
      costs: [{ type: "exert" }, { type: "ink", amount: 1 }],
      effects: [{
        type: "reveal_top_conditional",
        filter: { cardType: ["character"], hasTrait: "Puppy" },
        matchAction: "to_hand",
        isMay: true,
        target: SELF,
      }],
    }],
  },

  "beyond-the-horizon": {
    // Sing Together 7 already in keywords.
    // Approximation: each opponent discards hand + draws 3. ("Choose any number
    // of players" — engine has no multi-player prompt.)
    actionEffects: [
      { type: "discard_from_hand", amount: "all", target: OPP, chooser: "target_player" },
      { type: "draw", amount: 3, target: OPP },
      { type: "discard_from_hand", amount: "all", target: SELF, chooser: "target_player" },
      { type: "draw", amount: 3, target: SELF },
    ],
  },
};

// ─── set-009 ─────────────────────────────────────────────────────
const SET_009: SetPatches = {
  "look-at-this-family": {
    actionEffects: [{
      type: "look_at_top",
      count: 5,
      action: "up_to_n_to_hand_rest_bottom",
      maxToHand: 2,
      filter: { cardType: ["character"] },
      target: SELF,
    }],
  },

  "camilo-madrigal-prankster": {
    abilities: [{
      type: "triggered",
      storyName: "MANY FORMS",
      rulesText: "At the start of your turn, you may choose one: This character gets +1 {L} this turn. This character gains Challenger +2 this turn.",
      trigger: { on: "turn_start" },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "choose",
        count: 1,
        options: [
          [{
            type: "gain_stats", lore: 1, duration: "this_turn",
            target: { type: "this" }, isMay: true,
          }],
          [{
            type: "grant_keyword", keyword: "challenger", value: 2,
            duration: "end_of_turn",
            target: { type: "this" }, isMay: true,
          }],
        ],
      }],
    }],
  },

  "family-fishing-pole": {
    abilities: [
      {
        type: "triggered",
        storyName: "WATCH CLOSELY",
        rulesText: "This item enters play exerted.",
        trigger: { on: "enters_play" },
        effects: [{ type: "exert", target: { type: "this" } }],
      },
      {
        type: "activated",
        storyName: "THE PERFECT CAST",
        rulesText: "{E}, 1 {I}, Banish this item – Return chosen exerted character of yours to your hand to gain 2 lore.",
        costs: [{ type: "exert" }, { type: "ink", amount: 1 }, { type: "banish_self" }],
        effects: [{
          type: "sequential",
          costEffects: [{
            type: "return_to_hand",
            target: { type: "chosen", filter: { ...ALL_OWN_CHARS, isExerted: true } },
          }],
          rewardEffects: [{ type: "gain_lore", amount: 2, target: SELF }],
        }],
      },
    ],
  },

  "maui-whale": {
    abilities: [
      {
        type: "static",
        storyName: "THIS MISSION IS CURSED",
        rulesText: "This character can't ready at the start of your turn.",
        effect: { type: "cant_action_self", action: "ready" },
      },
      {
        type: "activated",
        storyName: "I GOT YOUR BACK",
        rulesText: "2 {I} – Ready this character. He can't quest for the rest of this turn.",
        costs: [{ type: "ink", amount: 2 }],
        effects: [{
          type: "ready",
          target: { type: "this" },
          followUpEffects: [{
            type: "cant_action", action: "quest", duration: "end_of_turn",
            target: { type: "this" },
          }],
        }],
      },
    ],
  },

  "dig-a-little-deeper": {
    // Sing Together 8 already keyword. Approximation: "Put 2" → up to 2.
    actionEffects: [{
      type: "look_at_top",
      count: 7,
      action: "up_to_n_to_hand_rest_bottom",
      maxToHand: 2,
      target: SELF,
    }],
  },

  "little-john-sir-reginald": {
    abilities: [{
      type: "triggered",
      storyName: "WHAT A BEAUTIFUL BRAWL!",
      rulesText: "When you play this character, choose one: Chosen Hero character gains Resist +2 this turn. Deal 2 damage to chosen Villain character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "choose",
        count: 1,
        options: [
          [{
            type: "grant_keyword", keyword: "resist", value: 2,
            duration: "end_of_turn",
            target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Hero" } },
          }],
          [{
            type: "deal_damage", amount: 2,
            target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Villain" } },
          }],
        ],
      }],
    }],
  },
};

// ─── set-010 ─────────────────────────────────────────────────────
const SET_010: SetPatches = {
  "ariel-ethereal-voice": {
    // Boost 1 {I} is keyword; wire COMMAND PERFORMANCE only.
    abilities: [{
      type: "triggered",
      storyName: "COMMAND PERFORMANCE",
      rulesText: "Once during your turn, whenever you play a song, if there's a card under this character, you may draw a card.",
      trigger: { on: "card_played", filter: { cardType: ["action"], hasKeyword: "singer", owner: SELF } },
      condition: { type: "this_has_cards_under" },
      oncePerTurn: true,
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "baloo-carefree-bear": {
    abilities: [{
      type: "triggered",
      storyName: "ROLL WITH IT",
      rulesText: "When you play this character, choose one: Each player draws a card. Each player chooses and discards a card.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "choose",
        count: 1,
        options: [
          [{ type: "draw", amount: 1, target: BOTH }],
          [{ type: "discard_from_hand", amount: 1, target: BOTH, chooser: "target_player" }],
        ],
      }],
    }],
  },

  "akela-forest-runner": {
    abilities: [{
      type: "activated",
      storyName: "AHEAD OF THE PACK",
      rulesText: "1 {I} — This character gets +1 {S} this turn.",
      costs: [{ type: "ink", amount: 1 }],
      effects: [{
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "ingenious-device": {
    abilities: [
      {
        type: "activated",
        storyName: "SURPRISE PACKAGE",
        rulesText: "{E}, 2 {I}, Banish this item — Draw a card, then choose and discard a card.",
        costs: [{ type: "exert" }, { type: "ink", amount: 2 }, { type: "banish_self" }],
        effects: [
          { type: "draw", amount: 1, target: SELF },
          { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
        ],
      },
      {
        type: "triggered",
        storyName: "TIME GROWS SHORT",
        rulesText: "During your turn, when this item is banished, deal 3 damage to chosen character or location.",
        trigger: { on: "is_banished" },
        condition: { type: "is_your_turn" },
        effects: [{
          type: "deal_damage", amount: 3,
          target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"] } },
        }],
      },
    ],
  },
};

// ─── set-011 ─────────────────────────────────────────────────────
const SET_011: SetPatches = {
  "pudge-controls-the-weather": {
    // If a Lilo char is in play, pay full cost (2) less = free.
    abilities: [{
      type: "static",
      storyName: "GOOD FRIEND",
      rulesText: "If you have a character named Lilo in play, you can play this character for free.",
      condition: { type: "has_character_named", name: "Lilo", player: SELF },
      effect: { type: "self_cost_reduction", amount: 2 },
    }],
  },

  "vixey-forest-friend": {
    abilities: [{
      type: "static",
      storyName: "SHOWIN' UP",
      rulesText: "If you have a character named Tod in play, you pay 1 {I} less to play this character.",
      condition: { type: "has_character_named", name: "Tod", player: SELF },
      effect: { type: "self_cost_reduction", amount: 1 },
    }],
  },

  "tod-playful-kit": {
    abilities: [{
      type: "triggered",
      storyName: "LOOK AT THIS!",
      rulesText: "Whenever this character quests, choose one: Gain 1 lore. Chosen character of yours gains Evasive until the start of your next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "choose",
        count: 1,
        options: [
          [{ type: "gain_lore", amount: 1, target: SELF }],
          [{
            type: "grant_keyword", keyword: "evasive",
            duration: "until_caster_next_turn",
            target: { type: "chosen", filter: ALL_OWN_CHARS },
          }],
        ],
      }],
    }],
  },

  "education-or-elimination": {
    // Singer reminder text is vanilla; wire action body as choose-one.
    actionEffects: [{
      type: "choose",
      count: 1,
      options: [
        [
          { type: "draw", amount: 1, target: SELF },
          {
            type: "gain_stats", lore: 1, duration: "until_caster_next_turn",
            target: { type: "chosen", filter: ALL_OWN_CHARS },
            followUpEffects: [{
              type: "grant_keyword", keyword: "evasive",
              duration: "until_caster_next_turn",
              target: { type: "this" },
            }],
          },
        ],
        [{
          type: "banish",
          target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
        }],
      ],
    }],
  },

  "gramma-tala-connected-to-nature": {
    abilities: [{
      type: "static",
      storyName: "ANCESTORS' GIFT",
      rulesText: "For each card in your inkwell, you pay 1 {I} less to play this character.",
      effect: {
        type: "self_cost_reduction",
        amount: { type: "count", filter: { owner: SELF, zone: "inkwell" } },
      },
    }],
  },

  "hidden-trap": {
    abilities: [
      {
        type: "triggered",
        storyName: "ALMOST READY",
        rulesText: "This item enters play exerted.",
        trigger: { on: "enters_play" },
        effects: [{ type: "exert", target: { type: "this" } }],
      },
      {
        type: "activated",
        storyName: "SNAP!",
        rulesText: "{E}, Banish this item — Choose one: Banish chosen item. Chosen opposing character gets -2 {S} this turn.",
        costs: [{ type: "exert" }, { type: "banish_self" }],
        effects: [{
          type: "choose",
          count: 1,
          options: [
            [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } } }],
            [{
              type: "gain_stats", strength: -2, duration: "this_turn",
              target: { type: "chosen", filter: ALL_OPP_CHARS },
            }],
          ],
        }],
      },
    ],
  },
};

// ─── set-0P1 ─────────────────────────────────────────────────────
const SET_0P1: SetPatches = {
  "scrooge-mcduck-uncle-moneybags": {
    abilities: [{
      type: "triggered",
      storyName: "TREASURE FINDER",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next item you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_cost_reduction", amount: 1, filter: { cardType: ["item"] },
      }],
    }],
  },
};

// ─── set-0P2 ─────────────────────────────────────────────────────
const SET_0P2: SetPatches = {
  "hiro-hamada-armor-designer": SET_007["hiro-hamada-armor-designer"],
  "pull-the-lever": SET_008["pull-the-lever"],
};

// ─── set-0P3 ─────────────────────────────────────────────────────
const SET_0P3: SetPatches = {
  "gramma-tala-connected-to-nature": SET_011["gramma-tala-connected-to-nature"],
};

// ─── set-D23 ─────────────────────────────────────────────────────
const SET_D23: SetPatches = {
  "vanellope-von-schweetz-sugar-rush-princess": {
    abilities: [{
      type: "triggered",
      storyName: "I HEREBY DECREE",
      rulesText: "Whenever you play another Princess character, all opposing characters get -1 {S} until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Princess", owner: SELF, excludeSelf: true } },
      effects: [{
        type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
        target: { type: "all", filter: ALL_OPP_CHARS },
      }],
    }],
  },
};

// ─── Apply patches to a set file ─────────────────────────────────
function applyPatches(filename: string, patches: SetPatches) {
  const path = join(CARD_DIR, filename);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let patched = 0;
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const id of Object.keys(patches)) {
    if (!cards.find((c: any) => c.id === id)) missing.push(id);
  }
  for (const card of cards) {
    if (patches[card.id]) {
      const patch = patches[card.id];
      if (patch.abilities) {
        const existingKeywords = (card.abilities || []).filter((a: any) => a.type === "keyword");
        card.abilities = [...existingKeywords, ...patch.abilities];
      }
      if (patch.actionEffects) card.actionEffects = patch.actionEffects;
      patched++;
      if (!seen.has(card.id)) {
        console.log(`  OK ${filename} ${card.id}`);
        seen.add(card.id);
      }
    }
  }
  writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
  if (missing.length) {
    console.log(`  MISSING in ${filename}: ${missing.join(", ")}`);
  }
  return patched;
}

let total = 0;
total += applyPatches("lorcast-set-006.json", SET_006);
total += applyPatches("lorcast-set-007.json", SET_007);
total += applyPatches("lorcast-set-008.json", SET_008);
total += applyPatches("lorcast-set-009.json", SET_009);
total += applyPatches("lorcast-set-010.json", SET_010);
total += applyPatches("lorcast-set-011.json", SET_011);
total += applyPatches("lorcast-set-0P1.json", SET_0P1);
total += applyPatches("lorcast-set-0P2.json", SET_0P2);
total += applyPatches("lorcast-set-0P3.json", SET_0P3);
total += applyPatches("lorcast-set-D23.json", SET_D23);
console.log(`\nPatched ${total} card entries (cherry-pick pass).`);
