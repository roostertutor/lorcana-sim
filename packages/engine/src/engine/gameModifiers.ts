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
   * Characters that cannot be challenged this turn.
   * Populated by cards with CantBeChallengedException static effect.
   */
  cantBeChallenged: Set<string>;

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

  /** Characters that can't exert to sing songs (Ariel - On Human Legs). */
  cantSing: Set<string>;

  /** Keywords granted by conditional static abilities (e.g. Pascal gains Evasive). */
  grantedKeywords: Map<string, import("../types/index.js").Keyword[]>;
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
    cantBeChallenged: new Set(),
    canChallengeReady: new Set(),
    statBonuses: new Map(),
    cantSing: new Set(),
    grantedKeywords: new Map(),
  };

  for (const instance of Object.values(state.cards)) {
    if (instance.zone !== "play") continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;

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
            modifiers.cantBeChallenged.add(instance.instanceId);
          } else if (target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, target.filter, state, instance.ownerId)) {
                modifiers.cantBeChallenged.add(candidate.instanceId);
              }
            }
          }
          break;
        }

        case "modify_stat_per_count": {
          // Count matching cards, multiply by perCount, apply to target
          const count = countMatchingCards(state, definitions, effect.countFilter, instance.ownerId, instance.instanceId);
          const bonus = count * effect.perCount;
          if (bonus === 0) break;

          if (effect.target.type === "this") {
            addStatBonus(modifiers, instance.instanceId, effect.stat, bonus);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId)) {
                addStatBonus(modifiers, candidate.instanceId, effect.stat, bonus);
              }
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
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId)) {
                addStatBonus(modifiers, candidate.instanceId, effect.stat, effect.modifier);
              }
            }
          }
          break;
        }

        case "cant_sing": {
          if (effect.target.type === "this") {
            modifiers.cantSing.add(instance.instanceId);
          }
          break;
        }

        case "grant_keyword": {
          // Conditional static keyword granting (e.g. Pascal gains Evasive while condition met)
          if (effect.target.type === "this") {
            const existing = modifiers.grantedKeywords.get(instance.instanceId) ?? [];
            existing.push(effect.keyword);
            modifiers.grantedKeywords.set(instance.instanceId, existing);
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
