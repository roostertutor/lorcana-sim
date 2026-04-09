// Wire P3 Travelers cycle: "Whenever this character quests, if you played
// another character this turn, <effect>". 5 of 6 wired (Ariel skipped — its
// effect needs a "must quest next turn" force-quest mechanic not yet built).
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FILE = "packages/engine/src/cards/lorcast-set-0P3.json";

const COND = { type: "played_another_character_this_turn" };

type AbilityShape = any;
const WIRINGS: Record<string, AbilityShape> = {
  // HEED MY WORDS — Maleficent: may exert chosen opposing character.
  "maleficent-imperious-traveler": {
    type: "triggered",
    trigger: { on: "quests" },
    storyName: "HEED MY WORDS",
    rulesText: "Whenever this character quests, if you played another character this turn, you may exert chosen opposing character.",
    condition: COND,
    effects: [
      {
        type: "exert",
        target: { type: "chosen", filter: { owner: { type: "opponent" }, zone: "play", cardType: ["character"] } },
        isMay: true,
      },
    ],
  },
  // YOU'RE OUT OF FASHION — Cruella: may banish chosen damaged character.
  "cruella-de-vil-judgmental-traveler": {
    type: "triggered",
    trigger: { on: "quests" },
    storyName: "YOU'RE OUT OF FASHION",
    rulesText: "Whenever this character quests, if you played another character this turn, you may banish chosen damaged character.",
    condition: COND,
    effects: [
      {
        type: "banish",
        target: { type: "chosen", filter: { zone: "play", cardType: ["character"], hasDamage: true } },
        isMay: true,
      },
    ],
  },
  // ROYAL COMMAND — Queen of Hearts: chosen character gains Rush this turn.
  "queen-of-hearts-impatient-traveler": {
    type: "triggered",
    trigger: { on: "quests" },
    storyName: "ROYAL COMMAND",
    rulesText: "Whenever this character quests, if you played another character this turn, chosen character gains Rush this turn.",
    condition: COND,
    effects: [
      {
        type: "grant_keyword",
        keyword: "rush",
        duration: "this_turn",
        target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
      },
    ],
  },
  // THIS AND THAT — Cinderella: may put top of deck into inkwell exerted.
  "cinderella-resourceful-traveler": {
    type: "triggered",
    trigger: { on: "quests" },
    storyName: "THIS AND THAT",
    rulesText: "Whenever this character quests, if you played another character this turn, you may put the top card of your deck into your inkwell facedown and exerted.",
    condition: COND,
    effects: [
      {
        type: "move_to_inkwell",
        fromZone: "deck",
        target: { type: "this" },
        enterExerted: true,
        isMay: true,
      },
    ],
  },
  // WANDERING SPIRIT — Pocahontas: return a location card from discard to hand.
  "pocahontas-steadfast-traveler": {
    type: "triggered",
    trigger: { on: "quests" },
    storyName: "WANDERING SPIRIT",
    rulesText: "Whenever this character quests, if you played another character this turn, return a location card from your discard to your hand.",
    condition: COND,
    effects: [
      {
        type: "return_to_hand",
        target: { type: "chosen", filter: { owner: { type: "self" }, zone: "discard", cardType: ["location"] } },
      },
    ],
  },
};

const text = readFileSync(join(process.cwd(), FILE), "utf8");
const cards = JSON.parse(text);
let wired = 0;
for (const c of cards) {
  const ability = WIRINGS[c.id];
  if (!ability) continue;
  c.abilities = c.abilities ?? [];
  if (c.abilities.some((a: any) => a?.storyName === ability.storyName)) continue;
  c.abilities.push(ability);
  wired++;
  console.log(`  + ${c.fullName}`);
}
writeFileSync(join(process.cwd(), FILE), JSON.stringify(cards, null, 2));
console.log(`Wired ${wired} Travelers cards.`);
