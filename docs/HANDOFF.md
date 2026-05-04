# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Last reorganized: 2026-04-25 (5 DONE items deleted, 7 parked-decision items moved to `docs/BACKLOG.md`).

## Runbook: new CRD revision arrives — diff snapshot & update tracker

**Trigger:** Ravensburger publishes a new Comprehensive Rules PDF (any agent
notices, or the user drops a new file into `docs/`).

**Owner:** any agent (engine-expert preferred since most rule changes affect
the engine layer; reducer.ts citations and `CONDITION_GATED_EFFECTS` are
common targets).

**Why this exists:** the CRD is a living document. Side-by-side PDF
comparison is unworkable for a 100+ page rulebook. We keep a committed
plain-text snapshot (`docs/CRD_SNAPSHOT.txt`) so revisions become a
line-level git diff. Pipeline shipped 2026-05-01 (commit `a769cd5`).

**Pieces (all in tree):**
- `scripts/snapshot-crd.ts` — converts the latest
  `docs/Disney-Lorcana-Comprehensive-Rules-*.pdf` to text via
  `pdftotext -layout`. Self-documenting header captures source PDF,
  detected version, effective date, snapshot timestamp, line count.
- `docs/CRD_SNAPSHOT.txt` — current snapshot of v2.0.1 (Effective Feb 5,
  2026), 2173 lines. Replaced wholesale on each revision.
- `docs/CRD_TRACKER.md` — top-of-file "Diffing a new CRD revision" section
  documents the workflow inline. The body of the tracker is the rule-by-rule
  status map; that's what gets updated based on the diff.
- `pnpm snapshot-crd` — package.json shortcut.

**Workflow when a new CRD drops:**

1. **Drop the new PDF** into `docs/` with the canonical filename pattern
   `Disney-Lorcana-Comprehensive-Rules-<MMDDYY>-EN-Edited.pdf`. The
   snapshot script picks the lexicographically-latest filename, so date-
   suffixed names sort correctly. Keep or delete the old PDF — either
   works.

2. **Regenerate the snapshot:**
   ```bash
   pnpm snapshot-crd
   ```
   Requires the `pdftotext` binary (Poppler / Glyph & Cog — included in
   mingw64; macOS: `brew install poppler`; Linux: `apt install
   poppler-utils`). The script prints version, effective date, line
   count, and the diff command on stdout.

3. **Review the diff:**
   ```bash
   git diff docs/CRD_SNAPSHOT.txt
   ```
   The `-layout` flag preserves columns/indentation, so section numbers
   and nested rule numbering stay aligned across revisions — every
   changed rule shows up as a line-level diff with its section context.
   Walk top-to-bottom and categorize each change:

   | Diff type | Action |
   |---|---|
   | New rule | Add a row to `CRD_TRACKER.md` under the right section |
   | Wording revision | Update the existing row's `Quote` column; re-evaluate `Status` if engine semantics may have shifted |
   | Status reclassification (errata) | Flip the engine row to `🐛` until reimplemented; ship a fix; flip back to `✅` |
   | Renumbering | Search `packages/engine/src/` for the old citation (e.g. `// CRD 8.9.1`), update to the new number |

4. **Update the version line** at the top of `CRD_TRACKER.md` (line 2):
   `# Disney Lorcana Comprehensive Rules v<NEW> (Effective <DATE>)`.
   If anything in `CLAUDE.md` → "Critical bug patterns" cites a moved
   rule number, update there too.

5. **Commit both** the new PDF and the regenerated snapshot together so
   the diff history shows the source-of-truth swap atomically. Suggested
   commit message format:
   ```
   chore(crd): snapshot v<NEW> (Effective <DATE>) + tracker updates

   Drops PDF → regenerated docs/CRD_SNAPSHOT.txt. Tracker changes:
   - <section X.Y>: <what changed>
   - ...
   ```

**Header lines** (prefixed with `#`) in CRD_SNAPSHOT.txt document
provenance; they produce a one-line diff if you re-snapshot the same PDF
on a new day. That's intentional — they let you read the snapshot
standalone. Use `git checkout docs/CRD_SNAPSHOT.txt` to discard a
spurious re-snapshot if the PDF didn't actually change.

**Sanity check after the swap:**
- `pnpm test` — engine tests should still pass (most rules don't have
  test coverage, but new bugs in renumbered citations would surface as
  test failures if a test referenced a moved rule by number).
- `grep -rn "CRD <OLD-NUMBER>" packages/engine/src/` — verify no stale
  citations to renumbered rules remain.

---

## Companion docs

| Doc | Purpose | When something belongs here vs HANDOFF |
|---|---|---|
| `docs/ROADMAP.md` | Committed sequenced product plan | "We're building this, in this order, for these reasons." |
| `docs/HANDOFF.md` *(this doc)* | Active cross-agent work queue | Another agent type needs to pick this up next. |
| `docs/BACKLOG.md` | Parked ideas / deferred design decisions | We considered it, didn't ship, have a trigger to revisit. No agent ownership yet. |

If the item has trigger conditions but no current agent owner → BACKLOG.
If a specific agent type is supposed to do it → HANDOFF.
If it's part of the sequenced plan → ROADMAP.

## Conventions

- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).
- Items marked `[DEFERRED]` for >2 weeks should probably move to BACKLOG.

---

## ~~Engine agent: cross-set wiring bugs surfaced by 2026-04-30 decompile sweep~~ ✅ MOSTLY DONE 2026-04-30

After the renderer-cleanup pass (commits 6c0e68c → f46183b raised avg
decompile similarity from 0.80 to 0.84), the bottom of the sorted output
is now mostly real wiring bugs rather than renderer noise. 13 of 15
items resolved across commits f46183b, f19eeab, 0856a20.

### Resolved

| Card | Set/# | Resolution |
|------|-------|-----|
| Mr. Incredible - Super Strong | 12/127 + 226 | ✅ FIXED f46183b — added perMatch:2 |
| Yao - Snow Warrior | 11/73 | ✅ FIXED f19eeab — added not(is_your_turn) condition |
| Sudden Scare | 10/164 | ✅ FIXED f19eeab — added 2nd put_into_inkwell with target:opponent, fromZone:deck |
| Launchpad - Trusty Sidekick | 11/177 | ✅ FIXED f19eeab — rewrote as activated {E}, added discard condition support |
| Alice - Tea Alchemist | 3/35 | ✅ FIXED f19eeab — added second exert with nameFromLastResolvedTarget filter |
| Like A Bird In the Sky | 12/131 | ✅ FIXED f19eeab — added grant_keyword:evasive on last_resolved_target |
| Evil Comes Prepared | 5/128 | ✅ FIXED f19eeab — fixed followUp target + added new condition last_resolved_target_has_trait |
| The Queen - Jealous Beauty | 7/74 | ✅ FIXED — was correctly wired (gainLoreBase/Bonus/bonusFilter); renderer now emits the bonus clause |
| Grumpy - Skeptical Knight | 5/186 | ✅ FIXED — was correctly wired (atLocation:"any"); renderer now emits "at a location" qualifier |
| Belle's House - Maurice's Workshop | 3/168 | ✅ FIXED — was correctly wired (cost_reduction static); renderer now emits ongoing phrasing for static cost_reduction |
| Hades - Looking for a Deal | 10/56 | ✅ FIXED — was correctly wired (gain_stats +0 is a no-op chooser); renderer now suppresses all-zero stat clauses |
| Lilo - Escape Artist | 6/2 | ✅ FIXED 0856a20 — was correctly wired (target:this); renderer now emits "play this character from your discard" |
| Elsa's Ice Palace - Place of Solitude | 5/67 | ✅ FIXED 0856a20 — was correctly wired; renderer now substitutes "this location" via cardType ctx |
| Rex - Protective Dinosaur | 12/10 | ✅ FIXED 0856a20 — was correctly wired (filter:isSelf); renderer now emits "When this character is banished" for isSelf:true |
| Goliath - Clan Leader | 10/173 | ✅ FIXED — was correctly wired (fill_hand_to handles both directions); renderer now emits both branches |

### Resolved (2026-04-30 follow-up — user pointed out existing precedents)

| Card | Set/# | Resolution |
|------|-------|-----|
| Magica De Spell - The Midas Touch | 3/49 | ✅ FIXED ae9291f — Lucky Dime pattern (self_replacement + stat_ref from:target property:cost, item filter). User flagged: "should be like Lucky Dime except just passed a different value." |
| One Last Hope | 4/197 + 9/197 + 9/222 | ✅ FIXED ae9291f — all 3 reprints (same id) wired identically with the Hero clause now. Added action-effect form of can_challenge_ready with optional duration + condition. User flagged: set-9/197 was actually One Last Hope (not Stand By Me as I mislabeled), and set-4/197 is the original printing. |

### Renderer issues (low priority — JSON is correct)

These score low but the wiring is fine; renderer just doesn't render the
shape cleanly. Fix when convenient or accept as cosmetic:

- **Bill the Lizard NOTHING TO IT** (8/90) — "while ANOTHER character has damage" → "While you have other character with damage in play" (word order)
- **Belle Bookworm** (2/71) — "an opponent has no cards" → "one or more opponents have no cards in their hands" (renderer plurality)
- **Tiana's Palace** (3/34) — "Characters can't be challenged while here" → "all characters here can't be challenged" (style)
- **Hera Queen of the Gods** (4/76) — multi-static with named-character grants renders fine; oracle has Ward keyword reminder, may benefit from grouping
- **Aladdin Barreling Through** (10/123) — keyword reminders + ONLY THE BOLD render fine; oracle wording differs slightly
- **Mor'du Savage Cursed Prince** (12/57) — "exert all" missing "all" prefix; "at the start of your turn" condition not in rendered wording
- **Zipper Big Helper** (12/150) — `+this character's {W} {S}` for "may add his {W} to another's {S}" — works semantically, awkward render
- **Wreck-It Ralph Demolition Dude** (5/104) — "for each 1 damage on him" → "equal to the damage on them" (semantic match, different phrasing)
- **Fa Zhou Mulan's Father** (4/105) — "She can't quest" rendered as "they can't quest" (pronoun; correct)
- **Light the Fuse** (8/149) — "Deal 1 damage to chosen character for each exerted character" → "deal damage equal to the number of your exerted characters to chosen character" (semantic match, awkward render)
- **Diablo Devoted Herald** (4/70) — alt-cost shift renders as "Shift 0 {I}" — needs to read shiftDiscardCost / altShiftCost

---

## Engine agent: Syndrome - Out for Revenge `play OR shift` branch missing

Set 12 #172 GOT ME MONOLOGUING! oracle: "Whenever this character quests,
return a Robot character card from your discard to your hand. Then, you
may **play or shift** a Robot character with cost 8 or less for free."

Current wiring (`card-set-12.json:12569-12586`) only implements the **play**
branch via `play_card` with `isMay: true, sourceZone: "hand"`. The
**shift** branch — paying the shift cost on top of an existing Robot in
play — is silently missing. Affects Syndrome itself (set-12/#172) and the
foil reprint (set-12/#239 area, around line 17500).

No engine primitive currently models "play OR shift for free." Two
shapes worth considering:
1. Extend `play_card` with `allowShift?: boolean` so it surfaces both
   options when active. Cleanest if shift-onto integrates into the
   existing play_card chooser.
2. New `play_or_shift_card` effect that wraps both alternatives in a
   `choose` combinator. More verbose JSON but no engine refactor.

No precedent — `grep -rn "play or shift" packages/engine/src/cards/` returns
only this card. Likely a one-card mechanic; option 2 may be sufficient.

Not blocking — the play-from-hand half works. Players miss the shift
option entirely until this is resolved.

---

## Shareable MP replays — finish the UX

**Discovery context (2026-05-01):** while wiring the sandbox state filter, the user asked what's needed for shareable MP replays. Audit showed most plumbing was already built — Phase 2 of the MP UX plan had shipped the server side on 2026-04-22 (replay auto-save, share endpoint, public flag, route + auto-fetch wired). The work split into four phases:

- **Phase A — Server-side per-viewer filtering.** ✅ DONE 2026-05-01 (commit `937fbb8`). Server reconstructs + filters per perspective; access matrix at `decideReplayAccess` in `server/src/services/gameService.ts`. 21 unit tests.
- **Phase B — Client refactor + perspective toggle.** ✅ DONE 2026-05-01 (commit pending alongside C). `useReplaySession` accepts discriminated union `{ kind: "local" | "remote" }`; `serverApi.getGameReplay` returns the new `ReplayMeta` shape; `getSharedReplay` (public-or-player) + `setReplayPublic` (PATCH) added; new `/replay/share/:replayId` route registers `SharedReplayPage`; replay banner has perspective toggle (P1/P2/Spectator) with affordance gating per the access matrix.
- **Phase C — Share UI on game-over overlay + privacy chrome.** ✅ DONE 2026-05-01 (commit pending alongside B). Share button + inline confirm flow on game-over overlay (3-button tertiary row when MP+download both apply); privacy chip on replay banner (player click toggles public + copies link; non-player sees read-only "Public replay" badge).
- **Phase D — "My Replays" browse list.** ✅ DONE 2026-04-29. New `/replays` route + tab + `ReplaysPage` component. Server endpoint `GET /replay/list?user=me&limit=50&offset=0` (registered before `/:id` so Hono's path-matching catches the literal segment). Returns `{ replays: ReplayListItem[]; total }` — lightweight metadata (no state stream / decks). Each row stamps `callerIsP1` server-side so the UI doesn't need raw player IDs to compute "your view" winner / opponent. UI renders W/L badge + opponent + format chip + privacy chip + relative timestamp + turn count; "Load more" pagination. Empty state links to `/multiplayer`. Public-replay browser still deferred until usage data shows public sharing happening.

The active anti-cheat leak (player reviewing their MP game saw opponent hand history) was closed by Phase A. Phase B+C make the existing PATCH /replay/:id/share endpoint reachable from the UI and add the perspective toggle that completes the filter UX.

### Phase D follow-ups (still open)

Phase D shipped the "My Replays" browse list (route, server endpoint, tab). Two related items remain parked:

1. **Public browser** at `/replays/public` — paginated list of public replays. Server endpoint shape would be `GET /replay/list?public=true&limit=50&sort=recent|turn-count`. **Defer** until usage data shows public sharing is happening; otherwise it'll be an empty page.
2. **Profile screen integration** — link "View replays" on each profile page to `/replays?user=<userId>` (server endpoint already gates on `user=me` only; widening to other users requires the public-browser policy decision first).

Out of scope until those trigger: explicit replay search, replay tagging, replay annotations, replay clipping (Creator tooling track in BACKLOG).

### Known follow-up gaps from Phase B/C (worth a small follow-up commit)

1. **`callerSlot` detection in `App.tsx → metaToRemoteReplay`** is hardcoded to `null` because `ReplayMeta` doesn't carry player IDs (only usernames). Effect: a player visiting their own MP replay via direct `/replay/:gameId` URL gets reduced affordances — no privacy chip toggle, perspective toggle behaves as if anonymous. Server already knows the caller's slot when responding; cleanest fix is to add an optional `callerSlot?: "p1" | "p2" | null` to `ReplayMeta` and stamp it in `buildReplayView`. Then the UI flips both helpers (App.tsx + GameBoard.tsx) to read from the response. The MP game-over Review path is unaffected (callerSlot is sourced from `multiplayerGame.myPlayerId`).
2. **Privacy chip + share button only render when `mpReplay` is non-null** (the auto-fetched MP context state). They don't render when reviewing via `/replay/:gameId` direct URL or `/replay/share/:replayId`. Once #1 lands, the chip should also work in those paths — the `replayInput.data.replayId` is already present, just need to refactor `handleSharePublic` / `copyShareLink` to read from `replayInput.data.replayId` rather than `mpReplay.replayId`.

### Decisions locked
- Don't expose raw `seed + actions` to private viewers, even with a "I'll filter client-side, promise" contract. Determined cheats just disable the wrap. The Phase A reconstruct-server-side decision is the only architecturally sound shape.
- Don't filter the action stream itself. Some action args inherently carry private info (chosen card from a private peek) that's load-bearing for replay correctness. Filter the *state* (already pure), not the *action* (impure, breaks reconstruction).
- Don't bundle "spectator mode" (live in-game watching) into this work. Different threat model (in-progress game info leaks differently — opponent's hand at decision time rather than post-hoc), different latency requirements. Park it as a follow-up if Phase A's reconstructor pattern proves performant.

---

## Engine agent: opening hands drawn before play/draw decision violates CRD 2.1.3 → 2.2 ordering

**Symptom (user-reported 2026-05-01):** When the choose-play-order modal is up, both players can already see their opening hand. Per CRD 2.1.3 (set-up) → 2.2 (drawing opening hands), the play/draw decision happens FIRST, then each player draws 7. Today the engine deals hands at game-start before showing the modal, which means:
- The decision-maker can scout their own hand before deciding play vs draw (small competitive impact — knowing your hand should not influence play/draw under CRD ordering).
- The non-decision-maker watches the modal with a full hand visible, suggesting the game has already "started."
- A latent reveal vector via replay reconstruction — the pre-modal state has hands populated and would surface in any neutral-perspective public replay scrub at step 0.

**Bug location:** `packages/engine/src/engine/initializer.ts:248-289`. `createGame` calls `dealOpeningHands(state, handSize)` at line 249, then sets the `choose_play_order` PendingChoice at line 279-286. Order is reversed from CRD.

**Fix path:**

1. **Remove the `dealOpeningHands` call from `createGame`** (`initializer.ts:249`). Initial state should have `zones.player1.hand = []` and `zones.player2.hand = []`. Also drop the opening-hand log-stamping block at `:251-274` — that gets stamped AFTER the deal, which now moves.

2. **Deal hands inside the `choose_play_order` resolution branch in the reducer** (`reducer.ts:2262-2272`). After setting `firstPlayerId` and `currentPlayer` (lines 2267-2271) but BEFORE the `phase: "mulligan_p1"` block (lines 2286-2294):
   - Call `dealOpeningHands(state, handSize)` (export it from `initializer.ts` if not already). `handSize` needs plumbing — engine currently doesn't carry it past `createGame`. Cleanest: stamp `_handSize: number` on initial state in `createGame` (similar to how `_matchScore` lives on state), then read it in the resolve path.
   - Stamp the per-player opening-hand log entries (the block currently at `initializer.ts:251-274`).
   - Build `mulliganHandIds` from `state.zones[startingPlayerId].hand` AFTER the deal, not before (currently line 2285).

3. **Update test helpers** (`engine/test-helpers.ts`). Tests that bypass via `injectCard` and set up their own hand state are unaffected. Tests that call `startGame()` and expect hands populated immediately should be updated — preferred fix: have `startGame` resolve `choose_play_order` automatically (most tests don't care about the play/draw decision; they want a started game with hands). Tests specifically about the play-order flow can opt into the unresolved state via a flag.

4. **Update CRD citation comments**. `initializer.ts:276-278` already cites CRD 2.1.3.2 / 2.2.2 — keep them, just move the citation with the relocated logic.

**Out of scope:**
- Mulligan ordering (CRD 2.2.2) is already correct — starting player mulligans first.
- The "starting player coin flip" is server-side (assigns `chooserPlayerId`); engine doesn't need to change there.

**Server impact:** None. Engine's `createGame` is called server-side with `interactive: true` and flows continue; the only change is the first state stored in `games.state` has empty hands until the chooser resolves their pick. Server's `filterStateForPlayer` already handles empty hand zones correctly.

**UI impact:** None for the choose_play_order modal (already gates input). The hand strips in `GameBoard.tsx:2319` already render the "Empty hand" fallback for empty zones, so they'll show that placeholder until the modal resolves. The replay banner / scrubber's step 0 will now correctly show "no hands yet" → "hands drawn" transition matching the play-order resolution moment.

**Regression test (one new test, `reducer.test.ts`):**
- Immediately after `createGame` returns: assert `state.zones.player1.hand.length === 0 && state.zones.player2.hand.length === 0`.
- After resolving `choose_play_order` with `"first"`: assert both hands have length 7.
- After resolution: assert per-player `card_drawn` opening-hand log entries appear at this step, not at game-start.

---

## Engine agent: 8 condition-field-typo bugs surfaced by the 2026-04-30 card-status improvement

The new condition-field validator (`scripts/card-status.ts:CONDITION_FIELD_MAP`,
landed alongside Andy's Room ANDY'S FAVORITE fix) exposed 8 cards with silent
field typos on `Condition` shapes — same bug class as the 2026-04 CardFilter
typo sweep (`maxStrength` → `strengthAtMost` etc.), but on Conditions instead.
All 8 ship broken: the typo'd field is silently ignored and the condition
fires per the default.

### Pattern A — `cards_in_zone_gte` with `owner`/`filter` (6 cards)

Type definition (`packages/engine/src/types/index.ts:2830`):
```ts
| { type: "cards_in_zone_gte"; zone: ZoneName; amount: number; player: PlayerTarget; cardType?: CardType[] }
```

The engine reads `condition.player` and `condition.cardType` only. JSON authors
wrote `owner` (not in type) and `filter: { hasDamage, hasTrait, isExerted, ... }`
(rich CardFilter, but type only accepts an inline `cardType[]` array). Both
silently ignored — condition reduces to "N or more cards in zone" with no
filtering, so each card's flavor restriction is missing in play.

Affected (run `pnpm card-status --category invalid-field --verbose` for live list):
- The Colonel - Old Sheepdog (set-8/#17) — `filter: { cardType, hasTrait: "Puppy" }`
- Queen of Hearts - Haughty Monarch (set-8/#105) — `filter: { cardType, hasDamage: true }`. Oracle: "5 or more characters **with damage** in play, this character gets +3 {L}." Currently fires with 5+ undamaged characters.
- Jock - Attentive Uncle (set-8/#112) — `filter: { cardType, excludeSelf: true }`
- Cri-Kee - Part of the Team (set-8/#131) — `filter: { cardType, isExerted, excludeSelf }`
- The Coachman - Greedy Deceiver (set-8/#140) — `filter: { cardType, isExerted }`
- Elinor - Renowned Diplomat (set-12/#86) — `filter: { cardType, isExerted }`

Fix path: extend `cards_in_zone_gte` type to accept a `filter?: CardFilter`
and update the reducer (`packages/engine/src/utils/index.ts:1049`) to apply
it. Then rename `owner` → `player` in the 6 JSONs. Add a regression test per
shape variant (with-damage, with-trait, exerted, excludeSelf).

### Pattern B — `this_has_damage` with `amount` threshold (2 cards, 1 reprint)

Type definition: `| { type: "this_has_damage" }` — zero fields.

Luisa Madrigal - Confident Climber (set-12/#60 + #227 promo reprint), Oracle:
"…if this character has **3 or more** damage, move all damage from this
character to chosen opposing character." JSON uses
`{ type: "this_has_damage", amount: 3 }` — `amount` is silently ignored, so
the condition fires for ANY damage (including 1).

Same fix shape as Andy's Room: extend type with `amount?: number; op?: ...`
defaults `amount: 1, op: ">="`, update reducer to compare `inst.damage` per
the op, render decompiler appropriately. Or add a parallel `this_damage_gte`
type. The `op` route is more reusable.

### Why the audit caught these now and not before

Before 2026-04-30, `card-status` validated CardFilter fields against the
interface but didn't validate Condition fields the same way. The Andy's Room
ANDY'S FAVORITE bug ("only 1 character" silently encoded as `op: "=="` on a
type with no `op` field) prompted the audit improvement, which surfaced these
8 latent cases. All ship-broken in production but in narrow board states, so
the bugs likely went unnoticed during play testing — exactly the failure mode
this audit class targets.

---

## ~~Engine agent: add `sourceInstanceId` to `lastRevealedHand` state~~ DONE 2026-04-24

Engine state shape extended; `reveal_hand` / `look_at_hand` now persist
the source card instance alongside `playerId` / `cardIds` / `privateTo`.

- `packages/engine/src/types/index.ts:3639` — added `sourceInstanceId: string` to the `lastRevealedHand` snapshot interface.
- `packages/engine/src/engine/reducer.ts:3018` — populated the new field at the existing return site (`sourceInstanceId` was already in lexical scope from the `hand_revealed` event two lines above).
- `packages/engine/src/engine/set12.test.ts` — extended the existing Dolores Madrigal NO SECRETS tests to assert `sourceInstanceId === doloresId` (PLAY_CARD path) and `=== source.instanceId` (direct `applyEffect` path for both `reveal_hand` and `look_at_hand`).

All 679 engine tests pass. Typecheck shows only pre-existing
`exactOptionalPropertyTypes` errors unrelated to this change.

UI follow-up (swap "Opponent's hand" → "Revealed by [Source]" in
GameBoard's hand-reveal section) is now unblocked.

---

## ~~Engine agent: shifted character should keep target's play-array slot (visual continuity)~~ ✅ DONE 2026-04-26

Shipped the recommended post-hoc splice. `applyPlayCard()` shift branch
now captures the target's `play[]` index BEFORE `zoneTransition`, then
after the existing moves splices the new shifter into that slot:

```
Before: [A, B, target, D, E]
After:  [A, B, newShifter, D, E]   ← previously [A, B, D, E, newShifter]
```

Single-call-site change (no `TransitionContext` API surface added).
Regression: `reducer.test.ts > §8 Keywords > Shift: new shifter takes
the target's play-array slot (visual continuity)` — 3 chars in play
ordered `[L, base, R]`, after PLAY_CARD with shiftTargetInstanceId=base
asserts `play === [L, shifter, R]` and base.zone === "under".
UI inherits automatically.

---

## ~~UI agent: Sing Together gating misses static-granted Singer (Mickey Amber Champion)~~ ✅ DONE

UI fix landed in `singerEffectiveCost` at `GameBoard.tsx:983-1009` — reads `gameModifiers.grantedKeywords` and OR's static-granted Singer into the keyword check, mirroring the engine validator. CRD 8.11.1 cited in the comment block. Mickey Amber Champion FRIENDLY CHORUS (and any future static-granted Singer keyword) now resolves the Sing Together math correctly.

---

## ~~Engine agent: Hypnotic Deduction — honor "in any order" via choose_order~~ ✅ DONE 2026-04-26

Option A landed. Two-step pick → order: after the existing `choose_target`
resolves with 2 hand cards, the engine now surfaces a `choose_order`
PendingChoice over those exact 2 cards. New optional
`position?: "top" | "bottom"` field on `choose_order` (default `"bottom"`
preserves Vision / Ariel / Under the Sea / look_at_top "rest to bottom"
behavior). The `choose_order` resolver dispatches on `position`; the
`reorderDeckTopToBottom` helper now uses its previously-unused
`cardsToTop` param so `position: "top"` routes the chosen order to the
top of the deck (first selected = topmost / drawn first). Hypnotic
Deduction inherits the UI's new preview/reset modal automatically.
Regression in `set5-set8.test.ts` covers the two-step flow +
deck-order assertion.

---

## ~~Server agent + UI agent: client-side Rematch trigger for MP end-of-match victory modal~~ ✅ DONE

Server endpoint was already in place (`POST /lobby/rematch` at `server/src/routes/lobby.ts:117-142` + `rematchLobby` service at `lobbyService.ts:323-487`) — idempotent on `previousLobbyId`, spawns the first game synchronously, no separate "Waiting for opponent" subscription needed. UI wiring shipped in same commit: `postRematch()` helper in `serverApi.ts`; `getGameInfo()` extended to surface `lobby_id`; one-shot `useEffect` in `GameBoard.tsx` fetches the parent lobby UUID at MP game-over; Rematch button renders in the modal's primary-CTA slot when `multiplayerGame && !hasNextGame && rematchLobbyId`. Inline error surfacing for the 409 ACTIVE_GAME case (only user-resolvable error). Pending-state via local `rematchPending` boolean — disabled button labeled "Waiting for opponent…" between click and navigation. Queue-spawned games (no parent lobby) correctly skip the CTA.

---

## ~~UI agent: `choose_play_order` PendingChoiceModal variant~~ ✅ DONE

Both pieces shipped: `choose_play_order` branch in `PendingChoiceModal.tsx:291` (Go First / Go Second buttons; context subtitle for game 1 / Bo3 game N), and sandbox auto-resolve `choose_play_order → "first"` at `GameBoard.tsx:1330` (alongside the mulligan auto-skip). CRD 2.1.3.2 / 2.2.1.1 implemented.

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

## ~~GUI agent: render `<Keyword>` tokens in rulesText as styled badges~~ ✅ DONE 2026-04-27 (simplified)

User picked the minimum-viable variant: just bold the keyword content
WITHOUT the angle brackets, no icon, no accent color. `renderRulesText`
in `packages/ui/src/utils/rulesTextRender.tsx` now matches both glyph
braces (`{X}`) and keyword angle brackets (`<Evasive>`, `<Shift: Discard
an action card>`, `<Sing Together>`) in a single combined token pattern;
keyword matches emit `<strong>` with the brackets stripped.

All three rulesText consumers (`CardInspectModal`, `CardTextRender`,
`AbilityTextRender`) call `renderRulesText`, so the bolded-keyword
treatment applies everywhere automatically. Reminder parens remain plain
text by design — the normalizer doesn't wrap keywords inside `(...)`,
so `(Only characters with Evasive can challenge…)` reads as prose.

If we ever decide we DO want icon badges + accent colors, the original
HANDOFF design intent is preserved in `git log` and the implementation
sits in one file ready to be expanded.

**Do not** edit the normalizer or card JSONs. The rulesText shape is fixed;
the UI just needs to parse and render it.

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

> **Note (2026-04-25):** Phase 2 server work shipped 2026-04-22 (audited
> by server-specialist). The original Phase-2 server prompt block has
> been removed from this section. The gameboard-specialist prompt below
> is UNBLOCKED.

#### Open prompt for gameboard-specialist (Phase 2 overlay, UNBLOCKED 2026-04-22)

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

### Phase 3 — Matchmaking queues (casual + ranked) + private-becomes-unranked + decks lose rotation stamp

**Major revision 2026-04-27 — supersedes the prior Phase 3 spec.** Locked with user across a long planning conversation. See standalone HANDOFF entries below ("Server agent: casual + ranked matchmaking queues") for the full server spec; this section is the multi-phase index entry.

Coordinated ship across three agents — engine-expert lands first, then server-specialist, then GUI agent (me). All three pieces are required for the matchmaking experience to work:

**engine-expert** (already specced in the rotation-registry-refactor entry above):
- `RotationEntry.ranked: boolean` field + `isRankedFormat` helper
- Split `INFINITY_ALL_SETS` into per-rotation snapshots (s11 = sets 1-11, s12 = sets 1-12)
- Tests for rotation flag + Infinity legality

**server-specialist** (full spec in standalone entry below):
- DB migration: `decks.format_rotation` → drop entirely (decks now only carry `format_family`)
- DB migration: `games` gains `match_source` enum (`'private' | 'queue' | 'tournament'`) + `ranked` boolean
- New `matchmaking_queue` table + endpoints (`POST/GET/DELETE /matchmaking`)
- Format-bucketed pairing on `(family, rotation, match_format)` triple — strict, no cross-format ever
- Casual queue: FIFO within bucket
- Ranked queue: ELO band-widening (`±50 → ±150 → ±400 → unbounded` over 90s); only available for rotations where `ranked=true`
- Mandatory legality check on game creation against the chosen rotation
- Concurrency invariant: one queue OR one waiting-lobby per user (server-enforced)
- Rate limit: 10 queue-joins/hr per user
- `updateElo` no-ops when `game.ranked = false` (private + casual queue + staged-rotation games all skip ELO)
- Private lobbies always create games with `ranked = false` (anti-collusion)

**GUI agent (me)** — full spec in standalone entry below:
- Drop `format_rotation` from deck-related UI (DeckBuilderPage, MultiplayerLobby, FormatPicker)
- Lobby restructure: Quick Play (Find Casual + Find Ranked + Solo) | Custom Game (Host + Join + Browse)
- Format dropdowns (NOT toggles) on host + queue surfaces; option list filtered per surface (ranked queue only shows `ranked=true` rotations; others show all `offeredForNewDecks=true`)
- Queue-wait screens: timer + cancel; band-progression display for ranked; FIFO timer for casual
- Deckbuilder legality drift indicator: ⚠️ N cards illegal with click-to-expand + [Edit deck] / [Migrate to Infinity] / [Leave as-is]
- Realtime subscribe for pair-success → auto-redirect to `/game/:id`
- Removed: per-deck rotation picker (deckbuilder format picker simplifies to family-only)

User's test scenario: main account + incognito account, both click Find Casual on Core-s11 → both land in same `/game/:id` within ~3s of the second queue-join. Ranked-queue test scenario: same but click Find Ranked, ELO bands constrain matching, both land in same game.

Pre-launch (today through 2026-05-08): Find Ranked is hidden for Core-s12 / Infinity-s12 (those rotations are `ranked=false` while staged). Players testing set 12 use Find Casual or private lobbies.

Locked decisions (full list captured in standalone entries):
- Sequencing: ship engine + server + UI together (Y, not staged)
- Schema: `match_source` enum + `ranked` boolean (both on `games`)
- Concurrency: one queue OR waiting-lobby per user
- Per-format pairing: strict 3-tuple `(family, rotation, match_format)`
- Rate limit: 10/hr
- No cross-format pairing ever (use Infinity for max-population queues)
- Rotation lifecycle: 2 playable states (staged / live), retired = unplayable
- Decks: lose `format_rotation` column entirely; rotation chosen per-game
- UI labels (`Casual` vs `Competitive`): TBD post-implementation; database uses `casual_queue` / `ranked_queue` regardless

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

## Server agent (first) + UI agent (follow-up): duels-style middle-screen lobby restructure

Filed 2026-05-04 from a UX architecture review. User's actual lobby
usage breakdown (their words):
- 90% — joining MP via matchmaking (Quick Play)
- 9%  — creating + joining custom lobbies with friends
- ~0% — browsing public lobbies

Specific pain point flagged: "I don't want to accidentally join an
infinity lobby with a core deck (even though it's legal)." Only
relevant to the 9% friend-pillar path; matchmaking is unaffected
(queue locks family).

Decision: adopt the duels.ink pattern for custom lobbies. Decouple
deck choice from lobby creation. Lobby = format + opponent commit;
deck = private prep that happens AFTER both players are in the
lobby. Quick Play matchmaking is unchanged (its queue locks decks
+ format at queue-join time).

### High-level architecture

**Today (custom game):**
```
/multiplayer:  pick deck → pick Bo + Format → Create
                 ↓ (deck attached at create time)
              wait screen with code
                 ↓ (friend joins — has their deck attached too)
              instant game start → /game/{uuid} → coin flip → game
```

**After:**
```
/multiplayer:  pick Bo + Format → Create  (NO deck yet)
                 ↓
              /game/{uuid}: middle screen
                 ├── shows Bo · Format · Rotation prominently
                 ├── shows 6-char code (voice/typing share) + URL (clickable share)
                 ├── opponent slot (Waiting → Joined)
                 ├── your deck slot (pick from saved, can swap before Ready)
                 ├── opponent's status (Picking… → Ready) — never their actual deck
                 └── [Ready] button — both ready ⇒ coin flip + game
```

Quick Play (90% case) skips the middle screen — server pairs, decks
already attached via queue, route lands directly in game.

### Why this is the right shape

- **Solves format mismatch pain:** middle screen shows format BEFORE
  user picks deck. Can't accidentally bring the wrong-family deck.
- **Privacy:** opponent sees ready state, not deck. Deck reveal
  happens at game start, not lobby join.
- **Deck swap freedom:** change your mind before Ready without
  abandoning the lobby. Today you'd have to leave and re-join.
- **Cleans up the friend-link experience:** /game/{uuid} URL works
  for friends who don't have saved decks yet — they can build/save
  in the middle-screen state machine, not in a separate flow.
- **URL-as-share-token:** /game/{uuid} is unguessable (~128 bits of
  entropy). Effectively private by default. 6-char code stays as a
  parallel artifact for voice / typed sharing.

### Sequencing

**Server first, UI second.** The middle-screen UX depends on lobby
state changes (lobby has format only at create, decks fill in
later). UI agent will write throwaway mock code if it goes first.
Server session ~1-2 days; UI session ~1 day after.

Parallel safe-to-do work happens in the gap (UI agent can drop the
public-lobby browser independently — see Phase 0 below).

### Phase 0 — UI cleanup (safe, no dependencies, in flight 2026-05-04)

UI agent drops the public-lobby browser surface entirely (~0% usage
per user). Independent of server changes; can ship in parallel
with the server work below.

- Remove the collapsible "Public games" section in MultiplayerLobby
  (Custom Game tab).
- Drop `listPublicLobbies` import + polling effect.
- Drop the "Public — list in browser; anyone can join" toggle on the
  Host card (every lobby is private/URL-only after this).
- Server endpoint `GET /lobbies/public` becomes dead code; can be
  removed in Phase 1 server work or left dormant.

### Phase 1 — Server work (server-specialist)

**Lobby state model changes:**

The current `lobbies` row carries `host_deck`, `guest_deck` (JSONB,
attached at lobby-create / join time). New shape:

```sql
ALTER TABLE lobbies
  -- Old: deck attached at create. New: per-player slots fill in
  -- post-join when each side picks their deck in the middle screen.
  -- Keep the existing columns; add ready-state booleans.
  ADD COLUMN IF NOT EXISTS host_ready  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guest_ready BOOLEAN NOT NULL DEFAULT FALSE;
```

Keep `host_deck` / `guest_deck` JSONB but change the contract:
- On lobby create: `host_deck = NULL` (was: deck JSONB)
- On lobby join (guest): `guest_deck = NULL` (was: deck JSONB)
- Per-player deck attachment via `setDeckInLobby` endpoint
- `host_ready` / `guest_ready` start FALSE; flip to TRUE via setReady

**Game-start trigger change:**

Today, the game starts when both decks are attached (i.e., on
`joinLobby` returning, both decks are present, server inits a
`games` row). New: the game starts when **both `ready=true`**. The
flip from "lobby" → "game" happens on the second ready confirmation,
not on join.

Implementation: a `startGameIfReady(lobbyId)` check on every state
mutation in the lobby (deck pick, ready-toggle, second-player join).
When `host_deck IS NOT NULL AND guest_deck IS NOT NULL AND host_ready
AND guest_ready`, init the `games` row, broadcast game-start.

**New endpoints:**

```ts
// All take `gameId` (UUID) — not the 6-char code.

// Peek at a lobby without joining. Returns format + presence of
// opponent (yes/no) + each player's ready state. Does NOT return
// either player's deck (privacy). Used by middle screen on mount
// and by /lobby/:code redirect path (look up code → return the
// game UUID + format hint without joining).
getLobbyInfo(gameId: string): {
  format: { matchFormat, family, rotation },
  hostUsername: string,
  guestUsername: string | null,
  hostReady: boolean,
  guestReady: boolean,
  hostHasDeck: boolean,    // true when host_deck IS NOT NULL
  guestHasDeck: boolean,
  status: 'waiting' | 'lobby' | 'in_game',
}

// Attach (or swap) your deck to your slot in the lobby. Validates
// legality against the lobby's stored format. Doesn't auto-flip
// ready (separate explicit step).
setDeckInLobby(gameId: string, deck: DeckEntry[]): { ok: true } | { error: ... }

// Toggle your ready flag. Server checks deck is attached first
// (can't be ready without a deck). When both ready, server
// transitions lobby → game in the same call (atomic).
setReadyInLobby(gameId: string, ready: boolean): {
  ok: true,
  gameStarted: boolean,
}

// Lookup gameId by 6-char code (voice/typing share path). Returns
// the gameId so the UI can navigate to /game/{gameId}. Rejects if
// the lobby is full / code expired / not found.
resolveLobbyCode(code: string): { gameId: string }
```

**Existing endpoints to update:**

- `createLobby`: drop the deck arg; takes only Bo + Format. Returns
  `{ gameId, code }`. Code is still generated for voice-share.
- `joinLobby`: drop the deck arg; takes only the gameId (or code →
  resolves to gameId). Marks the user as the guest, returns
  `{ ok: true }`. Does NOT start the game.
- `cancelLobby`: works the same way; cancellation flips status to
  `cancelled`, broadcasts to anyone in the middle screen.

**Realtime broadcast:**

Realtime channel `lobby:{gameId}` broadcasts on:
- guest joins (presence event)
- either player picks/swaps deck (just `hostHasDeck` / `guestHasDeck`
  flag, NOT the deck contents — privacy)
- either player toggles ready
- game starts (status flip → in_game)
- lobby cancelled

Existing `game:{gameId}` channel still broadcasts game state once
the game starts. Two channels: lobby pre-start, game post-start.

**Drop public lobby concept:**
- `lobbies.public` column can stay (default false) but no UI surfaces
  it now. Defer dropping the column until a future cleanup; safer
  to leave dormant.
- `GET /lobbies/public` endpoint becomes dead code; can drop in
  this same commit or leave for cleanup.
- All lobbies are URL-only access from the user's perspective.

**Anti-cheat / RLS:**
- `getLobbyInfo` should be readable by anyone with the gameId (since
  having the URL = consent to know the format). RLS or app-level
  permission gate.
- `setDeckInLobby` / `setReadyInLobby` are caller-gated (must be the
  host or the guest in this lobby).
- Spectator-policy column on lobbies stays; dictates who can WATCH
  once the game starts.

**Migration:**
- Existing in-flight lobbies (host_deck or guest_deck attached) → mark
  as `cancelled` since the new state model doesn't support pre-deck-
  pick games. Pre-launch this is fine; no real users to affect.
- Or: backfill `host_ready=true, guest_ready=true` for any existing
  full lobbies, so they continue without disruption. Either is OK.

**Tests:**
- Unit: `setDeckInLobby` validates legality, rejects illegal decks.
- Unit: `setReadyInLobby` rejects when no deck attached.
- Integration: full happy-path host → join → both pick decks → both
  ready → game starts.
- Integration: format-mismatch attempt — guest tries to attach
  Infinity-only deck to a Core-only-rotation lobby → rejected.

### Phase 2 — UI work (UI agent — me, after server lands)

**New middle-screen rendering** at `/game/{gameId}` when status is
`waiting | lobby`:

Component split:
- `LobbyMiddleScreen` (new) — renders the lobby UI. Subscribes to
  realtime lobby channel via existing `useGameSession` or a new
  `useLobbyRoom` hook.
- `MyDeckSlot` — picker into your saved decks; calls
  `setDeckInLobby` on selection.
- `OpponentDeckSlot` — read-only status display (Picking / Ready /
  not joined).
- `ReadyButton` — calls `setReadyInLobby(true)`. Disabled when no
  deck attached.

**Route changes:**
- `/game/{uuid}` — render `LobbyMiddleScreen` when `status != in_game`,
  else render `<GameBoard>`. State machine flips visible component
  as server broadcasts the status change.
- `/lobby/{code}` — keep this route; resolves the code to a gameId
  via the new `resolveLobbyCode` endpoint and redirects to
  `/game/{gameId}`. URL-as-canonical, code-as-shorthand.

**Deck section on /multiplayer:**
- Quick Play tab: deck picker stays as-is (decks attach at queue-
  join time).
- Custom Game tab: deck picker is GONE from the lobby create form.
  Custom Game card becomes just Bo + Format inputs + Create button.
- "Your Deck" section above the segmented switcher: keep for Quick
  Play; hide when Custom Game is active. To finalize at UI time.

**Drop:**
- Public-lobby browser (Phase 0).
- The "wait screen with code" current state on /multiplayer post-
  Create — replaced by /game/{uuid} navigation.
- Lobby code typed-input flow now navigates via `resolveLobbyCode`.

**Format-mismatch surfacing:**
- In the middle screen, if user tries to attach a deck whose format
  family doesn't match the lobby, the deck slot rejects + shows a
  toast/error. Server enforces too. Middle screen IS the peek.

### What this preserves

- Quick Play matchmaking flow (90% usage) — unchanged.
- 6-char codes — kept as voice-share artifact, parallel to URL.
- Lobby cancellation flow — same shape from the middle screen.
- Bo3 series — still works; second/third games re-init within the
  same lobby (separate followup if rematch needs middle-screen re-prep).
- Spectator system — not affected.

### Out of scope

- Deck-builder integration into the middle screen for friends with
  no saved decks (they'd hit "no decks yet" → "Build a deck →" link
  to /decks/new). Inline deck paste in middle screen is a future phase.
- Public-lobby browser re-introduction with proper filters / ELO
  bands / region — separate design.
- Single "Find Match" smart button combining Quick Play + browser —
  user reviewed and rejected this combination.

### When server-specialist completes

Per HANDOFF convention: delete this entry from the file, capturing the
schema/endpoint/test summary in the commit message. UI agent picks up
Phase 2 from the SHA.

