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
const ROTATIONS: RotationId[] = ["s11", "s12"];

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    // Land on Decks after sign-out — neutral home that doesn't require
    // auth (vs /multiplayer which would just bounce to its sign-in card).
    navigate("/");
  }

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
      {/* Identity header. ELO summary line dropped 2026-05-03 —
          profile.elo is the legacy single-rotation field, not an
          actual aggregate of the 8-rating matrix below; surfacing it
          as "summary" alongside the full breakdown was redundant and
          mildly misleading (the number doesn't summarize anything,
          it's just the pre-migration column). The avatar dropdown
          (App.tsx UserMenu) still uses profile.elo for a quick-glance
          number — that's the right place for it because the dropdown
          is a summary surface, not a full-detail view. */}
      <div className="text-center space-y-2">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber-600 text-gray-950 text-3xl font-black flex items-center justify-center shadow-lg">
          {initial}
        </div>
        <h1 className="text-2xl font-black text-amber-400 tracking-tight">{profile.username}</h1>
        {profile.games_played > 0 && (
          <div className="text-xs text-gray-500">
            {profile.games_played} {profile.games_played === 1 ? "game" : "games"} played
          </div>
        )}
      </div>

      {/* ELO breakdown — per family, with bo1 / bo3 columns × rotation
          rows. 8 ratings total (2 families × 2 rotations × 2 match
          formats). Missing keys (account not yet backfilled) render
          as "—" rather than 0 so the user can tell unrated apart from
          rated-and-1500. */}
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
                  const eloBo1 = profile.elo_ratings?.[bo1Key];
                  const eloBo3 = profile.elo_ratings?.[bo3Key];
                  return (
                    <tr key={rotation} className="border-b border-gray-800/50 last:border-0">
                      <td className="py-1.5 text-gray-400">{ROTATION_LABEL[rotation]}</td>
                      <td className={`py-1.5 text-right font-mono ${eloBo1 != null ? "text-amber-500/80" : "text-gray-700"}`}>
                        {eloBo1 ?? "—"}
                      </td>
                      <td className={`py-1.5 text-right font-mono ${eloBo3 != null ? "text-amber-500/80" : "text-gray-700"}`}>
                        {eloBo3 ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Sign out — duplicate of UserMenu's sign-out so users on a real
          phone don't have to navigate to find it. The avatar dropdown
          stays as a quick-access escape hatch from anywhere in the app
          (decided 2026-05-03). */}
      <div className="text-center">
        <button
          onClick={handleSignOut}
          className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-gray-100 rounded-lg text-sm font-medium transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
