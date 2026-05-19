# Diff — Offline Brainstorm vs Current Codebase

> **Purpose:** The companion doc `lorcana-sim-handoff.md` is the output of a
> clean-room Claude session with **no codebase context** — a "fresh pair of
> eyes" sketch of what a competitive Lorcana sim *should* look like. This doc
> diffs that sketch against what we actually built, and sorts every meaningful
> divergence into four buckets:
>
> 1. **BOTH** — they recommend, we have. Validation, low-information.
> 2. **GAP** — they recommend, we lack. Real candidates for BACKLOG/ROADMAP.
> 3. **EXTRA** — we have, they didn't think of. Either real local discovery
>    worth defending, or scope creep, or so obvious they assumed it.
> 4. **DRIFT** — they explicitly listed as non-goal, we built / are building.
>    Highest-signal bucket — the clean-room view sees scope creep we can't see
>    from inside.
>
> Date: 2026-05-15. Source doc: `lorcana-sim-handoff.md`.

---

## Bucket 1 — BOTH (validation, scan-only)

Items in the brainstorm that match what we shipped. Listed for completeness; no
decisions needed.

**T0 — Foundation:**
- Headless, deterministic engine — `packages/engine/src/engine/reducer.ts`,
  seeded RNG with clone-on-apply (`undo-rng-isolation.test.ts`), 662 tests.
- Card effect system — ~80 primitives (per `pnpm catalog`), data-driven via
  card JSON, composition combinators (`sequential`, `choose`,
  `conditional_effect`, `each_player`, `each_target`, `self_replacement`,
  `create_floating_trigger`).
- Server-authoritative — `server/src/services/gameService.ts` runs `applyAction`,
  `filterStateForPlayer` applied per fetch (`gameService.ts:979,1022`), RNG
  server-side on `GameState`.
- Card data model (core) — inks, costs, types, classifications, structured
  abilities, format-legality via separate registry. `imageUrl` decoupled from
  gameplay logic.
- Format-as-data (partial) — `RotationEntry` registry in
  `packages/engine/src/formats/legality.ts:44-62`. Set list + banlist are data,
  not hardcoded.
- Auth + accounts (core) — Supabase profiles, username (immutable) +
  display_name (mutable) post `f18fd6e`.

**T1 — v1 launch:**
- Full rules enforcement, 2896/2896 cards wired.
- 1v1 networked play (server-authoritative).
- Core Constructed format (Core + Infinity, per-rotation).
- Mobile-friendly responsive UX — 7 screens, mobile/tablet/desktop breakpoints.
- Game log (UI surface + `ActionResult.events` stream).
- Concede + private match via invite code — lobby + share-link entry
  (`/lobby/:code`) per `54ea444`.
- Basic profile + W/L stats — `MePage.tsx`.
- Multiplayer reconnection (page-refresh model) — `GET /game/:id` rehydrates
  full state via `filterStateForPlayer`.

**T2 — competitive credibility:**
- Per-format ELO (bo1/bo3 × core/infinity) — server-side, anti-cheat-aware.
- Matchmaking queues (casual + ranked) — shipped 2026-04-27..2026-05-04
  (`matchmakingService.ts`, `routes/matchmaking.ts`, `MultiplayerLobby.tsx`).
- New-set pipeline — `import-cards` runbook documents 48-hour-or-better
  turnaround (set 12 wired same window as Ravensburger reveal).
- Infinity format support — yes, alongside Core.

**T4 — advanced/speculative (we already shipped):**
- RL training pipeline — Actor-Critic + GAE, `pnpm learn`, see `docs/RL.md`.
  Doc puts this at T4 ("earn the right via T1-T3"). For us it was T0.
- Headless engine runs thousands of games/sec/core — confirmed via simulator
  package, drives analytics queries and RL training.

---

## Bucket 2 — GAP (they recommend, we lack)

Real candidates. Each one needs a decision: ship soon, BACKLOG with trigger,
or explicitly reject.

### T0-level gaps (foundation — cheap to decide now, expensive to retrofit)

| Item | Current state | Recommendation |
|---|---|---|
| **Persisted event stream** | `ActionResult.events` exists in engine (`types/index.ts:4400-4410`: card_moved, damage_dealt, lore_gained, hand_revealed, …) but treated as ephemeral UI signal. Server only persists `state_before`/`state_after`/`action` per row (`schema.sql:41-50`). Replays reconstruct by re-running actions from seed (`gameService.ts:1283+`). | One-column add: `events JSONB` on `game_actions`. Unblocks T2 key-moment auto-tagging without rescanning state diffs. Decide before too many ranked games accumulate. |
| **Errata versioning on card definitions** | No `erratum_version` field. Single canonical CardDefinition per card. Old replays resolve against current rules, not rules-at-game-time. | BACKLOG with trigger "first errata that meaningfully changes card behavior." Architecture call worth making cheap now: stamp every replay with a card-data version hash. |
| ~~**Deck size as format-data**~~ | ✅ Resolved 2026-05-18. The diff doc's premise was wrong: there was no `validateDeck` function — engine + server enforced per-card legality only and the "60" was a soft UI nudge. A 45-card deck could queue into ranked. Fix shipped `deckSize: number` on `RotationEntry` (all four rotations = 60) + new `wrong_count` issue in `isLegalFor`. Limited rotations override the field when they ship. |
| **Per-user art override path** | `imageUrl` is a single field on each definition. R2 CDN swap pipeline exists. No per-user override, no `user → official → text-only` fallback chain. | Status: architectural readiness ✅, no user-facing plumbing. Brainstorm calls this a <1-week activation; for us it's ~1-2 weeks once we decide the model (per-user setting vs global kill-switch). Defer until first IP signal. |
| **OAuth** | Email/password only. CLAUDE.md status explicitly lists "OAuth" as remaining. | Already in ROADMAP / status. Pair with Railway deploy. |

### T1-level gaps (v1 launch — missing pieces)

| Item | Current state | Recommendation |
|---|---|---|
| **Turn timer / chess clock** | Grep `chess.?clock\|turn.?timer\|timeBank\|time_bank`: 0 hits. Not implemented. | Required for ranked play. ROADMAP candidate. The brainstorm suggests 25-min bank + 75s per turn. |
| **Deck import from Dreamborn / Inkdecks** | Paste-mode was *removed* in `9ff1348 refactor(ui): remove paste-mode workflow from lobby; saved decks only`. We currently have zero text-import path. | Brainstorm differentiation point #8: "One-click deck import from Dreamborn/Inkdecks — friction kills adoption." Worth re-adding as a deckbuilder feature (separate from lobby flow we deleted). |
| **Reconnect with hold-window + opponent countdown** | We have page-refresh reconnect (just re-fetches via `GET /game/:id`). No grace-period UI, no "opponent disconnected, holding for 2 min" surface, no automatic concede on timeout. | Real UX gap for ranked play. T1-equivalent. |
| **Predefined emote chat** | No chat surface at all. | Brainstorm says predefined-only, ~10-20 phrases, rate-limited. We have zero. Reasonable to defer (matches our content-creation-first orientation), but it's an ergonomic floor for competitive play. |
| **Friends list (mutual)** | Not in schema. `matchmakingService.ts` is matchmaking-only; no `friends` table. | BACKLOG. The doc's Phase 5 of MP UX already has this. |
| **Block list** | Not in schema. | BACKLOG, lower priority than friends but cheap. |
| **Bug report flow with replay attached** | No `bug_reports` table, no UI entry point. | Easy win: button on game board → POST with current `replay_id` + free-text. The replay infra is already there. |
| **Username profanity filter + protected reservations** | No filter, no reservation list. Display-name field has only length constraint (1-32 chars). | Low risk today (user base small), but **the moment** the user base grows. BACKLOG with trigger "first impersonation report" or "first 1000 users." |
| **Per-action rate limits** | Auth-bearer throttling exists. Per-action limit (e.g. spam-click on a draw) not present. | Likely needed before opening up matchmaking widely. |
| **Queue-dodge rate limits** | No history on join/cancel patterns. `matchmakingService.ts` has 10 joins/hr but doesn't track dodge ratio. | BACKLOG. |

### T2-level gaps (competitive credibility)

| Item | Current state | Recommendation |
|---|---|---|
| **Seasons** | ELO exists, but no `seasons` table, no season reset, no titles. | BACKLOG with trigger "ladder population sustains weekly ranked games for 4+ weeks." |
| **Placement matches + accelerated MMR for high-WR accounts** | No placement logic. Every new account starts at the default ELO. | BACKLOG with trigger same as seasons. |
| **Replay viewer scrub / branching** | Replay playback exists (sandbox + remote replays). No scrub bar, no key-moment tags, no branching ("what if I'd played X"). | High-leverage T2 — competitive players live in this. Branching is especially differentiated; only possible because of our deterministic engine + undo support. |
| **Public replay browser** | Replay sharing via link exists. Browser surface does not. | BACKLOG; the share-link model already covers 80%. |
| **Spectator mode** | `spectator_policy` enum on lobbies in `schema.sql:116-120` (off/invite_only/friends/public), but no implementation. `useReplaySession.ts:38` references "Spectator (full info)" as a perspective toggle in replay; live spectate is not wired. | Schema-ready, plumbing-pending. Phase 7 of MP UX plan. |
| **Meta dashboard** | Analytics CLI exists internally (`pnpm query`). No user-facing dashboard. | Brainstorm differentiation point #4. Worth a ROADMAP slot — turns our internal analytics moat into a public-facing wedge. |
| **Streamer/OBS mode** | Not implemented. | Defer; valuable when we have streamers. |
| **Push notifications** | Not implemented. | Defer; "nice-to-have, low priority" per doc. |
| **Cross-device session handoff** | Not really — login on each device works, but no "match in progress on phone, finish on laptop" handover. | Possibly free given our server-authoritative model (state lives on server, any authenticated client can resume). Worth verifying. |

### T3-level gaps (platform features)

All open. None urgent. Listed for completeness:
- In-app tournament tooling (Swiss / single-elim / judge tools)
- Teams / guilds
- Patreon integration + cosmetic shop
- In-game currency (cosmetic-only)
- Tournament history / trophy room
- Internationalization (EN-first today; FR/DE/IT/JP per Lorcana market)
- Accessibility pass (colorblind ink indicators, text scaling, screen reader,
  reduced motion)

### T4-level gaps

- **Limited formats** (Sealed, Booster Draft, Pack Rush, Phantom Draft) — already
  in BACKLOG per `790ba97`. Blocked on format-as-data deck-size extension above.
- **AI opponent powered by RL** — RL training exists; "AI opponent in casual"
  product surface does not. We have a bot opponent in sandbox, but it's not
  exposed as a ranked-or-casual queue option. Likely closer than the brainstorm
  thinks given how much of the substrate we have.
- **Solver-style position evaluation** — interesting; would require a learned
  value head we don't currently expose to UI.
- **Public dataset release** — depends on opt-out telemetry we don't yet collect.
- **Public API for third-party tools** — depends on stable schemas.

---

## Bucket 3 — EXTRA (we have, they didn't think of)

The "scar tissue" or "local discovery" bucket. Each item earned its place via
something that went wrong, or via our specific strategic orientation. Worth
defending.

### Engine-correctness machinery
- **Audit tooling suite** — `pnpm card-status`, `pnpm decompile-cards`,
  `pnpm find-precedent`, `pnpm catalog`. The brainstorm assumes
  test-coverage-on-triggers is sufficient. We learned that **handler existence
  is not correctness** (per `CLAUDE.md` Rule of the Same Name), and the audit
  scripts catch silent field typos, fidelity violations, and discriminator
  mismatches that tests don't.
- **Structural fidelity rule** — "one printed ability = one JSON ability,"
  enforced by `pnpm card-status --category fidelity-violation`. Prevents the
  `oncePerTurn` budget-doubling class of bugs. The brainstorm doesn't anticipate
  this class.
- **Card-claim discipline** (`file:line` citations) — confabulation-prevention
  habit; orthogonal to engine architecture but load-bearing for working with
  the codebase via AI agents.
- **Card data source hierarchy** (`ravensburger > lorcast > manual`) — multi-tier
  importer with `_source` tag + `_sourceLock`. Brainstorm assumes one data
  source. We learned the hard way that Ravensburger's API has transcription
  errors that need to be locked against re-imports.

### Tooling that runs adjacent to the engine
- **Headless simulator + RL training pipeline** — the brainstorm puts this at T4.
  For us this is **T0 infrastructure**: the only way to validate 2896 cards is
  by running millions of games. The engine *is* the product (their Principle 1),
  and our simulator is how we prove the engine works at scale.
- **Analytics CLI** (`analyze`, `compare`, `query`, `learn`) — internal-only
  today. Brainstorm imagines this only as a user-facing meta dashboard (T2).
  Ours is dev-internal first, public-facing later.
- **Sandbox-as-creator-tool** — the brainstorm has no analog. This is our
  strategic orientation: solo dev → creator-tool flywheel → clone-trainer →
  better RL → better engine validation. See
  `project_strategic_direction` in agent memory.

### Operational discipline that emerged from bug-fix postmortems
- **Bug-fix workflow = test + audit improvement together** — every engine bug
  fix ships a regression test AND adds something to the audit suite. Turns
  one-off fixes into class-wide sweeps.
- **Test organization conventions** (`reducer.test.ts` for CRD, `setN.test.ts`
  for per-set, `mech-gaps-batch.test.ts` for cross-cutting).
- **`docs/CRD_TRACKER.md`** — every game rule mapped to engine implementation.
  Brainstorm mentions "CRD" once in passing; we treat it as the spec of record.

### UX/architectural decisions the brainstorm wouldn't have invented
- **Bo1/Bo3 match format + per-format ELO** — granular than the brainstorm's
  single ladder. Already shipped end-to-end.
- **Middle-screen lobby** (Duels-style) — we converged on this after the
  public-browser detour (see Bucket 4 below).
- **Per-rotation registry with `offeredForNewDecks` + `ranked` flags** — the
  brainstorm has format-as-data but not staged-rotation-lifecycle-as-data. Ours
  handles pre-release windows (Set 12 was playable but unranked for ~3 weeks
  before the rotation flip).

---

## Bucket 4 — DRIFT (they explicitly don't want, we built / are building)

The most important bucket. Each entry is a place where the clean-room view
sees scope creep that we can't easily see from inside. Some of these are
correct local decisions; some are genuine drift.

| Brainstorm non-goal | What we did | Verdict |
|---|---|---|
| **Public lobby browser** ("Scrim/private match via invite code covers 80%") | Shipped a public-lobby browser then *removed* it: `f16f2a3 refactor(ui): drop public-lobby browser`. Replaced with middle-screen lobby + matchmaking queue. | ✅ **Already course-corrected.** The fresh-eyes view would have skipped the detour. This is precisely the kind of thing this audit should catch *earlier* next time. |
| **Hot-seat single-device mode** | Sandbox vs bot exists. Not strictly hot-seat (it's solo-vs-AI), but the affordance is there. | ✅ Aligned. We have solo-vs-bot for testing/creator use; we don't have human-vs-human-on-one-device. |
| **Free-text chat in matches** | None implemented. | ✅ Aligned. |
| **In-app DMs between users** | None. | ✅ Aligned. |
| **Deck database / community sharing platform** | We have local deck save + version history (`deck_versions` table). No public deck-sharing browser. Strategy-analyst agent has a "deck sharing" backlog item to consider. | 🟡 **Watch this one.** Strategy agent has parked items in this space. If those get picked up, double-check we're not building a Dreamborn competitor. |
| **Best-in-class deckbuilder** | Deckbuilder exists, functional, mobile-responsive. Not flagship-quality. | ✅ Aligned. |
| **Real-money prize tournaments** | None. | ✅ Aligned. |
| **Loot boxes / randomized monetization** | None. | ✅ Aligned. |
| **Ads** | None. | ✅ Aligned. |
| **Pay-to-win / pay-to-grind-skip** | None. | ✅ Aligned. |
| **Cards gated behind grinding/purchase** | All cards free. | ✅ Aligned. |
| **Collection management** | None. | ✅ Aligned. |
| **Selling user data** | None. | ✅ Aligned. |
| **Native iOS/Android apps in v1** | Mobile web (PWA-shaped) only. | ✅ Aligned. |
| **AI opponent at launch** | We have sandbox bot, not exposed as a matchmaking option. RL training exists. | 🟡 **Soft drift.** The brainstorm says "T4 feature, earn the right." We have the substrate already. Decision: do we surface AI-as-casual-opponent before T2 ladder credibility is established, or hold? The brainstorm's worry is splitting solo-dev attention; ours is that the substrate is already paid for. |
| **Limited formats at launch** | Not implemented. BACKLOG entry exists. | ✅ Aligned. |
| **Social feed / activity stream** | None. | ✅ Aligned. |
| **Best chat experience** | None. | ✅ Aligned. |

---

## Decisions to make from this diff

Roughly in priority order. Each is a small enough call to make in one
conversation.

### Progress log

- **2026-05-16** — Decision #1 (persisted event stream) → **Defer (B)**. BACKLOG
  entry filed under Data / DB. Adjacent follow-up filed: move `formatAction`
  out of `packages/ui/` whenever a non-UI consumer needs pretty action labels.
- **2026-05-18** — Decision #2 (errata versioning / card-data version hash) →
  **B′ — defer-with-trigger, but tighten existing stamp's policy**. Discovered
  we already had `ENGINE_VERSION` stamping (`packages/engine/src/version.ts:31`,
  `games.engine_version` column, `gameService.ts:140`) — added 2026-04-22 for
  clone-trainer filtering. The original framing ("stamp card-data version") was
  fictional because the *engine* itself drifts on replay too, so a card-data
  stamp without engine-routing machinery doesn't fix replay correctness — and
  the engine-routing machinery is the expensive part regardless of what
  triggers it. Resolution: widened the engine_version bump policy to cover
  errata (one stamp serves both engine + card-data drift); filed the
  expensive-later resolver work as BACKLOG entry `Historical engine + card-data
  resolution for replays` under Data / DB, with triggers (first errata, first
  dispute, card-history surface). No new column; no new architecture today.
- **2026-05-18** — Decision #4 (chess clock / turn timer) → **A (full clock)**, Phase 1
  shipped. Investigation found engine is clock-free by design (server is sole
  authority), no reconnect/heartbeat plumbing existed, bo1/bo3 was a flat enum
  (no config registry). Phase 1 (server substrate): new `matchClock.ts` module with
  `applyActionTick` / `applyHeartbeat` / `detectDisconnect` / `checkTimeout` /
  `checkGraceExhausted` / `projectClockForDisplay` (pure functions, 24 unit tests
  including explicit Sudden Chill round-trip — user-flagged case where opponent's
  clock ticks during my turn for their forced discard). Schema additions: 11 new
  columns on `games` for time banks, grace, heartbeats, disconnect timestamps,
  match_format, outcome_reason. `gameService.ts` wires the clock around
  `processAction` (decrement old decision player, Fischer increment on turn flip,
  re-anchor activePlayerSince), lazy timeout/grace check on `getGame` and
  pre-action in `processAction`, new `recordHeartbeat` + `projectClockForRow`
  helpers. New `POST /game/:id/heartbeat` route. Threaded `matchFormat` through
  all four `createNewGame` callsites (lobby first-game, lobby rematch, bo3
  game-2/3, queue pair). 130/130 server tests pass. Phase 2 (UI) handed off:
  gameboard-specialist for in-game clock components / disconnect overlay /
  low-time warning / heartbeat client wiring, ui-specialist for pre-game lobby
  clock info + history-page outcome labels. Both handoff entries filed in
  `docs/HANDOFF.md`.
- **2026-05-19** — Decision #7 (bug-report flow with replay attached) → **A
  (full Phase 1 MVP)**, shipped end-to-end. Discovered the system was already
  designed in detail (HANDOFF entry from 2026-04-21, locked with user) — just
  unbuilt. Built per the existing spec: server-side `feedbackService.ts` +
  `feedback` table (anonymous-allowed, type enum with 7 buckets, length-bounded
  validation, rate-limit 10/hr authenticated / 3/hr anonymous via IP /24
  prefix, optional Discord webhook env-gated), `POST /feedback` route (optional
  auth — invalid tokens silently fall back to anonymous rather than blocking
  bug reports), 26 unit tests covering ipToPrefix / validation / rate limit /
  end-to-end submit with supabase double. Phase 2 UI handed off to
  ui-specialist: `feedbackApi.ts` + `feedbackContext.tsx` provider +
  `FeedbackModal.tsx` form (with "What we'll send" privacy-forward disclosure)
  + `FeedbackButton.tsx` (variants: fab/inline/icon/menuItem) + footer trigger
  in App.tsx + "Report issue with this card" in CardInspectModal with
  auto-injected `{ cardId, fullName }` context. 156/156 server tests pass.
  Brainstorm's narrow "bug report with replay attached" framing is a subset —
  gameboard trigger with `{ replay_id, seed, turnNumber }` injection is the
  Phase 2+ gameboard-specialist follow-up, captured in HANDOFF.
- **2026-05-19** — Decision #6 (deck text-import re-add) → **A (already
  shipped)**. Discovered the deckbuilder already has a full paste-decklist
  Import modal (`packages/ui/src/components/DeckBuilder.tsx:188-200,497-527`)
  using the engine's `parseDecklist` — the `9ff1348` commit that "removed
  paste mode" only removed it from the LOBBY, leaving the deckbuilder's
  import textarea intact (commit message: "DeckBuilder owns deck import").
  Engine already normalizes curly/straight quotes, supports `4x Card Name`
  syntax, surfaces per-line parse errors. Brainstorm's "one-click deck
  import from Dreamborn/Inkdecks" is a subset — the functional ask is met
  for any tool exporting plain `4 Card Name` format. URL-fetch one-click
  import (paste a Dreamborn URL) is a future polish, BACKLOG-shaped not
  ship-now.
- **2026-05-18** — Decision #3 (`deckSize` on `RotationEntry`) → **A**, shipped.
  Discovered the diff doc's premise was wrong: no `validateDeck` function ever
  existed, and engine + server enforced per-card legality only — deck size was
  a soft UI nudge in the deckbuilder. A 45-card deck could queue into ranked.
  User clarified that deck size genuinely varies by format (Constructed = 60,
  Limited = 35-40), so hardcoding 60 was wrong and parametrization was right.
  Shipped `deckSize: number` on `RotationEntry` (all four current rotations =
  60), `"wrong_count"` added to `LegalityIssue.reason` union, count check in
  `isLegalFor` emits one deck-wide issue alongside per-card issues (no
  early-exit so UI surfaces everything in one pass). Tests: 9 new (4 engine
  edge cases including overshoot/undershoot/empty/multi-issue + 1 server
  rejection test + 4 padding fixups for existing per-card tests). All 1003
  tests pass.

### T0-level decisions (architectural — cheap now, expensive later)
1. ~~**Persist `events JSONB` on `game_actions`?**~~ ✅ Defer with trigger
   (BACKLOG entry `Persisted event stream on game_actions`, 2026-05-16).
2. ~~**Stamp replays with card-data version hash?**~~ ✅ Resolved by widening
   the existing `ENGINE_VERSION` bump policy to cover errata + filing
   historical-replay-resolver work as BACKLOG entry `Historical engine +
   card-data resolution for replays`, 2026-05-18.
3. ~~**Add `deckSize` to `RotationEntry`?**~~ ✅ Shipped (option A), 2026-05-18.
   `deckSize: number` on every `RotationEntry`, count check in `isLegalFor`
   emits `wrong_count` deck-wide issue. Closes the ranked-correctness gap
   (45-card deck could previously queue) and preps for Limited.

### T1-level decisions (v1-floor — what blocks calling v1 done?)
4. ~~**Chess clock / turn timer**~~ ✅ Shipped end-to-end (Phase 1 server +
   Phase 2 UI), 2026-05-18/19. Engine stays clock-free; new `matchClock.ts`
   service implements Fischer-increment + disconnect-grace state machine.
   Schema + `gameService` integration + heartbeat route + UI components
   (MatchClock, DisconnectOverlay, heartbeat client wiring, pre-game lobby
   info, history outcome labels) all landed. 24 clock unit tests + 130/130
   server tests pass. Decision #5 (reconnect grace UI) absorbed.
5. ~~**Reconnect grace-window UI**~~ ✅ Shipped as part of #4 — disconnect
   overlay, grace countdown, heartbeat wiring all in the same rollout.
6. ~~**Deck text-import re-add**~~ ✅ Already shipped — the deckbuilder's
   paste-decklist modal was preserved through the lobby cleanup; engine's
   `parseDecklist` handles the format. URL-fetch one-click import deferred.
7. ~~**Bug-report flow with replay attached**~~ ✅ Shipped end-to-end as the
   full Phase 1 MVP per the 2026-04-21 design (server `feedback` table +
   POST /feedback + UI provider/modal/button + footer trigger + card-issue
   trigger in CardInspectModal). Gameboard-trigger with replay context is
   Phase 2+ follow-up captured in HANDOFF.

### T1-level decisions (v1-floor — what blocks calling v1 done?)
4. **Chess clock / turn timer** — required for ranked credibility. ROADMAP slot?
5. **Reconnect grace-window UI** — required for any serious ranked play. Cheap
   to build given our server-authoritative model.
6. **Deck text-import (Dreamborn/Inkdecks compatibility)** — re-add the paste
   workflow that was removed in `9ff1348`? Brainstorm calls this a top-10
   differentiation point.
7. **Bug report flow with replay attached** — easy win, high trust signal.

### T2-level decisions (competitive credibility — sequencing)
8. **Replay viewer scrub + branching** — highest-leverage T2 feature, only
   possible because of our deterministic engine. Sequence vs meta dashboard.
9. **Meta dashboard (user-facing)** — convert internal analytics CLI into public
   wedge. Sequence vs replay viewer.
10. **Seasons + placement matches** — defer until ladder population justifies
    it; agree on trigger condition.

### Drift to actively monitor
11. **Deck-sharing platform creep** — strategy-analyst agent has BACKLOG items
    here. Check next time those come up that we're not accidentally competing
    with Dreamborn.
12. **AI opponent surfacing** — substrate is ready. Do we wait for T2 ranked
    credibility (brainstorm's view) or ship it earlier because it's mostly
    free? Strategic call.

---

## How to use this doc

- When discussing **what to build next**, scan Bucket 2 (GAP) for items with
  triggers met, and Bucket 4 (DRIFT) for "are we sure we want this" sanity
  checks.
- When discussing **how to validate engine correctness**, Bucket 3 (EXTRA)
  is the inventory of what already protects us.
- When **another fresh-eyes session** happens (next planning offsite, next
  outside-collaborator brief), regenerate this diff. The buckets are what
  reveal where lived experience diverges from "what a smart person would
  recommend not knowing what we've learned."

**Trigger to refresh this diff:**
- New offline-session brainstorm doc lands.
- A Bucket 2 GAP item ships (move it to BOTH).
- A Bucket 4 DRIFT item is intentionally adopted (move it to EXTRA with
  rationale) or pruned (mark resolved).
- 6 months elapse with no refresh and we're trying to plan the next 6.

---

## Where we left off (pickup notes)

**Last session (2026-05-19):** swept through Decisions #4 Phase 2, #6, and #7
end-to-end. Decision #4 Phase 2 dispatched to gameboard-specialist (in-game
clock UI) + ui-specialist (lobby + history surfaces) per CLAUDE.md routing.
Decision #5 absorbed by Phase 2's disconnect overlay + grace UI. Decision #6
discovered to be already-shipped (deckbuilder paste-mode preserved through the
lobby cleanup; engine's parseDecklist handles the format). Decision #7
discovered to be already-designed (HANDOFF entry from 2026-04-21); built the
server Phase 1 MVP + dispatched ui-specialist for the UI MVP. All 1053 tests
pass across all packages. Prior session (2026-05-18) shipped Decisions #2/#3
+ #4 Phase 1.

**Resume here next session:** Decision #8 — **T2 sequencing: replay viewer
scrub + branching vs meta dashboard**. The T1 floor is now complete (#1-#7
all resolved or shipped). Remaining items are T2 ranked-credibility work +
T3-T4 platform features. Sequencing is the real question — the brainstorm
calls replay-scrub + branching the highest-leverage T2 ("competitive players
live in this; branching is differentiated because of our deterministic engine
+ undo support"), and the meta dashboard the biggest differentiation wedge
(turns internal analytics CLI into public surface). Both are multi-week. Most
useful next conversation: pick one as the "T2 north star" and BACKLOG the
other with a trigger for when it gets sequenced in.

Context to bring back into the resume conversation for Decision #8:
- Brainstorm doc Bucket 2 (T2-level gaps) lists both replay-scrub and meta
  dashboard as marquee T2 work. Neither has been started; both have rough
  spec sketches in the brainstorm doc.
- **Replay viewer scrub + branching** is differentiated because of substrate
  we already have: deterministic engine + undo support + per-viewer-filtered
  state stream (`getFilteredGameReplay` shipped 2026-05-01). Branching ("what
  if I'd played X on turn 5") is technically possible by handing the replay's
  pre-action state to the sandbox engine + letting the user make different
  choices. UI: scrubber + key-moment auto-tagging + annotations + share-with-
  annotations.
- **Meta dashboard** turns the internal analytics CLI (`pnpm analyze`,
  `pnpm query`) into a public surface. Aggregated anonymous stats —
  archetype win rates, ink-pair distributions, turn metrics, opening hand
  analysis. The analytics package is already capable; what's missing is
  the public-facing rendering + privacy-safe aggregation (anonymize before
  serving) + cron job to refresh.
- Both are multi-week. Sequencing call: which is the "T2 north star"?
  Brainstorm's view: replay-scrub first (immediate competitive-player value),
  meta dashboard second (marketing wedge that needs ladder population to be
  meaningful anyway). My read: same order — replay-scrub leans into substrate
  we already have, meta dashboard benefits from waiting until there's more
  data to aggregate.

After Decision #8, the queue is:
- #9: meta dashboard (T2 / differentiation wedge)
- #10: seasons + placement matches (T2 / trigger-conditioned defer)
- #11: deck-sharing platform creep watch (drift monitor)
- #12: AI opponent surfacing (T4-substrate-ready / strategic call)
