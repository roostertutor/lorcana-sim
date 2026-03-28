// =============================================================================
// RAMP CINDY COW BOT
// Line-aware bot that plays the Cinderella/Clarabelle shift combo.
// Turn 1: DYB if no ramp. Turn 2: ink + Sail > Tipo, DYB to dig if missing.
// Turn 3: ink + Cinderella. Turn 4: Clarabelle small + shift big.
// Falls back to GreedyBot logic after T4 or when line is dead.
// =============================================================================

import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { getAllLegalActions, getZone } from "@lorcana-sim/engine";
import type { BotStrategy } from "../types.js";
import { GreedyBot } from "./GreedyBot.js";

// --- Combo piece IDs ---
const SAIL = "sail-the-azurite-sea";
const TIPO = "tipo-growing-son";
const DYB = "develop-your-brain";
const CINDERELLA = "cinderella-dream-come-true";
const CLARABELLE_SMALL = "clarabelle-clumsy-guest";
const CLARABELLE_BIG = "clarabelle-light-on-her-hooves";
const YOURE_WELCOME = "youre-welcome";

const RAMP_IDS = [SAIL, TIPO];
const COMBO_IDS = [SAIL, TIPO, DYB, CINDERELLA, CLARABELLE_SMALL, CLARABELLE_BIG, YOURE_WELCOME];

// --- Helpers ---

/** Get definition IDs for cards in a player's hand */
function handCards(state: GameState, playerId: PlayerID): { instanceId: string; defId: string }[] {
  return getZone(state, playerId, "hand").map(id => ({
    instanceId: id,
    defId: state.cards[id]!.definitionId,
  }));
}

/** Count copies of a definition ID in hand */
function countInHand(state: GameState, playerId: PlayerID, defId: string): number {
  return handCards(state, playerId).filter(c => c.defId === defId).length;
}

/** Check if a definition ID is in hand */
function hasInHand(state: GameState, playerId: PlayerID, defId: string): boolean {
  return countInHand(state, playerId, defId) > 0;
}

/** Check if any ramp card is in hand */
function hasRampInHand(state: GameState, playerId: PlayerID): boolean {
  return RAMP_IDS.some(id => hasInHand(state, playerId, id));
}

/** Per-player turn number from global turn number */
function playerTurn(state: GameState, playerId: PlayerID): number {
  // player1 turns: 1,3,5,... → (1+1)/2=1, (3+1)/2=2, ...
  // player2 turns: 2,4,6,... → 2/2=1, 4/2=2, ...
  if (playerId === "player1") return Math.ceil(state.turnNumber / 2);
  return Math.floor(state.turnNumber / 2);
}

/** Find a legal PLAY_INK action for a specific instance */
function findInkAction(legal: GameAction[], instanceId: string): GameAction | undefined {
  return legal.find(a => a.type === "PLAY_INK" && a.instanceId === instanceId);
}

/** Find a legal PLAY_CARD action for a specific definition */
function findPlayAction(
  legal: GameAction[],
  state: GameState,
  defId: string
): GameAction | undefined {
  return legal.find(a => {
    if (a.type !== "PLAY_CARD") return false;
    const inst = state.cards[a.instanceId];
    return inst?.definitionId === defId;
  });
}

/** Find a legal PLAY_CARD action that shifts (for Clarabelle big) */
function findShiftAction(
  legal: GameAction[],
  state: GameState,
  defId: string
): GameAction | undefined {
  return legal.find(a => {
    if (a.type !== "PLAY_CARD") return false;
    if (!a.shiftTargetInstanceId) return false;
    const inst = state.cards[a.instanceId];
    return inst?.definitionId === defId;
  });
}

/**
 * Ink the best card following combo-aware priority:
 * 1. Non-combo cards (any)
 * 2. Duplicate combo pieces
 * 3. Combo pieces past their window
 * Never ink a combo piece you still need.
 */
function findComboAwareInk(
  state: GameState,
  legal: GameAction[],
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): GameAction | undefined {
  const inkActions = legal.filter(a => a.type === "PLAY_INK");
  if (inkActions.length === 0) return undefined;

  const turn = playerTurn(state, playerId);
  const hand = handCards(state, playerId);

  // Categorize each inkable card
  type Candidate = { action: GameAction; priority: number };
  const candidates: Candidate[] = [];

  for (const action of inkActions) {
    const inst = state.cards[action.instanceId];
    if (!inst) continue;
    const defId = inst.definitionId;

    if (!COMBO_IDS.includes(defId)) {
      // Non-combo card — always safe to ink
      candidates.push({ action, priority: 0 });
      continue;
    }

    // It's a combo piece — check if we can spare it
    const copies = hand.filter(c => c.defId === defId).length;

    // Duplicate combo piece — always safe to ink one copy
    if (copies >= 2) {
      candidates.push({ action, priority: 2 });
      continue;
    }

    // Single-copy combo piece — prioritize by expendability
    // DYB is the most expendable combo piece (cheap dig, not part of the T2-T4 line)
    if (defId === DYB) {
      candidates.push({ action, priority: turn >= 3 ? 1 : 5 });
      continue;
    }

    // You're Welcome — optional part of the line
    if (defId === YOURE_WELCOME) {
      candidates.push({ action, priority: 6 });
      continue;
    }

    // Ramp past its window (T3+)
    if (RAMP_IDS.includes(defId) && turn >= 3) {
      candidates.push({ action, priority: 1 });
      continue;
    }

    // Clarabelle — needed for T4, but inkable if desperate
    if (defId === CLARABELLE_SMALL || defId === CLARABELLE_BIG) {
      candidates.push({ action, priority: turn <= 4 ? 20 : 1 });
      continue;
    }

    // Cinderella — uninkable anyway, but guard against weird states
    if (defId === CINDERELLA) {
      candidates.push({ action, priority: 50 });
      continue;
    }

    // Ramp before window — very reluctant to ink
    if (RAMP_IDS.includes(defId)) {
      candidates.push({ action, priority: 40 });
      continue;
    }

    // Any other combo piece
    candidates.push({ action, priority: 10 });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0]?.action;
}

// --- Main bot logic ---

export const RampCindyCowBot: BotStrategy = {
  name: "ramp-cindy-cow",
  type: "algorithm",
  shouldMulligan: shouldMulliganRampCindyCow,
  performMulligan: performMulliganRampCindyCow,
  decideAction(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): GameAction {
    // Handle pending choices with combo awareness
    if (state.pendingChoice) {
      const choice = state.pendingChoice;

      // "May" choices (e.g. Cinderella's inkwell) — always accept
      if (choice.type === "choose_may") {
        return { type: "RESOLVE_CHOICE", playerId, choice: "accept" };
      }

      // Revealed card choice (e.g. DYB look at top 2, pick 1)
      if (choice.type === "choose_from_revealed" && choice.validTargets && choice.validTargets.length > 0) {
        const hand = handCards(state, playerId);
        const uninkableInHand = hand.filter(c => {
          const def = definitions[c.defId];
          return def && !def.inkable;
        }).length;

        // Priority: lower score = pick first.
        // Sail > Tipo (unless 2+ uninkables in hand, then Tipo > Sail) > DYB > inkable > rest
        let best: { target: string; score: number } | undefined;
        for (const targetId of choice.validTargets) {
          const inst = state.cards[targetId];
          if (!inst) continue;
          const defId = inst.definitionId;
          const def = definitions[defId];

          let score: number;
          if (defId === SAIL) {
            score = uninkableInHand >= 2 ? 1 : 0; // Sail best unless hand is uninkable-heavy
          } else if (defId === TIPO) {
            score = uninkableInHand >= 2 ? 0 : 1; // Tipo better when hand has uninkables to dump
          } else if (defId === DYB) {
            score = 2; // More dig
          } else if (def?.inkable) {
            score = 3; // Generic inkable card
          } else {
            score = 4; // Uninkable non-combo — least useful
          }

          if (!best || score < best.score) {
            best = { target: targetId, score };
          }
        }

        return { type: "RESOLVE_CHOICE", playerId, choice: [best ? best.target : choice.validTargets[0]!] };
      }

      // Target choices (e.g. Tipo/Cinderella inkwell pick) — smart priority
      if (choice.type === "choose_target" && choice.validTargets && choice.validTargets.length > 0) {
        const turn = playerTurn(state, playerId);
        const targets = choice.validTargets;
        const hand = handCards(state, playerId);

        // Score each target: lower = better to put into inkwell
        let best: { target: string; score: number } | undefined;
        for (const targetId of targets) {
          const inst = state.cards[targetId];
          if (!inst) continue;
          const defId = inst.definitionId;
          const def = definitions[defId];
          const copies = hand.filter(c => c.defId === defId).length;

          let score: number;
          if (!COMBO_IDS.includes(defId)) {
            // Non-combo: prefer uninkable (can't ink normally, perfect for Tipo)
            score = def?.inkable ? 2 : 0;
          } else if (copies >= 2) {
            // Duplicate combo piece — safe to sacrifice
            score = 3;
          } else if (RAMP_IDS.includes(defId) && turn >= 3) {
            score = 4; // Ramp past window
          } else if (defId === DYB) {
            score = turn >= 3 ? 4 : 8;
          } else if (defId === YOURE_WELCOME) {
            score = 10; // Optional combo piece
          } else if (defId === CLARABELLE_SMALL || defId === CLARABELLE_BIG) {
            score = 20; // Needed for T4
          } else if (RAMP_IDS.includes(defId)) {
            score = 50; // Needed for T2
          } else if (defId === CINDERELLA) {
            score = 100; // Never sacrifice — uninkable key piece
          } else {
            score = 15;
          }

          if (!best || score < best.score) {
            best = { target: targetId, score };
          }
        }

        if (best) {
          return { type: "RESOLVE_CHOICE", playerId, choice: [best.target] };
        }
      }

      // Fall back to GreedyBot for other choice types
      return GreedyBot.decideAction(state, playerId, definitions);
    }

    const legal = getAllLegalActions(state, playerId, definitions);
    const turn = playerTurn(state, playerId);
    const hasInked = state.players[playerId].inkPlaysThisTurn > 0;

    // ===== TURN 1 =====
    if (turn === 1) {
      // Ink first
      if (!hasInked) {
        const inkAction = findComboAwareInk(state, legal, playerId, definitions);
        if (inkAction) return inkAction;
      }

      // If no ramp in hand, play DYB to dig
      if (!hasRampInHand(state, playerId)) {
        const dybAction = findPlayAction(legal, state, DYB);
        if (dybAction) return dybAction;
      }

      // Otherwise pass (save ink for T2)
      return { type: "PASS_TURN", playerId };
    }

    // ===== TURN 2 =====
    if (turn === 2) {
      // Ink first (need 2 ink for Sail/Tipo)
      if (!hasInked) {
        const inkAction = findComboAwareInk(state, legal, playerId, definitions);
        if (inkAction) return inkAction;
      }

      // Play Sail over Tipo (Sail is net -1 hand, Tipo is -2)
      const sailAction = findPlayAction(legal, state, SAIL);
      if (sailAction) return sailAction;

      const tipoAction = findPlayAction(legal, state, TIPO);
      if (tipoAction) return tipoAction;

      // After ramp, we might have an extra ink play — ink again
      const extraInk = findComboAwareInk(state, legal, playerId, definitions);
      if (extraInk) return extraInk;

      // After Sail + extra ink, if missing combo pieces, play DYB to dig
      const missingCinderella = !hasInHand(state, playerId, CINDERELLA);
      const missingSmall = !hasInHand(state, playerId, CLARABELLE_SMALL);
      const missingBig = !hasInHand(state, playerId, CLARABELLE_BIG);
      if (missingCinderella || missingSmall || missingBig) {
        const dybAction = findPlayAction(legal, state, DYB);
        if (dybAction) return dybAction;
      }

      return { type: "PASS_TURN", playerId };
    }

    // ===== TURN 3 =====
    if (turn === 3) {
      // Ink first (need 4 ink for Cinderella)
      if (!hasInked) {
        const inkAction = findComboAwareInk(state, legal, playerId, definitions);
        if (inkAction) return inkAction;
      }

      // Play Cinderella (cost 4)
      const cinderellaAction = findPlayAction(legal, state, CINDERELLA);
      if (cinderellaAction) return cinderellaAction;

      // No Cinderella — line is dead, fall back to greedy
      return GreedyBot.decideAction(state, playerId, definitions);
    }

    // ===== TURN 4 =====
    if (turn === 4) {
      // Ink first
      if (!hasInked) {
        const inkAction = findComboAwareInk(state, legal, playerId, definitions);
        if (inkAction) return inkAction;
      }

      // Shift Clarabelle big onto small first (if small already in play)
      const shiftAction = findShiftAction(legal, state, CLARABELLE_BIG);
      if (shiftAction) return shiftAction;

      // Play Clarabelle small (cost 1) — sets up the shift target
      const smallAction = findPlayAction(legal, state, CLARABELLE_SMALL);
      if (smallAction) return smallAction;

      // You're Welcome if available
      const ywAction = findPlayAction(legal, state, YOURE_WELCOME);
      if (ywAction) return ywAction;

      // Fall back to greedy for remaining actions
      return GreedyBot.decideAction(state, playerId, definitions);
    }

    // ===== TURN 5+ — fall back to GreedyBot =====
    return GreedyBot.decideAction(state, playerId, definitions);
  },
};

// =============================================================================
// CUSTOM MULLIGAN — Partial Paris, ramp-aware
//
// Strategy matches the reference probability model:
// - HAS RAMP in hand → keep everything, toss only uninkable non-combo cards.
//   (Ramp is the bottleneck; once found, maximize hand quality.)
// - NO RAMP in hand  → toss everything except up to 1 DYB ("keep develop").
//   (Maximum dig for ramp cards — the #1 priority.)
// =============================================================================

export function shouldMulliganRampCindyCow(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): boolean {
  const toss = categorizeMulliganHand(state, playerId, definitions).toss;
  return toss.length > 0;
}

function categorizeMulliganHand(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): { keep: string[]; toss: string[] } {
  const handIds = getZone(state, playerId, "hand");
  const hasRamp = handIds.some(id => RAMP_IDS.includes(state.cards[id]?.definitionId ?? ""));

  if (hasRamp) {
    // --- RAMP PRESENT: keep everything except uninkable non-combo ---
    const keep: string[] = [];
    const toss: string[] = [];

    for (const id of handIds) {
      const defId = state.cards[id]?.definitionId ?? "";
      if (COMBO_IDS.includes(defId)) {
        // All combo pieces (including duplicates) — keep
        keep.push(id);
      } else {
        const def = definitions[defId];
        if (def?.inkable) {
          keep.push(id); // Inkable filler — keep (useful for inking)
        } else {
          toss.push(id); // Uninkable non-combo — toss
        }
      }
    }

    return { keep, toss };
  }

  // --- NO RAMP: toss everything except up to 1 DYB ("keep develop" strategy) ---
  const keep: string[] = [];
  const toss: string[] = [];
  let keptDyb = false;

  for (const id of handIds) {
    const defId = state.cards[id]?.definitionId ?? "";
    if (defId === DYB && !keptDyb) {
      keep.push(id); // Keep 1 DYB to dig for ramp on T1
      keptDyb = true;
    } else {
      toss.push(id); // Toss everything else — maximize dig for ramp
    }
  }

  return { keep, toss };
}

export function performMulliganRampCindyCow(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): GameState {
  const handIds = getZone(state, playerId, "hand");
  const deckIds = getZone(state, playerId, "deck");

  const { keep, toss } = categorizeMulliganHand(state, playerId, definitions);
  if (toss.length === 0) return state;

  // Toss goes back to deck, shuffle, redraw toss.length cards
  const combinedDeck = [...deckIds, ...toss];

  // Fisher-Yates shuffle
  for (let i = combinedDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedDeck[i], combinedDeck[j]] = [combinedDeck[j]!, combinedDeck[i]!];
  }

  const newCards = combinedDeck.slice(0, toss.length);
  const newDeck = combinedDeck.slice(toss.length);
  const newHand = [...keep, ...newCards];

  return {
    ...state,
    zones: {
      ...state.zones,
      [playerId]: {
        ...state.zones[playerId],
        hand: newHand,
        deck: newDeck,
      },
    },
  };
}
