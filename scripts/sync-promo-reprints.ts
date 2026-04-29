#!/usr/bin/env node
// Two-pass card-data sync:
//   1. Promo cross-set sync — copy abilities/actionEffects/alternateNames/
//      playRestrictions/selfCostReduction/altPlayCost from the main-set wired
//      original (matched by `fullName`) into promo entries (P1/P2/P3/C1/C2/D23/DIS).
//   2. Within-set sync — same copy, but keyed on `id`, so rarity reprints in
//      the SAME set file (e.g. enchanted/epic alt-arts of a legendary) inherit
//      from their wired sibling. This is what catches the set-12 reprint case
//      where Ravensburger ships #160 + #236 of the same `kida-crystal-scion`
//      and only one entry is hand-wired.
//
// Auto-runs at the end of `pnpm import-cards` so newly-imported rarity reprints
// don't show up as bogus "needs-implementation" stubs in the post-import report.
// Also exposed as `pnpm sync-reprints` for one-off use.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const MAIN_SETS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const PROMO_SETS = ["P1", "P2", "P3", "C1", "C2", "D23", "DIS"];

export interface SyncReprintsResult {
  /** Total reprints synced across the promo (cross-set) pass. */
  promoSynced: number;
  /** Total reprints synced across the within-set pass. */
  withinSetSynced: number;
  /** Per-set count of within-set syncs (only sets where >0 happened). */
  perSetWithin: Record<string, number>;
  /** Per-set count of promo syncs (only sets where >0 happened). */
  perSetPromo: Record<string, number>;
  /**
   * Set of card-instance keys (`{setCode}|{id}|{number}`) that received a sync
   * during this run. Used by the importer to label cards as "auto-wired"
   * vs "needs-implementation" in the post-import report.
   */
  syncedKeys: Set<string>;
}

function makeKey(setCode: string, card: { id?: string; number?: number }): string {
  return `${setCode}|${card.id ?? ""}|${card.number ?? 0}`;
}

/**
 * Run both sync passes against on-disk card JSON. Mutates JSON files in place
 * and returns counts plus the set of card keys that received a sync.
 *
 * Safe to call repeatedly — both passes skip cards that are already wired.
 */
export function syncReprints(opts: { silent?: boolean } = {}): SyncReprintsResult {
  const log = opts.silent ? () => {} : console.log;

  // Build a name → wired-card index from main sets.
  const wired: Record<string, any> = {};
  for (const s of MAIN_SETS) {
    const fp = join(CARDS_DIR, `card-set-${s}.json`);
    const cards = JSON.parse(readFileSync(fp, "utf-8"));
    for (const c of cards) {
      const hasAbilities = (c.abilities || []).some((a: any) =>
        ["triggered", "activated", "static"].includes(a.type)
      );
      const hasAction = c.actionEffects && c.actionEffects.length > 0;
      const hasAltNames = c.alternateNames && c.alternateNames.length > 0;
      const hasPlayRestrictions = c.playRestrictions && c.playRestrictions.length > 0;
      const hasSelfCost = c.selfCostReduction !== undefined;
      const hasAltPlayCost = c.altPlayCost !== undefined;
      if (hasAbilities || hasAction || hasAltNames || hasPlayRestrictions || hasSelfCost || hasAltPlayCost) {
        // Match case-insensitively to tolerate upstream capitalization drift
        // (e.g. "Miserable as Usual" vs "Miserable As Usual" between sets).
        const key = c.fullName.toLowerCase();
        if (!wired[key]) wired[key] = c;
      }
    }
  }

  let promoSynced = 0;
  const perSetPromo: Record<string, number> = {};
  const syncedKeys = new Set<string>();

  for (const s of PROMO_SETS) {
    const fp = join(CARDS_DIR, `card-set-${s}.json`);
    const cards = JSON.parse(readFileSync(fp, "utf-8"));
    let setSynced = 0;
    for (const c of cards) {
      const src = wired[c.fullName.toLowerCase()];
      if (!src) continue;
      // Skip if already wired.
      const alreadyWired =
        (c.abilities || []).some((a: any) => ["triggered", "activated", "static"].includes(a.type)) ||
        (c.actionEffects && c.actionEffects.length > 0);
      if (alreadyWired) continue;
      // Copy ability shapes; preserve any keyword stubs already on the promo.
      if (src.abilities) {
        const existingKeywords = (c.abilities || []).filter((a: any) => a.type === "keyword");
        const srcNonKw = src.abilities.filter((a: any) => a.type !== "keyword");
        c.abilities = [...existingKeywords, ...srcNonKw];
      }
      if (src.actionEffects) c.actionEffects = JSON.parse(JSON.stringify(src.actionEffects));
      if (src.alternateNames) c.alternateNames = [...src.alternateNames];
      if (src.playRestrictions) c.playRestrictions = JSON.parse(JSON.stringify(src.playRestrictions));
      if (src.selfCostReduction) c.selfCostReduction = JSON.parse(JSON.stringify(src.selfCostReduction));
      if (src.altPlayCost) c.altPlayCost = JSON.parse(JSON.stringify(src.altPlayCost));
      setSynced++;
      promoSynced++;
      syncedKeys.add(makeKey(s, c));
    }
    writeFileSync(fp, JSON.stringify(cards, null, 2) + "\n", "utf-8");
    if (setSynced > 0) perSetPromo[s] = setSynced;
    log(`  ${s}: synced ${setSynced} reprints`);
  }
  log(`\nTotal: ${promoSynced} reprints synced from main sets to promo sets.`);

  // Within-set pass: copy from a wired variant to its sibling reprints sharing `id`.
  let withinSetSynced = 0;
  const perSetWithin: Record<string, number> = {};
  for (const s of [...MAIN_SETS, ...PROMO_SETS]) {
    const fp = join(CARDS_DIR, `card-set-${s}.json`);
    const cards = JSON.parse(readFileSync(fp, "utf-8"));
    const byId: Record<string, any[]> = {};
    for (const c of cards) {
      if (!c.id) continue;
      (byId[c.id] ||= []).push(c);
    }
    let setSynced = 0;
    for (const group of Object.values(byId)) {
      if (group.length < 2) continue;
      const src = group.find((c) => {
        const hasAb = (c.abilities || []).some((a: any) =>
          ["triggered", "activated", "static"].includes(a.type)
        );
        return (
          hasAb ||
          (c.actionEffects && c.actionEffects.length > 0) ||
          (c.alternateNames && c.alternateNames.length > 0) ||
          (c.playRestrictions && c.playRestrictions.length > 0) ||
          c.altPlayCost !== undefined ||
          c.selfCostReduction !== undefined
        );
      });
      if (!src) continue;
      for (const c of group) {
        if (c === src) continue;
        const alreadyWired =
          (c.abilities || []).some((a: any) =>
            ["triggered", "activated", "static"].includes(a.type)
          ) || (c.actionEffects && c.actionEffects.length > 0);
        if (alreadyWired) continue;
        if (src.abilities) {
          const existingKeywords = (c.abilities || []).filter((a: any) => a.type === "keyword");
          const srcNonKw = src.abilities.filter((a: any) => a.type !== "keyword");
          c.abilities = [...existingKeywords, ...srcNonKw];
        }
        if (src.actionEffects) c.actionEffects = JSON.parse(JSON.stringify(src.actionEffects));
        if (src.alternateNames) c.alternateNames = [...src.alternateNames];
        if (src.playRestrictions) c.playRestrictions = JSON.parse(JSON.stringify(src.playRestrictions));
        if (src.selfCostReduction) c.selfCostReduction = JSON.parse(JSON.stringify(src.selfCostReduction));
        if (src.altPlayCost) c.altPlayCost = JSON.parse(JSON.stringify(src.altPlayCost));
        setSynced++;
        withinSetSynced++;
        syncedKeys.add(makeKey(s, c));
      }
    }
    if (setSynced > 0) {
      writeFileSync(fp, JSON.stringify(cards, null, 2) + "\n", "utf-8");
      perSetWithin[s] = setSynced;
      log(`  ${s}: within-set synced ${setSynced} variants`);
    }
  }
  log(`Total: ${withinSetSynced} within-set variants synced.`);

  return { promoSynced, withinSetSynced, perSetWithin, perSetPromo, syncedKeys };
}

// CLI entry point — preserved for `pnpm sync-reprints` and direct tsx invocation.
// Detect "run as script" via the URL match so importing the module from
// import-cards-rav.ts doesn't trigger the CLI side-effect.
const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();

if (isCli) {
  syncReprints();
}
