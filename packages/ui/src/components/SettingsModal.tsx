// =============================================================================
// SettingsModal — GUI preferences (in-game toggles).
//
// Opened from BoardMenu's Settings item. Each setting maps to a key in
// useGuiSettings; flipping a toggle persists to localStorage immediately so
// the change applies across page reloads. Per-setting description text helps
// the player understand what each toggle does without needing docs.
//
// First setting (2026-04-27): "Stack identical items" — controls whether
// same-state copies of items collapse into a stagger pile or each render
// as their own slot.
// =============================================================================

import React from "react";
import ModalFrame from "./ModalFrame.js";
import Icon from "./Icon.js";
import type { GuiSettings } from "../hooks/useGuiSettings.js";

interface Props {
  settings: GuiSettings;
  onUpdate: <K extends keyof GuiSettings>(key: K, value: GuiSettings[K]) => void;
  onClose: () => void;
}

export default function SettingsModal({ settings, onUpdate, onClose }: Props) {
  return (
    <ModalFrame onClose={onClose} placement="bottom-sheet-mobile">
      <div
        className="relative bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm shadow-2xl pb-[env(safe-area-inset-bottom,16px)] max-h-[90dvh] sm:max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
            Settings
          </span>
          <button
            className="text-gray-500 hover:text-gray-300 active:scale-95"
            onClick={onClose}
          >
            <Icon name="x-mark" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-1 divide-y divide-gray-800/60">
          <ToggleRow
            label="Stack identical items"
            description="Group same-state copies of items into one staggered pile. Disable to show each item in its own slot."
            value={settings.itemStackingEnabled}
            onChange={(v) => onUpdate("itemStackingEnabled", v)}
          />
          <ToggleRow
            label="Mirror opponent's play zone"
            description="Show the opponent's locations next to the play divider and their items at the far edge — like a tabletop where each player faces the other. Disable to keep both play zones in the same top-down order."
            value={settings.mirrorOpponentPlayZone}
            onChange={(v) => onUpdate("mirrorOpponentPlayZone", v)}
          />
        </div>
      </div>
    </ModalFrame>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-200 font-medium">{label}</div>
        <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`shrink-0 w-10 h-6 rounded-full relative transition-colors ${
          value ? "bg-amber-600" : "bg-gray-700"
        }`}
        onClick={() => onChange(!value)}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
            value ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
