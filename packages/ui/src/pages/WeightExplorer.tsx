import React, { useState, useCallback } from "react";
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
import {
  runSimulation,
  GreedyBot, ProbabilityBot,
  AggroWeights, ControlWeights, MidrangeWeights, RushWeights,
} from "@lorcana-sim/simulator";
import type { BotStrategy, BotWeights } from "@lorcana-sim/simulator";
import { aggregateResults, analyzeWeightSensitivity } from "@lorcana-sim/analytics";

const STATIC_WEIGHTS: { key: keyof Pick<BotWeights, "loreAdvantage" | "boardAdvantage" | "handAdvantage" | "inkAdvantage" | "deckQuality">; label: string; description: string }[] = [
  { key: "loreAdvantage", label: "Lore Advantage", description: "How much to value your lore lead" },
  { key: "boardAdvantage", label: "Board Advantage", description: "How much to value character count" },
  { key: "handAdvantage", label: "Hand Advantage", description: "How much to value cards in hand" },
  { key: "inkAdvantage", label: "Ink Advantage", description: "How much to value available ink" },
  { key: "deckQuality", label: "Deck Quality", description: "How much to value remaining draws" },
];

const OPPONENTS: { id: string; label: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", bot: () => GreedyBot },
  { id: "aggro", label: "Aggro", bot: () => ProbabilityBot(AggroWeights) },
  { id: "control", label: "Control", bot: () => ProbabilityBot(ControlWeights) },
  { id: "midrange", label: "Midrange", bot: () => ProbabilityBot(MidrangeWeights) },
  { id: "rush", label: "Rush", bot: () => ProbabilityBot(RushWeights) },
];

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

interface Props {
  deck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
}

export default function WeightExplorer({ deck, definitions }: Props) {
  const [weights, setWeights] = useState<Record<string, number>>({
    loreAdvantage: 0.5,
    boardAdvantage: 0.5,
    handAdvantage: 0.3,
    inkAdvantage: 0.3,
    deckQuality: 0.4,
  });
  const [opponent, setOpponent] = useState("greedy");
  const [iterations, setIterations] = useState(100);
  const [running, setRunning] = useState(false);
  const [winRate, setWinRate] = useState<number | null>(null);
  const [sweep, setSweep] = useState<{ label: string; value: number }[] | null>(null);

  const buildWeights = (): BotWeights => ({
    loreAdvantage: weights["loreAdvantage"] ?? 0.5,
    boardAdvantage: weights["boardAdvantage"] ?? 0.5,
    handAdvantage: weights["handAdvantage"] ?? 0.3,
    inkAdvantage: weights["inkAdvantage"] ?? 0.3,
    deckQuality: weights["deckQuality"] ?? 0.4,
    urgency: MidrangeWeights.urgency,
    threatLevel: MidrangeWeights.threatLevel,
  });

  const run = useCallback(() => {
    const oppOpt = OPPONENTS.find((o) => o.id === opponent)!;
    setRunning(true);
    setWinRate(null);
    setSweep(null);
    setTimeout(() => {
      try {
        const customBot = ProbabilityBot(buildWeights());
        const oppBot = oppOpt.bot();

        // Run custom weights
        const results = runSimulation({
          player1Deck: deck,
          player2Deck: deck,
          player1Strategy: customBot,
          player2Strategy: oppBot,
          definitions,
          iterations,
        });
        const stats = aggregateResults(results);
        setWinRate(stats.winRate);

        // Compare against named presets for context
        const presets = [
          { label: "Aggro", weights: AggroWeights },
          { label: "Control", weights: ControlWeights },
          { label: "Midrange", weights: MidrangeWeights },
          { label: "Rush", weights: RushWeights },
        ];
        const sweepResults = presets.map(({ label, weights: w }) => {
          const r = runSimulation({
            player1Deck: deck,
            player2Deck: deck,
            player1Strategy: ProbabilityBot(w),
            player2Strategy: oppBot,
            definitions,
            iterations: Math.max(50, Math.floor(iterations / 2)),
          });
          return { label, value: aggregateResults(r).winRate };
        });
        setSweep([{ label: "Custom", value: stats.winRate }, ...sweepResults]);
      } finally {
        setRunning(false);
      }
    }, 10);
  }, [deck, definitions, opponent, iterations, weights]);

  function loadPreset(presetWeights: BotWeights) {
    setWeights({
      loreAdvantage: presetWeights.loreAdvantage,
      boardAdvantage: presetWeights.boardAdvantage,
      handAdvantage: presetWeights.handAdvantage,
      inkAdvantage: presetWeights.inkAdvantage,
      deckQuality: presetWeights.deckQuality,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Weight Explorer</h1>
        <p className="text-gray-500 text-sm mt-1">
          Tune the 5 static weights and see how they affect win rate against different opponents.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sliders */}
        <div className="card space-y-5">
          <div className="flex items-center justify-between">
            <p className="label">Static Weights</p>
            <div className="flex gap-1">
              {[
                { label: "A", w: AggroWeights },
                { label: "C", w: ControlWeights },
                { label: "M", w: MidrangeWeights },
                { label: "R", w: RushWeights },
              ].map(({ label, w }) => (
                <button
                  key={label}
                  onClick={() => loadPreset(w)}
                  className="w-7 h-7 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-amber-400 transition-colors"
                  title={`Load ${label === "A" ? "Aggro" : label === "C" ? "Control" : label === "M" ? "Midrange" : "Rush"} preset`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {STATIC_WEIGHTS.map(({ key, label, description }) => (
            <div key={key}>
              <div className="flex justify-between mb-1">
                <div>
                  <span className="text-sm text-gray-300 font-medium">{label}</span>
                  <span className="text-xs text-gray-500 ml-2">{description}</span>
                </div>
                <span className="text-sm font-mono font-bold text-amber-400">
                  {(weights[key] ?? 0).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weights[key] ?? 0}
                onChange={(e) =>
                  setWeights((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))
                }
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-amber-500 bg-gray-700"
              />
            </div>
          ))}
        </div>

        {/* Config + results */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <div>
              <p className="label">Opponent</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {OPPONENTS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setOpponent(o.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      opponent === o.id
                        ? "bg-amber-500 text-gray-950 font-bold"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Iterations</p>
              <div className="flex gap-2 mt-2">
                {[50, 100, 200].map((n) => (
                  <button
                    key={n}
                    onClick={() => setIterations(n)}
                    className={`px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
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
              disabled={running}
            >
              {running ? "Running…" : "Run"}
            </button>
          </div>

          {running && (
            <div className="card flex items-center justify-center gap-3 py-6 text-gray-400">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              Simulating…
            </div>
          )}

          {winRate !== null && !running && (
            <div className="card text-center">
              <div className="text-5xl font-bold text-amber-400">{pct(winRate)}</div>
              <div className="text-sm text-gray-500 mt-1">Custom weights vs {opponent}</div>
            </div>
          )}

          {sweep && !running && (
            <div className="card space-y-3">
              <p className="label">vs Presets</p>
              {sweep.map(({ label, value }) => (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={label === "Custom" ? "text-amber-400 font-bold" : "text-gray-400"}>
                      {label}
                    </span>
                    <span className="font-mono text-gray-200">{pct(value)}</span>
                  </div>
                  <div className="bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        label === "Custom" ? "bg-amber-500" : "bg-blue-600/60"
                      }`}
                      style={{ width: `${value * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
