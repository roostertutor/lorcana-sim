// =============================================================================
// GAME MODIFIERS
// Scans in-play StaticAbility cards and returns a snapshot of active rule
// modifications. Validators call getGameModifiers() instead of hardcoding
// rules, so future cards can override base game rules without changing
// validator logic.
//
// Pattern: add a new modifier slot here when a new StaticEffect type is added
// to types/index.ts. The validator then consults the modifier rather than
// hardcoding the rule.
// =============================================================================

import type { CardDefinition, GameState, PlayerID } from "../types/index.js";
import { evaluateCondition, getZone, matchesFilter } from "../utils/index.js";

export interface GameModifiers {
  /**
   * Characters that cannot be challenged (or only by certain attackers).
   * Key = instanceId, value = optional attacker filter (undefined = no one can challenge).
   */
  cantBeChallenged: Map<string, import("../types/index.js").CardFilter | undefined>;

  /**
   * Characters that may challenge ready (non-exerted) opponents.
   * Default rule: only exerted characters may be challenged.
   */
  canChallengeReady: Set<string>;

  /**
   * Per-instance stat bonuses from static abilities (e.g. per-count bonuses).
   * Key = instanceId, value = { strength, willpower, lore } deltas.
   */
  statBonuses: Map<string, { strength: number; willpower: number; lore: number }>;

  /** Keywords granted by conditional static abilities (e.g. Pascal gains Evasive, Cogsworth grants Resist +1). */
  grantedKeywords: Map<string, { keyword: import("../types/index.js").Keyword; value?: number }[]>;

  /** Static cost reductions (e.g. Mickey: Broom chars cost 1 less). Key = playerId. */
  costReductions: Map<import("../types/index.js").PlayerID, { amount: number; filter: import("../types/index.js").CardFilter }[]>;

  /** Action restrictions (quest/challenge/play/sing/ready) from static abilities. */
  actionRestrictions: {
    restricts: import("../types/index.js").RestrictedAction;
    /** The player whose characters are restricted */
    affectedPlayerId: import("../types/index.js").PlayerID;
    /** Only characters matching this filter are restricted (undefined = all) */
    filter?: import("../types/index.js").CardFilter;
  }[];

  /** Extra ink plays allowed per turn per player. */
  extraInkPlays: Map<import("../types/index.js").PlayerID, number>;

  /**
   * CRD 6.5: Damage redirect — key = protector instanceId,
   * value = the owner whose other characters are protected.
   */
  damageRedirects: Map<string, import("../types/index.js").PlayerID>;

  /**
   * Characters with challenge damage immunity (Raya - Leader of Heart).
   * Key = instanceId, value = optional filter the defender must match (undefined = always immune).
   */
  challengeDamageImmunity: Map<string, import("../types/index.js").CardFilter | undefined>;

  /**
   * Ongoing damage immunity from static abilities (Baloo Ol' Iron Paws —
   * source "all"; Hercules Mighty Leader — source "non_challenge"). Key =
   * instanceId of the card that IS immune. Value = set of damage sources
   * against which the card is protected. Consulted by the reducer's damage
   * write path (dealDamageToCard for ability damage, applyChallenge for
   * challenge damage).
   */
  damageImmunity: Map<string, Set<"challenge" | "all" | "non_challenge">>;

  /**
   * Activated abilities granted by static effects (Cogsworth - Talking Clock).
   * Key = instanceId, value = list of granted activated abilities.
   */
  grantedActivatedAbilities: Map<string, import("../types/index.js").ActivatedAbility[]>;

  /**
   * Permanent self-restrictions from static `cant_action_self` effects (Maui - Whale).
   * Key = instanceId, value = set of actions that instance cannot perform.
   */
  selfActionRestrictions: Map<string, Set<import("../types/index.js").RestrictedAction>>;

  /**
   * MIMICRY targets (Morph - Space Goo): in-play instances that any shifter may
   * shift onto regardless of name.
   */
  mimicryTargets: Set<string>;

  /**
   * Universal shifters (Baymax Set 7+): in-hand instances whose Shift may target
   * any character of yours regardless of name.
   */
  universalShifters: Set<string>;

  /**
   * Classification shifters (Thunderbolt Set 8 — "Puppy Shift"): in-hand instances
   * whose Shift may target any character of yours that has the named trait.
   * Key = instanceId, value = required trait.
   */
  classificationShifters: Map<string, string>;

  /**
   * "You may play this card from {zone}" (Lilo - Escape Artist Set 6 — discard).
   * Key = instanceId, value = set of zones the card can be played from in addition to hand.
   */
  playableFromZones: Map<string, Set<import("../types/index.js").ZoneName>>;

  /**
   * Per-player lore threshold overrides (CRD 1.8.1.1, Donald Duck Flustered Sorcerer).
   * Key = playerId, value = the modified threshold (e.g. 25). Absent = default 20.
   * If multiple statics target the same player, the highest value wins (most restrictive).
   */
  loreThresholds: Map<import("../types/index.js").PlayerID, number>;

  /**
   * Players who skip their turn's draw step (Arthur Determined Squire Set 8).
   */
  skipsDrawStep: Set<import("../types/index.js").PlayerID>;

  /**
   * Players whose deck-top card is visible to all players (Merlin's Cottage Set 5).
   * Pure information-visibility modifier — engine state doesn't change.
   * The UI consults this to render the deck top face-up.
   */
  topOfDeckVisible: Set<import("../types/index.js").PlayerID>;

  /**
   * Per-location move cost reductions (Jolly Roger - Hook's Ship: "Your Pirate
   * characters may move here for free"). Key = location instanceId, value =
   * list of { amount, filter } entries. validateMoveCharacter / applyMoveCharacter
   * consult this when computing the effective move cost to that location.
   */
  moveToSelfCostReductions: Map<string, { amount: number | "all"; filter: import("../types/index.js").CardFilter }[]>;

  /**
   * Per-player "force enter exerted" filters from EnterPlayExertedStatic.
   * Key = affected player (the player whose newly-played cards are forced
   * exerted). Value = list of filters; if any matches the played card, it
   * enters exerted. The filter's owner field is already resolved against the
   * source's perspective when populating this map.
   */
  enterPlayExerted: Map<import("../types/index.js").PlayerID, import("../types/index.js").CardFilter[]>;
}

/**
 * Computes all active game rule modifications by scanning in-play static abilities.
 * Call at the start of each validation or legal action check.
 * Pure function: same state + definitions always produces the same result.
 */
export function getGameModifiers(
  state: GameState,
  definitions: Record<string, CardDefinition>
): GameModifiers {
  const modifiers: GameModifiers = {
    cantBeChallenged: new Map(),
    canChallengeReady: new Set(),
    statBonuses: new Map(),
    grantedKeywords: new Map(),
    costReductions: new Map(),
    actionRestrictions: [],
    extraInkPlays: new Map(),
    damageRedirects: new Map(),
    challengeDamageImmunity: new Map(),
    damageImmunity: new Map(),
    grantedActivatedAbilities: new Map(),
    selfActionRestrictions: new Map(),
    mimicryTargets: new Set(),
    universalShifters: new Set(),
    classificationShifters: new Map(),
    playableFromZones: new Map(),
    loreThresholds: new Map(),
    skipsDrawStep: new Set(),
    topOfDeckVisible: new Set(),
    moveToSelfCostReductions: new Map(),
    enterPlayExerted: new Map(),
  };

  for (const instance of Object.values(state.cards)) {
    const def = definitions[instance.definitionId];
    if (!def) continue;

    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      // CRD 6.3-ish: an ability functions only in play unless it says otherwise.
      // activeZones declares where this static is active; default is ["play"].
      const activeZones = ability.activeZones ?? ["play"];
      if (!activeZones.includes(instance.zone)) continue;

      // Check condition on static ability (e.g. "while you have a Captain in play")
      if (ability.condition) {
        if (!evaluateCondition(ability.condition, state, definitions, instance.ownerId, instance.instanceId)) {
          continue;
        }
      }

      const { effect } = ability;
      switch (effect.type) {
        case "cant_be_challenged": {
          const { target } = effect;
          if (target.type === "this") {
            modifiers.cantBeChallenged.set(instance.instanceId, effect.attackerFilter);
          } else if (target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, target.filter, state, instance.ownerId, instance.instanceId)) {
                modifiers.cantBeChallenged.set(candidate.instanceId, effect.attackerFilter);
              }
            }
          }
          break;
        }

        case "modify_stat_per_count": {
          // Count matching cards, multiply by perCount, apply to target.
          // Boost (CRD 8.4.2): countCardsUnderSelf bypasses the filter and uses cardsUnder.length.
          const count = effect.countCardsUnderSelf
            ? instance.cardsUnder.length
            : (effect.countFilter
              ? countMatchingCards(state, definitions, effect.countFilter, instance.ownerId, instance.instanceId)
              : 0);
          const bonus = count * effect.perCount;
          if (bonus === 0) break;

          if (effect.target.type === "this") {
            addStatBonus(modifiers, instance.instanceId, effect.stat, bonus);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                addStatBonus(modifiers, candidate.instanceId, effect.stat, bonus);
              }
            }
          }
          break;
        }

        case "modify_stat_per_damage": {
          // Donald Duck - Not Again!: +N stat per damage on this card
          if (effect.target.type === "this") {
            const bonus = instance.damage * effect.perDamage;
            if (bonus > 0) {
              addStatBonus(modifiers, instance.instanceId, effect.stat, bonus);
            }
          }
          break;
        }

        case "modify_stat": {
          if (effect.target.type === "this") {
            addStatBonus(modifiers, instance.instanceId, effect.stat, effect.modifier);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              if (effect.target.filter.excludeSelf && candidate.instanceId === instance.instanceId) continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                addStatBonus(modifiers, candidate.instanceId, effect.stat, effect.modifier);
              }
            }
          }
          break;
        }


        case "grant_keyword": {
          // Conditional static keyword granting (e.g. Pascal gains Evasive, Cogsworth grants Resist +1)
          if (effect.target.type === "this") {
            const existing = modifiers.grantedKeywords.get(instance.instanceId) ?? [];
            existing.push({ keyword: effect.keyword, value: effect.value });
            modifiers.grantedKeywords.set(instance.instanceId, existing);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              if (effect.target.filter.excludeSelf && candidate.instanceId === instance.instanceId) continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                const existing = modifiers.grantedKeywords.get(candidate.instanceId) ?? [];
                existing.push({ keyword: effect.keyword, value: effect.value });
                modifiers.grantedKeywords.set(candidate.instanceId, existing);
              }
            }
          }
          break;
        }

        case "cost_reduction": {
          const existing = modifiers.costReductions.get(instance.ownerId) ?? [];
          existing.push({ amount: effect.amount, filter: effect.filter });
          modifiers.costReductions.set(instance.ownerId, existing);
          break;
        }

        case "action_restriction": {
          const affectedPlayerId = effect.affectedPlayer.type === "opponent"
            ? (instance.ownerId === "player1" ? "player2" : "player1")
            : instance.ownerId;
          const entry: typeof modifiers.actionRestrictions[number] = {
            restricts: effect.restricts,
            affectedPlayerId,
          };
          if (effect.filter) entry.filter = effect.filter;
          modifiers.actionRestrictions.push(entry);
          break;
        }

        case "extra_ink_play": {
          const current = modifiers.extraInkPlays.get(instance.ownerId) ?? 0;
          modifiers.extraInkPlays.set(instance.ownerId, current + effect.amount);
          break;
        }

        case "can_challenge_ready": {
          if (effect.target.type === "this") {
            modifiers.canChallengeReady.add(instance.instanceId);
          }
          break;
        }

        case "mimicry_target_self": {
          // Morph - Space Goo: any shifter may target this instance regardless of name.
          modifiers.mimicryTargets.add(instance.instanceId);
          break;
        }

        case "universal_shift_self": {
          // Baymax (Set 7+): this in-hand shifter ignores name match on its target.
          modifiers.universalShifters.add(instance.instanceId);
          break;
        }

        case "classification_shift_self": {
          // Thunderbolt (Set 8): this in-hand shifter requires the target to have `trait`.
          modifiers.classificationShifters.set(instance.instanceId, effect.trait);
          break;
        }

        case "skip_draw_step_self": {
          // Arthur Determined Squire (Set 8): owner skips their draw step.
          modifiers.skipsDrawStep.add(instance.ownerId);
          break;
        }

        case "move_to_self_cost_reduction": {
          // Jolly Roger - Hook's Ship: "Your Pirate characters may move here for free."
          // Keyed on the location instance — the validator looks up the destination's id.
          let entries = modifiers.moveToSelfCostReductions.get(instance.instanceId);
          if (!entries) {
            entries = [];
            modifiers.moveToSelfCostReductions.set(instance.instanceId, entries);
          }
          entries.push({ amount: effect.amount, filter: effect.filter });
          break;
        }

        case "top_of_deck_visible": {
          // Merlin's Cottage (Set 5): each player plays with the top card of
          // their deck face up. Pure visibility flag — UI consults the modifier.
          if (effect.affectedPlayer.type === "both") {
            modifiers.topOfDeckVisible.add("player1");
            modifiers.topOfDeckVisible.add("player2");
          } else if (effect.affectedPlayer.type === "self") {
            modifiers.topOfDeckVisible.add(instance.ownerId);
          } else if (effect.affectedPlayer.type === "opponent") {
            modifiers.topOfDeckVisible.add(instance.ownerId === "player1" ? "player2" : "player1");
          }
          break;
        }

        case "modify_win_threshold": {
          // Donald Duck Flustered Sorcerer (Set 7): "Opponents need 25 lore to win."
          const affectedPlayerId = effect.affectedPlayer.type === "opponent"
            ? (instance.ownerId === "player1" ? "player2" : "player1")
            : instance.ownerId;
          const current = modifiers.loreThresholds.get(affectedPlayerId);
          if (current === undefined || effect.newThreshold > current) {
            modifiers.loreThresholds.set(affectedPlayerId, effect.newThreshold);
          }
          break;
        }

        case "playable_from_zone_self": {
          // Lilo - Escape Artist (Set 6): this card may be played from `effect.zone`.
          let zones = modifiers.playableFromZones.get(instance.instanceId);
          if (!zones) {
            zones = new Set();
            modifiers.playableFromZones.set(instance.instanceId, zones);
          }
          zones.add(effect.zone);
          break;
        }

        case "cant_action_self": {
          // Maui - Whale: "This character can't ready at the start of your turn."
          // Permanent self-restriction tied to this instance.
          let set = modifiers.selfActionRestrictions.get(instance.instanceId);
          if (!set) {
            set = new Set();
            modifiers.selfActionRestrictions.set(instance.instanceId, set);
          }
          set.add(effect.action);
          break;
        }

        case "damage_redirect": {
          // CRD 6.5: This character absorbs damage for other own characters
          modifiers.damageRedirects.set(instance.instanceId, instance.ownerId);
          break;
        }

        case "challenge_damage_immunity": {
          // Raya - Leader of Heart: immune to challenge damage vs damaged characters
          modifiers.challengeDamageImmunity.set(instance.instanceId, effect.targetFilter);
          break;
        }

        case "damage_immunity_static": {
          // Baloo Ol' Iron Paws ("your characters with 7 {S} or more can't be
          // dealt damage" — source "all"), Hercules Mighty Leader ("can't be
          // dealt damage unless he's being challenged" — source "non_challenge").
          const addImmunity = (id: string) => {
            let set = modifiers.damageImmunity.get(id);
            if (!set) {
              set = new Set();
              modifiers.damageImmunity.set(id, set);
            }
            set.add(effect.source);
          };
          if (effect.target.type === "this") {
            addImmunity(instance.instanceId);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                addImmunity(candidate.instanceId);
              }
            }
          }
          break;
        }

        case "enter_play_exerted": {
          // Filter is interpreted from the source's perspective. We resolve
          // owner.type === "opponent" → the source's opponent, owner.type ===
          // "self" → the source's owner. Then we key the modifier by the
          // affected player.
          const ownerType = effect.filter.owner?.type;
          const affectedPlayerId: PlayerID = ownerType === "opponent"
            ? (instance.ownerId === "player1" ? "player2" : "player1")
            : instance.ownerId;
          let arr = modifiers.enterPlayExerted.get(affectedPlayerId);
          if (!arr) {
            arr = [];
            modifiers.enterPlayExerted.set(affectedPlayerId, arr);
          }
          arr.push(effect.filter);
          break;
        }

        case "grant_activated_ability": {
          // Cogsworth - Talking Clock: grant activated ability to matching characters
          if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                const existing = modifiers.grantedActivatedAbilities.get(candidate.instanceId) ?? [];
                existing.push(effect.ability);
                modifiers.grantedActivatedAbilities.set(candidate.instanceId, existing);
              }
            }
          }
          break;
        }
      }
    }
  }

  return modifiers;
}

function addStatBonus(
  modifiers: GameModifiers,
  instanceId: string,
  stat: "strength" | "willpower" | "lore",
  amount: number
): void {
  const existing = modifiers.statBonuses.get(instanceId) ?? { strength: 0, willpower: 0, lore: 0 };
  existing[stat] += amount;
  modifiers.statBonuses.set(instanceId, existing);
}

/**
 * Count cards matching a filter. Used by modify_stat_per_count.
 * The countFilter's zone field determines where to look (hand, play, discard, etc.)
 */
function countMatchingCards(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  filter: import("../types/index.js").CardFilter,
  viewingPlayerId: PlayerID,
  sourceInstanceId: string
): number {
  // Determine which zones to search
  const zones = filter.zone
    ? (Array.isArray(filter.zone) ? filter.zone : [filter.zone])
    : ["play" as const]; // default to play if not specified

  let count = 0;
  const opponent = viewingPlayerId === "player1" ? "player2" : "player1";

  for (const zone of zones) {
    // Determine which player's zone to search
    const ownerFilter = filter.owner;
    const players: PlayerID[] = [];
    if (!ownerFilter || ownerFilter.type === "both") {
      players.push("player1", "player2");
    } else if (ownerFilter.type === "self") {
      players.push(viewingPlayerId);
    } else if (ownerFilter.type === "opponent") {
      players.push(opponent);
    }

    for (const playerId of players) {
      const zoneCards = getZone(state, playerId, zone);
      for (const id of zoneCards) {
        // Don't count the source card itself for "other" patterns
        if (filter.excludeInstanceId && id === filter.excludeInstanceId) continue;
        if (filter.excludeSelf && id === sourceInstanceId) continue;
        const inst = state.cards[id];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (!def) continue;
        if (matchesFilter(inst, def, filter, state, viewingPlayerId)) {
          count++;
        }
      }
    }
  }

  return count;
}
