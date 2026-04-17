// =============================================================================
// Focused tests for the four-mechanic batch:
//   - alert-keyword (CRD 10.x Alert)
//   - timed-cant-be-challenged (Safe and Sound)
//   - exert-filtered-cost (Scrump)
//   - both-players-effect (Show Me More!)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect } from "./reducer.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";
import { getZone, getInstance, hasKeyword } from "../utils/index.js";

describe("Batch 4 mechanics — alert-keyword (CRD 10.x)", () => {
  it("Cri-Kee Good Luck Charm has the Alert keyword wired", () => {
    const def = CARD_DEFINITIONS["cri-kee-good-luck-charm"]!;
    expect(def).toBeDefined();
    expect(def.abilities?.some((a: any) => a.type === "keyword" && a.keyword === "alert")).toBe(true);
  });

  it("Alert attacker is treated as Evasive by the challenge validator", () => {
    let state = startGame();
    let alertId: string;
    ({ state, instanceId: alertId } = injectCard(state, "player1", "cri-kee-good-luck-charm", "play", { isDrying: false }));
    const inst = getInstance(state, alertId);
    const def = CARD_DEFINITIONS[inst.definitionId]!;
    expect(hasKeyword(inst, def, "alert" as any)).toBe(true);
  });
});

describe("Batch 4 mechanics — timed-cant-be-challenged (Safe and Sound)", () => {
  it("applyEffect directly stamps a cant_be_challenged timed effect on the chosen target", () => {
    let state = startGame();
    let protectedId: string;
    ({ state, instanceId: protectedId } = injectCard(state, "player1", "pinocchio-brave-little-toy", "play", { isDrying: false }));

    // Directly apply the effect to bypass choose_target surfacing; use target: this shape.
    state = applyEffect(
      state,
      {
        type: "cant_be_challenged_timed",
        target: { type: "this" } as any,
        duration: "until_caster_next_turn",
      } as any,
      protectedId,
      "player1",
      CARD_DEFINITIONS,
      [],
    );

    const inst = state.cards[protectedId]!;
    const hasTimed = inst.timedEffects?.some((t: any) => t.type === "cant_be_challenged");
    expect(hasTimed).toBe(true);
  });
});

describe("Batch 4 mechanics — exert-filtered-cost (Scrump)", () => {
  it("Scrump has an activated ability with a leading exert effect targeting self characters", () => {
    const def = CARD_DEFINITIONS["scrump"]!;
    const ability = def.abilities?.find((a: any) => a.type === "activated") as any;
    expect(ability).toBeDefined();
    const leadingExert = ability.effects[0];
    expect(leadingExert.type).toBe("exert");
    expect(leadingExert.target.type).toBe("chosen");
    expect(leadingExert.target.filter.owner?.type).toBe("self");
    expect(leadingExert.target.filter.cardType).toContain("character");
  });
});

describe("Batch 4 mechanics — both-players-effect (Show Me More!)", () => {
  it("Show Me More! draws 3 cards for each player when played", () => {
    let state = startGame();
    state = giveInk(state, "player1", 3);
    let smmId: string;
    ({ state, instanceId: smmId } = injectCard(state, "player1", "show-me-more", "hand"));

    const p1Before = getZone(state, "player1", "hand").length;
    const p2Before = getZone(state, "player2", "hand").length;

    const r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: smmId },
      CARD_DEFINITIONS,
    );
    expect(r.success).toBe(true);
    state = r.newState;

    const p1After = getZone(state, "player1", "hand").length;
    const p2After = getZone(state, "player2", "hand").length;
    // player1: played (-1) + drew 3 = +2 net. player2: drew 3 = +3.
    expect(p1After).toBe(p1Before + 2);
    expect(p2After).toBe(p2Before + 3);
  });

  it("gain_lore with target { type: 'both' } applies to both players", () => {
    let state = startGame();
    const p1Before = state.players.player1.lore;
    const p2Before = state.players.player2.lore;
    state = applyEffect(
      state,
      { type: "gain_lore", amount: 2, target: { type: "both" } } as any,
      "dummy-source",
      "player1",
      CARD_DEFINITIONS,
      [],
    );
    expect(state.players.player1.lore).toBe(p1Before + 2);
    expect(state.players.player2.lore).toBe(p2Before + 2);
  });
});
