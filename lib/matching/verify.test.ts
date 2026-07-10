// Vitest coverage for the verification orchestrator's rollup precedence: a strict-
// field mismatch always wins, a fuzzy-field needs_review only shows through when
// nothing mismatched, and an all-clear result rolls up to matched. Only the
// extraction call is stubbed out here — the real matching/rollup logic in
// fieldMatchers.ts and verify.ts runs unmocked, per the intent of accepting
// `extractor` as a swappable parameter.

import { describe, expect, it } from "vitest";
import { verify } from "./verify";
import type { ApplicationData } from "../types";
import type { LabelExtractor, LabelFields, LabelImage } from "../extraction/types";

// Real image bytes are irrelevant here — the stub extractor below never inspects
// this value, it just needs to satisfy the LabelImage shape verify() expects.
const DUMMY_IMAGE: LabelImage = { base64: "", mimeType: "image/jpeg" };

const APPLICATION_DATA: ApplicationData = {
  brandName: "Old Tom Distillery",
  alcoholContent: "45%",
  netContents: "750 mL",
  warningText:
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink " +
    "alcoholic beverages during pregnancy.",
};

/** Builds a stub LabelExtractor that always returns the given fixture, regardless of the image/hints passed in. */
function stubExtractor(labelFields: LabelFields): LabelExtractor {
  return {
    extract: async () => labelFields,
  };
}

describe("verify", () => {
  it("rolls up to mismatched on a strict-field mismatch alone, never needs_review, even if nothing else is wrong", async () => {
    const labelFields: LabelFields = {
      brandName: { foundText: "Old Tom Distillery", status: "matched", explanation: "Brand name matches." },
      alcoholContent: { foundText: "44%" }, // wrong ABV — deliberate mismatch
      netContents: { foundText: "750 mL" },
      warningText: { foundText: APPLICATION_DATA.warningText as string, isWarningBold: true, boldConfident: true },
    };

    const result = await verify("label.jpg", DUMMY_IMAGE, APPLICATION_DATA, stubExtractor(labelFields));

    expect(result.overallStatus).toBe("mismatched");
  });

  it("rolls up to needs_review when a fuzzy field needs review and every strict field matched", async () => {
    const labelFields: LabelFields = {
      brandName: {
        foundText: "Old Tom Distillery Co.",
        status: "needs_review",
        explanation: "Label includes a corporate suffix not present on the application.",
      },
      alcoholContent: { foundText: "45%" },
      netContents: { foundText: "750 mL" },
      warningText: { foundText: APPLICATION_DATA.warningText as string, isWarningBold: true, boldConfident: true },
    };

    const result = await verify("label.jpg", DUMMY_IMAGE, APPLICATION_DATA, stubExtractor(labelFields));

    expect(result.overallStatus).toBe("needs_review");
  });

  it("rolls up to matched when every field, strict and fuzzy, matches cleanly", async () => {
    const labelFields: LabelFields = {
      brandName: { foundText: "Old Tom Distillery", status: "matched", explanation: "Brand name matches." },
      alcoholContent: { foundText: "45%" },
      netContents: { foundText: "750 mL" },
      warningText: { foundText: APPLICATION_DATA.warningText as string, isWarningBold: true, boldConfident: true },
    };

    const result = await verify("label.jpg", DUMMY_IMAGE, APPLICATION_DATA, stubExtractor(labelFields));

    expect(result.overallStatus).toBe("matched");
  });
});
