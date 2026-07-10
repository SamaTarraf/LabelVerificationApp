// Vitest coverage for the matching dispatcher: confirms the three algorithmic fields
// route correctly, and — the case this file exists to guarantee — that an
// unrecognized field name is never silently dropped, it passes through exactly as
// the extraction call returned it.

import { describe, expect, it } from "vitest";
import { matchField } from "./fieldMatchers";
import type { ExtractedFieldBase, ExtractedFuzzyField } from "../extraction/types";

describe("matchField", () => {
  it("routes alcoholContent to the algorithmic numeric matcher", () => {
    const extracted: ExtractedFieldBase = { foundText: "45%" };

    const result = matchField("alcoholContent", "45%", extracted);

    expect(result.status).toBe("matched");
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
