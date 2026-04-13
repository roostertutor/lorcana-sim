# CLAUDE.md — Operating Manual for Claude Code
# This file is auto-loaded every session. Keep it concise.
# Do NOT duplicate content from SPEC.md, DECISIONS.md, or CRD_TRACKER.md.

## Project

Headless Lorcana TCG analytics engine — simulates thousands of games
to produce deck analytics and win rates. NOT a human-playable simulator.

## Status

- engine:    done (403 passing). Run `pnpm catalog > docs/ENGINE_PRIMITIVES.md` for a live inventory of all ~80 primitives. Key additions from the 2026-04-09/10 approximation sweep + generalization pass: `resolveDirectTarget` helper (collapses 9 target-dispatch branches), `opponent_may_pay_to_avoid` cross-player chooser, `rememberedTargetIds` + `restrict_remembered_target_action`, `grant_trait_static` + pre-pass, `CardFilter.anyOf`, `challenges.defenderFilter`, `conditional_challenger_self`, `grant_keyword.valueDynamic`, `last_damage_dealt` + `last_resolved_target_strength` DynamicAmounts, `search` reducer (was missing; `tutor` collapsed into it). Generalization: `gain_lore`/`lose_lore` unified, `this_turn` temp modifiers → TimedEffect, `rest_of_turn` → `end_of_turn`, Hades migrated to `opponent_may_pay_to_avoid`, `resolveDirectTarget` extracted. Tests split: reducer.test.ts (CRD), set1-set11 + mech-gaps batch.
- simulator: done (46 passing). Layer 3 invariants passing. RL bot implemented (Actor-Critic + GAE). Pre-existing flake on rl.test.ts unrelated to engine work.
- analytics: done (15 passing).
- cli:       done. analyze, compare, query, learn.
- server:    done (core). Hono + Supabase. Anti-cheat state filtering, per-format ELO (bo1/bo3 × core/infinity), Bo1/Bo3 match format, token auto-refresh, action logging for clone trainer. Remaining: Railway deploy, OAuth. See `docs/MULTIPLAYER.md`.
- ui:        done. URL routing (react-router-dom), 7 screens, React+Vite. Responsive (mobile/tablet/desktop). Full-screen game board (no header/nav in-game). Multiplayer: lobby, reconnection (localStorage), shareable lobby links (`/lobby/:code`), duplicate game guard. See `docs/UI_PENDING_MECHANICS.md` for mechanics needing visualization.
- sandbox:   done. Interactive game board with bot opponent. Replay mode + undo. Utility strip (deck tile, inkwell, discard tile). Card action popover anchored to clicked card (fixed-position, works on all breakpoints). Keyword icon badges (slate=printed, green=granted, +N stacking per CRD 8.1.2), exerted rotation, damage counter, drying overlay. Left-side status icons (damage prevention, can't challenge/ready/sing, once-per-turn, delayed trigger). Stat delta badges (bottom-right: +S/-S/+W/-W/+L/-L). Top-left info badges (dual-name, granted trait, U-Shift). Cards-under viewer (clickable, face-up/down per `isFaceDown`). Active Effects pill (scoreboard: quotes source card ability text, conditional evaluation). DnD with drop labels (Play/Ink/Shift/Sing/Challenge/Move). Alt-cost shift picker (discard N cards). Drag-to-sing. Choose-amount picker for isUpTo effects. Choose-option with card text. Location rotation. HMR session persistence + quick save/load. Card injector with qty/zone/player/set, ink/lore controls, reset board. 5-family color scheme (slate/green/red/gray/amber). See `docs/GUI_TEST_CARDS.md` for verified mechanic checklist.
- cards:     **2146/2146 named-ability cards wired + 506 vanillas = 2652/2652 (100%) complete.** Every card across sets 1–11 + promos (P1, P2, P3, cp, DIS, D23) is implemented. Promo sets auto-synced from main sets via `scripts/sync-promo-reprints.ts` (cross-set + within-set passes).
- gaps:      **0 stubs, 0 partial, 0 invalid fields, 0 known approximations.** Four audit scripts triangulate data quality: `pnpm card-status` (stub progress + partial detection via rulesText header counting + **JSON field validation** against types/index.ts unions — catches wrong trigger/effect/condition/cost/duration names), `pnpm audit-lorcast` (Lorcast API drift, scalar fields, static effect-type mismatches), `pnpm audit-approximations` (parenthetical annotation tracker), and `pnpm decompile-cards` (deterministic JSON-to-English diff — the rendered-vs-oracle similarity tail surfaces semantic mis-wirings). All four report clean across all 17 sets. Raw Lorcast API responses can be cached via `pnpm import-cards --cache` for diffing against processed card JSONs.

## Quick Reference

```bash
pnpm test                # all tests
pnpm test:watch          # TDD (engine)
pnpm typecheck           # known errors in cli (missing @types/node) only
pnpm dev                 # UI at localhost:5173
pnpm import-cards        # fetch cards from Lorcast API
pnpm import-cards --cache # same + save raw API responses to .lorcast-raw/
pnpm learn               # train RL policy (see --help)
```

### Audit workflow
```bash
# After card wiring changes (run every time):
pnpm card-status                  # stubs, partial, invalid fields, field validation

# After re-importing from Lorcast API:
pnpm audit-lorcast                # keyword drift, dropped values from upstream

# Periodic deep review (set by set):
pnpm decompile-cards --set 001    # semantic diff: rendered JSON vs oracle text
```

## Docs (read on demand, not every session)

| File | Purpose | When to read |
|------|---------|-------------|
| docs/SPEC.md | Full spec: APIs, types, build order | Starting a new package/feature |
| docs/DECISIONS.md | Why decisions were made | Before proposing architecture changes |
| docs/CRD_TRACKER.md | CRD v2.0.1 rule-to-engine map | Implementing/fixing game rules |
| docs/CARD_ISSUES.md | Card implementation gaps | Importing new sets / fixing card bugs |
| docs/RL.md | RL training architecture, policies, reward design | Touching the RL training pipeline |
| docs/QUERY_SYSTEM.md | Query condition types, sim file format, CLI workflows | Writing or running queries |
| docs/ANALYTICS_PHILOSOPHY.md | Why we ask certain questions, query design principles | Designing new question files |

---

## Rules (always follow)

### No hallucinated cards or rules
- ALWAYS look up card data from `lorcast-set-XXX.json` files — never guess card text, costs, stats, or abilities from training data.
- ALWAYS cite CRD rule numbers from `docs/CRD_TRACKER.md` — never invent rules or assume how a mechanic works.
- When planning or implementing a rule, also read the full rule text from the CRD PDF (`docs/Disney-Lorcana-Comprehensive-Rules-020526-EN-Edited.pdf`). The tracker is an index; the PDF has the complete spec with examples and edge cases.
- When planning or implementing a card definition, also read the full rule text from the CRD PDF (`docs/Disney-Lorcana-Comprehensive-Rules-020526-EN-Edited.pdf`). The tracker is an index; the PDF has the complete spec with examples and edge cases.
- If card data or rule text is not available, say so and look it up. Do not make things up.

### Package boundaries — never cross
```
engine/      ← pure rules. No UI. No bot logic.
simulator/   ← imports engine only
analytics/   ← imports engine + simulator only
cli/         ← imports analytics only
ui/          ← imports analytics only (browser, no Node APIs)
```

### CRD references in code
When implementing or fixing game rules, add a CRD comment citing the rule
number. Example: `// CRD 8.9.1: Rush bypasses drying for challenges only`.
This links code to the authoritative rules document.

### Testing
- Always use `injectCard()` to set up state — never rely on random opening hand.
- Layer 3 invariants are data integrity only (total cards = 60, no card in two zones,
  availableInk >= 0, lore >= 0). Do NOT assert things cards can change
  (inkwell contents, lore direction, win threshold).
- **Test file organization** — engine tests are split:
  - `reducer.test.ts` — CRD rules (core mechanics, organized by §1, §2, §3, etc.)
  - `set1.test.ts` — Set 1 card-specific tests (only unique patterns, not every card)
  - `set2.test.ts` — Set 2 card-specific tests
  - Future sets get their own file: `set3.test.ts`, `set4.test.ts`, etc.
  - Shared helpers (`startGame`, `injectCard`, `giveInk`, `passTurns`, etc.) live in
    `engine/test-helpers.ts` — import from there, don't duplicate.
  - Test by pattern not by card — if a pattern (e.g. "enters_play → draw") is already
    tested in Set 1, don't retest it in Set 2 with a different card. Only test new
    patterns or unique edge cases.

### Bot type separation
`BotType = "algorithm" | "personal" | "crowd"` — never mix in aggregation.
See SPEC.md §Bot Type Separation for details.

### Critical bug patterns (must not reintroduce)

**moveCard same-player clobber:**
```typescript
// WRONG — second spread key clobbers first
zones: { ...state.zones, [playerId]: { ...removeFrom }, [playerId]: { ...addTo } }
// CORRECT — merge into single object
zones: { ...state.zones, [playerId]: { ...removeFrom, ...addTo } }
```

**Trigger fizzle (CRD 6.2.3 / 1.6.1):**
`is_banished` and `leaves_play` triggers fire even after the card left play.
Only fizzle if the card instance doesn't exist at all.

**Win threshold (CRD 1.8.1.1):**
Never hardcode `lore >= 20`. Always use `getLoreThreshold(state, definitions)`.

**"Until the start of your next turn" — caster vs owner duration:**
Two distinct EffectDuration values, easy to confuse:
- `end_of_owner_next_turn` — expires at end of the AFFECTED CARD'S OWNER'S next
  turn. Use for "they / their next turn" wording (Elsa Spirit of Winter "they
  can't ready at the start of their next turn", Iago "Reckless during their
  next turn"). Owner-anchored.
- `until_caster_next_turn` — expires when the CASTER starts their next turn.
  Use for "until the start of YOUR next turn" wording (Mouse Armor, Four Dozen
  Eggs, Cogsworth Majordomo, Lost in the Woods, Dodge). Caster-anchored,
  requires `casterPlayerId` on the TimedEffect.

Naming the wrong one matters: `end_of_owner_next_turn` for a self-cast
"your next turn" buff is broken — it expires at the end of the caster's OWN
turn (effectively `this_turn`), giving zero turns of uptime past cast.
For 2P opponent debuffs the two happen to coincide; for self-cast or 3+P
they diverge. Always read the card's exact pronoun: "their" → owner, "your"
→ caster.

**banished_other_in_challenge turn condition:**
Abilities that say "during your turn" on `banished_other_in_challenge` triggers require
`"condition": { "type": "is_your_turn" }` in the card JSON. Without it the ability fires
on the opponent's turn during mutual banishment (attacker and defender both banished).
Later set cards without "during your turn" in their rules text correctly omit this condition.

**Dual-container DnD / ref ID collision (UI):**
Never render the same React component with the same ID in two sibling containers
toggled by `md:hidden` / `hidden md:flex`. dnd-kit and ref maps only expect each
ID once — the hidden container overwrites the visible one, causing `getBoundingClientRect`
to return `{0,0}`. Use a single container with responsive Tailwind classes instead:
```tsx
// WRONG — card renders twice, DnD IDs collide
<div className="md:hidden ...">  {cards.map(id => <DraggableCard id={id} />)} </div>
<div className="hidden md:flex">{cards.map(id => <DraggableCard id={id} />)} </div>
// CORRECT — one container, responsive layout
<div className="flex flex-col md:flex-row ...">
  {cards.map(id => <DraggableCard id={id} />)}
</div>
```

**No-op stubs and "approximation" annotations (data-quality failure mode):**
A recurring pattern: cards get "wired" with a literal no-op effect (e.g.
`modify_stat modifier:0`, `gain_lore amount:0`) or with an `(approximation: ...)`
parenthetical comment in their rulesText, both of which slip past `pnpm card-status`
(which only counts missing abilities, not zero-valued ones) and `pnpm audit-lorcast`
(which only checks Lorcast API drift). They look "implemented" until someone
diffs the rendered behavior against the oracle text.

Rules to prevent regression:
- NEVER write a no-op stub to make a card "complete." If you can't implement
  the effect, leave `abilities: []` — `pnpm card-status` will flag it and
  the gap stays visible.
- NEVER add `(approximation: ...)` to rulesText. The annotation is invisible to
  every audit script and creates a permanent stealth-debt entry. Either implement
  the effect correctly OR leave the card unwired with a tracker entry.
- The authoritative no-op stub detector is `pnpm decompile-cards` (the
  decompiler-diff sweep) — it renders ability JSON back to English and scores
  similarity vs oracle text. The bottom of the sorted output is the bug list.
- `pnpm card-status` now validates all JSON discriminator fields (trigger.on,
  effect.type, condition.type, cost.type, duration) against the TypeScript
  unions in types/index.ts. Cards with invalid field names show as
  `invalid-field` category. Run after any card wiring to catch typos like
  `start_of_turn` (should be `turn_start`) that silently no-op at runtime.
  Run it before claiming any "100% complete" status.
- Grep `packages/engine/src/cards -e approximation` should always return zero
  matches. If it doesn't, something slipped through review.

**Sequential effect triggeringCardInstanceId (CRD 6.1.5.1):**
When applying `sequential` costEffects/rewardEffects via `applyEffect`, always forward `triggeringCardInstanceId`.
When creating a `choose_may` PendingChoice for a sequential effect, store `triggeringCardInstanceId` on the choice
so the accept path can resolve the exert correctly.
```typescript
// WRONG — triggeringCardInstanceId lost, exert on triggering_card silently no-ops
state = applyEffect(state, costEffect, sourceId, playerId, definitions, events);
// CORRECT
state = applyEffect(state, costEffect, sourceId, playerId, definitions, events, triggeringCardInstanceId);
```
