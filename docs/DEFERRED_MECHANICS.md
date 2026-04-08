# Deferred Mechanics — TODO

Mechanics not yet implemented in the engine. Run `pnpm tsx scripts/mechanic-gaps.ts` for the live list with affected cards. Run `pnpm card-status` for set-by-set totals.

## Status as of 2026-04-07

- **1982/2652 implemented (75%)** + **501 vanilla** = **2483/2652 (94%) effectively complete**
- **17 fits-grammar** cards remain (the genuine cherry-pick floor — mostly compound mechanics or vanilla Alert miscategorizations)
- **29 needs-new-type** + **122 needs-new-mechanic** = ~150 cards across **89 distinct labels** in the gap report
- Engine tests: **360 passing**

The categorizer was tightened end-to-end during this session; `fits-grammar` is now an honest "wireable with current primitives" tag.

## How the gap report is structured

`scripts/mechanic-gaps.ts` outputs JSON with each label, count, sets, and example cards. Top of the live list:

1. **Single-card mechanics** (most labels) — 1-3 cards each, niche
2. **Compound primitives** (~10 labels, 2-5 cards each) — sequential effects with cost-then-effect requiring deferred subsystems
3. **Architectural additions** — replacement-effect, multi-player choice queue, virtual-cost-modifier

## High-impact remaining mechanics

These are the largest unique gaps. See `mechanic-gaps.ts` output for affected card lists.

- **`replacement-effect`** (Rapunzel Ready for Adventure, Lilo Bundled Up) — CRD 6.5 layer
- **`virtual-cost-modifier`** (Atlantica Concert Hall ×2) — location-aware sing cost
- **`stat-floor`** (Elisa Maza ×2) — clamp `getEffectiveStrength` to printed
- **`for-each-opponent-who-didnt`** (Sign the Scroll, Ursula's Trickery) — multi-player refusal-counting pendingChoice
- **`play-same-name-as-banished`** (Hades Double Dealer, Bad-Anon ×2) — sequential `_resolvedBanishedName` carrier
- **`inkwell-static`** (Daisy Duck Paranormal Investigator ×3) — pre-inkwell-add replacement
- **`restricted-play-by-type`** (Pete Games Referee, Keep the Ancient Ways) — player-scoped TimedEffect
- **`stat-threshold-condition`** (Next Stop Olympus ×2) — "if you have a character with N {S}"
- **`ink-from-discard`** (Moana Curious Explorer ×2) — alternate ink source
- **`shift-variant`** (Anna Soothing Sister ×2) — Shift 0 conditional + event tracking compound

## Categorizer-detected compound false positives

The categorizer-tightening pass added ~68 NEW_MECHANIC patterns to detect compound cards. Each new label maps to a distinct missing primitive — see `scripts/card-status.ts` `NEW_MECHANIC_PATTERNS` for the full list. Notable groups:

**Trigger/event gaps**: `vanish-keyword`, `twice-per-turn-trigger`, `batched-sings-trigger`, `other-sings-trigger`, `opponent-exerts-trigger`, `opponent-damaged-trigger`, `chosen-by-opponent-trigger`, `nth-card-played-trigger`, `location-challenged-trigger`, `inkwell-count-trigger`, `shift-onto-self-trigger`, `exert-triggering-card`.

**Condition gaps**: `discard-replacement`, `underdog-condition`, `no-challenges-this-turn-condition`, `song-played-this-turn-condition`, `no-ink-put-this-turn-condition`, `card-under-event-condition`, `played-another-this-turn-condition`, `has-damaged-character-condition`.

**Effect gaps**: `bulk-discard-to-inkwell`, `play-from-inkwell`, `put-self-under-effect`, `cards-under-to-inkwell`, `play-from-discard-then-bottom`, `name-then-bulk-return-from-discard`, `dynamic-draw-from-target-damage`, `lore-transfer`, `grant-activated-to-own-timed`, `per-singer-dynamic`, `discard-any-number-dynamic`, `fill-hand`.

## How to make progress on these

Each gap is now small enough that a single focused session can knock out 5-10 mechanics. The pattern is:

1. Pick a label from `mechanic-gaps.ts` output
2. Read the affected cards' rules text
3. Add type + handler + test for the missing primitive
4. Wire the cards
5. Move the regex from `NEW_MECHANIC` (in `mechanic-gaps.ts` and `card-status.ts`) into `FITS_GRAMMAR_PATTERNS` with a fresh capability_id

The session memory `project_phase_a_cleanup.md` documents the workflow and gotchas in detail.
