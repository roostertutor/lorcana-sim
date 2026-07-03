import { describe, expect, it } from "vitest";
import type { DeckEntry } from "../engine/initializer.js";
import { CARD_DEFINITIONS } from "../cards/cardDefinitions.js";
import {
  CORE_ROTATIONS,
  INFINITY_ROTATIONS,
  type GameFormat,
  isCardLegalInFormat,
  isLegalFor,
  isRankedFormat,
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
const CORE_S13: GameFormat = { family: "core", rotation: "s13" };
const INF_S11: GameFormat = { family: "infinity", rotation: "s11" };
const INF_S12: GameFormat = { family: "infinity", rotation: "s12" };
const INF_S13: GameFormat = { family: "infinity", rotation: "s13" };

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

  it("CORE_ROTATIONS.s13 is a cut step: drops sets 5-8, adds set 13 → {9,10,11,12,13}", () => {
    const entry = CORE_ROTATIONS.s13;
    for (const s of ["9", "10", "11", "12", "13"]) {
      expect(entry.legalSets.has(s)).toBe(true);
    }
    // Sets 5-8 rotated out; sets 1-4 were never in this cadence.
    for (const s of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(entry.legalSets.has(s)).toBe(false);
    }
  });

  it("Core banlists are empty in every rotation", () => {
    expect(CORE_ROTATIONS.s11.banlist.size).toBe(0);
    expect(CORE_ROTATIONS.s12.banlist.size).toBe(0);
    expect(CORE_ROTATIONS.s13.banlist.size).toBe(0);
  });

  it("Infinity banlist carries Hiram across every rotation", () => {
    expect(INFINITY_ROTATIONS.s11.banlist.has("hiram-flaversham-toymaker")).toBe(true);
    expect(INFINITY_ROTATIONS.s12.banlist.has("hiram-flaversham-toymaker")).toBe(true);
    expect(INFINITY_ROTATIONS.s13.banlist.has("hiram-flaversham-toymaker")).toBe(true);
  });

  it("Infinity-s13 is additive over s12: every s12 set + set 13 (cuts don't affect Infinity)", () => {
    const s12 = INFINITY_ROTATIONS.s12;
    const s13 = INFINITY_ROTATIONS.s13;
    for (const s of s12.legalSets) {
      expect(s13.legalSets.has(s)).toBe(true);
    }
    expect(s13.legalSets.has("13")).toBe(true);
    // Sets 5-8 are cut from CORE s13 but remain legal in INFINITY s13.
    for (const s of ["5", "6", "7", "8"]) {
      expect(s13.legalSets.has(s)).toBe(true);
    }
  });

  it("Infinity-s11 is a frozen snapshot: sets 1-11 + s11-era promos, NOT set 12", () => {
    const entry = INFINITY_ROTATIONS.s11;
    for (const s of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "P1", "P2", "P3", "C1", "D23", "DIS"]) {
      expect(entry.legalSets.has(s)).toBe(true);
    }
    // Set 12 (and post-s11 promos like C2) must NOT be in the s11 snapshot —
    // an Infinity-s11-stamped deck shouldn't silently absorb new-set cards.
    expect(entry.legalSets.has("12")).toBe(false);
    expect(entry.legalSets.has("C2")).toBe(false);
  });

  it("Infinity-s12 is additive over s11: every s11 set + set 12 + C2", () => {
    const s11 = INFINITY_ROTATIONS.s11;
    const s12 = INFINITY_ROTATIONS.s12;
    // Every s11 set is also legal in s12 (additive).
    for (const s of s11.legalSets) {
      expect(s12.legalSets.has(s)).toBe(true);
    }
    // Plus the new arrivals.
    expect(s12.legalSets.has("12")).toBe(true);
    expect(s12.legalSets.has("C2")).toBe(true);
  });

  it("Set-13 pre-release: s12 (live) AND s13 (staged) offered; s11 retired", () => {
    // s11 retired (kept for stored-deck validation only); s12 still live; s13
    // staged so players can pre-build. Update on the Set 13 release-day
    // switchover (retire s12, mark s13 ranked).
    expect(CORE_ROTATIONS.s11.offeredForNewDecks).toBe(false);
    expect(CORE_ROTATIONS.s12.offeredForNewDecks).toBe(true);
    expect(CORE_ROTATIONS.s13.offeredForNewDecks).toBe(true);
    expect(INFINITY_ROTATIONS.s11.offeredForNewDecks).toBe(false);
    expect(INFINITY_ROTATIONS.s12.offeredForNewDecks).toBe(true);
    expect(INFINITY_ROTATIONS.s13.offeredForNewDecks).toBe(true);
  });

  it("ranked flag — s12 live (ranked), s13 staged (unranked), s11 retired (unranked)", () => {
    // s13 is offered for pre-building but NOT ranked until Set 13 release day.
    // Same flag applies to Core and Infinity in the same time window.
    expect(CORE_ROTATIONS.s11.ranked).toBe(false);
    expect(CORE_ROTATIONS.s12.ranked).toBe(true);
    expect(CORE_ROTATIONS.s13.ranked).toBe(false);
    expect(INFINITY_ROTATIONS.s11.ranked).toBe(false);
    expect(INFINITY_ROTATIONS.s12.ranked).toBe(true);
    expect(INFINITY_ROTATIONS.s13.ranked).toBe(false);
  });

  it("deckSize is 60 across every sanctioned-Constructed rotation", () => {
    // All current rotations are Lorcana sanctioned Constructed (Core +
    // Infinity), which Ravensburger OP rules specify as exactly 60 cards.
    // Limited formats (Sealed, Draft, Pack Rush — BACKLOG) will land with
    // smaller counts on their own rotation entries.
    expect(CORE_ROTATIONS.s11.deckSize).toBe(60);
    expect(CORE_ROTATIONS.s12.deckSize).toBe(60);
    expect(CORE_ROTATIONS.s13.deckSize).toBe(60);
    expect(INFINITY_ROTATIONS.s11.deckSize).toBe(60);
    expect(INFINITY_ROTATIONS.s12.deckSize).toBe(60);
    expect(INFINITY_ROTATIONS.s13.deckSize).toBe(60);
  });
});

describe("isRankedFormat", () => {
  it("returns ranked flag for the resolved rotation (Core)", () => {
    expect(isRankedFormat({ family: "core", rotation: "s11" })).toBe(false);
    expect(isRankedFormat({ family: "core", rotation: "s12" })).toBe(true);
    expect(isRankedFormat({ family: "core", rotation: "s13" })).toBe(false);
  });

  it("returns ranked flag for the resolved rotation (Infinity)", () => {
    expect(isRankedFormat({ family: "infinity", rotation: "s11" })).toBe(false);
    expect(isRankedFormat({ family: "infinity", rotation: "s12" })).toBe(true);
    expect(isRankedFormat({ family: "infinity", rotation: "s13" })).toBe(false);
  });

  it("throws on unknown rotation id", () => {
    expect(() =>
      // @ts-expect-error — deliberately invalid rotation id
      isRankedFormat({ family: "core", rotation: "s99" }),
    ).toThrow(/Unknown rotation/);
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
  });

  it("cut step: set-5 card is rotated OUT of Core s13 but still legal in Infinity s13", () => {
    // koda-talkative-cub is set 5 only. The s12→s13 cut drops sets 5-8, so it
    // leaves Core s13 — but Infinity never rotates, so it stays legal there.
    const def = CARD_DEFINITIONS["koda-talkative-cub"]!;
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(true); // still in pre-cut Core
    expect(isCardLegalInFormat(def, CORE_S13)).toBe(false); // cut out
    expect(isCardLegalInFormat(def, INF_S13)).toBe(true); // Infinity unaffected
  });

  it("cut step: set-12 card survives the s13 cut (Core and Infinity)", () => {
    const def = CARD_DEFINITIONS["dale-excited-friend"]!;
    expect(def.setId).toBe("12");
    expect(isCardLegalInFormat(def, CORE_S13)).toBe(true);
    expect(isCardLegalInFormat(def, INF_S13)).toBe(true);
  });

  it("set-13 card is legal in s13 (Core + Infinity) but rejected in s12 (rotation-gated)", () => {
    // woody-helping-a-friend is a set-13-exclusive printing (single row, no
    // reprints — verified against card-set-*.json). Before the Set 13 import
    // landed, the registry referenced set "13" but no card carried that setId,
    // so the s13 legal-set entry was never exercised by a real definition.
    const def = CARD_DEFINITIONS["woody-helping-a-friend"]!;
    expect(def.setId).toBe("13");
    expect(isCardLegalInFormat(def, CORE_S13)).toBe(true); // {9,10,11,12,13}
    expect(isCardLegalInFormat(def, INF_S13)).toBe(true); // s12 snapshot + 13
    expect(isCardLegalInFormat(def, CORE_S12)).toBe(false); // set 13 not yet in Core s12
    expect(isCardLegalInFormat(def, INF_S12)).toBe(false); // frozen s12 snapshot excludes 13
  });

  // Regression test for the 2026-04-27 Infinity-snapshot bug: pre-fix, both
  // INFINITY_ROTATIONS pointed at a single shared INFINITY_ALL_SETS constant
  // including set 12, so an Infinity-s11-stamped deck could silently run a
  // set-12 card. Each Infinity rotation should be a frozen card-pool snapshot.
  it("set-12-only card is rejected by Infinity-s11 (frozen snapshot) but accepted by Infinity-s12", () => {
    const def = CARD_DEFINITIONS["dale-excited-friend"]!;
    expect(def.setId).toBe("12");
    expect(isCardLegalInFormat(def, INF_S11)).toBe(false); // ← was true pre-fix
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

  // Most tests below construct small decks that exercise per-card legality
  // (banned / set_not_legal / unknown_card). The deck-wide count check
  // (added 2026-05-18) would otherwise flag every such deck with a
  // wrong_count issue, drowning out the per-card signal we're actually
  // testing. `padToLegalSize` pads with a known-legal card to hit the
  // rotation's required deckSize so per-card assertions stay clean.
  function padToLegalSize(
    entries: DeckEntry[],
    format: GameFormat,
    padCardId: string = "koda-talkative-cub", // set 5 — legal in every current rotation
  ): DeckEntry[] {
    const entry =
      format.family === "core" ? CORE_ROTATIONS[format.rotation] : INFINITY_ROTATIONS[format.rotation];
    const have = entries.reduce((s, e) => s + e.count, 0);
    const need = entry.deckSize - have;
    if (need <= 0) return entries;
    return [...entries, { definitionId: padCardId, count: need }];
  }

  it("accepts an s12 Core deck of only Core-legal cards (padded to 60)", () => {
    const result = isLegalFor(
      padToLegalSize([{ definitionId: "koda-talkative-cub", count: 4 }], CORE_S12),
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags set-12 card in s11 Core with set_not_legal + rotation-specific message", () => {
    const result = isLegalFor(
      padToLegalSize([{ definitionId: "dale-excited-friend", count: 4 }], CORE_S11),
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
      padToLegalSize([{ definitionId: "dale-excited-friend", count: 4 }], CORE_S12),
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(true);
  });

  it("flags set-1-only card as set_not_legal in Core (either rotation)", () => {
    for (const fmt of [CORE_S11, CORE_S12]) {
      const result = isLegalFor(
        padToLegalSize([{ definitionId: "ariel-on-human-legs", count: 4 }], fmt),
        defs,
        fmt,
      );
      expect(result.ok).toBe(false);
      expect(result.issues[0]!.reason).toBe("set_not_legal");
    }
  });

  it("accepts a reprinted card in Core via its newer printing", () => {
    const result = isLegalFor(
      padToLegalSize([{ definitionId: "captain-hook-forceful-duelist", count: 4 }], CORE_S12),
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(true);
  });

  // Regression test for the 2026-04-27 Infinity-snapshot bug. The deck-level
  // function `isLegalFor` is the actual entry point used by the deck builder
  // and matchmaker — confirms the snapshot fix flows through both layers.
  it("rejects an Infinity-s11 deck containing a set-12 card (frozen-snapshot regression)", () => {
    const result = isLegalFor(
      padToLegalSize([{ definitionId: "dale-excited-friend", count: 4 }], INF_S11),
      defs,
      INF_S11,
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.reason).toBe("set_not_legal");
    expect(result.issues[0]!.message).toContain("Set 11 Infinity");
  });

  it("accepts an Infinity-s12 deck containing a set-12 card", () => {
    const result = isLegalFor(
      padToLegalSize([{ definitionId: "dale-excited-friend", count: 4 }], INF_S12),
      defs,
      INF_S12,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts an Infinity-s11 deck of only s11-era cards (set 1 + reprint into set 8)", () => {
    // ariel-on-human-legs is set 1 only; captain-hook-forceful-duelist is
    // set 1 + set 8 reprint. Both are in INFINITY_S11_SETS.
    const result = isLegalFor(
      padToLegalSize(
        [
          { definitionId: "ariel-on-human-legs", count: 4 },
          { definitionId: "captain-hook-forceful-duelist", count: 4 },
        ],
        INF_S11,
      ),
      defs,
      INF_S11,
    );
    expect(result.ok).toBe(true);
  });

  it("flags Hiram Flaversham Toymaker as banned in both Infinity rotations", () => {
    for (const fmt of [INF_S11, INF_S12]) {
      const result = isLegalFor(
        padToLegalSize([{ definitionId: "hiram-flaversham-toymaker", count: 4 }], fmt),
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
      padToLegalSize([{ definitionId: "nonexistent-card-slug", count: 4 }], INF_S12),
      defs,
      INF_S12,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason === "unknown_card")).toBe(true);
  });

  it("empty deck is rejected as wrong_count (0 ≠ 60) in every rotation", () => {
    for (const fmt of [CORE_S11, CORE_S12, INF_S11, INF_S12]) {
      const result = isLegalFor([], defs, fmt);
      expect(result.ok).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.reason).toBe("wrong_count");
      expect(result.issues[0]!.message).toMatch(/exactly 60 cards/);
    }
  });

  it("flags 45-card deck as wrong_count with the deficit in the message", () => {
    const entries: DeckEntry[] = [{ definitionId: "koda-talkative-cub", count: 45 }];
    const result = isLegalFor(entries, defs, CORE_S12);
    expect(result.ok).toBe(false);
    const wrongCount = result.issues.find((i) => i.reason === "wrong_count");
    expect(wrongCount).toBeDefined();
    expect(wrongCount!.message).toContain("60");
    expect(wrongCount!.message).toContain("45");
  });

  it("flags 61-card deck as wrong_count (overshoot, not just undershoot)", () => {
    const entries: DeckEntry[] = [{ definitionId: "koda-talkative-cub", count: 61 }];
    const result = isLegalFor(entries, defs, CORE_S12);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason === "wrong_count")).toBe(true);
  });

  it("emits both wrong_count AND per-card issues in the same pass (no early-exit)", () => {
    // 4 + 4 = 8 cards (wrong_count) AND ariel-on-human-legs not legal in Core
    // (set_not_legal). UI relies on both showing up so the user fixes
    // everything before re-submitting.
    const result = isLegalFor(
      [
        { definitionId: "koda-talkative-cub", count: 4 },
        { definitionId: "ariel-on-human-legs", count: 4 },
      ],
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason === "wrong_count")).toBe(true);
    expect(result.issues.some((i) => i.reason === "set_not_legal")).toBe(true);
  });

  it("collects multiple per-card issues in one pass (60-card padded baseline)", () => {
    const result = isLegalFor(
      padToLegalSize(
        [
          { definitionId: "ariel-on-human-legs", count: 4 },         // set_not_legal in Core
          { definitionId: "hiram-flaversham-toymaker", count: 4 },   // set_not_legal in Core (set 2 not in s12 legal sets)
        ],
        CORE_S12,
      ),
      defs,
      CORE_S12,
    );
    expect(result.ok).toBe(false);
    const setNotLegalCount = result.issues.filter((i) => i.reason === "set_not_legal").length;
    expect(setNotLegalCount).toBe(2);
    // Padding hit 60 → no wrong_count.
    expect(result.issues.some((i) => i.reason === "wrong_count")).toBe(false);
  });
});

describe("listOfferedRotations", () => {
  it("returns s12 (live) + s13 (staged) for Core; s11 retired", () => {
    const offered = listOfferedRotations("core");
    expect(offered.map((o) => o.id)).toEqual(["s12", "s13"]);
    expect(offered.map((o) => o.entry.displayName)).toEqual(["Set 12 Core", "Set 13 Core"]);
  });

  it("returns s12 (live) + s13 (staged) for Infinity; s11 retired", () => {
    const offered = listOfferedRotations("infinity");
    expect(offered.map((o) => o.id)).toEqual(["s12", "s13"]);
    expect(offered.map((o) => o.entry.displayName)).toEqual(["Set 12 Infinity", "Set 13 Infinity"]);
  });
});
