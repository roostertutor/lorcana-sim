#!/usr/bin/env node
// =============================================================================
// CARD DECOMPILER + ORACLE-TEXT DIFF
// -----------------------------------------------------------------------------
// Walks every card in packages/engine/src/cards/card-set-*.json, renders
// its ability JSON back into English using a deterministic .toString()-style
// pass, normalizes both sides, and scores similarity against the printed
// `rulesText` (oracle text from Ravensburger). Sorts by worst match so a human reviewer
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
      // Set 3 uniquely uses "play this song for free" wording in oracle —
      // 11 of 12 song reminders in set 3 use "play"; all other sets use
      // "sing". Set-detect the wording so the reminder line matches.
      const verb = card.setId === "3" ? "play" : "sing";
      parts.push(`(A character with cost ${card.cost} or more can {E} to ${verb} this song for free.)`);
    }
  }

  // Card-level Shift reminder. The renderKeywordWithReminder for "shift" is
  // skipped (the bare keyword ability doesn't know the card's name), so we
  // emit the full reminder here using card.shiftCost / altShiftCost + the
  // card's name(s). Without this, vanilla shift cards (Li Shang Valiant
  // Leader, Flotsam & Jetsam Entangling Eels) score 0 — empty rendered text.
  if (card.cardType === "character") {
    // Determine shift reminder format. altShiftCost (discard-based) takes
    // precedence over numeric shiftCost when both are set.
    const altShift = (card as any).altShiftCost;
    const shiftNames = card.alternateNames && card.alternateNames.length > 0
      ? card.alternateNames.join(" or ")
      : card.name;
    if (altShift) {
      // Read the discard filter to determine card-type wording. Olaf Carrot
      // Enthusiast filter:{cardType:["item"]} → "an item card". Diablo
      // Devoted Herald filter:{cardType:["action"]} → "an action card".
      // Default to "card" for unfiltered discards.
      let cardWord = "card";
      const f = altShift.filter;
      if (f) {
        const types = Array.isArray(f.cardType) ? f.cardType : f.cardType ? [f.cardType] : [];
        if (types.length === 1) cardWord = `${types[0]} card`;
        if (f.hasTrait === "Song" && types[0] === "action") cardWord = "song card";
      }
      const article = altShift.amount === 1
        ? (/^[aeiou]/i.test(cardWord) ? "an" : "a")
        : altShift.amount;
      const plural = altShift.amount === 1 ? cardWord : `${cardWord}s`;
      const headPhrase = altShift.type === "discard"
        ? `Discard ${article} ${plural}`
        : altShift.type;
      const costPhrase = altShift.type === "discard"
        ? `discard ${article} ${plural}`
        : altShift.type;
      parts.push(`Shift: ${headPhrase} (You may ${costPhrase} to play this on top of one of your characters named ${shiftNames}.)`);
    } else if (card.shiftCost !== undefined) {
      // Lorcana shift print convention split: sets 1-7 print "<Shift> N"
      // without trailing {I}, sets 8+ print "<Shift> N {I}". Match the
      // card's set so vanilla-shift cards score correctly in both
      // conventions (Li Shang set 11 has {I}, Basil set 2 doesn't).
      const setNum = parseInt(card.setId ?? "1", 10);
      const headInk = setNum >= 8 ? " {I}" : "";
      parts.push(`Shift ${card.shiftCost}${headInk} (You may pay ${card.shiftCost} {I} to play this on top of one of your characters named ${shiftNames}.)`);
    }
  }

  // Dual-name characters: Flotsam & Jetsam, Turbo - Royal Hack. The card
  // "counts as being named X" for Shift / name-matching purposes. Oracle
  // prints this clause two ways depending on the card:
  //   - Parenthetical reminder text (Flotsam & Jetsam Entangling Eels:
  //     "(This character counts as being named both Flotsam and Jetsam.)")
  //   - Bare named-ability body (Turbo - Royal Hack GAME JUMP: "This
  //     character also counts as being named King Candy for <Shift>.")
  // Detect by scanning rulesText for a paren-wrapped occurrence of the
  // clause; mirror the oracle structure so normalize()'s paren-stripping
  // treats both sides equally (otherwise dual-name tokens get stripped
  // from oracle but kept in rendered, or vice versa).
  if (card.alternateNames && card.alternateNames.length > 0) {
    const names = card.alternateNames.join(" and ");
    const both = card.alternateNames.length === 2 ? "both " : "";
    const paren = /\([^)]*counts as being named[^)]*\)/i.test(card.rulesText ?? "");
    if (paren) {
      parts.push(`(This character counts as being named ${both}${names}.)`);
    } else {
      // Turbo-style: the "also ... for <Shift>" body is part of a named
      // ability (GAME JUMP). Render bare so tokens survive normalize.
      parts.push(`This character also counts as being named ${names} for Shift`);
    }
  }

  // Play restrictions ("you can't play this character unless ...") are
  // CardDefinition-level, not ability-level. Conditions render with an "if "
  // prefix; we strip it and prepend "unless " for the natural reading.
  for (const restriction of card.playRestrictions ?? []) {
    parts.push(`You can't play this character unless ${stripIfPrefix(renderCondition(restriction))}`);
  }

  // Helper: capitalize the first letter of a rendered ability so it reads
  // as a sentence ("This character can't challenge." not "this character
  // can't challenge."). Per-ability renderers stay lowercase-prefixed to
  // simplify mid-sentence composition (`...{E} — ${effect}`); sentence-
  // capitalization is the renderCard-level concern.
  const sentenceCap = (s: string): string => {
    if (!s) return s;
    // Don't disturb lines that already start uppercase (TRIGGER_RENDERERS
    // emit "When you play..." / "Whenever this character..."; activated
    // costs emit "{E} — ..." which starts with a glyph). Only capitalize
    // when the first alphabetic character is lowercase.
    const m = s.match(/^([^A-Za-z]*)([a-z])(.*)$/);
    return m ? m[1] + m[2]!.toUpperCase() + m[3] : s;
  };
  for (const ab of card.abilities ?? []) {
    // Keyword abilities render as "<Keyword> (reminder)" since the oracle
    // rulesText DOES include the keyword + its reminder text. Without this,
    // cards like Hera Queen of the Gods (inherent <Ward> + named statics)
    // and Aladdin Barreling Through (<Boost> + <Reckless> + ONLY THE BOLD)
    // score 0.55-0.60 because half their oracle text is missing from rendered.
    //
    // Skip shift / sing_together keywords — those are rendered earlier from
    // card-level fields (shiftCost, singTogetherCost) which carry the actual
    // target-name and cost info; the bare keyword ability is duplicate.
    if (ab.type === "keyword") {
      const kw = (ab.keyword ?? "").toLowerCase();
      if (kw === "shift" || kw === "sing_together") continue;
      parts.push(renderKeywordWithReminder(ab));
      continue;
    }
    parts.push(sentenceCap(renderAbility(ab, { cardType: card.cardType })));
  }
  // Action / song bodies live on actionEffects. Each effect renders as its
  // own sentence by default (period-joined) which matches oracle wording
  // for most multi-step action cards ("Banish chosen character. Gain 2
  // lore."). For sequenced patterns where oracle uses ", then" to connect
  // (Dangerous Plan, We Don't Talk About Bruno: "Return X, then that
  // player discards a card at random"), we'd need joinEffects but it
  // breaks the more-common period form, so leave as-is and accept the
  // ~6 affected cards score in the 0.65-0.75 band.
  for (const eff of card.actionEffects ?? []) {
    parts.push(sentenceCap(renderEffect(eff)));
  }

  return parts.filter(Boolean).join(". ") + (parts.length ? "." : "");
}

/** Render a keyword ability with its reminder text — matches Lorcana oracle
 *  rulesText format "<Keyword> (reminder text.)" or "<Keyword +N> (reminder.)".
 *  Mirrors the printed reminder text so decompile-score reflects the full
 *  oracle text content, not just the keyword name. */
function renderKeywordWithReminder(ab: Json): string {
  const kw = (ab.keyword ?? "").toLowerCase();
  const v = ab.value;
  const valueDisplay = v !== undefined ? ` +${v}` : "";
  const head = kw === "shift" || kw === "singer" || kw === "sing together" || kw === "boost"
    ? `${cap(kw)} ${v ?? ""}`.trim()
    : `${cap(kw)}${valueDisplay}`;
  // Reminder-text dictionary keyed by lowercase keyword.
  const reminders: Record<string, string | ((v?: number) => string)> = {
    ward: "Opponents can't choose this character except to challenge.",
    evasive: "Only characters with Evasive can challenge this character.",
    rush: "This character can challenge the turn they're played.",
    bodyguard: "This character may enter play exerted. An opposing character who challenges one of your characters must choose one with Bodyguard if able.",
    reckless: "This character can't quest and must challenge each turn if able.",
    support: "Whenever this character quests, you may add their {S} to another chosen character's {S} this turn.",
    vanish: "When an opponent chooses this character for an action, banish them.",
    alert: "This character can challenge ready characters.",
    resist: (n) => `Damage dealt to this character is reduced by ${n ?? 1}.`,
    challenger: (n) => `While challenging, this character gets +${n ?? 1} {S}.`,
    singer: (n) => `This character counts as cost ${n ?? 1} to sing songs.`,
    shift: (n) => `You may pay ${n ?? 0} {I} to play this on top of one of your characters with the same name.`,
    boost: (n) => `Once during your turn, you may pay ${n ?? 0} {I} to put the top card of your deck facedown under this character.`,
    "sing together": (n) => `Any number of your or your teammates' characters with total cost ${n ?? 0} or more may {E} to sing this song for free.`,
  };
  const r = reminders[kw];
  const reminder = typeof r === "function" ? r(v) : r;
  return reminder ? `${head} (${reminder})` : head;
}

function renderAbility(ab: Json, ctx?: { cardType?: string }): string {
  switch (ab.type) {
    case "keyword":
      return ab.value !== undefined ? `${cap(ab.keyword)} +${ab.value}` : cap(ab.keyword);
    case "triggered":
      return renderTriggered(ab, ctx);
    case "activated":
      return renderActivated(ab, ctx);
    case "static":
      return renderStatic(ab, ctx);
    case "replacement":
      return `[replacement] ${renderEffect(ab.effect ?? {})}`;
    default:
      return `[unknown-ability:${ab.type ?? "?"}]`;
  }
}

// =============================================================================
// PATTERN TABLES
// -----------------------------------------------------------------------------
// Modeled after the audit-card-data.ts pattern tables (FLAG_KEYWORDS /
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
  is_banished:                   (t) => {
    if (!t.filter) return "When this character is banished";
    // isSelf:true scopes the trigger to the carrying character only — Rex
    // Protective Dinosaur RUN AWAY! "when THIS character is banished".
    if (t.filter.isSelf) return "When this character is banished";
    // "one of your OTHER characters is banished" — excludeSelf means the
    // ability carrier is excluded. Drop excludeSelf from renderFilter so
    // we don't double-count "other".
    if (t.filter.excludeSelf && t.filter.owner?.type === "self") {
      const { excludeSelf, ...rest } = t.filter;
      return `Whenever one of your other ${renderFilter(rest)} is banished`;
    }
    return `Whenever one of your ${renderFilter(t.filter)} is banished`;
  },
  banished_in_challenge:         (t) => {
    if (t.filter?.owner?.type === "self") return "Whenever one of your other characters is banished in a challenge";
    if (t.filter?.excludeSelf) return "Whenever another character is banished in a challenge";
    // Ursula's Lair Eye of the Storm SLIPPERY HALLS: location-scoped filter
    // (atLocation: "this") → "Whenever a character is challenged and
    // banished while here" (Kuzco's Palace CITY WALLS, Ursula's Lair).
    if (t.filter?.atLocation === "this") return "Whenever a character is challenged and banished while here";
    // Self-banish-in-challenge: oracle wording is split — older sets use
    // "When this character is challenged and banished" (Cheshire Cat Not
    // All There, Helga Sinclair Vengeful Partner) while newer sets use
    // "When this character is banished in a challenge" (Merlin Completing
    // His Research LEGACY OF LEARNING). Default to the older majority
    // form; the rare newer phrasing scores ~0.06 lower in tradeoff.
    return "When this character is challenged and banished";
  },
  banished_other_in_challenge:   (t) => t.filter ? `Whenever this character banishes ${renderFilter(t.filter)} in a challenge` : "Whenever this character banishes another character in a challenge",
  banishes_in_challenge:         ()  => "Whenever this character banishes another character in a challenge",
  // Legacy spelling alias.
  banished_other:                ()  => "Whenever this character banishes another character in a challenge",
  is_challenged:                 (t) => {
    // Pizza Planet HEAVILY GUARDED: location-scoped is_challenged →
    // "Whenever a character is challenged while here".
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      if (!filt || filt === "card" || filt === "cards") return "Whenever a character is challenged while here";
      return `Whenever a ${filt} is challenged while here`;
    }
    // Tiana Restaurant Owner SPECIAL RESERVATION: filter:{owner:self} →
    // "Whenever a character of yours is challenged" / "one of your
    // characters". Required so the trigger fires on any of the controller's
    // characters, not just on the source.
    if (t.filter?.owner?.type === "self") {
      return "Whenever a character of yours is challenged";
    }
    return "Whenever this character is challenged";
  },
  // Legacy spelling alias.
  challenged:                    (t) => {
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      if (!filt || filt === "card" || filt === "cards") return "Whenever a character is challenged while here";
      return `Whenever a ${filt} is challenged while here`;
    }
    return "Whenever this character is challenged";
  },
  challenges:                    (t) => {
    // anyOf with two hasName entries — "this character or one of your
    // characters named X" idiom (Minnie Mouse Dazzling Dancer DANCE-OFF
    // anyOf:[{hasName:"Minnie Mouse"},{hasName:"Mickey Mouse"}]). Pick
    // the OTHER name (not the source's). Heuristic: the second name in
    // the anyOf array is typically the cross-reference partner.
    if (Array.isArray(t.filter?.anyOf) && t.filter.anyOf.length === 2 && t.filter.owner?.type === "self") {
      const names = t.filter.anyOf.map((sub: Json) => sub.hasName).filter(Boolean);
      if (names.length === 2) {
        // Heuristic: second name is the partner. We don't know the source
        // card's name from here, so just render with the second name —
        // works for current canonical pattern (Minnie+Mickey).
        return `Whenever this character or one of your characters named ${names[1]} challenges another character`;
      }
    }
    if (filterMentionsYour(t.filter)) return "Whenever one of your characters challenges another character";
    // Snuggly Duckling ROUTINE RUCKUS: location-scoped filter with
    // strength cap → "Whenever a character with 3 {S} or more challenges
    // another character while here".
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      return `Whenever a ${filt} challenges another character while here`;
    }
    return "Whenever this character challenges another character";
  },
  // Legacy spelling alias for `challenges`.
  challenge_initiated:           (t) => filterMentionsYour(t.filter)
                                          ? "Whenever one of your characters challenges another character"
                                          : "Whenever this character challenges another character",
  quests:                        (t) => {
    if (filterMentionsYour(t.filter)) return "Whenever one of your characters quests";
    // Skull Rock SAFE HAVEN, Pride Lands cards, etc.: location-scoped quests →
    // "Whenever a character quests while here".
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      if (!filt || filt === "card" || filt === "cards") return "Whenever a character quests while here";
      return `Whenever a ${filt} quests while here`;
    }
    return "Whenever this character quests";
  },
  sings:                         (t) => filterMentionsYour(t.filter)
                                          ? "Whenever one of your characters sings a song"
                                          : "Whenever this character sings a song",
  turn_start:                    (t) => t.player?.type === "opponent"
                                          ? "At the start of an opponent's turn"
                                          : "At the start of your turn",
  turn_end:                      (t) => t.player?.type === "opponent"
                                          ? "At the end of an opponent's turn"
                                          : "At the end of your turn",
  card_drawn:                    (t) => t.player?.type === "opponent"
                                          ? "Whenever an opponent draws a card"
                                          : "Whenever you draw a card",
  card_played: (t) => {
    // Grammar helper: "a action" → "an action".
    const aOr = (s: string) => /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
    if (!t.filter) return "Whenever you play a card";
    // No owner filter = ANY player ("whenever another character is played")
    const hasOwnerFilter = t.filter.owner?.type;
    if (!hasOwnerFilter && t.filter.excludeSelf) {
      // "Whenever another X is played" — drop the redundant "other" from the
      // filter render since "another" already implies it.
      const { excludeSelf, ...rest } = t.filter;
      return `Whenever another ${renderFilter(rest)} is played`;
    }
    const filt = renderFilter(t.filter);
    if (!hasOwnerFilter) return `Whenever ${filt} is played`;
    // owner:self → "Whenever you play a character" (suppress the "your"
    // prefix since "you play" already implies ownership). Chem Purse
    // HERE'S THE BEST PART oracle: "Whenever you play a character, ...".
    if (t.filter.owner?.type === "self") {
      const filtNoOwner = renderFilter(t.filter, { suppressOwnerSelf: true });
      return `Whenever you play ${aOr(filtNoOwner)}`;
    }
    // owner:opponent → "Whenever an opponent plays a character"
    // (Prince John Fraidy-Cat HELP! HELP!). The "opposing" prefix that
    // renderFilter emits for owner:opponent reads oddly with "play".
    if (t.filter.owner?.type === "opponent") {
      const { owner: _o, ...rest } = t.filter;
      const filtNoOwner = renderFilter(rest);
      return `Whenever an opponent plays ${aOr(filtNoOwner)}`;
    }
    return `Whenever you play ${filt}`;
  },
  // item_played: DELETED — collapsed to card_played with cardType filter
  card_put_into_inkwell:                    ()  => "Whenever you put a card into your inkwell",
  moves_to_location:             (t) => {
    // Ring of Stones PART THE VEIL: location-scoped → "Whenever a character
    // moves here". Filter says "the moving character ends up at THIS source
    // location"; render that as "here".
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      if (!filt || filt === "card" || filt === "cards") return "Whenever a character moves here";
      return `Whenever a ${filt} moves here`;
    }
    return "Whenever this character moves to a location";
  },
  damage_dealt_to:               (t) => {
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      if (!filt || filt === "card" || filt === "cards") return "Whenever damage is dealt to a character while here";
      return `Whenever damage is dealt to a ${filt} while here`;
    }
    return "Whenever damage is dealt to this character";
  },
  damage_removed_from:           (t) => t.filter?.owner?.type === "self" ? "Whenever you remove 1 or more damage from one of your characters" : "Whenever damage is removed from this character",
  readied:                       (t) => {
    if (t.filter?.atLocation === "this") {
      const { atLocation, ...rest } = t.filter;
      const filt = renderFilter(rest);
      if (!filt || filt === "card" || filt === "cards") return "Whenever a character is readied while here";
      return `Whenever a ${filt} is readied while here`;
    }
    // Lorcana oracle uses active voice "Whenever you ready this character"
    // (Wreck-It Ralph Demolition Dude REFRESHING BREAK) rather than passive
    // "is readied". Active voice is the printed convention for self-targeted
    // ready triggers; passive only appears in unfiltered third-party shapes.
    return "Whenever you ready this character";
  },
  returned_to_hand:              (t) => {
    if (!t.filter) return "Whenever this character is returned to your hand";
    // Maleficent's Staff BACK, FOOLS!: "Whenever one of your opponents'
    // characters, items, or locations is returned to their hand from play".
    if (t.filter.owner?.type === "opponent") {
      return `Whenever one of your opponents' ${pluralizeFilter(renderFilter({ ...t.filter, owner: undefined }))} is returned to their hand from play`;
    }
    return `Whenever one of your ${pluralizeFilter(renderFilter(t.filter))} is returned to your hand`;
  },
  cards_discarded:               (t) => {
    // Prince John I SENTENCE YOU: "Whenever your opponent discards 1 or
    // more cards" — trigger has player:opponent.
    if (t.player?.type === "opponent") return "Whenever your opponent discards 1 or more cards";
    if (t.player?.type === "self") return "Whenever you discard 1 or more cards";
    return "Whenever a card is discarded";
  },
  deals_damage_in_challenge:     ()  => "Whenever this character deals damage in a challenge",
  card_put_under:                (t) => {
    // isSelf:true scopes the trigger to the carrier only — Cheshire Cat
    // Inexplicable IT'S LOADS OF FUN: "Whenever you put a card under this
    // character." The filter narrowing matters for boost-payoff cards
    // (Cheshire / Merlin / Bolt) where the under-card pile is a per-card
    // counter, not a global "any character" trigger.
    if (t.filter?.isSelf) return "Whenever you put a card under this character";
    return filterMentionsYour(t.filter)
      ? "Whenever you put a card under one of your characters or locations"
      : "Whenever a card is put underneath this";
  },
  boost_used:                    (t) => filterMentionsYour(t.filter)
                                          ? "Whenever you use the Boost ability of a character"
                                          : "Whenever the Boost ability is used",
  shifted_onto:                  ()  => "Whenever a character is shifted onto this character",
  chosen_by_opponent:            ()  => "Whenever an opponent chooses this character for an action or ability",
  character_exerted:             ()  => "Whenever a character is exerted",
  chosen_for_support:            (t) => filterMentionsYour(t.filter)
                                          ? "Whenever one of your characters is chosen for support"
                                          : "Whenever this character is chosen for support",
};

function renderTrigger(t: Json): string {
  // Multi-trigger shape (CRD 6.2.6 / structural fidelity rule): one printed
  // ability with multiple triggers ("When you play this character and
  // whenever he quests, …"). Render each sub-trigger and join with "and".
  // Hiram Flaversham, Ursula Deal Maker QUITE THE BARGAIN, Wreck-It Ralph
  // BACK ON TRACK, John Silver PICK YOUR FIGHTS, etc.
  if (Array.isArray(t.anyOf)) {
    const parts = t.anyOf.map((sub: Json) => {
      const rendered = renderTrigger(sub);
      // Strip the leading capital so the joined sentence reads naturally:
      // "When you play this character and whenever he quests" — only the
      // first segment keeps its capital.
      return rendered;
    });
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0]!;
    // Lowercase all but the first segment's first letter to make the
    // conjunction read smoothly.
    const first = parts[0]!;
    const rest = parts.slice(1).map(p => p.charAt(0).toLowerCase() + p.slice(1));
    return [first, ...rest].join(" and ");
  }
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
  not:                        (c) => {
    // Special-case: not(is_your_turn) → "during opponents' turns" (Magica De
    // Spell Cruel Sorceress PLAYING WITH POWER). Reads far better than the
    // generic "unless during your turn".
    if (c.condition?.type === "is_your_turn") return "during opponents' turns";
    // not(this_has_no_damage) → "while this character has damage" (Ratigan
    // Raging Rat NOTHING CAN STAND IN MY WAY). Positive phrasing matches
    // the oracle better than the awkward "unless this character has no damage".
    if (c.condition?.type === "this_has_no_damage") return "while this character has damage";
    // not(played_this_turn) → "if you didn't play X this turn" matching
    // oracle wording (Golden Harp Enchanter of the Land STOLEN AWAY:
    // "At the end of your turn, if you didn't play a song this turn,
    // banish this character"). The default "unless you've played" reads
    // less naturally for end-of-turn punisher conditions.
    if (c.condition?.type === "played_this_turn") {
      const inner = c.condition;
      const amt = inner.amount ?? 1;
      const filt = inner.filter ? renderFilter(inner.filter) : "card";
      if (amt === 1) return `if you didn't play a ${filt} this turn`;
      return `if you didn't play ${amt} or more ${filt}${filt.endsWith("s") ? "" : "s"} this turn`;
    }
    return "unless " + stripIfPrefix(renderCondition(c.condition ?? {}));
  },

  // ---- Compound logic ------------------------------------------------------
  compound_and:               (c) => "if " + (c.conditions ?? []).map((sub: Json) => stripIfPrefix(renderCondition(sub))).join(" and "),
  compound_or:                (c) => "if " + (c.conditions ?? []).map((sub: Json) => stripIfPrefix(renderCondition(sub))).join(" or "),
  compound_not:               (c) => "unless " + stripIfPrefix(renderCondition(c.inner ?? {})),

  // ---- Player-state checks --------------------------------------------------
  // "If you have a [filter] in play" — supersedes the legacy single-trait /
  // single-name forms when the filter is more general. Owner-self is
  // suppressed because "you have" already implies ownership ("if you have a
  // damaged character in play" not "if you have your damaged character in
  // play"). hasDamage moves to a trailing "with damage" qualifier matching
  // oracle wording for self_cost_reduction conditions (Mulan Ready for
  // Battle NOBLE SPIRIT: "If you have a character in play with damage").
  you_control_matching:       (c) => {
    if (!c.filter) return "if you have a character in play";
    const { hasDamage, ...rest } = c.filter;
    const filt = renderFilter(rest, { suppressOwnerSelf: true });
    const trailing = hasDamage ? " with damage" : "";
    // "other X" gets the contracted article "another X" not "an other X".
    if (filt.startsWith("other ")) {
      return `if you have another ${filt.slice("other ".length)} in play${trailing}`;
    }
    const article = /^[aeiou]/i.test(filt) ? "an" : "a";
    return `if you have ${article} ${filt} in play${trailing}`;
  },
  opponent_controls_matching: (c) => `if an opposing ${c.filter ? renderFilter({ ...c.filter, owner: undefined }) : "character"} is in play`,
  cards_in_hand_gte:          (c) => {
    const who = c.player?.type === "opponent" ? "an opponent has" : "you have";
    return `if ${who} ${c.amount ?? 0} or more cards in ${c.player?.type === "opponent" ? "their" : "your"} hand`;
  },
  cards_in_hand_eq:           (c) => {
    const who = c.player?.type === "opponent" ? "an opponent has" : "you have";
    const possessive = c.player?.type === "opponent" ? "their" : "your";
    if ((c.amount ?? 0) === 0) {
      // Lorcana oracle wording is inconsistent between cards: Gaston
      // Scheming Suitor uses "one or more opponents have no cards in their
      // hands" (plural), while Belle - Bookworm uses "an opponent has no
      // cards in their hand" (singular). Pick the plural-many wording — it
      // matches more cards in the corpus and gracefully degrades on the
      // singular cases.
      return c.player?.type === "opponent"
        ? "if one or more opponents have no cards in their hands"
        : "if you have no cards in your hand";
    }
    return `if ${who} exactly ${c.amount} cards in ${possessive} hand`;
  },
  cards_in_zone_gte: (c) => {
    const n = c.amount ?? 0;
    const zone = c.zone ?? "zone";
    const owner = c.player?.type === "opponent" ? "an opponent has" : "you have";
    // filter (rich form) takes precedence over inline cardType (legacy).
    const f = c.filter;
    if (f) {
      // Build natural-English phrasing matching oracle:
      //   - Queen of Hearts COUNT OFF! "5 or more characters with damage in play"
      //   - Coachman WILD RIDE "2 or more characters of yours are exerted"
      //   - Colonel Old Sheepdog "3 or more Puppy characters in play"
      const filt = renderFilter(f, { suppressOwnerSelf: true });
      const plural = pluralizeFilter(filt);
      const zonePhrase = zone === "play" ? "in play" : `in ${owner === "you have" ? "your" : "their"} ${zone}`;
      return `if there are ${n} or more ${plural} ${zonePhrase}`;
    }
    if (c.cardType?.length) {
      const types = c.cardType.join(" or ");
      const zonePhrase = zone === "play" ? "in play" : `in ${owner === "you have" ? "your" : "their"} ${zone}`;
      return `if ${owner} ${n} or more ${types}s ${zonePhrase}`;
    }
    return `if ${owner} ${n} or more cards in ${owner === "you have" ? "your" : "their"} ${zone}`;
  },
  characters_in_play_gte:     (c) => {
    const n = c.amount ?? 0;
    const adj = c.excludeSelf ? "other " : "";
    if (n === 1 && c.excludeSelf) return "if you have another character in play";
    return `if you have ${n} or more ${adj}characters in play`;
  },
  opponent_has_more_cards_in_hand:  () => "if an opponent has more cards in their hand than you",
  // self_has_more_than_each_opponent — oracle phrasing depends on metric.
  // Metrics like strength_in_play / characters_in_play render as
  // "a character in play with more {S} than each opposing character"
  // (Flynn Rider Frenemy NARROW ADVANTAGE) — the comparison is over the
  // best of yours vs each opponent's best, not raw aggregate. Render
  // metric-specific oracle wording rather than the raw enum string.
  self_has_more_than_each_opponent: (c) => {
    const m = c.metric ?? "cards";
    if (m === "strength_in_play") return "if you have a character in play with more {S} than each opposing character";
    if (m === "characters_in_play") return "if you have more characters in play than each opponent";
    if (m === "items_in_play") return "if you have more items in play than each opponent";
    if (m === "cards_in_inkwell") return "if you have more cards in your inkwell than each opponent";
    if (m === "lore") return "if you have more lore than each opponent";
    return `if you have more ${m} than each opponent`;
  },
  your_first_turn_as_underdog: () => "if this is your first turn and you're not the first player",

  // ---- This-card-state checks ----------------------------------------------
  this_has_no_damage:         () => "if this character has no damage",
  // Oracle uses singular "a card under him" / "had a card under them" —
  // the condition fires for 1+ cards under, but printed wording uses
  // singular indefinite article (Merlin Completing His Research LEGACY OF
  // LEARNING: "if he had a card under him, draw 2 cards"). Past-tense
  // "had" matches the moment-of-banish snapshot semantics.
  this_has_cards_under:       () => "if this character had a card under them",
  this_at_location:           () => "while this character is at a location",
  this_location_has_character: (c) => {
    if (c.filter) {
      // Game Preserve EASY TO MISS: filter:{hasKeyword:"evasive"} →
      // "if there's a character with Evasive here".
      const filt = renderFilter(c.filter);
      return `if there's a ${filt} here`;
    }
    return "if you have a character here";
  },
  // Active-voice oracle wording — "if you used Shift to play this character"
  // (Basil Great Mouse Detective THERE'S ALWAYS A CHANCE, Mulan Elite Archer,
  // Stitch Alien Buccaneer, Mickey Mouse Musketeer Captain, etc.). Lorcana
  // sometimes pronouns this as "her"/"him" based on the character's gender;
  // we use the gender-neutral "this character" since the engine doesn't
  // track pronouns.
  played_via_shift:           () => "if you used Shift to play this character",
  triggering_card_played_via_shift: () => "if you used Shift to play them",
  played_via_sing:            () => "if a character sang this song",
  triggering_card_played_via_sing: () => "if it was sung",
  character_was_banished_this_turn: (c) => {
    // Generalized "a [filter] was banished this turn" — replaces the
    // former `character_named_was_banished_this_turn`. Filter normally
    // narrows by hasName (Buzz's Arm: "a character named Buzz Lightyear")
    // or by hasTrait + owner (Wind-Up Frog: "one of your Toy characters").
    if (!c.filter) return "if a character was banished this turn";
    const f = c.filter;
    if (f.hasName) return `if a character named ${f.hasName} was banished this turn`;
    const rendered = renderFilter(f);
    // "your Toy character" → "one of your Toy characters"; else leave as
    // "a character" if no owner qualifier.
    if (f.owner?.type === "self") {
      // renderFilter yields "your Toy character" — prepend "one of".
      return `if one of ${rendered}s was banished this turn`;
    }
    return `if a ${rendered.replace(/^your /, "").replace(/^opposing /, "opposing ")} was banished this turn`;
  },

  // ---- This-card-stat checks ------------------------------------------------
  self_stat_gte:              (c) => `if this character's ${c.stat ?? "strength"} is ${c.amount ?? 0} or more`,
  this_had_card_put_under_this_turn: () => "if a card was put under this character this turn",
  // Mulan Standing Her Ground FLOWING BLADE: player-wide variant — "if
  // you've put a card under one of your characters or locations this turn".
  you_put_card_under_this_turn: () => "if you've put a card under one of your characters or locations this turn",
  this_location_has_exerted_character: () => "if you have an exerted character here",

  // ---- Turn-history checks --------------------------------------------------
  no_challenges_this_turn:    () => "if no characters have challenged this turn",
  opponent_character_was_banished_in_challenge_this_turn:
                              () => "if an opposing character was banished in a challenge this turn",
  ink_plays_this_turn_eq:     (c) => `if you've played exactly ${c.amount ?? 0} cards into your inkwell this turn`,
  played_this_turn: (c) => {
    const amt = c.amount ?? 1;
    const op = c.op ?? ">=";
    const n = op === "==" ? `exactly ${amt}` : (amt === 1 ? "a" : `${amt} or more`);
    const filt = c.filter ? renderFilter(c.filter) : "card";
    // "a" as article vs "1" count wording
    const article = amt === 1 && op !== "==" ? n : (op === "==" ? n : `${n} ${filt.endsWith("s") ? "" : ""}`);
    if (amt === 1 && op !== "==") {
      return `if you've played ${c.filter?.excludeSelf ? "another " : "a "}${filt} this turn`;
    }
    return `if you've played ${n} ${filt}${filt.endsWith("s") ? "" : "s"} this turn`;
  },
  your_character_was_damaged_this_turn: () => "if one of your characters was damaged this turn",
  no_other_character_quested_this_turn: () => "if no other character has quested this turn",
  card_left_discard_this_turn: () => "if a card left a player's discard this turn",
  character_challenges_this_turn_eq: (c) => {
    // Oracle wording: "if it's the Nth challenge this turn" (Fa Zhou).
    const ord = c.amount === 2 ? "second" : c.amount === 3 ? "third" : c.amount === 4 ? "fourth" : `${c.amount}${c.amount === 1 ? "st" : "th"}`;
    return `if it's the ${ord} challenge this turn`;
  },
  this_had_card_put_under_this_turn: () => "if a card was put under this character this turn",

  // Pete Games Referee — "during your turn, opponents can't play actions"
  opponent_no_challenges_this_turn: () => "if no opposing character has challenged this turn",

  // Per-turn event flags
  a_character_was_banished_in_challenge_this_turn: () => "if a character was banished in a challenge this turn",
  opposing_character_was_damaged_this_turn: () => "if an opposing character was damaged this turn",
  cards_put_into_discard_this_turn_atleast: (c) =>
    `if ${c.amount ?? 0} or more cards were put into your discard this turn`,
  you_removed_damage_this_turn: () => "if you removed damage from a character this turn",
  // Julieta Madrigal Excellent Cook SIGNATURE RECIPE pattern — ability-local
  // "this way" variant. Compares state.lastEffectResult (count from the most
  // recent remove_damage / discard / mill / etc.) against amount. `gte 1`
  // reads as "if you did it this way"; other comparators spell out the exact
  // numeric gate.
  last_effect_result: (c) => {
    const op = c.comparison ?? "gte";
    const n = c.amount ?? 0;
    if (op === "gte" && n === 1) return "if you did this";
    const phrase =
      op === "gte" ? `at least ${n}`
      : op === "lte" ? `at most ${n}`
      : op === "gt" ? `more than ${n}`
      : op === "lt" ? `fewer than ${n}`
      : `exactly ${n}`;
    return `if the preceding effect produced ${phrase}`;
  },

  // Stat / location / state checks
  this_has_damage: (c) => {
    const n = c.amount ?? 1;
    const op = c.op ?? ">=";
    if (n === 1 && op === ">=") return "if this character has damage";
    switch (op) {
      case ">=": return `if this character has ${n} or more damage`;
      case "==": return `if this character has exactly ${n} damage`;
      case ">": return `if this character has more than ${n} damage`;
      case "<=": return `if this character has ${n} or less damage`;
      case "<": return `if this character has less than ${n} damage`;
      default: return `if this character has ${n} or more damage`;
    }
  },
  // Oracle wording for location-bound conditions uses "here" not "at it":
  // "if you have a damaged character here", "if you have a Pirate character here".
  this_location_has_damaged_character: () => "if you have a damaged character here",
  this_location_has_character_with_trait: (c) => `if you have a ${c.trait ?? "?"} character here`,
  characters_here_gte: (c) => {
    const n = c.amount ?? 0;
    const op = c.op ?? ">=";
    switch (op) {
      case ">=": return `if you have ${n} or more characters here`;
      case "==": return `if you have only ${n} character${n === 1 ? "" : "s"} here`;
      case ">": return `if you have more than ${n} characters here`;
      case "<=": return `if you have ${n} or fewer characters here`;
      case "<": return `if you have fewer than ${n} characters here`;
      default: return `if you have ${n} or more characters here`;
    }
  },

  // Trait-on-last-resolved-target: "If a Villain character is chosen, ..."
  last_resolved_target_has_trait: (c) => `if a ${c.trait ?? "?"} character is chosen`,
  // Time to Go!: "If that character had a card under them, draw 3 cards
  // instead." Reads state.lastBanishedCardsUnderCount.
  last_banished_had_cards_under: () => "if that character had a card under them",
  // Ink Amplifier ENERGY CAPTURE: "if it's the second card they've drawn this turn"
  triggering_player_draws_this_turn_eq: (c) => `if it's the ${c.amount === 2 ? "second" : c.amount === 1 ? "first" : c.amount === 3 ? "third" : `${c.amount}th`} card they've drawn this turn`,

  // Player-state comparisons
  opponent_has_lore_gte: (c) => `if an opponent has ${c.amount ?? 0} or more lore`,
  opponent_has_more_than_self: (c) => `if an opponent has more ${c.metric ?? "cards"} than you`,

};

function stripIfPrefix(s: string): string {
  // Some conditions render with a "while " or "if " prefix as a head — when
  // they're being composed under a containing connector ("unless X", "if X
  // and Y"), the inner head must be stripped so we don't get "unless while
  // X" / "if while X" (Treasure Guardian Protector of the Cave WHO DISTURBS
  // MY SLUMBER? renders `not(this_at_location)` and got "unless while this
  // character is at a location" before this fix).
  return s.replace(/^(if|while)\s+/i, "");
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
  discard:            (c) => {
    const amt = c.amount ?? 1;
    // Cost-side discard: oracle convention is mostly "Choose and discard a
    // card" (The Wardrobe Perceptive Friend, Cobra Bubbles inner) but
    // some older cards use just "Discard a card" (Half Hexwell Crown).
    // Use the majority form.
    const filterNoOwnerZone = c.filter ? { ...c.filter, zone: undefined } : undefined;
    const filt = filterNoOwnerZone ? renderFilter(filterNoOwnerZone, { suppressOwnerSelf: true }) : "card";
    if (amt === 1) return `Choose and discard a ${filt}`;
    return `Choose and discard ${amt} ${filt}${filt.endsWith("s") ? "" : "s"}`;
  },
  discard_from_hand:  (c) => {
    const amt = c.amount ?? 1;
    const filterNoOwnerZone = c.filter ? { ...c.filter, zone: undefined } : undefined;
    const filt = filterNoOwnerZone ? renderFilter(filterNoOwnerZone, { suppressOwnerSelf: true }) : "card";
    if (amt === 1) return `Choose and discard a ${filt}`;
    return `Choose and discard ${amt} ${filt}${filt.endsWith("s") ? "" : "s"}`;
  },
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
    // `until` is a runtime-computed draw count; the literal `amount` field is a
    // 0 placeholder in that case (Clarabelle / Yzma / Remember Who You Are
    // pattern, plus the migrated Demona / Goliath cards from the deleted
    // draw_until primitive). Render the runtime form so it doesn't
    // false-positive as a "draws 0 cards" stub.
    if (e.until !== undefined) {
      // Detect the count-filter "match opponent's hand" shape (replaces the
      // legacy "match_opponent_hand" sentinel string).
      const u = e.until;
      const isOpponentHandCount = typeof u === "object" && u?.type === "count"
        && u.filter?.zone === "hand" && u.filter?.owner?.type === "opponent";
      if (isOpponentHandCount) {
        return `${maybe(e)}draw cards until you have the same number as chosen opponent`;
      }
      if (typeof u === "number") {
        // Subject + pronoun agreement matters here:
        //   target=both           → "each player draws ... until they have N cards in their hand"
        //   target=active_player  → "they draw ... until they have N cards in their hand"
        //   target=self / default → "draw ... until you have N cards in your hand"
        // The Yzma / Desperate Plan / Set 6 cards all use target=self and the
        // oracle text uses second-person ("you have N in your hand").
        const tgt = e.target?.type;
        if (tgt === "both") {
          return `each player draws cards until they have ${u} cards in their hand`;
        }
        if (tgt === "active_player") {
          return `they draw cards until they have ${u} cards in their hand`;
        }
        return `${maybe(e)}draw cards until you have ${u} cards in your hand`;
      }
      // Fallback for arbitrary DynamicAmount thresholds — render the threshold
      // generically so the renderer doesn't crash on a future shape we haven't
      // catalogued yet.
      return `${maybe(e)}draw cards until you have a specific number of cards in your hand`;
    }
    // Subject framing: target=both → "each player draws N", target=opponent → "each opponent draws N".
    // Default (self) keeps the original "draw N cards" phrasing.
    // isMay + target:opponent → "each opponent may draw" (Kuzco's
    // "Then, each opponent may draw a card") — put "may" INSIDE the
    // subject so it agrees with "each opponent" rather than emitting
    // a dangling "you may each opponent draws".
    const otherPlayers = e.target?.type === "both" || e.target?.type === "opponent";
    const mayPrefix = (e.isMay && !otherPlayers) ? "you may " : "";
    // When "may" is present the verb loses its -s ("each opponent may draw"
    // not "each opponent may draws").
    const drawVerb = e.isMay ? "draw" : "draws";
    const mayInside = (e.isMay && otherPlayers) ? "may " : "";
    const subject = e.target?.type === "both" ? `each player ${mayInside}${drawVerb} ` :
                    e.target?.type === "opponent" ? `each opponent ${mayInside}${drawVerb} ` :
                    `${mayPrefix}draw `;
    const amt = e.amount ?? 1;
    if (typeof amt !== "number") {
      // Count-filter dynamic amount reads better as "a card for each X"
      // than "cards equal to the number of Xs" (Mickey Mouse Musketeer
      // Captain MUSKETEERS UNITED: "draw a card for each character with
      // Bodyguard you have in play").
      if (typeof amt === "object" && amt.type === "count" && amt.filter) {
        const filt = amt.filter.owner?.type === "self"
          ? renderFilter(amt.filter, { suppressOwnerSelf: true }) + " you have in play"
          : renderFilter(amt.filter);
        return `${subject}a card for each ${filt}`;
      }
      return `${subject}cards equal to ${renderAmount(amt)}`;
    }
    if (amt === 1) return `${subject}a card`;
    return `${subject}${amt} cards`;
  },
  discard:            (e) => `${maybe(e)}discard ${e.amount ?? 1} card${plural(e.amount ?? 1)}`,
  discard_from_hand:  (e) => {
    // `until` is a runtime-computed discard count — render the runtime form
    // before the standard amount-based phrasing. Mirrors the same shape on
    // `draw` (replaces the deleted `discard_until` primitive). Subject
    // agreement: target=opponent → "they have"; target=both → "each player";
    // target=active_player → "they have" ("at the end of each player's turn,
    // if they have more than N…"). Default (self) keeps "you have".
    if (e.until !== undefined) {
      const u = e.until;
      const tgt = e.target?.type;
      const subject = tgt === "both" ? "each player"
        : tgt === "opponent" ? "they"
        : tgt === "active_player" ? "they"
        : "you";
      const haveVerb = subject === "you" ? "you have" : "they have";
      const n = typeof u === "number" ? String(u) : "N";
      return `if ${haveVerb} more than ${n} cards in their hand, ${subject} choose and discard cards until ${haveVerb} ${n}`;
    }
    const amt = e.amount === "all" ? "their hand" : `${e.amount ?? 1} card${plural(e.amount ?? 1)}`;
    if (e.target?.type === "both") {
      return `${maybe(e)}each player discards ${amt}`;
    }
    if (e.target?.type === "opponent") {
      // Ursula - Eric's Bride VANESSA'S DESIGN: chooser:controller + filter →
      // "chosen opponent reveals their hand and discards a [filtered] card
      // of your choice." The reveal-hand is implicit from chooser:controller
      // (comment in types/index.ts:500).
      if (e.chooser === "controller" && e.filter) {
        const filt = renderFilter(e.filter);
        return `${maybe(e)}chosen opponent reveals their hand and discards a ${filt} of your choice`;
      }
      // Belle Hidden Archer THORNY ARROWS: target:opponent + amount:"all" +
      // chooser:target_player. Oracle uses context-specific wording ("the
      // challenging character's player discards all cards in their hand")
      // but the neutral "the opposing player discards all cards in their
      // hand" reads correctly and doesn't depend on trigger context.
      if (e.amount === "all" && e.chooser === "target_player") {
        return `${maybe(e)}the opposing player discards all cards in their hand`;
      }
      const chooser = e.chooser === "target_player" ? "chooses and " : "";
      return `${maybe(e)}each opponent ${chooser}discards ${amt}`;
    }
    // Search for Clues: "The player or players with the most cards in their
    // hand choose and discard N cards."
    if (e.target?.type === "players_with_most_cards_in_hand") {
      const chooser = e.chooser === "target_player" ? "choose and " : "";
      return `${maybe(e)}the player or players with the most cards in their hand ${chooser}discard ${amt}`;
    }
    if (e.chooser === "target_player") {
      return `${maybe(e)}choose and discard ${amt}`;
    }
    // Random self-discard (Dangerous Plan: "Then, discard a card at
    // random."). The chooser:"random" idiom skips the "choose and" prefix
    // because the controller doesn't pick.
    if (e.chooser === "random") {
      // target=target_owner means the chosen target's controller is the
      // discard player ("then that player discards a card at random" —
      // We Don't Talk About Bruno).
      if (e.target?.type === "target_owner") {
        return `${maybe(e)}that player discards ${amt} at random`;
      }
      return `${maybe(e)}discard ${amt} at random`;
    }
    // Self-discard with no chooser field: Lorcana oracle convention is
    // "choose and discard a card" because the controller picks which card.
    // Cobra Bubbles Former CIA THINK ABOUT WHAT'S BEST: "Draw a card, then
    // choose and discard a card." Without "choose and", we emit
    // "discard 1 card" which loses 0.10+ similarity per card. Skip when
    // amount is "all" (Belle Hidden Archer style) — there's nothing to choose.
    if (e.amount !== "all") {
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
    // "Count"-typed DynamicAmount renders as "for each X" (oracle wording)
    // rather than "equal to the number of Xs". Pack Tactics: "Gain 1 lore
    // for each damaged character opponents have in play."
    if (typeof n === "object" && n?.type === "count" && n.filter) {
      // Stratos Tornado Titan: "for each Titan character you have in play"
      // — owner:self suppresses the "your" adjective, replaced by a
      // trailing "you have in play" phrase.
      if (n.filter.owner?.type === "self") {
        const sing = renderFilter(n.filter, { suppressOwnerSelf: true });
        return `${tgt} ${verbS(tgt, "gain", "gains")} 1 lore for each ${sing} you have in play`;
      }
      // Pack Tactics: "Gain 1 lore for each damaged character opponents
      // have in play" — owner:opponent gets the "opponents have in play"
      // trailing phrase.
      if (n.filter.owner?.type === "opponent") {
        const sing = renderFilter({ ...n.filter, owner: undefined });
        return `${tgt} ${verbS(tgt, "gain", "gains")} 1 lore for each ${sing} opponents have in play`;
      }
      const sing = renderFilter(n.filter);
      return `${tgt} ${verbS(tgt, "gain", "gains")} 1 lore for each ${sing}`;
    }
    // Wreck-It Ralph Demolition Dude REFRESHING BREAK: "gain 1 lore for
    // each 1 damage on him". `triggering_card_damage` string enum reads
    // better as per-damage than "lore equal to the damage". Same shape
    // for `stat_ref` from triggering_card on the damage property.
    if (n === "triggering_card_damage") {
      return `${tgt} ${verbS(tgt, "gain", "gains")} 1 lore for each 1 damage on them`;
    }
    if (typeof n === "object" && n?.type === "stat_ref"
        && n.from === "triggering_card" && n.property === "damage") {
      return `${tgt} ${verbS(tgt, "gain", "gains")} 1 lore for each 1 damage on them`;
    }
    return `${tgt} ${verbS(tgt, "gain", "gains")} lore equal to ${renderAmount(n)}`;
  },
  lose_lore: (e) => {
    const tgt = renderTarget(e.target ?? { type: "self" });
    const n = e.amount ?? 1;
    if (typeof n === "number") {
      return `${tgt} ${verbS(tgt, "lose", "loses")} ${n} lore`;
    }
    return `${tgt} ${verbS(tgt, "lose", "loses")} lore equal to ${renderAmount(n)}`;
  },
  prevent_lore_gain: (e) => {
    // Read affectedPlayer (used by Peter Pan Never Land Prankster CAN'T
    // TAKE A JOKE) OR fall back to target (legacy shape).
    const player = e.affectedPlayer ?? e.target ?? {};
    const subj = player.type === "opponent" ? "each opposing player"
      : player.type === "both" ? "each player"
      : player.type === "self" ? "you"
      : renderTarget(player);
    return `${subj} can't gain lore${dur(e)}`;
  },

  deal_damage: (e) => {
    const amt = e.amount ?? 1;
    // asPutDamage: Lorcana distinguishes "deal damage" (triggers damage
    // reactions) from "put damage counter(s)" (direct counter placement,
    // bypasses damage-dealt triggers). Cards: Malicious Mean and Scary,
    // Queen of Hearts Unpredictable Bully, Hades Looking for a Deal.
    const verb = e.asPutDamage ? "put" : "deal";
    const suffix = e.asPutDamage ? "damage counter" : "damage";
    let base: string;
    if (e.target?.chooser === "target_player") {
      base = typeof amt === "number"
        ? `${maybe(e)}each opponent chooses one of their characters and ${verb}s ${up(e)}${amt} ${suffix}${amt === 1 ? "" : "s"} on them`
        : `${maybe(e)}each opponent chooses one of their characters and ${verb}s ${suffix} equal to ${renderAmount(amt)} on them`;
    } else if (typeof amt === "number") {
      const amtStr = `${up(e)}${amt}`;
      if (e.asPutDamage) {
        base = `${maybe(e)}put ${amtStr} ${suffix}${amt === 1 ? "" : "s"} on ${renderTarget(e.target ?? {})}`;
      } else {
        base = `${maybe(e)}deal ${amtStr} damage to ${renderTarget(e.target ?? {})}`;
      }
    } else if (typeof amt === "object" && amt?.type === "count" && amt.filter) {
      // "Deal 1 damage to X for each Y" oracle wording (Light the Fuse:
      // "Deal 1 damage to chosen character for each exerted character you
      // have in play."). Without this, renderAmount produces "the number
      // of your exerted characters" which reads as a noun, forcing "deal
      // damage equal to" wording — flips the sentence shape vs the oracle's
      // "for each X" idiom. perMatch defaults to 1.
      const per = amt.perMatch ?? 1;
      const f = amt.filter;
      const filt = f.owner?.type === "self"
        ? renderFilter(f, { suppressOwnerSelf: true }) + " you have in play"
        : renderFilter(f);
      base = e.asPutDamage
        ? `${maybe(e)}put ${per} ${suffix}${per === 1 ? "" : "s"} on ${renderTarget(e.target ?? {})} for each ${filt}`
        : `${maybe(e)}deal ${per} damage to ${renderTarget(e.target ?? {})} for each ${filt}`;
    } else {
      const dyn = renderAmount(amt);
      base = e.asPutDamage
        ? `${maybe(e)}put ${suffix}s equal to ${dyn} on ${renderTarget(e.target ?? {})}`
        : `${maybe(e)}deal damage equal to ${dyn} to ${renderTarget(e.target ?? {})}`;
    }
    if (e.followUpEffects?.length) {
      const follow = e.followUpEffects.map((f: Json) => renderEffect(f)).join(". ");
      return `${base}. Then, ${follow}`;
    }
    return base;
  },
  remove_damage:  (e) => {
    const amt = e.amount === "all" ? "all" : (typeof e.amount === "number" ? e.amount : renderAmount(e.amount));
    // Suppress hasDamage:true from the target filter — remove_damage requires
    // the target to be damaged anyway, so oracle text doesn't repeat
    // "damaged character" (Jasmine Heir of Agrabah, Repair, Rapunzel Sunshine
    // all say just "chosen character" not "chosen damaged character").
    let target = e.target;
    if (target?.filter?.hasDamage) {
      const { hasDamage, ...restFilter } = target.filter;
      target = { ...target, filter: restFilter };
    }
    // Default unfiltered single targets to "characters or locations" —
    // Repair: "Remove up to 3 damage from one of your locations or
    // characters." Skip when target is multi (count>1) because oracle
    // for multi-target damage removal usually says just "characters"
    // (Gumbo Pot THE BEST I'VE EVER TASTED: "up to 2 chosen characters").
    const isMultiTarget = target?.type === "chosen" && typeof target.count === "number" && target.count > 1;
    if (target?.filter && !target.filter.cardType && !isMultiTarget) {
      target = { ...target, filter: { ...target.filter, cardType: ["character", "location"] } };
    }
    // Multi-target "remove N damage each from up to M chosen X" idiom (Gumbo
    // Pot THE BEST I'VE EVER TASTED). When the target.count > 1, oracle says
    // "from up to N chosen characters" (count-level "up to") and drops the
    // amount-level "up to" since each target loses the same fixed amount.
    if (target?.type === "chosen" && typeof target.count === "number" && target.count > 1) {
      // Default multi-target cardType to ["character"] — items don't take
      // damage and Lorcana oracle for multi-target damage removal uses
      // singular cardType ("up to 2 chosen characters").
      const filtForRender = target.filter?.cardType
        ? target.filter
        : { ...target.filter, cardType: ["character"] };
      const noun = pluralizeFilter(renderFilter(filtForRender, { suppressOwnerSelf: true }));
      const ownerPrefix = target.filter?.owner?.type === "self" ? "your " : "";
      const upToPrefix = e.isUpTo ? "up to " : "";
      return `${maybe(e)}remove ${amt} damage each from ${upToPrefix}${target.count} chosen ${ownerPrefix}${noun}`;
    }
    const base = `${maybe(e)}remove ${up(e)}${amt} damage from ${renderTarget(target ?? {})}`;
    // followUpEffects apply to the same chosen target (Penny Bolt's Person
    // ENDURING LOYALTY: "... and they gain Resist +1"). Render the "they"-
    // pronoun shape by rewriting each followUp's "this character" references
    // to "they". Simplest path: render normally and prefix with "and they".
    if (e.followUpEffects?.length) {
      const fu = (e.followUpEffects as any[]).map((f) => {
        const rendered = renderEffect(f);
        // "this character" → "they" when stitched as a follow-up clause.
        return rendered.replace(/^this character /i, "they ").replace(/^all this character /i, "they ");
      }).join(" and ");
      return `${base} and ${fu}`;
    }
    return base;
  },
  move_damage:    (e) => {
    // CardJSON shape varies: legacy uses `from`/`to`, newer uses `source`/`destination`.
    const from = e.from ?? e.source ?? {};
    const to = e.to ?? e.destination ?? {};
    const amt = e.amount === "all" ? "all" : (e.amount ?? 1);
    return `${maybe(e)}move ${up(e)}${amt} damage from ${renderTarget(from)} to ${renderTarget(to)}`;
  },

  banish: (e) => {
    if (e.target?.chooser === "target_player") return `${maybe(e)}each opponent chooses and banishes one of their characters`;
    return `${maybe(e)}banish ${renderTarget(e.target ?? {})}`;
  },
  banish_chosen:  (e) => `${maybe(e)}banish ${renderTarget(e.target ?? {})}`,
  return_to_hand: (e) => {
    if (e.target?.chooser === "target_player") return `${maybe(e)}each opponent chooses one of their characters and returns it to their hand`;
    const tgt = e.target?.type ?? "this";
    if (tgt === "this") return `${maybe(e)}return this card to your hand`;
    if (tgt === "triggering_card") return `${maybe(e)}return that card to its player's hand`;
    // Treasures Untold: "Return up to 2 item cards from your discard into
    // your hand." — detect count>1 + isMay + owner:self + zone:discard and
    // build the "up to N X from your discard" phrasing.
    if (e.isMay && e.target?.type === "chosen" && e.target.count && e.target.count > 1
        && e.target.filter?.owner?.type === "self" && e.target.filter?.zone === "discard") {
      const noun = pluralizeFilter(renderFilter(e.target.filter, { suppressOwnerSelf: true }));
      return `return up to ${e.target.count} ${noun} from your discard to your hand`;
    }
    return `${maybe(e)}return ${renderTarget(e.target ?? {})} to their player's hand`;
  },
  ready: (e) => {
    let tgt = renderTarget(e.target ?? {});
    // "Ready all your characters" idiom (Nothing We Won't Do, Patch
    // Incorrigible Pup). When target is `all` + owner:self, oracle
    // wording prepends "all" to the possessive — "Ready all your
    // characters" not "Ready your characters". renderTarget drops the
    // "all" for owner-self because most static phrasings don't need it
    // ("Your characters get +2"); ready_all is the exception.
    if (e.target?.type === "all" && e.target.filter?.owner?.type === "self"
        && tgt.startsWith("your ")) {
      tgt = "all " + tgt;
    }
    const base = `${maybe(e)}ready ${tgt}`;
    if (e.followUpEffects?.length) {
      // Convention: `{type:"this"}` inside followUpEffects refers to the
      // readied (chosen) character, not the ability source. Rewrite to
      // render as "they" (consolidates trailing restrictions like
      // Gosalyn HEROIC INTERVENTION's "they can't quest or challenge").
      const followUp = e.followUpEffects.map((f: Json) => renderEffect(rewriteFollowUpThisToPronoun(f))).join(". ");
      return `${base}. ${followUp}`;
    }
    return base;
  },
  exert: (e) => {
    const upTo = e.isUpTo ? "up to " : "";
    const count = e.count && e.count > 1 ? `${e.count} ` : "";
    let base: string;
    if (e.target?.chooser === "target_player") {
      const which = (e.target?.filter as Json | undefined)?.isExerted === false ? "ready " : "";
      base = `${maybe(e)}each opponent chooses and exerts one of their ${which}characters`;
    } else {
      // Action-effect "exert all" — oracle includes "all" prefix even when the
      // filter scope is "your" (Mor'du Savage Cursed Prince FEROCIOUS ROAR:
      // "exert all your characters not named Mor'du"). renderTarget drops
      // "all" for self-owned filters because static-grant phrasing is
      // "Your characters gain X" (no "all"). Restore "all" for action exerts.
      const allPrefix = e.target?.type === "all" ? "all " : "";
      base = `${maybe(e)}exert ${upTo}${count}${allPrefix}${renderTarget(e.target ?? {})}`;
    }
    if (e.followUpEffects?.length) {
      // followUpEffects attach to the chosen target ("Those characters can't
      // ready at the start of their next turn" — Ursula's Plan, where
      // target:"this" inside followUp refers to the chosen target, not the
      // ability source). Rewrite "this character" → "those characters" /
      // "they" so the follow-up reads as a continuation of the chooser
      // pronoun. For target_player chooser the chosen subject is plural
      // ("each opponent's chosen X" → "those characters").
      const isPluralChooser = e.target?.chooser === "target_player";
      const followUp = e.followUpEffects.map((f: Json) => {
        const r = renderEffect(rewriteFollowUpThisToPronoun(f));
        return isPluralChooser
          ? r.replace(/^they /, "those characters ")
          : r;
      }).join(". ");
      return `${base}. ${followUp}`;
    }
    return base;
  },
  exert_character: (e) => {
    const base = `${maybe(e)}exert ${renderTarget(e.target ?? {})}`;
    if (e.followUpEffects?.length) {
      const followUp = e.followUpEffects.map((f: Json) => renderEffect(f)).join(". ");
      return `${base}. ${followUp}`;
    }
    return base;
  },

  gain_stats: (e) => renderStatChange(e),
  modify_stat: (e) => renderStatChange(e),

  grant_keyword: (e) => {
    const locScope = locationScopeRewrite(e.target);
    const tgt = locScope.tgt ?? renderTarget(e.target ?? {});
    // count-typed valueDynamic: render as "Resist +1 for each X" to match
    // oracle (Snow White Fair-Hearted). Other DynamicAmounts fall back to
    // "+the-number-of-X" style.
    if (e.valueDynamic?.type === "count" && e.valueDynamic.filter) {
      const sing = renderFilter(e.valueDynamic.filter);
      return `${tgt} ${verbS(tgt, "gain", "gains")} ${cap(e.keyword)} +1 for each ${sing}${dur(e)}${locScope.suffix}`;
    }
    let v = "";
    if (e.valueDynamic) {
      v = " +" + renderAmount(e.valueDynamic);
    } else if (e.value !== undefined) {
      v = " +" + e.value;
    }
    return `${tgt} ${verbS(tgt, "gain", "gains")} ${cap(e.keyword)}${v}${dur(e)}${locScope.suffix}`;
  },

  cant_action: (e) => {
    const tgt = renderTarget(e.target ?? {});
    const action = e.action === "be_challenged" ? "be challenged"
      : e.action === "ready" ? "ready"
      : e.action ?? "act";
    const d = dur(e);
    // "They can't ready at the start of their next turn" is more natural
    let base: string;
    if (e.action === "ready" && e.duration === "end_of_owner_next_turn") {
      base = `${tgt} can't ready at the start of their next turn`;
    } else {
      base = `${tgt} can't ${action}${d}`;
    }
    // followUpEffects apply to the same chosen target. Ariel - Curious Traveler
    // FAMILIAR GROUND: "chosen opposing character can't challenge AND must
    // quest during their next turn if able". The follow-up is a
    // must_quest_if_able with target:last_resolved_target referring to the
    // same character as the cant_action target. Render with "and they ..."
    // pronoun to read smoothly.
    if (e.followUpEffects?.length) {
      const fu = (e.followUpEffects as any[]).map((f) => {
        const rendered = renderEffect(rewriteFollowUpThisToPronoun(f));
        return rendered;
      }).join(" and ");
      return `${base} and ${fu}`;
    }
    return base;
  },
  // Self-restriction variant — same shape as cant_action but always targets
  // this character. Used by Maui - Whale ("This character can't ready at the
  // start of your turn") and Gargoyle STONE BY DAY ("this character can't
  // ready" — blanket, via ready_anytime).
  cant_action_self: (e) => {
    // RC Remote-Controlled Car: unlock cost bypasses the restriction.
    // Oracle: "This character can't quest or challenge unless you pay 1 {I}."
    const unlockSuffix = Array.isArray(e.unlockCost) && e.unlockCost.length > 0
      ? ` unless you pay ${e.unlockCost
          .map((c: any) => c.type === "pay_ink" ? `${c.amount} {I}` : c.type)
          .join(" and ")}`
      : "";
    if (e.action === "ready") return `this character can't ready at the start of your turn${dur(e)}${unlockSuffix}`;
    if (e.action === "ready_anytime") return `this character can't ready${dur(e)}${unlockSuffix}`;
    // Max Goof Rockin' Teen I JUST WANNA STAY HOME: "can't move to locations".
    // In Lorcana, "move" always means "move to a location", so render that
    // explicitly so the rendered text matches the oracle wording.
    if (e.action === "move") return `this character can't move to locations${dur(e)}${unlockSuffix}`;
    // Sing: oracle is consistently "can't {E} to sing songs" (Ulf Mime
    // SILENT PERFORMANCE, Ariel On Human Legs VOICELESS).
    if (e.action === "sing") return `this character can't {E} to sing songs${dur(e)}${unlockSuffix}`;
    return `this character can't ${e.action ?? "act"}${dur(e)}${unlockSuffix}`;
  },

  // pay_ink as an effect (e.g. Ursula's Shell Necklace nested cost-as-effect).
  // The cost-side renderer in COST_RENDERERS handles the activated-cost form;
  // this entry covers the rare effect-side usage.
  pay_ink: (e) => `pay ${e.amount ?? 1} {I}`,

  self_cost_reduction: (e) => {
    const amt = e.amount;
    if (typeof amt === "number") return `this character costs ${amt} {I} less to play`;
    if (typeof amt === "string") {
      // Per-turn-event DynamicAmount string (e.g. opposing_chars_banished_in_challenge_this_turn)
      const phrase = renderAmount(amt);
      return `you pay 1 {I} less to play this character for ${phrase}`;
    }
    if (typeof amt === "object" && amt?.type === "count") {
      const filt = amt.filter ? renderFilter(amt.filter) : "matching card";
      return `For each ${filt}, you pay ${e.perMatch ?? 1} {I} less to play this character`;
    }
    // Olaf Snowman of Action ABOUT TIME!: `perCount` + `countFilter` schema.
    // "For each action card in your discard, you pay 1 {I} less to play this
    // character."
    if (e.countFilter) {
      const filt = renderFilter(e.countFilter);
      return `For each ${filt}, you pay ${e.perCount ?? 1} {I} less to play this character`;
    }
    return `this character costs less to play`;
  },
  grant_play_for_free_self:   ()  => "you may play this character for free",
  grant_shift_self:           (e) => `this character gains Shift ${e.value ?? e.amount ?? "?"}`,
  grant_cost_reduction: (e) => {
    const amt = typeof e.amount === "number" ? `${e.amount}` : typeof e.amount === "object" ? renderAmount(e.amount) : `${e.amount ?? "?"}`;
    return `you pay ${amt} {I} less for the next ${e.filter ? renderFilter(e.filter) : "card"} you play this turn`;
  },
  // CRD: `cost_reduction` creates a one-shot this-turn reduction — consumed
  // when the first matching card is played, cleared on turn pass. Oracle
  // phrasing is "for the next X you play this turn" (Dr. Facilier's Cards,
  // Encanto Holiday Playset, etc.), NOT a permanent discount.
  //
  // Convention: `amount: 99` is the engine's "effectively free" idiom used
  // in STATIC contexts for "you may play X for free" (Yokai Scientific
  // Supervillain NEUROTRANSMITTER). Detect and render accordingly — the
  // "this turn" scope is also dropped since static reductions are permanent
  // while the source is in play.
  cost_reduction: (e) => {
    // Strip owner:self from the filter render — "your" reads redundantly
    // with "you pay". Yokai Intellectual Schemer: "you pay 1 {I} less to
    // play characters using their Shift ability", not "...next your
    // character".
    const filterNoOwner = e.filter ? { ...e.filter, owner: undefined } : undefined;
    const filt = filterNoOwner ? renderFilter(filterNoOwner, { suppressOwnerSelf: true }) : "card";
    if (e.amount === 99) {
      return `you may play ${pluralizeFilter(filt)} for free`;
    }
    // Two count-filter forms:
    //   - Zero to Hero (action card): "Count the number of characters you
    //     have in play. You pay that amount of {I} less for the next
    //     character you play this turn." Action-form count-filter cost
    //     reductions use this oracle wording (one-shot, "next X").
    //   - Owl Island TEAMWORK (static on a location): "For each character
    //     you have here, you pay 1 {I} less for the first action you play
    //     each turn." Static-form count-filter is ongoing per-turn.
    // Distinguish by atLocation:"this" on the count filter (only static
    // location-scoped count emits the per-turn ongoing form).
    if (typeof e.amount === "object" && e.amount?.type === "count" && e.amount.filter) {
      const cntFilter = e.amount.filter;
      const cntPhrase = cntFilter.owner?.type === "self"
        ? renderFilter(cntFilter, { suppressOwnerSelf: true })
        : renderFilter(cntFilter);
      if (cntFilter.atLocation === "this") {
        return `For each ${cntPhrase}, you pay 1 {I} less for the first ${filt} you play each turn`;
      }
      return `Count the number of ${pluralizeFilter(cntPhrase)} you have in play. You pay that amount of {I} less for the next ${filt} you play this turn`;
    }
    const amt = typeof e.amount === "number" ? `${e.amount}` : typeof e.amount === "object" ? renderAmount(e.amount) : `${e.amount ?? "?"}`;
    // Yokai Intellectual Schemer INNOVATE: shift-scoped static cost reduction
    // is permanent while in play, not one-shot — drop the "next...this turn".
    if (e.appliesTo === "shift_only") {
      return `you pay ${amt} {I} less to play ${pluralizeFilter(filt)} using their Shift ability`;
    }
    return `you pay ${amt} {I} less for the next ${filt} you play this turn`;
  },

  play_card: (e) => {
    // When chained after peek_and_set_target (Robin Hood, Powerline), the
    // previous renderer already says "...and play it for free". Suppress the
    // redundant second phrase by returning empty — the effect still runs in
    // the engine.
    if (e.target?.type === "last_resolved_target") return "";
    // target:"this" with sourceZone — Lilo Escape Artist NO PLACE I'D RATHER
    // BE: "you may play her" (the source card itself, from discard, exerted).
    // Render as "you may play her/him/this character" — pronoun choice
    // depends on the card text but "her" is a reasonable default for the
    // first such case; switch to "this character" for the generic version
    // since pronoun selection isn't tracked.
    if (e.target?.type === "this") {
      const enterExClause = e.enterExerted ? " and she enters play exerted" : "";
      const sz = e.sourceZone === "discard" ? " from your discard" : "";
      return `${maybe(e)}play this character${sz}${enterExClause}`;
    }
    const costClause = e.cost === "normal" ? "" : " for free";
    // sourceZone qualifier (hand is the unstated default; discard/under are
    // meaningful). Under-self (Black Cauldron RISE AND JOIN ME!) reads as
    // "this turn, you may play characters from under this item".
    const sz = e.sourceZone;
    const filter = e.filter ? renderFilter(e.filter) : "a card";
    const plural = filter.endsWith("s") ? filter : `${filter}s`;
    // Mystical Inkcaster: grantKeywords + banishAtEndOfTurn add post-clauses
    // — "They gain Rush. At the end of your turn, banish them."
    const kwClause = e.grantKeywords?.length
      ? `. They gain ${(e.grantKeywords as string[]).map((k) => cap(k)).join(" and ")}`
      : "";
    const banishClause = e.banishAtEndOfTurn
      ? ". At the end of your turn, banish them"
      : "";
    if (sz === "under") {
      return `${maybe(e)}this turn, you may play ${plural} from under this item${costClause}${kwClause}${banishClause}`;
    }
    if (sz === "discard") {
      return `${maybe(e)}play ${filter} from your discard${costClause}${kwClause}${banishClause}`;
    }
    // Multi-zone source (Prince John Gold Lover BEAUTIFUL, LOVELY TAXES:
    // sourceZone: ["hand", "discard"] → "Play an item from your hand or
    // discard"). Render as a disjunction of the listed zones.
    if (Array.isArray(sz) && sz.length > 1) {
      const zones = sz.map((z) => z === "discard" ? "discard" : z === "hand" ? "hand" : z).join(" or ");
      const exClause = e.enterExerted ? ", exerted" : "";
      return `${maybe(e)}play ${filter} from your ${zones}${costClause}${exClause}${kwClause}${banishClause}`;
    }
    const enterExClause = e.enterExerted ? ", exerted" : "";
    return `${maybe(e)}play ${filter}${costClause}${enterExClause}${kwClause}${banishClause}`;
  },

  look_at_top: (e) => {
    // count can be literal number or DynamicAmount object (Bambi Ethereal
    // Fawn: {type: "cards_under_count"}) — use renderAmount to stringify.
    const count: number | string = typeof e.count === "number" ? e.count : (typeof e.count === "object" ? renderAmount(e.count) : (e.count ?? "?"));
    // Deck ownership follows the PlayerTarget (The Fates Only One Eye
    // looks at "each opponent's deck"). Default: your deck.
    const deckOwn = e.target?.type === "opponent" ? "each opponent's deck"
      : e.target?.type === "chosen" ? "chosen player's deck"
      : e.target?.type === "both" ? "each player's deck"
      : "your deck";
    const base = `look at the top ${count} card${typeof count === "number" ? plural(count) : "s"} of ${deckOwn}`;
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
          // Kida Creative Thinker: "Put one into your ink supply, face down
          // and exerted, and the other on top of your deck." — render the
          // restPlacement clause when rest:"top" or "bottom".
          const restSuffix = rest === "top" ? " and the other on top of your deck"
            : rest === "bottom" ? " and the rest on the bottom of your deck"
            : "";
          return `${base}. Put one into your inkwell facedown and exerted${restSuffix}`;
        }
        if (pickDest === "discard" && count === 1) {
          // Mad Hatter Eccentric Host WE'LL HAVE TO LOOK INTO THIS:
          // "Put it on top of their deck or into their discard." Look at
          // top 1 of chosen player's deck → choose top-of-deck or discard
          // as the destination.
          const deckPossessive = e.target?.type === "chosen" ? "their" : "your";
          return `${base}. Put it on top of ${deckPossessive} deck or into ${deckPossessive} discard`;
        }
        // pickDestination "hand" (default)
        if (maxPick === 1) {
          if (count === 2 && !e.filter) {
            // What Else Can I Do? — rest goes to inkwell facedown+exerted.
            if (rest === "inkwell_exerted") {
              return `${base}. Put one into your hand and the other into your inkwell facedown and exerted`;
            }
            if (rest === "discard") {
              return `${base}. Put one into your hand and the other into your discard`;
            }
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
        // Count:1 reorder is effectively "just peek" — no reordering possible
        // on a single card (The Fates "look at the top card of each
        // opponent's deck"). Drop the redundant "put them back" clause.
        if (count === 1) return base;
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
    // Let's Get Dangerous: target:both → per-player reveal with per-player
    // play-for-free and per-player bottom-of-deck. The pronoun flips to
    // "each player" / "their deck" / "their player's deck".
    const isBoth = e.target?.type === "both";
    const deckPossessive = isBoth
      ? "their deck"
      : e.target?.type === "opponent" ? "opponent's deck" : "your deck";
    const subject = isBoth ? "Each player" : null;
    const hasFilter = e.filter && Object.keys(e.filter).length > 0;
    const filter = hasFilter ? renderFilter(e.filter) : "a card";
    const exerted = e.matchEnterExerted ? " and they enter play exerted" : "";
    const playVerb = e.matchPayCost ? "play it as if it were in your hand" : `play it for free${exerted}`;
    // matchIsMay drives whether the render emits "may" for play_card. Without
    // matchIsMay the engine auto-plays — render WITHOUT "may" so a missing
    // flag surfaces as an oracle-vs-JSON diff in the decompiler tail. Caught
    // the Let's Get Dangerous bug class: had matchIsMay correctly set (so no
    // rendered diff), but a similar future card forgetting the flag would now
    // show "play it for free" vs oracle "may play it for free".
    const may = e.matchIsMay ? "may " : "";
    const match = e.matchAction === "to_hand" ? "put it into your hand"
      : e.matchAction === "play_card" ? (isBoth ? `that player ${may}play${e.matchIsMay ? "" : "s"} it for free${exerted}` : `you ${may}${playVerb}`)
      : e.matchAction === "to_inkwell_exerted" ? "put it into your inkwell facedown and exerted"
      : e.matchAction ?? "keep it";
    const noMatch = e.noMatchDestination === "bottom" ? (isBoth ? "put the revealed card on the bottom of their player's deck" : "put it on the bottom of your deck")
      : e.noMatchDestination === "hand" ? "put it into your hand"
      : e.noMatchDestination === "discard" ? "put it in your discard"
      : e.noMatchDestination === "top" ? "put it on the top of your deck"
      : "put it back";
    // shuffleBefore drives the "shuffles their deck and then" prefix. Without
    // the flag the engine peeks at the existing top — render WITHOUT shuffle
    // wording so a missing flag surfaces as an oracle-vs-JSON diff. Was
    // previously hardcoded for target:both, which let the Let's Get Dangerous
    // bug class hide.
    const shufflePrefix = e.shuffleBefore
      ? (isBoth ? "shuffles their deck and then reveals" : "shuffles your deck and then reveals")
      : (isBoth ? "reveals" : "reveals");
    if (isBoth) {
      const prefix = `${subject} ${shufflePrefix} the top card. ${subject}`;
      if (!hasFilter) return `${prefix} ${match}. Otherwise, ${noMatch}`;
      return `${prefix} who reveals ${filter} ${match}. Otherwise, ${noMatch}`;
    }
    // When filter is empty (Kristoff's Lute — match ANY revealed card),
    // skip the "If it's X" clause and just say "reveal ... and do Y."
    const singleRevealVerb = e.shuffleBefore ? "shuffle your deck and reveal" : "reveal";
    if (!hasFilter) {
      return `${singleRevealVerb} the top card of ${deckPossessive}. ${cap(match)}. Otherwise, ${noMatch}`;
    }
    return `${singleRevealVerb} the top card of ${deckPossessive}. If it's ${filter}, ${match}. Otherwise, ${noMatch}`;
  },
  search: (e) => {
    const filter = e.filter ? renderFilter(e.filter) : "a card";
    // From-discard paths: Black Cauldron (under_self), basic return-to-hand, etc.
    if (e.zone === "discard") {
      if (e.putInto === "under_self") return `put ${filter} from your discard under this item faceup`;
      return `return ${filter} from your discard to your hand`;
    }
    const dest = e.putInto === "deck" && e.position === "top"
      ? ". Shuffle your deck and put that card on top of it"
      : e.putInto === "hand" ? " and put it into your hand" : "";
    return `search your deck for ${filter}${dest}`;
  },
  shuffle_into_deck:      (e) => {
    // It Calls Me: "shuffle them into their deck" — when target is in the
    // opponent's discard, the cards are shuffled back into THEIR (opponent's)
    // deck, not the caster's. Detect via target.filter.owner.
    const f = e.target?.filter;
    const ownerIsOpponent = f?.owner?.type === "opponent";
    const may = e.isMay ? "may " : "";
    const count = e.target?.count;
    const isUpTo = (e.isMay && count && count > 1);
    // "choose up to N cards from chosen opponent's discard and shuffle them
    // into their deck" — build phrasing from scratch for the opponent-discard
    // variant so we get the right verb ("choose...shuffle") and ownership.
    if (ownerIsOpponent && f?.zone === "discard" && count && count > 1) {
      const upto = isUpTo ? "up to " : "";
      return `${may ? "" : ""}choose ${upto}${count} cards from chosen opponent's discard and shuffle them into their deck`;
    }
    const dest = ownerIsOpponent ? "their deck" : "your deck";
    return `${may}shuffle ${renderTarget(e.target ?? {})} into ${dest}`;
  },
  put_into_inkwell: (e) => {
    const exerted = e.enterExerted ? " facedown and exerted" : " facedown";
    // Perdita QUICK, EVERYONE HIDE: "put all Puppy character cards from your
    // discard into your inkwell" — mass move via target:{type:"all", filter}.
    if (e.target?.type === "all") {
      const filt = e.target.filter ? renderFilter(e.target.filter) : "cards";
      return `${maybe(e)}put all ${filt} into your inkwell${exerted}`;
    }
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
    // Voyage: character "all" + maxCount:N → "up to N characters" (the
    // "all" target would otherwise render as the entire set).
    let who: string;
    if (e.character?.type === "all" && e.character.maxCount) {
      const filt = e.character.filter ? pluralizeFilter(renderFilter(e.character.filter, { suppressOwnerSelf: true })) : "characters";
      const qual = e.character.filter?.owner?.type === "self" ? "of yours " : "";
      who = `up to ${e.character.maxCount} ${filt} ${qual}`.trimEnd();
    } else {
      who = e.character ? renderTarget(e.character) : "this character";
    }
    const where = e.location ? renderTarget(e.location) : "a location";
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
    const tgt = renderTarget(e.target ?? { type: "this" });
    // chargesPerTurn variant: "the first time X would take damage, X takes
    // no damage instead" (Shield, Resilient etc.).
    if (e.chargesPerTurn) {
      return `the first time ${tgt} would take damage, ${tgt} takes no damage instead`;
    }
    // source: "non_challenge" → "can't be dealt damage unless [they're]
    // being challenged" (Hercules Mighty Leader EVER VIGILANT / VALIANT).
    // source: "challenge" → "can't be damaged from challenges" (Mulan
    // Standing Her Ground FLOWING BLADE, Dodge).
    if (e.source === "non_challenge") return `${tgt} can't be dealt damage unless they're being challenged`;
    if (e.source === "challenge") return `${tgt} can't be damaged from challenges`;
    // Default: no source qualifier means "can't be dealt damage" (Baloo
    // Ol' Iron Paws FIGHT LIKE A BEAR uses this oracle wording).
    return `${tgt} can't be dealt damage`;
  },
  // Turn-scoped variant (Noi Acrobatic Baby "this character can't be
  // damaged from challenges this turn").
  damage_prevention_timed: (e) => {
    const tgt = renderTarget(e.target ?? {});
    // charges:1 + timed = "next time" replacement-effect (CRD 6.5). The
    // prevention is one-shot — fires once on the next damage incident
    // within the duration window. Rapunzel Ready for Adventure ACT OF
    // KINDNESS: "until the start of your next turn, the next time they
    // would be dealt damage they take no damage instead." Oracle puts
    // the duration FIRST then the body — distinct from the standard
    // body-then-duration form ("X can't be damaged this turn").
    if (e.charges === 1) {
      const durationPrefix = e.duration ? renderDuration(e.duration) : "";
      return durationPrefix
        ? `${durationPrefix}, the next time ${tgt} would be dealt damage ${tgt} takes no damage instead`
        : `the next time ${tgt} would be dealt damage ${tgt} takes no damage instead`;
    }
    if (e.source === "challenge") return `${tgt} can't be damaged from challenges${dur(e)}`;
    return `${tgt} can't be damaged${dur(e)}`;
  },

  opponent_chooses_yes_or_no: (e) => {
    const yes = renderEffect(e.yesEffect ?? e.acceptEffect ?? {});
    const no = renderEffect(e.noEffect ?? e.rejectEffect ?? {});
    return `chosen opponent chooses YES! or NO!: YES! ${yes}. NO! ${no}`;
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
    // Despite the effect name, `position` can be "top" (Gyro Gearloose NOW
    // TRY TO KEEP UP: "Put an item card from your discard on the top of
    // your deck"). Filter can narrow the candidate pool.
    const position = e.position === "top" ? "top" : "bottom";
    const source = e.from ?? "hand";
    const filterPhrase = e.filter ? renderFilter(e.filter) : "card";
    // Deck ownership follows the target card's owner filter: "on the
    // bottom of their deck" when the target is an opposing card (Kuzco
    // Impulsive Llama "each opponent chooses one of their characters and
    // puts that card on the bottom of their deck").
    const deckPossessive = e.from === "play" && e.target?.filter?.owner?.type === "opponent"
      ? "their deck"
      : "your deck";
    const subject = e.from === "play"
      ? renderTarget(e.target ?? {})
      : `a ${filterPhrase} from your ${source}`;
    return `put ${subject} on the ${position} of ${deckPossessive}`;
  },

  // Dale Mischievous Ranger pattern: put top N of own deck into discard.
  put_top_cards_into_discard: (e) => {
    const n = e.amount ?? 1;
    // Mad Hatter's Teapot: "Each opponent puts the top card of their deck
    // into their discard." — target:opponent/both flips the deck+discard
    // possessives.
    if (e.target?.type === "opponent") return `each opponent puts the top ${n} card${plural(n)} of their deck into their discard`;
    if (e.target?.type === "both") return `each player puts the top ${n} card${plural(n)} of their deck into their discard`;
    return `${maybe(e)}put the top ${n} card${plural(n)} of your deck into your discard`;
  },

  // Mass inkwell exertion / readying. Mufasa Ruler of Pride Rock "exert all
  // cards in your inkwell". `mode` distinguishes the operation.
  mass_inkwell: (e) => {
    const tgt = renderTarget(e.target ?? { type: "self" });
    const owner = tgt === "you" ? "your"
                : tgt === "each player" ? "each player's"
                : tgt + "'s";
    if (e.mode === "exert_all") return `exert all cards in ${owner} inkwell`;
    if (e.mode === "ready_all") return `ready all cards in ${owner} inkwell`;
    if (e.mode === "return_random_to_hand") {
      const n = e.amount ?? 1;
      return `return ${n} random card${n === 1 ? "" : "s"} from ${owner} inkwell to ${owner === "your" ? "your" : "their"} hand`;
    }
    if (e.mode === "return_random_until") {
      const n = e.untilCount ?? 0;
      return `${owner === "each player's" ? "each player with" : "if you have"} more than ${n} cards in ${owner} inkwell, return cards at random from ${owner} inkwell to ${owner === "your" ? "your" : "their"} hand until ${owner === "your" ? "you have" : "they have"} ${n} cards left in ${owner} inkwell`;
    }
    return `affect all cards in ${owner} inkwell`;
  },

  // "Reveal target's hand" — Dolores Madrigal Within Earshot.
  reveal_hand: (e) => `reveal ${renderTarget(e.target ?? {}) === "you" ? "your" : "each opponent's"} hand`,

  // "Name a card, then reveal the top of your deck" — The Sorcerer's Hat.
  name_a_card_then_reveal: (e) => {
    if (e.matchAction === "return_all_from_discard") {
      return "name a card, then return all character cards with that name from your discard to your hand";
    }
    if (e.matchAction === "to_inkwell_exerted") {
      return "name a card, then reveal the top card of your deck — if it's the named card, put it into your inkwell facedown and exerted";
    }
    const lore = e.gainLoreOnHit ? ` and gain ${e.gainLoreOnHit} lore` : "";
    return `name a card, then reveal the top card of your deck — if it's the named card, put it into your hand${lore}; otherwise, put it on top of your deck`;
  },

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

  // Atomic mill + switch-on-revealed-type — Jack-jack Parr WEIRD THINGS ARE
  // HAPPENING ("put top card into discard; if character, +2 S; if action/
  // item, +2 L; if location, banish chosen character"). Each case renders
  // as "if <filter>, <effects>"; cases joined with semicolons in priority
  // order (first-match-wins).
  reveal_top_switch: (e) => {
    const maybe = e.isMay ? "you may " : "";
    const destVerb =
      (e.destination ?? "discard") === "discard" ? "put the top card of your deck into your discard"
      : (e.destination ?? "discard") === "hand" ? "look at the top card of your deck and put it into your hand"
      : (e.destination ?? "discard") === "top" ? "look at the top card of your deck"
      : "put the top card of your deck on the bottom";
    const cases = (e.cases ?? []).map((c: any) => {
      const filt = c.filter ? renderFilter(c.filter) : "card";
      const effs = (c.effects ?? []).map((sub: any) => renderEffect(sub)).join("; ");
      return `if ${filt}, ${effs}`;
    }).join("; ");
    return `${maybe}${destVerb}. ${cases}`;
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

  // Location-keyed move-cost reduction. Jolly Roger Hook's Ship: "Your Pirate
  // characters may move here for free" (amount: "all"). Sherwood Forest /
  // Outlaw Hideaway: "Your Robin Hood characters may move here for free".
  move_to_self_cost_reduction: (e) => {
    // Suppress owner:self in the inner filter — we add "your" explicitly here.
    // Otherwise we get "your your Toy character" double-prefix.
    const filt = e.filter ? renderFilter(e.filter, { suppressOwnerSelf: true }) : "characters";
    // Pluralize: "Toy character" → "Toy characters".
    const plural = pluralizeFilter(filt);
    if (e.amount === "all") return `your ${plural} may move here for free`;
    return `your ${plural} pay ${e.amount ?? 1} {I} less to move here`;
  },

  // CRD must-quest (Reckless-style restriction). Often timed.
  must_quest_if_able: (e) => `${renderTarget(e.target ?? {})} must quest if able${dur(e)}`,

  // discard_until / draw_until / fill_hand_to: COLLAPSED 2026-05-02 into the
  // `until` field on `draw` (renderer above) and `discard_from_hand` (renderer
  // wired below in the discard_from_hand branch with the until-detection
  // shortcut). One discriminator per oracle verb instead of three siblings.

  // Superseded by self_replacement (target omitted → state-based condition
  // reads state.lastDiscarded). Renderer for the unified primitive below.

  // CRD 8.4.2 / 8.10.5 drain cards-under. One renderer covers all four shapes:
  //   source=this,    destination=hand            — Alice Well-Read Whisper
  //   source=this,    destination=target_pile     — Mickey Bob Cratchit
  //   source=chosen,  destination=hand|bottom_of_deck — Come Out and Fight
  //   source=all_own, destination=inkwell         — Visiting Christmas Past
  drain_cards_under: (e) => {
    const may = e.isMay ? "you may " : "";
    const src = e.source ?? "this";
    let srcPhrase: string;
    if (src === "all_own") {
      srcPhrase = "cards from under your characters and locations";
    } else if (typeof src === "object" && src.type === "chosen") {
      srcPhrase = `all cards under chosen ${renderFilter(src.filter ?? {})}`;
    } else {
      srcPhrase = "all cards that were under this card";
    }
    const dest = e.destination;
    if (typeof dest === "object" && dest.type === "target_pile") {
      return `${may}put ${srcPhrase} under ${renderTarget(dest.target ?? {})}`;
    }
    const destPhrase =
      dest === "inkwell" ? "your inkwell"
      : dest === "bottom_of_deck" ? "the bottom of their owners' decks"
      : "your hand";
    return `${may}put ${srcPhrase} into ${destPhrase}`;
  },

  // ---- NEW: shapes added in the second pass --------------------------------

  // "This character can't sing songs" / "characters with cost N or less can't
  // challenge your characters" — self-restriction or filtered opponent
  // restriction. `restricts` is the verb; `filter` (when present) describes
  // WHO is restricted, not the target of the restriction.
  deck_rule: (e) => e.rule ?? "deck-building rule",
  prevent_damage_removal: () => "Damage counters can't be removed",
  challenge_damage_prevention: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    return `${tgt} can't be damaged from challenges`;
  },
  all_hand_inkable: () => "All cards in your hand count as having {IW}",
  grant_triggered_ability: (e) => {
    const tgt = renderTarget(e.target ?? {});
    // Render the inner ability text inside quotes so the oracle comparison
    // sees the full granted text. Megara Secret Keeper I'LL BE FINE: oracle
    // says 'and gains "Whenever this character is challenged, each opponent
    // chooses and discards a card."'.
    if (e.ability) {
      const inner = renderAbility(e.ability);
      return `${tgt} ${verbS(tgt, "gain", "gains")} "${inner}"`;
    }
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
  // Maui Soaring Demigod IN MA BELLY: "loses Reckless this turn" — timed
  // keyword suppression via suppress_keyword TimedEffect.
  remove_keyword_target: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} ${verbS(tgt, "lose", "loses")} ${cap(e.keyword ?? "keyword")}${dur(e)}`;
  },
  sing_cost_bonus_characters: (e) => {
    const tgt = renderTarget(e.target ?? {});
    return `${tgt} count as having +${e.amount ?? 1} cost to sing songs`;
  },

  action_restriction: (e) => {
    const verb = e.restricts === "sing" ? "exert to sing songs"
      : e.restricts === "be_challenged" ? "be challenged"
      : e.restricts === "play" ? "play"
      : e.restricts ?? "act";
    if (e.filter) {
      // Prepend "opposing" / "your" prefix if filter doesn't already include
      // ownership. Vincenzo Santorini NEUTRALIZE: filter=items, affectedPlayer=
      // opponent → "Opposing items can't ready". Mor'du Savage Cursed Prince
      // ROOTED BY FEAR: filter=characters not named Mor'du, affectedPlayer=
      // self → "Your characters not named Mor'du can't ready".
      let who = renderFilter(e.filter);
      // For restricts:"challenge"/"quest", the filter implicitly applies to
      // characters (only characters challenge or quest). When the filter
      // lacks an explicit cardType, swap the default "card" noun for
      // "character" so we don't render "Opposing cards with cost 2 or less
      // can't challenge" (Gantu Galactic Federation Captain UNDER ARREST).
      if ((e.restricts === "challenge" || e.restricts === "quest") && !e.filter.cardType) {
        who = who.replace(/\bcards?\b/, "character");
      }
      const fOwner = e.filter?.owner?.type;
      // "challenge" is the only verb that takes a target-side suffix
      // (challenges are relational). Other verbs (ready/quest/sing/play)
      // don't — pre-fix this renderer was emitting "your characters" on
      // them, producing nonsense like "item can't ready your characters".
      const challengeSuffix = (e.restricts === "challenge" && e.affectedPlayer?.type === "opponent")
        ? " your characters"
        : "";
      // When the verb suffix already carries possessive "your characters",
      // oracle drops the "Opposing" prefix because the contrast is implicit
      // (King of Hearts OBJECTIONABLE STATE: "Damaged characters can't
      // challenge your characters." not "Opposing damaged characters...").
      const skipOpposingPrefix = challengeSuffix.length > 0;
      if (e.affectedPlayer?.type === "opponent" && fOwner !== "opponent" && !skipOpposingPrefix) {
        who = `Opposing ${who}`;
      } else if (e.affectedPlayer?.type === "self" && fOwner !== "self") {
        who = `Your ${who}`;
      }
      // Capitalize the first letter when "Opposing"/"Your" prefix is absent
      // and the rendered filter starts with a lowercase noun ("damaged
      // characters" → "Damaged characters").
      if (/^[a-z]/.test(who)) who = who.charAt(0).toUpperCase() + who.slice(1);
      // Ready-restriction timing: oracle convention adds "at the start of
      // their/your turn(s)" because ready only happens then (Vincenzo
      // Santorini NEUTRALIZE: "Opposing items can't ready at the start of
      // their players' turns"; Mor'du Savage Cursed Prince ROOTED BY FEAR:
      // "Your characters not named Mor'du can't ready at the start of your
      // turn"). Anchor to whose turn fires the restriction.
      const readyTimingSuffix = e.restricts === "ready"
        ? (e.affectedPlayer?.type === "opponent" ? " at the start of their players' turns"
          : e.affectedPlayer?.type === "self" ? " at the start of your turn"
          : "")
        : "";
      return `${pluralizeFilter(who)} can't ${verb}${challengeSuffix}${readyTimingSuffix}`;
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
    // Minnie Mouse Daring Defender / The Dodo Outlandish Storyteller:
    // "this character gets +1 {S} for each 1 damage on her/him".
    // `countSelfDamage: true` counts the source card's damage counters
    // rather than matching a CardFilter.
    if (e.countSelfDamage) {
      return `${tgt} ${verbS(tgt, "get", "gets")} +${per} ${stat} for each ${per === 1 ? "1" : per} damage on ${tgt === "this character" ? "them" : tgt}`;
    }
    // Wreck-it Ralph Raging Wrecker POWERED UP / Flynn Rider canary:
    // "+1 {S} for each card under him" — CRD 8.4.2 cardsUnder count.
    if (e.countCardsUnderSelf) {
      return `${tgt} ${verbS(tgt, "get", "gets")} +${per} ${stat} for each card under ${tgt === "this character" ? "them" : tgt}`;
    }
    const cf = e.countFilter;
    // Owner-aware "where" phrase. Default is "you have in play".
    // For opponent zones: "in opponents' hands" (Sisu Emboldened Warrior
    // SURGE OF POWER), "in your opponents' discards", etc.
    const isOpp = cf?.owner?.type === "opponent";
    let where = "you have in play";
    if (cf?.zone === "hand") where = isOpp ? "in opponents' hands" : "in your hand";
    else if (cf?.zone === "discard") where = isOpp ? "in opponents' discards" : "in your discard";
    else if (cf?.zone === "inkwell") where = isOpp ? "in opponents' inkwells" : "in your inkwell";
    else if (isOpp) where = "an opponent has in play";
    // For owner-only filters (no other discriminators), the natural English
    // is "for each card in opponents' hands" (no need to render the noun).
    // Detect this and emit "card" as a generic count noun.
    const cfCopy = cf ? { ...cf } : undefined;
    if (cfCopy) {
      delete cfCopy.owner;
      delete cfCopy.zone;
    }
    const remainingKeys = cfCopy ? Object.keys(cfCopy).filter(k => cfCopy[k] !== undefined) : [];
    const filt = remainingKeys.length === 0 ? "card" : (cf ? renderFilter(cf, { suppressOwnerSelf: true }) : "card");
    return `${tgt} ${verbS(tgt, "get", "gets")} +${per} ${stat} for each ${filt} ${where}`;
  },

  // cost_reduction: handled in main EFFECT_RENDERERS above (renders as "for the next X")

  // "Characters with cost N or less can't challenge this character"
  cant_be_challenged: (e) => {
    const locScope = locationScopeRewrite(e.target);
    if (locScope.tgt && !e.attackerFilter) {
      // Tiana's Palace NIGHT OUT: "Characters can't be challenged while here."
      return `${locScope.tgt} can't be challenged${locScope.suffix}`;
    }
    const tgt = renderTarget(e.target ?? { type: "this" });
    const targetIsThis = !e.target || e.target.type === "this";
    // Oracle voice for target=this + attackerFilter is inconsistent (Mr. Big
    // REPUTATION uses passive "This character can't be challenged by..."
    // while Captain Hook STOLEN DUST and Ed Hysterical Partygoer use active
    // "Characters with X can't challenge this character"). We pick passive
    // ONLY for hasTrait filters that name a faction ("Pirate characters",
    // Captain Amelia DRIVELING GALOOTS) — for everything else, default to
    // active voice which matches the majority of cards.
    const usesPassive = targetIsThis && !!e.attackerFilter?.hasTrait;
    if (e.attackerFilter) {
      // Strip cardType:character from the filter copy so we don't render
      // "Pirate character" (we'll add "characters" suffix ourselves).
      // Pluralize the resulting filter render and capitalize the first
      // letter. Cases:
      //   - filter: { cardType:[character] } → "Characters" (with no
      //     qualifier following) — but we need "with cost N" or whatever.
      //   - filter: { cardType:[character], hasTrait:"Pirate" } → "Pirate
      //     characters can't challenge" (Captain Amelia DRIVELING GALOOTS).
      //   - filter: { cardType:[character], statComparisons:[cost lte 2] } →
      //     "Characters with cost 2 or less can't challenge" (Gantu Galactic
      //     Federation Captain UNDER ARREST).
      //   - filter: { hasDamage:true } → "Damaged characters can't challenge"
      //     (Ed Hysterical Partygoer ROWDY GUEST).
      const af = renderFilter(e.attackerFilter);
      // Replace "card"/"cards" or "character"/"characters" noun with the
      // plural "characters", then capitalize.
      const swapped = af.replace(/\bcards?\b/, "characters").replace(/\bcharacter\b/, "characters");
      // Passive voice for stat-comparison filters (Mr. Big REPUTATION:
      // "This character can't be challenged by characters with 2 {S} or
      // greater"). Active voice otherwise (Ed Hysterical Partygoer:
      // "Damaged characters can't challenge this character"; Gantu UNDER
      // ARREST: "Pirate characters can't challenge your characters").
      if (usesPassive) {
        return `${tgt} can't be challenged by ${swapped}`;
      }
      const capped = swapped.charAt(0).toUpperCase() + swapped.slice(1);
      return `${capped} can't challenge ${tgt}`;
    }
    return `${tgt} can't be challenged`;
  },

  // CRD 6.5.6 self-replacement. Three dispatch modes:
  //   - target set + CardFilter condition: "Chosen X gets +2. If Villain, +3 instead" (Vicious Betrayal).
  //   - no target + Condition (has `type`): "Gain 2. If you have 10 {S} in play, gain 5 instead" (Turbo).
  //   - no target + CardFilter: "Deal 1. If a Pirate was discarded, 3 instead" (Kakamora).
  self_replacement: (e) => {
    const def = (e.effect ?? []).map(renderEffect).join(" and ");
    const alt = (e.instead ?? []).map(renderEffect).join(" and ");
    const condFilterTrivial = !e.condition || Object.keys(e.condition).length === 0;

    if (!e.target) {
      // Condition (game-state check) vs CardFilter (lastDiscarded).
      const isCondition = e.condition && typeof e.condition === "object" && typeof e.condition.type === "string";
      if (isCondition) {
        const cond = renderCondition(e.condition);
        return def ? `${cond}, ${alt}; otherwise ${def}` : `${cond}, ${alt}`;
      }
      const filt = e.condition ? renderFilter(e.condition) : "matching";
      return def
        ? `if the discarded card was a ${filt}, ${alt}; otherwise ${def}`
        : `if the discarded card was a ${filt}, ${alt}`;
    }

    const tgt = renderTarget(e.target);
    // Degenerate: trivial condition + no default. Used as a "chain effects
    // against a chosen target" pattern (Dinner Bell pinning last_resolved_target).
    if (condFilterTrivial && (!e.effect || e.effect.length === 0)) {
      // Inline-stat-ref pattern: when the alt is a single gain_lore /
      // gain_stats / deal_damage with a `stat_ref` amount from
      // `target` (= the target chosen by this self_replacement), oracle
      // wording inlines the reference: "gain lore equal to <chosen X>'s
      // {L}" (Pocahontas Following the Wind WHAT IS MY PATH?). Without
      // this, the renderer emits "choose <X> — you gain lore equal to
      // their {L}" which scores poorly against the inline oracle text.
      const altList = (e.instead ?? []) as Json[];
      if (altList.length === 1) {
        const alone = altList[0]!;
        const isStatRefFromTarget = alone?.amount
          && typeof alone.amount === "object"
          && alone.amount.type === "stat_ref"
          && alone.amount.from === "target";
        if (isStatRefFromTarget) {
          const prop = alone.amount.property ?? "lore";
          const sym = prop === "lore" ? "{L}" : prop === "willpower" ? "{W}" : prop === "strength" ? "{S}" : prop;
          if (alone.type === "gain_lore") return `gain lore equal to ${tgt}'s ${sym}`;
          if (alone.type === "deal_damage") {
            const dmgTgt = alone.target ? renderTarget(alone.target) : "this character";
            return `deal damage to ${dmgTgt} equal to ${tgt}'s ${sym}`;
          }
        }
      }
      // Dinner Bell YOU KNOW WHAT HAPPENS: draw stat_ref(target.damage) +
      // banish(last_resolved_target). Oracle: "Draw cards equal to the
      // damage on chosen character of yours, then banish them." Detect
      // the draw+banish-chain shape and inline.
      if (altList.length === 2) {
        const [first, second] = altList;
        const isStatRefDraw = first?.type === "draw"
          && typeof first.amount === "object"
          && first.amount?.type === "stat_ref"
          && first.amount.from === "target"
          && first.amount.property === "damage";
        const isBanishLastTarget = second?.type === "banish"
          && second.target?.type === "last_resolved_target";
        if (isStatRefDraw && isBanishLastTarget) {
          return `draw cards equal to the damage on ${tgt}, then banish them`;
        }
      }
      return alt ? `choose ${tgt} — ${alt}` : `choose ${tgt}`;
    }
    // Condition (has `type` field) vs CardFilter (no type field) — when
    // the condition is a game-state check (Terror That Flaps in the Night:
    // `has_character_named` "If you have a character named Darkwing Duck
    // in play"), render it as a condition and emit oracle wording without
    // the "If a X is chosen" filter-on-target form.
    const isStateCondition = e.condition && typeof e.condition === "object" && typeof e.condition.type === "string";
    if (isStateCondition) {
      const condText = renderCondition(e.condition);
      // Seven Dwarfs' Mine / Winter Camp Medical Tent: triggering_card
      // target uses "If they're a Knight, X instead" form.
      if (e.target.type === "triggering_card") {
        return `${def}. ${cap(condText)}, ${alt} instead`;
      }
      // Default: "Deal 2 damage to chosen X. If <state-cond>, deal 3 instead."
      const tgtMain = `${def.replace(/this character/, tgt)}`;
      return `${tgtMain}. ${cap(condText)}, ${alt} instead`;
    }
    const cond = e.condition ? renderFilter(e.condition) : "matching";
    // Seven Dwarfs' Mine / Winter Camp Medical Tent: when target is
    // triggering_card the default branch already operates on the moved
    // character — "X. If they're a Knight, Y instead."
    if (e.target.type === "triggering_card") {
      return `${def}. If they're ${cond.startsWith("a ") || cond.startsWith("an ") ? cond : "a " + cond}, ${alt} instead`;
    }
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

  // Dale SPIKE SUIT: "During challenges, your characters deal damage with
  // their {W} instead of their {S}." Game-rule modifier swapping the
  // CRD 4.6.6 damage-source stat for affected players' characters.
  challenge_damage_stat_source: (e) => {
    const stat = e.stat === "willpower" ? "{W}" : "{S}";
    const otherStat = e.stat === "willpower" ? "{S}" : "{W}";
    const scope = e.affectedPlayer === "opponent" ? "opposing characters"
      : e.affectedPlayer === "both" ? "all characters"
      : "your characters";
    return `during challenges, ${scope} deal damage with their ${stat} instead of their ${otherStat}`;
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
    const locScope = locationScopeRewrite(e.target);
    const tgt = locScope.tgt ?? renderTarget(e.target ?? {});
    const inner = e.ability ? renderAbility(e.ability) : "[no-ability]";
    // Drop the "you " prefix from inner cost-reward bodies — when a granted
    // activated ability's reward is "you gain 1 lore", oracle elides the
    // pronoun: "{E} — Gain 1 lore." (Cogsworth Talking Clock WAIT A MINUTE,
    // The Great Illuminary STARTLING DISCOVERY). The carrier is the
    // implicit subject inside the granted ability's quotes. Also
    // capitalize the verb that follows " — " (sentence start inside quotes).
    const cleaned = inner
      .replace(/ — you /g, " — ")
      .replace(/ — ([a-z])/g, (_m, c) => ` — ${c.toUpperCase()}`);
    return `${tgt} ${verbS(tgt, "gain", "gains")} "${cleaned}"${locScope.suffix}`;
  },

  // "Whenever one of your other characters would be dealt damage, put that
  // many damage counters on this character instead."
  damage_redirect: (e) => {
    const from = e.from ? renderTarget(e.from) : "another character";
    return `whenever ${from} would be dealt damage, put that damage on this character instead`;
  },

  // "This character can challenge ready characters." — used as a static
  // (permanent) and now also as a timed action effect when `duration` is
  // set (One Last Hope Hero clause: "they can also challenge ready
  // characters this turn"). Render the duration when present.
  can_challenge_ready: (e) => {
    const tgt = renderTarget(e.target ?? { type: "this" });
    const d = dur(e);
    if (d) return `${tgt} can also challenge ready characters${d}`;
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

  // Candy Drift / She's Your Person: install a delayed-trigger on a
  // chosen target. firesAt:"end_of_turn" + attachTo:"last_resolved_target"
  // → "At the end of your turn, banish them." (the target is the chosen
  // character from the previous effect).
  create_delayed_trigger: (e) => {
    const when = e.firesAt === "end_of_turn" ? "At the end of your turn"
      : e.firesAt === "start_of_next_turn" ? "At the start of your next turn"
      : `At ${e.firesAt}`;
    const body = (e.effects ?? []).map((f: Json) => {
      // Inside delayed-trigger effects, `target: this` refers to the attached
      // target (typically last_resolved_target — the chosen character).
      const rewritten = f?.target?.type === "this" && e.attachTo === "last_resolved_target"
        ? { ...f, target: { type: "__pronoun_they" } }
        : f;
      return renderEffect(rewritten);
    }).join(" and ");
    return `${when}, ${body}`;
  },

  // Action cards installing a one-turn trigger ("Whenever ... this turn, ...")
  create_floating_trigger: (e) => {
    const head = renderTrigger(e.trigger ?? {});
    const body = (e.effects ?? []).map(renderEffect).join(", and ");
    // attachTo:"chosen" / "all_matching" → Oracle wraps the floating trigger
    // as a granted ability: 'X gains "<trigger>, <body>" this turn.'
    // Bruno Madrigal Out of the Shadows / Forest Duel / Magical Aid.
    if (e.attachTo === "chosen") {
      const filt = e.targetFilter ? renderFilter(e.targetFilter) : "character";
      return `chosen ${filt} gains "${head}, ${body}" this turn`;
    }
    if (e.attachTo === "all_matching") {
      const filt = e.targetFilter ? pluralizeFilter(renderFilter(e.targetFilter)) : "characters";
      return `${filt} gain "${head}, ${body}" this turn`;
    }
    if (e.attachTo === "last_resolved_target") {
      return `they gain "${head}, ${body}" this turn`;
    }
    return `${head} this turn, ${body}`;
  },

  // ---- Batch additions from decompiler review (30 missing renderers) --------

  // conditional_on_player_state: folded into self_replacement (target omitted,
  // condition is a Condition). Renderer handled in the self_replacement case.
  opponent_may_pay_to_avoid: (e) => {
    const accept = renderEffect(e.acceptEffect ?? {});
    const reject = renderEffect(e.rejectEffect ?? {});
    // Subject phrasing depends on the rejectEffect's referent:
    //   - rejectEffect.target = triggering_card (Tiana Restaurant Owner
    //     SPECIAL RESERVATION): "unless their player pays 3 {I}" — refers
    //     to the triggering character's player, oracle uses "their".
    //   - otherwise (Hades Looking for a Deal — chooser-pinned
    //     last_resolved_target): "unless that character's player puts that
    //     card on the bottom of their deck" — refers to the chosen
    //     character's player.
    const refIsTriggering = e.rejectEffect?.target?.type === "triggering_card";
    const subject = refIsTriggering ? "their player" : "that character's player";
    let acceptFixed = accept
      .replace(/^put /, "puts ")
      .replace(/^pay /, "pays ")
      .replace(/^banish /, "banishes ")
      .replace(/^discard /, "discards ")
      .replace(/\byour deck\b/, "their deck")
      .replace(/\bthat character\b/, "that card");
    return `${reject} unless ${subject} ${acceptFixed}`;
  },
  each_player: (e) => {
    // The inner effects run with the iteration player as "self" — rewrite
    // first-person wording to third-person so "you lose 1 lore" becomes
    // "they lose 1 lore" when appearing under an each_player wrapper.
    // When `isMay` is set, the each_player emits "each player MAY <inner>"
    // — `may` is a modal verb that takes the BASE form, not -s. So under
    // isMay, skip the verb-S agreement (Amethyst Chromicon AMETHYST LIGHT:
    // "Each player may draw a card" not "Each player may draws a card").
    const verbS = e.isMay ? "draw" : "draws";
    const verbS_lose = e.isMay ? "lose" : "loses";
    const verbS_gain = e.isMay ? "gain" : "gains";
    const verbS_choose_discard_token = (n: string) => e.isMay
      ? `choose and discard ${n} card${n === "1" ? "" : "s"}`
      : `chooses and discards ${n} card${n === "1" ? "" : "s"}`;
    const verbS_put = e.isMay ? "put" : "puts";
    const rewriteInnerPerspective = (s: string): string =>
      s
        // Oracle wording for "each X: Y" in Lorcana is third-person-singular
        // ("each opponent loses 2 lore", not "each opponent: they lose 2 lore").
        // Rewrite "you VERB" → "VERBs" for common verbs that appear under
        // each_player bodies via target:self inner effects.
        .replace(/\byou draw\b/g, verbS)
        .replace(/\byou lose\b/g, verbS_lose)
        .replace(/\byou gain\b/g, verbS_gain)
        // Self-target effects render bare verbs ("draw a card", "may draw")
        // without "you" subject — under each_player, prepend verb-S.
        // Show Me More! (each_player → draw target:self) was producing
        // "each player draw 3 cards" missing the verb-S.
        .replace(/^draw\b/g, verbS)
        .replace(/(\b(?:and|then|or)\s+)draw\b/g, `$1${verbS}`)
        .replace(/\byour hand\b/g, "their hand")
        .replace(/\byour deck\b/g, "their deck")
        .replace(/\byour inkwell\b/g, "their inkwell")
        // "discard N card(s)" becomes "chooses and discards N card(s)" —
        // under each_player the iteration player picks their own discard
        // (matches oracle wording: "each opponent chooses and discards").
        .replace(/\bdiscard (\d+) cards?\b/g, (_, n) => verbS_choose_discard_token(n))
        .replace(/\bdiscard their hand\b/g, e.isMay ? "discard their hand" : "discards their hand")
        // "chosen X of yours" → "chosen X" under each_player (no longer the
        // caster's own — each iteration owns its picks). Falling Down the
        // Rabbit Hole: "chooses one of their characters".
        .replace(/\bchosen ([a-z]+) of yours\b/g, "chosen $1")
        // "put X into" verb-agrees with the singular "each player" subject.
        .replace(/\bput ([a-z ]+) into their\b/g, `${verbS_put} $1 into their`);
    let inner = Array.isArray(e.effects)
      ? rewriteInnerPerspective(e.effects.map(renderEffect).join(" and "))
      : "[no effects]";
    // CRD reveal-on-play: when the inner is a single `play_card` with
    // `revealed: true`, oracle uses the "reveal a X card from their hand and
    // play it for free" idiom (The Return of Hercules — non-active player
    // plays a chosen character from a private zone outside the normal
    // main-phase action structure). The flag is the source of truth — it
    // documents the CRD timing-exception semantic in the wiring.
    if (Array.isArray(e.effects)
        && e.effects.length === 1
        && e.effects[0]?.type === "play_card"
        && e.effects[0]?.revealed === true) {
      const filt = (e.effects[0] as Json).filter;
      const types: string[] = Array.isArray(filt?.cardType) ? filt.cardType : filt?.cardType ? [filt.cardType] : [];
      const cardWord = types.length === 1 ? `${types[0]} card` : "card";
      inner = `reveal a ${cardWord} from their hand and play it for free`;
    }
    // scope:"chosen_subset" — Beyond the Horizon BHC: "Choose any number of
    // players. They discard their hands and draw 3 cards each." The caster
    // picks the subset; the chosen players ("they", plural) run the inner
    // effects. Inner verbs need plural-subject agreement ("their hands"
    // for amount:"all" discard) and a trailing "each" qualifier when the
    // count is plural.
    if (e.scope === "chosen_subset") {
      // Pluralize "their hand" → "their hands" since "they" is plural.
      // Add "each" suffix to the draw clause to match printed wording.
      const inner2 = inner
        .replace(/\bdiscards their hand\b/g, "discard their hands")
        .replace(/\bdiscard their hand\b/g, "discard their hands")
        .replace(/\bdraws (\d+ cards?)\b/g, "draw $1 each")
        .replace(/^draw (\d+ cards?)\b/, "draw $1 each");
      return `Choose any number of players. They ${inner2}`;
    }
    const scope = e.scope === "opponents" ? "each opponent" : "each player";
    const filter = renderPlayerFilter(e.filter);
    const subject = filter ? `${scope} ${filter}` : scope;
    return e.isMay ? `${subject} may ${inner}` : `${subject} ${inner}`;
  },
  prevent_discard_from_hand: () => "if an effect would cause you to discard one or more cards from your hand, you don't discard",
  inkwell_enters_exerted: () => "cards added to inkwell enter exerted",
  remember_chosen_target: (e) => `choose ${e.filter ? renderFilter(e.filter) : "a character"}`,
  restrict_play: (e) => {
    const who = e.affectedPlayer?.type === "opponent" ? "opponents" : "you";
    const types = (e.cardTypes ?? []);
    const list = types.length === 1
      ? `${types[0]}s`
      : types.length === 2
        ? `${types[0]}s or ${types[1]}s`
        : `${types.slice(0, -1).map((t: string) => `${t}s`).join(", ")}, or ${types[types.length - 1]}s`;
    // Restriction auto-clears on the caster's next turn (reducer handles it).
    return `${who} can't play ${list} until the start of your next turn`;
  },
  return_all_to_bottom_in_order: (e) => `put all ${e.filter ? renderFilter(e.filter) : "characters"} on the bottom of their players' decks`,
  modify_win_threshold: (e) => `${e.affectedPlayer?.type === "opponent" ? "opponents" : "you"} need ${e.newThreshold ?? "?"} lore to win`,
  stat_floor_printed: (e) => `${renderTarget(e.target ?? {})} ${e.stat ?? "strength"} can't be reduced below printed value`,
  ink_from_discard: () => "you can ink cards from your discard",
  restrict_remembered_target_action: (e) => `remembered target can't ${e.action ?? "act"}`,
  banish_item: (e) => `${maybe(e)}banish ${renderTarget(e.target ?? {})}`,
  sing_cost_bonus_here: (e) => `characters here count as having +${e.amount ?? 0} cost to sing songs`,
  choose_n_from_opponent_discard_to_bottom: (e) => {
    const base = `choose ${e.count ?? "?"} cards from chosen opponent's discard and put them on the bottom of their deck`;
    // The Queen Jealous Beauty NO ORDINARY APPLE: "...to gain 3 lore. If any
    // Princess cards were moved this way, gain 4 lore instead."
    if (e.gainLoreBase !== undefined) {
      const baseLore = ` to gain ${e.gainLoreBase} lore`;
      if (e.gainLoreBonus !== undefined && e.bonusFilter) {
        const filt = renderFilter(e.bonusFilter);
        return `${base}${baseLore}. If any ${filt} cards were moved this way, gain ${e.gainLoreBonus} lore instead`;
      }
      return `${base}${baseLore}`;
    }
    return base;
  },
  gets_stat_while_challenging: (e) => `your characters get +${e.strength ?? 0} {S} while challenging ${e.defenderFilter ? renderFilter(e.defenderFilter) : "a character"}${dur(e)}`,
  grant_extra_ink_play: (e) => `you may play ${e.amount ?? 1} additional ink this turn`,
  put_self_under_target: (e) => `put this card under ${e.filter ? renderFilter(e.filter) : "a character"}`,
  sing_cost_bonus_target: (e) => `${renderTarget(e.target ?? {})} counts as having +${e.amount ?? 0} cost to sing songs${dur(e)}`,
  reveal_hand: (e) => {
    if (e.target?.type === "chosen") return "chosen player reveals their hand";
    if (e.target?.type === "self") return "reveal your hand";
    if (e.target?.type === "both") return "each player reveals their hand";
    return "each opponent reveals their hand";
  },
  // Private reveal — controller sees target's hand without exposing it to
  // other players. Dolores Madrigal NO SECRETS.
  look_at_hand: (e) => {
    if (e.target?.type === "chosen") return "look at chosen player's hand";
    if (e.target?.type === "self") return "look at your hand";
    return "look at chosen opponent's hand";
  },
  top_of_deck_visible: (e) => {
    if (e.affectedPlayer?.type === "both") return "each player plays with the top card of their deck face up";
    if (e.affectedPlayer?.type === "opponent") return "opponents play with the top card of their deck face up";
    return "you play with the top card of your deck face up";
  },
  each_target: (e) => {
    const inner = Array.isArray(e.effects)
      ? e.effects.map(renderEffect).filter(Boolean).join(" and ")
      : "[no effects]";
    const min = e.minCount;
    const key = e.source?.key;
    if (key === "lastSongSingerIds") {
      if (min) return `if ${min} or more characters sang this song, for each of them, ${inner}`;
      return `for each character that sang this song, ${inner}`;
    }
    return `for each target, ${inner}`;
  },
  // Arthur Determined Squire NO MORE BOOKS: oracle wording is "Skip your
  // turn's Draw step." (imperative form, no "you" subject — the carrying
  // character is the implicit subject of a static).
  skip_draw_step_self: () => "skip your turn's draw step",
  one_challenge_per_turn_global: () => "each turn, only one character can challenge",
  prevent_lore_loss: () => "you can't lose lore",
  forced_target_priority: () => "opponents must choose this character for actions and abilities if able",
  remove_named_ability: () => "remove a named ability from matching characters",
  classification_shift_self: (e) => `${e.trait ?? "?"} Shift`,
  can_quest_turn_played: () => "this character can quest the turn they're played",
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
  // doesn't drop the conditional gating. Skip for self_replacement and
  // play_card — they handle their own condition routing internally and
  // self_replacement uses `condition: {}` as a "no-condition" sentinel meaning
  // "always trigger the instead path" (Lucky Dime, Magica De Spell, Dinner Bell).
  if (e.condition && e.condition.type && e.type !== "self_replacement") {
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

/** Join an effect list into Lorcana-idiomatic prose. Default separator is
 *  ", and "; when the next effect follows a draw + self-discard pattern
 *  (Cobra Bubbles Former CIA THINK ABOUT WHAT'S BEST: "Draw a card, then
 *  choose and discard a card."), use "then" instead of "and" because the
 *  second clause is a sequenced action ("draw THEN discard" not "draw AND
 *  discard"). Also handles the deal_damage → deal_damage and the
 *  draw_card → choose_discard patterns. */
function joinEffects(effects: Json[]): string {
  // Pair detection pre-pass: collapse [no-op-chooser gain_stats, opponent_may_
  // pay_to_avoid] into a single "you may choose X. If you do, <body>" render
  // BEFORE the empty-filter step (the no-op chooser renders to "" which would
  // otherwise drop it from the output). Hades Looking for a Deal WHAT D'YA
  // SAY?: "you may choose an opposing character. If you do, draw 2 cards
  // unless that character's player puts that card on the bottom of their
  // deck."
  const isNoOpChooser = (e: Json | undefined): boolean =>
    !!e
    && e.type === "gain_stats"
    && (e.strength === 0 || e.strength === undefined)
    && (e.willpower === 0 || e.willpower === undefined)
    && (e.lore === 0 || e.lore === undefined)
    && !e.strengthDynamic && !e.willpowerDynamic && !e.loreDynamic
    && !e.followUpEffects?.length
    && (e.strength === 0 || e.willpower === 0 || e.lore === 0)
    && e.target?.type === "chosen";
  const expanded: { rendered: string; effect: Json | undefined }[] = [];
  let i = 0;
  while (i < effects.length) {
    const curr = effects[i];
    const next = effects[i + 1];
    if (isNoOpChooser(curr) && next?.type === "opponent_may_pay_to_avoid") {
      // Render the chooser surface as "you may choose X" + ". If you do, " +
      // the opponent_may_pay_to_avoid body. Skip filter-out of empty.
      const filt = (curr as Json).target?.filter;
      const filtPhrase = filt ? renderFilter(filt) : "character";
      const article = /^[aeiou]/i.test(filtPhrase) ? "an" : "a";
      // Render the inner opp_may_pay_to_avoid normally then prefix.
      const body = renderEffect(next);
      expanded.push({
        rendered: `you may choose ${article} ${filtPhrase}. If you do, ${body}`,
        effect: undefined,  // stops sequencing rules from re-applying
      });
      i += 2;
      continue;
    }
    expanded.push({ rendered: renderEffect(curr ?? {}), effect: curr });
    i++;
  }
  const rendered = expanded.filter(x => x.rendered).map(x => x.rendered);
  if (rendered.length <= 1) return rendered.join(", and ");
  const out: string[] = [rendered[0]!];
  for (let j = 1; j < rendered.length; j++) {
    const prev = expanded[j - 1]?.effect;
    const curr = expanded[j]?.effect;
    // "draw, then choose and discard" idiom — Cobra Bubbles Former CIA
    // THINK ABOUT WHAT'S BEST.
    const prevIsDraw = prev?.type === "draw";
    const currIsSelfDiscard = curr?.type === "discard_from_hand"
      && (!curr.target || curr.target.type === "self");
    if (prevIsDraw && currIsSelfDiscard) {
      out.push(`then ${rendered[j]}`);
      continue;
    }
    // "Return chosen character to their player's hand, then that player
    // discards a card at random" — We Don't Talk About Bruno. Sequencing
    // marker carries the chooser-relationship (the chosen target's owner
    // is the discard subject).
    const prevIsReturn = prev?.type === "return_to_hand";
    const currIsTargetOwnerDiscard = curr?.type === "discard_from_hand"
      && curr.target?.type === "target_owner";
    if (prevIsReturn && currIsTargetOwnerDiscard) {
      out.push(`then ${rendered[j]}`);
      continue;
    }
    out.push(`and ${rendered[j]}`);
  }
  // Re-join with ", " between segments.
  return out.join(", ");
}

/** Location-grant scope rewrite (CRD 5.4 / oracle wording).
 *  Static effects on locations targeting `{ type: "all", filter:
 *  { ..., atLocation: "this" }}` print as "Characters gain X while here."
 *  (The Great Illuminary, Bad-Anon, Tiana's Palace, Fang.) Without this,
 *  renderTarget produces "all characters here" + a static-effect verb body,
 *  which mis-renders as "all characters here gain X" — the "all" leaks and
 *  "here" appears mid-sentence. This helper drops the "all" prefix, strips
 *  the inline "here", and returns a trailing " while here" suffix the
 *  caller appends after the verb body. */
function locationScopeRewrite(target: Json | undefined): { tgt?: string; suffix: string } {
  if (!target || target.type !== "all" || target.filter?.atLocation !== "this") {
    return { suffix: "" };
  }
  // Strip atLocation:"this" and re-render the filter without the "here" bit.
  // Suppress the owner-self "your" prefix renderFilter adds — oracle wording
  // for location-grants drops the possessive entirely (Bad-Anon: "Villain
  // characters gain..." not "Your Villain characters gain..."). We add the
  // "Opposing" prefix back manually for owner:opponent locations only.
  const { atLocation: _ignored, ...rest } = target.filter;
  const filt = pluralizeFilter(renderFilter(rest, { suppressOwnerSelf: true }));
  const prefix = target.filter.owner?.type === "opponent" ? "Opposing " : "";
  const head = prefix + filt;
  const cap = head.charAt(0).toUpperCase() + head.slice(1);
  return { tgt: cap, suffix: " while here" };
}

/** Render a DynamicAmount (number or object like {type:"count",filter} or string). */
function renderAmount(a: any): string {
  if (typeof a === "number") return String(a);
  if (typeof a === "string") {
    switch (a) {
      case "last_effect_result": return "each 1 lost this way";
      case "cost_result": return "each 1 affected this way";
      // Colors of the Wind: "for each different ink type of cards revealed this way"
      case "unique_ink_types_on_top_of_both_decks": return "each different ink type of cards revealed this way";
      // Namaari Resolute Daughter: "For each opposing character banished in a challenge this turn"
      case "opposing_chars_banished_in_challenge_this_turn": return "each opposing character banished in a challenge this turn";
      // Mulan Elite Archer / Namaari Heir of Fang: "equal to the damage just dealt"
      case "last_damage_dealt": return "the damage just dealt";
      case "song_singer_count": return "the number of characters that sang this song";
      default: return a;
    }
  }
  if (typeof a === "object" && a !== null) {
    if (a.type === "count") return `the number of ${a.filter ? pluralizeFilter(renderFilter(a.filter)) : "matching cards"}`;
    // Unified stat-reference renderer — replaces the 14 per-variant cases
    // that used to live here. Dispatches on (from × property) to produce
    // oracle-approximate English.
    if (a.type === "stat_ref") {
      const statSym = a.property === "strength" ? "{S}"
        : a.property === "willpower" ? "{W}"
        : a.property === "lore" ? "{L}"
        : a.property === "cost" ? "cost"
        : a.property === "damage" ? "damage"
        : "delta";
      switch (a.from) {
        case "target":               return `their ${statSym}`;
        case "triggering_card":      return a.property === "damage" ? "the damage on them" : `their ${statSym}`;
        case "source":               return `this character's ${statSym}`;
        case "last_resolved_source": return `their ${statSym}`;
        case "last_resolved_target":
          if (a.property === "delta") return "each 1 removed this way";
          return `their ${statSym}`;
        case "last_target_location": return `the ${statSym} of that location`;
        // The Queen Disguised Peddler A PERFECT DISGUISE: "Gain lore equal
        // to the discarded character's {L}" — stat_ref from last_discarded
        // pulls the property off the most recent discard. Renderer was
        // emitting "[last_discarded.lore]" placeholder because this case
        // wasn't handled.
        case "last_discarded":       return `the discarded character's ${statSym}`;
        default:                     return `[${a.from}.${a.property}]`;
      }
    }
    if (a.type === "last_effect_result") return "the number of cards affected";
    if (a.type === "cards_under_count") return "the number of cards under this character";
    // Donald Duck Fred Honeywell WELL WISHES: "for each card that was under them"
    if (a.type === "triggering_card_cards_under_count") return "the number of cards that were under them";
    // The Headless Horseman WITCHING HOUR: "deal 2 damage for each action
    // card discarded this way" — multiplier × (count of lastDiscarded
    // matching filter).
    if (a.type === "count_last_discarded") {
      const filt = a.filter ? renderFilter(a.filter) : "card";
      const perClause = a.multiplier && a.multiplier !== 1
        ? `${a.multiplier} per ${filt} discarded this way`
        : `the number of ${pluralizeFilter(filt)} discarded this way`;
      return perClause;
    }
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
  if (target.startsWith("Opposing ") && target.endsWith("s")) return base;
  if (target.startsWith("your ") && target.endsWith("s")) return base;
  if (target.startsWith("Your ") && target.endsWith("s")) return base;
  // Sentence-start plural noun: "Characters gain..." (location grants from
  // locationScopeRewrite). Lowercase first char then check for "characters"/
  // "items"/etc. as plural subject.
  if (/^[A-Z]/.test(target) && target.endsWith("s") && !target.includes("each ") && !target.includes("this ")) {
    return base;
  }
  return third;
}

function renderStatChange(e: Json): string {
  // No-op-chooser pattern: gain_stats with all stats 0 is used to surface a
  // chooser without actually changing stats (Hades Looking for a Deal
  // WHAT D'YA SAY? — the +0 {S} pins last_resolved_target for the
  // opponent_may_pay_to_avoid that follows; Zeus Mr. Lightning Bolts
  // TARGET PRACTICE — pins for the next gain_stats stat_ref). The
  // chooser-surface phrasing ("you may choose X") only fits when the
  // following effect is a `may` shape; otherwise the chosen target is
  // referenced inline by the next effect. Suppress unconditionally —
  // composition fixes for Hades-style "you may choose" need a multi-
  // effect renderer pass that inspects the next effect's wording.
  if (e.type === "gain_stats"
      && (e.strength === 0 || e.strength === undefined)
      && (e.willpower === 0 || e.willpower === undefined)
      && (e.lore === 0 || e.lore === undefined)
      && !e.strengthDynamic && !e.willpowerDynamic && !e.loreDynamic
      && !e.followUpEffects?.length
      && (e.strength === 0 || e.willpower === 0 || e.lore === 0)) {
    return "";
  }
  let tgt = renderTarget(e.target ?? {});
  // Stat-change targets prefer singular "Each opposing X" wording, not the
  // bulk-action "all opposing X" form (Someone Will Lose His Head
  // "Each opposing character gets -2 {S}", Fix-It Felix "Each of your
  // characters gets..."). Swap "all opposing X(s)" → "each opposing X" with
  // the trailing plural stripped where simple. Action-form effects
  // (banish/return/exert) keep using "all opposing X" via renderTarget.
  if (tgt.startsWith("all opposing ")) {
    const rest = tgt.slice("all opposing ".length);
    // Strip trailing 's' on the head noun ("characters" → "character",
    // "items" → "item"). Multi-word filters like "characters with cost 2 or
    // less" need only the head noun depluralized.
    const singular = rest.replace(/^([a-z]+)s\b/, "$1");
    tgt = `each opposing ${singular}`;
  }
  const bits: string[] = [];
  // modify_stat uses stat + amount. amount can be a number OR a DynamicAmount
  // object (count-filter for "+N for each X" patterns — Mr. Incredible Super
  // Strong "this character gets +2 {S} for each other character you have in
  // play"; without this branch, the renderer emitted "[object Object]").
  if (e.stat && e.amount !== undefined) {
    const sym = e.stat === "lore" ? "{L}" : e.stat === "willpower" ? "{W}" : "{S}";
    const val = e.amount;
    if (typeof val === "object" && val !== null && val.type === "count" && val.filter) {
      const perMatch = val.perMatch ?? 1;
      const f = val.filter;
      const filt = f.owner?.type === "self"
        ? renderFilter(f, { suppressOwnerSelf: true }) + " you have in play"
        : renderFilter(f);
      bits.push(`+${perMatch} ${sym} for each ${filt}`);
    } else {
      bits.push(`${signed(val)} ${sym}`);
    }
  }
  // gain_stats uses individual stat fields
  if (e.strength !== undefined) bits.push(`${signed(e.strength)} {S}`);
  if (e.willpower !== undefined) bits.push(`${signed(e.willpower)} {W}`);
  if (e.lore !== undefined) bits.push(`${signed(e.lore)} {L}`);
  // gain_stats with a DynamicAmount (Rescue Rangers Away: "Chosen character
  // loses {S} equal to the number of characters you have in play"). The
  // `strengthDynamicNegate: true` flag flips sign for the "loses" wording.
  // Post-2026-04-24: also handles the former per-flag shortcuts
  // (strengthPerDamage / strengthPerCardInHand / strengthEqualsSource* /
  // strengthEqualsTargetWillpower) now expressed as strengthDynamic variants.
  const dyn = (stat: "strength" | "willpower" | "lore", sym: string) => {
    const key = `${stat}Dynamic`;
    const val = e[key];
    if (!val) return;
    const sign = e[`${stat}DynamicNegate`] ? "-" : "+";
    // He's A Tramp: "+1 {S} for each character you have in play" reads
    // better than "+the number of your characters {S}". Detect count
    // filter with owner:self and emit the "for each" form. Special-cases
    // the migrated Triton's Trident SYMBOL OF POWER "for each card in
    // your hand" shape (zone:hand on a count filter).
    if (typeof val === "object" && val.type === "count" && val.filter) {
      const f = val.filter;
      if (f.owner?.type === "self" && f.zone === "hand" && !f.cardType) {
        bits.push(`${sign}1 ${sym} for each card in your hand`);
        return;
      }
      const filt = f.owner?.type === "self"
        ? renderFilter(f, { suppressOwnerSelf: true }) + " you have in play"
        : renderFilter(f);
      bits.push(`${sign}1 ${sym} for each ${filt}`);
      return;
    }
    const amountPhrase = renderAmount(val);
    bits.push(`${sign}${amountPhrase} ${sym}`);
  };
  dyn("strength", "{S}");
  dyn("willpower", "{W}");
  dyn("lore", "{L}");
  // followUpEffects attach to the same chosen target, pronounized as "they"
  // (Alice Savvy Sailor AHOY!: "gets +1 {L} and gains Ward until the start
  // of your next turn").
  const followUp = Array.isArray(e.followUpEffects) && e.followUpEffects.length > 0
    ? " and " + (e.followUpEffects as Json[]).map((f) => {
        const r = renderEffect(f);
        return r.replace(/^this character /i, "they ").replace(/^they gain/i, "gain");
      }).join(" and ")
    : "";
  // "you may give chosen character +2 {S}" for isMay — Grandmother Fa-style.
  if (e.isMay) {
    return `you may give ${tgt} ${bits.join(" and ")}${dur(e)}${followUp}`;
  }
  return `${tgt} ${verbS(tgt, "get", "gets")} ${bits.join(" and ")}${dur(e)}${followUp}`;
}

// -----------------------------------------------------------------------------
// Triggered / activated / static wrappers — small dispatchers around the
// pattern tables above.
// -----------------------------------------------------------------------------
function renderTriggered(ab: Json, ctx?: { cardType?: string }): string {
  // Enter-play-with-damage pattern: enters_play trigger + single
  // deal_damage target:this with a fixed number. Oracle phrasing is
  // "This character enters play with N damage." (Mulan - Injured Soldier,
  // Fa Zhou - Honorable Warrior's BATTLE WOUND).
  const effects = ab.effects ?? [];
  if (ab.trigger?.on === "enters_play" && !ab.condition && effects.length === 1) {
    const e = effects[0];
    if (e?.type === "deal_damage"
        && e.target?.type === "this"
        && typeof e.amount === "number"
        && !e.followUpEffects?.length
        && !e.asPutDamage) {
      return `This character enters play with ${e.amount} damage`;
    }
    // "May enter play exerted to <reward>" idiom: enters_play trigger +
    // single sequential effect with isMay + costEffects=[exert this] +
    // rewardEffects. Oracle wording is "This character may enter play
    // exerted to <reward>" (Lord Dingwall FIGHTIN' TALK; Lord Macintosh
    // CHARGING BOAR; many Brave-set ENTRY-payoff designs). Without this
    // shape the renderer falls through to "When you play this character,
    // you may exert this character to ..." which scores poorly.
    if (e?.type === "sequential"
        && e.isMay
        && Array.isArray(e.costEffects) && e.costEffects.length === 1
        && e.costEffects[0]?.type === "exert"
        && e.costEffects[0]?.target?.type === "this"
        && Array.isArray(e.rewardEffects) && e.rewardEffects.length >= 1) {
      const reward = (e.rewardEffects as Json[]).map(renderEffect).filter(Boolean).join(", and ");
      // Player-active "give X Y" idiom — when the reward is a `grant_keyword`
      // (or stat buff), oracle wording uses "give chosen character Y" rather
      // than "chosen character gains Y" because the controller is the
      // grammatical subject of the cost-payment. Rewrite "X gains Y" → "give
      // X Y" and "X gets +N {S}" → "give X +N {S}".
      const rewritten = reward
        .replace(/^chosen ([\w\s]+?) gains /, "give chosen $1 ")
        .replace(/^chosen ([\w\s]+?) gets /, "give chosen $1 ");
      return `This character may enter play exerted to ${rewritten}`;
    }
  }
  let head = renderTrigger(ab.trigger ?? {});
  // Substitute "this character" → "this location" / "this item" when the
  // ability's source is a location/item. Elsa's Ice Palace ETERNAL WINTER:
  // oracle says "When you play this LOCATION..." but the trigger renderer
  // emits "this character" generically.
  if (ctx?.cardType === "location") {
    head = head.replace(/this character/g, "this location");
  } else if (ctx?.cardType === "item") {
    head = head.replace(/this character/g, "this item");
  }
  const cond = ab.condition ? renderCondition(ab.condition) : "";
  // Filter empty renderings so chained effects (e.g. peek_and_set_target
  // → play_for_free with last_resolved_target) don't produce ". ." artifacts.
  let body = joinEffects(effects);
  // Trigger-context pronoun rewrite: when the trigger is challenge-related
  // (`banished_in_challenge`, `is_challenged`, `banished_other_in_challenge`),
  // the "triggering character" pronoun in effect bodies refers specifically
  // to the *challenger*, not a generic actor. Oracle wording is consistently
  // "the challenging character" (Cheshire Cat Not All There LOSE SOMETHING?,
  // Helga Sinclair Vengeful Partner NOTHING PERSONAL, Kuzco's Palace CITY
  // WALLS). Rewrite the rendered body to swap the pronoun.
  const trigOn = ab.trigger?.on;
  if (trigOn === "banished_in_challenge" || trigOn === "is_challenged" || trigOn === "banished_other_in_challenge") {
    body = body.replace(/the triggering character/g, "the challenging character");
  }
  // chosen_for_support filter:owner:self — the triggering character is one
  // of the controller's characters; oracle pronouns it as "they/them"
  // (Rapunzel Ready for Adventure ACT OF KINDNESS, Prince Phillip Gallant
  // Defender BEST DEFENSE). Rewrite "the triggering character" → "they"
  // when the trigger is owner-self chosen_for_support. Verb-S de-agreement
  // follows: rewrite "they takes" → "they take" / "they gains" → "they
  // gain" since "they" is plural-form.
  if (trigOn === "chosen_for_support" && ab.trigger?.filter?.owner?.type === "self") {
    body = body
      .replace(/the triggering character/g, "they")
      .replace(/\bthey takes\b/g, "they take")
      .replace(/\bthey gains\b/g, "they gain")
      .replace(/\bthey gets\b/g, "they get");
  }
  // oncePerTurn prefix: "Once per turn, whenever X, Y" (Taffyta Muttonfudge).
  // When condition is "during your turn", merge to "Once during your turn,"
  // to match oracle wording (Seven Dwarfs' Mine, Zootopia Police HQ).
  const oncePerTurnDuringYourTurn = ab.oncePerTurn && cond === "during your turn";
  const oncePrefix = ab.oncePerTurn ? "Once per turn, " : "";
  // "during opponents' turns" / "during your turn" reads best at the front.
  if (cond.startsWith("during ")) {
    const headLower = head.charAt(0).toLowerCase() + head.slice(1);
    if (oncePerTurnDuringYourTurn) {
      return `Once ${cond}, ${headLower}, ${body}`;
    }
    return `${cap(cond)}, ${oncePrefix}${headLower}, ${body}`;
  }
  // (enters_play + played_via_shift) cards mostly use the standard "When
  // you play this character, if you used Shift to play her, <body>" order
  // (Mulan Elite Archer STRAIGHT SHOOTER, Stitch Alien Buccaneer READY FOR
  // ACTION, Mickey Musketeer Captain MUSKETEERS UNITED). Basil Great Mouse
  // Detective THERE'S ALWAYS A CHANCE is the lone outlier with reversed
  // clause order — accept the 0.04 similarity gap on Basil rather than
  // regressing the majority by emitting his order globally.
  if (cond) return `${oncePrefix}${head}, ${cond}, ${body}`;
  return `${oncePrefix}${head}, ${body}`;
}

function renderActivated(ab: Json, ctx?: { cardType?: string }): string {
  const costParts = (ab.costs ?? []).map((c: Json) => renderCost(c, ctx));
  let effects: Json[] = [...(ab.effects ?? [])];
  // Flatten a single wrapping SequentialEffect: Mrs. Potts Head Housekeeper
  // encodes "{E}, Banish one of your items — Draw a card" as
  // effects: [{type: sequential, costEffects: [banish], rewardEffects: [draw]}].
  // Splat costEffects + rewardEffects into the flat effects array so the
  // hoist loop below can promote the costEffects to the cost line.
  if (effects.length === 1 && effects[0]?.type === "sequential") {
    const seq = effects[0];
    const ce = Array.isArray(seq.costEffects) ? seq.costEffects : [];
    const re = Array.isArray(seq.rewardEffects) ? seq.rewardEffects : [];
    if (ce.length > 0 && re.length > 0) {
      effects = [...ce, ...re];
    }
  }
  // Lorcana convention: "banish one of your X" / "discard a card" written
  // as a cost in oracle text is modeled here as the FIRST effect. Hoist
  // leading cost-effects into the cost line so "{E}, Banish one of your
  // items — Gain N lore" renders correctly. Guard: never hoist if it would
  // leave effects empty — some cards put the primary action first, not a
  // cost (Sugar Rush Speedway's ON YOUR MARKS! exerts as the main effect).
  while (effects.length > 1) {
    const first = effects[0];
    if (first?.type === "banish"
        && first.target?.type === "chosen"
        && first.target.filter?.owner?.type === "self") {
      // Oracle wording for cost-hoist banish is consistently "Banish one of
      // your X" (Triton Discerning King, Hades Strong Arm, Beast Frustrated
      // Designer). `renderTarget` would produce "chosen X of yours" which
      // is only used when the banish is the main effect, not a cost-step.
      const count = first.target.count && first.target.count > 1 ? `${first.target.count} of your ` : "one of your ";
      const { owner, ...restFilter } = first.target.filter;
      const noun = pluralizeFilter(renderFilter(restFilter, { suppressOwnerSelf: true }));
      costParts.push(`Banish ${count}${noun}`);
      effects.shift();
      continue;
    }
    if (first?.type === "exert"
        && first.target?.type === "chosen"
        && first.target.filter?.owner?.type === "self") {
      const count = first.target.count && first.target.count > 1 ? `${first.target.count} of your ` : "one of your ";
      const { owner, ...restFilter } = first.target.filter;
      const noun = pluralizeFilter(renderFilter(restFilter, { suppressOwnerSelf: true }));
      costParts.push(`Exert ${count}${noun}`);
      effects.shift();
      continue;
    }
    if (first?.type === "discard_from_hand"
        && first.target?.type === "self"
        && typeof first.amount === "number") {
      const filt = first.filter ? ` ${renderFilter(first.filter)}` : first.amount === 1 ? " card" : " cards";
      costParts.push(first.amount === 1 ? `Choose and discard a${filt}` : `Choose and discard ${first.amount}${filt}`);
      effects.shift();
      continue;
    }
    break;
  }
  const costs = costParts.join(", ");
  const cond = ab.condition ? renderCondition(ab.condition) : "";
  const body = joinEffects(effects);
  // oncePerTurn prefix for activated abilities. Pairs with condition:is_your_turn
  // to form "Once during your turn" (Grandmother Willow, Sugar Rush Speedway).
  const oncePrefix = ab.oncePerTurn
    ? (cond === "during your turn" ? "Once during your turn, " : "Once per turn, ")
    : "";
  // If we used "Once during your turn" prefix, the condition is absorbed.
  const condOut = (ab.oncePerTurn && cond === "during your turn") ? "" : cond;
  if (condOut) return `${oncePrefix}${costs} — ${cap(condOut)}, ${body}`;
  return `${oncePrefix}${costs} — ${body}`;
}

function renderStatic(ab: Json, ctx?: { cardType?: string }): string {
  // Beast Snowfield Troublemaker DYNAMIC MANEUVER: static with
  // `challenge_damage_prevention` + `this_at_location` condition reads as
  // a triggered ability in oracle text — "Whenever this character
  // challenges, if he's at a location, he takes no damage from the
  // challenge." The static modeling is semantically correct (no extra
  // listener; checked during challenge resolution) but the printed
  // wording uses the trigger shape. Special-case this combination.
  if (ab.effect?.type === "challenge_damage_prevention"
      && !ab.effect.targetFilter
      && ab.condition?.type === "this_at_location") {
    return "Whenever this character challenges, if this character is at a location, this character takes no damage from the challenge";
  }
  // Compound cant_action_self merge: oracle wording for two
  // self-restrictions is "this character can't X or Y" not "this character
  // can't X and this character can't Y" (Treasure Guardian WHO DISTURBS MY
  // SLUMBER? "This character can't challenge or quest unless it is at a
  // location"). Detect the array shape and merge actions.
  if (Array.isArray(ab.effect)
      && ab.effect.length === 2
      && ab.effect.every((e: Json) => e?.type === "cant_action_self")
      && !ab.effect.some((e: Json) => e?.duration)) {
    const actions = (ab.effect as Json[]).map((e) => e.action ?? "act").join(" or ");
    const condBody = ab.condition ? renderCondition(ab.condition) : "";
    if (condBody.startsWith("unless ")) {
      return `This character can't ${actions} ${condBody}`;
    }
    if (condBody) {
      return `${cap(condBody)}, this character can't ${actions}`;
    }
    return `This character can't ${actions}`;
  }
  let cond = ab.condition ? renderCondition(ab.condition) : "";
  // Statics use "While" not "If" for ongoing conditions, EXCEPT for
  // self_cost_reduction (Mulan Ready for Battle NOBLE SPIRIT/FIGHTING
  // SPIRIT) which is checked at play time — oracle uses "If you have X,
  // you pay 1 {I} less to play this character." not "While...".
  const isSelfCostReduction = ab.effect?.type === "self_cost_reduction"
    || (Array.isArray(ab.effect) && ab.effect.some((e: Json) => e?.type === "self_cost_reduction"));
  if ((cond.startsWith("if ") || cond.startsWith("If ")) && !isSelfCostReduction) {
    cond = "While " + cond.slice(3);
  }
  // ab.effect can be a single effect object OR an array of effects
  // (compound static — Hidden Cove "+1 S and +1 W while here", Judy Hopps
  // Lead Detective "Alert + Resist +2", etc.). Render each and join.
  const eff = ab.effect;
  // Special case: cost_reduction in a static context is ONGOING ("you pay 1
  // less to play items") UNLESS the parent ability is oncePerTurn — then
  // it's "once during your turn, you pay 1 {I} less for the NEXT X you play
  // this turn" (Grandmother Willow SMOOTH THE WAY). Belle's House Maurice's
  // Workshop LABORATORY uses the ongoing form (no oncePerTurn).
  const renderEffOrOngoing = (e: Json): string => {
    if (e?.type === "cost_reduction" && typeof e.amount === "number" && e.amount !== 99) {
      const filterNoOwner = e.filter ? { ...e.filter, owner: undefined } : undefined;
      const filt = filterNoOwner ? renderFilter(filterNoOwner, { suppressOwnerSelf: true }) : "card";
      if (ab.oncePerTurn) {
        return `you pay ${e.amount} {I} less for the next ${filt} you play this turn`;
      }
      return `you pay ${e.amount} {I} less to play ${pluralizeFilter(filt)}`;
    }
    return renderEffect(e ?? {});
  };
  let body: string;
  if (Array.isArray(eff)) {
    body = eff.map(renderEffOrOngoing).filter((s) => s && !s.startsWith("[empty")).join(" and ");
  } else {
    body = renderEffOrOngoing(eff);
  }
  // Substitute "this character" → "this location" / "this item" when the
  // source's cardType warrants. Game Preserve EASY TO MISS, Elsa's Ice Palace
  // ETERNAL WINTER, etc. Mirrors the same substitution in renderTriggered.
  // Excludes double-quoted regions — granted activated/triggered abilities
  // contain inner "this character" references that point to the grantee, not
  // the source. Bad-Anon Villain Support Center: oracle 'Villain characters
  // gain "{E}, 3 {I} — Play a character with the same name as this character
  // for free" while here.' — the inner "this character" must stay because it
  // refers to the granted Villain.
  const subOutsideQuotes = (text: string, replacement: string): string => {
    return text.split(/("[^"]*")/).map((seg, i) =>
      i % 2 === 0 ? seg.replace(/this character/g, replacement) : seg
    ).join("");
  };
  if (ctx?.cardType === "location") {
    body = subOutsideQuotes(body, "this location");
    cond = subOutsideQuotes(cond, "this location");
  } else if (ctx?.cardType === "item") {
    body = subOutsideQuotes(body, "this item");
    cond = subOutsideQuotes(cond, "this item");
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

// Player filters for each_player's `filter` field (phase 2).
function renderPlayerFilter(f: Json | undefined): string {
  if (!f || !f.type) return "";
  const metric = String(f.metric ?? "?").replace(/_/g, " ");
  switch (f.type) {
    case "player_vs_caster": {
      const wording: Record<string, string> = {
        ">": "more", ">=": "at least as much", "<": "less", "<=": "at most as much", "==": "the same",
      };
      return `with ${wording[String(f.op)] ?? f.op} ${metric} than you`;
    }
    case "player_is_group_extreme":
      return `with the ${f.mode === "fewest" ? "fewest" : "most"} ${metric}`;
    case "player_metric": {
      const wording: Record<string, string> = {
        ">": "more than", ">=": "at least", "<": "fewer than", "<=": "at most", "==": "exactly",
      };
      return `with ${wording[String(f.op)] ?? f.op} ${f.amount} ${metric}`;
    }
    default:
      return `[unknown player filter:${f.type}]`;
  }
}

// -----------------------------------------------------------------------------
// Targets and filters.
// -----------------------------------------------------------------------------
/** Rewrites `{type: "this"}` inside a follow-up effect's target to a
 *  sentinel `{type: "__pronoun_they"}`, which renderTarget translates as
 *  "they". Used by ready/exert/grant_keyword renderers where convention is
 *  that "this" in a follow-up refers to the chosen target of the parent
 *  effect, not the ability source. Called right before renderEffect so the
 *  follow-up chain sees the pronoun form. */
function rewriteFollowUpThisToPronoun(eff: Json): Json {
  if (!eff || typeof eff !== "object") return eff;
  const clone: Json = { ...eff };
  // "this" inside followUpEffects refers to the parent's chosen target, not
  // the ability source. "last_resolved_target" similarly refers to whatever
  // the parent effect just resolved. Both render naturally as "they".
  if (clone.target?.type === "this" || clone.target?.type === "last_resolved_target") {
    clone.target = { type: "__pronoun_they" };
  }
  return clone;
}

function renderTarget(t: Json): string {
  if (!t || !t.type) return "[no-target]";
  switch (t.type) {
    case "self":
      return "you";
    case "opponent":
      return "each opponent";
    case "both":
      return "each player";
    case "active_player":
      // Goliath Clan Leader DUSK TO DAWN: "at the end of each player's turn,
      // they..." — the trigger fires on each turn-end with the effect scoped
      // to the player whose turn just ended (= state.currentPlayer at trigger
      // resolution). Renders as "they" so the oracle reads the same.
      return "they";
    case "this":
      return "this character";
    case "__pronoun_they":
      return "they";
    case "triggering_card":
      return "the triggering character";
    case "last_resolved_target":
      return "that character";
    case "from_last_discarded":
      return "that discarded card";
    case "all_damaged": {
      // Owner-self/none: "each damaged character you have in play"
      // (Everybody's Got a Weakness). No-owner filter (both players'
      // characters): "all other characters" (Can't Hold It Back Anymore:
      // "Move all damage counters from all other characters to that
      // character"). Distinguish by explicit owner field.
      const f = t.filter ? renderFilter(t.filter, { suppressOwnerSelf: true }) : "character";
      // Force "damaged" prefix since hasDamage is implicit in all_damaged.
      const filt = /\bdamaged\b/.test(f) ? f : `damaged ${f}`;
      if (!t.filter?.owner) {
        // No owner = all players. Oracle "all other characters" since the
        // chosen target ("that character") is excluded by definition.
        return `all other ${filt}s`;
      }
      return t.filter?.owner?.type === "self"
        ? `each ${filt} you have in play`
        : `each opposing ${filt}`;
    }
    case "last_song_singers":
      // Alma Madrigal, Sebastian Court Composer: refers to characters that
      // just sang the triggering song.
      return "the characters that sang the song";
    case "target_owner":
      // Glean: "banish chosen item. ITS PLAYER gains 2 lore." Refers to
      // the controller of the previously-chosen target.
      return "that card's player";
    case "chosen": {
      const f = t.filter ? renderFilter(t.filter, { suppressOwnerSelf: true }) : "character";
      // "any" sentinel or legacy 99 → "any number of" wording (Ever as Before,
      // Leviathan, Royal Tantrum). Numeric count > 1 → numeric up-to wording.
      const isAnyCount = t.count === "any" || t.count === 99;
      const count = !isAnyCount && t.count && t.count > 1 ? `${t.count} ` : "";
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
      // Aggregate-sum caps (Leviathan: "total {S} 10 or less"). Collect each
      // present cap into a trailing clause.
      const totalClauses: string[] = [];
      if (t.totalStrengthAtMost !== undefined) totalClauses.push(`with total {S} ${t.totalStrengthAtMost} or less`);
      if (t.totalStrengthAtLeast !== undefined) totalClauses.push(`with total {S} ${t.totalStrengthAtLeast} or more`);
      if (t.totalWillpowerAtMost !== undefined) totalClauses.push(`with total {W} ${t.totalWillpowerAtMost} or less`);
      if (t.totalWillpowerAtLeast !== undefined) totalClauses.push(`with total {W} ${t.totalWillpowerAtLeast} or more`);
      if (t.totalCostAtMost !== undefined) totalClauses.push(`with total cost ${t.totalCostAtMost} or less`);
      if (t.totalCostAtLeast !== undefined) totalClauses.push(`with total cost ${t.totalCostAtLeast} or more`);
      if (t.totalLoreAtMost !== undefined) totalClauses.push(`with total {L} ${t.totalLoreAtMost} or less`);
      if (t.totalLoreAtLeast !== undefined) totalClauses.push(`with total {L} ${t.totalLoreAtLeast} or more`);
      if (t.totalDamageAtMost !== undefined) totalClauses.push(`with total damage ${t.totalDamageAtMost} or less`);
      if (t.totalDamageAtLeast !== undefined) totalClauses.push(`with total damage ${t.totalDamageAtLeast} or more`);
      const totalSuffix = totalClauses.length ? ` ${totalClauses.join(" and ")}` : "";
      // Owner-self on a chosen target: canonical Lorcana wording is "chosen
      // X of yours" (Grandmother Fa FIND THE WAY, Poisoned Apple) when the
      // filter has no trailing qualifier, OR "one of your [plural]" when
      // there's a trailing qualifier that would make "... of yours ..." read
      // awkwardly ("one of your characters with damage" vs the weird
      // "chosen character of yours with damage").
      if (t.filter?.owner?.type === "self") {
        const hasTrailing = !!(t.filter.hasDamage || t.filter.hasCardUnder || t.filter.challengedThisTurn
          || t.filter.hasName || t.filter.hasKeyword || t.filter.lacksKeyword
          || (Array.isArray(t.filter.statComparisons) && t.filter.statComparisons.length > 0));
        if (isAnyCount) return `any number of your ${pluralizeFilter(f)}${totalSuffix}`;
        if (hasTrailing) return `one of your ${pluralizeFilter(f)}${totalSuffix}`;
        return `chosen ${count}${f} of yours${totalSuffix}`;
      }
      if (isAnyCount) return `any number of chosen ${pluralizeFilter(f)}${totalSuffix}`;
      return `chosen ${count}${f}${totalSuffix}`;
    }
    case "all": {
      const f = t.filter ? pluralizeFilter(renderFilter(t.filter)) : "characters";
      // "your X" is self-pluralizing in oracle wording (Cogsworth: "Your
      // characters with Reckless gain..."). For opposing sets, "all
      // opposing X" is the natural wording (Milo Thatch TAKE THEM BY
      // SURPRISE: "return all opposing characters"). Only drop "all"
      // when owner is self.
      if (t.filter?.owner?.type === "self") return f;
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

/** Render one CardFilter.statComparisons entry as an English clause.
 *  Post-2026-04-24 refactor: replaces the former per-axis renderer blocks
 *  (costAtMost, strengthAtLeast, etc.). Dispatch: static number → simple
 *  "with X {S} or less"-style phrase; dynamic {from, property?, offset?}
 *  → "with cost equal to or less than the banished character's strength"-
 *  style phrase depending on the reference source. */
function renderStatComparison(c: Json): string {
  const statGlyph = c.stat === "cost" ? "cost"
    : c.stat === "strength" ? "{S}"
    : c.stat === "willpower" ? "{W}"
    : c.stat === "lore" ? "{L}"
    : "damage";
  const opPhrase = c.op === "lte" ? "or less"
    : c.op === "gte" ? "or more"
    : c.op === "lt" ? "less than"
    : c.op === "gt" ? "more than"
    : "equal to";
  // Static numeric value — "with cost 5 or less", "with {S} 3 or more".
  if (typeof c.value === "number") {
    if (c.stat === "cost") {
      return `with cost ${c.value} ${opPhrase}`;
    }
    return `with ${c.value} ${statGlyph} ${opPhrase}`;
  }
  // Dynamic reference — try to produce oracle-matching phrasing for each
  // known `from` source. Fallback is a generic "referencing X" marker.
  const v = c.value ?? {};
  const from: string = v.from ?? "last_resolved_source";
  const property: string = v.property ?? c.stat;
  const offset: number = v.offset ?? 0;
  const refPhrase = from === "last_resolved_source"
      ? (property === "cost" ? "the banished character's cost"
         : property === "strength" ? "this character's {S} at the time it was resolved"
         : `that character's ${property === "willpower" ? "{W}" : property === "lore" ? "{L}" : property}`)
    : from === "last_banished_source"
      ? (property === "strength" ? "the {S} he had in play" : `the banished character's ${property}`)
    : from === "source"
      ? (property === "strength" ? "this character's {S}"
         : property === "willpower" ? "this character's {W}"
         : property === "lore" ? "this character's {L}"
         : `this character's ${property}`)
    : from === "triggering_card"
      ? `the triggering character's ${property}`
    : from === "last_discarded"
      ? (property === "lore" ? "the discarded character's {L}"
         : property === "strength" ? "the discarded character's {S}"
         : property === "willpower" ? "the discarded character's {W}"
         : `the discarded card's ${property}`)
    : `${from}.${property}`;
  const offsetPhrase = offset === 0 ? "" : offset > 0 ? ` +${offset}` : ` ${offset}`;
  // "up to N more than X" idiom — when offset > 0 and op="lte", oracle
  // wording is "with cost up to N more than the banished character" (Retro
  // Evolution Device TURN INTO DINOSAUR), not "equal to or less than X +N".
  // Strip the trailing "'s cost" possessive when the property already
  // matches the stat axis ("the banished character's cost" → "the banished
  // character") to avoid the awkward "the banished character's cost up to".
  if (c.op === "lte" && offset > 0 && c.stat === "cost") {
    const refTrim = refPhrase.replace(/'s cost$/, "");
    return `with cost up to ${offset} more than ${refTrim}`;
  }
  // "cost equal to or less than X" / "{S} equal to or less than X" wording
  // matches most in-game oracle text for the dynamic cases.
  const opDynamic = c.op === "lte" ? "equal to or less than"
    : c.op === "gte" ? "equal to or greater than"
    : c.op === "lt" ? "less than"
    : c.op === "gt" ? "greater than"
    : "equal to";
  if (c.stat === "cost") {
    return `with cost ${opDynamic} ${refPhrase}${offsetPhrase}`;
  }
  return `with ${statGlyph} ${opDynamic} ${refPhrase}${offsetPhrase}`;
}

function renderFilter(f: Json, opts?: { suppressOwnerSelf?: boolean }): string {
  // anyOf compound filter: disjunction of sub-filters (Hiro Hamada: "item
  // card or Robot character card"). Render as "X or Y".
  if (Array.isArray(f.anyOf) && f.anyOf.length > 0) {
    return f.anyOf.map((sub: Json) => renderFilter(sub, opts)).join(" or ");
  }
  const bits: string[] = [];
  // Owner — suppress "your" for chosen targets (oracle says "chosen character" not "chosen your character")
  if (f.owner?.type === "self" && !opts?.suppressOwnerSelf) bits.push("your");
  else if (f.owner?.type === "opponent") bits.push("opposing");
  if (f.excludeSelf) bits.push("other");
  // Stats / cost / keyword adjectives go BEFORE the noun
  if (f.isExerted) bits.push("exerted");
  // Lorcana idiom: "damaged character" (adjective prefix), not "character with damage".
  // Cheshire Cat From the Shadows WICKED SMILE, Queen of Hearts COUNT OFF!,
  // Ed Hysterical Partygoer ROWDY GUEST, etc.
  if (f.hasDamage) bits.push("damaged");
  // hasKeyword is postpositional in oracle text: "character with Reckless"
  // (Cogsworth Talking Clock WAIT A MINUTE), "character with Evasive here"
  // (Game Preserve EASY TO MISS). Stash for trailing-qualifier emission.
  // (Pre-2026-04 we treated this as a prefix adjective, producing "Reckless
  // character" — close but not the oracle wording.)
  if (f.hasTrait) bits.push(f.hasTrait);
  if (f.hasAnyTrait?.length) bits.push(f.hasAnyTrait.join(" or "));
  // Don Karnage SCORNFUL TAUNT: "an action that isn't a song" — rendered
  // as a "non-<trait>" adjective prefix.
  if (f.hasNoTrait) bits.push(`non-${f.hasNoTrait}`);
  // Noun
  let noun = "card";
  const rawTypes = f.cardType;
  const types: string[] = Array.isArray(rawTypes) ? rawTypes : rawTypes ? [rawTypes] : [];
  if (types.length === 1) noun = types[0]!;
  else if (types.length === 2) noun = types.join(" or ");
  else if (types.length === 3) {
    // 3-type list spans the non-character complement (action+item+location)
    // — Lorcana oracle wording is "non-character" (Buzz Lightyear On the
    // Way SECRET MISSION). Treat the explicit 3-type complement as the
    // canonical "non-character" idiom.
    const sorted = [...types].sort();
    if (sorted.join(",") === "action,item,location") noun = "non-character";
    else noun = types.slice(0, -1).join(", ") + ", or " + types[types.length - 1];
  }
  else if (types.length > 3) noun = types.slice(0, -1).join(", ") + ", or " + types[types.length - 1];
  // No cardType filter → generic "card"
  // Song actions should render as "song" not "Song action"
  if (f.hasTrait === "Song" && noun === "action") noun = "song";
  // Pluralize for "all"-ish contexts isn't tracked here; rely on caller.
  bits.push(noun);
  // Trailing qualifiers
  if (f.hasName) bits.push(`named ${f.hasName}`);
  if (f.notHasName) bits.push(`not named ${f.notHasName}`);
  if (f.hasKeyword) bits.push(`with ${cap(f.hasKeyword)}`);
  if (f.maxCost !== undefined) bits.push(`with cost ${f.maxCost} or less`);  // legacy alias still used by one card
  if (f.minCost !== undefined) bits.push(`with cost ${f.minCost} or more`);
  // statComparisons — unified numeric-axis block. Replaces the former flat
  // costAtMost/AtLeast/strengthAtMost/AtLeast/willpowerAtMost/AtLeast fields
  // AND the three dynamic variants. See renderStatComparison for the phrase
  // dictionary. Multiple entries render as independent clauses ("with X and Y").
  if (Array.isArray(f.statComparisons)) {
    for (const c of f.statComparisons) bits.push(renderStatComparison(c));
  }
  // hasDamage now prefixed as "damaged" adjective (above) — was "with damage"
  // postpositional, but Lorcana oracles consistently use the adjective form.
  // Tug-of-War: "each opposing character without Evasive".
  if (f.lacksKeyword) bits.push(`without ${cap(f.lacksKeyword)}`);
  // Hades Double Dealer: play a character "with the same name as the
  // banished character" — nameFromLastResolvedSource pins the name to
  // state.lastResolvedSource (set by the preceding banish effect).
  if (f.nameFromLastResolvedSource) bits.push("with the same name as the banished character");
  if (f.nameFromLastResolvedTarget) bits.push("with the same name as the chosen card");
  if (f.nameFromSource) bits.push("with the same name as this character");
  if (f.hasCardUnder) bits.push("with a card under them");
  if (f.challengedThisTurn) bits.push("that challenged this turn");
  if (f.inkable) bits.push("with {IW}");
  // Zone qualifier (for "card from your hand/discard")
  const zone = Array.isArray(f.zone) ? f.zone[0] : f.zone;
  if (zone && zone !== "play") bits.push(`from your ${zone}`);
  // atLocation. "this" → "here" (the source location); "any" → "at a location"
  // (Grumpy Skeptical Knight BOON OF RESILIENCE filter: knights "at a location"
  // — the WHILE-at-a-location condition is encoded as a target-filter restriction).
  if (f.atLocation === "this") bits.push("here");
  else if (f.atLocation === "any") bits.push("at a location");
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
  // Lorcana oracle uses "or greater" interchangeably with "or more" for
  // stat thresholds (Mr. Big REPUTATION "2 {S} or greater" vs the more
  // common "2 {S} or more"). Same for "or fewer" vs "or less". Map both
  // to canonical forms so the F1 score sees them as identical tokens.
  [/\bgreater\b/g, "more"],
  [/\bfewer\b/g, "less"],
  // "While an opponent has no cards in their hand" (Belle - Bookworm USE
  // YOUR IMAGINATION) and "While one or more opponents have no cards in
  // their hands" (Gaston Scheming Suitor YES, I'M INTIMIDATING) are
  // semantically and structurally equivalent — both gate on the same
  // `cards_in_hand_eq amount:0 player:opponent` condition. Lorcana
  // printed two different forms for the same primitive (set 2 only;
  // these are the only 2 cards using this condition in the corpus).
  // Collapse "one or more opponents" → "an opponent" so both oracle
  // forms tokenize identically. Same for the plural "hands" idiom.
  [/\bone or more opponents\b/g, "an opponent"],
  [/\bhands\b/g, "hand"],
  [/\b(an?|the|of|to|from|into|in|on|at|for|with|that|their|its|his|her|player's|player)\b/g, " "],
];

function normalize(s: string): string {
  // Strip story-name leading ALL-CAPS — Lorcana prints abilities with bold
  // ALL-CAPS story names ("NONE OF YOUR POWERS ARE WORKING This character
  // enters play exerted." → "This character enters play exerted."). Our
  // renderer omits storyNames entirely, so leaving them in the scored
  // oracle just adds non-matchable tokens. Strip the leading run of
  // CAPS/punctuation tokens up to the first word that's NOT all-caps.
  // Also handle multi-paragraph rulesText: storyNames appear after
  // newlines too (Mulan Reflecting "...Otherwise, put it on the top of
  // your deck.\nHONOR TO THE ANCESTORS Whenever..."). Match per-paragraph.
  let pre = s.split(/\n+/).map((para) => {
    // Match ALL-CAPS run: each token is uppercase letters/digits/apostrophes/
    // spaces/dashes; stop at the first body-start indicator. Includes Unicode
    // smart quotes (U+2018 ' / U+2019 ') which Lorcana uses in storyNames
    // like "WHAT D'YA SAY?" (Hades Looking for a Deal) and "I'M
    // INTIMIDATING" (Gaston Scheming Suitor). Body-start indicators:
    //   - Capital letter + lowercase / open-paren (sentence-case bodies)
    //   - Cost glyph "{" (cost notations like "{E}", "{I}" — Dinner Bell
    //     YOU KNOW WHAT HAPPENS, Shere Khan WILD RAGE, Half Hexwell Crown
    //     AN UNEXPECTED FIND, all begin with a cost glyph)
    //   - Digit (cost shorthand like "1 {I}" — Shere Khan WILD RAGE)
    const m = para.match(/^([A-Z][A-Z0-9 '!?\-,‘’]*?)\s+([A-Z][a-z(]|\{|[0-9])/);
    if (m && m[1].split(/\s+/).filter(Boolean).length >= 2) {
      // First group is the storyName, but only strip if it's >=2 words to
      // avoid eating short legitimate prefixes like "I'M" or "GO".
      return m[2] + para.slice(m[0].length);
    }
    return para;
  }).join("\n");
  let out = pre.toLowerCase();
  // Strip parenthetical reminder text (keyword reminders, sing-cost reminders)
  // — but ONLY if there's substantive content outside the parens. Cards whose
  // entire oracle text IS a parenthetical (Flotsam & Jetsam Entangling Eels:
  // "(This character counts as being named both Flotsam and Jetsam.)") would
  // otherwise normalize to empty string and force-fail the similarity score.
  const stripped = out.replace(/\([^)]*\)/g, " ").trim();
  if (stripped.length > 0) out = out.replace(/\([^)]*\)/g, " ");
  else out = out.replace(/[()]/g, " ");
  for (const [re, repl] of SYNONYMS) out = out.replace(re, repl);
  // Strip punctuation. Angle brackets included so oracle "<Rush>" matches
  // rendered "Rush" — Lorcana wraps keyword references in angle brackets;
  // our renderer emits the bare word. Includes Unicode smart quotes
  // (U+2018-U+201D) so oracle smart-quoted text matches rendered ASCII
  // quotes — without these, granted-ability rulesText like
  // "Characters gain "{E} — Draw a card" while here" splits "draw" into
  // an unmatchable "draw" + leading-quote token, costing 0.20 similarity.
  out = out.replace(/[.,;:!?\-—'"`<>‘’“”]/g, " ");
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
  // policy as packages/engine/src/cards/cardDefinitions.ts. Without this,
  // a card reprinted across 5 set files appears 5 times in the report.
  const byId = new Map<string, CardJSON>();
  const files = readdirSync(CARDS_DIR)
    .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"));
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
    // If oracle is empty, the comparison is meaningless — the importer omits
    // reminder text for vanilla-keyword cards. Skip rather than score 0.0.
    if (!oracle) continue;

    const rendered = renderCard(card);
    // (Pre-2026-04-30 we skipped keyword-only cards because the renderer
    // emitted nothing. Now keyword abilities render with reminder text via
    // renderKeywordWithReminder, so they score normally.)
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
    const tag = `[${r.score.toFixed(2)}] set-${r.setId}/${r.number}  ${r.fullName}`;
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
<thead><tr><th>Score</th><th>Card</th><th>Oracle (Ravensburger)</th><th>Rendered (decompiler)</th></tr></thead>
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
