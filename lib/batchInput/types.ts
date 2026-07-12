// BatchInputParser interface, BatchEntry, PairingError types — the contract between
// the batch upload UI (BatchUploadPanel.tsx, Phase 8) and whatever manifest format
// actually gets parsed. csvManifestParser.ts is the only implementation built for this
// take-home, but nothing downstream of BatchEntry[]/PairingError[] (the preflight
// pairing summary, the batch registration API route, verify()) depends on CSV
// specifically — a different manifest format could implement this same interface later
// without touching any of that.

import type { ApplicationData } from "../types";

/**
 * One label ready to be verified: the uploaded image file paired with its parsed
 * application data. `fileName` is carried alongside `image` (rather than the caller
 * re-deriving it from `image.name` every time) because it's the value that was
 * actually used to perform the pairing — keeping it explicit here avoids any question
 * about which name a downstream consumer should trust. `id` is the manifest's own
 * free-form row identifier (e.g. a COLA application number) — bookkeeping, not a label
 * field to check, so it never appears inside `applicationData` — but it's carried here
 * so downstream consumers (batch registration, the results CSV export) can still
 * report it back alongside each row's outcome. A manifest with no `id` column, or a
 * blank cell in that column for this row, carries an empty string here rather than
 * being treated as an error — `id` isn't a mandatory manifest column the way
 * `fileName` is.
 */
export type BatchEntry = {
  id: string;
  fileName: string;
  image: File;
  applicationData: ApplicationData;
};

/**
 * A manifest row or an uploaded image that couldn't be paired with its counterpart.
 * Surfaced during preflight validation (before anything is uploaded/sent to the
 * server), not discovered mid-batch:
 * - "no_matching_image": a manifest row named a `fileName`, but none of the uploaded
 *   images has that exact name.
 * - "no_matching_row": an uploaded image's filename doesn't appear in any manifest
 *   row's `fileName` column.
 */
export type PairingError = {
  fileName: string;
  reason: "no_matching_image" | "no_matching_row";
};

/**
 * Swappable batch-manifest parser: turns raw manifest text (CSV today; potentially a
 * different format later, without changing this interface) plus the raw list of
 * uploaded image files into paired `entries` (ready to verify) and `errors` (surfaced
 * to the user during preflight). Deliberately synchronous and side-effect-free —
 * parsing and pairing is pure logic with no I/O, so an implementation can run
 * client-side during preflight with no extra round-trip to the server, and is directly
 * unit-testable without mocking anything.
 */
export type BatchInputParser = {
  parse(csvText: string, imageFiles: File[]): { entries: BatchEntry[]; errors: PairingError[] };
};

/** Falls back to when NEXT_PUBLIC_MAX_BATCH_SIZE isn't set, or isn't a usable number. */
const DEFAULT_MAX_BATCH_SIZE = 500;

/**
 * The maximum number of matched rows a single batch may contain, read from its
 * environment variable and defaulting to 500 rather than throwing when it's unset —
 * the same deliberate exception to "a missing operational setting should throw, not
 * silently default" that `resolveBatchProcessConcurrency()`
 * (`app/api/batch/[id]/process/route.ts`) already makes, for the same reason: there's
 * no database-backed settings store in this design to seed a default into. 500 isn't
 * arbitrary either — it's comfortably above the "200, 300 label applications" scenario
 * a stakeholder actually described as the real-world worst case, so a normal batch is
 * never blocked, while a batch that's orders of magnitude larger (e.g. a CSV uploaded
 * by mistake) is rejected with a clear reason instead of silently grinding for hours at
 * the current concurrency cap.
 *
 * `NEXT_PUBLIC_`-prefixed (unlike `BATCH_PROCESS_CONCURRENCY`) so the exact same limit
 * is readable both server-side (`POST /api/batch`, the actual enforcement boundary —
 * see Golden Principle "validate at system boundaries") and client-side
 * (`BatchUploadPanel.tsx`'s preflight check, which exists purely so a user sees the
 * rejection *before* uploading anything, not as the real security boundary). Both call
 * sites import this same function rather than each hardcoding the number, so the two
 * checks can never drift apart.
 */
export function resolveMaxBatchSize(): number {
  const raw = process.env.NEXT_PUBLIC_MAX_BATCH_SIZE;
  if (!raw) {
    return DEFAULT_MAX_BATCH_SIZE;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_BATCH_SIZE;
  }
  return Math.floor(parsed);
}
