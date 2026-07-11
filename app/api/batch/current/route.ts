// GET /api/batch/current — reads the anonymous batch-owner cookie and reports whatever
// batch that browser most recently registered, if it's still resumable (found in KV,
// not yet past its ~48h TTL). This is the one call a freshly-loaded page makes to
// answer "does this browser already have a batch in progress?" before showing either a
// resume prompt or a plain new-batch upload form.
//
// Response body (JSON), always 200 — "no resumable batch" is a normal, expected
// outcome, not an error condition:
//   { batch: null } — this browser has never registered a batch, or its last one has
//     already fully expired past the ~48h TTL.
//   { batch: { batchId, totalCount, doneCount, pendingCount, isComplete, rows } } — an
//     existing batch. `rows` is every row's current state: a "done" row already carries
//     its full VerificationResult (so a resuming browser can show it immediately,
//     without re-verifying anything already finished), while a "pending"/"in_flight" row
//     carries enough (its applicationData and the Blob URL its image already lives at)
//     for a resuming browser to keep calling /api/batch/[id]/process without needing to
//     re-parse the original CSV or re-upload any image.

import { NextRequest, NextResponse } from "next/server";
import { readOrIssueOwnerId } from "@/lib/persistence/cookie";
import type { BatchRecord, BatchRowState } from "@/lib/persistence/kvStore";
import { readAllBatchRowStates, readBatchRecord, readCurrentBatchIdForOwner } from "@/lib/persistence/kvStore";

/**
 * The row-carrying extension of BatchRecord every batch route needs to enumerate a
 * batch's rows from a single lookup — see the registration route (POST /api/batch) for
 * why this is declared locally, in each file that needs it, rather than widening
 * BatchRecord's own type.
 */
type BatchRecordWithRowFileNames = BatchRecord & { rowFileNames: string[] };

/** The shape reported for a resumable batch — everything a resume prompt needs to show. */
type CurrentBatchSummary = {
  batchId: string;
  totalCount: number;
  doneCount: number;
  pendingCount: number;
  isComplete: boolean;
  rows: BatchRowState[];
};

/**
 * Builds the resumable-batch summary from a batch's record and its full row list. Pure
 * and synchronous (no KV/network access), so it's directly unit-testable on its own —
 * the only genuinely pure piece of this route's otherwise KV-heavy logic, mirroring the
 * same split the sibling /process route makes for its own progress-summarizing logic.
 */
export function buildCurrentBatchSummary(record: BatchRecordWithRowFileNames, rows: BatchRowState[]): CurrentBatchSummary {
  const doneCount = rows.filter((row) => row.status === "done").length;
  return {
    batchId: record.batchId,
    totalCount: record.totalCount,
    doneCount,
    pendingCount: record.totalCount - doneCount,
    isComplete: doneCount === record.totalCount,
    rows,
  };
}

/**
 * Handles GET /api/batch/current. Steps:
 *   1. Read the owner id from the request's Cookie header, *without* issuing (or
 *      setting) a fresh one if it's missing — a brand-new id can't possibly have a
 *      batch registered under it yet, so there's nothing to look up, and no reason to
 *      hand a cookie back to a browser that hasn't actually started anything (that only
 *      happens once real batch registration, POST /api/batch, actually needs one).
 *   2. Look up whichever batchId this owner id last registered, and read that batch's
 *      own record — either lookup coming back empty means "nothing to resume," reported
 *      the same way whether the browser is brand new or its last batch's TTL already
 *      expired.
 *   3. Read every row's current state and shape the resumable-batch summary.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { ownerId, isNew } = readOrIssueOwnerId(request.headers.get("cookie"));
  if (isNew) {
    return NextResponse.json({ batch: null }, { status: 200 });
  }

  const batchId = await readCurrentBatchIdForOwner(ownerId);
  if (!batchId) {
    return NextResponse.json({ batch: null }, { status: 200 });
  }

  const record = (await readBatchRecord(batchId)) as BatchRecordWithRowFileNames | null;
  if (!record) {
    return NextResponse.json({ batch: null }, { status: 200 });
  }

  const rows = await readAllBatchRowStates(batchId, record.rowFileNames);
  return NextResponse.json({ batch: buildCurrentBatchSummary(record, rows) }, { status: 200 });
}
