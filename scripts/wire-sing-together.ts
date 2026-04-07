// Scratch: scan sets 4–11 for Sing Together songs and add `singTogetherCost`
// extracted from the rules text.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sets = ["004", "005", "006", "007", "008", "009", "010", "011"];
let updated = 0;

for (const setId of sets) {
  const path = join("packages/engine/src/cards", `lorcast-set-${setId}.json`);
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { continue; }
  const data = JSON.parse(raw) as Array<Record<string, unknown>>;

  for (const card of data) {
    if (card.singTogetherCost !== undefined) continue; // already wired
    const rules = (card.rulesText as string | undefined) ?? "";
    const match = /Sing Together (\d+)/.exec(rules);
    if (!match) continue;
    const n = parseInt(match[1]!, 10);
    card.singTogetherCost = n;
    updated++;
    console.log(`  set ${setId}: ${card.id} → singTogetherCost ${n}`);
  }

  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

console.log(`\nWired ${updated} cards across sets 4–11.`);
