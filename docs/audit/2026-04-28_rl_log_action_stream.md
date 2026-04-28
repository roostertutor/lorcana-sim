# RL Action Stream vs `state.actionLog` — Architectural Audit

**Date**: 2026-04-28
**Question**: Should `state.actionLog` (human-readable game log) be 1:1 with the action stream that the RL trainer / policy consumes?
**Answer**: **No — keep them separate. The current separation is principled and the action stream (typed `GameAction[]` + `ActionResult.events`) is already the canonical source. The log is a derived human projection.** A small documentation gap exists, but no code change is recommended.

## Table of Contents

1. [What the policy actually consumes](#what-the-policy-actually-consumes)
2. [What `actionLog` actually is](#what-actionlog-actually-is)
3. [Granularity, privacy, determinism](#granularity-privacy-determinism)
4. [Coupling check — does the trainer ever read the log?](#coupling-check)
5. [Three streams, three audiences](#three-streams-three-audiences)
6. [Recommendation](#recommendation)

---

## What the policy actually consumes

The RL pipeline never sees `actionLog`. It consumes three distinct things, none of which are `GameLogEntry`:

**Policy network input** — feature vector built from `GameState`, not from logs:
- `stateToFeatures(state, playerId, definitions)` at `packages/simulator/src/rl/autoTag.ts:206` reads `state.cards`, `state.players`, zone arrays via `getZone`, `state.turnNumber`, `state.pendingChoice`. It does not look at `state.actionLog`.
- `actionToFeatures(state, action, playerId, definitions)` at `packages/simulator/src/rl/autoTag.ts:279` consumes a typed `GameAction` (PLAY_CARD, PLAY_INK, QUEST, CHALLENGE, ACTIVATE_ABILITY, PASS_TURN, RESOLVE_CHOICE) — the action **discriminator** is one-hot encoded, not the log message.

**Policy network output** — a typed `GameAction`:
- `RLPolicy.decideAction` at `packages/simulator/src/rl/policy.ts:114` returns `GameAction`, scored over `getAllLegalActions`. Never produces a string.

**Trajectory data structure** — `EpisodeStep`, distinct from `GameLogEntry`:

```ts
// packages/simulator/src/rl/policy.ts:54
export interface EpisodeStep {
  stateFeatures: number[];        // 1130-dim vector
  chosenActionFeatures?: number[]; // 94-dim vector
  logProbChosen: number;
  isAction: boolean;
  mulliganIndex?: number;
  turnIndex: number;
  reward: number;
  valuePred: number;
}
```

This is a numeric tuple, not a `GameLogEntry`. The trainer's reward signal `computePerStepRewards` at `packages/simulator/src/rl/trainer.ts:70` reads `result.loreByTurn` (snapshots from `runGame`), and `computeSingerStepBonuses` at `packages/simulator/src/rl/trainer.ts:84` iterates `result.actions` (typed `GameAction[]`) — never `result.actionLog`.

## What `actionLog` actually is

`GameLogEntry` at `packages/engine/src/types/index.ts:3922`:

```ts
export interface GameLogEntry {
  timestamp: number;     // wall-clock
  turn: number;
  playerId: PlayerID;
  message: string;       // English prose
  type: GameLogEntryType;
  privateTo?: PlayerID;  // visibility filter
}
```

What's notably absent: no `GameAction` reference, no `instanceId`, no state diff, no reward, no value target. It's prose with light metadata. The 17-variant `GameLogEntryType` enum (at `:3955`) is a coarse classification (`card_played`, `lore_gained`, `mulligan`, …) — closer to a UI log filter than a machine-readable trace.

## Granularity, privacy, determinism

| Concern | `actionLog` | Action / event stream |
|---|---|---|
| **Granularity per `applyAction`** | Many-to-one. `appendLog` is called 26+ times across `reducer.ts` per action (one for the dispatched action plus one per cascading trigger). | One `GameAction` in, one `ActionResult` out, with N typed `GameEvent`s carrying `cause: "primary" \| "trigger" \| "replacement"` (`packages/engine/src/types/index.ts:4101`). |
| **Privacy** | Filtered per-viewer via `privateTo` + `redactPrivateMessage` (`server/src/services/stateFilter.ts:136`). UI-visible. | Training sees full state. `GameEvent.hand_revealed` carries its own `privateTo` so the trainer can audit "what did the bot actually see." |
| **Determinism** | `timestamp = Date.now()` in `appendLog` (`packages/engine/src/utils/index.ts:861`) — wall-clock, **not deterministic**. Replayability would require stripping or ignoring this field. | Pure functions of `(state, action, definitions)`. RNG cloned on entry to `applyAction`. Fully replay-deterministic. |
| **Information completeness for RL** | Insufficient — no state diff, no reward, no card-id at the action level for many entries (just paraphrased message). Can't reconstruct features. | Sufficient — `state_before + action + state_after + events` (the schema the server already persists for clone-trainer in `game_actions`, `server/src/db/schema.sql:40`) gives you everything. |

This rules out "train from logs." The log can't reconstruct the trajectory the RL needs.

## Coupling check

I verified the actual coupling between layers:

**Does the trainer read `actionLog`?** No. `grep actionLog packages/simulator/src/rl/` returns zero matches. The only simulator-side reads of `actionLog` are:
- `packages/simulator/src/runGame.ts:245` — passes through to `GameResult.actionLog` (for CLI display).
- `packages/simulator/src/runGame.ts:258-259` — derives `mulliganed: Record<PlayerID, boolean>` from `actionLog.some(e => e.type === "mulligan" && ...)`.

The mulligan derivation at `runGame.ts:258` is a **mild coupling smell**: it fishes a string substring (`message.includes("mulliganed")`) out of a log entry to populate a structured `GameResult.mulliganed` field. If someone reworded the mulligan log message, this silently breaks. It should derive from the engine's mulligan resolution path (or a dedicated counter) rather than from the prose. Low-priority — not in the RL hot path, and `mulliganed` doesn't drive training.

**Does the log drive game state?** No. `appendLog` returns a new state with the log entry appended; nothing in the reducer reads `state.actionLog` to make decisions. The log is purely a side-effect tail.

**Are `GameLogEntryType` and the `GameAction` / `GameEvent` types tightly coupled?** No, and that's good. They overlap conceptually but evolve independently:
- `GameAction` (10 variants, `packages/engine/src/types/index.ts:3980`) — what a player can dispatch.
- `GameEvent` (9 variants, `:4103`) — what physically happened in state, with cascade attribution.
- `GameLogEntryType` (17 variants, `:3955`) — UI categories for log line styling/filtering.

The lack of a structural link is fine because they answer different questions ("what was attempted" vs. "what happened" vs. "how should this line render in the log panel").

**Storage cost**: `StoredGameResult = Omit<GameResult, "actionLog" | "actions">` (`packages/simulator/src/types.ts:145`). Stripping logs to keep simulation files manageable is already convention.

**Server-side persistence** uses the action stream, not the log. `server/src/db/schema.sql:40-50` and `gameService.ts:247` persist `(action, state_before, state_after, events, legal_action_count)` per row in `game_actions`. The schema comments at `:355-385` explicitly call out that the typed `events` stream is what the clone-trainer pipeline consumes — log strings would be insufficient because they lose cascade attribution, hidden-info reveal annotations, and effect granularity.

## Three streams, three audiences

The current architecture already partitions cleanly:

| Stream | Lives on | Audience | Properties |
|---|---|---|---|
| `GameAction[]` (action stream) | `GameResult.actions`, `game_actions.action` | RL trainer, replay engine | Typed, deterministic, structured. The canonical record of "what a player chose." |
| `ActionResult.events` (event stream) | `game_actions.events` | Clone-trainer, UI animations, analytics | Typed, deterministic, cascade-attributed. The canonical record of "what happened in state." |
| `GameLogEntry[]` (log) | `state.actionLog`, `GameResult.actionLog` | Humans (CLI `printActionLog`, UI log panel) | Prose, privacy-filtered, wall-clock timestamped. A derived projection. |

Unifying the three would be a regression: forcing the log to carry RL-grade structured data bloats it, hurts privacy (currently message-only redaction is straightforward), and breaks human readability. Forcing the trainer to parse English prose is strictly worse than reading typed `GameAction`s.

## Recommendation

**Don't unify.** The current shape is principled. Three small follow-ups, none code-critical:

1. **Document the contract.** Add a 3-4 line comment at the top of `state.actionLog`'s declaration in `packages/engine/src/types/index.ts:3614` clarifying: *"Human-readable projection of the action stream. Authoritative records: `GameAction` (input) and `ActionResult.events` (state changes). The log is for humans (CLI, UI) and is privacy-filtered server-side; it is not a training input and is not deterministic (carries wall-clock `timestamp`)."* This prevents future contributors from being tempted to train off it or assert against its prose.

2. **Fix the `mulliganed` substring sniff** (`packages/simulator/src/runGame.ts:258`). It violates the contract above by treating the log prose as the source of truth for a structured `GameResult` field. Replace with either a counter incremented during mulligan resolution or a derive-from-`actions` pass that looks for `RESOLVE_CHOICE` against a `choose_mulligan` pendingChoice with non-empty `choice`. Low-priority — it works today, but it's a tripwire.

3. **The clone-trainer pipeline mentioned in CLAUDE.md is already shaped correctly.** `server/src/db/schema.sql:355-385` documents exactly why the typed event stream beats the log for training: cascade attribution, privacy annotations, effect granularity. Keep this as the reference for future trainer work — when training from MP-replay data lands, it consumes `game_actions.events` + `state_before/after`, not `actionLog`.

The "should they be 1:1?" question reads to me as a pre-emptive check on whether the log is leaking into the RL surface or vice versa. It isn't. The separation already in place is the right one — both for the simulator-side trainer and for the future clone-trainer that reads from the multiplayer database.
