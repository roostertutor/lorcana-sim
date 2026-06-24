# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Last reorganized: 2026-05-11 (9 DONE items deleted, shareable replay entry condensed to follow-up gaps only).

## Runbook: new CRD revision arrives — diff snapshot & update tracker

**Trigger:** Ravensburger publishes a new Comprehensive Rules PDF (any agent
notices, or the user drops a new file into `docs/`).

**Owner:** any agent (engine-expert preferred since most rule changes affect
the engine layer; reducer.ts citations and `CONDITION_GATED_EFFECTS` are
common targets).

**Why this exists:** the CRD is a living document. Side-by-side PDF
comparison is unworkable for a 100+ page rulebook. We keep a committed
plain-text snapshot (`docs/CRD_SNAPSHOT.txt`) so revisions become a
line-level git diff. Pipeline shipped 2026-05-01 (commit `a769cd5`).

**Pieces (all in tree):**
- `scripts/snapshot-crd.ts` — converts the latest
  `docs/Disney-Lorcana-Comprehensive-Rules-*.pdf` to text via
  `pdftotext -layout`. Self-documenting header captures source PDF,
  detected version, effective date, snapshot timestamp, line count.
- `docs/CRD_SNAPSHOT.txt` — current snapshot of v2.0.1 (Effective Feb 5,
  2026), 2173 lines. Replaced wholesale on each revision.
- `docs/CRD_TRACKER.md` — top-of-file "Diffing a new CRD revision" section
  documents the workflow inline. The body of the tracker is the rule-by-rule
  status map; that's what gets updated based on the diff.
- `pnpm snapshot-crd` — package.json shortcut.

**Workflow when a new CRD drops:**

1. **Drop the new PDF** into `docs/` with the canonical filename pattern
   `Disney-Lorcana-Comprehensive-Rules-<MMDDYY>-EN-Edited.pdf`. The
   snapshot script picks the lexicographically-latest filename, so date-
   suffixed names sort correctly. Keep or delete the old PDF — either
   works.

2. **Regenerate the snapshot:**
   ```bash
   pnpm snapshot-crd
   ```
   Requires the `pdftotext` binary (Poppler / Glyph & Cog — included in
   mingw64; macOS: `brew install poppler`; Linux: `apt install
   poppler-utils`). The script prints version, effective date, line
   count, and the diff command on stdout.

3. **Review the diff:**
   ```bash
   git diff docs/CRD_SNAPSHOT.txt
   ```
   The `-layout` flag preserves columns/indentation, so section numbers
   and nested rule numbering stay aligned across revisions — every
   changed rule shows up as a line-level diff with its section context.
   Walk top-to-bottom and categorize each change:

   | Diff type | Action |
   |---|---|
   | New rule | Add a row to `CRD_TRACKER.md` under the right section |
   | Wording revision | Update the existing row's `Quote` column; re-evaluate `Status` if engine semantics may have shifted |
   | Status reclassification (errata) | Flip the engine row to `🐛` until reimplemented; ship a fix; flip back to `✅` |
   | Renumbering | Search `packages/engine/src/` for the old citation (e.g. `// CRD 8.9.1`), update to the new number |

4. **Update the version line** at the top of `CRD_TRACKER.md` (line 2):
   `# Disney Lorcana Comprehensive Rules v<NEW> (Effective <DATE>)`.
   If anything in `CLAUDE.md` → "Critical bug patterns" cites a moved
   rule number, update there too.

5. **Commit both** the new PDF and the regenerated snapshot together so
   the diff history shows the source-of-truth swap atomically. Suggested
   commit message format:
   ```
   chore(crd): snapshot v<NEW> (Effective <DATE>) + tracker updates

   Drops PDF → regenerated docs/CRD_SNAPSHOT.txt. Tracker changes:
   - <section X.Y>: <what changed>
   - ...
   ```

**Header lines** (prefixed with `#`) in CRD_SNAPSHOT.txt document
provenance; they produce a one-line diff if you re-snapshot the same PDF
on a new day. That's intentional — they let you read the snapshot
standalone. Use `git checkout docs/CRD_SNAPSHOT.txt` to discard a
spurious re-snapshot if the PDF didn't actually change.

**Sanity check after the swap:**
- `pnpm test` — engine tests should still pass (most rules don't have
  test coverage, but new bugs in renumbered citations would surface as
  test failures if a test referenced a moved rule by number).
- `grep -rn "CRD <OLD-NUMBER>" packages/engine/src/` — verify no stale
  citations to renumbered rules remain.

---

## Companion docs

| Doc | Purpose | When something belongs here vs HANDOFF |
|---|---|---|
| `docs/ROADMAP.md` | Committed sequenced product plan | "We're building this, in this order, for these reasons." |
| `docs/HANDOFF.md` *(this doc)* | Active cross-agent work queue | Another agent type needs to pick this up next. |
| `docs/BACKLOG.md` | Parked ideas / deferred design decisions | We considered it, didn't ship, have a trigger to revisit. No agent ownership yet. |

If the item has trigger conditions but no current agent owner → BACKLOG.
If a specific agent type is supposed to do it → HANDOFF.
If it's part of the sequenced plan → ROADMAP.

## Conventions

- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).
- Items marked `[DEFERRED]` for >2 weeks should probably move to BACKLOG.

---

## Engine agent: possible follow-up — expand resolveTargetAndApply coverage

The 2026-04-21 zone-move helper consolidation landed — `resolveTargetAndApply`
at `reducer.ts:~6620` now serves as the shared target-dispatch for `banish`,
`return_to_hand`, `put_into_inkwell` (chosen/all), and
`put_card_on_bottom_of_deck` (from:"play"). Future candidates for migration,
deferred for a follow-up session:

- **`shuffle_into_deck`** — target-dispatch shape matches, but needs a post-
  iteration shuffle step. Could extend `ResolveTargetAndApplyOptions` with a
  `postIterationHook?: (state, events) => state`. Worth doing when a third
  similar case appears so the hook isn't over-engineered for one user.
- **`discard_from_hand`** — has `chooser: "random" | "target_player"` modes
  and `amount: "all" | "any" | number` polymorphism that the helper's 4
  target-type branches don't cover cleanly. Likely best left bespoke.
- **`move_damage`** — two targets (source + destination instance) rather
  than one. Wouldn't fit the helper without a second target parameter.

None blocking. The helper already covers ~100 LOC of the hottest duplication.

---

## End-to-end multiplayer UX improvement plan (7 phases)

Planned with user 2026-04-22. Full detail in
`C:\Users\Ryan\.claude\plans\can-we-look-at-dapper-sunrise.md`. This
handoff entry summarizes the agent splits + sequencing so each phase can
be picked up without re-reading the full plan.

### Status snapshot — read this first

| Phase | Status | Next action |
|---|---|---|
| 1. Lobby polish + public browser + first-player banner | Server ✅, GUI ✅. | gameboard-specialist: first-player banner (prompt below in §Phase 1) |
| 2. Post-game polish (replay save, ELO delta, rematch w/ loser-picks-first) | DONE — Server ✅ (2026-04-22), Rematch UI ✅, Share UI ✅, ELO delta UI ✅ (2026-05-29), Replay-saved toast ✅ (2026-05-29). | — |
| 3. Matchmaking queue (user's two-account test target) | DONE — matchmakingService + `/matchmaking` route + 60s pairing poller; 25 tests; UI Quick Play (casual + ranked) wired. | — |
| 4. Reconnection + resume hardening | DONE — claim-win + lobby heartbeat + stale-lobby + tab-closed redirect (cd18f57); server match clock + disconnect grace (5baaa48 + 0bb5932); self-healing MP reconnect (ff06b51, 2026-06-24). | — |
| 5. Friends + rich presence | Open | Next open phase — server first (schema + endpoints), then GUI (spec below in §Phase 5) |
| 6. Emoji reactions (ephemeral) | Open | Can land independently of 5 |
| 7. Spectator mode (per-side fog-of-war) | Open; Phase 1 plumbing already shipped (`spectator_policy`) | After Phase 5 for friends-feed; public-games feed works without 5 |

**Status (2026-06-24):** Phases 1–4 fully shipped and DEPLOYED (Railway server +
Vercel UI, live). Remaining greenfield: Phase 5 (friends + presence), Phase 6
(emoji reactions), Phase 7 (spectator mode). Phase 5 is the next pick-up.

### Locked design decisions

1. **No pre-match screen.** Inline "You go first" / "Opponent goes first"
   banner appears on game load, auto-dismisses ~2s. Consistent for all Bo3
   games — no special ceremony for game 1.
2. **Rematch with loser-picks-first.** Same decks reused; loser of previous
   game picks play-or-draw, winner waits for their choice. 60s window.
3. **Emoji reactions are ephemeral** — Supabase Realtime broadcast, no DB.
   **Do NOT emit into `game_actions`** — that table feeds clone-trainer
   RL, polluting it with user reactions would contaminate training data.
4. **Friends: symmetric** (mutual accept, both parties in `friends` row).
5. **Spectators always anonymous** to players — count visible via badge,
   individual usernames never shown. No opt-in toggle, no scouting vectors.
6. **Both public-lobby browser AND ELO-banded matchmaking queue** — user
   wants to test queue with two accounts (main + incognito). Queue is
   Phase 3, not deferred.
7. **Rich presence**: `online` / `in_lobby` / `in_game` / `idle` states.

### Explicitly out of scope

- Free-form in-game chat.
- Omniscient spectator view (per-side fog-of-war only).
- Chess-clock / per-turn timers — flagged as a separate future planning
  session; Lorcana lacks a canonical clock spec so mechanics need their
  own design pass. Phase 4 (reconnection) adds a minimum viable 2-min
  opponent-dropout claim-win — NOT a real turn clock.

### Phase 1 — Lobby polish + public browser + first-player banner

DONE. Server ✅ (35061e1) + GUI ✅ (15db979 + a55b372) + first-player
banner ✅ (gameboard-specialist 2026-05-26). Banner fires once per
MP gameId when `state.firstPlayerId` populates after the
`choose_play_order` resolution; auto-dismisses after 2s; Bo3 games
2/3 carry a "Game N of 3 · myScore-oppScore · " prefix using the
new `gameNumber` field plumbed through `useGameSession`. Sandbox /
solo suppressed (gated on `multiplayerGame`).

### Phase 2 — Post-game polish

DONE (2026-05-29). All Phase 2 work shipped across server + GUI:
- Server ✅ (2026-04-22) — auto-saves a `replays` row on MP game-finish;
  public-or-player `GET /replay/:id` endpoint; player-only
  `PATCH /replay/:id/share` toggle; player-only `GET /replay/list`.
- Rematch UI ✅ — loser-picks-first, 60s window, client-side wired.
- Share UI ✅ — Share button + inline confirm + public-toggle + copy-link
  in the game-over modal; perspective toggle for replay viewer.
- ELO delta UI ✅ (2026-05-29) — game-over modal shows the delta.
- Replay-saved toast ✅ (2026-05-29) — passive green pill at top-of-screen
  on MP game-over showing `Replay saved — fb-{6char}`; tap copies the
  share URL → flashes "Link copied" → auto-dismisses; idempotent per
  gameId; MP-only. Wired inline in `GameBoard.tsx` against the existing
  `mpReplay` fetch (option A from the Phase 2 prompt — simpler than the
  originally-suggested `useGameSession` detection because the mpReplay
  effect already resolves with the needed metadata for the share button).
- `/replays` browse page ✅ — Decision #8 work, lives at `ReplaysPage.tsx`
  with `getMyReplays` paging.

### Phase 3 — Matchmaking queues (casual + ranked) + private-becomes-unranked + decks lose rotation stamp

> ✅ **SHIPPED (verified 2026-06-24).** matchmakingService + `/matchmaking` route +
> 60s pairing poller; 25 tests; UI Quick Play (casual + ranked) wired; deployed.
> The spec below is retained as historical reference for the locked design
> decisions, not as open work. Safe to delete on the next HANDOFF prune.

**Major revision 2026-04-27 — supersedes the prior Phase 3 spec.** Locked with user across a long planning conversation. See standalone HANDOFF entries below ("Server agent: casual + ranked matchmaking queues") for the full server spec; this section is the multi-phase index entry.

Coordinated ship across three agents — engine-expert lands first, then server-specialist, then GUI agent (me). All three pieces are required for the matchmaking experience to work:

**engine-expert** (already specced in the rotation-registry-refactor entry above):
- `RotationEntry.ranked: boolean` field + `isRankedFormat` helper
- Split `INFINITY_ALL_SETS` into per-rotation snapshots (s11 = sets 1-11, s12 = sets 1-12)
- Tests for rotation flag + Infinity legality

**server-specialist** (full spec in standalone entry below):
- DB migration: `decks.format_rotation` → drop entirely (decks now only carry `format_family`)
- DB migration: `games` gains `match_source` enum (`'private' | 'queue' | 'tournament'`) + `ranked` boolean
- New `matchmaking_queue` table + endpoints (`POST/GET/DELETE /matchmaking`)
- Format-bucketed pairing on `(family, rotation, match_format)` triple — strict, no cross-format ever
- Casual queue: FIFO within bucket
- Ranked queue: ELO band-widening (`±50 → ±150 → ±400 → unbounded` over 90s); only available for rotations where `ranked=true`
- Mandatory legality check on game creation against the chosen rotation
- Concurrency invariant: one queue OR one waiting-lobby per user (server-enforced)
- Rate limit: 10 queue-joins/hr per user
- `updateElo` no-ops when `game.ranked = false` (private + casual queue + staged-rotation games all skip ELO)
- Private lobbies always create games with `ranked = false` (anti-collusion)

**GUI agent (me)** — full spec in standalone entry below:
- Drop `format_rotation` from deck-related UI (DeckBuilderPage, MultiplayerLobby, FormatPicker)
- Lobby restructure: Quick Play (Find Casual + Find Ranked + Solo) | Custom Game (Host + Join + Browse)
- Format dropdowns (NOT toggles) on host + queue surfaces; option list filtered per surface (ranked queue only shows `ranked=true` rotations; others show all `offeredForNewDecks=true`)
- Queue-wait screens: timer + cancel; band-progression display for ranked; FIFO timer for casual
- Deckbuilder legality drift indicator: ⚠️ N cards illegal with click-to-expand + [Edit deck] / [Migrate to Infinity] / [Leave as-is]
- Realtime subscribe for pair-success → auto-redirect to `/game/:id`
- Removed: per-deck rotation picker (deckbuilder format picker simplifies to family-only)

User's test scenario: main account + incognito account, both click Find Casual on Core-s11 → both land in same `/game/:id` within ~3s of the second queue-join. Ranked-queue test scenario: same but click Find Ranked, ELO bands constrain matching, both land in same game.

Pre-launch (today through 2026-05-08): Find Ranked is hidden for Core-s12 / Infinity-s12 (those rotations are `ranked=false` while staged). Players testing set 12 use Find Casual or private lobbies.

Locked decisions (full list captured in standalone entries):
- Sequencing: ship engine + server + UI together (Y, not staged)
- Schema: `match_source` enum + `ranked` boolean (both on `games`)
- Concurrency: one queue OR waiting-lobby per user
- Per-format pairing: strict 3-tuple `(family, rotation, match_format)`
- Rate limit: 10/hr
- No cross-format pairing ever (use Infinity for max-population queues)
- Rotation lifecycle: 2 playable states (staged / live), retired = unplayable
- Decks: lose `format_rotation` column entirely; rotation chosen per-game
- UI labels (`Casual` vs `Competitive`): TBD post-implementation; database uses `casual_queue` / `ranked_queue` regardless

### Phase 5 — Friends + rich presence (greenfield, largest non-spectator)

Agent splits:
- **server agent**: `friends` table + RLS, `profiles.last_seen_at` +
  `current_activity` columns, heartbeat endpoint, friend request /
  accept / reject / unfriend endpoints, `GET /profile/search?q=username`
  prefix search, `POST /lobby/invite` with `invited_user_id` on lobby
  row.
- **GUI agent** (me): new `/friends` page (friend list with presence +
  activity + "Challenge" button), notification bell in app header
  (extend existing chrome), profile viewing page with "Add friend"
  affordance, invite-by-username flow in `MultiplayerLobby`.

Sequence: server first (schema + endpoints); UI follows. Heartbeat loop
wires into the presence column via `PATCH /profile/heartbeat` every 30s.

### Phase 6 — Emoji reactions (ephemeral)

Agent splits:
- **server agent**: rate-limit middleware on the reactions channel (10
  reactions/minute/user/game) — no table, no schema change. The
  broadcast itself is a Supabase Realtime channel the server can police.
- **GUI agent** (me): `EmojiPicker` component; wire emit via
  `useGameSession`'s existing Realtime channel. 12-emoji curated set.
  Client-side throttle 1 per 3s as UX guard.
- **gameboard-specialist**: render incoming reactions on the board
  (3s float + fade over sender's side). Reads broadcast events from the
  game channel.

Sequence: GUI + gameboard-specialist can develop in parallel against a
mock broadcast; server rate-limit added last if abuse shows up in testing.

### Phase 7 — Spectator mode (greenfield, largest overall)

Agent splits:
- **server agent**: `game_spectators` table, RLS extension on `games` +
  `game_actions` to allow spectator reads per `spectator_policy`, extend
  `stateFilter.ts` to `filterStateForSpectator(state, viewingAs)` with
  per-side fog-of-war, routes `POST/DELETE /game/:id/spectate` +
  `GET /games/watchable` (public + friends' games). **Anti-cheat
  invariant test required**: a spectator viewing game as player1 sees
  EXACTLY player1's filtered state, never aggregate.
- **gameboard-specialist**: GameBoard spectator-mode variant — no action
  buttons, "Spectating — viewing as {playerX}" banner, "Swap POV" button,
  leave button. Spectator count badge (`👁 N watching`) for players.
- **GUI agent** (me): new `/spectate` page with "Public games" +
  "Friends' games" sections; [Watch] button on public-lobby browser
  (from Phase 1); pre-game policy picker for private lobby creation
  (4 options: public / friends / invite_only / off).

Sequence: server first (filter + routes + RLS); gameboard-specialist +
GUI in parallel on the UI. Dependency on Phase 5 for friends' games
section only — public games section can ship without it.

### Future follow-up entries (not in this plan)

- **Chess-clock / per-turn timers** — needs dedicated planning session.
  Engine + server + UI. Discussion points: per-turn budget vs total match
  budget, pause conditions, timeout-loss rules, engine integration.
- **Replay highlight reels** — requires persisting emoji reactions with
  timestamps to a new `game_reactions` table (NOT `game_actions`). Only
  pursue if Phase 6 reactions become heavily used.
- **True MMR queue tuning** — Phase 3 ships the infrastructure; tuning
  band-widening curves, queue-depth display, region-based matching all
  live in a future phase once real usage data exists.

