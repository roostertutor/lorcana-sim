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
// SET 2 — Batch 3
// =============================================================================
patchSet("2", {

  // --- QUEST TRIGGERS with cost_reduction ---

  // Doc: "Whenever quests, you pay 1 {I} less for the next character you play this turn."
  "doc-leader-of-the-seven-dwarfs": {
    abilities: [{
      type: "triggered", storyName: "LEADER OF THE GROUP",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next character you play this turn.",
      trigger: { on: "quests" },
      effects: [{ type: "cost_reduction", amount: 1, filter: { cardType: ["character"] } }],
    }],
  },

  // Mickey Mouse - Friendly Face: "Whenever quests, you pay 3 {I} less for next character."
  "mickey-mouse-friendly-face": {
    abilities: [{
      type: "triggered", storyName: "HERE TO HELP",
      rulesText: "Whenever this character quests, you pay 3 {I} less for the next character you play this turn.",
      trigger: { on: "quests" },
      effects: [{ type: "cost_reduction", amount: 3, filter: { cardType: ["character"] } }],
    }],
  },

  // --- QUEST TRIGGERS with stat changes ---

  // The Queen - Commanding Presence: "quests → chosen opposing -4 {S} and chosen +4 {S}"
  "the-queen-commanding-presence": {
    abilities: [{
      type: "triggered", storyName: "MIRROR, MIRROR",
      rulesText: "Whenever this character quests, chosen opposing character gets -4 {S} this turn and chosen character gets +4 {S} this turn.",
      trigger: { on: "quests" },
      effects: [
        { type: "gain_stats", strength: -4, target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, duration: "this_turn" },
        { type: "gain_stats", strength: 4, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" },
      ],
    }],
  },

  // Li Shang: "Whenever quests, your characters gain Evasive this turn."
  "li-shang-archery-instructor": {
    abilities: [{
      type: "triggered", storyName: "LEAD BY EXAMPLE",
      rulesText: "Whenever this character quests, your characters gain Evasive this turn.",
      trigger: { on: "quests" },
      effects: [{ type: "grant_keyword", keyword: "evasive", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } }, duration: "end_of_turn" }],
    }],
  },

  // --- ENTERS_PLAY TRIGGERS ---

  // Merlin - Goat: "When you play and when he leaves play, gain 1 lore."
  "merlin-goat": {
    abilities: [
      { type: "triggered", storyName: "MOUNTAIN SURE-FOOTEDNESS",
        rulesText: "When you play this character and when he leaves play, gain 1 lore.",
        trigger: { on: "enters_play" },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }] },
      { type: "triggered", trigger: { on: "leaves_play" },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }] },
    ],
  },

  // Merlin - Rabbit: "When you play and when he leaves play, you may draw a card."
  "merlin-rabbit": {
    abilities: [
      { type: "triggered", storyName: "QUICK REFLEXES",
        rulesText: "When you play this character and when he leaves play, you may draw a card.",
        trigger: { on: "enters_play" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }] },
      { type: "triggered", trigger: { on: "leaves_play" },
        effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }] },
    ],
  },

  // Merlin - Crab: "When you play and when he leaves play, chosen character gains Challenger +3 this turn."
  "merlin-crab": {
    abilities: [
      { type: "triggered", storyName: "PINCH POWER",
        rulesText: "When you play this character and when he leaves play, chosen character gains Challenger +3 this turn.",
        trigger: { on: "enters_play" },
        effects: [{ type: "grant_keyword", keyword: "challenger", value: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" }] },
      { type: "triggered", trigger: { on: "leaves_play" },
        effects: [{ type: "grant_keyword", keyword: "challenger", value: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "end_of_turn" }] },
    ],
  },

  // Merlin - Squirrel: "When you play and when he leaves play, look at top card, top or bottom."
  "merlin-squirrel": {
    abilities: [
      { type: "triggered", storyName: "NUTTY INSTINCTS",
        rulesText: "When you play this character and when he leaves play, look at the top card of your deck. Put it on either the top or the bottom of your deck.",
        trigger: { on: "enters_play" },
        effects: [{ type: "look_at_top", count: 1, action: "top_or_bottom", target: { type: "self" } }] },
      { type: "triggered", trigger: { on: "leaves_play" },
        effects: [{ type: "look_at_top", count: 1, action: "top_or_bottom", target: { type: "self" } }] },
    ],
  },

  // Jiminy Cricket: "When you play, if you have Pinocchio in play, you may draw a card."
  "jiminy-cricket-pinocchios-conscience": {
    abilities: [{
      type: "triggered", storyName: "ALWAYS LET YOUR CONSCIENCE BE YOUR GUIDE",
      rulesText: "When you play this character, if you have a character named Pinocchio in play, you may draw a card.",
      trigger: { on: "enters_play" },
      condition: { type: "has_character_named", name: "Pinocchio", player: { type: "self" } },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // Queen of Hearts - Quick-Tempered: "When you play, deal 1 damage to chosen damaged opposing character."
  "queen-of-hearts-quick-tempered": {
    abilities: [{
      type: "triggered", storyName: "OFF WITH THEIR HEADS!",
      rulesText: "When you play this character, deal 1 damage to chosen damaged opposing character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"], hasDamage: true } } }],
    }],
  },

  // Mother Gothel - Withered and Wicked: "This character enters play with 3 damage."
  "mother-gothel-withered-and-wicked": {
    abilities: [{
      type: "triggered", storyName: "VANITY",
      rulesText: "This character enters play with 3 damage.",
      trigger: { on: "enters_play" },
      effects: [{ type: "deal_damage", amount: 3, target: { type: "this" } }],
    }],
  },

  // Yzma: "When you play, shuffle another chosen character into their player's deck. That player draws 2."
  "yzma-scary-beyond-all-reason": {
    abilities: [{
      type: "triggered", storyName: "PULL THE LEVER, KRONK!",
      rulesText: "When you play this character, shuffle another chosen character card into their player's deck. That player draws 2 cards.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "shuffle_into_deck", target: { type: "chosen", filter: { zone: "play", cardType: ["character"], excludeSelf: true } } },
        { type: "draw", amount: 2, target: { type: "opponent" } }, // Approximation: assumes opponent's character
      ],
    }],
  },

  // Sneezy: "Whenever you play this character or another Seven Dwarfs, you may give chosen character -1 {S} this turn."
  "sneezy-very-allergic": {
    abilities: [{
      type: "triggered", storyName: "ACHOO!",
      rulesText: "Whenever you play this character or another Seven Dwarfs character, you may give chosen character -1 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Seven Dwarfs" } },
      effects: [{ type: "gain_stats", strength: -1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn", isMay: true }],
    }],
  },

  // --- CARD_PLAYED TRIGGERS ---

  // Nana: "Whenever you play a Floodborn character, you may remove all damage from chosen character."
  "nana-darling-family-pet": {
    abilities: [{
      type: "triggered", storyName: "LOYAL GUARDIAN",
      rulesText: "Whenever you play a Floodborn character, you may remove all damage from chosen character.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Floodborn" } },
      effects: [{ type: "remove_damage", amount: 99, target: { type: "chosen", filter: { zone: "play", hasDamage: true } }, isUpTo: true, isMay: true }],
    }],
  },

  // Fairy Godmother - Pure Heart: "Whenever you play a character named Cinderella, you may exert chosen character."
  "fairy-godmother-pure-heart": {
    abilities: [{
      type: "triggered", storyName: "GENTLE MAGIC",
      rulesText: "Whenever you play a character named Cinderella, you may exert chosen character.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasName: "Cinderella" } },
      effects: [{ type: "exert", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // Honest John: "Whenever you play a Floodborn character, each opponent loses 1 lore."
  "honest-john-not-that-honest": {
    abilities: [{
      type: "triggered", storyName: "HI-DIDDLE-DEE-DEE",
      rulesText: "Whenever you play a Floodborn character, each opponent loses 1 lore.",
      trigger: { on: "card_played", filter: { cardType: ["character"], hasTrait: "Floodborn" } },
      effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // Donald Duck - Sleepwalker / Tigger: "Whenever you play an action, this character gets +2 {S} this turn."
  "donald-duck-sleepwalker": {
    abilities: [{
      type: "triggered", storyName: "SNOOZE CRUISE",
      rulesText: "Whenever you play an action, this character gets +2 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"] } },
      effects: [{ type: "gain_stats", strength: 2, target: { type: "this" }, duration: "this_turn" }],
    }],
  },

  "tigger-one-of-a-kind": {
    abilities: [{
      type: "triggered", storyName: "BOUNCING",
      rulesText: "Whenever you play an action, this character gets +2 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"] } },
      effects: [{ type: "gain_stats", strength: 2, target: { type: "this" }, duration: "this_turn" }],
    }],
  },

  // --- IS_CHALLENGED / CHALLENGES TRIGGERS ---

  // Belle - Hidden Archer: "Whenever this character is challenged, the challenging player discards all cards."
  "belle-hidden-archer": {
    abilities: [{
      type: "triggered", storyName: "HIDDEN TALENT",
      rulesText: "Whenever this character is challenged, the challenging character's player discards all cards in their hand.",
      trigger: { on: "is_challenged" },
      effects: [{ type: "discard_from_hand", amount: "all", target: { type: "opponent" }, chooser: "target_player" }],
    }],
  },

  // Shere Khan - Menacing Predator: "Whenever one of your characters challenges another, gain 1 lore."
  "shere-khan-menacing-predator": {
    abilities: [{
      type: "triggered", storyName: "RUTHLESS HUNTER",
      rulesText: "Whenever one of your characters challenges another character, gain 1 lore.",
      trigger: { on: "challenges", filter: { owner: { type: "self" } } },
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // Queen of Hearts - Sensing Weakness: "Whenever one of your characters challenges, you may draw a card."
  "queen-of-hearts-sensing-weakness": {
    abilities: [{
      type: "triggered", storyName: "SHARP INSTINCTS",
      rulesText: "Whenever one of your characters challenges another character, you may draw a card.",
      trigger: { on: "challenges", filter: { owner: { type: "self" } } },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // --- BANISHED_OTHER_IN_CHALLENGE ---

  // Scar - Vicious Cheater: "During your turn, whenever this character banishes another in challenge, ready + can't quest."
  "scar-vicious-cheater": {
    abilities: [{
      type: "triggered", storyName: "LONG LIVE THE KING",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may ready this character. He can't quest for the rest of this turn.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [
        { type: "ready", target: { type: "this" }, isMay: true, followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] },
      ],
    }],
  },

  // Raya - Headstrong: Same pattern as Scar
  "raya-headstrong": {
    abilities: [{
      type: "triggered", storyName: "FIERCE WARRIOR",
      rulesText: "During your turn, whenever this character banishes another character in a challenge, you may ready this character. She can't quest for the rest of this turn.",
      trigger: { on: "banished_other_in_challenge" },
      condition: { type: "is_your_turn" },
      effects: [
        { type: "ready", target: { type: "this" }, isMay: true, followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] },
      ],
    }],
  },

  // --- IS_BANISHED TRIGGERS ---

  // King Louie - Jungle VIP: "Whenever another character is banished, you may remove up to 2 damage from this character."
  "king-louie-jungle-vip": {
    abilities: [{
      type: "triggered", storyName: "I WANNA BE LIKE YOU",
      rulesText: "Whenever another character is banished, you may remove up to 2 damage from this character.",
      trigger: { on: "is_banished", filter: { cardType: ["character"], excludeSelf: true } },
      effects: [{ type: "remove_damage", amount: 2, target: { type: "this" }, isUpTo: true, isMay: true }],
    }],
  },

  // Queen of Hearts - Capricious Monarch: "Whenever an opposing character is banished, you may ready this character."
  "queen-of-hearts-capricious-monarch": {
    abilities: [{
      type: "triggered", storyName: "OFF WITH THEIR HEADS!",
      rulesText: "Whenever an opposing character is banished, you may ready this character.",
      trigger: { on: "is_banished", filter: { owner: { type: "opponent" }, cardType: ["character"] } },
      effects: [{ type: "ready", target: { type: "this" }, isMay: true }],
    }],
  },

  // --- ACTIONS ---

  // Hypnotize: "Each opponent chooses and discards a card. Draw a card."
  "hypnotize": {
    actionEffects: [
      { type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "target_player" },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // Improvise: "Chosen character gets +1 {S} this turn. Draw a card."
  "improvise": {
    actionEffects: [
      { type: "gain_stats", strength: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // Ring the Bell: "Banish chosen damaged character."
  "ring-the-bell": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasDamage: true } } },
    ],
  },

  // Cheshire Cat - From the Shadows: enters_play → banish chosen damaged character
  "cheshire-cat-from-the-shadows": {
    abilities: [{
      type: "triggered", storyName: "NOT ALL THERE",
      rulesText: "Banish chosen damaged character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasDamage: true } } }],
    }],
  },

  // I'm Stuck!: "Chosen exerted character can't ready at the start of their next turn."
  "im-stuck": {
    actionEffects: [
      { type: "cant_action", action: "ready", target: { type: "chosen", filter: { zone: "play", isExerted: true } }, duration: "end_of_owner_next_turn" },
    ],
  },

  // Four Dozen Eggs: Song — "Your characters gain Resist +2 until start of your next turn."
  "four-dozen-eggs": {
    actionEffects: [
      { type: "grant_keyword", keyword: "resist", value: 2, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" },
    ],
  },

  // Go the Distance: Song — "Ready chosen damaged character of yours. Can't quest rest of turn. Draw a card."
  "go-the-distance": {
    actionEffects: [
      { type: "ready", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasDamage: true } }, followUpEffects: [{ type: "cant_action", action: "quest", target: { type: "this" }, duration: "rest_of_turn" }] },
      { type: "draw", amount: 1, target: { type: "self" } },
    ],
  },

  // Pack Tactics: "Gain 1 lore for each damaged character opponents have in play."
  // Approximation: uses lose_lore with lastEffectResult pattern — actually just gain_lore.
  // This needs a count-based gain_lore which we don't have. Skip for now.

  // --- ACTIVATED ABILITIES ---

  // Namaari - Nemesis: "{E}, Banish this character — Banish chosen character."
  "namaari-nemesis": {
    abilities: [{
      type: "activated", storyName: "SACRIFICE PLAY",
      rulesText: "Banish chosen character.",
      costs: [{ type: "exert" }, { type: "banish_self" }],
      effects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } }],
    }],
  },

  // Ratigan's Marvelous Trap: "Banish this item — Each opponent loses 2 lore."
  "ratigans-marvelous-trap": {
    abilities: [{
      type: "activated", storyName: "SNAP! BOOM! TWANG!",
      rulesText: "Each opponent loses 2 lore.",
      costs: [{ type: "banish_self" }],
      effects: [{ type: "lose_lore", amount: 2, target: { type: "opponent" } }],
    }],
  },

  // --- STATICS ---

  // Enchantress - Unexpected Judge: "While being challenged, this character gets +2 {S}."
  // Modeled as modify_stat on this — always active. TODO: "while being challenged" condition.
  "enchantress-unexpected-judge": {
    abilities: [{
      type: "static", storyName: "TEST OF CHARACTER",
      rulesText: "While being challenged, this character gets +2 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      // TODO: needs "while_being_challenged" condition — always applies for now
    }],
  },

  // Lady Tremaine - Overbearing Matriarch: "When you play, each opponent with more lore than you loses 1 lore."
  "lady-tremaine-overbearing-matriarch": {
    abilities: [{
      type: "triggered", storyName: "WICKED STEPMOTHER",
      rulesText: "When you play this character, each opponent with more lore than you loses 1 lore.",
      trigger: { on: "enters_play" },
      // Approximation: opponent loses 1 lore (condition "opponent_has_more_lore" not available as effect guard)
      effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // Panic - Underworld Imp: "When you play, chosen character gets +2 {S} this turn. If named Pain, +4 instead."
  "panic-underworld-imp": {
    abilities: [{
      type: "triggered", storyName: "PANIC ATTACK",
      rulesText: "When you play this character, chosen character gets +2 {S} this turn. If the chosen character is named Pain, he gets +4 {S} instead.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "conditional_on_target",
        target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
        defaultEffects: [{ type: "gain_stats", strength: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" }],
        conditionFilter: { hasName: "Pain" },
        ifMatchEffects: [{ type: "gain_stats", strength: 4, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, duration: "this_turn" }],
      }],
    }],
  },
});
