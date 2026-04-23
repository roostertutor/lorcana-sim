# CLAUDE.md — Operating Manual for Claude Code
# Auto-loaded every session. Keep concise. Don't duplicate SPEC.md / DECISIONS.md / CRD_TRACKER.md.

## Project

Headless Lorcana TCG analytics engine — simulates thousands of games to produce
deck analytics and win rates. NOT primarily a human-playable simulator, though a
playable sandbox exists as a thin UI layer over the engine.

## Status

- **engine** — done, 460 tests passing. `pnpm catalog > docs/ENGINE_PRIMITIVES.md` dumps the live primitive inventory (~80). Tests split: `reducer.test.ts` (CRD rules), `setN.test.ts` (per-set card behavior), `mech-gaps-batch.test.ts`, `undo-rng-isolation.test.ts`, `angela-eternal-night.test.ts` (regression coverage for two silent bug classes).
- **simulator** — done, 47 tests passing. Layer 3 data-integrity invariants enforced. RL bot implemented (Actor-Critic + GAE). `rl.test.ts` has a pre-existing flake unrelated to engine work.
- **analytics** — done, 15 tests passing.
- **cli** — done. Commands: `analyze`, `compare`, `query`, `learn`.
- **server** — done (core). Hono + Supabase. Anti-cheat state filtering, per-format ELO (bo1/bo3 × core/infinity), Bo1/Bo3 match format, token auto-refresh, action logging for clone trainer. Remaining: Railway deploy, OAuth. See `docs/MULTIPLAYER.md`.
- **ui** — done. React + Vite, react-router-dom, 7 screens, responsive (mobile/tablet/desktop). Multiplayer: lobby, reconnection (localStorage), shareable lobby links (`/lobby/:code`). See `docs/UI_PENDING_MECHANICS.md` for unvisualized mechanics.
- **sandbox** — done. Interactive game board vs bot with replay + undo, DnD, alt-cost shift picker, card injector with qty/zone/player/set controls, HMR session persistence + quick save/load. Visual state: keyword icon badges, exerted rotation, damage counter, drying overlay, active-effects pill, card-state status icons, stat delta badges. See `docs/GUI_TEST_CARDS.md` for the verified-mechanic checklist, `docs/GAME_BOARD.md` for layout notes.
- **cards** — **2306 named-ability cards wired + 539 vanillas = 2845/2865.** All of sets 1–11 + promos (P1, P2, P3, cp, DIS, D23) + set 12 (213 cards — Ravensburger has mirrored most of the set as of 2026-04-23). Promo sets auto-synced from main sets via `scripts/sync-promo-reprints.ts`.
- **gaps** — 20 stubs in set 12: 19 fits-grammar, 1 unknown (Dale #22 — "your characters deal damage with their {W} instead of their {S}" needs a challenge-damage-source redirect primitive). 0 partial, 0 invalid-fields, 0 known approximations. See the Audit section below for how the four audit scripts triangulate.

## Quick Reference

```bash
pnpm test                             # all tests
pnpm test:watch                       # TDD (engine)
pnpm typecheck                        # fails on pre-existing exactOptionalPropertyTypes strictness — not from recent changes
pnpm dev                              # UI at localhost:5173
pnpm import-cards                     # fetch all sets + promos from Ravensburger API
pnpm learn                            # train RL policy (see --help)
```

Card data source hierarchy: **`ravensburger` > `lorcast` > `manual`** — each card
JSON entry carries a `_source` tag; importers refuse to downgrade. Main sets 1-12
come from **Ravensburger's official API** (`disneylorcana.com/api/getCardApiData`)
via `pnpm import-cards` → `scripts/import-cards-rav.ts`. Promo sets that Ravensburger
doesn't publish (DIS, C2, cp fallback) come from Lorcast via `pnpm import-cards-lorcast`
→ `scripts/import-cards-lorcast.ts`, which only fills gaps (refuses to overwrite a
`ravensburger`-tier entry). Cards edited by hand get `_source: "manual"` (lowest tier).
Ravensburger transcription errors are hardcoded in `STORY_NAME_OVERRIDES` inside the
importer (3 known cases). Individual cards can be frozen against all importers with
`_sourceLock: true` (e.g. The Bayou, where Ravensburger's ability name is wrong).
See `docs/DECISIONS.md` → Card Data Decisions.

### Refreshing card data (new set drops / reveals)

```bash
# 1. Update card JSON (preserves hand-wired abilities)
pnpm import-cards                       # re-imports ALL main sets 1-12 from Ravensburger
pnpm import-cards --sets set12          # or just one set
pnpm import-cards-lorcast               # fills DIS/C2/cp exclusives Ravensburger doesn't publish
pnpm import-cards-lorcast --sets 12     # during pre-release windows, pulls cards Lorcast has
                                        # revealed but Ravensburger hasn't mirrored yet
                                        # (they upgrade to "ravensburger" on the next import-cards run)
pnpm card-status                        # verify: 0 invalid, check new stubs

# 2. Refresh app card images (R2 CDN — rewrites imageUrl in card JSON)
pnpm sync-images-rav --sets 12 --dry-run   # smoke test without hitting R2
pnpm sync-images-rav --sets 12             # live: download → resize → R2 upload
                                           # skips tier-locked cards; refuses to downgrade

# 3. (Optional) Asset-crafting pipeline for foil/normal layers — OUT OF REPO.
# Only needed when you're working on sandbox foil rendering or asset overrides;
# the app reads imageUrl directly from card JSON after step 2.
cd ~/Desktop/Lorcana_Assets
node rav-download-images.mjs set12      # downloads base + foil + normal layers
                                        # promo cards auto-route to P1/P2/P3/etc
```

All commands are idempotent. The two importers enforce the
`ravensburger > lorcast > manual` hierarchy, so running `import-cards-lorcast`
on a repo already populated by Ravensburger is safe — only holes get filled,
and those gaps auto-upgrade to `ravensburger` when the official API catches up.
Run whenever Ravensburger adds cards to the API (typically same day as app release).

## Audits

Four scripts triangulate data quality; three (`card-status`, `audit-cards`, `decompile-cards`) are text-shape checks; the fourth (`audit-dead-primitives`) does reachability analysis over runtime state. The approximation-annotation sweep is now a plain grep (see "No-op stubs" below) — there's no dedicated script.

| Script | Covers | What it misses |
|---|---|---|
| `pnpm card-status` | JSON field validation: every `type`/`on` discriminator checked against `types/index.ts` unions; every CardFilter field checked against the `CardFilter` interface. Catches typos that silently no-op (`start_of_turn` vs `turn_start`, `maxStrength` vs `strengthAtMost`, `inkColor` vs `inkColors`, `hasCardsUnder` vs `hasCardUnder`, `notId` vs `excludeSelf`, `name` vs `hasName`). Extracts valid names dynamically from `types/index.ts` so it stays in sync. | Required-field structural checks (e.g. `action_restriction` requires `affectedPlayer` — missing it crashes at runtime, passes audit). |
| `pnpm audit-cards` | Card data drift: scalar fields, static-effect-type mismatches, keyword drops. Run after re-import. | Engine-internal wiring correctness. |
| `pnpm decompile-cards` | Authoritative semantic check: renders JSON ability back to English, similarity-scores against oracle text. The bottom of the sorted output is the bug list — stubs, wrong-trigger wiring, missing conditional branches, per-instance-vs-player-wide targeting, wrong destination zones, etc. Run `pnpm decompile-cards --set 001` for one set. | Handler-body runtime bugs (wrong variable names, off-by-one in reducers). Only tests or live play catch those. |
| `pnpm audit-dead-primitives` | Emit-vs-read reachability on StaticEffect primitives: every `modifiers.<field>` write in `gameModifiers.ts` must have at least one reader across engine+simulator+analytics+cli+ui. Catches the Hidden Inkcaster class of bug — case handler exists and populates a modifier field, but no consumer ever reads it, so the static silently no-ops. | Runtime correctness of the readers themselves (wrong variable, off-by-one). |

**What no audit catches:** required-field structural validation, semantic correctness (e.g. `triggering_card` vs `last_resolved_target` picking the wrong one), and runtime-handler bugs. Those need the decompiler-diff sweep, tests, or hands-on play.

## Docs (read on demand)

| File | Purpose | When to read |
|------|---------|-------------|
| `docs/SPEC.md` | Full spec: APIs, types, build order | Starting a new package/feature |
| `docs/DECISIONS.md` | Why decisions were made | Before proposing architecture changes |
| `docs/CRD_TRACKER.md` | CRD v2.0.1 rule-to-engine map | Implementing/fixing game rules |
| `docs/CARD_ISSUES.md` | Card implementation gaps / history | Importing new sets, fixing card bugs |
| `docs/ENGINE_PRIMITIVES.md` | Live primitive inventory (generated via `pnpm catalog`). Effect types split into *leaf* (direct state mutations) and *combinator* (higher-order — wrap other effects, e.g. `sequential`, `each_player`, `each_target`, `choose`, `self_replacement`, `create_floating_trigger`). | Checking what effect/trigger/condition types exist |
| `docs/RL.md` | RL training architecture, policies, reward design | Touching the RL training pipeline |
| `docs/QUERY_SYSTEM.md` | Query conditions, sim file format, CLI workflows | Writing or running queries |
| `docs/ANALYTICS_PHILOSOPHY.md` | Why we ask certain questions, query design principles | Designing new question files |
| `docs/GAME_BOARD.md` / `docs/GUI_TEST_CARDS.md` / `docs/UI_PENDING_MECHANICS.md` | UI-side references | Touching the sandbox |
| `docs/MULTIPLAYER.md` | Server + anti-cheat + ELO design | Touching server / lobby |
| `docs/ROTATIONS.md` | Core/Infinity rotation runbooks (pre-release, release day, cut, banlist) | Ravensburger announces a rotation change; flipping `offeredForNewDecks`; Set 12 switchover on 2026-05-08 |

---

## Rules (always follow)

### No hallucinated cards or rules
- ALWAYS look up card data from `card-set-XXX.json` files — never guess card text, costs, stats, or abilities from training data.
- ALWAYS cite CRD rule numbers from `docs/CRD_TRACKER.md` — never invent rules or assume how a mechanic works.
- Read the full CRD rule text from `docs/Disney-Lorcana-Comprehensive-Rules-020526-EN-Edited.pdf` when implementing a rule or a card ability that depends on one. The tracker is an index; the PDF has the complete spec with examples and edge cases.
- If data isn't available, say so and look it up. Do not make things up.

### Handler existence is not correctness
Grep-finding a `case "X":` label doesn't prove the handler works. Before claiming a card / mechanic is correctly implemented, do at least ONE of:
1. A test exercises the specific code path.
2. Read the handler body end-to-end and trace the data flow.
3. Run the card in the UI / simulator.

Three of the four audit scripts (`card-status`, `audit-cards`, `decompile-cards`) are text-shape checks — they miss runtime-handler bugs like wrong variable names in RNG calls (Fred Giant-Sized shipped broken because the text-level checks passed). `audit-dead-primitives` is reachability-only and also misses reader-side runtime bugs.

### Package boundaries — never cross
```
engine/      ← pure rules. No UI. No bot logic.
simulator/   ← imports engine only
analytics/   ← imports engine + simulator only
cli/         ← imports analytics only
ui/          ← imports analytics only (browser, no Node APIs)
```

### CRD references in code
When implementing or fixing game rules, add a CRD comment citing the rule number.
Example: `// CRD 8.9.1: Rush bypasses drying for challenges only`.

### Testing
- Always use `injectCard()` to set up state — never rely on the random opening hand.
- Layer 3 invariants are data integrity only (total cards = 60, no card in two zones, availableInk ≥ 0, lore ≥ 0). Do NOT assert things cards can change (inkwell contents, lore direction, win threshold).
- **Test organization:**
  - `reducer.test.ts` — CRD rules (core mechanics, organized by §1, §2, §3, etc.)
  - `setN.test.ts` — set-N card-specific tests (only unique patterns; don't retest the same pattern per card)
  - Shared helpers (`startGame`, `injectCard`, `giveInk`, `passTurns`, etc.) live in `engine/test-helpers.ts` — import from there, don't duplicate.
- **Pair validation tests with legal-action tests**: when `validateX` blocks an action, add a test that `getAllLegalActions` also omits it in the same scenario. The two functions were independently testable and their inconsistency caused the Reckless false-draw bug.

### Bot type separation
`BotType = "algorithm" | "personal" | "crowd"` — never mix in aggregation. See SPEC.md §Bot Type Separation for details.

---

## Critical bug patterns (must not reintroduce)

### `moveCard` same-player clobber
```typescript
// WRONG — second spread key clobbers first
zones: { ...state.zones, [playerId]: { ...removeFrom }, [playerId]: { ...addTo } }
// CORRECT — merge into single object
zones: { ...state.zones, [playerId]: { ...removeFrom, ...addTo } }
```

### Trigger fizzle (CRD 6.2.3 / 1.6.1)
`is_banished` and `leaves_play` triggers fire even after the card left play. Only fizzle if the card instance doesn't exist at all. For info captured pre-cleanup (cards-under count, effective strength), snapshot on `state.lastBanishedX` at banish time — the instance's own fields are wiped during leave-play cleanup.

### Win threshold (CRD 1.8.1.1)
Never hardcode `lore >= 20`. Always use `getLoreThreshold(state, definitions)`.

### "Until the start of your next turn" — caster vs owner duration
- `end_of_owner_next_turn` — expires at the end of the AFFECTED CARD'S OWNER'S next turn. Use for "they / their next turn" wording (Elsa Spirit of Winter, Iago). Owner-anchored.
- `until_caster_next_turn` — expires when the CASTER starts their next turn. Use for "until the start of YOUR next turn" (Mouse Armor, Four Dozen Eggs, Cogsworth Majordomo). Caster-anchored; requires `casterPlayerId` on the TimedEffect.

Naming the wrong one breaks the effect: `end_of_owner_next_turn` on a self-cast "your next turn" buff expires at end of the caster's OWN turn — zero turns of uptime. In 2P opponent debuffs the two coincide; in self-cast or 3+P they diverge. Read the exact pronoun: "their" → owner, "your" → caster.

### `banished_other_in_challenge` turn condition
Abilities saying "during your turn" on `banished_other_in_challenge` need `"condition": { "type": "is_your_turn" }` — otherwise they fire on the opponent's turn during mutual banishment (both characters banished at once). Later-set cards without the "during your turn" wording correctly omit this condition.

### Dual-container DnD / ref ID collision (UI)
Never render the same React component with the same ID in two sibling containers toggled by `md:hidden` / `hidden md:flex`. dnd-kit and ref maps expect each ID once — the hidden container overwrites the visible one, causing `getBoundingClientRect` to return `{0,0}`. Use a single container with responsive Tailwind classes:
```tsx
// WRONG
<div className="md:hidden ...">   {cards.map(id => <DraggableCard id={id} />)}</div>
<div className="hidden md:flex">{cards.map(id => <DraggableCard id={id} />)}</div>
// CORRECT
<div className="flex flex-col md:flex-row ...">
  {cards.map(id => <DraggableCard id={id} />)}
</div>
```

### No-op stubs and silent-field typos (data-quality failure mode)
Cards look "implemented" but don't actually work:
1. **No-op effect**: `modify_stat modifier:0`, `gain_lore amount:0`, empty `abilities: []` (when the card has named abilities per Lorcast).
2. **`(approximation: ...)` parenthetical** in rulesText — audit-invisible stealth debt.
3. **Invalid discriminator**: `start_of_turn` (should be `turn_start`), `banished_other_in_challenge` used for any-banish abilities (should be `is_banished`).
4. **CardFilter field typos**: fields not on the `CardFilter` interface are silent no-ops — the predicate is skipped and the matcher returns true for everything. Common typos caught in 2026-04 sweep: `maxStrength`→`strengthAtMost`, `inkColor`→`inkColors`, `hasCardsUnder`→`hasCardUnder`, `notId`→`excludeSelf`, `name`→`hasName`, `maxCost`→`costAtMost`.
5. **Per-instance vs player-wide targeting**: `action_restriction` with `affectedPlayer:"self"` and no filter restricts ALL your characters; use `cant_action_self` for per-instance oracle wording ("THIS character can't X").
6. **Legacy field names**: `move_damage` once used `from`/`to`; the reducer now reads `source`/`destination` only. Any rename needs a card-JSON migration — grep for the old name across sets after a type change.

Rules to prevent regression:
- NEVER write a no-op stub to make a card "complete." Leave `abilities: []` so `pnpm card-status` flags it.
- NEVER add `(approximation: ...)` to rulesText. `grep packages/engine/src/cards -e approximation` should always return zero.
- The authoritative checker is `pnpm decompile-cards` — it scores rendered ability JSON vs oracle text. The bottom of the sorted output IS the bug list.
- Run `pnpm card-status` after any card wiring, before claiming "100% complete." Invalid-field counts MUST be 0.

### Sequential effect `triggeringCardInstanceId` (CRD 6.1.5.1)
When applying `sequential` costEffects/rewardEffects via `applyEffect`, always forward `triggeringCardInstanceId`. When creating a `choose_may` PendingChoice for a sequential, store `triggeringCardInstanceId` on the choice so the accept path resolves exert correctly.
```typescript
// WRONG — triggeringCardInstanceId lost; exert on triggering_card silently no-ops
state = applyEffect(state, costEffect, sourceId, playerId, definitions, events);
// CORRECT
state = applyEffect(state, costEffect, sourceId, playerId, definitions, events, triggeringCardInstanceId);
```

### RNG aliasing (deterministic replay)
`rngNext` mutates `state.rng.s` in place for performance. `applyAction` clones `state.rng` at entry so the caller's state is never mutated — required for undo, quicksave/load, and branching-sim lookahead to preserve the seed. Do not keep a reference to a `GameState` and expect `.rng` to stay pristine; either rely on the clone inside `applyAction`, or clone yourself if you're holding past state for other reasons.
