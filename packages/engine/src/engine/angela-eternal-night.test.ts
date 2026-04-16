// Verify Angela Night Warrior's ETERNAL NIGHT (remove_named_ability) actually
// works end-to-end. The concern isn't the JSON wiring — it's whether the
// suppressed-ability path in gameModifiers correctly prevents STONE BY DAY
// from blocking ready.
import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import { startGame, LORCAST_CARD_DEFINITIONS, injectCard } from "./test-helpers.js";

describe("Angela Night Warrior ETERNAL NIGHT", () => {
  it("baseline: Demona with 3+ cards in hand can't be effect-readied (Stone by Day blanket)", () => {
    let state = startGame();
    // Demona starts exerted, player1 has 3 cards in hand from opening.
    const { state: s1, instanceId: demonaId } = injectCard(
      state, "player1", "demona-betrayer-of-the-clan", "play",
      { isDrying: false, isExerted: true },
    );
    state = s1;
    expect(state.zones.player1.hand.length).toBeGreaterThanOrEqual(3);

    // Simulate Fan-the-Flames effect-ready (directly call applyEffect path
    // via a synthesized "ready chosen character" flow is awkward from tests;
    // simplest probe: check that turn-start ready loop skips Demona).
    // Pass a full turn cycle so player1 becomes active again.
    for (let i = 0; i < 2; i++) {
      const r = applyAction(state, { type: "PASS_TURN", playerId: state.currentPlayer }, LORCAST_CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    // Demona should still be exerted because STONE BY DAY blocks ready.
    expect(state.cards[demonaId]!.isExerted).toBe(true);
  });

  it("with Angela in play, Gargoyles' Stone by Day is suppressed — Demona rearies", () => {
    let state = startGame();
    const { state: s1, instanceId: angelaId } = injectCard(
      state, "player1", "angela-night-warrior", "play", { isDrying: false },
    );
    state = s1;
    const { state: s2, instanceId: demonaId } = injectCard(
      state, "player1", "demona-betrayer-of-the-clan", "play",
      { isDrying: false, isExerted: true },
    );
    state = s2;

    for (let i = 0; i < 2; i++) {
      const r = applyAction(state, { type: "PASS_TURN", playerId: state.currentPlayer }, LORCAST_CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    // With Angela suppressing STONE BY DAY, Demona readies normally.
    expect(state.cards[demonaId]!.isExerted).toBe(false);
    // Angela itself isn't a Gargoyle only in the sense of... actually she IS
    // Gargoyle (trait) so ETERNAL NIGHT suppresses her own Stone by Day too,
    // but she doesn't have that ability printed. No assertion needed.
    void angelaId;
  });
});
