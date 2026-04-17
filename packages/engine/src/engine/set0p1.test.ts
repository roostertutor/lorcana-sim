// =============================================================================
// SET P1 — Promo: Jolly Roger - Hook's Ship (move-to-self cost reduction)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import { applyMoveCostReduction } from "./validator.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";
import { getInstance } from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";

describe("§P1 Promo — Jolly Roger - Hook's Ship", () => {
  it("ALL HANDS ON DECK!: modifier slot populated with Pirate filter for Jolly Roger", () => {
    // Jolly Roger itself has moveCost 0, so the "for free" reduction is a
    // no-op for moves to Jolly Roger. The static is still correctly registered
    // on the modifier slot keyed by Jolly Roger's instanceId — verified directly.
    let state = startGame();
    let jollyId: string;
    ({ state, instanceId: jollyId } = injectCard(state, "player1", "jolly-roger-hooks-ship", "play", { isDrying: false }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const entries = mods.moveToSelfCostReductions.get(jollyId);
    expect(entries).toBeDefined();
    expect(entries?.length).toBe(1);
    expect(entries?.[0]?.amount).toBe("all");
    expect(entries?.[0]?.filter.hasTrait).toBe("Pirate");
  });

  it("applyMoveCostReduction helper: Pirate gets cost reduced to 0; non-Pirate pays full", () => {
    // Use the helper directly with a synthetic location moveCost of 1.
    let state = startGame();
    let jollyId: string, smeeId: string, mickeyId: string;
    ({ state, instanceId: jollyId } = injectCard(state, "player1", "jolly-roger-hooks-ship", "play", { isDrying: false }));
    ({ state, instanceId: smeeId } = injectCard(state, "player1", "mr-smee-loyal-first-mate", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const smeeInst = getInstance(state, smeeId);
    const smeeDef = CARD_DEFINITIONS[smeeInst.definitionId]!;
    const mickeyInst = getInstance(state, mickeyId);
    const mickeyDef = CARD_DEFINITIONS[mickeyInst.definitionId]!;

    expect(applyMoveCostReduction(2, smeeInst, smeeDef, jollyId, mods, state, "player1")).toBe(0);
    expect(applyMoveCostReduction(2, mickeyInst, mickeyDef, jollyId, mods, state, "player1")).toBe(2);
  });

  it("LOOK ALIVE, YOU SWABS!: characters at Jolly Roger gain Rush via grant_keyword static", () => {
    let state = startGame();
    let jollyId: string, smeeId: string;
    ({ state, instanceId: jollyId } = injectCard(state, "player1", "jolly-roger-hooks-ship", "play", { isDrying: false }));
    ({ state, instanceId: smeeId } = injectCard(state, "player1", "mr-smee-loyal-first-mate", "play", { isDrying: false, atLocationInstanceId: jollyId }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const granted = mods.grantedKeywords.get(smeeId) ?? [];
    expect(granted.some(k => k.keyword === "rush")).toBe(true);
  });
});
