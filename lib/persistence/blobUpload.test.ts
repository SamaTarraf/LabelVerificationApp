// Vitest coverage for blobUpload.ts's pure pathname-naming logic only — the one piece
// of this file with no network call involved. uploadLabelImage() and
// handleLabelImageUploadRequest() both call the real @vercel/blob client and are not
// covered here, per this project's established testing-scope convention (pure logic
// gets automated tests, direct external API calls don't — see this file's header
// comment).

import { describe, expect, it } from "vitest";
import { blobPathForLabelImage } from "./blobUpload";

describe("blobPathForLabelImage", () => {
  it("namespaces a label image's pathname under its batch id", () => {
    expect(blobPathForLabelImage("batch-123", "IMG_001.jpg")).toBe("batches/batch-123/IMG_001.jpg");
  });

  it("produces different pathnames for the same fileName across two different batches", () => {
    const pathInFirstBatch = blobPathForLabelImage("batch-1", "IMG_001.jpg");
    const pathInSecondBatch = blobPathForLabelImage("batch-2", "IMG_001.jpg");

    expect(pathInFirstBatch).not.toBe(pathInSecondBatch);
  });
});
