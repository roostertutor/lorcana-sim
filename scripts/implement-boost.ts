#!/usr/bin/env node
// =============================================================================
// BOOST FAMILY batch — wires ~28 cards across sets 10 + 11 that rely on the
// boost subzone (CRD 8.4.2). Proof cards already landed:
//   - Webby's Diary (LATEST ENTRY)             — card_put_under trigger
//   - Wreck-it Ralph Raging Wrecker            — modify_stat_per_count(under)
//   - Flynn Rider Spectral Scoundrel           — this_has_cards_under static
//   - Graveyard of Christmas Future            — put_cards_under_into_hand
//
// This batch uses the new engine primitives:
//   - Condition `this_has_cards_under` / `you_control_matching` (filter)
//   - CardFilter.hasCardUnder
//   - DynamicAmount `cards_under_count`
//   - Effect put_top_of_deck_under (now supports chosen targets too)
//   - Effect put_cards_under_into_hand
//   - Trigger card_put_under
//
// Skipped (and why):
//   - Kristoff Mining the Ruins WORTH MINING: needs put_top_into_inkwell effect.
//   - Bambi Ethereal Fawn COME SEE!: reveal-equal-to-count dynamic look_at_top
//     variant not yet supported.
//   - Pete Ghost of Christmas Future FOREBODING GLANCE: same (dynamic look).
//   - Jiminy Cricket Ghost of Christmas Past LOOK INTO YOUR PAST: needs a
//     put-from-discard-to-inkwell-exerted effect (alt source zone gap).
//   - Megara SECRET KEEPER second clause ("and gains 'Whenever this character
//     is challenged, each opponent chooses and discards a card'"): granted
//     floating trigger on target via static — not supported. We wire the
//     +1 lore half only.
//   - Ariel Ethereal Voice COMMAND PERFORMANCE: once-per-turn whenever-you-
//     play-a-song trigger with card-under gate. Partial impl noisy; skip side.
//   - Donald Duck Fred Honeywell SPIRIT OF GIVING (whenever you use Boost
//     ability of a character → put top under them): no "boost_activated"
//     trigger event yet. Skip side; keep base Boost 2 value wired.
//   - Donald Duck Fred Honeywell WELL WISHES (opp turn, your other banished
//     → draw per cards-under): needs leaves_play trigger with dynamic draw
//     amount from triggering card's cards-under count, and turn-phase gate.
//     Defer.
//   - Duckworth Ghost Butler FINAL ACT: is_banished trigger gated on "during
//     your turn". The is_your_turn condition + is_banished combine fine, but
//     the effect surfaces a choose_target which the banished-card resolver
//     path may not handle (not under test). Wired with a condition gate; if
//     the pendingChoice surfaces from a banished source that's edge-case but
//     no worse than the existing is_banished draw cards pattern.
//   - Fairy Godmother Magical Benefactor STUNNING TRANSFORMATION: banish
//     chosen opposing char, then opp reveal-top-conditional play-for-free.
//     The reveal clause drops (opp-target variant with filter char|item). Wire
//     only the banish half.
//   - Simba King in the Making TIMELY ALLIANCE: reveal_top_conditional
//     play_for_free filter character, but the "they enter play exerted"
//     rider is not expressible. Wired as approximation (enters normally).
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

// Common filters
const OWN_CHAR_OR_LOC = { zone: "play" as const, cardType: ["character" as const, "location" as const], owner: { type: "self" as const } };
const OWN_BOOST_CARRIER = { zone: "play" as const, cardType: ["character" as const, "location" as const], owner: { type: "self" as const }, hasKeyword: "boost" as const };
const OWN_CHAR = { zone: "play" as const, cardType: ["character" as const], owner: { type: "self" as const } };
const OPP_CHAR = { zone: "play" as const, cardType: ["character" as const], owner: { type: "opponent" as const } };
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };

// Patch spec: { set, id, abilities?, keywordValue? }. keywordValue supplements
// the Boost keyword's `value` field for cards where the importer missed it.
type Patch = {
  set: "010" | "011";
  id: string;
  abilities?: any[];
  keywordValue?: number;
};

const PATCHES: Patch[] = [
  // ────────────────────────── SET 10 ──────────────────────────

  // Webby Vanderquack Knowledge Seeker — static +1 L while you control any
  // own card with cards-under.
  {
    set: "010",
    id: "webby-vanderquack-knowledge-seeker",
    abilities: [
      {
        type: "static",
        storyName: "I'VE READ ABOUT THIS",
        rulesText: "While you have a character or location in play with a card under them, this character gets +1 {L}.",
        condition: { type: "you_control_matching", filter: { ...OWN_CHAR_OR_LOC, hasCardUnder: true } },
        effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "this" } },
      },
    ],
  },

  // Flintheart Glomgold Scheming Billionaire — static grant Ward while own
  // card-with-under exists.
  {
    set: "010",
    id: "flintheart-glomgold-scheming-billionaire",
    abilities: [
      {
        type: "static",
        storyName: "TRY ME",
        rulesText: "While you have a character or location in play with a card under them, this character gains Ward.",
        condition: { type: "you_control_matching", filter: { ...OWN_CHAR_OR_LOC, hasCardUnder: true } },
        effect: { type: "grant_keyword", keyword: "ward", target: { type: "this" } },
      },
    ],
  },

  // Lena Sabrewing Mysterious Duck — enters_play gain 1 lore if own card-with-under.
  {
    set: "010",
    id: "lena-sabrewing-mysterious-duck",
    abilities: [
      {
        type: "triggered",
        storyName: "ARCANE CONNECTION",
        rulesText: "When you play this character, if you have a character or location in play with a card under them, gain 1 lore.",
        trigger: { on: "enters_play" },
        condition: { type: "you_control_matching", filter: { ...OWN_CHAR_OR_LOC, hasCardUnder: true } },
        effects: [{ type: "gain_lore", amount: 1, target: { type: "self" } }],
      },
    ],
  },

  // Scrooge McDuck On the Right Track — enters_play: +1 lore this turn to chosen
  // char with cards-under.
  {
    set: "010",
    id: "scrooge-mcduck-on-the-right-track",
    abilities: [
      {
        type: "triggered",
        storyName: "FABULOUS WEALTH",
        rulesText: "When you play this character, chosen character with a card under them gets +1 {L} this turn.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "gain_stats",
            lore: 1,
            duration: "this_turn",
            target: { type: "chosen", filter: { ...ANY_CHAR, hasCardUnder: true } },
          },
        ],
      },
    ],
  },

  // Ursula Whisper of Vanessa — while-has-card-under: +1 L AND gains Evasive.
  {
    set: "010",
    id: "ursula-whisper-of-vanessa",
    abilities: [
      {
        type: "static",
        storyName: "SLIPPERY SPELL",
        rulesText: "While there's a card under this character, she gets +1 {L} and gains Evasive.",
        condition: { type: "this_has_cards_under" },
        effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "this" } },
      },
      {
        type: "static",
        rulesText: "(continued) gains Evasive.",
        condition: { type: "this_has_cards_under" },
        effect: { type: "grant_keyword", keyword: "evasive", target: { type: "this" } },
      },
    ],
  },

  // Megara Secret Keeper — half-wired: +1 L while cards-under. Skipping the
  // granted-trigger rider.
  {
    set: "010",
    id: "megara-secret-keeper",
    abilities: [
      {
        type: "static",
        storyName: "I'LL BE FINE",
        rulesText: "While there's a card under this character, she gets +1 {L}. (approximation: granted 'whenever challenged, opponents discard' trigger dropped)",
        condition: { type: "this_has_cards_under" },
        effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "this" } },
      },
    ],
  },

  // Zeus Missing His Spark — +2 S and +2 W while cards-under.
  {
    set: "010",
    id: "zeus-missing-his-spark",
    abilities: [
      {
        type: "static",
        storyName: "I NEED MORE THUNDERBOLTS!",
        rulesText: "While there's a card under this character, he gets +2 {S} and +2 {W}.",
        condition: { type: "this_has_cards_under" },
        effect: { type: "modify_stat", stat: "strength", modifier: 2, target: { type: "this" } },
      },
      {
        type: "static",
        rulesText: "(continued) +2 {W}.",
        condition: { type: "this_has_cards_under" },
        effect: { type: "modify_stat", stat: "willpower", modifier: 2, target: { type: "this" } },
      },
    ],
  },

  // Simba King in the Making — card_put_under trigger → reveal top conditional,
  // play character for free (approx: no 'enters exerted' rider).
  {
    set: "010",
    id: "simba-king-in-the-making",
    abilities: [
      {
        type: "keyword", keyword: "boost", value: 2,
      },
      {
        type: "triggered",
        storyName: "TIMELY ALLIANCE",
        rulesText: "Whenever you put a card under this character, you may reveal the top card of your deck. If it's a character card, you may play that character for free and they enter play exerted. Otherwise, put it on the bottom of your deck. (approximation: played-card does not enter exerted)",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        effects: [
          {
            type: "reveal_top_conditional",
            filter: { cardType: ["character"] },
            matchAction: "play_for_free",
            noMatchDestination: "bottom",
            isMay: true,
            target: { type: "self" },
          },
        ],
      },
    ],
  },

  // Little John Impermanent Outlaw — card_put_under on self → ready self.
  {
    set: "010",
    id: "little-john-impermanent-outlaw",
    abilities: [
      {
        type: "triggered",
        storyName: "READY TO RASSLE",
        rulesText: "Whenever you put a card under this character, ready him.",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        // Only fire when the under-card was placed under THIS character; we
        // approximate via `target: this` on the ready effect (ready's source).
        effects: [{ type: "ready", target: { type: "this" } }],
      },
    ],
  },

  // Scar Eerily Prepared — card_put_under → chosen opp -5 S this turn.
  {
    set: "010",
    id: "scar-eerily-prepared",
    abilities: [
      {
        type: "triggered",
        storyName: "SURVIVAL OF THE FITTEST",
        rulesText: "Whenever you put a card under this character, chosen opposing character gets -5 {S} this turn.",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        effects: [
          { type: "gain_stats", strength: -5, duration: "this_turn", target: { type: "chosen", filter: { ...OPP_CHAR } } },
        ],
      },
    ],
  },

  // Magica De Spell Spiteful Sorceress — card_put_under → move 1 damage counter.
  {
    set: "010",
    id: "magica-de-spell-spiteful-sorceress",
    abilities: [
      {
        type: "triggered",
        storyName: "MYSTICAL MANIPULATION",
        rulesText: "Whenever you put a card under one of your characters or locations, you may move 1 damage counter from chosen character to chosen opposing character.",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        effects: [
          {
            type: "move_damage",
            amount: 1,
            source: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
            destination: { type: "chosen", filter: { ...OPP_CHAR } },
          },
        ],
      },
    ],
  },

  // Cheshire Cat Inexplicable — card_put_under → move up to 2 damage counters.
  {
    set: "010",
    id: "cheshire-cat-inexplicable",
    abilities: [
      {
        type: "triggered",
        storyName: "IT'S LOADS OF FUN",
        rulesText: "Whenever you put a card under this character, you may move up to 2 damage counters from chosen character to chosen opposing character.",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        effects: [
          {
            type: "move_damage",
            amount: 2,
            isUpTo: true,
            source: { type: "chosen", filter: { ...ANY_CHAR, hasDamage: true } },
            destination: { type: "chosen", filter: { ...OPP_CHAR } },
          },
        ],
      },
    ],
  },

  // Fairy Godmother Magical Benefactor — card_put_under → (may) banish chosen
  // opp char. Reveal-top rider dropped.
  {
    set: "010",
    id: "fairy-godmother-magical-benefactor",
    abilities: [
      {
        type: "triggered",
        storyName: "STUNNING TRANSFORMATION",
        rulesText: "Whenever you put a card under this character, you may banish chosen opposing character. If you do, their player may reveal the top card of their deck. If that card is a character or item card, they may play it for free. Otherwise, they put it on the bottom of their deck. (approximation: opponent reveal-top rider dropped)",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        effects: [
          { type: "banish", target: { type: "chosen", filter: { ...OPP_CHAR } } },
        ],
      },
    ],
  },

  // Scrooge McDuck Cavern Prospector — card_played trigger for own character
  // or location with boost keyword → may put top of deck under THAT card
  // (the played one is the triggering card). We approximate with target:this
  // on the enters_play of the TRIGGERING card is not expressible; instead use
  // a `card_played` trigger filtered to Boost cards and put_top_of_deck_under
  // with target chosen w/ boost filter.
  {
    set: "010",
    id: "scrooge-mcduck-cavern-prospector",
    abilities: [
      {
        type: "triggered",
        storyName: "SPECULATION",
        rulesText: "Whenever you play a character or location with Boost, you may put the top card of your deck facedown under them. (approximation: chosen-target over Boost carriers rather than strictly the just-played card)",
        trigger: { on: "card_played", filter: { owner: { type: "self" }, cardType: ["character", "location"], hasKeyword: "boost" } },
        effects: [
          {
            type: "put_top_of_deck_under",
            target: { type: "chosen", filter: { ...OWN_BOOST_CARRIER } },
            isMay: true,
          },
        ],
      },
    ],
  },

  // Emily Quackfaster Level-Headed Librarian — enters_play → may put top of
  // deck under a chosen own-boost carrier.
  {
    set: "010",
    id: "emily-quackfaster-level-headed-librarian",
    abilities: [
      {
        type: "triggered",
        storyName: "RECOMMENDED READING",
        rulesText: "When you play this character, you may put the top card of your deck facedown under one of your characters or locations with Boost.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "put_top_of_deck_under",
            target: { type: "chosen", filter: { ...OWN_BOOST_CARRIER } },
            isMay: true,
          },
        ],
      },
    ],
  },

  // Blessed Bagpipes — item enters_play: may put top under own-boost carrier.
  // (Second ability "BATTLE ANTHEM" is a granted challenge trigger on own
  // cards-with-under — skipped as 'granted static trigger'.)
  {
    set: "010",
    id: "blessed-bagpipes",
    abilities: [
      {
        type: "triggered",
        storyName: "MCDUCK HEIRLOOM",
        rulesText: "When you play this item, you may put the top card of your deck facedown under one of your characters or locations with Boost.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "put_top_of_deck_under",
            target: { type: "chosen", filter: { ...OWN_BOOST_CARRIER } },
            isMay: true,
          },
        ],
      },
    ],
  },

  // Duckworth Ghost Butler — is_banished during your turn → may put top of
  // deck under own-boost carrier.
  {
    set: "010",
    id: "duckworth-ghost-butler",
    abilities: [
      {
        type: "triggered",
        storyName: "FINAL ACT",
        rulesText: "During your turn, when this character is banished, you may put the top card of your deck facedown under one of your characters or locations with Boost.",
        trigger: { on: "is_banished" },
        condition: { type: "is_your_turn" },
        effects: [
          {
            type: "put_top_of_deck_under",
            target: { type: "chosen", filter: { ...OWN_BOOST_CARRIER } },
            isMay: true,
          },
        ],
      },
    ],
  },

  // Ariel Ethereal Voice — keyword-only (side ability skipped; see header).
  {
    set: "010",
    id: "ariel-ethereal-voice",
    abilities: [{ type: "keyword", keyword: "boost", value: 1 }],
  },

  // ────────────────────────── SET 11 ──────────────────────────

  // Kanga Peaceful Gatherer — +1 L while cards-under.
  {
    set: "011",
    id: "kanga-peaceful-gatherer",
    abilities: [
      {
        type: "static",
        storyName: "EXTRA HELP",
        rulesText: "While there's a card under this character, she gets +1 {L}.",
        condition: { type: "this_has_cards_under" },
        effect: { type: "modify_stat", stat: "lore", modifier: 1, target: { type: "this" } },
      },
    ],
  },

  // Hercules Spectral Demigod — +3 S while cards-under.
  {
    set: "011",
    id: "hercules-spectral-demigod",
    abilities: [
      {
        type: "static",
        storyName: "SUPERHUMAN STRENGTH",
        rulesText: "While there's a card under this character, he gets +3 {S}.",
        condition: { type: "this_has_cards_under" },
        effect: { type: "modify_stat", stat: "strength", modifier: 3, target: { type: "this" } },
      },
    ],
  },

  // Scrooge's Counting House Ebenezer's Office — location with Boost 2 and
  // +1 W and +1 L per card under it.
  {
    set: "011",
    id: "scrooges-counting-house-ebenezers-office",
    abilities: [
      { type: "keyword", keyword: "boost", value: 2 },
      {
        type: "static",
        storyName: "GOOD BUSINESS",
        rulesText: "This location gets +1 {W} for each card under it.",
        effect: {
          type: "modify_stat_per_count",
          stat: "willpower",
          perCount: 1,
          countCardsUnderSelf: true,
          target: { type: "this" },
        },
      },
      {
        type: "static",
        rulesText: "(continued) +1 {L} for each card under it.",
        effect: {
          type: "modify_stat_per_count",
          stat: "lore",
          perCount: 1,
          countCardsUnderSelf: true,
          target: { type: "this" },
        },
      },
    ],
  },

  // Scrooge McDuck Ghostly Ebenezer — +1 S and +1 W per card under him.
  {
    set: "011",
    id: "scrooge-mcduck-ghostly-ebenezer",
    abilities: [
      {
        type: "static",
        storyName: "COUNTING COINS",
        rulesText: "This character gets +1 {S} for each card under him.",
        effect: {
          type: "modify_stat_per_count",
          stat: "strength",
          perCount: 1,
          countCardsUnderSelf: true,
          target: { type: "this" },
        },
      },
      {
        type: "static",
        rulesText: "(continued) +1 {W} for each card under him.",
        effect: {
          type: "modify_stat_per_count",
          stat: "willpower",
          perCount: 1,
          countCardsUnderSelf: true,
          target: { type: "this" },
        },
      },
    ],
  },

  // Morty Fieldmouse Tiny Tim — +1 L per card under him.
  {
    set: "011",
    id: "morty-fieldmouse-tiny-tim",
    abilities: [
      {
        type: "static",
        storyName: "HOLIDAY CHEER",
        rulesText: "This character gets +1 {L} for each card under him.",
        effect: {
          type: "modify_stat_per_count",
          stat: "lore",
          perCount: 1,
          countCardsUnderSelf: true,
          target: { type: "this" },
        },
      },
    ],
  },

  // Genie Magical Researcher — already has the boost keyword ability (no value);
  // patch adds the INCREASING WISDOM static AND fills the keyword value.
  // Because this card already has abilities, the "alreadyImpl" guard would
  // skip it — we handle Genie via the keyword-only patch code below.
  {
    set: "011",
    id: "genie-magical-researcher",
    keywordValue: 1,
    abilities: [
      { type: "keyword", keyword: "boost", value: 1 },
      {
        type: "static",
        storyName: "INCREASING WISDOM",
        rulesText: "This character gets +1 {L} for each card under him.",
        effect: {
          type: "modify_stat_per_count",
          stat: "lore",
          perCount: 1,
          countCardsUnderSelf: true,
          target: { type: "this" },
        },
      },
    ],
  },

  // Alice Well-Read Whisper — quest trigger → put_cards_under_into_hand.
  {
    set: "011",
    id: "alice-well-read-whisper",
    abilities: [
      {
        type: "triggered",
        storyName: "MYSTICAL INSIGHT",
        rulesText: "Whenever this character quests, put all cards from under her into your hand.",
        trigger: { on: "quests" },
        effects: [{ type: "put_cards_under_into_hand", target: { type: "this" } }],
      },
    ],
  },

  // Tamatoa Seeker of Shine — card_put_under on any own → self +1 L this turn.
  {
    set: "011",
    id: "tamatoa-seeker-of-shine",
    abilities: [
      {
        type: "triggered",
        storyName: "ANYTHING THAT GLITTERS",
        rulesText: "Whenever you put a card under one of your characters or locations, this character gets +1 {L} this turn.",
        trigger: { on: "card_put_under", filter: { owner: { type: "self" } } },
        effects: [
          { type: "gain_stats", lore: 1, duration: "this_turn", target: { type: "this" } },
        ],
      },
    ],
  },

  // Mickey Mouse Bob Cratchit HARD WORK — quest trigger → put_top_of_deck_under
  // this. (A GIVING HEART banish-in-challenge clause skipped — requires moving
  // a saved cardsUnder pile from one instance to another.)
  {
    set: "011",
    id: "mickey-mouse-bob-cratchit",
    abilities: [
      {
        type: "triggered",
        storyName: "HARD WORK",
        rulesText: "Whenever this character quests, put the top card of your deck facedown under him. (A GIVING HEART banish-in-challenge transfer not wired)",
        trigger: { on: "quests" },
        effects: [{ type: "put_top_of_deck_under", target: { type: "this" } }],
      },
    ],
  },

  // Rapunzel Ethereal Protector — quest trigger with cards-under gate →
  // chosen opp can't be challenged until caster's next turn. Wait, the text
  // is the OPPOSITE: "chosen opposing character can't challenge until the
  // start of your next turn" — that's cant_action "challenge". Use cant_action.
  {
    set: "011",
    id: "rapunzel-ethereal-protector",
    abilities: [
      {
        type: "triggered",
        storyName: "CLONK!",
        rulesText: "Whenever this character quests, if there's a card under her, chosen opposing character can't challenge until the start of your next turn.",
        trigger: { on: "quests" },
        condition: { type: "this_has_cards_under" },
        effects: [
          {
            type: "cant_action",
            action: "challenge",
            duration: "until_caster_next_turn",
            target: { type: "chosen", filter: { ...OPP_CHAR } },
          },
        ],
      },
    ],
  },

  // Minnie Mouse Mrs. Cratchit — enters_play: sequential may (put_top_under
  // own-boost), if-do draw 1.
  {
    set: "011",
    id: "minnie-mouse-mrs-cratchit",
    abilities: [
      {
        type: "triggered",
        storyName: "A MOTHER'S LOVE",
        rulesText: "When you play this character, you may put the top card of your deck facedown under one of your characters or locations with Boost. If you do, draw a card.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            costEffects: [
              {
                type: "put_top_of_deck_under",
                target: { type: "chosen", filter: { ...OWN_BOOST_CARRIER } },
              },
            ],
            rewardEffects: [
              { type: "draw", amount: 1, target: { type: "self" } },
            ],
          },
        ],
      },
    ],
  },

  // Donald Duck Fred Honeywell — keyword-only Boost value fill (side abilities
  // require new trigger events; see header).
  {
    set: "011",
    id: "donald-duck-fred-honeywell",
    keywordValue: 1,
    abilities: [{ type: "keyword", keyword: "boost", value: 1 }],
  },
];

// ─── Apply ────────────────────────────────────────────────────
let totalPatched = 0;
const perCapTally: Record<string, number> = {};
const bumpCap = (k: string) => (perCapTally[k] = (perCapTally[k] ?? 0) + 1);

for (const setNum of ["010", "011"] as const) {
  const path = join(CARDS_DIR, `lorcast-set-${setNum}.json`);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let dirty = false;

  for (const patch of PATCHES) {
    if (patch.set !== setNum) continue;
    const matches = cards.filter((c: any) => c.id === patch.id);
    if (matches.length === 0) { console.warn("MISSING card id:", patch.id); continue; }

    // Replace abilities on EVERY duplicate (Enchanted / variant printings reuse
    // the same id but are separate JSON entries — categorizer counts them all).
    if (patch.abilities) {
      for (const card of matches) card.abilities = patch.abilities;
      dirty = true;
      totalPatched++;
      const card = matches[0];
      // Roughly tally which capability this patch exercises for the report.
      for (const a of patch.abilities) {
        const txt = (a.rulesText ?? "").toLowerCase();
        if (/for each card under/.test(txt)) bumpCap("cards-under-count");
        else if (/whenever you put a card/.test(txt)) bumpCap("card-under-trigger");
        else if (/card under (her|him|it|them|this)/.test(txt) || /card under a character/.test(txt) || /with a card under/.test(txt) || /there'?s? a card under/.test(txt)) bumpCap("card-under-static");
        else if (/cards from under/.test(txt)) bumpCap("cards-under-to-hand");
        else if (/facedown under/.test(txt) || /put the top card.*under/.test(txt)) bumpCap("put-facedown-under-effect");
        else if (/boost \d/.test(txt) || a.type === "keyword" && a.keyword === "boost") bumpCap("boost-subzone");
      }
    }
  }

  writeFileSync(path, JSON.stringify(cards, null, 2));
  console.log(`Wrote ${path}`);
}

console.log(`\nTotal cards patched: ${totalPatched}`);
console.log("Per-capability tally:", perCapTally);
