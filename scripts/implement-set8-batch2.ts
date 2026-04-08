#!/usr/bin/env node
// Set 8 — Batch 2: More ETBs, quest triggers, statics, songs, items, actions.
// False positives / skipped inline:
//   - goofy-groundbreaking-chef: per-character ready+heal loop — needs heal-then-ready per-target, skipped
//   - antonio-madrigal-friend-to-all: search deck oncePerTurn on sings — skipped
//   - alma-madrigal: oncePerTurn ready-all-singers on sings — skipped (multi-singer target unsupported)
//   - bruno-madrigal-singing-seer: draw-per-char on sings — needs dynamic count
//   - dalmatian-puppy-tail-wagger: deck-construction rule — no engine effect
//   - lady-family-dog: play-a-char-for-free from hand gated by cost — skipped (needs cost-filtered play)
//   - perdita-determined-mother / rolly: put discard cards to inkwell — skipped (no primitive)
//   - candy-drift: end-of-turn self-banish follow-up — skipped (mixes effect durations)
//   - pinocchio-strings-attached: oncePerTurn on ready-self — skipped (no ready-self trigger)
//   - monstro-infamous-whale: activated ability with followUp — ok wire it
//   - jafar-high-sultan-of-lorcana: discard-check branch — skipped
//   - mother-gothel-knows-whats-best: sequential deal-damage-to-own-char for buff — skipped (complex cost)
//   - lilo-causing-an-uproar: alt cost by action-count — skipped
//   - ratigan-greedy-genius: "didn't ink this turn" condition — skipped
//   - namaari: start-of-turn rummage + stat-per-discard — skipped
//   - wreck-it-ralph-big-lug: return-from-discard then gain lore on success — partial approx
//   - kuzco-impulsive-llama: each-opponent bottom-of-deck — skipped
//   - yzma-on-edge: search-deck by name conditional — skipped
//   - madam-mim-rhino: self-banish-or-return modal — skipped (modal)
//   - stopped-chaos / beyond-the-horizon / fantastical-and-magical / it-means-no-worries / into-the-unknown / heads-held-high: Sing Together — OK, singTogetherCost already set; wire actionEffects
//   - anna-magical-mission: named-Elsa condition — skipped
//   - hiro-hamada: ready-chosen-floodborn simple — wire
//   - go-go-tomago-cutting-edge: "if you used shift" — skipped (no shift-context condition)
//   - honey-lemon: "if shift" — skipped
//   - chem-purse: "if shift" — skipped
//   - go-go-tomago-mech-engineer: "shift onto this" trigger — skipped
//   - gadget-hackwrench: "if opponent has more cards" — condition missing
//   - tiana-natural-talent: on-song stat-debuff until next — wire
//   - rhino-one-sixteenth-wolf: ETB stat debuff until next — wire
//   - darling-dear: ETB +lore this turn — wire
//   - perdita-on-the-lookout: while-puppy +W static — wire
//   - colonel-old-sheepdog: 3+ puppies → +S +L — wire
//   - pua-protective-pig: banished may draw — wire
//   - tramp-dapper-rascal: during-opp-turn char-banished draw — wire
//   - kaa-hypnotizing-python: quest → opp -2S & reckless until next — wire
//   - king-candy-sugar-rush-nightmare: banished → return racer from discard — wire
//   - bolt-down-but-not-out: enters-exerted — wire via exert on enters_play
//   - rhino-power-hamster: no-damage → Resist +2 — wire
//   - antonios-jaguar: ETB cond on named Antonio Madrigal — wire
//   - calhoun-hard-nosed-leader: banished → gain 1 lore — wire
//   - lady-decisive-dog: card_played buff + stat-threshold lore — only wire first; skip threshold
//   - joey-blue-pigeon: quest → heal-all own Bodyguard — wire
//   - donald-duck-coin-collector: grant activated ability this turn — skipped
//   - louie-one-cool-duck: "being challenged" static on challenger — skipped (no challenger-of-this condition)
//   - huey-reliable-leader: quest → cost reduction char — wire
//   - minnie-daring-defender: per-self-damage stat — wire (countSelfDamage)
//   - mirabel-curious-child: reveal song → gain lore — skipped (reveal needed)
//   - gene-niceland-resident: quest → heal chosen — wire
//   - aladdin-vigilant-guard: on own Ally quests, heal self — wire
//   - roquefort-lock-expert: quest → put item into its player's inkwell — wire move_to_inkwell
//   - geppetto-skilled-craftsman: quest → discard items for lore — skipped (dynamic)
//   - sir-pellinore: quest → grant Support this turn — wire
//   - thumper-young-bunny: action give +3S (stat ambiguous; skip) — skip
//   - mushu-fast-talking-dragon: action give Rush — wire
//   - mushu-your-worst-nightmare: play-another-char → triple keyword this turn — wire
//   - gaston-arrogant-showoff: ETB banish own item for +2S buff — skipped (sequential cost)
//   - mrs-potts: activated banish own item → draw — wire
//   - the-wardrobe: activated exert+discard-item → draw 2 — wire
//   - lefou-cake-thief: activated exert+banish-item → lose/gain lore — wire
//   - lumiere-fired-up: own-item-banished → +1L this turn on self — wire
//   - mulan-charging-ahead: dur your turn Evasive + challenge-ready — wire first half
//   - faline-playful-fawn: conditional +2L based on S-compare — skipped
//   - light-the-fuse: damage = #exerted — skipped (dynamic)
//   - lena-sabrewing-pure-energy: action-body "Deal 1 damage" — wire as ETB (actions wire as actionEffects but this is a character action-like text, likely an activated/ETB) — skip, unclear
//   - madame-medusa: sequential self-damage → return — skipped
//   - hades-ruthless-tyrant: sequential self-damage → draw 2 — skipped
//   - bruno-madrigal-single-minded: ETB → opp can't ready next turn — wire
//   - royal-guard-octopus-soldier: draw → +1 Challenger this turn — wire (damage_drawn? use "card_drawn")
//   - kuzco-bored-royal: ETB return cost 2 or less (char/item/loc) — wire
//   - megara-part-of-the-plan: while Hades → Challenger +2 — wire
//   - yelana-northuldra-leader: ETB Challenger +2 this turn — wire
//   - elsa-fierce-protector: activated ink+discard → exert — wire
//   - bambi-little-prince: ETB +1 lore; on opp plays char return to hand — wire both
//   - nero-fearsome-crocodile: activated move damage self → opp — wire
//   - magica-de-spell-shadow-form: ETB return own char to hand → draw — skipped (sequential cost)
//   - archimedes: ETB banish item + item-banished→rummage — wire both
//   - walk-the-plank: grant activated "exert→banish damaged" this turn — skipped
//   - jeweled-collar: on being-challenged put top of deck to inkwell — wire
//   - forest-duel: your chars gain Challenger +2 this turn + trigger — wire challenger part
//   - pull-the-lever: modal — skipped
//   - into-the-unknown: put chosen exerted into own inkwell — wire (move_to_inkwell from play)
//   - everybodys-got-a-weakness: move-damage-per-character dynamic — skipped
//   - scarab: activated pay ink, return Illusion from discard — wire
//   - ice-spikes: on play exert opp char; activated? — wire play effect only
//   - fred-giant-sized: quest → reveal-until-floodborn — skipped (deck search by floodborn)
//   - don-karnage: action-not-song → reckless next turn — wire (card_played trigger)
//   - desperate-plan: hand-empty branch — skipped
//   - hamster-ball: char w/ no damage Resist+2 until next — wire
//   - atlantean-crystal: Resist+2 & Support until next — wire
//   - belles-favorite-book: activated banish own other item → ink top — wire
//   - television-set: reveal top; if Puppy draw; else bottom — skipped
//   - only-so-much-room: return char 2S or less to hand + return item from discard — wire (chars only, skip discard-return)
//   - trials-and-tribulations: chosen char -4S until next — wire
//   - the-nephews-piggy-bank: play effect -1S opp until next — wire
//   - chaca-junior-chipmunk: named cond ETB — skipped
//   - palace-guard-spectral-sentry: Vanish keyword — already handled by import
//   - mad-dog-karnages: if Don Karnage in play, cost -1 — skipped (self-cost-reduction)
//   - she's-your-person: modal — skipped
//   - captain-hook-pirate-king: oncePerTurn opp-damaged buff-pirates — skipped
//   - tinker-bell-insistent-fairy: you-play-5S-char → exert for lore — skipped (sequential exert-triggered cost)
//   - flower-shy-skunk: look top, top-or-bottom — skipped (scry-to-bottom)
//   - flynn-rider-breaking: inverse-sequential — skipped (deferred)
//   - maui-stubborn-trickster: modal banished — skipped
//   - jock-attentive-uncle: already in batch1

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-008.json");

const SELF = { type: "self" as const };
const OPP = { type: "opponent" as const };
const ALL_OWN_CHARS = { owner: SELF, zone: "play" as const, cardType: ["character" as const] };
const ALL_OPP_CHARS = { owner: OPP, zone: "play" as const, cardType: ["character" as const] };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OWN_OTHER_CHARS = { ...ALL_OWN_CHARS, excludeSelf: true };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {

  // ── Simple ETBs ─────────────────────────────────────────────
  "tiana-natural-talent": {
    abilities: [{
      type: "triggered",
      storyName: "SONG OF STRENGTH",
      rulesText: "Whenever you play a song, each opposing character gets -1 {S} until the start of your next turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF, hasTrait: "Song" } },
      effects: [{
        type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
        target: { type: "all", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "rhino-one-sixteenth-wolf": {
    abilities: [{
      type: "triggered",
      storyName: "HOWL",
      rulesText: "When you play this character, chosen opposing character gets -1 {S} until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "darling-dear-beloved-wife": {
    abilities: [{
      type: "triggered",
      storyName: "DEAR DARLING",
      rulesText: "When you play this character, chosen character gets +2 {L} this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "gain_stats", lore: 2, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "pua-protective-pig": {
    abilities: [{
      type: "triggered",
      storyName: "BRAVE LITTLE PIG",
      rulesText: "When this character is banished, you may draw a card.",
      trigger: { on: "is_banished" },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "calhoun-hard-nosed-leader": {
    abilities: [{
      type: "triggered",
      storyName: "LAST STAND",
      rulesText: "When this character is banished, gain 1 lore.",
      trigger: { on: "is_banished" },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "king-candy-sugar-rush-nightmare": {
    abilities: [{
      type: "triggered",
      storyName: "GAME OVER",
      rulesText: "When this character is banished, you may return another Racer character card from your discard to your hand.",
      trigger: { on: "is_banished" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Racer" } },
      }],
    }],
  },

  "bolt-down-but-not-out": {
    abilities: [{
      type: "triggered",
      storyName: "ENTERS EXERTED",
      rulesText: "This character enters play exerted.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "this" } }],
    }],
  },

  "antonios-jaguar-faithful-companion": {
    abilities: [{
      type: "triggered",
      storyName: "FRIEND OF ANTONIO",
      rulesText: "When you play this character, if you have a character named Antonio Madrigal in play, gain 1 lore.",
      trigger: { on: "enters_play" },
      condition: {
        type: "you_control_matching",
        filter: { ...ALL_OWN_CHARS, name: "Antonio Madrigal" },
      },
      effects: [{ type: "gain_lore", amount: 1, target: SELF }],
    }],
  },

  "bruno-madrigal-single-minded": {
    abilities: [{
      type: "triggered",
      storyName: "FOCUSED",
      rulesText: "When you play this character, chosen opposing character can't ready at the start of their next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "cant_action", action: "ready",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "kuzco-bored-royal": {
    abilities: [{
      type: "triggered",
      storyName: "BORED ROYAL",
      rulesText: "When you play this character, you may return chosen character, item, or location with cost 2 or less to their player's hand.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand", isMay: true,
        target: { type: "chosen", filter: { zone: "play", cardType: ["character", "item", "location"], maxCost: 2 } },
      }],
    }],
  },

  "yelana-northuldra-leader": {
    abilities: [{
      type: "triggered",
      storyName: "RALLY",
      rulesText: "When you play this character, chosen character gains Challenger +2 this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "challenger", keywordValue: 2, duration: "this_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "stitch-experiment-626": {
    abilities: [{
      type: "triggered",
      storyName: "EXPERIMENT",
      rulesText: "When you play this character, each opponent puts the top card of their deck into their inkwell facedown and exerted.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        target: OPP,
      }],
    }],
  },

  "hiro-hamada-intuitive-thinker": {
    abilities: [{
      type: "triggered",
      storyName: "READY UP",
      rulesText: "Ready chosen Floodborn character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "ready",
        target: { type: "chosen", filter: { ...ANY_CHAR, hasTrait: "Floodborn" } },
      }],
    }],
  },

  "lena-sabrewing-pure-energy": {
    abilities: [{
      type: "triggered",
      storyName: "BOLT",
      rulesText: "Deal 1 damage to chosen character.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "deal_damage", amount: 1,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "bambi-little-prince": {
    abilities: [
      {
        type: "triggered",
        storyName: "BORN PRINCE",
        rulesText: "When you play this character, gain 1 lore.",
        trigger: { on: "enters_play" },
        effects: [{ type: "gain_lore", amount: 1, target: SELF }],
      },
      {
        type: "triggered",
        storyName: "SPOOKED",
        rulesText: "When an opponent plays a character, return this character to your hand.",
        trigger: { on: "card_played", filter: { cardType: ["character"], owner: OPP } },
        effects: [{ type: "return_to_hand", target: { type: "this" } }],
      },
    ],
  },

  // ── Quest triggers ─────────────────────────────────────────
  "huey-reliable-leader": {
    abilities: [{
      type: "triggered",
      storyName: "ORGANIZED",
      rulesText: "Whenever this character quests, you pay 1 {I} less for the next character you play this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_cost_reduction", amount: 1, filter: { cardType: ["character"] },
      }],
    }],
  },

  "gene-niceland-resident": {
    abilities: [{
      type: "triggered",
      storyName: "HELPING HAND",
      rulesText: "Whenever this character quests, you may remove up to 2 damage from chosen character.",
      trigger: { on: "quests" },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "chosen", filter: ANY_CHAR },
      }],
    }],
  },

  "joey-blue-pigeon": {
    abilities: [{
      type: "triggered",
      storyName: "FLOCK HEALER",
      rulesText: "Whenever this character quests, you may remove up to 1 damage from each of your characters with Bodyguard.",
      trigger: { on: "quests" },
      effects: [{
        type: "remove_damage", amount: 1, isUpTo: true, isMay: true,
        target: { type: "all", filter: { ...ALL_OWN_CHARS, hasKeyword: "bodyguard" } },
      }],
    }],
  },

  "kaa-hypnotizing-python": {
    abilities: [{
      type: "triggered",
      storyName: "HYPNOTIZE",
      rulesText: "Whenever this character quests, chosen opposing character gets -2 {S} and gains Reckless until the start of your next turn.",
      trigger: { on: "quests" },
      effects: [
        {
          type: "gain_stats", strength: -2, duration: "until_caster_next_turn",
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        },
        {
          type: "grant_keyword", keyword: "reckless",
          duration: "end_of_owner_next_turn",
          target: { type: "chosen", filter: ALL_OPP_CHARS },
        },
      ],
    }],
  },

  "sir-pellinore-seasoned-knight": {
    abilities: [{
      type: "triggered",
      storyName: "LEAD BY EXAMPLE",
      rulesText: "Whenever this character quests, your other characters gain Support this turn.",
      trigger: { on: "quests" },
      effects: [{
        type: "grant_keyword", keyword: "support", duration: "this_turn",
        target: { type: "all", filter: OWN_OTHER_CHARS },
      }],
    }],
  },

  "aladdin-vigilant-guard": {
    abilities: [{
      type: "triggered",
      storyName: "WATCHFUL",
      rulesText: "Whenever one of your Ally characters quests, you may remove up to 2 damage from this character.",
      trigger: { on: "quests", filter: { ...ALL_OWN_CHARS, hasTrait: "Ally" } },
      effects: [{
        type: "remove_damage", amount: 2, isUpTo: true, isMay: true,
        target: { type: "this" },
      }],
    }],
  },

  "roquefort-lock-expert": {
    abilities: [{
      type: "triggered",
      storyName: "PICK THE LOCK",
      rulesText: "Whenever this character quests, you may put chosen item into its player's inkwell facedown and exerted.",
      trigger: { on: "quests" },
      effects: [{
        type: "move_to_inkwell", isMay: true, enterExerted: true, fromZone: "play",
        target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      }],
    }],
  },

  "wreck-it-ralph-big-lug": {
    abilities: [
      {
        type: "triggered",
        storyName: "BIG LUG",
        rulesText: "When you play this character, you may return a Racer character card with cost 6 or less from your discard to your hand.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "return_to_hand", isMay: true,
          target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Racer", maxCost: 6 } },
        }],
      },
      {
        type: "triggered",
        storyName: "BIG LUG",
        rulesText: "Whenever he quests, you may return a Racer character card with cost 6 or less from your discard to your hand.",
        trigger: { on: "quests" },
        effects: [{
          type: "return_to_hand", isMay: true,
          target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Racer", maxCost: 6 } },
        }],
      },
    ],
  },

  // ── Statics ─────────────────────────────────────────────────
  "minnie-mouse-daring-defender": {
    abilities: [{
      type: "static",
      storyName: "GETTING STRONGER",
      rulesText: "This character gets +1 {S} for each 1 damage on her.",
      effect: {
        type: "modify_stat_per_count", stat: "strength", perCount: 1,
        countSelfDamage: true,
        target: { type: "this" },
      },
    }],
  },

  "perdita-on-the-lookout": {
    abilities: [{
      type: "static",
      storyName: "WATCHFUL",
      rulesText: "While you have a Puppy character in play, this character gets +1 {W}.",
      effect: {
        type: "gain_stats", willpower: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, hasTrait: "Puppy" },
        },
      },
    }],
  },

  "the-colonel-old-sheepdog": {
    abilities: [{
      type: "static",
      storyName: "SHEPHERD",
      rulesText: "While you have 3 or more Puppy characters in play, this character gets +2 {S} and +2 {L}.",
      effect: {
        type: "gain_stats", strength: 2, lore: 2,
        target: { type: "this" },
        condition: {
          type: "cards_in_zone_gte", amount: 3, zone: "play", owner: SELF,
          filter: { cardType: ["character"], hasTrait: "Puppy" },
        },
      },
    }],
  },

  "patch-playful-pup": {
    abilities: [{
      type: "static",
      storyName: "PLAYFUL",
      rulesText: "While you have another Puppy character in play, this character gets +1 {L}.",
      effect: {
        type: "gain_stats", lore: 1,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...OWN_OTHER_CHARS, hasTrait: "Puppy" },
        },
      },
    }],
  },

  "pluto-tried-and-true": {
    abilities: [
      {
        type: "static",
        storyName: "LOYAL",
        rulesText: "While this character has no damage, he gets +2 {S} and gains Support.",
        effect: {
          type: "gain_stats", strength: 2,
          target: { type: "this" },
          condition: { type: "this_has_no_damage" },
        },
      },
      {
        type: "static",
        storyName: "LOYAL",
        rulesText: "While this character has no damage, he gains Support.",
        effect: {
          type: "grant_keyword", keyword: "support",
          target: { type: "this" },
          condition: { type: "this_has_no_damage" },
        },
      },
    ],
  },

  "rhino-power-hamster": {
    abilities: [{
      type: "static",
      storyName: "HAMSTER BALL",
      rulesText: "While this character has no damage, he gains Resist +2.",
      effect: {
        type: "grant_keyword", keyword: "resist", keywordValue: 2,
        target: { type: "this" },
        condition: { type: "this_has_no_damage" },
      },
    }],
  },

  "megara-part-of-the-plan": {
    abilities: [{
      type: "static",
      storyName: "PART OF THE PLAN",
      rulesText: "While you have a character named Hades in play, this character gains Challenger +2.",
      effect: {
        type: "grant_keyword", keyword: "challenger", keywordValue: 2,
        target: { type: "this" },
        condition: {
          type: "you_control_matching",
          filter: { ...ALL_OWN_CHARS, name: "Hades" },
        },
      },
    }],
  },

  "mulan-charging-ahead": {
    abilities: [{
      type: "static",
      storyName: "CHARGING AHEAD",
      rulesText: "During your turn, this character gains Evasive.",
      effect: {
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        condition: { type: "is_your_turn" },
      },
    }],
  },

  // ── Banish / challenge triggers ─────────────────────────────
  "tramp-dapper-rascal": {
    abilities: [{
      type: "triggered",
      storyName: "STREET SMART",
      rulesText: "During an opponent's turn, whenever one of your characters is banished, you may draw a card.",
      trigger: { on: "banished_other", filter: ALL_OWN_CHARS },
      condition: { type: "compound_not", inner: { type: "is_your_turn" } },
      effects: [{ type: "draw", amount: 1, isMay: true, target: SELF }],
    }],
  },

  "lady-decisive-dog": {
    abilities: [{
      type: "triggered",
      storyName: "DECISIVE",
      rulesText: "Whenever you play a character, this character gets +1 {S} this turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF } },
      effects: [{
        type: "gain_stats", strength: 1, duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "mushu-your-worst-nightmare": {
    abilities: [{
      type: "triggered",
      storyName: "NIGHTMARE FUEL",
      rulesText: "Whenever you play another character, they gain Rush, Reckless, and Evasive this turn.",
      trigger: { on: "card_played", filter: { cardType: ["character"], owner: SELF, excludeSelf: true } },
      effects: [
        { type: "grant_keyword", keyword: "rush", duration: "this_turn", target: { type: "triggering_card" } },
        { type: "grant_keyword", keyword: "reckless", duration: "this_turn", target: { type: "triggering_card" } },
        { type: "grant_keyword", keyword: "evasive", duration: "this_turn", target: { type: "triggering_card" } },
      ],
    }],
  },

  "royal-guard-octopus-soldier": {
    abilities: [{
      type: "triggered",
      storyName: "DRAWN TO ARMS",
      rulesText: "Whenever you draw a card, this character gains Challenger +1 this turn.",
      trigger: { on: "card_drawn", filter: { owner: SELF } },
      effects: [{
        type: "grant_keyword", keyword: "challenger", keywordValue: 1, duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "don-karnage-air-pirate-leader": {
    abilities: [{
      type: "triggered",
      storyName: "SWORD IN HAND",
      rulesText: "Whenever you play an action that isn't a song, chosen opposing character gains Reckless during their next turn.",
      trigger: { on: "card_played", filter: { cardType: ["action"], owner: SELF, hasNoTrait: "Song" } },
      effects: [{
        type: "grant_keyword", keyword: "reckless",
        duration: "end_of_owner_next_turn",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "lumiere-fired-up": {
    abilities: [{
      type: "triggered",
      storyName: "FIRED UP",
      rulesText: "Whenever one of your items is banished, this character gets +1 {L} this turn.",
      trigger: { on: "is_banished", filter: { owner: SELF, cardType: ["item"] } },
      effects: [{
        type: "gain_stats", lore: 1, duration: "this_turn",
        target: { type: "this" },
      }],
    }],
  },

  "archimedes-resourceful-owl": {
    abilities: [
      {
        type: "triggered",
        storyName: "SMASH THAT THING",
        rulesText: "When you play this character, you may banish chosen item.",
        trigger: { on: "enters_play" },
        effects: [{
          type: "banish", isMay: true,
          target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
        }],
      },
      {
        type: "triggered",
        storyName: "LESSON LEARNED",
        rulesText: "During your turn, whenever an item is banished, you may draw a card, then choose and discard a card.",
        trigger: { on: "is_banished", filter: { cardType: ["item"] } },
        condition: { type: "is_your_turn" },
        effects: [
          { type: "draw", amount: 1, isMay: true, target: SELF },
          { type: "discard_from_hand", amount: 1, target: SELF },
        ],
      },
    ],
  },

  // ── Activated abilities ─────────────────────────────────────
  "mrs-potts-head-housekeeper": {
    abilities: [{
      type: "activated",
      storyName: "BREAK IT DOWN",
      rulesText: "{E}, Banish one of your items — Draw a card.",
      costEffects: [
        { type: "exert", target: { type: "this" } },
        { type: "banish", target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } } },
      ],
      rewardEffects: [{ type: "draw", amount: 1, target: SELF }],
    }],
  },

  "the-wardrobe-perceptive-friend": {
    abilities: [{
      type: "activated",
      storyName: "OPEN WARDROBE",
      rulesText: "{E}, Choose and discard an item card — Draw 2 cards.",
      costEffects: [
        { type: "exert", target: { type: "this" } },
        { type: "discard_from_hand", amount: 1, target: SELF, filter: { cardType: ["item"] } },
      ],
      rewardEffects: [{ type: "draw", amount: 2, target: SELF }],
    }],
  },

  "lefou-cake-thief": {
    abilities: [{
      type: "activated",
      storyName: "SNEAK SNACK",
      rulesText: "{E}, Banish one of your items — Chosen opponent loses 1 lore and you gain 1 lore.",
      costEffects: [
        { type: "exert", target: { type: "this" } },
        { type: "banish", target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"] } } },
      ],
      rewardEffects: [
        { type: "lose_lore", amount: 1, target: OPP },
        { type: "gain_lore", amount: 1, target: SELF },
      ],
    }],
  },

  "elsa-fierce-protector": {
    abilities: [{
      type: "activated",
      storyName: "ICE OVER",
      rulesText: "1 {I}, Choose and discard a card — Exert chosen opposing character.",
      costEffects: [
        { type: "pay_ink", amount: 1 },
        { type: "discard_from_hand", amount: 1, target: SELF },
      ],
      rewardEffects: [{
        type: "exert",
        target: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "nero-fearsome-crocodile": {
    abilities: [{
      type: "activated",
      storyName: "SPLASH",
      rulesText: "Move 1 damage counter from this character to chosen opposing character.",
      costEffects: [{ type: "exert", target: { type: "this" } }],
      rewardEffects: [{
        type: "move_damage", amount: 1,
        from: { type: "this" },
        to: { type: "chosen", filter: ALL_OPP_CHARS },
      }],
    }],
  },

  "monstro-infamous-whale": {
    abilities: [{
      type: "activated",
      storyName: "FULL BREACH",
      rulesText: "Choose and discard a card — Ready this character. He can't quest for the rest of this turn.",
      costEffects: [{ type: "discard_from_hand", amount: 1, target: SELF }],
      rewardEffects: [{
        type: "ready", target: { type: "this" },
        followUpEffects: [{
          type: "cant_action", action: "quest",
          duration: "this_turn",
          target: { type: "this" },
        }],
      }],
    }],
  },

  "scarab": {
    abilities: [{
      type: "activated",
      storyName: "SCARAB POWER",
      rulesText: "{E} 2 {I} — Return an Illusion character card from your discard to your hand.",
      costEffects: [
        { type: "exert", target: { type: "this" } },
        { type: "pay_ink", amount: 2 },
      ],
      rewardEffects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"], hasTrait: "Illusion" } },
      }],
    }],
  },

  "belles-favorite-book": {
    abilities: [{
      type: "activated",
      storyName: "READ",
      rulesText: "{E}, Banish one of your other items — Put the top card of your deck into your inkwell facedown and exerted.",
      costEffects: [
        { type: "exert", target: { type: "this" } },
        { type: "banish", target: { type: "chosen", filter: { owner: SELF, zone: "play", cardType: ["item"], excludeSelf: true } } },
      ],
      rewardEffects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        target: SELF,
      }],
    }],
  },

  // ── Items (play effects / triggered) ────────────────────────
  "the-nephews-piggy-bank": {
    actionEffects: [{
      type: "gain_stats", strength: -1, duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "ice-spikes": {
    actionEffects: [{
      type: "exert",
      target: { type: "chosen", filter: ALL_OPP_CHARS },
    }],
  },

  "hamster-ball": {
    actionEffects: [{
      type: "grant_keyword", keyword: "resist", keywordValue: 2,
      duration: "until_caster_next_turn",
      target: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: false } },
    }],
  },

  "atlantean-crystal": {
    actionEffects: [
      {
        type: "grant_keyword", keyword: "resist", keywordValue: 2,
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
      {
        type: "grant_keyword", keyword: "support",
        duration: "until_caster_next_turn",
        target: { type: "chosen", filter: ANY_CHAR },
      },
    ],
  },

  "jeweled-collar": {
    abilities: [{
      type: "triggered",
      storyName: "PROTECTIVE COLLAR",
      rulesText: "Whenever one of your characters is challenged, you may put the top card of your deck into your inkwell facedown and exerted.",
      trigger: { on: "is_challenged", filter: ALL_OWN_CHARS },
      effects: [{
        type: "reveal_top_conditional", filter: {}, matchAction: "to_inkwell_exerted",
        isMay: true, target: SELF,
      }],
    }],
  },

  // ── Songs / Actions ─────────────────────────────────────────
  "mushu-fast-talking-dragon": {
    actionEffects: [{
      type: "grant_keyword", keyword: "rush", duration: "this_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "trials-and-tribulations": {
    actionEffects: [{
      type: "gain_stats", strength: -4, duration: "until_caster_next_turn",
      target: { type: "chosen", filter: ANY_CHAR },
    }],
  },

  "only-so-much-room": {
    actionEffects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { ...ANY_CHAR, maxStrength: 2 } },
      },
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: SELF, zone: "discard", cardType: ["character"] } },
      },
    ],
  },

  "into-the-unknown": {
    actionEffects: [{
      type: "move_to_inkwell", enterExerted: true, fromZone: "play",
      target: { type: "chosen", filter: { ...ANY_CHAR, isExerted: true } },
    }],
  },

  "forest-duel": {
    actionEffects: [{
      type: "grant_keyword", keyword: "challenger", keywordValue: 2, duration: "this_turn",
      target: { type: "all", filter: ALL_OWN_CHARS },
    }],
  },

};

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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 8.`);
