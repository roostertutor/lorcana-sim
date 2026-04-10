// =============================================================================
// SandboxPanel — sidebar controls for sandboxMode
// Card injector, ink/lore adjustments, selected-card state editor
// =============================================================================

import React, { useState, useMemo, useEffect, useRef } from "react";
import type { CardDefinition, CardInstance, GameState, PlayerID } from "@lorcana-sim/engine";
import type { GameSession } from "../hooks/useGameSession.js";

interface Props {
  session: GameSession;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  myId: PlayerID;
  autoPassP2: boolean;
  onAutoPassP2Change: (v: boolean) => void;
  onResetBoard: () => void;
}

type ZoneName = "hand" | "play" | "inkwell" | "deck" | "discard";

const INJECTABLE_ZONES: { value: ZoneName; label: string }[] = [
  { value: "hand", label: "Hand" },
  { value: "play", label: "Play" },
  { value: "deck", label: "Deck" },
  { value: "discard", label: "Discard" },
];

export default function SandboxPanel({
  session,
  gameState,
  definitions,
  myId,
  autoPassP2,
  onAutoPassP2Change,
  onResetBoard,
}: Props) {
  const opponentId: PlayerID = myId === "player1" ? "player2" : "player1";

  // ── Card injector state ──
  const [query, setQuery] = useState("");
  const [selectedDef, setSelectedDef] = useState<CardDefinition | null>(null);
  const [targetZone, setTargetZone] = useState<ZoneName>("hand");
  const [targetPlayer, setTargetPlayer] = useState<PlayerID>(myId);
  const [showDropdown, setShowDropdown] = useState(false);
  const [injectQty, setInjectQty] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return Object.values(definitions)
      .filter((d) => d.fullName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, definitions]);

  function handleInject() {
    if (!selectedDef) return;
    const count = injectQty;
    session.patchState((prev) => {
      let next = prev;
      for (let n = 0; n < count; n++) {
        const instanceId = `sb-${selectedDef.id}-${Date.now().toString(36)}-${n}`;
        const instance: CardInstance = {
          instanceId,
          definitionId: selectedDef.id,
          ownerId: targetPlayer,
          zone: targetZone,
          isExerted: false,
          damage: 0,
          isDrying: targetZone === "play",
          tempStrengthModifier: 0,
          tempWillpowerModifier: 0,
          tempLoreModifier: 0,
          grantedKeywords: [],
          timedEffects: [],
          cardsUnder: [],
        };
        next = {
          ...next,
          cards: { ...next.cards, [instanceId]: instance },
          zones: {
            ...next.zones,
            [targetPlayer]: {
              ...next.zones[targetPlayer],
              [targetZone]: [...(next.zones[targetPlayer][targetZone as keyof typeof next.zones.player1] as string[]), instanceId],
            },
          },
        };
      }
      return next;
    });
    setQuery("");
    setSelectedDef(null);
  }

  // ── Player controls ──
  function adjustLore(playerId: PlayerID, delta: number) {
    session.patchState((prev) => ({
      ...prev,
      players: {
        ...prev.players,
        [playerId]: {
          ...prev.players[playerId],
          lore: Math.max(0, prev.players[playerId].lore + delta),
        },
      },
    }));
  }

  function adjustInk(playerId: PlayerID, delta: number) {
    session.patchState((prev) => ({
      ...prev,
      players: {
        ...prev.players,
        [playerId]: {
          ...prev.players[playerId],
          availableInk: Math.max(0, Math.min(99, prev.players[playerId].availableInk + delta)),
        },
      },
    }));
  }

  // ── Selected card controls ──
  const selectedId = session.selectedInstanceId;
  const selectedCard = selectedId ? gameState.cards[selectedId] : null;
  const selectedDef2 = selectedCard ? definitions[selectedCard.definitionId] : null;
  const isInPlay = selectedCard?.zone === "play";

  function toggleExert() {
    if (!selectedId) return;
    session.patchState((prev) => ({
      ...prev,
      cards: {
        ...prev.cards,
        [selectedId]: {
          ...prev.cards[selectedId]!,
          isExerted: !prev.cards[selectedId]!.isExerted,
          isDrying: false,
        },
      },
    }));
  }

  function clearDrying() {
    if (!selectedId) return;
    session.patchState((prev) => ({
      ...prev,
      cards: {
        ...prev.cards,
        [selectedId]: { ...prev.cards[selectedId]!, isDrying: false },
      },
    }));
  }

  function adjustDamage(delta: number) {
    if (!selectedId || !selectedCard) return;
    const def = definitions[selectedCard.definitionId];
    const maxDmg = def?.willpower ?? 99;
    session.patchState((prev) => ({
      ...prev,
      cards: {
        ...prev.cards,
        [selectedId]: {
          ...prev.cards[selectedId]!,
          damage: Math.max(0, Math.min(maxDmg, prev.cards[selectedId]!.damage + delta)),
        },
      },
    }));
  }

  function removeCard() {
    if (!selectedId || !selectedCard) return;
    const ownerId = selectedCard.ownerId;
    const zone = selectedCard.zone;
    session.patchState((prev) => {
      const { [selectedId]: _removed, ...cards } = prev.cards;
      const zones = prev.zones[ownerId];
      return {
        ...prev,
        cards,
        zones: {
          ...prev.zones,
          [ownerId]: Object.fromEntries(
            Object.entries(zones).map(([z, ids]) => [
              z,
              (ids as string[]).filter((id) => id !== selectedId),
            ])
          ) as typeof zones,
        },
      };
    });
    void zone; // suppress unused warning
    session.selectCard(null);
  }

  const btnBase = "px-2 py-1 rounded text-xs font-bold transition-colors active:scale-95";
  const adj = (handler: () => void, label: string, color = "bg-gray-700 hover:bg-gray-600 text-gray-200") => (
    <button className={`${btnBase} ${color}`} onClick={handler}>{label}</button>
  );

  return (
    <div className="space-y-4 text-sm">
      {/* ── Card Injector ── */}
      <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-3 space-y-2">
        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Inject Card</div>

        {/* Search */}
        <div className="relative">
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5
                       text-xs text-gray-200 placeholder-gray-600
                       focus:border-amber-500/60 focus:outline-none"
            placeholder="Search card name…"
            value={selectedDef ? selectedDef.fullName : query}
            onChange={(e) => { setQuery(e.target.value); setSelectedDef(null); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-0.5 rounded-lg border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
              {searchResults.map((d) => (
                <button
                  key={d.id}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                  onMouseDown={() => { setSelectedDef(d); setQuery(d.fullName); setShowDropdown(false); }}
                >
                  <span className="font-medium">{d.fullName}</span>
                  <span className="ml-1.5 text-gray-600">({d.cost})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Zone + Player */}
        <div className="flex gap-2">
          <select
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
            value={targetZone}
            onChange={(e) => setTargetZone(e.target.value as ZoneName)}
          >
            {INJECTABLE_ZONES.map((z) => (
              <option key={z.value} value={z.value}>{z.label}</option>
            ))}
          </select>
          <select
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
            value={targetPlayer}
            onChange={(e) => setTargetPlayer(e.target.value as PlayerID)}
          >
            <option value={myId}>You (P{myId === "player1" ? "1" : "2"})</option>
            <option value={opponentId}>Opp (P{opponentId === "player1" ? "1" : "2"})</option>
          </select>
          <select
            className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
            value={injectQty}
            onChange={(e) => setInjectQty(Number(e.target.value))}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <button
          className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500
                     text-white rounded-lg text-xs font-bold transition-colors active:scale-[0.98]"
          disabled={!selectedDef}
          onClick={handleInject}
        >
          {selectedDef ? `Inject ${selectedDef.fullName}${injectQty > 1 ? ` x${injectQty}` : ""}` : "Select a card first"}
        </button>
      </div>

      {/* ── Player Controls ── */}
      <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-3 space-y-2">
        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Player Controls</div>
        {([myId, opponentId] as PlayerID[]).map((pid) => {
          const p = gameState.players[pid];
          const label = pid === myId ? "You" : "Opp";
          return (
            <div key={pid} className="flex items-center gap-2 text-xs text-gray-400">
              <span className="w-7 font-bold text-gray-300 shrink-0">{label}</span>
              <span className="text-gray-600 shrink-0">Lore</span>
              {adj(() => adjustLore(pid, -1), "−")}
              <span className="w-5 text-center font-mono text-amber-400">{p.lore}</span>
              {adj(() => adjustLore(pid, 1), "+")}
              <span className="text-gray-600 shrink-0 ml-2">Ink</span>
              {adj(() => adjustInk(pid, -1), "−")}
              <span className="w-5 text-center font-mono text-blue-400">{p.availableInk}</span>
              {adj(() => adjustInk(pid, 1), "+")}
            </div>
          );
        })}
      </div>

      {/* ── Selected Card ── */}
      {selectedCard && selectedDef2 && (
        <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-3 space-y-2">
          <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Selected Card</div>
          <div className="text-xs text-gray-300 font-medium truncate">{selectedDef2.fullName}</div>
          <div className="text-[10px] text-gray-600 capitalize">{selectedCard.zone} · {selectedCard.ownerId === myId ? "You" : "Opp"}</div>

          {isInPlay && (
            <div className="space-y-1.5">
              {/* Exert / Ready */}
              <div className="flex gap-2">
                <button
                  className={`flex-1 py-1 rounded text-xs font-bold transition-colors ${
                    selectedCard.isExerted
                      ? "bg-orange-700 hover:bg-orange-600 text-orange-100"
                      : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                  }`}
                  onClick={toggleExert}
                >
                  {selectedCard.isExerted ? "Ready" : "Exert"}
                </button>
                {selectedCard.isDrying && (
                  <button
                    className="flex-1 py-1 rounded text-xs font-bold bg-yellow-700 hover:bg-yellow-600 text-yellow-100 transition-colors"
                    onClick={clearDrying}
                  >
                    Clear DRY
                  </button>
                )}
              </div>

              {/* Damage */}
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="shrink-0">Damage</span>
                {adj(() => adjustDamage(-1), "−")}
                <span className="w-5 text-center font-mono text-red-400">{selectedCard.damage}</span>
                {adj(() => adjustDamage(1), "+")}
              </div>
            </div>
          )}

          {/* Remove */}
          <button
            className="w-full py-1 bg-red-900/60 hover:bg-red-800/60 border border-red-800/50 text-red-400 hover:text-red-300 rounded text-xs font-bold transition-colors"
            onClick={removeCard}
          >
            Remove from game
          </button>
        </div>
      )}

      {/* ── Auto-pass toggle ── */}
      <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoPassP2}
          onChange={(e) => onAutoPassP2Change(e.target.checked)}
          className="rounded"
        />
        Auto-pass opponent turns
      </label>

      {/* ── Quick Save / Load / Reset ── */}
      <div className="flex gap-2">
        <button
          className="flex-1 py-1.5 bg-blue-900/60 hover:bg-blue-800/60 border border-blue-800/50 text-blue-400 hover:text-blue-300 rounded-lg text-xs font-bold transition-colors"
          onClick={() => { session.quickSave(); showToast("Saved"); }}
        >
          Quick Save
        </button>
        <button
          className="flex-1 py-1.5 bg-blue-900/60 hover:bg-blue-800/60 border border-blue-800/50 text-blue-400 hover:text-blue-300 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!session.hasQuickSave}
          onClick={() => { session.quickLoad(); showToast("Loaded"); }}
        >
          Quick Load
        </button>
      </div>
      <button
        className="w-full py-1.5 bg-red-900/60 hover:bg-red-800/60 border border-red-800/50 text-red-400 hover:text-red-300 rounded-lg text-xs font-bold transition-colors"
        onClick={onResetBoard}
      >
        Reset Board
      </button>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold shadow-lg animate-pulse">
          {toast}
        </div>
      )}
    </div>
  );
}
