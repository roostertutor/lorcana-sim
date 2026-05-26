import type { GameAction, GameState, DeckEntry, PlayerID, RotationId, GameFormatFamily } from "@lorcana-sim/engine"
import { supabase } from "./supabase.js"

const SERVER_URL = (import.meta.env["VITE_SERVER_URL"] as string | undefined) ?? "http://localhost:3001"

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string }
    return data.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/** Read the current access token from Supabase — auto-refreshes if expired. */
async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error("Not authenticated")
  return data.session.access_token
}

async function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getToken()}`,
  }
}

export async function getLobbyGame(lobbyId: string) {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { lobby: { status: string }; game: { id: string } | null; hostSide: "player1" | "player2" }
  return data
}

export async function ensureProfile() {
  const res = await fetch(`${SERVER_URL}/auth/me`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error("Failed to initialize profile")
}

/** Spectator-access policy on a lobby. Phase 7 (spectator mode) is the
 *  feature that consumes this; Phase 1 just stores it. Public lobbies
 *  auto-force 'public' server-side, private lobbies expose the full
 *  4-way policy picker. */
export type SpectatorPolicy = "off" | "invite_only" | "friends" | "public"

export interface CreateLobbyOptions {
  /** When true, lobby appears in the public-lobby browser for anyone to
   *  join. Server also forces spectatorPolicy to 'public' in this case. */
  public?: boolean
  /** Phase 1 plumbing — stored for Phase 7 to consume. Defaults to 'off'
   *  on server. Ignored when `public: true` (server uses 'public'). */
  spectatorPolicy?: SpectatorPolicy
}

/** Create a new lobby with format settings only — deck attaches in the
 *  middle screen (post-create) via setDeckInLobby. Server-spec change
 *  2026-05-04: deck arg dropped from this endpoint along with the
 *  `public` flag (public-lobby browser feature retired). Returns the
 *  lobby UUID + 6-char voice/typing code. UI navigates to
 *  /game/{lobbyId} after this resolves. */
export async function createLobby(
  format: "bo1" | "bo3" = "bo1",
  gameFormat: GameFormatFamily = "infinity",
  gameRotation: RotationId = "s12",
  options: CreateLobbyOptions = {},
) {
  const res = await fetch(`${SERVER_URL}/lobby/create`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      format,
      gameFormat,
      gameRotation,
      spectatorPolicy: options.spectatorPolicy ?? "off",
    }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{
    lobbyId: string
    code: string
    format: string
    gameFormat: string
    gameRotation: string
    spectatorPolicy: SpectatorPolicy
  }>
}

/** Privacy-safe lobby snapshot — never includes deck contents. Used by
 *  LobbyMiddleScreen to render lobby state + transition to game when
 *  status flips to 'active'. Server wraps in `{ lobby: LobbyInfo }`;
 *  getLobbyInfo unwraps. */
export interface LobbyInfo {
  lobbyId: string
  code: string
  /** Phase 4 (2026-05-26): server adds `'abandoned'` to the union — lazy
   *  detection flips a waiting/lobby row stale > 60s (heartbeat threshold)
   *  to abandoned on the next read. UI treats it as a terminal state and
   *  surfaces an explanation + back-to-multiplayer affordance. */
  status: "waiting" | "lobby" | "active" | "cancelled" | "abandoned"
  format: "bo1" | "bo3"
  gameFormat: GameFormatFamily
  gameRotation: RotationId
  hostId: string
  hostUsername: string | null
  /** Live-current host display_name from the server's join with `profiles`.
   *  UI renders this primarily with `@hostUsername` as the secondary tag.
   *  Discord-style split, see docs/HANDOFF.md → "username / display_name
   *  split". */
  hostDisplayName: string | null
  guestId: string | null
  guestUsername: string | null
  /** Live-current guest display_name. Same semantics as hostDisplayName. */
  guestDisplayName: string | null
  hostHasDeck: boolean
  guestHasDeck: boolean
  hostReady: boolean
  guestReady: boolean
  /** Set when status === 'active' — id of the spawned games row. UI
   *  navigates from /play/{lobbyId} → /game/{gameId} board view on
   *  this transition. */
  gameId: string | null
}

/** GET /lobby/:id/info — peek at a lobby without joining. RLS allows
 *  read by anyone in the lobby (host or guest). NEVER returns deck
 *  contents. Server wraps the response in `{ lobby: LobbyInfo }`; we
 *  unwrap on the client. */
export async function getLobbyInfo(lobbyId: string): Promise<LobbyInfo | null> {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}/info`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { lobby: LobbyInfo }
  return data.lobby
}

/** POST /lobby/:id/deck — attach (or swap) your deck to your slot.
 *  Validates legality against the lobby's stored format. Implicitly
 *  clears your ready flag so a deck swap forces an explicit re-ready. */
export async function setDeckInLobby(lobbyId: string, deck: DeckEntry[]) {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}/deck`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ deck }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ ok: true }>
}

/** POST /lobby/:id/ready — toggle your ready flag. Server rejects
 *  ready=true if no deck attached. When BOTH ready, the same call
 *  atomically transitions lobby → active and spawns the games row;
 *  the response includes gameStarted=true and the new gameId. */
export async function setReadyInLobby(lobbyId: string, ready: boolean) {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}/ready`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ ready }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{
    ok: true
    gameStarted: boolean
    gameId: string | null
  }>
}

/** PATCH /lobby/:id/heartbeat — presence ping while sitting in a lobby
 *  (waiting for an opponent, or both picking decks). Server uses the
 *  freshness of `last_heartbeat_at` for lazy abandoned-lobby detection:
 *  any read path flips a stale > 60s waiting/lobby row to
 *  `status='abandoned'` on the next read. Caller should fire every ~30s
 *  while the lobby is in `waiting` or `lobby` status — gives 2 missed
 *  heartbeats of slack relative to the server's 60s threshold.
 *
 *  Idempotent. Errors swallowed by the caller — the next interval tick
 *  re-syncs and the abandoned-lobby surfacing handles the terminal
 *  state on the next /info read. Returns {ok: true} on success,
 *  null on transport / auth / member-check failure. */
export async function heartbeatLobby(lobbyId: string): Promise<{ ok: true } | null> {
  try {
    const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}/heartbeat`, {
      method: "PATCH",
      headers: await authHeaders(),
    })
    if (!res.ok) return null
    return { ok: true }
  } catch {
    return null
  }
}

/** GET /lobby/resolve/:code — 6-char voice/typing share lookup.
 *  Returns the lobby UUID so the UI can navigate to /game/{lobbyId}.
 *  Used by the manual code-input form on /multiplayer + the
 *  /lobby/:code redirect on URL arrival. */
export async function resolveLobbyCode(code: string): Promise<{ lobbyId: string }> {
  const res = await fetch(`${SERVER_URL}/lobby/resolve/${encodeURIComponent(code)}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string }>
}

/** Host-only cancel of a waiting lobby. Returns ok=true on success;
 *  otherwise { error, status } with 404 / 403 / 409. A 409 typically
 *  means someone already joined — UI should redirect into the game
 *  rather than surface the error. */
export async function cancelLobby(
  lobbyId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${SERVER_URL}/lobby/${lobbyId}/cancel`, {
    method: "POST",
    headers: await authHeaders(),
  })
  if (res.ok) return { ok: true }
  const error = await extractError(res)
  return { ok: false, error, status: res.status }
}

/** Errors the rematch endpoint surfaces — see server/src/routes/lobby.ts.
 *  Idempotent on the server side: two players clicking simultaneously
 *  converge on the same new lobby + gameId. The 409 ACTIVE_GAME case is
 *  the only one a user can self-resolve (close the other game/queue). */
export interface RematchError {
  status: number
  message: string
}

/** POST /lobby/rematch — create (or join) a rematch lobby for a finished
 *  match. Server spawns the first game synchronously and returns its id, so
 *  the client navigates straight to /game/${gameId} without a separate
 *  Realtime accept step. Caller responsibility: surface error.message and
 *  re-enable the button on rejection. */
export async function postRematch(previousLobbyId: string): Promise<{
  lobbyId: string
  gameId: string
  code: string
  myPlayerId: "player1" | "player2"
}> {
  const res = await fetch(`${SERVER_URL}/lobby/rematch`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ previousLobbyId }),
  })
  if (!res.ok) {
    const message = await extractError(res)
    const err: RematchError = { status: res.status, message }
    throw err
  }
  return await res.json() as {
    lobbyId: string
    gameId: string
    code: string
    myPlayerId: "player1" | "player2"
  }
}

/** POST /lobby/join — claim the GUEST slot (always player2 — host
 *  is player1 by definition). Server-spec change 2026-05-04: deck
 *  arg dropped (deck attaches separately in middle screen via
 *  setDeckInLobby); status flips to 'lobby' (not 'active'); does
 *  NOT spawn a games row. Server returns just `{ lobbyId }` — slot
 *  is implicit (joiner = player2). */
export async function joinLobby(code: string) {
  const res = await fetch(`${SERVER_URL}/lobby/join`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ lobbyId: string }>
}

/** Server-projected live clock snapshot included on `GET /game/:id` responses.
 *  Pre-projected for display: the decision player's bank reflects elapsed
 *  thinking time since the last action; the inactive player's bank is frozen.
 *  When either player is disconnected, BOTH banks are frozen and the
 *  disconnected player's grace ticks instead.
 *
 *  Null on legacy rows that pre-date the chess-clock rollout — UI fails soft
 *  by rendering no clock surfaces. */
export interface ClockSnapshot {
  p1TimeRemainingMs: number
  p2TimeRemainingMs: number
  p1GraceRemainingMs: number
  p2GraceRemainingMs: number
  p1Disconnected: boolean
  p2Disconnected: boolean
  matchFormat: "bo1" | "bo3"
}

/** Outcome-reason discriminator from `games.outcome_reason`.
 *  - "normal"     — lore threshold reached (or deckout, the canonical engine win).
 *  - "concede"    — player resigned via the kebab/Concede.
 *  - "timeout"    — decision player's clock bank exhausted.
 *  - "disconnect" — disconnected player's grace budget exhausted.
 *  Older finished games (pre-rollout) may carry null. */
export type GameOutcomeReason = "normal" | "concede" | "timeout" | "disconnect" | null

export async function getGame(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json() as { game: { state: GameState; status?: string }; playerSide?: "player1" | "player2" }
  return data.game.state
}

/** Variant of `getGame` that returns the full game payload including the
 *  server-projected clock and outcome_reason. Used by `useGameSession` so the
 *  clock store stays in lock-step with the filtered state install.
 *
 *  `gameNumber` (1, 2, or 3) is sourced from the games row's `game_number`
 *  column. Bo1 games are always 1; Bo3 games 2 and 3 are created by the
 *  server when the previous game finishes (see `gameService.ts ~1075`). Used
 *  by the first-player banner to render the "Game 2 of 3 · 1-0" prefix. */
export async function getGameWithClock(gameId: string): Promise<{
  state: GameState
  clock: ClockSnapshot | null
  outcomeReason: GameOutcomeReason
  status?: string
  gameNumber: number
}> {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json() as {
    game: { state: GameState; status?: string; outcome_reason?: GameOutcomeReason; game_number?: number }
    clock: ClockSnapshot | null
  }
  return {
    state: data.game.state,
    clock: data.clock,
    outcomeReason: data.game.outcome_reason ?? null,
    gameNumber: data.game.game_number ?? 1,
    ...(data.game.status !== undefined ? { status: data.game.status } : {}),
  }
}

/** Heartbeat ping — call every ~10s while the game tab is visible to keep
 *  the server's disconnect-grace timer fresh. Returns the up-to-date clock
 *  (without `matchFormat`, which is established at game creation and doesn't
 *  change). Throws on transport error; the caller should swallow and retry
 *  on the next interval rather than failing user-visibly. */
export async function postHeartbeat(gameId: string): Promise<Omit<ClockSnapshot, "matchFormat">> {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/heartbeat`, {
    method: "POST",
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json() as {
    ok: true
    clock: Omit<ClockSnapshot, "matchFormat">
  }
  return data.clock
}

export async function getGameInfo(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  // Server spreads the full games row into `data.game`, so DB column names
  // come through as snake_case. lobby_id is null for queue-spawned games
  // (no parent lobby — see gameService.ts ~line 588).
  const data = await res.json() as {
    game: { state: GameState; status?: string; lobby_id?: string | null }
    playerSide: "player1" | "player2"
  }
  return {
    state: data.game.state,
    playerSide: data.playerSide,
    status: data.game.status,
    lobbyId: data.game.lobby_id ?? null,
  }
}

export async function sendAction(gameId: string, action: GameAction) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/action`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<{ success: boolean; newState: GameState; nextGameId?: string }>
}

export async function resignGame(gameId: string) {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/resign`, {
    method: "POST",
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
}

/** POST /game/:id/claim-win — MP UX Phase 4 (2026-05-26). Award the win to
 *  the caller when their opponent's chess-clock grace window has exhausted.
 *  Server enforces the precondition (caller is a player, game in_progress,
 *  opponent grace exhausted) so the client stays optimistic — no need to
 *  re-check the disconnect threshold here.
 *
 *  Idempotent: a second call against an already-finished game returns
 *  `{ ok: true }` with `eloDelta: null` (the ELO update fired on the first
 *  call). Mirrors the `cancelLobby` discriminated-union shape so callers
 *  can pattern-match on `result.ok` rather than try/catch. */
export async function claimWin(
  gameId: string,
): Promise<
  | { ok: true; winnerId: PlayerID; eloDelta: number | null }
  | { ok: false; error: string; status: number }
> {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/claim-win`, {
    method: "POST",
    headers: await authHeaders(),
  })
  if (res.ok) {
    const data = await res.json() as { ok: true; winnerId: PlayerID; eloDelta: number | null }
    return { ok: true, winnerId: data.winnerId, eloDelta: data.eloDelta }
  }
  const error = await extractError(res)
  return { ok: false, error, status: res.status }
}

/** Per-rotation ELO key — matches the server schema's JSONB shape.
 *  One bucket per (match-format × card-pool × rotation). Mirrors the engine's
 *  registry (CORE_ROTATIONS / INFINITY_ROTATIONS) — when a new rotation lands,
 *  add it to RotationId in the engine and the key union grows automatically. */
export type EloKey = `${"bo1" | "bo3"}_${GameFormatFamily}_${RotationId}`
export type EloRatings = Record<EloKey, number>

export interface Profile {
  /** Stable handle. Unique, immutable for now (rename is a future feature).
   *  Used in URLs / friend lookups / replay denormalization / anywhere
   *  identity stability matters. */
  username: string
  /** Mutable free-text label rendered in chrome / opponent tiles / chat.
   *  NOT unique by design (Discord model). Length 1-32, server-validated.
   *  Seeded equal to `username` on profile creation; user can edit anytime
   *  via PATCH /auth/profile/display-name. */
  display_name: string
  elo: number
  elo_ratings: EloRatings
  /** Overall games-played counter across all formats. Kept as the single
   *  activity number for the avatar dropdown; for per-format counts that
   *  pair with the ratings table, use `games_played_by_format`. */
  games_played: number
  /** Per-format games-played counter, mirroring the EloRatings shape. Each
   *  bucket increments by 1 per finished game (both ranked and unranked)
   *  in the matching {match × family × rotation} key. Server seeds the
   *  full 8-key shape with zeros so the field is always defined post-
   *  migration; missing keys read as 0 if older clients race a new key. */
  games_played_by_format: Record<EloKey, number>
}

export async function getProfile(): Promise<Profile | null> {
  const res = await fetch(`${SERVER_URL}/auth/me`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { profile: Profile }
  return data.profile
}

/** Update the caller's mutable `display_name` (Discord-style split — separate
 *  from the stable `username` handle, which has no rename UI yet). Server
 *  validates 1-32 chars after trim and rejects all-whitespace input.
 *  Returns the updated profile row on success, or `null` if the request
 *  failed (the UI surfaces a generic error toast in that case). */
export async function updateDisplayName(displayName: string): Promise<Profile | null> {
  const res = await fetch(`${SERVER_URL}/auth/profile/display-name`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify({ display_name: displayName }),
  })
  if (!res.ok) return null
  const data = await res.json() as { profile: Profile }
  return data.profile
}

export interface GameHistoryEntry {
  id: string
  opponentName: string
  opponentElo: number
  won: boolean
  date: string
}

export async function getGameHistory(page = 0, limit = 20): Promise<GameHistoryEntry[]> {
  const res = await fetch(`${SERVER_URL}/game/history?page=${page}&limit=${limit}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return []
  const data = await res.json() as { games: GameHistoryEntry[] }
  return data.games
}

export async function getGameActionList(gameId: string): Promise<GameAction[]> {
  const res = await fetch(`${SERVER_URL}/game/${gameId}/actions`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return []
  const data = await res.json() as { actions: GameAction[] }
  return data.actions
}

/** Server's per-viewer-filtered replay payload. Matches `ReplayView` in
 *  `server/src/services/gameService.ts` (Phase A, commit 937fbb8). */
export type ReplayPerspective = "p1" | "p2" | "neutral"

export interface ReplayMeta {
  id: string
  gameId: string
  public: boolean
  winnerUsername: string | null
  p1Username: string | null
  p2Username: string | null
  /** Display name AT FINISH TIME (denormalized on the replay row). Replay
   *  viewer chrome renders this directly and shows a "(now: X)" hover when
   *  it differs from the player's current display_name. NOT live-current —
   *  for that, use `ReplayListItem.p{1,2}DisplayName` from the list endpoint. */
  p1DisplayName: string | null
  p2DisplayName: string | null
  turnCount: number
  format: string | null
  gameFormat: string | null
  gameRotation: string | null
  createdAt: string
  /** The viewing perspective `replay.states` was filtered against. */
  perspective: ReplayPerspective
  /** Which player slot the calling user occupies in the parent game.
   *  Stamped server-side by `buildReplayView` from the auth'd user against
   *  `replays.p1_id` / `p2_id`. `null` for anonymous viewers (shared-link
   *  browsing without a session) or non-player spectators. UI drives the
   *  privacy chip + share button + perspective toggle off this — only
   *  players can change share state or flip between their perspective and
   *  the spectator (neutral) view when the replay is public. */
  callerSlot: "p1" | "p2" | null
  /** Pre-rendered, per-viewer-filtered state stream + winner. Null if the
   *  underlying game has no actions yet (shouldn't happen for finished MP
   *  games, but the server returns nullable so we mirror it). */
  replay: {
    states: GameState[]
    winner: PlayerID | null
  } | null
}

/** Fetch a replay via `GET /game/:id/replay` (player-only auth path).
 *  PHASE A (commit 937fbb8) anti-cheat fix: server now returns a pre-filtered
 *  state stream instead of raw seed+actions+decks. Pass `perspective` to
 *  request a specific view ('p2' / 'neutral' subject to the access matrix:
 *  see `decideReplayAccess` in gameService.ts).
 *
 *  Returns null on 4xx/5xx — caller can distinguish "no replay yet" (game
 *  not finished) vs "forbidden" by status if needed; today we just collapse. */
export async function getGameReplay(
  gameId: string,
  perspective?: ReplayPerspective,
): Promise<ReplayMeta | null> {
  const url = perspective != null
    ? `${SERVER_URL}/game/${gameId}/replay?perspective=${perspective}`
    : `${SERVER_URL}/game/${gameId}/replay`
  const res = await fetch(url, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { replay: ReplayMeta }
  return data.replay
}

/** Fetch a replay via `GET /replay/:id` (public-or-player auth path). Used
 *  by the share-link flow — readable without a session for public replays.
 *  Auth header is omitted when no session exists; server's optional-auth
 *  handler reads the bearer if present, otherwise treats as anonymous and
 *  returns 200 only when `replays.public=true`. */
export async function getSharedReplay(
  replayId: string,
  perspective?: ReplayPerspective,
): Promise<ReplayMeta | null> {
  const url = perspective != null
    ? `${SERVER_URL}/replay/${replayId}?perspective=${perspective}`
    : `${SERVER_URL}/replay/${replayId}`
  // Auth header is best-effort — public replays work without it. Suppress
  // throws from getToken() (no session) and just send the request anonymously.
  let headers: Record<string, string> = { "Content-Type": "application/json" }
  try {
    headers = await authHeaders()
  } catch { /* anonymous request — server will gate on replay.public */ }
  const res = await fetch(url, { headers })
  if (!res.ok) return null
  const data = await res.json() as { replay: ReplayMeta }
  return data.replay
}

/** Lightweight row in the "My Replays" browse list. Mirrors the server's
 *  `ReplayListItem` shape — no state stream, no decks. Click a row → navigate
 *  to `/replay/:gameId` which hits the per-replay filtered endpoint. */
export interface ReplayListItem {
  id: string
  gameId: string
  p1Username: string | null
  p2Username: string | null
  /** CURRENT display_name from a live profile join — renames flow forward
   *  in match history. (Distinct from `ReplayMeta.p{1,2}DisplayName`, which
   *  is the historical-at-finish value used by the replay viewer chrome.) */
  p1DisplayName: string | null
  p2DisplayName: string | null
  callerIsP1: boolean
  won: boolean | null
  /** Outcome discriminator from `games.outcome_reason` (chess-clock rollout
   *  Phase 2). Null on pre-rollout finished games. Renders as a subtle
   *  annotation alongside the W/L badge in the history view. */
  outcomeReason: GameOutcomeReason
  public: boolean
  format: string | null
  gameFormat: string | null
  gameRotation: string | null
  turnCount: number
  createdAt: string
}

/** Fetch the caller's MP replays (player-only auth). Newest-first, paginated.
 *  Returns `{ replays: [], total: 0 }` on transport error so the UI can
 *  distinguish "no results" from "auth failure" via inspecting `total`. */
export async function getMyReplays(
  limit = 50,
  offset = 0,
): Promise<{ replays: ReplayListItem[]; total: number }> {
  try {
    const res = await fetch(
      `${SERVER_URL}/replay/list?user=me&limit=${limit}&offset=${offset}`,
      { headers: await authHeaders() },
    )
    if (!res.ok) return { replays: [], total: 0 }
    return await res.json() as { replays: ReplayListItem[]; total: number }
  } catch {
    return { replays: [], total: 0 }
  }
}

/** Toggle a replay's `public` flag via `PATCH /replay/:id/share`. Player-only
 *  endpoint — server enforces. Returns the new public state on success or
 *  `null` on failure (network error or auth issue). */
export async function setReplayPublic(replayId: string, makePublic: boolean): Promise<boolean | null> {
  const res = await fetch(`${SERVER_URL}/replay/${replayId}/share`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify({ public: makePublic }),
  })
  if (!res.ok) return null
  const data = await res.json() as { ok: boolean; public: boolean }
  return data.public
}

export interface ReplayPayload {
  seed: number
  p1Deck: DeckEntry[]
  p2Deck: DeckEntry[]
  actions: GameAction[]
  winner: PlayerID | null
  turnCount: number
  shareForTraining: boolean
}

/** Save a completed game replay to the server. Fire-and-forget — errors suppressed. */
export async function saveReplay(replay: ReplayPayload): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/replay`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(replay),
    })
  } catch {
    // Non-critical — replay save failure should not surface to the user
  }
}

// =============================================================================
// MATCHMAKING — POST/GET/DELETE /matchmaking + Realtime pair-found channel.
// Server impl in dd04bb1; spec in docs/HANDOFF.md.
// =============================================================================

export type QueueKind = "casual" | "ranked"

export interface JoinMatchmakingParams {
  deck: DeckEntry[]
  cardMetadata?: Record<string, unknown>
  format: { family: GameFormatFamily; rotation: RotationId }
  matchFormat: "bo1" | "bo3"
  queueKind: QueueKind
}

/** Server response when a queue join either parks the user in the queue OR
 *  finds an immediate pair. The "paired" branch carries the new gameId so
 *  the client can navigate straight into the game without waiting on a
 *  Realtime broadcast. */
export type JoinMatchmakingResponse =
  | { status: "queued"; queueEntryId: string; eloSnapshot: number | null }
  | { status: "paired"; queueEntryId: string; gameId: string; opponentId: string; eloSnapshot: number | null }

/** GET /matchmaking response. Status is null when the user has no queue
 *  entry; otherwise the entry's full state including elapsed time + current
 *  ELO band (ranked only — null for casual or after band-widening reaches
 *  unbounded at 90s). */
export interface MatchmakingStatus {
  entryId: string
  format: { family: GameFormatFamily; rotation: RotationId }
  matchFormat: "bo1" | "bo3"
  queueKind: QueueKind
  joinedAt: string
  elapsedMs: number
  eloSnapshot: number | null
  currentBand: number | null
  pairedGameId: string | null
}

/** Errors the client should special-case (per server spec):
 *  - `ALREADY_QUEUED` (409)         — user has an active queue entry
 *  - `HOSTING_LOBBY` (409)          — user has a waiting lobby
 *  - `ACTIVE_GAME` (409)            — user is already in a game
 *  - `RATE_LIMITED` (429)           — >10 queue joins this hour
 *  - `RANKED_ROTATION_REQUIRED` (400) — picked rotation has ranked=false
 *  - `ROTATION_RETIRED` (400)        — rotation no longer offered for new decks
 *  - `ILLEGAL_DECK` (400)           — deck has cards not legal in chosen rotation
 *  Server also returns the full LegalityResult issues[] for ILLEGAL_DECK so
 *  the UI can surface specific cards.
 */
export interface MatchmakingError {
  status: number
  code: string
  message: string
  issues?: Array<{ definitionId?: string; fullName?: string; reason?: string; message?: string }>
}

export async function joinMatchmaking(params: JoinMatchmakingParams): Promise<JoinMatchmakingResponse> {
  const res = await fetch(`${SERVER_URL}/matchmaking`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string; code?: string; issues?: unknown[] }
    const err: MatchmakingError = {
      status: res.status,
      code: data.code ?? `HTTP_${res.status}`,
      message: data.error ?? `HTTP ${res.status}`,
    }
    if (Array.isArray(data.issues)) err.issues = data.issues as NonNullable<MatchmakingError["issues"]>
    throw err
  }
  return await res.json() as JoinMatchmakingResponse
}

export async function getMatchmakingStatus(): Promise<MatchmakingStatus | null> {
  const res = await fetch(`${SERVER_URL}/matchmaking`, {
    headers: await authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json() as { status: MatchmakingStatus | null }
  return data.status
}

export async function cancelMatchmaking(): Promise<{ ok: boolean; removed: boolean }> {
  const res = await fetch(`${SERVER_URL}/matchmaking`, {
    method: "DELETE",
    headers: await authHeaders(),
  })
  if (!res.ok) return { ok: false, removed: false }
  return await res.json() as { ok: boolean; removed: boolean }
}

/** Subscribe to the per-user matchmaking-results channel for pair-found
 *  events. Server broadcasts `pair_found` with payload { gameId, opponentId }
 *  when the user is paired into a game.
 *
 *  Returns an `async` unsubscribe function so callers can `await` the actual
 *  channel removal before doing follow-up work that creates a new channel
 *  (e.g., the game-channel subscription in `useGameSession`). Without that
 *  await, Supabase Realtime can reject the new channel's subscribe with
 *  CHANNEL_ERROR — symptom: red connection dot on the gameboard for the
 *  newly-paired client until refresh.
 *
 *  Use cases:
 *    - Pair-found handler: `await unsubscribe()` then navigate. (Critical.)
 *    - useEffect cleanup: `void unsubscribe()` is fine. Component unmount
 *      isn't followed by an immediate channel creation in the same paint.
 *
 *  Channel: `matchmaking:user:<userId>` (Supabase Realtime broadcast).
 *  This is the PRIMARY signal — DELETE on the matchmaking_queue row works
 *  as a fallback (REPLICA IDENTITY FULL is set on the table) but the
 *  broadcast is more direct. */
export function subscribeMatchmakingPairFound(
  userId: string,
  onPair: (payload: { gameId: string; opponentId: string }) => void,
): () => Promise<void> {
  const channel = supabase.channel(`matchmaking:user:${userId}`)
  channel.on("broadcast", { event: "pair_found" }, (msg) => {
    const payload = msg.payload as { gameId?: string; opponentId?: string } | undefined
    if (payload?.gameId && payload?.opponentId) {
      onPair({ gameId: payload.gameId, opponentId: payload.opponentId })
    }
  })
  channel.subscribe()
  return async () => {
    await supabase.removeChannel(channel)
  }
}
