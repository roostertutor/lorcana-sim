import React, { useState } from "react";
import type { DeckEntry } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { createLobby, joinLobby } from "../lib/serverApi.js";

interface Props {
  deck: DeckEntry[] | null;
  onGameStart: (gameId: string, myPlayerId: "player1" | "player2", token: string) => void;
}

export default function MultiplayerLobby({ deck, onGameStart }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [session, setSession] = useState<{ token: string; email: string } | null>(null);

  async function handleLogin() {
    setError(null);
    setStatus("Signing in…");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.session) {
      setError(authError?.message ?? "Login failed");
      setStatus(null);
      return;
    }
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
    setSession({ token: data.session.access_token, email: data.user?.email ?? email });
    setStatus("Account created and signed in");
  }

  async function handleCreateLobby() {
    if (!session || !deck) return;
    setError(null);
    setStatus("Creating lobby…");
    try {
      const result = await createLobby(session.token, deck);
      setLobbyCode(result.code);
      setStatus(`Lobby created — share code: ${result.code}`);
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  async function handleJoinLobby() {
    if (!session || !deck || !joinCode.trim()) return;
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

  if (!session) {
    return (
      <div className="max-w-sm mx-auto mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-gray-200">Multiplayer — Sign In</h2>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2">
          <button className="tab-active flex-1" onClick={handleLogin}>Sign In</button>
          <button className="tab-inactive flex-1" onClick={handleSignUp}>Sign Up</button>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {status && <p className="text-gray-400 text-sm">{status}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-8 space-y-6">
      <p className="text-gray-400 text-sm">Signed in as {session.email}</p>

      {!deck && (
        <p className="text-amber-400 text-sm">Load a deck first (Deck Input tab).</p>
      )}

      <div className="space-y-2">
        <h3 className="text-gray-300 font-medium">Host a game</h3>
        <button
          className="tab-active w-full"
          onClick={handleCreateLobby}
          disabled={!deck}
        >
          Create Lobby
        </button>
        {lobbyCode && (
          <p className="text-center text-xl font-mono tracking-widest text-amber-400 py-2">
            {lobbyCode}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-gray-300 font-medium">Join a game</h3>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono tracking-widest uppercase"
          placeholder="Enter 6-char code"
          maxLength={6}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button
          className="tab-active w-full"
          onClick={handleJoinLobby}
          disabled={!deck || joinCode.length < 6}
        >
          Join Lobby
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {status && <p className="text-gray-400 text-sm">{status}</p>}
    </div>
  );
}
