// Batch/row state read/write against Vercel KV, every write carrying a ~48h TTL (this
// store is explicitly ephemeral, not a system of record: single-verify stays fully
// stateless, and this is the one deliberately-scoped exception to an otherwise
// no-durable-persistence rule — anonymous, cookie-scoped, and TTL'd, not a database).
//
// Owns two kinds of records:
//   - BatchRecord    — one per batch: who owns it, how many rows it has, and (via the
//                       lock fields below) which browser tab currently holds the
//                       single-active-tab lock. Read/written as one whole JSON object,
//                       not field-by-field — @vercel/kv has no partial-update
//                       primitive for JSON values, and a batch record is small enough
//                       that round-tripping the whole thing is cheap either way.
//   - BatchRowState  — one per label within a batch: its parsed application data,
//                       where its uploaded image lives in Blob, and its processing
//                       status/result.
//
// Key-naming/namespacing logic below is exported and pure (no KV client call involved)
// so it's directly unit-testable. The read/write functions that actually call
// @vercel/kv are not covered by this phase's Vitest suite — this project's established
// testing-scope convention is that pure logic gets automated tests and direct external
// API calls don't (the same reasoning that left geminiExtractor.ts's live Gemini calls
// untested); those get exercised for real once Phase 7's batch routes call them.

import { kv } from "@vercel/kv";
import type { ApplicationData, VerificationResult } from "../types";

/**
 * How long every KV write in this store lives before Vercel KV expires it
 * automatically, in seconds (~48h, matching cookie.ts's BATCH_OWNER_COOKIE_MAX_AGE_SECONDS).
 * This is the concrete mechanism behind this store's "ephemeral, TTL'd" design: every
 * kv.set call in this file passes this as its expiry, so there is deliberately no
 * durable/indefinite persistence path anywhere in this module.
 */
export const BATCH_TTL_SECONDS = 60 * 60 * 48;

/** A single label's processing state within a batch. */
export type BatchRowStatus = "pending" | "in_flight" | "done";

/**
 * One label within a batch, as tracked in KV: its parsed application data (the same
 * shape a single-verify request would carry), where its already-uploaded image lives in
 * Blob (`blobRef`, written once during batch registration and never re-uploaded), its
 * current processing status, and — once `status` is "done" — its verification result.
 * `status` is what `/api/batch/[id]/process` (Phase 7) reads to decide which rows still
 * need work, and what a browser resuming after a refresh/crash uses to avoid
 * re-verifying rows that already finished. `id` is the manifest's own free-form row
 * identifier (bookkeeping, not a label field — never part of `applicationData`),
 * carried through so the results CSV export (Phase 9) can report it back as-is,
 * matching the manifest the batch was registered from; a manifest with no `id` column
 * carries an empty string here rather than this field being optional.
 */
export type BatchRowState = {
  id: string;
  fileName: string;
  applicationData: ApplicationData;
  blobRef: string;
  status: BatchRowStatus;
  result?: VerificationResult;
};

/**
 * One batch, as tracked in KV. `lockedByTabId`/`lockHeartbeatAt` implement the
 * single-active-tab enforcement that batch processing needs (see batchLock.ts). These
 * two fields aren't a separate KV record
 * of their own — a batch has exactly one lock state at a time, so it's cheaper to carry
 * it alongside the rest of the batch's own record than as a second round trip.
 * `batchLock.ts` owns the actual claim/heartbeat *decision* logic; this file only reads
 * and writes the record that decision acts on.
 */
export type BatchRecord = {
  batchId: string;
  ownerCookie: string;
  createdAt: string;
  totalCount: number;
  lockedByTabId?: string;
  /** ISO timestamp of the current lock holder's most recent heartbeat renewal. */
  lockHeartbeatAt?: string;
};

/** KV key for a batch's own record. */
export function batchRecordKey(batchId: string): string {
  return `batch:${batchId}`;
}

/**
 * KV key for one row's state within a batch. `fileName` is URI-encoded before being
 * embedded in the key so a filename containing a character this key format treats
 * specially (its own `:` separators) can't accidentally collide with the key's
 * structure or another row's key.
 */
export function batchRowKey(batchId: string, fileName: string): string {
  return `batch:${batchId}:row:${encodeURIComponent(fileName)}`;
}

/**
 * KV key mapping an owner cookie to whichever batch it most recently registered — how
 * `GET /api/batch/current` (Phase 7) finds "the" batch to offer resuming, without the
 * browser needing to remember its own batch id across a crash/refresh (it only carries
 * the cookie, per cookie.ts).
 */
export function ownerCurrentBatchKey(ownerCookie: string): string {
  return `owner:${ownerCookie}:currentBatch`;
}

/**
 * Writes a batch's record and indexes it by owner cookie, both with the ~48h TTL. Used
 * once at batch registration time, and again every time the lock fields change (see
 * batchLock.ts's claimBatchLock/releaseBatchLock) — always a full-object overwrite,
 * never a partial field update.
 */
export async function writeBatchRecord(record: BatchRecord): Promise<void> {
  await kv.set(batchRecordKey(record.batchId), record, { ex: BATCH_TTL_SECONDS });
  await kv.set(ownerCurrentBatchKey(record.ownerCookie), record.batchId, { ex: BATCH_TTL_SECONDS });
}

/** Reads a batch's record, or null if it doesn't exist (never registered, or expired). */
export async function readBatchRecord(batchId: string): Promise<BatchRecord | null> {
  const record = await kv.get<BatchRecord>(batchRecordKey(batchId));
  return record ?? null;
}

/**
 * Reads whatever batch id an owner cookie was last associated with, for the
 * resume-prompt flow — null if this browser has never registered a batch, or its last
 * batch has since expired past the ~48h TTL.
 */
export async function readCurrentBatchIdForOwner(ownerCookie: string): Promise<string | null> {
  const batchId = await kv.get<string>(ownerCurrentBatchKey(ownerCookie));
  return batchId ?? null;
}

/** Writes one row's state, with the same ~48h TTL as its parent batch record. */
export async function writeBatchRowState(batchId: string, row: BatchRowState): Promise<void> {
  await kv.set(batchRowKey(batchId, row.fileName), row, { ex: BATCH_TTL_SECONDS });
}

/** Reads one row's state by filename, or null if it doesn't exist. */
export async function readBatchRowState(batchId: string, fileName: string): Promise<BatchRowState | null> {
  const row = await kv.get<BatchRowState>(batchRowKey(batchId, fileName));
  return row ?? null;
}

/**
 * Reads every row's state for a batch in one round trip, given the full list of
 * filenames the batch was registered with. KV has no "list keys matching a prefix"
 * primitive on the tier this app uses, so the caller — which already knows every
 * fileName from the batch's own registration — supplies them explicitly rather than
 * this function trying to discover them itself. A row that's somehow missing (expired
 * past the TTL, or never written) is silently omitted from the result rather than
 * raised as an error; callers treat a missing row the same as "not yet processed."
 */
export async function readAllBatchRowStates(batchId: string, fileNames: string[]): Promise<BatchRowState[]> {
  if (fileNames.length === 0) {
    return [];
  }
  const keys = fileNames.map((fileName) => batchRowKey(batchId, fileName));
  const rows = await kv.mget<(BatchRowState | null)[]>(...keys);
  return rows.filter((row): row is BatchRowState => row !== null);
}
