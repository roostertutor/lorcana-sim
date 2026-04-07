// =============================================================================
// SET 4 — Ursula's Return: Sing Together (CRD 8.12)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
} from "./test-helpers.js";
import { getInstance } from "../utils/index.js";

describe("§4 Set 4 — Sing Together", () => {
  it("a-pirate-s-life Sing Together 6: two characters with combined cost ≥ 6 may sing", () => {
    // a-pirate-s-life is Sing Together 6. Use two cost-3 characters (Mickey True Friend + Mickey True Friend).
    let state = startGame();
    let songId: string, singer1Id: string, singer2Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirate-s-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: singer2Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer2Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Both singers exerted, no ink paid.
    expect(getInstance(state, singer1Id).isExerted).toBe(true);
    expect(getInstance(state, singer2Id).isExerted).toBe(true);
  });

  it("Sing Together rejects when combined cost is below the requirement", () => {
    // a-pirate-s-life Sing Together 6, single Mickey (cost 3) is not enough.
    let state = startGame();
    let songId: string, singer1Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirate-s-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Sing Together rejects on a non-Sing-Together song", () => {
    // Reflection (cost 1) has no singTogetherCost — should reject.
    let state = startGame();
    let songId: string, singer1Id: string, singer2Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "reflection", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: singer2Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer2Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Sing Together rejects duplicate singers", () => {
    let state = startGame();
    let songId: string, singer1Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirate-s-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer1Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });
});
