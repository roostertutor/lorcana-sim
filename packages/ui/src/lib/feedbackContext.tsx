// =============================================================================
// FEEDBACK CONTEXT — single-modal owner + per-call context injection.
//
// Provides the `useFeedback()` hook so any trigger anywhere in the tree can
// open the FeedbackModal with pre-filled type / title / context (e.g. the
// CardInspectModal trigger passes `{ type: "card_issue", context: { cardId,
// fullName } }`). Without this layer, each trigger would need its own copy
// of the modal — N modals mounted, N pieces of open state, lots of churn.
//
// The provider owns:
//   - whether the modal is open
//   - the injection payload for the currently-open invocation
//
// On close, it clears injection so a subsequent footer-link click (no
// injection) doesn't accidentally render the previous card-issue's pre-fills.
//
// Phase 2+ note: gameboard-specialist will add an in-game trigger that
// injects `{ seed, turnNumber, lastActions, replay_id }`. The shape they
// pass through to `context` is opaque to this layer — it's forwarded
// verbatim to the server, which stores it as JSONB. No coupling needed.
// =============================================================================
import React, { createContext, useCallback, useContext, useMemo, useState } from "react"
import FeedbackModal from "../components/FeedbackModal.js"
import type { FeedbackType } from "./feedbackApi.js"

/** What a trigger can pre-fill on the modal. All fields optional —
 *  triggers with no context (footer link) just call `open()`. */
export interface FeedbackContextInjection {
  /** Pre-select the type dropdown. Without this, defaults to "bug". */
  type?: FeedbackType
  /** Pre-fill the title input. User can edit before submitting. */
  title?: string
  /** Caller-supplied free-form context merged into the submission's
   *  top-level `context` field. Example shapes:
   *    - Card-issue trigger:  { cardId, fullName }
   *    - (Phase 2) gameboard: { seed, turnNumber, lastActions, replay_id }
   *  Stored as JSONB on the server — no schema constraint. */
  context?: Record<string, unknown>
}

interface FeedbackContextValue {
  /** Open the modal. Optional injection pre-fills + attaches context. */
  open: (injection?: FeedbackContextInjection) => void
}

const FeedbackCtx = createContext<FeedbackContextValue | null>(null)

/** Hook for triggers — returns `{ open }`. Throws if used outside the
 *  provider so misuse fails loudly in dev rather than silently no-op'ing. */
export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider")
  return ctx
}

/** Mount near the root of the app (App.tsx). Renders nothing until a
 *  trigger calls `open()`; then the modal mounts overlaid on the
 *  current page. Single instance shared across all triggers. */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [injection, setInjection] = useState<FeedbackContextInjection | null>(null)

  const open = useCallback((next?: FeedbackContextInjection) => {
    setInjection(next ?? {})
  }, [])

  const close = useCallback(() => {
    // Clear injection on close so the next open() with no args doesn't
    // accidentally inherit the previous one's pre-fills.
    setInjection(null)
  }, [])

  const value = useMemo<FeedbackContextValue>(() => ({ open }), [open])

  return (
    <FeedbackCtx.Provider value={value}>
      {children}
      {injection !== null && (
        <FeedbackModal injection={injection} onClose={close} />
      )}
    </FeedbackCtx.Provider>
  )
}
