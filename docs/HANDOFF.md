# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Last reorganized: 2026-04-25 (5 DONE items deleted, 7 parked-decision items moved to `docs/BACKLOG.md`).

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

## Engine agent: shifted character should keep target's play-array slot (visual continuity)

User-reported 2026-04-26: when a character is shifted (Floodborn /
Storyborn shift), the new shifter renders at the rightmost slot of the
play zone instead of staying in the position the target occupied.
Visually feels like a "new object" that jumped to the end, when the
player's mental model is "same character lineage, evolved in place."

### Why this happens

In `applyPlayCard()` shift branch (`reducer.ts:781-840`):

1. The new shifter has its own fresh `instanceId` (it's the card from
   hand, not the target on the board).
2. `zoneTransition(newShifter, "play")` routes through `moveCard()` with
   default `position: "bottom"` → appended to the end of the play-zone
   array.
3. The target is then moved out of `"play"` into `"under"` → removed
   from the play array.

Net effect on `gameState.zones[playerId].play`:
```
Before: [A, B, target, D, E]
After:  [A, B, D, E, newShifter]   ← target removed, newShifter appended
```

UI iterates this array in order, so the new shifter renders rightmost.

### Why UI can't fix it cleanly

Once the target is moved to `"under"`, its previous play-array index is
lost. The UI would need to either:
- Track positions across render snapshots (breaks on undo / replay /
  HMR / multiplayer state refetch)
- Reconstruct order from the cardsUnder chain (only works for chained
  shifts, not first-time-shift-onto-base)

Engine-side fix is the only place that has the array index at the right
moment.

### Proposed fix

Capture the target's play-array index BEFORE the shift moves anything,
then splice the new shifter in at that index instead of appending.
Surgical option (recommended):

```ts
// At the top of the shift branch (reducer.ts:~781), before zoneTransition:
const targetIdx = state.zones[playerId].play.indexOf(shiftTargetInstanceId);

// ... existing zoneTransition + target-to-under logic ...

// After both moves, splice newShifter into targetIdx
if (targetIdx >= 0) {
  const cur = state.zones[playerId].play;
  const reordered = cur.filter(id => id !== instanceId);
  reordered.splice(targetIdx, 0, instanceId);
  state = {
    ...state,
    zones: {
      ...state.zones,
      [playerId]: { ...state.zones[playerId], play: reordered },
    },
  };
}
```

Cleaner long-term API would be `position?: "top" | "bottom" | number` on
`TransitionContext` threaded into `moveCard`, but that's only worth it
if a second case (transform effects? location-host swaps?) wants the
same behavior. Start with the post-hoc splice — single-call-site
change, no API surface.

### Tests

Add to a shift-related test file:
- Inject 3 characters in player1's play: A (index 0), B-base (index 1),
  C (index 2). Inject the shift card (Storyborn) for B in hand.
- After PLAY_CARD with shiftTargetInstanceId = B-base:
  - `state.zones.player1.play` should be `[A, newShifter, C]`
  - newShifter is at index 1 (where B-base was), NOT index 2 (appended)
  - B-base is in `state.cards[B-base].zone === "under"`

### Why this matters

It's polish but the user noticed it on their own without prompting,
which suggests it's noticeable enough to bother others. Sandbox +
multiplayer both affected. Small fix, high readability win.

---

## UI agent: Sing Together gating misses static-granted Singer (Mickey Amber Champion)

Discovered 2026-04-25 while fixing a user-reported bug ("Mickey Mouse
Amber Champion + 2 other Amber characters can't sing nor sing-together
Circle of Life"). Engine-side fix landed in commit `2fb38be` — validator
.canSingSong now forwards `modifiers.grantedKeywords` so static-granted
Singer (Mickey Amber Champion FRIENDLY CHORUS: "this character gains
Singer 8") is honored. Solo-sing works because the UI reads the engine's
`session.legalActions` (which is now correctly populated).

**The Sing Together gating is still broken UI-side.** Sing Together
combinations aren't enumerated by the engine (combinatorial), so the UI
re-implements the singer-cost calculation locally. That local copy
mirrors validator.ts but predates the fix:

```tsx
// packages/ui/src/pages/GameBoard.tsx:838-855 (singerEffectiveCost)
let cost = sDef.cost;
if (hasKeyword(s, sDef, "singer")) cost = getKeywordValue(s, sDef, "singer");
//                                  ^^ missing the modifiers param
```

`hasKeyword(s, sDef, "singer", modifiers)` and
`getKeywordValue(s, sDef, "singer", modifiers.grantedKeywords.get(s.instanceId))`
would pull in static grants. With Mickey + 2 other Ambers, FRIENDLY
CHORUS fires and writes Singer 8 into `gameModifiers.grantedKeywords`,
but the UI's local `singerEffectiveCost` ignores it and reads Mickey's
printed cost of 4 — so the Sing Together math underestimates the total
and the button stays disabled.

### Fix

Single line in `singerEffectiveCost` (GameBoard.tsx:846):

```ts
// Before:
if (hasKeyword(s, sDef, "singer")) cost = getKeywordValue(s, sDef, "singer");

// After:
const sGrants = gameModifiers.grantedKeywords.get(singerInstanceId);
const grantedSinger = (sGrants ?? []).some(g => g.keyword === "singer");
if (hasKeyword(s, sDef, "singer") || grantedSinger) {
  cost = getKeywordValue(s, sDef, "singer", sGrants);
}
```

The `gameModifiers` is already in scope via the `useCallback` deps array
(line 855). `hasKeyword`/`getKeywordValue` already support optional
modifier/grants params.

`totalReadySingerCost` (line 860+) calls `singerEffectiveCost` for each
ready singer so it picks up the fix automatically — no change needed
there.

### Test plan

Manual repro in sandbox:
1. Inject Mickey Mouse Amber Champion + Lilo Making a Wish + Mr Smee
   Loyal First Mate (any 2 other Amber characters), all dry, ready.
2. Inject Circle of Life into hand.
3. Open Sing Together flow on Circle of Life. Selecting Mickey alone
   should satisfy the cost-8 threshold (FRIENDLY CHORUS makes him count
   as cost 8). Pre-fix: button stays disabled. Post-fix: enables.

Engine regression already covers solo-sing; this is the parallel UI
case.

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

## Server agent + UI agent: client-side Rematch trigger for MP end-of-match victory modal

Discovered 2026-04-25 while unifying the victory-modal layout across
solo / MP-Bo3-mid-match / MP-end-of-match. Server-side rematch flow was
shipped in `a751923` ("MP UX Phase 2 — ELO delta, replay auto-save,
**rematch**, share toggle"), but there's no client-side trigger for it
yet. The unified modal currently leaves MP end-of-match with **Back to
Lobby** in the primary slot because the Rematch slot is empty.

### What's needed

1. **Server**: confirm there's a `POST /game/:id/rematch` endpoint (or
   equivalent) and what it returns. If yes — document its shape. If no —
   wire one. Likely creates a new `games` row with the same two players
   in swapped slots (CRD 2.1.3.2 — series loser elects play/draw; for
   ad-hoc rematch we can default to coin-flip again, or maintain
   loser-elects).
2. **Client `lib/serverApi.ts`**: add `requestRematch(gameId)` calling
   the endpoint.
3. **GameBoard.tsx victory modal** (existing slot already prepared):
   add a `Rematch` button to the primary slot in the MP end-of-match
   branch. Calls `requestRematch()` and navigates to the new game ID
   on response. The unified modal block has a code comment marking the
   spot ("no rematch UI yet — see HANDOFF.md for client-side rematch
   trigger").
4. **UX flow**: when one player requests rematch but the other hasn't
   yet, show a "Waiting for opponent…" state on the rematch button
   (similar to the existing "Waiting for opponent" toast). Server
   should expose a `rematch_pending` field on the game record so both
   clients can poll/subscribe.

### Why deferred

Solo + Bo3-mid-match work without it. MP end-of-match still shows Back
to Lobby (now in the primary amber-styled slot since there's no other
primary). Layout is consistent — just one missing button. Low urgency.

---

## UI agent: `choose_play_order` PendingChoiceModal variant

Engine + server work shipped 2026-04-22 (CRD 2.1.3.2 play-draw rule —
coin-flip winner / series loser elects go-first-or-second). Engine
emits a new `choose_play_order` PendingChoice; server already routes it.
UI piece is the only remaining work.

**Scope:**
1. Add `choose_play_order` variant to `PendingChoiceModal.tsx`. Two
   buttons ("Go First" / "Go Second"), context subtitle per game 1 /
   Bo3 game N (read `gameState.matchInfo` for series state).
2. Sandbox auto-resolve at `GameBoard.tsx:1099-1105` needs to also
   auto-resolve `choose_play_order → "first"` so sandbox flow doesn't
   hang on the new phase. Without this one-line addition, opening the
   sandbox will block on the play-order prompt.
3. `firstPlayerId != null` is already guarded in the mulligan subtitle
   (`PendingChoiceModal.tsx:297-298`) so nullable-until-resolved is
   already tolerated.

CRD reference: 2.1.3.2 (Bo3 series — losing player elects), 2.2.1.1
(game 1 — flip winner elects per tournament convention).

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

## Engine agent: expand reverse compiler coverage + add apply flow

The reverse compiler exists (`scripts/compile-cards.ts`) and currently
auto-matches ~31.8% of named ability shapes on the sets 1-11 baseline.
`pnpm compile-cards` runs the baseline; `--apply --set N` is scaffolded
but the dry-run + confirmation gate isn't wired end-to-end yet.

Two items remain (verified open 2026-04-25; matcher cleanup + playRestrictions-
prefix handling have since shipped):

1. **Recursive inner-ability compilation** for `grant_triggered_ability_*`
   patterns: currently emits `{ type: "triggered", _inner_oracle: "..." }`
   as a placeholder. Should recursively invoke the compiler's triggered-
   ability grammar on the quoted inner text.
2. **End-to-end apply gate**: `pnpm compile-cards --set N --apply` writes
   abilities to card JSONs but needs a dry-run diff view + user confirmation
   before committing. Decompiler-roundtrip confidence gate (≥0.85) already
   exists; just needs the human-in-the-loop confirmation step.

Decompiler renderer coverage is the upstream bottleneck — for a compile to
score ≥0.85 via decompile round-trip, the decompiler must know how to
render the JSON it just emitted. Every renderer gap is a compile false-
negative. `pnpm decompile-cards` with no filter shows the worst-50 tail —
the renderer/wiring bug mixture lives there.

Practical caveats:
- Oracle text drift between sources (curly vs straight apostrophes handled
  by normalizer; `{L}`/`{S}` symbols sometimes dropped by Lorcast).
- Card name normalization ("Daisy Duck" vs "this character" references).
- Precedence: most-specific patterns first. ORDER MATTERS — Jack-jack's
  reveal_top_switch_3way_type must come before the shorter put_top_cards_
  into_discard matcher (already documented in compile-cards.ts).
- Conservative thresholds — better to under-wire (leave for human) than
  silently miswire. Never auto-wire below 0.85 similarity.

Re-run `pnpm compile-cards` baseline before committing to a coverage % —
the percentage may have shifted since 31.8%.

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
