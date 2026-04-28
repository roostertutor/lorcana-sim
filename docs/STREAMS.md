# STREAMS.md

Three stream-shaped artifacts coexist in the codebase that look superficially similar (all are sequences of "things that happened during a game") but serve different audiences and have different cardinality, shape, and semantics. Conflating them — or trying to derive one from another via prose parsing — has caused real bugs (see "Known coupling bugs" below). This doc enumerates them so future work doesn't drift.

## TL;DR

| Stream | Where | Audience | Shape | Cardinality per `applyAction` |
|---|---|---|---|---|
| `state.actionLog` | engine `GameState` | humans (game log UI, replay viewer) | `GameLogEntry[]` — English prose, paraphrased, privacy-filtered (`privateTo`) | **N entries** (action + per-trigger + per-effect) |
| `GameResult.actions` | simulator per-game record | replay reconstruction, sim, clone trainer | `GameAction[]` — typed discriminated union, lossless | **1 entry** |
| `RLPolicy.episodeHistory` | simulator runtime memory | RL trainer (Actor-Critic + GAE) | `EpisodeStep[]` — feature vectors per bot decision | **1 entry per bot-controlled action** |

The UI also keeps a fourth, narrower-scoped sequence: `actionHistoryRef: GameAction[]` inside `useGameSession.ts`, used purely to back the in-session undo button. Same shape as `GameResult.actions`, different lifetime — gone when the page reloads (HMR-persisted via session storage; see `SESSION_KEY` in that file).

## The three streams in detail

### 1. `state.actionLog: GameLogEntry[]`

Lives on `GameState` itself; serialized with the rest of the state across server/client wire and saved sims.

**Shape** (per `types/index.ts`):

```ts
interface GameLogEntry {
  timestamp: number;
  turn: number;
  playerId: PlayerID;
  message: string;          // English prose, paraphrased
  type: GameLogEntryType;   // discriminator for filtering/replay
  privateTo?: PlayerID;     // server redacts message when viewer ≠ privateTo
}
```

**Audience**: humans reading the game log UI. Privacy-aware — entries stamped with `privateTo` get their `message` redacted by `server/src/services/stateFilter.ts` for the non-authorized viewer (a hidden draw still logs as "X drew a card." but the card name is removed).

**Cardinality**: many entries per `applyAction` invocation. A single `PLAY_CARD` may produce: the play line + per-trigger lines + per-effect lines (hand draws, lore changes, banishes, etc.). Roughly proportional to how much the engine "did" during that action.

**Append sites**: 26 `appendLog` callsites in `reducer.ts` + 2 raw log writes in `initializer.ts`. Per the 2026-04-28 audit, 22 of 28 callsites are hand-written paraphrases; **0 pass card text verbatim**. Information loss is real — banish causality is collapsed to `"Y was banished"` (challenge / damage / banish-effect / GSC cleanup all flatten); activated-ability log drops which ability fired (P1.12); effect-driven discards/look_at_hand/gain_lore are silently mutating with no log line at all (P1.11).

**NOT a source of truth for replay.** Reconstructing a game from prose is structurally lossy (no privacy-aware re-redaction, no causality, paraphrases drop info). Use `GameResult.actions` for that.

### 2. `GameResult.actions: GameAction[]`

Lives on the simulator's per-game wrapper at `packages/simulator/src/types.ts`. Filled by `runGame.ts` as it appends each successful action.

**Shape**:

```ts
interface GameResult {
  // ...
  actionLog: GameLogEntry[];   // human-readable (stream 1, captured here for analysis)
  actions: GameAction[];       // ← THIS — typed actions, 1 per applyAction
  seed: number;                // same seed + same actions = same game
  // ...
}
```

**Audience**: replay reconstruction (`reconstructState(initialState, actions)` is deterministic given the seed); simulator analyses; clone trainer (when implemented, it will train on human action sequences with the same shape).

**Cardinality**: exactly one per `applyAction`. Lossless — the discriminated union captures everything the player chose to do.

**Determinism**: replay relies on `state.rng` being preserved. `applyAction` clones `state.rng` at entry (`reducer.ts:90`) so the caller's state isn't mutated. There's an explicit regression test at `undo-rng-isolation.test.ts`.

**NOT the engine's per-action return.** `applyAction(state, action, definitions)` returns an `ActionResult` (`{success, newState, error?, events}`), which carries `events: GameEvent[]` for animation/sound cues — NOT another copy of the action. The dispatched `action` itself IS the canonical record; the simulator captures it into `GameResult.actions[]`.

### 3. `RLPolicy.episodeHistory: EpisodeStep[]`

Private field on the `RLPolicy` class (`packages/simulator/src/rl/policy.ts:86`). Accumulated across all `applyAction` calls during a sim where this policy controlled the active player; cleared at episode end via `updateFromEpisode`.

**Shape**:

```ts
interface EpisodeStep {
  stateFeatures: number[];          // 224-dim
  chosenActionFeatures?: number[];  // 80-dim, or undefined for mulligan steps
  logProbChosen: number;
  isAction: boolean;                // false for mulligan steps
  mulliganIndex?: number;
  turnIndex: number;
  reward: number;                   // per-step reward (filled at episode end)
  valuePred: number;                // critic's V(s) at this step
}
```

**Audience**: RL trainer only. Actor-Critic with GAE (λ=0.95) — A2C update per step, MSE on the value head.

**Cardinality**: ≤1 per `applyAction` and only when the policy was the deciding agent. Mulligan steps are interleaved (one EpisodeStep per mulligan decision) but `isAction: false` keeps them separate from in-game actions for the loss math.

**NOT user-visible.** Never serialized to disk (the policy's weights are saved via `RLPolicyJSON`, but not the per-game step record).

## Known coupling bugs (don't reintroduce)

These exist or recently existed because someone treated structured data as a string and parsed it:

1. **`runGame.ts:258`** — *fixed in commit `5a0fe17`*. Previously derived `mulliganed: Record<PlayerID, boolean>` by substring-matching `"mulliganed"` against log prose; now derives from `actions[]` via the exported `deriveMulliganed(actions)` helper (scans for the first array-shaped `RESOLVE_CHOICE` per player). The substring-match was the canonical anti-pattern this doc warns against.

2. **`storage.ts:67`** — *fixed in commit `5a0fe17`*. Previously stripped BOTH `actionLog` AND `actions[]` from saved sim files. Since `actionLog` is a derivable projection but `actions[]` is the canonical replay record, this rendered past saved sims unreplayable. The strip was scoped down to `actionLog` only; `actions[]` (~5KB/game) survives so saved sims are now replay-capable.

The pattern is: treat structured data as a string only at the very last UI rendering step; never parse strings to derive structure. The tooling supports this — `CardFilter` is fully typed, `GameAction` is discriminated, `GameLogEntryType` is a discriminator. Use the structured field. If you find yourself reaching for `message.includes(...)` or `rulesText.split("\n")` outside a UI render path, you're probably introducing a drift coupling.

## Why these aren't unified

The three streams have genuinely different shapes for genuinely different reasons. Forcing 1:1 would either:

- **Bloat the log** with RL-grade structured data (hurts privacy filtering; hurts readability for humans).
- **Force the trainer to parse English prose** to extract action features (strictly worse than typed actions).
- **Force replay reconstruction to navigate paraphrased prose** (lossy; can't replay private-information cards correctly).

Different audiences, different cardinalities, different fidelity requirements. Keep them separate.

## When to add a fourth stream

If a future feature needs game history at a NEW fidelity level — e.g., per-decision policy gradient values for a new RL algorithm, or per-frame visual state for a recorded replay — add a new field. Don't try to overload one of the three above. The criterion is: is the new audience consuming the same shape and cardinality as an existing stream? If yes, reuse. If no, new stream.
