# UI Audit — 2026-04-17

Baseline commit: `fcb7006`

**Filename convention:** `<surface>_<commit>_<viewport>.png`
Example: `lobby_fcb7006_mobile.png`, `lobby_fcb7006_desktop.png`

**Viewports:** `mobile` (iPhone 13, 390×844), `desktop` (1440×900)

**Reference captures** go in `duels/` with the same surface name (no commit suffix): `lobby_mobile.png`, `lobby_desktop.png`.

---

## Surfaces to capture

### Pure chrome (no forced layout — highest leverage)
- [X] landing
- [X] lobby-list
- [X] lobby-detail
- [ ] post-game-win
- [ ] post-game-loss
- [ ] loading-matchfound
- [ ] deck-list
- [ ] settings
- [ ] auth-signin

### Mixed (game forces layout, chrome wraps)
- [ ] board-turn1
- [ ] board-midgame
- [ ] action-popover (mobile + desktop)
- [ ] challenge-mode-toast
- [ ] card-inspect-modal
- [ ] deck-viewer
- [ ] discard-viewer

### Signature features (lean-in targets)
- [ ] active-effects-pill
- [ ] stat-delta-badge
- [ ] replay-scrubber
- [ ] sandbox-injector

---

## Per-surface reactions

For each surface, rate the screenshot test:

- **D** — "this is duels.ink" → too much overlap, redo
- **G** — "this is a card game app" → fine on forced layouts, miss on chrome
- **O** — "this is [our app]" → identity working

### Pure chrome

| Surface | Mobile | Desktop | Note |
|---|---|---|---|
| landing |  |  |  |
| lobby-list |  |  |  |
| lobby-detail |  |  |  |
| post-game-win |  |  |  |
| post-game-loss |  |  |  |
| loading-matchfound |  |  |  |
| deck-list |  |  |  |
| settings |  |  |  |
| auth-signin |  |  |  |

### Mixed

| Surface | Mobile | Desktop | Note |
|---|---|---|---|
| board-turn1 |  |  |  |
| board-midgame |  |  |  |
| action-popover |  |  |  |
| challenge-mode-toast |  |  |  |
| card-inspect-modal |  |  |  |
| deck-viewer |  |  |  |
| discard-viewer |  |  |  |

### Signature features

| Surface | Mobile | Desktop | Note |
|---|---|---|---|
| active-effects-pill |  |  |  |
| stat-delta-badge |  |  |  |
| replay-scrubber |  |  |  |
| sandbox-injector |  |  |  |

---

## Divergence targets

_Populate after capture pass. Ranked list of surfaces to redo, with what specifically reads as duels.ink/generic._
