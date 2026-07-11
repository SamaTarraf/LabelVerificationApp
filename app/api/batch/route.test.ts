// Vitest coverage for POST /api/batch's pure request-body validation logic
// (isApplicationData, validateRegisterBatchRow) — no KV, no network, so every case here
// runs without mocking anything. The route handler itself (which actually writes to KV)
// isn't covered by this suite, per this project's established testing-scope convention:
// pure logic gets automated tests, direct external API calls don't.

import { describe, expect, it } from "vitest";
import { isApplicationData, validateRegisterBatchRow } from "./route";

describe("isApplicationData", () => {
  it("accepts an object whose present values are all strings", () => {
    expect(isApplicationData({ brandName: "Old Tom", alcoholContent: "45%" })).toBe(true);
  });

  it("accepts an empty object (an application with no fields at all is still valid shape-wise)", () => {
    expect(isApplicationData({})).toBe(true);
  });

  it("rejects a non-object value", () => {
    expect(isApplicationData("not an object")).toBe(false);
    expect(isApplicationData(42)).toBe(false);
    expect(isApplicationData(null)).toBe(false);
  });

  it("rejects an array, even though typeof an array is 'object'", () => {
    expect(isApplicationData(["brandName", "Old Tom"])).toBe(false);
  });

  it("rejects an object with a non-string field value", () => {
    expect(isApplicationData({ brandName: "Old Tom", alcoholContent: 45 })).toBe(false);
  });
});

describe("validateRegisterBatchRow", () => {
  const validRow = {
    id: "1042",
    fileName: "IMG_001.jpg",
    blobRef: "https://example.blob.vercel-storage.com/batches/1/IMG_001.jpg",
    applicationData: { brandName: "Old Tom" },
  };

  it("returns null for a well-formed row", () => {
    expect(validateRegisterBatchRow(validRow, 0)).toBeNull();
  });

  it("accepts an empty-string id — unlike fileName/blobRef, id is not required to be non-empty", () => {
    expect(validateRegisterBatchRow({ ...validRow, id: "" }, 0)).toBeNull();
  });

  it("reports a specific error when id is missing entirely", () => {
    const { id, ...rest } = validRow;
    void id;
    expect(validateRegisterBatchRow(rest, 6)).toBe('Row 6 is missing an "id" (must be a string, may be empty).');
  });

  it("reports a specific error when id is the wrong type", () => {
    expect(validateRegisterBatchRow({ ...validRow, id: 1042 }, 7)).toBe(
      'Row 7 is missing an "id" (must be a string, may be empty).'
    );
  });

  it("reports a specific error when the row itself isn't an object", () => {
    expect(validateRegisterBatchRow("not an object", 2)).toBe("Row 2 must be an object.");
  });

  it("reports a specific error when fileName is missing", () => {
    const { fileName, ...rest } = validRow;
    void fileName;
    expect(validateRegisterBatchRow(rest, 1)).toBe('Row 1 is missing a non-empty "fileName".');
  });

  it("reports a specific error when fileName is an empty string", () => {
    expect(validateRegisterBatchRow({ ...validRow, fileName: "" }, 3)).toBe('Row 3 is missing a non-empty "fileName".');
  });

  it("reports a specific error when blobRef is missing", () => {
    const { blobRef, ...rest } = validRow;
    void blobRef;
    expect(validateRegisterBatchRow(rest, 4)).toBe('Row 4 is missing a non-empty "blobRef".');
  });

  it("reports a specific error when applicationData isn't a valid ApplicationData shape", () => {
    expect(validateRegisterBatchRow({ ...validRow, applicationData: { alcoholContent: 45 } }, 5)).toBe(
      `Row 5's "applicationData" must be an object of string field values.`
    );
  });
});
