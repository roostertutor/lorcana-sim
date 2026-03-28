// =============================================================================
// RESULT STORAGE
// Save/load simulation results as JSON files.
// Strips actionLog to keep files manageable (~5-10MB for 5000 games).
// Stopgap — proper indexed storage (SQLite) deferred until we know what
// longitudinal questions we want to ask.
//
// NOTE: fs/path are imported lazily via dynamic import() so that this module
// can be re-exported from the simulator barrel without crashing in browsers.
// Vite externalizes Node built-ins, and top-level imports of "fs" fail at
// module evaluation time even if the functions are never called.
// =============================================================================

import type { GameResult, StoredGameResult, StoredResultSet } from "./types.js";

export async function saveResults(
  results: GameResult[],
  filePath: string,
  metadata: StoredResultSet["metadata"]
): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  const stored: StoredResultSet = {
    metadata,
    results: results.map(stripActionLog),
  };

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(filePath, JSON.stringify(stored), "utf-8");
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log(`  Saved ${results.length} games to ${filePath} (${sizeMB} MB)`);
}

export async function loadResults(filePath: string): Promise<StoredResultSet> {
  const fs = await import("fs");

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
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
