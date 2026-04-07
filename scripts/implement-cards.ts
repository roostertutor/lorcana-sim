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
// SET 3 — Batch 2: remaining fits-grammar (skipping location-dependent cards)
// =============================================================================
patchSet("3", {

  // ===== STATICS — grant_keyword to filtered =====

  // Flotsam - Riffraff: "Your characters named Jetsam get +3 {S}."
  "flotsam-riffraff": {
    abilities: [{
      type: "static", storyName: "WE'LL STICK TOGETHER",
      rulesText: "Your characters named Jetsam get +3 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 3, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasName: "Jetsam" } } },
    }],
  },

  // Jetsam - Riffraff: "Your characters named Flotsam gain Ward."
  "jetsam-riffraff": {
    abilities: [{
      type: "static", storyName: "WE STICK TOGETHER",
      rulesText: "Your characters named Flotsam gain Ward.",
      effect: { type: "grant_keyword", keyword: "ward", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasName: "Flotsam" } } },
    }],
  },

  // Trigger - Not-So-Sharp Shooter: "Your characters named Nutsy get +1 {L}."
  "trigger-not-so-sharp-shooter": {
    abilities: [{
      type: "static", storyName: "PARTNERS",
      rulesText: "Your characters named Nutsy get +1 {L}.",
      effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasName: "Nutsy" } } },
    }],
  },

  // Peter Pan - Never Land Hero: "While Tinker Bell in play, +2 {S}"
  "peter-pan-never-land-hero": {
    abilities: [{
      type: "static", storyName: "YOU CAN FLY!",
      rulesText: "While you have a character named Tinker Bell in play, this character gets +2 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      condition: { type: "has_character_named", name: "Tinker Bell", player: { type: "self" } },
    }],
  },

  // Slightly - Lost Boy: self_cost_reduction with named-character condition
  "slightly-lost-boy": {
    abilities: [{
      type: "static", storyName: "THE FOX",
      rulesText: "If you have a character named Peter Pan in play, you pay 1 {I} less to play this character.",
      effect: { type: "self_cost_reduction", amount: 1 },
      condition: { type: "has_character_named", name: "Peter Pan", player: { type: "self" } },
    }],
  },

  // Scroop - Backstabber: "While damaged, +3 {S}"
  "scroop-backstabber": {
    abilities: [{
      type: "static", storyName: "BACKSTABBER",
      rulesText: "While this character has damage, he gets +3 {S}.",
      effect: { type: "modify_stat", stat: "strength", modifier: 3, target: { type: "this" } },
      condition: { type: "not", condition: { type: "this_has_no_damage" } },
    }],
  },

  // ===== ENTERS_PLAY =====

  // Kit Cloudkicker - Tough Guy: "may return chosen opposing with 2 STR or less"
  "kit-cloudkicker-tough-guy": {
    abilities: [{
      type: "triggered", storyName: "I'M READY!",
      rulesText: "When you play this character, you may return chosen opposing character with 2 {S} or less to their player's hand.",
      trigger: { on: "enters_play" },
      effects: [{ type: "return_to_hand", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"], strengthAtMost: 2 } }, isMay: true }],
    }],
  },

  // Madame Medusa - The Boss: "banish chosen opposing with 3 STR or less"
  "madame-medusa-the-boss": {
    abilities: [{
      type: "triggered", storyName: "WHERE'S MY DIAMOND?",
      rulesText: "When you play this character, banish chosen opposing character with 3 {S} or less.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"], strengthAtMost: 3 } } }],
    }],
  },

  // Kakamora - Menacing Sailor: enters_play opp loses 1 lore
  "kakamora-menacing-sailor": {
    abilities: [{
      type: "triggered", storyName: "ATTACK!",
      rulesText: "When you play this character, each opponent loses 1 lore.",
      trigger: { on: "enters_play" },
      effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
    }],
  },

  // Friar Tuck: enters_play - opponent with most cards in hand discards
  // TODO: needs "player with most cards in hand" target. Approximation: opponent discards 1
  "friar-tuck-priest-of-nottingham": {
    abilities: [{
      type: "triggered", storyName: "MISMATCHED PRIEST",
      rulesText: "When you play this character, the player or players with the most cards in their hand chooses and discards a card.",
      trigger: { on: "enters_play" },
      effects: [{ type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "target_player" }],
    }],
  },

  // Lyle Tiberius Rourke: enters_play grant Reckless next turn + when other banished, opp loses 1 lore
  "lyle-tiberius-rourke-cunning-mercenary": {
    abilities: [
      { type: "triggered", storyName: "AERIAL RECON",
        rulesText: "When you play this character, chosen opposing character gains Reckless during their next turn.",
        trigger: { on: "enters_play" },
        effects: [{ type: "grant_keyword", keyword: "reckless", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } }, duration: "end_of_owner_next_turn" }],
      },
      { type: "triggered",
        rulesText: "Whenever one of your other characters is banished, each opponent loses 1 lore.",
        trigger: { on: "is_banished", filter: { owner: { type: "self" }, cardType: ["character"], excludeSelf: true } },
        effects: [{ type: "lose_lore", amount: 1, target: { type: "opponent" } }],
      },
    ],
  },

  // Milo Thatch - King of Atlantis: "When banished, return all opposing characters"
  "milo-thatch-king-of-atlantis": {
    abilities: [{
      type: "triggered", storyName: "FOR ATLANTIS!",
      rulesText: "When this character is banished, return all opposing characters to their players' hands.",
      trigger: { on: "is_banished" },
      effects: [{ type: "return_to_hand", target: { type: "all", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } } }],
    }],
  },

  // ===== QUEST TRIGGERS =====

  // Helga Sinclair - Femme Fatale: "quests → may deal 3 to chosen damaged"
  "helga-sinclair-femme-fatale": {
    abilities: [{
      type: "triggered", storyName: "I'M ON YOUR SIDE",
      rulesText: "Whenever this character quests, you may deal 3 damage to chosen damaged character.",
      trigger: { on: "quests" },
      effects: [{ type: "deal_damage", amount: 3, target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasDamage: true } }, isMay: true }],
    }],
  },

  // Helga Sinclair - Vengeful Partner: "When challenged and banished, banish challenger"
  "helga-sinclair-vengeful-partner": {
    abilities: [{
      type: "triggered", storyName: "REVENGE",
      rulesText: "When this character is challenged and banished, banish the challenging character.",
      trigger: { on: "banished_in_challenge" },
      effects: [{ type: "banish", target: { type: "triggering_card" } }],
    }],
  },

  // Prince John - Phony King: "quests → each opponent with more lore loses 2"
  // TODO: condition check at effect time. Approximation: lose 2 lore.
  "prince-john-phony-king": {
    abilities: [{
      type: "triggered", storyName: "I LOVE GOLD",
      rulesText: "Whenever this character quests, each opponent with more lore than you loses 2 lore.",
      trigger: { on: "quests" },
      effects: [{ type: "lose_lore", amount: 2, target: { type: "opponent" } }],
    }],
  },

  // ===== IS_BANISHED / IS_CHALLENGED =====

  // Cursed Merfolk: "is_challenged → each opponent discards"
  "cursed-merfolk-ursulas-handiwork": {
    abilities: [{
      type: "triggered", storyName: "WHAT A WRETCHED FATE",
      rulesText: "Whenever this character is challenged, each opponent chooses and discards a card.",
      trigger: { on: "is_challenged" },
      effects: [{ type: "discard_from_hand", amount: 1, target: { type: "opponent" }, chooser: "target_player" }],
    }],
  },

  // Prince Eric - Expert Helmsman: "When banished, may banish chosen character"
  "prince-eric-expert-helmsman": {
    abilities: [{
      type: "triggered", storyName: "VENGEANCE",
      rulesText: "When this character is banished, you may banish chosen character.",
      trigger: { on: "is_banished" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } }, isMay: true }],
    }],
  },

  // ===== ACTIONS =====

  // Wildcat - Mechanic: enters_play banish chosen item
  "wildcat-mechanic": {
    abilities: [{
      type: "triggered", storyName: "WRECK IT",
      rulesText: "Banish chosen item.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } } }],
    }],
  },

  // Has Set My Heaaaaaart...: Song — banish chosen item
  "has-set-my-heaaaaaaart": {
    actionEffects: [
      { type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } } },
    ],
  },

  // Strike a Good Match: Song — draw 2 then discard 1
  "strike-a-good-match": {
    actionEffects: [
      { type: "draw", amount: 2, target: { type: "self" } },
      { type: "discard_from_hand", amount: 1, target: { type: "self" }, chooser: "target_player" },
    ],
  },

  // Divebomb: Banish your Reckless to banish chosen with less STR
  // TODO: "less STR than that character" needs dynamic strength comparison. Approximation: banish chosen.
  "divebomb": {
    actionEffects: [{
      type: "sequential",
      costEffects: [{ type: "banish", target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasKeyword: "reckless" } } }],
      rewardEffects: [{ type: "banish", target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } }],
    }],
  },

  // On Your Feet! Now!: Ready all + 1 damage to each + can't quest
  "on-your-feet-now": {
    actionEffects: [
      { type: "ready", target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } } },
      { type: "deal_damage", amount: 1, target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } } },
      // TODO: cant_action quest for the rest of this turn for all readied chars (not on each separately)
    ],
  },

  // ===== ITEMS =====

  // The Lamp: Banish — if Jafar draw 2; if Genie return chosen with cost 4 or less
  // TODO: conditional sub-effects. Approximation: just draw 2.
  "the-lamp": {
    abilities: [{
      type: "activated", storyName: "GOOD OR EVIL",
      rulesText: "If you have a character named Jafar in play, draw 2 cards. If you have a character named Genie in play, return chosen character with cost 4 or less to their player's hand.",
      costs: [{ type: "banish_self" }],
      effects: [{ type: "draw", amount: 2, target: { type: "self" } }],
    }],
  },

  // Robin's Bow: deal 1 to damaged char/loc + ready when Robin Hood quests
  "robins-bow": {
    abilities: [
      { type: "activated", storyName: "ARROW SHOT",
        rulesText: "Deal 1 damage to chosen damaged character or location.",
        costs: [{ type: "exert" }],
        effects: [{ type: "deal_damage", amount: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character", "location"], hasDamage: true } } }],
      },
      { type: "triggered",
        rulesText: "Whenever a character of yours named Robin Hood quests, you may ready this item.",
        trigger: { on: "quests", filter: { owner: { type: "self" }, hasName: "Robin Hood" } },
        effects: [{ type: "ready", target: { type: "this" }, isMay: true }],
      },
    ],
  },

  // Starlight Vial: pay 2 less for next action
  "starlight-vial": {
    abilities: [{
      type: "triggered", storyName: "SPARKLE",
      rulesText: "You pay 2 {I} less for the next action you play this turn.",
      trigger: { on: "enters_play" },
      effects: [{ type: "cost_reduction", amount: 2, filter: { cardType: ["action"] } }],
    }],
  },

  // Airfoil: "If you've played 2+ actions, draw a card" — activated
  "airfoil": {
    abilities: [{
      type: "activated", storyName: "FLY!",
      rulesText: "If you've played 2 or more actions this turn, draw a card.",
      costs: [{ type: "exert" }],
      condition: { type: "actions_played_this_turn_gte", amount: 2 },
      effects: [{ type: "draw", amount: 1, target: { type: "self" } }],
    }],
  },

  // ===== STILL UNIQUE =====

  // Rafiki - Mystical Fighter: "Whenever he challenges a Hyena, takes no damage from the challenge"
  // Same pattern as Raya - challenge_damage_immunity but with hasTrait filter
  "rafiki-mystical-fighter": {
    abilities: [{
      type: "static", storyName: "ANCIENT INSIGHT",
      rulesText: "Whenever he challenges a Hyena character, this character takes no damage from the challenge.",
      effect: { type: "challenge_damage_immunity", targetFilter: { hasTrait: "Hyena" } },
    }],
  },

  // Peter Pan - Pirate's Bane: same — immunity vs Pirate
  "peter-pan-pirates-bane": {
    abilities: [{
      type: "static", storyName: "YOU'RE NEXT!",
      rulesText: "Whenever he challenges a Pirate character, this character takes no damage from the challenge.",
      effect: { type: "challenge_damage_immunity", targetFilter: { hasTrait: "Pirate" } },
    }],
  },

  // Alice - Tea Alchemist: "Exert chosen opposing character and all other opposing characters with the same name."
  // TODO: needs "same name as chosen target" filter. Approximation: just exert chosen.
  "alice-tea-alchemist": {
    abilities: [{
      type: "triggered", storyName: "GROWING UP",
      rulesText: "Exert chosen opposing character and all other opposing characters with the same name.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } } }],
    }],
  },

  // Maui - Soaring Demigod: "Whenever HeiHei quests, +1 lore + lose Reckless this turn"
  // Approximation: +1 lore (lose Reckless not directly supported)
  "maui-soaring-demigod": {
    abilities: [{
      type: "triggered", storyName: "MENEHUNE MISCHIEF",
      rulesText: "Whenever a character of yours named HeiHei quests, this character gets +1 {L} and loses Reckless this turn.",
      trigger: { on: "quests", filter: { owner: { type: "self" }, hasName: "HeiHei" } },
      effects: [{ type: "gain_stats", lore: 1, target: { type: "this" }, duration: "this_turn" }],
    }],
  },

  // ===== Dalmatian Puppy — vanilla (deck construction only) =====
  // The "99 copies" rule is a deck construction rule, not an in-game effect.
  // Mark as having a static no-op so card-status counts it as implemented.
  "dalmatian-puppy-tail-wagger": {
    abilities: [{
      type: "static", storyName: "WHERE DID THEY ALL COME FROM?",
      rulesText: "You may have up to 99 copies of Dalmatian Puppy - Tail Wagger in your deck.",
      effect: { type: "modify_stat", stat: "willpower", modifier: 0, target: { type: "this" } },
      // NOTE: deck construction rule only; no in-game engine effect needed.
    }],
  },
});
