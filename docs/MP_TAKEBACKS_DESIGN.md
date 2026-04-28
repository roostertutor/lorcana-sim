# Multiplayer Takebacks — Design Proposal

**Status:** design only, no code.
**Author:** server-specialist agent (overnight task)
**Date:** 2026-04-28
**Audience:** the user, reading in the morning to decide what (if anything) to ship.

---

## Table of Contents

1. [Framing & Vocabulary](#1-framing--vocabulary)
2. [Current Action Flow (read-out)](#2-current-action-flow-read-out)
3. [Current Undo Implementation (solo only)](#3-current-undo-implementation-solo-only)
4. [Why Solo Undo Doesn't Port Directly](#4-why-solo-undo-doesnt-port-directly)
5. [Information-Gain Catalog](#5-information-gain-catalog)
6. [Action-Tier Classification](#6-action-tier-classification)
7. [Tiered Takeback System (proposed)](#7-tiered-takeback-system-proposed)
8. [Server Contract](#8-server-contract)
9. [State Rollback Mechanism — pick a strategy](#9-state-rollback-mechanism--pick-a-strategy)
10. [Anti-Cheat Boundary](#10-anti-cheat-boundary)
11. [Edge Cases (the meat of this doc)](#11-edge-cases-the-meat-of-this-doc)
12. [UI Sketch](#12-ui-sketch)
13. [Phasing](#13-phasing)
14. [Out of Scope / Worth Flagging](#14-out-of-scope--worth-flagging)
15. [Open Questions for the User](#15-open-questions-for-the-user)
16. [Appendix A — Full Action Tier Table](#appendix-a--full-action-tier-table)
17. [Appendix B — Effect-Type Tier Table](#appendix-b--effect-type-tier-table)

---

## 1. Framing & Vocabulary

The user's framing draws a line that is the right line:

- **Neutral takeback** — actor wants to revert an action; no information has been gained that the actor didn't already have. Reverting actually reverts. The classic case is misclicking which card to put into the inkwell.
- **Info-gain takeback** — actor took an action that revealed information (their opponent's hand, the top of their own deck, etc.). Even if the engine reverts the state, the actor's brain still has the information. Reverting is a fiction the players agree to.

I'll use the TCG term **takeback** for the player-facing concept, **undo** for the engine/data-structure operation, and **info delta** for the question "did the actor learn anything from this action that they wouldn't have learned otherwise?"

The system's job is to:

1. Make neutral takebacks cheap and frictionless (so misclicks don't end games).
2. Gate info-gain takebacks behind opponent consent or disable them entirely (so peeking-then-taking-back can't be weaponized).
3. Never silently lie to a client about what its opponent saw (anti-cheat is load-bearing — `server/src/services/stateFilter.ts` is the model).

---

## 2. Current Action Flow (read-out)

The full happy path from a click in the UI to a Realtime broadcast that lands on the opponent. References below are absolute file paths so the user can click through.

### 2.1 Client dispatch

`C:/Users/Ryan/WebstormProjects/lorcana-sim/packages/ui/src/hooks/useGameSession.ts:260-305` — the multiplayer branch of `dispatch`:

1. Local-first apply via `applyAction(prev, action, definitions)`. State is installed into `gameStateRef.current` and `setGameState` immediately for instant UI feedback.
2. Fire-and-forget `sendAction(mp.gameId, action)`. On success, the server's filtered state is installed *again* (it can differ from the local apply because of state filtering).
3. On `sendAction` failure, the client re-fetches `getGame(gameId)` and trusts server truth.
4. Local action history is **not** kept in MP — `actionHistoryRef.current` is only populated on the local-mode branch (line 317).

### 2.2 Server route

`C:/Users/Ryan/WebstormProjects/lorcana-sim/server/src/routes/game.ts:69-89`:

- `POST /game/:id/action`
- Calls `processAction(gameId, userId, body.action)`.
- On success, fetches the saved game and runs `filterStateForPlayer` for the response.
- Returns `{ success, newState, nextGameId }`.

### 2.3 Server processAction

`C:/Users/Ryan/WebstormProjects/lorcana-sim/server/src/services/gameService.ts:147-306`:

- Loads game row.
- Validates: game is active, player is in the game, it's their turn (or they're the choosing player on a `pendingChoice`).
- Snapshots `stateBefore = state` (line 188).
- Records `legalActionCount` for clone trainer.
- Calls `applyAction(state, action, definitions)`.
- Saves `state` back to `games.state` (Postgres `UPDATE` triggers Supabase Realtime broadcast).
- Inserts into `game_actions` with `state_before`, `state_after`, `events`, `legal_action_count`, `turn_number`.
- On `isFinished`, runs `handleMatchProgress` (Bo3 + ELO + replay row).

**Key observation for takebacks:** `game_actions` already stores `state_before` *and* `state_after` per action. We have a free, complete per-action snapshot history. This is the lever.

### 2.4 Realtime broadcast

`games.state` UPDATE → Supabase `postgres_changes` notification → both clients' subscriptions in `useGameSession.ts:208-241`. The Realtime payload is **ignored** (anti-cheat: it contains unfiltered state). Each client re-fetches `GET /game/:id`, which returns `filterStateForPlayer`-filtered state.

### 2.5 Anti-cheat state filter

`C:/Users/Ryan/WebstormProjects/lorcana-sim/server/src/services/stateFilter.ts`:

- Stubs opponent's hand and deck cards.
- Stubs face-down `cardsUnder`.
- Redacts `actionLog` entries marked `privateTo: opponentId`.
- Drops `lastResolvedTarget` / `lastResolvedSource` / `lastDiscarded` snapshots when the post-resolution zone is hidden from the viewer.
- **Honors `lastRevealedCards` and `lastRevealedHand` privacy scoping** — public reveals show to both, private peeks (`look_at_hand`) show only to the peeker.

The filter is the model takebacks must respect: **whatever was revealed cannot be unrevealed.** A takeback implementation that doesn't account for this just hands ranked-mode cheaters a one-click "peek opponent hand for free" button.

---

## 3. Current Undo Implementation (solo only)

`useGameSession.ts:472-484` — the local-mode `undo`:

```typescript
const undo = useCallback(() => {
  const history = actionHistoryRef.current;
  const init = initialStateRef.current;
  if (!init || history.length === 0 || !configRef.current) return;
  if (configRef.current.multiplayer) return; // no undo in multiplayer
  const newHistory = history.slice(0, -1);
  actionHistoryRef.current = newHistory;
  setActionCount((c) => c - 1);
  const reconstructed = reconstructState(init, newHistory, newHistory.length, configRef.current.definitions);
  gameStateRef.current = reconstructed;
  setGameState(reconstructed);
  setError(null);
}, []);
```

Mechanism: **replay-from-initial**. The hook holds:

- `seedRef` — the seed used to create the initial game (deterministic RNG, see CLAUDE.md → "RNG aliasing").
- `initialStateRef` — the result of `createGame(...)` with that seed.
- `actionHistoryRef` — every dispatched `GameAction` since game start, in order.

On undo: drop the last action, replay all remaining actions from `initialState` via `reconstructState` (line 105-117). This is a clean replay and benefits from the engine's deterministic-RNG guarantees (`applyAction` clones `state.rng` at entry — see CLAUDE.md). It also automatically replays cascade triggers, since `applyAction` is the unit of replay.

Atomic unit: **one engine action**. A single `PLAY_CARD` may produce many internal effects (on-play triggers, GSC, etc.) but the whole bag resolves inside `applyAction`. Undo rolls back to the pre-action state, full stop. This matches what a player wants — "undo my last *move*", not "undo my last reducer step".

**Why MP currently disallows it (line 476):** the server is authoritative and there is no server endpoint to roll back. The client could replay locally but the server's `games.state` would be stale, the `game_actions` log would have a phantom row, and the next action would be validated against the server's not-rolled-back state.

---

## 4. Why Solo Undo Doesn't Port Directly

Three reasons:

1. **Server authority.** The server's `games.state` is the source of truth. Rolling back only on the client desyncs immediately on the next dispatch — server replays the action fresh against the unrolled state.
2. **Information leak.** Solo "undo" assumes both sides of the table are the same brain. In MP, the actor's "undo" doesn't undo the *opponent's* knowledge that the actor played Diablo and saw their hand. (Even setting aside ranked anti-cheat, the opponent has been *animation-flashed* in their browser with the `lastRevealedHand` event.)
3. **Realtime broadcast already fired.** By the time the actor regrets the action, both clients have already installed the post-action state. A takeback must broadcast a *second* update that resyncs both clients.

Each of these maps to a piece of the design below.

---

## 5. Information-Gain Catalog

Catalog of every effect type that produces an info delta for the actor, the opponent, or both. Drawn from `packages/engine/src/types/index.ts:3980+` (actions) and the effect-type list (lines 140-2445).

### 5.1 Public-reveal effects (both players see)

The actor and the opponent both gain information; reverting cannot un-give it to either.

| Effect type | Card example | What's revealed |
|---|---|---|
| `reveal_hand` | Dolores Madrigal | Opponent's full hand to **both** players |
| `reveal_top_switch` | Powerline-style "look at top, choose to swap" | Top of deck to both |
| `reveal_top_conditional` | Oswald, Simba | Top of deck to both |
| `name_a_card_then_reveal` | Goofy Knight for a Day | Top revealed publicly |
| `look_at_top` (with `peek_and_set_target` interactive path) | Robin Hood, Develop Your Brain | Card identity emitted as `card_revealed` event |
| `search` (with `revealsCard: true`) | Tutoring effects that flash the card | Card identity public |
| Any effect emitting `hand_revealed` event without `privateTo` | (engine convention) | Public |

These are **the most dangerous category for takebacks.** Even with both-player consent, both brains have the info.

### 5.2 Private-peek effects (only actor sees)

The actor gains info; the opponent does not. The state filter scopes `privateTo: actorId`.

| Effect type | Card example | What's revealed |
|---|---|---|
| `look_at_hand` | Diablo (Maleficent's Spy) | Opponent's hand → actor only |
| `look_at_top` (`peek_and_set_target` bot/headless path) | Develop Your Brain when picked card not chosen | Top of deck → actor only |
| `look_at_top` with non-revealing pickDestination | Various | Actor sees, opponent doesn't |

These are **the trickiest category.** Reverting state cleanly removes the info from the opponent's view (they never saw it), but the actor still has the info. In ranked, this is the abuse vector: peek opponent's hand → request takeback → server gives consent → actor knows opponent's hand.

### 5.3 Self-info-gain (drawing, top-of-deck access)

Actor learns something from their own hidden zones.

| Effect type | What's revealed |
|---|---|
| `draw` | Top of own deck → own hand. Card now public-to-actor, hidden-to-opponent |
| `look_at_top` (any variant) | Own top card(s) |
| `mass_inkwell` from deck | Top card identity (gets inked) |
| `put_top_cards_into_discard` | Top card moves to public discard — both see |
| `put_top_card_under` | Top moves face-down under (not info gain, technically) |

`draw` is the high-volume case. Every turn starts with a draw. If the player opens turn-start by drawing, sees their card, then wants to undo to "play that ink first" — the draw can't be undone without putting a *known* card back on top. The opponent now plays around a known top card on the actor's deck.

This is why **draws should be considered info-gain even though they look routine.** The CRD-defined draw step is a structural info gain.

### 5.4 Tutoring effects (search → known card to a hidden zone)

| Effect type | What's revealed |
|---|---|
| `search` (with `revealsCard: false`, destination=hand) | Card moves deck → hand silently. Actor knows the identity (they picked it); opponent knows *something* was tutored but not what. |
| `search` with public reveal | Both see |

For takebacks: tutoring is info-gain to the actor (they now know a specific card is in their hand), and partially to the opponent (they know a tutor happened, but not what was found). Reverting puts the card back; the actor still knows it's there.

### 5.5 Inkwell-from-deck

`mass_inkwell` and Kida Creative Thinker-style "look at top, put into inkwell": top card identity is now public (in the inkwell zone, face-up by CRD). This is a public-reveal — neutralish for takeback but the *zone* matters: undoing puts the card back on top of the deck, and now both players know what the actor's top card is.

### 5.6 Pure neutral actions

| Action | Info delta |
|---|---|
| `PLAY_INK` (from hand to inkwell) | None for the opponent (they already saw what's in the actor's hand, by hand-count inference; the card moves from one public-to-actor zone to a public-to-both zone). The card identity becomes public to opponent. |
| `QUEST` pre-resolution | None |
| `MOVE_CHARACTER` (to location) | None |
| `BOOST_CARD` | Top of own deck moves face-down under self → the actor *might* see it depending on Boost wording; if not, no info delta |
| `CHALLENGE` declaration pre-damage-step | None |
| `ACTIVATE_ABILITY` with no info-revealing effect | None |
| `PLAY_CARD` for a card with no on-play info-revealing effect | None (the card identity becomes public, but opponent saw it leave hand → play; no surprise) |
| `PASS_TURN` | Triggers next-turn draw → info gain for next player (see §5.3) |

`PLAY_INK` is the textbook neutral takeback case. The actor inks the wrong card from their hand. Reverting puts the card back in hand. Opponent's information state is identical pre- and post-revert because the card was visible-to-opponent only briefly while in the inkwell, and they could already infer hand contents from public play history.

Wait — actually: the opponent **does** see the inked card identity. Lorcana inkwells are face-down per CRD, but online clients render them face-up to the inking player. The opponent's filtered state shows the inkwell zone (it's "public" by `stateFilter.ts`). Let me re-check.

Looking at `stateFilter.ts:107-115`:

```typescript
const hiddenZones: ZoneName[] = ["hand", "deck"]
```

Inkwell is NOT in hiddenZones. So opponent sees inkwell card identities. Confirmed: `PLAY_INK` *does* reveal the inked card identity to the opponent.

So even `PLAY_INK` has an info delta for the opponent (they learn what the actor inked, which leaks one card from the actor's pre-ink hand). Reverting restores the opponent's correct ignorance — but the opponent has already *seen* in their browser that card X was inked. Same problem as Diablo: the human brain on the other side of the network has the info.

**Practical resolution:** in CRD-paper Lorcana the inkwell is face-down (top card excepted; per CRD 5.3.x the cards in inkwell are face-down until exerted). The current online implementation rendering inkwells face-up to opponents is itself a deliberate UX call that we should re-examine — but it's the status quo. For takeback purposes, treat `PLAY_INK` as "low info delta" — opponent learned at most one card identity, and only because of an online-specific UI choice. With paper-faithful inkwells, `PLAY_INK` would be truly neutral.

This is a knot. See §15 open questions.

---

## 6. Action-Tier Classification

Distilling §5 into actionable tiers:

| Tier | Name | Definition | Server handling |
|---|---|---|---|
| **0** | Pre-commit | Action exists only in a pendingChoice that hasn't been resolved yet, OR is in a multi-step UI flow not yet dispatched (e.g. shift target picker, singer picker mid-modal) | Client-only cancel; no server endpoint |
| **1** | Neutral | Action committed; no info delta to either player (or only to the actor about their own zones, not gained from hidden info) | Client-side undo button; server endpoint applies snapshot rollback without opponent consent |
| **2** | Info-gain (private peek) | Action revealed info to actor only; opponent state unchanged | Disabled in ranked; opponent-consent flow in casual |
| **3** | Info-gain (public reveal) | Action revealed info to both players | Disabled in ranked; opponent-consent flow in casual; even with consent, the reveal is animated → asymmetric "fairness" |
| **4** | Hard-locked | Action causes a state transition that fundamentally cannot be reversed even with consent (e.g. game-ending banish that triggered match end + ELO update + replay save) | Always disabled |

Full action-by-action mapping in [Appendix A](#appendix-a--full-action-tier-table).

---

## 7. Tiered Takeback System (proposed)

### 7.1 Tier 0 — Pre-commit cancels (no server)

These are not really "takebacks" — they're *cancels*. The action hasn't committed to the server yet.

**UX:** every multi-step pendingChoice modal has a Cancel button. Today, several of these already do (the shift target picker, alt-cost shift picker). Audit and ensure *every* `PendingChoice` is cancelable.

**Mechanism:** purely client-side. The action that opened the choice already committed to the server (e.g. PLAY_CARD that produces a `choose_target` for an on-play effect). If the player cancels mid-choice, the *choice* hasn't dispatched yet — but the action did. We have two sub-cases:

- **7.1a — Choice not yet dispatched.** The player clicked PLAY_CARD; engine produced a `pendingChoice`; player is staring at the modal. The PLAY_CARD has already committed server-side. "Cancel" here means: dispatch a `RESOLVE_CHOICE` with a no-op or default selection. Several existing `choose_may` flows already support `"decline"`. Ensure all targeting choices have a graceful default. Some don't — `choose_target` with `minTargets >= 1` cannot legally decline without breaking CRD. For those, the action is **already past Tier 0** and Cancel is a Tier 1 takeback.

- **7.1b — Action assembly in client UI before dispatch.** The player is mid-modal selecting a singer for a song; they haven't clicked Confirm. The full PLAY_CARD action hasn't been sent to the server. Pure client cancel. **No server change needed.**

**Recommendation:** Phase 1 ships only 7.1b — a UX audit + standardize cancel buttons on all in-flight UI modals before dispatch. 7.1a is actually Tier 1 and goes in Phase 2.

### 7.2 Tier 1 — Neutral takeback (no opponent consent)

The action committed. We can revert by snapshot rollback. No info was revealed to anyone (or only to the actor about their own zones).

**UX:** small "Undo" pill appears for ~5 seconds after each Tier 1 action. Click → server reverts. After 5 seconds, button disappears.

**Server flow:**

1. Client sends `POST /game/:id/takeback`.
2. Server validates: requesting user is the player who just acted; the most recent `game_actions` row is theirs; the action is Tier 1 by classification.
3. Server applies the rollback (see §9).
4. Server inserts a `takeback` row (audit log) — see §8.4.
5. Server broadcasts via Realtime — opponent sees state revert. UI shows a small "Opponent took back: <action>" toast.

**No opponent prompt.** Tier 1 is "I misclicked"; we don't make players confirm misclicks.

### 7.3 Tier 2 — Info-gain takeback (opponent-consent)

The action committed *and* revealed information. State can revert; brains cannot.

**UX:**

- Actor sees an "Undo (requires opponent consent)" link after the action.
- Click → server records request, broadcasts to opponent.
- Opponent sees: "Player1 wants to take back <Diablo - Maleficent's Spy>. Allow? [Yes] [No] [auto-ignore in 30s]"
- 30s timeout = implicit No, action stands.
- Yes → server reverts; broadcast.

Crucially: even on consent, **the opponent's UI keeps its memory of the reveal.** We do NOT animate a reverse-flash that pretends the reveal didn't happen. Animation would lie to the user about their own browser. Instead, the takeback toast says: "Player1 took back Diablo (revealed: A, B, C). Effects undone, but you still saw the cards."

This matters because the opponent should not feel gaslit. They saw the cards; the system acknowledges that fact.

**Disabled in ranked.** See §10.

### 7.4 Tier 3 — Public-reveal takeback

Same flow as Tier 2 but with **stronger language** on the prompt: "Player1 played Powerline and saw your top card (Card X). They want to take it back. Both of you have seen Card X. Allow?"

The difference between Tier 2 and Tier 3 is mostly UX framing — the engine work is the same. We could collapse Tier 2 + Tier 3 into a single tier called "consent-required" with a UX flag distinguishing private vs public. I recommend this collapse for Phase 3 to reduce surface area.

### 7.5 Tier 4 — Hard-locked

No takeback button rendered. These are:

- Any action where `result.newState.isGameOver === true`. Once ELO has updated and a replay row exists, reverting is a different problem (ELO rollback, replay deletion, lobby state — too invasive).
- Resignation (`POST /game/:id/resign`). Already irreversible by design.
- Any action *after* an opponent action has already committed on top of it. (Server enforces "most recent action only" rule — see §11.4.)

---

## 8. Server Contract

### 8.1 Endpoints

```
POST /game/:id/takeback
  body: { actionLogId: number }   # game_actions.id of the action being taken back
  response:
    200: { tier: 1 | 2 | 3, status: "applied" | "pending_consent", ... }
    400: { error: "not_your_action" | "stale_action" | "tier_4_locked" | "wrong_turn" }
    403: { error: "ranked_no_takebacks" }

POST /game/:id/takeback/respond
  body: { takebackId: string, approved: boolean }
  response:
    200: { status: "applied" | "rejected" }
    400: { error: "not_pending" | "not_the_opponent" | "expired" }
```

### 8.2 Database — new table

```sql
CREATE TABLE takebacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_action_id BIGINT NOT NULL REFERENCES game_actions(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES profiles(id),
  -- Tier classification at request time. Persisted because the server's
  -- classification logic can evolve and we want post-hoc auditability.
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  -- "auto" for Tier 1 (no consent needed); "pending" / "approved" / "rejected" / "expired" for Tier 2/3.
  status TEXT NOT NULL CHECK (status IN ('auto', 'pending', 'approved', 'rejected', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  -- Snapshot the state-before pointer for fast rollback. Redundant with
  -- game_actions.state_before but lets us short-circuit on apply without
  -- a join.
  state_before_snapshot JSONB
);
CREATE INDEX takebacks_game_idx ON takebacks (game_id, requested_at DESC);
CREATE INDEX takebacks_pending_idx ON takebacks (game_id, status) WHERE status = 'pending';
```

**RLS:** visible only to the two players of the parent game.

### 8.3 Tier classification — server-side

A new module `server/src/services/takebackClassifier.ts`:

```typescript
type TakebackTier = 1 | 2 | 3 | 4 | "ineligible";

export function classifyAction(
  action: GameAction,
  stateBefore: GameState,
  stateAfter: GameState,
  events: GameEvent[],
): TakebackTier {
  // Tier 4: any event with isGameOver, or a cascading match-end side-effect
  if (stateAfter.isGameOver) return 4;

  // Tier 2/3: any reveal events
  const hasPublicReveal = events.some(e =>
    (e.type === "card_revealed" || e.type === "hand_revealed") &&
    !("privateTo" in e && e.privateTo)
  );
  if (hasPublicReveal) return 3;

  const hasPrivatePeek = events.some(e =>
    (e.type === "card_revealed" || e.type === "hand_revealed") &&
    "privateTo" in e && e.privateTo
  );
  if (hasPrivatePeek) return 2;

  // Tier 2: draw events (own-deck info gain)
  if (events.some(e => e.type === "card_drawn")) return 2;

  // Tier 1: anything else neutral
  return 1;
}
```

The classifier is **conservative** — when in doubt, it bumps tier. Better to require consent on a misclassified-as-info-gain action than to accidentally allow consent-free rollback of a peek.

**This classifier is the single source of truth on what's reversible.** It reads from `result.events` (the GameEvent stream we're already persisting on `game_actions.events`) — no need to reach into the engine internals to know what happened.

### 8.4 The rollback request lifecycle

```
[Client]            [Server]                              [Opponent client]
  |                     |                                          |
  |--POST /takeback---->|                                          |
  |                     |--classify(action, events)                |
  |                     |--insert takebacks row                    |
  |                     |                                          |
  |   Tier 1 path:      |                                          |
  |                     |--rollback state (§9)                     |
  |                     |--Realtime broadcast game UPDATE--------->|
  |<------200 applied---|                                          |
  |                                                                |
  |   Tier 2/3 path:    |                                          |
  |                     |--Realtime broadcast custom takeback evt->|
  |<--200 pending-------|                                          |
  |                     |                                          |
  |                     |<-----POST /takeback/respond--------------|
  |                     |--rollback state if approved              |
  |                     |--Realtime broadcast game UPDATE          |
  |                     |  + takeback resolved evt                 |
  |<-------UPDATE-------|--update takebacks.status                 |
  |                     |                                          |
```

The "Realtime broadcast custom takeback evt" — Supabase Realtime postgres_changes only broadcasts table UPDATEs. Two options:

- **Option A (recommended):** create a `takebacks` row INSERT + the opponent client also subscribes to `takebacks:game_id=eq.<id>`. INSERT broadcasts naturally.
- **Option B:** use Supabase Broadcast channels (`game:<id>:events`) for ephemeral takeback events that don't need DB persistence. We persist anyway for audit, so Option A is cleaner.

---

## 9. State Rollback Mechanism — pick a strategy

Three options. Recommendation at the bottom.

### 9.1 Snapshot-based

**Mechanism:** `game_actions.state_before` already holds the pre-action state. Look up the row, copy `state_before` into `games.state`, save.

**Pros:**
- Trivial to implement.
- O(1) per takeback.
- Works for any action regardless of complexity (cascading triggers, mid-pendingChoice, etc.).

**Cons:**
- `game_actions` keeps phantom rows for taken-back actions. Must mark them as `taken_back` (new column) so the replay/clone-trainer doesn't pick them up.
- Storage cost: every action already persists state_before; we're not adding storage, just referencing.

### 9.2 Replay-based

**Mechanism:** load all `game_actions` rows for the game, drop the last one, replay from `initialState` via `applyAction` over the seed.

**Pros:**
- Matches the solo-undo semantics exactly.
- Self-healing if a state snapshot ever became corrupt.

**Cons:**
- O(N) per takeback where N = action count. For a 30-turn game with ~5 actions/turn, ~150 actions × ~10ms apply = 1.5s server-side. Noticeable.
- Requires loading the full action history; bandwidth from DB.
- Engine-version sensitivity: if engine bumps mid-game (mid-deploy?), replay can produce a different state. (Solo undo doesn't have this problem — same client-side engine the whole time.)

### 9.3 Inverse-action-based

**Mechanism:** define an inverse for every action type. Apply inverse to current state.

**Pros:**
- Conceptually clean for simple actions.

**Cons:**
- Inverse for cascading triggers is intractable. Diablo-on-play triggers a hand-reveal *and* a card-banishment cascade; manually inverting each is fragile.
- New cards = new inverse code. Maintenance burden grows with the engine.
- Reject this option.

### 9.4 Recommendation: Snapshot-based (§9.1)

We already pay for the snapshot. Server endpoint becomes:

```typescript
// pseudocode
async function applyTakeback(gameId: string, gameActionId: number) {
  const { data: row } = await supabase
    .from("game_actions")
    .select("state_before, action")
    .eq("id", gameActionId)
    .single();

  // Mark the action as taken back so the replay doesn't include it
  await supabase
    .from("game_actions")
    .update({ taken_back: true })
    .eq("id", gameActionId);

  // Restore state — Realtime broadcasts the UPDATE
  await supabase
    .from("games")
    .update({ state: row.state_before, updated_at: new Date() })
    .eq("id", gameId);
}
```

Schema add: `ALTER TABLE game_actions ADD COLUMN IF NOT EXISTS taken_back BOOLEAN NOT NULL DEFAULT FALSE;`

Replay/clone-trainer queries get a `WHERE taken_back = false` predicate. Replay viewer in `getGameReplay` (gameService.ts:886) already pulls actions in order — add the filter.

---

## 10. Anti-Cheat Boundary

This is the section the user explicitly cares about (server-specialist scope per the prompt).

### 10.1 Ranked vs casual

`games.ranked` already exists (`gameService.ts:119` — set on game create). It's the single flag governing ELO eligibility.

**Proposal:** add a parallel `games.takebacks_allowed` flag, derived at game-create time:

```typescript
const takebacksAllowed = !ranked;  // ranked games never allow takebacks
```

Or, finer-grained:

```typescript
// games.takebacks_policy: "none" | "neutral_only" | "with_consent"
//   ranked queue: "none"
//   casual queue: "neutral_only"  (Tier 1 only)
//   private lobby: host-configurable (default "with_consent")
```

The middle option (`"neutral_only"` for casual queue) is interesting — in casual queue, you don't know your opponent and can't trust them. Tier 1 misclicks should still be allowed, but Tier 2/3 consent flow is open to abuse (collusion to peek, then "agree" to take it back, knowing both players just exchanged info). For casual queue, **disable Tier 2/3 too**. Only `private` lobbies get the full consent flow.

Final recommendation:

| Source | Tier 0 (cancel) | Tier 1 (neutral) | Tier 2/3 (consent) |
|---|---|---|---|
| Ranked queue | Yes | **No** | No |
| Casual queue | Yes | Yes | **No** |
| Private lobby | Yes | Yes | Yes (host-configurable; default Yes) |

Server enforces; UI just doesn't render the Undo button when policy says no.

### 10.2 Why even Tier 1 is disabled in ranked

Touch-move / touch-ink is a competitive integrity rule. In ranked we want every click to count. The "I misclicked" excuse is exactly the kind of thing that erodes ranked-mode trust. Other ranked TCG clients (MTGA, Hearthstone) don't allow undo for similar reasons.

### 10.3 Logging for anti-abuse

Even with the consent gate, the consent flow is collusion-vulnerable in private lobbies between friends. The audit log (§8.2 `takebacks` table) lets us answer questions like:

- Are some players issuing far more takeback requests than average? (Possible misclick-prone, possible abuser.)
- Are takeback requests concentrated on info-gain actions? (Sign of peek-then-undo.)
- Are players with high mutual-game count consenting to each other's Tier 2/3 takebacks at suspicious rates? (Sign of collusion.)

These are post-hoc; we don't gate at request time on them. But the data is there if we want to build a heuristic later.

### 10.4 Don't trust the client classifier

The client UI may pre-classify the action's tier to decide whether to show the Undo button. **The server must re-classify and refuse to apply if the client lied.** Standard validate-at-the-boundary discipline (see CLAUDE.md: "Server code is a system boundary").

---

## 11. Edge Cases (the meat of this doc)

### 11.1 Mid-pendingChoice undo

**Scenario A:** Actor played Sudden Chill (opponent must discard). Opponent is staring at the discard modal. Actor clicks Undo on Sudden Chill.

**Resolution:** Treat the parent action (PLAY_CARD: Sudden Chill) as the takeback unit. The pendingChoice on the opponent's side is part of the action's resolution — the action isn't "complete" yet from a game-state perspective (state.pendingChoice !== null). Two policy options:

- **Lock takebacks while pendingChoice belongs to the opponent.** The action is mid-resolution; let the opponent finish their choice before allowing rollback. After resolution, takeback flow proceeds normally (and the opponent now has visibility into what they discarded — so the action is Tier 2/3).
- **Allow takeback during opponent's pendingChoice.** Server cancels the pendingChoice, restores stateBefore. Opponent's modal closes. Cleaner UX; complicates the consent question (do we consent the opponent now?).

**Recommendation:** lock takebacks while opponent has pendingChoice. Reasons: (1) the engine semantics are cleanest at action boundaries; (2) opponent might have already mentally committed to their discard pick — we don't want to yank their decision back; (3) once opponent submits, the snapshot-based rollback restores state before Sudden Chill regardless.

**Scenario B:** Actor's own pendingChoice. Actor played Develop Your Brain, sees top 4, picking 2. Actor wants to undo. Tier 0 cancel — `pendingChoice` is the actor's; client cancels it (sends `RESOLVE_CHOICE` with default), then immediately requests Tier 2 takeback (since the look_at_top revealed cards to the actor).

**Edge sub-case:** what if the default RESOLVE_CHOICE itself reveals further info? E.g. choosing 0 cards in `look_at_top` doesn't surface anything new, but choose_target with min=1 has no zero-cost default. For min=1 cases, the cancel must dispatch a *legal* resolution (e.g. pick the first valid target) and *then* takeback. The takeback rolls back over both the original action AND the cancel-resolution.

This is getting complex. Simplification: **the "takeback" unit is one engine action, not one engine effect.** If a card produces a pendingChoice, the actor must resolve it (with whatever default the UI picks, or by their own choice), and then takeback rolls back the entire ladder including the resolution. This matches the solo-undo unit-of-work.

### 11.2 Cascading triggers

**Scenario:** Actor plays a Diablo with an on-play `look_at_hand` AND a "when you play X, opponent discards 2" trigger from another card. Both effects fire on the same `applyAction`. Actor wants to take back Diablo.

**Resolution:** snapshot-based rollback covers this trivially. `state_before` is the state before any of it happened. Both effects revert as a unit.

**But:** the opponent has now both seen-their-hand-revealed AND lost 2 cards from their hand. Even with consent and rollback, the opponent's brain has the actor's reveal-knowledge baked in. Tier 3 (public-reveal) classification + strong UX language.

### 11.3 Bag / reaction window

CRD reaction-window timing happens inside `applyAction`. There's no mid-bag user input. So takebacks always operate at clean action boundaries. No special handling needed.

### 11.4 Network race — actor takes another action mid-takeback-request

**Scenario:** Tier 2 case. Actor plays Diablo, requests takeback, opponent is deciding. Actor accidentally clicks PLAY_INK on a different card while waiting for opponent's response. PLAY_INK reaches server. Opponent then approves the takeback.

**Resolution:** server rejects the PLAY_INK with "takeback pending — your action is paused" while a takeback is in flight, OR (alternative) accepts PLAY_INK and *cancels* the pending takeback (acting on the post-Diablo state implies you've abandoned the takeback request).

**Recommendation:** the moment the actor takes another action, auto-cancel the pending takeback. Set the takebacks row status to "cancelled_by_action". This matches the player's intent: taking another action means you've moved on.

But: the server must enforce this atomically. Pseudocode:

```typescript
async function processAction(...) {
  // In a transaction: check for pending takeback, cancel it if exists
  const { data: pending } = await supabase
    .from("takebacks")
    .select("id")
    .eq("game_id", gameId)
    .eq("status", "pending")
    .maybeSingle();

  if (pending) {
    await supabase
      .from("takebacks")
      .update({ status: "cancelled_by_action", resolved_at: new Date() })
      .eq("id", pending.id);
    // Realtime broadcast triggers opponent's UI to dismiss the prompt
  }

  // ... existing processAction logic
}
```

### 11.5 Race — takeback and opponent response collide

**Scenario:** Actor requests takeback. Opponent approves. Network race: opponent's approval and a fresh action from the actor (post-clicking another button) hit the server within 50ms.

**Resolution:** Postgres serializes via row-level lock on the `takebacks` row. The first request to grab the lock wins:

- If approval lands first: state rolls back, then actor's new action is applied against rolled-back state.
- If actor's new action lands first: takeback auto-cancels per §11.4, opponent's approval gets "not pending" error.

Both outcomes are acceptable — the loser sees a clear error. UX surfaces this with a toast.

### 11.6 Opponent disconnects during takeback request

**Scenario:** Actor requests Tier 2 takeback. Opponent's tab crashes / network drops. Actor waits 30 seconds.

**Resolution:** the 30s timeout fires server-side (a scheduled job, OR lazy-checked on next request to that game). Status flips to "expired", action stands.

Alternative: if the opponent reconnects within 30s, they see the prompt and can respond. After 30s, prompt is gone.

### 11.7 Actor disconnects after requesting takeback

**Scenario:** Actor requests, then refreshes their tab. They reconnect 5s later. Opponent has not yet responded.

**Resolution:** on reconnect, the actor's client fetches `GET /game/:id` (existing behavior) plus a new `GET /game/:id/takebacks?status=pending` to surface the in-flight request. UI shows "Waiting for opponent to respond to your takeback…".

### 11.8 Reveal animation already played on opponent's screen

**Scenario:** Actor plays Powerline (public reveal of opponent's top). Opponent's UI animates the reveal — they see the card identity. Actor immediately requests Tier 3 takeback. Opponent grants.

**Resolution:** state rolls back. Opponent's UI:

- Removes the `lastRevealedCards` / pill / tooltip immediately.
- Shows a toast: "Player1 took back Powerline. You both saw the revealed card; the effect is undone."
- The opponent's brain still knows "Card X is on top of Player1's deck" (which is now Player1's deck top again, since the reveal-and-look effect is reverted).

This is the fundamental info-asymmetry of Tier 3 takebacks. Honest UX > pretend animation. The toast is load-bearing.

### 11.9 Bo3 next-game already created

**Scenario:** Final turn, actor plays a banish that ends the game. `handleMatchProgress` runs, creates the Bo3 next game, awards ELO. Actor tries to Undo.

**Resolution:** Tier 4. Hard-locked. The fanout (replay row, ELO update, Bo3 next game ID, lobby state transition) makes rollback intractable. Game-end is the firm boundary.

### 11.10 Realtime delivery failure for the takeback broadcast

**Scenario:** Actor requests Tier 2 takeback. Server inserts row + broadcasts. Opponent's Supabase Realtime subscription is wedged or temporarily lost.

**Resolution:** opponent's reconnect logic (`useGameSession.ts:235-241`) re-subscribes, but if the takebacks row was inserted while disconnected, the INSERT broadcast was missed. Opponent never sees the prompt. Actor sees "waiting…" forever, falls into 30s expiry path.

**Mitigation:** when the opponent reconnects, fetch pending takebacks (`GET /game/:id/takebacks?status=pending`) and re-render the prompt. This is the same pattern as fetching game state on reconnect.

### 11.11 Action that the actor is forced to take

**Scenario:** Reckless character that must challenge if able. Actor's Reckless character is forced into a challenge they don't want. They request takeback.

**Resolution:** Tier 1 if the challenge has no info-gain side effects, Tier 2/3 otherwise. Reckless-forced actions aren't different from voluntary ones from a takeback perspective. (Related: the user might want the policy to *prefer* allowing takebacks of forced moves, since they aren't really the player's choice. This is policy refinement; not Phase 1.)

### 11.12 Self-replacement effects mid-resolution

CRD 6.5 — replacement effects. The current engine has a `self_replacement` primitive that swaps base effects mid-resolution. This is contained inside `applyAction` and produces a single state-after; takeback at the action boundary still works cleanly.

### 11.13 RNG re-seed concerns

Per CLAUDE.md: "RNG aliasing — `applyAction` clones `state.rng` at entry so the caller's state is never mutated."

This means snapshot-based rollback is **safe with RNG.** The `state_before` JSONB blob includes `state.rng` at pre-action time. Restoring it gives us pristine RNG for any subsequent action — no re-roll surprise.

**However:** the actor saw the RNG outcome of the action before deciding to take it back. If they retry the same action expecting a different outcome, they'll get **the same outcome** (deterministic). That's intentional — same as solo undo. Actor doesn't gain RNG-shopping ability.

But what about **changing the action**? Actor played Develop Your Brain, saw top 4, didn't like them, takes back, plays a different card. The top 4 of the deck is unchanged. Actor knows what they are. Now actor plays a card that interacts with top of deck and benefits from the knowledge.

This is the classic info-leak abuse vector and is exactly why look_at_top → takeback should be **Tier 2 in casual** (consent required) and **disabled in ranked**. Even with consent, the actor knows the top 4. The opponent agreeing to a takeback in casual is consenting to that.

### 11.14 Spectator visibility (future-proofing)

`MULTIPLAYER.md` § 3g lists spectator mode as design-only. When implemented:

- Spectators see a delayed view (anti-coaching).
- Takeback events should propagate to spectators too — they see "Player1 took back Diablo" even if they're delayed.
- The delayed view means by the time a spectator sees the action, it may already be taken back. UX: if action X has been taken back before the spectator's delay-window catches up, skip the action entirely in the spectator stream. Otherwise show action + takeback in sequence.

Not Phase 1; just a flag.

### 11.15 Resign as a "takeback"?

Some players might use takeback to undo a resignation ("I clicked resign by accident"). Resign is currently irreversible (Tier 4). I recommend keeping it that way. Resign confirmation modal already exists; that's the prevention layer. No takebacks for resigns.

### 11.16 Cross-game / Bo3 takebacks

Once Game 1 of a Bo3 ends and Game 2 has started, the player cannot take back actions from Game 1. Tier 4. Server enforces by checking that the targeted game is `status=active`.

### 11.17 Cancelled takeback should not desync clients

When a takeback is auto-cancelled (§11.4), the actor's client knows (they took the action that cancelled it). The opponent's client received a "takeback pending" event earlier and is showing the prompt. Server must broadcast a "takeback cancelled" event when status flips, so the prompt dismisses. Use the same takebacks-table-INSERT-or-UPDATE channel.

### 11.18 Mulligan as Tier 0

Initial mulligan choice is itself a `pendingChoice`. Players are choosing which cards to mulligan from their opening hand. Pure Tier 0 — no commit until they confirm. Existing UI should already support cancel/re-pick.

### 11.19 Choose play order

`choose_play_order` is also a `pendingChoice`. Same as mulligan — Tier 0 until confirmed.

### 11.20 Effect that depends on opponent state at time-of-cast

Banish-target picker that targets opponent's character. Actor declares the banish, picks target, opponent's character dies. Snapshot rollback restores it. Fine. But: if the opponent has any "when banished" trigger that fired and produced effects (drew a card, gained lore), those revert too — the snapshot is the whole world before applyAction.

This is correct behavior, but worth flagging: the opponent might have *already taken a turn action* if the trigger sequence was long. Actually no — pendingChoices are atomic to the action; opponent can't have taken a turn action between the banish and the trigger. Confirmed safe.

---

## 12. UI Sketch

(Brief, since UI is out of scope for this agent. Hand off to ui-specialist for actual chrome.)

### 12.1 Actor's view

After dispatching an action that's tier-classifiable as 1/2/3:

```
┌──────────────────────────────────────────────┐
│  Last action: Played Diablo - Spy            │
│  [↶ Undo]   (auto-dismiss in 5s)             │
└──────────────────────────────────────────────┘
```

For Tier 2/3 the button says `[↶ Request takeback]` with a subtitle "Requires opponent consent".

After requesting Tier 2/3:

```
┌──────────────────────────────────────────────┐
│  Takeback requested (waiting for opponent…)  │
│  [Cancel request]                             │
└──────────────────────────────────────────────┘
```

### 12.2 Opponent's view (Tier 2/3 only)

```
┌────────────────────────────────────────────────┐
│  Player1 wants to take back:                   │
│    Diablo - Maleficent's Spy                   │
│  This will undo their look at your hand.       │
│  You've already seen the cards; this can't     │
│  un-show them.                                  │
│                                                 │
│  [Allow]  [Deny]   (auto-deny in 0:28)         │
└────────────────────────────────────────────────┘
```

### 12.3 Both players, after takeback applied

Toast / log entry:

```
↶ Player1 took back: Diablo - Maleficent's Spy
   (You both saw: Card A, Card B. Effect undone.)
```

The "you both saw" line is the honest UX from §11.8.

---

## 13. Phasing

Recommended order:

### Phase 1 — Tier 0 audit (UX only, no server)
- Audit all client-side multi-step modals and pendingChoice flows for Cancel buttons.
- Standardize.
- No engine, server, or DB changes.
- ~1-2 days of UI work.

### Phase 2 — Tier 1 neutral takebacks (server endpoint + UI)
- Add `takebacks` table + `taken_back` column on `game_actions`.
- Add `takebackClassifier.ts` (only needs Tier 1 detection; everything else returns "ineligible").
- `POST /game/:id/takeback` for Tier 1 only; reject Tier 2+ with 403 "not yet supported".
- Snapshot-based rollback.
- 5-second Undo pill in UI.
- Disabled in ranked queue games (`games.takebacks_allowed=false`).
- Log to `takebacks` table for future analysis.
- ~3-5 days of server + UI work.

### Phase 3 — Tier 2/3 consent flow (private lobbies only)
- Extend classifier to Tier 2/3.
- `POST /game/:id/takeback/respond`.
- Opponent prompt UI.
- 30s timeout (server-enforced, lazy-checked on reads + scheduled job for cleanups).
- Disabled in ranked AND casual queue. Private-lobby-host-configurable, default-on.
- ~5-7 days of server + UI work.

### Phase 4 — Polish + analytics
- Takeback rate metrics on `takebacks` table.
- Misclick-detection heuristic ("this player misclicks 30% of the time, surface a confirmation modal on PLAY_INK").
- Spectator mode integration when spectator mode lands.

### Phase 5 — Probably never
- Multi-step takebacks (undo last 3 actions). Engine-level semantics get hairy and player demand is probably low.
- Cross-game (within Bo3) takebacks. Probably bad incentives.

---

## 14. Out of Scope / Worth Flagging

### 14.1 Chat-message takebacks (no system support)

The cheapest version of this feature is **just a chat box.** "Hey can I take that back?" "Yeah." The opponent then refrains from acting on info, and the actor gets to play their next move under the same constraints as paper Lorcana. Magic Online operated this way for years.

This requires zero engine/server/UI work beyond a chat feature, and chat is probably wanted anyway. Worth shipping as Phase 0.5.

The downsides: no rollback enforcement (opponent can act on the info anyway), no anti-cheat, no audit log. But for trusted private games it's perfectly fine.

### 14.2 Replay-based audit trail for ranked

Ranked games never allow takebacks (per §10.1), so the audit table is mostly relevant for casual + private. Worth thinking about whether ranked needs the schema changes at all. Yes — even ranked benefits from the `taken_back` column on `game_actions` being there (default false, never set) for forward compat.

### 14.3 Replay viewer compatibility

The replay viewer (`getGameReplay`, gameService.ts:886) reconstructs state by replaying actions in order. With takebacks, we add `WHERE taken_back = false`. The engine's deterministic-RNG guarantee still holds — the seed is preserved, the action sequence (minus taken-back ones) replays cleanly.

**Important:** the replay viewer for a game that had takebacks may not match what the players experienced moment-to-moment, since the replay skips taken-back actions entirely. A "show takebacks" toggle on the viewer might be useful for analysis ("they took back Diablo three times — what was happening?"). Out of scope for Phase 2.

### 14.4 Time pressure

Without time controls, takebacks could be used to stall. Recommend coupling Phase 2 with at least a soft timer:

- 5-second Tier 1 Undo window.
- 30-second Tier 2/3 request window after the action.
- If a chess clock ever ships (BACKLOG?), takeback time should count against the actor.

### 14.5 Don't break the clone trainer

`game_actions` is read by the clone trainer (`docs/MULTIPLAYER.md` mentions "ready for clone trainer (Stream 5)"). Add the `taken_back = false` filter to clone-trainer queries OR have a view `game_actions_active` that excludes them.

Per CLAUDE.md the clone trainer pipeline reads ELO from `games`, not from `game_actions` (correct, since action-level ELO was dropped 2026-04-22). So the filter is the only change needed.

### 14.6 Engine-version concerns for snapshot rollback

The snapshot is a serialized GameState. If the engine schema changes between snapshot-time and rollback-time (i.e. mid-deploy), restoring the snapshot loads an *old-shape* GameState into the new engine. Risk: deserialize errors, missing fields, etc.

**Mitigation:** server stamps `engine_version` on `games` (already exists, gameService.ts:138). Takebacks should validate: if `games.engine_version !== ENGINE_VERSION`, deny the takeback ("game is on an older engine version; restart"). This is also a useful canary for clone-trainer eligibility.

### 14.7 Why not just "show the opponent's hand permanently"?

In casual / consent-required mode, after a Tier 2/3 takeback, the opponent has seen the cards. We could imagine flagging those cards as "actor knows about these" in the opponent's hand visualization for the actor (a thin pip on the card back). This is honest and transparent.

But: the engine doesn't have "actor has knowledge of card X" as a state primitive. Adding one is a real refactor and probably out of scope. The honest-toast solution (§12.3) covers the social fact without engine changes.

---

## 15. Open Questions for the User

These are the policy decisions only the user can make:

1. **Inkwell visibility** — `stateFilter.ts` currently sends opponent's full inkwell zone unredacted, which means card identities are visible to the opponent. This is online-specific (paper inkwells are face-down). If we changed inkwell to face-down per CRD, `PLAY_INK` becomes a fully neutral takeback action. Should we?

2. **Tier 1 in ranked** — I've recommended *no takebacks at all* in ranked (touch-move discipline). The user might prefer Tier 1 (misclick recovery) with a tighter window (1-2 seconds). Pick.

3. **Consent prompt language** — the text in §12.2 is honest about info asymmetry. Some users may prefer softer language ("your opponent saw your cards but agreed to undo it"). Up to brand voice.

4. **Auto-cancel-on-next-action vs lock-out** — §11.4 picks auto-cancel. The alternative (lock the actor's UI until takeback resolves) is more conservative but punishes the actor for changing their mind. Pick.

5. **30s timeout duration** — arbitrary. Could be 15s, 60s, configurable.

6. **Default for private-lobby host** — proposed default: takebacks ON. Some user communities prefer default-OFF for competitive private play. Pick.

7. **Separate Tier 2 vs Tier 3?** — I recommended collapsing them in Phase 3 (§7.4). If the user wants UX differentiation between private peeks and public reveals, keep them separate.

8. **Chat as Phase 0.5?** — see §14.1. Massive-effort-savings option if user trusts the social layer to handle takebacks.

---

## Appendix A — Full Action Tier Table

For each `GameAction` type from `packages/engine/src/types/index.ts:3980`:

| Action | Default tier | Notes / Tier escalators |
|---|---|---|
| `PLAY_INK` | 1 | Tier 1 always (neutral). Possibly Tier 0 if pre-confirm modal. Caveat §15.1 inkwell visibility. |
| `PLAY_CARD` (no on-play info effect) | 1 | Card identity becomes public; opponent already saw it leave hand. |
| `PLAY_CARD` with on-play `look_at_hand` (Diablo) | 2 | Private peek of opponent hand. |
| `PLAY_CARD` with on-play `reveal_hand` (Dolores) | 3 | Public reveal of opponent hand. |
| `PLAY_CARD` with on-play `look_at_top` (Develop Your Brain) | 2 | Private peek of own deck top. |
| `PLAY_CARD` with on-play `reveal_top_*` | 3 | Public reveal. |
| `PLAY_CARD` with on-play `search` (tutor) | 2 | Actor learns deck composition; opponent learns "tutor happened". |
| `PLAY_CARD` with on-play `draw` | 2 | Self-info-gain. |
| `PLAY_CARD` of a song with `singerInstanceIds` | inherits song's effect | Same classification as the played effect. |
| `QUEST` | 1 | Pure neutral. |
| `CHALLENGE` | 1 | Neutral pre-damage (no card revealed). Damage resolution is part of the same action — Tier 1 still since damage is public. |
| `ACTIVATE_ABILITY` | inherits effect | Same logic as PLAY_CARD on-play effects. |
| `MOVE_CHARACTER` | 1 | Neutral. |
| `BOOST_CARD` | 1 | Top moves face-down — no info gain to opponent. Actor may see top depending on Boost wording (current implementation: face-down without peek). |
| `PASS_TURN` | 2 | Triggers next-turn draw → self-info-gain on the next player's draw. |
| `RESOLVE_CHOICE` | inherits parent action | The choice resolves a pendingChoice that belongs to a parent action; takeback rolls back to *before* the parent action. |
| `DRAW_CARD` (debug) | 2 | Same as natural draw. |
| Resign | 4 | Hard-locked. |
| Any action where `result.newState.isGameOver === true` | 4 | Hard-locked (ELO + replay row + Bo3 + lobby state). |

## Appendix B — Effect-Type Tier Table

For info-gain classification of effects emitted by triggered/activated/static abilities. Used by the classifier to bump tier when an action's events stream contains these.

| Effect type | Tier escalator | Reasoning |
|---|---|---|
| `look_at_hand` | →2 | Private peek (engine stamps `privateTo`). |
| `reveal_hand` | →3 | Public reveal. |
| `look_at_top` (peek_and_set_target, no card_revealed event) | →2 | Private peek of own deck. |
| `look_at_top` (interactive path, emits card_revealed) | →3 | Public — opponent sees what the actor surfaced. |
| `reveal_top_switch` | →3 | Public reveal of top. |
| `reveal_top_conditional` | →3 | Public reveal. |
| `name_a_card_then_reveal` | →3 | Public reveal. |
| `search` (revealsCard=true) | →3 | Public. |
| `search` (revealsCard=false) | →2 | Private — actor sees, opponent learns "tutor happened" (lower-fi). |
| `draw` | →2 | Self-info-gain. |
| `mass_inkwell` (from deck top) | →2 or 3 | Top card identity becomes public via inkwell zone — depends on §15.1 inkwell visibility decision. |
| `put_top_card_under` | →1 | No reveal (face-down). |
| `put_top_cards_into_discard` | →3 | Top moves to public discard. |
| `discard_from_hand` (random) | →2 if forced random; →3 if revealing | Engine semantics vary; classifier reads the actual events. |
| `gain_lore` | →1 | Public; no info delta. |
| `deal_damage` / `banish` | →1 | Public state changes. |
| Any effect emitting `hand_revealed` event without `privateTo` | →3 | Public. |
| Any effect emitting `card_revealed` event | →3 | Public. |

Classifier reads `events: GameEvent[]` from `game_actions.events` (already persisted). No need to inspect the action shape itself; the events stream is the post-resolution authoritative signal of "what was revealed".

---

## End

The action-tier classification + snapshot-based rollback + opponent-consent state machine is the load-bearing core. Everything else is policy. The single biggest risk is anti-cheat in casual queue — recommendation is to gate Tier 2/3 strictly to private lobbies. The single biggest payoff is Tier 1 misclick recovery, which is cheap to ship (Phase 2) and probably solves 80% of player frustration.
