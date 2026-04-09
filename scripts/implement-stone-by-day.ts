// Wire STONE BY DAY ability across all Gargoyle cards. Idempotent.
// Removes any existing malformed STONE BY DAY entry (with condition nested
// inside the effect) and replaces it with the correct shape (condition at
// the ability level, plain cant_action_self effect).
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const CARD_DIR = "packages/engine/src/cards";

const ABILITY = {
  type: "static",
  storyName: "STONE BY DAY",
  rulesText: "If you have 3 or more cards in your hand, this character can't ready.",
  condition: { type: "cards_in_hand_gte", amount: 3, player: { type: "self" } },
  effect: { type: "cant_action_self", action: "ready" },
};

let total = 0;
for (const file of readdirSync(join(process.cwd(), CARD_DIR))) {
  if (!file.startsWith("lorcast-set-") || !file.endsWith(".json")) continue;
  const path = join(process.cwd(), CARD_DIR, file);
  const text = readFileSync(path, "utf8");
  const cards = JSON.parse(text);
  let dirty = false;
  for (const c of cards) {
    if (typeof c.rulesText !== "string") continue;
    if (!c.rulesText.includes("STONE BY DAY")) continue;
    c.abilities = c.abilities ?? [];
    // Drop any existing STONE BY DAY ability (malformed or otherwise).
    const before = c.abilities.length;
    c.abilities = c.abilities.filter((a: any) => a?.storyName !== "STONE BY DAY");
    if (c.abilities.length !== before) dirty = true;
    c.abilities.push({ ...ABILITY });
    total++;
    dirty = true;
    console.log(`  + ${c.fullName} (${file.replace("lorcast-set-", "").replace(".json", "")})`);
  }
  if (dirty) writeFileSync(path, JSON.stringify(cards, null, 2));
}
console.log(`Wired/fixed STONE BY DAY on ${total} cards.`);
