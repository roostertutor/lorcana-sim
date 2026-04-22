// =============================================================================
// cardImage — DPR-aware card image helpers
//
// R2 hosts three sizes of every card image (see scripts/lib/image-sync.ts):
//   small:  200px wide
//   normal: 450px wide
//   large:  900px wide
//
// Card JSON's `imageUrl` always points at the `_normal.jpg` variant. These
// helpers rewrite the filename suffix and emit { src, srcSet } pairs that let
// the browser pick the right resolution based on device pixel ratio.
//
// Why DPR-aware: a 120px CSS board card on a 1x DPR desktop has only 120
// physical pixels to render into — `small` (200px) is plenty. The same card
// on a 3x DPR phone at 88px CSS needs 264 physical pixels — `normal` (450px)
// is required. A 400px CSS inspect modal on a 2x Retina needs 800 physical
// pixels — `large` (900px) is required. One source size per context is the
// wrong axis; we pick per CONTEXT × per DPR.
//
// Usage:
//   const img = getBoardCardImage(def.imageUrl);
//   <img {...img} alt={def.fullName} ... />
// =============================================================================

/** An `<img>`-ready pair that maps 1:1 onto `src` + `srcSet` attributes. */
export type ResponsiveImage = {
  src: string;
  srcSet: string;
};

/** Regex for the trailing `_<size>.jpg` on R2 card-image URLs. */
const SIZE_SUFFIX_RE = /_[a-z]+\.jpg$/;

/**
 * Rewrite the trailing `_<size>.jpg` on an R2 card-image URL.
 * Falls through unchanged for URLs that don't match (legacy Lorcast URLs
 * that escaped migration, test fixtures, etc.) — safer than throwing.
 */
function withSize(imageUrl: string, size: "small" | "normal" | "large"): string {
  return imageUrl.replace(SIZE_SUFFIX_RE, `_${size}.jpg`);
}

/**
 * BOARD context — in-play cards, hand, deck-top preview, deckbuilder tiles,
 * PendingChoiceModal card thumbs (any card rendered at ~50-150 CSS wide).
 *
 *   DPR 1 → small (200px)  — 120 CSS × 1 = 120 phys,  src is ~1.7x
 *   DPR 2 → normal (450px) — 120 CSS × 2 = 240 phys,  src is ~1.9x
 *   DPR 3 → normal (450px) —  88 CSS × 3 = 264 phys,  src is ~1.7x
 */
export function getBoardCardImage(imageUrl: string): ResponsiveImage {
  const small = withSize(imageUrl, "small");
  const normal = withSize(imageUrl, "normal");
  return {
    src: small, // 1x fallback if srcSet unsupported
    srcSet: `${small} 1x, ${normal} 2x`,
  };
}

/**
 * INSPECT context — zoomed card views (CardInspectModal, CardPicker inspect,
 * any ~300-450 CSS wide card render).
 *
 *   DPR 1 → normal (450px) — 400 CSS × 1 = 400 phys,  src is ~1.1x
 *   DPR 2 → large (900px)  — 400 CSS × 2 = 800 phys,  src is ~1.1x
 *   DPR 3 → large (900px)  — 400 CSS × 3 = 1200 phys, src is 0.75x (tiny upscale, imperceptible on phones)
 */
export function getInspectCardImage(imageUrl: string): ResponsiveImage {
  const normal = withSize(imageUrl, "normal");
  const large = withSize(imageUrl, "large");
  return {
    src: normal,
    srcSet: `${normal} 1x, ${large} 2x`,
  };
}

/**
 * THUMB context — tiny card previews (~20-30 CSS wide). Reveal pill fanned
 * thumbs and similar fingernail-sized UIs.
 *
 * Always `small`. `small` (200px) is already overkill even at DPR=3 × 30 CSS
 * = 90 physical pixels. Shipping anything bigger just wastes bandwidth
 * without improving visible quality.
 */
export function getThumbCardImage(imageUrl: string): ResponsiveImage {
  const small = withSize(imageUrl, "small");
  return {
    src: small,
    srcSet: small,
  };
}
