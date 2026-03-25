// =============================================================================
// GAME ENGINE — CORE REDUCER
// Takes a validated action + current state → produces new state + events.
// This is a pure function: same inputs always produce same outputs.
// No side effects, no randomness except shuffle (seeded in future).
// =============================================================================

import type {
  CardDefinition,
  CardInstance,
  GameAction,
  GameEvent,
  GameState,
  PlayerID,
  ActionResult,
  TriggeredAbility,
  Effect,
  Cost,
  PendingTrigger,
} from "../types/index.js";
import { validateAction } from "./validator.js";
import {
  appendLog,
  canSingSong,
  generateId,
  getDefinition,
  getEffectiveLore,
  getEffectiveStrength,
  getEffectiveWillpower,
  getInstance,
  getKeywordValue,
  getOpponent,
  getZone,
  hasKeyword,
  isSong,
  matchesFilter,
  moveCard,
  updateInstance,
} from "../utils/index.js";

// -----------------------------------------------------------------------------
// PUBLIC TYPES
// -----------------------------------------------------------------------------

export interface WinResult {
  isOver: boolean;
  winner: PlayerID | "draw" | null;
  reason: "lore_threshold" | "deck_exhausted" | "card_effect" | "max_turns_exceeded" | null;
}

// -----------------------------------------------------------------------------
// MAIN ENTRY POINT
// -----------------------------------------------------------------------------

export function applyAction(
  state: GameState,
  action: GameAction,
  definitions: Record<string, CardDefinition>
): ActionResult {
  const validation = validateAction(state, action, definitions);
  if (!validation.valid) {
    return { success: false, newState: state, events: [], ...(validation.reason !== undefined ? { error: validation.reason } : {}) };
  }

  const events: GameEvent[] = [];

  try {
    let newState = applyActionInner(state, action, definitions, events);
    // After applying the action, check and resolve triggers
    newState = processTriggerStack(newState, definitions, events);
    // Check win condition
    newState = applyWinCheck(newState, definitions, events);

    return { success: true, newState, events };
  } catch (err) {
    return {
      success: false,
      newState: state,
      error: err instanceof Error ? err.message : "Unknown engine error",
      events: [],
    };
  }
}

// -----------------------------------------------------------------------------
// WIN CONDITIONS (PUBLIC API)
// -----------------------------------------------------------------------------

/**
 * CRD 1.8.1.1: Default lore threshold is 20.
 * Scans in-play cards for static effects that modify it
 * (e.g. Donald Duck - Musketeer).
 */
export function getLoreThreshold(
  _state: GameState,
  _definitions: Record<string, CardDefinition>
): number {
  return 20;
}

/**
 * CRD 2.3.3.1 / 1.8.1.1: Check lore threshold win condition.
 * Deck exhaustion (CRD 2.3.3.2) is a separate end-of-turn condition in applyPassTurn.
 */
export function checkWinConditions(
  state: GameState,
  definitions: Record<string, CardDefinition>
): WinResult {
  if (state.isGameOver) {
    return { isOver: true, winner: state.winner, reason: "lore_threshold" };
  }

  const threshold = getLoreThreshold(state, definitions);
  for (const [playerId, playerState] of Object.entries(state.players)) {
    if (playerState.lore >= threshold) {
      return { isOver: true, winner: playerId as PlayerID, reason: "lore_threshold" };
    }
  }

  return { isOver: false, winner: null, reason: null };
}

// -----------------------------------------------------------------------------
// LEGAL ACTION ENUMERATION
// -----------------------------------------------------------------------------

/**
 * Returns every currently legal action for playerId.
 * Uses validateAction as the gate — no duplicate logic.
 * Bots call this to know their options each turn.
 */
export function getAllLegalActions(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): GameAction[] {
  if (state.isGameOver) return [];
  if (state.currentPlayer !== playerId) return [];

  // If there's a pending choice, only the choosing player can act, and only
  // via RESOLVE_CHOICE — but valid choice values depend on game context,
  // so we return empty here and let the bot resolve it separately.
  if (state.pendingChoice) return [];

  const actions: GameAction[] = [];
  const opponentId = getOpponent(playerId);

  // PASS_TURN — always legal on your turn
  actions.push({ type: "PASS_TURN", playerId });

  const hand = getZone(state, playerId, "hand");
  const myPlay = getZone(state, playerId, "play");
  const opponentPlay = getZone(state, opponentId, "play");

  // PLAY_INK — one per turn, any inkable card in hand
  for (const instanceId of hand) {
    const action: GameAction = { type: "PLAY_INK", playerId, instanceId };
    if (validateAction(state, action, definitions).valid) {
      actions.push(action);
    }
  }

  // PLAY_CARD — normal play and shift (checked independently)
  for (const instanceId of hand) {
    const normalPlay: GameAction = { type: "PLAY_CARD", playerId, instanceId };
    if (validateAction(state, normalPlay, definitions).valid) {
      actions.push(normalPlay);
    }

    // Shift: check independent of normal play affordability
    const cardDef = definitions[state.cards[instanceId]?.definitionId ?? ""];
    if (cardDef?.shiftCost !== undefined) {
      for (const targetId of myPlay) {
        const shiftPlay: GameAction = {
          type: "PLAY_CARD",
          playerId,
          instanceId,
          shiftTargetInstanceId: targetId,
        };
        if (validateAction(state, shiftPlay, definitions).valid) {
          actions.push(shiftPlay);
        }
      }
    }
  }

  // SING — each song in hand × each eligible singer in play (CRD 5.4.4.2)
  for (const songId of hand) {
    const songDef = definitions[state.cards[songId]?.definitionId ?? ""];
    if (!songDef || !isSong(songDef)) continue;
    for (const singerId of myPlay) {
      const singAction: GameAction = {
        type: "PLAY_CARD",
        playerId,
        instanceId: songId,
        singerInstanceId: singerId,
      };
      if (validateAction(state, singAction, definitions).valid) {
        actions.push(singAction);
      }
    }
  }

  // QUEST — each ready, unacted character in play with a lore value
  for (const instanceId of myPlay) {
    const action: GameAction = { type: "QUEST", playerId, instanceId };
    if (validateAction(state, action, definitions).valid) {
      actions.push(action);
    }
  }

  // CHALLENGE — each of my characters vs each exerted opponent character
  for (const attackerInstanceId of myPlay) {
    for (const defenderInstanceId of opponentPlay) {
      const action: GameAction = {
        type: "CHALLENGE",
        playerId,
        attackerInstanceId,
        defenderInstanceId,
      };
      if (validateAction(state, action, definitions).valid) {
        actions.push(action);
      }
    }
  }

  // ACTIVATE_ABILITY — each activatable ability on each card in play
  for (const instanceId of myPlay) {
    const instance = state.cards[instanceId];
    if (!instance) continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;
    for (let i = 0; i < def.abilities.length; i++) {
      if (def.abilities[i]?.type !== "activated") continue;
      const action: GameAction = { type: "ACTIVATE_ABILITY", playerId, instanceId, abilityIndex: i };
      if (validateAction(state, action, definitions).valid) {
        actions.push(action);
      }
    }
  }

  return actions;
}

// -----------------------------------------------------------------------------
// ACTION HANDLERS
// -----------------------------------------------------------------------------

function applyActionInner(
  state: GameState,
  action: GameAction,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  switch (action.type) {
    case "PLAY_CARD":
      return applyPlayCard(state, action.playerId, action.instanceId, definitions, events, action.shiftTargetInstanceId, action.singerInstanceId);
    case "PLAY_INK":
      return applyPlayInk(state, action.playerId, action.instanceId, definitions, events);
    case "QUEST":
      return applyQuest(state, action.playerId, action.instanceId, definitions, events);
    case "CHALLENGE":
      return applyChallenge(state, action.playerId, action.attackerInstanceId, action.defenderInstanceId, definitions, events);
    case "ACTIVATE_ABILITY":
      return applyActivateAbility(state, action.playerId, action.instanceId, action.abilityIndex, definitions, events);
    case "PASS_TURN":
      return applyPassTurn(state, action.playerId, definitions, events);
    case "DRAW_CARD":
      return applyDraw(state, action.playerId, action.amount ?? 1, events);
    case "RESOLVE_CHOICE":
      return applyResolveChoice(state, action.playerId, action.choice, definitions, events);
    default:
      throw new Error("Unhandled action type");
  }
}

function applyPlayCard(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  shiftTargetInstanceId?: string,
  singerInstanceId?: string
): GameState {
  const def = getDefinition(state, instanceId, definitions);

  // CRD 5.4.4.2: Singing — exert character instead of paying ink
  if (singerInstanceId) {
    // Don't deduct ink — singing is the alternate cost (CRD 1.5.5.1)
    state = updateInstance(state, singerInstanceId, { isExerted: true });
    const singerDef = getDefinition(state, singerInstanceId, definitions);
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName} (sung by ${singerDef.fullName}).`,
      type: "card_played",
    });
  } else {
    const cost = shiftTargetInstanceId ? (def.shiftCost ?? def.cost) : def.cost;
    // Deduct ink
    state = updatePlayerInk(state, playerId, -cost);
  }

  if (shiftTargetInstanceId) {
    const shiftTarget = getInstance(state, shiftTargetInstanceId);
    state = moveCard(state, instanceId, playerId, "play");
    state = updateInstance(state, instanceId, {
      isExerted: shiftTarget.isExerted,
      damage: shiftTarget.damage, // CRD 8.10.6: shifted character retains damage from base
      isDrying: shiftTarget.isDrying, // CRD 8.10.4: inherit dry/drying from base card
      shiftedOntoInstanceId: shiftTargetInstanceId,
    });
    state = moveCard(state, shiftTargetInstanceId, playerId, "discard");
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} shifted ${def.fullName} onto ${definitions[shiftTarget.definitionId]?.fullName}.`,
      type: "card_played",
    });
  } else if (def.cardType === "action") {
    // CRD 4.3.3.2: Action enters play zone, effect resolves, then moves to discard
    state = moveCard(state, instanceId, playerId, "play");
    // Actions do NOT set isDrying — they leave immediately
    events.push({ type: "card_moved", instanceId, from: "hand", to: "play" });

    if (!singerInstanceId) {
      // Log only if not already logged by singing branch above
      state = appendLog(state, {
        turn: state.turnNumber,
        playerId,
        message: `${playerId} played ${def.fullName}.`,
        type: "card_played",
      });
    }

    // Queue enters_play triggers (CRD 4.3.4.1)
    state = queueTrigger(state, "enters_play", instanceId, definitions, { triggeringPlayerId: playerId });

    // CRD 5.4.1.2: Resolve action effects inline (NOT through trigger stack)
    if (def.actionEffects) {
      for (const effect of def.actionEffects) {
        state = applyEffect(state, effect, instanceId, playerId, definitions, events);
        // If effect created a pendingChoice, pause — card stays in play (CRD 4.3.3.2)
        if (state.pendingChoice) {
          state = { ...state, pendingActionInstanceId: instanceId };
          return state;
        }
      }
    }

    // No pending choice — move action to discard immediately
    state = moveCard(state, instanceId, playerId, "discard");
    return state;
  } else {
    state = moveCard(state, instanceId, playerId, "play");
    // All characters enter play drying (CRD 5.1.2.1). Rush is handled in
    // the validator — it bypasses isDrying for challenges only (CRD 8.9.1).
    state = updateInstance(state, instanceId, { isDrying: true });
    events.push({ type: "card_moved", instanceId, from: "hand", to: "play" });
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName}.`,
      type: "card_played",
    });
  }

  // Queue "enters play" triggers (for non-action cards)
  state = queueTrigger(state, "enters_play", instanceId, definitions, { triggeringPlayerId: playerId });

  // CRD 8.3.2: Bodyguard — may enter play exerted
  const playedInstance = getInstance(state, instanceId);
  const playedDef = getDefinition(state, instanceId, definitions);
  if (hasKeyword(playedInstance, playedDef, "bodyguard")) {
    const bodyguardTrigger: PendingTrigger = {
      ability: {
        type: "triggered",
        trigger: { on: "enters_play" },
        effects: [{
          type: "exert",
          target: { type: "this" },
          isMay: true, // CRD 6.1.4
        }],
      },
      sourceInstanceId: instanceId,
      context: { triggeringPlayerId: playerId },
    };
    state = { ...state, triggerStack: [...state.triggerStack, bodyguardTrigger] };
  }

  return state;
}

// CRD 4.2: Ink a Card — move inkable card from hand to inkwell, once per turn
function applyPlayInk(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const def = getDefinition(state, instanceId, definitions);
  state = moveCard(state, instanceId, playerId, "inkwell");
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        hasPlayedInkThisTurn: true,
        availableInk: state.players[playerId].availableInk + 1,
      },
    },
  };
  events.push({ type: "card_moved", instanceId, from: "hand", to: "inkwell" });
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} added ${def.fullName} to their inkwell.`,
    type: "ink_played",
  });
  return state;
}

// CRD 4.5: Quest — exert character, gain lore equal to {L}
function applyQuest(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const instance = getInstance(state, instanceId);
  const def = getDefinition(state, instanceId, definitions);
  const loreGained = getEffectiveLore(instance, def);

  state = updateInstance(state, instanceId, { isExerted: true });
  state = gainLore(state, playerId, loreGained, events);

  events.push({ type: "lore_gained", playerId, amount: loreGained });
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId}'s ${def.fullName} quested for ${loreGained} lore.`,
    type: "card_quested",
  });

  state = queueTrigger(state, "quests", instanceId, definitions, { triggeringPlayerId: playerId });

  // CRD 8.13.1: Support — synthesize triggered ability for the bag
  const questingInstance = getInstance(state, instanceId);
  const questingDef = getDefinition(state, instanceId, definitions);
  if (hasKeyword(questingInstance, questingDef, "support")) {
    const supportStrength = getEffectiveStrength(questingInstance, questingDef);
    if (supportStrength > 0) {
      // Check there is at least one other character in play to target
      const otherChars = getZone(state, playerId, "play").filter((id) => {
        if (id === instanceId) return false;
        const inst = state.cards[id];
        if (!inst) return false;
        const d = definitions[inst.definitionId];
        return d?.cardType === "character";
      });
      if (otherChars.length > 0) {
        const supportTrigger: PendingTrigger = {
          ability: {
            type: "triggered",
            trigger: { on: "quests" },
            effects: [{
              type: "gain_stats",
              strength: supportStrength,
              target: {
                type: "chosen",
                filter: {
                  owner: { type: "self" },
                  zone: "play",
                  cardType: ["character"],
                  excludeInstanceId: instanceId,
                },
              },
              duration: "this_turn",
              isMay: true, // CRD 6.1.4
            }],
          },
          sourceInstanceId: instanceId,
          context: { triggeringPlayerId: playerId },
        };
        state = { ...state, triggerStack: [...state.triggerStack, supportTrigger] };
      }
    }
  }

  return state;
}

// CRD 4.6: Challenge — exert attacker, deal simultaneous damage (CRD 4.6.6.2)
function applyChallenge(
  state: GameState,
  playerId: PlayerID,
  attackerInstanceId: string,
  defenderInstanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const attacker = getInstance(state, attackerInstanceId);
  const defender = getInstance(state, defenderInstanceId);
  const attackerDef = getDefinition(state, attackerInstanceId, definitions);
  const defenderDef = getDefinition(state, defenderInstanceId, definitions);

  let attackerStr = getEffectiveStrength(attacker, attackerDef);
  const defenderStr = getEffectiveStrength(defender, defenderDef);

  // CRD 8.5.1: Challenger +N bonus (only when attacking, not defending — CRD 8.5.2)
  const challengerBonus = attackerDef.abilities.find(
    (a) => a.type === "keyword" && a.keyword === "challenger"
  );
  if (challengerBonus?.type === "keyword") {
    attackerStr += challengerBonus.value ?? 0;
  }

  state = updateInstance(state, attackerInstanceId, { isExerted: true });

  // CRD 8.8.1: Resist +N reduces incoming challenge damage (min 0)
  const attackerResist = getKeywordValue(attacker, attackerDef, "resist");
  const defenderResist = getKeywordValue(defender, defenderDef, "resist");
  const actualAttackerDamage = Math.max(0, defenderStr - attackerResist);
  const actualDefenderDamage = Math.max(0, attackerStr - defenderResist);

  const newAttackerDamage = attacker.damage + actualAttackerDamage;
  const newDefenderDamage = defender.damage + actualDefenderDamage;

  state = updateInstance(state, attackerInstanceId, { damage: newAttackerDamage });
  state = updateInstance(state, defenderInstanceId, { damage: newDefenderDamage });

  events.push({ type: "damage_dealt", instanceId: attackerInstanceId, amount: actualAttackerDamage });
  events.push({ type: "damage_dealt", instanceId: defenderInstanceId, amount: actualDefenderDamage });

  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId}'s ${attackerDef.fullName} (${attackerStr}) challenged ${defenderDef.fullName} (${defenderStr}).`,
    type: "card_challenged",
  });

  state = queueTrigger(state, "challenges", attackerInstanceId, definitions, {
    triggeringCardInstanceId: defenderInstanceId,
  });
  state = queueTrigger(state, "is_challenged", defenderInstanceId, definitions, {
    triggeringCardInstanceId: attackerInstanceId,
  });

  const attackerWp = getEffectiveWillpower(attacker, attackerDef);
  const defenderWp = getEffectiveWillpower(defender, defenderDef);

  if (newAttackerDamage >= attackerWp) {
    state = banishCard(state, attackerInstanceId, definitions, events);
  }
  if (newDefenderDamage >= defenderWp) {
    state = banishCard(state, defenderInstanceId, definitions, events);
  }

  return state;
}

function applyActivateAbility(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  abilityIndex: number,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const def = getDefinition(state, instanceId, definitions);
  const ability = def.abilities[abilityIndex];
  if (!ability || ability.type !== "activated") throw new Error("Invalid ability");

  state = payCosts(state, playerId, instanceId, ability.costs, events);

  for (const effect of ability.effects) {
    state = applyEffect(state, effect, instanceId, playerId, definitions, events);
  }

  events.push({ type: "ability_triggered", instanceId, abilityType: "activated" });
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} activated an ability on ${def.fullName}.`,
    type: "ability_activated",
  });

  return state;
}

function applyPassTurn(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const opponent = getOpponent(playerId);

  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} passed the turn.`,
    type: "turn_end",
  });

  // CRD 3.4.1.1: end-of-turn triggered abilities
  state = queueTriggersByEvent(state, "turn_end", playerId, definitions, {});
  state = processTriggerStack(state, definitions, events);

  // CRD 2.3.3.2: Player who ends turn with empty deck loses
  const deckAtEndOfTurn = getZone(state, playerId, "deck");
  if (deckAtEndOfTurn.length === 0) {
    const winner = getOpponent(playerId);
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} has no cards in deck at end of turn. ${winner} wins!`,
      type: "game_over",
    });
    return {
      ...state,
      isGameOver: true,
      winner,
    };
  }

  // Transition to opponent's turn
  const newTurnNumber = state.turnNumber + 1;
  state = {
    ...state,
    currentPlayer: opponent,
    turnNumber: newTurnNumber,
    phase: "beginning",
    players: {
      ...state.players,
      [opponent]: {
        ...state.players[opponent],
        hasPlayedInkThisTurn: false,
        availableInk: getZone(state, opponent, "inkwell").length,
      },
    },
  };

  // Ready all of opponent's cards in play and inkwell (CRD 3.2.1.1)
  const opponentPlay = getZone(state, opponent, "play");
  for (const id of opponentPlay) {
    state = updateInstance(state, id, { isExerted: false, isDrying: false });
  }
  const opponentInkwell = getZone(state, opponent, "inkwell");
  for (const id of opponentInkwell) {
    state = updateInstance(state, id, { isExerted: false });
  }

  // CRD 3.4.1.2: effects that end "this turn" — clear temp modifiers
  for (const id of Object.keys(state.cards)) {
    const instance = getInstance(state, id);
    if (
      instance.tempStrengthModifier !== 0 ||
      instance.tempWillpowerModifier !== 0 ||
      instance.tempLoreModifier !== 0 ||
      instance.grantedKeywords.length > 0
    ) {
      state = updateInstance(state, id, {
        tempStrengthModifier: 0,
        tempWillpowerModifier: 0,
        tempLoreModifier: 0,
        grantedKeywords: [],
      });
    }
  }

  // CRD 3.2.3.1: draw step — active player draws a card
  state = applyDraw(state, opponent, 1, events);

  state = { ...state, phase: "main" };

  events.push({ type: "turn_passed", to: opponent });

  state = appendLog(state, {
    turn: newTurnNumber,
    playerId: opponent,
    message: `${opponent}'s turn begins.`,
    type: "turn_start",
  });

  return state;
}

// CRD 1.12: Drawing — top card of deck to hand, one at a time
function applyDraw(
  state: GameState,
  playerId: PlayerID,
  amount: number,
  events: GameEvent[]
): GameState {
  for (let i = 0; i < amount; i++) {
    const deck = getZone(state, playerId, "deck");
    if (deck.length === 0) break;
    const topCardId = deck[0];
    if (!topCardId) break;
    state = moveCard(state, topCardId, playerId, "hand");
    events.push({ type: "card_drawn", playerId, instanceId: topCardId });
  }
  return state;
}

function applyResolveChoice(
  state: GameState,
  playerId: PlayerID,
  choice: string[] | number | "accept" | "decline",
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  if (!state.pendingChoice) return state;

  const { pendingChoice } = state;
  const pendingEffect = pendingChoice.pendingEffect;
  state = { ...state, pendingChoice: null };

  // CRD 6.1.4: "may" effect — accept or decline
  if (pendingChoice.type === "choose_may") {
    if (choice === "accept") {
      // Apply the effect — which may itself create a target choice (e.g. Support)
      const sourceId = pendingChoice.sourceInstanceId ?? "";
      state = applyEffect(state, pendingEffect, sourceId, playerId, definitions, events);
    }
    // "decline" → skip, clear pendingChoice (already done above)
    return state;
  }

  if (pendingChoice.type === "choose_target" && Array.isArray(choice)) {
    // CRD 6.1.4: optional target choice — empty array = skip
    if (pendingChoice.optional && choice.length === 0) {
      // Still need to clean up action if pending
      state = cleanupPendingAction(state, playerId);
      return state;
    }
    for (const targetId of choice) {
      state = applyEffectToTarget(state, pendingEffect, targetId, playerId, definitions, events);
    }
  }

  // CRD 4.3.3.2: After action effect's choice resolves, move action to discard
  state = cleanupPendingAction(state, playerId);

  return state;
}

// -----------------------------------------------------------------------------
// EFFECT RESOLUTION
// -----------------------------------------------------------------------------

export function applyEffect(
  state: GameState,
  effect: Effect,
  sourceInstanceId: string,
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  switch (effect.type) {
    case "draw": {
      const targetPlayer =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : controllingPlayerId;
      const amount = effect.amount === "X" ? 1 : effect.amount;
      return applyDraw(state, targetPlayer, amount, events);
    }

    case "gain_lore": {
      const targetPlayer =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : controllingPlayerId;
      return gainLore(state, targetPlayer, effect.amount, events);
    }

    case "deal_damage": {
      if (effect.target.type === "this") {
        const amount = effect.amount === "X" ? 1 : effect.amount;
        return dealDamageToCard(state, sourceInstanceId, amount, definitions, events);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a target to deal damage to.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        const amount = effect.amount === "X" ? 1 : effect.amount;
        for (const targetId of targets) {
          state = dealDamageToCard(state, targetId, amount, definitions, events);
        }
        return state;
      }
      return state;
    }

    case "banish": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a target to banish.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "all") {
        // CRD 5.4.1.2: "banish all" resolves immediately
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        for (const targetId of targets) {
          // Skip if already banished by a previous iteration (e.g. cascading triggers)
          const inst = state.cards[targetId];
          if (!inst || inst.zone !== "play") continue;
          state = banishCard(state, targetId, definitions, events);
        }
        return state;
      }
      if (effect.target.type === "this") {
        return banishCard(state, sourceInstanceId, definitions, events);
      }
      return state;
    }

    case "return_to_hand": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card to return to hand.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "this") {
        return moveCard(state, sourceInstanceId, controllingPlayerId, "hand");
      }
      return state;
    }

    case "heal": {
      if (effect.target.type === "this") {
        const instance = getInstance(state, sourceInstanceId);
        return updateInstance(state, sourceInstanceId, {
          damage: Math.max(0, instance.damage - effect.amount),
        });
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to heal.",
            validTargets,
            pendingEffect: effect,
            optional: true, // "Remove up to N" — player can decline
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        for (const targetId of targets) {
          const inst = getInstance(state, targetId);
          state = updateInstance(state, targetId, {
            damage: Math.max(0, inst.damage - effect.amount),
          });
        }
        return state;
      }
      return state;
    }

    case "gain_stats": {
      if (effect.target.type === "this") {
        const instance = getInstance(state, sourceInstanceId);
        return updateInstance(state, sourceInstanceId, {
          tempStrengthModifier: instance.tempStrengthModifier + (effect.strength ?? 0),
          tempWillpowerModifier: instance.tempWillpowerModifier + (effect.willpower ?? 0),
          tempLoreModifier: instance.tempLoreModifier + (effect.lore ?? 0),
        });
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a target.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      return state;
    }

    case "exert": {
      if (effect.target.type === "this") {
        return updateInstance(state, sourceInstanceId, { isExerted: true });
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to exert.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions);
        for (const targetId of targets) {
          state = updateInstance(state, targetId, { isExerted: true });
        }
        return state;
      }
      return state;
    }

    default:
      return state; // Unimplemented effect type — no-op for now
  }
}

// -----------------------------------------------------------------------------
// TRIGGER SYSTEM
// -----------------------------------------------------------------------------

function queueTrigger(
  state: GameState,
  eventType: string,
  sourceInstanceId: string,
  definitions: Record<string, CardDefinition>,
  context: { triggeringPlayerId?: PlayerID; triggeringCardInstanceId?: string }
): GameState {
  const instance = state.cards[sourceInstanceId];
  if (!instance) return state;
  const def = definitions[instance.definitionId];
  if (!def) return state;

  const newTriggers = def.abilities
    .filter(
      (a): a is TriggeredAbility =>
        a.type === "triggered" && a.trigger.on === eventType
    )
    .map((ability) => ({
      ability,
      sourceInstanceId,
      context,
    }));

  if (newTriggers.length === 0) return state;

  return { ...state, triggerStack: [...state.triggerStack, ...newTriggers] };
}

function queueTriggersByEvent(
  state: GameState,
  eventType: string,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  _context: object
): GameState {
  for (const [instanceId, instance] of Object.entries(state.cards)) {
    if (instance.zone !== "play") continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    for (const ability of def.abilities) {
      if (ability.type !== "triggered") continue;
      if (ability.trigger.on !== eventType) continue;
      state = {
        ...state,
        triggerStack: [
          ...state.triggerStack,
          { ability, sourceInstanceId: instanceId, context: { triggeringPlayerId: playerId } },
        ],
      };
    }
  }
  return state;
}

function processTriggerStack(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  let safety = 0;
  while (state.triggerStack.length > 0 && !state.pendingChoice) {
    if (++safety > 100) throw new Error("Trigger loop detected");

    const [trigger, ...rest] = state.triggerStack;
    if (!trigger) break;
    state = { ...state, triggerStack: rest };

    const source = state.cards[trigger.sourceInstanceId];
    // CRD 6.2.3 / 1.6.1: triggers fire from bag. Banished/leaves_play triggers
    // fire even after card leaves play — only fizzle if instance doesn't exist.
    if (!source) continue;
    const requiresInPlay = !["is_banished", "leaves_play"].includes(trigger.ability.trigger.on);
    if (requiresInPlay && source.zone !== "play") continue;

    events.push({ type: "ability_triggered", instanceId: trigger.sourceInstanceId, abilityType: "triggered" });

    for (const effect of trigger.ability.effects) {
      // CRD 6.1.4: "may" effects require player decision before resolving
      if ("isMay" in effect && effect.isMay) {
        state = {
          ...state,
          pendingChoice: {
            type: "choose_may",
            choosingPlayerId: source.ownerId,
            prompt: "You may use this effect. Accept or decline?",
            pendingEffect: effect,
            optional: true,
            sourceInstanceId: trigger.sourceInstanceId,
          },
        };
        break; // Pause trigger processing — will resume after choice
      }

      state = applyEffect(
        state,
        effect,
        trigger.sourceInstanceId,
        source.ownerId,
        definitions,
        events
      );
    }
  }
  return state;
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/** CRD 4.3.3.2: After action effect resolves, move action card from play to discard */
function cleanupPendingAction(state: GameState, playerId: PlayerID): GameState {
  if (state.pendingActionInstanceId && !state.pendingChoice) {
    const actionInstanceId = state.pendingActionInstanceId;
    // Verify the card is still in play before moving (it might have been moved by an effect)
    const instance = state.cards[actionInstanceId];
    if (instance && instance.zone === "play") {
      state = moveCard(state, actionInstanceId, playerId, "discard");
    }
    const { pendingActionInstanceId: _, ...rest } = state;
    state = rest as GameState;
  }
  return state;
}

function gainLore(
  state: GameState,
  playerId: PlayerID,
  amount: number,
  events: GameEvent[]
): GameState {
  // CRD 1.11.1: Lore can't go below 0
  const newLore = Math.max(0, state.players[playerId].lore + amount);
  events.push({ type: "lore_gained", playerId, amount });
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], lore: newLore },
    },
  };
}

// CRD 1.8.1.4: character with damage >= willpower is banished
function banishCard(
  state: GameState,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];

  state = queueTrigger(state, "is_banished", instanceId, definitions, {});
  state = moveCard(state, instanceId, instance.ownerId, "discard");
  events.push({ type: "card_banished", instanceId });

  if (def) {
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId: instance.ownerId,
      message: `${def.fullName} was banished.`,
      type: "card_banished",
    });
  }

  return state;
}

function dealDamageToCard(
  state: GameState,
  instanceId: string,
  amount: number,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  /** CRD 8.8.3: Resist only reduces "dealt" damage, not "put" or "moved" damage */
  ignoreResist = false
): GameState {
  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];
  if (!def) return state;

  const resistValue = ignoreResist ? 0 : getKeywordValue(instance, def, "resist");
  const actualDamage = Math.max(0, amount - resistValue);

  const newDamage = instance.damage + actualDamage;
  state = updateInstance(state, instanceId, { damage: newDamage });
  events.push({ type: "damage_dealt", instanceId, amount: actualDamage });

  const willpower = getEffectiveWillpower(instance, def);
  if (newDamage >= willpower) {
    state = banishCard(state, instanceId, definitions, events);
  }

  return state;
}

function applyEffectToTarget(
  state: GameState,
  effect: Effect,
  targetInstanceId: string,
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  switch (effect.type) {
    case "deal_damage": {
      const amount = effect.amount === "X" ? 1 : effect.amount;
      return dealDamageToCard(state, targetInstanceId, amount, definitions, events);
    }
    case "banish":
      return banishCard(state, targetInstanceId, definitions, events);
    case "return_to_hand": {
      const instance = getInstance(state, targetInstanceId);
      return moveCard(state, targetInstanceId, instance.ownerId, "hand");
    }
    case "gain_stats": {
      const instance = getInstance(state, targetInstanceId);
      return updateInstance(state, targetInstanceId, {
        tempStrengthModifier: instance.tempStrengthModifier + (effect.strength ?? 0),
        tempWillpowerModifier: instance.tempWillpowerModifier + (effect.willpower ?? 0),
        tempLoreModifier: instance.tempLoreModifier + (effect.lore ?? 0),
      });
    }
    case "heal": {
      const instance = getInstance(state, targetInstanceId);
      return updateInstance(state, targetInstanceId, {
        damage: Math.max(0, instance.damage - effect.amount),
      });
    }
    case "exert":
      return updateInstance(state, targetInstanceId, { isExerted: true });
    default:
      return state;
  }
}

function payCosts(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  costs: Cost[],
  _events: GameEvent[]
): GameState {
  for (const cost of costs) {
    if (cost.type === "exert") {
      state = updateInstance(state, instanceId, { isExerted: true });
    }
    if (cost.type === "pay_ink") {
      state = updatePlayerInk(state, playerId, -cost.amount);
    }
    if (cost.type === "banish_self") {
      state = moveCard(state, instanceId, playerId, "discard");
    }
  }
  return state;
}

function updatePlayerInk(state: GameState, playerId: PlayerID, delta: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        availableInk: state.players[playerId].availableInk + delta,
      },
    },
  };
}

function findValidTargets(
  state: GameState,
  filter: import("../types/index.js").CardFilter,
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>
): string[] {
  return Object.values(state.cards)
    .filter((instance) => {
      const def = definitions[instance.definitionId];
      if (!def) return false;
      return matchesFilter(instance, def, filter, state, controllingPlayerId);
    })
    .map((i) => i.instanceId);
}

/** CRD 1.8: Game state check — uses getLoreThreshold, never hardcodes 20. */
function applyWinCheck(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  _events: GameEvent[]
): GameState {
  if (state.isGameOver) return state;

  const threshold = getLoreThreshold(state, definitions);
  for (const [playerId, playerState] of Object.entries(state.players)) {
    if (playerState.lore >= threshold) {
      return { ...state, winner: playerId as PlayerID, isGameOver: true };
    }
  }
  return state;
}
