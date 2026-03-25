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
export type ZoneName = "deck" | "hand" | "play" | "discard" | "inkwell";
export type InkColor =
  | "amber"
  | "amethyst"
  | "emerald"
  | "ruby"
  | "sapphire"
  | "steel";
export type CardType = "character" | "action" | "item" | "location";
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
  | "resist";

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
  /** When does this trigger? */
  trigger: TriggerEvent;
  /** What happens when it triggers? */
  effects: Effect[];
  /** Optional condition that must be true for the trigger to fire */
  condition?: Condition;
}

export interface ActivatedAbility {
  type: "activated";
  /** Cost to activate: exert, pay ink, banish, etc. */
  costs: Cost[];
  /** What happens when activated */
  effects: Effect[];
  /** Timing restriction, defaults to "your_turn_main" */
  timing?: AbilityTiming;
  /** Optional condition */
  condition?: Condition;
  /** Reminder/flavor text shown in UI */
  reminderText?: string;
}

export interface StaticAbility {
  type: "static";
  /** Describes an ongoing effect that modifies game rules */
  effect: StaticEffect;
}

// -----------------------------------------------------------------------------
// EFFECTS — What abilities actually do
// -----------------------------------------------------------------------------

export type Effect =
  | DrawEffect
  | DealDamageEffect
  | HealEffect
  | BanishEffect
  | ReturnToHandEffect
  | GainLoreEffect
  | GainStatsEffect
  | CreateCardEffect
  | SearchEffect
  | ChooseEffect
  | ExertEffect;

export interface DrawEffect {
  type: "draw";
  amount: number | "X";
  target: PlayerTarget;
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
}

export interface DealDamageEffect {
  type: "deal_damage";
  amount: number | "X";
  target: CardTarget;
}

export interface HealEffect {
  type: "heal";
  amount: number;
  target: CardTarget;
}

export interface BanishEffect {
  type: "banish";
  target: CardTarget;
}

export interface ReturnToHandEffect {
  type: "return_to_hand";
  target: CardTarget;
}

export interface GainLoreEffect {
  type: "gain_lore";
  amount: number;
  target: PlayerTarget;
}

export interface GainStatsEffect {
  type: "gain_stats";
  strength?: number;
  willpower?: number;
  lore?: number;
  target: CardTarget;
  /** "this_turn" = wears off at end of turn, "permanent" = stays */
  duration: "this_turn" | "permanent";
  /** CRD 6.1.4: player may choose not to apply this effect */
  isMay?: boolean;
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
}

// -----------------------------------------------------------------------------
// STATIC EFFECTS — Ongoing, passive modifications to game rules
// -----------------------------------------------------------------------------

export type StaticEffect =
  | GainKeywordStatic
  | ModifyStatStatic
  | CantBeChallengedException;

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

export interface CantBeChallengedException {
  type: "cant_be_challenged";
  target: CardTarget;
}

// -----------------------------------------------------------------------------
// TARGETS — Who/what an effect points at
// -----------------------------------------------------------------------------

export type PlayerTarget =
  | { type: "self" }
  | { type: "opponent" }
  | { type: "both" }
  | { type: "choosing_player" };

export type CardTarget =
  | { type: "this" } // The card itself
  | { type: "chosen"; filter: CardFilter } // Player picks a card
  | { type: "all"; filter: CardFilter } // All matching cards
  | { type: "random"; filter: CardFilter } // Random matching card
  | { type: "triggering_card" }; // The card that caused the trigger

export interface CardFilter {
  owner?: PlayerTarget;
  zone?: ZoneName | ZoneName[];
  cardType?: CardType[];
  inkColor?: InkColor[];
  hasTrait?: string;
  hasKeyword?: Keyword;
  isExerted?: boolean;
  costAtMost?: number;
  costAtLeast?: number;
  /** Exclude a specific card instance (e.g. Support can't target itself) */
  excludeInstanceId?: string;
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
  | { on: "challenges"; filter?: CardFilter }
  | { on: "is_challenged"; filter?: CardFilter }
  | { on: "is_banished"; filter?: CardFilter }
  | { on: "turn_start"; player: PlayerTarget }
  | { on: "turn_end"; player: PlayerTarget }
  | { on: "card_drawn"; player: PlayerTarget }
  | { on: "ink_played"; player: PlayerTarget };

// -----------------------------------------------------------------------------
// CONDITIONS — Guards on triggered/activated abilities
// -----------------------------------------------------------------------------

export type Condition =
  | { type: "you_have_lore_gte"; amount: number }
  | { type: "opponent_has_lore_gte"; amount: number }
  | { type: "cards_in_hand_gte"; amount: number; player: PlayerTarget }
  | { type: "card_has_trait"; trait: string }
  | { type: "card_is_type"; cardType: CardType };

export type AbilityTiming = "your_turn_main" | "any_time" | "opponent_turn";

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
  inkColor: InkColor;
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

  abilities: Ability[];

  /** CRD 5.4.3: Actions have effects, not abilities. Resolved inline, not through trigger stack. */
  actionEffects?: Effect[];

  /** Flavor text for UI display */
  flavorText?: string;
  /** Set identifier, e.g. "TFC", "ROF" */
  setId: string;
  /** Collector number within set */
  number: number;
  /** Rarity */
  rarity: "common" | "uncommon" | "rare" | "super_rare" | "legendary" | "enchanted";
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

  // --- Shift tracking ---
  /** If this card was shifted, the instanceId of the card it shifted onto */
  shiftedOntoInstanceId?: string;
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
}

export interface GameState {
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

  /** Log of all actions taken, useful for UI and debugging */
  actionLog: GameLogEntry[];

  winner: PlayerID | null;
  isGameOver: boolean;
}

export type GamePhase =
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
  type: "choose_target" | "choose_option" | "choose_cards" | "choose_may";
  /** Which player must make the choice */
  choosingPlayerId: PlayerID;
  prompt: string;
  /** For choose_target: valid target instanceIds */
  validTargets?: string[];
  /** For choose_option: the effects to pick between */
  options?: Effect[][];
  /** For choose_cards: card filter and count */
  filter?: CardFilter;
  count?: number;
  /** The effect waiting for this choice to resolve */
  pendingEffect: Effect;
  /** CRD 6.1.4: player can decline with empty choice */
  optional?: boolean;
  /** For choose_may: the source card's instanceId (needed to resume trigger processing) */
  sourceInstanceId?: string;
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
  | "choice_made"
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
  | DrawCardAction; // Usually automatic, but exposed for debugging

export interface PlayCardAction {
  type: "PLAY_CARD";
  playerId: PlayerID;
  instanceId: string;
  /** For Shift: the instanceId of the character being shifted onto */
  shiftTargetInstanceId?: string;
  /** CRD 5.4.4.2: For singing — the character exerted to pay for this song */
  singerInstanceId?: string;
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
  /** instanceIds of chosen targets, index of chosen option, or "accept"/"decline" for may */
  choice: string[] | number | "accept" | "decline";
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
