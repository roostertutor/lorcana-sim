// =============================================================================
// SYNC-IMAGES-LORCAST — fills image gaps that Ravensburger doesn't publish.
//
// Covers the three categories Ravensburger's API omits:
//   - DIS promos (Disneyland-exclusive Dodos, Retail Partner promos, etc.)
//   - C2 convention cards (Gen Con / PAX)
//   - CP cat crawl fallbacks
// And during pre-release windows, Lorcast-revealed set-N cards that
// Ravensburger hasn't mirrored yet. Those auto-upgrade to "ravensburger"
// on the next `pnpm sync-images-rav` run via the refuse-to-downgrade rule.
//
// Same pipeline as sync-images-rav; only the tier + upstream URL extractor
// change. See docs in `scripts/lib/image-sync.ts`.
//
// Usage:
//   pnpm sync-images-lorcast --dry-run --sets DIS --limit 3    ← smoke test
//   pnpm sync-images-lorcast --sets DIS,C2,CP                   ← promo gaps only
//   pnpm sync-images-lorcast                                    ← everywhere (rare — most
//                                                                 cards refused as higher-tier)
// =============================================================================

import { runSync, parseCliArgs, printSummary } from "./lib/image-sync.js";

/** Lorcast stores the main-art URL at `card.imageUrl` — but only on cards
 *  we imported from Lorcast. For Ravensburger-tier cards, this field points
 *  at Ravensburger, not Lorcast. Filter to Lorcast-shaped URLs so we only
 *  touch cards that genuinely have Lorcast data. */
function getLorcastSourceUrl(card: any): string | undefined {
  const url = card._sourceImageUrl ?? card.imageUrl;
  if (!url) return undefined;
  if (!/(^|\/\/)(cards\.)?lorcast\.(io|com)/.test(url)) {
    return undefined;
  }
  return url;
}

async function main() {
  const args = parseCliArgs(process.argv);
  const summary = await runSync({
    tier: "lorcast",
    getSourceUrl: getLorcastSourceUrl,
    args,
  });
  printSummary(summary, "lorcast", args.dryRun || !process.env.R2_BUCKET);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
