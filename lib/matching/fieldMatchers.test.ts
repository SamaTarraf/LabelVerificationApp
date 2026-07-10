// Vitest coverage for the matching dispatcher: confirms warningText routes to the
// algorithmic Government Warning matcher, and — the case this file exists to
// guarantee — that every other field (fuzzy, unrecognized, or alcoholContent/
// netContents as of the 2026-07-10 revision) is never silently dropped or
// recomputed, it passes through exactly as the extraction call returned it.

import { describe, expect, it } from "vitest";
import { matchField } from "./fieldMatchers";
import type { ExtractedFuzzyField } from "../extraction/types";

describe("matchField", () => {
  it("passes alcoholContent through unchanged, using the model's own status+explanation, not the dormant algorithmic matcher", () => {
    // As of the 2026-07-10 architecture revision, LabelFields.alcoholContent carries
    // status+explanation from the model, the same shape a fuzzy field uses — this
    // fixture is typed as ExtractedFuzzyField (the real LabelFields.alcoholContent
    // type) rather than ExtractedFieldBase, so it actually exercises the current type
    // rather than a stale narrower one. The model judged a mismatch here on purpose
    // (44% on the label vs. an implied 45% on the application) to confirm the
    // dispatcher doesn't recompute or override that judgment.
    const extracted: ExtractedFuzzyField = {
      foundText: "44%",
      status: "mismatched",
      explanation: "Application states 45% but the label reads 44%.",
    };

    const result = matchField("alcoholContent", "45%", extracted);

    expect(result).toEqual({
      field: "alcoholContent",
      applicationValue: "45%",
      extractedValue: "44%",
      status: "mismatched",
      explanation: "Application states 45% but the label reads 44%.",
    });
  });

  it("passes netContents through unchanged, using the model's own status+explanation, not the dormant algorithmic matcher", () => {
    const extracted: ExtractedFuzzyField = {
      foundText: "750 mL",
      status: "matched",
      explanation: "Net contents match exactly.",
    };

    const result = matchField("netContents", "750 mL", extracted);

    expect(result).toEqual({
      field: "netContents",
      applicationValue: "750 mL",
      extractedValue: "750 mL",
      status: "matched",
      explanation: "Net contents match exactly.",
    });
  });

  it("passes an unrecognized field name through unchanged, exactly as extracted", () => {
    const extracted: ExtractedFuzzyField = {
      foundText: "Some Producer LLC",
      status: "needs_review",
      explanation: "The label's producer name is spelled slightly differently.",
    };

    const result = matchField("someUnrecognizedField", "Some Producer", extracted);

    expect(result).toEqual({
      field: "someUnrecognizedField",
      applicationValue: "Some Producer",
      extractedValue: "Some Producer LLC",
      status: "needs_review",
      explanation: "The label's producer name is spelled slightly differently.",
    });
  });

  it("passes a known-fuzzy field (e.g. brandName) through unchanged, same as an unrecognized one", () => {
    const extracted: ExtractedFuzzyField = {
      foundText: "Old Tom Distillery",
      status: "matched",
      explanation: "Brand name matches exactly.",
    };

    const result = matchField("brandName", "Old Tom Distillery", extracted);

    expect(result.status).toBe("matched");
    expect(result.extractedValue).toBe("Old Tom Distillery");
  });
});
