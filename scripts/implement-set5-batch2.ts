#!/usr/bin/env node
// Set 5 — Batch 2: remainder of fits-grammar cards after batch1.
// Continues to use existing engine primitives only. Approximations noted inline.
//
// Skipped (needs primitives we don't have / listed in DEFERRED_MECHANICS):
//   - chicha-dedicated-mother  (needs "second card inkwelled this turn" trigger)
//   - maximus-team-champion   (needs end-of-turn char-strength threshold condition)
//   - taffyta-muttonfudge-sour-speedster (needs moved_here once-per-turn trigger on owner)
//   - kronk-head-of-security   (plays-for-free from hand via trigger — see set4 kronk?)
//   - robin-hood-sharpshooter  (scry + conditional play-for-free from deck)
//   - robin-hood-sneaky-sleuth (+1 L per opposing damaged — dynamic stat per count)
//   - robin-hood-timely-contestant (self cost reduction per damage on opposing)
//   - food-fight               (grant activated ability to own chars this turn)
//   - seven-dwarfs-mine-secure-fortress (first-time-moved-here trigger)
//   - namaari-resolute-daughter (cost reduction per opponent banished in challenge this turn)
//   - merlin-turtle             (scry 2 top/bottom) — approximate as draw 1? skip, no scry prim
//   - the-sword-released        (complex conditional lore transfer at SoT)
//   - magica-de-spell-cruel-sorceress (replacement effect: "you don't discard") — skip
//   - blast-from-your-past      (name-a-card return-all)
//   - anna-diplomatic-queen     (choose one modal w/ pay 2 ink) — skip
//   - grumpy-skeptical-knight   ("while Knight of yours is at a location, that char gains Resist +2" — dynamic per-char)

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../packages/engine/src/cards/lorcast-set-005.json");

const CHAR = { zone: "play" as const, cardType: ["character" as const] };
const OPP_CHAR = { owner: { type: "opponent" as const }, zone: "play" as const, cardType: ["character" as const] };
const OWN_CHAR = { owner: { type: "self" as const }, zone: "play" as const, cardType: ["character" as const] };
const ITEM_OR_LOC = { zone: "play" as const, cardType: ["item" as const, "location" as const] };
const CHAR_ITEM_LOC_3 = { zone: "play" as const, cardType: ["character" as const, "item" as const, "location" as const], costAtMost: 3 };

const patches: Record<string, { abilities?: any[]; actionEffects?: any[] }> = {
  // ── Minnie Drum Major: shift ETB → tutor character top of deck ──────
  // Approximation: may search for a character and put it in hand (drops top-of-deck detail).
  "minnie-mouse-drum-major": {
    abilities: [{
      type: "triggered",
      storyName: "LET'S GO, ALREADY!",
      rulesText: "When you play this character, if you used Shift to play her, you may search your deck for a character card and reveal that card to all players. Shuffle your deck and put that card on top of it. (approximation: search to hand)",
      trigger: { on: "enters_play" },
      condition: { type: "triggering_card_played_via_shift" },
      effects: [{
        type: "tutor",
        isMay: true,
        filter: { cardType: ["character"], zone: "deck", owner: { type: "self" } },
      }],
    }],
  },

  // ── Maleficent Formidable Queen: per-Maleficent bounce chosen ≤3 ───
  // Approximation: single bounce (drops per-Maleficent repeat).
  "maleficent-formidable-queen": {
    abilities: [{
      type: "triggered",
      storyName: "DARK KNOWLEDGE",
      rulesText: "When you play this character, for each of your characters named Maleficent in play, return a chosen opposing character, item, or location with cost 3 or less to their player's hand. (approximation: single bounce)",
      trigger: { on: "enters_play" },
      effects: [{
        type: "return_to_hand",
        target: { type: "chosen", filter: { ...CHAR_ITEM_LOC_3, owner: { type: "opponent" } } },
      }],
    }],
  },

  // ── Bruni Fire Salamander: banished → may draw ─────────────────────
  "bruni-fire-salamander": {
    abilities: [{
      type: "triggered",
      storyName: "IT'S OKAY, BRUNI",
      rulesText: "When this character is banished, you may draw a card.",
      trigger: { on: "is_banished" },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // ── Anna Mystical Majesty: exert all opp chars ─────────────────────
  "anna-mystical-majesty": {
    abilities: [{
      type: "triggered",
      storyName: "WE NEED EACH OTHER",
      rulesText: "When you play this character, exert all opposing characters.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "all", filter: { ...OPP_CHAR } } }],
    }],
  },

  // ── Elsa The Fifth Spirit: exert chosen opp ────────────────────────
  "elsa-the-fifth-spirit": {
    abilities: [{
      type: "triggered",
      storyName: "POWER BEYOND MEASURE",
      rulesText: "When you play this character, exert chosen opposing character.",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "chosen", filter: { ...OPP_CHAR } } }],
    }],
  },

  // ── Rafiki Shaman Duelist: ETB self Challenger +4 this turn ────────
  "rafiki-shaman-duelist": {
    abilities: [{
      type: "triggered",
      storyName: "NEVER TOO OLD",
      rulesText: "When you play this character, he gains Challenger +4 this turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "challenger", value: 4,
        target: { type: "this" },
        duration: "end_of_turn",
      }],
    }],
  },

  // ── Shenzi Scar's Accomplice: while challenging damaged → +2 S ────
  // Approximation: Challenger +2 (fires on all challenges).
  "shenzi-scars-accomplice": {
    abilities: [{
      type: "static",
      storyName: "THIRSTY FOR POWER",
      rulesText: "While challenging a damaged character, this character gets +2 {S}. (approximation: Challenger +2)",
      effect: { type: "grant_keyword", keyword: "challenger", value: 2, target: { type: "this" } },
    }],
  },

  // ── Iago Fake Flamingo: quest → next action -2 I ───────────────────
  // Approximation: drops — no "next card reduction" primitive without extra state; skip.

  // ── Scar Vengeful Lion: own chars challenge damaged → may draw ─────
  // Approximation: any own challenge → may draw.
  "scar-vengeful-lion": {
    abilities: [{
      type: "triggered",
      storyName: "KINGS DON'T NEED ADVICE",
      rulesText: "Whenever one of your characters challenges a damaged character, you may draw a card. (approximation: any own challenge)",
      trigger: { on: "challenges", filter: { ...OWN_CHAR } },
      effects: [{ type: "draw", amount: 1, target: { type: "self" }, isMay: true }],
    }],
  },

  // ── Donald Duck Pie Slinger: shift ETB → each opp -2 lore; static +6 S while opp has 10+ lore ─
  // Approximation: drops the static +6 S (opponent-lore-threshold condition primitive).
  "donald-duck-pie-slinger": {
    abilities: [{
      type: "triggered",
      storyName: "HUMBLE PIE",
      rulesText: "When you play this character, if you used Shift to play him, each opponent loses 2 lore.",
      trigger: { on: "enters_play" },
      condition: { type: "triggering_card_played_via_shift" },
      effects: [{ type: "lose_lore", amount: 2, target: { type: "opponent" } }],
    }],
  },

  // ── Ratigan Party Crasher: your damaged characters get +2 S ────────
  "ratigan-party-crasher": {
    abilities: [{
      type: "static",
      storyName: "THIS IS MY KINGDOM",
      rulesText: "Your damaged characters get +2 {S}.",
      effect: {
        type: "modify_stat", stat: "strength", modifier: 2,
        target: { type: "all", filter: { ...OWN_CHAR, hasDamage: true } },
      },
    }],
  },

  // ── Vanellope Random Roster Racer: ETB → self gains Evasive until your next turn ─
  "vanellope-von-schweetz-random-roster-racer": {
    abilities: [{
      type: "triggered",
      storyName: "I'M THE BEST DRIVER IN THE WORLD",
      rulesText: "When you play this character, she gains Evasive until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "evasive",
        target: { type: "this" },
        duration: "until_caster_next_turn",
      }],
    }],
  },

  // ── The Queen Fairest of All: +1 L per other "The Queen" ───────────
  "the-queen-fairest-of-all": {
    abilities: [{
      type: "static",
      storyName: "REFLECTIONS OF VANITY",
      rulesText: "For each other character named The Queen you have in play, this character gets +1 {L}.",
      effect: {
        type: "modify_stat_per_count",
        stat: "lore",
        perCount: 1,
        countFilter: { ...OWN_CHAR, hasName: "The Queen", excludeSelf: true },
        target: { type: "this" },
      },
    }],
  },

  // ── Belle Of the Ball: ETB → your other chars gain Ward until your next turn ─
  "belle-of-the-ball": {
    abilities: [{
      type: "triggered",
      storyName: "WHAT A WONDERFUL NIGHT",
      rulesText: "When you play this character, your other characters gain Ward until the start of your next turn.",
      trigger: { on: "enters_play" },
      effects: [{
        type: "grant_keyword", keyword: "ward",
        target: { type: "all", filter: { ...OWN_CHAR, excludeSelf: true } },
        duration: "until_caster_next_turn",
      }],
    }],
  },

  // ── Merlin Intellectual Visionary: shift ETB → tutor any card ──────
  "merlin-intellectual-visionary": {
    abilities: [{
      type: "triggered",
      storyName: "SEEKER OF KNOWLEDGE",
      rulesText: "When you play this character, if you used Shift to play him, you may search your deck for any card, put that card into your hand, then shuffle your deck.",
      trigger: { on: "enters_play" },
      condition: { type: "triggering_card_played_via_shift" },
      effects: [{
        type: "tutor",
        isMay: true,
        filter: { zone: "deck", owner: { type: "self" } },
      }],
    }],
  },

  // ── Jafar Tyrannical Hypnotist: opp chars cost ≤4 can't challenge ──
  "jafar-tyrannical-hypnotist": {
    abilities: [{
      type: "static",
      storyName: "YOU WILL OBEY ME",
      rulesText: "Opposing characters with cost 4 or less can't challenge.",
      effect: {
        type: "action_restriction",
        restricts: "challenge",
        affectedPlayer: { type: "opponent" },
        filter: { ...OPP_CHAR, costAtMost: 4 },
      },
    }],
  },

  // ── Simba Son of Mufasa: ETB may banish chosen item or location ────
  "simba-son-of-mufasa": {
    abilities: [{
      type: "triggered",
      storyName: "I LAUGH IN THE FACE OF DANGER",
      rulesText: "When you play this character, you may banish chosen item or location.",
      trigger: { on: "enters_play" },
      effects: [{ type: "banish", isMay: true, target: { type: "chosen", filter: { ...ITEM_OR_LOC } } }],
    }],
  },

  // ── Arthur King Victorious: chosen gains Challenger +2, Resist +2 this turn ─
  // Drops "can challenge ready characters" (would need new primitive for timed).
  "arthur-king-victorious": {
    abilities: [{
      type: "triggered",
      storyName: "EXCALIBUR",
      rulesText: "When you play this character, chosen character gains Challenger +2 and Resist +2 this turn. (approximation: drops can-challenge-ready branch)",
      trigger: { on: "enters_play" },
      effects: [
        { type: "grant_keyword", keyword: "challenger", value: 2, target: { type: "chosen", filter: { ...CHAR } }, duration: "end_of_turn" },
        { type: "grant_keyword", keyword: "resist", value: 2, target: { type: "chosen", filter: { ...CHAR } }, duration: "end_of_turn" },
      ],
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
console.log(`\nPatched ${patched} card entries (${seen.size} unique ids) in set 5.`);
