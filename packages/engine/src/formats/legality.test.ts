import { describe, expect, it } from "vitest";
import { CARD_DEFINITIONS } from "../cards/cardDefinitions.js";
import {
  CORE_BANLIST,
  CORE_LEGAL_SETS,
  INFINITY_BANLIST,
  isCardLegalInFormat,
  isLegalFor,
} from "./legality.js";

// Sample cards chosen for their printing profile (verified 2026-04-19):
//   koda-talkative-cub            — set 5 only   → Core ✓  Infinity ✓
//   ariel-on-human-legs           — set 1 only   → Core ✗  Infinity ✓
//   captain-hook-forceful-duelist — sets 1 + 8   → Core ✓ (via set 8 reprint)
//                                                  Infinity ✓
//   hiram-flaversham-toymaker     — set 2 only   → Core ✗  Infinity ✗ (banned)

describe("format legality constants", () => {
  it("CORE_LEGAL_SETS covers sets 5-12", () => {
    for (const s of ["5", "6", "7", "8", "9", "10", "11", "12"]) {
      expect(CORE_LEGAL_SETS.has(s)).toBe(true);
    }
    for (const s of ["1", "2", "3", "4"]) {
      expect(CORE_LEGAL_SETS.has(s)).toBe(false);
    }
  });

  it("CORE_BANLIST is empty as of 2026-04-19", () => {
    expect(CORE_BANLIST.size).toBe(0);
  });

  it("INFINITY_BANLIST contains Hiram Flaversham Toymaker", () => {
    expect(INFINITY_BANLIST.has("hiram-flaversham-toymaker")).toBe(true);
  });
});

describe("isCardLegalInFormat", () => {
  it("set 5 card is legal in both formats", () => {
    const def = CARD_DEFINITIONS["koda-talkative-cub"]!;
    expect(isCardLegalInFormat(def, "core")).toBe(true);
    expect(isCardLegalInFormat(def, "infinity")).toBe(true);
  });

  it("set 1-only card is legal in Infinity but not Core", () => {
    const def = CARD_DEFINITIONS["ariel-on-human-legs"]!;
    expect(isCardLegalInFormat(def, "core")).toBe(false);
    expect(isCardLegalInFormat(def, "infinity")).toBe(true);
  });

  it("set 1/8 reprint is Core-legal via the set 8 printing", () => {
    const def = CARD_DEFINITIONS["captain-hook-forceful-duelist"]!;
    // Canonical setId is "1" but printings[] includes "8" — legal in Core.
    expect(def.setId).toBe("1");
    expect(def.printings?.some((p) => p.setId === "8")).toBe(true);
    expect(isCardLegalInFormat(def, "core")).toBe(true);
    expect(isCardLegalInFormat(def, "infinity")).toBe(true);
  });

  it("Infinity banlist blocks Hiram Flaversham Toymaker", () => {
    const def = CARD_DEFINITIONS["hiram-flaversham-toymaker"]!;
    expect(isCardLegalInFormat(def, "infinity")).toBe(false);
    // Still not Core-legal — only printed in set 2.
    expect(isCardLegalInFormat(def, "core")).toBe(false);
  });
});

describe("isLegalFor", () => {
  const defs = CARD_DEFINITIONS;

  it("accepts a deck of only Core-legal cards", () => {
    const result = isLegalFor(
      [{ definitionId: "koda-talkative-cub", count: 4 }],
      defs,
      "core",
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags set-not-legal for Core when a card only has pre-set-5 printings", () => {
    const result = isLegalFor(
      [{ definitionId: "ariel-on-human-legs", count: 4 }],
      defs,
      "core",
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.reason).toBe("set_not_legal");
  });

  it("accepts a reprinted card in Core via its newer printing", () => {
    const result = isLegalFor(
      [{ definitionId: "captain-hook-forceful-duelist", count: 4 }],
      defs,
      "core",
    );
    expect(result.ok).toBe(true);
  });

  it("flags Hiram Flaversham Toymaker as banned in Infinity", () => {
    const result = isLegalFor(
      [{ definitionId: "hiram-flaversham-toymaker", count: 4 }],
      defs,
      "infinity",
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.reason).toBe("banned");
  });

  it("flags unknown defId", () => {
    const result = isLegalFor(
      [{ definitionId: "nonexistent-card-slug", count: 4 }],
      defs,
      "infinity",
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.reason).toBe("unknown_card");
  });

  it("empty deck is trivially legal", () => {
    expect(isLegalFor([], defs, "core").ok).toBe(true);
    expect(isLegalFor([], defs, "infinity").ok).toBe(true);
  });

  it("collects multiple issues in one pass", () => {
    const result = isLegalFor(
      [
        { definitionId: "koda-talkative-cub", count: 4 },          // ok
        { definitionId: "ariel-on-human-legs", count: 4 },         // set_not_legal
        { definitionId: "hiram-flaversham-toymaker", count: 4 },   // set_not_legal for Core
      ],
      defs,
      "core",
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.reason === "set_not_legal")).toBe(true);
  });
});
