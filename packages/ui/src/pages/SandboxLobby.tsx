import React from "react";
import { useNavigate } from "react-router-dom";

export default function SandboxLobby() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-amber-400 tracking-tight">Sandbox</h1>
          <p className="text-gray-600 text-sm mt-1">Test cards and mechanics on an open board</p>
        </div>

        {/* Description */}
        <div className="card p-4 space-y-3">
          <div className="space-y-2 text-sm text-gray-400">
            <p>
              Launch a free-form game board where you can inject any card into any zone,
              adjust ink and lore, and experiment with game mechanics.
            </p>
            <ul className="space-y-1 text-xs text-gray-500">
              <li>Inject cards by name into any zone or player</li>
              <li>Adjust lore, ink, damage, and card state</li>
              <li>Quick save &amp; load board snapshots</li>
              <li>Auto-pass opponent turns</li>
            </ul>
          </div>
        </div>

        {/* Launch */}
        <button
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg
                     text-sm font-bold transition-colors active:scale-[0.98]"
          onClick={() => navigate("/sandbox/play")}
        >
          Launch Sandbox
        </button>
      </div>
    </div>
  );
}
