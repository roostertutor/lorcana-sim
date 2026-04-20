// =============================================================================
// SHARED RULES-TEXT NORMALIZATION — the "golden shape"
// Used by scripts/import-cards-rav.ts, scripts/import-cards-lorcast.ts,
// scripts/compare-sources.ts, and packages/ui/vite-plugins/dev-card-writer.ts
// so all three entry points (Ravensburger API, Lorcast API, manual GUI entry)
// produce byte-identical rulesText for the same card.
//
// Why this matters:
//   - The GUI card highlighter (CardTextRender) regex-parses `<Keyword>` tokens
//     to render them with keyword icons. Uniform bracketing = uniform styling.
//   - The decompiler scores rendered JSON-to-English against rulesText; if the
//     stored text shape differs per source, the same card's score diverges too.
//   - Re-importing a card from a different tier shouldn't flip the field.
//
// The golden conventions (authoritative even where Ravensburger's own data is
// inconsistent):
//   (1) ALL keyword references wrap in <>, whether line-start or inline,
//       whether value-bearing or not. Ravensburger itself is inconsistent
//       (`gains <Challenger> +1` is wrapped, `gain Rush` is not) — we pick
//       the stricter uniform rule. This is a DEVIATION from upstream golden
//       source text for uniformity's sake, as agreed.
//   (2) Inside reminder-text parens, keywords are NEVER wrapped.
//       (`(Only characters with Evasive can challenge this character.)`)
//   (3) Apostrophes: curly right single quote (U+2019).
//   (4) Stat-modifier dashes: en-dash (U+2013) for `-N {S|L|I}` form.
//   (5) Granted-ability quote-wrapped text: curly double quotes (U+201C/D).
//   (6) No trailing whitespace before newlines.
// =============================================================================

// Keyword names in Ravensburger's `<Keyword>` canonical form. Multi-word
// keywords MUST come first so prefix-matching doesn't consume the first word.
export const KEYWORD_NAMES_RAV_SHAPE = [
  "Sing Together",
  "Bodyguard", "Challenger", "Evasive", "Reckless", "Resist",
  "Rush", "Shift", "Singer", "Support", "Vanish", "Ward",
  "Boost", "Alert",
] as const;

// Wrap a keyword at the start of a line. Preserves whatever follows.
//   "Singer 5 (reminder)"  →  "<Singer> 5 (reminder)"
//   "Sing Together 6 ..."  →  "<Sing Together> 6 ..."
function wrapLineStartKeyword(line: string): string {
  for (const kw of KEYWORD_NAMES_RAV_SHAPE) {
    const escaped = kw.replace(/ /g, "\\s+");
    const re = new RegExp(`^${escaped}\\b`);
    if (re.test(line)) return line.replace(re, `<${kw}>`);
  }
  return line;
}

// Wrap inline keyword references, preserving reminder-paren content.
// Every keyword reference — value-bearing or not — gets wrapped.
//   "gain Rush this turn"           → "gain <Rush> this turn"
//   "gain Challenger +1"            → "gain <Challenger> +1"
//   "(with Evasive can challenge)"  → "(with Evasive can challenge)"  [unchanged]
function wrapInlineKeywordRefs(line: string): string {
  const segments = line.split(/(\([^)]*\))/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // paren-enclosed segment — leave alone
      let out = seg;
      for (const kw of KEYWORD_NAMES_RAV_SHAPE) {
        const escaped = kw.replace(/ /g, "\\s+");
        // `(?<!<)` guards against re-wrapping an already-<Keyword> token.
        const re = new RegExp(`(?<!<)\\b${escaped}\\b`, "g");
        out = out.replace(re, `<${kw}>`);
      }
      return out;
    })
    .join("");
}

/** Normalize a single line — line-start wrap first, then inline. */
export function normalizeKeywordLine(line: string): string {
  return wrapInlineKeywordRefs(wrapLineStartKeyword(line));
}

/** Apostrophes: straight ` ' ` → curly right single quote U+2019. */
export function normalizeApostrophes(text: string): string {
  return text.replace(/'/g, "\u2019");
}

/** Stat-modifier dash: ` -N {S|L|I}` → ` –N {S|L|I}` (en-dash, U+2013). */
export function normalizeDashes(text: string): string {
  return text.replace(/ -(\d+\s*\{[SLI]\})/g, " \u2013$1");
}

/**
 * Straight double quotes → curly (U+201C open / U+201D close) for
 * granted-ability quote-wrapped text. Pairs matched greedily: odd=open, even=close.
 */
export function normalizeDoubleQuotes(text: string): string {
  let open = true;
  return text.replace(/"/g, () => {
    const q = open ? "\u201C" : "\u201D";
    open = !open;
    return q;
  });
}

/** Strip trailing whitespace before newlines and at end of text. */
export function stripTrailingWhitespace(text: string): string {
  return text.replace(/ +\n/g, "\n").replace(/ +$/, "");
}

/**
 * Full pipeline — apply all normalizations to a complete rulesText string.
 * Line-level keyword wrapping happens per-line; the rest are global.
 */
export function normalizeRulesText(rawRulesText: string): string {
  if (!rawRulesText) return rawRulesText;
  const lines = rawRulesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(normalizeKeywordLine);
  if (!lines.length) return "";
  let out = lines.join("\n");
  out = normalizeApostrophes(out);
  out = normalizeDashes(out);
  out = normalizeDoubleQuotes(out);
  out = stripTrailingWhitespace(out);
  return out;
}
