import React, { useEffect, useRef } from "react";

type Variant = "dialog" | "auto";

// =============================================================================
// MODAL_SIZE — width tokens for modal panels.
//
// Consumers apply these to their panel root className. ModalFrame itself
// doesn't render the panel (consumers own border/bg/padding/sticky-header
// etc.), so size lives as exported tokens rather than a prop on
// ModalFrame. Picking by role — not by visual preference — keeps thumbs
// visually stable as users flip between modals of the same kind (e.g.
// the same scale-0.78 GameCard renders to the exact same pixel size in
// the mulligan and a zone viewer).
//
// - sm  → 384px max panel. CardInspect, Settings, Active Effects, confirms.
//         Single-card detail / short form / text list.
// - md  → 448px max panel. No current consumers; reserved for medium forms
//         (e.g. multi-field auth, deck import dialog).
// - lg  → 672px max → 768px on lg+. ZoneView, PendingChoiceModal grids.
//         7-col grids of scale-0.78 GameCard thumbs need the lg bump
//         because GameCard becomes w-[120px] at lg breakpoint; 7 × 94px
//         scaled = 658px would clip max-w-2xl (672px) once panel padding
//         is included.
//
// All tokens include `w-full` (mobile bottom-sheet fills viewport) and
// `sm:mx-4` (16px breathing room on sm+ centered modals).
//
// Add a tier here BEFORE introducing a new max-width in any modal —
// drift on this is what produced the mulligan-vs-zone-view size mismatch
// fixed in commit 66e84c7.
// =============================================================================
export const MODAL_SIZE = {
  sm: "w-full sm:max-w-sm sm:mx-4",
  md: "w-full sm:max-w-md sm:mx-4",
  lg: "w-full sm:max-w-2xl lg:max-w-3xl sm:mx-4",
} as const;

export type ModalSize = keyof typeof MODAL_SIZE;

interface Props {
  onClose: () => void;
  /** Layout / size variant.
   *  - "dialog" (default): centered panel at every breakpoint. Use for
   *    short modals (settings, confirms, info).
   *  - "auto": bottom sheet on mobile (< sm), centered dialog on sm+.
   *    Use for forms and card-list views — anything thumb-reachable. */
  variant?: Variant;
  /** Backdrop tint. Defaults to bg-black/70 with blur. */
  backdropClass?: string;
  /** When true (default), ESC closes the modal. Set false for modals
   *  with non-standard dismiss semantics (PendingChoiceModal: ESC
   *  shouldn't accidentally cancel a pending choice). */
  closeOnEscape?: boolean;
  /** Element to focus on open. Default: the modal container itself
   *  (so Tab cycles into it; screen readers announce the new context). */
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  dialog: "items-center",
  auto: "items-end sm:items-center",
};

// -----------------------------------------------------------------------------
// Shared ESC-to-close stack
//
// Only the topmost mounted ModalFrame responds to a single ESC press.
// Without this, a nested modal (CardInspectModal rendered INSIDE
// ZoneViewModal at ZoneViewModal.tsx:162) would dismiss BOTH layers on
// one keypress — the user expects only the top layer to close.
// -----------------------------------------------------------------------------
const escStack: Array<() => void> = [];

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || escStack.length === 0) return;
    const top = escStack[escStack.length - 1]!;
    e.stopPropagation();
    top();
  });
}

/**
 * Shared shell for tap-to-dismiss modal overlays — CardInspectModal,
 * ZoneViewModal, SettingsModal, and the in-game Active Effects modal.
 *
 * Provides:
 * - Backdrop with safer `e.target === e.currentTarget` dismiss check
 *   (avoids iOS scroll-momentum spurious dismisses).
 * - ESC-to-close (opt out via `closeOnEscape={false}`). Nested modals
 *   stack: only the topmost closes on a single ESC press.
 * - Body scroll lock while open (so the page doesn't scroll behind
 *   the modal on iOS).
 * - Initial focus on the panel + focus restore on unmount (so keyboard
 *   users return to where they were when the modal closes).
 * - ARIA `role="dialog"` + `aria-modal="true"`.
 *
 * Caller renders the panel as the single child; the panel should set
 * `onClick={(e) => e.stopPropagation()}` itself so internal taps don't
 * bubble to the backdrop and accidentally dismiss.
 *
 * NOT used by:
 * - PendingChoiceModal (backdrop click = peek/hide, not close — owns
 *   its own dismiss path).
 * - Game Over modal (backdrop click + Peek pill both hide the modal so
 *   the player can review log/board/cards post-game; reopen via top
 *   pill or BoardMenu).
 */
export default function ModalFrame({
  onClose,
  variant = "dialog",
  backdropClass = "bg-black/70 backdrop-blur-sm",
  closeOnEscape = true,
  initialFocusRef,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest-ref pattern: the effect runs once on mount; we don't want
  // a fresh `onClose` identity per render to re-run focus capture or
  // re-lock body scroll. Refs let us read the latest handler without
  // re-triggering the effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 1. Capture pre-modal focus so we can restore on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 2. Move focus into the modal — falls back to the panel container
    //    which has tabIndex={-1} so it's focusable but not in tab order.
    const focusTarget = initialFocusRef?.current ?? containerRef.current;
    focusTarget?.focus();

    // 3. Lock body scroll. Idempotent across nested modals — the inner
    //    one's prevOverflow captures "hidden" already set by the outer,
    //    so unmount restores correctly.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 4. Push our close handler onto the ESC stack so we respond only
    //    when topmost.
    const escHandler = () => onCloseRef.current();
    if (closeOnEscape) escStack.push(escHandler);

    return () => {
      if (closeOnEscape) {
        const i = escStack.lastIndexOf(escHandler);
        if (i >= 0) escStack.splice(i, 1);
      }
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever spawned the modal (BoardMenu button,
      // card click target) so keyboard users don't get dumped at root.
      previouslyFocused?.focus();
    };
    // closeOnEscape and initialFocusRef are stable for the lifetime of
    // a given modal in practice; if they ever change mid-modal we'd want
    // to re-bind, hence the deps.
  }, [closeOnEscape, initialFocusRef]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-50 flex justify-center outline-none ${VARIANT_CLASS[variant]} ${backdropClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      {children}
    </div>
  );
}
