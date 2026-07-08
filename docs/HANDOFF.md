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

## Engine agent: optional GameEvent additions for richer board animations (non-blocking)

The GameBoard game-feel animation pass (slice #1) shipped reading the existing
`ActionResult.events` stream (`packages/ui/src/components/AnimationLayer.tsx` +
`hooks/useCardPositions.tsx`, wired through `useGameSession.animationBatch`).
It covers play / ink / banish / draw / return / damage / lore / challenge with
the current `GameEvent` union (`types/index.ts:4490`). Two gaps are worked
around UI-side; closing them in the engine would let the UI drop the
workarounds and improve fidelity:

- **No `quest` event.** Lore-gain is animated off `lore_gained`, which fires
  for quest AND for any lore effect (Develop Your Brain, etc.). Fine today —
  the burst is generic. A dedicated `quested { instanceId, playerId, amount }`
  would let the UI exert-and-lunge the quester specifically. Low priority.
- **No `card_exerted` / `card_readied` event.** The smooth exert↔ready rotate
  is handled purely by the existing CSS transition on `GameCard` (no event
  needed), so this is only relevant if a future animation wants to key off the
  exact exert moment (e.g. a tap "shimmer"). Not needed now.
- **Normal turn-draw** (`reducer.ts:~2236`) emits `card_drawn` but not
  `card_moved deck→hand` (it uses `moveCard`, not `zoneTransition`). The UI
  animates draws off `card_drawn` specifically *because* of this asymmetry, so
  it works — but if `card_drawn` semantics ever change, re-check the draw
  flight in AnimationLayer's `card_drawn` handler.

None blocking — the animation layer is complete with today's events. File only
if a future slice wants quest-specific or exert-specific motion.

---

## UI/gameboard agent: multi-target shift picker for Combo Shift (Set 13)

**Trigger:** sandbox users try to Combo-Shift a Set 13 "&" card (Sulley & Boo
`#29`, Dash & Violet `#133/#241`) onto **two** bases at once.

**What shipped (engine, commit `fd37e33`):** Combo Shift is fully implemented
and tested headlessly. The two-target action shape is
`PlayCardAction.shiftTargetInstanceIds: [idA, idB]` (one matching each combo
name). `getAllLegalActions` already enumerates the valid one-of-each pairs, so
the bot/sim play it today. The single-target case (shift onto just a Sulley
*or* just a Boo) uses the existing `shiftTargetInstanceId` and **already works
in the current shift picker** with no UI change.

**The gap (UI only):** the sandbox shift-target picker assumes a single target.
For the "one of each" case the player must be able to pick **two** bases before
committing the play. Needed:
- After the shift card is chosen, if its shift keyword has `variant: "combo"`,
  offer both the single-target targets (existing) **and** the two-target combos
  (pick one base per name). Simplest: let the user click two valid bases, then
  dispatch `PLAY_CARD` with `shiftTargetInstanceIds`.
- Read the valid names from the keyword's `shiftNames` (e.g. `["Sulley","Boo"]`)
  to label/group the picker.
- No new `PendingChoice` variant is involved — this is action *construction* in
  the sandbox before dispatch, same layer as the existing shift picker.

**Not blocking** engine/sim/bot work. Only affects interactive sandbox play of
these three cards' two-target mode.

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
| 1. Lobby polish + public browser + first-player banner | DONE — Server ✅, GUI ✅, first-player banner ✅ (2026-05-26). | — |
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

**Phases 1–4 pruned (shipped + deployed).** Their implementation detail lives
in git history and the reconciliation commit (`1b732ec`, 2026-06-24); the
status snapshot table above is the surviving index. Open work starts at
Phase 5.

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


---

## Clone bot `--from-db` — wire a player game-log export (server-specialist)

**Trigger:** ROADMAP Stream 5b/5c landed the supervised clone trainer + the
`pnpm profile-player` CLI. `--logs` (local JSON files) works end-to-end. The
`--from-db` path is stubbed: it reads from an EXPORTED JSON dump file
(`--db-export <file.json>`), not a live Supabase query — the CLI imports
`analytics` only and cannot reach the DB (package boundary).

**Owner:** server-specialist.

**What's needed:** a server-side export that writes one player's recent
`game_actions` rows to JSON for the CLI to consume. The CLI normalizer already
accepts the raw `game_actions` row shape (`{ action, state_before,
legal_action_count? }`) and derives `legal_action_count` from `state_before`
via `getAllLegalActions` when the column is absent — so the export does NOT need
to compute legality. See `packages/cli/src/loadCloneSamples.ts` and
`packages/cli/src/cloneDbSource.ts` (`loadDbCloneSamples` is the seam).

**Concrete shape to produce** (array of rows, chronological order):
```json
[ { "action": <GameAction>, "state_before": <GameState>, "game_id": "...",
    "player_id": "...", "turn_number": 12 }, ... ]
```
Source table: `game_actions` (server/src/db/schema.sql:41-50), filtered by the
player (`player_id`) and limited to their N most recent games.

**Two acceptable delivery mechanisms:**
1. An `export` endpoint/route that returns the JSON; the CLI (or user) curls it
   to a file and passes `--db-export <file>`. Simplest.
2. A CLI-invoked script in `/server` that dumps to a file. Keeps the boundary
   clean (DB access stays server-side).

**Known approximation to fix when wiring:** `cloneDbSource.ts` currently caps
`--games N` as `rows.slice(-N*120)` (≈120 decisions/game) because post-
normalization rows aren't grouped by `game_id`. The server export should group
by `game_id` and take the N most recent games so `--games` is exact. Pass the
already-capped rows and the CLI cap becomes a no-op.

**Note:** `game_actions` has NO `legal_action_count` column today. If you want
the trainer to weight/skip forced turns using the count the *server* saw (vs
recomputing), add the column at write time (`gameService.ts:401-410`,
`getAllLegalActions(...).length`). Optional — the CLI recomputes it either way.
