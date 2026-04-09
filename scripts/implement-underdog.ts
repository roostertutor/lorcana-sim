// One-shot: wire UNDERDOG (Set 11) self-cost reduction onto all cards whose
// rules text contains "UNDERDOG If this is your first turn". Idempotent —
// re-running is a no-op when the static is already present.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FILES = [
  "packages/engine/src/cards/lorcast-set-011.json",
];

const ABILITY = {
  type: "static",
  storyName: "UNDERDOG",
  rulesText: "If this is your first turn and you're not the first player, you pay 1 {I} less to play this character.",
  condition: { type: "your_first_turn_as_underdog" },
  effect: {
    type: "self_cost_reduction",
    amount: 1,
  },
};

let total = 0;
for (const path of FILES) {
  const text = readFileSync(join(process.cwd(), path), "utf8");
  const cards = JSON.parse(text);
  for (const c of cards) {
    if (typeof c.rulesText !== "string") continue;
    if (!c.rulesText.startsWith("UNDERDOG")) continue;
    c.abilities = c.abilities ?? [];
    if (c.abilities.some((a: any) => a?.storyName === "UNDERDOG")) continue;
    c.abilities.push({ ...ABILITY });
    total++;
    console.log(`  + ${c.fullName}`);
  }
  writeFileSync(join(process.cwd(), path), JSON.stringify(cards, null, 2));
}
console.log(`Wired ${total} UNDERDOG cards.`);
