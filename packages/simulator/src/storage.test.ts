// =============================================================================
// STORAGE ROUND-TRIP TESTS
// Pins the contract that `actions[]` survives save/load (canonical replay
// record per docs/STREAMS.md) while `actionLog` is stripped (regeneratable
// prose projection). Regression for the storage strip fix in commit `5a0fe17`.
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { GameAction, GameLogEntry, PlayerID } from "@lorcana-sim/engine";
import { saveResults, loadResults } from "./storage.js";
import type { GameResult, StoredResultSet } from "./types.js";

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const tmpFiles: string[] = [];

function tmpPath(name: string): string {
  const p = path.join(os.tmpdir(), `lorcana-sim-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
});

function makeResult(overrides: Partial<GameResult> = {}): GameResult {
  const actions: GameAction[] = [
    { type: "RESOLVE_CHOICE", playerId: "player1" as PlayerID, choice: "first" },
    { type: "RESOLVE_CHOICE", playerId: "player1" as PlayerID, choice: ["card-1", "card-2"] },
    { type: "RESOLVE_CHOICE", playerId: "player2" as PlayerID, choice: [] },
    { type: "PLAY_INK", playerId: "player1" as PlayerID, instanceId: "abc-123" },
    { type: "PASS_TURN", playerId: "player1" as PlayerID },
  ];
  const actionLog: GameLogEntry[] = [
    { timestamp: 1, turn: 1, playerId: "player1", message: "player1 mulliganed: X, Y.", type: "mulligan" },
    { timestamp: 2, turn: 1, playerId: "player2", message: "player2 kept their opening hand.", type: "mulligan" },
  ];
  return {
    winner: "player1",
    winReason: "lore_threshold",
    turns: 5,
    finalLore: { player1: 20, player2: 8 },
    actionLog,
    actions,
    seed: 42,
    cardStats: {},
    inkByTurn: { player1: [1, 2, 3], player2: [1, 2, 3] },
    loreByTurn: { player1: [0, 4, 8], player2: [0, 0, 4] },
    botLabels: { player1: "GreedyBot", player2: "GreedyBot" },
    botType: "algorithm",
    mulliganed: { player1: true, player2: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe("storage round-trip", () => {
  it("preserves actions[] across save/load (canonical replay record)", async () => {
    const original = makeResult();
    const filePath = tmpPath("actions-preserved.json");

    await saveResults([original], filePath, {
      deck: "test",
      opponent: "test",
      bot: "GreedyBot",
      iterations: 1,
      timestamp: "2026-04-28",
      engineVersion: "0.0.0",
    });

    const loaded: StoredResultSet = await loadResults(filePath);
    expect(loaded.results).toHaveLength(1);
    const r = loaded.results[0]!;
    expect(r.actions).toBeDefined();
    expect(r.actions).toHaveLength(original.actions.length);
    expect(r.actions).toEqual(original.actions);
  });

  it("strips actionLog from saved files (it's regeneratable from actions[])", async () => {
    const original = makeResult();
    const filePath = tmpPath("actionlog-stripped.json");

    await saveResults([original], filePath, {
      deck: "test",
      opponent: "test",
      bot: "GreedyBot",
      iterations: 1,
      timestamp: "2026-04-28",
      engineVersion: "0.0.0",
    });

    const loaded = await loadResults(filePath);
    const r = loaded.results[0]! as Record<string, unknown>;
    expect(r.actionLog).toBeUndefined();
  });

  it("preserves non-action fields (seed, finalLore, mulliganed, etc.)", async () => {
    const original = makeResult({ seed: 9999 });
    const filePath = tmpPath("scalars-preserved.json");

    await saveResults([original], filePath, {
      deck: "test",
      opponent: "test",
      bot: "GreedyBot",
      iterations: 1,
      timestamp: "2026-04-28",
      engineVersion: "0.0.0",
    });

    const loaded = await loadResults(filePath);
    const r = loaded.results[0]!;
    expect(r.seed).toBe(9999);
    expect(r.winner).toBe("player1");
    expect(r.winReason).toBe("lore_threshold");
    expect(r.finalLore).toEqual({ player1: 20, player2: 8 });
    expect(r.mulliganed).toEqual({ player1: true, player2: false });
  });

  it("round-trips multiple results without cross-contamination", async () => {
    const r1 = makeResult({ seed: 1 });
    const r2 = makeResult({
      seed: 2,
      winner: "player2",
      actions: [
        { type: "RESOLVE_CHOICE", playerId: "player2", choice: "first" },
        { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] },
        { type: "RESOLVE_CHOICE", playerId: "player1", choice: ["x"] },
        { type: "PASS_TURN", playerId: "player2" },
      ],
    });
    const filePath = tmpPath("multi.json");

    await saveResults([r1, r2], filePath, {
      deck: "test",
      opponent: "test",
      bot: "GreedyBot",
      iterations: 2,
      timestamp: "2026-04-28",
      engineVersion: "0.0.0",
    });

    const loaded = await loadResults(filePath);
    expect(loaded.results).toHaveLength(2);
    expect(loaded.results[0]!.seed).toBe(1);
    expect(loaded.results[1]!.seed).toBe(2);
    expect(loaded.results[0]!.actions).toEqual(r1.actions);
    expect(loaded.results[1]!.actions).toEqual(r2.actions);
  });
});
