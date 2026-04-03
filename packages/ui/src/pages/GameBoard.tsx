// =============================================================================
// GameBoard — Visual game board with card components and analysis overlay
// Human plays P1, bot plays P2. Uses useGameSession + useAnalysis hooks.
// =============================================================================

import React, { useState, useMemo, useRef, useEffect } from "react";
import type { CardDefinition, DeckEntry, PlayerID } from "@lorcana-sim/engine";
import { parseDecklist } from "@lorcana-sim/engine";
import {
  GreedyBot,
  RandomBot,
  RLPolicy,
} from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";
import { useGameSession } from "../hooks/useGameSession.js";
import { useAnalysis } from "../hooks/useAnalysis.js";
import { formatAction } from "../utils/formatAction.js";
import AnalysisPanel from "../components/AnalysisPanel.js";
import GameCard from "../components/GameCard.js";

// -----------------------------------------------------------------------------
// Bot options
// -----------------------------------------------------------------------------

const BOT_OPTIONS: { id: string; label: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", bot: () => GreedyBot },
  { id: "random", label: "Random", bot: () => RandomBot },
];

const SAMPLE_DECK = `4 Elsa - Snow Queen
4 Stitch - Rock Star
4 Rapunzel - Gifted with Healing
4 Pascal - Rapunzel's Companion
4 Hades - King of Olympus
4 Maleficent - Monstrous Dragon
4 Mickey Mouse - Brave Little Tailor
4 Cinderella - Ballroom Sensation
4 Aladdin - Heroic Outlaw
4 Simba - Returned King
4 Belle - Strange but Special
4 Moana - Of Motunui
4 Te Ka - Heartless
4 Dragon Fire
4 Be Prepared`;

interface Props {
  definitions: Record<string, CardDefinition>;
  multiplayerGame?: {
    gameId: string;
    myPlayerId: "player1" | "player2";
    token: string;
  };
}

// --- Lore tracker: visual pips ---
function LoreTracker({ lore, label, color }: { lore: number; label: string; color: "green" | "red" }) {
  const filled = Math.min(lore, 20);
  const colorClass = color === "green" ? "bg-green-500" : "bg-red-500";
  const dimClass = color === "green" ? "bg-green-900/40" : "bg-red-900/40";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-bold ${color === "green" ? "text-green-400" : "text-red-400"} w-6`}>
        {label}
      </span>
      <div className="flex gap-[2px]">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className={`w-[8px] h-3 rounded-[2px] transition-colors duration-200 ${
              i < filled ? colorClass : dimClass
            }`}
          />
        ))}
      </div>
      <span className={`text-xs font-mono font-bold ${color === "green" ? "text-green-300" : "text-red-300"} w-6 text-right`}>
        {lore}
      </span>
    </div>
  );
}

// --- Ink display: filled/total pips ---
function InkDisplay({ available, total }: { available: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-blue-400 uppercase tracking-wider font-bold">Ink</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full border transition-colors ${
              i < available
                ? "bg-blue-400 border-blue-300 shadow-sm shadow-blue-400/30"
                : "bg-blue-950 border-blue-800"
            }`}
          />
        ))}
      </div>
      <span className="text-[10px] text-blue-300 font-mono">{available}/{total}</span>
    </div>
  );
}

export default function GameBoard({ definitions, multiplayerGame }: Props) {
  const session = useGameSession();

  const [p1DeckText, setP1DeckText] = useState(SAMPLE_DECK);
  const [p2DeckText, setP2DeckText] = useState(SAMPLE_DECK);
  const [botId, setBotId] = useState("greedy");
  const [rlPolicy, setRlPolicy] = useState<BotStrategy | null>(null);
  const [rlPolicyName, setRlPolicyName] = useState<string | null>(null);
  const [multiSelectTargets, setMultiSelectTargets] = useState<string[]>([]);

  const p1Parse = useMemo(() => parseDecklist(p1DeckText, definitions), [p1DeckText, definitions]);
  const p2Parse = useMemo(() => parseDecklist(p2DeckText, definitions), [p2DeckText, definitions]);

  const analysis = useAnalysis(session.gameState, definitions, p1Parse.entries, p2Parse.entries, rlPolicy ?? GreedyBot);

  function handlePolicyUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const policy = RLPolicy.fromJSON(json);
        policy.epsilon = 0;
        setRlPolicy(policy);
        setRlPolicyName(file.name);
      } catch {
        setRlPolicy(null);
        setRlPolicyName(null);
      }
    };
    reader.readAsText(file);
  }

  const canStart =
    p1Parse.entries.length > 0 &&
    p2Parse.entries.length > 0 &&
    p1Parse.errors.length === 0 &&
    p2Parse.errors.length === 0;

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [session.actionLog.length]);

  // Auto-start when entering multiplayer mode — state arrives via Realtime
  useEffect(() => {
    if (!multiplayerGame) return;
    session.startGame({
      player1Deck: [],
      player2Deck: [],
      definitions,
      botStrategy: GreedyBot,
      player1IsHuman: multiplayerGame.myPlayerId === "player1",
      player2IsHuman: multiplayerGame.myPlayerId === "player2",
      multiplayer: multiplayerGame,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerGame]);

  function handleStart() {
    const botOption = BOT_OPTIONS.find((b) => b.id === botId) ?? BOT_OPTIONS[0]!;
    session.startGame({
      player1Deck: p1Parse.entries,
      player2Deck: p2Parse.entries,
      definitions,
      botStrategy: botOption.bot(),
      player1IsHuman: true,
      player2IsHuman: false,
    });
  }

  const getCardName = (instanceId: string): string => {
    if (!session.gameState) return "Unknown";
    const instance = session.gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  };

  // =========================================================================
  // SETUP MODE
  // =========================================================================
  if (!session.gameState) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-amber-400">Play</h2>
        <p className="text-gray-400 text-sm">
          Play a visual game against a bot. Enter decklists below (or use the sample deck).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Player 1 Deck (You)
            </label>
            <textarea
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              value={p1DeckText}
              onChange={(e) => setP1DeckText(e.target.value)}
              placeholder="4 Card Name&#10;4 Other Card..."
            />
            {p1Parse.errors.length > 0 && (
              <div className="mt-1 text-red-400 text-xs space-y-0.5">
                {p1Parse.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {p1Parse.entries.length > 0 && p1Parse.errors.length === 0 && (
              <div className="mt-1 text-green-400 text-xs">
                {p1Parse.entries.reduce((s, e) => s + e.count, 0)} cards parsed
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Player 2 Deck (Bot)
            </label>
            <textarea
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              value={p2DeckText}
              onChange={(e) => setP2DeckText(e.target.value)}
              placeholder="4 Card Name&#10;4 Other Card..."
            />
            {p2Parse.errors.length > 0 && (
              <div className="mt-1 text-red-400 text-xs space-y-0.5">
                {p2Parse.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {p2Parse.entries.length > 0 && p2Parse.errors.length === 0 && (
              <div className="mt-1 text-green-400 text-xs">
                {p2Parse.entries.reduce((s, e) => s + e.count, 0)} cards parsed
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-300">Bot:</label>
          <select
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-amber-500 focus:outline-none"
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
          >
            {BOT_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-300">Analysis policy:</label>
          <label className="cursor-pointer px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 hover:border-amber-500 transition-colors">
            {rlPolicyName ?? "Upload .json"}
            <input type="file" accept=".json" className="hidden" onChange={handlePolicyUpload} />
          </label>
          {rlPolicy && (
            <span className="text-green-400 text-xs">RL estimate active</span>
          )}
        </div>

        <button
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-medium transition-colors"
          disabled={!canStart}
          onClick={handleStart}
        >
          Start Game
        </button>
      </div>
    );
  }

  // =========================================================================
  // PLAYING MODE
  // =========================================================================

  const { gameState, legalActions, pendingChoice, actionLog, isGameOver, winner, error } = session;

  const myId = multiplayerGame?.myPlayerId ?? "player1";
  const opponentId = myId === "player1" ? "player2" : "player1";

  const p1 = gameState.players[myId];
  const p2 = gameState.players[opponentId];
  const p1Zones = gameState.zones[myId];
  const p2Zones = gameState.zones[opponentId];

  const recentLog = actionLog.slice(-30);
  const isYourTurn = gameState.currentPlayer === myId;

  // --- Pending choice UI ---
  function renderPendingChoice() {
    if (!pendingChoice) return null;
    const isHumanChoice = pendingChoice.choosingPlayerId === myId;
    if (!isHumanChoice) {
      return (
        <div className="rounded-lg px-4 py-3 bg-yellow-950/40 border border-yellow-700/50 backdrop-blur">
          <span className="text-yellow-400 text-sm animate-pulse">Bot is thinking...</span>
        </div>
      );
    }

    const needsMultiSelect =
      pendingChoice.type === "choose_cards" ||
      pendingChoice.type === "choose_discard" ||
      pendingChoice.type === "choose_from_revealed";

    if (needsMultiSelect) {
      const requiredCount = pendingChoice.count ?? 1;
      return (
        <div className="rounded-lg px-4 py-3 bg-yellow-950/40 border border-yellow-700/50 space-y-2">
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Select {requiredCount} card(s)</div>
          <div className="flex flex-wrap gap-1.5">
            {(pendingChoice.validTargets ?? []).map((id) => {
              const selected = multiSelectTargets.includes(id);
              return (
                <button
                  key={id}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    selected
                      ? "border-amber-400 bg-amber-900/50 text-amber-200 shadow-sm shadow-amber-500/20"
                      : "border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-400 hover:bg-gray-700/50"
                  }`}
                  onClick={() => {
                    setMultiSelectTargets((prev) =>
                      selected ? prev.filter((t) => t !== id) : [...prev, id],
                    );
                  }}
                >
                  {getCardName(id)}
                </button>
              );
            })}
          </div>
          <button
            className="px-4 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
            disabled={multiSelectTargets.length !== requiredCount}
            onClick={() => {
              session.resolveChoice(multiSelectTargets);
              setMultiSelectTargets([]);
            }}
          >
            Confirm ({multiSelectTargets.length}/{requiredCount})
          </button>
        </div>
      );
    }

    if (pendingChoice.type === "choose_may") {
      return (
        <div className="rounded-lg px-4 py-3 bg-yellow-950/40 border border-yellow-700/50 space-y-2">
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex gap-2">
            <button
              className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
              onClick={() => session.resolveChoice("accept")}
            >
              Accept
            </button>
            <button
              className="px-4 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
              onClick={() => session.resolveChoice("decline")}
            >
              Decline
            </button>
          </div>
        </div>
      );
    }

    if (pendingChoice.type === "choose_option" && pendingChoice.options) {
      return (
        <div className="rounded-lg px-4 py-3 bg-yellow-950/40 border border-yellow-700/50 space-y-2">
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex flex-wrap gap-2">
            {pendingChoice.options.map((_, i) => (
              <button
                key={i}
                className="px-4 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600 font-medium transition-colors"
                onClick={() => session.resolveChoice(i)}
              >
                Option {i + 1}
              </button>
            ))}
          </div>
        </div>
      );
    }

    const displayCards = pendingChoice.revealedCards ?? pendingChoice.validTargets ?? [];
    const validSet = new Set(pendingChoice.validTargets ?? []);

    return (
      <div className="rounded-lg px-4 py-3 bg-yellow-950/40 border border-yellow-700/50 space-y-2">
        <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
        <div className="flex flex-wrap gap-1.5">
          {displayCards.map((id) => {
            const selectable = validSet.has(id);
            return selectable ? (
              <button
                key={id}
                className="px-3 py-1.5 text-xs bg-gray-700/80 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600 transition-colors"
                onClick={() => session.resolveChoice([id])}
              >
                {getCardName(id)}
              </button>
            ) : (
              <span
                key={id}
                className="px-3 py-1.5 text-xs bg-gray-900/60 text-gray-600 rounded-lg border border-gray-800 line-through"
              >
                {getCardName(id)}
              </span>
            );
          })}
          {pendingChoice.optional && (
            <button
              className="px-3 py-1.5 text-xs bg-red-800/80 hover:bg-red-700 text-gray-200 rounded-lg border border-red-700 transition-colors"
              onClick={() => session.resolveChoice([])}
            >
              Skip
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 -mx-4 px-4">
      {/* ======================= Main game area ======================= */}
      <div className="min-w-0 space-y-0">

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="mb-4 rounded-xl p-6 text-center space-y-3 bg-gradient-to-b from-amber-900/30 to-amber-950/50 border border-amber-500/30">
            <div className="text-3xl font-black text-amber-400 tracking-tight">
              {winner === "player1" ? "Victory!" : winner === "player2" ? "Defeat" : "Draw"}
            </div>
            <div className="text-sm text-gray-400">
              {winner === "player1" ? "You won the game" : winner === "player2" ? "The bot won" : "The game ended in a draw"}
            </div>
            <button
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-amber-600/20"
              onClick={session.reset}
            >
              Play Again
            </button>
          </div>
        )}

        {/* ---- Scoreboard ---- */}
        <div className="rounded-xl bg-gray-900/60 border border-gray-800/50 p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1 rounded-lg text-xs font-bold tracking-wide ${
                isYourTurn
                  ? "bg-green-600/20 text-green-400 border border-green-500/30"
                  : "bg-red-600/20 text-red-400 border border-red-500/30"
              }`}>
                {isYourTurn ? "YOUR TURN" : multiplayerGame ? "OPPONENT'S TURN" : "BOT'S TURN"}
              </div>
              <span className="text-gray-500 text-xs">
                Turn {gameState.turnNumber}
              </span>
            </div>
            <button
              className="px-3 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300 rounded-lg transition-colors uppercase tracking-wider"
              onClick={session.reset}
            >
              Concede
            </button>
          </div>
          <div className="space-y-1">
            <LoreTracker lore={p1.lore} label="You" color="green" />
            <LoreTracker lore={p2.lore} label="Bot" color="red" />
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {/* ---- Opponent zone ---- */}
        <div className="rounded-xl bg-gradient-to-b from-red-950/10 to-transparent border border-gray-800/30 p-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-red-400/60 uppercase tracking-wider font-bold">Opponent</span>
            <div className="flex gap-3 text-[10px] text-gray-600">
              <span>Hand {p2Zones.hand.length}</span>
              <span>Deck {p2Zones.deck.length}</span>
            </div>
          </div>
          <InkDisplay available={p2.availableInk} total={p2Zones.inkwell.length} />
          <div className="mt-3 min-h-[110px] flex flex-wrap gap-3 items-end">
            {p2Zones.play.length === 0 ? (
              <span className="text-gray-700 text-xs italic">No cards in play</span>
            ) : (
              p2Zones.play.map((id) => (
                <GameCard
                  key={id}
                  instanceId={id}
                  gameState={gameState}
                  definitions={definitions}
                  isSelected={session.selectedInstanceId === id}
                  onClick={() => session.selectCard(session.selectedInstanceId === id ? null : id)}
                  zone="play"
                />
              ))
            )}
          </div>
        </div>

        {/* ---- Battlefield divider ---- */}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
          <span className="text-[9px] text-gray-700 uppercase tracking-widest">Battlefield</span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
        </div>

        {/* ---- Player zone ---- */}
        <div className="rounded-xl bg-gradient-to-t from-green-950/10 to-transparent border border-gray-800/30 p-3 mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-green-400/60 uppercase tracking-wider font-bold">Your Board</span>
            <span className="text-[10px] text-gray-600">Deck {p1Zones.deck.length}</span>
          </div>
          <InkDisplay available={p1.availableInk} total={p1Zones.inkwell.length} />
          <div className="mt-3 min-h-[110px] flex flex-wrap gap-3 items-start">
            {p1Zones.play.length === 0 ? (
              <span className="text-gray-700 text-xs italic">No cards in play</span>
            ) : (
              p1Zones.play.map((id) => (
                <GameCard
                  key={id}
                  instanceId={id}
                  gameState={gameState}
                  definitions={definitions}
                  isSelected={session.selectedInstanceId === id}
                  onClick={() => session.selectCard(session.selectedInstanceId === id ? null : id)}
                  zone="play"
                />
              ))
            )}
          </div>
        </div>

        {/* ---- Hand ---- */}
        <div className="mt-3 rounded-xl bg-gray-900/40 border border-gray-800/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Your Hand</span>
            <span className="text-[10px] text-gray-600">{p1Zones.hand.length} cards</span>
          </div>
          <div className="min-h-[80px] flex flex-wrap gap-3 items-start">
            {p1Zones.hand.length === 0 ? (
              <span className="text-gray-700 text-xs italic">Empty hand</span>
            ) : (
              p1Zones.hand.map((id) => (
                <GameCard
                  key={id}
                  instanceId={id}
                  gameState={gameState}
                  definitions={definitions}
                  isSelected={session.selectedInstanceId === id}
                  onClick={() => session.selectCard(session.selectedInstanceId === id ? null : id)}
                  zone="hand"
                />
              ))
            )}
          </div>
        </div>

        {/* ---- Action bar ---- */}
        {legalActions.length > 0 && !pendingChoice && (
          <div className="mt-3 rounded-xl bg-gray-900/60 border border-gray-800/50 p-3">
            <div className="text-[10px] text-amber-500/60 uppercase tracking-wider font-bold mb-2">Actions</div>
            <div className="flex flex-wrap gap-1.5">
              {legalActions.map((action, i) => {
                const label = formatAction(action, gameState, definitions);
                const isPass = action.type === "PASS_TURN";
                return (
                  <button
                    key={i}
                    className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all hover:scale-[1.02]
                      ${isPass
                        ? "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                        : "bg-amber-900/30 border-amber-700/40 text-amber-200 hover:bg-amber-800/40 hover:border-amber-600/50"
                      }`}
                    onClick={() => session.dispatch(action)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- Pending Choice ---- */}
        {pendingChoice && <div className="mt-3">{renderPendingChoice()}</div>}

        {/* ---- Game Log ---- */}
        <details className="mt-3">
          <summary className="text-[10px] text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-gray-400 transition-colors py-1">
            Game Log ({actionLog.length})
          </summary>
          <div
            ref={logRef}
            className="h-28 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5 mt-1"
          >
            {recentLog.map((entry, i) => (
              <div key={i} className="text-gray-500">
                <span className="text-gray-700">T{entry.turn}</span>{" "}
                <span className={entry.playerId === "player1" ? "text-green-600" : "text-red-600"}>
                  {entry.playerId === "player1" ? "P1" : "P2"}
                </span>{" "}
                {entry.message}
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* ======================= Analysis sidebar ======================= */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <AnalysisPanel {...analysis} estimateLabel={analysis.usingRL ? "RL est." : "GreedyBot est."} />
      </div>
    </div>
  );
}
