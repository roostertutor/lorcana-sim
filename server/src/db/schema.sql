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

-- Enable Supabase Realtime on the games table
ALTER TABLE games REPLICA IDENTITY FULL;
