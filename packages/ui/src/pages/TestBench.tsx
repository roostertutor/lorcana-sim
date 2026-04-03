import type { CardDefinition } from "@lorcana-sim/engine";
import GameBoard from "./GameBoard.js";

interface Props {
  definitions: Record<string, CardDefinition>;
}

export default function TestBench({ definitions }: Props) {
  return <GameBoard definitions={definitions} sandboxMode />;
}
