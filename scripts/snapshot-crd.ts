// =============================================================================
// CRD SNAPSHOT
// -----------------------------------------------------------------------------
// Converts the current Disney Lorcana Comprehensive Rules PDF in docs/ to a
// committed plain-text snapshot at `docs/CRD_SNAPSHOT.txt`. The snapshot is
// the diff target — when Ravensburger publishes a new CRD revision:
//
//   1. Replace `docs/Disney-Lorcana-Comprehensive-Rules-<NEW>.pdf` (drop the
//      old one or keep both — the script picks the lexicographically latest).
//   2. Run `pnpm snapshot-crd` to regenerate `docs/CRD_SNAPSHOT.txt`.
//   3. `git diff docs/CRD_SNAPSHOT.txt` shows every line that changed —
//      that's the rules-update review surface.
//   4. For each changed section, update `docs/CRD_TRACKER.md` if the rule
//      number / status / engine support entry needs revising.
//
// Requires the `pdftotext` binary (Poppler / Glyph & Cog distribution). On
// Windows-mingw64 / Git Bash the binary lives at /mingw64/bin/pdftotext.
// =============================================================================

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "..", "docs");
const SNAPSHOT_PATH = join(DOCS_DIR, "CRD_SNAPSHOT.txt");

function findLatestCrdPdf(): string {
  const candidates = readdirSync(DOCS_DIR)
    .filter((f) => /^Disney-Lorcana-Comprehensive-Rules.*\.pdf$/i.test(f))
    .sort();  // lexicographic — date-suffixed filenames sort to latest at end
  if (candidates.length === 0) {
    throw new Error(
      `No Disney-Lorcana-Comprehensive-Rules-*.pdf in ${DOCS_DIR}. ` +
      `Drop the latest CRD PDF into docs/ and re-run.`,
    );
  }
  return join(DOCS_DIR, candidates[candidates.length - 1]!);
}

function runPdfToText(pdfPath: string, outPath: string): void {
  // -layout preserves columns / indentation so section numbers stay aligned
  // (CRD's two-column TOC + nested rule numbering relies on this for stable
  // diffs across revisions). Without -layout, pdftotext's reflow heuristic
  // re-paragraphs across visual columns and produces noisy diffs.
  try {
    execSync(`pdftotext -layout "${pdfPath}" "${outPath}"`, { stdio: "inherit" });
  } catch (err: any) {
    throw new Error(
      `pdftotext failed: ${err.message}\n` +
      `Install Poppler (mingw64: included; macOS: 'brew install poppler'; ` +
      `Linux: 'apt install poppler-utils').`,
    );
  }
}

function extractVersionInfo(text: string): { version: string; effectiveDate: string } {
  const versionMatch = text.match(/Version\s+([\d.]+)/i);
  const dateMatch = text.match(/Effective\s+([A-Z][a-z]+\s+\d+,\s+\d{4})/i);
  return {
    version: versionMatch?.[1] ?? "unknown",
    effectiveDate: dateMatch?.[1] ?? "unknown",
  };
}

function main(): void {
  const pdfPath = findLatestCrdPdf();
  console.log(`[snapshot-crd] source PDF: ${pdfPath}`);
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found at ${pdfPath}`);
  }
  const pdfStat = statSync(pdfPath);

  runPdfToText(pdfPath, SNAPSHOT_PATH);

  const text = readFileSync(SNAPSHOT_PATH, "utf8");
  const { version, effectiveDate } = extractVersionInfo(text);
  const lineCount = text.split(/\r?\n/).length;

  // Prepend a header so the snapshot self-documents its provenance. The
  // header lines are stripped by `git diff -G '^[^#]'` if you want a
  // body-only diff.
  const header = [
    `# CRD snapshot`,
    `# Source PDF: ${pdfPath.split(/[\\/]/).pop()}`,
    `# PDF size: ${pdfStat.size} bytes (mtime ${pdfStat.mtime.toISOString()})`,
    `# Detected version: ${version}`,
    `# Detected effective date: ${effectiveDate}`,
    `# Snapshot generated: ${new Date().toISOString()}`,
    `# Lines: ${lineCount}`,
    `# Tool: pdftotext -layout (Poppler / Glyph & Cog)`,
    `#`,
    `# Diff workflow: see docs/CRD_TRACKER.md → "Diffing a new CRD revision"`,
    `# ----------------------------------------------------------------------`,
    "",
  ].join("\n");
  writeFileSync(SNAPSHOT_PATH, header + text);

  console.log(`[snapshot-crd] wrote ${SNAPSHOT_PATH}`);
  console.log(`               version ${version}, effective ${effectiveDate}, ${lineCount} lines`);
  console.log(`[snapshot-crd] git diff docs/CRD_SNAPSHOT.txt — to review changes vs the previous snapshot`);
}

main();
