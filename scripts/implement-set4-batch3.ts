#!/usr/bin/env node
// Set 4 — Batch 3: 34 cards (one ink color's worth).
// All map to existing engine grammar.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-004.json");

const ALL_OWN_CHARS = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };

const patches: Record<string, any> = {

  // 1. Golden Harp Enchanter — STOLEN AWAY: turn_end self, if no song this turn, banish self
  "golden-harp-enchanter-of-the-land": {
    abilities: [
      {
        type: "triggered",
        storyName: "STOLEN AWAY",
        rulesText: "At the end of your turn, if you didn't play a song this turn, banish this character.",
        trigger: { on: "turn_end", player: { type: "self" } },
        condition: {
          type: "not",
          condition: { type: "songs_played_this_turn_gte", amount: 1 },
        },
        effects: [{ type: "banish", target: { type: "this" } }],
      },
    ],
  },

  // 2. Camilo Madrigal Prankster — MANY FORMS: turn_start self choose one
  "camilo-madrigal-prankster": {
    abilities: [
      {
        type: "triggered",
        storyName: "MANY FORMS",
        rulesText: "At the start of your turn, you may choose one: this character gets +1 {L} this turn; or this character gains Challenger +2 this turn.",
        trigger: { on: "turn_start", player: { type: "self" } },
        effects: [
          {
            type: "choose",
            isMay: true,
            options: [
              [
                {
                  type: "gain_stats",
                  lore: 1,
                  target: { type: "this" },
                  duration: "this_turn",
                },
              ],
              [
                {
                  type: "grant_keyword",
                  keyword: "challenger",
                  value: 2,
                  target: { type: "this" },
                  duration: "end_of_turn",
                },
              ],
            ],
          },
        ],
      },
    ],
  },

  // 3. Flotsam & Jetsam Entangling Eels — additionalNames
  "flotsam-jetsam-entangling-eels": {
    additionalNames: ["Flotsam", "Jetsam"],
    abilities: [
      {
        type: "keyword",
        keyword: "shift",
        value: 4,
      },
    ],
  },

  // 4. Poor Unfortunate Souls — return chosen char/item/loc cost ≤ 2 to hand
  "poor-unfortunate-souls": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: {
          type: "chosen",
          filter: { zone: "play", cardType: ["character", "item", "location"], costAtMost: 2 },
        },
      },
    ],
  },

  // 5. Casa Madrigal — OUR HOME: turn_start, if char here, gain 1 lore
  "casa-madrigal-casita": {
    abilities: [
      {
        type: "triggered",
        storyName: "OUR HOME",
        rulesText: "At the start of your turn, if you have a character here, gain 1 lore.",
        trigger: { on: "turn_start", player: { type: "self" } },
        condition: { type: "this_location_has_character" },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // 6. Cri-Kee Lucky Cricket — enters_play, your OTHER chars get +3 strength this turn
  "cri-kee-lucky-cricket": {
    abilities: [
      {
        type: "triggered",
        storyName: "SPREADING GOOD FORTUNE",
        rulesText: "When you play this character, your other characters get +3 {S} this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "gain_stats",
            strength: 3,
            target: { type: "all", filter: { ...ALL_OWN_CHARS, excludeSelf: true } },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // 7. Jaq Connoisseur of Climbing — enters_play, grant Reckless to chosen opposing for next turn
  "jaq-connoisseur-of-climbing": {
    abilities: [
      {
        type: "triggered",
        storyName: "SNEAKY IDEA",
        rulesText: "When you play this character, chosen opposing character gains Reckless during their next turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "grant_keyword",
            keyword: "reckless",
            target: { type: "chosen", filter: { ...ALL_OPP_CHARS } },
            duration: "end_of_owner_next_turn",
          },
        ],
      },
    ],
  },

  // 8. Jasmine Desert Warrior — CUNNING MANEUVER: enters_play AND is_challenged → each opp discards
  "jasmine-desert-warrior": {
    abilities: [
      {
        type: "triggered",
        storyName: "CUNNING MANEUVER (enters)",
        rulesText: "When you play this character, each opponent chooses and discards a card.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "discard_from_hand",
            amount: 1,
            target: { type: "opponent" },
            chooser: "target_player",
          },
        ],
      },
      {
        type: "triggered",
        storyName: "CUNNING MANEUVER (challenged)",
        rulesText: "Whenever she's challenged, each opponent chooses and discards a card.",
        trigger: { on: "is_challenged" },
        effects: [
          {
            type: "discard_from_hand",
            amount: 1,
            target: { type: "opponent" },
            chooser: "target_player",
          },
        ],
      },
    ],
  },

  // 9. Megara Captivating Cynic — SHADY DEAL: enters_play choose: discard or banish self
  "megara-captivating-cynic": {
    abilities: [
      {
        type: "triggered",
        storyName: "SHADY DEAL",
        rulesText: "When you play this character, choose and discard a card or banish this character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "choose",
            options: [
              [
                {
                  type: "discard_from_hand",
                  amount: 1,
                  target: { type: "self" },
                  chooser: "target_player",
                },
              ],
              [{ type: "banish", target: { type: "this" } }],
            ],
          },
        ],
      },
    ],
  },

  // 10. Pete Born to Cheat — I CLOBBER YOU!: quests, if self has 5+ str, return chosen with 2 str or less
  "pete-born-to-cheat": {
    abilities: [
      {
        type: "triggered",
        storyName: "I CLOBBER YOU!",
        rulesText: "Whenever this character quests while he has 5 {S} or more, return chosen character with 2 {S} or less to their player's hand.",
        trigger: { on: "quests" },
        condition: { type: "self_stat_gte", stat: "strength", amount: 5 },
        effects: [
          {
            type: "return_to_hand",
            target: { type: "chosen", filter: { ...ANY_CHAR, strengthAtMost: 2 } },
          },
        ],
      },
    ],
  },

  // 11. Prince Phillip Warden of the Woods — SHINING BEACON: your other Hero chars gain Ward
  "prince-phillip-warden-of-the-woods": {
    abilities: [
      {
        type: "static",
        storyName: "SHINING BEACON",
        rulesText: "Your other Hero characters gain Ward.",
        effect: {
          type: "grant_keyword",
          keyword: "ward",
          target: {
            type: "all",
            filter: { ...ALL_OWN_CHARS, hasTrait: "Hero", excludeSelf: true },
          },
        },
      },
    ],
  },

  // 12. Make the Potion — choose one: banish chosen item OR deal 2 damage to damaged chosen
  "make-the-potion": {
    actionEffects: [
      {
        type: "choose",
        options: [
          [
            {
              type: "banish",
              target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
            },
          ],
          [
            {
              type: "deal_damage",
              amount: 2,
              target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
            },
          ],
        ],
      },
    ],
  },

  // 13. Signed Contract — FINE PRINT: opponent plays a song → may draw
  "signed-contract": {
    abilities: [
      {
        type: "triggered",
        storyName: "FINE PRINT",
        rulesText: "Whenever an opponent plays a song, you may draw a card.",
        trigger: {
          on: "card_played",
          filter: { owner: { type: "opponent" }, cardType: ["action"], hasTrait: "Song" },
        },
        effects: [{ type: "draw", amount: 1, isMay: true, target: { type: "self" } }],
      },
    ],
  },

  // 14. Hidden Cove Tranquil Haven — characters here get +1 S and +1 W
  "hidden-cove-tranquil-haven": {
    abilities: [
      {
        type: "static",
        storyName: "REVITALIZING WATERS (S)",
        rulesText: "Characters get +1 {S} while here.",
        effect: {
          type: "modify_stat",
          stat: "strength",
          modifier: 1,
          target: { type: "all", filter: { ...ANY_CHAR, atLocation: "this" } },
        },
      },
      {
        type: "static",
        storyName: "REVITALIZING WATERS (W)",
        rulesText: "Characters get +1 {W} while here.",
        effect: {
          type: "modify_stat",
          stat: "willpower",
          modifier: 1,
          target: { type: "all", filter: { ...ANY_CHAR, atLocation: "this" } },
        },
      },
    ],
  },

  // 15. Beast Wounded — enters play with 4 damage
  "beast-wounded": {
    abilities: [
      {
        type: "triggered",
        storyName: "THAT HURTS!",
        rulesText: "This character enters play with 4 damage.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "deal_damage",
            amount: 4,
            target: { type: "this" },
          },
        ],
      },
    ],
  },

  // 16. Fa Zhou Mulan's Father — WAR INJURY (cant_action_self challenge) +
  //     HEAD OF THE HOUSEHOLD (activated: ready chosen Mulan + cant quest)
  "fa-zhou-mulans-father": {
    abilities: [
      {
        type: "static",
        storyName: "WAR INJURY",
        rulesText: "This character can't challenge.",
        effect: { type: "cant_action_self", action: "challenge" },
      },
      {
        type: "activated",
        storyName: "HEAD OF THE HOUSEHOLD",
        rulesText: "{E} — Ready chosen character named Mulan. She can't quest for the rest of this turn.",
        costs: [{ type: "exert" }],
        effects: [
          {
            type: "ready",
            target: {
              type: "chosen",
              filter: { ...ALL_OWN_CHARS, hasName: "Mulan" },
            },
            followUpEffects: [
              {
                type: "cant_action",
                action: "quest",
                target: { type: "this" },
                duration: "rest_of_turn",
              },
            ],
          },
        ],
      },
    ],
  },

  // 17. Li Shang Valorous General — LEAD THE CHARGE: your chars with str ≥ 4 get +1 lore
  "li-shang-valorous-general": {
    abilities: [
      {
        type: "static",
        storyName: "LEAD THE CHARGE",
        rulesText: "Your characters with 4 {S} or more get +1 {L}.",
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, strengthAtLeast: 4 } },
        },
      },
    ],
  },

  // 18. Anna Braving the Storm — I WAS BORN READY: if other Hero in play, +1 lore
  "anna-braving-the-storm": {
    abilities: [
      {
        type: "static",
        storyName: "I WAS BORN READY",
        rulesText: "If you have another Hero character in play, this character gets +1 {L}.",
        condition: {
          type: "has_character_with_trait",
          trait: "Hero",
          player: { type: "self" },
          excludeSelf: true,
        },
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: 1,
          target: { type: "this" },
        },
      },
    ],
  },

  // 19. Anna True-Hearted — quests, your other Hero chars +1 lore this turn
  "anna-true-hearted": {
    abilities: [
      {
        type: "triggered",
        storyName: "LET ME HELP YOU",
        rulesText: "Whenever this character quests, your other Hero characters get +1 {L} this turn.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "gain_stats",
            lore: 1,
            target: {
              type: "all",
              filter: { ...ALL_OWN_CHARS, hasTrait: "Hero", excludeSelf: true },
            },
            duration: "this_turn",
          },
        ],
      },
    ],
  },

  // 20. Dang Hu Talon Chief — your other Villains gain Support
  "dang-hu-talon-chief": {
    abilities: [
      {
        type: "static",
        storyName: "YOU BETTER TALK FAST",
        rulesText: "Your other Villain characters gain Support.",
        effect: {
          type: "grant_keyword",
          keyword: "support",
          target: {
            type: "all",
            filter: { ...ALL_OWN_CHARS, hasTrait: "Villain", excludeSelf: true },
          },
        },
      },
    ],
  },

  // 21. Hans Noble Scoundrel — enters_play, if Princess or Queen in play, gain 1 lore
  "hans-noble-scoundrel": {
    abilities: [
      {
        type: "triggered",
        storyName: "ROYAL SCHEMES",
        rulesText: "When you play this character, if a Princess or Queen character is in play, gain 1 lore.",
        trigger: { on: "enters_play" },
        condition: {
          type: "compound_or",
          conditions: [
            { type: "has_character_with_trait", trait: "Princess", player: { type: "self" } },
            { type: "has_character_with_trait", trait: "Queen", player: { type: "self" } },
            { type: "has_character_with_trait", trait: "Princess", player: { type: "opponent" } },
            { type: "has_character_with_trait", trait: "Queen", player: { type: "opponent" } },
          ],
        },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // 22. Ice Block — chosen char -1 strength this turn
  "ice-block": {
    actionEffects: [
      {
        type: "gain_stats",
        strength: -1,
        target: { type: "chosen", filter: { ...ANY_CHAR } },
        duration: "this_turn",
      },
    ],
  },

  // 23. Aladdin Brave Rescuer — quests, may banish chosen item
  "aladdin-brave-rescuer": {
    abilities: [
      {
        type: "triggered",
        storyName: "CRASHING THROUGH",
        rulesText: "Whenever this character quests, you may banish chosen item.",
        trigger: { on: "quests" },
        effects: [
          {
            type: "banish",
            target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
          },
        ],
      },
    ],
  },

  // 24. Chi-Fu Imperial Advisor — static, while no damage, +2 lore
  "chi-fu-imperial-advisor": {
    abilities: [
      {
        type: "static",
        storyName: "OVERLY CAUTIOUS",
        rulesText: "While this character has no damage, he gets +2 {L}.",
        condition: { type: "this_has_no_damage" },
        effect: {
          type: "modify_stat",
          stat: "lore",
          modifier: 2,
          target: { type: "this" },
        },
      },
    ],
  },

  // 25. Ling Imperial Soldier — your Hero chars +1 strength
  "ling-imperial-soldier": {
    abilities: [
      {
        type: "static",
        storyName: "FULL OF SPIRIT",
        rulesText: "Your Hero characters get +1 {S}.",
        effect: {
          type: "modify_stat",
          stat: "strength",
          modifier: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Hero" } },
        },
      },
    ],
  },

  // 26. Luisa Madrigal Rock of the Family — while you have another character, +2 strength
  "luisa-madrigal-rock-of-the-family": {
    abilities: [
      {
        type: "static",
        storyName: "I'M THE STRONG ONE",
        rulesText: "While you have another character in play, this character gets +2 {S}.",
        condition: {
          type: "characters_in_play_gte",
          amount: 1,
          player: { type: "self" },
          excludeSelf: true,
        },
        effect: {
          type: "modify_stat",
          stat: "strength",
          modifier: 2,
          target: { type: "this" },
        },
      },
    ],
  },

  // 27. Mickey Mouse Standard Bearer — enters_play, grant Challenger +2 to chosen this turn
  "mickey-mouse-standard-bearer": {
    abilities: [
      {
        type: "triggered",
        storyName: "STAND STRONG",
        rulesText: "When you play this character, chosen character gains Challenger +2 this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "grant_keyword",
            keyword: "challenger",
            value: 2,
            target: { type: "chosen", filter: { ...ANY_CHAR } },
            duration: "end_of_turn",
          },
        ],
      },
    ],
  },

  // 28. Philoctetes — your Hero chars Challenger +1 (static) + play Hero → gain 1 lore
  "philoctetes-no-nonsense-instructor": {
    abilities: [
      {
        type: "static",
        storyName: "YOU GOTTA STAY FOCUSED",
        rulesText: "Your Hero characters gain Challenger +1.",
        effect: {
          type: "grant_keyword",
          keyword: "challenger",
          value: 1,
          target: { type: "all", filter: { ...ALL_OWN_CHARS, hasTrait: "Hero" } },
        },
      },
      {
        type: "triggered",
        storyName: "SHAMELESS PROMOTER",
        rulesText: "Whenever you play a Hero character, gain 1 lore.",
        trigger: {
          on: "card_played",
          filter: { cardType: ["character"], hasTrait: "Hero" },
        },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // 29. Transformed Chef Castle Stove — enters_play, remove up to 2 damage chosen
  "transformed-chef-castle-stove": {
    abilities: [
      {
        type: "triggered",
        storyName: "A CULINARY MASTERPIECE",
        rulesText: "When you play this character, remove up to 2 damage from chosen character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "remove_damage",
            amount: 2,
            isUpTo: true,
            target: { type: "chosen", filter: { ...ANY_CHAR } },
          },
        ],
      },
    ],
  },

  // 30. Raya Guardian of Dragon Gem — enters_play, ready chosen at-loc + cant_quest
  "raya-guardian-of-the-dragon-gem": {
    abilities: [
      {
        type: "triggered",
        storyName: "WE HAVE TO COME TOGETHER",
        rulesText: "When you play this character, ready chosen character of yours at a location. They can't quest for the rest of this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "ready",
            target: {
              type: "chosen",
              filter: { ...ALL_OWN_CHARS, atLocation: "any" },
            },
            followUpEffects: [
              {
                type: "cant_action",
                action: "quest",
                target: { type: "this" },
                duration: "rest_of_turn",
              },
            ],
          },
        ],
      },
    ],
  },

  // 31. Rapunzel Appreciative Artist — static condition has Pascal → gain Ward
  "rapunzel-appreciative-artist": {
    abilities: [
      {
        type: "static",
        storyName: "PERCEPTIVE PARTNER",
        rulesText: "While you have a character named Pascal in play, this character gains Ward.",
        condition: { type: "has_character_named", name: "Pascal", player: { type: "self" } },
        effect: {
          type: "grant_keyword",
          keyword: "ward",
          target: { type: "this" },
        },
      },
    ],
  },

  // 32. Vision Slab — DANGER REVEALED: turn_start, opponent has damaged char → gain 1 lore
  "vision-slab": {
    abilities: [
      {
        type: "triggered",
        storyName: "DANGER REVEALED",
        rulesText: "At the start of your turn, if an opposing character has damage, gain 1 lore.",
        trigger: { on: "turn_start", player: { type: "self" } },
        condition: {
          type: "cards_in_zone_gte",
          zone: "play",
          amount: 1,
          player: { type: "opponent" },
          cardType: ["character"],
        },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // 33. Pascal Inquisitive Pet — enters_play, look at top 3, reorder
  "pascal-inquisitive-pet": {
    abilities: [
      {
        type: "triggered",
        storyName: "COLORFUL TACTICS",
        rulesText: "When you play this character, look at the top 3 cards of your deck and put them back in any order.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "look_at_top",
            count: 3,
            action: "reorder",
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // 34. Scuttle Expert on Humans — enters_play, look top 4, may reveal item to hand
  "scuttle-expert-on-humans": {
    abilities: [
      {
        type: "triggered",
        storyName: "LET ME SEE",
        rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal an item card and put it into your hand. Put the rest on the bottom of your deck in any order.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "look_at_top",
            count: 4,
            action: "one_to_hand_rest_bottom",
            filter: { cardType: ["item"] },
            target: { type: "self" },
            isMay: true,
          },
        ],
      },
    ],
  },
};

// ─── Apply ────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(path, "utf-8"));
let patched = 0;
for (const card of cards) {
  if (patches[card.id]) {
    const patch = patches[card.id];
    if (patch.abilities) card.abilities = patch.abilities;
    if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    if (patch.additionalNames) card.additionalNames = patch.additionalNames;
    patched++;
    console.log(`  ✅ ${card.id}`);
  }
}
writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
console.log(`\nPatched ${patched} cards in set 4.`);
