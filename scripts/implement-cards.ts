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
// SET 2 — Batch 6: remaining cards (approximations where engine gaps exist)
// =============================================================================
patchSet("2", {

  // --- Using existing modify_stat_per_count ---

  // Donald Duck - Not Again!: "+1 {L} for each 1 damage on him"
  "donald-duck-not-again": {
    abilities: [{
      type: "static", storyName: "WHAT A DAY!",
      rulesText: "This character gets +1 {L} for each 1 damage on him.",
      // modify_stat_per_count counts cards matching a filter.
      // Damage-per-self isn't a card count — this needs a new static type.
      // Approximation: +1 lore flat (doesn't scale with damage).
      // TODO: needs "modify_stat_per_damage" static type
      effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "this" } },
    }],
  },

  // Flynn Rider: "-1 {L} for each card in opponents' hands"
  // modify_stat_per_count with countFilter for opponent's hand
  "flynn-rider-his-own-biggest-fan": {
    abilities: [{
      type: "static", storyName: "WANTED",
      rulesText: "This character gets -1 {L} for each card in your opponents' hands.",
      effect: {
        type: "modify_stat_per_count", stat: "lore", perCount: -1,
        countFilter: { owner: { type: "opponent" }, zone: "hand" },
        target: { type: "this" },
      },
    }],
  },

  // --- Using existing cards_in_zone_gte / cards_in_hand_eq conditions ---

  // Belle - Bookworm: "While an opponent has no cards in their hand, +2 {L}"
  "belle-bookworm": {
    abilities: [{
      type: "static", storyName: "WELL-READ",
      rulesText: "While an opponent has no cards in their hand, this character gets +2 {L}.",
      effect: { type: "modify_stat", stat: "lore", modifier: 2, target: { type: "this" } },
      condition: { type: "cards_in_hand_eq", amount: 0, player: { type: "opponent" } },
    }],
  },

  // Gaston - Scheming Suitor: "While opponents have no cards in hand, +3 {S}"
  "gaston-scheming-suitor": {
    abilities: [{
      type: "static", storyName: "SCHEMING",
      rulesText: "While one or more opponents have no cards in their hands, this character gets +3 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 3, target: { type: "this" } },
      condition: { type: "cards_in_hand_eq", amount: 0, player: { type: "opponent" } },
    }],
  },

  // Noi - Orphaned Thief: "While you have an item in play, gains Resist +1 and Ward."
  // Uses cards_in_zone_gte condition
  "noi-orphaned-thief": {
    abilities: [
      {
        type: "static", storyName: "RESOURCEFUL",
        rulesText: "While you have an item in play, this character gains Resist +1 and Ward.",
        effect: { type: "grant_keyword", keyword: "resist", value: 1, target: { type: "this" } },
        condition: { type: "cards_in_zone_gte", zone: "play", amount: 1, player: { type: "self" } },
        // NOTE: cards_in_zone_gte counts all cards in play, not just items.
        // TODO: needs CardFilter on the zone count condition to filter by cardType: item
      },
      {
        type: "static",
        effect: { type: "grant_keyword", keyword: "ward", target: { type: "this" } },
        condition: { type: "cards_in_zone_gte", zone: "play", amount: 1, player: { type: "self" } },
      },
    ],
  },

  // Pain - Underworld Imp: "While this character has 5 {S} or more, he gets +2 {L}."
  // TODO: needs self_stat_gte condition. Approximation: always applies.
  "pain-underworld-imp": {
    abilities: [{
      type: "static", storyName: "PAIN POWER",
      rulesText: "While this character has 5 {S} or more, he gets +2 {L}.",
      effect: { type: "modify_stat", stat: "lore", modifier: 2, target: { type: "this" } },
      // TODO: condition should be self_stat_gte: { stat: "strength", amount: 5 }
    }],
  },

  // --- Timed can_challenge_ready ---

  // Pick a Fight: "Chosen character can challenge ready characters this turn."
  // Model as granting canChallengeReady via a timed effect — but TimedEffect doesn't support this type.
  // Approximation: do nothing (the effect is niche and can't be modeled without new timed type).
  // TODO: needs timed "can_challenge_ready" effect
  "pick-a-fight": {
    actionEffects: [
      // Placeholder — can't model timed canChallengeReady yet
      // The action still "works" (plays, goes to discard) but has no mechanical effect
    ],
  },

  // --- play_for_free + Rush + end-of-turn banish ---

  // Madam Mim - Rival of Merlin: "Play a character cost 4 or less for free. Rush. Banish at end of turn."
  // play_for_free exists but the Rush grant + delayed banish is complex.
  // Approximation: play_for_free only (Rush + banish not tracked)
  "madam-mim-rival-of-merlin": {
    abilities: [{
      type: "triggered", storyName: "MAGNIFICENT, MARVELOUS, MAD MADAM MIM",
      rulesText: "Play a character with cost 4 or less for free. They gain Rush. At the end of the turn, banish them.",
      trigger: { on: "enters_play" },
      effects: [{ type: "play_for_free", filter: { cardType: ["character"], costAtMost: 4 } }],
      // TODO: grant Rush to the played character + create delayed trigger to banish at end of turn
    }],
  },

  // Gruesome and Grim: Song — same as Madam Mim
  "gruesome-and-grim": {
    actionEffects: [
      { type: "play_for_free", filter: { cardType: ["character"], costAtMost: 4 } },
      // TODO: grant Rush + delayed end-of-turn banish
    ],
  },

  // --- Approximations for remaining complex cards ---

  // Beast - Relentless: "Whenever an opposing character is damaged, you may ready this character."
  // Needs is_damaged trigger for opponent's characters. Approximation: no-op.
  // TODO: needs is_damaged trigger event (fires when any character takes damage)
  "beast-relentless": {
    abilities: [{
      type: "triggered", storyName: "UNBRIDLED FURY",
      rulesText: "Whenever an opposing character is damaged, you may ready this character.",
      // Approximation: trigger on is_challenged (close but not exact)
      trigger: { on: "is_challenged", filter: { owner: { type: "opponent" } } },
      effects: [{ type: "ready", target: { type: "this" }, isMay: true }],
    }],
  },

  // Rapunzel - Gifted Artist: "Whenever you remove damage from one of your characters, you may draw a card."
  // TODO: needs damage_removed trigger event
  // Approximation: no trigger (can't model without new event)
  "rapunzel-gifted-artist": {
    abilities: [{
      type: "static", storyName: "HEALING GLOW",
      rulesText: "Whenever you remove 1 or more damage from one of your characters, you may draw a card.",
      // STUB: no damage_removed trigger available. Marking as static placeholder.
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Grand Pabbie: same issue — needs damage_removed trigger
  "grand-pabbie-oldest-and-wisest": {
    abilities: [{
      type: "static", storyName: "ANCIENT KNOWLEDGE",
      rulesText: "Whenever you remove 1 or more damage from one of your characters, gain 2 lore.",
      // STUB: no damage_removed trigger available
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Christopher Robin: "Whenever you ready this character, if 2+ other characters, gain 2 lore."
  // TODO: needs "ready" trigger event
  "christopher-robin-adventurer": {
    abilities: [{
      type: "static", storyName: "ADVENTUROUS SPIRIT",
      rulesText: "Whenever you ready this character, if you have 2 or more other characters in play, gain 2 lore.",
      // STUB: no "ready" trigger event
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Merlin - Shapeshifter: "Whenever one of your other characters is returned to your hand from play, +1 {L} this turn."
  // TODO: needs returned_to_hand trigger
  "merlin-shapeshifter": {
    abilities: [{
      type: "static", storyName: "VERSATILE WIZARD",
      rulesText: "Whenever one of your other characters is returned to your hand from play, this character gets +1 {L} this turn.",
      // STUB: no returned_to_hand trigger
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Prince John: "Whenever your opponent discards, you may draw a card for each card discarded."
  // TODO: needs opponent_discards trigger
  "prince-john-greediest-of-all": {
    abilities: [{
      type: "static", storyName: "TAXES!",
      rulesText: "Whenever your opponent discards 1 or more cards, you may draw a card for each card discarded.",
      // STUB: no opponent_discards trigger
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Minnie Mouse - Wide-Eyed Diver: "second action in a turn → +2 {L}"
  // TODO: needs action-count-this-turn tracking
  "minnie-mouse-wide-eyed-diver": {
    abilities: [{
      type: "static", storyName: "DEEP BREATH",
      rulesText: "Whenever you play a second action in a turn, this character gets +2 {L} this turn.",
      // STUB: no action counter tracking
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Fairy Godmother - Mystic Armorer: grants triggered ability to other characters
  // TODO: needs meta-ability (granting abilities to other cards)
  "fairy-godmother-mystic-armorer": {
    abilities: [{
      type: "triggered", storyName: "ENCHANTED ARMOR",
      rulesText: "Whenever this character quests, your characters gain Challenger +3 and 'When this character is banished in a challenge, return this card to your hand' this turn.",
      trigger: { on: "quests" },
      // Approximation: just grant Challenger +3
      effects: [{ type: "grant_keyword", keyword: "challenger", value: 3, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } }, duration: "end_of_turn" }],
      // TODO: also grant "banished_in_challenge → return to hand" triggered ability
    }],
  },

  // Cogsworth - Talking Clock: "Your characters with Reckless gain '{E} — Gain 1 lore.'"
  // TODO: needs meta-ability (granting activated abilities to other cards)
  // Approximation: no-op static
  "cogsworth-talking-clock": {
    abilities: [{
      type: "static", storyName: "TIMELY ADVICE",
      rulesText: "Your characters with Reckless gain '{E} — Gain 1 lore.'",
      // STUB: can't grant activated abilities
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Last Stand: "Banish chosen character who was challenged this turn."
  // TODO: needs "was_challenged_this_turn" tracking on CardInstance
  // Approximation: banish any character
  "last-stand": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } },
      // TODO: should only target characters that were challenged this turn
    ],
  },

  // Sleepy's Flute: "If you played a song this turn, gain 1 lore."
  // TODO: needs "played_song_this_turn" condition
  // Approximation: always gain 1 lore
  "sleepys-flute": {
    abilities: [{
      type: "activated", storyName: "LULLABY",
      rulesText: "If you played a song this turn, gain 1 lore.",
      costs: [{ type: "exert" }],
      // TODO: condition should check played_song_this_turn
      effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
    }],
  },

  // Raya - Leader of Heart: "Whenever challenges a damaged character, takes no damage from the challenge."
  // TODO: needs damage_immunity during challenge (conditional)
  // Approximation: gains Resist +99 when challenging (effectively immune)
  "raya-leader-of-heart": {
    abilities: [{
      type: "triggered", storyName: "HEART OF A WARRIOR",
      rulesText: "Whenever this character challenges a damaged character, she takes no damage from the challenge.",
      trigger: { on: "challenges" },
      // STUB: no challenge damage immunity. Approximation: no-op
      effects: [],
    }],
  },

  // Bibbidi Bobbidi Boo: "Return chosen character to hand to play another with same cost or less for free."
  // Complex sequential with dynamic cost filter. Approximation: just return to hand.
  "bibbidi-bobbidi-boo": {
    actionEffects: [{
      type: "sequential",
      costEffects: [{ type: "return_to_hand", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } } }],
      rewardEffects: [{ type: "play_for_free", filter: { cardType: ["character"] } }],
      // TODO: play_for_free filter should be costAtMost = returned character's cost (dynamic)
    }],
  },

  // Pack Tactics: "Gain 1 lore for each damaged character opponents have in play."
  // TODO: needs count-based gain_lore. Approximation: gain 1 lore.
  "pack-tactics": {
    actionEffects: [
      { type: "gain_lore", amount: 1, target: { type: "self" } },
      // TODO: amount should be count of damaged opposing characters
    ],
  },

  // Dinner Bell: "Draw cards equal to the damage on chosen character, then banish them."
  // TODO: needs dynamic draw amount from damage. Approximation: draw 2 + banish.
  "dinner-bell": {
    abilities: [{
      type: "activated", storyName: "COME AND GET IT!",
      rulesText: "Draw cards equal to the damage on chosen character of yours, then banish them.",
      costs: [{ type: "exert" }],
      effects: [{
        type: "sequential",
        costEffects: [],
        rewardEffects: [
          { type: "draw", amount: 2, target: { type: "self" } },
          // TODO: amount should equal chosen character's damage
          { type: "banish", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasDamage: true } } },
        ],
      }],
    }],
  },

  // Sword in the Stone: "{E}, 2 {I} — Chosen character gets +1 {S} per damage on them."
  // TODO: needs dynamic stat gain per damage. Approximation: +2 {S}.
  "sword-in-the-stone": {
    abilities: [{
      type: "activated", storyName: "LEGENDARY BLADE",
      rulesText: "Chosen character gets +1 {S} this turn for each 1 damage on them.",
      costs: [{ type: "exert" }, { type: "pay_ink", amount: 2 }],
      effects: [{ type: "gain_stats", strength: 2, target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasDamage: true } }, duration: "this_turn" }],
      // TODO: strength bonus should equal target's damage count
    }],
  },

  // --- needs-new-type cards: implement what we can, stub the rest ---

  // Mufasa - Betrayed Leader: reveal top, if character play for free exerted
  // Approximation: look_at_top with filter
  "mufasa-betrayed-leader": {
    abilities: [{
      type: "triggered", storyName: "THE SUN WILL SET",
      rulesText: "When this character is banished, you may reveal the top card of your deck. If it's a character card, you may play that character for free and they enter play exerted. Otherwise, put it on the top of your deck.",
      trigger: { on: "is_banished" },
      effects: [{ type: "look_at_top", count: 1, action: "one_to_hand_rest_bottom", filter: { cardType: ["character"] }, target: { type: "self" }, isMay: true }],
      // TODO: should play for free + enter exerted, not put into hand
    }],
  },

  // Mulan - Reflecting: same pattern but for songs on quest
  "mulan-reflecting": {
    abilities: [{
      type: "triggered", storyName: "REFLECTION",
      rulesText: "Whenever this character quests, you may reveal the top card of your deck. If it's a song card, you may play it for free. Otherwise, put it on the top of your deck.",
      trigger: { on: "quests" },
      effects: [{ type: "look_at_top", count: 1, action: "one_to_hand_rest_bottom", filter: { cardType: ["action"], hasTrait: "Song" }, target: { type: "self" }, isMay: true }],
      // TODO: should play for free, not put into hand
    }],
  },

  // Zero to Hero: "Count characters in play, pay that much less for next character."
  // TODO: needs count-based cost_reduction. Approximation: cost_reduction 3 (average).
  "zero-to-hero": {
    actionEffects: [
      { type: "cost_reduction", amount: 3, filter: { cardType: ["character"] } },
      // TODO: amount should equal count of characters in play
    ],
  },

  // Binding Contract: "{E}, {E} one of your characters — Exert chosen character."
  // TODO: needs exert_filtered_character cost type
  // Approximation: just exert + exert chosen (missing the character cost)
  "binding-contract": {
    abilities: [{
      type: "activated", storyName: "SIGNED IN BLOOD",
      rulesText: "Exert chosen character.",
      costs: [{ type: "exert" }],
      // TODO: should also cost "exert one of your characters"
      effects: [{ type: "exert", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } }],
    }],
  },

  // The Queen - Disguised Peddler: "{E}, discard character card — Gain lore equal to {L}"
  // TODO: needs dynamic lore from discarded card's {L}. Approximation: gain 2 lore.
  "the-queen-disguised-peddler": {
    abilities: [{
      type: "activated", storyName: "POISONED APPLE",
      rulesText: "Gain lore equal to the discarded character's {L}.",
      costs: [{ type: "exert" }, { type: "discard", filter: { cardType: ["character"] }, amount: 1 }],
      effects: [{ type: "gain_lore", amount: 2, target: { type: "self" } }],
      // TODO: amount should equal the discarded character's lore value
    }],
  },

  // Cinderella - Stouthearted: "Whenever you play a song, may challenge ready this turn."
  // TODO: needs song_played trigger + timed canChallengeReady
  "cinderella-stouthearted": {
    abilities: [{
      type: "static", storyName: "BRAVE HEART",
      rulesText: "Whenever you play a song, this character may challenge ready characters this turn.",
      // STUB: needs song_played trigger + timed canChallengeReady
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
    }],
  },

  // Tiana - Celebrating Princess: "While exerted and no cards in hand, opponents can't play actions."
  // TODO: needs compound_and condition (this_is_exerted + cards_in_hand_eq 0)
  // Approximation: use this_is_exerted only
  "tiana-celebrating-princess": {
    abilities: [{
      type: "static", storyName: "CELEBRATION",
      rulesText: "While this character is exerted and you have no cards in your hand, opponents can't play actions.",
      effect: { type: "action_restriction", restricts: "play", affectedPlayer: { type: "opponent" } },
      condition: { type: "this_is_exerted" },
      // TODO: should also require cards_in_hand_eq 0 (compound_and condition)
    }],
  },

  // Strength of a Raging Fire: "Deal damage equal to number of characters you have in play."
  // TODO: needs dynamic damage amount. Approximation: deal 3 damage.
  "strength-of-a-raging-fire": {
    actionEffects: [
      { type: "deal_damage", amount: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } },
      // TODO: amount should equal count of own characters in play
    ],
  },
});
