// =============================================================================
// formatDuration — perspective-correct English label for an EffectDuration.
//
// Replaces the two near-duplicate formatters that lived in CardInspectModal
// and GameBoard's getActiveEffects. Both were hardcoded to caster's-side
// pronouns ("Until your next turn") which mis-attributes "your" when the
// viewer is the opponent of the caster.
//
// CRD vocab:
// - `until_caster_next_turn` — caster-anchored. Expires when CASTER starts
//   their next turn. Use TimedEffect.casterPlayerId / GlobalTimedEffect
//   .controllingPlayerId for the casterPlayerId arg.
// - `end_of_owner_next_turn` — owner-anchored. Expires at the end of the
//   AFFECTED CARD'S OWNER'S next turn. Use the card instance's ownerId for
//   the ownerPlayerId arg.
//
// Other durations (`end_of_turn`, `while_source_in_play`, etc.) don't depend
// on player perspective; they pass through with their existing English.
// =============================================================================

import type { PlayerID } from "@lorcana-sim/engine";

/**
 * Convert an EffectDuration value to a human-readable suffix that reads
 * correctly from the viewer's perspective.
 *
 * @param duration       The EffectDuration enum string (or undefined for no label).
 * @param casterPlayerId The player who cast the effect. For caster-anchored
 *                       durations like `until_caster_next_turn`, this is the
 *                       reference point. Pulled from
 *                       `TimedEffect.casterPlayerId` /
 *                       `GlobalTimedEffect.controllingPlayerId`.
 * @param viewerPlayerId The player viewing the UI (`myId`). Determines whether
 *                       to render "your" vs "opponent's".
 * @param ownerPlayerId  The owner of the affected card (only meaningful for
 *                       owner-anchored durations like `end_of_owner_next_turn`).
 *                       Pulled from `state.cards[instanceId].ownerId`.
 */
export function formatDuration(
  duration: string | undefined,
  casterPlayerId: PlayerID | undefined,
  viewerPlayerId: PlayerID | undefined,
  ownerPlayerId?: PlayerID,
): string | undefined {
  if (!duration) return undefined;
  switch (duration) {
    case "end_of_turn":
      return "This turn";

    case "until_caster_next_turn": {
      // Caster-anchored. The "your" in the CRD wording refers to the caster,
      // not the viewer.
      if (!casterPlayerId) return "Until the caster's next turn";
      if (casterPlayerId === viewerPlayerId) return "Until your next turn";
      return "Until opponent's next turn";
    }

    case "end_of_owner_next_turn": {
      // Owner-anchored. Expires at the end of the affected card's owner's
      // next turn. Falls back to caster if owner wasn't passed (defensive
      // for global / non-card-targeted uses, though the duration is
      // typically per-card).
      const reference = ownerPlayerId ?? casterPlayerId;
      if (!reference) return "Until end of their next turn";
      if (reference === viewerPlayerId) return "Until end of your next turn";
      return "Until end of opponent's next turn";
    }

    case "while_source_in_play":
      return "While in play";

    // The next four aren't part of the live EffectDuration union but were
    // present in the legacy formatters as defensive fallbacks. Preserve
    // them so we don't regress whatever was relying on the old shape.
    case "end_of_next_turn":
      return "Until next turn";
    case "while_in_play":
      return "While in play";
    case "permanent":
      return "Permanent";
    case "once":
      return "Once";

    default:
      return duration.replace(/_/g, " ");
  }
}
