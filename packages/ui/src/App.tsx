// =============================================================================
// APP ROOT
// Handles game setup (decklist input) and renders the board once a game starts.
// =============================================================================

import { useState } from "react";
import { useGameStore } from "./store/gameStore";
import { SAMPLE_CARDS } from "@lorcana-sim/engine";

// Default test decklists using sample cards
const DEFAULT_P1_DECK = `
4 Simba - Protective Cub
4 Stitch - Rock Star
4 Moana - Of Motunui
4 Tinker Bell - Tiny Tactician
4 Rapunzel - Letting Down Her Hair
4 Hercules - Hero in Training
4 Beast - Hardheaded
4 Gaston - Boastful Hunter
4 Merlin - Arthurian Legend
4 Mickey Mouse - Wayward Sorcerer
4 Ariel - On Human Legs
4 Elsa - Snow Queen
3 Hades - Lord of the Underworld
3 Maui - Hero to All
3 Pascal - Rapunzel's Companion
`.trim();

const DEFAULT_P2_DECK = DEFAULT_P1_DECK;

function SetupScreen() {
  const [p1Deck, setP1Deck] = useState(DEFAULT_P1_DECK);
  const [p2Deck, setP2Deck] = useState(DEFAULT_P2_DECK);
  const { startGame, errorMessage } = useGameStore();

  const availableCards = SAMPLE_CARDS.map((c) => `${c.fullName} (${c.inkColor}, cost ${c.cost})`);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2 text-amber-400">Lorcana Simulator</h1>
        <p className="text-slate-400 mb-8">
          Paste two decklists below (format: <code className="bg-slate-800 px-1 rounded">4 Card Name</code>).
          Both players use the same 60-card deck for testing.
        </p>

        {errorMessage && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-300 font-mono text-sm whitespace-pre">{errorMessage}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Player 1 Deck
            </label>
            <textarea
              value={p1Deck}
              onChange={(e) => setP1Deck(e.target.value)}
              className="w-full h-64 bg-slate-800 border border-slate-600 rounded-lg p-3 font-mono text-sm text-slate-200 focus:outline-none focus:border-amber-400 resize-none"
              placeholder="4 Card Name&#10;3 Another Card&#10;..."
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Player 2 Deck
            </label>
            <textarea
              value={p2Deck}
              onChange={(e) => setP2Deck(e.target.value)}
              className="w-full h-64 bg-slate-800 border border-slate-600 rounded-lg p-3 font-mono text-sm text-slate-200 focus:outline-none focus:border-amber-400 resize-none"
              placeholder="4 Card Name&#10;3 Another Card&#10;..."
            />
          </div>
        </div>

        <button
          onClick={() => startGame(p1Deck, p2Deck)}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-lg rounded-lg transition-colors"
        >
          Start Game
        </button>

        <details className="mt-8">
          <summary className="cursor-pointer text-slate-400 hover:text-slate-200 text-sm">
            Available cards ({SAMPLE_CARDS.length})
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-1">
            {availableCards.map((c, i) => (
              <li key={i} className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded">
                {c}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

function GameBoard() {
  const { gameState, definitions, dispatch, selectedCardId, selectCard, errorMessage } = useGameStore();
  if (!gameState) return null;

  const { players, currentPlayer, phase, turnNumber } = gameState;

  const getZoneCards = (playerId: "player1" | "player2", zone: string) => {
    return (gameState.zones[playerId][zone as keyof typeof gameState.zones.player1] ?? []).map(
      (id) => ({ instance: gameState.cards[id]!, def: definitions[gameState.cards[id]!.definitionId]! })
    );
  };

  const handleCardClick = (instanceId: string) => {
    const instance = gameState.cards[instanceId];
    if (!instance) return;
    const def = definitions[instance.definitionId];
    if (!def) return;

    // If we have a selected card and this is an opponent's exerted character, try challenge
    if (selectedCardId && instance.ownerId !== currentPlayer && instance.isExerted) {
      dispatch({
        type: "CHALLENGE",
        playerId: currentPlayer,
        attackerInstanceId: selectedCardId,
        defenderInstanceId: instanceId,
      });
      selectCard(null);
      return;
    }

    selectCard(selectedCardId === instanceId ? null : instanceId);
  };

  const handleQuestClick = (instanceId: string) => {
    dispatch({ type: "QUEST", playerId: currentPlayer, instanceId });
    selectCard(null);
  };

  const handlePlayCardClick = (instanceId: string) => {
    dispatch({ type: "PLAY_CARD", playerId: currentPlayer, instanceId });
    selectCard(null);
  };

  const handleInkCardClick = (instanceId: string) => {
    dispatch({ type: "PLAY_INK", playerId: currentPlayer, instanceId });
    selectCard(null);
  };

  const renderCard = (
    id: string,
    def: ReturnType<typeof getZoneCards>[number]["def"],
    instance: ReturnType<typeof getZoneCards>[number]["instance"],
    zone: string,
    clickable = false
  ) => {
    const isSelected = selectedCardId === id;
    const isCurrentPlayer = instance.ownerId === currentPlayer;
    const canAct = isCurrentPlayer && !instance.isExerted && !instance.hasActedThisTurn;

    return (
      <div
        key={id}
        onClick={() => clickable && handleCardClick(id)}
        className={`
          relative w-20 h-28 rounded-lg border-2 cursor-pointer select-none text-xs flex flex-col
          transition-all duration-150
          ${isSelected ? "border-amber-400 scale-105 shadow-lg shadow-amber-400/30" : "border-slate-600"}
          ${instance.isExerted ? "rotate-90 opacity-75" : ""}
          ${canAct && zone === "play" ? "border-green-500 hover:border-green-400" : ""}
          ${instance.ownerId === "player1" ? "bg-blue-900/70" : "bg-red-900/70"}
        `}
      >
        {/* Ink color dot */}
        <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${inkColorClass(def?.inkColor)}`} />

        <div className="p-1 flex-1 overflow-hidden">
          <p className="font-bold text-white leading-tight" style={{ fontSize: "9px" }}>
            {def?.name ?? "?"}
          </p>
          {def?.subtitle && (
            <p className="text-slate-300 leading-tight" style={{ fontSize: "8px" }}>
              {def.subtitle}
            </p>
          )}
        </div>

        {def?.cardType === "character" && (
          <div className="px-1 pb-1 flex justify-between text-slate-300" style={{ fontSize: "9px" }}>
            <span>⚔ {def.strength}</span>
            <span>🛡 {def.willpower}</span>
            <span>◆ {def.lore}</span>
          </div>
        )}

        {instance.damage > 0 && (
          <div className="absolute top-0 left-0 bg-red-600 text-white rounded-br px-1" style={{ fontSize: "8px" }}>
            -{instance.damage}
          </div>
        )}
      </div>
    );
  };

  const inkColorClass = (color?: string) => {
    const map: Record<string, string> = {
      amber: "bg-amber-400",
      amethyst: "bg-purple-400",
      emerald: "bg-emerald-400",
      ruby: "bg-red-400",
      sapphire: "bg-blue-400",
      steel: "bg-slate-400",
    };
    return map[color ?? ""] ?? "bg-gray-400";
  };

  const p1Play = getZoneCards("player1", "play");
  const p2Play = getZoneCards("player2", "play");
  const p1Hand = getZoneCards("player1", "hand");
  const p2Hand = getZoneCards("player2", "hand");

  const selectedInstance = selectedCardId ? gameState.cards[selectedCardId] : null;
  const selectedDef = selectedInstance ? definitions[selectedInstance.definitionId] : null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-6">
          <span className="text-amber-400 font-bold">Turn {turnNumber}</span>
          <span className={`font-semibold ${currentPlayer === "player1" ? "text-blue-400" : "text-red-400"}`}>
            {currentPlayer === "player1" ? "🔵 Player 1's Turn" : "🔴 Player 2's Turn"}
          </span>
          <span className="text-slate-400 text-sm">{phase}</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span className="text-blue-400">P1 Lore: {players.player1.lore}/20</span>
          <span className="text-red-400">P2 Lore: {players.player2.lore}/20</span>
          <span className="text-amber-400">
            Ink: {players[currentPlayer].availableInk} available
          </span>
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="bg-red-900/70 border-b border-red-600 px-4 py-2 text-red-300 text-sm">
          {errorMessage}
        </div>
      )}

      {/* Game over */}
      {gameState.isGameOver && (
        <div className="bg-amber-900/70 border-b border-amber-500 px-4 py-3 text-center">
          <span className="text-amber-300 font-bold text-xl">
            🏆 {gameState.winner === "player1" ? "Player 1" : "Player 2"} wins!
          </span>
        </div>
      )}

      {/* Board */}
      <div className="flex-1 flex flex-col p-4 gap-4">
        {/* P2 Zone */}
        <div className="border border-red-900/50 rounded-xl p-3 bg-red-950/20">
          <div className="text-red-400 text-xs font-semibold mb-2">
            Player 2 — Deck: {gameState.zones.player2.deck.length} | Discard: {gameState.zones.player2.discard.length} | Ink: {gameState.zones.player2.inkwell.length}
          </div>
          <div className="flex flex-wrap gap-2 min-h-12">
            {p2Play.map(({ instance, def }) =>
              renderCard(instance.instanceId, def, instance, "play", true)
            )}
          </div>
        </div>

        {/* P1 Zone */}
        <div className="border border-blue-900/50 rounded-xl p-3 bg-blue-950/20">
          <div className="text-blue-400 text-xs font-semibold mb-2">
            Player 1 — Deck: {gameState.zones.player1.deck.length} | Discard: {gameState.zones.player1.discard.length} | Ink: {gameState.zones.player1.inkwell.length}
          </div>
          <div className="flex flex-wrap gap-2 min-h-12">
            {p1Play.map(({ instance, def }) =>
              renderCard(instance.instanceId, def, instance, "play", true)
            )}
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-3 px-2">
          {selectedCardId && selectedInstance && selectedDef && (
            <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 text-sm">
              <span className="text-amber-300 font-semibold">{selectedDef.fullName}</span>
              {selectedInstance.zone === "hand" && selectedInstance.ownerId === currentPlayer && (
                <>
                  <button
                    onClick={() => handlePlayCardClick(selectedCardId)}
                    className="bg-green-700 hover:bg-green-600 px-2 py-1 rounded text-xs font-semibold"
                  >
                    Play ({selectedDef.cost}🔷)
                  </button>
                  {selectedDef.inkable && !players[currentPlayer].hasPlayedInkThisTurn && (
                    <button
                      onClick={() => handleInkCardClick(selectedCardId)}
                      className="bg-blue-700 hover:bg-blue-600 px-2 py-1 rounded text-xs font-semibold"
                    >
                      Add to Inkwell
                    </button>
                  )}
                </>
              )}
              {selectedInstance.zone === "play" && selectedInstance.ownerId === currentPlayer &&
                !selectedInstance.isExerted && !selectedInstance.hasActedThisTurn && (
                  <button
                    onClick={() => handleQuestClick(selectedCardId)}
                    className="bg-amber-700 hover:bg-amber-600 px-2 py-1 rounded text-xs font-semibold"
                  >
                    Quest (+{selectedDef.lore ?? 0} lore)
                  </button>
                )}
              <button
                onClick={() => selectCard(null)}
                className="text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          <div className="ml-auto">
            <button
              onClick={() => dispatch({ type: "PASS_TURN", playerId: currentPlayer })}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
            >
              Pass Turn →
            </button>
          </div>
        </div>

        {/* Hands */}
        <div className="grid grid-cols-2 gap-4">
          {(["player1", "player2"] as const).map((pid) => (
            <div key={pid} className={`rounded-xl p-3 border ${pid === "player1" ? "border-blue-900/50 bg-blue-950/10" : "border-red-900/50 bg-red-950/10"}`}>
              <div className={`text-xs font-semibold mb-2 ${pid === "player1" ? "text-blue-400" : "text-red-400"}`}>
                {pid === "player1" ? "Player 1" : "Player 2"} Hand ({(pid === "player1" ? p1Hand : p2Hand).length} cards)
              </div>
              <div className="flex flex-wrap gap-2">
                {(pid === "player1" ? p1Hand : p2Hand).map(({ instance, def }) =>
                  renderCard(instance.instanceId, def, instance, "hand", pid === currentPlayer)
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Log */}
      <div className="h-24 bg-slate-800/50 border-t border-slate-700 overflow-y-auto px-4 py-2">
        {[...gameState.actionLog].reverse().slice(0, 8).map((entry, i) => (
          <p key={i} className="text-xs text-slate-400 font-mono">
            <span className="text-slate-600">[T{entry.turn}]</span> {entry.message}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const gameState = useGameStore((s) => s.gameState);
  return gameState ? <GameBoard /> : <SetupScreen />;
}
