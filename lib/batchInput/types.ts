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
 * about which name a downstream consumer should trust.
 */
export type BatchEntry = {
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
