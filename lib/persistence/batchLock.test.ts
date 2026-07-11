// Vitest coverage for batchLock.ts's evaluateLockClaim() — the pure lock-claim decision
// logic, isolated from both sessionStorage (getOrCreateTabId) and the real KV client
// (claimBatchLock/releaseBatchLock), so it's directly testable with plain values and no
// mocking, per this project's established testing-scope convention.

import { describe, expect, it } from "vitest";
import { evaluateLockClaim, LOCK_HEARTBEAT_STALE_AFTER_MS } from "./batchLock";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");

describe("evaluateLockClaim", () => {
  it("allows the claim when the batch has never been locked", () => {
    const result = evaluateLockClaim({
      lockedByTabId: undefined,
      lockHeartbeatAt: undefined,
      tabId: "tab-a",
      now: NOW,
    });

    expect(result).toEqual({ canProceed: true });
  });

  it("allows the claim (a renewal) when this same tab already holds the lock", () => {
    const result = evaluateLockClaim({
      lockedByTabId: "tab-a",
      lockHeartbeatAt: new Date(NOW - 1_000).toISOString(), // 1s ago -- fresh
      tabId: "tab-a",
      now: NOW,
    });

    expect(result).toEqual({ canProceed: true });
  });

  it("blocks the claim when another tab holds the lock with a fresh heartbeat", () => {
    const result = evaluateLockClaim({
      lockedByTabId: "tab-b",
      lockHeartbeatAt: new Date(NOW - 1_000).toISOString(), // 1s ago -- well under the stale threshold
      tabId: "tab-a",
      now: NOW,
    });

    expect(result).toEqual({ canProceed: false, heldByAnotherTabId: "tab-b" });
  });

  it("allows the claim (a steal) when another tab's heartbeat is older than the stale threshold", () => {
    const staleHeartbeatAt = new Date(NOW - LOCK_HEARTBEAT_STALE_AFTER_MS - 1_000).toISOString();

    const result = evaluateLockClaim({
      lockedByTabId: "tab-b",
      lockHeartbeatAt: staleHeartbeatAt,
      tabId: "tab-a",
      now: NOW,
    });

    expect(result).toEqual({ canProceed: true });
  });

  it("blocks the claim right at the boundary, when the heartbeat age exactly equals the stale threshold", () => {
    // heartbeatAgeMs === staleAfterMs is not yet "older than" -- the comparison is
    // strictly greater-than, so this must still be blocked, not stolen.
    const boundaryHeartbeatAt = new Date(NOW - LOCK_HEARTBEAT_STALE_AFTER_MS).toISOString();

    const result = evaluateLockClaim({
      lockedByTabId: "tab-b",
      lockHeartbeatAt: boundaryHeartbeatAt,
      tabId: "tab-a",
      now: NOW,
    });

    expect(result).toEqual({ canProceed: false, heldByAnotherTabId: "tab-b" });
  });

  it("allows the claim (a steal) when another tab holds the lock but has no recorded heartbeat at all", () => {
    // No heartbeat ever recorded is treated as infinitely stale, not as "fresh by default."
    const result = evaluateLockClaim({
      lockedByTabId: "tab-b",
      lockHeartbeatAt: undefined,
      tabId: "tab-a",
      now: NOW,
    });

    expect(result).toEqual({ canProceed: true });
  });

  it("respects a custom staleAfterMs override instead of the module default", () => {
    const heartbeatAt = new Date(NOW - 5_000).toISOString(); // 5s ago

    // Under a 10s custom threshold, a 5s-old heartbeat is still fresh -- blocked.
    const blocked = evaluateLockClaim({
      lockedByTabId: "tab-b",
      lockHeartbeatAt: heartbeatAt,
      tabId: "tab-a",
      now: NOW,
      staleAfterMs: 10_000,
    });
    expect(blocked).toEqual({ canProceed: false, heldByAnotherTabId: "tab-b" });

    // Under a 1s custom threshold, that same 5s-old heartbeat is now stale -- stealable.
    const stolen = evaluateLockClaim({
      lockedByTabId: "tab-b",
      lockHeartbeatAt: heartbeatAt,
      tabId: "tab-a",
      now: NOW,
      staleAfterMs: 1_000,
    });
    expect(stolen).toEqual({ canProceed: true });
  });
});
