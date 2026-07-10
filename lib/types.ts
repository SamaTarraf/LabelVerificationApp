// Shared domain types for the label verification app.
// See ARCHITECTURE.md "Data Model" for the authoritative shape and rationale; this file
// is Phase 1 of PLAN_00_LABEL_VERIFICATION_APP.md and covers ApplicationData,
// FieldResult, and VerificationResult only (BatchEntry/PairingError live in
// lib/batchInput/types.ts, Phase 5; batch persistence types live in
// lib/persistence, Phase 6).

/** Rollup/field-level match outcome, shared by FieldResult and VerificationResult. */
export type MatchStatus = "matched" | "mismatched" | "needs_review";

/**
 * The application's expected field values for a single label, as parsed from the
 * label application (CSV row or single-verify JSON body). Not a fixed/closed set —
 * alcoholContent, netContents, and warningText are called out because they get
 * algorithmic matchers (numeric, unit-aware, strict-exact respectively); every other
 * field (brand name, class/type, producer, country of origin, or anything else present
 * in the application) is still checked, via the model's own judgment returned during
 * extraction — see ARCHITECTURE.md "Matching".
 */
export type ApplicationData = {
  alcoholContent?: string;
  netContents?: string;
  warningText?: string;
  [field: string]: string | undefined;
};

/**
 * The comparison result for a single field, algorithmic or model-judged.
 *
 * `explanation` is populated when the status did not come from a bare algorithmic
 * comparison:
 * - for fuzzy/open-category fields (brand name, class/type, producer, country of
 *   origin, or any unrecognized field), it carries the model's own stated reasoning
 * - for the Government Warning specifically, when the bold-confidence check alone is
 *   what produced `needs_review`, it carries a fixed, code-owned string (not model-
 *   generated) — applicationValue/extractedValue text can be identical in that case
 *   (the wording matches; only the styling is in question), so explanation is the only
 *   place the reason for the flag is recorded. See ARCHITECTURE.md "Matching" ->
 *   Government Warning, and "Needs Review is a flag, not a workflow".
 */
export type FieldResult = {
  field: string;
  applicationValue: string;
  extractedValue: string;
  status: MatchStatus;
  explanation?: string;
};

/**
 * The per-label verification outcome: every field checked plus a rollup status.
 * Rollup precedence (see ARCHITECTURE.md "Data Model"): any field `mismatched` ->
 * `mismatched`; else any field `needs_review` -> `needs_review`; else `matched`.
 */
export type VerificationResult = {
  fileName: string;
  fields: FieldResult[];
  overallStatus: MatchStatus;
};
