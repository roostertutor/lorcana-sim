// =============================================================================
// FORMAT LEGALITY — Core vs. Infinity (multi-rotation registry)
//
// Lorcana has two sanctioned multiplayer formats:
//   - Core: rotating — every 4 sets, the oldest 4 sets drop. Between cuts, new
//           sets are additive. Each rotation snapshot has its own legal set
//           list and (separate) banlist.
//   - Infinity: no set rotation — every set is always legal. Rotations still
//           exist for banlist progression (the banlist can change between
//           rotations), but the legal-set list stays full.
//
// Why a registry (rather than a single "current" constant):
//   Pre-release windows need to offer BOTH the live rotation AND the upcoming
//   rotation as deck-creation targets simultaneously. Stored decks keep their
//   rotation stamp forever so they still validate against the rotation they
//   were built for, even after that rotation stops accepting new decks.
//
// Rotation naming is shared across the two families: `s11`, `s12`, `s13` etc.
// refer to the same time window; only the legalSets/banlist differ between
// CORE_ROTATIONS[id] and INFINITY_ROTATIONS[id].
//
// Reprint rule: a card is legal in a rotation iff ANY of its printings
// satisfies the rotation's set-list (or, for Infinity, is not on the banlist).
// Since variants/printings share a single definitionId and gameplay rules, a
// user holding a set-1 physical copy of a card reprinted in set 8 can play
// their set-1 copy in a rotation that includes set 8.
//
// Maintenance: when Ravensburger announces the next rotation's set list, add
// a new entry to CORE_ROTATIONS / INFINITY_ROTATIONS. Pre-release: set
// `offeredForNewDecks: true` on the new entry while keeping the current one
// also `true`. On release day: flip the prior rotation's `offeredForNewDecks`
// to `false`. No legality logic ever changes; it's all registry edits.
// =============================================================================

import type { CardDefinition } from "../types/index.js";
import type { DeckEntry } from "../engine/initializer.js";

/** Rotation ids. Add "s14" etc. here (and to the registries below) when
 *  Ravensburger announces the next rotation's set list. */
export type RotationId = "s11" | "s12" | "s13";

/** One rotation's legal-set snapshot + banlist + whether new decks can still
 *  be created under it. */
export interface RotationEntry {
  /** Set ids (matching CardDefinition.setId) legal in this rotation. */
  readonly legalSets: ReadonlySet<string>;
  /** Card definitionIds banned in this rotation. Separate from legalSets —
   *  a card can be in a legal set and still be banned. */
  readonly banlist: ReadonlySet<string>;
  /** Required deck size for this rotation. Lorcana sanctioned Constructed
   *  (Core, Infinity) is exactly 60. Limited formats (Sealed, Draft, Pack
   *  Rush) will land with smaller counts (35-40) when they ship — those
   *  rotations override this field. `isLegalFor` enforces equality against
   *  the sum of `DeckEntry.count`.
   *
   *  Field is exact-N today (treat as both min and max). If a future format
   *  needs a min+max range or sideboard handling, rename to `deckSizeMin`
   *  + `deckSizeMax?` rather than overloading this field with a richer
   *  shape. Migration cost is trivial (4 rotation entries) and keeps the
   *  current Constructed read-path one numeric comparison. */
  readonly deckSize: number;
  /** When true, the UI offers this rotation in the "new deck" dropdown.
   *  Stored decks stamped with a rotation where this is now `false` still
   *  validate against that rotation — they just can't be CREATED with it. */
  readonly offeredForNewDecks: boolean;
  /** When true, games played under this rotation count for ELO / ranked
   *  ladders and ranked matchmaking. False during pre-release / staged-test
   *  windows where new sets are playable but not yet officially live. The
   *  matchmaking server's `updateElo` and ranked-queue endpoints early-return
   *  on unranked rotations; the UI uses this to gate the Find Ranked button. */
  readonly ranked: boolean;
  /** Human-readable label for UI surfacing (e.g. "Set 12 Core"). */
  readonly displayName: string;
}

/** Core rotations — every 4 sets, oldest 4 drop. Cadence per Ravensburger OP.
 *
 *  Current state (Set 13 pre-release / staged):
 *   - s11: retired. Stays in the registry forever so stored decks stamped
 *          `s11` keep validating against their original card pool, but no
 *          new decks or games can be created under it.
 *   - s12: live format, sets 5-12 (8 sets). Offered for new decks; ranked
 *          games count for ELO. Remains live until the Set 13 release-day
 *          switchover (Runbook 2), at which point it retires.
 *   - s13: STAGED — first cut-step rotation. Drops sets 5-8, adds set 13 →
 *          legalSets = {9,10,11,12,13}. Offered for new decks NOW so players
 *          can pre-build, but `ranked: false` until release day. On the
 *          switchover, flip s12 to retired (offered=false, ranked=false) and
 *          s13 to ranked:true per docs/ROTATIONS.md Runbook 2/3.
 */
export const CORE_ROTATIONS: Readonly<Record<RotationId, RotationEntry>> = {
  s11: {
    legalSets: new Set(["5", "6", "7", "8", "9", "10", "11"]),
    banlist: new Set<string>([]),
    deckSize: 60,
    offeredForNewDecks: false,
    ranked: false,
    displayName: "Set 11 Core",
  },
  s12: {
    legalSets: new Set(["5", "6", "7", "8", "9", "10", "11", "12"]),
    banlist: new Set<string>([]),
    deckSize: 60,
    offeredForNewDecks: true,
    ranked: true,
    displayName: "Set 12 Core",
  },
  s13: {
    // Cut step: sets 5-8 rotate out, set 13 rotates in.
    legalSets: new Set(["9", "10", "11", "12", "13"]),
    banlist: new Set<string>([]),
    deckSize: 60,
    offeredForNewDecks: true, // staged: pre-build allowed
    ranked: false, // not live until Set 13 release day
    displayName: "Set 13 Core",
  },
};

/** Infinity rotations — all sets + promos are always legal within a rotation,
 *  but each rotation is a frozen card-pool SNAPSHOT, not a shared union. A
 *  deck stamped Infinity-s11 must remain playable against its s11-era card
 *  pool even after s12 cards exist in the catalog; otherwise s11 decks could
 *  silently incorporate set-12 cards just by being matched against them.
 *
 *  Maintenance: when a new set drops, snapshot the previous rotation's set
 *  list into a fresh `INFINITY_S{N}_SETS` constant, add the new set id (and
 *  any new promos) to it, and wire it into a new `INFINITY_ROTATIONS.s{N}`
 *  entry. Same shape Core already uses. */
const INFINITY_S11_SETS: ReadonlySet<string> = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11",
  "P1", "P2", "P3", "C1", "CP", "D23", "DIS",
]);

const INFINITY_S12_SETS: ReadonlySet<string> = new Set([
  ...INFINITY_S11_SETS,
  "12", "C2",
]);

// Infinity is unaffected by Core cuts — it's purely additive. s13 = s12 + set 13.
// (Add any Set-13-era promo set ids here as they're confirmed.)
const INFINITY_S13_SETS: ReadonlySet<string> = new Set([
  ...INFINITY_S12_SETS,
  "13",
]);

export const INFINITY_ROTATIONS: Readonly<Record<RotationId, RotationEntry>> = {
  s11: {
    legalSets: INFINITY_S11_SETS,
    banlist: new Set<string>(["hiram-flaversham-toymaker"]),
    deckSize: 60,
    offeredForNewDecks: false,
    ranked: false,
    displayName: "Set 11 Infinity",
  },
  s12: {
    legalSets: INFINITY_S12_SETS,
    banlist: new Set<string>(["hiram-flaversham-toymaker"]),
    deckSize: 60,
    offeredForNewDecks: true,
    ranked: true,
    displayName: "Set 12 Infinity",
  },
  s13: {
    legalSets: INFINITY_S13_SETS,
    banlist: new Set<string>(["hiram-flaversham-toymaker"]),
    deckSize: 60,
    offeredForNewDecks: true, // staged: pre-build allowed
    ranked: false, // not live until Set 13 release day
    displayName: "Set 13 Infinity",
  },
};

/** Format identity: the family (Core/Infinity) plus the rotation snapshot
 *  that the deck was built for. Decks carry this stamp forever; new decks
 *  inherit whichever rotation the UI is currently offering. */
export type GameFormatFamily = "core" | "infinity";
export interface GameFormat {
  readonly family: GameFormatFamily;
  readonly rotation: RotationId;
}

/** A single legality problem.
 *
 *  Most issues are per-card (`banned`, `set_not_legal`, `unknown_card`) and
 *  carry the offending card's identity. The `wrong_count` issue is deck-wide
 *  (sum of `DeckEntry.count` ≠ `RotationEntry.deckSize`) — it sets
 *  `definitionId` and `fullName` to empty strings since no single card owns
 *  the violation. UI surfaces should branch on `reason === "wrong_count"`
 *  rather than display per-card metadata for that case. */
export interface LegalityIssue {
  readonly definitionId: string;
  readonly fullName: string;
  readonly reason: "banned" | "set_not_legal" | "unknown_card" | "wrong_count";
  /** Human-readable message for UI surfacing — includes the rotation name. */
  readonly message: string;
}

export interface LegalityResult {
  readonly ok: boolean;
  readonly issues: LegalityIssue[];
}

/** Collect every distinct setId a card has been printed under — canonical
 *  CardDefinition.setId + every entry in printings[] (falls back to variants[]
 *  for older single-printing cards built before printings[] landed). */
function allPrintedSets(def: CardDefinition): string[] {
  const ids = new Set<string>();
  if (def.setId) ids.add(def.setId);
  if (def.printings) {
    for (const p of def.printings) ids.add(p.setId);
  } else if (def.variants) {
    for (const v of def.variants) ids.add(v.setId);
  }
  return Array.from(ids);
}

/** Look up the rotation entry for a given format. Throws on unknown rotation
 *  rather than silently treating every card as illegal — catches typos /
 *  forgotten registry entries immediately. */
function resolveRotation(format: GameFormat): RotationEntry {
  const registry = format.family === "core" ? CORE_ROTATIONS : INFINITY_ROTATIONS;
  const entry = registry[format.rotation];
  if (!entry) {
    throw new Error(
      `Unknown rotation "${format.rotation}" in format family "${format.family}". ` +
        `Register it in ${format.family === "core" ? "CORE_ROTATIONS" : "INFINITY_ROTATIONS"}.`,
    );
  }
  return entry;
}

/** Whether games played under this format count for ELO / ranked matchmaking.
 *  Server `updateElo()` early-returns when this is false; the matchmaking
 *  ranked-queue endpoint rejects joins; the UI hides the Find Ranked button.
 *  Throws on unknown rotation (delegates to `resolveRotation`). */
export function isRankedFormat(format: GameFormat): boolean {
  return resolveRotation(format).ranked;
}

/** Check whether a single card is legal in the given format. Exposed so the
 *  card browser / filter chips can hide non-legal cards in the picker. */
export function isCardLegalInFormat(
  def: CardDefinition,
  format: GameFormat,
): boolean {
  const entry = resolveRotation(format);
  if (entry.banlist.has(def.id)) return false;
  for (const sid of allPrintedSets(def)) {
    if (entry.legalSets.has(sid)) return true;
  }
  return false;
}

/** Validate a parsed decklist against a format. Returns ok=true when every
 *  entry is legal AND the total card count matches the rotation's required
 *  deckSize; issues[] enumerates each failure with a UI-ready message.
 *
 *  Count enforcement was added 2026-05-18. Previously the engine validated
 *  per-card legality only; deck-size was a soft nudge in the deckbuilder UI
 *  and a 45-card deck could queue into ranked. Now `wrong_count` issues are
 *  emitted at most once per call (deck-wide, not per-card) and surface as a
 *  400 from `assertDeckLegal` → lobby/matchmaker rejection. */
export function isLegalFor(
  entries: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  format: GameFormat,
): LegalityResult {
  const entry = resolveRotation(format);
  const issues: LegalityIssue[] = [];
  const rotationLabel = entry.displayName;

  // Deck-wide count check. Emitted alongside (not instead of) per-card issues
  // so the UI can show "wrong count AND illegal cards" in one pass — the
  // user fixes both without re-submitting.
  const totalCount = entries.reduce((s, e) => s + e.count, 0);
  if (totalCount !== entry.deckSize) {
    issues.push({
      definitionId: "",
      fullName: "",
      reason: "wrong_count",
      message: `${rotationLabel} requires exactly ${entry.deckSize} cards; deck has ${totalCount}.`,
    });
  }

  for (const deckEntry of entries) {
    const def = definitions[deckEntry.definitionId];
    if (!def) {
      issues.push({
        definitionId: deckEntry.definitionId,
        fullName: deckEntry.definitionId,
        reason: "unknown_card",
        message: `${deckEntry.definitionId} — card not found in definitions.`,
      });
      continue;
    }
    if (entry.banlist.has(def.id)) {
      issues.push({
        definitionId: def.id,
        fullName: def.fullName,
        reason: "banned",
        message: `${def.fullName} — banned in ${rotationLabel}.`,
      });
      continue;
    }
    const hasLegalPrinting = allPrintedSets(def).some((sid) => entry.legalSets.has(sid));
    if (!hasLegalPrinting) {
      issues.push({
        definitionId: def.id,
        fullName: def.fullName,
        reason: "set_not_legal",
        message: `${def.fullName} — no printing in a ${rotationLabel}-legal set.`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Enumerate every rotation currently offered for new deck creation. UI
 *  dropdown populates from this. Ordered by rotation id (insertion order in
 *  the registry), which is chronological. */
export function listOfferedRotations(
  family: GameFormatFamily,
): readonly { id: RotationId; entry: RotationEntry }[] {
  const registry = family === "core" ? CORE_ROTATIONS : INFINITY_ROTATIONS;
  return (Object.keys(registry) as RotationId[])
    .filter((id) => registry[id]!.offeredForNewDecks)
    .map((id) => ({ id, entry: registry[id]! }));
}
