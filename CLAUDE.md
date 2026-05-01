# CLAUDE.md — Operating Manual for Claude Code
# Auto-loaded every session. Keep concise. Don't duplicate SPEC.md / DECISIONS.md / CRD_TRACKER.md.

## Project

Headless Lorcana TCG analytics engine — simulates thousands of games to produce
deck analytics and win rates. NOT primarily a human-playable simulator, though a
playable sandbox exists as a thin UI layer over the engine.

## Status

- **engine** — done, 662 tests passing. `pnpm catalog > docs/ENGINE_PRIMITIVES.md` dumps the live primitive inventory (~80). Tests split: `reducer.test.ts` (CRD rules), `setN.test.ts` (per-set card behavior), `mech-gaps-batch.test.ts` (cross-cutting mechanic regressions), `undo-rng-isolation.test.ts`, `play-draw.test.ts`, `seededRng.test.ts`, `dynamic-amount.test.ts`.
- **simulator** — done, 47 tests passing. Layer 3 data-integrity invariants enforced. RL bot implemented (Actor-Critic + GAE). `rl.test.ts` has a pre-existing flake unrelated to engine work.
- **analytics** — done, 15 tests passing.
- **cli** — done. Commands: `analyze`, `compare`, `query`, `learn`.
- **server** — done (core). Hono + Supabase. Anti-cheat state filtering, per-format ELO (bo1/bo3 × core/infinity), Bo1/Bo3 match format, token auto-refresh, action logging for clone trainer. Remaining: Railway deploy, OAuth. See `docs/MULTIPLAYER.md`.
- **ui** — done. React + Vite, react-router-dom, 7 screens, responsive (mobile/tablet/desktop). Multiplayer: lobby, reconnection (localStorage), shareable lobby links (`/lobby/:code`). See `docs/UI_PENDING_MECHANICS.md` for unvisualized mechanics.
- **sandbox** — done. Interactive game board vs bot with replay + undo, DnD, alt-cost shift picker, card injector with qty/zone/player/set controls, HMR session persistence + quick save/load. Visual state: keyword icon badges, exerted rotation, damage counter, drying overlay, active-effects pill, card-state status icons, stat delta badges. See `docs/GUI_TEST_CARDS.md` for the verified-mechanic checklist, `docs/GAME_BOARD.md` for layout notes.
- **cards** — **2353 named-ability cards wired + 543 vanillas = 2896/2896.** All of sets 1–12 + promos (P1, P2, P3, cp, DIS, D23, C1, C2). Set 12 fully wired as of 2026-04-23; remaining 5 fits-grammar stubs cleared in commit b212204 (2026-04-29). Promo sets auto-synced from main sets via `scripts/sync-promo-reprints.ts`.
- **gaps** — **0 stubs, 0 partial, 0 invalid-fields, 0 fidelity-violations, 0 known approximations.**

## Quick Reference

```bash
pnpm test                             # all tests
pnpm test:watch                       # TDD (engine)
pnpm typecheck                        # fails on pre-existing exactOptionalPropertyTypes strictness — not from recent changes
pnpm dev                              # UI at localhost:5173
pnpm import-cards                     # fetch all sets + promos from Ravensburger API
pnpm learn                            # train RL policy (see --help)
pnpm find-precedent "<substring>"     # grep card precedents — REQUIRED before citing any card by name (see "Card-claim discipline" below)
pnpm snapshot-crd                     # regenerate docs/CRD_SNAPSHOT.txt from the latest CRD PDF (run after dropping a new revision; diff workflow in docs/CRD_TRACKER.md)
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
                                        # Auto-runs sync-promo-reprints at the end, then prints
                                        # a categorized "needs implementation" report for new cards.
pnpm import-cards-lorcast               # fills DIS/C2/cp exclusives Ravensburger doesn't publish
pnpm import-cards-lorcast --sets 12     # during pre-release windows, pulls cards Lorcast has
                                        # revealed but Ravensburger hasn't mirrored yet
                                        # (they upgrade to "ravensburger" on the next import-cards run)
pnpm sync-reprints                      # one-off run of within-set + cross-set reprint sync.
                                        # Not normally needed — import-cards chains it automatically.
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

Two scripts cover steady-state card-data quality. Run both after wiring a set or fixing a card; they cost <30s combined.

| Script | Covers | What it misses |
|---|---|---|
| `pnpm card-status` | JSON field validation: every `type`/`on` discriminator checked against `types/index.ts` unions; every CardFilter field checked against the `CardFilter` interface. Catches typos that silently no-op (`start_of_turn` vs `turn_start`, `maxStrength` vs `strengthAtMost`, `inkColor` vs `inkColors`, `hasCardsUnder` vs `hasCardUnder`, `notId` vs `excludeSelf`, `name` vs `hasName`). Also runs the structural-fidelity check (one printed ability = one JSON ability — see "Structural fidelity to printed text" below). Extracts valid names dynamically from `types/index.ts` so it stays in sync. | Required-field structural checks (e.g. `action_restriction` requires `affectedPlayer` — missing it crashes at runtime, passes audit). |
| `pnpm decompile-cards` | Authoritative semantic check: renders JSON ability back to English, similarity-scores against oracle text. The bottom of the sorted output is the bug list — stubs, wrong-trigger wiring, missing conditional branches, per-instance-vs-player-wide targeting, wrong destination zones, etc. Also catches the keyword-in-text-but-not-in-abilities class (oracle has the keyword, rendered text doesn't → score drops). Run `pnpm decompile-cards --set 001` for one set. | Handler-body runtime bugs (wrong variable names, off-by-one in reducers). Only tests or live play catch those. The renderer itself isn't faithful to oracle 100% — average score across all wired cards is ~0.80; treat the *bottom* as bug list, not the absolute score. |

**Triage precedence — card-status flags are real, decompile flags are noisy.** Empirical: in the 2026-04-30 set-12 sweep, every card flagged by `card-status` (8 / 8) was a genuine wiring bug, but only ~4 of 14 cards in the bottom of `decompile-cards`'s sorted output were genuine bugs — the rest were renderer gaps (the JSON shape is correct; the decompiler just can't render it cleanly back to the oracle phrasing). Practical rule:

- **`card-status` flag → fix immediately.** When the audit reports an invalid field, structural fidelity violation, or unhandled discriminator, the bug is real and the fix is well-scoped (rename a field, change a discriminator, add an `activeZones`).
- **`decompile-cards` low score → triage carefully.** Read the JSON, find the precedent shape, decide whether it's a wiring bug or a renderer gap *before* editing. Most low scores at the bottom of the list are one of: trigger filters not rendered (`atLocation:"this"`, `owner:"opponent"`), `chooser:"target_player"` interpreting `owner:"self"` from the chooser's perspective, `followUpEffects` not reflected in rendered text, multi-trigger anyOf shown as `[unknown-trigger:]`, or sequential/cost+reward shapes flattened. The wiring is correct; the renderer needs work — file a follow-up if useful but don't edit the JSON.

This skew is why audit improvements (the second half of every bug-fix workflow) are the highest-leverage move in this codebase — they convert decompile's noisy signal into card-status's high-precision signal. Each new field-typo class added to `card-status` makes the next sweep faster.

**What no audit catches:** required-field structural validation, semantic correctness (e.g. `triggering_card` vs `last_resolved_target` picking the wrong one), runtime-handler bugs, and reader-side bugs in static effects (Hidden Inkcaster class — case handler populates a modifier field with no consumer reading it). Those need tests, the decompiler-diff sweep, or hands-on play. **Discipline rule:** when adding a new static primitive or modifier field, write a test that asserts the modifier's effect is observable — otherwise it's a Hidden Inkcaster waiting to happen.

**Archived audits** (in `scripts/archive/`, not in steady-state flow): `audit-card-data.ts` (keyword-mention drift — bootstrap-era, redundant with decompile-cards), `audit-dead-primitives.ts` (Hidden Inkcaster reachability — fires <1×/year, redundant with the discipline rule above). Pull from archive if a class of bug starts shipping that needs them.

## Docs (read on demand)

### Planning trio — read these before adding work items

These three docs partition the "what's next" surface. Knowing where an item belongs is the bulk of correctly using them.

| File | Purpose | An item belongs here when… |
|------|---------|---------------------------|
| `docs/ROADMAP.md` | Sequenced product plan — what to build next, in what order, why. | The work is committed and sequenced. "We're going to build this." |
| `docs/HANDOFF.md` | Active cross-agent work queue — open items only. | Another agent type needs to pick this up. Strict convention: delete on completion. |
| `docs/BACKLOG.md` | Parked design / strategy decisions with trigger conditions. | We considered it, didn't ship now, have a concrete trigger to revisit. No agent owner yet. |

**Rules of thumb:**
- If you're about to write "TODO: figure out X later" → write a BACKLOG entry with a trigger condition instead.
- If a HANDOFF item has been `[DEFERRED]` for >2 weeks → move it to BACKLOG.
- If an item is sequenced into a sprint plan → move it to ROADMAP.
- Every BACKLOG entry MUST answer: what was considered, why parked, trigger to reconsider, expected scope. No trigger condition = the item is lost, not parked.
- Don't create new top-level docs for parked work without checking BACKLOG first.

### Other reference docs

| File | Purpose | When to read |
|------|---------|-------------|
| `docs/STRATEGY.md` | Product strategy, positioning, wedge claims | Before strategic-direction work or claiming a UX wedge |
| `docs/BRAND.md` | Brand identity, name candidates, screenshot test | Naming, marketing surface, visual identity calls |
| `docs/COMPETITIVE.md` | Competitive landscape (duels.ink, Inktable, etc.) | Competitive analysis, wedge claims |
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

### Card-claim discipline (READ THIS FIRST)

**Every card name you mention as a precedent or example must be paired with a `file:line` citation in the same sentence or table cell. Bare card-name mentions are not allowed in any output that proposes implementation work.** This rule is procedural, not aspirational — it is enforceable by the user scanning your output for unpaired card names and rejecting the message.

**Workflow — grep first, write second:**
1. Before naming a card as a precedent, run `pnpm find-precedent "<substring>"` (or `Grep` on `packages/engine/src/cards/`).
2. Take the `file:line — fullName` output and paste it into your proposal verbatim.
3. Only then write the explanation referencing that citation.

Reversing this order ("write proposal → grep if challenged") is what produces hallucinated precedents. The 2026-04-29 set 12 wiring proposal shipped a precedent table citing five cards from training-data recall — three of the five (Mother Knows Best, Madam Mim, Aurora set-5) didn't actually exist or didn't match the claimed mechanic. The rule was already in this file; it was treated as advice instead of procedure.

**The "partial-citation confabulation" failure mode.** A citation only protects against confabulation if **every** part of the card-claim is read from the same data, not just the parts that are easy to copy. The 2026-04-30 cross-set sweep had decompile output that literally said `set-9/197 One Last Hope` — the card name was right there next to the set/number. The HANDOFF entry I wrote said `Stand By Me (9/197)` — the set/number was copied verbatim from the output, but the card name was filled in from training-data recall and never verified. Result: the entry referenced a card that doesn't exist; the user had to manually correct it to "One Last Hope." The set/number citation made the entry *look* anchored, but the anchor was dragging a confabulated name. Procedural fix: when copying a citation from tool output, **copy the entire line, not the parts you can identify by context**. If you generate any part of the card-claim from memory, the whole claim is suspect and you should re-grep.

**Compliant vs non-compliant phrasing:**

❌ Non-compliant — bare card name from recall:
> "For the Hero filter we can use the Aurora pattern."

✅ Compliant — every card paired with `file:line`:
> "For `last_resolved_target` + trait check, use Widow Tweed - Kindly Soul (`card-set-11.json:1667-1730`) — it does `return_to_hand` then `self_replacement` with `condition: { hasName: 'Tod' }` on `target: { type: 'last_resolved_target' }`."

**Same rule applies to CRD claims.** Cite rule numbers from `docs/CRD_TRACKER.md` and read the full text from `docs/Disney-Lorcana-Comprehensive-Rules-020526-EN-Edited.pdf` before claiming a rule says X. The tracker is an index; the PDF has the full spec with examples and edge cases.

**If data isn't available, say so and look it up.** Do not make things up. Subagent dispatches inherit this rule — when briefing engine-expert / others, every precedent in the brief must already carry its `file:line`, and you must instruct them to do the same in commit messages and tests.

### Handler existence is not correctness
Grep-finding a `case "X":` label doesn't prove the handler works. Before claiming a card / mechanic is correctly implemented, do at least ONE of:
1. A test exercises the specific code path.
2. Read the handler body end-to-end and trace the data flow.
3. Run the card in the UI / simulator.

Both audit scripts (`card-status`, `decompile-cards`) are text-shape checks — they miss runtime-handler bugs like wrong variable names in RNG calls (Fred Giant-Sized shipped broken because the text-level checks passed).

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

### `discard_until` / `draw_until` — one direction per effect (CRD 5.2.8 fidelity)
Cards with bidirectional "discard-down OR draw-up" oracle text (Goliath Clan Leader DUSK TO DAWN: *"if they have more than 2 cards…they discard until they have 2. If they have fewer than 2…they draw until they have 2."*) wire as TWO sequential effects — `discard_until` (Prince John's Mirror shape, the discard half) and `draw_until` (Demona Wyvern AD SAXUM shape, the draw half). One unidirectional primitive per oracle clause.

`fill_hand_to` is the deprecated bidirectional ancestor — kept as a type for backward parsing, but new cards should always use `discard_until` / `draw_until`. Naming reflects the action: each primitive does one thing, matches one printed clause, and reads naturally in isolation.

Same principle applies more broadly: when oracle says "If X, do A. If Y, do B," wire it as two effects, not one combined effect with both branches inlined.

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

### Structural fidelity to printed text (CRD 5.2.8 / 6.2.6)
A card's `abilities[]` JSON list must mirror the printed text's bold-named ability blocks 1:1. **One printed ability (one bold name) = one JSON ability entry.** Don't split, don't merge, don't paraphrase. Within an ability:
- "and" between effects under one condition → effect-array (`StaticEffect | StaticEffect[]`, already supported per `types/index.ts:200`)
- "or" between effects (player chooses) → `choose` combinator (already supported)
- "and" between triggers, same body (Hiram-class) → multi-trigger combinator (engine extension on TriggeredAbility)
- "if X, do Y" mid-sentence → `condition` on the ability or `conditional_effect` wrapper, never split into two abilities

**Why it matters — paraphrasing creates latent bug classes:**
- **`oncePerTurn` budget doubles** when one printed ability is split into two — each gets its own `oncePerTurnKey` and fires independently. The 2026-04-29 fresh-wire experiment found Lenny COMIN' UP FAST shipping with this bug.
- **Story-name attribution lost** on the second JSON entry of a split — UI tooltips, audit messages, replacement-effect targeting (CRD 6.5) all key off `storyName`.
- **Effect-body drift**: two duplicated effect bodies must stay byte-identical to behave the same; no automated check enforces it.
- **Decompile-score false negatives**: the renderer emits one sentence per ability; a split ability decompiles to N sentences vs the oracle's 1, dropping similarity by 0.10-0.15.

**6 baseline bugs the 2026-04-29 fresh-wire experiment caught**, all variants of this rule violation: Mickey Expedition Leader (wrong static for "may"), Percy Pupsicle (player-wide `action_restriction` on "this character"), Lenny COMIN' UP FAST (missing `oncePerTurn`), Timon Snowball Swiper (incomplete non-character filter), Hiram Flaversham (split into two abilities, second missing storyName), Nala Undaunted Lioness (duplicated `compound_and(this_has_no_damage, this_has_no_damage)` from a hand-paraphrase).

Audit support: `pnpm card-status --category fidelity-violation` flags duplicate-storyName-within-card and degenerate-compound-condition cases. Must be 0 before claiming structural correctness.

### No information loss in encoding
If the JSON shape can't represent something the oracle says, the engine type or compiler matcher needs to extend — **not** the encoder paraphrasing the oracle into a lossy approximation. Sibling rule to structural fidelity: fidelity preserves printed *structure*; this rule preserves printed *semantics*.

This is the rule that prevents the `(approximation: ...)` stealth-debt class. Concrete pattern: if you find yourself wiring "do something close to what the card says, but slightly different," stop — the right answer is one of (a) extend the engine primitive to capture the missing semantic, (b) extend the compiler matcher with the precise wording, or (c) leave the card stubbed (`abilities: []`) so `pnpm card-status` flags it. Never silently lossy.

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

### Engine→UI PendingChoice parity
Every variant of `PendingChoice.type` (in `types/index.ts`) must have a corresponding `if (pendingChoice.type === "X") return ...` branch in `PendingChoiceModal.renderContent()`. Adding a new variant to the union without a UI branch silently falls through to the generic targeting renderer at the bottom — empty grid, no input, modal hangs. The exhaustiveness sentinel (`const _exhaustive: "choose_target" | "choose_from_revealed" = pendingChoice.type`) at the top of the catchall fails `pnpm typecheck` if a new variant slips in. Don't ship a card that surfaces a new PendingChoice variant in the same PR as the engine wiring — sequence the UI first or land both atomically. (`choose_player` and `choose_card_name` were silently hanging until commit `c34447f` shipped both UI branches; the sentinel was added in the same PR to prevent recurrence.)
