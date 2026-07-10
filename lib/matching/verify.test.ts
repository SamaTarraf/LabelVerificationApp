// Vitest coverage for the verification orchestrator's rollup precedence: a strict-
// field mismatch always wins, a fuzzy-field needs_review only shows through when
// nothing mismatched, and an all-clear result rolls up to matched. Only the
// extraction call is stubbed out here — the real matching/rollup logic in
// fieldMatchers.ts and verify.ts runs unmocked, per the intent of accepting
// `extractor` as a swappable parameter.
//
// As of the 2026-07-10 architecture revision, warningText is the only field left
// whose match decision is made by real matcher code (matchGovernmentWarning) rather
// than passed through from the model's own extraction-time judgment — alcoholContent
// and netContents now carry status+explanation directly on the fixture, the same way
// brandName always has, since fieldMatchers.ts no longer computes anything for them
// (see fieldMatchers.ts/fieldMatchers.test.ts for that dispatch-level coverage). The
// "strict-field mismatch alone rolls up to mismatched" scenario below was moved onto
// warningText specifically so it still exercises a real algorithmic mismatch decision
// end-to-end through the orchestrator, not just a pre-set status value flowing through
// unchanged — the latter would no longer prove anything rollupStatus() doesn't already
// prove regardless of which field carries the status.

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
      alcoholContent: { foundText: "45%", status: "matched", explanation: "Alcohol content matches exactly." },
      netContents: { foundText: "750 mL", status: "matched", explanation: "Net contents match exactly." },
      // Deliberate mismatch: prefix transcribed as "Government Warning:" rather than
      // literal ALL CAPS — matchGovernmentWarning() fails the hard ALL CAPS check even
      // though the body wording is otherwise identical (case-insensitive match), so
      // this is still a real algorithmic mismatch decision, not a pre-set status value.
      warningText: {
        foundText:
          "Government Warning: (1) According to the Surgeon General, women should not drink " +
          "alcoholic beverages during pregnancy.",
        isWarningBold: true,
        boldConfident: true,
      },
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
      alcoholContent: { foundText: "45%", status: "matched", explanation: "Alcohol content matches exactly." },
      netContents: { foundText: "750 mL", status: "matched", explanation: "Net contents match exactly." },
      warningText: { foundText: APPLICATION_DATA.warningText as string, isWarningBold: true, boldConfident: true },
    };

    const result = await verify("label.jpg", DUMMY_IMAGE, APPLICATION_DATA, stubExtractor(labelFields));

    expect(result.overallStatus).toBe("needs_review");
  });

  it("rolls up to matched when every field, strict and fuzzy, matches cleanly", async () => {
    const labelFields: LabelFields = {
      brandName: { foundText: "Old Tom Distillery", status: "matched", explanation: "Brand name matches." },
      alcoholContent: { foundText: "45%", status: "matched", explanation: "Alcohol content matches exactly." },
      netContents: { foundText: "750 mL", status: "matched", explanation: "Net contents match exactly." },
      warningText: { foundText: APPLICATION_DATA.warningText as string, isWarningBold: true, boldConfident: true },
    };

    const result = await verify("label.jpg", DUMMY_IMAGE, APPLICATION_DATA, stubExtractor(labelFields));

    expect(result.overallStatus).toBe("matched");
  });
});
