#!/usr/bin/env node
// =============================================================================
// CARD COMPILER — INVERSE OF scripts/decompile-cards.ts
// -----------------------------------------------------------------------------
// Reads a card's rulesText and synthesizes a draft abilities[]/actionEffects[]
// JSON structure by running a set of regex-based matchers that invert the
// forward decompiler's pattern tables. Purpose: produce first-pass JSON for
// new sets so a human reviewer only has to fix the tail, not hand-wire every
// card from scratch.
//
// Deterministic, no LLM — if oracle wording changes, a matcher here needs an
// edit (same as the forward decompiler), which is the intended source of
// truth for grammar drift.
//
// Usage:
//   pnpm compile-cards                   # baseline report over sets 1-11
//   pnpm compile-cards --set 012         # propose JSON for one set
//   pnpm compile-cards --card "Genie"    # single card, verbose
//   pnpm compile-cards --unmatched       # surface top N unparsed phrases
//
// Validation strategy:
//   1. For sets 1-11, we have ground-truth JSON. Compile rulesText → draft,
//      then deep-compare draft to hand-wired JSON (normalized).
//   2. Round-trip: render draft via decompile-cards' renderer, F1 vs oracle.
//   3. Unmatched phrases are the grammar gap — they're the next patterns to
//      add.
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type Json = Record<string, any>;

interface CardJSON {
  id: string;
  fullName: string;
  setId: string;
  number: number;
  cardType: string;
  traits?: string[];
  cost: number;
  rulesText?: string;
  abilities?: Json[];
  actionEffects?: Json[];
  _namedAbilityStubs?: Array<{ storyName?: string; rulesText: string; raw?: string }>;
}

// =============================================================================
// MATCHER FRAMEWORK
// -----------------------------------------------------------------------------
// A matcher is (regex, build). `regex` must be anchored at start (via `^`) and
// may consume trailing whitespace/punctuation via an explicit lookahead or by
// returning the consumed length in m[0]. `build` produces the JSON fragment.
// Matchers are tried in order — put specific patterns before general ones.
// =============================================================================

type MatchFn<T> = (text: string) => { json: T; consumed: number } | null;

interface Matcher<T> {
  name: string;
  pattern: RegExp;
  build: (m: RegExpExecArray) => T;
}

function makeMatcher<T>(list: Matcher<T>[]): MatchFn<T> {
  return (text: string) => {
    for (const m of list) {
      m.pattern.lastIndex = 0;
      const match = m.pattern.exec(text);
      if (match && match.index === 0) {
        return { json: m.build(match), consumed: match[0].length };
      }
    }
    return null;
  };
}

// =============================================================================
// TRIGGER MATCHERS — invert decompile-cards.ts TRIGGER_RENDERERS.
// -----------------------------------------------------------------------------
// Each pattern matches just the trigger clause (no trailing comma/body). The
// `build` output is the `trigger` field value (i.e. { on: "...", ... }).
// =============================================================================

const TRIGGER_MATCHERS: Matcher<Json>[] = [
  // enters_play
  {
    name: "enters_play",
    pattern: /^When you play this (?:character|item|location)/i,
    build: () => ({ on: "enters_play" }),
  },
  // quests — owner:self flavor ("Whenever one of your characters quests")
  {
    name: "quests_owner_self",
    pattern: /^Whenever one of your characters quests/i,
    build: () => ({ on: "quests", filter: { owner: { type: "self" } } }),
  },
  // quests — this-character flavor
  {
    name: "quests",
    pattern: /^Whenever this character quests/i,
    build: () => ({ on: "quests" }),
  },
  // is_challenged
  {
    name: "is_challenged",
    pattern: /^Whenever this character is challenged/i,
    build: () => ({ on: "is_challenged" }),
  },
  // challenges — owner:self
  {
    name: "challenges_owner_self",
    pattern: /^Whenever one of your characters challenges another character/i,
    build: () => ({ on: "challenges", filter: { owner: { type: "self" } } }),
  },
  {
    name: "challenges",
    pattern: /^Whenever this character challenges another character/i,
    build: () => ({ on: "challenges" }),
  },
  // turn_start
  {
    name: "turn_start_opp",
    pattern: /^At the start of an opponent'?s turn/i,
    build: () => ({ on: "turn_start", player: { type: "opponent" } }),
  },
  {
    name: "turn_start",
    pattern: /^At the start of your turn/i,
    build: () => ({ on: "turn_start" }),
  },
  // turn_end
  {
    name: "turn_end_opp",
    pattern: /^At the end of an opponent'?s turn/i,
    build: () => ({ on: "turn_end", player: { type: "opponent" } }),
  },
  {
    name: "turn_end",
    pattern: /^At the end of your turn/i,
    build: () => ({ on: "turn_end" }),
  },
  // card_played — owner:self bare "Whenever you play a card"
  {
    name: "card_played_self",
    pattern: /^Whenever you play a card/i,
    build: () => ({ on: "card_played", filter: { owner: { type: "self" } } }),
  },
  // leaves_play
  {
    name: "leaves_play",
    pattern: /^When this character leaves play/i,
    build: () => ({ on: "leaves_play" }),
  },
  // banished_in_challenge — "When this character is banished in a challenge"
  // OR "When this character challenges and is banished" (legacy wording).
  {
    name: "banished_in_challenge_this",
    pattern: /^When this character is banished in a challenge/i,
    build: () => ({ on: "banished_in_challenge" }),
  },
  {
    name: "banished_in_challenge_legacy",
    pattern: /^When this character challenges and is banished/i,
    build: () => ({ on: "banished_in_challenge" }),
  },
  {
    name: "banished_in_challenge_your_other",
    pattern: /^Whenever one of your other characters is banished in a challenge/i,
    build: () => ({ on: "banished_in_challenge", filter: { owner: { type: "self" } } }),
  },
  // damage_removed_from — "Whenever you remove 1 or more damage from one of
  // your characters"
  {
    name: "damage_removed_from_yours",
    pattern: /^Whenever you remove (?:1 or more )?damage from one of your characters/i,
    build: () => ({ on: "damage_removed_from", filter: { owner: { type: "self" } } }),
  },
  // chosen_by_opponent — "Whenever an opponent chooses this character for an
  // action or ability"
  {
    name: "chosen_by_opponent",
    pattern: /^Whenever an opponent chooses this character for an action or ability/i,
    build: () => ({ on: "chosen_by_opponent" }),
  },
  // is_banished — generic fallback
  {
    name: "is_banished",
    pattern: /^When this character is banished/i,
    build: () => ({ on: "is_banished" }),
  },
  // card_drawn
  {
    name: "card_drawn_self",
    pattern: /^Whenever you draw a card/i,
    build: () => ({ on: "card_drawn" }),
  },
  {
    name: "card_drawn_opp",
    pattern: /^Whenever an opponent draws a card/i,
    build: () => ({ on: "card_drawn", player: { type: "opponent" } }),
  },
  // sings
  {
    name: "sings_owner_self",
    pattern: /^Whenever one of your characters sings a song/i,
    build: () => ({ on: "sings", filter: { owner: { type: "self" } } }),
  },
  {
    name: "sings",
    pattern: /^Whenever this character sings a song/i,
    build: () => ({ on: "sings" }),
  },
  // banishes_in_challenge — hand-wired cards use `banished_other_in_challenge`
  // (synonym: both resolve to "this character banishes another"). We emit
  // the form that matches existing card JSON.
  {
    name: "banishes_in_challenge",
    pattern: /^Whenever this character banishes another character in a challenge/i,
    build: () => ({ on: "banished_other_in_challenge" }),
  },
  {
    name: "your_char_banishes_in_challenge",
    pattern: /^Whenever one of your characters banishes another character in a challenge/i,
    build: () => ({
      on: "banished_other_in_challenge",
      filter: { owner: { type: "self" }, cardType: ["character"], zone: "play" },
    }),
  },
  // "Whenever one of your other characters is banished"
  {
    name: "your_other_char_is_banished",
    pattern: /^Whenever one of your other characters is banished/i,
    build: () => ({
      on: "is_banished",
      filter: {
        owner: { type: "self" },
        excludeSelf: true,
        cardType: ["character"],
      },
    }),
  },
  // card_played — action / song / item filters. Songs carry both cardType
  // and hasTrait filters in hand-wired JSON (songs ARE actions with the
  // Song trait).
  {
    name: "card_played_action",
    pattern: /^Whenever you play an action/i,
    build: () => ({
      on: "card_played",
      filter: { owner: { type: "self" }, cardType: ["action"] },
    }),
  },
  {
    name: "card_played_song",
    pattern: /^Whenever you play a song/i,
    build: () => ({
      on: "card_played",
      filter: {
        owner: { type: "self" },
        cardType: ["action"],
        hasTrait: "Song",
      },
    }),
  },
  // card_played owner:self with item filter
  {
    name: "card_played_item",
    pattern: /^Whenever you play an item/i,
    build: () => ({
      on: "card_played",
      filter: { owner: { type: "self" }, cardType: ["item"] },
    }),
  },
  // another character is played
  {
    name: "another_character_played",
    pattern: /^Whenever another character is played/i,
    build: () => ({
      on: "card_played",
      filter: { excludeSelf: true, cardType: ["character"] },
    }),
  },
];

const matchTrigger = makeMatcher(TRIGGER_MATCHERS);

// =============================================================================
// EFFECT MATCHERS — invert decompile-cards.ts EFFECT_RENDERERS.
// =============================================================================

// Target-phrase helpers — each returns { filter: Json, consumed: number } OR
// null if the phrase doesn't start a target. Kept small and orthogonal so
// effect matchers can reuse them via a common regex fragment.
// Used inline via regex; the builders hand-construct the target JSON so the
// shape matches the forward decompiler exactly.

const CHARACTER_FILTER: Json = { zone: "play", cardType: ["character"] };
const OPPOSING_CHARACTER_FILTER: Json = { zone: "play", cardType: ["character"], owner: { type: "opponent" } };

// Build a chosen-character target from the canonical forward-decompiler shape.
function chosenCharacter(opts?: { opposing?: boolean; damaged?: boolean }): Json {
  const f: Json = { ...(opts?.opposing ? OPPOSING_CHARACTER_FILTER : CHARACTER_FILTER) };
  if (opts?.damaged) f.hasDamage = true;
  return { type: "chosen", filter: f };
}

// gain_stats emits stat values as individual fields (strength/willpower/lore)
// — existing cards use this form; `modify_stat` with {stat, amount} is
// historically rarer in the JSON so we avoid emitting it.
function gainStats(amt: number, statChar: string, target: Json): Json {
  const out: Json = { type: "gain_stats", target };
  const key = statChar.toUpperCase() === "S" ? "strength" : statChar.toUpperCase() === "W" ? "willpower" : "lore";
  out[key] = amt;
  return out;
}

// Parse an integer, treating "a"/"an" as 1.
function n(s: string | undefined, fallback = 1): number {
  if (!s) return fallback;
  if (/^a$|^an$/i.test(s)) return 1;
  const v = parseInt(s, 10);
  return Number.isFinite(v) ? v : fallback;
}

// Duration phrase ("this turn", "until the start of your next turn", etc.).
// The canonical discriminator depends on the effect kind (see canonicalize):
// `grant_keyword` uses `end_of_turn`, stat mods use `this_turn`. Callers
// pass the effect type so we emit the form that matches existing card JSON.
function parseDuration(rest: string, effectType?: string): { duration?: string; consumed: number } {
  const m1 = /^\s+this turn\b/i.exec(rest);
  if (m1) return { duration: thisTurnFor(effectType), consumed: m1[0].length };
  const m2 = /^\s+until the start of your next turn\b/i.exec(rest);
  if (m2) return { duration: "until_caster_next_turn", consumed: m2[0].length };
  const m3 = /^\s+during their next turn\b/i.exec(rest);
  if (m3) return { duration: "end_of_owner_next_turn", consumed: m3[0].length };
  return { consumed: 0 };
}

function thisTurnFor(effectType?: string): string {
  // grant_keyword / cant_action historically use end_of_turn. Stat mods and
  // most others use this_turn. Both render identically ("this turn"), but we
  // pick the form that matches hand-wired JSON for exact-match accuracy.
  if (effectType === "grant_keyword" || effectType === "cant_action") return "end_of_turn";
  return "this_turn";
}

// Consume a trailing duration clause after an effect has already been matched.
// Pushes the duration onto the effect and returns the new total consumed.
function withDuration(effect: Json, rest: string, alreadyConsumed: number): { json: Json; consumed: number } {
  const d = parseDuration(rest.slice(alreadyConsumed));
  if (d.duration) {
    effect.duration = d.duration;
    return { json: effect, consumed: alreadyConsumed + d.consumed };
  }
  return { json: effect, consumed: alreadyConsumed };
}

const EFFECT_MATCHERS: Matcher<Json>[] = [
  // ============= DRAW ========================================================
  {
    name: "draw_each_opponent",
    pattern: /^each opponent draws (?:(\d+) cards?|a card)/i,
    build: (m) => ({ type: "draw", amount: n(m[1]), target: { type: "opponent" } }),
  },
  {
    name: "draw_each_player",
    pattern: /^each player draws (?:(\d+) cards?|a card)/i,
    build: (m) => ({ type: "draw", amount: n(m[1]), target: { type: "both" } }),
  },
  {
    name: "draw_may_n",
    pattern: /^you may draw (\d+) cards?/i,
    build: (m) => ({ type: "draw", amount: n(m[1]), target: { type: "self" }, isMay: true }),
  },
  {
    name: "draw_may_one",
    pattern: /^you may draw a card/i,
    build: () => ({ type: "draw", amount: 1, target: { type: "self" }, isMay: true }),
  },
  {
    name: "draw_n",
    pattern: /^draw (\d+) cards?/i,
    build: (m) => ({ type: "draw", amount: n(m[1]), target: { type: "self" } }),
  },
  {
    name: "draw_one",
    pattern: /^draw a card/i,
    build: () => ({ type: "draw", amount: 1, target: { type: "self" } }),
  },

  // ============= LORE ========================================================
  {
    name: "gain_lore_self_n",
    pattern: /^(?:you )?gain (\d+) lore/i,
    build: (m) => ({ type: "gain_lore", amount: n(m[1]), target: { type: "self" } }),
  },
  {
    name: "lose_lore_self_n",
    pattern: /^(?:you )?lose (\d+) lore/i,
    build: (m) => ({ type: "lose_lore", amount: n(m[1]), target: { type: "self" } }),
  },
  {
    name: "lose_lore_each_opponent",
    pattern: /^each opponent loses (\d+) lore/i,
    build: (m) => ({
      type: "each_player",
      scope: "opponents",
      effects: [{ type: "lose_lore", amount: n(m[1]), target: { type: "self" } }],
    }),
  },

  // ============= BANISH ======================================================
  {
    name: "banish_chosen_character_may",
    pattern: /^you may banish chosen character/i,
    build: () => ({ type: "banish", target: chosenCharacter(), isMay: true }),
  },
  {
    name: "banish_chosen_damaged_character",
    pattern: /^banish chosen damaged character/i,
    build: () => ({ type: "banish", target: chosenCharacter({ damaged: true }) }),
  },
  {
    name: "banish_chosen_damaged_character_may",
    pattern: /^you may banish chosen damaged character/i,
    build: () => ({ type: "banish", target: chosenCharacter({ damaged: true }), isMay: true }),
  },
  {
    name: "banish_chosen_opposing_character",
    pattern: /^banish chosen opposing character/i,
    build: () => ({ type: "banish", target: chosenCharacter({ opposing: true }) }),
  },
  {
    name: "banish_chosen_character",
    pattern: /^banish chosen character/i,
    build: () => ({ type: "banish", target: chosenCharacter() }),
  },
  {
    name: "banish_chosen_item_may",
    pattern: /^you may banish chosen item/i,
    build: () => ({
      type: "banish",
      target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
      isMay: true,
    }),
  },
  {
    name: "banish_chosen_item",
    pattern: /^banish chosen item/i,
    build: () => ({
      type: "banish",
      target: { type: "chosen", filter: { zone: "play", cardType: ["item"] } },
    }),
  },

  // ============= EXERT / READY ==============================================
  {
    name: "exert_chosen_opp_character_may",
    pattern: /^you may exert chosen opposing character/i,
    build: () => ({ type: "exert", target: chosenCharacter({ opposing: true }), isMay: true }),
  },
  {
    name: "exert_chosen_opp_character",
    pattern: /^exert chosen opposing character/i,
    build: () => ({ type: "exert", target: chosenCharacter({ opposing: true }) }),
  },
  {
    name: "exert_chosen_character",
    pattern: /^exert chosen character/i,
    build: () => ({ type: "exert", target: chosenCharacter() }),
  },
  {
    name: "ready_chosen_character",
    pattern: /^ready chosen character/i,
    build: () => ({ type: "ready", target: chosenCharacter() }),
  },

  // ============= DAMAGE ======================================================
  {
    name: "deal_damage_may_n",
    pattern: /^you may deal (\d+) damage to chosen character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: chosenCharacter(),
      isMay: true,
    }),
  },
  {
    name: "deal_damage_n_opp",
    pattern: /^deal (\d+) damage to chosen opposing character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: chosenCharacter({ opposing: true }),
    }),
  },
  {
    name: "deal_damage_n",
    pattern: /^deal (\d+) damage to chosen character/i,
    build: (m) => ({ type: "deal_damage", amount: n(m[1]), target: chosenCharacter() }),
  },
  // damage to this character (enters-play-with-damage shape)
  {
    name: "deal_damage_this",
    pattern: /^deal (\d+) damage to this character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: { type: "this" },
    }),
  },
  // move damage — hand-wired cards omit isMay on move_damage even when oracle
  // says "you may" (the engine treats up-to as implicitly optional). We match
  // that convention so exact-match succeeds.
  {
    name: "move_damage_up_to",
    pattern: /^(?:you may )?move up to (\d+) damage counters? from chosen character to chosen opposing character/i,
    build: (m) => ({
      type: "move_damage",
      amount: n(m[1]),
      isUpTo: true,
      source: chosenCharacter(),
      destination: chosenCharacter({ opposing: true }),
    }),
  },
  {
    name: "move_damage_n",
    pattern: /^(?:you may )?move (\d+) damage from chosen character to chosen opposing character/i,
    build: (m) => ({
      type: "move_damage",
      amount: n(m[1]),
      source: chosenCharacter(),
      destination: chosenCharacter({ opposing: true }),
    }),
  },
  // remove_damage — hand-wired uses `hasDamage:true` filter (no cardType
  // needed since only characters carry damage in Lorcana).
  {
    name: "remove_damage_up_to_may",
    pattern: /^you may remove up to (\d+) damage from chosen character/i,
    build: (m) => ({
      type: "remove_damage",
      amount: n(m[1]),
      target: { type: "chosen", filter: { hasDamage: true, zone: "play" } },
      isUpTo: true,
      isMay: true,
    }),
  },
  {
    name: "remove_damage_up_to",
    pattern: /^remove up to (\d+) damage from chosen character/i,
    build: (m) => ({
      type: "remove_damage",
      amount: n(m[1]),
      target: { type: "chosen", filter: { hasDamage: true, zone: "play" } },
      isUpTo: true,
    }),
  },

  // ============= STAT MODS ===================================================
  // "gets +/- X {stat} [this turn]" emits `gain_stats` with individual stat
  // fields (strength / willpower / lore) — canonical form used by existing
  // cards. Duration suffix is consumed by the chain parser.
  {
    name: "chosen_character_gets_stat",
    pattern: /^chosen character gets ([+-]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1], 10), m[2], chosenCharacter()),
  },
  {
    name: "chosen_opposing_character_gets_stat",
    pattern: /^chosen opposing character gets ([+-]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1], 10), m[2], chosenCharacter({ opposing: true })),
  },
  {
    name: "this_character_gets_stat",
    pattern: /^this character gets ([+-]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1], 10), m[2], { type: "this" }),
  },

  // ============= KEYWORD GRANTS =============================================
  // Opposing character variant first so it matches before the plain "chosen
  // character" pattern below.
  {
    name: "chosen_opposing_character_gains_keyword",
    pattern: /^chosen opposing character gains (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))?/i,
    build: (m) => {
      const out: Json = {
        type: "grant_keyword",
        keyword: m[1].toLowerCase(),
        target: chosenCharacter({ opposing: true }),
      };
      if (m[2]) out.value = parseInt(m[2], 10);
      return out;
    },
  },
  // "chosen character of yours gains X" — owner:self
  {
    name: "chosen_character_of_yours_gains_keyword",
    pattern: /^chosen character of yours gains (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))?/i,
    build: (m) => {
      const out: Json = {
        type: "grant_keyword",
        keyword: m[1].toLowerCase(),
        target: {
          type: "chosen",
          filter: {
            zone: "play",
            cardType: ["character"],
            owner: { type: "self" },
          },
        },
      };
      if (m[2]) out.value = parseInt(m[2], 10);
      return out;
    },
  },
  {
    name: "chosen_character_gains_keyword_n",
    pattern: /^chosen character gains (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))?/i,
    build: (m) => {
      const out: Json = {
        type: "grant_keyword",
        keyword: m[1].toLowerCase(),
        target: chosenCharacter(),
      };
      if (m[2]) out.value = parseInt(m[2], 10);
      return out;
    },
  },

  // ============= CAN'T ACTION ===============================================
  {
    name: "chosen_opp_cant_ready_next_turn",
    pattern: /^chosen opposing character can't ready at the start of their next turn/i,
    build: () => ({
      type: "cant_action",
      action: "ready",
      target: chosenCharacter({ opposing: true }),
      duration: "end_of_owner_next_turn",
    }),
  },
  {
    name: "chosen_opp_cant_quest_next_turn",
    pattern: /^chosen opposing character can't quest during their next turn/i,
    build: () => ({
      type: "cant_action",
      action: "quest",
      target: chosenCharacter({ opposing: true }),
      duration: "end_of_owner_next_turn",
    }),
  },
  {
    name: "chosen_opp_cant_challenge_next_turn",
    pattern: /^chosen opposing character can't challenge during their next turn/i,
    build: () => ({
      type: "cant_action",
      action: "challenge",
      target: chosenCharacter({ opposing: true }),
      duration: "end_of_owner_next_turn",
    }),
  },

  // ============= DISCARD =====================================================
  {
    name: "choose_and_discard_n",
    pattern: /^choose and discard (\d+) cards?/i,
    build: (m) => ({
      type: "discard_from_hand",
      amount: n(m[1]),
      target: { type: "self" },
      chooser: "target_player",
    }),
  },
  {
    name: "choose_and_discard_one",
    pattern: /^choose and discard a card/i,
    build: () => ({
      type: "discard_from_hand",
      amount: 1,
      target: { type: "self" },
      chooser: "target_player",
    }),
  },
  {
    name: "each_opponent_discards_chooses_one",
    pattern: /^each opponent chooses and discards a card/i,
    build: () => ({
      type: "each_player",
      scope: "opponents",
      effects: [{ type: "discard_from_hand", amount: 1, target: { type: "self" } }],
    }),
  },
  {
    name: "each_opponent_discards_chooses_n",
    pattern: /^each opponent chooses and discards (\d+) cards?/i,
    build: (m) => ({
      type: "each_player",
      scope: "opponents",
      effects: [{ type: "discard_from_hand", amount: n(m[1]), target: { type: "self" } }],
    }),
  },

  // ============= RETURN TO HAND =============================================
  {
    name: "return_this_card",
    pattern: /^return this card to your hand/i,
    build: () => ({ type: "return_to_hand", target: { type: "this" } }),
  },
  // Return a character from your discard. "return a character card from your
  // discard to your hand"
  {
    name: "return_character_from_discard",
    pattern: /^return a character card from your discard to your hand/i,
    build: () => ({
      type: "return_to_hand",
      target: {
        type: "chosen",
        filter: { zone: "discard", cardType: ["character"], owner: { type: "self" } },
      },
    }),
  },
  {
    name: "return_action_from_discard_cost",
    pattern: /^(?:you may )?return an action card with cost (\d+) or less from your discard to your hand/i,
    build: (m) => ({
      type: "return_to_hand",
      isMay: /^you may /i.test(m[0]) || undefined,
      target: {
        type: "chosen",
        filter: {
          zone: "discard",
          cardType: ["action"],
          costAtMost: parseInt(m[1], 10),
          owner: { type: "self" },
        },
      },
    }),
  },
  {
    name: "return_location_from_discard",
    pattern: /^return a location card from your discard to your hand/i,
    build: () => ({
      type: "return_to_hand",
      target: {
        type: "chosen",
        filter: { zone: "discard", cardType: ["location"], owner: { type: "self" } },
      },
    }),
  },

  // ============= PLAY FOR FREE ==============================================
  // "you may play a character with cost N or less for free"
  {
    name: "play_character_cost_for_free",
    pattern: /^you may play a character with cost (\d+) or less for free/i,
    build: (m) => ({
      type: "play_card",
      filter: {
        cardType: ["character"],
        costAtMost: parseInt(m[1], 10),
        owner: { type: "self" },
        zone: "hand",
      },
      isMay: true,
    }),
  },
  {
    name: "play_action_cost_for_free",
    pattern: /^you may play an action with cost (\d+) or less for free/i,
    build: (m) => ({
      type: "play_card",
      filter: {
        cardType: ["action"],
        costAtMost: parseInt(m[1], 10),
        owner: { type: "self" },
        zone: "hand",
      },
      isMay: true,
    }),
  },
  {
    name: "play_song_cost_for_free",
    pattern: /^you may play a song with cost (\d+) or less for free/i,
    build: (m) => ({
      type: "play_card",
      isMay: true,
      filter: {
        cardType: ["action"],
        hasTrait: "Song",
        costAtMost: parseInt(m[1], 10),
        zone: "hand",
        owner: { type: "self" },
      },
    }),
  },
  {
    name: "play_item_cost_for_free",
    pattern: /^you may play an item with cost (\d+) or less for free/i,
    build: (m) => ({
      type: "play_card",
      isMay: true,
      filter: {
        cardType: ["item"],
        costAtMost: parseInt(m[1], 10),
        owner: { type: "self" },
        zone: "hand",
      },
    }),
  },
  {
    name: "play_item_for_free_bare",
    pattern: /^you may play an item for free/i,
    build: () => ({
      type: "play_card",
      isMay: true,
      filter: { cardType: ["item"], owner: { type: "self" }, zone: "hand" },
    }),
  },

  // ============= PUT INTO INKWELL ===========================================
  // Hand-wired uses `move_to_inkwell` with `fromZone:"deck"` for "top of deck"
  // and omits fromZone with target:this for "put this card in your inkwell".
  // `enterExerted:true` is always set for this oracle phrasing (the "facedown
  // and exerted" suffix).
  {
    name: "put_top_deck_into_inkwell",
    pattern: /^you may put the top card of your deck into your inkwell facedown and exerted/i,
    build: () => ({
      type: "move_to_inkwell",
      target: { type: "self" },
      fromZone: "deck",
      isMay: true,
      enterExerted: true,
    }),
  },
  {
    name: "put_this_into_inkwell",
    pattern: /^you may put this card into your inkwell facedown and exerted/i,
    build: () => ({
      type: "move_to_inkwell",
      target: { type: "this" },
      isMay: true,
      enterExerted: true,
    }),
  },

  // ============= MILL / DECK MANIPULATION ===================================
  {
    name: "mill_self_top_to_discard",
    pattern: /^(?:you may )?put the top card of your deck into your discard/i,
    build: (m) => ({
      type: "mill_self",
      amount: 1,
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
];

const matchEffect = makeMatcher(EFFECT_MATCHERS);

// =============================================================================
// CONDITION MATCHERS — invert decompile-cards.ts CONDITION_RENDERERS.
// -----------------------------------------------------------------------------
// Matches a conditional phrase at the start of the text (usually after "if "
// or "while "). Returns the `condition` field value as hand-wired cards store
// it.
// =============================================================================

const CONDITION_MATCHERS: Matcher<Json>[] = [
  // is_your_turn handled at ability-level as leading "During your turn," —
  // also appears as a post-trigger "during your turn, " phrase that the
  // leading-condition pass already absorbs.

  // characters_in_play_gte — "if you have N or more [other] characters in play"
  {
    name: "chars_in_play_gte_other",
    pattern: /^if you have (\d+) or more other characters in play/i,
    build: (m) => ({
      type: "characters_in_play_gte",
      amount: parseInt(m[1], 10),
      player: { type: "self" },
      excludeSelf: true,
    }),
  },
  {
    name: "chars_in_play_gte",
    pattern: /^if you have (\d+) or more characters in play/i,
    build: (m) => ({
      type: "characters_in_play_gte",
      amount: parseInt(m[1], 10),
      player: { type: "self" },
    }),
  },

  // has_character_named — "if you have a character named X in play"
  {
    name: "has_char_named",
    pattern: /^if you have a character named ([A-Z][\w'’\- ]*?) in play/i,
    build: (m) => ({
      type: "has_character_named",
      name: m[1].trim(),
      player: { type: "self" },
    }),
  },

  // has_character_with_trait — "if you have a|another <Trait> character in
  // play" / "while you have a <Trait> character in play"
  {
    name: "has_char_with_trait_other",
    pattern: /^(?:if|while) you have another ([A-Z][a-zA-Z]*) character in play/i,
    build: (m) => ({
      type: "has_character_with_trait",
      trait: m[1],
      player: { type: "self" },
      excludeSelf: true,
    }),
  },
  {
    name: "has_char_with_trait",
    pattern: /^(?:if|while) you have a ([A-Z][a-zA-Z]*) character in play/i,
    build: (m) => ({
      type: "has_character_with_trait",
      trait: m[1],
      player: { type: "self" },
    }),
  },

  // you_control_matching — "if you have a location in play"
  {
    name: "control_location",
    pattern: /^if you have a location in play/i,
    build: () => ({
      type: "you_control_matching",
      filter: { cardType: ["location"], zone: "play", owner: { type: "self" } },
    }),
  },

  // cards_in_hand_gte
  {
    name: "cards_in_hand_gte",
    pattern: /^if you have (\d+) or more cards in your hand/i,
    build: (m) => ({
      type: "cards_in_hand_gte",
      amount: parseInt(m[1], 10),
      player: { type: "self" },
    }),
  },
  {
    name: "cards_in_hand_eq_zero",
    pattern: /^if you have no cards in your hand/i,
    build: () => ({ type: "cards_in_hand_eq", amount: 0, player: { type: "self" } }),
  },

  // played_this_turn — matching "if you played (another )?<filter> this turn"
  {
    name: "played_another_character_this_turn",
    pattern: /^if you(?:'ve| have)? played another character this turn/i,
    build: () => ({
      type: "played_this_turn",
      amount: 1,
      filter: { cardType: ["character"], excludeSelf: true },
    }),
  },
  {
    name: "played_a_character_this_turn",
    pattern: /^if you(?:'ve| have)? played a character this turn/i,
    build: () => ({
      type: "played_this_turn",
      amount: 1,
      filter: { cardType: ["character"] },
    }),
  },
  {
    name: "played_a_song_this_turn",
    pattern: /^if you(?:'ve| have)? played a song this turn/i,
    build: () => ({ type: "played_this_turn", amount: 1, filter: { hasTrait: "Song" } }),
  },
  {
    name: "played_an_action_this_turn",
    pattern: /^if you(?:'ve| have)? played an action this turn/i,
    build: () => ({
      type: "played_this_turn",
      amount: 1,
      filter: { cardType: ["action"] },
    }),
  },

  // your_first_turn_as_underdog — "If this is your first turn and you're not
  // the first player". Straight/curly apostrophes both accepted.
  {
    name: "first_turn_underdog",
    pattern: /^if this is your first turn and you['’]re not the first player/i,
    build: () => ({ type: "your_first_turn_as_underdog" }),
  },

  // this-card-state
  {
    name: "this_has_no_damage",
    pattern: /^if this character has no damage/i,
    build: () => ({ type: "this_has_no_damage" }),
  },
  {
    name: "this_has_cards_under",
    pattern: /^if this character has cards under it/i,
    build: () => ({ type: "this_has_cards_under" }),
  },
  {
    name: "this_is_exerted",
    pattern: /^(?:if|while) this character is exerted/i,
    build: () => ({ type: "this_is_exerted" }),
  },
];

const matchCondition = makeMatcher(CONDITION_MATCHERS);

// =============================================================================
// MAIN COMPILE FUNCTION — one ability's rulesText → JSON ability.
// -----------------------------------------------------------------------------
// Ability shapes:
//   * triggered: "<trigger>, <effects>"  (or "<trigger>, <condition>, <effects>")
//   * static:    "<filter phrase> get[s] +X {stat}[ duration]"
//   * activated: "<cost>, <cost> — [<condition>,] <effects>"
// =============================================================================

export interface CompileResult {
  ability: Json | null;
  unmatched: string;
}

export function compileAbility(text: string, ctx: { cardType: string }): CompileResult {
  const original = text.trim();
  let rest = original;

  // -------- Leading condition ----------------------------------------------
  // The forward decompiler emits conditions in two places: as a leading
  // "During your turn, ..." clause, or as a post-trigger "if X, ..." phrase.
  // On statics with a condition, the oracle text is "If X, this character
  // can't ...". Try a generic condition match first; fall back to the hard-
  // coded turn forms for phrasings the condition table doesn't cover.
  let leadingCondition: Json | null = null;
  const leadCond = /^(?:During your turn|Once during your turn|During opponents'?\s*turns?),\s*/i.exec(rest);
  if (leadCond) {
    if (/^Once\b/i.test(leadCond[0])) {
      leadingCondition = { type: "is_your_turn" };
    } else if (/opponents/i.test(leadCond[0])) {
      leadingCondition = { type: "not", condition: { type: "is_your_turn" } };
    } else {
      leadingCondition = { type: "is_your_turn" };
    }
    rest = rest.slice(leadCond[0].length);
  } else {
    // Generic: "If <condition>, ..." / "While <condition>, ...". We peel it
    // using the same CONDITION_MATCHERS the post-trigger path uses.
    const cond = matchCondition(rest);
    if (cond) {
      // Must be followed by ", " for this to be a leading-condition phrase
      // (otherwise it's the start of a sentence that happens to match).
      const after = rest.slice(cond.consumed);
      if (/^,\s+/.test(after)) {
        leadingCondition = cond.json;
        rest = after.replace(/^,\s+/, "");
      }
    }
  }

  // -------- Triggered shape -----------------------------------------------
  const trig = matchTrigger(rest);
  if (trig) {
    let after = rest.slice(trig.consumed).trimStart();
    if (after.startsWith(",")) after = after.slice(1).trimStart();

    // Optional post-trigger condition ("if X," / "while X,"). The forward
    // decompiler emits these between the trigger and the effect chain:
    // "Whenever this character quests, if you played a song this turn, ...".
    // Note: leadingCondition ("During your turn, ...") takes precedence — if
    // both are present (rare, but legal), the leading form wins.
    let triggerCondition: Json | null = null;
    const cond = matchCondition(after);
    if (cond) {
      triggerCondition = cond.json;
      after = after.slice(cond.consumed).trimStart();
      if (after.startsWith(",")) after = after.slice(1).trimStart();
    }

    // "you may X, then Y" wraps the whole chain in a sequential effect.
    const seqLead = /^you may (.+?,\s+then\s+.+?\.?)$/i.exec(after);
    if (seqLead) {
      const inner = parseEffectChain(seqLead[1]);
      if (inner && inner.consumedAll && inner.json.length >= 2) {
        const first = { ...inner.json[0] };
        delete first.isMay;
        const rewardEffects = [first, ...inner.json.slice(1)];
        const ability: Json = {
          type: "triggered",
          trigger: trig.json,
          effects: [
            { type: "sequential", isMay: true, costEffects: [], rewardEffects },
          ],
        };
        const finalCond = leadingCondition ?? triggerCondition;
        if (finalCond) ability.condition = finalCond;
        return { ability, unmatched: "" };
      }
    }
    const effects = parseEffectChain(after);
    if (effects && effects.consumedAll) {
      const ability: Json = {
        type: "triggered",
        trigger: trig.json,
        effects: effects.json,
      };
      const finalCond = leadingCondition ?? triggerCondition;
      if (finalCond) ability.condition = finalCond;
      return { ability, unmatched: "" };
    }
    return { ability: null, unmatched: effects ? effects.remainder : after };
  }

  // -------- Static shape --------------------------------------------------
  // Simplest canonical form: "This character gains <Keyword>." Good enough for
  // "During your turn, this character gains Evasive" and its variants. Covers
  // enters-play-exerted too.
  const statEnters = /^This (?:character|item|location) enters play exerted\.?$/i.exec(rest);
  if (statEnters) {
    return {
      ability: { type: "static", effect: { type: "enter_play_exerted_self" } },
      unmatched: "",
    };
  }
  const statGainsKw = /^This character gains (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))?\.?$/i.exec(
    rest,
  );
  if (statGainsKw) {
    const effect: Json = { type: "grant_keyword", keyword: statGainsKw[1].toLowerCase(), target: { type: "this" } };
    if (statGainsKw[2]) effect.value = parseInt(statGainsKw[2], 10);
    const ability: Json = { type: "static", effect };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }
  // -------- Activated shape (EXPLICIT cost only) --------------------------
  // Match "{E} — body" / "{E}, 2 {I} — body" up front. The bare-body
  // fallback (activated with default {E} cost) runs LAST so it doesn't
  // swallow statics that happen to start with an effect phrase (e.g.
  // "this character gets +1 {L}").
  const activatedExplicit = tryActivatedAbility(rest, leadingCondition, { requireExplicitCost: true });
  if (activatedExplicit) return { ability: activatedExplicit, unmatched: "" };

  // "you pay N {I} less to play this character." — self_cost_reduction static.
  const statSelfCost = /^you pay (\d+) \{I\} less to play this character\.?$/i.exec(rest);
  if (statSelfCost) {
    const ability: Json = {
      type: "static",
      effect: { type: "self_cost_reduction", amount: parseInt(statSelfCost[1], 10) },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character can't ready." — blanket ready block (ready_anytime).
  // Bare "can't ready" with no "at the start of your turn" qualifier.
  const statCantReady = /^This character can't ready\.?$/i.exec(rest);
  if (statCantReady) {
    const ability: Json = {
      type: "static",
      effect: { type: "cant_action_self", action: "ready_anytime" },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character gets +X {S}" static
  const statGetsStat = /^This character gets ([+-]?\d+) \{(S|W|L)\}\.?$/i.exec(rest);
  if (statGetsStat) {
    const stat = statGetsStat[2].toUpperCase() === "S" ? "strength" : statGetsStat[2].toUpperCase() === "W" ? "willpower" : "lore";
    const effect: Json = {
      type: "modify_stat",
      stat,
      amount: parseInt(statGetsStat[1], 10),
      target: { type: "this" },
    };
    const ability: Json = { type: "static", effect };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // -------- Static: filter-target stats / keywords ------------------------
  // "Your [other] [trait-or-named-or-keyword-qualifier] characters get +N {S}."
  const fStats = parseYourCharactersGetsStat(rest);
  if (fStats) {
    const ability: Json = { type: "static", effect: fStats };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }
  const fKeyword = parseYourCharactersGainKeyword(rest);
  if (fKeyword) {
    const ability: Json = { type: "static", effect: fKeyword };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // -------- Activated: bare-body fallback ---------------------------------
  // Last resort — if the text parses as an effect chain, treat as an
  // activated ability with default [{type:"exert"}] cost. The real cost
  // isn't in body-only rulesText so the draft will be a near-miss on
  // non-exert costs (banish_self, pay_ink, etc.). User verifies against
  // the card.
  const activatedBare = tryActivatedAbility(rest, leadingCondition, { requireExplicitCost: false });
  if (activatedBare) return { ability: activatedBare, unmatched: "" };

  return { ability: null, unmatched: original };
}

// Parse an activated ability shape. Handles explicit "{E} — <body>" and the
// bare effect-chain form (treated as "[exert] — <body>"). Returns a complete
// ability object or null if no effect chain can be parsed.
function tryActivatedAbility(
  text: string,
  leadingCondition: Json | null,
  opts: { requireExplicitCost: boolean },
): Json | null {
  const costMatch = /^((?:\{E\}|\d+\s*\{I\})(?:\s*,\s*(?:\{E\}|\d+\s*\{I\}))*)\s*[—–-]\s+/.exec(text);
  let costs: Json[] | null = null;
  let body = text;
  if (costMatch) {
    costs = parseCostsFromPhrase(costMatch[1]);
    body = text.slice(costMatch[0].length);
  } else if (opts.requireExplicitCost) {
    return null;
  }
  const effects = parseEffectChain(body);
  if (!effects || !effects.consumedAll || effects.json.length === 0) return null;
  if (!costs) costs = [{ type: "exert" }];
  const ability: Json = { type: "activated", costs, effects: effects.json };
  if (leadingCondition) ability.condition = leadingCondition;
  return ability;
}

function parseCostsFromPhrase(phrase: string): Json[] {
  return phrase.split(/\s*,\s*/).map((part) => {
    if (/^\{E\}$/i.test(part)) return { type: "exert" };
    const ink = /^(\d+)\s*\{I\}$/i.exec(part);
    if (ink) return { type: "pay_ink", amount: parseInt(ink[1], 10) };
    return { type: "unknown", raw: part };
  });
}

// Parse a "your (other) [qualifier] characters" filter phrase — used by the
// static-shape matchers. Returns { filter, consumed } or null.
function parseYourCharactersFilter(text: string): { filter: Json; consumed: number } | null {
  // "Your characters with <Keyword>" — hasKeyword, no excludeSelf
  const mKw = /^Your characters with (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)\b/i.exec(text);
  if (mKw) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
        hasKeyword: mKw[1].toLowerCase(),
      },
      consumed: mKw[0].length,
    };
  }
  // "Your characters named <Name>" — hasName
  const mName = /^Your characters named ([A-Z][\w'’\- ]*?)\b(?= gain| get)/i.exec(text);
  if (mName) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
        hasName: mName[1].trim(),
      },
      consumed: mName[0].length,
    };
  }
  // "Your exerted characters" — isExerted: true
  const mExerted = /^Your exerted characters/i.exec(text);
  if (mExerted) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
        isExerted: true,
      },
      consumed: mExerted[0].length,
    };
  }
  // "Your other characters" (no trait — excludeSelf, bare plural)
  const mOther = /^Your other characters/i.exec(text);
  if (mOther) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
        excludeSelf: true,
      },
      consumed: mOther[0].length,
    };
  }
  // "Your characters" (no qualifier)
  const mPlain = /^Your characters(?= get| gain)/i.exec(text);
  if (mPlain) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
      },
      consumed: mPlain[0].length,
    };
  }
  // "Your other <Trait> characters" — hasTrait + excludeSelf
  const mTraitOther = /^Your other ([A-Z][a-zA-Z]*) characters/i.exec(text);
  if (mTraitOther) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
        hasTrait: mTraitOther[1],
        excludeSelf: true,
      },
      consumed: mTraitOther[0].length,
    };
  }
  // "Your <Trait> characters" — hasTrait
  const mTrait = /^Your ([A-Z][a-zA-Z]*) characters/i.exec(text);
  if (mTrait) {
    return {
      filter: {
        owner: { type: "self" },
        zone: "play",
        cardType: ["character"],
        hasTrait: mTrait[1],
      },
      consumed: mTrait[0].length,
    };
  }
  return null;
}

function parseYourCharactersGetsStat(text: string): Json | null {
  const f = parseYourCharactersFilter(text);
  if (!f) return null;
  const after = text.slice(f.consumed);
  const mStat = /^\s+get ([+-]?\d+) \{(S|W|L)\}\.?$/i.exec(after);
  if (!mStat) return null;
  const stat = mStat[2].toUpperCase() === "S" ? "strength" : mStat[2].toUpperCase() === "W" ? "willpower" : "lore";
  return {
    type: "modify_stat",
    stat,
    amount: parseInt(mStat[1], 10),
    target: { type: "all", filter: f.filter },
  };
}

function parseYourCharactersGainKeyword(text: string): Json | null {
  const f = parseYourCharactersFilter(text);
  if (!f) return null;
  const after = text.slice(f.consumed);
  const mKw = /^\s+gain (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))?\.?$/i.exec(after);
  if (!mKw) return null;
  const out: Json = {
    type: "grant_keyword",
    keyword: mKw[1].toLowerCase(),
    target: { type: "all", filter: f.filter },
  };
  if (mKw[2]) out.value = parseInt(mKw[2], 10);
  return out;
}

// Parse a comma/"and"-separated chain of effects. Returns null if the first
// effect doesn't match at all; otherwise returns what was parsed and what's
// left. `consumedAll` means the chain parsed to a sentence-terminator.
function parseEffectChain(
  text: string,
): { json: Json[]; consumedAll: boolean; remainder: string } | null {
  let rest = text.trim();
  const effects: Json[] = [];
  while (rest.length > 0) {
    const m = matchEffect(rest);
    if (!m) break;
    // Consume the matched effect phrase, then a trailing duration clause if
    // present — many effects support "this turn" / "until the start of your
    // next turn" suffixes that aren't part of the base regex.
    rest = rest.slice(m.consumed);
    const dur = parseDuration(rest, m.json.type);
    if (dur.duration) {
      m.json.duration = dur.duration;
      rest = rest.slice(dur.consumed);
    }
    rest = rest.trimStart();
    effects.push(m.json);
    // Strip a reminder-text parenthetical that the forward decompiler never
    // emits (e.g. "(They can challenge characters with Evasive.)").
    const rem = /^\([^)]*\)\s*/.exec(rest);
    if (rem) rest = rest.slice(rem[0].length);
    // Sentence-terminators: "." or end-of-string
    if (rest === "" || rest === ".") {
      return { json: effects, consumedAll: true, remainder: "" };
    }
    // Chain separators: ", and ", ", ", ". ", " and ", ", then ", ". Then, "
    const sepMatch = /^(?:,\s*then\s+|\.\s+Then,?\s+|,\s*and\s+|,\s*|\.\s+and\s+|\.\s+|\s+and\s+)/i.exec(
      rest,
    );
    if (sepMatch) {
      rest = rest.slice(sepMatch[0].length);
      continue;
    }
    break;
  }
  if (effects.length === 0) return null;
  return { json: effects, consumedAll: rest === "" || rest === ".", remainder: rest };
}

// =============================================================================
// CARD-LEVEL COMPILE — parse a card's full rulesText into
// abilities[] / actionEffects[] by splitting on named-ability headers.
// =============================================================================

export interface CompiledCard {
  fullName: string;
  setId: string;
  number: number;
  cardType: string;
  rulesText: string;
  // Per-named-ability results (shared by characters, locations, items).
  namedResults: Array<{
    storyName: string;
    rulesText: string;
    ability: Json | null;
    unmatched: string;
  }>;
  // For actions/songs, actionEffects live on the card root, not in abilities[].
  actionEffectResult?: { ability: Json | null; unmatched: string };
}

/** Split a card's full rulesText into (storyName, bodyText) pairs.
 *  Named abilities are ALL-CAPS prefixes like "FRESH INK ..." — we detect
 *  a run of uppercase/punctuation followed by a lowercase word.           */
function splitNamedAbilities(rulesText: string): Array<{ storyName: string; body: string }> {
  const lines = rulesText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const chunks: Array<{ storyName: string; body: string }> = [];
  for (const line of lines) {
    // STORYNAME must be 2+ uppercase words (letters/punct/digits/space), then
    // transition to a lowercase word. Match runs until the first lowercase.
    // Story names are ALL-CAPS with straight/curly apostrophes and punctuation,
    // ending at the first lowercase word. Must include curly ’ for cards like
    // "LET'S GET MOVIN'" / "EVERYONE GATHER 'ROUND".
    const m = /^([A-Z][A-Z0-9'’ \-!,.?]*[A-Z!?'’])\s+([A-Z][a-z].*)$/.exec(line);
    if (m) chunks.push({ storyName: m[1].trim(), body: m[2].trim() });
    else chunks.push({ storyName: "", body: line });
  }
  return chunks;
}

export function compileCard(card: CardJSON): CompiledCard {
  const result: CompiledCard = {
    fullName: card.fullName,
    setId: card.setId,
    number: card.number,
    cardType: card.cardType,
    rulesText: card.rulesText ?? "",
    namedResults: [],
  };

  if (!card.rulesText) return result;

  // For actions/songs, the whole rulesText is an actionEffects body (no header).
  if (card.cardType === "action") {
    const r = compileAbility(card.rulesText, { cardType: card.cardType });
    result.actionEffectResult = { ability: r.ability, unmatched: r.unmatched };
    return result;
  }

  const chunks = splitNamedAbilities(card.rulesText);
  for (const c of chunks) {
    const r = compileAbility(c.body, { cardType: card.cardType });
    result.namedResults.push({
      storyName: c.storyName,
      rulesText: c.body,
      ability: r.ability,
      unmatched: r.unmatched,
    });
  }
  return result;
}

// =============================================================================
// VALIDATION — compare compiled JSON to hand-wired JSON and round-trip.
// =============================================================================

function normalizeForCompare(a: Json): Json {
  // Strip metadata fields not relevant to runtime semantics.
  const { storyName, rulesText, ...rest } = a;
  return stripUndefined(rest);
}

function stripUndefined(v: any): any {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      out[k] = stripUndefined(v[k]);
    }
    return out;
  }
  return v;
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(stripUndefined(a)) === JSON.stringify(stripUndefined(b));
}

// =============================================================================
// LOAD CARDS
// =============================================================================

function loadAllCards(): CardJSON[] {
  const files = readdirSync(CARDS_DIR).filter((f) => /^lorcast-set-\d+\.json$/.test(f));
  const out: CardJSON[] = [];
  for (const f of files.sort()) {
    const data = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")) as CardJSON[];
    out.push(...data);
  }
  return out;
}

function loadSets(setIds: string[]): CardJSON[] {
  return loadAllCards().filter((c) => setIds.includes(c.setId));
}

// =============================================================================
// BASELINE REPORT
// =============================================================================

interface BaselineStats {
  totalAbilities: number;
  matchedShape: number;     // compileAbility returned non-null
  exactJsonMatch: number;   // deepEqual to hand-wired JSON
  unmatchedPhrases: Map<string, number>;
  nearMisses: Array<{ rulesText: string; hand: Json; draft: Json; cardName: string }>;
}

function runBaseline(cards: CardJSON[]): BaselineStats {
  const stats: BaselineStats = {
    totalAbilities: 0,
    matchedShape: 0,
    exactJsonMatch: 0,
    unmatchedPhrases: new Map(),
    nearMisses: [],
  };

  for (const card of cards) {
    for (const ab of card.abilities ?? []) {
      if (ab.type === "keyword") continue;
      if (!ab.rulesText) continue;

      stats.totalAbilities++;
      const compiled = compileAbility(ab.rulesText, { cardType: card.cardType });
      if (compiled.ability) {
        stats.matchedShape++;
        const hand = normalizeForCompare(ab);
        const draft = normalizeForCompare(compiled.ability);
        if (deepEqual(hand, draft)) stats.exactJsonMatch++;
        else
          stats.nearMisses.push({
            rulesText: ab.rulesText,
            hand,
            draft,
            cardName: card.fullName,
          });
      } else if (compiled.unmatched) {
        const key = compiled.unmatched.slice(0, 80);
        stats.unmatchedPhrases.set(key, (stats.unmatchedPhrases.get(key) ?? 0) + 1);
      }
    }
  }

  return stats;
}

function printBaseline(stats: BaselineStats, topN: number = 20, showDiff: boolean = false): void {
  console.log(`\n=== BASELINE (sets 1–11) ===`);
  console.log(`Total named abilities:   ${stats.totalAbilities}`);
  console.log(
    `Matched shape (≠ null):  ${stats.matchedShape} (${pct(stats.matchedShape, stats.totalAbilities)})`,
  );
  console.log(
    `Exact JSON match:        ${stats.exactJsonMatch} (${pct(stats.exactJsonMatch, stats.totalAbilities)})`,
  );
  console.log(
    `Near-miss (shape but not exact): ${stats.nearMisses.length}`,
  );
  console.log(`\n=== TOP UNMATCHED PHRASE PREFIXES ===`);
  const sorted = [...stats.unmatchedPhrases.entries()].sort((a, b) => b[1] - a[1]);
  for (const [phrase, count] of sorted.slice(0, topN)) {
    console.log(`  ${count.toString().padStart(4)} × ${phrase}`);
  }
  if (showDiff) {
    console.log(`\n=== NEAR-MISS DIFFS (first ${Math.min(20, stats.nearMisses.length)}) ===`);
    // Group by hand-draft JSON key-pattern to identify systemic fixes
    const grouped = new Map<string, Array<typeof stats.nearMisses[0]>>();
    for (const nm of stats.nearMisses) {
      const key = JSON.stringify({ hand: nm.hand, draft: nm.draft });
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(nm);
    }
    const byFreq = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [, list] of byFreq.slice(0, 20)) {
      const nm = list[0];
      console.log(`\n  [${list.length}x] "${nm.rulesText}" (${nm.cardName})`);
      console.log(`    hand:  ${JSON.stringify(nm.hand)}`);
      console.log(`    draft: ${JSON.stringify(nm.draft)}`);
    }
  }
}

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

// =============================================================================
// CLI
// =============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const setFlag = args.indexOf("--set");
  const cardFlag = args.indexOf("--card");

  if (setFlag >= 0) {
    const setId = args[setFlag + 1];
    const cards = loadSets([setId]);
    for (const c of cards) {
      const r = compileCard(c);
      printCardResult(r);
    }
    return;
  }

  if (cardFlag >= 0) {
    const name = args[cardFlag + 1];
    const matches = loadAllCards().filter((c) =>
      c.fullName.toLowerCase().includes(name.toLowerCase()),
    );
    for (const c of matches) {
      const r = compileCard(c);
      printCardResult(r);
    }
    return;
  }

  // Default: baseline on sets 1-11
  const sets = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
  const cards = loadSets(sets);
  const stats = runBaseline(cards);
  const showDiff = args.includes("--diff");
  printBaseline(stats, 20, showDiff);
}

function printCardResult(r: CompiledCard): void {
  console.log(`\n[${r.setId}/${r.cardType}] ${r.fullName}`);
  console.log(`  rulesText: ${r.rulesText}`);
  for (const n of r.namedResults) {
    console.log(`  ${n.storyName || "(unnamed)"}: ${n.rulesText}`);
    if (n.ability) console.log(`    ✓ ${JSON.stringify(n.ability)}`);
    else console.log(`    ✗ unmatched: ${n.unmatched}`);
  }
  if (r.actionEffectResult) {
    if (r.actionEffectResult.ability) {
      console.log(`  actionEffect: ✓ ${JSON.stringify(r.actionEffectResult.ability)}`);
    } else {
      console.log(`  actionEffect: ✗ unmatched: ${r.actionEffectResult.unmatched}`);
    }
  }
}

main();
