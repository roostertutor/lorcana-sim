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

/**
 * A snapshot of a resolved card reference used by multi-step effect resolution.
 * Carries identity + stat snapshot + optional delta so that a follow-up step
 * can reference the "previously resolved" card even if it has since moved zones,
 * had its stats modified, or been partially consumed by an `isUpTo` effect.
 *
 * Built via `makeResolvedRef` in utils. Used for:
 * - `MoveDamageEffect._resolvedSource` / `MoveCharacterEffect._resolvedCharacter`
 *   (stage-2 markers within a single effect)
 * - `GameState.lastResolvedTarget` (cross-effect "its player draws" / "that
 *   location's {L}" carrier)
 * - `GameState.lastResolvedSource` (cost-side resolved snapshot, e.g. Hades
 *   "play a character with the same name as the banished character")
 */
export interface ResolvedRef {
  instanceId: string;
  definitionId: string;
  name: string;
  fullName: string;
  ownerId: PlayerID;
  cost: number;
  /** Effective strength snapshot at resolve time (post-modifiers) */
  strength?: number;
  willpower?: number;
  lore?: number;
  damage?: number;
  /** How many units the previous step actually consumed (for `isUpTo` patterns).
   *  E.g. remove_damage actually-removed count, move_damage actually-moved count. */
  delta?: number;
}
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
export type RestrictedAction =
  | "quest"
  | "challenge"
  /** "can't ready at the start of your turn" — blocks the start-of-turn ready
   *  loop (CRD 3.2.1.1) only, NOT effect-driven readying. Lorcana's "can't ready"
   *  cards are uniformly narrow (Elsa's "can't ready at the start of their next
   *  turn", Maui's "can't ready at the start of your turn"); Shield of Virtue
   *  and similar active-ready effects override the restriction.
   *  If a future card needs a broader "can't be readied period" semantic, add
   *  a new value (e.g. "ready_anywhere") rather than changing this one. */
  | "ready"
  | "play"
  | "sing"
  | "move";
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
  | "boost"
  | "alert"
  /** Vanish (Set 8): "When an opponent chooses this character for an action,
   *  banish them." Implemented as a hardcoded check at choose_target resolve
   *  time — no separate trigger event needed. */
  | "vanish";

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
  /** Multi-fire-per-turn limit (Tod Knows All the Tricks: "twice during your
   *  turn"). When set, the ability fires at most this many times per turn per
   *  instance. Mutually exclusive with oncePerTurn (which is the N=1 case). */
  maxFiresPerTurn?: number;
  /** Which zones this triggered ability is active in. Defaults to ["play"].
   *  Use ["discard"] for cards that fire from discard (Lilo Escape Artist —
   *  "at the start of your turn, if this card is in your discard, you may play her"). */
  activeZones?: ZoneName[];
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
  | DamageImmunityTimedEffect
  | PutCardsUnderIntoHandEffect
  | MoveCardsUnderToInkwellEffect
  | MoveAllMatchingToInkwellEffect
  | PutSelfUnderTargetEffect
  | ReturnAllToBottomInOrderEffect
  | PutTopOfDeckUnderEffect
  | PutOnBottomOfDeckEffect
  | MoveDamageEffect
  | GrantCostReductionEffect
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
  | GrantChallengeReadyEffect
  | RevealHandEffect
  | MillEffect
  | MassInkwellEffect
  | RestrictPlayEffect
  | EachOpponentMayDiscardThenRewardEffect
  | GrantActivatedAbilityTimedEffect
  | FillHandToEffect
  | PlayerMayPlayFromHandEffect
  | ConditionalOnPlayerStateEffect
  | ChosenOpposingMayBottomOrRewardEffect;

/**
 * The Return of Hercules: "Each player may reveal a character card from their
 * hand and play it for free." Each instance handles one player; the action
 * uses two instances (one self, one opponent) to cover both players.
 */
export interface PlayerMayPlayFromHandEffect {
  type: "player_may_play_from_hand";
  /** Whose hand to draw from. "self" / "opponent". */
  player: PlayerTarget;
  /** Filter applied to the hand cards (e.g. cardType:character). */
  filter: CardFilter;
}

/**
 * Desperate Plan: "If you have no cards in your hand, draw until you have 3.
 * Otherwise, choose and discard any number of cards, then draw that many."
 * Branches on a player-state condition. The condition is evaluated against
 * the controlling player at apply time.
 */
export interface ConditionalOnPlayerStateEffect {
  type: "conditional_on_player_state";
  condition: Condition;
  thenEffects: Effect[];
  elseEffects: Effect[];
}

/**
 * Hades - Looking for a Deal: "Choose an opposing character. If you do, draw 2
 * cards unless that character's player puts that card on the bottom of their
 * deck." Caster picks a target; the target's player gets a may to "save" by
 * putting their character on the bottom (deny the caster's reward); on
 * decline, the caster gets the reward.
 */
export interface ChosenOpposingMayBottomOrRewardEffect {
  type: "chosen_opposing_may_bottom_or_reward";
  /** Filter applied at the caster's choose-target step (must be opposing). */
  filter: CardFilter;
  /** Effect the caster gets if the opponent declines to save. */
  rewardEffect: Effect;
}

/**
 * Goliath - Clan Leader (Set 10): "At the end of each player's turn, if they
 * have more than N cards in their hand, they choose and discard cards until
 * they have N. If they have fewer than N cards in their hand, they draw until
 * they have N." Single effect that applies to each affected player and goes
 * either direction based on current hand size.
 */
export interface FillHandToEffect {
  type: "fill_hand_to";
  /** Whose hand to normalize. "self" / "opponent" / "both". */
  target: PlayerTarget;
  /** Target hand size after normalization. */
  n: number;
  /** Only trim down (Prince John's Mirror — "if they have more than N, they
   *  discard until they have N"). When true, no draw-up happens for hands
   *  smaller than n. Default false (bidirectional). */
  trimOnly?: boolean;
}

/**
 * Food Fight!, Donald Duck Coin Collector, Walk the Plank!: "Your [matching]
 * characters gain '<activated ability>' this turn." Pushes a turn-scoped
 * grant onto the controller's PlayerState.timedGrantedActivatedAbilities.
 * Consumed by getGameModifiers which merges these into grantedActivatedAbilities
 * for matching in-play cards. Cleared on PASS_TURN.
 */
export interface GrantActivatedAbilityTimedEffect {
  type: "grant_activated_ability_timed";
  filter: CardFilter;
  ability: ActivatedAbility;
}

/**
 * Sign the Scroll / Ursula's Trickery: "Each opponent may choose and discard a
 * card. For each opponent who doesn't, you {gain 2 lore | draw a card}."
 *
 * 2P implementation: surface a choose_may to the single opponent. On accept,
 * resolve the discard via choose_discard. On decline (or if their hand is
 * empty — auto-decline), apply rewardEffect on behalf of the source's owner.
 *
 * Future 3+P generalization should chain per-opponent prompts and total the
 * refusals; the rewardEffect would then run N times. The current 2P-only
 * version covers Lorcana's existing card pool.
 */
export interface EachOpponentMayDiscardThenRewardEffect {
  type: "each_opponent_may_discard_then_reward";
  rewardEffect: Effect;
}

/**
 * Pete - Games Referee, Keep the Ancient Ways: "Opponents can't play actions
 * [or items] until the start of your next turn." A timed, player-scoped
 * play restriction filtered by card type. Distinct from action_restriction
 * static (lives in play and persists) and from CantActionEffect (instance-
 * scoped). Cleanup happens at the start of the caster's next turn.
 */
export interface RestrictPlayEffect {
  type: "restrict_play";
  /** Which card types are blocked, e.g. ["action"] or ["action","item"]. */
  cardTypes: CardType[];
  /** Whose plays are blocked, from the caster's perspective. Currently only
   *  "opponent" and "self" are used; the resolver expands per-player entries. */
  affectedPlayer: PlayerTarget;
}

/**
 * Mass operations on the inkwell zone.
 *
 * Modes:
 *  - "exert_all": exert every card in the target player's inkwell.
 *      Mufasa - Ruler of Pride Rock (enters_play): "exert all cards in your inkwell"
 *      Ink Geyser: target { type: "both" } — each player exerts their inkwell.
 *  - "ready_all": ready every card in the target player's inkwell.
 *      Mufasa - Ruler of Pride Rock (quests).
 *  - "return_random_to_hand": move N random cards from inkwell to hand.
 *      Mufasa: amount = 2 (always 2). Ink Geyser uses untilCount instead.
 *  - "return_random_until": return random inkwell cards to hand until the
 *      player has at most `untilCount` cards left in inkwell. Triggered only
 *      if their inkwell is currently larger than `untilCount`.
 *      Ink Geyser: untilCount = 3 with target { type: "both" }.
 *
 * The amount field is only used by "return_random_to_hand". The untilCount
 * field is only used by "return_random_until".
 *
 * Note: removing cards from inkwell decrements availableInk if the removed
 * card was unexerted (i.e. still providing ink) — see CRD 4.5 (ink reservoir).
 */
export interface MassInkwellEffect {
  type: "mass_inkwell";
  mode: "exert_all" | "ready_all" | "return_random_to_hand" | "return_random_until";
  /** Whose inkwell. "self" / "opponent" / "both". */
  target: PlayerTarget;
  /** Only for "return_random_to_hand". Number of cards to return. */
  amount?: number;
  /** Only for "return_random_until". Final inkwell size threshold. */
  untilCount?: number;
}

/**
 * CRD: "Put the top N cards of <player>'s deck into their discard."
 * Used by Dale Mischievous Ranger, A Very Merry Unbirthday, Mad Hatter's Teapot,
 * Madame Medusa Diamond Lover. Distinct from `discard_from_hand` — pulls from
 * the top of the deck and queues `cards_discarded` triggers per CRD 6.2.x.
 *
 * Decks may be shorter than `amount` — natural no-op (mill min(amount, deckSize)).
 */
export interface MillEffect {
  type: "mill";
  amount: DynamicAmount;
  /** Whose deck to mill. "self" / "opponent" / "both" / "chosen". */
  target: PlayerTarget;
}

/**
 * "Chosen opponent reveals their hand" / "chosen player reveals their hand"
 * (Dolores Madrigal, Copper - Hound Pup, etc.). In a headless analytics engine
 * the hand is already fully known to the engine, so this effect is a
 * no-op for game state — it emits a `hand_revealed` event for analytics/UI.
 * Cards that combine reveal with a "discard X of your choice" follow-up use
 * the existing `discard_from_hand` effect with `chooser: "controller"` and a
 * filter — no separate sequential reveal step is needed.
 */
export interface RevealHandEffect {
  type: "reveal_hand";
  /** Whose hand is revealed. "opponent" = opponent of controller; "chosen"
   *  surfaces a choose_player pendingChoice (only used when wording says
   *  "chosen player" / "chosen opponent"). */
  target: PlayerTarget;
}

/** Grant "can challenge ready characters" for a duration. */
export interface GrantChallengeReadyEffect {
  type: "grant_challenge_ready";
  target: CardTarget;
  duration: EffectDuration;
}

/**
 * Shared "dynamic amount" shape used by damage/lore/draw/lose-lore effects.
 * A literal number, a well-known keyword string, or an object variant.
 *
 * Object variants:
 *  - { type: "count", filter } — number of cards matching filter, controller-scoped.
 *  - { type: "target_lore", max? } — printed lore of the chosen target card.
 *  - { type: "target_damage", max? } — damage counters on the chosen target.
 *  - { type: "target_strength", max? } — effective strength of the chosen target.
 *  - { type: "source_lore", max? } — printed lore of the SOURCE card (the ability's owner).
 *  - { type: "source_strength", max? } — effective strength of the SOURCE card.
 *
 * `max` caps the resolved value (Mulan Resourceful Recruit: "to a maximum of 6 lore").
 */
export type DynamicAmount =
  | number
  | "X"
  | "cost_result"
  | "damage_on_target"
  | "triggering_card_lore"
  | "triggering_card_damage"
  | "last_target_location_lore"
  /** Actual delta stored on `state.lastResolvedTarget` (remove_damage / move_damage
   *  actually-consumed count). Used by "Gain 1 lore for each 1 damage removed this
   *  way" (Baymax Armored Companion). */
  | "last_resolved_target_delta"
  /** Effective strength snapshot of `state.lastResolvedSource` (cost-side exerted
   *  character). Used by Ambush ("deal damage equal to their {S}"). */
  | "last_resolved_source_strength"
  | { type: "count"; filter: CardFilter; max?: number }
  | { type: "target_lore"; max?: number }
  | { type: "target_damage"; max?: number }
  | { type: "target_strength"; max?: number }
  | { type: "source_lore"; max?: number }
  | { type: "source_strength"; max?: number }
  /** CRD 8.4.2: number of cards in the source's cards-under pile ("for each card
   *  under this character" / "equal to the number of cards under"). Resolved
   *  against the SOURCE instance's `cardsUnder.length`. */
  | { type: "cards_under_count"; max?: number };

export interface DrawEffect {
  type: "draw";
  amount: DynamicAmount;
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
  /**
   * "Draw cards until you have N cards in your hand" (Yzma Conniving Chemist,
   * Desperate Plan) / "until you have the same number as chosen opponent"
   * (Clarabelle Light on Her Hooves, Remember Who You Are).
   *
   * When set, `amount` is ignored and the engine draws cards until the target
   * player's hand size reaches the resolved value. If the hand is already at
   * or above the target, no cards are drawn (natural no-op — no guard needed).
   *
   *  - number: literal target hand size.
   *  - "match_opponent_hand": draw until the target's hand matches the
   *    controller's opponent's hand size (used for "same number as opponent"
   *    wording). Opponent is resolved as the controller's opponent in 2P.
   */
  untilHandSize?: number | "match_opponent_hand";
}

export interface DealDamageEffect {
  type: "deal_damage";
  amount: DynamicAmount;
  target: CardTarget;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
  /**
   * CRD distinction: "put N damage counters on" vs "deal N damage". The former
   * does not fire `damage_dealt_to` triggers and isn't a "dealt damage" event.
   * Used by Queen of Hearts Unpredictable Bully ("put a damage counter on them").
   * When true, the reducer mutates `instance.damage` directly without firing
   * dealt_damage triggers / damage_dealt events.
   */
  asDamageCounter?: boolean;
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
  amount: DynamicAmount;
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
  /** +1 strength per card in the controller's hand (Triton's Trident SYMBOL OF POWER).
   *  Resolved at apply time using the current hand count. */
  strengthPerCardInHand?: boolean;
  /** +S equal to the SOURCE instance's effective strength (Olaf Carrot Enthusiast).
   *  Resolved at apply time per target. */
  strengthEqualsSourceStrength?: boolean;
  /** Internal flag set by the Support trigger synthesis. When true, the
   *  choose_target resolver fires a `chosen_for_support` trigger on the
   *  picked character (Prince Phillip Gallant Defender, Rapunzel Ready for
   *  Adventure). Not part of the JSON spec. */
  _supportRecipientHook?: boolean;
  /**
   * Dynamic strength modifier resolved via DynamicAmount (count-based, etc.).
   * When set, overrides the literal `strength` field. The sign convention is:
   * positive = buff, negative = debuff. Use `strengthDynamicNegate: true` to
   * negate a positive count (Rescue Rangers Away: -S equal to your characters
   * in play → strengthDynamic = { type: "count", filter: own chars },
   * strengthDynamicNegate = true).
   */
  strengthDynamic?: DynamicAmount;
  strengthDynamicNegate?: boolean;
}

/**
 * "You pay N {I} less for the next [filter] you play this turn." Adds a
 * one-shot CostReductionEntry to the controlling player's PlayerState.
 * Used by Gaston Despicable Dealer (next character), Imperial Proclamation
 * (next character — fired by an own-character challenge trigger).
 */
export interface GrantCostReductionEffect {
  type: "grant_cost_reduction";
  amount: number;
  filter: CardFilter;
}

/**
 * CRD 1.9.1.4: "Move N damage counters from chosen character to chosen
 * opposing character." Two-stage chosen flow (source → destination).
 * Used by Belle Untrained Mystic, Rose Lantern, Mystical Rose, etc.
 */
export interface MoveDamageEffect {
  type: "move_damage";
  amount: number;
  /** "up to N" — engine moves min(N, source.damage) */
  isUpTo?: boolean;
  /** Source character (must have damage). */
  source: { type: "chosen"; filter: CardFilter };
  /** Destination character. */
  destination: { type: "chosen"; filter: CardFilter };
  /** Internal: stage-2 marker carrying the resolved source snapshot. */
  _resolvedSource?: ResolvedRef;
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
  /** Which card receives the new under-card.
   *  - "this" = the source instance.
   *  - "chosen" = player picks one of their in-play cards matching the filter
   *    (typical: "one of your characters or locations with Boost"). Used by
   *    Scrooge McDuck Cavern Prospector, Duckworth Ghost Butler, Emily
   *    Quackfaster, Blessed Bagpipes, Minnie Cratchit, Lonely Grave. */
  target: { type: "this" } | { type: "chosen"; filter: CardFilter };
  /** CRD 6.1.4: player may decline. */
  isMay?: boolean;
}

/**
 * Put a card on the bottom of a deck WITHOUT shuffling. Distinct from
 * `shuffle_into_deck` (which mixes the card in randomly) and from
 * `look_at_top` (which moves cards from the top of the deck).
 *
 * Variants:
 *  - from "hand": pick a card from controller's hand (engine auto-picks first
 *    matching the filter — bot simplification, no pendingChoice surfaced).
 *    Used by King Candy SUGAR RUSH ("draw 2, then put a card from your hand
 *    on the bottom").
 *  - from "discard": pick `amount` cards from `ownerScope`'s discard matching
 *    the filter and put them on the bottom of THAT player's deck. Used by
 *    Belle Mechanic, Stegmutt, Anna Soothing Sister, Anna Little Sister,
 *    Kristoff Icy Explorer, etc.
 *  - from "play": chosen character moves to the bottom of its OWNER'S deck.
 *    Used by Wrong Lever!, Do You Want to Build A Snowman?
 *
 * Engine ordering: cards are appended to the end of the deck array via
 * `moveCard(..., "bottom")` — exactly the same path the look_at_top
 * "rest_to_bottom" pattern uses.
 */
export interface PutOnBottomOfDeckEffect {
  type: "put_on_bottom_of_deck";
  /** Source zone of the card(s) being moved. */
  from: "hand" | "discard" | "play";
  /** Whose zone the source comes from. Defaults to "self".
   *  "target_player" surfaces as the controller's choice (Anna Little Sister:
   *  "chosen player's discard"). The engine picks the opponent in 2P. */
  ownerScope?: "self" | "opponent" | "target_player";
  /** CardFilter for selecting eligible cards. */
  filter?: CardFilter;
  /** Number of cards to move. Defaults to 1. */
  amount?: number;
  /** For from "play": chosen character target. */
  target?: CardTarget;
  /** CRD 6.1.4: optional. */
  isMay?: boolean;
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
 * CRD 8.4.2 / 8.10.5: "Put any number of cards from under your characters and
 * locations into your inkwell facedown and exerted" (Visiting Christmas Past).
 * Drains every matching in-play card's `cardsUnder` pile into the controller's
 * inkwell, exerted. The under-cards are the controller's, not the parents'.
 * Headless bot takes all — "any number" collapses to the maximal choice.
 */
export interface MoveCardsUnderToInkwellEffect {
  type: "move_cards_under_to_inkwell";
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply. */
  isMay?: boolean;
}

/**
 * CRD 8.10.5: "Put all <X> cards from your discard into your inkwell facedown
 * and exerted" (Perdita - Determined Mother). Mass move of every card matching
 * `filter` from controller's discard to controller's inkwell, exerted. Bypasses
 * the inkable check (the cards enter facedown).
 */
export interface MoveAllMatchingToInkwellEffect {
  type: "move_all_matching_to_inkwell";
  /** Filter is applied against the controller's discard zone. */
  filter: CardFilter;
  /** CRD 6.1.4: optional may. */
  isMay?: boolean;
}

/**
 * CRD 8.4.2: "Put this character facedown under one of your characters or
 * locations with Boost" (Roo - Little Helper). Source leaves play and becomes
 * a facedown card under the chosen carrier. Surfaces a choose_target on
 * controller's in-play cards matching `filter`.
 */
export interface PutSelfUnderTargetEffect {
  type: "put_self_under_target";
  filter: CardFilter;
  /** CRD 6.1.4: optional may. */
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
 * "<target> takes no damage from challenges [this turn]" / "can't be dealt
 * damage [this turn]" — applied as a TimedEffect with a damageSource tag.
 *
 *  - source: "challenge"     → Noi Acrobatic Baby (on action play), Pirate
 *                              Mickey quest trigger, Nothing We Won't Do.
 *  - source: "all"           → future "can't be dealt damage this turn" wording.
 *  - source: "non_challenge" → reserved for "can't be dealt damage unless being
 *                              challenged" wording applied via a timed effect.
 */
export interface DamageImmunityTimedEffect {
  type: "damage_immunity_timed";
  target: CardTarget;
  source: "challenge" | "all" | "non_challenge";
  duration: EffectDuration;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** Limited charges (Rapunzel Ready for Adventure: "next time they would
   *  be dealt damage they take no damage instead" = 1 charge). When set,
   *  the dealDamageToCard handler consumes a charge per blocked hit and the
   *  effect expires when charges hit 0. */
  charges?: number;
}

/**
 * Ongoing damage immunity static — "Your characters with 7 {S} or more can't
 * be dealt damage" (Baloo Ol' Iron Paws), "This character can't be dealt
 * damage unless he's being challenged" (Hercules Mighty Leader — source
 * "non_challenge"). Scanned in gameModifiers and consulted by the damage
 * write path in the reducer.
 */
export interface DamageImmunityStatic {
  type: "damage_immunity_static";
  source: "challenge" | "all" | "non_challenge";
  target: CardTarget;
  /** Lilo Bundled Up: "during each opponent's turn, the first time this
   *  character would take damage, she takes no damage instead." When set,
   *  the immunity blocks at most N hits per turn (tracked per instance via
   *  CardInstance.damageImmunityChargesUsedThisTurn). Combine with
   *  ability.condition (e.g. not(is_your_turn)) to gate active windows. */
  chargesPerTurn?: number;
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
  /** Only meaningful when matchAction === "play_for_free". When true, the
   *  played card enters play exerted (Oswald Lucky Rabbit FAVORABLE CHANCE
   *  for items). */
  matchEnterExerted?: boolean;
  /** Sisu Uniting Dragon: "If it's a Dragon character card, put it into your
   *  hand and repeat this effect." After a successful match, run the same
   *  reveal again with the new top card. Loops until a non-match. */
  repeatOnMatch?: boolean;
  /** CRD 6.1.4: revealed-and-matched cards are optional (player may decline). */
  isMay?: boolean;
  /** Where to put the revealed card if it does NOT match. Default "top". */
  noMatchDestination?: "top" | "bottom" | "hand" | "discard";
  /**
   * Extra effects to apply when the revealed card matches the filter, in addition
   * to `matchAction`. Example: Bruno Madrigal variants gain 3 lore on match; Sisu
   * reveals another card on match ("repeat this effect" — approximate via repeat).
   * These effects resolve with the revealed card as the triggering card so targets
   * like `triggering_card` work. Applied AFTER matchAction.
   */
  matchExtraEffects?: Effect[];
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
  /** What to do on a match. Default "to_hand" (Sorcerer's Hat). Merlin Clever
   *  Clairvoyant uses "to_inkwell_exerted". "return_all_from_discard" skips the
   *  deck-top reveal entirely and instead returns all character cards in the
   *  caster's discard whose name matches the named card (Blast from Your Past). */
  matchAction?: "to_hand" | "to_inkwell_exerted" | "return_all_from_discard";
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
  /** Internal: set during stage 2 of a chosen+chosen flow to carry the chosen
   *  character snapshot across the second pendingChoice. Not part of the JSON
   *  spec — set by the reducer only. */
  _resolvedCharacter?: ResolvedRef;
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
  /** Number of cards to look at. Accepts a literal or a DynamicAmount
   *  (e.g. `cards_under_count` for Bambi Ethereal Fawn). */
  count: number | DynamicAmount;
  action: "one_to_hand_rest_bottom" | "top_or_bottom" | "reorder" | "up_to_n_to_hand_rest_bottom" | "one_to_inkwell_exerted_rest_top" | "one_to_play_for_free_rest_bottom";
  /** Optional filter — only matching cards can go to hand (for "may reveal matching" patterns) */
  filter?: CardFilter;
  /** For "up_to_n_to_hand_rest_bottom": max number of cards to put into hand (Look at This Family = 2, Dig a Little Deeper = 2). */
  maxToHand?: number;
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
  amount: number | "all" | "any";
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
  /**
   * Generalization to "play a card from a zone" — see card-status `play_for_free` capability.
   * Default "free" preserves the historical behavior; "normal" deducts the card's effective
   * ink cost using the same cost-payment helpers as the standard play action. Used by
   * The Black Cauldron RISE AND JOIN ME! (paid play from the item's cards-under pile).
   */
  cost?: "free" | "normal";
  /** If true, the played card enters play exerted (Lilo Escape Artist —
   *  "she enters play exerted"). */
  enterExerted?: boolean;
  /**
   * Per-instance subzone source. Only meaningful when `sourceZone === "under"`. The
   * source instance's `cardsUnder` array becomes the candidate pool. "self" resolves
   * to the ability source (the card the effect is attached to); a CardTarget allows
   * future cards to point at a different instance.
   */
  sourceInstanceId?: "self" | CardTarget;
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
  amount: number | { type: "count"; filter: CardFilter } | "last_resolved_target_delta";
  /** Filter for which cards get the discount */
  filter: CardFilter;
}

/**
 * "Each opponent loses N lore." Tracks actual lore lost in lastEffectResult
 * for "[A]. For each lore lost, [B]" patterns (CRD 6.1.5.1).
 */
export interface LoseLoreEffect {
  type: "lose_lore";
  amount: DynamicAmount;
  target: PlayerTarget;
}

/** CRD 6.2.7.1: Create a floating triggered ability that lasts until end of turn. */
export interface CreateFloatingTriggerEffect {
  type: "create_floating_trigger";
  trigger: TriggerEvent;
  effects: Effect[];
  /**
   * If "chosen", the floating trigger is attached to a chosen target — surfaces
   * a `choose_target` pendingChoice using `targetFilter`, and the resolved
   * instance is stored on FloatingTrigger.attachedToInstanceId. Used by
   * "Chosen character gains '<floating trigger>' this turn" wording
   * (Bruno Madrigal Out of the Shadows, Medallion Weights).
   * "last_resolved_target" attaches to state.lastResolvedTarget — used by
   * Mother Gothel KWB where a damage cost selects the chosen, then the
   * floating trigger attaches to that same chosen target.
   */
  attachTo?: "self" | "chosen" | "last_resolved_target";
  targetFilter?: CardFilter;
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
  | DamageImmunityStatic
  | GrantActivatedAbilityStatic
  | CantActionSelfStatic
  | MimicryTargetSelfStatic
  | UniversalShiftSelfStatic
  | ClassificationShiftSelfStatic
  | PlayableFromZoneSelfStatic
  | ModifyWinThresholdStatic
  | SkipDrawStepSelfStatic
  | TopOfDeckVisibleStatic
  | MoveToSelfCostReductionStatic
  | EnterPlayExertedStatic
  | StatFloorPrintedStatic
  | SingCostBonusHereStatic
  | InkwellEntersExertedStatic
  | PreventLoreLossStatic
  | RemoveNamedAbilityStatic
  | PreventDiscardFromHandStatic
  | OneChallengePerTurnGlobalStatic
  | InkFromDiscardStatic;

/**
 * Moana - Curious Explorer (Set 11): "ANCESTRAL LEGACY You can ink cards from
 * your discard." Adds the controller's discard zone as a valid source for the
 * PLAY_INK action. Inkable check still applies (CRD 4.2.1).
 */
export interface InkFromDiscardStatic {
  type: "ink_from_discard";
}

/**
 * Prince Charming - Protector of the Realm (Set 10): "Each turn, only one
 * character can challenge." Global limit — applies across both players.
 * Validator gates on: static is active AND any player has already
 * challenged this turn → block.
 */
export interface OneChallengePerTurnGlobalStatic {
  type: "one_challenge_per_turn_global";
}

/**
 * Magica De Spell - Cruel Sorceress, Kronk - Laid Back: "If an effect would
 * cause you to discard one or more cards from your hand, you don't discard."
 * Gated by ability.condition (typically not(is_your_turn)). When active, the
 * controller's hand is shielded from `discard_from_hand` effects with
 * `chooser: "target_player"`.
 */
export interface PreventDiscardFromHandStatic {
  type: "prevent_discard_from_hand";
}

/**
 * Angela - Night Warrior (Set 11): "Your Gargoyle characters lose the Stone
 * by Day ability." Suppresses a named ability on all matching cards. The
 * gameModifiers scanner does a pre-pass to collect suppressions, then skips
 * abilities whose storyName is suppressed for that instance.
 */
export interface RemoveNamedAbilityStatic {
  type: "remove_named_ability";
  abilityName: string;
  target: CardTarget;
}

/**
 * Koda - Talkative Cub (Set 5): "During opponents' turns, you can't lose lore."
 * Gated by ability.condition (e.g. not(is_your_turn)). When active, the
 * controller's lore is shielded from `lose_lore` effects.
 */
export interface PreventLoreLossStatic {
  type: "prevent_lore_loss";
}

/**
 * Daisy Duck - Paranormal Investigator (Set 10): "STRANGE HAPPENINGS While
 * this character is exerted, cards enter opponents' inkwells exerted." A
 * static (gated by ability.condition: this_is_exerted) that flips the
 * affected players' inkwell-add path: newly-inked cards enter exerted and
 * do NOT increment availableInk for that turn.
 */
export interface InkwellEntersExertedStatic {
  type: "inkwell_enters_exerted";
  affectedPlayer: PlayerTarget;
}

/**
 * Atlantica - Concert Hall (Set 4): "UNDERWATER ACOUSTICS Characters count as
 * having +N cost to sing songs while here." A virtual cost bonus that applies
 * only to the sing-eligibility check (CRD 8.11.1) — does NOT change the
 * character's printed cost or its other cost-dependent interactions. The
 * bonus lives on the location and applies to any character whose
 * atLocationInstanceId equals this location.
 */
export interface SingCostBonusHereStatic {
  type: "sing_cost_bonus_here";
  amount: number;
}

/**
 * Elisa Maza - Transformed Gargoyle (Set 11): "FOREVER STRONG Your characters'
 * {S} can't be reduced below their printed value." A floor on the effective
 * stat: after all modifiers are summed, clamp the result to be at least the
 * card's printed (definition) value. Only meaningful when net modifiers would
 * push the stat *below* printed; positive buffs are unaffected.
 */
export interface StatFloorPrintedStatic {
  type: "stat_floor_printed";
  stat: "strength" | "willpower" | "lore";
  target: CardTarget;
}

/**
 * "Opposing characters with Rush enter play exerted" (Jiminy Cricket
 * Level-Headed and Wise) / "Opposing items enter play exerted" (Figaro
 * Tuxedo Cat). The filter is matched against the played card; when a
 * card matches an active static of this type owned by an opponent, it
 * enters play exerted instead of ready.
 */
export interface EnterPlayExertedStatic {
  type: "enter_play_exerted";
  /** Filter for which played cards are forced to enter exerted. The owner
   *  field is interpreted from the SOURCE card's perspective ("opponent" =
   *  cards played by the source's opponent). */
  filter: CardFilter;
}

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
  /** Default "self" — modifies the defender (this card). "attacker" applies the
   *  modifier to the challenging character instead (Louie One Cool Duck:
   *  "the challenging character gets -1 {S}"). */
  affects?: "self" | "attacker";
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
  /** Scope of the discount. Default "all" — both normal play and Shift cost.
   *  "shift_only" — only when paying Shift cost (Yokai Intellectual Schemer
   *  "you pay 1 less to play characters using their Shift ability"). */
  appliesTo?: "all" | "shift_only";
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
  /**
   * Literal number (LeFou: 1 less if Gaston in play), or a DynamicAmount.
   *
   * Per-count wording ("For each X, you pay 1 {I} less") uses
   * `{ type: "count", filter }` with a per-match multiplier via `perMatch`.
   * Example — Kristoff Reindeer Keeper ("For each song in your discard, pay
   * 1 less"): `amount: { type: "count", filter: { cardType: ["action"],
   * hasKeyword: "singer"... zone: "discard", owner: self } }`.
   *
   * For cards that pay 2 less per match (Gaston Pure Paragon, Namaari
   * Resolute Daughter) use `perMatch: 2`.
   */
  amount: DynamicAmount;
  /** Multiplier applied to a `count`-based DynamicAmount. Default 1. */
  perMatch?: number;
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
  /** Player picks count card(s) (default 1). `chooser` defaults to "controller";
   *  set "target_player" for "each opponent chooses one of their characters and X"
   *  patterns (Ursula's Plan, Be King Undisputed, Triton's Decree, Gunther
   *  Interior Designer). The pendingChoice surfaces with the opponent as the
   *  choosing player; the effect then applies to the chosen instance. */
  | { type: "chosen"; filter: CardFilter; count?: number; chooser?: "controller" | "target_player" }
  | { type: "all"; filter: CardFilter } // All matching cards
  | { type: "random"; filter: CardFilter } // Random matching card
  | { type: "triggering_card" } // The card that caused the trigger
  /** The most recently chosen target (state.lastResolvedTarget). Used by
   *  reward effects in a SequentialEffect that need to apply to the same
   *  chosen target the cost step picked — Mother Gothel KWB damages a chosen
   *  character then grants Challenger to that same chosen, etc. Resolves at
   *  effect-application time against state.lastResolvedTarget.instanceId. */
  | { type: "last_resolved_target" };

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
  /** Match cards whose name equals `state.lastResolvedSource.name`. Used by
   *  Hades Double Dealer ("play a character with the same name as the banished
   *  character"). Resolved at match time against the live state. */
  nameFromLastResolvedSource?: boolean;
  /** Match cards whose name equals the source instance's name. Used by
   *  Bad-Anon Villain Support Center grant — Villain characters there can
   *  play a character with the same name as themselves. Resolved against the
   *  source instance ID passed into matchesFilter. */
  nameFromSource?: boolean;
  /** Match characters with damage > 0 */
  hasDamage?: boolean;
  /** Match characters with effective strength ≤ N */
  strengthAtMost?: number;
  /** Match characters with effective strength ≥ N */
  strengthAtLeast?: number;
  /** Match characters that were challenged this turn */
  challengedThisTurn?: boolean;
  /** CRD 8.4.2: Match characters/locations with at least one card in their
   *  cards-under pile ("with a card under them", "while there's a card under"). */
  hasCardUnder?: boolean;
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
// Note: "banish one of your X" cost wording is modeled as a leading effect
// in the activated ability's effects[] array, not a Cost type. The mechanical
// outcome is identical and the existing banish/chosen-target machinery handles it.

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
  | { on: "cards_discarded"; player: PlayerTarget }
  /** CRD 4.3.6: fires when a character deals damage to another character in a challenge.
   * Filter is matched against the source (damage-dealer) card. The triggering card in
   * context is the damaged character, and the damage amount is stored on the trigger context.
   * Used by Mulan - Elite Archer (Triple Shot), Namaari - Heir of Fang (Two-Weapon Fighting). */
  | { on: "deals_damage_in_challenge"; filter?: CardFilter }
  /** CRD 8.4.2: Fires when a card is placed facedown under another card (by the
   *  Boost keyword cost, a put_top_of_deck_under effect, or any other placement
   *  path). Filter matches the CARRIER — the character/location that received
   *  the card. The triggering context carries the carrier as the source and the
   *  under-card as triggeringCardInstanceId. "Whenever you put a card under
   *  one of your characters, draw a card." — Webby's Diary. */
  | { on: "card_put_under"; filter?: CardFilter }
  /** CRD 8.10.4: fires on the previous version of a character that just had
   *  another character shifted onto it. Source is the under card; the
   *  triggering card is the new shifter. Used by Go Go Tomago Mechanical
   *  Engineer ("when you play a Floodborn character on this card"). */
  | { on: "shifted_onto"; filter?: CardFilter }
  /** Fires when a card is selected as the target of a chosen-target effect by
   *  an opposing player. Source is the chosen target; triggering card is the
   *  source of the effect doing the choosing. Used by Archimedes Exceptional
   *  Owl ("Whenever an opponent chooses this character for an action or
   *  ability, you may draw a card") and the Vanish keyword. */
  | { on: "chosen_by_opponent"; filter?: CardFilter }
  /** Fires when a character transitions from unexerted to exerted (via quest,
   *  challenge, sing, activated-ability cost, or `exert` effect). Does NOT
   *  fire for cards entering play exerted, since they're not transitioning.
   *  Source is the exerted character. Used by Te Kā Elemental Terror
   *  ("Whenever an opposing character is exerted, banish them") and Bambi
   *  Ethereal Fawn. */
  | { on: "character_exerted"; filter?: CardFilter }
  /** CRD 8.13: Support — fires on the character chosen to receive a Support
   *  boost. Source is the chosen target; triggering card is the quester whose
   *  Support trigger surfaced the choice. Used by Prince Phillip Gallant
   *  Defender and Rapunzel Ready for Adventure ("Whenever one of your
   *  characters is chosen for Support, ..."). */
  | { on: "chosen_for_support"; filter?: CardFilter };

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
  | { type: "actions_played_this_turn_eq"; amount: number }
  | { type: "this_has_no_damage" }
  | { type: "this_at_location" }
  | { type: "this_location_has_character" }
  /** True if the number of characters (of `player`, default any) at this source
   *  location is >= `amount`. Used by Pride Lands Jungle Oasis
   *  ("While you have 3 or more characters here, …"). */
  | { type: "characters_here_gte"; amount: number; player?: PlayerTarget }
  | { type: "this_has_cards_under" }
  /** CRD 8.4.2: True if the controller has at least one card in play matching
   *  `filter`. Used for "While you have a character or location in play with a
   *  card under them…" (Webby Vanderquack Knowledge Seeker, Flintheart Glomgold,
   *  Kanga Peaceful Gatherer, Lena Sabrewing, Hercules Spectral Demigod).
   *  The filter is evaluated against the controller's play zone; `owner`
   *  defaults to self if unset. */
  | { type: "you_control_matching"; filter: CardFilter }
  | { type: "your_character_was_damaged_this_turn" }
  | { type: "opposing_character_was_damaged_this_turn" }
  | { type: "opponent_character_was_banished_in_challenge_this_turn" }
  | { type: "a_character_was_banished_in_challenge_this_turn" }
  | { type: "not"; condition: Condition }
  | { type: "played_via_shift" }
  | { type: "triggering_card_played_via_shift" }
  /** True if an exerted character is currently at the source location (Ursula's Garden, The Wall). */
  | { type: "this_location_has_exerted_character" }
  /** True if you control a character in play with strictly more `stat` than every opposing character.
   *  Used by Flynn Rider Frenemy ("more strength than each opposing"), Ariel Treasure Collector
   *  ("more items than each opp" → metric="items_in_play"), HeiHei Bumbling Rooster
   *  (metric="cards_in_inkwell"; inverse — opponent has more → use `not`). */
  | { type: "self_has_more_than_each_opponent"; metric: "strength_in_play" | "items_in_play" | "cards_in_inkwell" }
  /** UNDERDOG (Set 11): "If this is your first turn and you're not the first
   *  player, ...". True when the controlling player has not yet completed a
   *  turn AND they are NOT state.firstPlayerId. */
  | { type: "your_first_turn_as_underdog" }
  /** Travelers cycle (P3): "if you played another character this turn".
   *  True when the controller has at least one entry in
   *  charactersPlayedThisTurn whose id is NOT the source instanceId. */
  | { type: "played_another_character_this_turn" }
  /** Set 11 pacifist cycle (Mother's Necklace, John Smith Snow Tracker):
   *  "if none of your characters challenged this turn". True iff the
   *  controller's aCharacterChallengedThisTurn flag is unset/false. */
  | { type: "no_challenges_this_turn" }
  /** Set 11 (Willie the Giant Ghost of Christmas Present): true when this
   *  source instance has had at least one card placed under it this turn. */
  | { type: "this_had_card_put_under_this_turn" }
  /** Chicha Dedicated Mother (Set 5): "if it's the Nth card you've put into
   *  your inkwell this turn". True iff PlayerState.inkPlaysThisTurn equals N. */
  | { type: "ink_plays_this_turn_eq"; amount: number }
  /** Isabela Madrigal Golden Child: "if no other character has quested this
   *  turn". True iff the controller's charactersQuestedThisTurn count is 0
   *  OR the only quester is the source itself. */
  | { type: "no_other_character_quested_this_turn" };

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
    | "cant_action" | "can_challenge_ready" | "cant_be_challenged"
    | "damage_immunity";
  keyword?: Keyword | undefined;
  value?: number | undefined;       // for keyword values (e.g. Challenger +N)
  amount?: number | undefined;      // for modify_* effects
  /** For cant_action: which action is restricted */
  action?: RestrictedAction | undefined;
  /** For damage_immunity: which damage sources the bearer is immune to.
   *  "challenge" — immune only to damage from challenges (Noi, Pirate Mickey).
   *  "all" — immune to every damage source (Baloo static-equivalent, Nothing We Won't Do).
   *  "non_challenge" — immune to ability/action damage, still takes challenge damage (Hercules). */
  damageSource?: "challenge" | "all" | "non_challenge" | undefined;
  expiresAt: EffectDuration;
  /** Turn number when this effect was applied (for multi-turn expiry) */
  appliedOnTurn: number;
  /** For until_caster_next_turn: the player who applied this effect (the "you"
   *  in "until your next turn"). Required when expiresAt === "until_caster_next_turn". */
  casterPlayerId?: PlayerID;
  /** For damage_immunity: limited charges (Rapunzel Ready for Adventure
   *  "next time they would be dealt damage they take no damage instead").
   *  Decremented per blocked hit; the timed effect is dropped when charges
   *  reach 0. Undefined = unlimited (default). */
  charges?: number;
}

// -----------------------------------------------------------------------------
// CARD DEFINITION — The static blueprint for a card
// -----------------------------------------------------------------------------

export interface CardDefinition {
  /** Unique identifier, used to reference cards in decklists and effects */
  id: string;
  /** Full card name */
  name: string;
  /** Additional names this card counts as having (CRD §10.6 reminder text — e.g.
   * Flotsam & Jetsam Entangling Eels "counts as being named both Flotsam and Jetsam"). */
  alternateNames?: string[];
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

  /** CRD 4.3.x: Conditional play restrictions ("you can't play this character
   *  unless ..."). All conditions must be true for playCard validation to pass.
   *  Used by Mirabel Madrigal Family Gatherer ("unless 5 chars in play"),
   *  Nathaniel Flint Notorious Pirate ("unless an opposing char was damaged
   *  this turn"). */
  playRestrictions?: Condition[];

  /** Alternative play cost (Belle Apprentice Inventor: "you may banish chosen
   *  item of yours to play this character for free"). When set, the player
   *  may choose this path instead of paying ink. */
  altPlayCost?: {
    type: "banish_item";
    /** Filter for which items can be banished as the alt cost. */
    filter: CardFilter;
    /** Optional condition gating when the alt cost is allowed (e.g.
     *  Belle's "during your turn"). */
    condition?: Condition;
  };

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

  /** Set 10/11 cards-under-this-turn condition (Lady Tremaine Sinister
   *  Socialite, Willie the Giant Ghost of Christmas Present): per-turn count
   *  of cards placed under THIS instance. Reset on PASS_TURN. */
  cardsPutUnderThisTurn?: number;

  /** Lilo Bundled Up: how many charge-based damage immunity blocks this
   *  instance has consumed this turn. Reset on PASS_TURN. */
  damageImmunityChargesUsedThisTurn?: number;

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
  /** Number of times any of this player's characters has quested this turn
   *  (Isabela Madrigal Golden Child — "if no other character has quested this
   *  turn"). Reset on PASS_TURN. */
  charactersQuestedThisTurn?: number;
  /** Number of action cards played this turn */
  actionsPlayedThisTurn?: number;
  /** Number of songs played this turn */
  songsPlayedThisTurn?: number;
  /** Instance IDs of characters played this turn (Travelers cycle, P3 — "if you
   *  played another character this turn"). Cleared on PASS_TURN. */
  charactersPlayedThisTurn?: string[];
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
  /** True if any of this player's characters CHALLENGED this turn (Set 11
   *  Pacifist cycle — Mother's Necklace, John Smith Snow Tracker). Cleared at
   *  PASS_TURN for both players. */
  aCharacterChallengedThisTurn?: boolean;
  /** Timed play restrictions affecting this player (Pete Games Referee, Keep the
   *  Ancient Ways). Each entry blocks plays of certain card types until the
   *  CASTER'S next turn begins. Multiple entries OR-combine. */
  playRestrictions?: PlayRestrictionEntry[];

  /** Turn-scoped granted activated abilities (Food Fight!, Donald Duck Coin
   *  Collector, Walk the Plank!): each entry grants `ability` to all of this
   *  player's in-play cards matching `filter`. Cleared on PASS_TURN. */
  timedGrantedActivatedAbilities?: { filter: CardFilter; ability: ActivatedAbility }[];
}

export interface PlayRestrictionEntry {
  cardTypes: CardType[];
  casterPlayerId: PlayerID;
  appliedOnTurn: number;
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
  /** CRD 2.x: which player took turn 1. Used by Underdog ("you're not the first
   *  player") and any future first-player-relative check. Set in initializer. */
  firstPlayerId?: PlayerID;
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

  /** Snapshot of the last card resolved by a choose_target step. Used by
   *  follow-up effects — "its player draws" (target_owner), "that location's
   *  {L}" (I've Got a Dream: last_target_location_lore), etc. Unified replacement
   *  for the old lastTargetOwnerId / lastTargetInstanceId pair. */
  lastResolvedTarget?: ResolvedRef;

  /** Snapshot of the last card resolved as a cost-side target (banish/exert chosen
   *  own character inside a sequential cost). Used by reward-side effects like
   *  Hades Double Dealer ("play a character with the same name as the banished
   *  character") and Ambush ("deal damage equal to their {S}"). Reset at the start
   *  of each sequential effect resolution. */
  lastResolvedSource?: ResolvedRef;

  winner: PlayerID | null;
  isGameOver: boolean;
}

/** CRD 6.2.7.1: A floating triggered ability created by an action card. */
export interface FloatingTrigger {
  trigger: TriggerEvent;
  effects: Effect[];
  controllingPlayerId: PlayerID;
  /**
   * If set, the floating trigger only fires when the triggering card matches
   * this instanceId. Used by "Chosen character gains '<triggered ability>' this
   * turn" cards (Bruno Madrigal, Medallion Weights). Without this, the floating
   * trigger fires globally for any card matching `controllingPlayerId` + filter.
   */
  attachedToInstanceId?: string;
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
  /** For "any number" choose_discard (Geppetto, Desperate Plan): when set, the
   *  validator allows 0..maxCount discards instead of strict equality on count.
   *  The reducer feeds the actual chosen count into lastEffectResult. */
  maxCount?: number;
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
  /** For choose_may (CRD 6.1.4 inverse may): an effect to apply ONLY when the
   *  player declines. Used by Sign the Scroll / Ursula's Trickery: "Each
   *  opponent may discard a card. For each opponent who doesn't, you gain 2 lore." */
  rejectEffect?: Effect | undefined;
  /** For rejectEffect: the player whose perspective controls the reject branch
   *  (the source's owner — not the choosing player). */
  rejectControllingPlayerId?: PlayerID | undefined;
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
  /** Belle Apprentice Inventor: the instanceId of the item to banish as the
   *  alternative cost (instead of paying ink). Only valid when the played
   *  card declares an `altPlayCost` that matches. */
  altCostBanishInstanceId?: string;
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
  | { type: "hand_revealed"; playerId: PlayerID; cardInstanceIds: string[]; sourceInstanceId: string }
  | { type: "turn_passed"; to: PlayerID };
