#!/usr/bin/env node
// Promo / DIS / D23 / cp sets are reprints of main-set cards.
// Copy abilities/actionEffects/alternateNames/playRestrictions/selfCostReduction
// from the main-set original (matched by fullName) into the promo entry.
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(__dirname, "../packages/engine/src/cards");

const MAIN_SETS = ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012"];
const PROMO_SETS = ["0P1", "0P2", "0P3", "0C1", "0C2", "D23"];

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

let synced = 0;
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
    synced++;
  }
  writeFileSync(fp, JSON.stringify(cards, null, 2) + "\n", "utf-8");
  console.log(`  ${s}: synced ${setSynced} reprints`);
}
console.log(`\nTotal: ${synced} reprints synced from main sets to promo sets.`);

// Within-set pass: copy from a wired variant to its sibling reprints sharing `id`.
let withinSynced = 0;
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
      withinSynced++;
    }
  }
  if (setSynced > 0) {
    writeFileSync(fp, JSON.stringify(cards, null, 2) + "\n", "utf-8");
    console.log(`  ${s}: within-set synced ${setSynced} variants`);
  }
}
console.log(`Total: ${withinSynced} within-set variants synced.`);
