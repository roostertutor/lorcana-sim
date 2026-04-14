#!/usr/bin/env node
// =============================================================================
// CARD DECOMPILER + ORACLE-TEXT DIFF
// -----------------------------------------------------------------------------
// Walks every card in packages/engine/src/cards/lorcast-set-*.json, renders
// its ability JSON back into English using a deterministic .toString()-style
// pass, normalizes both sides, and scores similarity against the printed
// `rulesText` (Lorcast oracle text). Sorts by worst match so a human reviewer
// can sweep the tail for wiring bugs / missed assumptions / synonymous-but-
// technically-incorrect implementations.
//
// This is intentionally NOT an LLM rewrite — it's a fixed renderer so the
// diff is reproducible and re-runnable in CI. Unknown effect types render
// as `[unknown:foo]` markers; those automatically show up as mismatches and
// guide future extensions of the renderer.
//
// Run:
//   pnpm decompile-cards                       # top 50 worst matches, text
//   pnpm decompile-cards --top 200             # show more
//   pnpm decompile-cards --all                 # show every card
//   pnpm decompile-cards --html report.html    # side-by-side HTML report
//   pnpm decompile-cards --json                # machine-readable
//   pnpm decompile-cards --set 003             # restrict to one set
//   pnpm decompile-cards --min 0.6             # only cards below this score
//   pnpm decompile-cards --card "Ariel"        # filter by name substring
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

// -----------------------------------------------------------------------------
// Defensive local types — the renderer treats unknown shapes as opaque rather
// than crashing, so it stays robust to JSON drift.
// -----------------------------------------------------------------------------
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
  shiftCost?: number;
  singTogetherCost?: number;
  /** "You can't play this character unless ..." — checked at PLAY_CARD time
   *  by the validator. Each entry is a Condition object with the same shape
   *  used by triggered/static abilities. */
  playRestrictions?: Json[];
  /** Dual-name characters whose card "counts as being named X" for Shift /
   *  name-matching effects. Stored as a scalar field rather than an ability
   *  (Flotsam & Jetsam, Turbo - Royal Hack). */
  alternateNames?: string[];
}

// =============================================================================
// PER-CARD OVERRIDES
// -----------------------------------------------------------------------------
// If the generic renderer can't reasonably express a card's wording (rare —
// most cards decompose into the standard primitives), drop a hand-written
// description here keyed by card id. Currently empty: the explore pass
// confirmed no per-card verbose describers exist anywhere in the repo, so
// we're starting from a clean slate. Add entries only as a last resort —
// prefer extending the generic renderer.
// =============================================================================
const CARD_OVERRIDES: Record<string, string> = {};

// =============================================================================
// RENDERER
// =============================================================================

function renderCard(card: CardJSON): string {
  if (CARD_OVERRIDES[card.id]) return CARD_OVERRIDES[card.id]!;

  const parts: string[] = [];
  // Reminder text of songs. Sing Together songs use a different reminder
  // ("Any number of your or your teammates' characters with total cost N
  // or more may {E} to sing this song for free.") — emit the matching
  // form so the diff doesn't double-up.
  if (card.traits.includes("Song")) {
    if (card.singTogetherCost !== undefined && card.rulesText?.includes("Sing Together")) {
      parts.push(`Sing Together ${card.singTogetherCost} (Any number of your or your teammates' characters with total cost ${card.singTogetherCost} or more may {E} to sing this song for free.)`);
    } else {
      parts.push(`(A character with cost ${card.cost} or more can {E} to sing this song for free.)`);
    }
  }

  // Dual-name characters: Flotsam & Jetsam, Turbo - Royal Hack. The card
  // "counts as being named X" for Shift / name-matching purposes.
  if (card.alternateNames && card.alternateNames.length > 0) {
    const names = card.alternateNames.join(" and ");
    parts.push(`This character counts as being named ${names}`);
  }

  // Play restrictions ("you can't play this character unless ...") are
  // CardDefinition-level, not ability-level. Conditions render with an "if "
  // prefix; we strip it and prepend "unless " for the natural reading.
  for (const restriction of card.playRestrictions ?? []) {
    parts.push(`You can't play this character unless ${stripIfPrefix(renderCondition(restriction))}`);
  }

  for (const ab of card.abilities ?? []) {
    // Skip all bare keyword abilities — these are printed as icons/badges on
    // the physical card, not in the rules text box. The oracle rulesText only
    // contains named abilities (STORY_NAME ...) and their descriptions.
    if (ab.type === "keyword") continue;
    parts.push(renderAbility(ab, { cardType: card.cardType }));
  }
  // Action / song bodies live on actionEffects.
  for (const eff of card.actionEffects ?? []) {
    parts.push(renderEffect(eff));
  }

  return parts.filter(Boolean).join(". ") + (parts.length ? "." : "");
}

function renderAbility(ab: Json, ctx?: { cardType?: string }): string {
  switch (ab.type) {
    case "keyword":
      return ab.value !== undefined ? `${cap(ab.keyword)} +${ab.value}` : cap(ab.keyword);
    case "triggered":
      return renderTriggered(ab);
    case "activated":
      return renderActivated(ab, ctx);
    case "static":
      return renderStatic(ab);
    case "replacement":
      return `[replacement] ${renderEffect(ab.effect ?? {})}`;
    default:
      return `[unknown-ability:${ab.type ?? "?"}]`;
  }
}

// =============================================================================
// PATTERN TABLES
// -----------------------------------------------------------------------------
// Modeled after the audit-lorcast-data.ts pattern tables (FLAG_KEYWORDS /
// NUMERIC_KEYWORDS). Each table maps a JSON discriminator (`type` / `on`)
// to a render function that emits oracle-shaped English. The table itself
// is the coverage checklist — anything not present renders as `[unknown:X]`
// and surfaces in the diff as a renderer gap.
// =============================================================================

type Renderer = (e: Json, ctx?: { cardType?: string }) => string;

// -----------------------------------------------------------------------------
// Triggers — careful word distinctions per CLAUDE.md (when vs. whenever vs.
// start vs. end). Filter-aware: "your"-owned filters become "one of your
// characters" instead of "this character".
// -----------------------------------------------------------------------------
const TRIGGER_RENDERERS: Record<string, Renderer> = {
  enters_play:                   ()  => "When you play this character",
  leaves_play:                   ()  => "When this character leaves play",
  is_banished:                   (t) => t.filter ? `Whenever one of your ${renderFilter(t.filter)} is banished` : "When this character is banished",
  banished_in_challenge:         (t) => {
    if (t.filter?.owner?.type === "self") return "Whenever one of your other characters is banished in a challenge";
    if (t.filter?.excludeSelf) return "Whenever another character is banished in a challenge";
    return "When this character is challenged and banished";
  },
  banished_other_in_challenge:   (t) => t.filter ? `Whenever this character banishes ${renderFilter(t.filter)} in a challenge` : "Whenever this character banishes another character in a challenge",
  banishes_in_challenge:         ()  => "Whenever this character banishes another character in a challenge",
  // Legacy spelling alias.
  banished_other:                ()  => "Whenever this character banishes another character in a challenge",
  is_challenged:                 ()  => "Whenever this character is challenged",
  // Legacy spelling alias.
  challenged:                    ()  => "Whenever this character is challenged",
  challenges:                    (t) => filterMentionsYour(t.filter)
                                          ? "Whenever one of your characters challenges another character"
                                          : "Whenever this character challenges another character",
  // Legacy spelling alias for `challenges`.
  challenge_initiated:           (t) => filterMentionsYour(t.filter)
                                          ? "Whenever one of your characters challenges another character"
                                          : "Whenever this character challenges another character",
  quests:                        (t) => filterMentionsYour(t.filter)
                                          ? "Whenever one of your characters quests"
                                          : "Whenever this character quests",
  sings:                         ()  => "Whenever this character sings a song",
  turn_start:                    (t) => t.player?.type === "opponent"
                                          ? "At the start of an opponent's turn"
                                          : "At the start of your turn",
  turn_end:                      (t) => t.player?.type === "opponent"
                                          ? "At the end of an opponent's turn"
                                          : "At the end of your turn",
  card_drawn:                    ()  => "Whenever you draw a card",
  card_played: (t) => {
    if (!t.filter) return "Whenever you play a card";
    // No owner filter = ANY player ("whenever another character is played")
    const hasOwnerFilter = t.filter.owner?.type;
    const filt = renderFilter(t.filter);
    if (!hasOwnerFilter && t.filter.excludeSelf) return `Whenever another ${filt} is played`;
    if (!hasOwnerFilter) return `Whenever ${filt} is played`;
    return `Whenever you play ${filt}`;
  },
  // item_played: DELETED — collapsed to card_played with cardType filter
  ink_played:                    ()  => "Whenever you put a card into your inkwell",
  moves_to_location:             ()  => "Whenever this character moves to a location",
  damage_dealt_to:               ()  => "Whenever damage is dealt to this character",
  damage_removed_from:           (t) => t.filter?.owner?.type === "self" ? "Whenever you remove 1 or more damage from one of your characters" : "Whenever damage is removed from this character",
  readied:                       ()  => "Whenever this character is readied",
  returned_to_hand:              ()  => "Whenever this character is returned to your hand",
  cards_discarded:               ()  => "Whenever a card is discarded",
  deals_damage_in_challenge:     ()  => "Whenever this character deals damage in a challenge",
  card_put_under:                ()  => "Whenever a card is put underneath this",
  shifted_onto:                  ()  => "Whenever a character is shifted onto this character",
  chosen_by_opponent:            ()  => "Whenever this character is chosen by an opponent",
  character_exerted:             ()  => "Whenever a character is exerted",
  chosen_for_support:            ()  => "Whenever this character is chosen for support",
};

function renderTrigger(t: Json): string {
  const ev = t.on ?? t.event ?? "";
  const fn = TRIGGER_RENDERERS[ev];
  return fn ? fn(t) : `[unknown-trigger:${ev}]`;
}

function filterMentionsYour(f: Json | undefined): boolean {
  return !!(f && f.owner?.type === "self");
}

// -----------------------------------------------------------------------------
// Conditions — gating for triggered + static abilities. Includes the negated
// `not` wrapper used by "can't quest unless ..." patterns.
// -----------------------------------------------------------------------------
const CONDITION_RENDERERS: Record<string, Renderer> = {
  is_your_turn:               ()  => "during your turn",
  this_is_exerted:            ()  => "if this character is exerted",
  has_character_named:        (c) => `if you have a character named ${c.name} in play`,
  has_character_with_trait:   (c) => `if you have ${c.excludeSelf ? "another" : "a"} ${c.trait} character in play`,
  controls_location:          ()  => "if you have a location in play",
  // `not` wraps a sub-condition. Renders as "unless ..." so it slots into
  // "this character can't quest UNLESS you have another Seven Dwarfs in play".
  not:                        (c) => "unless " + stripIfPrefix(renderCondition(c.condition ?? {})),

  // ---- Compound logic ------------------------------------------------------
  compound_and:               (c) => "if " + (c.conditions ?? []).map((sub: Json) => stripIfPrefix(renderCondition(sub))).join(" and "),
  compound_or:                (c) => "if " + (c.conditions ?? []).map((sub: Json) => stripIfPrefix(renderCondition(sub))).join(" or "),
  compound_not:               (c) => "unless " + stripIfPrefix(renderCondition(c.inner ?? {})),

  // ---- Player-state checks --------------------------------------------------
  // "If you have a [filter] in play" — supersedes the legacy single-trait /
  // single-name forms when the filter is more general.
  you_control_matching:       (c) => `if you have ${c.filter ? renderFilter(c.filter) : "a character"} in play`,
  cards_in_hand_gte:          (c) => `if you have ${c.amount ?? 0} or more cards in your hand`,
  cards_in_hand_eq:           (c) => (c.amount ?? 0) === 0 ? "if you have no cards in your hand" : `if you have exactly ${c.amount} cards in your hand`,
  cards_in_zone_gte:          (c) => `if you have ${c.amount ?? 0} or more cards in your ${c.zone ?? "zone"}`,
  characters_in_play_gte:     (c) => {
    const n = c.amount ?? 0;
    const adj = c.excludeSelf ? "other " : "";
    if (n === 1 && c.excludeSelf) return "if you have another character in play";
    return `if you have ${n} or more ${adj}characters in play`;
  },
  opponent_has_more_cards_in_hand:  () => "if an opponent has more cards in their hand than you",
  self_has_more_than_each_opponent: (c) => `if you have more ${c.metric ?? "cards"} than each opponent`,
  played_another_character_this_turn: () => "if you've played another character this turn",
  your_first_turn_as_underdog: () => "during your first turn as the underdog",

  // ---- This-card-state checks ----------------------------------------------
  this_has_no_damage:         () => "if this character has no damage",
  this_has_cards_under:       () => "if this character has cards under it",
  this_at_location:           () => "while this character is at a location",
  this_location_has_character: () => "if this location has a character at it",
  played_via_shift:           () => "if this character was played via Shift",
  triggering_card_played_via_shift: () => "if the triggering character was played via Shift",

  // ---- This-card-stat checks ------------------------------------------------
  self_stat_gte:              (c) => `if this character's ${c.stat ?? "strength"} is ${c.amount ?? 0} or more`,
  this_had_card_put_under_this_turn: () => "if a card was put under this character this turn",
  this_location_has_exerted_character: () => "if this location has an exerted character at it",

  // ---- Turn-history checks --------------------------------------------------
  no_challenges_this_turn:    () => "if no characters have challenged this turn",
  opponent_character_was_banished_in_challenge_this_turn:
                              () => "if an opposing character was banished in a challenge this turn",
  ink_plays_this_turn_eq:     (c) => `if you've played exactly ${c.amount ?? 0} cards into your inkwell this turn`,
  songs_played_this_turn_gte: (c) => `if you've played ${c.amount ?? 0} or more songs this turn`,
  actions_played_this_turn_gte: (c) => `if you've played ${c.amount ?? 0} or more actions this turn`,
  actions_played_this_turn_eq: (c) => `if you've played exactly ${c.amount ?? 0} actions this turn`,
  your_character_was_damaged_this_turn: () => "if one of your characters was damaged this turn",
  no_other_character_quested_this_turn: () => "if no other character has quested this turn",
  card_left_discard_this_turn: () => "if a card left a player's discard this turn",
  this_had_card_put_under_this_turn: () => "if a card was put under this character this turn",

  // Pete Games Referee — "during your turn, opponents can't play actions"
  opponent_no_challenges_this_turn: () => "if no opposing character has challenged this turn",
};

function stripIfPrefix(s: string): string {
  return s.replace(/^if\s+/, "");
}

function renderCondition(c: Json): string {
  if (!c || !c.type) return "";
  const fn = CONDITION_RENDERERS[c.type];
  return fn ? fn(c) : `[cond:${c.type}]`;
}

// -----------------------------------------------------------------------------
// Costs — for activated abilities.
// -----------------------------------------------------------------------------
const COST_RENDERERS: Record<string, Renderer> = {
  exert:              ()  => "{E}",
  ink:                (c) => `${c.amount ?? "?"} {I}`,
  pay_ink:            (c) => `${c.amount ?? "?"} {I}`,
  banish_chosen:      (c) => `Banish ${renderTarget(c.target ?? {})}`,
  banish_self:        (_c, ctx) => `Banish this ${ctx?.cardType === "item" ? "item" : "character"}`,
  discard:            ()  => "Discard a card",
  discard_from_hand:  ()  => "Discard a card",
};

function renderCost(c: Json, ctx?: { cardType?: string }): string {
  const fn = COST_RENDERERS[c.type];
  return fn ? fn(c, ctx) : `[cost:${c.type}]`;
}

// -----------------------------------------------------------------------------
// Effects — the big table. Each renderer emits oracle-shaped phrasing,
// agreeing in person/number with the target ("you gain" vs "each opponent
// gains"). Adding a new effect type = adding a row here.
// -----------------------------------------------------------------------------
const EFFECT_RENDERERS: Record<string, Renderer> = {
  draw: (e) => {
    // `untilHandSize` is a runtime-computed draw count; the literal `amount`
    // field is a 0 placeholder in that case (Clarabelle / Yzma / Remember Who
    // You Are pattern). Render the runtime form so it doesn't false-positive
    // as a "draws 0 cards" stub.
    if (e.untilHandSize === "match_opponent_hand") {
      return `${maybe(e)}draw cards until you have the same number as chosen opponent`;
    }
    if (typeof e.untilHandSize === "number") {
      return `${maybe(e)}draw cards until you have ${e.untilHandSize} cards in your hand`;
    }
    // Subject framing: target=both → "each player draws N", target=opponent → "each opponent draws N".
    // Default (self) keeps the original "draw N cards" phrasing.
    const subject = e.target?.type === "both" ? "each player draws " :
                    e.target?.type === "opponent" ? "each opponent draws " :
                    "draw ";
    const amt = e.amount ?? 1;
    if (typeof amt !== "number") {
      return `${maybe(e)}${subject}cards equal to ${renderAmount(amt)}`;
    }
    if (amt === 1) return `${maybe(e)}${subject}a card`;
    return `${maybe(e)}${subject}${amt} cards`;
  },
  discard:            (e) => `${maybe(e)}discard ${e.amount ?? 1} card${plural(e.amount ?? 1)}`,
  discard_from_hand:  (e) => {
    const amt = e.amount === "all" ? "their hand" : `${e.amount ?? 1} card${plural(e.amount ?? 1)}`;
    if (e.target?.type === "both") {
      return `${maybe(e)}each player discards ${amt}`;
    }
    if (e.target?.type === "opponent") {
      const chooser = e.chooser === "target_player" ? "chooses and " : "";
      return `${maybe(e)}each opponent ${chooser}discards ${amt}`;
    }
    if (e.chooser === "target_player") {
      return `${maybe(e)}choose and discard ${amt}`;
    }
    return `${maybe(e)}discard ${amt}`;
  },

  gain_lore: (e) => {
    const tgt = renderTarget(e.target ?? { type: "self" });
    const n = e.amount ?? 1;
    if (typeof n === "number") {
      if (n < 0) return `${tgt} ${verbS(tgt, "lose", "loses")} ${-n} lore`;
      return `${tgt} ${verbS(tgt, "gain", "gains")} ${n} lore`;
    }
    return `${tgt} ${verbS(tgt, "gain", "gains")} lore equal to ${renderAmount(n)}`;
  },
  lose_lore: (e) => {
    const tgt = renderTarget(e.target ?? { type: "self" });
    return `${tgt} ${verbS(tgt, "lose", "loses")} ${e.amount ?? 1} lore`;
  },
  prevent_lore_gain: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} can't gain lore${dur(e)}`;
  },

  deal_damage: (e) => {
    const amt = e.amount ?? 1;
    const amtStr = typeof amt === "number" ? `${up(e)}${amt}` : `damage equal to ${renderAmount(amt)}`;
    return typeof amt === "number"
      ? `${maybe(e)}deal ${amtStr} damage to ${renderTarget(e.target ?? {})}`
      : `${maybe(e)}deal ${amtStr} to ${renderTarget(e.target ?? {})}`;
  },
  remove_damage:  (e) => `${maybe(e)}remove ${up(e)}${typeof e.amount === "number" ? e.amount : renderAmount(e.amount)} damage from ${renderTarget(e.target ?? {})}`,
  move_damage:    (e) => `${maybe(e)}move ${up(e)}${e.amount ?? 1} damage from ${renderTarget(e.from ?? {})} to ${renderTarget(e.to ?? {})}`,

  banish: (e) => {
    if (e.target?.chooser === "target_player") return `${maybe(e)}each opponent chooses and banishes ${renderTarget(e.target)}`;
    return `${maybe(e)}banish ${renderTarget(e.target ?? {})}`;
  },
  banish_chosen:  (e) => `${maybe(e)}banish ${renderTarget(e.target ?? {})}`,
  return_to_hand: (e) => {
    const tgt = e.target?.type ?? "this";
    if (tgt === "this") return `${maybe(e)}return this card to your hand`;
    if (tgt === "triggering_card") return `${maybe(e)}return that card to its player's hand`;
    return `${maybe(e)}return ${renderTarget(e.target ?? {})} to their player's hand`;
  },
  ready: (e) => {
    const base = `${maybe(e)}ready ${renderTarget(e.target ?? {})}`;
    if (e.followUpEffects?.length) {
      const followUp = e.followUpEffects.map((f: Json) => renderEffect(f)).join(". ");
      return `${base}. ${followUp}`;
    }
    return base;
  },
  exert: (e) => {
    const upTo = e.isUpTo ? "up to " : "";
    const count = e.count && e.count > 1 ? `${e.count} ` : "";
    const base = `exert ${upTo}${count}${renderTarget(e.target ?? {})}`;
    if (e.followUpEffects?.length) {
      const followUp = e.followUpEffects.map((f: Json) => renderEffect(f)).join(". ");
      return `${base}. ${followUp}`;
    }
    return base;
  },
  exert_character: (e) => {
    const base = `exert ${renderTarget(e.target ?? {})}`;
    if (e.followUpEffects?.length) {
      const followUp = e.followUpEffects.map((f: Json) => renderEffect(f)).join(". ");
      return `${base}. ${followUp}`;
    }
    return base;
  },

  gain_stats: (e) => renderStatChange(e),
  modify_stat: (e) => renderStatChange(e),

  grant_keyword: (e) => {
    const tgt = renderTarget(e.target ?? {});
    let v = "";
    if (e.valueDynamic) {
      v = " +" + renderAmount(e.valueDynamic);
    } else if (e.value !== undefined) {
      v = " +" + e.value;
    }
    return `${tgt} ${verbS(tgt, "gain", "gains")} ${cap(e.keyword)}${v}${dur(e)}`;
  },

  cant_action: (e) => {
    const tgt = renderTarget(e.target ?? {});
    const action = e.action === "be_challenged" ? "be challenged"
      : e.action === "ready" ? "ready"
      : e.action ?? "act";
    const d = dur(e);
    // "They can't ready at the start of their next turn" is more natural
    if (e.action === "ready" && e.duration === "end_of_owner_next_turn") {
      return `${tgt} can't ready at the start of their next turn`;
    }
    return `${tgt} can't ${action}${d}`;
  },
  // Self-restriction variant — same shape as cant_action but always targets
  // this character. Used by Maui - Whale "this character can't ready..."
  cant_action_self: (e) => `this character can't ${e.action ?? "act"}${dur(e)}`,

  // pay_ink as an effect (e.g. Ursula's Shell Necklace nested cost-as-effect).
  // The cost-side renderer in COST_RENDERERS handles the activated-cost form;
  // this entry covers the rare effect-side usage.
  pay_ink: (e) => `pay ${e.amount ?? 1} {I}`,

  self_cost_reduction: (e) => {
    const amt = e.amount;
    if (typeof amt === "number") return `this character costs ${amt} {I} less to play`;
    if (typeof amt === "string") return `this character costs ${amt} {I} less to play`;
    if (typeof amt === "object" && amt?.type === "count") {
      const filt = amt.filter ? renderFilter(amt.filter) : "matching card";
      return `For each ${filt}, you pay ${e.perMatch ?? 1} {I} less to play this character`;
    }
    return `this character costs less to play`;
  },
  grant_play_for_free_self:   ()  => "you may play this character for free",
  grant_shift_self:           (e) => `this character gains Shift ${e.value ?? e.amount ?? "?"}`,
  grant_cost_reduction: (e) => {
    const amt = typeof e.amount === "number" ? `${e.amount}` : typeof e.amount === "object" ? renderAmount(e.amount) : `${e.amount ?? "?"}`;
    return `you pay ${amt} {I} less for the next ${e.filter ? renderFilter(e.filter) : "card"} you play this turn`;
  },
  cost_reduction: (e) => {
    const amt = typeof e.amount === "number" ? `${e.amount}` : typeof e.amount === "object" ? renderAmount(e.amount) : `${e.amount ?? "?"}`;
    const filt = e.filter ? pluralizeFilter(renderFilter(e.filter)) : "cards";
    return `you pay ${amt} {I} less to play ${filt}`;
  },

  play_card: (e) => {
    // When chained after peek_and_set_target (Robin Hood, Powerline), the
    // previous renderer already says "...and play it for free". Suppress the
    // redundant second phrase by returning empty — the effect still runs in
    // the engine.
    if (e.target?.type === "last_resolved_target") return "";
    const costClause = e.cost === "normal" ? "" : " for free";
    return `${maybe(e)}play ${e.filter ? renderFilter(e.filter) : "a card"}${costClause}`;
  },

  look_at_top: (e) => {
    const count = e.count ?? "?";
    const base = `look at the top ${count} card${plural(count)} of your deck`;
    const filter = e.filter ? renderFilter(e.filter) : "a card";
    switch (e.action) {
      case "choose_from_top": {
        // Generalized chooser. pickDestination + restPlacement drive the rendering.
        const pickDest = e.pickDestination ?? "hand";
        const rest = e.restPlacement ?? "bottom";
        const maxPick = e.maxToHand ?? 1;
        if (pickDest === "deck_top") {
          // Ursula's Cauldron, Merlin Turtle: "put one on the top and the other on the bottom".
          if (count === 2 && maxPick === 1 && rest === "bottom") {
            return `${base}. Put one on the top of your deck and the other on the bottom`;
          }
          return `${base}. Keep ${maxPick} on top. Put the rest on the ${rest} of your deck`;
        }
        if (pickDest === "inkwell_exerted") {
          return `${base}. You may put one into your inkwell facedown and exerted`;
        }
        // pickDestination "hand" (default)
        if (maxPick === 1) {
          if (count === 2 && !e.filter) {
            return `${base}. Put one into your hand and the other on the bottom of your deck`;
          }
          return `${base}. You may reveal ${filter} and put it into your hand. Put the rest on the bottom of your deck in any order`;
        }
        return `${base}. You may put each ${filter} into your hand. Put the rest on the bottom of your deck in any order`;
      }
      case "top_or_bottom":
        if (count === 2) return `${base}. Put one on the top of your deck and the other on the bottom`;
        return `${base}. Put it on either the top or the bottom of your deck`;
      case "reorder":
        return `${base}. Put them back in any order`;
      case "peek_and_set_target": {
        // Pure chooser: peek top N, set lastResolvedTarget (via subsequent
        // effect like play_for_free). Renderer assumes the next effect is
        // play_for_free (Powerline, Robin Hood) and folds both into one
        // sentence matching the oracle.
        const placement = e.restPlacement ?? "bottom";
        const restClause = placement === "discard"
          ? " Put the rest in your discard"
          : placement === "top"
            ? ""  // handled by the next effect or oracle doesn't mention it
            : " Put the rest on the bottom of your deck in any order";
        return `${base}. You may reveal ${filter} and play it for free.${restClause}`;
      }
      // We Know the Way — look at top 1, may play for free if matches, else hand.
      case "one_to_play_for_free_else_to_hand":
        return `${base}. You may reveal ${filter} and play it for free. Otherwise, put it into your hand`;
      // Fred Giant-Sized I LIKE WHERE THIS IS HEADING — reveal until first match.
      case "reveal_until_match_to_hand_shuffle_rest":
        return `reveal cards from the top of your deck until you reveal ${filter}. Put that card into your hand and shuffle the others back into your deck`;
      default:
        return base;
    }
  },
  reveal_top_conditional: (e) => {
    const tgt = e.target?.type === "opponent" ? "opponent's" : "your";
    const hasFilter = e.filter && Object.keys(e.filter).length > 0;
    const filter = hasFilter ? renderFilter(e.filter) : "a card";
    const exerted = e.matchEnterExerted ? " and they enter play exerted" : "";
    const playVerb = e.matchPayCost ? "play it as if it were in your hand" : `play it for free${exerted}`;
    const match = e.matchAction === "to_hand" ? "put it into your hand"
      : e.matchAction === "play_card" ? `you may ${playVerb}`
      : e.matchAction === "to_inkwell_exerted" ? "put it into your inkwell facedown and exerted"
      : e.matchAction ?? "keep it";
    const noMatch = e.noMatchDestination === "bottom" ? "put it on the bottom of your deck"
      : e.noMatchDestination === "hand" ? "put it into your hand"
      : e.noMatchDestination === "discard" ? "put it in your discard"
      : e.noMatchDestination === "top" ? "put it on the top of your deck"
      : "put it back";
    // When filter is empty (Kristoff's Lute — match ANY revealed card),
    // skip the "If it's X" clause and just say "reveal ... and do Y."
    if (!hasFilter) {
      return `reveal the top card of ${tgt} deck. ${cap(match)}. Otherwise, ${noMatch}`;
    }
    return `reveal the top card of ${tgt} deck. If it's ${filter}, ${match}. Otherwise, ${noMatch}`;
  },
  search: (e) => {
    const filter = e.filter ? renderFilter(e.filter) : "a card";
    if (e.zone === "discard") return `return ${filter} from your discard to your hand`;
    const dest = e.putInto === "deck" && e.position === "top"
      ? ". Shuffle your deck and put that card on top of it"
      : e.putInto === "hand" ? " and put it into your hand" : "";
    return `search your deck for ${filter}${dest}`;
  },
  shuffle_into_deck:      (e) => `shuffle ${renderTarget(e.target ?? {})} into your deck`,
  move_to_inkwell: (e) => {
    const exerted = e.enterExerted ? " facedown and exerted" : " facedown";
    // Fishbone Quill: "put any card from your hand into your inkwell"
    if (e.target?.type === "chosen" && e.target.filter?.zone === "hand") {
      const filt = e.target.filter.cardType ? renderFilter(e.target.filter) : "card from your hand";
      return `put any ${filt} into your inkwell${exerted}`;
    }
    // One Jump Ahead: "put the top card of your deck into your inkwell"
    if (e.fromZone === "deck") {
      return `put the top card of your deck into your inkwell${exerted}`;
    }
    const from = e.fromZone ? ` from your ${e.fromZone}` : "";
    return `put ${renderTarget(e.target ?? {})}${from} into your inkwell${exerted}`;
  },
  put_top_card_under:  (e) => `put the top card of your deck facedown under ${renderTarget(e.target ?? {})}`,

  // Move a character to a location. The `character` selector reuses target
  // shapes ("this" / "chosen" / "all" with maxCount / "triggering_card" /
  // "last_resolved_target"); the `location` is its own selector. Renders
  // oracle-shaped phrasing for each combination.
  move_character: (e) => {
    const may = e.isMay ? "you may " : "";
    let who = "this character";
    if (e.character) {
      switch (e.character.type) {
        case "this": who = "this character"; break;
        case "triggering_card": who = "the triggering character"; break;
        case "last_resolved_target": who = "that character"; break;
        case "chosen":
          who = `chosen ${e.character.filter ? renderFilter(e.character.filter) : "character"}`;
          break;
        case "all":
          if (typeof e.character.maxCount === "number") {
            who = `up to ${e.character.maxCount} ${e.character.filter ? renderFilter(e.character.filter) : "characters"}`;
          } else {
            who = `any number of ${e.character.filter ? renderFilter(e.character.filter) : "characters"}`;
          }
          break;
      }
    }
    let where = "a location";
    if (e.location) {
      switch (e.location.type) {
        case "triggering_card": where = "that location"; break;
        case "last_resolved_target": where = "the same location"; break;
        case "chosen":
          where = `chosen ${e.location.filter ? renderFilter(e.location.filter) : "location"}`;
          break;
      }
    }
    return `${may}move ${who} to ${where} for free`;
  },

  sequential: (e) => {
    const may = e.isMay ? "you may " : "";
    const ce = (e.costEffects ?? []).map(renderEffect).filter(Boolean).join(" and ");
    const re = (e.rewardEffects ?? []).map(renderEffect).filter(Boolean).join(" and ");
    // Some sequentials use flat `effects` instead of costEffects/rewardEffects
    if (!ce && !re && e.effects) {
      const flat = (e.effects ?? []).map(renderEffect).filter(Boolean).join(", then ");
      return `${may}${flat}`;
    }
    if (!ce && re) return `${may}${re}`;
    if (ce && !re) return `${may}${ce}`;
    return `${may}${ce} to ${re}`;
  },
  choose: (e) => {
    // Two shapes: `options: Effect[][]` (Maui Fish Hook) OR `choices: {name, effects}[]` (Prepare Your Bot)
    const raw = e.options ?? e.choices ?? [];
    const opts = raw.map((o: Json) => {
      const effects = Array.isArray(o) ? o : (o.effects ?? [o]);
      const label = o.name ? `${o.name}: ` : "";
      return label + effects.map(renderEffect).filter(Boolean).join(" and ");
    }).filter(Boolean);
    return `choose one: ${opts.join(" OR ")}`;
  },
  choose_may: (e) => {
    const raw = e.options ?? e.choices ?? [];
    const opts = raw.map((o: Json) => {
      const effects = Array.isArray(o) ? o : (o.effects ?? [o]);
      const label = o.name ? `${o.name}: ` : "";
      return label + effects.map(renderEffect).filter(Boolean).join(" and ");
    }).filter(Boolean);
    return `choose one: ${opts.join(" OR ")}`;
  },

  damage_prevention:           (e) => `${renderTarget(e.target ?? {})} can't be damaged${dur(e)}`,
  // Permanent variant — applies as a static (Baloo Ol' Iron Paws "your
  // characters with 7+ {S} can't be damaged"). `source` distinguishes
  // "all" damage vs only "challenge" damage.
  damage_prevention_static: (e) => {
    const tgt = renderTarget(e.target ?? {});
    if (e.source === "challenge") return `${tgt} can't be damaged from challenges`;
    return `${tgt} can't be damaged`;
  },
  // Turn-scoped variant (Noi Acrobatic Baby "this character can't be
  // damaged from challenges this turn").
  damage_prevention_timed: (e) => {
    const tgt = renderTarget(e.target ?? {});
    if (e.source === "challenge") return `${tgt} can't be damaged from challenges${dur(e)}`;
    return `${tgt} can't be damaged${dur(e)}`;
  },

  opponent_chooses_yes_or_no: (e) => {
    const yes = e.acceptEffect ? renderEffect(e.acceptEffect) : "accept";
    const no = e.rejectEffect ? renderEffect(e.rejectEffect) : "decline";
    return `chosen opponent chooses: YES! ${yes}. NO! ${no}`;
  },

  // Timed variant of cant_be_challenged (Kanga Nurturing Mother "until your
  // next turn"). Same shape as the static form but with a duration.
  cant_be_challenged_timed: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    if (e.attackerFilter) {
      return `characters ${renderFilter(e.attackerFilter)} can't challenge ${tgt}${dur(e)}`;
    }
    return `${tgt} can't be challenged${dur(e)}`;
  },

  // "Put TARGET on the bottom of your deck" — `from` is the source zone
  // (hand / play / discard). Used by King Candy Sweet Abomination.
  put_card_on_bottom_of_deck: (e) => {
    const where = e.from === "play" ? renderTarget(e.target ?? {}) : `a card from your ${e.from ?? "hand"}`;
    return `put ${where} on the bottom of your deck`;
  },

  // "Mill N cards" — put top N of own deck into discard. Dale Mischievous
  // Ranger pattern.
  mill: (e) => `${maybe(e)}put the top ${e.amount ?? 1} card${plural(e.amount ?? 1)} of your deck into your discard`,

  // Mass inkwell exertion / readying. Mufasa Ruler of Pride Rock "exert all
  // cards in your inkwell". `mode` distinguishes the operation.
  mass_inkwell: (e) => {
    const tgt = renderTarget(e.target ?? { type: "self" });
    if (e.mode === "exert_all") return `exert all cards in ${tgt === "you" ? "your" : tgt + "'s"} inkwell`;
    if (e.mode === "ready_all") return `ready all cards in ${tgt === "you" ? "your" : tgt + "'s"} inkwell`;
    return `affect all cards in ${tgt === "you" ? "your" : tgt + "'s"} inkwell`;
  },

  // "Reveal target's hand" — Dolores Madrigal Within Earshot.
  reveal_hand: (e) => `reveal ${renderTarget(e.target ?? {}) === "you" ? "your" : "each opponent's"} hand`,

  // "Name a card, then reveal the top of your deck" — The Sorcerer's Hat.
  name_a_card_then_reveal: () => "name a card, then reveal the top card of your deck",

  // "Each opponent may discard a card. For each opponent who doesn't, [reward]."
  // Sign the Scroll, Ursula's Trickery.
  each_opponent_may_discard_then_reward: (e) => {
    const reward = e.rewardEffect ? renderEffect(e.rewardEffect) : "you gain a reward";
    return `each opponent may discard a card; for each opponent who doesn't, ${reward}`;
  },

  // Grants an activated ability to a filtered set of characters until end
  // of turn. Food Fight! pattern.
  grant_activated_ability_timed: (e) => {
    const filt = e.filter ? renderFilter(e.filter) : "characters";
    const inner = e.ability ? renderAbility(e.ability) : "[no-ability]";
    return `your ${filt} gain "${inner}" this turn`;
  },

  // Static "enters play exerted" — applies to a filtered set (e.g.
  // Sapphire Chromicon "items enter play exerted"). Self-applied form
  // is more commonly wired as a triggered enters_play → exert this.
  enter_play_exerted: (e) => {
    const filt = e.filter ? renderFilter(e.filter) : "characters";
    return `${filt} enter play exerted`;
  },

  // Self variant — Sleepy Nodding Off, Dale Friend in Need, Baymax Low Battery,
  // Bolt Down but Not Out. Card simply enters play exerted.
  enter_play_exerted_self: () => "this character enters play exerted",

  // "This character costs N less for each X you have" — Sherwood Forest
  // Outlaw Hideaway pattern. `amount: "all"` means "by 1 per match".
  move_to_self_cost_reduction: (e) => {
    const filt = e.filter ? renderFilter(e.filter) : "matching characters";
    return `this character costs 1 {I} less to play for each ${filt} you have`;
  },

  // CRD must-quest (Reckless-style restriction). Often timed.
  must_quest_if_able: (e) => `${renderTarget(e.target ?? {})} must quest if able${dur(e)}`,

  // "Draw cards until you have N in hand" — Prince John's Mirror.
  // `trimOnly: true` means it only fires when the target's hand is below N.
  fill_hand_to: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt === "you" ? "you draw" : tgt + " draws"} cards until ${tgt === "you" ? "you have" : "they have"} ${e.n ?? "?"} cards in hand`;
  },

  // "If the discarded card was X, do A; otherwise do B." Kakamora Pirate Chief.
  conditional_on_last_discarded: (e) => {
    const filt = e.filter ? renderFilter(e.filter) : "matching";
    const a = (e.then ?? []).map(renderEffect).join(" and ");
    const b = (e.otherwise ?? []).map(renderEffect).join(" and ");
    return `if the discarded card was a ${filt}, ${a}; otherwise ${b}`;
  },

  // "Put all cards under this character into your hand" — Alice Well-Read Whisper.
  put_cards_under_into_hand: (e) => `put all cards under ${renderTarget(e.target ?? { type: "this" })} into your hand`,
  move_cards_under_to_inkwell: () => `put cards from under your characters into your inkwell`,

  // ---- NEW: shapes added in the second pass --------------------------------

  // "This character can't sing songs" / "characters with cost N or less can't
  // challenge your characters" — self-restriction or filtered opponent
  // restriction. `restricts` is the verb; `filter` (when present) describes
  // WHO is restricted, not the target of the restriction.
  deck_rule: (e) => e.rule ?? "deck-building rule",
  prevent_damage_removal: () => "Damage counters can't be removed",
  damage_prevention_static: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    const src = e.source === "challenge" ? " from challenges" : e.source === "non_challenge" ? " except from challenges" : "";
    const charges = e.chargesPerTurn ? "the first time " + tgt + " would take damage, " + tgt + " takes no damage instead" : tgt + " can't be damaged" + src;
    return charges;
  },
  challenge_damage_prevention: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    return `${tgt} can't be damaged from challenges`;
  },
  all_hand_inkable: () => "All cards in your hand count as having {IW}",
  grant_triggered_ability: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} gain a triggered ability`;
  },
  global_move_cost_reduction: (e) => `you pay ${e.amount ?? 1} {I} less to move your characters to a location`,
  grant_keyword_while_being_challenged: (e) => {
    const tgt = renderTarget(e.target ?? {});
    const kw = e.keyword ?? "keyword";
    const v = e.value ? ` +${e.value}` : "";
    return `While being challenged, ${tgt} gain ${cap(kw)}${v}`;
  },
  remove_keyword: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} lose ${cap(e.keyword ?? "keyword")} and can't gain ${cap(e.keyword ?? "keyword")}`;
  },
  sing_cost_bonus_characters: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} count as having +${e.amount ?? 1} cost to sing songs`;
  },

  action_restriction: (e) => {
    const verb = e.restricts === "sing" ? "exert to sing songs"
      : e.restricts === "be_challenged" ? "be challenged"
      : e.restricts ?? "act";
    if (e.filter) {
      const who = renderFilter(e.filter);
      const targetSide = e.affectedPlayer?.type === "opponent" ? " your characters" : "";
      return `${who} can't ${verb}${targetSide}`;
    }
    // No filter — check affectedPlayer for "opposing characters can't X"
    if (e.affectedPlayer?.type === "opponent") return `opposing characters can't ${verb}`;
    if (e.affectedPlayer?.type === "both") return `characters can't ${verb}`;
    return `this character can't ${verb}`;
  },

  // "+1 {S}/{L} for each other Villain character you have in play"
  modify_stat_per_count: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    const stat = e.stat === "lore" ? "{L}" : e.stat === "willpower" ? "{W}" : "{S}";
    const per = e.perCount ?? 1;
    const cf = e.countFilter;
    let where = "you have in play";
    if (cf?.zone === "hand") where = "in your hand";
    else if (cf?.zone === "discard") where = "in your discard";
    else if (cf?.zone === "inkwell") where = "in your inkwell";
    const filt = cf ? renderFilter(cf) : "card";
    return `${tgt} ${verbS(tgt, "get", "gets")} +${per} ${stat} for each ${filt} ${where}`;
  },

  // cost_reduction: handled in main EFFECT_RENDERERS above (renders as "for the next X")

  // "Characters with cost N or less can't challenge this character"
  cant_be_challenged: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    if (e.attackerFilter) {
      const af = renderFilter(e.attackerFilter);
      // "Characters with cost 3 or less" — use filter as qualifier, drop generic "card" noun
      const qualifier = af.replace(/^card /, "").replace(/^cards /, "");
      return `Characters ${qualifier} can't challenge ${tgt}`;
    }
    return `${tgt} can't be challenged`;
  },

  // "Chosen X gets +2. If a Villain is chosen, they get +3 instead."
  conditional_on_target: (e) => {
    const tgt = renderTarget(e.target ?? {});
    const def = (e.defaultEffects ?? []).map(renderEffect).join(" and ");
    const cond = e.conditionFilter ? renderFilter(e.conditionFilter) : "matching";
    const alt = (e.ifMatchEffects ?? []).map(renderEffect).join(" and ");
    return `${tgt}: ${def}. If a ${cond} is chosen, ${alt} instead`;
  },

  // "This character takes no damage from the challenge" — optionally
  // gated by a filter on the opposing character (e.g. "a damaged character").
  challenge_damage_prevention: (e) => {
    if (e.targetFilter) {
      return `whenever this character challenges ${renderFilter(e.targetFilter)}, this character takes no damage from the challenge`;
    }
    return "this character takes no damage from the challenge";
  },

  // "While being challenged, the challenging character gets -1 {S}" — `affects`
  // is "attacker" or "self" depending on which side of the challenge gets the
  // modifier.
  gets_stat_while_being_challenged: (e) => {
    const stat = e.stat === "lore" ? "{L}" : e.stat === "willpower" ? "{W}" : "{S}";
    const who = e.affects === "attacker" ? "the challenging character" : "this character";
    return `while this character is being challenged, ${who} gets ${signed(e.amount ?? 0)} ${stat}`;
  },

  // "+1 {L} for each 1 damage on him"
  modify_stat_per_damage: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    const stat = e.stat === "lore" ? "{L}" : e.stat === "willpower" ? "{W}" : "{S}";
    const per = e.perDamage ?? 1;
    return `${tgt} ${verbS(tgt, "get", "gets")} +${per} ${stat} for each ${per} damage on this character`;
  },

  // 'Your X characters gain "{E} — Gain 1 lore"' — wraps another ability.
  grant_activated_ability: (e) => {
    const tgt = renderTarget(e.target ?? {});
    const inner = e.ability ? renderAbility(e.ability) : "[no-ability]";
    return `${tgt} ${verbS(tgt, "gain", "gains")} "${inner}"`;
  },

  // "Whenever one of your other characters would be dealt damage, put that
  // many damage counters on this character instead."
  damage_redirect: (e) => {
    const from = e.from ? renderTarget(e.from) : "another character";
    return `whenever ${from} would be dealt damage, put that damage on this character instead`;
  },

  // "This character can challenge ready characters."
  can_challenge_ready: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    return `${tgt} can challenge ready characters`;
  },

  // "Chosen character can challenge ready characters this turn."
  grant_challenge_ready: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} can challenge ready characters${dur(e)}`;
  },

  // "You may play any character with Shift on this character as if this
  // character had any name." — Morph / Zurg pattern. Self-only, no fields.
  mimicry_target_self: () =>
    "you may play any character with Shift on this character as if this character had any name",

  // Action cards installing a one-turn trigger ("Whenever ... this turn, ...")
  create_floating_trigger: (e) => {
    const head = renderTrigger(e.trigger ?? {});
    const body = (e.effects ?? []).map(renderEffect).join(", and ");
    return `${head} this turn, ${body}`;
  },

  // ---- Batch additions from decompiler review (30 missing renderers) --------

  conditional_on_player_state: (e) => {
    const cond = renderCondition(e.condition ?? {});
    const then = (e.thenEffects ?? []).map(renderEffect).join(" and ");
    const els = (e.elseEffects ?? []).map(renderEffect).join(" and ");
    if (els) return `${cond}, ${then}; otherwise ${els}`;
    return `${cond}, ${then}`;
  },
  opponent_may_pay_to_avoid: (e) => {
    const accept = renderEffect(e.acceptEffect ?? {});
    const reject = renderEffect(e.rejectEffect ?? {});
    return `${reject} unless opposing player ${accept}`;
  },
  player_may_play_from_hand: (e) => {
    const filt = e.filter ? renderFilter(e.filter) : "a card";
    return `each player may play ${filt} from their hand for free`;
  },
  prevent_discard_from_hand: () => "you can't discard cards from your hand",
  inkwell_enters_exerted: () => "cards added to inkwell enter exerted",
  move_all_matching_to_inkwell: (e) => {
    const filt = e.filter ? renderFilter(e.filter) : "cards";
    return `${maybe(e)}put all ${filt} into your inkwell`;
  },
  remember_chosen_target: (e) => `choose ${e.filter ? renderFilter(e.filter) : "a character"}`,
  restrict_play: (e) => `${e.affectedPlayer?.type === "opponent" ? "opponents" : "you"} can't play ${(e.cardTypes ?? []).join("/")}s`,
  return_all_to_bottom_in_order: (e) => `put all ${e.filter ? renderFilter(e.filter) : "characters"} on the bottom of their players' decks`,
  modify_win_threshold: (e) => `${e.affectedPlayer?.type === "opponent" ? "opponents" : "you"} need ${e.newThreshold ?? "?"} lore to win`,
  stat_floor_printed: (e) => `${renderTarget(e.target ?? {})} ${e.stat ?? "strength"} can't be reduced below printed value`,
  ink_from_discard: () => "you may put cards from your discard into your inkwell",
  restrict_remembered_target_action: (e) => `remembered target can't ${e.action ?? "act"}`,
  banish_item: (e) => `${maybe(e)}banish ${renderTarget(e.target ?? {})}`,
  sing_cost_bonus_here: (e) => `characters here count as having +${e.amount ?? 0} cost to sing songs`,
  choose_n_from_opponent_discard_to_bottom: (e) => `choose ${e.count ?? "?"} cards from opponent's discard and put them on the bottom of their deck`,
  gets_stat_while_challenging: (e) => `your characters get +${e.strength ?? 0} {S} while challenging ${e.defenderFilter ? renderFilter(e.defenderFilter) : "a character"}${dur(e)}`,
  grant_extra_ink_play: (e) => `you may play ${e.amount ?? 1} additional ink this turn`,
  put_self_under_target: (e) => `put this card under ${e.filter ? renderFilter(e.filter) : "a character"}`,
  sing_cost_bonus_target: (e) => `${renderTarget(e.target ?? {})} counts as having +${e.amount ?? 0} cost to sing songs${dur(e)}`,
  top_of_deck_visible: () => "the top card of your deck is played face up",
  skip_draw_step_self: () => "you skip your draw step",
  one_challenge_per_turn_global: () => "each player may only challenge once per turn",
  prevent_lore_loss: () => "you can't lose lore",
  forced_target_priority: () => "this character must be chosen as a target if able",
  remove_named_ability: () => "remove a named ability from matching characters",
  classification_shift_self: (e) => `this character gains Shift onto ${e.trait ?? "?"} characters`,
  universal_shift_self: () => "this character gains Universal Shift",
  grant_trait_static: (e) => `${renderTarget(e.target ?? {})} gains the ${e.trait ?? "?"} classification`,
  conditional_challenger_self: (e) => `while challenging ${e.defenderFilter ? renderFilter(e.defenderFilter) : "a character"}, this character gets +${e.strength ?? 0} {S}`,
  compound_and_static: (e) => `[compound static]`,
  scry: (e) => `look at the top ${e.count ?? 1} card${plural(e.count ?? 1)} of your deck`,
  extra_ink_play: (e) => `you may play ${e.amount ?? 1} additional ink this turn`,
};

function renderEffect(e: Json): string {
  if (!e || !e.type) return "[empty-effect]";
  const fn = EFFECT_RENDERERS[e.type];
  const body = fn ? fn(e) : `[unknown:${e.type}]`;
  // Effect-level condition: "If [condition], [effect]" (Marching Off to Battle,
  // Enigmatic Inkcaster, etc.). The condition wraps the effect so the renderer
  // doesn't drop the conditional gating.
  if (e.condition) {
    const cond = renderCondition(e.condition);
    const stripped = cond.startsWith("if ") || cond.startsWith("If ") ? cond.slice(3) : cond;
    return `if ${stripped}, ${body}`;
  }
  return body;
}

// -----------------------------------------------------------------------------
// Effect helpers (verb agreement + adverb prefixes).
// -----------------------------------------------------------------------------
function maybe(e: Json): string { return e.isMay ? "you may " : ""; }
function up(e: Json): string { return e.isUpTo ? "up to " : ""; }
function dur(e: Json): string { return e.duration ? " " + renderDuration(e.duration) : ""; }
function plural(n: number | string): string { return n === 1 ? "" : "s"; }

/** Render a DynamicAmount (number or object like {type:"count",filter} or string). */
function renderAmount(a: any): string {
  if (typeof a === "number") return String(a);
  if (typeof a === "string") {
    switch (a) {
      case "target_lore": return "their {L}";
      case "target_strength": return "their {S}";
      case "target_damage": return "the amount of damage on them";
      case "source_strength": return "this character's {S}";
      case "last_effect_result": return "each 1 lost this way";
      case "cost_result": return "each 1 affected this way";
      case "last_resolved_target_delta": return "each 1 removed this way";
      // Colors of the Wind: "for each different ink type of cards revealed this way"
      case "unique_ink_types_on_top_of_both_decks": return "each different ink type of cards revealed this way";
      // Namaari Resolute Daughter: "For each opposing character banished in a challenge this turn"
      case "opposing_chars_banished_in_challenge_this_turn": return "each opposing character banished in a challenge this turn";
      // Mulan Elite Archer / Namaari Heir of Fang: "equal to the damage just dealt"
      case "last_damage_dealt": return "the damage just dealt";
      case "last_resolved_source_strength": return "their {S}";
      case "last_resolved_target_lore": return "their {L}";
      case "last_resolved_target_strength": return "their {S}";
      case "song_singer_count": return "the number of characters that sang this song";
      case "triggering_card_lore": return "their {L}";
      case "triggering_card_damage": return "the damage on them";
      case "last_target_location_lore": return "the {L} of that location";
      default: return a;
    }
  }
  if (typeof a === "object" && a !== null) {
    if (a.type === "count") return `the number of ${a.filter ? pluralizeFilter(renderFilter(a.filter)) : "matching cards"}`;
    if (a.type === "target_lore") return "their {L}";
    if (a.type === "target_strength") return "their {S}";
    if (a.type === "target_damage") return "the amount of damage on them";
    if (a.type === "source_strength") return "this character's {S}";
    if (a.type === "last_effect_result") return "the number of cards affected";
    if (a.type === "last_resolved_target_delta") return "the amount removed";
    if (a.type === "cards_under_count") return "the number of cards under this character";
    return `[amount:${a.type}]`;
  }
  return "?";
}

/** Verb agreement: "you" and plural subjects take base form, singular takes -s.
 *  ("you gain" / "your characters gain" / "this character gains"). */
function verbS(target: string, base: string, third: string): string {
  if (target === "you") return base;
  // Plural subjects: "all your characters", "opposing characters", "characters named X"
  // But NOT "each opponent" (grammatically singular) or "this characters" (doesn't exist)
  if (target.startsWith("all ")) return base;
  if (target.startsWith("opposing ") && target.endsWith("s")) return base;
  if (target.startsWith("your ") && target.endsWith("s")) return base;
  return third;
}

function renderStatChange(e: Json): string {
  const tgt = renderTarget(e.target ?? {});
  const bits: string[] = [];
  // modify_stat uses stat + amount
  if (e.stat && e.amount !== undefined) {
    const sym = e.stat === "lore" ? "{L}" : e.stat === "willpower" ? "{W}" : "{S}";
    const val = e.amount;
    bits.push(`${signed(val)} ${sym}`);
  }
  // gain_stats uses individual stat fields
  if (e.strength !== undefined) bits.push(`${signed(e.strength)} {S}`);
  if (e.willpower !== undefined) bits.push(`${signed(e.willpower)} {W}`);
  if (e.lore !== undefined) bits.push(`${signed(e.lore)} {L}`);
  return `${tgt} ${verbS(tgt, "get", "gets")} ${bits.join(" and ")}${dur(e)}`;
}

// -----------------------------------------------------------------------------
// Triggered / activated / static wrappers — small dispatchers around the
// pattern tables above.
// -----------------------------------------------------------------------------
function renderTriggered(ab: Json): string {
  const head = renderTrigger(ab.trigger ?? {});
  const cond = ab.condition ? renderCondition(ab.condition) : "";
  // Filter empty renderings so chained effects (e.g. peek_and_set_target
  // → play_for_free with last_resolved_target) don't produce ". ." artifacts.
  const body = (ab.effects ?? []).map(renderEffect).filter(Boolean).join(", and ");
  if (cond.startsWith("during ")) return `${cap(cond)}, ${head}, ${body}`;
  if (cond) return `${head}, ${cond}, ${body}`;
  return `${head}, ${body}`;
}

function renderActivated(ab: Json, ctx?: { cardType?: string }): string {
  const costs = (ab.costs ?? []).map((c: Json) => renderCost(c, ctx)).join(", ");
  const cond = ab.condition ? renderCondition(ab.condition) : "";
  const effects = (ab.effects ?? []).map(renderEffect).filter(Boolean).join(", and ");
  if (cond) return `${costs} — ${cap(cond)}, ${effects}`;
  return `${costs} — ${effects}`;
}

function renderStatic(ab: Json): string {
  let cond = ab.condition ? renderCondition(ab.condition) : "";
  // Statics use "While" not "If" for ongoing conditions
  if (cond.startsWith("if ") || cond.startsWith("If ")) {
    cond = "While " + cond.slice(3);
  }
  // ab.effect can be a single effect object OR an array of effects
  // (compound static — Hidden Cove "+1 S and +1 W while here", Judy Hopps
  // Lead Detective "Alert + Resist +2", etc.). Render each and join.
  const eff = ab.effect;
  let body: string;
  if (Array.isArray(eff)) {
    body = eff.map(renderEffect).filter((s) => s && !s.startsWith("[empty")).join(" and ");
  } else {
    body = renderEffect(eff ?? {});
  }
  if (cond) return `${cap(cond)}, ${body}`;
  return body;
}

function renderDuration(d: string): string {
  switch (d) {
    case "this_turn":
    case "end_of_turn":
    case "rest_of_turn":
      return "this turn";
    case "until_caster_next_turn":
      return "until the start of your next turn";
    case "end_of_owner_next_turn":
      return "during their next turn";
    case "permanent":
      return "";
    default:
      return `[dur:${d}]`;
  }
}

// -----------------------------------------------------------------------------
// Targets and filters.
// -----------------------------------------------------------------------------
function renderTarget(t: Json): string {
  if (!t || !t.type) return "[no-target]";
  switch (t.type) {
    case "self":
      return "you";
    case "opponent":
      return "each opponent";
    case "both":
      return "each player";
    case "this":
      return "this character";
    case "triggering_card":
      return "the triggering character";
    case "last_resolved_target":
      return "that character";
    case "from_last_discarded":
      return "that discarded card";
    case "chosen": {
      const f = t.filter ? renderFilter(t.filter, { suppressOwnerSelf: true }) : "character";
      const count = t.count && t.count > 1 ? `${t.count} ` : "";
      // "Each opponent chooses" pattern: chooser=target_player with owner=opponent.
      // Used by Swooping Strike, Triton's Decree, Lady Tremaine ("each opponent
      // chooses and Xs one of their characters"). Render as a noun phrase the
      // surrounding effect verb can attach to via "each opponent's chosen X".
      if (t.chooser === "target_player" && t.filter?.owner?.type === "opponent") {
        return `each opponent's chosen ${f}`;
      }
      // Same with self owner — "their" is correct.
      if (t.chooser === "target_player") {
        return `one of their ${pluralizeFilter(f)}`;
      }
      return `chosen ${count}${f}`;
    }
    case "all": {
      const f = t.filter ? pluralizeFilter(renderFilter(t.filter)) : "characters";
      return `all ${f}`;
    }
    case "random": {
      const f = t.filter ? renderFilter(t.filter) : "character";
      return `a random ${f}`;
    }
    default:
      return `[target:${t.type}]`;
  }
}

function renderFilter(f: Json, opts?: { suppressOwnerSelf?: boolean }): string {
  const bits: string[] = [];
  // Owner — suppress "your" for chosen targets (oracle says "chosen character" not "chosen your character")
  if (f.owner?.type === "self" && !opts?.suppressOwnerSelf) bits.push("your");
  else if (f.owner?.type === "opponent") bits.push("opposing");
  if (f.excludeSelf) bits.push("other");
  // Stats / cost / keyword adjectives go BEFORE the noun
  if (f.isExerted) bits.push("exerted");
  if (f.hasKeyword) bits.push(`${cap(f.hasKeyword)}`);
  if (f.hasTrait) bits.push(f.hasTrait);
  if (f.hasAnyTrait?.length) bits.push(f.hasAnyTrait.join(" or "));
  // Noun
  let noun = "card";
  const rawTypes = f.cardType;
  const types: string[] = Array.isArray(rawTypes) ? rawTypes : rawTypes ? [rawTypes] : [];
  if (types.length === 1) noun = types[0]!;
  else if (types.length > 1) noun = types.join("/");
  // No cardType filter → generic "card"
  // Song actions should render as "song" not "Song action"
  if (f.hasTrait === "Song" && noun === "action") noun = "song";
  // Pluralize for "all"-ish contexts isn't tracked here; rely on caller.
  bits.push(noun);
  // Trailing qualifiers
  if (f.hasName) bits.push(`named ${f.hasName}`);
  if (f.costAtMost !== undefined || f.maxCost !== undefined) {
    bits.push(`with cost ${f.costAtMost ?? f.maxCost} or less`);
  }
  if (f.costAtLeast !== undefined || f.minCost !== undefined) {
    bits.push(`with cost ${f.costAtLeast ?? f.minCost} or more`);
  }
  if (f.strengthAtMost !== undefined) bits.push(`with ${f.strengthAtMost} {S} or less`);
  if (f.strengthAtLeast !== undefined) bits.push(`with ${f.strengthAtLeast} {S} or more`);
  if (f.hasDamage) bits.push("with damage");
  if (f.hasCardUnder) bits.push("with a card under them");
  if (f.challengedThisTurn) bits.push("that challenged this turn");
  if (f.inkable) bits.push("with {IW}");
  // Zone qualifier (for "card from your hand/discard")
  const zone = Array.isArray(f.zone) ? f.zone[0] : f.zone;
  if (zone && zone !== "play") bits.push(`from your ${zone}`);
  // atLocation
  if (f.atLocation === "this") bits.push("here");
  return bits.join(" ");
}

/** Pluralize the noun in a rendered filter string. "character" → "characters", etc. */
function pluralizeFilter(f: string): string {
  return f
    .replace(/\bcharacter\b(?!s)/, "characters")
    .replace(/\bitem\b(?!s)/, "items")
    .replace(/\blocation\b(?!s)/, "locations")
    .replace(/\baction\b(?!s)/, "actions")
    .replace(/\bsong\b(?!s)/, "songs")
    .replace(/\bcard\b(?!s)/, "cards");
}

// =============================================================================
// NORMALIZATION + SCORING
// =============================================================================

const SYNONYMS: Array<[RegExp, string]> = [
  [/\{e\}/g, "exert"],
  [/\{i\}/g, "ink"],
  [/\{s\}/g, "strength"],
  [/\{w\}/g, "willpower"],
  [/\{l\}/g, "lore"],
  [/\bchosen\b/g, "target"],
  [/\bgains?\b/g, "gets"],
  [/\bopposing\b/g, "opponents"],
  [/\beach opponent\b/g, "opponent"],
  [/\bcards?\b/g, "card"],
  [/\bcharacters?\b/g, "character"],
  [/\bsongs?\b/g, "song"],
  [/\bitems?\b/g, "item"],
  [/\blocations?\b/g, "location"],
  [/\bturns?\b/g, "turn"],
  [/\b(an?|the|of|to|from|into|in|on|at|for|with|that|their|its|his|her|player's|player)\b/g, " "],
];

function normalize(s: string): string {
  let out = s.toLowerCase();
  // Strip parenthetical reminder text (keyword reminders, sing-cost reminders)
  // — but ONLY if there's substantive content outside the parens. Cards whose
  // entire oracle text IS a parenthetical (Flotsam & Jetsam Entangling Eels:
  // "(This character counts as being named both Flotsam and Jetsam.)") would
  // otherwise normalize to empty string and force-fail the similarity score.
  const stripped = out.replace(/\([^)]*\)/g, " ").trim();
  if (stripped.length > 0) out = out.replace(/\([^)]*\)/g, " ");
  else out = out.replace(/[()]/g, " ");
  // Strip story-name leading caps (rare in rulesText).
  for (const [re, repl] of SYNONYMS) out = out.replace(re, repl);
  // Strip punctuation.
  out = out.replace(/[.,;:!?\-—'"`]/g, " ");
  // Collapse whitespace.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t.length > 1);
}

/** Token F1 — symmetric, handles word reordering, ignores frequency.
 *  Returns 1.0 for a perfect set match, 0.0 for disjoint vocabularies. */
function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const p = inter / A.size;
  const r = inter / B.size;
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

// =============================================================================
// MAIN
// =============================================================================

interface Row {
  setId: string;
  number: number;
  fullName: string;
  id: string;
  cardType: string;
  oracle: string;
  rendered: string;
  score: number;
}

function loadCards(setFilter?: string): CardJSON[] {
  // Dedupe by id, preferring reprints with more implemented abilities — same
  // policy as packages/engine/src/cards/lorcastCards.ts:28-51. Without this,
  // a card reprinted across 5 set files appears 5 times in the report.
  const byId = new Map<string, CardJSON>();
  const files = readdirSync(CARDS_DIR)
    .filter((f) => f.startsWith("lorcast-set-") && f.endsWith(".json"));
  for (const f of files) {
    if (setFilter && !f.includes(setFilter)) continue;
    const cards = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8")) as CardJSON[];
    for (const c of cards) {
      const existing = byId.get(c.id);
      if (!existing) { byId.set(c.id, c); continue; }
      const score = (x: CardJSON) =>
        (x.abilities?.length ?? 0) + (x.actionEffects?.length ?? 0);
      if (score(c) > score(existing)) byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function main() {
  const setFilter = arg("set");
  const cardFilter = arg("card")?.toLowerCase();
  const top = parseInt(arg("top") ?? "50", 10);
  const minScore = parseFloat(arg("min") ?? "1.01"); // default: include all
  const showAll = flag("all");
  const isJson = flag("json");
  const htmlPath = arg("html");

  const cards = loadCards(setFilter);
  const rows: Row[] = [];

  for (const card of cards) {
    if (cardFilter && !card.fullName.toLowerCase().includes(cardFilter)) continue;
    // Vanillas have no rules text — skip; nothing to compare.
    const oracle = (card.rulesText ?? "").trim();
    const hasAbilities =
      (card.abilities && card.abilities.length > 0) ||
      (card.actionEffects && card.actionEffects.length > 0) ||
      card.shiftCost !== undefined ||
      card.singTogetherCost !== undefined;
    if (!oracle && !hasAbilities) continue;
    // If oracle is empty, the comparison is meaningless — Lorcast omits
    // reminder text for vanilla-keyword cards. Skip rather than score 0.0.
    if (!oracle) continue;

    const rendered = renderCard(card);
    // Skip keyword-only cards (Vanish, Alert) whose rendered output is empty
    // because we skip keyword abilities. The oracle IS the keyword reminder text
    // but there's nothing to compare against — scoring 0.0 is misleading.
    if (!rendered.replace(/\./g, "").trim() && card.abilities?.every((a: any) => a.type === "keyword")) continue;
    const score = similarity(oracle, rendered);
    rows.push({
      setId: card.setId,
      number: card.number,
      fullName: card.fullName,
      id: card.id,
      cardType: card.cardType,
      oracle,
      rendered,
      score,
    });
  }

  rows.sort((a, b) => a.score - b.score);

  const filtered = showAll ? rows : rows.filter((r) => r.score < minScore).slice(0, top);

  if (isJson) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (htmlPath) {
    writeHtml(htmlPath, filtered, rows);
    console.log(`Wrote HTML report: ${htmlPath} (${filtered.length} rows)`);
    return;
  }

  // Text report.
  const total = rows.length;
  const avg = total ? rows.reduce((s, r) => s + r.score, 0) / total : 0;
  const buckets = { lt30: 0, lt50: 0, lt70: 0, lt90: 0, ge90: 0 };
  for (const r of rows) {
    if (r.score < 0.3) buckets.lt30++;
    else if (r.score < 0.5) buckets.lt50++;
    else if (r.score < 0.7) buckets.lt70++;
    else if (r.score < 0.9) buckets.lt90++;
    else buckets.ge90++;
  }
  console.log(`Decompiler diff — ${total} cards scored (avg similarity ${avg.toFixed(2)})`);
  console.log(`  <0.3: ${buckets.lt30}   <0.5: ${buckets.lt50}   <0.7: ${buckets.lt70}   <0.9: ${buckets.lt90}   ≥0.9: ${buckets.ge90}\n`);
  console.log(`Worst ${filtered.length} match${filtered.length === 1 ? "" : "es"}:\n`);
  for (const r of filtered) {
    const tag = `[${r.score.toFixed(2)}] set-${r.setId.padStart(3, "0")}/${r.number}  ${r.fullName}`;
    console.log(tag);
    console.log(`  oracle:   ${oneLine(r.oracle)}`);
    console.log(`  rendered: ${oneLine(r.rendered)}`);
    console.log();
  }
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function writeHtml(path: string, filtered: Row[], all: Row[]) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const total = all.length;
  const avg = total ? all.reduce((s, r) => s + r.score, 0) / total : 0;
  const rowsHtml = filtered
    .map((r) => {
      const color = r.score < 0.3 ? "#fdd" : r.score < 0.5 ? "#fed" : r.score < 0.7 ? "#ffd" : r.score < 0.9 ? "#efe" : "#dfd";
      return `<tr style="background:${color}">
  <td>${r.score.toFixed(2)}</td>
  <td><b>${esc(r.fullName)}</b><br><small>set ${esc(r.setId)} #${r.number}</small></td>
  <td>${esc(r.oracle)}</td>
  <td>${esc(r.rendered)}</td>
</tr>`;
    })
    .join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>Decompiler diff</title>
<style>
  body{font:13px/1.4 -apple-system,sans-serif;margin:1em}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:6px;vertical-align:top}
  th{background:#eee;text-align:left}
  td:nth-child(1){font-family:monospace;width:50px;text-align:center}
  td:nth-child(2){width:160px}
  td:nth-child(3),td:nth-child(4){width:40%}
  small{color:#666}
</style>
<h1>Card decompiler vs. oracle text</h1>
<p>${total} cards scored, average similarity ${avg.toFixed(2)}. Showing ${filtered.length} worst matches.</p>
<table>
<thead><tr><th>Score</th><th>Card</th><th>Oracle (Lorcast)</th><th>Rendered (decompiler)</th></tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>`;
  writeFileSync(path, html);
}

// =============================================================================
// utils
// =============================================================================
function cap(s: string): string {
  if (!s) return "";
  return s[0]!.toUpperCase() + s.slice(1);
}
function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

main();
