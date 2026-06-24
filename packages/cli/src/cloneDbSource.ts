// =============================================================================
// CLONE DB SOURCE (ROADMAP Stream 5c, --from-db)
//
// Package-boundary note: the CLI imports `analytics` only; Supabase access is
// server-side. The CLI therefore CANNOT issue a live Supabase query here.
//
// Chosen approach: OPTION (a) — read from an exported JSON dump.
// The user (or a future server endpoint) exports a player's `game_actions`
// rows to a JSON file; this loader consumes that file. This keeps `--from-db`
// working end-to-end TODAY without crossing package boundaries, and gives the
// server a clean target shape to fill.
//
// STUBBED: the live Supabase fetch/export endpoint. server-specialist must wire
// an export that writes a player's recent game_actions rows to JSON (or a
// streaming endpoint the CLI can curl into a file). See HANDOFF.md.
// =============================================================================

import { getAllLegalActions } from "@lorcana-sim/engine";
import type { CardDefinition, GameAction, GameState } from "@lorcana-sim/engine";
import type { CloneSample } from "@lorcana-sim/simulator";
import { loadCloneSamples } from "./loadCloneSamples.js";

export interface DbSourceOptions {
  /** Player username or id whose rows to train on. */
  player: string;
  /** Cap on number of most-recent games (rows are taken in file order). */
  games?: number;
  /**
   * Path to an exported JSON dump of this player's game_actions rows.
   * Until a live server export endpoint exists, this is REQUIRED.
   * Expected shape: an array of game_actions rows
   *   { action, state_before, player_id?, game_id?, turn_number?, legal_action_count? }
   * or an array of CloneSample objects.
   */
  dbExport?: string;
}

/**
 * Resolve CloneSamples for a player from a DB export file.
 *
 * Live Supabase querying is intentionally NOT implemented here (package
 * boundary). When server-specialist ships the export endpoint, this function's
 * contract stays the same — only the acquisition of `dbExport` changes (the CLI
 * could fetch it to a temp file first).
 */
export function loadDbCloneSamples(
  opts: DbSourceOptions,
  definitions: Record<string, CardDefinition>
): CloneSample[] {
  if (!opts.dbExport) {
    console.error(
      "--from-db currently requires --db-export <file.json> (an exported dump of\n" +
      "the player's game_actions rows). A live Supabase export endpoint is not yet\n" +
      "wired — see HANDOFF.md (server-specialist). Once it exists, fetch the dump\n" +
      "to a file and pass it via --db-export."
    );
    process.exit(1);
  }

  // Reuse the same normalizer as --logs (it already accepts game_actions rows
  // and derives legalActionCount from state_before).
  const all = loadCloneSamples([opts.dbExport], definitions);

  // Optional cap on most-recent rows. Export order is assumed chronological;
  // we take the tail so `--games N` ≈ "the player's N most recent games".
  if (opts.games && opts.games > 0) {
    // Group by game_id is unavailable post-normalization, so this caps on rows
    // as a pragmatic proxy until the server export groups by game. Documented
    // as a known approximation in HANDOFF.
    return all.slice(-opts.games * 120);
  }
  return all;
}

// Re-export for callers that want to derive a legal count manually.
export function deriveLegalCount(
  state: GameState,
  action: GameAction,
  definitions: Record<string, CardDefinition>
): number | null {
  if (state.pendingChoice || !action.playerId) return null;
  try {
    return getAllLegalActions(state, action.playerId, definitions).length;
  } catch {
    return null;
  }
}
