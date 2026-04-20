// =============================================================================
// DeckBuilderPage — single-deck builder at /decks/:id (existing deck) or
// /decks/new (empty deck). Paired with DecksPage which is the list view.
// Layout: picker (flex-1) on the left, editor (fixed width) on the right at
// lg+; stacked below that.
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { MouseEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { CARD_DEFINITIONS, parseDecklist, serializeDecklist } from "@lorcana-sim/engine";
import type { DeckEntry, CardVariantType } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { listDecks, saveDeck, updateDeck, deleteDeck, listDeckVersions } from "../lib/deckApi.js";
import type { SavedDeck, DeckVersion, CardMetadata } from "../lib/deckApi.js";
import CompositionView from "./CompositionView.js";
import DeckBuilder from "../components/DeckBuilder.js";
import CardPicker from "../components/CardPicker.js";
import { resolveBoxCard, resolveEntryImageUrl, hydrateVariants } from "../utils/deckRules.js";

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

/** Shape of a local draft — saved to localStorage so an in-progress deck
 *  survives tab closes, refreshes, or nav without an explicit Save.
 *  Entries already include variant (no need for separate metadata blob).
 *  Drafts are keyed per deck id so decks have independent drafts. */
interface DraftState {
  deckName: string;
  entries: DeckEntry[];
  boxCardId: string | null;
  savedAt: number;
}

function draftKey(id: string | undefined, isNew: boolean): string {
  return `deck-draft-${isNew ? "new" : id}`;
}

function readDraft(key: string): DraftState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DraftState;
  } catch {
    return null;
  }
}

function writeDraft(key: string, state: DraftState) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota or storage disabled — skip */ }
}

function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
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
  const [deckName, setDeckName] = useState("");
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [boxCardId, setBoxCardId] = useState<string | null>(null);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
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
  const currentMetadata = useMemo(() => buildCardMetadata(entries), [entries]);
  // card_metadata is a shallow record of shallow records — JSON-stringify diff
  // is cheap and correct for this shape. Avoids pulling in a deepEqual dep.
  const metadataJson = useMemo(() => JSON.stringify(currentMetadata), [currentMetadata]);
  const originalMetadataJson = originalDeck
    ? JSON.stringify(originalDeck.card_metadata ?? {})
    : "{}";
  const isDirty = originalDeck
    ? originalDeck.name !== deckName
      || originalDeck.decklist_text !== currentText
      || originalDeck.box_card_id !== boxCardId
      || originalMetadataJson !== metadataJson
    : deckName.trim() !== ""
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

  // Local draft auto-save. Writes {deckName, entries, boxCardId} to
  // localStorage while the deck is dirty so the user's WIP survives tab
  // close / refresh / accidental nav. Applied once on mount (after DB
  // load for existing decks) and cleared on successful save or discard.
  const currentDraftKey = draftKey(id, isNew);
  const draftAppliedRef = useRef(false);
  // Apply draft on mount. For existing decks, wait until the DB load
  // completes (originalDeck set) so we overlay the draft on top, not
  // the other way around.
  useEffect(() => {
    if (draftAppliedRef.current) return;
    if (!isNew && !originalDeck) return; // still loading
    if (isNew && session === undefined) return; // auth unresolved
    const draft = readDraft(currentDraftKey);
    if (draft) {
      setDeckName(draft.deckName);
      setEntries(draft.entries);
      setBoxCardId(draft.boxCardId);
    }
    draftAppliedRef.current = true;
  }, [isNew, originalDeck, session, currentDraftKey]);
  // Write draft when dirty. Debounced 500ms so rapid clicks don't hammer
  // localStorage.
  useEffect(() => {
    if (!draftAppliedRef.current || !isDirty) return;
    const timer = setTimeout(() => {
      writeDraft(currentDraftKey, { deckName, entries, boxCardId, savedAt: Date.now() });
    }, 500);
    return () => clearTimeout(timer);
  }, [isDirty, deckName, entries, boxCardId, currentDraftKey]);

  // Card-picker visibility. Closed by default — editor search-autocomplete
  // handles known-card adds for most users. Toggle opens the grid for
  // visual discovery (and zero mount cost when it's not needed).
  const [pickerOpen, setPickerOpen] = useState(false);
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
        });
        setOriginalDeck(updated);
        loadVersions(updated.id);
        clearDraft(currentDraftKey);
      } else {
        const created = await saveDeck(deckName.trim(), decklistText);
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
        // "new" draft has done its job — clear it before navigating to the
        // real-id URL. The per-id key starts fresh (empty).
        clearDraft(currentDraftKey);
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
      clearDraft(currentDraftKey);
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
      {/* Header: back link + browse-cards toggle */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          onClick={handleBackClick}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← My Decks
        </Link>
        <div className="flex-1" />
        {!pickerOpen && (
          <button
            onClick={() => setPickerOpen(true)}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg font-medium transition-colors"
            title="Open the card browser for discovery / visual browsing"
          >
            + Browse cards
          </button>
        )}
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
            />
          </div>
        )}

        {/* Deck editor — fixed 340px when picker is open, max-w-2xl centered
             when it's hidden. On mobile we force w-full explicitly; flex-1
             in a flex-col parent was letting intrinsic-width descendants
             (text inputs default to size=20 min-width) force page-level
             horizontal scroll. `lg:flex-1` restores the desktop behavior
             where the editor grows to fill available space next to the
             picker-open 340px column. */}
        <div className={`${pickerOpen ? "lg:w-[340px] shrink-0" : "w-full lg:flex-1 max-w-2xl mx-auto"} min-w-0 space-y-6`}>
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
                        src={boxCard.imageUrl.replace("/digital/normal/", "/digital/small/")}
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
                  <input
                    className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5
                               text-sm text-gray-200 placeholder-gray-600
                               focus:border-amber-500 focus:outline-none"
                    placeholder="Deck name"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                  />
                </div>
              );
            })()}

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
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                className="py-2.5 px-5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                           disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                           transition-colors active:scale-[0.98]"
                disabled={!deckName.trim() || entries.length === 0 || saving || !isDirty}
                onClick={handleSave}
              >
                {saving ? "Saving..." : (
                  <span className="inline-flex items-center gap-1.5">
                    {/* Dirty cue — small pulsing dot on existing decks when
                         there are unsaved changes. Not shown on new decks:
                         the button going from disabled (empty) to enabled
                         already communicates "something to save". */}
                    {originalDeck && isDirty && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-pulse" aria-hidden />
                    )}
                    {originalDeck ? "Save Changes" : "Save Deck"}
                  </span>
                )}
              </button>

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

      {/* Composition — full-width below */}
      {deckReady && (
        <CompositionView deck={entries} definitions={CARD_DEFINITIONS} />
      )}

      {/* Discard-changes modal — in-app alternative to window.confirm().
           Shown when user clicks the "← My Decks" link with unsaved work. */}
      {pendingNav && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setPendingNav(null)}
        >
          <div
            className="bg-gray-950 border border-gray-700 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-2xl"
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
                onClick={() => { const p = pendingNav; clearDraft(currentDraftKey); setPendingNav(null); navigate(p); }}
              >
                Discard & leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Box art picker modal — grid of deck's own cards, click to set */}
      {boxPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setBoxPickerOpen(false)}
        >
          <div
            className="bg-gray-950 border border-gray-700 rounded-xl p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto space-y-3"
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
                        src={imgUrl.replace("/digital/normal/", "/digital/small/")}
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
        </div>
      )}
    </div>
  );
}
