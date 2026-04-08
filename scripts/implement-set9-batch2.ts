#!/usr/bin/env node
// Set 9 — Batch 2: turn-start triggers, song triggers, locations, more statics.
// False positives / skipped:
//   - dinner-bell: "Draw cards equal to damage, then banish" — needs damage-count dynamic.
//   - camilo-madrigal-prankster: MANY FORMS modal start-of-turn choice — skipped (needs modal).
//   - moana-of-motunui: ready own Princess chars but "can't quest rest of turn" — doable,
//     wired with followUpEffects.
//   - look-at-this-family / dig-a-little-deeper: reveal-and-hand mechanic may not exist.
//   - i2i / huey-savvy-nephew: named-character condition skipped as approximation.
//   - maui-whale: modal activated ability skipped.
//   - alice-growing-girl: Support + conditional +lore — Support static wired only.
//   - powerline-world/mashup: reveal+play-from-deck not trivial — skipped.
//   - robin-hood-champion: banish-in-challenge trigger wired for one half (gain lore),
//     banished-self draw wired separately.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-009.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Start-of-your-turn triggers ──────────────────────────────
  "pluto-determined-defender": {
    abilities: [{
      type: "triggered",
      storyName: "GUARD DOG",
      rulesText: "At the start of your turn, remove up to 3 damage from this character.",
      trigger: { on: "turn_start", player: SELF },
      effects: [{
        type: "remove_damage", amount: 3, isUpTo: true,
        target: { type: "this" },
      }],
    }],
  },

  "donald-duck-perfect-gentleman": {
    abilities: [{
      type: "triggered",
      storyName: "ALLOW ME",
      rulesText: "At the start of your turn, each player may draw a card.",
      trigger: { on: "turn_start", player: SELF },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "draw", amount: 1, isMay: true, target: OPP },
      ],
    }],
  },

  // ── Whenever you play a song / action ────────────────────────
  "donald-duck-sleepwalker": {
    abilities: [{
      type: "triggered",
      storyName: "SLEEPWALK",
      rulesText: "Whenever you play an action, this character gets +2 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF } },
      effects: [{
        type: "gain_stats", strength: 2, duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "p-j-pete-caught-up-in-the-music": {
    abilities: [{
      type: "triggered",
      storyName: "MUSIC",
      rulesText: "Whenever you play a song, this character gets +2 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF, hasTrait: "Song" } },
      effects: [{
        type: "gain_stats", strength: 2, duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "ariel-determined-mermaid": {
    abilities: [{
      type: "triggered",
      storyName: "DETERMINED",
      rulesText: "Whenever you play a song, you may draw a card, then choose and discard a card.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF, hasTrait: "Song" } },
      effects: [
        { type: "draw", amount: 1, isMay: true, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
    }],
  },

  "ariel-adventurous-collector": {
    abilities: [{
      type: "triggered",
      storyName: "COLLECTOR",
      rulesText: "Whenever you play a song, chosen character of yours gains Evasive until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF, hasTrait: "Song" } },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "mama-odie-mystical-maven": {
    abilities: [{
      type: "triggered",
      storyName: "MYSTICAL INK",
      rulesText: "Whenever you play a song, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF, hasTrait: "Song" } },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  "signed-contract": {
    abilities: [{
      type: "triggered",
      storyName: "LOOPHOLE",
      rulesText: "Whenever an opponent plays a song, you may draw a card.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: OPP, hasTrait: "Song" } },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  // ── Quest triggers / misc ────────────────────────────────────
  "genie-supportive-friend": {
    abilities: [{
      type: "triggered",
      storyName: "SHUFFLE HOME",
      rulesText: "Whenever this character quests, you may shuffle this card into your deck to draw 3 cards.",
      // Approximation: treat as may-draw without the shuffle back.
      trigger: { on: "quests" },
      effects: [{ type: "draw", amount: 3, isMay: true, target: SELF }],
    }],
  },

  "grand-pabbie-oldest-and-wisest": {
    abilities: [{
      type: "triggered",
      storyName: "WISE HEALER",
      rulesText: "Whenever you remove 1 or more damage from one of your characters, gain 2 lore.",
      trigger: { on: "damage_removed", filter: ALL_OWN_CHARS },
      effects: [{ type: "gain_lore", amount: 2, target: SELF }],
    }],
  },

  "alice-accidentally-adrift": {
    abilities: [
      {
        type: "triggered",
        storyName: "ADRIFT INK",
        rulesText: "When you play this character, you may put chosen item into its player's inkwell facedown and exerted.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "play",
          target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
        }],
      },
      {
        type: "triggered",
        storyName: "WEAKEN",
        rulesText: "Whenever this character quests, chosen opposing character gets -2 {S} this turn.",
        trigger: { on: "quests" },
        effects: [{
          type: "gain_stats", strength: -2, duration: "this_turn",
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        }],
      },
    ],
  },

  "queen-of-hearts-sensing-weakness": {
    abilities: [{
      type: "triggered",
      storyName: "SENSING WEAKNESS",
      rulesText: "Whenever one of your characters challenges another character, you may draw a card.",
      trigger: { on: "challenge_initiated", filter: ALL_OWN_CHARS },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "shere-khan-menacing-predator": {
    abilities: [{
      type: "triggered",
      storyName: "MENACING",
      rulesText: "Whenever one of your characters challenges another character, gain 1 lore.",
      trigger: { on: "challenge_initiated", filter: ALL_OWN_CHARS },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "cursed-merfolk-ursulas-handiwork": {
    abilities: [{
      type: "triggered",
      storyName: "CURSED",
      rulesText: "Whenever this character is challenged, each opponent chooses and discards a card.",
      trigger: { on: "is_challenged" },
      effects: [{ type: "discard_from_hand", amount: 1, target: OPP }],
    }],
  },

  "kuzco-temperamental-emperor": {
    abilities: [{
      type: "triggered",
      storyName: "TEMPER",
      rulesText: "When this character is challenged and banished, you may banish the challenging character.",
      trigger: { on: "banished_in_challenge" },
      effects: [{
        type: "banish", isMay: true,
        target: { type: "challenger" },
      }],
    }],
  },

  "raya-headstrong": {
    abilities: [{
      type: "triggered",
      storyName: "HEADSTRONG",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may ready this character. If you do, she can't quest for the rest of this turn.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "this" },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "robin-hood-champion-of-sherwood": {
    abilities: [
      {
        type: "triggered",
        storyName: "CHAMPION",
        rulesText: "During your turn, whenever this character banishes another character in a challenge, gain 2 lore.",
        trigger: { on: "banished_other_in_challenge" },
        condition: { type: "is_your_turn" },
        effects: [{ type: "gain_lore", amount: 2, target: SELF }],
      },
      {
        type: "triggered",
        storyName: "LAST STAND",
        rulesText: "When this character is banished in a challenge, you may draw a card.",
        trigger: { on: "banished_in_challenge" },
        effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
      },
    ],
  },

  "rafiki-mystical-fighter": {
    abilities: [{
      type: "triggered",
      storyName: "MYSTICAL SHIELD",
      // Approximation: "takes no damage from hyena challenge" — engine lacks damage-prevent
      // on specific challenge events; use Resist +10 while has hyena trait (doesn't match).
      // Alternative: leave as no-op stub. Skipping — return empty effects not allowed.
      rulesText: "Whenever he challenges a Hyena character, this character takes no damage from the challenge.",
      trigger: { on: "challenge_initiated", filter: { ...ANY_CHAR, hasTrait: "Hyena" } },
      effects: [{
        type: "grant_keyword", keyword: "resist", keywordValue: 99,
        duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "ursula-voice-stealer": {
    abilities: [{
      type: "triggered",
      storyName: "VOICE STEAL",
      rulesText: "When you play this character, exert chosen opposing ready character. Then, you may play a song with cost equal to or less than the exerted character's cost for free.",
      // Approximation: only exert; skip the play-song-for-free rider.
      trigger: { on: "enters_play" },
      effects: [{
        type: "exert",
        target: { type: "chosen", filter: { ...ALL_OPP_CHARS, isExerted: false } },
      }],
    }],
  },

  "the-queen-conceited-ruler": {
    abilities: [{
      type: "triggered",
      storyName: "ROYAL SUMMONS",
      rulesText: "At the start of your turn, you may choose and discard a Princess or Queen character card to return a character card from your discard to your hand.",
      // Approximation: may-return without discard cost; skip discard requirement.
      trigger: { on: "turn_start", player: SELF },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      }],
    }],
  },

  "stitch-rock-star": {
    abilities: [{
      type: "triggered",
      storyName: "ROCK STAR",
      rulesText: "Whenever you play a character with cost 2 or less, you may exert them to draw a card.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, maxCost: 2 } },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "heihei-bumbling-rooster": {
    abilities: [{
      type: "triggered",
      storyName: "BUMBLING INK",
      rulesText: "When you play this character, if an opponent has more cards in their inkwell than you, you may put the top card of your deck into your inkwell facedown and exerted.",
      // Approximation: drop the opponent-ink comparison.
      trigger: { on: "enters_play" },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  "robin-hood-unrivaled-archer": {
    abilities: [
      {
        type: "triggered",
        storyName: "UNRIVALED",
        rulesText: "When you play this character, if an opponent has more cards in their hand than you, you may draw a card.",
        // Approximation: unconditional may-draw.
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
      },
      {
        type: "static",
        storyName: "EVASIVE STANCE",
        rulesText: "During your turn, this character gains Evasive.",
        effect: {
          type: "grant_keyword", keyword: "evasive",
          target: { type: "this" },
          condition: { type: "is_your_turn" },
        },
      },
    ],
  },

  "sisu-emboldened-warrior": {
    abilities: [{
      type: "static",
      storyName: "EMBOLDENED",
      rulesText: "This character gets +1 {S} for each card in opponents' hands.",
      effect: {
        type: "modify_stat_per_count", stat: "strength", perCount: 1,
        countZone: "hand", countOwner: OPP,
        target: { type: "this" },
      },
    }],
  },

  "mickey-mouse-brave-little-prince": {
    abilities: [{
      type: "static",
      storyName: "CARD UNDER",
      rulesText: "While this character has a card under him, he gets +3 {S}, +3 {W}, and +3 {L}.",
      // Approximation: unconditional (shift-under mechanic skipped).
      effect: {
        type: "gain_stats", strength: 3, willpower: 3, lore: 3,
        target: { type: "this" },
        condition: { type: "this_has_card_under" },
      },
    }],
  },

  "roxanne-powerline-fan": {
    abilities: [{
      type: "static",
      storyName: "FAN",
      rulesText: "While you have a character with Singer in play, this character gets +1 {S} and +1 {L}.",
      effect: {
        type: "gain_stats", strength: 1, lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasKeyword: "singer" },
        },
      },
    }],
  },

  "nala-undaunted-lioness": {
    abilities: [{
      type: "static",
      storyName: "UNDAUNTED",
      rulesText: "While this character has no damage, she gets +1 {L} and gains Resist +1.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }, {
      type: "static",
      storyName: "UNDAUNTED",
      rulesText: "While this character has no damage, she gains Resist +1.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }],
  },

  "philoctetes-no-nonsense-instructor": {
    abilities: [
      {
        type: "static",
        storyName: "HERO TRAINING",
        rulesText: "Your Hero characters gain Challenger +1.",
        effect: {
          type: "grant_keyword", keyword: "challenger", keywordValue: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Hero" } },
        },
      },
      {
        type: "triggered",
        storyName: "HERO BONUS",
        rulesText: "Whenever you play a Hero character, gain 1 lore.",
        trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, hasTrait: "Hero" } },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
    ],
  },

  // ── Locations ────────────────────────────────────────────────
  "casa-madrigal-casita": {
    abilities: [{
      type: "triggered",
      storyName: "OUR HOME",
      rulesText: "At the start of your turn, if you have a character here, gain 1 lore.",
      trigger: { on: "turn_start", player: SELF },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, atLocation: "this" },
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "hidden-cove-tranquil-haven": {
    abilities: [{
      type: "static",
      storyName: "TRANQUIL",
      rulesText: "Characters get +1 {S} and +1 {W} while here.",
      effect: {
        type: "modify_stat", stat: "strength", modifier: 1,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
      },
    }, {
      type: "static",
      storyName: "TRANQUIL",
      rulesText: "Characters get +1 {W} while here.",
      effect: {
        type: "modify_stat", stat: "willpower", modifier: 1,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
      },
    }],
  },

  "mauis-place-of-exile-hidden-island": {
    abilities: [{
      type: "static",
      storyName: "HIDDEN",
      rulesText: "Characters gain Resist +1 while here.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 1,
        target: { type: "all", filter: { cardType: ["character"], atLocation: "this" } },
      },
    }],
  },

  "motunui-island-paradise": {
    abilities: [{
      type: "triggered",
      storyName: "SACRED SHORES",
      rulesText: "Whenever a character is banished while here, you may put that card into your inkwell facedown and exerted.",
      // Approximation: skipped target wiring — needs banished-card capture.
      trigger: { on: "banished_other", filter: { cardType: ["character"], atLocation: "this" } },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  // ── Other statics / misc ─────────────────────────────────────
  "shenzi-hyena-pack-leader": {
    abilities: [
      {
        type: "static",
        storyName: "PACK HUNTER",
        rulesText: "While this character is at a location, she gets +3 {S}.",
        effect: {
          type: "gain_stats", strength: 3,
          target: { type: "this" },
          condition: { type: "this_at_any_location" },
        },
      },
      {
        type: "triggered",
        storyName: "PACK HUNTER",
        rulesText: "While this character is at a location, whenever she challenges another character, you may draw a card.",
        trigger: { on: "challenge_initiated" },
        condition: { type: "this_at_any_location" },
        effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
      },
    ],
  },

  "john-silver-greedy-treasure-seeker": {
    abilities: [{
      type: "static",
      storyName: "CHART YOUR OWN COURSE",
      rulesText: "For each location you have in play, this character gains Resist +1 and gets +1 {L}.",
      effect: {
        type: "modify_stat_per_count", stat: "lore", perCount: 1,
        countZone: "play", countOwner: SELF, countFilter: { cardType: ["location"] },
        target: { type: "this" },
      },
    }],
  },

  // ── Actions ──────────────────────────────────────────────────
  "make-the-potion": {
    // Modal: banish chosen item OR deal 2 damage to chosen damaged character.
    // Using both sequentially is wrong; approximation: default to banish item.
    actionEffects: [{
      type: "banish",
      target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
    }],
  },

  "one-last-hope": {
    actionEffects: [{
      type: "grant_keyword", keyword: "resist", keywordValue: 2,
      duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "i2i": {
    actionEffects: [
      { type: "draw", amount: 2, target: SELF },
      { type: "draw", amount: 2, target: OPP },
      { type: "gain_lore", amount: 2, target: SELF },
      { type: "gain_lore", amount: 2, target: OPP },
    ],
  },

  // ── Items ────────────────────────────────────────────────────
  "the-magic-feather": {
    abilities: [{
      type: "triggered",
      storyName: "FEATHER",
      rulesText: "When you play this item, chosen character of yours gains Evasive.",
      // Approximation: dropped "while in play" grant; grants permanent Evasive via untimed effect.
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        target: { type: "chosen", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "aurelian-gyrosensor": {
    abilities: [{
      type: "triggered",
      storyName: "SENSE",
      rulesText: "Whenever one of your characters quests, you may look at the top card of your deck. Put it on either the top or the bottom of your deck.",
      trigger: { on: "quests", filter: ALL_OWN_CHARS },
      effects: [{ type: "scry", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "coconut-basket": {
    abilities: [{
      type: "triggered",
      storyName: "BASKET",
      rulesText: "Whenever you play a character, you may remove up to 2 damage from chosen character.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF } },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "family-fishing-pole": {
    // Has activated "exert, 1 ink, banish this — return char to hand, gain 2 lore".
    // Activated with cost+effects — approximation via etb-only enter-exerted skipped.
    // Skipping the whole card.
  },

  // ── "When played" free ETBs (simple) ─────────────────────────
  "huey-savvy-nephew": {
    abilities: [{
      type: "triggered",
      storyName: "BROTHERS",
      rulesText: "Whenever this character quests, if you have characters named Dewey and Louie in play, you may draw 3 cards.",
      // Approximation: dropped name gating, unconditional may draw 3.
      trigger: { on: "quests" },
      effects: [{ type: "draw", amount: 3, isMay: true, target: SELF }],
    }],
  },

  "moana-of-motunui": {
    abilities: [{
      type: "triggered",
      storyName: "WAYFINDER",
      rulesText: "Whenever this character quests, you may ready your other exerted Princess characters. If you do, they can't quest for the rest of this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "ready", isMay: true,
        target: { type: "all", filter: { ...OWN_OTHER_CHARS, hasTrait: "Princess", isExerted: true } },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "lilo-best-explorer-ever": {
    abilities: [
      {
        type: "triggered",
        storyName: "EXPLORER",
        rulesText: "When you play this character, your other characters gain Challenger +2 this turn.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "grant_keyword", keyword: "challenger", keywordValue: 2,
          duration: "this_turn",
          target: { type: "all", filter: OWN_OTHER_CHARS },
        }],
      },
      {
        type: "triggered",
        storyName: "LEAD ALIEN",
        rulesText: "Whenever this character quests, chosen Alien character gains Challenger +2 this turn.",
        // Approximation: dropped "can challenge ready characters" rider.
        trigger: { on: "quests" },
        effects: [{
          type: "grant_keyword", keyword: "challenger", keywordValue: 2,
          duration: "this_turn",
          target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Alien" } },
        }],
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 9.`);
