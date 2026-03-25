import React, { useMemo } from "react";
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
import { analyzeDeckComposition } from "@lorcana-sim/analytics";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const INK_COLORS: Record<string, string> = {
  amber: "#f59e0b",
  amethyst: "#a855f7",
  emerald: "#10b981",
  ruby: "#ef4444",
  sapphire: "#3b82f6",
  steel: "#94a3b8",
};

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

interface Props {
  deck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
}

export default function CompositionView({ deck, definitions }: Props) {
  const comp = useMemo(
    () => analyzeDeckComposition(deck, definitions),
    [deck, definitions]
  );

  const costData = Object.entries(comp.costCurve)
    .map(([cost, count]) => ({ cost: Number(cost), count }))
    .sort((a, b) => a.cost - b.cost);

  const colorData = Object.entries(comp.colorBreakdown)
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count);

  const inkCurveData = [
    { turn: "T1", prob: comp.inkCurveProb.turn1 },
    { turn: "T2", prob: comp.inkCurveProb.turn2 },
    { turn: "T3", prob: comp.inkCurveProb.turn3 },
    { turn: "T4", prob: comp.inkCurveProb.turn4 },
  ];

  const keywords = Object.entries(comp.keywordCounts).sort((a, b) => b[1] - a[1]);
  const cardTypes = Object.entries(comp.cardTypeBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Deck Composition</h1>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card text-center">
          <div className="stat-value">{comp.totalCards}</div>
          <div className="stat-label">Total cards</div>
        </div>
        <div className="card text-center">
          <div className="stat-value">{comp.avgCost.toFixed(2)}</div>
          <div className="stat-label">Avg cost</div>
        </div>
        <div className="card text-center">
          <div className="stat-value">{pct(comp.inkablePercent)}</div>
          <div className="stat-label">Inkable</div>
        </div>
        <div className="card text-center">
          <div className="stat-value">{Object.keys(comp.colorBreakdown).length}</div>
          <div className="stat-label">Ink colors</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost curve */}
        <div className="card">
          <p className="label">Cost Curve</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={costData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="cost" tick={{ fill: "#9ca3af", fontSize: 12 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                labelStyle={{ color: "#f3f4f6" }}
                itemStyle={{ color: "#f59e0b" }}
                formatter={(v) => [v, "cards"]}
                labelFormatter={(l) => `Cost ${l}`}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {costData.map((_, i) => (
                  <Cell key={i} fill="#f59e0b" fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ink colors */}
        <div className="card">
          <p className="label">Ink Colors</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={colorData} layout="vertical" margin={{ top: 4, right: 4, bottom: 0, left: 20 }}>
              <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis dataKey="color" type="category" tick={{ fill: "#9ca3af", fontSize: 12 }} width={72} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                labelStyle={{ color: "#f3f4f6" }}
                formatter={(v) => [v, "cards"]}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {colorData.map((d, i) => (
                  <Cell key={i} fill={INK_COLORS[d.color] ?? "#94a3b8"} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ink curve probability */}
        <div className="card">
          <p className="label">P(≥1 Inkable Drawn by Turn)</p>
          <div className="space-y-3 mt-2">
            {inkCurveData.map(({ turn, prob }) => (
              <div key={turn} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-6">{turn}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all"
                    style={{ width: `${prob * 100}%` }}
                  />
                </div>
                <span className="text-sm font-mono text-amber-400 w-12 text-right">{pct(prob)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card types + keywords */}
        <div className="card space-y-4">
          <div>
            <p className="label">Card Types</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {cardTypes.map(([type, count]) => (
                <span key={type} className="bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded-full">
                  {type} ×{count}
                </span>
              ))}
            </div>
          </div>
          {keywords.length > 0 && (
            <div>
              <p className="label">Keywords</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {keywords.map(([kw, count]) => (
                  <span key={kw} className="bg-amber-900/40 border border-amber-800/50 text-amber-300 text-xs px-2 py-1 rounded-full">
                    {kw} ×{count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
