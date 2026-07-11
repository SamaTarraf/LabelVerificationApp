// Vitest coverage for GET /api/batch/current's pure logic: buildCurrentBatchSummary,
// which turns a batch record plus its row list into the resumable-batch summary this
// route reports back. No KV, no network — the route handler itself (which actually reads
// from KV) isn't covered by this suite, per this project's established testing-scope
// convention: pure logic gets automated tests, direct external API calls don't.

import { describe, expect, it } from "vitest";
import type { BatchRecord, BatchRowState } from "@/lib/persistence/kvStore";
import { buildCurrentBatchSummary } from "./route";

describe("buildCurrentBatchSummary", () => {
  const record: BatchRecord & { rowFileNames: string[] } = {
    batchId: "batch-1",
    ownerCookie: "owner-abc",
    createdAt: "2026-07-11T00:00:00.000Z",
    totalCount: 2,
    rowFileNames: ["IMG_001.jpg", "IMG_002.jpg"],
  };

  it("reports pendingCount/isComplete correctly when some rows are still unfinished", () => {
    const rows: BatchRowState[] = [
      {
        id: "1042",
        fileName: "IMG_001.jpg",
        applicationData: { brandName: "Old Tom" },
        blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_001.jpg",
        status: "done",
        result: { fileName: "IMG_001.jpg", fields: [], overallStatus: "matched" },
      },
      {
        id: "1043",
        fileName: "IMG_002.jpg",
        applicationData: { brandName: "Old Barrel" },
        blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_002.jpg",
        status: "pending",
      },
    ];

    const summary = buildCurrentBatchSummary(record, rows);

    expect(summary).toEqual({
      batchId: "batch-1",
      totalCount: 2,
      doneCount: 1,
      pendingCount: 1,
      isComplete: false,
      rows,
    });
  });

  it("reports isComplete: true once every row is done", () => {
    const rows: BatchRowState[] = [
      {
        id: "1042",
        fileName: "IMG_001.jpg",
        applicationData: { brandName: "Old Tom" },
        blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_001.jpg",
        status: "done",
        result: { fileName: "IMG_001.jpg", fields: [], overallStatus: "matched" },
      },
      {
        id: "1043",
        fileName: "IMG_002.jpg",
        applicationData: { brandName: "Old Barrel" },
        blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_002.jpg",
        status: "done",
        result: { fileName: "IMG_002.jpg", fields: [], overallStatus: "matched" },
      },
    ];

    const summary = buildCurrentBatchSummary(record, rows);

    expect(summary.doneCount).toBe(2);
    expect(summary.pendingCount).toBe(0);
    expect(summary.isComplete).toBe(true);
  });

  it("carries every row's own state through unchanged, including a done row's full result", () => {
    const rows: BatchRowState[] = [
      {
        id: "1042",
        fileName: "IMG_001.jpg",
        applicationData: { brandName: "Old Tom" },
        blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_001.jpg",
        status: "done",
        result: {
          fileName: "IMG_001.jpg",
          fields: [{ field: "brandName", applicationValue: "Old Tom", extractedValue: "Old Tom", status: "matched" }],
          overallStatus: "matched",
        },
      },
    ];

    const summary = buildCurrentBatchSummary({ ...record, totalCount: 1, rowFileNames: ["IMG_001.jpg"] }, rows);

    expect(summary.rows[0].result).toEqual(rows[0].result);
  });
});
