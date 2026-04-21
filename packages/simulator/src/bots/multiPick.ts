// =============================================================================
// MULTI-PICK HELPERS
// Shared by RLPolicy, GreedyBot (via choiceResolver), and RandomBot to
// enumerate / select multi-card resolutions for `choose_from_revealed`.
//
// The bug this fixes: multi-pick effects (Dig a Little Deeper, Look at This
// Family — both have pendingEffect.maxToHand=2) require the bot to return a
// `choice` array of size min(maxToHand, validTargets.length). Previously each
// bot only emitted single-pick candidates, so the engine would receive 1 ID
// when it expected 2 — taking 1 card to hand instead of 2 and silently leaving
// the second pick on deck.
// =============================================================================

import type { PendingChoice } from "@lorcana-sim/engine";

/** Cap on enumerated combinations to bound forward-pass work in the RL bot. */
export const MAX_MULTI_PICK_CANDIDATES = 64;

/**
 * Returns the legal pick-size range for a `choose_from_revealed` resolution.
 *
 * - Mandatory multi-pick (Dig a Little Deeper, Look at This Family): exactly
 *   `min(maxToHand, validTargets.length)` (CRD 1.7.x "as much as possible"
 *   when the deck is short).
 * - Optional multi-pick (`isMay` look_at_top, e.g. The Family Madrigal):
 *   0..min(maxToHand, validTargets.length).
 * - Single-pick (default `maxToHand=1`, or any other choice type): 0..1 if
 *   optional else exactly 1.
 *
 * The engine reads `pendingEffect.maxToHand` off the original `look_at_top`
 * effect; for `choose_target` and other types there's no such field so we
 * default to 1 (preserves prior single-pick behavior).
 */
export function getMultiPickRange(choice: PendingChoice): { minSize: number; maxSize: number } {
  const targets = choice.validTargets ?? [];
  const pendingEff = choice.pendingEffect as { maxToHand?: number } | undefined;
  const maxToHand = pendingEff?.maxToHand ?? 1;
  const maxSize = Math.min(maxToHand, targets.length);
  const minSize = choice.optional ? 0 : maxSize;
  return { minSize, maxSize };
}

/**
 * Enumerate combinations of `targets` whose size is in [minSize, maxSize].
 * Stops once `cap` combos have been produced (combinatorial safety net for
 * large reveal piles). Always includes the empty combo when minSize is 0.
 *
 * Order: smallest sizes first, lexicographic within each size — keeps the
 * empty-pick option early when applicable.
 */
export function enumerateMultiPickCombos(
  targets: readonly string[],
  minSize: number,
  maxSize: number,
  cap: number = MAX_MULTI_PICK_CANDIDATES
): string[][] {
  const out: string[][] = [];
  for (let size = minSize; size <= maxSize && out.length < cap; size++) {
    if (size === 0) {
      out.push([]);
      continue;
    }
    // k-combinations via index walk; cheap for the small sizes we expect
    // (most multi-pick reveals are 5-7 cards picking 2).
    const indices: number[] = Array.from({ length: size }, (_, i) => i);
    const n = targets.length;
    if (size > n) continue;
    while (out.length < cap) {
      out.push(indices.map((i) => targets[i]!));
      // Advance to the next combination (rightmost-first).
      let i = size - 1;
      while (i >= 0 && indices[i]! === n - size + i) i--;
      if (i < 0) break;
      indices[i]!++;
      for (let j = i + 1; j < size; j++) indices[j] = indices[j - 1]! + 1;
    }
  }
  return out;
}
