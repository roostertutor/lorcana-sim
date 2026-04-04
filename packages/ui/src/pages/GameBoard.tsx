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
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import { useGameSession } from "../hooks/useGameSession.js";
import { useBoardDnd, DROP_PLAY_ZONE, DROP_INKWELL, dropCardId } from "../hooks/useBoardDnd.js";
import { buildLabelMap } from "../utils/buildLabelMap.js";
import SandboxPanel from "../components/SandboxPanel.js";
import GameCard from "../components/GameCard.js";
import PendingChoiceModal from "../components/PendingChoiceModal.js";

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
  sandboxMode?: boolean;
  initialDeck?: DeckEntry[];
  onBack?: () => void;
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

export default function GameBoard({ definitions, sandboxMode, initialDeck, onBack, multiplayerGame }: Props) {
  const session = useGameSession();

  const [p1DeckText, setP1DeckText] = useState(SAMPLE_DECK);
  const [p2DeckText, setP2DeckText] = useState(SAMPLE_DECK);
  const [botId, setBotId] = useState("greedy");
  const [rlPolicy, setRlPolicy] = useState<BotStrategy | null>(null);
  const [rlPolicyName, setRlPolicyName] = useState<string | null>(null);
  const [multiSelectTargets, setMultiSelectTargets] = useState<string[]>([]);
  const [challengeAttackerId, setChallengeAttackerId] = useState<string | null>(null);
  const [shiftCardId, setShiftCardId] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [autoPassP2, setAutoPassP2] = useState(true);

  const p1Parse = useMemo(() => parseDecklist(p1DeckText, definitions), [p1DeckText, definitions]);
  const p2Parse = useMemo(() => parseDecklist(p2DeckText, definitions), [p2DeckText, definitions]);

// Derived early — needed by hooks that must live above the early return
  const myId = multiplayerGame?.myPlayerId ?? "player1";

  // Cancel any pending 2-step interaction mode
  const cancelMode = React.useCallback(() => {
    setChallengeAttackerId(null);
    setShiftCardId(null);
  }, []);

  // Valid challenge targets for the selected attacker
  const challengeTargets = useMemo(() => {
    if (!challengeAttackerId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "CHALLENGE" && a.attackerInstanceId === challengeAttackerId)
        .map(a => (a as { defenderInstanceId: string }).defenderInstanceId)
    );
  }, [challengeAttackerId, session.legalActions]);

  // Valid shift targets for the selected hand card
  const shiftTargets = useMemo(() => {
    if (!shiftCardId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "PLAY_CARD" && (a as { instanceId: string }).instanceId === shiftCardId && (a as { shiftTargetInstanceId?: string }).shiftTargetInstanceId)
        .map(a => (a as { shiftTargetInstanceId: string }).shiftTargetInstanceId)
    );
  }, [shiftCardId, session.legalActions]);

  // Per-card action buttons — derived from legalActions
  type CardBtn = { label: string; color: string; onClick: (e: React.MouseEvent) => void };
  const cardButtons = useMemo(() => {
    const map = new Map<string, CardBtn[]>();
    const gs = session.gameState;
    if (!gs) return map; // wait for game
    const add = (id: string, btn: CardBtn) => {
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(btn);
    };
    const isYourTurn = gs.currentPlayer === myId;
    if (!isYourTurn || session.pendingChoice || session.isGameOver) return map;

    const challengeAdded = new Set<string>();
    const shiftAdded = new Set<string>();
    const singerAdded = new Set<string>();

    for (const action of session.legalActions) {
      switch (action.type) {
        case "PLAY_INK":
          add(action.instanceId, {
            label: "Ink", color: "bg-blue-700 hover:bg-blue-600 text-blue-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        case "PLAY_CARD":
          if (action.shiftTargetInstanceId) {
            if (!shiftAdded.has(action.instanceId)) {
              shiftAdded.add(action.instanceId);
              add(action.instanceId, {
                label: "Shift", color: "bg-purple-700 hover:bg-purple-600 text-purple-100",
                onClick: (e) => { e.stopPropagation(); cancelMode(); setShiftCardId(action.instanceId); },
              });
            }
          } else if (action.singerInstanceId) {
            if (!singerAdded.has(action.instanceId)) {
              singerAdded.add(action.instanceId);
              add(action.instanceId, {
                label: "Sing", color: "bg-yellow-700 hover:bg-yellow-600 text-yellow-100",
                onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
              });
            }
          } else {
            add(action.instanceId, {
              label: "Play", color: "bg-emerald-700 hover:bg-emerald-600 text-emerald-100",
              onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
            });
          }
          break;
        case "QUEST":
          add(action.instanceId, {
            label: "Quest", color: "bg-amber-600 hover:bg-amber-500 text-amber-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        case "CHALLENGE":
          if (!challengeAdded.has(action.attackerInstanceId)) {
            challengeAdded.add(action.attackerInstanceId);
            add(action.attackerInstanceId, {
              label: "Challenge", color: "bg-red-700 hover:bg-red-600 text-red-100",
              onClick: (e) => { e.stopPropagation(); cancelMode(); setChallengeAttackerId(action.attackerInstanceId); },
            });
          }
          break;
        case "ACTIVATE_ABILITY": {
          const def = gs.cards[action.instanceId]
            ? definitions[gs.cards[action.instanceId]!.definitionId]
            : undefined;
          const abilityName = def?.abilities[action.abilityIndex]?.type === "activated"
            ? (def.abilities[action.abilityIndex] as { storyName?: string }).storyName ?? "Activate"
            : "Activate";
          add(action.instanceId, {
            label: abilityName, color: "bg-indigo-700 hover:bg-indigo-600 text-indigo-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        }
      }
    }
    return map;
  }, [session.legalActions, session.pendingChoice, session.isGameOver, session.gameState, session, myId, definitions, cancelMode]);

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

  // Disable pull-to-refresh and overscroll bounce while the game board is mounted
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overscrollBehavior = "";
      body.style.overscrollBehavior = "";
    };
  }, []);

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

  // Solo mode: auto-start with deck from lobby, bot plays P2
  useEffect(() => {
    if (!onBack || sandboxMode || multiplayerGame) return;
    session.startGame({
      player1Deck: initialDeck ?? [],
      player2Deck: initialDeck ?? [],
      definitions,
      botStrategy: GreedyBot,
      player1IsHuman: true,
      player2IsHuman: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Sandbox: auto-start with empty decks on mount
  useEffect(() => {
    if (!sandboxMode) return;
    session.startGame({
      player1Deck: [],
      player2Deck: [],
      definitions,
      botStrategy: GreedyBot, // never invoked — P2 auto-passes
      player1IsHuman: true,
      player2IsHuman: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxMode]);

  // Sandbox: auto-resolve mulligan (skip it entirely)
  useEffect(() => {
    if (!sandboxMode) return;
    if (session.gameState?.pendingChoice?.type === "choose_mulligan") {
      session.resolveChoice([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxMode, session.gameState?.pendingChoice]);

  // Sandbox: auto-pass P2 turns when autoPassP2 is on
  useEffect(() => {
    if (!sandboxMode || !autoPassP2) return;
    const gs = session.gameState;
    if (!gs || gs.isGameOver || gs.pendingChoice) return;
    const opId: PlayerID = myId === "player1" ? "player2" : "player1";
    if (gs.currentPlayer !== opId) return;
    session.dispatch({ type: "PASS_TURN", playerId: opId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxMode, autoPassP2, session.gameState]);

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

  // buildLabelMap is imported from utils — wrap with local getName
  const getLabelMap = (ids: string[]) => buildLabelMap(ids, getCardName);

  // ── Drag & Drop — must be declared BEFORE any early return (Rules of Hooks) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const dnd = useBoardDnd({
    myId,
    gameState: session.gameState,
    legalActions: session.legalActions,
    dispatch: session.dispatch,
    isEnabled: !!(
      session.gameState &&
      session.gameState.currentPlayer === myId &&
      !session.pendingChoice &&
      !session.isGameOver
    ),
  });

  // =========================================================================
  // SETUP MODE
  // =========================================================================
  if (!session.gameState && (sandboxMode || onBack || !!multiplayerGame)) {
    return null; // waiting for auto-start effect
  }
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

  const opponentId = myId === "player1" ? "player2" : "player1";

  const p1 = gameState.players[myId];
  const p2 = gameState.players[opponentId];
  const p1Zones = gameState.zones[myId];
  const p2Zones = gameState.zones[opponentId];

  const recentLog = actionLog.slice(-30);
  const isYourTurn = gameState.currentPlayer === myId;

  // Helpers for readability in JSX
  function isDraggableEnabled(isOpponent: boolean) {
    return !isOpponent && isYourTurn && !pendingChoice && !isGameOver;
  }

  // ── Disambiguation labels for the active pending choice ───────────────────

  const choiceTargetIds = pendingChoice?.validTargets ?? pendingChoice?.revealedCards ?? [];
  const choiceLabels = getLabelMap(choiceTargetIds); // id → "Name (N)" or "Name"

  // Helper: render card + its action buttons, wrapped in DnD primitives
  function renderCardWithActions(id: string, zone: "play" | "hand", isOpponent = false, index = 0, total = 1, faceDown = false) {
    const isChallTarget = challengeTargets.has(id);
    const isShiftTarget = shiftTargets.has(id);
    const isAttacker = id === challengeAttackerId || id === shiftCardId;
    const btns = (!isOpponent && !challengeAttackerId && !shiftCardId) ? (cardButtons.get(id) ?? []) : [];
    const choiceLabel = choiceLabels.get(id);
    const plainName = getCardName(id);
    const disambigBadge = choiceLabel && choiceLabel !== plainName
      ? choiceLabel.slice(plainName.length).trim()
      : null;

    // Whether this card can be a DnD drop target (shift or challenge)
    const isDropTarget = !!dnd.activeId && dnd.isValidCardDrop(dnd.activeId, id);

    // Fan effect for hand cards — overlap + subtle rotation
    const isHandCard = zone === "hand";
    const isCardSelected = session.selectedInstanceId === id;
    const midpoint = (total - 1) / 2;
    const normalizedPos = total > 1 ? (index - midpoint) / midpoint : 0; // -1..1
    // Tighten overlap as hand grows so all cards stay visible
    const overlapPx = total >= 7 ? 50 : total >= 5 ? 32 : 22;
    const handStyle: React.CSSProperties | undefined = isHandCard ? {
      marginLeft: index > 0 ? `-${overlapPx}px` : "0",
      transform: isCardSelected ? "translateY(-10px)" : `rotate(${normalizedPos * (isOpponent ? -6 : 6)}deg)`,
      transformOrigin: isOpponent ? "top center" : "bottom center",
      zIndex: isCardSelected ? 20 : index,
      transition: "transform 0.15s ease, z-index 0s",
    } : undefined;

    function handleClick() {
      if (isOpponent && challengeAttackerId && isChallTarget) {
        session.dispatch({ type: "CHALLENGE", playerId: myId, attackerInstanceId: challengeAttackerId, defenderInstanceId: id });
        setChallengeAttackerId(null);
        return;
      }
      if (!isOpponent && shiftCardId && isShiftTarget) {
        const shiftAction = legalActions.find(a => a.type === "PLAY_CARD" && a.instanceId === shiftCardId && a.shiftTargetInstanceId === id);
        if (shiftAction) session.dispatch(shiftAction);
        setShiftCardId(null);
        return;
      }
      if (challengeAttackerId || shiftCardId) { cancelMode(); return; }
      session.selectCard(session.selectedInstanceId === id ? null : id);
    }

    return (
      <DraggableCard key={id} instanceId={id} zone={zone} isEnabled={isDraggableEnabled(isOpponent)}>
        <div className="snap-start shrink-0 flex flex-col items-center gap-1 px-0.5" style={handStyle}>
          <DroppableCardTarget id={id} isValidTarget={isDropTarget} activeId={dnd.activeId}>
            <div className="relative">
              <GameCard
                instanceId={id}
                gameState={gameState}
                definitions={definitions}
                isSelected={session.selectedInstanceId === id}
                isTarget={isChallTarget || isShiftTarget}
                isAttacker={isAttacker}
                onClick={handleClick}
                zone={zone}
                faceDown={faceDown}
              />
              {disambigBadge && (
                <span className="absolute top-1 right-1 text-[10px] font-black bg-white/90 text-gray-900 px-1.5 py-0.5 rounded shadow pointer-events-none">
                  {disambigBadge}
                </span>
              )}
            </div>
          </DroppableCardTarget>
          {btns.length > 0 && (
            <div className="hidden md:flex flex-wrap gap-0.5 justify-center max-w-[120px]">
              {btns.filter(btn => btn.label !== "Ink").map((btn, i) => (
                <button
                  key={i}
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors ${btn.color}`}
                  onClick={btn.onClick}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </DraggableCard>
    );
  }

  // Mobile: action strip for selected card
  const selectedCardButtons = session.selectedInstanceId ? (cardButtons.get(session.selectedInstanceId) ?? []) : [];

  // Log entries — rendered inline; caller wraps with appropriate height class
  const logEntries = recentLog.map((entry, i) => (
    <div key={i} className="text-gray-500">
      <span className="text-gray-700">T{entry.turn}</span>{" "}
      <span className={entry.playerId === "player1" ? "text-green-600" : "text-red-600"}>
        {entry.playerId === "player1" ? "P1" : "P2"}
      </span>{" "}
      {entry.message}
    </div>
  ));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={dnd.handleDragStart}
      onDragEnd={dnd.handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
    <div className="h-dvh overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_220px] lg:grid-cols-[1fr_280px] gap-0 md:gap-4 lg:gap-5">
      {/* ======================= Main game area ======================= */}
      <div className="min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden px-3 md:pl-4 md:pr-0 pt-3 pb-3">

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="shrink-0 rounded-xl p-6 text-center space-y-3 bg-gradient-to-b from-amber-900/30 to-amber-950/50 border border-amber-500/30">
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
        <div className="shrink-0 rounded-xl bg-gray-900/60 border border-gray-800/50 px-3 py-2">
          <div className="flex items-center gap-2">
            {/* Turn badge */}
            <div className={`px-2 py-0.5 rounded text-xs font-bold tracking-wide shrink-0 ${
              isYourTurn
                ? "bg-green-600/20 text-green-400 border border-green-500/30"
                : "bg-red-600/20 text-red-400 border border-red-500/30"
            }`}>
              {isYourTurn ? (sandboxMode ? "YOUR TURN" : "YOUR TURN") : multiplayerGame ? "OPP." : sandboxMode ? "P2" : "BOT"}
            </div>
            <span className="text-gray-600 text-xs">T{gameState.turnNumber}</span>

            {/* Mobile compact lore scores */}
            <div className="flex items-center gap-1.5 ml-2 md:hidden">
              <span className="text-green-400 font-mono text-sm font-black">{p1.lore}</span>
              <span className="text-gray-700 text-xs">♦</span>
              <span className="text-gray-600 text-xs">vs</span>
              <span className="text-red-400 font-mono text-sm font-black">{p2.lore}</span>
              <span className="text-gray-700 text-xs">♦</span>
              <span className="text-gray-600 text-[10px]">/20</span>
            </div>

            {/* Desktop full lore trackers */}
            <div className="hidden md:flex md:flex-1 md:flex-col md:gap-0.5 md:ml-2">
              <LoreTracker lore={p1.lore} label="You" color="green" />
              <LoreTracker lore={p2.lore} label={multiplayerGame ? "Opp" : "Bot"} color="red" />
            </div>

            <div className="ml-auto flex items-center gap-2 shrink-0">
              {(challengeAttackerId || shiftCardId) && (
                <button
                  className={`px-3 py-1 text-xs rounded border font-medium transition-colors
                    ${challengeAttackerId
                      ? "bg-red-900/40 hover:bg-red-900/60 text-red-400 border-red-700/40"
                      : "bg-purple-900/40 hover:bg-purple-900/60 text-purple-400 border-purple-700/40"}`}
                  onClick={cancelMode}
                >
                  Cancel
                </button>
              )}
              {isYourTurn && !pendingChoice && !isGameOver && !challengeAttackerId && !shiftCardId && (
                <button
                  className="px-3 py-1 text-xs bg-green-700/30 hover:bg-green-700/50 text-green-400 rounded border border-green-600/40 font-medium transition-colors"
                  onClick={() => session.dispatch({ type: "PASS_TURN", playerId: myId })}
                >
                  Pass
                </button>
              )}
              <button
                className="px-2 py-0.5 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300 rounded transition-colors uppercase tracking-wider"
                onClick={() => {
                  if (sandboxMode) {
                    // Restart sandbox in-place — don't go through null (would blank screen)
                    session.startGame({ player1Deck: [], player2Deck: [], definitions, botStrategy: GreedyBot, player1IsHuman: true, player2IsHuman: false });
                  } else {
                    session.reset();
                    onBack?.();
                  }
                }}
              >
                {onBack ? "← Back" : sandboxMode ? "Reset" : "Concede"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="shrink-0 text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* ---- Opponent zone ---- */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-gradient-to-b from-red-950/10 to-transparent border border-gray-800/30 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-red-400/60 uppercase tracking-wider font-bold">Opponent</span>
            <div className="flex gap-3 text-[10px] text-gray-600 items-center">
              <InkDisplay available={p2.availableInk} total={p2Zones.inkwell.length} />
              <span>📦 {p2Zones.deck.length}</span>
            </div>
          </div>
          {/* Opponent hand — face-down, same fan component as player hand */}
          {p2Zones.hand.length > 0 && (
            <div className="shrink-0 flex flex-nowrap pb-3 mb-1 items-start justify-center">
              {p2Zones.hand.map((id, i) => renderCardWithActions(id, "hand", true, i, p2Zones.hand.length, true))}
            </div>
          )}
          {/* Opponent play zone — characters left, items right */}
          <div className="flex-1 min-h-0 overflow-y-auto flex items-end justify-between gap-2 pb-1">
            {p2Zones.play.length === 0 ? (
              <span className="text-gray-700 text-xs italic self-center">No cards in play</span>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 items-end content-end">
                  {p2Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType === "character").map((id) => renderCardWithActions(id, "play", true))}
                </div>
                <div className="flex flex-wrap gap-2 items-end content-end justify-end">
                  {p2Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character").map((id) => renderCardWithActions(id, "play", true))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ---- Play zone divider ---- */}
        <div className="shrink-0 flex items-center gap-3 py-0.5">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
          <span className="text-[9px] text-gray-700 uppercase tracking-widest">Play</span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
        </div>

        {/* ---- Player zone ---- */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-gradient-to-t from-green-950/10 to-transparent border border-gray-800/30 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-green-400/60 uppercase tracking-wider font-bold">Your Board</span>
            <div className="flex gap-3 text-[10px] text-gray-600 items-center">
              <InkDisplay available={p1.availableInk} total={p1Zones.inkwell.length} />
              <span>📦 {p1Zones.deck.length}</span>
            </div>
          </div>
          {/* Play zone — droppable for card play */}
          <DroppablePlayZone
            isValidTarget={!!dnd.activeId && dnd.isValidPlayZoneDrop(dnd.activeId)}
            activeId={dnd.activeId}
            className="flex-1 min-h-0 flex flex-col"
          >
            {/* Player play zone — characters left, items right */}
            <div className="flex-1 min-h-0 overflow-y-auto flex items-end justify-between gap-2 pb-1">
              {p1Zones.play.length === 0 ? (
                <span className="text-gray-700 text-xs italic self-center">
                  {dnd.activeId && dnd.isValidPlayZoneDrop(dnd.activeId)
                    ? "Drop here to play"
                    : "No cards in play"}
                </span>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 items-end content-end">
                    {p1Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType === "character").map((id) => renderCardWithActions(id, "play", false))}
                  </div>
                  <div className="flex flex-wrap gap-2 items-end content-end justify-end">
                    {p1Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character").map((id) => renderCardWithActions(id, "play", false))}
                  </div>
                </>
              )}
            </div>
          </DroppablePlayZone>
        </div>

        {/* Inkwell drop zone — appears between board and hand while dragging an inkable card */}
        {dnd.activeId && dnd.isValidInkwellDrop(dnd.activeId) && (
          <DroppableInkwell isValidTarget={true} activeId={dnd.activeId}>
            <div className="shrink-0 w-full rounded-lg border-2 border-dashed border-blue-500/60 bg-blue-950/30
                            flex items-center justify-center gap-2 py-5 text-xs text-blue-400 font-medium">
              💧 Drop here to ink
            </div>
          </DroppableInkwell>
        )}

        {/* ---- Hand ---- */}
        <div className="shrink-0 rounded-xl bg-gray-900/40 border border-gray-800/30 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Your Hand</span>
            <span className="text-[10px] text-gray-600">{p1Zones.hand.length} cards</span>
          </div>
          <div className="flex flex-nowrap overflow-x-auto snap-x snap-mandatory scrollbar-none md:flex-wrap md:overflow-x-hidden md:overflow-y-auto md:snap-none md:max-h-[260px] lg:max-h-[355px] pb-4 items-end min-h-[80px] justify-center">
            {p1Zones.hand.length === 0 ? (
              <span className="text-gray-700 text-xs italic self-center">Empty hand</span>
            ) : (
              p1Zones.hand.map((id, i) => renderCardWithActions(id, "hand", false, i, p1Zones.hand.length))
            )}
          </div>
        </div>

        {/* ---- Pending Choice: opponent indicator (inline) or human choice (modal) ---- */}
        {pendingChoice && pendingChoice.choosingPlayerId !== myId && (
          <div className="shrink-0 rounded-lg px-4 py-3 bg-yellow-950/40 border border-yellow-700/50">
            <span className="text-yellow-400 text-sm animate-pulse">Opponent is thinking...</span>
          </div>
        )}

        {/* ---- Desktop: mode hints (challenge / shift) ---- */}
        {!pendingChoice && !isGameOver && isYourTurn && (challengeAttackerId || shiftCardId) && (
          <div className="shrink-0 hidden md:flex items-center gap-2">
            {challengeAttackerId && (
              <div className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 bg-red-950/40 border border-red-700/40 text-red-300 text-xs">
                <span className="font-bold">Challenge mode</span>
                <span className="text-red-500">— click a highlighted opponent card</span>
                <button className="ml-auto text-red-500 hover:text-red-300 font-bold" onClick={cancelMode}>✕</button>
              </div>
            )}
            {shiftCardId && (
              <div className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 bg-purple-950/40 border border-purple-700/40 text-purple-300 text-xs">
                <span className="font-bold">Shift mode</span>
                <span className="text-purple-500">— click a highlighted character to shift onto</span>
                <button className="ml-auto text-purple-500 hover:text-purple-300 font-bold" onClick={cancelMode}>✕</button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ======================= Sidebar (Sandbox or Game Log) ======================= */}
      <div className="hidden md:flex flex-col min-h-0 overflow-y-auto pt-3 pb-3 pr-4 gap-4">
        {sandboxMode ? (
          <SandboxPanel
            session={session}
            gameState={gameState}
            definitions={definitions}
            myId={myId}
            autoPassP2={autoPassP2}
            onAutoPassP2Change={setAutoPassP2}
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-gray-900/60 border border-gray-800/50 p-3 gap-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold shrink-0">
              Game Log ({actionLog.length})
            </div>
            <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5">
              {logEntries}
            </div>
          </div>
        )}
      </div>

      {/* ======================= Mobile: card action strip ======================= */}
      {selectedCardButtons.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 md:hidden
                        bg-gray-950/95 border-t border-gray-800 backdrop-blur-sm px-3 py-2
                        pb-[env(safe-area-inset-bottom,8px)]
                        flex gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[10px] text-gray-500 self-center shrink-0 mr-1">
            {getCardName(session.selectedInstanceId!)}:
          </span>
          {selectedCardButtons.map((btn, i) => (
            <button key={i}
              className={`shrink-0 px-4 min-h-[44px] rounded-lg text-sm font-bold
                          transition-colors active:scale-95 ${btn.color}`}
              onClick={btn.onClick}>
              {btn.label}
            </button>
          ))}
        </div>
      )}


      {/* ======================= Mobile: Analysis/Sandbox bottom sheet ======================= */}
      {showAnalysis && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAnalysis(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto
                          bg-gray-950 rounded-t-2xl border-t border-gray-800 p-4
                          pb-[env(safe-area-inset-bottom,16px)]">
            <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
            {sandboxMode ? (
              <SandboxPanel
                session={session}
                gameState={gameState}
                definitions={definitions}
                myId={myId}
                autoPassP2={autoPassP2}
                onAutoPassP2Change={setAutoPassP2}
              />
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                  Game Log ({actionLog.length})
                </div>
                <div className="h-48 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5">
                  {logEntries}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= Mobile: Log bottom sheet ======================= */}
      {showLog && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLog(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[60vh] flex flex-col
                          bg-gray-950 rounded-t-2xl border-t border-gray-800
                          pb-[env(safe-area-inset-bottom,0px)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <span className="text-sm font-bold text-gray-300">Game Log ({actionLog.length})</span>
              <button onClick={() => setShowLog(false)} className="text-gray-500 hover:text-gray-300 text-lg leading-none active:scale-95">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5">
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
          </div>
        </div>
      )}

      {/* ======================= DragOverlay ======================= */}
      <DragOverlay>
        {dnd.activeId && gameState ? (
          <div className="opacity-80 scale-110 rotate-3 pointer-events-none">
            <GameCard
              instanceId={dnd.activeId}
              gameState={gameState}
              definitions={definitions}
              isSelected={false}
              onClick={() => {}}
              zone={dnd.activeZone ?? "hand"}
            />
          </div>
        ) : null}
      </DragOverlay>

      {/* ======================= Pending Choice Modal ======================= */}
      {pendingChoice && pendingChoice.choosingPlayerId === myId && (
        <PendingChoiceModal
          pendingChoice={pendingChoice}
          myId={myId}
          gameState={gameState}
          definitions={definitions}
          multiSelectTargets={multiSelectTargets}
          onMultiSelectChange={setMultiSelectTargets}
          onResolveChoice={(choice) => {
            session.resolveChoice(choice);
            setMultiSelectTargets([]);
          }}
        />
      )}
    </div>
    </DndContext>
  );
}

// =============================================================================
// DnD primitive components — defined outside GameBoard to avoid re-creation
// but closed over via props, not module scope.
// =============================================================================

function DraggableCard({
  instanceId,
  zone,
  isEnabled,
  children,
}: {
  instanceId: string;
  zone: "hand" | "play";
  isEnabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: instanceId,
    disabled: !isEnabled,
    data: { zone },
  });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.3 : 1 }}>
      {children}
    </div>
  );
}

function DroppableCardTarget({
  id,
  isValidTarget,
  activeId,
  children,
}: {
  id: string;
  isValidTarget: boolean;
  activeId: string | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropCardId(id) });
  const ring = isOver && isValidTarget
    ? "ring-2 ring-green-400 ring-inset shadow-green-400/30 shadow-lg rounded-xl"
    : isValidTarget
    ? "ring-1 ring-green-600/50 ring-inset animate-pulse rounded-xl"
    : activeId
    ? "opacity-60"
    : "";
  return (
    <div ref={setNodeRef} className={`transition-all duration-150 ${ring}`}>
      {children}
    </div>
  );
}

function DroppablePlayZone({
  isValidTarget,
  activeId,
  children,
  className = "",
}: {
  isValidTarget: boolean;
  activeId: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_PLAY_ZONE });
  const ring = isOver && isValidTarget
    ? "ring-2 ring-green-400 ring-inset shadow-green-400/20 shadow-lg"
    : isValidTarget
    ? "ring-1 ring-green-600/40 ring-inset animate-pulse"
    : activeId
    ? "opacity-70"
    : "";
  return (
    <div ref={setNodeRef} className={`rounded-lg transition-all duration-150 ${ring} ${className}`}>
      {children}
    </div>
  );
}

function DroppableInkwell({
  isValidTarget,
  children,
}: {
  isValidTarget: boolean;
  activeId: string | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_INKWELL });
  return (
    <div ref={setNodeRef} className={`transition-colors duration-150 ${isOver && isValidTarget ? "brightness-125" : ""}`}>
      {children}
    </div>
  );
}
