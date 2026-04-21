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

import type { CardDefinition, CardFilter, GameState, PlayerID, StaticEffect, StaticAbility } from "../types/index.js";
import { evaluateCondition, getZone, matchesFilter } from "../utils/index.js";

/** Normalize StaticAbility.effect (single or array) to a flat array. */
function normalizeEffects(ability: StaticAbility): StaticEffect[] {
  return Array.isArray(ability.effect) ? ability.effect : [ability.effect];
}

/** Unified cost-reduction modifier covering both PLAY and MOVE actions.
 *  Discriminated union so the type checker enforces per-kind invariants. */
export type CostReductionModifier =
  | {
      kind: "play";
      playerId: PlayerID;
      amount: number;
      cardFilter?: CardFilter;
      /** "all" (default) applies to both normal and shift play; "shift_only"
       *  scopes the discount to the Shift cost path (Yokai pattern). */
      appliesTo?: "all" | "shift_only";
      sourceInstanceId?: string;
      oncePerTurnKey?: string;
    }
  | {
      kind: "move";
      playerId: PlayerID;
      /** Number, or "all" to fully waive the move cost (Jolly Roger). */
      amount: number | "all";
      cardFilter?: CardFilter;
      /** When set, only matches when the destination is this exact location
       *  (Jolly Roger). Unset = applies to any location (Map of Treasure
       *  Planet, Raksha). */
      locationInstanceId?: string;
      /** When true, only the source instance benefits (Raksha — only she
       *  herself moves cheaper). Requires `sourceInstanceId`. */
      selfOnly?: boolean;
      sourceInstanceId?: string;
      oncePerTurnKey?: string;
    };

export interface GameModifiers {
  /**
   * Characters that cannot be challenged (or only by certain attackers).
   * Key = instanceId, value = optional attacker filter (undefined = no one can challenge).
   */
  cantBeChallenged: Map<string, import("../types/index.js").CardFilter | undefined>;

  /**
   * Characters that may challenge ready (non-exerted) opponents.
   * Default rule: only exerted characters may be challenged.
   * Value is an optional CardFilter restricting WHICH ready characters
   * the attacker may challenge (Gizmoduck Suited Up: "this character can
   * challenge READY DAMAGED characters" — restricted to defenders matching
   * { hasDamage: true }). When null, the attacker may challenge any ready
   * character (existing semantics).
   */
  canChallengeReady: Map<string, import("../types/index.js").CardFilter | null>;

  /**
   * Per-instance stat bonuses from static abilities (e.g. per-count bonuses).
   * Key = instanceId, value = { strength, willpower, lore } deltas.
   */
  statBonuses: Map<string, { strength: number; willpower: number; lore: number }>;

  /** Keywords granted by conditional static abilities (e.g. Pascal gains Evasive, Cogsworth grants Resist +1). */
  grantedKeywords: Map<string, { keyword: import("../types/index.js").Keyword; value?: number }[]>;

  /** Unified static cost reductions for both PLAY and MOVE actions. One flat
   *  array; consumers filter by `kind` and `playerId`. Replaces the old
   *  parallel `costReductions` (play) + `moveToSelfCostReductions` (move,
   *  per-location) + `globalMoveCostReduction` (move, player-wide) trio.
   *
   *  Play kind (Mickey Mouse Wayward Sorcerer, LeFou static-on-self,
   *  Lantern, Grandmother Willow once-per-turn):
   *  - `appliesTo`: "all" (default) or "shift_only" (Yokai-style).
   *  - `cardFilter`: matches the card being played (undefined = any).
   *
   *  Move kind (Jolly Roger, Map of Treasure Planet, Raksha Fearless Mother):
   *  - `cardFilter`: matches the character being moved (undefined = any).
   *  - `locationInstanceId`: when set, only applies when moving to that exact
   *    location (Jolly Roger). When unset, applies to any destination
   *    (Map of Treasure Planet, Raksha).
   *  - `selfOnly`: when true, only the source instance benefits (Raksha — only
   *    Raksha herself moves cheaper).
   *  - `amount: "all"` waives the move cost entirely (Jolly Roger).
   *
   *  Once-per-turn (both kinds): `sourceInstanceId` + `oncePerTurnKey`.
   *  Consumers set `source.oncePerTurnTriggered[oncePerTurnKey] = true` after
   *  use; `getGameModifiers` skips the entry on the next refresh until the
   *  flag clears at turn start. */
  costReductions: CostReductionModifier[];

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
  challengeDamagePrevention: Map<string, import("../types/index.js").CardFilter | undefined>;

  /**
   * Ongoing damage immunity from static abilities (Baloo Ol' Iron Paws —
   * source "all"; Hercules Mighty Leader — source "non_challenge"). Key =
   * instanceId of the card that IS immune. Value = set of damage sources
   * against which the card is protected. Consulted by the reducer's damage
   * write path (dealDamageToCard for ability damage, applyChallenge for
   * challenge damage).
   */
  damagePrevention: Map<string, Set<"challenge" | "all" | "non_challenge">>;

  /**
   * Charge-based damage immunity (Lilo Bundled Up: "first time would take
   * damage during each opponent's turn, takes no damage instead"). Parallel
   * to damagePrevention but with a per-turn charge limit; consult
   * CardInstance.damagePreventionChargesUsedThisTurn to know if any remain.
   * Key = instanceId, value = max charges per turn (paired with the source
   * tag set in the regular damagePrevention slot).
   */
  damagePreventionCharges: Map<string, number>;

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
   * Bypass costs for restricted actions (RC Remote-Controlled Car "can't quest
   * or challenge unless you pay 1 {I}"). Outer key = instanceId, inner key =
   * action; value = Cost[] that must be paid when taking that action. When
   * present alongside a matching selfActionRestrictions entry, the action is
   * allowed iff the costs are payable. Validator checks + reducer pays the
   * costs at action resolution time.
   */
  selfActionUnlockCosts: Map<string, Map<import("../types/index.js").RestrictedAction, import("../types/index.js").Cost[]>>;

  /**
   * In-hand instances that may be played for free as an alternative play
   * mode (Pudge - Controls the Weather "you can play this character for
   * free"). Populated from `grant_play_for_free_self` static effects whose
   * activeZones include "hand" and whose condition is currently true.
   * The legal-action enumerator surfaces an extra PLAY_CARD variant with
   * the cost forced to 0 for these instances.
   */
  /** Per-instance free-play grants. Value is the playCosts array (null = no
   *  extra costs, unconditional free play like Pudge). */
  playForFreeSelf: Map<string, import("../types/index.js").PlayForFreeCost[] | null>;

  /**
   * In-hand instances with a granted Shift cost (Anna - Soothing Sister
   * "this card gains Shift 0"). Key = instanceId, value = the granted
   * shift cost. validatePlayCard's shift branch reads
   * `def.shiftCost ?? mods.grantedShiftSelf.get(instanceId)` and the
   * legal-action enumerator surfaces shift target variants.
   */
  grantedShiftSelf: Map<string, number>;

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
   * Characters that bypass CRD 5.1.1.11 drying for QUESTS (Dash Parr Lava
   * Runner RECORD TIME — "this character can quest the turn he's played").
   * Parallel to the Rush keyword's challenge-only drying bypass (CRD 8.9.1).
   */
  canQuestTurnPlayed: Set<string>;

  /**
   * Players whose deck-top card is visible to all players (Merlin's Cottage Set 5).
   * Pure information-visibility modifier — engine state doesn't change.
   * The UI consults this to render the deck top face-up.
   */
  topOfDeckVisible: Set<import("../types/index.js").PlayerID>;


  /**
   * Per-player "force enter exerted" filters from EnterPlayExertedStatic.
   * Key = affected player (the player whose newly-played cards are forced
   * exerted). Value = list of filters; if any matches the played card, it
   * enters exerted. The filter's owner field is already resolved against the
   * source's perspective when populating this map.
   */
  enterPlayExerted: Map<import("../types/index.js").PlayerID, import("../types/index.js").CardFilter[]>;

  /**
   * Players whose lore can't be reduced right now (Koda Talkative Cub —
   * "during opponents' turns, you can't lose lore"). The lose_lore handler
   * consults this and short-circuits to a no-op for affected players.
   */
  preventLoreLoss: Set<import("../types/index.js").PlayerID>;

  /**
   * Players whose lore can't be gained right now (Peter Pan Never Land
   * Prankster — "while this character is exerted, each opposing player can't
   * gain lore unless one of their characters has challenged this turn"). The
   * gain_lore handler consults this and short-circuits to a no-op for
   * affected players.
   */
  preventLoreGain: Set<import("../types/index.js").PlayerID>;

  /**
   * Forced-target taunt: when the keyed player enumerates valid targets, if
   * any of the listed instanceIds are in the raw valid set, the choice is
   * narrowed to just those. Used by John Smith Undaunted Protector ("DO YOUR
   * WORST Opponents must choose this character for actions and abilities if
   * able"). Key = the affected player (the OPPONENT of the taunting source).
   */
  forcedTargets: Map<import("../types/index.js").PlayerID, Set<string>>;

  /**
   * Players whose hand can't be discarded right now (Magica De Spell Cruel
   * Sorceress, Kronk Laid Back). The discard_from_hand handler consults this
   * and short-circuits for affected players when the chooser is them.
   */
  preventDiscardFromHand: Set<import("../types/index.js").PlayerID>;

  /** Prince Charming Protector of the Realm: "each turn, only one character
   *  can challenge". Boolean — when true, the validator blocks any challenge
   *  if either player's aCharacterChallengedThisTurn flag is set. */
  oneChallengePerTurnGlobal: boolean;

  /** Moana Curious Explorer: "you can ink cards from your discard". Players
   *  in this set may also use PLAY_INK on cards in their discard pile. */
  inkFromDiscard: Set<import("../types/index.js").PlayerID>;

  /**
   * Players whose newly-inked cards enter the inkwell exerted (Daisy Duck
   * Paranormal Investigator). availableInk is NOT incremented for these adds.
   */
  inkwellEntersExerted: Set<import("../types/index.js").PlayerID>;

  /**
   * Per-location virtual sing-cost bonus for characters at that location
   * (Atlantica Concert Hall — "+2 to sing while here"). Key = location
   * instanceId, value = the bonus added to a singer's effective cost when
   * computing sing eligibility only.
   */
  singCostBonusHere: Map<string, number>;

  /** Record Player HIT PARADE: "Your characters named Stitch count as having
   *  +1 cost to sing songs." Per-character sing cost bonus from statics.
   *  Key = character instanceId, value = bonus amount. */
  singCostBonusCharacters: Map<string, number>;

  /**
   * CRD-style stat floors at printed value (Elisa Maza Transformed Gargoyle —
   * "your characters' {S} can't be reduced below their printed value"). Key =
   * affected instanceId, value = set of stats that may not drop below printed.
   * Consulted by getEffectiveStrength/Willpower/Lore.
   */
  statFloorsPrinted: Map<string, Set<"strength" | "willpower" | "lore">>;

  /**
   * Runtime trait grants — Chief Bogo "DEPUTIZE Your other characters gain the
   * Detective classification". Key = affected instanceId, value = set of
   * granted trait names. Populated in a PRE-PASS during getGameModifiers so
   * that downstream statics filtering by hasTrait (e.g. Judy Hopps Lead
   * Detective's Detective grants) see the deputized characters during the
   * same iteration. Consulted by matchesFilter when an optional `modifiers`
   * arg is passed; consulted by evaluateCondition's trait reads.
   */
  grantedTraits: Map<string, Set<string>>;

  /**
   * Per-instance conditional challenger bonuses — Shenzi Scar's Accomplice
   * "while challenging a damaged character, this character gets +2 {S}".
   * Differs from `turnChallengeBonuses` (which is per-player turn-scoped):
   * this map is per-instance permanent (lives as long as the source static
   * is active). Key = attacker instanceId, value = list of {strength,
   * defenderFilter} entries. Read by performChallenge in addition to
   * turnChallengeBonuses.
   */
  conditionalChallengerSelf: Map<string, Array<{ strength: number; defenderFilter: import("../types/index.js").CardFilter }>>;

  /**
   * Keywords suppressed by remove_keyword statics (Captain Hook Master Swordsman:
   * "Peter Pan loses Evasive"). Key = instanceId, value = set of suppressed keywords.
   * Consulted by hasKeyword / getKeywordValue.
   */
  suppressedKeywords: Map<string, Set<import("../types/index.js").Keyword>>;

  /**
   * Triggered abilities granted by static effects (Flotsam Ursula's Baby:
   * "Your Jetsam characters gain 'banished_in_challenge → return to hand'").
   * Key = instanceId, value = list of granted triggered abilities.
   * The trigger scanner checks these in addition to the card definition's own.
   */
  grantedTriggeredAbilities: Map<string, import("../types/index.js").TriggeredAbility[]>;

  /** Hidden Inkcaster: "All cards in your hand count as having {IW}." */
  allHandInkable: Set<import("../types/index.js").PlayerID>;
  /** Vision Slab: "Damage counters can't be removed." */
  preventDamageRemoval: boolean;
  /** Captain Amelia: keyword granted to other chars only while being challenged. */
  grantKeywordWhileBeingChallenged: Map<string, { keyword: import("../types/index.js").Keyword; value?: number }[]>;

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
    canChallengeReady: new Map(),
    statBonuses: new Map(),
    grantedKeywords: new Map(),
    costReductions: [],
    actionRestrictions: [],
    extraInkPlays: new Map(),
    damageRedirects: new Map(),
    challengeDamagePrevention: new Map(),
    damagePrevention: new Map(),
    damagePreventionCharges: new Map(),
    grantedActivatedAbilities: new Map(),
    selfActionRestrictions: new Map(),
    selfActionUnlockCosts: new Map(),
    playForFreeSelf: new Map(),
    grantedShiftSelf: new Map(),
    mimicryTargets: new Set(),
    universalShifters: new Set(),
    classificationShifters: new Map(),
    loreThresholds: new Map(),
    skipsDrawStep: new Set(),
    canQuestTurnPlayed: new Set(),
    topOfDeckVisible: new Set(),
    enterPlayExerted: new Map(),
    statFloorsPrinted: new Map(),
    singCostBonusHere: new Map(),
    singCostBonusCharacters: new Map(),
    inkwellEntersExerted: new Set(),
    preventLoreLoss: new Set(),
    preventLoreGain: new Set(),
    forcedTargets: new Map(),
    preventDiscardFromHand: new Set(),
    oneChallengePerTurnGlobal: false,
    inkFromDiscard: new Set(),
    grantedTraits: new Map(),
    conditionalChallengerSelf: new Map(),
    suppressedKeywords: new Map(),
    grantedTriggeredAbilities: new Map(),
    allHandInkable: new Set(),
    preventDamageRemoval: false,
    grantKeywordWhileBeingChallenged: new Map(),
  };

  // Pre-pass A: collect grant_trait_static so downstream filters in the main
  // pass (e.g. Judy Hopps Lead Detective's `target.filter.hasTrait: "Detective"`
  // statics) see the granted traits. Chief Bogo - Calling the Shots' DEPUTIZE
  // is the precedent.
  for (const instance of Object.values(state.cards)) {
    const def = definitions[instance.definitionId];
    if (!def) continue;
    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      const effs = normalizeEffects(ability);
      const grantTraitEff = effs.find((e: any) => e.type === "grant_trait_static");
      if (!grantTraitEff) continue;
      const activeZones = ability.activeZones ?? ["play"];
      if (!activeZones.includes(instance.zone)) continue;
      if (ability.condition && !evaluateCondition(ability.condition, state, definitions, instance.ownerId, instance.instanceId, undefined, modifiers.statBonuses)) continue;
      const eff = grantTraitEff;
      const grantTo = (id: string) => {
        let set = modifiers.grantedTraits.get(id);
        if (!set) {
          set = new Set();
          modifiers.grantedTraits.set(id, set);
        }
        set.add(eff.trait);
      };
      if (eff.target.type === "this") {
        grantTo(instance.instanceId);
      } else if (eff.target.type === "all") {
        for (const candidate of Object.values(state.cards)) {
          if (candidate.zone !== "play") continue;
          if (eff.target.filter.excludeSelf && candidate.instanceId === instance.instanceId) continue;
          const candidateDef = definitions[candidate.definitionId];
          if (!candidateDef) continue;
          // Pre-pass uses bare matchesFilter (no modifiers) — trait grants
          // can't depend on OTHER trait grants in the same pass. That would
          // require fixed-point iteration; YAGNI until a card needs it.
          if (matchesFilter(candidate, candidateDef, eff.target.filter, state, instance.ownerId, instance.instanceId)) {
            grantTo(candidate.instanceId);
          }
        }
      }
    }
  }

  // Pre-pass B: collect remove_named_ability suppressions so the main pass can
  // skip suppressed abilities. Angela Night Warrior ETERNAL NIGHT removes
  // STONE BY DAY from all your Gargoyle characters.
  const suppressedAbilities = new Map<string, Set<string>>();
  for (const instance of Object.values(state.cards)) {
    const def = definitions[instance.definitionId];
    if (!def) continue;
    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      const effsB = normalizeEffects(ability);
      const removeNamedEff = effsB.find((e: any) => e.type === "remove_named_ability");
      if (!removeNamedEff) continue;
      const activeZones = ability.activeZones ?? ["play"];
      if (!activeZones.includes(instance.zone)) continue;
      if (ability.condition && !evaluateCondition(ability.condition, state, definitions, instance.ownerId, instance.instanceId, undefined, modifiers.statBonuses)) continue;
      const eff = removeNamedEff;
      const addSuppression = (id: string) => {
        let set = suppressedAbilities.get(id);
        if (!set) {
          set = new Set();
          suppressedAbilities.set(id, set);
        }
        set.add(eff.abilityName);
      };
      if (eff.target.type === "this") {
        addSuppression(instance.instanceId);
      } else if (eff.target.type === "all") {
        for (const candidate of Object.values(state.cards)) {
          if (candidate.zone !== "play") continue;
          const candidateDef = definitions[candidate.definitionId];
          if (!candidateDef) continue;
          if (matchesFilter(candidate, candidateDef, eff.target.filter, state, instance.ownerId, instance.instanceId)) {
            addSuppression(candidate.instanceId);
          }
        }
      }
    }
  }

  // Pre-pass C: collect remove_keyword suppressions. Captain Hook Master
  // Swordsman MAN-TO-MAN: "Characters named Peter Pan lose Evasive."
  for (const instance of Object.values(state.cards)) {
    const def = definitions[instance.definitionId];
    if (!def) continue;
    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      const effsC = normalizeEffects(ability);
      const removeKwEff = effsC.find((e: any) => e.type === "remove_keyword");
      if (!removeKwEff) continue;
      const activeZones = ability.activeZones ?? ["play"];
      if (!activeZones.includes(instance.zone)) continue;
      if (ability.condition && !evaluateCondition(ability.condition, state, definitions, instance.ownerId, instance.instanceId, undefined, modifiers.statBonuses)) continue;
      const eff = removeKwEff;
      const addKeywordSuppression = (id: string) => {
        let set = modifiers.suppressedKeywords.get(id);
        if (!set) {
          set = new Set();
          modifiers.suppressedKeywords.set(id, set);
        }
        set.add(eff.keyword);
      };
      if (eff.target.type === "this") {
        addKeywordSuppression(instance.instanceId);
      } else if (eff.target.type === "all") {
        for (const candidate of Object.values(state.cards)) {
          if (candidate.zone !== "play") continue;
          const candidateDef = definitions[candidate.definitionId];
          if (!candidateDef) continue;
          if (matchesFilter(candidate, candidateDef, eff.target.filter, state, instance.ownerId, instance.instanceId)) {
            addKeywordSuppression(candidate.instanceId);
          }
        }
      }
    }
  }

  // Two-pass processing: unconditional statics first (pass=0), then conditional
  // (pass=1). This ensures self_stat_gte conditions see stat bonuses from
  // unconditional statics like Snowfort's +1 str regardless of iteration order.
  for (let pass = 0; pass < 2; pass++) {
  for (const instance of Object.values(state.cards)) {
    const def = definitions[instance.definitionId];
    if (!def) continue;

    for (const ability of def.abilities) {
      if (ability.type !== "static") continue;
      // Pass 0: unconditional only. Pass 1: conditional only.
      if (pass === 0 && ability.condition) continue;
      if (pass === 1 && !ability.condition) continue;
      // CRD 6.3-ish: an ability functions only in play unless it says otherwise.
      // activeZones declares where this static is active; default is ["play"].
      const activeZones = ability.activeZones ?? ["play"];
      if (!activeZones.includes(instance.zone)) continue;
      // Skip ability if it's been suppressed by a remove_named_ability static.
      if (ability.storyName && suppressedAbilities.get(instance.instanceId)?.has(ability.storyName)) continue;

      // Check condition on static ability (e.g. "while you have a Captain in play")
      // Pass in-progress statBonuses so self_stat_gte sees static strength from
      // other cards (e.g. Snowfort +1 str feeding Lady Decisive Dog's threshold).
      if (ability.condition) {
        if (!evaluateCondition(ability.condition, state, definitions, instance.ownerId, instance.instanceId, undefined, modifiers.statBonuses)) {
          continue;
        }
      }

      // CRD 6.1.13: "Once per turn" static — skip if already used this turn.
      // Grandmother Willow: "Once during your turn, you pay 1 less for the
      // next character." Each copy tracks independently via oncePerTurnTriggered.
      if (ability.oncePerTurn) {
        const key = ability.storyName ?? ability.rulesText ?? "anon";
        if (instance.oncePerTurnTriggered?.[key]) continue;
      }

      // Normalize compound abilities: effect can be a single StaticEffect or an array
      const effects = normalizeEffects(ability);
      for (const effect of effects) {
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
          // Accept both `modifier` (canonical per types/index.ts) and `amount`
          // (used by some agent-wired cards). CRD: both mean the same thing.
          const mod = effect.amount ?? 0;
          if (effect.target.type === "this") {
            addStatBonus(modifiers, instance.instanceId, effect.stat, mod);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              if (effect.target.filter.excludeSelf && candidate.instanceId === instance.instanceId) continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                addStatBonus(modifiers, candidate.instanceId, effect.stat, mod);
              }
            }
          }
          break;
        }


        case "grant_keyword": {
          // Conditional static keyword granting (e.g. Pascal gains Evasive, Cogsworth grants Resist +1)
          // valueDynamic resolves at iteration time and overrides the literal value (Snow White
          // Fair-Hearted: "Resist +1 for each other Knight character you have in play").
          let resolvedValue = effect.value;
          if (effect.valueDynamic !== undefined) {
            const dyn = effect.valueDynamic;
            if (typeof dyn === "object" && dyn !== null && (dyn as any).type === "count") {
              const filt = (dyn as any).filter;
              let n = 0;
              for (const cand of Object.values(state.cards)) {
                if (cand.zone !== "play") continue;
                if (filt?.excludeSelf && cand.instanceId === instance.instanceId) continue;
                const cdef = definitions[cand.definitionId];
                if (!cdef) continue;
                if (matchesFilter(cand, cdef, filt, state, instance.ownerId, instance.instanceId, definitions, modifiers)) n++;
              }
              const max = (dyn as any).max;
              resolvedValue = typeof max === "number" ? Math.min(n, max) : n;
            }
          }
          if (effect.target.type === "this") {
            const existing = modifiers.grantedKeywords.get(instance.instanceId) ?? [];
            existing.push({ keyword: effect.keyword, value: resolvedValue });
            modifiers.grantedKeywords.set(instance.instanceId, existing);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              if (effect.target.filter.excludeSelf && candidate.instanceId === instance.instanceId) continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              // Pass the in-progress modifiers so the filter check sees
              // grant_trait_static grants from the pre-pass (Bogo + Judy
              // interaction: Judy's "your Detective characters get Alert"
              // sees Bogo's deputized characters).
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId, definitions, modifiers)) {
                const existing = modifiers.grantedKeywords.get(candidate.instanceId) ?? [];
                existing.push({ keyword: effect.keyword, value: resolvedValue });
                modifiers.grantedKeywords.set(candidate.instanceId, existing);
              }
            }
          }
          break;
        }

        case "cost_reduction": {
          // Resolve dynamic amount (Owl Island: count of chars at this location)
          let resolvedAmount: number;
          if (typeof effect.amount === "number") {
            resolvedAmount = effect.amount;
          } else if (effect.amount.type === "count") {
            // Count matching instances inline (can't import findMatchingInstances from reducer)
            const countFilter = effect.amount.filter;
            let cnt = 0;
            const countZones = countFilter.zone ? (Array.isArray(countFilter.zone) ? countFilter.zone : [countFilter.zone]) : ["play"];
            const ownerType = countFilter.owner?.type ?? "self";
            const countPlayers = ownerType === "both" ? ["player1", "player2"] as PlayerID[]
              : ownerType === "opponent" ? [instance.ownerId === "player1" ? "player2" : "player1"] as PlayerID[]
              : [instance.ownerId] as PlayerID[];
            for (const pid of countPlayers) {
              for (const z of countZones) {
                for (const id of getZone(state, pid, z as any)) {
                  const inst = state.cards[id];
                  if (!inst) continue;
                  const d = definitions[inst.definitionId];
                  if (!d) continue;
                  if (matchesFilter(inst, d, countFilter, state, instance.ownerId, instance.instanceId)) cnt++;
                }
              }
            }
            resolvedAmount = cnt;
          } else {
            resolvedAmount = 0;
          }
          const oncePerTurnFields = ability.oncePerTurn ? {
            sourceInstanceId: instance.instanceId,
            oncePerTurnKey: ability.storyName ?? ability.rulesText ?? "anon",
          } : {};
          // Determine affected players (Gantu: "each player" = both, negative amount = cost increase)
          const ap = effect.affectedPlayer ?? { type: "self" as const };
          const addForPlayer = (pid: PlayerID) => {
            modifiers.costReductions.push({
              kind: "play",
              playerId: pid,
              amount: resolvedAmount,
              cardFilter: effect.filter,
              appliesTo: effect.appliesTo ?? "all",
              ...oncePerTurnFields,
            });
          };
          if (ap.type === "both") {
            addForPlayer("player1");
            addForPlayer("player2");
          } else if (ap.type === "opponent") {
            addForPlayer(instance.ownerId === "player1" ? "player2" : "player1");
          } else {
            addForPlayer(instance.ownerId);
          }
          break;
        }

        case "action_restriction": {
          const pushRestriction = (pid: import("../types/index.js").PlayerID) => {
            const entry: typeof modifiers.actionRestrictions[number] = {
              restricts: effect.restricts,
              affectedPlayerId: pid,
            };
            if (effect.filter) entry.filter = effect.filter;
            modifiers.actionRestrictions.push(entry);
          };
          if (effect.affectedPlayer.type === "both") {
            pushRestriction("player1");
            pushRestriction("player2");
          } else {
            const affectedPlayerId = effect.affectedPlayer.type === "opponent"
              ? (instance.ownerId === "player1" ? "player2" : "player1")
              : instance.ownerId;
            pushRestriction(affectedPlayerId);
          }
          break;
        }

        case "extra_ink_play": {
          const current = modifiers.extraInkPlays.get(instance.ownerId) ?? 0;
          modifiers.extraInkPlays.set(instance.ownerId, current + effect.amount);
          break;
        }

        case "can_challenge_ready": {
          if (effect.target.type === "this") {
            // Optional defender filter — Gizmoduck Suited Up restricts to
            // damaged defenders. Most cards (Captain Hook Newly Promoted, etc.)
            // pass null = "any ready character".
            const filt = (effect as any).defenderFilter ?? null;
            modifiers.canChallengeReady.set(instance.instanceId, filt);
          }
          break;
        }

        case "restrict_remembered_target_action": {
          // Elsa's Ice Palace ETERNAL WINTER: for each instance id in
          // source.rememberedTargetIds, add the action to that instance's
          // selfActionRestrictions. The location's enters_play trigger seeded
          // rememberedTargetIds via the remember_chosen_target effect; this
          // static reapplies the restriction every gameModifiers call as long
          // as the source is in play.
          const eff = effect as any;
          const remembered = instance.rememberedTargetIds ?? [];
          for (const id of remembered) {
            // Skip if the target instance has left play.
            if (!state.cards[id] || state.cards[id]!.zone !== "play") continue;
            let set = modifiers.selfActionRestrictions.get(id);
            if (!set) {
              set = new Set();
              modifiers.selfActionRestrictions.set(id, set);
            }
            set.add(eff.action);
          }
          break;
        }

        case "conditional_challenger_self": {
          // Shenzi Scar's Accomplice EASY PICKINGS: "while challenging a
          // damaged character, this character gets +2 {S}". Per-instance
          // permanent challenger bonus gated by a defender filter.
          const eff = effect as any;
          const existing = modifiers.conditionalChallengerSelf.get(instance.instanceId) ?? [];
          existing.push({ strength: eff.strength, defenderFilter: eff.defenderFilter });
          modifiers.conditionalChallengerSelf.set(instance.instanceId, existing);
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

        case "can_quest_turn_played": {
          // Dash Parr - Lava Runner (Set 12): this character bypasses the
          // CRD 5.1.1.11 drying block for quests. Target is always `this`.
          modifiers.canQuestTurnPlayed.add(instance.instanceId);
          break;
        }

        case "move_to_self_cost_reduction": {
          // Jolly Roger - Hook's Ship: "Your Pirate characters may move here for free."
          // Stored as a "move" cost reduction keyed on the location's instance —
          // the move-cost path filters entries by locationInstanceId.
          modifiers.costReductions.push({
            kind: "move",
            playerId: instance.ownerId,
            amount: effect.amount,
            cardFilter: effect.filter,
            locationInstanceId: instance.instanceId,
          });
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

        case "cant_action_self": {
          // Maui - Whale: "This character can't ready at the start of your turn."
          // Permanent self-restriction tied to this instance.
          let set = modifiers.selfActionRestrictions.get(instance.instanceId);
          if (!set) {
            set = new Set();
            modifiers.selfActionRestrictions.set(instance.instanceId, set);
          }
          set.add(effect.action);
          // RC Remote-Controlled Car: "unless you pay 1 {I}" — store the
          // unlock cost keyed to this action so the validator can check
          // payability and the reducer can deduct at action time.
          if (effect.unlockCost && effect.unlockCost.length > 0) {
            let actionMap = modifiers.selfActionUnlockCosts.get(instance.instanceId);
            if (!actionMap) {
              actionMap = new Map();
              modifiers.selfActionUnlockCosts.set(instance.instanceId, actionMap);
            }
            actionMap.set(effect.action, effect.unlockCost);
          }
          break;
        }

        case "grant_play_for_free_self": {
          // Pudge / LeFou / Lilo: condition-only free play (no costs).
          // Belle / Scrooge: free play with costs (banish item / exert items).
          // The static lives in HAND (activeZones: ["hand"]); when its
          // condition resolves true the instance is flagged as free-playable
          // with optional costs.
          modifiers.playForFreeSelf.set(instance.instanceId, (effect as any).playCosts ?? null);
          break;
        }

        case "grant_shift_self": {
          // Anna - Soothing Sister: "this card gains Shift N {I}." Adds a
          // granted Shift cost to the in-hand instance. The validator and
          // legal-action enumerator read this in addition to def.shiftCost.
          modifiers.grantedShiftSelf.set(instance.instanceId, effect.value);
          break;
        }

        case "damage_redirect": {
          // CRD 6.5: This character absorbs damage for other own characters
          modifiers.damageRedirects.set(instance.instanceId, instance.ownerId);
          break;
        }

        case "challenge_damage_prevention": {
          // Raya - Leader of Heart: immune to challenge damage vs damaged characters
          modifiers.challengeDamagePrevention.set(instance.instanceId, effect.targetFilter);
          break;
        }

        case "damage_prevention_static": {
          // Baloo Ol' Iron Paws ("your characters with 7 {S} or more can't be
          // dealt damage" — source "all"), Hercules Mighty Leader ("can't be
          // dealt damage unless he's being challenged" — source "non_challenge"),
          // Lilo Bundled Up ("first time would take damage" — chargesPerTurn:1).
          const eff = effect;
          const addPrevention = (id: string) => {
            let set = modifiers.damagePrevention.get(id);
            if (!set) {
              set = new Set();
              modifiers.damagePrevention.set(id, set);
            }
            set.add(eff.source);
            if (eff.chargesPerTurn !== undefined) {
              modifiers.damagePreventionCharges.set(id, eff.chargesPerTurn);
            }
          };
          if (eff.target.type === "this") {
            addPrevention(instance.instanceId);
          } else if (eff.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, eff.target.filter, state, instance.ownerId, instance.instanceId)) {
                addPrevention(candidate.instanceId);
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

        case "remove_named_ability": {
          // Already handled in the pre-pass above; no-op here.
          break;
        }

        case "prevent_lore_loss": {
          // Koda - Talkative Cub. The static lives on the source's owner.
          modifiers.preventLoreLoss.add(instance.ownerId);
          break;
        }

        case "forced_target_priority": {
          // John Smith Undaunted Protector. Adds the source instance to the
          // OPPONENT's forced-target set.
          const opp: PlayerID = instance.ownerId === "player1" ? "player2" : "player1";
          const existing = modifiers.forcedTargets.get(opp) ?? new Set<string>();
          existing.add(instance.instanceId);
          modifiers.forcedTargets.set(opp, existing);
          break;
        }

        case "prevent_lore_gain": {
          // Peter Pan Never Land Prankster. Resolve affectedPlayer relative
          // to the source's owner.
          const ap = effect.affectedPlayer;
          if (ap.type === "self") modifiers.preventLoreGain.add(instance.ownerId);
          else if (ap.type === "opponent") {
            modifiers.preventLoreGain.add(instance.ownerId === "player1" ? "player2" : "player1");
          } else if (ap.type === "both") {
            modifiers.preventLoreGain.add("player1");
            modifiers.preventLoreGain.add("player2");
          }
          break;
        }

        case "prevent_discard_from_hand": {
          // Magica De Spell Cruel Sorceress, Kronk Laid Back.
          modifiers.preventDiscardFromHand.add(instance.ownerId);
          break;
        }

        case "one_challenge_per_turn_global": {
          // Prince Charming Protector of the Realm.
          modifiers.oneChallengePerTurnGlobal = true;
          break;
        }

        case "ink_from_discard": {
          // Moana Curious Explorer.
          modifiers.inkFromDiscard.add(instance.ownerId);
          break;
        }

        case "inkwell_enters_exerted": {
          // Daisy Duck Paranormal Investigator — affected players' newly-inked
          // cards enter exerted. Resolve PlayerTarget against the source's owner.
          if (effect.affectedPlayer.type === "self") {
            modifiers.inkwellEntersExerted.add(instance.ownerId);
          } else if (effect.affectedPlayer.type === "opponent") {
            modifiers.inkwellEntersExerted.add(instance.ownerId === "player1" ? "player2" : "player1");
          } else if (effect.affectedPlayer.type === "both") {
            modifiers.inkwellEntersExerted.add("player1");
            modifiers.inkwellEntersExerted.add("player2");
          }
          break;
        }

        case "sing_cost_bonus_here": {
          // Atlantica Concert Hall — characters at this location get +N to
          // their effective cost for sing eligibility only.
          const prev = modifiers.singCostBonusHere.get(instance.instanceId) ?? 0;
          modifiers.singCostBonusHere.set(instance.instanceId, prev + effect.amount);
          break;
        }

        case "sing_cost_bonus_characters": {
          // Record Player HIT PARADE — matching characters get +N cost for singing.
          if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const cDef = definitions[candidate.definitionId];
              if (!cDef) continue;
              if (matchesFilter(candidate, cDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                const prev2 = modifiers.singCostBonusCharacters.get(candidate.instanceId) ?? 0;
                modifiers.singCostBonusCharacters.set(candidate.instanceId, prev2 + effect.amount);
              }
            }
          }
          break;
        }

        case "grant_triggered_ability": {
          // Flotsam OMINOUS PAIR — grant a triggered ability to matching characters.
          if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const cDef = definitions[candidate.definitionId];
              if (!cDef) continue;
              if (matchesFilter(candidate, cDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                const existing = modifiers.grantedTriggeredAbilities.get(candidate.instanceId) ?? [];
                existing.push(effect.ability);
                modifiers.grantedTriggeredAbilities.set(candidate.instanceId, existing);
              }
            }
          }
          break;
        }

        case "all_hand_inkable": {
          // Hidden Inkcaster — all cards in owner's hand count as inkable.
          modifiers.allHandInkable.add(instance.ownerId);
          break;
        }

        case "prevent_damage_removal": {
          // Vision Slab — damage counters can't be removed globally.
          modifiers.preventDamageRemoval = true;
          break;
        }

        case "global_move_cost_reduction": {
          // Map of Treasure Planet — global move cost reduction.
          // Raksha Fearless Mother — selfOnly + oncePerTurn variant.
          const oncePerTurnKey = effect.oncePerTurn
            ? (ability.storyName ?? ability.rulesText ?? "anon")
            : undefined;
          modifiers.costReductions.push({
            kind: "move",
            playerId: instance.ownerId,
            amount: effect.amount,
            cardFilter: effect.filter,
            ...(effect.selfOnly ? { selfOnly: true, sourceInstanceId: instance.instanceId } : {}),
            ...(oncePerTurnKey ? { sourceInstanceId: instance.instanceId, oncePerTurnKey } : {}),
          });
          break;
        }

        case "grant_keyword_while_being_challenged": {
          // Captain Amelia — grant keyword to other own characters while being challenged.
          if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              if (effect.target.filter.excludeSelf && candidate.instanceId === instance.instanceId) continue;
              const cDef = definitions[candidate.definitionId];
              if (!cDef) continue;
              if (matchesFilter(candidate, cDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                const existing = modifiers.grantKeywordWhileBeingChallenged.get(candidate.instanceId) ?? [];
                existing.push({ keyword: effect.keyword, value: effect.value });
                modifiers.grantKeywordWhileBeingChallenged.set(candidate.instanceId, existing);
              }
            }
          }
          break;
        }

        case "stat_floor_printed": {
          // Elisa Maza Transformed Gargoyle — "your characters' {S} can't be
          // reduced below their printed value." Marks affected instances; the
          // floor itself is applied inside getEffectiveStrength/etc.
          const addFloor = (id: string) => {
            let set = modifiers.statFloorsPrinted.get(id);
            if (!set) {
              set = new Set();
              modifiers.statFloorsPrinted.set(id, set);
            }
            set.add(effect.stat);
          };
          if (effect.target.type === "this") {
            addFloor(instance.instanceId);
          } else if (effect.target.type === "all") {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, effect.target.filter, state, instance.ownerId, instance.instanceId)) {
                addFloor(candidate.instanceId);
              }
            }
          }
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
      } // end switch
      } // end for (const effect of effects)
    }
  }
  } // end two-pass (unconditional then conditional)

  // Turn-scoped granted activated abilities (Food Fight!, Donald Duck Coin
  // Collector, Walk the Plank!): merge per-player timed grants into the same
  // grantedActivatedAbilities map. Each entry's filter is matched against
  // that player's in-play cards.
  for (const playerId of ["player1", "player2"] as PlayerID[]) {
    const grants = state.players[playerId].timedGrantedActivatedAbilities ?? [];
    if (grants.length === 0) continue;
    for (const candidate of Object.values(state.cards)) {
      if (candidate.zone !== "play" || candidate.ownerId !== playerId) continue;
      const candidateDef = definitions[candidate.definitionId];
      if (!candidateDef) continue;
      for (const grant of grants) {
        if (matchesFilter(candidate, candidateDef, grant.filter, state, playerId)) {
          const existing = modifiers.grantedActivatedAbilities.get(candidate.instanceId) ?? [];
          existing.push(grant.ability);
          modifiers.grantedActivatedAbilities.set(candidate.instanceId, existing);
        }
      }
    }
  }

  // Turn-scoped granted TRIGGERED abilities (Hero Work: "Your Hero characters
  // gain '[trigger]' this turn"). Parallel to timedGrantedActivatedAbilities
  // above — same filter-match-and-attach pattern, different ability type.
  // Consumed by the trigger scanner which already reads grantedTriggeredAbilities.
  for (const playerId of ["player1", "player2"] as PlayerID[]) {
    const grants = state.players[playerId].timedGrantedTriggeredAbilities ?? [];
    if (grants.length === 0) continue;
    for (const candidate of Object.values(state.cards)) {
      if (candidate.zone !== "play" || candidate.ownerId !== playerId) continue;
      const candidateDef = definitions[candidate.definitionId];
      if (!candidateDef) continue;
      for (const grant of grants) {
        if (matchesFilter(candidate, candidateDef, grant.filter, state, playerId)) {
          const existing = modifiers.grantedTriggeredAbilities.get(candidate.instanceId) ?? [];
          existing.push(grant.ability);
          modifiers.grantedTriggeredAbilities.set(candidate.instanceId, existing);
        }
      }
    }
  }

  // CRD 6.4.2.1: Apply global timed effects (continuous statics from resolved effects)
  // These affect ALL matching cards, including ones played after the effect resolved.
  if (state.globalTimedEffects) {
    for (const gte of state.globalTimedEffects) {
      switch (gte.type) {
        case "cant_be_challenged": {
          for (const candidate of Object.values(state.cards)) {
            if (candidate.zone !== "play") continue;
            const candidateDef = definitions[candidate.definitionId];
            if (!candidateDef) continue;
            if (matchesFilter(candidate, candidateDef, gte.filter, state, gte.controllingPlayerId)) {
              modifiers.cantBeChallenged.set(candidate.instanceId, undefined);
            }
          }
          break;
        }
        case "cant_action": {
          if (gte.action) {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, gte.filter, state, gte.controllingPlayerId)) {
                modifiers.actionRestrictions.set(candidate.instanceId, [
                  ...(modifiers.actionRestrictions.get(candidate.instanceId) ?? []),
                  gte.action,
                ]);
              }
            }
          }
          break;
        }
        case "grant_keyword": {
          if (gte.keyword) {
            for (const candidate of Object.values(state.cards)) {
              if (candidate.zone !== "play") continue;
              const candidateDef = definitions[candidate.definitionId];
              if (!candidateDef) continue;
              if (matchesFilter(candidate, candidateDef, gte.filter, state, gte.controllingPlayerId)) {
                const existing = modifiers.grantedKeywords.get(candidate.instanceId) ?? [];
                existing.push({ keyword: gte.keyword, value: gte.keywordValue });
                modifiers.grantedKeywords.set(candidate.instanceId, existing);
              }
            }
          }
          break;
        }
        case "modify_stat": {
          for (const candidate of Object.values(state.cards)) {
            if (candidate.zone !== "play") continue;
            const candidateDef = definitions[candidate.definitionId];
            if (!candidateDef) continue;
            if (matchesFilter(candidate, candidateDef, gte.filter, state, gte.controllingPlayerId)) {
              if (gte.strength) addStatBonus(modifiers, candidate.instanceId, "strength", gte.strength);
              if (gte.willpower) addStatBonus(modifiers, candidate.instanceId, "willpower", gte.willpower);
              if (gte.lore) addStatBonus(modifiers, candidate.instanceId, "lore", gte.lore);
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
