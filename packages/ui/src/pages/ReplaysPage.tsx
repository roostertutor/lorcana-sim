// =============================================================================
// ReplaysPage — list view at "/replays". Browse the caller's MP replay
// history. Click a row to navigate to /replay/:gameId. Phase D of the
// shareable-replays plan; see docs/HANDOFF.md → "Shareable MP replays".
//
// Out of scope here: public-replay browser, profile-screen integration,
// search/filter/sort. Newest-first, single ordering.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { getMyReplays } from "../lib/serverApi.js";
import type { ReplayListItem, GameOutcomeReason } from "../lib/serverApi.js";
import { FORMAT_FAMILY_ACCENT } from "../utils/deckRules.js";
import type { GameFormatFamily } from "@lorcana-sim/engine";

/** Translate a finished game's outcome reason into a short caption + tooltip
 *  for the history list (chess-clock rollout Phase 2). Returns null for the
 *  default "normal" case (or null reason on pre-rollout rows) — the W/L badge
 *  already tells that story; we only annotate when the outcome was unusual
 *  (concede / timeout / disconnect). Caller-perspective (`won`) flips
 *  timeout's wording so winners see "on time" and losers see "timeout". */
function describeOutcomeReason(
  reason: GameOutcomeReason,
  won: boolean | null,
): { short: string; title: string; tone: string } | null {
  if (reason == null || reason === "normal") return null;
  switch (reason) {
    case "concede":
      return {
        short: won ? "by concede" : "concede",
        title: won
          ? "Opponent conceded the game."
          : "You conceded the game.",
        tone: "text-gray-500 italic",
      };
    case "timeout":
      return {
        short: won ? "on time" : "timeout",
        title: won
          ? "You won — opponent's clock ran out."
          : "You lost — your clock ran out.",
        tone: "text-amber-500/80 italic",
      };
    case "disconnect":
      return {
        short: won ? "by disconnect" : "disconnect",
        title: won
          ? "You won — opponent disconnected past the grace window."
          : "You lost — you disconnected past the grace window.",
        tone: "text-red-400/80 italic",
      };
  }
}

const PAGE_SIZE = 50;

/** Format a timestamp as a relative string ("3 minutes ago", "yesterday",
 *  "Jan 14") — matches the casual style used elsewhere in the lobby. Falls
 *  back to a localized date for anything older than a week. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  // Older than a week → calendar date. Year only when it's not the current year.
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** Pretty-print the (matchFormat, gameFormat, rotation) triple into a single
 *  short chip label. e.g. "Bo1 · Core s12". Falls back gracefully if any
 *  field is null (older replays before the columns were filled). */
function formatChipLabel(
  matchFormat: string | null,
  gameFormat: string | null,
  rotation: string | null,
): string {
  const parts: string[] = [];
  if (matchFormat) parts.push(matchFormat.toUpperCase());
  if (gameFormat) {
    const family = gameFormat === "core" ? "Core" : gameFormat === "infinity" ? "Infinity" : gameFormat;
    parts.push(rotation ? `${family} ${rotation}` : family);
  } else if (rotation) {
    parts.push(rotation);
  }
  return parts.join(" · ") || "—";
}

export default function ReplaysPage() {
  const navigate = useNavigate();

  // Auth state. `undefined` = unresolved (avoids flashing the signed-out UI).
  const [session, setSession] = useState<{ email: string } | null | undefined>(undefined);
  useEffect(() => {
    // Initial check + subscribe to changes. Mirrors DecksPage.tsx pattern.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ? { email: data.session.user.email ?? "" } : null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Replay list state.
  const [replays, setReplays] = useState<ReplayListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (nextOffset: number, append: boolean) => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getMyReplays(PAGE_SIZE, nextOffset);
      setReplays((prev) => append ? [...prev, ...data.replays] : data.replays);
      setTotal(data.total);
      setOffset(nextOffset);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  // Initial fetch when session resolves.
  useEffect(() => {
    if (session) {
      void loadPage(0, false);
    }
  }, [session, loadPage]);

  const hasMore = replays.length < total;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-black text-amber-400 tracking-tight">My Replays</h1>
        <p className="text-gray-600 text-sm mt-1">Review your multiplayer game history</p>
      </div>

      {/* Auth-gated content */}
      {session === undefined || (session && loading && replays.length === 0) ? (
        <div className="card p-6 text-center text-sm text-gray-500 animate-pulse">
          Loading…
        </div>
      ) : !session ? (
        <div className="card p-4 text-center space-y-2">
          <p className="text-sm text-gray-400">Sign in to view your replay history</p>
          <button
            onClick={() => navigate("/multiplayer")}
            className="text-amber-400 text-xs hover:underline"
          >
            Go to Multiplayer →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {error && (
            <div className="rounded-lg px-4 py-3 bg-red-950/50 border border-red-800/50 text-sm text-red-400">
              {error}
            </div>
          )}

          {replays.length === 0 ? (
            <div className="card p-6 text-center space-y-3">
              <p className="text-sm text-gray-400">No multiplayer games yet.</p>
              <button
                onClick={() => navigate("/multiplayer")}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-gray-950 text-sm font-bold rounded-lg transition-colors"
              >
                Start a multiplayer game →
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {replays.map((r) => (
                  <ReplayRow key={r.id} item={r} onClick={() => navigate(`/replay/${r.gameId}`)} />
                ))}
              </div>

              {/* "Load more" pagination — simpler than numbered pages and
                   matches the casual list-feel of the rest of the app. */}
              {hasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={() => void loadPage(offset + PAGE_SIZE, true)}
                    disabled={loading}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-gray-300 rounded-lg transition-colors"
                  >
                    {loading ? "Loading…" : `Load more (${total - replays.length} remaining)`}
                  </button>
                </div>
              )}

              {!hasMore && replays.length > PAGE_SIZE && (
                <p className="text-xs text-gray-600 text-center pt-2">End of history.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReplayRow({ item, onClick }: { item: ReplayListItem; onClick: () => void }) {
  // Caller-perspective derivations. The server stamps `callerIsP1` so we
  // don't need raw player IDs to compute "your view" winner / opponent.
  // Render the opponent's CURRENT display name (live-joined server-side
  // post-2026-05-05 Discord split) — renames flow forward into match
  // history per the locked design contract. Fall back to @handle when
  // the older replay row predates the live-join (display_name null).
  const opponentDisplay = item.callerIsP1
    ? (item.p2DisplayName ?? item.p2Username ?? "Unknown")
    : (item.p1DisplayName ?? item.p1Username ?? "Unknown");
  const opponentHandle = item.callerIsP1 ? item.p2Username : item.p1Username;
  // Show "@handle" only when it differs from the rendered display name
  // (initial profile state has them equal — no point repeating it).
  const showHandle = opponentHandle && opponentHandle !== opponentDisplay;
  const wonLabel = item.won === null ? "—" : item.won ? "W" : "L";
  const wonColor = item.won === null
    ? "text-gray-500"
    : item.won
      ? "text-green-400"
      : "text-red-400";

  // Chess-clock rollout Phase 2 — surface the outcome reason alongside W/L
  // when it's anything other than "normal". W/L is still the primary signal;
  // this is a small qualifier ("on time" / "timeout" / "disconnect" /
  // "concede") so a glance distinguishes a clean lore-win from a forfeit.
  // Tooltip on hover spells out the full sentence for accessibility.
  const outcomeAnnotation = describeOutcomeReason(item.outcomeReason, item.won);

  // Format chip — use the deckRules accent helper when gameFormat is one of
  // the recognized families, otherwise neutral grey. Older replays may have
  // null gameFormat (column added mid-implementation); the chip degrades.
  const family = (item.gameFormat === "core" || item.gameFormat === "infinity")
    ? (item.gameFormat as GameFormatFamily)
    : null;
  const accent = family ? FORMAT_FAMILY_ACCENT[family] : null;
  const chipLabel = formatChipLabel(item.format, item.gameFormat, item.gameRotation);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500/70 hover:bg-gray-800/70 transition-colors text-left"
    >
      {/* Win/loss indicator */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-black ${wonColor} bg-gray-950 border border-gray-800`}>
        {wonLabel}
      </div>

      {/* Main row content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-gray-200 truncate">
            vs {opponentDisplay}
            {showHandle && (
              <span className="ml-1 text-[10px] text-gray-500 font-mono">@{opponentHandle}</span>
            )}
          </span>
          {/* Format chip */}
          <span
            className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
              accent
                ? `${accent.badgeBg} ${accent.text} ${accent.border}`
                : "bg-gray-800 text-gray-400 border-gray-700"
            }`}
          >
            {chipLabel}
          </span>
          {/* Privacy chip — matches the GameBoard replay-banner chip but
               read-only here (toggling lives on the replay viewer itself). */}
          {item.public ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-900/40 border border-emerald-700/50 text-emerald-300">
              Public
            </span>
          ) : (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-gray-800 border border-gray-700 text-gray-500">
              Private
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
          <span>{formatRelative(item.createdAt)}</span>
          <span className="text-gray-700">·</span>
          <span>{item.turnCount} turn{item.turnCount === 1 ? "" : "s"}</span>
          {outcomeAnnotation && (
            <>
              <span className="text-gray-700">·</span>
              <span
                className={outcomeAnnotation.tone}
                title={outcomeAnnotation.title}
              >
                {outcomeAnnotation.short}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right-side affordance — replay arrow */}
      <div className="shrink-0 text-amber-500/70 text-xs">
        Review →
      </div>
    </button>
  );
}
