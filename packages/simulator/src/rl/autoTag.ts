// =============================================================================
// AUTO-TAG — Feature extraction for RL policy
// Converts game state, card definitions, and actions into numeric feature vectors.
// =============================================================================

import type {
  CardDefinition,
  GameAction,
  GameState,
  PlayerID,
  Effect,
  Keyword,
} from "@lorcana-sim/engine";
import { getZone, getOpponent } from "@lorcana-sim/engine";

// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------

// 4 basic + 4 char stats + 13 keywords + 22 effects + 2 triggers = 45
export const CARD_FEATURE_SIZE = 45;
export const MAX_HAND_SLOTS = 10;
export const MAX_BOARD_SLOTS = 8;
export const GAME_CONTEXT_SIZE = 14;
export const STATE_FEATURE_SIZE =
  MAX_HAND_SLOTS * CARD_FEATURE_SIZE +
  MAX_BOARD_SLOTS * CARD_FEATURE_SIZE +
  MAX_BOARD_SLOTS * CARD_FEATURE_SIZE +
  GAME_CONTEXT_SIZE; // 10*43 + 8*43 + 8*43 + 12 = 1130 -- wait, let me recalculate
// 10*43 = 430, 8*43 = 344, 8*43 = 344, 12 = 12 => 430+344+344+12 = 1130
// Plan says 1118. Let me check: the plan says "Hand cards: 10 slots × 43 features"
// + "My board: 8 slots × 43" + "Opp board: 8 slots × 43" + "Game context (12)"
// = 430 + 344 + 344 + 12 = 1130. The plan says 1118 which would be (10+8+8)*43+12 = 26*43+12 = 1118+12 = 1130.
// Actually 26*43 = 1118, + 12 = 1130. The plan header says 1118 but the breakdown gives 1130.
// I'll use the actual calculation: 1130.

export const ACTION_TYPE_COUNT = 8;
export const ACTION_FEATURE_SIZE = ACTION_TYPE_COUNT + CARD_FEATURE_SIZE + CARD_FEATURE_SIZE; // 8+43+43 = 94
export const NETWORK_INPUT_SIZE = STATE_FEATURE_SIZE + ACTION_FEATURE_SIZE; // 1130+94 = 1224

// Keyword index mapping (13 keywords)
const KEYWORD_LIST: string[] = [
  "shift", "evasive", "rush", "bodyguard", "ward", "reckless",
  "challenger", "support", "singer", "sing_together", "resist", "boost", "vanish",
];

// Effect type mapping (22 effect types)
const EFFECT_TYPE_LIST: string[] = [
  "draw", "deal_damage", "remove_damage", "banish", "return_to_hand",
  "gain_lore", "gain_stats", "create_card", "search", "choose",
  "exert", "grant_keyword", "ready", "cant_action", "look_at_top",
  "discard_from_hand", "put_into_inkwell", "self_replacement",
  "play_for_free", "shuffle_into_deck", "pay_ink", "create_floating_trigger",
];

// Action type one-hot mapping
const ACTION_TYPE_INDEX: Record<string, number> = {
  PLAY_CARD: 0,
  PLAY_INK: 1,
  QUEST: 2,
  CHALLENGE: 3,
  ACTIVATE_ABILITY: 4,
  PASS_TURN: 5,
  RESOLVE_CHOICE_ACCEPT: 6,
  RESOLVE_CHOICE_DECLINE: 7,
};

// -----------------------------------------------------------------------------
// CARD FEATURES (43 dims)
// -----------------------------------------------------------------------------

export interface CardFeatures {
  costNorm: number;
  inkable: number;
  isCharacter: number;
  isAction: number;
  strengthNorm: number;
  willpowerNorm: number;
  loreNorm: number;
  shiftCostNorm: number;
  keywords: number[]; // 13
  effectPresence: number[]; // 22
  hasEntersPlayTrigger: number;   // effect fires when this card enters play
  hasChallengeWinTrigger: number; // effect fires when this card banishes another in a challenge
}

/** Collect all effect types present in a card definition */
export function collectAllEffects(def: CardDefinition): Set<string> {
  const types = new Set<string>();

  function walkEffects(effects: Effect[]): void {
    for (const e of effects) {
      types.add(e.type);
      if (e.type === "choose" && e.options) {
        for (const opt of e.options) walkEffects(opt);
      }
      if (e.type === "self_replacement") {
        walkEffects(e.effect);
        walkEffects(e.instead);
      }
    }
  }

  for (const ability of def.abilities) {
    if (ability.type === "triggered" || ability.type === "activated") {
      walkEffects(ability.effects);
    }
    if (ability.type === "static" && ability.effect) {
      // Static effects are a single effect, not an array
      types.add(ability.effect.type);
    }
  }

  // Action card effects
  if (def.actionEffects) {
    walkEffects(def.actionEffects);
  }

  return types;
}

/** Collect all keywords present in a card definition */
export function collectAllKeywords(def: CardDefinition): Set<string> {
  const kws = new Set<string>();
  for (const ability of def.abilities) {
    if (ability.type === "keyword") {
      kws.add(ability.keyword);
    }
  }
  if (def.shiftCost !== undefined) {
    kws.add("shift");
  }
  return kws;
}

/** Convert a card definition to a 43-dim feature vector */
export function cardToFeatures(def: CardDefinition): CardFeatures {
  const keywords = collectAllKeywords(def);
  const effects = collectAllEffects(def);

  const keywordVec = KEYWORD_LIST.map((kw) => (keywords.has(kw) ? 1 : 0));
  const effectVec = EFFECT_TYPE_LIST.map((et) => (effects.has(et) ? 1 : 0));

  const hasEntersPlayTrigger = def.abilities.some(
    (a) => a.type === "triggered" && a.trigger.on === "enters_play"
  ) ? 1 : 0;

  const hasChallengeWinTrigger = def.abilities.some(
    (a) => a.type === "triggered" && a.trigger.on === "banished_other_in_challenge"
  ) ? 1 : 0;

  return {
    costNorm: Math.min(def.cost / 10, 1),
    inkable: def.inkable ? 1 : 0,
    isCharacter: def.cardType === "character" ? 1 : 0,
    isAction: def.cardType === "action" ? 1 : 0,
    strengthNorm: Math.min((def.strength ?? 0) / 10, 1),
    willpowerNorm: Math.min((def.willpower ?? 0) / 10, 1),
    loreNorm: Math.min((def.lore ?? 0) / 5, 1),
    shiftCostNorm: def.shiftCost !== undefined ? Math.min(def.shiftCost / 10, 1) : 0,
    keywords: keywordVec,
    effectPresence: effectVec,
    hasEntersPlayTrigger,
    hasChallengeWinTrigger,
  };
}

/** Flatten CardFeatures into a number array of length CARD_FEATURE_SIZE */
export function cardFeaturesToArray(f: CardFeatures): number[] {
  return [
    f.costNorm,
    f.inkable,
    f.isCharacter,
    f.isAction,
    f.strengthNorm,
    f.willpowerNorm,
    f.loreNorm,
    f.shiftCostNorm,
    ...f.keywords,
    ...f.effectPresence,
    f.hasEntersPlayTrigger,
    f.hasChallengeWinTrigger,
  ];
}

const ZERO_CARD_FEATURES = new Array<number>(CARD_FEATURE_SIZE).fill(0);

/** Get card features array for a card instance, or zeros if not found */
function instanceFeatures(
  state: GameState,
  instanceId: string,
  definitions: Record<string, CardDefinition>
): number[] {
  const instance = state.cards[instanceId];
  if (!instance) return ZERO_CARD_FEATURES;
  const def = definitions[instance.definitionId];
  if (!def) return ZERO_CARD_FEATURES;
  return cardFeaturesToArray(cardToFeatures(def));
}

// -----------------------------------------------------------------------------
// STATE FEATURES
// -----------------------------------------------------------------------------

/** Convert game state to a feature vector from the perspective of playerId */
export function stateToFeatures(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): number[] {
  const opponentId = getOpponent(playerId);
  const hand = getZone(state, playerId, "hand");
  const myBoard = getZone(state, playerId, "play");
  const oppBoard = getZone(state, opponentId, "play");
  const myDeck = getZone(state, playerId, "deck");
  const myInkwell = getZone(state, playerId, "inkwell");

  const features: number[] = [];

  // Hand cards: 10 slots × 43 features (zero-padded)
  for (let i = 0; i < MAX_HAND_SLOTS; i++) {
    if (i < hand.length) {
      features.push(...instanceFeatures(state, hand[i]!, definitions));
    } else {
      features.push(...ZERO_CARD_FEATURES);
    }
  }

  // My board: 8 slots × 43 features
  for (let i = 0; i < MAX_BOARD_SLOTS; i++) {
    if (i < myBoard.length) {
      features.push(...instanceFeatures(state, myBoard[i]!, definitions));
    } else {
      features.push(...ZERO_CARD_FEATURES);
    }
  }

  // Opponent board: 8 slots × 43 features
  for (let i = 0; i < MAX_BOARD_SLOTS; i++) {
    if (i < oppBoard.length) {
      features.push(...instanceFeatures(state, oppBoard[i]!, definitions));
    } else {
      features.push(...ZERO_CARD_FEATURES);
    }
  }

  // Game context (14 dims)
  const myPlayer = state.players[playerId];
  const oppPlayer = state.players[opponentId];

  const oppExertedCount = oppBoard.filter(id => state.cards[id]?.isExerted).length;
  const myDamagedCount = myBoard.filter(id => (state.cards[id]?.damage ?? 0) > 0).length;

  features.push(
    Math.min(state.turnNumber / 50, 1),   // turnProgress
    Math.min(myPlayer.lore / 20, 1),       // myLore
    Math.min(oppPlayer.lore / 20, 1),      // oppLore
    Math.min((myPlayer.lore - oppPlayer.lore + 20) / 40, 1), // loreDelta (normalized to [0,1])
    Math.min(myPlayer.availableInk / 12, 1), // myInk
    Math.min(hand.length / 10, 1),         // handSize
    Math.min(myBoard.length / 8, 1),       // myBoardSize
    Math.min(oppBoard.length / 8, 1),      // oppBoardSize
    Math.min(myDeck.length / 60, 1),       // deckRemaining
    Math.min(myInkwell.length / 12, 1),    // inkwellSize
    myPlayer.hasPlayedInkThisTurn ? 1 : 0, // alreadyInked
    state.pendingChoice ? 1 : 0,           // choicePending
    oppBoard.length > 0 ? oppExertedCount / oppBoard.length : 0, // oppExertedFraction
    myBoard.length > 0 ? myDamagedCount / myBoard.length : 0,    // myDamagedFraction
  );

  return features;
}

// -----------------------------------------------------------------------------
// ACTION FEATURES (94 dims)
// -----------------------------------------------------------------------------

/** Convert a game action to a 94-dim feature vector */
export function actionToFeatures(
  state: GameState,
  action: GameAction,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>
): number[] {
  // Action type one-hot (8 dims)
  const typeOneHot = new Array<number>(ACTION_TYPE_COUNT).fill(0);

  // Primary card features (43 dims)
  let primaryFeatures = ZERO_CARD_FEATURES;

  // Target card features (43 dims)
  let targetFeatures = ZERO_CARD_FEATURES;

  switch (action.type) {
    case "PLAY_CARD": {
      typeOneHot[ACTION_TYPE_INDEX["PLAY_CARD"]!] = 1;
      primaryFeatures = instanceFeatures(state, action.instanceId, definitions);
      if (action.shiftTargetInstanceId) {
        targetFeatures = instanceFeatures(state, action.shiftTargetInstanceId, definitions);
      } else if (action.singerInstanceId) {
        targetFeatures = instanceFeatures(state, action.singerInstanceId, definitions);
      }
      break;
    }
    case "PLAY_INK": {
      typeOneHot[ACTION_TYPE_INDEX["PLAY_INK"]!] = 1;
      primaryFeatures = instanceFeatures(state, action.instanceId, definitions);
      break;
    }
    case "QUEST": {
      typeOneHot[ACTION_TYPE_INDEX["QUEST"]!] = 1;
      primaryFeatures = instanceFeatures(state, action.instanceId, definitions);
      break;
    }
    case "CHALLENGE": {
      typeOneHot[ACTION_TYPE_INDEX["CHALLENGE"]!] = 1;
      primaryFeatures = instanceFeatures(state, action.attackerInstanceId, definitions);
      targetFeatures = instanceFeatures(state, action.defenderInstanceId, definitions);
      break;
    }
    case "ACTIVATE_ABILITY": {
      typeOneHot[ACTION_TYPE_INDEX["ACTIVATE_ABILITY"]!] = 1;
      primaryFeatures = instanceFeatures(state, action.instanceId, definitions);
      break;
    }
    case "PASS_TURN": {
      typeOneHot[ACTION_TYPE_INDEX["PASS_TURN"]!] = 1;
      // All zeros for card features
      break;
    }
    case "RESOLVE_CHOICE": {
      if (action.choice === "accept") {
        typeOneHot[ACTION_TYPE_INDEX["RESOLVE_CHOICE_ACCEPT"]!] = 1;
      } else if (action.choice === "decline") {
        typeOneHot[ACTION_TYPE_INDEX["RESOLVE_CHOICE_DECLINE"]!] = 1;
      } else if (Array.isArray(action.choice) && action.choice.length > 0) {
        typeOneHot[ACTION_TYPE_INDEX["RESOLVE_CHOICE_ACCEPT"]!] = 1;
        primaryFeatures = instanceFeatures(state, action.choice[0]!, definitions);
        if (action.choice.length > 1) {
          targetFeatures = instanceFeatures(state, action.choice[1]!, definitions);
        }
      } else if (typeof action.choice === "number") {
        typeOneHot[ACTION_TYPE_INDEX["RESOLVE_CHOICE_ACCEPT"]!] = 1;
      } else {
        // Empty array = decline
        typeOneHot[ACTION_TYPE_INDEX["RESOLVE_CHOICE_DECLINE"]!] = 1;
      }
      break;
    }
    default: {
      // DRAW_CARD or unknown — pass-like
      typeOneHot[ACTION_TYPE_INDEX["PASS_TURN"]!] = 1;
      break;
    }
  }

  return [...typeOneHot, ...primaryFeatures, ...targetFeatures];
}
