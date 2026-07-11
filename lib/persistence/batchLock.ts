// Single-active-tab enforcement for the batch flow: a tab-scoped id (held in
// sessionStorage, unlike the owner cookie in cookie.ts, which is shared across every
// tab of the same browser) claims a batch's lock, then renews a heartbeat on that
// batch's KV record so a second tab can tell the first one is still actively working
// the batch, not just that it once was. This matters because batch processing is
// server-driven and chunked — the browser repeatedly asks the server to process the
// next few pending rows while its tab is open — so without a lock, two tabs open on
// the same batch would race each other for the same pending rows, since the KV record
// they'd both be reading/writing has no locking of its own.
//
// This is a best-effort, application-level lock — a plain read-then-write against KV,
// not an atomic compare-and-swap — proportionate to what it's actually protecting (a UX
// footgun: two tabs stepping on each other's progress updates), not a distributed-
// systems correctness guarantee. See evaluateLockClaim()'s doc comment for the
// stale-lock recovery this trade-off still needs, so an abandoned lock (crashed/closed
// tab) doesn't strand the batch locked forever.

import type { BatchRecord } from "./kvStore";
import { readBatchRecord, writeBatchRecord } from "./kvStore";

/** sessionStorage key holding this browser tab's own lock-claiming id. */
const TAB_ID_STORAGE_KEY = "labelVerificationApp:tabId";

/**
 * How often an active tab should renew its heartbeat on the batch's KV record, in
 * milliseconds. Deliberately much shorter than LOCK_HEARTBEAT_STALE_AFTER_MS below —
 * several missed renewals in a row (not just one slightly slow one) are what should
 * actually free a lock up for another tab to claim, not a single delayed request.
 */
export const LOCK_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * How old a lock's last heartbeat has to be before another tab is allowed to treat it
 * as abandoned (the locking tab crashed, or its browser/tab was closed without ever
 * releasing the lock) and steal it, rather than staying blocked indefinitely. Several
 * heartbeat intervals' worth of grace, not barely more than one, so a single
 * slow/delayed renewal under otherwise-normal conditions doesn't get mistaken for an
 * abandoned tab.
 */
export const LOCK_HEARTBEAT_STALE_AFTER_MS = 30_000;

/**
 * The result of attempting to claim or renew a batch's lock: either this tab may
 * proceed, or another tab genuinely still holds it (and that tab's id is surfaced so
 * the caller can show a meaningful "still being processed elsewhere" message rather
 * than a bare "blocked").
 */
export type LockClaimResult = { canProceed: true } | { canProceed: false; heldByAnotherTabId: string };

/**
 * The actual claim decision, factored out as a pure function (no sessionStorage, no KV
 * client call) so it's directly unit-testable: given a batch's current lock state and
 * the calling tab's own id, decide whether that tab may proceed — because the lock is
 * free, already belongs to this tab, or has gone stale enough to safely steal — or must
 * back off because another tab's heartbeat is still fresh.
 */
export function evaluateLockClaim(params: {
  lockedByTabId: string | undefined;
  lockHeartbeatAt: string | undefined;
  tabId: string;
  now: number;
  staleAfterMs?: number;
}): LockClaimResult {
  const staleAfterMs = params.staleAfterMs ?? LOCK_HEARTBEAT_STALE_AFTER_MS;

  if (!params.lockedByTabId || params.lockedByTabId === params.tabId) {
    // Nobody holds the lock yet, or this tab already does — either way, safe to
    // (re-)claim/renew it.
    return { canProceed: true };
  }

  const heartbeatAgeMs = params.lockHeartbeatAt
    ? params.now - new Date(params.lockHeartbeatAt).getTime()
    : Number.POSITIVE_INFINITY; // No heartbeat ever recorded — treat as infinitely stale.

  if (heartbeatAgeMs > staleAfterMs) {
    // The other tab's heartbeat is too old to trust — it most likely crashed or was
    // closed without releasing the lock. Safe to steal rather than leaving the batch
    // stuck locked forever over a tab that's no longer actually there.
    return { canProceed: true };
  }

  return { canProceed: false, heldByAnotherTabId: params.lockedByTabId };
}

/**
 * Reads this browser tab's own lock-claiming id from sessionStorage, generating and
 * persisting a fresh one the first time it's needed. sessionStorage (not
 * localStorage/cookies) is what makes this genuinely tab-scoped — reloading this same
 * tab keeps its id, but a second tab opened from the same browser gets its own, which
 * is exactly the distinction evaluateLockClaim() needs to tell "still us" apart from
 * "actually a different tab." Browser-only; not covered by this phase's Vitest suite
 * (no sessionStorage in the plain Node test environment this project's tests run
 * under) — same testing-scope convention as uploadLabelImage() in blobUpload.ts.
 */
export function getOrCreateTabId(): string {
  const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const tabId = crypto.randomUUID();
  sessionStorage.setItem(TAB_ID_STORAGE_KEY, tabId);
  return tabId;
}

/**
 * Attempts to claim (or renew) this tab's lock on a batch: reads the batch's current
 * record from KV, runs evaluateLockClaim() against it, and — only if that allows it —
 * writes the record back with this tab as the holder and a fresh heartbeat timestamp.
 * Returns the claim result either way, so the caller (BatchUploadPanel.tsx's processing
 * loop, Phase 8) can decide what to show the user on a lost/blocked claim without this
 * function reaching into any UI concerns itself.
 */
export async function claimBatchLock(batchId: string, tabId: string): Promise<LockClaimResult> {
  const record = await readBatchRecord(batchId);
  if (!record) {
    throw new Error(
      `Cannot claim a lock for batch "${batchId}": no batch record exists in KV (never registered, or its ~48h TTL already expired).`
    );
  }

  const claim = evaluateLockClaim({
    lockedByTabId: record.lockedByTabId,
    lockHeartbeatAt: record.lockHeartbeatAt,
    tabId,
    now: Date.now(),
  });

  if (!claim.canProceed) {
    return claim;
  }

  const updatedRecord: BatchRecord = {
    ...record,
    lockedByTabId: tabId,
    lockHeartbeatAt: new Date().toISOString(),
  };
  await writeBatchRecord(updatedRecord);
  return claim;
}

/**
 * Releases this tab's lock on a batch, if it still holds it — called when a batch
 * finishes normally, or the user deliberately navigates away (not on crash/close,
 * which is exactly what the heartbeat-staleness check in evaluateLockClaim() exists to
 * handle instead, since a crashed tab never gets the chance to call this). A no-op, not
 * an error, if this tab isn't actually the current holder (e.g. it already lost the
 * lock to a stale-claim steal by another tab) — releasing a lock this tab doesn't hold
 * must never be able to clobber whichever tab now legitimately does.
 */
export async function releaseBatchLock(batchId: string, tabId: string): Promise<void> {
  const record = await readBatchRecord(batchId);
  if (!record || record.lockedByTabId !== tabId) {
    return;
  }
  const updatedRecord: BatchRecord = { ...record, lockedByTabId: undefined, lockHeartbeatAt: undefined };
  await writeBatchRecord(updatedRecord);
}
