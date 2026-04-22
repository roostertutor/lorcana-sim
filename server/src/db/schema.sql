-- Supabase table definitions for lorcana-sim multiplayer server
-- Run in Supabase SQL editor to initialize the schema

-- Player profiles (public data, extends Supabase Auth users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1200,
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lobbies (waiting rooms before a game starts)
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,           -- 6-char join code e.g. "LORCA7"
  host_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  host_deck JSONB,                     -- DeckEntry[] — stored at create, used when guest joins
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
  player1_deck JSONB NOT NULL,         -- DeckEntry[]
  player2_deck JSONB NOT NULL,
  state JSONB NOT NULL,                -- GameState (full serialized)
  status TEXT NOT NULL DEFAULT 'active',   -- active | finished
  winner_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Action log (for replay, debugging, and clone trainer data collection)
CREATE TABLE game_actions (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID REFERENCES profiles(id),
  action JSONB NOT NULL,               -- GameAction
  state_before JSONB NOT NULL,         -- GameState before action (clone trainer input)
  state_after JSONB NOT NULL,          -- GameState after action
  turn_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for clone trainer queries: filter by ELO at time of game
ALTER TABLE game_actions ADD COLUMN player_elo_at_time INTEGER;

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_actions ENABLE ROW LEVEL SECURITY;

-- Profiles: readable by all, writable only by owner
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Lobbies: visible only to participants
CREATE POLICY "Lobby visible to host and guest"
  ON lobbies FOR SELECT
  USING (auth.uid() = host_id OR auth.uid() = guest_id);
CREATE POLICY "Host can create lobby"
  ON lobbies FOR INSERT
  WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Guest can join lobby"
  ON lobbies FOR UPDATE
  USING (auth.uid() = host_id OR guest_id IS NULL);

-- Games: visible only to players
CREATE POLICY "Game visible to players"
  ON games FOR SELECT
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- game_actions: visible only to players of that game
CREATE POLICY "Actions visible to game players"
  ON game_actions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM games
      WHERE games.id = game_actions.game_id
        AND (games.player1_id = auth.uid() OR games.player2_id = auth.uid())
    )
  );

-- Match format support (Bo1/Bo3) and card pool (core/infinity)
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'bo1';      -- bo1 | bo3
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS game_format TEXT NOT NULL DEFAULT 'infinity'; -- core | infinity (family only)
-- Rotation id paired with game_format — together they form the engine's GameFormat.
-- Default 's11' = pre-Set-12 live rotation. Flip to 's12' on 2026-05-08 (Set 12 release).
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS game_rotation TEXT NOT NULL DEFAULT 's11';
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_number INTEGER NOT NULL DEFAULT 1;    -- 1, 2, or 3
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS guest_deck JSONB;    -- stored on join for Bo3 rematches
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS p1_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS p2_wins INTEGER NOT NULL DEFAULT 0;

-- Public lobby browser (MP UX Phase 1) — hosts opt in at create time. Default
-- FALSE so existing private-via-code behavior is preserved on backfill. Only
-- waiting lobbies with public=true surface in GET /lobby/public.
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS public BOOLEAN NOT NULL DEFAULT FALSE;

-- Spectator policy — who can watch an active game from this lobby.
-- Phase 1 only stores the chosen policy at lobby create time; Phase 7 wires
-- the filter in stateFilter.ts + the spectator routes. Default 'off' is
-- conservative (no spectators). 'invite_only' = host-approved; 'friends' =
-- host's mutual friends; 'public' = anyone on the /spectate browser.
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS spectator_policy TEXT NOT NULL DEFAULT 'off'
  CHECK (spectator_policy IN ('off', 'invite_only', 'friends', 'public'));

-- Lobby status now also supports 'cancelled' (host explicitly cancelled their
-- waiting lobby via POST /lobby/:id/cancel). Distinct from 'finished' which is
-- used for completed matches and the abandoned-waiting-lobby cleanup sweep.
-- No schema change needed (the status column has no CHECK constraint), but
-- status transitions are documented here:
--   waiting -> active     : guest joined
--   waiting -> cancelled  : host cancelled
--   waiting -> finished   : abandoned cleanup (host created another lobby)
--   active  -> finished   : match completed (Bo1 win, Bo3 decided, or resign)

-- Per-format ELO ratings (replaces single elo column)
-- Keys are {match}_{family}_{rotation} — 8 entries today for s11/s12 x core/infinity x bo1/bo3.
-- Engine registries (CORE_ROTATIONS / INFINITY_ROTATIONS) are the source of truth for which
-- rotations exist; this default just seeds the JSONB so lookups don't have to nullcheck.
-- When a new rotation lands, bump the default AND run the merge statement below once.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS elo_ratings JSONB NOT NULL DEFAULT
  '{"bo1_core_s11":1200,"bo1_core_s12":1200,"bo1_infinity_s11":1200,"bo1_infinity_s12":1200,"bo3_core_s11":1200,"bo3_core_s12":1200,"bo3_infinity_s11":1200,"bo3_infinity_s12":1200}'::jsonb;

-- One-shot ELO key migration: merge new per-rotation keys into existing rows without
-- clobbering their current values. Idempotent — re-running has no effect after the
-- first pass. Legacy keys (bo1_core etc.) are left in place as dead weight; new code
-- writes only to the per-rotation keys. Accuracy of post-migration ratings is not
-- preserved — by design, we're resetting to the right infra shape for per-rotation
-- tracking going forward.
UPDATE profiles SET elo_ratings = '{"bo1_core_s11":1200,"bo1_core_s12":1200,"bo1_infinity_s11":1200,"bo1_infinity_s12":1200,"bo3_core_s11":1200,"bo3_core_s12":1200,"bo3_infinity_s11":1200,"bo3_infinity_s12":1200}'::jsonb || elo_ratings
WHERE NOT (elo_ratings ? 'bo1_core_s11');

-- Deck box art: the CardDefinition id whose image visually represents this
-- deck in lists + deck-title chrome. Null means "derive from first entry in
-- the decklist". User-selectable from within the deck's own cards.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS box_card_id TEXT;

-- Per-card enrichment that doesn't round-trip through vanilla decklist_text
-- (kept plain for interop with external tools — Inkable, Dreamborn, etc.).
-- Shape: { "<definitionId>": { variant?: "enchanted" | "iconic" | "epic" | "promo" | "special", … } }
-- Omitted cards default to no enrichment (regular variant). Intentionally
-- wide so future fields (foil preference, per-card notes, tags) nest under
-- the same key without another migration.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS card_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Format stamp — which GameFormat the deck was built for. Together they mirror
-- the engine's GameFormat = { family, rotation } shape. Default values blanket-
-- stamp every existing row on ADD COLUMN (Postgres backfills from the DEFAULT);
-- no separate backfill script needed. Flip defaults to 's12' on 2026-05-08
-- when Set 12 releases and becomes the new Core default.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS format_family TEXT NOT NULL DEFAULT 'core';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS format_rotation TEXT NOT NULL DEFAULT 's11';

-- ── MP UX Phase 2: post-game polish ─────────────────────────────────────────

-- Rematch lineage: link a new lobby back to its predecessor so the game-over
-- overlay can offer "Rematch" and the server can track rematch chains. Null
-- for non-rematch lobbies (the default). Follow-the-link query on the lobby
-- table for analytics ("what % of matches get rematched?").
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS rematch_of UUID REFERENCES lobbies(id);

-- Replays table — auto-saved on MP game finish. One row per finished game
-- (Bo3 can produce up to 3 rows per match, one per game). Denormalized
-- usernames + format fields so share links work without extra joins on read.
-- The `public` flag gates access: default FALSE means only the two players
-- can view; opt-in to TRUE via PATCH /replay/:id/share makes the replay
-- readable by anyone with the link.
CREATE TABLE IF NOT EXISTS replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  winner_player_id UUID REFERENCES profiles(id),  -- null if resign with no valid winner state
  p1_username TEXT,
  p2_username TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  format TEXT,                -- bo1 | bo3 (from parent lobby at finish time)
  game_format TEXT,           -- core | infinity
  game_rotation TEXT,         -- s11 | s12 | …
  public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS replays_public_idx ON replays (public, created_at DESC);
CREATE INDEX IF NOT EXISTS replays_game_idx ON replays (game_id);

ALTER TABLE replays ENABLE ROW LEVEL SECURITY;

-- Postgres `CREATE POLICY` doesn't support IF NOT EXISTS, so we drop-first
-- to keep this block idempotent. Safe to re-run on an initialized DB.
DROP POLICY IF EXISTS "Replays readable by players or if public" ON replays;
DROP POLICY IF EXISTS "Replays public-toggle by players" ON replays;

-- Visible to both players of the parent game OR to anyone when public=true.
-- We can't reference a games column in RLS without an EXISTS subquery because
-- RLS can only read the row being accessed; subquery scopes the check.
CREATE POLICY "Replays readable by players or if public"
  ON replays FOR SELECT
  USING (
    public = true
    OR EXISTS (
      SELECT 1 FROM games
      WHERE games.id = replays.game_id
        AND (games.player1_id = auth.uid() OR games.player2_id = auth.uid())
    )
  );

-- Only the two players of the parent game can flip `public` via
-- PATCH /replay/:id/share. Service-role writes (initial insert from
-- handleMatchProgress) bypass RLS as usual.
CREATE POLICY "Replays public-toggle by players"
  ON replays FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM games
      WHERE games.id = replays.game_id
        AND (games.player1_id = auth.uid() OR games.player2_id = auth.uid())
    )
  );

-- Lobby status now also supports 'waiting_rematch' — documented here for
-- reference; column has no CHECK constraint so the value flows freely.
-- Status transitions (post-Phase-2):
--   waiting          -> active        : guest joined
--   waiting          -> cancelled     : host cancelled
--   waiting          -> finished      : abandoned cleanup
--   active           -> finished      : match completed
--   (finished lobby) -> waiting_rematch (new lobby with rematch_of pointing back)
--   waiting_rematch  -> active        : both players confirmed; first game spawned

-- Enable Supabase Realtime on the games table
ALTER TABLE games REPLICA IDENTITY FULL;
-- Realtime on lobbies too — rematch flow needs both clients to see status changes.
ALTER TABLE lobbies REPLICA IDENTITY FULL;
