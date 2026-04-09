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
  CardTarget,
  ResolvedRef,
} from "../types/index.js";
import { getGameModifiers, type GameModifiers } from "./gameModifiers.js";
import { validateAction, applyMoveCostReduction, getEffectiveCostWithReductions } from "./validator.js";
import {
  appendLog,
  canSingSong,
  evaluateCondition,
  findMatchingInstances,
  getDefinition,
  getEffectiveLore,
  getEffectiveStrength,
  getEffectiveWillpower,
  getInstance,
  getKeywordValue,
  getOpponent,
  getZone,
  hasKeyword,
  isActionRestricted,
  isSong,
  makeResolvedRef,
  matchesFilter,
  moveCard,
  updateInstance,
} from "../utils/index.js";
import { rngNextInt } from "../utils/seededRng.js";

// Maximum trigger chain depth before treating as an infinite loop (CRD 6.2.x)
const MAX_TRIGGER_CHAIN = 100;

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
    console.error("[engine] applyAction threw:", err);
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
 * CRD 1.8.1.1: Default lore threshold is 20. Per-player override possible via
 * `modify_win_threshold` static effects (Donald Duck - Flustered Sorcerer:
 * "OBFUSCATE! Opponents need 25 lore to win the game"). Pass `playerId` to get
 * THAT player's threshold; the modifier is keyed per-player so opposing-player
 * effects don't change the source player's own threshold.
 */
export function getLoreThreshold(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  playerId: PlayerID
): number {
  const modifiers = getGameModifiers(state, definitions);
  return modifiers.loreThresholds.get(playerId) ?? 20;
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

  for (const [playerId, playerState] of Object.entries(state.players)) {
    const threshold = getLoreThreshold(state, definitions, playerId as PlayerID);
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

  // PASS_TURN — legal unless a Reckless character must challenge first (CRD 8.7.3)
  if (validateAction(state, { type: "PASS_TURN", playerId }, definitions).valid) {
    actions.push({ type: "PASS_TURN", playerId });
  }

  const hand = getZone(state, playerId, "hand");
  const myPlay = getZone(state, playerId, "play");
  const opponentPlay = getZone(state, opponentId, "play");

  // PLAY_INK — one per turn, any inkable card in hand (or discard if Moana
  // Curious Explorer is in play).
  for (const instanceId of hand) {
    const action: GameAction = { type: "PLAY_INK", playerId, instanceId };
    if (validateAction(state, action, definitions).valid) {
      actions.push(action);
    }
  }
  const inkMods = getGameModifiers(state, definitions);
  if (inkMods.inkFromDiscard.has(playerId)) {
    for (const instanceId of getZone(state, playerId, "discard")) {
      const action: GameAction = { type: "PLAY_INK", playerId, instanceId };
      if (validateAction(state, action, definitions).valid) {
        actions.push(action);
      }
    }
  }

  // PLAY_CARD — normal play and shift (checked independently)
  const playMods = getGameModifiers(state, definitions);
  for (const instanceId of hand) {
    const normalPlay: GameAction = { type: "PLAY_CARD", playerId, instanceId };
    if (validateAction(state, normalPlay, definitions).valid) {
      actions.push(normalPlay);
    }

    // Pudge - Controls the Weather: granted free-play option. The legal-action
    // enumerator surfaces this variant alongside the normal-cost play so the
    // player can pick either (CRD 6.4.4 / "may"/"can" wording — the granted
    // ability is OPT-IN, not a forced cost reduction).
    if (playMods.playForFreeSelf.has(instanceId)) {
      const freePlay: GameAction = { type: "PLAY_CARD", playerId, instanceId, viaGrantedFreePlay: true };
      if (validateAction(state, freePlay, definitions).valid) {
        actions.push(freePlay);
      }
    }

    // Shift: check independent of normal play affordability. The shift cost
    // can come from def.shiftCost (printed) or mods.grantedShiftSelf
    // (Anna - Soothing Sister "this card gains Shift 0").
    const cardInst = state.cards[instanceId];
    const cardDef = cardInst ? definitions[cardInst.definitionId] : undefined;
    const hasShift = cardDef?.shiftCost !== undefined || playMods.grantedShiftSelf.has(instanceId);
    if (hasShift) {
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

    // Belle Apprentice Inventor: alternative play cost (banish item).
    // Enumerate one PLAY_CARD action per banishable item that satisfies the
    // card's altPlayCost filter.
    if (cardDef?.altPlayCost?.type === "banish_item") {
      for (const itemId of myPlay) {
        const itemInst = state.cards[itemId];
        const itemDef = itemInst ? definitions[itemInst.definitionId] : undefined;
        if (!itemInst || !itemDef) continue;
        if (!matchesFilter(itemInst, itemDef, cardDef.altPlayCost.filter, state, playerId)) continue;
        const altPlay: GameAction = {
          type: "PLAY_CARD",
          playerId,
          instanceId,
          altCostBanishInstanceId: itemId,
        };
        if (validateAction(state, altPlay, definitions).valid) {
          actions.push(altPlay);
        }
      }
    }
  }

  // SING — each song in hand × each eligible singer in play (CRD 5.4.4.2)
  for (const songId of hand) {
    const songInst = state.cards[songId];
    const songDef = songInst ? definitions[songInst.definitionId] : undefined;
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

  // MOVE_CHARACTER — each ready character × each owned location with affordable move cost
  for (const characterInstanceId of myPlay) {
    for (const locationInstanceId of myPlay) {
      if (characterInstanceId === locationInstanceId) continue;
      const action: GameAction = {
        type: "MOVE_CHARACTER",
        playerId,
        characterInstanceId,
        locationInstanceId,
      };
      if (validateAction(state, action, definitions).valid) {
        actions.push(action);
      }
    }
  }

  // BOOST_CARD — each in-play card with the boost keyword that hasn't boosted this turn
  for (const instanceId of myPlay) {
    const action: GameAction = { type: "BOOST_CARD", playerId, instanceId };
    if (validateAction(state, action, definitions).valid) {
      actions.push(action);
    }
  }

  // ACTIVATE_ABILITY — each activatable ability on each card in play
  const modifiersForAbilities = getGameModifiers(state, definitions);
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
    // Also check granted activated abilities from static effects (Cogsworth)
    const grantedAbilities = modifiersForAbilities.grantedActivatedAbilities.get(instanceId);
    if (grantedAbilities) {
      for (let j = 0; j < grantedAbilities.length; j++) {
        const grantedIndex = def.abilities.length + j;
        const action: GameAction = { type: "ACTIVATE_ABILITY", playerId, instanceId, abilityIndex: grantedIndex };
        if (validateAction(state, action, definitions).valid) {
          actions.push(action);
        }
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
      return applyPlayCard(state, action.playerId, action.instanceId, definitions, events, action.shiftTargetInstanceId, action.singerInstanceId, action.singerInstanceIds, action.altCostBanishInstanceId, action.viaGrantedFreePlay);
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
      return applyDraw(state, action.playerId, action.amount ?? 1, events, definitions);
    case "MOVE_CHARACTER":
      return applyMoveCharacter(state, action.playerId, action.characterInstanceId, action.locationInstanceId, definitions, events);
    case "BOOST_CARD":
      return applyBoostCard(state, action.playerId, action.instanceId, definitions, events);
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
  singerInstanceId?: string,
  singerInstanceIds?: string[],
  altCostBanishInstanceId?: string,
  viaGrantedFreePlay?: boolean,
): GameState {
  const def = getDefinition(state, instanceId, definitions);

  // CRD 8.12: Sing Together — multiple characters all exert; sings trigger fires per singer
  if (singerInstanceIds && singerInstanceIds.length > 0) {
    state = { ...state, lastSongSingerCount: singerInstanceIds.length };
    for (const sId of singerInstanceIds) {
      state = exertInstance(state, sId, definitions);
    }
    const singerNames = singerInstanceIds
      .map(id => getDefinition(state, id, definitions).fullName)
      .join(", ");
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName} (Sing Together: ${singerNames}).`,
      type: "card_played",
    });
    // Queue "sings" for each contributing singer (CRD 8.12 — each is singing the song).
    for (const sId of singerInstanceIds) {
      state = queueTrigger(state, "sings", sId, definitions, {
        triggeringPlayerId: playerId,
        triggeringCardInstanceId: instanceId,
      });
    }
  } else if (singerInstanceId) {
    // Don't deduct ink — singing is the alternate cost (CRD 1.5.5.1)
    state = { ...state, lastSongSingerCount: 1 };
    state = exertInstance(state, singerInstanceId, definitions);
    const singerDef = getDefinition(state, singerInstanceId, definitions);
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName} (sung by ${singerDef.fullName}).`,
      type: "card_played",
    });
    // Queue "sings" trigger on the singer (e.g. Ursula - Deceiver of All).
    // The triggering card is the song instance — Ursula's WHAT A DEAL uses
    // target: { type: "triggering_card" } to replay it from discard.
    // Processed by the wrapping applyAction → processTriggerStack call after the
    // song's actionEffects resolve and the song moves to discard (CRD 5.4.3 timing).
    state = queueTrigger(state, "sings", singerInstanceId, definitions, {
      triggeringPlayerId: playerId,
      triggeringCardInstanceId: instanceId,
    });
  } else if (altCostBanishInstanceId && def.altPlayCost?.type === "banish_item") {
    // Belle Apprentice Inventor: alt cost — banish chosen item, no ink paid.
    state = banishCard(state, altCostBanishInstanceId, definitions, events);
  } else if (viaGrantedFreePlay) {
    // Pudge - Controls the Weather: granted free-play. No ink paid, no cost
    // reductions consumed. The validator already verified the modifier is
    // active for this instance.
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName} for free.`,
      type: "card_played",
    });
  } else {
    // Static modifiers — also consulted for granted Shift cost (Anna).
    const modifiers = getGameModifiers(state, definitions);
    const grantedShift = modifiers.grantedShiftSelf.get(instanceId);
    const printedShift = def.shiftCost;
    const shiftBase = printedShift ?? grantedShift;
    const baseCost = shiftTargetInstanceId
      ? (shiftBase ?? def.cost)
      : def.cost;
    // Apply cost reductions
    const instance = getInstance(state, instanceId);
    let cost = baseCost;

    // Static cost reductions (e.g. Mickey: Broom chars cost 1 less)
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
      // Mirror validator's resolution: literal number, count-based, or
      // per-turn event count.
      const rawAmount = ability.effect.amount;
      let discount = 0;
      if (typeof rawAmount === "number") {
        discount = rawAmount;
      } else if (typeof rawAmount === "object" && rawAmount !== null && (rawAmount as { type?: string }).type === "count") {
        const countAmt = rawAmount as { type: "count"; filter: import("../types/index.js").CardFilter; max?: number };
        let n = findMatchingInstances(state, definitions, countAmt.filter, playerId, instanceId).length;
        if (typeof countAmt.max === "number") n = Math.min(n, countAmt.max);
        discount = n * (ability.effect.perMatch ?? 1);
      } else if (rawAmount === "opposing_chars_banished_in_challenge_this_turn") {
        const n = state.players[playerId].opposingCharsBanishedInChallengeThisTurn ?? 0;
        discount = n * (ability.effect.perMatch ?? 1);
      }
      cost -= discount;
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
    // CRD 8.10.4: when you shift, the previous version is placed UNDER the shifted character
    // (not in discard). The previous version inherits the new character's cardsUnder pile too —
    // a Floodborn shifted onto another Floodborn carries its under-stack with it.
    const inheritedUnder = shiftTarget.cardsUnder;
    // Shifted card enters play — fires enters_play, card_played
    state = zoneTransition(state, instanceId, "play", definitions, events, {
      reason: "played", triggeringPlayerId: playerId,
    });
    state = updateInstance(state, instanceId, {
      isExerted: shiftTarget.isExerted,
      damage: shiftTarget.damage, // CRD 8.10.6: shifted character retains damage from base
      isDrying: shiftTarget.isDrying, // CRD 8.10.4: inherit dry/drying from base card
      shiftedOntoInstanceId: shiftTargetInstanceId,
      playedViaShift: true,
      cardsUnder: [...inheritedUnder, shiftTargetInstanceId],
    });
    // CRD 8.10.4: queue the shifted_onto trigger BEFORE the original card is
    // moved into the "under" subzone, so cross-card scans (which only walk
    // in-play cards) can find the watcher. Source = the new shifter (filter
    // is matched against this card); triggeringCardInstanceId = the original
    // (still in play). Go Go Tomago Mechanical Engineer fires from this hook.
    state = queueTrigger(state, "shifted_onto", instanceId, definitions, {
      triggeringPlayerId: playerId,
      triggeringCardInstanceId: shiftTargetInstanceId,
    });
    // CRD 8.10.4: the base card moves from play to "under". Reset its play-state fields
    // (it's no longer the active version of the card) and inherit-empty cardsUnder
    // (its under-pile has already been moved onto the new top card above).
    state = {
      ...state,
      cards: {
        ...state.cards,
        [shiftTargetInstanceId]: {
          ...state.cards[shiftTargetInstanceId]!,
          zone: "under",
          damage: 0,
          isExerted: false,
          isDrying: false,
          tempStrengthModifier: 0,
          tempWillpowerModifier: 0,
          tempLoreModifier: 0,
          grantedKeywords: [],
          timedEffects: [],
          cardsUnder: [],
        },
      },
      zones: {
        ...state.zones,
        [playerId]: {
          ...state.zones[playerId],
          play: state.zones[playerId].play.filter(id => id !== shiftTargetInstanceId),
        },
      },
    };
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} shifted ${def.fullName} onto ${definitions[shiftTarget.definitionId]?.fullName}.`,
      type: "card_played",
    });
    // Track shifted-in characters for the Travelers "played another character
    // this turn" condition.
    {
      const existing = state.players[playerId].charactersPlayedThisTurn ?? [];
      state = {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...state.players[playerId], charactersPlayedThisTurn: [...existing, instanceId] },
        },
      };
    }
  } else if (def.cardType === "action") {
    // CRD 4.3.3.2: Action enters play zone, effect resolves, then moves to discard
    state = zoneTransition(state, instanceId, "play", definitions, events, {
      reason: "played", triggeringPlayerId: playerId,
    });

    // Track actions and songs played this turn
    const currentActions = state.players[playerId].actionsPlayedThisTurn ?? 0;
    const currentSongs = state.players[playerId].songsPlayedThisTurn ?? 0;
    const isSongCard = isSong(def);
    state = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...state.players[playerId],
          actionsPlayedThisTurn: currentActions + 1,
          ...(isSongCard ? { songsPlayedThisTurn: currentSongs + 1 } : {}),
        },
      },
    };

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
    // CRD 5.1.2.1: Characters enter play drying; items/locations do not (CRD 5.5.4, 6.3.1.2)
    if (def.cardType === "character") {
      state = updateInstance(state, instanceId, { isDrying: true });
    }
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName}.`,
      type: "card_played",
    });
    // Travelers cycle (P3): track characters played this turn for the
    // "played another character this turn" condition. Track shift plays too —
    // see the shift branch above which falls through to here only for non-
    // shift plays; record from there as well via a separate update below.
    if (def.cardType === "character") {
      const existing = state.players[playerId].charactersPlayedThisTurn ?? [];
      state = {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...state.players[playerId], charactersPlayedThisTurn: [...existing, instanceId] },
        },
      };
    }
  }

  // EnterPlayExertedStatic — Jiminy Cricket Level-Headed and Wise (opposing
  // chars with Rush enter exerted), Figaro Tuxedo Cat (opposing items enter
  // exerted). Force-exert here, before any enters_play triggers resolve.
  {
    const epeMods = getGameModifiers(state, definitions);
    const filters = epeMods.enterPlayExerted.get(playerId) ?? [];
    if (filters.length > 0) {
      const playedInst = getInstance(state, instanceId);
      const playedDefForce = getDefinition(state, instanceId, definitions);
      for (const f of filters) {
        // Drop owner field — already resolved when populating gameModifiers.
        const { owner: _omit, ...rest } = f;
        if (matchesFilter(playedInst, playedDefForce, rest, state, playerId)) {
          state = updateInstance(state, instanceId, { isExerted: true });
          break;
        }
      }
    }
  }

  // CRD 8.3.2: Bodyguard — may enter play exerted
  const playedInstance = getInstance(state, instanceId);
  const playedDef = getDefinition(state, instanceId, definitions);
  if (hasKeyword(playedInstance, playedDef, "bodyguard")) {
    const bodyguardTrigger: PendingTrigger = {
      ability: {
        type: "triggered",
        trigger: { on: "enters_play" },
        storyName: "Bodyguard",
        rulesText: "This character may enter play exerted to protect your other characters.",
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
  // Daisy Duck Paranormal Investigator: affected players' newly-inked cards
  // enter exerted and DO NOT increment availableInk.
  const inkMods = getGameModifiers(state, definitions);
  const entersExerted = inkMods.inkwellEntersExerted.has(playerId);
  state = zoneTransition(state, instanceId, "inkwell", definitions, events, {
    reason: "inked", triggeringPlayerId: playerId,
  });
  if (entersExerted) {
    state = updateInstance(state, instanceId, { isExerted: true });
  }
  const currentInkPlays = state.players[playerId].inkPlaysThisTurn ?? 0;
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        hasPlayedInkThisTurn: true,
        inkPlaysThisTurn: currentInkPlays + 1,
        availableInk: state.players[playerId].availableInk + (entersExerted ? 0 : 1),
      },
    },
  };
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} added ${def.fullName} to their inkwell.`,
    type: "ink_played",
  });
  // CRD 6.2: ink_played triggered abilities (Chicha Dedicated Mother). Queue
  // after the inkPlaysThisTurn counter has been bumped so condition checks see
  // the post-play count.
  state = queueTriggersByEvent(state, "ink_played", playerId, definitions, {});
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

  state = exertInstance(state, instanceId, definitions);
  // Track quest count for Isabela Madrigal Golden Child's condition.
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        charactersQuestedThisTurn: (state.players[playerId].charactersQuestedThisTurn ?? 0) + 1,
      },
    },
  };
  state = gainLore(state, playerId, loreGained, events, definitions);

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
        // attachedToInstanceId scopes the trigger to a single chosen instance
        if (ft.attachedToInstanceId && ft.attachedToInstanceId !== instanceId) continue;
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
    const supportStrength = getEffectiveStrength(questingInstance, questingDef, 0, getGameModifiers(state, definitions));
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
            storyName: "Support",
            rulesText: `Whenever this character quests, you may add their strength (${supportStrength}) to another chosen character's strength this turn.`,
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
              _supportRecipientHook: true,
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

  // Set 11 pacifist cycle: track that the attacker's owner had a character
  // challenge this turn. Used by no_challenges_this_turn condition.
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], aCharacterChallengedThisTurn: true },
    },
  };

  const atkStaticStr = modifiers.statBonuses.get(attackerInstanceId)?.strength ?? 0;
  const defStaticStr = modifiers.statBonuses.get(defenderInstanceId)?.strength ?? 0;
  let attackerStr = getEffectiveStrength(attacker, attackerDef, atkStaticStr, modifiers);
  let defenderStr = getEffectiveStrength(defender, defenderDef, defStaticStr, modifiers);

  // Check for "while being challenged" stat bonuses on the defender. The
  // modifier may target either the defender (self, default) or the attacker
  // (Louie One Cool Duck: "the challenging character gets -1 {S}").
  for (const ability of defenderDef.abilities) {
    if (ability.type !== "static") continue;
    if (ability.effect.type !== "modify_stat_while_challenged") continue;
    if (ability.effect.stat !== "strength") continue;
    if (ability.effect.affects === "attacker") {
      attackerStr += ability.effect.modifier;
    } else {
      defenderStr += ability.effect.modifier;
    }
  }

  // CRD 8.5.1: Challenger +N bonus (only when attacking a character, not defending — CRD 8.5.2)
  // CRD 4.6.8: Challenger does not apply when challenging a location.
  if (defenderDef.cardType === "character") {
    const challengerValue = getKeywordValue(attacker, attackerDef, "challenger", modifiers.grantedKeywords.get(attackerInstanceId));
    attackerStr += challengerValue;
  }

  // Conditional challenge bonuses (e.g. Olympus Would Be That Way: +3 {S} while challenging a location).
  // These are turn-scoped player-wide bonuses that behave like Challenger but with a defender filter.
  const turnBonuses = state.players[playerId].turnChallengeBonuses;
  if (turnBonuses && turnBonuses.length > 0) {
    for (const bonus of turnBonuses) {
      if (matchesFilter(defender, defenderDef, bonus.defenderFilter, state, playerId)) {
        attackerStr += bonus.strength;
      }
    }
  }

  state = exertInstance(state, attackerInstanceId, definitions);
  // Mark defender as challenged this turn (for Last Stand and similar cards)
  // CRD 4.6.8: Locations don't track challengedThisTurn (no character-state).
  if (defenderDef.cardType === "character") {
    state = updateInstance(state, defenderInstanceId, { challengedThisTurn: true });
  }

  // CRD 8.8.1: Resist +N reduces incoming challenge damage (min 0)
  const attackerResist = getKeywordValue(attacker, attackerDef, "resist", modifiers.grantedKeywords.get(attackerInstanceId));
  const defenderResist = getKeywordValue(defender, defenderDef, "resist", modifiers.grantedKeywords.get(defenderInstanceId));
  let actualAttackerDamage = Math.max(0, defenderStr - attackerResist);
  let actualDefenderDamage = Math.max(0, attackerStr - defenderResist);

  // Raya - Leader of Heart: challenge damage immunity when defender matches filter
  const immuneFilter = modifiers.challengeDamageImmunity.get(attackerInstanceId);
  if (immuneFilter !== undefined) {
    if (!immuneFilter || matchesFilter(defender, defenderDef, immuneFilter, state, playerId)) {
      actualAttackerDamage = 0;
    }
  }

  // Generic damage immunity — "takes no damage from challenges" (Noi, Pirate
  // Mickey timed; Baloo all-source static). Applies separately to attacker and
  // defender since either combatant may be immune. Hercules' "non_challenge"
  // source does NOT apply here (it still takes challenge damage).
  // Charges-based immunity (Rapunzel) is consumed via dealDamageToCard's
  // hook below, not here — challenge damage path writes via direct updates,
  // so consume timed charges manually if applicable.
  const consumeTimedCharge = (id: string): void => {
    const inst = state.cards[id];
    if (!inst) return;
    const idx = findTimedDamageImmunityIdx(inst, true);
    if (idx < 0) return;
    const te = inst.timedEffects[idx]!;
    if (te.charges === undefined) return;
    const remaining = te.charges - 1;
    const next = remaining <= 0
      ? inst.timedEffects.filter((_, i) => i !== idx)
      : inst.timedEffects.map((e, i) => (i === idx ? { ...e, charges: remaining } : e));
    state = updateInstance(state, id, { timedEffects: next });
  };
  // Lilo Bundled Up: charge-based static immunity. Consume one charge per
  // blocked challenge hit by bumping the per-turn used counter.
  const consumeStaticCharge = (id: string): void => {
    if (!modifiers.damageImmunityCharges.has(id)) return;
    const inst = state.cards[id];
    if (!inst) return;
    const used = (inst.damageImmunityChargesUsedThisTurn ?? 0) + 1;
    state = updateInstance(state, id, { damageImmunityChargesUsedThisTurn: used });
  };
  if (hasStaticDamageImmunity(attacker, modifiers, true) || findTimedDamageImmunityIdx(attacker, true) >= 0) {
    if (actualAttackerDamage > 0) {
      consumeStaticCharge(attackerInstanceId);
      consumeTimedCharge(attackerInstanceId);
    }
    actualAttackerDamage = 0;
  }
  if (hasStaticDamageImmunity(defender, modifiers, true) || findTimedDamageImmunityIdx(defender, true) >= 0) {
    if (actualDefenderDamage > 0) {
      consumeStaticCharge(defenderInstanceId);
      consumeTimedCharge(defenderInstanceId);
    }
    actualDefenderDamage = 0;
  }

  // CRD 6.5: Check for damage redirect on each combatant
  const attackerRedirect = actualAttackerDamage > 0 ? findDamageRedirect(state, attackerInstanceId, definitions, modifiers) : null;
  const defenderRedirect = actualDefenderDamage > 0 ? findDamageRedirect(state, defenderInstanceId, definitions, modifiers) : null;

  // Apply attacker damage (or redirect)
  if (actualAttackerDamage > 0) {
    const atkTarget = attackerRedirect ?? attackerInstanceId;
    const inst = getInstance(state, atkTarget);
    state = updateInstance(state, atkTarget, { damage: inst.damage + actualAttackerDamage });
    state = {
      ...state,
      players: {
        ...state.players,
        [inst.ownerId]: { ...state.players[inst.ownerId], aCharacterWasDamagedThisTurn: true },
      },
    };
    events.push({ type: "damage_dealt", instanceId: atkTarget, amount: actualAttackerDamage });
    // Fire damage_dealt_to trigger for challenge damage
    state = queueTrigger(state, "damage_dealt_to", atkTarget, definitions, {});
    // CRD 4.3.6: defender is the damage-dealer for attacker-side damage
    state = queueTrigger(state, "deals_damage_in_challenge", defenderInstanceId, definitions, {
      triggeringCardInstanceId: atkTarget,
    });
  }

  // Apply defender damage (or redirect)
  if (actualDefenderDamage > 0) {
    const defTarget = defenderRedirect ?? defenderInstanceId;
    const inst = getInstance(state, defTarget);
    state = updateInstance(state, defTarget, { damage: inst.damage + actualDefenderDamage });
    state = {
      ...state,
      players: {
        ...state.players,
        [inst.ownerId]: { ...state.players[inst.ownerId], aCharacterWasDamagedThisTurn: true },
      },
    };
    events.push({ type: "damage_dealt", instanceId: defTarget, amount: actualDefenderDamage });
    // Fire damage_dealt_to trigger for challenge damage
    state = queueTrigger(state, "damage_dealt_to", defTarget, definitions, {});
    // CRD 4.3.6: attacker dealt damage to defender
    state = queueTrigger(state, "deals_damage_in_challenge", attackerInstanceId, definitions, {
      triggeringCardInstanceId: defTarget,
    });
  }

  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId}'s ${attackerDef.fullName} (${attackerStr}) challenged ${defenderDef.fullName} (${defenderStr}).`,
    type: "card_challenged",
  });

  state = queueTrigger(state, "challenges", attackerInstanceId, definitions, {
    triggeringCardInstanceId: defenderInstanceId,
  });
  if (defenderDef.cardType === "character") {
    state = queueTrigger(state, "is_challenged", defenderInstanceId, definitions, {
      triggeringCardInstanceId: attackerInstanceId,
    });
  }

  // CRD 6.2.7.1: Check floating triggers for `challenges` (Medallion Weights:
  // "Whenever they challenge another character this turn, you may draw a card.")
  if (state.floatingTriggers) {
    for (const ft of state.floatingTriggers) {
      if (ft.trigger.on !== "challenges") continue;
      if (ft.attachedToInstanceId && ft.attachedToInstanceId !== attackerInstanceId) continue;
      const triggerFilter = "filter" in ft.trigger ? ft.trigger.filter : undefined;
      if (triggerFilter) {
        if (!matchesFilter(attacker, attackerDef, triggerFilter, state, ft.controllingPlayerId)) continue;
      }
      for (const fEffect of ft.effects) {
        state = applyEffect(state, fEffect, attackerInstanceId, ft.controllingPlayerId, definitions, events);
      }
    }
  }

  const atkStaticWp = modifiers.statBonuses.get(attackerInstanceId)?.willpower ?? 0;
  const defStaticWp = modifiers.statBonuses.get(defenderInstanceId)?.willpower ?? 0;
  const attackerWp = getEffectiveWillpower(attacker, attackerDef, atkStaticWp);
  const defenderWp = getEffectiveWillpower(defender, defenderDef, defStaticWp);

  // Re-read damage after potential redirect
  const attackerBanished = getInstance(state, attackerInstanceId).damage >= attackerWp;
  const defenderBanished = getInstance(state, defenderInstanceId).damage >= defenderWp;

  // Also check if redirect targets need banishing
  if (attackerRedirect) {
    const rInst = getInstance(state, attackerRedirect);
    const rDef = definitions[rInst.definitionId];
    if (rDef && rInst.damage >= getEffectiveWillpower(rInst, rDef)) {
      state = banishCard(state, attackerRedirect, definitions, events);
    }
  }
  if (defenderRedirect) {
    const rInst = getInstance(state, defenderRedirect);
    const rDef = definitions[rInst.definitionId];
    if (rDef && rInst.damage >= getEffectiveWillpower(rInst, rDef)) {
      state = banishCard(state, defenderRedirect, definitions, events);
    }
  }

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

// CRD 4.7: Move a character to a location — pay move cost, set pointer, fire trigger
function applyMoveCharacter(
  state: GameState,
  playerId: PlayerID,
  characterInstanceId: string,
  locationInstanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const locDef = getDefinition(state, locationInstanceId, definitions);
  const baseCost = locDef.moveCost ?? 0;
  // Apply per-location move cost reductions (Jolly Roger).
  const moveModifiers = getGameModifiers(state, definitions);
  const charInst = getInstance(state, characterInstanceId);
  const charDef = getDefinition(state, characterInstanceId, definitions);
  const moveCost = applyMoveCostReduction(baseCost, charInst, charDef, locationInstanceId, moveModifiers, state, playerId);

  // Deduct ink (the move_character effect path skips this — see performMove)
  if (moveCost > 0) {
    state = updatePlayerInk(state, playerId, -moveCost);
  }
  return performMove(state, characterInstanceId, locationInstanceId, definitions, events);
}

/** Pure mutation shared by the MOVE_CHARACTER action and the move_character effect.
 *  Sets atLocationInstanceId, marks movedThisTurn, logs, and queues the
 *  moves_to_location trigger. Does NOT pay ink — the action wrapper handles that.
 *
 *  Honors action restrictions (Max Goof Rockin' Teen "I JUST WANNA STAY HOME"
 *  — "This character can't move to locations.") regardless of how the move was
 *  initiated. Magic Carpet trying to move Max Goof should fizzle. */
function performMove(
  state: GameState,
  characterInstanceId: string,
  locationInstanceId: string,
  definitions: Record<string, CardDefinition>,
  _events: GameEvent[]
): GameState {
  const characterInst = state.cards[characterInstanceId];
  const locationInst = state.cards[locationInstanceId];
  if (!characterInst || !locationInst) return state;
  const playerId = characterInst.ownerId;

  // Restriction check (Max Goof Rockin' Teen and any future "can't move" effects)
  const charDef0 = definitions[characterInst.definitionId];
  if (charDef0) {
    const moveModifiers = getGameModifiers(state, definitions);
    if (isActionRestricted(characterInst, charDef0, "move", playerId, state, moveModifiers)) {
      return state;
    }
  }

  state = updateInstance(state, characterInstanceId, {
    atLocationInstanceId: locationInstanceId,
    movedThisTurn: true,
  });

  const charDef = definitions[characterInst.definitionId];
  const locDef = definitions[locationInst.definitionId];
  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} moved ${charDef?.fullName ?? characterInstanceId} to ${locDef?.fullName ?? locationInstanceId}.`,
    type: "character_moved",
  });

  // Fire moves_to_location triggers (sourced from the moving character)
  state = queueTrigger(state, "moves_to_location", characterInstanceId, definitions, {
    triggeringCardInstanceId: locationInstanceId,
    triggeringPlayerId: playerId,
  });

  return state;
}

/** CRD 8.4: Boost N {I} — pay N, top of deck → cardsUnder, mark boostedThisTurn. */
function applyBoostCard(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  _events: GameEvent[]
): GameState {
  const inst = getInstance(state, instanceId);
  const def = getDefinition(state, instanceId, definitions);
  const cost = getKeywordValue(inst, def, "boost");
  state = updatePlayerInk(state, playerId, -cost);

  // Move top card of deck → under this card. The under card's instance stays
  // addressable but its zone becomes "under" and it's removed from the deck array.
  const deck = getZone(state, playerId, "deck");
  const topId = deck[0]!;
  const topInst = state.cards[topId]!;
  state = {
    ...state,
    cards: {
      ...state.cards,
      [topId]: { ...topInst, zone: "under" },
      [instanceId]: {
        ...state.cards[instanceId]!,
        cardsUnder: [...state.cards[instanceId]!.cardsUnder, topId],
        cardsPutUnderThisTurn: (state.cards[instanceId]!.cardsPutUnderThisTurn ?? 0) + 1,
        boostedThisTurn: true,
      },
    },
    zones: {
      ...state.zones,
      [playerId]: {
        ...state.zones[playerId],
        deck: state.zones[playerId].deck.filter(id => id !== topId),
      },
    },
  };

  state = appendLog(state, {
    turn: state.turnNumber,
    playerId,
    message: `${playerId} Boosted ${def.fullName} (paid ${cost} ink, put top of deck under).`,
    type: "ability_activated",
  });
  // CRD 8.4.2: emit card_put_under trigger — carrier is the instance receiving
  // the card, triggering card is the card that was placed.
  state = queueTrigger(state, "card_put_under", instanceId, definitions, {
    triggeringPlayerId: playerId,
    triggeringCardInstanceId: topId,
  });
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
  // Check if this is a granted activated ability (index beyond definition's own abilities)
  let ability;
  if (abilityIndex < def.abilities.length) {
    ability = def.abilities[abilityIndex];
  } else {
    // Granted by static effect (e.g. Cogsworth - Talking Clock)
    const modifiers = getGameModifiers(state, definitions);
    const grantedAbilities = modifiers.grantedActivatedAbilities.get(instanceId);
    const grantedIndex = abilityIndex - def.abilities.length;
    ability = grantedAbilities?.[grantedIndex];
  }
  if (!ability || ability.type !== "activated") throw new Error("Invalid ability");

  // CRD 6.1.13: "Once per turn" — mark the ability as used. The validator already
  // blocked re-activation, so we mark BEFORE paying costs/applying effects.
  if (ability.oncePerTurn) {
    const key = ability.storyName ?? ability.rulesText ?? "anon";
    const inst = getInstance(state, instanceId);
    state = updateInstance(state, instanceId, {
      oncePerTurnTriggered: { ...(inst.oncePerTurnTriggered ?? {}), [key]: true },
    });
  }

  state = payCosts(state, playerId, instanceId, ability.costs, events, definitions);

  // CRD 6.2.1: Check condition before resolving effects (costs still paid)
  if (ability.condition) {
    if (!evaluateCondition(ability.condition, state, definitions, playerId, instanceId)) {
      // Condition not met after paying costs — ability fizzles
      events.push({ type: "ability_triggered", instanceId, abilityType: "activated" });
      return state;
    }
  }

  for (let i = 0; i < ability.effects.length; i++) {
    const effect = ability.effects[i]!;
    state = applyEffect(state, effect, instanceId, playerId, definitions, events);
    if (state.pendingChoice) {
      const remaining = ability.effects.slice(i + 1);
      if (remaining.length > 0) {
        state = { ...state, pendingEffectQueue: { effects: remaining, sourceInstanceId: instanceId, controllingPlayerId: playerId } };
      }
      break;
    }
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

  // Banish cards queued for end-of-turn removal (Gruesome and Grim, Madam Mim)
  if (state.pendingEndOfTurnBanish?.length) {
    for (const id of state.pendingEndOfTurnBanish) {
      const inst = state.cards[id];
      if (inst && inst.zone === "play") {
        state = banishCard(state, id, definitions, events);
      }
    }
    state = { ...state, pendingEndOfTurnBanish: [] };
  }

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
        extraInkPlaysGranted: 0, // Clear turn-scoped extra ink grants
        actionsPlayedThisTurn: 0,
        songsPlayedThisTurn: 0,
        charactersPlayedThisTurn: [],
        charactersQuestedThisTurn: 0,
        // Per-turn event flags reset on the new active player too (defensive)
        aCharacterWasDamagedThisTurn: false,
        aCharacterWasBanishedInChallengeThisTurn: false,
        aCharacterChallengedThisTurn: false,
        opposingCharsBanishedInChallengeThisTurn: 0,
        timedGrantedActivatedAbilities: [],
      },
      // CRD 3.4.1.2: clear the ending player's turn-scoped conditional challenge bonuses
      // and per-turn event flags (damaged-this-turn, banished-in-challenge-this-turn).
      // Both players' event flags reset at turn boundary — "this turn" is the global turn.
      [playerId]: {
        ...state.players[playerId],
        turnChallengeBonuses: [],
        charactersPlayedThisTurn: [],
        charactersQuestedThisTurn: 0,
        aCharacterWasDamagedThisTurn: false,
        aCharacterWasBanishedInChallengeThisTurn: false,
        aCharacterChallengedThisTurn: false,
        opposingCharsBanishedInChallengeThisTurn: 0,
        timedGrantedActivatedAbilities: [],
      },
    },
    cardsLeftDiscardThisTurn: false,
  };

  // Ready all of opponent's cards in play and inkwell (CRD 3.2.1.1)
  // CRD 6.6.1: Respect "can't ready" from both timed effects and static modifiers
  const modifiers = getGameModifiers(state, definitions);
  const opponentPlay = getZone(state, opponent, "play");
  for (const id of opponentPlay) {
    const inst = getInstance(state, id);
    const def = definitions[inst.definitionId];
    if (def && isActionRestricted(inst, def, "ready", opponent, state, modifiers)) {
      // CRD: Can't ready — only clear isDrying, keep exerted
      state = updateInstance(state, id, { isDrying: false });
    } else {
      const wasExerted = inst.isExerted;
      state = updateInstance(state, id, { isExerted: false, isDrying: false });
      // Fire readied trigger when going from exerted to ready
      if (wasExerted) {
        state = queueTrigger(state, "readied", id, definitions, {});
      }
    }
  }
  const opponentInkwell = getZone(state, opponent, "inkwell");
  for (const id of opponentInkwell) {
    state = updateInstance(state, id, { isExerted: false });
  }

  // CRD 3.2.2.2: Set step — gain lore from each location the active player controls
  for (const id of getZone(state, opponent, "play")) {
    const inst = state.cards[id];
    if (!inst) continue;
    const def = definitions[inst.definitionId];
    if (!def || def.cardType !== "location") continue;
    const locLore = getEffectiveLore(inst, def);
    if (locLore > 0) {
      state = gainLore(state, opponent, locLore, events, definitions);
    }
  }

  // CRD 6.2.7.1: Clear floating triggers at end of turn
  if (state.floatingTriggers && state.floatingTriggers.length > 0) {
    state = { ...state, floatingTriggers: [] };
  }

  // CRD 3.4.1.2: effects that end "this turn" — clear temp modifiers and challengedThisTurn
  for (const id of Object.keys(state.cards)) {
    const instance = getInstance(state, id);
    if (
      instance.tempStrengthModifier !== 0 ||
      instance.tempWillpowerModifier !== 0 ||
      instance.tempLoreModifier !== 0 ||
      instance.grantedKeywords.length > 0 ||
      instance.challengedThisTurn ||
      instance.movedThisTurn ||
      instance.oncePerTurnTriggered ||
      instance.boostedThisTurn ||
      (instance.cardsPutUnderThisTurn ?? 0) > 0 ||
      (instance.damageImmunityChargesUsedThisTurn ?? 0) > 0
    ) {
      state = updateInstance(state, id, {
        tempStrengthModifier: 0,
        tempWillpowerModifier: 0,
        tempLoreModifier: 0,
        grantedKeywords: [],
        challengedThisTurn: false,
        movedThisTurn: false,
        // CRD 6.1.13: once-per-turn flags reset at end of turn
        oncePerTurnTriggered: undefined,
        boostedThisTurn: false,
        cardsPutUnderThisTurn: 0,
        damageImmunityChargesUsedThisTurn: 0,
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
      // "end_of_owner_next_turn" — expires at end of the AFFECTED CARD'S OWNER's next turn.
      // (Elsa Spirit of Winter, Iago, etc — "during their next turn".)
      if (te.expiresAt === "end_of_owner_next_turn") {
        if (te.appliedOnTurn < newTurnNumber && instance.ownerId === playerId) {
          return false;
        }
        return true;
      }
      // "until_caster_next_turn" — expires just before the CASTER starts their next turn.
      // After applyPassTurn updates currentPlayer to the new active player, that new
      // active player IS the next turn-taker. If they equal the caster, the caster's
      // next turn is starting now → expire. Correct in 2P AND 3+P.
      if (te.expiresAt === "until_caster_next_turn") {
        if (te.appliedOnTurn < newTurnNumber && te.casterPlayerId === opponent) {
          // `opponent` here is the NEW current player (set above as the new active player).
          // The caster's next turn is beginning, expire the effect.
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

  // Expire timed play restrictions whose caster's next turn is starting now.
  // After applyPassTurn updates the active player to `opponent`, that player IS
  // the new turn-taker. If they equal an entry's casterPlayerId, the caster's
  // next turn has begun → drop the entry.
  for (const pid of ["player1", "player2"] as const) {
    const list = state.players[pid].playRestrictions;
    if (!list || list.length === 0) continue;
    const kept = list.filter(
      (e) => !(e.appliedOnTurn < newTurnNumber && e.casterPlayerId === opponent),
    );
    if (kept.length !== list.length) {
      state = {
        ...state,
        players: {
          ...state.players,
          [pid]: { ...state.players[pid], playRestrictions: kept.length > 0 ? kept : undefined },
        },
      };
    }
  }

  // CRD 3.2.1.4: "At the start of your turn" triggered abilities
  state = queueTriggersByEvent(state, "turn_start", opponent, definitions, {});
  state = processTriggerStack(state, definitions, events);

  // CRD 3.2.3.1: draw step — active player draws a card.
  // Skip if a static effect on a card the active player owns says so
  // (Arthur Determined Squire — "Skip your turn's Draw step").
  const drawModifiers = getGameModifiers(state, definitions);
  if (!drawModifiers.skipsDrawStep.has(opponent)) {
    state = applyDraw(state, opponent, 1, events, definitions);
  }

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
  events: GameEvent[],
  definitions: Record<string, CardDefinition>
): GameState {
  for (let i = 0; i < amount; i++) {
    const deck = getZone(state, playerId, "deck");
    if (deck.length === 0) break;
    const topCardId = deck[0];
    if (!topCardId) break;
    state = moveCard(state, topCardId, playerId, "hand");
    events.push({ type: "card_drawn", playerId, instanceId: topCardId });
    const cardName = getDefinition(state, topCardId, definitions)?.fullName ?? "a card";
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} drew ${cardName}.`,
      type: "card_drawn",
    });
    // CRD 6.2: queue card_drawn triggers (Jafar Striking Illusionist, etc.)
    // Player filter is handled by queueTriggersByEvent matching trigger.player
    // against the drawing player.
    state = queueTriggersByEvent(state, "card_drawn", playerId, definitions, {
      triggeringCardInstanceId: topCardId,
    });
  }
  return state;
}

function applyResolveChoice(
  state: GameState,
  playerId: PlayerID,
  choice: string | string[] | number,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  if (!state.pendingChoice) return state;

  const { pendingChoice } = state;
  state = { ...state, pendingChoice: null };

  // CRD 2.2.2: Mulligan — put chosen cards at bottom of deck, draw replacements
  if (pendingChoice.type === "choose_mulligan" && Array.isArray(choice)) {
    const cardsToReturn = choice as string[];
    const drawCount = cardsToReturn.length;

    // Put chosen cards at bottom of deck
    for (const cardId of cardsToReturn) {
      state = moveCard(state, cardId, playerId, "deck", "bottom");
    }

    // Draw same number of replacements
    for (let i = 0; i < drawCount; i++) {
      state = applyDraw(state, playerId, 1, events, definitions);
    }

    // Log the mulligan decision with specific card names
    const msg = drawCount > 0
      ? `${playerId} mulliganed: ${cardsToReturn.map((id) => getDefinition(state, id, definitions)?.fullName ?? "Unknown").join(", ")}.`
      : `${playerId} kept their opening hand.`;
    state = appendLog(state, { turn: state.turnNumber, playerId, message: msg, type: "mulligan" });

    // Advance to next mulligan phase or start the game
    if (pendingChoice.choosingPlayerId === "player1") {
      const p2HandIds = state.zones.player2.hand;
      state = {
        ...state,
        phase: "mulligan_p2",
        pendingChoice: {
          type: "choose_mulligan",
          choosingPlayerId: "player2",
          prompt: "Choose cards to put back (you will draw the same number). Select none to keep your hand.",
          validTargets: [...p2HandIds],
          optional: true,
        },
      };
    } else {
      // Both players have mulliganed — start the game
      state = {
        ...state,
        phase: "main",
      };
    }

    return state;
  }

  const pendingEffect = pendingChoice.pendingEffect;

  // CRD 7.7.4: player chose which of their simultaneous triggers to resolve first.
  // We must process the chosen trigger NOW (not just reorder) — otherwise processTriggerStack
  // would see 2+ triggers again on its next iteration and re-ask indefinitely.
  if (pendingChoice.type === "choose_trigger" && typeof choice === "string") {
    const chosenIndex = parseInt(choice, 10);
    const chosen = state.triggerStack[chosenIndex];
    if (!chosen) {
      state = { ...state, pendingChoice: null };
      return state;
    }
    const rest = state.triggerStack.filter((_, i) => i !== chosenIndex);
    // Process only the chosen trigger in isolation, then merge remaining back.
    state = { ...state, triggerStack: [chosen], pendingChoice: null };
    state = processTriggerStack(state, definitions, events);
    // Re-append the remaining triggers (they'll go through ordering again if needed).
    state = { ...state, triggerStack: [...state.triggerStack, ...rest] };
    return state;
  }

  // CRD 6.1.4: "may" effect — accept or decline
  if (pendingChoice.type === "choose_may") {
    if (choice === "accept") {
      // Apply the effect — which may itself create a target choice (e.g. Support)
      const sourceId = pendingChoice.sourceInstanceId ?? "";
      const acceptController = pendingChoice.acceptControllingPlayerId ?? playerId;
      state = applyEffect(state, pendingEffect!, sourceId, acceptController, definitions, events, pendingChoice.triggeringCardInstanceId);
    } else if (pendingChoice.rejectEffect) {
      // CRD 6.1.4 inverse-may: Sign the Scroll / Ursula's Trickery. The reward
      // is controlled by the source's owner, NOT the choosing player.
      const sourceId = pendingChoice.sourceInstanceId ?? "";
      const rewardController = pendingChoice.rejectControllingPlayerId ?? playerId;
      state = applyEffect(state, pendingChoice.rejectEffect, sourceId, rewardController, definitions, events, pendingChoice.triggeringCardInstanceId);
    }
    // "decline" → skip; either path resumes any queued remaining effects from
    // the same trigger (Graveyard of Christmas Future ANOTHER CHANCE has a
    // banish queued behind the may'd put_cards_under_into_hand).
    state = resumePendingEffectQueue(state, definitions, events);
    return state;
  }

  // CRD 6.1.3: "choose one of" — apply the chosen option's sub-effects
  if (pendingChoice.type === "choose_option" && typeof choice === "number") {
    const options = pendingChoice.options ?? [];
    const chosen = options[choice];
    if (!chosen) return state;
    const sourceId = pendingChoice.sourceInstanceId ?? "";
    for (const subEffect of chosen) {
      state = applyEffect(state, subEffect, sourceId, playerId, definitions, events);
      if (state.pendingChoice) return state; // Sub-effect needs choice — pause
    }
    return state;
  }

  if (pendingChoice.type === "choose_discard" && Array.isArray(choice)) {
    // Discard the chosen cards from hand
    const discardCount = choice.length;
    // Determine who is discarding (the owner of the first card chosen)
    let discardingPlayerId: PlayerID | undefined;
    // Snapshot the discarded cards BEFORE moving so the ResolvedRef captures
    // their hand-state identity. Used by conditional_on_last_discarded
    // (Kakamora Pirate Chief: "if a Pirate card was discarded...").
    const discardedRefs: ResolvedRef[] = [];
    for (const cardId of choice) {
      const ref = makeResolvedRef(state, definitions, cardId);
      if (ref) discardedRefs.push(ref);
    }
    state = { ...state, lastDiscarded: discardedRefs };
    for (const cardId of choice) {
      const inst = state.cards[cardId];
      if (inst && inst.zone === "hand") {
        discardingPlayerId = inst.ownerId;
        state = moveCard(state, cardId, inst.ownerId, "discard");
      }
    }
    // Queue cards_discarded trigger (Prince John - Greediest of All) — but DO NOT
    // process the trigger stack inline. The triggering action (e.g. Sudden Chill being
    // sung) must finish its cleanup first so other triggers (e.g. Ursula DOA's "sings"
    // → "play that song from discard") see the action card in discard, not still in play.
    // Always set lastEffectResult so downstream cost_result reads see 0 when
    // no cards were discarded (Geppetto Skilled Craftsman "any number" path).
    state = { ...state, lastEffectResult: discardCount };
    if (discardCount > 0 && discardingPlayerId) {
      state = queueTriggersByEvent(state, "cards_discarded", discardingPlayerId, definitions, {});
    }
    state = resumePendingEffectQueue(state, definitions, events);
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_from_revealed" && Array.isArray(choice)) {
    const owner = playerId;
    if (choice.length === 1) {
      // Player picked a card to put in hand — rest go to bottom
      const chosenId = choice[0]!;
      // Bug fix: use revealedCards (all revealed) not validTargets (filtered subset) for rest
      const allRevealed = pendingChoice.revealedCards ?? pendingChoice.validTargets ?? [];
      const rest = allRevealed.filter(id => id !== chosenId);
      state = moveCard(state, chosenId, owner, "hand");
      if (rest.length > 1 && state.interactive) {
        // Let human choose the order the rest go to the bottom
        state = { ...state, pendingChoice: null };
        return {
          ...state,
          pendingChoice: {
            type: "choose_order",
            choosingPlayerId: owner,
            prompt: `Choose the order to place the remaining ${rest.length} cards on the bottom of your deck (first selected = bottommost).`,
            validTargets: rest,
          },
        };
      }
      state = reorderDeckTopToBottom(state, owner, rest, []);
    } else {
      // Empty choice (optional skip — no valid targets): put all revealed to bottom
      const allRevealed = pendingChoice.revealedCards ?? [];
      if (allRevealed.length > 1 && state.interactive) {
        state = { ...state, pendingChoice: null };
        return {
          ...state,
          pendingChoice: {
            type: "choose_order",
            choosingPlayerId: owner,
            prompt: `Choose the order to place the ${allRevealed.length} revealed cards on the bottom of your deck (first selected = bottommost).`,
            validTargets: allRevealed,
          },
        };
      }
      state = reorderDeckTopToBottom(state, owner, allRevealed, []);
    }
    state = resumePendingEffectQueue(state, definitions, events);
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_order" && Array.isArray(choice)) {
    // Player has specified an order for cards going to bottom of deck.
    // Route each card to ITS OWNER'S deck — Under the Sea sends opposing
    // characters to the bottom of their owner's deck (not the controller's).
    const ordered = choice as string[];
    const byOwner = new Map<PlayerID, string[]>();
    for (const id of ordered) {
      const inst = state.cards[id];
      if (!inst) continue;
      const owner = inst.ownerId;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(id);
      // For cards not currently in their owner's deck (Under the Sea sends
      // characters from PLAY → bottom of deck), we need to actually MOVE them
      // first. reorderDeckTopToBottom only re-orders cards already in deck.
      if (inst.zone !== "deck") {
        state = moveCard(state, id, owner, "deck");
      }
    }
    for (const [owner, ids] of byOwner) {
      state = reorderDeckTopToBottom(state, owner, ids, []);
    }
    state = resumePendingEffectQueue(state, definitions, events);
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_player" && typeof choice === "string") {
    // Controller has picked a player. Re-apply the pending effect with the
    // chosen player substituted via target.type. Generic — works for any
    // effect with a PlayerTarget (draw, lose_lore, gain_lore, etc.).
    const chosenPlayer = choice as PlayerID;
    if (pendingEffect) {
      const sourceId = pendingChoice.sourceInstanceId ?? "";
      state = applyChosenPlayerEffect(state, pendingEffect, chosenPlayer, playerId, sourceId, definitions, events);
    }
    state = resumePendingEffectQueue(state, definitions, events);
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_card_name" && typeof choice === "string") {
    // The Sorcerer's Hat / Merlin Clever Clairvoyant: compare the named card
    // to the top of deck. matchAction defaults to "to_hand"; Merlin uses
    // "to_inkwell_exerted". Blast from Your Past uses "return_all_from_discard"
    // and skips the deck-top reveal entirely.
    const matchActionPre = (pendingEffect as any)?.matchAction ?? "to_hand";
    if (matchActionPre === "return_all_from_discard") {
      const discard = getZone(state, playerId, "discard");
      for (const cid of [...discard]) {
        const inst = state.cards[cid];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (def && def.cardType === "character" && def.name === choice) {
          state = moveCard(state, cid, playerId, "hand");
        }
      }
      return state;
    }
    const deck = getZone(state, playerId, "deck");
    const topId = deck[0];
    if (topId) {
      const topInst = state.cards[topId];
      const topDef = topInst ? definitions[topInst.definitionId] : undefined;
      if (topDef && topDef.name === choice) {
        const matchAction = (pendingEffect as any)?.matchAction ?? "to_hand";
        if (matchAction === "to_inkwell_exerted") {
          state = zoneTransition(state, topId, "inkwell", definitions, events, { reason: "inked" });
          state = updateInstance(state, topId, { isExerted: true });
        } else {
          state = moveCard(state, topId, playerId, "hand");
        }
      }
      // else: leave on top — no-op
    }
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
      // Track a snapshot of the targeted card. Used by follow-up effects like
      // target_owner ("its player draws") and last_target_location_lore
      // (I've Got a Dream: "lore equal to that location's {L}").
      const ref = makeResolvedRef(state, definitions, targetId);
      if (ref) {
        state = { ...state, lastResolvedTarget: ref };
      }
      const srcId = pendingChoice.sourceInstanceId ?? "";
      const trigId = pendingChoice.triggeringCardInstanceId;

      // Hades - Looking for a Deal: special inverse-may path. After the
      // caster picks an opposing target, surface a may-prompt for the
      // target's owner. Accept → put_on_bottom_of_deck on the chosen target
      // (deny the caster's reward). Reject → caster fires rewardEffect.
      if ((pendingEffect as any)?.type === "chosen_opposing_may_bottom_or_reward") {
        const targetInst = state.cards[targetId];
        if (!targetInst) continue;
        const targetOwnerId = targetInst.ownerId;
        const reject = (pendingEffect as any).rewardEffect as Effect;
        // Synthesize a put-on-bottom-of-deck effect for the chosen target.
        const acceptEffect = {
          type: "put_on_bottom_of_deck" as const,
          from: "play" as const,
          target: { type: "this" as const },
        };
        state = {
          ...state,
          pendingChoice: {
            type: "choose_may",
            choosingPlayerId: targetOwnerId,
            prompt: "Put your character on the bottom of your deck (to prevent the draw)?",
            pendingEffect: acceptEffect,
            optional: true,
            sourceInstanceId: targetId,
            triggeringCardInstanceId: trigId,
            rejectEffect: reject,
            rejectControllingPlayerId: playerId,
          },
        };
        return state;
      }

      state = applyEffectToTarget(state, pendingEffect!, targetId, playerId, definitions, events, srcId, trigId);
      // Apply follow-up effects to the same target
      if (pendingChoice.followUpEffects) {
        for (const followUp of pendingChoice.followUpEffects) {
          state = applyEffectToTarget(state, followUp, targetId, playerId, definitions, events, srcId, trigId);
        }
      }
      // CRD 8.13: chosen_for_support — Prince Phillip Gallant Defender,
      // Rapunzel Ready for Adventure. Fire on the picked recipient when the
      // synthesized Support gain_stats has the marker flag.
      if ((pendingEffect as any)?._supportRecipientHook) {
        state = queueTrigger(state, "chosen_for_support", targetId, definitions, {
          triggeringPlayerId: playerId,
          triggeringCardInstanceId: srcId,
        });
      }
      // Vanish keyword + chosen_by_opponent triggered abilities. Both fire
      // when the chosen target is opposing — Vanish is a hardcoded banish,
      // chosen_by_opponent is a free-form triggered ability (Archimedes
      // Exceptional Owl: "may draw a card"). Both fire AFTER the effect
      // resolves so any damage/etc. still goes through.
      const targetInst = state.cards[targetId];
      const targetDef = targetInst ? definitions[targetInst.definitionId] : undefined;
      if (targetInst && targetDef && targetInst.zone === "play" && targetInst.ownerId !== playerId) {
        // Queue chosen_by_opponent self-triggers so cards like Archimedes can react.
        state = queueTrigger(state, "chosen_by_opponent", targetId, definitions, {
          triggeringPlayerId: targetInst.ownerId,
          triggeringCardInstanceId: srcId,
        });
        const vanishMods = getGameModifiers(state, definitions);
        if (hasKeyword(targetInst, targetDef, "vanish", vanishMods.grantedKeywords.get(targetId))) {
          state = zoneTransition(state, targetId, "discard", definitions, events, { reason: "banished", triggeringPlayerId: targetInst.ownerId });
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

/**
 * Resolve a DynamicAmount to a number. See the DynamicAmount type in
 * packages/engine/src/types/index.ts for variant semantics. Variants that
 * depend on a chosen target (target_lore / target_damage / target_strength)
 * require `targetInstanceId` to be passed in — when resolving at choose-from-
 * targets time (applyEffectToTarget). source_lore / source_strength require
 * `sourceInstanceId`. Any `max` field on the object form caps the result.
 */
function resolveDynamicAmount(
  amount: import("../types").DynamicAmount,
  state: GameState,
  definitions: Record<string, CardDefinition>,
  controllingPlayerId: PlayerID,
  sourceInstanceId: string,
  triggeringCardInstanceId: string | undefined,
  targetInstanceId: string | undefined,
): number {
  // Primitive variants
  if (typeof amount === "number") return amount;
  if (amount === "X") return 1;
  if (amount === "cost_result") return state.lastEffectResult ?? 0;
  if (amount === "damage_on_target") return state.lastEffectResult ?? 0;
  if (amount === "triggering_card_lore") {
    const inst = triggeringCardInstanceId ? state.cards[triggeringCardInstanceId] : undefined;
    const def = inst ? definitions[inst.definitionId] : undefined;
    return def?.lore ?? 0;
  }
  if (amount === "triggering_card_damage") {
    const inst = triggeringCardInstanceId ? state.cards[triggeringCardInstanceId] : undefined;
    return inst?.damage ?? 0;
  }
  if (amount === "last_resolved_target_delta") {
    return state.lastResolvedTarget?.delta ?? 0;
  }
  if (amount === "last_resolved_source_strength") {
    return state.lastResolvedSource?.strength ?? 0;
  }
  if (amount === "song_singer_count") {
    return state.lastSongSingerCount ?? 0;
  }
  if (amount === "last_resolved_target_lore") {
    return state.lastResolvedTarget?.lore ?? 0;
  }
  if (amount === "last_target_location_lore") {
    const lastTargetId = state.lastResolvedTarget?.instanceId;
    const lastTargetInst = lastTargetId ? state.cards[lastTargetId] : undefined;
    const locId = lastTargetInst?.atLocationInstanceId;
    const locInst = locId ? state.cards[locId] : undefined;
    const locDef = locInst ? definitions[locInst.definitionId] : undefined;
    return locDef?.lore ?? 0;
  }
  // Object variants
  let resolved = 0;
  switch (amount.type) {
    case "count":
      resolved = findMatchingInstances(state, definitions, amount.filter, controllingPlayerId, sourceInstanceId).length;
      break;
    case "target_lore": {
      const inst = targetInstanceId ? state.cards[targetInstanceId] : undefined;
      const def = inst ? definitions[inst.definitionId] : undefined;
      resolved = def?.lore ?? 0;
      break;
    }
    case "target_damage": {
      const inst = targetInstanceId ? state.cards[targetInstanceId] : undefined;
      resolved = inst?.damage ?? 0;
      break;
    }
    case "target_strength": {
      const inst = targetInstanceId ? state.cards[targetInstanceId] : undefined;
      const def = inst ? definitions[inst.definitionId] : undefined;
      resolved = inst && def ? getEffectiveStrength(inst, def, 0, getGameModifiers(state, definitions)) : 0;
      break;
    }
    case "source_lore": {
      const inst = state.cards[sourceInstanceId];
      const def = inst ? definitions[inst.definitionId] : undefined;
      resolved = def?.lore ?? 0;
      break;
    }
    case "source_strength": {
      const inst = state.cards[sourceInstanceId];
      const def = inst ? definitions[inst.definitionId] : undefined;
      resolved = inst && def ? getEffectiveStrength(inst, def, 0, getGameModifiers(state, definitions)) : 0;
      break;
    }
    case "cards_under_count": {
      // CRD 8.4.2: "for each card under this character" — count the source's pile.
      const inst = state.cards[sourceInstanceId];
      resolved = inst?.cardsUnder.length ?? 0;
      break;
    }
  }
  const max = (amount as { max?: number }).max;
  if (typeof max === "number") resolved = Math.min(resolved, max);
  return resolved;
}

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
      // "Draw until you have N in hand" — resolve target hand size, compute
      // delta, draw that many. Natural no-op when already at target.
      if (effect.untilHandSize !== undefined) {
        const resolvePlayer = (): PlayerID =>
          effect.target.type === "opponent"
            ? getOpponent(controllingPlayerId)
            : effect.target.type === "target_owner"
              ? (state.lastResolvedTarget?.ownerId ?? controllingPlayerId)
              : controllingPlayerId;
        const drawPlayers: PlayerID[] =
          effect.target.type === "both"
            ? [controllingPlayerId, getOpponent(controllingPlayerId)]
            : [resolvePlayer()];
        const targetSize =
          effect.untilHandSize === "match_opponent_hand"
            ? state.zones[getOpponent(controllingPlayerId)].hand.length
            : effect.untilHandSize;
        for (const p of drawPlayers) {
          const currentHand = state.zones[p].hand.length;
          const delta = targetSize - currentHand;
          if (delta > 0) state = applyDraw(state, p, delta, events, definitions);
        }
        return state;
      }
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, undefined);
      if (amount <= 0) return state;
      if (effect.target.type === "both") {
        state = applyDraw(state, controllingPlayerId, amount, events, definitions);
        state = applyDraw(state, getOpponent(controllingPlayerId), amount, events, definitions);
        return state;
      }
      // Chosen player — controller picks any player (Second Star to the Right etc.)
      if (effect.target.type === "chosen") {
        return surfaceChoosePlayer(state, effect, controllingPlayerId, sourceInstanceId, definitions, events);
      }
      const targetPlayer =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : effect.target.type === "target_owner"
            ? (state.lastResolvedTarget?.ownerId ?? controllingPlayerId)
            : controllingPlayerId;
      return applyDraw(state, targetPlayer, amount, events, definitions);
    }

    case "reveal_hand": {
      // CRD: "chosen opponent reveals their hand" — headless engine has full
      // knowledge; emit a hand_revealed event for UI/analytics. No state change.
      const targetPlayer: PlayerID =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : effect.target.type === "target_owner"
            ? (state.lastResolvedTarget?.ownerId ?? getOpponent(controllingPlayerId))
            : effect.target.type === "self"
              ? controllingPlayerId
              : getOpponent(controllingPlayerId);
      const handCardIds = [...state.zones[targetPlayer].hand];
      events.push({
        type: "hand_revealed",
        playerId: targetPlayer,
        cardInstanceIds: handCardIds,
        sourceInstanceId,
      } as GameEvent);
      return state;
    }

    case "gain_lore": {
      if (effect.target.type === "chosen") {
        return surfaceChoosePlayer(state, effect, controllingPlayerId, sourceInstanceId, definitions, events);
      }
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, state.lastResolvedTarget?.instanceId);
      // "Each player gains N lore" — apply to both (I2I). CRD: target { type: "both" }.
      if (effect.target.type === "both") {
        state = gainLore(state, controllingPlayerId, amount, events, definitions);
        state = gainLore(state, getOpponent(controllingPlayerId), amount, events, definitions);
        return state;
      }
      const targetPlayer =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : effect.target.type === "target_owner"
            ? (state.lastResolvedTarget?.ownerId ?? controllingPlayerId)
            : controllingPlayerId;
      return gainLore(state, targetPlayer, amount, events, definitions);
    }

    case "deal_damage": {
      const resolveAmount = (amt: typeof effect.amount): number =>
        resolveDynamicAmount(amt, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, state.lastResolvedTarget?.instanceId);
      if (effect.target.type === "this") {
        return dealDamageToCard(state, sourceInstanceId, resolveAmount(effect.amount), definitions, events, false, false, effect.asDamageCounter);
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        return dealDamageToCard(state, triggeringCardInstanceId, resolveAmount(effect.amount), definitions, events, false, false, effect.asDamageCounter);
      }
      if (effect.target.type === "chosen") {
        const choosingPlayerId = chosenChooserPlayerId(effect.target, controllingPlayerId);
        const validTargets = findValidTargets(state, effect.target.filter, choosingPlayerId, definitions, sourceInstanceId);
        // CRD 1.7.7: if no legal choices exist, the effect resolves with no effect
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId,
            prompt: "Choose a target to deal damage to.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        const amount = resolveAmount(effect.amount);
        for (const targetId of targets) {
          state = dealDamageToCard(state, targetId, amount, definitions, events, false, false, effect.asDamageCounter);
        }
        return state;
      }
      return state;
    }

    case "banish": {
      if (effect.target.type === "chosen") {
        const choosingPlayerId = chosenChooserPlayerId(effect.target, controllingPlayerId);
        const validTargets = findValidTargets(state, effect.target.filter, choosingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId,
            prompt: "Choose a target to banish.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
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
        const choosingPlayerId = chosenChooserPlayerId(effect.target, controllingPlayerId);
        const validTargets = findValidTargets(state, effect.target.filter, choosingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId,
            prompt: "Choose a card to return to hand.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      if (effect.target.type === "this") {
        return zoneTransition(state, sourceInstanceId, "hand", definitions, events, { reason: "returned" });
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const trigInst = state.cards[triggeringCardInstanceId];
        if (trigInst) {
          // Set lastResolvedTarget so a follow-up effect can target_owner the
          // returned card's player (Yzma BACK TO WORK: "return that card... then
          // that player discards a card at random").
          const trigRef = makeResolvedRef(state, definitions, triggeringCardInstanceId);
          if (trigRef) state = { ...state, lastResolvedTarget: trigRef };
          return zoneTransition(state, triggeringCardInstanceId, "hand", definitions, events, { reason: "returned" });
        }
      }
      return state;
    }

    case "remove_damage": {
      if (effect.target.type === "this") {
        const instance = getInstance(state, sourceInstanceId);
        const actualHeal = Math.min(effect.amount, instance.damage);
        state = updateInstance(state, sourceInstanceId, {
          damage: Math.max(0, instance.damage - effect.amount),
        });
        if (actualHeal > 0) {
          state = queueTrigger(state, "damage_removed_from", sourceInstanceId, definitions, {});
        }
        return state;
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to remove damage from.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: true, // "Remove up to N" — player can decline
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          const inst = getInstance(state, targetId);
          const actualHeal = Math.min(effect.amount, inst.damage);
          state = updateInstance(state, targetId, {
            damage: Math.max(0, inst.damage - effect.amount),
          });
          if (actualHeal > 0) {
            state = queueTrigger(state, "damage_removed_from", targetId, definitions, {});
          }
        }
        return state;
      }
      return state;
    }

    case "gain_stats": {
      if (effect.target.type === "this") {
        return applyGainStatsToInstance(state, sourceInstanceId, effect, controllingPlayerId, definitions);
      }
      if (effect.target.type === "last_resolved_target") {
        const id = state.lastResolvedTarget?.instanceId;
        if (!id || !state.cards[id]) return state;
        return applyGainStatsToInstance(state, id, effect, controllingPlayerId, definitions);
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        return applyGainStatsToInstance(state, triggeringCardInstanceId, effect, controllingPlayerId, definitions);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a target.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const id of targets) state = applyGainStatsToInstance(state, id, effect, controllingPlayerId, definitions);
        return state;
      }
      return state;
    }

    case "damage_immunity_timed": {
      // Noi Acrobatic Baby (self), Pirate Mickey (chosen Pirate),
      // Nothing We Won't Do (all your chars). Applies a source-tagged
      // damage_immunity TimedEffect for the requested duration. If `charges`
      // is set, the immunity expires after that many blocked hits
      // (Rapunzel Ready for Adventure).
      const timed: TimedEffect = {
        type: "damage_immunity",
        damageSource: effect.source,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        ...(effect.charges !== undefined ? { charges: effect.charges } : {}),
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timed);
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        return addTimedEffect(state, triggeringCardInstanceId, timed);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to gain damage immunity.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const id of targets) state = addTimedEffect(state, id, timed);
        return state;
      }
      return state;
    }

    case "cant_be_challenged_timed": {
      // Apply a timed cant_be_challenged effect to the chosen character.
      const timed: TimedEffect = {
        type: "cant_be_challenged",
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timed);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character that can't be challenged.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const id of targets) state = addTimedEffect(state, id, timed);
        return state;
      }
      return state;
    }

    case "reveal_top_conditional": {
      // Reveal top card of deck. If it matches the filter, apply matchAction.
      // Else, put it back on top (default) or bottom of deck.
      // repeatOnMatch (Sisu Uniting Dragon): loop until a non-match.
      const targetPlayer = effect.target.type === "opponent" ? getOpponent(controllingPlayerId) : controllingPlayerId;
      let safety = 60; // bound to deck size
      // eslint-disable-next-line no-constant-condition
      while (safety-- > 0) {
      const deck = getZone(state, targetPlayer, "deck");
      const topId = deck[0];
      if (!topId) return state;
      const topInst = state.cards[topId];
      const topDef = topInst ? definitions[topInst.definitionId] : undefined;
      if (!topInst || !topDef) return state;
      const matches = matchesFilter(topInst, topDef, effect.filter, state, targetPlayer);
      if (matches) {
        // CRD 6.1.4: "may" — in non-interactive mode the bot accepts (best-case for the controller).
        // Interactive choose_may flow could be added later if needed.
        switch (effect.matchAction) {
          case "to_hand":
            state = moveCard(state, topId, targetPlayer, "hand");
            break;
          case "play_for_free": {
            // Move to play and resolve any action effects (mirrors play_for_free direct path).
            state = zoneTransition(state, topId, "play", definitions, events, {
              reason: "played", triggeringPlayerId: targetPlayer,
            });
            if (topDef.cardType === "character") {
              state = updateInstance(state, topId, { isDrying: true, ...(effect.matchEnterExerted ? { isExerted: true } : {}) });
            } else if (effect.matchEnterExerted && (topDef.cardType === "item" || topDef.cardType === "location")) {
              // Oswald Lucky Rabbit: items entering play exerted via the
              // FAVORABLE CHANCE reveal-and-play path.
              state = updateInstance(state, topId, { isExerted: true });
            }
            if (topDef.cardType === "action" && topDef.actionEffects) {
              for (const ae of topDef.actionEffects) {
                state = applyEffect(state, ae, topId, targetPlayer, definitions, events);
              }
              state = zoneTransition(state, topId, "discard", definitions, events, { reason: "discarded" });
            }
            break;
          }
          case "to_inkwell_exerted": {
            // Move to inkwell facedown and exerted (no ink granted, no inkable check)
            state = zoneTransition(state, topId, "inkwell", definitions, events, { reason: "inked" });
            state = updateInstance(state, topId, { isExerted: true });
            break;
          }
        }
        // Chained match-only effects (Bruno "gain 3 lore", etc.). Revealed card is
        // forwarded as the triggering card so `triggering_card` targets resolve to it.
        if (effect.matchExtraEffects) {
          for (const extra of effect.matchExtraEffects) {
            state = applyEffect(state, extra, sourceInstanceId, controllingPlayerId, definitions, events, topId);
          }
        }
      } else {
        // CRD: revealed but not matching → put on top (default), bottom, hand, or discard.
        const dest = effect.noMatchDestination ?? "top";
        if (dest === "bottom") {
          state = moveCard(state, topId, targetPlayer, "deck");
        } else if (dest === "hand") {
          state = moveCard(state, topId, targetPlayer, "hand");
        } else if (dest === "discard") {
          state = zoneTransition(state, topId, "discard", definitions, events, { reason: "discarded" });
        }
        // else "top": stays where it is — already on top.
        return state;
      }
      // repeatOnMatch: continue the loop with the new top card.
      if (!effect.repeatOnMatch) return state;
      }
      return state;
    }

    case "put_on_bottom_of_deck": {
      // CRD: place card(s) on the bottom of a deck without shuffling.
      // See PutOnBottomOfDeckEffect docs for variants.
      const amount = effect.amount ?? 1;
      const ownerScope = effect.ownerScope ?? "self";
      const targetPlayer =
        ownerScope === "self" ? controllingPlayerId
        : ownerScope === "opponent" ? getOpponent(controllingPlayerId)
        : /* target_player — controller picks; engine picks opponent in 2P */ getOpponent(controllingPlayerId);

      if (effect.from === "play") {
        // Surface choose_target like return_to_hand. Each chosen instance moves
        // to the bottom of ITS OWN owner's deck.
        const target: CardTarget = effect.target ?? { type: "chosen", filter: { zone: "play", cardType: ["character"] } };
        if (target.type === "this") {
          const inst = state.cards[sourceInstanceId];
          if (!inst) return state;
          return moveCard(state, sourceInstanceId, inst.ownerId, "deck", "bottom");
        }
        if (target.type === "chosen") {
          const validTargets = findValidTargets(state, target.filter, controllingPlayerId, definitions, sourceInstanceId);
          if (validTargets.length === 0) return state;
          return {
            ...state,
            pendingChoice: {
              type: "choose_target",
              choosingPlayerId: controllingPlayerId,
              prompt: "Choose a card to put on the bottom of its owner's deck.",
              validTargets,
              pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
              optional: effect.isMay ?? false,
            },
          };
        }
        return state;
      }

      // from: "hand" | "discard" — auto-pick eligible cards from the source zone
      // (bot simplification — no pendingChoice surfaced for which card to pick).
      const sourceZone: ZoneName = effect.from;
      let pool = getZone(state, targetPlayer, sourceZone);
      if (effect.filter) {
        pool = pool.filter((cardId) => {
          const inst = state.cards[cardId];
          const def = inst ? definitions[inst.definitionId] : undefined;
          return inst && def ? matchesFilter(inst, def, effect.filter!, state, targetPlayer) : false;
        });
      }
      // Surface a choose_target when target.type === "chosen" so a follow-up
      // step can read the picked card via state.lastResolvedTarget. Used by
      // Anna Soothing Sister WARM HEART (gain lore equal to chosen discard
      // char's L, then bottom-deck it).
      if (effect.target && effect.target.type === "chosen" && pool.length > 0) {
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card to put on the bottom of its deck.",
            validTargets: pool,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      if (pool.length === 0) return state; // CRD 1.7.7
      const moveCount = Math.min(amount, pool.length);
      let moved = 0;
      for (let i = 0; i < moveCount; i++) {
        const cardId = pool[i]!;
        state = moveCard(state, cardId, targetPlayer, "deck", "bottom");
        moved++;
      }
      // CRD 6.1.5.1: store count for "for each card moved this way" patterns
      state = { ...state, lastEffectResult: moved };
      return state;
    }

    case "return_all_to_bottom_in_order": {
      // Find all matching cards. The controller picks the order they go to
      // the bottom of their respective owners' decks. Used by Under the Sea.
      const targets = findValidTargets(state, effect.filter, controllingPlayerId, definitions, sourceInstanceId);
      if (targets.length === 0) return state;
      if (targets.length === 1) {
        const id = targets[0]!;
        const inst = state.cards[id];
        if (!inst) return state;
        return moveCard(state, id, inst.ownerId, "deck");
      }
      // 2+ — surface choose_order for the controller. The choose_order resolver
      // routes each chosen id to its OWN owner's deck.
      return {
        ...state,
        pendingChoice: {
          type: "choose_order",
          choosingPlayerId: controllingPlayerId,
          prompt: `Choose the order to place ${targets.length} cards on the bottom of their players' decks (first selected = bottommost).`,
          validTargets: targets,
        },
      };
    }

    case "grant_cost_reduction": {
      // Add a one-shot CostReductionEntry to the controlling player. The next
      // card played that matches `filter` will have its cost reduced by `amount`.
      const player = state.players[controllingPlayerId];
      const existing = player.costReductions ?? [];
      return {
        ...state,
        players: {
          ...state.players,
          [controllingPlayerId]: {
            ...player,
            costReductions: [...existing, { amount: effect.amount, filter: effect.filter }],
          },
        },
      };
    }

    case "move_damage": {
      // CRD 1.9.1.4: two-stage chosen flow (source → destination).
      // "all_damaged" branch (Everybody's Got a Weakness): loop over each
      // matching damaged source moving `amount` counters to the chosen
      // destination, then surface a single choose_target for the destination.
      if (effect.source.type === "all_damaged") {
        const damagedFilter = { ...effect.source.filter, hasDamage: true };
        const sources = findValidTargets(state, damagedFilter, controllingPlayerId, definitions, sourceInstanceId);
        if (sources.length === 0) {
          state = { ...state, lastEffectResult: 0 };
          // Still surface the destination prompt — the wording moves any
          // available damage; if there is none, the reward (draw cost_result)
          // resolves to 0 and the effect fizzles cleanly.
        }
        const validDestinations = findValidTargets(state, effect.destination.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validDestinations.length === 0) {
          state = { ...state, lastEffectResult: 0 };
          return state;
        }
        // Stash the resolved-source list on the cloned effect so the destination
        // resolution path can drain damage from each source.
        const resolvedSources = sources
          .map((id) => makeResolvedRef(state, definitions, id))
          .filter((r): r is ResolvedRef => !!r);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to move damage to.",
            validTargets: validDestinations,
            pendingEffect: { ...effect, _resolvedSources: resolvedSources } as any,
            sourceInstanceId,
            triggeringCardInstanceId,
          },
        };
      }
      // Stage 1: pick source character (must currently have damage; isUpTo
      // doesn't apply at filter time — we let any matching char be picked).
      const sourceFilter = { ...effect.source.filter, hasDamage: true };
      const validSources = findValidTargets(state, sourceFilter, controllingPlayerId, definitions, sourceInstanceId);
      if (validSources.length === 0) return state; // CRD 1.7.7
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose a character to move damage from.",
          validTargets: validSources,
          pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
        },
      };
    }

    case "put_top_of_deck_under": {
      // CRD 8.4.2: Move the top card of the controller's deck under a target.
      // target: "this" → the source instance. "chosen" → player picks an
      // eligible in-play card (typically "one of your characters or locations
      // with Boost"). The chosen path surfaces a choose_target pendingChoice
      // and is resolved later in applyEffectToTarget.
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card to put the top card of your deck under.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      // target: "this" — move the top card of the source's owner's deck under the source.
      // Same mutation as BOOST_CARD's pay-N path, just without the cost.
      const sourceInst = state.cards[sourceInstanceId];
      if (!sourceInst) return state;
      const owner = sourceInst.ownerId;
      const deck = getZone(state, owner, "deck");
      const topId = deck[0];
      if (!topId) return state;
      const topInst = state.cards[topId];
      if (!topInst) return state;
      state = {
        ...state,
        cards: {
          ...state.cards,
          [topId]: { ...topInst, zone: "under" },
          [sourceInstanceId]: {
            ...sourceInst,
            cardsUnder: [...sourceInst.cardsUnder, topId],
            cardsPutUnderThisTurn: (sourceInst.cardsPutUnderThisTurn ?? 0) + 1,
          },
        },
        zones: {
          ...state.zones,
          [owner]: {
            ...state.zones[owner],
            deck: state.zones[owner].deck.filter(id => id !== topId),
          },
        },
      };
      // CRD 8.4.2: emit card_put_under trigger (same as Boost keyword path).
      state = queueTrigger(state, "card_put_under", sourceInstanceId, definitions, {
        triggeringPlayerId: controllingPlayerId,
        triggeringCardInstanceId: topId,
      });
      return state;
    }

    case "put_cards_under_into_hand": {
      // Drain the source's cardsUnder pile into hand. Each card moves from
      // its current zone (logically "under") to its OWNER's hand.
      const inst = state.cards[sourceInstanceId];
      if (!inst || inst.cardsUnder.length === 0) return state;
      const undersToMove = [...inst.cardsUnder];
      for (const id of undersToMove) {
        const u = state.cards[id];
        if (!u) continue;
        // Move directly: under cards aren't in any zone array, so just append to hand.
        state = {
          ...state,
          cards: {
            ...state.cards,
            [id]: { ...u, zone: "hand" },
          },
          zones: {
            ...state.zones,
            [u.ownerId]: {
              ...state.zones[u.ownerId],
              hand: [...state.zones[u.ownerId].hand, id],
            },
          },
        };
      }
      // Clear the parent's cardsUnder pile.
      state = updateInstance(state, sourceInstanceId, { cardsUnder: [] });
      return state;
    }

    case "move_cards_under_to_inkwell": {
      // CRD 8.4.2 / 8.10.5: Visiting Christmas Past — "Put any number of cards
      // from under your characters and locations into your inkwell facedown
      // and exerted." Headless bot takes all (maximal choice). For each card
      // in the controller's in-play zone, move its entire cardsUnder pile to
      // the controller's inkwell exerted; clear each parent's cardsUnder.
      const play = getZone(state, controllingPlayerId, "play");
      for (const parentId of [...play]) {
        const parent = state.cards[parentId];
        if (!parent || parent.cardsUnder.length === 0) continue;
        const undersToMove = [...parent.cardsUnder];
        for (const id of undersToMove) {
          const u = state.cards[id];
          if (!u) continue;
          state = {
            ...state,
            cards: {
              ...state.cards,
              [id]: { ...u, zone: "inkwell", isExerted: true },
            },
            zones: {
              ...state.zones,
              [controllingPlayerId]: {
                ...state.zones[controllingPlayerId],
                inkwell: [...state.zones[controllingPlayerId].inkwell, id],
              },
            },
          };
        }
        state = updateInstance(state, parentId, { cardsUnder: [] });
      }
      return state;
    }

    case "conditional_on_last_discarded": {
      // CRD 6.1.5.1: Apply `then` if any card in state.lastDiscarded matches
      // the filter, else `otherwise`. Used by Kakamora Pirate Chief.
      const refs = state.lastDiscarded ?? [];
      let matched = false;
      for (const ref of refs) {
        const inst = state.cards[ref.instanceId];
        const def = inst ? definitions[inst.definitionId] : undefined;
        if (!inst || !def) continue;
        if (matchesFilter(inst, def, effect.filter, state, controllingPlayerId, sourceInstanceId)) {
          matched = true;
          break;
        }
      }
      const branch = matched ? effect.then : (effect.otherwise ?? []);
      for (const sub of branch) {
        state = applyEffect(state, sub, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        if (state.pendingChoice) return state;
      }
      return state;
    }

    case "move_all_matching_to_inkwell": {
      // CRD 8.10.5: Perdita - Determined Mother — "Put all Puppy character
      // cards from your discard into your inkwell facedown and exerted."
      // Mass move every matching card from controller's discard to inkwell
      // exerted. Bypasses inkable check (cards enter facedown).
      const discard = getZone(state, controllingPlayerId, "discard");
      for (const cid of [...discard]) {
        const inst = state.cards[cid];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (!def) continue;
        if (!matchesFilter(inst, def, effect.filter, state, controllingPlayerId, sourceInstanceId)) continue;
        state = zoneTransition(state, cid, "inkwell", definitions, events, { reason: "inked" });
        state = updateInstance(state, cid, { isExerted: true });
      }
      return state;
    }

    case "put_self_under_target": {
      // CRD 8.4.2: Roo - Little Helper HOPPING IN ("Put this character facedown
      // under one of your characters or locations with Boost"). Surfaces a
      // choose_target on controller's in-play matching cards; resolution path
      // removes the source from play and appends it to the target's cardsUnder.
      const validTargets = findValidTargets(state, effect.filter, controllingPlayerId, definitions, sourceInstanceId);
      if (validTargets.length === 0) return state;
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose a card to put this character under.",
          validTargets,
          pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          optional: effect.isMay ?? false,
        },
      };
    }

    case "name_a_card_then_reveal": {
      // The Sorcerer's Hat / ABRACADABRA: name a card, reveal top of deck, put it
      // in hand on a match (else leave on top — no-op).
      if (state.interactive) {
        return {
          ...state,
          pendingChoice: {
            type: "choose_card_name",
            choosingPlayerId: controllingPlayerId,
            prompt: "Name a card",
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      // Non-interactive (bot): peek the top card and "name" it correctly. The bot
      // is essentially clairvoyant for this effect — acceptable for analytics sims.
      const deckNonInt = getZone(state, controllingPlayerId, "deck");
      const topIdNonInt = deckNonInt[0];
      if (!topIdNonInt) return state;
      return moveCard(state, topIdNonInt, controllingPlayerId, "hand");
    }

    case "move_character": {
      // Special path: character "all" + location "chosen" — surface a single
      // choose_target for the LOCATION, then move every matching character to
      // it on resolution. Records the moved count on lastEffectResult so a
      // follow-up gain_lore can pay per-character (Moana Kakamora Leader).
      if (effect.character.type === "all") {
        if (effect.location.type !== "chosen") return state;
        const validLocations = findValidTargets(state, effect.location.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validLocations.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a location to move your characters to.",
            validTargets: validLocations,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      // Resolve the character side first.
      let characterId: string | undefined;
      if (effect.character.type === "this") {
        characterId = sourceInstanceId;
      } else if (effect.character.type === "triggering_card") {
        characterId = triggeringCardInstanceId;
      } else if (effect.character.type === "last_resolved_target") {
        // Tuk Tuk Lively Partner sequential reward: move the character that the
        // previous step targeted (modify_stat sets state.lastResolvedTarget).
        characterId = state.lastResolvedTarget?.instanceId;
      } else if (effect.character.type === "chosen") {
        // Stage 1: present a choice for the character. The chosen-character then drives
        // stage 2 via applyEffectToTarget(move_character).
        const validTargets = findValidTargets(state, effect.character.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to move.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      if (!characterId) return state;

      // Resolve the location side.
      if (effect.location.type === "triggering_card") {
        if (!triggeringCardInstanceId) return state;
        return performMove(state, characterId, triggeringCardInstanceId, definitions, events);
      }
      if (effect.location.type === "last_resolved_target") {
        // Tuk Tuk Lively Partner: a previous step in the same sequential
        // already chose the location (move_character chosen+chosen sets
        // lastResolvedTarget to the location at stage-2 resolution). Reuse
        // it so the second move lands on the SAME location.
        const locId = state.lastResolvedTarget?.instanceId;
        if (!locId) return state;
        return performMove(state, characterId, locId, definitions, events);
      }
      if (effect.location.type === "chosen") {
        // Edge case: character is "this"/"triggering_card" but location is "chosen".
        const validLocations = findValidTargets(state, effect.location.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validLocations.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a location to move to.",
            validTargets: validLocations,
            // Stash the resolved character on a clone of the effect for stage 2.
            pendingEffect: { ...effect, _resolvedCharacter: makeResolvedRef(state, definitions, characterId) },
            optional: effect.isMay ?? false,
          },
        };
      }
      return state;
    }

    case "gain_conditional_challenge_bonus": {
      // CRD 6.1.4 / 8.5.1-style: add a turn-scoped conditional challenge bonus
      // for the controlling player. Applied in performChallenge against matching defenders.
      const player = state.players[controllingPlayerId];
      const existing = player.turnChallengeBonuses ?? [];
      return {
        ...state,
        players: {
          ...state.players,
          [controllingPlayerId]: {
            ...player,
            turnChallengeBonuses: [...existing, { strength: effect.strength, defenderFilter: effect.defenderFilter }],
          },
        },
      };
    }

    case "exert": {
      if (effect.target.type === "this") {
        return exertInstance(state, sourceInstanceId, definitions);
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const inst = state.cards[triggeringCardInstanceId];
        if (inst && !inst.isExerted) {
          return exertInstance(state, triggeringCardInstanceId, definitions);
        }
        return state;
      }
      if (effect.target.type === "chosen") {
        const choosingPlayerId = chosenChooserPlayerId(effect.target, controllingPlayerId);
        const validTargets = findValidTargets(state, effect.target.filter, choosingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        const count = effect.target.count ?? 1;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId,
            prompt: count > 1 ? `Choose up to ${count} characters to exert.` : "Choose a character to exert.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            followUpEffects: effect.followUpEffects,
            optional: effect.isUpTo ?? false,
            count,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = exertInstance(state, targetId, definitions);
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
        // Caster anchor for "until your next turn" durations (until_caster_next_turn).
        // Harmless to set unconditionally — only consulted when expiresAt matches.
        casterPlayerId: controllingPlayerId,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "last_resolved_target") {
        const id = state.lastResolvedTarget?.instanceId;
        if (!id || !state.cards[id]) return state;
        return addTimedEffect(state, id, timedEffect);
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        return addTimedEffect(state, triggeringCardInstanceId, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: `Choose a character to grant ${effect.keyword}.`,
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
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
      // Note: effect-driven ready does NOT honor the "ready" restriction.
      // Lorcana's "can't ready" wording is uniformly narrow ("at the start of
      // your turn") — Shield of Virtue and other active ready effects override
      // it. The ready loop in applyPassTurn enforces the narrow check.
      // If a future card needs broad "can't be readied period" semantics, add
      // a new RestrictedAction value (e.g. "ready_anywhere") and check it here.
      if (effect.target.type === "this") {
        const wasExerted = getInstance(state, sourceInstanceId).isExerted;
        state = updateInstance(state, sourceInstanceId, { isExerted: false });
        if (wasExerted) {
          state = queueTrigger(state, "readied", sourceInstanceId, definitions, {});
        }
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
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to ready.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            followUpEffects: effect.followUpEffects,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          const wasExerted = getInstance(state, targetId).isExerted;
          state = updateInstance(state, targetId, { isExerted: false });
          if (wasExerted) {
            state = queueTrigger(state, "readied", targetId, definitions, {});
          }
          if (effect.followUpEffects) {
            for (const followUp of effect.followUpEffects) {
              state = applyEffectToTarget(state, followUp, targetId, controllingPlayerId, definitions, events);
            }
          }
        }
        return state;
      }
      // Alma Madrigal Accepting Grandmother: ready the singing character (the
      // triggering card on a sings trigger).
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        const inst = state.cards[triggeringCardInstanceId];
        if (!inst) return state;
        const wasExerted = inst.isExerted;
        state = updateInstance(state, triggeringCardInstanceId, { isExerted: false });
        if (wasExerted) {
          state = queueTrigger(state, "readied", triggeringCardInstanceId, definitions, {});
        }
        return state;
      }
      return state;
    }

    case "must_quest_if_able": {
      const timedEffect: TimedEffect = {
        type: "must_quest_if_able",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "last_resolved_target") {
        const id = state.lastResolvedTarget?.instanceId;
        if (!id || !state.cards[id]) return state;
        return addTimedEffect(state, id, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: `Choose a character that must quest if able.`,
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
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

    case "cant_action": {
      const timedEffect: TimedEffect = {
        type: "cant_action",
        action: effect.action,
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: `Choose a character that can't ${effect.action}.`,
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
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
      const rawCount = typeof effect.count === "number"
        ? effect.count
        : resolveDynamicAmount(effect.count, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, undefined);
      const lookCount = Math.min(rawCount, deck.length);
      if (lookCount === 0) return state;

      const topCards = deck.slice(0, lookCount);

      switch (effect.action) {
        case "one_to_hand_rest_bottom": {
          if (effect.filter && !state.interactive) {
            // Headless/bot mode: auto-resolve — find first card that matches
            const chosenIdx = topCards.findIndex((id) => {
              const inst = state.cards[id];
              if (!inst) return false;
              const def = definitions[inst.definitionId];
              if (!def) return false;
              return matchesFilter(inst, def, effect.filter!, state, controllingPlayerId);
            });
            if (chosenIdx === -1) {
              // No match — put all on bottom (may pattern = don't take any)
              state = reorderDeckTopToBottom(state, targetPlayer, topCards, []);
              return state;
            }
            const chosenId = topCards[chosenIdx]!;
            const rest = topCards.filter((_, i) => i !== chosenIdx);
            state = moveCard(state, chosenId, targetPlayer, "hand");
            state = reorderDeckTopToBottom(state, targetPlayer, rest, []);
            return state;
          }
          if (effect.filter && state.interactive) {
            // Interactive mode: show filtered cards and let human choose
            const matchingCards = topCards.filter((id) => {
              const inst = state.cards[id];
              if (!inst) return false;
              const def = definitions[inst.definitionId];
              if (!def) return false;
              return matchesFilter(inst, def, effect.filter!, state, controllingPlayerId);
            });
            if (matchingCards.length === 0) {
              // No valid cards — show all revealed cards so human can see what was looked at,
              // then auto-send rest to bottom when they dismiss (optional with empty validTargets)
              return {
                ...state,
                pendingChoice: {
                  type: "choose_from_revealed",
                  choosingPlayerId: controllingPlayerId,
                  prompt: `No matching cards found. All revealed cards go to the bottom of your deck.`,
                  validTargets: [],
                  revealedCards: topCards,
                  pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
                  optional: true,
                },
              };
            }
            return {
              ...state,
              pendingChoice: {
                type: "choose_from_revealed",
                choosingPlayerId: controllingPlayerId,
                prompt: `Choose a card to put into your hand. The rest go to the bottom of your deck.`,
                validTargets: matchingCards,
                revealedCards: topCards,
                pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
                optional: true,
              },
            };
          }

          // No filter: let the bot choose which card to keep
          if (topCards.length <= 1) {
            // Only 1 card — no choice needed
            if (topCards.length === 1) {
              state = moveCard(state, topCards[0]!, targetPlayer, "hand");
            }
            return state;
          }
          return {
            ...state,
            pendingChoice: {
              type: "choose_from_revealed",
              choosingPlayerId: controllingPlayerId,
              prompt: `Choose 1 of ${topCards.length} revealed cards to put into your hand. The rest go to the bottom of your deck.`,
              validTargets: topCards,
              pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            },
          };
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
        case "one_to_play_for_free_rest_bottom": {
          // Powerline World's Greatest Rock Star: look at top N, may reveal
          // a matching card and play it for free, rest to bottom in any order.
          // Headless heuristic: pick the first matching card and play it.
          const matchIdx = effect.filter
            ? topCards.findIndex((id) => {
                const inst = state.cards[id];
                if (!inst) return false;
                const def = definitions[inst.definitionId];
                if (!def) return false;
                return matchesFilter(inst, def, effect.filter!, state, controllingPlayerId);
              })
            : -1;
          if (matchIdx === -1) {
            state = reorderDeckTopToBottom(state, targetPlayer, topCards, []);
            return state;
          }
          const playId = topCards[matchIdx]!;
          const rest = topCards.filter((_, i) => i !== matchIdx);
          const playInst = state.cards[playId];
          const playDef = playInst ? definitions[playInst.definitionId] : undefined;
          if (playInst && playDef) {
            state = zoneTransition(state, playId, "play", definitions, events, {
              reason: "played", triggeringPlayerId: targetPlayer,
            });
            if (playDef.cardType === "character") {
              state = updateInstance(state, playId, { isDrying: true });
            }
            if (playDef.cardType === "action" && playDef.actionEffects) {
              for (const ae of playDef.actionEffects) {
                state = applyEffect(state, ae, playId, targetPlayer, definitions, events);
              }
              state = zoneTransition(state, playId, "discard", definitions, events, { reason: "discarded" });
            }
          }
          state = reorderDeckTopToBottom(state, targetPlayer, rest, []);
          return state;
        }
        case "one_to_inkwell_exerted_rest_top": {
          // Kida Creative Thinker: look at top 2, put 1 into inkwell facedown
          // exerted, the other on top. Headless heuristic: ink the FIRST card
          // and leave the rest on top in their original order.
          if (topCards.length === 0) return state;
          const inkId = topCards[0]!;
          state = zoneTransition(state, inkId, "inkwell", definitions, events, { reason: "inked" });
          state = updateInstance(state, inkId, { isExerted: true });
          // Other cards stay where they are (still on top of deck after the inked one is removed).
          return state;
        }
        case "up_to_n_to_hand_rest_bottom": {
          // Look at top N, put up to maxToHand cards into hand, rest go to
          // top|bottom (default bottom). Headless/bot: greedy — first match.
          //
          // Three filter modes:
          //   1. effect.filters (array): pick at most one card matching each
          //      filter in order. Used by The Family Madrigal (1 Madrigal char
          //      + 1 Song).
          //   2. effect.filter (single): pick first up to maxToHand matching.
          //   3. neither: pick first maxToHand cards unconditionally
          //      (Dig a Little Deeper).
          const maxToHand = effect.maxToHand ?? 1;
          const picked: string[] = [];
          const rest: string[] = [];
          if (effect.filters && effect.filters.length > 0) {
            const filtersConsumed = new Array(effect.filters.length).fill(false);
            for (const id of topCards) {
              if (picked.length >= maxToHand) {
                rest.push(id);
                continue;
              }
              const inst = state.cards[id];
              const def = inst ? definitions[inst.definitionId] : undefined;
              if (!inst || !def) {
                rest.push(id);
                continue;
              }
              let matchedSlot = -1;
              for (let i = 0; i < effect.filters.length; i++) {
                if (filtersConsumed[i]) continue;
                if (matchesFilter(inst, def, effect.filters[i]!, state, controllingPlayerId)) {
                  matchedSlot = i;
                  break;
                }
              }
              if (matchedSlot >= 0) {
                filtersConsumed[matchedSlot] = true;
                picked.push(id);
              } else {
                rest.push(id);
              }
            }
          } else {
            for (const id of topCards) {
              if (picked.length >= maxToHand) {
                rest.push(id);
                continue;
              }
              if (effect.filter) {
                const inst = state.cards[id];
                const def = inst ? definitions[inst.definitionId] : undefined;
                if (!inst || !def || !matchesFilter(inst, def, effect.filter, state, controllingPlayerId)) {
                  rest.push(id);
                  continue;
                }
              }
              picked.push(id);
            }
          }
          for (const id of picked) {
            state = moveCard(state, id, targetPlayer, "hand");
          }
          // restPlacement default "bottom". For "top" the cards remain in
          // place after the picked ones are removed via moveCard, so no
          // reorder is needed.
          if ((effect.restPlacement ?? "bottom") === "bottom") {
            state = reorderDeckTopToBottom(state, targetPlayer, rest, []);
          }
          return state;
        }
        case "one_to_play_for_free_else_to_hand": {
          // We Know the Way: look at top 1, if it matches filter may play for
          // free, otherwise put it into the controller's hand.
          if (topCards.length === 0) return state;
          const topId = topCards[0]!;
          const topInst = state.cards[topId];
          const topDef = topInst ? definitions[topInst.definitionId] : undefined;
          if (!topInst || !topDef) return state;
          const matches = effect.filter
            ? matchesFilter(topInst, topDef, effect.filter, state, controllingPlayerId)
            : true;
          if (matches) {
            // Play it for free.
            state = zoneTransition(state, topId, "play", definitions, events, {
              reason: "played", triggeringPlayerId: targetPlayer,
            });
            if (topDef.cardType === "character") {
              state = updateInstance(state, topId, { isDrying: true });
            }
            if (topDef.cardType === "action" && topDef.actionEffects) {
              for (const ae of topDef.actionEffects) {
                state = applyEffect(state, ae, topId, targetPlayer, definitions, events);
              }
              state = zoneTransition(state, topId, "discard", definitions, events, { reason: "discarded" });
            }
          } else {
            state = moveCard(state, topId, targetPlayer, "hand");
          }
          return state;
        }
        case "may_play_for_free_else_discard": {
          // Kristoff's Lute MOMENT OF INSPIRATION: reveal top, may play it for
          // free, otherwise put it into discard. count is implicitly 1.
          //
          // Per CRD: "play it as if it were in your hand" — the controller pays
          // the card's normal ink cost. Bot heuristic: pay if you can afford it
          // (and the card type is playable from this path), otherwise discard.
          if (topCards.length === 0) return state;
          const topId = topCards[0]!;
          const topInst = state.cards[topId];
          const topDef = topInst ? definitions[topInst.definitionId] : undefined;
          if (!topInst || !topDef) return state;
          // Use the same effective-cost helper as the standard play action so
          // static + one-shot cost reductions (Mickey Broom, Grandmother Willow,
          // Olaf Snowman of Action, etc.) apply to the revealed-card play.
          const cardCost = getEffectiveCostWithReductions(state, targetPlayer, topId, definitions);
          const canAfford = state.players[targetPlayer].availableInk >= cardCost;
          if (!canAfford) {
            // Decline -> discard the revealed card.
            state = moveCard(state, topId, targetPlayer, "discard");
            return state;
          }
          // Pay normal cost and play.
          state = updatePlayerInk(state, targetPlayer, -cardCost);
          state = zoneTransition(state, topId, "play", definitions, events, {
            reason: "played", triggeringPlayerId: targetPlayer,
          });
          if (topDef.cardType === "character") {
            state = updateInstance(state, topId, { isDrying: true });
          }
          if (topDef.cardType === "action" && topDef.actionEffects) {
            for (const ae of topDef.actionEffects) {
              state = applyEffect(state, ae, topId, targetPlayer, definitions, events);
            }
            state = zoneTransition(state, topId, "discard", definitions, events, { reason: "discarded" });
          }
          return state;
        }
        case "reveal_until_match_to_hand_shuffle_rest": {
          // Fred Giant-Sized I LIKE WHERE THIS IS HEADING: reveal cards from
          // the top of the deck until you reveal a matching card. Put that
          // card into hand and shuffle the rest of the revealed (non-matching)
          // cards back into the deck.
          if (!effect.filter) return state;
          const fullDeck = getZone(state, targetPlayer, "deck");
          let matchIdx = -1;
          for (let i = 0; i < fullDeck.length; i++) {
            const id = fullDeck[i]!;
            const inst = state.cards[id];
            if (!inst) continue;
            const def = definitions[inst.definitionId];
            if (!def) continue;
            if (matchesFilter(inst, def, effect.filter, state, controllingPlayerId)) {
              matchIdx = i;
              break;
            }
          }
          if (matchIdx === -1) {
            // No match — entire deck was revealed; shuffle deck (no card to hand).
            const shuffled = [...fullDeck];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const r = rngNextInt(state, i + 1);
              const tmp = shuffled[i]!; shuffled[i] = shuffled[r]!; shuffled[r] = tmp;
            }
            return {
              ...state,
              zones: {
                ...state.zones,
                [targetPlayer]: { ...state.zones[targetPlayer], deck: shuffled },
              },
            };
          }
          const matchId = fullDeck[matchIdx]!;
          const revealedNonMatch = fullDeck.slice(0, matchIdx);
          const remaining = fullDeck.slice(matchIdx + 1);
          state = moveCard(state, matchId, targetPlayer, "hand");
          // Shuffle revealedNonMatch back into the remaining deck.
          const merged = [...remaining, ...revealedNonMatch];
          for (let i = merged.length - 1; i > 0; i--) {
            const r = rngNextInt(state, i + 1);
            const tmp = merged[i]!; merged[i] = merged[r]!; merged[r] = tmp;
          }
          return {
            ...state,
            zones: {
              ...state.zones,
              [targetPlayer]: { ...state.zones[targetPlayer], deck: merged },
            },
          };
        }
        default:
          return state;
      }
    }

    case "mill": {
      // CRD: "Put the top N cards of <player>'s deck into their discard."
      // Each milled card fires `cards_discarded` triggers via the standard
      // moveCard → zone transition path.
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, undefined);
      if (amount <= 0) return state;
      const players: PlayerID[] = [];
      if (effect.target.type === "self") players.push(controllingPlayerId);
      else if (effect.target.type === "opponent") players.push(getOpponent(controllingPlayerId));
      else if (effect.target.type === "both") players.push("player1", "player2");
      else players.push(controllingPlayerId);
      for (const pid of players) {
        const deck = getZone(state, pid, "deck");
        const millCount = Math.min(amount, deck.length);
        if (millCount === 0) continue;
        const topIds = deck.slice(0, millCount);
        for (const id of topIds) {
          state = moveCard(state, id, pid, "discard");
        }
        state = { ...state, lastEffectResult: millCount };
        state = queueTriggersByEvent(state, "cards_discarded", pid, definitions, {});
      }
      return state;
    }

    case "mass_inkwell": {
      // Mufasa - Ruler of Pride Rock + Ink Geyser. Operates over the inkwell zone.
      // CRD 4.5: availableInk reflects the count of unexerted inkwell cards.
      const players: PlayerID[] = [];
      if (effect.target.type === "self") players.push(controllingPlayerId);
      else if (effect.target.type === "opponent") players.push(getOpponent(controllingPlayerId));
      else if (effect.target.type === "both") players.push("player1", "player2");
      else players.push(controllingPlayerId);

      for (const pid of players) {
        const inkwellIds = getZone(state, pid, "inkwell");
        if (effect.mode === "exert_all") {
          for (const id of inkwellIds) {
            state = updateInstance(state, id, { isExerted: true });
          }
          state = { ...state, players: { ...state.players, [pid]: { ...state.players[pid], availableInk: 0 } } };
        } else if (effect.mode === "ready_all") {
          for (const id of inkwellIds) {
            state = updateInstance(state, id, { isExerted: false });
          }
          state = { ...state, players: { ...state.players, [pid]: { ...state.players[pid], availableInk: inkwellIds.length } } };
        } else if (effect.mode === "return_random_to_hand") {
          const n = Math.min(effect.amount ?? 0, inkwellIds.length);
          const pool = [...inkwellIds];
          for (let i = 0; i < n && pool.length > 0; i++) {
            const idx = rngNextInt(state.rng, pool.length);
            const id = pool[idx]!;
            pool.splice(idx, 1);
            state = moveCard(state, id, pid, "hand");
          }
          // Recount availableInk based on remaining unexerted inkwell cards.
          const remaining = getZone(state, pid, "inkwell")
            .filter((id) => !state.cards[id]?.isExerted).length;
          state = { ...state, players: { ...state.players, [pid]: { ...state.players[pid], availableInk: remaining } } };
        } else if (effect.mode === "return_random_until") {
          const target = effect.untilCount ?? 0;
          // Re-read inkwell because earlier sequential effects may have changed it.
          let pool = getZone(state, pid, "inkwell").slice();
          while (pool.length > target) {
            const idx = rngNextInt(state.rng, pool.length);
            const id = pool[idx]!;
            pool.splice(idx, 1);
            state = moveCard(state, id, pid, "hand");
          }
          const remaining = getZone(state, pid, "inkwell")
            .filter((id) => !state.cards[id]?.isExerted).length;
          state = { ...state, players: { ...state.players, [pid]: { ...state.players[pid], availableInk: remaining } } };
        }
      }
      return state;
    }

    case "fill_hand_to": {
      // Goliath - Clan Leader: normalize each affected player's hand to `n`.
      // Discard down or draw up depending on current hand size.
      const affected: PlayerID[] = [];
      if (effect.target.type === "self") affected.push(controllingPlayerId);
      else if (effect.target.type === "opponent") affected.push(getOpponent(controllingPlayerId));
      else if (effect.target.type === "both") affected.push("player1", "player2");
      else affected.push(controllingPlayerId);

      for (const pid of affected) {
        const handSize = getZone(state, pid, "hand").length;
        if (handSize > effect.n) {
          const discardCount = handSize - effect.n;
          state = applyEffect(
            state,
            { type: "discard_from_hand", target: { type: "self" }, amount: discardCount, chooser: "target_player" } as Effect,
            sourceInstanceId,
            pid,
            definitions,
            events,
            triggeringCardInstanceId,
          );
          if (state.pendingChoice) return state;
        } else if (handSize < effect.n && !effect.trimOnly) {
          const drawCount = effect.n - handSize;
          state = applyDraw(state, pid, drawCount, events, definitions);
        }
      }
      return state;
    }

    case "grant_activated_ability_timed": {
      // Food Fight! et al — push a turn-scoped grant onto the controller.
      const existing = state.players[controllingPlayerId].timedGrantedActivatedAbilities ?? [];
      return {
        ...state,
        players: {
          ...state.players,
          [controllingPlayerId]: {
            ...state.players[controllingPlayerId],
            timedGrantedActivatedAbilities: [...existing, { filter: effect.filter, ability: effect.ability }],
          },
        },
      };
    }

    case "player_may_play_from_hand": {
      // The Return of Hercules: surface a may → choose-from-hand by filter
      // → play_for_free, for the specified player. The wiring uses two
      // instances (self + opponent) for "each player".
      const targetPlayer = effect.player.type === "opponent"
        ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      const hand = getZone(state, targetPlayer, "hand");
      const eligible = hand.filter((id) => {
        const inst = state.cards[id];
        const d = inst ? definitions[inst.definitionId] : undefined;
        return inst && d && matchesFilter(inst, d, effect.filter, state, targetPlayer);
      });
      if (eligible.length === 0) return state;
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: targetPlayer,
          prompt: "Choose a card from your hand to reveal and play for free.",
          validTargets: eligible,
          pendingEffect: {
            type: "play_for_free",
            sourceZone: "hand",
            target: { type: "triggering_card" },
          } as Effect,
          sourceInstanceId,
          triggeringCardInstanceId,
          optional: true,
        },
      };
    }

    case "conditional_on_player_state": {
      // Desperate Plan: branch on a player-state condition.
      const condMet = evaluateCondition(effect.condition, state, definitions, controllingPlayerId, sourceInstanceId);
      const branch = condMet ? effect.thenEffects : effect.elseEffects;
      for (const sub of branch) {
        state = applyEffect(state, sub, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        if (state.pendingChoice) return state;
      }
      return state;
    }

    case "chosen_opposing_may_bottom_or_reward": {
      // Hades - Looking for a Deal. Caster picks an opposing character; the
      // pendingChoice surfaces with the caster as chooser and a custom
      // rejectEffect on the resolution path. After the choice, the chosen
      // target's owner gets a may-prompt: accept = put_on_bottom (their card),
      // reject = caster fires rewardEffect.
      const validTargets = findValidTargets(state, effect.filter, controllingPlayerId, definitions, sourceInstanceId);
      if (validTargets.length === 0) return state;
      // Stash the rewardEffect on a custom pending shape: use sequential
      // wrapping with put_on_bottom_of_deck as cost (may, controlled by the
      // target's player) and the rewardEffect as the reject branch.
      // We use a meta marker on the pendingChoice to flag this special path.
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose an opposing character.",
          validTargets,
          pendingEffect: effect,
          sourceInstanceId,
          triggeringCardInstanceId,
        },
      };
    }

    case "choose_n_from_opponent_discard_to_bottom": {
      // The Queen - Jealous Beauty NO ORDINARY APPLE.
      // Atomic [A]→[B]: if the opponent has fewer than `count` cards in their
      // discard, the whole effect fizzles (no move, no lore). Otherwise pick
      // `count` cards (headless: first N), move them to the bottom of the
      // opponent's deck, and gain lore — bonus amount if any moved card
      // matches `bonusFilter`, else base. The conditional is evaluated DURING
      // resolution from the actual moved set, never as a post-bump.
      const opponentId = getOpponent(controllingPlayerId);
      const oppDiscard = getZone(state, opponentId, "discard");
      if (oppDiscard.length < effect.count) {
        // CRD 1.7.7: cost cannot be performed → entire effect skipped.
        return state;
      }
      // Headless heuristic: pick the first `count` cards from the opponent's
      // discard. Bot does not get to optimize for the bonus filter.
      const picked = oppDiscard.slice(0, effect.count);
      let bonusTriggered = false;
      for (const cid of picked) {
        const inst = state.cards[cid];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (def && matchesFilter(inst, def, effect.bonusFilter, state, controllingPlayerId, sourceInstanceId)) {
          bonusTriggered = true;
        }
        // Move to bottom of opponent's deck (their card → their deck).
        state = moveCard(state, cid, opponentId, "deck");
      }
      const loreAmount = bonusTriggered ? effect.gainLoreBonus : effect.gainLoreBase;
      return gainLore(state, controllingPlayerId, loreAmount, events, definitions);
    }

    case "opponent_chooses_yes_or_no": {
      // Do You Want to Build A Snowman? Surface a binary may-prompt on the
      // opponent. Accept (YES) → yesEffect with caster as controlling player.
      // Reject (NO) → noEffect with opponent as controlling player.
      const opponentId = getOpponent(controllingPlayerId);
      return {
        ...state,
        pendingChoice: {
          type: "choose_may",
          choosingPlayerId: opponentId,
          prompt: "YES!  or  NO!",
          pendingEffect: effect.yesEffect,
          optional: true,
          sourceInstanceId,
          triggeringCardInstanceId,
          // YES (accept) → yesEffect runs with caster as controlling player.
          acceptControllingPlayerId: controllingPlayerId,
          // NO (reject) → noEffect runs with opponent as controlling player.
          rejectEffect: effect.noEffect,
          rejectControllingPlayerId: opponentId,
        },
      };
    }

    case "each_opponent_may_discard_then_reward": {
      // Sign the Scroll, Ursula's Trickery. 2P-only implementation: a single
      // choose_may surfaced to the opponent. Decline (or empty hand) → reward.
      const opponentId = getOpponent(controllingPlayerId);
      const opponentHand = getZone(state, opponentId, "hand");
      // Empty-hand auto-decline → fire reward immediately. CRD 6.1.4 "may":
      // a player who can't perform the optional action is treated as having
      // declined.
      if (opponentHand.length === 0) {
        return applyEffect(state, effect.rewardEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
      }
      // When player2 (the opponent / choosing player) accepts the may, the
      // applyEffect call uses playerId=player2 as the controllingPlayer; "self"
      // resolves to player2's own hand, which is what we want.
      const discardEffect = {
        type: "discard_from_hand" as const,
        target: { type: "self" as const },
        amount: 1,
        chooser: "target_player" as const,
      };
      return {
        ...state,
        pendingChoice: {
          type: "choose_may",
          choosingPlayerId: opponentId,
          prompt: "Discard a card?",
          pendingEffect: discardEffect,
          optional: true,
          sourceInstanceId,
          triggeringCardInstanceId,
          rejectEffect: effect.rewardEffect,
          rejectControllingPlayerId: controllingPlayerId,
        },
      };
    }

    case "restrict_play": {
      // Pete - Games Referee, Keep the Ancient Ways: timed per-player play
      // restriction. Cleanup happens at the start of the caster's next turn
      // (PASS_TURN handles it via casterPlayerId).
      const affected: PlayerID[] = [];
      if (effect.affectedPlayer.type === "self") affected.push(controllingPlayerId);
      else if (effect.affectedPlayer.type === "opponent") affected.push(getOpponent(controllingPlayerId));
      else if (effect.affectedPlayer.type === "both") affected.push("player1", "player2");
      else affected.push(getOpponent(controllingPlayerId));

      const entry = {
        cardTypes: effect.cardTypes,
        casterPlayerId: controllingPlayerId,
        appliedOnTurn: state.turnNumber,
      };
      const playersUpdate: Record<string, import("../types/index.js").PlayerState> = {};
      for (const pid of affected) {
        const existing = state.players[pid].playRestrictions ?? [];
        playersUpdate[pid] = {
          ...state.players[pid],
          playRestrictions: [...existing, entry],
        };
      }
      return { ...state, players: { ...state.players, ...playersUpdate } };
    }

    case "discard_from_hand": {
      const players: PlayerID[] = [];
      if (effect.target.type === "self") players.push(controllingPlayerId);
      else if (effect.target.type === "opponent") players.push(getOpponent(controllingPlayerId));
      else if (effect.target.type === "both") players.push("player1", "player2");

      const discardMods = getGameModifiers(state, definitions);
      for (const pid of players) {
        // Magica De Spell Cruel Sorceress, Kronk Laid Back: shielded players
        // skip the discard entirely. CRD: "if an effect would cause you to
        // discard ... you don't discard."
        if (discardMods.preventDiscardFromHand.has(pid)) continue;
        let hand = getZone(state, pid, "hand");

        // CRD 1.7.7: if a filter is set, narrow the eligible hand cards.
        // Used by Ursula - Deceiver of All (songs), Bare Necessities / Mowgli (non-character).
        if (effect.filter) {
          hand = hand.filter((cardId) => {
            const inst = state.cards[cardId];
            const def = inst ? definitions[inst.definitionId] : undefined;
            return inst && def ? matchesFilter(inst, def, effect.filter!, state, pid) : false;
          });
          // Fizzle if no eligible cards.
          if (hand.length === 0) continue;
        }

        // "all" = discard entire hand (or entire filtered subset), no choice
        if (effect.amount === "all") {
          const discardCount = hand.length;
          for (const cardId of [...hand]) {
            state = moveCard(state, cardId, pid, "discard");
          }
          // Queue cards_discarded trigger (Prince John - Greediest of All).
          // Don't processTriggerStack inline — it interrupts the current action's
          // remaining effects (e.g. A Whole New World draws 7 after discarding).
          // Triggers will be processed after the action completes via the wrapping
          // applyAction → processTriggerStack at line 80.
          if (discardCount > 0) {
            state = { ...state, lastEffectResult: discardCount };
            state = queueTriggersByEvent(state, "cards_discarded", pid, definitions, {});
          }
          continue;
        }

        // "any" — variable count, surface choose_discard with maxCount.
        // (Geppetto Skilled Craftsman, Desperate Plan.)
        if (effect.amount === "any") {
          if (hand.length === 0) continue;
          const choosingPlayer = effect.chooser === "target_player" ? pid : controllingPlayerId;
          return {
            ...state,
            pendingChoice: {
              type: "choose_discard",
              choosingPlayerId: choosingPlayer,
              prompt: `Choose any number of card(s) to discard.`,
              validTargets: hand,
              maxCount: hand.length,
              pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            },
          };
        }

        const discardCount = Math.min(effect.amount, hand.length);
        if (discardCount === 0) continue;

        // Random chooser: pick uniformly at random from the eligible hand cards
        // (Bruno reveal, Lady Tremaine, Basil etc.). No pending choice — engine resolves.
        if (effect.chooser === "random") {
          const picked: string[] = [];
          const pool = [...hand];
          for (let i = 0; i < discardCount && pool.length > 0; i++) {
            const idx = rngNextInt(state.rng, pool.length);
            const id = pool[idx]!;
            picked.push(id);
            pool.splice(idx, 1);
            state = moveCard(state, id, pid, "discard");
          }
          state = { ...state, lastEffectResult: picked.length };
          if (picked.length > 0) {
            state = queueTriggersByEvent(state, "cards_discarded", pid, definitions, {});
          }
          continue;
        }

        // Create pending choice for the choosing player
        const choosingPlayer = effect.chooser === "target_player" ? pid : controllingPlayerId;
        return {
          ...state,
          pendingChoice: {
            type: "choose_discard",
            choosingPlayerId: choosingPlayer,
            prompt: `Choose ${discardCount} card(s) to discard.`,
            validTargets: hand,
            count: discardCount,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
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
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
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
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      return state;
    }

    case "play_for_free": {
      // Direct-target form (e.g. Ursula - Deceiver of All replays the song that
      // triggered the ability). Skip the choose-from-zone flow and apply directly.
      if (effect.target) {
        if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
          return applyEffectToTarget(state, effect, triggeringCardInstanceId, controllingPlayerId, definitions, events);
        }
        // Lilo Escape Artist: { type: "this" } plays the source instance itself.
        if (effect.target.type === "this") {
          return applyEffectToTarget(state, effect, sourceInstanceId, controllingPlayerId, definitions, events);
        }
        // Jafar High Sultan of Lorcana: "play THAT character for free" — read
        // the most recent lastDiscarded entry. Optional via isMay.
        if (effect.target.type === "from_last_discarded") {
          const ref = state.lastDiscarded?.[0];
          if (!ref) return state;
          const discardedInst = state.cards[ref.instanceId];
          if (!discardedInst || discardedInst.zone !== "discard") return state;
          return applyEffectToTarget(state, effect, ref.instanceId, controllingPlayerId, definitions, events);
        }
        // Other direct target shapes can be added as cards demand them.
        return state;
      }
      // Choose-from-zone form: filter the source zone (default hand) and present a choice.
      const sourceZone = effect.sourceZone ?? "hand";
      const filter = effect.filter;
      let sourceCards: string[];
      if (sourceZone === "under") {
        // Per-instance subzone: read cardsUnder from the source instance (default "self").
        // Currently only "self" is supported — other CardTarget shapes can be wired as needed.
        const parentInst = state.cards[sourceInstanceId];
        sourceCards = parentInst ? [...parentInst.cardsUnder] : [];
      } else {
        sourceCards = getZone(state, controllingPlayerId, sourceZone);
      }
      const validCards = sourceCards.filter((id) => {
        const inst = state.cards[id];
        if (!inst) return false;
        const def = definitions[inst.definitionId];
        if (!def) return false;
        return filter ? matchesFilter(inst, def, filter, state, controllingPlayerId, sourceInstanceId, definitions) : true;
      });
      if (validCards.length === 0) return state;
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: effect.cost === "normal" ? "Choose a card to play." : "Choose a card to play for free.",
          validTargets: validCards,
          pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
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
    // CRD 6.1.3: "choose one of" — present options to the controller
    case "choose": {
      if (state.interactive) {
        // Surface a choose_option pending choice for the human/UI
        return {
          ...state,
          pendingChoice: {
            type: "choose_option",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose one:",
            options: effect.options,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      // Non-interactive: bot picks option 0 by default and applies sub-effects
      const chosen = effect.options[0];
      if (!chosen) return state;
      for (const subEffect of chosen) {
        state = applyEffect(state, subEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        if (state.pendingChoice) return state; // Sub-effect needs choice — pause here
      }
      return state;
    }

    case "sequential": {
      // Check if all cost effects can be performed
      for (const costEffect of effect.costEffects) {
        if (!canPerformCostEffect(state, costEffect, controllingPlayerId, triggeringCardInstanceId)) {
          return state; // CRD 6.1.5.1: can't perform [A] → entire effect skipped
        }
      }
      // Clear any stale cost-side snapshot from a previous sequential resolution
      // so reward effects can tell "no cost resolved a target" from a leftover.
      state = { ...state, lastResolvedSource: undefined };
      // Apply cost effects [A]
      for (const costEffect of effect.costEffects) {
        state = applyEffect(state, costEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        // If cost effect created a pending choice (e.g. choose_target for banish),
        // queue reward effects so they run after the choice resolves
        if (state.pendingChoice) {
          const existingQueue = state.pendingEffectQueue;
          const rewardEffects = effect.rewardEffects;
          if (rewardEffects.length > 0) {
            const combinedEffects = existingQueue
              ? [...existingQueue.effects, ...rewardEffects]
              : rewardEffects;
            state = {
              ...state,
              pendingEffectQueue: {
                effects: combinedEffects,
                sourceInstanceId,
                controllingPlayerId,
              },
            };
          }
          return state;
        }
      }
      // Apply reward effects [B]
      for (const rewardEffect of effect.rewardEffects) {
        state = applyEffect(state, rewardEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        // If reward effect created a pending choice, queue remaining rewards
        if (state.pendingChoice) {
          const remainingRewards = effect.rewardEffects.slice(
            effect.rewardEffects.indexOf(rewardEffect) + 1
          );
          if (remainingRewards.length > 0) {
            const existingQueue = state.pendingEffectQueue;
            const combinedEffects = existingQueue
              ? [...existingQueue.effects, ...remainingRewards]
              : remainingRewards;
            state = {
              ...state,
              pendingEffectQueue: {
                effects: combinedEffects,
                sourceInstanceId,
                controllingPlayerId,
              },
            };
          }
          return state;
        }
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
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      return state;
    }

    // "You pay N less for the next X you play this turn"
    case "cost_reduction": {
      const existing = state.players[controllingPlayerId].costReductions ?? [];
      let resolvedAmount: number;
      if (typeof effect.amount === "object" && effect.amount.type === "count") {
        resolvedAmount = findMatchingInstances(state, definitions, effect.amount.filter, controllingPlayerId).length;
      } else if (effect.amount === "last_resolved_target_delta") {
        // Reuben Sandwich Expert: cost reduction = damage actually removed
        // by the cost step (remove_damage records delta on lastResolvedTarget).
        resolvedAmount = state.lastResolvedTarget?.delta ?? 0;
      } else {
        resolvedAmount = effect.amount as number;
      }
      if (resolvedAmount <= 0) return state;
      return {
        ...state,
        players: {
          ...state.players,
          [controllingPlayerId]: {
            ...state.players[controllingPlayerId],
            costReductions: [...existing, { amount: resolvedAmount, filter: effect.filter }],
          },
        },
      };
    }

    // "Each opponent loses N lore" / "Chosen player loses N lore"
    case "lose_lore": {
      if (effect.target.type === "chosen") {
        return surfaceChoosePlayer(state, effect, controllingPlayerId, sourceInstanceId, definitions, events);
      }
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, state.lastResolvedTarget?.instanceId);
      // Koda Talkative Cub: "during opponents' turns, you can't lose lore."
      // Static is gated by not(is_your_turn) — if active, the lose is a no-op.
      const lossModifiers = getGameModifiers(state, definitions);
      if (lossModifiers.preventLoreLoss.has(targetPlayer)) {
        state = { ...state, lastEffectResult: 0 };
        return state;
      }
      const loreBefore = state.players[targetPlayer].lore;
      state = gainLore(state, targetPlayer, -amount, events);
      const loreAfter = state.players[targetPlayer].lore;
      const actualLost = loreBefore - loreAfter;
      // CRD 6.1.5.1: Store result for "[A]. For each lore lost, [B]" patterns
      state = { ...state, lastEffectResult: actualLost };
      return state;
    }

    // Grant extra ink plays this turn (Sail the Azurite Sea)
    case "grant_extra_ink_play": {
      const current = state.players[controllingPlayerId].extraInkPlaysGranted ?? 0;
      return {
        ...state,
        players: {
          ...state.players,
          [controllingPlayerId]: {
            ...state.players[controllingPlayerId],
            extraInkPlaysGranted: current + effect.amount,
          },
        },
      };
    }

    // Grant "can challenge ready characters" for a duration
    case "grant_challenge_ready": {
      if (effect.target.type === "chosen") {
        const validTargets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to grant challenge-ready",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      if (effect.target.type === "this") {
        const timedEffect: TimedEffect = {
          type: "can_challenge_ready",
          expiresAt: effect.duration,
          appliedOnTurn: state.turnNumber,
          casterPlayerId: controllingPlayerId,
        };
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      return state;
    }

    // CRD 6.2.7.1: Create a floating triggered ability for rest of turn
    case "create_floating_trigger": {
      const existing = state.floatingTriggers ?? [];
      // attachTo: "last_resolved_target" — Mother Gothel KWB pattern. The
      // earlier cost step (deal_damage chosen) populated lastResolvedTarget;
      // attach the floating trigger to that same chosen target.
      if (effect.attachTo === "last_resolved_target") {
        const id = state.lastResolvedTarget?.instanceId;
        if (!id || !state.cards[id]) return state;
        return {
          ...state,
          floatingTriggers: [...existing, {
            trigger: effect.trigger,
            effects: effect.effects,
            controllingPlayerId,
            attachedToInstanceId: id,
          }],
        };
      }
      // attachTo: "chosen" — surface a choose_target so the controller picks
      // which character receives the floating trigger.
      if (effect.attachTo === "chosen") {
        const filter = effect.targetFilter ?? { owner: { type: "self" }, zone: "play", cardType: ["character"] };
        const validTargets = findValidTargets(state, filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to gain the triggered ability this turn.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
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

/**
 * Centralized exert: sets isExerted=true and queues a `character_exerted`
 * trigger if (and only if) the character was previously unexerted. Used by
 * quest, challenge, sing, activated-ability cost, and the `exert` Effect so
 * Te Kā Elemental Terror's "whenever an opposing character is exerted" can
 * fire from any of those paths. Cards entering play exerted bypass this
 * helper since they're not transitioning.
 */
function exertInstance(
  state: GameState,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): GameState {
  const inst = state.cards[instanceId];
  if (!inst) return state;
  if (inst.isExerted) return updateInstance(state, instanceId, { isExerted: true });
  state = updateInstance(state, instanceId, { isExerted: true });
  state = queueTrigger(state, "character_exerted", instanceId, definitions, {
    triggeringPlayerId: inst.ownerId,
  });
  return state;
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
      // "any" — performable if there's at least one card in hand (Geppetto).
      // "all" — always performable. Numeric — need >= count.
      return effect.amount === "all"
        ? true
        : effect.amount === "any"
          ? getZone(state, controllingPlayerId, "hand").length > 0
          : getZone(state, controllingPlayerId, "hand").length >= effect.amount;
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
  // If the trigger has a filter, the source card must match it (e.g. ADORING FANS
  // fires "whenever you play a character cost ≤ 2" — Stitch Rock Star itself costs 6).
  const selfTriggers = def.abilities
    .filter((a): a is TriggeredAbility => {
      if (a.type !== "triggered" || a.trigger.on !== eventType) return false;
      const triggerFilter = "filter" in a.trigger ? a.trigger.filter : undefined;
      if (triggerFilter && !matchesFilter(instance, def, triggerFilter, state, instance.ownerId)) return false;
      return true;
    })
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
      // Check if the source card matches the trigger's filter. Pass the watcher's
      // instanceId so atLocation: "this" filters resolve relative to the watcher
      // (e.g. Graveyard of Christmas Future "Whenever you move a character HERE").
      if (!matchesFilter(instance, def, triggerFilter, state, watcher.ownerId, watcher.instanceId)) continue;

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
    const def = definitions[instance.definitionId];
    if (!def) continue;

    for (const ability of def.abilities) {
      if (ability.type !== "triggered") continue;
      if (ability.trigger.on !== eventType) continue;
      // CRD 6.3-ish: triggered abilities default to in-play. Cards in other
      // zones must declare activeZones to fire (Lilo Escape Artist — discard).
      const activeZones = ability.activeZones ?? ["play"];
      if (!activeZones.includes(instance.zone)) continue;

      // For triggers with a "player" field, check the player matches
      if ("player" in ability.trigger && ability.trigger.player) {
        const playerTarget = ability.trigger.player;
        const cardOwner = instance.ownerId;
        const opponent = getOpponent(cardOwner);
        if (playerTarget.type === "self" && playerId !== cardOwner) continue;
        if (playerTarget.type === "opponent" && playerId !== opponent) continue;
      }

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
    if (++safety > MAX_TRIGGER_CHAIN) throw new Error("Trigger loop detected");

    // CRD 7.7.4: if interactive and a player has 2+ triggers simultaneously, let them choose order.
    // Active player orders their triggers first, then non-active player.
    if (state.interactive && state.triggerStack.length > 1) {
      const activePlayerId = state.currentPlayer;
      const nonActivePlayerId = activePlayerId === "player1" ? "player2" : "player1";
      for (const choosingPlayerId of [activePlayerId, nonActivePlayerId]) {
        const playerIndices = state.triggerStack
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => state.cards[t.sourceInstanceId]?.ownerId === choosingPlayerId)
          .map(({ i }) => String(i));
        if (playerIndices.length > 1) {
          state = {
            ...state,
            pendingChoice: {
              type: "choose_trigger",
              choosingPlayerId,
              prompt: "Choose which triggered ability to resolve next.",
              validTargets: playerIndices,
            },
          };
          return state;
        }
      }
    }

    const [trigger, ...rest] = state.triggerStack;
    if (!trigger) break;
    state = { ...state, triggerStack: rest };

    const source = state.cards[trigger.sourceInstanceId];
    // CRD 6.2.3 / 1.6.1: triggers fire from bag. Banished/leaves_play triggers
    // fire even after card leaves play — only fizzle if instance doesn't exist.
    if (!source) continue;
    // CRD 6.2.3 / 1.6.1: triggers fire from bag even after card leaves play
    // CRD 1.6.1: these triggers fire because of the challenge/banishment event itself,
    // not because the source is still in play. banished_other_in_challenge included per
    // CRD 4.6.6.2 — simultaneous damage means attacker banished another even if also banished.
    // Triggered abilities can declare activeZones to fire from non-play zones
    // (Lilo Escape Artist — fires from discard). Default is ["play"]; the
    // leaves-play family bypasses this check because the source has already
    // left play by the time the trigger resolves.
    // shifted_onto fires from the under-card after the shift completes — by
    // the time the trigger stack is processed, the watcher has been moved to
    // the "under" subzone. Treat it like a leaves-play family event so the
    // requiresInPlay zone check doesn't filter it out.
    const leavesPlayFamily = ["is_banished", "leaves_play", "banished_in_challenge", "banished_other_in_challenge", "is_challenged", "challenges", "shifted_onto"].includes(trigger.ability.trigger.on);
    if (!leavesPlayFamily) {
      const activeZones = trigger.ability.activeZones ?? ["play"];
      if (!activeZones.includes(source.zone)) continue;
    }

    // CRD 6.2.1: Check condition before resolving trigger effects
    if (trigger.ability.condition) {
      const conditionMet = evaluateCondition(
        trigger.ability.condition,
        state,
        definitions,
        source.ownerId,
        trigger.sourceInstanceId,
        trigger.context.triggeringCardInstanceId
      );
      if (!conditionMet) continue;
    }

    // CRD 6.1.13: "Once per turn" — skip if already fired this turn for this instance.
    // Reset on end of turn (applyPassTurn) and when leaving play (zoneTransition).
    if (trigger.ability.oncePerTurn || trigger.ability.maxFiresPerTurn !== undefined) {
      const key = trigger.ability.storyName ?? trigger.ability.rulesText ?? "anon";
      const limit = trigger.ability.maxFiresPerTurn ?? 1;
      const fires = (source.oncePerTurnTriggered as Record<string, number | boolean> | undefined)?.[key];
      const currentCount = typeof fires === "number" ? fires : (fires ? 1 : 0);
      if (currentCount >= limit) continue;
      // Mark as fired BEFORE applying effects so re-entrancy is blocked.
      state = updateInstance(state, trigger.sourceInstanceId, {
        oncePerTurnTriggered: { ...(source.oncePerTurnTriggered ?? {}), [key]: (currentCount + 1) as any },
      });
    }

    events.push({ type: "ability_triggered", instanceId: trigger.sourceInstanceId, abilityType: "triggered" });
    const triggerSourceDef = definitions[source.definitionId];
    const abilityName = trigger.ability.storyName ?? triggerSourceDef?.name ?? "ability";
    const cardName = triggerSourceDef?.fullName ?? source.definitionId;
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId: source.ownerId,
      message: `${cardName}'s ability "${abilityName}" triggered.`,
      type: "ability_triggered",
    });

    for (const effect of trigger.ability.effects) {
      // CRD 6.1.5.1: Sequential effects with isMay — skip prompt if cost can't be paid
      if (effect.type === "sequential" && effect.isMay) {
        const canAfford = effect.costEffects.every(
          (ce) => canPerformCostEffect(state, ce, source.ownerId, trigger.context.triggeringCardInstanceId)
        );
        if (!canAfford) {
          state = appendLog(state, {
            turn: state.turnNumber,
            playerId: source.ownerId,
            message: `${cardName}'s "${abilityName}" skipped — cost can't be paid.`,
            type: "ability_triggered",
          });
          continue;
        }
      }

      // CRD 6.1.4: "may" effects require player decision before resolving
      if ("isMay" in effect && effect.isMay) {
        const sourceDef = definitions[source.definitionId];
        const cardName = sourceDef?.fullName ?? source.definitionId;
        const abilityName = trigger.ability.storyName ? `"${trigger.ability.storyName}"` : "ability";
        const rulesText = trigger.ability.rulesText ?? "";
        const mayPrompt = rulesText
          ? `${cardName} — ${abilityName}: ${rulesText}`
          : `${cardName} — ${abilityName}: use this effect?`;
        state = {
          ...state,
          pendingChoice: {
            type: "choose_may",
            choosingPlayerId: source.ownerId,
            prompt: mayPrompt,
            pendingEffect: effect,
            optional: true,
            sourceInstanceId: trigger.sourceInstanceId,
            triggeringCardInstanceId: trigger.context.triggeringCardInstanceId,
          },
        };
        // Queue any remaining effects in the same trigger so they fire after the may resolves.
        // (Graveyard of Christmas Future ANOTHER CHANCE: "may put cards from under into hand.
        // If you do, banish this location." — the banish must run after the may.)
        const remainingAfterMay = trigger.ability.effects.slice(
          trigger.ability.effects.indexOf(effect) + 1
        );
        if (remainingAfterMay.length > 0) {
          state = {
            ...state,
            pendingEffectQueue: {
              effects: remainingAfterMay,
              sourceInstanceId: trigger.sourceInstanceId,
              controllingPlayerId: source.ownerId,
            },
          };
        }
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

/** CRD 4.3.3.2: After action effect resolves, move action card from play to discard.
 *  Always moves to the action card's own owner's discard, not the resolving player's
 *  (the resolving player may be the OPPONENT — e.g. Sudden Chill's "each opponent
 *  chooses and discards" surfaces the choose_discard pendingChoice on the opponent). */
function cleanupPendingAction(state: GameState, _playerId: PlayerID): GameState {
  if (state.pendingActionInstanceId && !state.pendingChoice) {
    const actionInstanceId = state.pendingActionInstanceId;
    // Verify the card is still in play before moving (it might have been moved by an effect)
    const instance = state.cards[actionInstanceId];
    if (instance && instance.zone === "play") {
      state = moveCard(state, actionInstanceId, instance.ownerId, "discard");
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
  events: GameEvent[],
  definitions?: Record<string, CardDefinition>
): GameState {
  // Peter Pan Never Land Prankster: prevent_lore_gain modifier short-circuits
  // any lore-gain attempt for affected players (covers gain_lore effects, quest
  // lore, and any other write path that funnels through gainLore).
  if (definitions) {
    const mods = getGameModifiers(state, definitions);
    if (mods.preventLoreGain.has(playerId) && amount > 0) {
      return state;
    }
  }
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
          // Per-turn flag for "if an opposing character was banished in a challenge this turn"
          // (LeFou - Opportunistic Flunky). Set on the OWNER of the banished character.
          state = {
            ...state,
            players: {
              ...state.players,
              [instance.ownerId]: {
                ...state.players[instance.ownerId],
                aCharacterWasBanishedInChallengeThisTurn: true,
              },
            },
          };
          // Per-turn counter for the OPPOSING (attacker's) player. Used by
          // Namaari Resolute Daughter ("For each opposing character banished
          // in a challenge this turn, you pay 2 {I} less to play this character").
          const attackerInst = state.cards[ctx.challengeOpponentId];
          if (attackerInst) {
            const attackerPid = attackerInst.ownerId;
            const prev = state.players[attackerPid].opposingCharsBanishedInChallengeThisTurn ?? 0;
            state = {
              ...state,
              players: {
                ...state.players,
                [attackerPid]: {
                  ...state.players[attackerPid],
                  opposingCharsBanishedInChallengeThisTurn: prev + 1,
                },
              },
            };
          }
          // CRD 6.2.7.1: Check floating triggers for banished_in_challenge (Fairy Godmother)
          if (state.floatingTriggers) {
            for (const ft of state.floatingTriggers) {
              if (ft.trigger.on !== "banished_in_challenge") continue;
              if (ft.attachedToInstanceId && ft.attachedToInstanceId !== instanceId) continue;
              const triggerFilter = "filter" in ft.trigger ? ft.trigger.filter : undefined;
              if (triggerFilter) {
                if (def && !matchesFilter(instance, def, triggerFilter, state, ft.controllingPlayerId)) continue;
              }
              // Synthesize a triggered ability for the trigger stack
              const floatingAbility: TriggeredAbility = {
                type: "triggered",
                trigger: ft.trigger,
                effects: ft.effects,
              };
              state = {
                ...state,
                triggerStack: [
                  ...state.triggerStack,
                  {
                    ability: floatingAbility,
                    sourceInstanceId: instanceId,
                    context: { triggeringCardInstanceId: instanceId },
                  },
                ],
              };
            }
          }
          // CRD 4.6.6.2: challenge damage is simultaneous — the opponent banished this card
          // even if the opponent was also banished in the same exchange. Only require the
          // instance to exist; zone check would incorrectly suppress mutual-banishment triggers.
          const opponent = state.cards[ctx.challengeOpponentId];
          if (opponent) {
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

  // CRD 1.9.3 / 7.1.6: leaving play resets all play-only state — card becomes a "new" card
  if (fromZone === "play" && targetZone !== "play") {
    // CRD 4.7: If a location is leaving play, clear hosted characters' atLocation pointer.
    const leavingDef = definitions[state.cards[instanceId]?.definitionId ?? ""];
    if (leavingDef?.cardType === "location") {
      for (const [otherId, other] of Object.entries(state.cards)) {
        if (other.atLocationInstanceId === instanceId) {
          state = updateInstance(state, otherId, { atLocationInstanceId: undefined });
        }
      }
    }
    // CRD 8.10.5: when a card with cards under it leaves play, those cards go to discard.
    const leavingInstSnapshot = state.cards[instanceId];
    const underToDiscard = leavingInstSnapshot?.cardsUnder ?? [];
    for (const underId of underToDiscard) {
      const underInst = state.cards[underId];
      if (!underInst) continue;
      // Cards under don't live in any zone array — set zone to "discard" and append to discard.
      state = {
        ...state,
        cards: {
          ...state.cards,
          [underId]: { ...underInst, zone: "discard" },
        },
        zones: {
          ...state.zones,
          [underInst.ownerId]: {
            ...state.zones[underInst.ownerId],
            discard: [...state.zones[underInst.ownerId].discard, underId],
          },
        },
      };
    }

    state = updateInstance(state, instanceId, {
      isExerted: false,
      damage: 0,
      isDrying: false,
      tempStrengthModifier: 0,
      tempWillpowerModifier: 0,
      tempLoreModifier: 0,
      grantedKeywords: [],
      timedEffects: [],
      atLocationInstanceId: undefined,
      movedThisTurn: false,
      // CRD 7.1.6: card becomes a "new" card on leaving play
      oncePerTurnTriggered: undefined,
      playedViaShift: false,
      challengedThisTurn: false,
      cardsUnder: [],
      boostedThisTurn: false,
    });
  }

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

    // returned_to_hand trigger
    if (ctx.reason === "returned" && fromZone === "play" && targetZone === "hand") {
      state = queueTrigger(state, "returned_to_hand", instanceId, definitions, triggerCtx);
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

/**
 * CRD 6.5: Check if damage to this character should be redirected to a protector.
 * Returns the protector's instanceId, or null if no redirect applies.
 */
function findDamageRedirect(
  state: GameState,
  targetInstanceId: string,
  definitions: Record<string, CardDefinition>,
  modifiers: ReturnType<typeof getGameModifiers>
): string | null {
  const target = getInstance(state, targetInstanceId);
  // CRD 6.5: Damage redirect only applies between characters — locations are excluded.
  const targetDef = definitions[target.definitionId];
  if (targetDef?.cardType !== "character") return null;
  for (const [protectorId, ownerId] of modifiers.damageRedirects) {
    // Only redirects damage for the protector's owner's other characters
    if (target.ownerId !== ownerId) continue;
    if (protectorId === targetInstanceId) continue; // Don't redirect damage to self
    // Protector must still be in play
    const protector = getInstance(state, protectorId);
    if (protector.zone !== "play") continue;
    return protectorId;
  }
  return null;
}

/**
 * Check whether `instance` has active damage immunity vs `source` damage.
 * Consults both static damage_immunity entries (from gameModifiers) and the
 * instance's own timedEffects list ("takes no damage from challenges this turn").
 * "all" immunity blocks every source; "challenge" blocks only inChallenge; the
 * "non_challenge" tag blocks everything EXCEPT challenge damage (Hercules wording).
 */
function hasStaticDamageImmunity(
  instance: CardInstance,
  modifiers: GameModifiers,
  inChallenge: boolean
): boolean {
  const staticSources = modifiers.damageImmunity.get(instance.instanceId);
  if (!staticSources) return false;
  let matches = false;
  if (staticSources.has("all")) matches = true;
  else if (inChallenge && staticSources.has("challenge")) matches = true;
  else if (!inChallenge && staticSources.has("non_challenge")) matches = true;
  if (!matches) return false;
  // Charge-based static immunity (Lilo Bundled Up): only blocks if the
  // instance has any charges remaining this turn.
  const maxCharges = modifiers.damageImmunityCharges.get(instance.instanceId);
  if (maxCharges !== undefined) {
    const used = instance.damageImmunityChargesUsedThisTurn ?? 0;
    if (used >= maxCharges) return false;
  }
  return true;
}

/** Returns the index of the first matching damage_immunity timed effect, or -1
 *  if none. Caller is responsible for consuming the charge / dropping the effect. */
function findTimedDamageImmunityIdx(
  instance: CardInstance,
  inChallenge: boolean
): number {
  for (let i = 0; i < instance.timedEffects.length; i++) {
    const te = instance.timedEffects[i]!;
    if (te.type !== "damage_immunity") continue;
    if (te.damageSource === "all") return i;
    if (inChallenge && te.damageSource === "challenge") return i;
    if (!inChallenge && te.damageSource === "non_challenge") return i;
  }
  return -1;
}

function dealDamageToCard(
  state: GameState,
  instanceId: string,
  amount: number,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  /** CRD 8.8.3: Resist only reduces "dealt" damage, not "put" or "moved" damage */
  ignoreResist = false,
  /** When true, the damage source is a challenge; used for source-tagged immunities. */
  inChallenge = false,
  /** CRD: "put a damage counter on" — bypass Resist + damage immunity + damage_dealt_to triggers.
   *  Banishment from willpower still resolves. Used by Queen of Hearts Unpredictable Bully. */
  asDamageCounter = false
): GameState {
  const modifiers = getGameModifiers(state, definitions);

  // Damage immunity (Baloo static, Hercules, Noi timed) — zero out ability damage
  // before it's written. No events emitted so damage_dealt_to triggers don't fire.
  // "Put a damage counter on" bypasses immunity (CRD: counters are not "dealt").
  const immTarget = state.cards[instanceId];
  if (!asDamageCounter && immTarget) {
    if (hasStaticDamageImmunity(immTarget, modifiers, inChallenge)) {
      // Charge-based static immunity (Lilo Bundled Up): consume one charge
      // so subsequent hits this turn pass through.
      if (modifiers.damageImmunityCharges.has(instanceId)) {
        const used = (immTarget.damageImmunityChargesUsedThisTurn ?? 0) + 1;
        state = updateInstance(state, instanceId, { damageImmunityChargesUsedThisTurn: used });
      }
      return state;
    }
    const timedIdx = findTimedDamageImmunityIdx(immTarget, inChallenge);
    if (timedIdx >= 0) {
      const te = immTarget.timedEffects[timedIdx]!;
      // Charges semantics (Rapunzel Ready for Adventure): consume one charge.
      // If charges hit 0, drop the timed effect entry. Otherwise leave it.
      if (te.charges !== undefined) {
        const remaining = te.charges - 1;
        let nextEffects: typeof immTarget.timedEffects;
        if (remaining <= 0) {
          nextEffects = immTarget.timedEffects.filter((_, i) => i !== timedIdx);
        } else {
          nextEffects = immTarget.timedEffects.map((e, i) => (i === timedIdx ? { ...e, charges: remaining } : e));
        }
        state = updateInstance(state, instanceId, { timedEffects: nextEffects });
      }
      return state;
    }
  }

  // CRD 6.5: Check for damage redirect (e.g. Beast - Selfless Protector)
  const redirectTo = findDamageRedirect(state, instanceId, definitions, modifiers);
  if (redirectTo) {
    // Redirect: put damage counters on protector instead (ignoreResist for "put" damage — CRD 8.8.3)
    const protector = getInstance(state, redirectTo);
    const protectorDef = definitions[protector.definitionId];
    if (protectorDef) {
      const newDamage = protector.damage + amount;
      state = updateInstance(state, redirectTo, { damage: newDamage });
      events.push({ type: "damage_dealt", instanceId: redirectTo, amount });
      const willpower = getEffectiveWillpower(protector, protectorDef);
      if (newDamage >= willpower) {
        state = banishCard(state, redirectTo, definitions, events);
      }
      return state;
    }
  }

  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];
  if (!def) return state;

  const resistValue = (ignoreResist || asDamageCounter) ? 0 : getKeywordValue(instance, def, "resist", modifiers.grantedKeywords.get(instanceId));
  const actualDamage = Math.max(0, amount - resistValue);

  const newDamage = instance.damage + actualDamage;
  state = updateInstance(state, instanceId, { damage: newDamage });
  if (!asDamageCounter) {
    events.push({ type: "damage_dealt", instanceId, amount: actualDamage });
  }
  // Per-turn event flags for "if one of your characters was damaged this turn" (Brutus, Devil's Eye Diamond)
  // "Put a damage counter on" still counts as the character being damaged for tracking
  // purposes (CRD distinguishes "dealt" vs "damaged"), so flag it either way.
  if (actualDamage > 0 && def.cardType === "character") {
    state = {
      ...state,
      players: {
        ...state.players,
        [instance.ownerId]: {
          ...state.players[instance.ownerId],
          aCharacterWasDamagedThisTurn: true,
        },
      },
    };
  }

  // Fire damage_dealt_to trigger after damage is applied — skipped for "put damage counter".
  if (actualDamage > 0 && !asDamageCounter) {
    state = queueTrigger(state, "damage_dealt_to", instanceId, definitions, {});
  }

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
  events: GameEvent[],
  sourceInstanceId: string = "",
  triggeringCardInstanceId?: string
): GameState {
  switch (effect.type) {
    case "deal_damage": {
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, targetInstanceId);
      return dealDamageToCard(state, targetInstanceId, amount, definitions, events, false, false, effect.asDamageCounter);
    }
    case "gain_lore": {
      // Support DynamicAmount variants that depend on the chosen target (target_lore etc.).
      // Target player is controllingPlayerId by default; effect.target.type="self" etc. is
      // honored only in the applyEffect path — here we assume "self" (the controller).
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, targetInstanceId);
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      return gainLore(state, targetPlayer, amount, events, definitions);
    }
    case "lose_lore": {
      const amount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, targetInstanceId);
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      const loreBefore = state.players[targetPlayer].lore;
      state = gainLore(state, targetPlayer, -amount, events);
      const loreAfter = state.players[targetPlayer].lore;
      state = { ...state, lastEffectResult: loreBefore - loreAfter };
      return state;
    }
    case "banish": {
      // Store the target's damage in lastEffectResult before banishing (Dinner Bell pattern)
      const banishInst = getInstance(state, targetInstanceId);
      state = { ...state, lastEffectResult: banishInst.damage };
      // Snapshot the banished card for cost-side reward steps (Hades Double Dealer:
      // "play a character with the same name as the banished character").
      const srcRef = makeResolvedRef(state, definitions, targetInstanceId);
      if (srcRef) state = { ...state, lastResolvedSource: srcRef };
      return banishCard(state, targetInstanceId, definitions, events);
    }
    case "return_to_hand":
      return zoneTransition(state, targetInstanceId, "hand", definitions, events, { reason: "returned" });
    case "create_floating_trigger": {
      // Resolution path for `attachTo: "chosen"` — store the floating trigger
      // scoped to the chosen instance. Bruno Madrigal, Medallion Weights.
      const existing = state.floatingTriggers ?? [];
      return {
        ...state,
        floatingTriggers: [
          ...existing,
          {
            trigger: effect.trigger,
            effects: effect.effects,
            controllingPlayerId,
            attachedToInstanceId: targetInstanceId,
          },
        ],
      };
    }
    case "put_on_bottom_of_deck": {
      // Resolution path for chosen-from-play targets. The chosen instance moves
      // to the bottom of its OWNER'S deck (Wrong Lever!, Do You Want to Build
      // A Snowman?, opponent-chosen variants).
      const inst = state.cards[targetInstanceId];
      if (!inst) return state;
      return moveCard(state, targetInstanceId, inst.ownerId, "deck", "bottom");
    }
    case "put_top_of_deck_under": {
      // CRD 8.4.2: Resolution path for chosen-target variant. Top card of the
      // controller's deck goes facedown under the chosen carrier, and the
      // card_put_under trigger fires with the carrier as the source.
      const targetInst = state.cards[targetInstanceId];
      if (!targetInst) return state;
      const deck = getZone(state, controllingPlayerId, "deck");
      const topId = deck[0];
      if (!topId) return state;
      const topInst = state.cards[topId];
      if (!topInst) return state;
      state = {
        ...state,
        cards: {
          ...state.cards,
          [topId]: { ...topInst, zone: "under" },
          [targetInstanceId]: {
            ...targetInst,
            cardsUnder: [...targetInst.cardsUnder, topId],
          },
        },
        zones: {
          ...state.zones,
          [controllingPlayerId]: {
            ...state.zones[controllingPlayerId],
            deck: state.zones[controllingPlayerId].deck.filter(id => id !== topId),
          },
        },
      };
      state = queueTrigger(state, "card_put_under", targetInstanceId, definitions, {
        triggeringPlayerId: controllingPlayerId,
        triggeringCardInstanceId: topId,
      });
      return state;
    }
    case "put_self_under_target": {
      // CRD 8.4.2: Resolution path for Roo HOPPING IN. Remove the source
      // (the acting character) from play and append it to the chosen
      // carrier's cardsUnder pile. Reset play-state fields so it's inert.
      const src = state.cards[sourceInstanceId];
      const target = state.cards[targetInstanceId];
      if (!src || !target) return state;
      const srcOwner = src.ownerId;
      state = {
        ...state,
        cards: {
          ...state.cards,
          [sourceInstanceId]: {
            ...src,
            zone: "under",
            damage: 0,
            isExerted: false,
            isDrying: false,
            tempStrengthModifier: 0,
            tempWillpowerModifier: 0,
            tempLoreModifier: 0,
            grantedKeywords: [],
            timedEffects: [],
            cardsUnder: [],
          },
          [targetInstanceId]: {
            ...target,
            cardsUnder: [...target.cardsUnder, sourceInstanceId],
          },
        },
        zones: {
          ...state.zones,
          [srcOwner]: {
            ...state.zones[srcOwner],
            play: state.zones[srcOwner].play.filter(id => id !== sourceInstanceId),
          },
        },
      };
      state = queueTrigger(state, "card_put_under", targetInstanceId, definitions, {
        triggeringPlayerId: controllingPlayerId,
        triggeringCardInstanceId: sourceInstanceId,
      });
      return state;
    }
    case "gain_stats": {
      // Sword in the Stone: +1 strength per damage on target
      if (effect.strengthPerDamage) {
        const instance = getInstance(state, targetInstanceId);
        return updateInstance(state, targetInstanceId, {
          tempStrengthModifier: instance.tempStrengthModifier + instance.damage,
          tempWillpowerModifier: instance.tempWillpowerModifier + (effect.willpower ?? 0),
          tempLoreModifier: instance.tempLoreModifier + (effect.lore ?? 0),
        });
      }
      // Triton's Trident SYMBOL OF POWER: +1 strength per card in controller's hand.
      if (effect.strengthPerCardInHand) {
        const instance = getInstance(state, targetInstanceId);
        const handSize = getZone(state, controllingPlayerId, "hand").length;
        return updateInstance(state, targetInstanceId, {
          tempStrengthModifier: instance.tempStrengthModifier + handSize,
          tempWillpowerModifier: instance.tempWillpowerModifier + (effect.willpower ?? 0),
          tempLoreModifier: instance.tempLoreModifier + (effect.lore ?? 0),
        });
      }
      // Olaf Carrot Enthusiast: +S equal to the source's effective strength.
      if (effect.strengthEqualsSourceStrength) {
        const instance = getInstance(state, targetInstanceId);
        const sourceInst = state.cards[sourceInstanceId];
        const sourceDef = sourceInst ? definitions[sourceInst.definitionId] : undefined;
        const srcStrength = sourceInst && sourceDef ? getEffectiveStrength(sourceInst, sourceDef, 0, getGameModifiers(state, definitions)) : 0;
        return updateInstance(state, targetInstanceId, {
          tempStrengthModifier: instance.tempStrengthModifier + srcStrength,
          tempWillpowerModifier: instance.tempWillpowerModifier + (effect.willpower ?? 0),
          tempLoreModifier: instance.tempLoreModifier + (effect.lore ?? 0),
        });
      }
      return applyGainStatsToInstance(state, targetInstanceId, effect, controllingPlayerId, definitions);
    }
    case "remove_damage": {
      const instance = getInstance(state, targetInstanceId);
      const actualHeal = Math.min(effect.amount, instance.damage);
      state = updateInstance(state, targetInstanceId, {
        damage: instance.damage - actualHeal,
      });
      // CRD 6.1.5.1: Store result for "[A]. For each damage removed, [B]" patterns
      state = { ...state, lastEffectResult: actualHeal };
      // Record the actual delta on lastResolvedTarget so follow-up reward effects
      // can read how many damage counters were consumed by an isUpTo remove_damage.
      // Baymax Armored Companion: "Gain 1 lore for each 1 damage removed this way."
      const deltaRef = makeResolvedRef(state, definitions, targetInstanceId, { delta: actualHeal });
      if (deltaRef) state = { ...state, lastResolvedTarget: deltaRef };
      if (actualHeal > 0) {
        const targetDef = definitions[getInstance(state, targetInstanceId).definitionId];
        const targetName = targetDef?.fullName ?? targetInstanceId;
        state = appendLog(state, {
          turn: state.turnNumber,
          playerId: controllingPlayerId,
          message: `Removed ${actualHeal} damage from ${targetName}.`,
          type: "effect_resolved",
        });
        // Fire damage_removed_from trigger after damage is removed
        state = queueTrigger(state, "damage_removed_from", targetInstanceId, definitions, {});
      }
      return state;
    }
    case "exert": {
      // Snapshot the exerted card for reward-side effects (Ambush: "deal damage
      // equal to their {S}" reads last_resolved_source_strength).
      const srcRef = makeResolvedRef(state, definitions, targetInstanceId);
      if (srcRef) state = { ...state, lastResolvedSource: srcRef };
      return updateInstance(state, targetInstanceId, { isExerted: true });
    }
    case "grant_keyword": {
      const timedEffect: TimedEffect = {
        type: "grant_keyword",
        keyword: effect.keyword,
        value: effect.value,
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "ready": {
      const wasExerted = getInstance(state, targetInstanceId).isExerted;
      state = updateInstance(state, targetInstanceId, { isExerted: false });
      if (wasExerted) {
        state = queueTrigger(state, "readied", targetInstanceId, definitions, {});
      }
      return state;
    }
    case "cant_action": {
      const timedEffect: TimedEffect = {
        type: "cant_action",
        action: effect.action,
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "cant_be_challenged_timed": {
      return addTimedEffect(state, targetInstanceId, {
        type: "cant_be_challenged",
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
      });
    }
    case "damage_immunity_timed": {
      return addTimedEffect(state, targetInstanceId, {
        type: "damage_immunity",
        damageSource: effect.source,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        ...(effect.charges !== undefined ? { charges: effect.charges } : {}),
      });
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
        state = applyEffectToTarget(state, e, targetInstanceId, controllingPlayerId, definitions, events, sourceInstanceId, triggeringCardInstanceId);
      }
      return state;
    }
    case "play_for_free": {
      // Play the chosen card. Source zone defaults to "hand" but may be "discard"
      // (Ursula - Deceiver of All), "under" (The Black Cauldron), or any other zone.
      // `cost: "normal"` deducts the card's effective ink cost (paid play); default is free.
      const inst = getInstance(state, targetInstanceId);
      const expectedSource = effect.sourceZone ?? "hand";
      if (inst.zone !== expectedSource) return state;
      const def = definitions[inst.definitionId];
      if (!def) return state;
      // CRD 8.10.5: when source is the cards-under subzone, detach from parent's pile.
      // The under subzone has no zone-array entry per player, so moveCard's filter is a
      // no-op — we must clear the parent's cardsUnder reference ourselves to avoid the
      // stale "card belongs under X" pointer surviving the play.
      if (expectedSource === "under") {
        for (const [parentId, parentInst] of Object.entries(state.cards)) {
          if (!parentInst.cardsUnder.includes(targetInstanceId)) continue;
          state = updateInstance(state, parentId, {
            cardsUnder: parentInst.cardsUnder.filter(id => id !== targetInstanceId),
          });
          break;
        }
      }
      // Paid-play branch: deduct the card's effective cost (including all
      // applicable cost reductions — static reductions like Mickey Broom or
      // Grandmother Willow, plus one-shot reductions). Mirrors applyPlayCard.
      if (effect.cost === "normal") {
        const player = state.players[controllingPlayerId];
        const cardCost = getEffectiveCostWithReductions(state, controllingPlayerId, targetInstanceId, definitions);
        if (player.availableInk < cardCost) return state;
        state = updatePlayerInk(state, controllingPlayerId, -cardCost);
      }
      // Move to play via zoneTransition (fires enters_play, card_played triggers).
      // Note: actions resolve their effects on play and then return to discard via the
      // normal play-card path; play_for_free skips that path, so songs/actions handled
      // here will need their actionEffects resolved separately. For Ursula's case
      // (replaying a song from discard), the song's actionEffects must run, then the
      // song itself goes to bottom-of-deck via thenPutOnBottomOfDeck.
      state = zoneTransition(state, targetInstanceId, "play", definitions, events, {
        reason: "played", triggeringPlayerId: controllingPlayerId,
      });
      // Characters enter drying. Lilo Escape Artist enters exerted via enterExerted.
      if (def.cardType === "character") {
        state = updateInstance(state, targetInstanceId, {
          isDrying: true,
          ...(effect.enterExerted ? { isExerted: true } : {}),
        });
      }
      // Actions: resolve their effects and then move to discard (CRD 5.4.3).
      if (def.cardType === "action" && def.actionEffects) {
        for (const actionEffect of def.actionEffects) {
          state = applyEffect(state, actionEffect, targetInstanceId, controllingPlayerId, definitions, events);
        }
        // CRD 5.4.3: actions go to discard after resolving (unless re-routed by thenPutOnBottomOfDeck below).
        if (!effect.thenPutOnBottomOfDeck) {
          state = zoneTransition(state, targetInstanceId, "discard", definitions, events, { reason: "discarded" });
        }
      }
      // Grant keywords (e.g. Rush from Gruesome and Grim / Madam Mim)
      if (effect.grantKeywords) {
        const playedInst = getInstance(state, targetInstanceId);
        state = updateInstance(state, targetInstanceId, {
          grantedKeywords: [...playedInst.grantedKeywords, ...effect.grantKeywords],
        });
      }
      // Queue for end-of-turn banishment (Gruesome and Grim / Madam Mim)
      if (effect.banishAtEndOfTurn) {
        const existing = state.pendingEndOfTurnBanish ?? [];
        state = { ...state, pendingEndOfTurnBanish: [...existing, targetInstanceId] };
      }
      // CRD: "...then put it on the bottom of your deck" (Ursula - Deceiver of All).
      // For actions: bypass the normal post-resolution discard and route to bottom of deck instead.
      // For characters: they're now in play; this would be unusual but supported.
      if (effect.thenPutOnBottomOfDeck) {
        const owner = getInstance(state, targetInstanceId).ownerId;
        // moveCard appends to the end of the destination zone array → bottom of deck.
        state = moveCard(state, targetInstanceId, owner, "deck");
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
    case "move_damage": {
      // "all_damaged" stage-2: drain 1 (or `amount`) damage from each resolved
      // source into the chosen destination. Records total moved on lastEffectResult.
      const allSources = (effect as any)._resolvedSources as ResolvedRef[] | undefined;
      if (allSources) {
        const dst0 = state.cards[targetInstanceId];
        if (!dst0) return state;
        let totalMoved = 0;
        for (const ref of allSources) {
          const src = state.cards[ref.instanceId];
          if (!src || src.damage <= 0) continue;
          const moveAmt = Math.min(effect.amount, src.damage);
          if (moveAmt <= 0) continue;
          state = updateInstance(state, src.instanceId, { damage: src.damage - moveAmt });
          const dstNow = state.cards[targetInstanceId];
          if (!dstNow) continue;
          state = updateInstance(state, targetInstanceId, { damage: dstNow.damage + moveAmt });
          totalMoved += moveAmt;
        }
        state = { ...state, lastEffectResult: totalMoved };
        const deltaRef = makeResolvedRef(state, definitions, targetInstanceId, { delta: totalMoved });
        if (deltaRef) state = { ...state, lastResolvedTarget: deltaRef };
        return state;
      }
      // Stage 2 path: source already resolved → targetInstanceId is the destination
      if (effect._resolvedSource) {
        const src = state.cards[effect._resolvedSource.instanceId];
        const dst = state.cards[targetInstanceId];
        if (!src || !dst) return state;
        const moveAmt = Math.min(effect.amount, src.damage);
        if (moveAmt <= 0) return state;
        state = updateInstance(state, src.instanceId, { damage: src.damage - moveAmt });
        state = updateInstance(state, targetInstanceId, { damage: dst.damage + moveAmt });
        // Record actually-moved count on lastResolvedTarget for follow-up effects.
        const deltaRef = makeResolvedRef(state, definitions, targetInstanceId, { delta: moveAmt });
        if (deltaRef) state = { ...state, lastResolvedTarget: deltaRef };
        return state;
      }
      // Stage 1: targetInstanceId is the chosen SOURCE. Surface destination choice.
      const validDests = findValidTargets(state, effect.destination.filter, controllingPlayerId, definitions, targetInstanceId)
        .filter(id => id !== targetInstanceId);
      if (validDests.length === 0) return state;
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose a character to move damage to.",
          validTargets: validDests,
          pendingEffect: { ...effect, _resolvedSource: makeResolvedRef(state, definitions, targetInstanceId) },
        },
      };
    }
    case "move_character": {
      // Two-stage flow for character "all" + location "chosen" (Moana
      // Kakamora Leader "any number", Voyage "up to 2"):
      //   Stage 1 (the FIRST applyEffect): surfaces the location chooser.
      //   Stage 2 (this branch, _resolvedLocation NOT yet set): the player
      //     just resolved the location → surface a multi-select character
      //     chooser bounded by maxCount (or unbounded for "any number").
      //   Stage 3 (this branch, _resolvedLocation set): per-pick performMove,
      //     incrementing lastEffectResult so a follow-up gain_lore (Moana)
      //     can pay per moved character.
      if (effect.character.type === "all") {
        if (effect._resolvedLocation) {
          // Stage 3: targetInstanceId is one of the picked characters.
          // The choice resolver loops through the picked array and calls us
          // once per character, threading state through each call.
          state = performMove(state, targetInstanceId, effect._resolvedLocation.instanceId, definitions, events);
          return { ...state, lastEffectResult: (state.lastEffectResult ?? 0) + 1 };
        }
        // Stage 2: targetInstanceId is the just-resolved LOCATION. Surface
        // the multi-select character chooser. Excludes the location itself
        // and any character already at that location (no-op move per CRD).
        const candidates = findValidTargets(state, effect.character.filter, controllingPlayerId, definitions, sourceInstanceId)
          .filter((id) => id !== targetInstanceId)
          .filter((id) => state.cards[id]?.atLocationInstanceId !== targetInstanceId);
        if (candidates.length === 0) return { ...state, lastEffectResult: 0 };
        const cap = effect.character.maxCount ?? candidates.length;
        return {
          // Reset lastEffectResult to 0 so per-pick increments accumulate
          // cleanly from a known baseline (Moana's gain_lore reward).
          ...state,
          lastEffectResult: 0,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: effect.character.maxCount !== undefined
              ? `Choose up to ${cap} characters to move.`
              : "Choose any number of characters to move.",
            validTargets: candidates,
            pendingEffect: { ...effect, _resolvedLocation: makeResolvedRef(state, definitions, targetInstanceId) },
            sourceInstanceId,
            triggeringCardInstanceId,
            optional: true,
            count: cap,
          },
        };
      }
      // Stage 2 path: if a character was already resolved, the targetInstanceId is the LOCATION.
      if (effect._resolvedCharacter) {
        return performMove(state, effect._resolvedCharacter.instanceId, targetInstanceId, definitions, events);
      }
      // Stage 1: targetInstanceId is the chosen character. Resolve the location side.
      if (effect.location.type === "chosen") {
        let validLocations = findValidTargets(state, effect.location.filter, controllingPlayerId, definitions, targetInstanceId);
        // Sugar Rush Speedway "to ANOTHER location" — exclude the character's current location.
        const charInst = state.cards[targetInstanceId];
        const currentLoc = charInst?.atLocationInstanceId;
        if (currentLoc) {
          validLocations = validLocations.filter(id => id !== currentLoc);
        }
        if (validLocations.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a location to move to.",
            validTargets: validLocations,
            pendingEffect: { ...effect, _resolvedCharacter: makeResolvedRef(state, definitions, targetInstanceId) },
          },
        };
      }
      // Stage 1 + location: triggering_card path (Goofy Set for Adventure FAMILY VACATION:
      // chosen own character moves to the location the source moved to).
      if (effect.location.type === "triggering_card" && triggeringCardInstanceId) {
        return performMove(state, targetInstanceId, triggeringCardInstanceId, definitions, events);
      }
      return state;
    }
    case "grant_challenge_ready": {
      const timedEffect: TimedEffect = {
        type: "can_challenge_ready",
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
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

/** Fisher-Yates shuffle a player's deck using seeded RNG from state */
function shuffleDeck(state: GameState, playerId: PlayerID): GameState {
  const deck = [...getZone(state, playerId, "deck")];
  const rng = state.rng;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rngNextInt(rng, i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return {
    ...state,
    zones: { ...state.zones, [playerId]: { ...state.zones[playerId], deck } },
  };
}

/** Add a timed effect to a card instance */
/** Pick the choosingPlayerId for a chosen CardTarget — controller or opponent
 *  (if `chooser === "target_player"`, used by "each opponent chooses one of
 *  their characters and X" patterns: Ursula's Plan, Be King Undisputed,
 *  Triton's Decree, Gunther Interior Designer). */
function chosenChooserPlayerId(
  target: { type: "chosen"; chooser?: "controller" | "target_player" },
  controllingPlayerId: PlayerID
): PlayerID {
  return target.chooser === "target_player"
    ? getOpponent(controllingPlayerId)
    : controllingPlayerId;
}

/** Surface a choose_player pendingChoice for an effect with a chosen-PlayerTarget.
 *  When excludeSelf is set and only one valid target remains, auto-resolves
 *  inline by substituting the effect's target and re-applying. */
function surfaceChoosePlayer(
  state: GameState,
  effect: Effect,
  controllingPlayerId: PlayerID,
  sourceInstanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const target = (effect as { target?: { excludeSelf?: boolean } }).target;
  const opponent = getOpponent(controllingPlayerId);
  const validTargets: PlayerID[] = target?.excludeSelf
    ? [opponent]
    : ["player1", "player2"];
  // Single valid target → auto-resolve without prompting (chosen opponent in 2P).
  if (validTargets.length === 1) {
    return applyChosenPlayerEffect(state, effect, validTargets[0]!, controllingPlayerId, sourceInstanceId, definitions, events);
  }
  return {
    ...state,
    pendingChoice: {
      type: "choose_player",
      choosingPlayerId: controllingPlayerId,
      prompt: "Choose a player.",
      validTargets,
      pendingEffect: effect,
      sourceInstanceId,
    },
  };
}

/** Re-apply an effect with the chosen player substituted into target.type. */
function applyChosenPlayerEffect(
  state: GameState,
  effect: Effect,
  chosenPlayer: PlayerID,
  resolverPlayerId: PlayerID,
  sourceInstanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const substituted = {
    ...(effect as object),
    target: chosenPlayer === resolverPlayerId
      ? { type: "self" as const }
      : { type: "opponent" as const },
  } as Effect;
  return applyEffect(state, substituted, sourceInstanceId, resolverPlayerId, definitions, events);
}

function addTimedEffect(state: GameState, instanceId: string, effect: TimedEffect): GameState {
  const instance = getInstance(state, instanceId);
  return updateInstance(state, instanceId, {
    timedEffects: [...instance.timedEffects, effect],
  });
}

/** Apply a gain_stats effect to a single instance. Routes to tempStatModifier
 *  (for "this_turn") or addTimedEffect (for end_of_turn / rest_of_turn /
 *  end_of_owner_next_turn / until_caster_next_turn — which need to survive
 *  across turn boundaries). For until_caster_next_turn, the casterPlayerId is
 *  recorded so cleanup can compare against the right player (CRD "your next turn"). */
function applyGainStatsToInstance(
  state: GameState,
  instanceId: string,
  effect: import("../types/index.js").GainStatsEffect,
  casterPlayerId: PlayerID,
  definitions?: Record<string, CardDefinition>
): GameState {
  const instance = state.cards[instanceId];
  if (!instance) return state;

  // Resolve dynamic strength override (count-based debuffs — Rescue Rangers Away).
  let resolvedStrength: number | undefined;
  if (effect.strengthDynamic !== undefined && definitions) {
    const raw = resolveDynamicAmount(effect.strengthDynamic, state, definitions, casterPlayerId, instanceId, undefined, instanceId);
    resolvedStrength = effect.strengthDynamicNegate ? -raw : raw;
  }
  const strengthAmount = resolvedStrength ?? effect.strength ?? 0;

  const isTempThisTurn = effect.duration === "this_turn" || effect.duration === "permanent";
  if (isTempThisTurn) {
    // Existing path: write to tempStrengthModifier (cleared at end of turn).
    // Note: "permanent" currently shares the temp path — pre-existing semantics.
    return updateInstance(state, instanceId, {
      tempStrengthModifier: instance.tempStrengthModifier + strengthAmount,
      tempWillpowerModifier: instance.tempWillpowerModifier + (effect.willpower ?? 0),
      tempLoreModifier: instance.tempLoreModifier + (effect.lore ?? 0),
    });
  }
  // EffectDuration: append separate timedEffects so the duration logic expires them.
  const expiresAt = effect.duration as import("../types/index.js").EffectDuration;
  const baseTimed = { expiresAt, appliedOnTurn: state.turnNumber, casterPlayerId };
  if (strengthAmount) {
    state = addTimedEffect(state, instanceId, { type: "modify_strength", amount: strengthAmount, ...baseTimed });
  }
  if (effect.willpower) {
    state = addTimedEffect(state, instanceId, { type: "modify_willpower", amount: effect.willpower, ...baseTimed });
  }
  if (effect.lore) {
    state = addTimedEffect(state, instanceId, { type: "modify_lore", amount: effect.lore, ...baseTimed });
  }
  return state;
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
      state = exertInstance(state, instanceId, definitions);
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
  const raw = Object.values(state.cards)
    .filter((instance) => {
      // CRD 6.1.6: "other" — exclude the source card
      if (filter.excludeSelf && sourceInstanceId && instance.instanceId === sourceInstanceId) return false;
      const def = definitions[instance.definitionId];
      if (!def) return false;
      // Pass sourceInstanceId so atLocation: "this" filters resolve correctly
      // (Sugar Rush Speedway "chosen character here" needs the location's instanceId).
      return matchesFilter(instance, def, filter, state, controllingPlayerId, sourceInstanceId, definitions);
    })
    .map((i) => i.instanceId);

  // John Smith Undaunted Protector ("DO YOUR WORST Opponents must choose this
  // character for actions and abilities if able"): if any forced-target is in
  // the raw valid set, the chooser MUST pick from that subset. "If able"
  // means we don't apply the restriction when no forced target is targetable.
  const mods = getGameModifiers(state, definitions);
  const forced = mods.forcedTargets.get(controllingPlayerId);
  if (forced && forced.size > 0) {
    const intersection = raw.filter((id) => forced.has(id));
    if (intersection.length > 0) return intersection;
  }
  return raw;
}

/** CRD 1.8: Game state check — uses getLoreThreshold, never hardcodes 20.
 *  Per-player threshold so Donald Duck Flustered Sorcerer's "Opponents need 25 lore"
 *  raises only the affected player's bar. */
function applyWinCheck(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  _events: GameEvent[]
): GameState {
  if (state.isGameOver) return state;

  for (const [playerId, playerState] of Object.entries(state.players)) {
    const threshold = getLoreThreshold(state, definitions, playerId as PlayerID);
    if (playerState.lore >= threshold) {
      return { ...state, winner: playerId as PlayerID, isGameOver: true };
    }
  }
  return state;
}
