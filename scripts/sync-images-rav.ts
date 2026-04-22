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

/** Ravensburger stores the main-art URL at `card.imageUrl`. On re-runs after
 *  a `pnpm import-cards`, `imageUrl` gets rewritten to the CURRENT Rav URL —
 *  that's the fresh upstream. On re-runs after a migration but WITHOUT a
 *  re-import, `imageUrl` points to R2 and the stored `_sourceImageUrl`
 *  carries the last-synced Rav URL.
 *
 *  Preference order: fresh imageUrl (if Rav-shaped) > `_sourceImageUrl`
 *  (if Rav-shaped) > skip. Detecting an imageUrl that's been rewritten to
 *  a new Rav URL is what drives re-sync when Ravensburger rotates their
 *  content hash. */
function getRavensburgerSourceUrl(card: any): string | undefined {
  const isRavShape = (u: unknown): u is string =>
    typeof u === "string" &&
    /(^|\/\/)(www\.)?(api\.)?(disney)?lorcana(\.ravensburger)?\.com/.test(u);
  if (isRavShape(card.imageUrl)) return card.imageUrl;
  if (isRavShape(card._sourceImageUrl)) return card._sourceImageUrl;
  return undefined;
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
