# SUNSET

**Status: sunset 2026-07-18.** Active development stopped by choice. Nothing here is broken —
it's paused at a natural stopping point. This doc is the deliberate close so future-me (or a
rebuild) can pick it up cold without re-litigating the decision.

---

## Why I stopped

Not because the work failed — because the *goal* it was chasing isn't winnable solo.

- The project drifted into **competing with duels.ink for Lorcana players**: play client, lobby,
  matchmaking, ELO, chrome-craft. On that axis duels's real moat isn't UI — it's **users /
  network effect**. Beating an incumbent that already has the players, as a solo builder, needs
  a working empty-lobby bot *and* ≥10 real players to notice the craft delta *and* marketing.
  Low odds, long grind, and it *felt* like copying because — on the play-client half — it was.
- The genuinely differentiated half (deterministic engine, Monte Carlo analytics, clone-trainer,
  what-if branching, opponent scouting) is real and hard to copy, **but its product expressions
  also need a user base** — clone training needs games, ladder analytics needs a population.
  With one user, the flywheel can't spin (see the 2026-07-16 decision parking Stream 5c/5d/5e + 2g
  in `docs/BACKLOG.md`).

So: chose to stop rather than grind an unwinnable user race. The engine + card corpus + the
skills are banked regardless. Rebuild if I ever want to; otherwise move on. No regret framing —
this shipped a hard thing to a real stopping point.

Full strategic context: `docs/STRATEGY.md`, `docs/COMPETITIVE.md`, and the chat that led here.

---

## What's here (the crown jewels — reuse these first if rebuilding)

1. **Deterministic headless Lorcana rules engine** — `packages/engine/`. Seeded RNG
   (xoshiro128**), CRD **v2.2.0** compliant, audited against the PDF. This is the moat.
2. **Card corpus — `packages/engine/src/cards/*.json`.** 3135 cards across Sets 1–13 + promos
   (P1–P4, PD1, cp, DIS, D23, C1, C2). **0 stubs / 0 partial / 0 invalid / 0 approximations**
   per `pnpm card-status`. This is the single most valuable, hardest-to-recreate artifact — a
   rebuild lifts this JSON + the engine and starts ~80% done. **Do not delete lightly.**
3. **Audit tooling + discipline** — `pnpm card-status`, `pnpm decompile-cards`, and the rules in
   `CLAUDE.md` (card-claim citation, "handler existence is not correctness," structural fidelity,
   audit precedence). The *judgment* transfers to any complex-rules system.
4. **CRD-diff pipeline** — `pnpm snapshot-crd` + `docs/CRD_TRACKER.md` reconciliation workflow.
   Repeatable for any future rules revision.
5. **Full vertical, once through** — simulator (RL A2C+GAE + clone trainer), analytics, Hono +
   Supabase server (deployed; anti-cheat state filtering, per-format ELO), React/Vite client
   (deployed). Every layer done end-to-end at least once.

## What worked / what I'd do differently

- **Worked:** the engine + card corpus + audit discipline. That part was never the problem and
  never felt like copying.
- **Wouldn't repeat:** building a full multiplayer play client to compete with duels head-on
  before proving any user demand. The parts that needed users (MP, clone-trainer flywheel) were
  built ahead of the users existing. If rebuilt, keep the engine/analytics/scouting (needs zero
  users) and **don't** ship a duels-competitor client unless there's real pull.

---

## Still-useful-solo tools (need no users, no server)

These work today against duels.ink replay exports and were the clearest "value *on top of* duels,
not instead of it" signal:

- **`~/Desktop/scout-opponent.mjs`** — reconstructs an opponent's revealed decklist from a
  `.match-replay.zip` / `.replay(.gz)`. **Self-contained** — reads card names straight from the
  replay, no repo dependency. Runs from anywhere.
  ```bash
  node ~/Desktop/scout-opponent.mjs ~/Downloads/<id>_pN.match-replay.zip
  ```
- **`~/Desktop/my-decklist.mjs`** — prints the *recording* player's own 60-card list from the
  replay's `decklist` field.

  ⚠️ **DEPENDS ON THIS REPO'S CARD JSON.** The replay stores the deck as bare card **IDs**
  (`"SET-NUM"`, e.g. `12-79`), *not* names. `my-decklist.mjs` resolves those IDs → names by
  reading `packages/engine/src/cards/*.json` from this repo. If this repo is deleted/moved, the
  script prints `??? 12-79` for every card. To keep it working after sunset, either:
  - keep this repo's `packages/engine/src/cards/` on disk, **or**
  - copy that folder somewhere and point the script at it:
    ```bash
    LORCANA_CARDS_DIR="/path/to/cards" node ~/Desktop/my-decklist.mjs ~/Downloads/<id>.zip
    ```
  (The script already tries: `$LORCANA_CARDS_DIR` → `<script>/../packages/...` →
  `C:/Users/Ryan/WebstormProjects/lorcana-sim/packages/engine/src/cards`.)

  **Reason it's ID-based, not name-based:** unlike the opponent (whose cards get named as they're
  revealed), your own deck is stored as the raw ID list up front — so name resolution requires the
  card corpus. That's why `scout-opponent.mjs` is portable and `my-decklist.mjs` isn't.

> If the card corpus is the thing you keep from this whole project, note that these two scripts
> are its smallest, most immediately useful consumer.

---

## Operational wind-down (stop ongoing cost)

- **Vercel UI** — https://lorcana-sim-ui.vercel.app. Tear down / pause the project if you don't
  want it live. No cost if on the free tier, but leaving a stale build public is untidy.
- **Railway server + Supabase** — the multiplayer server (Railway) and DB (Supabase). **These can
  cost money.** If done for good, pause/delete the Railway service and the Supabase project. If
  you might rebuild, export the Supabase schema first (`server/src/db/schema.sql` is already in
  the repo) so nothing is lost.
- **OAuth apps** (Google/Discord) — revoke or leave dormant; no cost, minor hygiene.

Nothing local rots — the repo, tests, and card data sit fine indefinitely.

---

## Current state (as of sunset)

- Branch: `main`. Working tree clean at sunset commit.
- `pnpm card-status`: 3135/3135, 0 stubs / 0 partial / 0 invalid.
- CRD: v2.2.0 (July 9 2026) reconciled — `docs/CRD_TRACKER.md`.
- Docs are current: `docs/ROADMAP.md` (status refreshed 2026-07-16), `docs/BACKLOG.md` (parked
  items with triggers), `docs/HANDOFF.md` (open cross-agent items, incl. the paused clone-trainer
  export).
- Engine/sim/analytics/server tests exist per package — run `pnpm test` to confirm green before
  trusting any resumed work.

If you're reading this to restart: begin at `packages/engine/` + the card JSON. Ignore the
multiplayer client until you have a reason (users) to build it.
