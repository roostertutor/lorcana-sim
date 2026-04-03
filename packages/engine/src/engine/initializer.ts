// =============================================================================
// GAME INITIALIZER
// Creates a fresh GameState from two decklists and a card definition registry.
// =============================================================================

import type {
  CardDefinition,
  CardInstance,
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

    // Look up by fullName only (case-insensitive) — require exact full name
    // to avoid ambiguity when multiple versions of a character exist
    const def = Object.values(definitions).find(
      (d) => d.fullName.toLowerCase() === name.toLowerCase()
    );

    if (!def) {
      errors.push(`Card not found: "${name}"`);
      continue;
    }

    entries.push({ definitionId: def.id, count });
  }

  return { entries, errors };
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
        tempStrengthModifier: 0,
        tempWillpowerModifier: 0,
        tempLoreModifier: 0,
        grantedKeywords: [],
        timedEffects: [],
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
};

export function createGame(
  config: GameConfig,
  _definitions: Record<string, CardDefinition>
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
  const p1Zones: Record<ZoneName, string[]> = { ...EMPTY_ZONES, deck: [], hand: [], play: [], discard: [], inkwell: [] };
  const p2Zones: Record<ZoneName, string[]> = { ...EMPTY_ZONES, deck: [], hand: [], play: [], discard: [], inkwell: [] };

  for (const instance of allInstances) {
    cards[instance.instanceId] = instance;
    if (instance.ownerId === "player1") {
      p1Zones.deck.push(instance.instanceId);
    } else {
      p2Zones.deck.push(instance.instanceId);
    }
  }

  let state: GameState = {
    turnNumber: 1,
    currentPlayer: "player1",
    phase: "beginning",
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
        playerId: "player1",
        message: "Game started.",
        type: "game_start",
      },
    ],
    winner: null,
    isGameOver: false,
  };

  // Deal opening hands
  state = dealOpeningHands(state, handSize);

  // Move to main phase
  state = {
    ...state,
    phase: "main",
    players: {
      ...state.players,
      player1: {
        ...state.players.player1,
        availableInk: 0, // No ink on first turn until cards are played
      },
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
