// =============================================================================
// rulesTextRender — split a Lorcana rulesText string on inline glyph tokens
// and emit ReactNodes that interleave text with <Glyph> components.
//
// Tokens recognized (counts across sets 1-12):
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
// Tokens NOT recognized (deliberately):
//   <Keyword>      — keyword names like <Singer>, <Rush>, <Shift>. Separate
//                    parked HANDOFF item ("render <Keyword> tokens as styled
//                    badges"). Left as plain text by this helper.
//   anything else  — unknown {X} tokens render as their literal source text
//                    so the data-loss is visible (no silent token-eating).
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

/** Match the recognized inline glyph tokens. Includes the multi-char
 *  `{IW}` alias alongside the single-letter `{[ISELWC]}` set. */
const TOKEN_PATTERN = /\{(?:IW|[ISELWC])\}/g;

/** Split a rulesText string into ReactNodes, swapping recognized {X} tokens
 *  for inline <Glyph> components. Plain text spans, unknown tokens, and
 *  <Keyword> tokens are returned verbatim.
 *
 *  @param size  Pixel size to pass to each Glyph. Match the surrounding font
 *               size for good visual rhythm (16 for 14px text, 14 for 12px).
 */
export function renderRulesText(text: string, size = 14): React.ReactNode[] {
  // Strip stray "%" section separators leaking from Ravensburger's API
  // encoding (107 occurrences across sets 2-3 + others). They appear
  // before \n paragraph breaks, before \\name\\ ability markers, and
  // before flavor attributions — always as junk separators, never as
  // semantic percentages. Only collapse HORIZONTAL whitespace runs
  // (spaces/tabs) so we preserve \n line breaks for the modal's
  // `whitespace-pre-line` styling.
  // TODO(engine HANDOFF): scrub at the importer / source JSON level so
  // decompile-cards and other consumers don't have to repeat this.
  text = text.replace(/%/g, "").replace(/[ \t]+/g, " ").trim();
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
    const glyphName = TOKEN_TO_GLYPH[match[0]];
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
      // Unknown token — fall through to literal text. Shouldn't happen given
      // the regex restricts to known tokens, but defensive against future
      // additions to TOKEN_TO_GLYPH that forget the pattern update.
      nodes.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
