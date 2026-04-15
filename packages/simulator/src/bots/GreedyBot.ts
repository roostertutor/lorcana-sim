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
import type { BotStrategy, BotWeights } from "../types.js";
import { resolveChoiceIntelligently } from "./choiceResolver.js";

// Balanced evaluation weights used for choice resolution (target selection, discard priority)
const GREEDY_WEIGHTS: BotWeights = {
  loreAdvantage: 0.6,
  boardAdvantage: 0.6,
  handAdvantage: 0.5,
  inkAdvantage: 0.5,
  deckQuality: 0.4,
  urgency: (state) => Math.pow(Math.max(state.players.player1.lore, state.players.player2.lore) / 20, 2),
  threatLevel: (_state) => 0.5,
};

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

/**
 * Least-bad challenge: used when the engine forces a challenge via CRD 8.7.3
 * (Reckless must-challenge) or CRD 1.6.2 (`must_quest_if_able` TimedEffect,
 * satisfied by QUEST instead). Without this fallback, a Reckless character
 * with only non-lethal targets would deadlock the bot — `findBestChallenge`
 * rejects non-lethal and `PASS_TURN` is then illegal.
 *
 * Preference: survive > kill defender > remove a high-lore threat.
 */
function findLeastBadChallenge(
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
    const attackerDies = attacker.damage + defenderStr >= attackerWp;

    // Survival dominates (10), then lethal (5), then defender lore.
    const score =
      (attackerDies ? 0 : 10) +
      (defenderDies ? 5 : 0) +
      getEffectiveLore(defender, defenderDef);

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
      return resolveChoiceIntelligently(state, playerId, definitions, GREEDY_WEIGHTS);
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

    // 5. Pass — unless a hard obligation blocks it.
    //    CRD 8.7.3: a ready Reckless character with a valid challenge target
    //    makes PASS_TURN illegal. CRD 1.6.2 `must_quest_if_able` likewise.
    //    When the validator has filtered PASS_TURN out of `legal`, we must
    //    satisfy the obligation before ending the turn, or the game deadlocks.
    if (legal.some((a) => a.type === "PASS_TURN")) {
      return { type: "PASS_TURN", playerId };
    }

    // Obligation unsatisfied. QUEST covers must_quest_if_able; a forced
    // challenge covers Reckless. Quest is already preferred at step 1, so if
    // we're here and a QUEST is legal it's only still available because step 1
    // found none — but re-check defensively in case state changed mid-decision.
    const forcedQuest = legal.find((a) => a.type === "QUEST");
    if (forcedQuest) return forcedQuest;

    const forcedChallenge = findLeastBadChallenge(state, legal, definitions);
    if (forcedChallenge) return forcedChallenge;

    // No legal action found. Return pass; the engine will reject and the game
    // loop will surface the deadlock rather than hanging.
    return { type: "PASS_TURN", playerId };
  },
};
