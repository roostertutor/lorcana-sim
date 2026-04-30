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
    // Always scope to the controller — "At the start of your turn" oracle text
    // means the caster's turn (CRD 4.1). Without `player: {type: "self"}` the
    // trigger fires on every turn-start, including the opponent's, which the
    // card-status audit flags as a silent no-op (regression for 9 set-12 cards).
    build: () => ({ on: "turn_start", player: { type: "self" } }),
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
    build: () => ({ on: "turn_end", player: { type: "self" } }),
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
        statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
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
  // "Chosen player draws N cards" — Sing Together song bodies often surface
  // this targeted-draw form (Second Star to the Right set 4 #61 + reprints,
  // 3× recurrence). Distinct from "draw N cards" (target:self) — here the
  // caster picks any player; engine resolves to chosen via PlayerTarget.
  {
    name: "draw_n_chosen_player",
    pattern: /^chosen player draws (\d+) cards?/i,
    build: (m) => ({ type: "draw", amount: n(m[1]), target: { type: "chosen" } }),
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
  // "Chosen opponent loses N lore" — single-target opponent lore drain.
  // 3× recurrence (A Pirate's Life set 4 #128 + reprints, Thievery set 6
  // #128). Distinct from each_opponent: targets ONE chosen opponent.
  {
    name: "lose_lore_chosen_opponent",
    pattern: /^chosen opponent loses (\d+) lore/i,
    build: (m) => ({
      type: "lose_lore",
      amount: n(m[1]),
      target: { type: "opponent" },
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
        filter: {
          zone: "play",
          cardType: ["character"],
          statComparisons: [{ stat: "strength", op: "lte", value: parseInt(m[1], 10) }],
        },
      },
    }),
  },
  // "banish chosen opposing character with N {S/W} or less" — owner+stat
  // filtered banish. 4× recurrence (Madame Medusa The Boss set 3 #112 THAT
  // TERRIBLE WOMAN, Sisu Daring Visitor set 9 #119 BRING ON THE HEAT!,
  // Headless Horseman Terror of Sleepy Hollow set 10 #125, etc.).
  {
    name: "banish_chosen_opposing_char_stat_filter",
    pattern: /^banish chosen opposing character with (\d+) \{(S|W)\} or less/i,
    build: (m) => ({
      type: "banish",
      target: {
        type: "chosen",
        filter: {
          zone: "play",
          cardType: ["character"],
          owner: { type: "opponent" },
          statComparisons: [
            {
              stat: m[2].toUpperCase() === "S" ? "strength" : "willpower",
              op: "lte",
              value: parseInt(m[1], 10),
            },
          ],
        },
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
  // "Banish all characters." — board wipe. 3× recurrence (Be Prepared set 1
  // #128, Raging Storm set 11 #28 + reprints). target.type:"all" with
  // character filter; no owner restriction so it banishes both players'
  // characters.
  {
    name: "banish_all_characters",
    pattern: /^banish all characters/i,
    build: () => ({
      type: "banish",
      target: {
        type: "all",
        filter: { zone: "play", cardType: ["character"] },
      },
    }),
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
  // "banish one of your items" / "banish one of your characters" — implicit
  // "chosen X of yours" wording. Common cost-form for Hiram Flaversham
  // Toymaker ARTIFICER (set 2 #149: "banish one of your items to draw 2 cards"),
  // Genie Supportive Friend (sacrifice phrase), etc.
  {
    name: "banish_one_of_your_items",
    pattern: /^banish one of your items/i,
    build: () => ({
      type: "banish",
      target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["item"] } },
    }),
  },
  {
    name: "banish_one_of_your_characters",
    pattern: /^banish one of your characters/i,
    build: () => ({
      type: "banish",
      target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } },
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
  // "exert all your characters not named X" — Mor'du Savage Cursed Prince
  // FEROCIOUS ROAR (set 12 baseline #57). Uses notHasName CardFilter (a real
  // filter field, distinct from name/hasName which would be inclusive).
  {
    name: "exert_all_your_chars_not_named",
    pattern: /^exert all your characters not named ([\w''\- ]+?)(?:\.|$)/i,
    build: (m) => ({
      type: "exert",
      target: {
        type: "all",
        filter: {
          owner: { type: "self" },
          zone: "play",
          cardType: ["character"],
          notHasName: m[1].trim(),
        },
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
  // "Exert up to N chosen characters. They can't ready at the start of their
  // next turn." — multi-target exert with isUpTo + followUp cant_action ready
  // (end_of_owner_next_turn). 3× recurrence (Elsa Spirit of Winter set 1 #42
  // + alt-art #207, set 9 reprint DEEP FREEZE).
  {
    name: "exert_up_to_n_chosen_cant_ready_next_turn",
    pattern: /^exert up to (\d+) chosen characters\. They can'?t ready at the start of their next turn/i,
    build: (m) => ({
      type: "exert",
      target: {
        type: "chosen",
        filter: { zone: "play", cardType: ["character"] },
        count: parseInt(m[1], 10),
      },
      isUpTo: true,
      followUpEffects: [
        {
          type: "cant_action",
          action: "ready",
          target: { type: "this" },
          duration: "end_of_owner_next_turn",
        },
      ],
    }),
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
  // "ready chosen character. They can't quest for the rest of this turn." —
  // mandatory ready variant of the may-ready-cant-quest pattern. 4× recurrence
  // (LeFou Instigator set 1 #112 FAN THE FLAMES, Lilo Causing an Uproar
  // set 8 #137 RAAAWR! + alt-art #217). Distinct from may variant — no isMay.
  {
    name: "ready_chosen_cant_quest",
    pattern: /^ready chosen character\. They can'?t quest for the rest of this turn/i,
    build: () => ({
      type: "ready",
      target: chosenCharacter(),
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
  // "deal N damage to chosen damaged character" — Lord MacGuffin Clever
  // Swordsman WAIT FOR IT... (set 12 baseline #78). The "damaged" qualifier
  // adds hasDamage:true to the target filter.
  {
    name: "deal_damage_n_damaged",
    pattern: /^deal (\d+) damage to chosen damaged character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: chosenCharacter({ damaged: true }),
    }),
  },
  // "you may deal N damage to chosen damaged character" — may variant.
  // 3× recurrence (Ed Laughing Hyena set 5 #74 CAUSE A PANIC, Cheshire
  // Cat Perplexing Feline set 7 #91 MAD GRIN, March Hare Hare-Brained
  // Eccentric set 8 #91 LIGHT THE CANDLES). Note baseline uses
  // `isUpTo: false` not `isMay: true` — but isMay matches semantics
  // ('may' is the player choice; isUpTo would let the engine pick 0..N
  // damage). Use isMay for the may-prompt, omit isUpTo (false default).
  {
    name: "deal_damage_may_n_damaged",
    pattern: /^you may deal (\d+) damage to chosen damaged character/i,
    build: (m) => ({
      type: "deal_damage",
      amount: n(m[1]),
      target: chosenCharacter({ damaged: true }),
      isMay: true,
    }),
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
  // "remove up to N damage from him/her/it" — pronoun referring back to the
  // ability's source character. Pedro Madrigal Family Patriarch DEVOTED
  // FAMILY (set 12 baseline #5) uses "from him". Same target shape as
  // "from this character" (target.type:"this").
  {
    name: "remove_damage_from_pronoun",
    pattern: /^(?:you may )?remove up to (\d+) damage from (?:him|her|it)\b/i,
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
    // Accept ASCII minus (-), Unicode minus (−), and en-dash (–) for the
    // "gets –N {S}" form. Ravensburger uses U+2013 en-dash for stat penalties
    // (Distract set 3 #159, Pouncing Practice set 8 #176, Distract set 11
    // #164 — 3× residual cluster). The plain-stripped – in the
    // character class lets the existing regex match those cards too.
    pattern: /^chosen character gets ([+\-–]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1].replace(/[–]/, "-"), 10), m[2], chosenCharacter()),
  },
  {
    name: "chosen_opposing_character_gets_stat",
    pattern: /^chosen opposing character gets ([+\-–]?\d+) \{(S|W|L)\}/i,
    build: (m) => gainStats(parseInt(m[1].replace(/[–]/, "-"), 10), m[2], chosenCharacter({ opposing: true })),
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

  // "give chosen character <Keyword> [+N] until the start of your next turn"
  // — Lord Macintosh Wiry and High-Strung TOUGH IT OUT (set 12 baseline
  // #181, "Resist +2 until the start of your next turn").
  {
    name: "give_chosen_keyword_until_caster_next_turn",
    pattern: /^give chosen character (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))? until the start of your next turn/i,
    build: (m) => {
      const out: Json = {
        type: "grant_keyword",
        keyword: m[1].toLowerCase(),
        target: chosenCharacter(),
        duration: "until_caster_next_turn",
      };
      if (m[2]) out.value = parseInt(m[2], 10);
      return out;
    },
  },
  // "give chosen character <Keyword> [+N] this turn" — Lord Dingwall
  // Bullheaded FIGHTIN' TALK (set 12 baseline #186, "Challenger +3 this turn").
  {
    name: "give_chosen_keyword_this_turn",
    pattern: /^give chosen character (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))? this turn/i,
    build: (m) => {
      const out: Json = {
        type: "grant_keyword",
        keyword: m[1].toLowerCase(),
        target: chosenCharacter(),
        duration: "this_turn",
      };
      if (m[2]) out.value = parseInt(m[2], 10);
      return out;
    },
  },

  // ============= CAN'T ACTION ===============================================
  // "Up to N chosen characters can't quest until the start of your next turn"
  // CantActionEffect has no isUpTo — the "up to" wording is approximated by a
  // hard count via target.count (matches Strange Things hand-wired baseline,
  // experiments/set12-baseline-2026-04-29.json:Strange Things actionEffects[0]).
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
  // Emits TWO flat effects in order: reveal_hand, then discard_from_hand. The
  // public reveal step is essential — without it, the "of your choice" rider
  // resolves with the caster never having seen the opponent's hand. Match
  // Lenny - Toy Binoculars TAKE A GOOD LOOK (set 12 baseline #79).
  // Wrapped in __actionEffects__ so parseEffectChain inline-flattens both
  // effects (single-effect matcher framework otherwise can't emit multi-step).
  {
    name: "opponent_reveals_discards_your_choice",
    pattern: /^chosen opponent reveals their hand and discards an? (\w+) card of your choice/i,
    build: (m) => ({
      type: "__actionEffects__",
      effects: [
        { type: "reveal_hand", target: { type: "opponent" } },
        {
          type: "discard_from_hand",
          amount: 1,
          target: { type: "opponent" },
          chooser: "controller",
          filter: { cardType: [m[1].toLowerCase()] },
        },
      ],
    }),
  },
  // "chosen opponent reveals their hand and discards a non-character card of
  // your/their choice" — Timon Snowball Swiper GET RID OF THAT (set 11 #16),
  // Mowgli Man Cub HAVE A BETTER LOOK (set 10 #19). The "your choice" vs
  // "their choice" wording controls who picks (chooser:"controller" vs
  // "target_player"). non-character expands to ["action","item","location"]
  // per CRD card-type definition (Timon baseline omits location — that's a
  // baseline bug; Mowgli baseline has the correct enumeration).
  {
    name: "opponent_reveals_discards_non_character",
    pattern: /^chosen opponent reveals their hand and discards a non-character card of (your|their) choice/i,
    build: (m) => ({
      type: "__actionEffects__",
      effects: [
        { type: "reveal_hand", target: { type: "opponent" } },
        {
          type: "discard_from_hand",
          amount: 1,
          target: { type: "opponent" },
          chooser: m[1].toLowerCase() === "your" ? "controller" : "target_player",
          filter: { zone: "hand", cardType: ["action", "item", "location"] },
        },
      ],
    }),
  },
  // "chosen player reveals their hand" — bare reveal-only effect, no discard
  // follow-up. Match Copper Hound Pup FOUND YA (set 11 baseline #85).
  // target is "chosen" rather than "opponent" so the caster picks (could be
  // self in 3+P; for 2P only opponent is a legal target).
  {
    name: "chosen_player_reveals_hand",
    pattern: /^chosen player reveals their hand/i,
    build: () => ({
      type: "reveal_hand",
      target: { type: "chosen" },
    }),
  },
  // "chosen opponent reveals their hand" — bare reveal of opponent. Match
  // Dolores Madrigal Within Earshot I HEAR YOU (set 7 baseline #78).
  {
    name: "chosen_opponent_reveals_hand",
    pattern: /^chosen opponent reveals their hand/i,
    build: () => ({
      type: "reveal_hand",
      target: { type: "opponent" },
    }),
  },
  // "each opponent reveals their hand" — broadcast reveal across all
  // opposing players. Match Nothing to Hide (set 2 baseline #165 action).
  // Wraps in each_player so multi-opponent games iterate; the effect target
  // resolves to "self" inside each iteration (the player REVEALING is self
  // from their own each-iteration scope).
  {
    name: "each_opponent_reveals_hand",
    pattern: /^each opponent reveals their hand/i,
    build: () => ({
      type: "each_player",
      scope: "opponents",
      effects: [{ type: "reveal_hand", target: { type: "self" } }],
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
  // "return chosen character, item, or location with cost N or less to their
  // player's hand" — multi-cardType return with cost filter. 3× recurrence
  // (Poor Unfortunate Souls set 4 #60 + reprints set 9 #61, Begone! set 10
  // #61). Multi-cardType filter — character/item/location all eligible.
  {
    name: "return_chosen_multi_with_cost",
    pattern: /^return chosen character, item, or location with cost (\d+) or less to their player['’]s hand/i,
    build: (m) => ({
      type: "return_to_hand",
      target: {
        type: "chosen",
        filter: {
          zone: "play",
          cardType: ["character", "item", "location"],
          statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
        },
      },
    }),
  },
  {
    name: "return_chosen_opposing_character",
    pattern: /^return chosen opposing character to their player['’]s hand/i,
    build: () => ({
      type: "return_to_hand",
      target: chosenCharacter({ opposing: true }),
    }),
  },
  // "return another chosen character of yours to your hand" — owner-self
  // chosen with excludeSelf. Used as a "to-B" reward in the Madam Mim
  // CHASING THE RABBIT 'A or B' choice (set 2 #46) where 'A' is banish-self.
  {
    name: "return_another_chosen_yours_to_hand",
    pattern: /^return another chosen character of yours to your hand/i,
    build: () => ({
      type: "return_to_hand",
      target: {
        type: "chosen",
        filter: {
          owner: { type: "self" },
          zone: "play",
          cardType: ["character"],
          excludeSelf: true,
        },
      },
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
          owner: { type: "self" },
          statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
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
        owner: { type: "self" },
        zone: "hand",
        statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
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
        owner: { type: "self" },
        zone: "hand",
        statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
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
        zone: "hand",
        owner: { type: "self" },
        statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
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
        owner: { type: "self" },
        zone: "hand",
        statComparisons: [{ stat: "cost", op: "lte", value: parseInt(m[1], 10) }],
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
  // Let's Get Dangerous: "Each player shuffles their deck and then reveals the
  // top card. Each player who reveals a [type] card may play that [type] for
  // free. Otherwise, put the revealed cards on the bottom of their player's
  // deck." matchIsMay:true is mandatory — without it the engine force-plays.
  // shuffleBefore:true is mandatory — without it the engine peeks at the
  // existing top of deck rather than shuffling first.
  {
    name: "reveal_top_conditional_each_player_play_or_bottom",
    pattern: /^each player shuffles their deck and then reveals the top card\. each player who reveals (?:a |an )([\w ]+?) card may play that [\w ]+ for free\. otherwise,? put the revealed cards? on the bottom of their player's deck/i,
    build: (m) => ({
      type: "reveal_top_conditional",
      filter: parseSimpleFilter(m[1].trim()),
      matchAction: "play_card",
      noMatchDestination: "bottom",
      matchIsMay: true,
      shuffleBefore: true,
      target: { type: "both" },
    }),
  },
  // The Return of Hercules: "Each player may reveal a [type] card from their
  // hand and play it for free." each_player.isMay wraps a reveal+play. Without
  // isMay both players are forced through the play.
  {
    name: "each_player_may_reveal_and_play_from_hand",
    pattern: /^each player may reveal (?:a |an )([\w ]+?) card from their hand and play it for free/i,
    build: (m) => ({
      type: "each_player",
      isMay: true,
      effects: [{
        type: "play_card",
        sourceZone: "hand",
        filter: { cardType: parseSimpleFilter(m[1].trim()).cardType },
      }],
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
  // "look at the top 2 cards of your deck. Put one on the top of your deck
  // and the other on the bottom." — Merlin Turtle (set 5 #38) phrasing of
  // the top_or_bottom 2-card pattern. Different oracle wording from the
  // generic "Put them on the top or bottom" form; the player still chooses
  // which card is "one" and which is "other" (effectively top_or_bottom).
  {
    name: "look_at_top_2_split_top_bottom",
    pattern: /^(?:you may )?look at the top 2 cards of your deck\. Put one on the top of your deck and the other on the bottom/i,
    build: (m) => ({
      type: "look_at_top",
      count: 2,
      action: "top_or_bottom",
      target: { type: "self" },
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
  // "Look at the top N cards of your deck. Put them back on the top of your
  // deck in any order." — scry-and-reorder (Reflection set 1 #65). Both
  // sentence-break and conjunction ("...and put them back...") forms are
  // supported. Action="reorder" tells the engine to surface a choose_order
  // prompt over the looked-at cards. Effectively "scry N — caster reorders."
  {
    name: "look_at_top_n_back_on_top_reorder",
    pattern: /^(?:you may )?look at the top (\d+) cards of your deck(?:\.|\s+and)\s*[Pp]ut them (?:back )?on (?:the )?top of your deck in any order/i,
    build: (m) => ({
      type: "look_at_top",
      count: parseInt(m[1], 10),
      action: "reorder",
      target: { type: "self" },
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
  // "Look at the top N cards of your deck and put them back in any order." —
  // bare reorder, no explicit "on top" mention (the implication is the same).
  // 3× recurrence (The Queen Mirror Seeker set 3 #156 + reprints CALCULATING
  // AND VAIN, Pascal Inquisitive Pet set 4 #151 COLORFUL TACTICS).
  {
    name: "look_at_top_n_reorder_bare",
    pattern: /^(?:you may )?look at the top (\d+) cards of your deck and put them back in any order/i,
    build: (m) => ({
      type: "look_at_top",
      count: parseInt(m[1], 10),
      action: "reorder",
      target: { type: "self" },
      isMay: /^you may /i.test(m[0]) || undefined,
    }),
  },
  // "Look at the top N cards. Put M (or 'one') into your hand and the
  // other/rest on the bottom (of your deck) in any order." — generalized
  // scry N, pick M to hand, restPlacement=bottom. action="choose_from_top".
  // Handles 4 sub-wordings:
  //   - "Put one into your hand and the other on the bottom of the deck"
  //     Develop Your Brain (set 1 #161): N=2, M=1
  //   - "Put one into your hand and the rest on the bottom of your deck in any order"
  //     Vision of the Future (set 5 #160): N=5, M=1
  //   - "Put 2 into your hand and the rest on the bottom of your deck in any order"
  //     Dig a Little Deeper set 9 #166: N=7, M=2 (single conjunction)
  //   - "Put 2 into your hand. Put the rest on the bottom of your deck in any order"
  //     Dig a Little Deeper set 4 #162: N=7, M=2 (sentence-break variant)
  {
    name: "look_at_top_n_pick_m_rest_bottom",
    pattern: /^(?:you may )?look at the top (\d+) cards? of your deck\. Put (one|\d+) into your hand(?:\s+and the (?:other|rest)|\.\s+Put the rest)\s+on the bottom of (?:your |the )?deck(?:\s+in any order)?/i,
    build: (m) => {
      const total = parseInt(m[1], 10);
      const pick = m[2].toLowerCase() === "one" ? 1 : parseInt(m[2], 10);
      return {
        type: "look_at_top",
        count: total,
        action: "choose_from_top",
        target: { type: "self" },
        maxToHand: pick,
        restPlacement: "bottom",
        isMay: /^you may /i.test(m[0]) || undefined,
      };
    },
  },
  // "Look at the top N cards. You may reveal up to M <filter> cards and put
  // them into your hand. Put the rest on the bottom of your deck in any
  // order." — scry N with reveal-and-pick of filtered cards. Look at This
  // Family (set 4 #28 + reprints, set 9 #25): N=5, M=2, filter=character.
  // The "You may reveal" makes the player's pick optional (isMay:true).
  // revealPicks:true so the picks become public on the way to hand.
  {
    name: "look_at_top_n_reveal_filtered_to_hand_rest_bottom",
    pattern: /^(?:you may )?look at the top (\d+) cards? of your deck\. You may reveal up to (\d+) ([\w ]+?) cards? and put them into your hand\. Put the rest on the bottom of your deck(?:\s+in any order)?/i,
    build: (m) => {
      const total = parseInt(m[1], 10);
      const pick = parseInt(m[2], 10);
      return {
        type: "look_at_top",
        count: total,
        action: "choose_from_top",
        target: { type: "self" },
        maxToHand: pick,
        filter: parseSimpleFilter(m[3].trim()),
        restPlacement: "bottom",
        revealPicks: true,
        isMay: true,
      };
    },
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
  // Note: effect-driven moves are always free (move-cost only applies to the
  // player's MOVE_CHARACTER action). The "for free" phrasing is reminder, not
  // a separate primitive — match the hand-wired baseline (no cost field).
  {
    name: "move_character_to_location_free",
    pattern: /^Move a character of yours to a location for free/i,
    build: () => ({
      type: "move_character",
      character: { type: "chosen", filter: { owner: { type: "self" }, cardType: ["character"], zone: "play" } },
      location: { type: "chosen", filter: { cardType: ["location"], zone: "play" } },
    }),
  },
  // "draw cards equal to that location's {L}" — dynamic draw from last target
  {
    name: "draw_equal_to_location_lore",
    pattern: /^draw cards equal to that location's \{L\}/i,
    build: () => ({
      type: "draw",
      amount: { type: "stat_ref", from: "last_target_location", property: "lore" },
      target: { type: "self" },
    }),
  },

  // "Shift a character from your discard for free" — Metamorphosis. Engine
  // has no `playMode: "shift"` flag and the hand-wired baseline doesn't use
  // one — at play time the player picks any character in discard and the
  // shift mechanic resolves through the normal play path. Match baseline.
  {
    name: "shift_from_discard_free",
    pattern: /^Shift a character from your discard for free/i,
    build: () => ({
      type: "play_card",
      sourceZone: "discard",
      filter: { zone: "discard", cardType: ["character"] },
      cost: "free",
    }),
  },

  // ============= BANISH THIS (as a standalone cost-effect for "A to B") =====
  {
    name: "banish_this_item_or_char",
    pattern: /^banish this (?:item|character|location)/i,
    build: () => ({ type: "banish", target: { type: "this" } }),
  },
  // "banish her/him/it/them" — pronoun referring back to the source. Used
  // inline in effect chains (where parseEffectChain doesn't apply the
  // leading-condition-aware pronoun normalization that compileAbility does).
  // Madam Mim Fox CHASING THE RABBIT (set 2 #46): "When you play this
  // character, banish her or return another chosen character of yours to
  // your hand." — needs banish-pronoun → target:this so tryAorB can split.
  {
    name: "banish_pronoun",
    pattern: /^banish (?:her|him|it|them)\b/i,
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
  // Note: `minimum` is on the condition itself, NOT on the filter.
  // `countAtLeast` is not a CardFilter field — silent no-op flagged by
  // card-status. Match Jessie #20 hand-wired (set 12 baseline,
  // abilities[0].condition: { type:"you_control_matching", filter, minimum: 2 }).
  {
    name: "chars_in_play_gte_other_trait",
    pattern: /^(?:if|while) you have (\d+) or more other ([A-Z][a-zA-Z]*) characters in play/i,
    build: (m) => ({
      type: "you_control_matching",
      filter: {
        cardType: ["character"],
        zone: "play",
        owner: { type: "self" },
        hasTrait: m[2],
        excludeSelf: true,
      },
      minimum: parseInt(m[1], 10),
    }),
  },
  // "while you have N or more <Trait> characters in play" — no "other" form,
  // matches The Colonel Old Sheepdog WE'VE GOT 'EM OUTNUMBERED (set 8 #17:
  // "While you have 3 or more Puppy characters in play").
  {
    name: "chars_in_play_gte_trait",
    pattern: /^(?:if|while) you have (\d+) or more ([A-Z][a-zA-Z]*) characters in play/i,
    build: (m) => ({
      type: "you_control_matching",
      filter: {
        cardType: ["character"],
        zone: "play",
        owner: { type: "self" },
        hasTrait: m[2],
      },
      minimum: parseInt(m[1], 10),
    }),
  },
  {
    name: "chars_in_play_gte_other",
    pattern: /^(?:if|while) you have (\d+) or more other characters in play/i,
    build: (m) => ({
      type: "characters_in_play_gte",
      amount: parseInt(m[1], 10),
      player: { type: "self" },
      excludeSelf: true,
    }),
  },
  {
    name: "chars_in_play_gte",
    pattern: /^(?:if|while) you have (\d+) or more characters in play/i,
    build: (m) => ({
      type: "characters_in_play_gte",
      amount: parseInt(m[1], 10),
      player: { type: "self" },
    }),
  },
  // "while you have a character with <Keyword> in play" — Roxanne Powerline
  // Fan CONCERT LOVER (set 9 #113: "While you have a character with Singer
  // in play, this character gets +1 {S} and +1 {L}").
  {
    name: "has_char_with_keyword",
    pattern: /^(?:if|while) you have a character with (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish|Singer) in play/i,
    build: (m) => ({
      type: "you_control_matching",
      filter: {
        cardType: ["character"],
        zone: "play",
        owner: { type: "self" },
        hasKeyword: m[1].toLowerCase(),
      },
    }),
  },

  // has_character_named — "if/while you have a character named X in play"
  // The "while" form gates a static effect (Lilo Snow Artist set 11 #2,
  // Dale Excited Friend set 12 #4 — both "While you have a character
  // named X in play, this character gets +N {stat}.").
  {
    name: "has_char_named",
    pattern: /^(?:if|while) you have a character named ([A-Z][\w'’\- ]*?) in play/i,
    build: (m) => ({
      type: "has_character_named",
      name: m[1].trim(),
      player: { type: "self" },
    }),
  },
  // "if/while you have another character with N {W/S/L} or more in play" —
  // statComparisons filter on you_control_matching. Match Chip Team Player
  // RANGER RESOURCEFULNESS (set 12 #27).
  {
    name: "has_other_char_with_stat_gte",
    pattern: /^(?:if|while) you have another character with (\d+) \{(W|S|L)\} or more in play/i,
    build: (m) => {
      const stat =
        m[2].toUpperCase() === "W"
          ? "willpower"
          : m[2].toUpperCase() === "S"
            ? "strength"
            : "lore";
      return {
        type: "you_control_matching",
        filter: {
          cardType: ["character"],
          zone: "play",
          owner: { type: "self" },
          excludeSelf: true,
          statComparisons: [
            { stat, op: "gte", value: parseInt(m[1], 10) },
          ],
        },
      };
    },
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

  // this_has_cards_under — "while there's a card under this character"
  // 12× recurrence across sets 10-12 (e.g. Ursula Whisper of Vanessa set 10
  // #59, Flynn Rider Spectral Scoundrel #81, Megara Secret Keeper #86,
  // Omnidroid V.10 set 12 #190).
  {
    name: "this_has_cards_under",
    pattern: /^while there'?s a card under this (?:character|item|location)/i,
    build: () => ({ type: "this_has_cards_under" }),
  },
  // this_has_no_damage — "while this character has no damage"
  // 5× recurrence (Nala Undaunted Lioness set 9 #173, Lawrence Jealous
  // Manservant #187, Rat Capone Rodent Gangster set 12 #183, etc.)
  {
    name: "this_has_no_damage",
    pattern: /^while this character has no damage/i,
    build: () => ({ type: "this_has_no_damage" }),
  },
  // this_has_damage (bare, no amount) — "while this character has damage"
  // 3× across sets 3, 5, 7 (Scroop Backstabber set 3 #122 BRUTE, Ratigan
  // Raging Rat set 5 #113, Li Shang Newly Promoted set 7 #133).
  // Sibling of this_has_no_damage; engine type carries no amount field.
  // Use a lookahead for the trailing token so the iterative leading-
  // condition peel sees the comma it expects after `consumed`.
  {
    name: "this_has_damage_bare",
    pattern: /^while this character has damage(?=,|\s|$)/i,
    build: () => ({ type: "this_has_damage" }),
  },
  // self_stat_gte — "while this character has N {S/W/L} or more"
  // 8× across sets 2, 8 (Alice Growing Girl set 2 #137 + alt-arts WHAT
  // DID I DO?, Pain Underworld Imp set 2 #86, Pete Bad Guy set 2 #88,
  // Lady Decisive Dog set 8 #33 TAKE THE LEAD, etc.).
  {
    name: "self_stat_gte",
    pattern: /^while this character has (\d+) \{(S|W|L)\} or more/i,
    build: (m) => {
      const stat =
        m[2].toUpperCase() === "S"
          ? "strength"
          : m[2].toUpperCase() === "W"
            ? "willpower"
            : "lore";
      return {
        type: "self_stat_gte",
        stat,
        amount: parseInt(m[1], 10),
      };
    },
  },
  // this_at_location — "while this character is at a location"
  // 8× across sets 3, 6, 9 (Shenzi Hyena Pack Leader set 3 #85 + reprints,
  // Minnie Funky Spelunker set 3 #183, Zazu Steward of the Pride Lands set
  // 3 #93, Milo Thatch Spirited Scholar #115, Mickey Courageous Sailor
  // set 6 #115, etc.). Single bare condition (CRD 8.7-ish — at-location
  // status check on the source character).
  {
    name: "this_at_location",
    pattern: /^while this character is at a location/i,
    build: () => ({ type: "this_at_location" }),
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
    .replace(/<(Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish|Shift|Singer|Sing Together|Boost|Alert|Universal Shift)>/gi, "$1")
    // Generic leading + trailing reminder-paren strip. Reminder text never
    // Strip a leading keyword-with-value preamble before the leading-paren
    // strip below. Sing Together songs (Look at This Family, Dig a Little
    // Deeper) have the shape "Sing Together N (Any number of...)<body>"
    // after bracket unwrap; without this strip the leading-paren strip
    // wouldn't fire. Same applies to Singer N, Shift N {I}, Boost N {I}.
    .replace(/^(?:Sing Together|Singer|Boost|Shift|Universal Shift)\s+\d+\s*(?:\{[A-Z]\})?\s*/i, "")
    // carries mechanical info — it restates keyword/song rules that already
    // exist in the engine. Stripping generically (instead of per-wording)
    // means upstream transcription drift doesn't matter (e.g. Ravensburger's
    // set-3-only "play this song for free" reminder typo, vs every other
    // set's "sing this song for free" — both get stripped without code
    // change).
    .replace(/^\(\s*[^)]*\)\s*/, "")     // leading reminder paren
    .replace(/\s*\([^)]*\)\s*\.?$/, "")  // trailing reminder paren
    .trim();
  const normalized = rest; // for unmatched reporting

  // -------- Leading condition ----------------------------------------------
  // The forward decompiler emits conditions in two places: as a leading
  // "During your turn, ..." clause, or as a post-trigger "if X, ..." phrase.
  // On statics with a condition, the oracle text is "If X, this character
  // can't ...". Try a generic condition match first; fall back to the hard-
  // coded turn forms for phrasings the condition table doesn't cover.
  // Iterative peel — oracle text often stacks two preamble conditions like
  // "During your turn, if X were put into your discard this turn, this
  // character gets +N {L}." (Milo Thatch Courageous Explorer, set 12 #108
  // baseline). We peel each condition off the front, composing a list, and
  // wrap with compound_and at the end if 2+ accumulated. Single condition
  // stays unwrapped (matches the most common baseline shape).
  const leadingConditions: Json[] = [];
  let oncePerTurn = false;

  // Pass 1: well-known turn-scope phrasings.
  const leadCond = /^(?:During your turn|Once during your turn|Once per turn|During opponents'?\s*turns?),\s*/i.exec(rest);
  if (leadCond) {
    if (/^Once\b/i.test(leadCond[0])) {
      leadingConditions.push({ type: "is_your_turn" });
      oncePerTurn = true;
    } else if (/opponents/i.test(leadCond[0])) {
      leadingConditions.push({ type: "not", condition: { type: "is_your_turn" } });
    } else {
      leadingConditions.push({ type: "is_your_turn" });
    }
    rest = rest.slice(leadCond[0].length);
  }

  // Pass 2+: generic "if X, ..." / "while X, ..." condition stacking.
  // Loop in case multiple conditions appear (e.g. "During your turn, if X
  // and if Y, ...") — though that's rare in practice.
  while (true) {
    const cond = matchCondition(rest);
    if (!cond) break;
    const after = rest.slice(cond.consumed);
    if (!/^,\s+/.test(after)) break; // condition not followed by ", " — bail
    leadingConditions.push(cond.json);
    rest = after.replace(/^,\s+/, "");
  }

  // Compose: 0 → null, 1 → as-is, 2+ → compound_and.
  const leadingCondition: Json | null =
    leadingConditions.length === 0
      ? null
      : leadingConditions.length === 1
        ? leadingConditions[0]
        : { type: "compound_and", conditions: leadingConditions };

  // Pronoun normalization — after peeling a leading condition, the remaining
  // sentence often starts with "he/she/it/they" referring to the source
  // character (e.g. Rat Capone "While this character has no damage, he gets
  // +3 {S}." set 12 #183). Static-shape matchers all anchor on "This
  // character"; normalize so they hit. Only applied when a leading condition
  // was peeled — otherwise pronouns mid-rulesText would misfire.
  if (leadingConditions.length > 0) {
    rest = rest.replace(/^(?:he|she|it|they)\s+/i, "This character ");
  }

  // -------- Multi-trigger anyOf shape (CRD structural fidelity) ----------
  // "When you play this character and whenever X, [body]" / "and when X" /
  // "and at the start of your turn" — same effect body fires on multiple
  // triggers under one printed ability name. Emit one TriggeredAbility with
  // trigger: { anyOf: [trig1, trig2] }. Pre-2026-04-30 these were encoded
  // as duplicate abilities sharing a storyName, which silently double-
  // counted oncePerTurn budgets and lost storyName attribution on the
  // second copy.
  //
  // Common cases: Hiram Flaversham Toymaker ARTIFICER (set 2 #149), John
  // Silver Alien Pirate PICK YOUR FIGHTS (set 1 #82), Tamatoa So Shiny
  // (set 1 #159), Goofy Galumphing Gumshoe HOT PURSUIT (set 10 #24),
  // Ursula Deal Maker QUITE THE BARGAIN (set 12 #161), etc.
  const multiTrigPrefix = /^When you play this character and (?=(?:whenever|when|at the start|at the end))/i.exec(rest);
  if (multiTrigPrefix) {
    let afterPrefix = rest.slice(multiTrigPrefix[0].length);
    // Pronoun normalization for the second-trigger phrase: oracle text uses
    // "whenever he/she/it/they quests" / "when he leaves play" but our
    // trigger matchers anchor on "this character". Replace pronouns BEFORE
    // matchTrigger runs so e.g. "whenever he quests" → "whenever this
    // character quests" hits the canonical matcher.
    afterPrefix = afterPrefix.replace(
      /^(whenever|when)\s+(?:he|she|it|they)\s+/i,
      "$1 this character ",
    );
    // Also handle "whenever he's challenged" → "whenever this character is challenged"
    afterPrefix = afterPrefix.replace(
      /^(whenever|when)\s+(?:he|she|it|they)'s\s+/i,
      "$1 this character is ",
    );
    const secondTrig = matchTrigger(afterPrefix);
    if (secondTrig) {
      let after2 = afterPrefix.slice(secondTrig.consumed).trimStart();
      if (after2.startsWith(",")) after2 = after2.slice(1).trimStart();
      const effects = parseEffectChain(after2);
      if (effects && effects.consumedAll) {
        const ability: Json = {
          type: "triggered",
          trigger: { anyOf: [{ on: "enters_play" }, secondTrig.json] },
          effects: effects.json,
        };
        if (leadingCondition) ability.condition = leadingCondition;
        if (oncePerTurn) ability.oncePerTurn = true;
        return { ability, unmatched: "" };
      }
    }
    // Multi-trigger phrase recognized but second-trigger or effect-chain
    // didn't parse — fall through to the regular triggered path so the
    // normal matchTrigger picks up "When you play this character" alone
    // and produces a partial wiring (the human reviewer sees the gap).
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

  // -------- Triggered shape — implicit enters_play idioms ------------------
  // "This character enters play with N damage" — Pedro Madrigal Family
  // Patriarch DIFFICULT JOURNEY (set 12 baseline #5), Zeus Defiant God
  // IMMORTAL WOUND (#109). Hand-wired as triggered on enters_play with a
  // self-damage effect, NOT a static. The text reads like flavor but the
  // engine implementation is event-driven.
  const triggerEntersWithDamage = /^This character enters play with (\d+) damage\.?$/i.exec(rest);
  if (triggerEntersWithDamage) {
    const ability: Json = {
      type: "triggered",
      trigger: { on: "enters_play" },
      effects: [
        {
          type: "deal_damage",
          amount: parseInt(triggerEntersWithDamage[1], 10),
          target: { type: "this" },
        },
      ],
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character may enter play exerted to <effect>" — Lord MacGuffin
  // Clever Swordsman (#78), Lord Macintosh Wiry and High-Strung (#181), Lord
  // Dingwall Bullheaded (#186). Wired as triggered on enters_play with a
  // sequential(may_exert_self, <inner>) so the may-prompt offers exert-as-cost
  // for the inner effect. Inner effect is parsed via the same EFFECT_MATCHERS
  // table (deal_damage, grant_keyword, etc.).
  const triggerMayEnterExerted = /^This character may enter play exerted to (.+)\.?$/i.exec(rest);
  if (triggerMayEnterExerted) {
    const innerText = triggerMayEnterExerted[1].trim();
    // Capitalize the first letter so EFFECT_MATCHERS' anchored patterns match
    // ("deal 3 damage to chosen damaged character" → "Deal..."). Most matchers
    // are case-insensitive; this is a defensive lowercase preserver.
    const inner = matchEffect(innerText) ??
      matchEffect("give " + innerText.replace(/^give /i, ""));
    if (inner) {
      const ability: Json = {
        type: "triggered",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [{ type: "exert", target: { type: "this" } }],
            rewardEffects: [inner.json],
          },
        ],
      };
      if (leadingCondition) ability.condition = leadingCondition;
      return { ability, unmatched: "" };
    }
    // Inner effect didn't match — fall through to unmatched reporting so
    // the human-review surface gets a precise "tried may-enter-exerted but
    // couldn't compile inner effect: <text>" signal.
    return {
      ability: null,
      unmatched: `may-enter-exerted inner: ${innerText}`,
    };
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

  // "You pay N {I} less to play <Trait> characters." — global cost reduction
  // static with a trait filter. 3× recurrence (Mickey Mouse Wayward Sorcerer
  // set 1 #51 ANIMATE BROOM "Broom characters", reprints set 1 #208 / set 9
  // similar). Engine: cost_reduction static with filter:{ hasTrait: X }.
  const statCostReductionByTrait = /^You pay (\d+) \{I\} less to play ([A-Z][a-zA-Z]+) characters\.?$/i.exec(rest);
  if (statCostReductionByTrait) {
    const ability: Json = {
      type: "static",
      effect: {
        type: "cost_reduction",
        amount: parseInt(statCostReductionByTrait[1], 10),
        filter: { hasTrait: statCostReductionByTrait[2] },
      },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }
  // "You pay N {I} less to play characters named X." — same as above but
  // by name instead of trait. Snow White Unexpected Houseguest set 2 #24
  // HOW DO YOU DO? "Characters named Dwarf" / similar phrasing.
  const statCostReductionByName = /^You pay (\d+) \{I\} less to play characters named ([A-Z][\w'’\- ]*?)\.?$/i.exec(rest);
  if (statCostReductionByName) {
    const ability: Json = {
      type: "static",
      effect: {
        type: "cost_reduction",
        amount: parseInt(statCostReductionByName[1], 10),
        filter: { hasName: statCostReductionByName[2].trim() },
      },
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

  // "This character may enter play exerted." (no "to <effect>" tail)
  // Per CRD: "may" requires a choice. enter_play_exerted_self auto-exerts
  // with no prompt, so it's the wrong shape for "may"-worded oracles.
  // Correct form is triggered enters_play with [{exert, isMay:true}] —
  // matches Hamish, Hubert & Harris STAY QUIET (set 12 baseline #50,
  // abilities[0]). Mickey Mouse Expedition Leader baseline uses the
  // wrong static form; that's a baseline bug we intentionally do not
  // reproduce.
  const statMayEnterExerted = /^This character may enter play exerted\.?$/i.exec(rest);
  if (statMayEnterExerted) {
    const ability: Json = {
      type: "triggered",
      trigger: { on: "enters_play" },
      effects: [{ type: "exert", target: { type: "this" }, isMay: true }],
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
          attackerFilter: {
            cardType: ["character"],
            statComparisons: [{ stat: "cost", op: "lte", value: parseInt(statLocationProtection[1], 10) }],
          },
        },
      },
      unmatched: "",
    };
  }

  // "This character can't quest unless you have a character with N {W/S} or more in play."
  const statCantQuestUnless = /^This character can't quest unless you have a character with (\d+) \{(S|W)\} or more in play\.?$/i.exec(rest);
  if (statCantQuestUnless) {
    const stat = statCantQuestUnless[2].toUpperCase() === "S" ? "strength" : "willpower";
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
              statComparisons: [{ stat, op: "gte", value: parseInt(statCantQuestUnless[1], 10) }],
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

  // "This character can't challenge." / "This character can't quest." — bare
  // per-instance restriction. Match Chief Powhatan Protective Leader STANDS
  // HIS GROUND (set 11 baseline #11). Use `cant_action_self`, NOT
  // `action_restriction` (the latter applies to ALL of the player's
  // characters — a known no-op-stub pitfall called out in CLAUDE.md).
  // Note: Percy Pupsicle (#27) baseline uses action_restriction — that's a
  // baseline bug we intentionally do not reproduce.
  const statCantAction = /^This character can't (challenge|quest)\.?$/i.exec(rest);
  if (statCantAction) {
    const ability: Json = {
      type: "static",
      effect: { type: "cant_action_self", action: statCantAction[1].toLowerCase() },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character can't {E} to sing songs." — sing-restriction static.
  // 3× recurrence (Ariel On Human Legs set 1 #1 VOICELESS, Ulf Mime set 5
  // #73 SILENT PERFORMANCE, Dopey Drawn to Music set 12 #38 TONGUE-TIED).
  // Engine: cant_action_self with action: "sing".
  const statCantSing = /^This character can'?t \{E\} to sing songs\.?$/i.exec(rest);
  if (statCantSing) {
    const ability: Json = {
      type: "static",
      effect: { type: "cant_action_self", action: "sing" },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "While being challenged, this character gets +N {S/W/L}." — transient
  // self-buff that activates only while this character is the defender of
  // a challenge. 3× recurrence (Enchantress Unexpected Judge set 2 #80 +
  // reprints TRUE FORM, Flora Good Fairy set 5 #75 FIDDLE FADDLE).
  // Engine: gets_stat_while_being_challenged static.
  const statWhileChallenged =
    /^While being challenged, this character gets \+(\d+) \{(S|W|L)\}\.?$/i.exec(rest);
  if (statWhileChallenged) {
    const stat =
      statWhileChallenged[2].toUpperCase() === "S"
        ? "strength"
        : statWhileChallenged[2].toUpperCase() === "W"
          ? "willpower"
          : "lore";
    const ability: Json = {
      type: "static",
      effect: {
        type: "gets_stat_while_being_challenged",
        stat,
        amount: parseInt(statWhileChallenged[1], 10),
      },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "Whenever he/she/it/they challenges a <Trait> character, this character
  // takes no damage from the challenge." — defender-side challenge damage
  // prevention with attacker-target filter. 4× recurrence (Rafiki Mystical
  // Fighter set 3 #54 ANCIENT SKILLS, Peter Pan Pirate's Bane set 3 #120 +
  // reprints YOU'RE NEXT!). Engine: challenge_damage_prevention with
  // targetFilter on the challenged character's traits.
  // Note: oracle uses pronoun ('he challenges') not 'this character
  // challenges' — accept the pronoun forms inline.
  const statTakesNoChallengeDmg =
    /^Whenever (?:he|she|it|they|this character) challenges (?:a|an) ([A-Z][a-zA-Z]*) character, this character takes no damage from the challenge\.?$/i.exec(
      rest,
    );
  if (statTakesNoChallengeDmg) {
    const ability: Json = {
      type: "static",
      effect: {
        type: "challenge_damage_prevention",
        targetFilter: { hasTrait: statTakesNoChallengeDmg[1] },
      },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "Your characters not named X can't ready at the start of your turn." —
  // Mor'du Savage Cursed Prince ROOTED BY FEAR (set 12 baseline #57).
  // action_restriction with notHasName filter, restricts:"ready",
  // affectedPlayer:{type:"self"}.
  const statRootedByFear =
    /^Your characters not named ([\w''\- ]+?) can't ready at the start of your turn\.?$/i.exec(
      rest,
    );
  if (statRootedByFear) {
    const ability: Json = {
      type: "static",
      effect: {
        type: "action_restriction",
        restricts: "ready",
        affectedPlayer: { type: "self" },
        filter: {
          zone: "play",
          cardType: ["character"],
          notHasName: statRootedByFear[1].trim(),
        },
      },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character gets +N {stat} for each card in your hand." — bare
  // form (no "you have in play" trailing). 3× recurrence (Jafar Keeper
  // of Secrets set 1 #44 + reprints HIDDEN WONDERS, Marshmallow Terrifying
  // Snowman set 4 #51 BEHEMOTH). Emits modify_stat_per_count with
  // countFilter:{owner:self,zone:hand} matching the canonical baseline
  // shape. Note: the broader statDynamic matcher below requires "you have
  // in play" trailing, so it doesn't catch this bare wording.
  const statDynamicPerCardInHand =
    /^This character gets \+(\d+) \{(S|W|L)\} for each card in your hand\.?$/i.exec(rest);
  if (statDynamicPerCardInHand) {
    const stat =
      statDynamicPerCardInHand[2].toUpperCase() === "S"
        ? "strength"
        : statDynamicPerCardInHand[2].toUpperCase() === "W"
          ? "willpower"
          : "lore";
    const ability: Json = {
      type: "static",
      effect: {
        type: "modify_stat_per_count",
        stat,
        perCount: parseInt(statDynamicPerCardInHand[1], 10),
        countFilter: { owner: { type: "self" }, zone: "hand" },
        target: { type: "this" },
      },
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

  // "This character gets +N {stat} for each card under him/her/it/them." —
  // dynamic stat keyed off the source's own cardsUnder count. Uses
  // modify_stat_per_count with countCardsUnderSelf:true. 4× recurrence
  // (Genie Magical Researcher set 11 #49 INCREASING WISDOM, Wreck-it Ralph
  // Raging Wrecker set 11 #103 POWERED UP, Morty Fieldmouse Tiny Tim set
  // 11 #157 HOLIDAY CHEER).
  const statDynamicPerCardUnder = /^This character gets \+(\d+) \{(S|W|L)\} for each card under (?:him|her|it|them)\.?$/i.exec(rest);
  if (statDynamicPerCardUnder) {
    const stat =
      statDynamicPerCardUnder[2].toUpperCase() === "S"
        ? "strength"
        : statDynamicPerCardUnder[2].toUpperCase() === "W"
          ? "willpower"
          : "lore";
    const ability: Json = {
      type: "static",
      effect: {
        type: "modify_stat_per_count",
        stat,
        perCount: parseInt(statDynamicPerCardUnder[1], 10),
        countCardsUnderSelf: true,
        target: { type: "this" },
      },
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character gets +X {stat} and +Y {stat}" — compound stat buff
  // (Wendy Darling Courageous Captain LOOK LIVELY CREW!, set 6 baseline
  // #108: "While X, this character gets +1 {S} and +1 {L}"). Hand-wired
  // baseline encodes this as TWO static abilities sharing a storyName,
  // which violates structural fidelity (CLAUDE.md). Compiler emits the
  // correct one-ability shape with effect-array. Place BEFORE the bare
  // statGetsStat so compound wins.
  const statGetsTwoStats = /^This character gets ([+-]?\d+) \{(S|W|L)\} and ([+-]?\d+) \{(S|W|L)\}\.?$/i.exec(rest);
  if (statGetsTwoStats) {
    const statName = (s: string) =>
      s.toUpperCase() === "S" ? "strength" : s.toUpperCase() === "W" ? "willpower" : "lore";
    const ability: Json = {
      type: "static",
      effect: [
        {
          type: "modify_stat",
          stat: statName(statGetsTwoStats[2]),
          amount: parseInt(statGetsTwoStats[1], 10),
          target: { type: "this" },
        },
        {
          type: "modify_stat",
          stat: statName(statGetsTwoStats[4]),
          amount: parseInt(statGetsTwoStats[3], 10),
          target: { type: "this" },
        },
      ],
    };
    if (leadingCondition) ability.condition = leadingCondition;
    return { ability, unmatched: "" };
  }

  // "This character gets +X {stat} and gains <Keyword>[+M]" — compound static
  // body. Uses StaticAbility's array effect form (CRD 6.2.6, types/index.ts
  // line 198-200: "Array form for compound abilities: 'While X, [A] and [B]'").
  // Match Nala Undaunted Lioness DETERMINED DIVERSION (set 9 baseline #173,
  // "+1 {L} and gains Resist +1") — though Nala's hand-wired baseline has a
  // duplicated condition bug (compound_and of two identical this_has_no_damage),
  // so we emit the correct shape with the single condition. Place BEFORE the
  // bare statGetsStat so the compound form wins on overlap.
  const statGetsStatAndGainsKw = /^This character gets ([+-]?\d+) \{(S|W|L)\} and gains (Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish)(?: \+(\d+))?\.?$/i.exec(rest);
  if (statGetsStatAndGainsKw) {
    const stat =
      statGetsStatAndGainsKw[2].toUpperCase() === "S"
        ? "strength"
        : statGetsStatAndGainsKw[2].toUpperCase() === "W"
          ? "willpower"
          : "lore";
    const kwEffect: Json = {
      type: "grant_keyword",
      keyword: statGetsStatAndGainsKw[3].toLowerCase(),
      target: { type: "this" },
    };
    if (statGetsStatAndGainsKw[4]) kwEffect.value = parseInt(statGetsStatAndGainsKw[4], 10);
    const ability: Json = {
      type: "static",
      effect: [
        {
          type: "modify_stat",
          stat,
          amount: parseInt(statGetsStatAndGainsKw[1], 10),
          target: { type: "this" },
        },
        kwEffect,
      ],
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
    // Unwrap the __compoundEffect marker emitted by the filter-target
    // compound-stat path (Beast FULL DANCE CARD: "+1 {S} and +1 {W}") into
    // StaticAbility's effect-array form. Single-effect path stays as-is.
    const effect: Json | Json[] = fStats.__compoundEffect ? fStats.effects : fStats;
    const ability: Json = { type: "static", effect };
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

/** Shape 4: "A. If <condition>, B instead." — CRD 6.5.6 self-replacement.
 *  "Deal 2 damage to chosen opposing character. If you have a character named
 *   Darkwing Duck in play, deal 3 damage instead." Wraps as `self_replacement`
 *  hoisting the shared target out of the inner effects.
 *
 *  Constraints (defensive — narrow to known-clean cases):
 *   - Both halves must parse as a SINGLE effect (no chains on either side).
 *   - Both halves must have deep-equal target shapes; the shared target is
 *     hoisted to the self_replacement and the inner effects use target:"this".
 *   - The inner effects must be of the same `type` (deal_damage in all four
 *     observed cards: Helga set 12 #93, Terror That Flaps set 11 #197,
 *     Mountain Defense set 5 #204, Kakamora set 6 #172). Restricting to
 *     deal_damage avoids false positives on other "if X, instead" shapes.
 *
 *  Matches the canonical encoding used by Terror That Flaps in the Night
 *  baseline (set 11 baseline #197 actionEffects[0]).
 */
function tryAInsteadOfBIfC(text: string): Json | null {
  // Pattern: "deal <N> damage to <target>. If <cond>, deal <M> damage instead."
  // The variant ("deal M damage") doesn't repeat the target — it's inherited
  // from the base by oracle convention. Narrow to deal_damage so we can
  // confidently inherit the target without ambiguity. Other paired effect
  // types (gain_lore, draw, etc.) would extend this matcher.
  const m = /^deal (\d+) damage to (.+?)\.\s+(?:If|if)\s+(.+?),\s+deal (\d+) damage instead\.?$/i.exec(text);
  if (!m) return null;
  const baseAmount = parseInt(m[1], 10);
  const targetPhrase = m[2].trim();
  const condText = m[3].trim();
  const variantAmount = parseInt(m[4], 10);

  // Reuse the deal_damage matchers to parse the target phrase. We construct
  // a synthetic "deal <N> damage to <target>" string and run matchEffect on it.
  const synthetic = `deal ${baseAmount} damage to ${targetPhrase}`;
  const baseEff = matchEffect(synthetic);
  if (!baseEff || baseEff.consumed !== synthetic.length) return null;
  if (baseEff.json.type !== "deal_damage") return null;

  // Match the condition. CONDITION_MATCHERS anchor on "if|while" prefix, but
  // our regex stripped the "If" before captures — re-prepend "if " so the
  // matcher hits, then verify it consumed the full prefix-included length.
  const condTextWithIf = `if ${condText}`;
  const cond = matchCondition(condTextWithIf);
  if (!cond || cond.consumed !== condTextWithIf.length) return null;

  // Hoist the target out; inner effects target "this" so the engine resolves
  // them against the self_replacement's resolved target. The variant inherits
  // everything from the base (target, filter, isUpTo, etc.) except amount.
  const target = baseEff.json.target;
  const baseInner: Json = { ...baseEff.json, amount: baseAmount, target: { type: "this" } };
  const variantInner: Json = { ...baseEff.json, amount: variantAmount, target: { type: "this" } };

  return {
    type: "self_replacement",
    target,
    condition: cond.json,
    effect: [baseInner],
    instead: [variantInner],
  };
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
  // Compound form first: "get +N {stat1} and +M {stat2}" (no duration support
  // here — the compound form is always the durationless static buff per the
  // hand-wired baseline). Match Beast Gracious Prince FULL DANCE CARD
  // (set 9 baseline #4: "Your Princess characters get +1 {S} and +1 {W}"),
  // The Colonel Old Sheepdog WE'VE GOT 'EM OUTNUMBERED (set 8 #17:
  // "While X, this character gets +2 {S} and +2 {L}" — "this character"
  // case is handled separately above; the filter-target case is here).
  // Returns a marker `{ __compoundEffect: true, effects: [...] }` that
  // the caller unwraps into a static with effect-array.
  const mStatTwo = /^\s+get ([+-]?\d+) \{(S|W|L)\} and ([+-]?\d+) \{(S|W|L)\}\.?$/i.exec(after);
  if (mStatTwo) {
    const statName = (s: string) =>
      s.toUpperCase() === "S" ? "strength" : s.toUpperCase() === "W" ? "willpower" : "lore";
    return {
      __compoundEffect: true,
      effects: [
        {
          type: "modify_stat",
          stat: statName(mStatTwo[2]),
          amount: parseInt(mStatTwo[1], 10),
          target: { type: "all", filter: f.filter },
        },
        {
          type: "modify_stat",
          stat: statName(mStatTwo[4]),
          amount: parseInt(mStatTwo[3], 10),
          target: { type: "all", filter: f.filter },
        },
      ],
    };
  }
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

  // Shape 4: "A. If <condition>, B instead." — CRD 6.5.6 self-replacement.
  // "Deal 2 damage to chosen opposing character. If you have a character
  //  named Darkwing Duck in play, deal 3 damage instead." Wraps as a
  // self_replacement effect that hoists the shared target out of the inner
  // effect bodies. Currently narrow to deal_damage on both sides; can extend
  // to other paired effect types later.
  const aInsteadB = tryAInsteadOfBIfC(rest);
  if (aInsteadB) return { json: [aInsteadB], consumedAll: true, remainder: "" };

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
    // Multi-effect matcher inline-flatten — a single oracle phrase like
    // "chosen opponent reveals their hand and discards an action card of
    // your choice" emits two flat effects (reveal_hand, discard_from_hand)
    // wrapped in `__actionEffects__` to fit the matcher framework's
    // single-effect contract. Splice them in instead of pushing the wrapper.
    if (m.json.type === "__actionEffects__" && Array.isArray(m.json.effects)) {
      effects.push(...m.json.effects);
    } else {
      effects.push(m.json);
    }
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
      .replace(/<(Rush|Evasive|Ward|Reckless|Bodyguard|Support|Challenger|Resist|Vanish|Shift|Singer|Sing Together|Boost|Alert|Universal Shift)>/gi, "$1")
      // Generic leading + trailing reminder-paren strip (same logic as
    // Strip a leading keyword-with-value preamble before the leading-paren
    // strip below. Sing Together songs (Look at This Family, Dig a Little
    // Deeper) have the shape "Sing Together N (Any number of...)<body>"
    // after bracket unwrap; without this strip the leading-paren strip
    // wouldn't fire. Same applies to Singer N, Shift N {I}, Boost N {I}.
    .replace(/^(?:Sing Together|Singer|Boost|Shift|Universal Shift)\s+\d+\s*(?:\{[A-Z]\})?\s*/i, "")
      // compileAbility above \u2014 see comment there for rationale).
      .replace(/^\(\s*[^)]*\)\s*/, "")
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
        // Flatten nested __actionEffects__ wrappers — some EFFECT_MATCHERS emit
        // the wrapper as a "container" pseudo-effect (e.g.
        // opponent_partition_3way_hand_bottom_top) which would otherwise leak
        // through as a literal `{type:"__actionEffects__"}` entry on disk and
        // get flagged as an unknown engine type by card-status.
        const flatten = (effects: Json[]): Json[] => {
          const out: Json[] = [];
          for (const e of effects) {
            if (e && e.type === "__actionEffects__" && Array.isArray(e.effects)) {
              out.push(...flatten(e.effects));
            } else {
              out.push(e);
            }
          }
          return out;
        };
        const flatEffects = flatten(ab.effects);
        const issues = validateJson({ effects: flatEffects }, known);
        if (issues.length > 0) {
          skippedUnknown++;
          unknownReport.push({ card: card.fullName, issues });
          continue;
        }
        card.actionEffects = flatEffects;
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
