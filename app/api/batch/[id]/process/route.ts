// POST /api/batch/[id]/process — the one endpoint that actually does verification work
// for a batch. A browser with an open tab on this batch calls this repeatedly, in a
// loop, for as long as that tab stays open: each call claims (or renews) this tab's
// single-active-tab lock, picks up to N rows that still need work, verifies them, writes
// their results to KV, and reports back how much of the batch is now done. Nothing
// processes on its own between calls — there's no background worker or queue behind
// this, just a plain request handler a browser keeps re-invoking while it's watching.
//
// Request body (JSON): { tabId: string } — the calling browser tab's own lock-claiming
// id (a sessionStorage-held value, so it's unique per tab, not per browser). Every call
// carries it so this route can both claim the lock on a tab's first call and keep
// renewing the same claim's heartbeat on every call after that — a genuinely idle batch
// (no tab currently looping) simply stops getting heartbeat renewals, which is exactly
// what lets another tab detect the lock as abandoned and safely take over later.
//
// Response body (JSON) on success (200): batch-wide progress after this call's work —
// { batchId, totalCount, doneCount, pendingCount, isComplete, processedRows, rowErrors }.
// processedRows carries the full result for whatever finished on this call (so a caller
// doesn't need a second round trip just to see what was just verified); rowErrors lists
// any row that failed this round and is still retryable on a future call, by design not
// treated as this whole request failing.
//
// On failure: a 404 if the batch doesn't exist (never registered, or its ~48h TTL
// already expired), a 409 if another tab currently holds the lock, or a 400 for a
// malformed request body.

import { NextRequest, NextResponse } from "next/server";
import type { LabelImage } from "@/lib/extraction/types";
import { verify } from "@/lib/matching/verify";
import { claimBatchLock } from "@/lib/persistence/batchLock";
import type { BatchRecord, BatchRowState } from "@/lib/persistence/kvStore";
import { readAllBatchRowStates, readBatchRecord, writeBatchRowState } from "@/lib/persistence/kvStore";

/**
 * A single call to this route fetches up to N images from Blob and runs up to N
 * extraction calls, so its total time is bounded by the slowest of those N (they run
 * concurrently, not one after another — see processPendingRows below), plus a little
 * overhead for the Blob fetches and the KV writes either side. 20s covers the ~2-4s a
 * single extraction call takes with real margin, even if N grows past 1 later on a
 * higher-throughput tier.
 */
export const maxDuration = 20;

/** Falls back to when BATCH_PROCESS_CONCURRENCY isn't set, or isn't a usable number. */
const DEFAULT_BATCH_PROCESS_CONCURRENCY = 1;

/**
 * The row-carrying extension of BatchRecord every batch route needs to enumerate a
 * batch's rows from a single lookup — see the sibling registration route (POST
 * /api/batch) for why this is declared locally rather than widening BatchRecord's own
 * type. Read back here with a cast, not re-validated field by field: this route trusts
 * that whatever registered the batch wrote this field, since registration is the only
 * code path that ever creates a batch record in the first place.
 */
type BatchRecordWithRowFileNames = BatchRecord & { rowFileNames: string[] };

/**
 * Reads the concurrency cap N from its environment variable, defaulting to 1 rather than
 * throwing when it's unset. This is a deliberate exception to "a missing operational
 * setting should throw, not silently default" — there's no database-backed settings
 * store in this design to seed a default into, and 1 is not an arbitrary guess: it's the
 * measured ceiling the current extraction provider's free-tier rate limit actually
 * allows before requests start getting throttled. Reading it from the environment
 * (rather than a bare literal `1` inline below) is what lets this scale up later, on a
 * higher-throughput tier, without a code change — only a deployment config change.
 */
export function resolveBatchProcessConcurrency(): number {
  const raw = process.env.BATCH_PROCESS_CONCURRENCY;
  if (!raw) {
    return DEFAULT_BATCH_PROCESS_CONCURRENCY;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BATCH_PROCESS_CONCURRENCY;
  }
  return Math.floor(parsed);
}

/** Everything about one round of processing this route hands back to the caller. */
type ProcessBatchResponseBody = {
  batchId: string;
  totalCount: number;
  doneCount: number;
  pendingCount: number;
  isComplete: boolean;
  processedRows: BatchRowState[];
  rowErrors: { fileName: string; error: string }[];
};

/**
 * Builds the progress summary this route returns, given the batch's full row list *as
 * of after* this round's processing. Pure and synchronous (no KV/network access) so it's
 * directly unit-testable on its own — the only genuinely pure piece of this route's
 * otherwise KV/network-heavy logic.
 */
export function summarizeBatchProgress(
  batchId: string,
  totalCount: number,
  updatedRows: BatchRowState[],
  processedRows: BatchRowState[],
  rowErrors: { fileName: string; error: string }[]
): ProcessBatchResponseBody {
  const doneCount = updatedRows.filter((row) => row.status === "done").length;
  return {
    batchId,
    totalCount,
    doneCount,
    pendingCount: totalCount - doneCount,
    isComplete: doneCount === totalCount,
    processedRows,
    rowErrors,
  };
}

/**
 * Fetches one row's already-uploaded label image from its Blob URL and converts it into
 * the base64 + mimeType shape LabelExtractor expects — the batch-flow equivalent of
 * single-verify's own File-to-base64 conversion, just starting from a fetch() response
 * instead of a directly-uploaded browser File, since a batch row's image already lives
 * in Blob storage by the time this route ever sees it.
 */
async function fetchLabelImage(blobRef: string): Promise<LabelImage> {
  const response = await fetch(blobRef);
  if (!response.ok) {
    throw new Error(`Failed to fetch label image from Blob storage (status ${response.status}): ${blobRef}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    base64: Buffer.from(arrayBuffer).toString("base64"),
    mimeType: response.headers.get("content-type") || "application/octet-stream",
  };
}

/**
 * Verifies one row end to end: fetches its image, runs it through the same
 * extraction-plus-matching pipeline single-verify uses, and writes the finished result
 * back to KV. The row is marked "in_flight" *before* the actual extraction call starts —
 * so if this whole request's function execution gets cut off partway through (a genuine
 * server-side crash, not just a row-level extraction failure below), the row is left
 * showing "in_flight" rather than a stale "pending" that would look like nothing was
 * ever attempted. Because a later call simply treats "in_flight" the same as "pending"
 * (see the caller's own filtering below) and verify() has no other side effect than
 * producing a result, redoing an interrupted row here is always safe — there's nothing
 * to undo, only a result to overwrite.
 */
async function processRow(batchId: string, row: BatchRowState): Promise<BatchRowState> {
  await writeBatchRowState(batchId, { ...row, status: "in_flight" });

  const image = await fetchLabelImage(row.blobRef);
  const result = await verify(row.fileName, image, row.applicationData);

  const doneRow: BatchRowState = { ...row, status: "done", result };
  await writeBatchRowState(batchId, doneRow);
  return doneRow;
}

/**
 * Processes up to `concurrency` still-pending rows together. Promise.allSettled (not
 * Promise.all) is used deliberately: every row is picked up concurrently either way — a
 * settled call's overlapping-wait-time benefit is identical to Promise.all's — but
 * allSettled additionally means one row's extraction failure can't abort or discard the
 * results of every other row in the same round. A row that fails is simply left
 * "in_flight" in KV (processRow above already wrote that before it failed) and reported
 * in rowErrors, ready to be picked up again by this same route on its very next call —
 * a failed row is trivially retryable, never a reason to fail the whole batch round.
 */
async function processPendingRows(
  batchId: string,
  rowsToProcess: BatchRowState[]
): Promise<{ processedRows: BatchRowState[]; rowErrors: { fileName: string; error: string }[] }> {
  const settled = await Promise.allSettled(rowsToProcess.map((row) => processRow(batchId, row)));

  const processedRows: BatchRowState[] = [];
  const rowErrors: { fileName: string; error: string }[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      processedRows.push(outcome.value);
    } else {
      const row = rowsToProcess[index];
      const message = outcome.reason instanceof Error ? outcome.reason.message : "Verification failed for an unknown reason.";
      rowErrors.push({ fileName: row.fileName, error: message });
    }
  });
  return { processedRows, rowErrors };
}

/**
 * Handles POST /api/batch/[id]/process. Steps:
 *   1. Parse the batchId out of the dynamic route segment and the calling tab's id out
 *      of the request body.
 *   2. Read the batch's record — a 404 if it was never registered or has already
 *      expired past its ~48h TTL.
 *   3. Claim (or renew) this tab's lock on the batch — a 409, naming whichever tab does
 *      hold it, if another tab's heartbeat is still fresh.
 *   4. Read every row's current state, and pick up to N whose status isn't already
 *      "done" (both "pending" and "in_flight" count as still needing work — see
 *      processRow's own doc comment for why a stale "in_flight" is safe to redo).
 *   5. Process those rows (or do nothing, if none remain) and report updated progress.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: batchId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const tabId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).tabId : undefined;
  if (typeof tabId !== "string" || tabId.length === 0) {
    return NextResponse.json({ error: 'Request body must include a non-empty "tabId".' }, { status: 400 });
  }

  const record = (await readBatchRecord(batchId)) as BatchRecordWithRowFileNames | null;
  if (!record) {
    return NextResponse.json(
      { error: `No batch found for id "${batchId}" (never registered, or its ~48h TTL already expired).` },
      { status: 404 }
    );
  }

  const lockClaim = await claimBatchLock(batchId, tabId);
  if (!lockClaim.canProceed) {
    return NextResponse.json(
      { error: "This batch is currently being processed by another open tab.", heldByAnotherTabId: lockClaim.heldByAnotherTabId },
      { status: 409 }
    );
  }

  const allRows = await readAllBatchRowStates(batchId, record.rowFileNames);
  const concurrency = resolveBatchProcessConcurrency();
  const rowsToProcess = allRows.filter((row) => row.status !== "done").slice(0, concurrency);

  const { processedRows, rowErrors } =
    rowsToProcess.length > 0 ? await processPendingRows(batchId, rowsToProcess) : { processedRows: [], rowErrors: [] };

  // Build the post-round row list in memory (rather than re-reading every row from KV a
  // second time) by overlaying this round's freshly-processed rows onto what was already
  // read above — every row not touched this round keeps exactly the state it already had.
  const updatedRows = allRows.map((row) => processedRows.find((processed) => processed.fileName === row.fileName) ?? row);

  return NextResponse.json(summarizeBatchProgress(batchId, record.totalCount, updatedRows, processedRows, rowErrors), {
    status: 200,
  });
}
