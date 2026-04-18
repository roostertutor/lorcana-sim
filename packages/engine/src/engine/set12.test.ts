// =============================================================================
// SET 12 — Dash Parr RECORD TIME, Merida STEADY AIM, Bouncing Ducky REPURPOSED
// Also: regression tests for target:{type:"all"} on shuffle_into_deck and
// return_to_hand, which were silent no-ops before 2026-04.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect, getAllLegalActions } from "./reducer.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";

describe("Set 12 — Dash Parr Lava Runner RECORD TIME", () => {
  it("can quest the turn he's played (bypasses CRD 5.1.1.11 drying)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 4);
    // Inject while drying — RECORD TIME should bypass the restriction.
    const { state: s1, instanceId } = injectCard(
      state,
      "player1",
      "dash-parr-lava-runner",
      "play",
      { isDrying: true }
    );

    const r = applyAction(
      s1,
      { type: "QUEST", playerId: "player1", instanceId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    // Lore:2 is gained on quest.
    expect(r.newState.players.player1.lore).toBe(2);
  });

  it("drying non-RECORD-TIME characters still can't quest (regression guard)", () => {
    let state = startGame();
    const { state: s1, instanceId } = injectCard(
      state,
      "player1",
      "mickey-mouse-brave-little-tailor",
      "play",
      { isDrying: true }
    );
    const r = applyAction(
      s1,
      { type: "QUEST", playerId: "player1", instanceId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/drying/i);
  });

  it("legal actions include QUEST for drying Dash Parr (validator/enumerator parity)", () => {
    let state = startGame();
    const { state: s1, instanceId } = injectCard(
      state,
      "player1",
      "dash-parr-lava-runner",
      "play",
      { isDrying: true }
    );
    const legal = getAllLegalActions(s1, "player1", CARD_DEFINITIONS);
    const quest = legal.find(
      (a) => a.type === "QUEST" && a.instanceId === instanceId
    );
    expect(quest).toBeDefined();
  });
});

describe("Set 12 — Merida Formidable Archer STEADY AIM", () => {
  it("action damage to opposing character triggers +2 damage", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    // Merida (Formidable Archer) in play, drying off so no interference.
    ({ state } = injectCard(state, "player1", "merida-formidable-archer", "play", {
      isDrying: false,
    }));
    // Target: 5-willpower opposing character (Maximus) so it absorbs 2+2 = 4 damage without banishing.
    let maxId: string;
    ({ state, instanceId: maxId } = injectCard(state, "player2", "maximus-palace-horse", "play", {
      isDrying: false,
    }));
    // Inject Fire the Cannons! (deals 2 to chosen) into player1's hand.
    let cannonsId: string;
    ({ state, instanceId: cannonsId } = injectCard(state, "player1", "fire-the-cannons", "hand"));

    // Play the action.
    let r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: cannonsId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // Resolve the target choice (deal 2 damage to Maximus).
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [maxId] },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // STEADY AIM is queued as a may-trigger targeting the same card (triggering_card).
    // Resolve the STEADY AIM trigger (accept to deal 2 more damage).
    // The trigger effect has no isMay, so it auto-resolves.
    expect(state.cards[maxId].damage).toBe(4);
  });

  it("challenge damage does NOT trigger STEADY AIM (source is character, not action)", () => {
    let state = startGame();
    // Both Merida + a challenger on player1, with a defender on player2.
    ({ state } = injectCard(state, "player1", "merida-formidable-archer", "play", {
      isDrying: false,
    }));
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(
      state,
      "player1",
      "pumbaa-friendly-warthog",
      "play",
      { isDrying: false }
    ));
    ({ state, instanceId: defenderId } = injectCard(
      state,
      "player2",
      "maximus-palace-horse",
      "play",
      { isDrying: false, isExerted: true }
    ));

    const r = applyAction(
      state,
      {
        type: "CHALLENGE",
        playerId: "player1",
        attackerInstanceId: attackerId,
        defenderInstanceId: defenderId,
      },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // Pumbaa deals his strength in damage to Maximus. STEADY AIM must NOT
    // fire — the source is a character, not an action.
    const dmg = state.cards[defenderId].damage;
    const pumbaaStrength = 3; // Pumbaa Friendly Warthog {S}
    expect(dmg).toBe(pumbaaStrength);
  });
});

describe("Set 12 — Bouncing Ducky REJECTED TOYS + REPURPOSED", () => {
  it("REJECTED TOYS: cost reduced by 1 per Toy character in discard", () => {
    let state = startGame();
    // Print cost is 6. With 3 Toy cards in discard, effective cost should be 3.
    let duckyId: string;
    ({ state, instanceId: duckyId } = injectCard(
      state,
      "player1",
      "bouncing-ducky-sids-toy",
      "hand"
    ));
    // Inject 3 Toy character cards into player1's discard. Ducky herself
    // has the "Toy" trait — any named toy character from set 12 works.
    ({ state } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    ({ state } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    ({ state } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    state = giveInk(state, "player1", 3);

    const r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: duckyId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
  });

  it("REPURPOSED: on play, all Toy cards in discard go to bottom of deck (choose_order for 2+)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 6);
    let duckyId: string, toy1: string, toy2: string;
    ({ state, instanceId: duckyId } = injectCard(
      state,
      "player1",
      "bouncing-ducky-sids-toy",
      "hand"
    ));
    ({ state, instanceId: toy1 } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    ({ state, instanceId: toy2 } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));

    const r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: duckyId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // 2 matching discard cards → choose_order pending
    expect(state.pendingChoice?.type).toBe("choose_order");

    // Resolve with toy1 first (bottommost), then toy2
    const r2 = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [toy1, toy2] },
      CARD_DEFINITIONS
    );
    expect(r2.success).toBe(true);
    state = r2.newState;

    // Both toys should now be in player1's deck (at the bottom)
    expect(state.cards[toy1].zone).toBe("deck");
    expect(state.cards[toy2].zone).toBe("deck");
    // The discard should no longer contain them
    expect(state.zones.player1.discard).not.toContain(toy1);
    expect(state.zones.player1.discard).not.toContain(toy2);
  });
});

describe("CardTarget all-normalization — regression coverage", () => {
  // Chernabog Evildoer SUMMON THE SPIRITS + Magic Broom CLEAN THIS, CLEAN THAT
  // wire shuffle_into_deck with target:{type:"all",filter}. Pre-fix, the
  // handler silently fell through for target.type==="all".
  it("shuffle_into_deck target:{type:'all'} actually shuffles matching cards", () => {
    let state = startGame();
    let chernabog: string, c1: string, c2: string, action1: string;
    ({ state, instanceId: chernabog } = injectCard(state, "player1", "chernabog-evildoer", "hand"));
    ({ state, instanceId: c1 } = injectCard(state, "player1", "mickey-mouse-brave-little-tailor", "discard"));
    ({ state, instanceId: c2 } = injectCard(state, "player1", "maximus-palace-horse", "discard"));
    // An action card in discard that should NOT be shuffled (filter is character).
    ({ state, instanceId: action1 } = injectCard(state, "player1", "fire-the-cannons", "discard"));
    state = giveInk(state, "player1", 9);

    const r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: chernabog },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // Character cards left discard and are now in deck.
    expect(state.cards[c1].zone).toBe("deck");
    expect(state.cards[c2].zone).toBe("deck");
    // Non-character stayed in discard.
    expect(state.cards[action1].zone).toBe("discard");
  });

  // Milo Thatch TAKE THEM BY SURPRISE: "When this character is banished,
  // return all opposing characters to their players' hands." Pre-fix the
  // handler silently fell through for target.type==="all".
  it("return_to_hand target:{type:'all'} returns matching cards to their owners' hands", () => {
    let state = startGame();
    // Directly exercise the effect via applyEffect to isolate the branch.
    let opp1: string, opp2: string, own: string;
    ({ state, instanceId: opp1 } = injectCard(state, "player2", "mickey-mouse-brave-little-tailor", "play", { isDrying: false }));
    ({ state, instanceId: opp2 } = injectCard(state, "player2", "maximus-palace-horse", "play", { isDrying: false }));
    ({ state, instanceId: own } = injectCard(state, "player1", "pumbaa-friendly-warthog", "play", { isDrying: false }));

    state = applyEffect(
      state,
      {
        type: "return_to_hand",
        target: {
          type: "all",
          filter: {
            owner: { type: "opponent" },
            zone: "play",
            cardType: ["character"],
          },
        },
      } as any,
      own,
      "player1",
      CARD_DEFINITIONS,
      []
    );

    // Opponents' characters are now in their hand.
    expect(state.cards[opp1].zone).toBe("hand");
    expect(state.cards[opp2].zone).toBe("hand");
    expect(state.cards[opp1].ownerId).toBe("player2");
    expect(state.cards[opp2].ownerId).toBe("player2");
    // Our own character unaffected.
    expect(state.cards[own].zone).toBe("play");
  });
});

describe("self_replacement — 3 silent bugs fixed after CRD 6.5.6 fold", () => {
  // The Terror That Flaps in the Night (set 11 action):
  // "Deal 2 damage to chosen opposing character. If you have a character
  // named Darkwing Duck in play, deal 3 damage instead."
  // Was wired as plain deal_damage 2; the Condition-gated 3-damage branch
  // was dropped. Now self_replacement with target:chosen + condition:
  // has_character_named. Exercises target-set + Condition-based dispatch.
  it("The Terror That Flaps: Darkwing Duck in play → 3 damage instead of 2", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let terrorId: string, victimId: string;
    ({ state, instanceId: terrorId } = injectCard(state, "player1", "the-terror-that-flaps-in-the-night", "hand"));
    ({ state, instanceId: victimId } = injectCard(state, "player2", "maximus-palace-horse", "play", { isDrying: false }));
    // Drop a Darkwing Duck into player1's play to flip the condition.
    ({ state } = injectCard(state, "player1", "darkwing-duck-drake-mallard", "play", { isDrying: false }));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: terrorId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.cards[victimId].damage).toBe(3);
  });

  it("The Terror That Flaps: no Darkwing → 2 damage (default branch)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let terrorId: string, victimId: string;
    ({ state, instanceId: terrorId } = injectCard(state, "player1", "the-terror-that-flaps-in-the-night", "hand"));
    ({ state, instanceId: victimId } = injectCard(state, "player2", "maximus-palace-horse", "play", { isDrying: false }));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: terrorId }, CARD_DEFINITIONS);
    state = r.newState;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.cards[victimId].damage).toBe(2);
  });

  // Time to Go! (set 10 action):
  // "Banish chosen character of yours to draw 2 cards. If that character had
  // a card under them, draw 3 cards instead."
  // Exercises the new last_banished_had_cards_under Condition reading
  // state.lastBanishedCardsUnderCount snapshot.
  it("Time to Go!: banishing a character with cardsUnder draws 3 instead of 2", () => {
    let state = startGame();
    state = giveInk(state, "player1", 3);
    let timeId: string, victimId: string, underId: string;
    ({ state, instanceId: timeId } = injectCard(state, "player1", "time-to-go", "hand"));
    ({ state, instanceId: victimId } = injectCard(state, "player1", "pumbaa-friendly-warthog", "play", { isDrying: false }));
    ({ state, instanceId: underId } = injectCard(state, "player1", "pumbaa-friendly-warthog", "under"));
    // Attach underId to victim's cardsUnder pile.
    state = {
      ...state,
      cards: { ...state.cards, [victimId]: { ...state.cards[victimId], cardsUnder: [underId] } },
    };
    const handBefore = state.zones.player1.hand.length;

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: timeId }, CARD_DEFINITIONS);
    state = r.newState;
    // Banish's chosen target prompt.
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // 3 drawn (had cards under) — minus 1 Time to Go! card that left hand.
    expect(state.zones.player1.hand.length).toBe(handBefore - 1 + 3);
  });

  it("Time to Go!: banishing a character with no cardsUnder draws 2 (default)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 3);
    let timeId: string, victimId: string;
    ({ state, instanceId: timeId } = injectCard(state, "player1", "time-to-go", "hand"));
    ({ state, instanceId: victimId } = injectCard(state, "player1", "pumbaa-friendly-warthog", "play", { isDrying: false }));
    const handBefore = state.zones.player1.hand.length;

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: timeId }, CARD_DEFINITIONS);
    state = r.newState;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // 2 drawn — minus 1 Time to Go! card.
    expect(state.zones.player1.hand.length).toBe(handBefore - 1 + 2);
  });
});
