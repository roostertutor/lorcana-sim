// =============================================================================
// CLONE SAMPLE LOADER
// Reads (state_before, action) training rows from local JSON log files.
//
// Accepts two on-disk shapes per file, each either a single object or an array:
//   (a) CloneSample      — { stateBefore, action, legalActionCount? }
//   (b) game_actions row — { state_before, action, ... }  (server DB / export)
//
// For shape (b) and any (a) without legalActionCount, the count is derived from
// state_before via the engine's legal-action enumerator — so a raw DB dump with
// no legal_action_count column still trains correctly.
// =============================================================================

import { readFileSync } from "fs";
import { getAllLegalActions } from "@lorcana-sim/engine";
import type { CardDefinition, GameAction, GameState } from "@lorcana-sim/engine";
import type { CloneSample } from "@lorcana-sim/simulator";

/** A raw game_actions row as exported from Supabase (snake_case JSONB cols). */
interface GameActionRow {
  action: GameAction;
  state_before: GameState;
  legal_action_count?: number | null;
}

function isGameActionRow(o: unknown): o is GameActionRow {
  return !!o && typeof o === "object" && "state_before" in o && "action" in o;
}

function isCloneSample(o: unknown): o is CloneSample {
  return !!o && typeof o === "object" && "stateBefore" in o && "action" in o;
}

/**
 * Normalize one parsed JSON entry into a CloneSample, deriving legalActionCount
 * from state_before when the source row doesn't carry it.
 */
function toSample(
  entry: unknown,
  definitions: Record<string, CardDefinition>
): CloneSample | null {
  let stateBefore: GameState;
  let action: GameAction;
  let legalActionCount: number | null;

  if (isCloneSample(entry)) {
    stateBefore = entry.stateBefore;
    action = entry.action;
    legalActionCount = entry.legalActionCount ?? null;
  } else if (isGameActionRow(entry)) {
    stateBefore = entry.state_before;
    action = entry.action;
    legalActionCount = entry.legal_action_count ?? null;
  } else {
    return null;
  }

  // Derive legal count if absent (raw DB rows have no legal_action_count column).
  if (legalActionCount === null && action.playerId && !stateBefore.pendingChoice) {
    try {
      legalActionCount = getAllLegalActions(stateBefore, action.playerId, definitions).length;
    } catch {
      legalActionCount = null;
    }
  }

  return { stateBefore, action, legalActionCount };
}

/**
 * Load and flatten CloneSamples from one or more JSON log files. Each file may
 * contain a single sample/row or an array of them, in either supported shape.
 */
export function loadCloneSamples(
  filePaths: string[],
  definitions: Record<string, CardDefinition>
): CloneSample[] {
  const out: CloneSample[] = [];

  for (const path of filePaths) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf-8"));
    } catch (e) {
      console.error(`Error: could not read/parse log file "${path}":`, e instanceof Error ? e.message : e);
      process.exit(1);
    }

    const entries = Array.isArray(raw) ? raw : [raw];
    let kept = 0;
    for (const entry of entries) {
      const sample = toSample(entry, definitions);
      if (sample) {
        out.push(sample);
        kept++;
      }
    }
    console.log(`  ${path}: ${kept}/${entries.length} rows loaded`);
  }

  return out;
}
