// =============================================================================
// ENGINE UTILITIES
// Pure functions with no side effects. Safe to use anywhere.
// =============================================================================

import type {
  CardDefinition,
  CardFilter,
  CardInstance,
  Condition,
  GameState,
  Keyword,
  PlayerID,
  RestrictedAction,
  ZoneName,
} from "../types/index.js";

// -----------------------------------------------------------------------------
// CARD INSTANCE QUERIES
// -----------------------------------------------------------------------------

/** Get a card instance by ID, throws if not found (use when you know it exists) */
export function getInstance(state: GameState, instanceId: string): CardInstance {
  const instance = state.cards[instanceId];
  if (!instance) throw new Error(`Card instance not found: ${instanceId}`);
  return instance;
}

/** Get the static definition for an instance */
export function getDefinition(
  state: GameState,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): CardDefinition {
  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];
  if (!def) throw new Error(`Card definition not found: ${instance.definitionId}`);
  return def;
}

/** Get all instance IDs for a player in a specific zone */
export function getZone(state: GameState, playerId: PlayerID, zone: ZoneName): string[] {
  return state.zones[playerId]?.[zone] ?? [];
}

/** Get all instances in a zone as full objects */
export function getZoneInstances(
  state: GameState,
  playerId: PlayerID,
  zone: ZoneName
): CardInstance[] {
  return getZone(state, playerId, zone).map((id) => getInstance(state, id));
}

/** Get the top card of a player's deck */
export function getTopOfDeck(state: GameState, playerId: PlayerID): CardInstance | null {
  const deck = getZone(state, playerId, "deck");
  const topId = deck[0];
  return topId ? getInstance(state, topId) : null;
}

// -----------------------------------------------------------------------------
// STAT RESOLUTION
// Computes effective stats by applying all modifiers.
// Always use these instead of reading raw definition stats.
// -----------------------------------------------------------------------------

export function getEffectiveStrength(
  instance: CardInstance,
  definition: CardDefinition,
  staticBonus = 0
): number {
  const base = definition.strength ?? 0;
  const timedBonus = instance.timedEffects
    .filter((te) => te.type === "modify_strength")
    .reduce((sum, te) => sum + (te.amount ?? 0), 0);
  return Math.max(0, base + instance.tempStrengthModifier + timedBonus + staticBonus);
}

export function getEffectiveWillpower(
  instance: CardInstance,
  definition: CardDefinition,
  staticBonus = 0
): number {
  const base = definition.willpower ?? 0;
  const timedBonus = instance.timedEffects
    .filter((te) => te.type === "modify_willpower")
    .reduce((sum, te) => sum + (te.amount ?? 0), 0);
  return Math.max(0, base + instance.tempWillpowerModifier + timedBonus + staticBonus);
}

export function getEffectiveLore(
  instance: CardInstance,
  definition: CardDefinition,
  staticBonus = 0
): number {
  const base = definition.lore ?? 0;
  const timedBonus = instance.timedEffects
    .filter((te) => te.type === "modify_lore")
    .reduce((sum, te) => sum + (te.amount ?? 0), 0);
  return Math.max(0, base + instance.tempLoreModifier + timedBonus + staticBonus);
}

/** Check if a card has a "can't X" timed effect active */
export function hasCantAction(instance: CardInstance, action: "quest" | "challenge" | "ready"): boolean {
  return instance.timedEffects.some((te) => te.type === "cant_action" && te.action === action);
}

// Convenience wrappers for backward compat with validator/reducer calls
export function hasCantQuest(instance: CardInstance): boolean { return hasCantAction(instance, "quest"); }
export function hasCantReady(instance: CardInstance): boolean { return hasCantAction(instance, "ready"); }
export function hasCantChallenge(instance: CardInstance): boolean { return hasCantAction(instance, "challenge"); }

/**
 * CRD 6.6.1: Unified query for whether an action is restricted on a card.
 * Checks both timed effects (per-card debuffs) and static game modifiers
 * (board-level rules from in-play cards).
 * Takes GameModifiers as param to avoid circular imports (utils can't import engine).
 */
export function isActionRestricted(
  instance: CardInstance,
  definition: CardDefinition,
  action: RestrictedAction,
  playerId: PlayerID,
  state: GameState,
  modifiers: { actionRestrictions: { restricts: string; affectedPlayerId: PlayerID; filter?: CardFilter }[] }
): boolean {
  // Source 1: timed effects on the card
  if (instance.timedEffects.some(te => te.type === "cant_action" && te.action === action)) {
    return true;
  }
  // Source 2: static restrictions from gameModifiers
  for (const r of modifiers.actionRestrictions) {
    if (r.restricts !== action || r.affectedPlayerId !== playerId) continue;
    if (!r.filter || matchesFilter(instance, definition, r.filter, state, playerId)) {
      return true;
    }
  }
  return false;
}

/** Get the effective ink cost (may be reduced by effects in future) */
export function getEffectiveCost(
  _instance: CardInstance,
  definition: CardDefinition
): number {
  return definition.cost;
}

// -----------------------------------------------------------------------------
// KEYWORD CHECKING
// Checks both the card definition AND temporary granted keywords.
// -----------------------------------------------------------------------------

export function hasKeyword(
  instance: CardInstance,
  definition: CardDefinition,
  keyword: Keyword
): boolean {
  // Check granted keywords first (from effects)
  if (instance.grantedKeywords.includes(keyword)) return true;

  // Check timed effects for granted keywords
  if (instance.timedEffects.some(
    (te) => te.type === "grant_keyword" && te.keyword === keyword
  )) return true;

  // Check static keyword abilities on the definition
  return definition.abilities.some(
    (ability) => ability.type === "keyword" && ability.keyword === keyword
  );
}

export function getKeywordValue(
  instance: CardInstance,
  definition: CardDefinition,
  keyword: Keyword
): number {
  // Check granted keywords (value not tracked for granted, default 0)
  if (instance.grantedKeywords.includes(keyword)) return 0;

  const ability = definition.abilities.find(
    (a) => a.type === "keyword" && a.keyword === keyword
  );
  if (!ability || ability.type !== "keyword") return 0;
  return ability.value ?? 0;
}

// -----------------------------------------------------------------------------
// CARD FILTER MATCHING
// Used by effects and validation to find valid targets.
// -----------------------------------------------------------------------------

export function matchesFilter(
  instance: CardInstance,
  definition: CardDefinition,
  filter: CardFilter,
  state: GameState,
  viewingPlayerId: PlayerID
): boolean {
  const opponent: PlayerID = viewingPlayerId === "player1" ? "player2" : "player1";

  if (filter.zone) {
    const zones = Array.isArray(filter.zone) ? filter.zone : [filter.zone];
    if (!zones.includes(instance.zone)) return false;
  }

  if (filter.owner) {
    const ownerId =
      filter.owner.type === "self"
        ? viewingPlayerId
        : filter.owner.type === "opponent"
        ? opponent
        : null;
    if (ownerId && instance.ownerId !== ownerId) return false;
  }

  if (filter.cardType) {
    if (!filter.cardType.includes(definition.cardType)) return false;
  }

  if (filter.inkColors) {
    if (!definition.inkColors.some(c => filter.inkColors!.includes(c))) return false;
  }

  if (filter.hasTrait) {
    if (!definition.traits.includes(filter.hasTrait)) return false;
  }

  if (filter.hasKeyword) {
    if (!hasKeyword(instance, definition, filter.hasKeyword)) return false;
  }

  if (filter.isExerted !== undefined) {
    if (instance.isExerted !== filter.isExerted) return false;
  }

  if (filter.costAtMost !== undefined) {
    if (definition.cost > filter.costAtMost) return false;
  }

  if (filter.costAtLeast !== undefined) {
    if (definition.cost < filter.costAtLeast) return false;
  }

  if (filter.excludeInstanceId) {
    if (instance.instanceId === filter.excludeInstanceId) return false;
  }

  if (filter.hasName) {
    if (definition.name !== filter.hasName) return false;
  }

  if (filter.hasDamage !== undefined) {
    if (filter.hasDamage && instance.damage <= 0) return false;
    if (!filter.hasDamage && instance.damage > 0) return false;
  }

  return true;
}

/** Find all instances in the game matching a filter */
export function findMatchingInstances(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  filter: CardFilter,
  viewingPlayerId: PlayerID
): CardInstance[] {
  return Object.values(state.cards).filter((instance) => {
    const def = definitions[instance.definitionId];
    if (!def) return false;
    return matchesFilter(instance, def, filter, state, viewingPlayerId);
  });
}

// -----------------------------------------------------------------------------
// VALIDATION HELPERS
// -----------------------------------------------------------------------------

/** Can a player afford to play a card? */
export function canAfford(state: GameState, playerId: PlayerID, cost: number): boolean {
  return state.players[playerId].availableInk >= cost;
}

/** Is it currently this player's turn and main phase? */
export function isMainPhase(state: GameState, playerId: PlayerID): boolean {
  return state.currentPlayer === playerId && state.phase === "main";
}

/** Get the opposing player's ID */
export function getOpponent(playerId: PlayerID): PlayerID {
  return playerId === "player1" ? "player2" : "player1";
}

/** Count total ink available (inkwell cards) */
export function countInkwell(state: GameState, playerId: PlayerID): number {
  return getZone(state, playerId, "inkwell").length;
}

// -----------------------------------------------------------------------------
// STATE IMMUTABILITY HELPERS
// Produce new state objects without mutating. Use these in reducers.
// -----------------------------------------------------------------------------

/** Update a card instance immutably */
export function updateInstance(
  state: GameState,
  instanceId: string,
  update: Partial<CardInstance>
): GameState {
  return {
    ...state,
    cards: {
      ...state.cards,
      [instanceId]: { ...getInstance(state, instanceId), ...update },
    },
  };
}

/** Move a card from one zone to another immutably */
export function moveCard(
  state: GameState,
  instanceId: string,
  targetPlayerId: PlayerID,
  targetZone: ZoneName,
  position: "top" | "bottom" | number = "bottom"
): GameState {
  const instance = getInstance(state, instanceId);
  const sourcePlayerId = instance.ownerId;
  const sourceZone = instance.zone;

  // Remove from source zone
  const newSourceZone = state.zones[sourcePlayerId][sourceZone].filter(
    (id) => id !== instanceId
  );

  // Add to target zone
  const currentTargetZone = state.zones[targetPlayerId]?.[targetZone] ?? [];
  let newTargetZone: string[];
  if (position === "top") {
    newTargetZone = [instanceId, ...currentTargetZone];
  } else if (position === "bottom") {
    newTargetZone = [...currentTargetZone, instanceId];
  } else {
    newTargetZone = [
      ...currentTargetZone.slice(0, position),
      instanceId,
      ...currentTargetZone.slice(position),
    ];
  }

  // Build updated zones carefully — if source and target player are the same,
  // we must apply both zone changes together or they'll clobber each other.
  const updatedPlayerZones =
    sourcePlayerId === targetPlayerId
      ? {
          [sourcePlayerId]: {
            ...state.zones[sourcePlayerId],
            [sourceZone]: newSourceZone,
            [targetZone]: newTargetZone,
          },
        }
      : {
          [sourcePlayerId]: {
            ...state.zones[sourcePlayerId],
            [sourceZone]: newSourceZone,
          },
          [targetPlayerId]: {
            ...state.zones[targetPlayerId],
            [targetZone]: newTargetZone,
          },
        };

  return {
    ...state,
    cards: {
      ...state.cards,
      [instanceId]: {
        ...instance,
        zone: targetZone,
        ownerId: targetPlayerId,
      },
    },
    zones: {
      ...state.zones,
      ...updatedPlayerZones,
    },
  };
}

/** Append a log entry */
export function appendLog(
  state: GameState,
  entry: Omit<GameState["actionLog"][number], "timestamp">
): GameState {
  return {
    ...state,
    actionLog: [
      ...state.actionLog,
      { ...entry, timestamp: Date.now() },
    ],
  };
}

// -----------------------------------------------------------------------------
// SONG / SINGER HELPERS
// -----------------------------------------------------------------------------

/** CRD 5.4.4.1: Songs have "Song" trait and cardType "action" */
export function isSong(def: CardDefinition): boolean {
  return def.cardType === "action" && def.traits.includes("Song");
}

/** CRD 5.4.4.2 / 8.11: Can this character sing this song? */
export function canSingSong(
  singerInstance: CardInstance,
  singerDef: CardDefinition,
  songDef: CardDefinition
): boolean {
  // CRD 5.4.4.2: Only characters can sing songs (items/actions cannot)
  if (singerDef.cardType !== "character") return false;
  // CRD 8.11.1: Singer N — count as cost N for singing
  let effectiveCost = singerDef.cost;
  if (hasKeyword(singerInstance, singerDef, "singer")) {
    effectiveCost = getKeywordValue(singerInstance, singerDef, "singer");
  }
  return effectiveCost >= songDef.cost;
}

// -----------------------------------------------------------------------------
// CONDITION EVALUATION
// Pure function — used by reducer (triggers/activated) and gameModifiers (statics)
// -----------------------------------------------------------------------------

/** CRD 6.2.1: Evaluate a condition guard */
export function evaluateCondition(
  condition: Condition,
  state: GameState,
  definitions: Record<string, CardDefinition>,
  controllingPlayerId: PlayerID,
  sourceInstanceId: string
): boolean {
  const opponent = getOpponent(controllingPlayerId);
  switch (condition.type) {
    case "you_have_lore_gte":
      return state.players[controllingPlayerId].lore >= condition.amount;
    case "opponent_has_lore_gte":
      return state.players[opponent].lore >= condition.amount;
    case "cards_in_hand_gte": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      return getZone(state, targetPlayer, "hand").length >= condition.amount;
    }
    case "cards_in_hand_eq": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      return getZone(state, targetPlayer, "hand").length === condition.amount;
    }
    case "characters_in_play_gte": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      const charsInPlay = getZone(state, targetPlayer, "play").filter((id) => {
        if (condition.excludeSelf && id === sourceInstanceId) return false;
        const inst = state.cards[id];
        if (!inst) return false;
        const def = definitions[inst.definitionId];
        return def?.cardType === "character";
      });
      return charsInPlay.length >= condition.amount;
    }
    case "has_character_named": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      return getZone(state, targetPlayer, "play").some((id) => {
        const inst = state.cards[id];
        if (!inst) return false;
        const def = definitions[inst.definitionId];
        return def?.cardType === "character" && def.name === condition.name;
      });
    }
    case "has_character_with_trait": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      return getZone(state, targetPlayer, "play").some((id) => {
        const inst = state.cards[id];
        if (!inst) return false;
        const def = definitions[inst.definitionId];
        return def?.cardType === "character" && def.traits.includes(condition.trait);
      });
    }
    case "opponent_has_more_cards_in_hand":
      return getZone(state, opponent, "hand").length > getZone(state, controllingPlayerId, "hand").length;
    case "is_your_turn":
      return state.currentPlayer === controllingPlayerId;
    case "this_is_exerted": {
      const sourceInst = state.cards[sourceInstanceId];
      return sourceInst ? sourceInst.isExerted : false;
    }
    case "cards_in_zone_gte": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      return getZone(state, targetPlayer, condition.zone).length >= condition.amount;
    }
    case "played_character_with_trait_this_turn": {
      // Check if any character in play was played this turn (isDrying) and has the trait
      return getZone(state, controllingPlayerId, "play").some((id) => {
        const inst = state.cards[id];
        if (!inst || !inst.isDrying) return false;
        const def = definitions[inst.definitionId];
        return def?.cardType === "character" && def.traits.includes(condition.trait);
      });
    }
    case "card_has_trait": {
      const inst = state.cards[sourceInstanceId];
      const def = inst ? definitions[inst.definitionId] : undefined;
      return def ? def.traits.includes(condition.trait) : false;
    }
    case "card_is_type": {
      const inst = state.cards[sourceInstanceId];
      const def = inst ? definitions[inst.definitionId] : undefined;
      return def ? def.cardType === condition.cardType : false;
    }
    default:
      return true;
  }
}

// -----------------------------------------------------------------------------
// UUID GENERATION
// Simple, dependency-free UUID for card instances
// -----------------------------------------------------------------------------
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
