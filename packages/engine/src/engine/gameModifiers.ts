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

import type { CardDefinition, GameState } from "../types/index.js";
import { matchesFilter } from "../utils/index.js";

export interface GameModifiers {
  /**
   * Characters that cannot be challenged this turn.
   * Populated by cards with CantBeChallengedException static effect.
   */
  cantBeChallenged: Set<string>;

  /**
   * Characters that may challenge ready (non-exerted) opponents.
   * Default rule: only exerted characters may be challenged.
   * Future: when a card grants "this character may challenge ready characters",
   * add its instanceId here. (Requires a new StaticEffect type in types/index.ts.)
   */
  canChallengeReady: Set<string>;

  // Future modifier slots — add here as new static effect types are introduced:
  //
  // extraInkPerTurn: Record<PlayerID, number>
  //   → Belle - Strange but Special grants +1 ink/turn
  //   → Requires hasPlayedInkThisTurn to become a counter in PlayerState (types change)
  //
  // canBypassInkable: Set<string>
  //   → Fishbone Quill: puts cards from hand into inkwell bypassing the inkable restriction
  //   → Requires a new StaticEffect type (types change)
  //
  // canSingUpToLevel: Map<string, number>
  //   → Singer keyword: instanceId → max song cost this character can exert to sing
  //   → Already representable via KeywordAbility singer + value, but Singer validation
  //     is not yet implemented
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
  };

  for (const instance of Object.values(state.cards)) {
    if (instance.zone !== "play") continue;
    const def = definitions[instance.definitionId];
    if (!def) continue;

    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;

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
        // Future: "can_challenge_ready" static effect type
        // case "can_challenge_ready":
        //   modifiers.canChallengeReady.add(instance.instanceId);
        //   break;
      }
    }
  }

  return modifiers;
}
