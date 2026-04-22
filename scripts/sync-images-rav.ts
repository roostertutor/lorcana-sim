// =============================================================================
// SYNC-IMAGES-RAV — download Ravensburger art, resize, upload to R2, rewrite
// each card JSON's `imageUrl` to point at R2.
//
// This is the PRIMARY sync script — covers ~90% of cards in the database
// (everything in main sets 1-12 that Ravensburger's API publishes). Run
// whenever new cards ship or Ravensburger rotates their CDN content hash.
//
// Dry-run mode is the default when R2 creds are missing from .env, so you
// can iterate without a real bucket:
//   pnpm sync-images-rav --dry-run --sets 12 --limit 5    ← safest smoke test
//   pnpm sync-images-rav --sets 12                         ← full set 12 (live if R2 env set)
//   pnpm sync-images-rav                                   ← full migration (live)
//
// Refuses to downgrade: cards already at `_imageSource: "ravensburger"` with
// the same upstream URL are skipped. Cards tier-locked via `_imageSourceLock`
// are skipped regardless.
//
// Variants/foil (enchanted/iconic/epic/promo + foilImageUrl) are NOT synced
// yet — MVP is regular `imageUrl` only. Those continue to point at upstream
// URLs until a second migration pass lands.
// =============================================================================

import { runSync, parseCliArgs, printSummary } from "./lib/image-sync.js";

/** Ravensburger stores the main-art URL at `card.imageUrl`. Early-pre-release
 *  cards may not have it yet — those get skipped (no source URL). */
function getRavensburgerSourceUrl(card: any): string | undefined {
  // `_sourceImageUrl` is stamped AFTER we've synced — so on re-runs where the
  // current URL in the JSON is R2, `imageUrl` is no longer Ravensburger-
  // shaped. Prefer `_sourceImageUrl` when available, fall back to the
  // unmigrated `imageUrl`. If neither is Ravensburger-shaped, skip.
  const url = card._sourceImageUrl ?? card.imageUrl;
  if (!url) return undefined;
  if (!/(^|\/\/)(www\.)?(api\.)?(disney)?lorcana(\.ravensburger)?\.com/.test(url)) {
    // URL is not Ravensburger-shaped (probably Lorcast / manual / already R2).
    // Signal: this card hasn't been imported from Ravensburger, so there's
    // nothing for THIS tier to fetch.
    return undefined;
  }
  return url;
}

async function main() {
  const args = parseCliArgs(process.argv);
  const summary = await runSync({
    tier: "ravensburger",
    getSourceUrl: getRavensburgerSourceUrl,
    args,
  });
  printSummary(summary, "ravensburger", args.dryRun || !process.env.R2_BUCKET);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
