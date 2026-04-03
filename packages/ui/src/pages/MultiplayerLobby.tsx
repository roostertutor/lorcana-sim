import React, { useState, useMemo, useEffect, useRef } from "react";
import { LORCAST_CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { createLobby, joinLobby, ensureProfile, getLobbyGame } from "../lib/serverApi.js";

const SAMPLE_DECK = `4 Tinker Bell - Giant Fairy
2 Captain Hook - Thinking a Happy Thought
4 Ariel - Spectacular Singer
4 Simba - Protective Cub
4 Be Our Guest
4 A Whole New World
4 Beast - Hardheaded
4 Stitch - Rock Star
4 Simba - Future King
4 Captain Hook - Forceful Duelist
4 Grab Your Sword
4 Rapunzel - Gifted with Healing
2 Fire the Cannons!
4 Stitch - New Dog
4 Lantern
4 Stitch - Carefree Surfer`;

interface Props {
  onGameStart: (gameId: string, myPlayerId: "player1" | "player2", token: string) => void;
}

export default function MultiplayerLobby({ onGameStart }: Props) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [deckText, setDeckText] = useState(SAMPLE_DECK);
  const [deckOpen, setDeckOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [lobbyId, setLobbyId]   = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [session, setSession]   = useState<{ token: string; email: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore session from Supabase localStorage cache on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSession({
          token: data.session.access_token,
          email: data.session.user.email ?? "",
        });
      }
    });
  }, []);

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
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !data.session) { setError(authError?.message ?? "Login failed"); setStatus(null); return; }
      await ensureProfile(data.session.access_token);
      setSession({ token: data.session.access_token, email: data.user?.email ?? email });
      setStatus(null);
    } else {
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError || !data.session) { setError(authError?.message ?? "Sign up failed — check your email for a confirmation link"); setStatus(null); return; }
      await ensureProfile(data.session.access_token);
      setSession({ token: data.session.access_token, email: data.user?.email ?? email });
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

  // Poll lobby status after creating — transition to game when guest joins
  useEffect(() => {
    if (!lobbyId || !session) return;
    pollRef.current = setInterval(async () => {
      const data = await getLobbyGame(session.token, lobbyId);
      if (data?.lobby.status === "active" && data.game) {
        clearInterval(pollRef.current!);
        onGameStart(data.game.id, "player1", session.token);
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [lobbyId, session, onGameStart]);

  async function handleCreateLobby() {
    if (!session || !deckReady) return;
    setError(null);
    setStatus("Creating lobby…");
    try {
      const result = await createLobby(session.token, deck);
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
      const result = await joinLobby(session.token, joinCode.trim(), deck);
      setStatus("Starting game…");
      onGameStart(result.gameId, "player2", session.token);
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
          <h2 className="text-2xl font-black text-amber-400 tracking-tight">Multiplayer</h2>
          <p className="text-gray-600 text-sm mt-1">Play against a real opponent</p>
        </div>

        {/* Deck section */}
        <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-4">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setDeckOpen((v) => !v)}
          >
            <span className="text-sm font-medium text-gray-300">Your Deck</span>
            <span className="flex items-center gap-2">
              {deckReady ? (
                <span className="text-xs text-green-400 font-mono">{cardCount} cards ✓</span>
              ) : (
                <span className="text-xs text-red-400">invalid</span>
              )}
              <span className="text-gray-600 text-xs">{deckOpen ? "▲" : "▼"}</span>
            </span>
          </button>

          {deckOpen && (
            <div className="mt-3 space-y-2">
              <textarea
                className="w-full h-44 bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2
                           text-xs text-gray-200 font-mono resize-none focus:border-amber-500/60 focus:outline-none"
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
                placeholder={"4 Card Name\n4 Another Card\n..."}
                spellCheck={false}
              />
              {deckErrors.length > 0 && (
                <p className="text-red-400 text-xs">{deckErrors[0]}</p>
              )}
            </div>
          )}
        </div>

        {/* Auth */}
        {!session ? (
          <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-4 space-y-3">
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
                         focus:border-amber-500/60 focus:outline-none"
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
                         focus:border-amber-500/60 focus:outline-none"
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
          </div>
        ) : (
          /* Lobby actions */
          <div className="space-y-3">
            {/* Session bar */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-gray-600">{session.email}</span>
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
                <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-200">Host a game</div>
                    <div className="text-xs text-gray-600 mt-0.5">Create a lobby, share the code</div>
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
                <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-200">Join a game</div>
                    <div className="text-xs text-gray-600 mt-0.5">Enter the host's code</div>
                  </div>
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                               text-sm text-gray-200 font-mono tracking-[0.3em] uppercase text-center
                               focus:border-amber-500/60 focus:outline-none placeholder-gray-700"
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
              <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-6 text-center space-y-4">
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
        {error && (
          <div className="rounded-lg px-4 py-3 bg-red-950/50 border border-red-800/50 text-red-400 text-sm">
            {error}
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
