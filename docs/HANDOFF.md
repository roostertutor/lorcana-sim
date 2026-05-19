# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Last reorganized: 2026-05-11 (9 DONE items deleted, shareable replay entry condensed to follow-up gaps only).

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

## Server agent (first) + UI agent (follow-up): username / display_name split (Discord model)

**Decided 2026-05-05 with user.** Today `profiles.username` is the only name field — unique, immutable in practice (no edit UI), used everywhere from the avatar dropdown to denormalized `replays.p1_username`. We're splitting it into:

- **`username`** (existing column) — stable handle. Unique, immutable for now (rename is a future feature). Used in URLs, friend lookups, replay denormalization, anywhere stability matters.
- **`display_name`** (new column) — mutable, free-text, non-unique. What avatars / headers / chat / opponent tiles render. User can edit anytime from MePage.

**Replay rendering rule** (locked):
- **Match-history list views** (`ReplaysPage`, MePage history) — show **current display_name** via live join. If a player renames, their history follows them.
- **Replay viewer chrome** (the playback page itself) — show **display_name at the time of the game** with a "(now: X)" hover when it differs. Tournament-scorecard semantics. This needs new denormalized columns on `replays` (see migration below).
- **`replays.p1_username` stays as-is** — that's the historical handle (already stable today since handles don't change). The new fields capture *display* name at finish, separately.

### Server work (server agent)

1. **Migration on `profiles`:**
   ```sql
   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
   UPDATE profiles SET display_name = username WHERE display_name IS NULL;
   ALTER TABLE profiles ALTER COLUMN display_name SET NOT NULL;
   ALTER TABLE profiles ADD CONSTRAINT display_name_length
     CHECK (char_length(display_name) BETWEEN 1 AND 32);
   ```
   Note no UNIQUE constraint — display names collide intentionally.

2. **Migration on `replays`** (denormalize display_name at finish for replay-viewer chrome):
   ```sql
   ALTER TABLE replays ADD COLUMN IF NOT EXISTS p1_display_name TEXT;
   ALTER TABLE replays ADD COLUMN IF NOT EXISTS p2_display_name TEXT;
   ```
   Backfill: `UPDATE replays SET p1_display_name = p1_username, p2_display_name = p2_username WHERE p1_display_name IS NULL` (existing rows stamp handle as historical display, harmless).

3. **`authService.getOrCreateProfile`** — on first profile creation, set `display_name = username`. New users get matching values until they edit.

4. **New endpoint `PATCH /me/profile`** (or extend existing `/me`) — accepts `{ display_name: string }`. Validate: 1-32 chars, trim leading/trailing whitespace, reject all-whitespace. Returns updated profile row. No rate limit beyond existing auth-bearer throttling. (Username rename deferred — separate future entry; would need uniqueness check + URL redirect strategy.)

5. **`gameService.finishGame` denormalization** — when writing the `replays` row, snapshot `display_name` from each profile alongside `username`. The `usernameById` map already exists; add a `displayNameById` map next to it.

6. **`gameService.listReplaysForUser` + `getSharedReplayMeta`** response shapes — extend `ReplayListItem` and `ReplayMeta` types to include both `p1Username`/`p1DisplayName` and `p2Username`/`p2DisplayName`. List view renders display_name (from live join with `profiles`); viewer renders `*_display_name` from the replay row directly. Keep `*Username` in the response so the UI can show "@handle" alongside.

7. **Profile read** (`getProfile`, `/me`) — already returns the whole row, so adding `display_name` to the column should propagate automatically. Verify the typed shape on the client (`serverApi.ts` types) gets the new field; update there explicitly.

### UI work (this agent, after server lands)

1. **MePage** (`packages/ui/src/pages/MePage.tsx`) — add an inline edit affordance on the display_name (currently shows `profile.username` at line 108). Pencil icon → input → save → optimistic update + toast on error. Show `@username` underneath in smaller muted type so the handle is visible but secondary.
2. **App.tsx avatar dropdown** (`displayName` local var, lines 361-388) — currently reads `profile.username`. Switch to `profile.display_name ?? profile.username` (defensive fallback during the rollout window). Add `@username` line under the display name in the dropdown header.
3. **MultiplayerLobby + LobbyMiddleScreen** — opponent name surfaces should switch to `display_name` for the primary label, with `@username` as a secondary line where layout allows.
4. **ReplaysPage** — list rows render `p1_display_name` / `p2_display_name` (current values from server live-join) in the primary slot, `@username` in tooltip or secondary text.
5. **GameBoard replay banner / opponent tile** — replay viewer uses the `*_display_name_at_finish` fields from the replay row (server returns them); add a tooltip "(now: X)" when the live profile's current display_name differs. List of touchpoints to wire up handed off in next entry once #6 above is solidified.
6. **Search/filter inputs** (friends search, future): match against `username` OR `display_name`. Display matched display_name with `@username` shown so users can disambiguate.

### Decisions locked
- Email stays hidden — anti-leak rule on `App.tsx:369` is correct; no display-name change touches email rendering.
- Username rename is deferred. Single-rename-per-90-days with old-handle reservation is the eventual model, but not in this scope.
- No profanity/uniqueness check on display_name. Same rationale as Discord — non-unique by design, free expression. Add a moderation flow only when reports happen.
- Display name is rendered everywhere by default; @handle is shown adjacent or in tooltip. Users who want their handle to be primary can set their display_name to match.

### Out of scope
- Username rename UI (parked in BACKLOG once this lands).
- Mention/tag system (`@username` autocomplete).
- Friends graph / mutual-friend resolution by handle (Phase 5 of MP UX plan).
- Profile pictures / avatars beyond the initial-letter circle.

---

## Replay follow-up gaps (from Phase B/C shareable replays, shipped 2026-05-01)

1. **`callerSlot` detection in `App.tsx → metaToRemoteReplay`** is hardcoded to `null` because `ReplayMeta` doesn't carry player IDs (only usernames). Effect: a player visiting their own MP replay via direct `/replay/:gameId` URL gets reduced affordances — no privacy chip toggle, perspective toggle behaves as if anonymous. Cleanest fix: add optional `callerSlot?: "p1" | "p2" | null` to `ReplayMeta` and stamp it in `buildReplayView`.
2. **Privacy chip + share button only render when `mpReplay` is non-null**. They don't render when reviewing via `/replay/:gameId` direct URL or `/replay/share/:replayId`. Once #1 lands, refactor to read from `replayInput.data.replayId`.

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

---

## End-to-end multiplayer UX improvement plan (7 phases)

Planned with user 2026-04-22. Full detail in
`C:\Users\Ryan\.claude\plans\can-we-look-at-dapper-sunrise.md`. This
handoff entry summarizes the agent splits + sequencing so each phase can
be picked up without re-reading the full plan.

### Status snapshot — read this first

| Phase | Status | Next action |
|---|---|---|
| 1. Lobby polish + public browser + first-player banner | Server ✅, GUI ✅. | gameboard-specialist: first-player banner (prompt below in §Phase 1) |
| 2. Post-game polish (replay save, ELO delta, rematch w/ loser-picks-first) | Server ✅ (2026-04-22), Rematch UI ✅ (client-side). | gameboard-specialist: game-over overlay (prompt below); GUI agent: replay toast + serverApi wrappers (prompt below) |
| 3. Matchmaking queue (user's two-account test target) | Open | server + engine + GUI coordinated ship (spec below in §Phase 3) |
| 4. Reconnection + resume hardening | Open | After Phase 3 |
| 5. Friends + rich presence | Open | After Phase 4 |
| 6. Emoji reactions (ephemeral) | Open | Can land independently of 5 |
| 7. Spectator mode (per-side fog-of-war) | Open; Phase 1 plumbing already shipped (`spectator_policy`) | After Phase 5 for friends-feed; public-games feed works without 5 |

**Current bottleneck:** Phase 3 server + engine work. Phase 2 server is done; remaining Phase 2 UI work (game-over overlay, replay toast) can proceed in parallel with Phase 3 planning.

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

Server ✅ (35061e1) + GUI ✅ (15db979 + a55b372). Only remaining: first-player banner.

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

Server ✅ (2026-04-22), Rematch UI ✅ (client-side wired). Remaining: game-over overlay polish + replay toast.

#### Open prompt for gameboard-specialist (Phase 2 overlay, UNBLOCKED)

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

