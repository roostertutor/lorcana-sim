// =============================================================================
// IMAGE-SYNC CORE — shared pipeline for the three sync scripts
//
// Each sync script (sync-images-rav, sync-images-lorcast, sync-images-manual)
// runs the same pipeline for its own provenance tier:
//   1. Read card JSON from packages/engine/src/cards/card-set-<id>.json
//   2. For each card, decide whether to (re)sync its image:
//      - Skip if `_imageSourceLock: true` is pinned to a different tier.
//      - Skip if already at this tier with the SAME upstream URL (idempotent).
//      - Otherwise: fetch, resize (sharp — small 200w / normal 450w / large 900w),
//        hash, upload to R2 (or dry-run), rewrite card JSON fields.
//   3. Write JSON back when done.
//
// Dry-run mode is the default when R2 creds are missing from the environment,
// so you can iterate without actually provisioning an R2 bucket. With
// `--dry-run` explicitly set, the script skips the upload step but still runs
// resize + hash so it can report what WOULD be written.
//
// Variants/foil art are deferred — MVP ships regular `imageUrl` only. The
// `foilImageUrl` / `variants[].imageUrl` paths stay pointing at upstream URLs
// for now (which keeps the deckbuilder rendering today) and will get a second
// migration pass once regular-art coverage is ≥95%.
// =============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

// Load env vars from repo-root `.env` first, then `server/.env` as a fallback.
// dotenv.config() doesn't overwrite existing process.env values, so root-.env
// keys win when both files define them. Root .env is the right place for
// script-specific vars (R2_*); server .env stays isolated for server-only
// vars (SUPABASE_*). Both files are gitignored.
loadEnv({ path: resolve(".env") });
loadEnv({ path: resolve("server/.env") });

// ── Tiers ────────────────────────────────────────────────────────────────────
// Same hierarchy as CardDefinition._source. Higher tier refuses to be
// overwritten by a lower-tier sync.
export type ImageSourceTier = "ravensburger" | "lorcast" | "manual";

const TIER_RANK: Record<ImageSourceTier, number> = {
  ravensburger: 3,
  lorcast: 2,
  manual: 1,
};

/** Returns true if `newTier` is allowed to overwrite an entry currently at `currentTier`. */
function canOverwrite(
  currentTier: ImageSourceTier | undefined,
  newTier: ImageSourceTier,
): boolean {
  if (!currentTier) return true; // no existing entry — fill
  return TIER_RANK[newTier] >= TIER_RANK[currentTier];
}

// ── R2 client ────────────────────────────────────────────────────────────────
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** e.g. `https://cards.yourdomain.com` or `https://pub-xxxx.r2.dev` */
  publicBaseUrl: string;
}

/** Returns true if `url` looks like an R2 public URL produced by this pipeline:
 *  starts with the configured R2 public base AND ends with a known size suffix
 *  (`_small.jpg` / `_normal.jpg` / `_large.jpg`).
 *
 *  STRICT by design — a previous looser check (`url.includes("/setN/N_")`)
 *  also matched upstream Ravensburger URLs since those contain `/set1/1_` too,
 *  causing post-import skips that left 2/3 of the catalog pointing at
 *  Ravensburger CDN after a "restore" sync. Both `sync-images-rav` and
 *  `import-cards-rav` rely on this helper to decide "should I preserve the
 *  existing R2 imageUrl?" — they MUST agree on what counts as R2-shaped.
 *
 *  `r2Base` is the R2 public base URL with no trailing slash. Pass `null`
 *  when R2 creds aren't configured (caller should treat that as "no URL is
 *  R2-shaped" and fall through to the upstream URL).
 */
export function isR2Shape(url: string | undefined, r2Base: string | null): boolean {
  if (!url || !r2Base) return false;
  return url.startsWith(r2Base + "/") && /_(small|normal|large)\.jpg$/.test(url);
}

/** Read just the R2 public base URL from .env, without requiring full R2
 *  credentials. The importer needs this to detect R2-shaped imageUrls but
 *  doesn't actually need to upload — so it can fall back to "no R2 config
 *  installed" gracefully without forcing users to fill all R2_* vars. */
export function readR2PublicBaseUrlFromEnv(): string | null {
  const raw = process.env.R2_PUBLIC_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : null;
}

/** Read R2 config from .env. Returns null when any key is missing — callers
 *  fall back to dry-run automatically. Normalizes R2_ACCOUNT_ID defensively
 *  so users can paste either the bare hex ID or the full endpoint URL from
 *  the Cloudflare dashboard without breaking anything. */
export function readR2ConfigFromEnv(): R2Config | null {
  const rawAccountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!rawAccountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }
  // Accept: "abc123def456", "https://abc123def456.r2.cloudflarestorage.com",
  // "https://abc123def456.r2.cloudflarestorage.com/", or the full URL with a
  // path — strip everything down to the leading hex subdomain.
  const accountId = rawAccountId
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\..*$/, "")
    .replace(/\/.*$/, "");
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function buildR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 doesn't support virtual-hosted-style addressing for arbitrary bucket
    // names out of the box. Force path-style so the SDK sends
    // `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>` instead of
    // `https://<bucket>.<account>.r2.cloudflarestorage.com/<key>` — the
    // latter is what produced `lorcana-cards.https` hostname errors when
    // R2_ACCOUNT_ID contained junk.
    forcePathStyle: true,
    // As of @aws-sdk/client-s3 3.729+, the SDK sends `x-amz-checksum-crc32`
    // on every request by default — R2 doesn't fully support flexible
    // checksums and responds with an opaque HTTP 400 that the RestXml parser
    // chokes on ("UnknownError"). Opt out of both request/response checksums
    // to keep requests S3-classic. See aws/aws-sdk-js-v3#6810.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** True if the object already exists at the given key in R2 (so we can skip
 *  the upload). Content hash in the key means same key → same bytes, so this
 *  is a safe skip. */
async function r2ObjectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404) return false;
    if (err?.name === "NotFound") return false;
    // R2 returns 400 on auth/signature mismatches sometimes instead of 403.
    // Surface the full metadata so the user can diagnose (common causes:
    // wrong Access Key ID, wrong Secret, bucket in wrong account).
    const status = err?.$metadata?.httpStatusCode;
    if (status === 400 || status === 403) {
      console.error(`\n  R2 auth failure on HeadObject (${bucket}/${key}):`);
      console.error(`    httpStatusCode: ${status}`);
      console.error(`    errorCode: ${err?.Code ?? err?.name ?? "unknown"}`);
      console.error(`    errorMessage: ${err?.message ?? "(no message)"}`);
      if (err?.$response) {
        try {
          const body = await err.$response.body?.text?.();
          if (body) console.error(`    responseBody: ${body.slice(0, 400)}`);
        } catch {}
      }
      console.error(`  Check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env.`);
      console.error(`  Access Key ID should be a long hex string from`);
      console.error(`  Cloudflare Dashboard → R2 → Manage R2 API Tokens → your token.`);
    }
    throw err;
  }
}

// ── Image pipeline ──────────────────────────────────────────────────────────
export const IMAGE_SIZES = {
  small: 200,
  normal: 450,
  large: 900,
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

/** Resize an image buffer to the target width (keeping aspect ratio) and
 *  re-encode as JPEG with quality:85. Returns the encoded buffer. */
async function resizeJpeg(input: Buffer, widthPx: number): Promise<Buffer> {
  return sharp(input)
    .resize({ width: widthPx, withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true, mozjpeg: true })
    .toBuffer();
}

/** Hex-encoded SHA-256 of a buffer, truncated to 16 chars (enough for URL
 *  uniqueness; full hash is overkill for cache-busting). */
function hash16(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/** Build the R2 key for an image: `set12/123_<hash>_normal.jpg`. */
function buildR2Key(
  setId: string,
  number: number,
  hash: string,
  size: ImageSize,
): string {
  return `set${setId}/${number}_${hash}_${size}.jpg`;
}

/** Build the public URL a card's `imageUrl` points to. */
function buildPublicUrl(config: R2Config, key: string): string {
  return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
}

// ── Per-card sync ───────────────────────────────────────────────────────────
export interface SyncCardContext {
  /** Tier the CURRENT script writes. */
  tier: ImageSourceTier;
  /** R2 config + client. Null ⇒ dry-run (computes would-write URLs, skips upload). */
  r2: { config: R2Config; client: S3Client } | null;
  /** Additional forced-dry-run gate (e.g. user passed --dry-run flag). */
  dryRun: boolean;
}

export interface SyncCardResult {
  status: "uploaded" | "skipped_already_synced" | "skipped_higher_tier" | "skipped_locked" | "skipped_no_source_url" | "failed";
  reason?: string;
  updatedFields?: Partial<{
    imageUrl: string;
    _imageSource: ImageSourceTier;
    _sourceImageUrl: string;
  }>;
  hash?: string;
}

/** Download + resize + hash + upload a single card's image.
 *  Returns the JSON fields that should overwrite the card entry, or a reason
 *  why this card was skipped. */
export async function syncSingleCard(
  card: {
    setId: string;
    number: number;
    _imageSource?: ImageSourceTier;
    _sourceImageUrl?: string;
    _imageSourceLock?: boolean;
    imageUrl?: string;
  },
  sourceUpstreamUrl: string | undefined,
  ctx: SyncCardContext,
): Promise<SyncCardResult> {
  // Guard 1: explicit lock.
  if (card._imageSourceLock) {
    return { status: "skipped_locked", reason: `_imageSourceLock pinned to ${card._imageSource ?? "unknown"}` };
  }

  // Guard 2: refuse to downgrade.
  if (!canOverwrite(card._imageSource, ctx.tier)) {
    return { status: "skipped_higher_tier", reason: `already at ${card._imageSource} tier (higher than ${ctx.tier})` };
  }

  // Guard 3: no source URL for this tier — skip silently (expected for many
  // cards on Lorcast/manual tiers that don't have data at that tier).
  if (!sourceUpstreamUrl) {
    return { status: "skipped_no_source_url" };
  }

  // Guard 4: already synced from THIS upstream URL at this tier AND the
  // card's `imageUrl` already points to R2. Idempotent re-run short-circuits
  // here — no fetch, no upload.
  //
  // The third condition (`imageUrl` R2-shaped) matters because `pnpm
  // import-cards` rewrites `imageUrl` back to the upstream URL on every
  // re-import. When that happens we WANT to re-process the card even if
  // upstream hasn't rotated: the re-sync restores `imageUrl` to R2 (and
  // since the bytes are unchanged, produces the same content hash, so R2
  // PutObject is effectively a no-op on the backend — just network cost).
  //
  // The check must be STRICT about R2-shape. A previous implementation used
  // `imageUrl.includes("/set{N}/{num}_")` which matched both R2 keys
  // (`set1/1_hash_normal.jpg`) AND upstream Rav URLs
  // (`images/en/set1/1_hash.jpg`) — both contain `/set1/1_`. Post-import the
  // check would wrongly skip cards whose imageUrl had just been reset to
  // upstream, leaving 2/3 of the catalog pointing at Ravensburger CDN after
  // the "restore" sync. Fix: require imageUrl to start with the configured
  // R2 public base and end with a known size suffix. See isR2Shape.
  const r2Base = ctx.r2 ? ctx.r2.config.publicBaseUrl.replace(/\/$/, "") : null;
  if (
    card._imageSource === ctx.tier &&
    card._sourceImageUrl === sourceUpstreamUrl &&
    isR2Shape(card.imageUrl, r2Base)
  ) {
    return { status: "skipped_already_synced" };
  }

  // ── Download / read ──
  // URLs starting with `file://` read from local disk — the manual tier
  // drops images into `assets/manual-cards/` and the sync script passes that
  // path through this shared pipeline.
  let sourceBuf: Buffer;
  try {
    if (sourceUpstreamUrl.startsWith("file://")) {
      const localPath = sourceUpstreamUrl.replace(/^file:\/\//, "");
      sourceBuf = readFileSync(localPath);
    } else {
      const res = await fetch(sourceUpstreamUrl);
      if (!res.ok) {
        return { status: "failed", reason: `upstream HTTP ${res.status} on ${sourceUpstreamUrl}` };
      }
      const ab = await res.arrayBuffer();
      sourceBuf = Buffer.from(ab);
    }
  } catch (err: any) {
    return { status: "failed", reason: `fetch error: ${err?.message ?? err}` };
  }

  // ── Resize (run each size in parallel; source image is small enough) ──
  const sizeEntries = Object.entries(IMAGE_SIZES) as [ImageSize, number][];
  const resized = await Promise.all(
    sizeEntries.map(async ([size, px]) => [size, await resizeJpeg(sourceBuf, px)] as const),
  );

  // ── Hash (use the `normal` size as the canonical hash input — stable
  // across re-runs of the same upstream URL). ──
  const normalBuf = resized.find(([s]) => s === "normal")![1];
  const hash = hash16(normalBuf);

  // ── Upload (or dry-run) ──
  const keyFor = (size: ImageSize) => buildR2Key(card.setId, card.number, hash, size);

  if (ctx.r2 && !ctx.dryRun) {
    // Parallelize the 3 size uploads — they're independent.
    // Note: dropped the HeadObject preflight because PUTs are idempotent at
    // same-key (content-hashed keys guarantee same bytes), the preflight
    // doubled the round-trip count per card during first-time migration, and
    // S3/R2 PUT with identical bytes is effectively a no-op on the backend.
    // Re-runs short-circuit at the card level (_sourceImageUrl === X check
    // at the top of this function), so we never reach this upload block
    // twice for the same card-hash.
    await Promise.all(
      resized.map(([size, buf]) =>
        ctx.r2!.client.send(
          new PutObjectCommand({
            Bucket: ctx.r2!.config.bucket,
            Key: keyFor(size),
            Body: buf,
            ContentType: "image/jpeg",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        ),
      ),
    );
  }

  // ── Compute new imageUrl (always — even in dry-run, so JSON preview is
  // representative of what a real run would produce). ──
  const baseUrl = ctx.r2
    ? buildPublicUrl(ctx.r2.config, keyFor("normal"))
    : `https://cards.example.invalid/${keyFor("normal")}`; // dry-run placeholder

  return {
    status: "uploaded",
    hash,
    updatedFields: {
      imageUrl: baseUrl,
      _imageSource: ctx.tier,
      _sourceImageUrl: sourceUpstreamUrl,
    },
  };
}

// ── Card-set JSON file helpers ──────────────────────────────────────────────
const CARDS_DIR = resolve("packages/engine/src/cards");

export function listCardSetFiles(): string[] {
  return require("node:fs")
    .readdirSync(CARDS_DIR)
    .filter((f: string) => f.startsWith("card-set-") && f.endsWith(".json"));
}

export function loadCardSet(filename: string): any[] {
  return JSON.parse(readFileSync(join(CARDS_DIR, filename), "utf8"));
}

export function writeCardSet(filename: string, data: any[]): void {
  writeFileSync(join(CARDS_DIR, filename), JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ── CLI arg parsing ─────────────────────────────────────────────────────────
export interface CliArgs {
  dryRun: boolean;
  sets?: string[];
  /** Limit to first N cards (for smoke testing). */
  limit?: number;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--sets" && argv[i + 1]) {
      args.sets = argv[++i]!.split(",").map((s) => s.trim());
    } else if (a === "--limit" && argv[i + 1]) {
      args.limit = parseInt(argv[++i]!, 10);
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: pnpm <script-name> [--dry-run] [--sets set12,P1,...] [--limit 10]

  --dry-run   skip R2 upload; compute hashes + preview JSON writes
              (auto-enabled when R2 creds missing from .env)
  --sets      comma-separated set ids to sync (default: all)
  --limit N   only process the first N cards across selected sets`);
      process.exit(0);
    }
  }
  return args;
}

// ── Top-level runner ────────────────────────────────────────────────────────
export interface RunnerOptions {
  tier: ImageSourceTier;
  /** Extract upstream URL for this card from its raw JSON entry. Returns
   *  undefined if this tier doesn't have data for that card. */
  getSourceUrl: (card: any) => string | undefined;
  args: CliArgs;
}

export interface RunnerSummary {
  uploaded: number;
  alreadySynced: number;
  higherTier: number;
  locked: number;
  noSourceUrl: number;
  failed: number;
  perFile: Map<string, number>;
}

export async function runSync(options: RunnerOptions): Promise<RunnerSummary> {
  const { tier, getSourceUrl, args } = options;

  const r2Config = readR2ConfigFromEnv();
  const r2 = r2Config && !args.dryRun ? { config: r2Config, client: buildR2Client(r2Config) } : null;
  const effectiveDryRun = args.dryRun || !r2Config;

  console.log(`Image sync: tier=${tier}, mode=${effectiveDryRun ? "DRY RUN" : "LIVE"}`);
  if (!r2Config && !args.dryRun) {
    console.log(`  (R2 env vars missing — forcing --dry-run. Fill .env with R2_ACCOUNT_ID,`);
    console.log(`   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL to go live.)`);
  }
  if (args.dryRun && r2Config) {
    console.log(`  (R2 creds present but --dry-run forced; skipping upload.)`);
  }
  if (r2 && !effectiveDryRun) {
    console.log(`  Endpoint: https://${r2Config!.accountId}.r2.cloudflarestorage.com`);
    console.log(`  Bucket:   ${r2Config!.bucket}`);
    console.log(`  Public:   ${r2Config!.publicBaseUrl}`);
  }

  const summary: RunnerSummary = {
    uploaded: 0,
    alreadySynced: 0,
    higherTier: 0,
    locked: 0,
    noSourceUrl: 0,
    failed: 0,
    perFile: new Map(),
  };

  const files = listCardSetFiles();
  const ctx: SyncCardContext = { tier, r2, dryRun: effectiveDryRun };

  let processed = 0;

  for (const filename of files) {
    // Filter by --sets if provided
    if (args.sets) {
      const setId = filename.replace(/^card-set-|\.json$/g, "");
      if (!args.sets.includes(setId)) continue;
    }

    const cards = loadCardSet(filename);
    let fileChanges = 0;

    // Process cards in parallel batches. Network latency dominates
    // per-card time (fetch from upstream + 3 PUTs to R2), so batching 8 at
    // a time gives roughly 8x throughput until we saturate the uplink.
    // Still bounded per-file so we don't load 2k images into memory at once.
    const BATCH = 8;
    for (let i = 0; i < cards.length; i += BATCH) {
      if (args.limit !== undefined && processed >= args.limit) break;

      const batch = cards.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map((card) => syncSingleCard(card, getSourceUrl(card), ctx)),
      );

      for (let j = 0; j < batch.length; j++) {
        if (args.limit !== undefined && processed >= args.limit) break;
        processed++;
        const card = batch[j]!;
        const result = batchResults[j]!;
        switch (result.status) {
          case "uploaded":
            summary.uploaded++;
            Object.assign(card, result.updatedFields);
            fileChanges++;
            break;
          case "skipped_already_synced":
            summary.alreadySynced++;
            break;
          case "skipped_higher_tier":
            summary.higherTier++;
            break;
          case "skipped_locked":
            summary.locked++;
            break;
          case "skipped_no_source_url":
            summary.noSourceUrl++;
            break;
          case "failed":
            summary.failed++;
            console.log(`  ✗ set${card.setId}/#${card.number} ${card.fullName ?? card.id}: ${result.reason}`);
            break;
        }
      }
    }

    // Write the file back if anything changed (only in non-dry-run — we don't
    // want dry-run to mutate JSON with placeholder URLs).
    if (fileChanges > 0 && !effectiveDryRun) {
      writeCardSet(filename, cards);
      summary.perFile.set(filename, fileChanges);
    } else if (fileChanges > 0 && effectiveDryRun) {
      summary.perFile.set(filename, fileChanges);
    }

    if (args.limit !== undefined && processed >= args.limit) break;
  }

  return summary;
}

export function printSummary(summary: RunnerSummary, tier: ImageSourceTier, dryRun: boolean): void {
  console.log();
  console.log("─".repeat(68));
  console.log(`  Uploaded:              ${summary.uploaded}`);
  console.log(`  Skipped (already synced): ${summary.alreadySynced}`);
  console.log(`  Skipped (higher tier):    ${summary.higherTier}`);
  console.log(`  Skipped (locked):         ${summary.locked}`);
  console.log(`  Skipped (no source URL):  ${summary.noSourceUrl}`);
  console.log(`  Failed:                ${summary.failed}`);
  console.log("─".repeat(68));
  if (summary.perFile.size > 0) {
    console.log(`  Files ${dryRun ? "that would change" : "changed"}:`);
    for (const [file, n] of [...summary.perFile.entries()].sort()) {
      console.log(`    ${file}: ${n}`);
    }
  }
  if (dryRun) {
    console.log();
    console.log(`  DRY RUN — no R2 uploads performed, no card JSON written.`);
    console.log(`  Re-run without --dry-run (and with R2 creds in .env) to commit.`);
  }
}
