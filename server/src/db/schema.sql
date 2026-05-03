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

-- DROPPED 2026-04-22: `game_actions.player_elo_at_time` was redundant with
-- game-level ELO snapshots (ELO only updates at match-end, so every action
-- in a match had the same stamp). Moved to games.p1_elo_at_start /
-- p2_elo_at_start below. game_actions stays strictly action data; per-user
-- context lives on the aggregating rows (games, lobbies, profiles).
ALTER TABLE game_actions DROP COLUMN IF EXISTS player_elo_at_time;

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

-- Per-format games_played counters (parallel to elo_ratings).
-- Keys mirror the EloKey shape: {match}_{family}_{rotation}. The overall
-- profiles.games_played column stays as the activity-tracking single counter
-- (used for the avatar-dropdown summary). This JSONB lets the /me page show
-- per-format counts alongside per-format ratings — natural pairing.
--
-- Seeded with all 8 current keys at 0 so reads can index in without nullcheck.
-- When a new rotation lands, run the same merge pattern below to extend the
-- shape without clobbering existing counts. Source of truth for which
-- rotations exist remains the engine registries (CORE_ROTATIONS /
-- INFINITY_ROTATIONS) — this default tracks them.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS games_played_by_format JSONB NOT NULL DEFAULT
  '{"bo1_core_s11":0,"bo1_core_s12":0,"bo1_infinity_s11":0,"bo1_infinity_s12":0,"bo3_core_s11":0,"bo3_core_s12":0,"bo3_infinity_s11":0,"bo3_infinity_s12":0}'::jsonb;

-- One-shot key migration for the games_played_by_format JSONB. Same idempotent
-- "merge defaults into existing rows" pattern as elo_ratings above. The
-- left-merge keeps existing keys intact; only missing keys pick up the 0
-- default. Safe to re-run; no effect after first pass for a given rotation set.
UPDATE profiles SET games_played_by_format = '{"bo1_core_s11":0,"bo1_core_s12":0,"bo1_infinity_s11":0,"bo1_infinity_s12":0,"bo3_core_s11":0,"bo3_core_s12":0,"bo3_infinity_s11":0,"bo3_infinity_s12":0}'::jsonb || games_played_by_format
WHERE NOT (games_played_by_format ? 'bo1_core_s11');

-- One-shot historical backfill of games_played_by_format from the replays
-- table. The `games` table itself doesn't carry format columns (format lives
-- on the parent `lobbies` row, or — for queue games — on the now-deleted
-- matchmaking_queue row). The `replays` table denormalized format/game_format/
-- game_rotation at finish time, so it's the most reliable single-source for
-- "completed game count, per format key, per user."
--
-- Limitation: queue games created BEFORE replays were saved for queue paths
-- (currently saveReplayForGame is only called inside the `if (lobby)` branch
-- of resign + handleMatchProgress) won't be counted here. Queue play is
-- pre-launch / negligible today, so the gap is acceptable; the going-forward
-- write path (in updateElo) covers all paths uniformly.
--
-- Idempotent: each run REPLACES the historical counts with the
-- recomputed-from-replays count, then `||` merges any going-forward keys
-- that aren't in the rebuild. Counts each game once per player slot —
-- both p1 and p2 get +1 for the format key derived from the replay row.
WITH per_user_counts AS (
  SELECT
    g.player1_id AS user_id,
    r.format || '_' || r.game_format || '_' || r.game_rotation AS key,
    COUNT(*) AS games
  FROM replays r
  JOIN games g ON g.id = r.game_id
  WHERE r.format IS NOT NULL
    AND r.game_format IS NOT NULL
    AND r.game_rotation IS NOT NULL
    AND g.player1_id IS NOT NULL
  GROUP BY g.player1_id, r.format, r.game_format, r.game_rotation
  UNION ALL
  SELECT
    g.player2_id AS user_id,
    r.format || '_' || r.game_format || '_' || r.game_rotation AS key,
    COUNT(*) AS games
  FROM replays r
  JOIN games g ON g.id = r.game_id
  WHERE r.format IS NOT NULL
    AND r.game_format IS NOT NULL
    AND r.game_rotation IS NOT NULL
    AND g.player2_id IS NOT NULL
  GROUP BY g.player2_id, r.format, r.game_format, r.game_rotation
),
agg AS (
  SELECT user_id, jsonb_object_agg(key, games) AS counts
  FROM (
    SELECT user_id, key, SUM(games)::int AS games
    FROM per_user_counts
    GROUP BY user_id, key
  ) s
  GROUP BY user_id
)
UPDATE profiles p
SET games_played_by_format = p.games_played_by_format || a.counts
FROM agg a
WHERE p.id = a.user_id;

-- ── Decks + deck_versions (backfilled DDL) ──────────────────────────────
-- These tables were originally created ad-hoc in Supabase Studio and the
-- base DDL never landed in source control; only the `ALTER TABLE decks …`
-- statements below were tracked. Reconstructed 2026-04-22 from the fields
-- consumed by packages/ui/src/lib/deckApi.ts so a fresh-environment rebuild
-- from schema.sql actually works. IF NOT EXISTS makes this safe to re-run
-- against the existing production DB — if a column is missing here that
-- production has, that would indicate a drift that needs reconciliation.
CREATE TABLE IF NOT EXISTS decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Full decklist as plain text ("4 Ariel - On Human Legs\n4 …") —
  -- interoperable with external tools (Inkable, Dreamborn). Per-card
  -- enrichment lives in card_metadata; this stays vanilla.
  decklist_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Name is unique per-user so `upsert({ onConflict: "user_id,name" })`
  -- in deckApi.saveDeck() works idempotently.
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS deck_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  decklist_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS deck_versions_deck_idx ON deck_versions (deck_id, created_at DESC);

ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_versions ENABLE ROW LEVEL SECURITY;

-- Drop-first pattern for idempotency (CREATE POLICY doesn't support
-- IF NOT EXISTS). Safe on fresh or existing databases.
DROP POLICY IF EXISTS "Decks are owner-only" ON decks;
DROP POLICY IF EXISTS "Deck versions visible to deck owner" ON deck_versions;
DROP POLICY IF EXISTS "Deck versions insertable by deck owner" ON deck_versions;

-- Decks: full CRUD scoped to the owner via user_id.
CREATE POLICY "Decks are owner-only"
  ON decks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Deck versions: readable and insertable only by the deck's owner.
-- Reads are the common path (history viewer); inserts happen via
-- snapshotVersion() in deckApi.saveDeck / updateDeck.
CREATE POLICY "Deck versions visible to deck owner"
  ON deck_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_versions.deck_id
        AND decks.user_id = auth.uid()
    )
  );
CREATE POLICY "Deck versions insertable by deck owner"
  ON deck_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_versions.deck_id
        AND decks.user_id = auth.uid()
    )
  );

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

-- ── Clone-trainer data shape (game-level context) ──────────────────────────
-- Added 2026-04-22 after an audit of what training data needs to be
-- "in good form." The principle: game_actions stays strictly per-action
-- (state + action + who + when); all per-user + per-match context lives
-- on the aggregating rows. Prevents massive duplication across the
-- hundreds of actions in each match.

-- Game-level ELO snapshots. ELO only updates at match-end, so every action
-- in a single match has identical ELO — storing it per-row was ~60-180x
-- duplicated. Stamp once per game on creation. Nullable because older
-- pre-cleanup games won't have values (existing rows can stay as-is; MP
-- data pre-release is disposable anyway).
ALTER TABLE games ADD COLUMN IF NOT EXISTS p1_elo_at_start INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS p2_elo_at_start INTEGER;

-- Engine version stamp. The lorcana-sim engine evolves over time — new
-- cards, reducer fixes, trigger-order tweaks. An action recorded under
-- engine v1 may not apply cleanly through engine v2 (the action shape
-- might be unchanged, but the resulting state can diverge). Training
-- pipelines want to filter to "actions recorded under the same engine
-- version that will replay them" OR know when historical data needs
-- replaying through a snapshot build.
--
-- Format: YYYY-MM-DD[-N] per the ENGINE_VERSION constant in
-- packages/engine/src/version.ts. Nullable — populated going forward by
-- createNewGame; legacy rows stay null.
ALTER TABLE games ADD COLUMN IF NOT EXISTS engine_version TEXT;

-- Bot flag on profiles. No rows today — MP is strictly human-vs-human
-- (processAction requires requireAuth middleware with a real user
-- token). Future-proofs bot-vs-human queues: when a bot account lands,
-- flip its is_bot=true and clone-trainer exports can filter to
-- p1.is_bot = false AND p2.is_bot = false in a single join.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
-- Partial index — 99%+ of rows are humans; only bots get indexed. Small,
-- fast, and the filter condition `is_bot = false` can use the main heap scan.
CREATE INDEX IF NOT EXISTS profiles_is_bot_idx ON profiles (is_bot) WHERE is_bot = true;

-- ── GameEvent stream + decision metadata for clone-trainer post-analysis ───
-- Added 2026-04-25 per HANDOFF.md → "persist GameEvent stream + decision metadata".
--
-- Engine's `ActionResult.events` (cascade-attributed `card_moved`,
-- `damage_dealt`, `lore_gained`, `ability_triggered`, `card_revealed`,
-- `card_drawn`, `card_banished`, `turn_passed`, `hand_revealed`) used to be
-- transient — UI consumed them for the next render frame, then they were
-- garbage-collected. Persisting them gives downstream analysis three things
-- a state-diff can't reconstruct:
--   1. Cascade attribution (cause: "primary" | "trigger" | "replacement")
--      — distinguishes "user banished it" from "their on-banish trigger did".
--   2. Hidden-information reveals — `card_revealed` / `hand_revealed` carry
--      `privateTo` annotations so the trainer can audit "what did the bot
--      actually see at decision time" vs what the underlying state contained.
--   3. Effect granularity — `card_moved { from: "deck", to: "hand" }` is
--      ambiguous between "drew this card" / "tutored from deck" / "discarded
--      then returned"; the typed event chain disambiguates.
--
-- `legal_action_count` is denormalized "decision difficulty" — the cardinality
-- of `getAllLegalActions(state_before)` at decision time. Lets training
-- pipelines weight hard decisions more heavily, and analytics queries pull
-- "avg branching factor at turn N" without re-running the enumerator across
-- millions of historical state_before snapshots. Nullable: NULL means the
-- pre-action state had a `pendingChoice` (engine's getAllLegalActions
-- returns [] in that case — choice-value enumeration is context-dependent
-- and not yet captured here).
--
-- Storage: ~5-30 events per action × 50-200 actions per game = ~50-200KB
-- JSONB per game. Acceptable. Backfill not needed — DEFAULT '[]' makes
-- existing rows valid and historical games predate the trainer anyway.
ALTER TABLE game_actions ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]';
ALTER TABLE game_actions ADD COLUMN IF NOT EXISTS legal_action_count INTEGER;

-- Sanity invariant — run periodically post-deploy. After any MP play has
-- happened, this should return zero rows. A non-zero count means an emit
-- site in the engine is silently dropping events for a high-signal action
-- type (PLAY_CARD/QUEST/CHALLENGE always cause at least one card_moved or
-- damage_dealt or lore_gained). Replace the date with the post-deploy
-- cutoff so old pre-column rows (events='[]' default) don't false-positive.
--   SELECT id, action->>'type' AS atype, created_at
--   FROM game_actions
--   WHERE jsonb_array_length(events) = 0
--     AND action->>'type' IN ('PLAY_CARD', 'QUEST', 'CHALLENGE')
--     AND created_at > '2026-04-25'
--   ORDER BY created_at DESC LIMIT 100;
--
-- Companion check: legal_action_count NULL is normal for RESOLVE_CHOICE
-- (pendingChoice path), but should be non-null for PLAY_CARD / QUEST /
-- CHALLENGE / PLAY_INK / PASS_TURN / SHIFT.
--   SELECT id, action->>'type' AS atype
--   FROM game_actions
--   WHERE legal_action_count IS NULL
--     AND action->>'type' NOT IN ('RESOLVE_CHOICE')
--     AND created_at > '2026-04-25'
--   ORDER BY created_at DESC LIMIT 100;

-- ── Matchmaking ship (2026-04-27) ──────────────────────────────────────────
-- Casual + ranked matchmaking queues replace the previous Phase 3 sketch.
-- Three game types now share the games table, distinguished by match_source:
--   'private'    — host-code lobby OR public-browse lobby (always unranked,
--                  per anti-collusion: friends can't farm ELO via private games)
--   'queue'      — created by matchmaking pair-success (casual=unranked,
--                  ranked=ranked iff rotation.ranked=true)
--   'tournament' — reserved for the future tournament queue
--
-- See docs/HANDOFF.md → "Server agent: casual + ranked matchmaking queues"
-- for the full spec.

-- Decks lose format_rotation — rotation is now chosen per-game (private host
-- pick, queue request param), not per-deck. Decks carry only format_family.
-- decks.created_at remains the historical "when was this built" stamp;
-- legality drift is detected at lobby/queue join time against the live rotation.
ALTER TABLE decks DROP COLUMN IF EXISTS format_rotation;

-- Game-creation source + ranked flag. Default 'private'/false matches the
-- pre-Phase-3 behavior retroactively (we never went live with ELO, so no
-- historical ranked games exist — all existing rows are correctly unranked).
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS match_source TEXT NOT NULL DEFAULT 'private'
    CHECK (match_source IN ('private', 'queue', 'tournament')),
  ADD COLUMN IF NOT EXISTS ranked BOOLEAN NOT NULL DEFAULT FALSE;

-- Matchmaking queue. UNIQUE(user_id) is the hard concurrency guard — at most
-- one queue entry per user. Combined with the lobby-side check, a user can
-- never simultaneously occupy a waiting lobby AND a queue slot.
CREATE TABLE IF NOT EXISTS matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  format_family TEXT NOT NULL,
  format_rotation TEXT NOT NULL,
  match_format TEXT NOT NULL,            -- 'bo1' | 'bo3'
  queue_kind TEXT NOT NULL CHECK (queue_kind IN ('casual', 'ranked')),
  decklist JSONB NOT NULL,               -- DeckEntry[] — pulled into the games row on pair
  card_metadata JSONB,
  elo INTEGER,                           -- snapshotted at queue-join (ranked band-widening)
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pairing-query index. Covers both casual FIFO and ranked band-widening:
-- casual filters on the leading 4 columns + queue_kind + sorts by joined_at;
-- ranked filters on the same prefix + queue_kind + uses elo for the band check
-- (and joined_at as a tiebreaker / staleness driver).
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_lookup
  ON matchmaking_queue (format_family, format_rotation, match_format, queue_kind, joined_at);

ALTER TABLE matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- Users see only their own queue entry; service role bypasses RLS for
-- pairing reads. INSERT/DELETE happens through the API (service role) but
-- we keep an owner-INSERT policy for completeness and so a future
-- direct-from-client flow could work.
DROP POLICY IF EXISTS "Queue entry owner-only" ON matchmaking_queue;
CREATE POLICY "Queue entry owner-only"
  ON matchmaking_queue FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Realtime on the queue table — clients subscribe to their own user_id
-- entry and observe DELETE (pair-success) as a fallback signal that
-- pairing happened. Primary signal is the per-user broadcast channel
-- `matchmaking:user:<userId>` carrying a `pair_found` event with the
-- gameId payload. Belt-and-suspenders.
ALTER TABLE matchmaking_queue REPLICA IDENTITY FULL;

-- Optional pair-success column — reserved for a future variant of the
-- pairing flow that UPDATEs before DELETE so the OLD row in the DELETE
-- Realtime event carries the gameId. Currently unused; the broadcast
-- channel is the primary client signal. The status endpoint surfaces it
-- so it's safe to add and the field shape stays stable.
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS paired_game_id UUID;
