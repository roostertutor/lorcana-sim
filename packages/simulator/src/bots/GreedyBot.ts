// =============================================================================
// GREEDY BOT
// Simple heuristic bot for baseline analytics.
// Priority order: quest → favorable challenge → play best card → play ink → pass
// =============================================================================

import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import {
  getAllLegalActions,
  getEffectiveStrength,
  getEffectiveWillpower,
  getEffectiveLore,
} from "@lorcana-sim/engine";
import type { BotStrategy } from "../types.js";

function resolveChoiceRandom(state: GameState, playerId: PlayerID): GameAction {
  const choice = state.pendingChoice!;

  // CRD 6.1.4: "may" choices — greedy bot always accepts (free benefit)
  if (choice.type === "choose_may") {
    return { type: "RESOLVE_CHOICE", playerId, choice: "accept" };
  }

  const targets = choice.validTargets ?? [];
  if (targets.length > 0) {
    const idx = Math.floor(Math.random() * targets.length);
    return { type: "RESOLVE_CHOICE", playerId, choice: [targets[idx]!] };
  }
  return { type: "RESOLVE_CHOICE", playerId, choice: [] };
}

/**
 * Find the best challenge: only challenge if the defender dies.
 * Prefer: we survive. Tiebreak: defender has higher lore value.
 */
function findBestChallenge(
  state: GameState,
  legalActions: GameAction[],
  definitions: Record<string, CardDefinition>
): GameAction | undefined {
  let best: { action: GameAction; score: number } | undefined;

  for (const action of legalActions) {
    if (action.type !== "CHALLENGE") continue;

    const attacker = state.cards[action.attackerInstanceId];
    const defender = state.cards[action.defenderInstanceId];
    if (!attacker || !defender) continue;

    const attackerDef = definitions[attacker.definitionId];
    const defenderDef = definitions[defender.definitionId];
    if (!attackerDef || !defenderDef) continue;

    // Attacker's effective strength (+ Challenger bonus)
    let attackerStr = getEffectiveStrength(attacker, attackerDef);
    const challengerAbility = attackerDef.abilities.find(
      (a) => a.type === "keyword" && a.keyword === "challenger"
    );
    if (challengerAbility?.type === "keyword") {
      attackerStr += challengerAbility.value ?? 0;
    }

    const defenderStr = getEffectiveStrength(defender, defenderDef);
    const attackerWp = getEffectiveWillpower(attacker, attackerDef);
    const defenderWp = getEffectiveWillpower(defender, defenderDef);

    const defenderDies = defender.damage + attackerStr >= defenderWp;
    if (!defenderDies) continue; // Only challenge if we eliminate the target

    const attackerDies = attacker.damage + defenderStr >= attackerWp;
    // Prefer surviving; tiebreak by defender's lore (remove high-lore threats first)
    const score = (attackerDies ? 0 : 2) + getEffectiveLore(defender, defenderDef);

    if (!best || score > best.score) {
      best = { action, score };
    }
  }

  return best?.action;
}

/** Play the most expensive affordable card (maximizes board impact). */
function findBestPlay(
  state: GameState,
  legalActions: GameAction[],
  definitions: Record<string, CardDefinition>
): GameAction | undefined {
  let best: { action: GameAction; cost: number } | undefined;

  for (const action of legalActions) {
    if (action.type !== "PLAY_CARD") continue;

    const instance = state.cards[action.instanceId];
    if (!instance) continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    const cost = action.shiftTargetInstanceId
      ? (def.shiftCost ?? def.cost)
      : def.cost;

    if (!best || cost > best.cost) {
      best = { action, cost };
    }
  }

  return best?.action;
}

/**
 * Ink the lowest-cost inkable card in hand.
 * Preserves higher-value cards for playing.
 * (Open question in SPEC — this is one reasonable heuristic.)
 */
function findBestInk(
  state: GameState,
  legalActions: GameAction[],
  definitions: Record<string, CardDefinition>
): GameAction | undefined {
  let best: { action: GameAction; cost: number } | undefined;

  for (const action of legalActions) {
    if (action.type !== "PLAY_INK") continue;

    const instance = state.cards[action.instanceId];
    if (!instance) continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    if (!best || def.cost < best.cost) {
      best = { action, cost: def.cost };
    }
  }

  return best?.action;
}

export const GreedyBot: BotStrategy = {
  name: "greedy",
  type: "algorithm",
  decideAction(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): GameAction {
    if (state.pendingChoice && state.pendingChoice.choosingPlayerId === playerId) {
      return resolveChoiceRandom(state, playerId);
    }

    const legal = getAllLegalActions(state, playerId, definitions);

    // 1. Quest with any eligible character (always positive EV)
    const questAction = legal.find((a) => a.type === "QUEST");
    if (questAction) return questAction;

    // 2. Challenge favorably (opponent's character dies)
    const challengeAction = findBestChallenge(state, legal, definitions);
    if (challengeAction) return challengeAction;

    // 3. Play the most expensive card we can afford
    const playAction = findBestPlay(state, legal, definitions);
    if (playAction) return playAction;

    // 4. Play ink (cheapest inkable card to minimize opportunity cost)
    const inkAction = findBestInk(state, legal, definitions);
    if (inkAction) return inkAction;

    // 5. Pass
    return { type: "PASS_TURN", playerId };
  },
};
