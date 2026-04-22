// =============================================================================
// SYNC-IMAGES-MANUAL — sync card art from locally-dropped files.
//
// Use cases:
//   - Super-early spoilers before any API publishes the image
//   - Bad scans / watermark-stripped art
//   - Playtest-only cards
//   - Manual overrides for cards where the API's art is visibly inferior
//
// Workflow: drop a JPEG into `assets/manual-cards/<setId>/<number>.jpg` and
// run `pnpm sync-images-manual`. The script resizes, hashes, and uploads to
// R2. Refuses to overwrite ravensburger/lorcast-tier entries unless
// `_imageSourceLock: true` is set on the card JSON to pin manual.
//
// File naming (strict):
//   assets/manual-cards/12/4.jpg      ← Dale - Excited Friend (set 12, #4)
//   assets/manual-cards/P1/13.jpg     ← some P1 promo at #13
//   assets/manual-cards/DIS/2.jpg     ← DIS #2
// Extensions: .jpg, .jpeg, .png, .webp, .avif all accepted (sharp handles
// the decode). Only one file per (setId, number) — additional files with
// same basename ignored.
// =============================================================================

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { runSync, parseCliArgs, printSummary } from "./lib/image-sync.js";

const MANUAL_DIR = resolve("assets/manual-cards");
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

/** Look for `<MANUAL_DIR>/<setId>/<number>.<ext>`. Returns a `file://...` URL
 *  for the shared sync pipeline when found; undefined otherwise. */
function getManualSourceUrl(card: any): string | undefined {
  const setDir = join(MANUAL_DIR, card.setId);
  if (!existsSync(setDir)) return undefined;
  for (const ext of EXTENSIONS) {
    const candidate = join(setDir, `${card.number}${ext}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return `file://${candidate.replace(/\\/g, "/")}`;
    }
  }
  return undefined;
}

async function main() {
  const args = parseCliArgs(process.argv);

  // Helpful "nothing to do" message if the directory is empty.
  if (!existsSync(MANUAL_DIR) || readdirSync(MANUAL_DIR).length === 0) {
    console.log(`No manual-card images found at ${MANUAL_DIR}/.`);
    console.log(`Drop files named <setId>/<number>.{jpg,png,webp,avif} and re-run.`);
    return;
  }

  const summary = await runSync({
    tier: "manual",
    getSourceUrl: getManualSourceUrl,
    args,
  });
  printSummary(summary, "manual", args.dryRun || !process.env.R2_BUCKET);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
