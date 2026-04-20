// =============================================================================
// FORMAT LEGALITY — Core vs. Infinity
//
// Lorcana has two sanctioned multiplayer formats:
//   - Core: rotating — currently sets 5-12 (as of 2026-04-19). Rotates
//           periodically per Ravensburger's Disney Lorcana TCG Organized Play
//           rules. Update CORE_LEGAL_SETS here on rotation.
//   - Infinity: no rotation — every set is legal except banlist entries.
//
// Reprint rule: a card is legal in a format iff ANY of its printings satisfies
// the format's set-list (or, for Infinity, is not on the banlist). Since
// variants/printings share a single definitionId and gameplay rules, a user
// holding a set 1 physical copy of a card reprinted in set 8 can play their
// set 1 copy in Core.
//
// Banlists are separate from set-lists: a card may be in a legal set range
// and still be banned in that format.
// =============================================================================

import type { CardDefinition } from "../types/index.js";
import type { DeckEntry } from "../engine/initializer.js";

export type GameFormat = "core" | "infinity";

/** Core-legal main-set ids. Rotates — keep in sync with Ravensburger's OP rules.
 *  As of 2026-04-19: sets 5 through 12. */
export const CORE_LEGAL_SETS: ReadonlySet<string> = new Set(["5", "6", "7", "8", "9", "10", "11", "12"]);

/** Infinity is set-unrestricted today — every main set plus promos is legal.
 *  Listed explicitly rather than "anything goes" so the legality check has a
 *  single shape for both formats and future restrictions can be toggled here. */
export const INFINITY_LEGAL_SETS: ReadonlySet<string> = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
  "P1", "P2", "P3", "C1", "C2", "CP", "D23", "DIS",
]);

/** Core banlist — card definitionIds. No Core bans active as of 2026-04-19. */
export const CORE_BANLIST: ReadonlySet<string> = new Set<string>([]);

/** Infinity banlist — card definitionIds. As of 2026-04-19: only Hiram
 *  Flaversham Toymaker (set 2). */
export const INFINITY_BANLIST: ReadonlySet<string> = new Set<string>([
  "hiram-flaversham-toymaker",
]);

/** A single legality problem for a deck entry. */
export interface LegalityIssue {
  definitionId: string;
  fullName: string;
  reason: "banned" | "set_not_legal" | "unknown_card";
  /** Human-readable message for UI surfacing. */
  message: string;
}

export interface LegalityResult {
  ok: boolean;
  issues: LegalityIssue[];
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

function formatBanlist(format: GameFormat): ReadonlySet<string> {
  return format === "core" ? CORE_BANLIST : INFINITY_BANLIST;
}

function formatLegalSets(format: GameFormat): ReadonlySet<string> {
  return format === "core" ? CORE_LEGAL_SETS : INFINITY_LEGAL_SETS;
}

/** Check whether a single card is legal in the given format. Exposed so the
 *  card browser / filter chips can hide non-legal cards in the picker. */
export function isCardLegalInFormat(
  def: CardDefinition,
  format: GameFormat,
): boolean {
  if (formatBanlist(format).has(def.id)) return false;
  const legalSets = formatLegalSets(format);
  for (const sid of allPrintedSets(def)) {
    if (legalSets.has(sid)) return true;
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
  const issues: LegalityIssue[] = [];
  const banlist = formatBanlist(format);
  const legalSets = formatLegalSets(format);

  for (const entry of entries) {
    const def = definitions[entry.definitionId];
    if (!def) {
      issues.push({
        definitionId: entry.definitionId,
        fullName: entry.definitionId,
        reason: "unknown_card",
        message: `${entry.definitionId} — card not found in definitions.`,
      });
      continue;
    }
    if (banlist.has(def.id)) {
      issues.push({
        definitionId: def.id,
        fullName: def.fullName,
        reason: "banned",
        message: `${def.fullName} — banned in ${format}.`,
      });
      continue;
    }
    const hasLegalPrinting = allPrintedSets(def).some((sid) => legalSets.has(sid));
    if (!hasLegalPrinting) {
      issues.push({
        definitionId: def.id,
        fullName: def.fullName,
        reason: "set_not_legal",
        message: `${def.fullName} — no printing in a ${format}-legal set.`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}
