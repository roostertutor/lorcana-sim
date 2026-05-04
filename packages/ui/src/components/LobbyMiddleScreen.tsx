// =============================================================================
// LobbyMiddleScreen — pre-game state at /game/{lobbyId}.
//
// New 2026-05-04 with the duels-style restructure. Renders the lobby
// when status is `waiting | lobby` (host alone, or both players
// picking decks). When server flips status → `active`, the parent
// route swaps to <GameBoard>.
//
// Two players are present:
// - Host (player1) — created the lobby, sees their deck slot + the
//   share affordances (URL + 6-char code).
// - Guest (player2) — joined via URL/code, sees their deck slot +
//   neither the share UI nor the cancel button (only host cancels).
//
// Per-player state in the lobby:
// - `deck` (private — server never broadcasts contents) — picked from
//   saved decks via setDeckInLobby
// - `ready` boolean — explicit confirm; both ready ⇒ game starts
//
// Polls /lobby/:id/info every 2s. Realtime upgrade is a follow-up.
// =============================================================================

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CARD_DEFINITIONS, isLegalFor, parseDecklist } from "@lorcana-sim/engine";
import type { DeckEntry, GameFormat } from "@lorcana-sim/engine";
import {
  getLobbyInfo,
  setDeckInLobby,
  setReadyInLobby,
  cancelLobby,
} from "../lib/serverApi.js";
import type { LobbyInfo } from "../lib/serverApi.js";
import { listDecks } from "../lib/deckApi.js";
import type { SavedDeck } from "../lib/deckApi.js";
import { formatDisplayName, FORMAT_FAMILY_ACCENT } from "../utils/deckRules.js";
import Icon from "./Icon.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

interface Props {
  lobbyId: string;
  myPlayerId: "player1" | "player2";
}

export default function LobbyMiddleScreen({ lobbyId, myPlayerId }: Props) {
  const navigate = useNavigate();
  const isHost = myPlayerId === "player1";

  const [info, setInfo] = useState<LobbyInfo | null>(null);
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Capability detection — same pattern as the multiplayer lobby's
  // share button (gate on touch-primary input, not just API existence).
  const isTouchDevice = useMediaQuery("(pointer: coarse)");
  const canNativeShare =
    isTouchDevice &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  // Poll lobby info every 2s. Picks up: opponent join, opponent deck
  // pick (just hasDeck flag, not contents), opponent ready toggle,
  // game-start transition. Realtime upgrade is a follow-up commit.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const next = await getLobbyInfo(lobbyId);
      if (!cancelled) setInfo(next);
    }
    refresh();
    const handle = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [lobbyId]);

  // Fetch saved decks once on mount — the deck slot is a picker over
  // these. parseDecklist runs per row to validate against the lobby's
  // format (which shows up in info.format).
  useEffect(() => {
    listDecks().then(setSavedDecks).catch(() => {});
  }, []);

  // Auto-navigate to the game when the lobby flips active.
  useEffect(() => {
    if (info?.status === "active" && info.gameId) {
      // Reuse the existing mp-game localStorage shape so MultiplayerGamePage
      // picks up where we leave off.
      localStorage.setItem("mp-game", JSON.stringify({
        gameId: info.gameId,
        myPlayerId,
      }));
      navigate(`/game/${info.gameId}`, { replace: true });
    }
  }, [info?.status, info?.gameId, myPlayerId, navigate]);

  // Format-mismatch awareness — the user's saved deck must be legal in
  // the lobby's format. Filter the picker to only decks that work.
  const lobbyFormat: GameFormat | null = info
    ? { family: info.gameFormat, rotation: info.gameRotation }
    : null;
  const eligibleDecks = useMemo(() => {
    if (!lobbyFormat) return [] as { deck: SavedDeck; entries: DeckEntry[]; ok: boolean }[];
    return savedDecks.map((d) => {
      const parsed = parseDecklist(d.decklist_text, CARD_DEFINITIONS);
      const ok = parsed.errors.length === 0
        && isLegalFor(parsed.entries, CARD_DEFINITIONS, lobbyFormat).ok
        && d.format_family === lobbyFormat.family;
      return { deck: d, entries: parsed.entries, ok };
    });
  }, [savedDecks, lobbyFormat]);

  // Caller-perspective derivations — used to gate the Ready button
  // and decide which message to render in the toggle. Opponent state
  // is read directly from info inside <PlayerSlot> below; the slot
  // labels by role (HOST/GUEST) so we don't need to flip perspective.
  const myHasDeck = isHost ? info?.hostHasDeck : info?.guestHasDeck;
  const myReady = isHost ? info?.hostReady : info?.guestReady;

  async function handlePickDeck(d: SavedDeck) {
    setError(null);
    setBusy(true);
    try {
      const parsed = parseDecklist(d.decklist_text, CARD_DEFINITIONS);
      if (parsed.errors.length > 0) {
        throw new Error("Deck failed to parse — fix in deckbuilder");
      }
      await setDeckInLobby(lobbyId, parsed.entries);
      setSelectedDeckId(d.id);
      // Refresh info so the picker reflects the new state immediately.
      // (Polling will catch up too, but visible feedback < 2s feels
      // better than the next poll tick.)
      const next = await getLobbyInfo(lobbyId);
      setInfo(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleReady() {
    if (!info) return;
    setError(null);
    setBusy(true);
    try {
      const result = await setReadyInLobby(lobbyId, !myReady);
      if (result.gameStarted && result.gameId) {
        // Server transitioned us to active in the same call. Navigate
        // immediately rather than waiting for the next poll.
        localStorage.setItem("mp-game", JSON.stringify({
          gameId: result.gameId,
          myPlayerId,
        }));
        navigate(`/game/${result.gameId}`, { replace: true });
        return;
      }
      const next = await getLobbyInfo(lobbyId);
      setInfo(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setError(null);
    setBusy(true);
    try {
      await cancelLobby(lobbyId);
      navigate("/multiplayer");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleShareLobby() {
    if (!info) return;
    const url = `${window.location.origin}/lobby/${info.code}`;
    if (canNativeShare) {
      try {
        await navigator.share({
          title: "Join my Lorcana game",
          text: `Lobby code: ${info.code}`,
          url,
        });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may fail on insecure origins; no-op */
    }
  }

  if (!info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-500 text-sm animate-pulse">
        Loading lobby…
      </div>
    );
  }

  if (info.status === "cancelled") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 px-4 space-y-3">
        <div className="text-amber-400 text-sm">This lobby was cancelled.</div>
        <button
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold"
          onClick={() => navigate("/multiplayer")}
        >
          Back to Play
        </button>
      </div>
    );
  }

  const formatAccent = FORMAT_FAMILY_ACCENT[info.gameFormat];

  return (
    <div className="min-h-screen flex flex-col items-center justify-start px-4 py-8 bg-gray-950">
      <div className="w-full max-w-md space-y-4">

        {/* Header — format prominent, lobby code/URL share affordance */}
        <div className="card p-4 space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            Lobby
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${formatAccent.badgeBg} ${formatAccent.text}`}>
              {formatDisplayName({ family: info.gameFormat, rotation: info.gameRotation })}
            </span>
            <span className="text-xs text-gray-500">·</span>
            <span className="text-xs text-gray-300">{info.format.toUpperCase()}</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <span className="text-3xl font-mono font-black tracking-[0.3em] text-amber-400">
              {info.code}
            </span>
            <button
              onClick={handleShareLobby}
              className="min-w-11 min-h-11 inline-flex items-center justify-center
                         rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400
                         hover:text-gray-200 transition-colors active:scale-95"
              title={canNativeShare ? "Share link" : "Copy link"}
              aria-label={canNativeShare ? "Share lobby link" : "Copy lobby link"}
            >
              {copied ? (
                <Icon name="check" className="w-5 h-5 text-green-400" />
              ) : (
                <Icon name={canNativeShare ? "share" : "clipboard"} className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Players + ready states. Both slots labeled by ROLE
            (HOST / GUEST) regardless of who's viewing — no mental
            flip required when comparing P1's screen vs P2's screen.
            "(you)" marker on the caller's own slot identifies which
            row is theirs without renaming the role label. */}
        <div className="card p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            Players
          </div>
          <PlayerSlot
            label="HOST"
            username={info.hostUsername ?? "(waiting…)"}
            isYou={isHost}
            hasDeck={!!info.hostHasDeck}
            ready={!!info.hostReady}
          />
          <PlayerSlot
            label="GUEST"
            username={info.guestUsername ?? null}
            isYou={!isHost}
            hasDeck={!!info.guestHasDeck}
            ready={!!info.guestReady}
          />
        </div>

        {/* Deck picker — your saved decks, filtered to lobby's format */}
        <div className="card p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            Your deck
          </div>
          {savedDecks.length === 0 ? (
            <div className="text-center py-3 space-y-2">
              <p className="text-xs text-gray-500">No saved decks yet.</p>
              <button
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold"
                onClick={() => navigate("/decks/new")}
              >
                Build a deck →
              </button>
              <p className="text-[10px] text-gray-600">
                Build a deck for this format, save, then come back to this lobby.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {eligibleDecks.map(({ deck: d, ok }) => {
                const isSelected = selectedDeckId === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => ok && handlePickDeck(d)}
                    disabled={!ok || busy}
                    title={!ok ? `Not legal in ${formatDisplayName({ family: info.gameFormat, rotation: info.gameRotation })}` : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      isSelected
                        ? "border-amber-500 bg-amber-900/20"
                        : ok
                          ? "border-gray-800 bg-gray-950 hover:border-gray-700"
                          : "border-gray-900 bg-gray-950/50 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-200 truncate flex-1">{d.name}</span>
                      {ok ? (
                        <span className="text-[10px] text-gray-500">{d.format_family}</span>
                      ) : (
                        <span className="text-[10px] text-red-400">illegal</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Ready + cancel actions */}
        <div className="space-y-2">
          <button
            className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                       disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                       transition-colors active:scale-[0.98]"
            onClick={handleToggleReady}
            disabled={busy || !myHasDeck}
            title={!myHasDeck ? "Pick a deck before readying up" : undefined}
          >
            {myReady ? "Unready" : "Ready"}
          </button>
          <button
            className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            onClick={handleCancel}
            disabled={busy}
          >
            {isHost ? "Cancel lobby" : "Leave lobby"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg px-3 py-2 bg-red-950/50 border border-red-800/50 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerSlot({
  label,
  username,
  isYou,
  hasDeck,
  ready,
}: {
  /** Role label — always "HOST" or "GUEST" regardless of who's viewing. */
  label: string;
  /** Username if known; null while the slot is empty (guest hasn't joined). */
  username: string | null;
  /** True when this slot is the calling user's own slot — shows "(you)"
   *  marker so the caller can identify themselves without renaming the
   *  role label. */
  isYou: boolean;
  hasDeck: boolean;
  ready: boolean;
}) {
  const status = !username
    ? "Waiting for opponent…"
    : ready
      ? "Ready"
      : hasDeck
        ? "Picking…"
        : "Choosing deck…";
  const statusColor = ready ? "text-green-400" : "text-gray-500";
  // Subtle highlight on the caller's own slot — distinct background so
  // it's obvious "this is me" at a glance.
  const rowBg = isYou ? "bg-gray-900 border-amber-700/50" : "bg-gray-950 border-gray-800";

  return (
    <div className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border ${rowBg}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-600 font-bold shrink-0">
          {label}
        </span>
        <span className="text-sm text-gray-200 truncate">
          {username ?? "(waiting…)"}
        </span>
        {isYou && username && (
          <span className="text-[10px] text-amber-500/80 font-medium shrink-0">(you)</span>
        )}
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${statusColor}`}>
        {status}
      </span>
    </div>
  );
}
