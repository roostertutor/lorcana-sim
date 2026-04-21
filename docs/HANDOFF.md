# Cross-Session Handoff Notes

Items flagged by one session for another to pick up.

Conventions:
- List only **open** items. Strike-through DONE entries while a task is fresh,
  then delete them once the rationale is captured in the commit message or no
  longer needed for context. Keep a DONE entry only when it preserves non-trivial
  reasoning not in a single commit (multi-commit decisions, deliberate non-fixes).

---

## GUI / Sandbox agent: verify 5 newly-wired set-12 cards end-to-end

Five set-12 cards landed this session (2026-04-21) via commits `b7a4434` →
`6b831a1`. All primitives + wiring + engine tests land, but runtime visuals
and opponent-choice flow need sandbox-level verification. Likely 30-60 min
of hotseat playtime.

**Cards to verify** (in priority order — simpler first):

| # | Card | What to check |
|---|---|---|
| 164 | Escape Plan | **playRestriction gate**: card should be UNCLICKABLE / greyed in hand when <2 cards discarded this turn. After 2+ discards (e.g. play Dangerous Plan × 2), it becomes playable. On play, BOTH players see a "choose 2 characters → inkwell exerted" prompt in succession (caster first per CRD 7.7.4). Characters land in each player's inkwell as exerted. |
| 132 | Hero Work | **Timed grant triggered ability**: play Hero Work. Own characters gain +1 {S} (should show as existing stat delta badge). Then any own Hero-trait character challenges — trigger fires: each opponent loses 1 lore + you gain 1 lore. Next turn: effect expires (timed grant clears on PASS_TURN). |
| 121 | Jack-jack Parr | **3-way switch on mill**: card enters play. Pass turn back around. At start of your next turn: may-mill prompt. Accept → top card milled. Test each of 3 branches by stacking deck (use card injector with zone=deck): character → Jack-jack +2 {S}; action/item → Jack-jack +2 {L}; location → caster picks an opposing character to banish. |
| 97 | The Family Scattered | **Opponent 3-way partition**: play vs an opponent with ≥3 characters in play. Active player sees "Opponent is choosing..." wait state (existing pattern, `PendingChoiceModal.tsx:159`). Hotseat opponent sees 3 sequential modals: (a) return to hand, (b) bottom of deck, (c) top of deck. After all 3 resolve: 1 char in opponent's hand, 2 in opponent's deck (one at each end). |
| 231 | The Family's Scattered | Same effect as #97, different printing (Lorcast enchanted inkable). Both share identical actionEffects per repo alt-art convention. Quick spot-check: play both to confirm identical behavior. |

**Existing `PendingChoiceModal`** (`packages/ui/src/components/PendingChoiceModal.tsx:159-170`)
already handles `choosingPlayerId !== myId` — shows "Opponent is choosing..."
on the waiting player's screen and renders the prompt on the active chooser's
screen. This pattern is already exercised by set-4 Ursula's Plan, Be King
Undisputed, Triton's Decree (all `chooser: "target_player"`). Family
Scattered should work out of the box.

**Optional polish** (not blocking):
- "Step 1 of 3" indicator on the opponent's Family Scattered partition modals.
- Grouped "Family Scattered — waiting on opponent's 3 picks..." label on
  the active player's wait state instead of 3 consecutive "opponent is
  choosing" ticks.

**Don't touch**:
- Engine code, card JSONs, or primitive definitions — those are shipped.
- The 2 new primitives (`grant_triggered_ability_timed`, `reveal_top_switch`)
  have decompiler renderers as of commit [followup]; they score ≥0.85 on
  round-trip now.

---

## Engine agent: zone-move helper consolidation (deferred to dedicated session)

**Scope:** unify the duplicated target-resolution + pendingChoice + all-
iteration boilerplate across ~4-5 zone-move effect cases. Card JSON surface
stays 100% unchanged — the type discriminators (`banish`, `return_to_hand`,
`put_into_inkwell`, `put_card_on_bottom_of_deck`) remain separate for
readability; only the engine reducer internals consolidate. Precedent:
`reveal_hand` and `look_at_hand` already fall through the same case block
(`reducer.ts:2717`) differing only in a `privateTo` flag.

**Helper sketch:**
```ts
function resolveTargetAndApply(
  state: GameState,
  effect: Effect & { target: CardTarget; isMay?: boolean },
  opts: {
    prompt: string;
    promptForCount?: (n: number) => string;  // "up to N" variant
    perInstance: (s: GameState, id: string, ev: GameEvent[]) => GameState;
    setLastResolvedTargetOnTriggering?: boolean;  // Yzma BACK TO WORK pattern
    skipIfNotInPlay?: boolean;                     // banish/inkwell-from-play
  },
  sourceInstanceId: string,
  controllingPlayerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  events: GameEvent[],
  triggeringCardInstanceId?: string,
): GameState {
  // Handles chosen → pendingChoice, all → iterate, this / triggering_card
  // → direct perInstance application.
}
```

**Scope:** 4 target cases (+maybe shuffle_into_deck). `put_card_on_bottom_of_deck`
covers only its `from: "play"` branch — `from: "hand"` / `from: "discard"`
use different auto-pick patterns.

**LOC savings (measured):**

| Case | Before | After | Saves |
|---|---|---|---|
| `banish` (applyEffect branch) | 44 | ~10 | 34 |
| `return_to_hand` (applyEffect branch) | 46 | ~12 | 34 |
| `put_into_inkwell` chosen-play branch | ~30 | ~12 | 18 |
| `put_card_on_bottom_of_deck` from:play | ~30 | ~12 | 18 |
| Helper + unit tests | 0 | +60 | — |
| **Net** | — | — | **~100 LOC removed, centralized** |

**Don't touch in first pass:**
- `shuffle_into_deck` — has post-iteration shuffle step, fits but adds
  option-bag complexity. Defer.
- `discard_from_hand` — has random/chooser modes that don't fit the helper.
- `play_card` — very different semantics (cost payment, triggers, shift).

**Gotchas confirmed during exploration (2026-04-21):**
- `banish` uses its own `banishCard()` helper that wraps zoneTransition with
  challenge context (fromChallenge / challengeOpponentId). The perInstance
  callback must call `banishCard(s, id, defs, ev)` to preserve this.
- `return_to_hand` sets `lastResolvedTarget` for Yzma BACK TO WORK's
  "target_owner" follow-up. `setLastResolvedTargetOnTriggering` option.
- `put_into_inkwell` has post-move side effects: `updateInstance(isExerted)`
  when `enterExerted: true`, then queue `card_put_into_inkwell` trigger.
  perInstance handles all of this internally.
- `put_card_on_bottom_of_deck` from:"play" respects `chooser: "target_player"`
  as of commit 6b831a1 — the helper must preserve this, not hardcode
  `controllingPlayerId` for the chooser.

**Reference precedent (in-code):** `reveal_hand` / `look_at_hand` share a
case block (`reducer.ts:2717-2744`), differing only in a `privateTo` flag.
Same philosophy at the target-resolution layer.

**Deferred — estimated 2 hours for a dedicated session. Non-urgent.** Card
JSON doesn't change, so no downstream work. Refactor purely reduces
reducer.ts maintenance surface.

## Engine agent: deferred / low-priority queue (verified against code 2026-04-20)

Items NOT currently blocking anything, kept here so they don't need to live in
an agent's memory. Each entry confirmed by reading the code, not from memory.

**1. Wire the 17 set-12 stubs**
- 14 fits-grammar (9 Lorcast pre-release — rename risk until Ravensburger
  mirrors; 5 pre-existing Ravensburger silent no-ops surfaced by the action-stub
  audit fix: Firefly Swarm, Hero Work, Dangerous Plan, You've Got a Friend in Me,
  plus one more — diff `pnpm card-status --category fits-grammar` to confirm)
- 1 needs-new-type: Escape Plan — "each player puts 2 characters into their
  inkwell facedown and exerted" requires bilateral-target primitive + a new
  inkwell-exerted state flag
- 2 unknowns: `The Family Scattered` #97 (Rav) vs `The Family's Scattered`
  #231 (Lorcast) — same effect, different names/numbers. Design call needed:
  merge into one definition with `variants[]` (like enchanted alt-arts), or
  keep as distinct printings?

**2. Reverse compiler — oracle text → JSON wiring** (see dedicated section
below — "TBD: reverse compiler — oracle text → JSON wiring"). Auto-wires the
~80% of cards that match templated grammar on new-set import.

**3. Simulator multi-pick enumerator bug** (`packages/simulator/src/rl/policy.ts:232-242`)
- `choose_from_revealed` only emits single-pick candidates. Multi-pick effects
  (Dig a Little Deeper: pick exactly 2) underfill — bot takes 1 instead of 2.
- Surgical fix, ~1-2 hours. Details in the existing "Simulator: bot policy
  enumerator only generates single-pick" section below.

**4. CRD 1.8.4 strict simultaneity** (low impact — no current card)
- `runGameStateCheck` (reducer.ts:7870) has an explicit `while (changed)` loop
  implementing 1.8.3 cascading. Banishes within a single pass happen in
  object-iteration order, not truly parallel. Matches 2P behavior correctly;
  would matter only if a 3+P variant ships OR if a "leaves play together"
  trigger (CRD 7.4.3) becomes sensitive to banish ordering within a pass.
- Rest of CRD 1.8 is fully implemented (1.8.1.1, 1.8.1.2, 1.8.1.4, 1.8.2, 1.8.3
  all ✅ — verified in code).

**5. CRD 6.5 remaining edge cases** (low impact — no current card)
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

**6. GameEvent system — piped to UI, but few downstream consumers**
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
