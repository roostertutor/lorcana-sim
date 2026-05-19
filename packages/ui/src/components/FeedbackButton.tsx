// =============================================================================
// FEEDBACK BUTTON — presentational trigger for the feedback modal.
//
// Variants (per HANDOFF spec):
//   - "inline"   — text-link styled (footer placement). Subtle, doesn't
//                  compete with page content.
//   - "icon"     — icon-only button (compact toolbar / card-modal footer).
//   - "menuItem" — full-width menu-row styled (BoardMenu kebab, future).
//   - "fab"      — floating action button. Reserved; HANDOFF Decision #3
//                  prefers footer over FAB, but keep the variant available
//                  for gameboard-specialist who may want it in-game.
//
// All variants call `useFeedback().open(injection)` with the per-call
// `injection` payload (type/title/context pre-fills).
// =============================================================================
import React from "react"
import Icon from "./Icon.js"
import { useFeedback, type FeedbackContextInjection } from "../lib/feedbackContext.js"

type Variant = "fab" | "inline" | "icon" | "menuItem"

interface Props {
  variant: Variant
  /** Per-call context injection — pre-fill type/title and attach a
   *  context blob (cardId, gameSeed, etc.). Forwarded verbatim to the
   *  provider's `open()`. */
  injection?: FeedbackContextInjection
  /** Optional label override. Defaults: inline → "Report an issue",
   *  menuItem → "Report an issue", icon → "" (icon-only). */
  label?: string
  className?: string
}

export default function FeedbackButton({ variant, injection, label, className = "" }: Props) {
  const { open } = useFeedback()
  const handleClick = () => open(injection)

  if (variant === "inline") {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-amber-400 underline underline-offset-2 transition-colors ${className}`}
      >
        <Icon name="flag" className="w-3 h-3" />
        {label ?? "Report an issue"}
      </button>
    )
  }

  if (variant === "icon") {
    return (
      <button
        onClick={handleClick}
        aria-label={label ?? "Report an issue"}
        title={label ?? "Report an issue"}
        className={`p-1.5 rounded-md text-gray-500 hover:text-amber-400 hover:bg-gray-800/50 transition-colors active:scale-95 ${className}`}
      >
        <Icon name="flag" className="w-4 h-4" />
      </button>
    )
  }

  if (variant === "menuItem") {
    return (
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:text-white hover:bg-gray-800 text-left transition-colors ${className}`}
      >
        <Icon name="flag" className="w-3.5 h-3.5 text-gray-500" />
        {label ?? "Report an issue"}
      </button>
    )
  }

  // fab — kept available for gameboard-specialist's future in-game trigger;
  // not used in any current MVP surface (HANDOFF Decision #3).
  return (
    <button
      onClick={handleClick}
      aria-label={label ?? "Report an issue"}
      title={label ?? "Report an issue"}
      className={`fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-amber-600 hover:bg-amber-500 text-gray-950 shadow-lg flex items-center justify-center active:scale-95 transition-transform ${className}`}
    >
      <Icon name="flag" className="w-5 h-5" />
    </button>
  )
}
