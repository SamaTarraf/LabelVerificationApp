// POST /api/batch — registers a new batch: given the rows a browser already paired
// client-side (each row's manifest data plus the Blob URL its image was already
// uploaded to), this writes one batch record and one row record per label into the
// ephemeral KV store, and hands back a batchId the browser will use for every
// subsequent /api/batch/[id]/process call.
//
// Nothing here re-parses a CSV or re-uploads an image — pairing (matching manifest rows
// to image files) and the actual image upload both already happened in the browser
// before this request is made. This route's only job is turning "here are N paired rows,
// already uploaded" into durable-for-~48h server state a chunked processing loop and a
// resume-after-refresh flow can both read back later.
//
// Request body (JSON): { rows: Array<{ id: string; fileName: string; applicationData:
// object; blobRef: string }> } — applicationData is the same open, string-valued field
// map single-verify uses; blobRef is the URL a prior direct-to-Blob upload returned for
// that row's image, not the image bytes themselves (this route's body never carries
// image data — that's the entire point of uploading straight to Blob from the
// browser). `id` is the manifest's own free-form row identifier, carried through
// unchanged for the results CSV export (Phase 9) — unlike fileName/blobRef it's not
// required to be non-empty, since a manifest isn't required to have an `id` column at
// all.
//
// Response body (JSON) on success (201): { batchId: string; totalCount: number }.
// On failure: { error: string } with a 400 for a malformed body, an empty "rows" array,
// or a "rows" array longer than resolveMaxBatchSize() allows (see lib/batchInput/types.ts).
//
// Cookie handling: reads whatever anonymous batch-owner id the browser already sent (if
// any); if this is the browser's first-ever batch, a fresh id is issued and set on the
// response as a Set-Cookie header so future requests (including a page reload calling
// GET /api/batch/current) can find this same batch again. This id carries no personal
// information — it exists purely so a returning browser can be told "you already have
// an in-progress batch," never to identify a person.

import { NextRequest, NextResponse } from "next/server";
import type { ApplicationData } from "@/lib/types";
import { resolveMaxBatchSize } from "@/lib/batchInput/types";
import { buildOwnerCookieHeader, readOrIssueOwnerId } from "@/lib/persistence/cookie";
import type { BatchRecord, BatchRowState } from "@/lib/persistence/kvStore";
import { writeBatchRecord, writeBatchRowState } from "@/lib/persistence/kvStore";

/**
 * Registering a batch means writing one BatchRecord plus up to a few hundred
 * BatchRowState entries to KV — each write is a small, independent round trip, and
 * they're all issued together (see writeAllRows below), so the total time is close to
 * one round trip's latency, not the sum of every row's. 30s is a generous ceiling above
 * that, not a number this route is expected to get anywhere near in practice.
 */
export const maxDuration = 30;

/**
 * One row of the request body: a label the browser has already paired with its
 * application data and already uploaded to Blob storage. This is intentionally *not*
 * imported from the batch-input pairing layer's own entry type — that type carries a
 * real browser File object (the image bytes), which this request body never contains;
 * by the time a row reaches this route, its image already lives in Blob and only the
 * resulting URL travels over the wire.
 */
type RegisterBatchRowInput = {
  id: string;
  fileName: string;
  applicationData: ApplicationData;
  blobRef: string;
};

/**
 * The row-carrying extension of BatchRecord this route relies on, alongside every other
 * batch route that needs to enumerate a batch's rows without a second, separate lookup.
 * BatchRecord itself only carries a totalCount (a number), not the actual list of row
 * fileNames a batch owns — reading every row back out of KV needs to start from
 * somewhere concrete, since the store has no "list keys for this batch" operation to
 * fall back on. Declaring the extra field locally (rather than widening BatchRecord's
 * own type) keeps this addition entirely inside the batch API routes that need it,
 * without changing the shape every other consumer of BatchRecord is written against.
 * The object actually written to KV always carries this field — writeBatchRecord()'s
 * parameter type doesn't list it, but passing a wider object than it declares is exactly
 * what TypeScript's structural typing allows, and the underlying store keeps whatever
 * JSON shape it's handed.
 */
type BatchRecordWithRowFileNames = BatchRecord & { rowFileNames: string[] };

/**
 * Confirms a parsed JSON value is shaped like an ApplicationData object — a plain,
 * non-array object whose present values are all strings. The request body is an
 * external system boundary, so it's validated here rather than trusted blindly, the same
 * check single-verify's own route already performs on its applicationData part.
 * Exported (alongside validateRegisterBatchRow below) purely so this pure, network-free
 * validation logic is directly unit-testable, the same reasoning kvStore.ts's key-naming
 * functions are exported for even though the route handler itself isn't tested here.
 */
export function isApplicationData(value: unknown): value is ApplicationData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((fieldValue) => typeof fieldValue === "string" || fieldValue === undefined);
}

/**
 * Confirms one row of the request body is shaped correctly: a non-empty fileName, a
 * non-empty blobRef, an applicationData object passing the check above, and an `id`
 * that's present and a string — but, unlike fileName/blobRef, `id` is not required to
 * be non-empty. A manifest isn't required to have an `id` column at all, and
 * csvManifestParser.ts already defaults a missing/blank id to "" rather than treating
 * it as an error, so this route accepts that same "" here rather than rejecting it —
 * what it does reject is the field being missing or the wrong type entirely, which
 * would indicate a malformed request body, not just an id-less manifest. Returns a
 * human-readable reason string on failure (surfaced in the 400 response) rather than a
 * bare boolean, since "which row, and why" is far more useful for debugging a malformed
 * client request than a generic rejection.
 */
export function validateRegisterBatchRow(value: unknown, index: number): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `Row ${index} must be an object.`;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") {
    return `Row ${index} is missing an "id" (must be a string, may be empty).`;
  }
  if (typeof row.fileName !== "string" || row.fileName.length === 0) {
    return `Row ${index} is missing a non-empty "fileName".`;
  }
  if (typeof row.blobRef !== "string" || row.blobRef.length === 0) {
    return `Row ${index} is missing a non-empty "blobRef".`;
  }
  if (!isApplicationData(row.applicationData)) {
    return `Row ${index}'s "applicationData" must be an object of string field values.`;
  }
  return null;
}

/**
 * Writes every row of a newly-registered batch to KV in parallel — one row is
 * independent of every other, so there's no reason to wait for row 1's round trip
 * before starting row 2's. Split out as its own function (rather than inlined in POST)
 * so the registration flow below reads as one linear sequence of steps.
 */
async function writeAllRows(batchId: string, rows: RegisterBatchRowInput[]): Promise<void> {
  await Promise.all(
    rows.map((row) => {
      const rowState: BatchRowState = {
        id: row.id,
        fileName: row.fileName,
        applicationData: row.applicationData,
        blobRef: row.blobRef,
        status: "pending",
      };
      return writeBatchRowState(batchId, rowState);
    })
  );
}

/**
 * Handles POST /api/batch. Steps:
 *   1. Read (or issue) the anonymous batch-owner id from the request's Cookie header.
 *   2. Parse and validate the request body — a non-empty array of paired rows.
 *   3. Generate a fresh batchId and write the batch's own record (including the
 *      rowFileNames list every other batch route needs to enumerate this batch's rows).
 *   4. Write every row's initial state ("pending", nothing verified yet).
 *   5. Return the new batchId, setting a Set-Cookie header if this browser didn't
 *      already have an owner id.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { ownerId, isNew } = readOrIssueOwnerId(request.headers.get("cookie"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).rows)) {
    return NextResponse.json({ error: 'Request body must be an object with a "rows" array.' }, { status: 400 });
  }
  const rawRows = (body as { rows: unknown[] }).rows;
  if (rawRows.length === 0) {
    return NextResponse.json({ error: '"rows" must contain at least one row.' }, { status: 400 });
  }

  // The actual enforcement boundary for the batch-size cap — BatchUploadPanel.tsx's own
  // preflight check exists purely so a user sees this rejection before uploading
  // anything, not as the real security boundary, since a direct API call would bypass
  // any client-side-only check entirely.
  const maxBatchSize = resolveMaxBatchSize();
  if (rawRows.length > maxBatchSize) {
    return NextResponse.json(
      {
        error: `This batch has ${rawRows.length} rows, which exceeds the maximum of ${maxBatchSize} per batch. Split it into smaller batches and register each one separately.`,
      },
      { status: 400 }
    );
  }

  for (let index = 0; index < rawRows.length; index += 1) {
    const rowError = validateRegisterBatchRow(rawRows[index], index);
    if (rowError) {
      return NextResponse.json({ error: rowError }, { status: 400 });
    }
  }
  // Every row already passed validateRegisterBatchRow above, so this cast is safe —
  // TypeScript can't narrow an array element-by-element through a loop the way it can a
  // single value, so the cast just states what the loop above already confirmed.
  const rows = rawRows as RegisterBatchRowInput[];

  const batchId = crypto.randomUUID();
  const record: BatchRecordWithRowFileNames = {
    batchId,
    ownerCookie: ownerId,
    createdAt: new Date().toISOString(),
    totalCount: rows.length,
    rowFileNames: rows.map((row) => row.fileName),
  };

  await writeBatchRecord(record);
  await writeAllRows(batchId, rows);

  const response = NextResponse.json({ batchId, totalCount: rows.length }, { status: 201 });
  if (isNew) {
    response.headers.set("Set-Cookie", buildOwnerCookieHeader(ownerId));
  }
  return response;
}
