// =============================================================================
// DECK LOADER
// Reads a .txt decklist from disk and returns DeckEntry[].
// Exits with a helpful error if the file is missing or entries fail to parse.
// =============================================================================

import { readFileSync } from "fs";
import { parseDecklist } from "@lorcana-sim/engine";
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";

export function loadDeck(filePath: string, definitions: Record<string, CardDefinition>): DeckEntry[] {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch {
    console.error(`Error: could not read deck file "${filePath}"`);
    process.exit(1);
  }

  const { entries, errors } = parseDecklist(text, definitions);

  if (errors.length > 0) {
    console.error("Deck parse errors:");
    for (const e of errors) console.error(`  ${e}`);
    if (entries.length === 0) process.exit(1);
    console.error(`Continuing with ${entries.length} valid entries.\n`);
  }

  if (entries.length === 0) {
    console.error("Error: deck is empty after parsing.");
    process.exit(1);
  }

  return entries;
}
