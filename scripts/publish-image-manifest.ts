#!/usr/bin/env node
// =============================================================================
// PUBLISH IMAGE MANIFEST
//
// Writes a cross-app manifest file to R2 that maps (setId, number) → R2 image
// key, so external consumers (e.g. the lorcana-collectbook collection tracker)
// can stamp pre-sized R2 URLs onto their own card records without having to
// mirror our internal card JSON or read the engine package.
//
// The manifest is the ONE public contract between apps. Our engine-internal
// CardDefinition stays free to churn; downstream apps depend only on the shape
// described here (version field for future breaking changes).
//
// Lives at:
//   https://<R2_PUBLIC_BASE_URL>/manifest/v1/images.json
//
// Shape:
//   {
//     "version": 1,
//     "generatedAt": "2026-04-22T...",
//     "baseUrl": "https://pub-....r2.dev",
//     "sizes": { "small": 200, "normal": 450, "large": 900 },
//     "cards": {
//       "1/1":    { "key": "set1/1_98e6bf931e54bf66", "ravensburgerId": 1 },
//       "12/123": { "key": "set12/123_a8f3c9d2b1e5f7a0", "ravensburgerId": 1234 },
//       "P1/4":   { "key": "setP1/4_...",              "ravensburgerId": 456 }
//     }
//   }
//
// Consumer URL construction:
//   `${manifest.baseUrl}/${entry.key}_${size}.jpg`
// where size ∈ keys of manifest.sizes.
//
// Usage:
//   pnpm publish-image-manifest             write to R2 (requires .env R2 creds)
//   pnpm publish-image-manifest --dry-run   print manifest shape + stats, skip upload
//   pnpm publish-image-manifest --out FILE  also write a local copy to FILE for inspection
//
// Idempotent — overwrites the same R2 key each run. Safe to run daily from
// a CI schedule or after every `pnpm sync-images-rav`.
// =============================================================================

import { writeFileSync } from "node:fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  IMAGE_SIZES,
  buildR2Client,
  listCardSetFiles,
  loadCardSet,
  readR2ConfigFromEnv,
} from "./lib/image-sync.js";

const MANIFEST_KEY = "manifest/v1/images.json";
const MANIFEST_VERSION = 1;

interface ManifestEntry {
  key: string;
  ravensburgerId?: number;
}

interface Manifest {
  version: number;
  generatedAt: string;
  baseUrl: string;
  sizes: Record<string, number>;
  cards: Record<string, ManifestEntry>;
}

/** Parse an R2 imageUrl into the opaque key prefix (everything before _normal.jpg).
 *  Returns null for non-R2 URLs (upstream Ravensburger / Lorcast URLs — card not
 *  yet migrated to self-hosted images). */
function parseR2Key(imageUrl: string, baseUrl: string): string | null {
  const base = baseUrl.replace(/\/$/, "");
  if (!imageUrl.startsWith(base + "/")) return null;
  const path = imageUrl.slice(base.length + 1);
  // Expect "set{setId}/{number}_{hash}_normal.jpg" — strip the _normal.jpg
  // suffix so consumers can append _small.jpg / _normal.jpg / _large.jpg.
  const m = path.match(/^(set[^/]+\/\d+_[0-9a-f]+)_normal\.jpg$/);
  return m ? m[1]! : null;
}

function buildManifest(baseUrl: string): Manifest {
  const cards: Record<string, ManifestEntry> = {};
  let total = 0;
  let missingImageUrl = 0;
  let nonR2ImageUrl = 0;
  let withRavId = 0;

  for (const filename of listCardSetFiles()) {
    const rows = loadCardSet(filename) as Array<{
      setId: string;
      number: number;
      imageUrl?: string;
      _ravensburgerId?: number;
    }>;
    for (const card of rows) {
      total++;
      if (!card.imageUrl) {
        missingImageUrl++;
        continue;
      }
      const key = parseR2Key(card.imageUrl, baseUrl);
      if (!key) {
        nonR2ImageUrl++;
        continue;
      }
      const manifestKey = `${card.setId}/${card.number}`;
      const entry: ManifestEntry = { key };
      if (typeof card._ravensburgerId === "number") {
        entry.ravensburgerId = card._ravensburgerId;
        withRavId++;
      }
      cards[manifestKey] = entry;
    }
  }

  console.log(`\n  Scanned ${total} cards across ${listCardSetFiles().length} set files:`);
  console.log(`    ${Object.keys(cards).length} entries in manifest`);
  console.log(`    ${withRavId} with _ravensburgerId (populated on next import-cards run)`);
  if (missingImageUrl > 0) console.log(`    ${missingImageUrl} skipped: no imageUrl`);
  if (nonR2ImageUrl > 0) console.log(`    ${nonR2ImageUrl} skipped: imageUrl is upstream (not yet synced to R2)`);

  return {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    baseUrl: baseUrl.replace(/\/$/, ""),
    sizes: { ...IMAGE_SIZES },
    cards,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : undefined;

  const config = readR2ConfigFromEnv();
  if (!config && !dryRun) {
    console.error(
      "\n  R2 config missing from .env — cannot upload manifest.\n" +
        "  Either set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /\n" +
        "  R2_BUCKET / R2_PUBLIC_BASE_URL, or pass --dry-run to print the\n" +
        "  manifest shape without uploading.\n",
    );
    process.exit(1);
  }

  // Dry-run mode can still run without R2 creds — uses a placeholder baseUrl
  // matching the current production URL so the printed manifest is realistic.
  const baseUrl = config?.publicBaseUrl ?? "https://pub-5d52a089800f49be846aa55b2833c558.r2.dev";
  const manifest = buildManifest(baseUrl);
  const body = JSON.stringify(manifest);
  console.log(`\n  Manifest size: ${(body.length / 1024).toFixed(1)} KB uncompressed`);

  if (outPath) {
    writeFileSync(outPath, body + "\n", "utf8");
    console.log(`  Wrote local copy: ${outPath}`);
  }

  if (dryRun || !config) {
    console.log(`\n  Dry run — NOT uploading. Would write to:`);
    console.log(`    ${baseUrl}/${MANIFEST_KEY}`);
    // Print 3 sample entries so the consumer side can eyeball the shape.
    const sampleKeys = Object.keys(manifest.cards).slice(0, 3);
    if (sampleKeys.length > 0) {
      console.log(`\n  Sample entries:`);
      for (const k of sampleKeys) {
        console.log(`    "${k}": ${JSON.stringify(manifest.cards[k])}`);
      }
    }
    return;
  }

  const client = buildR2Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: MANIFEST_KEY,
      Body: body,
      ContentType: "application/json; charset=utf-8",
      // Short cache — consumers pull this once per daily sync, and when we
      // re-run after a new set drops we want them to pick up the change on
      // their next fetch, not 24 hours later.
      CacheControl: "public, max-age=300, s-maxage=300",
    }),
  );

  console.log(`\n  Uploaded manifest → ${baseUrl}/${MANIFEST_KEY}`);
  console.log(`  Consumers should fetch this URL; baseUrl inside the manifest`);
  console.log(`  is the source of truth for image hosts (update ${MANIFEST_KEY}`);
  console.log(`  when migrating to a custom domain; consumers pick it up automatically).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
