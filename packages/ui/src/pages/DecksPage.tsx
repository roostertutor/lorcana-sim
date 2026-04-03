import React, { useState, useMemo } from "react";
import { LORCAST_CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import CompositionView from "./CompositionView.js";

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
  const [deckText, setDeckText] = useState("");

  const { entries: deck, errors } = useMemo(
    () => parseDecklist(deckText, LORCAST_CARD_DEFINITIONS),
    [deckText],
  );

  const totalCards = deck.reduce((s, e) => s + e.count, 0);
  const deckReady = deck.length > 0 && errors.length === 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Import */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="label">Import Decklist</span>
          <button
            className="btn-ghost text-xs py-1 px-2"
            onClick={() => setDeckText(SAMPLE_DECKLIST)}
          >
            Load sample
          </button>
        </div>
        <textarea
          className="w-full h-56 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono
                     text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
          placeholder={"4 HeiHei - Boat Snack\n4 Stitch - New Dog\n4 Mickey Mouse - True Friend\n..."}
          value={deckText}
          onChange={(e) => setDeckText(e.target.value)}
          spellCheck={false}
        />
        {errors.length > 0 && (
          <div className="bg-red-950/40 border border-red-800 rounded-lg p-3 space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="text-red-400 text-xs font-mono">{err}</p>
            ))}
          </div>
        )}
        {deckReady && (
          <p className="text-sm text-gray-400">
            ✓ {totalCards} cards, {deck.length} unique
          </p>
        )}
      </div>

      {/* Composition — renders live once deck is valid */}
      {deckReady && (
        <CompositionView deck={deck} definitions={LORCAST_CARD_DEFINITIONS} />
      )}
    </div>
  );
}
