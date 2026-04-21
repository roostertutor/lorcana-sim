import { describe, expect, it } from "vitest";
import { CARD_DEFINITIONS } from "../cards/cardDefinitions.js";
import {
  CORE_ROTATIONS,
  INFINITY_ROTATIONS,
  type GameFormat,
  isCardLegalInFormat,
  isLegalFor,
  listOfferedRotations,
} from "./legality.js";

// Sample cards chosen for their printing profile (verified 2026-04-21):
//   koda-talkative-cub            — set 5 only   → s12 Core ✓  s11 Core ✓  Infinity ✓
//   ariel-on-human-legs           — set 1 only   → Core ✗     Infinity ✓
//   captain-hook-forceful-duelist — sets 1 + 8   → Core ✓ (via set 8 reprint) in both rotations
//                                                  Infinity ✓
//   hiram-flaversham-toymaker     — set 2 only   → Core ✗     Infinity ✗ (banned)
//   dale-excited-friend           — set 12 only  → s12 Core ✓  s11 Core ✗  Infinity ✓

// Convenience builders so tests read like English.
const CORE_S11: GameFormat = { family: "core", rotation: "s11" };
const CORE_S12: GameFormat = { family: "core", rotation: "s12" };
const INF_S11: GameFormat = { family: "infinity", rotation: "s11" };
const INF_S12: GameFormat = { family: "infinity", rotation: "s12" };

describe("rotation registry", () => {
  it("CORE_ROTATIONS.s11 covers sets 5-11 (pre-Set-12 rotation)", () => {
    const entry = CORE_ROTATIONS.s11;
    for (const s of ["5", "6", "7", "8", "9", "10", "11"]) {
      expect(entry.legalSets.has(s)).toBe(true);
    }
    for (const s of ["1", "2", "3", "4", "12"]) {
      expect(entry.legalSets.has(s)).toBe(false);
    }
  });

  it("CORE_ROTATIONS.s12 covers sets 5-12 (additive from s11)", () => {
    const entry = CORE_ROTATIONS.s12;
    for (const s of ["5", "6", "7", "8", "9", "10", "11", "12"]) {
      expect(entry.legalSets.has(s)).toBe(true);
    }
    for (const s of ["1", "2", "3", "4"]) {
      expect(entry.legalSets.has(s)).toBe(false);
    }
  });

  it("Core banlists are empty in both rotations as of 2026-04-21", () => {
    expect(CORE_ROTATIONS.s11.banlist.size).toBe(0);
    expect(CORE_ROTATIONS.s12.banlist.size).toBe(0);
  });

  it("Infinity banlist carries Hiram across both rotations", () => {
    expect(INFINITY_ROTATIONS.s11.banlist.has("hiram-flaversham-toymaker")).toBe(true);
    expect(INFINITY_ROTATIONS.s12.banlist.has("hiram-flaversham-toymaker")).toBe(true);
  });

  it("Infinity rotations include every main set + promos", () => {
    for (const s of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "P1", "P2", "P3", "D23", "DIS"]) {
      expect(INFINITY_ROTATIONS.s11.legalSets.has(s)).toBe(true);
      expect(INFINITY_ROTATIONS.s12.legalSets.has(s)).toBe(true);
    }
  });

  it("all rotations are offered for new decks during pre-release window", () => {
    // Once Set 12 officially drops, s11 flips to offeredForNewDecks:false.
    // This assertion pins the current window state; update when cadence advances.
    expect(CORE_ROTATIONS.s11.offeredForNewDecks).toBe(true);
    expect(CORE_ROTATIONS.s12.offeredForNewDecks).toBe(true);
    expect(INFINITY_ROTATIONS.s11.offeredForNewDecks).toBe(true);
    expect(INFINITY_ROTATIONS.s12.offeredForNewDecks).toBe(true);
  });
});

describe("isCardLegalInFormat", () => {
  it("set 5 card is legal in every rotation", () => {
    const def = CARD_DEFINITIONS["koda-talkative-cub"]!;
    expect(isCardLegalInFormat(def, CORE_S11)).toBe(true);
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(true);
    expect(isCardLegalInFormat(def, INF_S11)).toBe(true);
    expect(isCardLegalInFormat(def, INF_S12)).toBe(true);
  });

  it("set 1-only card is Infinity-legal but never Core-legal", () => {
    const def = CARD_DEFINITIONS["ariel-on-human-legs"]!;
    expect(isCardLegalInFormat(def, CORE_S11)).toBe(false);
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(false);
    expect(isCardLegalInFormat(def, INF_S11)).toBe(true);
    expect(isCardLegalInFormat(def, INF_S12)).toBe(true);
  });

  it("set 1/8 reprint is Core-legal via the set-8 printing in both rotations", () => {
    const def = CARD_DEFINITIONS["captain-hook-forceful-duelist"]!;
    expect(def.setId).toBe("1");
    expect(def.printings?.some((p) => p.setId === "8")).toBe(true);
    expect(isCardLegalInFormat(def, CORE_S11)).toBe(true); // via set 8
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(true); // via set 8
  });

  it("set-12-only card is legal in s12 Core but rejected in s11 Core (rotation-gated)", () => {
    const def = CARD_DEFINITIONS["dale-excited-friend"]!;
    expect(def.setId).toBe("12");
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(true);
    expect(isCardLegalInFormat(def, CORE_S11)).toBe(false);
    // Infinity always accepts by set; banlist is empty for this card.
    expect(isCardLegalInFormat(def, INF_S11)).toBe(true);
    expect(isCardLegalInFormat(def, INF_S12)).toBe(true);
  });

  it("Infinity banlist blocks Hiram in every Infinity rotation", () => {
    const def = CARD_DEFINITIONS["hiram-flaversham-toymaker"]!;
    expect(isCardLegalInFormat(def, INF_S11)).toBe(false);
    expect(isCardLegalInFormat(def, INF_S12)).toBe(false);
    expect(isCardLegalInFormat(def, CORE_S11)).toBe(false); // set_not_legal, not banned
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(false);
  });

  it("throws on unknown rotation id", () => {
    const def = CARD_DEFINITIONS["koda-talkative-cub"]!;
    expect(() =>
      // @ts-expect-error — deliberately invalid rotation id
      isCardLegalInFormat(def, { family: "core", rotation: "s99" }),
    ).toThrow(/Unknown rotation/);
  });
});

describe("isLegalFor", () => {
  const defs = CARD_DEFINITIONS;

  it("accepts an s12 Core deck of only Core-legal cards", () => {
    const result = isLegalFor(
      [{ definitionId: "koda-talkative-cub", count: 4 }],
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags set-12 card in s11 Core with set_not_legal + rotation-specific message", () => {
    const result = isLegalFor(
      [{ definitionId: "dale-excited-friend", count: 4 }],
      defs,
      CORE_S11,
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.reason).toBe("set_not_legal");
    expect(result.issues[0]!.message).toContain("Set 11 Core");
  });

  it("accepts the same set-12 card in s12 Core", () => {
    const result = isLegalFor(
      [{ definitionId: "dale-excited-friend", count: 4 }],
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(true);
  });

  it("flags set-1-only card as set_not_legal in Core (either rotation)", () => {
    for (const fmt of [CORE_S11, CORE_S12]) {
      const result = isLegalFor(
        [{ definitionId: "ariel-on-human-legs", count: 4 }],
        defs,
        fmt,
      );
      expect(result.ok).toBe(false);
      expect(result.issues[0]!.reason).toBe("set_not_legal");
    }
  });

  it("accepts a reprinted card in Core via its newer printing", () => {
    const result = isLegalFor(
      [{ definitionId: "captain-hook-forceful-duelist", count: 4 }],
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(true);
  });

  it("flags Hiram Flaversham Toymaker as banned in both Infinity rotations", () => {
    for (const fmt of [INF_S11, INF_S12]) {
      const result = isLegalFor(
        [{ definitionId: "hiram-flaversham-toymaker", count: 4 }],
        defs,
        fmt,
      );
      expect(result.ok).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.reason).toBe("banned");
      expect(result.issues[0]!.message).toMatch(/Infinity/);
    }
  });

  it("flags unknown defId", () => {
    const result = isLegalFor(
      [{ definitionId: "nonexistent-card-slug", count: 4 }],
      defs,
      INF_S12,
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.reason).toBe("unknown_card");
  });

  it("empty deck is trivially legal in every rotation", () => {
    for (const fmt of [CORE_S11, CORE_S12, INF_S11, INF_S12]) {
      expect(isLegalFor([], defs, fmt).ok).toBe(true);
    }
  });

  it("collects multiple issues in one pass", () => {
    const result = isLegalFor(
      [
        { definitionId: "koda-talkative-cub", count: 4 },          // ok
        { definitionId: "ariel-on-human-legs", count: 4 },         // set_not_legal
        { definitionId: "hiram-flaversham-toymaker", count: 4 },   // set_not_legal for Core
      ],
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.reason === "set_not_legal")).toBe(true);
  });
});

describe("listOfferedRotations", () => {
  it("returns both Core rotations in chronological order", () => {
    const offered = listOfferedRotations("core");
    expect(offered.map((o) => o.id)).toEqual(["s11", "s12"]);
    expect(offered[0]!.entry.displayName).toBe("Set 11 Core");
    expect(offered[1]!.entry.displayName).toBe("Set 12 Core");
  });

  it("returns both Infinity rotations", () => {
    const offered = listOfferedRotations("infinity");
    expect(offered.map((o) => o.id)).toEqual(["s11", "s12"]);
  });
});
