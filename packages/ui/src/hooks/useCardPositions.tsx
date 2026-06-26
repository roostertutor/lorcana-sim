// =============================================================================
// useCardPositions — DOM-position registry for FLIP-style card animations
//
// Cards register their rendered DOM node here keyed by a *position key*. The
// animation layer (AnimationLayer.tsx) reads the live `getBoundingClientRect`
// of those nodes to source from/to coordinates for card-flight tweens.
//
// Why a registry and not dnd-kit's ref map: dnd-kit tracks draggable nodes for
// hit-testing, but (a) it only knows hand + play cards, not the deck / inkwell /
// discard *tiles* we fly cards to and from, and (b) its rects are sampled at
// drag-start, not on demand. We need an on-demand rect for arbitrary anchors
// (a hand card, the discard tile, the deck tile), captured at the instant an
// animation begins.
//
// Position keys:
//   - card instances: the bare instanceId (a card in hand or play).
//   - zone tiles: `zone:<player>:<deck|discard|inkwell>` — the utility-strip
//     tiles, used as the off-screen endpoint when a card flies to/from a zone
//     that doesn't render the individual card (deck draw, banish to discard).
//
// CRITICAL (CLAUDE.md dual-container bug): a given key must be registered by
// exactly ONE live DOM node. The board already uses the single-container
// responsive pattern, so each instanceId renders once. Registering the same
// key twice (e.g. a hidden md: sibling) would make the last writer win and
// could yield a {0,0} rect. The registry stores one node per key; the unmount
// cleanup only clears the entry if it still points at the unmounting node, so
// a fast remount (React key reuse) doesn't erase the newer registration.
// =============================================================================

import React, { createContext, useContext, useRef, useCallback } from "react";

export type ZoneTileKind = "deck" | "discard" | "inkwell";

/** Build the position key for a utility-strip zone tile. */
export function zoneTileKey(player: "player1" | "player2", kind: ZoneTileKind): string {
  return `zone:${player}:${kind}`;
}

interface CardPositionRegistry {
  /** Register (or update) the DOM node for a position key. Returns a cleanup. */
  register: (key: string, node: HTMLElement | null) => void;
  /** Live bounding rect for a key, or null if nothing registered / off-screen. */
  getRect: (key: string) => DOMRect | null;
}

const CardPositionContext = createContext<CardPositionRegistry | null>(null);

export function CardPositionProvider({ children }: { children: React.ReactNode }) {
  // key -> node. Plain ref map; reads happen imperatively at animation time,
  // never in render, so no reactivity is needed (and we explicitly want none —
  // re-rendering the whole board on every ref attach would be ruinous).
  const nodesRef = useRef<Map<string, HTMLElement>>(new Map());

  const register = useCallback((key: string, node: HTMLElement | null) => {
    const map = nodesRef.current;
    if (node) {
      map.set(key, node);
    } else {
      map.delete(key);
    }
  }, []);

  const getRect = useCallback((key: string): DOMRect | null => {
    const node = nodesRef.current.get(key);
    if (!node) return null;
    if (!node.isConnected) return null; // unmounted but not yet cleaned up
    const rect = node.getBoundingClientRect();
    // A {0,0,0,0} rect means the node is detached / display:none — useless as
    // an animation anchor. Treat as "no position" so the caller falls back to
    // a fade rather than flying from the top-left corner.
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }, []);

  const value = useRef<CardPositionRegistry>({ register, getRect });
  // register/getRect are stable (useCallback []), so the registry object is too.

  return (
    <CardPositionContext.Provider value={value.current}>
      {children}
    </CardPositionContext.Provider>
  );
}

/** Access the registry. Returns null outside a provider (animations no-op). */
export function useCardPositionRegistry(): CardPositionRegistry | null {
  return useContext(CardPositionContext);
}

/**
 * PosAnchor — wraps children in a div registered under `positionKey`. Use this
 * inside render loops where you can't call the `usePositionRef` hook per item
 * (Rules of Hooks). The wrapper is `display: contents`-free (a plain div) so it
 * participates in layout exactly where the card sits — its rect IS the card's
 * rect. `className` passes through for any layout classes the slot needs.
 */
export function PosAnchor({
  positionKey,
  className,
  children,
}: {
  positionKey: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = usePositionRef(positionKey);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * Callback ref that registers a DOM node under `key`. Use as
 * `ref={usePositionRef(instanceId)}` on the card / tile wrapper.
 *
 * The returned callback is stable across renders for a given key, and the
 * unmount cleanup only clears the registry entry if it still points at the
 * node that's unmounting (guards against a remount race clobbering a newer
 * registration). Safe to use even when there's no provider (no-op).
 */
export function usePositionRef(key: string): (node: HTMLElement | null) => void {
  const registry = useCardPositionRegistry();
  const lastNodeRef = useRef<HTMLElement | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  return useCallback(
    (node: HTMLElement | null) => {
      if (!registry) return;
      if (node) {
        lastNodeRef.current = node;
        registry.register(keyRef.current, node);
      } else {
        // Only clear if the registry still points at OUR node.
        registry.register(keyRef.current, null);
        lastNodeRef.current = null;
      }
    },
    [registry],
  );
}
