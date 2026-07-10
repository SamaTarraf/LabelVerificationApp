// Alcohol Content matcher: parses the % value from both sides, compares as an exact
// number (no tolerance, no fuzziness). If both sides also state a proof number,
// that's compared too — so a proof typo can't slip through just because the
// percentage happens to be correct.
//
// This is one of the three fully algorithmic fields — the extractor only ever
// transcribes the text it found (`ExtractedFieldBase.foundText`), it never returns a
// status for alcoholContent. The match/mismatch decision is made entirely here, and
// deliberately allows zero rounding tolerance: "44.9%" vs "45%" is a mismatch no
// matter how small the numeric gap, because a fixed tolerance band would let a real
// discrepancy in a federally regulated value slip through as "close enough". The same
// zero-tolerance rule applies to proof once both sides state one.

import type { FieldResult } from "../types";
import type { ExtractedFieldBase } from "../extraction/types";

/** Matches a leading number (optionally decimal) immediately followed by "%", e.g. "45%" inside "45% Alc./Vol. (90 Proof)". */
const PERCENT_REGEX = /(\d+(?:\.\d+)?)\s*%/;

/** Matches a leading number (optionally decimal) immediately followed by "Proof" (case-insensitive), e.g. "90" inside "(90 Proof)". */
const PROOF_REGEX = /(\d+(?:\.\d+)?)\s*proof/i;

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
 * Pulls the proof number out of a piece of text, e.g. "90" out of
 * "45% Alc./Vol. (90 Proof)". Returns null if no proof number is present — proof is
 * optional supplementary text on US labels (percentage is the field that's always
 * required), so its absence is not itself a problem.
 */
function parseProof(text: string): number | null {
  const match = text.match(PROOF_REGEX);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

/**
 * Matches the Alcohol Content field: parses the percentage out of both the
 * application's expected value and the label's transcribed text, then compares them
 * for exact numeric equality — no rounding, no tolerance band, whatsoever.
 *
 * If a proof number is present on *both* sides, it's compared for exact equality too
 * — a typo in just the proof portion (e.g. application says "(90 Proof)", label says
 * "(91 Proof)") would otherwise slip through undetected, since the percentage alone
 * could still match. If proof is present on only one side, or neither, there's
 * nothing to compare it against, so it's not required to match (same treatment as any
 * other value the application doesn't state).
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
  const percentMatches = applicationPercent === labelPercent;

  // Only enforced when both sides actually state a proof number — see the doc
  // comment above for why an absent proof on either side isn't itself a failure.
  const applicationProof = parseProof(applicationValue);
  const labelProof = parseProof(extractedValue);
  const proofMatches =
    applicationProof === null || labelProof === null ? true : applicationProof === labelProof;

  return {
    field: fieldName,
    applicationValue,
    extractedValue,
    status: percentMatches && proofMatches ? "matched" : "mismatched",
  };
}
