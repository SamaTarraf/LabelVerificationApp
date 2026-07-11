// Vitest coverage for csvManifestParser: confirms the CSV-text-plus-image-files ->
// BatchEntry[]/PairingError[] pairing behaves correctly on both the happy path and
// the two mismatch directions the PairingError type exists to describe
// (no_matching_image, no_matching_row), plus a handful of parsing edge cases
// (reserved columns, blank cells, quoted fields, a missing fileName column).

import { describe, expect, it } from "vitest";
import { csvManifestParser } from "./csvManifestParser";

/** Builds a minimal browser-style File for a test, defaulting to a JPEG image MIME type. */
function makeImageFile(fileName: string): File {
  return new File(["fake-image-bytes"], fileName, { type: "image/jpeg" });
}

describe("csvManifestParser", () => {
  it("pairs every row with its matching image and builds ApplicationData from the non-reserved columns", () => {
    const csvText = [
      "id,fileName,brandName,alcoholContent,netContents",
      "1042,IMG_001.jpg,Stone's Throw,45%,750mL",
      "1043,IMG_002.jpg,Old Barrel,40%,1L",
    ].join("\n");
    const imageFiles = [makeImageFile("IMG_001.jpg"), makeImageFile("IMG_002.jpg")];

    const { entries, errors } = csvManifestParser.parse(csvText, imageFiles);

    expect(errors).toEqual([]);
    expect(entries).toHaveLength(2);

    // `fileName` is a reserved bookkeeping column — it must not leak into
    // applicationData as a field to be checked against the label. `id` is likewise
    // reserved out of applicationData, but (unlike fileName) it's still captured, onto
    // BatchEntry.id itself — confirmed here alongside the applicationData exclusion.
    expect(entries[0]).toEqual({
      id: "1042",
      fileName: "IMG_001.jpg",
      image: imageFiles[0],
      applicationData: { brandName: "Stone's Throw", alcoholContent: "45%", netContents: "750mL" },
    });
    expect(entries[1]).toEqual({
      id: "1043",
      fileName: "IMG_002.jpg",
      image: imageFiles[1],
      applicationData: { brandName: "Old Barrel", alcoholContent: "40%", netContents: "1L" },
    });
  });

  it("carries a row's id through onto BatchEntry.id, and defaults to an empty string when the manifest has no id column at all", () => {
    const withIdColumn = csvManifestParser.parse(
      ["id,fileName,brandName", "1042,IMG_001.jpg,Stone's Throw"].join("\n"),
      [makeImageFile("IMG_001.jpg")]
    );
    expect(withIdColumn.entries[0].id).toBe("1042");

    const withoutIdColumn = csvManifestParser.parse(
      ["fileName,brandName", "IMG_001.jpg,Stone's Throw"].join("\n"),
      [makeImageFile("IMG_001.jpg")]
    );
    expect(withoutIdColumn.entries[0].id).toBe("");
  });

  it("reports a manifest row with no matching uploaded image as no_matching_image, and still pairs the rest", () => {
    const csvText = [
      "id,fileName,brandName",
      "1042,IMG_001.jpg,Stone's Throw",
      "1043,IMG_002.jpg,Old Barrel",
    ].join("\n");
    // Only IMG_001.jpg was actually uploaded — IMG_002.jpg is referenced by the
    // manifest but missing from the image set.
    const imageFiles = [makeImageFile("IMG_001.jpg")];

    const { entries, errors } = csvManifestParser.parse(csvText, imageFiles);

    expect(entries).toHaveLength(1);
    expect(entries[0].fileName).toBe("IMG_001.jpg");
    expect(errors).toEqual([{ fileName: "IMG_002.jpg", reason: "no_matching_image" }]);
  });

  it("reports an uploaded image with no matching manifest row as no_matching_row, and still pairs the rest", () => {
    const csvText = ["id,fileName,brandName", "1042,IMG_001.jpg,Stone's Throw"].join("\n");
    // IMG_999.jpg was uploaded but no manifest row names it.
    const imageFiles = [makeImageFile("IMG_001.jpg"), makeImageFile("IMG_999.jpg")];

    const { entries, errors } = csvManifestParser.parse(csvText, imageFiles);

    expect(entries).toHaveLength(1);
    expect(entries[0].fileName).toBe("IMG_001.jpg");
    expect(errors).toEqual([{ fileName: "IMG_999.jpg", reason: "no_matching_row" }]);
  });

  it("reports both mismatch directions together when the manifest and image set only partially overlap", () => {
    const csvText = [
      "id,fileName,brandName",
      "1042,IMG_001.jpg,Stone's Throw",
      "1043,IMG_002.jpg,Old Barrel",
    ].join("\n");
    const imageFiles = [makeImageFile("IMG_001.jpg"), makeImageFile("IMG_999.jpg")];

    const { entries, errors } = csvManifestParser.parse(csvText, imageFiles);

    expect(entries).toHaveLength(1);
    expect(entries[0].fileName).toBe("IMG_001.jpg");
    expect(errors).toEqual(
      expect.arrayContaining([
        { fileName: "IMG_002.jpg", reason: "no_matching_image" },
        { fileName: "IMG_999.jpg", reason: "no_matching_row" },
      ])
    );
    expect(errors).toHaveLength(2);
  });

  it("treats a blank cell as an absent field, not an empty string to match literally", () => {
    const csvText = ["id,fileName,brandName,countryOfOrigin", "1042,IMG_001.jpg,Stone's Throw,"].join("\n");
    const imageFiles = [makeImageFile("IMG_001.jpg")];

    const { entries } = csvManifestParser.parse(csvText, imageFiles);

    expect(entries[0].applicationData).toEqual({ brandName: "Stone's Throw" });
    expect("countryOfOrigin" in entries[0].applicationData).toBe(false);
  });

  it("handles a quoted field containing an embedded comma without misreading it as a column boundary", () => {
    const csvText = [
      "id,fileName,producer",
      '1042,IMG_001.jpg,"Smith, Jones & Co."',
    ].join("\n");
    const imageFiles = [makeImageFile("IMG_001.jpg")];

    const { entries, errors } = csvManifestParser.parse(csvText, imageFiles);

    expect(errors).toEqual([]);
    expect(entries[0].applicationData.producer).toBe("Smith, Jones & Co.");
  });

  it("keeps any column beyond id/fileName as an open ApplicationData field, not a hardcoded list", () => {
    const csvText = ["id,fileName,someUnrecognizedField", "1042,IMG_001.jpg,some value"].join("\n");
    const imageFiles = [makeImageFile("IMG_001.jpg")];

    const { entries } = csvManifestParser.parse(csvText, imageFiles);

    expect(entries[0].applicationData).toEqual({ someUnrecognizedField: "some value" });
  });

  it("throws a clear error when the manifest has no fileName column at all", () => {
    const csvText = ["id,brandName", "1042,Stone's Throw"].join("\n");

    expect(() => csvManifestParser.parse(csvText, [])).toThrow(/fileName/);
  });

  it("returns empty entries and errors for an empty manifest", () => {
    const { entries, errors } = csvManifestParser.parse("", []);

    expect(entries).toEqual([]);
    expect(errors).toEqual([]);
  });
});
