# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

---

~~## Engine: Add `isFaceDown` to CardInstance~~ **DONE**

**From:** GUI session (2026-04-11)

Added `isFaceDown?: boolean` to CardInstance. Set at all 5 creation sites:
- **Boost** (deck top → under): `isFaceDown: true` (CRD 8.4.2)
- **put_top_of_deck_under** effect (both applyEffect + applyEffectToTarget): `isFaceDown: true`
- **Shift** (base card goes under): `isFaceDown: false` (was in play)
- **put_self_under_target** (Roo pattern): `isFaceDown: false` (was in play)

UI can now read `state.cards[underCardId]?.isFaceDown` directly instead of inferring from parent keywords.

---

~~## Engine: Hydra Deadly Serpent uses DynamicAmount "X" (placeholder)~~ **DONE (previous session)**

Fixed in earlier session — Hydra uses `"last_damage_dealt"`. The `"X"` variant was removed from the DynamicAmount union.
