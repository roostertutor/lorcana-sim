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
  evaluateCondition,
  findMatchingInstances,
  getDefinition,
  getInstance,
  getKeywordValue,
  getOpponent,
  getZone,
  hasKeyword,
  isActionRestricted,
  isMainPhase,
  isSong,
  matchesFilter,
} from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const OK: ValidationResult = { valid: true };
const fail = (reason: string): ValidationResult => ({ valid: false, reason });

/**
 * CRD 8.10.1 + variants: can `shifting` be played via Shift onto `target`?
 * Variants are zone-aware static abilities (see types/index.ts) — pass GameModifiers
 * for the lookups. alternateNames stays a printed-name property on CardDefinition.
 *
 * Handles:
 *  - base Shift (same name)
 *  - Universal Shift (Baymax, Set 7+) — shifting card ignores name match (in-hand static)
 *  - MIMICRY (Morph - Space Goo, Set 3) — target ignores name match (in-play static)
 *  - Classification / Puppy Shift (Thunderbolt, Set 8) — target must have a trait (in-hand static)
 *  - alternateNames — either side may declare extra names (Turbo, Flotsam & Jetsam)
 */
export function canShiftOnto(
  shiftingInstanceId: string,
  shifting: CardDefinition,
  targetInstanceId: string,
  target: CardDefinition,
  modifiers: { universalShifters: Set<string>; mimicryTargets: Set<string>; classificationShifters: Map<string, string> }
): boolean {
  // Universal: shifting card explicitly ignores name match.
  if (modifiers.universalShifters.has(shiftingInstanceId)) return true;
  // MIMICRY: target card explicitly ignores name match for any shifter.
  if (modifiers.mimicryTargets.has(targetInstanceId)) return true;
  // Classification shift: target must have the required trait (e.g. "Puppy").
  const requiredTrait = modifiers.classificationShifters.get(shiftingInstanceId);
  if (requiredTrait) {
    return target.traits.includes(requiredTrait);
  }
  // Base shift: name must match. Either side may carry alternate names (CRD 5.2.6.1–3).
  if (shifting.name === target.name) return true;
  if (shifting.alternateNames?.includes(target.name)) return true;
  if (target.alternateNames?.includes(shifting.name)) return true;
  return false;
}

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
      return validatePlayCard(state, action.playerId, action.instanceId, definitions, action.shiftTargetInstanceId, action.singerInstanceId, action.singerInstanceIds, action.viaGrantedFreePlay, action.altShiftCostInstanceIds);
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
    case "MOVE_CHARACTER":
      return validateMoveCharacter(state, action.playerId, action.characterInstanceId, action.locationInstanceId, definitions);
    case "BOOST_CARD":
      return validateBoostCard(state, action.playerId, action.instanceId, definitions);
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
  singerInstanceId?: string,
  singerInstanceIds?: string[],
  viaGrantedFreePlay?: boolean,
  altShiftCostInstanceIds?: string,
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  // CRD 4.3.2: player-initiated plays are from hand. Cards that play from
  // other zones (Lilo Escape Artist from discard at turn start) do so via
  // triggered `play_card` effects, which bypass this validator entirely.
  if (instance.zone !== "hand") return fail("Card is not in your hand.");

  const def = getDefinition(state, instanceId, definitions);

  // CRD 6.6.1 / 4.3.x: play restrictions — checked BEFORE alternate cost paths
  // (shift, sing, sing-together) because "opponents can't play actions" applies
  // regardless of HOW the card is played. Singing doesn't bypass play restrictions,
  // only the ink cost. Pete Games Referee, Keep the Ancient Ways.
  {
    const playModifiers = getGameModifiers(state, definitions);
    if (isActionRestricted(instance, def, "play", playerId, state, playModifiers)) {
      return fail("You can't play this card right now.");
    }
    if (def.playRestrictions) {
      for (const cond of def.playRestrictions) {
        if (!evaluateCondition(cond, state, definitions, playerId, instanceId)) {
          return fail("Play restriction not met.");
        }
      }
    }
    const timedPlayBlocks = state.players[playerId].playRestrictions ?? [];
    for (const entry of timedPlayBlocks) {
      if (entry.cardTypes.includes(def.cardType)) {
        return fail(`You can't play ${def.cardType}s right now.`);
      }
    }
  }

  // CRD 8.10.1: Shift — alternate cost onto same-named character in play.
  // Two cost modes: ink-based (shiftCost / grantedShiftSelf) or discard-based (shiftDiscardCost).
  if (shiftTargetInstanceId) {
    const shiftModifiers = getGameModifiers(state, definitions);
    const grantedShift = shiftModifiers.grantedShiftSelf.get(instanceId);
    const printedShift = def.shiftCost;
    const baseShiftCost = printedShift ?? grantedShift;
    const hasInkShift = baseShiftCost !== undefined;
    const hasAltShift = !!def.altShiftCost;
    if (!hasInkShift && !hasAltShift) return fail("This card doesn't have Shift.");
    // Common checks: target validity + name match
    const shiftTarget = getInstance(state, shiftTargetInstanceId);
    if (shiftTarget.zone !== "play") return fail("Shift target is not in play.");
    if (shiftTarget.ownerId !== playerId) return fail("You don't own the shift target.");
    const shiftTargetDef = getDefinition(state, shiftTargetInstanceId, definitions);
    if (!canShiftOnto(instanceId, def, shiftTargetInstanceId, shiftTargetDef, shiftModifiers)) {
      return fail("Shift target must share this character's name.");
    }
    // Alt-cost shift (Diablo, Flotsam etc.): pay a non-ink cost. Two entry
    // modes — cost-IDs provided (legacy, headless bot, or post-pendingChoice
    // re-invoke) validates each target; no cost-IDs (new interactive path)
    // just verifies feasibility so applyPlayCard can surface the chooser.
    if (hasAltShift) {
      const altCost = def.altShiftCost!;
      const requiredAmount = altCost.type === "discard" ? (altCost.amount ?? 1) : 1;
      if (altShiftCostInstanceIds && altShiftCostInstanceIds.length > 0) {
        if (altShiftCostInstanceIds.length !== requiredAmount) {
          return fail(`Alt shift cost requires ${requiredAmount} card(s), got ${altShiftCostInstanceIds.length}.`);
        }
        for (const costId of altShiftCostInstanceIds) {
          const costTarget = getInstance(state, costId);
          if (costTarget.ownerId !== playerId) return fail("You don't own the cost target.");
          if (costId === instanceId) return fail("Can't use the card you're playing as a cost.");
          const costTargetDef = getDefinition(state, costId, definitions);
          if (altCost.type === "discard") {
            if (costTarget.zone !== "hand") return fail("Discard target is not in your hand.");
            if (altCost.filter && !matchesFilter(costTarget, costTargetDef, altCost.filter, state, playerId)) {
              return fail("Discard target doesn't match the shift cost filter.");
            }
          } else if (altCost.type === "banish_chosen") {
            if (costTarget.zone !== "play") return fail("Banish target is not in play.");
            if (!matchesFilter(costTarget, costTargetDef, altCost.filter, state, playerId)) {
              return fail("Banish target doesn't match the shift cost filter.");
            }
          }
        }
        return OK; // No ink check — alt cost IS the cost
      }
      // No cost-IDs → feasibility check: at least `requiredAmount` valid cost
      // targets must exist. applyPlayCard surfaces a pendingChoice from here.
      let eligible: string[] = [];
      if (altCost.type === "discard") {
        eligible = getZone(state, playerId, "hand").filter(id => {
          if (id === instanceId) return false;
          const inst = state.cards[id];
          const d = inst ? definitions[inst.definitionId] : undefined;
          return !!inst && !!d && (!altCost.filter || matchesFilter(inst, d, altCost.filter, state, playerId));
        });
      } else if (altCost.type === "banish_chosen") {
        eligible = getZone(state, playerId, "play").filter(id => {
          if (id === shiftTargetInstanceId) return false;
          const inst = state.cards[id];
          const d = inst ? definitions[inst.definitionId] : undefined;
          return !!inst && !!d && matchesFilter(inst, d, altCost.filter, state, playerId);
        });
      }
      if (eligible.length >= requiredAmount) return OK;
      // Not enough valid cost targets — fall through to ink check below (may
      // still work if the card happens to have a printed shift cost too).
    }
    // Ink-based shift (standard)
    if (hasInkShift) {
      const effectiveShiftCost = getEffectiveCostWithReductions(state, playerId, instanceId, definitions, baseShiftCost!);
      if (!canAfford(state, playerId, effectiveShiftCost)) {
        return fail(`Not enough ink. Need ${effectiveShiftCost} (shift), have ${state.players[playerId].availableInk}.`);
      }
      return OK;
    }
    // Has alt shift but no feasible cost
    return fail("Not enough valid cards to pay the Shift alternate cost.");
  }

  // CRD 5.4.4.2: Singing — exert character to play song for free (alternate cost)
  if (singerInstanceId) {
    if (!isSong(def)) return fail("Only songs can be sung.");
    const singer = getInstance(state, singerInstanceId);
    const singerDefCheck = getDefinition(state, singerInstanceId, definitions);
    if (singerDefCheck.cardType !== "character") return fail("Only characters can sing songs."); // CRD 5.4.4.2
    if (singer.zone !== "play") return fail("Singer is not in play.");
    if (singer.ownerId !== playerId) return fail("You don't own the singer.");
    if (singer.isExerted) return fail("Singer is already exerted.");
    if (singer.isDrying) return fail("Singer is still drying and cannot sing.");
    // CRD 6.6.1: Check sing restrictions (timed effects + statics like Ariel - On Human Legs)
    const modifiers = getGameModifiers(state, definitions);
    const singerInst = getInstance(state, singerInstanceId);
    const singerDef2 = getDefinition(state, singerInstanceId, definitions);
    if (isActionRestricted(singerInst, singerDef2, "sing", playerId, state, modifiers)) {
      return fail("This character can't sing songs.");
    }
    const singerDef = getDefinition(state, singerInstanceId, definitions);
    // Atlantica Concert Hall: virtual sing-cost bonus while at certain locations.
    const singerLocBonus = singer.atLocationInstanceId
      ? (modifiers.singCostBonusHere.get(singer.atLocationInstanceId) ?? 0)
      : 0;
    // Naveen's Ukulele MAKE IT SING: per-character timed sing-cost bonus.
    const singerTimedBonus = (singer.timedEffects ?? [])
      .filter(t => t.type === "sing_cost_bonus")
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    // Record Player HIT PARADE: per-character static sing-cost bonus.
    const singerCharBonus = modifiers.singCostBonusCharacters.get(singerInstanceId) ?? 0;
    if (!canSingSong(singer, singerDef, def, singerLocBonus + singerTimedBonus + singerCharBonus)) {
      return fail(`Singer's cost is too low to sing this song.`);
    }
    return OK; // No ink check — singing replaces ink cost entirely (CRD 1.5.5.1)
  }

  // CRD 8.12: Sing Together — multiple characters with combined effective cost ≥ singTogetherCost
  if (singerInstanceIds && singerInstanceIds.length > 0) {
    if (!isSong(def)) return fail("Only songs can be sung.");
    if (def.singTogetherCost === undefined) return fail("This song does not have Sing Together.");
    if (singerInstanceIds.length < 1) return fail("Sing Together requires at least one singer.");
    // Validate uniqueness — no duplicate IDs
    const seen = new Set<string>();
    for (const id of singerInstanceIds) {
      if (seen.has(id)) return fail("Sing Together singers must be distinct.");
      seen.add(id);
    }
    const stModifiers = getGameModifiers(state, definitions);
    let totalCost = 0;
    for (const sId of singerInstanceIds) {
      const s = getInstance(state, sId);
      const sDef = getDefinition(state, sId, definitions);
      if (sDef.cardType !== "character") return fail("Only characters can sing songs.");
      if (s.zone !== "play") return fail("Singer is not in play.");
      if (s.ownerId !== playerId) return fail("You don't own one of the singers.");
      if (s.isExerted) return fail("One of the singers is already exerted.");
      if (s.isDrying) return fail("One of the singers is still drying.");
      if (isActionRestricted(s, sDef, "sing", playerId, state, stModifiers)) {
        return fail("One of the singers can't sing songs.");
      }
      // CRD 8.11.1: Singer N counts as cost N
      let effectiveCost = sDef.cost;
      if (hasKeyword(s, sDef, "singer")) {
        effectiveCost = getKeywordValue(s, sDef, "singer");
      }
      // Atlantica Concert Hall: per-singer location bonus.
      if (s.atLocationInstanceId) {
        effectiveCost += stModifiers.singCostBonusHere.get(s.atLocationInstanceId) ?? 0;
      }
      // Naveen's Ukulele: per-singer timed sing_cost_bonus.
      effectiveCost += (s.timedEffects ?? [])
        .filter(t => t.type === "sing_cost_bonus")
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);
      // Record Player HIT PARADE: per-singer static sing_cost_bonus.
      effectiveCost += stModifiers.singCostBonusCharacters.get(sId) ?? 0;
      totalCost += effectiveCost;
    }
    if (totalCost < def.singTogetherCost) {
      return fail(`Sing Together cost not met: ${totalCost} < ${def.singTogetherCost}.`);
    }
    return OK;
  }

  // Granted free-play (Pudge, Belle, Scrooge): when the in-hand instance is
  // flagged in mods.playForFreeSelf the player has the OPTION to play it for
  // 0 ink. The action's viaGrantedFreePlay flag opts in; without it the normal
  // cost is paid (LeFou-style cost reductions still apply on top).
  const grantedFreePlayMods = getGameModifiers(state, definitions);
  if (viaGrantedFreePlay && !grantedFreePlayMods.playForFreeSelf.has(instanceId)) {
    return fail("This card cannot be played for free right now.");
  }
  // Validate playCosts are payable (Belle: banish item, Scrooge: exert 4
  // items). The specific cost target(s) are picked via the pendingChoice
  // surfaced by applyPlayCard; here we just confirm feasibility.
  if (viaGrantedFreePlay) {
    const playCosts = grantedFreePlayMods.playForFreeSelf.get(instanceId);
    if (playCosts) {
      for (const pc of playCosts) {
        if (pc.type === "banish_chosen") {
          const candidates = getZone(state, playerId, "play").filter((id) => {
            const inst = state.cards[id];
            const d = inst ? definitions[inst.definitionId] : undefined;
            return inst && d && matchesFilter(inst, d, pc.filter, state, playerId);
          });
          if (candidates.length === 0) return fail("No valid target to banish for the free play cost.");
        }
        if (pc.type === "exert_n_matching") {
          const candidates = getZone(state, playerId, "play").filter((id) => {
            const inst = state.cards[id];
            if (!inst || inst.isExerted) return false;
            const d = definitions[inst.definitionId];
            return d ? matchesFilter(inst, d, pc.filter, state, playerId) : false;
          });
          if (candidates.length < pc.count) return fail(`Need ${pc.count} ready matching cards to exert.`);
        }
        if (pc.type === "discard") {
          const hand = getZone(state, playerId, "hand").filter(id => id !== instanceId);
          if (hand.length < pc.amount) return fail("Not enough cards in hand to discard.");
        }
      }
    }
  }
  // Apply cost reductions (static + one-shot)
  const effectiveCost = viaGrantedFreePlay ? 0 : getEffectiveCostWithReductions(state, playerId, instanceId, definitions);
  if (!canAfford(state, playerId, effectiveCost)) { // CRD 1.5.3: cost must be paid in full
    // altPlayCost: DELETED — Belle now uses grant_play_for_free_self with playCosts.
    // The viaGrantedFreePlay path handles it above.
    return fail(`Not enough ink. Need ${effectiveCost}, have ${state.players[playerId].availableInk}.`);
  }

  // Play restrictions already checked above (before alternate cost paths).
  return OK;
}

/** Calculate effective cost after applying all cost reductions.
 *  Pass baseCost to override def.cost (e.g. for shift: use def.shiftCost). */
export function getEffectiveCostWithReductions(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>,
  baseCost?: number
): number {
  const def = getDefinition(state, instanceId, definitions);
  const instance = getInstance(state, instanceId);
  let cost = baseCost ?? def.cost;
  // True iff this call is computing the Shift cost path (validatePlayCard
  // passes baseCost === def.shiftCost). Used to gate shift_only reductions.
  const isShiftPath = baseCost !== undefined && baseCost === def.shiftCost;

  // Static cost reductions (e.g. Mickey: Broom chars cost 1 less)
  const modifiers = getGameModifiers(state, definitions);
  const staticReductions = modifiers.costReductions.get(playerId) ?? [];
  for (const red of staticReductions) {
    // appliesTo gating: shift_only reductions only apply when computing Shift cost.
    if (red.appliesTo === "shift_only" && !isShiftPath) continue;
    if (matchesFilter(instance, def, red.filter, state, playerId)) {
      cost -= red.amount;
    }
  }

  // One-shot cost reductions (e.g. Lantern: next character costs 1 less)
  const oneShot = state.players[playerId].costReductions ?? [];
  for (const red of oneShot) {
    if (matchesFilter(instance, def, red.filter, state, playerId)) {
      cost -= red.amount;
    }
  }

  // CRD 6.1.12: Self-cost-reduction from hand (e.g. LeFou: costs 1 less if Gaston in play)
  for (const ability of def.abilities) {
    if (ability.type !== "static") continue;
    const effsVal = Array.isArray(ability.effect) ? ability.effect : [ability.effect];
    const scrEffVal = effsVal.find((e: any) => e.type === "self_cost_reduction") as any;
    if (!scrEffVal) continue;
    // Check condition (e.g. "has_character_named Gaston")
    if (ability.condition) {
      if (!evaluateCondition(ability.condition, state, definitions, playerId, instanceId)) {
        continue;
      }
    }
    // Resolve amount — literal number OR count-based DynamicAmount
    // (per-count-cost-reduction: "For each X, pay 1 {I} less").
    const rawAmount = scrEffVal.amount;
    let discount = 0;
    if (typeof rawAmount === "number") {
      discount = rawAmount;
    } else if (typeof rawAmount === "object" && rawAmount !== null && (rawAmount as { type?: string }).type === "count") {
      const countAmt = rawAmount as { type: "count"; filter: import("../types/index.js").CardFilter; max?: number };
      let n = findMatchingInstances(state, definitions, countAmt.filter, playerId, instanceId).length;
      if (typeof countAmt.max === "number") n = Math.min(n, countAmt.max);
      discount = n * (scrEffVal.perMatch ?? 1);
    } else if (rawAmount === "opposing_chars_banished_in_challenge_this_turn") {
      const n = state.players[playerId].opposingCharsBanishedInChallengeThisTurn ?? 0;
      discount = n * (scrEffVal.perMatch ?? 1);
    }
    cost -= discount;
  }

  return Math.max(0, cost);
}

// CRD 4.2: Ink a Card — once per turn, inkable card from hand
// Belle - Strange but Special: "you may put an additional card" = extra ink plays
function validatePlayInk(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const inkPlaysThisTurn = state.players[playerId].inkPlaysThisTurn ?? 0;
  const modifiers = getGameModifiers(state, definitions);
  const extraPlays = modifiers.extraInkPlays.get(playerId) ?? 0;
  const grantedExtra = state.players[playerId].extraInkPlaysGranted ?? 0;
  const maxInkPlays = 1 + extraPlays + grantedExtra;

  if (inkPlaysThisTurn >= maxInkPlays) return fail("Already played ink this turn."); // CRD 4.2.3

  const instance = getInstance(state, instanceId);
  if (instance.ownerId !== playerId) return fail("You don't own this card.");
  if (instance.zone !== "hand") {
    // Moana Curious Explorer: also allow inking from discard.
    if (instance.zone === "discard" && modifiers.inkFromDiscard.has(playerId)) {
      // ok
    } else {
      return fail("Card is not in your hand.");
    }
  }

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

  const def = getDefinition(state, instanceId, definitions);
  if (def.cardType !== "character") return fail("Only characters can quest."); // CRD 5.3.4
  // CRD 8.7.2: Reckless characters can't quest
  if (hasKeyword(instance, def, "reckless")) return fail("Reckless characters can't quest.");
  // 0-lore characters CAN quest (they gain 0 lore normally but may have
  // triggered abilities like Mulan Resourceful Recruit's RIGOROUS TRAINING).

  // CRD 6.6.1: Unified check for quest restrictions (timed effects + statics like Gothel)
  const modifiers = getGameModifiers(state, definitions);
  // CRD 5.1.1.11 drying, with per-card bypass for Dash Parr RECORD TIME
  // (parallel to Rush's challenge bypass in CRD 8.9.1).
  if (instance.isDrying && !modifiers.canQuestTurnPlayed.has(instanceId)) {
    return fail("This character is still drying and cannot quest.");
  }
  if (isActionRestricted(instance, def, "quest", playerId, state, modifiers)) {
    return fail("This character can't quest.");
  }

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

  // CRD 6.6.1: Unified check for challenge restrictions (timed effects like Frying Pan + statics like Gantu)
  if (isActionRestricted(attacker, attackerDef, "challenge", playerId, state, modifiers)) {
    return fail("This character can't challenge.");
  }
  // Prince Charming Protector of the Realm: "each turn, only one character
  // can challenge". Global limit; check both players' per-turn flags.
  if (modifiers.oneChallengePerTurnGlobal) {
    const anyoneChallenged =
      !!state.players.player1.aCharacterChallengedThisTurn ||
      !!state.players.player2.aCharacterChallengedThisTurn;
    if (anyoneChallenged) {
      return fail("Only one character can challenge per turn while Prince Charming is in play.");
    }
  }

  const defenderDefEarly = getDefinition(state, defenderInstanceId, definitions);

  // CRD 4.6.4.2: defender must be exerted (unless modifier overrides)
  // CRD 4.6.8: locations are always valid challenge targets — they never exert
  const hasTimedChallengeReady = attacker.timedEffects.some(te => te.type === "can_challenge_ready");
  // canChallengeReady may carry an optional defender filter (Gizmoduck Suited
  // Up: only ready DAMAGED defenders). When the filter exists, the defender
  // must satisfy it for the override to apply.
  let canChallengeReadyHere = false;
  if (modifiers.canChallengeReady.has(attackerInstanceId)) {
    const filt = modifiers.canChallengeReady.get(attackerInstanceId);
    if (filt === null || filt === undefined) {
      canChallengeReadyHere = true;
    } else {
      canChallengeReadyHere = matchesFilter(defender, defenderDefEarly, filt, state, playerId);
    }
  }
  if (defenderDefEarly.cardType !== "location" && !defender.isExerted && !canChallengeReadyHere && !hasTimedChallengeReady) {
    return fail("Can only challenge exerted characters.");
  }

  if (modifiers.cantBeChallenged.has(defenderInstanceId)) {
    const attackerFilter = modifiers.cantBeChallenged.get(defenderInstanceId);
    if (!attackerFilter) {
      // No filter = no one can challenge this character
      return fail("This character cannot be challenged.");
    }
    // Filter present = only attackers matching the filter are blocked
    if (matchesFilter(attacker, attackerDef, attackerFilter, state, playerId)) {
      return fail("This character cannot be challenged by this attacker.");
    }
  }
  // Timed cant_be_challenged (Phase A.3 — "chosen character can't be challenged until ...")
  if (defender.timedEffects.some(te => te.type === "cant_be_challenged")) {
    return fail("This character cannot be challenged this turn.");
  }

  const defenderDef = defenderDefEarly;
  if (defenderDef.cardType !== "character" && defenderDef.cardType !== "location") {
    return fail("Can only challenge characters or locations."); // CRD 4.6.2 / 4.6.8
  }

  const opponentPlay = getZone(state, opponent, "play");

  // CRD 8.3.3: Bodyguard — exerted bodyguards must be challenged first
  const exertedBodyguards = opponentPlay.filter((id) => {
    if (id === defenderInstanceId) return false;
    const inst = getInstance(state, id);
    const def = definitions[inst.definitionId];
    if (!def) return false;
    return inst.isExerted && hasKeyword(inst, def, "bodyguard");
  });

  // Bodyguard only protects characters — locations bypass it (CRD 4.6.8)
  if (defenderDef.cardType === "character" && exertedBodyguards.length > 0 && !hasKeyword(defender, defenderDef, "bodyguard")) {
    return fail("Must challenge an exerted Bodyguard character first.");
  }

  // CRD 8.6.1: Evasive — can only be challenged by Evasive characters (locations don't have Evasive)
  if (defenderDef.cardType !== "character") {
    return OK;
  }
  const defHasEvasive = hasKeyword(defender, defenderDef, "evasive") ||
    (modifiers.grantedKeywords.get(defenderInstanceId)?.some(g => g.keyword === "evasive") ?? false);
  // CRD 10.x Alert: "This character can challenge as if they had Evasive."
  // Alert grants Evasive for attack-purposes only (it does NOT make the character evasive as a defender).
  const atkHasAlert = hasKeyword(attacker, attackerDef, "alert") ||
    (modifiers.grantedKeywords.get(attackerInstanceId)?.some(g => g.keyword === "alert") ?? false);
  const atkHasEvasive = hasKeyword(attacker, attackerDef, "evasive") ||
    (modifiers.grantedKeywords.get(attackerInstanceId)?.some(g => g.keyword === "evasive") ?? false) ||
    atkHasAlert;
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
  if (!ability || ability.type !== "activated") return fail("No activated ability at that index.");

  // CRD 6.1.13: "Once per turn" — block reactivation if already used this turn
  if (ability.oncePerTurn) {
    const key = ability.storyName ?? ability.rulesText ?? "anon";
    if (instance.oncePerTurnTriggered?.[key]) {
      return fail("This ability has already been used this turn.");
    }
  }

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

// CRD 4.7: Move a character to a location
function validateMoveCharacter(
  state: GameState,
  playerId: PlayerID,
  characterInstanceId: string,
  locationInstanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const char = getInstance(state, characterInstanceId);
  if (char.ownerId !== playerId) return fail("You don't own this character.");
  if (char.zone !== "play") return fail("Character is not in play.");
  const charDef = getDefinition(state, characterInstanceId, definitions);
  if (charDef.cardType !== "character") return fail("Only characters can move to locations.");
  // CRD 4.7: Moving only requires paying the location's move cost (ink).
  // No exerted/drying check — CRD 1.7.5 only restricts quest/challenge/{E}.
  // No per-turn limit — CRD 4.1.1 allows turn actions any number of times.

  // Self-restriction (Max Goof Rockin' Teen "I JUST WANNA STAY HOME") + any
  // future "can't move" timed/static effects.
  const moveRestrictModifiers = getGameModifiers(state, definitions);
  if (isActionRestricted(char, charDef, "move", playerId, state, moveRestrictModifiers)) {
    return fail("This character can't move to locations.");
  }

  const loc = getInstance(state, locationInstanceId);
  if (loc.ownerId !== playerId) return fail("You don't own this location.");
  if (loc.zone !== "play") return fail("Location is not in play.");
  const locDef = getDefinition(state, locationInstanceId, definitions);
  if (locDef.cardType !== "location") return fail("Target is not a location.");

  if (char.atLocationInstanceId === locationInstanceId) {
    return fail("Character is already at this location.");
  }

  const baseCost = locDef.moveCost ?? 0;
  // CRD: a static effect on the destination may reduce or zero out the move cost
  // for matching characters (Jolly Roger - Hook's Ship: "Your Pirate characters
  // may move here for free.").
  const moveModifiers = getGameModifiers(state, definitions);
  const effectiveCost = applyMoveCostReduction(baseCost, char, charDef, locationInstanceId, moveModifiers, state, playerId);
  if (!canAfford(state, playerId, effectiveCost)) {
    return fail(`Not enough ink to move. Need ${effectiveCost}.`);
  }

  return OK;
}

/** Compute the effective move cost after move-cost reductions:
 *  - Location-keyed: Jolly Roger Hook's Ship "Your Pirate characters may move here for free"
 *  - Global: Map of Treasure Planet "You pay 1 {I} less to move your characters to a location"
 *  - Self-only oncePerTurn: Raksha Fearless Mother "Once during your turn, you may
 *    pay 1 {I} less to move this character to a location"
 *
 *  Returns `{ cost, consumedOncePerTurn }` so the reducer can mark the once-per-turn
 *  flag on the source after the move actually pays. (This is feasibility — actual
 *  consumption is deferred to applyMoveCharacter.) */
export function applyMoveCostReduction(
  baseCost: number,
  charInstance: import("../types/index.js").CardInstance,
  charDef: CardDefinition,
  locationInstanceId: string,
  modifiers: {
    moveToSelfCostReductions: Map<string, { amount: number | "all"; filter: import("../types/index.js").CardFilter }[]>;
    globalMoveCostReduction: {
      amount: number;
      playerId: PlayerID;
      filter?: import("../types/index.js").CardFilter;
      selfOnly?: boolean;
      sourceInstanceId?: string;
      oncePerTurnKey?: string;
    }[];
  },
  state: GameState,
  viewingPlayerId: PlayerID
): number {
  let cost = baseCost;
  // Location-keyed reductions (Jolly Roger Hook's Ship)
  const locEntries = modifiers.moveToSelfCostReductions.get(locationInstanceId);
  if (locEntries) {
    for (const entry of locEntries) {
      if (!matchesFilter(charInstance, charDef, entry.filter, state, viewingPlayerId)) continue;
      if (entry.amount === "all") return 0;
      cost = Math.max(0, cost - entry.amount);
    }
  }
  // Global / self-only reductions (Map of Treasure Planet, Raksha Fearless Mother)
  for (const entry of modifiers.globalMoveCostReduction) {
    if (entry.playerId !== charInstance.ownerId) continue;
    if (entry.filter && !matchesFilter(charInstance, charDef, entry.filter, state, viewingPlayerId)) continue;
    if (entry.selfOnly && entry.sourceInstanceId !== charInstance.instanceId) continue;
    if (entry.oncePerTurnKey && entry.sourceInstanceId) {
      const src = state.cards[entry.sourceInstanceId];
      if (src?.oncePerTurnTriggered?.[entry.oncePerTurnKey]) continue;
    }
    cost = Math.max(0, cost - entry.amount);
  }
  return cost;
}

// CRD 8.4: Boost N {I} — once per turn, pay N {I} to put the top card of your
// deck facedown under this character.
function validateBoostCard(
  state: GameState,
  playerId: PlayerID,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!isMainPhase(state, playerId)) return fail("Not your main phase.");

  const inst = getInstance(state, instanceId);
  if (inst.ownerId !== playerId) return fail("You don't own this card.");
  if (inst.zone !== "play") return fail("Card is not in play.");
  const def = getDefinition(state, instanceId, definitions);
  if (!hasKeyword(inst, def, "boost")) return fail("This card doesn't have Boost.");
  if (inst.boostedThisTurn) return fail("This card has already boosted this turn.");
  // Boost cost is the keyword value (Boost N {I})
  const cost = getKeywordValue(inst, def, "boost");
  if (cost <= 0) return fail("This card's Boost has no cost.");
  if (!canAfford(state, playerId, cost)) {
    return fail(`Not enough ink to Boost. Need ${cost}.`);
  }
  // CRD 8.4.1: deck must have at least one card to put under
  const deck = getZone(state, playerId, "deck");
  if (deck.length === 0) return fail("Your deck is empty.");

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

  // Per-character timed obligation: must_quest_if_able. Used by Ariel
  // Curious Traveler / Gaston Frightful Bully / Rapunzel Ethereal Protector.
  // Mirrors the Reckless check above but instance-scoped via TimedEffect.
  for (const id of myPlay) {
    const inst = getInstance(state, id);
    if (inst.isExerted) continue;
    const def = definitions[inst.definitionId];
    if (!def || def.cardType !== "character") continue;
    const obligated = (inst.timedEffects ?? []).some((te) => te.type === "must_quest_if_able");
    if (!obligated) continue;
    const questResult = validateQuest(state, playerId, id, definitions);
    if (questResult.valid) {
      return fail(`${def.fullName} must quest if able before passing.`);
    }
  }

  return OK;
}

function validateResolveChoice(
  state: GameState,
  playerId: PlayerID,
  choice: string | string[] | number,
  definitions: Record<string, CardDefinition>
): ValidationResult {
  if (!state.pendingChoice) return fail("No pending choice to resolve.");
  if (state.pendingChoice.choosingPlayerId !== playerId) {
    return fail("It's not your choice to make.");
  }

  // CRD 2.2.2: Mulligan — array of card IDs to put back (empty = keep all)
  if (state.pendingChoice.type === "choose_mulligan") {
    if (!Array.isArray(choice)) return fail("Mulligan choice must be an array of card IDs.");
    const handIds = state.pendingChoice.validTargets ?? [];
    for (const id of choice as string[]) {
      if (!handIds.includes(id)) return fail("Chosen card is not in your hand.");
    }
    return OK;
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
    // "Any number" variant: allow 0..maxCount discards (Geppetto, Desperate Plan).
    if (state.pendingChoice.maxCount !== undefined) {
      if (choice.length > state.pendingChoice.maxCount) {
        return fail(`Cannot discard more than ${state.pendingChoice.maxCount} card(s).`);
      }
    } else {
      const count = state.pendingChoice.count ?? 1;
      if (choice.length !== count) {
        return fail(`Must choose exactly ${count} card(s) to discard.`);
      }
    }
    for (const id of choice) {
      if (!state.pendingChoice.validTargets?.includes(id)) {
        return fail("Invalid card chosen for discard.");
      }
    }
    return OK;
  }

  // choose_order: player reorders cards for deck placement — must include all validTargets exactly once
  if (state.pendingChoice.type === "choose_order" && Array.isArray(choice)) {
    const required = state.pendingChoice.validTargets ?? [];
    const chosen = choice as string[];
    if (chosen.length !== required.length) {
      return fail(`Must order exactly ${required.length} card(s).`);
    }
    const requiredSet = new Set(required);
    for (const id of chosen) {
      if (!requiredSet.has(id)) return fail("Invalid card in ordering.");
    }
    return OK;
  }

  // CRD 8.15.1: Ward — opponents can't choose this character for their effects
  if (state.pendingChoice.type === "choose_target" && Array.isArray(choice)) {
    // Granted-free-play alt-cost chooser requires EXACTLY the specified count
    // (Belle: 1 item to banish; Scrooge: 4 items to exert). Alt-shift chooser
    // (Diablo: 1 discard; Flotsam: 2 discards) same rule. Check before the
    // up-to-N rule below.
    const freePlayCont = state.pendingChoice._freePlayContinuation;
    const altShiftCont = state.pendingChoice._altShiftCostContinuation;
    if (freePlayCont) {
      if (choice.length !== freePlayCont.exactCount) {
        return fail(`Must choose exactly ${freePlayCont.exactCount} ${freePlayCont.costType === "banish_chosen" ? "item to banish" : freePlayCont.costType === "exert_n_matching" ? "item(s) to exert" : "card(s) to discard"}.`);
      }
    } else if (altShiftCont) {
      if (choice.length !== altShiftCont.exactCount) {
        return fail(`Must choose exactly ${altShiftCont.exactCount} ${altShiftCont.costType === "discard" ? "card(s) to discard" : "card(s) to banish"} to Shift.`);
      }
    } else {
      // CRD 6.1.3: "up to N" — validate count
      const maxCount = state.pendingChoice.count ?? 1;
      if (choice.length > maxCount) {
        return fail(`Must choose at most ${maxCount} target(s).`);
      }
      // Empty choice is allowed if optional, or if there are no valid targets
      const hasValidTargets = (state.pendingChoice.validTargets?.length ?? 0) > 0;
      if (!state.pendingChoice.optional && hasValidTargets && choice.length === 0) {
        return fail("Must choose at least one target.");
      }
    }

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
