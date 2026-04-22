// Quick probe of R2 bucket object count + size. Used during the one-time
// migration to watch upload progress. Delete after migration lands.

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(".env") });
loadEnv({ path: resolve("server/.env") });

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID!
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\..*$/, "")
  .replace(/\/.*$/, "");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

async function main() {
  let total = 0;
  let totalSize = 0;
  const bySet = new Map<string, number>();
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET!,
        MaxKeys: 1000,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      total++;
      totalSize += obj.Size ?? 0;
      const setMatch = obj.Key?.match(/^(set\w+)\//);
      if (setMatch) {
        bySet.set(setMatch[1]!, (bySet.get(setMatch[1]!) ?? 0) + 1);
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  console.log(`R2 bucket total: ${total} objects, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log();
  for (const [set, n] of [...bySet.entries()].sort()) {
    console.log(`  ${set}: ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
