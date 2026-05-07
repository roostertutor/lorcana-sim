import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";

/** Reusable email/password + OAuth sign-in panel.
 *
 *  Extracted from MultiplayerLobby so the same UI can render on
 *  /lobby/:code (share-link arrival before sign-in) without forcing
 *  an unauthenticated friend through the full Play surface first.
 *  See LobbyJoinPage in App.tsx for the share-link entry case.
 *
 *  Auth state is observed by callers via supabase.auth.onAuthStateChange
 *  — this component fires the auth call but doesn't manage session state
 *  itself, so the parent page can react to sign-in completion (e.g.
 *  re-running a lobby join attempt once a token is available).
 *
 *  redirectTo: where to send the user after an OAuth round-trip. For
 *  the lobby-join entry path this is the current URL (so they end up
 *  back on /lobby/:code and the join flow re-runs); for the generic
 *  Play surface it's /multiplayer. Always pass an absolute URL — the
 *  Supabase JS client requires it. */
export interface AuthPanelProps {
  /** Absolute URL the OAuth provider redirects to after the round-trip.
   *  Must be on the project's allowlist in Supabase auth settings. */
  redirectTo: string;
  /** Optional heading shown above the form. Use for context like
   *  "Join lobby ABC123". Omit for no heading. */
  title?: string;
  /** Optional subtitle shown under the heading. */
  subtitle?: string;
}

export default function AuthPanel({ redirectTo, title, subtitle }: AuthPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAuth() {
    setError(null);
    setStatus(authMode === "signin" ? "Signing in…" : "Creating account…");
    if (authMode === "signin") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); setStatus(null); return; }
      // onAuthStateChange in the parent fires; status clears as the
      // page transitions out of the unauthenticated branch.
      setStatus(null);
    } else {
      const { error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) { setError(authError.message); setStatus(null); return; }
      setStatus(null);
    }
  }

  return (
    <div className="card p-4 space-y-3 w-full max-w-sm">
      {(title || subtitle) && (
        <div className="space-y-1">
          {title && <div className="text-sm font-semibold text-gray-100">{title}</div>}
          {subtitle && <div className="text-xs text-gray-400">{subtitle}</div>}
        </div>
      )}

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
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3
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
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3
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
        className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700
                   disabled:text-gray-500 text-white rounded-lg text-sm font-bold
                   transition-colors active:scale-[0.98]"
        onClick={handleAuth}
        disabled={!email || !password || !!status}
      >
        {status ?? (authMode === "signin" ? "Sign In" : "Create Account")}
      </button>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {/* OAuth divider */}
      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-gray-700" />
        <span className="text-xs text-gray-600">or</span>
        <div className="flex-1 h-px bg-gray-700" />
      </div>

      {/* OAuth buttons */}
      <div className="flex gap-2">
        <button
          className="flex-1 py-3 bg-white hover:bg-gray-100 text-gray-900 rounded-lg text-sm font-medium
                     transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google
        </button>
        <button
          className="flex-1 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg text-sm font-medium
                     transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          onClick={() => supabase.auth.signInWithOAuth({ provider: "discord", options: { redirectTo } })}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          Discord
        </button>
      </div>
    </div>
  );
}
