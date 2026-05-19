// =============================================================================
// FEEDBACK MODAL — bug-report / feature-request form.
//
// Wraps the lib/feedbackApi `submitFeedback` POST in a form with:
//   - Type dropdown (defaults to "bug" or whatever the trigger pre-set)
//   - Title input (3-200 chars; counter when over 150)
//   - Description textarea (3-5000 chars; counter when over 4000)
//   - Expandable "What we'll send" privacy-forward disclosure
//   - Submit button (disabled until client-side validation passes)
//   - Inline success (3s) → close
//   - Inline error with retry-after countdown for 429s
//
// Single instance lives in FeedbackProvider; opened/closed via useFeedback().
// =============================================================================
import React, { useEffect, useMemo, useState } from "react"
import ModalFrame, { MODAL_SIZE } from "./ModalFrame.js"
import Icon from "./Icon.js"
import {
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
  captureClientMeta,
  submitFeedback,
  type FeedbackType,
  type FeedbackSubmission,
} from "../lib/feedbackApi.js"
import type { FeedbackContextInjection } from "../lib/feedbackContext.js"

const TITLE_MIN = 3
const TITLE_MAX = 200
const DESCRIPTION_MIN = 3
const DESCRIPTION_MAX = 5000
const TITLE_COUNTER_THRESHOLD = 150
const DESCRIPTION_COUNTER_THRESHOLD = 4000
const SUCCESS_AUTO_CLOSE_MS = 3000

interface Props {
  injection: FeedbackContextInjection
  onClose: () => void
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; referenceCode: string }
  | { status: "error"; message: string; retryAfterSeconds?: number }

export default function FeedbackModal({ injection, onClose }: Props) {
  const [type, setType] = useState<FeedbackType>(injection.type ?? "bug")
  const [title, setTitle] = useState(injection.title ?? "")
  const [description, setDescription] = useState("")
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" })
  const [metaExpanded, setMetaExpanded] = useState(false)

  // Snapshot clientMeta on open so the "what we'll send" preview matches
  // exactly what the server receives at submit time. (URL / viewport
  // could change mid-modal if the user resizes — we want the preview to
  // be accurate, so re-snapshot on submit too. The preview is informational.)
  const clientMeta = useMemo(() => captureClientMeta(), [])
  const injectedContext = injection.context ?? {}
  const hasInjectedContext = Object.keys(injectedContext).length > 0

  // Client-side validation mirrors the server's bounds so users get
  // immediate feedback before submitting. Bounds are duplicated rather
  // than imported so the UI keeps responding to invalid input even if
  // the server's bounds drift.
  const titleLen = title.trim().length
  const descLen = description.trim().length
  const titleValid = titleLen >= TITLE_MIN && titleLen <= TITLE_MAX
  const descValid = descLen >= DESCRIPTION_MIN && descLen <= DESCRIPTION_MAX
  const canSubmit = titleValid && descValid && submitState.status !== "submitting"

  // Auto-close on success after a brief display so user sees the
  // reference code. Cleared on unmount or state transition.
  useEffect(() => {
    if (submitState.status !== "success") return
    const t = setTimeout(onClose, SUCCESS_AUTO_CLOSE_MS)
    return () => clearTimeout(t)
  }, [submitState.status, onClose])

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitState({ status: "submitting" })

    const payload: FeedbackSubmission = {
      type,
      title: title.trim(),
      description: description.trim(),
      clientMeta: captureClientMeta(),
    }
    if (hasInjectedContext) payload.context = injectedContext

    const result = await submitFeedback(payload)
    if (result.ok) {
      setSubmitState({ status: "success", referenceCode: result.referenceCode })
    } else {
      const next: SubmitState = { status: "error", message: result.error }
      if (typeof result.retryAfterSeconds === "number") next.retryAfterSeconds = result.retryAfterSeconds
      setSubmitState(next)
    }
  }

  return (
    <ModalFrame onClose={onClose} variant="auto">
      <div
        className={`relative bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl ${MODAL_SIZE.md} shadow-2xl pb-[env(safe-area-inset-bottom,16px)] max-h-[90dvh] sm:max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <div className="flex items-center gap-2">
            <Icon name="flag" className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Report an issue
            </span>
          </div>
          <button
            className="text-gray-500 hover:text-gray-300 active:scale-95"
            onClick={onClose}
            aria-label="Close feedback form"
          >
            <Icon name="x-mark" className="w-4 h-4" />
          </button>
        </div>

        {/* Success state — replaces form with reference code, auto-closes. */}
        {submitState.status === "success" ? (
          <div className="px-4 py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-900/40 border border-emerald-700/60 flex items-center justify-center">
              <Icon name="check" className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="text-sm font-bold text-gray-200">Reported. Thank you.</div>
            <div className="text-xs text-gray-500">
              Reference:{" "}
              <span className="font-mono text-amber-400">{submitState.referenceCode}</span>
            </div>
            <div className="text-[10px] text-gray-600">Closing in a moment…</div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Type dropdown */}
            <label className="block">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                Type
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as FeedbackType)}
                disabled={submitState.status === "submitting"}
                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
              >
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FEEDBACK_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>

            {/* Title */}
            <label className="block">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Title
                </span>
                {titleLen > TITLE_COUNTER_THRESHOLD && (
                  <span
                    className={`text-[10px] font-mono ${
                      titleLen > TITLE_MAX ? "text-red-400" : "text-gray-500"
                    }`}
                  >
                    {titleLen} / {TITLE_MAX}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitState.status === "submitting"}
                placeholder="Brief summary"
                maxLength={TITLE_MAX + 50 /* allow slight overflow so the counter warns */}
                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
              />
            </label>

            {/* Description */}
            <label className="block">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Description
                </span>
                {descLen > DESCRIPTION_COUNTER_THRESHOLD && (
                  <span
                    className={`text-[10px] font-mono ${
                      descLen > DESCRIPTION_MAX ? "text-red-400" : "text-gray-500"
                    }`}
                  >
                    {descLen} / {DESCRIPTION_MAX}
                  </span>
                )}
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitState.status === "submitting"}
                placeholder="What happened? Steps to reproduce help us a lot."
                rows={6}
                maxLength={DESCRIPTION_MAX + 100}
                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-500 resize-y disabled:opacity-50"
              />
            </label>

            {/* What we'll send — privacy-forward disclosure. Default-collapsed
                 so it doesn't overwhelm, but always present so users know
                 exactly what's attached. Decision #5 (privacy-forward). */}
            <div className="border border-gray-800 rounded-lg">
              <button
                type="button"
                onClick={() => setMetaExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-900/50 active:scale-[0.99] transition-colors"
                aria-expanded={metaExpanded}
              >
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  What we&apos;ll send
                </span>
                <Icon
                  name={metaExpanded ? "chevron-up" : "chevron-down"}
                  className="w-3.5 h-3.5 text-gray-500"
                />
              </button>
              {metaExpanded && (
                <div className="px-3 pb-3 pt-1 space-y-2 text-[11px] text-gray-400 border-t border-gray-800">
                  <MetaRow label="Page" value={clientMeta.url ?? "—"} />
                  <MetaRow
                    label="Viewport"
                    value={
                      clientMeta.viewport
                        ? `${clientMeta.viewport.width}×${clientMeta.viewport.height}`
                        : "—"
                    }
                  />
                  <MetaRow label="App version" value={clientMeta.appVersion ?? "—"} />
                  <MetaRow
                    label="Browser"
                    value={truncate(clientMeta.userAgent ?? "—", 80)}
                    mono
                  />
                  {hasInjectedContext && (
                    <div>
                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                        Context
                      </div>
                      <pre className="bg-gray-900 border border-gray-800 rounded p-2 text-[10px] text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(injectedContext, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-600 italic pt-1">
                    Your account (if signed in) is attached too. Anonymous submissions are accepted.
                  </div>
                </div>
              )}
            </div>

            {/* Error surface — kept above the submit button so users see it
                 right next to the action that produced it. Form fields stay
                 populated so they can edit + retry without re-typing. */}
            {submitState.status === "error" && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {submitState.retryAfterSeconds != null
                  ? `Too many submissions — try again in ${formatRetryAfter(submitState.retryAfterSeconds)}.`
                  : submitState.message}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-xl text-sm font-bold transition-colors active:scale-95 bg-amber-600 hover:bg-amber-500 text-gray-950 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed"
            >
              {submitState.status === "submitting" ? "Sending…" : "Send report"}
            </button>
          </div>
        )}
      </div>
    </ModalFrame>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0 w-20">
        {label}
      </span>
      <span className={`text-gray-400 break-all ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </span>
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…"
}

/** Format a retry-after value. Server returns seconds; for >=60s we round
 *  up to minutes since the user doesn't need second-level precision when
 *  the wait is long. */
function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? "" : "s"}`
}
