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
//       "1/1":    {
//         "key": "set1/1_98e6bf931e54bf66",
//         "ravensburgerId": 1,
//         "foil": {
//           "type": "silver",
//           "maskKey": "masks/set1/1_afb2cf020b36301e_base",
//           "topMaskKey": null,
//           "topLayer": null,
//           "hotColor": null
//         }
//       },
//       "11/22": {
//         "key": "set11/22_...",
//         "ravensburgerId": 2485,
//         "foil": {
//           "type": "silver",
//           "maskKey": "masks/set11/22_..._base",
//           "topMaskKey": "masks/set11/22_..._top",
//           "topLayer": "high_gloss",
//           "hotColor": null
//         }
//       }
//     }
//   }
//
// Consumer URL construction:
//   Art:  `${manifest.baseUrl}/${entry.key}_${size}.jpg`   (size ∈ keys of manifest.sizes)
//   Mask: `${manifest.baseUrl}/${foil.maskKey}.jpg`        (or foil.topMaskKey)
//
// The `foil` block is absent on cards with no foil data (Lorcast-sourced
// gaps, pre-foil-era stock). Consumers MUST null-check `entry.foil` before
// reading any subfield. `maskKey` / `topMaskKey` / `topLayer` / `hotColor`
// are independently nullable (not every foiled card has a top-layer mask).
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

interface ManifestFoilBlock {
  /** Foil shader type — snake_case normalization of Ravensburger's foil_type. */
  type: string | null;
  /** R2 key (sans baseUrl, sans .jpg) for the base luminance mask. Null when
   *  the card has no mask data (pre-foil-era stock, Lorcast-sourced gaps). */
  maskKey: string | null;
  /** R2 key for the top-layer normal-map mask. Only populated for cards with
   *  HighGloss / MetallicHotFoil / SnowHotFoil / RainbowHotFoil / MatteHotFoil
   *  top-layer treatments (220/2816 cards as of this writing). */
  topMaskKey: string | null;
  /** snake_case top-layer type. Paired with topMaskKey. */
  topLayer: string | null;
  /** Per-card art-directed hex tint for hot-foil top layers. Null means
   *  the renderer should fall back to #aaa silver. */
  hotColor: string | null;
}

interface ManifestEntry {
  key: string;
  ravensburgerId?: number;
  foil?: ManifestFoilBlock;
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

/** Parse an R2 mask URL into its opaque key prefix (everything before .jpg).
 *  Mask keys include the `_base` / `_top` slot suffix so consumers can tell
 *  which is which without consulting the manifest's topMaskKey field.
 *  Returns null for non-R2 URLs. */
function parseR2MaskKey(maskUrl: string, baseUrl: string): string | null {
  const base = baseUrl.replace(/\/$/, "");
  if (!maskUrl.startsWith(base + "/")) return null;
  const path = maskUrl.slice(base.length + 1);
  const m = path.match(/^(masks\/set[^/]+\/\d+_[0-9a-f]+_(?:base|top))\.jpg$/);
  return m ? m[1]! : null;
}

function buildManifest(baseUrl: string): Manifest {
  const cards: Record<string, ManifestEntry> = {};
  let total = 0;
  let missingImageUrl = 0;
  let nonR2ImageUrl = 0;
  let withRavId = 0;
  let withFoil = 0;
  let withFoilBase = 0;
  let withFoilTop = 0;
  let foilMaskNotR2 = 0;
  let foilTopNotR2 = 0;

  for (const filename of listCardSetFiles()) {
    const rows = loadCardSet(filename) as Array<{
      setId: string;
      number: number;
      imageUrl?: string;
      _ravensburgerId?: number;
      foilType?: string;
      foilMaskUrl?: string;
      foilTopLayerMaskUrl?: string;
      foilTopLayer?: string;
      hotFoilColor?: string;
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

      // Foil block: present if the card has ANY foil data. Individual
      // fields within are nullable — e.g. a Silver-foil card with no
      // top-layer has `maskKey` populated but `topMaskKey: null`.
      const hasAnyFoilData =
        card.foilType ||
        card.foilMaskUrl ||
        card.foilTopLayerMaskUrl ||
        card.foilTopLayer ||
        card.hotFoilColor;
      if (hasAnyFoilData) {
        let maskKey: string | null = null;
        let topMaskKey: string | null = null;
        if (card.foilMaskUrl) {
          maskKey = parseR2MaskKey(card.foilMaskUrl, baseUrl);
          if (!maskKey) foilMaskNotR2++;
          else withFoilBase++;
        }
        if (card.foilTopLayerMaskUrl) {
          topMaskKey = parseR2MaskKey(card.foilTopLayerMaskUrl, baseUrl);
          if (!topMaskKey) foilTopNotR2++;
          else withFoilTop++;
        }
        entry.foil = {
          type: card.foilType ?? null,
          maskKey,
          topMaskKey,
          topLayer: card.foilTopLayer ?? null,
          hotColor: card.hotFoilColor ?? null,
        };
        withFoil++;
      }

      cards[manifestKey] = entry;
    }
  }

  console.log(`\n  Scanned ${total} cards across ${listCardSetFiles().length} set files:`);
  console.log(`    ${Object.keys(cards).length} entries in manifest`);
  console.log(`    ${withRavId} with _ravensburgerId`);
  console.log(`    ${withFoil} with foil data`);
  console.log(`      ${withFoilBase} with R2 base mask`);
  console.log(`      ${withFoilTop} with R2 top-layer mask`);
  if (foilMaskNotR2 > 0) console.log(`    ⚠ ${foilMaskNotR2} foilMaskUrl values are upstream (run pnpm sync-foil-masks)`);
  if (foilTopNotR2 > 0) console.log(`    ⚠ ${foilTopNotR2} foilTopLayerMaskUrl values are upstream (run pnpm sync-foil-masks)`);
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
