# Non-Gameboard Modal & Page-Chrome String Audit

Companion to `docs/audit/2026-04-28_modal_strings.md` (gameboard-specialist's catalog of in-play modals — `PendingChoiceModal` variants, defeat/victory, mulligan, reveal pill, etc.). This file covers everything OUTSIDE the live gameboard:

- **Shared modal chrome** (`ModalFrame`)
- **Settings & inspect modals** (`SettingsModal`, `CardInspectModal` — surfaces in deckbuilder + gameboard)
- **Inline page modals** (DeckBuilderPage discard-changes / box-art picker; DecksPage paste-and-analyze; MultiplayerLobby host/join/queue/browse)
- **Toasts** (`InfoToast`, `ModeToast`, `TopToast`)
- **Card text renderers** (`CardTextRender`, `AbilityTextRender`) — not modals but the canonical rendering path for card data, included because they're where card-data → UI text actually happens
- **Page-level prompts** (auth, deck save bar, lobby status messages)

Date: 2026-04-28. Scope: every user-facing English string in the non-gameboard UI, classified as **card-data** / **engine-state** / **hardcoded** / **mixed** with concerns flagged.

---

## TOC

1. [Shared modal chrome](#1-shared-modal-chrome)
2. [CardInspectModal](#2-cardinspectmodal)
3. [SettingsModal](#3-settingsmodal)
4. [DeckBuilderPage inline modals](#4-deckbuilderpage-inline-modals)
5. [DecksPage paste pane + tile chrome](#5-deckspage-paste-pane--tile-chrome)
6. [MultiplayerLobby](#6-multiplayerlobby)
7. [Toasts](#7-toasts)
8. [Card text renderers (CardTextRender / AbilityTextRender)](#8-card-text-renderers)
9. [Cross-cutting findings](#9-cross-cutting-findings)
10. [Recommendations](#10-recommendations)

---

## 1. Shared modal chrome

**File:** `packages/ui/src/components/ModalFrame.tsx`

Pure structural container — backdrop, dismiss handler, placement (`center` / `bottom-sheet-mobile`). **No user-facing strings.** Used by `CardInspectModal`, `ZoneViewModal`, `SettingsModal`, the Active Effects modal. NOT used by `PendingChoiceModal` (peek-on-backdrop semantics differ) or the Game Over modal (intentionally non-dismissable).

Notes:
- Backdrop opacity / blur are hardcoded (`bg-black/70 backdrop-blur-sm`). Acceptable.
- Could expose a `title` prop later if we wanted standardized header rendering, but currently each consumer rolls its own header.

---

## 2. CardInspectModal

**File:** `packages/ui/src/components/CardInspectModal.tsx` (382 lines)

Click any card to see full details — used in deckbuilder, gameboard, decks list. The single most card-data-driven modal in the app.

### String inventory

| Location | String / source | Classification | Notes |
|---|---|---|---|
| Card name | `def.fullName` | **card-data** | Literal — unchanged from card JSON |
| Subtitle row | `def.cardType` (capitalized) + `·` + `def.rarity.replace("_", " ")` + `·` + `Set ${def.setId} #${def.number}` | **mixed** | `cardType` / `rarity` from card data; `Set N #M` is template scaffolding. Capitalization: `capitalize` literal of `cardType` (`"character"` → `"Character"`); `replace("_", " ")` for rarity (`"super_rare"` → `"super rare"` — lowercase preserved, no recase). |
| Ink badge | `c` (raw color name) | **card-data** | Lowercase ink color displayed verbatim; uppercase via Tailwind `uppercase` |
| Cost | `def.cost` | **card-data** | |
| Trait pills | `def.traits[i]` literal | **card-data** | Joined verbatim |
| Stats row labels | None — uses `<Glyph name="strength" />` etc. instead of text labels | **iconographic** | The `Shift:` label still says `"Shift: ${def.shiftCost}"` (only stat without a glyph) — slight inconsistency |
| Keyword pills (line 50-55) | `printedKeywords` = `def.abilities.filter(keyword)` → `${capitalize(keyword)} +${value}` | **card-data + scaffolding** | The `+N` template is hardcoded; "Challenger" / "Resist" / "Singer" come from data. Granted keywords also flow through `capitalize()` |
| In-play state badges | `Damage: {n}` / `Exerted` / `Drying` / `{n} card(s) under` | **hardcoded** | Pure UI labels — no card-data drift risk |
| **Rules text** (line 227-229) | `def.rulesText` rendered through `renderRulesText` | **card-data passthrough** | Token replacement (`{S}/{W}/{L}/{E}/{C}/{I}` → glyphs) but no paraphrasing |
| Flavor text | `def.flavorText` | **card-data** | |
| Active Effects header | `Active Effects` | **hardcoded** | |
| Active Effects body — preferred path (line 282-283) | `${stampedStoryName} — ${stampedAbility.rulesText ?? ""}` | **card-data passthrough** | Uses the engine-stamped `sourceStoryName` as of the recent ship, no paraphrasing |
| Active Effects body — fallback path (line 288-300) | Mix of `storyName — rulesText`, raw `rulesText`, `capitalize(keyword)`, joined keyword names | **mixed** | Heuristic for older `TimedEffects` without `sourceStoryName` (per code comment, "not yet wired engine-side" for `grant_keyword` / `damage_prevention`). Defensive — once those stamp `sourceStoryName`, this fallback becomes dead. |
| Effect duration (line 370-381) | `formatDuration(te.expiresAt)` — switch on enum string | **hardcoded label-mapping** | `"end_of_turn"` → `"This turn"`; `"end_of_owner_next_turn"` → `"Until their next turn"`; `"until_caster_next_turn"` → `"Until your next turn"`; `"end_of_next_turn"` → `"Until next turn"`; `"while_in_play"` → `"While in play"`; `"permanent"` → `"Permanent"`; `"once"` → `"Once"`. Default replaces underscores with spaces (`"some_new_duration"` → `"some new duration"`). |

### Concerns

- **Drift-resistant**: the modal is mostly card-data passthrough. `def.fullName`, `def.rulesText`, `def.subtitle`, `def.flavorText` all render literal. Updating card data updates the modal.
- **Capitalization heuristic** (`capitalize()`): `"super_rare".replace("_", " ")` lowercases (line 131). Consistent within the modal but conflicts with rarity badge styling elsewhere (e.g. Tailwind `uppercase` on ink badges). Minor.
- **Duration label-mapping is the highest drift risk**: if engine adds a new `expiresAt` value, the default-branch fallback (`d.replace(/_/g, " ")`) renders something like `"end of next opponent turn"` — readable but ugly. Recommendation: keep an explicit case for every duration enum value; the engine docs at `types/index.ts` enumerate them.
- **`Shift:` text label** is the only stat without a glyph, breaks the iconographic pattern.

---

## 3. SettingsModal

**File:** `packages/ui/src/components/SettingsModal.tsx` (162 lines)

Pure GUI preferences. Every label + description is **hand-written hardcoded** — no card data, no engine state.

### String inventory (every label is hardcoded)

| Setting | Label | Description | Concerns |
|---|---|---|---|
| `itemStackingEnabled` | `"Stack identical items"` | `"Group same-state copies of items into one staggered pile. Disable to show each item in its own slot."` | Plain English, fine |
| `mirrorOpponentPlayZone` | `"Mirror opponent's play zone"` | Long description (49 words) | Could be tightened |
| `flipOpponentCards` | `"Flip opponent's cards upside-down"` | Long description (35 words) | Could be tightened |
| `cardDisplayMode` | `"Card preview style"` | `"How cards render in choice / picker modals (...) Art shows the printed card image; Text shows structured rules text."` | Two-segment picker (`Art` / `Text`) |
| Header | `"Settings"` (uppercase tracking-wider) | — | |

### Concerns

- **i18n readiness**: every string is a JSX literal. If localization ever ships, this entire file becomes a translation key map.
- **Pluralization**: `"Stack identical items"` works; some descriptions use casual punctuation patterns (em-dashes, ellipses).
- **No engine coupling**: this modal is pure user preference. Not a drift risk.

---

## 4. DeckBuilderPage inline modals

**File:** `packages/ui/src/pages/DeckBuilderPage.tsx` (709 lines)

Two inline modals (no `ModalFrame`, hand-rolled overlays):

### 4.1 Discard-changes modal (line 592-625)

| Element | String | Classification |
|---|---|---|
| Title | `"Discard changes?"` | **hardcoded** |
| Body | `"You have unsaved changes to this deck. If you leave now, they'll be lost."` | **hardcoded** |
| Button (cancel) | `"Stay"` | **hardcoded** |
| Button (confirm) | `"Discard & leave"` (red) | **hardcoded** |

**Comment in code (line 199):** *"showing a React modal instead of `window.confirm` — BrowserRouter can't ..."* — explains why it's hand-rolled.

### 4.2 Box art picker modal (line 627-705)

| Element | String | Classification |
|---|---|---|
| Title | `"Choose box art"` | **hardcoded** |
| "Use auto" link (when set) | `"Use auto"` | **hardcoded** — undoes a manually picked box card |
| Helper text | `"Pick a card from this deck. Defaults to the first card you added."` | **hardcoded** |
| Card images | `def.fullName` (alt) | **card-data** |
| Empty state | none — hidden when `entries` empty | — |

### Concerns

- **Inline, not using `ModalFrame`** — duplicates the backdrop + dismiss-on-backdrop logic. ~2 places where this pattern repeats; would consolidate cleanly through `ModalFrame`. Currently fine.
- **No paraphrasing of card text** — the picker just shows card art; the modal labels are pure UI scaffolding.

---

## 5. DecksPage paste pane + tile chrome

**File:** `packages/ui/src/pages/DecksPage.tsx` (296 lines)

Not modals strictly, but the page-level prompts and tile labels constitute the user-facing copy on this screen.

### Page-level strings

| Element | String | Classification |
|---|---|---|
| Header h1 | `"My Decks"` | **hardcoded** |
| Header sub | `"Build and manage your decklists"` | **hardcoded** |
| Loading state | `"Loading…"` | **hardcoded** |
| Signed-out CTA | `"Sign in to save decks across devices"` / `"You can still paste a decklist below to analyze it"` | **hardcoded** |
| Paste textarea | `placeholder="4 HeiHei - Boat Snack\n4 Stitch - New Dog\n4 Mickey Mouse - True Friend\n..."` | **hardcoded** (sample uses real card names — drift risk if those cards renamed) |
| Sample deck (line 24-39) | 15 hardcoded card-name lines | **card-data ECHO** | These are real card fullNames; if a card gets renamed by Ravensburger, the sample becomes invalid until updated by hand. **DRIFT RISK** |
| Paste-error rendering | `pasteErrors[i]` from `parseDecklist` | **engine-derived** |
| Total counter | `${pasteTotalCards} cards, ${pasteDeck.length} unique` | **mixed** |
| New deck tile | `"+ New Deck"` (text + plus glyph) | **hardcoded** |
| Format chip on tile | `formatLabel = d.format_family === "core" ? "Core" : "Infinity"` | **mixed (hardcoded labels for engine enum)** |
| Format chip title attr | `"Built for ${formatLabel}"` | **mixed** |
| Illegal-cards badge | `"⚠️" + ${legalityIssues.length} illegal` + tooltip `"${legalityIssues.length} card{s} not legal in current rotation. Click to open this deck and edit, or migrate to Infinity.\n\n${legalityIssues.join("\n")}"` | **mixed (engine messages + hardcoded scaffold)** |
| Tile name | `d.name` (user-set) | **user-data** |
| Card count (when off-spec) | `"invalid"` (red) or `${count}/60` (yellow) | **hardcoded** |
| Empty tile | `"Empty deck"` | **hardcoded** |
| Empty grid | `"No saved decks yet. Click + New Deck to get started."` | **hardcoded** |

### Concerns

- **`SAMPLE_DECKLIST` (line 24-39) is the biggest drift risk on this page.** 15 hand-written card name lines. If Ravensburger ever renames any of those cards, the "Load sample" button gives the user broken parse errors. Should be pulled from a `getSampleDeck()` engine helper that returns a known-legal current deck.
- **`formatLabel` mapping** (line 192) is a 2-case ternary — fine for now (only 2 families). Will need a switch when more format families ship.
- **The legality-issue tooltip** mentions `"migrate to Infinity"` — coupled to the family rotation lifecycle. If the user is already on Infinity-s12, "migrate to Infinity" is meaningless. **Stale advice in some states.**
- **Illegal-card messages** (`legalityIssues[i]`) come from engine `isLegalFor` output. Engine messages should be reviewed for end-user readability separately — engine messages are sometimes terse (e.g. `"5 copies of Mickey Mouse - True Friend (max 4)"`).

---

## 6. MultiplayerLobby

**File:** `packages/ui/src/pages/MultiplayerLobby.tsx` (1335 lines)

The largest non-gameboard surface. 18+ user-facing strings extracted via grep, plus error / status flows.

### Major sections

#### Header (line 544-545)

| String | Classification |
|---|---|
| `"Multiplayer"` (h1) | **hardcoded** |
| `"Play against a real opponent"` (sub) | **hardcoded** |

#### Auth form (line 800-870)

| String | Classification |
|---|---|
| `placeholder="Email"` | **hardcoded** |
| `placeholder="Password"` | **hardcoded** |
| Tab labels (`signin` / `signup`) | **hardcoded** |
| Submit button label | **hardcoded** |
| Error banners | server response strings (auth API) | **engine-derived** |

#### Quick Play / Custom Game (line 1000-1130)

| String | Classification |
|---|---|
| `"Host a game"` | **hardcoded** |
| `"Create a lobby, share the code"` | **hardcoded** |
| `"Format declared by the selected deck. Edit in the deckbuilder to change."` | **hardcoded** (title attr) |
| `"Format"` (header) | **hardcoded** |
| `"Join a game"` | **hardcoded** |
| `"Enter the host's code"` | **hardcoded** |
| `placeholder="XXXXXX"` | **hardcoded** |
| `"Bot plays:"` (solo opponent picker) | **hardcoded** |
| `"Your Deck"` | **hardcoded** |
| `"No saved decks"` | **hardcoded** |
| Find Casual / Find Ranked button labels | **hardcoded** |

#### Status messages (line 248, 453-520)

| Trigger | Message | Classification |
|---|---|---|
| Lobby timeout | `"Lobby timed out waiting for a player. Please create a new lobby."` | **hardcoded** |
| `setStatus` during create | `"Creating lobby…"` | **hardcoded** |
| When opponent joins | `"Opponent joined just now — starting…"` | **hardcoded** |
| Joining lobby | `"Joining…"` | **hardcoded** |
| Game start | `"Starting game…"` | **hardcoded** |

#### Waiting state (line 1234-1255)

| String | Classification |
|---|---|
| `"Waiting for opponent"` | **hardcoded** |
| `"Share this code with your opponent"` | **hardcoded** |
| `title="Copy code"` | **hardcoded** |

#### Recent games + queue UI

(I haven't fully cataloged — file is 1335 lines. The patterns above repeat: every label is a JSX literal, every status message is a `setStatus(string)` call.)

### Concerns

- **18+ hand-written status messages** — all hardcoded, no localization layer. If we ever localize, this file is the single biggest translation effort in the UI.
- **No paraphrasing of card text** — this surface is chrome only, no card-content drift risk.
- **Format labels** (`Core` / `Infinity`) hardcoded in two places (here and DecksPage line 192). Pull into a shared util.
- **Error message inconsistency**: server returns `MatchmakingError` with structured `code` + `issues[]`; rendering is ad-hoc per call site. Should consolidate into a `<MatchmakingErrorBanner>` component.

---

## 7. Toasts

**Files:**
- `packages/ui/src/components/InfoToast.tsx` (42 lines)
- `packages/ui/src/components/ModeToast.tsx` (80 lines)
- `packages/ui/src/components/TopToast.tsx` (33 lines)

Quick scan — toasts are content-driven (caller passes the message in), so the toast components themselves have minimal hardcoded content. Three patterns:

- **`InfoToast`** — generic info pill; caller passes `message` and optional `actionLabel`. UI scaffolding only.
- **`ModeToast`** — surfaces during gameboard modal sequencing (e.g. "Choose a target", "Choose a discard"). Caller passes the prompt; toast renders it. Mode toast labels often paraphrase what `PendingChoiceModal` would show (gameboard-specialist will catalog those in their audit).
- **`TopToast`** — top-of-screen toast (e.g. "Match found!", reconnection state). Caller-driven content.

### Concerns

- Toasts are mostly fine (content-driven). The strings inside `ModeToast` calls scattered across `GameBoard.tsx` are the audit-worthy items, and gameboard-specialist's audit covers those.

---

## 8. Card text renderers

**Files:**
- `packages/ui/src/components/CardTextRender.tsx` (136 lines) — full card structured rendering
- `packages/ui/src/components/AbilityTextRender.tsx` (59 lines) — single-ability rendering

These aren't modals. They're the canonical "card data → UI text" rendering path used inside many modals (`PendingChoiceModal`, `CardInspectModal`, sandbox card injector, etc.). Whether modal text is "drift-resistant" or "drift-prone" depends largely on whether the modal routes through these renderers.

### CardTextRender (line 55-136)

| Element | Source | Classification |
|---|---|---|
| Cost | `def.cost` | **card-data** |
| Inkable label | `"INK"` (line 73) | **hardcoded** |
| Card name | `def.name` | **card-data** |
| Subtitle | `def.subtitle` | **card-data** |
| Ink chip label | `INK_COLOR_STYLES[c].label` (`"Amber"`, `"Amethyst"`, etc.) | **hardcoded label-mapping for engine enum** |
| Stats line | `def.strength` / `def.willpower` / `def.lore` | **card-data** |
| Move cost | `def.moveCost` | **card-data** |
| Traits | `def.traits.join(" · ")` | **card-data** |
| Ability — keyword | `${capitalize(keyword)}${value ? ` +${value}` : ""}` | **card-data + scaffolding** |
| Ability — non-keyword (line 39-46) | `<storyName> — <rulesText>` joined | **card-data passthrough** |
| Action / item rules text | `def.rulesText` via `renderRulesText` | **card-data passthrough** |

### AbilityTextRender (line 25-58)

| Element | Source | Classification |
|---|---|---|
| Card attribution | `cardName` (passed in) | **card-data** |
| Keyword label | `${capitalize(keyword)}${value ? ` +${value}` : ""}` | **card-data + scaffolding** |
| Story name | `ability.storyName` (italic indigo) | **card-data** |
| Rules text | `ability.rulesText` via `renderRulesText` | **card-data passthrough** |

### Concerns

- **These renderers are exemplary** — every game-relevant string passes through `def`/`ability` fields, with `renderRulesText` handling the `{S}/{W}/{L}/{E}/{C}/{I}` glyph token replacement. Drift-resistant.
- **`INK_COLOR_STYLES` ink labels** (`"Amber"` / `"Amethyst"` / etc.) are hardcoded — fine, they're the canonical English ink names.
- **`capitalize(keyword)`** lowercases-then-titles a keyword name (e.g. `"reckless"` → `"Reckless"`). Acceptable for built-in keywords.
- **`"INK"`** label (line 73) is hardcoded; matches Lorcana's official terminology.

---

## 9. Cross-cutting findings

### Drift risk (high → low)

1. **`SAMPLE_DECKLIST` in DecksPage.tsx:24-39** — 15 hardcoded card-name lines. Renames break the "Load sample" button. **Highest single drift risk** outside live gameplay. Fix: pull from a known-legal `getSampleDeck()` helper exported by the engine package.
2. **`legalityIssues` tooltip wording** in DecksPage.tsx:240 — references `"migrate to Infinity"` which is stale advice for users already on Infinity-s12. Conditional copy needed.
3. **`formatDuration` switch** in CardInspectModal.tsx:370-381 — defaults to underscore-replace which produces ugly text for new duration enums. Add a case per known duration value; throw / log when an unknown one slips through.
4. **`INK_COLOR_STYLES` labels** (CardTextRender.tsx:16-23) — frozen at 6 ink colors. Adding a new ink (unlikely per Lorcana design) means updating two literals.
5. **`formatLabel`** ternary (DecksPage.tsx:192) — only handles `"core"` / `"infinity"`. Fine until a third family ships.

### Hardcoded vs softcoded — dominant pattern

- **Card-data heavy modals** (CardInspectModal, CardTextRender, AbilityTextRender) are 70-80% softcoded — they pull from `def.fullName`, `def.rulesText`, `ability.storyName`, etc.
- **Chrome / lobby / settings** are 100% hardcoded English literals. No drift risk; high translation cost if i18n ships.
- **DecksPage** mixes both — tile chrome is hardcoded, format/legality data is engine-derived, but `SAMPLE_DECKLIST` is hand-written card names (drift risk).

### Inconsistencies worth noting

- **Two inline modal patterns coexist** — some modals use `ModalFrame` (CardInspectModal, SettingsModal, ZoneViewModal); some hand-roll the backdrop (DeckBuilderPage's discard-changes + box-art picker). Consolidate through `ModalFrame`.
- **Pluralization is ad-hoc** — DecksPage line 240 uses `${n} card${n === 1 ? "" : "s"}` inline; CardInspectModal line 220 uses `${n} card${n !== 1 ? "s" : ""} under`. Both work; would benefit from a `pluralize(noun, count)` util.
- **Capitalization of card-data fields**: `def.cardType` ("character") gets `capitalize`'d in some places (CardInspectModal line 129), used as-is via `.capitalize` Tailwind class in others. No bug; minor cleanup candidate.

### i18n readiness

- The codebase is 100% English-only. Every user-facing string is a JSX literal or a `setStatus(string)` call.
- **No i18n framework or string-key infrastructure exists.** Adding one is a separate, larger project; flagging as future-work.
- Most card text already lives in `def.rulesText` (translatable at the data layer). The chrome (lobby, settings, errors, tooltips) is the bulk of the translation surface.

### Paraphrasing concerns

- **No paraphrasing of card rulesText found** in the non-gameboard surfaces. CardInspectModal renders `def.rulesText` verbatim; CardTextRender / AbilityTextRender same. Rules text is always passthrough.
- The paraphrasing concern (engine paraphrasing card text into log lines) lives in the engine + gameboard log audits, not here.

---

## 10. Recommendations

Prioritized by ROI:

### High priority

1. **Replace `SAMPLE_DECKLIST` with a live engine helper.** ~15 min. `pnpm --filter @lorcana-sim/engine` exposes `getSampleDeck(format)` returning entries; DecksPage uses that as the textarea seed. Drift risk eliminated.

2. **Conditional copy on the legality-drift tooltip.** ~10 min. The tooltip on DecksPage line 240 says `"migrate to Infinity"` regardless of current family; for `family === "infinity"` decks the message is irrelevant. Branch the suffix on family.

3. **Document the `formatDuration` switch.** ~5 min. Add a comment listing which `expiresAt` values are known + where new ones get added. Consider a TS exhaustive-check pattern (`assertNever`) so new duration enums force an update here.

### Medium priority

4. **Consolidate hand-rolled modals through `ModalFrame`.** ~30 min. DeckBuilderPage's discard-changes and box-art picker both hand-roll the backdrop. Refactor to use `ModalFrame` — same UX, less duplication.

5. **Extract a `<FormatLabel>` component** for the `Core / Infinity` chip rendering. Currently duplicated in DecksPage.tsx:192, MultiplayerLobby (multiple sites), DeckBuilderPage. ~20 min.

6. **Create a `<MatchmakingErrorBanner>`** for `MatchmakingError` rendering in MultiplayerLobby. Currently each error site has ad-hoc rendering. ~30 min.

### Low priority

7. **i18n readiness sweep** — extract every hardcoded user-facing string into a `strings.ts` const map. ~3-5 hours. Only worth it if localization is on the roadmap.

8. **Pluralization helper** (`pluralize(noun, count)`) — ~10 min. Tiny consolidation; not urgent.

### Out of scope for this audit

- Live gameboard modals (PendingChoiceModal variants, defeat/victory, mulligan, reveal pill) — covered by gameboard-specialist's parallel audit.
- Card data quality (card text accuracy, oracle drift from Ravensburger) — covered by audit-cards / decompile-cards tooling.
- Engine log paraphrasing — covered by engine-expert's parallel audit.
