#!/usr/bin/env node
// =============================================================================
// FOIL MASK SYNC — mirror Ravensburger mask JPEGs to R2
//
// Ravensburger publishes two grayscale JPEGs per card that drive the foil
// shader:
//   - foil_mask_url           — luminance mask (shine layer)
//   - foil_top_layer_mask_url — normal-map mask (hot-foil / HighGloss relief)
// Both need canvas `getImageData` access in the renderer, which requires
// CORS. Ravensburger's CDN doesn't serve CORS (referrer-locked to
// disneylorcana.com), so rendering apps must either proxy the bytes or
// host the masks themselves with open CORS.
//
// This script is the "host them ourselves" path — mirrors both mask URLs
// per card to R2 under `masks/set{N}/{num}_{hash}_{base|top}.jpg` and
// rewrites the card JSON to point at R2. Same content-hash + idempotency
// pattern as sync-images-rav. After sync:
//   - `foilMaskUrl` / `foilTopLayerMaskUrl` → R2 URLs (CORS-clean)
//   - `_foilMaskSource` = "ravensburger"
//   - `_foilMaskSourceUrl` / `_foilTopMaskSourceUrl` = the upstream URL we
//     pulled from (idempotency comparator for future re-runs)
//
// Reuse across re-imports:
//   Re-running `pnpm import-cards` overwrites `foilMaskUrl` /
//   `foilTopLayerMaskUrl` with fresh upstream Ravensburger URLs (same way
//   it does for imageUrl). This sync detects the reset via the 3-condition
//   check (matching source fields but non-R2-shaped URL) and re-processes.
//   Because the content hash is unchanged (Ravensburger hasn't rotated),
//   the R2 PUT no-ops on the backend — just a network round-trip.
//
// Usage:
//   pnpm sync-foil-masks                  # all sets
//   pnpm sync-foil-masks --sets 1,12,P1   # specific sets
//   pnpm sync-foil-masks --dry-run        # compute what would change, skip upload
//   pnpm sync-foil-masks --limit 10       # process only first N cards (smoke test)
//
// Dry-run auto-enables when R2 creds are missing from `.env`.
// =============================================================================

import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  buildR2Client,
  listCardSetFiles,
  loadCardSet,
  writeCardSet,
  parseCliArgs,
  readR2ConfigFromEnv,
  type R2Config,
} from "./lib/image-sync.js";

// ── R2 key helpers ──────────────────────────────────────────────────────────
function buildMaskKey(setId: string, number: number, hash: string, slot: "base" | "top"): string {
  return `masks/set${setId}/${number}_${hash}_${slot}.jpg`;
}

function buildPublicUrl(config: R2Config, key: string): string {
  return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
}

function hash16(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/** True if a URL looks like one of OUR R2 mask URLs (used for idempotency
 *  short-circuit). Strict — requires the configured public base AND the
 *  `masks/set{N}/...` key prefix. Returns false for upstream Ravensburger
 *  URLs so re-imports are detected as "needs re-sync". */
function isR2MaskShaped(url: string | undefined, r2Base: string): boolean {
  if (!url) return false;
  const base = r2Base.replace(/\/$/, "");
  if (!url.startsWith(base + "/masks/set")) return false;
  return /_(base|top)\.jpg$/.test(url);
}

// ── Per-mask sync (single file: either base or top) ─────────────────────────
type MaskSlot = "base" | "top";

interface SyncMaskArgs {
  setId: string;
  number: number;
  slot: MaskSlot;
  upstreamUrl: string;
  storedR2Url: string | undefined;
  storedSourceUrl: string | undefined;
  r2: { config: R2Config; client: S3Client };
  dryRun: boolean;
}

interface SyncMaskResult {
  /** "skipped" = no work done (already synced). "synced" = upload happened.
   *  "failed" = threw — message in `error`. */
  status: "skipped" | "synced" | "failed";
  /** R2 URL the card JSON's {foilMaskUrl|foilTopLayerMaskUrl} should point at. */
  r2Url?: string;
  /** Upstream URL to record on the card as `_foilMaskSourceUrl` / `_foilTopMaskSourceUrl`. */
  sourceUrl?: string;
  error?: string;
}

async function syncOneMask(args: SyncMaskArgs): Promise<SyncMaskResult> {
  const { setId, number, slot, upstreamUrl, storedR2Url, storedSourceUrl, r2, dryRun } = args;

  // Idempotency: if we've synced this exact upstream URL before AND the
  // current storedR2Url is already R2-shaped, skip the fetch entirely.
  if (
    storedSourceUrl === upstreamUrl &&
    isR2MaskShaped(storedR2Url, r2.config.publicBaseUrl)
  ) {
    return { status: "skipped" };
  }

  try {
    // Fetch + hash
    const res = await fetch(upstreamUrl);
    if (!res.ok) {
      return { status: "failed", error: `HTTP ${res.status} fetching ${upstreamUrl}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = hash16(buf);
    const key = buildMaskKey(setId, number, hash, slot);
    const r2Url = buildPublicUrl(r2.config, key);

    if (dryRun) {
      return { status: "synced", r2Url, sourceUrl: upstreamUrl };
    }

    // Upload. Content-hashed key means same bytes → same key → PUT is
    // effectively a no-op on the R2 backend (but we don't probe beforehand;
    // the preflight HEAD was dropped in the image-sync refactor for speed).
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.config.bucket,
      Key: key,
      Body: buf,
      ContentType: "image/jpeg",
      // Content hash in the key → safe to cache forever.
      CacheControl: "public, max-age=31536000, immutable",
    }));

    return { status: "synced", r2Url, sourceUrl: upstreamUrl };
  } catch (err: any) {
    return { status: "failed", error: err?.message ?? String(err) };
  }
}

// ── Per-card driver (may sync 0 / 1 / 2 masks) ──────────────────────────────
interface CardShape {
  setId: string;
  number: number;
  foilMaskUrl?: string;
  foilTopLayerMaskUrl?: string;
  _foilMaskSource?: "ravensburger" | "lorcast" | "manual";
  _foilMaskSourceUrl?: string;
  _foilTopMaskSourceUrl?: string;
  _foilMaskSourceLock?: boolean;
}

interface CardSyncResult {
  /** How many masks this card needed (0, 1, or 2). */
  eligible: number;
  baseStatus?: SyncMaskResult["status"];
  topStatus?: SyncMaskResult["status"];
  failures: string[];
  changed: boolean;
}

async function syncCardMasks(
  card: CardShape,
  ctx: { r2: { config: R2Config; client: S3Client } | null; dryRun: boolean },
): Promise<CardSyncResult> {
  const failures: string[] = [];
  let eligible = 0;
  let changed = false;
  let baseStatus: SyncMaskResult["status"] | undefined;
  let topStatus: SyncMaskResult["status"] | undefined;

  // Tier refusal — masks only come from Ravensburger today, but mirror the
  // _imageSource pattern so a future manual-override tier is possible.
  if (card._foilMaskSourceLock) {
    return { eligible: 0, failures: [], changed: false };
  }

  if (!ctx.r2) {
    // True dry-run with no creds — we can't even probe upstream without
    // risking the same rate-limit cost, so just count eligibility.
    if (card.foilMaskUrl) eligible++;
    if (card.foilTopLayerMaskUrl) eligible++;
    return { eligible, failures: [], changed: false };
  }

  // Base mask
  if (card.foilMaskUrl) {
    eligible++;
    // The "upstream URL" we use is the current `foilMaskUrl` IF it still
    // looks upstream-shaped (fresh from import). If it's already R2-shaped,
    // prefer the stored `_foilMaskSourceUrl`. Post-import the two diverge:
    // `foilMaskUrl` points at upstream, `_foilMaskSourceUrl` carries the
    // last-synced upstream URL. Either way, same-URL check catches the
    // "nothing changed" case.
    const upstream = isR2MaskShaped(card.foilMaskUrl, ctx.r2.config.publicBaseUrl)
      ? card._foilMaskSourceUrl ?? card.foilMaskUrl
      : card.foilMaskUrl;
    const result = await syncOneMask({
      setId: card.setId,
      number: card.number,
      slot: "base",
      upstreamUrl: upstream,
      storedR2Url: card.foilMaskUrl,
      storedSourceUrl: card._foilMaskSourceUrl,
      r2: ctx.r2,
      dryRun: ctx.dryRun,
    });
    baseStatus = result.status;
    if (result.status === "synced" && result.r2Url && result.sourceUrl) {
      card.foilMaskUrl = result.r2Url;
      card._foilMaskSourceUrl = result.sourceUrl;
      card._foilMaskSource = "ravensburger";
      changed = true;
    } else if (result.status === "failed") {
      failures.push(`base: ${result.error}`);
    }
  }

  // Top mask (same shape)
  if (card.foilTopLayerMaskUrl) {
    eligible++;
    const upstream = isR2MaskShaped(card.foilTopLayerMaskUrl, ctx.r2.config.publicBaseUrl)
      ? card._foilTopMaskSourceUrl ?? card.foilTopLayerMaskUrl
      : card.foilTopLayerMaskUrl;
    const result = await syncOneMask({
      setId: card.setId,
      number: card.number,
      slot: "top",
      upstreamUrl: upstream,
      storedR2Url: card.foilTopLayerMaskUrl,
      storedSourceUrl: card._foilTopMaskSourceUrl,
      r2: ctx.r2,
      dryRun: ctx.dryRun,
    });
    topStatus = result.status;
    if (result.status === "synced" && result.r2Url && result.sourceUrl) {
      card.foilTopLayerMaskUrl = result.r2Url;
      card._foilTopMaskSourceUrl = result.sourceUrl;
      card._foilMaskSource = "ravensburger";
      changed = true;
    } else if (result.status === "failed") {
      failures.push(`top: ${result.error}`);
    }
  }

  return {
    eligible,
    ...(baseStatus && { baseStatus }),
    ...(topStatus && { topStatus }),
    failures,
    changed,
  };
}

// ── Concurrency-limited batch ────────────────────────────────────────────────
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseCliArgs(process.argv);
  const r2Config = readR2ConfigFromEnv();
  const dryRun = args.dryRun || r2Config === null;
  const ctx = {
    r2: r2Config ? { config: r2Config, client: buildR2Client(r2Config) } : null,
    dryRun,
  };

  if (!ctx.r2) {
    console.log("  No R2 creds in .env — running in dry mode (counts only).\n");
  } else {
    console.log(`  Endpoint: https://${ctx.r2.config.accountId}.r2.cloudflarestorage.com`);
    console.log(`  Bucket:   ${ctx.r2.config.bucket}`);
    console.log(`  Public:   ${ctx.r2.config.publicBaseUrl}`);
    if (dryRun) console.log("  Mode:     DRY-RUN (fetches + hashes, skips upload)");
    console.log("");
  }

  const files = listCardSetFiles().filter((f) => {
    if (!args.sets || args.sets.length === 0) return true;
    // `card-set-12.json` → "12"; `card-set-P1.json` → "P1"
    const setId = f.replace(/^card-set-/, "").replace(/\.json$/, "");
    return args.sets.includes(setId);
  });

  let totalCards = 0, totalEligible = 0, totalSkipped = 0, totalSynced = 0, totalFailed = 0, totalLocked = 0;
  const failureExamples: string[] = [];
  const fileCounts: Record<string, number> = {};

  for (const file of files) {
    const cards = loadCardSet(file) as CardShape[];
    const limited = args.limit ? cards.slice(0, args.limit) : cards;

    const results = await runWithConcurrency(limited, 8, (c) => syncCardMasks(c, ctx));

    let changedInFile = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      totalCards++;
      totalEligible += r.eligible;
      if (r.baseStatus === "skipped") totalSkipped++;
      if (r.baseStatus === "synced") totalSynced++;
      if (r.baseStatus === "failed") totalFailed++;
      if (r.topStatus === "skipped") totalSkipped++;
      if (r.topStatus === "synced") totalSynced++;
      if (r.topStatus === "failed") totalFailed++;
      if (limited[i]!._foilMaskSourceLock) totalLocked++;
      if (r.changed) changedInFile++;
      for (const f of r.failures) {
        if (failureExamples.length < 5) {
          failureExamples.push(`  ${limited[i]!.setId}/${limited[i]!.number} ${f}`);
        }
      }
    }

    // Write the file back — even without changes, the library keeps stable
    // ordering; but writing is expensive for 200+ card JSONs so skip when
    // nothing changed. Also skip writes in full dry-run (no creds) since
    // no `r2Url` fields got computed.
    //
    // IMPORTANT: write the FULL `cards` array, not `limited`. `limited` is
    // a slice (= cards.slice(0, limit)), which is a new array of the SAME
    // element references. Mutations to `limited[i]` are already visible on
    // `cards[i]` because they share objects. Writing `limited` alone would
    // truncate the file to the first N cards and silently delete the rest
    // — caught the hard way during smoke testing.
    if (changedInFile > 0 && !dryRun) {
      writeCardSet(file, cards);
      fileCounts[file] = changedInFile;
    }
  }

  console.log("────────────────────────────────────────────────────────────────────");
  console.log(`  Cards scanned:        ${totalCards}`);
  console.log(`  Eligible mask slots:  ${totalEligible}`);
  console.log(`  Skipped (idempotent): ${totalSkipped}`);
  console.log(`  Synced:               ${totalSynced}`);
  console.log(`  Locked (skipped):     ${totalLocked}`);
  console.log(`  Failed:               ${totalFailed}`);
  console.log("────────────────────────────────────────────────────────────────────");
  if (Object.keys(fileCounts).length > 0) {
    console.log(`  Files changed:`);
    for (const [file, n] of Object.entries(fileCounts).sort()) {
      console.log(`    ${file}: ${n}`);
    }
  }
  if (failureExamples.length > 0) {
    console.log(`\n  First failures:`);
    for (const f of failureExamples) console.log(f);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
