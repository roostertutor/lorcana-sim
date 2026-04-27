// =============================================================================
// rulesTextRender — split a Lorcana rulesText string on inline glyph + keyword
// tokens and emit ReactNodes that interleave text with styled spans.
//
// Glyph tokens (counts across sets 1-12):
//   {I}  — ink cost          (686 cards) → ink glyph
//   {S}  — strength            (614)     → strength glyph
//   {E}  — exert               (388)     → exert glyph
//   {L}  — lore                (164)     → lore glyph
//   {W}  — willpower            (36)     → willpower glyph
//   {C}  — inkable indicator    (4)      → inkable glyph
//                                          (e.g. Hidden Inkcaster: "count
//                                          as having {C}")
//   {IW} — inkable indicator    (4)      → inkable glyph (alias for {C})
//                                          Ravensburger inconsistency
//                                          across imports — set 4 uses
//                                          {C}, set 8 / P1 use {IW} for
//                                          the same glyph. Both render
//                                          to the inkable glyph here.
//
// Keyword tokens — angle-bracket-wrapped keyword markup from the importer's
// `normalize-rules-text.ts` pipeline (e.g. `<Evasive>`, `<Shift: Discard an
// action card>`, `<Sing Together>`). Rendered as bold inline text WITHOUT
// the angle brackets, so the keyword reads as a stylistic emphasis instead
// of consuming character spaces with literal `<` / `>` punctuation.
// Keywords inside reminder parens (e.g. "...characters with Evasive can...")
// are plain text and untouched.
//
// Anything else: unknown {X} tokens render as their literal source text so
// data-loss is visible (no silent token-eating).
// =============================================================================

import React from "react";
import Glyph, { type GlyphName } from "../components/Glyph.js";

const TOKEN_TO_GLYPH: Record<string, GlyphName> = {
  "{I}": "ink",
  "{S}": "strength",
  "{E}": "exert",
  "{L}": "lore",
  "{W}": "willpower",
  "{C}": "inkable",
  "{IW}": "inkable",
};

/** Combined token matcher — glyph braces OR keyword angle brackets.
 *
 *  Glyph branch: `{IW}` or `{[ISELWC]}` (the multi-char alias listed first
 *  so the alternation matches it before the single-char prefix).
 *
 *  Keyword branch: `<Keyword[: alt-cost]>` for any of the known Lorcana
 *  keywords. Keywords are listed multi-word-first so `Sing Together` matches
 *  in full before alternations would otherwise prefix-match. The trailing
 *  `[^>]*` captures optional inline parameter text like `: Discard an action
 *  card` (alt-cost shifts) — everything between the first character of the
 *  keyword name and the closing `>`.
 */
const TOKEN_PATTERN =
  /\{(?:IW|[ISELWC])\}|<(?:Sing Together|Bodyguard|Challenger|Evasive|Reckless|Resist|Rush|Shift|Singer|Support|Vanish|Ward|Boost|Alert)[^>]*>/g;

/** Split a rulesText string into ReactNodes, swapping recognized tokens for
 *  styled inline elements. Plain text spans are returned verbatim.
 *
 *  @param size  Pixel size to pass to each Glyph. Match the surrounding font
 *               size for good visual rhythm (16 for 14px text, 14 for 12px).
 */
export function renderRulesText(text: string, size = 14): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Reset regex state — TOKEN_PATTERN is a module-level RegExp with /g, so
  // the last lastIndex from a prior call would mis-anchor this one.
  TOKEN_PATTERN.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const fullMatch = match[0];
    if (fullMatch.charCodeAt(0) === 0x7b /* { */) {
      // Glyph token: `{X}` or `{IW}`.
      const glyphName = TOKEN_TO_GLYPH[fullMatch];
      if (glyphName) {
        nodes.push(
          <Glyph
            key={`g${key++}`}
            name={glyphName}
            size={size}
            className="mx-0.5"
          />,
        );
      } else {
        // Unknown brace token — fall through to literal text. Shouldn't happen
        // given the regex restricts to known glyphs, but defensive against
        // future TOKEN_TO_GLYPH additions that forget the pattern update.
        nodes.push(fullMatch);
      }
    } else {
      // Keyword token: `<Evasive>` or `<Shift: Discard an action card>`.
      // Strip the angle brackets and bold the inner content so the keyword
      // is visually emphasized without eating character spaces with literal
      // `<` / `>` punctuation in the rendered text.
      const inner = fullMatch.slice(1, -1);
      nodes.push(
        <strong key={`k${key++}`} className="font-bold">
          {inner}
        </strong>,
      );
    }
    lastIndex = match.index + fullMatch.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
