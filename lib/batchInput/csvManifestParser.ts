// Default BatchInputParser implementation: CSV manifest text + the raw list of
// uploaded image files -> BatchEntry[] + PairingError[]. Pairing is done by the CSV's
// dedicated `fileName` column, matched exactly against each image File's `.name` —
// never by `id`, which is a free-form label identifier (e.g. a COLA application
// number), not something assumed to be filename-safe or unique-as-a-filename.
//
// Two columns are reserved and never become part of an application's
// `ApplicationData` (i.e. they're never checked against the label): `fileName`
// (used purely for pairing) and `id` (a free-form identifier, not a label field).
// Every other column in the manifest becomes an open ApplicationData field, named
// exactly as its header — this mirrors ApplicationData's own open field set (see
// ../types.ts): the manifest's column set is never hardcoded to a fixed list like
// brandName/classType/etc. `id` is still captured, though — just onto `BatchEntry.id`
// directly rather than inside `applicationData` — so it can be carried forward through
// batch registration and reappear as the first column of a downloaded results CSV,
// matching the manifest it came from.
//
// Parsing and pairing are both pure, synchronous functions — no network, no disk,
// nothing beyond the csvText/imageFiles arguments handed in. This is what lets the
// batch upload UI (Phase 8) run the whole preflight pairing summary client-side,
// before a single byte is uploaded to the server.

import type { ApplicationData } from "../types";
import type { BatchEntry, BatchInputParser, PairingError } from "./types";

/** Manifest columns that are pairing/bookkeeping metadata, never an ApplicationData field to check against the label. */
const FILE_NAME_COLUMN = "fileName";
const ID_COLUMN = "id";

/**
 * Splits raw CSV text into rows of raw (already-unescaped) string fields, honoring
 * RFC4180-style quoting: a field wrapped in double quotes may contain commas and
 * newlines literally, and a doubled quote (`""`) inside a quoted field represents one
 * literal quote character. Written as a single left-to-right character scan (rather
 * than a naive `split(",")`/`split("\n")`) specifically so a comma or newline embedded
 * inside a quoted application value — e.g. a producer name like `"Smith, Jones & Co."`
 * — doesn't get misread as a field or row boundary.
 *
 * `\r\n` and bare `\n` line endings are both accepted (every `\r` is simply dropped),
 * so a manifest edited in Excel on Windows parses the same as one saved with Unix line
 * endings.
 */
function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotedField = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];

    if (insideQuotedField) {
      if (char === '"' && csvText[i + 1] === '"') {
        // A doubled quote inside a quoted field is an escaped literal quote, not the
        // end of the field — consume both characters, emit one `"`.
        currentField += '"';
        i++;
        continue;
      }
      if (char === '"') {
        // A lone quote inside a quoted field ends the quoting (but not necessarily the
        // field itself — text can continue after the closing quote, e.g. `"Old" Tom`).
        insideQuotedField = false;
        continue;
      }
      // Any other character, including a literal comma or newline, is just field text
      // while inside quotes.
      currentField += char;
      continue;
    }

    if (char === '"') {
      insideQuotedField = true;
      continue;
    }
    if (char === ",") {
      currentRow.push(currentField.trim());
      currentField = "";
      continue;
    }
    if (char === "\r") {
      // Ignored outright: a following "\n" (CRLF) handles the row break, and a lone
      // "\r" with no "\n" isn't a line ending this parser needs to support.
      continue;
    }
    if (char === "\n") {
      currentRow.push(currentField.trim());
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }
    currentField += char;
  }

  // Flush whatever was accumulated after the loop ends, covering manifests that don't
  // end with a trailing newline.
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Drop fully blank rows (e.g. a trailing empty line at end of file, or a stray blank
  // line in the middle of the manifest) rather than treating them as a real data row
  // with every field blank.
  return rows.filter((row) => !(row.length === 1 && row[0] === ""));
}

/**
 * One manifest row, reshaped from a raw string[] into a lookup by column name using
 * the header row. Returned as a plain Record rather than ApplicationData directly,
 * since it still includes the reserved `fileName`/`id` columns at this point —
 * `buildApplicationData()` below is what strips those out.
 */
function zipRowWithHeader(header: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  header.forEach((columnName, index) => {
    // A row with fewer cells than the header (a ragged/short CSV line) simply leaves
    // those trailing columns unset, same as if the cell were blank.
    record[columnName] = row[index] ?? "";
  });
  return record;
}

/**
 * Builds this row's ApplicationData from its zipped record, excluding the two
 * reserved columns (`fileName`, `id`) and any column left blank for this particular
 * row. A blank cell is treated as "this application doesn't state a value for this
 * field" (i.e. simply omitted from the object) rather than as an empty string to
 * match literally — consistent with ApplicationData's own contract that a field
 * absent from the application isn't checked on the label at all (see ../types.ts —
 * applications are trusted as the source of truth, not independently validated).
 */
function buildApplicationData(record: Record<string, string>): ApplicationData {
  const applicationData: ApplicationData = {};
  for (const [columnName, value] of Object.entries(record)) {
    if (columnName === FILE_NAME_COLUMN || columnName === ID_COLUMN) {
      continue;
    }
    if (value.trim() === "") {
      continue;
    }
    applicationData[columnName] = value;
  }
  return applicationData;
}

/**
 * Parses a CSV manifest plus the raw list of uploaded image files into paired
 * BatchEntry[] (a manifest row whose `fileName` matched exactly one uploaded image)
 * and PairingError[] (a manifest row with no matching image, or an uploaded image with
 * no matching manifest row) — see PairingError's doc comment in ./types.ts for what
 * each reason means.
 *
 * The manifest's header row is required to contain a `fileName` column — without it
 * there's no basis to pair any row with any image at all, so that's raised as a thrown
 * error (a malformed manifest, not a per-row pairing problem PairingError is meant to
 * describe) rather than silently producing zero entries.
 */
function parse(csvText: string, imageFiles: File[]): { entries: BatchEntry[]; errors: PairingError[] } {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    return { entries: [], errors: [] };
  }

  const [header, ...dataRows] = rows;
  if (!header.includes(FILE_NAME_COLUMN)) {
    throw new Error(
      `CSV manifest is missing its required "${FILE_NAME_COLUMN}" column — cannot pair any row with an uploaded image without it.`
    );
  }

  // Index uploaded images by exact filename for O(1) lookup per row, rather than
  // re-scanning the whole imageFiles array for every manifest row.
  const imagesByFileName = new Map<string, File>();
  for (const image of imageFiles) {
    imagesByFileName.set(image.name, image);
  }

  const entries: BatchEntry[] = [];
  const errors: PairingError[] = [];
  // Tracks which uploaded images actually got paired with a manifest row, so that
  // afterward we can report every *unpaired* image as its own "no_matching_row" error.
  const pairedFileNames = new Set<string>();

  for (const row of dataRows) {
    const record = zipRowWithHeader(header, row);
    const fileName = record[FILE_NAME_COLUMN];
    const image = imagesByFileName.get(fileName);

    if (!image) {
      errors.push({ fileName, reason: "no_matching_image" });
      continue;
    }

    pairedFileNames.add(fileName);
    entries.push({
      // A manifest with no `id` column at all leaves this undefined on `record` (see
      // zipRowWithHeader, which only ever fills in keys the header row actually
      // declares) — default to "" the same "ragged CSV, tolerate it" way a blank cell
      // is already handled elsewhere in this file, since `id` isn't a required column.
      id: record[ID_COLUMN] ?? "",
      fileName,
      image,
      applicationData: buildApplicationData(record),
    });
  }

  // Any uploaded image whose name was never claimed by a manifest row above has no
  // row to pair with — flag it the same way a row with no image is flagged, just with
  // the opposite reason, so the preflight summary can report both directions of
  // mismatch.
  for (const image of imageFiles) {
    if (!pairedFileNames.has(image.name)) {
      errors.push({ fileName: image.name, reason: "no_matching_row" });
    }
  }

  return { entries, errors };
}

/** The default BatchInputParser implementation, backed by the CSV manifest format described above. */
export const csvManifestParser: BatchInputParser = {
  parse,
};
