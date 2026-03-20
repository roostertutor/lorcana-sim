// =============================================================================
// ACTION VALIDATOR
// Every action goes through here before the engine applies it.
// Returns { valid: true } or { valid: false, reason: string }
// =============================================================================

import type {
  CardDefinition,
  GameAction,
  GameState,
  PlayerID,
} from "../types/index.js";
import {
  canAfford,
  getDefinition,
  getInstance,
  getOpponent,
  getZone,
  hasKeyword,
  isMainPhase,
} from "../utils/index.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const OK: ValidationResult = { valid: true };
const fail = (reason: string): ValidationResult => ({ valid: false, reason });

export function validateAction(
  state: GameState,
  action: GameAction,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  // If there's a pending choice, only RESOLVE_CHOICE is legal
  if (state.pendingChoice && action.type !== "RESOLVE_CHOICE") {
    return fail("A choice must be resolved before taking other actions.");
  }

  switch (action.type) {
    case "PLAY_CARD":
      return validatePlayCard(state, action.playerId, action.instanceId, definitions, action.shiftTargetInstanceId);
    case "PLAY_INK":
      return validatePlayInk(state, action.playerId, action.instanceId, definitions);
    case "QUEST":
      return validateQuest(state, action.playerId, action.instanceId, definitions);
    case "CHALLENGE":
      return validateChallenge(state, action.playerId, action.attackerInstanceId, action.defenderInstanceId, definitions);
    case "ACTIVATE_ABILITY":
      return validateActivateAbility(state, action.playerId, action.instanceId, action.abilityIndex, definitions);
    case "PASS_TURN":
      return validatePassTurn(state, action.playerId);
    case "RESOLVE_CHOICE":
      return validateResolveChoice(state, action.playerId);
    case "DRAW_CARD":
      return OK; // Always legal (used internally)
    default:
      return fail("Unknown action type.");
  }
}

function validatePlayCard(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  shiftTargetInstanceId?: string
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "hand") return fail("Card is not in your hand.");

  const def = getDefinition(state, instanceId, definitions);

  // Check shift
  if (shiftTargetInstanceId) {
    if (!def.shiftCost) return fail("This card doesn't have Shift.");
    const shiftTarget = getInstance(state, shiftTargetInstanceId);
    if (shiftTarget.zone !== "play") return fail("Shift target is not in play.");
    if (shiftTarget.ownerId !== playerId) return fail("You don't own the shift target.");
    // Shift target must share a name
    const shiftTargetDef = getDefinition(state, shiftTargetInstanceId, definitions);
    if (shiftTargetDef.name !== def.name) return fail("Shift target must share this character's name.");
    if (!canAfford(state, playerId, def.shiftCost)) {
      return fail(`Not enough ink. Need ${def.shiftCost}, have ${state.players[playerId].availableInk}.`);
    }
    return OK;
  }

  if (!canAfford(state, playerId, def.cost)) {
    return fail(`Not enough ink. Need ${def.cost}, have ${state.players[playerId].availableInk}.`);
  }

  return OK;
}

function validatePlayInk(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");
  if (state.players[playerId].hasPlayedInkThisTurn) return fail("Already played ink this turn.");

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "hand") return fail("Card is not in your hand.");

  const def = getDefinition(state, instanceId, definitions);
  if (!def.inkable) return fail("This card cannot be used as ink.");

  return OK;
}

function validateQuest(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "play") return fail("Card is not in play.");
  if (instance.isExerted) return fail("This character is already exerted.");
  if (instance.hasActedThisTurn) return fail("This character has already acted this turn.");

  const def = getDefinition(state, instanceId, definitions);
  if (def.cardType !== "character") return fail("Only characters can quest.");
  if (!def.lore || def.lore <= 0) return fail("This character has no lore value.");

  return OK;
}

function validateChallenge(
  state: GameState,
  playerId: PlayerID,
  attackerInstanceId: string,
  defenderInstanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const attacker = getInstance(state, attackerInstanceId);
  if (attacker.ownerId !== playerId) return fail("You don't own the attacker.");
  if (attacker.zone !== "play") return fail("Attacker is not in play.");
  if (attacker.isExerted) return fail("Attacker is exerted and cannot challenge.");
  if (attacker.hasActedThisTurn) return fail("Attacker has already acted this turn.");

  const attackerDef = getDefinition(state, attackerInstanceId, definitions);
  if (attackerDef.cardType !== "character") return fail("Only characters can challenge.");

  const defender = getInstance(state, defenderInstanceId);
  const opponent = getOpponent(playerId);
  if (defender.ownerId !== opponent) return fail("Can only challenge opponent's cards.");
  if (defender.zone !== "play") return fail("Defender is not in play.");

  const defenderDef = getDefinition(state, defenderInstanceId, definitions);
  const opponentPlay = getZone(state, opponent, "play");

  // Bodyguard: exerted bodyguards must be challenged before any other character
  const exertedBodyguards = opponentPlay.filter((id) => {
    if (id === defenderInstanceId) return false;
    const inst = getInstance(state, id);
    const def = definitions[inst.definitionId];
    if (!def) return false;
    return inst.isExerted && hasKeyword(inst, def, "bodyguard");
  });

  if (exertedBodyguards.length > 0 && !hasKeyword(defender, defenderDef, "bodyguard")) {
    return fail("Must challenge an exerted Bodyguard character first.");
  }

  // Ward: cannot be targeted by opponent abilities
  if (hasKeyword(defender, defenderDef, "ward")) {
    return fail("Cannot target a character with Ward.");
  }

  // Evasive: can only be challenged by Evasive characters
  if (hasKeyword(defender, defenderDef, "evasive")) {
    if (!hasKeyword(attacker, attackerDef, "evasive")) {
      return fail("Only Evasive characters can challenge an Evasive character.");
    }
  }

  return OK;
}

function validateActivateAbility(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  abilityIndex: number,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "play") return fail("Card is not in play.");

  const def = getDefinition(state, instanceId, definitions);
  const ability = def.abilities[abilityIndex];
  if (!ability || ability.type !== "activated") return fail("No activated ability at that index.");

  // Check costs
  for (const cost of ability.costs) {
    if (cost.type === "exert") {
      if (instance.isExerted) return fail("Card is already exerted.");
    }
    if (cost.type === "pay_ink") {
      if (!canAfford(state, playerId, cost.amount)) {
        return fail(`Not enough ink. Need ${cost.amount}.`);
      }
    }
  }

  return OK;
}

function validatePassTurn(state: GameState, playerId: PlayerID): ValidationResult {
  if (state.currentPlayer !== playerId) return fail("Not your turn.");
  return OK;
}

function validateResolveChoice(state: GameState, playerId: PlayerID): ValidationResult {
  if (!state.pendingChoice) return fail("No pending choice to resolve.");
  if (state.pendingChoice.choosingPlayerId !== playerId) {
    return fail("It's not your choice to make.");
  }
  return OK;
}
