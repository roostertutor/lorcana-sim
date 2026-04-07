// =============================================================================
// LORCANA SIMULATOR — CORE TYPES
// =============================================================================
// This file is the single source of truth for all game concepts.
// Every other module imports from here. Think carefully before changing types
// here — it will ripple through the entire engine.
// =============================================================================

// -----------------------------------------------------------------------------
// PRIMITIVES
// -----------------------------------------------------------------------------

export type PlayerID = "player1" | "player2";
export type ZoneName = "deck" | "hand" | "play" | "discard" | "inkwell" | "under";
export type InkColor =
  | "amber"
  | "amethyst"
  | "emerald"
  | "ruby"
  | "sapphire"
  | "steel";
export type CardType = "character" | "action" | "item" | "location";
/** CRD 6.6.1: Unified type for actions that ability modifiers can restrict. */
export type RestrictedAction = "quest" | "challenge" | "ready" | "play" | "sing" | "move";
export type Keyword =
  | "evasive"
  | "rush"
  | "bodyguard"
  | "ward"
  | "reckless"
  | "challenger"
  | "support"
  | "singer"
  | "shift"
  | "resist"
  | "boost";

// -----------------------------------------------------------------------------
// CARD DEFINITIONS
// These are the static blueprints for cards — immutable, loaded from JSON.
// They describe what a card IS, not what state it's in during play.
// -----------------------------------------------------------------------------

/**
 * A single ability on a card. Abilities are data — not code.
 * The engine interprets them through EffectResolvers.
 */
export type Ability =
  | KeywordAbility
  | TriggeredAbility
  | ActivatedAbility
  | StaticAbility;

export interface KeywordAbility {
  type: "keyword";
  keyword: Keyword;
  /** Some keywords have a numeric value, e.g. Challenger +2, Singer 5, Resist +1 */
  value?: number;
}

export interface TriggeredAbility {
  type: "triggered";
  /** CRD 5.2.8: Story Name — the bold ability name on the card */
  storyName?: string;
  /** CRD 5.2.8: The printed rules text for this ability (excluding story name) */
  rulesText?: string;
  /** When does this trigger? */
  trigger: TriggerEvent;
  /** What happens when it triggers? */
  effects: Effect[];
  /** Optional condition that must be true for the trigger to fire */
  condition?: Condition;
  /** CRD 6.1.13: "Once per turn" — ability fires at most once per turn per instance.
   *  Reset at end of turn and when the card leaves play (CRD 7.1.6 — becomes a "new" card). */
  oncePerTurn?: boolean;
}

export interface ActivatedAbility {
  type: "activated";
  /** CRD 5.2.8: Story Name — the bold ability name on the card */
  storyName?: string;
  /** CRD 5.2.8: The printed rules text for this ability (excluding story name) */
  rulesText?: string;
  /** Cost to activate: exert, pay ink, banish, etc. */
  costs: Cost[];
  /** What happens when activated */
  effects: Effect[];
  /** Timing restriction, defaults to "your_turn_main" */
  timing?: AbilityTiming;
  /** Optional condition */
  condition?: Condition;
  /** CRD 6.1.13: "Once per turn" — ability can be activated at most once per turn per instance.
   *  Combine with `condition: { type: "is_your_turn" }` for "once during your turn".
   *  Reset at end of turn and when the card leaves play (CRD 7.1.6). */
  oncePerTurn?: boolean;
}

export interface StaticAbility {
  type: "static";
  /** CRD 5.2.8: Story Name — the bold ability name on the card */
  storyName?: string;
  /** CRD 5.2.8: The printed rules text for this ability (excluding story name) */
  rulesText?: string;
  /** Describes an ongoing effect that modifies game rules */
  effect: StaticEffect;
  /** Optional condition — static only applies while condition is true */
  condition?: Condition;
  /**
   * CRD 6.3-ish: which zones this ability is active in. Defaults to ["play"].
   * Use ["hand"] for Universal Shift / Classification Shift (Baymax, Thunderbolt) where
   * the ability tells you HOW the card may be played. Use ["discard"] for "you may play
   * this from your discard" (Lilo - Escape Artist). Use ["play"] (default) for
   * everything else.
   */
  activeZones?: ZoneName[];
}

// -----------------------------------------------------------------------------
// EFFECTS — What abilities actually do
// -----------------------------------------------------------------------------

export type Effect =
  | DrawEffect
  | DealDamageEffect
  | RemoveDamageEffect
  | BanishEffect
  | ReturnToHandEffect
  | GainLoreEffect
  | GainStatsEffect
  | GainConditionalChallengeBonusEffect
  | MoveCharacterEffect
  | NameACardThenRevealEffect
  | RevealTopConditionalEffect
  | CantBeChallengedTimedEffect
  | PutCardsUnderIntoHandEffect
  | ReturnAllToBottomInOrderEffect
  | PutTopOfDeckUnderEffect
  | CreateCardEffect
  | SearchEffect
  | ChooseEffect
  | ExertEffect
  | GrantKeywordEffect
  | ReadyEffect
  | CantActionEffect
  | LookAtTopEffect
  | DiscardEffect
  | MoveToInkwellEffect
  | ConditionalOnTargetEffect
  | PlayForFreeEffect
  | ShuffleIntoDeckEffect
  | PayInkEffect
  | SequentialEffect
  | CostReductionEffect
  | LoseLoreEffect
  | CreateFloatingTriggerEffect
  | GrantExtraInkPlayEffect
  | GrantChallengeReadyEffect;

/** Grant "can challenge ready characters" for a duration. */
export interface GrantChallengeReadyEffect {
  type: "grant_challenge_ready";
  target: CardTarget;
  duration: EffectDuration;
}

export interface DrawEffect {
  type: "draw";
  amount: number | "X" | "cost_result" | "damage_on_target" | { type: "count"; filter: CardFilter };
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
}

export interface DealDamageEffect {
  type: "deal_damage";
  amount: number | "X" | { type: "count"; filter: CardFilter };
  target: CardTarget;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
}

export interface RemoveDamageEffect {
  type: "remove_damage";
  amount: number;
  target: CardTarget;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
}

export interface BanishEffect {
  type: "banish";
  target: CardTarget;
}

export interface ReturnToHandEffect {
  type: "return_to_hand";
  target: CardTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
}

export interface GainLoreEffect {
  type: "gain_lore";
  /**
   * Amount variants:
   *  - number: literal amount
   *  - { type: "count" }: number of cards matching filter
   *  - "triggering_card_lore": triggering card's printed lore stat (Peter Pan Lost Boy Leader —
   *    "gain lore equal to that location's {L}" on moves_to_location)
   *  - "last_target_location_lore": lore stat of the location the most recently chosen target
   *    is at (I've Got a Dream — "Gain lore equal to that location's {L}" after readying a
   *    chosen character at a location).
   */
  amount: number | { type: "count"; filter: CardFilter } | "triggering_card_lore" | "last_target_location_lore";
  target: PlayerTarget;
}

export interface GainStatsEffect {
  type: "gain_stats";
  strength?: number;
  willpower?: number;
  lore?: number;
  target: CardTarget;
  /**
   * "this_turn" = wears off at end of current turn (writes to tempStrengthModifier directly).
   * "permanent" = stays for the rest of the game.
   * EffectDuration values ("end_of_turn", "rest_of_turn", "end_of_owner_next_turn") use the
   * timedEffects mechanism so the bonus expires correctly across turn boundaries
   * (Cogsworth Majordomo, Lost in the Woods).
   */
  duration: "this_turn" | "permanent" | EffectDuration;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** +1 strength per damage on target (Sword in the Stone) */
  strengthPerDamage?: boolean;
}

/**
 * "Put the top card of [your] deck under this card facedown" — the same
 * mechanism as Boost (CRD 8.4.1) but as a triggered effect rather than a
 * pay-N player action. Used by Graveyard of Christmas Future
 * ("Whenever you move a character here, put the top card of your deck
 * under this location facedown.").
 */
export interface PutTopOfDeckUnderEffect {
  type: "put_top_of_deck_under";
  /** Which card receives the new under-card. "this" = the source instance. */
  target: { type: "this" };
}

/**
 * "Put all matching cards on the bottom of their players' decks in any order"
 * (Under the Sea: opposing characters with strength ≤ 2). The CONTROLLER picks
 * the order — surfaces a choose_order pendingChoice when 2+ matches exist.
 * Each card moves to the bottom of its OWN owner's deck.
 */
export interface ReturnAllToBottomInOrderEffect {
  type: "return_all_to_bottom_in_order";
  filter: CardFilter;
}

/**
 * CRD 8.4.2 / 8.10.5: "Put all cards from under [this] into your hand"
 * (Alice - Well-Read Whisper, Graveyard of Christmas Future, etc.).
 * Moves every instanceId in the source's cardsUnder pile to its owner's hand
 * and clears cardsUnder. The source itself stays in play.
 */
export interface PutCardsUnderIntoHandEffect {
  type: "put_cards_under_into_hand";
  /** Which card's under-pile to drain. "this" = the source instance. */
  target: { type: "this" };
  /** CRD 6.1.4: player may choose not to apply this effect. When part of a
   *  triggered ability with multiple effects (Graveyard of Christmas Future:
   *  "may put all cards... If you do, banish this location") the may gates the
   *  whole sequence — declining skips both this and any subsequent effects. */
  isMay?: boolean;
}

/**
 * "Chosen character can't be challenged until the start of your next turn."
 * Timed equivalent of CantBeChallengedException — applied as a TimedEffect
 * with the standard EffectDuration values.
 */
export interface CantBeChallengedTimedEffect {
  type: "cant_be_challenged_timed";
  target: CardTarget;
  duration: EffectDuration;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
}

/**
 * "Reveal the top card of your deck. If it [matches], [matchAction]. Otherwise,
 * put it on (top|bottom) of your deck." Common in Sets 5–11.
 *
 * Examples:
 *  - Queen's/King's Sensor Core: matchAction "to_hand", filter Princess|Queen
 *  - Pete - Wrestling Champ: matchAction "play_for_free", filter name "Pete"
 *  - Chief Bogo - Commanding Officer: matchAction "play_for_free", filter cardType character cost≤5
 */
export interface RevealTopConditionalEffect {
  type: "reveal_top_conditional";
  /** Filter the revealed card must match for matchAction to apply. */
  filter: CardFilter;
  /** What to do with the revealed card if it matches. */
  matchAction: "to_hand" | "play_for_free" | "to_inkwell_exerted";
  /** CRD 6.1.4: revealed-and-matched cards are optional (player may decline). */
  isMay?: boolean;
  /** Where to put the revealed card if it does NOT match. Default "top". */
  noMatchDestination?: "top" | "bottom";
  target: PlayerTarget;
}

/**
 * The Sorcerer's Hat: "Name a card, then reveal the top card of your deck.
 * If it's the named card, put that card into your hand. Otherwise, put it on
 * the top of your deck." (i.e. it stays on top — no-op on miss.)
 * Player names a card name (free-form string), then the top card is revealed
 * and compared by definition.name.
 */
export interface NameACardThenRevealEffect {
  type: "name_a_card_then_reveal";
  target: PlayerTarget;
}

/**
 * Move a character of yours to one of your locations as an effect (CRD 4.7).
 * Differs from the MOVE_CHARACTER player action: effects don't pay the location's
 * moveCost and bypass the "drying" / movedThisTurn restrictions, since the ability
 * is the source of the move (e.g. Magic Carpet GLIDING RIDE / FIND THE WAY,
 * Jim Hawkins TAKE THE HELM).
 *
 * Resolution depends on target shapes:
 *  - character "this" + location "triggering_card" — direct (Jim Hawkins TAKE THE HELM)
 *  - character "chosen" + location "chosen" — two stages of choose_target (Magic Carpet)
 */
export interface MoveCharacterEffect {
  type: "move_character";
  /** The character being moved. */
  character: { type: "this" } | { type: "triggering_card" } | { type: "chosen"; filter: CardFilter };
  /** The location being moved to. */
  location: { type: "triggering_card" } | { type: "chosen"; filter: CardFilter };
  /** CRD 6.1.4 */
  isMay?: boolean;
  /** Internal: set during stage 2 of a chosen+chosen flow to carry the chosen character ID
   *  across the second pendingChoice. Not part of the JSON spec — set by the reducer only. */
  _resolvedCharacterInstanceId?: string;
}

/**
 * "Your characters get +N {S} while challenging a [filter] this turn."
 * Adds a turn-scoped conditional challenge bonus on the controlling player.
 * Applied during `performChallenge` only when the defender matches `defenderFilter`.
 * This is the "conditional challenger" pattern — works like the Challenger keyword
 * (only on attack, only against matching defender) but cannot reuse the keyword
 * because Challenger by rule (CRD 4.6.8) does not apply against locations.
 */
export interface GainConditionalChallengeBonusEffect {
  type: "gain_conditional_challenge_bonus";
  strength: number;
  defenderFilter: CardFilter;
  duration: "this_turn";
}

export interface CreateCardEffect {
  type: "create_card";
  /** The cardDefinitionId of the token to create */
  cardDefinitionId: string;
  zone: ZoneName;
  target: PlayerTarget;
}

export interface SearchEffect {
  type: "search";
  filter: CardFilter;
  target: PlayerTarget;
  zone: "deck" | "discard";
  putInto: ZoneName;
}

/** A branching "choose one of" effect */
export interface ChooseEffect {
  type: "choose";
  options: Effect[][];
  count: number;
}

export interface ExertEffect {
  type: "exert";
  target: CardTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** CRD 6.1.3: "up to" — for "exert up to N chosen characters". Engine resolves all for now. */
  isUpTo?: boolean;
  /** Effects to apply to the same target after exerting (e.g. "they can't ready") */
  followUpEffects?: Effect[];
}

export interface GrantKeywordEffect {
  type: "grant_keyword";
  keyword: Keyword;
  value?: number;
  target: CardTarget;
  duration: EffectDuration;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
}

export interface ReadyEffect {
  type: "ready";
  target: CardTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** Effects to apply to the same target after readying (e.g. "they can't quest") */
  followUpEffects?: Effect[];
}

/** Unified "can't do X" timed debuff. Replaces cant_quest, cant_ready, cant_challenge. */
export interface CantActionEffect {
  type: "cant_action";
  action: RestrictedAction;
  target: CardTarget;
  duration: EffectDuration;
}

/**
 * Look at top N cards of deck. Bot resolves automatically:
 * - "one_to_hand_rest_bottom": pick one card (optionally matching filter) to hand, rest to bottom in original order (bot simplification — no user-chosen reorder)
 * - "top_or_bottom": look at one card, put on top or bottom
 * - "reorder": look at N cards, put back in any order (bot uses default order)
 */
export interface LookAtTopEffect {
  type: "look_at_top";
  count: number;
  action: "one_to_hand_rest_bottom" | "top_or_bottom" | "reorder";
  /** Optional filter — only matching cards can go to hand (for "may reveal matching" patterns) */
  filter?: CardFilter;
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
}

/**
 * Each target player chooses and discards cards from hand.
 * amount: "all" discards entire hand (no choice).
 */
export interface DiscardEffect {
  type: "discard_from_hand";
  amount: number | "all";
  target: PlayerTarget;
  /** Who picks what to discard — "target_player" = they choose, "controller" = you choose from their hand,
   *  "random" = engine picks uniformly at random from the eligible hand cards (Bruno reveal, Lady Tremaine, etc.) */
  chooser: "target_player" | "controller" | "random";
  /**
   * Optional filter restricting which hand cards are eligible for discard
   * (e.g. Ursula - Deceiver of All: songs only; Bare Necessities / Mowgli: non-character).
   * If set and no card in hand matches, the effect fizzles per CRD 1.7.7.
   */
  filter?: CardFilter;
}

/**
 * "If target matches condition, apply ifMatch effects, otherwise apply default effects."
 * Used by: Vicious Betrayal (+2/+3), Stolen Scimitar (+1/+2), Poisoned Apple (exert/banish).
 */
export interface ConditionalOnTargetEffect {
  type: "conditional_on_target";
  target: CardTarget;
  /** Effects if target does NOT match condition */
  defaultEffects: Effect[];
  /** Filter to check against the chosen target */
  conditionFilter: CardFilter;
  /** Effects if target DOES match condition */
  ifMatchEffects: Effect[];
}

/** Play a card from hand for free (skip ink payment). */
export interface PlayForFreeEffect {
  type: "play_for_free";
  /**
   * Where to look for the card. Default: "hand".
   * Use "discard" for "play that song again from your discard" (Ursula - Deceiver of All).
   */
  sourceZone?: ZoneName;
  /**
   * If set, skip the choose-from-zone flow and play this specific instance directly.
   * Use { type: "triggering_card" } to replay the card that triggered the ability
   * (Ursula - Deceiver of All). When `target` is set, `filter` is ignored.
   */
  target?: CardTarget;
  /** Filter for which cards can be played when no `target` is given. */
  filter?: CardFilter;
  /** CRD 6.1.4 */
  isMay?: boolean;
  /** Keywords to grant to the played character (e.g. Rush from Gruesome and Grim) */
  grantKeywords?: Keyword[];
  /** If true, banish the played character at end of turn (e.g. Gruesome and Grim) */
  banishAtEndOfTurn?: boolean;
  /**
   * After the play resolves (and any post-resolution discard for actions),
   * put the played card on the bottom of its owner's deck.
   * Used by Ursula - Deceiver of All ("...then put it on the bottom of your deck.").
   */
  thenPutOnBottomOfDeck?: boolean;
}

/** Move a card from one zone into its owner's deck, then shuffle. */
export interface ShuffleIntoDeckEffect {
  type: "shuffle_into_deck";
  target: CardTarget;
  /** CRD 6.1.4 */
  isMay?: boolean;
}

/**
 * Move a card to a player's inkwell.
 * "exerted" = doesn't add available ink this turn (used next turn).
 * Some cards say "facedown" — digital engine ignores that (all inkwell cards are equal).
 */
export interface MoveToInkwellEffect {
  type: "move_to_inkwell";
  /** What to move: chosen card, top of deck, self, etc. */
  target: CardTarget;
  /** If true, enters exerted (no ink this turn). Most effects say "exerted". */
  enterExerted: boolean;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** Source zone to pick from — defaults to "play" if not specified */
  fromZone?: ZoneName;
}

/** CRD 6.1.5: Pay ink as an effect cost (used inside SequentialEffect). */
export interface PayInkEffect {
  type: "pay_ink";
  amount: number;
}

/** Grant extra ink plays this turn (Sail the Azurite Sea). Cleared on PASS_TURN. */
export interface GrantExtraInkPlayEffect {
  type: "grant_extra_ink_play";
  amount: number;
}

/**
 * CRD 6.1.5.1: "[A] to [B]" / "[A]. If you do, [B]" sequential effect.
 * Cost effects must fully resolve before reward effects are applied.
 */
export interface SequentialEffect {
  type: "sequential";
  /** [A] — cost/prerequisite effects. Must fully resolve for [B] to happen. */
  costEffects: Effect[];
  /** [B] — reward effects. Only applied if [A] fully resolves. */
  rewardEffects: Effect[];
  /** CRD 6.1.4: wraps the whole thing in "may" */
  isMay?: boolean;
}


/**
 * "You pay N less for the next [type] you play this turn."
 * Creates a one-shot cost reduction on the controlling player.
 */
export interface CostReductionEffect {
  type: "cost_reduction";
  amount: number | { type: "count"; filter: CardFilter };
  /** Filter for which cards get the discount */
  filter: CardFilter;
}

/**
 * "Each opponent loses N lore." Tracks actual lore lost in lastEffectResult
 * for "[A]. For each lore lost, [B]" patterns (CRD 6.1.5.1).
 */
export interface LoseLoreEffect {
  type: "lose_lore";
  amount: number;
  target: PlayerTarget;
}

/** CRD 6.2.7.1: Create a floating triggered ability that lasts until end of turn. */
export interface CreateFloatingTriggerEffect {
  type: "create_floating_trigger";
  trigger: TriggerEvent;
  effects: Effect[];
}

// -----------------------------------------------------------------------------
// STATIC EFFECTS — Ongoing, passive modifications to game rules
// -----------------------------------------------------------------------------

export type StaticEffect =
  | GainKeywordStatic
  | ModifyStatStatic
  | ModifyStatPerCountStatic
  | ModifyStatPerDamageStatic
  | ModifyStatWhileChallengedStatic
  | CantBeChallengedException
  | CostReductionStatic
  | ActionRestrictionStatic
  | ExtraInkPlayStatic
  | SelfCostReductionStatic
  | CanChallengeReadyStatic
  | DamageRedirectStatic
  | ChallengeDamageImmunityStatic
  | GrantActivatedAbilityStatic
  | CantActionSelfStatic
  | MimicryTargetSelfStatic
  | UniversalShiftSelfStatic
  | ClassificationShiftSelfStatic
  | PlayableFromZoneSelfStatic
  | ModifyWinThresholdStatic
  | SkipDrawStepSelfStatic
  | TopOfDeckVisibleStatic
  | MoveToSelfCostReductionStatic;

/**
 * Jolly Roger - Hook's Ship: "Your Pirate characters may move here for free."
 * Applies when a character matching `filter` would move TO the source location.
 * Reduces the move cost by `amount` (or to 0 if "all"). The filter typically
 * narrows by trait (Pirate, Dwarf, etc.) and owner (self).
 */
export interface MoveToSelfCostReductionStatic {
  type: "move_to_self_cost_reduction";
  /** How much to reduce the move cost. Use a large number (or specifically the
   *  location's moveCost) to make it free. */
  amount: number | "all";
  /** Which characters get the discount when moving here. */
  filter: CardFilter;
}

/**
 * Merlin's Cottage - The Wizard's Home (Set 5): "KNOWLEDGE IS POWER Each
 * player plays with the top card of their deck face up." Pure visibility
 * modifier — no gameplay-state change in the engine (the engine is already
 * all-knowing). The UI consults gameModifiers.topOfDeckVisible to render the
 * affected players' deck-top card face-up.
 */
export interface TopOfDeckVisibleStatic {
  type: "top_of_deck_visible";
  /** Whose top card is exposed. Use "both" for Merlin's Cottage; "self" or
   *  "opponent" for future asymmetric variants. */
  affectedPlayer: PlayerTarget;
}

/**
 * Arthur - Determined Squire (Set 8): "NO MORE BOOKS Skip your turn's Draw step."
 * While this card is in play, the owner skips the draw step at the start of their turn.
 */
export interface SkipDrawStepSelfStatic {
  type: "skip_draw_step_self";
}

/**
 * Donald Duck - Flustered Sorcerer (Set 7): "OBFUSCATE! Opponents need 25 lore
 * to win the game." Modifies the lore threshold for `affectedPlayer` (typically
 * "opponent" — meaning the player who is NOT the source's owner).
 */
export interface ModifyWinThresholdStatic {
  type: "modify_win_threshold";
  /** Whose threshold is changed, from the source's owner perspective */
  affectedPlayer: PlayerTarget;
  /** New threshold value (e.g. 25) */
  newThreshold: number;
}

/**
 * MIMICRY (Morph - Space Goo, Set 3): any character with Shift may shift onto this
 * card regardless of name. Lives on the in-PLAY target. activeZones defaults to ["play"].
 */
export interface MimicryTargetSelfStatic {
  type: "mimicry_target_self";
}

/**
 * Universal Shift (Baymax, Set 7+): this card with Shift may shift onto ANY
 * character of yours regardless of name. Lives on the in-HAND shifter — the
 * static must declare activeZones: ["hand"] so the scanner picks it up while
 * the card is still in hand at validation time.
 */
export interface UniversalShiftSelfStatic {
  type: "universal_shift_self";
}

/**
 * Classification / Puppy Shift (Thunderbolt, Set 8): this card with Shift may
 * shift onto any character of yours that has the named trait. Lives on the
 * in-HAND shifter — declare activeZones: ["hand"].
 */
export interface ClassificationShiftSelfStatic {
  type: "classification_shift_self";
  trait: string;
}

/**
 * "You may play this card from {zone}" (Lilo - Escape Artist Set 6 — discard).
 * Lives on the source instance and is active in that zone — declare
 * activeZones: [zone] so validatePlayCard's zone check consults it.
 */
export interface PlayableFromZoneSelfStatic {
  type: "playable_from_zone_self";
  zone: ZoneName;
}

/**
 * Permanent self-restriction: this character can't perform `action`.
 * Used for cards like Maui - Whale ("This character can't ready at the start of your turn").
 * Differs from CantActionEffect (a one-shot timed debuff applied to a target) — this is a
 * static, never-expiring restriction tied to the source instance.
 */
export interface CantActionSelfStatic {
  type: "cant_action_self";
  action: RestrictedAction;
}

/** This character can challenge ready (non-exerted) characters. */
export interface CanChallengeReadyStatic {
  type: "can_challenge_ready";
  target: CardTarget;
}

/**
 * CRD 6.5: Replacement effect — "Whenever one of your other characters would be
 * dealt damage, put that many damage counters on this character instead."
 * Only Beast - Selfless Protector uses this currently.
 */
export interface DamageRedirectStatic {
  type: "damage_redirect";
  /** Which characters' damage gets redirected ("other own characters" = all others you control) */
  from: CardTarget;
}

/**
 * Raya - Leader of Heart: "Whenever this character challenges a damaged character,
 * she takes no damage from the challenge."
 * Checked in applyChallenge — if attacker has this and defender matches filter, skip attacker damage.
 */
export interface ChallengeDamageImmunityStatic {
  type: "challenge_damage_immunity";
  /** Only immune when challenging characters matching this filter */
  targetFilter?: CardFilter;
}

/**
 * Cogsworth - Talking Clock: "Your characters with Reckless gain '{E} — Gain 1 lore.'"
 * Grants an activated ability to matching characters in play.
 */
export interface GrantActivatedAbilityStatic {
  type: "grant_activated_ability";
  target: CardTarget;
  ability: ActivatedAbility;
}

export interface GainKeywordStatic {
  type: "grant_keyword";
  keyword: Keyword;
  value?: number;
  target: CardTarget;
}

export interface ModifyStatStatic {
  type: "modify_stat";
  stat: "strength" | "willpower" | "lore";
  modifier: number;
  target: CardTarget;
}

/**
 * "+N stat per matching card" — flexible per-count bonus.
 * Examples: Jafar (+1 STR per card in hand), Tamatoa (+1 lore per item in play),
 * future sets: "+1 STR per card in opponent's hand", "+1 STR per card in discard"
 */
export interface ModifyStatPerCountStatic {
  type: "modify_stat_per_count";
  stat: "strength" | "willpower" | "lore";
  /** Bonus per matching card */
  perCount: number;
  /** What to count. Required unless countCardsUnderSelf is set. */
  countFilter?: CardFilter;
  /**
   * CRD 8.4.2: instead of countFilter, count cards under the source instance
   * (Boost / Shift base pile). Used for "+1 {S} for each card under him".
   */
  countCardsUnderSelf?: boolean;
  /** Who this bonus applies to (usually "this") */
  target: CardTarget;
}

/**
 * "+N stat per 1 damage on this card" — Donald Duck - Not Again! pattern.
 * Computed dynamically based on current damage counters.
 */
export interface ModifyStatPerDamageStatic {
  type: "modify_stat_per_damage";
  stat: "strength" | "willpower" | "lore";
  /** Bonus per damage counter on this card */
  perDamage: number;
  target: CardTarget;
}

/**
 * "While being challenged, this character gets +N {stat}."
 * Only applies during challenge damage calculation — not an always-on modifier.
 */
export interface ModifyStatWhileChallengedStatic {
  type: "modify_stat_while_challenged";
  stat: "strength" | "willpower";
  modifier: number;
}

export interface CantBeChallengedException {
  type: "cant_be_challenged";
  target: CardTarget;
  /** If set, only attackers matching this filter are blocked (Captain Hook: cost ≤ 3 can't challenge this) */
  attackerFilter?: CardFilter;
}


/** Static cost reduction (Mickey Wayward Sorcerer: Broom chars cost 1 less). */
export interface CostReductionStatic {
  type: "cost_reduction";
  amount: number;
  /** Filter for which cards get the discount */
  filter: CardFilter;
}

/**
 * Unified action restriction static.
 * Covers: "opposing characters can't quest" (Gothel),
 * "characters with cost ≤ N can't challenge your characters" (Gantu),
 * and future "can't play", "can't sing", etc.
 */
export interface ActionRestrictionStatic {
  type: "action_restriction";
  /** Which action is restricted */
  restricts: RestrictedAction;
  /** Which player's characters are restricted (from the card owner's perspective) */
  affectedPlayer: PlayerTarget;
  /** Optional: only characters matching this filter are restricted */
  filter?: CardFilter;
}

/** Allow one extra ink play per turn (Belle - Strange but Special). */
export interface ExtraInkPlayStatic {
  type: "extra_ink_play";
  amount: number;
}

/**
 * CRD 6.1.12: Self-cost-reduction — applies from hand, not play.
 * "If [condition], you pay N less to play this card."
 * Checked at play time on the card itself. Condition is on the parent StaticAbility.
 */
export interface SelfCostReductionStatic {
  type: "self_cost_reduction";
  amount: number;
}

// -----------------------------------------------------------------------------
// TARGETS — Who/what an effect points at
// -----------------------------------------------------------------------------

export type PlayerTarget =
  | { type: "self" }
  | { type: "opponent" }
  | { type: "both" }
  | { type: "choosing_player" }
  | { type: "target_owner" }
  /** "Chosen player" — controller picks any player. Surfaces a choose_player
   *  pendingChoice. Set excludeSelf for "chosen opponent" patterns (in 2P this
   *  collapses to a single valid target → auto-resolves; in 3+P it'd genuinely
   *  prompt the controller to pick among opponents).
   *  Used by Second Star to the Right ("Chosen player draws 5 cards"),
   *  Mad Hatter, Madame Medusa, Water Has Memory, Copper Hound Pup, etc. */
  | { type: "chosen"; excludeSelf?: boolean };

export type CardTarget =
  | { type: "this" } // The card itself
  | { type: "chosen"; filter: CardFilter; count?: number } // Player picks count card(s) (default 1)
  | { type: "all"; filter: CardFilter } // All matching cards
  | { type: "random"; filter: CardFilter } // Random matching card
  | { type: "triggering_card" }; // The card that caused the trigger

export interface CardFilter {
  owner?: PlayerTarget;
  zone?: ZoneName | ZoneName[];
  cardType?: CardType[];
  inkColors?: InkColor[];
  hasTrait?: string;
  /** Match cards that have ANY of these traits */
  hasAnyTrait?: string[];
  hasKeyword?: Keyword;
  isExerted?: boolean;
  costAtMost?: number;
  costAtLeast?: number;
  /** Exclude a specific card instance (e.g. Support can't target itself) */
  excludeInstanceId?: string;
  /** Exclude the source card (for "other" effects — resolved at runtime) */
  excludeSelf?: boolean;
  /** Match by card name (e.g. "Fire the Cannons!", "Te Kā") */
  hasName?: string;
  /** Match characters with damage > 0 */
  hasDamage?: boolean;
  /** Match characters with effective strength ≤ N */
  strengthAtMost?: number;
  /** Match characters with effective strength ≥ N */
  strengthAtLeast?: number;
  /** Match characters that were challenged this turn */
  challengedThisTurn?: boolean;
  /** CRD 5.6.4: Match characters currently at the source location ("while here")
   *  or at any location ("while at a location"). */
  atLocation?: "this" | "any";
}

// -----------------------------------------------------------------------------
// COSTS — What you pay to activate an ability
// -----------------------------------------------------------------------------

export type Cost =
  | { type: "exert" } // Exert this card
  | { type: "pay_ink"; amount: number } // Pay X ink from inkwell
  | { type: "banish_self" } // Banish this card as cost
  | { type: "discard"; filter: CardFilter; amount: number }; // Discard a card

// -----------------------------------------------------------------------------
// TRIGGERS — When triggered abilities fire
// -----------------------------------------------------------------------------

export type TriggerEvent =
  | { on: "enters_play"; filter?: CardFilter }
  | { on: "leaves_play"; filter?: CardFilter }
  | { on: "quests"; filter?: CardFilter }
  | { on: "sings"; filter?: CardFilter }
  | { on: "challenges"; filter?: CardFilter }
  | { on: "is_challenged"; filter?: CardFilter }
  | { on: "is_banished"; filter?: CardFilter }
  | { on: "banished_in_challenge"; filter?: CardFilter }
  | { on: "turn_start"; player: PlayerTarget }
  | { on: "turn_end"; player: PlayerTarget }
  | { on: "card_drawn"; player: PlayerTarget }
  | { on: "ink_played"; player: PlayerTarget }
  | { on: "card_played"; filter?: CardFilter }
  | { on: "item_played"; filter?: CardFilter }
  | { on: "banished_other_in_challenge"; filter?: CardFilter }
  | { on: "damage_dealt_to"; filter?: CardFilter }
  | { on: "moves_to_location"; filter?: CardFilter }
  | { on: "damage_removed_from"; filter?: CardFilter }
  | { on: "readied"; filter?: CardFilter }
  | { on: "returned_to_hand"; filter?: CardFilter }
  | { on: "cards_discarded"; player: PlayerTarget };

// -----------------------------------------------------------------------------
// CONDITIONS — Guards on triggered/activated abilities
// -----------------------------------------------------------------------------

export type Condition =
  | { type: "you_have_lore_gte"; amount: number }
  | { type: "opponent_has_lore_gte"; amount: number }
  | { type: "cards_in_hand_gte"; amount: number; player: PlayerTarget }
  | { type: "card_has_trait"; trait: string }
  | { type: "card_is_type"; cardType: CardType }
  | { type: "characters_in_play_gte"; amount: number; player: PlayerTarget; excludeSelf?: boolean }
  | { type: "cards_in_hand_eq"; amount: number; player: PlayerTarget }
  | { type: "has_character_named"; name: string; player: PlayerTarget }
  | { type: "has_character_with_trait"; trait: string; player: PlayerTarget; excludeSelf?: boolean }
  | { type: "opponent_has_more_cards_in_hand" }
  | { type: "is_your_turn" }
  | { type: "this_is_exerted" }
  | { type: "cards_in_zone_gte"; zone: ZoneName; amount: number; player: PlayerTarget; cardType?: CardType[] }
  | { type: "played_character_with_trait_this_turn"; trait: string }
  | { type: "self_stat_gte"; stat: "strength" | "willpower" | "lore"; amount: number }
  | { type: "compound_and"; conditions: Condition[] }
  | { type: "compound_or"; conditions: Condition[] }
  | { type: "songs_played_this_turn_gte"; amount: number }
  | { type: "actions_played_this_turn_gte"; amount: number }
  | { type: "this_has_no_damage" }
  | { type: "this_at_location" }
  | { type: "this_location_has_character" }
  | { type: "this_has_cards_under" }
  | { type: "your_character_was_damaged_this_turn" }
  | { type: "opponent_character_was_banished_in_challenge_this_turn" }
  | { type: "not"; condition: Condition }
  | { type: "played_via_shift" }
  | { type: "triggering_card_played_via_shift" };

export type AbilityTiming = "your_turn_main" | "any_time" | "opponent_turn";

// -----------------------------------------------------------------------------
// TIMED EFFECTS — Temporary modifiers with explicit expiry
// -----------------------------------------------------------------------------

export type EffectDuration =
  | "end_of_turn"
  | "rest_of_turn"
  /**
   * Expires at the end of the AFFECTED CARD'S OWNER'S next turn (CRD wording
   * "during their next turn" / "at the start of their next turn").
   * Use for opponent-targeting "they can't ready / they're Reckless next turn"
   * patterns: Elsa Spirit of Winter, Iago, Jasper, Anna Heir, etc.
   */
  | "end_of_owner_next_turn"
  /**
   * Expires when the EFFECT'S CASTER starts their next turn (CRD wording
   * "until the start of your next turn"). Tracks the controlling player at
   * cast time via TimedEffect.casterPlayerId. Correct in 2P AND 3+P.
   * Use for "your characters gain X / chosen character gets X until your next
   * turn": Mouse Armor, Four Dozen Eggs, Cogsworth Majordomo, Dodge, etc.
   * Note: in 2P self-cast cases, end_of_owner_next_turn is BROKEN (it expires
   * at end of caster's own turn = same as this_turn). until_caster_next_turn
   * is the only correct option for caster-anchored "your next turn" effects.
   */
  | "until_caster_next_turn";

export interface TimedEffect {
  type: "grant_keyword" | "modify_strength" | "modify_willpower" | "modify_lore"
    | "cant_action" | "can_challenge_ready" | "cant_be_challenged";
  keyword?: Keyword | undefined;
  value?: number | undefined;       // for keyword values (e.g. Challenger +N)
  amount?: number | undefined;      // for modify_* effects
  /** For cant_action: which action is restricted */
  action?: RestrictedAction | undefined;
  expiresAt: EffectDuration;
  /** Turn number when this effect was applied (for multi-turn expiry) */
  appliedOnTurn: number;
  /** For until_caster_next_turn: the player who applied this effect (the "you"
   *  in "until your next turn"). Required when expiresAt === "until_caster_next_turn". */
  casterPlayerId?: PlayerID;
}

// -----------------------------------------------------------------------------
// CARD DEFINITION — The static blueprint for a card
// -----------------------------------------------------------------------------

export interface CardDefinition {
  /** Unique identifier, used to reference cards in decklists and effects */
  id: string;
  /** Full card name */
  name: string;
  /** Subtitle/version, e.g. "Snow Queen", "Of Motunui" */
  subtitle?: string;
  /** Full display name for UI */
  fullName: string;
  cardType: CardType;
  inkColors: InkColor[];
  /** Ink cost to play */
  cost: number;
  /** Can this card be inked? */
  inkable: boolean;
  /** Classification traits, e.g. ["Hero", "Princess", "Storyborn"] */
  traits: string[];

  // --- Character-only stats ---
  strength?: number;
  willpower?: number;
  /** Lore gained when questing */
  lore?: number;

  // --- Shift ---
  /** If this card has Shift, the ink cost to shift */
  shiftCost?: number;
  /** Cards that count as having additional names for Shift purposes (Turbo, Flotsam & Jetsam).
   *  Stays on CardDefinition because it's a printed-name property, not an ability.
   *  All other shift variants (Universal, MIMICRY, Classification) are now zone-aware
   *  static abilities — see types/index.ts MimicryTargetSelfStatic et al. */
  additionalNames?: string[];
  /** CRD 8.12: Sing Together N — any number of your characters with total cost ≥ N
   *  may exert to sing this song for free. Stays on CardDefinition because it's a
   *  printed cost property, not an ability. Set 4+ songs only. */
  singTogetherCost?: number;

  /** CRD 4.7: Locations — ink a character pays to move here */
  moveCost?: number;

  abilities: Ability[];

  /** CRD 5.4.3: Actions have effects, not abilities. Resolved inline, not through trigger stack. */
  actionEffects?: Effect[];

  /** CRD 5.2.8: The printed rules text on the card (for actions: the full effect text; for characters: all non-keyword ability text) */
  rulesText?: string;
  /** Flavor text for UI display */
  flavorText?: string;
  /** Set identifier, e.g. "TFC", "ROF" */
  setId: string;
  /** Collector number within set */
  number: number;
  /** Rarity */
  rarity: "common" | "uncommon" | "rare" | "super_rare" | "legendary" | "enchanted";
  /** Card art URL from Lorcast API (digital.normal ~480×680px). Optional — not all sets imported with images. */
  imageUrl?: string;
}

// -----------------------------------------------------------------------------
// CARD INSTANCE — A specific copy of a card in a game
// Each instance has a unique ID so we can track "this specific Elsa on the
// board" vs "that other Elsa in hand".
// -----------------------------------------------------------------------------

export interface CardInstance {
  /** UUID assigned at game start */
  instanceId: string;
  /** Points back to the static definition */
  definitionId: string;
  /** Resolved from definition at game start, kept here for convenience */
  ownerId: PlayerID;

  // --- Zone tracking ---
  zone: ZoneName;

  // --- In-play state (only relevant when zone === "play") ---
  isExerted: boolean;
  /** Damage counters on the card */
  damage: number;
  /** True when this card entered play this turn (CRD 5.1.1.11 "drying").
   *  Drying characters can't quest, challenge, or exert.
   *  Rush bypasses this for challenges only (CRD 8.9.1). */
  isDrying: boolean;

  // --- Temporary modifiers from effects (cleared at end of turn unless permanent) ---
  tempStrengthModifier: number;
  tempWillpowerModifier: number;
  tempLoreModifier: number;
  /** Keywords granted by effects this turn */
  grantedKeywords: Keyword[];

  /** Timed effects with explicit duration-based expiry */
  timedEffects: TimedEffect[];

  // --- Shift tracking ---
  /** If this card was shifted, the instanceId of the card it shifted onto */
  shiftedOntoInstanceId?: string;
  /** True if this card was played via Shift this turn */
  playedViaShift?: boolean;

  /**
   * CRD 8.10.4 / 8.4.2: instanceIds of cards beneath this card. Sources:
   *  - Shift base cards (CRD 8.10.4): when you shift, the previous version
   *    is placed underneath the shifted character
   *  - Boost (CRD 8.4): once per turn, pay N {I} to put the top card of your
   *    deck facedown under this character
   * Cards under a parent are addressable but not in any zone array. When the
   * parent leaves play, all cards under it go to discard (CRD 8.10.5).
   */
  cardsUnder: string[];

  /** CRD 6.1.13: per-turn flag tracking — extends to Boost ("once during your turn"). */
  boostedThisTurn?: boolean;
  /** True if this character was challenged (as defender) this turn */
  challengedThisTurn?: boolean;
  /** CRD per-turn event flag — true if this card was dealt damage at any point this turn.
   *  Used by event_tracking conditions like "if one of your characters was damaged this turn"
   *  (Devil's Eye Diamond, Brutus - Fearsome Crocodile). Cleared at end of turn. */
  damagedThisTurn?: boolean;

  /** CRD 4.7: instanceId of the location this character is currently at, if any */
  atLocationInstanceId?: string | undefined;
  /** CRD 4.7.4: True if this character has moved to a location this turn */
  movedThisTurn?: boolean | undefined;
  /** CRD 6.1.13: "Once per turn" tracking — keyed by ability storyName.
   *  Cleared at end of turn AND when the card leaves play (CRD 7.1.6 — becomes a "new" card). */
  oncePerTurnTriggered?: Record<string, boolean> | undefined;
}

// -----------------------------------------------------------------------------
// SEEDED RNG STATE — lives in GameState for deterministic replay
// -----------------------------------------------------------------------------

export interface RngState {
  /** 4x 32-bit state for xoshiro128** */
  s: [number, number, number, number];
}

// -----------------------------------------------------------------------------
// GAME STATE — The complete, serializable snapshot of a game at any point
// This is what gets saved, transmitted over network, and used for replays.
// It must be a plain object — no classes, no functions.
// -----------------------------------------------------------------------------

export interface PlayerState {
  id: PlayerID;
  lore: number;
  /** Ink available to spend this turn */
  availableInk: number;
  /** Whether the player has played an ink card this turn */
  hasPlayedInkThisTurn: boolean;
  /** Number of ink plays made this turn (for extra ink play effects) */
  inkPlaysThisTurn?: number;
  /** One-shot cost reductions active this turn */
  costReductions?: CostReductionEntry[];
  /** Extra ink plays granted by effects this turn (cleared on PASS_TURN) */
  extraInkPlaysGranted?: number;
  /** Number of action cards played this turn */
  actionsPlayedThisTurn?: number;
  /** Number of songs played this turn */
  songsPlayedThisTurn?: number;
  /**
   * Conditional challenge strength bonuses active this turn (CRD 6.1.4 / 8.5.1-style).
   * Each entry adds `strength` to any of this player's characters when challenging
   * a defender that matches `defenderFilter`. Cleared at end of turn.
   * Used for "conditional challenger" cards like Olympus Would Be That Way
   * ("+3 {S} while challenging a location this turn"). Behaves like Challenger but
   * targets a non-character defender type, so it can't reuse the keyword.
   */
  turnChallengeBonuses?: TurnChallengeBonus[];
  /** True if any of this player's characters was dealt damage at any point this turn.
   *  Used by Devil's Eye Diamond, Brutus - Fearsome Crocodile. Cleared at PASS_TURN. */
  aCharacterWasDamagedThisTurn?: boolean;
  /** True if any of this player's characters was banished in a challenge this turn.
   *  Used by LeFou - Opportunistic Flunky (checks the opposing player's flag). Cleared at PASS_TURN. */
  aCharacterWasBanishedInChallengeThisTurn?: boolean;
}

export interface TurnChallengeBonus {
  strength: number;
  defenderFilter: CardFilter;
}

/** A cost reduction entry that applies to the next matching card played. */
export interface CostReductionEntry {
  amount: number;
  filter: CardFilter;
}

export interface GameState {
  /** When true, auto-resolve heuristics are disabled — human must make all choices.
   *  Set by createGame when player1IsHuman or player2IsHuman. */
  interactive?: boolean;
  /** Monotonically increasing counter, used for ordering events */
  turnNumber: number;
  currentPlayer: PlayerID;
  phase: GamePhase;
  players: Record<PlayerID, PlayerState>;
  /** All card instances in the game, keyed by instanceId */
  cards: Record<string, CardInstance>;
  /** The order of cards in each zone (zones are ordered) */
  zones: Record<PlayerID, Record<ZoneName, string[]>>; // string[] = instanceIds

  /** Stack of pending triggered abilities waiting to resolve */
  triggerStack: PendingTrigger[];

  /** Pending choice that must be resolved before game can continue */
  pendingChoice: PendingChoice | null;

  /** CRD 4.3.3.2: Action card waiting in play zone while its effect resolves (pending choice) */
  pendingActionInstanceId?: string;

  /** Effects waiting to resolve after a pending choice is resolved */
  pendingEffectQueue?: { effects: Effect[]; sourceInstanceId: string; controllingPlayerId: PlayerID } | undefined;

  /** Seeded PRNG state — advances with every random operation */
  rng: RngState;

  /** Log of all actions taken, useful for UI and debugging */
  actionLog: GameLogEntry[];

  /** CRD 6.2.7.1: Floating triggered abilities that last until end of turn */
  floatingTriggers?: FloatingTrigger[];

  /** Cards to banish at end of turn (e.g., Gruesome and Grim, Madam Mim - Rival of Merlin) */
  pendingEndOfTurnBanish?: string[];

  /** CRD 6.1.5.1: Result of the last cost effect in a sequential (for "[A]. For each X, [B]" patterns) */
  lastEffectResult?: number;

  /** Owner of the last card targeted by a choose_target resolution (for "its player draws" patterns) */
  lastTargetOwnerId?: PlayerID;
  /** Most recently chosen target instance ID — used by gain_lore "from_target_location_lore"
   *  (I've Got a Dream: "Gain lore equal to that location's {L}" where "that" = the
   *  ready target's location). */
  lastTargetInstanceId?: string;

  winner: PlayerID | null;
  isGameOver: boolean;
}

/** CRD 6.2.7.1: A floating triggered ability created by an action card. */
export interface FloatingTrigger {
  trigger: TriggerEvent;
  effects: Effect[];
  controllingPlayerId: PlayerID;
}

export type GamePhase =
  | "mulligan_p1" // CRD 2.2.2: player1 choosing mulligan cards
  | "mulligan_p2" // CRD 2.2.2: player2 choosing mulligan cards
  | "beginning" // Draw + ready step
  | "main" // Play cards, quest, challenge
  | "end"; // End of turn effects

export interface PendingTrigger {
  /** The ability that triggered */
  ability: TriggeredAbility;
  /** The card that owns this ability */
  sourceInstanceId: string;
  /** Context available when resolving */
  context: TriggerContext;
}

export interface TriggerContext {
  triggeringCardInstanceId?: string;
  triggeringPlayerId?: PlayerID;
}

export interface PendingChoice {
  type: "choose_mulligan" | "choose_target" | "choose_option" | "choose_cards" | "choose_may" | "choose_discard" | "choose_from_revealed" | "choose_order" | "choose_trigger" | "choose_card_name" | "choose_player";
  /** Which player must make the choice */
  choosingPlayerId: PlayerID;
  prompt: string;
  /** For choose_target: valid target instanceIds */
  validTargets?: string[];
  /** For choose_from_revealed: all revealed cards (validTargets is the selectable subset) */
  revealedCards?: string[];
  /** For choose_option: the effects to pick between */
  options?: Effect[][];
  /** For choose_cards: card filter and count */
  filter?: CardFilter;
  count?: number;
  /** The effect waiting for this choice to resolve (absent for choose_mulligan) */
  pendingEffect?: Effect;
  /** CRD 6.1.4: player can decline with empty choice */
  optional?: boolean;
  /** For choose_may: the source card's instanceId (needed to resume trigger processing) */
  sourceInstanceId?: string;
  /** For choose_may with sequential effects: the card that triggered the ability (e.g. the card to exert) */
  triggeringCardInstanceId?: string;
  /** Additional effects to apply to the same chosen target(s) after the primary effect resolves */
  followUpEffects?: Effect[] | undefined;
}

export interface GameLogEntry {
  timestamp: number;
  turn: number;
  playerId: PlayerID;
  message: string;
  /** Machine-readable type for filtering/replay */
  type: GameLogEntryType;
}

export type GameLogEntryType =
  | "game_start"
  | "turn_start"
  | "turn_end"
  | "card_drawn"
  | "card_played"
  | "ink_played"
  | "card_quested"
  | "card_challenged"
  | "card_banished"
  | "lore_gained"
  | "ability_triggered"
  | "ability_activated"
  | "effect_resolved"
  | "choice_made"
  | "mulligan"
  | "character_moved"
  | "game_over";

// -----------------------------------------------------------------------------
// ACTIONS — What a player can DO on their turn
// These are dispatched to the engine, which validates and applies them.
// The pattern is similar to Redux actions.
// -----------------------------------------------------------------------------

export type GameAction =
  | PlayCardAction
  | PlayInkAction
  | QuestAction
  | ChallengeAction
  | ActivateAbilityAction
  | PassTurnAction
  | ResolveChoiceAction
  | DrawCardAction // Usually automatic, but exposed for debugging
  | MoveCharacterAction
  | BoostCardAction;

/** CRD 8.4: Boost N {I} — once per turn, pay N {I} to put the top card of your
 *  deck facedown under this character. */
export interface BoostCardAction {
  type: "BOOST_CARD";
  playerId: PlayerID;
  /** The character with Boost being activated */
  instanceId: string;
}

export interface MoveCharacterAction {
  type: "MOVE_CHARACTER";
  playerId: PlayerID;
  characterInstanceId: string;
  locationInstanceId: string;
}

export interface PlayCardAction {
  type: "PLAY_CARD";
  playerId: PlayerID;
  instanceId: string;
  /** For Shift: the instanceId of the character being shifted onto */
  shiftTargetInstanceId?: string;
  /** CRD 5.4.4.2: For singing — the character exerted to pay for this song */
  singerInstanceId?: string;
  /** CRD 8.12: For Sing Together — multiple characters whose combined effective cost
   *  must be ≥ the song's singTogetherCost. Mutually exclusive with singerInstanceId. */
  singerInstanceIds?: string[];
}

export interface PlayInkAction {
  type: "PLAY_INK";
  playerId: PlayerID;
  instanceId: string;
}

export interface QuestAction {
  type: "QUEST";
  playerId: PlayerID;
  instanceId: string;
}

export interface ChallengeAction {
  type: "CHALLENGE";
  playerId: PlayerID;
  /** The attacker (must be unexerted, owned by playerId) */
  attackerInstanceId: string;
  /** The defender (must be exerted, owned by opponent, in play) */
  defenderInstanceId: string;
}

export interface ActivateAbilityAction {
  type: "ACTIVATE_ABILITY";
  playerId: PlayerID;
  instanceId: string;
  abilityIndex: number;
}

export interface PassTurnAction {
  type: "PASS_TURN";
  playerId: PlayerID;
}

export interface ResolveChoiceAction {
  type: "RESOLVE_CHOICE";
  playerId: PlayerID;
  /** instanceIds of chosen targets, index of chosen option, "accept"/"decline" for may, or plain string for choose_trigger */
  choice: string | string[] | number;
}

export interface DrawCardAction {
  type: "DRAW_CARD";
  playerId: PlayerID;
  amount?: number;
}

// -----------------------------------------------------------------------------
// ENGINE RESULT — What the engine returns after processing an action
// -----------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  /** The new game state (even on failure, for debugging) */
  newState: GameState;
  /** Human-readable error if success === false */
  error?: string;
  /** Events that occurred, for animation/sound cues in the UI */
  events: GameEvent[];
}

export type GameEvent =
  | { type: "card_moved"; instanceId: string; from: ZoneName; to: ZoneName }
  | { type: "damage_dealt"; instanceId: string; amount: number }
  | { type: "card_banished"; instanceId: string }
  | { type: "lore_gained"; playerId: PlayerID; amount: number }
  | { type: "card_drawn"; playerId: PlayerID; instanceId: string }
  | { type: "ability_triggered"; instanceId: string; abilityType: string }
  | { type: "turn_passed"; to: PlayerID };
