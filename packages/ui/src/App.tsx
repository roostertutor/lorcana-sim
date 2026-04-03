import React, { useState } from "react";
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import DecksPage from "./pages/DecksPage.js";
import SimulationView from "./pages/SimulationView.js";
import TestBench from "./pages/TestBench.js";
import GameBoard from "./pages/GameBoard.js";
import MultiplayerLobby from "./pages/MultiplayerLobby.js";

type Tab = "decks" | "simulate" | "testbench" | "multiplayer";

const TABS: { id: Tab; label: string }[] = [
  { id: "decks", label: "Decks" },
  { id: "simulate", label: "Simulate" },
  { id: "testbench", label: "Sandbox" },
  { id: "multiplayer", label: "Multiplayer" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(
    () => (localStorage.getItem("activeTab") as Tab | null) ?? "decks"
  );
  const [soloMode, setSoloMode] = useState(false);
  const [multiplayerGame, setMultiplayerGame] = useState<{
    gameId: string;
    myPlayerId: "player1" | "player2";
    token: string;
  } | null>(null);

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    localStorage.setItem("activeTab", tab);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-xl font-bold tracking-tight">⬡ Lorcana Sim</span>
          <span className="text-gray-600 text-sm hidden sm:block">headless analytics engine</span>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 py-2 flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={activeTab === t.id ? "tab-active" : "tab-inactive"}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className={`flex-1 min-h-0 w-full ${
        activeTab === "testbench" || activeTab === "multiplayer"
          ? "p-0 overflow-hidden"
          : "max-w-6xl mx-auto px-4 py-6"
      }`}>
        {activeTab === "decks" && <DecksPage />}
        {activeTab === "simulate" && <SimulationView />}
        {activeTab === "testbench" && (
          <TestBench definitions={LORCAST_CARD_DEFINITIONS} />
        )}
        {activeTab === "multiplayer" && (
          soloMode
            ? <GameBoard definitions={LORCAST_CARD_DEFINITIONS} onBack={() => setSoloMode(false)} />
            : multiplayerGame
              ? <GameBoard
                  definitions={LORCAST_CARD_DEFINITIONS}
                  multiplayerGame={multiplayerGame}
                />
              : <MultiplayerLobby
                  onGameStart={(gameId, myPlayerId, token) => {
                    setMultiplayerGame({ gameId, myPlayerId, token });
                  }}
                  onPlaySolo={() => setSoloMode(true)}
                />
        )}
      </main>
    </div>
  );
}
