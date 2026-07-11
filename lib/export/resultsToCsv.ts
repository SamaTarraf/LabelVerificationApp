// Serializes a batch's finished rows into a downloadable results CSV. Entirely
// client-side, pure, and synchronous — no network, no file I/O — the same convention
// csvManifestParser.ts already follows for the input side of this same round trip
// (manifest text in, structured data out; here it's the reverse: structured results
// in, manifest-shaped text out).
//
// The output is deliberately shaped as "the same manifest the batch was registered
// from, with two columns added" rather than a wide, reshaped report: every row keeps
// its original `id`/`fileName` and every application field it was checked against
// (the application's own stated value for that field, not what the label actually
// said — the whole point of this tool is comparing the two, and the input columns are
// what a compliance agent already recognizes from the manifest they uploaded), plus a
// `status` rollup column and a `flaggedFields` column listing only what needs a second
// look. This is how a batch's results survive past this app's own ~48h ephemeral
// storage window: not by the tool keeping a durable record, but by handing the agent
// a CSV file they control.

import type { BatchRowState } from "../persistence/kvStore";
import type { FieldResult, VerificationResult } from "../types";

/**
 * A batch row that has actually finished processing — `status` narrowed to "done" and
 * `result` narrowed from optional to required, so the code below never needs an `if
 * (row.result)` guard after the initial filter has already established it's present.
 */
type FinishedBatchRow = BatchRowState & { status: "done"; result: VerificationResult };

/**
 * Escapes one CSV cell per the same RFC4180 quoting rule this app's other CSV-writing
 * code already follows (csvManifestParser.ts's tokenizer on the read side, and
 * BatchUploadPanel.tsx's own template-generating csvEscape on another write side):
 * wrap the value in double quotes, and double any literal quote character inside it,
 * whenever the value contains a comma, a quote, or a newline that would otherwise be
 * misread as a field or row boundary by any standard CSV reader (Excel, Sheets,
 * csvManifestParser.ts itself). Kept as its own small local copy here — rather than
 * importing a UI component's helper into this lib module, or introducing a shared
 * utility file for one three-line function — the same way this project already
 * tolerates a couple of small, independently-tested near-duplicates over adding a
 * cross-cutting dependency for something this tiny.
 */
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Narrows a batch's full row list down to only the rows worth exporting: those whose
 * `status` is "done" and therefore actually carry a `result` to report. A row that
 * never finished (still "pending" or "in_flight" — e.g. the batch was interrupted, or
 * this export is downloaded mid-run) has nothing meaningful to say about a match/
 * mismatch yet, so it's simply left out of the export rather than either crashing on
 * a missing `result` or printing a row of blanks that would misleadingly look like a
 * checked-and-clean result. A user downloading mid-batch gets a file covering exactly
 * what's been verified so far — not the whole manifest with holes in it.
 */
function selectFinishedRows(rows: BatchRowState[]): FinishedBatchRow[] {
  return rows.filter((row): row is FinishedBatchRow => row.status === "done" && row.result !== undefined);
}

/**
 * Builds the ordered list of application field-name columns to include, by scanning
 * every finished row's own `result.fields` and recording each field name the first
 * time it's seen. Deliberately not a hardcoded column list (no fixed
 * brandName/alcoholContent/... enumeration) — `ApplicationData` is an open field set
 * throughout this app, so two different manifests (or even two rows of the same
 * manifest, in principle) can each check a different set of fields, and every one of
 * them needs its own column in the export. A `Set` is used only to test membership in
 * O(1) per field; the actual column order is the plain array being built alongside it,
 * so the result is deterministic (first-seen order) rather than whatever arbitrary
 * order a `Set`'s own iteration might otherwise imply to a reader of this code.
 */
function collectFieldColumns(rows: FinishedBatchRow[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of row.result.fields) {
      if (!seen.has(field.field)) {
        seen.add(field.field);
        columns.push(field.field);
      }
    }
  }
  return columns;
}

/**
 * Describes one flagged field for the `flaggedFields` column, in one of two shapes:
 *
 * - `fieldName (<explanation>)` when the field carries an `explanation` — a fuzzy/
 *   model-judged field's own stated reasoning for why it was flagged, or the
 *   Government Warning's fixed, code-owned bold-uncertainty message. In both cases the
 *   extracted text alone wouldn't tell the agent *why* the field was flagged (for a
 *   fuzzy field, `applicationValue`/`extractedValue` can differ in ways that need the
 *   model's reasoning to make sense of; for the Government Warning's bold-uncertain
 *   case they can be textually identical, since only the *styling* is in question).
 * - `fieldName (label says <extractedValue>)` otherwise — a strict-field mismatch with
 *   no explanation attached, where simply showing what the label actually said is
 *   already self-explanatory (e.g. an ABV that doesn't match the application's stated
 *   value).
 *
 * Whether a field carries an explanation is the entire branching condition — there is
 * no separate list of "which fields use which shape" to keep in sync, since
 * `explanation`'s presence already means exactly "the extracted text alone doesn't
 * convey the flag reason."
 */
function describeFlaggedField(field: FieldResult): string {
  if (field.explanation) {
    return `${field.field} (${field.explanation})`;
  }
  return `${field.field} (label says ${field.extractedValue})`;
}

/**
 * Builds the `flaggedFields` cell for one row: blank when the row's rollup status is
 * "matched" (nothing to flag — every field that matched cleanly is already visible in
 * its own application-value column, so it isn't repeated here), otherwise every
 * non-"matched" field's description (see `describeFlaggedField` above), joined with
 * `"; "` rather than a comma — a comma is already meaningful inside plenty of
 * individual application values (`"Smith, Jones & Co."`, `"750 mL, 1 L"`-style
 * multi-unit text) and inside `csvEscape`'s own quoting trigger, so reusing it here as
 * a second, different delimiter inside the same cell would make the cell harder to
 * read once it's unquoted, not easier.
 */
function buildFlaggedFields(result: VerificationResult): string {
  if (result.overallStatus === "matched") {
    return "";
  }
  return result.fields
    .filter((field) => field.status !== "matched")
    .map(describeFlaggedField)
    .join("; ");
}

/**
 * Builds one finished row's full CSV cell list, in the same column order as the
 * header row `resultsToCsv` builds alongside this: `id`, `fileName`, one cell per
 * `fieldColumns` entry (that field's *application* value — what the manifest itself
 * stated, not what the label was found to say, since the label's value only shows up
 * inside `flaggedFields` when it disagrees), `status`, then `flaggedFields`. A field
 * column this particular row never checked (e.g. a manifest where different rows
 * populate different optional columns) is left blank, not omitted — every data row
 * must have exactly as many cells as the header for the file to parse correctly in
 * any standard CSV reader.
 */
function buildRowCells(row: FinishedBatchRow, fieldColumns: string[]): string[] {
  const fieldsByName = new Map(row.result.fields.map((field) => [field.field, field]));
  const applicationValueCells = fieldColumns.map((column) => fieldsByName.get(column)?.applicationValue ?? "");

  return [row.id, row.fileName, ...applicationValueCells, row.result.overallStatus, buildFlaggedFields(row.result)];
}

/**
 * Serializes a batch's rows into the full results CSV text, ready to hand straight to
 * a `Blob`-download call. Column layout: `id`, `fileName`, every distinct application
 * field name observed across the batch's finished rows (see `collectFieldColumns`),
 * `status`, `flaggedFields`. Only rows whose `status` is "done" contribute a data row
 * (see `selectFinishedRows`) — an unfinished row is silently left out rather than
 * causing this function to throw, since downloading mid-batch is an expected, normal
 * use of this export, not an error condition.
 *
 * Lines are joined with `\r\n` (not a bare `\n`) and the file ends with a trailing
 * line break, matching the same convention `BatchUploadPanel.tsx`'s own downloadable
 * CSV template already uses — this keeps every CSV file this app ever hands a user
 * consistent, and `\r\n` is the line ending Excel expects when opening a CSV directly
 * without an import wizard.
 */
export function resultsToCsv(rows: BatchRowState[]): string {
  const finishedRows = selectFinishedRows(rows);
  const fieldColumns = collectFieldColumns(finishedRows);

  const header = ["id", "fileName", ...fieldColumns, "status", "flaggedFields"];
  const dataRows = finishedRows.map((row) => buildRowCells(row, fieldColumns));

  return [header, ...dataRows].map((cells) => cells.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
