// Orchestrates: build extraction hints from ApplicationData → call extractor →
// algorithmic-match the three strict fields → pass through the model's judgment for
// everything else → assemble FieldResult[] + rollup status.
//
// This is the single entry point single-verify (and, later, each batch row) calls to
// go from "one image + one application record" to a complete VerificationResult. The
// extractor is accepted as a parameter (defaulting to the real Gemini adapter) rather
// than imported and called directly, so this orchestrator stays swappable and — just
// as importantly — testable: matching-logic tests can hand it a stub extractor
// instead of making a real network call, while still exercising the real matching
// code below unmocked.

import type { ApplicationData, FieldResult, MatchStatus, VerificationResult } from "../types";
import type { LabelExtractor, LabelFields, LabelImage } from "../extraction/types";
import { geminiExtractor } from "../extraction/geminiExtractor";
import { matchField } from "./fieldMatchers";

/**
 * Rolls a list of per-field results up into one overall status, in fixed precedence
 * order: any single `mismatched` field makes the whole result `mismatched` — even if
 * every other field is fine, and even if some other field also happens to be
 * `needs_review`. Only if nothing mismatched does a `needs_review` field pull the
 * overall status to `needs_review`. Only if every field matched cleanly does the
 * result come out `matched`. This ordering matters: a strict-field mismatch (e.g.
 * wrong ABV) must never be softened down to `needs_review` just because something
 * else on the label is merely ambiguous.
 */
function rollupStatus(fields: FieldResult[]): MatchStatus {
  if (fields.some((field) => field.status === "mismatched")) {
    return "mismatched";
  }
  if (fields.some((field) => field.status === "needs_review")) {
    return "needs_review";
  }
  return "matched";
}

/**
 * Builds the final FieldResult list from the application's expected values and the
 * extractor's per-field results, then rolls it up into a VerificationResult. Kept
 * separate from `verify()` below (which handles the actual `extract()` call) so the
 * matching/rollup logic itself is a plain synchronous function — nothing here needs
 * network access or mocking to test.
 */
export function assembleVerificationResult(
  fileName: string,
  applicationData: ApplicationData,
  labelFields: LabelFields
): VerificationResult {
  const fields: FieldResult[] = Object.entries(applicationData)
    // ApplicationData's index signature allows undefined values for fields absent
    // from this particular application — skip those, there's nothing to check.
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([fieldName, applicationValue]) => {
      const extracted = labelFields[fieldName];
      if (!extracted) {
        // The application asked for this field but the extractor didn't return
        // anything for it at all — treat conservatively as needing a human look
        // rather than silently dropping the field from the result.
        return {
          field: fieldName,
          applicationValue,
          extractedValue: "",
          status: "needs_review" as MatchStatus,
          explanation: "The extractor did not return a result for this field.",
        };
      }
      return matchField(fieldName, applicationValue, extracted);
    });

  return {
    fileName,
    fields,
    overallStatus: rollupStatus(fields),
  };
}

/**
 * Verifies one label image against its application data end-to-end: calls the
 * extractor (value-guided, using `applicationData` itself as the hints — its keys are
 * the field names, its values the expected values), then matches and rolls up the
 * result. `extractor` defaults to the real Gemini adapter but can be swapped for any
 * other `LabelExtractor` implementation, including a stub in tests.
 */
export async function verify(
  fileName: string,
  image: LabelImage,
  applicationData: ApplicationData,
  extractor: LabelExtractor = geminiExtractor
): Promise<VerificationResult> {
  const labelFields = await extractor.extract(image, applicationData);
  return assembleVerificationResult(fileName, applicationData, labelFields);
}
