// =============================================================================
// Glyph — inline-text-friendly rendering of monochrome Lorcana glyph icons.
//
// Source: packages/ui/public/icons/glyphs/<name>.png (originally from Lorcana's
// font_sprites texture; sliced + named in commit ed7dff2). Each PNG is
// white-on-transparent, used here as a CSS mask so the visible color comes
// from `bg-current` — meaning the glyph adopts the surrounding text color
// automatically. Override per-instance via Tailwind text-* classes.
//
// Usage:
//   <Glyph name="strength" />                                  // 16px, currentColor
//   <Glyph name="lore" size={20} className="text-amber-400" /> // amber 20px
//   <span className="text-red-500"><Glyph name="willpower" /></span> // red, inherits
//
// vs. ink color icons: those live at /icons/ink/*.svg and stay as <img> —
// they're hand-authored full-color SVGs, not monochrome glyphs.
// =============================================================================

import React from "react";

export type GlyphName =
  | "strength"
  | "willpower"
  | "lore"
  | "exert"
  | "inkable"
  | "uninkable"
  | "move-cost"
  | "favorite"
  | "owned-empty"
  | "owned-filled";

interface Props {
  name: GlyphName;
  /** Pixel size; rendered as both width and height. Defaults to 16. */
  size?: number;
  /** Additional Tailwind classes — most usefully `text-*` for tinting. */
  className?: string;
  /** Accessible label override; defaults to the glyph name. */
  ariaLabel?: string;
}

export default function Glyph({ name, size = 16, className = "", ariaLabel }: Props) {
  const url = `/icons/glyphs/${name}.png`;
  return (
    <span
      role="img"
      aria-label={ariaLabel ?? name}
      className={`inline-block bg-current align-text-bottom ${className}`}
      style={{
        width: size,
        height: size,
        // Vendor-prefixed mask-image — Webkit prefix covers older Safari.
        // Standards property `maskImage` covers everything else.
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
