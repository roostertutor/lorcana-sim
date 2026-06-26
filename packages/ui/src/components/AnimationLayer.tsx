// =============================================================================
// AnimationLayer — cosmetic game-feel animations driven by the engine's
// GameEvent stream (useGameSession.animationBatch).
//
// ARCHITECTURE (hand-rolled FLIP over a DOM-position registry):
//   - Cards/zone-tiles register their live DOM nodes in CardPositionProvider.
//   - This layer keeps a rolling snapshot of every registered node's rect,
//     refreshed each commit via useLayoutEffect (the "First" of FLIP).
//   - When animationBatch.seq advances (a forward, sequential dispatch), we
//     read the new events. For card movement we have the PRE-move rect (from
//     the snapshot, captured before this commit moved the card) and the live
//     POST-move rect (read now) — First & Last. We render a transient clone
//     that starts offset to "First" and transitions to its natural "Last"
//     position (Invert + Play), then removes itself.
//   - Non-positional events (damage, lore, banish flash) render in-place pops.
//
// WHY NOT framer-motion: it would require wrapping every GameCard in a
// motion node, which collides with dnd-kit transforms on the same element and
// risks the dual-container ref bug. A transform-only overlay is GPU-cheap,
// touches no existing card markup, and never participates in layout — so it
// CANNOT block input or DnD. Animations are pure presentation: they read state
// that's already committed and never call back into game logic.
//
// NON-SEQUENTIAL JUMPS (undo / quickLoad / fork / replay scrub / MP resync):
//   the hook does NOT advance `seq` on those paths, so this layer simply
//   refreshes its position snapshot and animates nothing. A 10-step replay
//   scrub is one instant set, never ten plays.
//
// MP MID-ANIMATION: an opponent action arriving via Realtime installs new
// truth immediately (no seq bump → no flight for the opponent's card, which is
// correct: we have no event stream for it). Our own in-flight clones keep
// running over the already-correct board; they never stall it.
//
// REDUCED MOTION: when `prefers-reduced-motion: reduce`, every animation is
// suppressed (instant). The board still updates; it just doesn't tween.
// =============================================================================

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { GameState, CardDefinition, PlayerID, GameAction } from "@lorcana-sim/engine";
import type { AnimationBatch, GameEvent } from "../hooks/useGameSession.js";
import { useCardPositionRegistry, zoneTileKey } from "../hooks/useCardPositions.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { getBoardCardImage } from "../utils/cardImage.js";

// Tunables — keep it snappy (juice, not molasses).
const FLIGHT_MS = 260;     // card-move flight duration
const DAMAGE_MS = 600;     // damage pop lifetime
const LORE_MS = 750;       // lore burst lifetime
const BANISH_MS = 380;     // banish flash lifetime
const LUNGE_MS = 300;      // challenge lunge out-and-back (total)

interface Rect { left: number; top: number; width: number; height: number; }

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// A live card-flight clone.
interface Flight {
  id: number;
  instanceId: string;
  from: Rect;
  to: Rect;
  imgSrc: string | null;   // null → face-down (deck/opponent) → card back
  kind: "play" | "ink" | "banish" | "draw" | "return";
}

// A transient in-place pop (damage / lore / banish flash).
interface Pop {
  id: number;
  rect: Rect;
  kind: "damage" | "lore" | "banish-flash";
  label: string;
}

// A challenge lunge: the attacker's card image darts toward the defender and
// snaps back. Sourced from the CHALLENGE action's attacker/defender IDs.
interface Lunge {
  id: number;
  from: Rect;
  toward: Rect;
  imgSrc: string | null;
}

let nextAnimId = 1;

interface Props {
  animationBatch: AnimationBatch;
  /** RAW (unfiltered) game state — used only to read definitions/owner for
   *  picking a card image. Reading hidden info here is fine: we never reveal
   *  it (a draw/ink flies face-down for the opponent). Passing the viewer's
   *  filtered state also works; we just fall back to a card back when the
   *  definition is a hidden stub. */
  gameState: GameState | null;
  definitions: Record<string, CardDefinition>;
  /** The viewer's PlayerID — opponent draws/inks fly face-down. */
  viewerId: PlayerID | null;
}

export default function AnimationLayer({ animationBatch, gameState, definitions, viewerId }: Props) {
  const registry = useCardPositionRegistry();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const [flights, setFlights] = useState<Flight[]>([]);
  const [pops, setPops] = useState<Pop[]>([]);
  const [lunges, setLunges] = useState<Lunge[]>([]);

  // Rolling snapshot of every registered node's rect, refreshed each commit.
  // This is FLIP's "First": the position BEFORE the just-committed state moved
  // anything. We read it when the next batch arrives, then overwrite it.
  const prevRectsRef = useRef<Map<string, Rect>>(new Map());
  const lastSeqRef = useRef<number>(animationBatch.seq);

  // Keep live refs to the latest props so the seq effect (which we want to run
  // only when seq changes) reads current values without re-subscribing.
  const gameStateRef = useRef(gameState);
  const definitionsRef = useRef(definitions);
  const viewerIdRef = useRef(viewerId);
  gameStateRef.current = gameState;
  definitionsRef.current = definitions;
  viewerIdRef.current = viewerId;

  // Refresh the ENTIRE position snapshot to current layout. Called by the seq
  // effect AFTER it has consumed the old "First" positions — this becomes the
  // "First" baseline for the next batch. Re-reads every card instance in state
  // plus the zone tiles + lore anchors, so any card that moves next time has a
  // known pre-move position.
  const snapshotRects = useCallback(() => {
    if (!registry) return;
    const next = new Map<string, Rect>();
    const keys = new Set<string>(prevRectsRef.current.keys());
    const gs = gameStateRef.current;
    if (gs) for (const id of Object.keys(gs.cards)) keys.add(id);
    for (const p of ["player1", "player2"] as const) {
      keys.add(zoneTileKey(p, "deck"));
      keys.add(zoneTileKey(p, "discard"));
      keys.add(zoneTileKey(p, "inkwell"));
    }
    keys.add("lore:self");
    keys.add("lore:opp");
    for (const key of keys) {
      const r = registry.getRect(key);
      if (r) next.set(key, toRect(r));
    }
    prevRectsRef.current = next;
  }, [registry]);

  const imageFor = useCallback((instanceId: string, faceUp: boolean): string | null => {
    if (!faceUp) return null;
    const gs = gameStateRef.current;
    const inst = gs?.cards[instanceId];
    if (!inst) return null;
    const def = definitionsRef.current[inst.definitionId];
    if (!def?.imageUrl) return null;
    return getBoardCardImage(def.imageUrl).src;
  }, []);

  // -------------------------------------------------------------------------
  // Main driver: react to a forward seq advance.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const seq = animationBatch.seq;
    const prevSeq = lastSeqRef.current;
    lastSeqRef.current = seq;

    // Only animate a strictly-forward advance. Equal (initial / repeat) or
    // backward (shouldn't happen — seq is monotonic, but undo/load keep it
    // flat) → just refresh the snapshot and bail.
    if (seq <= prevSeq) { snapshotRects(); return; }
    if (reducedMotion || !registry) { snapshotRects(); return; }

    const events = animationBatch.events;
    if (events.length === 0) { snapshotRects(); return; }

    const newFlights: Flight[] = [];
    const newPops: Pop[] = [];
    const newLunges: Lunge[] = [];
    const viewer = viewerIdRef.current;
    const gs = gameStateRef.current;

    for (const ev of events) {
      handleEvent(ev, newFlights, newPops, viewer, gs);
    }

    // Challenge lunge — sourced from the dispatched action (the event stream
    // carries the damage, not the challenge intent). Attacker stays in its
    // play slot (it only exerts), so live rects are fine for both endpoints.
    const action = animationBatch.action;
    if (action && action.type === "CHALLENGE") {
      const atk = registry.getRect(action.attackerInstanceId) ?? prevRectsRef.current.get(action.attackerInstanceId);
      const def = registry.getRect(action.defenderInstanceId) ?? prevRectsRef.current.get(action.defenderInstanceId);
      const atkR = atk ? (atk instanceof DOMRect ? toRect(atk) : atk) : null;
      const defR = def ? (def instanceof DOMRect ? toRect(def) : def) : null;
      if (atkR && defR) {
        newLunges.push({
          id: nextAnimId++,
          from: atkR,
          toward: defR,
          imgSrc: imageFor(action.attackerInstanceId, true),
        });
      }
    }

    if (newFlights.length > 0) {
      setFlights((cur) => [...cur, ...newFlights]);
      // Schedule removal once each flight's transition completes.
      for (const f of newFlights) {
        window.setTimeout(() => {
          setFlights((cur) => cur.filter((x) => x.id !== f.id));
        }, FLIGHT_MS + 40);
      }
    }
    if (newPops.length > 0) {
      setPops((cur) => [...cur, ...newPops]);
      for (const p of newPops) {
        const life = p.kind === "lore" ? LORE_MS : p.kind === "banish-flash" ? BANISH_MS : DAMAGE_MS;
        window.setTimeout(() => {
          setPops((cur) => cur.filter((x) => x.id !== p.id));
        }, life + 40);
      }
    }
    if (newLunges.length > 0) {
      setLunges((cur) => [...cur, ...newLunges]);
      for (const l of newLunges) {
        window.setTimeout(() => {
          setLunges((cur) => cur.filter((x) => x.id !== l.id));
        }, LUNGE_MS + 40);
      }
    }

    // Refresh "First" positions to the now-current layout for the next batch.
    snapshotRects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationBatch.seq]);

  // Build flights/pops for a single event. Mutates the passed arrays.
  function handleEvent(
    ev: GameEvent,
    flightsOut: Flight[],
    popsOut: Pop[],
    viewer: PlayerID | null,
    gs: GameState | null,
  ) {
    if (!registry) return;

    switch (ev.type) {
      case "card_moved": {
        const { instanceId, from, to } = ev;
        // POST-move live rect of the card (its new home).
        const liveRect = registry.getRect(instanceId);
        // PRE-move rect from the snapshot, or a zone-tile fallback.
        const fromRect =
          prevRectsRef.current.get(instanceId) ??
          zoneAnchor(from, instanceId, gs, viewer);

        // Determine kind + which endpoint is on-screen.
        const owner = gs?.cards[instanceId]?.ownerId ?? null;
        const faceUp = isFaceUp(to, owner, viewer);

        if (to === "play" && from === "hand") {
          // Play a card: hand → play. Fly from hand rect to play rect.
          pushFlight(flightsOut, instanceId, fromRect, liveRect, "play", faceUp, gs, viewer, to, from);
        } else if (to === "inkwell" && from === "hand") {
          pushFlight(flightsOut, instanceId, fromRect, liveRect, "ink", faceUp, gs, viewer, to, from);
        } else if (to === "hand" && from === "play") {
          // Return to hand (play → hand). Deck → hand draws are owned by the
          // `card_drawn` handler to avoid double-animating (effect draws emit
          // BOTH card_drawn and card_moved deck→hand).
          pushFlight(flightsOut, instanceId, fromRect, liveRect, "return", faceUp, gs, viewer, to, from);
        } else if (to === "discard") {
          // Banish / discard: play → discard tile.
          pushFlight(flightsOut, instanceId, fromRect, liveRect, "banish", faceUp, gs, viewer, to, from);
        }
        // Other moves (under, deck shuffles) are not animated — they have no
        // meaningful on-screen endpoints. Snapshot still refreshes.
        break;
      }

      case "card_drawn": {
        // Deck → hand. The deck tile is the source; the drawn card's live hand
        // rect is the target. Only animate the viewer's own draws (opponent's
        // drawn card isn't individually rendered face-up).
        const { instanceId, playerId } = ev;
        const liveRect = registry.getRect(instanceId);
        const deckRect = registry.getRect(zoneTileKey(playerId, "deck"));
        const faceUp = viewer == null ? true : playerId === viewer;
        if (liveRect || deckRect) {
          pushFlight(flightsOut, instanceId, deckRect ? toRect(deckRect) : null, liveRect, "draw", faceUp, gs, viewer, "hand", "deck");
        }
        break;
      }

      case "card_banished": {
        // Flash at the card's last on-screen position (it may still be in the
        // DOM this frame, or its rect is in the snapshot). The card_moved
        // discard flight (if any) handles the flight; this adds a red flash.
        const r = registry.getRect(ev.instanceId) ?? prevRectsRef.current.get(ev.instanceId) ?? null;
        if (r) popsOut.push({ id: nextAnimId++, rect: r instanceof DOMRect ? toRect(r) : r, kind: "banish-flash", label: "" });
        break;
      }

      case "damage_dealt": {
        const live = registry.getRect(ev.instanceId);
        const r = live ? toRect(live) : prevRectsRef.current.get(ev.instanceId);
        if (r) popsOut.push({ id: nextAnimId++, rect: r, kind: "damage", label: `-${ev.amount}` });
        break;
      }

      case "lore_gained": {
        // Burst near the scoreboard lore anchor. The pill shows self (green)
        // and opponent (red) totals — map the gaining player to the right one
        // via the viewer perspective (sandbox viewer=null → treat as self).
        const isSelf = viewer == null ? true : ev.playerId === viewer;
        const anchor = registry.getRect(isSelf ? "lore:self" : "lore:opp");
        if (anchor && ev.amount > 0) {
          popsOut.push({ id: nextAnimId++, rect: toRect(anchor), kind: "lore", label: `+${ev.amount}` });
        }
        break;
      }

      default:
        break;
    }
  }

  function pushFlight(
    out: Flight[],
    instanceId: string,
    fromRect: Rect | null,
    liveRect: DOMRect | null,
    kind: Flight["kind"],
    faceUp: boolean,
    _gs: GameState | null,
    _viewer: PlayerID | null,
    _to: string,
    _from: string,
  ) {
    const toR = liveRect ? toRect(liveRect) : fromRect;
    const fromR = fromRect ?? toR;
    if (!toR || !fromR) return; // neither endpoint on screen → no flight (board already correct)
    out.push({
      id: nextAnimId++,
      instanceId,
      from: fromR,
      to: toR,
      imgSrc: imageFor(instanceId, faceUp),
      kind,
    });
  }

  // Resolve a zone-tile anchor rect for a from/to zone that doesn't render the
  // card individually (deck, inkwell-as-stack, discard).
  function zoneAnchor(zone: string, instanceId: string, gs: GameState | null, _viewer: PlayerID | null): Rect | null {
    if (!registry) return null;
    let kind: "deck" | "discard" | "inkwell" | null = null;
    if (zone === "deck") kind = "deck";
    else if (zone === "discard") kind = "discard";
    else if (zone === "inkwell") kind = "inkwell";
    if (!kind) return null;
    // Prefer the owning player's tile; fall back to either if owner unknown.
    const owner = gs?.cards[instanceId]?.ownerId;
    const order: ("player1" | "player2")[] = owner === "player2" ? ["player2", "player1"] : ["player1", "player2"];
    for (const p of order) {
      const r = registry.getRect(zoneTileKey(p, kind));
      if (r) return toRect(r);
    }
    return null;
  }

  function isFaceUp(toZone: string, owner: PlayerID | null, viewer: PlayerID | null): boolean {
    // In play / discard everything is public. In hand / inkwell / deck only the
    // viewer's own cards are face-up.
    if (toZone === "play" || toZone === "discard") return true;
    if (viewer == null) return true; // sandbox both-visible
    return owner === viewer;
  }

  // -------------------------------------------------------------------------
  // Snapshot SEEDING (not refreshing): runs every commit, BEFORE the seq
  // effect. It only ADDS keys not yet tracked — it must NEVER overwrite an
  // existing entry, or it would clobber a moved card's pre-move "First"
  // position before the seq effect (which runs after layout effects) can read
  // it. The seq effect owns the full refresh. This layout effect just makes
  // sure brand-new cards/tiles have an initial position recorded.
  //
  // Two modes, gated on whether THIS commit is the one where a new batch
  // arrived (seq advanced past what the snapshot is synced to):
  //
  //  - FRESH MOVE COMMIT (seq advanced): SEED-ONLY — never overwrite an
  //    existing entry, so the seq `useEffect` (which runs after this layout
  //    effect) can still read each moved card's PRE-move "First" position.
  //    The seq effect does the authoritative full refresh afterward.
  //
  //  - ANY OTHER COMMIT (seq unchanged: bot-thinking re-render, clock tick,
  //    hand re-fan, AND non-animated jumps like undo / quickLoad / replay
  //    scrub / MP resync): FULL REFRESH — re-read every key so the snapshot
  //    tracks the current layout. This keeps "First" accurate after a state
  //    jump that moved cards without advancing seq (no animation fired, so
  //    overwriting is safe and prevents the next play flying from a stale pos).
  // -------------------------------------------------------------------------
  const snappedSeqRef = useRef<number>(-1);
  useLayoutEffect(() => {
    if (!registry) return;
    const map = prevRectsRef.current;
    // isFresh: a new batch is being processed this commit (seq differs from
    // what the snapshot was last synced to). Seed-only in that case so the seq
    // effect (runs next) can read pre-move "First" positions; full-refresh
    // otherwise (re-renders, undo/load/replay jumps that didn't advance seq).
    const isFresh = animationBatch.seq !== snappedSeqRef.current;
    snappedSeqRef.current = animationBatch.seq;

    const apply = (key: string) => {
      const r = registry.getRect(key);
      if (isFresh) {
        // seed-only: preserve existing First for moved cards.
        if (!map.has(key) && r) map.set(key, toRect(r));
      } else {
        // full refresh.
        if (r) map.set(key, toRect(r));
        else map.delete(key);
      }
    };
    const gs = gameStateRef.current;
    if (gs) for (const id of Object.keys(gs.cards)) apply(id);
    for (const p of ["player1", "player2"] as const) {
      apply(zoneTileKey(p, "deck"));
      apply(zoneTileKey(p, "discard"));
      apply(zoneTileKey(p, "inkwell"));
    }
    apply("lore:self");
    apply("lore:opp");
  });

  if (reducedMotion) return null; // nothing renders; board already correct

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {flights.map((f) => (
        <FlightClone key={f.id} flight={f} />
      ))}
      {lunges.map((l) => (
        <LungeClone key={l.id} lunge={l} />
      ))}
      {pops.map((p) => (
        <PopMarker key={p.id} pop={p} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// LungeClone — attacker darts ~40% of the way toward the defender and snaps
// back. Pure transform; uses a CSS keyframe-free two-phase RAF (out, then back).
// -----------------------------------------------------------------------------
function LungeClone({ lunge }: { lunge: Lunge }) {
  const [phase, setPhase] = useState<"start" | "out" | "back">("start");
  useLayoutEffect(() => {
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setPhase("out"));
      timers.r2 = r2;
    });
    const timers: { r1: number; r2: number; t: number } = { r1, r2: 0, t: 0 };
    timers.t = window.setTimeout(() => setPhase("back"), LUNGE_MS / 2);
    return () => {
      cancelAnimationFrame(timers.r1);
      if (timers.r2) cancelAnimationFrame(timers.r2);
      clearTimeout(timers.t);
    };
  }, []);

  const { from, toward, imgSrc } = lunge;
  // Dart 40% of the way toward the defender's center.
  const dx = (toward.left + toward.width / 2 - (from.left + from.width / 2)) * 0.4;
  const dy = (toward.top + toward.height / 2 - (from.top + from.height / 2)) * 0.4;
  const t = phase === "out" ? `translate(${dx}px, ${dy}px) scale(1.06)` : "translate(0,0) scale(1)";

  const style: React.CSSProperties = {
    position: "fixed",
    left: from.left,
    top: from.top,
    width: from.width,
    height: from.height,
    transform: t,
    transition: `transform ${LUNGE_MS / 2}ms cubic-bezier(0.4, 0, 0.6, 1)`,
    willChange: "transform",
    borderRadius: 6,
    overflow: "hidden",
    boxShadow: "0 4px 14px rgba(220,38,38,0.5)",
    zIndex: 61,
    opacity: imgSrc ? 1 : 0.001, // no image → invisible (avoid a card-back lunge)
  };
  return (
    <div style={style} aria-hidden>
      {imgSrc && <img src={imgSrc} alt="" className="w-full h-full object-cover" draggable={false} />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// FlightClone — a single card-flight tween. Renders at the "from" rect, then
// on the next frame transitions transform to the "to" delta. Transform-only
// (translate + scale) so it composites on the GPU.
// -----------------------------------------------------------------------------
function FlightClone({ flight }: { flight: Flight }) {
  const [armed, setArmed] = useState(false);
  useLayoutEffect(() => {
    // Two RAFs: first commits the start transform, second flips to end so the
    // transition actually runs (a single RAF can coalesce with the initial
    // paint and skip the tween).
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setArmed(true));
      cleanup.r2 = r2;
    });
    const cleanup = { r1, r2: 0 };
    return () => { cancelAnimationFrame(cleanup.r1); if (cleanup.r2) cancelAnimationFrame(cleanup.r2); };
  }, []);

  const { from, to, imgSrc, kind } = flight;
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;

  // Banish flights fade out as they arrive; plays/draws fade in.
  const endOpacity = kind === "banish" ? 0.15 : 1;
  const startOpacity = kind === "draw" || kind === "play" || kind === "return" || kind === "ink" ? 0.85 : 1;

  const style: React.CSSProperties = {
    position: "fixed",
    left: from.left,
    top: from.top,
    width: from.width,
    height: from.height,
    transformOrigin: "top left",
    transform: armed
      ? `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`
      : "translate(0px, 0px) scale(1, 1)",
    opacity: armed ? endOpacity : startOpacity,
    transition: `transform ${FLIGHT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FLIGHT_MS}ms ease-out`,
    willChange: "transform, opacity",
    borderRadius: 6,
    overflow: "hidden",
    boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
    zIndex: 61,
  };

  return (
    <div style={style} aria-hidden>
      {imgSrc ? (
        <img src={imgSrc} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        <img src="/card-back-small.jpg" alt="" className="w-full h-full object-cover" draggable={false} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// PopMarker — in-place transient: damage chip, lore burst, banish flash.
// -----------------------------------------------------------------------------
function PopMarker({ pop }: { pop: Pop }) {
  const [armed, setArmed] = useState(false);
  useLayoutEffect(() => {
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setArmed(true));
      store.r2 = r2;
    });
    const store = { r1, r2: 0 };
    return () => { cancelAnimationFrame(store.r1); if (store.r2) cancelAnimationFrame(store.r2); };
  }, []);

  const { rect, kind, label } = pop;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  if (kind === "banish-flash") {
    const style: React.CSSProperties = {
      position: "fixed",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: 6,
      background: "radial-gradient(circle, rgba(220,38,38,0.55), rgba(0,0,0,0))",
      opacity: armed ? 0 : 0.9,
      transform: armed ? "scale(1.25)" : "scale(1)",
      transition: `opacity ${BANISH_MS}ms ease-out, transform ${BANISH_MS}ms ease-out`,
      zIndex: 61,
    };
    return <div style={style} aria-hidden />;
  }

  const isLore = kind === "lore";
  const color = isLore ? "#fbbf24" : "#ef4444";
  const rise = isLore ? -34 : -22;
  const life = isLore ? LORE_MS : DAMAGE_MS;
  const style: React.CSSProperties = {
    position: "fixed",
    left: cx,
    top: cy,
    transform: armed
      ? `translate(-50%, calc(-50% + ${rise}px)) scale(1)`
      : "translate(-50%, -50%) scale(0.6)",
    opacity: armed ? 0 : 1,
    transition: `transform ${life}ms cubic-bezier(0.22,1,0.36,1), opacity ${life}ms ease-out`,
    color,
    fontWeight: 900,
    fontSize: isLore ? 22 : 16,
    textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6)",
    zIndex: 62,
    whiteSpace: "nowrap",
  };
  return <div style={style} aria-hidden>{label}</div>;
}
