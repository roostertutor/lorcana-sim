// =============================================================================
// GAME ENGINE — CORE REDUCER
// Takes a validated action + current state → produces new state + events.
// This is a pure function: same inputs always produce same outputs.
// No side effects, no randomness except shuffle (seeded in future).
// =============================================================================

import type {
  CardDefinition,
  CardInstance,
  Condition,
  GameAction,
  GameEvent,
  GameState,
  PlayerID,
  ActionResult,
  TriggeredAbility,
  TimedEffect,
  Effect,
  Cost,
  PendingTrigger,
  ZoneName,
} from "../types/index.js";
import { getGameModifiers } from "./gameModifiers.js";
import { validateAction } from "./validator.js";
import {
  appendLog,
  canSingSong,
  evaluateCondition,
  findMatchingInstances,
  generateId,
  getDefinition,
  getEffectiveLore,
  getEffectiveStrength,
  getEffectiveWillpower,
  getInstance,
  getKeywordValue,
  getOpponent,
  getZone,
  hasCantQuest,
  hasCantReady,
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
    const baseCost = shiftTargetInstanceId ? (def.shiftCost ?? def.cost) : def.cost;
    // Apply cost reductions
    const instance = getInstance(state, instanceId);
    let cost = baseCost;

    // Static cost reductions (e.g. Mickey: Broom chars cost 1 less)
    const modifiers = getGameModifiers(state, definitions);
    const staticReductions = modifiers.costReductions.get(playerId) ?? [];
    for (const red of staticReductions) {
      if (matchesFilter(instance, def, red.filter, state, playerId)) {
        cost -= red.amount;
      }
    }

    // One-shot cost reductions — consume matching ones
    const oneShot = state.players[playerId].costReductions ?? [];
    const remainingReductions: typeof oneShot = [];
    for (const red of oneShot) {
      if (matchesFilter(instance, def, red.filter, state, playerId) && cost > 0) {
        cost -= red.amount;
        // consumed — don't add to remaining
      } else {
        remainingReductions.push(red);
      }
    }

    // CRD 6.1.12: Self-cost-reduction from hand (e.g. LeFou: costs 1 less if Gaston in play)
    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      if (ability.effect.type !== "self_cost_reduction") continue;
      if (ability.condition) {
        if (!evaluateCondition(ability.condition, state, definitions, playerId, instanceId)) {
          continue;
        }
      }
      cost -= ability.effect.amount;
    }

    cost = Math.max(0, cost);

    // Update remaining one-shot reductions
    if (oneShot.length > 0) {
      state = {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...state.players[playerId], costReductions: remainingReductions },
        },
      };
    }

    // Deduct ink
    state = updatePlayerInk(state, playerId, -cost);
  }

  if (shiftTargetInstanceId) {
    const shiftTarget = getInstance(state, shiftTargetInstanceId);
    // Shifted card enters play — fires enters_play, card_played
    state = zoneTransition(state, instanceId, "play", definitions, events, {
      reason: "played", triggeringPlayerId: playerId,
    });
    state = updateInstance(state, instanceId, {
      isExerted: shiftTarget.isExerted,
      damage: shiftTarget.damage, // CRD 8.10.6: shifted character retains damage from base
      isDrying: shiftTarget.isDrying, // CRD 8.10.4: inherit dry/drying from base card
      shiftedOntoInstanceId: shiftTargetInstanceId,
    });
    // Base card goes to discard silently (not a "banish" or "leaves play" per CRD 8.10)
    state = zoneTransition(state, shiftTargetInstanceId, "discard", definitions, events, { silent: true });
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} shifted ${def.fullName} onto ${definitions[shiftTarget.definitionId]?.fullName}.`,
      type: "card_played",
    });
  } else if (def.cardType === "action") {
    // CRD 4.3.3.2: Action enters play zone, effect resolves, then moves to discard
    state = zoneTransition(state, instanceId, "play", definitions, events, {
      reason: "played", triggeringPlayerId: playerId,
    });

    if (!singerInstanceId) {
      state = appendLog(state, {
        turn: state.turnNumber,
        playerId,
        message: `${playerId} played ${def.fullName}.`,
        type: "card_played",
      });
    }

    // CRD 5.4.1.2: Resolve action effects inline (NOT through trigger stack)
    if (def.actionEffects) {
      for (let i = 0; i < def.actionEffects.length; i++) {
        const effect = def.actionEffects[i]!;
        state = applyEffect(state, effect, instanceId, playerId, definitions, events);
        if (state.pendingChoice) {
          const remaining = def.actionEffects.slice(i + 1);
          if (remaining.length > 0) {
            state = { ...state, pendingEffectQueue: { effects: remaining, sourceInstanceId: instanceId, controllingPlayerId: playerId } };
          }
          state = { ...state, pendingActionInstanceId: instanceId };
          return state;
        }
      }
    }

    // No pending choice — action cleanup (silent, not a "leaves play")
    state = zoneTransition(state, instanceId, "discard", definitions, events, { silent: true });
    return state;
  } else {
    // Characters/items enter play — zoneTransition fires enters_play, card_played, item_played
    state = zoneTransition(state, instanceId, "play", definitions, events, {
      reason: "played", triggeringPlayerId: playerId,
    });
    // CRD 5.1.2.1: All characters enter play drying
    state = updateInstance(state, instanceId, { isDrying: true });
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName}.`,
      type: "card_played",
    });
  }

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
    // Prepend so bodyguard is resolved before other enters_play triggers (FIFO)
    state = { ...state, triggerStack: [bodyguardTrigger, ...state.triggerStack] };
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
  state = zoneTransition(state, instanceId, "inkwell", definitions, events, {
    reason: "inked", triggeringPlayerId: playerId,
  });
  const currentInkPlays = state.players[playerId].inkPlaysThisTurn ?? 0;
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        hasPlayedInkThisTurn: true,
        inkPlaysThisTurn: currentInkPlays + 1,
        availableInk: state.players[playerId].availableInk + 1,
      },
    },
  };
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
  const modifiers = getGameModifiers(state, definitions);
  const staticBonus = modifiers.statBonuses.get(instanceId)?.lore ?? 0;
  const loreGained = getEffectiveLore(instance, def, staticBonus);

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

  // CRD 6.2.7.1: Check floating triggers (e.g. Steal from the Rich)
  if (state.floatingTriggers) {
    for (const ft of state.floatingTriggers) {
      if (ft.trigger.on === "quests" && ft.controllingPlayerId === playerId) {
        // Check filter if present
        const triggerFilter = "filter" in ft.trigger ? ft.trigger.filter : undefined;
        if (triggerFilter) {
          const questInst = getInstance(state, instanceId);
          const questDef = getDefinition(state, instanceId, definitions);
          if (!matchesFilter(questInst, questDef, triggerFilter, state, playerId)) continue;
        }
        // Apply floating trigger effects
        for (const effect of ft.effects) {
          state = applyEffect(state, effect, instanceId, ft.controllingPlayerId, definitions, events);
        }
      }
    }
  }

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
  const modifiers = getGameModifiers(state, definitions);

  const atkStaticStr = modifiers.statBonuses.get(attackerInstanceId)?.strength ?? 0;
  const defStaticStr = modifiers.statBonuses.get(defenderInstanceId)?.strength ?? 0;
  let attackerStr = getEffectiveStrength(attacker, attackerDef, atkStaticStr);
  const defenderStr = getEffectiveStrength(defender, defenderDef, defStaticStr);

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

  const atkStaticWp = modifiers.statBonuses.get(attackerInstanceId)?.willpower ?? 0;
  const defStaticWp = modifiers.statBonuses.get(defenderInstanceId)?.willpower ?? 0;
  const attackerWp = getEffectiveWillpower(attacker, attackerDef, atkStaticWp);
  const defenderWp = getEffectiveWillpower(defender, defenderDef, defStaticWp);

  const attackerBanished = newAttackerDamage >= attackerWp;
  const defenderBanished = newDefenderDamage >= defenderWp;

  if (attackerBanished) {
    state = banishCard(state, attackerInstanceId, definitions, events, {
      challengeOpponentId: defenderInstanceId,
    });
  }
  if (defenderBanished) {
    state = banishCard(state, defenderInstanceId, definitions, events, {
      challengeOpponentId: attackerInstanceId,
    });
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

  state = payCosts(state, playerId, instanceId, ability.costs, events, definitions);

  // CRD 6.2.1: Check condition before resolving effects (costs still paid)
  if (ability.condition) {
    if (!evaluateCondition(ability.condition, state, definitions, playerId, instanceId)) {
      // Condition not met after paying costs — ability fizzles
      events.push({ type: "ability_triggered", instanceId, abilityType: "activated" });
      return state;
    }
  }

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
        inkPlaysThisTurn: 0,
        availableInk: getZone(state, opponent, "inkwell").length,
        costReductions: [], // Clear one-shot cost reductions at turn start
      },
    },
  };

  // Ready all of opponent's cards in play and inkwell (CRD 3.2.1.1)
  // Respect "can't ready" timed effects
  const opponentPlay = getZone(state, opponent, "play");
  for (const id of opponentPlay) {
    const inst = getInstance(state, id);
    if (hasCantReady(inst)) {
      // CRD: Can't ready — only clear isDrying, keep exerted
      state = updateInstance(state, id, { isDrying: false });
    } else {
      state = updateInstance(state, id, { isExerted: false, isDrying: false });
    }
  }
  const opponentInkwell = getZone(state, opponent, "inkwell");
  for (const id of opponentInkwell) {
    state = updateInstance(state, id, { isExerted: false });
  }

  // CRD 6.2.7.1: Clear floating triggers at end of turn
  if (state.floatingTriggers && state.floatingTriggers.length > 0) {
    state = { ...state, floatingTriggers: [] };
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

  // Expire timed effects based on duration
  for (const id of Object.keys(state.cards)) {
    const instance = getInstance(state, id);
    if (instance.timedEffects.length === 0) continue;
    const remaining = instance.timedEffects.filter((te) => {
      // "end_of_turn" expires at end of the turn it was applied
      if (te.expiresAt === "end_of_turn") return false;
      // "rest_of_turn" expires at end of the turn it was applied
      if (te.expiresAt === "rest_of_turn") return false;
      // "end_of_owner_next_turn" expires at end of the owner's next turn
      // It persists through the opponent's turn, then expires when the owner's turn ends
      if (te.expiresAt === "end_of_owner_next_turn") {
        // The effect was applied on a previous turn AND the current turn's owner matches
        // the card's owner — this is the owner's turn ending
        if (te.appliedOnTurn < newTurnNumber && instance.ownerId === playerId) {
          return false;
        }
        return true;
      }
      return true;
    });
    if (remaining.length !== instance.timedEffects.length) {
      state = updateInstance(state, id, { timedEffects: remaining });
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

  if (pendingChoice.type === "choose_discard" && Array.isArray(choice)) {
    // Discard the chosen cards from hand
    for (const cardId of choice) {
      const inst = state.cards[cardId];
      if (inst && inst.zone === "hand") {
        state = moveCard(state, cardId, inst.ownerId, "discard");
      }
    }
    state = resumePendingEffectQueue(state, definitions, events);
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_target" && Array.isArray(choice)) {
    // CRD 6.1.4: optional target choice — empty array = skip
    if (pendingChoice.optional && choice.length === 0) {
      state = resumePendingEffectQueue(state, definitions, events);
      state = cleanupPendingAction(state, playerId);
      return state;
    }
    for (const targetId of choice) {
      state = applyEffectToTarget(state, pendingEffect, targetId, playerId, definitions, events);
      // Apply follow-up effects to the same target
      if (pendingChoice.followUpEffects) {
        for (const followUp of pendingChoice.followUpEffects) {
          state = applyEffectToTarget(state, followUp, targetId, playerId, definitions, events);
        }
      }
    }
  }

  // Resume any pending effect queue (e.g. multi-effect actions like "ready + can't quest")
  state = resumePendingEffectQueue(state, definitions, events);

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
  events: GameEvent[],
  triggeringCardInstanceId?: string
): GameState {
  switch (effect.type) {
    case "draw": {
      const amount = effect.amount === "X" ? 1
        : effect.amount === "cost_result" ? (state.lastEffectResult ?? 0)
        : effect.amount;
      if (amount <= 0) return state;
      if (effect.target.type === "both") {
        state = applyDraw(state, controllingPlayerId, amount, events);
        state = applyDraw(state, getOpponent(controllingPlayerId), amount, events);
        return state;
      }
      const targetPlayer =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : controllingPlayerId;
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
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const trigInst = state.cards[triggeringCardInstanceId];
        if (trigInst) {
          return banishCard(state, triggeringCardInstanceId, definitions, events);
        }
      }
      return state;
    }

    case "return_to_hand": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        return zoneTransition(state, sourceInstanceId, "hand", definitions, events, { reason: "returned" });
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const trigInst = state.cards[triggeringCardInstanceId];
        if (trigInst) {
          return zoneTransition(state, triggeringCardInstanceId, "hand", definitions, events, { reason: "returned" });
        }
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
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const inst = state.cards[triggeringCardInstanceId];
        if (inst && !inst.isExerted) {
          return updateInstance(state, triggeringCardInstanceId, { isExerted: true });
        }
        return state;
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        const count = effect.target.count ?? 1;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: count > 1 ? `Choose up to ${count} characters to exert.` : "Choose a character to exert.",
            validTargets,
            pendingEffect: effect,
            followUpEffects: effect.followUpEffects,
            optional: effect.isUpTo ?? false,
            count,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = updateInstance(state, targetId, { isExerted: true });
          if (effect.followUpEffects) {
            for (const followUp of effect.followUpEffects) {
              state = applyEffectToTarget(state, followUp, targetId, controllingPlayerId, definitions, events);
            }
          }
        }
        return state;
      }
      return state;
    }

    case "grant_keyword": {
      const timedEffect: TimedEffect = {
        type: "grant_keyword",
        keyword: effect.keyword,
        value: effect.value,
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: `Choose a character to grant ${effect.keyword}.`,
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = addTimedEffect(state, targetId, timedEffect);
        }
        return state;
      }
      return state;
    }

    case "ready": {
      if (effect.target.type === "this") {
        state = updateInstance(state, sourceInstanceId, { isExerted: false });
        // Apply follow-up effects to self
        if (effect.followUpEffects) {
          for (const followUp of effect.followUpEffects) {
            state = applyEffectToTarget(state, followUp, sourceInstanceId, controllingPlayerId, definitions, events);
          }
        }
        return state;
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to ready.",
            validTargets,
            pendingEffect: effect,
            followUpEffects: effect.followUpEffects,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = updateInstance(state, targetId, { isExerted: false });
          if (effect.followUpEffects) {
            for (const followUp of effect.followUpEffects) {
              state = applyEffectToTarget(state, followUp, targetId, controllingPlayerId, definitions, events);
            }
          }
        }
        return state;
      }
      return state;
    }

    case "cant_quest": {
      const timedEffect: TimedEffect = {
        type: "cant_quest",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character that can't quest.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = addTimedEffect(state, targetId, timedEffect);
        }
        return state;
      }
      return state;
    }

    case "cant_ready": {
      const timedEffect: TimedEffect = {
        type: "cant_ready",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character that can't ready.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = addTimedEffect(state, targetId, timedEffect);
        }
        return state;
      }
      return state;
    }

    case "look_at_top": {
      // Headless engine: bot auto-resolves look_at_top choices
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId) : controllingPlayerId;
      const deck = getZone(state, targetPlayer, "deck");
      const lookCount = Math.min(effect.count, deck.length);
      if (lookCount === 0) return state;

      const topCards = deck.slice(0, lookCount);

      switch (effect.action) {
        case "one_to_hand_rest_bottom": {
          // Find first matching card (or first card if no filter)
          let chosenIdx = 0;
          if (effect.filter) {
            chosenIdx = topCards.findIndex((id) => {
              const inst = state.cards[id];
              if (!inst) return false;
              const def = definitions[inst.definitionId];
              if (!def) return false;
              return matchesFilter(inst, def, effect.filter!, state, controllingPlayerId);
            });
          }
          if (chosenIdx === -1) {
            // No match — put all on bottom (may pattern = don't take any)
            for (const id of topCards) {
              state = moveCard(state, id, targetPlayer, "deck", "bottom" as unknown as number);
            }
            // moveCard with "bottom" isn't quite right for reordering within same zone
            // Let's just rearrange the deck manually
            state = reorderDeckTopToBottom(state, targetPlayer, topCards, []);
            return state;
          }
          const chosenId = topCards[chosenIdx]!;
          const rest = topCards.filter((_, i) => i !== chosenIdx);
          // Move chosen to hand, rest to bottom
          state = moveCard(state, chosenId, targetPlayer, "hand");
          state = reorderDeckTopToBottom(state, targetPlayer, rest, []);
          return state;
        }
        case "top_or_bottom": {
          // Bot heuristic: keep on top (simple strategy)
          // No actual change needed — card stays where it is
          return state;
        }
        case "reorder": {
          // Bot keeps default order — no change
          return state;
        }
        default:
          return state;
      }
    }

    case "discard_from_hand": {
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId) : controllingPlayerId;
      const hand = getZone(state, targetPlayer, "hand");
      const discardCount = Math.min(effect.amount, hand.length);
      if (discardCount === 0) return state;

      // Create pending choice for the choosing player
      const choosingPlayer = effect.chooser === "target_player" ? targetPlayer : controllingPlayerId;
      return {
        ...state,
        pendingChoice: {
          type: "choose_discard",
          choosingPlayerId: choosingPlayer,
          prompt: `Choose ${discardCount} card(s) to discard.`,
          validTargets: hand,
          count: discardCount,
          pendingEffect: effect,
        },
      };
    }

    case "discard_hand": {
      // Discard entire hand for target player(s) — no choice involved
      const players: PlayerID[] = [];
      if (effect.target.type === "self") players.push(controllingPlayerId);
      else if (effect.target.type === "opponent") players.push(getOpponent(controllingPlayerId));
      else if (effect.target.type === "both") players.push("player1", "player2");

      for (const pid of players) {
        const hand = [...getZone(state, pid, "hand")];
        for (const cardId of hand) {
          state = moveCard(state, cardId, pid, "discard");
        }
      }
      return state;
    }

    case "move_to_inkwell": {
      const fromZone = effect.fromZone ?? "play";

      if (fromZone === "deck") {
        // Top of deck → inkwell (one-jump-ahead, mickey-mouse-detective)
        const deck = getZone(state, controllingPlayerId, "deck");
        if (deck.length === 0) return state;
        const topCardId = deck[0]!;
        state = zoneTransition(state, topCardId, "inkwell", definitions, events, { reason: "inked" });
        if (effect.enterExerted) {
          state = updateInstance(state, topCardId, { isExerted: true });
        } else {
          state = addInkFromEffect(state, controllingPlayerId);
        }
        return state;
      }

      if (effect.target.type === "this") {
        // Self → inkwell (gramma-tala)
        state = zoneTransition(state, sourceInstanceId, "inkwell", definitions, events, { reason: "inked" });
        if (effect.enterExerted) {
          state = updateInstance(state, sourceInstanceId, { isExerted: true });
        } else {
          state = addInkFromEffect(state, controllingPlayerId);
        }
        return state;
      }

      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card to put into inkwell.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      return state;
    }

    case "conditional_on_target": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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

    case "play_for_free": {
      // Choose a card from hand matching filter, play it without paying ink
      const hand = getZone(state, controllingPlayerId, "hand");
      const validCards = hand.filter((id) => {
        const inst = state.cards[id];
        if (!inst) return false;
        const def = definitions[inst.definitionId];
        if (!def) return false;
        return matchesFilter(inst, def, effect.filter, state, controllingPlayerId);
      });
      if (validCards.length === 0) return state;
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose a card to play for free.",
          validTargets: validCards,
          pendingEffect: effect,
          optional: effect.isMay ?? false,
        },
      };
    }

    // CRD 6.1.5: Pay ink as an effect (used as cost in sequential effects)
    case "pay_ink": {
      const player = state.players[controllingPlayerId];
      if (player.availableInk < effect.amount) return state; // CRD 6.1.5.1: can't pay → skip
      return updatePlayerInk(state, controllingPlayerId, -effect.amount);
    }

    // CRD 6.1.5.1: "[A] to [B]" sequential effect
    case "sequential": {
      // Check if all cost effects can be performed
      for (const costEffect of effect.costEffects) {
        if (!canPerformCostEffect(state, costEffect, controllingPlayerId, triggeringCardInstanceId)) {
          return state; // CRD 6.1.5.1: can't perform [A] → entire effect skipped
        }
      }
      // Apply cost effects [A]
      for (const costEffect of effect.costEffects) {
        state = applyEffect(state, costEffect, sourceInstanceId, controllingPlayerId, definitions, events);
      }
      // Apply reward effects [B]
      for (const rewardEffect of effect.rewardEffects) {
        state = applyEffect(state, rewardEffect, sourceInstanceId, controllingPlayerId, definitions, events);
      }
      return state;
    }

    case "shuffle_into_deck": {
      if (effect.target.type === "chosen") {
        // "any discard" = all discard piles
        const filter = effect.target.filter;
        const validTargets = findValidTargets(state, filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card to shuffle into its owner's deck.",
            validTargets,
            pendingEffect: effect,
            optional: effect.isMay ?? false,
          },
        };
      }
      return state;
    }

    // Frying Pan: "Chosen character can't challenge during their next turn"
    case "cant_challenge": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character that can't challenge.",
            validTargets,
            pendingEffect: effect,
          },
        };
      }
      return state;
    }

    // "You pay N less for the next X you play this turn"
    case "cost_reduction": {
      const existing = state.players[controllingPlayerId].costReductions ?? [];
      return {
        ...state,
        players: {
          ...state.players,
          [controllingPlayerId]: {
            ...state.players[controllingPlayerId],
            costReductions: [...existing, { amount: effect.amount, filter: effect.filter }],
          },
        },
      };
    }

    // "Each opponent loses N lore"
    case "lose_lore": {
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      const loreBefore = state.players[targetPlayer].lore;
      state = gainLore(state, targetPlayer, -effect.amount, events);
      const loreAfter = state.players[targetPlayer].lore;
      const actualLost = loreBefore - loreAfter;
      // CRD 6.1.5.1: Store result for "[A]. For each lore lost, [B]" patterns
      state = { ...state, lastEffectResult: actualLost };
      return state;
    }

    // CRD 6.2.7.1: Create a floating triggered ability for rest of turn
    case "create_floating_trigger": {
      const existing = state.floatingTriggers ?? [];
      return {
        ...state,
        floatingTriggers: [...existing, {
          trigger: effect.trigger,
          effects: effect.effects,
          controllingPlayerId,
        }],
      };
    }

    default:
      return state; // Unimplemented effect type — no-op for now
  }
}

/** CRD 6.1.5.1: Check if a cost effect can be performed before committing to it. */
function canPerformCostEffect(
  state: GameState,
  effect: Effect,
  controllingPlayerId: PlayerID,
  triggeringCardInstanceId?: string
): boolean {
  switch (effect.type) {
    case "pay_ink":
      return state.players[controllingPlayerId].availableInk >= effect.amount;
    case "discard_from_hand":
      return getZone(state, controllingPlayerId, "hand").length >= effect.amount;
    case "exert": {
      // CRD 6.1.5.1: exert cost on triggering_card — check not already exerted
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const inst = state.cards[triggeringCardInstanceId];
        return inst ? !inst.isExerted : false;
      }
      return true;
    }
    default:
      return true; // assume performable
  }
}

/** When an effect adds a card to inkwell mid-turn, increment availableInk */
function addInkFromEffect(state: GameState, playerId: PlayerID): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        availableInk: state.players[playerId].availableInk + 1,
      },
    },
  };
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

  // Queue self-triggers (the source card's own triggered abilities)
  const selfTriggers = def.abilities
    .filter(
      (a): a is TriggeredAbility =>
        a.type === "triggered" && a.trigger.on === eventType
    )
    .map((ability) => ({
      ability,
      sourceInstanceId,
      context,
    }));

  if (selfTriggers.length > 0) {
    state = { ...state, triggerStack: [...state.triggerStack, ...selfTriggers] };
  }

  // Queue cross-card triggers: scan ALL other in-play cards for triggers
  // that watch for this event type with a filter matching the source card
  for (const [watcherId, watcher] of Object.entries(state.cards)) {
    if (watcherId === sourceInstanceId) continue; // Skip self (already checked)
    if (watcher.zone !== "play") continue;
    const watcherDef = definitions[watcher.definitionId];
    if (!watcherDef) continue;

    for (const ability of watcherDef.abilities) {
      if (ability.type !== "triggered") continue;
      if (ability.trigger.on !== eventType) continue;
      // Cross-card triggers MUST have a filter to match against the source card
      const triggerFilter = "filter" in ability.trigger ? ability.trigger.filter : undefined;
      if (!triggerFilter) continue;
      // Check if the source card matches the trigger's filter
      if (!matchesFilter(instance, def, triggerFilter, state, watcher.ownerId)) continue;

      state = {
        ...state,
        triggerStack: [
          ...state.triggerStack,
          {
            ability,
            sourceInstanceId: watcherId,
            context: { ...context, triggeringCardInstanceId: sourceInstanceId },
          },
        ],
      };
    }
  }

  return state;
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
    // CRD 6.2.3 / 1.6.1: triggers fire from bag even after card leaves play
    const requiresInPlay = !["is_banished", "leaves_play", "banished_in_challenge", "is_challenged", "challenges"].includes(trigger.ability.trigger.on);
    if (requiresInPlay && source.zone !== "play") continue;

    // CRD 6.2.1: Check condition before resolving trigger effects
    if (trigger.ability.condition) {
      const conditionMet = evaluateCondition(
        trigger.ability.condition,
        state,
        definitions,
        source.ownerId,
        trigger.sourceInstanceId
      );
      if (!conditionMet) continue;
    }

    events.push({ type: "ability_triggered", instanceId: trigger.sourceInstanceId, abilityType: "triggered" });

    for (const effect of trigger.ability.effects) {
      // CRD 6.1.5.1: Sequential effects with isMay — skip prompt if cost can't be paid
      if (effect.type === "sequential" && effect.isMay) {
        const canAfford = effect.costEffects.every(
          (ce) => canPerformCostEffect(state, ce, source.ownerId, trigger.context.triggeringCardInstanceId)
        );
        if (!canAfford) continue; // Can't pay [A] → skip entirely, no prompt
      }

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
        events,
        trigger.context.triggeringCardInstanceId
      );

      // If the effect created a pending choice, queue remaining effects and pause
      if (state.pendingChoice) {
        const remainingEffects = trigger.ability.effects.slice(
          trigger.ability.effects.indexOf(effect) + 1
        );
        if (remainingEffects.length > 0) {
          state = {
            ...state,
            pendingEffectQueue: {
              effects: remainingEffects,
              sourceInstanceId: trigger.sourceInstanceId,
              controllingPlayerId: source.ownerId,
            },
          };
        }
        break;
      }
    }
  }
  return state;
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/** Resume processing remaining effects after a pending choice resolves */
function resumePendingEffectQueue(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  if (!state.pendingEffectQueue || state.pendingChoice) return state;

  const { effects, sourceInstanceId, controllingPlayerId } = state.pendingEffectQueue;
  state = { ...state, pendingEffectQueue: undefined };

  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    state = applyEffect(state, effect, sourceInstanceId, controllingPlayerId, definitions, events);
    if (state.pendingChoice) {
      const remaining = effects.slice(i + 1);
      if (remaining.length > 0) {
        state = { ...state, pendingEffectQueue: { effects: remaining, sourceInstanceId, controllingPlayerId } };
      }
      return state;
    }
  }
  return state;
}

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

// -----------------------------------------------------------------------------
// ZONE TRANSITIONS — unified card movement with automatic trigger firing
// Every card move in the game should go through here (except initial setup).
// moveCard (in utils) stays pure; this layer adds trigger awareness.
// -----------------------------------------------------------------------------

interface TransitionContext {
  /** Why is this card moving? */
  reason?: "played" | "banished" | "returned" | "inked" | "drawn" | "discarded" | "effect" | undefined;
  /** Was this banishment caused by a challenge? */
  fromChallenge?: boolean | undefined;
  /** The other character in a challenge (attacker if this is defender, vice versa) */
  challengeOpponentId?: string | undefined;
  /** The player who caused this transition */
  triggeringPlayerId?: PlayerID | undefined;
  /** Suppress triggers (e.g. action cleanup, shift base removal) */
  silent?: boolean | undefined;
}

function zoneTransition(
  state: GameState,
  instanceId: string,
  targetZone: ZoneName,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  ctx: TransitionContext = {}
): GameState {
  const instance = getInstance(state, instanceId);
  const fromZone = instance.zone;
  const def = definitions[instance.definitionId];

  const triggerCtx: { triggeringPlayerId?: PlayerID; triggeringCardInstanceId?: string } =
    ctx.triggeringPlayerId ? { triggeringPlayerId: ctx.triggeringPlayerId } : {};

  // Fire pre-move triggers (while card is still in source zone)
  if (!ctx.silent) {
    // Leaving play
    if (fromZone === "play" && targetZone !== "play") {
      state = queueTrigger(state, "leaves_play", instanceId, definitions, triggerCtx);

      if (ctx.reason === "banished") {
        state = queueTrigger(state, "is_banished", instanceId, definitions, {});

        if (ctx.fromChallenge && ctx.challengeOpponentId) {
          state = queueTrigger(state, "banished_in_challenge", instanceId, definitions, {
            triggeringCardInstanceId: ctx.challengeOpponentId,
          });
          // Fire on the surviving opponent: "this character banished another in a challenge"
          const opponent = state.cards[ctx.challengeOpponentId];
          if (opponent && opponent.zone === "play") {
            state = queueTrigger(state, "banished_other_in_challenge", ctx.challengeOpponentId, definitions, {
              triggeringCardInstanceId: instanceId,
            });
          }
        }
      }
    }
  }

  // The actual move (pure, no side effects)
  state = moveCard(state, instanceId, instance.ownerId, targetZone);

  // Fire post-move triggers + events
  if (!ctx.silent) {
    // Entering play
    if (targetZone === "play" && fromZone !== "play") {
      state = queueTrigger(state, "enters_play", instanceId, definitions, triggerCtx);
      state = queueTrigger(state, "card_played", instanceId, definitions, triggerCtx);
      if (def?.cardType === "item") {
        state = queueTrigger(state, "item_played", instanceId, definitions, triggerCtx);
      }
    }

    // Banish events/logging
    if (ctx.reason === "banished") {
      events.push({ type: "card_banished", instanceId });
      if (def) {
        state = appendLog(state, {
          turn: state.turnNumber,
          playerId: instance.ownerId,
          message: `${def.fullName} was banished.`,
          type: "card_banished",
        });
      }
    }

    // Draw events
    if (ctx.reason === "drawn") {
      events.push({ type: "card_drawn", playerId: instance.ownerId, instanceId });
    }

    // Generic move event
    if (fromZone !== targetZone) {
      events.push({ type: "card_moved", instanceId, from: fromZone, to: targetZone });
    }
  }

  return state;
}

// CRD 1.8.1.4: convenience wrapper for banishing
function banishCard(
  state: GameState,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  challengeCtx?: { challengeOpponentId: string }
): GameState {
  return zoneTransition(state, instanceId, "discard", definitions, events, {
    reason: "banished",
    fromChallenge: !!challengeCtx,
    challengeOpponentId: challengeCtx?.challengeOpponentId,
  });
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
    case "return_to_hand":
      return zoneTransition(state, targetInstanceId, "hand", definitions, events, { reason: "returned" });
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
      const actualHeal = Math.min(effect.amount, instance.damage);
      state = updateInstance(state, targetInstanceId, {
        damage: instance.damage - actualHeal,
      });
      // CRD 6.1.5.1: Store result for "[A]. For each damage removed, [B]" patterns
      state = { ...state, lastEffectResult: actualHeal };
      return state;
    }
    case "exert":
      return updateInstance(state, targetInstanceId, { isExerted: true });
    case "grant_keyword": {
      const timedEffect: TimedEffect = {
        type: "grant_keyword",
        keyword: effect.keyword,
        value: effect.value,
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "ready":
      return updateInstance(state, targetInstanceId, { isExerted: false });
    case "cant_quest": {
      const timedEffect: TimedEffect = {
        type: "cant_quest",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "cant_ready": {
      const timedEffect: TimedEffect = {
        type: "cant_ready",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "move_to_inkwell": {
      const inst = getInstance(state, targetInstanceId);
      state = zoneTransition(state, targetInstanceId, "inkwell", definitions, events, { reason: "inked" });
      if (effect.enterExerted) {
        state = updateInstance(state, targetInstanceId, { isExerted: true });
      } else {
        state = addInkFromEffect(state, inst.ownerId);
      }
      return state;
    }
    case "conditional_on_target": {
      // Check if target matches the condition filter
      const inst = getInstance(state, targetInstanceId);
      const def = definitions[inst.definitionId];
      const matches = def ? matchesFilter(inst, def, effect.conditionFilter, state, controllingPlayerId) : false;
      const effects = matches ? effect.ifMatchEffects : effect.defaultEffects;
      for (const e of effects) {
        state = applyEffectToTarget(state, e, targetInstanceId, controllingPlayerId, definitions, events);
      }
      return state;
    }
    case "play_for_free": {
      // Play the chosen card from hand without paying ink
      const inst = getInstance(state, targetInstanceId);
      if (inst.zone !== "hand") return state;
      const def = definitions[inst.definitionId];
      if (!def) return state;
      // Move to play via zoneTransition (fires enters_play, card_played triggers)
      state = zoneTransition(state, targetInstanceId, "play", definitions, events, {
        reason: "played", triggeringPlayerId: controllingPlayerId,
      });
      // Characters enter drying
      if (def.cardType === "character") {
        state = updateInstance(state, targetInstanceId, { isDrying: true });
      }
      state = appendLog(state, {
        turn: state.turnNumber,
        playerId: controllingPlayerId,
        message: `${controllingPlayerId} played ${def.fullName} for free.`,
        type: "card_played",
      });
      return state;
    }
    case "shuffle_into_deck": {
      const inst = getInstance(state, targetInstanceId);
      // Move to deck
      state = zoneTransition(state, targetInstanceId, "deck", definitions, events, { reason: "effect" });
      // Shuffle the owner's deck
      state = shuffleDeck(state, inst.ownerId);
      return state;
    }
    case "cant_challenge": {
      const timedEffect: TimedEffect = {
        type: "cant_challenge",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    default:
      return state;
  }
}

/**
 * Rearrange deck: remove topCards from top of deck, put restCards on bottom.
 * Used by look_at_top effects.
 */
function reorderDeckTopToBottom(
  state: GameState,
  playerId: PlayerID,
  cardsToBottom: string[],
  _cardsToTop: string[]
): GameState {
  const deck = getZone(state, playerId, "deck");
  const remaining = deck.filter((id) => !cardsToBottom.includes(id));
  const newDeck = [...remaining, ...cardsToBottom];
  return {
    ...state,
    zones: {
      ...state.zones,
      [playerId]: { ...state.zones[playerId], deck: newDeck },
    },
  };
}

/** Fisher-Yates shuffle a player's deck */
function shuffleDeck(state: GameState, playerId: PlayerID): GameState {
  const deck = [...getZone(state, playerId, "deck")];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return {
    ...state,
    zones: { ...state.zones, [playerId]: { ...state.zones[playerId], deck } },
  };
}

/** Add a timed effect to a card instance */
function addTimedEffect(state: GameState, instanceId: string, effect: TimedEffect): GameState {
  const instance = getInstance(state, instanceId);
  return updateInstance(state, instanceId, {
    timedEffects: [...instance.timedEffects, effect],
  });
}

function payCosts(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  costs: Cost[],
  events: GameEvent[],
  definitions: Record<string, CardDefinition> = {}
): GameState {
  for (const cost of costs) {
    if (cost.type === "exert") {
      state = updateInstance(state, instanceId, { isExerted: true });
    }
    if (cost.type === "pay_ink") {
      state = updatePlayerInk(state, playerId, -cost.amount);
    }
    if (cost.type === "banish_self") {
      state = banishCard(state, instanceId, definitions, events);
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
  definitions: Record<string, CardDefinition>,
  sourceInstanceId?: string
): string[] {
  return Object.values(state.cards)
    .filter((instance) => {
      // CRD 6.1.6: "other" — exclude the source card
      if (filter.excludeSelf && sourceInstanceId && instance.instanceId === sourceInstanceId) return false;
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
