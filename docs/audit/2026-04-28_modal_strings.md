# Modal String Audit — 2026-04-28

Catalog of every modal that appears during gameplay, with every user-facing
string classified as **card data**, **engine state**, **hardcoded**, or
**mixed**. Generated from a top-down read of `packages/ui/src/components/`,
`packages/ui/src/pages/GameBoard.tsx`, and `packages/engine/src/engine/reducer.ts`
(for engine-supplied prompt strings).

Scope: in-game modals only. Lobby / deckbuilder / dev-tools / login / profile
modals are out of scope but mentioned briefly where adjacent.

---

## TOC

1. [PendingChoiceModal](#1-pendingchoicemodal) — universal choice prompt; 13 internal variants
2. [Game Over modal](#2-game-over-modal) — inline in `GameBoard.tsx`
3. [CardInspectModal](#3-cardinspectmodal) — full card detail
4. [ZoneViewModal](#4-zoneviewmodal) — discard / deck / cards-under / reveals
5. [Active Effects modal](#5-active-effects-modal) — inline in `GameBoard.tsx`
6. [SettingsModal](#6-settingsmodal) — GUI preferences
7. [BoardMenu](#7-boardmenu-bottom-sheet--dropdown) — kebab menu
8. [Mode toasts and info toasts](#8-mode-toasts-and-info-toasts)
9. [SandboxPanel](#9-sandboxpanel-dev-only-low-priority)
10. [Cross-cutting findings](#cross-cutting-findings)
11. [Recommendations](#recommendations)

Modals NOT found (claimed by user prompt as possibilities):

- **Rematch modal** — does not exist. End of MP Bo3 match shows a "Back to Lobby" button only; rematch is parked in HANDOFF.md.
- **Concede confirmation modal** — does not exist. `BoardMenu` "Concede" item dispatches immediately and the user sees the Defeat modal next.
- **Reconnection toast** — partial. There is a colored connection dot in `BoardMenu` (green / red-pulse) with `title` tooltip "Connected" / "Reconnecting…" but no modal or toast.
- **Takeback prompt** — not implemented (HANDOFF.md item).
- **`choose_play_order_in_zone`** — not a real PendingChoice type; speculative in user prompt.

Modals NOT YET HANDLED (engine constructs them but UI has no branch):

- **`choose_card_name`** — `prompt: "Name a card"` from reducer.ts:3800; UI falls through to the generic single-target branch and renders an empty grid. Effectively broken in interactive play.
- **`choose_player`** — `prompt: "Choose a player."` from reducer.ts:8314; same fallthrough problem.

---

## 1. PendingChoiceModal

**File:** `packages/ui/src/components/PendingChoiceModal.tsx` (1233 lines)
**Entry point:** `<PendingChoiceModal …>`
**Surfaced when:** `gameState.pendingChoice` is non-null AND
`pendingChoice.choosingPlayerId === myId` AND `!choiceModalHidden`. The modal
contains a "Peek" header button (eye icon) that hides the modal so the player
can see the board; a "View Choice" floating pill restores it.

The modal walks through 9 explicit branches by `pendingChoice.type`. The
`pendingChoice.prompt` field is **always engine-supplied text** (a string
literal in `reducer.ts`); the modal renders it as the headline of every branch
that surfaces it. See "Engine prompt sources" below for the full provenance.

### Branch-by-branch catalog

#### 1a. `choose_play_order` — coin-flip / Bo3 game-2 election

Lines 286–358. Has both a chooser-side (two big buttons) and an
opponent-perspective view.

| Location | String | Class |
|---|---|---|
| Opp-view headline | `"Opponent is choosing play order…"` | hardcoded |
| Opp-view body (game 1) | `"They won the coin flip and are picking whether to be the starting player."` | hardcoded |
| Opp-view body (Bo3 g2/g3) | `"They lost the previous game (${oppScore}–${myScore} in the match) and are picking whether to be the starting player."` | mixed (hardcoded + engine state) |
| Chooser headline (g1) | `"You won the coin flip"` | hardcoded |
| Chooser headline (Bo3) | `"Game ${matchScore.p1+matchScore.p2+1} — your choice"` | mixed |
| Chooser subtitle (g1) | `"Choose whether to be the starting player."` | hardcoded |
| Chooser subtitle (Bo3) | `"Match: ${myScore}–${oppScore}. You lost the last game, so you choose who starts."` | mixed |
| Helper microcopy | `"Going first skips turn-1 draw. Going second draws normally."` | hardcoded |
| Primary button (top) | `"Go First"` + sublabel `"On the play"` | hardcoded |
| Primary button (bottom) | `"Go Second"` + sublabel `"On the draw · draw turn 1"` | hardcoded |

**Engine `pendingChoice.prompt` is IGNORED for this branch** — the modal
substitutes its own scaffolding because the engine prompt
`"Choose whether to go first or second."` (initializer.ts:283) is too generic.

**Concerns:** none. Branch is well-isolated, prompts are accurate, and the
"first → on the play (skip draw)" / "second → on the draw, draw turn 1" hint
is the kind of contextual education a first-timer needs. Bo3 framing is
hardcoded but the embedded data (`matchScore`) is engine-supplied via the
server-injected `_matchScore`.

#### 1b. Cross-player perspective (waiting / opponent acts)

Lines 364–423. Catches every type other than `choose_play_order` /
`choose_mulligan` where `choosingPlayerId !== myId`. In sandbox mode this
renders so a single human can drive both seats.

| Location | String | Class |
|---|---|---|
| Title (opp `choose_may`) | `"Opponent's Decision"` | hardcoded |
| Title (other) | `"Opponent is choosing..."` | hardcoded |
| Body | `pendingChoice.prompt` (engine string verbatim) | engine-state (engine prompt = card-derived for `choose_may`, hardcoded for others — see §"Engine prompt sources") |
| Hints | `contextHints.join(" · ")` — see hint catalog below | mixed |
| Confirm button (single-target) | `"Confirm (as opponent)"` | hardcoded |
| Accept (opp may) | `"Accept (as opponent)"` | hardcoded |
| Decline (opp may) | `"Decline (as opponent)"` | hardcoded |

**Concerns:**

- The `(as opponent)` parenthetical only matters in sandbox mode. In real MP, the
  outer GameBoard gate prevents this branch from rendering for the non-chooser
  (they see the floating "Opponent is thinking…" toast instead). In sandbox the
  parenthetical is correct UX, in MP it would be confusing. The gate is in
  `pendingChoice.choosingPlayerId === myId` on line 2641; OK as-is.

#### 1c. `choose_amount` — quantity slider (heal up to 3, move up to 2 counters)

Lines 426–459.

| Location | String | Class |
|---|---|---|
| Body | `pendingChoice.prompt` | engine-state |
| Confirm button | `"Confirm (${chooseAmountValue})"` | mixed (hardcoded + state) |

Engine prompt source (reducer.ts:7596): `"Remove how much damage? (0–${maxHeal})"` — hardcoded but parameterized by computed max. Same shape at 7968 and 4884.

**Concerns:** none significant. The plus/minus stepper is functional. Engine prompt is generic ("Remove how much damage") — does NOT carry the source card's name or storyName. A player who triggered `Sudden Chill` and another effect that heals could see two `choose_amount` modals back-to-back with no way to distinguish them.

#### 1d. `choose_mulligan` — opening hand

Lines 462–517.

| Location | String | Class |
|---|---|---|
| Title | `"Opening Hand — Mulligan"` | hardcoded |
| On-the-play badge | `"On the play"` | hardcoded |
| On-the-draw badge | `"On the draw"` | hardcoded |
| Subtitle | `pendingChoice.prompt` | engine-state |
| Confirm (with selection) | `"Put back ${N}, draw ${N}"` | mixed |
| Confirm (empty) | `"Keep All"` | hardcoded |

Engine prompt source (reducer.ts:2161, 2217): `"Choose cards to put back (you will draw the same number). Select none to keep your hand."` — hardcoded.

**Drift risk:** The button label `"Put back ${N}, draw ${N}"` paraphrases the
mulligan rule. If Lorcana ever changes mulligan economics (e.g. London
mulligan), this string will lie about the action's effect. **Low risk** —
Lorcana mulligan is a CRD invariant.

#### 1e. `choose_order` — order picker (Hypnotic Deduction, Vision rest-on-bottom)

Lines 529–588.

| Location | String | Class |
|---|---|---|
| Title | `pendingChoice.prompt` | engine-state |
| Helper (uppercase) | `"Tap in order: first tap → bottom of deck · last tap → top of deck (next to draw)."` | hardcoded |
| Confirm button | `"Confirm order (${placedCount}/${total})"` | mixed |
| Reset button | `"Reset"` | hardcoded |

Engine prompt sources (reducer.ts:2458, 2669, 3541): paraphrased, e.g.
`"Choose the order to place the remaining ${rest.length} cards on the bottom of your deck (first selected = bottommost)."`

**Concerns:**

- The helper microcopy is **redundant** with the engine prompt. The engine
  prompt at reducer.ts:2458 already says "first selected = bottommost"; the UI
  helper says "first tap → bottom of deck". Both are correct, but they're
  saying the same thing in slightly different words. Player reads two near-
  identical sentences stacked.
- Wording inconsistency: the helper says "bottom of deck" while the engine
  prompts variously say "bottom of your deck" / "bottom of its deck" /
  "bottom of their players' decks". For top-of-deck flows, the engine prompt
  may say "top" while the helper still says "Tap in order: first tap → bottom"
  — actually the modal helper is hardcoded **bottom-first**, which is wrong
  for top-placement flows like reducer.ts:2669 ("Choose the order to put N
  cards on top of your deck (first selected = topmost / drawn first)") where
  first tap = top. **Bug.**

#### 1f. `choose_cards` / `choose_discard` — multi-select with revealed-hand display

Lines 591–678.

| Location | String | Class |
|---|---|---|
| Title | `pendingChoice.prompt` | engine-state |
| Subtitle (no targets) | `"No valid targets"` | hardcoded |
| Subtitle (with targets) | `"Select ${requiredCount} card(s)"` | mixed |
| Confirm | `"Confirm (${N}/${requiredCount})"` | mixed |
| Skip (no targets) | `"Skip"` | hardcoded |

Engine prompt sources for `choose_discard`:
- reducer.ts:5149 `"Discard a card?"`
- reducer.ts:5261 ``"Choose any number of card(s) to discard."``
- reducer.ts:5317 `"Choose ${discardCount} card(s) to discard."`

**Concerns:**

- `"card(s)"` parenthetical is a transparent attempt to handle 1-vs-many
  pluralization without conjugating. Cosmetic.
- Engine prompts here are generic ("Choose 1 card to discard") — they DO NOT
  cite the source card. If two effects in a chain both prompt the player to
  discard, the player has no way to tell which is which. Source-card context
  should come from `contextHints` but `contextHints` only fires on
  `last_resolved_target` / `last_resolved_source` / `last_damage_dealt`
  references, not generic discard prompts. **Drift risk.**

#### 1g. `choose_may` — may-prompt with card preview

Lines 681–727.

| Location | String | Class |
|---|---|---|
| Body | `pendingChoice.prompt` | mixed (engine constructs from card data) |
| Hints | `contextHints` | mixed |
| Accept button | `"Use ability"` | hardcoded |
| Decline button | `"Skip"` | hardcoded |

Engine prompt source (reducer.ts:6498):
```
const mayPrompt = rulesText
  ? `${cardName} — ${abilityName}: ${rulesText}`
  : `${cardName} — ${abilityName}: use this effect?`;
```

This is the **most card-data-faithful** prompt construction in the engine. It
splices `def.fullName`, the ability's `storyName` (in quotes), and the
ability's `rulesText` directly. The result reads like:

```
Goofy Knight for a Day — "BRAVE LITTLE TAILOR": ↷ — Each opponent
chooses and discards a card.
```

**Concerns:**

- The card preview on the left of the modal renders either the card image
  (default) or the card's structured rules text (when settings.cardDisplayMode
  === "text"). The structured rules text is rendered by `CardTextRender` which
  reads `def` directly — fully card-driven.
- Risk: if the rulesText is long, the prompt body gets truncated/wrapped
  awkwardly because it's pasted verbatim alongside the card image. The
  `text-sm` is small enough that 3-4 lines is OK, but a card with 6 lines of
  rules text (e.g. Belle Mechanic) will overflow.
- For cards with multiple may-abilities, the engine wraps each in a separate
  prompt. The `abilityName` quoting works correctly per-ability.

For the few engine prompts that override this construction with a hardcoded
shorter version (`reducer.ts:4646` "Put the top card of your deck into your
discard?", `reducer.ts:5053` "Pay to avoid the effect?", `reducer.ts:5110`
"YES! or NO!", `reducer.ts:5149` "Discard a card?"), the source card name is
**lost**. If the player has two simultaneous may-prompts (Tiana's
`opponent_may_pay_to_avoid` and another ability), they can't tell which is
which without checking the floating peek view.

#### 1h. `choose_trigger` — bag ordering (CRD 7.7.4)

Lines 730–791.

| Location | String | Class |
|---|---|---|
| Title | `"Triggered Abilities"` | hardcoded |
| Subtitle | `pendingChoice.prompt` | engine-state |
| Per-row card name | `def.fullName ?? trigger.sourceInstanceId` | card-data |
| Per-row ability name | `trigger.ability.storyName ?? "Ability"` | card-data |
| Per-row rules text | `trigger.ability.rulesText` | card-data |

Engine prompt source (reducer.ts:6398): `"Choose which triggered ability to resolve next."`

**This is the modal that does the BEST job of using card data.** Each row
renders the card image (or `<AbilityTextRender>` in text mode) plus the
card name, ability storyName, and rules text. All four fields are
direct passthroughs from `CardDefinition`.

**Concerns:** none significant. The fallback `"Ability"` for missing
storyName is rare in practice (most triggered abilities have a storyName).

#### 1i. `choose_option` — "Choose one: …" mode

Lines 795–870.

| Location | String | Class |
|---|---|---|
| Header (with storyName) | `${abilityStoryName} — ${srcDef.fullName}` | card-data |
| Header (no storyName) | `srcDef.fullName ?? "Choose one"` | card-data |
| Subtitle | `"Choose one"` | hardcoded |
| Per-option label | `extractOptionTexts(rulesText, count)[i]` | **card-data, parsed** |
| Per-option fallback | `"Option ${i+1}"` | hardcoded |

The `extractOptionTexts` function parses the source card's `rulesText` to find
the per-option labels:

1. Try splitting on `\n• ` lines (Lorcana's bullet convention).
2. Try splitting on `" or "` after stripping a `"Choose one:"` prefix.
3. Fallback to generic "Option N".

Engine prompt source (reducer.ts:5551): `"Choose one:"` — discarded by this
branch in favor of the parsed rulesText.

**Drift risk:** **HIGH.** The bullet-parser is brittle. If a card's rulesText
was imported with curly bullets (e.g. ●, ▪, ‣) instead of `•` (U+2022), the
bullet split fails. The fallback to ` or ` split is also brittle — Wrong
Lever! style cards with comma-separated branches fall back to "Option 1" /
"Option 2" generic labels. **Concrete drift risk:** if a future reprint
re-imports a card's rulesText with even slightly different formatting, the
option labels silently regress to "Option 1 / Option 2".

**Recommendation:** Engine should populate per-option labels into
`pendingChoice.options[i].label` so the UI doesn't re-parse rulesText.
Currently the choices array is shape `pendingChoice.options[i]` containing
the effects to apply, with no human label. Engine-side this is a small
addition; ABS handoff item if accepted.

#### 1j. Generic single/multi-target / `choose_from_revealed` (final fallthrough)

Lines 873–1178. Catches `choose_target`, `choose_from_revealed`, AND
incorrectly catches `choose_card_name` / `choose_player` (no UI branch).

| Location | String | Class |
|---|---|---|
| Title | `pendingChoice.prompt` | engine-state |
| Subtitle (multi) | `"Select up to ${targetCount} (${N}/${targetCount})"` | mixed |
| Hints | `contextHints` | mixed |
| Cap line | `"Selected ${label}: ${current} / ${limit}"` + `"over cap"` / `"below floor"` | hardcoded scaffolding + computed values |
| Section header (mine) | `"Your characters"` | hardcoded |
| Section header (opp) | `"Opponent's characters"` | hardcoded |
| Confirm (single) | `"Confirm"` | hardcoded |
| Confirm (multi) | `"Confirm (${N}/${targetCount})"` | mixed |
| Skip (optional w/ targets) | `"Skip"` | hardcoded |
| Skip (no targets) | `"OK"` | hardcoded |

The `filterLabel()` helper at top of file paraphrases CardFilter shapes into
plural labels: `"Songs"`, `"Madrigal Characters"`, `"Heroes"`, etc. This is
a UI-side **paraphrase of card data** (the JSON filter is structured data,
not English; the UI synthesizes the label).

Engine prompt sources (representative):
- reducer.ts:3104 `"Choose a target to deal damage to."`
- reducer.ts:3127 `"Choose a target to banish."`
- reducer.ts:3270 `"Choose a character to gain damage immunity."`
- reducer.ts:3305 `"Choose a character that can't be challenged."`
- reducer.ts:3411 ``"${cardName}: revealed ${revealedName}. ${effect.matchAction === "play_card" ? "Play it for free" : effect.matchAction === "to_hand" ? "Put it into your hand" : "Put it into inkwell exerted"}?"``
- reducer.ts:3946 ``count > 1 ? `Choose up to ${count} characters to exert.` : "Choose a character to exert."``
- reducer.ts:3991 ``"Choose a character to grant ${effect.keyword}."``
- reducer.ts:4206 ``"Choose a character that can't ${effect.action}."``
- reducer.ts:4295/4379 ``matchingCards.length === 0 ? "No matching cards found — continuing." : "Choose 1 card to set as the selected target (or skip)."``

**Concerns:**

- The vast majority of engine prompts in this branch are **generic templates**
  with the verb interpolated. They DO NOT carry the source card's name or
  storyName. Two simultaneous "Choose a character to banish." prompts (e.g.
  Be Prepared chained with Strength of a Raging Fire) read identically.
- The `${cardName}: revealed ${revealedName}` shape (reducer.ts:3411) is a
  rare exception that DOES carry the source card. This shape should be
  extended to all targeting prompts.
- "Section header (mine)" / "Section header (opp)" hardcoded English. Future
  i18n hazard.
- The `filterLabel()` heuristic appends a literal "s" to traits to pluralize
  — Floating becomes Floatings (the comment acknowledges this). For a
  one-off card this is fine; for a localized version it's broken.

### 1k. Engine prompt sources — the Cumulative List

Every `pendingChoice.prompt` string in the engine, by file location:

| Where | Prompt | Card-data tokens | Hardcoded scaffolding |
|---|---|---|---|
| initializer.ts:283 | `"Choose whether to go first or second."` | none | all |
| reducer.ts:607 | ``"${def.fullName} — choose ${exactCount} ${costType === ... }."`` | def.fullName | partial |
| reducer.ts:653 | ``"${def.fullName} — choose ${requiredAmount} card(s) to ${...} to Shift."`` | def.fullName | partial |
| reducer.ts:2161, 2217 | `"Choose cards to put back …"` | none | all |
| reducer.ts:2458, 2669, 3541 | `"Choose the order to place …"` | none | all |
| reducer.ts:3104 | `"Choose a target to deal damage to."` | none | all |
| reducer.ts:3127 | `"Choose a target to banish."` | none | all |
| reducer.ts:3139 | `"Choose a card to return to hand."` | none | all |
| reducer.ts:3187 | (variable, count-based) | none | all |
| reducer.ts:3229 | `"Choose a target."` | none | all |
| reducer.ts:3270 | `"Choose a character to gain damage immunity."` | none | all |
| reducer.ts:3305 | `"Choose a character that can't be challenged."` | none | all |
| reducer.ts:3411 | `"${cardName}: revealed ${revealedName}. …"` | cardName, revealedName | partial |
| reducer.ts:3461 | `"Choose a card to put on top/bottom of its owner's deck."` | none | all |
| reducer.ts:3496 | `"Choose ${pickCount} cards to put on top/bottom of your deck …"` | none | all |
| reducer.ts:3612, 3630 | `"Choose a character to move damage to/from."` | none | all |
| reducer.ts:3654 | `"Choose a card to put the top card of your deck under."` | none | all |
| reducer.ts:3719 | `"Choose a card whose under-pile to drain."` | none | all |
| reducer.ts:3738 | `"Choose a card or location to move cards under."` | none | all |
| reducer.ts:3783 | `"Choose a card to put this character under."` | none | all |
| reducer.ts:3800 | `"Name a card"` | none | all |
| reducer.ts:3833, 3860, 3892 | `"Choose a location/character to move …"` | none | all |
| reducer.ts:3946 | `"Choose a character to exert."` (or "up to N") | none | all |
| reducer.ts:3991 | `"Choose a character to grant ${effect.keyword}."` | keyword name | partial |
| reducer.ts:4084 | `"Choose a character to ready."` | none | all |
| reducer.ts:4169 | `"Choose a character that must quest if able."` | none | all |
| reducer.ts:4206 | `"Choose a character that can't ${effect.action}."` | action verb | partial |
| reducer.ts:4295, 4379 | `"No matching cards found — continuing."` / `"Choose 1 card to set as the selected target (or skip)."` | none | all |
| reducer.ts:4646 | `"Put the top card of your deck into your discard?"` | none | all |
| reducer.ts:4884 | `"Use this effect?"` | none | all |
| reducer.ts:5014 | `"Choose a character to remember."` | none | all |
| reducer.ts:5053 | `"Pay to avoid the effect?"` | none | all |
| reducer.ts:5110 | `"YES! or NO!"` | none | all |
| reducer.ts:5149 | `"Discard a card?"` | none | all |
| reducer.ts:5261 | `"Choose any number of card(s) to discard."` | none | all |
| reducer.ts:5317 | `"Choose ${discardCount} card(s) to discard."` | none | all |
| reducer.ts:5380 | `"Choose a card to put into inkwell."` | none | all |
| reducer.ts:5452 | `"Choose a target."` | none | all |
| reducer.ts:5511 | `"Choose a card to play (for free)."` | none | all |
| reducer.ts:5551 | `"Choose one:"` | none | all |
| reducer.ts:5671 | (variable, "Choose 1/N to ...") | none | all |
| reducer.ts:5711 | `"Choose a card to take."` | none | all |
| reducer.ts:5797 | `"Choose a character to grant challenge-ready"` | none | all |
| reducer.ts:5817 | `"Choose a character to bump sing cost"` | none | all |
| reducer.ts:5860 | `"Choose a character to gain the triggered ability this turn."` | none | all |
| reducer.ts:6398 | `"Choose which triggered ability to resolve next."` | none | all |
| reducer.ts:6506 | `${cardName} — ${abilityName}: ${rulesText}` (may-prompt) | def.fullName, ability.storyName, ability.rulesText | partial — best in class |
| reducer.ts:7596 | `"Remove how much damage? (0–${maxHeal})"` | none | all |
| reducer.ts:7968 | `"Move how much damage? (0–${maxMove})"` | none | all |
| reducer.ts:8033 | `"Choose a character to move damage to."` | none | all |
| reducer.ts:8073 | (variable based on character.maxCount) | none | all |
| reducer.ts:8104 | `"Choose a location to move to."` | none | all |
| reducer.ts:8314 | `"Choose a player."` | none | all |

**Summary:** Only 4 of ~50 prompts pull from card data: the may-prompt builder
(`reducer.ts:6498`), the Shift cost / banish-as-cost prompts
(`reducer.ts:607, 653`), and the search-and-play match prompt
(`reducer.ts:3411`). **Every other prompt is a hardcoded English template.**
This is a **moderate drift risk** because the prompts won't auto-update if
card text changes — but it's ALSO a feature: the prompts are mechanic-keyed,
not card-keyed, so two cards with the same mechanic share consistent prompts.

The deeper problem is that **the source card is rarely identifiable from the
prompt alone** outside the may-prompt path. Every targeting prompt should
include the source card's name and ability storyName at minimum.

---

## 2. Game Over modal

**File:** inline in `packages/ui/src/pages/GameBoard.tsx` lines 2656–2783.
**Surfaced when:** `isGameOver && !replayData`. Non-dismissable (intentional).

| Location | String | Class |
|---|---|---|
| Headline (you won) | `"Victory!"` | hardcoded |
| Headline (you lost) | `"Defeat"` | hardcoded |
| Headline (draw) | `"Draw"` | hardcoded |
| Subtitle (won) | `"You won the game"` | hardcoded |
| Subtitle (lost MP) | `"Your opponent won"` | hardcoded |
| Subtitle (lost solo) | `"The bot won"` | hardcoded |
| Subtitle (draw) | `"The game ended in a draw"` | hardcoded |
| Stats label (you) | `"You"` | hardcoded |
| Stats label (opp) | `"Opp"` | hardcoded |
| Stats label (turns) | `"Turns"` | hardcoded |
| Lore values | `gameState.players[X].lore` | engine-state |
| Turn count | `gameState.turnNumber` | engine-state |
| Bo3 prefix | `"Match:"` | hardcoded |
| Bo3 final | `"(final)"` | hardcoded |
| Primary CTA (Bo3 next game) | `"Next Game"` | hardcoded |
| Primary CTA (solo) | `"Play Again"` | hardcoded |
| Secondary CTA | `"Back to Lobby"` | hardcoded |
| Tertiary | `"Review"` / `"Download"` | hardcoded |

**Concerns:**

- **Subtitle drift risk:** "The bot won" assumes the opponent in solo mode is
  always a bot. In sandbox mode where a human controls both seats, the user
  loses to themselves and reads "The bot won" — slightly funny, not broken.
- The headline does NOT cite the win condition (lore vs deckout vs concede).
  CRD 1.8.1.1: lore, CRD 1.7.7: deckout. The user has to infer from the
  scoreboard. Worth surfacing — when a player decks out at 18 lore vs
  opponent's 19, the screen says "Defeat" with a 18–19 score and the user
  doesn't know whether the loss was deckout or lore.
- "Your opponent won" vs "The bot won" branches on `multiplayerGame`. If a
  future "vs friend pass-the-phone" mode lands, this branch becomes wrong.

---

## 3. CardInspectModal

**File:** `packages/ui/src/components/CardInspectModal.tsx` (381 lines)
**Surfaced when:** user taps a card's magnifier icon (popover) or via tap from `ZoneViewModal`.

This modal is mostly **card-data passthrough**. Sections:

### Header
| Location | String | Class |
|---|---|---|
| Card title | `def.fullName` | card-data |
| Card type | `def.cardType` (capitalized via CSS) | card-data |
| Rarity | `def.rarity.replace("_", " ")` | card-data (with cosmetic transform) |
| Set/number | `"Set ${def.setId} #${def.number}"` | mixed |
| Ink color badge | `def.inkColors[i]` (uppercased CSS) | card-data |
| Cost | `def.cost` | card-data |

### Stats row (characters/locations)
| Field | Source |
|---|---|
| Strength glyph + value | `def.strength` + computed effective with bonus |
| Willpower glyph + value | `def.willpower` + computed effective |
| Lore glyph + value | `def.lore` |
| Move glyph + value | `def.moveCost` |
| Shift label | `"Shift: ${def.shiftCost}"` | mixed (label hardcoded, value card-data) |

### Traits / Keywords
- Traits: `def.traits` + `gameModifiers.grantedTraits.get(instanceId)` — card-data + engine-state.
- Keywords: combines printed (filter on `type === "keyword"`), instance.grantedKeywords, instance.timedEffects with grant_keyword, and gameModifiers.grantedKeywords. Each is rendered as `capitalize(keyword)` — UI-side cosmetic transform.

### In-play state badges (if `instance.zone === "play"`)
| String | Class |
|---|---|
| `"Damage: ${N}"` | mixed |
| `"Exerted"` | hardcoded |
| `"Drying"` | hardcoded |
| `"${N} card(s) under"` | mixed |

### Rules text + flavor
- `def.rulesText` rendered by `renderRulesText` (swaps `{S}`, `{W}`, etc. for glyphs). **Pure card data.**
- `def.flavorText` italicized. **Pure card data.**

### Active effects (if `instance.timedEffects.length > 0`)

This is the most interesting section. For each grouped timed effect:

```
${srcName} ×N    {duration}
${srcText}
```

Where:
- `srcName = srcDef.fullName ?? "Unknown"` — card-data
- `srcText` is computed via a fallback chain:
  1. If `te.sourceStoryName` matches an ability on the source card → `${storyName} — ${ability.rulesText}` (card-data, full)
  2. If `te.sourceStoryName` exists but no ability matches → `storyName` alone
  3. If a non-keyword fallback ability has rulesText → `${storyName} — ${rulesText}` or just rulesText
  4. If `te.keyword` set → `capitalize(keyword)`
  5. Else → joined keyword list of source, or source's rulesText
- `duration = formatDuration(te.expiresAt)` — UI-side **paraphrase** of CRD durations:

```ts
"end_of_turn"             → "This turn"
"end_of_owner_next_turn"  → "Until their next turn"
"until_caster_next_turn"  → "Until your next turn"
"end_of_next_turn"        → "Until next turn"
"while_in_play"           → "While in play"
"permanent"               → "Permanent"
"once"                    → "Once"
default                   → d.replace(/_/g, " ")
```

**Concerns:**

- The duration mapping is **paraphrased**. CRD 9.5 / 9.6 use slightly different
  language ("until the start of your next turn" vs "Until your next turn").
  Acceptable for compact UI; would not match oracle text in a tooltip.
- The pronoun mapping ("their" / "your") assumes the viewing player is the
  caster. For a TimedEffect cast by the OPPONENT on YOUR character, the
  duration label "Until your next turn" reads ambiguously — is it the caster's
  next turn (opponent) or the viewer's? The CRD distinguishes
  `end_of_owner_next_turn` (anchored to affected card's owner) vs
  `until_caster_next_turn` (anchored to caster). The labels correctly match
  CRD semantics from the caster's perspective, but a viewing opponent reads
  them inverted. Fixable by checking `te.casterPlayerId === myId`.
- The `srcText` fallback chain is opaque — 5 branches, each fragile. If
  `sourceStoryName` is omitted from a TimedEffect (engine-side oversight), the
  modal silently falls back to the source's first non-keyword ability, which
  may not be the ability that produced the effect.

---

## 4. ZoneViewModal

**File:** `packages/ui/src/components/ZoneViewModal.tsx` (178 lines)

Used by:
- Discard zone viewer (`title="Your Discard"` / `"Opponent's Discard"`)
- Deck viewer (`title="Your Deck"`)
- Cards-under viewer (``title=`Cards Under ${parentDef?.fullName ?? "?"}` ``)
- Reveal modal — single mode (``title=`Revealed by ${sourceLabel}` `` for deck reveals; `sourceLabel` itself for hand reveals)
- Reveal modal — cumulative mode (``title=`Revealed this turn (${N} events, ${M} cards)` ``)

| Location | String | Class |
|---|---|---|
| Title | (caller-supplied) | varies |
| Count | `${cardIds.length} card(s)` | mixed |
| Empty state | `"No cards in discard"` | hardcoded — **WRONG when used by deck/reveal/cards-under viewers** |
| Owner badge (mine) | `"You"` | hardcoded |
| Owner badge (opp) | `"Opp"` | hardcoded |
| Section header | (caller-supplied via sections[i].title) | varies — see below |

### Reveal section title construction (in GameBoard.tsx:863, 828, 793)

For deck reveals, single-section title is ``"Revealed by ${srcDef?.fullName ?? "Card"}"``. **Card-data driven.**

For hand reveals, section title is ``"${handLabel} revealed by ${srcName}"`` where `handLabel = isMine ? "Your hand" : "Opponent's hand"` and `srcName = srcDef?.fullName ?? "an effect"`. **Mixed — card data + hardcoded perspective label.**

**Concerns:**

- The hardcoded **`"No cards in discard"` empty state** is misleading when this
  modal is used as a deck viewer ("Your Deck" — never empty during play but
  could be empty post-deckout) or a cards-under viewer ("Cards Under X" — a
  location with no cards under it). **Bug.**
- The ``"Revealed by Card"`` fallback (when `srcDef` is missing) is awkward
  but rare in practice.

---

## 5. Active Effects modal

**File:** inline in `packages/ui/src/pages/GameBoard.tsx` lines 2952–2997.
**Surfaced when:** user taps the bottom-right `ActiveEffectsPill`.

| Location | String | Class |
|---|---|---|
| Title | `"Active Effects"` | hardcoded |
| Per-row source | `e.sourceName ?? e.source` | card-data (with id fallback) |
| Per-row stack count | `"×${stackCount}"` | mixed |
| Per-row duration | `e.duration` | engine-state (paraphrased — same `formatDuration` as CardInspectModal? — actually no, the source `e.duration` comes from the active-effects collection elsewhere) |
| Per-row label | `e.label` | mixed (varies by source — the active-effect label builder paraphrases the effect type) |

**Concerns:** The label for each active effect is built upstream (in
`useActiveEffects` or similar) — I haven't traced that here, but the
modal-side rendering passes through whatever string the hook produces. If
those labels paraphrase ability rulesText, drift risk applies there. Worth a
follow-up audit specifically on the active-effects label builder.

---

## 6. SettingsModal

**File:** `packages/ui/src/components/SettingsModal.tsx` (161 lines)

| Location | String | Class |
|---|---|---|
| Title | `"Settings"` | hardcoded |
| Toggle 1 label | `"Stack identical items"` | hardcoded |
| Toggle 1 description | `"Group same-state copies of items into one staggered pile. Disable to show each item in its own slot."` | hardcoded |
| Toggle 2 label | `"Mirror opponent's play zone"` | hardcoded |
| Toggle 2 description | (long descriptive text) | hardcoded |
| Toggle 3 label | `"Flip opponent's cards upside-down"` | hardcoded |
| Toggle 3 description | (long descriptive text) | hardcoded |
| Segment label | `"Card preview style"` | hardcoded |
| Segment description | `"How cards render in choice / picker modals (e.g. choosing which triggered ability to resolve, or whether to use a may ability). Art shows the printed card image; Text shows structured rules text."` | hardcoded |
| Segment options | `"Art"` / `"Text"` | hardcoded |

**Concerns:** none. Pure preferences UI. All English; i18n hazard if
translation lands.

---

## 7. BoardMenu (bottom-sheet / dropdown)

**File:** `packages/ui/src/components/BoardMenu.tsx` (149 lines)

Items conditionally added:

| Item | String | Class |
|---|---|---|
| Game Log | `"Game Log"` | hardcoded |
| Sandbox tools (sandbox only) | `"Sandbox tools"` | hardcoded |
| Settings | `"Settings"` | hardcoded |
| Resign (MP, !gameOver) | `"Concede"` | hardcoded |
| Back/Concede | `"Back to lobby"` or `"Concede"` (per `backLabel` prop) | hardcoded |

Connection dot title: `"Connected"` / `"Reconnecting…"` (hardcoded).

**Concerns:**

- "Concede" appears twice as different items (resign during game vs
  back-to-lobby outside game). The label parity is intentional per the code
  comment but could confuse a sandbox user mid-game who sees both.

---

## 8. Mode toasts and info toasts

### InfoToast (passive)

| Where used | String | Class |
|---|---|---|
| Opp pendingChoice waiting | `"Opponent is thinking…"` | hardcoded |
| MP not-your-turn | `"Waiting for opponent…"` | hardcoded |

### ModeToast (interactive 2-step click flows)

| Mode | Label | Hint (sm+ only) | Class |
|---|---|---|---|
| Challenge | `"Challenge"` | `"tap a highlighted opponent card"` | hardcoded |
| Shift | `"Shift"` | `"tap a highlighted character"` | hardcoded |
| Sing | `"Sing"` | `"tap a highlighted character to sing"` | hardcoded |
| Sing Together | `"Sing Together"` | `"tap singers to add/remove"` | hardcoded |
| Move | `"Move"` | `"tap a highlighted location"` | hardcoded |

Sing Together additionally renders a ratio `${singTogetherTotalCost}/${singTogetherRequiredCost}` and a `"Confirm"` button.

DragOverlay action labels (when dragging a card): `"Challenge"`, `"Shift"`, `"Sing"`, `"Move"`, `"Ink"`, `"Quest"`, `"Play"` — all hardcoded.

Drop-zone overlays:
- Inkwell: `"Ink"`
- Quest divider: lore-pill tooltip `"You ${myLore} · Opp ${opponentLore} (first to ${loreThreshold})"` — mixed.
- Play zone: caller-supplied `dropLabel` (e.g. `"Play"`).

**Concerns:** consistent and minimal. None.

---

## 9. SandboxPanel (dev-only, low priority)

**File:** `packages/ui/src/components/SandboxPanel.tsx`

Section labels: `"Inject Card"`, `"Player Controls"`, `"Selected Card"`. Buttons
include `"Quick Save"`, `"Quick Load"`, `"Reset Board"`, `"Remove from game"`,
`"Auto-pass opponent turns"`. Inject button: `"Inject ${selectedDef.fullName}${qty>1?` x${qty}`:""}"` — uses `def.fullName`.

**Concerns:** none. Dev tooling.

---

## Cross-cutting findings

### a. Engine prompts are mechanically-keyed, not card-keyed

~50 distinct hardcoded English prompts in the reducer; only 4 cite the source
card by name. When two effects in a chain prompt the same way (e.g. two
"Choose a character to banish."), the player can't tell which card is
asking. The `choose_may` path is the gold standard — it splices fullName,
storyName, and rulesText. **Every targeting prompt should follow the same
pattern.**

### b. Three places paraphrase card text

1. **`extractOptionTexts`** in PendingChoiceModal.tsx — parses rulesText by
   bullets / "or" splits to label `choose_option` branches. **HIGH drift
   risk** if rulesText formatting ever changes.
2. **`filterLabel`** in PendingChoiceModal.tsx — synthesizes plural English
   labels from CardFilter shapes (`{cardType: "character", hasTrait: "Madrigal"}` →
   `"Madrigal Characters"`). **Low risk** but acknowledged in comments to be
   heuristic ("Floatings").
3. **`formatDuration`** in CardInspectModal.tsx — maps CRD duration enums to
   short English ("Until your next turn"). Caster-perspective mapping is
   correct from the caster's viewpoint; **wrong from the affected
   opponent's viewpoint** when they inspect a card their own caster targeted.

### c. Hardcoded English everywhere

Every modal scaffolding string is hardcoded English. No i18n infrastructure.
This is intentional given Lorcana being English-only today, but worth
flagging if localized clients are ever in scope.

### d. Confirm/Skip/OK button label inconsistency

- `"Confirm"` — choose_amount, choose_cards, choose_target, choose_order, choose_play_order generic
- `"Confirm (N/M)"` — choose_cards/discard, choose_order, choose_target multi
- `"Use ability"` — choose_may accept
- `"Skip"` — choose_may decline, choose_cards (no targets), choose_target (optional with targets)
- `"OK"` — choose_target (optional, no targets)
- `"Keep All"` — mulligan empty
- `"Accept (as opponent)"` / `"Decline (as opponent)"` — sandbox opp-may
- `"Confirm (as opponent)"` — sandbox opp-target
- `"Go First"` / `"Go Second"` — choose_play_order
- `"Reset"` — choose_order

The `"Skip"` vs `"OK"` distinction (when there are vs aren't targets) is a
genuine semantic difference (skipping an opportunity vs acknowledging an
empty effect). The `"Use ability"` vs `"Confirm"` distinction is more
arbitrary. Three different decline labels: `"Skip"`, `"Decline"`,
`"Decline (as opponent)"`.

### e. Title/subtitle styling inconsistency

Most modals use **yellow-300 bold** for the prompt title. Exceptions:
- `choose_play_order` chooser uses **amber-300 bold** for the headline.
- `choose_play_order` opponent uses **orange-300 bold**.
- `choose_mulligan` uses **indigo-200 bold**.
- `choose_trigger` uses **yellow-300 bold** but with a different label
  (`"Triggered Abilities"`) above the engine prompt.
- `choose_option` uses **yellow-300 bold** for the storyName/fullName
  header and a **gray-500 uppercase tracking-wider** subtitle ("Choose one").

Each color choice is intentional (purple = mulligan, amber = play-order
ceremony) but the modal "voice" varies between each — no unified visual
hierarchy.

### f. Pluralization patterns

`"card(s)"` parenthetical appears in 3 prompts. Other prompts conjugate:
`"Choose a character"` (singular) vs `"Choose up to ${count} characters"`
(plural). The `(s)` pattern is a code smell — pluralization should be done
properly (`pluralize(n, "card")`) or all card-quantity prompts should
include the count.

### g. Drift risk by modal

| Modal | Drift risk | Reason |
|---|---|---|
| PendingChoiceModal `choose_option` | **HIGH** | parses rulesText for option labels |
| PendingChoiceModal `choose_may` | LOW | full passthrough; engine builds prompt from card data |
| PendingChoiceModal `choose_target` | LOW | engine prompts are generic; won't lie about new cards |
| CardInspectModal | LOW | direct passthrough; only paraphrase is duration enum |
| CardInspectModal active-effects srcText | MED | 5-branch fallback chain; brittle to engine `sourceStoryName` plumbing |
| Game Over modal | LOW | engine state values; subtitles only branch on bot/MP/draw |
| ZoneViewModal | LOW | titles are caller-built |
| Mode toasts | LOW | hardcoded English, no card-text dependency |

### h. Resilience to new abilities

If a card gains a new sub-ability, the only modal that needs no work is
`choose_may` (the prompt builder consumes `ability.rulesText` directly) and
`choose_trigger` (renders rulesText per row). Every other modal would need
either an engine reducer update (to surface a `pendingChoice` for the new
mechanic) or a UI update (to handle a new `pendingChoice.type`). The two
unhandled types — `choose_card_name` and `choose_player` — are immediate
red flags.

---

## Recommendations

### High priority

1. **Fix `choose_card_name` and `choose_player` UI branches.** Both engine
   types exist and produce `pendingChoice` objects, but the modal has no
   branch for them. Currently they fall through to the generic single-target
   branch and render an empty grid with no input. This is broken for live
   gameplay (any card that names a card or chooses a player will dead-end the
   client).

2. **Fix `choose_order` helper microcopy** to match the actual deck-direction.
   Lines 537–539 hardcode `"first tap → bottom of deck · last tap → top of deck"`
   but the engine uses both top-first and bottom-first ordering depending on
   the source effect (Hypnotic Deduction = top, Vision rest = bottom). The
   helper should consult `pendingEffect.position` or be removed entirely
   (engine prompt already says "first selected = bottommost/topmost").

3. **Fix ZoneViewModal empty state.** The literal `"No cards in discard"` is
   wrong when this modal is used as a deck/cards-under/reveal viewer. Either
   pass an `emptyText` prop or default to `"No cards"`.

4. **Engine: cite the source card in every targeting prompt.** Migrate every
   reducer.ts prompt to follow the may-prompt pattern:
   `${cardName} — ${storyName ?? "ability"}: ${prompt}`. The data is already
   on the effect (sourceInstanceId is in scope at every prompt site).
   Without this, two simultaneous "Choose a target to banish." prompts in
   one trigger chain are indistinguishable. — **HANDOFF.md item for engine-
   expert.**

5. **Replace `extractOptionTexts` rulesText parsing with engine-supplied
   labels.** `pendingChoice.options[i].label` should carry the human-readable
   option text, populated by the reducer when the choose effect is created.
   Removes a fragile bullet-parser. — **HANDOFF.md item for engine-expert.**

### Medium priority

6. **Unify Confirm/Skip/Decline button labels.** Settle on a small lexicon:
   - Affirm a positive action: `"Confirm"` (with ratio if multi-select)
   - Affirm a may: `"Use"` (or `"Yes"`)
   - Decline: `"Skip"` or `"No"` consistently — pick one
   - Acknowledge empty: `"OK"`
   - Cancel a mode (toasts): `"Cancel"` (icon-only is fine)

7. **Surface win condition on Game Over modal.** Branch headline subtitle
   on `lore >= threshold` vs `deck.length === 0` vs `concededByPlayerId` so
   the player knows whether they decked out, conceded, or was beaten on lore.

8. **Active-effects label paraphrase audit.** The `e.label` strings in the
   active-effects modal come from a hook (`useActiveEffects`) I didn't trace
   in this audit. If those paraphrase ability text rather than passing through
   `ability.rulesText`, that's a class-3 paraphrase (in addition to
   `extractOptionTexts` and `filterLabel`).

9. **Caster-perspective duration labels.** `formatDuration` in
   CardInspectModal returns `"Until your next turn"` for `until_caster_next_turn`,
   but the viewing player may not be the caster (when inspecting an opponent-
   targeted opponent's card or vice-versa). Branch on
   `te.casterPlayerId === myId` and substitute "their" / "your" accordingly.

### Low priority

10. **i18n readiness.** Every English string is JSX-literal. If translation
    is ever in scope, every modal needs externalization. ~150 strings total.
    Not urgent.

11. **`"card(s)"` pluralization.** Replace with proper conjugation or always
    show the count.

12. **Unify modal title/headline color tokens** (yellow-300 / amber-300 /
    indigo-200 / orange-300). Use a single accent color for prompt titles
    across all modals; reserve secondary colors for state-specific badges
    (mulligan "On the play", play-order "You won the coin flip").

---

## Out of scope but adjacent

- **Card popover (action buttons fixed near a card)** — buttons are caller-
  supplied label strings (e.g. "Quest", "Challenge", "Sing"). Not a modal
  but worth catalog comparison since labels echo mode-toast labels.
- **InfoToast / ModeToast** — covered above as non-modal toasts.
- **Replay controls** — not a modal; lives in `ReplayControls.tsx`.
- **Lobby / DeckBuilder modals** — out of scope per audit prompt.
- **CardPicker inspect modal** — deck-builder only, outside gameplay.
