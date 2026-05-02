// =============================================================================
// GameCard — Visual card component for board zones and hand
// =============================================================================

import React, { useMemo } from "react";
import type { CardDefinition, GameState, GameModifiers, KeywordAbility } from "@lorcana-sim/engine";
import { getGameModifiers, getEffectiveStrength, getEffectiveWillpower, evaluateCondition, HIDDEN_DEFINITION } from "@lorcana-sim/engine";
import Icon from "./Icon.js";
import type { IconName } from "./Icon.js";
import Glyph from "./Glyph.js";
import { getBoardCardImage } from "../utils/cardImage.js";

// Ink color → gradient + border
const INK_THEME: Record<string, { border: string; gradFrom: string; gradTo: string; costBg: string; glow: string }> = {
  amber:    { border: "border-amber-500/70",   gradFrom: "from-amber-900/50",   gradTo: "to-amber-950/80",   costBg: "bg-amber-500",   glow: "shadow-amber-500/20" },
  amethyst: { border: "border-purple-500/70",  gradFrom: "from-purple-900/50",  gradTo: "to-purple-950/80",  costBg: "bg-purple-500",  glow: "shadow-purple-500/20" },
  emerald:  { border: "border-emerald-500/70", gradFrom: "from-emerald-900/50", gradTo: "to-emerald-950/80", costBg: "bg-emerald-500", glow: "shadow-emerald-500/20" },
  ruby:     { border: "border-red-500/70",     gradFrom: "from-red-900/50",     gradTo: "to-red-950/80",     costBg: "bg-red-500",     glow: "shadow-red-500/20" },
  sapphire: { border: "border-blue-500/70",    gradFrom: "from-blue-900/50",    gradTo: "to-blue-950/80",    costBg: "bg-blue-500",    glow: "shadow-blue-500/20" },
  steel:    { border: "border-gray-400/70",    gradFrom: "from-gray-700/50",    gradTo: "to-gray-900/80",    costBg: "bg-gray-400",    glow: "shadow-gray-400/20" },
};

const DEFAULT_THEME = INK_THEME.steel!;

// =============================================================================
// CARD_SIZING — per-context width/height className strings
//
// Centralized so a card-size adjustment is a single edit. The card has four
// distinct sizing contexts:
//
//   adaptivePlay:     live in-play card. Height-adaptive in portrait
//                     (h-full + max-h:73 + min-w:28), explicit 45×63 in
//                     landscape-phone, falls through to sm:w-[104px]
//                     lg:w-[120px] from baseClass for tablet/desktop.
//
//   adaptiveFaceDown: opp-hand peek (face-down). Smaller landscape (28×39)
//                     so the peek-strip / card-height ratio stays close to
//                     portrait (bumping to 45×63 would halve visible
//                     card-back area in landscape).
//
//   hand:             live face-up hand card. Explicit width per breakpoint
//                     (88 portrait → 72 landscape → 104 sm → 120 lg).
//
//   previewPlay /     naturalSize mini-cards for inkwell + discard tile
//   previewHand:      preview, scaled via scale-[0.538] in the parent. Width
//                     is tuned so scaled output fits the utility tile.
//
// All values are true 5:7 (Lorcana card proportion). Setting both w + h
// explicitly makes CSS ignore aspect-[5/7], so the explicit dims must
// themselves be 5:7 — true for every value below.
// =============================================================================
const CARD_SIZING = {
  // PORTRAIT (prototype: compression mode):
  //   Card fills its cell wrapper via w-full h-full. The cell wrapper in
  //   renderPlayCell owns the actual sizing — basis 52px, shrink to 36px
  //   floor, aspect-[5/7] for height. As a row gets crowded (7+ cards),
  //   cells shrink uniformly so all fit; below the 36px floor they wrap.
  // SM+: card returns to explicit width via CARD_SIZING_DESKTOP; cell
  //   wrapper releases its flex/aspect at sm:.
  // LANDSCAPE-PHONE: card uses explicit !w-[45px] !h-[63px] (matches
  //   pre-prototype behavior — landscape-phone keeps fixed sizing).
  adaptivePlay:
    "w-full h-full " +
    "sm:!w-auto sm:!h-auto sm:!max-h-none " +
    "landscape-phone:!w-[45px] landscape-phone:!h-[63px] " +
    "landscape-phone:!max-h-[63px] landscape-phone:!min-w-[45px]",
  adaptiveFaceDown:
    "w-auto h-full max-h-[73px] min-w-[28px] " +
    "sm:!h-auto sm:!max-h-none " +
    "landscape-phone:!w-[28px] landscape-phone:!h-[39px] " +
    "landscape-phone:!max-h-[39px] landscape-phone:!min-w-[28px]",
  hand: "w-[88px] landscape-phone:!w-[72px]",
  previewPlay: "w-[52px] landscape-phone:!w-[45px]",
  previewHand: "w-[88px] landscape-phone:!w-[88px]",
} as const;

// Sm+ width additions (applied uniformly via baseClass / face-down branch).
// !important on sm/lg widths so adaptivePlay's portrait `w-full` doesn't
// linger at desktop breakpoints — sm:!w-[104px] needs to beat w-full when
// both apply (without !important the cascade is non-deterministic).
const CARD_SIZING_DESKTOP = "sm:!w-[104px] lg:!w-[120px]";

// =============================================================================
// CARD_RADIUS — per-context border-radius className strings
//
// Two contexts: play/face-down (narrower cards → smaller radius) vs hand
// (wider cards → slightly larger). Targets ~4-5% of card width at each
// breakpoint, matching real Lorcana card radius proportions. Replaces the
// previous fixed `rounded-md sm:rounded-xl` (which was 21% of a 28-wide
// landscape card — over-rounded).
// =============================================================================
const CARD_RADIUS = {
  playOrFaceDown:
    "rounded-[2px] sm:rounded-[5px] lg:rounded-[6px] landscape-phone:!rounded-[2px]",
  hand:
    "rounded sm:rounded-[5px] lg:rounded-[6px] landscape-phone:!rounded-[3px]",
} as const;

interface Props {
  instanceId: string;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  isSelected: boolean;
  onClick: () => void;
  zone: "play" | "hand";
  /** Show card back instead of face (opponent hand) */
  faceDown?: boolean;
  /** Pulse ring — valid target for pending challenge or shift */
  isTarget?: boolean;
  /** Solid ring — this card is the selected attacker/shifter */
  isAttacker?: boolean;
  /** Suppress 90° rotation for inkwell fan display */
  skipRotation?: boolean;
  /** Callback when cards-under badge is clicked */
  onCardsUnderClick?: (instanceId: string) => void;
  /** Pre-computed game modifiers — if not passed, computed internally */
  gameModifiers?: GameModifiers | null;
  /** Hand card is playable this turn (enough ink, no restrictions). Dims if false. */
  isPlayable?: boolean;
  /** Force natural width-based sizing (not height-adaptive). Used by scaled
   *  mini-previews — inkwell fan, discard-tile top card — where the parent
   *  has no defined height so `h-full` would collapse to 0. */
  naturalSize?: boolean;
}

export default function GameCard({ instanceId, gameState, definitions, isSelected, onClick, zone, faceDown, isTarget, isAttacker, skipRotation, onCardsUnderClick, gameModifiers: externalMods, isPlayable, naturalSize }: Props) {
  const instance = gameState.cards[instanceId];
  if (!instance) return null;
  // The state filter (engine `filterStateForPlayer`) stubs opponent-side cards
  // in hidden zones (hand, deck, inkwell) with `definitionId: "hidden"`. The
  // game's definitions map doesn't carry an entry under that key, so a raw
  // `definitions["hidden"]` lookup returns undefined and the old `if (!def)
  // return null` early-bailed — leaving opponent's inkwell + hand strips
  // visually empty even though the underlying zone arrays had IDs. Engine
  // exports a `HIDDEN_DEFINITION` placeholder for exactly this case; using
  // it as a fallback makes downstream rendering tolerant. The face-down
  // branch below force-engages for any hidden stub regardless of the
  // `faceDown` prop, so users see card backs (CRD 4.1.4 — opponent inkwell
  // is private) rather than the placeholder's empty stat fields.
  const def = definitions[instance.definitionId]
    ?? (instance.definitionId === "hidden" ? HIDDEN_DEFINITION : null);
  if (!def) return null;
  const isHiddenStub = def === HIDDEN_DEFINITION;

  // Compute modifiers once per state change (uses external if provided, else computes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mods = useMemo(() => externalMods ?? getGameModifiers(gameState, definitions), [externalMods, gameState, definitions]);

  // CRD 5.5.4: locations never exert and never dry
  const isLocation = def.cardType === "location";

  // Card sizing + radius selected from the module-level CARD_SIZING and
  // CARD_RADIUS tables based on context (zone, faceDown, naturalSize). See
  // those constants at the top of this file for the per-context strings
  // and the design notes on portrait/landscape/sm+/lg+ behavior.
  const isExerted = !isLocation && instance.isExerted;
  const mobileWidth = naturalSize
    ? (faceDown || zone === "play" ? CARD_SIZING.previewPlay : CARD_SIZING.previewHand)
    : zone === "play"
    ? CARD_SIZING.adaptivePlay
    : faceDown
    ? CARD_SIZING.adaptiveFaceDown
    : CARD_SIZING.hand;
  const mobileRadius = (faceDown || zone === "play")
    ? CARD_RADIUS.playOrFaceDown
    : CARD_RADIUS.hand;

  // Play restriction check — grey out hand cards whose playRestrictions fail
  const hasFailedRestriction = zone === "hand" && (def as any).playRestrictions?.length > 0 &&
    (def as any).playRestrictions.some((r: any) => !evaluateCondition(r, gameState, definitions, instance.ownerId, instanceId));
  // Unified "can't interact" dim — used for both blocked and unaffordable hand cards.
  // brightness (not opacity) so fanned hand cards don't bleed through each other.
  const restrictionOpacity = hasFailedRestriction ? "brightness-50" : "";

  // Self cost reduction indicator — green glow on hand cards that have an active
  // cost reduction (the card is cheaper than printed). Reads the static ability
  // directly since the effective cost isn't exposed on the instance.
  const hasCostReduction = zone === "hand" && def.abilities.some((a: any) =>
    a.type === "static" && a.effect?.type === "self_cost_reduction" &&
    (!a.condition || evaluateCondition(a.condition, gameState, definitions, instance.ownerId, instanceId))
  );
  const costReductionGlow = hasCostReduction ? "ring-1 ring-emerald-500/50" : "";

  // Unplayable hand card dim — same level as restriction (unified "can't interact"
  // signal; ink count in the inkwell already tells you recoverability).
  // brightness (not opacity) so fanned hand cards don't bleed through each other.
  const unplayableDim = zone === "hand" && isPlayable === false && !hasFailedRestriction ? "brightness-50" : "";

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
  };

  // ── Face-down card back (opponent hand, or any hidden stub) ──
  // `isHiddenStub` covers cards stubbed by the state filter (opponent's
  // hand/deck/inkwell). They have no real definition to render with, so we
  // force-engage the face-down branch regardless of the caller's `faceDown`
  // prop. CRD 4.1.4: opponent's inkwell + hand identities stay private.
  if (faceDown || isHiddenStub) {
    return (
      <div
        className={`${mobileWidth} ${CARD_SIZING_DESKTOP} aspect-[5/7] ${mobileRadius} overflow-hidden shrink-0`}
        onClick={onClick}
        tabIndex={0}
        onKeyDown={handleKey}
        role="button"
        aria-label="Opponent card"
      >
        <img
          src="/card-back-small.jpg"
          alt="Card back"
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  const inkColor = def.inkColors[0] ?? "steel";
  const theme = INK_THEME[inkColor] ?? DEFAULT_THEME;

  const isDrying = zone === "play" && !isLocation && instance.isDrying;
  const damage = zone === "play" ? instance.damage : 0;

  // Use engine's effective-stat helpers (reads timedEffects, NOT the dead temp*Modifier fields)
  const staticBonus = mods?.statBonuses.get(instanceId);
  const strength = def.strength != null
    ? getEffectiveStrength(instance, def, staticBonus?.strength ?? 0)
    : null;
  const willpowerModified = def.willpower != null
    ? getEffectiveWillpower(instance, def, staticBonus?.willpower ?? 0)
    : null;

  // Lore delta must include BOTH static bonuses (e.g. Lady Decisive Dog's TAKE
  // THE LEAD while 3+ str) AND timed modify_lore effects (e.g. Eye of the Fates
  // "+1 lore this turn"). Strength/willpower deltas are computed in the IIFE
  // below; lore is computed here because `loreDelta` gates `hasAnyStatMod`.
  const timedLoreBonus = (instance.timedEffects ?? [])
    .filter((te: any) => te.type === "modify_lore")
    .reduce((sum: number, te: any) => sum + (te.amount ?? 0), 0);
  const loreDelta = (staticBonus?.lore ?? 0) + timedLoreBonus;
  const hasAnyStatMod = (staticBonus?.strength ?? 0) !== 0 || (staticBonus?.willpower ?? 0) !== 0 || loreDelta !== 0
    || (instance.timedEffects ?? []).some((te: any) => te.type === "modify_strength" || te.type === "modify_willpower" || te.type === "modify_lore");
  const hasModifiedStats = hasAnyStatMod;

  // Keyword badges — check both printed abilities and dynamically granted keywords
  const BADGE_KEYWORDS = ["alert", "bodyguard", "boost", "challenger", "evasive", "reckless", "resist", "rush", "singer", "support", "ward"] as const;
  type BadgeKeyword = typeof BADGE_KEYWORDS[number];
  const keywordAbilities = def.abilities.filter((a): a is KeywordAbility => a.type === "keyword");
  const printedKeywords = new Set(keywordAbilities.map(a => a.keyword));
  const printedValues = new Map(keywordAbilities.filter(a => a.value != null).map(a => [a.keyword, a.value!]));
  // Merge: printed keywords + instance-granted + timed-granted + static-granted (gameModifiers)
  const staticGranted = mods?.grantedKeywords.get(instanceId) ?? [];
  const timedGranted = (instance.timedEffects ?? []).filter((te: any) => te.type === "grant_keyword" && te.keyword);
  const grantedKeywordSet = new Set([
    ...(instance.grantedKeywords ?? []),
    ...staticGranted.map(g => g.keyword),
    ...timedGranted.map((te: any) => te.keyword as string),
  ]);
  const allKeywords = new Set([...printedKeywords, ...grantedKeywordSet]);
  // CRD 8.1.2: +N keywords stack (sum all values), non-+N keywords are boolean
  const keywordValues = new Map<string, number>();
  for (const [kw, val] of printedValues) keywordValues.set(kw, val);
  for (const g of staticGranted) {
    if (g.value != null) keywordValues.set(g.keyword, (keywordValues.get(g.keyword) ?? 0) + g.value);
  }
  for (const te of timedGranted) {
    const kw = (te as any).keyword as string;
    const val = (te as any).value as number | undefined;
    if (val != null) keywordValues.set(kw, (keywordValues.get(kw) ?? 0) + val);
  }
  // Track which keywords are granted (not just printed) for color coding
  const isGrantedKeyword = (k: string) => grantedKeywordSet.has(k) && !printedKeywords.has(k);
  const isBuffedKeyword = (k: string) => {
    if (!printedKeywords.has(k)) return false;
    const printed = printedValues.get(k);
    const total = keywordValues.get(k);
    return printed != null && total != null && total > printed;
  };
  const activeKeywordBadges = zone === "play"
    ? BADGE_KEYWORDS.filter(k => allKeywords.has(k))
    : [];
  const KEYWORD_STYLE: Record<BadgeKeyword, string> = {
    alert:      "bg-slate-600/90",
    bodyguard:  "bg-slate-600/90",
    boost:      "bg-slate-600/90",
    challenger: "bg-slate-600/90",
    evasive:    "bg-slate-600/90",
    reckless:   "bg-slate-600/90",
    resist:     "bg-slate-600/90",
    rush:       "bg-slate-600/90",
    singer:     "bg-slate-600/90",
    support:    "bg-slate-600/90",
    ward:       "bg-slate-600/90",
  };
  const KEYWORD_ICON: Record<BadgeKeyword, IconName> = {
    alert:      "eye",
    bodyguard:  "shield-check",
    boost:      "rectangle-stack",
    challenger: "bolt",
    evasive:    "arrow-up",
    reckless:   "exclamation-triangle",
    resist:     "minus-circle",
    rush:       "arrow-right",
    singer:     "musical-note",
    support:    "user-plus",
    ward:       "lock-closed",
  };

  // Preserve the ink-color theme border as card identity; layer the state
  // ring on top so the card doesn't lose its ink-color signal when selected,
  // targeted, or attacking.
  const stateRing = isAttacker
    ? "ring-2 ring-orange-400/60 scale-105 z-10"
    : isSelected
    ? "ring-2 ring-amber-400/40 scale-105 z-10"
    : isTarget
    ? "ring-2 ring-red-400/50 animate-pulse z-10"
    : "";
  const ringClass = `${theme.border} ${stateRing}`;

  // Exerted cards dim via brightness-50 unless they're a valid target for an
  // action — a target card should stay bright so the red border is visible.
  const rotationClass = isExerted && !skipRotation
    ? `rotate-90 ${isTarget ? "" : "brightness-50"}`
    : isLocation && zone === "play" ? "rotate-90" : "";
  const baseClass = `game-card relative border-2 ${mobileRadius} ${mobileWidth} ${CARD_SIZING_DESKTOP} shrink-0 cursor-pointer
    transition-all duration-200 ${ringClass} ${restrictionOpacity} ${costReductionGlow} ${unplayableDim}
    ${rotationClass}
    hover:scale-105 hover:z-10 hover:shadow-lg hover:${theme.glow}`;

  // ── With image: card art fills the frame, overlays show only game state ──
  if (def.imageUrl) {
    // DPR-aware: browser picks small (200px) on DPR=1 desktops, normal (450px)
    // on DPR=2+ retina and mobile. See utils/cardImage.ts for the full matrix.
    const boardImg = getBoardCardImage(def.imageUrl);
    return (
      <div className={`${baseClass} aspect-[5/7] overflow-hidden`} onClick={onClick} tabIndex={0} onKeyDown={handleKey} role="button" aria-label={`${def.fullName}${isExerted ? ", exerted" : ""}${damage > 0 ? `, ${damage} damage` : ""}`}>
        <img
          {...boardImg}
          alt={def.fullName}
          loading="lazy"
          decoding="async"
          width={200}
          height={280}
          className="w-full h-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />

        {/* Modified stats — bottom-right delta badges (raw modifiers, not clamped) */}
        {hasModifiedStats && strength != null && willpowerModified != null && (() => {
          const timedS = (instance.timedEffects ?? []).filter((te: any) => te.type === "modify_strength").reduce((s: number, te: any) => s + (te.amount ?? 0), 0);
          const timedW = (instance.timedEffects ?? []).filter((te: any) => te.type === "modify_willpower").reduce((s: number, te: any) => s + (te.amount ?? 0), 0);
          const sDelta = timedS + (staticBonus?.strength ?? 0);
          const wDelta = timedW + (staticBonus?.willpower ?? 0);
          // Stat-delta pills — number followed by the matching glyph
          // (strength/willpower/lore). Glyph adopts the pill's text color
          // via bg-current. Two glyph sizes are emitted with responsive
          // visibility so the icon scales with the pill height (7px in
          // h-3 mobile pill, 9px in h-4 sm+ pill); Glyph takes a number
          // size, not a class, hence the dual emit.
          return (
            <div className="absolute bottom-0.5 right-0.5 z-10 pointer-events-none flex flex-col gap-0.5 items-end">
              {sDelta !== 0 && (
                <span className={`inline-flex items-center gap-0.5 h-3 px-0.5 sm:h-4 sm:px-1 rounded text-[6px] sm:text-[7px] font-black shadow ${sDelta > 0 ? "bg-green-700/90 text-white" : "bg-red-700/90 text-red-100"}`}>
                  {sDelta > 0 ? "+" : ""}{sDelta}
                  <Glyph name="strength" size={7} className="sm:hidden" ariaLabel="strength" />
                  <Glyph name="strength" size={9} className="hidden sm:inline-block" ariaLabel="strength" />
                </span>
              )}
              {wDelta !== 0 && (
                <span className={`inline-flex items-center gap-0.5 h-3 px-0.5 sm:h-4 sm:px-1 rounded text-[6px] sm:text-[7px] font-black shadow ${wDelta > 0 ? "bg-green-700/90 text-white" : "bg-red-700/90 text-red-100"}`}>
                  {wDelta > 0 ? "+" : ""}{wDelta}
                  <Glyph name="willpower" size={7} className="sm:hidden" ariaLabel="willpower" />
                  <Glyph name="willpower" size={9} className="hidden sm:inline-block" ariaLabel="willpower" />
                </span>
              )}
              {loreDelta !== 0 && (
                <span className={`inline-flex items-center gap-0.5 h-3 px-0.5 sm:h-4 sm:px-1 rounded text-[6px] sm:text-[7px] font-black shadow ${loreDelta > 0 ? "bg-green-700/90 text-white" : "bg-red-700/90 text-red-100"}`}>
                  {loreDelta > 0 ? "+" : ""}{loreDelta}
                  <Glyph name="lore" size={7} className="sm:hidden" ariaLabel="lore" />
                  <Glyph name="lore" size={9} className="hidden sm:inline-block" ariaLabel="lore" />
                </span>
              )}
            </div>
          );
        })()}

        {/* Keyword badges — right-side icon column */}
        {activeKeywordBadges.length > 0 && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none items-end">
            {activeKeywordBadges.map(k => {
              // Support's "value" is the card's current STR at resolution — not a fixed number to display
              const val = k === "support" ? undefined : keywordValues.get(k);
              return (
                <div key={k} className={`h-4 flex items-center gap-0.5 rounded-full px-1 shadow ${isGrantedKeyword(k) || isBuffedKeyword(k) ? "bg-green-700/90" : KEYWORD_STYLE[k]}`}>
                  <Icon name={KEYWORD_ICON[k]} className="w-2.5 h-2.5 text-white shrink-0" />
                  {val != null && <span className="text-white text-[8px] font-black leading-none">{val}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Left-side status icons — damage immunity shield, cant-be-challenged lock */}
        {zone === "play" && (() => {
          const leftIcons: { icon: string; color: string; label: string }[] = [];
          // Damage immunity (static from gameModifiers OR timed on instance)
          const staticPrevention = mods?.damagePrevention.get(instanceId);
          const timedPrevention = instance.timedEffects.some(te => te.type === "damage_prevention");
          if (staticPrevention || timedPrevention) {
            leftIcons.push({ icon: "shield-check", color: "bg-amber-600/90", label: "Can't be dealt damage" });
          }
          // Can't be challenged (static from gameModifiers OR timed on instance)
          if (mods?.cantBeChallenged.has(instanceId) || instance.timedEffects.some(te => te.type === "cant_be_challenged")) {
            leftIcons.push({ icon: "lock-closed", color: "bg-red-700/90", label: "Can't challenge" });
          }
          // Restrict sing (cant_action sing — timed or per-card static)
          const cantSing = instance.timedEffects.some(te => te.type === "cant_action" && te.action === "sing")
            || mods?.selfActionRestrictions.get(instanceId)?.has("sing" as any);
          if (cantSing) {
            leftIcons.push({ icon: "musical-note", color: "bg-red-700/90", label: "Can't sing" });
          }
          // Can't ready (timed from Elsa Spirit of Winter, or static/remembered from Ice Palace)
          const cantReadyStatic = mods?.selfActionRestrictions.get(instanceId)?.has("ready" as any);
          const cantReadyTimed = instance.timedEffects.some(te => te.type === "cant_action" && te.action === "ready");
          if (cantReadyStatic || cantReadyTimed) {
            leftIcons.push({ icon: "lock-closed", color: "bg-red-700/90", label: "Can't ready" });
          }
          // Once-per-turn ability tracker
          const oncePerTurnAbilities = def.abilities.filter((a: any) =>
            a.oncePerTurn && (a.type === "triggered" || a.type === "activated" || a.type === "static")
          );
          if (oncePerTurnAbilities.length > 0) {
            const triggered = instance.oncePerTurnTriggered ?? {};
            const allUsed = oncePerTurnAbilities.every((a: any) => {
              const key = a.storyName ?? a.rulesText ?? "anon";
              return !!triggered[key];
            });
            leftIcons.push({
              icon: "clock",
              color: allUsed ? "bg-gray-700/90" : "bg-gray-500/90",
              label: allUsed ? "Used this turn" : "Once per turn",
            });
          }
          // Delayed trigger (Candy Drift: "at end of turn, banish them")
          const delayedTriggers = (gameState as any).delayedTriggers as { targetInstanceId: string; firesAt: string }[] | undefined;
          if (delayedTriggers?.some(dt => dt.targetInstanceId === instanceId)) {
            leftIcons.push({ icon: "clock", color: "bg-amber-600/90", label: "Delayed trigger pending" });
          }
          if (leftIcons.length === 0) return null;
          return (
            <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none">
              {leftIcons.map((li, i) => (
                <div key={i} className={`h-4 w-4 flex items-center justify-center rounded-full shadow ${li.color}`}>
                  <Icon name={li.icon as any} className="w-2.5 h-2.5 text-white" />
                </div>
              ))}
            </div>
          );
        })()}


        {/* Top-left badges — stacked vertically */}
        {(() => {
          const badges: { text: string; color: string }[] = [];
          if (zone === "hand" && def.abilities.some((a: any) => a.type === "keyword" && a.keyword === "shift" && a.variant === "universal")) {
            badges.push({ text: "U-Shift", color: "bg-gray-600/90" });
          }
          if (zone === "play" && (def as any).alternateNames?.length > 0) {
            badges.push({ text: (def as any).alternateNames.join(" / "), color: "bg-gray-600/90" });
          }
          if (zone === "play" && mods?.grantedTraits.get(instanceId)?.size) {
            badges.push({ text: `+${[...(mods.grantedTraits.get(instanceId) ?? [])].join(", ")}`, color: "bg-green-700/90" });
          }
          if (badges.length === 0) return null;
          return (
            <div className="absolute top-0.5 left-0.5 z-10 flex flex-col gap-0.5 pointer-events-none">
              {badges.map((b, i) => (
                <span key={i} className={`text-[7px] font-black px-1 py-0.5 rounded text-white shadow leading-none ${b.color}`}>
                  {b.text}
                </span>
              ))}
            </div>
          );
        })()}

        {/* Boost / cards-under stack indicator — bottom-left count badge (clickable) */}
        {zone === "play" && (instance.cardsUnder?.length ?? 0) > 0 && (
          <div
            className="absolute bottom-0.5 left-0.5 z-10 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onCardsUnderClick?.(instanceId); }}
          >
            <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-black bg-gray-600/90 text-gray-100 shadow border border-gray-400/50 hover:bg-gray-500/90">
              {instance.cardsUnder?.length}
            </span>
          </div>
        )}

        {/* Summoning sickness overlay — blue-cyan wash, like MTGO */}
        {isDrying && (
          <div className={`absolute inset-0 ${mobileRadius} bg-cyan-400/25 pointer-events-none`} />
        )}

        {/* Damage counter — centered on card */}
        {damage > 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-red-600 text-red-100 text-[8px] sm:text-[9px] font-black shadow-lg border border-red-400/50">{damage}</span>
          </div>
        )}
      </div>
    );
  }

  // ── No image: full text layout fallback ──
  return (
    <div
      className={`${baseClass} bg-gradient-to-b ${theme.gradFrom} ${theme.gradTo}`}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={handleKey}
      role="button"
      aria-label={`${def.fullName}${isExerted ? ", exerted" : ""}${damage > 0 ? `, ${damage} damage` : ""}`}
    >
      {/* Top bar: cost + type */}
      <div className="flex items-start justify-between px-2 pt-1.5">
        <div className={`w-6 h-6 rounded-full ${theme.costBg} flex items-center justify-center text-[11px] font-black text-white shadow-md`}>
          {def.cost}
        </div>
        <div className="text-[8px] text-gray-500 uppercase tracking-wide mt-1">
          {def.cardType}
        </div>
      </div>

      {/* Art placeholder */}
      <div className={`mx-2 mt-1 h-[3px] rounded-full bg-gradient-to-r ${theme.gradFrom} ${theme.gradTo} opacity-60`} />

      {/* Name block */}
      <div className="px-2 mt-1.5">
        <div className="text-[11px] font-bold text-gray-100 leading-tight truncate">{def.name}</div>
        {def.subtitle && (
          <div className="text-[9px] text-gray-400 truncate leading-tight italic">{def.subtitle}</div>
        )}
      </div>

      {/* Traits */}
      {def.traits.length > 0 && (
        <div className="px-2 mt-0.5">
          <div className="text-[7px] text-gray-600 truncate uppercase tracking-wider">{def.traits.join(" · ")}</div>
        </div>
      )}

      {/* Bottom: stats */}
      <div className="px-2 pb-2 mt-auto">
        {/* Locations: willpower + lore + moveCost (no strength) */}
        {isLocation && willpowerModified != null && (
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-0.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-700/60 text-[10px] font-black text-blue-200">{willpowerModified}</span>
              {def.moveCost != null && (
                <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded bg-cyan-700/60 text-[10px] font-black text-cyan-200" title="Move cost">{def.moveCost}</span>
              )}
            </div>
            {def.lore != null && def.lore > 0 && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: def.lore }, (_, i) => <span key={i} className="text-amber-400 text-[10px]">&#9670;</span>)}
              </div>
            )}
          </div>
        )}
        {!isLocation && strength != null && willpowerModified != null && (
          <div className="flex items-center justify-between mt-2">
            {!hasModifiedStats && (
              <div className="flex items-center gap-0.5">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-700/60 text-[10px] font-black text-orange-200">{strength}</span>
                <span className="text-gray-600 text-[9px]">/</span>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black bg-blue-700/60 text-blue-200">{willpowerModified}</span>
              </div>
            )}
            {hasModifiedStats && <div />}
            {def.lore != null && def.lore > 0 && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: def.lore }, (_, i) => <span key={i} className="text-amber-400 text-[10px]">&#9670;</span>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keyword badges — middle-right column */}
      {activeKeywordBadges.length > 0 && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 items-end pointer-events-none">
          {activeKeywordBadges.map(k => {
            const val = keywordValues.get(k);
            return (
              <div key={k} className={`h-4 flex items-center gap-0.5 px-1 rounded ${KEYWORD_STYLE[k]} shadow`}>
                <Icon name={KEYWORD_ICON[k]} className="w-2.5 h-2.5 text-white" />
                {val != null && <span className="text-white text-[7px] font-black leading-none">{val}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Summoning sickness overlay */}
      {isDrying && (
        <div className={`absolute inset-0 ${mobileRadius} bg-cyan-400/25 pointer-events-none`} />
      )}

      {/* Damage counter — centered on card */}
      {damage > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-red-600 text-red-100 text-[8px] sm:text-[9px] font-black shadow-lg border border-red-400/50">{damage}</span>
        </div>
      )}
    </div>
  );
}
