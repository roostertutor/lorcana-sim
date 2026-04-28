// =============================================================================
// DecksPage — list view at "/". Grid of saved deck tiles (signed-in) or a
// paste-and-analyze pane (signed-out). Clicking a tile navigates to
// /decks/:id where DeckBuilderPage handles editing.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CARD_DEFINITIONS, isLegalFor, parseDecklist } from "@lorcana-sim/engine";
import { supabase } from "../lib/supabase.js";
import { listDecks } from "../lib/deckApi.js";
import type { SavedDeck } from "../lib/deckApi.js";
import CompositionView from "./CompositionView.js";
import {
  resolveBoxCard,
  deckInkColors,
  hydrateVariants,
  FORMAT_FAMILY_ACCENT,
  getLiveRotation,
  listOfferedRotationsForFamily,
} from "../utils/deckRules.js";
import { getBoardCardImage } from "../utils/cardImage.js";

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
  const navigate = useNavigate();

  // Auth state. `undefined` = unresolved; avoids flashing the signed-out UI.
  const [session, setSession] = useState<{ email: string } | null | undefined>(undefined);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Saved decks
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

  // Signed-out paste state
  const [pasteText, setPasteText] = useState("");
  const { entries: pasteDeck, errors: pasteErrors } = useMemo(
    () => parseDecklist(pasteText, CARD_DEFINITIONS),
    [pasteText],
  );
  const pasteTotalCards = pasteDeck.reduce((s, e) => s + e.count, 0);
  const pasteReady = pasteDeck.length > 0 && pasteErrors.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-black text-amber-400 tracking-tight">My Decks</h1>
        <p className="text-gray-600 text-sm mt-1">Build and manage your decklists</p>
      </div>

      {/* Collapsed loading state: show a single "Loading…" while EITHER auth
           is unresolved OR the decks fetch is in flight for a signed-in user.
           Prevents the two-screen flash (auth "Loading…" → signed-in UI →
           "Loading decks…") that happens on first paint. */}
      {session === undefined || (session && loading) ? (
        <div className="card p-6 text-center text-sm text-gray-500 animate-pulse">
          Loading…
        </div>
      ) : !session ? (
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
            <CompositionView deck={pasteDeck} definitions={CARD_DEFINITIONS} />
          )}
        </div>
      ) : (
        /* ── Signed in: grid of deck tiles + "+ New Deck" tile ── */
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg px-4 py-3 bg-red-950/50 border border-red-800/50 text-sm text-red-400">
              {error}
            </div>
          )}
          {/* The top-level loading guard above already covered the
               session+loading case, so by the time we're here loading=false.
               Skip rendering the inner "Loading decks…" branch — it was
               showing as the second flash. */}
          {(
            <div
              className="grid gap-3"
              // 160px min gives mobile (~390px wide) a 2-column grid instead
              // of one big full-width tile per deck.
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
            >
              {/* "+ New Deck" tile — always first. Matches 5:4 tile aspect of
                   the deck tiles (art-crop) so the grid reads uniformly. */}
              <button
                onClick={() => navigate("/decks/new")}
                className="rounded-lg border-2 border-dashed border-amber-600/50 bg-amber-950/10 hover:bg-amber-900/20 hover:border-amber-500 transition-colors flex flex-col items-center justify-center gap-2 aspect-[5/4] text-amber-400"
              >
                <div className="text-4xl font-black leading-none">+</div>
                <div className="text-sm font-bold">New Deck</div>
              </button>

              {/* Saved deck tiles — card art cropped to the top of the image so
                   only the illustration shows (no name banner / stats / text). */}
              {decks.map((d) => {
                const parsed = parseDecklist(d.decklist_text, CARD_DEFINITIONS);
                // Hydrate variants from card_metadata so the box art reflects
                // the enchanted / promo / etc. art the user picked in the
                // builder. Without this, entries have no variant field and
                // resolveBoxCard falls back to def.imageUrl (regular).
                const hydrated = hydrateVariants(parsed.entries, d.card_metadata);
                const count = hydrated.reduce((s, e) => s + e.count, 0);
                const isValid = hydrated.length > 0 && parsed.errors.length === 0;
                const boxCard = resolveBoxCard(hydrated, d.box_card_id, CARD_DEFINITIONS);
                const inks = deckInkColors(hydrated, CARD_DEFINITIONS);
                // Format stamp — shown as a chip on the tile so users see at-a-
                // glance what format this deck targets. Decks no longer carry
                // rotation (dropped 2026-04-27); rotation is resolved at
                // validation time as the current live rotation per family.
                // Legality drift (deck illegal in current live rotation) gets
                // surfaced inline as the legality issue list.
                const formatAccent = FORMAT_FAMILY_ACCENT[d.format_family];
                const formatLabel = d.format_family === "core" ? "Core" : "Infinity";
                const validationRotation = getLiveRotation(d.format_family)
                  ?? listOfferedRotationsForFamily(d.format_family).at(-1)?.rotation
                  ?? "s12";
                const validationFormat = { family: d.format_family, rotation: validationRotation };
                let legalityIssues: string[] = [];
                try {
                  const res = isLegalFor(hydrated, CARD_DEFINITIONS, validationFormat);
                  if (!res.ok) legalityIssues = res.issues.map((i) => i.message);
                } catch (e) {
                  legalityIssues = [String(e)];
                }
                const isLegal = legalityIssues.length === 0;
                return (
                  <Link
                    key={d.id}
                    to={`/decks/${d.id}`}
                    className="group relative rounded-lg border border-gray-800 bg-gray-900 hover:border-amber-500/70 transition-colors aspect-[5/4] overflow-hidden flex flex-col"
                  >
                    {/* Box art — cropped to top of the source card image */}
                    {boxCard?.imageUrl ? (
                      <img
                        {...getBoardCardImage(boxCard.imageUrl)}
                        alt={boxCard.fullName}
                        className="absolute inset-0 w-full h-full object-cover object-top group-hover:brightness-110 transition-[filter]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-700 text-xs">
                        Empty deck
                      </div>
                    )}

                    {/* Top-right stack: format chip + (when illegal) a red
                         exclamation. Hover shows the full issue list via
                         native title tooltip. Placed absolute so the chip
                         floats over the art without eating into the bottom
                         name overlay. */}
                    <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 pointer-events-none">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${formatAccent.badgeBg} ${formatAccent.text} ${formatAccent.border} border shadow-sm pointer-events-auto`}
                        title={`Built for ${formatLabel}`}
                      >
                        {formatLabel}
                      </span>
                      {!isLegal && isValid && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-900/90 text-red-100 border border-red-700 shadow-sm pointer-events-auto inline-flex items-center gap-1"
                          title={`${legalityIssues.length} card${legalityIssues.length === 1 ? "" : "s"} not legal in current rotation. Click to open this deck and edit, or migrate to Infinity.\n\n${legalityIssues.join("\n")}`}
                        >
                          <span>⚠️</span>
                          {legalityIssues.length} illegal
                        </span>
                      )}
                    </div>

                    {/* Bottom overlay: ink icons + name + count + date. Ink
                         icons are inlined here (not over the cost pip) — the
                         pip extends past the card's black border so a small
                         badge can't cover it cleanly; we just embrace it. */}
                    <div className="relative mt-auto bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-5 pb-2 px-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-bold text-white line-clamp-2 drop-shadow">{d.name}</span>
                        {/* Only surface a badge when the deck is NOT a clean
                             60-card build. Done decks stay unannotated; WIP
                             and invalid decks get a visible warning. */}
                        {!isValid ? (
                          <span className="text-[10px] text-red-400 shrink-0 drop-shadow">invalid</span>
                        ) : count !== 60 ? (
                          <span className="text-[10px] text-yellow-400 font-mono font-bold shrink-0 drop-shadow">{count}/60</span>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <div className="flex items-center gap-0.5">
                          {inks.map((c) => (
                            <img
                              key={c}
                              src={`/icons/ink/${c}.svg`}
                              alt={c}
                              title={c}
                              className="w-4 h-4 drop-shadow"
                            />
                          ))}
                        </div>
                        <div className="text-[9px] text-gray-400 drop-shadow">
                          {new Date(d.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {!loading && decks.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">
              No saved decks yet. Click <span className="text-amber-400 font-bold">+ New Deck</span> to get started.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
