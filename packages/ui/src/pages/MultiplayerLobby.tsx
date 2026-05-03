import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { CARD_DEFINITIONS, isLegalFor, parseDecklist } from "@lorcana-sim/engine";
import type { DeckEntry, GameFormat, GameFormatFamily, RotationId } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { cancelLobby, createLobby, joinLobby, ensureProfile, getLobbyGame, getProfile, listPublicLobbies, joinMatchmaking, getMatchmakingStatus, cancelMatchmaking, subscribeMatchmakingPairFound, getGameInfo } from "../lib/serverApi.js";
import type { EloKey, Profile, PublicLobby, SpectatorPolicy, MatchmakingStatus, MatchmakingError, QueueKind } from "../lib/serverApi.js";
import { listDecks } from "../lib/deckApi.js";
import type { SavedDeck } from "../lib/deckApi.js";
import { formatDisplayName, FORMAT_FAMILY_ACCENT, getLiveRotation, listOfferedRotationsForFamily } from "../utils/deckRules.js";
import Icon from "../components/Icon.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

// localStorage keys for "last remembered" lobby selections — restored on
// mount so returning to the lobby after a match keeps the user's most
// recent format/rotation choices instead of snapping back to defaults.
const LS_MATCH_FORMAT     = "lobby-match-format";     // "bo1" | "bo3"
const LS_SELECTED_ROTATION = "lobby-selected-rotation"; // RotationId | "" (empty = no override)
const LS_PASTE_FORMAT     = "lobby-paste-format";     // JSON GameFormat
const LS_PLAY_MODE        = "lobby-play-mode";        // "quick" | "custom"

function readLS(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeLS(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch { /* quota / privacy mode */ }
}

interface Props {
  onGameStart: (gameId: string, myPlayerId: "player1" | "player2") => void;
  /** opponentDeck is undefined for mirror match (default), or the parsed
   *  entries of a saved deck the user picked as the bot's deck. */
  onPlaySolo: (
    deck: import("@lorcana-sim/engine").DeckEntry[],
    opponentDeck?: import("@lorcana-sim/engine").DeckEntry[],
  ) => void;
  /** Pre-fill the join code (from /lobby/:code URL) */
  initialJoinCode?: string;
}

export default function MultiplayerLobby({ onGameStart, onPlaySolo, initialJoinCode }: Props) {
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  // Opponent deck for solo mode. null = mirror (same deck as the user, the
  // historical default). Otherwise = id of a saved deck to feed to the bot.
  // Only meaningful when the user has saved decks beyond the one selected
  // as their own; gated below by `opponentOptions`.
  const [opponentDeckId, setOpponentDeckId] = useState<string | null>(null);
  const [deckText, setDeckText] = useState("");
  const [deckMode, setDeckMode] = useState<"saved" | "paste">("saved");
  const [deckOpen, setDeckOpen] = useState(false);
  const [format, setFormat]     = useState<"bo1" | "bo3">(() => {
    const saved = readLS(LS_MATCH_FORMAT);
    return saved === "bo1" || saved === "bo3" ? saved : "bo1";
  });
  // Paste-mode format fallback — used only when the user has pasted a
  // deck rather than selecting a saved one. Saved decks carry their own
  // format stamp; we read from that instead. Default matches the
  // pre-release transition baseline (same as schema DEFAULT / saveDeck
  // default).
  const [pasteFormat, setPasteFormat] = useState<GameFormat>(() => {
    const saved = readLS(LS_PASTE_FORMAT);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GameFormat;
        if (parsed && typeof parsed.family === "string" && typeof parsed.rotation === "string") return parsed;
      } catch { /* fall through to default */ }
    }
    return { family: "core", rotation: "s11" };
  });
  // Public lobby → appears in the browser for anyone to join. Server
  // also auto-forces spectator_policy='public' when this is true, so
  // the policy picker is hidden/locked in that case.
  const [isPublic, setIsPublic] = useState(false);
  // Spectator policy for private lobbies. Phase 1 stores it; Phase 7
  // is when the flag actually governs spectator read-access. Default
  // 'off' matches server-side DEFAULT.
  const [spectatorPolicy, setSpectatorPolicy] = useState<SpectatorPolicy>("off");
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? "");
  const [status, setStatus]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [lobbyId, setLobbyId]   = useState<string | null>(null);
  // Timestamp of when the host entered the waiting state — used to render
  // the "Waiting: MM:SS" counter. Null when not waiting. Resets on cancel
  // / on lobby match. Expressed as ms-epoch for simple subtract-then-format.
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [waitElapsedSec, setWaitElapsedSec] = useState(0);
  const [copied, setCopied]     = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  // Quick Play vs Custom Game segmented switcher. Quick Play is the
  // default surface — most users want "match me with someone now"; Custom
  // Game is the explicit "play with a friend / specific settings" path.
  // Persists across sessions: a user who almost always custom-games with
  // their playgroup shouldn't see Quick Play first every time. Stays in
  // sync via setPlayMode (writes localStorage). Persisted as plain
  // string; bad/legacy values fall through to "quick".
  const [playMode, setPlayModeState] = useState<"quick" | "custom">(() => {
    const raw = readLS(LS_PLAY_MODE);
    return raw === "custom" ? "custom" : "quick";
  });
  function setPlayMode(mode: "quick" | "custom") {
    setPlayModeState(mode);
    writeLS(LS_PLAY_MODE, mode);
  }
  const [session, setSession]   = useState<{ email: string } | null>(null);
  const [profile, setProfile]   = useState<Profile | null>(null);
  // Public lobby browser state. Closed by default so the main Host/Join
  // flow stays the primary action; users toggle it open to see what's
  // available. Auto-polls every 5s while open, stops on collapse.
  const [publicBrowserOpen, setPublicBrowserOpen] = useState(false);
  const [publicLobbies, setPublicLobbies] = useState<PublicLobby[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Matchmaking queue state. Server is authoritative — queue entry exists
  // server-side or it doesn't. The UI mirrors that with a `queueStatus`
  // object; null when not queued. `queueElapsedSec` ticks locally for the
  // timer display so we don't hammer GET /matchmaking every second.
  const [queueStatus, setQueueStatus] = useState<MatchmakingStatus | null>(null);
  const [queueElapsedSec, setQueueElapsedSec] = useState(0);
  const [queueJoinError, setQueueJoinError] = useState<MatchmakingError | null>(null);
  const queueChannelRef = useRef<(() => Promise<void>) | null>(null);

  // User's explicit rotation override. Null = use the family's live rotation
  // (default). Set when the user picks a non-default rotation from the
  // dropdown (e.g., Core-s12 test rotation pre-launch). Resets to null when
  // the deck's family changes (a new family has its own rotation lifecycle).
  const [selectedRotation, setSelectedRotation] = useState<import("@lorcana-sim/engine").RotationId | null>(() => {
    const saved = readLS(LS_SELECTED_ROTATION);
    // Empty string sentinel = "no override" (null). Anything else = a
    // RotationId we trust the dropdown will validate against the live
    // offered rotations on render — if the saved id is no longer offered,
    // the picker just doesn't highlight anything and the family default
    // takes over via `defaultRotation` below.
    return saved && saved !== "" ? (saved as import("@lorcana-sim/engine").RotationId) : null;
  });
  const publicPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Fetch profile + saved decks when signed in. Game history used to
  // load here for the Recent Games block on this page; that block was
  // dropped 2026-05-03 since /replays is the single source of truth
  // for the user's match history.
  useEffect(() => {
    if (!session) { setProfile(null); setSavedDecks([]); return; }
    getProfile().then((p) => { if (p) setProfile(p); });
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
    () => parseDecklist(deckText, CARD_DEFINITIONS),
    [deckText],
  );

  const deckReady = deck.length > 0 && deckErrors.length === 0;
  const cardCount = deck.reduce((s, e) => s + e.count, 0);

  // Solo opponent options — every saved deck EXCEPT the one currently
  // selected as the user's deck (in saved mode). In paste mode, all saved
  // decks are eligible since the user's deck is the pasted text. Hidden
  // entirely if there are no eligible opponents (signed-out or one-deck
  // accounts), in which case solo defaults to mirror.
  const opponentOptions = useMemo(
    () =>
      savedDecks.filter((d) => deckMode !== "saved" || d.id !== selectedDeckId),
    [savedDecks, deckMode, selectedDeckId],
  );

  // Resolve the opponent's parsed deck on demand. Returns undefined for
  // mirror (the historical default) or when the picked id no longer exists.
  // Format legality is intentionally NOT validated for the opponent — solo
  // play has no anti-cheat surface and creators may want to test cross-format
  // matchups (e.g. set-12 brew vs current-meta deck).
  function resolveOpponentDeck(): DeckEntry[] | undefined {
    if (!opponentDeckId) return undefined;
    const opp = savedDecks.find((d) => d.id === opponentDeckId);
    if (!opp) return undefined;
    return parseDecklist(opp.decklist_text, CARD_DEFINITIONS).entries;
  }

  // Format that this match will be created under. Saved deck → read the
  // deck's stamp; paste mode → use the local pasteFormat state. The
  // server validates legality against this before accepting the lobby;
  // a paste-mode deck that's illegal in the paste-mode format surfaces
  // as an ILLEGAL_DECK error from createLobby.
  const selectedDeck = selectedDeckId
    ? savedDecks.find((d) => d.id === selectedDeckId) ?? null
    : null;
  // Family is determined by the deck (saved deck stamp) or by paste-mode
  // user choice. Rotation is per-game — defaults to the family's live
  // ranked rotation, but the user can override via the rotation dropdown
  // (visible when a family has multiple offered rotations, e.g., during
  // a staging window pre-set-launch when both s11 live and s12 staged
  // exist). selectedRotation is the user's override; null means use
  // default. Wraps in a null-safe fallback so an unknown family never
  // crashes the lobby.
  const formatFamily = deckMode === "saved" && selectedDeck
    ? selectedDeck.format_family
    : pasteFormat.family;
  const offeredRotations = listOfferedRotationsForFamily(formatFamily);
  const defaultRotation = getLiveRotation(formatFamily)
    ?? offeredRotations.at(-1)?.rotation
    ?? "s12";
  const effectiveRotation = selectedRotation ?? defaultRotation;
  const gameFormat: GameFormat = { family: formatFamily, rotation: effectiveRotation };
  const formatAccent = FORMAT_FAMILY_ACCENT[gameFormat.family];
  // Whether the chosen rotation supports ranked play. Drives the Find
  // Ranked button visibility — hide when the user picked a non-ranked
  // rotation (e.g. Core-s12 test pre-launch).
  const chosenRotationIsRanked = offeredRotations.find((r) => r.rotation === effectiveRotation)?.ranked ?? false;
  // Reset selectedRotation when family changes — new family has its own
  // rotation lifecycle; carrying a stale rotation id from another family
  // would point at a non-existent rotation.
  useEffect(() => {
    setSelectedRotation(null);
  }, [formatFamily]);

  // Persist last-remembered lobby selections so returning to the lobby
  // after a match restores the user's most recent format/rotation choices
  // instead of snapping back to defaults. Each effect writes on change;
  // initial values were read in the corresponding useState lazy initializer.
  useEffect(() => { writeLS(LS_MATCH_FORMAT, format); }, [format]);
  useEffect(() => { writeLS(LS_SELECTED_ROTATION, selectedRotation ?? ""); }, [selectedRotation]);
  useEffect(() => { writeLS(LS_PASTE_FORMAT, JSON.stringify(pasteFormat)); }, [pasteFormat]);

  // Client-side legality pre-check — mirrors the server's isLegalFor()
  // validation in createLobby / joinLobby. Surfacing the issues inline
  // before the POST avoids a round-trip for known-bad decks and gives
  // users actionable in-place error messages instead of a generic 400.
  // The server remains authoritative (anti-cheat); this is a UX layer.
  const legality = useMemo(() => {
    if (!deckReady) return { ok: true, issues: [] as { message: string; fullName: string }[] };
    try {
      return isLegalFor(deck, CARD_DEFINITIONS, gameFormat);
    } catch (e) {
      return {
        ok: false,
        issues: [{
          definitionId: "",
          fullName: "",
          reason: "unknown_card" as const,
          message: String(e),
        }],
      };
    }
  }, [deckReady, deck, gameFormat]);

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
    setWaitStartedAt(null);
    setPublicBrowserOpen(false);
    setPublicLobbies([]);
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
        setWaitStartedAt(null);
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

  // Tick the waiting-time counter once per second. Separate from the
  // poll interval above so the display updates smoothly instead of
  // jumping every 2s. Stops when we leave the waiting state.
  useEffect(() => {
    if (waitStartedAt === null) return;
    const handle = setInterval(() => {
      setWaitElapsedSec(Math.floor((Date.now() - waitStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(handle);
  }, [waitStartedAt]);

  // Public lobby browser polling — fetch on open, refresh every 5s while
  // open, stop on close. Server excludes the caller's own lobbies so
  // this never shows "your own lobby" self-matches. Poll cadence chosen
  // to balance freshness with server load (low-user scenario benefits
  // from snappy display; can widen later).
  useEffect(() => {
    if (!session || !publicBrowserOpen) {
      if (publicPollRef.current) {
        clearInterval(publicPollRef.current);
        publicPollRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      setPublicLoading(true);
      const lobbies = await listPublicLobbies();
      if (!cancelled) {
        setPublicLobbies(lobbies);
        setPublicLoading(false);
      }
    };
    refresh();
    publicPollRef.current = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      if (publicPollRef.current) {
        clearInterval(publicPollRef.current);
        publicPollRef.current = null;
      }
    };
  }, [session, publicBrowserOpen]);

  // Hydrate queue state on mount + after sign-in. If the server has a
  // queue entry for this user (e.g., they refreshed mid-queue), pick up
  // where we left off. This is a one-shot fetch — the timer effect below
  // ticks the elapsed counter locally; the Realtime subscription handles
  // pair-found push.
  useEffect(() => {
    if (!session) {
      setQueueStatus(null);
      return;
    }
    let cancelled = false;
    void getMatchmakingStatus().then((status) => {
      if (cancelled) return;
      setQueueStatus(status);
      if (status) setQueueElapsedSec(Math.floor(status.elapsedMs / 1000));
    });
    return () => { cancelled = true; };
  }, [session]);

  // Tick the queue-elapsed counter while queued. Same pattern as
  // waitElapsedSec for the host-waiting timer.
  useEffect(() => {
    if (!queueStatus) return;
    const startMs = Date.now() - queueStatus.elapsedMs;
    const handle = setInterval(() => {
      setQueueElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(handle);
  }, [queueStatus]);

  // Realtime subscribe to pair-found broadcasts while queued. On pair, the
  // server sends { gameId, opponentId } on `matchmaking:user:<userId>` —
  // we grab the first event and navigate straight into the game. Server
  // also broadcasts via DELETE on the matchmaking_queue row (REPLICA
  // IDENTITY FULL) as a fallback signal we don't currently consume.
  useEffect(() => {
    if (!session || !queueStatus) {
      if (queueChannelRef.current) {
        queueChannelRef.current();
        queueChannelRef.current = null;
      }
      return;
    }
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      queueChannelRef.current = subscribeMatchmakingPairFound(data.user.id, ({ gameId }) => {
        // Server pairs both users into the same gameId; the side the
        // current user lands on (player1 vs player2) is determined by
        // server-side coin flip. The Realtime broadcast doesn't carry
        // myPlayerId, so we look it up via getGameInfo before navigating.
        // Skipping this lookup means BOTH clients write myPlayerId="player1"
        // to localStorage and both treat themselves as player1 in the
        // game (chooser-only modals show on both, etc.) — bug fixed
        // 2026-04-27.
        //
        // We ALSO await the matchmaking channel's removal before navigating.
        // Without that, useGameSession's `game:<gameId>` channel subscribe
        // races with this channel's in-flight cleanup and Supabase Realtime
        // rejects the new subscribe with CHANNEL_ERROR — visible to the
        // user as a red connection dot on the gameboard until refresh.
        setQueueStatus(null);
        void (async () => {
          // Tear down the matchmaking channel cleanly + wait for actual
          // removal before letting the next page subscribe to its game
          // channel.
          const cleanup = queueChannelRef.current;
          queueChannelRef.current = null;
          if (cleanup) await cleanup();

          const info = await getGameInfo(gameId);
          if (info && info.status === "active") {
            onGameStart(gameId, info.playerSide);
          } else {
            // Defensive fallback — App.tsx's own fallback fires when
            // localStorage gameId mismatches. Pass placeholder so
            // navigation proceeds; remount fetches the real side.
            onGameStart(gameId, "player1");
          }
        })();
      });
    });
    return () => {
      cancelled = true;
      if (queueChannelRef.current) {
        // Cleanup branch is fire-and-forget — useEffect cleanup is sync,
        // and component unmount isn't followed by an immediate channel
        // creation in the same paint. The await above (in the broadcast
        // handler) is the case we care about.
        void queueChannelRef.current();
        queueChannelRef.current = null;
      }
    };
  }, [session, queueStatus, onGameStart]);

  /** Join the matchmaking queue with the current deck + format selection.
   *  Handles the immediate-pair path (server pairs inline on INSERT when a
   *  peer is already waiting) by skipping straight to onGameStart. The
   *  queued path stores the queue entry in state so the queue-wait UI
   *  takes over. */
  async function handleFindMatch(queueKind: QueueKind) {
    if (!session || !deckReady) return;
    setQueueJoinError(null);
    setError(null);
    try {
      const result = await joinMatchmaking({
        deck,
        format: gameFormat,
        matchFormat: format,
        queueKind,
      });
      if (result.status === "paired") {
        // Same fix as the Realtime path — look up myPlayerId before
        // writing localStorage. Both clients can hit this branch
        // (whichever user joined second pairs immediately on INSERT;
        // the first user gets the broadcast).
        const info = await getGameInfo(result.gameId);
        const myPlayerId = info?.playerSide ?? "player1";
        onGameStart(result.gameId, myPlayerId);
        return;
      }
      // Queued — fetch full status to populate the queue-wait UI.
      const status = await getMatchmakingStatus();
      if (status) {
        setQueueStatus(status);
        setQueueElapsedSec(0);
      }
    } catch (err) {
      // MatchmakingError shape (per serverApi.ts) — surface the message;
      // include legality issues if present.
      const e = err as MatchmakingError;
      setQueueJoinError(e);
    }
  }

  async function handleCancelQueue() {
    setQueueJoinError(null);
    await cancelMatchmaking();
    setQueueStatus(null);
    setQueueElapsedSec(0);
  }

  async function handleCreateLobby() {
    if (!session || !deckReady) return;
    setError(null);
    setStatus("Creating lobby…");
    try {
      const result = await createLobby(
        deck,
        format,
        gameFormat.family,
        gameFormat.rotation,
        { public: isPublic, spectatorPolicy: isPublic ? "public" : spectatorPolicy },
      );
      setLobbyCode(result.code);
      setLobbyId(result.lobbyId);
      setWaitStartedAt(Date.now());
      setWaitElapsedSec(0);
      setStatus(null);
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  /** Host cancels their waiting lobby. Server will 409 if a guest raced
   *  in and joined first — in that case, the polling loop will pick up
   *  the active game and navigate us in. We let the poll handle that
   *  rather than fighting it here; we just clear the cancel UI and let
   *  the natural game-start path take over. */
  async function handleCancelLobby() {
    if (!lobbyId) {
      // Edge case: lobby row never made it (creation failed mid-flight).
      // Just clear the UI — nothing to cancel server-side.
      setLobbyCode(null);
      setLobbyId(null);
      setWaitStartedAt(null);
      return;
    }
    const result = await cancelLobby(lobbyId);
    if (result.ok) {
      setLobbyCode(null);
      setLobbyId(null);
      setWaitStartedAt(null);
    } else if (result.status === 409) {
      // Race with join — don't clear local state; the poll will transition
      // us into the game shortly via onGameStart.
      setStatus("Opponent joined just now — starting…");
    } else {
      // 403 / 404 / 500 — something's wrong server-side. Clear UI and
      // surface the error so the user can try fresh.
      setError(result.error);
      setLobbyCode(null);
      setLobbyId(null);
      setWaitStartedAt(null);
    }
  }

  async function handleJoinLobby() {
    if (!session || !deckReady || !joinCode.trim()) return;
    joinLobbyByCode(joinCode.trim());
  }

  /** Shared implementation — code-entry and public-browser joins both
   *  land here so both paths get identical legality/status/error
   *  handling. Caller is responsible for the deckReady gate. */
  async function joinLobbyByCode(code: string) {
    if (!session || !deckReady) return;
    setError(null);
    setStatus("Joining…");
    try {
      const result = await joinLobby(code, deck);
      setStatus("Starting game…");
      onGameStart(result.gameId, result.myPlayerId);
    } catch (err) {
      setError(String(err));
      setStatus(null);
    }
  }

  // Use the share sheet only on touch-primary devices (phones, tablets).
  // Modern desktop browsers (Chrome 93+ on Windows, Safari / Chrome on
  // macOS, Edge) ship navigator.share too, but desktop users expect a
  // copy-link affordance — the OS share dialogs there are awkward (small
  // OS-native popovers, often empty or with sparse target lists). The
  // gate is UX intent ("user wants the share sheet"), not API capability
  // ("the share API exists").
  //
  // (pointer: coarse) is the cleanest signal for touch-primary input:
  // true on phones / tablets, false on mouse / trackpad. Reactive via
  // useMediaQuery so users with dual-input devices (Surface, hybrids)
  // get the right behavior if they switch input modes mid-session.
  //
  // Original implementation gated on API capability alone, which made
  // desktop users see the share button and trigger the awkward OS
  // dialog — fixed in commit [next].
  const isTouchDevice = useMediaQuery("(pointer: coarse)");
  const SHARE_PROBE_PAYLOAD = { url: "https://example.com/", title: "probe" };
  const canNativeShare =
    isTouchDevice &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare(SHARE_PROBE_PAYLOAD));

  /** Build the full join URL the recipient will paste / click.
   *  e.g. https://app.example.com/lobby/ABC123 — pasting into a browser
   *  address bar lands them directly on this lobby with the code
   *  pre-filled (App.tsx routes /lobby/:code → MultiplayerLobby with
   *  `initialJoinCode`). Without the URL the recipient would only have
   *  the bare code "ABC123" and need to know to manually navigate. */
  function buildLobbyUrl(code: string): string {
    return `${window.location.origin}/lobby/${code}`;
  }

  /** Share the lobby join URL via the platform's preferred mechanism.
   *
   *  - **Mobile / capable devices**: opens the native share sheet via
   *    navigator.share — the user picks Messages / WhatsApp / Discord /
   *    etc. and the URL is sent through that channel. This is the right
   *    UX on a phone where copy-to-clipboard adds a step (paste into
   *    where?) and isn't the platform convention.
   *  - **Desktop**: falls back to clipboard.writeText with the FULL URL
   *    (was previously copying the bare code, which forced the
   *    recipient to know to type /lobby/ themselves). Toast "Copied!"
   *    feedback for 2s.
   *  - **Share cancelled** (user dismissed the share sheet without
   *    picking a target): silent no-op. AbortError is the standard
   *    rejection on cancel and shouldn't fall through to clipboard.
   *  - **Share errored** (anything else — browser bug, permission
   *    denied): falls through to clipboard so the user still gets the
   *    URL out.
   */
  async function handleShareLobby() {
    if (!lobbyCode) return;
    const url = buildLobbyUrl(lobbyCode);
    if (canNativeShare) {
      try {
        await navigator.share({
          title: "Join my Lorcana game",
          text: `Lobby code: ${lobbyCode}`,
          url,
        });
        // Share sheet IS the visual feedback on mobile; no toast needed.
        return;
      } catch (err) {
        // User cancelled — silent. Anything else (rare) falls through
        // to clipboard so the URL still ends up somewhere useful.
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    // Clipboard path — desktop default and mobile fallback.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can throw on insecure origins or when permissions
      // are denied. No graceful fallback that doesn't add UI noise;
      // we just don't show success feedback. The user will still see
      // the lobby code on screen and can read it manually.
    }
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
                  const parsed = parseDecklist(d.decklist_text, CARD_DEFINITIONS);
                  const count = parsed.entries.reduce((s, e) => s + e.count, 0);
                  const isValid = parsed.entries.length > 0 && parsed.errors.length === 0;
                  // Decks now carry only family — show the family chip; full
                  // format display (with rotation) is lobby-side and uses the
                  // current live rotation (resolved above).
                  const deckAccent = FORMAT_FAMILY_ACCENT[d.format_family];
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
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-200 truncate flex-1">{d.name}</span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${deckAccent.badgeBg} ${deckAccent.text}`}
                        >
                          {d.format_family === "core" ? "Core" : "Infinity"}
                        </span>
                        {isValid ? (
                          <span className="text-xs text-green-400 font-mono shrink-0">{count}</span>
                        ) : (
                          <span className="text-xs text-red-400 shrink-0">invalid</span>
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

          {/* Legality pre-check — surfaced before the user clicks Create /
               Join so they see issues in-place instead of after a round
               trip. Server re-validates on submit (anti-cheat authority);
               this is a UX shortcut, not a replacement. */}
          {deckReady && !legality.ok && (
            <div className="rounded-lg px-3 py-2 bg-red-950/40 border border-red-800/60 text-[11px] text-red-300 space-y-1">
              <div className="font-bold">
                {legality.issues.length} card{legality.issues.length === 1 ? "" : "s"} not legal in {formatDisplayName(gameFormat)}
              </div>
              <ul className="text-red-400/80 space-y-0.5">
                {legality.issues.slice(0, 3).map((issue, i) => (
                  <li key={i}>· {issue.message}</li>
                ))}
                {legality.issues.length > 3 && (
                  <li className="italic">· …and {legality.issues.length - 3} more</li>
                )}
              </ul>
              {deckMode === "saved" ? (
                <button
                  className="text-amber-400 hover:text-amber-300 underline text-[11px]"
                  onClick={() => selectedDeck && navigate(`/decks/${selectedDeck.id}`)}
                >
                  Fix in deckbuilder →
                </button>
              ) : (
                <div className="text-red-400/80">
                  Switch to Infinity format above, or paste a legal deck.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Format rotation picker — only rendered when multiple rotations
             are offered for the deck's family (e.g., during a staging
             window pre-set-launch when both s11 live and s12 staged
             coexist). Drives Find Casual + Host private lobby; Find
             Ranked is constrained to ranked rotations and hides when
             the picked rotation isn't ranked. Default is the family's
             live ranked rotation. */}
        {offeredRotations.length > 1 && (
          <div className="card p-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
              Format Rotation
            </div>
            <div className="flex flex-wrap gap-1.5">
              {offeredRotations.map((opt) => {
                const isCurrent = opt.rotation === effectiveRotation;
                return (
                  <button
                    key={opt.rotation}
                    onClick={() => setSelectedRotation(opt.rotation)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors border ${
                      isCurrent
                        ? `${formatAccent.badgeBg} ${formatAccent.text} ${formatAccent.border}`
                        : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
                    }`}
                    title={opt.ranked ? "Live rotation — ranked play available" : "Test rotation — casual only (no ELO)"}
                  >
                    {opt.displayName}
                    {!opt.ranked && (
                      <span className="ml-1.5 text-[9px] opacity-70">test</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-gray-500">
              {chosenRotationIsRanked
                ? "Ranked queue available for this rotation."
                : "Test rotation — only Casual queue and private lobby. ELO unaffected."}
            </div>
          </div>
        )}

        {/* ─ Play-mode segmented switcher ─────────────────────────────
             Quick Play and Custom Game are mutually exclusive intents
             (matchmaking-first vs explicit-host-or-join), so render at
             most one at a time. Hidden during queue / waiting (user is
             committed to a path) and when signed out (Custom Game
             requires auth — switching to it would dead-end). Persisted
             via LS_PLAY_MODE so a user's preferred mode sticks across
             sessions.
             ─────────────────────────────────────────────────────────── */}
        {session && !queueStatus && !isWaiting && (
          <div className="flex rounded-lg bg-gray-800 p-0.5">
            {(["quick", "custom"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setPlayMode(mode)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  playMode === mode
                    ? "bg-gray-700 text-gray-100 shadow-sm"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {mode === "quick" ? "Quick Play" : "Custom Game"}
              </button>
            ))}
          </div>
        )}

        {/* ─ Quick Play ────────────────────────────────────────────────
             Find Casual / Find Ranked queues + Solo vs Bot. Restructured
             2026-04-27 from a flat "Solo button + multiplayer divider +
             Host/Join cards" layout into Quick Play / Custom Game
             sections. Find Ranked is hidden when the chosen rotation
             isn't ranked (server enforces this too — defensive UI).
             Visible when:
              - signed-out (only path available; switcher hidden, no
                Custom Game alternative), OR
              - signed-in + playMode "quick" + not in queue/waiting.
             ───────────────────────────────────────────────────────────── */}
        {(!session || (playMode === "quick" && !queueStatus && !isWaiting)) && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            Quick Play
          </div>

          {/* Find Casual — primary CTA. Always visible; disabled when not
               signed in or no deck ready. */}
          <button
            className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                       disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                       transition-colors active:scale-[0.98]"
            onClick={() => handleFindMatch("casual")}
            disabled={!session || !deckReady || queueStatus !== null || isWaiting}
            title={
              !session ? "Sign in to play matchmaking"
              : queueStatus !== null ? "Already in a queue — cancel first"
              : isWaiting ? "Hosting a lobby — cancel first"
              : undefined
            }
          >
            Find Casual Match
          </button>

          {/* Find Ranked — only visible when the chosen rotation is ranked.
               If the user picked a test rotation from the dropdown above,
               this button hides (server would 400 anyway; defensive UI).
               Pre-Set-12-launch: chosen=s11 (live, ranked) → shown;
               chosen=s12 (test) → hidden. Post-launch s12 becomes ranked. */}
          {session && chosenRotationIsRanked && (
            <button
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800
                         disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                         transition-colors active:scale-[0.98]"
              onClick={() => handleFindMatch("ranked")}
              disabled={!deckReady || queueStatus !== null || isWaiting}
              title={
                queueStatus !== null ? "Already in a queue — cancel first"
                : isWaiting ? "Hosting a lobby — cancel first"
                : undefined
              }
            >
              Find Ranked Match
            </button>
          )}

          {/* Queue-join error — surfaces server rejections (illegal deck,
               rate limit, ranked-rotation-required, etc.) */}
          {queueJoinError && (
            <div className="rounded-lg px-3 py-2 bg-red-950/40 border border-red-800/60 text-[11px] text-red-300 space-y-1">
              <div className="font-bold">{queueJoinError.message}</div>
              {queueJoinError.issues && queueJoinError.issues.length > 0 && (
                <ul className="text-red-400/80 space-y-0.5">
                  {queueJoinError.issues.slice(0, 3).map((issue, i) => (
                    <li key={i}>· {issue.message ?? issue.fullName ?? "(card)"}</li>
                  ))}
                  {queueJoinError.issues.length > 3 && (
                    <li className="italic">· …and {queueJoinError.issues.length - 3} more</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {/* Play Solo — opponent picker + button. Opponent picker only
               rendered when there's at least one saved deck the bot could
               play (excluding the user's currently-selected deck in saved
               mode). Defaults to mirror, which preserves the historical
               one-click behavior for users with a single deck. */}
          <div className="space-y-1.5 pt-0.5">
            {opponentOptions.length > 0 && (
              <label className="flex items-center gap-2 text-[11px] text-gray-500">
                <span className="shrink-0">Bot plays:</span>
                <select
                  className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded-md
                             px-2 py-1 text-xs text-gray-200 focus:border-amber-500 focus:outline-none"
                  value={opponentDeckId ?? ""}
                  onChange={(e) => setOpponentDeckId(e.target.value || null)}
                >
                  <option value="">Mirror (your deck)</option>
                  {opponentOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800
                         disabled:text-gray-600 text-gray-200 rounded-lg text-xs font-bold
                         transition-colors active:scale-[0.98]"
              onClick={() => onPlaySolo(deck, resolveOpponentDeck())}
              disabled={!deckReady}
            >
              Play Solo (vs bot)
            </button>
          </div>
        </div>
        )}

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
                onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/multiplayer" } })}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Google
              </button>
              <button
                className="flex-1 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg text-sm font-medium
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
                {profile?.elo_ratings && (() => {
                  // Per-rotation ELO key — mirrors the server schema.
                  // Falls back to legacy single-column elo while old
                  // accounts haven't been backfilled to the full 8-key
                  // JSONB yet.
                  const eloKey = `${format}_${gameFormat.family}_${gameFormat.rotation}` as EloKey;
                  return (
                    <span className="text-xs font-mono text-amber-500/80" title={`${formatDisplayName(gameFormat)} · ${format.toUpperCase()}`}>
                      {profile.elo_ratings[eloKey] ?? profile.elo} ELO
                    </span>
                  );
                })()}
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

            {queueStatus ? (
              /* ─ Queue-wait screen ────────────────────────────────────────
                 Active when the user is in the matchmaking queue. Hides
                 Custom Game UI to prevent concurrent host/join attempts.
                 Realtime broadcast on `matchmaking:user:<userId>` is the
                 primary pair-found signal — see useEffect above. Server
                 also enforces concurrency invariants, so even if the user
                 manages to fire a host/join before the UI updates,
                 server-side rejections (409 QUEUED_ELSEWHERE) trip
                 first. */
              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-200">
                      Searching for {queueStatus.queueKind === "ranked" ? "Ranked" : "Casual"} match…
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {queueStatus.format.family === "core" ? "Core" : "Infinity"} {queueStatus.format.rotation} · {queueStatus.matchFormat === "bo1" ? "Bo1" : "Bo3"}
                    </div>
                  </div>
                  <div className="text-2xl font-mono text-amber-400 tabular-nums">
                    {Math.floor(queueElapsedSec / 60).toString().padStart(2, "0")}
                    :
                    {(queueElapsedSec % 60).toString().padStart(2, "0")}
                  </div>
                </div>

                {/* Ranked: show ELO band progression. Server widens the
                     band over time (±50 → ±150 → ±400 → unbounded at
                     30/60/90s). currentBand is null for casual or after
                     unbounded. */}
                {queueStatus.queueKind === "ranked" && queueStatus.eloSnapshot != null && (
                  <div className="text-[11px] text-gray-400">
                    <div>
                      Your ELO: <span className="font-mono text-gray-200">{queueStatus.eloSnapshot}</span>
                    </div>
                    <div className="mt-0.5">
                      Searching{" "}
                      {queueStatus.currentBand != null ? (
                        <>within ±<span className="font-mono text-gray-200">{queueStatus.currentBand}</span></>
                      ) : (
                        <>any ELO (search widened)</>
                      )}
                    </div>
                  </div>
                )}

                <button
                  className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold transition-colors"
                  onClick={handleCancelQueue}
                >
                  Cancel
                </button>
              </div>
            ) : isWaiting ? (
              /* ─ Waiting state ─ host has created a lobby and is waiting
                 for an opponent to join. Moved up to its own branch (was
                 the trailing `: ()` arm) when the playMode switcher
                 landed 2026-05-03; otherwise Quick-Play mode would fall
                 through to this branch when not actually waiting. */
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
                  {/* Wait-time counter. Lobby auto-times-out at 5 min
                       (MAX_POLL_ATTEMPTS * 2s); surfacing the elapsed
                       time gives the host a sense of how long the wait
                       has been and when to consider cancelling. */}
                  <div className="text-[11px] font-mono text-gray-500 mt-1 tabular-nums">
                    {Math.floor(waitElapsedSec / 60)}:{String(waitElapsedSec % 60).padStart(2, "0")}
                    <span className="text-gray-700"> / 5:00</span>
                  </div>
                </div>

                {/* Lobby code with copy button */}
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-mono font-black tracking-[0.3em] text-amber-400">
                    {lobbyCode}
                  </span>
                  <button
                    onClick={handleShareLobby}
                    // min-w-11 / min-h-11 = 44px = iOS / WCAG 2.5.5 min
                    // touch target. Was p-2 (32px) which works fine on
                    // desktop but is below the touch threshold on mobile
                    // — same surface where navigator.share matters most.
                    className="min-w-11 min-h-11 inline-flex items-center justify-center
                               rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400
                               hover:text-gray-200 transition-colors active:scale-95"
                    // Tooltip + aria-label adapt by capability so desktop
                    // users see "Copy link" while mobile sees "Share".
                    title={canNativeShare ? "Share link" : "Copy link"}
                    aria-label={canNativeShare ? "Share lobby link" : "Copy lobby link"}
                  >
                    {copied ? (
                      <Icon name="check" className="w-5 h-5 text-green-400" />
                    ) : (
                      <Icon
                        name={canNativeShare ? "share" : "clipboard"}
                        className="w-5 h-5"
                      />
                    )}
                  </button>
                </div>

                <button
                  onClick={handleCancelLobby}
                  // Was a bare-text link with no padding — a few-pixel
                  // tap target. Bumped to a min-h-11 (44px) button with
                  // hover background so it's discoverable AND tappable
                  // on touch. Visual weight stays low (gray-on-dark, no
                  // border) since this is the "cancel waiting" escape
                  // hatch, not a primary action.
                  className="px-4 min-h-11 inline-flex items-center justify-center
                             text-xs text-gray-600 hover:text-gray-400 hover:bg-gray-800/40
                             rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : playMode === "custom" ? (
              <>
              {/* ─ Custom Game ──────────────────────────────────────────────
                   Host private lobby (with public-toggle option), join by
                   code, browse public lobbies. Restructured 2026-04-27 from
                   a flat "Host/Join cards" layout into Quick Play / Custom
                   Game sections; gated on `playMode === "custom"` 2026-05-03
                   when the segmented switcher landed (mutually exclusive
                   with Quick Play above). Note: per the matchmaking ship's
                   anti-collusion rule, all private lobbies are now unranked
                   (server enforces ranked=false on insert); ranked play
                   exists only via the Find Ranked queue in Quick Play.
                   ─────────────────────────────────────────────────────────── */}
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">
                Custom Game
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Host */}
                <div className="card p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-200">Host a game</div>
                    <div className="text-xs text-gray-600 mt-0.5">Create a lobby, share the code</div>
                  </div>
                  {/* Match format (Bo1/Bo3) — separate from card-pool
                       format; this stays a lobby-level toggle. */}
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

                    {/* Card-pool format — sourced from the selected deck's
                         stamp. Read-only display because the deck declares
                         its format; pasted decks use the pasteFormat
                         (simple Core/Infinity toggle — rotation defaults
                         to s11, matching schema DEFAULT). Per-deck format
                         is edited via the deckbuilder. */}
                    {deckMode === "saved" ? (
                      <div
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs font-medium border ${formatAccent.badgeBg} ${formatAccent.text} ${formatAccent.border}`}
                        title="Format declared by the selected deck. Edit in the deckbuilder to change."
                      >
                        <span className="uppercase tracking-wider text-[10px] font-bold opacity-75">Format</span>
                        <span className="font-bold">{formatDisplayName(gameFormat)}</span>
                      </div>
                    ) : (
                      <div className="flex rounded-lg bg-gray-800 p-0.5">
                        {(["core", "infinity"] as const).map((fam) => (
                          <button
                            key={fam}
                            onClick={() => setPasteFormat({ ...pasteFormat, family: fam })}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              pasteFormat.family === fam
                                ? "bg-gray-700 text-gray-100 shadow-sm"
                                : "text-gray-500 hover:text-gray-300"
                            }`}
                          >
                            {fam === "core" ? "Core" : "Infinity"}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Public / private toggle — public lobbies appear in
                         the Public Games browser below and auto-force
                         spectator_policy='public'. Private lobbies expose
                         the 4-way policy picker (Phase 1 stores it;
                         Phase 7 activates it). */}
                    <label className="flex items-center gap-2 text-xs text-gray-300 px-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isPublic}
                        onChange={(e) => setIsPublic(e.target.checked)}
                        className="w-3.5 h-3.5 accent-amber-500"
                      />
                      <span>Public — list in browser; anyone can join</span>
                    </label>

                    {!isPublic && (
                      <div className="flex flex-col gap-1 pl-1">
                        <span className="text-[10px] uppercase tracking-wider text-gray-600 font-bold">
                          Spectators
                        </span>
                        <div className="flex rounded-lg bg-gray-800 p-0.5 text-[11px]">
                          {(["off", "friends", "invite_only", "public"] as const).map((p) => (
                            <button
                              key={p}
                              onClick={() => setSpectatorPolicy(p)}
                              className={`flex-1 py-1 font-medium rounded-md transition-colors ${
                                spectatorPolicy === p
                                  ? "bg-gray-700 text-gray-100 shadow-sm"
                                  : "text-gray-500 hover:text-gray-300"
                              }`}
                              title={
                                p === "off" ? "No spectators" :
                                p === "friends" ? "Friends only (Phase 5)" :
                                p === "invite_only" ? "Invited only" :
                                "Anyone with the code can watch"
                              }
                            >
                              {p === "invite_only" ? "Invite" : p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                               disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                               transition-colors active:scale-[0.98]"
                    onClick={handleCreateLobby}
                    disabled={!deckReady || !legality.ok || !!status}
                    title={!legality.ok ? "Fix illegal cards before creating a lobby" : undefined}
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
                    // py-3 (vs prior py-2) brings the input to ~44px tall
                    // matching the iOS / WCAG 2.5.5 touch-target minimum,
                    // consistent with all other primary inputs/buttons in
                    // this lobby after the A2 audit.
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3
                               text-sm text-gray-200 font-mono tracking-[0.3em] uppercase text-center
                               focus:border-amber-500 focus:outline-none placeholder-gray-700"
                    placeholder="XXXXXX"
                    maxLength={6}
                    // Lobby codes are alphanumeric uppercase; hint mobile
                    // keyboards to surface caps and skip auto-correct so
                    // the user doesn't fight the input on a phone.
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    aria-label="Lobby code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleJoinLobby()}
                  />
                  <button
                    className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                               disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                               transition-colors active:scale-[0.98]"
                    onClick={handleJoinLobby}
                    disabled={!deckReady || !legality.ok || joinCode.length < 6 || !!status}
                    title={!legality.ok ? "Fix illegal cards before joining" : undefined}
                  >
                    {status?.startsWith("Join") ? status : "Join"}
                  </button>
                </div>
              </div>

              {/* Public lobby browser — collapsible. Auto-polls every 5s
                   while open. Server filters out the caller's own
                   lobbies + only returns public/waiting rows. Click a
                   row to join (uses the same legality + status flow as
                   code-entry join). */}
              <div className="card p-3 space-y-2">
                <button
                  onClick={() => setPublicBrowserOpen((v) => !v)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-200">
                      Public games
                      {publicBrowserOpen && publicLobbies.length > 0 && (
                        <span className="ml-2 text-xs font-mono text-amber-500/80">{publicLobbies.length}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {publicBrowserOpen
                        ? "Pick a lobby to join — refreshes every 5s"
                        : "Browse open lobbies anyone can join"}
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-500 transition-transform ${publicBrowserOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {publicBrowserOpen && (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {publicLoading && publicLobbies.length === 0 ? (
                      <div className="text-center py-4 text-xs text-gray-600 animate-pulse">Loading…</div>
                    ) : publicLobbies.length === 0 ? (
                      <div className="text-center py-4 text-xs text-gray-600">
                        No public lobbies open right now. Be the first — toggle &quot;Public&quot; on Host above.
                      </div>
                    ) : (
                      publicLobbies.map((pl) => {
                        const plFormat: GameFormat = { family: pl.gameFormat, rotation: pl.gameRotation };
                        const plAccent = FORMAT_FAMILY_ACCENT[pl.gameFormat];
                        const ageMs = Date.now() - new Date(pl.createdAt).getTime();
                        const ageMin = Math.floor(ageMs / 60000);
                        const ageStr = ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
                        return (
                          <div
                            key={pl.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-950 border border-gray-800"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm text-gray-200 truncate">{pl.hostUsername}</span>
                                <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0 ${plAccent.badgeBg} ${plAccent.text}`}>
                                  {formatDisplayName(plFormat)}
                                </span>
                              </div>
                              <div className="text-[10px] text-gray-600 mt-0.5">
                                {pl.format.toUpperCase()} · {ageStr}
                              </div>
                            </div>
                            <button
                              className="py-1.5 px-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-md text-xs font-bold transition-colors active:scale-95"
                              onClick={() => joinLobbyByCode(pl.code)}
                              disabled={!deckReady || !legality.ok || !!status}
                              title={!legality.ok ? "Fix illegal cards before joining" : "Join this lobby"}
                            >
                              Join
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              </>
            ) : (
              /* Final fallback: signed-in, not in queue, not waiting,
                 playMode === "quick". The Quick Play section above
                 already rendered, so nothing belongs here. */
              null
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

        {/* Past games discovery link — replaces the inline Recent Games
             block (dropped 2026-05-03). The /replays tab already lists
             the caller's match history with richer formatting (W/L,
             format chip, relative timestamps, perspective toggle), so
             showing the same data again here was duplicate content.
             Inline link keeps the path discoverable for users who used
             to land on Recent Games from this page. */}
        {session && (
          <div className="text-center">
            <button
              onClick={() => navigate("/replays")}
              className="text-xs text-gray-500 hover:text-amber-400 transition-colors"
            >
              View past games →
            </button>
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
