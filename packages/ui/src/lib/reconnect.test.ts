import { describe, it, expect, beforeEach, vi } from "vitest";
import { decideReconnect, type MpGameInfo } from "./reconnect.js";

// Minimal in-memory localStorage so we can assert the self-heal behavior the
// MultiplayerGamePage effect performs around decideReconnect, without a DOM.
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

describe("decideReconnect — stale mp-game self-heal", () => {
  const GAME_ID = "11111111-1111-1111-1111-111111111111";

  it("reconnects when the game is still active (live-resume happy path)", () => {
    const info: MpGameInfo = { status: "active", playerSide: "player2" };
    const decision = decideReconnect(GAME_ID, info);
    expect(decision).toEqual({
      kind: "reconnect",
      config: { gameId: GAME_ID, myPlayerId: "player2" },
    });
  });

  it("clears the anchor and redirects when the game is finished (the bug)", () => {
    const info: MpGameInfo = { status: "finished", playerSide: "player1" };
    expect(decideReconnect(GAME_ID, info)).toEqual({ kind: "clear-and-redirect" });
  });

  it("clears the anchor when the game is missing (getGameInfo → null)", () => {
    expect(decideReconnect(GAME_ID, null)).toEqual({ kind: "clear-and-redirect" });
  });

  it("clears the anchor for any non-active status (abandoned)", () => {
    const info: MpGameInfo = { status: "abandoned", playerSide: "player1" };
    expect(decideReconnect(GAME_ID, info)).toEqual({ kind: "clear-and-redirect" });
  });
});

// These tests mirror what the MultiplayerGamePage effect does with the
// decision: on "reconnect" it writes mp-game and renders the board; on
// "clear-and-redirect" it removes mp-game and navigates to /multiplayer.
describe("mp-game anchor self-heal (effect behavior around decideReconnect)", () => {
  const GAME_ID = "22222222-2222-2222-2222-222222222222";
  let localStorage: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    localStorage = makeLocalStorage();
  });

  // Simulates the effect body: validate the anchor against a mocked
  // getGameInfo and apply the decision to localStorage. Returns the route
  // the page would resolve to.
  function runValidation(getGameInfo: (id: string) => MpGameInfo): "board" | "/multiplayer" {
    const info = getGameInfo(GAME_ID);
    const decision = decideReconnect(GAME_ID, info);
    if (decision.kind === "reconnect") {
      localStorage.setItem("mp-game", JSON.stringify(decision.config));
      return "board";
    }
    localStorage.removeItem("mp-game");
    return "/multiplayer";
  }

  it("stale finished game: clears mp-game and redirects, never renders board", () => {
    // Pre-existing stale anchor pointing at a now-finished game.
    localStorage.setItem("mp-game", JSON.stringify({ gameId: GAME_ID, myPlayerId: "player1" }));
    const getGameInfo = vi.fn((_id: string): MpGameInfo => ({ status: "finished", playerSide: "player1" }));

    const route = runValidation(getGameInfo);

    expect(getGameInfo).toHaveBeenCalledWith(GAME_ID);
    expect(route).toBe("/multiplayer");
    expect(localStorage.getItem("mp-game")).toBeNull();
  });

  it("active game: keeps mp-game and reconnects to the board", () => {
    localStorage.setItem("mp-game", JSON.stringify({ gameId: GAME_ID, myPlayerId: "player1" }));
    const getGameInfo = vi.fn((_id: string): MpGameInfo => ({ status: "active", playerSide: "player2" }));

    const route = runValidation(getGameInfo);

    expect(route).toBe("board");
    // Anchor refreshed with the server-confirmed player side.
    expect(JSON.parse(localStorage.getItem("mp-game")!)).toEqual({
      gameId: GAME_ID,
      myPlayerId: "player2",
    });
  });
});
