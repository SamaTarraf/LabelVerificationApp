// Vitest coverage for BatchUploadPanel.tsx's pure, non-rendering helper functions
// only (csvEscape, buildCsvTemplate, buildPreflightSummary, describePairingError,
// formatEstimatedTimeRemaining, applyProcessedRows) — per this project's established
// testing-scope convention, the component's own network calls, File/Blob uploads,
// sessionStorage-backed tab id, and rendering are exercised manually (a running dev
// server, real browser behavior) rather than through jsdom mocking infrastructure this
// project doesn't otherwise have, the same way UploadForm.tsx's own fetch-based submit
// flow was never unit-tested either.

import { describe, expect, it } from "vitest";
import type { BatchEntry, PairingError } from "@/lib/batchInput/types";
import type { BatchRowState } from "@/lib/persistence/kvStore";
import {
  applyProcessedRows,
  buildCsvTemplate,
  buildPreflightSummary,
  csvEscape,
  describePairingError,
  formatEstimatedTimeRemaining,
} from "./BatchUploadPanel";

describe("csvEscape", () => {
  it("returns a plain value unchanged when it needs no quoting", () => {
    expect(csvEscape("IMG_001.jpg")).toBe("IMG_001.jpg");
  });

  it("wraps a value containing a comma in double quotes", () => {
    expect(csvEscape("Smith, Jones & Co.")).toBe('"Smith, Jones & Co."');
  });

  it("doubles any literal quote character inside a value that needs quoting", () => {
    expect(csvEscape('Old "Tom" Distillery, LLC')).toBe('"Old ""Tom"" Distillery, LLC"');
  });

  it("wraps a value containing a newline in double quotes", () => {
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("buildCsvTemplate", () => {
  const template = buildCsvTemplate();
  const [headerLine, exampleLine] = template.trim().split("\r\n");

  it("starts the header with the two reserved pairing/bookkeeping columns", () => {
    expect(headerLine.startsWith("fileName,id,")).toBe(true);
  });

  it("includes every known application field as its own header column", () => {
    expect(headerLine).toContain("brandName");
    expect(headerLine).toContain("alcoholContent");
    expect(headerLine).toContain("netContents");
    expect(headerLine).toContain("warningText");
  });

  it("leaves the countryOfOrigin example cell blank rather than using its instructional placeholder text", () => {
    // countryOfOrigin's UploadForm placeholder is instructional prose ("Leave blank if
    // this is not an import"), not example data — the template's example row must not
    // carry that text literally into a cell a real user might copy from.
    expect(exampleLine).not.toContain("Leave blank");
  });

  it("quotes the example row's Government Warning cell, which contains embedded commas", () => {
    expect(exampleLine).toContain('"GOVERNMENT WARNING:');
  });
});

describe("buildPreflightSummary", () => {
  const entry: BatchEntry = {
    id: "1042",
    fileName: "IMG_001.jpg",
    image: new File([""], "IMG_001.jpg"),
    applicationData: { brandName: "Old Tom" },
  };
  const noMatchingImage: PairingError = { fileName: "IMG_099.jpg", reason: "no_matching_image" };
  const noMatchingRow: PairingError = { fileName: "IMG_100.jpg", reason: "no_matching_row" };

  it("counts matched entries and splits errors by reason", () => {
    const summary = buildPreflightSummary([entry], [noMatchingImage, noMatchingRow]);
    expect(summary.matchedCount).toBe(1);
    expect(summary.noMatchingImageErrors).toEqual([noMatchingImage]);
    expect(summary.noMatchingRowErrors).toEqual([noMatchingRow]);
  });

  it("counts totalCsvRowsConsidered as matched entries plus rows with no image, excluding unclaimed images", () => {
    const summary = buildPreflightSummary([entry], [noMatchingImage, noMatchingRow]);
    // 1 matched + 1 row with no image = 2 CSV rows total; the unclaimed image was
    // never a CSV row, so it must not inflate this denominator.
    expect(summary.totalCsvRowsConsidered).toBe(2);
  });

  it("handles a perfectly-paired manifest with zero errors", () => {
    const summary = buildPreflightSummary([entry], []);
    expect(summary.matchedCount).toBe(1);
    expect(summary.totalCsvRowsConsidered).toBe(1);
    expect(summary.noMatchingImageErrors).toEqual([]);
    expect(summary.noMatchingRowErrors).toEqual([]);
  });
});

describe("describePairingError", () => {
  it("describes a CSV row with no matching image", () => {
    const message = describePairingError({ fileName: "IMG_099.jpg", reason: "no_matching_image" });
    expect(message).toContain("IMG_099.jpg");
    expect(message).toContain("listed in the CSV manifest");
  });

  it("describes an uploaded image with no matching CSV row", () => {
    const message = describePairingError({ fileName: "IMG_100.jpg", reason: "no_matching_row" });
    expect(message).toContain("IMG_100.jpg");
    expect(message).toContain("no CSV row lists that exact filename");
  });
});

describe("formatEstimatedTimeRemaining", () => {
  it("reports done when nothing is pending", () => {
    expect(formatEstimatedTimeRemaining(0)).toBe("Done.");
  });

  it("rounds a short remaining time up to about a minute", () => {
    // 1 pending row at 4s/row = 4s, well under a minute.
    expect(formatEstimatedTimeRemaining(1, 4_000)).toBe("About a minute remaining.");
  });

  it("reports a multi-minute estimate for a larger pending count", () => {
    // 300 pending rows at 4s/row = 1200s = 20 minutes exactly.
    expect(formatEstimatedTimeRemaining(300, 4_000)).toBe("About 20 minutes remaining.");
  });
});

describe("applyProcessedRows", () => {
  const pendingRow: BatchRowState = {
    id: "1042",
    fileName: "IMG_001.jpg",
    applicationData: { brandName: "Old Tom" },
    blobRef: "https://example.blob/IMG_001.jpg",
    status: "pending",
  };
  const otherRow: BatchRowState = {
    id: "1043",
    fileName: "IMG_002.jpg",
    applicationData: { brandName: "Highland" },
    blobRef: "https://example.blob/IMG_002.jpg",
    status: "pending",
  };

  it("returns the original array unchanged when there are no processed rows", () => {
    const original = [pendingRow, otherRow];
    const result = applyProcessedRows(original, []);
    expect(result).toBe(original);
  });

  it("replaces only the row whose fileName matches a processed row, leaving the rest untouched", () => {
    const doneRow: BatchRowState = { ...pendingRow, status: "done" };
    const result = applyProcessedRows([pendingRow, otherRow], [doneRow]);
    expect(result).toEqual([doneRow, otherRow]);
    // The untouched row must be the exact same reference, not a re-created copy.
    expect(result[1]).toBe(otherRow);
  });
});
