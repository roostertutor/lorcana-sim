# Deferred Mechanics — TODO

Mechanics not yet implemented in the engine, with the cards they affect.
Each entry is a single-mechanic gap; the cards listed are blocked on it.

Regenerate live counts with `pnpm tsx scripts/mechanic-gaps.ts`.

---

## High-impact (3 cards)

### `play-same-name-as-banished`
Capture the banished card's name in a sequential effect chain (new `_resolvedBanishedName` carrier), then play a card with that name for free.
- [4] Hades - Double Dealer — `{E}, Banish one of your other characters — Play a character with the same name as the banished character for free.`
- [5] Bad-Anon - Villain Support Center (×2 dual-ink) — location grants an activated ability that itself plays a same-named character; combines with location-grant-ability + recursion.

### `inkwell-static`
Pre-inkwell-add replacement layer ("cards enter opponents' inkwells exerted").
- [10] Daisy Duck - Paranormal Investigator
- [P3] Daisy Duck - Paranormal Investigator (×2 dual-ink)

---

## Medium (2 cards)

### `for-each-opponent-who-didnt`
Multi-player pendingChoice that tracks refusal count, then applies a benefit `(opponentCount - acceptances)` times.
- [4] Sign the Scroll
- [4] Ursula's Trickery

### `virtual-cost-modifier`
Location-aware cost modifier that affects sing/play cost math for characters at the location.
- [4] Atlantica - Concert Hall
- [9] Atlantica - Concert Hall

### `restricted-play-by-type`
Player-scoped TimedEffect (not card-scoped) — `PlayerState.timedRestrictions` storage with expiry handling.
- [5] Pete - Games Referee
- [11] Keep the Ancient Ways

### `replacement-effect`
CRD 6.5 — "would X instead" replacement layer. Architectural addition that intercepts state changes before they apply.
- [10] Rapunzel - Ready for Adventure
- [11] Lilo - Bundled Up

### `play-from-under`
Persistent paid-play relaxation from the cards-under subzone (different from `play_for_free`).
- [10] The Black Cauldron (×2)

### `stat-threshold-condition`
Condition: "if you have a character with N {S}".
- [10] Next Stop, Olympus (×2)

### `shift-variant` (Anna only)
Conditional Shift 0 grant gated on event-tracking-condition (`card-left-discard-this-turn`). Two unimplemented mechanics combined.
- [11] Anna - Soothing Sister (×2)

### `stat-floor`
"Can't be reduced below printed strength." Thread `gameModifiers` through `getEffectiveStrength` and clamp at every consumer.
- [11] Elisa Maza - Transformed Gargoyle
- [P3] Elisa Maza - Transformed Gargoyle

### `ink-from-discard`
Ink-step alternate source — "you can ink cards from your discard."
- [11] Moana - Curious Explorer (×2)

---

## Single-card mechanics

### `no-other-quested-condition`
- [4] Isabela Madrigal - Golden Child — "if no other character has quested this turn"

### `group-cant-action-this-turn`
- [4] Isabela Madrigal - Golden Child — "your other characters can't quest"

### `multi-character-move`
- [4] Tuk Tuk - Lively Partner — move two characters to the same location atomically

### `chosen-for-support-trigger`
- [4] Prince Phillip - Gallant Defender — new trigger event for "is chosen for Support"

### `prevent-lore-loss`
- [5] Koda - Talkative Cub

### `opponent-chosen-return`
- [5] Mother Gothel - Unwavering Schemer

### `trim-hand`
- [5] Prince John's Mirror — "discard until you have N cards"

### `conditional-lore-lock`
- [6] Peter Pan - Never Land Prankster — "can't gain lore unless..."

### `inverse-sequential`
- [8] Flynn Rider - Breaking and Entering — "if they don't" branching

### `new-trigger-deals-damage`
- [9] Mulan - Elite Archer — "whenever this character deals damage to another character"

### `challenge-limiter`
- [10] Prince Charming - Protector of the Realm — "only one character can challenge"

### `new-trigger-exerts`
- [11] Bambi - Ethereal Fawn — "whenever this character exerts"

### `play-from-revealed`
- [11] Kristoff's Lute — "play it as if it were in your hand" (player still pays cost)

### `remove-ability`
- [11] Angela - Night Warrior — strip a keyword/ability from a target

### `super-bodyguard`
- [11] John Smith - Undaunted Protector — "must choose this character for actions and abilities"

### `virtual-ink-color`
- [P1] Hidden Inkcaster — "count as having {I} of any color"
