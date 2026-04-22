/**
 * Engine version stamp — attached to MP games on creation so clone-trainer
 * exports can filter to a specific engine version (historical actions may
 * not replay cleanly through a later engine that changed resolution order,
 * added new card types, or fixed bugs).
 *
 * Bump this string whenever a change could make old actions un-replayable:
 *   - New CRD rule wiring (win conditions, phase transitions, state-check)
 *   - Reducer handler changes (damage resolution order, trigger fizzle rules)
 *   - New PendingChoice types (older saves may have fields the new engine
 *     doesn't recognize, or vice versa)
 *   - Card-definition schema additions that affect runtime behavior
 *
 * Do NOT bump for:
 *   - Pure card-data additions (set expansions — existing cards still behave
 *     the same)
 *   - Test-only changes
 *   - UI/sandbox-only changes
 *   - Non-behavioral comment / rename edits
 *
 * Format: `YYYY-MM-DD[-N]` where N is an optional same-day disambiguator.
 * Chosen over semver because the engine isn't a public library — we don't
 * track major/minor/patch semantics, just "did the behavior change, and
 * when." YYYY-MM-DD sorts lexicographically as temporal order, which is
 * what database queries filter on.
 *
 * When bumping, add a one-line note in `docs/ENGINE_VERSION_LOG.md` (create
 * if missing) capturing what changed so future analysis can correlate a
 * training-data oddity with a known behavior shift.
 */
export const ENGINE_VERSION = "2026-04-22";
