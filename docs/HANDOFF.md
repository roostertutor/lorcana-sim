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
1. Quest card numbering — decide whether Illumineer Quest cards should be
   stored under their original set + number (Ravensburger's scheme) or
   duplicated under `Q1`/`Q2` with Quest-specific numbers (the app's cache
   filenames use the Quest scheme). Blocks `quest1`/`quest2` import.
2. Filename rename — `packages/engine/src/cards/card-set-*.json` →
   `card-set-*.json` (name was accurate when all data came from Lorcast;
   source-neutral now). Single-purpose PR after the source swap settles.
3. Promo migration — if/when Ravensburger exposes P1/P2/P3/cp/D23/DIS or
   we find another authoritative source, retire `scripts/import-cards.ts`.

**Validation:** `pnpm --filter engine test` (460/460) and `pnpm card-status`
(0 invalid) should stay green after any re-import.

---

## Engine: unify play-cost and move-cost reduction systems (deferred cleanup)

Both follow the same conceptual model — base cost + ordered stack of
reductions, where each reduction has a CardFilter (what's eligible for the
discount), an amount, an optional selfOnly/oncePerTurn gate, and a
sourceInstanceId for the once-per-turn marker. They're implemented as two
independent code paths today:

- **Play**: `gameModifiers.costReductions` Map (statics like Mickey Broom),
  `state.players[pid].costReductions` (one-shot like Lantern), `self_cost
  _reduction` static (LeFou), once-per-turn keys (Grandmother Willow). Stacked
  in `applyPlayCard` ~640-712.
- **Move**: `gameModifiers.moveToSelfCostReductions` Map (location-keyed,
  Jolly Roger), `gameModifiers.globalMoveCostReduction[]` (item-keyed, Map
  of Treasure Planet) with optional `selfOnly` + `oncePerTurnKey` (Raksha,
  added 4c63b82). Stacked in `applyMoveCostReduction`.

Worth unifying once a third "cost reduction" mechanism appears (shift cost
reductions? sing cost reductions?). For now ~6 play cards + ~3 move cards
— not enough to justify the refactor. Cleanup-of-cleanup.

Unified shape if/when:
```ts
{ kind: "play" | "move",
  amount: number,
  cardFilter?: CardFilter,        // card being played/moved
  locationFilter?: CardFilter,    // move only
  playerId: PlayerID,
  selfOnly?: boolean,
  sourceInstanceId?: string,
  oncePerTurnKey?: string }
```

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

## Deckbuilder: Core-vs-Infinity format legality

Multiplayer already tracks `game_format: "core" | "infinity"` on lobbies +
ELO (`schema.sql:96`, `gameService.ts:184`), but it's just a pass-through
tag today — there's no engine-side enforcement and no Core-legal-sets
list. The deckbuilder doesn't surface format legality either; My Decks
tiles currently don't indicate whether a deck can be played in Core.

**What's needed:**
1. Engine: export a `CORE_LEGAL_SETS: Set<string>` constant listing the
   Core-rotation setIds (currently — per Ravensburger — the latest four
   main sets; rotates over time so this is a maintenance-required value).
2. Helper `isCoreLegal(entries, definitions)`: every entry's `def.setId`
   is in `CORE_LEGAL_SETS`. Returns a boolean.
3. UI: badge on each deck tile in `DecksPage` reading "Core + Infinity"
   (passes the check) vs "Infinity only" (one or more entries from a
   non-Core set). Also surface in `DeckBuilderPage` so the editor can
   warn the user as they add non-Core cards.
4. Optional: user-picker for target format on a deck so the UI can warn
   when a deck tagged "Core" drifts out of legality. Lower priority —
   auto-derive is fine for MVP.

**Where this was discussed:** GUI session that shipped the deckbuilder
rebuild (see `a0cfb67`, `42be9ea`). Scope was kept narrow to UI work;
format legality was flagged as a feature needing engine + UI coordination.

**Scope:** engine constant + helper is trivial. The Core set list has to
be maintained whenever Ravensburger rotates (annually-ish), so document
the source of truth (their official site) alongside the constant.

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

Out of scope for the current deckbuilder stack — this is a GameBoard /
play-zone change. Pick up when the deckbuilder work lands and there's a
dedicated session for board chrome.
