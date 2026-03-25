import React from "react";
import type { DeckEntry } from "@lorcana-sim/engine";

const SAMPLE_DECKLIST = `# Sample deck — 60 cards
10 Simba - Protective Cub
10 Stitch - Rock Star
10 Beast - Hardheaded
10 Moana - Of Motunui
10 Hercules - Hero in Training
10 Tinker Bell - Tiny Tactician`;

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
          placeholder={"10 Simba - Protective Cub\n10 Stitch - Rock Star\n..."}
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

      {/* Available cards hint */}
      <div className="card">
        <p className="label">Available sample cards</p>
        <p className="text-xs text-gray-500 mb-2">
          Currently using SAMPLE_CARD_DEFINITIONS (20 cards). Real card data: github.com/lorcanito/lorcana-data
        </p>
        <div className="grid grid-cols-2 gap-1 text-xs text-gray-400 font-mono">
          <span>Simba - Protective Cub</span>
          <span>Stitch - Rock Star</span>
          <span>Beast - Hardheaded</span>
          <span>Moana - Of Motunui</span>
          <span>Hercules - Hero in Training</span>
          <span>Tinker Bell - Tiny Tactician</span>
          <span>Rapunzel - Gifted Artist</span>
          <span>Mickey Mouse - True Friend</span>
          <span>Genie - On the Job</span>
          <span>Elsa - Snow Queen</span>
          <span>+ 10 more...</span>
        </div>
      </div>
    </div>
  );
}
