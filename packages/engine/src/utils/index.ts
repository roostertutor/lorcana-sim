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
  ResolvedRef,
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

/**
 * Optional shape for stat-floor lookups. We accept a plain object instead of
 * the full GameModifiers type to avoid an import cycle (utils → engine).
 */
type StatFloorLookup = {
  statFloorsPrinted?: Map<string, Set<"strength" | "willpower" | "lore">>;
} | undefined;

function hasPrintedFloor(
  instance: CardInstance,
  stat: "strength" | "willpower" | "lore",
  modifiers: StatFloorLookup
): boolean {
  return !!modifiers?.statFloorsPrinted?.get(instance.instanceId)?.has(stat);
}

export function getEffectiveStrength(
  instance: CardInstance,
  definition: CardDefinition,
  staticBonus = 0,
  modifiers?: StatFloorLookup
): number {
  const base = definition.strength ?? 0;
  const timedBonus = instance.timedEffects
    .filter((te) => te.type === "modify_strength")
    .reduce((sum, te) => sum + (te.amount ?? 0), 0);
  const value = Math.max(0, base + timedBonus + staticBonus);
  // CRD: "can't be reduced below printed value" → clamp to printed strength.
  if (hasPrintedFloor(instance, "strength", modifiers)) return Math.max(value, base);
  return value;
}

export function getEffectiveWillpower(
  instance: CardInstance,
  definition: CardDefinition,
  staticBonus = 0,
  modifiers?: StatFloorLookup
): number {
  const base = definition.willpower ?? 0;
  const timedBonus = instance.timedEffects
    .filter((te) => te.type === "modify_willpower")
    .reduce((sum, te) => sum + (te.amount ?? 0), 0);
  const value = Math.max(0, base + timedBonus + staticBonus);
  if (hasPrintedFloor(instance, "willpower", modifiers)) return Math.max(value, base);
  return value;
}

export function getEffectiveLore(
  instance: CardInstance,
  definition: CardDefinition,
  staticBonus = 0,
  modifiers?: StatFloorLookup
): number {
  const base = definition.lore ?? 0;
  const timedBonus = instance.timedEffects
    .filter((te) => te.type === "modify_lore")
    .reduce((sum, te) => sum + (te.amount ?? 0), 0);
  const value = Math.max(0, base + timedBonus + staticBonus);
  if (hasPrintedFloor(instance, "lore", modifiers)) return Math.max(value, base);
  return value;
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
  modifiers: {
    actionRestrictions: { restricts: string; affectedPlayerId: PlayerID; filter?: CardFilter }[];
    selfActionRestrictions?: Map<string, Set<RestrictedAction>>;
  }
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
  // Source 3: permanent self-restrictions tied to the source instance (Maui - Whale)
  if (modifiers.selfActionRestrictions?.get(instance.instanceId)?.has(action)) {
    return true;
  }
  return false;
}

/**
 * Build a ResolvedRef snapshot from a card instance. Captures identity + a
 * stat snapshot at the current moment so downstream effect steps can reference
 * the previously-resolved card even if it later moves zones or has its stats
 * modified. Pass `delta` for `isUpTo` consumption tracking.
 */
export function makeResolvedRef(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  instanceId: string,
  opts?: { delta?: number }
): ResolvedRef | undefined {
  const instance = state.cards[instanceId];
  if (!instance) return undefined;
  const def = definitions[instance.definitionId];
  if (!def) return undefined;
  const ref: ResolvedRef = {
    instanceId,
    definitionId: def.id,
    name: def.name,
    fullName: def.fullName,
    ownerId: instance.ownerId,
    cost: def.cost,
    damage: instance.damage,
  };
  if (def.cardType === "character") {
    ref.strength = getEffectiveStrength(instance, def);
    ref.willpower = getEffectiveWillpower(instance, def);
    ref.lore = getEffectiveLore(instance, def);
  } else if (def.cardType === "location") {
    ref.willpower = def.willpower;
    ref.lore = def.lore;
  }
  if (opts?.delta !== undefined) ref.delta = opts.delta;
  return ref;
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
  keyword: Keyword,
  /** Optional gameModifiers — when provided, checks suppressedKeywords
   *  (Captain Hook MAN-TO-MAN: "Peter Pan loses Evasive"). */
  modifiers?: { suppressedKeywords: Map<string, Set<Keyword>> },
): boolean {
  // Check if this keyword is suppressed by a static (remove_keyword)
  if (modifiers?.suppressedKeywords.get(instance.instanceId)?.has(keyword)) return false;

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
  keyword: Keyword,
  /** Optional static-granted keywords from gameModifiers (includes {keyword, value} pairs) */
  staticGrants?: { keyword: Keyword; value?: number }[]
): number {
  let total = 0;

  // Check definition keyword abilities (e.g. Challenger +2, Resist +1, Singer 5)
  for (const ability of definition.abilities) {
    if (ability.type === "keyword" && ability.keyword === keyword) {
      total += ability.value ?? 0;
    }
  }

  // Check timed effects (e.g. "gains Challenger +3 this turn")
  for (const te of instance.timedEffects) {
    if (te.type === "grant_keyword" && te.keyword === keyword) {
      total += te.value ?? 0;
    }
  }

  // Check static-granted keywords from gameModifiers (e.g. Cogsworth Resist +1)
  if (staticGrants) {
    for (const grant of staticGrants) {
      if (grant.keyword === keyword) {
        total += grant.value ?? 0;
      }
    }
  }

  return total;
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
  viewingPlayerId: PlayerID,
  /** CRD 5.6.4: source instanceId for "atLocation: this" — only set by gameModifiers static iteration */
  sourceInstanceId?: string,
  /** Definitions map — needed to resolve filters that reference the source
   *  card's properties (e.g. `nameFromSource`). Optional for backwards
   *  compatibility with call sites that don't yet pass it; in that case
   *  source-name filters fall through (no match). */
  definitions?: Record<string, CardDefinition>,
  /** Optional GameModifiers — when present, hasTrait/hasAnyTrait checks ALSO
   *  consult `modifiers.grantedTraits` so that runtime trait grants like Chief
   *  Bogo's DEPUTIZE are visible. Call sites that already have a computed
   *  modifiers object should pass it; gameModifiers iteration itself MUST NOT
   *  pass (to avoid recursive evaluation against an in-progress build). */
  modifiers?: { grantedTraits: Map<string, Set<string>> }
): boolean {
  // Generic source-aware filters (Bad-Anon Villain Support Center,
  // future "discard a card with the same name as this character", etc.).
  if (filter.nameFromSource) {
    if (!sourceInstanceId || !definitions) return false;
    const srcInst = state.cards[sourceInstanceId];
    if (!srcInst) return false;
    const srcDef = definitions[srcInst.definitionId];
    if (!srcDef) return false;
    if (definition.name !== srcDef.name) return false;
  }
  if (filter.atLocation === "this") {
    if (!sourceInstanceId) return false;
    if (instance.atLocationInstanceId !== sourceInstanceId) return false;
  }
  if (filter.atLocation === "any") {
    if (!instance.atLocationInstanceId) return false;
  }
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
    const granted = modifiers?.grantedTraits.get(instance.instanceId);
    const hasIt = definition.traits.includes(filter.hasTrait) || (granted?.has(filter.hasTrait) ?? false);
    if (!hasIt) return false;
  }

  if (filter.hasAnyTrait) {
    const granted = modifiers?.grantedTraits.get(instance.instanceId);
    const hasAny = filter.hasAnyTrait.some(t =>
      definition.traits.includes(t) || (granted?.has(t) ?? false)
    );
    if (!hasAny) return false;
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
  if (filter.costAtMostFromLastResolvedSourcePlus !== undefined) {
    const srcCost = state.lastResolvedSource?.cost;
    if (srcCost === undefined) return false;
    if (definition.cost > srcCost + filter.costAtMostFromLastResolvedSourcePlus) return false;
  }
  if (filter.costAtMostFromSourceStrength && sourceInstanceId) {
    const src = state.cards[sourceInstanceId];
    const srcDef = src ? definitions?.[src.definitionId] : undefined;
    if (!src || !srcDef) return false;
    const srcStrength = getEffectiveStrength(src, srcDef);
    if (definition.cost > srcStrength) return false;
  }

  if (filter.costAtLeast !== undefined) {
    if (definition.cost < filter.costAtLeast) return false;
  }

  if (filter.excludeInstanceId) {
    if (instance.instanceId === filter.excludeInstanceId) return false;
  }

  // CRD 6.1.6: "another" / "other" — exclude the source card itself
  if (filter.excludeSelf && sourceInstanceId && instance.instanceId === sourceInstanceId) {
    return false;
  }

  if (filter.hasName) {
    const altNames = definition.alternateNames ?? [];
    if (definition.name !== filter.hasName && !altNames.includes(filter.hasName)) return false;
  }

  if (filter.nameFromLastResolvedSource) {
    const srcName = state.lastResolvedSource?.name;
    if (!srcName) return false;
    const altNames = definition.alternateNames ?? [];
    if (definition.name !== srcName && !altNames.includes(srcName)) return false;
  }
  if (filter.nameFromLastResolvedTarget) {
    const tgtName = state.lastResolvedTarget?.name;
    if (!tgtName) return false;
    const altNames = definition.alternateNames ?? [];
    if (definition.name !== tgtName && !altNames.includes(tgtName)) return false;
  }
  if (filter.hasDamage !== undefined) {
    if (filter.hasDamage && instance.damage <= 0) return false;
    if (!filter.hasDamage && instance.damage > 0) return false;
  }

  if (filter.strengthAtMost !== undefined || filter.strengthAtLeast !== undefined) {
    const str = getEffectiveStrength(instance, definition);
    if (filter.strengthAtMost !== undefined && str > filter.strengthAtMost) return false;
    if (filter.strengthAtLeast !== undefined && str < filter.strengthAtLeast) return false;
  }

  if (filter.challengedThisTurn !== undefined) {
    if (filter.challengedThisTurn && !instance.challengedThisTurn) return false;
    if (!filter.challengedThisTurn && instance.challengedThisTurn) return false;
  }

  // CRD 8.4.2: "with a card under them" / "while there's a card under".
  if (filter.hasCardUnder !== undefined) {
    const has = (instance.cardsUnder?.length ?? 0) > 0;
    if (filter.hasCardUnder && !has) return false;
    if (!filter.hasCardUnder && has) return false;
  }

  // OR-of-subfilters at the filter-clause level. Top-level fields are AND'd
  // (handled above); anyOf adds an OR group on top of that. The instance must
  // match at least ONE entry. Each entry is a full CardFilter, evaluated
  // recursively — so nested ANDs work inside each branch. Used by John Smith's
  // Compass YOUR PATH ("character with cost ≤3 OR named Pocahontas").
  if (filter.anyOf && filter.anyOf.length > 0) {
    const anyMatch = filter.anyOf.some(sub =>
      matchesFilter(instance, definition, sub, state, viewingPlayerId, sourceInstanceId, definitions, modifiers)
    );
    if (!anyMatch) return false;
  }

  return true;
}

/** Find all instances in the game matching a filter */
export function findMatchingInstances(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  filter: CardFilter,
  viewingPlayerId: PlayerID,
  sourceInstanceId?: string
): CardInstance[] {
  return Object.values(state.cards).filter((instance) => {
    const def = definitions[instance.definitionId];
    if (!def) return false;
    return matchesFilter(instance, def, filter, state, viewingPlayerId, sourceInstanceId);
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

  // Per-turn flag for "if a card left a player's discard this turn" (Anna
  // Soothing Sister UNUSUAL TRANSFORMATION). Set whenever any card leaves any
  // player's discard. Cleared on PASS_TURN.
  const cardsLeftDiscardThisTurn =
    sourceZone === "discard" ? true : state.cardsLeftDiscardThisTurn;
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
    cardsLeftDiscardThisTurn,
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
  songDef: CardDefinition,
  virtualBonus = 0
): boolean {
  // CRD 5.4.4.2: Only characters can sing songs (items/actions cannot)
  if (singerDef.cardType !== "character") return false;
  // CRD 8.11.1: Singer N — count as cost N for singing
  let effectiveCost = singerDef.cost;
  if (hasKeyword(singerInstance, singerDef, "singer")) {
    effectiveCost = getKeywordValue(singerInstance, singerDef, "singer");
  }
  // Virtual bonus from "while at this location" effects (Atlantica Concert Hall).
  effectiveCost += virtualBonus;
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
  sourceInstanceId: string,
  triggeringCardInstanceId?: string,
  /** In-progress static stat bonuses from getGameModifiers — needed so self_stat_gte
   *  sees strength/willpower/lore from other static abilities (e.g. Snowfort +1 str). */
  statBonuses?: Map<string, { strength: number; willpower: number; lore: number }>
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
        if (def?.cardType !== "character") return false;
        // Optional name filter — Maleficent Formidable Queen "for each of
        // your characters named Maleficent in play".
        if (condition.hasName && def.name !== condition.hasName) return false;
        return true;
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
        if (condition.excludeSelf && id === sourceInstanceId) return false;
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
    case "ink_plays_this_turn_eq": {
      return (state.players[controllingPlayerId].inkPlaysThisTurn ?? 0) === condition.amount;
    }
    case "triggering_player_draws_this_turn_eq": {
      // Ink Amplifier ENERGY CAPTURE: derive the drawing player from the
      // triggering card's owner (card_drawn trigger carries the drawn card).
      const triggerCard = triggeringCardInstanceId ? state.cards[triggeringCardInstanceId] : undefined;
      const triggerPlayer = triggerCard?.ownerId ?? controllingPlayerId;
      return (state.players[triggerPlayer].cardsDrawnThisTurn ?? 0) === condition.amount;
    }
    case "no_other_character_quested_this_turn": {
      // Isabela Madrigal Golden Child. The counter is bumped AFTER static lore
      // computation in applyQuest, so at evaluate time it reflects only OTHER
      // quests (the current questing source isn't yet counted).
      return (state.players[controllingPlayerId].charactersQuestedThisTurn ?? 0) === 0;
    }
    case "this_had_card_put_under_this_turn": {
      const inst = state.cards[sourceInstanceId];
      return !!inst && (inst.cardsPutUnderThisTurn ?? 0) > 0;
    }
    case "you_put_card_under_this_turn": {
      // Player-wide aggregate: any of controller's in-play cards has cardsPutUnderThisTurn > 0.
      return getZone(state, controllingPlayerId, "play").some((id) => {
        const inst = state.cards[id];
        return !!inst && (inst.cardsPutUnderThisTurn ?? 0) > 0;
      });
    }
    case "no_challenges_this_turn": {
      return !state.players[controllingPlayerId].aCharacterChallengedThisTurn;
    }
    case "card_left_discard_this_turn": {
      return !!state.cardsLeftDiscardThisTurn;
    }
    case "opponent_no_challenges_this_turn": {
      const opp: PlayerID = controllingPlayerId === "player1" ? "player2" : "player1";
      return !state.players[opp].aCharacterChallengedThisTurn;
    }
    case "played_this_turn": {
      // Unified "you've played [filter] this turn" condition. Counts entries
      // in cardsPlayedThisTurn (all card plays) matching the optional filter.
      const list = state.players[controllingPlayerId].cardsPlayedThisTurn ?? [];
      let count = 0;
      for (const id of list) {
        const inst = state.cards[id];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (!def) continue;
        if (condition.filter && !matchesFilter(inst, def, condition.filter, state, controllingPlayerId, sourceInstanceId)) continue;
        count++;
      }
      const op = condition.op ?? ">=";
      return op === ">=" ? count >= condition.amount : count === condition.amount;
    }
    case "your_first_turn_as_underdog": {
      // CRD: UNDERDOG ("if this is your first turn and you're not the first
      // player"). 2P: it's the controller's first turn iff turnNumber equals
      // the index at which they first take a turn. Player1 = turn 1, player2 =
      // turn 2 (when player1 went first). Use firstPlayerId so this stays
      // honest if randomization lands later.
      const firstPlayer = state.firstPlayerId ?? "player1";
      if (controllingPlayerId === firstPlayer) return false;
      // The non-first player's first turn is turn 2 in 2P.
      return state.turnNumber === 2 && state.currentPlayer === controllingPlayerId;
    }
    case "this_is_exerted": {
      const sourceInst = state.cards[sourceInstanceId];
      return sourceInst ? sourceInst.isExerted : false;
    }
    case "cards_in_zone_gte": {
      const targetPlayer = condition.player.type === "self" ? controllingPlayerId
        : condition.player.type === "opponent" ? opponent : controllingPlayerId;
      const zoneCards = getZone(state, targetPlayer, condition.zone);
      if (condition.cardType) {
        // Filter by card type (e.g., only count items)
        const matchingCount = zoneCards.filter(id => {
          const def = definitions[state.cards[id]?.definitionId ?? ""];
          return def && condition.cardType!.includes(def.cardType);
        }).length;
        return matchingCount >= condition.amount;
      }
      return zoneCards.length >= condition.amount;
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
    case "self_stat_gte": {
      const inst = state.cards[sourceInstanceId];
      if (!inst) return false;
      const def = definitions[inst.definitionId];
      if (!def) return false;
      const sb = statBonuses?.get(sourceInstanceId);
      let value = 0;
      if (condition.stat === "strength") value = getEffectiveStrength(inst, def, sb?.strength ?? 0);
      else if (condition.stat === "willpower") value = getEffectiveWillpower(inst, def, sb?.willpower ?? 0);
      else if (condition.stat === "lore") value = getEffectiveLore(inst, def, sb?.lore ?? 0);
      return value >= condition.amount;
    }
    case "compound_and": {
      return condition.conditions.every(sub =>
        evaluateCondition(sub, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, statBonuses)
      );
    }
    case "compound_or": {
      return condition.conditions.some(sub =>
        evaluateCondition(sub, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, statBonuses)
      );
    }
    case "this_has_no_damage": {
      const inst = state.cards[sourceInstanceId];
      return inst ? inst.damage === 0 : false;
    }
    case "this_has_damage": {
      const inst = state.cards[sourceInstanceId];
      return inst ? inst.damage > 0 : false;
    }
    case "this_at_location": {
      const inst = state.cards[sourceInstanceId];
      return inst ? !!inst.atLocationInstanceId : false;
    }
    case "characters_here_gte": {
      // CRD 5.6: "N or more characters here" — count characters at the source
      // location, optionally filtered by owner.
      const pt = condition.player;
      const wantedOwner = !pt
        ? null
        : pt.type === "self" ? controllingPlayerId
        : pt.type === "opponent" ? opponent
        : null;
      let count = 0;
      for (const c of Object.values(state.cards)) {
        if (c.atLocationInstanceId !== sourceInstanceId) continue;
        if (wantedOwner && c.ownerId !== wantedOwner) continue;
        const def = definitions[c.definitionId];
        if (def?.cardType !== "character") continue;
        count++;
      }
      return count >= condition.amount;
    }
    case "this_location_has_character": {
      // True if any character (any owner) is currently at this location.
      // Used by Belle's House - Maurice's Workshop ("If you have a character here, items cost 1 less").
      for (const c of Object.values(state.cards)) {
        if (c.atLocationInstanceId === sourceInstanceId) return true;
      }
      return false;
    }
    case "this_location_has_character_with_trait": {
      // True if the controller has a character with the given trait at this location.
      // Used by Skull Rock Isolated Fortress SAFE HAVEN ("if you have a Pirate character here").
      const sourceInst = state.cards[sourceInstanceId];
      const ownerId = sourceInst?.ownerId;
      for (const c of Object.values(state.cards)) {
        if (c.atLocationInstanceId !== sourceInstanceId) continue;
        if (c.ownerId !== ownerId) continue;
        const def = definitions[c.definitionId];
        if (def?.traits?.includes(condition.trait)) return true;
      }
      return false;
    }
    case "this_has_cards_under": {
      // CRD 8.10.4 / 8.4.2: true if this card has at least one card under it
      // (from Shift base or Boost). Used by Flynn Rider Spectral Scoundrel etc.
      const inst = state.cards[sourceInstanceId];
      return !!inst && inst.cardsUnder.length > 0;
    }
    case "you_control_matching": {
      // CRD 8.4.2: true if the controller has at least `minimum` (default 1)
      // in-play cards matching the filter. Defaults filter.owner to self.
      const min = condition.minimum ?? 1;
      const filter: CardFilter = condition.filter.owner
        ? condition.filter
        : { ...condition.filter, owner: { type: "self" } };
      const zones: ZoneName[] = Array.isArray(filter.zone)
        ? filter.zone
        : filter.zone
        ? [filter.zone]
        : ["play"];
      let count = 0;
      for (const zone of zones) {
        const ids = getZone(state, controllingPlayerId, zone);
        for (const id of ids) {
          const inst = state.cards[id];
          if (!inst) continue;
          const def = definitions[inst.definitionId];
          if (!def) continue;
          if (matchesFilter(inst, def, filter, state, controllingPlayerId, sourceInstanceId)) {
            count++;
            if (count >= min) return true;
          }
        }
      }
      return false;
    }
    case "your_character_was_damaged_this_turn": {
      // Devil's Eye Diamond / Brutus - Fearsome Crocodile.
      return !!state.players[controllingPlayerId].aCharacterWasDamagedThisTurn;
    }
    case "opponent_character_was_banished_in_challenge_this_turn": {
      // LeFou - Opportunistic Flunky: free play if an opposing character was banished in a challenge this turn.
      return !!state.players[opponent].aCharacterWasBanishedInChallengeThisTurn;
    }
    case "a_character_was_banished_in_challenge_this_turn": {
      // The Thunderquack: "If a character was banished in a challenge this turn, gain 1 lore."
      // Either player's character counts.
      return !!state.players[controllingPlayerId].aCharacterWasBanishedInChallengeThisTurn
        || !!state.players[opponent].aCharacterWasBanishedInChallengeThisTurn;
    }
    case "opposing_character_was_damaged_this_turn": {
      // Nathaniel Flint - Notorious Pirate: "You can't play this character unless an opposing character was damaged this turn."
      return !!state.players[opponent].aCharacterWasDamagedThisTurn;
    }
    case "not": {
      return !evaluateCondition(condition.condition, state, definitions, controllingPlayerId, sourceInstanceId, triggeringCardInstanceId, statBonuses);
    }
    case "played_via_shift": {
      const inst = state.cards[sourceInstanceId];
      return inst?.playedViaShift === true;
    }
    case "triggering_card_played_via_shift": {
      if (!triggeringCardInstanceId) return false;
      const inst = state.cards[triggeringCardInstanceId];
      return inst?.playedViaShift === true;
    }
    case "this_location_has_exerted_character": {
      // Any character at this location that is exerted.
      for (const c of Object.values(state.cards)) {
        if (c.atLocationInstanceId !== sourceInstanceId) continue;
        if (c.isExerted) return true;
      }
      return false;
    }
    case "this_location_has_damaged_character": {
      // Any own character at this location with damage > 0 (Ratigan's
      // Party Seedy Back Room MISFITS' REVELRY).
      const sourceInst = state.cards[sourceInstanceId];
      const ownerId = sourceInst?.ownerId;
      for (const c of Object.values(state.cards)) {
        if (c.atLocationInstanceId !== sourceInstanceId) continue;
        if (c.ownerId !== ownerId) continue;
        if (c.damage > 0) return true;
      }
      return false;
    }
    case "self_has_more_than_each_opponent": {
      if (condition.metric === "strength_in_play") {
        // You control a character whose effective strength > every opposing character's strength.
        const oppChars = getZone(state, opponent, "play")
          .map((id) => {
            const inst = state.cards[id];
            if (!inst) return -1;
            const def = definitions[inst.definitionId];
            if (!def || def.cardType !== "character") return -1;
            return getEffectiveStrength(inst, def);
          })
          .filter((s) => s >= 0);
        const maxOpp = oppChars.length === 0 ? -1 : Math.max(...oppChars);
        const yours = getZone(state, controllingPlayerId, "play");
        for (const id of yours) {
          const inst = state.cards[id];
          if (!inst) continue;
          const def = definitions[inst.definitionId];
          if (!def || def.cardType !== "character") continue;
          if (getEffectiveStrength(inst, def) > maxOpp) return true;
        }
        return false;
      }
      if (condition.metric === "items_in_play") {
        const count = (pid: PlayerID) =>
          getZone(state, pid, "play").filter((id) => {
            const inst = state.cards[id];
            if (!inst) return false;
            const def = definitions[inst.definitionId];
            return def?.cardType === "item";
          }).length;
        return count(controllingPlayerId) > count(opponent);
      }
      if (condition.metric === "cards_in_inkwell") {
        return getZone(state, controllingPlayerId, "inkwell").length > getZone(state, opponent, "inkwell").length;
      }
      return false;
    }
    case "opponent_has_more_than_self": {
      // Mirror of self_has_more_than_each_opponent — fires if any opponent
      // STRICTLY exceeds the controller on the metric. Distinct from
      // not(self_has_more_than_each_opponent) because the negation also
      // fires on equal counts.
      if (condition.metric === "strength_in_play") {
        const myChars = getZone(state, controllingPlayerId, "play")
          .map((id) => {
            const inst = state.cards[id];
            if (!inst) return -1;
            const def = definitions[inst.definitionId];
            if (!def || def.cardType !== "character") return -1;
            return getEffectiveStrength(inst, def);
          })
          .filter((s) => s >= 0);
        const maxMine = myChars.length === 0 ? -1 : Math.max(...myChars);
        const oppChars = getZone(state, opponent, "play");
        for (const id of oppChars) {
          const inst = state.cards[id];
          if (!inst) continue;
          const def = definitions[inst.definitionId];
          if (!def || def.cardType !== "character") continue;
          if (getEffectiveStrength(inst, def) > maxMine) return true;
        }
        return false;
      }
      if (condition.metric === "items_in_play") {
        const count = (pid: PlayerID) =>
          getZone(state, pid, "play").filter((id) => {
            const inst = state.cards[id];
            if (!inst) return false;
            const def = definitions[inst.definitionId];
            return def?.cardType === "item";
          }).length;
        return count(opponent) > count(controllingPlayerId);
      }
      if (condition.metric === "cards_in_inkwell") {
        return getZone(state, opponent, "inkwell").length > getZone(state, controllingPlayerId, "inkwell").length;
      }
      return false;
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
