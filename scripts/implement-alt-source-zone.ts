#!/usr/bin/env node
// =============================================================================
// ALT-SOURCE-ZONE batch — wires cards that "play X from your discard" using
// the existing `play_for_free` effect with `sourceZone: "discard"`. No engine
// change required; the primitive landed with Ursula - Deceiver of All
// (set 3) and has been used by Max Goof - Chart Topper (set 9) since.
//
// Skipped (and why):
//   - [5]  Pride Lands - Jungle Oasis: wired here with the new
//          `characters_here_gte` condition. (wired below, not skipped)
//   - [10] The Black Cauldron: "This turn, you may play characters from under
//          this item" — persistent paid-play relaxation from an alternate
//          zone. Different mechanic (relaxation of play restriction + paid
//          play-from-under). Not play_for_free.
//   - [10] Lady Tremaine - Sinister Socialite: gated on "if you've put a
//          card under her this turn" — event-tracking condition not yet
//          implemented.
//   - [11] Chernabog - Unnatural Force: "that player may play a character
//          from their discard for free" — cross-player play_for_free where
//          the OPPONENT is the acting player. Requires player-direction
//          routing on play_for_free that we don't yet have.
//   - [11] Moana - Curious Explorer: "You can ink cards from your discard"
//          is an ink-step alternate source, not a play-for-free. Separate
//          mechanic (`ink-from-discard`).
//
// Wired:
//   - [5] Pride Lands - Jungle Oasis (OUR HUMBLE HOME)
//   - [9] Circle of Life (x2 printings) — action effect
// =============================================================================

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

type SetKey = "005" | "009";
type Patch = {
  set: SetKey;
  id: string;
  abilities?: any[];
  actionEffects?: any[];
};

const PATCHES: Patch[] = [
  // ────────────────────────── SET 5 ──────────────────────────
  // Pride Lands - Jungle Oasis (location)
  // "OUR HUMBLE HOME While you have 3 or more characters here, you may banish
  //  this location to play a character from your discard for free."
  {
    set: "005",
    id: "pride-lands-jungle-oasis",
    abilities: [
      {
        type: "activated",
        storyName: "OUR HUMBLE HOME",
        rulesText:
          "While you have 3 or more characters here, you may banish this location to play a character from your discard for free.",
        // "banish this location" is written as a cost in rules text, but we
        // evaluate it as an effect here so the `characters_here_gte` condition
        // runs BEFORE the location banishes (which clears atLocationInstanceId
        // on resident characters). This is semantically identical for a single
        // activation — the player still loses the location and plays the card —
        // and avoids a spurious fizzle on the 3rd character after self-banish.
        condition: {
          type: "characters_here_gte",
          amount: 3,
          player: { type: "self" },
        },
        costs: [],
        effects: [
          { type: "banish", target: { type: "this" } },
          {
            type: "play_for_free",
            sourceZone: "discard",
            filter: {
              zone: "discard",
              cardType: ["character"],
            },
            isMay: true,
          },
        ],
      },
    ],
  },
  // ────────────────────────── SET 9 ──────────────────────────
  // Circle of Life (action with Sing Together 8)
  // "Play a character from your discard for free."
  {
    set: "009",
    id: "circle-of-life",
    actionEffects: [
      {
        type: "play_for_free",
        sourceZone: "discard",
        filter: {
          zone: "discard",
          cardType: ["character"],
        },
        isMay: true,
      },
    ],
  },
];

const SET_FILE_BY_KEY: Record<SetKey, string> = {
  "005": "lorcast-set-005.json",
  "009": "lorcast-set-009.json",
};

let totalPatched = 0;
const missing: string[] = [];

const setKeys = [...new Set(PATCHES.map((p) => p.set))];
for (const setKey of setKeys) {
  const path = join(CARDS_DIR, SET_FILE_BY_KEY[setKey]);
  const cards = JSON.parse(readFileSync(path, "utf-8"));
  let dirty = false;
  for (const patch of PATCHES) {
    if (patch.set !== setKey) continue;
    const matches = cards.filter((c: any) => c.id === patch.id);
    if (matches.length === 0) {
      console.warn(`MISSING card id: [${setKey}] ${patch.id}`);
      missing.push(`[${setKey}] ${patch.id}`);
      continue;
    }
    for (const card of matches) {
      if (patch.abilities) card.abilities = patch.abilities;
      if (patch.actionEffects) card.actionEffects = patch.actionEffects;
    }
    dirty = true;
    totalPatched += matches.length;
  }
  if (dirty) {
    writeFileSync(path, JSON.stringify(cards, null, 2));
    console.log(`Wrote ${path}`);
  }
}

console.log(`\nTotal cards patched: ${totalPatched}`);
if (missing.length) console.log(`Missing:`, missing);
