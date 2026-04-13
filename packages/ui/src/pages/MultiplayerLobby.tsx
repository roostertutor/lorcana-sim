import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { LORCAST_CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { createLobby, joinLobby, ensureProfile, getLobbyGame, getProfile, getGameHistory } from "../lib/serverApi.js";
import type { GameHistoryEntry } from "../lib/serverApi.js";
import { listDecks } from "../lib/deckApi.js";
import type { SavedDeck } from "../lib/deckApi.js";

interface Props {
  onGameStart: (gameId: string, myPlayerId: "player1" | "player2") => void;
  onPlaySolo: (deck: import("@lorcana-sim/engine").DeckEntry[]) => void;
  /** Pre-fill the join code (from /lobby/:code URL) */
  initialJoinCode?: string;
}

export default function MultiplayerLobby({ onGameStart, onPlaySolo, initialJoinCode }: Props) {
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [deckText, setDeckText] = useState("");
  const [deckMode, setDeckMode] = useState<"saved" | "paste">("saved");
  const [deckOpen, setDeckOpen] = useState(false);
  const [format, setFormat]     = useState<"bo1" | "bo3">("bo1");
  const [gameFormat, setGameFormat] = useState<"core" | "infinity">("infinity");
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? "");
  const [status, setStatus]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [lobbyId, setLobbyId]   = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [session, setSession]   = useState<{ email: string } | null>(null);
  const [profile, setProfile]   = useState<{ username: string; elo: number; games_played: number } | null>(null);
  const [history, setHistory]   = useState<GameHistoryEntry[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for auth state changes (catches OAuth redirects + session restore)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (authSession) {
        setSession({ email: authSession.user.email ?? "" });
        ensureProfile().catch(() => {});
      } else {
        setSession(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile + game history + saved decks when signed in
  useEffect(() => {
    if (!session) { setProfile(null); setHistory([]); setSavedDecks([]); return; }
    getProfile().then((p) => { if (p) setProfile(p); });
    getGameHistory().then(setHistory);
    listDecks().then((decks) => {
      setSavedDecks(decks);
      // Auto-select first valid deck
      if (decks.length > 0 && !selectedDeckId) {
        const first = decks[0];
        setSelectedDeckId(first.id);
        setDeckText(first.decklist_text);
      }
    }).catch(() => {});
  }, [session]);

  const { entries: deck, errors: deckErrors } = useMemo(
    () => parseDecklist(deckText, LORCAST_CARD_DEFINITIONS),
    [deckText],
  );

  const deckReady = deck.length > 0 && deckErrors.length === 0;
  const cardCount = deck.reduce((s, e) => s + e.count, 0);

  async function handleAuth() {
    setError(null);
    setStatus(authMode === "signin" ? "Signing in…" : "Creating account…");
    if (authMode === "signin") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); setStatus(null); return; }
      // onAuthStateChange listener will set session + call ensureProfile
      setStatus(null);
    } else {
      const { error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) { setError(authError.message); setStatus(null); return; }
      // onAuthStateChange listener will set session + call ensureProfile
      setStatus(null);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
    setLobbyCode(null);
    setLobbyId(null);
    setStatus(null);
  }

  // Poll lobby status after creating — transition to game when guest joins.
  // Caps at 150 attempts (5 min) to avoid hammering the server indefinitely.
  useEffect(() => {
    if (!lobbyId || !session) return;
    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 150;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts >= MAX_POLL_ATTEMPTS) {
        clearInterval(pollRef.current!);
        setError("Lobby timed out waiting for a player. Please create a new lobby.");
        setStatus(null);
        setLobbyCode(null);
        setLobbyId(null);
        return;
      }
      const data = await getLobbyGame(lobbyId);
      if (data?.lobby.status === "active" && data.game) {
        clearInterval(pollRef.current!);
        onGameStart(data.game.id, data.hostSide);
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [lobbyId, session, onGameStart]);

  async function handleCreateLobby() {
    if (!session || !deckReady) return;
    setError(null);
    setStatus("Creating lobby…");
    try {
      const result = await createLobby(deck, format, gameFormat);
      setLobbyCode(result.code);
      setLobbyId(result.lobbyId);
      setStatus(null);
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  async function handleJoinLobby() {
    if (!session || !deckReady || !joinCode.trim()) return;
    setError(null);
    setStatus("Joining…");
    try {
      const result = await joinLobby(joinCode.trim(), deck);
      setStatus("Starting game…");
      onGameStart(result.gameId, result.myPlayerId);
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  function handleCopyCode() {
    if (!lobbyCode) return;
    navigator.clipboard.writeText(lobbyCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isWaiting = !!lobbyCode && !!lobbyId;

  return (
    <div className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-amber-400 tracking-tight">Multiplayer</h1>
          <p className="text-gray-600 text-sm mt-1">Play against a real opponent</p>
        </div>

        {/* Deck section */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Your Deck</span>
            <span className="flex items-center gap-2">
              {deckReady ? (
                <span className="text-xs text-green-400 font-mono">{cardCount} cards</span>
              ) : deckText ? (
                <span className="text-xs text-red-400">invalid</span>
              ) : (
                <span className="text-xs text-gray-600">none selected</span>
              )}
            </span>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-lg bg-gray-800 p-0.5">
            {(["saved", "paste"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setDeckMode(mode)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  deckMode === mode
                    ? "bg-gray-700 text-gray-100 shadow-sm"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {mode === "saved" ? "Saved Decks" : "Paste"}
              </button>
            ))}
          </div>

          {deckMode === "saved" ? (
            savedDecks.length > 0 ? (
              <div className="space-y-1.5">
                {savedDecks.map((d) => {
                  const parsed = parseDecklist(d.decklist_text, LORCAST_CARD_DEFINITIONS);
                  const count = parsed.entries.reduce((s, e) => s + e.count, 0);
                  const isValid = parsed.entries.length > 0 && parsed.errors.length === 0;
                  return (
                    <button
                      key={d.id}
                      onClick={() => { setSelectedDeckId(d.id); setDeckText(d.decklist_text); }}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        selectedDeckId === d.id
                          ? "border-amber-500 bg-amber-900/20"
                          : "border-gray-800 bg-gray-950 hover:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-200 truncate">{d.name}</span>
                        {isValid ? (
                          <span className="text-xs text-green-400 font-mono shrink-0 ml-2">{count}</span>
                        ) : (
                          <span className="text-xs text-red-400 shrink-0 ml-2">invalid</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-3 space-y-2">
                <p className="text-xs text-gray-600">No saved decks</p>
                <button
                  className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
                  onClick={() => navigate("/")}
                >
                  Go to Decks to create one
                </button>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <textarea
                className="w-full h-44 bg-gray-950 border border-gray-700 rounded-lg p-3
                           text-sm text-gray-200 font-mono resize-none focus:border-amber-500 focus:outline-none"
                value={deckText}
                onChange={(e) => { setDeckText(e.target.value); setSelectedDeckId(null); }}
                placeholder={"4 Card Name\n4 Another Card\n..."}
                spellCheck={false}
              />
              {deckErrors.length > 0 && (
                <p className="text-red-400 text-xs">{deckErrors[0]}</p>
              )}
            </div>
          )}
        </div>

        {/* Play Solo */}
        <button
          className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800
                     disabled:text-gray-600 text-gray-200 rounded-lg text-sm font-bold
                     transition-colors active:scale-[0.98]"
          onClick={() => onPlaySolo(deck)}
          disabled={!deckReady}
        >
          Play Solo (vs bot)
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-600">or play multiplayer</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* Auth */}
        {!session ? (
          <div className="card p-4 space-y-3">
            {/* Mode toggle */}
            <div className="flex rounded-lg bg-gray-800 p-0.5">
              {(["signin", "signup"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAuthMode(mode)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    authMode === mode
                      ? "bg-gray-700 text-gray-100 shadow-sm"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {mode === "signin" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>

            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5
                         text-sm text-gray-200 placeholder-gray-600
                         focus:border-amber-500 focus:outline-none"
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5
                         text-sm text-gray-200 placeholder-gray-600
                         focus:border-amber-500 focus:outline-none"
              placeholder="Password"
              type="password"
              autoComplete={authMode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <button
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700
                         disabled:text-gray-500 text-white rounded-lg text-sm font-bold
                         transition-colors active:scale-[0.98]"
              onClick={handleAuth}
              disabled={!email || !password || !!status}
            >
              {status ?? (authMode === "signin" ? "Sign In" : "Create Account")}
            </button>

            {/* OAuth divider */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-gray-700" />
              <span className="text-xs text-gray-600">or</span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>

            {/* OAuth buttons */}
            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 bg-white hover:bg-gray-100 text-gray-900 rounded-lg text-sm font-medium
                           transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
                onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/multiplayer" } })}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Google
              </button>
              <button
                className="flex-1 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg text-sm font-medium
                           transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
                onClick={() => supabase.auth.signInWithOAuth({ provider: "discord", options: { redirectTo: window.location.origin + "/multiplayer" } })}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                Discord
              </button>
            </div>
          </div>
        ) : (
          /* Lobby actions */
          <div className="space-y-3">
            {/* Session bar */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">{profile?.username ?? session.email}</span>
                {profile?.elo_ratings && (
                  <span className="text-xs font-mono text-amber-500/80">
                    {profile.elo_ratings[`${format}_${gameFormat}`] ?? profile.elo} ELO
                  </span>
                )}
                {profile && profile.games_played > 0 && (
                  <span className="text-xs text-gray-700">({profile.games_played} games)</span>
                )}
              </div>
              <button
                onClick={handleSignOut}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Sign out
              </button>
            </div>

            {!isWaiting ? (
              <div className="grid grid-cols-2 gap-3">
                {/* Host */}
                <div className="card p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-200">Host a game</div>
                    <div className="text-xs text-gray-600 mt-0.5">Create a lobby, share the code</div>
                  </div>
                  {/* Format selectors */}
                  <div className="space-y-1.5">
                    <div className="flex rounded-lg bg-gray-800 p-0.5">
                      {(["bo1", "bo3"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFormat(f)}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            format === f
                              ? "bg-gray-700 text-gray-100 shadow-sm"
                              : "text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {f === "bo1" ? "Bo1" : "Bo3"}
                        </button>
                      ))}
                    </div>
                    <div className="flex rounded-lg bg-gray-800 p-0.5">
                      {(["core", "infinity"] as const).map((gf) => (
                        <button
                          key={gf}
                          onClick={() => setGameFormat(gf)}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            gameFormat === gf
                              ? "bg-gray-700 text-gray-100 shadow-sm"
                              : "text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {gf === "core" ? "Core" : "Infinity"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                               disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                               transition-colors active:scale-[0.98]"
                    onClick={handleCreateLobby}
                    disabled={!deckReady || !!status}
                  >
                    {status === "Creating lobby…" ? "Creating…" : "Create Lobby"}
                  </button>
                </div>

                {/* Join */}
                <div className="card p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-200">Join a game</div>
                    <div className="text-xs text-gray-600 mt-0.5">Enter the host's code</div>
                  </div>
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                               text-sm text-gray-200 font-mono tracking-[0.3em] uppercase text-center
                               focus:border-amber-500 focus:outline-none placeholder-gray-700"
                    placeholder="XXXXXX"
                    maxLength={6}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleJoinLobby()}
                  />
                  <button
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                               disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                               transition-colors active:scale-[0.98]"
                    onClick={handleJoinLobby}
                    disabled={!deckReady || joinCode.length < 6 || !!status}
                  >
                    {status?.startsWith("Join") ? status : "Join"}
                  </button>
                </div>
              </div>
            ) : (
              /* Waiting state */
              <div className="card p-6 text-center space-y-4">
                {/* Animated dots */}
                <div className="flex justify-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full bg-amber-500"
                      style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </div>

                <div>
                  <div className="text-sm text-gray-400">Waiting for opponent</div>
                  <div className="text-xs text-gray-600 mt-0.5">Share this code with your opponent</div>
                </div>

                {/* Lobby code with copy button */}
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-mono font-black tracking-[0.3em] text-amber-400">
                    {lobbyCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400
                               hover:text-gray-200 transition-colors active:scale-95"
                    title="Copy code"
                  >
                    {copied ? (
                      <span className="text-green-400 text-xs font-bold">✓</span>
                    ) : (
                      <span className="text-sm">⎘</span>
                    )}
                  </button>
                </div>

                <button
                  onClick={() => { setLobbyCode(null); setLobbyId(null); }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (() => {
          // Extract game ID from "active game (UUID)" error message
          const activeGameMatch = error.match(/active game \(([^)]+)\)/);
          const activeGameId = activeGameMatch?.[1];
          return (
            <div className="rounded-lg px-4 py-3 bg-red-950/50 border border-red-800/50 text-sm space-y-2">
              <div className="text-red-400">{error}</div>
              {activeGameId && (
                <button
                  className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-colors"
                  onClick={() => navigate(`/game/${activeGameId}`)}
                >
                  Rejoin Game
                </button>
              )}
            </div>
          );
        })()}

        {/* Game History */}
        {session && history.length > 0 && (
          <div className="card p-4 space-y-2">
            <div className="text-sm font-semibold text-gray-300">Recent Games</div>
            <div className="space-y-1.5">
              {history.slice(0, 10).map((g) => (
                <div key={g.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${g.won ? "text-green-400" : "text-red-400"}`}>
                      {g.won ? "W" : "L"}
                    </span>
                    <span className="text-gray-400">vs {g.opponentName}</span>
                    <span className="text-gray-700">({g.opponentElo})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-amber-500/70 hover:text-amber-400 transition-colors"
                      onClick={() => navigate(`/replay/${g.id}`)}
                    >
                      Replay
                    </button>
                    <span className="text-gray-700">{new Date(g.date).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bounce keyframes */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
