// Vitest coverage for resultsToCsv: confirms the same worked scenario this app's own
// design writeup uses to illustrate the results-CSV format — one row with a plain
// strict-field mismatch, one row that matched cleanly, and one row combining a
// fuzzy-field's model reasoning with the Government Warning's fixed bold-uncertainty
// explanation — actually produces the documented shapes, plus a handful of structural
// edge cases (unfinished rows skipped, dynamic column derivation, CSV escaping).

import { describe, expect, it } from "vitest";
import type { BatchRowState } from "../persistence/kvStore";
import { resultsToCsv } from "./resultsToCsv";

/** Splits a resultsToCsv() output back into its raw lines, dropping the trailing blank
 * line its own trailing "\r\n" would otherwise leave behind. */
function lines(csv: string): string[] {
  return csv.split("\r\n").filter((line) => line.length > 0);
}

describe("resultsToCsv", () => {
  it("rolls a strict-field mismatch up to mismatched and describes it with the label-says shape (no explanation attached)", () => {
    const row: BatchRowState = {
      id: "1042",
      fileName: "IMG_001.jpg",
      applicationData: { brandName: "Stone's Throw", alcoholContent: "45%", netContents: "750mL" },
      blobRef: "https://example.blob/IMG_001.jpg",
      status: "done",
      result: {
        fileName: "IMG_001.jpg",
        overallStatus: "mismatched",
        fields: [
          { field: "brandName", applicationValue: "Stone's Throw", extractedValue: "Stone's Throw", status: "matched" },
          // No explanation attached — a bare numeric mismatch is self-explanatory once
          // the label's own extracted value is shown alongside it.
          { field: "alcoholContent", applicationValue: "45%", extractedValue: "44%", status: "mismatched" },
          { field: "netContents", applicationValue: "750mL", extractedValue: "750mL", status: "matched" },
        ],
      },
    };

    const csv = resultsToCsv([row]);
    const [header, dataLine] = lines(csv);

    expect(header).toBe("id,fileName,brandName,alcoholContent,netContents,status,flaggedFields");
    // Application-value columns carry what the manifest itself said (45%), never what
    // the label was found to say (44%) — the label's value only appears inside
    // flaggedFields, where the two disagree. This particular flaggedFields cell needs
    // no quoting (it has no comma/quote/newline of its own), matching the same
    // minimal-quoting convention csvEscape's other callers in this app already follow.
    expect(dataLine).toBe("1042,IMG_001.jpg,Stone's Throw,45%,750mL,mismatched,alcoholContent (label says 44%)");
  });

  it("leaves flaggedFields blank for a row that matched cleanly on every field", () => {
    const row: BatchRowState = {
      id: "1043",
      fileName: "IMG_002.jpg",
      applicationData: { brandName: "Old Barrel", alcoholContent: "40%", netContents: "1L" },
      blobRef: "https://example.blob/IMG_002.jpg",
      status: "done",
      result: {
        fileName: "IMG_002.jpg",
        overallStatus: "matched",
        fields: [
          { field: "brandName", applicationValue: "Old Barrel", extractedValue: "Old Barrel", status: "matched" },
          { field: "alcoholContent", applicationValue: "40%", extractedValue: "40%", status: "matched" },
          { field: "netContents", applicationValue: "1L", extractedValue: "1L", status: "matched" },
        ],
      },
    };

    const csv = resultsToCsv([row]);
    const [, dataLine] = lines(csv);

    expect(dataLine).toBe("1043,IMG_002.jpg,Old Barrel,40%,1L,matched,");
  });

  it("uses the explanation shape (not label-says) for both a fuzzy-field flag and the Government Warning's bold-uncertain flag", () => {
    const row: BatchRowState = {
      id: "1044",
      fileName: "IMG_003.jpg",
      applicationData: {
        brandName: "Highland Reserve",
        alcoholContent: "40%",
        netContents: "750mL",
        warningText: "GOVERNMENT WARNING: (1) According to the Surgeon General...",
      },
      blobRef: "https://example.blob/IMG_003.jpg",
      status: "done",
      result: {
        fileName: "IMG_003.jpg",
        overallStatus: "needs_review",
        fields: [
          {
            field: "brandName",
            applicationValue: "Highland Reserve",
            extractedValue: "Highland Reserve Distillers",
            status: "needs_review",
            explanation: "model unsure if it's the same entity",
          },
          { field: "alcoholContent", applicationValue: "40%", extractedValue: "40%", status: "matched" },
          { field: "netContents", applicationValue: "750mL", extractedValue: "750mL", status: "matched" },
          {
            field: "warningText",
            applicationValue: "GOVERNMENT WARNING: (1) According to the Surgeon General...",
            extractedValue: "GOVERNMENT WARNING: (1) According to the Surgeon General...",
            status: "needs_review",
            explanation: "bold styling could not be confirmed",
          },
        ],
      },
    };

    const csv = resultsToCsv([row]);
    const [header, dataLine] = lines(csv);

    // warningText only ever appears on this row — collectFieldColumns still gives it
    // its own column, appended after the columns already seen on earlier rows (none,
    // here, since this is the only row in this fixture).
    expect(header).toBe("id,fileName,brandName,alcoholContent,netContents,warningText,status,flaggedFields");
    expect(dataLine).toContain("needs_review");
    expect(dataLine).toContain(
      "brandName (model unsure if it's the same entity); warningText (bold styling could not be confirmed)"
    );
    // Neither flagged entry uses the label-says shape — both carry an explanation the
    // extracted text alone wouldn't convey.
    expect(dataLine).not.toContain("label says");
  });

  it("derives columns dynamically from whatever fields actually appear across rows, in first-seen order, and blanks a column a given row never checked", () => {
    const rowWithoutWarning: BatchRowState = {
      id: "1042",
      fileName: "IMG_001.jpg",
      applicationData: { brandName: "Stone's Throw" },
      blobRef: "https://example.blob/IMG_001.jpg",
      status: "done",
      result: {
        fileName: "IMG_001.jpg",
        overallStatus: "matched",
        fields: [{ field: "brandName", applicationValue: "Stone's Throw", extractedValue: "Stone's Throw", status: "matched" }],
      },
    };
    const rowWithWarning: BatchRowState = {
      id: "1044",
      fileName: "IMG_003.jpg",
      applicationData: { brandName: "Highland Reserve", warningText: "GOVERNMENT WARNING: ..." },
      blobRef: "https://example.blob/IMG_003.jpg",
      status: "done",
      result: {
        fileName: "IMG_003.jpg",
        overallStatus: "matched",
        fields: [
          { field: "brandName", applicationValue: "Highland Reserve", extractedValue: "Highland Reserve", status: "matched" },
          { field: "warningText", applicationValue: "GOVERNMENT WARNING: ...", extractedValue: "GOVERNMENT WARNING: ...", status: "matched" },
        ],
      },
    };

    const csv = resultsToCsv([rowWithoutWarning, rowWithWarning]);
    const [header, firstDataLine] = lines(csv);

    expect(header).toBe("id,fileName,brandName,warningText,status,flaggedFields");
    // The first row never checked warningText — its column is blank, not omitted, so
    // every data row still lines up with the header's column count.
    expect(firstDataLine).toBe("1042,IMG_001.jpg,Stone's Throw,,matched,");
  });

  it("skips a row that hasn't finished processing yet (still pending or in_flight), rather than crashing or printing blanks for it", () => {
    const doneRow: BatchRowState = {
      id: "1042",
      fileName: "IMG_001.jpg",
      applicationData: { brandName: "Stone's Throw" },
      blobRef: "https://example.blob/IMG_001.jpg",
      status: "done",
      result: {
        fileName: "IMG_001.jpg",
        overallStatus: "matched",
        fields: [{ field: "brandName", applicationValue: "Stone's Throw", extractedValue: "Stone's Throw", status: "matched" }],
      },
    };
    const pendingRow: BatchRowState = {
      id: "1043",
      fileName: "IMG_002.jpg",
      applicationData: { brandName: "Old Barrel" },
      blobRef: "https://example.blob/IMG_002.jpg",
      status: "pending",
    };
    const inFlightRow: BatchRowState = {
      id: "1045",
      fileName: "IMG_004.jpg",
      applicationData: { brandName: "Highland" },
      blobRef: "https://example.blob/IMG_004.jpg",
      status: "in_flight",
    };

    const csv = resultsToCsv([doneRow, pendingRow, inFlightRow]);

    expect(lines(csv)).toHaveLength(2); // header + the one finished row only
    expect(csv).not.toContain("IMG_002.jpg");
    expect(csv).not.toContain("IMG_004.jpg");
  });

  it("returns just a bare header (id,fileName,status,flaggedFields) when no row has finished yet", () => {
    const pendingRow: BatchRowState = {
      id: "1042",
      fileName: "IMG_001.jpg",
      applicationData: { brandName: "Stone's Throw" },
      blobRef: "https://example.blob/IMG_001.jpg",
      status: "pending",
    };

    const csv = resultsToCsv([pendingRow]);

    expect(lines(csv)).toEqual(["id,fileName,status,flaggedFields"]);
  });

  it("quotes an application value containing a comma, and a flaggedFields cell containing a comma inside its explanation", () => {
    const row: BatchRowState = {
      id: "1046",
      fileName: "IMG_005.jpg",
      applicationData: { producer: "Smith, Jones & Co." },
      blobRef: "https://example.blob/IMG_005.jpg",
      status: "done",
      result: {
        fileName: "IMG_005.jpg",
        overallStatus: "needs_review",
        fields: [
          {
            field: "producer",
            applicationValue: "Smith, Jones & Co.",
            extractedValue: "Smith Jones and Co.",
            status: "needs_review",
            explanation: "punctuation differs, but this reads as the same producer, name",
          },
        ],
      },
    };

    const csv = resultsToCsv([row]);
    const [, dataLine] = lines(csv);

    expect(dataLine).toContain('"Smith, Jones & Co."');
    expect(dataLine).toContain('"producer (punctuation differs, but this reads as the same producer, name)"');
  });
});
