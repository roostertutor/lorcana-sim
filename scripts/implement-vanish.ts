// Wire the vanish keyword on all cards whose rules text begins with
// "Vanish (When an opponent chooses this character for an action, banish them.)"
// — only adds the keyword ability if not already present.
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const CARD_DIR = "packages/engine/src/cards";
let total = 0;

for (const file of readdirSync(join(process.cwd(), CARD_DIR))) {
  if (!file.startsWith("lorcast-set-") || !file.endsWith(".json")) continue;
  const path = join(process.cwd(), CARD_DIR, file);
  const cards = JSON.parse(readFileSync(path, "utf8"));
  let dirty = false;
  for (const c of cards) {
    if (typeof c.rulesText !== "string") continue;
    if (!/Vanish \(When an opponent chooses/i.test(c.rulesText)) continue;
    c.abilities = c.abilities ?? [];
    if (c.abilities.some((a: any) => a?.type === "keyword" && a?.keyword === "vanish")) continue;
    c.abilities.push({ type: "keyword", keyword: "vanish" });
    total++;
    dirty = true;
    console.log(`  + ${c.fullName} (${file.replace("lorcast-set-", "").replace(".json", "")})`);
  }
  if (dirty) writeFileSync(path, JSON.stringify(cards, null, 2));
}
console.log(`Wired vanish keyword on ${total} cards.`);
