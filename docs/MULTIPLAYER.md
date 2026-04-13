# MULTIPLAYER.md — Phased Multiplayer Delivery Spec
# Stream 4 implementation plan: what exists, what's missing, how to ship it.
# Three iterations: Anti-Cheat → Deploy → Polish.
#
# Last updated: 2026-04-13

---

## What Already Works

The multiplayer stack is **mostly functional**. Two players can sign in, create/join
a lobby, and play a complete game against each other right now on localhost.

### Fully Wired (end-to-end)

- **Auth**: Email/password sign in + sign up via Supabase (`MultiplayerLobby.tsx`)
- **Lobby**: Create lobby → 6-char code + copy button + polling for guest. Join lobby → enter code → game auto-starts for both players. Shareable lobby links (`/lobby/ABC123`).
- **Game session**: `useGameSession` has a full multiplayer branch — local-first `applyAction()` for instant feedback, fire-and-forget `sendAction()` to server, Realtime fetch-on-notify for opponent actions.
- **Anti-cheat state filtering**: `stateFilter.ts` strips opponent's hand, deck, and face-down cards before sending to clients. Realtime handler ignores raw payload (which contains full state) and fetches filtered state from server.
- **Perspective**: `myId = multiplayerGame?.myPlayerId ?? "player1"` — all rendering uses `myId`, not hardcoded `"player1"`. Player 2 sees their cards at the bottom correctly.
- **Server**: Hono server with `POST /game/:id/action` (validates turn, calls `applyAction()`, saves to DB, triggers Realtime broadcast), `POST /game/:id/resign`, `GET /game/:id` (reconnect + filtered state), lobby CRUD, auth middleware (JWT via Supabase).
- **ELO**: K=32, updated on game completion and resignation.
- **Action logging**: Every action logged to `game_actions` with `state_before`, `state_after`, `turn_number`, `player_elo_at_time` — ready for clone trainer (Stream 5).
- **URL routing**: react-router-dom — `/`, `/simulate`, `/sandbox`, `/multiplayer`, `/lobby/:code`, `/game/:gameId`, `/solo`.
- **Reconnection**: Active game persisted to localStorage. Browser crash/refresh → auto-redirects to `/game/:id`. Cleared on game end or explicit leave.
- **Duplicate game guard**: Server rejects create/join lobby if user already has an active game.
- **Resign button**: Multiplayer-only, calls `resignGame()` on server.
- **"Waiting for opponent" indicator**: Shows when it's opponent's turn in multiplayer.

### Infrastructure (server + DB)

| Component | File | Status |
|-----------|------|--------|
| Hono entry + CORS | `server/src/index.ts` | Working (port 3001) |
| Auth middleware | `server/src/middleware/auth.ts` | Working (JWT via Supabase) |
| Auth routes | `server/src/routes/auth.ts` | Working (`GET /auth/me`, `POST /auth/profile`) |
| Lobby routes | `server/src/routes/lobby.ts` | Working (create/join/list) |
| Game routes | `server/src/routes/game.ts` | Working (action/resign/get) |
| Game service | `server/src/services/gameService.ts` | Working (core loop + ELO) |
| State filter | `server/src/services/stateFilter.ts` | Working (strips opponent hand/deck) |
| Lobby service | `server/src/services/lobbyService.ts` | Working (6-char codes + duplicate guard) |
| DB schema | `server/src/db/schema.sql` | Deployed (`profiles`, `lobbies`, `games`, `game_actions`) |
| Client API | `packages/ui/src/lib/serverApi.ts` | Working (all functions) |
| Supabase client | `packages/ui/src/lib/supabase.ts` | Working |
| Lobby UI | `packages/ui/src/pages/MultiplayerLobby.tsx` | Working |
| Game hook | `packages/ui/src/hooks/useGameSession.ts` | Working (multiplayer branch) |

### Environment (live Supabase instance)

- `server/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT=3001`
- `packages/ui/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SERVER_URL`

---

## What's Done

| Feature | Iteration | Commit |
|---------|-----------|--------|
| ✅ State filtering (opponent hand/deck hidden) | 1 | `73aa823` |
| ✅ Resign button in GameBoard | 1 | `73aa823` |
| ✅ "Waiting for opponent" indicator | 1 | `73aa823` |
| ✅ Realtime fetch-on-notify (anti-cheat) | 1 | `73aa823` |
| ✅ Local-first dispatch (instant UI feedback) | 1 | `73aa823` |
| ✅ Error recovery / state re-sync | 2 | `73aa823` |
| ✅ URL routing (react-router-dom) | 2 | `5580f78` |
| ✅ Reconnection on refresh/crash (localStorage) | 2 | `5580f78` |
| ✅ Shareable lobby links (`/lobby/:code`) | 2 | `5580f78` |
| ✅ Duplicate game guard (server-side) | 2 | `5580f78` |
| ✅ Resign updates GameState + correct Victory/Defeat per player | 2 | `ef57a4d` |
| ✅ Multiplayer game-over → "Back to Lobby" (clears localStorage) | 2 | `ef57a4d` |
| ✅ Token auto-refresh (serverApi reads from supabase session) | 2 | `c1af4ec` |
| ✅ Connection status indicator (green/red dot) | 2 | `c1af4ec` |
| ✅ Abandoned lobby cleanup on new lobby create | 2 | `c1af4ec` |

## What's Missing

| Gap | Severity | Iteration |
|-----|----------|-----------|
| Server deployment (Railway) | Blocking for remote play | 2 |
| OAuth buttons (Google/Discord) | Nice-to-have | 2 |
| Game history UI | Nice-to-have | 3 |
| ELO display | Nice-to-have | 3 |
| Rematch flow | Nice-to-have | 3 |
| Replay saving endpoint | Nice-to-have | 3 |
| Match formats (Bo1/Bo3) | Nice-to-have | 3 |
| Server integration tests | Maintenance | 3 |

---

## Iteration 1: Anti-Cheat (State Filtering) — DONE ✅

**Goal**: Close the information leak. ~~Right now both players receive the full
GameState via Supabase Realtime — opponent's hand, deck order, everything.~~
Fixed: server filters state before sending, Realtime handler fetches filtered
state instead of reading raw payload.

### 1a. Server-Side State Filter

**New file**: `server/src/services/stateFilter.ts`

```typescript
filterStateForPlayer(state: GameState, playerId: PlayerID): GameState
```

What it does:
1. **My zones** — all fully intact (hand, deck, play, inkwell, discard, under)
2. **Opponent's public zones** — `play`, `inkwell`, `discard` fully intact
3. **Opponent's hand** — keep array length (so I can see "opponent has 5 cards") but replace each card's entry in `state.cards` with a stub: `{ instanceId, definitionId: "hidden", zone: "hand", ownerId: opponentId }`. UI renders these as card backs.
4. **Opponent's deck** — same treatment: keep array length, stub card entries. Only deck count matters; order and contents are hidden.
5. **Face-down cards under** — cards with `isFaceDown: true` in opponent's `under` zone get stubbed.

Apply in `routes/game.ts` → `GET /game/:id` before returning the response.

### 1b. Fix Realtime Leak

The hard problem: Supabase `postgres_changes` broadcasts the raw `games` row including the full unfiltered `state` JSONB. There is no server-side hook to filter the Realtime payload.

**Solution — fetch on notify**:

The client's Realtime handler currently reads state directly from the payload:
```typescript
// CURRENT (leaks full state)
.on("postgres_changes", { ... }, (payload) => {
  const newState = (payload.new as { state: GameState }).state;
  setGameState(newState);
})
```

Change to: ignore the payload, use the event as a "something changed" signal, then fetch filtered state from the server:
```typescript
// FIXED (fetch filtered state)
.on("postgres_changes", { ... }, async () => {
  const filtered = await getGame(gameId);  // GET /game/:id returns filtered
  gameStateRef.current = filtered;
  setGameState(filtered);
})
```

**Tradeoff**: Adds ~100-200ms latency per action (one HTTP round-trip). In practice this is invisible — the Realtime event fires in ~50ms, the fetch adds ~100ms, total is well under the human perception threshold for a turn-based card game.

**Future upgrade path** (Option A — if latency ever matters):
Switch from `postgres_changes` to Supabase Realtime **Broadcast** channels. After saving state, the server pushes two filtered messages to player-specific channels (`game:{id}:p1`, `game:{id}:p2`). Eliminates the extra HTTP call. Only worth doing if the fetch-on-notify latency becomes noticeable (unlikely for turn-based).

### 1c. Resign Button

**File**: `packages/ui/src/pages/GameBoard.tsx`

Add resign/concede button, visible only in multiplayer mode:
```tsx
{multiplayerGame && !isGameOver && (
  <button onClick={() => resignGame(token, gameId)}>Resign</button>
)}
```

Server marks game finished, updates ELO, Realtime pushes the update.

### 1d. "Waiting for Opponent" Indicator

When `gameState.currentPlayer !== myId` and no `pendingChoice` for `myId`, show "Waiting for opponent..." banner. Currently the board just sits with no legal actions — looks frozen to the inactive player.

### 1e. Engine Changes

None. Filtering is a server concern.

### Acceptance Criteria

- [ ] Player cannot see opponent's hand cards in devtools or rendered UI
- [ ] Player cannot see opponent's deck contents or order
- [ ] Player CAN see opponent's play zone, inkwell, and discard (public info)
- [ ] Opponent's hand shows correct card count (card backs, not empty)
- [ ] All existing multiplayer functionality still works (create/join/play/turn-taking)
- [ ] Resign button works, ends game, updates ELO
- [ ] "Waiting for opponent" shown when it's not your turn

### Risks / Open Questions

- **Fetch-on-notify latency**: Should be ~100-200ms. If noticeably laggy, upgrade to Broadcast channels. Test with real network conditions.
- **Card stub shape**: Need to decide exactly which fields the stub includes. Must be enough for the UI to render a card back without crashing (needs `instanceId`, `zone`, `ownerId` at minimum). Check what GameCard.tsx reads.
- **RLS on Realtime**: The anon-key subscription respects RLS. `games` SELECT policy is `USING (auth.uid() = player1_id OR auth.uid() = player2_id)`. Verify this doesn't silently fail — if it does, the non-acting player's board freezes.

---

## Iteration 2: Deploy + Resilience (IN PROGRESS)

**Goal**: Ship to the public internet. Players anywhere can play. Handle disconnects,
token expiry, and errors gracefully.

**Already done**: Reconnection (localStorage + `/game/:id` route), error recovery
(re-sync on sendAction failure), URL routing, shareable lobby links, duplicate
game guard.

### 2a. Deployment

**Server → Railway**:
- Add `server/Dockerfile` or configure Railway build/start commands
- Build: `pnpm build` → Start: `node dist/index.js`
- Env vars in Railway dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT` (auto-set), `CLIENT_URL` (production UI URL)

**UI → Vercel / Netlify / Railway static**:
- Vite build output → static hosting
- Build-time env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SERVER_URL` (Railway server URL)

**Supabase dashboard**:
- Add production domain to OAuth redirect URLs
- Set Site URL to production domain

### 2b. Reconnection on Refresh — DONE ✅

Implemented via react-router-dom URL routing + localStorage persistence.
Active game config stored in `localStorage("mp-game")`. On mount, `/multiplayer`
route checks for stored game and redirects to `/game/:gameId`. Shareable lobby
links via `/lobby/:code` with pre-filled join code.

### 2c. Token Refresh — DONE ✅

`serverApi.ts` reads fresh token from `supabase.auth.getSession()` internally
on every call. Removed `token` parameter from all API functions and the entire
prop chain (`multiplayerGame.token`, `onGameStart` third arg, `GameSessionConfig`).

### 2d. Error Recovery / State Re-sync — DONE ✅

Dispatch catches `sendAction` errors and re-fetches authoritative state from
server via `getGame()`. Implemented in `useGameSession.ts` dispatch callback.

### 2e. Connection Status Indicator — DONE ✅

`useGameSession` exposes `connectionStatus` ("connected" | "reconnecting" | null)
from the Supabase Realtime channel state. GameBoard shows a green/red dot in
the scoreboard area next to the resign button during multiplayer games.

### 2f. OAuth Buttons (Optional)

Add "Sign in with Google" / "Sign in with Discord" to `MultiplayerLobby.tsx`. Replace one-shot `getSession()` with `onAuthStateChange()` listener to catch OAuth redirects.

Requires Supabase dashboard config: enable Google/Discord providers, add redirect URLs.

Email/password already works — OAuth is convenience, not blocking.

### 2g. Engine Changes

None.

### Acceptance Criteria

- [x] Refreshing the page mid-game returns player to their active game
- [x] Invalid action errors don't desync (client re-fetches server state)
- [x] Token expiry mid-game doesn't break the session
- [x] Connection status visible in multiplayer mode
- [ ] Deployed to Railway (server) + static host (UI) with HTTPS
- [ ] Two players on different networks can play a complete game
- [ ] OAuth sign-in works (if wired)

### Risks / Open Questions

- **Railway cold starts**: Hobby plan sleeps after 30min inactivity. ~5s cold start. Uptime ping prevents this.
- **State payload size**: Full `GameState` JSONB can grow for long games. Supabase Realtime has ~1MB limit. Strip `actionLog` from stored state if needed (logged separately in `game_actions`).
- **Concurrent action race**: `processAction` does read-then-write without a DB lock. The `activePlayerId` check should prevent conflicts (only one player can act at a time), but verify no edge cases during `RESOLVE_CHOICE` where both players have pending choices.

---

## Iteration 3: Polish

**Goal**: Social features and quality-of-life that make the platform feel complete.

### 3a. Game History Page

**New file**: `packages/ui/src/pages/GameHistory.tsx`

List of completed games. Query `games` table where `status = 'finished'`. Show:
- Opponent username (join `profiles`)
- Win/loss badge
- Date
- ELO change
- "Replay" button → load into `useReplaySession`

Paginated. Add as section in multiplayer lobby.

### 3b. ELO Display

Show current ELO in MultiplayerLobby session bar. `GET /auth/me` already returns profile with `elo` and `games_played`.

### 3c. Rematch Flow

After game-over, show "Rematch" button → creates new lobby with same decks, shows code. Simple approach — no Realtime rematch handshake, just share the code.

### 3d. Replay Saving

**Server**: Add `POST /replay` route. Client's `saveReplay()` in `serverApi.ts` already calls it — just needs the server endpoint.

**Replay viewer for past games**: Fetch `game_actions` for a finished game, extract ordered actions, reconstruct via `useReplaySession`.

### 3e. Server Integration Tests

Cover: lobby flow, action processing, turn validation, resign, ELO, state filtering.

### 3f. Match Formats (Bo1 / Bo3)

Currently every game is a standalone Bo1. Add match format support:

- **Lobby config**: Host selects format (Bo1, Bo3) when creating lobby
- **DB**: Add `format` column to `lobbies` table, add `match_id` + `game_number`
  to `games` table to link games within a match
- **Match flow (Bo3)**: After game 1 ends, game-over modal shows match score
  (e.g. "1-0") and a "Next Game" button instead of "Back to Lobby". Server
  creates the next game in the same match automatically. Match ends when one
  player wins 2 games.
- **Sideboarding**: Between games in a Bo3, allow deck modifications (swap cards
  in/out from a sideboard). Requires sideboard field on lobby/deck config.
  Lorcana doesn't have an official sideboard rule — decide whether to allow
  full deck swaps or a fixed sideboard size.
- **ELO**: Update once per match, not per game. A Bo3 counts as one rated match.
- **Match history**: Game history page shows matches, expandable to individual games.

### 3g. Spectator Mode (Design Notes Only — Do Not Build)

For future reference:
- Spectators subscribe to game's Realtime channel
- RLS needs spectator-access rule
- State filtering required (both hands hidden, or delayed view for anti-coaching)
- Read-only GameBoard mode (no dispatch)
- Share link: `https://app/spectate/{gameId}`

### Acceptance Criteria

- [ ] Player sees ELO rating in lobby
- [ ] Player can view list of past games
- [ ] Player can replay completed multiplayer games
- [ ] Rematch via lobby code after game ends

---

## Infrastructure Costs

| Service | Free Tier | Paid Tier | When to upgrade |
|---------|-----------|-----------|-----------------|
| **Supabase** (DB, auth, Realtime) | $0 — 500MB storage, 2GB bandwidth, 50K MAU, 500 concurrent Realtime connections | $25/mo (8GB, daily backups, no 1-week inactivity pause) | >500MB data or need backups |
| **Railway** (Hono server) | $5 trial credit, sleeps after 30min | $5/mo + ~$1-2 usage | Going live (hobby plan doesn't sleep) |
| **Vercel/Netlify** (static UI) | $0 — 100GB bandwidth | $20/mo | >100GB bandwidth (unlikely) |
| **Domain** (optional) | Free subdomain from Railway/Vercel | $10-15/year | Want a custom domain |

**Total cost to go live: ~$5-7/mo** (Railway hobby + Supabase free + Vercel free).
Current dev setup (Supabase free tier + localhost): **$0**.

Supabase free tier is generous — 500 concurrent Realtime connections supports
~250 simultaneous games. You'd need hundreds of concurrent players before hitting
the $25/mo Pro tier. Railway's hobby plan is the only hard cost.

---

## Cross-Cutting Concerns

### State Filtering Architecture

`GameState` contains:
- `zones: Record<PlayerID, Record<ZoneName, string[]>>` — instance IDs per zone
- `cards: Record<string, CardInstance>` — all card data keyed by instance ID

Hidden from opponent: `hand`, `deck`. Public: `play`, `inkwell`, `discard`.
`under` follows parent visibility (`isFaceDown` = hidden).

Filtering: keep zone array lengths, replace hidden card entries in `cards` with stubs.

### Token Management — DONE ✅

All `serverApi` functions read token from `supabase.auth.getSession()` internally.
No `token` parameter in function signatures. No token in component props.

### Supabase Dashboard Checklist

- [ ] Enable Google OAuth provider (if doing OAuth)
- [ ] Enable Discord OAuth provider (if doing OAuth)
- [ ] Set Site URL to production domain
- [ ] Add localhost + production URLs to Redirect URLs
- [ ] Verify RLS allows Realtime subscriptions for game players
- [ ] Realtime on `games` table already enabled (`REPLICA IDENTITY FULL`)

### Critical File Index

```
server/src/index.ts                      — Hono entry, CORS config
server/src/routes/game.ts                — POST /game/:id/action (core loop)
server/src/services/gameService.ts       — processAction, ELO, state management
server/src/services/lobbyService.ts      — lobby create/join
server/src/db/schema.sql                 — table definitions + RLS

packages/ui/src/hooks/useGameSession.ts  — multiplayer dispatch + Realtime sub
packages/ui/src/pages/MultiplayerLobby.tsx — auth + lobby UI
packages/ui/src/pages/GameBoard.tsx      — game board with multiplayerGame prop
packages/ui/src/lib/serverApi.ts         — all server API calls
packages/ui/src/lib/supabase.ts          — Supabase client init
packages/ui/src/App.tsx                  — routing + multiplayer game start
```
