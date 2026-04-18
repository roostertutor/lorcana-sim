# UI Audit — 2026-04-17

Baseline commit: `fcb7006`

**Filename convention:** `<surface>_<commit>_<viewport>.png`
Example: `lobby_fcb7006_mobile.png`, `lobby_fcb7006_desktop.png`

**Viewports:** `mobile` (iPhone 13, 390×844), `desktop` (1440×900)

**Reference captures** go in `duels/` with the same surface name (no commit suffix): `lobby_mobile.png`, `lobby_desktop.png`.

---

## Surfaces to capture

**Note:** Filenames use `us-<surface>.png` and `other-<surface>.png` (no commit suffix). Baseline commit still tracked in manifest.

### Pure chrome (no forced layout — highest leverage)
- [X] landing-lobby-list-lobby-detail (combined in single capture)
- [X] victory-screen
- [X] mulligan
- [X] victory-screen
- [X] deck"builder"
- [ ] settings (deferred)
- [ ] auth-signin (deferred)

### Mixed (game forces layout, chrome wraps)
- [X] board-midgame
- [X] challenge-mode-toast
- [X] card-inspect-modal
- [X] hand-reveal
- [X] resolving-triggered-abilities
- [X] choice-picker (3 variants)
- [X] board-turn1
- [ ] action-popover (other uses the inspect modal for that)
- [ ] deck-viewer same as deck"builder" above
- [X] discard-viewer (deferred)

### Signature features (lean-in targets)
- [X] replay-scrubber
- [ ] active-effects-pill (deferred)
- [ ] stat-delta-badge (deferred)
- [ ] sandbox-injector (deferred)

**Captured:** 12 desktop pairs. **Viewport:** desktop only (mobile deferred).

---

## Per-surface reactions

Rating key:
- **D** — "this is duels.ink" → too much overlap
- **G** — "this is a card game app" → generic, no identity
- **O** — "this is [our app]" → identity working
- **Weak** — not D or G but info-poor vs. duels (functionality gap)

### Pure chrome

| Surface | Desktop | Note |
|---|---|---|
| landing-lobby-list-lobby-detail | **O** | "headless analytics engine" tagline + solo-vs-bot centered feels distinct (dev-tool vibe). Duels is clearly ladder product with heavy nav. No overlap. |
| victory-screen | **O chrome, info-poor** | Modal style is ours (orange/blue buttons). But duels shows **final score 22-0** + View Game Log / Rematch; ours just says "You won". Post-game should be story-end per memory. |
| mulligan | **G** | Centered modal with 7 cards + "Keep All" blue button. No play/draw indicator, no signature element. Duels shows On-The-Play / On-The-Draw pills + card preview toggle. Generic. |
| deckbuilder | **Weak** | Bare text list, no card art at all. Duels has card-art grid, cost curve, set-color filter chips. This is a functionality gap as much as chrome. Unusable for actual deckbuilding. |

### Mixed (game + chrome)

| Surface | Desktop | Note |
|---|---|---|
| board-turn1 | **G** | Undifferentiated black zones with "No cards in play" text. Duels uses purple-top / green-bottom color zoning — biggest signature they have. Ours reads as under-designed. |
| board-midgame | **G** | Cards tiny, no visible drying overlay or stat deltas. Duels has rich zoning, drying glow, clear inkwell counters, 15 LORE display. We have these in code per UI memory — not showing through. |
| challenge-mode-toast | **O** | Red pill at top is low-key and ours. Duels does a red beam + reticle + damage-preview floating number — more dramatic but louder. Keep our pill. |
| card-inspect-modal | **O** | Active Effects section is our signature (memory lean-in target). Duplicate entries visible though — bug. |
| discard-viewer | **G** | Tiny centered modal. Both apps near-identical and utilitarian. Pure utility surface, not worth investing. |
| hand-reveal | **O** | Ours shows opponent's revealed hand as a card grid in a modal. Duels just text-logs it. Minor win. |
| resolving-triggered-abilities | **Weak** | Ours is a plain list of ability names. Duels shows card thumbnail + full oracle text + Your/Opponent split + Decline option. Functionality + chrome gap. |
| choice-picker-1 (Bodyguard) | **Weak** | Text-only "Use ability / Skip". Duels has card thumbnail + "Enter Ready / Enter Exerted" buttons that match oracle wording. Ours is confusing. |
| choice-picker-2 (Return to hand) | **O, spare** | Modal style is ours. Missing: which card triggered this + oracle text. Duels's header has full effect wording. |
| choice-picker-3 (Target select) | **O** | Modal-with-thumbs paradigm. Duels does on-board beam targeting. Completely different approach; ours is more mobile-friendly. Keep. |

### Signature features

| Surface | Desktop | Note |
|---|---|---|
| replay-scrubber | **O** | Full-width timeline + "Take over here" branch button is unique to us. Duels is just playback speed controls. Lean in — this is the creator-tool wedge. |

---

## Summary counts

- **D (duels.ink clone):** 0 surfaces — no pairs read as copies. Past the floor.
- **O (our identity):** 7 — landing, victory chrome, challenge toast, card inspect, hand reveal, choice-picker 2/3, replay scrubber.
- **G (generic):** 4 — mulligan, board-turn1, board-midgame, discard viewer.
- **Weak (info-poor vs duels):** 4 — deckbuilder, resolving-triggered, choice-picker-1, victory-screen info.

**Top structural observation:** duels's biggest signature is **color-zoned play area** (purple top / green bottom). Ours is uniform dark gray, which reads as "dev tool / analytics console." Is that a feature or bug? Depends on audience positioning (memory says creator tool + data engine = positioning *is* the dev-tool vibe). Decide before touching board chrome.

---

## Divergence targets — prioritized

### Tier 1 — ship-blockers (bad reads)
1. **Deckbuilder**: add card-art grid + cost curve + color/cost filters. Current text list isn't a deckbuilder, it's a deck dump. Functionality gap first, identity second.
2. **Victory screen**: add final score, turn count, lore-over-time sparkline. Memory says post-game is "end of the game's story" — this is the highest-identity surface and we're doing least with it.
3. **Mulligan**: add play/draw indicator. Optional lean-in: show a "draw quality" stat since we're an analytics engine (nobody else can do this).

### Tier 2 — generic, upgrade
4. **Board zone coloring — explicit decision needed**: zone or don't. If zone: pick a color scheme that's ours (cool/neutral tints, not duels's purple+green). If don't: add another readability signal (accent-color key to active player's ink, subtle top/bottom bar).
5. **Triggered-abilities picker**: show card thumbnail + oracle text + "decline" option. Functionality gap.
6. **Choice picker 1 (Bodyguard-style)**: add card thumbnail, clearer button labels matching oracle wording.

### Tier 3 — signature lean-ins
7. **Replay scrubber "Take over here"**: style it as a signature creator element. Currently fades into the timeline strip.
8. **Active Effects section** in card inspect: fix duplicate entries, give it visual prominence. Memory flags this as a lean-in target.
9. **Post-game analytics panel**: bot evaluation line, lore curve, key-turn markers. Pair with #2.

### Tier 4 — leave alone
- landing, card inspect, hand reveal modal, challenge toast, choice picker 2/3, discard viewer.

---

## Open questions

- **Color zoning decision**: go or no go? (Tier 2 item 4 blocks board-surface work.)
- **Deckbuilder scope**: minimum viable card-art grid, or full rebuild with filters? (Tier 1 item 1.)
- **Mobile viewport**: worth doing a second pass on mobile for Tier 1 surfaces, or trust they follow?
