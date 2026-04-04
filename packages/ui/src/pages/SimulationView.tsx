import React, { useState, useCallback, useMemo } from "react";
import { LORCAST_CARD_DEFINITIONS, parseDecklist } from "@lorcana-sim/engine";
import { runSimulation, RandomBot, GreedyBot } from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";
import { aggregateResults, compareDecks } from "@lorcana-sim/analytics";
import type { DeckStats, MatchupStats } from "@lorcana-sim/analytics";

const BOT_OPTIONS: { id: string; label: string; description: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", description: "Simple heuristics — good baseline", bot: () => GreedyBot },
  { id: "random", label: "Random", description: "Stress test baseline", bot: () => RandomBot },
];

const ITERATION_OPTIONS = [100, 200, 500, 1000];

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

function pct(n: number) { return (n * 100).toFixed(1) + "%"; }

function WinRateBar({ value, color = "bg-amber-500", label }: { value: number; color?: string; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <div className="text-xs text-gray-500">{label}</div>}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
          <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${value * 100}%` }} />
        </div>
        <span className="text-sm font-mono font-bold text-amber-400 w-14 text-right">{pct(value)}</span>
      </div>
    </div>
  );
}

function DeckField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { errors, entries } = useMemo(() => parseDecklist(value, LORCAST_CARD_DEFINITIONS), [value]);
  const count = entries.reduce((s, e) => s + e.count, 0);
  return (
    <div className="flex-1 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {count > 0 && errors.length === 0 && <span className="text-xs text-green-400">{count} cards ✓</span>}
      </div>
      <textarea
        className="w-full h-40 bg-gray-950 border border-gray-700 rounded-lg p-3 text-xs font-mono
                   text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
        placeholder="4 Card Name..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {errors.map((e, i) => <p key={i} className="text-red-400 text-xs">{e}</p>)}
    </div>
  );
}

export default function SimulationView() {
  const [mode, setMode] = useState<"mirror" | "matchup">("mirror");
  const [deck1Text, setDeck1Text] = useState(SAMPLE);
  const [deck2Text, setDeck2Text] = useState(SAMPLE);
  const [selectedBot, setSelectedBot] = useState("greedy");
  const [iterations, setIterations] = useState(200);
  const [running, setRunning] = useState(false);
  const [mirrorStats, setMirrorStats] = useState<DeckStats | null>(null);
  const [matchupStats, setMatchupStats] = useState<MatchupStats | null>(null);

  const parsed1 = useMemo(() => parseDecklist(deck1Text, LORCAST_CARD_DEFINITIONS), [deck1Text]);
  const parsed2 = useMemo(() => parseDecklist(deck2Text, LORCAST_CARD_DEFINITIONS), [deck2Text]);

  const canRun = parsed1.entries.length > 0 && parsed1.errors.length === 0 &&
    (mode === "mirror" || (parsed2.entries.length > 0 && parsed2.errors.length === 0));

  const run = useCallback(() => {
    const botOpt = BOT_OPTIONS.find((b) => b.id === selectedBot)!;
    setRunning(true);
    setMirrorStats(null);
    setMatchupStats(null);
    // TODO: move to a Web Worker to avoid blocking the main thread on large
    // iteration counts. Requires serializing LORCAST_CARD_DEFINITIONS (~2MB)
    // and posting results back via postMessage.
    setTimeout(() => {
      try {
        const bot = botOpt.bot();
        const p2Deck = mode === "mirror" ? parsed1.entries : parsed2.entries;
        const results = runSimulation({
          player1Deck: parsed1.entries,
          player2Deck: p2Deck,
          player1Strategy: bot,
          player2Strategy: bot,
          definitions: LORCAST_CARD_DEFINITIONS,
          iterations,
        });
        if (mode === "mirror") {
          setMirrorStats(aggregateResults(results));
        } else {
          setMatchupStats(compareDecks(results));
        }
      } finally {
        setRunning(false);
      }
    }, 10);
  }, [parsed1.entries, parsed2.entries, mode, selectedBot, iterations]);

  const topCards = mirrorStats
    ? Object.values(mirrorStats.cardPerformance)
        .sort((a, b) => b.avgLoreContributed - a.avgLoreContributed)
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Simulate</h1>

      {/* Mode toggle */}
      <div className="flex rounded-lg bg-gray-800 p-0.5 w-fit">
        {(["mirror", "matchup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setMirrorStats(null); setMatchupStats(null); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === m ? "bg-gray-700 text-gray-100 shadow-sm" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {m === "mirror" ? "Mirror match" : "Head-to-head"}
          </button>
        ))}
      </div>

      {/* Deck inputs */}
      {mode === "mirror" ? (
        <DeckField label="Deck" value={deck1Text} onChange={setDeck1Text} />
      ) : (
        <div className="flex gap-4 flex-col sm:flex-row">
          <DeckField label="Deck 1 (P1)" value={deck1Text} onChange={setDeck1Text} />
          <DeckField label="Deck 2 (P2)" value={deck2Text} onChange={setDeck2Text} />
        </div>
      )}

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
        <button className="btn-primary w-full" onClick={run} disabled={running || !canRun}>
          {running ? "Running…" : `Run ${iterations} games`}
        </button>
      </div>

      {running && (
        <div className="card flex items-center justify-center gap-3 py-12 text-gray-400">
          <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          Simulating {iterations} games…
        </div>
      )}

      {/* Mirror results */}
      {mirrorStats && !running && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card text-center">
              <div className="stat-value">{pct(mirrorStats.winRate)}</div>
              <div className="stat-label">Win rate (P1)</div>
            </div>
            <div className="card text-center">
              <div className={`stat-value ${mirrorStats.drawRate > 0.02 ? "text-red-400" : ""}`}>
                {pct(mirrorStats.drawRate)}
              </div>
              <div className="stat-label">Draw rate{mirrorStats.drawRate > 0.02 ? " ⚠" : ""}</div>
            </div>
            <div className="card text-center">
              <div className="stat-value">{mirrorStats.avgGameLength.toFixed(1)}</div>
              <div className="stat-label">Avg turns</div>
            </div>
            <div className="card text-center">
              <div className="stat-value">{pct(mirrorStats.firstPlayerWinRate)}</div>
              <div className="stat-label">First-player WR</div>
            </div>
          </div>
          <div className="card space-y-3">
            <p className="label">Bot: {mirrorStats.botLabel} — {mirrorStats.gamesPlayed} games</p>
            <WinRateBar value={mirrorStats.winRate} label="P1 win rate" />
            {mirrorStats.firstPlayerWinRate !== mirrorStats.winRate && (
              <WinRateBar value={mirrorStats.firstPlayerWinRate} color="bg-blue-500" label="First-player win rate" />
            )}
          </div>
          {topCards.length > 0 && (
            <div className="card">
              <p className="label mb-3">Card Performance (avg lore/game)</p>
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

      {/* Matchup results */}
      {matchupStats && !running && (
        <div className="card space-y-5">
          <p className="label">{matchupStats.gamesPlayed} games — {matchupStats.botLabel}</p>
          <WinRateBar value={matchupStats.deck1WinRate} color="bg-amber-500" label="Deck 1 win rate" />
          <WinRateBar value={matchupStats.deck2WinRate} color="bg-blue-500" label="Deck 2 win rate" />
          <WinRateBar value={matchupStats.drawRate} color="bg-gray-600" label="Draw rate" />
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-800">
            {(["deck1", "deck2"] as const).map((dk, i) => {
              const s = matchupStats[`${dk}Stats` as "deck1Stats" | "deck2Stats"];
              return (
                <div key={dk}>
                  <p className="label text-xs mb-2">Deck {i + 1}</p>
                  <div className="space-y-1 text-xs text-gray-400">
                    <div className="flex justify-between"><span>Avg turns to win</span><span className="font-mono text-gray-200">{s.avgTurnsToWin.toFixed(1)}</span></div>
                    <div className="flex justify-between"><span>Avg lore/turn</span><span className="font-mono text-gray-200">{s.avgLorePerTurn.toFixed(2)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
