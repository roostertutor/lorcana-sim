import React, { useState, useMemo, useEffect, useCallback } from "react";
import { LORCAST_CARD_DEFINITIONS, parseDecklist, serializeDecklist } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { listDecks, saveDeck, updateDeck, deleteDeck, listDeckVersions } from "../lib/deckApi.js";
import type { SavedDeck, DeckVersion } from "../lib/deckApi.js";
import CompositionView from "./CompositionView.js";
import DeckBuilder from "../components/DeckBuilder.js";

const SAMPLE_DECKLIST = `# Sample deck — The First Chapter (set 1)
4 HeiHei - Boat Snack
4 Stitch - New Dog
4 Simba - Protective Cub
4 Minnie Mouse - Beloved Princess
4 Sebastian - Court Composer
4 Mickey Mouse - True Friend
4 Mr. Smee - Loyal First Mate
4 Cinderella - Gentle and Kind
4 Elsa - Queen Regent
4 Pumbaa - Friendly Warthog
4 Maximus - Palace Horse
4 The Queen - Wicked and Vain
4 Sven - Official Ice Deliverer
4 Stitch - Abomination
4 Mufasa - King of the Pride Lands`;

export default function DecksPage() {
  // ── Auth state ──
  const [session, setSession] = useState<{ email: string } | null>(null);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Saved decks ──
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDecks = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setDecks(await listDecks());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { loadDecks(); }, [loadDecks]);

  // ── Editor state (signed in: entries are source of truth) ──
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState("");
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Version history ──
  const [versions, setVersions] = useState<DeckVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadVersions = useCallback(async (deckId: string) => {
    try {
      setVersions(await listDeckVersions(deckId));
    } catch {
      setVersions([]);
    }
  }, []);

  const deckReady = entries.length > 0;

  function handleSelectDeck(d: SavedDeck) {
    const parsed = parseDecklist(d.decklist_text, LORCAST_CARD_DEFINITIONS);
    setSelectedDeckId(d.id);
    setDeckName(d.name);
    setEntries(parsed.entries);
    setConfirmDelete(null);
    setHistoryOpen(false);
    loadVersions(d.id);
  }

  function handleNewDeck() {
    setSelectedDeckId(null);
    setDeckName("");
    setEntries([]);
    setConfirmDelete(null);
    setVersions([]);
    setHistoryOpen(false);
  }

  function handleRestoreVersion(v: DeckVersion) {
    const parsed = parseDecklist(v.decklist_text, LORCAST_CARD_DEFINITIONS);
    setEntries(parsed.entries);
    setHistoryOpen(false);
  }

  async function handleSave() {
    if (!deckName.trim() || entries.length === 0) return;
    const decklistText = serializeDecklist(entries, LORCAST_CARD_DEFINITIONS);
    setSaving(true);
    setError(null);
    try {
      let savedId: string;
      if (selectedDeckId) {
        const updated = await updateDeck(selectedDeckId, {
          name: deckName.trim(),
          decklist_text: decklistText,
        });
        setDecks((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        savedId = updated.id;
      } else {
        const created = await saveDeck(deckName.trim(), decklistText);
        setDecks((prev) => [created, ...prev]);
        setSelectedDeckId(created.id);
        savedId = created.id;
      }
      loadVersions(savedId);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteDeck(id);
      setDecks((prev) => prev.filter((d) => d.id !== id));
      if (selectedDeckId === id) handleNewDeck();
    } catch (e) {
      setError(String(e));
    }
    setConfirmDelete(null);
  }

  // ── Dirty check ──
  const currentText = useMemo(
    () => serializeDecklist(entries, LORCAST_CARD_DEFINITIONS),
    [entries],
  );
  const selectedDeck = decks.find((d) => d.id === selectedDeckId);
  const isDirty = selectedDeck
    ? selectedDeck.name !== deckName || selectedDeck.decklist_text !== currentText
    : deckName.trim() !== "" || entries.length > 0;

  // ── Signed-out paste state ──
  const [pasteText, setPasteText] = useState("");
  const { entries: pasteDeck, errors: pasteErrors } = useMemo(
    () => parseDecklist(pasteText, LORCAST_CARD_DEFINITIONS),
    [pasteText],
  );
  const pasteTotalCards = pasteDeck.reduce((s, e) => s + e.count, 0);
  const pasteReady = pasteDeck.length > 0 && pasteErrors.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-black text-amber-400 tracking-tight">Decks</h1>
        <p className="text-gray-600 text-sm mt-1">Build and manage your decklists</p>
      </div>

      {!session ? (
        /* ── Signed out: paste + analyze, prompt to sign in ── */
        <div className="space-y-6">
          <div className="card p-4 text-center space-y-2">
            <p className="text-sm text-gray-400">Sign in to save decks across devices</p>
            <p className="text-xs text-gray-600">
              You can still paste a decklist below to analyze it
            </p>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <span className="label">Paste Decklist</span>
              <button
                className="btn-ghost text-xs py-1 px-2"
                onClick={() => setPasteText(SAMPLE_DECKLIST)}
              >
                Load sample
              </button>
            </div>
            <textarea
              className="w-full h-56 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono
                         text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
              placeholder={"4 HeiHei - Boat Snack\n4 Stitch - New Dog\n4 Mickey Mouse - True Friend\n..."}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              spellCheck={false}
            />
            {pasteErrors.length > 0 && (
              <div className="bg-red-950/40 border border-red-800 rounded-lg p-3 space-y-1">
                {pasteErrors.map((err, i) => (
                  <p key={i} className="text-red-400 text-xs font-mono">{err}</p>
                ))}
              </div>
            )}
            {pasteReady && (
              <p className="text-sm text-gray-400">
                {pasteTotalCards} cards, {pasteDeck.length} unique
              </p>
            )}
          </div>

          {pasteReady && (
            <CompositionView deck={pasteDeck} definitions={LORCAST_CARD_DEFINITIONS} />
          )}
        </div>
      ) : (
        /* ── Signed in: deck list + row-based builder ── */
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar: deck list */}
          <div className="space-y-3">
            <button
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg
                         text-sm font-bold transition-colors active:scale-[0.98]"
              onClick={handleNewDeck}
            >
              + New Deck
            </button>

            {loading && (
              <p className="text-xs text-gray-600 text-center animate-pulse">Loading decks...</p>
            )}

            <div className="space-y-1.5">
              {decks.map((d) => {
                const parsed = parseDecklist(d.decklist_text, LORCAST_CARD_DEFINITIONS);
                const count = parsed.entries.reduce((s, e) => s + e.count, 0);
                const isValid = parsed.entries.length > 0 && parsed.errors.length === 0;
                return (
                  <button
                    key={d.id}
                    onClick={() => handleSelectDeck(d)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedDeckId === d.id
                        ? "border-amber-500 bg-amber-900/20"
                        : "border-gray-800 bg-gray-900 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-200 truncate">{d.name}</span>
                      {isValid ? (
                        <span className="text-xs text-green-400 font-mono shrink-0 ml-2">{count}</span>
                      ) : (
                        <span className="text-xs text-red-400 shrink-0 ml-2">invalid</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      {new Date(d.updated_at).toLocaleDateString()}
                    </div>
                  </button>
                );
              })}
            </div>

            {!loading && decks.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">
                No saved decks yet
              </p>
            )}
          </div>

          {/* Main: editor + composition */}
          <div className="space-y-6">
            <div className="card space-y-3">
              {/* Deck name */}
              <input
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5
                           text-sm text-gray-200 placeholder-gray-600
                           focus:border-amber-500 focus:outline-none"
                placeholder="Deck name"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />

              {/* Deck builder */}
              <DeckBuilder
                entries={entries}
                definitions={LORCAST_CARD_DEFINITIONS}
                onChange={setEntries}
              />

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  className="py-2.5 px-5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800
                             disabled:text-gray-600 text-white rounded-lg text-sm font-bold
                             transition-colors active:scale-[0.98]"
                  disabled={!deckName.trim() || entries.length === 0 || saving || !isDirty}
                  onClick={handleSave}
                >
                  {saving ? "Saving..." : selectedDeckId ? "Save Changes" : "Save Deck"}
                </button>

                {selectedDeckId && versions.length > 0 && (
                  <button
                    className="py-2 px-3 text-gray-500 hover:text-gray-300 text-xs font-medium transition-colors"
                    onClick={() => setHistoryOpen((v) => !v)}
                  >
                    History ({versions.length}) {historyOpen ? "▲" : "▼"}
                  </button>
                )}

                {selectedDeckId && (
                  confirmDelete === selectedDeckId ? (
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        className="py-2 px-3 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-colors"
                        onClick={() => handleDelete(selectedDeckId)}
                      >
                        Confirm Delete
                      </button>
                      <button
                        className="py-2 px-3 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="py-2 px-3 text-red-500 hover:text-red-400 text-xs font-medium transition-colors ml-auto"
                      onClick={() => setConfirmDelete(selectedDeckId)}
                    >
                      Delete
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Version history */}
            {selectedDeckId && historyOpen && versions.length > 0 && (
              <div className="card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="label">Version History</span>
                  <span className="text-[10px] text-gray-600">Click to restore into the builder</span>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {versions.map((v, i) => {
                    const parsed = parseDecklist(v.decklist_text, LORCAST_CARD_DEFINITIONS);
                    const count = parsed.entries.reduce((s, e) => s + e.count, 0);
                    const isCurrent = i === 0;
                    const currentText = serializeDecklist(entries, LORCAST_CARD_DEFINITIONS);
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

            {/* Error */}
            {error && (
              <div className="rounded-lg px-4 py-3 bg-red-950/50 border border-red-800/50 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Composition */}
            {deckReady && (
              <CompositionView deck={entries} definitions={LORCAST_CARD_DEFINITIONS} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
