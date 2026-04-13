# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

---

## GUI: `choose_amount` number picker for `isUpTo` effects

**From:** Engine session (2026-04-12)

Engine now surfaces `choose_amount` pending choice for "up to N" effects in interactive mode. GUI needs a number picker in PendingChoiceModal:

- Read `pendingChoice.min` (usually 0) and `pendingChoice.max`
- Display +/- buttons or clickable number row (0, 1, 2, ..., max)
- Confirm button dispatches `RESOLVE_CHOICE` with `choice: selectedNumber`
- `pendingChoice.prompt` has the text (e.g., "Remove how much damage? (0–3)")

---

## GUI: Stat modifier badge shows clamped delta instead of actual modifier

**From:** Engine session (2026-04-12)

GameCard.tsx line ~210 computes `sDelta = strength - (def.strength ?? 0)` where `strength` is from `getEffectiveStrength` (clamped to 0 per CRD 6.6.2). Elsa (2 {S}) with -3 {S} debuff shows "-2" instead of "-3".

**Fix:** Sum `timedEffects.filter(te => te.type === "modify_strength").reduce(sum, te.amount)` + `staticBonus?.strength` directly for the badge instead of computing delta from the clamped effective value.

---

~~## Engine: `choose_amount` re-entry loop~~ **DONE**

Fixed — `isUpTo: false` set on overridden effect.

---

~~## Engine: `return_to_hand` missing `count` on pending choice~~ **DONE**

Fixed — `count: effect.target.count ?? 1` added.

---

~~## Engine: Set 3 Ursula - Deceiver missing `reveal_hand`~~ **DONE**

Fixed — `reveal_hand` added before `discard_from_hand`.

---

## GUI: `card_revealed` event — show revealed cards to all players

**From:** Engine session (2026-04-12)

A new `card_revealed` GameEvent was added so the GUI can display cards that are
revealed to all players during search and look-at-top effects.

### New event type

```typescript
{ type: "card_revealed"; instanceId: string; playerId: PlayerID; sourceInstanceId: string }
```

- `instanceId` — the card being revealed
- `playerId` — the player who controls the revealing effect
- `sourceInstanceId` — the card/ability that caused the reveal

### Where it fires

| Path | Trigger |
|------|---------|
| `search` effect with `reveal: true` | Card found in deck, about to move |
| `look_at_top` → `one_to_hand_rest_bottom` (bot mode) | Bot auto-picks matching card |
| `look_at_top` → `one_to_hand_rest_bottom` (interactive) | Player picks from `choose_from_revealed` |
| `look_at_top` → `one_to_play_for_free_rest_*` | Matching card played for free |
| `look_at_top` → `may_play_for_free_else_discard` | Top card revealed (Kristoff's Lute) |
| `look_at_top` → `reveal_until_match_to_hand_shuffle_rest` | All flipped cards + match (multiple events) |

### Search cards with `reveal: true` in JSON

Alma Madrigal (set 4), Minnie Mouse - Drum Major (set 5), The Islands I Pulled
from the Sea (set 6), Hiro Hamada - Robotics Prodigy (set 6), The Glass Slipper
(set 7), Antonio Madrigal - Friend to All (set 8), Yzma - On Edge (set 8).

Merlin - Intellectual Visionary (set 5) searches the deck but does not say
"reveal" in its oracle text, so it does not have the flag.

### GUI work needed

1. **Reveal animation/toast** — When `events` contains `card_revealed`, briefly
   show the card face to both players (~2s modal, toast, or card flash).

2. **Multiple reveals (Fred Giant-Sized)** — `reveal_until_match` can emit
   multiple `card_revealed` events in sequence. Consider fan/stack display
   rather than individual toasts.

3. **`choose_from_revealed` already works** — The pending choice picker already
   shows `revealedCards` during selection. The new event fires **after** choice
   resolution to tell the opponent which card was taken.

4. **Opponent visibility** — `playerId` = who revealed. Both players should see it.
