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
} from "../types/index.js";
import { validateAction } from "./validator.js";
import {
  appendLog,
  generateId,
  getDefinition,
  getEffectiveLore,
  getEffectiveStrength,
  getEffectiveWillpower,
  getInstance,
  getOpponent,
  getZone,
  hasKeyword,
  moveCard,
  updateInstance,
} from "../utils/index.js";

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
    return { success: false, newState: state, error: validation.reason, events: [] };
  }

  const events: GameEvent[] = [];

  try {
    let newState = applyActionInner(state, action, definitions, events);
    // After applying the action, check and resolve triggers
    newState = processTriggerStack(newState, definitions, events);
    // Check win condition
    newState = checkWinCondition(newState, events);

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
      return applyPlayCard(state, action.playerId, action.instanceId, definitions, events, action.shiftTargetInstanceId);
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
  shiftTargetInstanceId?: string
): GameState {
  const def = getDefinition(state, instanceId, definitions);
  const cost = shiftTargetInstanceId ? (def.shiftCost ?? def.cost) : def.cost;

  // Deduct ink
  state = updatePlayerInk(state, playerId, -cost);

  if (shiftTargetInstanceId) {
    // Shift: move the new card onto the shift target
    // The shifted-onto card is removed from play, new card inherits its damage and exerted state
    const shiftTarget = getInstance(state, shiftTargetInstanceId);
    state = moveCard(state, instanceId, playerId, "play");
    state = updateInstance(state, instanceId, {
      isExerted: shiftTarget.isExerted,
      damage: shiftTarget.damage,
      hasActedThisTurn: true, // Shifted characters can't act immediately (no Rush by default)
      shiftedOntoInstanceId: shiftTargetInstanceId,
    });
    // Remove the shifted-onto card
    state = moveCard(state, shiftTargetInstanceId, playerId, "discard");
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} shifted ${def.fullName} onto ${definitions[shiftTarget.definitionId]?.fullName}.`,
      type: "card_played",
    });
  } else {
    // Normal play
    state = moveCard(state, instanceId, playerId, "play");
    const hasRush = def.abilities.some((a) => a.type === "keyword" && a.keyword === "rush");
    state = updateInstance(state, instanceId, {
      hasActedThisTurn: !hasRush, // Rush allows acting immediately
    });
    events.push({ type: "card_moved", instanceId, from: "hand", to: "play" });
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName}.`,
      type: "card_played",
    });
  }

  // Queue "enters play" triggers
  state = queueTrigger(state, "enters_play", instanceId, definitions, { triggeringPlayerId: playerId });

  return state;
}

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

  // Exert the character
  state = updateInstance(state, instanceId, { isExerted: true, hasActedThisTurn: true });

  // Gain lore
  state = gainLore(state, playerId, loreGained, events);

  events.push({ type: "lore_gained", playerId, amount: loreGained });
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId}'s ${def.fullName} quested for ${loreGained} lore.`,
    type: "card_quested",
  });

  // Queue "quests" trigger
  state = queueTrigger(state, "quests", instanceId, definitions, { triggeringPlayerId: playerId });

  return state;
}

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
  let defenderStr = getEffectiveStrength(defender, defenderDef);

  // Challenger bonus
  const challengerBonus = attackerDef.abilities.find(
    (a) => a.type === "keyword" && a.keyword === "challenger"
  );
  if (challengerBonus?.type === "keyword") {
    attackerStr += challengerBonus.value ?? 0;
  }

  // Exert the attacker
  state = updateInstance(state, attackerInstanceId, { isExerted: true, hasActedThisTurn: true });

  // Deal damage
  const newAttackerDamage = attacker.damage + defenderStr;
  const newDefenderDamage = defender.damage + attackerStr;

  state = updateInstance(state, attackerInstanceId, { damage: newAttackerDamage });
  state = updateInstance(state, defenderInstanceId, { damage: newDefenderDamage });

  events.push({ type: "damage_dealt", instanceId: attackerInstanceId, amount: defenderStr });
  events.push({ type: "damage_dealt", instanceId: defenderInstanceId, amount: attackerStr });

  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId}'s ${attackerDef.fullName} (${attackerStr}) challenged ${defenderDef.fullName} (${defenderStr}).`,
    type: "card_challenged",
  });

  // Queue challenge triggers
  state = queueTrigger(state, "challenges", attackerInstanceId, definitions, {
    triggeringCardInstanceId: defenderInstanceId,
  });
  state = queueTrigger(state, "is_challenged", defenderInstanceId, definitions, {
    triggeringCardInstanceId: attackerInstanceId,
  });

  // Check banishment (damage >= willpower)
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

  // Pay costs
  state = payCosts(state, playerId, instanceId, ability.costs, events);

  // Apply effects
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

  // End of turn: clear temp modifiers, reset hasActedThisTurn is done at start of NEXT turn
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} passed the turn.`,
    type: "turn_end",
  });

  // Fire end-of-turn triggers
  state = queueTriggersByEvent(state, "turn_end", playerId, definitions, {});
  state = processTriggerStack(state, definitions, events);

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

  // Ready all of opponent's exerted cards
  const opponentPlay = getZone(state, opponent, "play");
  for (const id of opponentPlay) {
    state = updateInstance(state, id, { isExerted: false, hasActedThisTurn: false });
  }

  // Clear temp modifiers on ALL cards (end of turn)
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

  // Draw a card for the opponent (beginning phase)
  state = applyDraw(state, opponent, 1, events);

  state = {
    ...state,
    phase: "main",
  };

  events.push({ type: "turn_passed", to: opponent });

  state = appendLog(state, {
    turn: newTurnNumber,
    playerId: opponent,
    message: `${opponent}'s turn begins.`,
    type: "turn_start",
  });

  return state;
}

function applyDraw(
  state: GameState,
  playerId: PlayerID,
  amount: number,
  events: GameEvent[]
): GameState {
  for (let i = 0; i < amount; i++) {
    const deck = getZone(state, playerId, "deck");
    if (deck.length === 0) break; // No cards to draw (could trigger loss condition)
    const topCardId = deck[0];
    if (!topCardId) break;
    state = moveCard(state, topCardId, playerId, "hand");
    events.push({ type: "card_drawn", playerId, instanceId: topCardId });
    state = queueTriggersByEvent(state, "card_drawn", playerId, state as GameState, {});
  }
  return state;
}

function applyResolveChoice(
  state: GameState,
  playerId: PlayerID,
  choice: string[] | number,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  if (!state.pendingChoice) return state;

  const { pendingEffect, pendingChoice } = state;
  state = { ...state, pendingChoice: null };

  if (pendingChoice.type === "choose_target" && Array.isArray(choice)) {
    // Resolve the pending effect with the chosen target
    // This is simplified — a full implementation would thread context through
    for (const targetId of choice) {
      state = applyEffectToTarget(state, pendingEffect, targetId, playerId, definitions, events);
    }
  }

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
      const amount = effect.amount === "X" ? 1 : effect.amount; // X resolution TBD
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
        // Need a choice — set pending choice
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId);
        state = {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a target to deal damage to.",
            validTargets,
            pendingEffect: effect,
          },
        };
        return state;
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId);
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
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId);
        state = {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a target to banish.",
            validTargets,
            pendingEffect: effect,
          },
        };
        return state;
      }
      if (effect.target.type === "this") {
        return banishCard(state, sourceInstanceId, definitions, events);
      }
      return state;
    }

    case "return_to_hand": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId);
        state = {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card to return to hand.",
            validTargets,
            pendingEffect: effect,
          },
        };
        return state;
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
  definitions: Record<string, CardDefinition> | GameState,
  context: object
): GameState {
  // Skip if definitions is not a proper record (overloaded from applyDraw)
  if ((definitions as GameState).cards !== undefined) return state;
  const defs = definitions as Record<string, CardDefinition>;

  // Check ALL cards in play for matching triggers
  for (const [instanceId, instance] of Object.entries(state.cards)) {
    if (instance.zone !== "play") continue;
    const def = defs[instance.definitionId];
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
  // Process triggers until stack is empty (or we hit a pending choice)
  let safety = 0;
  while (state.triggerStack.length > 0 && !state.pendingChoice) {
    if (++safety > 100) throw new Error("Trigger loop detected");

    const [trigger, ...rest] = state.triggerStack;
    if (!trigger) break;
    state = { ...state, triggerStack: rest };

    const source = state.cards[trigger.sourceInstanceId];
    if (!source) continue;

    // Allow banishment triggers to fire even after card leaves play
    const requiresInPlay = trigger.ability.trigger.on !== "is_banished" && trigger.ability.trigger.on !== "leaves_play";
    if (requiresInPlay && source.zone !== "play") continue;

    events.push({ type: "ability_triggered", instanceId: trigger.sourceInstanceId, abilityType: "triggered" });

    for (const effect of trigger.ability.effects) {
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

function gainLore(
  state: GameState,
  playerId: PlayerID,
  amount: number,
  events: GameEvent[]
): GameState {
  const newLore = state.players[playerId].lore + amount;
  events.push({ type: "lore_gained", playerId, amount });
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], lore: newLore },
    },
  };
}

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
  events: GameEvent[]
): GameState {
  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];
  if (!def) return state;

  // Resist reduces damage
  const resistBonus = instance.grantedKeywords.includes("resist")
    ? 1
    : def.abilities.find((a) => a.type === "keyword" && a.keyword === "resist")
    ? (def.abilities.find((a) => a.type === "keyword" && a.keyword === "resist") as { value?: number })?.value ?? 0
    : 0;
  const actualDamage = Math.max(0, amount - resistBonus);

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
  // Resolve a deferred effect with a specific target
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
  controllingPlayerId: PlayerID
): string[] {
  // Simplified target finder
  return Object.values(state.cards)
    .filter((instance) => {
      if (filter.zone) {
        const zones = Array.isArray(filter.zone) ? filter.zone : [filter.zone];
        if (!zones.includes(instance.zone)) return false;
      }
      if (filter.owner?.type === "opponent" && instance.ownerId === controllingPlayerId) return false;
      if (filter.owner?.type === "self" && instance.ownerId !== controllingPlayerId) return false;
      return true;
    })
    .map((i) => i.instanceId);
}

function checkWinCondition(state: GameState, _events: GameEvent[]): GameState {
  for (const [playerId, playerState] of Object.entries(state.players)) {
    if (playerState.lore >= 20) {
      return {
        ...state,
        winner: playerId as PlayerID,
        isGameOver: true,
      };
    }
  }
  return state;
}
