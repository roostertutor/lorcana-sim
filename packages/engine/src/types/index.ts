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
  /**
   * If set, the `name` / `fullName` (and other identifying fields) on this
   * snapshot are derived from a card in a hidden zone — only the named player
   * is allowed to see them. Mirrors the `GameLogEntry.privateTo` and
   * `lastRevealedHand.privateTo` semantics.
   *
   * Engine writes the full snapshot and stamps `privateTo` to declare who's
   * allowed to read it. The server's `filterStateForPlayer`
   * (server/src/services/stateFilter.ts) is responsible for redacting `name`
   * / `fullName` (and any other identifying fields) on snapshots where
   * `privateTo != null && privateTo !== viewerId` before sending state to a
   * non-authorized viewer — typically by replacing with a placeholder string
   * that preserves shape (count + timing + stat snapshot for non-identifying
   * follow-ups) without leaking card identity.
   *
   * Stamped today on:
   *   - `look_at_top` peek_and_set_target bot/headless path (card stays in
   *     deck after the look — no `card_revealed` event is pushed)
   *   - `look_at_top` choose_from_top picked card when pickDestination is
   *     hand / deck_top / inkwell_exerted (private destinations)
   *
   * Leave `undefined` for public snapshots: banishes, returns-to-hand, exerts,
   * remove_damage / move_damage on in-play targets, choose_target (the choice
   * UI already publicly identifies the card), peek_and_set_target interactive
   * path (a `card_revealed` event is pushed), reveal_top_switch, and
   * lastDiscarded refs (cards have already entered the public discard zone).
   */
  privateTo?: PlayerID;
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
  /** "can't ready at the start of your turn" — NARROW. Blocks only the
   *  start-of-turn ready loop (CRD 3.2.1.1); effect-driven ready (Shield of
   *  Virtue, Fan the Flames, I GOT YOUR BACK) overrides it. Used by Maui -
   *  Whale ("This character can't ready at the start of your turn") and Elsa
   *  Spirit of Winter ("they can't ready at the start of their next turn"). */
  | "ready"
  /** "can't ready period" — BLANKET. Blocks BOTH the start-of-turn ready loop
   *  and effect-driven ready. Used by Gargoyle STONE BY DAY ("If you have 3
   *  or more cards in your hand, this character can't ready") where the
   *  oracle text lacks the "at the start of your turn" scope — so Fan the
   *  Flames cannot ready a dormant Gargoyle either. */
  | "ready_anytime"
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
  /** Vanish (Set 7+): "When an opponent chooses this character for an action,
   *  banish them." CRD 8.14.1. Implemented as a hardcoded banish at
   *  choose_target resolve time, gated on `srcDef.cardType === "action"` —
   *  choices that come from characters'/items'/locations' abilities do NOT
   *  trigger Vanish, even though the opposing owner is the chooser. The
   *  broader `chosen_by_opponent` trigger event fires on both actions and
   *  abilities for cards like Archimedes Exceptional Owl. */
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
  /** Shift variant per CRD 8.10.8 — only meaningful when keyword === "shift".
   *  - undefined: base Shift (target must share name) — CRD 8.10.1
   *  - "universal": shift onto ANY of your characters regardless of name —
   *    CRD 8.10.8.2 (Baymax Giant Robot, Set 7+)
   *  - "classification": shift onto any of your characters that has the
   *    `classifier` trait — CRD 8.10.8.1 (Thunderbolt's [Dog] Shift, Set 8)
   *
   *  Pre-2026-04-30: Universal/Classification Shift were encoded as separate
   *  StaticAbility entries with effect: "universal_shift_self" /
   *  "classification_shift_self" + activeZones: ["hand"]. That violated
   *  structural fidelity (one printed keyword = one JSON ability). Both
   *  encodings are accepted during migration; the static-effect path is
   *  scheduled for removal once card data is migrated. */
  variant?: "classification" | "universal";
  /** Trait classifier for Classification Shift (CRD 8.10.8.1). Required when
   *  variant === "classification"; ignored otherwise. E.g. Thunderbolt's
   *  [Dog] Shift uses classifier: "Dog". */
  classifier?: string;
}

export interface TriggeredAbility {
  type: "triggered";
  /** CRD 5.2.8: Story Name — the bold ability name on the card */
  storyName?: string;
  /** CRD 5.2.8: The printed rules text for this ability (excluding story name) */
  rulesText?: string;
  /** When does this trigger? Either a single leaf TriggerEvent, or a multi-
   *  trigger combinator `{ anyOf: TriggerEvent[] }` for cards whose oracle
   *  reads "When you play this character and whenever X". The anyOf form
   *  fires the same effect body on any matching event — sharing storyName,
   *  oncePerTurn budget, and effect body. Pre-2026-04-30 these were encoded
   *  as duplicate TriggeredAbility entries with the same storyName, which
   *  violated structural fidelity (CLAUDE.md) and silently double-counted
   *  oncePerTurn limits. Hiram Flaversham Toymaker, John Silver Alien Pirate,
   *  Tamatoa So Shiny et al. now use the anyOf form. */
  trigger: TriggerEvent | { anyOf: TriggerEvent[] };
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
  /** Describes an ongoing effect that modifies game rules.
   *  Array form for compound abilities: "While X, [A] and [B]" — both
   *  effects share the same condition and story name (CRD 6.2.6). */
  effect: StaticEffect | StaticEffect[];
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
  /** CRD 6.1.13: "Once per turn" static — the effect applies at most once per
   *  turn per instance. Grandmother Willow: "Once during your turn, you pay
   *  1 {I} less for the next character." After the first character is played and
   *  consumes the discount, the source's oncePerTurnTriggered flag is set so the
   *  static stops contributing until next turn. Reset on PASS_TURN. */
  oncePerTurn?: boolean;
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
  | GetsStatWhileChallengingEffect
  | MoveCharacterEffect
  | NameACardThenRevealEffect
  | RevealTopConditionalEffect
  | CantBeChallengedTimedEffect
  | DamagePreventionTimedEffect
  | DrainCardsUnderEffect
  | OpponentChoosesYesOrNoEffect
  | ChooseNFromOpponentDiscardToBottomEffect
  | PutSelfUnderTargetEffect
  | ReturnAllToBottomInOrderEffect
  | PutTopCardUnderEffect
  | PutCardOnBottomOfDeckEffect
  | MoveDamageEffect
  | GrantCostReductionEffect
  | SearchEffect
  | ChooseEffect
  | ExertEffect
  | GrantKeywordEffect
  | RemoveKeywordTargetEffect
  | ReadyEffect
  | CantActionEffect
  | MustQuestIfAbleEffect
  | LookAtTopEffect
  | DiscardEffect
  | PutIntoInkwellEffect
  | SelfReplacementEffect
  | PlayCardEffect
  | ShuffleIntoDeckEffect
  | PayInkEffect
  | SequentialEffect
  | CostReductionEffect
  | LoseLoreEffect
  | CreateFloatingTriggerEffect
  | GrantExtraInkPlayEffect
  | GrantChallengeReadyEffect
  | RevealHandEffect
  | LookAtHandEffect
  | PutTopCardsIntoDiscardEffect
  | RevealTopSwitchEffect
  | MassInkwellEffect
  | RestrictPlayEffect
  | EachOpponentMayDiscardThenRewardEffect
  | GrantActivatedAbilityTimedEffect
  | FillHandToEffect
  | DiscardUntilEffect
  | DrawUntilEffect
  | OpponentMayPayToAvoidEffect
  | RememberChosenTargetEffect
  | SingCostBonusTargetEffect
  | CreateDelayedTriggerEffect
  | EachPlayerEffect
  | EachTargetEffect;

/**
 * The Return of Hercules: "Each player may reveal a character card from their
 * hand and play it for free." Each instance handles one player; the action
 * uses two instances (one self, one opponent) to cover both players.
 */
/**
 * CRD 6.1.4 + 7.7.4: "Each player [may] X" — apply inner effects once per
 * player, in turn order (active player first), with each iteration's player
 * as the inner effect's controller. If `isMay` is set, each player
 * independently receives a choose_may prompt before their iteration.
 *
 * Unifies the wiring pattern for: Donald Duck Perfect Gentleman + Amethyst
 * Chromicon (each may draw), Return of Hercules (each may play from hand),
 * Falling Down the Rabbit Hole (each inks one of their own), A Whole New
 * World (each discards hand + draws 7), Show Me More (each draws 3),
 * Friend Like Me (each puts top 3 into inkwell), and future cards.
 *
 * Semantics:
 *  - Per-iteration player becomes the `controllingPlayerId` for each inner
 *    effect, so `target: self/opponent` and owner-filter resolution are
 *    relative to that player (not the original caster).
 *  - Effects are applied sequentially within an iteration (like a mini
 *    ability-effects array); the next player's iteration begins after the
 *    current one fully resolves (including any pending choices).
 *  - Implementation uses `pendingEffectQueue` to carry the remaining
 *    iterations across pendingChoice boundaries.
 */
export interface EachPlayerEffect {
  type: "each_player";
  /** Effects applied once per (matching) player, in order. */
  effects: Effect[];
  /** Which players iterate. Default "all" (active player + non-active in
   *  turn order per CRD 7.7.4). "opponents" excludes the caster — used by
   *  "each opponent X" (Sudden Chill, Tangle, Steal from the Rich, etc.).
   *  "chosen_subset" surfaces a `choose_players_subset` PendingChoice to the
   *  CASTER on first invocation; the caster picks any subset (including
   *  empty) of all players, and only the chosen ones iterate. Used by
   *  Beyond the Horizon ("Choose any number of players. They discard their
   *  hands and draw 3 cards each.") — the only card with caster-decides-
   *  who-participates wording in the corpus. CRD 6.1.4: "any number" allows
   *  the empty selection. */
  scope?: "all" | "opponents" | "chosen_subset";
  /** If true, each player receives a choose_may prompt before their
   *  iteration's effects run. The caster retains `acceptControllingPlayerId`
   *  for cost/trigger accounting, but the iteration's own player is the
   *  controller of the inner effects on accept. */
  isMay?: boolean;
  /** Optional per-iteration filter. Only players for whom this filter
   *  evaluates true run the effects. Used by "each opponent with more lore
   *  than you" (Lady Tremaine Overbearing, Prince John Phony King), "the
   *  player or players with the most cards in hand" (Friar Tuck), etc. */
  filter?: PlayerFilter;
  /** Internal: remaining player iterations when reducing through
   *  pendingEffectQueue. Populated by the reducer on the first invocation
   *  from [activePlayer, opponent] per CRD 7.7.4 and consumed iteratively.
   *  Do NOT author this field in card JSON. */
  _iterations?: PlayerID[];
}

/**
 * CRD condition language for per-iteration `each_player` filters. Composable
 * DSL that covers the "each opponent/player with X" family with three
 * metric-comparison primitives:
 *
 *  - `player_vs_caster`: iteration player's metric compared to caster's
 *    same metric (Lady Tremaine Overbearing, Prince John Phony King:
 *    "each opponent with more lore than YOU").
 *  - `player_is_group_extreme`: iteration player is tied for max/min on a
 *    metric across all matching players (Friar Tuck: "the player or
 *    players with the MOST cards in their hand" — tie-aware).
 *  - `player_metric`: absolute threshold (Demona: "each player with fewer
 *    than 3 cards in their hand").
 */
export type PlayerMetric =
  | "lore"
  | "cards_in_hand"
  | "cards_in_inkwell"
  | "characters_in_play";

export type PlayerFilter =
  | { type: "player_vs_caster"; metric: PlayerMetric; op: ">" | ">=" | "<" | "<=" | "==" }
  | { type: "player_is_group_extreme"; metric: PlayerMetric; mode: "most" | "fewest" }
  | { type: "player_metric"; metric: PlayerMetric; op: ">" | ">=" | "<" | "<=" | "=="; amount: number };

/**
 * Iterate over a runtime-resolved set of card instance IDs and apply inner
 * effects to each. The per-iteration target becomes available as
 * `triggeringCardInstanceId` for inner effects that reference it (e.g.
 * `target: { type: "triggering_card" }` resolves to the current iteration's
 * instance).
 *
 * State-stored ID source keys:
 *  - `"lastSongSingerIds"` — IDs of characters that sang the current song
 *    (set during song play resolution). Used by I2I ("if 2+ characters sang
 *    this song, ready them, they can't quest") and Fantastical and Magical
 *    ("for each character that sang this song, draw a card and gain 1 lore").
 *
 * Optional `minCount`: skip entirely if the resolved set has fewer IDs than
 * this threshold (I2I's "if 2 or more characters sang this song" gate).
 *
 * Design parallel: `each_player` iterates over players; `each_target`
 * iterates over cards. Both chain via `pendingEffectQueue` when a
 * mid-iteration pendingChoice suspends work.
 */
export interface EachTargetEffect {
  type: "each_target";
  /** Where to read the instance ID list from the game state. */
  source: { type: "state_ids"; key: "lastSongSingerIds" };
  /** Effects applied per target. The iteration target is passed as
   *  `triggeringCardInstanceId` so inner effects can reference it. */
  effects: Effect[];
  /** Skip entirely if the resolved ID set has fewer than this many entries.
   *  I2I uses `minCount: 2` ("if 2 or more characters sang this song"). */
  minCount?: number;
}

// ConditionalOnPlayerStateEffect → SelfReplacementEffect (with `condition:
// Condition` and no `target`). See SelfReplacementEffect above (CRD 6.5.6).

// ChosenOpposingMayBottomOrRewardEffect: DELETED — migrated to the generic
// OpponentMayPayToAvoidEffect. Hades now uses a no-op chooser (sets
// lastResolvedTarget) → opponent_may_pay_to_avoid chain. See commit history.

/**
 * Goliath - Clan Leader (Set 10): "At the end of each player's turn, if they
 * have more than N cards in their hand, they choose and discard cards until
 * they have N. If they have fewer than N cards in their hand, they draw until
 * they have N." Single effect that applies to each affected player and goes
 * either direction based on current hand size.
 */
/**
 * @deprecated Use DiscardUntilEffect (trimOnly:true) or DrawUntilEffect
 * (drawOnly:true) instead. fill_hand_to was originally bidirectional but
 * cards always wire one direction per effect — separate primitives read
 * cleaner and align with the oracle's "if X / If Y" structure (CRD 5.2.8
 * fidelity rule). See CLAUDE.md "fill_hand_to convention" for rationale.
 */
export interface FillHandToEffect {
  type: "fill_hand_to";
  target: PlayerTarget;
  n: number;
  trimOnly?: boolean;
  drawOnly?: boolean;
}

/** Prince John's Mirror A FEELING OF POWER, Goliath Clan Leader DUSK TO
 *  DAWN (first half): "if they have more than N cards in their hand, they
 *  choose and discard until they have N." If handSize <= n, fizzles.
 *  Replaces fill_hand_to with trimOnly:true. */
export interface DiscardUntilEffect {
  type: "discard_until";
  /** Whose hand to trim. */
  target: PlayerTarget;
  /** Target hand size — discard down to N. */
  n: number;
}

/** Demona Wyvern AD SAXUM COMMUTATE, Goliath Clan Leader DUSK TO DAWN
 *  (second half): "each player with fewer than N cards in their hand draws
 *  until they have N." If handSize >= n, fizzles. Replaces fill_hand_to
 *  with drawOnly:true. */
export interface DrawUntilEffect {
  type: "draw_until";
  target: PlayerTarget;
  n: number;
}

/**
 * Food Fight!, Donald Duck Coin Collector, Walk the Plank!: "Your [matching]
 * characters gain '<activated ability>' this turn." Pushes a turn-scoped
 * grant onto the controller's PlayerState.timedGrantedActivatedAbilities.
 * Consumed by getGameModifiers which merges these into grantedActivatedAbilities
 * for matching in-play cards. Cleared on PASS_TURN.
 *
 * Note: there is NO triggered-ability counterpart to this effect. For "Your
 * X characters gain '[triggered ability]' this turn" oracles (Forest Duel,
 * Fairy Godmother Mystic Armorer, Hero Work), use `create_floating_trigger`
 * with `attachTo: "all_matching"` + `targetFilter` — it correctly binds to
 * current matching cards at resolution time (CRD 6.2.7.1), while a grant-
 * via-getGameModifiers approach would incorrectly capture late-entrants.
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
 * Decks may be shorter than `amount` — natural no-op (top min(amount, deckSize)).
 */
export interface PutTopCardsIntoDiscardEffect {
  type: "put_top_cards_into_discard";
  amount: DynamicAmount;
  /** Whose deck. "self" / "opponent" / "both" / "chosen". */
  target: PlayerTarget;
  /** CRD 6.1.4 */
  isMay?: boolean;
}

/**
 * Jack-jack Parr - Incredible Potential (set 12 #121): "At the start of your
 * turn, you may put the top card of your deck into your discard. If its card
 * type is: • character, this character gets +2 {S} this turn. • action or
 * item, this character gets +2 {L} this turn. • location, banish chosen
 * character."
 *
 * Atomic mill + multi-branch switch. Mills the top `count` cards from
 * `target`'s deck, then for EACH milled card, applies the first matching
 * case's effects (with the milled card set as lastResolvedTarget — so
 * downstream effects can reference its properties if needed). Falls through
 * to no-op if no case matches. Card lands in `destination` (default discard).
 *
 * Why a new primitive instead of reusing `reveal_top_conditional` +
 * composition: the existing conditional only supports single-match binary
 * branching, and the composition approach can't preserve the milled card's
 * reference across sequential `self_replacement` effects (no condition type
 * reads lastResolvedTarget's cardType). One atomic effect also avoids
 * accidentally leaking the revealed card's reference into unrelated later
 * effects in the same ability.
 */
export interface RevealTopSwitchEffect {
  type: "reveal_top_switch";
  /** How many top cards to reveal. Defaults to 1 (Jack-jack's use case).
   *  Generalized for future cards that reveal multiple and apply per-card
   *  switching (e.g. scry-2 with type-based effects per card). */
  count?: number;
  /** Whose deck to reveal from. Defaults to "self". */
  target?: PlayerTarget;
  /** Evaluated in order per revealed card; first-match-wins. Non-matching
   *  revealed cards skip the switch entirely and still land at destination. */
  cases: Array<{ filter: CardFilter; effects: Effect[] }>;
  /** Where the revealed card goes after case effects. Defaults to "discard"
   *  (Jack-jack). `top` returns to deck-top (no-op net movement); `bottom`
   *  is the classic scry-miss; `hand` matches the draw-if-type pattern. */
  destination?: "discard" | "hand" | "top" | "bottom";
  /** CRD 6.1.4: player may decline the reveal entirely. If declined, the
   *  effect is skipped and no cases fire. */
  isMay?: boolean;
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
  /** CRD 6.1.4: player may decline to reveal. */
  isMay?: boolean;
}

/**
 * "Look at chosen opponent's hand" — private-reveal variant. Controller
 * sees the target's hand; the target does NOT publicly expose it to other
 * players. Used by Dolores Madrigal Hears Everything NO SECRETS. Runtime
 * dispatches through the same reveal code path as `reveal_hand` but stamps
 * `privateTo: controllingPlayerId` on the event so the UI scopes visibility.
 */
export interface LookAtHandEffect {
  type: "look_at_hand";
  target: PlayerTarget;
  isMay?: boolean;
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
  | "cost_result"
  // NOTE: 7 string variants removed 2026-04-24 and migrated to the
  // {type: "stat_ref", from, property} form below:
  //   triggering_card_lore           → {from:"triggering_card", property:"lore"}
  //   triggering_card_damage         → {from:"triggering_card", property:"damage"}
  //   last_target_location_lore      → {from:"last_target_location", property:"lore"}
  //   last_resolved_target_delta     → {from:"last_resolved_target", property:"delta"}
  //   last_resolved_source_strength  → {from:"last_resolved_source", property:"strength"}
  //   last_resolved_target_lore      → {from:"last_resolved_target", property:"lore"}
  //   last_resolved_target_strength  → {from:"last_resolved_target", property:"strength"}
  /** Number of characters that sang the most recently played song. 1 for solo
   *  sing, N for Sing Together. Read by Fantastical and Magical: "draw a card
   *  and gain 1 lore for each character that sang this song". */
  | "song_singer_count"
  /** Amount of damage just dealt by the most recent challenge resolution.
   *  Read from `state.lastDamageDealtAmount`. Used by Mulan Elite Archer
   *  TRIPLE SHOT and Namaari Heir of Fang TWO-WEAPON FIGHTING. */
  | "last_damage_dealt"
  /** Colors of the Wind: count unique ink types among the top cards of
   *  both players' decks. Reveals both tops then draws that many. */
  | "unique_ink_types_on_top_of_both_decks"
  /** Per-turn counter on the controlling player: number of opposing characters
   *  banished in a challenge initiated by this player this turn. Used by
   *  Namaari Resolute Daughter ("For each opposing character banished in a
   *  challenge this turn, you pay 2 {I} less to play this character"). */
  | "opposing_chars_banished_in_challenge_this_turn"
  | { type: "count"; filter: CardFilter; max?: number }
  /** Read a stat (cost / strength / willpower / lore / damage / delta) off
   *  a named card reference. Replaces the former 14 per-stat variants
   *  (target_lore / target_damage / target_strength / target_willpower /
   *  source_lore / source_strength / source_willpower +
   *  triggering_card_lore / triggering_card_damage +
   *  last_resolved_source_strength / last_resolved_target_lore /
   *  last_resolved_target_strength / last_resolved_target_delta +
   *  last_target_location_lore) — all collapsed 2026-04-24 into this
   *  orthogonal {from × property} shape. New reference sources or stat
   *  properties need no new DynamicAmount variants; add a `from` enum
   *  entry or a `property` enum entry and extend the resolver.
   *
   *  Semantics mirror StatValue in CardFilter:
   *    from = "source"              → state.cards[sourceInstanceId]
   *    from = "target"              → state.cards[targetInstanceId]
   *    from = "triggering_card"     → state.cards[triggeringCardInstanceId]
   *    from = "last_resolved_source"→ state.lastResolvedSource (ResolvedRef)
   *    from = "last_resolved_target"→ state.lastResolvedTarget (ResolvedRef)
   *    from = "last_target_location"→ state.lastResolvedTarget scoped to a
   *                                    location (I've Got a Dream's pattern).
   *
   *  The `delta` property is special-case (only meaningful on
   *  last_resolved_target; reads the "actually-consumed" count from
   *  `ref.delta`, e.g. damage actually removed by the preceding remove_damage
   *  effect — Baymax Armored Companion pattern). */
  | {
      type: "stat_ref";
      from: "source" | "target" | "triggering_card"
          | "last_resolved_source" | "last_resolved_target"
          | "last_target_location";
      property: "cost" | "strength" | "willpower" | "lore" | "damage" | "delta";
      max?: number;
    }
  /** CRD 8.4.2: number of cards in the source's cards-under pile ("for each card
   *  under this character" / "equal to the number of cards under"). Resolved
   *  against the SOURCE instance's `cardsUnder.length`. */
  | { type: "cards_under_count"; max?: number }
  /** Donald Duck Fred Honeywell WELL WISHES: "draw a card for each card that
   *  was under them". Reads state.lastBanishedCardsUnderCount — the count
   *  captured at banish time before leave-play cleanup clears cardsUnder. */
  | { type: "triggering_card_cards_under_count"; max?: number }
  /** The Headless Horseman WITCHING HOUR: "deal 2 damage for each action
   *  card discarded this way". Counts entries in state.lastDiscarded that
   *  match the filter, multiplied by `multiplier` (default 1). Reads the
   *  freshest lastDiscarded snapshot (set by discard_from_hand), so should
   *  be used immediately after the triggering discard step. */
  | { type: "count_last_discarded"; filter?: CardFilter; multiplier?: number };

export interface DrawEffect {
  type: "draw";
  amount: DynamicAmount;
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
  /** Optional gating condition. Marching Off to Battle: "If a character was
   *  banished this turn, draw 2 cards." Effect-level condition lets a single
   *  actionEffects entry conditionally fire without an enclosing ability. */
  condition?: Condition;
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
  /** Optional gating condition. Lets one TriggeredAbility carry two
   *  mutually-exclusive deal_damage effects gated by complementary
   *  conditions (e.g. Helga Sinclair COMBAT TRAINING — "deal 1 damage; if
   *  2+ cards put in discard, deal 2 damage instead"). Without this,
   *  encoding the conditional choice required two duplicate-storyName
   *  TriggeredAbilities, which violated structural fidelity per CLAUDE.md.
   *  Mirrors DrawEffect.condition / GainLoreEffect.condition / etc. */
  condition?: Condition;
  /** Effects to run after dealing damage to the target ("deal 2, then if
   *  banished gain a lore" / sequential follow-ups). */
  followUpEffects?: Effect[];
  /**
   * CRD distinction: "put N damage counters on" vs "deal N damage". The former
   * does not fire `damage_dealt_to` triggers and isn't a "dealt damage" event.
   * Used by Queen of Hearts Unpredictable Bully ("put a damage counter on them").
   * When true, the reducer mutates `instance.damage` directly without firing
   * dealt_damage triggers / damage_dealt events.
   */
  asPutDamage?: boolean;
  /** CRD 6.1.4 */
  isMay?: boolean;
}

export interface RemoveDamageEffect {
  type: "remove_damage";
  /** Numeric: remove exactly N damage (capped at target.damage). "all":
   *  remove every damage counter. Replaces the legacy `amount: 99` magic-
   *  number idiom that was used pre-2026-04 (Baymax FUNCTIONALITY IMPROVED,
   *  Mrs. Incredible HOLD FAST, et al.). */
  amount: number | "all";
  target: CardTarget;
  /** CRD 6.1.3: "up to" — player may choose 0..amount. Engine resolves at max for now. */
  isUpTo?: boolean;
  /** CRD 6.1.4 */
  isMay?: boolean;
  /** Effects to apply to each target after removing damage. Pattern shared with
   *  ExertEffect / ReadyEffect. */
  followUpEffects?: Effect[];
}

export interface BanishEffect {
  type: "banish";
  target: CardTarget;
  /** CRD 6.1.4 */
  isMay?: boolean;
  /** Effects to apply after banishing (e.g. "banish chosen char, then gain 1
   *  lore"). Mirrors the exert/ready followUp pattern. */
  followUpEffects?: Effect[];
}

export interface ReturnToHandEffect {
  type: "return_to_hand";
  target: CardTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** Effects to apply after returning to hand. */
  followUpEffects?: Effect[];
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
  /** CRD 6.1.4: player may decline to gain lore. */
  isMay?: boolean;
  /** Optional gating condition. "If you control an Evasive character, gain 1
   *  lore" pattern (Mirror, Mirror style). */
  condition?: Condition;
}

export interface GainStatsEffect {
  type: "gain_stats";
  strength?: number;
  willpower?: number;
  lore?: number;
  target: CardTarget;
  /**
   * "this_turn" = wears off at end of current turn (routes through TimedEffect).
   * "permanent" = stays for the rest of the game.
   * EffectDuration values ("end_of_turn", "end_of_owner_next_turn") use the
   * timedEffects mechanism so the bonus expires correctly across turn boundaries
   * (Cogsworth Majordomo, Lost in the Woods).
   */
  duration: "this_turn" | "permanent" | EffectDuration;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  // NOTE: strengthPerDamage / strengthPerCardInHand / strengthEqualsSourceStrength /
  // strengthEqualsSourceWillpower / strengthEqualsTargetWillpower have all been
  // removed. Express these via `strengthDynamic: DynamicAmount` instead:
  //   strengthPerDamage              → strengthDynamic: {type:"target_damage"}
  //   strengthPerCardInHand          → strengthDynamic: {type:"count", filter:{owner:self,zone:"hand"}}
  //   strengthEqualsSourceStrength   → strengthDynamic: {type:"source_strength"}
  //   strengthEqualsSourceWillpower  → strengthDynamic: {type:"source_willpower"}
  //   strengthEqualsTargetWillpower  → strengthDynamic: {type:"target_willpower"}
  // Migration landed 2026-04-24.
  /** Internal flag set by the Support trigger synthesis. When true, the
   *  choose_target resolver fires a `chosen_for_support` trigger on the
   *  picked character (Prince Phillip Gallant Defender, Rapunzel Ready for
   *  Adventure). Not part of the JSON spec. */
  _supportRecipientHook?: boolean;
  /** Internal — story name of the producing ability/keyword. Stamped onto
   *  the resulting TimedEffect so the UI can attribute the buff to the
   *  right ability on cards with multiple abilities (e.g. The Queen
   *  Conceited Ruler has Support AND ROYAL SUMMONS). Set by the trigger
   *  synthesis ("Support" / "Challenger") or by the trigger-resolution
   *  pass when an ability defines explicit effects. */
  _sourceStoryName?: string;
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
  /** Effects to apply to the same target after the stat bonus (e.g. "+3 STR
   *  this turn, then grant Ward until your next turn"). */
  followUpEffects?: Effect[];
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
  /** Numeric: move exactly N (capped at source.damage). "all": move every
   *  damage counter on the source(s) — Can't Hold It Back Anymore, Luisa
   *  Madrigal I CAN TAKE IT. Replaces the legacy `amount: 99` magic-number
   *  idiom that was used pre-2026-04. */
  amount: number | "all";
  /** "up to N" — engine moves min(N, source.damage) */
  isUpTo?: boolean;
  /** Source character (must have damage). For "all_damaged", loops over each
   *  matching damaged card moving `amount` counters per source. The actual
   *  total moved is recorded in `state.lastEffectResult` for cost_result reads
   *  (Everybody's Got a Weakness: "draw a card for each damage counter moved"). */
  source:
    | { type: "chosen"; filter: CardFilter }
    | { type: "all_damaged"; filter: CardFilter };
  /** Destination character. "last_resolved_target" pins the destination to
   *  the previously-chosen card (Can't Hold It Back Anymore: "exert chosen
   *  opposing character" sets lastResolvedTarget, then the move_damage uses
   *  it without prompting for a second target). "this" pins to the source
   *  instance itself (Luisa Madrigal No Pressure SHOULDER THE BURDEN —
   *  "move up to 3 damage from chosen character to THIS character"). */
  destination:
    | { type: "chosen"; filter: CardFilter }
    | { type: "last_resolved_target" }
    | { type: "this" };
  /** Internal: stage-2 marker carrying the resolved source snapshot. */
  _resolvedSource?: ResolvedRef;
  /** CRD 6.1.4: player may decline the entire move (the source-pick prompt
   *  surfaces as optional). */
  isMay?: boolean;
  /** Optional gating condition (Luisa Madrigal: "if this character has 3 or
   *  more damage..."). Effect fizzles silently when false. */
  condition?: Condition;
}

/**
 * "Put the top card of [your] deck under this card facedown" — the same
 * mechanism as Boost (CRD 8.4.1) but as a triggered effect rather than a
 * pay-N player action. Used by Graveyard of Christmas Future
 * ("Whenever you move a character here, put the top card of your deck
 * under this location facedown.").
 */
export interface PutTopCardUnderEffect {
  type: "put_top_card_under";
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
export interface PutCardOnBottomOfDeckEffect {
  type: "put_card_on_bottom_of_deck";
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
  /** Deck end to place cards at. Defaults to "bottom". "top" is used by
   *  Gyro Gearloose NOW TRY TO KEEP UP, Stitch Alien Buccaneer READY FOR
   *  ACTION, Gazelle Ballad Singer CROWD FAVORITE — "put on the top of your
   *  deck". */
  position?: "top" | "bottom";
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
/** Mickey Mouse Bob Cratchit (Set 11): "put all cards that were under him
 *  under another chosen character or location of yours." Moves the source's
 *  cardsUnder pile to the chosen target's cardsUnder pile. */
/** I2I (Set 9): "If 2 or more characters sang this song, ready them. They
 *  can't quest for the rest of this turn." Targets the characters from
 *  `state.lastSongSingerIds`. Subsumed by `each_target` with
 *  `source: { type: "state_ids", key: "lastSongSingerIds" }`. */
// ReadySingersEffect: DELETED — use each_target instead.

/**
 * CRD 8.4.2 / 8.10.5: drain a parent's cardsUnder pile to a destination zone
 * or another parent's pile. Unified across the 3 shapes used in the card pool:
 *
 *   source=this,    destination=hand             — Alice Well-Read Whisper
 *   source=this,    destination=target_pile      — Mickey Bob Cratchit
 *   source=chosen,  destination=hand|bottom_of_deck — Come Out and Fight
 *   source=all_own, destination=inkwell          — Visiting Christmas Past
 *
 * The handler fires the canonical cross-card trigger per destination:
 *   - inkwell      → card_put_into_inkwell (Oswald, Chicha)
 *   - target_pile  → card_put_under (Willie, Lady Tremaine)
 *   - hand / bottom_of_deck → no CRD-defined trigger (hand-return triggers
 *     are for play→hand per CRD 8.2.x, not under→hand).
 */
export interface DrainCardsUnderEffect {
  type: "drain_cards_under";
  /** Which parent card(s) to drain.
   *  - "this":       the source instance (default if omitted).
   *  - "all_own":    every in-play card the controller owns with cardsUnder.
   *  - { chosen }:   player picks an in-play card matching `filter`. */
  source?: "this" | "all_own" | { type: "chosen"; filter: CardFilter };
  /** Destination for drained cards.
   *  - "hand":           each under-card to its owner's hand.
   *  - "bottom_of_deck": each under-card to its owner's deck bottom, random order.
   *  - "inkwell":        controller's inkwell, exerted.
   *  - { target_pile }:  another chosen parent's cardsUnder (Bob Cratchit). */
  destination:
    | "hand"
    | "bottom_of_deck"
    | "inkwell"
    | { type: "target_pile"; target: CardTarget };
  /** CRD 6.1.4: player may choose not to apply. When part of a triggered
   *  ability with multiple effects (Graveyard of Christmas Future), declining
   *  skips the whole sequence. */
  isMay?: boolean;
}

/**
 * CRD 6.1.5.1: "[Cost] — Choose N cards from chosen opponent's discard and put
 * them on the bottom of their deck to gain X lore. If any matching cards were
 * moved this way, gain Y lore instead." (The Queen - Jealous Beauty.)
 *
 * Atomic cost→reward: if the opponent has fewer than `count` cards in their
 * discard, the entire effect fizzles (CRD 1.7.7) and no lore is gained.
 * Otherwise, exactly `count` cards are moved to the bottom of their deck and
 * the lore amount is computed in the same step — `gainLoreBonus` if any moved
 * card matches `bonusFilter`, else `gainLoreBase`. There is no post-resolution
 * +1 bump; the conditional check happens during resolution.
 */
export interface ChooseNFromOpponentDiscardToBottomEffect {
  type: "choose_n_from_opponent_discard_to_bottom";
  count: number;
  gainLoreBase: number;
  gainLoreBonus: number;
  bonusFilter: CardFilter;
}

/**
 * CRD 6.1.3 / 6.1.4: "Chosen opponent chooses YES! or NO!" — surfaces a binary
 * may-prompt on the opposing player. Accept = `yesEffect` runs with the caster
 * as the controlling player (so "you gain N lore" lands on the caster). Reject
 * = `noEffect` runs with the opposing player as the controlling player (so
 * "they choose a character of theirs" picks from the opponent's own characters).
 * Used by Do You Want to Build A Snowman?.
 */
export interface OpponentChoosesYesOrNoEffect {
  type: "opponent_chooses_yes_or_no";
  yesEffect: Effect;
  noEffect: Effect;
}

/**
 * CRD 6.5.6 self-replacement within a single ability: "[default effect]. If
 * [condition], [replacement] instead." One shape covers three dispatch modes:
 *
 * - `target` set, `condition` is a CardFilter → target-based. Player picks
 *   once, filter matches against the resolved target. Vicious Betrayal
 *   (+2/+3 by Villain), Poisoned Apple (exert/banish by Princess).
 * - `target` absent, `condition` is a CardFilter → state-based. Filter
 *   matches against `state.lastDiscarded`. Kakamora Pirate Chief ("If a
 *   Pirate was discarded, deal 3 instead of 1").
 * - `target` absent, `condition` is a Condition (has `type` field) →
 *   game-state check via evaluateCondition. Turbo Royal Hack ("If 10 {S}
 *   or more in play, gain 5 instead"), Hidden Trap BLINDING CLOUD ("If you
 *   have Darkwing Duck in play, -2 instead").
 *
 * Either branch list may be empty — a no-op default or no-op replacement
 * is valid (Consult the Spellbook: "if cost ≤ 3, may play for free" with
 * no default action).
 */
export interface SelfReplacementEffect {
  type: "self_replacement";
  /** Default branch applied when condition is false. */
  effect: Effect[];
  /** Replacement branch applied when condition is true. */
  instead: Effect[];
  /** Condition to evaluate. Distinguished at runtime by the presence of a
   *  `type` field: Condition variants have one, CardFilter does not. */
  condition: CardFilter | Condition;
  /** Optional shared target. When present, the CardFilter variant of
   *  `condition` is matched against the resolved target. */
  target?: CardTarget;
  /** CRD 6.1.4: optional may — the choose_target prompt is declinable. */
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
  /**
   * CRD 6.4.2.1: If true, this is a continuous static — affects all matching
   * cards including those played after resolution. Stored as a GlobalTimedEffect
   * on GameState instead of per-card TimedEffects.
   */
  continuous?: boolean;
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
export interface DamagePreventionTimedEffect {
  type: "damage_prevention_timed";
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
export interface DamagePreventionStatic {
  type: "damage_prevention_static";
  source: "challenge" | "all" | "non_challenge";
  target: CardTarget;
  /** Lilo Bundled Up: "during each opponent's turn, the first time this
   *  character would take damage, she takes no damage instead." When set,
   *  the immunity blocks at most N hits per turn (tracked per instance via
   *  CardInstance.damagePreventionChargesUsedThisTurn). Combine with
   *  ability.condition (e.g. not(is_your_turn)) to gate active windows. */
  chargesPerTurn?: number;
}

/**
 * "Reveal the top card of your deck. If it [matches], [matchAction]. Otherwise,
 * put it on (top|bottom) of your deck." Common in Sets 5–11.
 *
 * Examples:
 *  - Queen's/King's Sensor Core: matchAction "to_hand", filter Princess|Queen
 *  - Pete - Wrestling Champ: matchAction "play_card", filter name "Pete"
 *  - Chief Bogo - Commanding Officer: matchAction "play_card", filter cardType character cost≤5
 */
export interface RevealTopConditionalEffect {
  type: "reveal_top_conditional";
  /** Filter the revealed card must match for matchAction to apply. */
  filter: CardFilter;
  /** What to do with the revealed card if it matches. */
  matchAction: "to_hand" | "play_card" | "to_inkwell_exerted";
  /** Only meaningful when matchAction === "play_card". When true, the
   *  played card enters play exerted (Oswald Lucky Rabbit FAVORABLE CHANCE
   *  for items). */
  matchEnterExerted?: boolean;
  /** Only meaningful when matchAction === "play_card". When true, the
   *  controller pays the card's normal ink cost (Kristoff's Lute MOMENT OF
   *  INSPIRATION: "play it as if it were in your hand"). When false/undefined,
   *  the card is played for free (Daisy Duck Donald's Date, Mufasa). If the
   *  controller can't afford the cost, the card goes to noMatchDestination
   *  instead (treated as a decline). */
  matchPayCost?: boolean;
  /** Sisu Uniting Dragon: "If it's a Dragon character card, put it into your
   *  hand and repeat this effect." After a successful match, run the same
   *  reveal again with the new top card. Loops until a non-match. */
  repeatOnMatch?: boolean;
  /** Let's Get Dangerous: "Each player shuffles their deck and then reveals
   *  the top card." When true, the affected deck(s) are shuffled (via the
   *  seeded RNG) before the top card is peeked. For target:"both", each
   *  player's deck shuffles independently before that player's reveal. The
   *  shuffle is part of the same atomic beat as the reveal — it's not a
   *  separable step the player can interact with mid-effect. Currently used
   *  only by Let's Get Dangerous; promote to a standalone primitive if a
   *  future card needs shuffle without a paired reveal. */
  shuffleBefore?: boolean;
  /** CRD 6.1.4: first "may" — player may decline to run this whole effect
   *  (i.e. "you may reveal the top card"). Handled at the trigger layer via a
   *  choose_may before this effect is applied. */
  isMay?: boolean;
  /** CRD 6.1.4: second "may" — after the reveal, if the card MATCHES the filter,
   *  the player may decline to run matchAction ("if it's an item, you may play
   *  that item"). On decline, the revealed card is routed to noMatchDestination
   *  (symmetric with the can't-afford fallback on matchPayCost). */
  matchIsMay?: boolean;
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
  /** Lore gained on a successful match (Bruno Madrigal Undetected Uncle:
   *  "If it's the named card, put that card into your hand AND GAIN 3 LORE").
   *  Applied AFTER the matchAction so the bot path and interactive path stay
   *  symmetric. Absent for cards without a lore branch (Sorcerer's Hat, Merlin,
   *  Blast from Your Past). */
  gainLoreOnHit?: number;
}

/**
 * Move a character of yours to one of your locations as an effect (CRD 4.7).
 * Differs from the MOVE_CHARACTER player action: effects don't pay the location's
 * moveCost and bypass the "drying" restrictions, since the ability
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
  character:
    | { type: "this" }
    | { type: "triggering_card" }
    | { type: "chosen"; filter: CardFilter }
    | { type: "last_resolved_target" }
    /** "Any number of your characters" — surfaces a two-stage chooser: first
     *  the location, then a multi-select of which characters to move. Used by
     *  Moana Kakamora Leader ("any number") and Voyage ("up to 2", via
     *  `maxCount`). The follow-up gain_lore reads state.lastEffectResult to
     *  pay per moved character ("Gain 1 lore for each character you moved").
     *  Optional: `maxCount` caps the multi-select; absence = unbounded. */
    | { type: "all"; filter: CardFilter; maxCount?: number };
  /** The location being moved to. `last_resolved_target` reads
   *  state.lastResolvedTarget — used when a previous step in the same
   *  sequential picked the location and a follow-up move should reuse it
   *  (Tuk Tuk Lively Partner moves himself AND a chosen other character to
   *  the SAME location). */
  location: { type: "triggering_card" } | { type: "chosen"; filter: CardFilter } | { type: "last_resolved_target" };
  /** CRD 6.1.4 */
  isMay?: boolean;
  /** Internal: set during stage 2 of a chosen+chosen flow to carry the chosen
   *  character snapshot across the second pendingChoice. Not part of the JSON
   *  spec — set by the reducer only. */
  _resolvedCharacter?: ResolvedRef;
  /** Internal: set during stage 2 of an "all"+chosen flow to carry the
   *  resolved location across the multi-select character chooser. Not part
   *  of the JSON spec — set by the reducer only. */
  _resolvedLocation?: ResolvedRef;
}

/**
 * "Your characters get +N {S} while challenging a [filter] this turn."
 * Adds a turn-scoped conditional challenge bonus on the controlling player.
 * Applied during `performChallenge` only when the defender matches `defenderFilter`.
 * This is the "conditional challenger" pattern — works like the Challenger keyword
 * (only on attack, only against matching defender) but cannot reuse the keyword
 * because Challenger by rule (CRD 4.6.8) does not apply against locations.
 */
export interface GetsStatWhileChallengingEffect {
  type: "gets_stat_while_challenging";
  strength: number;
  defenderFilter: CardFilter;
  duration: "this_turn";
  /** Which character receives the bonus. Default: source ("this"). Set when
   *  the effect targets a chosen character (e.g. "chosen character gets
   *  Challenger +N this turn"). */
  target?: CardTarget;
}

/**
 * Per-instance permanent conditional challenger bonus — Shenzi Scar's
 * Accomplice EASY PICKINGS: "while challenging a damaged character, this
 * character gets +2 {S}". STATIC effect (lives in the StaticEffect union),
 * applies to "this" instance only, persists as long as the source static is
 * active. Read by performChallenge in addition to turnChallengeBonuses.
 */
export interface ConditionalChallengerSelfStatic {
  type: "conditional_challenger_self";
  strength: number;
  defenderFilter: CardFilter;
}

/**
 * Cross-player optional payment — generalization of the Hades Looking for a
 * Deal pattern. The triggering card's owner (the OPPOSING player from the
 * controller's perspective) gets a may-prompt: accept to fire `acceptEffect`,
 * decline to let `rejectEffect` fire (controlled by the trigger's caster).
 * Used by Tiana Restaurant Owner SPECIAL RESERVATION ("...the challenging
 * character gets -3 {S} this turn UNLESS their player pays 3 {I}"):
 *   - acceptEffect = pay_ink amount: 3 (deducts from opponent's pool)
 *   - rejectEffect = gain_stats strength: -3 target: triggering_card
 * The choose_may surfaces with choosingPlayerId set to triggering_card's
 * owner so the opposing bot makes the decision.
 */
export interface OpponentMayPayToAvoidEffect {
  type: "opponent_may_pay_to_avoid";
  /** What the opposing player does if they ACCEPT (typically a cost). */
  acceptEffect: Effect;
  /** What the controller (the trigger's caster) does if the opponent DECLINES. */
  rejectEffect: Effect;
}

/**
 * Capture a chosen target instance id onto the SOURCE's `rememberedTargetIds`
 * field for later reference by static effects. Used by Elsa's Ice Palace
 * ETERNAL WINTER ("When you play this location, CHOOSE AN EXERTED CHARACTER.
 * While this location is in play, that character can't ready..."). The
 * remembered id persists on the source instance and is consulted by the
 * RestrictRememberedTargetActionStatic each gameModifiers iteration.
 */
export interface RememberChosenTargetEffect {
  type: "remember_chosen_target";
  filter: CardFilter;
}

// CreateCardEffect: DELETED — was scaffolded for token creation but never
// implemented (no reducer case, 0 card consumers). Can be re-added if
// Lorcana ever prints token-creating cards.

export interface SearchEffect {
  type: "search";
  filter: CardFilter;
  target: PlayerTarget;
  zone: "deck" | "discard";
  putInto: ZoneName;
  /** When putInto is "deck", controls whether the matched card goes on top
   *  or bottom of the deck. Default: "bottom". Used by cards that say
   *  "search your deck for X, reveal it, shuffle your deck and put that
   *  card on top of it" (Hiro Hamada Robotics Prodigy, etc.). */
  position?: "top" | "bottom";
  /** When true, emits a card_revealed event so the UI can show the found
   *  card to all players. Set for cards whose oracle text says "reveal
   *  that card to all players". */
  reveal?: boolean;
}


/** A branching "choose one of" effect */
export interface ChooseEffect {
  type: "choose";
  options: Effect[][];
  count: number;
  /** CRD 6.1.4 */
  isMay?: boolean;
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
  /** Dynamic value for keywords whose magnitude scales with game state
   *  (Snow White Fair-Hearted: "Resist +1 for each other Knight character
   *  you have in play"). When set, overrides the literal `value` field; the
   *  static-effect collection in gameModifiers resolves this once per
   *  collection pass and stores the result as the granted keyword's value. */
  valueDynamic?: DynamicAmount;
  target: CardTarget;
  duration: EffectDuration;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
  /** CRD 6.4.2.1: continuous static — affects newly played cards too */
  continuous?: boolean;
  /** Effects to apply to the target after granting the keyword (e.g. grant
   *  Resist +1, then deal 2 damage). Mirrors the exert/ready followUp pattern. */
  followUpEffects?: Effect[];
  /** CRD 6.1.7: per-effect gating predicate. When set, the grant fizzles
   *  silently if false — useful for songs that conditionally grant a keyword
   *  ("if a character sang this song, your characters gain Ward…" — What
   *  Else Can I Do?). Gated by CONDITION_GATED_EFFECTS in applyEffect. */
  condition?: Condition;
}

/** Timed-variant "loses <keyword>". Attaches a `suppress_keyword` TimedEffect
 *  to the target. Used by Maui Soaring Demigod IN MA BELLY ("loses Reckless
 *  this turn"). Distinct from the permanent `remove_keyword` StaticEffect
 *  which is applied via static ability scans in gameModifiers. */
export interface RemoveKeywordTargetEffect {
  type: "remove_keyword_target";
  keyword: Keyword;
  target: CardTarget;
  duration: EffectDuration;
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
  /** Optional gating condition — restricts when the cant_action timed effect
   *  applies. Used by cards that conditionally restrict actions (e.g. only
   *  while the source has Anna in play). */
  condition?: Condition;
  /** Effects to apply to the SAME resolved target after the cant_action lands.
   *  Pattern shared with ExertEffect / ReadyEffect / RemoveDamageEffect.
   *  Used by cards with "can't X AND must Y" oracle pairs that land both on
   *  one chosen character — e.g. This Growing Pressure "Chosen opposing
   *  character can't challenge and must quest during their next turn",
   *  Ariel Curious Traveler / Gaston Frightful Bully (same pattern). */
  followUpEffects?: Effect[];
}

/**
 * Per-character timed obligation: "must quest if able during their next turn".
 * Used by Ariel Curious Traveler / Gaston Frightful Bully / Rapunzel Ethereal
 * Protector. Validator's pass-turn step iterates own ready characters with
 * this timed effect and refuses the pass while any of them has a valid quest.
 * Parallel to Reckless's inherent "must challenge if able" check, but
 * instance-scoped and time-limited rather than keyword-driven.
 */
export interface MustQuestIfAbleEffect {
  type: "must_quest_if_able";
  target: CardTarget;
  duration: EffectDuration;
}

/**
 * Look at top N cards of deck. Bot resolves automatically:
 * - "choose_from_top": pick up to maxPick cards (optionally matching filter/filters);
 *   picked cards go to pickDestination, rest go to restPlacement. Generalized chooser.
 * - "top_or_bottom": look at one card, put on top or bottom
 * - "reorder": look at N cards, put back in any order (bot uses default order)
 */
export interface LookAtTopEffect {
  type: "look_at_top";
  /** Number of cards to look at. Accepts a literal or a DynamicAmount
   *  (e.g. `cards_under_count` for Bambi Ethereal Fawn). */
  count: number | DynamicAmount;
  action:
    | "top_or_bottom"
    | "reorder"
    /** Generalized chooser: peek top N, pick up to maxPick cards, picked
     *  cards go to pickDestination, rest go to restPlacement. Replaces the
     *  former `up_to_n_to_hand_rest_bottom` (pickDestination defaults to
     *  "hand") and `one_to_inkwell_exerted_rest_top` (pickDestination
     *  "inkwell_exerted"). */
    | "choose_from_top"
    /** Pure chooser: peek at top N, may pick ONE matching card and set
     *  lastResolvedTarget to it (card stays in deck), move the rest per
     *  restPlacement. The picked card is then acted on by a subsequent
     *  effect in the same ability's effects array — typically a
     *  `play_card` with target: last_resolved_target, sourceZone: "deck".
     *  Separates the peek-and-choose concern from the "what to do with the
     *  chosen card" concern.
     *  Powerline World's Greatest Rock Star (restPlacement: "bottom"),
     *  Robin Hood Sharpshooter (restPlacement: "discard"). */
    | "peek_and_set_target"
    /** Fred Giant-Sized I LIKE WHERE THIS IS HEADING — reveal cards from top
     *  until first match against `filter`, that card to hand, shuffle the rest
     *  of the revealed cards back into the deck. count is implicitly "until_match". */
    | "reveal_until_match_to_hand_shuffle_rest"
    /** We Know the Way — look at top 1, if it matches `filter` may play for
     *  free, otherwise put it into the controller's hand. */
    | "one_to_play_for_free_else_to_hand";
  /** Optional filter — only matching cards can go to hand (for "may reveal matching" patterns) */
  filter?: CardFilter;
  /** When set, applies to `choose_from_top` and means "take up to
   *  1 card matching EACH filter" (capped collectively by `maxToHand`).
   *  Used by The Family Madrigal: filters [Madrigal-character, Song]. */
  filters?: CardFilter[];
  /** For "choose_from_top": max number of cards the player may pick
   *  (Look at This Family = 2, Dig a Little Deeper = 2, default 1). */
  maxToHand?: number;
  /** For "choose_from_top": where the picked cards go. Default "hand".
   *  - "hand"             — Develop Your Brain, Ariel, Nani, The Family Madrigal
   *  - "deck_top"         — Ursula's Cauldron, Merlin Turtle (picked card stays on top)
   *  - "inkwell_exerted"  — Kida Creative Thinker (picked goes into inkwell facedown)
   *  - "discard"          — Mad Hatter Eccentric Host (look at top, may discard it or leave on top) */
  pickDestination?: "hand" | "deck_top" | "inkwell_exerted" | "discard";
  /** Where the unchosen cards go. Default "bottom".
   *  - "bottom"           — The Family Madrigal rest, DYB, Powerline
   *  - "top"              — The Family Madrigal uses top, Kida Creative Thinker
   *  - "discard"          — Robin Hood Sharpshooter "put the rest in your discard"
   *  - "inkwell_exerted"  — What Else Can I Do? "Put one into your hand and the
   *                         other into your inkwell facedown and exerted." —
   *                         pick goes to hand (pickDestination default), rest
   *                         (1 card) goes to inkwell facedown+exerted. */
  restPlacement?: "top" | "bottom" | "discard" | "inkwell_exerted";
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply this effect. For
   *  "up_to_n_to_hand_rest_bottom" specifically: when true, phase 2 (the pick)
   *  is optional — player can take 0 to maxToHand cards ("You may reveal...").
   *  When false, phase 2 is mandatory — must take exactly maxToHand if enough
   *  valid cards exist ("Put 2 into your hand"). Default: false. */
  isMay?: boolean;
  /** For "up_to_n_to_hand_rest_bottom": are the picked cards revealed to the
   *  opponent ("you may reveal X and put it into your hand" → true) or do
   *  they go to hand privately ("put 2 into your hand" → false/undefined)?
   *  Default: false. */
  revealPicks?: boolean;
}

/**
 * Each target player chooses and discards cards from hand.
 * amount: "all" discards entire hand (no choice). DynamicAmount supported
 * for "discard that many" patterns where the count derives from another
 * effect or board state (Tramp Street-Smart Dog HOW'S PICKINGS?: "draw a
 * card for each other character you have in play, then choose and discard
 * that many cards" — both the draw and the discard use the same
 * {type:"count", filter:...} expression).
 */
export interface DiscardEffect {
  type: "discard_from_hand";
  amount: DynamicAmount | "all" | "any";
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
  /** Optional gating condition. Used by Launchpad - Trusty Sidekick WHAT DID
   *  YOU NEED? "...choose and discard a card UNLESS you have a character named
   *  Darkwing Duck in play" — wired as a `not(has_character_named)` condition
   *  so the discard is skipped when the unless-clause holds. Honored by
   *  CONDITION_GATED_EFFECTS in reducer.ts. */
  condition?: Condition;
}

// ConditionalOnTargetEffect → SelfReplacementEffect (with `target` set).
// ConditionalOnLastDiscardedEffect → SelfReplacementEffect (with `target` omitted).
// See SelfReplacementEffect above (CRD 6.5.6).

/** Play a card from some source zone (hand/discard/under/deck/etc.).
 *  Defaults to FREE play (no ink cost). Set `cost: "normal"` to charge the
 *  card's normal ink cost (Lilo Escape Artist, The Black Cauldron, Mystical
 *  Inkcaster — "play it as if it were in your hand"). Renamed from
 *  "play_for_free" since that name was misleading for the paid variants. */
export interface PlayCardEffect {
  type: "play_card";
  /**
   * Where to look for the card. Default: "hand".
   * Use "discard" for "play that song again from your discard" (Ursula - Deceiver of All).
   * Pass an array (e.g. ["hand", "discard"]) for "from your hand or discard" — the
   * choose-from-zone chooser will offer cards from all listed zones (Prince John
   * Gold Lover BEAUTIFUL LOVELY TAXES).
   */
  sourceZone?: ZoneName | ZoneName[];
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
   * Generalization to "play a card from a zone" — see card-status `play_card` capability.
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
  /** Optional gating condition. Right Behind You: "If you have a Seven Dwarfs
   *  character and a Princess character in play, you may play a Seven Dwarfs
   *  character for free." Effect fizzles silently when false (the may-play
   *  branch never surfaces). */
  condition?: Condition;
}

/** Move a card from one zone into its owner's deck, then shuffle. */
export interface ShuffleIntoDeckEffect {
  type: "shuffle_into_deck";
  target: CardTarget;
  /** CRD 6.1.4 */
  isMay?: boolean;
}

/**
 * Put a card into a player's inkwell. Lorcana canonical verb is "put".
 * "exerted" = doesn't add available ink this turn (used next turn).
 * Some cards say "facedown" — digital engine ignores that (all inkwell cards are equal).
 */
export interface PutIntoInkwellEffect {
  type: "put_into_inkwell";
  /** What to put: chosen card, top of deck, self, or mass { all, filter }. */
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
   * "all_matching" attaches one instance of the trigger to EVERY card
   * matching `targetFilter`. Used by Forest Duel ("Your characters gain
   * Challenger +2 and '[floating trigger]' this turn"): the Challenger
   * grant is one effect (target: all), and the floating trigger grant is a
   * sibling effect that needs the same broad scope.
   */
  attachTo?: "self" | "chosen" | "last_resolved_target" | "all_matching";
  targetFilter?: CardFilter;
}

/**
 * CRD 6.2.7.2: Create a delayed triggered ability that fires once at a specific
 * moment later in the game. The ability exists outside the bag until its moment
 * arrives, then it's added to the bag for resolution.
 *
 * Example: Candy Drift — "At the end of your turn, banish them."
 * The "them" is the card resolved by a prior choose_target in the same action.
 */
export interface CreateDelayedTriggerEffect {
  type: "create_delayed_trigger";
  /** When the delayed trigger fires */
  firesAt: "end_of_turn" | "start_of_next_turn";
  /** Effects to apply when the trigger fires */
  effects: Effect[];
  /**
   * What card the delayed trigger targets.
   * "last_resolved_target" — the card resolved by the most recent choose_target
   * (stored in state.lastResolvedTarget). Used for "banish them" where "them"
   * refers to the chosen character from an earlier effect in the same action.
   */
  attachTo: "self" | "last_resolved_target";
}

// -----------------------------------------------------------------------------
// STATIC EFFECTS — Ongoing, passive modifications to game rules
// -----------------------------------------------------------------------------

export type StaticEffect =
  | GainKeywordStatic
  | ModifyStatStatic
  | ModifyStatPerCountStatic
  | ModifyStatPerDamageStatic
  | GetsStatWhileBeingChallengedStatic
  | CantBeChallengedException
  | CostReductionStatic
  | ActionRestrictionStatic
  | ExtraInkPlayStatic
  | SelfCostReductionStatic
  | CanChallengeReadyStatic
  | DamageRedirectStatic
  | ChallengeDamagePreventionStatic
  | ChallengeDamageStatSourceStatic
  | DamagePreventionStatic
  | GrantActivatedAbilityStatic
  | CantActionSelfStatic
  | RestrictRememberedTargetActionStatic
  | GrantPlayForFreeSelfStatic
  | GrantShiftSelfStatic
  | MimicryTargetSelfStatic
  // UniversalShiftSelfStatic / ClassificationShiftSelfStatic — REMOVED 2026-04-30.
  // Per CRD 8.10.8 these are variants of the Shift keyword, not separate
  // statics. KeywordAbility now carries `variant` + `classifier` fields
  // (see definition above). All affected card data was migrated by
  // scripts/migrate-shift-variants.ts.
  | ModifyWinThresholdStatic
  | SkipDrawStepSelfStatic
  | CanQuestTurnPlayedStatic
  | TopOfDeckVisibleStatic
  | MoveToSelfCostReductionStatic
  | EnterPlayExertedStatic
  | EnterPlayExertedSelfStatic
  | StatFloorPrintedStatic
  | SingCostBonusHereStatic
  | SingCostBonusCharactersStatic
  | GrantTraitStatic
  | ConditionalChallengerSelfStatic
  | InkwellEntersExertedStatic
  | PreventLoreLossStatic
  | PreventLoreGainStatic
  | ForcedTargetPriorityStatic
  | RemoveNamedAbilityStatic
  | RemoveKeywordStatic
  | PreventDiscardFromHandStatic
  | OneChallengePerTurnGlobalStatic
  | InkFromDiscardStatic
  | GrantTriggeredAbilityStatic
  | DeckRuleStatic
  | AllHandInkableStatic
  | PreventDamageRemovalStatic
  | GlobalMoveCostReductionStatic
  | GrantKeywordWhileBeingChallengedStatic;

/**
 * Moana - Curious Explorer (Set 11): "ANCESTRAL LEGACY You can ink cards from
 * your discard." Adds the controller's discard zone as a valid source for the
 * PLAY_INK action. Inkable check still applies (CRD 4.2.1).
 */
export interface InkFromDiscardStatic {
  type: "ink_from_discard";
}

/**
 * Captain Hook - Master Swordsman (Set 3): "Characters named Peter Pan lose
 * Evasive and can't gain Evasive." Suppresses a keyword on all matching
 * characters. The gameModifiers scanner collects these into suppressedKeywords;
 * hasKeyword / getKeywordValue consult the map and return false / 0 when
 * suppressed.
 */
export interface RemoveKeywordStatic {
  type: "remove_keyword";
  keyword: Keyword;
  target: CardTarget;
}

/**
 * Flotsam - Ursula's Baby (Set 4): "Your characters named Jetsam gain
 * 'When this character is banished in a challenge, return this card to your
 * hand.'" Grants a triggered ability to matching characters via static effect.
 * The trigger scanner checks grantedTriggeredAbilities in addition to the
 * card's own definition abilities.
 */
export interface GrantTriggeredAbilityStatic {
  type: "grant_triggered_ability";
  target: CardTarget;
  ability: TriggeredAbility;
}

/**
 * Record Player (Set 4): "Your characters named Stitch count as having +1
 * cost to sing songs." A permanent static bonus to sing eligibility for
 * characters matching the filter. Unlike SingCostBonusHereStatic (location-
 * scoped) or SingCostBonusTargetEffect (timed, per-character), this applies
 * to all matching in-play characters continuously.
 */
export interface SingCostBonusCharactersStatic {
  type: "sing_cost_bonus_characters";
  amount: number;
  target: CardTarget;
}

/** Hidden Inkcaster (Set 4): "All cards in your hand count as having {IW}."
 *  Makes all cards in the controller's hand inkable regardless of the card's
 *  printed inkable flag. Validator consults allHandInkable Set<PlayerID>. */
export interface AllHandInkableStatic {
  type: "all_hand_inkable";
}

/** Vision Slab (Set 4): "Damage counters can't be removed." Global effect
 *  that prevents all damage removal (remove_damage effects fizzle). */
export interface PreventDamageRemovalStatic {
  type: "prevent_damage_removal";
}

/** Deck-building rule with no in-game effect. Examples:
 *  - Dalmatian Puppy: "You may have up to 99 copies in your deck."
 *  - Glass Slipper: "You may only have 2 copies in your deck."
 *  - Microbots: "You may have any number of cards named Microbots in your deck."
 *  The engine doesn't enforce deck construction — this is a no-op marker that
 *  documents the rule and stops audit scripts from flagging the card. */
export interface DeckRuleStatic {
  type: "deck_rule";
  rule: string;
}

/** Map of Treasure Planet (Set 3): "You pay 1 {I} less to move your characters
 *  to a location." Global move cost reduction from an item (not a location).
 *  Unlike move_to_self_cost_reduction (location-keyed), this applies to ALL
 *  move destinations. Reducer subtracts from move cost before deducting ink.
 *
 *  Raksha Fearless Mother (Set 10) ON PATROL: "Once during your turn, you may
 *  pay 1 {I} less to move this character to a location." — uses
 *  `selfOnly: true` to scope to only the source character's moves and
 *  `oncePerTurn: true` for the once-per-turn gating (consumed marker stored on
 *  source.oncePerTurnTriggered, keyed by storyName). */
export interface GlobalMoveCostReductionStatic {
  type: "global_move_cost_reduction";
  amount: number;
  filter?: CardFilter;
  /** Only applies when the moving character IS the source of this static
   *  (e.g. Raksha — "to move THIS character"). */
  selfOnly?: boolean;
  /** CRD 6.1.13: only one move per turn benefits from this reduction.
   *  Marker key = ability storyName, stored on source instance's
   *  oncePerTurnTriggered map. */
  oncePerTurn?: boolean;
}

/** Captain Amelia (Set 6): "While being challenged, your other characters gain
 *  Resist +1." Grants a keyword that only activates during challenge resolution
 *  (defender taking damage). The challenge resolver checks this modifier. */
export interface GrantKeywordWhileBeingChallengedStatic {
  type: "grant_keyword_while_being_challenged";
  keyword: Keyword;
  value?: number;
  target: CardTarget;
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

/** Captain Hook - Master Swordsman (Set 3): "Characters named Peter Pan lose


/**
 * Koda - Talkative Cub (Set 5): "During opponents' turns, you can't lose lore."
 * Gated by ability.condition (e.g. not(is_your_turn)). When active, the
 * controller's lore is shielded from `lose_lore` effects.
 */
export interface PreventLoreLossStatic {
  type: "prevent_lore_loss";
}

/**
 * Peter Pan - Never Land Prankster (Set 6): "While this character is exerted,
 * each opposing player can't gain lore unless one of their characters has
 * challenged this turn." A static (gated by
 * compound_and(this_is_exerted, opponent_no_challenges_this_turn)) that
 * shields the affected player from `gain_lore` effects.
 */
/**
 * John Smith - Undaunted Protector (Set 11): "DO YOUR WORST Opponents must
 * choose this character for actions and abilities if able." A taunt: when an
 * opponent enumerates valid targets for an effect, if the source instance is
 * in the raw valid set, the choice is narrowed to just the source (and any
 * other taunting characters of the source's owner). "If able" — the
 * restriction only applies when the source is a legal target for that effect;
 * otherwise the opponent is free to pick anyone in the raw set.
 */
export interface ForcedTargetPriorityStatic {
  type: "forced_target_priority";
}

export interface PreventLoreGainStatic {
  type: "prevent_lore_gain";
  /** Whose lore gain is prevented. Resolved relative to the source's owner. */
  affectedPlayer: PlayerTarget;
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

/** Record Player HIT PARADE (Set 4): "Your characters named Stitch count as

/**
 * Chief Bogo - Calling the Shots (Set 10): "DEPUTIZE Your other characters
 * gain the Detective classification." Static that grants a trait at runtime,
 * making characters that don't intrinsically have the trait count as having
 * it for hasTrait/hasAnyTrait filter checks. Populated in a PRE-PASS during
 * gameModifiers collection so that downstream statics (e.g. Judy Hopps Lead
 * Detective's grant_keyword target: hasTrait Detective) see the granted
 * traits during the same iteration.
 */
export interface GrantTraitStatic {
  type: "grant_trait_static";
  /** The trait to grant (e.g. "Detective"). */
  trait: string;
  /** Which characters receive the trait — "this" or "all" with a filter. */
  target:
    | { type: "this" }
    | { type: "all"; filter: CardFilter };
}

/**
 * Naveen's Ukulele - MAKE IT SING (Set 6): "Chosen character counts as having
 * +N cost to sing songs this turn." Targeted, turn-scoped variant of
 * SingCostBonusHereStatic — applied as a TimedEffect (`type: "sing_cost_bonus"`)
 * on the chosen character. The validator's sing-eligibility check sums these
 * timed effects on the singer in addition to any location bonus from the
 * singer's atLocation.
 */
export interface SingCostBonusTargetEffect {
  type: "sing_cost_bonus_target";
  target: CardTarget;
  amount: number;
  duration: EffectDuration;
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

/** CRD 6.7.8: "This character/item enters play exerted." Self-targeting
 *  entry modifier — the card itself enters exerted. No filter needed. */
export interface EnterPlayExertedSelfStatic {
  type: "enter_play_exerted_self";
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
 * Dash Parr - Lava Runner (Set 12) RECORD TIME: "This character can quest the
 * turn he's played." Extends the drying exemption (already granted to Rush for
 * challenges per CRD 8.9.1) to cover quests on the ability owner.
 * validateQuest consults modifiers.canQuestTurnPlayed to bypass the
 * CRD 5.1.1.11 drying block.
 */
export interface CanQuestTurnPlayedStatic {
  type: "can_quest_turn_played";
  target: CardTarget;
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

// UniversalShiftSelfStatic / ClassificationShiftSelfStatic — REMOVED 2026-04-30.
// Per CRD 8.10.8 (Universal Shift = 8.10.8.2, Classification / [Trait] Shift
// = 8.10.8.1) these are variants of the Shift keyword, not standalone
// statics. The KeywordAbility interface now carries `variant: "universal" |
// "classification"` and `classifier: string` fields; all affected card data
// was migrated by scripts/migrate-shift-variants.ts.
//
// Don't reintroduce these StaticEffects — fresh imports go straight to
// keyword-variant form via parseKeywordAbilities (scripts/import-cards-rav.ts).

/**
 * Permanent self-restriction: this character can't perform `action`.
 * Used for cards like Maui - Whale ("This character can't ready at the start of your turn").
 * Differs from CantActionEffect (a one-shot timed debuff applied to a target) — this is a
 * static, never-expiring restriction tied to the source instance.
 */
export interface CantActionSelfStatic {
  type: "cant_action_self";
  action: RestrictedAction;
  /** Optional "unless you pay X" gate. When present, the restriction is
   *  BYPASSABLE by paying these costs at action time. Used by RC
   *  Remote-Controlled Car ("This character can't quest or challenge unless
   *  you pay 1 {I}. (You pay this cost each time.)"). Cost is paid per action,
   *  not once per turn. Validator + legal-action enumerator must check the
   *  costs are payable before allowing the action; the reducer pays them
   *  when the action resolves. */
  unlockCost?: Cost[];
}

/**
 * Static restriction applied to whichever instances the SOURCE has marked as
 * remembered (via remember_chosen_target on enters_play). Used by Elsa's Ice
 * Palace ETERNAL WINTER: when the source location is in play AND has a
 * remembered target, that target gets `cant_action ready`. The static is
 * iterated by gameModifiers each call, so when the source leaves play the
 * restriction stops applying automatically.
 */
export interface RestrictRememberedTargetActionStatic {
  type: "restrict_remembered_target_action";
  action: RestrictedAction;
}

/**
 * Pudge - Controls the Weather (Set 11) GOOD FRIEND: "If you have a character
 * named Lilo in play, you can play this character for free." A conditional
 * static with `activeZones: ["hand"]`. When the condition holds, the in-hand
 * source instance gains an alternative play mode at cost 0. Surfaced as a
 * separate PLAY_CARD legal action variant alongside the normal-cost play —
 * the player can choose either. Distinct from `self_cost_reduction`, which
 * is the LeFou Bumbler / Lantern / Grandmother Willow pattern (a MANDATORY
 * flat reduction with no alternative path).
 */
export interface GrantPlayForFreeSelfStatic {
  type: "grant_play_for_free_self";
  /** Optional costs that must be paid to use the free-play mode. When absent,
   *  the play is unconditionally free (Pudge, LeFou, Lilo Uproar — condition-
   *  gated only). When present, the validator checks the costs are payable and
   *  the legal-action enumerator surfaces one action per valid cost target.
   *  Belle Apprentice Inventor: [{ type: "banish_chosen", filter: items }]
   *  Scrooge Resourceful Miser: [{ type: "exert_n_matching", count: 4, filter: items }]
   */
  playCosts?: PlayForFreeCost[];
}

/** Cost that must be paid as part of a granted free-play mode. */
export type PlayForFreeCost =
  | { type: "banish_chosen"; filter: CardFilter }
  | { type: "exert_n_matching"; count: number; filter: CardFilter }
  | { type: "discard"; filter?: CardFilter; amount: number };

/**
 * Anna - Soothing Sister (Set 11) UNUSUAL TRANSFORMATION: "this card gains
 * Shift N {I}." A conditional static with `activeZones: ["hand"]` that adds
 * a granted Shift cost on the in-hand instance. The validator's PLAY_CARD
 * shift branch reads `def.shiftCost ?? mods.grantedShiftSelf.get(instanceId)`
 * and the legal-action enumerator surfaces shift target variants the same
 * way it does for cards with a printed Shift cost. Distinct from
 * `grant_play_for_free_self` (different validator path — Shift goes through
 * the cards-under placement / inheritance flow per CRD 8.10.4).
 */
export interface GrantShiftSelfStatic {
  type: "grant_shift_self";
  value: number;
}

/** This character can challenge ready (non-exerted) characters. Used both
 *  as a static (permanent on the source while in play — Captain Hook Newly
 *  Promoted, Gizmoduck Suited Up) and as a TIMED action effect ("this turn"
 *  on a chosen target — One Last Hope Hero clause). When `duration` is set,
 *  the effect routes through applyEffect's case branch and pushes a
 *  TimedEffect{type:"can_challenge_ready"} onto the target's timedEffects;
 *  the validator reads both that timedEffects entry AND the permanent
 *  modifiers.canChallengeReady map. */
export interface CanChallengeReadyStatic {
  type: "can_challenge_ready";
  target: CardTarget;
  /** Optional duration for timed grants (One Last Hope Hero clause). When
   *  unset, the effect is static and lives in modifiers.canChallengeReady. */
  duration?: EffectDuration;
  /** Optional gating condition. Used to express "if a Hero character is
   *  chosen" via last_resolved_target_has_trait. Honored by
   *  CONDITION_GATED_EFFECTS in reducer.ts. */
  condition?: Condition;
  /** Optional defender restriction. Gizmoduck Suited Up: only damaged ready
   *  defenders. Darkwing Duck Cool Under Pressure: only Villains. When unset,
   *  the override applies to any ready defender. */
  defenderFilter?: CardFilter;
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
export interface ChallengeDamagePreventionStatic {
  type: "challenge_damage_prevention";
  /** Only immune when challenging characters matching this filter */
  targetFilter?: CardFilter;
}

/**
 * Dale - Ready for His Shot SPIKE SUIT: "During challenges, your characters
 * deal damage with their {W} instead of their {S}."
 *
 * Game-rule modifier family (same shape pattern as modify_win_threshold,
 * ink_from_discard, skip_draw_step_self, etc.): overrides one CRD rule
 * for the affected player's characters. This one swaps the damage-source
 * stat for CRD 4.6.6 (Challenge Damage Step).
 *
 * Scope is role-agnostic: the override applies whenever an affected
 * player's character is dealing challenge damage, regardless of whether
 * they're the attacker or defender in the current challenge. Reader looks
 * up the damage-dealer's ownerId in modifiers.challengeDamageStatSource.
 *
 * affectedPlayer:
 *   "self"     — only the controlling player's characters (Dale)
 *   "opponent" — opposing player's characters (hypothetical debuff)
 *   "both"     — all characters in the game
 *
 * New rule-benders should prefer explicit affectedPlayer over "_self"-
 * suffixed names so future sets that broaden scope don't need new
 * discriminators.
 */
export interface ChallengeDamageStatSourceStatic {
  type: "challenge_damage_stat_source";
  /** Which stat to use as the damage source during challenges */
  stat: "strength" | "willpower";
  /** Who the override applies to */
  affectedPlayer: "self" | "opponent" | "both";
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
  amount: number;
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
export interface GetsStatWhileBeingChallengedStatic {
  type: "gets_stat_while_being_challenged";
  stat: "strength" | "willpower";
  amount: number;
  /** Default "self" — modifies the defender (this card). "attacker" applies the
   *  amount to the challenging character instead (Louie One Cool Duck:
   *  "the challenging character gets -1 {S}"). */
  affects?: "self" | "attacker";
}

export interface CantBeChallengedException {
  type: "cant_be_challenged";
  target: CardTarget;
  /** If set, only attackers matching this filter are blocked (Captain Hook: cost ≤ 3 can't challenge this) */
  attackerFilter?: CardFilter;
}


/** Static cost reduction (Mickey Wayward Sorcerer: Broom chars cost 1 less).
 *  Owl Island: dynamic amount { type: "count", filter: chars at this location }. */
export interface CostReductionStatic {
  type: "cost_reduction";
  amount: number | { type: "count"; filter: CardFilter };
  /** Filter for which cards get the discount */
  filter: CardFilter;
  /** Scope of the discount. Default "all" — both normal play and Shift cost.
   *  "shift_only" — only when paying Shift cost (Yokai Intellectual Schemer
   *  "you pay 1 less to play characters using their Shift ability"). */
  appliesTo?: "all" | "shift_only";
  /** Whose cards are affected. Default "self" — the source's owner.
   *  "opponent" — only the opponent's cards. "both" — all players.
   *  Gantu Experienced Enforcer: "Each player pays 2 {I} more" uses "both"
   *  with a negative amount. */
  affectedPlayer?: PlayerTarget;
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
  /** Resolves to `state.currentPlayer` — the player whose turn it currently
   *  is. For triggered abilities watching `turn_end` / `turn_start` with
   *  `player: "both"`, this scopes the effect to whichever player's turn is
   *  ending/starting, since the turn transition hasn't happened yet at trigger
   *  resolution time. Goliath Clan Leader DUSK TO DAWN ("at the end of each
   *  player's turn, if they..."). Distinct from `self` (source's owner) and
   *  from `triggering_player` (which would require trigger context plumbing). */
  | { type: "active_player" }
  /** "Chosen player" — controller picks any player. Surfaces a choose_player
   *  pendingChoice. Set excludeSelf for "chosen opponent" patterns (in 2P this
   *  collapses to a single valid target → auto-resolves; in 3+P it'd genuinely
   *  prompt the controller to pick among opponents).
   *  Used by Second Star to the Right ("Chosen player draws 5 cards"),
   *  Mad Hatter, Madame Medusa, Water Has Memory, Copper Hound Pup, etc. */
  | { type: "chosen"; excludeSelf?: boolean }
  /** "The player or players with the most cards in their hand" — Search for
   *  Clues. Expands to every player whose hand size equals the max (tie
   *  = both players). */
  | { type: "players_with_most_cards_in_hand" };

export type CardTarget =
  | { type: "this" } // The card itself
  /** Player picks count card(s) (default 1). `chooser` defaults to "controller";
   *  set "target_player" for "each opponent chooses one of their characters and X"
   *  patterns (Ursula's Plan, Be King Undisputed, Triton's Decree, Gunther
   *  Interior Designer). The pendingChoice surfaces with the opponent as the
   *  choosing player; the effect then applies to the chosen instance.
   *
   *  `count` — numeric cap on the selection (up-to-N, pick 0..count). Pass
   *  `"any"` for unbounded selection ("any number of chosen X" — Leviathan,
   *  Ever as Before, Royal Tantrum). The legacy `count: 99` idiom is
   *  equivalent to `"any"` but prefer the named sentinel.
   *
   *  `totalXAtMost` / `totalXAtLeast` — aggregate-sum constraints on the
   *  selection set (CRD-less novel primitive; used by Leviathan "total {S}
   *  10 or less"). All 10 fields are independently optional; when multiple
   *  constraints are present, ALL must be satisfied on RESOLVE_CHOICE (strictest
   *  wins). Composable with `count` (e.g. "up to 3 chosen with total cost ≤ 6").
   *  Effective values (post-buff/post-modifier) are used, not printed, per
   *  CRD 1.9.2 — `getEffectiveStrength` etc. */
  | {
      type: "chosen";
      filter: CardFilter;
      count?: number | "any";
      chooser?: "controller" | "target_player";
      totalStrengthAtMost?: number;
      totalStrengthAtLeast?: number;
      totalWillpowerAtMost?: number;
      totalWillpowerAtLeast?: number;
      totalCostAtMost?: number;
      totalCostAtLeast?: number;
      totalLoreAtMost?: number;
      totalLoreAtLeast?: number;
      totalDamageAtMost?: number;
      totalDamageAtLeast?: number;
    }
  | { type: "all"; filter: CardFilter } // All matching cards
  | { type: "random"; filter: CardFilter } // Random matching card
  | { type: "triggering_card" } // The card that caused the trigger
  /** The most recently chosen target (state.lastResolvedTarget). Used by
   *  reward effects in a SequentialEffect that need to apply to the same
   *  chosen target the cost step picked — Mother Gothel KWB damages a chosen
   *  character then grants Challenger to that same chosen, etc. Resolves at
   *  effect-application time against state.lastResolvedTarget.instanceId. */
  | { type: "last_resolved_target" }
  /** The card most recently moved to discard by choose_discard /
   *  discard_from_hand. Reads state.lastDiscarded[0]. Used by Jafar High
   *  Sultan of Lorcana ("if an Illusion character card is discarded this way,
   *  you may play that character for free") so the play targets the EXACT
   *  discarded instance, not just any matching card in discard. */
  | { type: "from_last_discarded" }
  /** All characters who sang the most recent song (state.lastSongSingerIds).
   *  For solo sings this is a single card; for Sing Together it's the full
   *  N-singer roster. Used by Alma Madrigal THE MIRACLE IS YOU: "ready those
   *  characters" — needs the multi-singer set, not just the trigger's
   *  triggering_card (which would only be one of N). */
  | { type: "last_song_singers" };

/** A numeric stat axis a CardFilter can compare against. */
export type StatName = "cost" | "strength" | "willpower" | "lore" | "damage";

/** Comparison operator for StatComparison. `lte` = ≤, `gte` = ≥, etc. */
export type StatOp = "lte" | "gte" | "lt" | "gt" | "eq";

/** Either a literal number OR a dynamic reference to another card's stat.
 *  Used by `StatComparison.value` so every numeric filter axis can take
 *  either a static cap or a reference without needing a per-axis flat field.
 *
 *  When `property` is omitted, the reference reads the SAME stat as the
 *  enclosing comparison — so `{from: "last_resolved_source"}` inside a
 *  `{stat: "cost"}` comparison reads `lastResolvedSource.cost`, and the
 *  same shape inside a `{stat: "strength"}` comparison reads
 *  `lastResolvedSource.strength`. Override `property` for cross-axis
 *  references like Magica De Spell's "cost ≤ this character's strength"
 *  (→ `{stat: "cost", op: "lte", value: {from: "source", property: "strength"}}`).
 *
 *  `offset` adds an arithmetic adjustment (Retro Evolution Device's "cost
 *  up to 2 more than the banished character" → `{from: "last_resolved_source",
 *  offset: 2}`). Defaults to 0. */
export type StatValue = number | {
  from: "last_resolved_source"
      | "last_banished_source"
      | "source"
      | "triggering_card"
      | "last_resolved_target";
  property?: StatName;
  offset?: number;
};

/** One AND-ed comparison inside `CardFilter.statComparisons`. The effective
 *  stat named by `stat` (printed value + runtime modifiers — uses
 *  getEffectiveStrength / getEffectiveWillpower / getEffectiveLore; cost is
 *  printed, damage is from the instance) is compared with `op` against
 *  `value` (static or dynamic). Each comparison's `value` is resolved at
 *  match time against the passed-in state. */
export interface StatComparison {
  stat: StatName;
  op: StatOp;
  value: StatValue;
}

export interface CardFilter {
  owner?: PlayerTarget;
  zone?: ZoneName | ZoneName[];
  cardType?: CardType[];
  inkColors?: InkColor[];
  hasTrait?: string;
  /** Match cards that have ANY of these traits */
  hasAnyTrait?: string[];
  /** Match cards that do NOT have this trait. Used by Don Karnage Air
   *  Pirate Leader SCORNFUL TAUNT ("Whenever you play an action that
   *  isn't a song, ..."). */
  hasNoTrait?: string;
  hasKeyword?: Keyword;
  /** Negated keyword check — matches cards that do NOT have the keyword.
   *  Used by Tug-of-War ("each opposing character without Evasive"). */
  lacksKeyword?: Keyword;
  /** Structured per-axis numeric comparisons. Replaces the former flat
   *  `costAtMost` / `costAtLeast` / `strengthAtMost` / `strengthAtLeast` /
   *  `willpowerAtMost` / `willpowerAtLeast` fields AND the three dynamic
   *  variants (`costAtMostFromLastResolvedSourcePlus`,
   *  `costAtMostFromSourceStrength`, `strengthAtMostFromBanishedSource`).
   *
   *  Each entry is `{stat, op, value}`. Entries AND together — a card
   *  matches the filter only if every comparison in the array is satisfied.
   *  Compound filters (e.g. "cost ≤ 5 AND strength ≥ 3") are expressed as
   *  two entries.
   *
   *  `value` is either a literal number or a dynamic `{from, property?, offset?}`
   *  reference. See StatValue for the reference semantics.
   *
   *  Uses of each axis today:
   *    cost      — Just in Time "cost 5 or less", Bibbidi Bobbidi Boo
   *                "same cost or less", Retro Evolution Device "cost up to
   *                2 more", Magica De Spell "cost ≤ source's strength"
   *    strength  — many static caps + Wreck-it Ralph "{S} ≤ banished source {S}"
   *    willpower — static caps only (Chip, Monterey Jack)
   *    lore      — no current users; available for future cards
   *    damage    — no current users; available for future cards */
  statComparisons?: StatComparison[];
  isExerted?: boolean;
  /** Exclude a specific card instance (e.g. Support can't target itself) */
  excludeInstanceId?: string;
  /** Exclude the source card (for "other" effects — resolved at runtime) */
  excludeSelf?: boolean;
  /** Inverse of excludeSelf: require the matched card to BE the source. Used
   *  by triggers like Simba King in the Making's "Whenever you put a card
   *  under THIS character" — without this flag, having two Simbas in play
   *  fires the trigger on both copies whenever any one of them receives a
   *  card under it (the cross-card trigger path matches `owner: self` against
   *  any owned carrier). With `isSelf: true` the cross-card path's filter
   *  match additionally requires `instance.instanceId === sourceInstanceId`,
   *  which only the watcher whose own event fired can satisfy. */
  isSelf?: boolean;
  /** Match by card name (e.g. "Fire the Cannons!", "Te Kā") */
  hasName?: string;
  /** Negated name match — card name must NOT equal this value. Used by
   *  Mor'du Savage Cursed Prince ("your characters not named Mor'du"). */
  notHasName?: string;
  /** Match cards whose name equals `state.lastResolvedSource.name`. Used by
   *  Hades Double Dealer ("play a character with the same name as the banished
   *  character"). Resolved at match time against the live state. */
  nameFromLastResolvedSource?: boolean;
  /** Match cards whose name equals `state.lastResolvedTarget.name`. Used by
   *  We Know the Way ("if it has the same name as the chosen card"). */
  nameFromLastResolvedTarget?: boolean;
  /** Match cards whose name equals the source instance's name. Used by
   *  Bad-Anon Villain Support Center grant — Villain characters there can
   *  play a character with the same name as themselves. Resolved against the
   *  source instance ID passed into matchesFilter. */
  nameFromSource?: boolean;
  /** Match characters with damage > 0 */
  hasDamage?: boolean;
  // NOTE: strengthAtMost / strengthAtLeast / willpowerAtMost / willpowerAtLeast
  // have been removed — use `statComparisons` (defined above) instead. The
  // migration on 2026-04-24 collapsed all numeric axes into one structured field.
  /** Match characters that were challenged this turn */
  challengedThisTurn?: boolean;
  /** CRD 8.4.2: Match characters/locations with at least one card in their
   *  cards-under pile ("with a card under them", "while there's a card under"). */
  hasCardUnder?: boolean;
  /** Match cards with the {IW} inkable mark. Used by Stitch Experiment 626
   *  STEALTH MODE ("choose and discard a card with {IW}"). */
  inkable?: boolean;
  /** CRD 5.6.4: Match characters currently at the source location ("while here")
   *  or at any location ("while at a location"). */
  atLocation?: "this" | "any";
  /** OR-of-subfilters at the filter-clause level. The instance matches if it
   *  satisfies ALL of the top-level fields AND ALSO matches at least one of
   *  the `anyOf` entries. Used by John Smith's Compass YOUR PATH ("a character
   *  card with cost 3 or less or named Pocahontas") and any future card with
   *  similar OR'd predicates. Each entry is a full CardFilter, evaluated
   *  recursively — so nested ANDs work inside each anyOf branch. */
  anyOf?: CardFilter[];
}

// -----------------------------------------------------------------------------
// COSTS — What you pay to activate an ability
// -----------------------------------------------------------------------------

export type Cost =
  | { type: "exert" } // Exert this card
  | { type: "pay_ink"; amount: number } // Pay X ink from inkwell
  | { type: "banish_self" } // Banish this card as cost
  | { type: "discard"; filter?: CardFilter; amount: number } // Discard N cards from hand (optionally filtered: e.g. character only, item only)
  | { type: "banish_chosen"; target: CardTarget }; // Banish a chosen target — Lonely Grave: "Banish chosen character of yours"
// Costs are processed by validateActivateAbility (feasibility) + applyActivateAbility:
// the synchronous costs (exert/pay_ink/banish_self) are paid by payCosts(), and
// async costs (discard / banish_chosen) are converted into leading effects in the
// effects array so they flow through the existing pendingChoice + pendingEffectQueue
// pipeline. Keep HANDLED_COST_TYPES in scripts/card-status.ts in sync with this union.

// -----------------------------------------------------------------------------
// TRIGGERS — When triggered abilities fire
// -----------------------------------------------------------------------------

export type TriggerEvent =
  | { on: "enters_play"; filter?: CardFilter }
  | { on: "leaves_play"; filter?: CardFilter }
  | { on: "quests"; filter?: CardFilter }
  | { on: "sings"; filter?: CardFilter }
  /** `filter` matches the source (attacker). `defenderFilter` (optional) also
   *  matches the challenged character — fires only if BOTH are satisfied.
   *  Used by Shenzi Head Hyena, Scar Vengeful Lion, Shenzi Scar's Accomplice,
   *  Prince Phillip Swordsman ("whenever this character challenges a damaged
   *  character"). The defender is passed as triggeringCardInstanceId by the
   *  challenge resolver. */
  | { on: "challenges"; filter?: CardFilter; defenderFilter?: CardFilter }
  | { on: "is_challenged"; filter?: CardFilter }
  | { on: "is_banished"; filter?: CardFilter }
  | { on: "banished_in_challenge"; filter?: CardFilter }
  | { on: "turn_start"; player: PlayerTarget }
  | { on: "turn_end"; player: PlayerTarget }
  | { on: "card_drawn"; player: PlayerTarget }
  | { on: "card_put_into_inkwell"; player: PlayerTarget }
  | { on: "card_played"; filter?: CardFilter }
  // item_played: DELETED — collapsed to card_played with filter cardType:["item"]
  | { on: "banished_other_in_challenge"; filter?: CardFilter }
  // sourceFilter: optional filter on the damage SOURCE's definition — used by
  // Merida Formidable Archer STEADY AIM ("whenever one of your actions deals
  // damage to an opposing character"). The target filter applies to the
  // damaged card; the sourceFilter applies to the source card that dealt
  // the damage.
  | { on: "damage_dealt_to"; filter?: CardFilter; sourceFilter?: CardFilter }
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
  /** CRD 8.4.1: Fires ONLY when a player activates the Boost keyword ability
   *  (not for arbitrary put_top_card_under effects). Filter matches the
   *  character whose Boost was used (the carrier). The carrier is also the
   *  triggering card. Used by Donald Duck Fred Honeywell SPIRIT OF GIVING:
   *  "Whenever you use the Boost ability of a character, you may put the top
   *  card of your deck under them facedown." Distinct from card_put_under
   *  because Donald shouldn't fire on Mickey Bob Cratchit's quest-under. */
  | { on: "boost_used"; filter?: CardFilter }
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
  | { on: "chosen_for_support"; filter?: CardFilter }
  /** Kristoff Icy Explorer (Set 11): "whenever a card leaves your discard". */
  | { on: "card_leaves_discard"; player?: PlayerTarget };

// -----------------------------------------------------------------------------
// CONDITIONS — Guards on triggered/activated abilities
// -----------------------------------------------------------------------------

export type Condition =
  | { type: "opponent_has_lore_gte"; amount: number }
  | { type: "cards_in_hand_gte"; amount: number; player: PlayerTarget }
  /** Count player's characters in play matching optional shortcuts (excludeSelf,
   *  hasName) or a full CardFilter. Hans Brazen Manipulator GROWING
   *  INFLUENCE: "if an opponent has 2 or more READY characters in play"
   *  uses `filter: { isExerted: false }`. */
  | { type: "characters_in_play_gte"; amount: number; player: PlayerTarget; excludeSelf?: boolean; hasName?: string; filter?: CardFilter }
  | { type: "cards_in_hand_eq"; amount: number; player: PlayerTarget }
  | { type: "has_character_named"; name: string; player: PlayerTarget }
  | { type: "has_character_with_trait"; trait: string; player: PlayerTarget; excludeSelf?: boolean }
  | { type: "opponent_has_more_cards_in_hand" }
  | { type: "is_your_turn" }
  | { type: "this_is_exerted" }
  /** True if the count of cards in `zone` for `player` (matching `filter` if
   *  present, else `cardType` array if present, else any) is >= `amount`.
   *  `filter` is the rich form (full CardFilter — `hasDamage`, `hasTrait`,
   *  `isExerted`, `excludeSelf`, etc. — used by Queen of Hearts COUNT OFF! and
   *  similar). `cardType` is a legacy shortcut kept for backward compat with
   *  pre-2026-04-30 cards. If both are present, `filter` wins. */
  | {
      type: "cards_in_zone_gte";
      zone: ZoneName;
      amount: number;
      player: PlayerTarget;
      cardType?: CardType[];
      filter?: CardFilter;
    }
  | { type: "self_stat_gte"; stat: "strength" | "willpower" | "lore"; amount: number }
  | { type: "compound_and"; conditions: Condition[] }
  | { type: "compound_or"; conditions: Condition[] }
  /** Unified "you've played [filter] this turn" condition. Counts entries in
   *  `PlayerState.cardsPlayedThisTurn` (unified list of all card plays)
   *  matching the optional CardFilter. Subsumes the old per-category
   *  conditions (actions_played_this_turn_gte/_eq, songs_played_this_turn_gte,
   *  played_character_with_trait_this_turn, played_another_character_this_turn).
   *  Examples:
   *  - `{amount: 2}` → "played 2 or more cards this turn" (Enigmatic Inkcaster)
   *  - `{amount: 2, filter: {cardType: ["action"]}}` → Airfoil "played 2+ actions"
   *  - `{amount: 1, filter: {hasTrait: "Song"}}` → Powerline "played a song"
   *  - `{amount: 1, filter: {cardType: ["character"], hasTrait: "Princess"}}` → Cinderella
   *  - `{amount: 1, filter: {cardType: ["character"], excludeSelf: true}}` → "another character"
   *  - `{amount: 1, filter: {cardType: ["character"], costAtLeast: 5}}` → Ichabod "cost 5+ character"
   *  - `{amount: 2, op: "=="}` → Minnie Wide-Eyed Diver "second action" exact match */
  | { type: "played_this_turn"; amount: number; op?: ">=" | "=="; filter?: CardFilter }
  | { type: "this_has_no_damage" }
  /** True if this character has damage. Defaults to "any damage" (`amount: 1,
   *  op: ">="`); cards needing a threshold like Luisa Madrigal Confident
   *  Climber I CAN TAKE IT ("if this character has 3 or more damage") set
   *  `amount: 3, op: ">="`. */
  | {
      type: "this_has_damage";
      amount?: number;
      op?: ">=" | "==" | ">" | "<=" | "<";
    }
  | { type: "this_at_location" }
  /** True if any character matching `filter` (default: any character) is at
   *  this source location. Game Preserve EASY TO MISS uses
   *  filter:{hasKeyword:"evasive"} for "While there's a character with
   *  Evasive here". Without filter, matches any character regardless of
   *  owner/keyword/etc. */
  | { type: "this_location_has_character"; filter?: CardFilter }
  /** True if any own character with the given trait is at this location.
   *  Used by Skull Rock Isolated Fortress SAFE HAVEN ("if you have a Pirate character here"). */
  | { type: "this_location_has_character_with_trait"; trait: string }
  /** True if the number of characters (of `player`, default any) at this source
   *  location compares to `amount` per `op` (default ">="). Used for "While you
   *  have N or more characters here, …" (default) — Pride Lands Jungle Oasis;
   *  also "While you have only 1 character here, …" (op "==") — Andy's Room. */
  | {
      type: "characters_here_gte";
      amount: number;
      player?: PlayerTarget;
      op?: ">=" | "==" | ">" | "<=" | "<";
    }
  | { type: "this_has_cards_under" }
  /** CRD 8.4.2: True if the controller has at least one card in play matching
   *  `filter`. Used for "While you have a character or location in play with a
   *  card under them…" (Webby Vanderquack Knowledge Seeker, Flintheart Glomgold,
   *  Kanga Peaceful Gatherer, Lena Sabrewing, Hercules Spectral Demigod).
   *  The filter is evaluated against the controller's play zone; `owner`
   *  defaults to self if unset. */
  | { type: "you_control_matching"; filter: CardFilter; minimum?: number }
  /** Vision Slab DANGER REVEALED: "if an opposing character has damage".
   *  Opponent-scoped counterpart of `you_control_matching`. `minimum`
   *  defaults to 1. */
  | { type: "opponent_controls_matching"; filter: CardFilter; minimum?: number }
  | { type: "your_character_was_damaged_this_turn" }
  | { type: "opposing_character_was_damaged_this_turn" }
  /** CRD 6.5.x: True if ≥ `amount` cards were put into the controller's discard
   *  pile this turn. Set-12 Madrigal theme — Helga Sinclair, Kida, Kashekim,
   *  Lyle's DIRTY TRICKS. Counter lives on PlayerState.cardsPutIntoDiscardThisTurn. */
  | { type: "cards_put_into_discard_this_turn_atleast"; amount: number }
  /** True if the controller removed damage from any of their characters this
   *  turn (binary, not thresholded). Used by Julieta's Arepas THAT DID THE
   *  TRICK — whose oracle explicitly says "this turn". For the ability-local
   *  "this way" variant (Julieta Madrigal - Excellent Cook), use
   *  `last_effect_result` instead — it reads the PRECEDING effect's result
   *  rather than a turn-wide accumulator, which is strictly correct for
   *  oracle wordings that scope to the current ability. */
  | { type: "you_removed_damage_this_turn" }
  /** Compare `state.lastEffectResult` (the outcome of the most recently resolved
   *  effect that writes to it — e.g. remove_damage's actualRemoved, discard
   *  count, cards drawn, damage dealt) against `amount`.
   *
   *  Ability-local by nature: chains of effects within a single ability execute
   *  sequentially, so a `last_effect_result` condition evaluated right after
   *  the effect that wrote the value reads that value exactly. Prefer this
   *  over turn-wide flags (like `you_removed_damage_this_turn`) whenever the
   *  oracle says "this way" / "if any were moved" rather than "this turn".
   *
   *  Julieta Madrigal - Excellent Cook: SIGNATURE RECIPE "If you removed
   *  damage this way, you may draw a card" → `{ comparison: "gte", amount: 1 }`.
   *
   *  Comparators cover the common shapes — "gte" for most "did it happen"
   *  gates, "eq"/"lt" for rare "exactly N" / "fewer than N" oracles. Negation
   *  via the existing `not` combinator (`not(eq N)` = "not equal"). */
  | { type: "last_effect_result"; comparison: "gte" | "lte" | "gt" | "lt" | "eq"; amount: number }
  | { type: "opponent_character_was_banished_in_challenge_this_turn" }
  | { type: "a_character_was_banished_in_challenge_this_turn" }
  /** True if any character was banished from play this turn whose CardDefinition
   *  (+ ownership) matches the given CardFilter. Backed by
   *  PlayerState.banishedThisTurn, which stores the instanceId of each
   *  banished character (instances persist in state.cards after moving to
   *  discard, so the filter is evaluated against a real instance + def).
   *
   *  Both players' lists are OR-combined by default — most oracles don't
   *  restrict by owner. A card that does want owner-scoping specifies
   *  `filter.owner` (`{type: "self"}` → "one of your characters was
   *  banished", `{type: "opponent"}` → "an opposing character was banished").
   *
   *  Supported filter fields: definition-level (`hasName`, `hasTrait`,
   *  `hasAnyTrait`, `cardType`, `cost*`, `inkColors`, `hasKeyword`) + `owner`.
   *  Avoid `zone` in the filter — banished cards typically sit in discard
   *  but that's not what the oracle means by "was banished".
   *
   *  Used by:
   *    - Buzz's Arm MISSING PIECE — `{hasName: "Buzz Lightyear"}`
   *    - Wind-Up Frog ADDED TRACTION — `{hasTrait: "Toy", owner: {type:"self"}}`
   *  Cleared at PASS_TURN for both players. */
  | { type: "character_was_banished_this_turn"; filter: CardFilter }
  | { type: "not"; condition: Condition }
  | { type: "played_via_shift" }
  | { type: "triggering_card_played_via_shift" }
  /** True if the source card was played via Sing. Mirror of `played_via_shift`.
   *  Reads `sourceInstanceId.playedViaSing`. Used by What Else Can I Do?
   *  ("if a character sang this song, your characters gain Ward…") —
   *  evaluated during the song's own effect resolution, while the song
   *  instance is still in the play zone. */
  | { type: "played_via_sing" }
  /** Same check on `triggeringCardInstanceId`. Mirror of
   *  `triggering_card_played_via_shift`. Useful for triggers like "whenever
   *  you play an action, if it was sung, do X" — the action is the
   *  triggering card. */
  | { type: "triggering_card_played_via_sing" }
  /** True if an exerted character is currently at the source location (Ursula's Garden, The Wall). */
  | { type: "this_location_has_exerted_character" }
  /** Any own character at this location with damage > 0. Used by Ratigan's
   *  Party Seedy Back Room MISFITS' REVELRY ("while you have a damaged
   *  character HERE, this location gets +2 {L}"). */
  | { type: "this_location_has_damaged_character" }
  /** True if you control a character in play with strictly more `stat` than every opposing character.
   *  Used by Flynn Rider Frenemy ("more strength than each opposing"), Ariel Treasure Collector
   *  ("more items than each opp" → metric="items_in_play"), HeiHei Bumbling Rooster
   *  (metric="cards_in_inkwell"; inverse — opponent has more → use `not`). */
  | { type: "self_has_more_than_each_opponent"; metric: "strength_in_play" | "items_in_play" | "cards_in_inkwell" | "characters_in_play" | "lore" }
  /** Mirror of self_has_more_than_each_opponent — fires if AT LEAST ONE opponent
   *  strictly exceeds the controller on the given metric. Used by HeiHei
   *  Bumbling Rooster ("if an opponent has more cards in their inkwell than you"),
   *  When You Need Help, Just Call ("if an opponent has more characters in
   *  play than you"), and The Queen - Devious Disguise JEALOUS HEART ("while
   *  an opponent has more lore than you").
   *  Distinct from `not(self_has_more_than_each_opponent ...)` because the
   *  negation also fires on equal counts, which is wrong for "more than" wording. */
  | { type: "opponent_has_more_than_self"; metric: "strength_in_play" | "items_in_play" | "cards_in_inkwell" | "characters_in_play" | "lore" }
  /** UNDERDOG (Set 11): "If this is your first turn and you're not the first
   *  player, ...". True when the controlling player has not yet completed a
   *  turn AND they are NOT state.firstPlayerId. */
  | { type: "your_first_turn_as_underdog" }
  /** Set 11 pacifist cycle (Mother's Necklace, John Smith Snow Tracker):
   *  "if none of your characters challenged this turn". True iff the
   *  controller's aCharacterChallengedThisTurn flag is unset/false. */
  | { type: "no_challenges_this_turn" }
  /** Anna Soothing Sister UNUSUAL TRANSFORMATION: "If a card left a player's
   *  discard this turn". True iff state.cardsLeftDiscardThisTurn is set. */
  | { type: "card_left_discard_this_turn" }
  /** Peter Pan Never Land Prankster: "unless one of their characters has
   *  challenged this turn". True iff the OPPONENT'S
   *  aCharacterChallengedThisTurn flag is unset/false. */
  | { type: "opponent_no_challenges_this_turn" }
  /** Set 11 (Willie the Giant Ghost of Christmas Present): true when this
   *  source instance has had at least one card placed under it this turn. */
  | { type: "this_had_card_put_under_this_turn" }
  /** Player-wide variant: true if YOU put a card under any of your characters
   *  or locations this turn (Boost or put_top_card_under). Distinct from
   *  `this_had_card_put_under_this_turn` which is per-instance — Mulan
   *  Standing Her Ground FLOWING BLADE benefits from any of your put-under
   *  events, not just hers. Reads PlayerState.youPutCardUnderThisTurn. */
  | { type: "you_put_card_under_this_turn" }
  /** Set 10 (Time to Go!): "If that character had a card under them, draw
   *  3 cards instead." True iff state.lastBanishedCardsUnderCount > 0.
   *  Use immediately after a banish step so the snapshot is fresh. */
  | { type: "last_banished_had_cards_under" }
  /** Chicha Dedicated Mother (Set 5): "if it's the Nth card you've put into
   *  your inkwell this turn". True iff PlayerState.inkPlaysThisTurn equals N. */
  | { type: "ink_plays_this_turn_eq"; amount: number }
  /** Ink Amplifier ENERGY CAPTURE: "if it's the second card they've drawn
   *  this turn". Reads cardsDrawnThisTurn on the triggering card's owner
   *  (the player who drew). Falls back to controller if no trigger context. */
  | { type: "triggering_player_draws_this_turn_eq"; amount: number }
  /** Fa Zhou War Hero TRAINING EXERCISES: "if it's the second challenge
   *  this turn". Reads the controller's charactersChallengedThisTurn.
   *  The counter is incremented AT the start of a challenge so this
   *  condition sees the live count at trigger-resolution time. */
  | { type: "character_challenges_this_turn_eq"; amount: number }
  /** Isabela Madrigal Golden Child: "if no other character has quested this
   *  turn". True iff the controller's charactersQuestedThisTurn count is 0
   *  OR the only quester is the source itself. */
  | { type: "no_other_character_quested_this_turn" }
  /** Evil Comes Prepared (set-5/128), Stand By Me (set-9/197), and similar
   *  "if a [Trait] character is chosen" conditional-bonus actions. True iff
   *  state.lastResolvedTarget points to a card whose definition has the named
   *  trait. Used post-choose to gate a bonus effect on the picked card. */
  | { type: "last_resolved_target_has_trait"; trait: string };

export type AbilityTiming = "your_turn_main" | "any_time" | "opponent_turn";

// -----------------------------------------------------------------------------
// TIMED EFFECTS — Temporary modifiers with explicit expiry
// -----------------------------------------------------------------------------

export type EffectDuration =
  | "end_of_turn"
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
  | "until_caster_next_turn"
  /** Containment Unit (Set 11): "while this item is in play." The effect
   *  persists as long as the source card stays in play. Cleanup: the leaving-
   *  play handler removes timed effects with this duration when the source
   *  instance leaves play. */
  | "while_source_in_play";

export interface TimedEffect {
  type: "grant_keyword" | "modify_strength" | "modify_willpower" | "modify_lore"
    | "cant_action" | "can_challenge_ready" | "cant_be_challenged"
    | "damage_prevention"
    /** Per-character timed obligation: "must quest if able during their next
     *  turn". Used by Ariel Curious Traveler / Gaston Frightful Bully /
     *  Rapunzel Ethereal Protector. Parallel to the inherent Reckless "must
     *  challenge if able" check — the validator's pass-turn step iterates
     *  ready own characters with this timed effect and fails the pass when
     *  any of them has a valid quest target. */
    | "must_quest_if_able"
    /** Targeted, turn-scoped sing-cost bonus: "chosen character counts as
     *  having +N cost to sing songs this turn" (Naveen's Ukulele). Mirrors
     *  the location-bound `singCostBonusHere` but applies per-character via
     *  TimedEffect. The validator's sing-eligibility checks sum these in
     *  addition to any location bonus from the singer's atLocation. */
    | "sing_cost_bonus"
    /** Timed keyword suppression: "loses <keyword> this turn". Used by Maui
     *  Soaring Demigod IN MA BELLY ("loses Reckless this turn"). Mirrors the
     *  permanent `remove_keyword` static but scoped to a duration. hasKeyword
     *  respects this timed effect the same way it respects static
     *  suppressedKeywords. */
    | "suppress_keyword";
  keyword?: Keyword | undefined;
  value?: number | undefined;       // for keyword values (e.g. Challenger +N)
  amount?: number | undefined;      // for modify_* effects
  /** For cant_action: which action is restricted */
  action?: RestrictedAction | undefined;
  /** For damage_prevention: which damage sources the bearer is prevented from.
   *  "challenge" — immune only to damage from challenges (Noi, Pirate Mickey).
   *  "all" — prevented from every damage source (Baloo static-equivalent, Nothing We Won't Do).
   *  "non_challenge" — prevented from ability/action damage, still takes challenge damage (Hercules). */
  damageSource?: "challenge" | "all" | "non_challenge" | undefined;
  expiresAt: EffectDuration;
  /** Turn number when this effect was applied (for multi-turn expiry) */
  appliedOnTurn: number;
  /** For until_caster_next_turn: the player who applied this effect (the "you"
   *  in "until your next turn"). Required when expiresAt === "until_caster_next_turn". */
  casterPlayerId?: PlayerID;
  /** For damage_prevention: limited charges (Rapunzel Ready for Adventure
   *  "next time they would be dealt damage they take no damage instead").
   *  Decremented per blocked hit; the timed effect is dropped when charges
   *  reach 0. Undefined = unlimited (default). */
  charges?: number;
  /** Instance that created this effect (for UI: look up card name/text via state.cards[id].definitionId) */
  sourceInstanceId?: string;
  /** Story name of the ability/keyword that produced this effect. Populated
   *  at creation time so the UI can attribute the effect to the right
   *  ability on cards with multiple abilities (e.g. The Queen Conceited
   *  Ruler has Support keyword AND ROYAL SUMMONS — without this the GUI
   *  has to guess). "Support" / "Challenger" / etc. for synthesized keyword
   *  triggers; ability.storyName for explicit triggered/static abilities. */
  sourceStoryName?: string;
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
  /** Per-card deck-construction override derived from a DeckRuleStatic ability
   *  (Dalmatian Puppy 99, Glass Slipper 2, Microbots unlimited). Undefined
   *  means the default 4-copy cap applies. Populated by the importer from the
   *  deck_rule ability's rule prose; UI reads `def.maxCopies ?? 4`. */
  maxCopies?: number;
  /** Classification traits, e.g. ["Hero", "Princess", "Storyborn"] */
  traits: string[];

  // --- Character-only stats ---
  strength?: number;
  willpower?: number;
  /** Lore gained when questing */
  lore?: number;

  // --- Shift ---
  /** If this card has Shift, the ink cost to shift. Mutually exclusive with altShiftCost. */
  shiftCost?: number;
  /** Alternate shift cost: pay a non-ink cost instead of ink to shift.
   *  Diablo - Devoted Herald (Set 4): "Shift — Discard an action card."
   *  Uses the same PlayForFreeCost union as grant_play_for_free_self.playCosts.
   *  Mutually exclusive with shiftCost — these cards have NO ink-based shift path. */
  altShiftCost?: PlayForFreeCost;

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

  // altPlayCost: DELETED — migrated to grant_play_for_free_self with playCosts.
  // Belle now uses a static with playCosts: [{ type: "banish_chosen", filter }].

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
  /** Rarity. Promo/challenge/D23/D100 are the 4 sub-classifications
   *  Ravensburger emits via `special_rarity_id` for what's nominally a
   *  "SPECIAL" rarity at the API's top level — flattened here into the union
   *  so each card has a single canonical rarity field (matches the Lorcana
   *  app's distinct rarity badges 1:1). Pure metadata — does not affect deck
   *  legality, costs, or any gameplay rule.
   *  - "promo"     → P1/P2/P3 numbered promo set cards (~78)
   *  - "challenge" → C1/C2 convention/challenge promos (~60)
   *  - "D23"       → D23 Expo exclusives (~17)
   *  - "D100"      → Disney 100 anniversary cards (~6) */
  rarity:
    | "common" | "uncommon" | "rare" | "super_rare"
    | "legendary" | "enchanted" | "iconic" | "epic"
    | "promo" | "challenge" | "D23" | "D100";
  /** Card art URL from Ravensburger API. Optional — not all sets imported with images. */
  imageUrl?: string;
  /** Foil-treatment image URL for THIS specific printing (same art with foil
   *  overlay). Populated by the Ravensburger importer from RavVariant.Foiled.
   *  Per-JSON-entry scalar; the cardDefinitions build step propagates it onto
   *  the matching entry in variants[]. */
  foilImageUrl?: string;
  /** Alternate visual printings of this card. Populated by the cardDefinitions
   *  build step from matching-slug entries across set JSONs. Variants share
   *  gameplay rules and the 4-copy / maxCopies limit (CRD 1.5.3) because they
   *  all share this CardDefinition's id. Undefined when only one printing
   *  type exists — UI then falls back to imageUrl.
   *
   *  Display-grouped: one entry per CardVariantType (newest setId wins ties).
   *  For the complete set of every printing (including same-rarity cross-set
   *  reprints with different art, e.g. set 1 vs set 9 Captain Hook), read
   *  `printings[]` instead. */
  variants?: CardVariant[];
  /** Complete list of every raw per-printing row that shares this slug — no
   *  per-type deduping. Ordered by CardVariantType (regular → special) then
   *  newest setId first within type. Populated by buildDefinitions alongside
   *  `variants[]`. Needed by the deckbuilder so users can pick e.g. the set 1
   *  vs set 8 art of a common reprint; `variants[]` alone collapses those. */
  printings?: CardVariant[];
  /** Provenance of this card's data. Importers stamp this on write and merge
   *  logic refuses to downgrade (ravensburger > lorcast > manual). Missing is
   *  treated as "ravensburger" for pre-field-introduction back-compat.
   *    - "ravensburger" — from `pnpm import-cards` (official API, main sets + promos)
   *    - "lorcast"      — from `pnpm import-cards --source lorcast` (Quest / FotA gaps)
   *    - "manual"       — hand-entered via /dev/add-card for cards no API publishes yet */
  _source?: "ravensburger" | "lorcast" | "manual";
  /** Pin this card's _source regardless of importer tier. When true, NO importer
   *  overwrites this entry — even if a higher-tier source would. For cards where
   *  Ravensburger's data is wrong and a lower-tier source has the correct data
   *  (e.g. The Bayou's ability name, where Lorcast/printed card disagree with
   *  Ravensburger). Set manually after verifying the data is correct. */
  _sourceLock?: boolean;
  /** Provenance of this card's IMAGE. Tracked independently of `_source`
   *  because text and art can come from different feeds — during pre-release,
   *  Ravensburger often has card text before image art, or vice versa.
   *  Sync scripts stamp this on write and refuse to downgrade (same
   *  ravensburger > lorcast > manual hierarchy as `_source`). Missing is
   *  treated as "none / needs sync" for pre-field-introduction back-compat.
   *    - "ravensburger" — from `pnpm sync-images-rav`
   *    - "lorcast"      — from `pnpm sync-images-lorcast` (fills gaps)
   *    - "manual"       — from `pnpm sync-images-manual` (dev-dropped files) */
  _imageSource?: "ravensburger" | "lorcast" | "manual";
  /** Upstream URL the current R2 image was sourced from. Preserves provenance
   *  so sync scripts can detect upstream rotation (e.g. Ravensburger rotates
   *  their content hash) and re-pull, and so a re-run is idempotent when the
   *  upstream URL hasn't changed. Not meant for UI display — use `imageUrl`
   *  for that (which points at R2). */
  _sourceImageUrl?: string;
  /** Pin this card's image source regardless of sync-script tier. Mirror of
   *  `_sourceLock` but for images — use when a lower-tier source has visibly
   *  better art than a higher-tier one. Rare. Set manually. */
  _imageSourceLock?: boolean;
  /** Ravensburger's `culture_invariant_id` — a stable numeric card ID across
   *  reprints (same printing in set 1 and a P1 reprint share the same id if
   *  they're the same card at the gameplay level; cross-set reprints with
   *  different art get different ids). Exposed so external consumers can
   *  join on Ravensburger's `rav_{id}` convention (e.g. the collection-
   *  tracker app keys on `rav_{culture_invariant_id}`).
   *
   *  Populated by `pnpm import-cards` on the next re-import. Undefined on
   *  older entries; will backfill lazily as the importer is re-run. Not
   *  required by the engine — the engine keys on the slug-based `id`. */
  _ravensburgerId?: number;

  // ── Foil / holographic treatment metadata ─────────────────────────────
  // Populated by the Ravensburger importer from variants[].{Foiled | Regular}
  // (Foiled variant preferred; some Enchanteds carry the data on Regular
  // because they ship foil-only). All optional — Lorcast-sourced cards and
  // pre-foil-era entries may have none. Pure display metadata — the engine
  // does not read these; intended for UI renderers (card modal shader,
  // clip export, creator tooling with foil preview) and external consumers
  // that want to re-render the holographic effect.
  //
  // Data comes directly from Ravensburger's official API; the field names
  // below are snake_case normalizations of the PascalCase strings Rav emits
  // (Ravensburger's `"FreeForm1"` → `"freeform_1"`, etc.).

  /** Base foil treatment. Identifies which holographic shader pattern to
   *  apply. `undefined` means no foil treatment (rare — pre-foil-era stock
   *  or Ravensburger's literal `"None"`).
   *
   *  Note: `calendar_wave` and `sea_wave` are limited-edition holiday/themed
   *  foils Ravensburger emits on specific sets (CalendarWave in 4/6, SeaWave
   *  in 6/7/8). They're legitimate Ravensburger data — renderers that don't
   *  have shader code for them should degrade gracefully (render plain art
   *  with no shine). Same applies to any future foil types not yet in this
   *  enum; the importer logs a warning and skips the field. */
  foilType?:
    | "silver"
    | "lava"
    | "tempest"
    | "satin"
    | "freeform_1"
    | "freeform_2"
    | "vertical_wave"
    | "glitter"
    | "magma"
    | "lore"
    | "rainbow_pillars"
    | "calendar_wave"
    | "sea_wave";
  /** URL of the grayscale luminance mask the shader multiplies with the
   *  foil texture to gate the effect to art-directed regions (character
   *  silhouette, highlights). Ravensburger CDN URL today; will migrate to
   *  self-hosted R2 in Phase 2 alongside card art. */
  foilMaskUrl?: string;
  /** Optional secondary mask for two-layer foil effects (e.g. HighGloss on
   *  Set 5+, MetallicHotFoil on Set 11+). Not present on every card with
   *  a base foilType. */
  foilTopLayerMaskUrl?: string;
  /** Identifies which top-layer shader variant pairs with `foilTopLayerMaskUrl`.
   *  Only populated when a top-layer mask exists. `rainbow_hot_foil` /
   *  `matte_hot_foil` are themed limited-edition variants on specific sets. */
  foilTopLayer?:
    | "high_gloss"
    | "metallic_hot_foil"
    | "snow_hot_foil"
    | "rainbow_hot_foil"
    | "matte_hot_foil";
  /** Per-card art-directed tint color for MetallicHotFoil / SnowHotFoil
   *  top-layer treatments. Hex string like `"#8FD262"`. Missing values fall
   *  back to `#aaa` silver in the renderer. */
  hotFoilColor?: string;

  // ── Foil mask provenance (parallel to _imageSource / _sourceImageUrl) ─
  // Populated by `pnpm sync-foil-masks`. Enables idempotent re-runs (skip
  // when upstream hasn't rotated) + lets re-imports detect whether the
  // current `foilMaskUrl` / `foilTopLayerMaskUrl` are R2-hosted or fresh
  // upstream so the next sync restores them.
  //
  // Foil masks come exclusively from Ravensburger (Lorcast doesn't publish
  // mask data) — `_foilMaskSource` is always "ravensburger" in practice.
  // Tracked anyway so the mask-sync script can refuse tier downgrades,
  // mirroring the _imageSource pattern.
  /** Tier this card's foil masks were synced from. */
  _foilMaskSource?: "ravensburger" | "lorcast" | "manual";
  /** Upstream URL the current R2 base mask was pulled from. Used for
   *  idempotent re-runs + art rotation detection. */
  _foilMaskSourceUrl?: string;
  /** Upstream URL the current R2 top-layer mask was pulled from. Separate
   *  field because a single card has two distinct mask images with their
   *  own upstream URLs and content hashes. */
  _foilTopMaskSourceUrl?: string;
  /** Pin this card's foil masks regardless of sync-script tier — same
   *  pattern as `_sourceLock` / `_imageSourceLock`. Rare. Set manually. */
  _foilMaskSourceLock?: boolean;
}

/** Visual-printing classes. Deckbuilder picker shows one chip per distinct
 *  type a card exposes. Foil treatment is a per-variant flag (foilImageUrl),
 *  not a separate type. */
export type CardVariantType =
  | "regular"    // base printing (common / uncommon / rare / super_rare / legendary)
  | "enchanted"  // alt-art enchanted rarity
  | "iconic"     // iconic rarity (sets 9+)
  | "epic"       // epic rarity (sets 9+)
  | "promo"      // booster promo reprints (P1 / P2 / P3)
  | "special";   // convention / event cards (D23, C1, C2, CP, DIS)

export interface CardVariant {
  type: CardVariantType;
  imageUrl: string;
  /** Foil-treatment URL for the same printing. Undefined when none exists. */
  foilImageUrl?: string;
  /** Source set — "1" / "9" / "P1" / "D23" / etc. Same values as CardDefinition.setId. */
  setId: string;
  /** Collector number within setId */
  number: number;
  /** Rarity of THIS printing (may differ from the canonical CardDefinition.rarity
   *  if e.g. a Common was reprinted as Enchanted). */
  rarity: CardDefinition["rarity"];
  /** Optional human-readable source for UI tooltips ("D23 Expo 2024", etc.) */
  label?: string;
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

  // tempStrengthModifier/tempWillpowerModifier/tempLoreModifier: REMOVED.
  // "this_turn" stat buffs now route through TimedEffects (modify_strength,
  // modify_willpower, modify_lore) which expire via the standard timed-effect
  // cleanup. See refactor commit 00957c8.

  /** Keywords granted by effects this turn */
  grantedKeywords: Keyword[];

  /** Timed effects with explicit duration-based expiry */
  timedEffects: TimedEffect[];

  // --- Shift tracking ---
  /** If this card was shifted, the instanceId of the card it shifted onto */
  shiftedOntoInstanceId?: string;
  /** True if this card was played via Shift this turn */
  playedViaShift?: boolean;
  /** True if this action/song was played via Sing (single or Sing Together).
   *  Set on the SONG instance (not the singer) in applyPlayCard when any
   *  singer is provided. Read by the `played_via_sing` condition during the
   *  song's effect resolution — e.g. What Else Can I Do?'s "if a character
   *  sang this song, your characters gain Ward". Cleared on leave-play
   *  cleanup (CRD 7.1.6), same as playedViaShift. */
  playedViaSing?: boolean;

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

  /** Persistent "remembered" target instance ids set by an effect on this card.
   *  Used by Elsa's Ice Palace ETERNAL WINTER ("When you play this location,
   *  choose an exerted character. While this location is in play, that
   *  character can't ready at the start of their turn.") — the location
   *  remembers the chosen character so a static ability can apply the
   *  cant-ready restriction every gameModifiers iteration. The remembered ids
   *  are NOT timed effects on the targets — they live on the source's instance.
   *  When the source leaves play, gameModifiers no longer iterates its statics,
   *  so the restriction stops applying automatically. */
  rememberedTargetIds?: string[];

  /** Set 10/11 cards-under-this-turn condition (Lady Tremaine Sinister
   *  Socialite, Willie the Giant Ghost of Christmas Present): per-turn count
   *  of cards placed under THIS instance. Reset on PASS_TURN. */
  cardsPutUnderThisTurn?: number;

  /** Lilo Bundled Up: how many charge-based damage immunity blocks this
   *  instance has consumed this turn. Reset on PASS_TURN. */
  damagePreventionChargesUsedThisTurn?: number;

  /** CRD 5.1.1.9–10: true if this card is face-down (e.g., placed under via Boost
   *  from deck top). Cards from play/discard are face-up. Used by UI to determine
   *  whether to show card art or card back in cards-under viewer. */
  isFaceDown?: boolean;

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
  /** Number of cards this player has drawn this turn. Used by Ink Amplifier
   *  ENERGY CAPTURE ("if it's the second card they've drawn this turn").
   *  Reset on PASS_TURN. */
  cardsDrawnThisTurn?: number;
  /** Number of times any of this player's characters has challenged this
   *  turn. Used by Fa Zhou War Hero TRAINING EXERCISES ("if it's the
   *  second challenge this turn"). Reset on PASS_TURN. */
  charactersChallengedThisTurn?: number;
  /** Unified list of instance IDs of EVERY card this player played this turn
   *  (characters, items, locations, actions, songs, shifts, free-plays,
   *  reveal-and-play). Populated by `zoneTransition` whenever `ctx.reason ===
   *  "played"` and `targetZone === "play"`. Cleared on PASS_TURN.
   *
   *  Backs the generic `played_this_turn` condition, which filters this list
   *  by CardFilter to count matching plays. Subsumes the old per-category
   *  counters (actionsPlayedThisTurn, songsPlayedThisTurn,
   *  charactersPlayedThisTurn). */
  cardsPlayedThisTurn?: string[];
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
  /** Number of OPPOSING characters banished in a challenge initiated by this
   *  player this turn. Used by Namaari Resolute Daughter ("For each opposing
   *  character banished in a challenge this turn, you pay 2 {I} less to play
   *  this character"). Incremented in applyChallenge when a defender is
   *  banished. Cleared at PASS_TURN. */
  opposingCharsBanishedInChallengeThisTurn?: number;
  /** Number of cards put into THIS player's discard this turn (from any zone
   *  transition — banish, discard from hand, mill, leaves-play cleanup).
   *  Incremented in zoneTransition when targetZone==="discard" on the owner's
   *  player. Used by set-12 discard-theme cards: Helga Sinclair No Backup Needed
   *  (selfCostReduction condition), Kida Discovering The Unknown / Kashekim
   *  Wise King (on-quest / turn-end inkwell acceleration), Lyle Tiberius Rourke
   *  DIRTY TRICKS (turn-end opponent lore-drain). Cleared at PASS_TURN. */
  cardsPutIntoDiscardThisTurn?: number;
  /** True if a remove_damage effect resolved successfully on one of THIS
   *  player's characters this turn (any amount; the wording "if you removed
   *  damage from a character this turn" is binary, not thresholded). Set in
   *  the remove_damage handler when delta > 0 for an owner:self character.
   *  Used by Julieta's Arepas THAT DID THE TRICK activated ability.
   *  Cleared at PASS_TURN. Mirror of aCharacterWasDamagedThisTurn. */
  youRemovedDamageThisTurn?: boolean;
  /** True if THIS player put a card under one of their characters or
   *  locations this turn (Boost keyword payment OR put_top_card_under
   *  effects like Cheshire Cat Inexplicable, Bambi Ethereal Fawn).
   *  Player-wide flag — distinct from the per-instance `cardsPutUnderThisTurn`
   *  counter which only tracks the recipient character. Used by Mulan
   *  Standing Her Ground FLOWING BLADE: "if you've put a card under one of
   *  your characters or locations this turn, this character takes no damage
   *  from challenges." Cleared at PASS_TURN. */
  youPutCardUnderThisTurn?: boolean;
  /** InstanceIds of characters banished from THIS player's play zone this
   *  turn. Appended on the banish path (reason: "banished"). Instances persist
   *  in state.cards after banish (zone flips to "discard"), so the
   *  `character_was_banished_this_turn` condition can evaluate any
   *  definition-level CardFilter against each stored instance.
   *
   *  The condition OR-combines both players' lists; a card that wants
   *  owner-scoped matching specifies `filter.owner`. Cleared at PASS_TURN
   *  for both players. */
  banishedThisTurn?: string[];
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
  /** Instance that created this entry (for UI: look up card name/text via state.cards[id].definitionId) */
  sourceInstanceId?: string;
}

export interface TurnChallengeBonus {
  strength: number;
  defenderFilter: CardFilter;
}

/** A cost reduction entry that applies to the next matching card played. */
export interface CostReductionEntry {
  amount: number;
  filter: CardFilter;
  /** Instance that created this entry (for UI: look up card name/text via state.cards[id].definitionId) */
  sourceInstanceId?: string;
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

  /** Effects waiting to resolve after a pending choice is resolved.
   *
   *  P1.14 — `abilitySource` carries the producing ability's storyName +
   *  rulesText so any prompt surfaced when these queued effects resume cites
   *  the same source as the original prompt did. Optional: triggers without
   *  a JSON ability (synthesized Support/Challenger) and action cards (no
   *  per-effect storyName) leave it undefined; the prompt builder then falls
   *  back to def.fullName + def.rulesText (for actions) or fullName-only. */
  pendingEffectQueue?: {
    effects: Effect[];
    sourceInstanceId: string;
    controllingPlayerId: PlayerID;
    abilitySource?: { storyName?: string; rulesText?: string };
  } | undefined;

  /** CRD 3.2.3.1: Draw step deferred when a turn_start trigger ("At the start
   *  of your turn", e.g. The Queen Conceited Ruler ROYAL SUMMONS) creates a
   *  pendingChoice. Resumed once trigger stack empties and no choice is pending,
   *  so the mandatory draw happens AFTER all start-of-turn triggers fully
   *  resolve — not before/during them. */
  pendingDrawForPlayer?: PlayerID;

  /** CRD 3.4.1.1/3.2.1.x: When a turn_end triggered ability creates a
   *  pendingChoice (Cinderella Dream Come True "may put a card in inkwell
   *  to draw a card"), the turn transition MUST pause until the choice
   *  resolves — otherwise cardsPlayedThisTurn is reset and later triggers
   *  in the stack fizzle, the active player switches before the effect
   *  finishes, and any chained triggers from within the effect (e.g. a
   *  card_put_into_inkwell triggered by the may-pay inkwell cost) run in
   *  the opponent's turn context. Set by applyPassTurn when
   *  processTriggerStack leaves a pendingChoice; applyAction's outer
   *  post-processing completes the transition once the stack drains. */
  pendingTurnTransition?: PlayerID;

  /** Seeded PRNG state — advances with every random operation */
  rng: RngState;

  /** Log of all actions taken, useful for UI and debugging */
  actionLog: GameLogEntry[];

  /** CRD 6.2.7.1: Floating triggered abilities that last until end of turn */
  floatingTriggers?: FloatingTrigger[];

  /** CRD 6.2.7.2: Delayed triggered abilities that fire once at a specific moment */
  delayedTriggers?: DelayedTrigger[];

  /**
   * CRD 6.4.2.1: Continuous static abilities from resolved effects.
   * Unlike per-card timedEffects, these apply to ALL matching cards —
   * including ones played AFTER the effect resolved.
   * Example: Restoring Atlantis "Your characters can't be challenged until..."
   */
  globalTimedEffects?: GlobalTimedEffect[];

  /** Cards to banish at end of turn (e.g., Gruesome and Grim, Madam Mim - Rival of Merlin) */
  pendingEndOfTurnBanish?: string[];

  /** CRD 6.1.5.1: Result of the last cost effect in a sequential (for "[A]. For each X, [B]" patterns) */
  lastEffectResult?: number;

  /** Snapshot of the last card resolved by a choose_target step. Used by
   *  follow-up effects — "its player draws" (target_owner), "that location's
   *  {L}" (I've Got a Dream: last_target_location_lore), etc. Unified replacement
   *  for the old lastTargetOwnerId / lastTargetInstanceId pair. */
  lastResolvedTarget?: ResolvedRef;

  /** Amount of damage just dealt by the most recent challenge resolution. Set
   *  by performChallenge before queueing the deals_damage_in_challenge trigger,
   *  read by the `last_damage_dealt` DynamicAmount. Used by Mulan Elite Archer
   *  TRIPLE SHOT and Namaari Heir of Fang TWO-WEAPON FIGHTING ("deal the same
   *  amount of damage to another chosen character"). */
  lastDamageDealtAmount?: number;

  /** Snapshot of the most recently banished card's cardsUnder count — captured
   *  before leave-play cleanup clears the array. Read by the
   *  `triggering_card_cards_under_count` DynamicAmount so "draw a card for
   *  each card that was under them" (Donald Duck Fred Honeywell WELL WISHES)
   *  sees the count at trigger resolution time. */
  lastBanishedCardsUnderCount?: number;

  /** Snapshot of the most recently banished card's effective strength
   *  (post-modifiers, including cardsUnder bonuses) — captured before
   *  leave-play cleanup wipes the cards-under pile. Used by the
   *  `strengthAtMostFromBanishedSource` CardFilter flag so Wreck-it Ralph
   *  Raging Wrecker WHO'S COMIN' WITH ME? ("banish all characters with {S}
   *  equal to or less than the {S} he had in play") sees the live strength
   *  before Ralph's POWERED UP bonus evaporated. */
  lastBanishedSourceStrength?: number;

  /** Snapshot of the most recently revealed hand — set by the reveal_hand
   *  effect so the UI can show a modal without needing event listeners. */
  lastRevealedHand?: { playerId: PlayerID; cardIds: string[]; sourceInstanceId: string; privateTo?: PlayerID };

  /** Snapshot of cards revealed to all players during search/look_at_top effects.
   *  Set at the end of applyAction from card_revealed events so multiplayer
   *  clients can read it from synced state (events are transient). Persists until
   *  overwritten by the next action that produces reveals — NOT cleared by
   *  actions with no reveals (the GUI is responsible for dismissing).
   *  `sequenceId` increments on every reveal-producing action so the UI can
   *  distinguish "same card revealed twice" (e.g. quest Daisy → undo → quest
   *  Daisy again reveals the same top card) as two distinct reveals. */
  lastRevealedCards?: { instanceIds: string[]; sourceInstanceId: string; playerId: PlayerID; sequenceId: number };

  /** Snapshot of the last card resolved as a cost-side target (banish/exert chosen
   *  own character inside a sequential cost). Used by reward-side effects like
   *  Hades Double Dealer ("play a character with the same name as the banished
   *  character") and Ambush ("deal damage equal to their {S}"). Reset at the start
   *  of each sequential effect resolution. */
  lastResolvedSource?: ResolvedRef;

  /** Snapshots of cards moved to discard by the most recent choose_discard /
   *  discard_from_hand resolution. Used by Kakamora Pirate Chief ("if a Pirate
   *  card was discarded, deal 3 damage instead of 1") via self_replacement
   *  with no target (state-based condition). Reset on each new discard. */
  lastDiscarded?: ResolvedRef[];

  /** Per-turn flag: any card moved out of any player's discard this turn.
   *  Used by Anna Soothing Sister UNUSUAL TRANSFORMATION ("If a card left a
   *  player's discard this turn, this card gains Shift 0"). Set in moveCard
   *  whenever fromZone === "discard". Cleared on PASS_TURN. */
  cardsLeftDiscardThisTurn?: boolean;

  /** Number of characters that sang the most recently played song. Set by
   *  applyPlayCard's sing path (1 for solo sing, N for Sing Together). Read
   *  by the `song_singer_count` DynamicAmount (Fantastical and Magical:
   *  "draw a card and gain 1 lore for each character that sang this song"). */
  lastSongSingerCount?: number;
  /** Instance IDs of characters that sang the most recent song. Used by I2I
   *  "ready them" to target the singers for post-resolution effects. */
  lastSongSingerIds?: string[];

  /** CRD 4.6.7: while the challenge is "active" — declared but not yet over —
   *  any banish of the attacker or defender is "in a challenge" for trigger
   *  dispatch. The challenge is over only after the bag drains following the
   *  damage step. Marshmallow Persistent Guardian DURABLE relies on this in
   *  CRD Example B: Cheshire Cat's LOSE SOMETHING? resolves from the bag and
   *  banishes Marshmallow; because the challenge isn't over yet, Marshmallow's
   *  banish is still "in a challenge" and DURABLE fires.
   *
   *  Set by applyChallenge at the start; cleared by applyAction's outer wrapper
   *  after processTriggerStack drains the bag. While set, banishCard infers
   *  `fromChallenge`/`challengeOpponentId` for these instances even when the
   *  caller (e.g. a banish effect resolving from the bag) didn't pass them. */
  activeChallengeIds?: { attackerId: string; defenderId: string };

  winner: PlayerID | null;
  isGameOver: boolean;
  /**
   * Why the game ended. `null` while the game is in progress.
   *  - `"lore"`     — winner reached the lore threshold (CRD 1.8.1.1)
   *  - `"deckout"`  — opponent ended turn with empty deck (CRD 2.3.3.2)
   *  - `"concede"`  — opponent resigned (server-side; engine never sets this)
   */
  wonBy: "lore" | "deckout" | "concede" | null;
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
  /** Instance that created this trigger (for UI: look up card name/text via state.cards[id].definitionId) */
  sourceInstanceId?: string;
}

/**
 * CRD 6.2.7.2: A delayed triggered ability that fires once at a specific moment.
 * Unlike floating triggers (which fire repeatedly on matching events), delayed
 * triggers fire exactly once when their moment arrives, then cease to exist.
 */
export interface DelayedTrigger {
  /** When this trigger fires */
  firesAt: "end_of_turn" | "start_of_next_turn";
  /** Effects to apply */
  effects: Effect[];
  /** Player who created the delayed trigger */
  controllingPlayerId: PlayerID;
  /** The specific card instance this trigger targets (e.g., "banish them") */
  targetInstanceId: string;
  /** Instance that created this trigger (for UI: look up card name/text via state.cards[id].definitionId) */
  sourceInstanceId?: string;
}

/**
 * CRD 6.4.2.1: A continuous static ability generated from a resolved effect.
 * Applies to ALL matching cards in play — including ones played after the effect resolved.
 * Checked in getGameModifiers for every card on every query.
 *
 * Contrast with per-card TimedEffect (CRD 6.4.2.2: applied statics) which only
 * affects the specific cards that were in play at resolution time.
 */
export interface GlobalTimedEffect {
  /** What kind of continuous effect this is */
  type: "cant_be_challenged" | "cant_action" | "grant_keyword" | "modify_stat";
  /** Which cards this affects */
  filter: CardFilter;
  /** Player who generated this effect */
  controllingPlayerId: PlayerID;
  /** Instance that created this effect (for UI: look up card name/text via state.cards[id].definitionId) */
  sourceInstanceId?: string;
  /** When this expires */
  expiresAt: EffectDuration;
  /** Turn number when created (for expiry calculation) */
  appliedOnTurn: number;
  /** For cant_action: which action is restricted */
  action?: RestrictedAction;
  /** For grant_keyword: which keyword */
  keyword?: Keyword;
  /** For grant_keyword: +N value (e.g., Resist +1) */
  keywordValue?: number;
  /** For modify_stat: stat changes */
  strength?: number;
  willpower?: number;
  lore?: number;
}

export type GamePhase =
  | "play_order_select" // CRD 2.1.3.2 / 2.2.1: play-draw rule — chooser picks who goes first
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
  /** Which leaf TriggerEvent of `ability.trigger` matched at queue time.
   *  Required when ability.trigger uses the `anyOf` combinator (multiple
   *  leaf specs) so resolution-time checks like `leavesPlayFamily` know
   *  which event actually fired. Optional for back-compat — when ability
   *  has a single bare TriggerEvent the queue path may omit this and
   *  consumers should fall back to `ability.trigger` (which is the leaf). */
  matchedEvent?: TriggerEvent;
}

export interface TriggerContext {
  triggeringCardInstanceId?: string;
  triggeringPlayerId?: PlayerID;
}

export interface PendingChoice {
  type: "choose_mulligan" | "choose_target" | "choose_option" | "choose_cards" | "choose_may" | "choose_discard" | "choose_from_revealed" | "choose_order" | "choose_trigger" | "choose_card_name" | "choose_player" | "choose_players_subset" | "choose_amount" | "choose_play_order";
  /** Which player must make the choice */
  choosingPlayerId: PlayerID;
  prompt: string;
  /** For choose_target: valid target instanceIds */
  validTargets?: string[];
  /** For choose_players_subset: PlayerIDs the caster may include in the
   *  chosen subset. Selection of ANY subset (including empty) is valid;
   *  CRD 6.1.4 "any number" semantics. Used by Beyond the Horizon. The
   *  RESOLVE_CHOICE action carries the chosen subset as a `string[]`. */
  selectablePlayerIds?: PlayerID[];
  /** For "any number" choose_discard (Geppetto, Desperate Plan): when set, the
   *  validator allows 0..maxCount discards instead of strict equality on count.
   *  The reducer feeds the actual chosen count into lastEffectResult. */
  maxCount?: number;
  /** For choose_target with CardTarget.chosen aggregate-sum caps — Leviathan
   *  "banish any number of chosen opposing characters with total {S} 10 or
   *  less." Forwarded from the target spec so the validator can enforce the
   *  sum constraint and the UI can render a running-total indicator. All
   *  fields independently optional; when multiple are set, ALL must hold on
   *  RESOLVE_CHOICE (strictest wins). Effective values (post-buff) are used. */
  totalStrengthAtMost?: number;
  totalStrengthAtLeast?: number;
  totalWillpowerAtMost?: number;
  totalWillpowerAtLeast?: number;
  totalCostAtMost?: number;
  totalCostAtLeast?: number;
  totalLoreAtMost?: number;
  totalLoreAtLeast?: number;
  totalDamageAtMost?: number;
  totalDamageAtLeast?: number;
  /** For choose_from_revealed: all revealed cards (validTargets is the selectable subset) */
  revealedCards?: string[];
  /** For choose_option: the effects to pick between */
  options?: Effect[][];
  /** For choose_cards: card filter and count */
  filter?: CardFilter;
  count?: number;
  /** For choose_amount: min and max of the numeric range (CRD "up to N") */
  min?: number;
  max?: number;
  /** For choose_order: where the ordered cards should land. Default "bottom"
   *  (preserves Vision of the Future / Ariel Spectacular Singer / look_at_top
   *  REPURPOSED behavior — first selected = bottommost). "top" routes to the
   *  top of the deck in chosen order — first selected = topmost (drawn first).
   *  Used by Hypnotic Deduction "put 2 cards from your hand on the top of your
   *  deck in any order" as the second step of a pick → order flow. */
  position?: "top" | "bottom";
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
  /** For choose_may where the accept-branch effect should run from a different
   *  perspective than the choosing player. Used by opponent_chooses_yes_or_no
   *  (Snowman): the opponent picks YES, but the YES effect "you gain 3 lore"
   *  must run with the caster as controllingPlayer. */
  acceptControllingPlayerId?: PlayerID | undefined;
  /** Internal: used by reveal_top_conditional's matchIsMay flow (Oswald, Simba
   *  King in the Making, Chief Bogo Commanding Officer, etc.). Carries the
   *  revealed card's identity and the original effect's match/no-match config
   *  across the choose_may accept/decline boundary. On accept, the reducer runs
   *  matchAction against revealedInstanceId; on decline, it routes the card to
   *  noMatchDestination. Never surfaced to user JSON. */
  _revealContinuation?: {
    revealedInstanceId: string;
    matchAction: "to_hand" | "play_card" | "to_inkwell_exerted";
    matchEnterExerted?: boolean;
    matchPayCost?: boolean;
    matchExtraEffects?: Effect[];
    noMatchDestination?: "top" | "bottom" | "hand" | "discard";
    targetPlayerId: PlayerID;
  };
  /** Internal: used by granted-free-play alt-cost chooser (Belle Apprentice
   *  Inventor's banish_chosen, Scrooge McDuck Resourceful Miser's
   *  exert_n_matching). Held on a choose_target pendingChoice — on resolve the
   *  reducer pays the cost using the chosen instance IDs, then completes the
   *  play (moves the character from hand to play, fires enters_play, logs).
   *  Requires exactly `exactCount` picks; validator enforces. */
  _freePlayContinuation?: {
    characterInstanceId: string;
    playerId: PlayerID;
    costType: "banish_chosen" | "exert_n_matching" | "discard";
    exactCount: number;
  };
  /** Internal: used by the alt-cost Shift chooser (Diablo - Devoted Herald's
   *  discard, Flotsam & Jetsam-style two-card discards, etc.). Held on a
   *  choose_target pendingChoice. On resolve the reducer re-invokes
   *  applyPlayCard with the chosen cost IDs filled in, landing in the legacy
   *  altShiftCostInstanceIds branch which pays the cost and completes the
   *  shift (zone transitions, shifted_onto trigger, etc.). */
  _altShiftCostContinuation?: {
    characterInstanceId: string;
    shiftTargetInstanceId: string;
    playerId: PlayerID;
    costType: "discard" | "banish_chosen";
    exactCount: number;
  };
}

/**
 * Human-readable event line for the game log UI. **Derived projection — NOT a
 * source of truth for replay.** See `docs/STREAMS.md` for the full contract
 * across the three streams.
 *
 * - `message` is paraphrased English prose (see `appendLog` callsites in
 *   `reducer.ts`); information loss is real (banish causality is collapsed,
 *   activated-ability log drops which ability fired, etc.). Don't string-match
 *   `message` to derive structured state — both `runGame.ts:258`'s mulligan
 *   detection (P1.7) and any similar future patterns are drift bugs.
 * - For privacy-aware redaction, see `privateTo` below — the server's
 *   `filterStateForPlayer` is responsible for replacing `message` with a
 *   redacted summary when the viewer isn't the privacy owner.
 * - For canonical replay, use `GameResult.actions: GameAction[]` (lossless,
 *   typed). For per-action engine events (animations / sound cues), use
 *   `ActionResult.events: GameEvent[]`.
 */
export interface GameLogEntry {
  timestamp: number;
  turn: number;
  playerId: PlayerID;
  message: string;
  /** Machine-readable type for filtering/replay */
  type: GameLogEntryType;
  /**
   * If set, this log entry contains information that should only be visible
   * to the named player (e.g. card names from a hidden zone). Mirrors the
   * existing `lastRevealedHand.privateTo` semantic.
   *
   * Engine writes the entry's `message` in full and stamps `privateTo` to
   * declare who's allowed to read it. The server's `filterStateForPlayer`
   * (server/src/services/stateFilter.ts) is responsible for redacting the
   * `message` text on entries where `privateTo != null && privateTo !==
   * viewerId` before sending state to a non-authorized viewer — typically
   * by replacing with a generic "<player> drew a card." style summary that
   * preserves count + timing without leaking card identity.
   *
   * Stamped today on:
   *   - opening hand draws (initializer)
   *   - per-turn draws (applyDraw)
   *   - mulligan decisions (which cards were returned)
   *   - inking a card (the card identity in the inkwell is face-down per CRD
   *     4.1.4, even though count/timing are public)
   *
   * Leave `undefined` for public events (plays, quests, challenges, banishes,
   * lore changes, ability triggers — anything visible to both players).
   */
  privateTo?: PlayerID;
  /**
   * P1.13 — structured cause discriminator for `card_banished` entries.
   * Simulator/replay/UI consume this directly instead of regexing the message.
   * Set ONLY when `type === "card_banished"`. See `BanishCause` JSDoc.
   */
  cause?: BanishCause;
}

export type GameLogEntryType =
  | "game_start"
  | "turn_start"
  | "turn_end"
  | "card_drawn"
  | "card_played"
  | "card_put_into_inkwell"
  | "card_quested"
  | "card_challenged"
  | "card_banished"
  | "lore_gained"
  | "lore_lost"
  | "ability_triggered"
  | "ability_activated"
  | "effect_resolved"
  | "choice_made"
  | "mulligan"
  | "character_moved"
  | "game_over"
  // Surfaced 2026-04-28 for P1.11 (effect-driven mutations were silently
  // changing state without log lines — players couldn't reconstruct why
  // hand/lore/damage/board changed). See docs/STREAMS.md.
  | "card_discarded"
  | "damage_dealt"
  | "damage_moved"
  | "hand_revealed"
  // P2.25 (2026-04-28) — Ink Geyser / Mufasa-style inkwell→hand returns
  // were silently mutating both hand AND inkwell without any log line.
  // Identity is hidden (CRD 4.1.4: inkwell cards face-down → return goes
  // face-down → face-down with no public reveal moment), so the entry is
  // privateTo the affected player; opponent sees a count-only redaction.
  | "card_returned_from_inkwell";

/**
 * P1.13 (2026-04-28) — structured cause for `card_banished` log entries so
 * simulator/replay/UI can disambiguate without prose-parsing the message
 * (per docs/STREAMS.md — never derive structure from log strings).
 *
 * - `challenge`    — banish from challenge resolution (CRD 4.6 / 1.8.1.4 with
 *                    challengeCtx threaded through `runGameStateCheck`).
 * - `damage`       — banish from accumulated damage outside a challenge
 *                    (CRD 1.8.1.4, e.g. character takes lethal damage from
 *                    a `deal_damage` effect or an item's damage trigger).
 * - `banish_effect` — banish from a card effect (Be Prepared, banish_chosen
 *                    targets, banish_self costs, alt-shift banish costs,
 *                    pendingEndOfTurnBanish from Gruesome and Grim / Madam Mim).
 * - `gsc_cleanup`  — reserved for any non-damage GSC banish path we discover
 *                    (currently unused; kept as a future-proof variant).
 */
export type BanishCause =
  | "challenge"
  | "damage"
  | "banish_effect"
  | "gsc_cleanup";

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
  /** For alternate-cost Shift (Diablo etc.): the instanceId(s) of the card(s)
   *  paying the shift cost (discarded, banished, etc.). Array to support
   *  multi-card costs (Flotsam & Jetsam: discard 2 cards). Only valid when
   *  the card's definition has altShiftCost and shiftTargetInstanceId is set. */
  altShiftCostInstanceIds?: string[];
  /** CRD 5.4.4.2: For singing — the character exerted to pay for this song */
  singerInstanceId?: string;
  /** CRD 8.12: For Sing Together — multiple characters whose combined effective cost
   *  must be ≥ the song's singTogetherCost. Mutually exclusive with singerInstanceId. */
  singerInstanceIds?: string[];
  /** Pudge - Controls the Weather: alternative free-play mode granted by a
   *  conditional `grant_play_for_free_self` static. When true, the validator
   *  forces cost to 0 (gated on the modifier being active) and the apply
   *  path skips ink deduction. The legal-action enumerator surfaces this
   *  variant alongside the normal-cost play, so the player can pick either. */
  viaGrantedFreePlay?: boolean;
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

/** Cascade attribution for a GameEvent — distinguishes events that came
 *  directly from the dispatched action (`primary`) from events that came
 *  out of a triggered ability resolving from the bag (`trigger`), or from
 *  a replacement effect substituting for a base effect (`replacement`,
 *  reserved for CRD 6.5 implementation). Stamped by processTriggerStack
 *  on events emitted during trigger resolution; `undefined` means
 *  `"primary"` (the user-dispatched action's own effects). Persisted via
 *  ActionResult.events for trainer/replay/audit consumers per HANDOFF.md
 *  GameEvent-stream item. */
export type GameEventCause = "primary" | "trigger" | "replacement";

export type GameEvent = (
  | { type: "card_moved"; instanceId: string; from: ZoneName; to: ZoneName }
  | { type: "damage_dealt"; instanceId: string; amount: number }
  | { type: "card_banished"; instanceId: string }
  | { type: "lore_gained"; playerId: PlayerID; amount: number }
  | { type: "card_drawn"; playerId: PlayerID; instanceId: string }
  | { type: "ability_triggered"; instanceId: string; abilityType: string }
  | { type: "card_revealed"; instanceId: string; playerId: PlayerID; sourceInstanceId: string }
  | { type: "hand_revealed"; playerId: PlayerID; cardInstanceIds: string[]; sourceInstanceId: string; privateTo?: PlayerID }
  | { type: "turn_passed"; to: PlayerID }
) & { cause?: GameEventCause };
