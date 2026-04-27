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
 * Strip stray `%` section separators from Ravensburger's API encoding.
 * They appear before `\n` line breaks, before `\\name\\` ability markers,
 * before flavor-text attribution dashes, and as paragraph junctions —
 * always as junk separators, never as semantic percentages.
 *
 * The single semantic `%` in our data is "Battery at 100%." (Baymax flavor),
 * so the digit-prefix guard preserves it. Cleanup removes the `%` plus any
 * surrounding horizontal whitespace, then collapses double spaces and
 * trims leading/trailing whitespace on each line. `\n` line breaks are
 * preserved (rulesText uses them to separate ability blocks; the UI
 * renders via `whitespace-pre-line`).
 *
 * Scope: rulesText, flavorText, and per-ability-stub rulesText / raw fields.
 */
export function stripStraySeparators(text: string): string {
  if (!text) return text;
  // Strip `%` (and any leading horizontal whitespace) UNLESS it's preceded
  // by a digit — `100%` is the one semantic case. Lookbehind handles the
  // case where horizontal whitespace separates the digit and the `%`.
  let out = text.replace(/(?<!\d)[ \t]*%/g, "");
  // Collapse internal double spaces created by the strip.
  out = out.replace(/[ \t]{2,}/g, " ");
  // Drop trailing horizontal whitespace before each newline.
  out = out.replace(/[ \t]+\n/g, "\n");
  // Trim leading/trailing horizontal whitespace overall.
  out = out.replace(/^[ \t]+|[ \t]+$/g, "");
  return out;
}

/**
 * Split concatenated keyword reminders that share a line with no separator.
 *
 * Ravensburger occasionally emits two keyword reminder blocks fused together,
 * with the closing paren of one reminder bumping directly into the opening
 * `<` of the next keyword (e.g. `<Shift>...named Diablo.)<Evasive> (Only...)`).
 * The golden shape puts each keyword reminder on its own line — the line
 * filter in `extractNamedAbilities` (and downstream rendering in the UI) both
 * key off line breaks for keyword routing.
 *
 * Transformation: `)<` → `)\n<`. Lorcana rules text never legitimately uses
 * `<` after a closing paren outside the `<Keyword>` markup convention, so a
 * blanket substitution is safe (audit: 9 hits across set-4 as of 2026-04-27,
 * all of the form `)<Evasive>` / `)<Reckless>` / `)<Resist>` / `)<Bodyguard>`).
 *
 * Runs BEFORE `stripAbilityNameMarkers` in `normalizeRulesText` because the
 * marker strip is structurally line-aware and we want the reminders separated
 * before any other line-level processing kicks in. Conceptually paired with
 * `stripStraySeparators` — both are structural separator scrubs.
 *
 * No-op when no concatenation is present, so safe to run unconditionally.
 */
export function splitConcatenatedKeywordReminders(text: string): string {
  if (!text) return text;
  return text.replace(/\)</g, ")\n<");
}

/**
 * Convert Ravensburger's `\Name\` inline ability-section markers into the
 * golden line-break shape used everywhere else in our card JSON.
 *
 * Ravensburger's API uses paired `\NAME\` delimiters around ability names
 * inside a card's top-level `rules_text` (e.g. "<Evasive> (...)\Circle Far
 * and Wide\ During each opponent's turn..."). Properly-formatted Ravensburger
 * cards separate the keyword reminder block and the named ability with `\n`,
 * which the importer's `extractNamedAbilities` consumes — splitting on `\`,
 * rebuilding `cleanRulesText` as `<Keyword> (...)\nSTORYNAME body` (matches
 * the golden shape — uppercase name + line break, no surviving backslashes).
 *
 * BUT when Ravensburger returns a single-line rulesText (no `\n` between
 * keyword reminder and named-ability sections, e.g. "<Shift>...)\Name\ body"),
 * the importer's keyword-line filter swallows the entire string into
 * `keywordLines` and the `\Name\` markers survive into stored rulesText.
 * 43 cards across set 4 / P1 / P3 carry this artifact as of 2026-04-27.
 *
 * This helper rewrites paired markers into the golden shape:
 *   "...)\\Saving the Miracle\\ Whenever..."
 *     → "...)\nSAVING THE MIRACLE Whenever..."
 * matching the format `extractNamedAbilities` produces for properly-formatted
 * input. Use as both:
 *   (a) a terminal scrub on already-imported card JSONs (one-shot cleanup)
 *   (b) defense-in-depth on `cleanRulesText` after `extractNamedAbilities`
 *       runs, in case Ravensburger returns single-line concatenated text.
 *
 * Name canonicalization mirrors `canonicalizeStoryName` from import-cards-rav:
 *   - Uppercased
 *   - Curly apostrophe (U+2019) → ASCII (the line-level apostrophe normalizer
 *     re-curlies after this runs)
 *   - Bracket / ellipsis collapsing not needed here (no occurrences in the
 *     43 affected cards) — kept narrow to avoid over-fitting.
 *
 * Edge cases handled:
 *   - Apostrophes in names (`\You'll Listen to Me!\`) — `.+?` is Unicode-safe.
 *   - Trailing space inside closing marker (`\You Just Have to See It \`).
 *   - Multiple paired markers on one line (Ladies First / Leave It to Me).
 *
 * No-op when no markers are present, so it's safe to run unconditionally.
 */
export function stripAbilityNameMarkers(text: string): string {
  if (!text) return text;
  // Match paired `\Name\` (single backslash each side; JS regex one backslash
  // is `\\`). Lazy capture so multiple paired markers on one line each match
  // independently. Leading horizontal whitespace before the opening `\` is
  // consumed; trailing whitespace after the closing `\` collapses to a single
  // space (the body text typically starts with a space).
  let out = text.replace(/[ \t]*\\(.+?)\\[ \t]*/g, (_match, name: string) => {
    const canonical = (name as string)
      .toUpperCase()
      .replace(/’/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    // `\n` precedes the canonical name so it lands on its own line, matching
    // `<Keyword>...\nSTORYNAME body` golden shape from extractNamedAbilities.
    return `\n${canonical} `;
  });
  // Collapse double spaces created at boundaries.
  out = out.replace(/[ \t]{2,}/g, " ");
  // Drop horizontal whitespace before each newline.
  out = out.replace(/[ \t]+\n/g, "\n");
  // Drop horizontal whitespace after each newline (introduced if the body
  // started with a space).
  out = out.replace(/\n[ \t]+/g, "\n");
  // Trim leading/trailing whitespace overall (also catches any leading `\n`
  // injected when the marker was the very first thing in the text).
  out = out.replace(/^\s+|\s+$/g, "");
  return out;
}

/**
 * Full pipeline — apply all normalizations to a complete rulesText string.
 * Line-level keyword wrapping happens per-line; the rest are global.
 *
 * Order matters:
 *   (1) Stray-separator scrub FIRST — so `") %\\Name\\"` doesn't confuse
 *       the marker rewrite below.
 *   (2) Concatenated-keyword-reminder split SECOND — turns `)<Keyword>` into
 *       `)\n<Keyword>` so the line-splitter sees one keyword reminder per line
 *       before anything else processes the string.
 *   (3) Ability-name marker rewrite THIRD — converts `\Name\ body` into
 *       `\nNAME body` so the line-splitter sees the right shape.
 *   (4) Per-line keyword wrap, then global normalizations.
 */
export function normalizeRulesText(rawRulesText: string): string {
  if (!rawRulesText) return rawRulesText;
  let scrubbed = stripStraySeparators(rawRulesText);
  scrubbed = splitConcatenatedKeywordReminders(scrubbed);
  scrubbed = stripAbilityNameMarkers(scrubbed);
  const lines = scrubbed
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
