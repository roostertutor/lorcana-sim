// =============================================================================
// AbilityTextRender — structured HTML rendering of a SINGLE ability.
// Use when the ability is the subject of the UI (trigger picker, ability
// resolution prompts), not the card. Tiny attribution to the source card,
// then the ability itself.
//
// Paired companion to CardTextRender (which renders the whole card).
// =============================================================================

import type { Ability } from "@lorcana-sim/engine";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

interface Props {
  ability: Ability;
  /** Card that owns the ability — shown as small attribution. */
  cardName: string;
  /** Compact variant: tighter spacing, smaller type. */
  compact?: boolean;
}

export default function AbilityTextRender({ ability, cardName, compact = false }: Props) {
  const pad = compact ? "p-2" : "p-3";

  // Keyword abilities get a compact "Challenger +2" style row.
  if (ability.type === "keyword") {
    const label = capitalize(ability.keyword);
    const value = ability.value != null ? ` +${ability.value}` : "";
    return (
      <div className={`rounded-lg bg-gray-900 border border-gray-800 ${pad}`}>
        <div className="text-[9px] text-gray-500 italic truncate">{cardName}</div>
        <div className="text-xs font-bold text-indigo-200 mt-0.5">{label}{value}</div>
      </div>
    );
  }

  // Triggered / Activated / Static: storyName + rulesText.
  const storyName = (ability as { storyName?: string }).storyName;
  const rulesText = (ability as { rulesText?: string }).rulesText;

  return (
    <div className={`rounded-lg bg-gray-900 border border-gray-800 ${pad}`}>
      <div className="text-[9px] text-gray-500 italic truncate">{cardName}</div>
      {storyName && (
        <div className="text-[11px] font-bold text-indigo-200 mt-1 tracking-wide">
          {storyName}
        </div>
      )}
      {rulesText && (
        <div className="text-[10px] text-gray-300 leading-snug mt-0.5">
          {rulesText}
        </div>
      )}
    </div>
  );
}
