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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deckText, setDeckText] = useState(SAMPLE_DECK);
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [session, setSession] = useState<{ token: string; email: string } | null>(null);
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

  async function handleLogin() {
    setError(null);
    setStatus("Signing in…");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.session) {
      setError(authError?.message ?? "Login failed");
      setStatus(null);
      return;
    }
    await ensureProfile(data.session.access_token);
    setSession({ token: data.session.access_token, email: data.user?.email ?? email });
    setStatus("Signed in");
  }

  async function handleSignUp() {
    setError(null);
    setStatus("Creating account…");
    const { data, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError || !data.session) {
      setError(authError?.message ?? "Sign up failed — check your email for a confirmation link");
      setStatus(null);
      return;
    }
    await ensureProfile(data.session.access_token);
    setSession({ token: data.session.access_token, email: data.user?.email ?? email });
    setStatus("Account created and signed in");
  }

  // Poll lobby status after creating — transition to game when guest joins
  useEffect(() => {
    if (!lobbyId || !session) return;
    pollRef.current = setInterval(async () => {
      const data = await getLobbyGame(session.token, lobbyId);
      if (data?.lobby.status === "active" && data.game) {
        clearInterval(pollRef.current!)
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
      setStatus("Waiting for opponent…");
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  async function handleJoinLobby() {
    if (!session || !deckReady || !joinCode.trim()) return;
    setError(null);
    setStatus("Joining lobby…");
    try {
      const result = await joinLobby(session.token, joinCode.trim(), deck);
      setStatus("Joined! Starting game…");
      onGameStart(result.gameId, "player2", session.token);
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto mt-6 space-y-6">

      {/* Deck input — always visible */}
      <div className="space-y-2">
        <h3 className="text-gray-300 font-medium">Your Deck</h3>
        <textarea
          className="w-full h-40 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 font-mono resize-none"
          value={deckText}
          onChange={(e) => setDeckText(e.target.value)}
          placeholder="4 Card Name&#10;4 Another Card&#10;..."
          spellCheck={false}
        />
        {deckErrors.length > 0 && (
          <p className="text-red-400 text-xs">{deckErrors.join(", ")}</p>
        )}
        {deckReady && (
          <p className="text-green-400 text-xs">{deck.reduce((s, e) => s + e.count, 0)} cards loaded</p>
        )}
      </div>

      {/* Auth */}
      {!session ? (
        <div className="space-y-3">
          <h3 className="text-gray-300 font-medium">Sign In</h3>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          <div className="flex gap-2">
            <button className="tab-active flex-1" onClick={handleLogin}>Sign In</button>
            <button className="tab-inactive flex-1" onClick={handleSignUp}>Sign Up</button>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-xs">Signed in as {session.email}</p>
      )}

      {/* Lobby actions — only after sign in */}
      {session && (
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <h3 className="text-gray-300 font-medium">Host a game</h3>
            <button
              className="tab-active w-full"
              onClick={handleCreateLobby}
              disabled={!deckReady}
            >
              Create Lobby
            </button>
            {lobbyCode && (
              <div className="text-center py-3">
                <p className="text-xs text-gray-500 mb-1">Share this code</p>
                <p className="text-2xl font-mono tracking-widest text-amber-400">{lobbyCode}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-gray-300 font-medium">Join a game</h3>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono tracking-widest uppercase text-center"
              placeholder="XXXXXX"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleJoinLobby()}
            />
            <button
              className="tab-active w-full"
              onClick={handleJoinLobby}
              disabled={!deckReady || joinCode.length < 6}
            >
              Join Lobby
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {status && <p className="text-gray-400 text-sm">{status}</p>}
    </div>
  );
}
