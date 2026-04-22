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
  EachPlayerEffect,
  PlayerFilter,
  PlayerMetric,
  RestrictedAction,
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
import { cloneRng, rngNextInt } from "../utils/seededRng.js";

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

  // `rngNext` mutates `state.rng.s` in place for performance. Clone the rng
  // up front so the caller's state object is never modified — required for
  // deterministic replay (undo, quicksave/load, branching sim) where any
  // held state reference must preserve its original seed. All downstream
  // reducer paths thread through this working state, so their rng mutations
  // land on the clone, not the caller's copy.
  state = { ...state, rng: cloneRng(state.rng) };

  try {
    let newState = applyActionInner(state, action, definitions, events);
    // After applying the action, check and resolve triggers
    newState = processTriggerStack(newState, definitions, events);
    // CRD 1.8: Game state check — damage≥willpower banish + lore win
    newState = runGameStateCheck(newState, definitions, events);

    // CRD 3.2.3.1: if applyPassTurn deferred the draw step because a
    // turn_start trigger created a pendingChoice (e.g. The Queen Conceited
    // Ruler ROYAL SUMMONS), resume the draw now that the choice has resolved
    // and the trigger stack has drained. Loop since the draw itself may
    // queue triggers (on_draw) that cascade further.
    while (
      newState.pendingDrawForPlayer &&
      !newState.pendingChoice &&
      newState.triggerStack.length === 0 &&
      !newState.isGameOver
    ) {
      const drawPlayer = newState.pendingDrawForPlayer;
      newState = { ...newState, pendingDrawForPlayer: undefined };
      const drawModifiers = getGameModifiers(newState, definitions);
      if (!drawModifiers.skipsDrawStep.has(drawPlayer)) {
        newState = applyDraw(newState, drawPlayer, 1, events, definitions);
      }
      newState = processTriggerStack(newState, definitions, events);
      newState = runGameStateCheck(newState, definitions, events);
    }

    // CRD 3.4.1.1: if applyPassTurn deferred the turn transition because a
    // turn_end trigger created a pendingChoice (e.g. two Cinderella Dream
    // Come True triggers queued, first creates a may choice), complete the
    // transition now that the stack and choices have drained. performTurn
    // Transition may itself queue turn_start triggers which can pend a
    // choice — loop to handle cascades.
    while (
      newState.pendingTurnTransition &&
      !newState.pendingChoice &&
      newState.triggerStack.length === 0 &&
      !newState.isGameOver
    ) {
      const endingPlayer = newState.pendingTurnTransition;
      newState = performTurnTransition(newState, endingPlayer, definitions, events);
      newState = processTriggerStack(newState, definitions, events);
      newState = runGameStateCheck(newState, definitions, events);
    }

    // Clear within-chain snapshot carriers at action boundaries. These fields
    // (lastResolvedTarget, lastResolvedSource, lastDamageDealtAmount) are used
    // by DynamicAmounts and CardFilter refs that resolve within a single
    // action's chain (Mulan TRIPLE SHOT's last_damage_dealt, Ambush's
    // last_resolved_source_strength, Hades Double Dealer's nameFromLast
    // ResolvedSource, etc.) — none read cross-action. Only clear when the
    // action fully resolved: no pendingChoice (deferred player pick) and no
    // pending triggers. Keeps the GUI's "Target: X / Damage dealt: 4" hint
    // strip from showing stale data on unrelated later choices.
    if (!newState.pendingChoice && newState.triggerStack.length === 0) {
      newState = {
        ...newState,
        lastResolvedTarget: undefined,
        lastResolvedSource: undefined,
        lastDamageDealtAmount: undefined,
      };
    }

    // Persist revealed cards on state for multiplayer visibility (events are transient).
    // Only overwrite when this action produced reveals — follow-up actions like
    // choose_order (which have no reveals) must NOT clear stale data, because the
    // GUI may not have rendered the overlay yet (Ariel Spectacular Singer flow:
    // choose_from_revealed → choose_order back-to-back).
    const revealEvents = events.filter((e): e is Extract<GameEvent, { type: "card_revealed" }> => e.type === "card_revealed");
    if (revealEvents.length > 0) {
      const last = revealEvents[revealEvents.length - 1]!;
      // Increment sequenceId each time so the UI can distinguish distinct
      // reveals of the same card (e.g. quest Daisy → undo → quest Daisy again:
      // both reveal the same top-of-deck, but they are separate events).
      const nextSeq = (newState.lastRevealedCards?.sequenceId ?? 0) + 1;
      newState = {
        ...newState,
        lastRevealedCards: {
          instanceIds: revealEvents.map(e => e.instanceId),
          sourceInstanceId: last.sourceInstanceId,
          playerId: last.playerId,
          sequenceId: nextSeq,
        },
      };
    }

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
    //
    // One action per card regardless of alt-cost shape — if the card has a
    // non-trivial cost (Belle's banish_chosen, Scrooge's exert_n_matching),
    // applyPlayCard surfaces a pendingChoice after the click so the player can
    // pick which item(s) to pay with. The validator checks cost feasibility.
    if (playMods.playForFreeSelf.has(instanceId)) {
      const freePlay: GameAction = { type: "PLAY_CARD", playerId, instanceId, viaGrantedFreePlay: true };
      if (validateAction(state, freePlay, definitions).valid) {
        actions.push(freePlay);
      }
    }

    // Shift: check independent of normal play affordability. The shift cost
    // can come from def.shiftCost (printed), mods.grantedShiftSelf
    // (Anna - Soothing Sister "this card gains Shift 0"), or def.altShiftCost
    // (Diablo - Devoted Herald "Shift — Discard an action card").
    const cardInst = state.cards[instanceId];
    const cardDef = cardInst ? definitions[cardInst.definitionId] : undefined;
    const hasInkShift = cardDef?.shiftCost !== undefined || playMods.grantedShiftSelf.has(instanceId);
    const hasAltShift = !!cardDef?.altShiftCost;
    if (hasInkShift) {
      // Standard ink-cost shift: one action per shift target
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
    if (hasAltShift && cardDef?.altShiftCost) {
      // Alt-cost shift (Diablo, Flotsam, etc.): one action per shift target.
      // The cost picker (which cards to discard/banish) is surfaced as a
      // pendingChoice by applyPlayCard after the click — same pattern as
      // Belle/Scrooge's granted-free-play alt cost. No per-combo fanout.
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

    // altPlayCost: DELETED — migrated to grant_play_for_free_self with playCosts.
    // Belle's banish-item enumeration now happens in the playForFreeSelf block above.
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
      return applyPlayCard(state, action.playerId, action.instanceId, definitions, events, action.shiftTargetInstanceId, action.singerInstanceId, action.singerInstanceIds, action.viaGrantedFreePlay, action.altShiftCostInstanceIds);
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
  viaGrantedFreePlay?: boolean,
  altShiftCostInstanceIds?: string[],
): GameState {
  const def = getDefinition(state, instanceId, definitions);

  // CRD 8.12: Sing Together — multiple characters all exert; sings trigger fires per singer
  if (singerInstanceIds && singerInstanceIds.length > 0) {
    state = { ...state, lastSongSingerCount: singerInstanceIds.length, lastSongSingerIds: [...singerInstanceIds] };
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
    state = { ...state, lastSongSingerCount: 1, lastSongSingerIds: [singerInstanceId] };
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
  } else if (viaGrantedFreePlay) {
    // Granted free-play: Pudge (no costs), Belle (banish 1 item), Scrooge
    // (exert 4 items). If there's a non-trivial cost, surface a pendingChoice
    // so the player picks which instance(s) to pay with. On resolve, the
    // handler pays the cost and completes the play via completeFreePlayInto
    // Play. Pudge (no costs) falls through to the zoneTransition below.
    const mods = getGameModifiers(state, definitions);
    const playCosts = mods.playForFreeSelf.get(instanceId);
    if (playCosts && playCosts.length > 0) {
      const firstCost = playCosts[0]!;
      const filter = "filter" in firstCost ? firstCost.filter : undefined;
      let validTargets: string[] = [];
      let exactCount = 1;
      let costType: "banish_chosen" | "exert_n_matching" | "discard" = "banish_chosen";
      if (firstCost.type === "banish_chosen" && filter) {
        costType = "banish_chosen";
        exactCount = 1;
        validTargets = getZone(state, playerId, "play").filter((id) => {
          const inst = state.cards[id];
          const d = inst ? definitions[inst.definitionId] : undefined;
          return !!inst && !!d && matchesFilter(inst, d, filter, state, playerId);
        });
      } else if (firstCost.type === "exert_n_matching" && filter) {
        costType = "exert_n_matching";
        exactCount = firstCost.count;
        validTargets = getZone(state, playerId, "play").filter((id) => {
          const inst = state.cards[id];
          if (!inst || inst.isExerted) return false;
          const d = definitions[inst.definitionId];
          return !!d && matchesFilter(inst, d, filter, state, playerId);
        });
      } else if (firstCost.type === "discard") {
        costType = "discard";
        exactCount = firstCost.amount;
        validTargets = getZone(state, playerId, "hand").filter((id) => id !== instanceId);
      }
      // Surface chooser — on resolve, reducer pays cost + completes play.
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: playerId,
          prompt: `${def.fullName} — choose ${exactCount} ${costType === "banish_chosen" ? "item to banish" : costType === "exert_n_matching" ? "item(s) to exert" : "card(s) to discard"}.`,
          validTargets,
          count: exactCount,
          _freePlayContinuation: {
            characterInstanceId: instanceId,
            playerId,
            costType,
            exactCount,
          },
        },
      };
    }
    state = appendLog(state, {
      turn: state.turnNumber,
      playerId,
      message: `${playerId} played ${def.fullName} for free.`,
      type: "card_played",
    });
  } else if (shiftTargetInstanceId && def.altShiftCost && (!altShiftCostInstanceIds || altShiftCostInstanceIds.length === 0)) {
    // Alt-cost shift interactive entry: cost picker not yet collected.
    // Surface a choose_target pendingChoice; on resolve the reducer re-invokes
    // applyPlayCard with the chosen cost IDs filled in, which lands in the
    // altShiftCostInstanceIds branch below and completes the shift normally.
    const altCost = def.altShiftCost;
    const requiredAmount = altCost.type === "discard" ? (altCost.amount ?? 1) : 1;
    let validTargets: string[] = [];
    if (altCost.type === "discard") {
      validTargets = getZone(state, playerId, "hand").filter(id => {
        if (id === instanceId) return false;
        const inst = state.cards[id];
        const d = inst ? definitions[inst.definitionId] : undefined;
        return !!inst && !!d && (!altCost.filter || matchesFilter(inst, d, altCost.filter, state, playerId));
      });
    } else if (altCost.type === "banish_chosen") {
      validTargets = getZone(state, playerId, "play").filter(id => {
        if (id === shiftTargetInstanceId) return false;
        const inst = state.cards[id];
        const d = inst ? definitions[inst.definitionId] : undefined;
        return !!inst && !!d && matchesFilter(inst, d, altCost.filter, state, playerId);
      });
    }
    return {
      ...state,
      pendingChoice: {
        type: "choose_target",
        choosingPlayerId: playerId,
        prompt: `${def.fullName} — choose ${requiredAmount} ${altCost.type === "discard" ? "card(s) to discard" : "card(s) to banish"} to Shift.`,
        validTargets,
        count: requiredAmount,
        _altShiftCostContinuation: {
          characterInstanceId: instanceId,
          shiftTargetInstanceId,
          playerId,
          costType: altCost.type,
          exactCount: requiredAmount,
        },
      },
    };
  } else if (altShiftCostInstanceIds && altShiftCostInstanceIds.length > 0 && shiftTargetInstanceId && def.altShiftCost) {
    // Alternate-cost shift (Diablo, Flotsam etc.): pay a non-ink cost.
    const altCost = def.altShiftCost;
    if (altCost.type === "discard") {
      const names: string[] = [];
      for (const costId of altShiftCostInstanceIds) {
        names.push(getDefinition(state, costId, definitions).fullName);
        state = moveCard(state, costId, playerId, "discard");
        events.push({ type: "card_discarded" as any, instanceId: costId, playerId });
      }
      state = appendLog(state, {
        turn: state.turnNumber, playerId,
        message: `${playerId} discarded ${names.join(" and ")} to shift ${def.fullName}.`,
        type: "card_played",
      });
    } else if (altCost.type === "banish_chosen") {
      for (const costId of altShiftCostInstanceIds) {
        state = banishCard(state, costId, definitions, events);
      }
      state = appendLog(state, {
        turn: state.turnNumber, playerId,
        message: `${playerId} banished card(s) to shift ${def.fullName}.`,
        type: "card_played",
      });
    }
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

    // Static cost reductions (e.g. Mickey: Broom chars cost 1 less). Filter
    // the unified modifier list to "play"-kind entries for this player.
    const isShiftPay = !!shiftTargetInstanceId;
    for (const red of modifiers.costReductions) {
      if (red.kind !== "play") continue;
      if (red.playerId !== playerId) continue;
      if (red.appliesTo === "shift_only" && !isShiftPay) continue;
      if (red.cardFilter && !matchesFilter(instance, def, red.cardFilter, state, playerId)) continue;
      cost -= red.amount;
      // CRD 6.1.13: once-per-turn static reductions (Grandmother Willow) —
      // mark the source instance so gameModifiers skips it next time.
      if (red.sourceInstanceId && red.oncePerTurnKey) {
        const src = getInstance(state, red.sourceInstanceId);
        state = updateInstance(state, red.sourceInstanceId, {
          oncePerTurnTriggered: { ...(src.oncePerTurnTriggered ?? {}), [red.oncePerTurnKey]: true },
        });
      }
    }

    // One-shot cost reductions — consume ALL matching ones (each one targets
    // "the next character", so playing any character exhausts them all).
    const oneShot = state.players[playerId].costReductions ?? [];
    const remainingReductions: typeof oneShot = [];
    for (const red of oneShot) {
      if (matchesFilter(instance, def, red.filter, state, playerId)) {
        cost -= red.amount;
        // consumed — don't add to remaining
      } else {
        remainingReductions.push(red);
      }
    }

    // CRD 6.1.12: Self-cost-reduction from hand (e.g. LeFou: costs 1 less if Gaston in play)
    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      const effsScr = Array.isArray(ability.effect) ? ability.effect : [ability.effect];
      const scrEff = effsScr.find((e: any) => e.type === "self_cost_reduction") as any;
      if (!scrEff) continue;
      if (ability.condition) {
        if (!evaluateCondition(ability.condition, state, definitions, playerId, instanceId)) {
          continue;
        }
      }
      // Mirror validator's resolution: literal number, count-based, or
      // per-turn event count.
      const rawAmount = scrEff.amount;
      let discount = 0;
      if (typeof rawAmount === "number") {
        discount = rawAmount;
      } else if (typeof rawAmount === "object" && rawAmount !== null && (rawAmount as { type?: string }).type === "count") {
        const countAmt = rawAmount as { type: "count"; filter: import("../types/index.js").CardFilter; max?: number };
        let n = findMatchingInstances(state, definitions, countAmt.filter, playerId, instanceId).length;
        if (typeof countAmt.max === "number") n = Math.min(n, countAmt.max);
        discount = n * (scrEff.perMatch ?? 1);
      } else if (rawAmount === "opposing_chars_banished_in_challenge_this_turn") {
        const n = state.players[playerId].opposingCharsBanishedInChallengeThisTurn ?? 0;
        discount = n * (scrEff.perMatch ?? 1);
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
      // CRD 8.10.5: shifted character keeps any effects that applied to the base card.
      // Transfer timed effects (stat buffs, keyword grants, restrictions, etc.)
      timedEffects: [...shiftTarget.timedEffects],
    });
    // CRD 8.10.5: Update floating triggers that were attached to the base card
    // so they now fire for the shifted card (same logical character, new instance).
    if (state.floatingTriggers?.length) {
      const updated = state.floatingTriggers.map(ft =>
        ft.attachedToInstanceId === shiftTargetInstanceId
          ? { ...ft, attachedToInstanceId: instanceId }
          : ft
      );
      state = { ...state, floatingTriggers: updated };
    }
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
          isFaceDown: false, // CRD 5.1.1.9: was in play, remains face-up
          damage: 0,
          isExerted: false,
          isDrying: false,
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
    // cardsPlayedThisTurn is now tracked centrally in zoneTransition.
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
    // Characters/items enter play — zoneTransition fires enters_play, card_played
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
    // cardsPlayedThisTurn is now tracked centrally in zoneTransition.
  }

  state = applyEnterPlayExertion(state, instanceId, playerId, definitions);
  return state;
}

/** CRD 6.7.8 / 8.3.2 entry-exertion logic shared by applyPlayCard and the
 *  granted-free-play pendingChoice resolver. Applies, in order:
 *  - enter_play_exerted_self static on the card's own abilities
 *  - EnterPlayExertedStatic opponent modifiers (Jiminy, Figaro)
 *  - Bodyguard keyword may-exert trigger (prepended to stack). */
function applyEnterPlayExertion(
  state: GameState,
  instanceId: string,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
): GameState {
  const def = getDefinition(state, instanceId, definitions);
  for (const ab of def.abilities) {
    if (ab.type === "static") {
      const effs = Array.isArray(ab.effect) ? ab.effect : [ab.effect];
      if (effs.some(e => e.type === "enter_play_exerted_self")) {
        // Dale Friend in Need CHIP'S PARTNER: "enters play exerted unless
        // you have a character named Chip in play" — honor the static's
        // condition so the exert only applies when the condition is true
        // (via `not(has_character_named: "Chip")`).
        if (ab.condition && !evaluateCondition(ab.condition, state, definitions, playerId, instanceId)) {
          break;
        }
        state = updateInstance(state, instanceId, { isExerted: true });
        break;
      }
    }
  }
  const epeMods = getGameModifiers(state, definitions);
  const filters = epeMods.enterPlayExerted.get(playerId) ?? [];
  if (filters.length > 0) {
    const playedInst = getInstance(state, instanceId);
    for (const f of filters) {
      const { owner: _omit, ...rest } = f;
      if (matchesFilter(playedInst, def, rest, state, playerId)) {
        state = updateInstance(state, instanceId, { isExerted: true });
        break;
      }
    }
  }
  const playedInstance = getInstance(state, instanceId);
  if (hasKeyword(playedInstance, def, "bodyguard")) {
    const bodyguardTrigger: PendingTrigger = {
      ability: {
        type: "triggered",
        trigger: { on: "enters_play" },
        storyName: "Bodyguard",
        rulesText: "This character may enter play exerted to protect your other characters.",
        effects: [{
          type: "exert",
          target: { type: "this" },
          isMay: true,
        }],
      },
      sourceInstanceId: instanceId,
      context: { triggeringPlayerId: playerId },
    };
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
    type: "card_put_into_inkwell",
  });
  // CRD 6.2: card_put_into_inkwell triggered abilities (Chicha Dedicated Mother). Queue
  // after the inkPlaysThisTurn counter has been bumped so condition checks see
  // the post-play count.
  state = queueTriggersByEvent(state, "card_put_into_inkwell", playerId, definitions, {});
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

  // RC Remote-Controlled Car: "can't quest unless you pay 1 {I}". The
  // validator has confirmed the cost is payable; deduct it before the quest
  // resolves. Paid per action, not once per turn.
  state = payActionUnlockCost(state, playerId, instanceId, "quest", modifiers);

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
    const supportMods = getGameModifiers(state, definitions);
    const supportStrength = getEffectiveStrength(
      questingInstance,
      questingDef,
      supportMods.statBonuses.get(instanceId)?.strength ?? 0,
      supportMods,
    );
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
              // Stamp so the TimedEffect on the recipient is attributed to
              // Support (not to a sibling ability like ROYAL SUMMONS).
              _sourceStoryName: "Support",
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

// CRD 4.6: Challenge — split into Declaration (4.6.4) and Damage (4.6.6) steps.
// Triggers from the Declaration step resolve BEFORE damage is calculated,
// so effects like Tiana Restaurant Owner's -3 {S} debuff apply before damage.
function applyChallenge(
  state: GameState,
  playerId: PlayerID,
  attackerInstanceId: string,
  defenderInstanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[]
): GameState {
  const attackerDef = getDefinition(state, attackerInstanceId, definitions);
  const defenderDef = getDefinition(state, defenderInstanceId, definitions);

  // RC Remote-Controlled Car: "can't challenge unless you pay 1 {I}". Pay
  // the unlock cost before the challenge resolves. Validator already confirmed
  // payability. Paid per action, not once per turn.
  state = payActionUnlockCost(state, playerId, attackerInstanceId, "challenge", getGameModifiers(state, definitions));

  // Set 11 pacifist cycle: track that the attacker's owner had a character
  // challenge this turn. Used by no_challenges_this_turn condition.
  // Also track the count so cards like Fa Zhou War Hero TRAINING EXERCISES
  // ("if it's the second challenge this turn") can condition on it.
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        aCharacterChallengedThisTurn: true,
        charactersChallengedThisTurn: (state.players[playerId].charactersChallengedThisTurn ?? 0) + 1,
      },
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CRD 4.6.4 — CHALLENGE DECLARATION STEP
  // ═══════════════════════════════════════════════════════════════════════════

  // CRD 4.6.4.4: Exert the challenging character
  state = exertInstance(state, attackerInstanceId, definitions);
  // Mark defender as challenged this turn (for Last Stand and similar cards)
  if (defenderDef.cardType === "character") {
    state = updateInstance(state, defenderInstanceId, { challengedThisTurn: true });
  }

  // CRD 4.6.4.5: "challenges" and "is_challenged" triggered abilities
  state = queueTrigger(state, "challenges", attackerInstanceId, definitions, {
    triggeringCardInstanceId: defenderInstanceId,
  });
  if (defenderDef.cardType === "character") {
    state = queueTrigger(state, "is_challenged", defenderInstanceId, definitions, {
      triggeringCardInstanceId: attackerInstanceId,
    });
  }

  // CRD 6.2.7.1: Check floating triggers for `challenges` (Medallion Weights)
  if (state.floatingTriggers) {
    const attacker = getInstance(state, attackerInstanceId);
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

  // CRD 4.6.5: Resolve triggered abilities from the Declaration step.
  // This is where Tiana's -3 {S} debuff, Rafiki's "takes no damage", etc. resolve.
  state = processTriggerStack(state, definitions, events);

  // CRD 1.8: Game state check after Declaration step
  state = runGameStateCheck(state, definitions, events);

  // ═══════════════════════════════════════════════════════════════════════════
  // CRD 4.6.6 — CHALLENGE DAMAGE STEP
  // Strength is calculated NOW, after Declaration triggers have resolved.
  // ═══════════════════════════════════════════════════════════════════════════

  // If either combatant left play during declaration (e.g., Puny Pirate banished
  // the defender), skip the damage step.
  const atkNow = state.cards[attackerInstanceId];
  const defNow = state.cards[defenderInstanceId];
  if (!atkNow || atkNow.zone !== "play" || !defNow || defNow.zone !== "play") {
    return state;
  }

  // CRD 4.6.6.1: Calculate damage with current modifiers (post-trigger)
  const modifiers = getGameModifiers(state, definitions);
  const atkStaticStr = modifiers.statBonuses.get(attackerInstanceId)?.strength ?? 0;
  const defStaticStr = modifiers.statBonuses.get(defenderInstanceId)?.strength ?? 0;
  let attackerStr = getEffectiveStrength(atkNow, attackerDef, atkStaticStr, modifiers);
  let defenderStr = getEffectiveStrength(defNow, defenderDef, defStaticStr, modifiers);

  // "While being challenged" stat bonuses
  for (const ability of defenderDef.abilities) {
    if (ability.type !== "static") continue;
    const effsChal = Array.isArray(ability.effect) ? ability.effect : [ability.effect];
    for (const eff of effsChal) {
      if (eff.type !== "gets_stat_while_being_challenged") continue;
      if (eff.stat !== "strength") continue;
      if (eff.affects === "attacker") {
        attackerStr += eff.amount;
      } else {
        defenderStr += eff.amount;
      }
    }
  }

  // CRD 8.5.1: Challenger +N bonus
  if (defenderDef.cardType === "character") {
    const challengerValue = getKeywordValue(atkNow, attackerDef, "challenger", modifiers.grantedKeywords.get(attackerInstanceId));
    attackerStr += challengerValue;
  }

  // Conditional challenge bonuses
  const turnBonuses = state.players[playerId].turnChallengeBonuses;
  if (turnBonuses && turnBonuses.length > 0) {
    for (const bonus of turnBonuses) {
      if (matchesFilter(defNow, defenderDef, bonus.defenderFilter, state, playerId)) {
        attackerStr += bonus.strength;
      }
    }
  }
  const selfBonuses = modifiers.conditionalChallengerSelf.get(attackerInstanceId);
  if (selfBonuses && selfBonuses.length > 0) {
    for (const bonus of selfBonuses) {
      if (matchesFilter(defNow, defenderDef, bonus.defenderFilter, state, playerId)) {
        attackerStr += bonus.strength;
      }
    }
  }

  // CRD 8.8.1: Resist
  // Captain Amelia EVERYTHING SHIPSHAPE: "while being challenged" keyword
  // grants only apply to the defender during the challenge resolution —
  // merge those grants into the defender's effective keyword set here.
  // Scope is narrow by design: outside this window the defender shouldn't
  // have the keyword, so we DON'T bake it into modifiers.grantedKeywords.
  const defenderWhileBeingChallenged = modifiers.grantKeywordWhileBeingChallenged.get(defenderInstanceId) ?? [];
  const defenderStaticGrants = defenderWhileBeingChallenged.length > 0
    ? [...(modifiers.grantedKeywords.get(defenderInstanceId) ?? []), ...defenderWhileBeingChallenged]
    : modifiers.grantedKeywords.get(defenderInstanceId);
  const attackerResist = getKeywordValue(atkNow, attackerDef, "resist", modifiers.grantedKeywords.get(attackerInstanceId));
  const defenderResist = getKeywordValue(defNow, defenderDef, "resist", defenderStaticGrants);
  let actualAttackerDamage = Math.max(0, defenderStr - attackerResist);
  let actualDefenderDamage = Math.max(0, attackerStr - defenderResist);

  // Damage prevention (Raya, Noi, Lilo, etc.)
  const immuneFilter = modifiers.challengeDamagePrevention.get(attackerInstanceId);
  if (immuneFilter !== undefined) {
    if (!immuneFilter || matchesFilter(defNow, defenderDef, immuneFilter, state, playerId)) {
      actualAttackerDamage = 0;
    }
  }
  const consumeTimedCharge = (id: string): void => {
    const inst = state.cards[id];
    if (!inst) return;
    const idx = findTimedDamagePreventionIdx(inst, true);
    if (idx < 0) return;
    const te = inst.timedEffects[idx]!;
    if (te.charges === undefined) return;
    const remaining = te.charges - 1;
    const next = remaining <= 0
      ? inst.timedEffects.filter((_, i) => i !== idx)
      : inst.timedEffects.map((e, i) => (i === idx ? { ...e, charges: remaining } : e));
    state = updateInstance(state, id, { timedEffects: next });
  };
  const consumeStaticCharge = (id: string): void => {
    if (!modifiers.damagePreventionCharges.has(id)) return;
    const inst = state.cards[id];
    if (!inst) return;
    const used = (inst.damagePreventionChargesUsedThisTurn ?? 0) + 1;
    state = updateInstance(state, id, { damagePreventionChargesUsedThisTurn: used });
  };
  if (hasStaticDamagePrevention(atkNow, modifiers, true) || findTimedDamagePreventionIdx(atkNow, true) >= 0) {
    if (actualAttackerDamage > 0) {
      consumeStaticCharge(attackerInstanceId);
      consumeTimedCharge(attackerInstanceId);
    }
    actualAttackerDamage = 0;
  }
  if (hasStaticDamagePrevention(defNow, modifiers, true) || findTimedDamagePreventionIdx(defNow, true) >= 0) {
    if (actualDefenderDamage > 0) {
      consumeStaticCharge(defenderInstanceId);
      consumeTimedCharge(defenderInstanceId);
    }
    actualDefenderDamage = 0;
  }

  // CRD 6.5: Damage redirect
  const attackerRedirect = actualAttackerDamage > 0 ? findDamageRedirect(state, attackerInstanceId, definitions, modifiers) : null;
  const defenderRedirect = actualDefenderDamage > 0 ? findDamageRedirect(state, defenderInstanceId, definitions, modifiers) : null;

  // CRD 4.6.6.2: Apply damage simultaneously
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
    state = queueTrigger(state, "damage_dealt_to", atkTarget, definitions, {});
    state = queueTrigger(state, "deals_damage_in_challenge", defenderInstanceId, definitions, {
      triggeringCardInstanceId: atkTarget,
    });
  }
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
    state = queueTrigger(state, "damage_dealt_to", defTarget, definitions, {});
    state = { ...state, lastDamageDealtAmount: actualDefenderDamage };
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

  // CRD 4.6.6.3 + 1.8: Game state check after challenge damage
  state = runGameStateCheck(state, definitions, events, {
    attackerId: attackerInstanceId,
    defenderId: defenderInstanceId,
  });

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
  // Apply per-location, global, and self-only move cost reductions
  // (Jolly Roger Hook's Ship, Map of Treasure Planet, Raksha Fearless Mother).
  const moveModifiers = getGameModifiers(state, definitions);
  const charInst = getInstance(state, characterInstanceId);
  const charDef = getDefinition(state, characterInstanceId, definitions);
  const moveCost = applyMoveCostReduction(baseCost, charInst, charDef, locationInstanceId, moveModifiers, state, playerId);

  // Mark oncePerTurn flags on any source whose self-only reduction was just consumed
  // (Raksha — "Once during your turn, you may pay 1 {I} less to move this character").
  // We mark BEFORE deducting ink so the marker reflects the move that's about to pay.
  if (moveCost < baseCost) {
    for (const entry of moveModifiers.costReductions) {
      if (entry.kind !== "move") continue;
      if (entry.playerId !== playerId) continue;
      if (!entry.oncePerTurnKey || !entry.sourceInstanceId) continue;
      if (entry.selfOnly && entry.sourceInstanceId !== characterInstanceId) continue;
      const src = state.cards[entry.sourceInstanceId];
      if (!src || src.oncePerTurnTriggered?.[entry.oncePerTurnKey]) continue;
      state = updateInstance(state, entry.sourceInstanceId, {
        oncePerTurnTriggered: { ...(src.oncePerTurnTriggered ?? {}), [entry.oncePerTurnKey]: true },
      });
    }
  }

  // Deduct ink (the move_character effect path skips this — see performMove)
  if (moveCost > 0) {
    state = updatePlayerInk(state, playerId, -moveCost);
  }
  return performMove(state, characterInstanceId, locationInstanceId, definitions, events);
}

/** Pure mutation shared by the MOVE_CHARACTER action and the move_character effect.
 *  Sets atLocationInstanceId, logs, and queues the
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
  // CRD 8.4.2: card from deck is placed face-down — no player can look at it.
  const deck = getZone(state, playerId, "deck");
  const topId = deck[0]!;
  const topInst = state.cards[topId]!;
  state = {
    ...state,
    cards: {
      ...state.cards,
      [topId]: { ...topInst, zone: "under", isFaceDown: true },
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
  // CRD 8.4.1: emit boost_used trigger — fires ONLY on Boost activation (not
  // on put_top_card_under effects). Carrier/source = the boosted character,
  // triggering card = the boosted character itself so "put under THEM" works.
  state = queueTrigger(state, "boost_used", instanceId, definitions, {
    triggeringPlayerId: playerId,
    triggeringCardInstanceId: instanceId,
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

  // Async costs (discard, banish_chosen) — payCosts only handles synchronous
  // ones (exert, pay_ink, banish_self). For costs that require player input
  // (which card to discard, which target to banish), prepend a synthetic
  // effect that flows through the existing pendingChoice + pendingEffectQueue
  // pipeline. validateActivateAbility already gated feasibility, so these
  // can't fizzle on no-target — the prompt surfaces and the rest of the
  // ability's effects queue behind it.
  const leadingCostEffects: Effect[] = [];
  for (const cost of ability.costs) {
    if (cost.type === "discard") {
      const discardEffect: Effect = {
        type: "discard_from_hand",
        target: { type: "self" },
        amount: cost.amount,
        chooser: "target_player",
        ...(cost.filter ? { filter: cost.filter } : {}),
      } as Effect;
      leadingCostEffects.push(discardEffect);
    }
    if (cost.type === "banish_chosen") {
      leadingCostEffects.push({ type: "banish", target: cost.target } as Effect);
    }
  }
  const effectsToApply = leadingCostEffects.length > 0
    ? [...leadingCostEffects, ...ability.effects]
    : ability.effects;

  for (let i = 0; i < effectsToApply.length; i++) {
    const effect = effectsToApply[i]!;
    state = applyEffect(state, effect, instanceId, playerId, definitions, events);
    if (state.pendingChoice) {
      const remaining = effectsToApply.slice(i + 1);
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

  // CRD 6.2.7.2: Resolve delayed triggers that fire at end of turn
  if (state.delayedTriggers?.length) {
    const endOfTurnDelayed = state.delayedTriggers.filter(dt => dt.firesAt === "end_of_turn");
    const remaining = state.delayedTriggers.filter(dt => dt.firesAt !== "end_of_turn");
    for (const dt of endOfTurnDelayed) {
      const targetInst = state.cards[dt.targetInstanceId];
      // CRD 6.2.7.2: If the target has moved to a different zone, resolves with no effect
      if (!targetInst || targetInst.zone !== "play") continue;
      for (const eff of dt.effects) {
        state = applyEffect(state, eff, dt.targetInstanceId, dt.controllingPlayerId, definitions, events, dt.targetInstanceId);
      }
    }
    state = { ...state, delayedTriggers: remaining.length > 0 ? remaining : undefined };
  }

  // CRD 3.4.1.1: end-of-turn triggered abilities
  state = queueTriggersByEvent(state, "turn_end", playerId, definitions, {});
  state = processTriggerStack(state, definitions, events);

  // If a turn_end trigger created a pendingChoice (Cinderella Dream Come True's
  // "may put a card in inkwell to draw a card", etc.) or there are unprocessed
  // triggers, defer the turn transition. applyAction's post-processing will
  // complete the transition via performTurnTransition once the stack drains.
  // Without this, cardsPlayedThisTurn would reset before subsequent turn_end
  // triggers evaluate their conditions (breaking multi-trigger end-of-turn
  // scenarios like two Cinderellas), the opponent's cards would ready before
  // our effect finishes, and any chained triggers from within the effect
  // (e.g. Oswald watching card_put_into_inkwell) would run against the new
  // turn's "is_your_turn" context.
  if (state.pendingChoice || state.triggerStack.length > 0) {
    return { ...state, pendingTurnTransition: playerId };
  }

  return performTurnTransition(state, playerId, definitions, events);
}

function performTurnTransition(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
): GameState {
  const opponent = getOpponent(playerId);

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
      pendingTurnTransition: undefined,
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
        cardsPlayedThisTurn: [],
        charactersQuestedThisTurn: 0,
        cardsDrawnThisTurn: 0,
        charactersChallengedThisTurn: 0,
        // Per-turn event flags reset on the new active player too (defensive)
        aCharacterWasDamagedThisTurn: false,
        aCharacterWasBanishedInChallengeThisTurn: false,
        aCharacterChallengedThisTurn: false,
        opposingCharsBanishedInChallengeThisTurn: 0,
        cardsPutIntoDiscardThisTurn: 0,
        youRemovedDamageThisTurn: false,
        characterNamesBanishedThisTurn: [],
        timedGrantedActivatedAbilities: [],
      },
      // CRD 3.4.1.2: clear the ending player's turn-scoped conditional challenge bonuses
      // and per-turn event flags (damaged-this-turn, banished-in-challenge-this-turn).
      // Both players' event flags reset at turn boundary — "this turn" is the global turn.
      [playerId]: {
        ...state.players[playerId],
        turnChallengeBonuses: [],
        cardsPlayedThisTurn: [],
        charactersQuestedThisTurn: 0,
        cardsDrawnThisTurn: 0,
        charactersChallengedThisTurn: 0,
        aCharacterWasDamagedThisTurn: false,
        aCharacterWasBanishedInChallengeThisTurn: false,
        aCharacterChallengedThisTurn: false,
        opposingCharsBanishedInChallengeThisTurn: 0,
        cardsPutIntoDiscardThisTurn: 0,
        youRemovedDamageThisTurn: false,
        characterNamesBanishedThisTurn: [],
        timedGrantedActivatedAbilities: [],
      },
    },
    cardsLeftDiscardThisTurn: false,
  };

  // Ready all of opponent's cards in play and inkwell (CRD 3.2.1.1)
  // CRD 6.6.1: Respect "can't ready" from both timed effects and static modifiers.
  // Both the narrow "ready" (Maui) and the blanket "ready_anytime" (Gargoyle
  // STONE BY DAY) block the start-of-turn ready step; only effect-driven
  // ready distinguishes them.
  const modifiers = getGameModifiers(state, definitions);
  const opponentPlay = getZone(state, opponent, "play");
  for (const id of opponentPlay) {
    const inst = getInstance(state, id);
    const def = definitions[inst.definitionId];
    const cantReady = def && (
      isActionRestricted(inst, def, "ready", opponent, state, modifiers)
      || isActionRestricted(inst, def, "ready_anytime", opponent, state, modifiers)
    );
    if (cantReady) {
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
      instance.grantedKeywords.length > 0 ||
      instance.challengedThisTurn ||
      instance.oncePerTurnTriggered ||
      instance.boostedThisTurn ||
      (instance.cardsPutUnderThisTurn ?? 0) > 0 ||
      (instance.damagePreventionChargesUsedThisTurn ?? 0) > 0
    ) {
      // tempStrengthModifier/tempWillpowerModifier/tempLoreModifier: no longer
      // used — "this_turn" stat buffs now route through TimedEffects which are
      // filtered out by the expiry check below this loop.
      state = updateInstance(state, id, {
        grantedKeywords: [],
        challengedThisTurn: false,
        // CRD 6.1.13: once-per-turn flags reset at end of turn
        oncePerTurnTriggered: undefined,
        boostedThisTurn: false,
        cardsPutUnderThisTurn: 0,
        damagePreventionChargesUsedThisTurn: 0,
      });
    }
  }

  // Expire timed effects based on duration
  for (const id of Object.keys(state.cards)) {
    const instance = getInstance(state, id);
    if (instance.timedEffects.length === 0) continue;
    const remaining = instance.timedEffects.filter((te) => {
      // "end_of_turn" expires at end of the turn it was applied.
      // ("rest_of_turn" was a synonym — migrated to end_of_turn.)
      if (te.expiresAt === "end_of_turn") return false;
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

  // CRD 6.4.2.1: Expire global timed effects using the same duration logic
  if (state.globalTimedEffects?.length) {
    const remainingGlobal = state.globalTimedEffects.filter((gte) => {
      if (gte.expiresAt === "end_of_turn") return false;
      if (gte.expiresAt === "until_caster_next_turn") {
        return !(gte.appliedOnTurn < newTurnNumber && gte.controllingPlayerId === opponent);
      }
      if (gte.expiresAt === "end_of_owner_next_turn") {
        // Global effects don't have a single owner — expire based on controlling player
        return !(gte.appliedOnTurn < newTurnNumber && gte.controllingPlayerId === playerId);
      }
      return true;
    });
    if (remainingGlobal.length !== state.globalTimedEffects.length) {
      state = { ...state, globalTimedEffects: remainingGlobal.length > 0 ? remainingGlobal : undefined };
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

  // CRD 1.8: Game state check after timed effect expiry. A willpower buff
  // expiring may make existing damage lethal (e.g., character leaves Rapunzel's
  // Tower location, loses +3 W, now damage ≥ willpower).
  state = runGameStateCheck(state, definitions, events);

  // CRD 6.2.7.2: Resolve delayed triggers that fire at start of next turn
  if (state.delayedTriggers?.length) {
    const startOfTurnDelayed = state.delayedTriggers.filter(dt => dt.firesAt === "start_of_next_turn");
    const remaining = state.delayedTriggers.filter(dt => dt.firesAt !== "start_of_next_turn");
    for (const dt of startOfTurnDelayed) {
      const targetInst = state.cards[dt.targetInstanceId];
      if (!targetInst || targetInst.zone !== "play") continue;
      for (const eff of dt.effects) {
        state = applyEffect(state, eff, dt.targetInstanceId, dt.controllingPlayerId, definitions, events, dt.targetInstanceId);
      }
    }
    state = { ...state, delayedTriggers: remaining.length > 0 ? remaining : undefined };
  }

  // CRD 3.2.2.3: Resolve triggered abilities from Ready + Set steps
  // (e.g. "readied" triggers from the Ready step) BEFORE turn_start triggers.
  state = processTriggerStack(state, definitions, events);

  // CRD 3.2.1.4: "At the start of your turn" triggered abilities
  state = queueTriggersByEvent(state, "turn_start", opponent, definitions, {});
  state = processTriggerStack(state, definitions, events);

  // CRD 3.2.3.1: draw step — active player draws a card.
  // Skip if a static effect on a card the active player owns says so
  // (Arthur Determined Squire — "Skip your turn's Draw step").
  // If a turn_start trigger created a pendingChoice (e.g. The Queen
  // Conceited Ruler ROYAL SUMMONS' may-choose target in discard), defer
  // the draw step until the choice resolves. The draw must happen AFTER
  // the trigger fully resolves, not before. See applyAction's post-
  // processing which consumes pendingDrawForPlayer.
  if (state.pendingChoice) {
    state = { ...state, pendingDrawForPlayer: opponent };
  } else {
    const drawModifiers = getGameModifiers(state, definitions);
    if (!drawModifiers.skipsDrawStep.has(opponent)) {
      state = applyDraw(state, opponent, 1, events, definitions);
    }
  }

  state = { ...state, phase: "main" };

  events.push({ type: "turn_passed", to: opponent });

  state = appendLog(state, {
    turn: newTurnNumber,
    playerId: opponent,
    message: `${opponent}'s turn begins.`,
    type: "turn_start",
  });

  return { ...state, pendingTurnTransition: undefined };
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
    // Ink Amplifier ENERGY CAPTURE: tally draws this turn so the
    // "Nth card drawn this turn" condition reads the post-draw count.
    state = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...state.players[playerId],
          cardsDrawnThisTurn: (state.players[playerId].cardsDrawnThisTurn ?? 0) + 1,
        },
      },
    };
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

  // CRD 2.1.3.2 / 2.2.1: play-draw rule. Chooser elects first or second.
  // The starting player then begins the mulligan (CRD 2.2.2 orders mulligans
  // starting with the starting player).
  if (pendingChoice.type === "choose_play_order" && typeof choice === "string") {
    const chooserId = pendingChoice.choosingPlayerId;
    const opponentId = getOpponent(chooserId);
    const startingPlayerId: PlayerID = choice === "first" ? chooserId : opponentId;

    state = {
      ...state,
      firstPlayerId: startingPlayerId,
      currentPlayer: startingPlayerId,
    };

    // Log the election
    const logMsg = choice === "first"
      ? `${chooserId} chose to go first.`
      : `${chooserId} chose to go second (${opponentId} goes first).`;
    state = appendLog(state, { turn: state.turnNumber, playerId: chooserId, message: logMsg, type: "choice_made" });

    // CRD 2.2.2: mulligan starts with the starting player. Map to the existing
    // mulligan_p1 / mulligan_p2 phase naming — "p1" here means "the first of
    // the two mulliganing players" (the starting player), NOT always player1.
    // We reuse the same phase discriminator to avoid downstream consumers
    // needing to handle a new phase; the choosingPlayerId on the pendingChoice
    // is the authoritative source of which player is choosing.
    const mulliganHandIds = state.zones[startingPlayerId].hand;
    state = {
      ...state,
      phase: "mulligan_p1",
      pendingChoice: {
        type: "choose_mulligan",
        choosingPlayerId: startingPlayerId,
        prompt: "Choose cards to put back (you will draw the same number). Select none to keep your hand.",
        validTargets: [...mulliganHandIds],
        optional: true,
      },
    };
    return state;
  }

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

    // Advance to next mulligan phase or start the game. CRD 2.2.2: the
    // starting player mulligans first, then the other player. mulligan_p1 =
    // "starting player's mulligan"; mulligan_p2 = "other player's mulligan".
    // Under the play-draw rule (CRD 2.1.3.2), the starting player may be
    // player2 — so we key the transition off firstPlayerId, not the hardcoded
    // player1/player2 slot names.
    const startingPlayer = state.firstPlayerId ?? "player1";
    if (pendingChoice.choosingPlayerId === startingPlayer) {
      const otherPlayer = getOpponent(startingPlayer);
      const otherHandIds = state.zones[otherPlayer].hand;
      state = {
        ...state,
        phase: "mulligan_p2",
        pendingChoice: {
          type: "choose_mulligan",
          choosingPlayerId: otherPlayer,
          prompt: "Choose cards to put back (you will draw the same number). Select none to keep your hand.",
          validTargets: [...otherHandIds],
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
    const revealCont = pendingChoice._revealContinuation;
    if (revealCont) {
      // reveal_top_conditional matchIsMay continuation (Oswald FAVORABLE CHANCE,
      // Simba King in the Making, Chief Bogo Commanding Officer, etc.)
      const sourceId = pendingChoice.sourceInstanceId ?? "";
      if (choice === "accept") {
        state = applyRevealMatchAction(state, revealCont.revealedInstanceId, revealCont, revealCont.targetPlayerId, playerId, sourceId, definitions, events);
      } else {
        state = applyRevealNoMatchRoute(state, revealCont.revealedInstanceId, revealCont.noMatchDestination ?? "top", revealCont.targetPlayerId, definitions, events);
      }
      state = resumePendingEffectQueue(state, definitions, events);
      return state;
    }
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
    // Resume any queued follow-up effects (same as the other choose branches).
    state = resumePendingEffectQueue(state, definitions, events);
    // CRD 6.1.3: "Choose one" action cards (Pull the Lever!, Wrong Lever!,
    // Trust In Me, Make the Potion) + CRD 4.3.3.2: action moves to discard
    // after its effect + all sub-choices resolve. Without this call, the
    // action card stayed in play after the player picked a branch.
    // Character ability sources (Mrs. Incredible FLEXIBLE THINKING,
    // 6.1.5.2 cards like Madam Mim - Snake / Megara SHADY DEAL / Containment
    // Unit) hit the same RESOLVE_CHOICE path — cleanupPendingAction no-ops
    // for them because `state.pendingActionInstanceId` is undefined.
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_discard" && Array.isArray(choice)) {
    // Discard the chosen cards from hand
    const discardCount = choice.length;
    // Determine who is discarding (the owner of the first card chosen)
    let discardingPlayerId: PlayerID | undefined;
    // Snapshot the discarded cards BEFORE moving so the ResolvedRef captures
    // their hand-state identity. Used by self_replacement (state-based, no
    // target) for Kakamora Pirate Chief: "if a Pirate card was discarded...".
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
    const pendingEff = pendingChoice.pendingEffect as any;

    // peek_and_set_target (Robin Hood Sharpshooter, Powerline): set
    // lastResolvedTarget to the picked card (card stays in deck), move the
    // rest per restPlacement. The next effect in the ability's effects
    // array acts on lastResolvedTarget (typically play_for_free).
    if (pendingEff?.type === "look_at_top" && pendingEff?.action === "peek_and_set_target") {
      const allRevealed = pendingChoice.revealedCards ?? pendingChoice.validTargets ?? [];
      const chosenId = choice.length === 1 ? choice[0]! : undefined;
      const rest = chosenId ? allRevealed.filter((id) => id !== chosenId) : allRevealed;
      // Set lastResolvedTarget on pick (undefined if skipped).
      if (chosenId) {
        const ref = makeResolvedRef(state, definitions, chosenId);
        if (ref) state = { ...state, lastResolvedTarget: ref };
        events.push({ type: "card_revealed", instanceId: chosenId, playerId: owner, sourceInstanceId: pendingChoice.sourceInstanceId ?? "" });
      } else {
        state = { ...state, lastResolvedTarget: undefined };
      }
      // Move unpicked cards per restPlacement.
      const restPlacement = pendingEff.restPlacement ?? "bottom";
      if (restPlacement === "discard") {
        for (const id of rest) state = moveCard(state, id, owner, "discard");
      } else if (restPlacement === "bottom") {
        state = reorderDeckTopToBottom(state, owner, rest, []);
      }
      // "top" placement: cards stay in position — no action needed.
      state = resumePendingEffectQueue(state, definitions, events);
      state = cleanupPendingAction(state, playerId);
      return state;
    }

    // Search effect: move chosen card (single) to its destination, leave rest in deck
    if (pendingEff?.type === "search" && choice.length === 1) {
      const chosenId = choice[0]!;
      if (pendingEff.reveal) {
        events.push({ type: "card_revealed", instanceId: chosenId, playerId: owner, sourceInstanceId: pendingChoice.sourceInstanceId ?? "" });
      }
      if (pendingEff.putInto === "deck" && pendingEff.position === "top") {
        state = moveCard(state, chosenId, owner, "deck", "top");
      } else {
        state = moveCard(state, chosenId, owner, pendingEff.putInto);
      }
      state = resumePendingEffectQueue(state, definitions, events);
      state = cleanupPendingAction(state, playerId);
      return state;
    }

    // look_at_top (choose_from_top): picked card(s) go to pickDestination,
    // rest go to restPlacement.
    // Supports multi-pick (Look at This Family maxToHand=2, DALD maxToHand=2).
    // pickDestination:
    //   - "hand" (default): Develop Your Brain, Ariel, Nani, LatF, DALD, etc.
    //   - "deck_top": Ursula's Cauldron, Merlin Turtle (picked stays at top).
    //   - "inkwell_exerted": Kida Creative Thinker.
    //   - "discard": Mad Hatter Eccentric Host (picked goes to target's discard).
    // revealPicks controls whether picked cards are publicly revealed.
    // Zones resolve per each card's ownerId so chosen-player/opponent-deck
    // flows (Mad Hatter) route to the right player's zones, not the chooser's.
    const allRevealed = pendingChoice.revealedCards ?? pendingChoice.validTargets ?? [];
    const chosenSet = new Set(choice as string[]);
    const rest = allRevealed.filter(id => !chosenSet.has(id));
    const revealPicks = pendingEff?.revealPicks ?? false;
    const pickDestination = pendingEff?.pickDestination ?? "hand";
    const restPlacement = pendingEff?.restPlacement ?? "bottom";
    for (const chosenId of choice as string[]) {
      const cardOwner = state.cards[chosenId]?.ownerId ?? owner;
      if (revealPicks) {
        events.push({ type: "card_revealed", instanceId: chosenId, playerId: owner, sourceInstanceId: pendingChoice.sourceInstanceId ?? "" });
      }
      if (pickDestination === "hand") {
        state = moveCard(state, chosenId, cardOwner, "hand");
      } else if (pickDestination === "inkwell_exerted") {
        state = zoneTransition(state, chosenId, "inkwell", definitions, events, { reason: "inked" });
        state = updateInstance(state, chosenId, { isExerted: true });
        // CRD 6.2: fire card_put_into_inkwell so Oswald et al. pick it up.
        state = queueTriggersByEvent(state, "card_put_into_inkwell", cardOwner, definitions, {});
      } else if (pickDestination === "discard") {
        state = moveCard(state, chosenId, cardOwner, "discard");
      }
      // "deck_top": chosen stays in place. With restPlacement "bottom" (moving
      // the rest to bottom), the chosen card ends up at top naturally.
    }
    // Handle rest placement. Use the rest cards' owner (typically the target
    // player for look_at_top on an opponent/chosen-player deck).
    const restOwner = rest.length > 0 ? (state.cards[rest[0]!]?.ownerId ?? owner) : owner;
    if (restPlacement === "discard") {
      for (const id of rest) {
        const cardOwner = state.cards[id]?.ownerId ?? owner;
        state = moveCard(state, id, cardOwner, "discard");
      }
    } else if (restPlacement === "bottom") {
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
      state = reorderDeckTopToBottom(state, restOwner, rest, []);
    }
    // "top" placement: cards stay where they were after chosen is removed — no-op.
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
          // CRD 6.2: fire card_put_into_inkwell so cross-card watchers see it.
          state = queueTriggersByEvent(state, "card_put_into_inkwell", playerId, definitions, {});
        } else {
          state = moveCard(state, topId, playerId, "hand");
        }
        // Lore branch on match (Bruno Madrigal Undetected Uncle: "and gain 3 lore").
        const loreOnHit = (pendingEffect as any)?.gainLoreOnHit;
        if (typeof loreOnHit === "number" && loreOnHit > 0) {
          state = gainLore(state, playerId, loreOnHit, events, definitions);
        }
      }
      // else: leave on top — no-op
    }
    return state;
  }

  // CRD "up to N": player chose a specific amount (0..max)
  if (pendingChoice.type === "choose_amount" && typeof choice === "number") {
    const amount = Math.max(pendingChoice.min ?? 0, Math.min(choice, pendingChoice.max ?? choice));
    const pendingEffect = pendingChoice.pendingEffect;
    const srcId = pendingChoice.sourceInstanceId ?? "";
    const trigId = pendingChoice.triggeringCardInstanceId;
    if (pendingEffect) {
      // Override the effect's amount with the chosen value, then apply to the stored target
      const targetId = state.lastResolvedTarget?.instanceId;
      if (targetId && state.cards[targetId]) {
        const overridden = { ...pendingEffect, amount, isUpTo: false } as Effect;
        state = applyEffectToTarget(state, overridden, targetId, playerId, definitions, events, srcId, trigId);
      }
    }
    state = resumePendingEffectQueue(state, definitions, events);
    state = cleanupPendingAction(state, playerId);
    return state;
  }

  if (pendingChoice.type === "choose_target" && Array.isArray(choice)) {
    // Alt-cost Shift chooser (Diablo, Flotsam). Re-invoke applyPlayCard with
    // the chosen cost IDs filled in — lands in the altShiftCostInstanceIds
    // branch and completes the shift normally.
    const altShiftCont = pendingChoice._altShiftCostContinuation;
    if (altShiftCont) {
      state = { ...state, pendingChoice: null };
      state = applyPlayCard(state, altShiftCont.playerId, altShiftCont.characterInstanceId, definitions, events, altShiftCont.shiftTargetInstanceId, undefined, undefined, undefined, choice as string[]);
      state = resumePendingEffectQueue(state, definitions, events);
      state = cleanupPendingAction(state, playerId);
      return state;
    }
    // Granted-free-play alt-cost chooser (Belle, Scrooge). Pay the cost with
    // the chosen instances, then move the character/item from hand to play.
    const freePlayCont = pendingChoice._freePlayContinuation;
    if (freePlayCont) {
      const { characterInstanceId, costType } = freePlayCont;
      const charDef = getDefinition(state, characterInstanceId, definitions);
      if (costType === "banish_chosen") {
        for (const id of choice) state = banishCard(state, id, definitions, events);
      } else if (costType === "exert_n_matching") {
        for (const id of choice) state = exertInstance(state, id, definitions);
      } else if (costType === "discard") {
        for (const id of choice) state = moveCard(state, id, playerId, "discard");
      }
      state = zoneTransition(state, characterInstanceId, "play", definitions, events, {
        reason: "played", triggeringPlayerId: playerId,
      });
      if (charDef.cardType === "character") {
        state = updateInstance(state, characterInstanceId, { isDrying: true });
      }
      // cardsPlayedThisTurn is tracked centrally in zoneTransition.
      state = appendLog(state, {
        turn: state.turnNumber,
        playerId,
        message: `${playerId} played ${charDef.fullName} for free.`,
        type: "card_played",
      });
      state = applyEnterPlayExertion(state, characterInstanceId, playerId, definitions);
      state = resumePendingEffectQueue(state, definitions, events);
      state = cleanupPendingAction(state, playerId);
      return state;
    }
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

      // Hades - Looking for a Deal was previously handled as a special case
      // here. Migrated to the generic opponent_may_pay_to_avoid effect type
      // (same pattern as Tiana Restaurant Owner) in commit series. The
      // card JSON now uses a no-op chooser → opponent_may_pay_to_avoid chain.

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
        // Queue chosen_by_opponent self-triggers so cards like Archimedes
        // can react. These fire on BOTH actions and abilities — oracle on
        // Archimedes: "whenever an opponent chooses this character for an
        // action or ability, you may draw a card." Card-level conditions
        // (e.g. Tod's `is_your_turn` gate) narrow further per-card.
        state = queueTrigger(state, "chosen_by_opponent", targetId, definitions, {
          triggeringPlayerId: targetInst.ownerId,
          triggeringCardInstanceId: srcId,
        });
        // CRD 8.14.1: Vanish fires ONLY when the choice is part of resolving
        // an ACTION card's effect. Reminder text on every Vanish card (Iago,
        // Giant Cobra, Rajah, Palace Guard, Abu, The Sultan, Magic Carpet):
        // "When an opponent chooses this character for an action, banish them."
        // Choices made by characters' / items' / locations' triggered or
        // activated abilities DON'T trigger Vanish — that's an explicit
        // carve-out in the CRD. Gate on source card's cardType.
        const srcInst = srcId ? state.cards[srcId] : undefined;
        const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
        if (srcDef?.cardType === "action") {
          const vanishMods = getGameModifiers(state, definitions);
          if (hasKeyword(targetInst, targetDef, "vanish", vanishMods)) {
            state = zoneTransition(state, targetId, "discard", definitions, events, { reason: "banished", triggeringPlayerId: targetInst.ownerId });
          }
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
  if (amount === "cost_result") return state.lastEffectResult ?? 0;
  // "damage_on_target" was declared but never used by any card JSON. Deleted.
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
  if (amount === "last_damage_dealt") {
    return state.lastDamageDealtAmount ?? 0;
  }
  if (amount === "unique_ink_types_on_top_of_both_decks") {
    const inks = new Set<string>();
    for (const pid of ["player1", "player2"] as PlayerID[]) {
      const deck = getZone(state, pid, "deck");
      const topId = deck[0];
      if (topId) {
        const inst = state.cards[topId];
        const def = inst ? definitions[inst.definitionId] : undefined;
        if (def?.inkColors) for (const ink of def.inkColors) inks.add(ink);
      }
    }
    return inks.size;
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
  if (amount === "last_resolved_target_strength") {
    return state.lastResolvedTarget?.strength ?? 0;
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
      if (inst && def) {
        const mods = getGameModifiers(state, definitions);
        resolved = getEffectiveLore(inst, def, mods.statBonuses.get(targetInstanceId!)?.lore ?? 0);
      }
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
      if (inst && def) {
        const mods = getGameModifiers(state, definitions);
        resolved = getEffectiveStrength(inst, def, mods.statBonuses.get(targetInstanceId!)?.strength ?? 0, mods);
      }
      break;
    }
    case "source_lore": {
      const inst = state.cards[sourceInstanceId];
      const def = inst ? definitions[inst.definitionId] : undefined;
      if (inst && def) {
        const mods = getGameModifiers(state, definitions);
        resolved = getEffectiveLore(inst, def, mods.statBonuses.get(sourceInstanceId)?.lore ?? 0);
      }
      break;
    }
    case "source_strength": {
      const inst = state.cards[sourceInstanceId];
      const def = inst ? definitions[inst.definitionId] : undefined;
      if (inst && def) {
        const mods = getGameModifiers(state, definitions);
        resolved = getEffectiveStrength(inst, def, mods.statBonuses.get(sourceInstanceId)?.strength ?? 0, mods);
      }
      break;
    }
    case "cards_under_count": {
      // CRD 8.4.2: "for each card under this character" — count the source's pile.
      const inst = state.cards[sourceInstanceId];
      resolved = inst?.cardsUnder.length ?? 0;
      break;
    }
    case "triggering_card_cards_under_count": {
      // Donald Duck Fred Honeywell WELL WISHES: "draw a card for each card
      // that was under them". Reads the snapshot captured at banish time
      // before leave-play cleanup cleared cardsUnder.
      resolved = state.lastBanishedCardsUnderCount ?? 0;
      break;
    }
    case "count_last_discarded": {
      // The Headless Horseman WITCHING HOUR: "deal 2 damage for each action
      // card discarded this way". Count lastDiscarded entries matching the
      // filter, multiplied by `multiplier` (default 1).
      const refs = state.lastDiscarded ?? [];
      let cnt = 0;
      for (const ref of refs) {
        if (!amount.filter) { cnt++; continue; }
        const inst = state.cards[ref.instanceId];
        const d = inst ? definitions[inst.definitionId] : undefined;
        if (inst && d && matchesFilter(inst, d, amount.filter, state, controllingPlayerId)) cnt++;
      }
      resolved = cnt * (amount.multiplier ?? 1);
      break;
    }
  }
  const max = (amount as { max?: number }).max;
  if (typeof max === "number") resolved = Math.min(resolved, max);
  return resolved;
}

/** Effect types whose `condition` field is a gating predicate ("if X, do
 *  this effect"). Listed explicitly because some effects (self_replacement)
 *  use `condition` as a branch selector with different semantics. */
const CONDITION_GATED_EFFECTS = new Set<string>(["draw", "gain_lore", "lose_lore", "move_damage", "play_card"]);

export function applyEffect(
  state: GameState,
  effect: Effect,
  sourceInstanceId: string,
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  triggeringCardInstanceId?: string
): GameState {
  // CRD 6.1.7: per-effect optional gating condition. Cards like Marching Off
  // to Battle ("If a character was banished this turn, draw 2 cards") encode
  // this as an effect-level condition. Fizzles silently when false. Distinct
  // from ability-level conditions (which gate the whole ability) — useful for
  // actionEffects (no parent ability) and for one branch of a multi-effect
  // ability that should fire conditionally without affecting siblings.
  // Whitelisted to specific effect types because some effects (self_replacement)
  // use a `condition` field with different semantics (branch selector, not
  // gate) and adding generic check would skip the whole effect instead of
  // routing to the default branch.
  if (CONDITION_GATED_EFFECTS.has(effect.type)) {
    const cond = (effect as { condition?: import("../types/index.js").Condition }).condition;
    if (cond && !evaluateCondition(cond, state, definitions, controllingPlayerId, sourceInstanceId)) {
      return state;
    }
  }
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

    case "reveal_hand":
    case "look_at_hand": {
      // reveal_hand: public — all players see the cards (Copper Hound Pup FOUND YA).
      // look_at_hand: private — only the controller sees (Dolores Madrigal
      // NO SECRETS "look at chosen opponent's hand"). Same data pipeline,
      // differ only in the privateTo flag stamped on the event + snapshot.
      if (effect.target.type === "chosen") {
        return surfaceChoosePlayer(state, effect, controllingPlayerId, sourceInstanceId, definitions, events);
      }
      const targetPlayer: PlayerID =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : effect.target.type === "target_owner"
            ? (state.lastResolvedTarget?.ownerId ?? getOpponent(controllingPlayerId))
            : effect.target.type === "self"
              ? controllingPlayerId
              : getOpponent(controllingPlayerId);
      const handCardIds = [...state.zones[targetPlayer].hand];
      const privateTo = effect.type === "look_at_hand" ? controllingPlayerId : undefined;
      events.push({
        type: "hand_revealed",
        playerId: targetPlayer,
        cardInstanceIds: handCardIds,
        sourceInstanceId,
        ...(privateTo ? { privateTo } : {}),
      } as GameEvent);
      return { ...state, lastRevealedHand: { playerId: targetPlayer, cardIds: handCardIds, ...(privateTo ? { privateTo } : {}) } };
    }

    // Unified lore adjustment — gain_lore and lose_lore are aliases.
    // gain_lore uses the literal signed amount; lose_lore negates it.
    // Both track lastEffectResult = absolute delta for cost_result readers.
    case "gain_lore":
    case "lose_lore": {
      if (effect.target.type === "chosen") {
        return surfaceChoosePlayer(state, effect, controllingPlayerId, sourceInstanceId, definitions, events);
      }
      const rawAmount = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, state.lastResolvedTarget?.instanceId);
      const signedAmount = effect.type === "lose_lore" ? -rawAmount : rawAmount;
      // "Each player gains N lore" — apply to both (I2I). CRD: target { type: "both" }.
      if (effect.target.type === "both") {
        state = gainLore(state, controllingPlayerId, signedAmount, events, definitions);
        state = gainLore(state, getOpponent(controllingPlayerId), signedAmount, events, definitions);
        return state;
      }
      const targetPlayer =
        effect.target.type === "opponent"
          ? getOpponent(controllingPlayerId)
          : effect.target.type === "target_owner"
            ? (state.lastResolvedTarget?.ownerId ?? controllingPlayerId)
            : controllingPlayerId;
      const loreBefore = state.players[targetPlayer].lore;
      state = gainLore(state, targetPlayer, signedAmount, events, definitions);
      const loreAfter = state.players[targetPlayer].lore;
      state = { ...state, lastEffectResult: Math.abs(loreBefore - loreAfter) };
      return state;
    }

    case "deal_damage": {
      const resolveAmount = (amt: typeof effect.amount): number =>
        resolveDynamicAmount(amt, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, state.lastResolvedTarget?.instanceId);
      if (effect.target.type === "this") {
        return dealDamageToCard(state, sourceInstanceId, resolveAmount(effect.amount), definitions, events, false, false, effect.asPutDamage, sourceInstanceId);
      }
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        return dealDamageToCard(state, triggeringCardInstanceId, resolveAmount(effect.amount), definitions, events, false, false, effect.asPutDamage, sourceInstanceId);
      }
      if (effect.target.type === "chosen") {
        const choosingPlayerId = chosenChooserPlayerId(effect.target, controllingPlayerId);
        const validTargets = findChosenTargets(state, effect.target.filter, choosingPlayerId, definitions, sourceInstanceId);
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
          state = dealDamageToCard(state, targetId, amount, definitions, events, false, false, effect.asPutDamage, sourceInstanceId);
        }
        return state;
      }
      return state;
    }

    case "banish": {
      // CRD 5.4.1.2 + 1.7.7. "Grab Your Bow: banish up to 2 chosen characters"
      // → target.count > 1 + up-to-N prompt. skipIfNotInPlay defends cascading
      // "banish all" iterations where earlier banishes' triggers could remove
      // the same card. See resolveTargetAndApply (reducer.ts) for dispatch.
      return resolveTargetAndApply(state, effect, {
        prompt: "Choose a target to banish.",
        promptForCount: (n) => `Choose up to ${n} targets to banish.`,
        perInstance: (s, id, ev) => banishCard(s, id, definitions, ev),
        skipIfNotInPlay: true,
      }, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
    }

    case "return_to_hand": {
      // Milo Thatch TAKE THEM BY SURPRISE "all" variant and Yzma BACK TO
      // WORK "triggering_card" variant with lastResolvedTarget pin for the
      // "target_owner" follow-up. See resolveTargetAndApply for dispatch.
      return resolveTargetAndApply(state, effect, {
        prompt: "Choose a card to return to hand.",
        perInstance: (s, id, ev) => zoneTransition(s, id, "hand", definitions, ev, { reason: "returned" }),
        setLastResolvedTargetOnTriggering: true,
        skipIfNotInPlay: true,
      }, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
    }

    case "remove_damage": {
      // Vision Slab TRAPPED!: "Damage counters can't be removed." The effect
      // is consumed (caller paid costs) but does nothing, and no
      // `damage_removed_from` trigger fires since no damage was actually
      // removed. Guard at BOTH `remove_damage` sites (here + the resolved-
      // target path in applyEffectToTarget) so the "chosen" target branch
      // doesn't queue a pendingChoice for a no-op either.
      const mods = getGameModifiers(state, definitions);
      if (mods.preventDamageRemoval) {
        state = { ...state, lastEffectResult: 0 };
        return state;
      }
      if (effect.target.type === "this") {
        const instance = getInstance(state, sourceInstanceId);
        const actualRemoved = Math.min(effect.amount, instance.damage);
        state = updateInstance(state, sourceInstanceId, {
          damage: Math.max(0, instance.damage - effect.amount),
        });
        if (actualRemoved > 0) {
          state = markRemovedDamageThisTurn(state, controllingPlayerId);
          state = queueTrigger(state, "damage_removed_from", sourceInstanceId, definitions, {});
        }
        return state;
      }
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7
        // Ever as Before: "any number of chosen characters" — count>1 enables
        // multi-select; isMay lets the player pick 0.
        const count = effect.target.count ?? 1;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: count > 1
              ? `Choose up to ${count} characters to remove damage from.`
              : "Choose a character to remove damage from.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: true, // "Remove up to N" — player can decline
            count,
          },
        };
      }
      if (effect.target.type === "all") {
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          const inst = getInstance(state, targetId);
          const actualRemoved = Math.min(effect.amount, inst.damage);
          state = updateInstance(state, targetId, {
            damage: Math.max(0, inst.damage - effect.amount),
          });
          if (actualRemoved > 0) {
            state = markRemovedDamageThisTurn(state, controllingPlayerId);
            state = queueTrigger(state, "damage_removed_from", targetId, definitions, {});
          }
        }
        return state;
      }
      return state;
    }

    case "gain_stats": {
      // Direct targets (this / triggering_card / last_resolved_target)
      const directGS = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directGS && state.cards[directGS]) {
        return applyGainStatsToInstance(state, directGS, effect, controllingPlayerId, definitions, sourceInstanceId);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        for (const id of targets) state = applyGainStatsToInstance(state, id, effect, controllingPlayerId, definitions, sourceInstanceId);
        return state;
      }
      return state;
    }

    case "damage_prevention_timed": {
      // Noi Acrobatic Baby (self), Pirate Mickey (chosen Pirate),
      // Nothing We Won't Do (all your chars). Applies a source-tagged
      // damage_prevention TimedEffect for the requested duration. If `charges`
      // is set, the immunity expires after that many blocked hits
      // (Rapunzel Ready for Adventure).
      const timed: TimedEffect = {
        type: "damage_prevention",
        damageSource: effect.source,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
        ...(effect.charges !== undefined ? { charges: effect.charges } : {}),
      };
      // Direct targets (this / triggering_card / last_resolved_target)
      const directDI = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directDI) return addTimedEffect(state, directDI, timed);
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        sourceInstanceId,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timed);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        // CRD 6.4.2.1: continuous static — store globally so newly played cards are affected too
        if (effect.continuous) {
          const existing = state.globalTimedEffects ?? [];
          return {
            ...state,
            globalTimedEffects: [...existing, {
              type: "cant_be_challenged",
              filter: effect.target.filter,
              controllingPlayerId,
              sourceInstanceId,
              expiresAt: effect.duration,
              appliedOnTurn: state.turnNumber,
            }],
          };
        }
        // CRD 6.4.2.2: applied static — only affects current cards
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
      // target "both": iterate over each player independently (Let's Get Dangerous).
      if (effect.target.type === "both") {
        // Resolve player1 first; if their reveal creates a pendingChoice
        // (matchIsMay), queue player2's reveal as a continuation so the
        // second player isn't dropped (Let's Get Dangerous regression).
        const player2Effect: Effect = { ...effect, target: { type: "self" as const } };
        state = applyEffect(state, { ...effect, target: { type: "self" } }, sourceInstanceId, "player1", definitions, events, triggeringCardInstanceId);
        if (state.pendingChoice) {
          const existingQueue = state.pendingEffectQueue?.effects ?? [];
          state = {
            ...state,
            pendingEffectQueue: {
              effects: [player2Effect, ...existingQueue],
              sourceInstanceId,
              controllingPlayerId: "player2",
            },
          };
          return state;
        }
        state = applyEffect(state, player2Effect, sourceInstanceId, "player2", definitions, events, triggeringCardInstanceId);
        return state;
      }
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
      // CRD: the card is publicly revealed regardless of whether it matches.
      // Fire card_revealed so the UI / opponent / replay see the top card
      // (Daisy Duck Donald's Date BIG PRIZE, Sisu Uniting Dragon, etc.).
      events.push({ type: "card_revealed", instanceId: topId, playerId: targetPlayer, sourceInstanceId });
      const matches = matchesFilter(topInst, topDef, effect.filter, state, targetPlayer);
      if (matches) {
        // CRD 6.1.4: second "may" — "if it's X, [player] may Y". When
        // matchIsMay is set, pause here with a choose_may. The chooser is the
        // player whose deck was revealed (targetPlayer) — same as whoever
        // will take the card into hand / play it. For self-targeting reveals
        // (Oswald, Simba, Chief Bogo) this equals controllingPlayerId; for
        // opponent-targeting reveals (Daisy Duck Donald's Date BIG PRIZE:
        // "each opponent reveals... THEY may put it into their hand") this
        // correctly hands the may-prompt to the opponent.
        if (effect.matchIsMay) {
          const sourceDef = definitions[state.cards[sourceInstanceId]?.definitionId ?? ""];
          const cardName = sourceDef?.fullName ?? sourceInstanceId;
          const revealedName = topDef.fullName;
          state = {
            ...state,
            pendingChoice: {
              type: "choose_may",
              choosingPlayerId: targetPlayer,
              prompt: `${cardName}: revealed ${revealedName}. ${effect.matchAction === "play_card" ? "Play it for free" : effect.matchAction === "to_hand" ? "Put it into your hand" : "Put it into inkwell exerted"}?`,
              optional: true,
              sourceInstanceId,
              _revealContinuation: {
                revealedInstanceId: topId,
                matchAction: effect.matchAction,
                matchEnterExerted: effect.matchEnterExerted,
                matchPayCost: effect.matchPayCost,
                matchExtraEffects: effect.matchExtraEffects,
                noMatchDestination: effect.noMatchDestination,
                targetPlayerId: targetPlayer,
              },
            },
          };
          return state;
        }
        state = applyRevealMatchAction(state, topId, effect, targetPlayer, controllingPlayerId, sourceInstanceId, definitions, events);
      } else {
        // CRD: revealed but not matching → put on top (default), bottom, hand, or discard.
        state = applyRevealNoMatchRoute(state, topId, effect.noMatchDestination ?? "top", targetPlayer, definitions, events);
        return state;
      }
      // repeatOnMatch: continue the loop with the new top card.
      if (!effect.repeatOnMatch) return state;
      }
      return state;
    }

    case "put_card_on_bottom_of_deck": {
      // CRD: place card(s) on the bottom (or top) of a deck without shuffling.
      // See PutCardOnBottomOfDeckEffect docs for variants.
      const amount = effect.amount ?? 1;
      const ownerScope = effect.ownerScope ?? "self";
      const position: "top" | "bottom" = effect.position ?? "bottom";
      const targetPlayer =
        ownerScope === "self" ? controllingPlayerId
        : ownerScope === "opponent" ? getOpponent(controllingPlayerId)
        : /* target_player — controller picks; engine picks opponent in 2P */ getOpponent(controllingPlayerId);

      if (effect.from === "play") {
        // Chosen character moves to its OWN owner's deck at configured
        // position. chooser:"target_player" flips the picker to the opponent
        // (The Family Scattered "Chosen opponent chooses 3 of their characters
        // ... puts one on top/bottom"). Filter's owner:"self" resolves
        // relative to the chooser. See resolveTargetAndApply for dispatch.
        const effectWithDefaultTarget = {
          ...effect,
          target: effect.target ?? { type: "chosen", filter: { zone: "play", cardType: ["character"] } },
        };
        return resolveTargetAndApply(state, effectWithDefaultTarget, {
          prompt: position === "top"
            ? "Choose a card to put on top of its owner's deck."
            : "Choose a card to put on the bottom of its owner's deck.",
          perInstance: (s, id) => {
            const inst = s.cards[id];
            if (!inst) return s;
            return moveCard(s, id, inst.ownerId, "deck", position);
          },
        }, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
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
      // char's L, then bottom-deck it). When amount > 1, the prompt becomes
      // multi-pick (Hypnotic Deduction: "put 2 cards from your hand on top
      // of your deck in any order").
      if (effect.target && effect.target.type === "chosen" && pool.length > 0) {
        const pickCount = Math.min(amount, pool.length);
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: pickCount > 1
              ? (position === "top"
                ? `Choose ${pickCount} cards to put on top of your deck (in chosen order).`
                : `Choose ${pickCount} cards to put on the bottom of your deck.`)
              : (position === "top"
                ? "Choose a card to put on top of its deck."
                : "Choose a card to put on the bottom of its deck."),
            validTargets: pool,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
            count: pickCount,
          },
        };
      }
      if (pool.length === 0) return state; // CRD 1.7.7
      const moveCount = Math.min(amount, pool.length);
      let moved = 0;
      for (let i = 0; i < moveCount; i++) {
        const cardId = pool[i]!;
        state = moveCard(state, cardId, targetPlayer, "deck", position);
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
            costReductions: [...existing, { amount: effect.amount, filter: effect.filter, sourceInstanceId }],
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
        // Stash the resolved-source list on the cloned effect so the destination
        // resolution path can drain damage from each source.
        const resolvedSources = sources
          .map((id) => makeResolvedRef(state, definitions, id))
          .filter((r): r is ResolvedRef => !!r);
        // Can't Hold It Back Anymore: destination "last_resolved_target" pins
        // the drain to the previously-exerted character — no second prompt.
        if (effect.destination.type === "last_resolved_target") {
          const destId = state.lastResolvedTarget?.instanceId;
          if (!destId || !state.cards[destId]) {
            state = { ...state, lastEffectResult: 0 };
            return state;
          }
          return applyEffectToTarget(
            state,
            { ...effect, _resolvedSources: resolvedSources } as any,
            destId,
            controllingPlayerId,
            definitions,
            events,
            sourceInstanceId,
            triggeringCardInstanceId,
          );
        }
        const validDestinations = findChosenTargets(state, effect.destination.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validDestinations.length === 0) {
          state = { ...state, lastEffectResult: 0 };
          return state;
        }
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
      const validSources = findChosenTargets(state, sourceFilter, controllingPlayerId, definitions, sourceInstanceId);
      if (validSources.length === 0) return state; // CRD 1.7.7
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose a character to move damage from.",
          validTargets: validSources,
          pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          optional: effect.isMay ?? false,
        },
      };
    }

    case "put_top_card_under": {
      // CRD 8.4.2: Move the top card of the controller's deck under a target.
      // target: "this" → the source instance. "chosen" → player picks an
      // eligible in-play card (typically "one of your characters or locations
      // with Boost"). "triggering_card" → strict "under THEM" referring to
      // the just-played card on a card_played trigger (Scrooge McDuck Cavern
      // Prospector SPECULATION). The chosen path surfaces a choose_target
      // pendingChoice and is resolved later in applyEffectToTarget.
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      if (effect.target.type === "triggering_card" && triggeringCardInstanceId) {
        // Reroute through applyEffectToTarget so the existing "this"-style
        // "put top under target" logic runs against the just-played card.
        return applyEffectToTarget(state, { ...effect, target: { type: "this" } } as any, triggeringCardInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId, triggeringCardInstanceId);
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
          [topId]: { ...topInst, zone: "under", isFaceDown: true },
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

    // Unified CRD 8.4.2 / 8.10.5 handler: drain cardsUnder pile(s) to a
    // destination. Replaces the 3 legacy primitives (into_hand / into_inkwell
    // / onto_target). The source field chooses which parent's pile to drain;
    // the destination field decides routing + which cross-card triggers to
    // fire.
    case "drain_cards_under": {
      const src = effect.source ?? "this";
      // Chosen source: surface pendingChoice, resume in applyEffectToTarget.
      if (typeof src === "object" && src.type === "chosen") {
        const validTargets = findChosenTargets(state, src.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a card whose under-pile to drain.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
          },
        };
      }
      // Target-pile destination with chosen target: surface pendingChoice to
      // pick the receiving parent. Resumes in applyEffectToTarget.
      if (typeof effect.destination === "object" && effect.destination.type === "target_pile") {
        const destTarget = effect.destination.target;
        if (destTarget.type === "chosen") {
          const validTargets = findValidTargets(state, destTarget.filter, controllingPlayerId, definitions, sourceInstanceId);
          if (validTargets.length === 0) return state;
          return {
            ...state,
            pendingChoice: {
              type: "choose_target",
              choosingPlayerId: controllingPlayerId,
              prompt: "Choose a card or location to move cards under.",
              validTargets,
              pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
              optional: effect.isMay ?? false,
            },
          };
        }
      }
      // Direct source: "this" or "all_own".
      const parentIds: string[] = src === "all_own"
        ? getZone(state, controllingPlayerId, "play").filter(id => {
            const p = state.cards[id];
            return p && p.cardsUnder.length > 0;
          })
        : (state.cards[sourceInstanceId]?.cardsUnder.length ?? 0) > 0
          ? [sourceInstanceId]
          : [];
      state = drainCardsUnderFrom(state, parentIds, effect.destination, controllingPlayerId, definitions, events);
      return state;
    }

    // ready_singers: DELETED — subsumed by each_target with
    // source: { type: "state_ids", key: "lastSongSingerIds" }.
    // I2I and Fantastical and Magical now use each_target directly.

    // put_cards_under_onto_target: folded into drain_cards_under with
    // destination:{type:"target_pile",target}.

    // Rerouted to the self_replacement handler (see case "self_replacement").
    // The state-based Kakamora variant (no target field) evaluates condition
    // against state.lastDiscarded; the target-based variant surfaces a
    // choose_target pendingChoice and resolves via applyEffectToTarget.

    case "put_self_under_target": {
      // CRD 8.4.2: Roo - Little Helper HOPPING IN ("Put this character facedown
      // under one of your characters or locations with Boost"). Surfaces a
      // choose_target on controller's in-play matching cards; resolution path
      // removes the source from play and appends it to the target's cardsUnder.
      const validTargets = findChosenTargets(state, effect.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      state = moveCard(state, topIdNonInt, controllingPlayerId, "hand");
      // Lore branch on match (Bruno Madrigal Undetected Uncle). Bot always
      // hits, so the lore gain always fires when gainLoreOnHit is set.
      if (typeof (effect as any).gainLoreOnHit === "number" && (effect as any).gainLoreOnHit > 0) {
        state = gainLore(state, controllingPlayerId, (effect as any).gainLoreOnHit, events, definitions);
      }
      return state;
    }

    case "move_character": {
      // Special path: character "all" + location "chosen" — surface a single
      // choose_target for the LOCATION, then move every matching character to
      // it on resolution. Records the moved count on lastEffectResult so a
      // follow-up gain_lore can pay per-character (Moana Kakamora Leader).
      if (effect.character.type === "all") {
        if (effect.location.type !== "chosen") return state;
        const validLocations = findChosenTargets(state, effect.location.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const validTargets = findChosenTargets(state, effect.character.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        const validLocations = findChosenTargets(state, effect.location.filter, controllingPlayerId, definitions, sourceInstanceId);
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

    case "gets_stat_while_challenging": {
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
        const validTargets = findChosenTargets(state, effect.target.filter, choosingPlayerId, definitions, sourceInstanceId);
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
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
      };
      const directGK = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directGK && state.cards[directGK]) return addTimedEffect(state, directGK, timedEffect);
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        // CRD 6.4.2.1: continuous — store globally so newly played cards are affected too
        if (effect.continuous) {
          const existing = state.globalTimedEffects ?? [];
          return {
            ...state,
            globalTimedEffects: [...existing, {
              type: "grant_keyword",
              keyword: effect.keyword,
              keywordValue: effect.value,
              filter: effect.target.filter,
              controllingPlayerId,
              sourceInstanceId,
              expiresAt: effect.duration,
              appliedOnTurn: state.turnNumber,
            }],
          };
        }
        // CRD 6.4.2.2: applied — only affects current cards
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        for (const targetId of targets) {
          state = addTimedEffect(state, targetId, timedEffect);
        }
        return state;
      }
      return state;
    }

    case "remove_keyword_target": {
      // Maui Soaring Demigod IN MA BELLY: "loses Reckless this turn".
      const timedEffect: TimedEffect = {
        type: "suppress_keyword",
        keyword: effect.keyword,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
      };
      const directRKT = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directRKT && state.cards[directRKT]) return addTimedEffect(state, directRKT, timedEffect);
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
      // a new RestrictedAction value (e.g. "ready_anytime") and check it here.
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
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      // Alma Madrigal Accepting Grandmother THE MIRACLE IS YOU: "whenever
      // one or more of your characters sings a song, you may ready those
      // characters." For Sing Together (multiple singers on one song),
      // `state.lastSongSingerIds` carries the full singer roster set in
      // applyPlayCard:497. With oncePerTurn at the ability level, only the
      // first sing event of the turn fires the trigger; the effect then
      // readies ALL singers from that one song event (1 for solo sing,
      // N for Sing Together).
      if (effect.target.type === "last_song_singers") {
        const singers = state.lastSongSingerIds ?? [];
        for (const id of singers) {
          const inst = state.cards[id];
          if (!inst) continue;
          const wasExerted = inst.isExerted;
          state = updateInstance(state, id, { isExerted: false });
          if (wasExerted) {
            state = queueTrigger(state, "readied", id, definitions, {});
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
      // John Silver Ferocious Friend: after the cost-step damage chose a
      // target, ready THAT character via last_resolved_target and apply
      // the "can't quest this turn" follow-up to the same card.
      if (effect.target.type === "last_resolved_target") {
        const id = state.lastResolvedTarget?.instanceId;
        if (!id || !state.cards[id]) return state;
        return applyEffectToTarget(state, effect, id, controllingPlayerId, definitions, events, sourceInstanceId, triggeringCardInstanceId);
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
        sourceInstanceId,
      };
      const directMQ = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directMQ && state.cards[directMQ]) return addTimedEffect(state, directMQ, timedEffect);
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
        sourceInstanceId,
      };
      if (effect.target.type === "this") {
        return addTimedEffect(state, sourceInstanceId, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      // Mad Hatter Eccentric Host: "chosen player's deck" — surface chooser
      // first, then re-apply with substituted self/opponent target.
      if (effect.target.type === "chosen") {
        return surfaceChoosePlayer(state, effect, controllingPlayerId, sourceInstanceId, definitions, events);
      }
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
        case "top_or_bottom": {
          // Bot heuristic: keep on top (simple strategy)
          // No actual change needed — card stays where it is
          return state;
        }
        case "reorder": {
          // Merlin Turtle WHERE DID I PUT THAT?: "look at top N, put one on
          // top of your deck and the other(s) on the bottom." Bot heuristic:
          // keep top[0], put the rest on bottom. Cheap and analytics-friendly.
          if (topCards.length <= 1) return state;
          const toBottom = topCards.slice(1);
          state = reorderDeckTopToBottom(state, targetPlayer, toBottom, []);
          return state;
        }
        case "peek_and_set_target": {
          // Pure chooser: peek top N, optionally pick ONE matching card and
          // set lastResolvedTarget to it (card stays in deck). Move the rest
          // per restPlacement. The picked card is acted on by the NEXT effect
          // in the ability's effects array (typically play_for_free with
          // target: last_resolved_target, sourceZone: "deck").
          //
          // Powerline World's Greatest Rock Star: restPlacement "bottom".
          // Robin Hood Sharpshooter: restPlacement "discard".
          const restPlacement = effect.restPlacement ?? "bottom";
          const moveRest = (ids: string[]) => {
            if (restPlacement === "discard") {
              for (const id of ids) {
                state = moveCard(state, id, targetPlayer, "discard");
              }
            } else if (restPlacement === "top") {
              // Cards stay on top in original order — no-op.
            } else {
              state = reorderDeckTopToBottom(state, targetPlayer, ids, []);
            }
          };
          // Compute matching cards (for interactive chooser or bot greedy).
          const matchingCards = effect.filter
            ? topCards.filter((id) => {
                const inst = state.cards[id];
                const def = inst ? definitions[inst.definitionId] : undefined;
                return inst && def ? matchesFilter(inst, def, effect.filter!, state, controllingPlayerId) : false;
              })
            : [...topCards];
          // Clear any stale lastResolvedTarget — if the player skips, it stays cleared.
          state = { ...state, lastResolvedTarget: undefined };
          if (state.interactive) {
            // Surface a choose_from_revealed. On resolve: set lastResolvedTarget
            // to the picked card and move rest per restPlacement. isMay maps to
            // optional; when the player skips, rest still moves per oracle.
            return {
              ...state,
              pendingChoice: {
                type: "choose_from_revealed",
                choosingPlayerId: controllingPlayerId,
                prompt: matchingCards.length === 0
                  ? `No matching cards found — continuing.`
                  : `Choose 1 card to set as the selected target (or skip).`,
                validTargets: matchingCards,
                revealedCards: topCards,
                pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
                optional: effect.isMay ?? true,
              },
            };
          }
          // Bot/headless: greedy — pick first match if any, set lastResolvedTarget,
          // move the rest per restPlacement.
          if (matchingCards.length === 0) {
            moveRest(topCards);
            return state;
          }
          const pickedId = matchingCards[0]!;
          const rest = topCards.filter((id) => id !== pickedId);
          const ref = makeResolvedRef(state, definitions, pickedId);
          if (ref) state = { ...state, lastResolvedTarget: ref };
          moveRest(rest);
          return state;
        }
        case "choose_from_top": {
          // Generalized chooser: peek top N, pick up to maxToHand cards
          // (optionally matching filter/filters), picked cards go to
          // pickDestination (default "hand"), rest go to restPlacement.
          //
          // Three filter modes:
          //   1. effect.filters (array): pick at most one card matching each
          //      filter in order (The Family Madrigal).
          //   2. effect.filter (single): pick first up to maxToHand matching.
          //   3. neither: pick first maxToHand cards unconditionally (Dig a
          //      Little Deeper, Ursula's Cauldron).
          //
          // pickDestination variants:
          //   - "hand" (default): Develop Your Brain, Ariel, Nani, LatF, DALD, etc.
          //   - "deck_top": Ursula's Cauldron, Merlin Turtle (picked stays at top).
          //   - "inkwell_exerted": Kida Creative Thinker.
          const maxToHand = effect.maxToHand ?? 1;
          const pickDestination = effect.pickDestination ?? "hand";

          // Interactive mode: show the cards and let the player choose
          if (state.interactive) {
            // Find which of the revealed cards match the filter(s)
            let matchingCards: string[];
            if (effect.filters && effect.filters.length > 0) {
              matchingCards = topCards.filter((id) => {
                const inst = state.cards[id];
                const def = inst ? definitions[inst.definitionId] : undefined;
                if (!inst || !def) return false;
                return effect.filters!.some((f: any) =>
                  matchesFilter(inst, def!, f, state, controllingPlayerId)
                );
              });
            } else if (effect.filter) {
              matchingCards = topCards.filter((id) => {
                const inst = state.cards[id];
                const def = inst ? definitions[inst.definitionId] : undefined;
                if (!inst || !def) return false;
                return matchesFilter(inst, def, effect.filter!, state, controllingPlayerId);
              });
            } else {
              matchingCards = [...topCards];
            }
            // isMay: "you may reveal..." = optional (can take 0). Default false
            // means mandatory: "put N into your hand" — must take min(maxToHand,
            // matchingCards.length) per CRD 1.7.x "as much as possible" rule
            // when the deck is short.
            const isOptional = effect.isMay ?? false;
            const pickCount = isOptional
              ? `up to ${maxToHand}`
              : `${Math.min(maxToHand, matchingCards.length)}`;
            return {
              ...state,
              pendingChoice: {
                type: "choose_from_revealed",
                choosingPlayerId: controllingPlayerId,
                prompt: matchingCards.length === 0
                  ? `No matching cards found. All revealed cards go to the bottom of your deck.`
                  : (effect.pickDestination === "deck_top"
                      ? `Choose ${pickCount} card(s) to keep on top of your deck. The rest go to the bottom of your deck.`
                      : effect.pickDestination === "inkwell_exerted"
                        ? `Choose ${pickCount} card(s) to put into your inkwell facedown and exerted.`
                        : effect.pickDestination === "discard"
                          ? `Choose ${pickCount} card(s) to put into the discard. The rest stay on top of the deck.`
                          : `Choose ${pickCount} card(s) to put into your hand. The rest go to the bottom of your deck.`),
                validTargets: matchingCards,
                revealedCards: topCards,
                pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
                optional: isOptional,
              },
            };
          }

          // Bot/headless: greedy auto-pick
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
          // Apply pickDestination: move picked cards to their destination.
          let inkwellTriggerPending = false;
          for (const id of picked) {
            if (pickDestination === "hand") {
              state = moveCard(state, id, targetPlayer, "hand");
            } else if (pickDestination === "inkwell_exerted") {
              // Kida Creative Thinker: picked goes to inkwell facedown exerted.
              state = zoneTransition(state, id, "inkwell", definitions, events, { reason: "inked" });
              state = updateInstance(state, id, { isExerted: true });
              inkwellTriggerPending = true;
            } else if (pickDestination === "discard") {
              // Mad Hatter Eccentric Host: picked card goes to target player's discard.
              state = moveCard(state, id, targetPlayer, "discard");
            }
            // "deck_top": chosen card stays in deck — no move needed. With
            // restPlacement: "bottom", removing the rest from deck naturally
            // leaves the chosen card at the top (Ursula's Cauldron, Merlin Turtle).
          }
          // CRD 6.2: fire card_put_into_inkwell once after all picks moved,
          // so cross-card watchers (Oswald etc.) wake up on Kida-style paths.
          if (inkwellTriggerPending) {
            state = queueTriggersByEvent(state, "card_put_into_inkwell", targetPlayer, definitions, {});
          }
          // restPlacement default "bottom". For "top" the cards remain in
          // place after the picked ones are removed (or not, for deck_top
          // pickDestination), so no reorder is needed.
          if ((effect.restPlacement ?? "bottom") === "bottom") {
            state = reorderDeckTopToBottom(state, targetPlayer, rest, []);
          }
          // Set lastResolvedTarget to the picked card so a follow-up
          // self_replacement with target.type=last_resolved_target can
          // dispatch escalation effects (Queen Diviner: "If that item costs 3
          // or less, you may play it for free instead"). Only meaningful when
          // exactly one card is picked (maxToHand=1).
          if (picked.length === 1) {
            const ref = makeResolvedRef(state, definitions, picked[0]!);
            if (ref) state = { ...state, lastResolvedTarget: ref };
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
              const r = rngNextInt(state.rng, i + 1);
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
          // All revealed cards (non-match + match) are shown to all players
          for (const revId of revealedNonMatch) {
            events.push({ type: "card_revealed", instanceId: revId, playerId: controllingPlayerId, sourceInstanceId });
          }
          events.push({ type: "card_revealed", instanceId: matchId, playerId: controllingPlayerId, sourceInstanceId });
          state = moveCard(state, matchId, targetPlayer, "hand");
          // Shuffle revealedNonMatch back into the remaining deck.
          const merged = [...remaining, ...revealedNonMatch];
          for (let i = merged.length - 1; i > 0; i--) {
            const r = rngNextInt(state.rng, i + 1);
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

    case "put_top_cards_into_discard": {
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

    case "reveal_top_switch": {
      // Jack-jack Parr WEIRD THINGS ARE HAPPENING — atomic mill + multi-branch
      // switch on revealed card type. isMay surfaces a choose_may prompt
      // first; on accept (or if isMay is unset), mill `count` cards, and for
      // each revealed card run the first matching case's effects with the
      // revealed card set as lastResolvedTarget. Card lands in `destination`.
      //
      // Current implementation supports count=1 (Jack-jack's use case). For
      // count > 1, the loop handles each revealed card in deck-top order but
      // does not support pendingChoice mid-iteration — if a case's effects
      // surface a pendingChoice, later revealed cards are dropped. Extend via
      // pendingEffectQueue if a future card needs multi-reveal with interactive
      // case effects.
      if (effect.isMay) {
        const acceptEffect: RevealTopSwitchEffect = { ...effect, isMay: false };
        return {
          ...state,
          pendingChoice: {
            type: "choose_may",
            choosingPlayerId: controllingPlayerId,
            prompt: "Put the top card of your deck into your discard?",
            pendingEffect: acceptEffect,
            sourceInstanceId,
            triggeringCardInstanceId,
            optional: true,
          },
        };
      }
      // Resolve target player (default self).
      const revealTargetPlayer: PlayerID =
        effect.target?.type === "opponent" ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      const deck = getZone(state, revealTargetPlayer, "deck");
      const revealCount = effect.count ?? 1;
      const revealN = Math.min(revealCount, deck.length);
      if (revealN === 0) return state;
      const destination = effect.destination ?? "discard";
      const destinationZone: ZoneName =
        destination === "discard" ? "discard"
        : destination === "hand" ? "hand"
        : "deck"; // top/bottom both land in deck; order adjusted below
      for (let i = 0; i < revealN; i++) {
        const revealedId = deck[i];
        if (!revealedId) break;
        const revealedInst = state.cards[revealedId];
        const revealedDef = revealedInst ? definitions[revealedInst.definitionId] : undefined;
        if (!revealedInst || !revealedDef) continue;
        // Match against cases in order; first match wins.
        const matchedCase = effect.cases.find((c) =>
          matchesFilter(revealedInst, revealedDef, c.filter, state, revealTargetPlayer, sourceInstanceId)
        );
        // Move revealed card to destination.
        state = moveCard(state, revealedId, revealTargetPlayer, destinationZone);
        if (destination === "bottom") {
          // Append to end of deck rather than default prepend — moveCard
          // places at zone's natural end which for deck is the top. Swap
          // the newly-placed card to the bottom.
          const freshDeck = getZone(state, revealTargetPlayer, "deck");
          if (freshDeck[freshDeck.length - 1] === revealedId) {
            // Already last (= top in deck order). Rotate to position 0 = bottom.
            // In this engine deck[0] is top (per put_top_cards_into_discard
            // which uses deck.slice(0, N) for the mill). So top=0, bottom=end.
            // moveCard appends by default → already at bottom. No-op needed.
          }
        }
        // Set lastResolvedTarget so case effects (and downstream) can read
        // the revealed card's properties. Use the full ref shape.
        const revealedRef = makeResolvedRef(state, definitions, revealedId);
        if (revealedRef) state = { ...state, lastResolvedTarget: revealedRef };
        // Apply matched case's effects (if any).
        if (matchedCase) {
          for (let j = 0; j < matchedCase.effects.length; j++) {
            const sub = matchedCase.effects[j]!;
            state = applyEffect(state, sub, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
            if (state.pendingChoice) {
              // Sub-effect created a pendingChoice (e.g. Jack-jack's location
              // case "banish chosen character"). Remaining sub-effects queue
              // via pendingEffectQueue naturally; this case is fully consumed.
              // (Remaining revealed cards in count > 1 flows would be lost
              // here — documented limitation above.)
              return state;
            }
          }
        }
      }
      // Fire zone-transition triggers once per destination.
      if (destination === "discard") {
        state = queueTriggersByEvent(state, "cards_discarded", revealTargetPlayer, definitions, {});
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

    // Rerouted to self_replacement (target omitted, condition is a
    // Condition — dispatched via evaluateCondition).

    case "each_player": {
      // CRD 6.1.4 + 7.7.4: apply inner effects once per matching player in
      // turn order (active player first). Each iteration uses its player as
      // the inner effects' controllingPlayerId, so self/opponent targeting
      // resolves relative to that iteration — Donald Duck's opponent draws
      // for their own side, not the caster's.
      //
      // Scope: "all" (default) includes everyone; "opponents" excludes the
      // caster (Sudden Chill, Tangle). Filter gates each iteration by a
      // per-player PlayerFilter (Lady Tremaine Overbearing's "more lore
      // than you", Friar Tuck's "player(s) with the most cards").
      //
      // First invocation (no `_iterations`) seeds the list from scope +
      // filter. Thereafter we process the head iteration inline; if a
      // pendingChoice is raised mid-iteration, remaining sub-effects AND
      // remaining iterations queue via pendingEffectQueue.
      let iterations: PlayerID[];
      if (effect._iterations !== undefined) {
        iterations = effect._iterations;
      } else {
        const activePlayer = state.currentPlayer;
        const other = getOpponent(activePlayer);
        // Scope: "opponents" excludes the caster. Turn order: active first,
        // then others. Caster may or may not be the active player (e.g. a
        // triggered ability can fire on opponent's turn).
        const scope = effect.scope ?? "all";
        const allInOrder: PlayerID[] =
          activePlayer === controllingPlayerId
            ? [activePlayer, other]
            : [activePlayer, other];
        iterations = scope === "opponents"
          ? allInOrder.filter(p => p !== controllingPlayerId)
          : allInOrder;
        // Apply per-player filter (tie-aware for group-extreme).
        if (effect.filter) {
          const candidates = [...iterations];
          iterations = iterations.filter(p =>
            evaluatePlayerFilter(effect.filter!, p, controllingPlayerId, candidates, state)
          );
        }
      }
      if (iterations.length === 0) return state;
      const iterPlayer = iterations[0]!;
      const remainingIterations = iterations.slice(1);

      if (effect.isMay) {
        // Queue the other iterations first (they run after current resolves).
        if (remainingIterations.length > 0) {
          const residual: EachPlayerEffect = { ...effect, _iterations: remainingIterations };
          state = queueAfterCurrent(state, [residual], sourceInstanceId, controllingPlayerId);
        }
        // Surface the may prompt to this iteration's own player. The accept
        // effect is a single-iteration each_player (isMay stripped) so accept
        // re-enters the mandatory branch with iterPlayer as controller.
        const acceptEffect: EachPlayerEffect = {
          type: "each_player",
          effects: effect.effects,
          _iterations: [iterPlayer],
        };
        return {
          ...state,
          pendingChoice: {
            type: "choose_may",
            choosingPlayerId: iterPlayer,
            prompt: "Use this effect?",
            pendingEffect: acceptEffect,
            acceptControllingPlayerId: iterPlayer,
            sourceInstanceId,
            triggeringCardInstanceId,
            optional: true,
          },
        };
      }

      // Mandatory: apply sub-effects inline with iterPlayer as controller.
      for (let i = 0; i < effect.effects.length; i++) {
        const sub = effect.effects[i]!;
        state = applyEffect(state, sub, sourceInstanceId, iterPlayer, definitions, events, triggeringCardInstanceId);
        if (state.pendingChoice) {
          // Queue (a) remaining subs for this player, (b) remaining iterations.
          const remainingSubs = effect.effects.slice(i + 1);
          const entries: Effect[] = [];
          if (remainingSubs.length > 0) {
            entries.push({
              type: "each_player",
              effects: remainingSubs,
              _iterations: [iterPlayer],
            } as EachPlayerEffect);
          }
          if (remainingIterations.length > 0) {
            entries.push({
              type: "each_player",
              effects: effect.effects,
              _iterations: remainingIterations,
            } as EachPlayerEffect);
          }
          if (entries.length > 0) {
            state = queueAfterCurrent(state, entries, sourceInstanceId, controllingPlayerId);
          }
          return state;
        }
      }

      // Current iteration fully resolved — chain into the next inline so the
      // whole each_player completes within a single applyEffect call when no
      // pendingChoice is raised. Action-card actionEffects drives this loop
      // purely off pendingChoice, not off pendingEffectQueue.
      if (remainingIterations.length > 0) {
        const next: EachPlayerEffect = { ...effect, _iterations: remainingIterations };
        return applyEffect(state, next, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
      }
      return state;
    }

    case "each_target": {
      // Iterate over a runtime-resolved set of card instance IDs and apply
      // inner effects to each. Design parallel to each_player (which iterates
      // players). The per-iteration target is passed as triggeringCardInstanceId
      // so inner effects can reference it via target: triggering_card.
      let targetIds: string[];
      // _resolvedIds: internal field set when resuming from pendingEffectQueue.
      // When present, skip the state lookup (IDs were already resolved before
      // the choice interrupted us).
      if ((effect as any)._resolvedIds) {
        targetIds = (effect as any)._resolvedIds;
      } else if (effect.source.type === "state_ids") {
        switch (effect.source.key) {
          case "lastSongSingerIds":
            targetIds = [...(state.lastSongSingerIds ?? [])];
            break;
          default:
            targetIds = [];
        }
      } else {
        targetIds = [];
      }
      // minCount gate (I2I: "if 2 or more characters sang this song").
      if (effect.minCount !== undefined && targetIds.length < effect.minCount) return state;
      // Filter to only in-play instances (singers may have been banished since
      // the song resolved).
      targetIds = targetIds.filter(id => {
        const inst = state.cards[id];
        return inst && inst.zone === "play";
      });
      // Process each target inline. On pendingChoice, queue the rest.
      for (let i = 0; i < targetIds.length; i++) {
        const tid = targetIds[i]!;
        for (let j = 0; j < effect.effects.length; j++) {
          const sub = effect.effects[j]!;
          state = applyEffect(state, sub, tid, controllingPlayerId, definitions, events, tid);
          if (state.pendingChoice) {
            // Queue remaining sub-effects for this target + remaining targets.
            const remainingSubs = effect.effects.slice(j + 1);
            const remainingTargets = targetIds.slice(i + 1);
            const entries: Effect[] = [];
            if (remainingSubs.length > 0) {
              entries.push({
                type: "each_target",
                source: effect.source,
                effects: remainingSubs,
                _resolvedIds: [tid],
              } as any);
            }
            if (remainingTargets.length > 0) {
              entries.push({
                type: "each_target",
                source: effect.source,
                effects: effect.effects,
                _resolvedIds: remainingTargets,
              } as any);
            }
            if (entries.length > 0) {
              state = queueAfterCurrent(state, entries, sourceInstanceId, controllingPlayerId);
            }
            return state;
          }
        }
      }
      return state;
    }

    // Elsa's Ice Palace ETERNAL WINTER: surface a chooser, then write the
    // chosen instance id onto the SOURCE's rememberedTargetIds field. The
    // location's static effect (restrict_remembered_target_action) consults
    // this field on each gameModifiers iteration, so the restriction lasts
    // exactly as long as the location is in play.
    case "remember_chosen_target": {
      const validTargets = findChosenTargets(state, effect.filter, controllingPlayerId, definitions, sourceInstanceId);
      if (validTargets.length === 0) return state;
      return {
        ...state,
        pendingChoice: {
          type: "choose_target",
          choosingPlayerId: controllingPlayerId,
          prompt: "Choose a character to remember.",
          validTargets,
          pendingEffect: effect,
          sourceInstanceId,
          triggeringCardInstanceId,
        },
      };
    }

    // Tiana Restaurant Owner SPECIAL RESERVATION generalization. The
    // controller's trigger fires; the OPPOSING player (owner of the
    // triggering card) gets a may-prompt to accept the cost (e.g. pay 3 ink)
    // or decline and let the controller's reject effect fire (e.g. -3 {S}).
    // Mirrors the Hades Looking for a Deal cross-player chooser machinery
    // but is generic — accept and reject are both arbitrary effects.
    case "opponent_may_pay_to_avoid": {
      // Identify the opposing player from context. Two paths:
      //   1. Trigger context (Tiana): triggeringCardInstanceId is the attacker
      //   2. Chooser context (Hades): lastResolvedTarget is the chosen character
      const contextId = triggeringCardInstanceId ?? state.lastResolvedTarget?.instanceId;
      if (!contextId) return state;
      const contextInst = state.cards[contextId];
      if (!contextInst) return state;
      const opposingPlayerId = contextInst.ownerId;
      // Pre-check affordability: if the opposing player can't perform the
      // accept cost, skip the choose_may and fire the reject effect directly.
      // This ensures the rule "unless their player pays N" applies the
      // debuff when they CAN'T pay, not just when they choose not to.
      if (!canPerformCostEffect(state, effect.acceptEffect, opposingPlayerId, triggeringCardInstanceId)) {
        return applyEffect(state, effect.rejectEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
      }
      // Surface a choose_may to the opposing player. accept fires the
      // cost effect against the opposing player; reject fires the controller's
      // debuff via rejectControllingPlayerId.
      return {
        ...state,
        pendingChoice: {
          type: "choose_may",
          choosingPlayerId: opposingPlayerId,
          prompt: "Pay to avoid the effect?",
          pendingEffect: effect.acceptEffect,
          rejectEffect: effect.rejectEffect,
          acceptControllingPlayerId: opposingPlayerId,
          rejectControllingPlayerId: controllingPlayerId,
          sourceInstanceId,
          triggeringCardInstanceId,
          optional: true,
        },
      };
    }

    // chosen_opposing_may_bottom_or_reward: DELETED — migrated to
    // opponent_may_pay_to_avoid. Hades now uses the generic pattern.

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
        sourceInstanceId,
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
      // "that player" — the owner of the last resolved target (We Don't Talk About Bruno:
      // "return chosen character to their player's hand, then THAT PLAYER discards")
      else if (effect.target.type === "target_owner") {
        const ownerId = state.lastResolvedTarget?.ownerId;
        if (ownerId) players.push(ownerId as PlayerID);
        else players.push(getOpponent(controllingPlayerId)); // fallback
      }
      // Search for Clues: expand to every player whose hand size equals the
      // max (tie → both players each discard 2).
      else if (effect.target.type === "players_with_most_cards_in_hand") {
        const p1Hand = getZone(state, "player1", "hand").length;
        const p2Hand = getZone(state, "player2", "hand").length;
        const maxHand = Math.max(p1Hand, p2Hand);
        if (p1Hand === maxHand) players.push("player1");
        if (p2Hand === maxHand) players.push("player2");
      }

      const discardMods = getGameModifiers(state, definitions);
      // Clear lastDiscarded at the top of this dispatch so the
      // count_last_discarded DynamicAmount sees only discards from this
      // effect (Headless Horseman: count action discards from THIS step).
      state = { ...state, lastDiscarded: [] };
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
          // Snapshot the random picks onto lastDiscarded so subsequent
          // effects can count-by-filter (Headless Horseman WITCHING HOUR:
          // "deal 2 damage for each action card discarded this way"). The
          // refs accumulate across both players' discards in the same
          // discard_from_hand dispatch when target is "both".
          const newRefs = picked
            .map((id) => makeResolvedRef(state, definitions, id))
            .filter((r): r is ResolvedRef => !!r);
          if (newRefs.length > 0) {
            const existing = state.lastDiscarded ?? [];
            state = { ...state, lastDiscarded: [...existing, ...newRefs] };
          }
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

    case "put_into_inkwell": {
      const fromZone = effect.fromZone ?? "play";

      if (fromZone === "deck") {
        // Top of deck → inkwell (one-jump-ahead, mickey-mouse-detective).
        // Sudden Scare: "That player puts the top card of their deck into
        // their inkwell" — when target is last_resolved_target, use the
        // previously-chosen card's owner instead of the controller.
        const sourcePlayer = effect.target?.type === "last_resolved_target"
          ? (state.lastResolvedTarget?.ownerId ?? controllingPlayerId)
          : controllingPlayerId;
        const deck = getZone(state, sourcePlayer, "deck");
        if (deck.length === 0) return state;
        const topCardId = deck[0]!;
        state = zoneTransition(state, topCardId, "inkwell", definitions, events, { reason: "inked" });
        if (effect.enterExerted) {
          state = updateInstance(state, topCardId, { isExerted: true });
        } else {
          state = addInkFromEffect(state, sourcePlayer);
        }
        // CRD 6.2: "whenever a card is put into your inkwell" fires on effect-driven
        // inkwell placement (Oswald watching Fishbone Quill), not just normal INK_CARD.
        state = queueTriggersByEvent(state, "card_put_into_inkwell", sourcePlayer, definitions, {});
        return state;
      }

      if (effect.target.type === "this") {
        // Self → inkwell (gramma-tala)
        const inkingPlayer = getInstance(state, sourceInstanceId).ownerId;
        state = zoneTransition(state, sourceInstanceId, "inkwell", definitions, events, { reason: "inked" });
        if (effect.enterExerted) {
          state = updateInstance(state, sourceInstanceId, { isExerted: true });
        } else {
          state = addInkFromEffect(state, controllingPlayerId);
        }
        state = queueTriggersByEvent(state, "card_put_into_inkwell", inkingPlayer, definitions, {});
        return state;
      }

      // Chosen + all target types use the shared target-dispatch helper.
      // Note: "this" and fromZone="deck" branches above have bespoke per-
      // iteration side effects (addInk vs enterExerted + card_put_into_inkwell
      // trigger firing) that run inline per card owner; keeping them separate.
      //
      // For chosen: pendingChoice routes to applyEffectToTarget's case
      // "put_into_inkwell" (line ~7220) which handles the enterExerted flag
      // + queue card_put_into_inkwell trigger for the resolved target.
      //
      // For all: Perdita Determined Mother (discard→inkwell) is canonical.
      // Per-iteration side effects (enterExerted + trigger queuing) happen
      // inside perInstance; we deduplicate receiving players with a Set.
      if (effect.target.type === "chosen") {
        return resolveTargetAndApply(state, effect, {
          prompt: "Choose a card to put into inkwell.",
          perInstance: (s) => s, // unreachable for "chosen" — resolution goes through pendingChoice
        }, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
      }
      if (effect.target.type === "all") {
        const receivingPlayers = new Set<PlayerID>();
        state = resolveTargetAndApply(state, effect, {
          prompt: "Put into inkwell", // unused — "all" skips pendingChoice
          perInstance: (s, id, ev) => {
            const inst = s.cards[id];
            if (!inst) return s;
            receivingPlayers.add(inst.ownerId);
            s = zoneTransition(s, id, "inkwell", definitions, ev, { reason: "inked" });
            if (effect.enterExerted) s = updateInstance(s, id, { isExerted: true });
            return s;
          },
        }, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        // CRD 6.2: fire card_put_into_inkwell per receiving player so cross-
        // card watchers (Oswald, Chicha Dedicated Mother) pick it up.
        for (const pid of receivingPlayers) {
          state = queueTriggersByEvent(state, "card_put_into_inkwell", pid, definitions, {});
        }
        return state;
      }
      return state;
    }

    case "self_replacement": {
      // CRD 6.5.6 self-replacement within a single ability. Three modes
      // distinguished by (target, condition shape):
      //  - target set + condition is CardFilter: pick target, match filter
      //    against target (Vicious Betrayal). Chosen target surfaces a
      //    pendingChoice; direct targets resolve inline below.
      //  - target absent + condition is a Condition (has `type` field):
      //    evaluate via evaluateCondition (Turbo Royal Hack, Hidden Trap).
      //  - target absent + condition is a CardFilter: match against
      //    state.lastDiscarded (Kakamora Pirate Chief).
      if (!effect.target) {
        const cond = effect.condition as any;
        let matched: boolean;
        if (cond && typeof cond === "object" && typeof cond.type === "string") {
          // Condition discriminator present → game-state check.
          matched = evaluateCondition(cond, state, definitions, controllingPlayerId, sourceInstanceId);
        } else {
          // CardFilter → check against state.lastDiscarded.
          const refs = state.lastDiscarded ?? [];
          matched = false;
          for (const ref of refs) {
            const inst = state.cards[ref.instanceId];
            const def = inst ? definitions[inst.definitionId] : undefined;
            if (!inst || !def) continue;
            if (matchesFilter(inst, def, cond, state, controllingPlayerId, sourceInstanceId)) {
              matched = true;
              break;
            }
          }
        }
        const branch = matched ? effect.instead : effect.effect;
        for (const sub of branch) {
          state = applyEffect(state, sub, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
          if (state.pendingChoice) return state;
        }
        return state;
      }
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state; // CRD 1.7.7: no legal targets → fizzle
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
      // Direct targets (last_resolved_target / this / triggering_card)
      const directSR = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directSR) return applyEffectToTarget(state, effect, directSR, controllingPlayerId, definitions, events, sourceInstanceId, triggeringCardInstanceId);
      return state;
    }

    case "play_card": {
      // Direct-target form — skip the choose-from-zone flow and apply directly.
      if (effect.target) {
        const directPF = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
        if (directPF) return applyEffectToTarget(state, effect, directPF, controllingPlayerId, definitions, events);
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
      // Choose-from-zone form: filter the source zone(s) (default hand) and present a choice.
      // sourceZone can be a single ZoneName or an array (Prince John Gold Lover
      // BEAUTIFUL LOVELY TAXES — "from your hand or discard").
      const sourceZoneRaw = effect.sourceZone ?? "hand";
      const sourceZones: string[] = Array.isArray(sourceZoneRaw) ? sourceZoneRaw : [sourceZoneRaw];
      const filter = effect.filter;
      let sourceCards: string[] = [];
      for (const sz of sourceZones) {
        if (sz === "under") {
          // Per-instance subzone: read cardsUnder from the source instance (default "self").
          const parentInst = state.cards[sourceInstanceId];
          if (parentInst) sourceCards.push(...parentInst.cardsUnder);
        } else {
          sourceCards.push(...getZone(state, controllingPlayerId, sz as any));
        }
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
      // CRD 6.1.5.2: Filter infeasible options — "if [A] can't be chosen, [B] must be chosen"
      const feasibleOptions = effect.options.filter(option =>
        option.length > 0 && option.every(subEff => canPerformChooseOption(state, subEff, controllingPlayerId, triggeringCardInstanceId, definitions, sourceInstanceId))
      );
      // If only one feasible option, auto-pick it (no choice to make)
      const optionsToPresent = feasibleOptions.length > 0 ? feasibleOptions : [effect.options[effect.options.length - 1]!];
      if (optionsToPresent.length === 1) {
        // Forced — apply the only feasible option directly
        const chosen = optionsToPresent[0]!;
        for (const subEffect of chosen) {
          state = applyEffect(state, subEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
          if (state.pendingChoice) return state;
        }
        return state;
      }
      if (state.interactive) {
        // Surface only feasible options to the human/UI
        return {
          ...state,
          pendingChoice: {
            type: "choose_option",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose one:",
            options: optionsToPresent,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      // Non-interactive bot: pick first feasible option
      const chosen = optionsToPresent[0];
      if (!chosen) return state;
      for (const subEffect of chosen) {
        state = applyEffect(state, subEffect, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        if (state.pendingChoice) return state;
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
      if (effect.target.type === "this") {
        // Shuffle the source card into its owner's deck (You're Welcome pattern)
        state = zoneTransition(state, sourceInstanceId, "deck", definitions, events, { reason: "effect" });
        state = shuffleDeck(state, getInstance(state, sourceInstanceId).ownerId);
        return state;
      }
      if (effect.target.type === "all") {
        // Chernabog - Evildoer SUMMON THE SPIRITS: "shuffle all character
        // cards from your discard into your deck." Magic Broom CLEAN THIS,
        // CLEAN THAT: "shuffle all Broom cards from your discard into your
        // deck." Mass version of the chosen branch.
        const targets = findValidTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (targets.length === 0) return state;
        const ownersToShuffle = new Set<PlayerID>();
        for (const id of targets) {
          const inst = state.cards[id];
          if (!inst) continue;
          state = zoneTransition(state, id, "deck", definitions, events, { reason: "effect" });
          ownersToShuffle.add(inst.ownerId);
        }
        for (const owner of ownersToShuffle) state = shuffleDeck(state, owner);
        return state;
      }
      if (effect.target.type === "chosen") {
        // "any discard" = all discard piles
        const filter = effect.target.filter;
        const validTargets = findChosenTargets(state, filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        // It Calls Me "choose up to 3": target.count>1 surfaces a multi-select.
        // isUpTo (on DealDamage-style effects) isn't on ShuffleIntoDeckEffect,
        // so reuse isMay to gate optional (0..count) picks — semantically
        // equivalent for the "up to N" wording.
        const count = effect.target.count ?? 1;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: count > 1
              ? `Choose up to ${count} cards to shuffle into their owner's deck.`
              : "Choose a card to shuffle into its owner's deck.",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
            optional: effect.isMay ?? false,
            count,
          },
        };
      }
      return state;
    }

    // CRD: deck search ("search your deck for X, reveal it, ..."). Bot
    // heuristic: pick the first matching card in the deck and move it to the
    // requested destination. The deck is treated as shuffled-equivalent for
    // analytics, so "shuffle your deck and put that card on top" reduces to
    // "find the card and put it on top". Snow White Well Wisher, Dragon Gem,
    // Hiro Hamada, ~12 other cards.
    case "search": {
      const targetPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId) : controllingPlayerId;
      const sourceCards = getZone(state, targetPlayer, effect.zone);
      const isMatch = (id: string) => {
        const inst = state.cards[id];
        const def = inst ? definitions[inst.definitionId] : undefined;
        return inst && def ? matchesFilter(inst, def, effect.filter, state, controllingPlayerId, sourceInstanceId, definitions) : false;
      };

      // Interactive mode: show all matching cards and let the player choose
      if (state.interactive) {
        const allMatches = sourceCards.filter(isMatch);
        if (allMatches.length === 0) return state;
        // Always show the choice — even for single match, so the player sees
        // what was found and both sides get the reveal overlay in multiplayer.
        return {
          ...state,
          pendingChoice: {
            type: "choose_from_revealed",
            choosingPlayerId: controllingPlayerId,
            prompt: `Choose a card to take.`,
            validTargets: allMatches,
            revealedCards: allMatches,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }

      // Bot/headless mode: pick the first match
      const matchId = sourceCards.find(isMatch);
      if (!matchId) return state;
      if (effect.reveal) {
        events.push({ type: "card_revealed", instanceId: matchId, playerId: controllingPlayerId, sourceInstanceId });
      }
      if (effect.putInto === "deck" && effect.position === "top") {
        return moveCard(state, matchId, targetPlayer, "deck", "top");
      }
      return moveCard(state, matchId, targetPlayer, effect.putInto);
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
            costReductions: [...existing, { amount: resolvedAmount, filter: effect.filter, sourceInstanceId }],
          },
        },
      };
    }

    // lose_lore is now handled by the unified gain_lore/lose_lore case above.
    // This empty case is left as a comment to explain why there's no separate
    // lose_lore handler here — search for "case \"gain_lore\":" to find it.

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
      const directCR = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directCR) {
        const timedEffect: TimedEffect = {
          type: "can_challenge_ready",
          expiresAt: effect.duration,
          appliedOnTurn: state.turnNumber,
          casterPlayerId: controllingPlayerId,
          sourceInstanceId,
        };
        return addTimedEffect(state, directCR, timedEffect);
      }
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
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
      return state;
    }

    // Naveen's Ukulele MAKE IT SING: chosen character counts as having +N
    // cost to sing songs this turn.
    case "sing_cost_bonus_target": {
      if (effect.target.type === "chosen") {
        const validTargets = findChosenTargets(state, effect.target.filter, controllingPlayerId, definitions, sourceInstanceId);
        if (validTargets.length === 0) return state;
        return {
          ...state,
          pendingChoice: {
            type: "choose_target",
            choosingPlayerId: controllingPlayerId,
            prompt: "Choose a character to bump sing cost",
            validTargets,
            pendingEffect: effect, sourceInstanceId, triggeringCardInstanceId,
          },
        };
      }
      // Direct targets (this / triggering_card / last_resolved_target)
      const directSCB = resolveDirectTarget(effect.target, state, sourceInstanceId, triggeringCardInstanceId);
      if (directSCB) return applyEffectToTarget(state, effect, directSCB, controllingPlayerId, definitions, events, directSCB, triggeringCardInstanceId);
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
            sourceInstanceId,
          }],
        };
      }
      // attachTo: "chosen" — surface a choose_target so the controller picks
      // which character receives the floating trigger.
      if (effect.attachTo === "chosen") {
        const filter = effect.targetFilter ?? { owner: { type: "self" }, zone: "play", cardType: ["character"] };
        const validTargets = findChosenTargets(state, filter, controllingPlayerId, definitions, sourceInstanceId);
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
      // attachTo: "all_matching" — Forest Duel pattern: attach one floating
      // trigger per matching in-play card. Each gets its own entry so the
      // trigger dispatches correctly when any individual attached card fires.
      if (effect.attachTo === "all_matching") {
        const filter = effect.targetFilter ?? { owner: { type: "self" }, zone: "play", cardType: ["character"] };
        const matches = findValidTargets(state, filter, controllingPlayerId, definitions, sourceInstanceId);
        const additions = matches.map((id) => ({
          trigger: effect.trigger,
          effects: effect.effects,
          controllingPlayerId,
          attachedToInstanceId: id,
          sourceInstanceId,
        }));
        return { ...state, floatingTriggers: [...existing, ...additions] };
      }
      return {
        ...state,
        floatingTriggers: [...existing, {
          trigger: effect.trigger,
          effects: effect.effects,
          controllingPlayerId,
          sourceInstanceId,
        }],
      };
    }

    // CRD 6.2.7.2: Create a delayed triggered ability that fires once at a specific moment
    case "create_delayed_trigger": {
      let targetId: string | undefined;
      if (effect.attachTo === "last_resolved_target") {
        targetId = state.lastResolvedTarget?.instanceId;
      } else if (effect.attachTo === "self") {
        targetId = sourceInstanceId;
      }
      if (!targetId || !state.cards[targetId]) return state;
      const existing = state.delayedTriggers ?? [];
      return {
        ...state,
        delayedTriggers: [...existing, {
          firesAt: effect.firesAt,
          effects: effect.effects,
          controllingPlayerId,
          targetInstanceId: targetId,
          sourceInstanceId,
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
      // KNOWN GAP: when effect.filter is set, this doesn't check whether any
      // hand card matches the filter (canPerformCostEffect lacks definitions).
      // For ROYAL SUMMONS-style "discard a [filtered] card to reward", the may
      // prompt appears even when no valid card exists; the cost then fizzles
      // mid-resolution while the reward still fires. Acceptable for now since
      // the player still controls the may; tracker item if it bites a card.
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

/**
 * CRD 6.1.5.2: Check if a sub-effect within a "choose" option can be performed.
 * Used to determine which option the bot picks — if option A can't be performed,
 * option B must be chosen. Mirrors canPerformCostEffect but for choose options.
 */
function canPerformChooseOption(
  state: GameState,
  effect: Effect,
  controllingPlayerId: PlayerID,
  triggeringCardInstanceId?: string,
  definitions?: Record<string, CardDefinition>,
  sourceInstanceId?: string
): boolean {
  switch (effect.type) {
    case "discard_from_hand":
      return typeof effect.amount === "number"
        ? getZone(state, controllingPlayerId, "hand").length >= effect.amount
        : true;
    case "pay_ink":
      return state.players[controllingPlayerId].availableInk >= (typeof effect.amount === "number" ? effect.amount : 0);
    case "put_card_on_bottom_of_deck": {
      // When a choose option's cost-step moves a card from hand/discard
      // (Wrong Lever!'s option B: "Put a Pull the Lever! card from your
      // discard..."), the option is selectable only if the pool is non-empty.
      // The engine can't actually pay the cost if no matching card exists.
      if (effect.from === "play") return true;
      if (!definitions) return true;
      const ownerScope = effect.ownerScope ?? "self";
      const targetPlayer =
        ownerScope === "self" ? controllingPlayerId
        : ownerScope === "opponent" ? getOpponent(controllingPlayerId)
        : getOpponent(controllingPlayerId);
      let pool = getZone(state, targetPlayer, effect.from);
      if (effect.filter) {
        pool = pool.filter(cardId => {
          const inst = state.cards[cardId];
          const def = inst ? definitions[inst.definitionId] : undefined;
          return inst && def ? matchesFilter(inst, def, effect.filter!, state, targetPlayer) : false;
        });
      }
      return pool.length >= (effect.amount ?? 1);
    }
    default: {
      // CRD 6.1.5.2: If the effect targets "chosen" cards, check if enough valid targets exist
      const target = (effect as any).target;
      if (target?.type === "chosen" && target.filter && definitions) {
        const validTargets = findChosenTargets(state, target.filter, controllingPlayerId, definitions, sourceInstanceId ?? "");
        const requiredCount = target.count ?? 1;
        return validTargets.length >= requiredCount;
      }
      return true;
    }
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
// REVEAL_TOP_CONDITIONAL HELPERS — match/no-match routing
// -----------------------------------------------------------------------------

/** Apply the revealed card's matchAction (to_hand / play_card / to_inkwell_exerted)
 *  plus any matchExtraEffects. Used from both the auto-accept path (no matchIsMay)
 *  and the choose_may accept branch. */
function applyRevealMatchAction(
  state: GameState,
  revealedInstanceId: string,
  config: {
    matchAction: "to_hand" | "play_card" | "to_inkwell_exerted";
    matchEnterExerted?: boolean;
    matchPayCost?: boolean;
    matchExtraEffects?: Effect[];
    noMatchDestination?: "top" | "bottom" | "hand" | "discard";
  },
  targetPlayer: PlayerID,
  controllingPlayerId: PlayerID,
  sourceInstanceId: string,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
): GameState {
  const topInst = state.cards[revealedInstanceId];
  const topDef = topInst ? definitions[topInst.definitionId] : undefined;
  if (!topInst || !topDef) return state;

  switch (config.matchAction) {
    case "to_hand":
      state = moveCard(state, revealedInstanceId, targetPlayer, "hand");
      break;
    case "play_card": {
      // matchPayCost: controller pays the card's normal ink cost (Kristoff's
      // Lute). If they can't afford, fall through to noMatchDestination.
      if (config.matchPayCost) {
        const cardCost = getEffectiveCostWithReductions(state, targetPlayer, revealedInstanceId, definitions);
        const canAfford = state.players[targetPlayer].availableInk >= cardCost;
        if (!canAfford) {
          return applyRevealNoMatchRoute(state, revealedInstanceId, config.noMatchDestination ?? "top", targetPlayer, definitions, events);
        }
        state = updatePlayerInk(state, targetPlayer, -cardCost);
      }
      state = zoneTransition(state, revealedInstanceId, "play", definitions, events, {
        reason: "played", triggeringPlayerId: targetPlayer,
      });
      if (topDef.cardType === "character") {
        state = updateInstance(state, revealedInstanceId, { isDrying: true, ...(config.matchEnterExerted ? { isExerted: true } : {}) });
      } else if (config.matchEnterExerted && (topDef.cardType === "item" || topDef.cardType === "location")) {
        state = updateInstance(state, revealedInstanceId, { isExerted: true });
      }
      // Mirror applyPlayCard: queue Bodyguard's may-enter-exerted trigger and
      // any enter_play_exerted_self / EnterPlayExertedStatic modifiers. Without
      // this, characters played via reveal-and-play (Let's Get Dangerous,
      // Simba TIMELY ALLIANCE, Mufasa, Sisu repeats) silently skipped Bodyguard.
      if (topDef.cardType === "character" || topDef.cardType === "item" || topDef.cardType === "location") {
        state = applyEnterPlayExertion(state, revealedInstanceId, targetPlayer, definitions);
      }
      if (topDef.cardType === "action" && topDef.actionEffects) {
        for (const ae of topDef.actionEffects) {
          state = applyEffect(state, ae, revealedInstanceId, targetPlayer, definitions, events);
        }
        state = zoneTransition(state, revealedInstanceId, "discard", definitions, events, { reason: "discarded" });
      }
      break;
    }
    case "to_inkwell_exerted": {
      state = zoneTransition(state, revealedInstanceId, "inkwell", definitions, events, { reason: "inked" });
      state = updateInstance(state, revealedInstanceId, { isExerted: true });
      // CRD 6.2: fire card_put_into_inkwell for cross-card watchers (Oswald etc.).
      state = queueTriggersByEvent(state, "card_put_into_inkwell", targetPlayer, definitions, {});
      break;
    }
  }
  if (config.matchExtraEffects) {
    for (const extra of config.matchExtraEffects) {
      state = applyEffect(state, extra, sourceInstanceId, controllingPlayerId, definitions, events, revealedInstanceId);
    }
  }
  return state;
}

/** Route the revealed card to its noMatchDestination. Used on non-match, on
 *  matchIsMay decline, and on can't-afford fallback for matchPayCost. */
function applyRevealNoMatchRoute(
  state: GameState,
  revealedInstanceId: string,
  dest: "top" | "bottom" | "hand" | "discard",
  targetPlayer: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
): GameState {
  if (dest === "bottom") {
    state = moveCard(state, revealedInstanceId, targetPlayer, "deck");
  } else if (dest === "hand") {
    state = moveCard(state, revealedInstanceId, targetPlayer, "hand");
  } else if (dest === "discard") {
    state = zoneTransition(state, revealedInstanceId, "discard", definitions, events, { reason: "discarded" });
  }
  // "top": stays where it is.
  return state;
}

// -----------------------------------------------------------------------------
// TRIGGER SYSTEM
// -----------------------------------------------------------------------------

function queueTrigger(
  state: GameState,
  eventType: string,
  sourceInstanceId: string,
  definitions: Record<string, CardDefinition>,
  context: { triggeringPlayerId?: PlayerID; triggeringCardInstanceId?: string; sourceInstanceId?: string }
): GameState {
  const instance = state.cards[sourceInstanceId];
  if (!instance) return state;
  const def = definitions[instance.definitionId];
  if (!def) return state;

  // Merida Formidable Archer STEADY AIM: damage_dealt_to triggers may include
  // a sourceFilter on the DAMAGE source (the card whose effect caused it,
  // e.g. the action card). Match against the source card's definition.
  const matchSourceFilter = (
    trigger: { sourceFilter?: CardFilter } & { on: string },
    watcherOwnerId: PlayerID
  ): boolean => {
    if (!trigger.sourceFilter) return true;
    const damageSrcId = context?.sourceInstanceId;
    if (!damageSrcId) return false;
    const srcInst = state.cards[damageSrcId];
    const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
    if (!srcInst || !srcDef) return false;
    return matchesFilter(srcInst, srcDef, trigger.sourceFilter, state, watcherOwnerId);
  };

  // Queue self-triggers (the source card's own triggered abilities + any
  // abilities granted via `grant_triggered_ability` static — Flotsam
  // Ursula's "Baby" grants a banished_in_challenge bounce to Jetsam cards;
  // the granted ability fires on Jetsam, not on Flotsam, so it lives in
  // the SELF-trigger scan for the recipient's instanceId).
  // If the trigger has a filter, the source card must match it (e.g. ADORING FANS
  // fires "whenever you play a character cost ≤ 2" — Stitch Rock Star itself costs 6).
  const modifiers = getGameModifiers(state, definitions);
  const grantedSelf = modifiers.grantedTriggeredAbilities.get(sourceInstanceId) ?? [];
  const effectiveAbilities: readonly import("../types/index.js").Ability[] =
    grantedSelf.length > 0 ? [...def.abilities, ...grantedSelf] : def.abilities;
  const selfTriggers = effectiveAbilities
    .filter((a): a is TriggeredAbility => {
      if (a.type !== "triggered" || a.trigger.on !== eventType) return false;
      const triggerFilter = "filter" in a.trigger ? a.trigger.filter : undefined;
      // CRD 6.1.6: pass sourceInstanceId so `excludeSelf` ("another character",
      // "another item") can reject the source's own event — otherwise a card like
      // Magic Broom Illuminary Keeper fires its "another character" trigger on its
      // own play.
      if (triggerFilter && !matchesFilter(instance, def, triggerFilter, state, instance.ownerId, sourceInstanceId)) return false;
      // For `challenges` triggers, defenderFilter (optional) matches the
      // challenged character. The defender lives on context.triggeringCardInstanceId.
      // Used by Shenzi Head Hyena ("challenges a damaged character") etc.
      if (a.trigger.on === "challenges" && "defenderFilter" in a.trigger && a.trigger.defenderFilter) {
        const defId = context?.triggeringCardInstanceId;
        if (!defId) return false;
        const defInst = state.cards[defId];
        const defDef = defInst ? definitions[defInst.definitionId] : undefined;
        if (!defInst || !defDef) return false;
        if (!matchesFilter(defInst, defDef, a.trigger.defenderFilter, state, instance.ownerId)) return false;
      }
      if (!matchSourceFilter(a.trigger as { sourceFilter?: CardFilter } & { on: string }, instance.ownerId)) return false;
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
      // defenderFilter check for `challenges` triggers — see selfTriggers above.
      // Cross-card precedent: Scar Vengeful Lion watches "whenever ONE OF YOUR
      // characters challenges a damaged character".
      if (ability.trigger.on === "challenges" && "defenderFilter" in ability.trigger && ability.trigger.defenderFilter) {
        const defId = context?.triggeringCardInstanceId;
        if (!defId) continue;
        const defInst = state.cards[defId];
        const defDef = defInst ? definitions[defInst.definitionId] : undefined;
        if (!defInst || !defDef) continue;
        if (!matchesFilter(defInst, defDef, ability.trigger.defenderFilter, state, watcher.ownerId)) continue;
      }
      // sourceFilter check for damage_dealt_to triggers — Merida Formidable
      // Archer STEADY AIM watches "whenever ONE OF YOUR ACTIONS deals damage".
      if (!matchSourceFilter(ability.trigger as { sourceFilter?: CardFilter } & { on: string }, watcher.ownerId)) continue;

      state = {
        ...state,
        triggerStack: [
          ...state.triggerStack,
          {
            ability,
            sourceInstanceId: watcherId,
            // Preserve the existing triggeringCardInstanceId if the event context
            // already set one (e.g. is_challenged → attacker, challenges → defender).
            // Falling back to sourceInstanceId only when no specific "other card"
            // is part of the event. Without this preservation, Tiana Restaurant
            // Owner watching is_challenged would see the defender instead of the
            // attacker, breaking opponent_may_pay_to_avoid's cross-player chooser.
            context: {
              ...context,
              triggeringCardInstanceId: context.triggeringCardInstanceId ?? sourceInstanceId,
            },
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

    // CRD 7.7.4: Active player resolves their triggers first, then non-active.
    // Non-interactive: sort the bag so active player's triggers come first.
    // Interactive: surface a choose_trigger choice for manual ordering.
    if (state.triggerStack.length > 1) {
      const activePlayerId = state.currentPlayer;
      // Sort: active player's triggers first (stable sort preserves queue order within each player)
      state = {
        ...state,
        triggerStack: [...state.triggerStack].sort((a, b) => {
          const aOwner = state.cards[a.sourceInstanceId]?.ownerId;
          const bOwner = state.cards[b.sourceInstanceId]?.ownerId;
          if (aOwner === activePlayerId && bOwner !== activePlayerId) return -1;
          if (bOwner === activePlayerId && aOwner !== activePlayerId) return 1;
          return 0;
        }),
      };
    }
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
        const canAfford = (effect.costEffects ?? []).every(
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

      // CRD 6.1.4: "may" effects require player decision before resolving.
      // `each_player` is an exception — its `isMay` binds per-iteration, not
      // per-trigger. The each_player reducer surfaces a choose_may to each
      // iteration's own player, so wrapping it here would double-prompt and
      // address the wrong player (source owner instead of iteration player).
      if ("isMay" in effect && effect.isMay && effect.type !== "each_player") {
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

      // Stamp _sourceStoryName onto gain_stats so any TimedEffect this
      // ability creates is attributed to the right ability/keyword in the
      // UI. Preserves explicit attribution (e.g. synthesized Support trigger
      // already sets "Support") via ??.
      const effectToApply = (effect.type === "gain_stats" && trigger.ability.storyName)
        ? { ...effect, _sourceStoryName: effect._sourceStoryName ?? trigger.ability.storyName }
        : effect;
      state = applyEffect(
        state,
        effectToApply,
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
/** Read a per-player metric for `each_player` filters. Centralized so
 *  `player_vs_caster` and `player_is_group_extreme` agree on how each
 *  metric is computed. */
function getPlayerMetric(state: GameState, playerId: PlayerID, metric: PlayerMetric): number {
  switch (metric) {
    case "lore": return state.players[playerId].lore;
    case "cards_in_hand": return state.zones[playerId].hand.length;
    case "cards_in_inkwell": return state.zones[playerId].inkwell.length;
    case "characters_in_play": {
      return getZone(state, playerId, "play").filter(id => {
        const inst = state.cards[id];
        return inst ? inst.definitionId && inst.zone === "play" : false;
      }).length;
    }
  }
}

function compareOp(lhs: number, op: ">" | ">=" | "<" | "<=" | "==", rhs: number): boolean {
  switch (op) {
    case ">": return lhs > rhs;
    case ">=": return lhs >= rhs;
    case "<": return lhs < rhs;
    case "<=": return lhs <= rhs;
    case "==": return lhs === rhs;
  }
}

/** Evaluate a PlayerFilter for a candidate iteration player. The `candidates`
 *  list is the scope-respecting full iteration set (needed for group-extreme
 *  comparisons — "most" is tie-aware across the iteration group). */
function evaluatePlayerFilter(
  filter: PlayerFilter,
  iterationPlayerId: PlayerID,
  casterPlayerId: PlayerID,
  candidates: PlayerID[],
  state: GameState
): boolean {
  switch (filter.type) {
    case "player_vs_caster": {
      const lhs = getPlayerMetric(state, iterationPlayerId, filter.metric);
      const rhs = getPlayerMetric(state, casterPlayerId, filter.metric);
      return compareOp(lhs, filter.op, rhs);
    }
    case "player_is_group_extreme": {
      const values = candidates.map(p => getPlayerMetric(state, p, filter.metric));
      const extreme = filter.mode === "most" ? Math.max(...values) : Math.min(...values);
      const playerValue = getPlayerMetric(state, iterationPlayerId, filter.metric);
      return playerValue === extreme;
    }
    case "player_metric": {
      const lhs = getPlayerMetric(state, iterationPlayerId, filter.metric);
      return compareOp(lhs, filter.op, filter.amount);
    }
  }
}

/** Prepend effects to pendingEffectQueue so they run AFTER the currently
 *  raised pendingChoice resolves. Preserves any existing queued entries by
 *  placing the new ones before them. */
function queueAfterCurrent(
  state: GameState,
  newEffects: Effect[],
  sourceInstanceId: string,
  controllingPlayerId: PlayerID
): GameState {
  return {
    ...state,
    pendingEffectQueue: state.pendingEffectQueue
      ? { ...state.pendingEffectQueue, effects: [...newEffects, ...state.pendingEffectQueue.effects] }
      : { effects: newEffects, sourceInstanceId, controllingPlayerId },
  };
}

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
  if (definitions) {
    const mods = getGameModifiers(state, definitions);
    // Peter Pan Never Land Prankster: prevent_lore_gain modifier
    // short-circuits any lore-gain attempt for affected players.
    if (mods.preventLoreGain.has(playerId) && amount > 0) {
      return state;
    }
    // Koda Talkative Cub: prevent_lore_loss modifier short-circuits any
    // lore-loss attempt (negative amount through gainLore). Previously this
    // check lived ONLY in the lose_lore reducer case — 3 cards with literal
    // gain_lore amount: -1 (Aladdin Street Rat, Rapunzel Letting Down Her
    // Hair, Tangle) bypassed it because they use gain_lore not lose_lore.
    // Moving the check here ensures ALL lore-loss paths are gated.
    if (mods.preventLoreLoss.has(playerId) && amount < 0) {
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
        // Capture cardsUnder count BEFORE leave-play cleanup clears it. Read
        // by the `triggering_card_cards_under_count` DynamicAmount for Donald
        // Duck Fred Honeywell WELL WISHES ("draw a card for each card that
        // was under them"). `?? 0` guards against test-injected cards that
        // may not initialize cardsUnder — the type is string[] but not every
        // test helper fills it in.
        state = { ...state, lastBanishedCardsUnderCount: instance.cardsUnder?.length ?? 0 };
        // Also snapshot effective strength for Wreck-it Ralph Raging Wrecker
        // WHO'S COMIN' WITH ME? — needs the strength he had IN PLAY
        // (including POWERED UP cardsUnder bonus) before cleanup wipes it.
        if (def) {
          const banishMods = getGameModifiers(state, definitions);
          const banishStrBonus = banishMods.statBonuses.get(instanceId)?.strength ?? 0;
          state = { ...state, lastBanishedSourceStrength: getEffectiveStrength(instance, def, banishStrBonus, banishMods) };
        }
        // Track character names banished this turn on the owner's PlayerState
        // (Buzz's Arm MISSING PIECE — "if a character named Buzz Lightyear was
        // banished this turn, you may play this item for free"). Both owners'
        // lists are consulted by the `character_named_was_banished_this_turn`
        // condition — the oracle doesn't restrict by owner. Cleared at PASS_TURN.
        if (def && def.cardType === "character") {
          const prev = state.players[instance.ownerId].characterNamesBanishedThisTurn ?? [];
          if (!prev.includes(def.name)) {
            state = {
              ...state,
              players: {
                ...state.players,
                [instance.ownerId]: {
                  ...state.players[instance.ownerId],
                  characterNamesBanishedThisTurn: [...prev, def.name],
                },
              },
            };
          }
        }
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
    // CRD 8.10.7: when a card with cards under it leaves play, ALL cards in
    // the stack go to the SAME zone as the top card. Each under-card moves to
    // its own owner's instance of the destination zone.
    const leavingInstSnapshot = state.cards[instanceId];
    const underCards = leavingInstSnapshot?.cardsUnder ?? [];
    const underDestZone: ZoneName = targetZone;
    for (const underId of underCards) {
      const underInst = state.cards[underId];
      if (!underInst) continue;
      state = {
        ...state,
        cards: {
          ...state.cards,
          [underId]: { ...underInst, zone: underDestZone },
        },
        zones: {
          ...state.zones,
          [underInst.ownerId]: {
            ...state.zones[underInst.ownerId],
            [underDestZone]: [...(state.zones[underInst.ownerId][underDestZone] ?? []), underId],
          },
        },
      };
    }

    state = updateInstance(state, instanceId, {
      isExerted: false,
      damage: 0,
      isDrying: false,
      grantedKeywords: [],
      timedEffects: [],
      atLocationInstanceId: undefined,
      // CRD 7.1.6: card becomes a "new" card on leaving play
      oncePerTurnTriggered: undefined,
      playedViaShift: false,
      challengedThisTurn: false,
      cardsUnder: [],
      boostedThisTurn: false,
    });
  }

  // Per-turn counter for "cards put into your discard this turn" now lives
  // in moveCard (utils/index.ts) — runs for every discard-destination
  // zone-change regardless of whether the caller went through zoneTransition
  // or moveCard directly. Previously this logic lived HERE, but it missed
  // the ~7 direct-moveCard discard paths (discard_from_hand, action cleanup,
  // mill, choose_discard, reveal_top_switch). See commit [counter-fix].

  // Fire post-move triggers + events
  if (!ctx.silent) {
    // Entering play
    if (targetZone === "play" && fromZone !== "play") {
      state = queueTrigger(state, "enters_play", instanceId, definitions, triggerCtx);
      state = queueTrigger(state, "card_played", instanceId, definitions, triggerCtx);
      // item_played: DELETED — collapsed to card_played with cardType filter.
      // Track "cards played this turn" — backs the unified played_this_turn
      // condition (Enigmatic Inkcaster 2+ cards, Airfoil 2+ actions, Powerline
      // a song, Ichabod cost-5+ character, Ariel Curious Traveler "another",
      // Cinderella Dream Come True Princess, Travelers cycle, etc.). Single
      // hook so all play paths (normal, free-play, shift, reveal-and-play,
      // sing-then-play) increment uniformly.
      if (ctx.reason === "played") {
        const ownerPid = instance.ownerId;
        const existing = state.players[ownerPid].cardsPlayedThisTurn ?? [];
        state = {
          ...state,
          players: {
            ...state.players,
            [ownerPid]: { ...state.players[ownerPid], cardsPlayedThisTurn: [...existing, instanceId] },
          },
        };
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

/**
 * Consolidated target-resolution + per-target application helper for zone-move
 * effects that share the chosen / this / triggering_card / all pattern.
 *
 * Before this helper, each of `banish`, `return_to_hand`, `put_into_inkwell`
 * (chosen branch), and `put_card_on_bottom_of_deck` (from:"play") duplicated
 * ~30-46 lines of identical target-dispatch boilerplate. The surface-level
 * Effect type discriminators stay distinct (for card-JSON readability + audit
 * patterns); only the reducer's target-dispatching internals consolidate.
 *
 * Precedent: `reveal_hand` / `look_at_hand` fall through the same case block
 * at reducer.ts:~2717 differing only in a `privateTo` flag. Same philosophy,
 * one abstraction layer deeper.
 *
 * Branch behavior:
 *  - chosen → create pendingChoice with `pendingEffect: effect` so the
 *    original case's `applyEffectToTarget` resolution branch runs on pick
 *  - this → call perInstance(sourceInstanceId) directly
 *  - triggering_card → optionally set lastResolvedTarget (Yzma BACK TO WORK),
 *    then perInstance(triggeringCardInstanceId)
 *  - all → findValidTargets + iterate + perInstance(id), optionally
 *    skipping instances not in play (for cascading banishes / mass returns)
 */
interface ResolveTargetAndApplyOptions {
  /** Prompt text shown in the pendingChoice when target.type === "chosen". */
  prompt: string;
  /** Alternate prompt for target.count > 1 ("up to N" variants — Grab Your
   *  Bow "Banish up to 2 chosen characters"). Omit for single-target cases. */
  promptForCount?: (count: number) => string;
  /** Per-target application: the actual move/banish/etc. Called for "this",
   *  "triggering_card", and each "all" iteration. The "chosen" branch doesn't
   *  call this here — resolution goes through the caller's `applyEffectToTarget`
   *  case after the pendingChoice resolves. */
  perInstance: (state: GameState, instanceId: string, events: GameEvent[]) => GameState;
  /** When true, writing lastResolvedTarget to the triggering card before
   *  perInstance runs — used by Yzma BACK TO WORK for the "target_owner"
   *  follow-up effect to read the returned card's owner. */
  setLastResolvedTargetOnTriggering?: boolean;
  /** Skip instances whose zone !== "play" in the "all" branch — defensive for
   *  cascading iterations (a banish in the iteration may queue triggers that
   *  later-iterate the same card; post-banish it's no longer in play). Also
   *  applies to return_to_hand's "all" branch (Milo Thatch TAKE THEM BY SURPRISE
   *  — CRD 1.7.7 "valid target" check is at the filter level, but a card could
   *  leave play between filter check and iteration). */
  skipIfNotInPlay?: boolean;
}

function resolveTargetAndApply(
  state: GameState,
  effect: { target: CardTarget; isMay?: boolean; [k: string]: unknown },
  opts: ResolveTargetAndApplyOptions,
  sourceInstanceId: string,
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  triggeringCardInstanceId?: string,
): GameState {
  const target = effect.target;

  if (target.type === "chosen") {
    const choosingPlayerId = chosenChooserPlayerId(target, controllingPlayerId);
    const validTargets = findChosenTargets(state, target.filter, choosingPlayerId, definitions, sourceInstanceId);
    if (validTargets.length === 0) return state; // CRD 1.7.7
    const count = target.count ?? 1;
    const prompt = count > 1 && opts.promptForCount
      ? opts.promptForCount(count)
      : opts.prompt;
    return {
      ...state,
      pendingChoice: {
        type: "choose_target",
        choosingPlayerId,
        prompt,
        validTargets,
        pendingEffect: effect as Effect,
        sourceInstanceId,
        triggeringCardInstanceId,
        optional: effect.isMay ?? false,
        count,
      },
    };
  }

  if (target.type === "this") {
    return opts.perInstance(state, sourceInstanceId, events);
  }

  if (target.type === "triggering_card" && triggeringCardInstanceId) {
    const trigInst = state.cards[triggeringCardInstanceId];
    if (!trigInst) return state;
    if (opts.setLastResolvedTargetOnTriggering) {
      const trigRef = makeResolvedRef(state, definitions, triggeringCardInstanceId);
      if (trigRef) state = { ...state, lastResolvedTarget: trigRef };
    }
    return opts.perInstance(state, triggeringCardInstanceId, events);
  }

  if (target.type === "all") {
    const targets = findValidTargets(state, target.filter, controllingPlayerId, definitions, sourceInstanceId);
    for (const id of targets) {
      if (opts.skipIfNotInPlay) {
        const inst = state.cards[id];
        if (!inst || inst.zone !== "play") continue;
      }
      state = opts.perInstance(state, id, events);
    }
    return state;
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
 * Consults both static damage_prevention entries (from gameModifiers) and the
 * instance's own timedEffects list ("takes no damage from challenges this turn").
 * "all" immunity blocks every source; "challenge" blocks only inChallenge; the
 * "non_challenge" tag blocks everything EXCEPT challenge damage (Hercules wording).
 */
function hasStaticDamagePrevention(
  instance: CardInstance,
  modifiers: GameModifiers,
  inChallenge: boolean
): boolean {
  const staticSources = modifiers.damagePrevention.get(instance.instanceId);
  if (!staticSources) return false;
  let matches = false;
  if (staticSources.has("all")) matches = true;
  else if (inChallenge && staticSources.has("challenge")) matches = true;
  else if (!inChallenge && staticSources.has("non_challenge")) matches = true;
  if (!matches) return false;
  // Charge-based static immunity (Lilo Bundled Up): only blocks if the
  // instance has any charges remaining this turn.
  const maxCharges = modifiers.damagePreventionCharges.get(instance.instanceId);
  if (maxCharges !== undefined) {
    const used = instance.damagePreventionChargesUsedThisTurn ?? 0;
    if (used >= maxCharges) return false;
  }
  return true;
}

/** Returns the index of the first matching damage_prevention timed effect, or -1
 *  if none. Caller is responsible for consuming the charge / dropping the effect. */
function findTimedDamagePreventionIdx(
  instance: CardInstance,
  inChallenge: boolean
): number {
  for (let i = 0; i < instance.timedEffects.length; i++) {
    const te = instance.timedEffects[i]!;
    if (te.type !== "damage_prevention") continue;
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
  asPutDamage = false,
  /** Source instance ID of the card whose effect is dealing the damage. Used
   *  for source-filtered triggers (Merida Formidable Archer STEADY AIM —
   *  "whenever one of your actions deals damage"). Undefined for direct
   *  challenge damage or non-ability sources. */
  sourceInstanceId?: string
): GameState {
  const modifiers = getGameModifiers(state, definitions);

  // CRD 1.9.1.5: Damage prevention ("takes no damage") blocks ALL damage taking:
  // deal, put, and move. Resist only blocks "dealt" (CRD 8.8.3).
  // So asPutDamage bypasses Resist but NOT damage prevention.
  const immTarget = state.cards[instanceId];
  if (immTarget) {
    if (hasStaticDamagePrevention(immTarget, modifiers, inChallenge)) {
      // Charge-based static immunity (Lilo Bundled Up): consume one charge
      // so subsequent hits this turn pass through.
      if (modifiers.damagePreventionCharges.has(instanceId)) {
        const used = (immTarget.damagePreventionChargesUsedThisTurn ?? 0) + 1;
        state = updateInstance(state, instanceId, { damagePreventionChargesUsedThisTurn: used });
      }
      return state;
    }
    const timedIdx = findTimedDamagePreventionIdx(immTarget, inChallenge);
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
      // CRD 1.8.1.4: Banish check handled by runGameStateCheck after action resolves
      return state;
    }
  }

  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];
  if (!def) return state;

  const resistValue = (ignoreResist || asPutDamage) ? 0 : getKeywordValue(instance, def, "resist", modifiers.grantedKeywords.get(instanceId));
  const actualDamage = Math.max(0, amount - resistValue);

  const newDamage = instance.damage + actualDamage;
  state = updateInstance(state, instanceId, { damage: newDamage });
  if (!asPutDamage) {
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
  if (actualDamage > 0 && !asPutDamage) {
    state = queueTrigger(state, "damage_dealt_to", instanceId, definitions, { sourceInstanceId });
  }

  // CRD 1.8.1.4: Banish check moved to runGameStateCheck — called after every
  // action/effect resolution. No longer inline here.

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
      state = dealDamageToCard(state, targetInstanceId, amount, definitions, events, false, false, effect.asPutDamage, sourceInstanceId);
      // Mirror exert/ready followUpEffects pattern.
      if ((effect as { followUpEffects?: Effect[] }).followUpEffects) {
        for (const fu of (effect as { followUpEffects: Effect[] }).followUpEffects) {
          state = applyEffect(state, fu, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        }
      }
      return state;
    }
    case "gain_lore":
    case "lose_lore": {
      // Unified — same as the applyEffect case. Supports DynamicAmount
      // variants that depend on the chosen target (target_lore, etc.).
      const rawAmt = resolveDynamicAmount(effect.amount, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, targetInstanceId);
      const signedAmt = effect.type === "lose_lore" ? -rawAmt : rawAmt;
      const tgtPlayer = effect.target.type === "opponent"
        ? getOpponent(controllingPlayerId)
        : controllingPlayerId;
      const loreBef = state.players[tgtPlayer].lore;
      state = gainLore(state, tgtPlayer, signedAmt, events, definitions);
      const loreAft = state.players[tgtPlayer].lore;
      state = { ...state, lastEffectResult: Math.abs(loreBef - loreAft) };
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
      state = banishCard(state, targetInstanceId, definitions, events);
      if ((effect as { followUpEffects?: Effect[] }).followUpEffects) {
        for (const fu of (effect as { followUpEffects: Effect[] }).followUpEffects) {
          state = applyEffect(state, fu, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        }
      }
      return state;
    }
    case "return_to_hand": {
      state = zoneTransition(state, targetInstanceId, "hand", definitions, events, { reason: "returned" });
      if ((effect as { followUpEffects?: Effect[] }).followUpEffects) {
        for (const fu of (effect as { followUpEffects: Effect[] }).followUpEffects) {
          state = applyEffect(state, fu, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        }
      }
      return state;
    }
    case "remember_chosen_target": {
      // Resolution path: write the chosen target id to the SOURCE's
      // rememberedTargetIds field. Persists until the source leaves play
      // (gameModifiers iteration just stops seeing it). Elsa's Ice Palace.
      const sourceInst = state.cards[sourceInstanceId];
      if (!sourceInst) return state;
      const existing = sourceInst.rememberedTargetIds ?? [];
      return updateInstance(state, sourceInstanceId, {
        rememberedTargetIds: [...existing, targetInstanceId],
      });
    }
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
            sourceInstanceId,
          },
        ],
      };
    }
    case "put_card_on_bottom_of_deck": {
      // Resolution path for chosen targets (from play or from hand/discard).
      // The chosen instance moves to its OWNER'S deck at the configured
      // position (Wrong Lever!, Anna Soothing Sister, Gyro Gearloose).
      const inst = state.cards[targetInstanceId];
      if (!inst) return state;
      const position: "top" | "bottom" = effect.position ?? "bottom";
      return moveCard(state, targetInstanceId, inst.ownerId, "deck", position);
    }
    case "drain_cards_under": {
      // Resolution path for both chosen-source (Come Out and Fight: "drain
      // the chosen parent's under-pile") and chosen-target-pile destination
      // (Bob Cratchit: "put cards under the chosen target"). Distinguished
      // by whether effect.destination is a target_pile with chosen target.
      if (typeof effect.destination === "object" && effect.destination.type === "target_pile") {
        // targetInstanceId is the RECEIVING parent. Drain source's own pile.
        return drainCardsUnderFrom(state, [sourceInstanceId], effect.destination, controllingPlayerId, definitions, events, targetInstanceId);
      }
      // Chosen-source resolution: drain the chosen parent into destination.
      return drainCardsUnderFrom(state, [targetInstanceId], effect.destination, controllingPlayerId, definitions, events);
    }
    case "put_top_card_under": {
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
          [topId]: { ...topInst, zone: "under", isFaceDown: true },
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
            isFaceDown: false, // was in play — remains face-up
            damage: 0,
            isExerted: false,
            isDrying: false,
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
      // Special strength-override variants compute the amount dynamically,
      // then delegate to the standard applyGainStatsToInstance path (which
      // now ALWAYS routes through TimedEffect, not tempModifiers).
      if (effect.strengthPerDamage) {
        const instance = getInstance(state, targetInstanceId);
        const override = { ...effect, strength: instance.damage, strengthPerDamage: undefined };
        return applyGainStatsToInstance(state, targetInstanceId, override as any, controllingPlayerId, definitions, sourceInstanceId);
      }
      if (effect.strengthPerCardInHand) {
        const handSize = getZone(state, controllingPlayerId, "hand").length;
        const override = { ...effect, strength: handSize, strengthPerCardInHand: undefined };
        return applyGainStatsToInstance(state, targetInstanceId, override as any, controllingPlayerId, definitions, sourceInstanceId);
      }
      if (effect.strengthEqualsSourceStrength) {
        const sourceInst = state.cards[sourceInstanceId];
        const sourceDef = sourceInst ? definitions[sourceInst.definitionId] : undefined;
        let srcStrength = 0;
        if (sourceInst && sourceDef) {
          const srcMods = getGameModifiers(state, definitions);
          srcStrength = getEffectiveStrength(
            sourceInst,
            sourceDef,
            srcMods.statBonuses.get(sourceInstanceId)?.strength ?? 0,
            srcMods,
          );
        }
        const override = { ...effect, strength: srcStrength, strengthEqualsSourceStrength: undefined };
        return applyGainStatsToInstance(state, targetInstanceId, override as any, controllingPlayerId, definitions, sourceInstanceId);
      }
      if (effect.strengthEqualsSourceWillpower) {
        // Zipper Big Helper BUZZING ENTHUSIASM: "add his {W} to another
        // chosen character's {S}". Read the SOURCE instance's effective
        // willpower (post-modifier, clamped to floors) and use that as the
        // strength bonus on the target.
        const sourceInst = state.cards[sourceInstanceId];
        const sourceDef = sourceInst ? definitions[sourceInst.definitionId] : undefined;
        let srcWillpower = 0;
        if (sourceInst && sourceDef) {
          const srcMods = getGameModifiers(state, definitions);
          srcWillpower = getEffectiveWillpower(
            sourceInst,
            sourceDef,
            srcMods.statBonuses.get(sourceInstanceId)?.willpower ?? 0,
            srcMods,
          );
        }
        const override = { ...effect, strength: srcWillpower, strengthEqualsSourceWillpower: undefined };
        return applyGainStatsToInstance(state, targetInstanceId, override as any, controllingPlayerId, definitions, sourceInstanceId);
      }
      if (effect.strengthEqualsTargetWillpower) {
        // Ranger Team-up: "Chosen character gets +{S} equal to their {W}
        // this turn." Unlike the source variants, the amount reads the
        // TARGET's own willpower — each target resolves its own bonus.
        const targetInst = state.cards[targetInstanceId];
        const targetDef = targetInst ? definitions[targetInst.definitionId] : undefined;
        let tgtWillpower = 0;
        if (targetInst && targetDef) {
          const tgtMods = getGameModifiers(state, definitions);
          tgtWillpower = getEffectiveWillpower(
            targetInst,
            targetDef,
            tgtMods.statBonuses.get(targetInstanceId)?.willpower ?? 0,
            tgtMods,
          );
        }
        const override = { ...effect, strength: tgtWillpower, strengthEqualsTargetWillpower: undefined };
        return applyGainStatsToInstance(state, targetInstanceId, override as any, controllingPlayerId, definitions, sourceInstanceId);
      }
      state = applyGainStatsToInstance(state, targetInstanceId, effect, controllingPlayerId, definitions, sourceInstanceId);
      if ((effect as { followUpEffects?: Effect[] }).followUpEffects) {
        for (const fu of (effect as { followUpEffects: Effect[] }).followUpEffects) {
          state = applyEffect(state, fu, sourceInstanceId, controllingPlayerId, definitions, events, triggeringCardInstanceId);
        }
      }
      return state;
    }
    case "remove_damage": {
      // Vision Slab TRAPPED! — see top-level remove_damage case above.
      // Belt-and-suspenders: also guard the post-choice path so a
      // pendingChoice initiated before Vision Slab entered play still
      // fizzles correctly if it resolves after.
      const mods = getGameModifiers(state, definitions);
      if (mods.preventDamageRemoval) {
        state = { ...state, lastEffectResult: 0 };
        return state;
      }
      const instance = getInstance(state, targetInstanceId);
      // CRD "up to N": in interactive mode, let the player choose how much to remove
      if (effect.isUpTo && state.interactive && instance.damage > 0) {
        const maxHeal = Math.min(effect.amount, instance.damage);
        if (maxHeal > 0) {
          // Snapshot target for the choose_amount handler
          const ref = makeResolvedRef(state, definitions, targetInstanceId);
          if (ref) state = { ...state, lastResolvedTarget: ref };
          return {
            ...state,
            pendingChoice: {
              type: "choose_amount",
              choosingPlayerId: controllingPlayerId,
              prompt: `Remove how much damage? (0–${maxHeal})`,
              min: 0,
              max: maxHeal,
              pendingEffect: effect,
              sourceInstanceId,
              triggeringCardInstanceId,
            },
          };
        }
      }
      const actualRemoved = Math.min(effect.amount, instance.damage);
      state = updateInstance(state, targetInstanceId, {
        damage: instance.damage - actualRemoved,
      });
      // CRD 6.1.5.1: Store result for "[A]. For each damage removed, [B]" patterns
      state = { ...state, lastEffectResult: actualRemoved };
      // Record the actual delta on lastResolvedTarget so follow-up reward effects
      // can read how many damage counters were consumed by an isUpTo remove_damage.
      // Baymax Armored Companion: "Gain 1 lore for each 1 damage removed this way."
      const deltaRef = makeResolvedRef(state, definitions, targetInstanceId, { delta: actualRemoved });
      if (deltaRef) state = { ...state, lastResolvedTarget: deltaRef };
      if (actualRemoved > 0) {
        state = markRemovedDamageThisTurn(state, controllingPlayerId);
        const targetDef = definitions[getInstance(state, targetInstanceId).definitionId];
        const targetName = targetDef?.fullName ?? targetInstanceId;
        state = appendLog(state, {
          turn: state.turnNumber,
          playerId: controllingPlayerId,
          message: `Removed ${actualRemoved} damage from ${targetName}.`,
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
        sourceInstanceId,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "remove_keyword_target": {
      // Maui Soaring Demigod IN MA BELLY: "loses Reckless this turn". Attach
      // a `suppress_keyword` TimedEffect; hasKeyword honors it until the
      // duration expires.
      const timedEffect: TimedEffect = {
        type: "suppress_keyword",
        keyword: effect.keyword,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "ready": {
      // Effect-driven ready (Shield of Virtue, Fan the Flames, Maui's I GOT
      // YOUR BACK, Fred Giant-Sized's boost-ready). The NARROW "ready"
      // restriction is turn-start-only and does NOT block this path, but the
      // BLANKET "ready_anytime" restriction (Gargoyle STONE BY DAY) does —
      // dormant Gargoyles with 3+ cards in hand cannot be readied by any
      // means while the condition holds.
      const targetInst = getInstance(state, targetInstanceId);
      const targetDef = definitions[targetInst.definitionId];
      if (targetDef) {
        const readyMods = getGameModifiers(state, definitions);
        if (isActionRestricted(targetInst, targetDef, "ready_anytime", targetInst.ownerId, state, readyMods)) {
          return state;
        }
      }
      const wasExerted = targetInst.isExerted;
      state = updateInstance(state, targetInstanceId, { isExerted: false });
      if (wasExerted) {
        state = queueTrigger(state, "readied", targetInstanceId, definitions, {});
      }
      // John Silver Ferocious Friend: "ready that character. They cannot
      // quest this turn." — followUpEffects apply to the same readied card
      // (mirrors the applyEffect `this` branch that already does this).
      if (effect.followUpEffects) {
        for (const followUp of effect.followUpEffects) {
          state = applyEffectToTarget(state, followUp, targetInstanceId, controllingPlayerId, definitions, events, sourceInstanceId, triggeringCardInstanceId);
        }
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
        sourceInstanceId,
      };
      state = addTimedEffect(state, targetInstanceId, timedEffect);
      // Apply any follow-up effects to the same target — used by "can't X AND
      // must Y" oracle pairs (This Growing Pressure / Ariel Curious Traveler /
      // Gaston Frightful Bully). Mirrors the exert/ready/remove_damage pattern.
      if (effect.followUpEffects) {
        for (const followUp of effect.followUpEffects) {
          state = applyEffectToTarget(state, followUp, targetInstanceId, controllingPlayerId, definitions, events, sourceInstanceId, triggeringCardInstanceId);
        }
      }
      return state;
    }
    case "cant_be_challenged_timed": {
      return addTimedEffect(state, targetInstanceId, {
        type: "cant_be_challenged",
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
      });
    }
    case "must_quest_if_able": {
      // Reached only via followUpEffects (e.g. cant_action's followUp chain
      // for "can't challenge AND must quest" pairs) or via a direct target
      // like last_resolved_target. The primary path for chosen targets is in
      // applyEffect.
      return addTimedEffect(state, targetInstanceId, {
        type: "must_quest_if_able",
        amount: 0,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
      });
    }
    case "damage_prevention_timed": {
      return addTimedEffect(state, targetInstanceId, {
        type: "damage_prevention",
        damageSource: effect.source,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
        ...(effect.charges !== undefined ? { charges: effect.charges } : {}),
      });
    }
    case "put_into_inkwell": {
      const inst = getInstance(state, targetInstanceId);
      state = zoneTransition(state, targetInstanceId, "inkwell", definitions, events, { reason: "inked" });
      if (effect.enterExerted) {
        state = updateInstance(state, targetInstanceId, { isExerted: true });
      } else {
        state = addInkFromEffect(state, inst.ownerId);
      }
      // CRD 6.2: "whenever a card is put into your inkwell" fires for chosen-target
      // inkwell placement (Oswald watching Fishbone Quill's chosen-hand-card path).
      state = queueTriggersByEvent(state, "card_put_into_inkwell", inst.ownerId, definitions, {});
      return state;
    }
    case "self_replacement": {
      // Target-resolved branch of CRD 6.5.6. Two sub-modes:
      //  - condition is a CardFilter: match against the resolved target
      //    (Vicious Betrayal: "if Villain is chosen").
      //  - condition is a Condition (has `type` field): evaluate as game
      //    state check, target is shared across branches but not inspected
      //    by the condition (Terror That Flaps: pick opposing char, THEN
      //    check "if you have Darkwing Duck in play").
      const cond = effect.condition as any;
      let matches: boolean;
      if (cond && typeof cond === "object" && typeof cond.type === "string") {
        matches = evaluateCondition(cond, state, definitions, controllingPlayerId, sourceInstanceId);
      } else {
        const inst = getInstance(state, targetInstanceId);
        const def = definitions[inst.definitionId];
        matches = def ? matchesFilter(inst, def, cond, state, controllingPlayerId) : false;
      }
      const branch = matches ? effect.instead : effect.effect;
      for (const e of branch) {
        state = applyEffectToTarget(state, e, targetInstanceId, controllingPlayerId, definitions, events, sourceInstanceId, triggeringCardInstanceId);
      }
      return state;
    }
    case "play_card": {
      // Play the chosen card. Source zone defaults to "hand" but may be "discard"
      // (Ursula - Deceiver of All), "under" (The Black Cauldron), or any other zone.
      // `cost: "normal"` deducts the card's effective ink cost (paid play); default is free.
      const inst = getInstance(state, targetInstanceId);
      // sourceZone may be a single zone or an array (Prince John Gold Lover —
      // "from your hand or discard"). Normalize to a Set for the membership
      // check; downstream branches read `inst.zone` (the actual source zone of
      // the chosen card) rather than the configured filter.
      const expectedSourceRaw = effect.sourceZone ?? "hand";
      const expectedSources: string[] = Array.isArray(expectedSourceRaw) ? expectedSourceRaw : [expectedSourceRaw];
      if (!expectedSources.includes(inst.zone)) return state;
      const expectedSource = inst.zone;
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
      // Items + locations support enterExerted too — Queen Diviner CONSULT
      // THE SPELLBOOK plays a cost-≤3 item for free entering exerted.
      else if (effect.enterExerted && (def.cardType === "item" || def.cardType === "location")) {
        state = updateInstance(state, targetInstanceId, { isExerted: true });
      }
      // Mirror applyPlayCard: queue Bodyguard's may-enter-exerted trigger and any
      // enter_play_exerted_self / EnterPlayExertedStatic modifiers. Without this,
      // characters played via the play_card effect (Mufasa Among Family, Lilo
      // Rock Star, Lady Tremaine, etc.) silently skipped Bodyguard's trigger.
      // Caught by the parameterized Bug 4 regression suite in reducer.test.ts.
      if (def.cardType === "character" || def.cardType === "item" || def.cardType === "location") {
        state = applyEnterPlayExertion(state, targetInstanceId, controllingPlayerId, definitions);
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
        // CRD 1.9.1.5: check damage prevention on destination
        const allDstMods = getGameModifiers(state, definitions);
        const dstImmune = hasStaticDamagePrevention(dst0, allDstMods, false) || findTimedDamagePreventionIdx(dst0, false) >= 0;
        if (dstImmune && allDstMods.damagePreventionCharges.has(targetInstanceId)) {
          const used = (dst0.damagePreventionChargesUsedThisTurn ?? 0) + 1;
          state = updateInstance(state, targetInstanceId, { damagePreventionChargesUsedThisTurn: used });
        }
        let totalMoved = 0;
        for (const ref of allSources) {
          // Skip the destination itself — "move damage from all OTHER
          // characters" (Can't Hold It Back Anymore). Without this, if the
          // destination had damage pre-effect, we'd drain it to itself.
          if (ref.instanceId === targetInstanceId) continue;
          const src = state.cards[ref.instanceId];
          if (!src || src.damage <= 0) continue;
          const moveAmt = Math.min(effect.amount, src.damage);
          if (moveAmt <= 0) continue;
          state = updateInstance(state, src.instanceId, { damage: src.damage - moveAmt });
          if (!dstImmune) {
            const dstNow = state.cards[targetInstanceId];
            if (!dstNow) continue;
            state = updateInstance(state, targetInstanceId, { damage: dstNow.damage + moveAmt });
          }
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
        const maxMove = Math.min(effect.amount, src.damage);
        if (maxMove <= 0) return state;
        // CRD "up to N": in interactive mode, let the player choose how many to move
        if (effect.isUpTo && state.interactive && maxMove > 0) {
          // Snapshot for choose_amount — target is the destination
          const ref = makeResolvedRef(state, definitions, targetInstanceId);
          if (ref) state = { ...state, lastResolvedTarget: ref };
          // Store source ref for the resolution handler
          state = { ...state, lastResolvedSource: effect._resolvedSource };
          return {
            ...state,
            pendingChoice: {
              type: "choose_amount",
              choosingPlayerId: controllingPlayerId,
              prompt: `Move how much damage? (0–${maxMove})`,
              min: 0,
              max: maxMove,
              pendingEffect: effect,
              sourceInstanceId,
              triggeringCardInstanceId,
            },
          };
        }
        let moveAmt = Math.min(effect.amount, src.damage);
        // CRD 1.9.1.5: "move" counts as "take damage" — check damage prevention on destination
        const dstModifiers = getGameModifiers(state, definitions);
        if (hasStaticDamagePrevention(dst, dstModifiers, false) || findTimedDamagePreventionIdx(dst, false) >= 0) {
          // Destination is immune to damage — damage is still removed from source but not added to dest
          // Consume charges if applicable (Lilo Bundled Up)
          if (dstModifiers.damagePreventionCharges.has(targetInstanceId)) {
            const used = (dst.damagePreventionChargesUsedThisTurn ?? 0) + 1;
            state = updateInstance(state, targetInstanceId, { damagePreventionChargesUsedThisTurn: used });
          }
          moveAmt = 0;
        }
        if (moveAmt > 0) {
          state = updateInstance(state, src.instanceId, { damage: src.damage - moveAmt });
          state = updateInstance(state, targetInstanceId, { damage: dst.damage + moveAmt });
        }
        // Record actually-moved count on lastResolvedTarget for follow-up effects.
        const deltaRef = makeResolvedRef(state, definitions, targetInstanceId, { delta: moveAmt });
        if (deltaRef) state = { ...state, lastResolvedTarget: deltaRef };
        return state;
      }
      // Destination "this" — pin to the source instance, skipping the second
      // chooser (Luisa Madrigal No Pressure SHOULDER THE BURDEN).
      if (effect.destination.type === "this") {
        const dst = state.cards[sourceInstanceId];
        const src = state.cards[targetInstanceId];
        if (!dst || !src) return state;
        const moveAmt = effect.isUpTo
          ? Math.min(effect.amount, src.damage)
          : Math.min(effect.amount, src.damage);
        if (moveAmt > 0) {
          state = updateInstance(state, targetInstanceId, { damage: src.damage - moveAmt });
          state = updateInstance(state, sourceInstanceId, { damage: dst.damage + moveAmt });
        }
        const deltaRef = makeResolvedRef(state, definitions, sourceInstanceId, { delta: moveAmt });
        if (deltaRef) state = { ...state, lastResolvedTarget: deltaRef };
        return state;
      }
      // Stage 1: targetInstanceId is the chosen SOURCE. Surface destination choice.
      const validDests = findChosenTargets(state, effect.destination.filter, controllingPlayerId, definitions, targetInstanceId)
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
        const candidates = findChosenTargets(state, effect.character.filter, controllingPlayerId, definitions, sourceInstanceId)
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
        let validLocations = findChosenTargets(state, effect.location.filter, controllingPlayerId, definitions, targetInstanceId);
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
        sourceInstanceId,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    case "sing_cost_bonus_target": {
      const timedEffect: TimedEffect = {
        type: "sing_cost_bonus",
        amount: effect.amount,
        expiresAt: effect.duration,
        appliedOnTurn: state.turnNumber,
        casterPlayerId: controllingPlayerId,
        sourceInstanceId,
      };
      return addTimedEffect(state, targetInstanceId, timedEffect);
    }
    // put_cards_under_onto_target: folded into drain_cards_under. The
    // resolution of chosen receiving target happens in the drain_cards_under
    // case above with destination:{type:"target_pile",target}.
    default:
      return state;
  }
}

/**
 * Drain cardsUnder piles from a list of parent instances to the destination.
 * Routes each under-card to its OWN owner's zone (hand / deck bottom) or to
 * the controller's inkwell; queues the canonical cross-card trigger per
 * destination (card_put_into_inkwell / card_put_under). `parentIds` is the
 * caller-resolved parent list (source resolution lives with the caller).
 * `destTargetId` is required when destination is target_pile (already-resolved
 * target).
 */
function drainCardsUnderFrom(
  state: GameState,
  parentIds: string[],
  destination:
    | "hand"
    | "bottom_of_deck"
    | "inkwell"
    | { type: "target_pile"; target: CardTarget },
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  _events: GameEvent[],
  destTargetId?: string,
): GameState {
  const isInkwell = destination === "inkwell";
  const isTargetPile = typeof destination === "object" && destination.type === "target_pile";
  const isBottomOfDeck = destination === "bottom_of_deck";
  const receivingPlayers = new Set<PlayerID>();

  for (const parentId of parentIds) {
    const parent = state.cards[parentId];
    if (!parent || parent.cardsUnder.length === 0) continue;
    let underIds = [...parent.cardsUnder];
    if (isBottomOfDeck) {
      for (let i = underIds.length - 1; i > 0; i--) {
        const j = rngNextInt(state.rng, i + 1);
        [underIds[i], underIds[j]] = [underIds[j]!, underIds[i]!];
      }
    }
    for (const id of underIds) {
      const u = state.cards[id];
      if (!u) continue;
      if (isTargetPile && destTargetId) {
        // Attach to target's cardsUnder; keep card's zone as "under".
        const targetCard = state.cards[destTargetId];
        if (!targetCard) continue;
        state = {
          ...state,
          cards: {
            ...state.cards,
            [id]: { ...u, zone: "under" },
            [destTargetId]: { ...targetCard, cardsUnder: [...targetCard.cardsUnder, id] },
          },
        };
      } else {
        const destZone: ZoneName = isInkwell ? "inkwell" : isBottomOfDeck ? "deck" : "hand";
        const destOwner = isInkwell ? controllingPlayerId : u.ownerId;
        const updatedCard = { ...u, zone: destZone, ...(isInkwell ? { isExerted: true } : {}) };
        const zoneKey = destZone as keyof typeof state.zones[typeof destOwner];
        state = {
          ...state,
          cards: { ...state.cards, [id]: updatedCard },
          zones: {
            ...state.zones,
            [destOwner]: {
              ...state.zones[destOwner],
              [zoneKey]: [...(state.zones[destOwner][zoneKey] as string[]), id],
            },
          },
        };
        if (isInkwell) receivingPlayers.add(destOwner);
      }
    }
    state = updateInstance(state, parentId, { cardsUnder: [] });
  }
  // CRD 6.2: fire card_put_into_inkwell per receiving player (Oswald, Chicha).
  for (const pid of receivingPlayers) {
    state = queueTriggersByEvent(state, "card_put_into_inkwell", pid, definitions, {});
  }
  // CRD 6.2: for target_pile, fire card_put_under on the receiving parent.
  if (isTargetPile && destTargetId) {
    state = queueTrigger(state, "card_put_under", destTargetId, definitions, {
      triggeringPlayerId: controllingPlayerId,
    });
  }
  return state;
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
 *  (for "this_turn") or addTimedEffect (for end_of_turn /
 *  end_of_owner_next_turn / until_caster_next_turn — which need to survive
 *  across turn boundaries). For until_caster_next_turn, the casterPlayerId is
 *  recorded so cleanup can compare against the right player (CRD "your next turn"). */
function applyGainStatsToInstance(
  state: GameState,
  instanceId: string,
  effect: import("../types/index.js").GainStatsEffect,
  casterPlayerId: PlayerID,
  definitions?: Record<string, CardDefinition>,
  sourceInstId?: string,
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

  // ALL durations route through TimedEffect. CRD treats "this turn" stat
  // buffs identically to "this turn" keyword grants — both are timed effects.
  // Previously "this_turn" used a tempStrengthModifier fast path; collapsed
  // for conceptual simplicity. "this_turn" maps to "end_of_turn" for expiry.
  const expiresAt: import("../types/index.js").EffectDuration =
    effect.duration === "this_turn" ? "end_of_turn"
    : effect.duration === "permanent" ? "end_of_turn" // no cards use permanent; safe default
    : effect.duration as import("../types/index.js").EffectDuration;
  const baseTimed = {
    expiresAt,
    appliedOnTurn: state.turnNumber,
    casterPlayerId,
    sourceInstanceId: sourceInstId,
    // Stamp the producing ability/keyword's storyName so the UI's Active
    // Effects panel can attribute the buff correctly on multi-ability cards
    // (The Queen Conceited Ruler: Support AND ROYAL SUMMONS).
    ...(effect._sourceStoryName ? { sourceStoryName: effect._sourceStoryName } : {}),
  };
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

/**
 * Pay the unlock cost for a cant_action_self restriction, if one is present
 * for this (instance, action) pair. Used by RC Remote-Controlled Car to pay
 * 1 {I} every time it quests or challenges. Validator has already confirmed
 * the cost is payable; this silently deducts it. Reuses payCosts() internally.
 */
function payActionUnlockCost(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  action: RestrictedAction,
  modifiers: { selfActionUnlockCosts?: Map<string, Map<RestrictedAction, Cost[]>> }
): GameState {
  const costs = modifiers.selfActionUnlockCosts?.get(instanceId)?.get(action);
  if (!costs || costs.length === 0) return state;
  return payCosts(state, playerId, instanceId, costs, []);
}

/**
 * Per-turn flag setter: mark that the given player removed damage from at
 * least one character this turn. Used by Julieta's Arepas THAT DID THE TRICK
 * activated ability. Idempotent (safe to call on every successful remove).
 */
function markRemovedDamageThisTurn(state: GameState, playerId: PlayerID): GameState {
  if (state.players[playerId].youRemovedDamageThisTurn) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], youRemovedDamageThisTurn: true },
    },
  };
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

/**
 * Resolve a CardTarget to a concrete instance id WITHOUT surfacing a chooser.
 * Handles the "direct" target types: this, triggering_card, last_resolved_target,
 * from_last_discarded. Returns undefined for target types that need a chooser
 * (chosen, all, random) — those must be handled by the caller.
 *
 * Collapses the ~5-line boilerplate that was previously duplicated across 9+
 * effect handlers in the reducer.
 */
function resolveDirectTarget(
  target: { type: string },
  state: GameState,
  sourceInstanceId: string,
  triggeringCardInstanceId?: string
): string | undefined {
  switch (target.type) {
    case "this": return sourceInstanceId;
    case "triggering_card": return triggeringCardInstanceId;
    case "last_resolved_target": return state.lastResolvedTarget?.instanceId;
    case "from_last_discarded": return state.lastDiscarded?.[0]?.instanceId;
    default: return undefined;
  }
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

/** CRD 8.15.1: chosen-target enumeration. Same as findValidTargets but also
 *  excludes opposing Ward characters — they can't be chosen by an opponent's
 *  effect. Used wherever a `pendingChoice: { type: "choose_target" }` is
 *  surfaced for a card target. NOT used for "all" / "each" sweeps, which
 *  bypass Ward per CRD 8.15.2.
 *
 *  Without this, when the only candidate target is an opposing Ward
 *  character, findValidTargets returns it as "valid", a PendingChoice gets
 *  created, the validator rejects every choice, and bots loop forever
 *  (the Let the Storm Rage On bug). With this, validTargets is empty and
 *  the choose-target effect skips per CRD 1.7.7. */
function findChosenTargets(
  state: GameState,
  filter: import("../types/index.js").CardFilter,
  choosingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  sourceInstanceId?: string
): string[] {
  return findValidTargets(state, filter, choosingPlayerId, definitions, sourceInstanceId)
    .filter((id) => {
      const inst = state.cards[id];
      if (!inst) return false;
      const def = definitions[inst.definitionId];
      if (!def) return false;
      if (inst.ownerId === choosingPlayerId) return true;
      return !hasKeyword(inst, def, "ward");
    });
}

/**
 * CRD 1.8: Unified game state check. Runs after every turn action, effect
 * resolution, and at specific points during challenge and turn structure.
 *
 * Checks (in order):
 * - 1.8.1.4: damage ≥ willpower → banish (cascades per 1.8.3)
 * - 1.8.1.1: lore ≥ threshold → win
 *
 * @param challengeCtx — when called after challenge damage, provides attacker/
 *   defender IDs so banishes are correctly tagged as "banished in a challenge"
 *   for trigger dispatch (banished_in_challenge, banished_other_in_challenge).
 */
function runGameStateCheck(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  challengeCtx?: { attackerId: string; defenderId: string }
): GameState {
  if (state.isGameOver) return state;

  // CRD 1.8.3: Loop until no new conditions are met
  let changed = true;
  while (changed) {
    changed = false;

    // CRD 1.8.1.4: damage ≥ willpower → banish
    const modifiers = getGameModifiers(state, definitions);
    for (const id of Object.keys(state.cards)) {
      const inst = state.cards[id];
      if (!inst || inst.zone !== "play") continue;
      const def = definitions[inst.definitionId];
      if (!def) continue;
      if (def.cardType !== "character" && def.cardType !== "location") continue;
      const wp = getEffectiveWillpower(inst, def,
        modifiers.statBonuses.get(id)?.willpower ?? 0);
      if (wp > 0 && inst.damage >= wp) {
        // Determine if this banish is from a challenge (for trigger context)
        const isChallengeBanish = challengeCtx && (id === challengeCtx.attackerId || id === challengeCtx.defenderId);
        const challengeOpponentId = isChallengeBanish
          ? (id === challengeCtx!.attackerId ? challengeCtx!.defenderId : challengeCtx!.attackerId)
          : undefined;
        state = banishCard(state, id, definitions, events,
          challengeOpponentId ? { challengeOpponentId } : undefined);
        changed = true;
      }
    }

    // CRD 1.8.1.1: lore ≥ threshold → win
    for (const [playerId, playerState] of Object.entries(state.players)) {
      const threshold = getLoreThreshold(state, definitions, playerId as PlayerID);
      if (playerState.lore >= threshold) {
        return { ...state, winner: playerId as PlayerID, isGameOver: true };
      }
    }
  }

  return state;
}
