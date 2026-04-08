#!/usr/bin/env node
// Set 7 — Batch 2: ink_played triggers, card_played triggers, activated items,
// more ETBs, challenge triggers, simple actions.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-007.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };
const INK_PLAYED_OWN = { on: "ink_played" as const, player: SELF };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── ink_played triggers ────────────────────────────────────────
  "amber-coil": {
    abilities: [{
      type: "triggered",
      storyName: "AMBER HEAL",
      rulesText: "During your turn, whenever a card is put into your inkwell, you may remove up to 2 damage from chosen character.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "amethyst-coil": {
    abilities: [{
      type: "triggered",
      storyName: "AMETHYST MOVE",
      rulesText: "During your turn, whenever a card is put into your inkwell, you may move 1 damage counter from chosen character to chosen opposing character.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "move_damage", amount: 1, isMay: true,
        source: { type: "chosen", filter: ANY_CHAR },
        destination: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "emerald-coil": {
    abilities: [{
      type: "triggered",
      storyName: "EMERALD STEP",
      rulesText: "During your turn, whenever a card is put into your inkwell, chosen character gains Evasive until the start of your next turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "ruby-coil": {
    abilities: [{
      type: "triggered",
      storyName: "RUBY EDGE",
      rulesText: "During your turn, whenever a card is put into your inkwell, chosen character gets +2 {S} this turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "gain_stats", strength: 2,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "sapphire-coil": {
    abilities: [{
      type: "triggered",
      storyName: "SAPPHIRE HEX",
      rulesText: "During your turn, whenever a card is put into your inkwell, you may give chosen character -2 {S} this turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "gain_stats", strength: -2, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "steel-coil": {
    abilities: [{
      type: "triggered",
      storyName: "STEEL CYCLE",
      rulesText: "During your turn, whenever a card is put into your inkwell, you may draw a card, then choose and discard a card.",
      trigger: INK_PLAYED_OWN,
      effects: [
        { type: "draw", amount: 1, target: SELF, isMay: true },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "kuzco-temporary-whale": {
    abilities: [{
      type: "triggered",
      storyName: "DON'T YOU SAY A WORD",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, you may return chosen character, item, or location with cost 2 or less to their player's hand, then that player draws a card.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character", "item", "location"], costAtMost: 2 } },
        followUpEffects: [{ type: "draw", amount: 1, target: { type: "target_owner" } }],
      }],
    }],
  },

  "dawson-puzzling-sleuth": {
    abilities: [{
      type: "triggered",
      storyName: "BE SENSIBLE",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, look at the top card of your deck. You may put it on either the top or the bottom of your deck.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "look_at_top", count: 1,
        action: "top_or_bottom",
        target: SELF,
      }],
    }],
  },

  "daisy-duck-multitalented-pirate": {
    abilities: [{
      type: "triggered",
      storyName: "FOWL PLAY",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, chosen opponent chooses one of their characters and returns that card to their hand.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: ALL_OPP_CHARS, chooser: "target_player" },
      }],
    }],
  },

  "lyle-tiberius-rourke-crystallized-mercenary": {
    abilities: [{
      type: "triggered",
      storyName: "EXPLOSIVE",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, deal 2 damage to each character in play.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "deal_damage", amount: 2,
        target: { type: "all", filter: ANY_CHAR },
      }],
    }],
  },

  "raya-guidance-seeker": {
    abilities: [{
      type: "triggered",
      storyName: "STEADY WATCH",
      rulesText: "During your turn, whenever a card is put into your inkwell, this character gains Resist +1 until the start of your next turn.",
      trigger: INK_PLAYED_OWN,
      effects: [{
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        duration: "until_caster_next_turn",
        target: { type: "this" },
      }],
    }],
  },

  "mittens-sassy-street-cat": {
    abilities: [{
      type: "triggered",
      storyName: "NO THANKS NECESSARY",
      rulesText: "Once during your turn, whenever a card is put into your inkwell, your other characters with Bodyguard get +1 {L} this turn.",
      trigger: INK_PLAYED_OWN,
      oncePerTurn: true,
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasKeyword: "bodyguard" } },
      }],
    }],
  },

  // ── Play-action triggers ──────────────────────────────────────
  "pete-pirate-scoundrel": {
    abilities: [{
      type: "triggered",
      storyName: "ARRR!",
      rulesText: "Whenever you play an action that isn't a song, you may banish chosen item.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "mr-smee-efficient-captain": {
    abilities: [{
      type: "triggered",
      storyName: "MAKE IT SO",
      rulesText: "Whenever you play an action that isn't a song, you may ready chosen Pirate character.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Pirate" } },
      }],
    }],
  },

  "john-silver-vengeful-pirate": {
    abilities: [{
      type: "triggered",
      storyName: "RUN A BLADE ACROSS YA",
      rulesText: "Whenever you play an action that isn't a song, you may deal 1 damage to chosen character.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "deal_damage", amount: 1, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "milo-thatch-undaunted-scholar": {
    abilities: [{
      type: "triggered",
      storyName: "UNDAUNTED",
      rulesText: "Whenever you play an action, you may give chosen character +2 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "gain_stats", strength: 2, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "ratigan-nefarious-criminal": {
    abilities: [{
      type: "triggered",
      storyName: "SCHEMING MASTERMIND",
      rulesText: "Whenever you play an action while this character is exerted, gain 1 lore.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      condition: { type: "this_is_exerted" },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  // ── Challenge triggers ───────────────────────────────────────
  "mother-gothel-vain-sorceress": {
    abilities: [{
      type: "triggered",
      storyName: "SHIFT THE BLAME",
      rulesText: "Whenever one of your characters challenges, you may move 1 damage counter from chosen character to chosen opposing character.",
      trigger: { on: "challenges", filter: ALL_OWN_CHARS },
      effects: [{
        type: "move_damage", amount: 1, isMay: true,
        source: { type: "chosen", filter: ANY_CHAR },
        destination: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "the-matchmaker-unforgiving-expert": {
    abilities: [{
      type: "triggered",
      storyName: "DISAPPROVE",
      rulesText: "Whenever this character challenges another character, each opponent loses 1 lore.",
      trigger: { on: "challenges" },
      effects: [{ type: "lose_lore", amount: 1, target: OPP }],
    }],
  },

  "moana-island-explorer": {
    abilities: [{
      type: "triggered",
      storyName: "CHARGE TOGETHER",
      rulesText: "Whenever this character challenges another character, another chosen character of yours gets +3 {S} this turn.",
      trigger: { on: "challenges" },
      effects: [{
        type: "gain_stats", strength: 3,
        target: { type: "chosen", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  "goofy-extreme-athlete": {
    abilities: [{
      type: "triggered",
      storyName: "EXTREME SPORTS",
      rulesText: "Whenever this character challenges another character, your other characters get +1 {L} this turn.",
      trigger: { on: "challenges" },
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "all", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  "calhoun-courageous-rescuer": {
    abilities: [{
      type: "triggered",
      storyName: "RESCUE OP",
      rulesText: "Whenever this character challenges another character, you may return a Racer character card from your discard to your hand.",
      trigger: { on: "challenges" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Racer" } },
      }],
    }],
  },

  "basil-secret-informer": {
    abilities: [{
      type: "triggered",
      storyName: "INFORMED",
      rulesText: "Whenever this character quests, opposing damaged characters gain Reckless during their next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "end_of_owner_next_turn",
        target: { type: "all", filter: { ...ALL_OPP_CHARS, hasDamage: true } },
      }],
    }],
  },

  "mad-hatter-unruly-eccentric": {
    abilities: [{
      type: "triggered",
      storyName: "TEA FOR ALL",
      rulesText: "Whenever a damaged character challenges another character, you may draw a card.",
      trigger: { on: "challenges", filter: { ...ANY_CHAR, hasDamage: true } },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  // ── ETB triggers ──────────────────────────────────────────────
  "chernabog-creature-of-the-night": {
    abilities: [{
      type: "triggered",
      storyName: "NIGHT ON BALD MOUNTAIN",
      rulesText: "When you play this character, each opponent chooses and exerts one of their ready characters. They can't ready at the start of their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "chosen", filter: { ...ALL_OPP_CHARS, isExerted: false }, chooser: "target_player" },
        followUpEffects: [{
          type: "cant_action", action: "ready",
          duration: "end_of_owner_next_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "giant-cobra-ghostly-serpent": {
    abilities: [{
      type: "triggered",
      storyName: "SSSSSS",
      rulesText: "When you play this character, you may choose and discard a card to gain 2 lore.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF }],
        rewardEffects: [{ type: "gain_lore", amount: 2, target: SELF }],
      }],
    }],
  },

  "hades-fast-talker": {
    abilities: [{
      type: "triggered",
      storyName: "FAST DEAL",
      rulesText: "When you play this character, you may deal 2 damage to another chosen character of yours to banish chosen character with cost 3 or less.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{
          type: "deal_damage", amount: 2,
          target: { type: "chosen", filter: OWN_OTHER_CHARS },
        }],
        rewardEffects: [{
          type: "banish",
          target: { type: "chosen", filter: { ...ANY_CHAR, costAtMost: 3 } },
        }],
      }],
    }],
  },

  "panic-high-strung-imp": {
    abilities: [{
      type: "triggered",
      storyName: "PANIC!",
      rulesText: "When you play this character, you may move up to 2 damage counters from chosen character to chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage", amount: 2, isUpTo: true, isMay: true,
        source: { type: "chosen", filter: ANY_CHAR },
        destination: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "cheshire-cat-perplexing-feline": {
    abilities: [{
      type: "triggered",
      storyName: "DEVIOUS SMILE",
      rulesText: "When you play this character, you may deal 2 damage to chosen damaged character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 2, isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
      }],
    }],
  },

  "shere-khan-infamous-tiger": {
    abilities: [{
      type: "triggered",
      storyName: "FEAR ME",
      rulesText: "When you play this character, discard your hand.",
      trigger: { on: "enters_play" },
      effects: [{ type: "discard_from_hand", amount: "all", target: SELF }],
    }],
  },

  "penny-bolts-person": {
    abilities: [{
      type: "triggered",
      storyName: "GOOD PUP",
      rulesText: "When you play this character, you may remove up to 2 damage from chosen character and they gain Resist +1 until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
        followUpEffects: [{
          type: "grant_keyword", keyword: "resist", keywordValue: 1,
          duration: "until_caster_next_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "jebidiah-farnsworth-expedition-cook": {
    abilities: [{
      type: "triggered",
      storyName: "GOOD EATS",
      rulesText: "When you play this character, chosen character gains Resist +1 until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "razoul-menacing-guard": {
    abilities: [{
      type: "triggered",
      storyName: "FOR THE SULTAN",
      rulesText: "When you play this character, if you have a character named Jafar in play, you may banish chosen item.",
      trigger: { on: "enters_play" },
      condition: {
        type: "has_character_named", name: "Jafar", player: SELF,
      },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "jafar-aspiring-ruler": {
    abilities: [{
      type: "triggered",
      storyName: "HEAR ME OUT",
      rulesText: "When you play this character, chosen character gains Challenger +2 this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "challenger", keywordValue: 2,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "yzma-exasperated-schemer": {
    abilities: [{
      type: "triggered",
      storyName: "RUMINATE",
      rulesText: "When you play this character, you may draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "mulan-disguised-soldier": {
    abilities: [{
      type: "triggered",
      storyName: "DISGUISE",
      rulesText: "When you play this character, you may draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "tramp-enterprising-dog": {
    abilities: [{
      type: "triggered",
      storyName: "PUT UP YOUR DUKES",
      rulesText: "When you play this character, chosen character of yours gets +1 {S} this turn for each other character you have in play.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats",
        strengthDynamic: { type: "count", filter: OWN_OTHER_CHARS },
        duration: "this_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  // ── Quest triggers ──────────────────────────────────────────
  "roger-radcliffe-dog-lover": {
    abilities: [{
      type: "triggered",
      storyName: "CARE FOR PUPS",
      rulesText: "Whenever this character quests, you may remove up to 1 damage from each of your Puppy characters.",
      trigger: { on: "quests" },
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true, isMay: true,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Puppy" } },
      }],
    }],
  },

  "mirabel-madrigal-musically-talented": {
    abilities: [{
      type: "triggered",
      storyName: "CATCHY TUNE",
      rulesText: "Whenever this character quests, you may return a song card with cost 3 or less from your discard to your hand.",
      trigger: { on: "quests" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["action"], hasTrait: "Song", costAtMost: 3 } },
      }],
    }],
  },

  "tweedledee-tweedledum-strange-storytellers": {
    abilities: [{
      type: "triggered",
      storyName: "CONTRARIWISE",
      rulesText: "Whenever this character quests, you may return chosen damaged character to their player's hand.",
      trigger: { on: "quests" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
      }],
    }],
  },

  "tamatoa-happy-as-a-clam": {
    abilities: [
      {
        type: "triggered",
        storyName: "MINE",
        rulesText: "When you play this character, return up to 2 item cards from your discard to your hand.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "return_to_hand",
          target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["item"] }, count: 2 },
        }],
      },
      {
        type: "triggered",
        storyName: "GLEAM",
        rulesText: "Whenever this character quests, you may play an item for free.",
        trigger: { on: "quests" },
        effects: [{
          type: "play_for_free", isMay: true,
          filter: { owner: SELF, zone: "hand", cardType: ["item"] },
        }],
      },
    ],
  },

  // ── Items: simple effects ─────────────────────────────────────
  "maurices-machine": {
    abilities: [{
      type: "triggered",
      storyName: "RECYCLED PARTS",
      rulesText: "When this item is banished, you may return an item card with cost 2 or less from your discard to your hand.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["item"], costAtMost: 2 } },
      }],
    }],
  },

  "unconventional-tool": {
    abilities: [{
      type: "triggered",
      storyName: "INVENTOR'S EDGE",
      rulesText: "When this item is banished, you pay 2 {I} less for the next item you play this turn.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "grant_cost_reduction", amount: 2,
        filter: { cardType: ["item"] },
      }],
    }],
  },

  "baymaxs-charging-station": {
    abilities: [{
      type: "triggered",
      storyName: "RECHARGING",
      rulesText: "Whenever you play a Floodborn character, if you used Shift to play them, you may draw a card.",
      trigger: { on: "card_played", filter: { owner: SELF, cardType: ["character"], hasTrait: "Floodborn" } },
      condition: { type: "triggering_card_played_via_shift" },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  // ── Simple actions ─────────────────────────────────────────────
  "weve-got-company": {
    actionEffects: [{
      type: "ready",
      target: { type: "all", filter: ALL_OWN_CHARS },
      followUpEffects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "restoring-the-crown": {
    actionEffects: [{
      type: "exert",
      target: { type: "all", filter: ALL_OPP_CHARS },
    }],
    // approximation: "Whenever one of your characters banishes another character in a challenge
    // this turn, gain 2 lore." — per-turn conditional trigger on-action not supported; skipping
    // second clause. capability_id: self-played-action-grants-turn-wide-trigger
  },

  // ── Simple quest triggers w/ conditions ────────────────────────
  "roger-radcliffe-dog-lover-QUEST": {}, // placeholder no-op (unused)

  "calhoun-battle-tested": {
    abilities: [{
      type: "triggered",
      storyName: "DOWNGRADE",
      rulesText: "When you play this character, you may choose and discard a card to give chosen opposing character -3 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF }],
        rewardEffects: [{
          type: "gain_stats", strength: -3,
          duration: "until_caster_next_turn",
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      }],
    }],
  },

  "wreck-it-ralph-heros-duty": {
    abilities: [{
      type: "triggered",
      storyName: "WE CAN FIX IT",
      rulesText: "During your turn, whenever one of your other characters is banished, this character gets +1 {L} this turn.",
      trigger: { on: "banished_other_in_challenge", filter: OWN_OTHER_CHARS },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "gain_stats", lore: 1,
        target: { type: "this" },
      }],
    }],
    // approximation: only fires on challenge banishment, not ability banishment.
    // capability_id: own-other-banished-any-source
  },

  // te-ka-elemental-terror: SKIPPED — requires "opposing character is exerted" trigger event
  // that does not exist in the engine. capability_id: opposing-character-exerted-trigger

  "bolt-superdog": {
    abilities: [
      {
        type: "triggered",
        storyName: "SUPERDOG",
        rulesText: "Whenever you ready this character, gain 1 lore for each other undamaged character you have in play.",
        trigger: { on: "readied", filter: { cardType: ["character"] } },
        effects: [{
          type: "gain_lore",
          amount: { type: "count", filter: { ...OWN_OTHER_CHARS, hasDamage: false } },
          target: SELF,
        }],
      },
      {
        type: "triggered",
        storyName: "BANISH ILLUSION",
        rulesText: "Banish chosen Illusion character.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "banish",
          target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Illusion" } },
        }],
      },
    ],
  },

};

// Remove the placeholder key
delete (patches as any)["roger-radcliffe-dog-lover-QUEST"];

// ─── Apply ────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
const seen = new Set<string>();
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
      console.log(`  OK ${card.id}`);
      seen.add(card.id);
    }
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 7.`);
