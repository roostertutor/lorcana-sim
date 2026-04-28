import React, { useState } from "react";
import Icon, { type IconName } from "./Icon.js";

interface Props {
  sandboxMode: boolean;
  isGameOver: boolean;
  connectionStatus: "connected" | "reconnecting" | null;
  /** Show the "Game Log" item */
  onOpenLog: () => void;
  /** Show the "Sandbox tools" item (sandbox mode only) */
  onOpenSandbox?: () => void;
  /** Show the "Settings" item (GUI preferences modal) */
  onOpenSettings?: () => void;
  /** Show the "Resign" item (multiplayer in-game only) */
  onResign?: () => void;
  /** Show the "Back to lobby" / "Concede" item */
  onBackOrConcede?: () => void;
  /** true → "Back to lobby", false → "Concede" */
  backLabel?: "back" | "concede";
  /** Hide the kebab trigger (e.g. when a drawer or modal is open that
   *  occupies the same viewport-corner real estate). Internal panel state
   *  is preserved across hide/show. */
  hidden?: boolean;
}

/**
 * Floating top-right kebab menu replacing the scoreboard's button row.
 *
 * Houses chrome-level actions (log, sandbox tools, resign, concede). Lore
 * and Active Effects are not in the menu — lore lives in the play divider,
 * Active Effects has its own floating pill stack bottom-right.
 *
 * Mobile: bottom-sheet. Desktop: anchored dropdown under the kebab.
 * Connection dot sits inline to the left of the kebab when in multiplayer.
 */
export default function BoardMenu({
  sandboxMode,
  isGameOver,
  connectionStatus,
  onOpenLog,
  onOpenSandbox,
  onOpenSettings,
  onResign,
  onBackOrConcede,
  backLabel = "back",
  hidden = false,
}: Props) {
  const [open, setOpen] = useState(false);

  // When hidden (drawer/modal open), render nothing. Internal state stays
  // because React keeps the component mounted — just no DOM.
  if (hidden) return null;

  const close = () => setOpen(false);

  // Build menu items conditionally. The bottom-sheet / dropdown panel only
  // renders items that are applicable — we filter before render so an empty
  // panel never shows.
  const items: { icon: IconName; label: string; onClick: () => void; danger?: boolean }[] = [];
  items.push({ icon: "document-text", label: "Game Log", onClick: () => { onOpenLog(); close(); } });
  if (sandboxMode && onOpenSandbox) {
    items.push({ icon: "wrench", label: "Sandbox tools", onClick: () => { onOpenSandbox(); close(); } });
  }
  if (onOpenSettings) {
    items.push({ icon: "cog-6-tooth", label: "Settings", onClick: () => { onOpenSettings(); close(); } });
  }
  if (!isGameOver && onResign) {
    // Label is "Concede" (was "Resign") — both terms mean the same thing
    // gameplay-wise; "Concede" reads as more matter-of-fact / less
    // intimidating in casual play. Triggers a server-recorded resignation;
    // user sees the defeat modal next.
    items.push({ icon: "x-mark", label: "Concede", onClick: () => { onResign(); close(); }, danger: true });
  }
  if (onBackOrConcede) {
    items.push({
      icon: "arrow-left",
      label: backLabel === "back" ? "Back to lobby" : "Concede",
      onClick: () => { onBackOrConcede(); close(); },
      danger: backLabel === "concede",
    });
  }

  return (
    <>
      {/* Trigger: connection dot (if any) + kebab button.
          Fixed top-right, respects safe-area inset on notched phones. */}
      <div
        className="fixed z-40 flex items-center gap-1.5 pointer-events-none"
        style={{
          top: "calc(0.5rem + env(safe-area-inset-top))",
          right: "calc(0.5rem + env(safe-area-inset-right))",
        }}
      >
        {connectionStatus && (
          <span
            className={`pointer-events-auto w-2 h-2 rounded-full ${
              connectionStatus === "connected" ? "bg-green-500" : "bg-red-500 animate-pulse"
            }`}
            title={connectionStatus === "connected" ? "Connected" : "Reconnecting…"}
          />
        )}
        <button
          className="pointer-events-auto w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-full bg-gray-900/80 hover:bg-gray-800 active:scale-95 border border-gray-700/50 backdrop-blur-sm text-gray-400 hover:text-gray-200 transition-all shadow-lg"
          onClick={() => setOpen(v => !v)}
          aria-label="Menu"
          title="Menu"
        >
          <Icon name="ellipsis-vertical" className="w-4 h-4 md:w-5 md:h-5" />
        </button>
      </div>

      {/* Menu panel: bottom-sheet (mobile) / dropdown (desktop) */}
      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" onClick={close} />
          <div
            className="fixed z-50 bg-gray-950 border-gray-800
                       bottom-0 left-0 right-0 rounded-t-2xl border-t p-3
                       md:bottom-auto md:left-auto md:right-3 md:top-12 md:w-56 md:rounded-xl md:border md:p-2"
            style={{
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="md:hidden flex justify-center pb-2">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map((item, i) => (
                <button
                  key={i}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/60 active:scale-[0.98] transition-all text-left ${
                    item.danger ? "text-red-400 hover:text-red-300" : "text-gray-300 hover:text-gray-100"
                  }`}
                  onClick={item.onClick}
                >
                  <Icon name={item.icon} className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
