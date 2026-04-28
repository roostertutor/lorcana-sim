# Engine audit — game log, undo, RL action stream

Date: 2026-04-28
Scope: research only, no code changes. Targets three questions that share the
`actionLog` / `applyAction` surface.

## Table of contents

1. [Topic 1 — Game log: passthrough vs paraphrase vs hardcode](#topic-1-game-log)
   1. [Inventory of every appendLog callsite](#11-inventory)
   2. [Classifications and patterns](#12-classifications)
   3. [Wording vs Lorcana convention](#13-wording-vs-lorcana-convention)
   4. [Privacy stamps (already shipped)](#14-privacy-stamps-already-shipped)
   5. [Recommendations](#15-recommendations-topic-1)
2. [Topic 2 — Undo scope](#topic-2-undo-scope)
   1. [Where undo lives](#21-where-undo-lives)
   2. [Atomic unit](#22-atomic-unit)
   3. [Diablo, Sudden Chill, multi-effect, mid-may scenarios](#23-scenarios)
   4. [UX surface](#24-ux-surface)
   5. [Recommendation](#25-recommendation-topic-2)
3. [Topic 3 — actionLog vs RL action stream](#topic-3-actionlog-vs-rl-action-stream)
   1. [Shapes](#31-shapes)
   2. [Direct comparison](#32-comparison)
   3. [Should they be 1:1?](#33-should-they-be-11)
   4. [Recommendation](#34-recommendation-topic-3)
4. [Cross-topic findings](#cross-topic-findings)

---

# Topic 1 — Game log

## 1.1 Inventory

There are **26** `appendLog` callsites in `reducer.ts` plus **2** raw
`actionLog: [...]` writes in the initializer (which bypass the helper). All
appendLog calls go through `utils/index.ts:853`. The helper is a pure
state-spread that only stamps `timestamp`, so every entry's `type`, `playerId`,
`turn`, `message`, and `privateTo` come from the callsite itself.

Citations below: `reducer.ts:NNN` is the file
`packages/engine/src/engine/reducer.ts`. `initializer.ts:NNN` is
`packages/engine/src/engine/initializer.ts`.

### Direct write (bypass appendLog) — initializer

| # | Site | Type | Message template | Class | Source of fields |
|---|------|------|------------------|-------|------------------|
| I1 | `initializer.ts:235`-241 | `game_start` | `"Game started."` | pure-engine, hardcoded | none |
| I2 | `initializer.ts:258`-271 | `card_drawn` | `` `${playerId} drew: ${cardNames}.` `` | paraphrase + softcoded names | `definitions[...].fullName` per card; `privateTo` stamped |

The opening-hand log batches all opening cards into one entry per player. The
per-turn `applyDraw` log emits one entry per card. That's an inconsistency: a
log replay tool can't tell whether "drew: A, B, C, D, E, F, G" meant seven
discrete `card_drawn` events or one synthetic batch.

### appendLog callsites — reducer.ts (in source order)

| # | Line | Function / context | Type | Message template (literal) | Classification |
|---|-----:|-------------------|------|---------------------------|----------------|
|  1 | 532 | `applyPlayCard` Sing Together | `card_played` | `` `${playerId} played ${def.fullName} (Sing Together: ${singerNames}).` `` | paraphrase, softcoded |
|  2 | 550 | `applyPlayCard` solo sing | `card_played` | `` `${playerId} played ${def.fullName} (sung by ${singerDef.fullName}).` `` | paraphrase, softcoded |
|  3 | 619 | `applyPlayCard` granted free-play (Pudge) | `card_played` | `` `${playerId} played ${def.fullName} for free.` `` | paraphrase, softcoded |
|  4 | 675 | `applyPlayCard` alt-cost shift discard | `card_played` | `` `${playerId} discarded ${names.join(" and ")} to shift ${def.fullName}.` `` | paraphrase, softcoded |
|  5 | 684 | `applyPlayCard` alt-cost shift banish | `card_played` | `` `${playerId} banished card(s) to shift ${def.fullName}.` `` | paraphrase, partly hardcoded — drops banished card identity |
|  6 | 871 | `applyPlayCard` Shift onto target | `card_played` | `` `${playerId} shifted ${def.fullName} onto ${definitions[shiftTarget.definitionId]?.fullName}.` `` | paraphrase, softcoded |
|  7 | 894 | `applyPlayCard` action played (non-sung) | `card_played` | `` `${playerId} played ${def.fullName}.` `` | paraphrase, softcoded |
|  8 | 930 | `applyPlayCard` character/item played | `card_played` | `` `${playerId} played ${def.fullName}.` `` | paraphrase, softcoded |
|  9 | 1037 | `applyPlayInk` | `card_put_into_inkwell` | `` `${playerId} added ${def.fullName} to their inkwell.` `` | paraphrase, softcoded, `privateTo` stamped |
| 10 | 1092 | `applyQuest` | `card_quested` | `` `${playerId}'s ${def.fullName} quested for ${loreGained} lore.` `` | paraphrase, softcoded |
| 11 | 1457 | `applyChallenge` | `card_challenged` | `` `${playerId}'s ${attackerDef.fullName} (${attackerStr}) challenged ${defenderDef.fullName} (${defenderStr}).` `` | paraphrase, softcoded |
| 12 | 1549 | `performMove` | `character_moved` | `` `${playerId} moved ${charDef?.fullName ?? characterInstanceId} to ${locDef?.fullName ?? locationInstanceId}.` `` | paraphrase, softcoded; falls back to instance ID on missing def |
| 13 | 1605 | `applyBoostCard` | `ability_activated` | `` `${playerId} Boosted ${def.fullName} (paid ${cost} ink, put top of deck under).` `` | paraphrase, softcoded; the parenthetical is engine-prose, not card text |
| 14 | 1710 | `applyActivateAbility` | `ability_activated` | `` `${playerId} activated an ability on ${def.fullName}.` `` | paraphrase, **lossy** — drops which ability |
| 15 | 1728 | `applyPassTurn` | `turn_end` | `` `${playerId} passed the turn.` `` | pure-engine, hardcoded |
| 16 | 1794 | `performTurnTransition` deck-out loss | `game_over` | `` `${playerId} has no cards in deck at end of turn. ${winner} wins!` `` | pure-engine, hardcoded |
| 17 | 2057 | `performTurnTransition` start of next turn | `turn_start` | `` `${opponent}'s turn begins.` `` | pure-engine, hardcoded |
| 18 | 2083 | `applyDraw` | `card_drawn` | `` `${playerId} drew ${cardName}.` `` | paraphrase, softcoded, `privateTo` stamped |
| 19 | 2146 | `applyResolveChoice` choose_play_order | `choice_made` | `` `${chooserId} chose to go first.` `` / `` `${chooserId} chose to go second (${opponentId} goes first).` `` | pure-engine, hardcoded |
| 20 | 2193 | `applyResolveChoice` mulligan | `mulligan` | `` `${playerId} mulliganed: ${cardsToReturn.map(...).join(", ")}.` `` / `` `${playerId} kept their opening hand.` `` | paraphrase, softcoded names; `privateTo` stamped on the names branch |
| 21 | 2627 | `applyResolveChoice` granted-free-play resolve | `card_played` | `` `${playerId} played ${charDef.fullName} for free.` `` | paraphrase, softcoded — duplicates #3 |
| 22 | 6464 | `processTriggerStack` trigger fired | `ability_triggered` | `` `${cardName}'s ability "${abilityName}" triggered.` `` | paraphrase + softcoded; `abilityName` from `trigger.ability.storyName` (good) |
| 23 | 6478 | `processTriggerStack` may-cost unaffordable | `ability_triggered` | `` `${cardName}'s "${abilityName}" skipped — cost can't be paid.` `` | paraphrase + softcoded; only-engine-rationale prose |
| 24 | 6990 | `zoneTransition` reason=banished | `card_banished` | `` `${def.fullName} was banished.` `` | paraphrase, softcoded; **drops causality** (no challenge/effect/discard distinction) |
| 25 | 7621 | applyEffect `remove_damage` | `effect_resolved` | `` `Removed ${actualRemoved} damage from ${targetName}.` `` | paraphrase, softcoded; **misses the source attribution** (whose effect was it?) |
| 26 | 7888 | applyEffect free-play character | `card_played` | `` `${controllingPlayerId} played ${def.fullName} for free.` `` | paraphrase, softcoded — duplicates #3 / #21 |

### Notable absences from the log

These engine actions have **no** `appendLog` call. Some intentional, some are gaps:

| Event | Why missing | Recommendation |
|-------|-------------|----------------|
| Lore-threshold win (`runGameStateCheck` at `reducer.ts:8617`) | `isGameOver=true` set without log | **Bug** — the only `game_over` log is for deck-out (#16). Add a `game_over` log at win-by-lore. |
| Effect-driven banish (e.g. `banish` action effect target=chosen) | `banishCard` calls `zoneTransition` which logs (#24) | OK |
| Damage dealt outside challenge (`deal_damage` effect) | No log line per damage | Maybe add — currently invisible until damage triggers a banish |
| `gain_lore` effect (Be Prepared, Friends on the Other Side, etc.) | No log line | The lore counter changes silently — players reading the log can't tell why their lore went up |
| Hand reveal / look-at-hand | No log line, only `lastRevealedHand` snapshot | **Recommended add** — privateTo'd entry of "X looked at Y's hand: A, B, C." |
| Discard from hand (Sudden Chill, Be Prepared) | Only events emitted, not logged | Add `card_discarded` log |
| Heal / remove damage | Logged at #25 but **only when amount > 0** | Note: silent no-op when no damage. OK. |
| Card_revealed (top of deck) | No log line | **Recommended add** — the reveal modal relies on transient `lastRevealedCards` only |
| Ability activated cost (e.g. exert + ink) | Hidden inside the `activated` log #14 | Bundle with #14 if expanded |

## 1.2 Classifications

Across the 26 reducer + 2 initializer sites (28 total):

- **Pure passthrough (rulesText copy)**: 0 sites. Nothing in the log is a literal
  copy of the card's `rulesText`. The engine never prints card text verbatim.
- **Paraphrase**: 22 sites. All play / quest / challenge / draw / banish /
  inkwell / mulligan / shift / sing / activate-ability / boost.
- **Pure engine event**: 5 sites — turn start / end (#15, #17), game start (I1),
  deck-out (#16), play-order (#19).
- **Mixed paraphrase/engine**: trigger logs (#22, #23) — the wording is engine
  prose but `abilityName` is sourced from `ability.storyName` (data-driven).

Hardcoded vs templated breakdown:

- **Fully hardcoded** (no field interpolation): "Game started." (I1).
- **Fully softcoded** (one or more interpolated names): all 26 reducer entries
  except (#15) "passed the turn" and (#17) "turn begins" interpolate `playerId`
  only. Player IDs are `"player1" | "player2"` literal IDs, **not** display
  names — see [1.3](#13-wording-vs-lorcana-convention).
- **Engine prose mixed with data**: #13 boost ("paid ${cost} ink, put top of
  deck under") is engine-flavoured commentary, not the card's exact wording.

## 1.3 Wording vs Lorcana convention

Comparison against typical TTS / duels.ink / printed rulebook phrasing:

| Engine writes | TTS / duels.ink convention | Notes |
|---------------|---------------------------|-------|
| `player1 played Mickey Brave Little Tailor.` | `Player1 plays Mickey Mouse - Brave Little Tailor.` | Tense (past vs present); no display name; no em-dash separator |
| `player1's Stitch (3) challenged Pete (4).` | `Stitch challenges Pete (3 vs 4 strength).` | Acceptable but Lorcana doesn't print the strength — engine prose |
| `player1's Mickey quested for 3 lore.` | `Mickey quests for 3 lore.` | Tense + apostrophe-S |
| `player1 added Tipo to their inkwell.` | `Player1 inks Tipo (face-down).` | Engine wording is wordier |
| `Mickey was banished.` | `Mickey is banished.` | Tense |
| `Mickey's ability "TRIPLE SHOT" triggered.` | "Triggers TRIPLE SHOT" or just shows the rulesText | The double-quoted ALL-CAPS keyword is ours; print cards put story names in italic / small caps |
| `player1 Boosted Pegasus (paid 1 ink, put top of deck under).` | "Player1 activates Boost on Pegasus." | The parenthetical commentary is engine-only |
| `player1 activated an ability on Genie.` | `Genie activates LET ME OUT.` | We drop the ability name entirely — the most lossy entry in the system |

None of the engine messages are pulled directly from card data; all are
engine-authored prose. **No site is a "passthrough"** — replacing all paraphrases
with rulesText would require a separate decompiler step (see Topic 1.5).

## 1.4 Privacy stamps (already shipped)

The four sites flagged in the prompt as "already correctly stamped":

- `initializer.ts:264` (I2) — opening hand draws — `privateTo: playerId`
- `reducer.ts:2083` (#18) — per-turn / per-effect draws — `privateTo: playerId`
- `reducer.ts:2193` (#20) — mulligan — `privateTo: playerId` only on the
  cards-named branch (the "kept opening hand" branch carries no card names so
  is intentionally public)
- `reducer.ts:1037` (#9) — inkwell add — `privateTo: playerId`

I confirmed all four are present and the surrounding comments explain the
contract correctly. The `GameLogEntry.privateTo` JSDoc at `types/index.ts:3922`
documents server-side redaction (`server/src/services/stateFilter.ts`).

**One leak candidate remains**: `appendLog` site #20 ("kept their opening
hand") is intentionally public, but a determined opponent observing N rounds of
mulligans where this branch fires can deduce the player kept N cards (which is
already public via hand-size delta — no actual info leak).

**Other private events not stamped today**: hand reveal (`look_at_hand` effect
at `reducer.ts:3028`) writes to `lastRevealedHand` but does **not** call
appendLog. If the engine ever does add a hand-reveal log line, it must be
private to the looker.

## 1.5 Recommendations — Topic 1

Sorted by friction-to-fix vs payoff:

### Priority 1 — credibility-protecting fixes

1. **#14 `applyActivateAbility` drops the ability name.** Rewrite to
   `` `${cardName}'s "${abilityName}" activated.` `` matching the trigger
   format (#22). Source from `ability.storyName ?? ability.rulesText.slice(0,40)`.
   Today the log has no way to tell which of two activated abilities a card
   used, breaking replay readability.
2. **Add a lore-win `game_over` log** at `runGameStateCheck:8617`. The user
   reads "X passed the turn" and the game is suddenly over with no log line
   explaining the win threshold was crossed. Mirror the deck-out wording (#16).
3. **#24 banished log loses causality.** Add a one-word reason — the
   `zoneTransition` ctx already carries `triggeringPlayerId` and the call
   site knows whether it's a challenge / damage / effect-banish. Either
   write `"X was banished by Y."` (when source known) or attach the cause
   to the entry as a typed field.
4. **#25 remove_damage log loses source.** Same fix — pull
   `triggerSourceDef.fullName` into the message: `Mickey's "RECOVERY"
   removed 2 damage from Stitch.` Avoids the player wondering "who healed?"
5. **Effect-driven side-effects are silent.** Discard, gain_lore (effect),
   reveal-from-deck, look-at-hand should all log. Today the player sees their
   hand shrink and the lore counter bump with no explanation in the log.

### Priority 2 — consistency

6. **Initializer opening-hand log batches** (I2) but per-turn `applyDraw`
   emits one entry per card. Either batch both or expand both. Replay parsers
   currently can't programmatically count `card_drawn` events from log alone.
7. **Free-play log duplicated three times** (#3, #21, #26 same template).
   Refactor into a shared helper to avoid divergence; today the only difference
   is the `playerId` source variable.
8. **Tense + display name normalization.** Decide on present-tense
   (`Mickey plays...`) or past-tense (`played`). Decide on bare ID
   (`player1`) vs display name (`Ryan`). Both are user-visible in the log
   panel `GameBoard.tsx:2351` and the multiplayer chat / spectator view.
9. **Ability-name display.** Today: lowercase with quotes around storyName
   (`Mickey's ability "TRIPLE SHOT"`). Cards print storyName in small caps
   without quotes. If we had a `displayPlayerName` field on `PlayerState`
   we could replace `playerId` interpolation across all 26 sites with one
   helper.

### Priority 3 — architectural

10. **Make appendLog data-driven, not message-driven.** Each entry's `message`
    is reconstructed at write time from card definitions; the log is committed
    to the gameState forever. If a player upgrades their card data (e.g.
    `_source` upgrade from lorcast→ravensburger) historical logs reference
    old fullNames. Storing the message as `(type, params)` and rendering at
    UI time would let us re-skin the log on data refresh and localize
    eventually.

    Today this is a non-issue because logs are transient (per-game), but if
    we ever persist game logs server-side (we already do for action history
    via `actions[]`) the discrepancy will surface.

11. **No log site uses `def.rulesText` directly.** Pure passthrough is
    perhaps undesirable (rulesText is verbose, multi-line, contains
    keyword reminder text) but for trigger logs (#22) the log could
    optionally append `rulesText` after `storyName` to give players the
    full card text on first occurrence per game.

---

# Topic 2 — Undo scope

## 2.1 Where undo lives

The engine has **no undo primitive**. Undo lives entirely in the React UI hook
at `packages/ui/src/hooks/useGameSession.ts:472`-484. The only engine-side
support is the RNG isolation guarantee documented at
`packages/engine/src/engine/undo-rng-isolation.test.ts:1`-75 and
implemented at `reducer.ts:90` (`cloneRng` at applyAction entry).

The undo strategy is **replay-based**:

```
initialStateRef = state at game start (after createGame, before any actions)
actionHistoryRef = list of GameAction applied since start
undo() = newHistory = history.slice(0,-1); reconstructState(initial, newHistory)
```

`reconstructState` at `useGameSession.ts:105`-117 simply runs `applyAction` N
times from the initial state.

Undo is **disabled in multiplayer** (`undo` early-returns when
`configRef.current.multiplayer` is set, line 476). In multiplayer there is no
client-side history of opponent moves, only the latest authoritative state from
the server. Quick-save / quick-load (`useGameSession.ts:517`-540) is local-only
too and rebases `initialStateRef` to the loaded state, dropping prior history.

## 2.2 Atomic unit

**Undo is action-level.** The history is `GameAction[]`, not state snapshots,
not effect frames, not bag entries. Specifically the history is exactly the
sequence of actions dispatched via `session.dispatch(action)` from the UI:

- `PLAY_CARD`
- `PLAY_INK`
- `QUEST`
- `CHALLENGE`
- `ACTIVATE_ABILITY`
- `PASS_TURN`
- `MOVE_CHARACTER`
- `BOOST_CARD`
- `RESOLVE_CHOICE` (each pendingChoice resolution is its own action)
- `DRAW_CARD` (debug only — production engine drives draws automatically inside applyAction post-processing)

Critically, `RESOLVE_CHOICE` is a separate action. So if a card surfaces a
pendingChoice mid-resolution, the UI has dispatched **two** actions to the
engine — the trigger surfacing the choice, and the resolve. Undoing once steps
back over the resolve; undoing twice rewinds to before the trigger.

## 2.3 Scenarios

I traced the four scenarios from the prompt against the current code.

### Scenario A — Diablo - Maleficent's Spy on-play reveal

Card: `card-set-4.json:4469` Diablo — SCOUT AHEAD: "When you play this
character, you may look at each opponent's hand."

Confirmed in JSON: the `look_at_hand` effect has `isMay: true`
(`card-set-4.json:4496`). The may handler at `reducer.ts:6493`-6530 surfaces a
`choose_may` pendingChoice before the look fires, so the trigger pauses for
player input.

Resolution path:

1. User plays Diablo. UI dispatches action 1 = `PLAY_CARD`.
2. `applyAction` clones rng (`reducer.ts:90`), runs `applyPlayCard` which calls
   `zoneTransition` (queues `enters_play` trigger at `reducer.ts:6960`),
   appends "P1 played Diablo." (#8 at `reducer.ts:930`), then
   `applyEnterPlayExertion`.
3. Back in `applyAction`, `processTriggerStack` (`reducer.ts:95`) processes
   the queued enters_play trigger.
4. Inside `processTriggerStack:6464`, it appends "Diablo's ability 'SCOUT
   AHEAD' triggered." (#22).
5. The first effect is `look_at_hand` with `isMay:true`. The may handler at
   `reducer.ts:6493`-6530 surfaces a `choose_may` pendingChoice ("Diablo —
   SCOUT AHEAD: When you play this character, you may look at each opponent's
   hand.") and breaks out of the trigger loop.
6. applyAction returns with pendingChoice set. Diablo is on the board, the
   "P1 played Diablo." log line is committed, the trigger has logged that
   it fired, and now the engine is waiting on a yes/no.
7. User clicks "Yes". UI dispatches action 2 = `RESOLVE_CHOICE accept`.
8. `applyResolveChoice` (`reducer.ts:2255` `choose_may` branch) routes to
   `applyEffect` for the held `look_at_hand`. The case at `reducer.ts:3027`
   does NOT itself create a further pendingChoice — it just writes
   `lastRevealedHand` and pushes a `hand_revealed` event.
9. applyAction post-processing at `reducer.ts:186`-202 picks up the reveal
   and stamps `lastRevealedCards` for multiplayer visibility.
10. UI re-renders, sees `lastRevealedHand` set, shows the reveal modal. User
    clicks "OK". The "OK" is **engine-invisible** — there is no engine action
    for "I dismissed the modal." The UI just sets a local React flag.

So Diablo on-play is **two GameActions**:

- `PLAY_CARD Diablo` (logs the play, queues+fires the trigger, surfaces the
  may prompt)
- `RESOLVE_CHOICE accept` (resolves the may, fires the look, stamps the
  reveal data on state)

**Undo behavior**:

- One click after dismissing the modal: rewinds the resolve only. State
  returns to mid-play with the may prompt still showing. P1 can re-decide
  accept/decline. The reveal is gone; `lastRevealedHand` returns to its
  pre-resolve value. Diablo is still on the board, the play log line still
  present.
- Two clicks: rewinds the play itself. Diablo back in hand, ink restored,
  no trigger pending, all log lines from the play+trigger gone (because
  `state.actionLog` is part of replayed state).

**Direct answer to user's question**: with the current wiring, undoing Diablo
splits cleanly across the may prompt. **First undo rolls back the look
only**, returning the user to the may prompt where they can re-decide.
**Second undo rolls back the entire play**. This matches the user's mental
model of "undo the trigger first, then the play."

If the same card had been wired without `isMay` (a mandatory look), the
look would have fired inline inside the PLAY_CARD action and undoing would
have collapsed to a single-action rewind. So the granularity preserved here
is a side-effect of correct ability wiring, not of any explicit undo-policy
logic. That coupling is fragile but works in practice because the engine
always splits at pendingChoice boundaries.

### Scenario B — Sudden Chill (forces opponent to discard)

Card: `card-set-1.json:5440` — `each_player scope:opponents` → `discard_from_hand
amount:1 target:self`. The discard surfaces a `choose_discard` pendingChoice
on the OPPONENT.

Resolution path:

1. P1 plays Sudden Chill. dispatch action 1 = `PLAY_CARD`.
2. applyAction logs play, runs `actionEffects`. `each_player` dispatcher walks
   each opponent and queues a `discard_from_hand` per-player.
3. The discard surfaces a `choose_discard` pendingChoice for P2. applyAction
   returns with `pendingChoice` set; the action card is held via
   `pendingActionInstanceId`.
4. P2's turn to act (or in single-player, the bot's). UI dispatches action 2 =
   `RESOLVE_CHOICE` with the chosen discard target.
5. applyResolveChoice (`reducer.ts:2116`) processes the discard, completes
   pendingEffectQueue, calls `cleanupPendingAction` to move Sudden Chill to
   discard.

Two GameActions in `actionHistoryRef`:
- `PLAY_CARD Sudden Chill`
- `RESOLVE_CHOICE [cardX]`

**Undo behavior:**

- One undo: rewinds to mid-play, with Sudden Chill still in play zone (held
  by `pendingActionInstanceId`), `pendingChoice` set to choose_discard, P2's
  hand intact. The user can re-resolve with a different choice.
- Two undos: rewinds to before the play. Sudden Chill back in hand, P1's ink
  restored, P2's hand intact.

This is **finer-grained than scenario A**, not because the engine treats
Sudden Chill differently but because Sudden Chill's effect surfaces a
pendingChoice while Diablo's reveal does not. The atomic-unit-of-undo is the
GameAction; the GameAction count differs based on whether effects pause.

In multiplayer, P1 cannot undo P2's discard choice — `undo()` early-returns
in MP mode regardless. P1 also can't undo their own play of Sudden Chill
(the move is committed to the server before P2 has resolved). This is a
significant UX difference between sandbox/local and MP.

### Scenario C — Multi-effect ability (e.g. `[gain_lore, draw, exert]`)

Resolution path: applyEffect iterates `actionEffects` synchronously inside
`applyPlayCard:903`-915. None of `gain_lore`, `draw`, `exert` create
pendingChoices in their default form. So all three effects resolve inside the
same `applyAction` call — still **one GameAction**, one undo click.

If one of the effects had `target:"chosen"` and surfaced a `choose_target`
pendingChoice, then the action would split per scenario B logic.

### Scenario D — Quest into a may trigger → resolve → undo

E.g. Mickey Brave Little Tailor (random example) with a quest-triggered "may
deal damage". The bot or human dispatches:
- action 1: `QUEST Mickey`
- pendingChoice `choose_may` surfaces (the "do you want to use the may?" prompt)
- action 2: `RESOLVE_CHOICE "accept"` or `"decline"`
- if accept and the may has a `chosen` target, action 3: `RESOLVE_CHOICE [targetId]`

So a quest with two cascading mays + targets is up to **3 GameActions**, each
undoable independently. From the user's perspective, that means clicking undo
once after the quest+may+target chain only rolls back the target pick — they
must click undo three times to fully retract the quest.

In sandbox / scenario testing, this is the right semantic for "let me try a
different may target without re-clicking the whole thing." For UX in MP it
would be too granular.

## 2.4 UX surface

`GameBoard.tsx:2204`-2215 renders the undo button to the **left** of the play
zone divider. It's a small icon-only button with hover tooltip "Undo last
action". `session.canUndo` gates visibility — false during MP, game-over, or
when `actionCount === 0`.

Cost: O(history.length) — `reconstructState` replays from initial state on
every undo. For a 30-turn sandbox game with ~150 actions this is well under
100ms in practice; not yet a bottleneck.

The reset-on-quickload at `useGameSession.ts:535` (`initialStateRef.current =
saved`) is correct: the user shouldn't be able to undo *across* a quickload
into a state that no longer matches the original seed-and-actions chain.

## 2.5 Recommendation — Topic 2

The current design is the right default. Rationale:

1. **GameAction-level is the natural atom.** The engine's contract is
   `applyAction(state, action) → newState`. Anything finer (per-effect, per-
   bag-frame) would require either threading a snapshot stack through the
   reducer or capturing intermediate states.
2. **The pendingChoice split is automatic.** Effects that pause for player
   input naturally split into multiple actions. The user gets per-prompt
   undo on Sudden Chill and similar without engine-side bookkeeping. This
   is what the user wants for sandbox testing.
3. **Diablo answer**: clicking undo after the reveal modal closes rewinds
   the full play, including the trigger. There is no "undo just the trigger"
   because the trigger has no state of its own once applied. The reveal
   *modal* is dismissable as UI state but the underlying `lastRevealedHand`
   was already part of the post-play state, so undo correctly clears it.

Suggested refinements (not blockers):

1. **In sandbox, allow undo across more granular boundaries.** Today undo on
   a long ability is one click per RESOLVE_CHOICE. For a player iterating on
   "which target should I pick?" that's the right granularity. For a player
   iterating on "let me re-try the whole sequence" it's tedious. A second
   button "Undo full action" (rewinds to before the most recent non-RESOLVE
   action) would be cheap to add — just walk `actionHistoryRef` backward
   skipping RESOLVE_CHOICE entries until a non-resolve type is found.
2. **Show an action history list in sandbox.** The UI has the data
   (`actionHistoryRef`) but doesn't surface it. A side panel listing
   "1. PLAY Diablo / 2. RESOLVE may=accept / 3. RESOLVE target=Y" with
   click-to-rewind would make the granularity explicit.
3. **Document the undo contract on the hook.** The 13-line block at
   `useGameSession.ts:472`-484 has good comments inline; a top-of-file
   contract section would help future agents understand why
   `reconstructState` is action-replay (and why undo is disabled in MP).
4. **Add per-card "undo split" tests for representative may-flow cards.**
   The Diablo trace works correctly only because `isMay: true` is set on
   the look effect (`card-set-4.json:4496`). If a future card author drops
   that flag the undo split silently changes for that card — players can
   no longer re-decide the may. Add a test suite asserting that for a
   sample may card (e.g. Diablo) PLAY_CARD leaves a pendingChoice and that
   undo from the resolve returns to the same pendingChoice.

---

# Topic 3 — actionLog vs RL action stream

## 3.1 Shapes

### actionLog (`state.actionLog`)

Type: `GameLogEntry[]` (`types/index.ts:3922`). Each entry:

```ts
{
  timestamp: number;       // Date.now() at appendLog time
  turn: number;
  playerId: PlayerID;      // "player1" | "player2"
  message: string;         // human-prose paraphrase per Topic 1
  type: GameLogEntryType;  // 17-value enum
  privateTo?: PlayerID;    // server-side redaction marker
}
```

`type` enum values (`types/index.ts:3955`-3972): `game_start`, `turn_start`,
`turn_end`, `card_drawn`, `card_played`, `card_put_into_inkwell`, `card_quested`,
`card_challenged`, `card_banished`, `lore_gained`, `ability_triggered`,
`ability_activated`, `effect_resolved`, `choice_made`, `mulligan`,
`character_moved`, `game_over`.

### RL action stream

Two related but distinct shapes:

**A. `result.actions: GameAction[]`** (`runGame.ts:185`, returned at line 246).
This is the raw decision sequence for replay. Every call to
`bot.decideAction(state, ...)` is recorded. Used by:
- Replay reconstruction (`useGameSession.ts:113` `reconstructState`)
- HMR persistence (`useGameSession.ts:130` `saveSnapshot`)
- Unused by RL training directly

**B. `policy.episodeHistory: EpisodeStep[]`** (`policy.ts:54`-63).
Each step has:

```ts
{
  stateFeatures: number[];        // 224-dim vector (STATE_FEATURE_SIZE)
  chosenActionFeatures?: number[];// 80-dim vector (ACTION_FEATURE_SIZE)
  logProbChosen: number;
  isAction: boolean;              // false for mulligan
  mulliganIndex?: number;
  turnIndex: number;
  reward: number;                 // assigned in updateFromEpisode
  valuePred: number;              // critic V(s) at this step
}
```

This is the trajectory the actor-critic actually learns from. Length =
number of times the policy was asked for a decision (decideAction +
shouldMulligan). It's NOT derived from `state.actionLog`; the policy emits
it during decideAction calls (`policy.ts:162`, 200, 216, 368, 391, 408).

## 3.2 Comparison

|  | `actionLog` | `result.actions` | `episodeHistory` |
|---|------|------|------|
| Owner | `state.actionLog` (engine) | `runGame.ts` (sim wrapper) | `RLPolicy.episodeHistory` (RL only) |
| Persisted in state | yes | no (returned in result) | no (in-memory on policy) |
| One entry per | log-emitting moment | applied GameAction | bot decision |
| Cardinality on PLAY_CARD with cascading triggers | many (play log + trigger logs + per-effect logs) | 1 | 1 |
| Cardinality on PLAY_CARD that surfaces pendingChoice | many | 1 (PLAY_CARD) + 1 per RESOLVE_CHOICE | 1 + 1 per RESOLVE |
| Cardinality on automatic draw step | 1 per drawn card | 0 (engine-internal, no GameAction) | 0 (engine-internal) |
| Includes turn_start / turn_end | yes (#15, #17 in Topic 1) | yes (PASS_TURN) | once per PASS_TURN |
| Privacy filtering | yes (`privateTo`) | no | no — internal to one process |
| Format | string + type | discriminated union | numeric vectors |
| Lossless for replay? | no — paraphrased | yes — `applyAction(initialState, actions)` reconstructs | no — features are lossy |

### Key observations

1. **`actionLog` ≠ `result.actions` in cardinality.** A single PLAY_CARD action
   produces one `actions[]` entry but multiple `actionLog` entries (the play
   log itself plus every trigger that fires plus every per-effect log). This is
   visible at `runGame.ts:185`-205 where `actions.push(action)` happens once
   per loop iteration but the engine internally appendLogs many times during
   `applyAction`.

2. **Engine-internal events show in actionLog but not actions.** The per-turn
   automatic draw at `reducer.ts:2049` (and the cascade-resume draw at
   `reducer.ts:139`) writes a `card_drawn` log line but is **not** a separate
   `GameAction`. Both are absorbed inside the PASS_TURN action.

3. **`result.actions` IS the source of truth for replay** — it's used by the
   UI's `reconstructState`, by HMR snapshot, and is verified deterministic by
   the rng-isolation test. `actionLog` is a sibling output, not a basis for
   replay.

4. **`episodeHistory` is decoupled from both.** The policy decides actions and
   stamps EpisodeSteps in the same call. The trajectory length matches
   `result.actions.length` (modulo the mulligan steps which add at most 2 more),
   but the per-step features and values are computed fresh inside
   decideAction. There's no path from `actionLog` back to `episodeHistory`;
   you'd have to re-run the policy with feature recomputation.

5. **`StoredGameResult` strips both actionLog AND actions** (`storage.ts:67`).
   Saved sim runs are query-only — the reproducible information is gone.
   That's intentional but worth flagging: today an analyst loading old sim
   files cannot replay or re-render game logs. The reward signals (loreByTurn,
   inkByTurn, cardStats) survive, the trajectory does not.

6. **Reward signals don't live in any of the three.** `computePerStepRewards`
   at `trainer.ts:70` derives them from `result.loreByTurn` (a separate
   `Record<PlayerID, number[]>` populated at PASS_TURN boundaries in
   `runGame.ts:209`-213). The Singer/Song bonuses at `trainer.ts:84` walk
   `result.actions` looking for `singerInstanceId` field — so actions[]
   IS used for reward shaping, but indirectly.

## 3.3 Should they be 1:1?

**No, and they shouldn't try to be.** The three streams have different
contracts and audiences. Forcing 1:1 would either bloat actions[] with engine-
internal events (breaking replay determinism if internals change) or starve
the log of the cascading-trigger detail that makes it readable.

That said, there are genuine inconsistencies worth fixing:

### Pro-1:1 arguments
- One source of truth simplifies architecture.
- Log replay could train RL (no separate trajectory tape).
- Matches the "every state mutation has a record" mental model.

### Anti-1:1 arguments (stronger)
- **Audiences differ.** Log = human prose, actions = bot input/replay,
  episodeHistory = ML targets. Each format optimizes for its consumer.
- **Cascading triggers are SAME-action different-effect.** The bot decides
  ONE action ("play Diablo"). The engine fires ten things. Folding the ten
  into the trajectory step would mis-attribute reward signal.
- **Engine-internal events** (auto-draw, turn transition triggers, GSC banishes)
  are not decisions — they're rule consequences. Including them as actions
  would make the action space non-stationary (the bot would have to "decide"
  things it doesn't actually choose).
- **The log paraphrases for humans.** Lossy by design. A 1:1 replay-from-log
  contract would force the log to become structured data, killing readability
  in the UI panel at `GameBoard.tsx:2351`.

### Where the current setup IS lossy and shouldn't be

1. **`StoredGameResult` strips `actions[]`.** Replays of past sim runs are
   impossible. For a "creator clip" feature the actions are the only path to
   re-render the game — they're tiny (~5KB per game vs the sim file's MB).
   **Don't strip actions; keep stripping actionLog and cardStats.**
2. **`actionLog` cannot be reconstructed without re-running.** Because the
   log is engine-internal and accreted during applyAction, to render the log
   for a saved game you must re-run the actions through the engine. That's
   fine in practice but means action history on disk plus engine version is
   the recipe — not action history alone.
3. **`episodeHistory` is policy-internal.** No way to recover the trajectory
   for a finished game without re-running with the same policy. For
   reward-debugging tools this is a friction point.

## 3.4 Recommendation — Topic 3

### Document the contract

Add a top-level comment in `types.ts` (engine) or in a new
`docs/STREAMS.md` clarifying:

```
actionLog       — human-readable game narration, accreted during applyAction.
                  17-value type enum + free-text message + privacy stamp.
                  Lossy. UI consumes via `session.actionLog`. Server-redacted.
                  NOT the source of truth — re-running actions[] regenerates it.

actions[]       — canonical decision sequence. One entry per applied GameAction.
                  Lossless for replay: createGame(seed,decks)+applyAction*N
                  reconstructs the exact final state. Source of truth.

episodeHistory  — RL training trajectory. One entry per bot decision (action
                  or mulligan). Carries pre-decision state features, chosen
                  action features, log-prob, value-prediction. Per-step rewards
                  filled in updateFromEpisode. Policy-local; not persisted.
```

### Don't merge them

The 1:1 collapse would force compromises that hurt all three consumers.

### Stop stripping actions[] from StoredGameResult

`storage.ts:67` strips both `actionLog` and `actions`. The first is fine
(regeneratable). The second is a self-inflicted footgun — without `actions[]`
no past sim run can be replayed, sliced, clipped, or used for RL bootstrap.
Cost is small (~5KB/game) compared to cardStats (~10-50KB/game depending on
deck).

### Optional: add a `simulationTraceId` linking the three

Each `actionLog` entry could carry an optional `actionIndex: number`
pointing into `actions[]`. Then the UI could highlight log entries belonging
to the user's last action ("here's everything that happened from your one
PLAY_CARD click"). Today the user has no way to know whether 5 log lines
came from one action or five. Cheap to add (one int per log entry).

### Optional: persist a thin trajectory summary

For RL debugging, save `(turnIndex, action, valuePred, reward)[]` per game
to a side file. ~2KB per game. Lets analytics tools answer "where did the
policy think it was winning vs losing?" without re-running.

---

# Cross-topic findings

These bridge two or more of the three topics:

1. **`actionLog` and `actions[]` are returned together in GameResult**
   (`runGame.ts:245`-246) and stripped together in StoredGameResult
   (`types.ts:145`). Treating them as a pair is wrong: actions is canonical,
   actionLog is regeneratable. Strip only actionLog.

2. **The mulligan-detection in runGame.ts:258** queries actionLog by
   substring match (`e.message.includes("mulliganed")`). This is a
   string-coupled API to a paraphrased prose stream — exactly the
   anti-pattern Topic 1 #14 illustrates. If the wording at `reducer.ts:2191`
   changes, this detection silently breaks. Use the entry `type === "mulligan"`
   plus a structured field (or check `actions[]` for RESOLVE_CHOICE on
   choose_mulligan with non-empty array). Confirmed: line 258 already filters
   by type, but ALSO substring-matches on `"mulliganed"` to distinguish from
   `"kept their opening hand"`. Either expose a typed field or use the
   `privateTo` presence as a proxy (today set only on the cards-named branch).

3. **Undo + log replay**: when the user undoes, the engine's `actionLog` is
   automatically rewound (it's part of `state.actionLog`, restored when
   reconstructState replays from initial). Same for `result.actions` in MP
   mode (no undo there). This works correctly today but is worth noting:
   any future "log persistence" feature must be aware that local undo
   discards log entries, so committing logs to a server before the player
   has finished undoing would create ghost entries.

4. **Privacy + RL**: `episodeHistory` features are computed from the **full**
   GameState (the policy sees its own player's hand identity but not the
   opponent's — see `stateToFeatures`). The RL trajectory therefore doesn't
   leak hidden info to the bot, but it ALSO can't see information that
   `privateTo` would reveal to the playing party (e.g. cards seen via Diablo's
   look_at_hand). If we ever train policies that should exploit information
   leakage from triggers like SCOUT AHEAD, the feature extractor needs an
   "info-leak channel" that mirrors the privacy model.

5. **Undo granularity is implicit, depending on whether effects pause for
   choices**. The Diablo trace (Topic 2 scenario A) shows the engine
   correctly splits Diablo's play into two GameActions because the
   `look_at_hand` is wired with `isMay: true`. Effects that fire inline (no
   pendingChoice) collapse into the parent action's atom. There is no
   explicit "undo policy" in the engine — granularity falls out of how
   each card's effects are wired. If a card author drops an `isMay` flag,
   that card's undo behavior silently changes. Worth a check: are there
   tests asserting that specific cards' undo splits correctly? Today, no:
   the `undo-rng-isolation.test.ts` covers RNG determinism only, not
   action-cardinality assertions.

---

End of audit.
