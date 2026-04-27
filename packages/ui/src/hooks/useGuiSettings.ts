// =============================================================================
// useGuiSettings — localStorage-backed user preferences for in-game UI.
//
// First-class home for UI feature toggles that the player should be able to
// turn on/off without a code change. Started 2026-04-27 with the item-
// stacking prototype toggle so the player can A/B-test it; expected to grow
// as more prototypes mature into opt-in behaviors.
//
// Persistence: localStorage with a versioned key. If the schema evolves
// (e.g. settings get added/removed), bump STORAGE_KEY's version suffix so
// stale shapes get rejected and defaults reapply.
//
// Server-side persistence: not yet — when user accounts grow a real
// "preferences" surface, we'll mirror this hook's settings to the server
// and hydrate from there.
// =============================================================================

import { useCallback, useState } from "react";

const STORAGE_KEY = "lorcana-gui-settings-v1";

export interface GuiSettings {
  /** When true, identical-state items in play render as a single staggered
   *  pile (4 Pawpsicles → one slot). When false, each item is its own slot. */
  itemStackingEnabled: boolean;
  /** When true, the OPPONENT's play zone is vertically mirrored — locations
   *  near the play divider, characters/items at the back. Matches the
   *  tabletop metaphor where each player's "front row" faces the divider.
   *  When false, both play zones use the same top-down order (locations
   *  first, then characters/items) — useful for players who prefer reading
   *  the board with a single consistent orientation. */
  mirrorOpponentPlayZone: boolean;
  /** When true, the OPPONENT's cards are flipped 180° visually so their
   *  artwork faces them — like a real tabletop where cards point toward
   *  whoever owns them. Composes with each card's own rotation (e.g.
   *  exerted/location 90°): an opp's exerted card displays at 270°. When
   *  false, opp cards render upright from the viewing player's perspective. */
  flipOpponentCards: boolean;
  /** Card preview style in choice/picker modals (choose_may, choose_trigger).
   *  "art" shows the card image; "text" renders structured rules text via
   *  CardTextRender — useful for readability when the player can't quickly
   *  scan card art (e.g. accessibility, low contrast, or unfamiliar set). */
  cardDisplayMode: "art" | "text";
}

const DEFAULTS: GuiSettings = {
  itemStackingEnabled: true,
  mirrorOpponentPlayZone: true,
  flipOpponentCards: true,
  cardDisplayMode: "art",
};

function loadFromStorage(): GuiSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<GuiSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function saveToStorage(settings: GuiSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded / storage disabled — fail silent. Settings still
    // work in-memory for the current session.
  }
}

/** Hook returning the current GuiSettings + an updater that persists to
 *  localStorage. Updater takes one key at a time (vs. partial-merge) so
 *  call sites are explicit about what changed. */
export function useGuiSettings(): [
  GuiSettings,
  <K extends keyof GuiSettings>(key: K, value: GuiSettings[K]) => void,
] {
  const [settings, setSettings] = useState<GuiSettings>(() => loadFromStorage());
  const update = useCallback(
    <K extends keyof GuiSettings>(key: K, value: GuiSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveToStorage(next);
        return next;
      });
    },
    [],
  );
  return [settings, update];
}
