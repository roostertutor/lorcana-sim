import { describe, it, expect } from "vitest";
import { makeResolvedRef } from "./index.js";
import { startGame, injectCard, LORCAST_CARD_DEFINITIONS } from "../engine/test-helpers.js";

describe("makeResolvedRef", () => {
  it("builds a snapshot for an in-play character with effective stats", () => {
    let state = startGame();
    const { state: s2, instanceId } = injectCard(
      state,
      "player1",
      "mickey-mouse-true-friend",
      "play"
    );
    state = s2;
    const ref = makeResolvedRef(state, LORCAST_CARD_DEFINITIONS, instanceId);
    expect(ref).toBeDefined();
    expect(ref!.instanceId).toBe(instanceId);
    expect(ref!.definitionId).toBe("mickey-mouse-true-friend");
    expect(ref!.name).toBe("Mickey Mouse");
    expect(ref!.ownerId).toBe("player1");
    expect(ref!.cost).toBe(3);
    expect(ref!.strength).toBe(3);
    expect(ref!.willpower).toBe(3);
    expect(ref!.lore).toBe(2);
    expect(ref!.damage).toBe(0);
  });

  it("returns undefined for unknown instanceId", () => {
    const state = startGame();
    expect(makeResolvedRef(state, LORCAST_CARD_DEFINITIONS, "no-such-id")).toBeUndefined();
  });

  it("captures the delta field when provided", () => {
    let state = startGame();
    const { state: s2, instanceId } = injectCard(
      state,
      "player1",
      "mickey-mouse-true-friend",
      "play",
      { damage: 2 }
    );
    state = s2;
    const ref = makeResolvedRef(state, LORCAST_CARD_DEFINITIONS, instanceId, { delta: 2 });
    expect(ref!.delta).toBe(2);
    expect(ref!.damage).toBe(2);
  });
});
