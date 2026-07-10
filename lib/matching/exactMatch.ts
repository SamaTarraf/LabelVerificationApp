// Government Warning matcher: word-for-word body match (case-insensitive) + hard ALL
// CAPS check on the "GOVERNMENT WARNING:" prefix + best-effort bold check.
//
// Three independent checks feed one result, in order of how "hard" each check is:
// 1. Body wording — case-insensitive, but otherwise exact. No similarity tolerance.
// 2. The "GOVERNMENT WARNING:" prefix must appear on the label in literal ALL CAPS —
//    a hard, case-SENSITIVE check on the label's own formatting (unlike the body).
// 3. Bold styling of that same prefix — a best-effort *visual* signal from the
//    extractor, never a hard pass/fail. An unconfident or negative answer defers to
//    "needs_review", never a silent pass and never an automatic mismatch.
//
// Because body wording and prefix ALL CAPS can both be correct while only the bold
// styling is in question, that specific needs_review case would otherwise have
// applicationValue and extractedValue text that look identical — with nothing to
// explain why the field was flagged. To prevent that, this file owns a fixed,
// hardcoded explanation string for exactly that case (never model-generated).

import type { FieldResult } from "../types";
import type { ExtractedWarningField } from "../extraction/types";

/** The exact, case-sensitive text the label must show for the warning to pass the ALL CAPS check. */
const GOVERNMENT_WARNING_PREFIX = "GOVERNMENT WARNING:";

/**
 * Fixed, code-owned explanation attached when body wording and prefix casing both
 * check out but bold styling could not be confidently confirmed. Deliberately not
 * model-generated — this file, not the extraction call, decides what this message
 * says, so it stays exactly the same string every time this case fires.
 */
export const BOLD_UNCERTAIN_EXPLANATION =
  'Bold styling of the "GOVERNMENT WARNING:" prefix could not be confidently confirmed on the label image.';

/** Collapses repeated whitespace and trims the ends, so comparison isn't thrown off by incidental spacing differences. */
function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Locates the "GOVERNMENT WARNING:" prefix within a block of text, case-insensitively
 * (this function only finds *where* it is — whether it's actually in ALL CAPS is
 * checked separately, since that check must stay case-sensitive). Returns the prefix
 * exactly as it appeared in the original text (preserving its real casing, needed for
 * the ALL CAPS check) plus everything after it as the "body". Returns null if the
 * prefix isn't present at all.
 */
function splitPrefixAndBody(text: string): { prefix: string; body: string } | null {
  const normalized = normalizeWhitespace(text);
  const prefixIndex = normalized.toUpperCase().indexOf(GOVERNMENT_WARNING_PREFIX.toUpperCase());
  if (prefixIndex === -1) {
    return null;
  }
  const prefix = normalized.slice(prefixIndex, prefixIndex + GOVERNMENT_WARNING_PREFIX.length);
  const body = normalized.slice(prefixIndex + GOVERNMENT_WARNING_PREFIX.length).trim();
  return { prefix, body };
}

/**
 * Matches the Government Warning field: fully algorithmic, no model judgment involved
 * in deciding the status. `applicationValue` is the application's expected warning
 * text (assumed to already be the correct standard wording); `extracted` is what the
 * extractor transcribed off the label image plus its bold-confidence signal.
 */
export function matchGovernmentWarning(
  fieldName: string,
  applicationValue: string,
  extracted: ExtractedWarningField
): FieldResult {
  const extractedValue = extracted.foundText;
  const applicationSplit = splitPrefixAndBody(applicationValue);
  const labelSplit = splitPrefixAndBody(extractedValue);

  // If either side doesn't contain the prefix at all, there's nothing meaningful left
  // to compare — an unambiguous mismatch.
  if (!applicationSplit || !labelSplit) {
    return {
      field: fieldName,
      applicationValue,
      extractedValue,
      status: "mismatched",
    };
  }

  // Body wording: case-insensitive, but otherwise exact — no similarity tolerance.
  const bodyMatches = applicationSplit.body.toLowerCase() === labelSplit.body.toLowerCase();

  // The prefix must appear on the LABEL in literal ALL CAPS. This is checked against
  // the label's own transcribed prefix only (never the application's), and is
  // case-sensitive on purpose — unlike the body comparison above.
  const prefixIsAllCaps = labelSplit.prefix === GOVERNMENT_WARNING_PREFIX;

  if (!bodyMatches || !prefixIsAllCaps) {
    return {
      field: fieldName,
      applicationValue,
      extractedValue,
      status: "mismatched",
    };
  }

  // Body and formatting both check out. Bold is a best-effort visual signal, not a
  // hard requirement — only a confident "yes" clears it as fully matched.
  if (extracted.boldConfident && extracted.isWarningBold) {
    return {
      field: fieldName,
      applicationValue,
      extractedValue,
      status: "matched",
    };
  }

  // Bold styling wasn't confidently confirmed, even though the text itself is
  // correct — flag for human review with the fixed explanation, since the text
  // alone (applicationValue vs extractedValue) wouldn't convey why this was flagged.
  return {
    field: fieldName,
    applicationValue,
    extractedValue,
    status: "needs_review",
    explanation: BOLD_UNCERTAIN_EXPLANATION,
  };
}
