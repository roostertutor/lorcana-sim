// =============================================================================
// STATE FILTER TESTS
//
// Covers the anti-cheat redaction of `actionLog` entries. The pre-existing
// behavior (cards / cardsUnder stubbing) is exercised end-to-end via the
// game.ts route in real MP play; these tests focus on the per-log-entry
// `privateTo` filtering added 2026-04-28 to plug the opening-hand /
// per-turn-draw card-name leak.
//
// Per CLAUDE.md: each rejection case (privateTo === viewer / privateTo ===
// opponent / privateTo undefined) gets a positive AND negative assertion so
// regressions in either direction are caught.
// =============================================================================

import { describe, it, expect } from "vitest"
import type { GameState, GameLogEntry, ResolvedRef } from "@lorcana-sim/engine"
import { filterStateForPlayer } from "./stateFilter.js"

/**
 * Build a minimal `ResolvedRef`-shaped snapshot. The filter only reads
 * `privateTo`; everything else is structural padding to satisfy the type
 * (and to make leak assertions concrete — if the filter accidentally let
 * the snapshot through, the `name` / `fullName` would leak verbatim).
 */
function makeResolvedRef(
  overrides: Partial<ResolvedRef> = {},
): ResolvedRef {
  return {
    instanceId: "card-1",
    definitionId: "mickey-001",
    name: "Mickey Mouse",
    fullName: "Mickey Mouse - Brave Little Tailor",
    ownerId: "player1",
    cost: 4,
    ...overrides,
  }
}

/**
 * Build a minimal GameState skeleton with the fields the filter actually reads.
 * The filter walks `cards`, `zones`, `actionLog`, `lastRevealedCards`, and
 * `lastRevealedHand` — anything else can be stubbed `as GameState`. Keeping
 * the skeleton small makes the assertions read clearly: each test only sets
 * the fields it cares about.
 */
function makeStateWithLog(actionLog: GameLogEntry[]): GameState {
  return {
    cards: {},
    zones: {
      player1: { hand: [], deck: [], play: [], inkwell: [], discard: [] },
      player2: { hand: [], deck: [], play: [], inkwell: [], discard: [] },
    },
    actionLog,
  } as unknown as GameState
}

/**
 * Build a minimal GameState with the ResolvedRef-bearing fields set. Mirrors
 * `makeStateWithLog` — only the fields the filter touches are populated, so
 * each assertion's signal is unambiguous. Pass `undefined` for any of the
 * three fields to exclude it from the test fixture (the filter must handle
 * absence gracefully).
 */
function makeStateWithResolvedRefs(opts: {
  lastResolvedTarget?: ResolvedRef
  lastResolvedSource?: ResolvedRef
  lastDiscarded?: ResolvedRef[]
}): GameState {
  return {
    cards: {},
    zones: {
      player1: { hand: [], deck: [], play: [], inkwell: [], discard: [] },
      player2: { hand: [], deck: [], play: [], inkwell: [], discard: [] },
    },
    actionLog: [],
    ...(opts.lastResolvedTarget && { lastResolvedTarget: opts.lastResolvedTarget }),
    ...(opts.lastResolvedSource && { lastResolvedSource: opts.lastResolvedSource }),
    ...(opts.lastDiscarded && { lastDiscarded: opts.lastDiscarded }),
  } as unknown as GameState
}

describe("filterStateForPlayer — actionLog redaction", () => {
  it("preserves entries with privateTo === undefined (public log lines)", () => {
    const publicEntry: GameLogEntry = {
      timestamp: 1000,
      turn: 1,
      playerId: "player1",
      message: "player1 passed the turn.",
      type: "turn_end",
    }
    const state = makeStateWithLog([publicEntry])

    const filteredForP1 = filterStateForPlayer(state, "player1")
    const filteredForP2 = filterStateForPlayer(state, "player2")

    expect(filteredForP1.actionLog[0]?.message).toBe("player1 passed the turn.")
    expect(filteredForP2.actionLog[0]?.message).toBe("player1 passed the turn.")
  })

  it("preserves entries when privateTo === viewer", () => {
    const privateForP1: GameLogEntry = {
      timestamp: 1000,
      turn: 1,
      playerId: "player1",
      message: "player1 drew Mickey Mouse - Brave Little Tailor.",
      type: "card_drawn",
      privateTo: "player1",
    }
    const state = makeStateWithLog([privateForP1])

    const filteredForP1 = filterStateForPlayer(state, "player1")

    // The viewer is the audience the engine scoped this entry to — keep verbatim.
    expect(filteredForP1.actionLog[0]?.message).toBe(
      "player1 drew Mickey Mouse - Brave Little Tailor.",
    )
  })

  it("redacts message when privateTo !== viewer (the leak fix)", () => {
    const privateForP1: GameLogEntry = {
      timestamp: 1000,
      turn: 1,
      playerId: "player1",
      message: "player1 drew Mickey Mouse - Brave Little Tailor.",
      type: "card_drawn",
      privateTo: "player1",
    }
    const state = makeStateWithLog([privateForP1])

    const filteredForP2 = filterStateForPlayer(state, "player2")

    // P2 sees a generic redaction — no card name, but player + timing preserved.
    expect(filteredForP2.actionLog[0]?.message).not.toContain("Mickey Mouse")
    expect(filteredForP2.actionLog[0]?.message).not.toContain("Brave Little Tailor")
    expect(filteredForP2.actionLog[0]?.message).toContain("player1")
    expect(filteredForP2.actionLog[0]?.message).toContain("drew")
  })

  it("redacts opening-hand entries that name multiple cards", () => {
    // initializer.ts:264 emits one entry per player listing all 7 opening cards.
    // Engine-expert's privateTo stamp covers this same entry; verify redaction
    // strips ALL card names (no partial leak via comma-separated parse).
    const openingHand: GameLogEntry = {
      timestamp: 1000,
      turn: 1,
      playerId: "player1",
      message:
        "player1 drew: Mickey Mouse - Brave Little Tailor, Elsa - Snow Queen, Hades - Lord of the Underworld, Ariel - Spectacular Singer, Stitch - Rock Star, Maleficent - Sorceress, Belle - Hidden Depths.",
      type: "card_drawn",
      privateTo: "player1",
    }
    const state = makeStateWithLog([openingHand])

    const filteredForP2 = filterStateForPlayer(state, "player2")

    const redacted = filteredForP2.actionLog[0]?.message ?? ""
    // None of the 7 card names should survive.
    for (const name of [
      "Mickey Mouse",
      "Elsa",
      "Snow Queen",
      "Hades",
      "Ariel",
      "Stitch",
      "Maleficent",
      "Belle",
      "Hidden Depths",
    ]) {
      expect(redacted).not.toContain(name)
    }
  })

  it("preserves non-message fields (playerId, turn, timestamp, type) on redacted entries", () => {
    // Anti-cheat redacts only the message string — UI relies on type/turn/
    // timestamp/playerId to group, render the right icon, and order entries.
    const privateForP1: GameLogEntry = {
      timestamp: 1234567890,
      turn: 5,
      playerId: "player1",
      message: "player1 drew Mickey Mouse - Brave Little Tailor.",
      type: "card_drawn",
      privateTo: "player1",
    }
    const state = makeStateWithLog([privateForP1])

    const filteredForP2 = filterStateForPlayer(state, "player2")
    const entry = filteredForP2.actionLog[0]!

    expect(entry.timestamp).toBe(1234567890)
    expect(entry.turn).toBe(5)
    expect(entry.playerId).toBe("player1")
    expect(entry.type).toBe("card_drawn")
  })

  it("redacts P1.11 private inkwell logs (effect-driven ink reveals card identity to inker only)", () => {
    // Effect-driven ink (Gramma Tala MAUI'S OBSESSION, Fishbone Quill, Perdita)
    // names the card moved into the face-down inkwell. Server must redact
    // the message body for the non-inking viewer per CRD 4.1.4.
    const privateInk: GameLogEntry = {
      timestamp: 1000,
      turn: 1,
      playerId: "player1",
      message: "player1 put Mickey Mouse - Brave Little Tailor into their inkwell.",
      type: "card_put_into_inkwell",
      privateTo: "player1",
    }
    const state = makeStateWithLog([privateInk])

    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP2.actionLog[0]?.message).not.toContain("Mickey Mouse")
    expect(forP2.actionLog[0]?.message).not.toContain("Brave Little Tailor")
    expect(forP2.actionLog[0]?.message).toContain("player1")
    expect(forP2.actionLog[0]?.message).toContain("inkwell")
  })

  it("redacts P1.11 private hand-peek logs (look_at_hand reveals opponent's hand to looker only)", () => {
    // look_at_hand (Dolores Madrigal NO SECRETS) lets the controller see the
    // target's hand; the message names every card. The non-looker must see
    // only that the peek occurred, not the cards.
    const peek: GameLogEntry = {
      timestamp: 1000,
      turn: 3,
      playerId: "player1",
      message: "player1 looked at player2's hand: [Mickey Mouse, Elsa - Snow Queen, Hades].",
      type: "hand_revealed",
      privateTo: "player1",
    }
    const state = makeStateWithLog([peek])

    const forP2 = filterStateForPlayer(state, "player2")

    for (const name of ["Mickey Mouse", "Elsa", "Snow Queen", "Hades"]) {
      expect(forP2.actionLog[0]?.message).not.toContain(name)
    }
    expect(forP2.actionLog[0]?.message).toContain("player1")
  })

  it("filters a mixed log correctly per-viewer (sanity end-to-end)", () => {
    // Realistic mid-game log shape: P1 draws privately, then plays publicly,
    // then P2 draws privately. Verify each viewer sees exactly what they should.
    const log: GameLogEntry[] = [
      {
        timestamp: 1,
        turn: 1,
        playerId: "player1",
        message: "player1 drew Mickey Mouse - Brave Little Tailor.",
        type: "card_drawn",
        privateTo: "player1",
      },
      {
        timestamp: 2,
        turn: 1,
        playerId: "player1",
        message: "player1 played Mickey Mouse - Brave Little Tailor.",
        type: "card_played",
      },
      {
        timestamp: 3,
        turn: 2,
        playerId: "player2",
        message: "player2 drew Elsa - Snow Queen.",
        type: "card_drawn",
        privateTo: "player2",
      },
    ]
    const state = makeStateWithLog(log)

    const forP1 = filterStateForPlayer(state, "player1")
    const forP2 = filterStateForPlayer(state, "player2")

    // P1 sees: own draw verbatim, public play verbatim, opponent draw redacted
    expect(forP1.actionLog[0]?.message).toContain("Mickey Mouse")
    expect(forP1.actionLog[1]?.message).toContain("Mickey Mouse")
    expect(forP1.actionLog[2]?.message).not.toContain("Elsa")
    expect(forP1.actionLog[2]?.message).not.toContain("Snow Queen")

    // P2 sees: opponent draw redacted, public play verbatim, own draw verbatim
    expect(forP2.actionLog[0]?.message).not.toContain("Mickey Mouse")
    // The public play line publicly identifies the card name — that's correct.
    expect(forP2.actionLog[1]?.message).toContain("Mickey Mouse")
    expect(forP2.actionLog[2]?.message).toContain("Elsa")
  })
})

// =============================================================================
// ResolvedRef privacy — `lastResolvedTarget`, `lastResolvedSource`, `lastDiscarded`
//
// These three GameState fields hold ResolvedRef snapshots with typed `name` +
// `fullName` fields. A tutor that resolves a card from deck → hand leaves the
// searched card's identity exposed in the unfiltered state shipped to the
// opponent. Engine-expert stamps `privateTo` on the writers; the filter drops
// the snapshot wholesale for non-audience viewers (vs. partial scrub, which
// preserves structure that itself leaks "they tutored *something*").
//
// Test matrix (per field):
//   - privateTo undefined → both viewers see the snapshot verbatim
//   - privateTo === viewerId → viewer sees verbatim
//   - privateTo !== viewerId → snapshot dropped from viewer's filtered state
// =============================================================================

describe("filterStateForPlayer — lastResolvedTarget privacy", () => {
  it("preserves snapshot when privateTo === undefined (public)", () => {
    const ref = makeResolvedRef()
    const state = makeStateWithResolvedRefs({ lastResolvedTarget: ref })

    const forP1 = filterStateForPlayer(state, "player1")
    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP1.lastResolvedTarget?.name).toBe("Mickey Mouse")
    expect(forP2.lastResolvedTarget?.name).toBe("Mickey Mouse")
  })

  it("preserves snapshot when privateTo === viewer", () => {
    const ref = makeResolvedRef({ privateTo: "player1" })
    const state = makeStateWithResolvedRefs({ lastResolvedTarget: ref })

    const forP1 = filterStateForPlayer(state, "player1")

    expect(forP1.lastResolvedTarget?.name).toBe("Mickey Mouse")
    expect(forP1.lastResolvedTarget?.fullName).toBe(
      "Mickey Mouse - Brave Little Tailor",
    )
  })

  it("drops snapshot when privateTo !== viewer (the leak fix)", () => {
    // Tutor resolves a card from deck → P1's hand. The unfiltered state has
    // lastResolvedTarget.name = "Mickey Mouse"; the opponent must not see it.
    const ref = makeResolvedRef({ privateTo: "player1" })
    const state = makeStateWithResolvedRefs({ lastResolvedTarget: ref })

    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP2.lastResolvedTarget).toBeUndefined()
  })
})

describe("filterStateForPlayer — lastResolvedSource privacy", () => {
  it("preserves snapshot when privateTo === undefined (public)", () => {
    const ref = makeResolvedRef({ name: "Hades", fullName: "Hades - Lord of the Underworld" })
    const state = makeStateWithResolvedRefs({ lastResolvedSource: ref })

    const forP1 = filterStateForPlayer(state, "player1")
    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP1.lastResolvedSource?.name).toBe("Hades")
    expect(forP2.lastResolvedSource?.name).toBe("Hades")
  })

  it("preserves snapshot when privateTo === viewer", () => {
    const ref = makeResolvedRef({
      name: "Hades",
      fullName: "Hades - Lord of the Underworld",
      privateTo: "player2",
    })
    const state = makeStateWithResolvedRefs({ lastResolvedSource: ref })

    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP2.lastResolvedSource?.name).toBe("Hades")
  })

  it("drops snapshot when privateTo !== viewer (the leak fix)", () => {
    const ref = makeResolvedRef({
      name: "Hades",
      fullName: "Hades - Lord of the Underworld",
      privateTo: "player2",
    })
    const state = makeStateWithResolvedRefs({ lastResolvedSource: ref })

    const forP1 = filterStateForPlayer(state, "player1")

    expect(forP1.lastResolvedSource).toBeUndefined()
  })
})

describe("filterStateForPlayer — lastDiscarded privacy", () => {
  it("preserves array when all elements have privateTo === undefined (public)", () => {
    const refs = [
      makeResolvedRef({ instanceId: "c1", name: "Mickey" }),
      makeResolvedRef({ instanceId: "c2", name: "Elsa" }),
    ]
    const state = makeStateWithResolvedRefs({ lastDiscarded: refs })

    const forP1 = filterStateForPlayer(state, "player1")
    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP1.lastDiscarded).toHaveLength(2)
    expect(forP2.lastDiscarded).toHaveLength(2)
    expect(forP2.lastDiscarded?.[0]?.name).toBe("Mickey")
  })

  it("preserves array when privateTo === viewer for all elements", () => {
    const refs = [
      makeResolvedRef({ instanceId: "c1", name: "Mickey", privateTo: "player1" }),
      makeResolvedRef({ instanceId: "c2", name: "Elsa", privateTo: "player1" }),
    ]
    const state = makeStateWithResolvedRefs({ lastDiscarded: refs })

    const forP1 = filterStateForPlayer(state, "player1")

    expect(forP1.lastDiscarded).toHaveLength(2)
    expect(forP1.lastDiscarded?.[0]?.name).toBe("Mickey")
    expect(forP1.lastDiscarded?.[1]?.name).toBe("Elsa")
  })

  it("drops array entirely when privateTo !== viewer for all elements", () => {
    // Discard-from-hand resolves multiple cards privately to the discarding
    // player. Opponent must see no card identities — drop the whole array.
    const refs = [
      makeResolvedRef({ instanceId: "c1", name: "Mickey", privateTo: "player1" }),
      makeResolvedRef({ instanceId: "c2", name: "Elsa", privateTo: "player1" }),
    ]
    const state = makeStateWithResolvedRefs({ lastDiscarded: refs })

    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP2.lastDiscarded).toBeUndefined()
  })

  it("filters per-element when privacy is heterogeneous", () => {
    // Mixed-privacy discard: one public, one private. Engine doesn't currently
    // emit this shape (writers stamp uniformly), but the filter is per-element
    // for future-proofing. Verify the public element survives, the private one
    // gets stripped, in the opponent's view.
    const refs = [
      makeResolvedRef({ instanceId: "c1", name: "Mickey" }), // public
      makeResolvedRef({ instanceId: "c2", name: "Elsa", privateTo: "player1" }),
    ]
    const state = makeStateWithResolvedRefs({ lastDiscarded: refs })

    const forP2 = filterStateForPlayer(state, "player2")

    expect(forP2.lastDiscarded).toHaveLength(1)
    expect(forP2.lastDiscarded?.[0]?.name).toBe("Mickey")
  })
})

describe("filterStateForPlayer — ResolvedRef end-to-end leak scenario", () => {
  it("tutor → hand: opponent sees no trace of the searched card's identity", () => {
    // Realistic shape: P1 plays a tutor that resolves a card from deck → hand.
    // Engine sets lastResolvedTarget = { name, fullName, ..., privateTo: "player1" }.
    // Pre-fix: P2's filtered state contained the card's name verbatim.
    // Post-fix: lastResolvedTarget is dropped entirely from P2's view.
    const tutoredCard = makeResolvedRef({
      instanceId: "card-tutored",
      name: "Belle",
      fullName: "Belle - Hidden Depths",
      privateTo: "player1",
    })
    const state = makeStateWithResolvedRefs({ lastResolvedTarget: tutoredCard })

    const forP2 = filterStateForPlayer(state, "player2")

    // Field is gone — no name leak through name OR fullName OR any other field.
    expect(forP2.lastResolvedTarget).toBeUndefined()
    // Sanity: serialized payload doesn't contain the card name anywhere.
    const serialized = JSON.stringify(forP2)
    expect(serialized).not.toContain("Belle")
    expect(serialized).not.toContain("Hidden Depths")
  })
})
