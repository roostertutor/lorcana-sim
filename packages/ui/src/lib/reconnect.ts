// Pure reconnection-decision logic for the MP "resume my active game" anchor.
//
// `mp-game` (localStorage) is the resume anchor. It is set on game
// start/join and only explicitly cleared on the Back button — every other
// game-end path (game-over, resign, claim-win, opponent abandon, tab-close)
// leaves it pointing at a now-dead game. So on every mount of the game route
// we must re-validate the anchor against the server's live game status and
// self-heal (clear the anchor) if the game is no longer active. Otherwise a
// fresh login bounces straight onto a finished board.
//
// This module isolates the decision so it can be unit-tested without a DOM:
// given the `getGameInfo` result for a route gameId, decide whether to
// reconnect (and with which config) or to clear the anchor and redirect to
// the lobby.

export type MpGameInfo = {
  playerSide: "player1" | "player2";
  // `string | undefined` (not optional `?:`) so the structurally-wider result
  // of getGameInfo — which carries a required `status: string | undefined`
  // field plus extra props like `state`/`lobbyId` — assigns cleanly under
  // exactOptionalPropertyTypes.
  status: string | undefined;
} | null;

export type MpReconnectConfig = { gameId: string; myPlayerId: "player1" | "player2" };

export type ReconnectDecision =
  | { kind: "reconnect"; config: MpReconnectConfig }
  | { kind: "clear-and-redirect" };

/**
 * Decide what to do with a stored `mp-game` anchor for `gameId`, given the
 * server's `getGameInfo` response.
 *
 * - Game is `active` → reconnect with the server-confirmed player side.
 * - Anything else (finished / abandoned / missing / null) → clear the stale
 *   anchor and redirect to the lobby.
 */
export function decideReconnect(gameId: string, info: MpGameInfo): ReconnectDecision {
  if (info && info.status === "active") {
    return { kind: "reconnect", config: { gameId, myPlayerId: info.playerSide } };
  }
  return { kind: "clear-and-redirect" };
}
