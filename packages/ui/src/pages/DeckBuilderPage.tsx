// =============================================================================
// DeckBuilderPage — single-deck builder at /decks/:id (existing deck) or
// /decks/new (empty deck). Paired with DecksPage which is the list view.
// Layout: picker (flex-1) on the left, editor (fixed width) on the right at
// lg+; stacked below that.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import type { MouseEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { CARD_DEFINITIONS, isLegalFor, parseDecklist, serializeDecklist } from "@lorcana-sim/engine";
import type { DeckEntry, CardVariantType, GameFormatFamily } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { listDecks, saveDeck, updateDeck, deleteDeck, listDeckVersions } from "../lib/deckApi.js";
import type { SavedDeck, DeckVersion, CardMetadata } from "../lib/deckApi.js";
import CompositionView from "./CompositionView.js";
import DeckBuilder from "../components/DeckBuilder.js";
import CardPicker from "../components/CardPicker.js";
import FormatPicker from "../components/FormatPicker.js";
import ModalFrame from "../components/ModalFrame.js";
import { resolveBoxCard, resolveEntryImageUrl, hydrateVariants, getLiveRotation, listOfferedRotationsForFamily } from "../utils/deckRules.js";
import { getBoardCardImage } from "../utils/cardImage.js";

/** Build the card_metadata map for persistence from the current entries.
 *  Only cards with a non-default variant appear — regular (the default) is
 *  represented by absence. */
function buildCardMetadata(entries: DeckEntry[]): Record<string, CardMetadata> {
  const out: Record<string, CardMetadata> = {};
  for (const e of entries) {
    if (e.variant) {
      out[e.definitionId] = { variant: e.variant };
    }
  }
  return out;
}

export default function DeckBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  // Auth — undefined until supabase resolves, then null or session object.
  const [session, setSession] = useState<{ email: string } | null | undefined>(undefined);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Editor state
  const [originalDeck, setOriginalDeck] = useState<SavedDeck | null>(null);
  // New decks default to "New Deck" so the save button isn't disabled by a
  // blank name after an import. Users can clear/rename anytime; the isDirty
  // check below treats "New Deck" on a pristine empty deck as non-dirty so
  // the beforeunload prompt doesn't fire on a fresh /decks/new tab.
  const [deckName, setDeckName] = useState(isNew ? "New Deck" : "");
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [boxCardId, setBoxCardId] = useState<string | null>(null);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  // Declared format family — drives the CardPicker filter, autocomplete,
  // and legality validation. Decks no longer carry rotation (dropped
  // 2026-04-27); rotation is resolved at validation time as the current
  // live ranked rotation per family. So a Core deck built today validates
  // against Core-s11 (live); after Set 12 launches 2026-05-08 it'll
  // validate against Core-s12 with no user action — the deck's cards just
  // re-evaluate against whichever rotation is live at the moment. New
  // decks default to "core"; loaded decks adopt their stored family.
  const [formatFamily, setFormatFamily] = useState<GameFormatFamily>("core");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Version history
  const [versions, setVersions] = useState<DeckVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadVersions = useCallback(async (deckId: string) => {
    try { setVersions(await listDeckVersions(deckId)); } catch { setVersions([]); }
  }, []);

  // Load the deck on mount / id change. Variants live outside the vanilla
  // decklist_text (interop with external Lorcana tools); hydrate them from
  // the SavedDeck.card_metadata map onto the parsed DeckEntry[].
  useEffect(() => {
    if (isNew || !session) return;
    setLoading(true);
    (async () => {
      try {
        const all = await listDecks();
        const found = all.find((d) => d.id === id);
        if (!found) {
          setError(`Deck ${id} not found`);
          return;
        }
        const parsed = parseDecklist(found.decklist_text, CARD_DEFINITIONS);
        const hydrated = hydrateVariants(parsed.entries, found.card_metadata);
        setOriginalDeck(found);
        setDeckName(found.name);
        setEntries(hydrated);
        setBoxCardId(found.box_card_id);
        // Adopt the deck's stored format family. Rotation is no longer
        // stored on the deck (dropped 2026-04-27); legality re-evaluates
        // dynamically against the current live rotation for this family.
        setFormatFamily(found.format_family);
        loadVersions(found.id);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, session, loadVersions]);

  const currentText = useMemo(
    () => serializeDecklist(entries, CARD_DEFINITIONS),
    [entries],
  );

  // Total card count for the sticky header pill. Decks are always 60 in
  // Lorcana; showing progress toward that goal is a strong visual cue.
  const totalCount = useMemo(
    () => entries.reduce((s, e) => s + e.count, 0),
    [entries],
  );

  // Resolve the rotation to validate against — current live ranked rotation
  // for this family. Falls back to the highest-id offered rotation if no
  // live rotation exists (only happens briefly mid-rotation-cut). Pre-Set-12
  // launch this is "s11"; post-launch this is "s12". Re-resolves whenever
  // family changes so deckbuilder validation tracks the engine registry
  // automatically.
  const validationRotation = useMemo(() => {
    return getLiveRotation(formatFamily)
      ?? listOfferedRotationsForFamily(formatFamily).at(-1)?.rotation
      ?? "s12";
  }, [formatFamily]);
  const validationFormat = useMemo(
    () => ({ family: formatFamily, rotation: validationRotation }),
    [formatFamily, validationRotation],
  );

  // Legality — recompute whenever entries or family change. Engine throws
  // on unknown rotation (stale stamp after a registry removal); wrap so
  // the UI shows a clean error banner instead of crashing.
  const legality = useMemo(() => {
    try {
      return isLegalFor(entries, CARD_DEFINITIONS, validationFormat);
    } catch (e) {
      return {
        ok: false,
        issues: [{
          definitionId: "",
          fullName: "",
          reason: "unknown_card" as const,
          message: String(e),
        }],
      };
    }
  }, [entries, validationFormat]);

  // Build definitionId → message map for DeckBuilder row highlighting.
  // One message per card (first issue wins; can't currently have two
  // issues on the same card because isLegalFor short-circuits per entry).
  const issueMessagesByDefinitionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of legality.issues) {
      if (issue.definitionId) map.set(issue.definitionId, issue.message);
    }
    return map;
  }, [legality]);
  const currentMetadata = useMemo(() => buildCardMetadata(entries), [entries]);
  // card_metadata is a shallow record of shallow records — JSON-stringify diff
  // is cheap and correct for this shape. Avoids pulling in a deepEqual dep.
  const metadataJson = useMemo(() => JSON.stringify(currentMetadata), [currentMetadata]);
  const originalMetadataJson = originalDeck
    ? JSON.stringify(originalDeck.card_metadata ?? {})
    : "{}";
  // On a new deck, the default "New Deck" prefill counts as "clean" — it's
  // auto-provided, not user input. Only treat the name as dirty if the user
  // changed it to something else (including clearing it).
  const nameIsUserEdited = deckName.trim() !== "" && deckName.trim() !== "New Deck";
  const isDirty = originalDeck
    ? originalDeck.name !== deckName
      || originalDeck.decklist_text !== currentText
      || originalDeck.box_card_id !== boxCardId
      || originalMetadataJson !== metadataJson
      || originalDeck.format_family !== formatFamily
    : nameIsUserEdited
      || entries.length > 0
      || boxCardId !== null
      || Object.keys(currentMetadata).length > 0;
  const deckReady = entries.length > 0;

  // Guard against losing unsaved changes when the user closes the tab, hits
  // refresh, or clicks away. The beforeunload handler covers tab-close +
  // refresh (browser shows a generic "Leave site?" prompt — modern browsers
  // block custom messages there). The in-app nav case is handled below by
  // showing a React modal instead of window.confirm — BrowserRouter can't
  // use useBlocker, so we intercept the Link click explicitly.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Pending in-app navigation path — when set, the discard-changes modal
  // renders. Confirm → navigate there. Cancel → clear.
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  // Card-picker visibility. New decks default to open so users land on
  // the "Start browsing" empty state instead of a dark, directionless
  // editor. Existing decks keep it closed — known-card adds flow
  // through the editor's search autocomplete.
  const [pickerOpen, setPickerOpen] = useState(isNew);
  function handleBackClick(e: MouseEvent) {
    if (!isDirty) return;
    e.preventDefault();
    setPendingNav("/");
  }

  function handleRestoreVersion(v: DeckVersion) {
    const parsed = parseDecklist(v.decklist_text, CARD_DEFINITIONS);
    // Versions don't store card_metadata — carry the current deck's metadata
    // forward so variant preferences survive a restore (only applies to ids
    // that still exist in the restored version).
    const hydrated = hydrateVariants(parsed.entries, originalDeck?.card_metadata);
    setEntries(hydrated);
    setHistoryOpen(false);
  }

  async function handleSave() {
    if (!deckName.trim() || entries.length === 0) return;
    const decklistText = serializeDecklist(entries, CARD_DEFINITIONS);
    setSaving(true);
    setError(null);
    try {
      if (originalDeck) {
        const updated = await updateDeck(originalDeck.id, {
          name: deckName.trim(),
          decklist_text: decklistText,
          box_card_id: boxCardId,
          card_metadata: currentMetadata,
          format_family: formatFamily,
        });
        setOriginalDeck(updated);
        loadVersions(updated.id);
      } else {
        // saveDeck stamps the family on insert (falls through DB default
        // for legacy callers not providing one). Rotation is no longer
        // stored on the deck — resolved per-game at play time.
        const created = await saveDeck(deckName.trim(), decklistText, formatFamily);
        // saveDeck doesn't accept box_card_id / card_metadata on insert — apply
        // them via a follow-up update when the user set either pre-save.
        const hasExtras =
          boxCardId !== null || Object.keys(currentMetadata).length > 0;
        const final = hasExtras
          ? await updateDeck(created.id, {
              box_card_id: boxCardId,
              card_metadata: currentMetadata,
            })
          : created;
        setOriginalDeck(final);
        loadVersions(final.id);
        // First save — switch URL from /decks/new to the real id
        navigate(`/decks/${final.id}`, { replace: true });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!originalDeck) return;
    setError(null);
    try {
      await deleteDeck(originalDeck.id);
      navigate("/");
    } catch (e) {
      setError(String(e));
    }
  }

  // Signed-out view
  if (session === undefined) {
    return <div className="card p-6 text-center text-sm text-gray-500 animate-pulse">Loading…</div>;
  }
  if (!session) {
    return (
      <div className="space-y-4">
        <div className="card p-4 text-center space-y-2">
          <p className="text-sm text-gray-400">Sign in to save decks</p>
          <Link to="/" className="text-xs text-amber-400 hover:text-amber-300 underline">
            ← Back to Decks
          </Link>
        </div>
      </div>
    );
  }
  if (loading) {
    return <div className="card p-6 text-center text-sm text-gray-500 animate-pulse">Loading deck…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Sticky top bar — back link, browse toggle (moved LEFT so its click-
           target is in the same column the picker panel slides into), deck
           name summary, card-count pill, and Save button. Always in view
           while scrolling so users never have to hunt for Save on mobile.
           z-20 sits above the Shell header (z-10); on scroll this bar
           replaces the app logo. Trade the logo for a save button —
           that's the right bargain for a long-form edit screen. */}
      <div className="sticky top-0 z-20 -mt-6 -mx-4 px-4 py-2.5 bg-gray-950/90 backdrop-blur border-b border-gray-800">
        <div className="max-w-6xl mx-auto flex items-center gap-2 sm:gap-3">
          <Link
            to="/"
            onClick={handleBackClick}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          >
            ← My Decks
          </Link>
          {/* Browse toggle — stays visible when open (morphs to "Hide"), so
               it doesn't vanish after click and its location matches the
               column the picker occupies. */}
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors shrink-0 ${
              pickerOpen
                ? "bg-gray-700 hover:bg-gray-600 text-white"
                : "bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
            }`}
            title={pickerOpen ? "Hide card browser" : "Open the card browser for discovery / visual browsing"}
          >
            {pickerOpen ? "Hide browse" : "+ Browse"}
          </button>

          {/* Deck name preview — desktop only; mobile relies on the input
               below for identity. truncate avoids reflow on long names. */}
          <div className="flex-1 min-w-0 truncate text-[11px] text-gray-400 hidden sm:block">
            {deckName.trim() || <span className="italic text-gray-600">Untitled deck</span>}
          </div>
          <div className="flex-1 sm:hidden" />

          {/* Card-count pill — turns amber at 60 as a "deck complete" cue. */}
          <div className="text-[11px] font-mono shrink-0 px-2 py-0.5 rounded bg-gray-900 border border-gray-800">
            <span className={totalCount === 60 ? "text-amber-400 font-bold" : "text-gray-400"}>{totalCount}</span>
            <span className="text-gray-600">/60</span>
          </div>

          {/* Save — duplicate of the inline button's action with identical
               disabled logic. Inline version removed below. */}
          <button
            className="py-1.5 px-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                       disabled:text-gray-600 text-white rounded-lg text-xs font-bold
                       transition-colors active:scale-[0.98] shrink-0"
            disabled={!deckName.trim() || entries.length === 0 || saving || !isDirty}
            onClick={handleSave}
          >
            {saving ? "Saving..." : (
              <span className="inline-flex items-center gap-1.5">
                {originalDeck && isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-pulse" aria-hidden />
                )}
                {originalDeck ? "Save" : "Create"}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main: picker | editor on lg+, stacked below. Picker is hidden by
           default — the editor's search+autocomplete handles known-card
           adds. Picker toggles on for discovery / visual browsing. */}
      <div className="flex flex-col lg:flex-row gap-6 min-w-0">
        {/* Card picker — rendered only when toggled open */}
        {pickerOpen && (
          <div className="card flex-1 min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                Browse cards
              </div>
              <button
                onClick={() => setPickerOpen(false)}
                className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                title="Hide card browser"
              >
                Hide
              </button>
            </div>
            <CardPicker
              entries={entries}
              definitions={CARD_DEFINITIONS}
              onChange={setEntries}
              format={validationFormat}
            />
          </div>
        )}

        {/* Deck editor — fixed 340px when picker is open, max-w-3xl centered
             when it's hidden. (Raised from 2xl = 672px to 3xl = 768px so
             the editor doesn't feel cramped against the full-width
             CompositionView below on larger desktops.) Mobile forces
             w-full explicitly; lg:flex-1 restores desktop "fill remaining
             space" behavior when sharing the row with the picker. */}
        <div className={`${pickerOpen ? "lg:w-[340px] shrink-0" : "w-full lg:flex-1 max-w-3xl mx-auto"} min-w-0 space-y-6`}>
          <div className="card space-y-3">
            {/* Box preview + deck name */}
            {(() => {
              const boxCard = resolveBoxCard(entries, boxCardId, CARD_DEFINITIONS);
              return (
                <div className="flex gap-3">
                  <button
                    onClick={() => setBoxPickerOpen(true)}
                    disabled={entries.length === 0}
                    className="shrink-0 w-[84px] aspect-[5/4] rounded-md overflow-hidden border border-gray-700 bg-gray-900 hover:border-amber-500 disabled:hover:border-gray-700 disabled:opacity-40 transition-colors relative group"
                    title={entries.length === 0 ? "Add a card to choose box art" : "Change deck box art"}
                  >
                    {boxCard?.imageUrl ? (
                      <img
                        {...getBoardCardImage(boxCard.imageUrl)}
                        alt={boxCard.fullName}
                        className="w-full h-full object-cover object-top"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-600 text-center p-1">
                        Empty
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[8px] text-center text-gray-300 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      Change
                    </div>
                  </button>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <input
                      className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5
                                 text-sm text-gray-200 placeholder-gray-600
                                 focus:border-amber-500 focus:outline-none"
                      placeholder="Deck name"
                      autoCapitalize="words"
                      autoComplete="off"
                      enterKeyHint="done"
                      aria-label="Deck name"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                    />
                    <FormatPicker value={formatFamily} onChange={setFormatFamily} />
                  </div>
                </div>
              );
            })()}

            {/* Legality summary — only rendered when there are issues. Counts
                 the illegal entries so the user sees at-a-glance how many
                 rows need fixing; each illegal row also shows its own
                 inline message via DeckBuilder's issueMessagesByDefinitionId.
                 The format dropdown (in the deck-name row above) already
                 lets users switch between Core and Infinity — Infinity's
                 legalSets are a superset, so flipping to Infinity typically
                 resolves Core-rotation illegalities. */}
            {!legality.ok && entries.length > 0 && (
              <div className="rounded-lg px-3 py-2 bg-red-950/40 border border-red-800/60 text-[11px] text-red-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>⚠️</span>
                  {legality.issues.length} card{legality.issues.length === 1 ? "" : "s"} not legal in current rotation ({formatFamily === "core" ? "Core" : "Infinity"} {validationRotation})
                </div>
                <div className="text-red-400/80">
                  Highlighted in red below. Edit the deck, or change the format above.
                </div>
              </div>
            )}

            {/* Your deck rows */}
            <div className="pt-2 border-t border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">
                Your deck
              </div>
              <DeckBuilder
                entries={entries}
                definitions={CARD_DEFINITIONS}
                onChange={setEntries}
                deckName={deckName}
                format={validationFormat}
                issueMessagesByDefinitionId={issueMessagesByDefinitionId}
              />
            </div>

            {/* Action buttons — Save moved to the sticky top bar so it's
                 always in view. This row keeps History + Delete (less
                 frequent, less urgent, OK to live at the bottom). */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {originalDeck && versions.length > 0 && (
                <button
                  className="py-2 px-3 text-gray-500 hover:text-gray-300 text-xs font-medium transition-colors"
                  onClick={() => setHistoryOpen((v) => !v)}
                >
                  History ({versions.length}) {historyOpen ? "▲" : "▼"}
                </button>
              )}

              {originalDeck && (
                confirmDelete ? (
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      className="py-2 px-3 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-colors"
                      onClick={handleDelete}
                    >
                      Confirm Delete
                    </button>
                    <button
                      className="py-2 px-3 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="py-2 px-3 text-red-500 hover:text-red-400 text-xs font-medium transition-colors ml-auto"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
                  </button>
                )
              )}
            </div>
          </div>

          {/* Version history */}
          {originalDeck && historyOpen && versions.length > 0 && (
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="label">Version History</span>
                <span className="text-[10px] text-gray-600">Click to restore</span>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {versions.map((v, i) => {
                  const parsed = parseDecklist(v.decklist_text, CARD_DEFINITIONS);
                  const count = parsed.entries.reduce((s, e) => s + e.count, 0);
                  const isCurrent = i === 0;
                  const matchesCurrent = v.decklist_text === currentText;
                  return (
                    <button
                      key={v.id}
                      onClick={() => handleRestoreVersion(v)}
                      className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 hover:border-gray-700 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-400">
                          {new Date(v.created_at).toLocaleString()}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] uppercase tracking-wider text-amber-500 font-bold">
                            Latest
                          </span>
                        )}
                        {matchesCurrent && !isCurrent && (
                          <span className="text-[9px] uppercase tracking-wider text-green-500 font-bold">
                            Matches builder
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-mono text-gray-500 shrink-0">{count} cards</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg px-4 py-3 bg-red-950/50 border border-red-800/50 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Composition — width matched to the editor column above. When the
           picker is closed the editor is centered at max-w-3xl, so the
           composition below matches. When the picker is open the row
           takes the full parent width, and composition follows suit —
           no max-w constraint so the charts get the room they need. */}
      {deckReady && (
        <div className={pickerOpen ? "" : "max-w-3xl mx-auto"}>
          <CompositionView deck={entries} definitions={CARD_DEFINITIONS} />
        </div>
      )}

      {/* Discard-changes modal — in-app alternative to window.confirm().
           Shown when user clicks the "← My Decks" link with unsaved work. */}
      {pendingNav && (
        <ModalFrame onClose={() => setPendingNav(null)}>
          <div
            className="bg-gray-950 border border-gray-700 rounded-xl p-5 m-4 max-w-sm w-full space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-100">Discard changes?</h3>
              <p className="text-xs text-gray-400">
                You have unsaved changes to this deck. If you leave now, they'll be lost.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                onClick={() => setPendingNav(null)}
              >
                Stay
              </button>
              <button
                className="px-3 py-2 text-xs font-bold text-white bg-red-700 hover:bg-red-600 rounded-lg transition-colors"
                onClick={() => { const p = pendingNav; setPendingNav(null); navigate(p); }}
              >
                Discard & leave
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* Box art picker modal — grid of deck's own cards, click to set */}
      {boxPickerOpen && (
        <ModalFrame onClose={() => setBoxPickerOpen(false)}>
          <div
            className="bg-gray-950 border border-gray-700 rounded-xl p-4 m-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-200">Choose box art</h3>
              <div className="flex items-center gap-2">
                {boxCardId !== null && (
                  <button
                    className="text-[11px] text-gray-500 hover:text-gray-300 underline"
                    onClick={() => { setBoxCardId(null); setBoxPickerOpen(false); }}
                  >
                    Use auto
                  </button>
                )}
                <button
                  className="text-gray-400 hover:text-gray-200"
                  onClick={() => setBoxPickerOpen(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <p className="text-[11px] text-gray-500">
              Pick a card from this deck. Defaults to the first card you added.
            </p>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}
            >
              {entries.map((e) => {
                const def = CARD_DEFINITIONS[e.definitionId];
                if (!def) return null;
                const selected = boxCardId === def.id;
                // Use the entry's chosen variant so the picker shows exactly
                // the art that will end up on the deck tile.
                const imgUrl = resolveEntryImageUrl(e, def);
                return (
                  <button
                    key={e.definitionId}
                    onClick={() => { setBoxCardId(def.id); setBoxPickerOpen(false); }}
                    className={`relative rounded-md overflow-hidden border-2 transition-colors ${
                      selected ? "border-amber-500" : "border-gray-800 hover:border-gray-600"
                    }`}
                  >
                    {imgUrl ? (
                      <img
                        // Box-art picker thumbs render at ~100-160 CSS wide.
                        // getBoardCardImage delivers DPR-aware small/normal
                        // pair via srcSet — replaces the dead-code Lorcast
                        // path-shape `.replace("/digital/normal/", ...)` that
                        // was a silent no-op on R2-shaped URLs.
                        {...getBoardCardImage(imgUrl)}
                        alt={def.fullName}
                        className="w-full aspect-[5/7] object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-[5/7] bg-gray-900 flex items-center justify-center text-xs text-gray-600 p-2 text-center">
                        {def.fullName}
                      </div>
                    )}
                    {selected && (
                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-500 text-gray-950 flex items-center justify-center text-xs font-black shadow">
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
