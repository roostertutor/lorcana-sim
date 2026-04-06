// =============================================================================
// GameBoard — Visual game board with card components and analysis overlay
// Human plays P1, bot plays P2. Uses useGameSession + useAnalysis hooks.
// =============================================================================

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { CardDefinition, DeckEntry, PlayerID, GameState } from "@lorcana-sim/engine";
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
import type { ReplayData } from "../hooks/useGameSession.js";
import { useReplaySession } from "../hooks/useReplaySession.js";
import { useBoardDnd, DROP_PLAY_ZONE, DROP_INKWELL, dropCardId } from "../hooks/useBoardDnd.js";
import { buildLabelMap } from "../utils/buildLabelMap.js";
import SandboxPanel from "../components/SandboxPanel.js";
import GameCard from "../components/GameCard.js";
import PendingChoiceModal from "../components/PendingChoiceModal.js";
import ReplayControls from "../components/ReplayControls.js";
import ZoneViewModal from "../components/ZoneViewModal.js";
import CardInspectModal from "../components/CardInspectModal.js";
import Icon from "../components/Icon.js";

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

function InkwellZone({
  inkwellIds, availableInk, inksUsed, canStillInk, isYourTurn,
  isValidTarget, droppable = false, gameState, definitions,
}: {
  inkwellIds: string[];
  availableInk: number;
  inksUsed: number;
  canStillInk: boolean;
  isYourTurn: boolean;
  isValidTarget: boolean;
  droppable?: boolean;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppable ? DROP_INKWELL : "inkwell-display-only" });
  const total = inkwellIds.length;

  const borderClass = isOver && isValidTarget
    ? "border-blue-400 bg-blue-950/20 shadow-lg shadow-blue-400/20"
    : isValidTarget
    ? "border-blue-600/50 animate-pulse"
    : canStillInk
    ? "border-blue-800/50"
    : "border-transparent";

  // Quota pips: filled = used this turn, empty = still available
  const filledPips = inksUsed;
  const emptyPips = canStillInk ? 1 : 0;

  return (
    <div ref={setNodeRef} className={`rounded-lg border-2 transition-all duration-150 ${borderClass} relative h-full`}>

      {/* Card strip */}
      <div className="h-10 sm:h-[78px] lg:h-[90px] flex flex-nowrap items-start px-1 -mt-px" style={{ clipPath: "inset(0 -9999px 0 0)" }}>
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <span className="text-[9px] text-gray-700 italic">No cards inked</span>
          </div>
        ) : (
          inkwellIds.map((id, i) => {
            const isFaceUp = i >= total - inksUsed;
            const isAvailable = i >= total - availableInk;
            return (
              <div
                key={id}
                style={{ zIndex: i }}
                className={`shrink-0 w-7 h-10 sm:w-14 sm:h-[78px] lg:w-16 lg:h-[90px] relative transition-all duration-200 ${i > 0 ? "-ml-3 sm:-ml-6 lg:-ml-7" : ""}`}
              >
                <div className="absolute top-0 left-0 origin-top-left scale-[0.538] pointer-events-none">
                  <div className={`transition-all duration-200 ${!isAvailable ? "rotate-90 grayscale brightness-75" : ""}`}>
                    <GameCard
                      instanceId={id}
                      gameState={gameState}
                      definitions={definitions}
                      isSelected={false}
                      onClick={() => {}}
                      zone="play"
                      faceDown={!isFaceUp}
                      skipRotation
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}

      </div>
    </div>
  );
}

function UtilityStrip({
  deckCount, deckTopId, onDeckClick,
  inkwellIds, availableInk, inksUsed, canStillInk, isYourTurn, isValidInkwellTarget, droppable,
  discardCount, discardTopId, onDiscardClick,
  gameState, definitions,
}: {
  deckCount: number; deckTopId: string | undefined; onDeckClick?: () => void;
  inkwellIds: string[]; availableInk: number; inksUsed: number; canStillInk: boolean;
  isYourTurn: boolean; isValidInkwellTarget: boolean; droppable?: boolean;
  discardCount: number; discardTopId: string | undefined; onDiscardClick: () => void;
  gameState: GameState; definitions: Record<string, CardDefinition>;
}) {
  return (
    <div className="shrink-0 flex items-stretch gap-1 mt-1">
      {/* Deck tile */}
      <button
        onClick={onDeckClick}
        disabled={!onDeckClick}
        className="relative w-7 h-10 sm:w-14 sm:h-[78px] lg:w-16 lg:h-[90px] shrink-0 rounded overflow-hidden disabled:cursor-default hover:enabled:brightness-110 transition-all border border-gray-800/40"
      >
        {deckTopId ? (
          <img src="/card-back-small.jpg" alt="Deck" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full border border-dashed border-gray-700/40 rounded" />
        )}
        <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono leading-none bg-black/60 text-gray-300 px-0.5 rounded">{deckCount}</span>
      </button>

      {/* Inkwell — flex-1 */}
      <div className="flex-1 min-w-0">
        <InkwellZone
          inkwellIds={inkwellIds}
          availableInk={availableInk}
          inksUsed={inksUsed}
          canStillInk={canStillInk}
          isYourTurn={isYourTurn}
          isValidTarget={isValidInkwellTarget}
          droppable={droppable ?? false}
          gameState={gameState}
          definitions={definitions}
        />
      </div>

      {/* Discard tile */}
      <button
        onClick={onDiscardClick}
        disabled={discardCount === 0}
        className="relative w-7 h-10 sm:w-14 sm:h-[78px] lg:w-16 lg:h-[90px] shrink-0 rounded overflow-hidden disabled:cursor-default hover:enabled:brightness-110 transition-all border border-gray-800/40"
      >
        {discardTopId ? (
          <div className="absolute inset-0">
            <div className="absolute top-0 left-0 origin-top-left scale-[0.538] pointer-events-none">
              <GameCard
                instanceId={discardTopId}
                gameState={gameState}
                definitions={definitions}
                isSelected={false}
                onClick={() => {}}
                zone="play"
              />
            </div>
          </div>
        ) : (
          <div className="w-full h-full border border-dashed border-gray-700/40 rounded" />
        )}
        <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono leading-none bg-black/60 text-gray-300 px-0.5 rounded">{discardCount}</span>
      </button>
    </div>
  );
}

export default function GameBoard({ definitions, sandboxMode, initialDeck, onBack, multiplayerGame }: Props) {
  const session = useGameSession();

  // Replay mode — null = live mode; non-null = reviewing a completed game
  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const replaySession = useReplaySession(replayData, definitions);

  const [p1DeckText, setP1DeckText] = useState(SAMPLE_DECK);
  const [p2DeckText, setP2DeckText] = useState(SAMPLE_DECK);
  const [botId, setBotId] = useState("greedy");
  const [rlPolicy, setRlPolicy] = useState<BotStrategy | null>(null);
  const [rlPolicyName, setRlPolicyName] = useState<string | null>(null);
  const [multiSelectTargets, setMultiSelectTargets] = useState<string[]>([]);
  const [choiceModalHidden, setChoiceModalHidden] = useState(false);
  const [challengeAttackerId, setChallengeAttackerId] = useState<string | null>(null);
  const [shiftCardId, setShiftCardId] = useState<string | null>(null);
  const [singCardId, setSingCardId] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [discardViewerId, setDiscardViewerId] = useState<"player" | "opponent" | null>(null);
  const [deckViewerOpen, setDeckViewerOpen] = useState(false);
  const [inspectCardId, setInspectCardId] = useState<string | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [autoPassP2, setAutoPassP2] = useState(true);

  const p1Parse = useMemo(() => parseDecklist(p1DeckText, definitions), [p1DeckText, definitions]);
  const p2Parse = useMemo(() => parseDecklist(p2DeckText, definitions), [p2DeckText, definitions]);

// Derived early — needed by hooks that must live above the early return
  const myId = multiplayerGame?.myPlayerId ?? "player1";

  // Cancel any pending 2-step interaction mode
  const cancelMode = React.useCallback(() => {
    setChallengeAttackerId(null);
    setShiftCardId(null);
    setSingCardId(null);
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

  // Valid singers for the selected song card — instanceIds of characters that can sing it
  const singTargets = useMemo(() => {
    if (!singCardId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "PLAY_CARD" && (a as { instanceId: string }).instanceId === singCardId && (a as { singerInstanceId?: string }).singerInstanceId)
        .map(a => (a as { singerInstanceId: string }).singerInstanceId)
    );
  }, [singCardId, session.legalActions]);

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
                onClick: (e) => { e.stopPropagation(); cancelMode(); setSingCardId(action.instanceId); },
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

  // Disable pull-to-refresh, overscroll bounce, and long-press callout while the game board is mounted
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    // Suppress right-click context menu in production (keeps the game feel).
    // Allowed in local dev so you can inspect elements normally.
    const onContextMenu = (e: MouseEvent) => { if (!import.meta.env.DEV) e.preventDefault(); };
    body.style.webkitUserSelect = "none";
    (body.style as any)["-webkit-touch-callout"] = "none";
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      html.style.overscrollBehavior = "";
      body.style.overscrollBehavior = "";
      body.style.webkitUserSelect = "";
      (body.style as any)["-webkit-touch-callout"] = "";
      document.removeEventListener("contextmenu", onContextMenu);
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

  // Restore modal whenever a new choice arrives
  useEffect(() => {
    const pc = session.gameState?.pendingChoice;
    if (pc && pc.choosingPlayerId === myId) {
      setChoiceModalHidden(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.gameState?.pendingChoice]);


  function handleStart() {
    setReplayData(null);
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

  const handleDownloadReplay = useCallback(() => {
    const data = session.completedGame;
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [session.completedGame]);

  const handleUploadReplay = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ReplayData;
        if (typeof data.seed !== "number" || !Array.isArray(data.actions) || !Array.isArray(data.p1Deck) || !Array.isArray(data.p2Deck)) return;
        setReplayData(data);
      } catch {
        // Invalid file — silently ignore
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-uploaded
  }, []);

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
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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
  if (!session.gameState && !replayData && (sandboxMode || onBack || !!multiplayerGame)) {
    return null; // waiting for auto-start effect
  }
  if (!session.gameState && !replayData) {
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

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-medium transition-colors"
            disabled={!canStart}
            onClick={handleStart}
          >
            Start Game
          </button>
          <label className="cursor-pointer px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded font-medium text-sm text-gray-300 transition-colors">
            Load Replay
            <input type="file" accept=".json" className="hidden" onChange={handleUploadReplay} />
          </label>
        </div>
      </div>
    );
  }

  // =========================================================================
  // PLAYING MODE
  // =========================================================================

  const { legalActions, pendingChoice, actionLog, isGameOver, winner, error } = session;
  // In replay mode, show the replay state instead of the live game state.
  // replaySession.state may be null while states are being built — fall back to session.gameState.
  // Cast to GameState: the null guard below prevents any actual null from reaching the render.
  const gameState = ((replayData ? replaySession.state : null) ?? session.gameState) as GameState;
  // Guard: if we somehow have no state yet (replay still loading), render nothing
  if (!gameState) return null;

  const opponentId = myId === "player1" ? "player2" : "player1";

  const p1 = gameState.players[myId];
  const p2 = gameState.players[opponentId];
  const p1Zones = gameState.zones[myId];
  const p2Zones = gameState.zones[opponentId];

  const recentLog = actionLog.slice(-30);
  const isYourTurn = gameState.currentPlayer === myId;
  const inksUsed = p1.inkPlaysThisTurn ?? (p1.hasPlayedInkThisTurn ? 1 : 0);
  const canStillInk = isYourTurn && !pendingChoice && !isGameOver && legalActions.some(a => a.type === "PLAY_INK");

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
    const isSingTarget = singTargets.has(id);
    const isAttacker = id === challengeAttackerId || id === shiftCardId;
    const choiceLabel = choiceLabels.get(id);
    const plainName = getCardName(id);
    const disambigBadge = choiceLabel && choiceLabel !== plainName
      ? choiceLabel.slice(plainName.length).trim()
      : null;

    // Whether this card can be a DnD drop target (shift or challenge)
    const isDropTarget = !!dnd.activeId && dnd.isValidCardDrop(dnd.activeId, id);

    // Fan effect for hand cards — overlap + subtle rotation
    const isHandCard = zone === "hand";
    const midpoint = (total - 1) / 2;
    const normalizedPos = total > 1 ? (index - midpoint) / midpoint : 0; // -1..1
    // Tighten overlap as hand grows so all cards stay visible
    const overlapPx = total >= 7 ? 50 : total >= 5 ? 32 : 22;
    const handStyle: React.CSSProperties | undefined = isHandCard ? {
      marginLeft: index > 0 ? `-${overlapPx}px` : "0",
      transform: `rotate(${normalizedPos * 6}deg)`,
      transformOrigin: isOpponent ? "top center" : "bottom center",
      zIndex: index,
      transition: "transform 0.15s ease",
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
      if (!isOpponent && singCardId && isSingTarget) {
        const singAction = legalActions.find(a => a.type === "PLAY_CARD" && a.instanceId === singCardId && a.singerInstanceId === id);
        if (singAction) session.dispatch(singAction);
        setSingCardId(null);
        return;
      }
      if (challengeAttackerId || shiftCardId || singCardId) { cancelMode(); return; }
      // Toggle: tap same card → deselect; tap different card → select it
      setInspectCardId(prev => prev === id ? null : id);
      if (inspectModalOpen) setInspectModalOpen(false);
    }

    return (
      <DraggableCard key={id} instanceId={id} zone={zone} isEnabled={isDraggableEnabled(isOpponent)}>
        <div
          className="snap-start shrink-0 flex flex-col items-center gap-1 px-0.5"
          style={handStyle}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2));
            setPopoverPos({ top: rect.bottom + 6, left });
          }}
        >
          <DroppableCardTarget id={id} isValidTarget={isDropTarget} activeId={dnd.activeId}>
            <div className="relative">
              <GameCard
                instanceId={id}
                gameState={gameState}
                definitions={definitions}
                isSelected={false}
                isTarget={isChallTarget || isShiftTarget || isSingTarget}
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
        </div>
      </DraggableCard>
    );
  }

  const fmtMsg = (msg: string) => msg
    .replace(/\bplayer1\b/g, "P1").replace(/\bplayer2\b/g, "P2")
    .replace(/^(P1|P2)\s+/, ""); // strip leading "P1 "/"P2 " — the colored prefix already shows it

  // Log entries — rendered inline; caller wraps with appropriate height class
  const logEntries = recentLog.map((entry, i) => (
    <div key={i} className="text-gray-500">
      <span className="text-gray-700">T{entry.turn}</span>{" "}
      <span className={entry.playerId === "player1" ? "text-green-600" : "text-red-600"}>
        {entry.playerId === "player1" ? "P1" : "P2"}
      </span>{" "}
      {fmtMsg(entry.message)}
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


        {/* Replay mode banner */}
        {replayData && (
          <div className="shrink-0 rounded-xl px-3 py-2 flex items-center gap-3 bg-indigo-950/60 border border-indigo-700/40">
            <span className="text-indigo-300 text-xs font-bold uppercase tracking-wider">Replay</span>
            <span className="text-gray-500 text-xs">Turn {replaySession.state?.turnNumber ?? "–"}</span>
            <div className="ml-auto flex items-center gap-2">
              <label className="cursor-pointer px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-gray-300 transition-colors">
                Load replay
                <input type="file" accept=".json" className="hidden" onChange={handleUploadReplay} />
              </label>
              <button
                className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition-colors"
                onClick={() => setReplayData(null)}
              >
                Exit replay
              </button>
            </div>
          </div>
        )}

        {/* ---- Scoreboard ---- */}
        <div className="shrink-0 rounded-xl bg-gray-900/60 border border-gray-800/50 px-3 py-2">
          <div className="flex items-center gap-2">

            {/* Mobile compact lore scores */}
            <div className="flex items-center gap-1.5 ml-1 md:hidden">
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

            <div className="ml-auto shrink-0">
              <button
                className="px-2 py-1 text-gray-600 hover:text-gray-400 rounded transition-colors"
                onClick={() => {
                  if (sandboxMode) {
                    session.startGame({ player1Deck: [], player2Deck: [], definitions, botStrategy: GreedyBot, player1IsHuman: true, player2IsHuman: false });
                  } else {
                    session.reset();
                    onBack?.();
                  }
                }}
                title={onBack ? "Back" : sandboxMode ? "Reset" : "Concede"}
              >
                <Icon name="arrow-left" className="w-4 h-4 md:hidden" />
                <span className="hidden md:inline text-[10px] uppercase tracking-wider">
                  {onBack ? "Back" : sandboxMode ? "Reset" : "Concede"}
                </span>
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
        <div className={`flex-1 min-h-0 flex flex-col -mx-3 px-2 md:mx-0 rounded-xl bg-gradient-to-b from-red-950/10 to-transparent border p-2 transition-colors duration-300 ${!isYourTurn ? "border-red-600/50" : "border-gray-800/30"}`}>
          {/* Opponent hand — face-down, clipped to just show card tops */}
          {p2Zones.hand.length > 0 && (
            <div className="shrink-0 h-10 sm:h-16 overflow-hidden flex flex-nowrap items-end justify-center mb-1">
              {p2Zones.hand.map((id, i) => renderCardWithActions(id, "hand", true, i, p2Zones.hand.length, true))}
            </div>
          )}
          {/* Opponent utility strip */}
          <UtilityStrip
            deckCount={p2Zones.deck.length}
            deckTopId={p2Zones.deck[p2Zones.deck.length - 1]}
            inkwellIds={p2Zones.inkwell}
            availableInk={p2.availableInk}
            inksUsed={p2.inkPlaysThisTurn ?? (p2.hasPlayedInkThisTurn ? 1 : 0)}
            canStillInk={false}
            isYourTurn={false}
            isValidInkwellTarget={false}
            discardCount={p2Zones.discard.length}
            discardTopId={p2Zones.discard[p2Zones.discard.length - 1]}
            onDiscardClick={() => setDiscardViewerId("opponent")}
            gameState={gameState}
            definitions={definitions}
          />
          {/* Opponent play zone */}
          {p2Zones.play.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-gray-700 text-xs italic">No cards in play</span>
            </div>
          ) : (
            <>
              {/* Mobile: 2 rows — characters, then items. Vertical scroll if overflow */}
              <div className="md:hidden flex-1 overflow-y-auto flex flex-col gap-1 pb-1">
                <div className="flex flex-wrap gap-1 items-end">
                  {p2Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType === "character").map((id) => {
                    const exerted = gameState.cards[id]?.isExerted ?? false;
                    return <div key={id} className={`shrink-0 ${exerted ? "w-[73px] h-[52px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", true)}</div>;
                  })}
                </div>
                {p2Zones.play.some(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character") && (
                  <div className="flex flex-wrap gap-1 items-end">
                    {p2Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character").map((id) => {
                      const exerted = gameState.cards[id]?.isExerted ?? false;
                      return <div key={id} className={`shrink-0 ${exerted ? "w-[73px] h-[52px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", true)}</div>;
                    })}
                  </div>
                )}
              </div>
              {/* md+: characters left, items right */}
              <div className="hidden md:flex flex-1 min-h-0 overflow-y-auto items-end justify-between gap-2 pb-1">
                <div className="flex flex-wrap gap-2 items-end content-end">
                  {p2Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType === "character").map((id) => {
                    const exerted = gameState.cards[id]?.isExerted ?? false;
                    return <div key={id} className={`shrink-0 ${exerted ? "sm:w-[146px] sm:h-[104px] lg:w-[168px] lg:h-[120px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", true)}</div>;
                  })}
                </div>
                <div className="flex flex-wrap gap-2 items-end content-end justify-end">
                  {p2Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character").map((id) => {
                    const exerted = gameState.cards[id]?.isExerted ?? false;
                    return <div key={id} className={`shrink-0 ${exerted ? "sm:w-[146px] sm:h-[104px] lg:w-[168px] lg:h-[120px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", true)}</div>;
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ---- Play zone divider ---- */}
        <div className="shrink-0 flex items-center gap-2 py-0.5">
          {/* Undo — left side */}
          <div className="w-16 flex justify-start">
            {session.canUndo && !replayData && (
              <button
                className="px-2 py-0.5 text-[10px] bg-gray-700/40 hover:bg-gray-700/60 text-gray-400 hover:text-gray-200 rounded border border-gray-600/40 font-medium transition-colors"
                onClick={() => { session.undo(); cancelMode(); }}
                title="Undo last action"
              >
                <Icon name="arrow-uturn-left" className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
          <span className="text-[9px] text-gray-700 uppercase tracking-widest shrink-0">Play</span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />

          {/* Pass / Cancel — right side */}
          <div className="w-16 flex justify-end">
            {(challengeAttackerId || shiftCardId) ? (
              <button
                className={`px-2 py-0.5 text-[10px] rounded border font-medium transition-colors
                  ${challengeAttackerId
                    ? "bg-red-900/40 hover:bg-red-900/60 text-red-400 border-red-700/40"
                    : "bg-purple-900/40 hover:bg-purple-900/60 text-purple-400 border-purple-700/40"}`}
                onClick={cancelMode}
              >
                Cancel
              </button>
            ) : isYourTurn && !pendingChoice && !isGameOver ? (
              <button
                className="px-2 py-0.5 text-[10px] bg-green-700/30 hover:bg-green-700/50 text-green-400 rounded border border-green-600/40 font-medium transition-colors"
                onClick={() => session.dispatch({ type: "PASS_TURN", playerId: myId })}
              >
                Pass
              </button>
            ) : null}
          </div>
        </div>

        {/* ---- Player zone ---- */}
        <div className={`flex-1 min-h-0 flex flex-col -mx-3 px-2 md:mx-0 rounded-xl bg-gradient-to-t from-green-950/10 to-transparent border p-2 transition-colors duration-300 ${isYourTurn ? "border-green-600/50" : "border-gray-800/30"}`}>
          {/* Play zone — droppable for card play */}
          <DroppablePlayZone
            isValidTarget={!!dnd.activeId && dnd.isValidPlayZoneDrop(dnd.activeId)}
            activeId={dnd.activeId}
            className="flex-1 min-h-0 flex flex-col"
          >
            {/* Player play zone */}
            {p1Zones.play.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-700 text-xs italic">
                  {dnd.activeId && dnd.isValidPlayZoneDrop(dnd.activeId) ? "Drop here to play" : "No cards in play"}
                </span>
              </div>
            ) : (
              <>
                {/* Mobile: 2 rows — characters, then items. Vertical scroll if overflow */}
                <div className="md:hidden flex-1 overflow-y-auto flex flex-col gap-1 pb-1">
                  <div className="flex flex-wrap gap-1 items-end">
                    {p1Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType === "character").map((id) => {
                      const exerted = gameState.cards[id]?.isExerted ?? false;
                      return <div key={id} className={`shrink-0 ${exerted ? "w-[73px] h-[52px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", false)}</div>;
                    })}
                  </div>
                  {p1Zones.play.some(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character") && (
                    <div className="flex flex-wrap gap-1 items-end">
                      {p1Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character").map((id) => {
                        const exerted = gameState.cards[id]?.isExerted ?? false;
                        return <div key={id} className={`shrink-0 ${exerted ? "w-[73px] h-[52px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", false)}</div>;
                      })}
                    </div>
                  )}
                </div>
                {/* md+: characters left, items right */}
                <div className="hidden md:flex flex-1 min-h-0 overflow-y-auto items-end justify-between gap-2 pb-1 px-1">
                  <div className="flex flex-wrap gap-2 items-end content-end">
                    {p1Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType === "character").map((id) => {
                      const exerted = gameState.cards[id]?.isExerted ?? false;
                      return <div key={id} className={`shrink-0 ${exerted ? "sm:w-[146px] sm:h-[104px] lg:w-[168px] lg:h-[120px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", false)}</div>;
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2 items-end content-end justify-end">
                    {p1Zones.play.filter(id => definitions[gameState.cards[id]?.definitionId ?? ""]?.cardType !== "character").map((id) => {
                      const exerted = gameState.cards[id]?.isExerted ?? false;
                      return <div key={id} className={`shrink-0 ${exerted ? "sm:w-[146px] sm:h-[104px] lg:w-[168px] lg:h-[120px] flex items-center justify-center overflow-hidden" : ""}`}>{renderCardWithActions(id, "play", false)}</div>;
                    })}
                  </div>
                </div>
              </>
            )}
          </DroppablePlayZone>

          {/* Player utility strip */}
          <UtilityStrip
            deckCount={p1Zones.deck.length}
            deckTopId={p1Zones.deck[p1Zones.deck.length - 1]}
            onDeckClick={() => setDeckViewerOpen(true)}
            inkwellIds={p1Zones.inkwell}
            availableInk={p1.availableInk}
            inksUsed={inksUsed}
            canStillInk={canStillInk}
            isYourTurn={isYourTurn}
            isValidInkwellTarget={!!dnd.activeId && dnd.isValidInkwellDrop(dnd.activeId)}
            droppable
            discardCount={p1Zones.discard.length}
            discardTopId={p1Zones.discard[p1Zones.discard.length - 1]}
            onDiscardClick={() => setDiscardViewerId("player")}
            gameState={gameState}
            definitions={definitions}
          />


          {/* Hand */}
          <div className="shrink-0 mt-1">
            <div className="h-20 overflow-hidden flex flex-nowrap items-start justify-center md:h-auto md:overflow-hidden md:flex-wrap md:max-h-[260px] lg:max-h-[355px] md:p-1 md:min-h-[80px]">
              {p1Zones.hand.length === 0 ? (
                <span className="text-gray-700 text-xs italic self-center">Empty hand</span>
              ) : (
                p1Zones.hand.map((id, i) => renderCardWithActions(id, "hand", false, i, p1Zones.hand.length))
              )}
            </div>
          </div>
        </div>

        {/* Replay controls — shown when reviewing a completed game */}
        {replayData && (
          <ReplayControls
            session={replaySession}
            onTakeOver={(state) => {
              // Fork: inject the replay state as the live game state
              setReplayData(null);
              session.patchState(() => state);
            }}
          />
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
            <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5 select-text">
              {logEntries}
            </div>
          </div>
        )}
      </div>



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
                <div className="h-48 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5 select-text">
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
              <button onClick={() => setShowLog(false)} className="text-gray-500 hover:text-gray-300 active:scale-95"><Icon name="x-mark" className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5 select-text">
              {recentLog.map((entry, i) => (
                <div key={i} className="text-gray-500">
                  <span className="text-gray-700">T{entry.turn}</span>{" "}
                  <span className={entry.playerId === "player1" ? "text-green-600" : "text-red-600"}>
                    {entry.playerId === "player1" ? "P1" : "P2"}
                  </span>{" "}
                  {fmtMsg(entry.message)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======================= Floating mode toasts ======================= */}
      {pendingChoice && pendingChoice.choosingPlayerId !== myId && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-yellow-950/90 border border-yellow-700/60 rounded-full px-4 py-1.5 shadow-lg">
            <span className="text-yellow-400 text-xs font-medium animate-pulse">Opponent is thinking…</span>
          </div>
        </div>
      )}
      {!pendingChoice && !isGameOver && isYourTurn && (challengeAttackerId || shiftCardId || singCardId) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
          {challengeAttackerId && (
            <div className="flex items-center gap-2 rounded-full px-3 py-1 sm:px-4 sm:py-1.5 bg-red-950/90 border border-red-700/60 text-red-300 text-xs shadow-lg">
              <span className="font-bold">Challenge</span>
              <span className="hidden sm:inline text-red-500">— tap a highlighted opponent card</span>
              <button className="text-red-500 hover:text-red-300 font-bold active:scale-95" onClick={cancelMode}><Icon name="x-mark" className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {shiftCardId && (
            <div className="flex items-center gap-2 rounded-full px-3 py-1 sm:px-4 sm:py-1.5 bg-purple-950/90 border border-purple-700/60 text-purple-300 text-xs shadow-lg">
              <span className="font-bold">Shift</span>
              <span className="hidden sm:inline text-purple-500">— tap a highlighted character</span>
              <button className="text-purple-500 hover:text-purple-300 font-bold active:scale-95" onClick={cancelMode}><Icon name="x-mark" className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {singCardId && (
            <div className="flex items-center gap-2 rounded-full px-3 py-1 sm:px-4 sm:py-1.5 bg-yellow-950/90 border border-yellow-700/60 text-yellow-300 text-xs shadow-lg">
              <span className="font-bold">Sing</span>
              <span className="hidden sm:inline text-yellow-600">— tap a highlighted character to sing</span>
              <button className="text-yellow-600 hover:text-yellow-300 font-bold active:scale-95" onClick={cancelMode}><Icon name="x-mark" className="w-3.5 h-3.5" /></button>
            </div>
          )}
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
      {pendingChoice && pendingChoice.choosingPlayerId === myId && !choiceModalHidden && (
        <PendingChoiceModal
          pendingChoice={pendingChoice}
          myId={myId}
          gameState={gameState}
          definitions={definitions}
          multiSelectTargets={multiSelectTargets}
          onMultiSelectChange={setMultiSelectTargets}
          onHide={() => setChoiceModalHidden(true)}
          onResolveChoice={(choice) => {
            session.resolveChoice(choice);
            setMultiSelectTargets([]);
          }}
        />
      )}

      {/* Floating restore pill — shown when modal is hidden */}
      {pendingChoice && pendingChoice.choosingPlayerId === myId && choiceModalHidden && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-indigo-700 hover:bg-indigo-600 active:scale-95 text-white text-xs font-semibold rounded-full shadow-lg border border-indigo-500 transition-all"
            onClick={() => setChoiceModalHidden(false)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            View Choice
          </button>
        </div>
      )}
    </div>

      {/* ======================= Game Over Modal ======================= */}
      {isGameOver && !replayData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-950 border border-amber-500/30 rounded-2xl p-8 text-center space-y-4 shadow-2xl mx-4 w-full max-w-sm">
            <div className="text-4xl font-black text-amber-400 tracking-tight">
              {winner === "player1" ? "Victory!" : winner === "player2" ? "Defeat" : "Draw"}
            </div>
            <div className="text-sm text-gray-400">
              {winner === "player1" ? "You won the game" : winner === "player2" ? "The bot won" : "The game ended in a draw"}
            </div>
            <div className="flex flex-col items-center gap-2 pt-1">
              <button
                className="w-full px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-amber-600/20"
                onClick={() => { session.reset(); setReplayData(null); }}
              >
                Play Again
              </button>
              {session.completedGame && (
                <>
                  <button
                    className="w-full px-4 py-2 bg-indigo-700/50 hover:bg-indigo-700/70 text-indigo-200 rounded-lg font-medium transition-colors border border-indigo-600/40 text-sm"
                    onClick={() => setReplayData(session.completedGame)}
                  >
                    Review Game
                  </button>
                  <button
                    className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors border border-gray-700 text-sm"
                    onClick={handleDownloadReplay}
                  >
                    Download Replay
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================= Desktop: card action popover (fixed near card) ======================= */}
      {inspectCardId && popoverPos && (
        <div
          className="fixed z-50 flex items-center gap-1 pointer-events-auto"
          style={{ top: popoverPos.top, left: popoverPos.left, transform: "translateX(-50%)" }}
          onClick={e => e.stopPropagation()}
        >
          {(cardButtons.get(inspectCardId) ?? []).map((btn, i) => (
            <button
              key={i}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shadow-lg transition-colors active:scale-95 ${btn.color}`}
              onClick={(e) => { btn.onClick(e); setInspectCardId(null); }}
            >
              {btn.label}
            </button>
          ))}
          <button
            className="shrink-0 p-1.5 text-gray-400 hover:text-gray-200 bg-gray-800/90 hover:bg-gray-700 rounded-lg shadow-lg transition-colors"
            onClick={() => setInspectModalOpen(true)}
            title="Inspect card"
          >
            <Icon name="magnifying-glass" className="w-3.5 h-3.5" />
          </button>
          <button
            className="shrink-0 p-1.5 text-gray-500 hover:text-gray-300 bg-gray-800/90 hover:bg-gray-700 rounded-lg shadow-lg transition-colors"
            onClick={() => { setInspectCardId(null); setInspectModalOpen(false); }}
          >
            <Icon name="x-mark" className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ======================= Card Inspect Modal (full image) ======================= */}
      {inspectCardId && inspectModalOpen && (
        <CardInspectModal
          instanceId={inspectCardId}
          gameState={gameState}
          definitions={definitions}
          actions={[]}
          onClose={() => setInspectModalOpen(false)}
        />
      )}

      {/* ======================= Discard Zone Viewer ======================= */}
      {discardViewerId && (
        <ZoneViewModal
          title={discardViewerId === "player" ? "Your Discard" : "Opponent's Discard"}
          cardIds={discardViewerId === "player" ? p1Zones.discard : p2Zones.discard}
          gameState={gameState}
          definitions={definitions}
          onClose={() => setDiscardViewerId(null)}
        />
      )}

      {/* ======================= Deck Viewer (your deck only) ======================= */}
      {deckViewerOpen && (
        <ZoneViewModal
          title="Your Deck"
          cardIds={p1Zones.deck}
          faceDown
          gameState={gameState}
          definitions={definitions}
          onClose={() => setDeckViewerOpen(false)}
        />
      )}
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
