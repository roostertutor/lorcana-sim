import React, { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from "react-router-dom";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import type { ReplayData } from "./hooks/useGameSession.js";
import { getGameReplay, getGameInfo } from "./lib/serverApi.js";
import DecksPage from "./pages/DecksPage.js";
import DeckBuilderPage from "./pages/DeckBuilderPage.js";
import SimulationView from "./pages/SimulationView.js";
import SandboxLobby from "./pages/SandboxLobby.js";
import GameBoard from "./pages/GameBoard.js";
import MultiplayerLobby from "./pages/MultiplayerLobby.js";
import DevAddCardPage from "./pages/DevAddCardPage.js";

type Tab = "decks" | "multiplayer";

const TABS: { id: Tab; path: string; label: string }[] = [
  { id: "decks", path: "/", label: "Decks" },
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
  // Opponent deck is optional — undefined falls back to mirror in GameBoard.
  // sessionStorage entry is cleared by the lobby when the user picks Mirror.
  const [opponentDeck] = useState<DeckEntry[] | undefined>(() => {
    try {
      const raw = sessionStorage.getItem("solo-opponent-deck");
      return raw ? (JSON.parse(raw) as DeckEntry[]) : undefined;
    } catch { return undefined; }
  });

  return (
    <GameBoard
      definitions={CARD_DEFINITIONS}
      initialDeck={deck}
      {...(opponentDeck ? { opponentDeck } : {})}
      onBack={() => navigate("/multiplayer")}
    />
  );
}

function SandboxGamePage() {
  const navigate = useNavigate();
  return (
    <GameBoard
      definitions={CARD_DEFINITIONS}
      sandboxMode
      onBack={() => navigate("/sandbox")}
    />
  );
}

function MultiplayerGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  // Read multiplayer config from localStorage (persisted on game start)
  const [config, setConfig] = useState<{ gameId: string; myPlayerId: "player1" | "player2" } | null>(() => {
    try {
      const raw = localStorage.getItem("mp-game");
      return raw ? (JSON.parse(raw) as { gameId: string; myPlayerId: "player1" | "player2" }) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // If no localStorage config (e.g. rejoin from error), fetch player side from server
  useEffect(() => {
    if (config?.gameId === gameId || !gameId) return;
    setLoading(true);
    getGameInfo(gameId)
      .then((info) => {
        if (info && info.status === "active") {
          const cfg = { gameId, myPlayerId: info.playerSide };
          localStorage.setItem("mp-game", JSON.stringify(cfg));
          setConfig(cfg);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [gameId, config]);

  if (failed) {
    return <Navigate to="/multiplayer" replace />;
  }

  if (loading || !config || config.gameId !== gameId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="text-gray-500 text-sm animate-pulse">Reconnecting to game...</span>
      </div>
    );
  }

  return (
    <GameBoard
      definitions={CARD_DEFINITIONS}
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
        onPlaySolo={(deck, opponentDeck) => {
          sessionStorage.setItem("solo-deck", JSON.stringify(deck));
          // Mirror match (no opponent provided) — clear any prior pick so
          // SoloGamePage falls back to deck-vs-deck.
          if (opponentDeck) {
            sessionStorage.setItem("solo-opponent-deck", JSON.stringify(opponentDeck));
          } else {
            sessionStorage.removeItem("solo-opponent-deck");
          }
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
  // Safe-area insets: in PWA standalone mode the webview extends under the
  // iOS status bar (Dynamic Island / notch / clock) and home-indicator bar.
  // Without padding, the sticky header slides under the status bar and the
  // footer sits behind the home indicator. env(safe-area-inset-*) returns 0
  // in Safari browser mode (browser chrome already reserves the space), so
  // these padding classes only take effect in the installed PWA.
  //
  // Padding applied to the header/footer/aside rather than the outer div so:
  // - header background extends up into the status bar (status bar inherits
  //   the header's translucent dark color, looks intentional)
  // - `sticky top-0` still pins to viewport y=0 while content inside the
  //   header sits below the status bar via its own padding
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <header
        className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
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
        activeTab === "multiplayer"
          ? "p-0"
          : "max-w-6xl mx-auto px-4 py-6"
      }`}>
        {children}
      </main>

      <footer
        className="border-t border-gray-800 bg-gray-950 px-4 py-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <p className="max-w-6xl mx-auto text-[10px] leading-relaxed text-gray-600 text-center">
          This site uses trademarks and/or copyrights associated with Disney Lorcana TCG,
          used under Ravensburger's Community Code Policy. We are expressly prohibited from
          charging you to use or access this content. This site is not published, endorsed,
          or specifically approved by Disney or Ravensburger. For more information about
          Disney Lorcana TCG, visit{" "}
          <a href="https://disneylorcana.com" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-400 underline">
            disneylorcana.com
          </a>.
        </p>
      </footer>
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
        onPlaySolo={(deck, opponentDeck) => {
          sessionStorage.setItem("solo-deck", JSON.stringify(deck));
          // Mirror match (no opponent provided) — clear any prior pick so
          // SoloGamePage falls back to deck-vs-deck.
          if (opponentDeck) {
            sessionStorage.setItem("solo-opponent-deck", JSON.stringify(opponentDeck));
          } else {
            sessionStorage.removeItem("solo-opponent-deck");
          }
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
      definitions={CARD_DEFINITIONS}
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
      <Route path="/decks/new" element={<TabPage tab="decks"><DeckBuilderPage /></TabPage>} />
      <Route path="/decks/:id" element={<TabPage tab="decks"><DeckBuilderPage /></TabPage>} />
      <Route path="/multiplayer" element={<MultiplayerPage />} />

      {/* Lobby join via URL — /lobby/ABC123 */}
      <Route path="/lobby/:code" element={<LobbyJoinPage />} />

      {/* Dev-only routes (URL access only, no tab) */}
      <Route path="/simulate" element={<SimulationView />} />
      <Route path="/sandbox" element={<SandboxLobby />} />
      <Route path="/sandbox/play" element={<SandboxGamePage />} />
      <Route path="/solo" element={<SoloGamePage />} />
      <Route path="/game/:gameId" element={<MultiplayerGamePage />} />
      <Route path="/replay/:gameId" element={<ReplayPage />} />
      <Route path="/dev/add-card" element={<DevAddCardPage />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
