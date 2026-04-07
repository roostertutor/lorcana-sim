# CLAUDE.md — Operating Manual for Claude Code
# This file is auto-loaded every session. Keep it concise.
# Do NOT duplicate content from SPEC.md, DECISIONS.md, or CRD_TRACKER.md.

## Project

Headless Lorcana TCG analytics engine — simulates thousands of games
to produce deck analytics and win rates. NOT a human-playable simulator.

## Status

- engine:    done (240 passing, 0 todos). CRD audited. Tests split: reducer.test.ts (CRD), set1.test.ts, set2.test.ts.
- simulator: done (46 passing). Layer 3 invariants passing. RL bot implemented (Actor-Critic + GAE).
- analytics: done (15 passing).
- cli:       done. analyze, compare, query, learn.
- ui:        done. 7 screens, React+Vite. Responsive (mobile/tablet/desktop). Full-screen game board (no header/nav in-game).
- testbench: done. Interactive game board with bot opponent. Replay mode + undo. Utility strip (deck tile, inkwell, discard tile). Card action popover anchored to clicked card (fixed-position, works on all breakpoints). Keyword badges, exerted rotation/grayscale, damage counter, summoning sickness overlay. Play zone reset on leave (CRD 1.9.3).
- cards:     sets 1 + 2 complete. Set 1: 216 entries, all abilities implemented. Set 2: 216 entries, zero approximations.
- sets 2–11: imported as stubs (keyword-only, 2504 total cards incl. dual-ink). Run `pnpm import-cards --sets N` to refresh.

## Quick Reference

```bash
pnpm test                # all tests
pnpm test:watch          # TDD (engine)
pnpm typecheck           # known errors in cli (missing @types/node) only
pnpm dev                 # UI at localhost:5173
pnpm import-cards        # fetch cards from Lorcast API
pnpm learn               # train RL policy (see --help)
```

## Docs (read on demand, not every session)

| File | Purpose | When to read |
|------|---------|-------------|
| docs/SPEC.md | Full spec: APIs, types, build order | Starting a new package/feature |
| docs/DECISIONS.md | Why decisions were made | Before proposing architecture changes |
| docs/CRD_TRACKER.md | CRD v2.0.1 rule-to-engine map | Implementing/fixing game rules |
| docs/CARD_ISSUES.md | Card implementation gaps | Importing new sets / fixing card bugs |
| docs/IMPLEMENTING_A_SET.md | End-to-end playbook for implementing a set | Starting a new set |
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
