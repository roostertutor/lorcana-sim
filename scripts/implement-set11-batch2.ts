#!/usr/bin/env node
// Set 11 — Batch 2: more fits-grammar wiring. No new primitives.
// Skipped / deferred:
//   - UNDERDOG cards (going-second-turn-1 condition not in engine): Angel Siren Singer,
//     Christopher Robin Joining the Fun, White Rabbit Late Again, Liquidator Iced Over,
//     Splatter Phoenix Rejected Artist, Judy Hopps Snowball Patrol.
//   - "none of your characters challenged this turn" condition not in engine:
//     John Smith Snow Tracker, Mother's Necklace, Pocahontas Peacekeeper.
//   - Complex modals: Tod - Playful Kit, Education or Elimination, Hidden Trap, Battering Ram.
//   - Play-time dual-condition cost reduction: Mulan - Ready for Battle (NOBLE+FIGHTING SPIRIT),
//     Gramma Tala (per-inkwell-card cost reduction), Vixey (needs persistent "named Tod"),
//     Pudge (needs "named Lilo" free-play alt cost), Reuben (dynamic cost reduction per-damage).
//   - SMOOTH THE WAY (oncePerTurn activated ability granting cost reduction) — no activated
//     grant-cost-reduction pattern yet.
//   - Meeko Skittish Scrounger, Willie the Giant, Chief Tui (needs oncePerTurn on trigger +
//     scry) — partial safe wiring below.
//   - Goofy Ghost of Jacob Marley (per-card-under discards) — cards-under count not a
//     discard amount; skip.
//   - Wisdom of the Willow (rest-of-turn quest trigger subscription) — no dynamic trigger
//     grant pattern on actions.
//   - Freeze-the-Vine (Frozen Vine location), Retro Evolution Device (cost-scaling play),
//     Marshmallow (per-opponent ready-limit), Scrooge Miserly Ebenezer (on-inkwell trigger
//     strength debuff — needs card_put_in_inkwell trigger on own), Darkwing Tower.
//   - Angela, Bambi Ethereal Fawn, John Smith Undaunted, Kristoff's Lute, Elisa Maza,
//     Moana Curious Explorer, Anna Soothing Sister, Lilo Bundled Up, Keep the Ancient Ways
//     (all DEFERRED_MECHANICS).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-011.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── ETB effects ────────────────────────────────────────────────
  "eeyore-in-the-way": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, for each opposing player, you may choose a character of theirs. They can't ready at the start of their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "cant_action", action: "ready", duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "morgana-macawber-reformed-spellcaster": {
    // Approximation: move 1 damage from each own character to chosen opposing character.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may choose an opposing character and move 1 damage from each other character to them.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "move_damage", amount: 1, isMay: true,
        from: { type: "chosen", filter: ANY_CHAR },
        to: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "witches-of-morva-orddu-orwen-and-orgoch": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may return another chosen character of yours to your hand. If you do, gain 1 lore.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "sequential",
        costEffects: [{
          type: "return_to_hand", isMay: true,
          target: { type: "chosen", filter: OWN_OTHER_CHARS },
        }],
        rewardEffects: [{ type: "gain_lore", amount: 1, target: SELF }],
      }],
    }],
  },

  "chernabog-unnatural-force": {
    // Approximation: shuffle chosen opposing character into deck; drop opponent free-play branch.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, you may shuffle chosen opposing character into their player's deck.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "shuffle_into_deck", isMay: true,
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "dinky-has-the-brains": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, each opponent chooses one of their characters and deals 1 damage to them.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1,
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "fa-zhou-honorable-warrior": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "This character enters play with 2 damage.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 2,
        target: { type: "this" },
      }],
    }],
  },

  "scrooge-mcduck-reformed-ebenezer": {
    // Approximation: put a card under each other own character; grant Ward to those chars.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, put a card from the top of your deck facedown under each of your other characters. Those characters gain Ward until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [
        {
          type: "put_top_of_deck_under",
          target: { type: "chosen", filter: OWN_OTHER_CHARS },
        },
        {
          type: "grant_keyword", keyword: "ward",
          duration: "until_caster_next_turn",
          target: { type: "all", filter: OWN_OTHER_CHARS },
        },
      ],
    }],
  },

  // ── Quest triggers ────────────────────────────────────────────
  "pete-ghost-of-christmas-future": {
    // Approximation: look_at_top 1, one to hand.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, look at a card from the top of your deck. You may put it into your hand.",
      trigger: { on: "quests" },
      effects: [{
        type: "look_at_top", count: 1, action: "one_to_hand_rest_bottom",
        target: SELF,
      }],
    }],
  },

  "marshmallow-cranky-climber": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever this character quests, chosen opposing character can't ready at the start of their next turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "cant_action", action: "ready", duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  // ── Leaves/banished triggers ──────────────────────────────────
  "duke-weaselton-surly-crook": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When this character is banished, you may play a character with cost 2 or less for free.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "play_for_free", isMay: true,
        filter: { cardType: ["character"], maxCost: 2 },
      }],
    }],
  },

  "the-frozen-vine-monstrous-plant": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When this location is banished, if there was an exerted character here, return this card from your discard to your hand.",
      trigger: { on: "is_banished" },
      // Approximation: always return (drop exerted-char-here condition).
      effects: [{
        type: "return_to_hand",
        target: { type: "this" },
      }],
    }],
  },

  "goofy-ghost-of-jacob-marley": {
    // Approximation: each opponent discards 1.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When this character is banished, each opponent chooses and discards a card.",
      trigger: { on: "is_banished" },
      effects: [{ type: "discard_from_hand", amount: 1, target: OPP, chooser: "target_player" }],
    }],
  },

  // ── Static buffs / named-character gates ──────────────────────
  "tinker-bell-snowflake-collector": {
    abilities: [
      {
        type: "static",
        storyName: "",
        rulesText: "While you have 4 or more cards in your hand, this character gains Evasive.",
        effect: {
          type: "grant_keyword", keyword: "evasive",
          target: { type: "this" },
          condition: { type: "cards_in_hand_gte", amount: 4, player: SELF },
        },
      },
      {
        type: "static",
        storyName: "",
        rulesText: "While you have 7 or more cards in your hand, this character gets +3 {L}.",
        effect: {
          type: "modify_stat", stat: "lore", amount: 3,
          target: { type: "this" },
          condition: { type: "cards_in_hand_gte", amount: 7, player: SELF },
        },
      },
    ],
  },

  "beast-snowfield-troublemaker": {
    // Approximation: damage immunity in challenges if at a location.
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While at a location, this character takes no damage from challenges.",
      effect: {
        type: "damage_immunity_static", source: "challenge",
        target: { type: "this" },
        condition: { type: "this_at_location" },
      },
    }],
  },

  "elsa-ice-artisan": {
    abilities: [
      {
        type: "triggered",
        storyName: "",
        rulesText: "When you play this character, you may exert chosen character with 3 {S} or less.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "exert", isMay: true,
          target: { type: "chosen", filter: { ...ANY_CHAR, maxStrength: 3 } },
        }],
      },
      {
        type: "triggered",
        storyName: "",
        rulesText: "Whenever you play a location, you may exert chosen character with 3 {S} or less.",
        trigger: { on: "card_played", filter: { cardType: ["location"], owner: SELF } },
        effects: [{
          type: "exert", isMay: true,
          target: { type: "chosen", filter: { ...ANY_CHAR, maxStrength: 3 } },
        }],
      },
      {
        type: "static",
        storyName: "",
        rulesText: "While this character is at a location, she gets +3 {L}.",
        effect: {
          type: "modify_stat", stat: "lore", amount: 3,
          target: { type: "this" },
          condition: { type: "this_at_location" },
        },
      },
    ],
  },

  "game-preserve-protected-land": {
    abilities: [{
      type: "static",
      storyName: "",
      rulesText: "While there's a character with Evasive here, this location gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        // Approximation: always grant Evasive (drop has-evasive-char-here gate).
      },
    }],
  },

  "beasts-castle-winter-gardens": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever a character here challenges another character, gain 1 lore.",
      trigger: { on: "challenge_initiated" },
      // Approximation: any of your characters initiating a challenge yields the lore.
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "piglet-cocoa-maker": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "SPECIAL RECIPE At the end of your turn, remove up to 2 damage from each of your characters.",
      trigger: { on: "turn_end", player: SELF },
      effects: [{
        type: "remove_damage", amount: 2,
        target: { type: "all", filter: ALL_OWN_CHARS },
      }],
    }],
  },

  "meeko-skittish-scrounger": {
    // Approximation: at end of turn if exerted, choose and discard a card (drop banish branch).
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "BOTTOMLESS PIT At the end of your turn, if this character is exerted, choose and discard a card.",
      trigger: { on: "turn_end", player: SELF },
      condition: { type: "this_is_exerted" },
      effects: [{ type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" }],
    }],
  },

  "belle-snowfield-strategist": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever one of your characters is banished, you may put that card from your discard into your inkwell facedown and exerted.",
      trigger: { on: "banished_other", filter: { owner: SELF, cardType: ["character"] } },
      effects: [{
        type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "discard",
        target: { type: "triggering_card" },
      }],
    }],
  },

  "jiminy-cricket-ghost-of-christmas-past": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "Whenever you put a card under this character, you may put a card from your discard into your inkwell facedown and exerted.",
      trigger: { on: "card_put_under", filter: { owner: SELF } },
      effects: [{
        type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "discard",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard" } },
      }],
    }],
  },

  "darkwing-duck-darkwarrior": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "During your turn, whenever an item is banished, this character gains Resist +1 until the start of your next turn.",
      trigger: { on: "banished_other", filter: { cardType: ["item"] } },
      condition: { type: "is_your_turn" },
      effects: [{
        type: "grant_keyword", keyword: "resist", value: 1,
        duration: "until_caster_next_turn",
        target: { type: "this" },
      }],
    }],
  },

  "darkwing-duck-cool-under-pressure": {
    // Drop the 1 ink cost (no pay_ink in a triggered may effect); approximate as may deal 2.
    abilities: [
      {
        type: "triggered",
        storyName: "",
        rulesText: "During your turn, whenever an item is banished, you may deal 2 damage to chosen character.",
        trigger: { on: "banished_other", filter: { cardType: ["item"] } },
        condition: { type: "is_your_turn" },
        effects: [{
          type: "deal_damage", amount: 2, isMay: true,
          target: { type: "chosen", filter: ANY_CHAR },
        }],
      },
    ],
  },

  "launchpad-trusty-sidekick": {
    // Approximation: draw then always discard (drop Darkwing gate).
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, draw a card, then choose and discard a card.",
      trigger: { on: "enters_play" },
      effects: [
        { type: "draw", amount: 1, target: SELF },
        { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
      ],
    }],
  },

  // ── Items ─────────────────────────────────────────────────────
  "pot-of-honey": {
    abilities: [{
      type: "activated",
      storyName: "I'M STUCK!",
      rulesText: "Banish this item — Chosen exerted character can't ready at the start of their next turn.",
      costs: [{ type: "banish_self" }],
      effects: [{
        type: "cant_action", action: "ready", duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "mystical-inkcaster": {
    // Approximation: when item enters play, play character ≤5 for free with Rush, banish at end of turn.
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this item, play a character with cost 5 or less for free. They gain Rush. At the end of your turn, banish them.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "play_for_free",
        filter: { cardType: ["character"], maxCost: 5 },
        grantKeywords: ["rush"],
        banishAtEndOfTurn: true,
      }],
    }],
  },

  "darkwings-chair-set": {
    abilities: [
      {
        type: "triggered",
        storyName: "",
        rulesText: "When you play this item, you may put the top card of your deck into your inkwell facedown and exerted.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "deck",
          target: SELF,
        }],
      },
      {
        type: "activated",
        storyName: "",
        rulesText: "{E}, Banish this item — Remove up to 2 damage from chosen character.",
        costs: [{ type: "exert" }, { type: "banish_self" }],
        effects: [{
          type: "remove_damage", amount: 2,
          target: { type: "chosen", filter: ANY_CHAR },
        }],
      },
    ],
  },

  "lonely-grave": {
    abilities: [{
      type: "activated",
      storyName: "",
      rulesText: "{E}, Banish chosen character of yours — Put the top card of your deck facedown under one of your characters or locations with Boost.",
      costs: [
        { type: "exert" },
        { type: "banish_chosen", target: { type: "chosen", filter: ALL_OWN_CHARS } },
      ],
      effects: [{
        type: "put_top_of_deck_under",
        target: { type: "chosen", filter: { owner: SELF, zone: "play", hasKeyword: "boost" } },
      }],
    }],
  },

  "containment-unit": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this item, choose a character. They can't challenge or quest while this item is in play.",
      trigger: { on: "enters_play" },
      // Approximation: timed cant_quest + cant_challenge until caster next turn (not permanent).
      effects: [
        {
          type: "cant_action", action: "quest", duration: "until_caster_next_turn",
          target: { type: "chosen", filter: ANY_CHAR },
        },
      ],
    }],
  },

  // ── Actions ───────────────────────────────────────────────────
  "akood-et-emuti": {
    actionEffects: [
      { type: "grant_cost_reduction", amount: 2, filter: { cardType: ["character"] } },
      { type: "draw", amount: 1, target: SELF },
    ],
  },

  "come-out-and-fight": {
    // Approximation: drop "under" pile handling; just draw a card.
    actionEffects: [{ type: "draw", amount: 1, target: SELF }],
  },

  "colors-of-the-wind": {
    // Approximation: draw 1 (can't count distinct ink types from reveal).
    actionEffects: [{ type: "draw", amount: 1, target: SELF }],
  },

  "strike-a-good-match": {
    actionEffects: [
      { type: "draw", amount: 2, target: SELF },
      { type: "discard_from_hand", amount: 1, target: SELF, chooser: "target_player" },
    ],
  },

  "marching-off-to-battle": {
    actionEffects: [{
      type: "draw", amount: 2, target: SELF,
      condition: { type: "a_character_was_banished_in_challenge_this_turn" },
    }],
  },

  "the-cold-never-bothered-me": {
    actionEffects: [
      {
        type: "look_at_top", count: 4, action: "one_to_hand_rest_bottom",
        filter: { cardType: ["location"] },
        noMatchDestination: "discard" as any,
        target: SELF,
      },
      { type: "grant_cost_reduction", amount: 3, filter: { cardType: ["location"] } },
    ],
  },

  "visiting-christmas-past": {
    // Approximation: put 1 card from under into inkwell exerted. Cards-under isn't directly
    // ink-routable via existing primitives; drop-entry if unworkable.
    // Safer: skip. (Remove by leaving out — handled below.)
  },

  "let-it-go": {
    actionEffects: [{
      type: "move_to_inkwell", enterExerted: true, fromZone: "play",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "wipe-out": {
    actionEffects: [{
      type: "move_to_inkwell", enterExerted: true, fromZone: "play",
      target: {
        type: "chosen",
        filter: { zone: "play", cardType: ["character", "item"], hasKeyword: "bodyguard" } as any,
      },
    }],
  },

  "lets-get-dangerous": {
    // Approximation: draw 1 card (can't do "each player reveals top, play if character").
    actionEffects: [{ type: "draw", amount: 1, target: SELF }],
  },

  "battering-ram": {
    abilities: [
      {
        type: "triggered",
        storyName: "",
        rulesText: "Deal 1 damage to chosen damaged character.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "deal_damage", amount: 1,
          target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
        }],
      },
      {
        type: "activated",
        storyName: "",
        rulesText: "{E}, Banish this item — Banish chosen location.",
        costs: [{ type: "exert" }, { type: "banish_self" }],
        effects: [{
          type: "banish",
          target: { type: "chosen", filter: { zone: "play", cardType: ["location"] } },
        }],
      },
    ],
  },

  // ── Simple ETB damage / card quality ───────────────────────────
  "ling-snow-warrior": {
    abilities: [{
      type: "triggered",
      storyName: "",
      rulesText: "When you play this character, chosen character gets +1 {S} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  // roo-little-helper: skipped — "put self under" isn't a standard primitive, and
  // banish-self-on-ETB violates Layer 3 total-cards invariant.
};

// Drop entries with no content
for (const k of Object.keys(patches)) {
  const p = patches[k];
  if (!p.abilities && !p.actionEffects) delete patches[k];
}

// Bisect harness: if SET11_BISECT env is set, keep only listed ids.
const bisect = process.env.SET11_BISECT;
if (bisect) {
  const keep = new Set(bisect.split(","));
  for (const k of Object.keys(patches)) if (!keep.has(k)) delete patches[k];
}
// Temporarily drop card-loss suspects for bisection.
const DROP = process.env.SET11_DROP?.split(",") ?? [];
for (const id of DROP) delete patches[id];

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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 11.`);
if (missing.length) {
  console.log(`\nMISSING IDs:`);
  missing.forEach(m => console.log(`  - ${m}`));
}
