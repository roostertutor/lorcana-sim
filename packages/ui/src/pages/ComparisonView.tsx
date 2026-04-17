import React, { useState, useCallback } from "react";
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
import { parseDecklist, CARD_DEFINITIONS } from "@lorcana-sim/engine";
import {
  runSimulation, GreedyBot, RandomBot,
} from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";
import { compareDecks } from "@lorcana-sim/analytics";
import type { MatchupStats } from "@lorcana-sim/analytics";

const BOT_OPTIONS: { id: string; label: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", bot: () => GreedyBot },
  { id: "random", label: "Random", bot: () => RandomBot },
];

const SAMPLE = `4 HeiHei - Boat Snack
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

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

function DeckTextArea({
  label,
  value,
  onChange,
  errors,
  cardCount,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
  cardCount: number;
}) {
  return (
    <div className="card space-y-2 flex-1">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {cardCount > 0 && <span className="text-xs text-gray-500">{cardCount} cards</span>}
      </div>
      <textarea
        className="w-full h-40 bg-gray-950 border border-gray-700 rounded-lg p-3 text-xs font-mono text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
        placeholder="4 Card Name..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {errors.map((e, i) => (
        <p key={i} className="text-red-400 text-xs">{e}</p>
      ))}
    </div>
  );
}

interface Props {
  definitions: Record<string, CardDefinition>;
}

export default function ComparisonView({ definitions }: Props) {
  const [text1, setText1] = useState(SAMPLE);
  const [text2, setText2] = useState(SAMPLE);
  const [selectedBot, setSelectedBot] = useState("greedy");
  const [iterations, setIterations] = useState(200);
  const [running, setRunning] = useState(false);
  const [matchup, setMatchup] = useState<MatchupStats | null>(null);

  function parseDeck(text: string): { entries: DeckEntry[]; errors: string[] } {
    return parseDecklist(text, CARD_DEFINITIONS);
  }

  const parsed1 = parseDeck(text1);
  const parsed2 = parseDeck(text2);
  const canRun = parsed1.entries.length > 0 && parsed2.entries.length > 0;

  const run = useCallback(() => {
    const botOpt = BOT_OPTIONS.find((b) => b.id === selectedBot)!;
    setRunning(true);
    setMatchup(null);
    setTimeout(() => {
      try {
        const bot = botOpt.bot();
        const results = runSimulation({
          player1Deck: parsed1.entries,
          player2Deck: parsed2.entries,
          player1Strategy: bot,
          player2Strategy: bot,
          definitions,
          iterations,
        });
        setMatchup(compareDecks(results));
      } finally {
        setRunning(false);
      }
    }, 10);
  }, [parsed1.entries, parsed2.entries, selectedBot, iterations, definitions]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Compare Decks</h1>

      {/* Deck inputs */}
      <div className="flex gap-4 flex-col sm:flex-row">
        <DeckTextArea
          label="Deck 1 (P1)"
          value={text1}
          onChange={setText1}
          errors={parsed1.errors}
          cardCount={parsed1.entries.reduce((s, e) => s + e.count, 0)}
        />
        <DeckTextArea
          label="Deck 2 (P2)"
          value={text2}
          onChange={setText2}
          errors={parsed2.errors}
          cardCount={parsed2.entries.reduce((s, e) => s + e.count, 0)}
        />
      </div>

      {/* Bot + iterations */}
      <div className="card space-y-4">
        <div>
          <p className="label">Bot</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {BOT_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBot(b.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  selectedBot === b.id
                    ? "bg-amber-500 text-gray-950 font-bold"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">Iterations</p>
          <div className="flex gap-2 mt-2">
            {[100, 200, 500].map((n) => (
              <button
                key={n}
                onClick={() => setIterations(n)}
                className={`px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                  iterations === n
                    ? "bg-amber-500 text-gray-950 font-bold"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn-primary w-full"
          onClick={run}
          disabled={running || !canRun}
        >
          {running ? "Running…" : `Run ${iterations} games`}
        </button>
      </div>

      {running && (
        <div className="card flex items-center justify-center gap-3 py-8 text-gray-400">
          <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          Simulating…
        </div>
      )}

      {matchup && !running && (
        <div className="card space-y-5">
          <p className="label">{matchup.gamesPlayed} games — {matchup.botLabel}</p>

          {/* Side-by-side win rate bars */}
          {(
            [
              { label: "Deck 1 Win Rate", value: matchup.deck1WinRate, color: "bg-amber-500" },
              { label: "Deck 2 Win Rate", value: matchup.deck2WinRate, color: "bg-blue-500" },
              { label: "Draw Rate", value: matchup.drawRate, color: "bg-gray-600" },
            ] as const
          ).map(({ label, value, color }) => (
            <div key={label}>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{label}</span>
                <span className="font-mono font-bold text-gray-200">{pct(value)}</span>
              </div>
              <div className="bg-gray-800 rounded-full h-4 overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${value * 100}%` }} />
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-800">
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">{pct(matchup.deck1WinRate)}</div>
              <div className="text-xs text-gray-500">Deck 1</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{pct(matchup.deck2WinRate)}</div>
              <div className="text-xs text-gray-500">Deck 2</div>
            </div>
          </div>

          <div className="text-center text-sm text-gray-500">
            Avg game length: {matchup.avgGameLength.toFixed(1)} turns
          </div>
        </div>
      )}
    </div>
  );
}
