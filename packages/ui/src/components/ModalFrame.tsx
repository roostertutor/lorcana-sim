import React from "react";

type Placement = "center" | "bottom-sheet-mobile";

interface Props {
  onClose: () => void;
  /** Where the panel sits within the backdrop.
   *  - "center" (default): vertically centered at every breakpoint.
   *  - "bottom-sheet-mobile": bottom-anchored on mobile, centered on sm+. */
  placement?: Placement;
  /** Backdrop tint. Defaults to bg-black/70. */
  backdropClass?: string;
  children: React.ReactNode;
}

const PLACEMENT_CLASS: Record<Placement, string> = {
  center: "items-center",
  "bottom-sheet-mobile": "items-end sm:items-center",
};

/**
 * Shared shell for tap-to-dismiss modal overlays — CardInspectModal,
 * ZoneViewModal, Active Effects modal. Owns the backdrop, the safer
 * `e.target === e.currentTarget` dismiss check (avoids iOS scroll-
 * momentum spurious dismisses), and the standard z-50 / blur / flex
 * positioning.
 *
 * Caller renders the panel as the single child; the panel should set
 * `onClick={(e) => e.stopPropagation()}` itself so internal taps don't
 * bubble to the backdrop and accidentally dismiss.
 *
 * NOT used by:
 * - PendingChoiceModal (backdrop click = peek/hide, not close)
 * - Game Over modal (backdrop click + Peek pill both hide the modal so
 *   the player can review log/board/cards post-game; reopen via top
 *   pill or BoardMenu)
 */
export default function ModalFrame({
  onClose,
  placement = "center",
  backdropClass = "bg-black/70 backdrop-blur-sm",
  children,
}: Props) {
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${PLACEMENT_CLASS[placement]} ${backdropClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
