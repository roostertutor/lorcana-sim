import React from "react";
import type { DeckEntry } from "@lorcana-sim/engine";

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

interface Props {
  deckText: string;
  parseErrors: string[];
  deck: DeckEntry[] | null;
  onChange: (text: string) => void;
  onAnalyze: () => void;
}

export default function DeckInput({ deckText, parseErrors, deck, onChange, onAnalyze }: Props) {
  const totalCards = deck?.reduce((s, e) => s + e.count, 0) ?? 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-100 mb-1">Deck Input</h1>
        <p className="text-gray-500 text-sm">
          Paste a decklist below. Format: <code className="text-amber-400 text-xs">4 Card Name</code> or{" "}
          <code className="text-amber-400 text-xs">4x Card Name</code>. Lines starting with <code className="text-amber-400 text-xs">#</code> are ignored.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="label">Decklist</span>
          <button
            className="btn-ghost text-xs py-1 px-2"
            onClick={() => onChange(SAMPLE_DECKLIST)}
          >
            Load sample deck
          </button>
        </div>
        <textarea
          className="w-full h-64 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
          placeholder={"4 HeiHei - Boat Snack\n4 Stitch - New Dog\n4 Mickey Mouse - True Friend\n..."}
          value={deckText}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />

        {parseErrors.length > 0 && (
          <div className="bg-red-950/40 border border-red-800 rounded-lg p-3 space-y-1">
            {parseErrors.map((err, i) => (
              <p key={i} className="text-red-400 text-xs font-mono">
                {err}
              </p>
            ))}
          </div>
        )}

        {deck && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">
              ✓ {totalCards} cards, {deck.length} unique
            </span>
            <button className="btn-primary" onClick={onAnalyze}>
              Analyze →
            </button>
          </div>
        )}
      </div>

      {/* Card data hint */}
      <div className="card">
        <p className="label">Card database</p>
        <p className="text-xs text-gray-500">
          The First Chapter — 216 cards. Source: Ravensburger API.
          Cards with named abilities are simulated as vanilla until implemented.
        </p>
      </div>
    </div>
  );
}
