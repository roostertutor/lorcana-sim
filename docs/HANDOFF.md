# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

---

## Engine + server agents: CRD 2.1.3.2 play-draw rule — coin-flip winner / series loser chooses go-first-or-second

Discovered 2026-04-22 during mobile UX planning. Current implementation
forces the coin-flip winner to go first and has no play-draw election
anywhere. Violates CRD 2.1.3.2 for Bo3; also missing the tournament
convention for game 1.

### Current state

**Engine** (`packages/engine/src/engine/initializer.ts:203`):
```ts
firstPlayerId: "player1",   // hardcoded, no choice
```

**Server** (`server/src/services/gameService.ts:38-44`):
```ts
// Randomize who goes first — engine always starts with "player1"
const hostGoesFirst = Math.random() < 0.5
const p1Id = hostGoesFirst ? hostId : guestId
const p2Id = hostGoesFirst ? guestId : hostId
```
Server slots the coin-flip winner into `player1`, engine forces that user
to go first. No election is ever offered. Bo3 games 2/3 currently reuse
the same random assignment (also wrong per 2.1.3.2).

### CRD rules (verbatim from PDF page 6)

- **2.1.3.1** — *two-game series*: game-2 starter is forced to be the
  game-1 non-starter. (We don't play 2-game series, so this is likely
  inapplicable — confirm with server agent.)
- **2.1.3.2** — *best-of-N series*: "The losing player selects whether to
  be the starting player or not for the next game. This is known as the
  'play-draw' rule." (**This is Bo3 games 2 and 3.**)
- **2.2.1.1** — game 1: players agree on a random method determining the
  starting player. CRD doesn't explicitly say the flip-winner elects, but
  tournament convention does, and the user (product owner) wants the
  option offered in all cases.

### Proposed architecture

#### Engine (primary — engine-expert)

1. Add `PendingChoice` type `choose_play_order`:
   ```ts
   {
     type: "choose_play_order";
     choosingPlayerId: PlayerID;
     prompt: string;  // "You won the coin flip — go first or second?"
     // Two options: "first" | "second"
   }
   ```
2. Add new phase before `mulligan_p1`: `play_order_select`.
3. `initializer.ts`: **stop hardcoding** `firstPlayerId`. Initial state:
   - `firstPlayerId: null` (or leave unset)
   - `currentPlayer: config.chooserPlayerId ?? "player1"` (tentative;
     updated on choice resolution)
   - `phase: "play_order_select"`
   - `pendingChoice: { type: "choose_play_order", choosingPlayerId: <chooser>, ... }`
4. `GameConfig` gains `chooserPlayerId?: PlayerID` (defaults to
   `"player1"`). Server passes this for Bo3 game 2/3 (the previous-game
   loser).
5. Reducer `RESOLVE_CHOICE` for `choose_play_order`:
   - choice === "first"  → `firstPlayerId = choosingPlayerId`, `currentPlayer = choosingPlayerId`
   - choice === "second" → `firstPlayerId = opponent`,          `currentPlayer = opponent`
   - Transition to `mulligan_p1`, with mulligan's `choosingPlayerId` being
     the new `firstPlayerId` (CRD 2.2.2 orders mulligan starting with the
     starting player).
6. Bot strategies (GreedyBot, RandomBot, RLPolicy, choiceResolver): auto-pick
   `"first"`. Can revisit later if play-draw ever becomes a strategic RL
   decision — likely not (going first has positive EV in virtually every
   matchup in Lorcana).

#### Server (secondary — server-specialist)

- **Game 1**: keep existing `Math.random()` slot assignment. Coin-flip
  winner goes into `player1` slot; engine's `choose_play_order` prompts
  that user via the `player1` `choosingPlayerId`. No server logic change
  needed beyond passing `chooserPlayerId: "player1"` to `createGame`
  (which will be the default).
- **Bo3 games 2/3**: when spawning the next game, the **loser** of the
  previous game goes into the `player1` slot AND `chooserPlayerId:
  "player1"` is passed. Loser election flows naturally. Schema check:
  `games.player1_id` / `player2_id` slot swap between games is fine — no
  migration needed, just the slot-assignment logic in the "create next
  Bo3 game" path.
- Action validation: server already routes `RESOLVE_CHOICE` through the
  engine; no new action type needed.

#### UI (follow-on — ui-specialist, after engine lands)

- New variant in `PendingChoiceModal.tsx` for `choose_play_order`: two
  large buttons ("Go First" / "Go Second"), context subtitle:
  - Game 1: "You won the coin flip"
  - Bo3 game 2/3: "You lost game N — choose your play order"
- Opponent-side view: reuse "Opponent is thinking…" banner, or a
  dedicated "Opponent is choosing play order…" variant.
- Sandbox: extend `GameBoard.tsx:1099` auto-resolve effect to also
  auto-resolve `choose_play_order → "first"` so the existing skip-the-
  ceremony behavior is preserved in sandbox.
- Solo vs bot: human is `player1`, `choosingPlayerId === "player1"`,
  modal shows for the human every game. Bot branch doesn't matter
  because we always control the chooser.

### Tests

- **Engine** (`reducer.test.ts` or new `play-draw.test.ts`):
  - `choose_play_order` → `"first"`: `firstPlayerId === chooser`,
    `currentPlayer === chooser`, phase transitions to `mulligan_p1` with
    chooser as mulligan starter.
  - `choose_play_order` → `"second"`: `firstPlayerId === opponent`,
    `currentPlayer === opponent`, phase transitions to `mulligan_p1` with
    opponent as mulligan starter.
  - `chooserPlayerId: "player2"` config → pendingChoice's
    `choosingPlayerId === "player2"` on game start.
  - `getAllLegalActions` during `play_order_select` phase returns exactly
    the two RESOLVE_CHOICE options and nothing else (no `PASS_TURN`, no
    `PLAY_INK`, etc.). Matches validator/action-enumerator parity rule
    from CLAUDE.md.
  - Mulligan starts AFTER play-order is chosen — a test that asserts
    `pendingChoice.type === "choose_mulligan"` only after play-order
    resolves.
- **Simulator** (`rl.test.ts` or similar): 100-game sim completes with no
  stalls (bot auto-picks "first", game proceeds normally).
- **Server**: Bo3 game 2 created after game 1 ends — `player1_id` of
  game 2 matches the loser of game 1.

### Audit improvement

Per CLAUDE.md bug-fix workflow rule, every engine bug fix ships a
regression test AND an audit improvement. For this one: add a check to
`audit-dead-primitives` or `card-status` that validates **every
`choosingPlayerId` in a PendingChoice points at a real player slot** and
that **`firstPlayerId` is non-null in any state past phase
`play_order_select`**. The latter catches future regressions where
someone forgets to transition out of the new phase.

### Scope

This is a ~2-day engine + server task, then a ~2-hour UI modal task.
Engine lands first; UI picks up the new `choose_play_order` variant
after the engine + server changes ship. UI agent (me) is standing by —
will pick up the modal work once engine-expert completes the reducer.

### DONE — engine side landed 2026-04-22 (engine-expert)

Engine work shipped. Server + UI follow-ons are unblocked.

**What landed:**
- `GamePhase` gains `play_order_select` (pre-mulligan) in
  `packages/engine/src/types/index.ts`.
- `PendingChoice` union gains `choose_play_order`; string choice values are
  `"first"` / `"second"`, same shape as `choose_may`.
- `GameConfig.chooserPlayerId?: PlayerID` (default `"player1"`) in
  `packages/engine/src/engine/initializer.ts`. `createGame` no longer
  hardcodes `firstPlayerId` — initial state now has
  `firstPlayerId: undefined`, `phase: "play_order_select"`, and seeds a
  `choose_play_order` PendingChoice for the chooser.
- `applyResolveChoice` reducer branch for `choose_play_order` (in
  `packages/engine/src/engine/reducer.ts`) sets
  `firstPlayerId` / `currentPlayer` from the choice and transitions to
  `mulligan_p1` with the starting player mulliganing first (CRD 2.2.2).
  The existing mulligan-advance logic was reworked to key off
  `state.firstPlayerId` instead of the hardcoded `player1`/`player2` slot
  names, so mulligans proceed starting-player-first even when player2 is
  the starter.
- `validateResolveChoice` validates `choose_play_order` — accepts exactly
  `"first"` or `"second"`, rejects everything else.
- Bots auto-pick `"first"` (RandomBot, GreedyBot via choiceResolver,
  RLPolicy). No new RL net head — going first is +EV in virtually every
  matchup; a dedicated net would overfit a trivially dominated binary.

**Tests:**
- New `packages/engine/src/engine/play-draw.test.ts` — 11 tests:
  both election branches, `chooserPlayerId` routing to player2,
  starting-player-first mulligan ordering, validator-rejection parity
  with the `getAllLegalActions` `[]` return during `play_order_select`
  (per CLAUDE.md validator/enumerator pairing rule), wrong-player
  rejection, invalid-value rejection, and the "choose_mulligan appears
  only AFTER play-order resolves" assertion.
- `startGame()` test helper and the rl.test.ts `createTestState` both
  prepend a `"first"` election so pre-existing tests preserve their
  semantics. All 598 engine tests + 50 simulator tests still green.

**Audit improvement (per CLAUDE.md bug-fix workflow rule):**
Added two invariants to the Layer 3 1000-game RandomBot/GreedyBot
invariant check in `packages/simulator/src/simulator.test.ts`:
1. Every `pendingChoice.choosingPlayerId` must be a real player slot.
2. `state.firstPlayerId` must be non-null past the `play_order_select`
   phase. The latter catches future regressions where a new mulligan or
   transition path forgets to set the starting player.

**Server follow-ons (server-specialist — DONE 2026-04-22):**

Server work shipped. UI is the only remaining piece.

**What landed (server-specialist):**
- `gameService.createNewGame` refactored: signature is now
  `(lobbyId, p1Id, p2Id, p1Deck, p2Deck, gameNumber?)` — callers own the
  slot decision, function no longer randomizes internally. Passes
  `chooserPlayerId: "player1"` explicitly to `createGame` so the election
  prompt always routes to the slot-1 user.
- `lobbyService.joinLobby` (game 1): coin-flip moved to the call site
  before `createNewGame`. Coin-flip winner → `player1` slot with their
  correct deck.
- `gameService.handleMatchProgress` (Bo3 games 2/3): previous-game loser
  goes into `player1` slot (CRD 2.1.3.2). **Also fixes a pre-existing
  deck-swap bug** — the old path passed `player1Id` as `hostId` and
  `lobby.host_deck` as `hostDeck`, then randomized inside
  `createNewGame`, which could pair a user with the wrong deck whenever
  the previous game's slot assignment didn't match host/guest. New logic
  explicitly looks up each user's deck via the host_id / guest_id →
  deck map stored on the lobby.
- `RESOLVE_CHOICE` routing unchanged — `gameService.ts` already uses
  `state.pendingChoice.choosingPlayerId` for active-player checks.
- `stateFilter.ts` unchanged — `choose_play_order` is public info
  (both players see who's choosing; choice itself is public after
  resolution).
- No schema migration needed — `chooserPlayerId` lives in the engine's
  `GameConfig` and flows into the stored `GameState` blob.
- Typecheck: 1 pre-existing server error, no new errors introduced.
- All 598 engine + 50 simulator + 15 analytics tests remain green.

**UI follow-ons (ui-specialist — unblocked):**
- `PendingChoiceModal.tsx` needs a `choose_play_order` variant: two
  buttons ("Go First" / "Go Second"), context subtitle per game 1 /
  Bo3 game N.
- Sandbox auto-resolve (`GameBoard.tsx:1099-1105`) needs to also
  auto-resolve `choose_play_order → "first"` so sandbox flow doesn't
  hang on the new phase. Without this one-line addition, opening the
  sandbox will block on the play-order prompt.
- UI already guards `firstPlayerId != null` in the mulligan subtitle
  (`PendingChoiceModal.tsx:297-298`) so the nullable-until-resolved
  behavior is already tolerated.

---

## UI agent: clip / GIF export — frame-by-frame design

Discussed 2026-04-22. When we pick up clip export, don't chase smoother
in-game animations first — they actively hurt GIF quality. GIFs sample at
10–15fps, so a 200ms CSS transition gets 1–2 mid-transition frames and
looks choppy. Real-world TCG clip tools (Hearthstone Deck Tracker, MTGO)
solve this with **snapshot-per-action pacing**, not motion tweens.

### Frame model

One frame per engine action / meaningful `GameEvent`. Each frame = rendered
gameboard at that `GameState` + transient overlay callouts for the event(s)
that just resolved, held for a duration keyed to event type.

Per-event hold durations (starting points):
- Draw / ink: 400ms
- Turn boundary banner: 500ms
- Play a card: 700ms
- Sing / Challenge / Quest: 800–900ms
- Damage resolution / banish: 1000ms
- Pass turn: 400ms

Callout overlays (mostly exist already):
- RevealPill, damage counter, stat delta badges, keyword icon badges,
  active-effects pill, scoreboard ×N pill — reuse
- Needed new: "+ink", "+lore", "Sang:", "Challenge", "Drew", turn banner
  (top-of-clip only), optional caption strip (creator-authored)

### Capture mode (required)

Add a flag that strips `transition-*` → `transition-none` and disables
hover states during recording, so nothing is mid-tween when the encoder
samples. Also freezes any `animate-pulse` so the connection-status dot
doesn't strobe.

### Stack

- Replay system already walks actions forward frame-by-frame — reuse
- `html2canvas` or `dom-to-image` for per-frame rasterization
- `gif.js` for direct GIF encoding (simpler) OR MediaRecorder → WebM →
  `ffmpeg.wasm` → GIF (better quality, bigger bundle)
- Clip scope selector: "last N actions" / "whole turn" / "custom range in
  replay timeline"

### What NOT to build first

- Card-movement animations (hand→play slide, banish-to-discard flight)
- Damage flash tweens
- Anything framer-motion

These are gameboard-specialist territory AND regress GIF quality. Only
consider them after creators tell us static clips read badly.

---

## UI agent: iOS mobile chrome-collapse — revisit for extra vertical space

Discussed 2026-04-22. On iPhone Chrome/Safari, the URL bar shrinks and the
bottom bar hides when the document body is scrolled — reclaiming ~60px of
vertical. PWA mode (already shipped) eliminates chrome entirely for users
who install; this note is for non-installed browser fallback.

### Constraints (verified)

- iOS only collapses chrome on **user-initiated touch-scroll gestures**.
  Programmatic `window.scrollTo` does NOT count (that trick died ~iOS 8).
  Tap gestures don't count either.
- Sub-container scroll (`overflow: auto` div) does NOT trigger collapse.
  Must be document-level scroll.
- If page isn't taller than viewport, there's nothing to scroll → bars
  stay full-size forever. Current `100vh` layout hits this.

### Proposed approach (not yet implemented)

1. Global `100vh` / `h-screen` → `100dvh` sweep. `dvh` re-measures as bars
   hide/show; board re-flows into reclaimed space. `svh` (small) and
   `lvh` (large) available for cases where you want a fixed target.
2. `overscroll-behavior: none` on `html, body` to kill pull-to-refresh
   rubber-banding that un-collapses bars.
3. On the gameboard route only: make body `minHeight: calc(100dvh + 60px)`
   so there's a scroll buffer. Once user performs any drag/swipe past
   threshold (~30px), set `document.body.style.overflow = "hidden"` to
   freeze the scroll position and keep bars collapsed.
4. Keep a `pt-safe` / `env(safe-area-inset-top)` buffer so top-edge taps
   don't re-trigger the chrome reveal zone.

### Known gotchas

- Still requires a user gesture to trigger — no instant collapse on load
- Tapping near top screen edge can re-show bars (iOS system behavior, no
  CSS workaround)
- iOS sometimes re-shows bars after ~5s of inactivity in non-PWA Safari,
  undocumented behavior, varies by iOS version. Expect ~90% effectiveness.

### Rejected alternatives

- Programmatic auto-scroll on load → dead on modern iOS
- Fullscreen API → only works on `<video>` elements in iOS Safari/Chrome
- Modal-tap-triggers-collapse → taps don't count as scroll gestures

Not urgent; PWA covers the engaged users. Pick this up if we see drop-off
data suggesting first-visit mobile users bounce due to cramped layout.

---

## Engine agent: Tod Knows All the Tricks IMPRESSIVE LEAPS — wrong trigger scope

Discovered 2026-04-22 while fixing Vanish's action-vs-ability scope (see
commit tracking Vanish fix). Tod's wiring has two mismatches vs. oracle:

**Oracle text**: "Twice during your turn, whenever this character is
**chosen** for an action or **an item's ability**, you may ready him."

**Current wiring** (`card-set-11.json`, id `tod-knows-all-the-tricks`):
```json
{
  "trigger": { "on": "chosen_by_opponent" },
  "condition": { "type": "is_your_turn" },
  "maxFiresPerTurn": 2,
  "effects": [{ "type": "ready", "target": { "type": "this" }, "isMay": true }]
}
```

### Bug 1: Under-fires — doesn't trigger on self-chosen

Tod says "chosen" (no "by an opponent"), so he responds to BOTH self-chosen
and opponent-chosen. Current `chosen_by_opponent` event only fires when the
chooser is opposing. Tod should also ready when Tod's own controller picks
him as the target of their own action card (uncommon but real: "ready
chosen character of yours" type effects).

### Bug 2: Over-fires — triggers on character/location abilities

Tod's scope is "action or an **item's** ability" — explicitly excludes
character and location abilities. Current wiring has no source-cardType
filter, so any opposing choice (ability or action) that picks Tod rings
the bell.

### Proposed fix

Option A (minimal): Change trigger type to a new event (e.g.
`chosen_for_action_or_item_ability`) queued by RESOLVE_CHOICE with the
source's cardType filtered inline. Mirrors the existing Vanish
cardType gate (`srcDef.cardType === "action"` — extend to `"action" ||
"item"`, drop the opposing-owner check so it fires on both sides).

Option B (type expansion): Keep `chosen_by_opponent` as the event name but
add a `sourceCardType?: CardType[]` field to the trigger filter; Tod would
set `sourceCardType: ["action", "item"]` and remove the "opponent" scope
(since "chosen" matches both chooser types).

Option B composes better with future cards but needs a new trigger-filter
field. Either way — not urgent; Tod Knows All the Tricks is a niche card.

### Test pattern

Regression tests should cover all four cells:
| Source      | Chooser  | Expected |
|-------------|----------|----------|
| Action      | opponent | ready    |
| Action      | self     | ready    |
| Item ability| opponent | ready    |
| Item ability| self     | ready    |
| Char/loc ab.| any      | **don't** |

---

## ~~Server / MP agent: anti-cheat filter doesn't preserve `lastRevealedHand`~~ — DONE 2026-04-21

Landed via `server-specialist` agent. Fix applied as described: 4-line addition
to `server/src/services/stateFilter.ts` that lifts `lastRevealedHand.cardIds`
into the preserve-set when the viewer is the intended audience (public reveal
OR `privateTo === viewer`). Mirrors the existing `lastRevealedCards` treatment.

**Test coverage NOT added** — server package has no test runner / test files
at all (only `typecheck`). Adding vitest + a `stateFilter.test.ts` is infra
work beyond the scope of a 4-line fix; see follow-up note at the bottom of
this doc ("Server agent: set up server-side test infrastructure"). Manual
verification path: in MP, play a set-12 `look_at_hand` effect — the peeker's
UI should render the face-up cards instead of card backs.

### Original bug description (kept for context until deploy-verified)

### Bug

`server/src/services/stateFilter.ts` correctly preserves
`lastRevealedCards.instanceIds` from being stubbed out as hidden (line
40: `const revealedSet = new Set(state.lastRevealedCards?.instanceIds ?? [])`).
It does **NOT** preserve `lastRevealedHand.cardIds`. So any reveal that
populates `lastRevealedHand` (both public `reveal_hand` and private
`look_at_hand` with `privateTo: controllingPlayerId`) hits the filter
and has its referenced hand instances replaced with
`{ definitionId: "hidden", … }` stubs in the player's filtered state.

### Impact

In MP, when player1 plays a `look_at_hand` effect on player2's hand:
- Engine sets `lastRevealedHand = { playerId: p2, cardIds: [...],
  privateTo: p1 }`.
- Server sends filtered state to p1.
- Filter strips p2's hand (in the "hand" zone) because the IDs are NOT
  in `revealedSet` (only `lastRevealedCards` is).
- p1's UI reads `gameState.lastRevealedHand.cardIds` → looks up each in
  `state.cards[id]` → gets "hidden" stubs → renders card backs in the
  RevealPill / ZoneViewModal **even though p1 is the player who peeked**.

Same problem for public `reveal_hand` effects (both players should see,
but filter stubs them for the viewing side because it only treats
`lastRevealedCards` as public).

**Cards currently affected:** set 12 introduced `look_at_hand` effects
(see `set12.test.ts:745-783` — "on play, snapshots the opposing hand
with privateTo=controller"). Any future public `reveal_hand` abilities
have the same issue. Sandbox (single-player) is unaffected — the filter
isn't in that code path. MP only.

### Fix (~4 lines)

File: `server/src/services/stateFilter.ts`, just before the
`hiddenZones` loop at line 43:

```typescript
// Cards referenced by lastRevealedHand are visible to viewers the reveal
// was scoped to: public reveals (privateTo == null, both players should
// see) and peeks where the viewer is the one who peeked (privateTo ===
// playerId). Same principle as lastRevealedCards above: reveals preserve
// info for the audience that was meant to receive it.
const revealedHand = state.lastRevealedHand;
if (revealedHand && (revealedHand.privateTo == null || revealedHand.privateTo === playerId)) {
  for (const id of revealedHand.cardIds) revealedSet.add(id);
}
```

The rest of the filter already checks `revealedSet.has(id)` before
stubbing, so this just lifts the right instance IDs into the preserve-set.

### Test coverage to add

Server doesn't currently have a `stateFilter.test.ts` (check me on
this). Worth adding minimal coverage:
1. Public `reveal_hand` → cards preserved in BOTH players' filtered states.
2. `look_at_hand` (privateTo: p1) → cards preserved in p1's state, stubbed in p2's.
3. `look_at_hand` (privateTo: p1) but the hand afterward is unchanged →
   still stubbed for p2 on the next fetch (filter is stateless, so as
   long as `lastRevealedHand` remains set it leaks — this is a broader
   question: when does the engine clear `lastRevealedHand`? If it sticks
   across the opponent's following turn, the peeker keeps seeing it,
   which matches UI intent but might need a reducer sweep to confirm
   non-viewer doesn't get re-filtered on every poll).

### Non-urgent but pre-deploy

Per CLAUDE.md: "server — done (core). Remaining: Railway deploy, OAuth."
This filter gap doesn't block deploy but should land before
user-facing MP testing with set 12 `look_at_hand` cards (otherwise those
abilities silently show card backs and look broken). Sandbox play is
unaffected — file this as a P1 on the server track, not a P0 blocker.

---

## [DEFERRED 2026-04-21] Engine agent + Bot-trainer agent: reveal-info model — bots currently have oracle access

**STATUS: deferred by user on 2026-04-21. Not a priority right now. Do not
pick this up proactively — reopen only if/when "human-like bots" becomes
a product requirement (e.g. MP bot opponents that shouldn't telegraph
hidden info, clone-trainer calibration fidelity). Entry preserved because
it documents real architectural debt + a full implementation sketch;
resuming from scratch later would waste the analysis.**

**Originally raised 2026-04-21 during a sandbox QOL pass (reveal-modal
→ reveal-pill, turn-anchored auto-clear). The GUI change is cosmetic;
this note is about the deeper simulation-fidelity problem it exposed.**

### Current state (verified in code, not memory)

**Engine tracks reveals as transient state:**
- `GameState.lastRevealedHand?: { playerId; cardIds; privateTo? }`
  (types/index.ts:3303) — populated by both `reveal_hand` (public) and
  `look_at_hand` (private peek). Overwritten by the next reveal. Shared
  pipeline at `reducer.ts:~2720`; only `privateTo` stamp differs. Set
  by `look_at_hand` to the controlling player (set12.test.ts:745-783
  covers this).
- `GameState.lastRevealedCards?: { instanceIds; sourceInstanceId; playerId;
  sequenceId }` — for search / look-at-top-N reveals. `sequenceId`
  increments per reveal event so back-to-back reveals of the same cards
  distinguish. Persists across non-reveal actions ("NOT cleared by actions
  with no reveals" per reducer comments).
- `GameEvent` emits `hand_revealed` and `card_revealed` with matching
  `privateTo` flags (types/index.ts:3674).

**Engine already has the privacy primitive (`privateTo`) in place.** What it
lacks is a state-filtering layer — the bot reads the raw `GameState`.

**Bot currently has full oracle access:**
- Greedy / heuristic policies in `packages/simulator/src/` read the
  unfiltered `GameState` directly. No filtering between engine and bot.
- RL policies (Actor-Critic + GAE, see `docs/RL.md`) — state encoder
  consumes unfiltered `GameState`. Means the policy can learn to exploit
  opponent's hand contents even when IRL it would not have been revealed.
  Likely already baked into trained weights.
- Server-side `stateFilter.ts` (server/src/services/stateFilter.ts — OUT
  OF packages/, lives in separate server tree) is the anti-cheat filter
  for the network boundary. Bot path bypasses it entirely.

**Reveals are therefore not "special" to bots:** the bot sees opponent's
hand whether or not a reveal just fired, because it sees everything. The
`privateTo` flag is only honored by the UI layer right now (per reducer
comment at 2720: "only privateTo flag stamped on the event + snapshot").

### Scope question (answer this first)

**Should bots be oracles or humans?**

- **Oracle bots (status quo):** fine for headless analytics. Both sides
  cheat symmetrically; relative deck win-rates stay valid even if absolute
  numbers are off. Cheapest and preserves all existing RL weights.
- **Human-like bots:** required if we want the sandbox/clone-trainer to
  feel like real play, and for MP bot opponents to not telegraph that
  they "know" hidden info. Much bigger lift: observation filter + memory
  model + retrain all policies.

**Possible hybrid (recommended):** keep analytics bots as oracles; build
a separate `ObservedBot` variant for sandbox / clone-trainer / MP that
wraps a policy with the observation filter + memory buffer. Both run on
the same engine — only the adapter differs. Doesn't invalidate existing
training for analytics use. New training runs for MP/sandbox bots.

### Implementation sketch (if we go with observation filtering)

**Engine side (new primitive, ~half a day):**
- Function `buildObservation(state: GameState, viewerId: PlayerID):
  Observation` in `engine/src/engine/observation.ts`.
- Strips opponent's hand-instance definitions (keep counts, lose IDs)
  UNLESS the instance is in `lastRevealedHand.cardIds` with `privateTo
  == null || privateTo === viewerId`.
- Strips opponent's deck-order UNLESS `lastRevealedCards` from viewer's
  POV exposes specific top-N instances.
- Keeps all public-zone info (play, discard, inkwell face-down counts,
  inkwell face-up colors if CRD permits — check 8.x).
- Returns an `Observation` with the same shape as `GameState` but with
  hidden instances replaced by `{ definitionId: "__HIDDEN__", zone,
  ownerId }` markers so bot encoders can handle them without restructure.

**Bot side (harder — policy-specific memory, 1-2 weeks):**
- Bot wraps Observation with a `KnownFacts` buffer maintained across the
  episode: "instance X was in opponent hand at turn N; still there
  unless I saw a discard / play / banish event for it." This is the
  memory model and it's the hard part.
- State encoder consumes `{ observation, knownFacts }` instead of raw
  `GameState`. All downstream encoders (`featureExtractor.ts` or
  wherever) need to handle `__HIDDEN__` sentinels gracefully.
- Retrain: every existing policies/*.json is trained on oracle state.
  None will generalize to observation input. This is the biggest cost.

**Alternative: perfect-memory-with-observation:** skip the `KnownFacts`
layer, have the observation always reflect "currently known" (persistent
reveal memory maintained by engine itself). Simpler for bots but changes
engine semantics — revelations would no longer be transient. Probably
not worth it; the transient model matches CRD semantics and the UI work
just shipped (turn-anchored pills).

### Specific pointers for the agents

**Engine agent: look at these files first**
- `packages/engine/src/types/index.ts:3303` (LastRevealedHand type)
- `packages/engine/src/types/index.ts:3674` (hand_revealed event)
- `packages/engine/src/engine/reducer.ts:~2720` (shared reveal pipeline —
  this is where an observation emission hook would live)
- CRD §8 (zones) and §7 (game state) for what's public vs private per
  rule. Inkwell face-down count is public; face-up colors may be
  public (confirm).

**Bot-trainer agent: look at these first**
- `docs/RL.md` — training architecture, reward design
- `packages/simulator/src/` — Actor-Critic, state encoder
- `policies/*.json` — any observation-model change invalidates these
- `MEMORY.md` note "RL reward weight architecture" — current weight
  approach treats decks as avg of 60 cards; orthogonal to the oracle-vs-
  human question but worth reviewing.

### Questions to resolve (in order)

1. **Oracle bots for analytics forever?** If yes, we're done. No engine
   or bot work needed. This doc stays as context.
2. **If we want human-like bots somewhere:** only in
   sandbox/clone-trainer, or also in the primary analytics runs? Affects
   whether existing policies need retraining or if new ones run alongside.
3. **Observation filter first, memory model later?** The filter is a
   clean engine PR. The memory model is a bot-side training project.
   Filter alone gives us "bot is blind outside reveals" which is more
   realistic than oracle. Memory makes it actually smart.
4. **Who owns `ObservedBot`?** Engine-expert for the filter + types;
   bot-trainer for the wrapper + memory + retraining. Hand off at the
   `buildObservation` signature.

**Current blockers:** none. This is a scope/direction decision, not a
bug. Document the decision in `DECISIONS.md` once made — either
"oracle bots are the design" or "observation filter landing in phase X."

### UI context (for completeness)

Sandbox reveal UI was just upgraded (2026-04-21) to match the "no note-
taking IRL" expectation: reveal modals auto-collapse to a bottom-right
pill on close, and both modal + pill clear when `gameState.turnNumber`
advances past the reveal's anchor turn. This is purely client-side; it
doesn't touch engine state. Same `lastRevealedHand` / `lastRevealedCards`
contract. If observation filtering lands, the UI will need a minor pass
to consume `Observation` instead of `GameState` for the "opponent's hand"
panels — trivial compared to the engine/bot work.

---

## Engine agent: 3 dead-primitive bugs surfaced by `pnpm audit-dead-primitives` — DONE 2026-04-21

**All three shipped.** Audit now prints
`✓ All 39 StaticEffect modifier fields have at least one reader.`

Retained below for reasoning context on how each fix was diagnosed — the
pattern (case handler populates a modifier field but no consumer reads it)
will recur and the diagnostic playbook is worth preserving.

### 1. Flotsam - Ursula's "Baby" — DONE

- Fix: `reducer.ts:queueTrigger` (~line 5786) — the self-trigger scan now
  concats `modifiers.grantedTriggeredAbilities.get(sourceInstanceId) ?? []`
  onto `def.abilities` before filtering. Cross-card scan + `queueTriggersByEvent`
  NOT extended — no current card needs granted abilities to fire via those
  paths, so the change stays scoped to where today's only user (Flotsam
  granting `banished_in_challenge` to Jetsam) lives.
- 2 regression tests in `set4.test.ts` (grant path fires, negative control).

Diagnostic trace (preserved for future similar bugs):
- **Populator**: `gameModifiers.ts:1093-1095` — `modifiers.grantedTriggeredAbilities.set(candidate.instanceId, [...])`
- **Expected reader**: the trigger scanner (docs comment at `types/index.ts:1768`
  literally said "The trigger scanner checks grantedTriggeredAbilities in
  addition to the card's own definition abilities") — none existed. Comment
  was aspirational, not descriptive.

### 2. Captain Amelia - Commander of the Legacy — DONE

- Fix: `reducer.ts` challenge damage step (~line 1255, CRD 8.8.1 resist
  calculation) — defender's `staticGrants` parameter to `getKeywordValue`
  now merges `modifiers.grantedKeywords.get(defenderId)` with
  `modifiers.grantKeywordWhileBeingChallenged.get(defenderId)`. The
  "while being challenged" grants are intentionally kept in a separate Map
  (not baked into `grantedKeywords`) so they ONLY apply during the
  challenge resolution — outside the challenge context, the defender
  doesn't have the keyword. The merged array is scoped to this one
  `getKeywordValue` call.
- 3 regression tests in `set5-set8.test.ts` (challenge damage reduced by
  Resist +1, negative control, grant scope narrow).

Diagnostic trace:
- **Populator**: `gameModifiers.ts:1140-1142`
- **Expected reader**: the challenge resolver's keyword lookup for the
  defender — `getKeywordValue(defNow, defenderDef, "resist", modifiers.grantedKeywords.get(defenderInstanceId))`
  only passed the permanent-grants Map, never the while-being-challenged Map.

### 3. Vision Slab — DONE

- Fix: both `remove_damage` case handlers in `reducer.ts` (`applyEffect` at
  line 2834 and `applyEffectToTarget` at line 7074). Each short-circuits
  with `lastEffectResult = 0` when `getGameModifiers(state, definitions).preventDamageRemoval`
  is true, before the pendingChoice or damage mutation. Guarding BOTH
  dispatch sites is belt-and-suspenders: the `chosen` target path queues a
  pendingChoice first, and in theory Vision Slab could enter between prompt
  and accept (in practice statics are computed on-demand so both paths see
  the same state, but the guard costs nothing).
- 2 regression tests in `set4.test.ts` (remove_damage no-op, negative control).

Diagnostic trace:
- **Populator**: `gameModifiers.ts:1110` — `modifiers.preventDamageRemoval = true;`
- **Expected reader**: `case "remove_damage":` in `applyEffect` — never
  checked the flag, so the effect removed damage unconditionally.

### Meta: why the audit catches this class

All four pre-existing audits (`card-status`, `audit-cards`,
`audit-approximations`, `decompile-cards`) are TEXT-SHAPE checks — they
validate JSON field names and oracle-text similarity. None follow runtime
data flow. A primitive can have the correct emit-side case handler, correct
JSON, correct oracle text, and still silently no-op because no consumer
reads the runtime state it populates.

`pnpm audit-dead-primitives` fills that gap: emit-vs-read reachability
analysis via textual grep. Hidden Inkcaster + these 3 were sitting in
production across 4+ sets undetected. First run of the audit flagged 19
false positives (reader regex too narrow), then widening to cover scoped
aliases (`drawModifiers`, `epeMods`, `inkMods`, `discardMods`) and optional
chaining dropped it to 3 genuine bugs — each a real runtime no-op.

Next-similar-bug procedure: run `pnpm audit-dead-primitives`. For each
flagged field, grep `gameModifiers.ts` to find the case handler, then walk
upward to identify which card(s) use the discriminator, then search
`reducer.ts` / `validator.ts` / `utils/` for where that behavior SHOULD be
consumed but isn't.

---

## Engine agent: Hidden Inkcaster — `all_hand_inkable` (DONE 2026-04-21)

**DONE — commit TBD.** Fix shipped: `validator.ts:validatePlayInk` now
consults `modifiers.allHandInkable.has(playerId)` alongside `def.inkable`.
5 regression tests added to `set4.test.ts` (validator path, legal-actions
path, negative control, once-per-turn still enforced, only-owner-affected).
Audit improvement shipped: new `pnpm audit-dead-primitives` script (see
entry above for the 3 other dead primitives it surfaced).

Retained below for reasoning context on how the fix was diagnosed.

**Dead-code primitive. Found 2026-04-21 during sandbox play — user dropped
Hidden Inkcaster into play, then tried to ink an uninkable card from hand,
and the UI offered no Ink action. Classic "handler existence is not
correctness" — case label exists but no reader.**

### Trace (verified in code)

1. **Card JSON** (`card-set-4.json` + `card-set-P1.json`): Hidden Inkcaster
   has `{ type: "static", effect: { type: "all_hand_inkable" } }` plus a
   passthrough `_source: "ravensburger"`. Correct.
2. **Modifier emit** (`gameModifiers.ts:1102`): case handler runs when
   Hidden Inkcaster is in play — adds `instance.ownerId` to
   `modifiers.allHandInkable: Set<PlayerID>`. Correct.
3. **Validator** (`validator.ts:473`): `validateInkCard` checks
   `if (!def.inkable) return fail("This card cannot be used as ink.")`
   — **never consults `modifiers.allHandInkable`.** This is the bug.
4. **Legal-action enumeration** (`reducer.ts:271`): `getAllLegalActions`
   defers to `validateAction` for each hand card. So both paths
   (validator rejection + legal-action omission) share the same bug.
   UI shows no Ink button, no inkwell drop target — card appears
   unplayable to inkwell while Hidden Inkcaster sits in play.

### Fix (~1 line at validator.ts:473)

```typescript
// Before:
if (!def.inkable) return fail("This card cannot be used as ink.");
// After:
if (!def.inkable && !modifiers.allHandInkable.has(playerId)) {
  return fail("This card cannot be used as ink.");
}
```

`modifiers` is already in scope — used at line 465 for Moana's
`inkFromDiscard` (same shape of "control-changing predicate").

### Tests to add (pair validateX + legal-actions per CLAUDE.md rule)

In `set4.test.ts` (or a new `set4.test.ts` describe block for Hidden
Inkcaster):

1. **Validator path:** inject Hidden Inkcaster into play, inject an
   uninkable card into hand → `validateAction({type:"PLAY_INK", ...})`
   returns `{valid: true}`.
2. **Legal-actions path:** same scenario → `getAllLegalActions(state)`
   includes a `PLAY_INK` for the uninkable card.
3. **Negative control:** remove Hidden Inkcaster from play → same two
   assertions flip to rejection.
4. **Once-per-turn still enforced:** Hidden Inkcaster doesn't grant
   extra inks, only makes more cards eligible. After inking one card
   this turn, no further PLAY_INK actions should be legal (existing
   CRD 4.2 behavior — belt-and-suspenders check).
5. **Only affects owner's hand:** put Hidden Inkcaster in p1's play,
   but check that p2's uninkable hand cards remain un-inkable (the
   static targets the owner of the item, not all players).

### Audit improvement

No audit script catches this — `pnpm card-status` checks discriminators
exist in the union, `pnpm decompile-cards` would render the oracle text
correctly from the JSON, `pnpm audit-approximations` / `pnpm audit-cards`
are unrelated. All four audits are text-shape checks; they miss
runtime-handler bugs like this.

**Proposal:** add a new audit script (or extend `pnpm catalog`) to flag
"emit-but-never-read" primitives. For each `StaticEffect` / `Modifier`
variant:
1. Check that gameModifiers.ts has a `case "<type>":` branch populating
   something (existing behavior).
2. Check that at least one CONSUMER elsewhere in `packages/engine/src/`
   reads the field it populates (new check).

That would catch the Hidden Inkcaster class of bug: modifier emitted,
Set populated, no reader. Not urgent; doing this as a follow-up audit
after fixing Hidden Inkcaster + whatever else the audit surfaces when
first run would be the pattern.

Matches the CLAUDE.md rule: "Every engine bug fix ships a regression
test AND an audit improvement — turns one-off fixes into class-wide
sweeps."

### Other cards using `all_hand_inkable`

Only Hidden Inkcaster (set 4 + P1 reprint per `_source: "ravensburger"`
promo mirror). No other current cards. So the fix is narrow-blast-radius
but the audit improvement would surface any similar dead-code primitives
that currently exist silently.

### Blast radius

Sandbox + solo + MP all affected identically (engine-layer bug, applies
wherever the validator runs). No UI-side workaround — UI correctly
renders only legal actions, and legal actions are rejected. This is
engine-pure.

**Urgency:** medium. Hidden Inkcaster is a popular deck-thinning / draw
engine card in emerald builds; playing without it working limits deck
viability testing. Not release-blocking but worth fixing before the
next analytics batch run.

---

## GUI agent: Replay → GIF clip export (R2 migration UNBLOCKED 2026-04-21)

**Priority: #1 creator tool per `project_near_term_priorities.md` (ranked
above shareable URLs, annotations, scripted opponent). Strategy per
`project_strategic_direction.md`: "Sandbox is the creator product" —
clip export is load-bearing for the content-creation acquisition wedge.
Viral-surface-area rationale: GIFs embed natively on Discord/Twitter/
Reddit/forums, a creator shares a cool play in 30 seconds with no video
workflow.**

### Dependency (blocking)

Canvas capture of the game board will taint because card images load from
`api.lorcana.ravensburger.com` without `Access-Control-Allow-Origin`
headers. `html-to-image` / `html2canvas` / raw `ctx.drawImage` + `toBlob`
all fail or throw `SecurityError` once a tainted image is on the canvas.

**UNBLOCKED as of 2026-04-21** — R2 migration complete in commit
`7d37d23`. All 2808 cards have R2-hosted `imageUrl`s with CORS headers
that permit canvas capture. See "GUI/UI follow-up: R2 image migration
DONE" entry below for details.

One caveat: the R2 bucket currently uses Cloudflare's default public
domain (`pub-5d52a089800f49be846aa55b2833c558.r2.dev`), which has a
request rate cap around 20 req/s before triggering 429s. For clip
export specifically — a single GIF renders ~30 frames × ~30 cards
visible per frame — bursts of ~900 image fetches. Will likely trip
the rate limit mid-render. Three mitigations (pick one):

1. Pre-cache all visible images at clip start (sequential fetch with
   small sleep) before handing frames to the encoder.
2. Provision a custom R2 domain (`cards.yourdomain.com`) which has no
   rate cap.
3. Set `<img crossorigin="anonymous">` + rely on browser's HTTP cache
   — should help after the first clip but still rough on clip #1.

Recommend (1) for speed-to-ship; flag (2) as a follow-up for the user.

### Scope (GUI agent owns this post-unblock)

Replay + ReplayControls are already mine per the session intro. This is
an additive feature on top of the existing replay infra. Est. 1-2
sessions once unblocked.

**Step 1: step-range picker UX**
- Extend `ReplayControls.tsx` with a "Clip" mode toggle. When active,
  the scrubber shows two handles (start / end) instead of one, plus an
  existing-frame preview.
- Default range: current step ± 5 (≈ 1-2 turns). User drags handles.
- Show estimated output size + duration ("6s, ~3MB GIF @ 12fps"). Users
  will hit Discord's 8MB free / 25MB Nitro limit often — surface size
  live so they can clip shorter rather than discovering post-export.

**Step 2: capture pipeline**
- `ReplayControls` reuses `useReplaySession.states[i]` to render each
  frame in a hidden mount (off-DOM or `position: absolute; top: -9999px`).
  Avoid flashing the live board between frames.
- Library choice: **`html-to-image`** (20KB gzipped, MIT, good React
  support) for DOM → canvas per frame, then **`gifenc`** (10KB, faster
  + smaller output than `gif.js`, supports quantization tuning) for
  encoding. If motion quality is poor, fall back to `gif.js` which has
  better temporal dithering at the cost of larger files.
- Capture at board-native resolution; downscale on encode if size is
  a concern. User can pick: "Fit Discord (800×600, 12fps)", "Twitter
  GIF (500×500, 10fps)", "HD (1280×720, 15fps)". Three presets, no
  fine-grain picker.

**Step 3: output + UX**
- Worker-based encode so the UI doesn't freeze on long clips (>20s).
  `gifenc` has a built-in worker helper.
- Progress bar (frame N / total + encode %). Cancellable.
- Download as `lorcana-clip-{playerName}-turn{N}-step{M}.gif` — filename
  encodes context so creators don't end up with 30 files all named
  `download.gif`.
- Optional: copy-to-clipboard button (`ClipboardItem` with `image/gif`
  — supported in Chromium/Firefox/Safari 14+, falls back to download).

**Step 4: polish (can defer)**
- Watermark / logo corner (toggle, default on for brand awareness in
  shared clips). Small wordmark in a corner at 60% opacity.
- "Clip this moment" shortcut — single-button, captures ±3 seconds
  from the current scrubber position. Low-friction "something just
  happened" flow.

### What the replay infra already gives us

- `useReplaySession` reconstructs full `GameState` at every step
  deterministically from `{seed, p1Deck, p2Deck, actions[]}`.
- `ReplayControls` has the scrubber + play/pause + speed + Take-Over
  UX scaffolding — the Clip mode slots in alongside.
- The state cache (`states: GameState[]`) is eagerly computed during
  render, so frame-by-frame iteration is O(1) per frame (no
  reducer replay per capture).

So the work is pure DOM-to-canvas-to-GIF plumbing + picker UX. Not a
simulation / engine change.

### Don't start until

1. ~~R2 migration `_imageSource` coverage ≥95% (engine-expert's ticket).~~
   **DONE 2026-04-21** — 2808/2808 migrated in commit `7d37d23`.
2. Confirm with user the strategy still prioritizes creator tools at
   the top — the priority memory is from 2026-04-16 and flagged
   potentially stale.
3. Consider shipping **annotations / callout overlay** or **shareable
   sandbox URLs** in parallel while waiting on R2 — both are GUI-scope
   and unblocked today. They're lower-priority per the strategy doc
   but keep creator-tool velocity visible.

### Related orphans (verified 2026-04-21)

- **"Branch analysis button" mentioned in `project_near_term_priorities.md`
  as orphaned in ReplayControls.tsx**: NO LONGER PRESENT. Verified during
  this scoping session — ReplayControls is clean (scrubber, step buttons,
  speed toggle, Take Over fork). The memory note has aged out. Don't file
  a cleanup task — already clean.

---

## Engine agent: track source storyName on `grantedActivatedAbilities` entries

**Small, scoped type change. Unblocks a GUI label-polish fix that's
user-reported. Raised 2026-04-21 after diagnosing an unrelated "buttons
disappearing" question on Dumbo + Iago (turned out to be ink-cost
affordability, not a bug) — BUT the label confusion remains: granted
activated abilities render as the generic "Activate" in the popover
because the UI can't resolve the source static ability's storyName.**

### Problem

When Dumbo - Ninth Wonder of the Universe's **MAKING HISTORY** static
ability grants a "{E}, 1 {I} — draw + lore" activated to Iago (and any
other friendly evasive character), the engine correctly enumerates an
`ACTIVATE_ABILITY` action on Iago with `abilityIndex = def.abilities.length + j`
— a virtual index past the card's own abilities array.

The UI (`GameBoard.tsx:917-919`) tries to label the button via
`def.abilities[abilityIndex]?.storyName`. For granted abilities that
index is out of bounds → fallback to the literal string "Activate".

Dumbo shows "BREAKING RECORDS" (his native activated), Iago shows
"Activate" (granted). The granted ability on Iago SHOULD show
"MAKING HISTORY" — the source static ability's storyName — so:
- Players can see WHICH card's effect is giving them this button
- When the source card leaves play and the button disappears, the label
  matched the source → cause-effect is readable
- Avoids labeling two functionally-identical buttons with two different
  names when oracle-wise they come from different abilities

### Why engine-side

The UI could replicate the filter-matching logic to look up which
`grant_activated_ability` in play targets Iago and grab its source
storyName, but that duplicates engine predicate logic and drifts if
filter semantics change. Clean approach: track source info at the
grant site, surface it on the map entry the UI already consumes.

### Proposed type change

File: `packages/engine/src/engine/gameModifiers.ts` line 152

```typescript
// Before:
grantedActivatedAbilities: Map<string, import("../types/index.js").ActivatedAbility[]>;

// After:
grantedActivatedAbilities: Map<string, GrantedActivatedAbility[]>;

interface GrantedActivatedAbility {
  ability: ActivatedAbility;
  /**
   * storyName of the source static ability that produced this grant
   * (e.g. "MAKING HISTORY" for Dumbo's grant-to-evasives). Undefined
   * for grants from static effects without a storyName on the outer
   * ability. UI uses this for button labels so the recipient shows
   * WHO is granting.
   */
  sourceStoryName?: string;
  /**
   * Instance ID of the card whose static ability produced this grant.
   * Useful for UI "leaves play → grant removed" animations and for
   * future tooling (hover a granted-ability button → highlight source
   * card). Undefined for turn-scoped grants from action cards.
   */
  sourceInstanceId?: string;
}
```

Same shape change needed on
`PlayerState.timedGrantedActivatedAbilities` (types/index.ts:3194):

```typescript
// Before:
timedGrantedActivatedAbilities?: { filter: CardFilter; ability: ActivatedAbility }[];

// After:
timedGrantedActivatedAbilities?: {
  filter: CardFilter;
  ability: ActivatedAbility;
  sourceStoryName?: string;
  sourceInstanceId?: string;
}[];
```

### Writers to update (3 sites)

1. **`gameModifiers.ts:1184-1187`** — static-effect writer (Making
   History, Cogsworth, etc.). The outer static ability being iterated
   already has `storyName` accessible in scope; attach it:
   ```typescript
   existing.push({
     ability: effect.ability,
     sourceStoryName: staticAbility.storyName,  // outer static ability's name
     sourceInstanceId: instance.instanceId,      // Dumbo's instance
   });
   ```

2. **`gameModifiers.ts:1211-1213`** — timed grant writer (merges
   per-player timed grants into the map). Each entry in the
   `timedGrantedActivatedAbilities[]` already has the source info from
   the writer at reducer.ts:4442 (after this change); forward it:
   ```typescript
   existing.push({
     ability: grant.ability,
     ...(grant.sourceStoryName && { sourceStoryName: grant.sourceStoryName }),
     ...(grant.sourceInstanceId && { sourceInstanceId: grant.sourceInstanceId }),
   });
   ```

3. **`reducer.ts:4435-4442`** — the `grant_activated_ability_timed`
   handler that writes into `state.players[p].timedGrantedActivatedAbilities`.
   Populate source info at the grant site — the action is being played
   from hand so we have its source + storyName in scope:
   ```typescript
   timedGrantedActivatedAbilities: [...existing, {
     filter: effect.filter,
     ability: effect.ability,
     sourceStoryName: sourceAbility?.storyName,
     sourceInstanceId: sourceInstanceId,
   }],
   ```

### Readers to update (2 sites) — both just access `.ability`

1. **`reducer.ts:433`** — legal-action enumeration. Loop variable is
   now `GrantedActivatedAbility` shape; the enumeration itself doesn't
   need the ability body, just the count, so this site is minimally
   affected.

2. **`reducer.ts:1539`** — ACTIVATE_ABILITY applier:
   ```typescript
   // Before: ability = grantedAbilities?.[grantedIndex];
   // After:  ability = grantedAbilities?.[grantedIndex]?.ability;
   ```

### Validator impact

Grep for `grantedActivatedAbilities` in `validator.ts` and patch any
site the same way (single-level unwrap). From the GUI-side scan I did
the validator doesn't appear to access this map directly (delegates to
enumeration), but double-check.

### Test coverage

No existing tests exercise source-tracking because it's new info. Add
to the set9 test file (or a new Dumbo-focused describe block):

```typescript
it("Making History records the source storyName on granted evasive recipients", () => {
  // inject Dumbo + Iago-Spectral-Parrot (both evasive, both in play)
  // const modifiers = getGameModifiers(state, definitions);
  // const granted = modifiers.grantedActivatedAbilities.get(iagoId);
  // expect(granted).toHaveLength(1);
  // expect(granted[0].sourceStoryName).toBe("MAKING HISTORY");
  // expect(granted[0].sourceInstanceId).toBe(dumboId);
});

it("Food Fight! timed grant records the action's storyName", () => {
  // play Food Fight!, same assertion against a timed entry on friendly characters
});

it("grants flow through `.ability` at ACTIVATE_ABILITY dispatch", () => {
  // regression: activating a granted ability still resolves via the
  // new .ability field — covers the reducer.ts:1539 unwrap
});
```

### UI follow-up (self, GUI agent)

Once the map value shape is `GrantedActivatedAbility[]`, the fix at
`GameBoard.tsx:917-919` is trivial:

```typescript
if (action.abilityIndex >= def.abilities.length) {
  const grantedIndex = action.abilityIndex - def.abilities.length;
  const granted = gameModifiers.grantedActivatedAbilities.get(action.instanceId)?.[grantedIndex];
  abilityName = granted?.sourceStoryName ?? "Activate";
} else {
  abilityName = (def.abilities[action.abilityIndex] as { storyName?: string }).storyName ?? "Activate";
}
```

I'll handle this in a follow-up UI session once the engine change lands.

### Urgency

Low. Cosmetic label polish — no incorrect game behavior. But it's
user-visible confusion, and the type change is small and self-contained
(~20 lines across 3 writers + 2 readers + the type definitions). Good
"next session" pickup for engine-expert.

### Blast radius

All cards with `grant_activated_ability` + `grant_activated_ability_timed`:
Dumbo (set 9), Cogsworth-Talking-Clock, plus grants from sets 2/6/7/9/10/11/P3/C2
(grep surfaced ~10 card hits across JSON). UI label becomes accurate on
every single one — same one-line fix applies everywhere.

Cards with `grant_activated_ability_timed` (turn-scoped): Food Fight!,
Donald Duck Coin Collector, Walk the Plank! — these need source tracking
at the action-resolution site (reducer.ts:4442). UI labels on those get
the source card's name which is accurate — the grant is from playing
that action, and the ability expires at turn end.

---

## Engine agent: Lorcast importer stub extraction only captures first line

Discovered while adding compiler patterns in commit `7eaac30`. The Lorcast
importer at `scripts/import-cards-lorcast.ts` populates
`CardDefinition._namedAbilityStubs` from the Lorcast API's `text` field —
but for multi-line abilities, only the first line (the banner + preamble)
lands in the stub's `rulesText`; subsequent lines (bullet lists, clause
continuations) are lost.

Concrete case: Jack-jack Parr — Incredible Potential (set 12 #121) has:
```
WEIRD THINGS ARE HAPPENING At the start of your turn, you may put the
top card of your deck into your discard.
If its card type is:
• character, this character gets +2 {S} this turn.
• action or item, this character gets +2 {L} this turn.
• location, banish chosen character.
```
Stub's `rulesText` only contains the first sentence. The reverse compiler
(`scripts/compile-cards.ts`) receives just the preamble and can only match
the "you may put top card into discard" pattern — misses the 3-way switch
despite a dedicated matcher existing for the full oracle.

Impact: compiler auto-wire misses multi-line abilities until the stub
extraction is fixed. The card wiring itself was unaffected (manually wired
against the full oracle). This is a compiler-coverage limitation, not a
runtime bug.

Fix location: `scripts/import-cards-lorcast.ts` — the regex that extracts
named abilities stops at a newline. Should consume lines until the next
story-name banner (all-caps line at start) or end of text.

Non-urgent: affects auto-wiring coverage for future multi-line Lorcast
pre-release cards. Manual wiring still works.

---

## Engine agent: possible follow-up — expand resolveTargetAndApply coverage

The 2026-04-21 zone-move helper consolidation landed — `resolveTargetAndApply`
at `reducer.ts:~6620` now serves as the shared target-dispatch for `banish`,
`return_to_hand`, `put_into_inkwell` (chosen/all), and
`put_card_on_bottom_of_deck` (from:"play"). Future candidates for migration,
deferred for a follow-up session:

- **`shuffle_into_deck`** — target-dispatch shape matches, but needs a post-
  iteration shuffle step. Could extend `ResolveTargetAndApplyOptions` with a
  `postIterationHook?: (state, events) => state`. Worth doing when a third
  similar case appears so the hook isn't over-engineered for one user.
- **`discard_from_hand`** — has `chooser: "random" | "target_player"` modes
  and `amount: "all" | "any" | number` polymorphism that the helper's 4
  target-type branches don't cover cleanly. Likely best left bespoke.
- **`move_damage`** — two targets (source + destination instance) rather
  than one. Wouldn't fit the helper without a second target parameter.

None blocking. The helper already covers ~100 LOC of the hottest duplication.

## Engine agent: deferred / low-priority queue (verified against code 2026-04-21)

Items NOT currently blocking anything, kept here so they don't need to live in
an agent's memory. Each entry confirmed by reading the code, not from memory.

**Previously here, now DONE (retained for reasoning context):**
- ~~Wire 17 set-12 stubs~~ — all 17 cleared via commits `5cbaef7` → `6b831a1`
  and `71ddffa`. Set 12 now 134/134 implemented, 0 stubs.
- ~~Reverse compiler — oracle text → JSON wiring~~ — scaffold exists at
  ~31.8% coverage; see "Engine agent: expand reverse compiler coverage + add
  apply flow" section below for remaining work.

**1. CRD 1.8.4 strict simultaneity** (low impact — no current card)
- `runGameStateCheck` (reducer.ts:7870) has an explicit `while (changed)` loop
  implementing 1.8.3 cascading. Banishes within a single pass happen in
  object-iteration order, not truly parallel. Matches 2P behavior correctly;
  would matter only if a 3+P variant ships OR if a "leaves play together"
  trigger (CRD 7.4.3) becomes sensitive to banish ordering within a pass.
- Rest of CRD 1.8 is fully implemented (1.8.1.1, 1.8.1.2, 1.8.1.4, 1.8.2, 1.8.3
  all ✅ — verified in code).

**2. CRD 6.5 remaining edge cases** (low impact — no current card)
- 6.5.4: "Replaced events don't fire triggers" — currently `damage_redirect`
  and `damage_prevention_static` still fire damage-dealt/taken triggers on the
  redirected path. Works for every current card because no trigger conflicts.
- 6.5.7: "Multi-replacement ordering" — no current card pair has two
  replacements competing on the same event.
- 6.5.8: "Same replacement can't apply twice" — same applicability condition
  as 6.5.7. `damage_prevention_static` with `chargesPerTurn:1` (Lilo) enforces
  once-per-turn via its own counter, not via this general rule.
- Rest of CRD 6.5 is wired: `damage_redirect` (Beast), `damage_prevention_static`
  (Baloo/Hercules/Lilo), `challenge_damage_prevention` (Raya), `self_replacement`
  (48 cards across sets 1-12 — handles the "if X, do Y instead" family).

**3. GameEvent system — piped to UI, but few downstream consumers**
- `lastEvents` is populated by the reducer for every state mutation. Currently
  only `card_revealed` is consumed (CardPicker reveal animations). Richer log,
  event-driven animations, sound hooks — all deferred until there's a user-
  facing need. Not blocking.

**Currently blocked on external action:** — none as of 2026-04-21.

~~**R2 image self-hosting migration**~~ — DONE in commit `7d37d23`. 2808/2808
cards migrated. See "GUI/UI follow-up: R2 image migration DONE 2026-04-21"
entry for details + re-run semantics. Only UI-side size-swap bugs remain,
handed off to ui/gameboard specialists.

---

## GUI agent: build `/dev/add-card` form + null-image placeholder

Backend is ready; UI is the remaining half. Use case: user wants to hand-enter
pre-release cards before Ravensburger or Lorcast publishes them, then re-imports
later automatically upgrade the entry via the `_source` hierarchy (ravensburger >
lorcast > manual).

**Scope for this agent (UI only, no engine/card-JSON edits):**

1. **New dev route** `/dev/add-card` in `packages/ui/src/App.tsx` (follow the
   existing dev-route pattern at lines 301-307 — URL-only, no tab nav).
2. **React form** with fields matching the POST body schema (see API contract
   below). Client-side validation should mirror server-side. Live card preview
   next to the form as the user types.
3. **Card image placeholder** — update `packages/ui/src/components/CardTile.tsx`
   and `packages/ui/src/components/CardInspectModal.tsx` to render a nicer
   placeholder when `def.imageUrl` is falsy (currently empty div/text). Ideally
   show: card frame, name, cost, ink color, rarity — enough to identify the
   card while waiting for the real image.

**API contract (already live, test from UI with `fetch`):**

- `GET /api/dev/list-sets` → `{ sets: string[] }` — list of existing setIds.
- `POST /api/dev/add-card` with JSON body:
  ```ts
  {
    card: {
      name: string;                    // required
      subtitle?: string;
      cardType: "character"|"action"|"item"|"location";  // required
      inkColors: ("amber"|"amethyst"|"emerald"|"ruby"|"sapphire"|"steel")[]; // required, non-empty
      cost: number;                    // required, >= 0
      inkable: boolean;                // required
      traits?: string[];
      strength?: number;               // required for characters
      willpower?: number;              // required for characters
      lore?: number;                   // required for characters
      shiftCost?: number;
      moveCost?: number;
      rulesText?: string;
      flavorText?: string;
      setId: string;                   // required (e.g. "12", "P1", "DIS")
      number: number;                  // required, >= 0
      rarity: "common"|"uncommon"|"rare"|"super_rare"|"legendary"|"enchanted"|"special"|"iconic"|"epic";
      imageUrl?: string;               // optional — leave empty for placeholder
      abilities?: [];                  // leave empty, wired manually in JSON
    },
    overwrite?: boolean  // set true to replace an existing card at same (setId,number) or id
  }
  ```
  Response codes:
  - `200 { ok: true, path, card }` — written successfully
  - `400 { error: "validation failed", details: string[] }` — field errors
  - `409 { error: "collision" | "source-locked" | "would-downgrade", existing }`
    — collision (requires overwrite flag) or higher-tier entry can't be replaced

**Reference patterns in the repo:**
- `packages/ui/src/components/SandboxPanel.tsx:40-100` — existing card-injector
  form pattern (in-memory only, doesn't POST). Useful reference for search +
  form UX.
- `packages/ui/src/components/CardTile.tsx:37,54-68` — current imageUrl fallback
- `packages/ui/src/components/CardInspectModal.tsx:86-97` — current placeholder div

**Do not** edit card JSONs, engine types, or the importers — those are done
this session. The middleware at `packages/ui/vite-plugins/dev-card-writer.ts`
handles all card-JSON writes; the UI's only job is to POST valid data.

---

## GUI agent: render `<Keyword>` tokens in rulesText as styled badges

As of 2026-04-20, every card's `rulesText` in the card-set JSONs wraps
keyword names in angle brackets — both line-start (`<Singer> 5 (reminder)`)
and inline (`Your characters gain <Rush>`, `chosen character gains <Evasive>
this turn`). See `scripts/lib/normalize-rules-text.ts` for the full
convention; the wrap is enforced by both importers and the dev card-writer
endpoint so all entry points produce identical output.

Right now `CardTextRender.tsx` and `CardInspectModal.tsx` dump `rulesText`
as plain text, so users see literal `<Rush>` brackets in card inspectors.
Fix: add a small token renderer that splits rulesText on `<Keyword>` matches
and wraps each match in a styled inline span.

**Design intent (from user):**
- **Keep the word visible** — don't replace `<Rush>` with just an icon. The
  word itself must still be there, just styled. Think: the text stays
  readable, the keyword is visually emphasized.
- Ideal styling: keyword icon badge to the left of the word, word in bold
  or in the accent color (e.g. `text-amber-200 font-bold`), no `<` / `>`
  brackets in the rendered output.
- Reminder parens are untouched by the normalizer — keywords that appear
  inside `(...)` are plain text ("Only characters with Evasive can...") and
  render as plain text. Don't parse inside parens.

**Keyword list** (match case-sensitively, multi-word first):
```
Sing Together, Bodyguard, Challenger, Evasive, Reckless, Resist, Rush,
Shift, Singer, Support, Vanish, Ward, Boost, Alert
```

**Minimum viable implementation** (suggested):
```tsx
function renderRulesText(text: string): ReactNode[] {
  // Split on <Keyword> or <Multi Word Keyword>, keeping the matches.
  const parts = text.split(/(<(?:Sing Together|Bodyguard|Challenger|Evasive|Reckless|Resist|Rush|Shift|Singer|Support|Vanish|Ward|Boost|Alert)>)/g);
  return parts.map((part, i) => {
    const match = part.match(/^<(.+)>$/);
    if (match) {
      return <span key={i} className="font-bold text-amber-200 inline-flex items-center gap-0.5">
        <KeywordIcon name={match[1]} />
        {match[1]}
      </span>;
    }
    return part; // plain text segment (may contain \n — preserve with whitespace-pre-line)
  });
}
```

**Files to touch:**
- `packages/ui/src/components/CardTextRender.tsx` (line ~125-129 — where
  actions/items render their rulesText)
- `packages/ui/src/components/CardInspectModal.tsx` (line ~197-201)
- Consider extracting as `RulesTextRender.tsx` for reuse across both.

**Keyword icons** — check `packages/ui/src/components/Icon.tsx` for existing
keyword icons (`<Icon name="rush"/>` etc.). If not all 14 keywords have
icons, either skip the icon for missing ones (text-only badge) or add them
as a follow-up.

**Do not** edit the normalizer or card JSONs. The rulesText shape is fixed;
the UI just needs to parse and render it.

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

## Engine agent: expand reverse compiler coverage + add apply flow

The reverse compiler exists (`scripts/compile-cards.ts`, 3139 LOC) and
currently auto-matches ~31.8% of named ability shapes on sets 1-11 baseline
(commit `7eaac30` brought it from 31.7% → 31.8% with 4 new set-12 pattern
additions). `pnpm compile-cards` runs the baseline; `--apply --set N` is
scaffolded but not yet exercised end-to-end.

What's working:
- Pattern table format: `{ name, pattern: RegExp, build: (match, ctx) => Json }`
- Round-trip validation via decompile: `compile(oracle) → decompile(json) →
  similarity >= 0.85` before auto-wiring
- Most common shapes matched: draw N, gain N lore, deal N damage to chosen,
  enters_play triggers, card_played with costAtMost filter, etc.
- Set-12 matchers added: each_player inkwell-exerted, reveal_top_switch 3-way,
  opponent_partition_3way, grant_triggered_ability_timed (note: this last
  one is stale — the primitive was reverted in commit `71ddffa`; the
  matcher should be retargeted to emit `create_floating_trigger attachTo:
  "all_matching"` instead, matching Forest Duel's shape)

What's missing:
1. **Compiler matcher cleanup** (20 min): retarget the `grant_triggered_
   ability_timed_trait` matcher (if still present) to emit `create_floating_
   trigger` shape per Forest Duel. Or delete entirely — only Hero Work used
   it and that's now manually wired.
2. **playRestrictions-prefix handling** for action cards (30 min): currently
   the compiler's action-path calls `parseEffectChain` on the whole
   rulesText. For cards like Escape Plan with "You can't play this action
   unless X. Each player chooses...", the preamble isn't separable —
   compiler fails to match. Add a two-pass normalization that strips
   leading "You can't play this action unless ..." into a `playRestrictions`
   entry before effect-chain parsing.
3. **Recursive inner-ability compilation** for `grant_triggered_ability_*`
   patterns: currently emits `{ type: "triggered", _inner_oracle: "..." }`
   as a placeholder. Should recursively invoke the compiler's triggered-
   ability grammar on the quoted inner text.
4. **End-to-end apply**: `pnpm compile-cards --set N --apply` should write
   auto-wired abilities back to card JSONs with decompiler-roundtrip
   confidence gate. Currently writes but needs a dry-run diff view + user
   confirmation before committing.

Decompiler renderer coverage is the upstream bottleneck — for a compile to
score ≥0.85 via decompile round-trip, the decompiler must know how to
render the JSON it just emitted. Every renderer gap is a compile false-
negative. `pnpm decompile-cards` with no filter shows the worst-50 tail
which currently has 2 cards < 0.3 and 11 cards < 0.5 — those are the
renderer/wiring bug mixture.

Starter extension plan:
1. Fix items (1) + (2) above — small, self-contained.
2. Re-run `pnpm compile-cards` baseline, aim for 33-35% coverage.
3. Dry-run `--apply` on set 12 (where there are already-wired cards as
   ground truth); measure exact-match rate.
4. When exact-match > 80% on a test set, wire `--apply` into the new-set
   import runbook.

Practical caveats:
- Oracle text drift between sources (curly vs straight apostrophes handled
  by normalizer; `{L}`/`{S}` symbols sometimes dropped by Lorcast).
- Card name normalization ("Daisy Duck" vs "this character" references).
- Precedence: most-specific patterns first. ORDER MATTERS — Jack-jack's
  reveal_top_switch_3way_type must come before the shorter put_top_cards_
  into_discard matcher (already documented in compile-cards.ts).
- Conservative thresholds — better to under-wire (leave for human) than
  silently miswire. Never auto-wire below 0.85 similarity.

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

## GUI/server agents: Core/Infinity format legality — multi-rotation registry (engine side DONE)

Multi-rotation legality registry. Worked through with user 2026-04-21; the
old single-rotation shape couldn't model the pre-release window where BOTH
the current live rotation AND the upcoming rotation need to be offered for
new decks simultaneously.

### Engine work — DONE 2026-04-21 (commit TBD)

`packages/engine/src/formats/legality.ts` has been rewritten to the registry
shape. What shipped:

- `type RotationId = "s11" | "s12"` (s13 intentionally not pre-registered —
  add when Ravensburger locks in the set list)
- `interface RotationEntry { legalSets, banlist, offeredForNewDecks, displayName }`
- `CORE_ROTATIONS: Record<RotationId, RotationEntry>` — s11={5..11}, s12={5..12},
  both `offeredForNewDecks: true`, empty banlists
- `INFINITY_ROTATIONS: Record<RotationId, RotationEntry>` — every rotation
  carries the full set list (main 1-12 + P1/P2/P3/C1/C2/CP/D23/DIS); banlist
  carries `hiram-flaversham-toymaker` in both
- `export type GameFormat = { family: "core" | "infinity"; rotation: RotationId }`
- `isCardLegalInFormat(def, format)` and `isLegalFor(entries, defs, format)`
  take the new shape; `LegalityIssue.message` includes rotation `displayName`
  (e.g. "Dale - Excited Friend — no printing in a Set 11 Core-legal set.")
- `listOfferedRotations(family)` — UI dropdown populates from this
- `resolveRotation()` throws on unknown rotation id rather than silently
  treating every card as illegal — catches typos immediately
- `legality.test.ts` expanded from 14 → 23 tests; covers rotation-specific
  acceptance/rejection, reprint rule across rotations, Infinity banlist
  constancy, unknown-rotation throw, `listOfferedRotations` ordering
- `packages/engine/src/index.ts` re-exports: `CORE_ROTATIONS`,
  `INFINITY_ROTATIONS`, `isCardLegalInFormat`, `isLegalFor`,
  `listOfferedRotations` + types `GameFormat`, `GameFormatFamily`,
  `RotationId`, `RotationEntry`, `LegalityIssue`, `LegalityResult`
- Old exports removed: `CORE_LEGAL_SETS`, `INFINITY_LEGAL_SETS`,
  `CORE_BANLIST`, `INFINITY_BANLIST`. No back-compat shim was shipped because
  the only downstream string-literal user (`MultiplayerLobby.tsx:28`) keeps
  its own local union state; no callers import the removed symbols.

All 571 engine tests pass. Typecheck clean for the new code (pre-existing
`exactOptionalPropertyTypes` errors unrelated).

### Rotation facts (confirmed with user — unchanged from original plan)

Cadence: **every 4 sets, the oldest 4 sets drop**. Between cuts, new sets are
additive to the pool. Locked rotation map:

| Rotation | Legal sets | Size | Status |
|---|---|---|---|
| Set 11 Core | {5,6,7,8,9,10,11} | 7 | pre-Set-12 live format |
| Set 12 Core | {5,6,7,8,9,10,11,12} | 8 | additive, current pre-release preview |
| Set 13 Core | {9,10,11,12,13} | 5 | **rotation cut** — drops sets 5-8 (not yet registered; add when locked) |

Infinity rotations share the rotation naming (`s11`, `s12`, `s13`) but always
include every set — they differ only in banlist progression and in which
Set-N's cards are recognized.

Set 12 itself is fully wired as of 2026-04-21 (0 stubs), so there is no
card-data blocker preventing the `s12` rotation from being used.

### ~~Storage + backfill~~ — DONE 2026-04-21 (server agent)

Landed on `decks` (not `deck_versions` — see "deck-table consolidation" note
at the end of this section for the rationale; history stays on the parent
deck's stamp). Columns added:
- `decks.format_family TEXT NOT NULL DEFAULT 'core'`
- `decks.format_rotation TEXT NOT NULL DEFAULT 's11'`
- `lobbies.game_rotation TEXT NOT NULL DEFAULT 's11'` (paired with existing
  `game_format` family column — together they form the engine's `GameFormat`).

Blanket backfill was free via Postgres's `ADD COLUMN ... DEFAULT` behavior —
every existing row got `{ core, s11 }` without a separate script.

ELO JSONB default updated to the 8 per-rotation keys; a one-shot merge
statement (`elo_ratings = new_defaults || elo_ratings`) folds new keys into
existing profile rows without clobbering. Legacy keys (`bo1_core`, etc.) are
left in place as dead weight; new code writes only to per-rotation keys.
Ratings not migrated from the old 4-key shape — infrastructurally reset, by
design (user confirmed accuracy-later).

### UI work (GUI agent, after engine + storage land)

- **DeckBuilder format dropdown** next to deck name — populated from the
  registry, filtered to `offeredForNewDecks: true` entries. Grouped
  ("Core / Set 12", "Core / Set 11", "Infinity / Set 12", "Infinity / Set 11").
  When Set 12 officially drops, flip `s11.offeredForNewDecks = false` —
  the option disappears from new-deck creation but existing Set 11 decks
  still render with their stamp.
- **CardPicker / CardFilterBar implicit filter** — when the deck's stamped
  rotation is selected, auto-apply `isCardLegalInFormat` as a hidden filter
  so users can't see (and accidentally add) non-legal cards. Not a
  user-toggleable chip; bound to the declared format.
- **Deck tile legality chip** on `DecksPage` — run `isLegalFor()` on load;
  if `!ok`, show a red chip with issue count. Hover/tap reveals the issues
  list.
- **Inline row errors** in `DeckBuilder` — each deck row with a legality
  issue gets a red border + a small message ("banned in Infinity / Set 12",
  "no printing in Set 12 Core-legal set") sourced from `issue.message`.
- **`createLobby` format source** — read `{ family, rotation }` off the
  selected deck's stamp instead of the lobby screen's current Core/Infinity
  toggle. Remove the toggle.

### ~~Server work~~ — DONE 2026-04-21 (server agent)

- `lobbyService.createLobby` now takes `GameFormat = { family, rotation }`,
  validates rotation against `CORE_ROTATIONS` / `INFINITY_ROTATIONS` registry,
  and calls `isLegalFor(deck, CARD_DEFINITIONS, gameFormat)` — illegal decks
  throw `"ILLEGAL_DECK"` which the route translates to a 400 with
  `issues[]`. `joinLobby` re-validates the guest's deck against the lobby's
  stored format+rotation to prevent post-create deck edits from bypassing
  legality.
- `routes/lobby.ts` accepts `gameRotation` as a parallel field alongside the
  existing `gameFormat` string (didn't merge into one object shape to keep UI
  migration non-breaking — UI can keep sending `gameFormat: "core"` and just
  add `gameRotation: "s12"` when ready). `DEFAULT_ROTATION` constant set to
  `"s11"`; bump to `"s12"` on 2026-05-08.
- ELO key shape: `${"bo1"|"bo3"}_${"core"|"infinity"}_${RotationId}`. Per-
  rotation as decided by user. `DEFAULT_RATINGS` built by iterating
  `CORE_ROTATIONS` / `INFINITY_ROTATIONS` keys — new rotations auto-populate
  without touching `gameService.ts`.
- `resignGame` now looks up the parent lobby's `format/game_format/
  game_rotation` to land ELO in the correct bucket instead of always
  defaulting to `bo1_infinity`.

**2026-05-08 reminder:** on Set 12 release, follow `docs/ROTATIONS.md`
runbook 2 ("Release day — switch the live Core default") to flip the s11
→ s12 defaults across engine / SQL / server code. Runbook lists exact
files, commands, and verification queries.

### ~~Still open: UI work~~ — DONE 2026-04-21 (GUI agent, commit TBD)

User confirmed browser flow works end-to-end for both new and existing decks.
What shipped:

- `serverApi.ts` — `EloRatings` widened to 8 per-rotation keys via template
  literal type `${"bo1"|"bo3"}_${GameFormatFamily}_${RotationId}`;
  `createLobby` accepts `gameRotation: RotationId` as 4th arg, response
  includes `gameRotation`. Added `EloKey` + `Profile` exports.
- `deckApi.ts` — `SavedDeck` gets `format_family` + `format_rotation`.
  `saveDeck` accepts optional `format` param (falls through to DB DEFAULT
  for omitted); `updateDeck` accepts both fields. All SELECTs widened.
- `utils/deckRules.ts` — `listFormatOptions()`, `formatDisplayName()`,
  `FORMAT_FAMILY_ACCENT` palette. Engine registry → UI dropdown lives here
  so palette changes are one-line.
- `components/FormatPicker.tsx` — new compact dropdown (same pattern as
  DeckBuilder's group-by picker). Supports read-only mode for lobby
  contexts where format is derived from the selected deck.
- `components/CardPicker.tsx` — accepts `format?: GameFormat`; when set,
  `isCardLegalInFormat` runs as a hidden filter before user filters. Empty-
  state count reflects legal subset.
- `components/DeckBuilder.tsx` — accepts `format` (filters autocomplete) +
  `issueMessagesByDefinitionId` map. `DeckRow` renders red border +
  inline issue message when its entry is in the map.
- `pages/DeckBuilderPage.tsx` — format state (defaults `{ core, s12 }`),
  loaded decks adopt stored stamp. Format picker under deck name.
  `isLegalFor` memoized; issue map derived. Legality summary banner above
  rows. Save persists format. Dirty tracking accounts for format changes.
- `pages/DecksPage.tsx` — each tile shows format chip (top-right, accent-
  colored) and red "N illegal" chip when `isLegalFor` fails, hover tooltip
  listing issues.
- `pages/MultiplayerLobby.tsx` — removed standalone Core/Infinity toggle.
  `gameFormat` derived from selected saved deck's stamp; paste mode uses
  local `pasteFormat` state with a family-only toggle (rotation defaults
  to `s11`). ELO display key now 3D (`${bo}_${family}_${rotation}`).
  Saved-deck list tiles show format chip. Bo1/Bo3 match-format toggle
  stays (orthogonal). `profile` uses canonical `Profile` type.

Palette: **Core = indigo, Infinity = orange** (Hearthstone-style tiering;
both deliberately avoid the six Lorcana ink colors so format chips never
collide visually with ink indicators on deck tiles / row gems).

Still not in scope for this session (deliberately deferred):
- Paste-mode rotation picker (paste mode can only toggle family; rotation
  is hardcoded to `s11`). Low priority — paste is an edge-case entry point;
  saved decks are the primary flow.
- Banner/toast when deck's stamped rotation has been removed from the
  registry (`offeredForNewDecks: false` wouldn't affect existing decks, but
  if a rotation id is fully deleted the engine throws; the legality panel
  surfaces the error but it's not pretty).

### Maintenance

When Ravensburger announces the next rotation's set list, add a new entry
to `CORE_ROTATIONS` / `INFINITY_ROTATIONS`. Pre-release: set
`offeredForNewDecks: true` on the new entry while keeping the current one
also `true`. On release day: flip the prior rotation's `offeredForNewDecks`
to `false`. No legality logic ever changes; it's all registry edits.

### Sequencing

1. ~~**engine-expert**: refactor `formats/legality.ts` to the registry shape,
   update tests~~ — **DONE 2026-04-21**.
2. ~~**server agent**: schema migration + ELO key shape + server-side legality
   enforcement~~ — **DONE 2026-04-21**.
3. ~~**GUI agent**: update `EloRatings` type + `MultiplayerLobby` ELO lookup,
   add format dropdown, CardPicker filter, deck tile chip, inline row errors,
   remove the standalone `"core" | "infinity"` toggle~~ — **DONE 2026-04-21**.

---

## Engine agent (primary) + server agent + GUI agent: unranked rotation flag for pre-release Set 12 play

Worked through with user 2026-04-21 after the format-legality chain landed.
Problem: Set 12 releases 2026-05-08. Pre-release, two users playing a
lobby-code game on the `s12` rotation would move their `bo1_core_s12` /
`bo3_core_s12` ELO buckets — but at this stage the rotation is effectively
a beta: possible card-text errata, incomplete data coverage for some users,
undiagnosed bugs that could favor/disfavor specific cards. We want
playtesting games to record in history + replay for bug reports, but NOT
to move ratings until the rotation stabilizes at official release.

There is no matchmaking queue today — lobby codes only — so this isn't "a
separate queue." It's purely: "this rotation's lobbies don't award ELO."
Users who happen to play it before release know it doesn't count.

### Engine work (engine-expert)

Add a `ranked: boolean` field to `RotationEntry`, alongside the existing
`offeredForNewDecks` flag. Same lifecycle ritual — registered new, flipped
on release day.

```ts
// packages/engine/src/formats/legality.ts
export interface RotationEntry {
  readonly legalSets: ReadonlySet<string>;
  readonly banlist: ReadonlySet<string>;
  readonly offeredForNewDecks: boolean;
  readonly ranked: boolean;          // ← new
  readonly displayName: string;
}

CORE_ROTATIONS = {
  s11: { ..., offeredForNewDecks: true, ranked: true  },  // live, ELO-affecting
  s12: { ..., offeredForNewDecks: true, ranked: false },  // beta, unranked
};
INFINITY_ROTATIONS = {
  s11: { ..., offeredForNewDecks: true, ranked: true  },
  s12: { ..., offeredForNewDecks: true, ranked: false },
};
```

Suggested helper (used by server's updateElo early-return and UI's "Beta"
chip):

```ts
export function isRankedFormat(format: GameFormat): boolean {
  return resolveRotation(format).ranked;
}
```

Export `isRankedFormat` from `packages/engine/src/index.ts` alongside the
existing legality exports.

Tests: extend `legality.test.ts` with cases for the flag — both core and
infinity `s12` return `ranked: false`; `s11` returns `ranked: true`;
default values documented.

### Server work (server agent)

One behavior change: `updateElo()` in `packages/server/src/services/
gameService.ts` becomes a no-op when the lobby's rotation is unranked.

```ts
import { isRankedFormat } from "@lorcana-sim/engine"

async function updateElo(
  player1Id: string,
  player2Id: string,
  winner: "player1" | "player2",
  eloKey: EloKey,
  format: GameFormat,                    // ← new param (derived at call site)
) {
  if (!isRankedFormat(format)) {
    // Games on unranked rotations still save to history + replay table;
    // only the rating-update side-effects are suppressed. Still increment
    // games_played so the user's activity count is accurate.
    await Promise.all([
      supabase.from("profiles").update({ games_played: ... }).eq("id", player1Id),
      supabase.from("profiles").update({ games_played: ... }).eq("id", player2Id),
    ])
    return
  }
  // ...existing rating math
}
```

Every callsite of `updateElo` already looks up the lobby's
`format/game_format/game_rotation`, so threading `GameFormat` through is a
signature change, not a data-availability problem.

Also: when a game completes on an unranked rotation, include a
`ranked: false` flag in the game_over payload / game record so the UI can
render differently without needing to re-derive.

### GUI work (GUI agent — me, follow-up after engine + server)

- `MultiplayerLobby`: when a selected deck's rotation is unranked, show a
  small "Unranked — Beta" chip next to the format chip in the lobby tile.
  Also in the host/join cards, display a one-line banner: *"Set 12 Core is
  in beta. Wins/losses won't affect your ELO until release day."*
- `DecksPage`: beside the format chip on each deck tile, a small "Beta"
  badge for unranked rotations. Subtle — same-family accent but with a
  "BETA" text suffix on the chip instead of a separate chip.
- Post-game screen (wherever match result is shown — GameBoard's game-over
  overlay?): suppress the ELO delta display for unranked matches. Show
  "Unranked match" in place of the rating change.
- `FormatPicker` dropdown: append a small "beta" italic note next to
  rotation names where `ranked: false` so users picking the format see the
  status before committing to it.

No new storage needed — the flag is a pure derived property of the
rotation, read from the engine registry on every render.

### Sequencing

1. **engine-expert**: add `ranked` field + `isRankedFormat` helper, update
   tests. Small, self-contained.
2. **server agent**: thread `GameFormat` into `updateElo`, early-return on
   unranked, still bump `games_played` + save to history. Include the flag
   in the completed-game payload.
3. **GUI agent** (me): Beta chip + banner + post-game suppression +
   FormatPicker italic note. Blocks on (1) for `isRankedFormat` export.

### 2026-05-08 reminder — additive to the existing release-day runbook

When flipping s12 to the live default, also flip `ranked: false` → `true`
for both `CORE_ROTATIONS.s12` and `INFINITY_ROTATIONS.s12`. If any s12
registry entry was duplicated into `docs/ROTATIONS.md`, update that too.
Backdated games on the s12 rotation stay unranked — we don't retroactively
award ELO.

---

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

---

## GUI/UI follow-up: R2 image migration DONE 2026-04-21 — size-swap bugs remain

**Migration complete in commit `7d37d23`.** Every card in the database
(2808 total) has an R2 image URL, verified live via HEAD probes. Engine
side is fully shipped; only the UI-side size-swap bugs remain (below).

### What landed

- **2788 cards** migrated from Ravensburger (all main sets 1-12 + Ravensburger-
  sourced promos: P1, P2, P3, C1, D23).
- **20 cards** migrated from Lorcast (gaps Ravensburger doesn't publish:
  11 set-12 pre-release reveals, 6 C2 convention cards, 3 DIS Disneyland
  promos).
- **0 failures** across ~8500 HTTP PUTs (2808 cards × 3 sizes).
- **2808/2808 URLs verified live** via HEAD probe post-migration.

**R2 public base URL currently in use:** `https://pub-5d52a089800f49be846aa55b2833c558.r2.dev`
(Cloudflare's default public domain — no custom domain provisioned yet).
Migration to a custom domain (e.g. `cards.yourdomain.com`) is
idempotent — re-run the sync scripts with a new `R2_PUBLIC_BASE_URL` in
`.env` and every card's `imageUrl` gets rewritten. Not blocking anything.

### Re-run semantics (documented for future agents)

All three scripts are idempotent and safe to re-run anytime:

- **Nothing changed**: 3-condition idempotency check skips all cards. Near-
  instant (~2 sec for 2808 cards).
- **New cards added** (e.g. post-`pnpm import-cards`): only new/changed
  cards process; everything else skips.
- **Ravensburger rotated art**: `_sourceImageUrl` (stored) ≠ fresh
  `imageUrl` (from import) → re-process those specific cards only. New
  content hash → new R2 key → `imageUrl` rewritten.
- **Post-`pnpm import-cards`**: the importer overwrites `card.imageUrl`
  with the fresh upstream URL. Sync detects this (`imageUrl` no longer
  R2-shaped) and re-processes. If bytes are unchanged, same hash → same
  R2 key → PUT is effectively a no-op on R2 backend. `imageUrl` gets
  restored to R2.

### Scope options (reference)

| Command | Effect |
|---|---|
| `pnpm sync-images-rav` | All sets, Ravensburger tier |
| `pnpm sync-images-rav --sets 12` | Just set 12 |
| `pnpm sync-images-rav --sets 12,P1,DIS` | Multiple sets |
| `pnpm sync-images-rav --dry-run --sets 12` | Preview without uploading |
| `pnpm sync-images-lorcast` | Lorcast tier (fills ravensburger gaps) |
| `pnpm sync-images-manual` | Local-file tier (reads `assets/manual-cards/`) |
| `pnpm exec tsx scripts/check-r2-progress.ts` | Probe R2 bucket contents |
| `pnpm exec tsx scripts/verify-r2-urls.ts` | HEAD-probe every URL in JSON |

### Performance (post-parallelism refactor)

The first sync pass ran serially and took ~50 min for the main sets.
Mid-migration I rewrote the script to:
- Upload 3 sizes per card in parallel (`Promise.all`) instead of serial
- Process 8 cards in parallel per batch
- Drop the `HeadObjectCommand` preflight (PUTs at content-hashed keys
  are idempotent at the backend)

Result: ~50x faster. Remaining work after the rewrite finished in under
1 minute. Future migrations (new set drops, art rotations) are fast.

### Round-trip fixes (how `import-cards` interacts with image sync)

Before commit `7d37d23`, re-importing card data would have silently
dropped `_imageSource`/`_sourceImageUrl`/`_imageSourceLock`, forcing a
full re-migration on every import. Fixed:

- **`import-cards-rav.ts` + `import-cards-lorcast.ts`**: preserve the
  three image-sync fields via the existing `passthroughFields` mechanism
  (same as `foilImageUrl`, `shiftCost`, etc.).
- **`sync-images-rav.ts` + `sync-images-lorcast.ts`**: `getSourceUrl`
  prefers `card.imageUrl` when upstream-shaped (fresh from import) over
  `_sourceImageUrl` (stale snapshot). This drives Ravensburger-rotation
  detection.
- **`syncSingleCard` idempotency**: 3-condition check (`_imageSource`,
  `_sourceImageUrl`, `imageUrl` R2-shape) guarantees the post-import
  re-sync restores `imageUrl` to R2 even when content is unchanged.

### Debugging fixes from the live run

Three issues surfaced during the user's live migration attempt that aren't
obvious from docs — preserving for future reruns (and for anyone setting
up a new R2 bucket):

1. **`forcePathStyle: true`** required. R2 doesn't auto-handle virtual-
   hosted-style addressing; the AWS SDK defaults to it and produces
   URLs like `<bucket>.<account>.r2.cloudflarestorage.com` that fail
   DNS resolution when the account ID is malformed.
2. **`requestChecksumCalculation: "WHEN_REQUIRED"`** + matching response
   validation. `@aws-sdk/client-s3 3.729+` defaults to sending
   `x-amz-checksum-crc32` on every request; R2 returns a 400 with an
   error body the RestXml parser can't handle, surfacing as opaque
   `UnknownError`. Opting out of flexible checksums restores classic
   S3-style signing.
3. **R2_ACCOUNT_ID sanitizer** — strips `https://` prefix and the
   `.r2.cloudflarestorage.com/...` suffix so users can paste the full
   endpoint URL from the Cloudflare dashboard without breaking the
   script.

### Remaining work

Only UI-side size-swap bugs — see the next section. No further engine
work blocking anything.

### Deferred to phase 2 (non-blocking)

Variants / foil art. MVP shipped regular `imageUrl` only; `foilImageUrl` /
`variants[].imageUrl` / `printings[].imageUrl` still point at upstream
URLs. Second migration pass once we confirm the pipeline is stable for a
few weeks and there's a concrete need for foil art in clip export / UI.

### Engine work — DONE 2026-04-21

**Schema additions** (types/index.ts → CardDefinition):
- `_imageSource?: "ravensburger" | "lorcast" | "manual"` — image provenance,
  tracked independently of `_source` (they can diverge pre-release).
- `_sourceImageUrl?: string` — upstream URL the current R2 image was pulled
  from. Enables idempotent re-runs (same upstream → skip) + rotation
  detection (upstream URL changed → re-pull).
- `_imageSourceLock?: boolean` — manual pin; mirror of `_sourceLock`.

**Shared library** (`scripts/lib/image-sync.ts`):
- `syncSingleCard` — the per-card pipeline (guard checks → fetch/read →
  sharp resize to 200/450/900w → SHA-256 hash → R2 PutObject or dry-run).
- `runSync` — top-level runner that walks all card-set JSONs, filters by
  `--sets`, and per-file JSON writes.
- `readR2ConfigFromEnv` — returns null when any R2 env var is missing
  (auto-enables dry-run mode).
- Handles `file://` URLs so the manual tier can share the same pipeline.
- Content-hashed R2 keys (`set12/4_<hash>_normal.jpg`) + `HeadObjectCommand`
  existence check → skips PUT when the same bytes are already uploaded.

**Three sync scripts** (all registered in package.json):
- `pnpm sync-images-rav` — covers ~90% of cards (main sets 1-12 + Ravensburger
  promos). Filters on `api.lorcana.ravensburger.com` / `disneylorcana.com`
  URL shape. Primary weekly maintenance script.
- `pnpm sync-images-lorcast` — fills gaps Ravensburger doesn't publish (DIS,
  C2, CP + pre-release set-N reveals). Filters on `cards.lorcast.io` /
  `lorcast.com` URL shape. Refuses to downgrade cards already at
  `_imageSource: "ravensburger"`.
- `pnpm sync-images-manual` — reads from `assets/manual-cards/<setId>/<number>.{jpg,png,webp,avif}`.
  Dev drops a file → script picks up on next run. Refuses to downgrade
  ravensburger/lorcast-tier entries unless `_imageSourceLock: true` pins to
  manual.

**CLI flags** (all three scripts):
- `--dry-run` — skip R2 upload, but still fetch + resize + hash + print
  would-write preview. Auto-enabled when R2 creds missing from `.env`.
- `--sets <ids>` — comma-separated set ids (e.g. `--sets 12,P1,DIS`).
- `--limit N` — process first N cards across selected sets (smoke testing).
- `--help` / `-h` — usage.

**R2 path shape** (preserved from original design — content hash in filename
enables `Cache-Control: public, max-age=31536000, immutable`):
```
https://<R2_PUBLIC_BASE_URL>/set12/123_<16-char-hash>_{small|normal|large}.jpg
```

**Deferred to phase 2** (non-blocking):
- Variants / foil art. MVP ships regular `imageUrl` only; `foilImageUrl` /
  `variants[].imageUrl` / `printings[].imageUrl` continue to point at
  upstream URLs for now. Second migration pass once regular-art coverage is
  ≥95% and we're confident the pipeline is solid.

### Scope for `ui-specialist` + `gameboard-specialist` (follow-up, ~30 min, unblocks when migration runs)

Once card-set JSONs have been migrated to R2 URLs, fix these two silent
no-ops that were shipping the full 900w image to surfaces that only needed
a thumbnail:

- `packages/ui/src/components/GameCard.tsx:239` —
  `def.imageUrl.replace("/digital/normal/", "/digital/small/")`
- `packages/ui/src/components/DeckBuilder.tsx:311` — same pattern
- `packages/ui/src/pages/DeckBuilderPage.tsx:308` — same pattern

The `/digital/normal/` path is **Lorcast-shaped**, not R2-shaped. After
migration, R2 keys encode size as `_small` / `_normal` / `_large`:

```ts
def.imageUrl.replace("_normal.jpg", "_small.jpg")
```

Ping `gameboard-specialist` for `GameCard.tsx`; `ui-specialist` for the two
deckbuilder files.

### Why this matters

Every card JSON currently hot-links to `api.lorcana.ravensburger.com`.
Post-MP-deploy this becomes (a) a rate-limit dependency on Ravensburger's
good will, (b) a CORS blocker for canvas-based clip/deck-image export
(near-term priority), and (c) a fragility point — their CDN path includes
a content hash that will rotate eventually, breaking 2769 URLs across 19
JSON files at once.

### Reference

- Strategy rationale + cost analysis: strategy agent, 2026-04-20.
- Existing importer hierarchy pattern (refuses-to-downgrade): `scripts/import-cards-rav.ts` +
  `scripts/import-cards-lorcast.ts`.
- Existing `_sourceLock` precedent: The Bayou in card-set-1.json.
- Original external download script (now superseded by in-repo scripts):
  `~/Desktop/Lorcana_Assets/rav-download-images.mjs`.

---

## ~~Server agent: `decks` + `deck_versions` base-table DDL missing from schema.sql~~ — DONE 2026-04-22

DONE in the same session as MP UX Phase 2. `schema.sql` now contains the
reconstructed `CREATE TABLE decks` + `CREATE TABLE deck_versions` base
DDL immediately before the `ALTER TABLE decks …` block, plus RLS
policies (owner-only for decks; deck_versions visible via EXISTS
subquery to the parent deck). `IF NOT EXISTS` on the table creates
makes it safe to run against the existing production DB. Fresh-
environment rebuild now works end-to-end.

Kept below for historical context:

### Original discovery

Discovered 2026-04-21 while adding format-stamp columns. `server/src/db/schema.sql`
contains `ALTER TABLE decks ADD COLUMN ...` statements but **not the
`CREATE TABLE decks` or `CREATE TABLE deck_versions` that they alter** —
those tables were created ad-hoc in Supabase Studio at some point and the
DDL never landed in source control. The app works because Supabase has the
tables, but anyone spinning up a fresh environment from `schema.sql` would
hit "relation does not exist" on the first `ALTER TABLE decks` line.

Both are referenced from `packages/ui/src/lib/deckApi.ts:37,48,58,69,85,101,110`.

**Fix:** reconstruct the base DDL by inspecting the live Supabase schema
(`supabase db dump` or SQL editor) and prepend it to the block in
`schema.sql`. Expected shape (inferred from usage):

```sql
CREATE TABLE IF NOT EXISTS decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  decklist_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS deck_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  decklist_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Add appropriate RLS policies to match (`auth.uid() = user_id` on decks;
deck_versions visible via `EXISTS` subquery to the parent deck). Verify
against the live Supabase schema before committing — the types above are
inferences from the API surface, not a dump.

Low priority (app works today) but load-bearing for dev onboarding and
before any schema-only rebuild.

---

## Server agent: `decks` / `deck_versions` consolidation — future cleanup

Captured 2026-04-21 after the format-stamp migration landed. Raised by user:
"can't the latest deck_version just be the deck?"

Today the two tables carry overlapping data — `decks.decklist_text` equals
the latest `deck_versions.decklist_text` for the same deck by convention,
kept in sync by `snapshotVersion()` in `packages/ui/src/lib/deckApi.ts:46`.
If `snapshotVersion` ever silently fails after `saveDeck` succeeds, the two
can drift and the app silently lies about history.

**Why it stays two tables today:**
- `decks` carries non-versioned metadata: `name`, `box_card_id`,
  `card_metadata`, and (as of 2026-04-21) `format_family` + `format_rotation`.
- `decks` is the clean FK target for future `games.deck_id`, `matches.deck_id`
  etc. — those should reference the deck identity, not a specific version.
- `SELECT * FROM decks WHERE user_id = ?` is trivial. The collapsed shape
  needs a window-function / self-join for "latest per deck."

**Cleanup paths if the redundancy becomes a real problem:**
1. **Drop `decks.decklist_text` entirely.** Always read the latest version.
   Rewrites every deck-read path to do a `LATERAL JOIN` or subquery.
2. **Replace `decks.decklist_text` with `current_version_id FK → deck_versions.id`.**
   Explicit pointer, no drift risk, one extra join per read. Cleanest
   middle ground.
3. **Keep as-is, add a DB trigger that keeps `decks.decklist_text` in sync
   with the latest version.** Fixes drift without changing the reading
   surface. Trade-off: trigger logic is spooky-action-at-a-distance.

Not blocking anything. Park here until we either (a) see a real drift bug or
(b) touch this area for another reason.

---

## Server agent: set up server-side test infrastructure

Filed 2026-04-21 after the `lastRevealedHand` anti-cheat fix landed without
regression coverage.

`server/` has no test runner at all — `package.json` scripts are `dev /
build / start / typecheck`, and there are zero `*.test.ts` files. Bug fixes
in server code (like the `stateFilter.ts` fix today) ship without automated
regression coverage. Manual MP testing is the only safety net, which won't
scale as the server grows (anti-cheat, lobby, ELO, format validation are all
security-adjacent surfaces).

**Scope:**
1. Add `vitest` dev dep + `test` / `test:watch` scripts to
   `server/package.json` (match the engine's setup).
2. Create `server/src/services/stateFilter.test.ts` with the 3 cases
   originally proposed in the `lastRevealedHand` handoff entry:
   - Public `reveal_hand` → cards preserved in BOTH players' filtered states.
   - `look_at_hand` (privateTo: p1) → cards preserved in p1's state, stubbed
     in p2's.
   - Post-reveal drift: if p2 draws a new card, that new card's instance
     correctly gets stubbed for p1 (the filter only preserves the revealed
     instance IDs, not the hand slot).
3. Create `server/src/services/lobbyService.test.ts` covering format legality
   rejection — exercises the `isLegalFor` integration added 2026-04-21. Needs
   a Supabase mock or a test-DB fixture; simpler path is mocking the supabase
   client since `lobbyService` is the only consumer.
4. Wire up `pnpm --filter server test` in CI once it exists.

**Why deferred:** adding test infra is meaningfully more scope than any
single server bug fix that's come up so far. Landing it as its own task
(not coupled to a bug fix) keeps the intent clean.

Related notes across the repo mention this gap obliquely but nothing owns it:
- `CLAUDE.md` lists engine/simulator/analytics test counts but server has no
  test metric — the omission is the signal.
- `feedback_bug_fix_workflow` in user memory says "every engine bug fix
  ships a regression test" — server doesn't have the infrastructure to
  follow that rule today.

~1 day to land minimal scaffolding + the two test files above. Worth
doing before Railway MP deploy.

---

## Server agent (first) + GUI agent (follow-up): in-app feedback / bug report system

Planned with user 2026-04-21. Reusable "Report an issue" trigger surfaced
across the app (footer link, card-inspect modal, eventually gameboard +
error boundaries) feeding a single Supabase-backed table. Value add over a
generic email link: **context injection** — the trigger knows what the
user was looking at when they clicked it (card id, game state, deck id,
URL, viewport) and attaches it to the submission automatically.

### Sequencing

**Server first, GUI second.** Server-side MVP is small and self-contained
(one table, one endpoint, one RLS policy set, one rate-limit check); the
GUI POSTs to that endpoint so we'd be writing throwaway mock code if we
reversed the order. Server session ~1 half-day, GUI session ~half-day
after.

Parallel path if needed: GUI can build provider + modal scaffolding
against a console.log stub and wire the real endpoint in once it lands.
Only do this if both sessions are happening concurrently — otherwise
sequential is cleaner.

### Server work (server agent) — Phase 1 MVP

**New table** `feedback`:

```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),  -- nullable; anonymous submissions allowed
  type TEXT NOT NULL CHECK (type IN ('bug','card_issue','idea','general','ui','performance','crash')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 3 AND 5000),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,  -- caller-injected: cardId, gameSeed, deckId, replay payload, etc.
  url TEXT,
  user_agent TEXT,
  viewport JSONB,            -- { width, height }
  app_version TEXT,
  screenshot_data TEXT,      -- base64 data URL; nullable (MVP defers screenshots to Phase 2)
  status TEXT NOT NULL DEFAULT 'open'
         CHECK (status IN ('open','triaged','in_progress','resolved','wontfix','duplicate')),
  assigned_to UUID REFERENCES auth.users(id),
  admin_notes TEXT,
  duplicate_of UUID REFERENCES feedback(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX feedback_status_idx ON feedback (status, created_at DESC);
CREATE INDEX feedback_user_idx ON feedback (user_id, created_at DESC);
CREATE INDEX feedback_type_idx ON feedback (type, status);
```

**RLS policies:**
- INSERT: anyone (including unauthenticated — `WITH CHECK (true)`)
- SELECT: user can read their own submissions (future "my tickets" view); admins read all
- UPDATE: admins only
- DELETE: service-role only

**Endpoint** `POST /feedback`:

Request:
```ts
{
  type: "bug"|"card_issue"|"idea"|"general"|"ui"|"performance"|"crash",
  title: string,
  description: string,
  context?: Record<string, unknown>,
  clientMeta: {
    url: string,
    userAgent: string,
    viewport: { width: number, height: number },
    appVersion: string,
  },
  screenshot?: string,  // base64 data URL, deferred to Phase 2 — MVP rejects with 400 if provided
}
```

Response: `{ id, createdAt, referenceCode }` (referenceCode = `"fb-" + id.slice(0,6)`).

Errors:
- `400` — validation (length bounds, bad type)
- `413` — screenshot too large (Phase 2 only)
- `429` — rate limit exceeded (`{ error, retryAfter: seconds }`)

**Rate limit:**
- 10 submissions/hour per authenticated `user_id` — DB window query on `created_at`
- 3 submissions/hour per IP for anonymous — can use Hono's IP middleware or Supabase RPC

**Optional:** Discord webhook for visibility. Guard behind
`DISCORD_FEEDBACK_WEBHOOK` env var — skip entire block if unset. Post a
redacted summary on each new submission with a link to the Supabase row.

### GUI work (GUI agent) — Phase 1 MVP

Depends on server endpoint. Files to add/modify:

**New:**
- `packages/ui/src/lib/feedbackApi.ts` — POST wrapper around `/feedback`.
  Auth header if signed in; retry-on-network-failure; returns
  `{ id, referenceCode }`.
- `packages/ui/src/lib/feedbackContext.tsx` — React context + provider.
  Exposes `useFeedback()` hook returning `{ open(ctx?: FeedbackContext) }`.
  Owns modal open state + pre-filled context.
- `packages/ui/src/components/FeedbackModal.tsx` — the form. Type dropdown,
  title, description, auto-metadata preview, submit. Shows toast with
  reference code on success.
- `packages/ui/src/components/FeedbackButton.tsx` — presentational trigger.
  Variants: `"fab"`, `"inline"`, `"icon"`, `"menuItem"`. All call
  `useFeedback().open()` with per-call context.

**Modified:**
- `packages/ui/src/App.tsx` — wrap app in `FeedbackProvider`; add footer
  trigger next to the Disney/Ravensburger notice.
- `packages/ui/src/components/CardInspectModal.tsx` — "Report issue with
  this card" button in footer. Hands `{ type: "card_issue", context: { cardId: def.id, fullName: def.fullName } }`
  to the modal.

**Deferred to Phase 2+** (captured in comments, not in MVP scope):
- Screenshot attachment (reuse existing `html-to-image` dep)
- Error boundary integration ("Report this crash" in fallback UI)
- Game-state context (coordination with gameboard-specialist)
- "My tickets" user-visible view
- Admin dashboard (`/admin/feedback` route)

### Auto-captured client metadata (always sent)

```ts
{
  url: window.location.pathname,
  userAgent: navigator.userAgent,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  appVersion: import.meta.env.VITE_APP_VERSION ?? "dev",
}
```

Modal shows a "What we'll send" expandable section so users see metadata
before submitting — privacy-forward. Attachment checkboxes (when context
is non-empty) default to on but can be unchecked.

### Decisions locked with user

1. **Anonymous allowed** — removes signup friction for bug reports. Backend tags `user_id: null`.
2. **MVP screenshots: deferred to Phase 2** — adds complexity without clear MVP value.
3. **Footer placement over FAB** — less screen-real-estate intrusion. Gameboard-specialist can add a gameboard-specific trigger (FAB or utility-strip icon) separately.
4. **Rate limits**: 10/hour authenticated, 3/hour anonymous. Adjust per real usage.
5. **Discord webhook**: include in MVP if the project has a Discord; skip cleanly via env var otherwise.

### Coordination for Phase 2+

- **gameboard-specialist** will need the `useFeedback()` hook to capture
  in-game context — ideally `{ seed, turnNumber, lastActions: GameAction[] }`
  or even the full replay payload. Document the `FeedbackContext` type
  shape in `feedbackContext.tsx` so their triggers pass the right fields.
- **engine-expert** gets a query-able firehose of `card_issue` reports
  keyed by `context->>'cardId'` — high-signal input for the card-issue
  backlog. Flag when the feature ships.

---

## End-to-end multiplayer UX improvement plan (7 phases)

Planned with user 2026-04-22. Full detail in
`C:\Users\Ryan\.claude\plans\can-we-look-at-dapper-sunrise.md`. This
handoff entry summarizes the agent splits + sequencing so each phase can
be picked up without re-reading the full plan.

### Status snapshot — read this first

| Phase | Status | Next action |
|---|---|---|
| 1. Lobby polish + public browser + first-player banner | Server ✅ (35061e1), GUI ✅ (15db979 + a55b372). User confirmed end-to-end happy path + cancel + legality. | gameboard-specialist: first-player banner (prompt below in §Phase 1) |
| 2. Post-game polish (replay save, ELO delta, rematch w/ loser-picks-first) | All open — server is the blocker | server agent: pick up Phase 2 prompt below in §Phase 2 |
| 3. Matchmaking queue (user's two-account test target) | Open, blocked on Phase 2 finishing | Pending; server prompt to be drafted when Phase 2 lands |
| 4. Reconnection + resume hardening | Open | After Phase 3 |
| 5. Friends + rich presence | Open | After Phase 4 |
| 6. Emoji reactions (ephemeral) | Open | Can land independently of 5 |
| 7. Spectator mode (per-side fog-of-war) | Open; Phase 1 plumbing already shipped (`spectator_policy`) | After Phase 5 for friends-feed; public-games feed works without 5 |

**Current bottleneck:** Phase 2 server work. Once that lands, both
Phase 2 GUI prompts (gameboard-specialist + GUI agent) unblock in
parallel, and Phase 3 prep can begin.

### Locked design decisions

1. **No pre-match screen.** Inline "You go first" / "Opponent goes first"
   banner appears on game load, auto-dismisses ~2s. Consistent for all Bo3
   games — no special ceremony for game 1.
2. **Rematch with loser-picks-first.** Same decks reused; loser of previous
   game picks play-or-draw, winner waits for their choice. 60s window.
3. **Emoji reactions are ephemeral** — Supabase Realtime broadcast, no DB.
   **Do NOT emit into `game_actions`** — that table feeds clone-trainer
   RL, polluting it with user reactions would contaminate training data.
4. **Friends: symmetric** (mutual accept, both parties in `friends` row).
5. **Spectators always anonymous** to players — count visible via badge,
   individual usernames never shown. No opt-in toggle, no scouting vectors.
6. **Both public-lobby browser AND ELO-banded matchmaking queue** — user
   wants to test queue with two accounts (main + incognito). Queue is
   Phase 3, not deferred.
7. **Rich presence**: `online` / `in_lobby` / `in_game` / `idle` states.

### Explicitly out of scope

- Free-form in-game chat.
- Omniscient spectator view (per-side fog-of-war only).
- Chess-clock / per-turn timers — flagged as a separate future planning
  session; Lorcana lacks a canonical clock spec so mechanics need their
  own design pass. Phase 4 (reconnection) adds a minimum viable 2-min
  opponent-dropout claim-win — NOT a real turn clock.

### Phase 1 — Lobby polish + public browser + first-player banner

Agent splits:
- ~~**server agent** (blocking): schema `lobbies.public`,
  `lobbies.spectator_policy`, `POST /lobby/:id/cancel` endpoint,
  `GET /lobby/public` for the browser.~~ — **DONE 2026-04-22** (server-specialist).
  Details:
  - Schema: `lobbies.public BOOLEAN DEFAULT FALSE`, `lobbies.spectator_policy TEXT
    DEFAULT 'off'` with CHECK constraint `('off','invite_only','friends','public')`.
    New status `'cancelled'` documented (column has no CHECK, so no migration needed).
  - `createLobby` accepts `{ public, spectatorPolicy }` options; `POST /lobby/create`
    wires them through with validation (unknown policies fall back to `'off'`).
  - `listPublicLobbies(userId)` — filters `status='waiting' AND public=true AND
    host_id != userId`, joins `profiles!host_id` for username, returns host
    username + format metadata only (**NO** deck fields — no scouting vector).
    Limit 50, ordered by `created_at DESC`.
  - `cancelLobby(userId, lobbyId)` — host-only (403 otherwise), status='waiting'
    only (409 otherwise), 404 if lobby missing. Idempotent via race-guarded UPDATE.
  - Route order fixed: `/public` and `/:id/cancel` registered BEFORE the
    catch-all `/:id`.
  - SQL to run in Supabase (idempotent, safe to re-run):
    ```sql
    ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS public BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS spectator_policy TEXT NOT NULL DEFAULT 'off'
      CHECK (spectator_policy IN ('off','invite_only','friends','public'));
    ```
- ~~**GUI agent**: client-side legality pre-check in `MultiplayerLobby`,
  waiting-state countdown, public/private toggle in Host card, public
  lobby browser section, cancel button wiring.~~ — **DONE 2026-04-22**
  in commits 15db979 (legality pre-check + wait counter) and a55b372
  (public toggle + browser + server-side cancel). User confirmed end-
  to-end happy path + cancel + legality flows in browser.
- **gameboard-specialist**: first-player banner on GameBoard. **OPEN —
  prompt below.**

#### Open prompt for gameboard-specialist (Phase 1 banner)

```
MP UX Phase 1 — first-player banner on GameBoard. Full plan context in
docs/HANDOFF.md under "End-to-end multiplayer UX improvement plan
(7 phases) → Phase 1." This is the only Phase 1 GameBoard piece; lobby
+ public-browser GUI shipped in 15db979 + a55b372.

Scope: when an MP game starts (or a Bo3 game 2/3 transitions in), show
a brief overlay/toast on the board for ~2s saying:
- "You go first" — if state.firstPlayerId === myPlayerId
- "Opponent goes first" — otherwise
For Bo3 games 2 and 3, prefix with "Game 2 of 3 · 1-0" style match-
score context (read state._matchScore and state._matchNextGameId per
the existing game-over overlay code). For game 1 of Bo3, no prefix.

Locked design decisions (per HANDOFF):
- No countdown screen, no animation, no opponent preview
- Auto-dismiss after ~2s; click-anywhere also dismisses
- No format chip on the banner (player is committed to format already)
- Same treatment for all Bo3 games — game 1 doesn't get extra ceremony

Implementation notes:
- state.firstPlayerId is already populated by the engine — no server
  or engine change needed
- Trigger: on initial game state load AND on transition into a new
  game_number (Bo3 game 2/3 navigation)
- Display: top-of-board overlay or center toast, your call. Ideally
  doesn't block input (user can start playing immediately)
- Suppress for solo/sandbox games — only fires for MP (check whether
  myPlayerId came from the MP path; useGameSession knows this)

Files to touch:
- packages/ui/src/pages/GameBoard.tsx (overlay rendering)
- packages/ui/src/hooks/useGameSession.ts (if you need a derived
  "is this an MP game start" signal)

Out of scope: Phase 2 game-over overlay work (rematch, ELO delta,
share-replay button) — separate prompt below in Phase 2.
```

### Phase 2 — Post-game polish

Agent splits:
- ~~**server agent**: ELO delta in game-finish payload, MP replay auto-save,
  `POST /lobby/rematch` + loser-choice flow, replay public toggle.~~ —
  **DONE 2026-04-22.** Details in the "Server DONE 2026-04-22" subsection
  below — includes shape changes, endpoint shapes, and SQL the user needs
  to run in Supabase.
- **gameboard-specialist**: game-over overlay (ELO delta, share button,
  rematch flow). **OPEN — prompt below. UNBLOCKED (server is done).**
- **GUI agent**: replay-save toast in `useGameSession` + serverApi
  wrappers for the new endpoints. **OPEN — prompt below. UNBLOCKED (server is done).**

Sequence: server first (done); now both UI agents can proceed in parallel.

#### Server DONE 2026-04-22 (server-specialist)

Commits land server-side in one slice. SQL the user must run in Supabase
SQL editor (idempotent — safe to re-run):

```sql
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS rematch_of UUID REFERENCES lobbies(id);

CREATE TABLE IF NOT EXISTS replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  winner_player_id UUID REFERENCES profiles(id),
  p1_username TEXT,
  p2_username TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  format TEXT, game_format TEXT, game_rotation TEXT,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS replays_public_idx ON replays (public, created_at DESC);
CREATE INDEX IF NOT EXISTS replays_game_idx ON replays (game_id);

ALTER TABLE replays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Replays readable by players or if public" ON replays;
DROP POLICY IF EXISTS "Replays public-toggle by players" ON replays;
CREATE POLICY "Replays readable by players or if public" ON replays FOR SELECT
  USING (public = true OR EXISTS (SELECT 1 FROM games WHERE games.id = replays.game_id
    AND (games.player1_id = auth.uid() OR games.player2_id = auth.uid())));
CREATE POLICY "Replays public-toggle by players" ON replays FOR UPDATE
  USING (EXISTS (SELECT 1 FROM games WHERE games.id = replays.game_id
    AND (games.player1_id = auth.uid() OR games.player2_id = auth.uid())));

ALTER TABLE lobbies REPLICA IDENTITY FULL;
```

**ELO delta shape** — embedded in `GameState` as `_eloDelta` alongside the
existing `_matchScore` / `_matchNextGameId`. Keyed by Supabase user-id so
each client extracts its own row. Present only when the match was
actually decided (Bo3 game 1 with no match decision yet: omitted):
```ts
type EloDelta = {
  [userId: string]: { before: number; after: number; delta: number };
  _eloKey: `${"bo1"|"bo3"}_${"core"|"infinity"}_${RotationId}`;
}
```
UI rule: `delta > 0` → green, `delta < 0` → red, `delta === 0` → gray
("Unranked" or "No change"). This trio ships on both `POST /game/:id/action`
response and the Realtime broadcast (same state blob). `GET /game/:id`
returns it too once the game is finished.

**Replay auto-save** — every MP game that finishes (natural end OR resign)
inserts a row into `replays` via `saveReplayForGame()` in gameService.ts.
Idempotent (game_id UNIQUE → ON CONFLICT DO NOTHING). Bo3 match = up to
3 replay rows per match.

**Rematch endpoint** — `POST /lobby/rematch { previousLobbyId }`:
- Auth: must be one of the two players in the previous lobby
- Previous lobby must be status='finished'
- Caller must not have another active game
- Creates new lobby with `rematch_of` → previous, spawns first game
  immediately with previous-match LOSER in player1 slot (engine's
  `choose_play_order` surfaces to loser via existing PendingChoiceModal —
  same UX as CRD 2.1.3.2 Bo3 games 2/3)
- Idempotent: concurrent clicks from both players converge on one lobby
  (lookup by rematch_of before insert)
- Returns: `{ lobbyId, gameId, code, myPlayerId }`
- Errors: 404 if previous not found, 403 if not a player, 409 if already
  in a game or status isn't finished

Note on deviation from the original Phase 2 prompt: the prompt called for
TWO endpoints (`/lobby/rematch` creates a `waiting_loser_choice` lobby,
`/lobby/:id/loser-choice` transitions to active). We collapsed to one
endpoint because the engine already has `choose_play_order` (from CRD
2.1.3.2 work) that handles the loser's play/draw pick. Adding a parallel
server-side election would be redundant. Winner-waits UX is provided by
the existing PendingChoiceModal opponent-view variant.

**Replay share endpoint** — new route file `server/src/routes/replay.ts`:
- `GET /replay/:id` — returns metadata + full replay payload (seed,
  decks, actions, winner). Auth optional — public=true replays work
  without a token; private replays require one of the two players.
- `PATCH /replay/:id/share { public: boolean }` — toggle the public flag.
  Player-only. Returns `{ ok: true, public: bool }`.

CORS `allowMethods` in `index.ts` now includes `PATCH`.

**Files touched:**
- `server/src/db/schema.sql` — schema block added
- `server/src/services/gameService.ts` — updateElo returns deltas;
  handleMatchProgress/resignGame save replays; ReplayView + getReplayById
  + setReplayPublic service helpers
- `server/src/services/lobbyService.ts` — `rematchLobby()` function
- `server/src/routes/lobby.ts` — POST /lobby/rematch
- `server/src/routes/replay.ts` — NEW file, GET + PATCH
- `server/src/index.ts` — registered /replay; added PATCH to CORS

**Typecheck:** 1 pre-existing error (`processAction` nextGameId — unrelated
to Phase 2, same as before my changes). 0 new errors introduced.

**Deferred:**
- Rate limits on `/replay/:id/share` (was a nice-to-have in the original
  prompt). No metrics yet to calibrate a threshold; add if abuse appears.
- 60s timeout on unaccepted rematches (UI-enforceable; server-side sweep
  is optional polish).
- Bo3 resign semantics — resigning currently ends just the game (not the
  match). Pre-existing gap, flagged in gameService.ts comment. Separate
  concern.

#### Open prompt for server agent (Phase 2 server, priority)

```
MP UX Phase 2 server work — post-game polish. Full plan context in
docs/HANDOFF.md under "End-to-end multiplayer UX improvement plan
(7 phases) → Phase 2." Phase 1 server work shipped in 35061e1; this
phase blocks GUI work for the game-over overlay.

Scope (4 items):

1. Widen game-finish payload with ELO delta. The game-finish flow in
   gameService.ts already computes the new rating via updateElo();
   surface { eloBefore, eloAfter, eloDelta } on the response so the UI
   can render "+12 ELO (1247 → 1259)" without a follow-up fetch. Add to
   the payload that GET /game/:id returns when status='finished', and
   to whatever Realtime broadcast tells clients the game ended. For
   unranked rotations (when the Phase 2 of the unranked-rotation
   handoff at end of HANDOFF lands — not yet), this should still return
   the trio with delta=0 so the UI can render "Unranked match" instead.

2. Auto-save MP replays. saveReplay() in packages/ui/src/lib/serverApi.ts
   exists but is dead code — never called. Server already reconstructs
   replays from game_actions, so this is metadata-only: when an MP
   game finishes, write a row to a `replays` table (or extend an
   existing one — look at server/src/services/gameService.ts for what
   already gets written) capturing { game_id, winner_player_id,
   turn_count, p1_username, p2_username, format, rotation,
   created_at }. Returns the replay id so the UI can build a share link
   /replay/:id. Idempotent — duplicate finish events shouldn't insert
   twice.

3. POST /lobby/rematch endpoint. Creates a new lobby with both decks
   pre-attached, marks lobbies.rematch_of (new uuid column referencing
   the previous lobby), and stores who lost so the next-game first-
   player assignment respects loser-picks-first (per locked design
   decision 2). Suggested shape:
     POST /lobby/rematch
     body: { previousLobbyId: string }
     auth: must be one of the two players from the previous lobby
     creates: new lobby, status='waiting_loser_choice', both decks
              loaded, code generated, loser_user_id set on the row
     returns: { lobbyId, code, loser_user_id }
   Then add a follow-up:
     POST /lobby/:id/loser-choice
     body: { firstPlayer: 'me' | 'opponent' }
     auth: must equal lobbies.loser_user_id
     transitions: status='active', creates the game with the loser's
                  chosen first-player assignment
   The 60s accept window from the plan can be enforced by the UI
   polling for transition; if you want server-side hard timeout, add
   an updated_at-driven cleanup on a future sweep.

4. Replay sharing access. Currently /replay/:id is locked to the two
   players via RLS on game_actions. Pick one:
   (a) Add a `replays.public: boolean` flag, default false, with an
       opt-in toggle exposed via PATCH /replay/:id/share. RLS
       widens to "player or public=true."
   (b) Always-public-via-link — anyone with the replay id can read.
       Lower friction but no opt-out for sensitive games.
   Recommendation: (a) — gives users control, future-proofs against
   ranked-replay scouting concerns. Default: opt-in private.

Schema additions needed (one migration block):
- lobbies: rematch_of UUID REFERENCES lobbies(id), loser_user_id UUID
  REFERENCES auth.users(id), status check constraint widened to allow
  'waiting_loser_choice'
- replays: new table with the metadata shape from item 2, plus public
  BOOLEAN DEFAULT FALSE for item 4

Rate-limit and abuse considerations:
- /lobby/rematch: only callable once per source lobby (uniqueness on
  rematch_of), prevents double-rematch grief
- replays.public toggle: rate-limit to N per hour per user

Out of scope for this session:
- The unranked-rotation `ranked: boolean` registry flag from the
  earlier HANDOFF entry — separate work, don't bundle.
- Phase 3 matchmaking queue — separate handoff incoming.
- GUI work (game-over overlay rendering) — gameboard-specialist's
  lane after this lands.

Validation: write the SQL migration in server/src/db/schema.sql with
ALTER TABLE ... IF NOT EXISTS guards (idempotent); document the SQL
the user has to run in Supabase in the commit message + a HANDOFF
DONE entry. Include curl snippets for the new endpoints so GUI can
test before any UI is written.
```

#### Open prompt for gameboard-specialist (Phase 2 overlay, blocked on server)

```
MP UX Phase 2 — game-over overlay enhancements. BLOCKED on server
work; spin up only after the Phase 2 server agent commit lands.
Server prompt is queued in HANDOFF.md. Full plan context in
docs/HANDOFF.md under "End-to-end multiplayer UX improvement plan
(7 phases) → Phase 2."

Scope (3 items, all on GameBoard's existing game-over overlay at
~lines 2174-2274):

1. ELO delta display. Server's game-finish payload now carries
   { eloBefore, eloAfter, eloDelta }. Render as:
     +12 ELO (1247 → 1259)   [green if delta > 0]
     -8 ELO (1259 → 1251)    [red if delta < 0]
     Unranked match           [gray if delta === 0 AND rotation is
                              flagged unranked — see HANDOFF for the
                              ranked: boolean follow-up; for now,
                              delta === 0 is just "no change"]

2. Share-replay button. Server's auto-save (Phase 2 server item 2)
   produces a replay_id; surface a "Share replay" button in the
   overlay that copies https://<domain>/replay/:id to clipboard.
   Toast on success ("Link copied"). For now, the share works because
   replays are saved opt-in private — the user has to click a
   separate "Make public" toggle (handled by the UI agent in a
   follow-up; this button just copies the link, the link only
   resolves for permitted viewers).

3. Rematch flow with loser-picks-first. Replaces the current
   "Play Again" / "Back to Lobby" buttons:
   - Both players see "Rematch?" button on game-over
   - First-clicker calls POST /lobby/rematch { previousLobbyId }.
     Server immediately creates the new lobby AND spawns game 1 of
     the rematch with the LOSER in player1 slot. Response: { lobbyId,
     gameId, code, myPlayerId }.
   - Both clients transition to /game/:newGameId (via Realtime or
     follow-up navigation)
   - The loser sees `choose_play_order` PendingChoiceModal (existing
     CRD 2.1.3.2 UI — no new modal needed), picks first/second
   - The winner sees the opponent-waiting variant of the same modal
     ("Opponent is choosing play order…")
   - On loser's choice resolving: game proceeds to mulligan

Important: the server rematch endpoint is ONE-SHOT — no separate
loser-choice endpoint. The loser's first/second pick flows through
the engine's existing `choose_play_order` mechanism (same as Bo3
games 2/3). You don't need a new Play/Draw radio in the game-over
overlay — that's handled in the game-start flow by the existing
PendingChoiceModal. All the overlay needs is the "Rematch" button.

Rematch is idempotent: both players clicking simultaneously converge
on the same lobby (server dedupes by `rematch_of`). So both
ButtonClick handlers can safely POST without racing.

Files:
- packages/ui/src/pages/GameBoard.tsx (the overlay)
- packages/ui/src/lib/serverApi.ts (add createRematch wrapper; PATCH
  replay/share already documented below in GUI-agent prompt — may
  already be done)

Solo / sandbox game-over flow stays as-is. This is MP-only.

Out of scope: replay public-toggle UI (UI agent's lane), the actual
replay viewer page (GET /replay/:id already works).
```

#### Open prompt for GUI agent (Phase 2 GUI, blocked on server)

```
MP UX Phase 2 GUI — replay-save toast + serverApi additions.
BLOCKED on Phase 2 server agent commit; spin up only after that lands.
Full plan context in docs/HANDOFF.md under "End-to-end multiplayer UX
improvement plan (7 phases) → Phase 2."

Lane split for Phase 2 (do not duplicate gameboard-specialist's work):
- Game-over overlay layout (ELO delta, share button, rematch flow) =
  gameboard-specialist (separate prompt above)
- This prompt = the underlying API wiring + non-overlay surfaces
  (toast, future "my replays" page)

Scope (3 items):

1. Replay-save toast in useGameSession.

   When an MP game finishes, the server (per Phase 2 item 2) writes a
   replay row and surfaces the replay_id on the game-finish payload.
   useGameSession should detect the transition (isGameOver flips true
   on an MP session, and the new payload includes a replay_id) and
   trigger a toast/notification with the format:

     "Replay saved — fb-{first 6 chars of replay_id}"

   Toast should auto-dismiss after ~5s, with a Click-to-copy affordance
   that puts https://<domain>/replay/{replay_id} on the clipboard.

   Reuse existing toast/notification infrastructure if any exists in
   the app; otherwise add a tiny inline toast (top-right, fixed,
   z-50). DO NOT trigger on solo / sandbox finishes — only MP. The
   isMP signal already lives in useGameSession.

   Files:
   - packages/ui/src/hooks/useGameSession.ts (detection + emit)
   - Possibly a new packages/ui/src/components/ToastContainer.tsx if
     no toast infra exists

2. serverApi additions for replay sharing.

   Add wrappers around the new server endpoints (per Phase 2 server
   items 2 + 4):

     // Returns the replay metadata so the UI can show "shared by X"
     // headers, etc. on /replay/:id pages.
     export async function getReplay(replayId: string): Promise<Replay | null>

     // Toggle replay.public — only callable by the two players from
     // the game. Server returns 403 otherwise. Used by the
     // gameboard-specialist's overlay UI for the "Make public"
     // checkbox next to the Share button.
     export async function setReplayPublic(
       replayId: string,
       isPublic: boolean,
     ): Promise<{ ok: true } | { ok: false; error: string; status: number }>

   Export a Replay interface matching whatever the server returns
   (see server's Phase 2 commit for the metadata shape — likely
   { id, gameId, winner, turnCount, p1Username, p2Username, format,
   rotation, public, createdAt }).

   Files:
   - packages/ui/src/lib/serverApi.ts

3. (Deferred — capture as TODO comment, not in this session)

   "My replays" page at /replays — list of all replays the user is in
   (player1 or player2), with public/private toggle, share link copy,
   delete option. Useful once a few games are recorded but not
   blocking. Capture as a comment in serverApi.ts referencing the
   future use of getReplay() + a yet-to-write listMyReplays().

Out of scope:
- Game-over overlay rendering — gameboard-specialist
- /replay/:id viewer page — already works (App.tsx route exists, server
  reconstructs from game_actions)
- Anything in Phase 3 (matchmaking queue) or later

Validation:
- Two-account browser test: complete an MP game in two windows, both
  see the replay-save toast within ~1s of game-over. Click copy →
  paste in a third browser window → /replay/:id loads (after toggling
  public via the gameboard overlay button if private is still default)
- typecheck stays clean for new code (pre-existing
  exactOptionalPropertyTypes errors per CLAUDE.md don't count)
- Server's auto-save is idempotent — multiple finish events (Realtime
  reconnect during game-end frame) shouldn't fire multiple toasts
  client-side; gate the toast on a useRef "alreadyToasted" flag scoped
  to the current gameId
```

### Phase 3 — Matchmaking queue (user's priority test target)

Agent splits:
- **server agent**: `matchmaking_queue` table + pairing logic (inline on
  INSERT + poll-based safety net), `matchmaking_results` push, band-
  widening (`±50 → ±150 → ±400 → unbounded` over 90s), rate limit
  (10 queue-joins/hour). Routes: `POST/GET/DELETE /matchmaking`. ~half-day.
- **GUI agent** (me): "Find Match" card added alongside Host/Join in
  `MultiplayerLobby`; queue-wait screen with timer + widening-band hint +
  cancel; auto-redirect to `/game/:id` on pairing via Realtime subscribe
  to the user's `matchmaking_results` row.

Sequence: server first (queue is worthless without pairing); UI follows.

User's test scenario: main account + incognito account, both click "Find
Match" with compatible format decks within 10s → both land in same
`/game/:id` within ~3s of the second queue-join.

### Phase 4 — Reconnection + resume hardening

Agent splits:
- **server agent**: `lobbies.last_heartbeat` column, `PATCH /lobby/:id/
  heartbeat` endpoint, abandoned-lobby detection (stale > 60s →
  `status='abandoned'`), mid-game dropout tracking + `POST /game/:id/
  claim-win` with 2-min opponent-disconnect precondition.
- **GUI agent** (me): heartbeat loop in `MultiplayerLobby` while waiting;
  stale-lobby error surfacing; `mp-game` localStorage redirect to
  `/replay/:id` when game finished while tab was closed.
- **gameboard-specialist**: connection banner (reads the already-exposed
  `connectionStatus` from `useGameSession`); opponent-dropout countdown +
  claim-win button UX.

Sequence: server + both UI agents mostly parallel; gameboard-specialist
can start on the banner today since `connectionStatus` already exists.

### Phase 5 — Friends + rich presence (greenfield, largest non-spectator)

Agent splits:
- **server agent**: `friends` table + RLS, `profiles.last_seen_at` +
  `current_activity` columns, heartbeat endpoint, friend request /
  accept / reject / unfriend endpoints, `GET /profile/search?q=username`
  prefix search, `POST /lobby/invite` with `invited_user_id` on lobby
  row.
- **GUI agent** (me): new `/friends` page (friend list with presence +
  activity + "Challenge" button), notification bell in app header
  (extend existing chrome), profile viewing page with "Add friend"
  affordance, invite-by-username flow in `MultiplayerLobby`.

Sequence: server first (schema + endpoints); UI follows. Heartbeat loop
wires into the presence column via `PATCH /profile/heartbeat` every 30s.

### Phase 6 — Emoji reactions (ephemeral)

Agent splits:
- **server agent**: rate-limit middleware on the reactions channel (10
  reactions/minute/user/game) — no table, no schema change. The
  broadcast itself is a Supabase Realtime channel the server can police.
- **GUI agent** (me): `EmojiPicker` component; wire emit via
  `useGameSession`'s existing Realtime channel. 12-emoji curated set.
  Client-side throttle 1 per 3s as UX guard.
- **gameboard-specialist**: render incoming reactions on the board
  (3s float + fade over sender's side). Reads broadcast events from the
  game channel.

Sequence: GUI + gameboard-specialist can develop in parallel against a
mock broadcast; server rate-limit added last if abuse shows up in testing.

### Phase 7 — Spectator mode (greenfield, largest overall)

Agent splits:
- **server agent**: `game_spectators` table, RLS extension on `games` +
  `game_actions` to allow spectator reads per `spectator_policy`, extend
  `stateFilter.ts` to `filterStateForSpectator(state, viewingAs)` with
  per-side fog-of-war, routes `POST/DELETE /game/:id/spectate` +
  `GET /games/watchable` (public + friends' games). **Anti-cheat
  invariant test required**: a spectator viewing game as player1 sees
  EXACTLY player1's filtered state, never aggregate.
- **gameboard-specialist**: GameBoard spectator-mode variant — no action
  buttons, "Spectating — viewing as {playerX}" banner, "Swap POV" button,
  leave button. Spectator count badge (`👁 N watching`) for players.
- **GUI agent** (me): new `/spectate` page with "Public games" +
  "Friends' games" sections; [Watch] button on public-lobby browser
  (from Phase 1); pre-game policy picker for private lobby creation
  (4 options: public / friends / invite_only / off).

Sequence: server first (filter + routes + RLS); gameboard-specialist +
GUI in parallel on the UI. Dependency on Phase 5 for friends' games
section only — public games section can ship without it.

### Future follow-up entries (not in this plan)

- **Chess-clock / per-turn timers** — needs dedicated planning session.
  Engine + server + UI. Discussion points: per-turn budget vs total match
  budget, pause conditions, timeout-loss rules, engine integration.
- **Replay highlight reels** — requires persisting emoji reactions with
  timestamps to a new `game_reactions` table (NOT `game_actions`). Only
  pursue if Phase 6 reactions become heavily used.
- **True MMR queue tuning** — Phase 3 ships the infrastructure; tuning
  band-widening curves, queue-depth display, region-based matching all
  live in a future phase once real usage data exists.

---

## FROM gameboard-specialist → engine-expert + server-specialist: persist GameEvent stream + decision metadata for bot post-analysis

**Status (2026-04-25):** ✅ engine-side done. ✅ server-side schema + plumbing
done — see follow-up note immediately below. ✅ migration applied to live
Supabase (user ran the two `ALTER TABLE` statements 2026-04-25 before this
commit landed); subsequent server deploys will populate the new columns
from the first action onward.

### Server-side resolution (2026-04-25)

Schema migration (`server/src/db/schema.sql`):
- `ALTER TABLE game_actions ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'`
- `ALTER TABLE game_actions ADD COLUMN IF NOT EXISTS legal_action_count INTEGER` (nullable)
- Idempotent — safe to re-run. Existing rows get `events='[]'` from the
  default; no separate backfill script needed (historical games predate
  the trainer anyway).

Plumbing (`server/src/services/gameService.ts:processAction`):
- Added `getAllLegalActions` import from `@lorcana-sim/engine`.
- Snapshot `legalActionCount` BEFORE `applyAction` — `null` when
  `state_before.pendingChoice` is set (engine returns `[]` in that case
  because choice-value enumeration is context-dependent), else the
  cardinality of the legal-action set. Encoded distinctly so the trainer
  can tell "no enumeration available" from "literally zero options."
- `events: result.events` written verbatim from `ActionResult` into the
  insert. The cascade-attributed cause field (`primary` / `trigger` /
  `replacement`) flows through unchanged because it's part of the
  GameEvent type the engine emits.
- `resignGame` is unchanged — resignations don't go through `applyAction`
  and don't write `game_actions` rows, so they have nothing to persist.

Audit invariant (commented in `schema.sql`):
- A SQL probe that should return zero rows post-deploy: any `PLAY_CARD` /
  `QUEST` / `CHALLENGE` row with `jsonb_array_length(events) = 0` is a
  silent emit-site drop in the engine. Companion probe checks
  `legal_action_count IS NULL` for non-RESOLVE_CHOICE actions.

What's NOT covered by this PR (out of scope, mentioned for clarity):
- Solo / sandbox games still don't write `game_actions` (MP-only path).
  Schema is now ready for it whenever clone-trainer wants solo data.
- The ~40 `moveCard`-direct sites in the engine that bypass `card_moved`
  emission — engine-expert flagged that as a follow-up; the high-signal
  events are already covered.

### Original handoff (kept for context)

Engine work that landed:
- Verified plumbing — same `events: GameEvent[]` array threads from
  `applyAction()` entry through every internal subroutine and back to
  `ActionResult.events`. No accumulator drops. (`packages/engine/src/engine/reducer.ts:82-204`.)
- Added cascade attribution: new `cause?: "primary" | "trigger" | "replacement"`
  field on `GameEvent`. `processTriggerStack` stamps every event emitted during
  bag drainage with `cause: "trigger"`; events emitted directly from the
  dispatched action keep `cause` undefined (consumers interpret as `"primary"`).
  Implementation is wrapper-based (one start-index snapshot at function entry,
  one stamp-suffix loop at exit), so it didn't touch any of the ~50 emit sites.
  `replacement` is reserved for the future CRD 6.5 implementation. See
  `packages/engine/src/types/index.ts` (GameEventCause + intersected GameEvent
  shape) and `packages/engine/src/engine/reducer.ts:processTriggerStack`.
- Two regression tests in `reducer.test.ts > §Engine — GameEvent stream …`:
  smoke check that PLAY_CARD/QUEST emit non-empty events, and a Mickey
  Giant + Pluto cascade scenario confirming primary vs trigger attribution.

Known gap left for follow-up (NOT a blocker for the server work):
- ~40 sites in `reducer.ts` call `moveCard()` directly (vs `zoneTransition`),
  so they bypass the `card_moved` event emit. Examples: most tutor / search
  / deck-shuffle paths. Doesn't affect the high-signal events
  (`damage_dealt`, `lore_gained`, `card_banished`, `ability_triggered`,
  `card_revealed`, `card_drawn`, `turn_passed`) — those are emitted from the
  central paths. Backfill emit sites can be added incrementally if/when the
  trainer wants per-zone-transition granularity. Three internal helper
  functions (`performMove`, `applyBoostCard`, the `parentIds` dist helper at
  ~line 8005) take a `_events: GameEvent[]` param they don't use — those are
  the natural next emit sites if/when card_moved coverage matters.

Discovered 2026-04-25 during a record-keeping audit comparing the UI
game log, the engine GameEvent stream, and server-side `game_actions`.
Three surfaces overlap incompletely; one is being thrown away.

### The audit findings

| Surface | Granularity | Persisted? | Where | Consumer |
|---|---|---|---|---|
| `actionLog` (`GameLogEntry[]`) | Per-action human-readable string | Yes — in `GameState` | `packages/engine/src/types/index.ts:3853`, populated via `appendLog()` in `packages/engine/src/utils/index.ts:797` | UI narrative only |
| `GameEvent` stream (`ActionResult.events[]`) | Per-state-mutation struct | **No — transient** | `packages/engine/src/types/index.ts:3999`, returned by `applyAction()` | UI animations/sounds, then garbage-collected |
| `game_actions` table | Per-action + full state before/after | Yes (MP only) | `packages/server/src/db/schema.sql:41-50`, written in `gameService.ts:174-181` | Clone trainer (planned), replays, audit |

**The orphan is the `GameEvent` stream.** Every `applyAction()` call
emits a sequence of typed events — `card_moved`, `damage_dealt`,
`lore_gained`, `ability_triggered`, `card_revealed`, `hand_revealed`,
`turn_passed`, `card_drawn`, `card_banished`. These are exactly the
"things that happened during this action" that downstream analysis
wants. The UI consumes them for the next render frame, then they vanish.
Server never sees them.

### What's missing for high-quality bot post-analysis

Listed by addressability:

**Genuine data loss (only fixable by persisting events):**
1. **Cascade attribution.** "Did the user banish that character, or did
   their own triggered ability banish it as a side effect?" `game_actions`
   only records the user-dispatched action. The actual chain — challenge
   resolves → on-banish trigger → banish-other-character — is reconstructable
   only from the event stream.
2. **Hidden-information reveals.** `card_revealed` / `hand_revealed`
   events carry `privateTo` annotations. Currently `gameService` filters
   state per-player on read, but the per-event reveal log is gone, making
   it hard to audit "what did the bot actually see at decision time" vs
   what the underlying state contained.
3. **Effect granularity.** `card_moved { from: "deck", to: "hand" }`
   distinguishes "drew this card" from "tutored this card from deck" vs
   "discarded then returned." A state-diff between before/after can't
   reliably reconstruct the path.

**Already in the data, just not denormalized:**
4. **RNG sequence.** `state.rng.s` is in `state_before` and `state_after`,
   so RNG progression is recoverable. Worth verifying the seed is captured
   at game start (there's a `games.seed` column already per
   `packages/server/src/db/schema.sql`).
5. **Counterfactual states.** "What if bot had picked legal action #6
   instead of #5?" Computed on demand from `state_before` + `applyAction`.
   Don't denormalize — storage cost would be `state_size × N legal actions
   per row`, which is huge.
6. **Legal-action set at decision time.** Not stored, but recoverable by
   re-running `getAllLegalActions(state_before)`. Cheap to add as a
   denormalized column for analysis convenience (see below).

### Proposed change

#### Engine (small)

The events are already emitted. No change to event production. Just
make sure the `events: GameEvent[]` array on `ActionResult` is fully
populated before return — confirm no events are dropped between the
internal reducer-step accumulator and the public return type.

Optional but useful: add `event.cause` field tagging events as
`"primary" | "trigger" | "replacement"` so cascade attribution is
explicit instead of implied by event order. This would make trainer
feature-extraction much simpler. Can defer if it touches too many
emit sites.

#### Server (primary work)

Two schema changes to `game_actions`:

```sql
ALTER TABLE game_actions
  ADD COLUMN events JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN legal_action_count INTEGER;
```

- `events`: the `GameEvent[]` array from `ActionResult.events`. Stored
  as JSONB for query flexibility. ~5-30 events per action × 50-200 actions
  per game = ~500-6000 events per game; rough storage estimate ~50-200KB
  per game JSON-encoded. Acceptable.
- `legal_action_count`: number of legal actions available at
  `state_before` time. One integer per row. Surfaces "decision difficulty"
  without needing to replay. Useful for trainer batch sorting (hard
  decisions get more weight) and analytics queries ("avg branching
  factor at turn N").

`gameService.ts:174-181` becomes:

```ts
const result = applyAction(state, action, definitions);
if (!result.success) return { error: result.error };
const legalActions = getAllLegalActions(state, definitions);
await db.insert("game_actions", {
  game_id, player_id, turn_number,
  action,
  state_before: state,
  state_after: result.newState,
  events: result.events,                  // NEW
  legal_action_count: legalActions.length, // NEW
});
```

Backfill is unnecessary — historical games predate the trainer, and
the column has a `DEFAULT '[]'` so existing rows stay valid.

#### Solo / sandbox

Currently solo play doesn't write `game_actions` (it's MP-only). For
clone-trainer data quality we may want to optionally log solo-vs-bot
games too — punt that decision to a follow-up entry, just leave the
schema ready for it.

### What does NOT need to change

- **`actionLog` (`GameLogEntry[]`)** — leave as-is. It's a UI artifact for
  player-facing narrative. Don't try to make it serve double duty.
- **GameEvent type definitions** — already complete enough. Adding `cause`
  is optional polish.
- **No new tables.** The two columns on `game_actions` cover everything.

### Tests

- **Engine** (existing test files):
  - `applyAction()` returns `events.length > 0` for every PLAY_CARD,
    QUEST, CHALLENGE, RESOLVE_CHOICE in a smoke-test game.
  - Cascade scenario (e.g., banish-trigger): events array contains
    BOTH the primary banish AND the cascading trigger, in order.
- **Server**:
  - `game_actions.events` is non-empty for every action row after a
    test game. Round-trip: read row, parse events, verify it matches
    the `applyAction()` return shape.
  - `legal_action_count` matches `getAllLegalActions(state_before).length`
    for sampled rows.
- **No UI test needed** — UI doesn't read these new columns yet.

### Audit improvement

Per CLAUDE.md bug-fix workflow rule. Add a check to verify every
`game_actions` row written post-deploy has non-null `legal_action_count`
and non-empty `events` for non-trivial actions (PLAY_CARD, QUEST,
CHALLENGE). Could live as an integration-test invariant or a periodic
sanity query in the server health endpoint.

### Scope

- Engine: ~30 min if no `cause` field, ~2-3h with `cause` (touches every
  emit site)
- Server: ~1h (migration + service-method update + tests)
- Total: half a day for engine + server, ships separately, no UI work
- Unblocks: clone-trainer feature extraction, replay UI improvements,
  per-turn analytics queries

### Why now

We don't have the trainer yet, but the event stream is being thrown
away on every action right now. Persisting it before the trainer ships
means we'll have a usable training corpus from day one of MP play
instead of needing to wait for post-trainer data accumulation. Two
schema columns is the cheapest way to capture work the engine is
already doing.
