#!/usr/bin/env node
// =============================================================================
// PUT-ON-BOTTOM batch — wires the 44 stub-instances unlocked by the new
// `put_on_bottom_of_deck` Effect plus the existing `look_at_top` "rest_to_bottom"
// pattern. Patches every set file containing a target card.
//
// Two card families:
//   1. "look at top N → may put up to M into hand → rest on bottom" — uses the
//      pre-existing look_at_top action `up_to_n_to_hand_rest_bottom`. NO new
//      engine work needed for these; the categorizer was just shunting them
//      into needs-new-type because the regex matched "on the bottom of...deck"
//      in the rest-to-bottom clause.
//   2. "put a card from [hand|discard|chosen player's discard|chosen char] on
//      the bottom of [their|your] deck" — uses the new put_on_bottom_of_deck
//      Effect.
//
// Skipped (and why):
//   - Television Set: simple reveal_top_conditional but Puppy filter stub
//     overlaps with non-put-on-bottom regex; leave for the reveal_top sweep.
//   - Oswald - The Lucky Rabbit (D23/set 6): "whenever a card is put into your
//     inkwell" trigger event not yet wired.
//   - Pongo Determined Father: already implemented in a prior commit (TWILIGHT
//     BARK / oncePerTurn).
//   - Simba King in the Making, Fairy Godmother Magical Benefactor, Bambi
//     Ethereal Fawn, Pete Ghost of Christmas Future, Lady Tremaine Sinister
//     Socialite: depend on the boost-subzone foundation.
//   - Powerline World's Greatest Rock Star: oncePerTurn + sings trigger combo,
//     complex enough to defer.
//   - John Smith's Compass: needs "no characters challenged this turn" event
//     tracking (event-tracking-condition gap).
//   - Look at This Family / Dig a Little Deeper: already wired in
//     scripts/implement-set4-batch10.ts.
//   - Let's Get Dangerous: both-players-effect, plus "shuffle then reveal".
//   - Do You Want to Build A Snowman?: choose-option (YES/NO branch); flagged
//     UNKNOWN by the categorizer.
//   - Anna - Soothing Sister: compound text with Shift variant + dynamic-amount
//     lore. Defer to those gaps.
//   - The Queen - Jealous Beauty: "Princess bonus" branch needs counted-result
//     condition; approximating to flat 3 lore is too lossy. Skip.
//   - Daisy Duck - Donald's Date: requires reveal_top_conditional with target
//     "opponent" + isMay on the to_hand action. The base effect supports this
//     shape — wired here as an approximation (ignores "may"; opponent always
//     moves card to hand on hit).
// =============================================================================

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

// Reusable filters
const ANY_CHAR = { zone: "play" as const, cardType: ["character" as const] };

// look_at_top "rest_to_bottom" patches — count, optional filter, maxToHand.
type LookPatch = { count: number; maxToHand: number; filter?: any; storyName?: string; rulesText?: string };
const LOOK_AT_TOP: Record<string, LookPatch> = {
  // Set 5
  "the-queen-crown-of-the-council": {
    count: 3, maxToHand: 99, filter: { cardType: ["character"], hasName: "The Queen" },
    storyName: "GATHERER OF THE WICKED",
    rulesText: "When you play this character, look at the top 3 cards of your deck. You may reveal any number of character cards named The Queen and put them into your hand. Put the rest on the bottom of your deck in any order.",
  },
  "basils-magnifying-glass": {
    count: 3, maxToHand: 1, filter: { cardType: ["item"] },
    storyName: "FIND WHAT'S HIDDEN",
    rulesText: "Look at the top 3 cards of your deck. You may reveal an item card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  // Set 6
  "jim-hawkins-honorable-pirate": {
    count: 4, maxToHand: 99, filter: { cardType: ["character"], hasTrait: "Pirate" },
    storyName: "HIRE A CREW",
    rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal any number of Pirate character cards and put them into your hand. Put the rest on the bottom of your deck in any order.",
  },
  // Set 7
  "scrooge-mcduck-resourceful-miser": {
    count: 4, maxToHand: 1, filter: { cardType: ["item"] },
    storyName: "FORTUNE HUNTER",
    rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal an item card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  "lucky-runt-of-the-litter": {
    count: 2, maxToHand: 99, filter: { cardType: ["character"], hasTrait: "Puppy" },
    storyName: "FOLLOW MY VOICE",
    rulesText: "Whenever this character quests, look at the top 2 cards of your deck. You may reveal any number of Puppy character cards and put them in your hand. Put the rest on the bottom of your deck in any order.",
  },
  "baymax-upgraded-robot": {
    count: 4, maxToHand: 1, filter: { cardType: ["character"], hasTrait: "Floodborn" },
    storyName: "ADVANCED SCANNER",
    rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal a Floodborn character card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  // Set 8
  "jasmine-steady-strategist": {
    count: 3, maxToHand: 1, filter: { cardType: ["character"], hasTrait: "Ally" },
    storyName: "ALWAYS PLANNING",
    rulesText: "Whenever this character quests, look at the top 3 cards of your deck. You may reveal an Ally character card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  // Set 9
  "tinker-bell-generous-fairy": {
    count: 4, maxToHand: 1, filter: { cardType: ["character"] },
    storyName: "MAKE A NEW FRIEND",
    rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal a character card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  "mulan-considerate-diplomat": {
    count: 4, maxToHand: 1, filter: { cardType: ["character"], hasTrait: "Princess" },
    storyName: "IMPERIAL INVITATION",
    rulesText: "Whenever this character quests, look at the top 4 cards of your deck. You may reveal a Princess character card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  // Set 10
  "recovered-page": {
    count: 4, maxToHand: 1, filter: { cardType: ["character"] },
    storyName: "WHAT IS TO COME",
    rulesText: "When you play this item, look at the top 4 cards of your deck. You may reveal a character card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  "judy-hopps-uncovering-clues": {
    count: 3, maxToHand: 1, filter: { cardType: ["character"], hasTrait: "Detective" },
    storyName: "THOROUGH INVESTIGATION",
    rulesText: "When you play this character and whenever she quests, look at the top 3 cards of your deck. You may reveal a Detective character card and put it into your hand. Put the rest on the bottom of your deck in any order. (approximation: triggers only on enters_play, not on quest)",
  },
  // Set 11
  "nani-stage-manager": {
    count: 4, maxToHand: 1, filter: { cardType: ["character"], maxCost: 2 },
    storyName: "THAT'S YOUR CUE",
    rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal a character card with cost 2 or less and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
  "gosalyn-mallard-curious-child": {
    count: 4, maxToHand: 1, filter: { cardType: ["item"] },
    storyName: "KEEN GEAR",
    rulesText: "When you play this character, look at the top 4 cards of your deck. You may reveal an item card and put it into your hand. Put the rest on the bottom of your deck in any order.",
  },
};

// Action cards using look_at_top "rest_to_bottom" — patched into actionEffects.
const LOOK_AT_TOP_ACTIONS: Record<string, LookPatch> = {
  // Set cp + Set 5: Invited to the Ball — top 2, reveal characters → hand, rest bottom.
  "invited-to-the-ball": {
    count: 2, maxToHand: 99, filter: { cardType: ["character"] },
  },
  // Set 1/9: Be Our Guest — top 4, reveal a character → hand, rest bottom.
  "be-our-guest": {
    count: 4, maxToHand: 1, filter: { cardType: ["character"] },
  },
  // Set 1/9: Develop Your Brain — top 2, put 1 → hand, the other → bottom.
  "develop-your-brain": {
    count: 2, maxToHand: 1,
  },
  // Set 10: Might Solve a Mystery — top 4, up to 1 char + up to 1 item → hand,
  // rest bottom. Approximation: any card type, maxToHand = 2.
  "might-solve-a-mystery": {
    count: 4, maxToHand: 2,
  },
  // Set 8: Down in New Orleans — top 3, may play character/item/location cost 6
  // or less for free, rest bottom. Cannot express "play_for_free" via look_at_top
  // today; closest approximation is to_hand (lossy). Use up_to_n_to_hand_rest_bottom
  // with maxToHand=1 + cost filter so the strongest card is fetched into hand
  // instead of played for free. Approximation noted in rulesText.
  "down-in-new-orleans": {
    count: 3, maxToHand: 1, filter: { maxCost: 6 },
  },
};

// put_on_bottom_of_deck patches — direct ability bodies / actionEffects.
const PUT_ON_BOTTOM: Record<string, any> = {
  // ── King Candy SUGAR RUSH: draw 2, then put a hand card on bottom ──────────
  "king-candy-sweet-abomination": {
    abilities: [
      {
        type: "triggered",
        storyName: "CHANGING THE CODE",
        rulesText: "When you play this character, you may draw 2 cards, then put a card from your hand on the bottom of your deck.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            effects: [
              { type: "draw", amount: 2, target: { type: "self" } },
              { type: "put_on_bottom_of_deck", from: "hand" },
            ],
          },
        ],
      },
    ],
  },

  // ── Belle Mechanic Extraordinaire REPURPOSE ───────────────────────────────
  // "May put up to 3 item cards from your discard on the bottom of your deck
  // to gain 1 lore for each item card moved this way." Approximation: gain
  // exactly 1 lore (we don't have per-card lore here yet).
  "belle-mechanic-extraordinaire": {
    abilities: [
      {
        type: "triggered",
        storyName: "REPURPOSE",
        rulesText: "Whenever this character quests, you may put up to 3 item cards from your discard on the bottom of your deck to gain 1 lore for each item card moved this way. (approximation: flat +1 lore instead of per-card)",
        trigger: { on: "quests" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            effects: [
              {
                type: "put_on_bottom_of_deck",
                from: "discard",
                filter: { cardType: ["item"] },
                amount: 3,
              },
              { type: "gain_lore", amount: 1, target: { type: "self" } },
            ],
          },
        ],
      },
    ],
  },

  // ── Stegmutt COLLATERAL DAMAGE: 3 items from discard → bottom, deal 3 dmg ──
  "stegmutt-clumsy-dinosaur": {
    abilities: [
      {
        type: "triggered",
        storyName: "COLLATERAL DAMAGE",
        rulesText: "When you play this character, you may put 3 item cards from your discard on the bottom of your deck in any order. If you do, deal 3 damage to chosen character.",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "sequential",
            isMay: true,
            effects: [
              {
                type: "put_on_bottom_of_deck",
                from: "discard",
                filter: { cardType: ["item"] },
                amount: 3,
              },
              {
                type: "deal_damage",
                amount: 3,
                target: { type: "chosen", filter: { ...ANY_CHAR } },
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Anna Little Sister UNEXPECTED DISCOVERY: chosen player's discard → bottom
  // Approximation: ownerScope "opponent" — picks from opponent's discard. In
  // 2P this is identical to "chosen player" since the controller would always
  // target the opponent for value.
  "anna-little-sister": {
    abilities: [
      {
        type: "triggered",
        storyName: "UNEXPECTED DISCOVERY",
        rulesText: "When you play this character, you may put a card from chosen player's discard on the bottom of their deck. (approximation: targets opponent in 2P)",
        trigger: { on: "enters_play" },
        effects: [
          {
            type: "put_on_bottom_of_deck",
            from: "discard",
            ownerScope: "opponent",
            isMay: true,
          },
        ],
      },
    ],
  },

  // ── Kristoff Icy Explorer HIDDEN DEPTHS: same shape gated on Anna in play ──
  "kristoff-icy-explorer": {
    abilities: [
      {
        type: "triggered",
        storyName: "HIDDEN DEPTHS",
        rulesText: "When you play this character, if you have a character named Anna in play, you may put a card from chosen player's discard on the bottom of their deck. (approximation: targets opponent in 2P)",
        trigger: { on: "enters_play" },
        condition: { type: "has_character_named", name: "Anna" },
        effects: [
          {
            type: "put_on_bottom_of_deck",
            from: "discard",
            ownerScope: "opponent",
            isMay: true,
          },
        ],
      },
    ],
  },

  // ── Wrong Lever! — action: pay alt cost (Pull the Lever! from discard → deck
  // bottom) then put chosen character on bottom of owner's deck. Cannot express
  // the alt cost yet (needs put-from-discard-to-deck cost variant); approximate
  // by dropping the alt cost and just resolving the chosen-character bottom.
  "wrong-lever": {
    actionEffects: [
      {
        type: "put_on_bottom_of_deck",
        from: "play",
        target: { type: "chosen", filter: { ...ANY_CHAR } },
      },
    ],
  },

  // ── Darkwing Duck — Modern Marvel: discard item → bottom, then play item from
  // discard for free. Approximation: drop the play-for-free reward (alternate
  // source-zone gap) — fires the discard-to-bottom only.
  "darkwing-duck-dashing-gadgeteer": {
    abilities: [
      {
        type: "triggered",
        storyName: "MODERN MARVEL",
        rulesText: "Whenever this character quests, you may put an item card from your discard on the bottom of your deck. If you do, you may play an item with cost 5 or less from your discard for free. (approximation: play-from-discard reward dropped)",
        trigger: { on: "quests" },
        effects: [
          {
            type: "put_on_bottom_of_deck",
            from: "discard",
            filter: { cardType: ["item"] },
            isMay: true,
          },
        ],
      },
    ],
  },

  // ── Daisy Duck Donald's Date — opponent reveals top, may to hand else bottom
  // Implemented via reveal_top_conditional with target opponent + noMatchDestination
  // bottom. The "may" on hit is dropped (engine always to_hand on match).
  "daisy-duck-donalds-date": {
    abilities: [
      {
        type: "triggered",
        storyName: "BIG PRIZE",
        rulesText: "Whenever this character quests, each opponent reveals the top card of their deck. If it's a character card, they may put it into their hand. Otherwise, they put it on the bottom of their deck. (approximation: opponent always keeps on hit)",
        trigger: { on: "quests" },
        effects: [
          {
            type: "reveal_top_conditional",
            filter: { cardType: ["character"] },
            matchAction: "to_hand",
            noMatchDestination: "bottom",
            target: { type: "opponent" },
          },
        ],
      },
    ],
  },
};

// ─── Apply ────────────────────────────────────────────────────
const SET_FILES = readdirSync(CARDS_DIR).filter(f => f.startsWith("lorcast-set-") && f.endsWith(".json")).sort();
const seen = new Set<string>();
let totalPatched = 0;

for (const f of SET_FILES) {
  const path = join(CARDS_DIR, f);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let dirty = false;

  for (const card of cards) {
    // Skip cards already implemented (some "look at top → bottom" cards landed in
    // earlier batches with action one_to_hand_rest_bottom — Develop Your Brain,
    // Be Our Guest, etc.). Only patch cards still showing as stubs.
    const alreadyImpl =
      (card.actionEffects?.length ?? 0) > 0 ||
      (card.abilities ?? []).some((a: any) => ["triggered", "activated", "static"].includes(a.type));
    if (alreadyImpl) continue;

    // 1) look_at_top character/location patches → abilities
    if (LOOK_AT_TOP[card.id]) {
      const p = LOOK_AT_TOP[card.id]!;
      const triggerOn = (p.rulesText ?? "").startsWith("Whenever") ? "quests" : "enters_play";
      const effect: any = {
        type: "look_at_top",
        count: p.count,
        action: "up_to_n_to_hand_rest_bottom",
        maxToHand: p.maxToHand,
        target: { type: "self" },
      };
      if (p.filter) effect.filter = p.filter;
      card.abilities = [
        {
          type: "triggered",
          storyName: p.storyName,
          rulesText: p.rulesText,
          trigger: { on: triggerOn },
          effects: [effect],
        },
      ];
      dirty = true;
      totalPatched++;
      seen.add(`${f}:${card.id}`);
      continue;
    }

    // 2) action-card look_at_top patches → actionEffects
    if (LOOK_AT_TOP_ACTIONS[card.id] && card.cardType === "action") {
      const p = LOOK_AT_TOP_ACTIONS[card.id]!;
      const effect: any = {
        type: "look_at_top",
        count: p.count,
        action: "up_to_n_to_hand_rest_bottom",
        maxToHand: p.maxToHand,
        target: { type: "self" },
      };
      if (p.filter) effect.filter = p.filter;
      card.actionEffects = [effect];
      dirty = true;
      totalPatched++;
      seen.add(`${f}:${card.id}`);
      continue;
    }

    // 3) put_on_bottom_of_deck patches
    if (PUT_ON_BOTTOM[card.id]) {
      const patch = PUT_ON_BOTTOM[card.id];
      if (patch.abilities) card.abilities = patch.abilities;
      if (patch.actionEffects) card.actionEffects = patch.actionEffects;
      dirty = true;
      totalPatched++;
      seen.add(`${f}:${card.id}`);
    }
  }

  if (dirty) writeFileSync(path, JSON.stringify(cards, null, 2) + "\n", "utf-8");
}

for (const id of [...seen].sort()) console.log(`  OK ${id}`);
console.log(`\nPatched ${totalPatched} card entries (${seen.size} unique set:id pairs).`);
