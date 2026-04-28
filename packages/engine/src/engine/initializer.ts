// =============================================================================
// GAME INITIALIZER
// Creates a fresh GameState from two decklists and a card definition registry.
// =============================================================================

import type {
  CardDefinition,
  CardInstance,
  CardVariantType,
  GameState,
  PlayerID,
  RngState,
  ZoneName,
} from "../types/index.js";
import { generateId } from "../utils/index.js";
import { createRng, rngNextInt } from "../utils/seededRng.js";

export interface DeckEntry {
  definitionId: string;
  count: number;
  /** Which visual printing the player wants. Matches CardVariant.type on the
   *  resolved CardDefinition. Undefined = default (CardDefinition.imageUrl).
   *  No runtime effect on the engine — carried for the UI to render the right
   *  art. Variants share gameplay rules and the maxCopies limit. */
  variant?: CardVariantType;
}

export interface GameConfig {
  player1Deck: DeckEntry[];
  player2Deck: DeckEntry[];
  /** Starting hand size (default: 7) */
  startingHandSize?: number;
  /** Seed for shuffle (future: deterministic shuffle) */
  seed?: number;
  /** When true, disables bot auto-resolve heuristics — humans must make all choices */
  interactive?: boolean;
  /** CRD 2.1.3.2 / 2.2.1: play-draw rule. The player who elects to go first or
   *  second. Defaults to "player1" — server/setup code slots the appropriate
   *  player (coin-flip winner for game 1, previous-game loser for Bo3 games 2/3)
   *  into the player1 slot so the default works without extra plumbing. Engine
   *  surfaces a choose_play_order pendingChoice to this player as the first
   *  interaction in the game. */
  chooserPlayerId?: PlayerID;
}

/** Shuffle an array using Fisher-Yates with seeded RNG */
function shuffle<T>(arr: T[], rng: RngState): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rngNextInt(rng, i + 1);
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/** Parse a plaintext decklist into DeckEntries */
/** Normalize a card name for equality comparison. Collapses punctuation
 *  variants that differ only as code points: curly vs straight quotes
 *  (U+2018/U+2019 → ' and U+201C/U+201D → "), en/em dashes → hyphen,
 *  whitespace runs → single space, lowercased, trimmed.
 *
 *  Lorcana card names in our data use typographic curly apostrophes
 *  (e.g. "Te Kā — Destroyer") but external decklists (Inkable, Dreamborn,
 *  anyone who typed the name from their keyboard) use straight quotes.
 *  Equality on the raw strings misses these valid matches. */
function normalizeCardName(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseDecklist(
  text: string,
  definitions: Record<string, CardDefinition>
): { entries: DeckEntry[]; errors: string[] } {
  const lines = text.trim().split("\n");
  const entries: DeckEntry[] = [];
  const errors: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    // Match "4 Card Name" or "4x Card Name"
    const match = line.match(/^(\d+)x?\s+(.+)$/);
    if (!match) {
      errors.push(`Could not parse line: "${line}"`);
      continue;
    }

    const count = parseInt(match[1]!, 10);
    const name = match[2]!.trim();
    const normalizedName = normalizeCardName(name);

    // Look up by fullName only (normalized for curly-vs-straight
    // punctuation parity so external-tool pastes match our data).
    const def = Object.values(definitions).find(
      (d) => normalizeCardName(d.fullName) === normalizedName
    );

    if (!def) {
      errors.push(`Card not found: "${name}"`);
      continue;
    }

    entries.push({ definitionId: def.id, count });
  }

  return { entries, errors };
}

/** Serialize DeckEntries back into plaintext decklist format ("4 Card Name" per line).
 *  Inverse of parseDecklist. Unknown definitionIds are skipped. */
export function serializeDecklist(
  entries: DeckEntry[],
  definitions: Record<string, CardDefinition>,
): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const def = definitions[entry.definitionId];
    if (!def) continue;
    lines.push(`${entry.count} ${def.fullName}`);
  }
  return lines.join("\n");
}

/** Counter for seeded ID generation — reset per createGame call */
let idCounter = 0;

function seededGenerateId(rng: RngState): string {
  return `c${idCounter++}-${rngNextInt(rng, 0xFFFFFF).toString(36)}`;
}

function buildDeckInstances(
  entries: DeckEntry[],
  ownerId: PlayerID,
  rng: RngState
): CardInstance[] {
  const instances: CardInstance[] = [];

  for (const entry of entries) {
    for (let i = 0; i < entry.count; i++) {
      instances.push({
        instanceId: seededGenerateId(rng),
        definitionId: entry.definitionId,
        ownerId,
        zone: "deck",
        isExerted: false,
        damage: 0,
        isDrying: false,
        grantedKeywords: [],
        timedEffects: [],
        cardsUnder: [],
      });
    }
  }

  return shuffle(instances, rng);
}

const EMPTY_ZONES: Record<ZoneName, string[]> = {
  deck: [],
  hand: [],
  play: [],
  discard: [],
  inkwell: [],
  // CRD 8.10.4 / 8.4.2: cards under another card live here logically.
  // The "under" zone array is unused — cards-under membership is tracked
  // by the parent's CardInstance.cardsUnder field. We declare it for type
  // completeness so getZone(state, p, "under") returns [] without error.
  under: [],
};

export function createGame(
  config: GameConfig,
  definitions: Record<string, CardDefinition>
): GameState {
  const handSize = config.startingHandSize ?? 7;
  const seed = config.seed ?? Date.now();
  const rng = createRng(seed);
  idCounter = 0; // Reset counter for each new game

  const p1Instances = buildDeckInstances(config.player1Deck, "player1", rng);
  const p2Instances = buildDeckInstances(config.player2Deck, "player2", rng);
  const allInstances = [...p1Instances, ...p2Instances];

  // Build the cards record and zone lists
  const cards: Record<string, CardInstance> = {};
  const p1Zones: Record<ZoneName, string[]> = { ...EMPTY_ZONES, deck: [], hand: [], play: [], discard: [], inkwell: [], under: [] };
  const p2Zones: Record<ZoneName, string[]> = { ...EMPTY_ZONES, deck: [], hand: [], play: [], discard: [], inkwell: [], under: [] };

  for (const instance of allInstances) {
    cards[instance.instanceId] = instance;
    if (instance.ownerId === "player1") {
      p1Zones.deck.push(instance.instanceId);
    } else {
      p2Zones.deck.push(instance.instanceId);
    }
  }

  // CRD 2.1.3.2 / 2.2.1: play-draw rule. The chooser (coin-flip winner for
  // game 1, Bo3 loser for games 2/3) elects whether to be the starting player.
  // Server/setup logic is responsible for slotting the chooser into the
  // appropriate PlayerID slot and passing it here.
  const chooserId: PlayerID = config.chooserPlayerId ?? "player1";

  let state: GameState = {
    turnNumber: 1,
    // currentPlayer is only meaningful once a starting player is picked. We
    // tentatively set it to the chooser so "whose move is it?" consumers that
    // ignore pendingChoice don't see an undefined state; the reducer overwrites
    // this on choose_play_order resolution. firstPlayerId intentionally omitted
    // until the choice resolves — any consumer reading it (e.g. Underdog's
    // your_first_turn_as_underdog condition) should treat undefined as "not yet
    // decided" (no card effects run during the play_order_select phase anyway).
    currentPlayer: chooserId,
    phase: "play_order_select",
    players: {
      player1: { id: "player1", lore: 0, availableInk: 0, hasPlayedInkThisTurn: false },
      player2: { id: "player2", lore: 0, availableInk: 0, hasPlayedInkThisTurn: false },
    },
    cards,
    zones: { player1: p1Zones, player2: p2Zones },
    rng,
    interactive: config.interactive ?? false,
    triggerStack: [],
    pendingChoice: null,
    actionLog: [
      {
        timestamp: Date.now(),
        turn: 1,
        playerId: chooserId,
        message: "Game started.",
        type: "game_start",
      },
    ],
    winner: null,
    isGameOver: false,
  };

  // Deal opening hands
  state = dealOpeningHands(state, handSize);

  // Log the opening hands
  for (const playerId of ["player1", "player2"] as const) {
    const handIds = state.zones[playerId].hand;
    const cardNames = handIds
      .map((id) => definitions[state.cards[id]?.definitionId ?? ""]?.fullName ?? "Unknown")
      .join(", ");
    state = {
      ...state,
      actionLog: [
        ...state.actionLog,
        {
          timestamp: Date.now(),
          turn: 1,
          playerId,
          // Card names are private to the drawer — opening hand cards are in
          // a hidden zone. Server's filterStateForPlayer redacts message text
          // for non-authorized viewers (see GameLogEntry.privateTo JSDoc).
          message: `${playerId} drew: ${cardNames}.`,
          type: "card_drawn" as const,
          privateTo: playerId,
        },
      ],
    };
  }

  // CRD 2.1.3.2: chooser picks go-first-or-second. Mulligan (CRD 2.2.2) only
  // begins after this resolves, because CRD 2.2.2 orders mulligans starting
  // with the starting player — which we don't know yet.
  state = {
    ...state,
    pendingChoice: {
      type: "choose_play_order",
      choosingPlayerId: chooserId,
      prompt: "Choose whether to go first or second.",
    },
  };

  return state;
}

function dealOpeningHands(state: GameState, handSize: number): GameState {
  // Draw for player1
  for (let i = 0; i < handSize; i++) {
    const deck = state.zones.player1.deck;
    const topId = deck[0];
    if (!topId) break;
    state = {
      ...state,
      cards: {
        ...state.cards,
        [topId]: { ...state.cards[topId]!, zone: "hand" },
      },
      zones: {
        ...state.zones,
        player1: {
          ...state.zones.player1,
          deck: deck.slice(1),
          hand: [...state.zones.player1.hand, topId],
        },
      },
    };
  }

  // Draw for player2
  for (let i = 0; i < handSize; i++) {
    const deck = state.zones.player2.deck;
    const topId = deck[0];
    if (!topId) break;
    state = {
      ...state,
      cards: {
        ...state.cards,
        [topId]: { ...state.cards[topId]!, zone: "hand" },
      },
      zones: {
        ...state.zones,
        player2: {
          ...state.zones.player2,
          deck: deck.slice(1),
          hand: [...state.zones.player2.hand, topId],
        },
      },
    };
  }

  return state;
}
