// Regression test: applyAction must not mutate the caller's `state.rng`.
//
// Why: `rngNext` mutates `state.rng.s` in place for performance. Without a
// clone at applyAction's entry, any state reference the caller holds — the
// UI's `initialStateRef`, a quicksave buffer, a branching-sim checkpoint,
// React's prior-render state — would have its rng advanced by every
// RNG-consuming action. Deterministic replay (undo, save/load, replay
// tooling) depends on these held references preserving their original seed.
//
// The failure mode this catches:
//   1. Capture `initialRef = state` after createGame.
//   2. Player quests Fred Giant-Sized (shuffle deck if no Floodborn match).
//   3. Undo: replay from `initialRef` expecting the original seed.
//   4. But `initialRef.rng.s` was mutated in place by step 2's shuffle, so
//      the replay starts from an already-advanced seed and produces a
//      different game than the original.
import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import { startGame, CARD_DEFINITIONS, injectCard } from "./test-helpers.js";

describe("applyAction RNG isolation", () => {
  it("does not mutate the caller's rng.s array", () => {
    let state = startGame();

    // Snapshot the rng array of the caller's state reference.
    const callerStateRef = state;
    const seedSnapshot = [...callerStateRef.rng.s] as [number, number, number, number];

    // Fire an RNG-consuming action: Fred Giant-Sized's quest trigger falls
    // through to the no-match shuffle branch (deck has no Floodborn cards).
    const fred = injectCard(state, "player1", "fred-giant-sized", "play", { isDrying: false });
    state = fred.state;
    // Re-capture the snapshot now that injectCard also ran through
    // applyAction paths (injectCard itself doesn't, but belt-and-suspenders).
    const beforeQuest = [...state.rng.s] as [number, number, number, number];

    const r = applyAction(
      state,
      { type: "QUEST", playerId: "player1", instanceId: fred.instanceId },
      CARD_DEFINITIONS,
    );
    expect(r.success).toBe(true);

    // The returned newState should have an advanced rng.
    expect([...r.newState.rng.s]).not.toEqual(beforeQuest);

    // But the caller's state reference must be untouched.
    expect([...state.rng.s]).toEqual(beforeQuest);

    // And the originally-captured reference from game start must still hold
    // its pristine seed — this is the property the UI's undo relies on.
    expect([...callerStateRef.rng.s]).toEqual(seedSnapshot);
  });

  it("replaying a quest from an initial state reference produces the same outcome", () => {
    // Simulates UI undo: capture initial state, play an RNG-consuming action,
    // then replay the same action from the initial state. With rng isolation,
    // both runs must produce byte-identical newState.rng arrays.
    let state = startGame();
    const fred = injectCard(state, "player1", "fred-giant-sized", "play", { isDrying: false });
    state = fred.state;

    const initialRef = state;
    const action = { type: "QUEST" as const, playerId: "player1" as const, instanceId: fred.instanceId };

    const run1 = applyAction(initialRef, action, CARD_DEFINITIONS);
    const run2 = applyAction(initialRef, action, CARD_DEFINITIONS);

    expect(run1.success).toBe(true);
    expect(run2.success).toBe(true);
    // Same starting state → same outcome. If applyAction mutated initialRef's
    // rng during run1, run2 would start from a different seed and diverge.
    expect([...run1.newState.rng.s]).toEqual([...run2.newState.rng.s]);
  });
});
