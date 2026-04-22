// Post-migration sanity check: every card with `_imageSource` set should have
// its `imageUrl` respond 200. Probes with HEAD requests (no body download).
// Run after `pnpm sync-images-rav` / `sync-images-lorcast` to catch any URLs
// that made it into JSON but aren't actually live in R2.
//
// Usage: pnpm tsx scripts/verify-r2-urls.ts [--sets 12,P1]

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const CARDS_DIR = resolve("packages/engine/src/cards");

const args = process.argv.slice(2);
const setsArg = args.find((a, i) => args[i - 1] === "--sets");
const filterSets = setsArg?.split(",").map((s) => s.trim());

// pub-*.r2.dev URLs are aggressively rate-limited (~20 req/s). Using a low
// batch size with a small delay between batches keeps us under the threshold.
// Custom-domain R2 URLs don't have this cap — raise BATCH if you're on one.
const BATCH = 4;
const BATCH_DELAY_MS = 200;

interface UrlCheck {
  setId: string;
  number: number;
  fullName: string;
  url: string;
  imageSource: string;
}

const toCheck: UrlCheck[] = [];
const files = readdirSync(CARDS_DIR)
  .filter((f) => f.startsWith("card-set-") && f.endsWith(".json"));

for (const file of files) {
  const setId = file.replace(/^card-set-|\.json$/g, "");
  if (filterSets && !filterSets.includes(setId)) continue;
  const data: any[] = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf8"));
  for (const card of data) {
    if (!card._imageSource) continue; // not migrated yet
    if (!card.imageUrl) continue;
    toCheck.push({
      setId,
      number: card.number,
      fullName: card.fullName ?? card.id,
      url: card.imageUrl,
      imageSource: card._imageSource,
    });
  }
}

console.log(`Verifying ${toCheck.length} migrated URLs across ${new Set(toCheck.map((c) => c.setId)).size} sets...\n`);

async function checkOne(entry: UrlCheck): Promise<{ entry: UrlCheck; ok: boolean; status: number | string }> {
  // Retry once on 429 with exponential backoff — the pub-*.r2.dev rate
  // limits burst but resets quickly.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(entry.url, { method: "HEAD" });
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return { entry, ok: res.ok, status: res.status };
    } catch (err: any) {
      if (attempt === 2) return { entry, ok: false, status: err?.message ?? "error" };
    }
  }
  return { entry, ok: false, status: "exhausted retries" };
}

async function main() {
  let ok = 0;
  const failures: { entry: UrlCheck; status: number | string }[] = [];

  for (let i = 0; i < toCheck.length; i += BATCH) {
    const batch = toCheck.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(checkOne));
    for (const r of results) {
      if (r.ok) {
        ok++;
      } else {
        failures.push(r);
      }
    }
    process.stdout.write(`\r  Checked ${Math.min(i + BATCH, toCheck.length)}/${toCheck.length}, ${failures.length} failing`);
    if (i + BATCH < toCheck.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  process.stdout.write("\n\n");

  console.log(`✓ ${ok}/${toCheck.length} URLs live`);
  if (failures.length > 0) {
    console.log(`✗ ${failures.length} failing:\n`);
    for (const f of failures.slice(0, 20)) {
      console.log(`  [${f.status}] set${f.entry.setId}/#${f.entry.number} ${f.entry.fullName}`);
      console.log(`    ${f.entry.url}`);
    }
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
