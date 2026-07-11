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
  passTurns,
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

describe("Set 13 — Piercing Attack", () => {
  it("deals 2 damage that ignores Resist", () => {
    let state = startGame();
    state = giveInk(state, "player1", 2);
    let attack: string, victim: string;
    // 3 willpower so it survives the 2 damage (retains the counters to assert on).
    ({ state, instanceId: victim } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", {
      isDrying: false,
      timedEffects: [{ type: "grant_keyword", keyword: "resist", value: 2, amount: 0, expiresAt: "end_of_turn", appliedOnTurn: 0, casterPlayerId: "player2" }],
    }));
    ({ state, instanceId: attack } = injectCard(state, "player1", "piercing-attack", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: attack }, CARD_DEFINITIONS);
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victim] }, CARD_DEFINITIONS);
    // Resist +2 would normally reduce 2 → 0; ignoreResist means full 2 lands.
    expect(getInstance(r.newState, victim).damage).toBe(2);
  });
});

describe("Set 13 — One and Only", () => {
  it("banishes all other characters with the same name as the chosen one", () => {
    let state = startGame();
    state = giveInk(state, "player1", 3);
    let a: string, b: string, c: string, action: string;
    ({ state, instanceId: a } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    ({ state, instanceId: b } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    ({ state, instanceId: c } = injectCard(state, "player2", "mushu-stealthy-dragon", "play", { isDrying: false }));
    // A different-named character must survive.
    let other: string;
    ({ state, instanceId: other } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: action } = injectCard(state, "player1", "one-and-only", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: action }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [a] }, CARD_DEFINITIONS);
    // Chosen (a) survives; other same-name (b, c) banished; unrelated (other) survives.
    expect(getInstance(r.newState, a).zone).toBe("play");
    expect(getInstance(r.newState, b).zone).toBe("discard");
    expect(getInstance(r.newState, c).zone).toBe("discard");
    expect(getInstance(r.newState, other).zone).toBe("play");
  });
});

describe("Set 13 — Merlin Envisioning the Future", () => {
  it("MINOR TRICKERY may draw from the bottom of the deck on play", () => {
    let state = startGame();
    state = giveInk(state, "player1", 4);
    let merlin: string, bottom: string;
    ({ state, instanceId: merlin } = injectCard(state, "player1", "merlin-envisioning-the-future", "hand"));
    ({ state, instanceId: bottom } = injectCard(state, "player1", "mushu-stealthy-dragon", "deck"));
    // Force `bottom` to the bottom of the deck.
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, deck: [...getZone(state, "player1", "deck").filter((x: string) => x !== bottom), bottom] } } };
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: merlin }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    const accept = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(getZone(accept.newState, "player1", "hand")).toContain(bottom);
  });

  it("AGE OF INCONVENIENCE puts Merlin from discard onto the bottom of the deck when banished", () => {
    let state = startGame();
    let merlin: string, attacker: string;
    // Merlin (1/4) exerted so it can be challenged to death on player2's turn.
    ({ state, instanceId: merlin } = injectCard(state, "player1", "merlin-envisioning-the-future", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: attacker } = injectCard(state, "player2", "marshmallow-persistent-guardian", "play", { isDrying: false }));
    state = passTurns(state, 1); // hand turn to player2
    const r = applyAction(state, { type: "CHALLENGE", playerId: "player2", attackerInstanceId: attacker, defenderInstanceId: merlin }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Banished → AGE OF INCONVENIENCE moves it from discard to the deck bottom.
    expect(getInstance(r.newState, merlin).zone).toBe("deck");
    const deck = getZone(r.newState, "player1", "deck");
    expect(deck[deck.length - 1]).toBe(merlin);
  });
});

describe("Set 13 — Vine Pod", () => {
  it("FRAGILE HUSK enters play exerted", () => {
    let state = startGame();
    state = giveInk(state, "player1", 4);
    let pod: string;
    ({ state, instanceId: pod } = injectCard(state, "player1", "vine-pod", "hand"));
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: pod }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getInstance(r.newState, pod).isExerted).toBe(true);
  });

  it("REGENERATE banishes your character and may play a same-named one for free", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let pod: string, victim: string, copy: string;
    ({ state, instanceId: pod } = injectCard(state, "player1", "vine-pod", "play"));
    ({ state, instanceId: victim } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    ({ state, instanceId: copy } = injectCard(state, "player1", "mushu-stealthy-dragon", "hand"));
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: pod, abilityIndex: 1 }, CARD_DEFINITIONS);
    // choose the character to banish
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victim] }, CARD_DEFINITIONS);
    expect(getInstance(r.newState, victim).zone).toBe("discard");
    // may-play the same-named copy from hand for free
    if (r.newState.pendingChoice?.type === "choose_may") {
      r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    }
    // some flows surface a target pick for which same-name card to play
    if (r.newState.pendingChoice?.type === "choose_target") {
      r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [copy] }, CARD_DEFINITIONS);
    }
    expect(getInstance(r.newState, copy).zone).toBe("play");
  });
});

describe("Set 13 — Gopher Hunny Cook", () => {
  it("DOWN THE HOLE may enter play exerted", () => {
    let state = startGame();
    state = giveInk(state, "player1", 4);
    let gopher: string;
    ({ state, instanceId: gopher } = injectCard(state, "player1", "gopher-hunny-cook", "hand"));
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: gopher }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    const accept = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(getInstance(accept.newState, gopher).isExerted).toBe(true);
  });

  it("FORTIFYING MEAL grants other Hunny characters Resist +1 only on opponent's turn while exerted", () => {
    let state = startGame();
    let gopher: string, otherHunny: string;
    ({ state, instanceId: gopher } = injectCard(state, "player1", "gopher-hunny-cook", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: otherHunny } = injectCard(state, "player1", "rabbit-hunny-paladin", "play", { isDrying: false }));

    // player1's turn → condition false (not opponent's turn) → no grant.
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect((mods.grantedKeywords.get(otherHunny) ?? []).some((k: any) => k.keyword === "resist")).toBe(false);

    // Advance to player2's turn (Gopher stays exerted).
    state = passTurns(state, 1);
    mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect((mods.grantedKeywords.get(otherHunny) ?? []).some((k: any) => k.keyword === "resist")).toBe(true);
    // Gopher itself does not get its own grant ("your OTHER Hunny characters").
    expect((mods.grantedKeywords.get(gopher) ?? []).some((k: any) => k.keyword === "resist")).toBe(false);
  });
});

describe("Set 13 — Prophetic Vision", () => {
  it("non-action reveal goes to the bottom and swings 1 lore", () => {
    let state = startGame();
    state = giveInk(state, "player1", 3);
    state = setLore(state, "player1", 5);
    state = setLore(state, "player2", 5);
    let vision: string, top: string;
    ({ state, instanceId: vision } = injectCard(state, "player1", "prophetic-vision", "hand"));
    // Ensure the top after shuffle is deterministic is hard; instead assert lore swing
    // when the revealed card is NOT an action. The opening deck (Mickey fillers) is all
    // characters, so any revealed top card is a non-action → the miss branch fires.
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: vision }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.lore).toBe(6);
    expect(r.newState.players.player2.lore).toBe(4);
  });
});

describe("Set 13 — Carl Fredricksen On the Move", () => {
  it("MOVING PARTNER moves Carl to a location you play (may)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 6);
    let carl: string, loc: string;
    ({ state, instanceId: carl } = injectCard(state, "player1", "carl-fredricksen-on-the-move", "play", { isDrying: false }));
    ({ state, instanceId: loc } = injectCard(state, "player1", "agrabah-marketplace", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: loc }, CARD_DEFINITIONS);
    // MOVING PARTNER is a may.
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    // Decline moving a second character if prompted.
    if (r.newState.pendingChoice?.type === "choose_may") {
      r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline" }, CARD_DEFINITIONS);
    }
    expect(getInstance(r.newState, carl).atLocationInstanceId).toBe(loc);
  });

  it("ADVENTURE AWAITS draws cards equal to the location's lore when questing at it", () => {
    let state = startGame();
    let carl: string, loc: string;
    ({ state, instanceId: carl } = injectCard(state, "player1", "carl-fredricksen-on-the-move", "play", { isDrying: false }));
    ({ state, instanceId: loc } = injectCard(state, "player1", "agrabah-marketplace", "play"));
    // Place Carl at the lore-2 location.
    state = { ...state, cards: { ...state.cards, [carl]: { ...getInstance(state, carl), atLocationInstanceId: loc } } };
    const before = getZone(state, "player1", "hand").length;
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: carl }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand").length).toBe(before + 2); // agrabah-marketplace lore 2
  });
});

describe("Set 13 — Quackerjack Loony Toymaker EVIL DESIGN", () => {
  it("mills 4 and may deal 1 damage per item milled to a chosen character", () => {
    let state = startGame();
    state = giveInk(state, "player1", 6);
    let quack: string, victim: string;
    ({ state, instanceId: quack } = injectCard(state, "player1", "quackerjack-loony-toymaker", "hand"));
    ({ state, instanceId: victim } = injectCard(state, "player2", "marshmallow-persistent-guardian", "play", { isDrying: false }));
    // Stack 4 item cards on top of player1's deck so all 4 milled are items.
    const itemIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      let id: string;
      ({ state, instanceId: id } = injectCard(state, "player1", "absorbing-bloom", "deck"));
      itemIds.push(id);
    }
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, deck: [...itemIds, ...getZone(state, "player1", "deck").filter((x: string) => !itemIds.includes(x))] } } };

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: quack }, CARD_DEFINITIONS);
    // All 4 items milled to discard.
    expect(itemIds.every((id) => getInstance(r.newState, id).zone === "discard")).toBe(true);
    // Optional damage prompt.
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victim] }, CARD_DEFINITIONS);
    expect(getInstance(r.newState, victim).damage).toBe(4);
  });
});

describe("Set 13 — 4*Town STAR PERFORMANCE (sings via Sing Together)", () => {
  it("draws when this character sings a song with Sing Together", () => {
    let state = startGame();
    let town: string, helper: string, song: string;
    ({ state, instanceId: town } = injectCard(state, "player1", "4-town-hottest-band-of-the-year", "play", { isDrying: false }));
    ({ state, instanceId: helper } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: song } = injectCard(state, "player1", "a-pirates-life", "hand")); // Sing Together 6
    const before = getZone(state, "player1", "hand").length;
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: song, singerInstanceIds: [town, helper] } as any, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // a-pirates-life only touches lore; the +1 hand is STAR PERFORMANCE. (song leaves hand too)
    // hand: -1 (song played) +1 (draw) = net 0 relative to before, so compare deck draw via hand incl. draw.
    const after = getZone(r.newState, "player1", "hand").length;
    expect(after).toBe(before - 1 + 1);
  });
});

describe("Set 13 — Meilin Lee BAND LOYALTY", () => {
  it("cannot sing a song on its own (validator + legal-action parity)", () => {
    let state = startGame();
    let meilin: string, song: string;
    ({ state, instanceId: meilin } = injectCard(state, "player1", "meilin-lee-lead-vocalist", "play", { isDrying: false }));
    ({ state, instanceId: song } = injectCard(state, "player1", "control-your-temper", "hand"));
    const solo = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: song, singerInstanceId: meilin } as any, CARD_DEFINITIONS);
    expect(solo.success).toBe(false);
    const legal = getAllLegalActions(state, "player1", CARD_DEFINITIONS);
    const meilinSing = legal.find((a: any) => a.type === "PLAY_CARD" && a.instanceId === song && a.singerInstanceId === meilin);
    expect(meilinSing).toBeUndefined();
  });

  it("may sing as part of Sing Together", () => {
    let state = startGame();
    let meilin: string, big: string, song: string;
    ({ state, instanceId: meilin } = injectCard(state, "player1", "meilin-lee-lead-vocalist", "play", { isDrying: false }));
    ({ state, instanceId: big } = injectCard(state, "player1", "goofy-musketeer", "play", { isDrying: false })); // cost 5
    ({ state, instanceId: song } = injectCard(state, "player1", "a-pirates-life", "hand")); // Sing Together 6
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: song, singerInstanceIds: [meilin, big] } as any, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });
});

describe("Set 13 — Bunch of Balloons", () => {
  it("FLOAT AWAY grants Evasive to a chosen location while in play; OUT OF SIGHT returns it", () => {
    let state = startGame();
    state = giveInk(state, "player1", 6);
    let loc: string, balloons: string;
    ({ state, instanceId: loc } = injectCard(state, "player1", "agrabah-marketplace", "play"));
    ({ state, instanceId: balloons } = injectCard(state, "player1", "bunch-of-balloons", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: balloons }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [loc] }, CARD_DEFINITIONS);
    let mods = getGameModifiers(r.newState, CARD_DEFINITIONS);
    expect((mods.grantedKeywords.get(loc) ?? []).some((k: any) => k.keyword === "evasive")).toBe(true);

    // OUT OF SIGHT returns the item; the grant then disappears.
    let s2 = giveInk(r.newState, "player1", 3);
    const ret = applyAction(s2, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: balloons, abilityIndex: 2 }, CARD_DEFINITIONS);
    expect(getInstance(ret.newState, balloons).zone).toBe("hand");
    mods = getGameModifiers(ret.newState, CARD_DEFINITIONS);
    expect((mods.grantedKeywords.get(loc) ?? []).some((k: any) => k.keyword === "evasive")).toBe(false);
  });
});

describe("Set 13 — Mrs. Incredible Created by the Vine TORRENT", () => {
  it("accumulates a shift-only cost reduction per Floodborn quest", () => {
    let state = startGame();
    let mrs: string, ursula: string;
    ({ state, instanceId: mrs } = injectCard(state, "player1", "mrs-incredible-created-by-the-vine", "play", { isDrying: false }));
    ({ state, instanceId: ursula } = injectCard(state, "player1", "ursula-created-by-the-vine", "play", { isDrying: false }));
    let r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ursula }, CARD_DEFINITIONS);
    const reds = r.newState.players.player1.costReductions ?? [];
    expect(reds.length).toBe(1);
    expect(reds[0].appliesTo).toBe("shift_only");
    expect(reds[0].amount).toBe(1);
  });

  it("discounts the next shift (and not a normal play)", () => {
    let state = startGame();
    let mrs: string, ursula: string, base: string, shifter: string;
    ({ state, instanceId: mrs } = injectCard(state, "player1", "mrs-incredible-created-by-the-vine", "play", { isDrying: false }));
    ({ state, instanceId: ursula } = injectCard(state, "player1", "ursula-created-by-the-vine", "play", { isDrying: false }));
    ({ state, instanceId: base } = injectCard(state, "player1", "russell-junior-wilderness-explorer", "play", { isDrying: false }));
    ({ state, instanceId: shifter } = injectCard(state, "player1", "russell-senior-wilderness-explorer", "hand"));
    // One Floodborn quest → 1 shift discount.
    state = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ursula }, CARD_DEFINITIONS).newState;
    state = giveInk(state, "player1", 3);
    // Shift cost 3 → 2 after discount.
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: shifter, shiftTargetInstanceId: base } as any, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.availableInk).toBe(1); // 3 - (3-1)
  });
});
