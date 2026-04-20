# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

---

## Card data: Ravensburger API migration landed (main sets 1-12)

`scripts/import-cards-rav.ts` is the new importer for main sets (1-12). Fetches
directly from `https://www.disneylorcana.com/api/getCardApiData?locale=en&filter=setN`
— Ravensburger's official API (what powers their Play Hub site). Zero publish
delay, includes Iconic/Epic cards Lorcast doesn't index, and provides
`variants[].foil_mask_url` for authoritative foil layer pairing.

**Coverage split:**
- **Ravensburger** (`pnpm tsx scripts/import-cards-rav.ts`): set1..set12.
  Supports `quest1`/`quest2` Illumineer Quest filters too, but those are keyed
  by the original set the cards are reprinted from — not Quest-specific
  numbering — so migration deferred until numbering strategy is decided.
- **Lorcast** (`pnpm import-cards`): P1, P2, P3, cp, D23, DIS promos. The
  Ravensburger API returns empty for those filters.

**Things the importer handles:**
- Slug generation matches the project's existing convention exactly
  (straight apostrophes become word separators, curly apostrophes get stripped)
  so re-imports don't change IDs.
- Merge logic preserves hand-wired `abilities[]`, `actionEffects`,
  `alternateNames`, `playRestrictions`, `altPlayCost`, `selfCostReduction`,
  `shiftCost`, `altShiftCost`, `moveCost`, `singTogetherCost` on re-import.
- `slug-alias fallback` — when a card's slug changed between re-imports
  (e.g. Te Kā's macron normalization), matches by (number, normalized
  fullName) to preserve wiring instead of orphaning it.
- `STORY_NAME_OVERRIDES` in the importer — hardcoded corrections where
  Ravensburger's API is wrong. Three entries as of migration:
  - `the-bayou-mysterious-swamp` — Ravensburger says `GONNA TAKE YOU THERE`,
    printed card says `SHOW ME THE WAY`.
  - `half-hexwell-crown` — Ravensburger returns one merged story name
    `UMBRA'S POWER, UMBRA'S GIFT`, printed card has two abilities
    `AN UNEXPECTED FIND` + `A PERILOUS POWER`.
  - `mama-odie-solitary-sage` — both Lorcast and Ravensburger miss the
    `I'VE` prefix; canonical is `I'VE GOT TO DO EVERYTHING AROUND HERE`.
  Future Ravensburger transcription errors: add an entry here, not a
  separate patch.
- `scripts/patch-storynames.ts` — one-time fix already applied for 24 cards
  whose Lorcast-generated storyNames were AI-paraphrased (not transcribed
  from the printed cards). Not expected to be re-run unless another discovery
  batch surfaces.

**Next moves (not yet done):**
1. Promo migration — if/when Ravensburger exposes P1/P2/P3/cp/D23/DIS or
   we find another authoritative source, retire `scripts/import-cards.ts`.

**Investigated and parked 2026-04-19 — Illumineer's Quest cards:**
- Ravensburger's `quest1` / `quest2` API filters return the Quest box's
  card list, but every card they return has a `card_sets` tag like
  `["quest1", "set4"]` — they're normal main-set cards (just
  distributed in the Quest box). The main-set filters already return
  them at numbers 223-225 (past the nominal 204 total). Example:
  Mulan Elite Archer 224/204 EN 4 is a set 4 card already in
  `card-set-4.json`.
- Enabling `quest1`/`quest2` filters would duplicate data already
  pulled via `setN` filters. Kept them OFF in `ALL_RAV_FILTERS`.
- **Truly PvE-exclusive cards** (Anna — Ensnared Sister and similar
  boss-encounter/scripted-fight cards) exist in the physical Quest
  product but are NOT in Ravensburger's public API. **Lorcast API
  does carry these** — if/when we need PvE cards, re-enable
  `scripts/import-cards.ts` (Lorcast-sourced) for quest1 / quest2
  filters rather than trying Ravensburger. Write to
  `card-set-Q1.json` / `card-set-Q2.json` with `setId: "Q1"` / `"Q2"`
  — chosen so they stay out of `CORE_LEGAL_SETS` /
  `INFINITY_LEGAL_SETS` and the co-op format (when built) can claim
  them. Not blocking anything today; revisit when the Illumineer's
  Quest co-op mode lands (see strategy note below).

**Validation:** `pnpm --filter engine test` (460/460) and `pnpm card-status`
(0 invalid) should stay green after any re-import.

---

---

## GUI: alt-shift cost picker — PendingChoiceModal routing for hand-card pick

Reported as "I can PLAY Diablo Devoted Herald for free (with a shift target in
play and an action card in hand)." Verified engine-side: engine is correct —
confirmed by `set4.test.ts` "alt-shift: trace — Diablo Devoted Herald..."

Engine flow:
1. getAllLegalActions surfaces two PLAY_CARD actions for the in-hand Diablo:
   normal (cost 3 ink) + shift (shiftTargetInstanceId, no altShiftCostInstanceIds).
2. Dispatching the shift action creates a `choose_target` pendingChoice with
   `count: 1`, `validTargets: [<action-card-id>]`, `_altShiftCostContinuation`
   carrying the shift target + costType=discard + exactCount=1.
3. Ink is NOT spent; card stays in hand.
4. Validator rejects resolve with empty choice (exactCount=1 enforced).
5. Resolve with the action card → discard + shift completes, 0 ink spent.

If the user sees Diablo enter play without being prompted to pick an action
to discard, the GUI is either:
- bypassing the pendingChoice (dispatching the shift then silently consuming
  the pendingChoice without showing the modal), or
- showing a modal but letting the player confirm with no selection (validator
  would reject but the GUI may interpret the rejection as "succeeded"), or
- not surfacing the PendingChoiceModal at all for the new `_altShiftCostContinuation`
  hand-card picker (it was previously handled by GameBoard's alt-shift picker
  mode, which is now dead code after the altShift migration in 677acd1).

Verify path: drag Diablo onto the base → useBoardDnd.ts:67 finds PLAY_CARD
with shiftTargetInstanceId but no altShiftCostInstanceIds → dispatches directly
(line 77). Engine creates pendingChoice. PendingChoiceModal should render the
hand card as a tappable thumb (`validTargets` grid at PendingChoiceModal.tsx:169
or the main single/multi-select path at 520+). If the hand card doesn't appear
as a target in the modal, CardThumb rendering may not support hand-zone cards
in the choose_target grid.

Quickest sanity check: log `session.pendingChoice` right after dispatching a
Diablo shift — it should have `_altShiftCostContinuation` set and validTargets
containing the action's instance ID. If it does, the modal's rendering is the
gap. If it doesn't, something in the engine isn't creating the pendingChoice
for that code path.

---

## Simulator: bot policy enumerator only generates single-pick for multi-pick choices

`packages/simulator/src/rl/policy.ts:232-242` — the `choose_from_revealed`
candidate enumerator emits one candidate per valid target (single pick) plus
an empty-array candidate if optional. For mandatory multi-pick effects
(e.g. Dig a Little Deeper: pick exactly 2), this underfills — the bot will
only put 1 card into hand instead of 2, leaving the other picks on deck.

Fix: for `choose_from_revealed` backed by `look_at_top` with
`pendingEffect.maxToHand > 1`, enumerate multi-pick combinations (or at least
pick the top-K valid targets as a single candidate when mandatory). May need
a similar pass in any other bot that handles this choice type.

---

## GUI: each_player may-prompts route to the iteration player (not the caster)

Phase 1/2 `each_player` primitive (commits 249a0db, 7fa7bca) surfaces a
`choose_may` pendingChoice per player iteration when `isMay: true`, with
`choosingPlayerId` = the iteration player and `acceptControllingPlayerId` =
the caster. Cards: Donald Duck Perfect Gentleman ×2, Amethyst Chromicon,
Return of Hercules ×2.

Concretely for Donald Duck (caster is p2): on p2's turn start, the trigger
fires and immediately surfaces `choose_may` with `choosingPlayerId: "player2"`.
On accept, p2 draws; engine then surfaces the NEXT `choose_may` with
`choosingPlayerId: "player1"`. The pending-choice sequence is active-first.

What the GUI must do:
- Route the choose_may modal to `choosingPlayerId`, not to the source card's
  owner or to the active player. Previously the engine's generic isMay wrapper
  at `processTriggerStack` always used `source.ownerId` as the chooser — that
  path is now bypassed for `each_player`, and the iteration reducer sets the
  choosing player explicitly.
- In single-player sandbox (user + bot), when the bot is the `choosingPlayerId`
  the bot strategy must decide accept/decline for itself. If the bot only
  consults pendingChoice when it matches its own playerId, this should just
  work. Verify on Donald Duck on opponent side.
- The sequence of prompts means the GUI may flash two modals back-to-back.
  Consider keeping the second modal from visually overlapping the first's
  resolution animation (card draw etc).

Accept/reject routing: `acceptControllingPlayerId` is preserved on the
pendingChoice so reward effects (e.g. Return of Hercules' `play_card`) fire
with the correct controller — no change needed GUI-side. The modal just
needs to tell the RESOLVE_CHOICE action that `playerId` matches
`choosingPlayerId`.

---

## GUI: `put_card_on_bottom_of_deck` now supports `position: "top"`

Commit 249a0db extended the primitive with a `position` field. Cards:
- Gyro Gearloose NOW TRY TO KEEP UP (set 3) — item to top of deck
- Stitch Alien Buccaneer READY FOR ACTION (sets 6, 0P2) — action to top
- Gazelle Ballad Singer CROWD FAVORITE (set 10) — song to top

If the GUI has distinct animations for "to bottom of deck" vs "to top of
deck", it should read `effect.position` (or the resolved zone transition
event) to render the correct one. If the GUI just shows "moved to deck"
generically, no change needed.

---

## TBD: reverse compiler — oracle text → JSON wiring (build later tonight)

Invert the decompiler to auto-wire new cards on set import. The decompiler
already maps JSON → English via `EFFECT_RENDERERS`; a compiler adds
`EFFECT_COMPILERS` — regex pattern matchers that go English → JSON for the
80%+ of Lorcana cards that fit templated shapes ("When you play this
character, draw N cards" / "Each opponent loses N lore" / etc.).

Starter plan:
1. Extract top 50 most-common oracle-text patterns from the ~2147 implemented
   cards (normalize rulesText to placeholders; group by template).
2. Build a compiler entry per template: `{ re: RegExp, emit: (m) => Json }`.
3. On new-set import, run the compile pass; for each unwired card, try each
   regex. On match, emit JSON, run decompiler round-trip, require ≥0.85
   similarity score vs original oracle text before auto-wiring.
4. Skip below-threshold / no-match cards → stay in `card-status` queue for
   manual wiring.

Closed-loop validation is free: compile(oracle) → decompile(json) → compare.
The `fits-grammar` category in `pnpm card-status` is already the harness —
it classifies cards whose text matches known grammar but aren't yet wired.
Currently 0 across all sets because every fit was manually authored.

**Prerequisite**: improve the renderer first so more primitives have
reversible grammar. The fewer renderer gaps, the fewer false-negative
compiles. Current decompiler-tail work is fixing both wiring bugs AND
renderer gaps — every renderer improvement is a compiler template gained
when the flip happens. Don't start the compiler until the renderer covers
most of the tail.

Practical caveats:
- Oracle text drift in Lorcast data ({L}/{S} symbols sometimes dropped) —
  seed tokenizer with the same drift tolerance `pnpm audit-lorcast` handles.
- Card name normalization ("Daisy Duck" vs "this character").
- Precedence: most-specific patterns first, to avoid over-matching.
- Conservative thresholds — better to under-wire (leave for human) than
  silently miswire.

---

## Strategy: Illumineer's Quest co-op mode as a unique feature

Ravensburger's Illumineer's Quest products (Deep Trouble = quest1,
Palace Heist = quest2) are **co-op PvE** — 1-2 players vs. a scripted
boss deck with special rules. duels.ink and every other Lorcana client
today is PvP-only; co-op Quest mode is a product differentiator this
app could own.

Fits the strategic direction (`project_strategic_direction.md` in
user memory): the moat is the engine + bot + analytics flywheel, and
the product is a creator/play client that feeds the clone-trainer.
A scripted-boss mode is a natural extension of the existing RL bot
infrastructure — a Quest boss is just a deterministic policy with
special "boss-only" card primitives.

**What it takes to build:**
- Data: source the true PvE-exclusive cards (Anna — Ensnared Sister
  and similar scripted-encounter cards). Ravensburger's API doesn't
  expose them under `quest1` / `quest2` filters (those only return
  main-set cards that happen to ship in the Quest box). **Lorcast API
  does carry them** — use `scripts/import-cards.ts` (Lorcast-sourced)
  as the PvE card source. Store under `card-set-Q1.json` /
  `card-set-Q2.json` with `setId: "Q1"` / `"Q2"` — deliberately
  outside `CORE_LEGAL_SETS` / `INFINITY_LEGAL_SETS` so they never leak
  into constructed.
- Engine: `GameFormat` gains `"quest1" | "quest2"` with `Q1` / `Q2`
  as legal sets. Quest-exclusives become playable in that mode only.
- Engine: Quest-specific mechanics — boss deck shuffling rules,
  "location-like" quest objectives, turn-order variants (co-op
  side-by-side). Most are authorable as new Effect/Trigger primitives.
- Simulator: scripted boss policy (not RL) — reads from a deck
  script, plays a deterministic sequence. Simpler than Actor-Critic.
- UI: co-op board layout (two teammates + boss) — a new GameBoard
  variant. Lobby flow for pairing up vs. the boss.

**Why it pays rent beyond "cool feature":**
- Lower skill floor than PvP — onboards new Lorcana players who
  don't want to lose to humans.
- Scripted-boss cards exercise engine primitives that PvP decks
  rarely use (huge AoEs, game-rule modifications), which surfaces
  rule-coverage gaps.
- Replays + analytics generalize — Quest games are still
  seed-deterministic, so the creator-tool flywheel applies.

Not scheduled; parked here so the idea isn't lost when the Quest
import task actually lands.

---

## Strategy: mobile layout identity — what to borrow vs what to invent

User compared the sandbox game board (portrait + landscape) against
duels.ink's mobile layout. Several structural patterns were identified that
could reclaim vertical space on phones, but the user correctly flagged the
"at what point are we just copying" concern.

**Patterns observed in duels.ink (structural, not visual):**
- **Corner-badge lore + deck count** — small squares at zone corners instead
  of a horizontal scoreboard strip. Saves ~20px vertical.
- **Pips-not-fan inkwell** — `3/7` text + icons instead of a fanned card
  strip. Saves ~40px per zone (~80px total). Tradeoff: loses "which card was
  inked this turn" info (face-up cards in the fan show this). Middle ground:
  pips by default, tap to expand full fan.
- **Peek-strip hand with expand-on-tap** — only top ~30-40% of hand cards
  visible, expand on gesture. More aggressive crop than our current 70px.
- **Full-screen trigger resolution page** — replaces the board entirely
  instead of overlaying a modal. Clean separation of "resolving" vs "playing."

**What's already landed (GUI agent, this session):**
- PWA manifest (standalone install, no URL bar)
- `landscape-phone` Tailwind screen `(orientation: landscape) and (max-height: 500px)`
- Height-adaptive play cards on phones (portrait + landscape)
- Safe-area padding for Dynamic Island / notch
- Sidebar hidden, gap/padding tightened, utility strip held at mobile sizes
- Hand strip cropped to 70px in landscape-phone

**What makes this app fundamentally different from duels.ink:**
duels.ink is a pure online-play app (play Lorcana against humans/bots).
This app is an **analytics engine** that happens to have a playable sandbox.
Core differentiators:
- Headless simulation of thousands of games for **deck win rates + analytics**
- **RL-trained bot** (Actor-Critic + GAE) — not just heuristic AI
- **Query system** for asking pattern questions across simulated games
- **Active Effects pill** on the board (quotes source card ability text,
  conditional evaluation) — duels.ink doesn't surface this
- **Card injector** with qty/zone/player/set controls for sandbox testing
- **Replay mode + undo** as first-class features
- Per-format **ELO** (bo1/bo3 × core/infinity) for multiplayer
- Bot type separation (algorithm / personal / crowd)

The game board is a diagnostic/testing tool as much as a play surface. Design
decisions should lean into that — e.g. showing more game-state info (active
effects, modifier sources, stat deltas) is a strength, not clutter. duels.ink
hides game state to reduce cognitive load; this app should SHOW game state
because its users are deck-builders and analysts, not casual players.

**Decision needed (strategy agent):**
The user wants the mobile experience to feel like *this app's* identity, not
a duels.ink clone — both visually and functionally. Any individual layout
pattern above is a common TCG convention (Arena, Hearthstone, Snap all use
variants). Adopting all of them together would feel derivative.

Recommendation: pick structural changes that play to the app's strengths
(analytics-first, information-dense, diagnostic sandbox) rather than copying
a pure-play app's "hide everything" approach. E.g.:
- Compact inkwell pips (biggest space win) BUT keep tap-to-expand showing
  actual inked cards (information this app's users care about).
- Keep the Active Effects pill prominent — it's a unique feature.
- Invest in unique interactions that serve the analytics/testing use case
  (card inspect on long-press, stat breakdown tooltips, quick save/load
  accessible in landscape).

Reference screenshots are in `C:\Users\Ryan\Downloads\other app screenshots\`
(not in repo — IP-sensitive). Do not commit them.

---

## GUI: each_player rendering in card text / log messages

The decompiler renderer outputs "each opponent with more lore than you: they
lose 1 lore" — third-person rewrite of "you" → "they" inside the wrapper
body. If the GUI uses the engine's ability text or log messages to describe
what's happening at apply time (e.g. "player1 played Tangle → player2 lost
1 lore"), the log is already player-qualified via `appendLog`. No change
expected, but if any UI surfaces rulesText rendered by the decompiler, the
new wording is ready for it.

## DB: soft-delete on `decks` table for post-hoc analysis

Currently `deleteDeck(id)` in `packages/ui/src/lib/deckApi.ts` hard-deletes
the row via Supabase. Once a user deletes a deck, we lose:
- The deck's final composition before abandonment
- The deck_versions history that had been accumulating
- Signal about what deck ideas users tried and discarded

**Suggested change** (DB/engine agent):
1. Schema: `ALTER TABLE decks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`
2. `deleteDeck(id)` becomes a soft-delete: sets `deleted_at = NOW()` instead
   of `DELETE FROM decks`.
3. `listDecks` filters out rows with `deleted_at IS NOT NULL`.
4. Consider cascading to `deck_versions`: either leave them (references
   still resolve) or mirror a `deleted_at` column on versions too.

**Why we'd want this:** the clone-trainer / analytics pivot (per
`project_strategic_direction.md`) benefits from knowing which decks
users *abandoned* as much as which ones they kept. Hard-deleting erases
that signal. A soft-delete keeps the row available for backend queries
without exposing it in the UI list.

**UI-side impact:** none — `listDecks()` already returns only what it's
given. Once the column + filter exist, the UI works unchanged.

**Out of scope here:**
- Admin UI to restore deleted decks (not needed for analytics).
- Periodic hard-delete job for rows older than N months (compliance
  concern that'd need product input).

Noted during GUI session where the user asked whether Reset should keep
deck history. Delete is the reset path (Delete → New Deck), but the DB
should preserve the record for analytics even when the user removes it
from their list.

## Deckbuilder: follow-up polish for `/decks/:id`

Captured during the 2026-04-19 GUI session after the MTGA-style split
+ box-art + variants stack landed. Not blocking — tile view looks good,
keep these for a future polish pass:

1. **Deck-row arrangement.** Rows currently render flat (cost asc →
   name) inside a single scroll area. Options: group by card type
   (characters / actions / items / locations) with collapsible headers,
   or group by cost bucket with inline cost-curve bars. MTGA groups by
   type; Moxfield lets you pick. Worth considering once more decks are
   real-world tested.

   Also: each row has too much horizontal content for the narrow
   340px-or-so column — cost badge + truncated name + ink dots +
   [−][N][+] + ✕.

   Concrete target (duels.ink row for reference):
   `cost | color symbol | long-truncated-name (e.g. "Scrooge McDuck -
   Afficio...") | variant picker | [−] X/Y [+]`. No ✕ — removal is
   implicit when [−] takes qty from 1 to 0. Name gets more
   horizontal room because the trailing stepper is compact and the
   row drops the ink dots pair in favor of a single color symbol
   (we already ship proper Lorcana ink icons at
   `packages/ui/public/icons/ink/`).

   Minimum changes to match that target in our DeckBuilder row:
   - Drop the trailing ✕ button (− at qty 1 removes the entry).
   - Replace ink-dot pair with a single ink icon per card (we have
     them — `/icons/ink/<color>.svg`).
   - Move qty to `X/Y` format (matches CardTile stepper already).
   - Pull stats/meta off its own line — put it inline or drop it
     since stats are visible in inspect.
   - Surface the variant picker per-row (currently only on the
     CardTile in the browser grid) so users see deck-level variant
     choices at a glance.
   All optional, but together they'd dramatically reduce row
   clutter and improve name legibility in the narrow column.
2. **Export options.** Today we have plaintext export (round-trips with
   Inkable / Dreamborn). Useful additions:
   - **Image export** — render the deck list as a PNG for sharing /
     social. Use canvas or html-to-image from a formatted DOM node.
     Creator tooling per `project_near_term_priorities.md`.
   - **Registration sheet** — the paper form for official events, with
     player info + card list in the Ravensburger tournament format.
     PDF export probably, or printable HTML.
3. **Known good:** My Decks list page with deck box-art tiles reads well
   — don't re-redesign unless there's a specific complaint.
4. **Consider: flip to browser-primary + deck-in-drawer layout** (duels
   pattern). Currently we're editor-primary + browser-opt-in. Duels
   treats browsing as the main activity and slides the decklist out
   from the side. Mobile-friendly analogue: bottom sheet for the deck
   (MTGA mobile does similar). Worth considering if users report they
   want more browsing surface area. It's a non-trivial layout refactor
   — both <DeckBuilderPage> structure and CardPicker sizing change.

## Deckbuilder: variant picker → icon-based dropdown (once rarity icons ship)

Current deck-row variant picker cycles through available variants on
click (`Reg → Ench → Promo → Reg …`). Works but users can't see all
options until they click through. Text labels are cryptic for users
unfamiliar with Lorcana's 6-variant vocabulary.

When rarity icons ship (assets/icons/rarity/ or similar), swap the
cycle-on-click for a compact popover menu:

- Button shows current variant as a small icon
- Click opens a dropdown listing all variants with icon + label
  (e.g. 🔶 Regular · ✨ Enchanted · 🌟 Iconic · ⚜️ Epic · 🎖 Promo · 🎟 Special)
- Click a row selects + closes
- Same pattern as the existing group-by dropdown (DeckBuilder.tsx) and
  saved-decks combobox, so it'll match the in-app chrome

No engine changes — same `DeckEntry.variant` model. Pure UI refactor
in `DeckBuilder.DeckRow`.

## Deckbuilder / server: Core-vs-Infinity format legality — UI + server hookup

Engine side landed in `packages/engine/src/formats/legality.ts`:

- `CORE_LEGAL_SETS` = { 5, 6, 7, 8, 9, 10, 11, 12 } (rotates — source of
  truth is Ravensburger's Disney Lorcana TCG Organized Play rules).
- `INFINITY_LEGAL_SETS` = sets 1-12 + all promo sets.
- `CORE_BANLIST` = empty as of 2026-04-19.
- `INFINITY_BANLIST` = `["hiram-flaversham-toymaker"]`.
- `isCardLegalInFormat(def, format)` — single-card check.
- `isLegalFor(entries, defs, format) → { ok, issues[] }` — deck-level
  check. Reprint rule: iterates `def.printings[]` (falls back to canonical
  `setId` + `variants[]` for cards with only one printing).
- `LegalityIssue.reason`: `"banned" | "set_not_legal" | "unknown_card"`,
  with a UI-ready `message` string.

Multiplayer already tracks `game_format: "core" | "infinity"` on lobbies +
ELO (`schema.sql:96`, `gameService.ts:184`) as an honor-system tag. The
engine helpers now let UI and server enforce it.

**UI (GUI agent lane):**
- Per-deck `format` field stored on `decks` table (new column,
  `"core" | "infinity"` with **`"core"` default** — most new decks target
  the competitive format; Infinity is an explicit opt-in for experienced
  players who want access to older cards).
- Format picker in `DeckBuilderPage` (next to deck name).
- **Auto-apply format as a CardPicker filter.** Selecting `"core"` on
  the deck pre-applies a hidden "Core-legal" filter on the card browser
  (use `isCardLegalInFormat`) so users can't see (and accidentally add)
  non-Core cards. Selecting `"infinity"` swaps to the Infinity filter
  (hides Hiram). Implicit filter (not a user-toggleable chip) so it
  never conflicts with the declared format.
- Badge on `DecksPage` tiles showing declared format + a warning glyph
  when `isLegalFor(entries, defs, format).ok` is false.
- In `DeckBuilderPage`, surface the `issues[]` list inline (e.g.
  "Hiram Flaversham Toymaker — banned in infinity") so the user can fix.

**Server:**
- Lobby creation calls `isLegalFor(entries, defs, lobby.game_format)`
  before marking the match ready. Reject with the issues list if `ok`
  is false. Prevents Core queue from getting Infinity-only decks
  mid-match.

**Maintenance:** update `CORE_LEGAL_SETS` when Ravensburger rotates
(new set drops push the oldest out roughly once per year). Ban
additions go in the relevant `*_BANLIST`. Source of truth is
Ravensburger's OP rules; add a dated note alongside any change.

## GUI: MTGA-style "shortened" card rendering in play zones

Idea for the board: crop cards in play to ~top half of the source image so
only art + name + stats show, hiding the unreadable rules-text block. MTGA
and old Pixelborn Lorcana do this; duels.ink keeps the full card. Matches
the "chrome that differentiates vs content forced by genre" distinction in
`feedback_visual_identity.md` — this is chrome, we can diverge.

**Realistic vertical-space gains** (measured against current card sizes in
`GameCard.tsx`):
- Desktop play card (`lg:w-[120px]`, 168px full): crop at 5:3.5 → 84px. Save
  ~84px per row × 2 play zones = ~168px reclaimed (~15-20% of a 900px
  viewport).
- Mobile play card (`w-[52px]`, 73px full): crop at 5:3.5 → 36px. Save
  ~37px per row × 2 = ~74px (~10% of an 844px iPhone viewport).
- MTGA-style 5:4.5 (keeps stats bar, drops only the rules-text block):
  roughly half the savings — ~80px desktop, ~35px mobile.

**What has to come with it:**
- Hover/long-press preview flow must show the full card so users can still
  read rules when they need to (covered by the pending "hover preview on
  play-zone cards" + "long-press mobile equivalent" items discussed but
  not yet scheduled).
- Re-place keyword icons, damage counters, drying overlay, stat-delta
  badges for the shorter card.
- Consistent identification: card name must stay visible at the top of the
  cropped tile so hand→play recognition doesn't break.

**Consider gating the crop by viewport / orientation.** Not every surface
needs it:
- Landscape-phone (very short vertical): biggest win — apply the crop.
- Portrait-phone: meaningful win, probably apply.
- Desktop: usually vertical space isn't tight; full card fits fine.
  Could leave as-is or apply a milder 5:4.5 crop.
A Tailwind class like `landscape-phone:aspect-[5/3.5]` lets the crop
only engage where it actually pays rent. Matches the existing
`landscape-phone:` breakpoint used elsewhere in `GameCard.tsx`.

Out of scope for the current deckbuilder stack — this is a GameBoard /
play-zone change. Pick up when the deckbuilder work lands and there's a
dedicated session for board chrome.
