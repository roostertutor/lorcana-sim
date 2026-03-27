# SERVER.md
# Spec for the multiplayer server.
# Lives in /server — a separate folder from the main monorepo.
# Has its own CLAUDE.md and SPEC.md (this file).
# Imports from @lorcana-sim/engine only.

---

## Purpose

Server-side game state management for multiplayer.
Handles: auth, game rooms, action validation, real-time broadcast.

The rule engine (packages/engine) handles all game logic.
The server is a thin layer that:
1. Receives actions from clients
2. Validates them via applyAction()
3. Stores resulting GameState in database
4. Broadcasts new state to both players

---

## Why a Server (Not Client-Side)

Zero cheating tolerance. The server is the only source of truth.
Clients send ACTIONS, never GameState.
The server runs applyAction() and produces all valid GameStates.
A client that sends a modified state is ignored — the server recomputes from its own copy.

```
Client sends:  { type: "QUEST", playerId: "player1", instanceId: "abc" }
Server runs:   applyAction(storedState, action, definitions)
Server stores: newState in database
Server sends:  newState to both clients
```

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Runtime | Node.js | Same as engine package |
| Framework | Hono | Fast, lightweight, TypeScript-native |
| Database | Supabase (Postgres) | Auth + Realtime + Storage in one |
| Auth | Supabase Auth | Google + Discord OAuth, no custom auth |
| Real-time | Supabase Realtime | WebSocket broadcast without managing WS server |
| Hosting | Railway | Simple deploy, $5-7/month, no sleep on free tier |
| Package manager | pnpm | Consistent with monorepo |

---

## Folder Structure

```
server/
├── CLAUDE.md              ← Claude Code instructions for this folder
├── SPEC.md                ← This file
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           ← Hono app entry point
│   ├── routes/
│   │   ├── auth.ts        ← Auth endpoints (thin Supabase wrappers)
│   │   ├── lobby.ts       ← Create/join/list lobbies
│   │   └── game.ts        ← Game actions
│   ├── services/
│   │   ├── gameService.ts ← Core: load state, apply action, save, broadcast
│   │   ├── lobbyService.ts
│   │   └── authService.ts
│   ├── db/
│   │   ├── schema.sql     ← Supabase table definitions
│   │   └── client.ts      ← Supabase client init
│   └── middleware/
│       └── auth.ts        ← Verify JWT from Supabase
├── .env.example
└── README.md
```

---

## Database Schema

```sql
-- Users (managed by Supabase Auth, just reference here)
-- supabase auth.users handles user creation

-- Player profiles (public data)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lobbies
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,          -- 6-char join code e.g. "LORCA7"
  host_id UUID REFERENCES profiles(id),
  guest_id UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | active | finished
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Games
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id),
  player1_id UUID REFERENCES profiles(id),
  player2_id UUID REFERENCES profiles(id),
  player1_deck JSONB NOT NULL,        -- DeckEntry[]
  player2_deck JSONB NOT NULL,
  state JSONB NOT NULL,               -- GameState (full serialized)
  status TEXT NOT NULL DEFAULT 'active',  -- active | finished
  winner_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Action log (for replay and debugging)
CREATE TABLE game_actions (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID REFERENCES games(id),
  player_id UUID REFERENCES profiles(id),
  action JSONB NOT NULL,              -- GameAction
  result_state JSONB NOT NULL,        -- GameState after action
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Row Level Security:
- Players can only see lobbies they're in
- Players can only see games they're in
- Players can only submit actions for their own playerId

---

## API Endpoints

### Auth (thin Supabase wrappers)

```
POST /auth/google    → redirect to Supabase Google OAuth
POST /auth/discord   → redirect to Supabase Discord OAuth
GET  /auth/callback  → handle OAuth callback, return JWT
POST /auth/logout    → invalidate session
GET  /auth/me        → return current user profile
```

### Lobbies

```
POST /lobby/create
  body: { deck: DeckEntry[] }
  returns: { lobbyId, code }
  Creates a lobby, generates 6-char code, stores deck for host

POST /lobby/join
  body: { code: string, deck: DeckEntry[] }
  returns: { lobbyId, gameId }
  Joins lobby by code, stores deck for guest, creates game, starts it

GET /lobby/:id
  returns: { lobby, game? }
  Lobby status and game state if active

GET /lobby/list
  returns: { lobbies[] }
  Active lobbies for current user (host or guest)
```

### Game

```
POST /game/:id/action
  body: { action: GameAction }
  returns: { success, newState?, error? }
  
  Server-side flow:
    1. Verify JWT — get playerId from token
    2. Load game from database
    3. Verify it's this player's turn (or their choice to resolve)
    4. Load definitions (cached in memory at startup)
    5. Run applyAction(game.state, action, definitions)
    6. If success: save newState to games table, insert into game_actions
    7. Supabase Realtime broadcasts to both players automatically
    8. Return { success: true, newState }
    9. If fail: return { success: false, error }

GET /game/:id
  returns: { game } (current state)
  Used on reconnect / page refresh

POST /game/:id/resign
  Forfeit the game
```

---

## Real-Time Architecture

Supabase Realtime listens for database changes and broadcasts to subscribed clients.

```typescript
// Server writes to database after each action
await supabase
  .from("games")
  .update({ state: newState, updated_at: new Date() })
  .eq("id", gameId)

// Supabase automatically broadcasts the UPDATE event to subscribed clients
// No manual WebSocket management needed
```

Client subscribes:
```typescript
// Client-side (in useGameSession hook — multiplayer mode)
const channel = supabase
  .channel(`game:${gameId}`)
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "games",
    filter: `id=eq.${gameId}`,
  }, (payload) => {
    setGameState(payload.new.state as GameState)
  })
  .subscribe()
```

Both players subscribe to the same channel. When the server updates the game row,
both clients receive the new state simultaneously. No polling. No custom WebSockets.

---

## Game Service (Core Logic)

```typescript
// src/services/gameService.ts

import { applyAction } from "@lorcana-sim/engine"  // ONLY engine import
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine"

// Cached at startup — 216 cards don't change between requests
const definitions = LORCAST_CARD_DEFINITIONS

export async function processAction(
  gameId: string,
  playerId: string,  // from JWT
  action: GameAction,
  supabase: SupabaseClient
): Promise<{ success: boolean; newState?: GameState; error?: string }> {

  // 1. Load current game state
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()

  if (!game) return { success: false, error: "Game not found" }
  if (game.status !== "active") return { success: false, error: "Game is not active" }

  const state = game.state as GameState

  // 2. Verify it's this player's turn
  const playerSide = game.player1_id === playerId ? "player1" : "player2"
  const activePlayerId = state.pendingChoice
    ? state.pendingChoice.choosingPlayerId
    : state.currentPlayer

  if (activePlayerId !== playerSide) {
    return { success: false, error: "Not your turn" }
  }

  // 3. Ensure action is for the correct player
  if (action.playerId !== playerSide) {
    return { success: false, error: "Action playerId mismatch" }
  }

  // 4. Apply the action (engine validates and produces new state)
  const result = applyAction(state, action, definitions)

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // 5. Save new state (triggers Supabase Realtime broadcast)
  await supabase
    .from("games")
    .update({
      state: result.newState,
      status: result.newState.isGameOver ? "finished" : "active",
      winner_id: result.newState.winner
        ? (result.newState.winner === "player1" ? game.player1_id : game.player2_id)
        : null,
      updated_at: new Date(),
    })
    .eq("id", gameId)

  // 6. Log the action
  await supabase.from("game_actions").insert({
    game_id: gameId,
    player_id: playerId,
    action,
    result_state: result.newState,
  })

  return { success: true, newState: result.newState }
}
```

---

## Disconnection Handling

Simple approach for v1:
- Game state is always in the database
- On reconnect, client calls GET /game/:id to get current state
- No timeout/forfeit for disconnection in v1 (add later if needed)
- Supabase Realtime reconnects automatically

---

## Build Order

1. Database schema + Supabase setup
2. Auth endpoints (Google + Discord OAuth via Supabase)
3. Lobby create/join
4. Game action endpoint (core loop)
5. Supabase Realtime subscription (client-side in useGameSession)
6. Wire into useGameSession multiplayer mode
7. Deploy to Railway

Do NOT build public matchmaking in v1. Private lobbies only.
Public matchmaking requires a queue system and is a separate feature.

---

## Environment Variables

```
# .env.example
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx   # server-only, never expose to client
PORT=3001
```

Client-side (Vite):
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx      # safe to expose, RLS enforces security
VITE_SERVER_URL=https://your-railway-app.up.railway.app
```

---

## What NOT to Build in Server v1

- Public matchmaking (needs queue, skill matching, forfeit handling)
- Spectator mode (separate subscription model)
- Replay viewer (game_actions table exists, viewer is a UI feature)
- Chat (separate Supabase Realtime channel, not game logic)
- Ranked/ELO system (needs match history analysis)
- Deck storage (client pastes deck each game for now)