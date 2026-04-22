// =============================================================================
// CardPlaceholder — a card-frame-styled stand-in rendered when a real card
// image isn't available. Two use cases:
//   1. Cards hand-entered via /dev/add-card before Ravensburger publishes them
//      — imageUrl is empty, but the rest of the data is complete. We want users
//      to still be able to identify the card at a glance in the deckbuilder
//      and inspect modal.
//   2. Live preview beside the /dev/add-card form, showing the user what their
//      card will look like in the browser once they submit it.
//
// Renders the fields that uniquely identify a card (name, subtitle, cost, ink,
// type, stats if character, truncated rules text, rarity) inside a card-sized
// container (5:7 aspect ratio). Color palette keyed on inkColors so a steel
// card doesn't look identical to a ruby one at a glance.
// =============================================================================

import type { CardType, InkColor } from "@lorcana-sim/engine";

/** Subset of CardDefinition sufficient to render a placeholder. All fields
 *  optional so the /dev/add-card preview can render partial in-progress form
 *  data without complaining. Explicit `| undefined` on each optional field so
 *  callers can spread a real `CardDefinition` (whose optional fields are
 *  `X | undefined` under `exactOptionalPropertyTypes`) without TS rejecting
 *  the explicit-undefined values. */
export interface CardPlaceholderData {
  name?: string | undefined;
  subtitle?: string | undefined;
  cardType?: CardType | undefined;
  inkColors?: InkColor[] | undefined;
  cost?: number | undefined;
  inkable?: boolean | undefined;
  traits?: string[] | undefined;
  strength?: number | undefined;
  willpower?: number | undefined;
  lore?: number | undefined;
  rulesText?: string | undefined;
  rarity?: string | undefined;
  setId?: string | undefined;
  number?: number | undefined;
}

interface Props {
  data: CardPlaceholderData;
  /** Extra classes on the outer frame — pass width/height classes here. Falls
   *  back to w-full aspect-[5/7] if omitted. */
  className?: string;
  /** Compact mode for deckbuilder tiles — hides the rules-text block and
   *  shortens the type banner. The inspect modal uses the full mode. */
  compact?: boolean;
}

// Ink color → gradient + accent. Primary ink dominates the background;
// secondary inks show as pips along the top. Values are Tailwind arbitrary
// classes using the same ink hexes the CardInspectModal uses for badges.
const INK_BG: Record<InkColor, string> = {
  amber:    "from-[#6a4c10] via-[#3b2a0a] to-[#1a130a]",
  amethyst: "from-[#4a2650] via-[#2a1530] to-[#150d1a]",
  emerald:  "from-[#1f5328] via-[#0f2c16] to-[#0a170e]",
  ruby:     "from-[#7a0020] via-[#3e0013] to-[#1a0008]",
  sapphire: "from-[#0a5575] via-[#052c3e] to-[#03161f]",
  steel:    "from-[#5c646d] via-[#30343a] to-[#16181b]",
};

const INK_PIP: Record<InkColor, string> = {
  amber:    "bg-[#f4b223]",
  amethyst: "bg-[#7c4182]",
  emerald:  "bg-[#329044]",
  ruby:     "bg-[#d50037]",
  sapphire: "bg-[#0093c9]",
  steel:    "bg-[#97a3ae]",
};

const TYPE_LABEL: Record<CardType, string> = {
  character: "Character",
  action: "Action",
  item: "Item",
  location: "Location",
};

export default function CardPlaceholder({ data, className, compact = false }: Props) {
  const primaryInk = data.inkColors?.[0] ?? "steel";
  const gradient = INK_BG[primaryInk];

  const name = data.name?.trim() || "Card Name";
  const subtitle = data.subtitle?.trim();
  const cardType = data.cardType;
  const cost = typeof data.cost === "number" ? data.cost : "?";
  const rulesText = data.rulesText?.trim();

  return (
    <div
      className={`relative rounded-lg overflow-hidden border border-gray-700 shadow-lg bg-gradient-to-b ${gradient} ${
        className ?? "w-full aspect-[5/7]"
      }`}
    >
      {/* Inkable frame indicator — subtle inner ring when inkable */}
      {data.inkable && (
        <div className="absolute inset-0.5 rounded-md border border-amber-500/20 pointer-events-none" />
      )}

      {/* Top bar — cost (left) + ink pips (right) */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-1.5 sm:p-2">
        <div
          className="flex items-center justify-center rounded-full bg-black/70 border border-white/20 text-white font-black shadow-md"
          style={{ width: compact ? 22 : 32, height: compact ? 22 : 32, fontSize: compact ? 12 : 16 }}
          title={`Cost: ${cost}`}
        >
          {cost}
        </div>
        <div className="flex items-center gap-0.5">
          {(data.inkColors ?? []).map((ink, i) => (
            <span
              key={`${ink}-${i}`}
              className={`${INK_PIP[ink]} rounded-full border border-black/30 shadow-sm`}
              style={{ width: compact ? 10 : 14, height: compact ? 10 : 14 }}
              title={ink}
            />
          ))}
        </div>
      </div>

      {/* Center — name, subtitle, type */}
      <div
        className="absolute left-0 right-0 px-2 text-center flex flex-col items-center justify-center"
        style={{ top: compact ? "28%" : "30%", bottom: compact ? "40%" : "36%" }}
      >
        <div
          className={`text-white font-black leading-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] ${
            compact ? "text-[10px]" : "text-base"
          }`}
          style={{ wordBreak: "break-word" }}
        >
          {name}
        </div>
        {subtitle && (
          <div
            className={`text-white/80 italic leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] mt-0.5 ${
              compact ? "text-[8px]" : "text-xs"
            }`}
          >
            {subtitle}
          </div>
        )}
        {cardType && (
          <div
            className={`mt-1.5 px-1.5 py-0.5 rounded-sm bg-black/60 border border-white/20 text-white/90 uppercase font-bold tracking-wider ${
              compact ? "text-[7px]" : "text-[9px]"
            }`}
          >
            {TYPE_LABEL[cardType]}
            {data.traits && data.traits.length > 0 && !compact && (
              <span className="ml-1 text-white/60 normal-case font-normal">
                · {data.traits.slice(0, 2).join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Rules-text preview (non-compact only) — truncated middle block */}
      {!compact && rulesText && (
        <div
          className="absolute left-2 right-2 top-[64%] bottom-[18%] overflow-hidden bg-black/40 rounded px-1.5 py-1 border border-white/10"
        >
          <div className="text-[9px] leading-snug text-white/85 line-clamp-4">
            {rulesText}
          </div>
        </div>
      )}

      {/* Bottom bar — stats for characters, lore for locations, set/num for others */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-1.5 sm:p-2">
        {/* Strength (characters) or set/num (others) — left slot */}
        <div className="flex items-center gap-0.5">
          {cardType === "character" && typeof data.strength === "number" ? (
            <StatBadge label="STR" value={data.strength} color="bg-red-600" compact={compact} />
          ) : (
            <span className={`text-white/50 font-mono ${compact ? "text-[8px]" : "text-[10px]"}`}>
              {data.setId ? `S${data.setId}` : ""}
              {data.number ? `·${data.number}` : ""}
            </span>
          )}
        </div>
        {/* Willpower + lore (characters) or lore (locations) — right slot */}
        <div className="flex items-center gap-0.5">
          {cardType === "character" && typeof data.willpower === "number" && (
            <StatBadge label="WIL" value={data.willpower} color="bg-gray-700" compact={compact} />
          )}
          {(cardType === "character" || cardType === "location") && typeof data.lore === "number" && data.lore > 0 && (
            <StatBadge label="L" value={data.lore} color="bg-amber-500" compact={compact} />
          )}
        </div>
      </div>

      {/* Rarity badge (top-center, barely visible) */}
      {data.rarity && !compact && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/50 border border-white/10 text-white/60 uppercase font-bold tracking-wider text-[7px]">
          {data.rarity.replace("_", " ")}
        </div>
      )}
    </div>
  );
}

function StatBadge({
  label,
  value,
  color,
  compact,
}: {
  label: string;
  value: number;
  color: string;
  compact: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded ${color} text-white font-black shadow-md border border-black/30 ${
        compact ? "text-[9px] px-1 py-0.5 gap-0.5" : "text-xs px-1.5 py-0.5 gap-1"
      }`}
      title={label}
    >
      <span className="opacity-75 font-bold">{label}</span>
      <span>{value}</span>
    </div>
  );
}
