// ResultsTable — renders one VerificationResult end to end: an overall status badge,
// the elapsed verification time, and one expandable row per checked field showing the
// application's value against what was found on the label, plus the model's
// explanation whenever one is present (fuzzy-field judgments, Alcohol Content/Net
// Contents judgments, and the Government Warning's fixed bold-uncertainty message all
// carry an explanation as of the 2026-07-10 matching revision) — so an agent sees not
// just pass/fail but why.

import type { FieldResult, MatchStatus, VerificationResult } from "@/lib/types";
import { KNOWN_FIELDS } from "./UploadForm";
import styles from "./ResultsTable.module.css";

export type ResultsTableProps = {
  result: VerificationResult;
  /** Wall-clock seconds the verification round trip took, measured client-side by
   * UploadForm around the fetch() call — shown so verification speed is visible to the
   * agent rather than assumed, directly countering the prior vendor pilot's failure
   * mode (30-40s/label going unnoticed until agents gave up on the tool). */
  elapsedSeconds: number;
};

/** Human-readable label for each MatchStatus value, shared by the overall-result badge
 * and every per-field badge below. */
const STATUS_LABELS: Record<MatchStatus, string> = {
  matched: "Matched",
  mismatched: "Mismatched",
  needs_review: "Needs Review",
};

/**
 * Turns a field's machine key into a human-readable label. Known fields (the ones
 * UploadForm.tsx collects) reuse UploadForm's own label text, so a field reads
 * identically in the input form and in these results. Any other field name — the
 * open/unrecognized category ApplicationData allows, e.g. a CSV column this form
 * doesn't have a dedicated input for — falls back to splitting camelCase into spaced,
 * capitalized words, so it is never rendered as a bare, un-humanized machine key.
 */
function humanizeFieldName(field: string): string {
  const knownField = KNOWN_FIELDS.find((candidate) => candidate.key === field);
  if (knownField) {
    return knownField.label;
  }
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Small colored pill for a MatchStatus value, reused for both the overall result and
 * each individual field row. */
function StatusBadge({ status }: { status: MatchStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{STATUS_LABELS[status]}</span>;
}

/**
 * One expandable row for a single field's comparison. Built on the native
 * <details>/<summary> element rather than a hand-rolled expand/collapse toggle, so
 * keyboard operation (Tab to focus, Enter/Space to toggle) and the correct ARIA
 * semantics for a disclosure widget come for free instead of being reimplemented.
 */
function FieldRow({ field }: { field: FieldResult }) {
  return (
    <li className={styles.fieldRow}>
      <details>
        <summary className={styles.fieldSummary}>
          <StatusBadge status={field.status} />
          <span className={styles.fieldName}>{humanizeFieldName(field.field)}</span>
        </summary>
        <dl className={styles.fieldDetails}>
          <dt>Application says</dt>
          <dd>{field.applicationValue}</dd>
          <dt>Label says</dt>
          <dd>{field.extractedValue || "(not found on label)"}</dd>
          {field.explanation && (
            <>
              <dt>Explanation</dt>
              <dd>{field.explanation}</dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}

/**
 * ResultsTable — the top-level export: an overall-status summary bar (file name,
 * overall badge, elapsed time), followed by every checked field as its own expandable
 * FieldRow. Rendered by app/page.tsx once UploadForm reports a completed verification.
 */
export default function ResultsTable({ result, elapsedSeconds }: ResultsTableProps) {
  return (
    <section className={styles.results} aria-labelledby="results-heading">
      <div className={styles.summary}>
        <h2 id="results-heading" className={styles.fileName}>
          {result.fileName}
        </h2>
        <StatusBadge status={result.overallStatus} />
        <span className={styles.elapsed}>Verified in {elapsedSeconds.toFixed(1)}s</span>
      </div>
      <ul className={styles.fieldList}>
        {result.fields.map((field) => (
          <FieldRow key={field.field} field={field} />
        ))}
      </ul>
    </section>
  );
}
