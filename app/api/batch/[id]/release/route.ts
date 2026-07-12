// POST /api/batch/[id]/release — proactively releases the calling tab's single-active-
// tab lock on a batch. Exists specifically to be called from a `beforeunload`/`pagehide`
// handler via `navigator.sendBeacon()` when a tab holding the lock is closed or
// navigated away from deliberately — without this, the only way a lock ever frees up is
// the ~30s heartbeat-staleness window in `evaluateLockClaim()` (lib/persistence/
// batchLock.ts), which exists for the genuine-crash case (tab killed with no chance to
// run any unload handler at all) but otherwise leaves a resuming user stuck waiting out
// that window for no real reason, since the lock-holding tab is provably gone.
//
// Request body (JSON): { tabId: string } — the same lock-claiming id every
// /api/batch/[id]/process call already carries.
//
// Response: always 204 (no body), even if the batch doesn't exist, the tabId is
// malformed, or this tab never actually held the lock — releaseBatchLock() itself is
// already a safe no-op in all of those cases (see its own doc comment), and a beacon
// request fired during page unload has no code left to read a meaningful response
// anyway, so there's nothing a more specific status would let the caller do differently.

import { NextRequest, NextResponse } from "next/server";
import { releaseBatchLock } from "@/lib/persistence/batchLock";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: batchId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const tabId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).tabId : undefined;
  if (typeof tabId !== "string" || tabId.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  await releaseBatchLock(batchId, tabId);
  return new NextResponse(null, { status: 204 });
}
