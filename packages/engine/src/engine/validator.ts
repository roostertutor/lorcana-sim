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
  canSingSong,
  getDefinition,
  getInstance,
  getOpponent,
  getZone,
  hasCantQuest,
  hasKeyword,
  isMainPhase,
  isSong,
} from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";

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
      return validatePlayCard(state, action.playerId, action.instanceId, definitions, action.shiftTargetInstanceId, action.singerInstanceId);
    case "PLAY_INK":
      return validatePlayInk(state, action.playerId, action.instanceId, definitions);
    case "QUEST":
      return validateQuest(state, action.playerId, action.instanceId, definitions);
    case "CHALLENGE":
      return validateChallenge(state, action.playerId, action.attackerInstanceId, action.defenderInstanceId, definitions);
    case "ACTIVATE_ABILITY":
      return validateActivateAbility(state, action.playerId, action.instanceId, action.abilityIndex, definitions);
    case "PASS_TURN":
      return validatePassTurn(state, action.playerId, definitions);
    case "RESOLVE_CHOICE":
      return validateResolveChoice(state, action.playerId, action.choice, definitions);
    case "DRAW_CARD":
      return OK; // Always legal (used internally)
    default:
      return fail("Unknown action type.");
  }
}

// CRD 4.3: Play a Card — from hand, pay cost
// CRD 8.10.1: Shift — pay shift cost, put on top of same-named character
// CRD 5.4.4.2: Singing — exert character to play song for free
function validatePlayCard(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  shiftTargetInstanceId?: string,
  singerInstanceId?: string
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "hand") return fail("Card is not in your hand."); // CRD 4.3.2

  const def = getDefinition(state, instanceId, definitions);

  // CRD 8.10.1: Shift — alternate cost onto same-named character in play
  if (shiftTargetInstanceId) {
    if (!def.shiftCost) return fail("This card doesn't have Shift.");
    const shiftTarget = getInstance(state, shiftTargetInstanceId);
    if (shiftTarget.zone !== "play") return fail("Shift target is not in play.");
    if (shiftTarget.ownerId !== playerId) return fail("You don't own the shift target.");
    const shiftTargetDef = getDefinition(state, shiftTargetInstanceId, definitions);
    if (shiftTargetDef.name !== def.name) return fail("Shift target must share this character's name.");
    if (!canAfford(state, playerId, def.shiftCost)) { // CRD 1.5.3
      return fail(`Not enough ink. Need ${def.shiftCost}, have ${state.players[playerId].availableInk}.`);
    }
    return OK;
  }

  // CRD 5.4.4.2: Singing — exert character to play song for free (alternate cost)
  if (singerInstanceId) {
    if (!isSong(def)) return fail("Only songs can be sung.");
    const singer = getInstance(state, singerInstanceId);
    if (singer.zone !== "play") return fail("Singer is not in play.");
    if (singer.ownerId !== playerId) return fail("You don't own the singer.");
    if (singer.isExerted) return fail("Singer is already exerted.");
    if (singer.isDrying) return fail("Singer is still drying and cannot sing.");
    // Ariel - On Human Legs: can't exert to sing
    const modifiers = getGameModifiers(state, definitions);
    if (modifiers.cantSing.has(singerInstanceId)) {
      return fail("This character can't sing songs.");
    }
    const singerDef = getDefinition(state, singerInstanceId, definitions);
    if (!canSingSong(singer, singerDef, def)) {
      return fail(`Singer's cost is too low to sing this song.`);
    }
    return OK; // No ink check — singing replaces ink cost entirely (CRD 1.5.5.1)
  }

  if (!canAfford(state, playerId, def.cost)) { // CRD 1.5.3: cost must be paid in full
    return fail(`Not enough ink. Need ${def.cost}, have ${state.players[playerId].availableInk}.`);
  }

  return OK;
}

// CRD 4.2: Ink a Card — once per turn, inkable card from hand
function validatePlayInk(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");
  if (state.players[playerId].hasPlayedInkThisTurn) return fail("Already played ink this turn."); // CRD 4.2.3

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "hand") return fail("Card is not in your hand.");

  const def = getDefinition(state, instanceId, definitions);
  if (!def.inkable) return fail("This card cannot be used as ink.");

  return OK;
}

// CRD 4.5: Quest — exert dry character, gain lore
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
  if (instance.isExerted) return fail("This character is already exerted."); // CRD 4.5.1.3
  if (instance.isDrying) return fail("This character is still drying and cannot quest."); // CRD 5.1.1.11
  if (hasCantQuest(instance)) return fail("This character can't quest this turn.");

  const def = getDefinition(state, instanceId, definitions);
  if (def.cardType !== "character") return fail("Only characters can quest."); // CRD 5.3.4
  // CRD 8.7.2: Reckless characters can't quest
  if (hasKeyword(instance, def, "reckless")) return fail("Reckless characters can't quest.");
  if (!def.lore || def.lore <= 0) return fail("This character has no lore value."); // CRD 4.5.3.1

  return OK;
}

// CRD 4.6: Challenge — exert dry attacker, choose exerted defender, deal simultaneous damage
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
  if (attacker.isExerted) return fail("Attacker is exerted and cannot challenge."); // CRD 4.6.4.1

  const attackerDef = getDefinition(state, attackerInstanceId, definitions);
  // CRD 8.9.1: Rush bypasses drying for challenges only (not quest)
  if (attacker.isDrying && !hasKeyword(attacker, attackerDef, "rush")) {
    return fail("Attacker is still drying and cannot challenge."); // CRD 5.1.1.11
  }

  if (attackerDef.cardType !== "character") return fail("Only characters can challenge."); // CRD 5.3.4

  const defender = getInstance(state, defenderInstanceId);
  const opponent = getOpponent(playerId);
  if (defender.ownerId !== opponent) return fail("Can only challenge opponent's cards.");
  if (defender.zone !== "play") return fail("Defender is not in play.");

  const modifiers = getGameModifiers(state, definitions);

  // CRD 4.6.4.2: defender must be exerted (unless modifier overrides)
  if (!defender.isExerted && !modifiers.canChallengeReady.has(attackerInstanceId)) {
    return fail("Can only challenge exerted characters.");
  }

  if (modifiers.cantBeChallenged.has(defenderInstanceId)) {
    return fail("This character cannot be challenged.");
  }

  const defenderDef = getDefinition(state, defenderInstanceId, definitions);
  const opponentPlay = getZone(state, opponent, "play");

  // CRD 8.3.3: Bodyguard — exerted bodyguards must be challenged first
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

  // CRD 8.6.1: Evasive — can only be challenged by Evasive characters
  const defHasEvasive = hasKeyword(defender, defenderDef, "evasive") ||
    (modifiers.grantedKeywords.get(defenderInstanceId)?.includes("evasive") ?? false);
  const atkHasEvasive = hasKeyword(attacker, attackerDef, "evasive") ||
    (modifiers.grantedKeywords.get(attackerInstanceId)?.includes("evasive") ?? false);
  if (defHasEvasive) {
    if (!atkHasEvasive) {
      return fail("Only Evasive characters can challenge an Evasive character.");
    }
  }

  return OK;
}

// CRD 4.4: Use an Activated Ability — pay cost, resolve effect
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
      // CRD 6.3.1.1: {E} ability on character requires dry character
      // CRD 6.3.1.2: Items/locations can use activated abilities turn played
      if (instance.isDrying && def.cardType === "character") {
        return fail("This character is still drying and cannot use exert abilities.");
      }
    }
    if (cost.type === "pay_ink") {
      if (!canAfford(state, playerId, cost.amount)) {
        return fail(`Not enough ink. Need ${cost.amount}.`);
      }
    }
  }

  return OK;
}

function validatePassTurn(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (state.currentPlayer !== playerId) return fail("Not your turn.");

  // CRD 8.7.3: Can't pass if you have a ready Reckless character with valid challenge targets
  const myPlay = getZone(state, playerId, "play");
  const opponent = getOpponent(playerId);
  const modifiers = getGameModifiers(state, definitions);

  for (const id of myPlay) {
    const inst = getInstance(state, id);
    if (inst.isExerted) continue; // already exerted — obligation satisfied
    const def = definitions[inst.definitionId];
    if (!def || def.cardType !== "character") continue;
    if (!hasKeyword(inst, def, "reckless")) continue;

    // This character is ready and Reckless — check if it has any valid challenge target
    const opponentPlay = getZone(state, opponent, "play");
    const hasTarget = opponentPlay.some((defId) => {
      const result = validateChallenge(state, playerId, id, defId, definitions);
      return result.valid;
    });

    if (hasTarget) {
      return fail(`${def.fullName} has Reckless and must challenge before passing.`);
    }
  }

  return OK;
}

function validateResolveChoice(
  state: GameState,
  playerId: PlayerID,
  choice: string[] | number | "accept" | "decline",
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!state.pendingChoice) return fail("No pending choice to resolve.");
  if (state.pendingChoice.choosingPlayerId !== playerId) {
    return fail("It's not your choice to make.");
  }

  // CRD 6.1.4: "may" choices accept "accept" or "decline"
  if (state.pendingChoice.type === "choose_may") {
    if (choice !== "accept" && choice !== "decline") {
      return fail("Must accept or decline a 'may' choice.");
    }
    return OK;
  }

  // CRD 6.1.4: optional target choices can be declined with empty array
  if (state.pendingChoice.optional && Array.isArray(choice) && choice.length === 0) {
    return OK;
  }

  // Discard choice validation
  if (state.pendingChoice.type === "choose_discard" && Array.isArray(choice)) {
    const count = state.pendingChoice.count ?? 1;
    if (choice.length !== count) {
      return fail(`Must choose exactly ${count} card(s) to discard.`);
    }
    for (const id of choice) {
      if (!state.pendingChoice.validTargets?.includes(id)) {
        return fail("Invalid card chosen for discard.");
      }
    }
    return OK;
  }

  // CRD 8.15.1: Ward — opponents can't choose this character for their effects
  if (state.pendingChoice.type === "choose_target" && Array.isArray(choice)) {
    const opponent = getOpponent(playerId);
    for (const targetId of choice) {
      const target = getInstance(state, targetId);
      if (target.ownerId === opponent) {
        const targetDef = definitions[target.definitionId];
        if (targetDef && hasKeyword(target, targetDef, "ward")) {
          return fail("Cannot choose a character with Ward as the target of an effect.");
        }
      }
    }
  }

  return OK;
}
