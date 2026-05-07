// =============================================================================
// MePage — `/me` profile / account screen.
//
// The full version of what the avatar dropdown shows in summary form.
// Houses identity (display_name + @username), an inline edit affordance
// for display_name, the per-format ELO grid (8 ratings: bo1/bo3 × 2
// families × 2 rotations), and games-played count.
//
// Reached via the bottom nav's `Me` tab (mobile) or the top nav's
// `Me` tab (desktop / landscape phone), and via the avatar dropdown's
// "Profile" link from anywhere.
//
// Identity model (Discord split, shipped 2026-05-05):
// - `display_name` — mutable, free-text, edited inline here.
// - `username` — stable handle, shown as @username under the display
//   name. No rename UI yet (deferred).
// - email — intentionally NOT rendered anywhere (anti-doxxing on
//   streams) — same rule that drove the UserMenu refactor 2026-05-03.
// =============================================================================

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameFormatFamily, RotationId } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { getProfile, updateDisplayName } from "../lib/serverApi.js";
import type { Profile, EloKey } from "../lib/serverApi.js";
import Icon from "../components/Icon.js";

const FAMILIES: GameFormatFamily[] = ["core", "infinity"];
// Rotation rows shown in the per-format ratings table. s11 was
// removed 2026-05-04 alongside the engine retirement of the s11
// rotation — there were never live games against it, so the table
// row was always going to render as "—" for everyone. When a future
// rotation lands, extend this list (e.g., ["s12", "s13"]).
const ROTATIONS: RotationId[] = ["s12"];

const FAMILY_LABEL: Record<GameFormatFamily, string> = {
  core: "Core",
  infinity: "Infinity",
};

const ROTATION_LABEL: Record<RotationId, string> = {
  s11: "Set 11",
  s12: "Set 12",
};

export default function MePage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<{ email: string } | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Auth state subscription. onAuthStateChange fires immediately with
  // the current session per Supabase docs, so we don't need a separate
  // initial-session getter.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile when session becomes valid.
  useEffect(() => {
    if (!session) { setProfile(null); return; }
    getProfile().then((p) => { if (p) setProfile(p); });
  }, [session]);

  // Loading flicker — render nothing while supabase resolves.
  if (session === undefined) {
    return null;
  }

  if (!session) {
    return (
      <div className="max-w-md mx-auto py-12 text-center space-y-4">
        <div className="text-2xl font-black text-amber-400">Profile</div>
        <div className="text-gray-500 text-sm">Sign in to view your stats.</div>
        <button
          onClick={() => navigate("/multiplayer")}
          className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  // Profile fetch in flight — render skeleton-y placeholder so the page
  // doesn't pop. Brief; usually <500ms.
  if (!profile) {
    return (
      <div className="max-w-md mx-auto py-12 text-center text-gray-500 text-sm animate-pulse">
        Loading profile…
      </div>
    );
  }

  // Avatar initial reads from display_name (the rendered identity), not the
  // stable handle. If display_name is whitespace-only at boot somehow, fall
  // back to "?".
  const initial = profile.display_name[0]?.toUpperCase() ?? "?";

  return (
    <div className="max-w-md mx-auto py-8 px-4 space-y-6">
      {/* Identity header. Both the legacy ELO summary AND the overall
          games-played subtitle were dropped here — the table below
          shows per-format ratings AND per-format game counts (server
          shipped games_played_by_format in commit e4120a6), so the
          aggregate numbers are redundant on this page. The avatar
          dropdown (App.tsx UserMenu) keeps the overall summary for a
          quick-glance number from anywhere in the app.

          Identity model (Discord split, 2026-05-05): display_name is
          the rendered label (mutable, editable inline here). @username
          is the stable handle, shown beneath. Email never rendered. */}
      <div className="text-center space-y-2">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber-600 text-gray-950 text-3xl font-black flex items-center justify-center shadow-lg">
          {initial}
        </div>
        <DisplayNameEditor profile={profile} onUpdated={setProfile} />
        <div className="text-xs text-gray-500 font-mono">@{profile.username}</div>
      </div>

      {/* ELO breakdown — per family, with bo1 / bo3 columns × rotation
          rows. 8 ratings total (2 families × 2 rotations × 2 match
          formats). Each cell shows the rating + per-format games
          count (server: games_played_by_format, shipped e4120a6).
          The count is what makes the rating meaningful — 1500 with
          0 games means "default ELO, never played" (rendered as "—");
          1500 with 12 games means "actually played and finished here". */}
      <div className="card p-4 space-y-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
          Ratings by format
        </div>

        {FAMILIES.map((family) => (
          <div key={family} className="space-y-1.5">
            <div className="text-sm font-semibold text-gray-300">
              {FAMILY_LABEL[family]}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 font-bold border-b border-gray-800">
                  <th className="text-left pb-1.5 font-bold">Rotation</th>
                  <th className="text-right pb-1.5 font-bold">Bo1</th>
                  <th className="text-right pb-1.5 font-bold">Bo3</th>
                </tr>
              </thead>
              <tbody>
                {ROTATIONS.map((rotation) => {
                  const bo1Key = `bo1_${family}_${rotation}` as EloKey;
                  const bo3Key = `bo3_${family}_${rotation}` as EloKey;
                  // games_played_by_format is server-seeded with all 8
                  // keys at 0, so the value is always a number. Missing
                  // keys (older client racing newer server) read as 0
                  // via nullish-coalesce.
                  const gamesBo1 = profile.games_played_by_format?.[bo1Key] ?? 0;
                  const gamesBo3 = profile.games_played_by_format?.[bo3Key] ?? 0;
                  // "Unrated" = 0 games played. Render — rather than
                  // the default 1500 because seeing "1500" for every
                  // unplayed format misrepresents activity.
                  const eloBo1 = gamesBo1 > 0 ? profile.elo_ratings?.[bo1Key] : null;
                  const eloBo3 = gamesBo3 > 0 ? profile.elo_ratings?.[bo3Key] : null;
                  return (
                    <tr key={rotation} className="border-b border-gray-800/50 last:border-0">
                      <td className="py-1.5 text-gray-400">{ROTATION_LABEL[rotation]}</td>
                      <RatingCell elo={eloBo1} games={gamesBo1} />
                      <RatingCell elo={eloBo3} games={gamesBo3} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Sign-out button removed 2026-05-03. The UserMenu avatar
          dropdown is always visible (top-right on desktop, included
          in the Me-tab navigation on mobile), so a duplicate button
          here was redundant chrome. */}
    </div>
  );
}

/** Inline editor for the mutable `display_name` field. Idle mode shows
 *  the name + a pencil affordance; click flips to an input with save /
 *  cancel. Validation mirrors the server (1-32 chars after trim, no
 *  all-whitespace) so the user gets immediate feedback before the round-
 *  trip. On success, hands the updated profile back to the parent so
 *  every consumer of `profile` repaints with the new value. */
function DisplayNameEditor({
  profile,
  onUpdated,
}: {
  profile: Profile;
  onUpdated: (next: Profile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Pop into edit mode → focus + select-all so the user can either type
  // over the existing value or tweak it without an extra click.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const beginEdit = () => {
    setDraft(profile.display_name);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > 32) {
      setError("Display name must be 1-32 characters");
      return;
    }
    if (trimmed === profile.display_name) {
      // No-op — nothing to save.
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    const updated = await updateDisplayName(trimmed);
    setBusy(false);
    if (!updated) {
      setError("Couldn't save — try again in a moment");
      return;
    }
    onUpdated(updated);
    setEditing(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };

  if (!editing) {
    return (
      <button
        onClick={beginEdit}
        className="group inline-flex items-center gap-2 mx-auto hover:bg-gray-900/60 rounded-md px-2 py-1 transition-colors"
        title="Edit display name"
        aria-label="Edit display name"
      >
        <h1 className="text-2xl font-black text-amber-400 tracking-tight">
          {profile.display_name}
        </h1>
        <Icon
          name="pencil-square"
          className="w-4 h-4 text-gray-600 group-hover:text-gray-300 transition-colors"
        />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={32}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={handleKey}
          disabled={busy}
          className="px-2 py-1 bg-gray-900 border border-amber-700 rounded-md text-2xl font-black text-amber-400 tracking-tight text-center w-64 max-w-full focus:outline-none focus:border-amber-500"
          aria-label="Display name"
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-600 text-gray-950 rounded-md font-bold transition-colors"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="px-3 py-1 text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="text-[11px] text-red-400">{error}</div>
      )}
    </div>
  );
}

/** Single cell in the Ratings By Format table — renders rating + game
 *  count stacked. Unrated formats (0 games) render as a dim "—" with
 *  no game count line. Rated formats show the rating in amber and the
 *  count below as smaller dim text. */
function RatingCell({ elo, games }: { elo: number | null | undefined; games: number }) {
  if (elo == null) {
    return (
      <td className="py-1.5 text-right font-mono text-gray-700">
        —
      </td>
    );
  }
  return (
    <td className="py-1.5 text-right font-mono">
      <div className="text-amber-500/80">{elo}</div>
      <div className="text-[9px] text-gray-600 font-normal">
        {games} {games === 1 ? "game" : "games"}
      </div>
    </td>
  );
}
