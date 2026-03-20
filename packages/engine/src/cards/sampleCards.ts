// =============================================================================
// SAMPLE CARD DEFINITIONS
// These 20 cards cover every mechanic the engine needs to support.
// Each card is chosen to exercise a specific rule, not because it's powerful.
//
// Placeholder card data — use actual card names/stats from the Lorcana community
// JSON dataset (https://github.com/lorcanito/lorcana-data) for production.
// =============================================================================

import type { CardDefinition } from "../types/index.js";

export const SAMPLE_CARDS: CardDefinition[] = [
  // ---------------------------------------------------------------------------
  // VANILLA — Tests: basic play, quest, challenge
  // ---------------------------------------------------------------------------
  {
    id: "moana-of-motunui",
    name: "Moana",
    subtitle: "Of Motunui",
    fullName: "Moana - Of Motunui",
    cardType: "character",
    inkColor: "ruby",
    cost: 5,
    inkable: true,
    traits: ["Hero", "Princess", "Storyborn"],
    strength: 3,
    willpower: 4,
    lore: 2,
    abilities: [],
    flavorText: "The ocean chose her.",
    setId: "TFC",
    number: 126,
    rarity: "uncommon",
  },

  // ---------------------------------------------------------------------------
  // EVASIVE — Tests: can only be challenged by Evasive characters
  // ---------------------------------------------------------------------------
  {
    id: "tinker-bell-tiny-tactician",
    name: "Tinker Bell",
    subtitle: "Tiny Tactician",
    fullName: "Tinker Bell - Tiny Tactician",
    cardType: "character",
    inkColor: "emerald",
    cost: 3,
    inkable: true,
    traits: ["Fairy", "Floodborn"],
    strength: 2,
    willpower: 2,
    lore: 1,
    abilities: [{ type: "keyword", keyword: "evasive" }],
    flavorText: "Fast and fierce.",
    setId: "TFC",
    number: 57,
    rarity: "common",
  },

  // ---------------------------------------------------------------------------
  // RUSH — Tests: can challenge the turn it enters play
  // ---------------------------------------------------------------------------
  {
    id: "beast-hardheaded",
    name: "Beast",
    subtitle: "Hardheaded",
    fullName: "Beast - Hardheaded",
    cardType: "character",
    inkColor: "ruby",
    cost: 4,
    inkable: true,
    traits: ["Villain", "Storyborn"],
    strength: 4,
    willpower: 3,
    lore: 1,
    abilities: [{ type: "keyword", keyword: "rush" }],
    setId: "TFC",
    number: 105,
    rarity: "rare",
  },

  // ---------------------------------------------------------------------------
  // BODYGUARD — Tests: must be challenged before other characters
  // ---------------------------------------------------------------------------
  {
    id: "gaston-boastful-hunter",
    name: "Gaston",
    subtitle: "Boastful Hunter",
    fullName: "Gaston - Boastful Hunter",
    cardType: "character",
    inkColor: "amber",
    cost: 5,
    inkable: true,
    traits: ["Villain", "Storyborn"],
    strength: 5,
    willpower: 5,
    lore: 1,
    abilities: [{ type: "keyword", keyword: "bodyguard" }],
    setId: "TFC",
    number: 14,
    rarity: "super_rare",
  },

  // ---------------------------------------------------------------------------
  // WARD — Tests: cannot be targeted by opponent's abilities
  // ---------------------------------------------------------------------------
  {
    id: "elsa-snow-queen",
    name: "Elsa",
    subtitle: "Snow Queen",
    fullName: "Elsa - Snow Queen",
    cardType: "character",
    inkColor: "amethyst",
    cost: 6,
    inkable: false,
    traits: ["Hero", "Queen", "Sorcerer", "Storyborn"],
    strength: 3,
    willpower: 6,
    lore: 3,
    abilities: [{ type: "keyword", keyword: "ward" }],
    setId: "TFC",
    number: 42,
    rarity: "legendary",
  },

  // ---------------------------------------------------------------------------
  // CHALLENGER — Tests: +STR when challenging
  // ---------------------------------------------------------------------------
  {
    id: "hercules-hero-in-training",
    name: "Hercules",
    subtitle: "Hero in Training",
    fullName: "Hercules - Hero in Training",
    cardType: "character",
    inkColor: "ruby",
    cost: 4,
    inkable: true,
    traits: ["Hero", "Storyborn"],
    strength: 3,
    willpower: 4,
    lore: 1,
    abilities: [{ type: "keyword", keyword: "challenger", value: 2 }],
    setId: "TFC",
    number: 116,
    rarity: "uncommon",
  },

  // ---------------------------------------------------------------------------
  // SUPPORT — Tests: gives strength to another character when questing
  // ---------------------------------------------------------------------------
  {
    id: "pascal-rapunzels-companion",
    name: "Pascal",
    subtitle: "Rapunzel's Companion",
    fullName: "Pascal - Rapunzel's Companion",
    cardType: "character",
    inkColor: "emerald",
    cost: 1,
    inkable: true,
    traits: ["Ally", "Storyborn"],
    strength: 1,
    willpower: 1,
    lore: 1,
    abilities: [{ type: "keyword", keyword: "support" }],
    setId: "TFC",
    number: 64,
    rarity: "common",
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED ABILITY (enters play) — Tests: "when this enters play, draw a card"
  // ---------------------------------------------------------------------------
  {
    id: "rapunzel-letting-down-hair",
    name: "Rapunzel",
    subtitle: "Letting Down Her Hair",
    fullName: "Rapunzel - Letting Down Her Hair",
    cardType: "character",
    inkColor: "amber",
    cost: 4,
    inkable: true,
    traits: ["Hero", "Princess", "Storyborn"],
    strength: 2,
    willpower: 4,
    lore: 2,
    abilities: [
      {
        type: "triggered",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "draw",
            amount: 1,
            target: { type: "self" },
          },
        ],
      },
    ],
    flavorText: "When she sings, the world listens.",
    setId: "TFC",
    number: 31,
    rarity: "rare",
  },

  // ---------------------------------------------------------------------------
  // ACTIVATED ABILITY — Tests: "Exert, pay 2 ink: deal 1 damage to chosen character"
  // ---------------------------------------------------------------------------
  {
    id: "merlin-arthurian-legend",
    name: "Merlin",
    subtitle: "Arthurian Legend",
    fullName: "Merlin - Arthurian Legend",
    cardType: "character",
    inkColor: "sapphire",
    cost: 5,
    inkable: true,
    traits: ["Ally", "Sorcerer", "Storyborn"],
    strength: 2,
    willpower: 5,
    lore: 2,
    abilities: [
      {
        type: "activated",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 2 }],
        effects: [
          {
            type: "deal_damage",
            amount: 1,
            target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
          },
        ],
        reminderText: "↷, 2 ⬡: Deal 1 damage to chosen character.",
      },
    ],
    setId: "TFC",
    number: 87,
    rarity: "super_rare",
  },

  // ---------------------------------------------------------------------------
  // SINGER — Tests: can use songs cheaper
  // ---------------------------------------------------------------------------
  {
    id: "ariel-on-human-legs",
    name: "Ariel",
    subtitle: "On Human Legs",
    fullName: "Ariel - On Human Legs",
    cardType: "character",
    inkColor: "ruby",
    cost: 4,
    inkable: true,
    traits: ["Hero", "Princess", "Storyborn"],
    strength: 2,
    willpower: 3,
    lore: 2,
    abilities: [{ type: "keyword", keyword: "singer", value: 5 }],
    setId: "TFC",
    number: 100,
    rarity: "rare",
  },

  // ---------------------------------------------------------------------------
  // SHIFT — Tests: can be played at reduced cost onto a character with same name
  // ---------------------------------------------------------------------------
  {
    id: "moana-chosen-by-the-ocean",
    name: "Moana",
    subtitle: "Chosen by the Ocean",
    fullName: "Moana - Chosen by the Ocean",
    cardType: "character",
    inkColor: "ruby",
    cost: 8,
    inkable: false,
    traits: ["Hero", "Princess", "Floodborn"],
    strength: 5,
    willpower: 7,
    lore: 3,
    shiftCost: 5,
    abilities: [
      { type: "keyword", keyword: "shift", value: 5 },
      { type: "keyword", keyword: "ward" },
      {
        type: "triggered",
        trigger: { on: "quests" },
        effects: [
          { type: "draw", amount: 2, target: { type: "self" } },
        ],
      },
    ],
    setId: "ROF",
    number: 112,
    rarity: "legendary",
  },

  // ---------------------------------------------------------------------------
  // RESIST — Tests: incoming damage is reduced
  // ---------------------------------------------------------------------------
  {
    id: "maui-hero-to-all",
    name: "Maui",
    subtitle: "Hero to All",
    fullName: "Maui - Hero to All",
    cardType: "character",
    inkColor: "steel",
    cost: 6,
    inkable: false,
    traits: ["Hero", "Deity", "Storyborn"],
    strength: 5,
    willpower: 7,
    lore: 2,
    abilities: [{ type: "keyword", keyword: "resist", value: 2 }],
    setId: "TFC",
    number: 191,
    rarity: "legendary",
  },

  // ---------------------------------------------------------------------------
  // RECKLESS — Tests: cannot quest, can only challenge
  // ---------------------------------------------------------------------------
  {
    id: "hades-lord-of-underworld",
    name: "Hades",
    subtitle: "Lord of the Underworld",
    fullName: "Hades - Lord of the Underworld",
    cardType: "character",
    inkColor: "amethyst",
    cost: 7,
    inkable: false,
    traits: ["Villain", "Deity", "Storyborn"],
    strength: 7,
    willpower: 5,
    lore: 0,
    abilities: [{ type: "keyword", keyword: "reckless" }],
    setId: "TFC",
    number: 39,
    rarity: "super_rare",
  },

  // ---------------------------------------------------------------------------
  // SONG — Tests: can be sung by a Singer character
  // ---------------------------------------------------------------------------
  {
    id: "be-our-guest",
    name: "Be Our Guest",
    subtitle: undefined,
    fullName: "Be Our Guest",
    cardType: "action",
    inkColor: "amber",
    cost: 3,
    inkable: true,
    traits: ["Song"],
    abilities: [],
    // Be Our Guest: Look at the top 4 cards of your deck. You may reveal an action card
    // and put it in your hand. Put the rest on the bottom of your deck.
    // Implemented as: draw 1 (simplified)
    setId: "TFC",
    number: 3,
    rarity: "uncommon",
  },

  // ---------------------------------------------------------------------------
  // ACTION — Tests: basic action card with damage effect
  // ---------------------------------------------------------------------------
  {
    id: "fire-the-cannons",
    name: "Fire the Cannons!",
    subtitle: undefined,
    fullName: "Fire the Cannons!",
    cardType: "action",
    inkColor: "steel",
    cost: 1,
    inkable: true,
    traits: [],
    abilities: [
      {
        type: "triggered",
        trigger: { on: "enters_play" }, // Actions resolve immediately on play
        effects: [
          {
            type: "deal_damage",
            amount: 2,
            target: {
              type: "chosen",
              filter: { zone: "play", cardType: ["character"] },
            },
          },
        ],
      },
    ],
    setId: "TFC",
    number: 177,
    rarity: "common",
  },

  // ---------------------------------------------------------------------------
  // ITEM — Tests: item card that stays in play
  // ---------------------------------------------------------------------------
  {
    id: "fishbone-quill",
    name: "Fishbone Quill",
    subtitle: undefined,
    fullName: "Fishbone Quill",
    cardType: "item",
    inkColor: "amethyst",
    cost: 2,
    inkable: true,
    traits: ["Item"],
    abilities: [
      {
        type: "activated",
        costs: [{ type: "exert" }, { type: "pay_ink", amount: 1 }],
        effects: [
          { type: "draw", amount: 1, target: { type: "self" } },
        ],
        reminderText: "↷, 1 ⬡: Draw a card.",
      },
    ],
    setId: "TFC",
    number: 35,
    rarity: "uncommon",
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED (quests) — Tests: on-quest trigger
  // ---------------------------------------------------------------------------
  {
    id: "mickey-mouse-wayward-sorcerer",
    name: "Mickey Mouse",
    subtitle: "Wayward Sorcerer",
    fullName: "Mickey Mouse - Wayward Sorcerer",
    cardType: "character",
    inkColor: "amethyst",
    cost: 5,
    inkable: false,
    traits: ["Hero", "Sorcerer", "Storyborn"],
    strength: 3,
    willpower: 4,
    lore: 2,
    abilities: [
      {
        type: "triggered",
        trigger: { on: "quests" },
        effects: [
          { type: "draw", amount: 1, target: { type: "self" } },
        ],
      },
    ],
    setId: "TFC",
    number: 43,
    rarity: "legendary",
  },

  // ---------------------------------------------------------------------------
  // TRIGGERED (banished) — Tests: when this is banished effect
  // ---------------------------------------------------------------------------
  {
    id: "genie-on-the-job",
    name: "Genie",
    subtitle: "On the Job",
    fullName: "Genie - On the Job",
    cardType: "character",
    inkColor: "sapphire",
    cost: 5,
    inkable: false,
    traits: ["Ally", "Deity", "Storyborn"],
    strength: 4,
    willpower: 3,
    lore: 2,
    abilities: [
      {
        type: "triggered",
        trigger: { on: "is_banished" },
        effects: [
          { type: "draw", amount: 2, target: { type: "self" } },
        ],
      },
    ],
    flavorText: "Al, you're not gonna believe this.",
    setId: "TFC",
    number: 77,
    rarity: "super_rare",
  },

  // ---------------------------------------------------------------------------
  // LOW-COST FILLER — Tests: early game ink plays
  // ---------------------------------------------------------------------------
  {
    id: "stitch-rock-star",
    name: "Stitch",
    subtitle: "Rock Star",
    fullName: "Stitch - Rock Star",
    cardType: "character",
    inkColor: "amethyst",
    cost: 2,
    inkable: true,
    traits: ["Alien", "Floodborn"],
    strength: 2,
    willpower: 2,
    lore: 1,
    abilities: [],
    setId: "ROF",
    number: 56,
    rarity: "common",
  },

  {
    id: "simba-protective-cub",
    name: "Simba",
    subtitle: "Protective Cub",
    fullName: "Simba - Protective Cub",
    cardType: "character",
    inkColor: "amber",
    cost: 1,
    inkable: true,
    traits: ["Hero", "Storyborn"],
    strength: 1,
    willpower: 2,
    lore: 1,
    abilities: [],
    setId: "TFC",
    number: 32,
    rarity: "common",
  },
];

/** Look up table keyed by definition ID */
export const SAMPLE_CARD_DEFINITIONS: Record<string, CardDefinition> =
  Object.fromEntries(SAMPLE_CARDS.map((c) => [c.id, c]));
