// =============================================================================
// TestBench — Text-based interactive game board
// Human plays P1, bot plays P2. All logic in useGameSession hook.
// =============================================================================

import React, { useState, useMemo } from "react";
import type { CardDefinition, DeckEntry, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { parseDecklist } from "@lorcana-sim/engine";
import {
  GreedyBot,
  ProbabilityBot,
  RandomBot,
  AggroWeights,
  ControlWeights,
  MidrangeWeights,
} from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";
import { useGameSession } from "../hooks/useGameSession.js";

// -----------------------------------------------------------------------------
// Bot options
// -----------------------------------------------------------------------------

const BOT_OPTIONS: { id: string; label: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", bot: () => GreedyBot },
  { id: "aggro", label: "Aggro", bot: () => ProbabilityBot(AggroWeights) },
  { id: "control", label: "Control", bot: () => ProbabilityBot(ControlWeights) },
  { id: "midrange", label: "Midrange", bot: () => ProbabilityBot(MidrangeWeights) },
  { id: "random", label: "Random", bot: () => RandomBot },
];

// -----------------------------------------------------------------------------
// Sample deck (a valid 60-card Set 1 deck for quick testing)
// -----------------------------------------------------------------------------

const SAMPLE_DECK = `4 Elsa - Snow Queen
4 Stitch - Rock Star
4 Rapunzel - Gifted with Healing
4 Pascal - Rapunzel's Companion
4 Hades - King of Olympus
4 Maleficent - Monstrous Dragon
4 Mickey Mouse - Brave Little Tailor
4 Cinderella - Ballroom Sensation
4 Aladdin - Heroic Outlaw
4 Simba - Returned King
4 Belle - Strange but Special
4 Moana - Of Motunui
4 Te Ka - Heartless
4 Dragon Fire
4 Be Prepared`;

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

interface Props {
  definitions: Record<string, CardDefinition>;
}

// -----------------------------------------------------------------------------
// formatAction — converts GameAction → human-readable label
// -----------------------------------------------------------------------------

function formatAction(
  action: GameAction,
  gameState: GameState,
  definitions: Record<string, CardDefinition>,
): string {
  const getCardName = (instanceId: string): string => {
    const instance = gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  };

  switch (action.type) {
    case "PLAY_CARD": {
      const name = getCardName(action.instanceId);
      const instance = gameState.cards[action.instanceId];
      const def = instance ? definitions[instance.definitionId] : null;
      const cost = action.shiftTargetInstanceId
        ? (def?.shiftCost ?? def?.cost ?? "?")
        : (def?.cost ?? "?");

      if (action.shiftTargetInstanceId) {
        return `Shift ${name} onto ${getCardName(action.shiftTargetInstanceId)} (${cost} ink)`;
      }
      if (action.singerInstanceId) {
        return `Sing ${name} with ${getCardName(action.singerInstanceId)}`;
      }
      return `Play ${name} (${cost} ink)`;
    }
    case "PLAY_INK":
      return `Ink ${getCardName(action.instanceId)}`;
    case "QUEST": {
      const instance = gameState.cards[action.instanceId];
      const def = instance ? definitions[instance.definitionId] : null;
      const lore = def?.lore ?? "?";
      return `Quest with ${getCardName(action.instanceId)} (+${lore} lore)`;
    }
    case "CHALLENGE":
      return `Challenge ${getCardName(action.defenderInstanceId)} with ${getCardName(action.attackerInstanceId)}`;
    case "ACTIVATE_ABILITY":
      return `Use ${getCardName(action.instanceId)} ability`;
    case "PASS_TURN":
      return "Pass Turn";
    default:
      return action.type;
  }
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function TestBench({ definitions }: Props) {
  const session = useGameSession();

  // --- Setup state ---
  const [p1DeckText, setP1DeckText] = useState(SAMPLE_DECK);
  const [p2DeckText, setP2DeckText] = useState(SAMPLE_DECK);
  const [botId, setBotId] = useState("greedy");
  const [multiSelectTargets, setMultiSelectTargets] = useState<string[]>([]);

  // --- Parse decks ---
  const p1Parse = useMemo(() => parseDecklist(p1DeckText, definitions), [p1DeckText, definitions]);
  const p2Parse = useMemo(() => parseDecklist(p2DeckText, definitions), [p2DeckText, definitions]);

  const canStart =
    p1Parse.entries.length > 0 &&
    p2Parse.entries.length > 0 &&
    p1Parse.errors.length === 0 &&
    p2Parse.errors.length === 0;

  // --- Start game handler ---
  function handleStart() {
    const botOption = BOT_OPTIONS.find((b) => b.id === botId) ?? BOT_OPTIONS[0]!;
    session.startGame({
      player1Deck: p1Parse.entries,
      player2Deck: p2Parse.entries,
      definitions,
      botStrategy: botOption.bot(),
      player1IsHuman: true,
      player2IsHuman: false,
    });
  }

  // =========================================================================
  // SETUP MODE
  // =========================================================================
  if (!session.gameState) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-amber-400">Test Bench</h2>
        <p className="text-gray-400 text-sm">
          Play an interactive game against a bot. Enter decklists below (or use the sample deck).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* P1 Deck */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Player 1 Deck (You)
            </label>
            <textarea
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              value={p1DeckText}
              onChange={(e) => setP1DeckText(e.target.value)}
              placeholder="4 Card Name&#10;4 Other Card..."
            />
            {p1Parse.errors.length > 0 && (
              <div className="mt-1 text-red-400 text-xs space-y-0.5">
                {p1Parse.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {p1Parse.entries.length > 0 && p1Parse.errors.length === 0 && (
              <div className="mt-1 text-green-400 text-xs">
                {p1Parse.entries.reduce((s, e) => s + e.count, 0)} cards parsed
              </div>
            )}
          </div>

          {/* P2 Deck */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Player 2 Deck (Bot)
            </label>
            <textarea
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              value={p2DeckText}
              onChange={(e) => setP2DeckText(e.target.value)}
              placeholder="4 Card Name&#10;4 Other Card..."
            />
            {p2Parse.errors.length > 0 && (
              <div className="mt-1 text-red-400 text-xs space-y-0.5">
                {p2Parse.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {p2Parse.entries.length > 0 && p2Parse.errors.length === 0 && (
              <div className="mt-1 text-green-400 text-xs">
                {p2Parse.entries.reduce((s, e) => s + e.count, 0)} cards parsed
              </div>
            )}
          </div>
        </div>

        {/* Bot Selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-300">Bot:</label>
          <select
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-amber-500 focus:outline-none"
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
          >
            {BOT_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* Start Button */}
        <button
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-medium transition-colors"
          disabled={!canStart}
          onClick={handleStart}
        >
          Start Game
        </button>
      </div>
    );
  }

  // =========================================================================
  // PLAYING MODE
  // =========================================================================

  const { gameState, legalActions, pendingChoice, actionLog, isGameOver, winner, error } = session;

  const p1 = gameState.players.player1;
  const p2 = gameState.players.player2;
  const p1Zones = gameState.zones.player1;
  const p2Zones = gameState.zones.player2;

  const getCardName = (instanceId: string): string => {
    const instance = gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  };

  const getCardDef = (instanceId: string): CardDefinition | undefined => {
    const instance = gameState.cards[instanceId];
    if (!instance) return undefined;
    return definitions[instance.definitionId];
  };

  // --- Card display helper ---
  function renderPlayCard(instanceId: string, playerId: PlayerID) {
    const instance = gameState!.cards[instanceId];
    if (!instance) return null;
    const def = definitions[instance.definitionId];
    if (!def) return null;

    const isSelected = session.selectedInstanceId === instanceId;
    const badges: string[] = [];
    if (instance.isExerted) badges.push("EXR");
    if (instance.isDrying) badges.push("DRY");
    if (instance.damage > 0) badges.push(`${instance.damage} dmg`);

    return (
      <div
        key={instanceId}
        className={`inline-block border rounded px-2 py-1 text-xs mr-1 mb-1 cursor-pointer transition-colors ${
          isSelected
            ? "border-amber-400 bg-amber-950"
            : "border-gray-700 bg-gray-900 hover:border-gray-500"
        }`}
        onClick={() => session.selectCard(isSelected ? null : instanceId)}
      >
        <span className="font-medium text-gray-200">{def.fullName}</span>
        {def.strength != null && (
          <span className="ml-1 text-gray-500">
            {def.strength + (instance.tempStrengthModifier ?? 0)}/
            {(def.willpower ?? 0) + (instance.tempWillpowerModifier ?? 0) - instance.damage}
          </span>
        )}
        {badges.length > 0 && (
          <span className="ml-1 text-amber-400">[{badges.join(", ")}]</span>
        )}
      </div>
    );
  }

  // --- Hand card display ---
  function renderHandCard(instanceId: string) {
    const instance = gameState!.cards[instanceId];
    if (!instance) return null;
    const def = definitions[instance.definitionId];
    if (!def) return null;

    const isSelected = session.selectedInstanceId === instanceId;

    return (
      <div
        key={instanceId}
        className={`inline-block border rounded px-2 py-1 text-xs mr-1 mb-1 cursor-pointer transition-colors ${
          isSelected
            ? "border-amber-400 bg-amber-950"
            : "border-gray-700 bg-gray-900 hover:border-gray-500"
        }`}
        onClick={() => session.selectCard(isSelected ? null : instanceId)}
      >
        <span className="font-medium text-gray-200">{def.fullName}</span>
        <span className="ml-1 text-gray-500">({def.cost})</span>
        {def.inkable && <span className="ml-1 text-blue-400">INK</span>}
      </div>
    );
  }

  // --- Pending choice UI ---
  function renderPendingChoice() {
    if (!pendingChoice) return null;
    const isHumanChoice = pendingChoice.choosingPlayerId === "player1";
    if (!isHumanChoice) {
      return (
        <div className="border border-yellow-700 bg-yellow-950/30 rounded p-3 text-sm">
          <span className="text-yellow-400">Bot is deciding...</span>
        </div>
      );
    }

    const needsMultiSelect =
      pendingChoice.type === "choose_cards" ||
      pendingChoice.type === "choose_discard" ||
      pendingChoice.type === "choose_from_revealed";

    if (needsMultiSelect) {
      const requiredCount = pendingChoice.count ?? 1;
      return (
        <div className="border border-yellow-700 bg-yellow-950/30 rounded p-3 space-y-2">
          <div className="text-yellow-400 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="text-xs text-gray-400">Select {requiredCount} card(s):</div>
          <div className="flex flex-wrap gap-1">
            {(pendingChoice.validTargets ?? []).map((id) => {
              const selected = multiSelectTargets.includes(id);
              return (
                <button
                  key={id}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    selected
                      ? "border-amber-400 bg-amber-950 text-amber-200"
                      : "border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-400"
                  }`}
                  onClick={() => {
                    setMultiSelectTargets((prev) =>
                      selected ? prev.filter((t) => t !== id) : [...prev, id],
                    );
                  }}
                >
                  {getCardName(id)}
                </button>
              );
            })}
          </div>
          <button
            className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
            disabled={multiSelectTargets.length !== requiredCount}
            onClick={() => {
              session.resolveChoice(multiSelectTargets);
              setMultiSelectTargets([]);
            }}
          >
            Confirm ({multiSelectTargets.length}/{requiredCount})
          </button>
        </div>
      );
    }

    // Single-select choices
    if (pendingChoice.type === "choose_may") {
      return (
        <div className="border border-yellow-700 bg-yellow-950/30 rounded p-3 space-y-2">
          <div className="text-yellow-400 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
              onClick={() => session.resolveChoice("accept")}
            >
              Accept
            </button>
            <button
              className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
              onClick={() => session.resolveChoice("decline")}
            >
              Decline
            </button>
          </div>
        </div>
      );
    }

    if (pendingChoice.type === "choose_option" && pendingChoice.options) {
      return (
        <div className="border border-yellow-700 bg-yellow-950/30 rounded p-3 space-y-2">
          <div className="text-yellow-400 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex flex-wrap gap-2">
            {pendingChoice.options.map((_, i) => (
              <button
                key={i}
                className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded border border-gray-600 transition-colors"
                onClick={() => session.resolveChoice(i)}
              >
                Option {i + 1}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // choose_target — single click dispatches
    return (
      <div className="border border-yellow-700 bg-yellow-950/30 rounded p-3 space-y-2">
        <div className="text-yellow-400 text-sm font-medium">{pendingChoice.prompt}</div>
        <div className="flex flex-wrap gap-1">
          {(pendingChoice.validTargets ?? []).map((id) => (
            <button
              key={id}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded border border-gray-600 transition-colors"
              onClick={() => session.resolveChoice([id])}
            >
              {getCardName(id)}
            </button>
          ))}
          {pendingChoice.optional && (
            <button
              className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 text-gray-200 rounded border border-red-700 transition-colors"
              onClick={() => session.resolveChoice([])}
            >
              Skip (no target)
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- Game log (last 30) ---
  const recentLog = actionLog.slice(-30);

  return (
    <div className="space-y-4">
      {/* Game Over Banner */}
      {isGameOver && (
        <div className="border border-amber-500 bg-amber-950/40 rounded p-4 text-center space-y-2">
          <div className="text-2xl font-bold text-amber-400">
            {winner === "player1" ? "You Win!" : winner === "player2" ? "Bot Wins!" : "Draw!"}
          </div>
          <button
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium transition-colors"
            onClick={session.reset}
          >
            New Game
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 text-sm border-b border-gray-800 pb-3">
        <span className="text-gray-400">
          Turn <span className="text-white font-bold">{gameState.turnNumber}</span>
        </span>
        <span className="text-gray-400">
          {gameState.currentPlayer === "player1" ? (
            <span className="text-green-400 font-medium">Your turn</span>
          ) : (
            <span className="text-red-400 font-medium">Bot's turn</span>
          )}
        </span>
        <span className="text-gray-400">
          P1: <span className="text-amber-400 font-bold">{p1.lore}</span> lore
        </span>
        <span className="text-gray-400">
          P2: <span className="text-amber-400 font-bold">{p2.lore}</span> lore
        </span>
        <span className="text-gray-400">
          Ink: <span className="text-blue-400">{p1.availableInk}/{p1Zones.inkwell.length}</span>
        </span>
        <button
          className="ml-auto px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors"
          onClick={session.reset}
        >
          Reset
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-red-400 text-sm bg-red-950/30 border border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Opponent Board (P2) */}
      <div>
        <div className="text-xs text-gray-500 mb-1">
          Opponent Board ({p2Zones.play.length} cards) — Hand: {p2Zones.hand.length} | Deck: {p2Zones.deck.length} | Ink: {p2.availableInk}/{p2Zones.inkwell.length}
        </div>
        <div className="min-h-[2.5rem] border border-gray-800 rounded p-2 bg-gray-950">
          {p2Zones.play.length === 0 ? (
            <span className="text-gray-600 text-xs">No cards in play</span>
          ) : (
            p2Zones.play.map((id) => renderPlayCard(id, "player2"))
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-dashed border-gray-700" />

      {/* Player Board (P1) */}
      <div>
        <div className="text-xs text-gray-500 mb-1">
          Your Board ({p1Zones.play.length} cards)
        </div>
        <div className="min-h-[2.5rem] border border-gray-800 rounded p-2 bg-gray-950">
          {p1Zones.play.length === 0 ? (
            <span className="text-gray-600 text-xs">No cards in play</span>
          ) : (
            p1Zones.play.map((id) => renderPlayCard(id, "player1"))
          )}
        </div>
      </div>

      {/* Player Hand (P1) */}
      <div>
        <div className="text-xs text-gray-500 mb-1">
          Your Hand ({p1Zones.hand.length} cards)
        </div>
        <div className="min-h-[2.5rem] border border-gray-800 rounded p-2 bg-gray-950">
          {p1Zones.hand.length === 0 ? (
            <span className="text-gray-600 text-xs">No cards in hand</span>
          ) : (
            p1Zones.hand.map((id) => renderHandCard(id))
          )}
        </div>
      </div>

      {/* Pending Choice */}
      {pendingChoice && renderPendingChoice()}

      {/* Legal Actions */}
      {legalActions.length > 0 && !pendingChoice && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Actions</div>
          <div className="flex flex-wrap gap-1">
            {legalActions.map((action, i) => (
              <button
                key={i}
                className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-700 hover:border-gray-500 transition-colors"
                onClick={() => session.dispatch(action)}
              >
                {formatAction(action, gameState, definitions)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Game Log */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Game Log</div>
        <div className="h-40 overflow-y-auto border border-gray-800 rounded p-2 bg-gray-950 text-xs font-mono space-y-0.5">
          {recentLog.map((entry, i) => (
            <div key={i} className="text-gray-400">
              <span className="text-gray-600">T{entry.turn}</span>{" "}
              <span className={entry.playerId === "player1" ? "text-green-500" : "text-red-500"}>
                {entry.playerId === "player1" ? "P1" : "P2"}
              </span>{" "}
              {entry.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
