#!/usr/bin/env node
// Set 10 — Batch 1: simple ETBs, quest triggers, basic statics, action effects.
// False positives / skipped (revisit later batches):
//   - rapunzel-ready-for-adventure: replacement-effect (DEFERRED)
//   - daisy-duck-paranormal: inkwell-static (DEFERRED)
//   - next-stop-olympus: stat-threshold-condition (DEFERRED)
//   - prince-charming-protector: challenge-limiter (DEFERRED)
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-010.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Simple "When you play this character" ETBs ───────────────
  "gurgi-apple-lover": {
    abilities: [{
      type: "triggered",
      storyName: "HEALING TOUCH",
      rulesText: "When you play this character, you may remove up to 2 damage from chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "elsa-exploring-the-unknown": {
    abilities: [{
      type: "triggered",
      storyName: "DRAW",
      rulesText: "When you play this character, you may draw a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "goofy-ghost-hunter": {
    abilities: [{
      type: "triggered",
      storyName: "BOO!",
      rulesText: "When you play this character, chosen opposing character gets -1 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "webby-vanderquack-mystery-enthusiast": {
    abilities: [{
      type: "triggered",
      storyName: "ENTHUSIASM",
      rulesText: "When you play this character, chosen character gets +1 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "rapunzel-creative-captor": {
    abilities: [{
      type: "triggered",
      storyName: "SUBDUE",
      rulesText: "When you play this character, chosen opposing character gets -3 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -3, duration: "this_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "tinker-bell-temperamental-fairy": {
    abilities: [{
      type: "triggered",
      storyName: "TEMPER",
      rulesText: "When you play this character, exert chosen opposing character with 2 {S} or less.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "chosen", filter: { ...ALL_OPP_CHARS, maxStrength: 2 } },
      }],
    }],
  },

  "the-headless-horseman-terror-of-sleepy-hollow": {
    abilities: [
      {
        type: "triggered",
        storyName: "STRIKE FEAR",
        rulesText: "When you play this character, banish chosen opposing character with 2 {S} or less.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "banish",
          target: { type: "chosen", filter: { ...ALL_OPP_CHARS, maxStrength: 2 } },
        }],
      },
      {
        type: "triggered",
        storyName: "RIDE OF TERROR",
        rulesText: "During your turn, whenever an opposing character is banished, each of your characters gets +1 {S} this turn.",
        trigger: { on: "banished_other", filter: ALL_OPP_CHARS },
        condition: { type: "is_your_turn" },
        effects: [{
          type: "gain_stats", strength: 1, duration: "this_turn",
          target: { type: "all", filter: ALL_OWN_CHARS },
        }],
      },
    ],
  },

  "jetsam-opportunistic-eel": {
    abilities: [{
      type: "triggered",
      storyName: "OPPORTUNITY STRIKES",
      rulesText: "When you play this character, deal 3 damage to chosen opposing damaged character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 3,
        target: { type: "chosen", filter: { ...ALL_OPP_CHARS, hasDamage: true } },
      }],
    }],
  },

  "launchpad-exceptional-pilot": {
    abilities: [{
      type: "triggered",
      storyName: "DEMOLITION",
      rulesText: "When you play this character, you may banish chosen location.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["location"] } },
      }],
    }],
  },

  "scrooge-mcduck-s-h-u-s-h-agent": {
    abilities: [
      {
        type: "triggered",
        storyName: "SECRET FILES",
        rulesText: "When you play this character, draw a card, then choose and discard a card.",
        trigger: { on: "enters_play" },
        effects: [
          { type: "draw", amount: 1, target: SELF },
          { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
        ],
      },
      {
        type: "triggered",
        storyName: "VANISH",
        rulesText: "When this character is challenged, return this card to your hand.",
        trigger: { on: "is_challenged" },
        effects: [{
          type: "return_to_hand",
          target: { type: "this" },
        }],
      },
    ],
  },

  "hudson-determined-reader": {
    abilities: [{
      type: "triggered",
      storyName: "STUDY UP",
      rulesText: "When you play this character, you may draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
      ],
    }],
  },

  "magica-de-spell-shadowy-and-sinister": {
    abilities: [{
      type: "triggered",
      storyName: "SHUFFLE BACK",
      rulesText: "When you play this character, you may shuffle a card from chosen player's discard into their deck.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "shuffle_into_deck", isMay: true,
        target: { type: "chosen", filter: { zone: "discard" } },
      }],
    }],
  },

  "mickey-mouse-detective": {
    abilities: [{
      type: "triggered",
      storyName: "INK INVESTIGATION",
      rulesText: "When you play this character, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  "fergus-mcduck-scrooges-father": {
    abilities: [{
      type: "triggered",
      storyName: "FATHERLY WARD",
      rulesText: "When you play this character, chosen character of yours gains Ward until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "ward",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "donald-duck-ghost-hunter": {
    abilities: [{
      type: "triggered",
      storyName: "GHOSTBUSTING",
      rulesText: "When you play this character, chosen Detective character gains Challenger +2 this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "challenger", value: 2,
        duration: "end_of_turn",
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Detective" } },
      }],
    }],
  },

  "david-xanatos-steel-clan-leader": {
    abilities: [{
      type: "triggered",
      storyName: "STEEL STRIKE",
      rulesText: "When you play this character, you may choose and discard a card to deal 2 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        isMay: true,
        costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" }],
        rewardEffects: [{
          type: "deal_damage", amount: 2,
          target: { type: "chosen", filter: ANY_CHAR },
        }],
      }],
    }],
  },

  // ── Quest triggers ────────────────────────────────────────────
  "vladimir-ceramic-unicorn-fan": {
    abilities: [{
      type: "triggered",
      storyName: "SMASH IT",
      rulesText: "Whenever this character quests, you may banish chosen item.",
      trigger: { on: "quests" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "shere-khan-fearsome-tiger": {
    abilities: [{
      type: "triggered",
      storyName: "FEARSOME",
      rulesText: "Whenever this character quests, banish chosen opposing damaged character. Then, you may put 1 damage counter on another chosen character.",
      trigger: { on: "quests" },
      effects: [
        {
          type: "banish",
          target: { type: "chosen", filter: { ...ALL_OPP_CHARS, hasDamage: true } },
        },
        {
          type: "deal_damage", amount: 1, asDamageCounter: true, isMay: true,
          target: { type: "chosen", filter: ANY_CHAR },
        },
      ],
    }],
  },

  "hen-wen-prophetic-pig": {
    abilities: [{
      type: "triggered",
      storyName: "PROPHECY",
      rulesText: "Whenever this character quests, look at the top card of your deck. Put it on either the top or the bottom of your deck.",
      trigger: { on: "quests" },
      effects: [{
        type: "look_at_top", count: 1, action: "top_or_bottom", target: SELF,
      }],
    }],
  },

  "taran-pig-keeper": {
    abilities: [{
      type: "triggered",
      storyName: "RETRIEVE HEN WEN",
      rulesText: "Whenever this character quests, you may return a character card named Hen Wen from your discard to your hand.",
      trigger: { on: "quests" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], name: "Hen Wen" } },
      }],
    }],
  },

  "gwythaint-savage-hunter": {
    abilities: [{
      type: "triggered",
      storyName: "INTIMIDATE",
      rulesText: "Whenever this character quests, each opponent chooses and exerts one of their ready characters.",
      // Approximation: engine exerts one of opponent's ready characters (controller picks).
      trigger: { on: "quests" },
      effects: [{
        type: "exert",
        target: { type: "chosen", filter: { ...ALL_OPP_CHARS, isExerted: false } },
      }],
    }],
  },

  "robin-hood-ephemeral-archer": {
    abilities: [{
      type: "triggered",
      storyName: "ARROW SHOWER",
      rulesText: "Whenever this character quests, if there's a card under him, deal 1 damage to up to 2 chosen characters.",
      trigger: { on: "quests" },
      condition: { type: "this_has_cards_under" },
      effects: [
        { type: "deal_damage", amount: 1, target: { type: "chosen", filter: ANY_CHAR } },
        { type: "deal_damage", amount: 1, target: { type: "chosen", filter: ANY_CHAR } },
      ],
    }],
  },

  "kristoff-mining-the-ruins": {
    abilities: [{
      type: "triggered",
      storyName: "DIG DEEP",
      rulesText: "Whenever this character quests, if there's a card under him, put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "quests" },
      condition: { type: "this_has_cards_under" },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        target: SELF,
      }],
    }],
  },

  "jasmine-soothing-princess": {
    abilities: [{
      type: "triggered",
      storyName: "HEALING TOUCH",
      rulesText: "Whenever this character quests, if there's a card under her, remove up to 3 damage from each of your characters.",
      trigger: { on: "quests" },
      condition: { type: "this_has_cards_under" },
      effects: [{
        type: "remove_damage", amount: 3, isUpTo: true,
        target: { type: "all", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "ichabod-crane-bookish-schoolmaster": {
    abilities: [{
      type: "triggered",
      storyName: "BOOK SMARTS",
      rulesText: "Whenever this character quests, if you've played a character with cost 5 or more this turn, put the top card of your deck into your inkwell facedown and exerted.",
      // Approximation: drop the cost-5+ played condition.
      trigger: { on: "quests" },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        target: SELF,
      }],
    }],
  },

  "webby-vanderquack-junior-prospector": {
    abilities: [{
      type: "triggered",
      storyName: "PROSPECT",
      rulesText: "Whenever this character quests, if an opponent has more cards in their inkwell than you, you may put the top card of your deck into your inkwell facedown and exerted.",
      // Approximation: drop the opponent-ink condition.
      trigger: { on: "quests" },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  "flash-records-specialist": {
    abilities: [
      {
        type: "static",
        storyName: "ENTERS EXERTED",
        rulesText: "This character enters play exerted.",
        // Note: ETB-exerted on self isn't a static; rely on enter_play_exerted via trigger.
        effect: {
          type: "modify_stat", stat: "strength", modifier: 0,
          target: { type: "this" },
        },
      },
      {
        type: "triggered",
        storyName: "RECORDS",
        rulesText: "Whenever this character quests, you may give chosen Detective character +2 {S} this turn.",
        trigger: { on: "quests" },
        effects: [{
          type: "gain_stats", strength: 2, duration: "this_turn", isMay: true,
          target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Detective" } },
        }],
      },
    ],
  },

  // ── Banished-self triggers ────────────────────────────────────
  "nibs-lost-boy": {
    abilities: [{
      type: "triggered",
      storyName: "RETURN",
      rulesText: "When this character is banished in a challenge, return this card to your hand.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "return_to_hand", target: { type: "this" } }],
    }],
  },

  "merlin-completing-his-research": {
    abilities: [{
      type: "triggered",
      storyName: "FINAL DISCOVERY",
      rulesText: "When this character is banished in a challenge, if he had a card under him, draw 2 cards.",
      trigger: { on: "banished_in_challenge" },
      condition: { type: "this_has_cards_under" },
      effects: [{ type: "draw", amount: 2, target: SELF }],
    }],
  },

  "ichabod-crane-scared-out-of-his-mind": {
    abilities: [{
      type: "triggered",
      storyName: "BURY THE EVIDENCE",
      rulesText: "When this character is banished, you may put this card into your inkwell facedown and exerted.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "discard",
        target: { type: "this" },
      }],
    }],
  },

  "olaf-helping-hand": {
    abilities: [{
      type: "triggered",
      storyName: "FAREWELL HELP",
      rulesText: "When this character leaves play, you may return chosen character of yours to your hand.",
      trigger: { on: "leaves_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "bellwether-master-manipulator": {
    abilities: [{
      type: "triggered",
      storyName: "RETALIATION",
      rulesText: "When this character is challenged and banished, put 1 damage counter on each opposing character.",
      trigger: { on: "banished_in_challenge" },
      effects: [{
        type: "deal_damage", amount: 1, asDamageCounter: true,
        target: { type: "all", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  // ── Static buffs ──────────────────────────────────────────────
  "mickey-mouse-amber-champion": {
    abilities: [{
      type: "static",
      storyName: "AMBER CHAMPION",
      rulesText: "Your other Amber characters get +2 {W}.",
      effect: {
        type: "modify_stat", stat: "willpower", modifier: 2,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, inkColor: "amber" } },
      },
    }],
  },

  "donald-duck-ruby-champion": {
    abilities: [
      {
        type: "static",
        storyName: "RUBY CHAMPION",
        rulesText: "Your other Ruby characters get +1 {S}.",
        effect: {
          type: "modify_stat", stat: "strength", modifier: 1,
          target: { type: "all", filter: { ...OWN_OTHER_CHARS, inkColor: "ruby" } },
        },
      },
    ],
  },

  "daisy-duck-sapphire-champion": {
    abilities: [
      {
        type: "static",
        storyName: "SAPPHIRE CHAMPION",
        rulesText: "Your other Sapphire characters gain Resist +1.",
        effect: {
          type: "grant_keyword", keyword: "resist", keywordValue: 1,
          target: { type: "all", filter: { ...OWN_OTHER_CHARS, inkColor: "sapphire" } },
        },
      },
      {
        type: "triggered",
        storyName: "SAPPHIRE INSIGHT",
        rulesText: "Whenever one of your other Sapphire characters quests, you may look at the top card of your deck. Put it on either the top or the bottom of your deck.",
        trigger: { on: "quests", filter: { ...OWN_OTHER_CHARS, inkColor: "sapphire" } },
        effects: [{ type: "look_at_top", count: 1, action: "top_or_bottom", isMay: true, target: SELF }],
      },
    ],
  },

  "judy-hopps-lead-detective": {
    abilities: [
      {
        type: "static",
        storyName: "DETECTIVE ALERT",
        rulesText: "During your turn, your Detective characters gain Alert.",
        effect: {
          type: "grant_keyword", keyword: "alert",
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Detective" } },
          condition: { type: "is_your_turn" },
        },
      },
      {
        type: "static",
        storyName: "DETECTIVE RESIST",
        rulesText: "During your turn, your Detective characters gain Resist +2.",
        effect: {
          type: "grant_keyword", keyword: "resist", keywordValue: 2,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Detective" } },
          condition: { type: "is_your_turn" },
        },
      },
    ],
  },

  "elisa-maza-intrepid-investigator": {
    abilities: [{
      type: "static",
      storyName: "INTREPID",
      rulesText: "While you have 2 or more other characters in play with 5 {S} or more, this character gets +2 {L}.",
      effect: {
        type: "gain_stats", lore: 2,
        target: { type: "this" },
        condition: {
          type: "characters_in_play_gte", amount: 2, player: SELF, excludeSelf: true,
        },
      },
    }],
  },

  "the-horned-king-triumphant-ghoul": {
    abilities: [{
      type: "static",
      storyName: "TRIUMPHANT",
      rulesText: "During your turn, if 1 or more cards have left a player's discard this turn, this character gets +2 {L}.",
      // Approximation: unconditional during your turn (no event tracking for "left discard").
      effect: {
        type: "gain_stats", lore: 2,
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  "demona-betrayer-of-the-clan": {
    abilities: [{
      type: "static",
      storyName: "STONE BY DAY",
      rulesText: "If you have 3 or more cards in your hand, this character can't ready.",
      effect: {
        type: "cant_action_self", action: "ready",
        condition: { type: "cards_in_hand_gte", amount: 3, player: SELF },
      },
    }],
  },

  "bronx-ferocious-beast": {
    abilities: [{
      type: "static",
      storyName: "STONE BY DAY",
      rulesText: "If you have 3 or more cards in your hand, this character can't ready.",
      effect: {
        type: "cant_action_self", action: "ready",
        condition: { type: "cards_in_hand_gte", amount: 3, player: SELF },
      },
    }],
  },

  "brooklyn-second-in-command": {
    abilities: [{
      type: "static",
      storyName: "STONE BY DAY",
      rulesText: "If you have 3 or more cards in your hand, this character can't ready.",
      effect: {
        type: "cant_action_self", action: "ready",
        condition: { type: "cards_in_hand_gte", amount: 3, player: SELF },
      },
    }],
  },

  "broadway-sturdy-and-strong": {
    abilities: [{
      type: "static",
      storyName: "STONE BY DAY",
      rulesText: "If you have 3 or more cards in your hand, this character can't ready.",
      effect: {
        type: "cant_action_self", action: "ready",
        condition: { type: "cards_in_hand_gte", amount: 3, player: SELF },
      },
    }],
  },

  "lexington-small-in-stature": {
    abilities: [{
      type: "static",
      storyName: "STONE BY DAY",
      rulesText: "If you have 3 or more cards in your hand, this character can't ready.",
      effect: {
        type: "cant_action_self", action: "ready",
        condition: { type: "cards_in_hand_gte", amount: 3, player: SELF },
      },
    }],
  },

  // ── Action effects ────────────────────────────────────────────
  "begone": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", filter: { zone: "play", maxCost: 3, cardType: ["character", "item", "location"] } },
    }],
  },

  "swooping-strike": {
    actionEffects: [{
      type: "exert",
      target: { type: "chosen", filter: { ...ALL_OPP_CHARS, isExerted: false } },
    }],
  },

  "performance-review": {
    // Approximation: exert chosen ready own character to draw 1 (skip per-lore scaling).
    actionEffects: [{
      type: "sequential",
      costEffects: [{
        type: "exert",
        target: { type: "chosen", filter: { ...ALL_OWN_CHARS, isExerted: false } },
      }],
      rewardEffects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "the-horseman-strikes": {
    actionEffects: [
      { type: "draw", amount: 1, target: SELF },
      {
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { ...ANY_CHAR, hasKeyword: "evasive" } },
      },
    ],
  },

  "chomp": {
    actionEffects: [{
      type: "deal_damage", amount: 2,
      target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
    }],
  },

  "malicious-mean-and-scary": {
    actionEffects: [{
      type: "deal_damage", amount: 1, asDamageCounter: true,
      target: { type: "all", filter: ALL_OPP_CHARS },
    }],
  },

  "ghostly-tale": {
    actionEffects: [{
      type: "exert",
      target: { type: "all", filter: { ...ALL_OPP_CHARS, maxStrength: 2 } },
    }],
  },

  "dragon-fire": {
    actionEffects: [{
      type: "banish",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "so-be-it": {
    actionEffects: [
      {
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "all", filter: ALL_OWN_CHARS },
      },
      {
        type: "banish", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      },
    ],
  },

  "fragile-as-a-flower": {
    actionEffects: [
      { type: "draw", amount: 1, target: SELF },
      {
        type: "exert",
        target: { type: "chosen", filter: { ...ANY_CHAR, maxCost: 2 } },
        followUpEffects: [{
          type: "cant_action", action: "ready",
          duration: "end_of_owner_next_turn",
          target: { type: "this" },
        }],
      },
    ],
  },

  "dellas-moon-lullaby": {
    actionEffects: [
      {
        type: "gain_stats", strength: -2, duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "or-rewrite-history": {
    actionEffects: [{
      type: "return_to_hand",
      target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
    }],
  },

  "hen-wens-visions": {
    actionEffects: [{
      type: "look_at_top", count: 4, action: "one_to_hand_rest_bottom", target: SELF,
    }],
  },

  // ── Items ─────────────────────────────────────────────────────
  "munchings-and-crunchings": {
    actionEffects: [{
      type: "remove_damage", amount: 2, isUpTo: true,
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "inscrutable-map": {
    abilities: [{
      type: "triggered",
      storyName: "OBSCURE",
      rulesText: "Chosen opposing character gets -1 {L} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", lore: -1, duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "mushus-rocket": {
    abilities: [{
      type: "triggered",
      storyName: "BLAST OFF",
      rulesText: "When you play this item, chosen character gains Rush this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "rush",
        duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  // ── Locations ─────────────────────────────────────────────────
  "white-agony-plains-golden-lagoon": {
    abilities: [{
      type: "static",
      storyName: "GOLDEN GLOW",
      rulesText: "This location gets +1 {L} for each character here.",
      effect: {
        type: "modify_stat_per_count", stat: "lore", perCount: 1,
        countZone: "play", countOwner: { type: "both" as const },
        countFilter: { cardType: ["character"], atLocation: "this" },
        target: { type: "this" },
      },
    }],
  },

  "castle-wyvern-above-the-clouds": {
    abilities: [
      {
        type: "static",
        storyName: "AERIE CHALLENGER",
        rulesText: "Characters gain Challenger +1 while here.",
        effect: {
          type: "grant_keyword", keyword: "challenger", keywordValue: 1,
          target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
        },
      },
      {
        type: "static",
        storyName: "AERIE RESIST",
        rulesText: "Characters gain Resist +1 while here.",
        effect: {
          type: "grant_keyword", keyword: "resist", keywordValue: 1,
          target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
        },
      },
    ],
  },
};

// Drop entries with no content (placeholder skip markers)
for (const k of Object.keys(patches)) {
  const p = patches[k];
  if (!p.abilities && !p.actionEffects) delete patches[k];
}

// ─── Apply ────────────────────────────────────────────────────
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
      console.log(`  OK ${card.id}`);
      seen.add(card.id);
    }
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 10.`);
if (missing.length) {
  console.log(`\nMISSING IDs (typos?):`);
  missing.forEach(m => console.log(`  - ${m}`));
}
