// Vitest coverage for POST /api/batch/[id]/process's pure logic: the N-from-env-var
// concurrency resolver, and the progress-summary builder. Neither touches KV, Blob, or
// the extraction API, so both run without mocking anything. The route handler itself
// (which reads/writes KV and calls verify()) isn't covered by this suite, per this
// project's established testing-scope convention: pure logic gets automated tests,
// direct external API calls don't.

import { describe, expect, it, afterEach } from "vitest";
import type { BatchRowState } from "@/lib/persistence/kvStore";
import { resolveBatchProcessConcurrency, summarizeBatchProgress } from "./route";

describe("resolveBatchProcessConcurrency", () => {
  const originalValue = process.env.BATCH_PROCESS_CONCURRENCY;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.BATCH_PROCESS_CONCURRENCY;
    } else {
      process.env.BATCH_PROCESS_CONCURRENCY = originalValue;
    }
  });

  it("defaults to 1 when the environment variable isn't set at all", () => {
    delete process.env.BATCH_PROCESS_CONCURRENCY;
    expect(resolveBatchProcessConcurrency()).toBe(1);
  });

  it("reads a positive integer straight from the environment variable", () => {
    process.env.BATCH_PROCESS_CONCURRENCY = "5";
    expect(resolveBatchProcessConcurrency()).toBe(5);
  });

  it("floors a non-integer value rather than rejecting it outright", () => {
    process.env.BATCH_PROCESS_CONCURRENCY = "2.7";
    expect(resolveBatchProcessConcurrency()).toBe(2);
  });

  it("falls back to 1 when the value isn't a usable number", () => {
    process.env.BATCH_PROCESS_CONCURRENCY = "not-a-number";
    expect(resolveBatchProcessConcurrency()).toBe(1);
  });

  it("falls back to 1 when the value is zero or negative (a concurrency of 0 makes no sense)", () => {
    process.env.BATCH_PROCESS_CONCURRENCY = "0";
    expect(resolveBatchProcessConcurrency()).toBe(1);

    process.env.BATCH_PROCESS_CONCURRENCY = "-3";
    expect(resolveBatchProcessConcurrency()).toBe(1);
  });
});

describe("summarizeBatchProgress", () => {
  const doneRow: BatchRowState = {
    id: "1042",
    fileName: "IMG_001.jpg",
    applicationData: { brandName: "Old Tom" },
    blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_001.jpg",
    status: "done",
    result: { fileName: "IMG_001.jpg", fields: [], overallStatus: "matched" },
  };
  const pendingRow: BatchRowState = {
    id: "1043",
    fileName: "IMG_002.jpg",
    applicationData: { brandName: "Old Barrel" },
    blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_002.jpg",
    status: "pending",
  };

  it("reports doneCount/pendingCount and isComplete: false when some rows still need work", () => {
    const summary = summarizeBatchProgress("batch-1", 2, [doneRow, pendingRow], [doneRow], []);

    expect(summary).toEqual({
      batchId: "batch-1",
      totalCount: 2,
      doneCount: 1,
      pendingCount: 1,
      isComplete: false,
      processedRows: [doneRow],
      rowErrors: [],
    });
  });

  it("reports isComplete: true once every row's status is done", () => {
    const secondDoneRow: BatchRowState = { ...pendingRow, status: "done", result: { fileName: "IMG_002.jpg", fields: [], overallStatus: "matched" } };
    const summary = summarizeBatchProgress("batch-1", 2, [doneRow, secondDoneRow], [secondDoneRow], []);

    expect(summary.doneCount).toBe(2);
    expect(summary.pendingCount).toBe(0);
    expect(summary.isComplete).toBe(true);
  });

  it("treats an in_flight row the same as a pending one — not counted as done", () => {
    const inFlightRow: BatchRowState = { ...pendingRow, status: "in_flight" };
    const summary = summarizeBatchProgress("batch-1", 2, [doneRow, inFlightRow], [], []);

    expect(summary.doneCount).toBe(1);
    expect(summary.pendingCount).toBe(1);
    expect(summary.isComplete).toBe(false);
  });

  it("passes rowErrors through unchanged, for a round where a row failed and stayed retryable", () => {
    const rowErrors = [{ fileName: "IMG_002.jpg", error: "Gemini extraction timed out." }];
    const summary = summarizeBatchProgress("batch-1", 2, [doneRow, pendingRow], [], rowErrors);

    expect(summary.rowErrors).toEqual(rowErrors);
    expect(summary.processedRows).toEqual([]);
  });
});
