# Audit 2026-04-28 — Action Items Tracker

Working tracker for the 24 audit items surfaced 2026-04-28. Companion to `docs/AUDIT_2026-04-28_log_modal_undo.md` (the synthesis doc — read that for context) and the five `docs/audit/2026-04-28_*.md` source files (drill-down detail).

**Numbering** matches the synthesis doc's prioritized action list (P0.1 through P3). Use the IDs to reference items in commit messages and follow-up discussion.

**Status legend:**
- ☐ TODO — not started
- 🔄 IN PROGRESS — agent dispatched or work underway
- ✅ DONE — shipped, link to commit
- ⏭️ SKIPPED — explicitly decided not to ship
- ❓ NEEDS DECISION — blocked on user input

---

## P0 — Gameplay bugs (ship before next playtest)

| ID | Status | Item | Effort | Owner | Source | Comments |
|---|---|---|---|---|---|---|
| **P0.1** | ✅ | **REAL SHIPPED UI HANG, not future-defense.** Verified 2026-04-28 by direct grep of card JSON. Shipped 2026-04-28 in `c34447f` (UI branches + exhaustiveness sentinel + CLAUDE.md entry under "Critical bug patterns"). **`choose_player` — 4 unique cards** (7 entries with reprints): Second Star to the Right (Set 4 + Set 4 enchanted + Set 9 reprint), Water Has Memory (Set 7), Mad Hatter - Eccentric Host (Set 6), Copper - Hound Pup (Set 11), Bruno Madrigal - Seeing the Future (Set 12). **`choose_card_name` — 4 unique cards** (7 entries with reprints): The Sorcerer's Hat (Set 3 base + enchanted), Bruno Madrigal - Undetected Uncle (Set 4 + Set 9 reprint + D23 promo), Blast from Your Past (Set 5), Merlin - Clever Clairvoyant (Set 7). Both auto-resolve in narrow cases (single valid target for player; non-interactive sim for card-name), but surface a hung modal in 2P interactive play for the non-degenerate paths. Ship a 3-layer defense: **(1)** real UI input controls — player-picker (buttons; mirror existing `choose_play_order` shape at `PendingChoiceModal.tsx:291`) + card-name input (autocomplete from `Object.values(definitions).map(d => d.fullName)`); **(2)** compile-time `never`-exhaustiveness check at the end of `PendingChoiceModal.renderContent()` so future variant additions to the union fail typecheck; **(3)** CLAUDE.md rule about engine→UI PendingChoice parity. Layer 2 (formerly proposed as "type unsupported fallback") downgrades to a **last-resort `console.error` + return null** breadcrumb behind layers 1 + the new UI branches; never user-visible. | ~2-3 hrs UI + ~30 min defense layers | gameboard-specialist (UI controls + exhaustiveness check) | gameboard `2026-04-28_modal_strings.md` + 2026-04-28 audit by engine-expert (re-verified by direct grep) | Engine sites: `surfaceChoosePlayer` constructor at `reducer.ts:8290-8321`; `name_a_card_then_reveal` constructor at `reducer.ts:3792-3818` (gated on `state.interactive`) + RESOLVE_CHOICE consumer at `:2533`. Tests already exist at `set4.test.ts:194-236`. Simulator's `choiceResolver.ts` falls through generic handler for `choose_player` (works because targets are PlayerIDs); `choose_card_name` skipped by sim's non-interactive guard. |
| **P0.2** | ✅ | Fix `choose_order` modal helper text — currently hardcodes "first tap → bottom"; should read placement direction from engine state (top vs bottom). | ~30 min | gameboard-specialist | gameboard `2026-04-28_modal_strings.md` | Shipped 2026-04-28. Real bug, not future-proofing — Hypnotic Deduction (Set 5) surfaces `position: "top"` (`reducer.ts:2666`) with engine prompt "first selected = topmost / drawn first" while the UI helper said the opposite. UI now reads `pendingChoice.position` and flips the helper text. Bottom case (Vision / Ariel / Under the Sea / look_at_top rest-to-bottom) unchanged. |
| **P0.3** | ✅ | Fix `ZoneViewModal` empty state — hardcodes `"No cards in discard"` regardless of zone; should read the zone name from props (also used as deck/reveal/cards-under viewer). | ~15 min | gameboard-specialist | gameboard `2026-04-28_modal_strings.md` | Shipped 2026-04-28. Five callsites use highly variable titles (`"Cards Under X"`, `"Revealed by Y"`, etc.) so interpolating any of them produces awkward English. Header already names the zone — empty body now just says "No cards". |
| **P0.4** | ✅ | Add `game_over` log entry for lore-threshold wins at `reducer.ts:8617`. Currently only deck-out wins log. One line. | ~15 min | engine-expert | engine `2026-04-28_engine_log_undo_rl.md` Topic 1 | Shipped 2026-04-28 in `9d382bd`. Bundled with P0.5 engine signal. |
| **P0.5** | ✅ | (a) Surface win condition on Game Over modal — currently invisible whether you won by lore / deckout / concede. (b) **NEW: dismiss/peek affordance** — modal currently full-screen blocks the board + hides BoardMenu (`GameBoard.tsx:2670, 2576`), so post-game log is unreachable. Add X-close + backdrop dismiss + persistent reopen badge; unhide BoardMenu while dismissed. | ~30 min UI + ~15 min engine signal + ~30 min dismiss/peek | gameboard-specialist (UI) + engine-expert (signal) | gameboard `2026-04-28_modal_strings.md` + 2026-04-28 session observation | Shipped 2026-04-28: engine signal `9d382bd` (wonBy on `GameState` + 3 setter sites + log entry); UI `a12272a` (dismiss/peek + backdrop + reopen pill + BoardMenu unhide); follow-up `55f902f` swapped X-close for Peek pill (eye icon + label) to match `PendingChoiceModal`'s established Peek idiom for vocabulary consistency. |

---

## P1 — Drift / coupling fixes (compound over time)

| ID | Status | Item | Effort | Owner | Source | Comments |
|---|---|---|---|---|---|---|
| **P1.6** | ✅ | Fix `storage.ts:67` to strip only `actionLog` from saved sims, NOT `actions[]`. Past games become replayable. One-line fix with high leverage. | ~10 min | engine-expert / simulator | engine `2026-04-28_engine_log_undo_rl.md` Topic 3 | Shipped 2026-04-28. `stripActionLog` now drops only `actionLog`; `StoredGameResult` type updated to `Omit<GameResult, "actionLog">`; comments reference STREAMS.md. Storage size impact measured on 20-game smoke: +47% per file (~+22MB for 5000 games). Replayability gain worth it; "stopgap until SQLite" note in storage.ts still applies. |
| **P1.7** | ✅ | Fix `runGame.ts:258` — derive mulligan state from `actions[]`, not log substring matching. Both bot-trainer + engine-expert flagged this independently. | ~30 min | engine-expert / simulator | engine + bot-trainer | Shipped 2026-04-28. New exported helper `deriveMulliganed(actions)` in `runGame.ts` scans the canonical action stream for the first array-shaped `RESOLVE_CHOICE` per player (the only pendingChoice that surfaces before any in-game decision and uses the array-of-instanceIds shape; `choose_play_order` comes earlier but uses a plain string). Empty array → kept hand; non-empty → mulliganed. Robust against `startingState` injection bypass (no array RESOLVE_CHOICE → both false). |
| **P1.8** | ☐ | Replace `SAMPLE_DECKLIST` (15 hardcoded card-name lines in `DecksPage.tsx:24-39`) with engine helper `getSampleDeck(format)`. Eliminates the "Load sample" drift risk. | ~20 min UI + ~20 min engine helper | ui-specialist + engine-expert | ui non-gameboard `2026-04-28_modal_strings_non_gameboard.md` §10 | Engine should expose the sample deck (known-legal current rotation) |
| **P1.9** | ☐ | Audit `extractOptionTexts` rulesText parsing. When parse fails, fall back to `"Option N"` labels rather than ship malformed text. | ~45 min | gameboard-specialist | gameboard `2026-04-28_modal_strings.md` | HIGH drift risk — bullet-parsing card prose |
| **P1.10** | ✅ | Conditional copy on legality-drift tooltip in `DecksPage.tsx:240` — drop "migrate to Infinity" when deck is already on Infinity. | ~15 min | ui-specialist | ui non-gameboard §10 | Shipped 2026-04-28. Took the simpler route per user preference: dropped the prose entirely (incl. the "migrate to Infinity" copy and the "Click to open" advice — clicking the tile already opens it; the badge already shows "N illegal"). Tooltip is now just `legalityIssues.join("\n")` — one illegal card name per line, no header. |
| **P1.11** | ☐ | Add log lines for effect-driven mutations (discard, look_at_hand, gain_lore, damage, move_damage, add_ink_from_hand) — currently silent. Players can't reconstruct why hand/lore/damage changed. | ~2-4 hrs (touches every effect handler) | engine-expert | engine `2026-04-28_engine_log_undo_rl.md` Topic 1 | Logs should be reconstructable; this is the biggest single log-completeness gap |
| **P1.12** | ☐ | Use `ability.storyName` in activated-ability log at `reducer.ts:1710` — currently `"X activated an ability on Y"` drops which ability. | ~20 min | engine-expert | engine `2026-04-28_engine_log_undo_rl.md` Topic 1 | |
| **P1.13** | ☐ | Add structured `cause` field to banish log so simulator/replay can disambiguate (challenge / damage / banish-effect / CRD 8.5.4 cleanup) without prose parsing. | ~1 hr engine + ~30 min UI | engine-expert + gameboard-specialist | engine `2026-04-28_engine_log_undo_rl.md` Topic 1 | |
| **P1.14** | ☐ | **Migrate every targeting prompt to the `choose_may` gold-standard pattern** — engine passes `def.fullName + ability.storyName + ability.rulesText` to all prompt builders. Eliminates indistinguishable simultaneous prompts. | ~half-day engine | engine-expert | gameboard `2026-04-28_modal_strings.md` | **Single biggest UX leverage item.** Currently 4/50 prompts cite source |

---

## P2 — Documentation

| ID | Status | Item | Effort | Owner | Source | Comments |
|---|---|---|---|---|---|---|
| **P2.15** | ✅ | Create `docs/STREAMS.md` documenting the three streams (`actionLog` / `actions[]` / `episodeHistory`) — contracts, audiences, when each is consumed. Prevents future drift like P1.7. | ~1 hr | bot-trainer + engine-expert (joint) | bot-trainer `2026-04-28_rl_log_action_stream.md` + engine Topic 3 | Shipped 2026-04-28. Verified by reading actual code: audit's prose conflated `ActionResult` (engine per-action return — has `events` field) with `GameResult` (simulator per-game wrapper — has `actions[]` field). STREAMS.md uses the verified shapes and points at the two known coupling bugs (P1.6, P1.7) so future agents won't re-derive. |
| **P2.16** | ✅ | Add JSDoc on `GameLogEntry` (in `types/index.ts:3894`) clarifying it's a derived projection, not a source of truth for replay. | ~10 min | engine-expert | bot-trainer `2026-04-28_rl_log_action_stream.md` | Shipped 2026-04-28. Doc comment now references `STREAMS.md`, calls out the runGame.ts:258 mulligan-detection drift bug (P1.7) by name as an example of what NOT to do, and points at `GameResult.actions` for canonical replay + `ActionResult.events` for animation cues. |
| **P2.17** | ✅ | Add code comment on `useGameSession.ts:472` documenting the implicit undo-granularity contract ("1 click = back to last pendingChoice"). | ~10 min | gameboard-specialist | engine `2026-04-28_engine_log_undo_rl.md` Topic 2 | Shipped 2026-04-28. Comment block above the `undo` callback now explains the implicit "1 click = back to last pendingChoice" granularity, calls out the undocumented coupling between `isMay` card-data and undo UX, and references P2.20 (the regression test that should pin the invariant). |

---

## P2 — Consistency / polish

| ID | Status | Item | Effort | Owner | Source | Comments |
|---|---|---|---|---|---|---|
| **P2.18** | ☐ | Unify Confirm / Skip / Decline button vocabulary across modals (8+ variants today: OK / Confirm / Done / Submit / Cancel / Skip / Pass / No thanks / Decline). Pick a canonical pair. | ~30 min | gameboard-specialist | gameboard `2026-04-28_modal_strings.md` | Probably `Confirm` / `Skip` |
| **P2.19** | ☐ | Consolidate hand-rolled modals through `ModalFrame` — DeckBuilderPage's discard-changes + box-art picker currently hand-roll the backdrop. | ~30 min | ui-specialist | ui non-gameboard §10 | |
| **P2.20** | ☐ | Add regression test for undo-after-may-trigger invariant — assert that after `PLAY_CARD` of any card with optional triggers, an undo returns to the may prompt (not pre-play). Catches the "drop `isMay` and undo silently collapses" coupling. | ~30 min | engine-expert | engine `2026-04-28_engine_log_undo_rl.md` Topic 2 | |
| **P2.21** | ☐ | Audit `useActiveEffects` label builder for paraphrase risk — flagged by gameboard-specialist as similar in shape to `formatDuration` / `filterLabel`. | ~30 min | gameboard-specialist | gameboard `2026-04-28_modal_strings.md` | |

---

## P2 — MP takebacks (server-specialist's Phase 1-3)

These three are sequenced; later phases depend on earlier. Server-specialist's full design is in `docs/audit/2026-04-28_mp_takebacks_design.md`.

| ID | Status | Item | Effort | Owner | Source | Comments |
|---|---|---|---|---|---|---|
| **P2.22** | ☐ | **Tier 0 cancels (pre-commit)** — pure UI. Mid-pendingChoice Cancel button reverts to pre-action state. No server. | ~half day | gameboard-specialist | server `2026-04-28_mp_takebacks_design.md` Phase 1 | Smallest takeback win — ships independent of server work |
| **P2.23** | ❓ | **Tier 1 neutral takebacks (INK_CARD, undeclared QUEST)** — server endpoint + 5-sec undo pill. **BLOCKED on Q1**: should `stateFilter.ts` redact opponent inkwells per CRD 4.1.4? | ~1 day cross-package | server-specialist + gameboard-specialist | server `2026-04-28_mp_takebacks_design.md` Phase 2 + open policy Q1 | If inkwells go face-down → PLAY_INK is fully neutral, simple Tier 1. If visible → PLAY_INK is consent-required (Tier 2) and the value calc shifts |
| **P2.24** | ☐ | **Tier 2 info-gain takebacks (private lobby only)** — opponent consent flow, `takebacks` audit table. Big UI surface. | ~2-3 days | server-specialist + gameboard-specialist + ui-specialist | server `2026-04-28_mp_takebacks_design.md` Phase 3 | Only ship after Tier 1 sees adoption |

---

## P3 — Future work (intentional defer)

| ID | Status | Item | Effort | Owner | Source | Comments |
|---|---|---|---|---|---|---|
| **P3.25** | ⏭️ | i18n readiness sweep — extract every hardcoded user-facing string into a `strings.ts` const map. 100% English-literal codebase today; no translation infrastructure. | ~3-5 hours | ui-specialist + gameboard-specialist | ui non-gameboard §10 | Only ship if localization lands on the roadmap. Skip for now. |
| **P3.26** | ⏭️ | Pluralization helper (`pluralize(noun, count)`) — minor consolidation; not urgent. | ~10 min | ui-specialist | ui non-gameboard §9 | Tiny; bundle with another cleanup |
| **P3.27** | ⏭️ | Phase 4 takebacks — Tier 3 public reveals (Powerline-style). Same as Phase 3 plus toast wording. Marginal value over Phase 3. | ~half day on top of Phase 3 | server-specialist + gameboard-specialist | server `2026-04-28_mp_takebacks_design.md` Phase 4 | Probably skip permanently |

---

## Open policy questions (need user decision before relevant items can ship)

| ID | Question | Affects | Default proposed | Decision |
|---|---|---|---|---|
| **Q1** | Should `stateFilter.ts` redact opponent inkwells per CRD 4.1.4 (face-down)? | P2.23 (Tier 1 takebacks classification of `PLAY_INK`); broader anti-cheat baseline | Yes — fix the filter to match CRD; PLAY_INK becomes fully neutral | _pending_ |
| **Q2** | What's the canonical button-vocab pair for confirm/skip in modals? | P2.18 | `Confirm` / `Skip` | _pending_ |
| **Q3** | Should we ship Tier 0 takebacks (P2.22) without committing to Tier 1+? | P2.22 sequencing | Yes — Tier 0 is pure UI, ships independent | _pending_ |
| **Q4** | Should `getSampleDeck()` return a fixed canonical deck or rotate seasonally? | P1.8 | Fixed (least drift; least support load) | _pending_ |
| **Q5** | Should MP takeback `takebacks` audit table be visible to players post-game (their opponent's takeback rate) or admin-only? | P2.24 + future moderation | Admin-only initially; consider player-facing once data exists | _pending_ |
| **Q6** | Does i18n make the roadmap? Affects whether P3.25 ever happens. | P3.25 | No (English-only for foreseeable future) | _pending_ |

---

## Summary stats

- **Total items**: 27 (P0: 5, P1: 9, P2: 10, P3: 3)
- **Already-shipped (in flight)**: 0
- **Blocked on user decision**: 1 explicitly (P2.23 → Q1) plus 5 open Qs that influence future work
- **Estimated total effort to clear P0+P1**: ~12-16 hours of focused work across 3-4 agents
- **Estimated effort for P0 only** (gameplay bugs): ~2 hours

---

## Working notes

Use this section freely as we work through items — paste links to commits, decisions made, etc.

**Session log:**

- 2026-04-28: Audit shipped (commits TBD). 4 research agents + 1 synthesis pass.
- 2026-04-28: Started P0.4 + P0.5. Folded "Game Over modal blocks board / log unreachable post-game" observation into P0.5 as sub-bullet (b). Engine signal (`wonBy` on `GameState` + log entry on lore wins) and UI (dismiss/peek + win-condition rendering) dispatched in parallel.
- 2026-04-28: P0.4 + P0.5 shipped (`9d382bd` engine+server, `a12272a` UI). Engine 706→710 tests passing. wonBy field on GameState; lore wins now log a game_over entry; modal dismissible with reopen pill + BoardMenu unhide while peeking.
- 2026-04-28: P0.5 follow-up `55f902f` — replaced the X-close on the Game Over modal with the Peek pill idiom (eye icon + label) already used by `PendingChoiceModal`. Backdrop click semantics unchanged. Updated stale `ModalFrame.tsx` docstring that claimed Game Over was "intentionally non-dismissable".
- 2026-04-28: P0.3 shipped — `ZoneViewModal` empty state no longer hardcodes "No cards in discard". Drops the zone reference entirely (header above already names the surface) since title strings are too variable to interpolate cleanly.
- 2026-04-28: P0.2 shipped — `choose_order` helper text now reads `pendingChoice.position` from the engine. Was a real shipped bug for Hypnotic Deduction (engine prompt said "first selected = topmost", UI helper said the opposite); player got their deck order inverted on that card.
- 2026-04-28: BACKLOG entry added for unifying `choose_order` direction across cards (parked; trigger conditions documented).
- 2026-04-28: P0.1 audit dispatched to engine-expert — found 7 cards live-surface `choose_player` and 6 cards live-surface `choose_card_name` (interactive mode). Real shipped UI hang, not future-defense. Tracker row updated with audit findings and 3-layer defense plan: real UI input controls (player-picker + card-name input) as primary fix, plus compile-time exhaustiveness + CLAUDE.md rule. P0.1 scope expanded from ~1 hr to ~2-3 hrs.
- 2026-04-28: **P0.1 shipped** (`c34447f`). gameboard-specialist implemented `choose_player` (button-stack with You/Opponent labels) + `choose_card_name` (autocomplete subcomponent dedup'd on `def.name` since engine consumer compares bare name not fullName — caught a brief bug pre-commit). Compile-time `never` sentinel landed at the catchall using `"choose_target" \| "choose_from_revealed"` as the residual union; surfaced + fixed two pre-existing TS-narrowing pitfalls (`needsMultiSelect` intermediate boolean + combined `choose_option`+presence-check). CLAUDE.md gained a "Engine→UI PendingChoice parity" entry under Critical bug patterns. UI typecheck error count unchanged (150 baseline, 150 post). All P0 items now closed.
- 2026-04-28: **P0.1 card-name re-verification** — engine-expert audit's prose card-name labels were wrong on 4 of 14 line citations (line numbers themselves were correct against the grep pattern, but the cards' `fullName` was misremembered). Corrected mapping: Lead the Way ×3 → actually **Second Star to the Right** ×3 (Set 4 + Set 4 enchanted + Set 9 reprint); "Sail to Neverland-style scry-4" → actually **Water Has Memory** (Set 7); Merlin variant ×2 in Set 3 → actually **The Sorcerer's Hat** ×2; Magic Brooms in Set 7 → actually **Merlin - Clever Clairvoyant**. Mad Hatter, Copper, Blast from Your Past, Bruno Madrigal entries verified correct. Tracker row updated with verified card list. Lesson logged: don't trust audit prose-labels for card names; re-grep `fullName` from JSON when committing them to docs.
