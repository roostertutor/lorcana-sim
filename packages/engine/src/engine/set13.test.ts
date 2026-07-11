// =============================================================================
// SET 13 — card-specific behavior tests
// Only unique patterns; shared mechanics are covered in reducer.test.ts.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect, getAllLegalActions } from "./reducer.js";
import { getGameModifiers } from "./gameModifiers.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
  setLore,
} from "./test-helpers.js";
import { getInstance, getZone } from "../utils/index.js";

// Put a specific instance on the top of a player's deck (deck[0] == top).
function putOnTop(state: any, playerId: string, instanceId: string): any {
  const deck = getZone(state, playerId, "deck").filter((x: string) => x !== instanceId);
  return {
    ...state,
    zones: {
      ...state.zones,
      [playerId]: { ...state.zones[playerId], deck: [instanceId, ...deck] },
    },
  };
}

describe("Set 13 — Absorbing Bloom METAMORPHOSIS", () => {
  it("draws when a character was banished in a challenge this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let bloom: string;
    ({ state, instanceId: bloom } = injectCard(state, "player1", "absorbing-bloom", "play"));
    state = {
      ...state,
      players: {
        ...state.players,
        player1: { ...state.players.player1, aCharacterWasBanishedInChallengeThisTurn: true },
      },
    };
    const before = getZone(state, "player1", "hand").length;
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: bloom, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand").length).toBe(before + 1);
  });

  it("does not draw when no character was banished in a challenge (but still activates)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let bloom: string;
    ({ state, instanceId: bloom } = injectCard(state, "player1", "absorbing-bloom", "play"));
    const before = getZone(state, "player1", "hand").length;
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: bloom, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand").length).toBe(before);
    expect(getInstance(r.newState, bloom).isExerted).toBe(true);
  });
});

describe("Set 13 — My Adventure Book NEW MEMORIES", () => {
  it("puts a revealed non-character card into hand", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let book: string, top: string;
    ({ state, instanceId: book } = injectCard(state, "player1", "my-adventure-book", "play"));
    ({ state, instanceId: top } = injectCard(state, "player1", "absorbing-bloom", "deck")); // item = non-character
    state = putOnTop(state, "player1", top);
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: book, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand")).toContain(top);
  });

  it("puts a revealed non-Kevin character on the bottom of the deck", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let book: string, top: string;
    ({ state, instanceId: book } = injectCard(state, "player1", "my-adventure-book", "play"));
    ({ state, instanceId: top } = injectCard(state, "player1", "mushu-stealthy-dragon", "deck")); // character, not Kevin
    state = putOnTop(state, "player1", top);
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: book, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand")).not.toContain(top);
    const deck = getZone(r.newState, "player1", "deck");
    expect(deck[deck.length - 1]).toBe(top);
  });
});

describe("Set 13 — Randall Boggs AFTER-HOURS PROJECT", () => {
  it("gets +2 lore while all cards in your inkwell are exerted", () => {
    let state = startGame();
    let randall: string, ink: string;
    ({ state, instanceId: randall } = injectCard(state, "player1", "randall-boggs-envious-coworker", "play"));
    ({ state, instanceId: ink } = injectCard(state, "player1", "mickey-mouse-true-friend", "inkwell", { isExerted: true }));
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(randall)?.lore ?? 0).toBe(2);

    // Ready the inkwell card → condition false → no bonus.
    state = { ...state, cards: { ...state.cards, [ink]: { ...getInstance(state, ink), isExerted: false } } };
    mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(randall)?.lore ?? 0).toBe(0);
  });
});

describe("Set 13 — Mushu Stealthy Dragon TIP THE SCALES", () => {
  it("may draw on quest when an opponent has more cards in hand", () => {
    let state = startGame();
    let mushu: string;
    ({ state, instanceId: mushu } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    // Give player2 more cards than player1.
    for (let i = 0; i < 6; i++) ({ state } = injectCard(state, "player2", "mickey-mouse-true-friend", "hand"));
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: mushu }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    const before = getZone(r.newState, "player1", "hand").length;
    const accept = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(getZone(accept.newState, "player1", "hand").length).toBe(before + 1);
  });

  it("does not offer a draw when the opponent does not have more cards", () => {
    let state = startGame();
    let mushu: string;
    ({ state, instanceId: mushu } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    // player1 already has an opening hand ≥ player2; no extra cards for p2.
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: mushu }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice).toBeNull();
  });
});

describe("Set 13 — Mirabel Madrigal MIRACULOUS PROTECTION", () => {
  it("may ready the healed character, then it can't quest or challenge", () => {
    let state = startGame();
    let mirabel: string, ally: string;
    ({ state, instanceId: mirabel } = injectCard(state, "player1", "mirabel-madrigal-family-guardian", "play"));
    ({ state, instanceId: ally } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false, isExerted: true, damage: 3 }));

    state = applyEffect(
      state,
      { type: "remove_damage", amount: 3, target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasDamage: true } } } as any,
      "synthetic", "player1", CARD_DEFINITIONS, [],
    );
    // resolve the remove_damage target choice if surfaced
    if (state.pendingChoice?.type === "choose_target") {
      state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [ally] }, CARD_DEFINITIONS).newState;
    }
    // Mirabel's may-ready prompt
    expect(state.pendingChoice?.type).toBe("choose_may");
    state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS).newState;
    expect(getInstance(state, ally).isExerted).toBe(false); // readied

    // can't quest for the rest of the turn
    const q = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ally }, CARD_DEFINITIONS);
    expect(q.success).toBe(false);
    const legalHasQuest = getAllLegalActions(state, "player1", CARD_DEFINITIONS).some((a: any) => a.type === "QUEST" && a.instanceId === ally);
    expect(legalHasQuest).toBe(false);
  });
});

describe("Set 13 — Dash Parr Super Fast FOLLOW ME!", () => {
  it("offers to reveal the top card on quest", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let dash: string, top: string;
    ({ state, instanceId: dash } = injectCard(state, "player1", "dash-parr-super-fast", "play", { isDrying: false }));
    ({ state, instanceId: top } = injectCard(state, "player1", "mushu-stealthy-dragon", "deck"));
    state = putOnTop(state, "player1", top);
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: dash }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    // Decline reveal → top card stays on deck.
    const decline = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline" }, CARD_DEFINITIONS);
    expect(getZone(decline.newState, "player1", "deck")[0]).toBe(top);
  });
});

describe("Set 13 — Hana's Inkcaster REJUVENATING FLOURISH", () => {
  it("removes up to 2 damage from the chosen character", () => {
    let state = startGame();
    let hana: string, ally: string;
    ({ state, instanceId: hana } = injectCard(state, "player1", "hanas-inkcaster", "play"));
    ({ state, instanceId: ally } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false, damage: 2 }));
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: hana, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [ally] }, CARD_DEFINITIONS);
    expect(getInstance(r.newState, ally).damage).toBe(0);
  });

  // The conditional Resist grant is driven by the effect-level condition
  // `last_resolved_target_has_card_under` on grant_keyword. Exercise it directly
  // (a full ACTIVATE flow can't be used here — injected cardsUnder is normalised
  // away by applyAction; genuine cards-under come from Shift/Boost which is out
  // of scope for a unit test of this gate).
  it("grants Resist +1 only when a card is under the last-resolved target", () => {
    let state = startGame();
    let ally: string, under: string;
    ({ state, instanceId: ally } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    ({ state, instanceId: under } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    const def = CARD_DEFINITIONS["mushu-stealthy-dragon"]!;
    const grant = {
      type: "grant_keyword", keyword: "resist", value: 1, duration: "until_caster_next_turn",
      target: { type: "last_resolved_target" }, condition: { type: "last_resolved_target_has_card_under" },
    } as any;
    const lrt = { instanceId: ally, definitionId: def.id, name: def.name, fullName: def.fullName, ownerId: "player1", cost: def.cost };

    // With a card under → Resist granted.
    let s = { ...state, cards: { ...state.cards, [ally]: { ...getInstance(state, ally), cardsUnder: [under] } }, lastResolvedTarget: lrt };
    s = applyEffect(s, grant, "hana-src", "player1", CARD_DEFINITIONS, []);
    expect(getInstance(s, ally).timedEffects.some((t: any) => t.type === "grant_keyword" && t.keyword === "resist")).toBe(true);

    // No card under → not granted.
    let s2 = { ...state, cards: { ...state.cards, [ally]: { ...getInstance(state, ally), cardsUnder: [] } }, lastResolvedTarget: lrt };
    s2 = applyEffect(s2, grant, "hana-src", "player1", CARD_DEFINITIONS, []);
    expect(getInstance(s2, ally).timedEffects.some((t: any) => t.type === "grant_keyword" && t.keyword === "resist")).toBe(false);
  });
});

describe("Set 13 — Laugh Canister COPYCAT", () => {
  it("puts your top card into your inkwell and lets the opponent optionally do the same", () => {
    let state = startGame();
    let canister: string;
    ({ state, instanceId: canister } = injectCard(state, "player1", "laugh-canister", "play"));
    const p1InkBefore = getZone(state, "player1", "inkwell").length;
    const p2InkBefore = getZone(state, "player2", "inkwell").length;
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: canister, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "inkwell").length).toBe(p1InkBefore + 1);
    // opponent may-prompt
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    expect(r.newState.pendingChoice?.choosingPlayerId).toBe("player2");
    const accept = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept" }, CARD_DEFINITIONS);
    expect(getZone(accept.newState, "player2", "inkwell").length).toBe(p2InkBefore + 1);
  });
});

describe("Set 13 — Power Surge", () => {
  it("each player puts the top 2 cards of their deck into their inkwell exerted", () => {
    let state = startGame();
    state = giveInk(state, "player1", 4);
    let surge: string;
    ({ state, instanceId: surge } = injectCard(state, "player1", "power-surge", "hand"));
    const p1Before = getZone(state, "player1", "inkwell").length;
    const p2Before = getZone(state, "player2", "inkwell").length;
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: surge }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "inkwell").length).toBe(p1Before + 2);
    expect(getZone(r.newState, "player2", "inkwell").length).toBe(p2Before + 2);
    // and they are exerted
    const newInk = getZone(r.newState, "player1", "inkwell").slice(p1Before);
    expect(newInk.every((id: string) => getInstance(r.newState, id).isExerted)).toBe(true);
  });
});

describe("Set 13 engine fix — grant_keyword honors effect-level condition", () => {
  it("What Else Can I Do grants Ward only when sung (played_via_sing gate)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let char: string, song: string;
    ({ state, instanceId: char } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    ({ state, instanceId: song } = injectCard(state, "player1", "what-else-can-i-do", "hand"));
    // Played normally (not sung) → no Ward.
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: song }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    const hasWard = getInstance(r.newState, char).timedEffects.some((t: any) => t.type === "grant_keyword" && t.keyword === "ward");
    expect(hasWard).toBe(false);
  });
});
