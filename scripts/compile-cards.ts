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
  // quests — owner:self flavor ("Whenever one of your [other] characters quests")
  {
    name: "quests_owner_self_other",
    pattern: /^Whenever one of your other characters quests/i,
    build: () => ({ on: "quests", filter: { owner: { type: "self" }, excludeSelf: true } }),
  },
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
  // "Whenever an opposing character challenges" — any opponent's challenge
  {
    name: "challenges_opposing",
    pattern: /^Whenever an opposing character challenges/i,
    build: () => ({ on: "challenges", filter: { owner: { type: "opponent" }, cardType: ["character"] } }),
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
  // "Whenever another character is banished in a challenge" — any player
  {
    name: "banished_in_challenge_another",
    pattern: /^Whenever another character is banished in a challenge/i,
    build: () => ({ on: "banished_in_challenge", filter: { excludeSelf: true } }),
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
  // is_banished with trait filter — "Whenever a <Trait> character is banished"
  {
    name: "is_banished_trait",
    pattern: /^Whenever (?:a|an) ([A-Z][a-zA-Z]*) character is banished/i,
    build: (m) => ({
      on: "is_banished",
      filter: { hasTrait: m[1], cardType: ["character"] },
    }),
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
  // Merida Formidable Archer STEADY AIM — "Whenever one of your actions deals
  // damage to an opposing character". Expressed as damage_dealt_to with a
  // sourceFilter on the damage source (the action card), so the engine doesn't
  // need a distinct trigger type. target filter = the damaged card (opposing).
  {
    name: "action_dealt_damage_opp",
    pattern: /^Whenever one of your actions deals damage to an opposing character/i,
    build: () => ({
      on: "damage_dealt_to",
      filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] },
      sourceFilter: { owner: { type: "self" }, cardType: ["action"] },
    }),
  },
  // deals_damage_in_challenge — "Whenever this character deals damage to
  // another character in a challenge" (decompiler: "deals_damage_in_challenge").
  {
    name: "deals_damage_in_challenge",
    pattern: /^Whenever this character deals damage to another character in a challenge/i,
    build: () => ({ on: "deals_damage_in_challenge" }),
  },
  // challenges with owner:self + trait filter — "Whenever one of your Super
  // characters challenges another character"
  {
    name: "challenges_your_trait",
    pattern: /^Whenever one of your ([A-Z][a-zA-Z]*) characters challenges another character/i,
    build: (m) => ({
      on: "challenges",
      filter: { owner: { type: "self" }, cardType: ["character"], hasTrait: m[1] },
    }),
  },
  // "Whenever a character moves here" — location-scoped
  {
    name: "moves_here",
    pattern: /^Whenever (?:a |you move a )character (?:moves |)here/i,
    build: () => ({
      on: "moves_to_location",
      filter: { zone: "play", cardType: ["character"], atLocation: "this" },
    }),
  },
  // "Whenever a character quests while here" — location-scoped quests
  {
    name: "quests_while_here",
    pattern: /^Whenever a character quests while here/i,
    build: () => ({ on: "quests", filter: { atLocation: "this" } }),
  },
  // "Whenever a character is challenged while here" — location-scoped
  {
    name: "challenged_while_here",
    pattern: /^Whenever a character is challenged while here/i,
    build: () => ({
      on: "is_challenged",
      filter: { atLocation: "this" },
    }),
  },
  // "Whenever you pay N {I} or less to play a card/character/non-character"
  {
    name: "pay_cost_threshold_card",
    pattern: /^Whenever you pay (\d+) \{I\} or less to play a (card|character|non-character)/i,
    build: (m) => ({
      on: "card_played",
      filter: {
        owner: { type: "self" },
        ...(m[2] === "character"
          ? { cardType: ["character"] }
          : m[2] === "non-character"
            ? { cardType: ["action", "item", "location"] }
            : {}),
        costAtMost: parseInt(m[1], 10),
      },
    }),
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
  // "Whenever one of your other [Trait] characters is banished"
  {
    name: "your_other_trait_char_is_banished",
    pattern: /^Whenever one of your other ([A-Z][a-zA-Z]*) characters is banished/i,
    build: (m) => ({
      on: "is_banished",
      filter: {
        owner: { type: "self" },
        excludeSelf: true,
        cardType: ["character"],
        hasTrait: m[1],
      },
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
  // Royal Tantrum's "draw a card for each item banished this way" pattern —
  // reads the count of targets affected by the immediately preceding effect
  // off `state.lastEffectResult`. Place BEFORE draw_n so "for each X" beats
  // the numeric variant.
  {
    name: "draw_for_each_banished_this_way",
    pattern: /^(?:then, )?draw a card for each (?:item|character|card) banished this way/i,
    build: () => ({ type: "draw", amount: "cost_result", target: { type: "self" } }),
  },
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

  // "each player loses N lore"
  {
    name: "each_player_loses_lore",
    pattern: /^each player loses (\d+) lore/i,
    build: (m) => ({
      type: "each_player",
      scope: "all",
      effects: [{ type: "lose_lore", amount: n(m[1]), target: { type: "self" } }],
    }),
  },
  // "chosen opponent chooses and discards a card" — single opponent target
  {
    name: "chosen_opponent_discards",
    pattern: /^chosen opponent chooses and discards (?:(\d+) cards?|a card)/i,
    build: (m) => ({
      type: "discard_from_hand",
      amount: n(m[1]),
      target: { type: "opponent" },
      chooser: "target_player",
    }),
  },
  // "each opponent chooses and banishes one of their characters"
  {
    name: "each_opponent_chooses_banishes",
    pattern: /^each opponent chooses and banishes one of their characters/i,
    build: () => ({
      type: "banish",
      target: { type: "chosen", chooser: "target_player", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } },
    }),
  },

  // ============= GAME-RULE MODIFIERS =========================================
  // Dale SPIKE SUIT: "During challenges, your characters deal damage with
  // their {W} instead of their {S}." Game-rule modifier family.
  {
    name: "challenge_damage_stat_source_self_willpower",
    pattern: /^during challenges, your characters deal damage with their \{W\} instead of their \{S\}/i,
    build: () => ({
      type: "static",
      effect: { type: "challenge_damage_stat_source", stat: "willpower", affectedPlayer: "self" },
    }),
  },

  // ============= BANISH ======================================================
  // "banish any number of chosen opposing characters with total {S} N or less"
  // — Leviathan IT'S A MACHINE. Aggregate-sum cap on the selection. Place
  // before the plain "banish chosen character with X {S} or less" so the
  // "total" variant matches first.
  {
    name: "banish_any_number_opposing_total_strength",
    pattern: /^you may banish any number of chosen opposing characters with total \{S\} (\d+) or less/i,
    build: (m) => ({
      type: "banish",
      isMay: true,
      target: {
        type: "chosen",
        count: "any",
        filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] },
        totalStrengthAtMost: parseInt(m[1], 10),
      },
    }),
  },

  // "banish any number of your items" — Royal Tantrum's banish phase.
  // Paired with a follow-up "draw a card for each item banished this way"
  // that compiles into a cost_result draw.
  {
    name: "banish_any_number_your_items",
    pattern: /^banish any number of your items/i,
    build: () => ({
      type: "banish",
      target: {
        type: "chosen",
        count: "any",
        filter: { owner: { type: "self" }, zone: "play", cardType: ["item"] },
      },
    }),
  },

  // "banish chosen character with N {S} or less" — strength-filtered banish
  {
    name: "banish_chosen_char_strength_filter",
    pattern: /^banish chosen character with (\d+) \{S\} or less/i,
    build: (m) => ({
      type: "banish",
      target: {
        type: "chosen",
        filter: { zone: "play", cardType: ["character"], strengthAtMost: parseInt(m[1], 10) },
      },
    }),
  },
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
  // Mass "exert all opposing characters" — 3× hits. Use target:all filter
  // (zone:play, cardType:character, owner:opponent). Must come before
  // the chosen-opposing matchers so the "all" keyword wins.
  {
    name: "exert_all_opposing_characters",
    pattern: /^exert all opposing characters/i,
    build: () => ({
      type: "exert",
      target: {
        type: "all",
        filter: { zone: "play", cardType: ["character"], owner: { type: "opponent" } },
      },
    }),
  },
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
    name: "ready_this_character_may",
    pattern: /^you may ready this character/i,
    build: () => ({ type: "ready", target: { type: "this" }, isMay: true }),
  },
  // "you may ready another chosen character. If you do, they can't quest
  // for the rest of this turn." — ready with followUpEffects
  {
    name: "ready_another_may_cant_quest",
    pattern: /^you may ready another chosen character\. If you do, they can't quest for the rest of this turn/i,
    build: () => ({
      type: "ready",
      target: {
        type: "chosen",
        filter: { zone: "play", cardType: ["character"], excludeSelf: true },
      },
      isMay: true,
      followUpEffects: [
        {
          type: "cant_action",
          action: "quest",
          target: { type: "last_resolved_target" },
          duration: "end_of_turn",
        },
      ],
    }),
  },
  // "you may ready chosen Super character. If you do, they can't quest..."
  {
    name: "ready_chosen_trait_may_cant_quest",
    pattern: /^you may ready chosen ([A-Z][a-zA-Z]*) character\. If you do, they can't quest for the rest of this turn/i,
    build: (m) => ({
      type: "ready",
      target: {
        type: "chosen",
        filter: { zone: "play", cardType: ["character"], hasTrait: m[1] },
      },
      isMay: true,
      followUpEffects: [
        {
          type: "cant_action",
          action: "quest",
          target: { type: "last_resolved_target" },
          duration: "end_of_turn",
        },
      ],
    }),
  },
  {
    name: "ready_chosen_character",
    pattern: /^ready chosen character/i,
    build: () => ({ type: "ready", target: chosenCharacter() }),
  },

  // ============= DAMAGE ======================================================
  // Compound trait filter: "chosen opposing X or Y character"
  {
    name: "deal_damage_may_n_opp_trait_or",
    pattern: /^you may deal (\d+) damage to chosen opposing ([A-Z][a-z]+) or ([A-Z][a-z]+) character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: {
        type: "chosen",
        filter: {
          zone: "play",
          cardType: ["character"],
          owner: { type: "opponent" },
          hasAnyTrait: [m[2], m[3]],
        },
      },
      isMay: true,
    }),
  },
  // ORDER MATTERS: opposing variant before the generic chosen-character
  // matchers. "you may deal N damage to chosen opposing character" — 3×
  // hits in unmatched list 2026-04-21.
  {
    name: "deal_damage_may_n_opp",
    pattern: /^you may deal (\d+) damage to chosen opposing character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: chosenCharacter({ opposing: true }),
      isMay: true,
    }),
  },
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
  // "deal N damage to each opposing character" — mass deal via target:all
  // opposing. Sudden Chill / Ursula's Trickery family. 3× hits.
  {
    name: "deal_damage_each_opposing",
    pattern: /^deal (\d+) damage to each opposing character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: {
        type: "all",
        filter: { zone: "play", cardType: ["character"], owner: { type: "opponent" } },
      },
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
  // "deal N damage to the challenging character" — triggering_card target
  {
    name: "deal_damage_may_triggering",
    pattern: /^you may deal (\d+) damage to the challenging character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: { type: "triggering_card" },
      isMay: true,
    }),
  },
  // "deal N damage to that character" — last_resolved_target
  {
    name: "deal_damage_that_character",
    pattern: /^deal (\d+) damage to that character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: { type: "last_resolved_target" },
    }),
  },
  // "deal N damage to another chosen character" — second target in a chain
  {
    name: "deal_damage_may_n_another",
    pattern: /^you may deal (\d+) damage to another chosen character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: chosenCharacter(),
      isMay: true,
    }),
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
  // "Move up to N damage from chosen character of yours to this character"
  {
    name: "move_damage_yours_to_this",
    pattern: /^(?:you may )?[Mm]ove up to (\d+) damage (?:counters? )?from chosen character of yours to this character/i,
    build: (m) => ({
      type: "move_damage",
      amount: n(m[1]),
      isUpTo: true,
      source: { type: "chosen", filter: { zone: "play", cardType: ["character"], owner: { type: "self" } } },
      destination: { type: "this" },
    }),
  },
  // "move all damage from this character to chosen opposing character"
  {
    name: "move_all_damage_this_to_opp",
    pattern: /^move all damage from this character to chosen opposing character/i,
    build: () => ({
      type: "move_damage",
      amount: "all",
      source: { type: "this" },
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
  // "remove up to N damage from them" — triggering_card target
  {
    name: "remove_damage_from_them",
    pattern: /^(?:you may )?remove up to (\d+) damage from them/i,
    build: (m) => ({
      type: "remove_damage",
      amount: n(m[1]),
      target: { type: "triggering_card" },
      isUpTo: true,
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
  // "remove up to N damage from this location/character"
  {
    name: "remove_damage_from_this",
    pattern: /^(?:you may )?remove up to (\d+) damage from this (?:location|character)/i,
    build: (m) => ({
      type: "remove_damage",
      amount: n(m[1]),
      target: { type: "this" },
      isUpTo: true,
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
  // remove_damage — hand-wired data is split between `hasDamage:true` and
  // `cardType:["character"]` target filters. The cardType form is more
  // common so we emit that; user corrects on the minority.
  {
    name: "remove_damage_up_to_may",
    pattern: /^you may remove up to (\d+) damage from chosen character/i,
    build: (m) => ({
      type: "remove_damage",
      amount: n(m[1]),
      target: chosenCharacter(),
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
      target: chosenCharacter(),
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
  // "each opposing character gets -N {S} until the start of your next turn"
  // Mass stat mod — 3× hits in unmatched list. Target:all opposing characters.
  // The duration suffix is consumed by the chain parser's withDuration(); here
  // we emit without a duration and let the enclosing parser attach it.
  {
    name: "each_opposing_gets_stat",
    pattern: /^each opposing character gets ([+-]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1], 10), m[2], {
      type: "all",
      filter: { zone: "play", cardType: ["character"], owner: { type: "opponent" } },
    }),
  },
  // "your characters get +N {S} this turn" — mass positive-stat on own chars.
  // (Hero Work uses this but also chains a grant_keyword — handled by the
  // outer chain parser. Standalone use: Be Our Guest follow-up etc.)
  {
    name: "your_characters_get_stat",
    pattern: /^your characters get ([+-]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1], 10), m[2], {
      type: "all",
      filter: { zone: "play", cardType: ["character"], owner: { type: "self" } },
    }),
  },
  // "This character gets +1 {S} for each card in your hand." — dynamic stat
  // via modify_stat_per_count with a hand-count filter. 3× hits. Only a few
  // stats have this form in the existing pool (+1 per X trait, per X card).
  {
    name: "this_character_gets_stat_per_card_in_hand",
    pattern: /^this character gets ([+-]?\d+) \{(S|W|L)\} for each card in your hand/i,
    build: (m) => {
      const perCount = parseInt(m[1], 10);
      const stat = m[2] === "S" ? "strength" : m[2] === "W" ? "willpower" : "lore";
      return {
        type: "modify_stat_per_count",
        stat,
        perCount,
        countFilter: { owner: { type: "self" }, zone: "hand" },
        target: { type: "this" },
      };
    },
  },
  // "This character gets +1 {S} for each other X character you have in play"
  // — common dynamic stat (Shenzi, Alien, etc). Already partially covered by
  // existing patterns; adding for the "each other X" shape specifically.
  {
    name: "this_character_gets_stat_per_other_trait_char",
    pattern: /^this character gets ([+-]?\d+) \{(S|W|L)\} for each other (\w+) character you have in play/i,
    build: (m) => {
      const perCount = parseInt(m[1], 10);
      const stat = m[2] === "S" ? "strength" : m[2] === "W" ? "willpower" : "lore";
      const trait = m[3];
      const capTrait = trait.charAt(0).toUpperCase() + trait.slice(1);
      return {
        type: "modify_stat_per_count",
        stat,
        perCount,
        countFilter: {
          owner: { type: "self" },
          zone: "play",
          cardType: ["character"],
          hasTrait: capTrait,
          excludeSelf: true,
        },
        target: { type: "this" },
      };
    },
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
  // "Up to N chosen characters can't quest until the start of your next turn"
  {
    name: "up_to_n_cant_quest",
    pattern: /^Up to (\d+) chosen characters can't quest until the start of your next turn/i,
    build: (m) => ({
      type: "cant_action",
      action: "quest",
      target: {
        type: "chosen",
        count: parseInt(m[1], 10),
        filter: { zone: "play", cardType: ["character"] },
      },
      isUpTo: true,
      duration: "until_caster_next_turn",
    }),
  },
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
  // "chosen opposing character can't challenge and must quest during their
  // next turn if able" — compound: can't challenge + forced quest. This is
  // actually two effects in the engine; render as cant_challenge + must_quest.
  {
    name: "chosen_opp_cant_challenge_must_quest",
    pattern: /^chosen opposing character can't challenge and must quest during their next turn(?: if able)?/i,
    build: () => ({
      type: "cant_action",
      action: "challenge",
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
  // Non-opposing variants
  {
    name: "chosen_cant_challenge_next_turn",
    pattern: /^chosen character can't challenge during their next turn/i,
    build: () => ({
      type: "cant_action",
      action: "challenge",
      target: chosenCharacter(),
      duration: "end_of_owner_next_turn",
    }),
  },
  {
    name: "chosen_cant_quest_next_turn",
    pattern: /^chosen character can't quest during their next turn/i,
    build: () => ({
      type: "cant_action",
      action: "quest",
      target: chosenCharacter(),
      duration: "end_of_owner_next_turn",
    }),
  },

  // ============= DISCARD =====================================================
  // "discard your hand" (all cards)
  {
    name: "discard_your_hand",
    pattern: /^discard your hand/i,
    build: () => ({
      type: "discard_from_hand",
      amount: "all",
      target: { type: "self" },
    }),
  },
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
  // "chosen opponent reveals their hand and discards a[n] <type> card of your choice"
  {
    name: "opponent_reveals_discards_your_choice",
    pattern: /^chosen opponent reveals their hand and discards an? (\w+) card of your choice/i,
    build: (m) => ({
      type: "discard_from_hand",
      amount: 1,
      target: { type: "opponent" },
      chooser: "controller",
      filter: { cardType: [m[1].toLowerCase()] },
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
    name: "return_this_card_may",
    pattern: /^you may return this card to your hand/i,
    build: () => ({ type: "return_to_hand", target: { type: "this" }, isMay: true }),
  },
  {
    name: "return_this_card",
    pattern: /^return this card to your hand/i,
    build: () => ({ type: "return_to_hand", target: { type: "this" } }),
  },
  // "return chosen character to their player's hand" — bounce
  {
    name: "return_chosen_character_may",
    pattern: /^you may return chosen character to their player['’]s hand/i,
    build: () => ({
      type: "return_to_hand",
      target: chosenCharacter(),
      isMay: true,
    }),
  },
  {
    name: "return_chosen_character",
    pattern: /^return chosen character to their player['’]s hand/i,
    build: () => ({ type: "return_to_hand", target: chosenCharacter() }),
  },
  {
    name: "return_chosen_opposing_character",
    pattern: /^return chosen opposing character to their player['’]s hand/i,
    build: () => ({
      type: "return_to_hand",
      target: chosenCharacter({ opposing: true }),
    }),
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
  // "return an action card named X from your discard to your hand"
  {
    name: "return_named_action_from_discard",
    pattern: /^(?:you may )?return an action card named ([A-Z][\w''\- ]*?) from your discard to your hand/i,
    build: (m) => ({
      type: "return_to_hand",
      isMay: /^you may /i.test(m[0]) || undefined,
      target: {
        type: "chosen",
        filter: {
          zone: "discard",
          cardType: ["action"],
          hasName: m[1].trim(),
          owner: { type: "self" },
        },
      },
    }),
  },
  // "return [another] item card from your discard to your hand"
  {
    name: "return_item_from_discard",
    pattern: /^(?:you may )?return (?:another |an )?item card from your discard to your hand/i,
    build: (m) => ({
      type: "return_to_hand",
      isMay: /^you may /i.test(m[0]) || undefined,
      target: {
        type: "chosen",
        filter: { zone: "discard", cardType: ["item"], owner: { type: "self" } },
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
  // `put_into_inkwell` with `fromZone:"deck"` for "top of deck" and omitted
  // fromZone with target:this for "put this card in your inkwell".
  // `enterExerted:true` is always set for this oracle phrasing (the "facedown
  // and exerted" suffix).
  {
    name: "put_top_deck_into_inkwell",
    pattern: /^you may put the top card of your deck into your inkwell facedown and exerted/i,
    build: () => ({
      type: "put_into_inkwell",
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
      type: "put_into_inkwell",
      target: { type: "this" },
      isMay: true,
      enterExerted: true,
    }),
  },

  // ============= COST REDUCTION =============================================
  // "you pay N {I} less for the next <type> you play this turn"
  {
    name: "cost_reduction_next_character",
    pattern: /^you pay (\d+) \{I\} less for the next character you play this turn/i,
    build: (m) => ({
      type: "cost_reduction",
      amount: parseInt(m[1], 10),
      filter: { cardType: ["character"] },
    }),
  },
  {
    name: "cost_reduction_next_item",
    pattern: /^you pay (\d+) \{I\} less for the next item you play this turn/i,
    build: (m) => ({
      type: "cost_reduction",
      amount: parseInt(m[1], 10),
      filter: { cardType: ["item"] },
    }),
  },
  {
    name: "cost_reduction_next_action",
    pattern: /^you pay (\d+) \{I\} less for the next action you play this turn/i,
    build: (m) => ({
      type: "cost_reduction",
      amount: parseInt(m[1], 10),
      filter: { cardType: ["action"] },
    }),
  },

  // ============= LOOK AT TOP / REVEAL =======================================
  // "look at the top N cards of your deck. You may [reveal] a X [card] and
  // put it into your hand. Put the rest on the bottom of your deck [in any
  // order]." — choose_from_top with filter
  {
    name: "look_at_top_choose_put_hand",
    pattern: /^look at the top (\d+) cards? of your deck\. You may (?:reveal )?(?:a |an )(.+?) and put (?:it|them) into your hand\. Put the rest on the bottom of your deck(?: in any order)?/i,
    build: (m) => ({
      type: "look_at_top",
      count: parseInt(m[1], 10),
      action: "choose_from_top",
      filter: parseSimpleFilter(m[2].trim()),
      target: { type: "self" },
      isMay: true,
      maxToHand: 1,
      revealPicks: true,
    }),
  },
  // "look at the top N cards of your deck. You may put one into your hand.
  // Put the rest on the bottom of your deck [in any order]."
  {
    name: "look_at_top_may_put_one",
    pattern: /^look at the top (\d+) cards? of your deck\. You may put one into your hand\. Put the rest on the bottom of your deck(?: in any order)?/i,
    build: (m) => ({
      type: "look_at_top",
      count: parseInt(m[1], 10),
      action: "choose_from_top",
      target: { type: "self" },
      isMay: true,
      maxToHand: 1,
    }),
  },
  // "you may reveal the top card of your deck. If it's a [type] card, you
  // may put it into your hand. Otherwise, put it on the bottom of your deck."
  {
    name: "reveal_top_conditional_hand_or_bottom",
    pattern: /^you may reveal the top card of your deck\. If it's (?:a |an )([\w ]+?) card, you may put it into your hand\. Otherwise, put it on the bottom of your deck/i,
    build: (m) => ({
      type: "look_at_top",
      count: 1,
      action: "choose_from_top",
      filter: parseSimpleFilter(m[1].trim()),
      target: { type: "self" },
      isMay: true,
      maxToHand: 1,
      revealPicks: true,
    }),
  },
  // "Look at the top N cards of your deck. Put one into your hand and the
  // other into your inkwell facedown and exerted." — split routing
  {
    name: "look_at_top_hand_and_inkwell",
    pattern: /^Look at the top (\d+) cards? of your deck\. Put one into your hand and the other into your inkwell facedown and exerted/i,
    build: (m) => ({
      type: "look_at_top",
      count: parseInt(m[1], 10),
      action: "choose_from_top",
      target: { type: "self" },
      maxToHand: 1,
      restPlacement: "inkwell_exerted",
    }),
  },

  // "look at the top card of your deck. Put it on either the top [of your deck]
  // or into your discard" — top_or_discard variant
  {
    name: "look_at_top_or_discard",
    pattern: /^(?:you may )?look at the top card of your deck\. Put it on either the top (?:of your deck )?or into your discard/i,
    build: (m) => ({
      type: "look_at_top",
      count: 1,
      action: "top_or_bottom",
      target: { type: "self" },
      restPlacement: "discard",
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
  // "look at the top card of your deck. Put it on either the top or the bottom
  // of your deck" — classic top_or_bottom
  {
    name: "look_at_top_or_bottom",
    pattern: /^(?:you may )?look at the top (\d+)? ?cards? of your deck\. Put (?:it|them) on (?:either )?the top or (?:the )?bottom of your deck/i,
    build: (m) => ({
      type: "look_at_top",
      count: m[1] ? parseInt(m[1], 10) : 1,
      action: "top_or_bottom",
      target: { type: "self" },
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },

  // ============= DECK MANIPULATION ==========================================
  // ORDER MATTERS: reveal_top_switch_3way_type must come BEFORE
  // put_top_card_of_own_deck_into_discard because both match the same
  // "you may put the top card of your deck into your discard" prefix —
  // without the 3-way pattern winning first, the shorter matcher returns
  // just the mill and the switch body is lost.
  {
    name: "reveal_top_switch_3way_type",
    // Jack-jack Parr WEIRD THINGS ARE HAPPENING: mill + switch on card type
    // (character / action-or-item / location). Multi-line oracle — the
    // compiler preserves newlines in the rulesText, and each bullet line
    // starts with "• ". Regex uses `[\s\S]` to span newlines.
    pattern: /^you may put the top card of your deck into your discard\.\s*if its card type is:\s*•?\s*character,\s*([\s\S]+?)\s*•?\s*action or item,\s*([\s\S]+?)\s*•?\s*location,\s*([\s\S]+?)\.?\s*$/i,
    build: (m, ctx) => {
      const charText = m[1].trim().replace(/\.$/, "");
      const actItemText = m[2].trim().replace(/\.$/, "");
      const locText = m[3].trim().replace(/\.$/, "");
      const charEffect = matchEffect(charText + ".", ctx);
      const actItemEffect = matchEffect(actItemText + ".", ctx);
      const locEffect = matchEffect(locText + ".", ctx);
      const cases: any[] = [];
      if (charEffect) cases.push({ filter: { cardType: ["character"] }, effects: [charEffect.json] });
      if (actItemEffect) cases.push({ filter: { cardType: ["action", "item"] }, effects: [actItemEffect.json] });
      if (locEffect) cases.push({ filter: { cardType: ["location"] }, effects: [locEffect.json] });
      return { type: "reveal_top_switch", isMay: true, cases };
    },
  },
  {
    name: "put_top_card_of_own_deck_into_discard",
    pattern: /^(?:you may )?put the top card of your deck into your discard/i,
    build: (m) => ({
      type: "put_top_cards_into_discard",
      amount: 1,
      target: "self",
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },


  // "Move a character of yours to a location for free" — move_character
  {
    name: "move_character_to_location_free",
    pattern: /^Move a character of yours to a location for free/i,
    build: () => ({
      type: "move_character",
      character: { type: "chosen", filter: { owner: { type: "self" }, cardType: ["character"], zone: "play" } },
      location: { type: "chosen", filter: { cardType: ["location"], zone: "play" } },
      cost: "free",
    }),
  },
  // "draw cards equal to that location's {L}" — dynamic draw from last target
  {
    name: "draw_equal_to_location_lore",
    pattern: /^draw cards equal to that location's \{L\}/i,
    build: () => ({
      type: "draw",
      amount: "last_target_location_lore",
      target: { type: "self" },
    }),
  },

  // "Shift a character from your discard for free" — play_card with shift-only
  // mode. Like Circle of Life but restricted to shift plays. Engine needs a
  // `playMode: "shift"` flag on play_card (not yet implemented).
  {
    name: "shift_from_discard_free",
    pattern: /^Shift a character from your discard for free/i,
    build: () => ({
      type: "play_card",
      sourceZone: "discard",
      filter: { zone: "discard", cardType: ["character"] },
      cost: "free",
      playMode: "shift",
    }),
  },

  // ============= BANISH THIS (as a standalone cost-effect for "A to B") =====
  {
    name: "banish_this_item_or_char",
    pattern: /^banish this (?:item|character|location)/i,
    build: () => ({ type: "banish", target: { type: "this" } }),
  },
  // "banish another chosen character of yours"
  {
    name: "banish_another_chosen_yours",
    pattern: /^banish another chosen character of yours/i,
    build: () => ({
      type: "banish",
      target: {
        type: "chosen",
        filter: { zone: "play", cardType: ["character"], owner: { type: "self" }, excludeSelf: true },
      },
    }),
  },
  // "play this character for free" — reward side of "A to B"
  {
    name: "play_this_for_free",
    pattern: /^play this character for free/i,
    build: () => ({ type: "grant_play_for_free_self" }),
  },
  // "give this character Rush/Evasive/etc. this turn" — reward side
  {
    name: "give_this_keyword_this_turn",
    pattern: /^give this character (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))? this turn/i,
    build: (m) => {
      const out: Json = {
        type: "grant_keyword",
        keyword: m[1].toLowerCase(),
        target: { type: "this" },
        duration: "end_of_turn",
      };
      if (m[2]) out.value = parseInt(m[2], 10);
      return out;
    },
  },

  // ============= PUT CARD ON TOP/BOTTOM OF DECK =============================
  // "put [N|a|an] X card(s) from your discard on the bottom of your deck"
  // Unified: amount comes from the leading number or defaults to 1 for "a/an".
  {
    name: "put_from_discard_on_bottom",
    pattern: /^put (?:(\d+) |(a |an ))([\w ]+?) cards? from your discard on the bottom of your deck/i,
    build: (m) => ({
      type: "put_card_on_bottom_of_deck",
      from: "discard",
      amount: m[1] ? parseInt(m[1], 10) : 1,
      filter: parseSimpleFilter(m[3].trim()),
    }),
  },
  // "you may put a character card from your discard on the top of your deck"
  {
    name: "put_from_discard_on_top",
    pattern: /^(?:you may )?put (?:a |an )([\w ]+?) card from your discard on the top of your deck/i,
    build: (m) => ({
      type: "put_card_on_bottom_of_deck",
      from: "discard",
      position: "top",
      filter: parseSimpleFilter(m[1].trim()),
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },

  // ============= SHUFFLE INTO DECK ==========================================
  // "Each player shuffles all character cards from their discard into their deck"
  {
    name: "each_player_shuffles_from_discard",
    pattern: /^Each player shuffles all ([\w ]+?) cards? from their discard into their deck/i,
    build: (m) => ({
      type: "each_player",
      scope: "all",
      effects: [{
        type: "shuffle_into_deck",
        target: { type: "all", filter: { zone: "discard", ...parseSimpleFilter(m[1].trim()) } },
      }],
    }),
  },
  // "put all X cards from your discard on the bottom of your deck in any order"
  // Bouncing Ducky REPURPOSED. Reuses the existing return_all_to_bottom_in_order
  // effect type (precedent: Under the Sea) — the handler routes single-card
  // results straight to the bottom and 2+ results through a choose_order
  // PendingChoice for the controller to pick the stacking order.
  {
    name: "put_all_from_discard_to_bottom",
    pattern: /^put all ([\w ]+?) cards? from your discard on the bottom of your deck(?: in any order)?/i,
    build: (m) => ({
      type: "return_all_to_bottom_in_order",
      filter: { zone: "discard", owner: { type: "self" }, ...parseSimpleFilter(m[1].trim()) },
    }),
  },

  // ============= ESCAPE PLAN PATTERN =========================================
  // "Each player chooses N of their characters and puts them into their
  // inkwell facedown and exerted." Bilateral each_player over all players
  // (caster + opponent in 2P) with N sequential put_into_inkwell prompts
  // per iteration. Each iteration's filter owner:"self" resolves to the
  // iteration's player via each_player's controller rotation.
  {
    name: "each_player_inkwell_exerted_n_chars",
    pattern: /^each player chooses (\d+) of their characters and puts them into their inkwell(?: facedown)?(?: and)?(?: exerted)?/i,
    build: (m) => {
      const count = n(m[1]);
      const inner = {
        type: "put_into_inkwell",
        target: {
          type: "chosen",
          filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] },
        },
        enterExerted: true,
        fromZone: "play",
      };
      return {
        type: "each_player",
        scope: "all",
        effects: Array.from({ length: count }, () => inner),
      };
    },
  },

  // (reveal_top_switch_3way_type matcher moved earlier in the list so it
  // beats the shorter put_top_card_of_own_deck_into_discard prefix match.)

  // ============= FAMILY SCATTERED PATTERN ===================================
  // "Chosen opponent chooses 3 of their characters and returns one of those
  // cards to their hand, puts one on the bottom of their deck, and puts
  // one on the top of their deck." Emits 3 sequential effects, each with
  // chooser:"target_player" so the opposing player picks. No new primitive
  // — chooser on put_card_on_bottom_of_deck from:"play" respects
  // target_player as of the 2026-04-21 extension.
  //
  // This matcher emits a 3-effect sequence but compile-cards' caller
  // expects a single ability — so the sequence is wrapped in an array by
  // a follow-up flatten pass. For now, emit as a `sequential` effect which
  // the engine already flattens via the action-effects dispatcher.
  {
    name: "opponent_partition_3way_hand_bottom_top",
    pattern: /^chosen opponent chooses 3 of their characters and returns one of those cards to their hand,\s*puts one on the bottom of their deck,\s*and puts one on the top of their deck/i,
    build: () => {
      const opponentChars = {
        type: "chosen",
        chooser: "target_player",
        filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] },
      };
      return {
        // sequential-as-container: compile-cards' wrapper unwraps the
        // inner effects into actionEffects[] on the emitted card.
        type: "__actionEffects__",
        effects: [
          { type: "return_to_hand", target: opponentChars },
          { type: "put_card_on_bottom_of_deck", from: "play", position: "bottom", target: opponentChars },
          { type: "put_card_on_bottom_of_deck", from: "play", position: "top", target: opponentChars },
        ],
      };
    },
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

  // characters_in_play_gte — "if you have N or more [other] [Trait] characters in play"
  {
    name: "chars_in_play_gte_other_trait",
    pattern: /^if you have (\d+) or more other ([A-Z][a-zA-Z]*) characters in play/i,
    build: (m) => ({
      type: "you_control_matching",
      filter: {
        cardType: ["character"],
        zone: "play",
        owner: { type: "self" },
        hasTrait: m[2],
        excludeSelf: true,
        countAtLeast: parseInt(m[1], 10),
      },
    }),
  },
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
  // "if you have a Super or Hero character in play" — compound trait OR.
  // Emits you_control_matching with anyOf filter (the canonical form).
  {
    name: "has_char_with_trait_or",
    pattern: /^(?:if|while) you have a ([A-Z][a-zA-Z]*) or ([A-Z][a-zA-Z]*) character in play/i,
    build: (m) => ({
      type: "you_control_matching",
      filter: {
        cardType: ["character"],
        zone: "play",
        owner: { type: "self" },
        anyOf: [{ hasTrait: m[1] }, { hasTrait: m[2] }],
      },
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
  // "if a <Trait> character is in play" — no qualifier means your board,
  // per set 4 Iduna ROYAL SCHEMES precedent ("if a Princess or Queen
  // character is in play" → has_character_with_trait player:self).
  {
    name: "any_trait_char_in_play",
    pattern: /^if (?:a|an) ([A-Z][a-zA-Z]*) character is in play/i,
    build: (m) => ({
      type: "has_character_with_trait",
      trait: m[1],
      player: { type: "self" },
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
  // "if you played a Trait character this turn" — with trait
  {
    name: "played_a_trait_character_this_turn",
    pattern: /^if you(?:'ve| have)? played a ([A-Z][a-zA-Z]*) character this turn/i,
    build: (m) => ({
      type: "played_this_turn",
      amount: 1,
      filter: { cardType: ["character"], hasTrait: m[1] },
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

  // "if N or more [other] cards were put into your discard this turn"
  // Fixed 2026-04-23: discriminator was `cards_discarded_this_turn_gte` which
  // doesn't exist in the Condition union — compiled JSON would silently fail
  // the card-status invalid-field check. Correct type is
  // `cards_put_into_discard_this_turn_atleast`.
  {
    name: "cards_put_into_discard_this_turn_atleast",
    pattern: /^if (\d+) or more (?:other )?cards were put into your discard this turn/i,
    build: (m) => ({
      type: "cards_put_into_discard_this_turn_atleast",
      amount: parseInt(m[1], 10),
    }),
  },

  // your_first_turn_as_underdog — "If this is your first turn and you're not
  // the first player". Straight/curly apostrophes both accepted.
  {
    name: "first_turn_underdog",
    pattern: /^if this is your first turn and you['’]re not the first player/i,
    build: () => ({ type: "your_first_turn_as_underdog" }),
  },

  // this-card-state / damage checks
  {
    name: "this_has_damage_gte",
    pattern: /^if this character has (\d+) or more damage/i,
    build: (m) => ({ type: "this_has_damage", amount: parseInt(m[1], 10) }),
  },
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

  // played_via_sing — "If a character sang this song, ..." (What Else Can I
  // Do?). Read from the song's own CardInstance.playedViaSing flag (set in
  // applyPlayCard when a singer is present). Mirrors played_via_shift.
  {
    name: "played_via_sing",
    pattern: /^if a character sang this song/i,
    build: () => ({ type: "played_via_sing" }),
  },

  // character_was_banished_this_turn — "If a character named X was banished
  // this turn" (Buzz's Arm) / "If one of your Toy characters was banished
  // this turn" (Wind-Up Frog). Generalized CardFilter form replaces the
  // older name-only variant.
  {
    name: "char_named_was_banished_this_turn",
    pattern: /^if a character named ([A-Z][\w'’\- ]*?) was banished this turn/i,
    build: (m) => ({
      type: "character_was_banished_this_turn",
      filter: { hasName: m[1].trim() },
    }),
  },
  {
    name: "char_with_trait_was_banished_this_turn",
    pattern: /^if one of your ([A-Z][a-zA-Z]*) characters was banished this turn/i,
    build: (m) => ({
      type: "character_was_banished_this_turn",
      filter: {
        cardType: ["character"],
        hasTrait: m[1],
        owner: { type: "self" },
      },
    }),
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
  // Ravensburger data wraps keywords in angle brackets: <Rush>, <Evasive>.
  // Also uses curly apostrophes (U+2018/2019) instead of straight ones.
  // Normalize both so our matchers work. Strip song-cost-reminder and
  // keyword-reminder parentheticals. Use normalized text for unmatched
  // reporting so the display reflects what the matchers actually see.
  let rest = original
    .replace(/[\u2018\u2019]/g, "'")   // curly → straight apostrophes
    .replace(/<(Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish|Shift)>/gi, "$1")
    .replace(/^\(A character with cost \d+ or more can \{E\} to sing this song for free\.\)\s*/i, "")  // song cost reminder
    .replace(/\s*\([^)]*\)\s*\.?$/, "")  // trailing reminder parens
    .trim();
  const normalized = rest; // for unmatched reporting

  // -------- Leading condition ----------------------------------------------
  // The forward decompiler emits conditions in two places: as a leading
  // "During your turn, ..." clause, or as a post-trigger "if X, ..." phrase.
  // On statics with a condition, the oracle text is "If X, this character
  // can't ...". Try a generic condition match first; fall back to the hard-
  // coded turn forms for phrasings the condition table doesn't cover.
  let leadingCondition: Json | null = null;
  let oncePerTurn = false;
  const leadCond = /^(?:During your turn|Once during your turn|Once per turn|During opponents'?\s*turns?),\s*/i.exec(rest);
  if (leadCond) {
    if (/^Once\b/i.test(leadCond[0])) {
      leadingCondition = { type: "is_your_turn" };
      oncePerTurn = true;
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
        if (oncePerTurn) ability.oncePerTurn = true;
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
      if (oncePerTurn) ability.oncePerTurn = true;
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

  // "Your X characters can move here for free." — location move cost reduction
  const statMoveHereFree = /^Your (\w+) characters can move here for free\.?$/i.exec(rest);
  if (statMoveHereFree) {
    const qualifier = statMoveHereFree[1];
    // "exerted" / "damaged" are states, not traits — emit the corresponding
    // CardFilter flag rather than a hasTrait no-op.
    const stateFilter: Record<string, unknown> =
      qualifier.toLowerCase() === "exerted" ? { isExerted: true } :
      qualifier.toLowerCase() === "damaged" ? { hasDamage: true } :
      { hasTrait: qualifier };
    return {
      ability: {
        type: "static",
        effect: {
          type: "move_to_self_cost_reduction",
          amount: "all",
          filter: {
            owner: { type: "self" },
            zone: "play",
            cardType: ["character"],
            ...stateFilter,
          },
        },
      },
      unmatched: "",
    };
  }

  // "While you have only 1 character here, they get +N {W} and +N {L}."
  const statWhileOneHere = /^While you have only 1 character here, they get ([+-]?\d+) \{(S|W|L)\} and ([+-]?\d+) \{(S|W|L)\}\.?$/i.exec(rest);
  if (statWhileOneHere) {
    const stat1 = statWhileOneHere[2].toUpperCase() === "S" ? "strength" : statWhileOneHere[2].toUpperCase() === "W" ? "willpower" : "lore";
    const stat2 = statWhileOneHere[4].toUpperCase() === "S" ? "strength" : statWhileOneHere[4].toUpperCase() === "W" ? "willpower" : "lore";
    return {
      ability: {
        type: "static",
        condition: { type: "characters_here_gte", amount: 1, op: "==" },
        effect: [
          { type: "modify_stat", stat: stat1, amount: parseInt(statWhileOneHere[1], 10), target: { type: "all", filter: { atLocation: "this", cardType: ["character"] } } },
          { type: "modify_stat", stat: stat2, amount: parseInt(statWhileOneHere[3], 10), target: { type: "all", filter: { atLocation: "this", cardType: ["character"] } } },
        ],
      },
      unmatched: "",
    };
  }

  // "Characters get +N {stat} while here." — location static
  const statWhileHere = /^Characters get ([+-]?\d+) \{(S|W|L)\} while here\.?$/i.exec(rest);
  if (statWhileHere) {
    const stat = statWhileHere[2].toUpperCase() === "S" ? "strength" : statWhileHere[2].toUpperCase() === "W" ? "willpower" : "lore";
    return {
      ability: {
        type: "static",
        effect: {
          type: "modify_stat",
          stat,
          amount: parseInt(statWhileHere[1], 10),
          target: { type: "all", filter: { atLocation: "this", cardType: ["character"] } },
        },
      },
      unmatched: "",
    };
  }

  // "This character can challenge ready characters." — Namaari Morning Mist
  // shape. Granted as a static flag the reducer consults when validating
  // challenges.
  const statChallengeReady = /^This character can challenge ready characters\.?$/i.exec(rest);
  if (statChallengeReady) {
    const ability: Json = {
      type: "static",
      effect: { type: "can_challenge_ready", target: { type: "this" } },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character can quest the turn he's/they're played."
  const statQuestTurnPlayed = /^This character can quest the turn (?:he's|she's|they're|it's) played\.?$/i.exec(rest);
  if (statQuestTurnPlayed) {
    const ability: Json = {
      type: "static",
      effect: { type: "can_quest_turn_played", target: { type: "this" } },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character may enter play exerted."
  const statMayEnterExerted = /^This character may enter play exerted\.?$/i.exec(rest);
  if (statMayEnterExerted) {
    const ability: Json = {
      type: "static",
      effect: { type: "enter_play_exerted_self", isMay: true },
    };
    return { ability, unmatched: "" };
  }

  // "This character also counts as being named X for Shift."
  const statAlternateName = /^This character (?:also )?counts as being named ([A-Z][\w''\- ]*?) for Shift\.?$/i.exec(rest);
  if (statAlternateName) {
    // This is actually an `alternateNames` field, not an ability. Emit a
    // marker so the compiler output can be post-processed to set the field.
    const ability: Json = {
      type: "__alternateNames__",
      names: [statAlternateName[1].trim()],
    };
    return { ability, unmatched: "" };
  }

  // "For each <filter> in your <zone>, you pay N {I} less to play this character"
  // filterPhrase is one of: "character", "item", "location", "<Trait> character",
  // "<Trait> item" etc. Zone is the bare noun ("discard", "hand", "inkwell").
  const statSelfCostCount = /^For each ([\w ]+?) (?:card )?in your (\w+), you pay (\d+) \{I\} less to play this character\.?$/i.exec(rest);
  if (statSelfCostCount) {
    const filterPhrase = statSelfCostCount[1].trim();
    const zone = statSelfCostCount[2].toLowerCase();
    const countFilter: Record<string, unknown> = { zone, owner: { type: "self" } };
    // Parse "<Trait> <CardType>" or just "<CardType>"
    const m = /^(?:([A-Z][a-zA-Z]*) )?(character|item|location|action)s?$/i.exec(filterPhrase);
    if (m) {
      if (m[1]) countFilter.hasTrait = m[1];
      countFilter.cardType = [m[2].toLowerCase()];
    }
    const ability: Json = {
      type: "static",
      effect: {
        type: "self_cost_reduction",
        amount: { type: "count", filter: countFilter },
        perMatch: parseInt(statSelfCostCount[3], 10),
      },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "you may play this card/item for free." — after leading condition is peeled
  const statPlayFreeAfterCond = /^you may play this (?:card|item|character) for free\.?$/i.exec(rest);
  if (statPlayFreeAfterCond) {
    const ability: Json = { type: "static", effect: { type: "grant_play_for_free_self" } };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "Your locations can't be challenged by characters with cost N or less."
  const statLocationProtection = /^Your locations can't be challenged by characters with cost (\d+) or less\.?$/i.exec(rest);
  if (statLocationProtection) {
    return {
      ability: {
        type: "static",
        effect: {
          type: "cant_be_challenged",
          target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["location"] } },
          attackerFilter: { costAtMost: parseInt(statLocationProtection[1], 10), cardType: ["character"] },
        },
      },
      unmatched: "",
    };
  }

  // "This character can't quest unless you have a character with N {W/S} or more in play."
  const statCantQuestUnless = /^This character can't quest unless you have a character with (\d+) \{(S|W)\} or more in play\.?$/i.exec(rest);
  if (statCantQuestUnless) {
    const statField = statCantQuestUnless[2].toUpperCase() === "S" ? "strengthAtLeast" : "willpowerAtLeast";
    return {
      ability: {
        type: "static",
        condition: {
          type: "not",
          condition: {
            type: "you_control_matching",
            filter: {
              cardType: ["character"],
              zone: "play",
              owner: { type: "self" },
              [statField]: parseInt(statCantQuestUnless[1], 10),
            },
          },
        },
        effect: { type: "cant_action_self", action: "quest" },
      },
      unmatched: "",
    };
  }

  // "If you have a character named X in play, you may play this card for free."
  const statPlayFreeIfNamed = /^If you have a character named ([A-Z][\w''\- ]*?) in play, you may play this (?:card|item) for free\.?$/i.exec(rest);
  if (statPlayFreeIfNamed) {
    return {
      ability: {
        type: "static",
        condition: {
          type: "has_character_named",
          name: statPlayFreeIfNamed[1].trim(),
          player: { type: "self" },
        },
        effect: { type: "grant_play_for_free_self" },
      },
      unmatched: "",
    };
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

  // "This character gets +X {S} for each [filter] you have in play" — dynamic
  const statDynamic = /^This character gets \+(\d+) \{(S|W|L)\} for each (other character|card in your hand|.*?) you have in play\.?$/i.exec(rest);
  if (statDynamic) {
    const amt = parseInt(statDynamic[1], 10);
    const statChar = statDynamic[2].toUpperCase();
    const stat = statChar === "S" ? "strength" : statChar === "W" ? "willpower" : "lore";
    const phrase = statDynamic[3].toLowerCase();
    let countFilter: Json;
    if (phrase === "other character") {
      countFilter = { cardType: ["character"], zone: "play", owner: { type: "self" }, excludeSelf: true };
    } else if (phrase === "card in your hand") {
      countFilter = { zone: "hand", owner: { type: "self" } };
    } else {
      countFilter = { zone: "play", owner: { type: "self" } };
    }
    const effect: Json = {
      type: "modify_stat",
      stat,
      amount: { type: "count", filter: countFilter },
      target: { type: "this" },
    };
    const ability: Json = { type: "static", effect };
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

  return { ability: null, unmatched: normalized };
}

// Parse an activated ability shape. Handles explicit "{E} — <body>" and the
// bare effect-chain form (treated as "[exert] — <body>"). Returns a complete
// ability object or null if no effect chain can be parsed.
function tryActivatedAbility(
  text: string,
  leadingCondition: Json | null,
  opts: { requireExplicitCost: boolean },
): Json | null {
  // Cost phrases: {E}, N {I}, Banish this item/character/location.
  const costAtom = `(?:\\{E\\}|\\d+\\s*\\{I\\}|Banish this (?:item|character|location))`;
  const costRe = new RegExp(`^(${costAtom}(?:\\s*,\\s*${costAtom})*)\\s*[—–-]\\s+`, "i");
  const costMatch = costRe.exec(text);
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
    if (/^Banish this (item|character|location)$/i.test(part)) return { type: "banish_self" };
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

// =============================================================================
// CRD COMPOUND SHAPES — "A to B", "A. If you do, B", "A or B"
// -----------------------------------------------------------------------------
// These are the three fundamental effect connectors in Lorcana. They combine
// any cost-action with any reward-action via a structural separator. The
// compiler detects them before the regular single-effect loop so compound
// patterns don't need per-combo hardcoding.
// =============================================================================

/** Shape 1: "A to B" — "[you may] <cost-effect> to <reward-effects>."
 *  The "to" keyword separates a single cost-action from one or more reward
 *  actions. Wraps as `sequential { costEffects: [A], rewardEffects: [B] }`.
 *  Only fires when the " to " appears mid-sentence (not "to your hand" etc.)
 *  and both sides parse as valid effects. */
function tryAtoB(text: string): Json | null {
  // Strip leading "you may " — isMay scopes over the whole sequential
  const isMay = /^you may /i.test(text);
  const inner = isMay ? text.replace(/^you may /i, "") : text;

  // Find " to " that separates cost from reward. We try each " to " position
  // left-to-right: parse left as a single effect (cost), right as an effect
  // chain (reward). First successful split wins.
  let idx = 0;
  while (true) {
    const pos = inner.indexOf(" to ", idx);
    if (pos < 0) break;
    const leftText = inner.slice(0, pos);
    const rightText = inner.slice(pos + 4); // skip " to "
    const costEff = matchEffect(leftText);
    if (costEff && costEff.consumed === leftText.length) {
      const rewardEffs = parseEffectChain(rightText);
      if (rewardEffs && rewardEffs.json.length > 0 && rewardEffs.consumedAll) {
        return {
          type: "sequential",
          ...(isMay ? { isMay: true } : {}),
          costEffects: [costEff.json],
          rewardEffects: rewardEffs.json,
        };
      }
    }
    idx = pos + 4;
  }
  return null;
}

/** Shape 2: "A. If you do, B" — conditional sequential.
 *  "[you may] <cost-effect>. If you do, <reward-effects>."
 *  Same as "A to B" but the connector is ". If you do, ". */
function tryAIfYouDoB(text: string): Json | null {
  const isMay = /^you may /i.test(text);
  const inner = isMay ? text.replace(/^you may /i, "") : text;

  const sep = /\.\s*If you do,\s*/i;
  const m = sep.exec(inner);
  if (!m) return null;

  const leftText = inner.slice(0, m.index);
  const rightText = inner.slice(m.index + m[0].length);
  const costEff = matchEffect(leftText);
  if (costEff && costEff.consumed === leftText.length) {
    const rewardEffs = parseEffectChain(rightText);
    if (rewardEffs && rewardEffs.json.length > 0 && rewardEffs.consumedAll) {
      return {
        type: "sequential",
        ...(isMay ? { isMay: true } : {}),
        costEffects: [costEff.json],
        rewardEffects: rewardEffs.json,
      };
    }
  }
  return null;
}

/** Shape 3: "A or B" — inline choice. "banish her or return another chosen
 *  character of yours to your hand." Wraps as `choose { options: [[A],[B]] }`.
 *  Tries each " or " position left-to-right; first valid split wins. */
function tryAorB(text: string): Json | null {
  let idx = 0;
  while (true) {
    const pos = text.indexOf(" or ", idx);
    if (pos < 0) break;
    const leftText = text.slice(0, pos);
    const rightText = text.slice(pos + 4);
    const leftEff = matchEffect(leftText);
    if (leftEff && leftEff.consumed === leftText.length) {
      const rightEffs = parseEffectChain(rightText);
      if (rightEffs && rightEffs.json.length > 0 && rightEffs.consumedAll) {
        return {
          type: "choose",
          options: [[leftEff.json], rightEffs.json],
        };
      }
    }
    idx = pos + 4;
  }
  return null;
}

// Simple filter parser for look_at_top / reveal_top patterns. Handles:
// "character", "action", "song", "Toy character", "Toy character card or a
// location card named Andy's Room".
function parseSimpleFilter(phrase: string): Json {
  // Strip trailing "card" — "Toy character card" → "Toy character"
  phrase = phrase.replace(/\s+card$/i, "").trim();
  // Compound "X or Y" — e.g. "Toy character or a location named Andy's Room"
  const orMatch = /^(.+?) or (?:a |an )(.+)$/i.exec(phrase);
  if (orMatch) {
    return { anyOf: [parseSimpleFilter(orMatch[1].trim()), parseSimpleFilter(orMatch[2].trim())] };
  }
  // "location [card] named X"
  const locNamed = /^location named (.+)$/i.exec(phrase);
  if (locNamed) return { cardType: ["location"], hasName: locNamed[1].trim() };
  // "action [card] named X"
  const actNamed = /^action named (.+)$/i.exec(phrase);
  if (actNamed) return { cardType: ["action"], hasName: actNamed[1].trim() };
  // "Trait character [card]"
  const traitChar = /^([A-Z][a-zA-Z]*) character(?: card)?$/i.exec(phrase);
  if (traitChar) return { cardType: ["character"], hasTrait: traitChar[1] };
  // Bare types
  if (/^character$/i.test(phrase)) return { cardType: ["character"] };
  if (/^action$/i.test(phrase)) return { cardType: ["action"] };
  if (/^item$/i.test(phrase)) return { cardType: ["item"] };
  if (/^location$/i.test(phrase)) return { cardType: ["location"] };
  if (/^song$/i.test(phrase)) return { cardType: ["action"], hasTrait: "Song" };
  return {};
}

// Effect-side variant of parseYourCharactersGetsStat — consumes the whole
// phrase length and returns it for the chain parser. When a duration is
// present, emits `gain_stats` (the triggered-form canonical per hand-wired
// data); otherwise emits `modify_stat` (rare in triggered context but kept
// for symmetry with static).
function tryFilterTargetStatEffect(text: string): { json: Json; consumed: number } | null {
  const f = parseYourCharactersFilter(text);
  if (!f) return null;
  const after = text.slice(f.consumed);
  const mStat = /^\s+get ([+-]?\d+) \{(S|W|L)\}(?:\s+(this turn|until the start of your next turn))?/i.exec(
    after,
  );
  if (!mStat) return null;
  const amt = parseInt(mStat[1], 10);
  const statChar = mStat[2].toUpperCase();
  const stat = statChar === "S" ? "strength" : statChar === "W" ? "willpower" : "lore";
  const durPhrase = mStat[3];
  const consumed = f.consumed + mStat[0].length;
  if (durPhrase) {
    const eff: Json = { type: "gain_stats", target: { type: "all", filter: f.filter } };
    eff[stat] = amt;
    eff.duration =
      /until the start of your next turn/i.test(durPhrase) ? "until_caster_next_turn" : "this_turn";
    return { json: eff, consumed };
  }
  return {
    json: {
      type: "modify_stat",
      stat,
      amount: amt,
      target: { type: "all", filter: f.filter },
    },
    consumed,
  };
}

function parseYourCharactersGetsStat(text: string): Json | null {
  const f = parseYourCharactersFilter(text);
  if (!f) return null;
  const after = text.slice(f.consumed);
  // "get +N {stat}" optionally followed by " this turn" / "until the start of
  // your next turn". Duration-ful filter-target buffs render as gain_stats
  // (not modify_stat) per existing card JSON.
  const mStat = /^\s+get ([+-]?\d+) \{(S|W|L)\}(?:\s+(this turn|until the start of your next turn))?\.?$/i.exec(after);
  if (!mStat) return null;
  const amt = parseInt(mStat[1], 10);
  const statChar = mStat[2].toUpperCase();
  const stat = statChar === "S" ? "strength" : statChar === "W" ? "willpower" : "lore";
  const durPhrase = mStat[3];
  if (durPhrase) {
    // gain_stats form with individual stat fields.
    const eff: Json = { type: "gain_stats", target: { type: "all", filter: f.filter } };
    eff[stat] = amt;
    eff.duration =
      /until the start of your next turn/i.test(durPhrase) ? "until_caster_next_turn" : "this_turn";
    return eff;
  }
  return {
    type: "modify_stat",
    stat,
    amount: amt,
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

  // ---- CRD compound shapes ------------------------------------------------
  // These three shapes are the fundamental compound-effect connectors in
  // Lorcana. We detect them BEFORE the regular effect loop because they
  // span multiple effects with a structural connector.

  // Shape 1: "A to B" — cost-reward sequential. "you may X to Y."
  // The "to" separates a cost-action from a reward-action.
  const aToB = tryAtoB(rest);
  if (aToB) return { json: [aToB], consumedAll: true, remainder: "" };

  // Shape 2: "A. If you do, B" — conditional sequential. Do A; if it
  // succeeded (was not declined), do B.
  const aIfB = tryAIfYouDoB(rest);
  if (aIfB) return { json: [aIfB], consumedAll: true, remainder: "" };

  // Shape 3: "A or B" — inline choice. "banish her or return another chosen
  // character of yours to your hand." Two single-effect options joined by
  // " or ". Only fires when both sides parse as complete effects.
  const aOrB = tryAorB(rest);
  if (aOrB) return { json: [aOrB], consumedAll: true, remainder: "" };

  const effects: Json[] = [];
  while (rest.length > 0) {
    // Effect-level condition: "If <condition>, <effect>". Peel the condition
    // off and attach it to whatever effect follows. Matches the forward
    // decompiler's `if (e.condition)` wrapper.
    const condLead = matchCondition(rest);
    if (condLead) {
      const afterCond = rest.slice(condLead.consumed).replace(/^,\s*/, "");
      const innerEff = matchEffect(afterCond);
      if (innerEff) {
        innerEff.json.condition = condLead.json;
        effects.push(innerEff.json);
        rest = afterCond.slice(innerEff.consumed);
        const dur = parseDuration(rest, innerEff.json.type);
        if (dur.duration) { innerEff.json.duration = dur.duration; rest = rest.slice(dur.consumed); }
        rest = rest.trimStart();
        const rem = /^\([^)]*\)\s*/.exec(rest);
        if (rem) rest = rest.slice(rem[0].length);
        if (rest === "" || rest === ".") return { json: effects, consumedAll: true, remainder: "" };
        const sepMatch = /^(?:,\s*then\s+|\.\s+Then,?\s+|,\s*and\s+|,\s*|\.\s+and\s+|\.\s+|\s+and\s+|and\s+)/i.exec(rest);
        if (sepMatch) { rest = rest.slice(sepMatch[0].length); continue; }
        break;
      }
    }

    // Filter-target stat buffs — "your [filter] characters get +N {stat}
    // [this turn]". Use the same shared parser as static abilities.
    const fStat = tryFilterTargetStatEffect(rest);
    if (fStat) {
      effects.push(fStat.json);
      rest = rest.slice(fStat.consumed).trimStart();
      // Reuse the same separator/terminator handling below.
      const rem = /^\([^)]*\)\s*/.exec(rest);
      if (rem) rest = rest.slice(rem[0].length);
      if (rest === "" || rest === ".") {
        return { json: effects, consumedAll: true, remainder: "" };
      }
      const sepMatch = /^(?:,\s*then\s+|\.\s+Then,?\s+|,\s*and\s+|,\s*|\.\s+and\s+|\.\s+|\s+and\s+)/i.exec(
        rest,
      );
      if (sepMatch) {
        rest = rest.slice(sepMatch[0].length);
        continue;
      }
      break;
    }
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
    // Chain separators: ", and ", ", ", ". ", " and ", ", then ", ". Then, ",
    // "and " (after trimStart consumed leading space)
    const sepMatch = /^(?:,\s*then\s+|\.\s+Then,?\s+|,\s*and\s+|,\s*|\.\s+and\s+|\.\s+|\s+and\s+|and\s+)/i.exec(
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
    // Skip keyword-reminder lines: "<Rush> (...)" / "Shift 3 {I} (...)" —
    // these are badge text from Ravensburger data, not named abilities.
    if (/^<?\b(Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish|Shift)\b>?\s*(\d|\()/i.test(line)) continue;
    // STORYNAME must be 2+ uppercase words (letters/punct/digits/space), then
    // transition to a lowercase word. Must include curly ‘ for cards like
    // "LET’S GET MOVIN’" / "EVERYONE GATHER ‘ROUND".
    const m = /^([A-Z][A-Z0-9’’ \-!,.?]*[A-Z!?’’])\s+([A-Z][a-z].*)$/.exec(line);
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

  // For actions/songs, the whole rulesText is an actionEffects body — parse as
  // a bare effect chain (no trigger/static/activated wrapping).
  if (card.cardType === "action") {
    let normalized = (card.rulesText ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/<(Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish|Shift)>/gi, "$1")
      .replace(/^\(A character with cost \d+ or more can \{E\} to sing this song for free\.\)\s*/i, "")
      .replace(/\s*\([^)]*\)\s*\.?$/, "")
      .trim();

    // Extract leading playRestrictions preamble. Escape Plan: "You can't
    // play this action unless 2 or more cards were put into your discard
    // this turn." — the "unless X" clause is a CardDefinition.playRestrictions
    // gate, not an actionEffect. Strip it from normalized before effect-chain
    // parsing so the remaining body can compile cleanly.
    const playRestrictions: Json[] = [];
    const unlessDiscardMatch = normalized.match(/^You can'?t play this action unless (\d+) or more cards? were put into your discard this turn\.\s*/i);
    if (unlessDiscardMatch) {
      playRestrictions.push({
        type: "cards_put_into_discard_this_turn_atleast",
        amount: parseInt(unlessDiscardMatch[1], 10),
      });
      normalized = normalized.slice(unlessDiscardMatch[0].length).trim();
    }
    // Other playRestriction preambles could chain here: "You can't play this
    // action unless you have X in play" / "unless 5 or more characters are
    // banished this turn" / etc. Add as they appear in future sets.

    // "Choose one:" modal action — parse bullet points as options
    const chooseMatch = /^Choose one:\s*/i.exec(normalized);
    if (chooseMatch) {
      const body = normalized.slice(chooseMatch[0].length);
      const bullets = body.split(/\n/).map(b => b.replace(/^[•\-]\s*/, "").trim()).filter(Boolean);
      const options: Json[][] = [];
      for (const bullet of bullets) {
        const eff = parseEffectChain(bullet);
        if (eff && eff.json.length > 0) options.push(eff.json);
      }
      if (options.length >= 2) {
        result.actionEffectResult = {
          ability: { type: "__actionEffects__", effects: [{ type: "choose", options }] },
          unmatched: "",
        };
        return result;
      }
    }

    const effects = parseEffectChain(normalized);
    if (effects && effects.json.length > 0) {
      const ability: Json = { type: "__actionEffects__", effects: effects.json };
      if (playRestrictions.length > 0) ability.playRestrictions = playRestrictions;
      result.actionEffectResult = {
        ability,
        unmatched: effects.remainder,
      };
    } else if (playRestrictions.length > 0) {
      // Restrictions extracted but body unmatched — still emit the
      // restrictions so the manual-wiring step has a head start.
      result.actionEffectResult = {
        ability: { type: "__actionEffects__", effects: [], playRestrictions },
        unmatched: normalized,
      };
    } else {
      result.actionEffectResult = {
        ability: null,
        unmatched: normalized,
      };
    }
    return result;
  }

  // Prefer _namedAbilityStubs (pre-split by the importer) over our regex
  // heuristic — the importer handles edge cases like storyNames followed by
  // {E} cost prefixes that our splitNamedAbilities regex misses.
  const chunks =
    card._namedAbilityStubs && card._namedAbilityStubs.length > 0
      ? card._namedAbilityStubs.map((s) => ({
          storyName: s.storyName ?? "",
          body: s.rulesText,
        }))
      : splitNamedAbilities(card.rulesText);
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
  const files = readdirSync(CARDS_DIR).filter((f) => /^card-set-\d+\.json$/.test(f));
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

// =============================================================================
// --apply MODE — write compiled abilities into card JSON files
// -----------------------------------------------------------------------------
// For each card with empty abilities (no hand-wired effects), compiles the
// rulesText and writes the result into the card's abilities[] / actionEffects.
// Validates compiled JSON against engine types before writing — skips unknown
// types and reports them. Does NOT overwrite existing hand-wired abilities.
// =============================================================================

function loadKnownEngineTypes(): { types: Set<string>; triggers: Set<string> } {
  const typesPath = join(__dirname, "../packages/engine/src/types/index.ts");
  const src = readFileSync(typesPath, "utf8");
  const types = new Set<string>();
  for (const m of src.matchAll(/type:\s*"([a-z_]+)"/g)) types.add(m[1]);
  const triggers = new Set<string>();
  for (const m of src.matchAll(/on:\s*"([a-z_]+)"/g)) triggers.add(m[1]);
  return { types, triggers };
}

function validateJson(json: Json, known: { types: Set<string>; triggers: Set<string> }): string[] {
  const issues: string[] = [];
  function check(obj: any): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(check); return; }
    if (obj.type && typeof obj.type === "string" && !obj.type.startsWith("__")) {
      if (!known.types.has(obj.type)) issues.push(`unknown type "${obj.type}"`);
    }
    if (obj.on && typeof obj.on === "string") {
      if (!known.triggers.has(obj.on)) issues.push(`unknown trigger "${obj.on}"`);
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "object" && v !== null) check(v);
    }
  }
  check(json);
  return issues;
}

function hasHandWiredAbilities(card: CardJSON): boolean {
  // A card has hand-wired abilities if it has any non-keyword ability entries
  for (const ab of card.abilities ?? []) {
    if (ab.type !== "keyword") return true;
  }
  if ((card.actionEffects ?? []).length > 0) return true;
  return false;
}

function applyToSet(setId: string): void {
  const known = loadKnownEngineTypes();
  const fileName = `card-set-${setId}.json`;
  const filePath = join(CARDS_DIR, fileName);
  let cards: CardJSON[];
  try {
    cards = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    console.error(`Could not read ${filePath}`);
    return;
  }

  let wired = 0;
  let skippedExisting = 0;
  let skippedUnknown = 0;
  let skippedNoMatch = 0;
  const unknownReport: Array<{ card: string; issues: string[] }> = [];

  for (const card of cards) {
    if (hasHandWiredAbilities(card)) {
      skippedExisting++;
      continue;
    }

    const compiled = compileCard(card);

    // --- Action cards: write to actionEffects ---------------------------------
    if (card.cardType === "action" && compiled.actionEffectResult?.ability) {
      const ab = compiled.actionEffectResult.ability;
      if (ab.type === "__actionEffects__" && Array.isArray(ab.effects)) {
        const issues = validateJson({ effects: ab.effects }, known);
        if (issues.length > 0) {
          skippedUnknown++;
          unknownReport.push({ card: card.fullName, issues });
          continue;
        }
        card.actionEffects = ab.effects;
        wired++;
        continue;
      }
    }

    // --- Non-action cards: write to abilities[] --------------------------------
    const newAbilities: Json[] = [];
    // Preserve existing keyword abilities
    for (const ab of card.abilities ?? []) {
      if (ab.type === "keyword") newAbilities.push(ab);
    }

    let cardValid = true;
    let hasNewAbilities = false;
    for (const nr of compiled.namedResults) {
      if (!nr.ability) continue;
      // Handle markers
      if (nr.ability.type === "__alternateNames__") {
        card.alternateNames = nr.ability.names;
        hasNewAbilities = true;
        continue;
      }
      // Validate against engine types
      const issues = validateJson(nr.ability, known);
      if (issues.length > 0) {
        cardValid = false;
        unknownReport.push({ card: card.fullName, issues });
        break;
      }
      // Add storyName and rulesText to the ability for audit trail
      const ability = { ...nr.ability, storyName: nr.storyName, rulesText: nr.rulesText };
      newAbilities.push(ability);
      hasNewAbilities = true;
    }

    if (!cardValid) {
      skippedUnknown++;
      continue;
    }
    if (!hasNewAbilities) {
      skippedNoMatch++;
      continue;
    }

    card.abilities = newAbilities;
    wired++;
  }

  // Write back
  writeFileSync(filePath, JSON.stringify(cards, null, 2) + "\n");

  console.log(`\n=== --apply results for set ${setId} ===`);
  console.log(`  Wired:              ${wired} cards`);
  console.log(`  Skipped (existing): ${skippedExisting} (already hand-wired)`);
  console.log(`  Skipped (unknown):  ${skippedUnknown} (uses unknown engine types)`);
  console.log(`  Skipped (no match): ${skippedNoMatch} (compiler couldn't parse)`);
  console.log(`  Wrote:              ${filePath}`);
  if (unknownReport.length > 0) {
    console.log(`\n  Cards skipped due to unknown types:`);
    for (const r of unknownReport) {
      console.log(`    ${r.card}: ${r.issues.join(", ")}`);
    }
  }
  console.log(`\n  Next: run \`pnpm card-status\` and \`pnpm decompile-cards --set ${setId}\` to validate.`);
}

function main(): void {
  const args = process.argv.slice(2);
  const setFlag = args.indexOf("--set");
  const cardFlag = args.indexOf("--card");
  const applyMode = args.includes("--apply");

  if (applyMode) {
    if (setFlag < 0) {
      console.error("--apply requires --set <id>. Example: pnpm compile-cards --set 12 --apply");
      process.exit(1);
    }
    applyToSet(args[setFlag + 1]);
    return;
  }

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
