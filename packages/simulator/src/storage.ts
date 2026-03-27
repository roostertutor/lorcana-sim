// =============================================================================
// RESULT STORAGE
// Save/load simulation results as JSON files.
// Strips actionLog to keep files manageable (~5-10MB for 5000 games).
// Stopgap — proper indexed storage (SQLite) deferred until we know what
// longitudinal questions we want to ask.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { dirname } from "path";
import type { GameResult, StoredGameResult, StoredResultSet } from "./types.js";

export function saveResults(
  results: GameResult[],
  filePath: string,
  metadata: StoredResultSet["metadata"]
): void {
  const stored: StoredResultSet = {
    metadata,
    results: results.map(stripActionLog),
  };

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(filePath, JSON.stringify(stored), "utf-8");
  const sizeMB = (statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log(`  Saved ${results.length} games to ${filePath} (${sizeMB} MB)`);
}

export function loadResults(filePath: string): StoredResultSet {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Results file not found: ${filePath}`);
  }

  const parsed = JSON.parse(raw);

  // Support both formats: bare GameResult[] (old) and StoredResultSet (new)
  if (Array.isArray(parsed)) {
    return {
      metadata: {
        deck: "unknown",
        opponent: "unknown",
        bot: "unknown",
        iterations: parsed.length,
        timestamp: "unknown",
        engineVersion: "unknown",
      },
      results: parsed as StoredGameResult[],
    };
  }

  return parsed as StoredResultSet;
}

function stripActionLog(result: GameResult): StoredGameResult {
  const { actionLog: _, ...rest } = result;
  return rest;
}
