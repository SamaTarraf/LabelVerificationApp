// Alcohol Content matcher: parses the % value from both sides, compares as an exact
// number (no tolerance, no fuzziness).
//
// This is one of the three fully algorithmic fields — the extractor only ever
// transcribes the text it found (`ExtractedFieldBase.foundText`), it never returns a
// status for alcoholContent. The match/mismatch decision is made entirely here, and
// deliberately allows zero rounding tolerance: "44.9%" vs "45%" is a mismatch no
// matter how small the numeric gap, because a fixed tolerance band would let a real
// discrepancy in a federally regulated value slip through as "close enough".

import type { FieldResult } from "../types";
import type { ExtractedFieldBase } from "../extraction/types";

/** Matches a leading number (optionally decimal) immediately followed by "%", e.g. "45%" inside "45% Alc./Vol. (90 Proof)". */
const PERCENT_REGEX = /(\d+(?:\.\d+)?)\s*%/;

/**
 * Pulls the first percentage value out of a piece of text, e.g. "45%" out of
 * "45% Alc./Vol. (90 Proof)". Returns null if no percentage is present at all, so the
 * caller can treat "couldn't find a number" differently from "found a number that
 * doesn't match".
 */
function parsePercent(text: string): number | null {
  const match = text.match(PERCENT_REGEX);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

/**
 * Matches the Alcohol Content field: parses the percentage out of both the
 * application's expected value and the label's transcribed text, then compares them
 * for exact numeric equality — no rounding, no tolerance band, whatsoever. Extra
 * surrounding text (e.g. "(90 Proof)") is ignored; only the parsed percentage itself
 * is compared.
 */
export function matchAlcoholContent(
  fieldName: string,
  applicationValue: string,
  extracted: ExtractedFieldBase
): FieldResult {
  const extractedValue = extracted.foundText;
  const applicationPercent = parsePercent(applicationValue);
  const labelPercent = parsePercent(extractedValue);

  // If either side has no parseable percentage at all, there's nothing to compare
  // numerically — treat as a mismatch rather than silently passing.
  if (applicationPercent === null || labelPercent === null) {
    return {
      field: fieldName,
      applicationValue,
      extractedValue,
      status: "mismatched",
    };
  }

  // Exact equality only — deliberately no rounding, no tolerance band. Any numeric
  // difference, however small, is a mismatch.
  const matches = applicationPercent === labelPercent;

  return {
    field: fieldName,
    applicationValue,
    extractedValue,
    status: matches ? "matched" : "mismatched",
  };
}
