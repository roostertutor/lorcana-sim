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

### Mobile vs Desktop UX — remaining sections after Section C shipped

**Considered (2026-05-03)**: Multi-section punch list of mobile-vs-desktop chrome differences in non-gameboard surfaces. Original menu had six sections (A–F):

- **A. Lobby / multiplayer chrome** — **DONE 2026-05-03**, commits `ca4e434` (A1: navigator.share on mobile, full URL to clipboard on desktop, capability-aware icon swap — was copying bare 6-char code so recipient had to manually type /lobby/ABC123) and `109fe7e` (A2: touch-target audit, ~12 sites in MultiplayerLobby bumped to 44×44px to meet WCAG 2.5.5 / iOS HIG; segmented toggles + filter chips + row controls intentionally kept compact). **Reconnection banner re-scoped out** — there's no banner today, just the colored connection dot in BoardMenu; if a real banner ever lands it'll be net-new feature work, not a mobile/desktop delta. **QR code for cross-device handoff explicitly dropped by user 2026-05-03 — do NOT re-propose.**
- **B. Deckbuilder mobile pass** — card-grid columns by viewport, filter-bar collapse to bottom-sheet on mobile, decklist sidebar→sheet on mobile, card-inspect modal full-screen edge-to-edge on mobile, touch DnD strategy (long-press vs tap-to-add/remove), deck-export PNG mobile-save button.
- **C. Modal system standardization** — **DONE 2026-05-03**, commits `66e84c7` (variant API + ESC-stack + scroll lock + focus restore + ARIA + form input mobile keyboards) and `c02fea2` (`MODAL_SIZE` token system: sm/md/lg, with all 5 modals migrated and the deprecated `placement` prop removed).
- **D. Navigation chrome** — bottom tab bar on mobile (already a separate BACKLOG entry below — "Bottom nav on mobile"), back-button / swipe-back behavior audit across routes (especially in/out of lobby + game).
- **E. Forms & input polish** — `inputMode` / `autoComplete` audit (PARTIALLY DONE in commit `66e84c7` — lobby code, card search, card-add, trait, deck name covered. Remaining: `DevAddCardPage` numeric inputs (low ROI, internal tooling), and a hover-affordance audit — anything that only shows on `:hover` is invisible on touch; sites in `CardTile`, `BoardMenu`, etc. need tap-equivalents).
- **F. History / replays / decks** — `DecksPage` card density (stacked list on mobile vs columns on desktop), `ReplaysPage` scrubber touch zones / snap-to-turn buttons on mobile, `ComparisonView` swipe-between vs side-by-side.

**Why parked (2026-05-03)**: Section C took one focused session and shipped clean. User chose to pause here and revisit the rest in dedicated future sessions ("focus on one each" — explicit pushback against jumping between sections). Each remaining section is self-contained enough to ship as one commit pair (foundation + migrations) without holding the others hostage.

**What Section C unlocked for future sections**:
- `MODAL_SIZE.sm/md/lg` tokens — any new modal in any future section uses these (no width drift, no per-modal max-w decisions).
- `variant="auto"` shape — any new modal that should bottom-sheet on mobile is one prop.
- ESC-stack — nested modals work correctly out of the box; no per-modal handler wiring.
- Form-input pattern proven — same `autoCapitalize` / `enterKeyHint` / `inputMode` shape applies to any new input.

**Trigger to reconsider**: User asks for "next mobile UX section" — next up is **B (deckbuilder)** since A and C have shipped. B is the heaviest of the remaining sections and benefits most from `MODAL_SIZE.lg` (filter bottom-sheet uses it). Then **D (nav)** since it touches every page and best done after the screens themselves are stable. **E remainder** and **F** are quickest — sprinkle in alongside the bigger sections.

Suggested order (~~A~~ ~~C~~ shipped 2026-05-03): **B → D → E remainder → F**.

**Expected scope**: Each section is roughly the size of Section C — 1–2 sessions, 2 commits (foundation + migrations or audit + fixes). Total if all five ship: ~6–10 sessions across the whole punch list.

**Decisions explicitly NOT to revisit**:
- **QR code for lobby cross-device handoff** — user dropped it 2026-05-03, twice. Don't re-propose unless a streamer / event organizer specifically asks for it.

---

### Pluralization helper (`pluralize(noun, count)`)

**Considered**: Replace the small number of ad-hoc `+s` plural sites in the UI with a single `pluralize(noun, count)` helper. Mostly cosmetic — fixes things like "1 cards" / "Item/Locations" before they ship.

**Why parked (2026-04-28)**: P2.21a (commit `2a47ba2`) already cleaned up the `Item/Locations` heuristic in the play-restriction fallback. The remaining sites (count-based "N cards" footers, etc.) all correctly handle the singular case via inline `${n === 1 ? "" : "s"}` — not buggy, just verbose. Mostly bundle with another cleanup if you're already in the area. Trivially blocked by i18n (translation systems handle plurals via locale-aware rules; English `+s` heuristic doesn't generalize) — if i18n ever lands (separate BACKLOG entry above), this becomes mandatory infrastructure.

**Trigger to reconsider**:
- A new feature ships ad-hoc plural English that would benefit from a helper (e.g., "you have N cards in hand" + "you have N tokens" + "N opponents drew M cards" all want the same shape), OR
- i18n work begins (mandatory prerequisite — translation libraries handle pluralization via locale rules).

**Expected scope**: ~10 min if standalone (helper + 1-2 site migrations). ~half day as part of i18n setup (where it integrates with the locale system).

---

### Multi-language / i18n support

**Considered**: 100% English-literal codebase today. Every user-facing string (chrome, modals, log lines, prompts, button vocab, error messages) is hardcoded English. No translation infrastructure. P3.25 in the audit tracker originally proposed extracting every hardcoded string into a `strings.ts` const map as the prep step for i18n; the audit deferred it, then the user (2026-04-28) said "multilanguage would be a very nice to have" — parking the work here with proper trigger conditions.

**Why parked (2026-04-28)**: No active translation requirement. The product is English-only by default and the user base (current playtesters + future MP users) skews English-fluent. Implementing i18n is a multi-front sweep:
- Extract every hardcoded string in `packages/ui/` into a `strings.ts` const map (~3-5 hours; touches ~20+ files).
- Add a translation-key system (probably `react-i18next` or similar — adds a runtime dependency and bundle weight).
- Per-card translations come from card data (`def.fullName`, `def.rulesText`, `ability.storyName`, etc.) — Ravensburger publishes localized card data via their API (Lorcast may also have it). Need to extend `import-cards-rav.ts` to fetch + store per-locale fields, OR keep card data English-only and translate game-level prose only (lossy but simpler).
- Engine prose (log lines, prompts via `buildPrompt` from P1.14) — rewrite to use translation keys instead of inline English. Some of these prose strings are constructed via interpolation; need a key + variables shape.
- Multi-language testing — at least one non-English target locale to validate end-to-end (Spanish? French? — Lorcana has official localization in those + others).
- Plurals (P3.26 in audit — already deferred) becomes mandatory; `pluralize` helper can't punt to English's `+s` heuristic.
- RTL languages (Arabic, Hebrew) — not currently required if first targets are LTR.

**Trigger to reconsider** (any one):
- A user / partner / reviewer requests a non-English experience and we have a concrete locale to target.
- Lorcana official localization adds a market that overlaps our user base meaningfully (e.g., expanding to Spanish-speaking playgroups via a partnership).
- We attempt a public release and competitive analysis shows non-English markets are reachable without translation costs being prohibitive.
- The codebase grows past a point where retrofitting i18n becomes substantially harder (currently ~150 hardcoded strings — manageable; at 1000+ strings the lift gets real).

**Expected scope**: ~1-2 weeks engineering for a single non-English locale, depending on how much of card data we localize:
- Game UI / chrome strings + extraction: ~1 week (translation key system, wire react-i18next, extract every hardcoded string, smoke test).
- Card data localization: ~2-3 days additional if we extend the importer to pull localized Ravensburger data, OR ~0 days additional if we keep card data English-only.
- Engine prose updates (log lines, P1.14 prompts): ~2-3 days. Major decision: do the buildPrompt outputs translate or stay English? The verbatim card-text portion stays English-by-card-data; only the `verb` portion ("Choose a target to banish.") needs translation keys.
- Multi-locale QA: ~2-3 days for one round of locale-pair testing + bug fixes.

Total: ~10-15 work-days for a single locale shipped. Each additional locale is incremental (~2-3 days). Breaks even on effort vs reach when the target locale has >5-10% of user base or specific partnership leverage.

**Decisions explicitly NOT to revisit**:
- Don't attempt i18n via auto-translation (Google Translate / DeepL on the fly). Card text accuracy is load-bearing for game correctness (ability text drives mechanics in players' minds); machine translation would introduce subtle wrong-ness that breaks gameplay trust.
- Don't try to support i18n in the engine itself. Engine emits structured data (events, GameLogEntry types, structured prompts via buildPrompt). UI does the localization at render time. P1.14's prompt format (`${fullName} — "${storyName}": ${rulesText}\n${verb}`) already separates verbatim card data from the action verb — translation work concentrates on the `verb`.

---

### Unify `choose_order` direction across all cards (Hypnotic Deduction vs Vision of the Future)

**Considered**: After the P0.2 fix in `99e3892` (2026-04-28), the `choose_order` modal helper text now reads `pendingChoice.position` from the engine and renders the appropriate first-tap → top-vs-bottom mapping. This means the helper differs by card:

- Vision of the Future / Ariel Spectacular Singer / Under the Sea / `look_at_top` "rest to bottom" (`position: "bottom"`): "first tap → bottom of deck"
- Hypnotic Deduction (`position: "top"`): "first tap → top of deck (next to draw)"

Both behaviors match each card's natural framing, but a player learning the modal pattern on one card may carry the wrong mental model to the other.

**Why parked (2026-04-28)**: Two ways to unify, both nontrivial and both invert one card's natural framing:

- **"Always first tap = drawn first"** — Hypnotic unchanged (first tap is already the next-drawn card). Vision: would need engine to invert the `position: "bottom"` ordering; currently `ids[0]` lands at the deepest position via `reorderDeckTopToBottom(state, owner, ids, [])` at `reducer.ts:2511` and that contract is documented at `types/index.ts:3858`. Inverting requires either reordering `ids[]` in the reducer or reversing the choice array in the UI before submission. Tests + sandbox testers' models migrate.
- **"Always first tap = bottommost"** — Vision unchanged. Hypnotic: first tap becomes the deepest of the placed-on-top block, making "what do I want next?" the LAST tap rather than the first. Mentally weird for Hypnotic's natural framing.

Current "first tap = destination edge" convention is symmetric in mechanics across both cards even if the helper string differs.

**Trigger to reconsider**:
- Post-playtest feedback that the variable helper text confuses players on either card type, OR
- A new card surfaces `position: "top"` and players hit it more often than Hypnotic Deduction (broadens the surface where the inconsistency shows up), OR
- Engine work reorganizes `choose_order` semantics for unrelated reasons.

**Expected scope**: ~1-2 hours total once a direction is chosen.
- Engine reducer (`reducer.ts:2491-2511`) + type doc string (`types/index.ts:3858`) update.
- Engine tests update for any card using the changed direction.
- UI helper text simplification (single string instead of conditional).

---

### Item-stack default: unstack on desktop, stack on mobile

**Considered**: Today `itemStackingEnabled` (GUI setting in `useGuiSettings.ts`) defaults `true` for all viewports. When on, identical items (same defId + same state — exert / damage / timed effects / cardsUnder count) collapse into a staggered shadow-layer pile via `renderItemStack` in `GameBoard.tsx`. Stagger is the primary count signal at 1-4; an `×N` overflow badge appears at 5+ (deliberate per commit `1784bef` — *"stagger as primary stack count signal — drop ×N badge for 1-4"*).

Proposal: flip the default to `false` (unstack everything) at `lg+` breakpoint, where horizontal space accommodates ~8 items at `120px` per cell with room to spare. Keep stacking-on by default at `< lg` (mobile) where space is genuinely tight. User-facing toggle still respected; the change is purely defaults.

**Why parked (2026-04-27)**: Discussed in chat — desktop stacking solves a problem desktop doesn't have (no space pressure), and individual items are higher information density than a stack-with-badge. But shipping it touches both `useGuiSettings.ts` (default flip — UI scope) and `GameBoard.tsx` (rendering branch — gameboard-specialist scope), so worth a deliberate decision rather than a drive-by.

**Trigger to reconsider**:
- A desktop user reports that item stacking feels wasteful or hides information they care about, OR
- We do a P1 phone gameboard pass and the rendering scope expands to "rethink stacking heuristics across breakpoints" anyway, OR
- A streamer / creator surfaces that stacks are unreadable in clip exports.

**Expected scope**: ~30 min total.
- `useGuiSettings.ts`: default = `window.matchMedia("(min-width: 1024px)").matches ? false : true`, with comment.
- OR keep default as-is and gate the rendering: `guiSettings.itemStackingEnabled && !isLgViewport`. The rendering-side gate keeps user preference meaningful as an explicit override.
- Either touches one file (settings) or two files (settings + GameBoard branch).

**Decisions explicitly NOT to revisit** (chat 2026-04-27, captured here so future agents don't re-propose):

- **Splitting items by exert state**: 3 ready Pawpsicles + 1 exerted = 2 stacks (current), NOT 1 unified stack. Exert state directly gates legal actions (you can't activate an exerted item), so collapsing them would lie about the player's actual decision space. The split is the right call. Different from cards-under (BACKLOG entry below) where face-up/face-down is NOT meaningfully interactive — that one correctly stays unsplit.

- **Always-show count badge for 1-4 stacks**: tempting to make split lone-cards "look like part of a group" by always rendering `×1` / `×3` badges. Deliberately rejected by `1784bef` — stagger is the count signal at 1-4. Adding badges back would un-do that design and clutter the visual at the most common counts.

- **Visually linking same-defId stacks across state-split** (e.g., bracket / tint connecting `×3 ready` and `×1 exerted` Pawpsicle stacks): rejected — the lone-state cell IS in a different state and tapping it does different things. Visually grouping would be misleading. Mental "I have 4 of these" is a player-side reasoning task, not a chrome responsibility.

---

### Play-zone overflow affordances (scroll discoverability)

**Considered**: Three optional UX enhancements when the player's play zone has more cards than fit in available height (stress-tested at 18 cards portrait / 24 cards landscape on iPhone 13 — 2 full rows + a third trimmed row, scrolling works fine but the trim isn't visually signaled):

1. **Edge fade at the bottom** — `mask-image: linear-gradient(...)` on the play area so trimmed rows fade to transparent instead of hard-cropping. Visual hint that there's content below.
2. **Scroll indicator badge** — when overflowed, render a small `↓ N more` chip at the bottom-right of the play area. Tappable to scroll to bottom.
3. **Snap-scroll to row boundaries** — `scroll-snap-type: y mandatory` on the play area, `scroll-snap-align: start` on each card row. Avoids parking mid-row mid-scroll.

**Why parked (2026-04-26)**: Stress-test thresholds (18+ portrait / 24+ landscape) are well past typical play. Cards stay full-size and the parent's `overflow-y-auto` engages cleanly — it's working as designed, just lacks visual polish at the trim boundary. User confirmed scrolling functions correctly; this is purely affordance.

**Trigger to reconsider**:
- A user reports they didn't realize they could scroll the play area, OR
- Card-density meta makes 15+ board states common in mid-tier games (currently rare), OR
- Tournament / streaming context where the trim makes plays unreadable to viewers (creator-tool wedge).

**Scope if built**: ~30 min for #1 alone (single CSS rule), ~1-2 hrs for #2 (new component + scroll-position state). #3 is a few lines of CSS but feels less natural for free-flow card rows. Most likely future shape: just #1, the cheapest signal-add.

---

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

### Cards-under peek-out stack (replace count-only badge)

**Considered**: Replacing the bottom-left count-only badge on characters with cards under them with a visible peek-out stack — bottom-right ↘ stagger (vs the existing item duplicate stack which goes top-right ↗). Each peek layer would render the actual card under, with face-up layers showing real art (shifted-from card) and face-down layers showing card backs (boost / Bob Cratchit moves). Same pattern as the existing item-stack render in `GameBoard.tsx::renderItemStack`, just sourced from `instance.cardsUnder` and using each layer's own `isFaceDown` flag (already tracked by the engine, see `types/index.ts:3384`).

**What was discussed in detail**:
- **Direction**: bottom-right ↘ for cards-under, distinct from items' top-right ↗. Different stagger directions signal different semantics: top-right reads as "extra duplicates of this item," bottom-right reads as "physically tucked under this character."
- **Toggle scope**: started as "single toggle for cards-under stack" → user pushed for two toggles (shift / boost) parallel to `itemStackingEnabled` → walking through the Bob-Cratchit-on-shifted-character mixed case revealed that splitting toggles by `isFaceDown` is an engineering accident, not a meaningful UX axis. Settled on collapsing back to one toggle (`cardsUnderStackVisual`) but parked before implementing.
- **Information value**: stack visual conveys *count + face-up/face-down composition + identity of face-up shifted-from cards* in the same pixels as today's count-only badge. Strict signal upgrade, not just IRL fidelity.
- **Tap target problem**: 3px stagger peek edges are non-tappable on mobile (Apple/WCAG ~44px minimum). Three resolutions on the table:
  - Keep the bottom-left badge alongside the stack (redundant info but stable tap target).
  - Drop the badge entirely; tap card → inspect modal → new "View N cards under" button (turns the existing static text at `CardInspectModal.tsx:219-220` into a button). Single tap target, +1 tap to reach the under-viewer.
  - Bigger stagger (~10–12px) to make peeks tappable directly — eats too much visible space; under-cards would compete with the top character.
- **Mobile portrait squeeze**: at 36–52px-wide compressed cells, peeks are ~3–4px visible. Readable but small. Acceptable as default-on if the badge fallback is the explicit opt-out.

**Why parked (2026-04-27)**: User wasn't sure about the tradeoffs after walking through the mixed-toggle ambiguity (splitting visualization by face-up/face-down is awkward when both originate from a single physical pile under one character). Wanted to live with the current count-only badge longer before committing to the visual rework + the tap-target migration into `CardInspectModal`.

**Trigger to reconsider**:
- A user reports they misjudged board state because the count badge collapsed face-up shift identity into a number ("I thought you shifted onto the 4-cost, not the 6-cost"), OR
- Meta makes shifted characters with mid-game cards-under count ≥ 2 routine enough that quick-scan composition info matters, OR
- `CardInspectModal` gets a dedicated polish pass (tap-target migration would ride along), OR
- Player explicitly asks for visual peek behavior again after using the badge for a while.

**Scope if built**: ~2–3 hrs.
- 1 new GuiSettings key (`cardsUnderStackVisual`, default on) + SettingsModal toggle row.
- New `renderCardsUnderStack` helper or extend `renderItemStack` to accept per-layer image source + face-up/face-down marker.
- GameCard's bottom-left count-badge becomes conditional: hide when stack visible.
- CardInspectModal: convert the "N cards under" static text into a button that opens the cards-under viewer (existing `cardsUnderViewerId` flow in GameBoard).
- Decision needed at implementation time: drop the badge entirely (Option B from the discussion) vs keep it alongside the stack (Option A). Option B is cleaner but adds 1 tap to reach the under-viewer.
- Mobile-portrait sanity test at 36px-wide compressed cells before shipping default-on.

**Out of scope of this entry**: peek visualization for *any* other layered cards (e.g. attached items / equipped — Lorcana doesn't have these as separate from cards-under, so currently moot).

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

### Beyond the Horizon — "Choose any number of players" mechanic missing

**Considered**: Set 8 #202 Beyond the Horizon (Sing Together 7 song) has rules text *"Choose any number of players. They discard their hands and draw 3 cards each."* The card-data implementation in `card-set-8.json:13834-13853` hardcodes both players via two `actionEffects` blocks (`target: { "type": "opponent" }` followed by `target: { "type": "self" }`), so the engine deterministically discards/draws for both regardless of what the controller wants. CRD lets the controller pick any subset (0, just self, just opp, or both); the wrong implementation forces both.

**Why parked (2026-04-28)**: Discovered while reviewing P0.1 (which only handled `choose_player` — single-player picks). Beyond the Horizon needs **multi-pick** over players — a different mechanic the engine has no representation for. Building it requires:

- A new `PendingChoice` variant (e.g. `choose_players_subset`) — multi-select over PlayerIDs.
- A new `PlayerTarget` shape or effect-level marker (e.g. `target: { "type": "subset" }`) so the controller's pick gets fanned out per-target.
- A UI branch in `PendingChoiceModal` (multi-select buttons / checkboxes; pattern doesn't currently exist for player targets).
- Card data update for Beyond the Horizon to use the new mechanism.
- Tests.

Single-card scope today (grep confirmed: only Beyond the Horizon uses "Choose any number of players" wording across all 13 sets). Workaround (forced-both) doesn't crash the UI or the engine — it produces incorrect gameplay only when the player would have wanted to opt out of one side.

**Trigger to reconsider**:
- A future set adds another card with "Choose any number of players" or analogous multi-player-pick wording (broadens scope), OR
- A Set 8 playtest surfaces consistent feedback that the forced-both behavior matters competitively (e.g., self-discard hurting the caster more than the disruption helps), OR
- Engine adds multi-pick targeting infrastructure for unrelated reasons (then Beyond the Horizon piggybacks on it).

**Expected scope**: ~1-2 days total.
- Engine: new `PendingChoice` variant, new target shape, reducer wiring (~1 day).
- UI: multi-select branch in `PendingChoiceModal` + the new compile-time exhaustiveness sentinel from `c34447f` will fail typecheck until the branch is added (~2 hrs — actually a benefit; the sentinel forces the UI work to land atomically).
- Card data: re-wire Beyond the Horizon's `actionEffects` (~10 min).
- Tests: regression test (~1 hr).

---

### Typed labels on `choose_option` PendingChoice

**Considered**: P1.9 (commit `1171f77`, 2026-04-28) added a `"Option N"` fallback to `extractOptionTexts` in `PendingChoiceModal.tsx` for when its rulesText parser fails — but the underlying anti-pattern of deriving structured data from prose remains. The right long-term fix is engine-side: each `choose_option` Effect carries a typed `optionLabels: string[]` matching `options.length`, populated at card-import time from the structured ability JSON (or hand-authored where the rulesText parse is genuinely ambiguous). UI consumes `pendingChoice.optionLabels` directly; `extractOptionTexts` deletes.

**Why parked (2026-04-28)**: Just shipped the UI fallback, which is sufficient for known cards today (no current card has been observed shipping malformed labels through the new heuristic). Engine-side typed labels require a card JSON migration sweep (every card with a `choose_option` effect needs labels written into its data) plus a reducer signature update plus a UI consumer swap. Same pattern as `BanishCause` shipped in `27689ae` — ~half-day total but no current pain point forcing it.

**Trigger to reconsider**:
- A new card ships with multi-option text the parser silently mangles (the heuristic falls back, but the labels become "Option 1" / "Option 2" — losing information; players have to read the underlying rulesText anyway), OR
- Localization work begins (typed labels are translatable; parsed labels aren't), OR
- Engine adds another structured-prompt-data primitive for unrelated reasons (typed labels piggyback on the migration).

**Expected scope**: ~half-day total.
- `Effect` type for `choose_option` gains `optionLabels?: string[]` (optional for backward compat).
- Card JSON sweep — populate labels for every card using `choose_option`. Roughly 50-100 cards (estimate); auto-extractable for most via the existing parser as a one-time data migration.
- Reducer surfaces the labels onto `pendingChoice.optionLabels` when constructing the choice.
- UI `PendingChoiceModal` reads `pendingChoice.optionLabels` directly when present, falls through to `extractOptionTexts` (with its `Option N` fallback) when not.
- Eventually delete `extractOptionTexts` once all cards carry labels.

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

**d. `PlayCardEffect.grantKeywords` — keep the flag, audit-trail finished 2026-05-02**
- *Considered*: Folding `grantKeywords?: Keyword[]` into a sibling `grant_keyword` Effect, mirroring the recent `banishAtEndOfTurn` (commit `287d7b6`) and `thenPutOnBottomOfDeck` (commit `095a2b7`) collapses on the same PlayCardEffect.
- *Why parked*: The flag captures CRD 6.4.2's permanent-base-grant semantic ("They gain Rush" with no duration qualifier → keyword stays until the granted card leaves play). Writes to `instance.grantedKeywords[]` (the permanent base array) rather than a TimedEffect. None of the existing `EffectDuration` values express this — `end_of_turn` would expire prematurely, `while_source_in_play` is wrong (tied to granting source's persistence, not granted card's). Folding would require either a NEW `EffectDuration: "permanent"` variant (single-use, weird name on a TimedEffect) or a NEW effect type that writes to base `grantedKeywords[]` directly. Current 3 cards (Madam Mim - Rival of Merlin, Gruesome and Grim song, Set 11 #66 SPECIAL SUMMONS) all banish-at-EoT so the duration distinction is academic — but the encoding still matches the oracle, which is the right call. User confirmed 2026-05-02: "I would assume a card would read 'They gain Rush until the end of turn' if it's meant to be" time-bounded.
- *Trigger*: A 4th card lands needing `play_card + permanent keyword grant`, AND that card has wording that argues for unifying with grant_keyword Effect (e.g. dynamic value, conditional grant, follow-up effects), OR a card lands wanting a TIME-BOUNDED grant via play_card (e.g. "Play X. They gain Rush until the end of your next turn") — currently expressible as a sibling `grant_keyword` effect with `duration: "end_of_owner_next_turn"` and `target: "last_resolved_target"` (no engine work needed; existing primitive composes).
- *Scope*: If folding becomes worthwhile, ~3 cards × 6 JSON entries migrate (~30 lines). Engine drops 1 field + 5-line if-branch. Decompiler drops the `kwClause` post-clause logic. Plus EITHER a new `EffectDuration: "permanent"` variant (~10 LOC across types + utils + decompiler) OR a new effect type. Net ~1 hour of focused work.

---

## Server

### MP takebacks (Tier 0 / Tier 1 / Tier 2 / Tier 3)

**Considered**: Four-tier takeback system surfaced from MP playtest cycle 2026-04-28. Full design lives in `docs/MP_TAKEBACKS_DESIGN.md` (server-specialist's research output, ~970 lines — anti-cheat boundary, info-delta classification, snapshot rollback mechanism, opponent-consent flow, edge cases, audit table). Summary of the four phases:

- **Tier 0 — pre-commit cancels** (mid-pendingChoice Cancel button reverts in-flight choice). Pure UI; no server. ~half day. Allowed in all formats.
- **Tier 1 — neutral takebacks** (INK_CARD misclick, undeclared QUEST). Server snapshot rollback + 5-sec undo pill. ~1 day cross-package. Allowed in casual + private. **Now unblocked**: Q1 resolved 2026-04-28 (P2.25 shipped CRD 4.1.4 inkwell redaction), so PLAY_INK is fully neutral — opponent already saw identity at moment of inking; takeback re-hides without new info gain.
- **Tier 2 — info-gain takebacks** (private peeks like Diablo - Maleficent's Spy reveal). Opponent consent prompt + `takebacks` audit table. Private-lobby only. ~2-3 days.
- **Tier 3 — public reveals** (Powerline-style). Opponent consent + honest "you both saw the cards but the effect is undone" toast. Marginal value over Tier 2; **probably skip permanently** (was P3.27 in audit).

**Why parked (2026-04-28)**: User pausing on MP takebacks for now. Q3 ("ship Tier 0 without committing to Tier 1+?") and Q5 ("audit table visibility — admin-only or post-game?") both deferred. The CRD-compliance prereqs (P2.25) shipped independently as anti-cheat fixes; the takebacks UX work itself is now self-contained engineering.

**Trigger to reconsider**:
- Multiplayer playtests show repeated misclick frustration on PLAY_INK or QUEST (specifically — the audit synthesis flagged these as the most common takeback cases in casual play), OR
- A streamer / creator scenario URL (clip-export, scripted opponent) needs a takeback for the recorded session, OR
- Ranked queue volume justifies a touch-move-discipline / takeback-disabled workflow distinction (currently the engine already supports per-format takeback policy via the rotation registry).

**Expected scope**:
- Tier 0: ~half day pure UI (gameboard-specialist — Cancel affordance during pendingChoice).
- Tier 1: ~1 day server endpoint + 5-sec undo pill UI (server-specialist + gameboard-specialist).
- Tier 2: ~2-3 days cross-package (consent flow, audit table, opponent-prompt UI).
- Tier 3: ~half day on top of Tier 2 (probably skip).

Total if all four ship: ~5-6 work-days.

**Decisions explicitly NOT to revisit** (captured 2026-04-28 in the design doc):
- Server NEVER trusts client's tier classification — re-classifies every takeback request from the `events: GameEvent[]` stream (any `card_revealed` / `hand_revealed` event in the stream auto-bumps tier).
- Ranked queue → zero takebacks. Plumbed through the existing `format.rotation.ranked` flag.
- Animation honesty for Tier 3 — don't lie with reverse-animations; show an honest toast instead.

---

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

