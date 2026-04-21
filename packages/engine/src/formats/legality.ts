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

/** Rotation ids. Add "s13" etc. here (and to the registries below) when
 *  Ravensburger announces the next rotation's set list. */
export type RotationId = "s11" | "s12";

/** One rotation's legal-set snapshot + banlist + whether new decks can still
 *  be created under it. */
export interface RotationEntry {
  /** Set ids (matching CardDefinition.setId) legal in this rotation. */
  readonly legalSets: ReadonlySet<string>;
  /** Card definitionIds banned in this rotation. Separate from legalSets —
   *  a card can be in a legal set and still be banned. */
  readonly banlist: ReadonlySet<string>;
  /** When true, the UI offers this rotation in the "new deck" dropdown.
   *  Stored decks stamped with a rotation where this is now `false` still
   *  validate against that rotation — they just can't be CREATED with it. */
  readonly offeredForNewDecks: boolean;
  /** Human-readable label for UI surfacing (e.g. "Set 12 Core"). */
  readonly displayName: string;
}

/** Core rotations — every 4 sets, oldest 4 drop. Cadence per Ravensburger OP.
 *
 *  Current state (2026-04-21):
 *   - s11: pre-Set-12 live format, sets 5-11 (7 sets). Still offered for new
 *          decks while players who haven't opened Set 12 want to build to the
 *          proven card pool.
 *   - s12: Set 12 preview — additive, sets 5-12 (8 sets). Current default.
 *   - (s13 will be added when Ravensburger locks in the next rotation. Per
 *     the cadence, s13 drops sets 5-8 → legalSets = {9,10,11,12,13}.)
 */
export const CORE_ROTATIONS: Readonly<Record<RotationId, RotationEntry>> = {
  s11: {
    legalSets: new Set(["5", "6", "7", "8", "9", "10", "11"]),
    banlist: new Set<string>([]),
    offeredForNewDecks: true,
    displayName: "Set 11 Core",
  },
  s12: {
    legalSets: new Set(["5", "6", "7", "8", "9", "10", "11", "12"]),
    banlist: new Set<string>([]),
    offeredForNewDecks: true,
    displayName: "Set 12 Core",
  },
};

/** Infinity rotations — all sets + promos are always legal; only the banlist
 *  progresses between rotations. Listed as an explicit set (rather than
 *  "anything goes") so the legality check has a single shape and future
 *  restrictions are registry edits. */
const INFINITY_ALL_SETS: ReadonlySet<string> = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
  "P1", "P2", "P3", "C1", "C2", "CP", "D23", "DIS",
]);

export const INFINITY_ROTATIONS: Readonly<Record<RotationId, RotationEntry>> = {
  s11: {
    legalSets: INFINITY_ALL_SETS,
    banlist: new Set<string>(["hiram-flaversham-toymaker"]),
    offeredForNewDecks: true,
    displayName: "Set 11 Infinity",
  },
  s12: {
    legalSets: INFINITY_ALL_SETS,
    banlist: new Set<string>(["hiram-flaversham-toymaker"]),
    offeredForNewDecks: true,
    displayName: "Set 12 Infinity",
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

/** A single legality problem for a deck entry. */
export interface LegalityIssue {
  readonly definitionId: string;
  readonly fullName: string;
  readonly reason: "banned" | "set_not_legal" | "unknown_card";
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
 *  entry is legal; issues[] enumerates each failure with a UI-ready message. */
export function isLegalFor(
  entries: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  format: GameFormat,
): LegalityResult {
  const entry = resolveRotation(format);
  const issues: LegalityIssue[] = [];
  const rotationLabel = entry.displayName;

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
