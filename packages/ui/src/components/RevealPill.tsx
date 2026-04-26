import React from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import Pill from "./Pill.js";
import Icon from "./Icon.js";

interface Props {
  /** Tooltip text — used as the button's title attribute. */
  title: string;
  /** Cards in this reveal (just used for the count badge — modal renders them). */
  cardIds: string[];
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  onClick: () => void;
  /** Uniform face-down (hide content — e.g. opponent peeked their own cards). */
  faceDown?: boolean;
}

/**
 * Compact "reveal" chip — eye icon + count of cards revealed. Tapping
 * opens the full reveal modal (ZoneViewModal) which carries the
 * descriptive content (title, all revealed cards, owner badges).
 *
 * Singleton per reveal-source: one chip per "hand revealed" instance,
 * one chip combining all "cards revealed" events for the turn. Eye icon
 * works because there's no per-event differentiation needed — the pill
 * is a count summary, the modal is the detail view.
 *
 * `gameState` and `definitions` props are kept for API symmetry with
 * how the parent passes them; not currently consumed in the chip body
 * (modal looks up cards itself).
 */
export default function RevealPill({ title, cardIds, onClick }: Props) {
  return (
    <Pill
      theme="indigo"
      size="compact"
      onClick={onClick}
      title={`${title} — tap to view`}
    >
      <Icon name="eye" className="w-3 h-3 text-indigo-300" />
      <span className="text-[10px] font-black text-indigo-100 leading-none tabular-nums">
        {cardIds.length}
      </span>
    </Pill>
  );
}
