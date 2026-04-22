# Engine Version Log

Every `ENGINE_VERSION` bump in `packages/engine/src/version.ts` gets a one-line
entry here. The version string is stamped on every MP game in
`games.engine_version` so clone-trainer exports can correlate training data
with known engine behavior shifts.

**Bump policy** (duplicated in `packages/engine/src/version.ts` for locality):
bump when a change could make old actions un-replayable — CRD rule wiring,
reducer handler changes, new PendingChoice types, card-definition schema
additions that affect runtime. Do NOT bump for pure card-data additions,
test-only changes, UI/sandbox-only changes, or non-behavioral edits.

## Log (newest first)

### `2026-04-22`

Initial stamp. Introduced with the clone-trainer data-shape cleanup. Prior
MP games have `engine_version = NULL` — training pipelines should either
filter them out or treat them as pre-stamp unknown. All MP traffic from
this date forward carries the stamp.

Notable engine changes since the last "anchor" (whatever engine state
produced the pre-stamp data):
- CRD 2.1.3.2 play-draw — new `choose_play_order` PendingChoice, new
  `play_order_select` phase. Games created under this version may contain
  pending choices older engines don't know about.
- `action_restriction.sourceInstanceId` added so `filter.excludeSelf`
  works for Ursula Sea Witch Queen and similar "other characters" restrictions.
- Various card-ability fixes (non-behavioral for the reducer layer).
