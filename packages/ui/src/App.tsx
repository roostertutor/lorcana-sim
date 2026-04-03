import React, { useState } from "react";
import { LORCAST_CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import DeckInput from "./pages/DeckInput.js";
import CompositionView from "./pages/CompositionView.js";
import SimulationView from "./pages/SimulationView.js";
import ComparisonView from "./pages/ComparisonView.js";
import TestBench from "./pages/TestBench.js";
import GameBoard from "./pages/GameBoard.js";
import MultiplayerLobby from "./pages/MultiplayerLobby.js";

type Tab = "deck" | "composition" | "simulate" | "compare" | "play" | "testbench" | "multiplayer";

const TABS: { id: Tab; label: string; requiresDeck?: boolean }[] = [
  { id: "deck", label: "Deck Input" },
  { id: "composition", label: "Composition", requiresDeck: true },
  { id: "simulate", label: "Simulate", requiresDeck: true },
  { id: "compare", label: "Compare" },
  { id: "play", label: "Play" },
  { id: "testbench", label: "Test Bench" },
  { id: "multiplayer", label: "Multiplayer" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("deck");
  const [deckText, setDeckText] = useState("");
  const [deck, setDeck] = useState<DeckEntry[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [multiplayerGame, setMultiplayerGame] = useState<{
    gameId: string;
    myPlayerId: "player1" | "player2";
    token: string;
  } | null>(null);

  function handleDeckChange(text: string) {
    setDeckText(text);
    if (!text.trim()) {
      setDeck(null);
      setParseErrors([]);
      return;
    }
    const { entries, errors } = parseDecklist(text, LORCAST_CARD_DEFINITIONS);
    setDeck(entries.length > 0 ? entries : null);
    setParseErrors(errors);
  }

  const totalCards = deck?.reduce((s, e) => s + e.count, 0) ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-xl font-bold tracking-tight">⬡ Lorcana Sim</span>
          <span className="text-gray-600 text-sm hidden sm:block">headless analytics engine</span>
          {deck && (
            <span className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
              {totalCards} cards loaded
            </span>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 py-2 flex gap-1 flex-wrap">
          {TABS.map((t) => {
            const disabled = t.requiresDeck && !deck;
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setActiveTab(t.id)}
                className={activeTab === t.id ? "tab-active" : "tab-inactive"}
                disabled={disabled}
                title={disabled ? "Load a deck first" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {activeTab === "deck" && (
          <DeckInput
            deckText={deckText}
            parseErrors={parseErrors}
            deck={deck}
            onChange={handleDeckChange}
            onAnalyze={() => deck && setActiveTab("composition")}
          />
        )}
        {activeTab === "composition" && deck && (
          <CompositionView deck={deck} definitions={LORCAST_CARD_DEFINITIONS} />
        )}
        {activeTab === "simulate" && deck && (
          <SimulationView deck={deck} definitions={LORCAST_CARD_DEFINITIONS} />
        )}
        {activeTab === "compare" && (
          <ComparisonView definitions={LORCAST_CARD_DEFINITIONS} />
        )}
        {activeTab === "play" && (
          <GameBoard definitions={LORCAST_CARD_DEFINITIONS} />
        )}
        {activeTab === "testbench" && (
          <TestBench definitions={LORCAST_CARD_DEFINITIONS} />
        )}
        {activeTab === "multiplayer" && (
          multiplayerGame
            ? <GameBoard
                definitions={LORCAST_CARD_DEFINITIONS}
                multiplayerGame={multiplayerGame}
              />
            : <MultiplayerLobby
                deck={deck}
                onGameStart={(gameId, myPlayerId, token) => {
                  setMultiplayerGame({ gameId, myPlayerId, token });
                }}
              />
        )}
      </main>
    </div>
  );
}
