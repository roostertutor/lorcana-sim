# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

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

## Engine agent: 3 dead-primitive bugs surfaced by new `pnpm audit-dead-primitives` (follow-up from Hidden Inkcaster fix)

Shipped 2026-04-21 alongside the Hidden Inkcaster fix: a new audit script
(`pnpm audit-dead-primitives`) that scans `gameModifiers.ts` for every
`modifiers.<field>.(add|set|push|=|...)` write and verifies at least one
reader exists across engine + simulator + analytics + cli + ui. The audit
matches reads through canonical names (`modifiers.X`), abbreviated aliases
(`mods.X`, `drawModifiers.X`, `epeMods.X`, `inkMods.X`, `discardMods.X`),
and optional chaining (`modifiers?.X`). Write-shaped tails (`.add(`,
`.set(`, `.push(`, ` = `) are skipped so writes don't count as reads.

First run after fixing Hidden Inkcaster surfaces **3 additional dead
primitives** — each is its own runtime bug. Pattern: the case handler
populates the modifier field, but no consumer reads it, so the static
silently no-ops.

### 1. Flotsam - Ursula's "Baby" (`grant_triggered_ability` → `grantedTriggeredAbilities`)

- **Populator**: `gameModifiers.ts:1093-1095` — `modifiers.grantedTriggeredAbilities.set(candidate.instanceId, [...])`
- **Expected reader**: the trigger scanner (docs comment at `types/index.ts:1768`
  literally says "The trigger scanner checks grantedTriggeredAbilities in
  addition to the card's own definition abilities") — **but no such check
  exists**.
- **Runtime impact**: Flotsam grants a triggered ability to matching
  characters. With no reader, the granted ability never fires.
- **Fix location**: wherever the trigger-scanner walks a card's abilities to
  dispatch triggers. Search `reducer.ts` for `for (const ab of def.abilities`
  or similar; augment the loop to also iterate
  `modifiers.grantedTriggeredAbilities.get(instance.instanceId) ?? []`.
- **Test pattern**: inject Flotsam's source in play, inject a matching
  character, fire the granting event, assert the granted ability triggers.

### 2. Captain Amelia - Commander of the Legacy (`grant_keyword_while_being_challenged` → `grantKeywordWhileBeingChallenged`)

- **Populator**: `gameModifiers.ts:1140-1142` —
  `modifiers.grantKeywordWhileBeingChallenged.set(candidate.instanceId, [...])`
- **Expected reader**: the challenge-resolution path in `reducer.ts` when
  computing the defender's effective keywords — **but no consumer reads
  the Map**.
- **Runtime impact**: when a matching character is challenged, the granted
  keyword (e.g. `<Bodyguard>` / `<Resist>` / `<Ward>`) is not active during
  challenge resolution. Cards that rely on "while being challenged, gains
  keyword X" protection are silently broken.
- **Fix location**: the challenge reducer's effective-keyword lookup. Grep
  `reducer.ts` for the challenge action case; add a merge of
  `modifiers.grantKeywordWhileBeingChallenged.get(defenderId) ?? []` into
  the keyword set used for that specific challenge resolution only (the
  keyword should NOT persist outside the challenge — that's why it lives
  in a separate "while being challenged" field rather than the regular
  `grantedKeywords`).
- **Test pattern**: inject Captain Amelia's source in play, matching
  character gets challenged, assert the granted keyword is active for the
  challenge damage/banish resolution but not for a subsequent un-challenged
  action.

### 3. Vision Slab (`prevent_damage_removal` → `preventDamageRemoval`)

- **Populator**: `gameModifiers.ts:1110` — `modifiers.preventDamageRemoval = true;`
- **Expected reader**: `reducer.ts`'s `remove_damage` effect handler — **but
  no consumer checks the boolean**.
- **Runtime impact**: Vision Slab's "damage counters can't be removed
  globally" effect is a silent no-op. Cards that remove damage continue to
  remove damage while Vision Slab is in play.
- **Fix location**: `reducer.ts` `case "remove_damage":` — at the top of the
  handler, short-circuit with `if (getGameModifiers(state, definitions).preventDamageRemoval) return state;`
  (zero damage removed, effect is consumed). Consider whether the effect
  should noisily log or silently no-op — matches how similar global
  prevention primitives behave (`prevent_discard_from_hand`).
- **Test pattern**: inject Vision Slab in play, put damage on a character,
  apply a `remove_damage` effect, assert the character still has the
  damage counter afterward.

### Meta: why the audit catches this but the existing four don't

All four existing audits (`card-status`, `audit-cards`, `audit-approximations`,
`decompile-cards`) are TEXT-SHAPE checks — they validate JSON field names and
oracle-text similarity. None of them follow runtime data flow. A primitive
can have the correct emit-side case handler, the correct JSON, the correct
oracle text, and still silently no-op because no consumer reads the runtime
state it populates.

`pnpm audit-dead-primitives` fills that specific gap — emit-vs-read
reachability analysis via textual grep. Heuristic but effective: Hidden
Inkcaster + these 3 were sitting in production across 4+ sets undetected.

### Sequencing

Each of the 3 bugs is independent — wire them in any order. Each needs its
own regression test per CLAUDE.md's "validateX rejection must always be
paired with a getAllLegalActions test" rule (for Vision Slab and Flotsam
those are the relevant flavors; Captain Amelia is reducer-internal so the
test is on the challenge resolution). After each fix, re-run
`pnpm audit-dead-primitives` — the fixed entry should drop off the dead
list. When all 3 land, the audit should print `✓ All N StaticEffect
modifier fields have at least one reader.`

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

**Currently blocked on external action:**
- **R2 image self-hosting migration** — see dedicated section below ("Engine
  agent (primary) + UI agent (follow-up): self-host card images on R2"). Owns
  schema + 3 sync scripts (~2 days). Waiting on user to provision R2 bucket +
  DNS + credentials before end-to-end testing. Priority: do before MP deploy.

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

## Engine agent (primary) + UI agent (follow-up): self-host card images on R2

**Why now:** Every card JSON embeds a hot-link to `api.lorcana.ravensburger.com`.
Post-MP-deploy this becomes (a) a rate-limit dependency on Ravensburger's good
will, (b) a CORS blocker for canvas-based clip/deck-image export (near-term
priority), and (c) a fragility point — their CDN path includes a content hash
that will rotate eventually, breaking 2769 URLs across 19 JSON files at once.

Do this **before** Railway MP deploy, not after. Once multiplayer is live,
every game board render hammers Ravensburger.

### Scope for `engine-expert` (the bulk of the work)

This agent owns card-data imports, card JSON schema, and the types — so it owns
this migration. Work is roughly two days end-to-end.

**1. Schema additions to every card-JSON entry** (one-time migration script,
must be idempotent):
- `_imageSource: "ravensburger" | "lorcast" | "manual"` — parallel to existing
  `_source` but tracked independently (the two can diverge during pre-release —
  e.g. Ravensburger has card text before image, or vice versa).
- `_sourceImageUrl: string` — original upstream URL (preserves provenance so we
  can re-verify / re-pull without re-scraping the whole API).
- `_imageSourceLock?: true` — escape hatch mirroring existing `_sourceLock`, for
  cards where a lower-tier source has visibly better art than a higher tier.
- `imageUrl` gets rewritten to point at R2 (see path shape below).

**2. Three sync scripts, three tiers** (mirrors `ravensburger > lorcast > manual`
hierarchy already used for card data):

| Script | Writes tier | Refuses to overwrite |
|---|---|---|
| `scripts/sync-images-rav.ts` (extend existing `~/Desktop/Lorcana_Assets/rav-download-images.mjs`) | `ravensburger` | — (top tier) |
| `scripts/sync-images-lorcast.ts` (new) | `lorcast` | `ravensburger` tier |
| `scripts/sync-images-manual.ts` (new) | `manual` | `ravensburger` or `lorcast` |

Each script:
- Downloads from its source → resizes via sharp (small 200w / normal 450w /
  large 900w) → uploads to R2 → rewrites `imageUrl` + `_imageSource` +
  `_sourceImageUrl` in card JSON.
- Skips entries where `_imageSourceLock: true` already points at a lower tier.
- Manual script reads from `assets/manual-cards/{setCode}/{cardId}.jpg` (dev
  drops file → script picks up on next run). Use cases: super-early spoilers
  before any API has images, bad scans, playtest-only cards.

**3. R2 path shape** (preserves cache-busting on source upgrade):

```
https://cards.<domain>/set12/123_<sha256-of-image>_{small|normal|large}.jpg
```

Content hash in filename → `cache-control: public, max-age=31536000, immutable`
works. When Ravensburger upgrades a Lorcast-tier image, new hash = new URL =
forced refetch. Do NOT use canonical paths without hashes; CDN/browser caches
won't invalidate cleanly.

**4. Defer variants (enchanted/foil/cold-foil)** to a second phase. MVP ships
regular art only. The existing `resolveEntryImageUrl` in `deckRules.ts` already
handles per-variant lookup, so the scaffolding is there — but don't block the
migration on variant support.

**5. User-level ops (not an agent task, flag for user to do):**
- Provision Cloudflare R2 bucket (`lorcana-cards`).
- DNS: `cards.<domain>` → R2 public bucket.
- Generate R2 API credentials; add to `.env` as `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`.
- Optional: edge worker that falls back to Ravensburger on R2 miss (useful for
  set-drop days before the sync script runs).

### Scope for `ui-specialist` + `gameboard-specialist` (follow-up, ~30 min)

Once the R2 migration lands, fix these two bugs that are currently silent no-ops:

- `packages/ui/src/components/GameCard.tsx:239` —
  `def.imageUrl.replace("/digital/normal/", "/digital/small/")`
- `packages/ui/src/components/DeckBuilder.tsx:311` — same pattern
- `packages/ui/src/pages/DeckBuilderPage.tsx:308` — same pattern

The `/digital/normal/` path is **Lorcast-shaped**, not Ravensburger-shaped.
Since most cards import from Ravensburger, the replace is a no-op and we ship
the full 900w image to the board where a 200w thumbnail would do. After
migration, R2 paths encode the size as `_small` / `_normal` / `_large`, so the
swap becomes something like:

```ts
def.imageUrl.replace("_normal.jpg", "_small.jpg")
```

Ping `gameboard-specialist` for `GameCard.tsx`; `ui-specialist` for the two
deckbuilder files.

### Sequencing

1. `engine-expert` does schema + migration + sync scripts (~2 days).
2. User provisions R2 bucket + DNS (~1 hour).
3. Run one-time migration: download all existing images, resize, upload, rewrite
   JSON. Commit the JSON rewrite.
4. `ui-specialist` + `gameboard-specialist` fix the size-swap bugs (~30 min).
5. Then proceed with Railway MP deploy.

### Reference

- Strategy rationale + cost analysis: this session's chat log (strategy agent,
  2026-04-20).
- Existing download script: `~/Desktop/Lorcana_Assets/rav-download-images.mjs`.
- Existing importer hierarchy pattern: `scripts/import-cards-rav.ts` +
  `scripts/import-cards-lorcast.ts` (refuses-to-downgrade logic is the template).
- Existing `_sourceLock` precedent: The Bayou in card-set-1.json.

---

## Server agent: `decks` + `deck_versions` base-table DDL missing from schema.sql

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
