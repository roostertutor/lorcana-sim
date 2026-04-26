# BACKLOG.md
# Parked design / strategy decisions and deferred features.
# Created 2026-04-25.

## What this is vs HANDOFF vs ROADMAP

| Doc | Purpose | When an item belongs here |
|---|---|---|
| `docs/ROADMAP.md` | Committed sequenced product plan | "We are going to build this, in this order, for these reasons." |
| `docs/HANDOFF.md` | Active cross-agent work queue | "Another agent type needs to pick this up next." Open items only — delete on completion. |
| `docs/BACKLOG.md` *(this doc)* | Parked ideas / deferred decisions | "We considered this, decided not to ship it now, and have a trigger condition for reconsidering." |

### Convention

Each entry should answer:
- **What was considered** — the actual idea
- **Why it's parked** — what made us defer
- **Trigger to reconsider** — concrete condition (metric, milestone, user signal) that flips the decision
- **Expected scope** — rough blast radius if we did build it

If an entry has no trigger condition, it's not parked — it's lost. Either give it one or move it to ROADMAP/HANDOFF.

---

## UI / Design

### Bottom nav on mobile

**Considered**: Move the tab nav (`Decks`, `Multiplayer`) from the top chrome to a bottom-fixed bar on mobile, leaving only logo + avatar at the top. Standard pattern in Twitter/X, Discord, Instagram, Reddit, Spotify mobile apps. Frees the top chrome entirely; matches "less chrome, more game" framing in `STRATEGY.md`.

**Why parked (2026-04-25)**:
- Only 2 tabs today — top bar already costs ~0px of effective space.
- iOS Safari's bottom URL bar competes with bottom nav; layout jank during chrome-collapse.
- `100vh` lies on mobile browsers; pinned bottom elements can be hidden under URL bar.
- `env(safe-area-inset-bottom)` returns 0 outside PWA — can't pad-clear the home indicator the same way.
- Bottom nav truly shines in PWA standalone mode where browser chrome is gone. We don't yet have meaningful PWA install rates.

**Trigger to reconsider**:
- Tabs grow to 4+ items (top bar starts overflowing painfully), OR
- PWA install rate becomes a real metric we're tracking, OR
- Mobile gameboard redesign earns its own first-class layout pass and we need top-chrome budget back.

**Scope if built**: ~2 hrs. Conditional layout (`@media (display-mode: standalone)` or always-on for mobile), update Shell to render tabs at bottom on `< sm`, ensure deckbuilder sticky-bar still composes correctly.

---

### Auto-hide top chrome on scroll

**Considered**: Hide the consolidated top bar (53px) when the user scrolls down, restore on scroll-up. Same pattern Safari uses for its own URL bar. Saves the full chrome height while in flow.

**Why parked (2026-04-25)**:
- Just shipped the chrome consolidation (90px → 53px). Diminishing returns.
- Adds layout complexity and potential jank when chrome appears/disappears.
- The deckbuilder already has its own sticky save bar that overlays Shell on scroll — adding chrome auto-hide on top of that risks stacking-order surprises.

**Trigger to reconsider**:
- User feedback that 53px still feels too much on long scroll surfaces, OR
- We add a per-page sticky chrome bar (like the deckbuilder's) and want to free vertical budget for it.

**Scope if built**: ~1 hr. Single scroll listener, transform translateY on header, threshold to avoid hair-trigger flicker.

---

### iOS mobile chrome-collapse — revisit for extra vertical space

Discussed 2026-04-22. On iPhone Chrome/Safari, the URL bar shrinks and the bottom bar hides when the document body is scrolled — reclaiming ~60px of vertical. PWA mode (already shipped) eliminates chrome entirely for users who install; this note is for non-installed browser fallback.

**Constraints (verified)**:

- iOS only collapses chrome on **user-initiated touch-scroll gestures**. Programmatic `window.scrollTo` does NOT count (that trick died ~iOS 8). Tap gestures don't count either.
- Sub-container scroll (`overflow: auto` div) does NOT trigger collapse. Must be document-level scroll.
- If page isn't taller than viewport, there's nothing to scroll → bars stay full-size forever. Current `100vh` layout hits this.

**Proposed approach (not yet implemented)**:

1. Global `100vh` / `h-screen` → `100dvh` sweep. `dvh` re-measures as bars hide/show; board re-flows into reclaimed space. `svh` (small) and `lvh` (large) available for cases where you want a fixed target.
2. `overscroll-behavior: none` on `html, body` to kill pull-to-refresh rubber-banding that un-collapses bars.
3. On the gameboard route only: make body `minHeight: calc(100dvh + 60px)` so there's a scroll buffer. Once user performs any drag/swipe past threshold (~30px), set `document.body.style.overflow = "hidden"` to freeze the scroll position and keep bars collapsed.
4. Keep a `pt-safe` / `env(safe-area-inset-top)` buffer so top-edge taps don't re-trigger the chrome reveal zone.

**Known gotchas**:

- Still requires a user gesture to trigger — no instant collapse on load
- Tapping near top screen edge can re-show bars (iOS system behavior, no CSS workaround)
- iOS sometimes re-shows bars after ~5s of inactivity in non-PWA Safari, undocumented behavior, varies by iOS version. Expect ~90% effectiveness.

**Rejected alternatives**:

- Programmatic auto-scroll on load → dead on modern iOS
- Fullscreen API → only works on `<video>` elements in iOS Safari/Chrome
- Modal-tap-triggers-collapse → taps don't count as scroll gestures

**Trigger to reconsider**: drop-off data suggesting first-visit mobile users bounce due to cramped layout. PWA covers the engaged users.

---

### MTGA-style "shortened" card rendering in play zones

Idea for the board: crop cards in play to ~top half of the source image so only art + name + stats show, hiding the unreadable rules-text block. MTGA and old Pixelborn Lorcana do this; duels.ink keeps the full card. Matches the "chrome that differentiates vs content forced by genre" distinction in `feedback_visual_identity.md` — this is chrome, we can diverge.

**Realistic vertical-space gains** (measured against current card sizes in `GameCard.tsx`):
- Desktop play card (`lg:w-[120px]`, 168px full): crop at 5:3.5 → 84px. Save ~84px per row × 2 play zones = ~168px reclaimed (~15-20% of a 900px viewport).
- Mobile play card (`w-[52px]`, 73px full): crop at 5:3.5 → 36px. Save ~37px per row × 2 = ~74px (~10% of an 844px iPhone viewport).
- MTGA-style 5:4.5 (keeps stats bar, drops only the rules-text block): roughly half the savings — ~80px desktop, ~35px mobile.

**What has to come with it**:
- Hover/long-press preview flow must show the full card so users can still read rules when they need to (covered by the pending "hover preview on play-zone cards" + "long-press mobile equivalent" items discussed but not yet scheduled).
- Re-place keyword icons, damage counters, drying overlay, stat-delta badges for the shorter card.
- Consistent identification: card name must stay visible at the top of the cropped tile so hand→play recognition doesn't break.

**Consider gating the crop by viewport / orientation.** Not every surface needs it:
- Landscape-phone (very short vertical): biggest win — apply the crop.
- Portrait-phone: meaningful win, probably apply.
- Desktop: usually vertical space isn't tight; full card fits fine. Could leave as-is or apply a milder 5:4.5 crop.

A Tailwind class like `landscape-phone:aspect-[5/3.5]` lets the crop only engage where it actually pays rent. Matches the existing `landscape-phone:` breakpoint used elsewhere in `GameCard.tsx`.

**Trigger to reconsider**: deckbuilder work lands and there's a dedicated session for board chrome, OR mobile gameboard redesign (P1 in STRATEGY) is scheduled.

---

### Deckbuilder follow-up polish for `/decks/:id`

Captured during the 2026-04-19 GUI session after the MTGA-style split + box-art + variants stack landed. Not blocking — tile view looks good, keep these for a future polish pass:

1. **Deck-row arrangement.** Rows currently render flat (cost asc → name) inside a single scroll area. Options: group by card type (characters / actions / items / locations) with collapsible headers, or group by cost bucket with inline cost-curve bars. MTGA groups by type; Moxfield lets you pick. Worth considering once more decks are real-world tested.

   Also: each row has too much horizontal content for the narrow 340px-or-so column — cost badge + truncated name + ink dots + [−][N][+] + ✕.

   Concrete target (duels.ink row for reference): `cost | color symbol | long-truncated-name (e.g. "Scrooge McDuck - Afficio...") | variant picker | [−] X/Y [+]`. No ✕ — removal is implicit when [−] takes qty from 1 to 0. Name gets more horizontal room because the trailing stepper is compact and the row drops the ink dots pair in favor of a single color symbol (we already ship proper Lorcana ink icons at `packages/ui/public/icons/ink/`).

   Minimum changes to match that target in our DeckBuilder row:
   - Drop the trailing ✕ button (− at qty 1 removes the entry).
   - Replace ink-dot pair with a single ink icon per card (we have them — `/icons/ink/<color>.svg`).
   - Move qty to `X/Y` format (matches CardTile stepper already).
   - Pull stats/meta off its own line — put it inline or drop it since stats are visible in inspect.
   - Surface the variant picker per-row (currently only on the CardTile in the browser grid) so users see deck-level variant choices at a glance.

   All optional, but together they'd dramatically reduce row clutter and improve name legibility in the narrow column.

2. **Export options.** Today we have plaintext export (round-trips with Inkable / Dreamborn). Useful additions:
   - **Image export** — render the deck list as a PNG for sharing / social. Use canvas or html-to-image from a formatted DOM node. Creator tooling per `project_near_term_priorities.md`.
   - **Registration sheet** — the paper form for official events, with player info + card list in the Ravensburger tournament format. PDF export probably, or printable HTML.

3. **Known good:** My Decks list page with deck box-art tiles reads well — don't re-redesign unless there's a specific complaint.

4. **Consider: flip to browser-primary + deck-in-drawer layout** (duels pattern). Currently we're editor-primary + browser-opt-in. Duels treats browsing as the main activity and slides the decklist out from the side. Mobile-friendly analogue: bottom sheet for the deck (MTGA mobile does similar). Worth considering if users report they want more browsing surface area. It's a non-trivial layout refactor — both `<DeckBuilderPage>` structure and CardPicker sizing change.

**Trigger to reconsider**: dedicated polish session for deckbuilder, OR user complaints about row density / browse vs. edit primacy.

---

### Deckbuilder variant picker → icon-based dropdown (once rarity icons ship)

Current deck-row variant picker cycles through available variants on click (`Reg → Ench → Promo → Reg …`). Works but users can't see all options until they click through. Text labels are cryptic for users unfamiliar with Lorcana's 6-variant vocabulary.

When rarity icons ship (assets/icons/rarity/ or similar), swap the cycle-on-click for a compact popover menu:

- Button shows current variant as a small icon
- Click opens a dropdown listing all variants with icon + label (e.g. 🔶 Regular · ✨ Enchanted · 🌟 Iconic · ⚜️ Epic · 🎖 Promo · 🎟 Special)
- Click a row selects + closes
- Same pattern as the existing group-by dropdown (DeckBuilder.tsx) and saved-decks combobox, so it'll match the in-app chrome

No engine changes — same `DeckEntry.variant` model. Pure UI refactor in `DeckBuilder.DeckRow`.

**Trigger to reconsider**: rarity icon assets land in the repo.

---

### Drag-and-drop reordering — shared `ReorderableCardRow` for hand + choose_order modal

**Considered**: A single `ReorderableCardRow` component used in two places:

1. **`PendingChoiceModal` for `choose_order`** — replace tap-in-order with drag-into-position. Cards start in some order (engine-given), user drags to rearrange, confirm sends final order to engine. MTGA-style card row with "Top of deck" / "Bottom of deck" labels at the ends.
2. **Hand strip** — drag cards within hand to reorder display. Pure cosmetic (engine treats hand as a set, not a sequence). Useful for keeping high-priority cards visible in a hand that overflows.

```tsx
<ReorderableCardRow
  cards={cards}
  onReorder={(newOrder) => ...}
  topLabel="Top of deck"   // optional, modal-only
  bottomLabel="Bottom of deck"
  density="hand" | "modal"
/>
```

Modal: `onReorder` updates choice resolution targets. Hand: `onReorder` writes to localStorage (client-only) or to a `displayOrder` field if persistence-across-reconnects matters.

**Why parked**:
- **Tap-in-order works today** for `choose_order` (we just simplified it 2026-04-25 — dropped the duplicate-cards preview strip in commit `e32177e`). The killer use-case for drag is *adjustments* ("I picked Belle for slot 1 but actually Tiana should be first" — drag swaps cleanly; tap requires clearing tail of sequence and re-tapping). Adjustment friction hasn't surfaced as a real pain point yet.
- **Hand reorder is cosmetic only** — engine doesn't care. Discoverability problem ("you can drag these" has no visual affordance), so low ROI without onboarding chrome.
- **Mobile drag is non-trivial** — hand needs `touch-action: pan-x` for horizontal scroll; drag wants `none`. Resolution requires either long-press-to-lift (200-400ms latency) or explicit "rearrange mode" toggle. Modal use-case is easier (no scroll conflict).
- **Risk of feature creep** — building the shared component just to share code with hand reorder is the trap. Modal is the actual win; hand is "we have the tech, why not."

**Trigger to reconsider**: any one of —
1. Playtesting surfaces choose_order *adjustment* friction (users complaining tap-in-order is annoying when they want to swap cards mid-sequence).
2. A user explicitly requests reorderable hand (signal that the missing affordance is noticed).
3. A creator-tooling polish pass is scheduled and "premium-feeling interactions" become a deliberate investment.
4. We notice duels.ink users on mobile reorder hand reflexively in our screenshot tests and dropping it makes us look thinner.

**Expected scope**: ~2 sessions.
- Session 1: build `ReorderableCardRow` + modal integration. Drop-in replacement for the existing `choose_order` picker. ~1 day.
- Session 2: hand integration + mobile gesture polish (long-press lift OR rearrange-mode toggle). ~half-day.

**Build modal-first, ship, evaluate.** Hand reorder is a follow-on if it earns its keep, not a co-shipped feature.

---

## Strategy / Product

### Illumineer's Quest co-op mode as a unique feature

Ravensburger's Illumineer's Quest products (Deep Trouble = quest1, Palace Heist = quest2) are **co-op PvE** — 1-2 players vs. a scripted boss deck with special rules. duels.ink and every other Lorcana client today is PvP-only; co-op Quest mode is a product differentiator this app could own.

Fits the strategic direction: the moat is the engine + bot + analytics flywheel, and the product is a creator/play client that feeds the clone-trainer. A scripted-boss mode is a natural extension of the existing RL bot infrastructure — a Quest boss is just a deterministic policy with special "boss-only" card primitives.

**What it takes to build**:
- Data: source the true PvE-exclusive cards (Anna — Ensnared Sister and similar scripted-encounter cards). Ravensburger's API doesn't expose them under `quest1` / `quest2` filters (those only return main-set cards that happen to ship in the Quest box). **Lorcast API does carry them** — use `scripts/import-cards.ts` (Lorcast-sourced) as the PvE card source. Store under `card-set-Q1.json` / `card-set-Q2.json` with `setId: "Q1"` / `"Q2"` — deliberately outside `CORE_LEGAL_SETS` / `INFINITY_LEGAL_SETS` so they never leak into constructed.
- Engine: `GameFormat` gains `"quest1" | "quest2"` with `Q1` / `Q2` as legal sets. Quest-exclusives become playable in that mode only.
- Engine: Quest-specific mechanics — boss deck shuffling rules, "location-like" quest objectives, turn-order variants (co-op side-by-side). Most are authorable as new Effect/Trigger primitives.
- Simulator: scripted boss policy (not RL) — reads from a deck script, plays a deterministic sequence. Simpler than Actor-Critic.
- UI: co-op board layout (two teammates + boss) — a new GameBoard variant. Lobby flow for pairing up vs. the boss.

**Why it pays rent beyond "cool feature"**:
- Lower skill floor than PvP — onboards new Lorcana players who don't want to lose to humans.
- Scripted-boss cards exercise engine primitives that PvP decks rarely use (huge AoEs, game-rule modifications), which surfaces rule-coverage gaps.
- Replays + analytics generalize — Quest games are still seed-deterministic, so the creator-tool flywheel applies.

**Trigger to reconsider**: Quest import task lands (lower bar) OR multiplayer is deployed and we want a non-PvP onboarding ramp (higher bar).

---

### Mobile layout identity — what to borrow vs what to invent

> **Note (2026-04-25):** This entry was written before the strategy reconciliation on 2026-04-24 that flipped the bet from "portrait-first signature" to "chrome-craft first, both phone orientations." See `docs/STRATEGY.md` for current commitments. The structural pattern observations below are still useful as input to the upcoming P1 phone gameboard redesign; the framing about identity vs duels has been updated in `STRATEGY.md`.

User compared the sandbox game board (portrait + landscape) against duels.ink's mobile layout. Several structural patterns were identified that could reclaim vertical space on phones, but the user correctly flagged the "at what point are we just copying" concern.

**Patterns observed in duels.ink (structural, not visual)**:
- **Corner-badge lore + deck count** — small squares at zone corners instead of a horizontal scoreboard strip. Saves ~20px vertical.
- **Pips-not-fan inkwell** — `3/7` text + icons instead of a fanned card strip. Saves ~40px per zone (~80px total). Tradeoff: loses "which card was inked this turn" info (face-up cards in the fan show this). Middle ground: pips by default, tap to expand full fan.
- **Peek-strip hand with expand-on-tap** — only top ~30-40% of hand cards visible, expand on gesture. More aggressive crop than our current 70px.
- **Full-screen trigger resolution page** — replaces the board entirely instead of overlaying a modal. Clean separation of "resolving" vs "playing."

**What's already landed (GUI agent)**:
- PWA manifest (standalone install, no URL bar)
- `landscape-phone` Tailwind screen `(orientation: landscape) and (max-height: 500px)`
- Height-adaptive play cards on phones (portrait + landscape)
- Safe-area padding for Dynamic Island / notch
- Sidebar hidden, gap/padding tightened, utility strip held at mobile sizes
- Hand strip cropped to 70px in landscape-phone

**What makes this app fundamentally different from duels.ink**:
duels.ink is a pure online-play app (play Lorcana against humans/bots). This app is also an **analytics engine** that happens to have a playable client. Core differentiators:
- Headless simulation of thousands of games for **deck win rates + analytics**
- **RL-trained bot** (Actor-Critic + GAE) — not just heuristic AI
- **Query system** for asking pattern questions across simulated games
- **Active Effects pill** on the board (quotes source card ability text, conditional evaluation) — duels.ink doesn't surface this
- **Card injector** with qty/zone/player/set controls for sandbox testing
- **Replay mode + undo** as first-class features
- Per-format **ELO** (bo1/bo3 × core/infinity) for multiplayer

The game board can be a diagnostic/testing tool as much as a play surface. Design decisions can lean into that — e.g. showing more game-state info (active effects, modifier sources, stat deltas) is a strength, not clutter for power users. duels.ink hides game state to reduce cognitive load; we can SHOW game state because deck-builders and analysts want it.

**Recommendation (predates 2026-04-24 strategy update)**: pick structural changes that play to the app's strengths (analytics-first, information-dense, diagnostic sandbox) rather than copying a pure-play app's "hide everything" approach. E.g.:
- Compact inkwell pips (biggest space win) BUT keep tap-to-expand showing actual inked cards (information this app's users care about).
- Keep the Active Effects pill prominent — it's a unique feature.
- Invest in unique interactions that serve the analytics/testing use case (card inspect on long-press, stat breakdown tooltips, quick save/load accessible in landscape).

Reference screenshots are in `C:\Users\Ryan\Downloads\other app screenshots\` (not in repo — IP-sensitive). Do not commit them.

**Trigger to reconsider**: P1 phone gameboard redesign session is scheduled (per ROADMAP).

---

## Data / DB

### Soft-delete on `decks` table for post-hoc analysis

Currently `deleteDeck(id)` in `packages/ui/src/lib/deckApi.ts` hard-deletes the row via Supabase. Once a user deletes a deck, we lose:
- The deck's final composition before abandonment
- The deck_versions history that had been accumulating
- Signal about what deck ideas users tried and discarded

**Suggested change** (DB/server agent):
1. Schema: `ALTER TABLE decks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`
2. `deleteDeck(id)` becomes a soft-delete: sets `deleted_at = NOW()` instead of `DELETE FROM decks`.
3. `listDecks` filters out rows with `deleted_at IS NOT NULL`.
4. Consider cascading to `deck_versions`: either leave them (references still resolve) or mirror a `deleted_at` column on versions too.

**Why we'd want this**: the clone-trainer / analytics direction benefits from knowing which decks users *abandoned* as much as which ones they kept. Hard-deleting erases that signal. A soft-delete keeps the row available for backend queries without exposing it in the UI list.

**UI-side impact**: none — `listDecks()` already returns only what it's given. Once the column + filter exist, the UI works unchanged.

**Out of scope here**:
- Admin UI to restore deleted decks (not needed for analytics).
- Periodic hard-delete job for rows older than N months (compliance concern that'd need product input).

**Trigger to reconsider**: clone-trainer pipeline is scheduled, OR we begin running deck-abandonment analytics, OR a user explicitly wants undo-delete.

Noted during a GUI session where the user asked whether Reset should keep deck history. Delete is the reset path (Delete → New Deck), but the DB should preserve the record for analytics even when the user removes it from their list.

---

### `decks` / `deck_versions` consolidation

**Considered**: Collapse the two-table shape. Three options: (a) drop `decks.decklist_text` and always read latest from `deck_versions`; (b) replace `decks.decklist_text` with `current_version_id FK → deck_versions.id`; (c) add a sync trigger to keep `decks.decklist_text` in lockstep with the latest version.

**Why parked (audited 2026-04-25)**: Two-table shape is intentional. `decks` carries non-versioned metadata (name, box_card_id, format_family, format_rotation) and is the clean FK target for `games.deck_id` / `matches.deck_id`. The redundancy hasn't actually drifted — `snapshotVersion()` in `packages/ui/src/lib/deckApi.ts:46` enforces it by convention.

**Trigger to reconsider**: (a) observed drift bug where `decks.decklist_text` and latest `deck_versions.decklist_text` diverge in production data, OR (b) we're already touching this area for another reason (e.g., adding `games.deck_id` FK and need to decide whether to point at deck or version).

**Expected scope**: ~half-day for option (b) — 1 schema migration + rewrite of ~6 deck-read paths in `serverApi.ts` / `deckApi.ts` + tests.

---

## Engine / Bot

### Reveal-info model — bots have oracle access

**Considered**: Two-layer design to stop bots from seeing hidden info. (1) Engine-side `buildObservation(state, viewerId)` filter that respects `lastRevealedHand.privateTo` and replaces hidden instances with `__HIDDEN__` sentinels. (2) Bot-side `KnownFacts` memory buffer that tracks "instance X seen in opponent hand at turn N until I see it leave." Hybrid recommendation: keep analytics bots as oracles (existing `policies/*.json` weights stay valid; symmetric cheating doesn't bias relative win-rates), build a separate `ObservedBot` adapter for sandbox / clone-trainer / MP.

**Why parked**: Explicitly deferred 2026-04-21 by user — not a current product priority. Analytics use case (the actual product) is fine with oracle bots since both sides cheat symmetrically. The cost is high: filter is ~half a day, but memory model is 1-2 weeks AND every existing trained policy would need retraining (none generalize from oracle to observation input).

**Trigger to reconsider**: any one of —
1. Multiplayer deployed and Stream 5 (supervised clone trainer) starts ingesting human game logs — clone fidelity requires bots that don't telegraph hidden info.
2. MP bot opponents ship as a feature (e.g. queue-filler bots when no human opponent available) and a user reports the bot "cheating" / making plays only possible with hand knowledge.
3. Sandbox clone-trainer calibration shows systematic bias traceable to oracle access.

**Expected scope**: ~half-day engine PR for `buildObservation` + `__HIDDEN__` sentinels (engine-expert). Then 1-2 weeks bot-trainer for `ObservedBot` wrapper, `KnownFacts` memory buffer, encoder updates, and full retrain of any policy in the observed-bot path. Detailed implementation sketch was preserved in HANDOFF git history (commit `e47d057` parent has the full original entry); pull from there rather than re-derive.

---

### Engine deferred / low-priority queue (CRD edge cases + GameEvent extensions)

Three small items engine-expert verified (2026-04-21) as legitimate gaps with no current card depending on them. Grouped here because each is small and the trigger is the same shape: a card or feature that actually exercises the gap.

**a. CRD 1.8.4 — strict simultaneity in `runGameStateCheck`**
- *Considered*: Rework cascading loop in `reducer.ts:7870` so banishes within a single pass are truly parallel (not iteration-order dependent).
- *Why parked*: No current card depends on within-pass ordering. 2P behavior is correct.
- *Trigger*: A 3+P variant ships, OR a "leaves play together" trigger (CRD 7.4.3) ships that's sensitive to within-pass banish ordering.
- *Scope*: Refactor to two-phase (collect-then-apply); ~1 day plus tests.

**b. CRD 6.5.4 / 6.5.7 / 6.5.8 — replacement edge cases**
- *Considered*: 6.5.4 (replaced events don't fire triggers — currently `damage_redirect` still emits damage triggers on the redirected path), 6.5.7 (multi-replacement ordering), 6.5.8 (same replacement can't apply twice).
- *Why parked*: No current card pair has competing replacements; Lilo's once-per-turn rule is enforced via a per-card counter rather than the general 6.5.8 rule.
- *Trigger*: New card ships with damage-redirect interaction where damage triggers must be suppressed, OR two replacements compete on the same event.
- *Scope*: ~1-2 days for suppression flag + ordering decision tree + tests.

**c. GameEvent system extensions**
- *Considered*: Richer event log, event-driven animations, sound hooks, expanded UI consumers beyond `card_revealed`.
- *Why parked*: No user-facing need yet; per `feedback_function_before_polish.md`, animations/sound deferred.
- *Trigger*: Sandbox creator-tool work needs richer per-event hooks (e.g. clip-export annotations), OR a UI polish pass prioritizes visible feedback for state mutations.
- *Scope*: Per-event consumer hooks are small (per consumer); the listing tool itself is already done via `pnpm catalog`.

---

## Server

### Server-side test infrastructure

**Considered**: Add vitest + `test`/`test:watch` scripts to `server/package.json`. Create `stateFilter.test.ts` (3 cases: public reveal_hand, private look_at_hand, post-reveal drift) and `lobbyService.test.ts` (format legality rejection). Wire `pnpm --filter server test` into CI.

**Why parked**: No CI exists yet; server bug rate is low (~1 fix in last 2 weeks); manual MP testing has caught issues so far; engine has the high-volume test surface.

**Trigger to reconsider**: any one of —
1. Railway deploy is being set up and we're adding CI in the same pass.
2. A second server-side anti-cheat / state-filter bug ships without coverage.
3. We add a >200-LOC server feature that warrants its own test file (matchmaking queue from MP UX Phase 3 is a candidate).

**Expected scope**: ~1 day for scaffolding + the two minimal test files.

---

## Creator tooling

### Clip / GIF export (combined design + implementation)

Highest-value creator-tool surface — GIFs embed natively on Discord/Twitter/Reddit/forums, a creator shares a cool play in 30 seconds with no video workflow. Was originally Priority #1 in `project_near_term_priorities.md` (2026-04-16); status hasn't been re-confirmed since the chrome-craft strategy reconciliation 2026-04-24.

**Considered (frame model)**: Snapshot-per-action pacing — one frame per engine action / meaningful `GameEvent`. Not motion-tween — GIFs sample at 10-15fps so 200ms CSS transitions get 1-2 mid-transition frames and look choppy. Each frame = rendered gameboard at that `GameState` + transient overlay callouts for the event(s) that just resolved, held for an event-keyed duration:
- Draw / ink / pass: 400ms
- Turn boundary banner: 500ms
- Play a card: 700ms
- Sing / Challenge / Quest: 800-900ms
- Damage resolution / banish: 1000ms

Capture mode: strip `transition-*` → `transition-none`, disable hover, freeze `animate-pulse` so the connection-status dot doesn't strobe.

**Considered (implementation)**: Clip mode toggle in `ReplayControls`. Hidden-mount per-frame capture via `html-to-image` (CORS-safe now that R2 migration landed 2026-04-21). Encode with `gifenc` in a worker. Presets: Discord (480p, ≤8MB), Twitter (480p, ≤15MB), HD (720p). Watermark + "clip this moment" shortcut from the live game-over modal.

**Dependency status**: R2 migration UNBLOCKED 2026-04-21 (commit `7d37d23`) — canvas capture no longer tainted. Caveat: R2's default public bucket has a ~20 req/s rate cap; clip render is bursty (~30 frames × ~30 cards = ~900 fetches). Mitigations: pre-cache visible images at clip start, OR provision a custom domain (eliminates the cap), OR fall back to lower-fps presets.

**Why parked (2026-04-25)**: Strategy reconciliation 2026-04-24 changed the headline wedge from "creator tooling priority #1" to "chrome-craft first." Need user re-confirmation that creator tools are still the next-after-mobile-UX priority before sinking 1-2 sessions of UI work.

**Trigger to reconsider**: any one of —
1. User confirms creator-tool wedge is still strategic priority post-chrome-craft pivot.
2. A creator / streamer requests the feature directly.
3. Mobile gameboard chrome-density redesign (P1 in STRATEGY) lands and we need the next P1 for the creator audience.

**Expected scope**: 1-2 sessions for full implementation. Pure DOM-to-canvas-to-GIF + picker UX, no engine/sim changes. Frame-model design above is reusable as the implementation prompt's spec.

---

