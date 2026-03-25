import React, { useState, useCallback } from "react";
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
import {
  runSimulation,
  RandomBot, GreedyBot, ProbabilityBot,
  AggroWeights, ControlWeights, MidrangeWeights, RushWeights,
} from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";
import { aggregateResults } from "@lorcana-sim/analytics";
import type { DeckStats } from "@lorcana-sim/analytics";

const BOT_OPTIONS: { id: string; label: string; description: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", description: "Simple heuristics — good baseline", bot: () => GreedyBot },
  { id: "aggro", label: "Aggro", description: "Race to 20 lore", bot: () => ProbabilityBot(AggroWeights) },
  { id: "control", label: "Control", description: "Board + hand advantage", bot: () => ProbabilityBot(ControlWeights) },
  { id: "midrange", label: "Midrange", description: "Balanced weighted play", bot: () => ProbabilityBot(MidrangeWeights) },
  { id: "rush", label: "Rush", description: "Cheap, fast, aggressive", bot: () => ProbabilityBot(RushWeights) },
  { id: "random", label: "Random", description: "Stress test baseline", bot: () => RandomBot },
];

const ITERATION_OPTIONS = [100, 200, 500, 1000];

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

function WinRateBar({ value, color = "bg-amber-500" }: { value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className="text-sm font-mono font-bold text-amber-400 w-14 text-right">{pct(value)}</span>
    </div>
  );
}

interface Props {
  deck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
}

export default function SimulationView({ deck, definitions }: Props) {
  const [selectedBot, setSelectedBot] = useState("greedy");
  const [iterations, setIterations] = useState(200);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<DeckStats | null>(null);

  const runSim = useCallback(() => {
    const botOpt = BOT_OPTIONS.find((b) => b.id === selectedBot);
    if (!botOpt) return;
    setRunning(true);
    setStats(null);

    // Yield to render the spinner before blocking the thread
    setTimeout(() => {
      try {
        const bot = botOpt.bot();
        const results = runSimulation({
          player1Deck: deck,
          player2Deck: deck,
          player1Strategy: bot,
          player2Strategy: bot,
          definitions,
          iterations,
        });
        setStats(aggregateResults(results));
      } finally {
        setRunning(false);
      }
    }, 10);
  }, [deck, definitions, selectedBot, iterations]);

  const topCards = stats
    ? Object.values(stats.cardPerformance)
        .sort((a, b) => b.avgLoreContributed - a.avgLoreContributed)
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Simulate</h1>

      {/* Config */}
      <div className="card space-y-5">
        <div>
          <p className="label">Bot Strategy</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            {BOT_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBot(b.id)}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  selectedBot === b.id
                    ? "border-amber-500 bg-amber-900/20 text-amber-400"
                    : "border-gray-700 hover:border-gray-600 text-gray-300"
                }`}
              >
                <div className="font-medium text-sm">{b.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{b.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="label">Iterations</p>
          <div className="flex gap-2 mt-2">
            {ITERATION_OPTIONS.map((n) => (
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
          onClick={runSim}
          disabled={running}
        >
          {running ? "Running…" : `Run ${iterations} games`}
        </button>
      </div>

      {/* Loading */}
      {running && (
        <div className="card flex items-center justify-center gap-3 py-12 text-gray-400">
          <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          Simulating {iterations} games…
        </div>
      )}

      {/* Results */}
      {stats && !running && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card text-center">
              <div className="stat-value">{pct(stats.winRate)}</div>
              <div className="stat-label">Win rate (P1)</div>
            </div>
            <div className="card text-center">
              <div className={`stat-value ${stats.drawRate > 0.02 ? "text-red-400" : ""}`}>
                {pct(stats.drawRate)}
              </div>
              <div className="stat-label">Draw rate{stats.drawRate > 0.02 ? " ⚠" : ""}</div>
            </div>
            <div className="card text-center">
              <div className="stat-value">{stats.avgGameLength.toFixed(1)}</div>
              <div className="stat-label">Avg turns</div>
            </div>
            <div className="card text-center">
              <div className="stat-value">{pct(stats.firstPlayerWinRate)}</div>
              <div className="stat-label">First-player WR</div>
            </div>
          </div>

          {/* Win rate bar */}
          <div className="card space-y-3">
            <p className="label">Bot: {stats.botLabel} — {stats.gamesPlayed} games</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>P1 Win rate</span>
                <span>Mirror match</span>
              </div>
              <WinRateBar value={stats.winRate} />
              {stats.firstPlayerWinRate !== stats.winRate && (
                <>
                  <div className="text-xs text-gray-500">First-player win rate</div>
                  <WinRateBar value={stats.firstPlayerWinRate} color="bg-blue-500" />
                </>
              )}
            </div>
          </div>

          {/* Card performance */}
          {topCards.length > 0 && (
            <div className="card">
              <p className="label mb-3">Card Performance (by avg lore/game)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                      <th className="pb-2 font-medium">Card</th>
                      <th className="pb-2 font-medium text-right">Avg lore</th>
                      <th className="pb-2 font-medium text-right">Banish rate</th>
                      <th className="pb-2 font-medium text-right">WR when drawn</th>
                      <th className="pb-2 font-medium text-right">WR delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCards.map((c) => {
                      const delta = c.winRateWhenDrawn - c.winRateWhenNotDrawn;
                      return (
                        <tr key={c.definitionId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="py-2 text-gray-300 font-mono text-xs">{c.definitionId}</td>
                          <td className="py-2 text-right text-amber-400 font-mono">{c.avgLoreContributed.toFixed(2)}</td>
                          <td className="py-2 text-right text-gray-400 font-mono">{pct(c.banishRate)}</td>
                          <td className="py-2 text-right text-gray-400 font-mono">{pct(c.winRateWhenDrawn)}</td>
                          <td className={`py-2 text-right font-mono font-bold ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {delta >= 0 ? "+" : ""}{pct(delta)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
