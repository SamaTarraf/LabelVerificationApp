// Dispatches by field name: alcoholContent/netContents/warningText go through their
// algorithmic matcher above; every other field (known-fuzzy or unrecognized) passes
// through *unchanged* — its status and explanation already came back from the
// extraction call, nothing left to compute.
//
// This is the single place that decides "which fields are algorithmic" — the three
// names below are the only ones ever routed to code-owned matching logic. Every other
// field name, whether it's a recognized fuzzy field like brandName or something the
// application manifest introduced that this app has never seen before, is treated
// identically: the model already made the call during extraction, so this dispatcher
// just carries that result forward into the shared FieldResult shape.

import type { FieldResult } from "../types";
import type { ExtractedField, ExtractedFuzzyField, ExtractedWarningField } from "../extraction/types";
import { matchGovernmentWarning } from "./exactMatch";
import { matchAlcoholContent } from "./numericMatch";
import { matchNetContents } from "./unitMatch";

const ALCOHOL_CONTENT_FIELD = "alcoholContent";
const NET_CONTENTS_FIELD = "netContents";
const WARNING_FIELD = "warningText";

/**
 * Routes one application field + its extraction result to the correct matching
 * behavior and returns a fully assembled FieldResult:
 * - `alcoholContent` / `netContents` / `warningText` go through their dedicated
 *   algorithmic matcher, which decides the status itself.
 * - Every other field name — an open set, never hardcoded to a fixed list — passes
 *   through unchanged: `extracted` is trusted to already carry a `status` and
 *   `explanation` from the model's own judgment made during extraction, since that
 *   judgment IS the decision for this category, not something this dispatcher
 *   re-derives.
 */
export function matchField(fieldName: string, applicationValue: string, extracted: ExtractedField): FieldResult {
  if (fieldName === ALCOHOL_CONTENT_FIELD) {
    return matchAlcoholContent(fieldName, applicationValue, extracted);
  }

  if (fieldName === NET_CONTENTS_FIELD) {
    return matchNetContents(fieldName, applicationValue, extracted);
  }

  if (fieldName === WARNING_FIELD) {
    // Safe to assume the warning shape here: geminiExtractor.ts always returns the
    // bold-signal shape for exactly this field name, by the same field-name-based
    // dispatch convention used on the extraction side.
    return matchGovernmentWarning(fieldName, applicationValue, extracted as ExtractedWarningField);
  }

  // Unrecognized/fuzzy field: the extractor already decided status + explanation for
  // this one during the extraction call itself (see ExtractedFuzzyField) — nothing
  // left for this dispatcher to compute, just reshape it into a FieldResult.
  const fuzzyField = extracted as ExtractedFuzzyField;
  return {
    field: fieldName,
    applicationValue,
    extractedValue: fuzzyField.foundText,
    status: fuzzyField.status,
    explanation: fuzzyField.explanation,
  };
}
