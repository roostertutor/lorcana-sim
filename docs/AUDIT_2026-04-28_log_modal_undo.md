# Audit 2026-04-28: Game Log, Modal Text, Undo Scope, RL Stream, MP Takebacks

This is the unified read-out of an overnight audit triggered by the user's question about paraphrasing in the Game Log + modals, the relationship between log and RL action stream, undo scope (specifically: "if I undo Diablo - Maleficent's Spy after the reveal, what state am I back at?"), and whether to extend undo into multiplayer ("takebacks").

Five detailed audit files were produced; this document synthesizes them with cross-references and a prioritized action list. **Read this first; drill into the source files for line-level detail.**

---

## TOC

1. [Executive summary](#executive-summary)
2. [Source files](#source-files)
3. [Topic A — Game Log strings](#topic-a--game-log-strings)
4. [Topic B — Modal text](#topic-b--modal-text)
5. [Topic C — actionLog ↔ RL action stream](#topic-c--actionlog--rl-action-stream)
6. [Topic D — Undo scope (incl. the Diablo question)](#topic-d--undo-scope)
7. [Topic E — MP takebacks design](#topic-e--mp-takebacks-design)
8. [Cross-cutting themes](#cross-cutting-themes)
9. [Prioritized action list](#prioritized-action-list)

---

## Executive summary

Five audit threads, four research agents + one me. Top findings:

1. **Engine paraphrases card text aggressively in the log.** 22/28 `appendLog` callsites are hand-written paraphrases; **0 are verbatim card-text passthroughs**. Several paraphrases drop information (banish causality, which ability activated, why a hand shrank). One downstream consumer (`runGame.ts:258`) string-matches `"mulliganed"` against the log prose to detect mulligans — exactly the anti-pattern this audit flags. (engine-expert; bot-trainer independently flagged the same coupling.)

2. **Modal targeting prompts are anonymous in 46/50 cases.** Only `choose_may` cites the source card by name + storyName + rulesText (gold standard at `reducer.ts:6498`). Every other targeting prompt is a generic English template ("Choose a target to banish."). Two simultaneous prompts are indistinguishable to the player. (gameboard-specialist.)

3. **Two `PendingChoice` types are unhandled in the UI** (`choose_card_name`, `choose_player`) → fall through to the generic single-target branch → empty grid, no input. **These will hard-block live play if any current or future card surfaces them.** (gameboard-specialist.)

4. **Undo is action-level replay** (`useGameSession.ts:472-484`); MP undo is disabled. The user's Diablo question has a precise answer: because Diablo's reveal is wired with `isMay: true`, the play splits into two actions (PLAY_CARD → may prompt, RESOLVE_CHOICE → accept). **One undo click backs out the resolve only (returns to the may prompt); two clicks backs out the whole play.** This granularity emerges implicitly from where `pendingChoice`s appear — drop `isMay` from a card and undo collapses to one click without warning. Fragile. (engine-expert.)

5. **`actionLog` and the RL action stream should NOT be unified.** Three distinct streams exist (`state.actionLog` paraphrased + lossy, `result.actions[]` canonical + lossless, `RLPolicy.episodeHistory` ML feature vectors); they have different audiences and cardinalities. **But there's a real bug:** `storage.ts:67` strips BOTH `actionLog` and `actions[]` from saved sim files → past games are unreplayable. Keep `actions[]` (~5KB/game), only strip `actionLog`. (engine-expert + bot-trainer.)

6. **MP takebacks design is solid and cheap to ship for Tier 0/1.** State-snapshot rollback already exists (`game_actions.state_before`); flipping it on requires a new `taken_back` flag column + a few hundred lines. Anti-cheat boundary: ranked = no takebacks, casual = neutral only, private = full stack with host config. **One open question requires user input** before shipping: should opponent inkwells be face-down per CRD (would make `PLAY_INK` fully neutral instead of ambiguous). (server-specialist.)

7. **Real gameplay bugs (not polish) surfaced:**
   - Lore-threshold wins set `isGameOver=true` with **no `game_over` log entry** (only deck-out logs win). `reducer.ts:8617`.
   - `applyActivateAbility` log paraphrase **drops which ability**: just `"X activated an ability on Y"`. `reducer.ts:1710`.
   - Banish log **drops causality** (challenge / damage / effect all flatten to `"Y was banished"`). `reducer.ts:6990`.
   - Effect-driven discard / look-at-hand / gain_lore / damage **silently mutate state with no log line** — players can't tell why their hand shrank or lore moved.
   - `choose_order` modal helper text **hardcodes "first tap → bottom"** — wrong for cards that place selected cards on TOP of deck.
   - `ZoneViewModal` empty-state hardcodes `"No cards in discard"` — wrong when reused as deck/reveal/cards-under viewer.
   - Game Over modal **doesn't surface win condition** (lore vs deckout vs concede invisible to players).

The combined impact: the log is descriptive but not a reliable record (players can't always reconstruct what happened), modal prompts are generic enough to confuse (especially with chained triggers), and a couple of UI hard-bugs are waiting for a card to surface them. Most fixes are small.

---

## Source files

The five audit documents live at `docs/audit/`:

| File | Author | Topic | Headline |
|---|---|---|---|
| `2026-04-28_engine_log_undo_rl.md` | engine-expert | Game log + undo + RL stream | 28 callsites, 22 paraphrases, 0 verbatim; undo = action-level replay; 3 distinct streams |
| `2026-04-28_modal_strings.md` | gameboard-specialist | In-game modal text | 9 modal surfaces, 13 PendingChoice types (2 unhandled), ~50 prompts (4 cite source) |
| `2026-04-28_modal_strings_non_gameboard.md` | ui-specialist (me) | Lobby/builder/settings chrome | Card-data heavy modals are drift-resistant; chrome is 100% English literals; `SAMPLE_DECKLIST` is the biggest drift risk |
| `2026-04-28_rl_log_action_stream.md` | bot-trainer | Should log = action stream? | Keep separate; current architecture principled; one fragile coupling at `runGame.ts:258` |
| `2026-04-28_mp_takebacks_design.md` | server-specialist | MP takebacks design | 4-tier system by info delta; state_before snapshot already exists; `takebacks` audit table for collusion detection |

---

## Topic A — Game Log strings

**Source**: `docs/audit/2026-04-28_engine_log_undo_rl.md` Topic 1 + `docs/audit/2026-04-28_modal_strings_non_gameboard.md` §8.

### What the engine prints

26 `appendLog` callsites in `reducer.ts` + 2 raw log writes in `initializer.ts` = 28 total. Classification:

- **Paraphrase**: 22 (hand-written summaries of what the engine just did — e.g. `"X drew Y"`, `"X quested for 2 lore"`, `"Y was banished"`, `"X activated an ability on Y"`)
- **Pure engine event**: 5 (turn start, win, mulligan announcement, etc. — no card text source)
- **Mixed**: 1
- **Card-text passthrough**: **0** — no log line prints `def.rulesText` or `ability.rulesText` verbatim

### Hardcoded vs softcoded

- `def.fullName` interpolation is universal (cards always referenced by name) — softcoded, drift-resistant.
- `ability.storyName` is **not** consistently used. Activated-ability log line drops it: `"player1 activated an ability on Mickey Mouse"`. Should read: `"player1 activated WAVE THE SCEPTER on Mickey Mouse"`.
- Verb phrases (`"drew"`, `"played"`, `"quested for"`, `"was banished"`, `"sang"`) are hand-written English literals. Acceptable for engine-event labels, but means **the log can never be localized** without a per-string translation table.
- Numbers (lore, damage, ink) are interpolated from state — softcoded.

### Concerns

**Information loss in paraphrases:**

1. **Banish log drops causality** (`reducer.ts:6990`): challenges, damage triggers, banish effects, and CRD 8.5.4 cleanup all collapse to `"Y was banished."`. Players reading the log can't tell *why* a card left play.
2. **Activated-ability log drops which ability** (`reducer.ts:1710`): a card with three activated abilities just logs `"player1 activated an ability on X"`. Engine has `ability.storyName` available; isn't using it here.
3. **Effect-driven mutations have no log lines**: `discard`, `look_at_hand`, `gain_lore`, `damage`, `move_damage`, `add_ink_from_hand`, etc. silently mutate state — no `appendLog`. Players can't reconstruct why their hand shrank between turns.
4. **Lore-threshold win has no `game_over` log** (`reducer.ts:8617`): only deck-out wins log. Players who win on lore see the victory modal but no log entry.

**Drift coupling:**

5. **`runGame.ts:258`** does substring matching on log message text to detect mulligans (`message.includes("mulliganed")`). Both engine-expert and bot-trainer flagged this independently. The simulator should derive mulligan state from the action stream (`actions[]`), not the human-readable log prose.

### Recommendation summary

- **Add log lines for every silent state mutation** (effect-driven discard, lore, damage, etc.). The log should be reconstructable: any player should be able to read it and see why their hand/lore/damage changed.
- **Add a `game_over` log line for lore-threshold wins.** One line; no design needed.
- **Use `ability.storyName` consistently** in activated-ability logs (mirrors what `choose_may` already does for prompts).
- **Add a structured `cause` field** to the banish log so the simulator / replay viewer can disambiguate (challenge / damage / banish-effect / CRD 8.5.4 cleanup) without prose parsing.
- **Fix `runGame.ts:258`** to derive mulligan state from `actions[]`, not log strings.

---

## Topic B — Modal text

**Sources**: `docs/audit/2026-04-28_modal_strings.md` (in-game modals) + `docs/audit/2026-04-28_modal_strings_non_gameboard.md` (chrome / builder / lobby).

### Modal landscape

**In-game** (gameboard-specialist):
- `PendingChoiceModal` — 13 engine `PendingChoice.type` values; 9 with explicit UI branches, 4 fall through to generic targeting
- Game Over modal (inline in `GameBoard.tsx`)
- `CardInspectModal` — also reused outside gameboard
- `ZoneViewModal` — discard / deck / cards-under / reveal viewer (one component, multiple uses)
- Active Effects modal (inline)
- `SettingsModal`, `BoardMenu`, `SandboxPanel`
- `InfoToast` / `ModeToast` / `TopToast`

**Non-gameboard** (me):
- `ModalFrame` (shared chrome — no strings)
- DeckBuilderPage inline modals (discard-changes, box-art picker)
- DecksPage (paste pane, tile chrome)
- MultiplayerLobby (1335 lines; ~18+ user-facing strings)

### Bugs (fix before polish)

1. **Two `PendingChoice` types unhandled in the UI**: `choose_card_name` and `choose_player`. Falls through to generic single-target branch → empty grid, no input control. **Live play crashes / blocks if a card surfaces these.** Search the engine for cards that use these types; if any exist, this is a P0.
2. **`choose_order` helper text hardcodes "first tap → bottom"** — wrong for cards that place picks on TOP. Player gets the order inverted on top-placement cards.
3. **`ZoneViewModal` empty-state** says `"No cards in discard"` regardless of which zone is being viewed (also used as deck / reveal / cards-under viewer). Wrong.
4. **Game Over modal doesn't surface win condition**: lore vs deckout vs concede currently invisible. Players see "You won!" with no context.

### Paraphrasing hot spots

3 places in the UI paraphrase card text (HIGH drift risk):

1. **`extractOptionTexts`**: parses `def.rulesText` to label `choose_option` branches. Bullet-parsing is brittle — if Ravensburger ever changes how they format multi-option cards, the labels become wrong.
2. **`filterLabel` (the helper from yesterday's per-filter-cap ship)**: synthesizes plural English from `CardFilter` shapes (`"Madrigal Characters"`). gameboard-specialist flagged the "Floatings" hazard — `{traits: ["Floating"]}` → `"Floatings"`. Heuristic pluralization will eventually produce something ugly.
3. **`formatDuration` switch (`CardInspectModal.tsx:370-381`)**: caster-perspective bug for opponent-targeted effects. `"until_caster_next_turn"` renders `"Until your next turn"` — but if the effect is on an OPPONENT's character (cast by you), the opponent's view says "your" referring to *you*, the caster, not them. Subtle.

### Targeting-prompt anonymity (the biggest UX gap)

~50 distinct prompt strings emitted by the engine. **Only 4 cite the source card.** The `choose_may` builder at `reducer.ts:6498` is the gold standard:

```
${def.fullName} — ${ability.storyName}: ${ability.rulesText}\nYou may ___?
```

Every other prompt uses a generic template like `"Choose a target to banish."`. When two abilities surface targeting prompts simultaneously (the bag pops a chain), they're indistinguishable to the player.

**Recommendation (gameboard-specialist's HIGH item):** migrate every targeting prompt to the may-prompt pattern — engine should always pass `def.fullName` + `ability.storyName` + `ability.rulesText` to the prompt builder. ~Half-day's engine work.

### Button-label vocabulary inconsistency

8+ variants across modals: `Confirm` / `Skip` / `Decline` / `OK` / `Done` / `Submit` / `Cancel` / `Pass` / `No thanks`. Pick a canonical pair (probably `Confirm` / `Skip`) and migrate. ~30 min cleanup.

### Drift risks (non-gameboard)

1. **`SAMPLE_DECKLIST` (DecksPage.tsx:24-39)** — 15 hardcoded card-name lines. If Ravensburger renames any of those cards, "Load sample" produces parse errors. **Highest single drift risk** in the chrome.
2. **Legality-drift tooltip wording** (DecksPage.tsx:240) — references `"migrate to Infinity"` even when the deck is already Infinity. Stale advice.
3. **`formatDuration` underscore-replace fallback** — new duration enum values render as `"some_new_duration"` until someone updates the switch.

### Drift-resistant surfaces (good news)

- `CardInspectModal` is mostly card-data passthrough (70-80% softcoded). Updating card JSON updates the modal.
- `CardTextRender` / `AbilityTextRender` are exemplary — every game-relevant string passes through `def`/`ability` fields with `renderRulesText` glyph token replacement.
- Settings/lobby/builder chrome is 100% hardcoded English. No drift risk; high translation cost if i18n ever ships.

---

## Topic C — actionLog ↔ RL action stream

**Sources**: `docs/audit/2026-04-28_rl_log_action_stream.md` (bot-trainer) + `docs/audit/2026-04-28_engine_log_undo_rl.md` Topic 3 (engine-expert).

### Verdict: KEEP THEM SEPARATE

Both agents arrived at the same answer independently. Three streams, three audiences, three cardinalities:

| Stream | Where | Audience | Shape | Cardinality per `applyAction` |
|---|---|---|---|---|
| `state.actionLog: GameLogEntry[]` | engine state | humans (game log UI) | English prose, paraphrased, privacy-filtered (`privateTo`) | **N entries** (action + per-trigger + per-effect) |
| `result.actions: GameAction[]` | `applyAction` return | replay / sim / clone trainer | typed `GameAction` discriminated union, lossless | **1 entry** |
| `RLPolicy.episodeHistory` | simulator memory | RL trainer (Actor-Critic + GAE) | 224+80-dim feature vectors per bot decision | **1 entry per bot-controlled action** |

Forcing 1:1 would either:
- Bloat the log with RL-grade structured data (hurts privacy, readability)
- Force the trainer to parse English prose (strictly worse than typed actions)

Neither is a good trade. **The current separation is principled.**

### Real bugs found

1. **`storage.ts:67` strips both `actionLog` AND `actions[]`** from saved sim files → **past games are unreplayable.** Should keep `actions[]` (~5KB/game) and only strip `actionLog` (regeneratable from actions). engine-expert's recommendation. **One-line fix; high value.**
2. **`runGame.ts:258` reads `mulliganed` from log prose** to detect mulligans. Both bot-trainer and engine-expert flagged this. Should derive from the action stream. **One-function fix.**

### Light coupling worth documenting

- `GameLogEntryType` (the discriminator on log entries) and the engine's event types overlap loosely. Currently fine; worth adding a JSDoc comment that clarifies these are independent enums.
- Some test code may inspect log content; should be reviewed and migrated to action-stream inspection where feasible.

### Recommendations

- **Document the streams contract.** Create `docs/STREAMS.md` (engine-expert's recommendation) explaining the three streams + which is canonical for what + when each is consumed. Prevents future drift like the `runGame.ts:258` coupling.
- **Add `actionIndex` field on `GameLogEntry`** linking back into `actions[]` for UI grouping (e.g. "show all log entries from action #42"). Cheap to add; enables better Game Log UX (collapsible groups per action).
- **Fix the `storage.ts` and `runGame.ts` couplings** as small targeted commits. Probably half a day total.

---

## Topic D — Undo scope

**Source**: `docs/audit/2026-04-28_engine_log_undo_rl.md` Topic 2.

### How it works today

**Undo lives entirely in the UI** (`useGameSession.ts:472-484`), not the engine. Mechanism:

1. Maintain `actionHistoryRef: GameAction[]` — every action successfully applied gets pushed.
2. On undo: `replayState = applyAction(initialState, actions.slice(0, -1))`.
3. Replace gameState with `replayState`; pop the last action.

Why it works: `applyAction` clones `state.rng` at entry (`reducer.ts:90`) so deterministic replay preserves the seed. There's an explicit regression test at `undo-rng-isolation.test.ts`.

**MP undo is disabled** (`useGameSession.ts:476`). Server is authoritative; client can't unilaterally rewind.

### The Diablo question — concrete answer

User asked: *"if I want to undo Diablo - Maleficent's Spy after the reveal trigger, am I undoing the whole playing part, or just undoing the trigger first?"*

Diablo is wired with **`isMay: true`** at `card-set-4.json:4496`. So playing Diablo splits into two engine actions:

1. `PLAY_CARD(diablo)` — pays cost, surfaces the may prompt (`pendingChoice = choose_may`)
2. `RESOLVE_CHOICE(accept)` — resolves the may → look_at_hand fires → `lastRevealedHand` populated → modal shows

Both actions land in `actionHistoryRef`. So:

- **One undo click** → pops `RESOLVE_CHOICE(accept)` → state replays back to "Diablo on the field, may prompt open, no reveal yet."
- **Two undo clicks** → pops `PLAY_CARD(diablo)` → state replays back to "Diablo in hand, ink not paid, no may prompt."

### The fragility

The granularity is **implicit** — it falls out of where `pendingChoice`s appear, not from any explicit undo policy. If a card author drops `isMay` from Diablo's wiring (e.g. converts the reveal to mandatory), the look fires inline during `applyPlayCard`, never surfaces a `pendingChoice`, never splits into two actions, and undo collapses to one click without warning.

**This is an undocumented coupling between card-data design and undo UX.** A regression test is recommended that asserts: after `PLAY_CARD` of any card with optional triggers, an undo returns to the may prompt (not pre-play).

### MP undo

Currently disabled. The MP takeback design (Topic E) is the path to extending undo into MP — different mechanism (server snapshot + opponent consent for info-gain), different UX (5-second pill vs unlimited solo undo), different anti-cheat boundary.

### Recommendations

- **Document the undo granularity contract** in code comments at `useGameSession.ts:472`. Explain the implicit "1 click = back to last pendingChoice" semantic.
- **Add a regression test** that exercises the "undo after a may trigger lands at the may prompt" invariant for ≥1 card per may-style ability shape.
- **Consider an explicit "undo to before this card was played" UX shortcut** — currently requires N clicks for cards with N pendingChoices. Maybe a "undo last full play" button alongside the granular undo. Out of scope for now; flagged.

---

## Topic E — MP takebacks design

**Source**: `docs/audit/2026-04-28_mp_takebacks_design.md`.

### The 4-tier proposal

| Tier | What | Mechanism | Consent | Allowed in |
|---|---|---|---|---|
| **0** | Pre-commit cancels (mid-pendingChoice, before Confirm) | Pure UI; backs out the in-flight choice | None — never landed | All formats |
| **1** | Neutral takebacks (INK_CARD misclick, undeclared QUEST) | Server snapshot rollback; 5-sec undo pill | None — no info delta | Casual + private |
| **2** | Private peeks (Diablo) | Server rollback + opponent consent flow | Opponent prompt: "Allow?" → Y/N | Private only |
| **3** | Public reveals (Powerline) | Same as Tier 2 + stronger UX language ("you both saw the cards but the effect is undone") | Opponent consent | Private only |
| **4** | Hard-locked (game-end, resigns, post-opponent-action) | Cannot be undone | — | Never |

### Mechanism is cheap

`game_actions.state_before` already exists in the schema. Takeback = `UPDATE games SET state = state_before` + new `taken_back` boolean column to flag the action for the replay viewer / clone trainer to filter. **No engine changes required.**

### Anti-cheat boundary (the load-bearing piece)

- **Ranked queue** → zero takebacks (touch-move discipline). Plumb through the existing `format.rotation.ranked` flag from yesterday's rotation-registry refactor.
- **Casual queue** → Tier 1 only (consent flows are too collusion-vulnerable between strangers).
- **Private lobbies** → full Tier 1+2+3 stack, host-configurable, default on.

**Server re-classifies every takeback request from the `events: GameEvent[]` stream — never trusts client's tier claim.** Any `card_revealed` / `hand_revealed` event in the stream bumps tier; `card_drawn` bumps to Tier 2 (drawing a card is self info-gain).

**A new `takebacks` audit table** logs every request + classification + outcome → post-hoc collusion detection (e.g. "this private-lobby pair has an unusual takeback ratio — investigate").

### 8 open policy questions

The design doc enumerates 8; the biggest one **needs your input** before shipping:

> **Should `stateFilter.ts` make opponent inkwells face-down per CRD?** Currently inkwells are visible to both players (the server filter doesn't redact them). That makes `PLAY_INK` an info-gain action (opponent learns which card you inked) — pushes it from Tier 1 (neutral) to Tier 2 (consent-required). If we fix the filter to redact inkwells per CRD 4.1.4, `PLAY_INK` becomes fully neutral and the most-common takeback case is also the cheapest UX.

The other 7 are smaller (mid-pendingChoice opponent-in-flight, network races, opponent disconnect during consent, animation honesty for Tier 3, Bo3 game-end boundaries, RNG safety for snapshot rollback, engine-version mismatches mid-deploy). Each has a default proposed; only the inkwell one is policy-shaped.

### Phasing

The doc proposes:
- **Phase 1**: Tier 0 (pure UI) — small, ship-anytime.
- **Phase 2**: Tier 1 (server endpoint + 5-sec pill) — ~1 day cross-package.
- **Phase 3**: Tier 2 (opponent consent flow) — ~2-3 days; bigger UI surface (consent prompt for opponent, request state across two clients).
- **Phase 4** (probably skip): Tier 3 (public reveals) — same as Phase 3 plus the toast wording. Marginal value.

### 20 edge cases

Enumerated in §11 of the source doc. The interesting ones:
- Mid-pendingChoice with opponent in flight (you Sudden Chill'd; opponent is choosing a discard; you click Undo)
- Network races (you click Undo; opponent simultaneously clicks Confirm on their own action)
- Opponent disconnect during a consent prompt (timeout? auto-deny?)
- Animation honesty for Tier 3 — proposal: **don't lie with reverse-animations**; show an honest toast: "you both saw the cards but the effect is undone"

---

## Cross-cutting themes

### Theme 1 — Paraphrasing happens at every layer; layers don't agree

- **Engine paraphrases card text into log lines** (22/28 sites)
- **Modals paraphrase card text into prompts** (~46/50 sites)
- **UI renderers (`CardInspectModal` / `CardTextRender` / `AbilityTextRender`) DON'T paraphrase** — they pass `def.rulesText` verbatim through `renderRulesText`

The contrast is striking. The further the surface is from the player's "I want to know what this card does" inspection, the more paraphrasing it does. The log + modal prompts paraphrase aggressively; the inspect-this-card view passes through.

**This is probably the right shape** (logs need brevity; inspect needs literal accuracy), but the inconsistency creates two failure modes:
- Players reading the log don't always match what cards say (engine paraphrase ≠ card text)
- Players reading prompts don't see the source card text (gameboard-specialist's "anonymous prompts" finding)

The fix is **consistent use of `ability.storyName` + `ability.rulesText` in paraphrasing layers** — even if the message is shorter than the full rulesText, citing the source ability lets players cross-reference.

### Theme 2 — String-parsing of structured data is the same anti-pattern in multiple places

- `runGame.ts:258` parses log prose to detect mulligan
- `extractOptionTexts` parses card `rulesText` to extract `choose_option` labels
- `formatDuration` paraphrases CRD duration enums
- `filterLabel` paraphrases `CardFilter` shapes into plural English

Each of these reaches for "human-readable string" when "structured field" was already available. Each is a drift coupling: the source data can change shape and the parser silently produces wrong output.

The pattern is "treat structured data as a string only at the very last UI rendering step; never parse strings to derive structure." The tooling supports this (CardFilter is fully typed; GameAction is discriminated; etc.). The audit found 4-5 sites that violate it.

### Theme 3 — Implicit contracts > explicit contracts in several places

- Undo granularity = "wherever pendingChoices appear" (implicit; one card-data change can change the click count)
- Log/action-stream relationship = "log is paraphrased, actions are canonical" (implicit; no docs)
- Modal-prompt source citation = "choose_may does it, others don't" (implicit; one builder is the gold standard, others diverged)

Each implicit contract is fine until it breaks — and when it does, the failure is usually silent and post-hoc. **Documenting these contracts (probably in `docs/STREAMS.md` and a few code comments) is cheap and high-leverage.**

### Theme 4 — UI hard-bugs hide behind low-frequency cards

The two unhandled `PendingChoice` types (`choose_card_name`, `choose_player`) and the `choose_order` "first tap → bottom" hardcoded helper are **broken if the right card is played, fine otherwise**. Manual MP testing uncovered Diablo's reveal modal bug, the draw-log leak, and the actionCount bug — all because somebody actually played the relevant card. These three bugs sit waiting for the next playtest.

---

## Prioritized action list

Triaged by impact / effort. Each item links to source-file detail.

### P0 — gameplay bugs (ship before next playtest)

1. **Verify `choose_card_name` and `choose_player` PendingChoice types are unused by current cards** — if any card in sets 1-12 surfaces these, the UI has no input control and play hangs. If unused: still fix the UI (add explicit branches with a clear "type unsupported" fallback). _gameboard-specialist's audit, "Unhandled engine types"_.
2. **Fix `choose_order` modal helper text** to read placement direction from the engine state (top vs bottom), not hardcode "first tap → bottom." _gameboard-specialist's audit_.
3. **Fix `ZoneViewModal` empty state** to read the zone name from props instead of hardcoding "discard." _gameboard-specialist's audit_.
4. **Add `game_over` log line for lore-threshold wins** at `reducer.ts:8617`. One line. _engine-expert's audit, Topic 1_.
5. **Surface win condition on Game Over modal** (lore vs deckout vs concede). _gameboard-specialist's audit_.

### P1 — drift / coupling fixes (compound over time)

6. **Fix `storage.ts:67`** to strip only `actionLog` from saved sims, not `actions[]`. Past games become replayable. One-line fix. _engine-expert's audit, Topic 3_.
7. **Fix `runGame.ts:258`** to derive mulligan state from `actions[]`, not log substring matching. _engine-expert + bot-trainer_.
8. **Replace `SAMPLE_DECKLIST` with engine helper** `getSampleDeck(format)`. Eliminates the "Load sample" drift risk on DecksPage. _ui-specialist (me)_.
9. **Audit `extractOptionTexts` rulesText parsing.** Parse failures should fall back to "Option N" labels rather than ship malformed text. _gameboard-specialist_.
10. **Conditional copy on legality-drift tooltip** — drop "migrate to Infinity" when deck already on Infinity. _ui-specialist (me)_.

### P1 — log information completeness

11. **Add log lines for effect-driven discard / lore / damage / draw mutations** so the log is reconstructable. _engine-expert's audit, Topic 1_.
12. **Use `ability.storyName` in activated-ability log** at `reducer.ts:1710`. _engine-expert's audit_.
13. **Add structured `cause` field to banish log** so simulator/replay can disambiguate without prose parsing. _engine-expert's audit_.

### P1 — modal prompt anonymity

14. **Migrate every targeting prompt to the may-prompt pattern** — engine passes `def.fullName + ability.storyName + ability.rulesText` to all prompts. ~Half-day engine work; eliminates "indistinguishable simultaneous prompts." _gameboard-specialist's HIGH item_.

### P2 — documentation

15. **Create `docs/STREAMS.md`** documenting the three streams (`actionLog` / `actions[]` / `episodeHistory`) and their contracts. _bot-trainer + engine-expert_.
16. **Add JSDoc on `GameLogEntry`** clarifying it's a derived projection (not source of truth). Prevents future couplings like `runGame.ts:258`. _bot-trainer_.
17. **Add code comment on `useGameSession.ts:472`** documenting the implicit undo-granularity contract. _engine-expert's audit, Topic 2_.

### P2 — consistency / polish

18. **Unify Confirm / Skip / Decline button vocabulary** across modals. ~30 min. _gameboard-specialist_.
19. **Consolidate hand-rolled modals through `ModalFrame`** (DeckBuilderPage discard-changes + box-art picker). _ui-specialist (me)_.
20. **Add regression test for undo-after-may-trigger** invariant. _engine-expert_.
21. **Audit `useActiveEffects` label builder** for paraphrase risk. _gameboard-specialist_.

### P2 — MP takebacks (separate roadmap)

22. **Tier 0 cancels (pre-commit)** — pure UI work, no server. Cheap; ship anytime. _server-specialist's Phase 1_.
23. **Tier 1 neutral takebacks (INK_CARD, undeclared QUEST)** — ~1 day cross-package. Requires user policy decision: should `stateFilter.ts` redact inkwells per CRD 4.1.4? (Affects Tier classification of `PLAY_INK`.) _server-specialist's Phase 2 + open policy Q1_.
24. **Tier 2 info-gain takebacks (private lobby only)** — ~2-3 days. Opponent consent flow, `takebacks` audit table. Big UI surface. _server-specialist's Phase 3_.

### P3 — i18n readiness (future)

- 100% English-literal codebase. Adding i18n infrastructure is a separate, larger project. ~3-5 hours for a string-key extraction sweep. Only worth it if localization is on the roadmap. _ui-specialist (me)_.

---

## Where to start (subjective)

If you want to ship something today, the highest-value smallest-effort items are **P0.4** (`game_over` log), **P0.5** (Game Over win condition), **P1.6** (`storage.ts:67` fix), and **P1.10** (legality-drift tooltip copy). Each is < 30 min. Together they'd resolve four real gameplay/replay bugs.

The biggest leverage item is **P1.14** (migrate prompts to may-pattern with source citation). Half-day's engine work, but it eliminates the "what's this prompt about?" UX gap across every multi-ability play and fixes most of the gameboard-specialist audit's recommendations in one sweep.

For MP takebacks: pick **the inkwell-visibility question first** (server-specialist open Q1). If inkwells go face-down, Tier 1 is much cleaner; if they stay visible, the most common takeback case (INK misclick) is consent-required and the design's complexity isn't justified for a low-value feature. **The whole takeback design hinges on this one CRD-conformance call.**
