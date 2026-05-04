import React, { useState, useEffect, useRef } from "react";
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from "react-router-dom";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import type { ReplayInput, RemoteReplay } from "./hooks/useReplaySession.js";
import { getGameReplay, getSharedReplay, getGameInfo, getProfile } from "./lib/serverApi.js";
import type { ReplayMeta, Profile } from "./lib/serverApi.js";
import { supabase } from "./lib/supabase.js";
import DecksPage from "./pages/DecksPage.js";
import DeckBuilderPage from "./pages/DeckBuilderPage.js";
import SimulationView from "./pages/SimulationView.js";
import SandboxLobby from "./pages/SandboxLobby.js";
import GameBoard from "./pages/GameBoard.js";
import MultiplayerLobby from "./pages/MultiplayerLobby.js";
import ReplaysPage from "./pages/ReplaysPage.js";
import DevAddCardPage from "./pages/DevAddCardPage.js";
import MePage from "./pages/MePage.js";
import Icon, { type IconName } from "./components/Icon.js";

type Tab = "decks" | "multiplayer" | "replays" | "sandbox" | "me";

// Order: Decks → Replays → Play → Sandbox → Me. Play sits at index 2
// (visual center of 5) so it can be visually emphasized as the primary
// action via styling. Workflow reads left-to-right: prep (Decks) →
// review (Replays) → play (primary) → tinker (Sandbox) → account (Me).
const TABS: { id: Tab; path: string; label: string; icon: IconName }[] = [
  { id: "decks", path: "/", label: "Decks", icon: "rectangle-stack" },
  { id: "replays", path: "/replays", label: "Replays", icon: "clock" },
  // Tab id + path stay "multiplayer" — preserves bookmarks and the
  // /lobby/:code shareable links that route through MultiplayerLobby.
  // Label "Play" is honest about scope: this tab also hosts Solo (vs
  // bot), which isn't multiplayer in the strict sense. Visually
  // emphasized in the bottom nav as the primary action (sits at index
  // 2 of 5 = visual center).
  { id: "multiplayer", path: "/multiplayer", label: "Play", icon: "play" },
  // Sandbox surfaced as a top-level tab — installed PWA can't easily type
  // URLs to reach `/sandbox`, so the route needed a discoverable entry point.
  { id: "sandbox", path: "/sandbox", label: "Sandbox", icon: "wrench" },
  // Me page — username, ELO grid (8 ratings), games played, sign out.
  // The full version of what UserMenu's avatar dropdown shows in
  // summary form. Avatar dropdown still works as a quick-access escape
  // hatch (Sign out from anywhere without navigating to /me first).
  { id: "me", path: "/me", label: "Me", icon: "user-circle" },
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
// UserMenu — avatar + sign-out menu in the top-right of Shell. Subscribes
// to supabase auth so it reflects sign-in/out from anywhere (lobby still
// has its own form; this is the global indicator + escape hatch).
// ---------------------------------------------------------------------------

function UserMenu({ navigate }: { navigate: (path: string) => void }) {
  const [session, setSession] = useState<{ email: string } | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile (username, games_played, ELO) when session becomes valid.
  // Used for display only — email is intentionally NEVER rendered, so we
  // never leak it on a stream / screenshare. Username is the public-facing
  // handle.
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    getProfile().then((p) => { if (p) setProfile(p); });
  }, [session]);

  // Close popover on outside click. mousedown beats click so a click on
  // the avatar after the popover is open doesn't immediately re-open it.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setOpen(false);
  }

  // Loading state — render nothing to avoid flicker between "Sign in" and
  // the avatar on first paint while supabase resolves the cached session.
  if (session === undefined) return null;

  if (!session) {
    return (
      <button
        onClick={() => navigate("/multiplayer")}
        className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg font-medium transition-colors shrink-0"
        title="Sign in to save decks and play multiplayer"
      >
        Sign in
      </button>
    );
  }

  // First letter of USERNAME (not email). Showing email's first char on the
  // avatar leaked one bit of identity to anyone watching the screen — fine
  // most of the time, dox-vector for streamers / screenshares. Fallback to
  // "?" while profile is loading; "Player" if profile resolved without a
  // username (shouldn't happen with ensureProfile, but defensive).
  const displayName = profile?.username ?? "Player";
  const initial = profile ? (displayName[0]?.toUpperCase() ?? "?") : "?";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full bg-amber-600 hover:bg-amber-500 text-gray-950 text-xs font-bold flex items-center justify-center transition-colors"
        // Tooltip + aria-label use username, NOT email — same anti-leak rule.
        title={displayName}
        aria-label={`Account: ${displayName}`}
      >
        {initial}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-gray-950 border border-gray-700 rounded-lg shadow-xl py-1 z-30">
          {/* Identity block — username only. Email deliberately NOT
               shown anywhere (anti-doxx on streams). The ELO + games
               summary line that used to live here was dropped 2026-
               05-03 — profile.elo is the legacy single-rotation
               field, not a meaningful aggregate of the per-format
               matrix on /me, and the overall games_played counter
               became redundant once /me had per-format counts. The
               dropdown is now identity + navigation + actions; stats
               live on the Profile page one tap away. */}
          <div className="px-3 py-2 border-b border-gray-800">
            <div className="text-sm font-semibold text-gray-200 truncate" title={displayName}>
              {displayName}
            </div>
          </div>
          {/* Profile link removed 2026-05-04 — the top-nav `Me` tab
               (desktop / landscape phone) and bottom-nav `Me` tab
               (portrait phone) already navigate to /me from anywhere,
               so a Profile link in the avatar dropdown duplicated
               that affordance. Dropdown's job is now identity +
               sign-out (the unique value it still provides — sign-out
               isn't a primary nav surface). */}
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
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
    // pb-[…] reserves room at the bottom on all mobile viewports
    // (portrait + landscape phone) for the fixed BottomNav rendered
    // below. Removed only on md+ (tablet / desktop, where the top nav
    // takes over). Bottom nav on all mobile keeps navigation in the
    // same physical location regardless of phone orientation —
    // rotating shouldn't move the chrome around.
    <div
      className="min-h-screen flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Top chrome — single row: logo + tabs. Consolidated 2026-04-25 from
           a stacked header (logo) + nav (tabs) layout that ate ~90px of
           vertical space before any content. New layout is ~45px and lands
           the strategic claim ("less chrome, more game") in the surface
           every user sees on every page. Tabs use overflow-x-auto with
           scrollbar-none so narrow viewports can swipe through tabs
           instead of wrapping to a second row (which defeats the
           consolidation). The dev-flavored subtitle ("headless analytics
           engine") was dropped — the brand is no longer dev-tools-first. */}
      <header
        className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/")}
            className="text-amber-400 text-lg font-bold tracking-tight shrink-0 hover:text-amber-300 transition-colors"
            title="Home"
          >
            ⬡ Lorcana Sim
          </button>
          {/* Top tabs — hidden on ALL mobile (portrait + landscape
               phone); BottomNav below owns navigation there. Shown on
               md+ (tablet / desktop). Decision 2026-05-03: keeping
               nav location consistent across orientation matters more
               than the small vertical-space delta on landscape phone
               — rotating the device shouldn't move the chrome around.
               Top + bottom nav are roughly the same height (~50px),
               so the trade is mostly relocating chrome, not adding/
               removing it. */}
          <nav className="hidden md:block flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <div className="flex gap-1 flex-nowrap">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(t.path)}
                  className={`shrink-0 ${activeTab === t.id ? "tab-active" : "tab-inactive"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>
          {/* Spacer so UserMenu still right-aligns when the top nav
               is hidden (all mobile — portrait + landscape phone).
               On md+ the nav itself has flex-1 and takes the
               remaining space, so the spacer hides. */}
          <div className="md:hidden flex-1" />
          {/* Avatar + sign-out — right-aligned. Subscribes to supabase auth
               independently from the lobby so signing out here propagates
               to MultiplayerLobby's own session listener. */}
          <UserMenu navigate={navigate} />
        </div>
      </header>

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

      {/* Bottom nav — all-mobile thumb-zone navigation (portrait +
           landscape phone). Tabs migrate from the top header here on
           mobile so the top chrome shrinks to logo + avatar; bottom-
           edge thumb reach owns navigation, matching Twitter /
           Instagram / Discord / Spotify mobile patterns.

           Hidden only on md+ (tablet / desktop top nav takes over).
           Original implementation also hid on landscape-phone for
           "vertical real estate" reasons; flipped to show there too
           on 2026-05-03 — top vs bottom nav are roughly the same
           height (~50px), so the trade is just relocating chrome,
           and rotating the device shouldn't move the chrome around.

           In-game routes (/game/:id, /solo, /sandbox/play) skip
           Shell entirely so this nav doesn't appear during play —
           landscape gameplay still feels fullscreen.

           Fixed-position above the home indicator: paddingBottom
           env(safe-area-inset-bottom) keeps the visible button row
           clear of the iOS gesture bar. Outer Shell container
           reserves matching room (pb-[calc(3.5rem+env(...))]) so
           footer + content don't render behind the nav.

           z-20 sits above sticky header (z-10) and below modals (z-50)
           — modal backdrops correctly cover the nav when something
           important is open. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-gray-950/95 backdrop-blur border-t border-gray-800 flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary navigation"
      >
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          // Play tab gets always-amber treatment + larger icon — it's
          // the primary action, signaled visually as such regardless
          // of which page the user is currently on. Inspired by the
          // Instagram / TikTok center-action pattern, scaled back to
          // a tab-shaped emphasis (not a floating action button)
          // because we have 5 tabs not 4 + FAB.
          const isPrimary = t.id === "multiplayer";
          return (
            <button
              key={t.id}
              onClick={() => navigate(t.path)}
              aria-current={isActive ? "page" : undefined}
              className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-colors active:scale-[0.97] ${
                isPrimary
                  ? "text-amber-400"
                  : isActive
                  ? "text-amber-400"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <Icon
                name={t.icon}
                className={isPrimary ? "w-6 h-6" : "w-5 h-5"}
              />
              <span className="text-[10px] font-bold tracking-wide">
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>
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

/** Translate a server `ReplayMeta` (Phase A endpoint shape) into the
 *  client-side `RemoteReplay` consumed by `useReplaySession`. Mirrors the
 *  helper in GameBoard.tsx but with conservative caller-slot detection.
 *
 *  We can't tell from `meta` alone whether the caller is one of the two
 *  players — `ReplayMeta` carries usernames, not player IDs. The server
 *  already echoed the appropriate `perspective` based on its own access
 *  decision; we mirror it. The toggle UI uses `isPublic` + `callerSlot`
 *  to decide affordances; missing slot = anonymous, toggle locked to the
 *  server-granted perspective. Cleaner future shape: server includes the
 *  caller's slot in the response. Punted to a Phase B follow-up. */
function metaToRemoteReplay(meta: ReplayMeta): RemoteReplay {
  return {
    replayId: meta.id,
    gameId: meta.gameId,
    states: meta.replay?.states ?? [],
    winner: meta.replay?.winner ?? null,
    turnCount: meta.turnCount,
    perspective: meta.perspective,
    isPublic: meta.public,
    callerIsPlayer: false,
    callerSlot: null,
    p1Username: meta.p1Username,
    p2Username: meta.p2Username,
  };
}

/** Player-only replay viewer keyed by gameId. Reached via /replay/:gameId.
 *  For a given `gameId` we hit `GET /game/:id/replay` (player-only auth).
 *  Public sharing uses `/replay/share/:replayId` (separate route below)
 *  which calls `GET /replay/:id` and works without auth for public replays. */
function ReplayPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [replayInput, setReplayInput] = useState<ReplayInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    getGameReplay(gameId)
      .then((meta) => {
        if (meta && meta.replay) {
          setReplayInput({ kind: "remote", data: metaToRemoteReplay(meta) });
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

  if (!replayInput) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="text-gray-500 text-sm animate-pulse">Loading replay...</span>
      </div>
    );
  }

  return (
    <GameBoard
      definitions={CARD_DEFINITIONS}
      initialReplayInput={replayInput}
      onBack={() => navigate("/multiplayer")}
    />
  );
}

/** Public-share replay viewer keyed by replayId. Reached via the canonical
 *  share URL `/replay/share/:replayId`. Hits `GET /replay/:id` which works
 *  without auth for public replays (see server/src/routes/replay.ts:47-80). */
function SharedReplayPage() {
  const { replayId } = useParams<{ replayId: string }>();
  const navigate = useNavigate();
  const [replayInput, setReplayInput] = useState<ReplayInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!replayId) return;
    getSharedReplay(replayId)
      .then((meta) => {
        if (meta && meta.replay) {
          setReplayInput({ kind: "remote", data: metaToRemoteReplay(meta) });
        } else {
          setError("Replay not found, or this replay is private. Ask the players to share it publicly.");
        }
      })
      .catch(() => setError("Failed to load replay"));
  }, [replayId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
        <div className="text-center space-y-3 max-w-md">
          <div className="text-red-400">{error}</div>
          <button className="text-amber-400 text-sm hover:underline" onClick={() => navigate("/")}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (!replayInput) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="text-gray-500 text-sm animate-pulse">Loading replay...</span>
      </div>
    );
  }

  return (
    <GameBoard
      definitions={CARD_DEFINITIONS}
      initialReplayInput={replayInput}
      onBack={() => navigate("/")}
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
      <Route path="/replays" element={<TabPage tab="replays"><ReplaysPage /></TabPage>} />
      <Route path="/me" element={<TabPage tab="me"><MePage /></TabPage>} />

      {/* Lobby join via URL — /lobby/ABC123 */}
      <Route path="/lobby/:code" element={<LobbyJoinPage />} />

      {/* Sandbox lobby — appears as a top-level tab so installed PWA can
           reach it without URL entry. The /sandbox/play game route is
           full-screen (no Shell), same pattern as /game/:id. */}
      <Route path="/sandbox" element={<TabPage tab="sandbox"><SandboxLobby /></TabPage>} />
      <Route path="/sandbox/play" element={<SandboxGamePage />} />

      {/* Dev-only routes (URL access only, no tab) */}
      <Route path="/simulate" element={<SimulationView />} />
      <Route path="/solo" element={<SoloGamePage />} />
      <Route path="/game/:gameId" element={<MultiplayerGamePage />} />
      <Route path="/replay/:gameId" element={<ReplayPage />} />
      {/* Public-share path. Canonical share URL — `share/:replayId` to
          disambiguate from the player-only gameId path above. Auth optional;
          server gates on `replays.public`. */}
      <Route path="/replay/share/:replayId" element={<SharedReplayPage />} />
      <Route path="/dev/add-card" element={<DevAddCardPage />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
