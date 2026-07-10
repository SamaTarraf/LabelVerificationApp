// Dispatches by field name: warningText goes through its algorithmic matcher above;
// every other field (known-fuzzy, unrecognized, or — as of the 2026-07-10 architecture
// revision — alcoholContent/netContents too) passes through *unchanged* — its status
// and explanation already came back from the extraction call, nothing left to compute.
//
// This is the single place that decides "which fields are algorithmic" — warningText
// is now the only name ever routed to code-owned matching logic. alcoholContent and
// netContents used to be routed to matchAlcoholContent/matchNetContents here too, but
// ARCHITECTURE.md's "Matching" section moved them into the model-judged category: the
// extraction prompt now carries the exact-equality/no-conversion instructions that
// guarantee used to come from matchAlcoholContent/matchNetContents' code, and
// LabelFields.alcoholContent/netContents now carry status+explanation like any fuzzy
// field (see lib/extraction/types.ts's ExtractedFuzzyField). matchAlcoholContent and
// matchNetContents themselves are NOT deleted — numericMatch.ts and unitMatch.ts stay
// in the codebase, dormant but tested, as the re-enablement path if algorithmic
// precision on these two fields gets added back post-deployment; re-enabling is a
// matter of restoring their dispatch branches below, not rebuilding them.

import type { FieldResult } from "../types";
import type { ExtractedField, ExtractedFuzzyField, ExtractedWarningField } from "../extraction/types";
import { matchGovernmentWarning } from "./exactMatch";

const WARNING_FIELD = "warningText";

/**
 * Routes one application field + its extraction result to the correct matching
 * behavior and returns a fully assembled FieldResult:
 * - `warningText` goes through its dedicated algorithmic matcher, which decides the
 *   status itself.
 * - Every other field name — an open set, never hardcoded to a fixed list, and as of
 *   the 2026-07-10 revision this includes `alcoholContent`/`netContents` alongside the
 *   fuzzy/open category — passes through unchanged: `extracted` is trusted to already
 *   carry a `status` and `explanation` from the model's own judgment made during
 *   extraction, since that judgment IS the decision for this category, not something
 *   this dispatcher re-derives.
 */
export function matchField(fieldName: string, applicationValue: string, extracted: ExtractedField): FieldResult {
  if (fieldName === WARNING_FIELD) {
    // Safe to assume the warning shape here: geminiExtractor.ts always returns the
    // bold-signal shape for exactly this field name, by the same field-name-based
    // dispatch convention used on the extraction side.
    return matchGovernmentWarning(fieldName, applicationValue, extracted as ExtractedWarningField);
  }

  // Fuzzy/open-category field, unrecognized field, or (as of the 2026-07-10 revision)
  // alcoholContent/netContents: the extractor already decided status + explanation for
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
