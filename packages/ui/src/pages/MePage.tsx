// =============================================================================
// MePage — `/me` profile / account screen.
//
// The full version of what the avatar dropdown shows in summary form.
// Houses identity (username), the per-format ELO grid (8 ratings:
// bo1/bo3 × 2 families × 2 rotations), games-played count, and a
// sign-out button.
//
// Reached via the bottom nav's `Me` tab (mobile) or the top nav's
// `Me` tab (desktop / landscape phone), and via the avatar dropdown's
// "Profile" link from anywhere.
//
// Email is intentionally NOT rendered anywhere (anti-doxxing on
// streams) — same rule that drove the UserMenu refactor 2026-05-03.
// =============================================================================

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameFormatFamily, RotationId } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { getProfile } from "../lib/serverApi.js";
import type { Profile, EloKey } from "../lib/serverApi.js";

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

  const initial = profile.username[0]?.toUpperCase() ?? "?";

  return (
    <div className="max-w-md mx-auto py-8 px-4 space-y-6">
      {/* Identity header. Both the legacy ELO summary AND the overall
          games-played subtitle were dropped here — the table below
          shows per-format ratings AND per-format game counts (server
          shipped games_played_by_format in commit e4120a6), so the
          aggregate numbers are redundant on this page. The avatar
          dropdown (App.tsx UserMenu) keeps the overall summary for a
          quick-glance number from anywhere in the app. */}
      <div className="text-center space-y-2">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber-600 text-gray-950 text-3xl font-black flex items-center justify-center shadow-lg">
          {initial}
        </div>
        <h1 className="text-2xl font-black text-amber-400 tracking-tight">{profile.username}</h1>
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
