// =============================================================================
// usePostCloseRedirect — handle the "user closed their tab during a game and
// the game has since finished" case.
//
// Lane 3 of MP UX Phase 4 (2026-05-26).
//
// On app mount, if the `mp-game` localStorage entry has a `gameId` pointing
// at a game that's now finished (e.g. opponent claimed-win after grace
// exhaustion, or the user's own clock timed out while the tab was closed),
// silently redirect to the replay viewer for that game and clear the stale
// localStorage so subsequent navigations don't keep dragging the user back
// to the dead game URL.
//
// Silent by design — the replay page chrome already conveys "game finished",
// so a modal interrupting the user's first interaction post-return would be
// noisy.
//
// Skip behaviors:
// - No `mp-game` entry, or shape lacks `gameId` (e.g. lobby-only entry from
//   the middle-screen flow) → no-op. The lobby reconnection flow handles
//   that case separately.
// - User already on `/replay/:gameId` or `/replay/share/:replayId` → no-op,
//   they've already landed on the right surface.
// - User on `/game/:gameId` matching the localStorage entry → no-op, the
//   in-game reconnection path handles fresh-load there.
// - Network/auth failure on the GET /game/:id probe → no-op. We don't want
//   to be aggressive about clearing localStorage on transient failure; the
//   normal reconnection paths will surface a real error if persistent.
// =============================================================================

import { useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { getGameInfo } from "../lib/serverApi.js"

/** localStorage key used by the rest of the multiplayer surfaces. Kept as a
 *  module-local const here so the hook is self-contained; if multiple places
 *  ever need a shared constant, hoist to a shared module then. */
const MP_GAME_KEY = "mp-game"

interface StoredMpGame {
  gameId?: string
  lobbyId?: string
  myPlayerId?: "player1" | "player2"
}

function readMpGame(): StoredMpGame | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(MP_GAME_KEY) : null
    if (!raw) return null
    return JSON.parse(raw) as StoredMpGame
  } catch {
    return null
  }
}

export function usePostCloseRedirect(): void {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const stored = readMpGame()
    if (!stored?.gameId) return // no MP game tracked, or lobby-only entry

    // If the user already landed on a route that directly references this
    // gameId (in-game reconnection, or already viewing the replay), let
    // the route's own loading logic handle it.
    const path = location.pathname
    if (path === `/game/${stored.gameId}`) return
    if (path === `/replay/${stored.gameId}`) return

    let cancelled = false
    void getGameInfo(stored.gameId)
      .then((info) => {
        if (cancelled || !info) return
        const finished = info.status === "finished" || info.state?.isGameOver === true
        if (!finished) return
        // Game is over — clear the stale localStorage entry and redirect to
        // the replay viewer. Use replace so a back-click doesn't bounce the
        // user back into the dead game URL.
        try { window.localStorage.removeItem(MP_GAME_KEY) } catch { /* quota / privacy mode */ }
        navigate(`/replay/${stored.gameId}`, { replace: true })
      })
      .catch(() => { /* transient failure — no-op, normal paths will re-surface */ })

    return () => { cancelled = true }
    // Intentionally fire once on mount. Re-running on navigate-driven location
    // changes would risk fighting the redirect we just performed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
