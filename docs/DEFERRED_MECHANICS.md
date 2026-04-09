# Deferred Mechanics — TODO

Mechanics not yet implemented in the engine. Run `pnpm tsx scripts/mechanic-gaps.ts` for the live list with affected cards. Run `pnpm card-status` for set-by-set totals.

## Status as of 2026-04-09 (closing batch)

- **2145/2145 named-ability cards wired (100%)** + **507 vanillas** = **2652/2652 (100%) effective coverage**
- **0 stubs across every set and promo printing** (sets 1–11, P1, P2, P3, cp, DIS, D23)
- Engine tests: **390 passing**

This file no longer tracks unimplemented mechanics — there are none. It remains as a record of (a) the wiring approximations that need a follow-up audit, and (b) the engine subsystems still worth tightening for full CRD fidelity.

## Approximation audit (follow-up)

A handful of cards are wired with simplifications because the strict CRD interpretation would require infrastructure not justified by analytics needs. Each is logged in its commit message; this list is the canonical reference.

| Card | Set | Approximation | Why |
|---|---|---|---|
| Moana — Kakamora Leader | 6 | "any number of your characters" → 1 character moved | Predates this batch. Engine has no multi-target choose-N flow for move_character. |
| Kristoff's Lute — MOMENT OF INSPIRATION | 11 | "play it as if it were in your hand" (normal cost) → free play; bot heuristic always plays | Would need a play-with-cost-payment branch through play_for_free or a reveal-then-prompt path. |
| Ariel — Curious Traveler | P3 | Drops the "must quest if able" clause; only `cant_action: challenge` is wired | Matches the Gaston Frightful Bully (set 10) and Rapunzel Ethereal Protector (set 11) precedent. Adding "must quest" needs a per-target action requirement enforced by the validator. |
| Jafar — High Sultan of Lorcana | 8 / P2 | "play THAT discarded character" → "play any matching Illusion character from discard" | Would need play_for_free.target to support a "specific instance from a specific zone" form. The current implementation widens the filter; in practice the just-discarded card is the only or most recent match. |
| Tuk Tuk — Lively Partner | 4 | "him AND another to the SAME location" → two independent location choices | Would need pendingChoice chaining to share a chosen location across two move_character resolutions. |
| Anna — Soothing Sister UNUSUAL TRANSFORMATION | 11 | "this card gains Shift 0" → self_cost_reduction amount 5 from hand, gated on `card_left_discard_this_turn` AND `has_character_named:Anna self` | Equivalent free-play cost in practice; the engine's Shift path reads `def.shiftCost` directly, so granting Shift via a static would require new validator + applyPlayCard plumbing. The cost-reduction approximation does not perform the cards-under transfer that real Shift would, but for analytics deck win-rate this matches the cost. |

The audit task is tracked separately. When revisiting, the question to ask each entry is: "would full fidelity meaningfully change deck simulation outcomes?" If yes, lift the approximation; if no, leave it documented and move on.

## How the gap report is structured

`scripts/mechanic-gaps.ts` outputs JSON with each label, count, sets, and example cards. With 0 stubs, the report is empty — the script remains as a regression check: any future card import that adds an unwired stub will surface here.

## Engine subsystems still worth tightening (not blocking)

These are quality-of-implementation items, not stubs. They don't affect the gap count but would improve CRD fidelity if revisited:

- **Replacement-effect layer** (CRD 6.5) — currently per-effect short-circuits (damage immunity, prevent_lore_loss, prevent_lore_gain, etc.). A unified replacement layer would let new cards declare replacements declaratively without touching every write-path.
- **Multi-pick choose_target** — many "choose N cards" effects currently auto-pick the first N (Queen Jealous Beauty, Dig a Little Deeper, Family Madrigal). For interactive UI sessions a true multi-select would help; for headless analytics the heuristic is fine.
- **Granted Shift / granted activated abilities from hand** — the gameModifiers `grantedActivatedAbilities` map handles in-play grants. Hand-zone grants (Anna's Shift 0) currently use the cost-reduction approximation above. A real implementation would need validator integration for the granted Shift path.
- **Forced-target taunt resolution interaction** — John Smith's `forced_target_priority` narrows `findValidTargets` results. This affects every chosen-target enumerator transparently, but doesn't yet interact with effects that surface non-`findValidTargets` choices (e.g. some `chosen` resolution paths in applyEffectToTarget that re-enumerate independently).

None of these block any current card.
