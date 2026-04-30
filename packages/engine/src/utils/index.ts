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

/** Placeholder definition returned for the server-filter `"hidden"` stub.
 *
 *  Server's `filterStateForPlayer` (server/src/services/stateFilter.ts) replaces
 *  opponent-side cards in hidden zones (hand, deck, face-down under-piles) with
 *  CardInstance stubs whose `definitionId` is the sentinel string `"hidden"`.
 *  The UI's optimistic-apply path then runs `applyAction(filteredState, action,
 *  definitions)` locally for instant feedback — but `definitions` doesn't carry
 *  a `"hidden"` entry, so any code path that resolves a hidden card's definition
 *  (most commonly `applyDraw` reading the drawn card's name for the log line, or
 *  `card_drawn` triggers cascading on opponent's automatic draw at turn start)
 *  used to throw `Card definition not found: hidden`. The engine's outer
 *  try/catch swallowed the throw and returned `{ success: false }`, so MP
 *  gameplay still worked via the server echo — but every PASS_TURN logged a
 *  noisy `[engine] applyAction threw` to the console.
 *
 *  This placeholder is benign for any matcher: empty abilities (no triggers /
 *  statics fire), empty inks (no color-keyed filter matches), no traits, zero
 *  cost. Stat fields are left undefined per CardDefinition's optional shape;
 *  the existing effective-stat helpers default `def.strength ?? 0` etc.
 *
 *  The sentinel id matches `hiddenStub` in the server (currently `"hidden"`).
 *  If that contract changes, update both call sites — but exposing the value
 *  here keeps the engine forgiving of a known server contract without N
 *  consumers needing to merge the placeholder into their definitions map. */
export const HIDDEN_DEFINITION: CardDefinition = {
  id: "hidden",
  name: "Hidden",
  fullName: "Hidden Card",
  cardType: "character",
  cost: 0,
  inkable: false,
  inkColors: [],
  traits: [],
  abilities: [],
  rarity: "common",
  setId: "hidden",
  number: 0,
  rulesText: "",
};

/** Get the static definition for an instance */
export function getDefinition(
  state: GameState,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): CardDefinition {
  const instance = getInstance(state, instanceId);
  const def = definitions[instance.definitionId];
  if (def) return def;
  // Server-filter sentinel: opponent-side cards in hidden zones come back with
  // definitionId === "hidden" and are not registered in the definitions map
  // passed to applyAction (UI optimistic-apply path). Return the placeholder
  // so the throwing variant stays graceful for the MP path. See HIDDEN_DEFINITION JSDoc.
  if (instance.definitionId === "hidden") return HIDDEN_DEFINITION;
  throw new Error(`Card definition not found: ${instance.definitionId}`);
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
    actionRestrictions: { restricts: string; affectedPlayerId: PlayerID; filter?: CardFilter; sourceInstanceId?: string }[];
    selfActionRestrictions?: Map<string, Set<RestrictedAction>>;
  }
): boolean {
  // Source 1: timed effects on the card
  if (instance.timedEffects.some(te => te.type === "cant_action" && te.action === action)) {
    return true;
  }
  // Source 2: static restrictions from gameModifiers. Pass sourceInstanceId so
  // filter.excludeSelf ("Other characters...") correctly exempts the source —
  // otherwise excludeSelf silently no-ops and the emitter restricts itself
  // (Ursula Sea Witch Queen's YOU'LL LISTEN TO ME).
  for (const r of modifiers.actionRestrictions) {
    if (r.restricts !== action || r.affectedPlayerId !== playerId) continue;
    if (!r.filter || matchesFilter(instance, definition, r.filter, state, playerId, r.sourceInstanceId)) {
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
 * Return the unlock cost for a restricted action, if any. Used by RC
 * Remote-Controlled Car ("can't quest or challenge unless you pay 1 {I}") —
 * the restriction is bypassable by paying the listed costs. The validator
 * calls this when `isActionRestricted` is true to decide whether to allow
 * the action; the reducer deducts the cost at action resolution time.
 * Returns undefined when no unlock is available (the action is strictly blocked).
 */
export function getSelfActionUnlockCost(
  instanceId: string,
  action: RestrictedAction,
  modifiers: {
    selfActionUnlockCosts?: Map<string, Map<RestrictedAction, import("../types/index.js").Cost[]>>;
  }
): import("../types/index.js").Cost[] | undefined {
  return modifiers.selfActionUnlockCosts?.get(instanceId)?.get(action);
}

/**
 * Build a ResolvedRef snapshot from a card instance. Captures identity + a
 * stat snapshot at the current moment so downstream effect steps can reference
 * the previously-resolved card even if it later moves zones or has its stats
 * modified. Pass `delta` for `isUpTo` consumption tracking. Pass `privateTo`
 * when the resolved card is in a hidden zone so server-side filterStateForPlayer
 * can redact identity fields for non-audience viewers (see ResolvedRef JSDoc).
 */
export function makeResolvedRef(
  state: GameState,
  definitions: Record<string, CardDefinition>,
  instanceId: string,
  opts?: { delta?: number; privateTo?: PlayerID }
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
  if (opts?.privateTo !== undefined) ref.privateTo = opts.privateTo;
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

  // Check if this keyword is suppressed by a timed effect (Maui Soaring
  // Demigod "loses Reckless this turn"). Timed suppression outranks grants:
  // even if grantedKeywords includes the keyword, the suppression hides it
  // for the duration.
  if (instance.timedEffects.some(
    (te) => te.type === "suppress_keyword" && te.keyword === keyword
  )) return false;

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
  // Don Karnage Air Pirate Leader SCORNFUL TAUNT: "whenever you play an
  // action that isn't a song" — negated trait check.
  if (filter.hasNoTrait) {
    const granted = modifiers?.grantedTraits.get(instance.instanceId);
    const hasIt = definition.traits.includes(filter.hasNoTrait) || (granted?.has(filter.hasNoTrait) ?? false);
    if (hasIt) return false;
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

  // Tug-of-War: "each opposing character without Evasive" — match cards
  // that do NOT have the keyword.
  if (filter.lacksKeyword) {
    if (hasKeyword(instance, definition, filter.lacksKeyword)) return false;
  }

  if (filter.isExerted !== undefined) {
    if (instance.isExerted !== filter.isExerted) return false;
  }

  // Structured per-axis comparisons (replaces the legacy flat fields —
  // costAtMost, costAtLeast, strengthAtMost, strengthAtLeast,
  // willpowerAtMost, willpowerAtLeast, costAtMostFromLastResolvedSourcePlus,
  // costAtMostFromSourceStrength, strengthAtMostFromBanishedSource).
  //
  // Each entry is `{stat, op, value}`. All entries AND together. `value` is
  // a number or `{from, property?, offset?}` reference resolved at match
  // time. Unresolvable references (ref missing from state) fail the filter.
  if (filter.statComparisons && filter.statComparisons.length > 0) {
    for (const cmp of filter.statComparisons) {
      const actual = resolveCardStat(instance, definition, cmp.stat);
      const bound = resolveStatValue(cmp.value, cmp.stat, state, sourceInstanceId, definitions);
      if (bound === undefined) return false;
      if (!checkStatOp(actual, cmp.op, bound)) return false;
    }
  }

  if (filter.excludeInstanceId) {
    if (instance.instanceId === filter.excludeInstanceId) return false;
  }

  // CRD 6.1.6: "another" / "other" — exclude the source card itself
  if (filter.excludeSelf && sourceInstanceId && instance.instanceId === sourceInstanceId) {
    return false;
  }
  // Inverse of excludeSelf: require the matched card to BE the source.
  // For card_put_under triggers, this is the receiver-instance scoping: the
  // cross-card trigger path passes the watcher's instanceId as
  // sourceInstanceId; only the watcher whose own event fired matches.
  if (filter.isSelf && sourceInstanceId && instance.instanceId !== sourceInstanceId) {
    return false;
  }

  if (filter.hasName) {
    const altNames = definition.alternateNames ?? [];
    if (definition.name !== filter.hasName && !altNames.includes(filter.hasName)) return false;
  }

  if (filter.notHasName) {
    const altNames = definition.alternateNames ?? [];
    if (definition.name === filter.notHasName || altNames.includes(filter.notHasName)) return false;
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

  // strength/willpower/lore/damage + dynamic variants (FromLastResolvedSource,
  // FromBanishedSource, FromSourceStrength) are now all handled by the
  // statComparisons block above.

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

  // Stitch Experiment 626 STEALTH MODE: "a card with {IW}" — the printed
  // inkable flag from the card definition.
  if (filter.inkable !== undefined) {
    if (filter.inkable !== definition.inkable) return false;
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

// -----------------------------------------------------------------------------
// StatComparison helpers — support the unified statComparisons block above.
// Exported so decompiler/compiler tests can reuse the dispatch semantics.
// -----------------------------------------------------------------------------

/** Read the effective value of a stat on a card instance.
 *  - `cost` reads definition.cost (printed; cost never has runtime modifiers today).
 *  - `strength` / `willpower` / `lore` use the existing effective-stat helpers
 *    (printed + timedEffects; static bonuses are applied by the caller's
 *    modifiers object when needed by a specific call site — filters evaluate
 *    against effective base because the static layer is evaluated per-instance
 *    elsewhere).
 *  - `damage` reads instance.damage (counters currently on the card). */
export function resolveCardStat(
  instance: CardInstance,
  definition: CardDefinition,
  stat: import("../types/index.js").StatName,
): number {
  switch (stat) {
    case "cost":      return definition.cost;
    case "strength":  return getEffectiveStrength(instance, definition);
    case "willpower": return getEffectiveWillpower(instance, definition);
    case "lore":      return getEffectiveLore(instance, definition);
    case "damage":    return instance.damage;
  }
}

/** Resolve a StatValue (either a literal number or a `{from, property?, offset?}`
 *  reference) to a concrete number. Returns undefined when the reference can't
 *  be resolved (e.g. `lastResolvedSource` absent), which should fail the
 *  enclosing filter — same "reference missing = filter fails" semantic the
 *  legacy `costAtMostFromLastResolvedSourcePlus` path had. */
export function resolveStatValue(
  value: import("../types/index.js").StatValue,
  axisStat: import("../types/index.js").StatName,
  state: GameState,
  sourceInstanceId?: string,
  definitions?: Record<string, CardDefinition>,
): number | undefined {
  if (typeof value === "number") return value;
  const property = value.property ?? axisStat;
  const offset = value.offset ?? 0;
  // Resolve the reference source to a number for the requested property.
  let refValue: number | undefined;
  switch (value.from) {
    case "last_resolved_source": {
      const ref = state.lastResolvedSource;
      if (!ref) return undefined;
      refValue = readRefProperty(ref, property, state);
      break;
    }
    case "last_resolved_target": {
      const ref = state.lastResolvedTarget;
      if (!ref) return undefined;
      refValue = readRefProperty(ref, property, state);
      break;
    }
    case "last_banished_source": {
      // Special-case for strength: state.lastBanishedSourceStrength is the
      // pre-banish snapshot that includes POWERED UP / cardsUnder bonuses
      // (Wreck-it Ralph). For other properties we'd need a similar snapshot
      // — not currently captured, so undefined → filter fails.
      if (property === "strength") return state.lastBanishedSourceStrength !== undefined
        ? state.lastBanishedSourceStrength + offset
        : undefined;
      // Fallback: read from lastResolvedSource if it was populated by the banish.
      const ref = state.lastResolvedSource;
      refValue = ref ? readRefProperty(ref, property, state) : undefined;
      break;
    }
    case "source": {
      if (!sourceInstanceId || !definitions) return undefined;
      const src = state.cards[sourceInstanceId];
      const srcDef = src ? definitions[src.definitionId] : undefined;
      if (!src || !srcDef) return undefined;
      refValue = resolveCardStat(src, srcDef, property);
      break;
    }
    case "triggering_card": {
      // Triggering card's snapshot lives on state.lastResolvedTarget for
      // most effect paths where a triggering card is surfaced into a filter.
      // If a future card needs a distinct triggering-card channel, add one.
      const ref = state.lastResolvedTarget;
      if (!ref) return undefined;
      refValue = readRefProperty(ref, property, state);
      break;
    }
  }
  if (refValue === undefined) return undefined;
  return refValue + offset;
}

function readRefProperty(
  ref: import("../types/index.js").ResolvedRef,
  property: import("../types/index.js").StatName,
  _state: GameState,
): number | undefined {
  switch (property) {
    case "cost":      return ref.cost;
    case "strength":  return ref.strength;
    case "willpower": return ref.willpower;
    case "lore":      return ref.lore;
    case "damage":    return ref.damage;
  }
}

/** Apply a comparison operator between two numbers. */
export function checkStatOp(
  actual: number,
  op: import("../types/index.js").StatOp,
  bound: number,
): boolean {
  switch (op) {
    case "lte": return actual <= bound;
    case "gte": return actual >= bound;
    case "lt":  return actual <  bound;
    case "gt":  return actual >  bound;
    case "eq":  return actual === bound;
  }
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

  // Add to target zone. When source AND target are the same player+zone (e.g.
  // reveal_top_conditional's no-match path moves a deck-top card to deck-
  // bottom), build the target list FROM the card-removed source list so the
  // card isn't duplicated. Without this, the same-zone case would read the
  // un-filtered original `state.zones[...].targetZone` (still containing the
  // card) and append it again — deck length silently +1 per same-zone move.
  const sameZone =
    sourcePlayerId === targetPlayerId && sourceZone === targetZone;
  const currentTargetZone =
    sameZone ? newSourceZone : (state.zones[targetPlayerId]?.[targetZone] ?? []);
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

  // Per-turn counter for set-12 discard-theme cards (Helga Sinclair CRISIS
  // MANAGEMENT cost reduction, Kida/Kashekim inkwell acceleration, Lyle
  // DIRTY TRICKS lore drain, Escape Plan's playRestriction "unless 2+
  // cards were put into your discard this turn"). CRD wording "cards put
  // into <player>'s discard" scopes to the OWNER of the moved card — so
  // opponent actions going to the opponent's discard don't count toward
  // your counter, and vice versa. Lives in moveCard (the lowest-level
  // zone-change) so every discard path — zoneTransition (banish), direct
  // moveCard (discard_from_hand, action cleanup, mill, choose_discard),
  // and reveal_top_switch — increments uniformly. Previously lived only
  // in zoneTransition which missed ~7 direct-moveCard discard paths,
  // silently breaking Escape Plan's play gate and the other Madrigal
  // discard-theme conditions.
  let updatedPlayers = state.players;
  if (targetZone === "discard" && sourceZone !== "discard") {
    const ownerPid = instance.ownerId;
    const prev = state.players[ownerPid].cardsPutIntoDiscardThisTurn ?? 0;
    updatedPlayers = {
      ...state.players,
      [ownerPid]: { ...state.players[ownerPid], cardsPutIntoDiscardThisTurn: prev + 1 },
    };
  }

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
    players: updatedPlayers,
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

/** CRD 5.4.4.2 / 8.11: Can this character sing this song?
 *
 *  staticGrants: optional list of keyword grants from `gameModifiers
 *  .grantedKeywords.get(singerInstance.instanceId)`. Required when the singer's
 *  Singer keyword comes from a STATIC ability (e.g. Mickey Mouse Amber Champion
 *  FRIENDLY CHORUS — "While you have 2 or more other Amber characters in play,
 *  this character gains Singer 8"). Without it, hasKeyword/getKeywordValue
 *  miss static grants and the singer is treated as having no Singer at all,
 *  blocking the sing entirely. instance.grantedKeywords / .timedEffects-driven
 *  grants are still picked up automatically by the inner helpers — only
 *  modifier-pass static grants need to be threaded through. */
export function canSingSong(
  singerInstance: CardInstance,
  singerDef: CardDefinition,
  songDef: CardDefinition,
  virtualBonus = 0,
  staticGrants?: { keyword: import("../types/index.js").Keyword; value?: number }[]
): boolean {
  // CRD 5.4.4.2: Only characters can sing songs (items/actions cannot)
  if (singerDef.cardType !== "character") return false;
  // CRD 8.11.1: Singer N — count as cost N for singing
  let effectiveCost = singerDef.cost;
  const hasGrantedSinger = (staticGrants ?? []).some(g => g.keyword === "singer");
  if (hasKeyword(singerInstance, singerDef, "singer") || hasGrantedSinger) {
    effectiveCost = getKeywordValue(singerInstance, singerDef, "singer", staticGrants);
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
        // Optional rich CardFilter — Hans Brazen Manipulator GROWING
        // INFLUENCE: "if an opponent has 2 or more READY characters" uses
        // filter:{isExerted:false}.
        if (condition.filter) {
          if (!matchesFilter(inst, def, condition.filter, state, controllingPlayerId, sourceInstanceId, definitions)) return false;
        }
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
    case "character_challenges_this_turn_eq": {
      // Fa Zhou War Hero TRAINING EXERCISES: "if it's the second challenge
      // this turn". Read controller's charactersChallengedThisTurn.
      return (state.players[controllingPlayerId].charactersChallengedThisTurn ?? 0) === condition.amount;
    }
    case "no_other_character_quested_this_turn": {
      // Isabela Madrigal Golden Child. The counter is bumped AFTER static lore
      // computation in applyQuest, so at evaluate time it reflects only OTHER
      // quests (the current questing source isn't yet counted).
      return (state.players[controllingPlayerId].charactersQuestedThisTurn ?? 0) === 0;
    }
    case "last_resolved_target_has_trait": {
      // Evil Comes Prepared "If a Villain character is chosen, gain 1 lore."
      // Reads state.lastResolvedTarget — must be invoked AFTER an effect that
      // sets it (chosen-target effects do this when resolved).
      const lrt = state.lastResolvedTarget;
      if (!lrt || !lrt.instanceId) return false;
      const inst = state.cards[lrt.instanceId];
      if (!inst) return false;
      const def = definitions[inst.definitionId];
      if (!def) return false;
      return Array.isArray(def.traits) && def.traits.includes(condition.trait);
    }
    case "this_had_card_put_under_this_turn": {
      const inst = state.cards[sourceInstanceId];
      return !!inst && (inst.cardsPutUnderThisTurn ?? 0) > 0;
    }
    case "you_put_card_under_this_turn": {
      // Player-wide check — true if the controller put a card under any of
      // their characters or locations this turn (Boost or put_top_card_under).
      // Mulan Standing Her Ground FLOWING BLADE.
      return !!state.players[controllingPlayerId]?.youPutCardUnderThisTurn;
    }
    case "last_banished_had_cards_under": {
      // CRD snapshot: lastBanishedCardsUnderCount is captured at banish time
      // before leave-play cleanup wipes cardsUnder on the instance.
      return (state.lastBanishedCardsUnderCount ?? 0) > 0;
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
      // filter > cardType > unfiltered. `filter` is the rich CardFilter form
      // (hasDamage, hasTrait, isExerted, excludeSelf, etc.); `cardType` is a
      // legacy shortcut kept for backward compat.
      if (condition.filter) {
        const f = condition.filter;
        let count = 0;
        for (const id of zoneCards) {
          const inst = state.cards[id];
          if (!inst) continue;
          const def = definitions[inst.definitionId];
          if (!def) continue;
          if (matchesFilter(inst, def, f, state, controllingPlayerId, sourceInstanceId, definitions)) {
            count++;
          }
        }
        return count >= condition.amount;
      }
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
      if (!inst) return false;
      // Default: "any damage" (amount=1, op=">=")
      const amount = condition.amount ?? 1;
      const op = condition.op ?? ">=";
      switch (op) {
        case ">=": return inst.damage >= amount;
        case "==": return inst.damage === amount;
        case ">": return inst.damage > amount;
        case "<=": return inst.damage <= amount;
        case "<": return inst.damage < amount;
        default: {
          const _exhaustive: never = op;
          return _exhaustive;
        }
      }
    }
    case "this_at_location": {
      const inst = state.cards[sourceInstanceId];
      return inst ? !!inst.atLocationInstanceId : false;
    }
    case "characters_here_gte": {
      // CRD 5.6: count characters at the source location, optionally filtered
      // by owner, then compare to `amount` via `op` (default ">=").
      // Default ">=" handles "N or more characters here" (Pride Lands Jungle
      // Oasis); "==" handles "only N characters here" (Andy's Room).
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
      const op = condition.op ?? ">=";
      switch (op) {
        case ">=": return count >= condition.amount;
        case "==": return count === condition.amount;
        case ">": return count > condition.amount;
        case "<=": return count <= condition.amount;
        case "<": return count < condition.amount;
        default: {
          const _exhaustive: never = op;
          return _exhaustive;
        }
      }
    }
    case "this_location_has_character": {
      // True if any character (any owner) matching `filter` (if set) is
      // currently at this location. Belle's House Maurice's Workshop uses
      // no filter ("If you have a character here"). Game Preserve EASY TO
      // MISS uses filter:{hasKeyword:"evasive"} for "While there's a
      // character with Evasive here".
      for (const c of Object.values(state.cards)) {
        if (c.atLocationInstanceId !== sourceInstanceId) continue;
        const def = definitions[c.definitionId];
        if (!def || def.cardType !== "character") continue;
        if (condition.filter) {
          if (!matchesFilter(c, def, condition.filter, state, controllingPlayerId, sourceInstanceId, definitions)) continue;
        }
        return true;
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
      // Merlin Completing His Research LEGACY OF LEARNING: the ability fires
      // on banished_in_challenge AFTER leave-play cleanup has cleared the
      // pile — fall back to the snapshot captured at banish time only when
      // the source is no longer in play.
      if (inst && inst.zone !== "play"
          && state.lastBanishedCardsUnderCount !== undefined
          && state.lastBanishedCardsUnderCount > 0) {
        return true;
      }
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
    case "opponent_controls_matching": {
      // Vision Slab DANGER REVEALED: "if an opposing character has damage".
      // Opponent-scoped mirror of you_control_matching.
      const min = condition.minimum ?? 1;
      const filter: CardFilter = condition.filter.owner
        ? condition.filter
        : { ...condition.filter, owner: { type: "opponent" } };
      const zones: ZoneName[] = Array.isArray(filter.zone)
        ? filter.zone
        : filter.zone
        ? [filter.zone]
        : ["play"];
      let count = 0;
      for (const zone of zones) {
        const ids = getZone(state, opponent, zone);
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
    case "character_was_banished_this_turn": {
      // Iterate both players' banishedThisTurn instanceId lists (OR-combined
      // — oracles don't restrict by owner unless filter.owner says so). For
      // each banished instance, resolve the (now-in-discard) instance + def
      // and evaluate the CardFilter. `viewingPlayerId` is the controller, so
      // `filter.owner: {type: "self"}` means "one of YOUR characters was
      // banished." Used by Buzz's Arm MISSING PIECE (hasName) and Wind-Up
      // Frog ADDED TRACTION (hasTrait + owner:self).
      const myList = state.players[controllingPlayerId].banishedThisTurn ?? [];
      const theirList = state.players[opponent].banishedThisTurn ?? [];
      for (const id of myList) {
        const inst = state.cards[id];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (!def) continue;
        if (matchesFilter(inst, def, condition.filter, state, controllingPlayerId, sourceInstanceId, definitions)) return true;
      }
      for (const id of theirList) {
        const inst = state.cards[id];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (!def) continue;
        if (matchesFilter(inst, def, condition.filter, state, controllingPlayerId, sourceInstanceId, definitions)) return true;
      }
      return false;
    }
    case "opposing_character_was_damaged_this_turn": {
      // Nathaniel Flint - Notorious Pirate: "You can't play this character unless an opposing character was damaged this turn."
      return !!state.players[opponent].aCharacterWasDamagedThisTurn;
    }
    case "cards_put_into_discard_this_turn_atleast": {
      // Set-12 Madrigal discard theme: Helga Sinclair, Kida, Kashekim, Lyle.
      const count = state.players[controllingPlayerId].cardsPutIntoDiscardThisTurn ?? 0;
      return count >= condition.amount;
    }
    case "you_removed_damage_this_turn": {
      // Julieta's Arepas THAT DID THE TRICK — turn-wide flag ("this turn").
      return !!state.players[controllingPlayerId].youRemovedDamageThisTurn;
    }
    case "last_effect_result": {
      // Ability-local conditional gate: compare the most recently resolved
      // effect's result (state.lastEffectResult) against amount. Used for
      // oracle texts with "this way" semantics — Julieta Madrigal's SIGNATURE
      // RECIPE "If you removed damage this way, you may draw a card" gates
      // on gte 1. Distinct from turn-wide flags like you_removed_damage_this_turn
      // which accumulate across the whole turn.
      const value = state.lastEffectResult ?? 0;
      switch (condition.comparison) {
        case "gte": return value >= condition.amount;
        case "lte": return value <= condition.amount;
        case "gt":  return value >  condition.amount;
        case "lt":  return value <  condition.amount;
        case "eq":  return value === condition.amount;
      }
      return false;
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
    case "played_via_sing": {
      // Mirror of played_via_shift — reads playedViaSing flag set on the
      // song's instance in applyPlayCard. Flag lives long enough to be read
      // during the song's own effect resolution (before leave-play cleanup
      // clears it on the silent play→discard transition).
      const inst = state.cards[sourceInstanceId];
      return inst?.playedViaSing === true;
    }
    case "triggering_card_played_via_sing": {
      if (!triggeringCardInstanceId) return false;
      const inst = state.cards[triggeringCardInstanceId];
      return inst?.playedViaSing === true;
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
      if (condition.metric === "characters_in_play") {
        const count = (pid: PlayerID) =>
          getZone(state, pid, "play").filter((id) => {
            const inst = state.cards[id];
            if (!inst) return false;
            const def = definitions[inst.definitionId];
            return def?.cardType === "character";
          }).length;
        return count(controllingPlayerId) > count(opponent);
      }
      if (condition.metric === "lore") {
        return (state.players[controllingPlayerId]?.lore ?? 0) > (state.players[opponent]?.lore ?? 0);
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
      if (condition.metric === "characters_in_play") {
        const count = (pid: PlayerID) =>
          getZone(state, pid, "play").filter((id) => {
            const inst = state.cards[id];
            if (!inst) return false;
            const def = definitions[inst.definitionId];
            return def?.cardType === "character";
          }).length;
        return count(opponent) > count(controllingPlayerId);
      }
      if (condition.metric === "lore") {
        return (state.players[opponent]?.lore ?? 0) > (state.players[controllingPlayerId]?.lore ?? 0);
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
