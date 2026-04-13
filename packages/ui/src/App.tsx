import React, { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from "react-router-dom";
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import type { ReplayData } from "./hooks/useGameSession.js";
import { getGameReplay } from "./lib/serverApi.js";
import DecksPage from "./pages/DecksPage.js";
import SimulationView from "./pages/SimulationView.js";
import TestBench from "./pages/TestBench.js";
import GameBoard from "./pages/GameBoard.js";
import MultiplayerLobby from "./pages/MultiplayerLobby.js";

type Tab = "decks" | "simulate" | "sandbox" | "multiplayer";

const TABS: { id: Tab; path: string; label: string }[] = [
  { id: "decks", path: "/", label: "Decks" },
  { id: "simulate", path: "/simulate", label: "Simulate" },
  { id: "sandbox", path: "/sandbox", label: "Sandbox" },
  { id: "multiplayer", path: "/multiplayer", label: "Multiplayer" },
];

// ---------------------------------------------------------------------------
// Full-screen game pages (no header/nav)
// ---------------------------------------------------------------------------

function SoloGamePage() {
  const navigate = useNavigate();
  const [deck] = useState<DeckEntry[]>(() => {
    try {
      const raw = sessionStorage.getItem("solo-deck");
      return raw ? (JSON.parse(raw) as DeckEntry[]) : [];
    } catch { return []; }
  });

  return (
    <GameBoard
      definitions={LORCAST_CARD_DEFINITIONS}
      initialDeck={deck}
      onBack={() => navigate("/multiplayer")}
    />
  );
}

function MultiplayerGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  // Read multiplayer config from localStorage (persisted on game start)
  const [config] = useState(() => {
    try {
      const raw = localStorage.getItem("mp-game");
      return raw ? (JSON.parse(raw) as { gameId: string; myPlayerId: "player1" | "player2" }) : null;
    } catch { return null; }
  });

  // If config doesn't match this gameId (stale or missing), go back to lobby
  if (!config || config.gameId !== gameId) {
    return <Navigate to="/multiplayer" replace />;
  }

  return (
    <GameBoard
      definitions={LORCAST_CARD_DEFINITIONS}
      multiplayerGame={config}
      onBack={() => {
        localStorage.removeItem("mp-game");
        navigate("/multiplayer");
      }}
    />
  );
}

function LobbyJoinPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  return (
    <Shell activeTab="multiplayer" navigate={navigate}>
      <MultiplayerLobby
        initialJoinCode={code ?? ""}
        onGameStart={(gameId, myPlayerId) => {
          localStorage.setItem("mp-game", JSON.stringify({ gameId, myPlayerId }));
          navigate(`/game/${gameId}`);
        }}
        onPlaySolo={(deck) => {
          sessionStorage.setItem("solo-deck", JSON.stringify(deck));
          navigate("/solo");
        }}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell — header + tab nav wrapper
// ---------------------------------------------------------------------------

function Shell({ children, activeTab, navigate }: { children: React.ReactNode; activeTab: Tab; navigate: (path: string) => void }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-xl font-bold tracking-tight">⬡ Lorcana Sim</span>
          <span className="text-gray-600 text-sm hidden sm:block">headless analytics engine</span>
        </div>
      </header>

      <nav className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 py-2 flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(t.path)}
              className={activeTab === t.id ? "tab-active" : "tab-inactive"}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className={`flex-1 w-full ${
        activeTab === "sandbox" || activeTab === "multiplayer"
          ? "p-0"
          : "max-w-6xl mx-auto px-4 py-6"
      }`}>
        {children}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab pages (with Shell)
// ---------------------------------------------------------------------------

function TabPage({ tab, children }: { tab: Tab; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <Shell activeTab={tab} navigate={navigate}>
      {children}
    </Shell>
  );
}

function MultiplayerPage() {
  const navigate = useNavigate();

  // Check for active game on mount — reconnect if found
  const [reconnectGameId] = useState(() => {
    try {
      const raw = localStorage.getItem("mp-game");
      if (!raw) return null;
      const config = JSON.parse(raw) as { gameId: string };
      return config.gameId;
    } catch { return null; }
  });

  if (reconnectGameId) {
    return <Navigate to={`/game/${reconnectGameId}`} replace />;
  }

  return (
    <Shell activeTab="multiplayer" navigate={navigate}>
      <MultiplayerLobby
        onGameStart={(gameId, myPlayerId) => {
          localStorage.setItem("mp-game", JSON.stringify({ gameId, myPlayerId }));
          navigate(`/game/${gameId}`);
        }}
        onPlaySolo={(deck) => {
          sessionStorage.setItem("solo-deck", JSON.stringify(deck));
          navigate("/solo");
        }}
      />
    </Shell>
  );
}

function ReplayPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    getGameReplay(gameId)
      .then((data) => {
        if (data) {
          setReplayData({
            seed: data.seed,
            p1Deck: data.p1Deck,
            p2Deck: data.p2Deck,
            actions: data.actions,
            winner: (data.winner as ReplayData["winner"]) ?? null,
            turnCount: data.turnCount,
          });
        } else {
          setError("Replay not found");
        }
      })
      .catch(() => setError("Failed to load replay"));
  }, [gameId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center space-y-3">
          <div className="text-red-400">{error}</div>
          <button className="text-amber-400 text-sm hover:underline" onClick={() => navigate("/multiplayer")}>
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!replayData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="text-gray-500 text-sm animate-pulse">Loading replay...</span>
      </div>
    );
  }

  return (
    <GameBoard
      definitions={LORCAST_CARD_DEFINITIONS}
      initialReplayData={replayData}
      onBack={() => navigate("/multiplayer")}
    />
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <Routes>
      {/* Tab pages */}
      <Route path="/" element={<TabPage tab="decks"><DecksPage /></TabPage>} />
      <Route path="/simulate" element={<TabPage tab="simulate"><SimulationView /></TabPage>} />
      <Route path="/sandbox" element={<TabPage tab="sandbox"><TestBench definitions={LORCAST_CARD_DEFINITIONS} /></TabPage>} />
      <Route path="/multiplayer" element={<MultiplayerPage />} />

      {/* Lobby join via URL — /lobby/ABC123 */}
      <Route path="/lobby/:code" element={<LobbyJoinPage />} />

      {/* Full-screen game pages */}
      <Route path="/solo" element={<SoloGamePage />} />
      <Route path="/game/:gameId" element={<MultiplayerGamePage />} />
      <Route path="/replay/:gameId" element={<ReplayPage />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
